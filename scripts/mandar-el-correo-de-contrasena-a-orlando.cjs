#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL CORREO PARA QUE ORLANDO ELIJA SU CONTRASEÑA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ASÍ Y NO DE OTRA FORMA. La cuenta `orlando@cotea.com.mx` se creó sin
// contraseña a propósito: una credencial tecleada en el chat queda en la
// transcripción, y una escrita en un guion queda en el historial de git para
// siempre. Las dos son para siempre y ninguna se puede retirar. Lo que sí se
// puede hacer es que la elija el dueño de la cuenta, y eso es este correo.
//
// POR ESO ESTE GUION NO IMPRIME EL ENLACE. El Admin SDK sabe generarlo sin
// mandar nada (`generatePasswordResetLink`), y ese enlace es equivalente a una
// contraseña: quien lo tenga pone la que quiera. Imprimirlo aquí lo metería en
// la transcripción, que es exactamente lo que se está evitando. Así que el
// enlace lo manda Firebase directo al buzón y nadie más lo ve.
//
// LO QUE ESTO ESCRIBE no es un documento: es un correo que SALE DE VERDAD hacia
// un buzón real. Por eso pasa por el portón de `destino.cjs` igual que una
// escritura a Firestore — un correo mandado no se puede desmandar.
//
// LAS TRES COSAS QUE SE MIDEN ANTES DE MANDARLO, y van impresas:
//
//   1. EL DNS DEL DOMINIO. Un dominio que parece nuestro puede no serlo: el
//      2026-11-15 `demo.com.mx` resultó ser de un tercero y con MX vivo, o sea
//      que el correo le habría llegado a un extraño. Aquí se enseña a qué
//      servidor va antes de mandarlo.
//   2. QUE LA CUENTA EXISTA EN AUTH, y con qué uid. Si no existe, el correo no
//      tiene a quién restablecerle nada y el proveedor contesta EMAIL_NOT_FOUND.
//   3. QUE EL PERFIL DE FIRESTORE ESTÉ DONDE EL LOGIN LO BUSCA. Esto no es
//      paranoia: el login NO busca por uid, deriva el id del correo tecleado
//      (`src/App.jsx:9825`) y si no encuentra `usuarios/{eseId}` CIERRA LA
//      SESIÓN. Orlando podría elegir su contraseña, entrar bien a Auth, y
//      quedar fuera igual. Mandar el correo sin medir esto es mandarlo a una
//      puerta que no abre.
//
// LO QUE ESTO NO PUEDE PROBAR, y hay que decirlo en vez de darlo por hecho: que
// el buzón `orlando@` EXISTA. `cotea.com.mx` es nuestro, pero un dominio con MX
// no implica que esa casilla esté dada de alta en el proveedor de correo. Si no
// está, el mensaje rebota y Orlando nunca ve el enlace — y este guion habría
// dicho «mandado» con razón. Son dos cosas distintas: que el proveedor lo
// ACEPTE y que el buzón lo RECIBA. La segunda se comprueba abriendo el buzón.
//
// Uso:
//     node scripts/mandar-el-correo-de-contrasena-a-orlando.cjs --prod
//         mide las tres cosas y NO manda nada
//
//     node scripts/mandar-el-correo-de-contrasena-a-orlando.cjs --prod --escribir
//         manda el correo de verdad

'use strict';

// EL PORTÓN VA PRIMERO, ANTES DE `firebase-admin`. `firebase-admin` vive en
// `functions/node_modules` y no en la raíz, así que sin `NODE_PATH` el require
// muere con MODULE_NOT_FOUND. Si el portón fuera después, un destino mal puesto
// se reportaría como un módulo que falta y el diagnóstico apuntaría al sitio
// equivocado.
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({
  escribe: 'manda un correo de restablecimiento a un buzón real',
});

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const CORREO = 'orlando@cotea.com.mx';
const DOMINIO = CORREO.split('@')[1];

// ── LA LLAVE SALE DEL FRONT, NO DE AQUÍ ────────────────────────────────────
// Es la clave web pública: viaja en el paquete que sirve Netlify, así que no es
// un secreto. Se lee de `src/App.jsx` y no se teclea para que este guion no
// pueda apuntar a un proyecto distinto del que usa la app: una clave tecleada
// se queda vieja en silencio el día que el front cambie de proyecto.
const APP = path.join(__dirname, '..', 'src', 'App.jsx');
const fuente = fs.readFileSync(APP, 'utf8');
const mKey = fuente.match(/apiKey:\s*"([^"]+)"/);
const mProj = fuente.match(/projectId:\s*"([^"]+)"/);
if (!mKey || !mProj) noArranco.sinPrecondicion(
  'no se pudo leer `apiKey`/`projectId` de src/App.jsx',
  'el bloque `firebaseConfig` cambió de forma');
const API_KEY = mKey[1];
const PROYECTO_DEL_FRONT = mProj[1];

if (DESTINO.prod && PROYECTO_DEL_FRONT !== DESTINO.projectId) noArranco.sinPrecondicion(
  `el front apunta a \`${PROYECTO_DEL_FRONT}\` y el destino es \`${DESTINO.projectId}\``,
  'son proyectos distintos: el correo saldría del proyecto equivocado');

// El id del perfil, derivado como lo deriva el login. No es una copia de la
// cuenta: es la MISMA transformación, y si cambia en la app este guion deja de
// medir lo que la app hace. Por eso va citada la línea.
const idDeCorreo = (c) => String(c || '').toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

let admin;
try {
  admin = require('firebase-admin');
} catch (e) {
  noArranco.sinPrecondicion(
    `no se pudo cargar firebase-admin: ${e.message}`,
    'export NODE_PATH="$PWD/functions/node_modules"   (vive en functions/, no en la raíz)');
}
admin.initializeApp({ projectId: DESTINO.projectId });
const auth = admin.auth();
const db = admin.firestore();

(async () => {
  console.log('════════════════════════════════════════════════════════════════');
  console.log(`1 · A DÓNDE VA · el DNS de ${DOMINIO}`);
  console.log('');
  let mx = [];
  try { mx = await dns.resolveMx(DOMINIO); }
  catch (e) { console.log(`  sin MX (${e.code})`); }
  if (!mx.length) {
    console.log('  ⚠ EL DOMINIO NO TIENE MX. El correo no llega a ningún buzón:');
    console.log('    se pierde en el proveedor y nadie se enterará.');
  } else {
    for (const r of mx.sort((a, b) => a.priority - b.priority)) {
      let ips = [];
      try { ips = await dns.resolve4(r.exchange); } catch { /* da igual */ }
      console.log(`  MX ${String(r.priority).padStart(3)}  ${r.exchange}` +
        (ips.length ? `  → ${ips.join(', ')}` : '  → (sin A)'));
    }
    console.log('');
    console.log('  Este es el servidor que va a recibir el mensaje. Si no fuera');
    console.log('  nuestro, le estaríamos mandando el enlace a un extraño.');
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('2 · LA CUENTA EN FIREBASE AUTH');
  console.log('');
  let u;
  try { u = await auth.getUserByEmail(CORREO); }
  catch (e) {
    if (e.code === 'auth/user-not-found') noArranco.sinPrecondicion(
      `\`${CORREO}\` no existe en Auth del proyecto ${DESTINO.projectId}`,
      'siembra la cuenta primero: scripts/sembrar-dependencia-demo.cjs');
    throw e;
  }
  console.log(`  uid:          ${u.uid}`);
  console.log(`  correo:       ${u.email}   verificado: ${u.emailVerified}`);
  console.log(`  deshabilitada: ${u.disabled}`);
  console.log(`  proveedores:  ${(u.providerData || []).map(p => p.providerId).join(', ') || '(ninguno)'}`);
  const claims = u.customClaims || {};
  console.log(`  claims:       rol=${claims.rol} orgId=${claims.orgId} tipo=${claims.tipo}`);
  if (u.disabled) console.log('\n  ⚠ LA CUENTA ESTÁ DESHABILITADA: elegir contraseña no la va a dejar entrar.');

  // LA LISTA DE PROVEEDORES VACÍA ES LO ESPERADO AQUÍ, y conviene decirlo
  // porque parece una avería: la cuenta se creó sin contraseña, así que no hay
  // proveedor de contraseña que listar. El proveedor aparece cuando alguien
  // elige una. Lo que NO se sabe de antemano es si Firebase acepta mandar un
  // restablecimiento a una cuenta en ese estado; si lo rechaza, se ve abajo con
  // su mensaje en vez de adivinarlo desde aquí.
  if (!(u.providerData || []).length) {
    console.log('');
    console.log('  La lista de proveedores vacía ES el estado esperado: la cuenta');
    console.log('  nació sin contraseña. El proveedor `password` aparece cuando');
    console.log('  Orlando elija la suya con el enlace de este correo.');
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('3 · EL PERFIL, DONDE EL LOGIN LO BUSCA (App.jsx:9825)');
  console.log('');
  const idPerfil = idDeCorreo(CORREO);
  console.log(`  el login va a pedir:  usuarios/${idPerfil}`);
  const snap = await db.doc(`usuarios/${idPerfil}`).get();
  if (!snap.exists) {
    console.log('');
    console.log('  ⚠ NO EXISTE. Orlando podría elegir su contraseña, autenticarse');
    console.log('    bien, y la app lo sacaría igual: sin este documento el login');
    console.log('    cierra la sesión con «tu cuenta no tiene perfil en el sistema».');
    noArranco.sinPrecondicion(
      `falta usuarios/${idPerfil}`,
      'mueve el perfil al id que deriva del correo antes de mandar el correo');
  }
  const p = snap.data();
  console.log(`  existe:       sí`);
  console.log(`  rol:          ${p.rol}`);
  console.log(`  orgId:        ${p.orgId}`);
  console.log(`  activo:       ${p.activo === undefined ? '(no trae)' : p.activo}` +
    (p.activo === false ? '   ⚠ EL LOGIN LO SACA: «tu usuario está desactivado»' : ''));
  console.log(`  uid guardado: ${p.uid || '(no trae)'}` +
    (p.uid && p.uid !== u.uid ? `   ⚠ NO ES EL DE AUTH (${u.uid})` : ''));
  if (p.activo === false) noArranco.sinPrecondicion(
    `usuarios/${idPerfil} tiene \`activo: false\``,
    'el login lo rechaza igual que si no existiera; actívalo antes de mandar el correo');

  // EL PERFIL NO GUARDA `tipo`, Y ESO ES EL DISEÑO, no un campo que se olvidó.
  // Lo dice el propio login (App.jsx:9865): «se decide con los claims del
  // token —el mismo dato que evalúan las reglas— y no con el perfil, que no
  // guarda `tipo`». El `usuario.tipo` que ve la interfaz sale del claim
  // (App.jsx:9931). Así que lo que hay que medir es el CLAIM, y lo que de ahí
  // se sigue es qué botón de PDF le va a aparecer.
  console.log('');
  console.log(`  el perfil no guarda \`tipo\`: por diseño. Decide el claim, que dice`);
  console.log(`  \`${claims.tipo}\` → esDependencia = ${claims.tipo === 'dependencia'}`);
  console.log(`  papelDeLaObra  →  ${claims.tipo === 'dependencia' ? 'art73' : 'interno'}` +
    (claims.tipo === 'dependencia'
      ? '   (el informe del Art. 73, que es el que se lleva)'
      : '   ⚠ LE SALDRÍA EL DOCUMENTO INTERNO, con el margen del contratista'));
  if (claims.tipo !== 'dependencia') noArranco.sinPrecondicion(
    `el claim \`tipo\` dice \`${claims.tipo}\` y no \`dependencia\``,
    'con ese claim la sesión ve la interfaz de constructora: corrígelo antes de mandar el correo');

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('4 · EL CORREO');
  console.log('');

  if (!DESTINO.escribir) {
    console.log(`  no se manda nada. Con \`--escribir\` saldría a ${CORREO}`);
    console.log('  por Firebase Auth (remitente del proyecto, no nuestro Resend).');
    console.log('');
    return;
  }

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: CORREO }) });
  const cuerpo = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg = cuerpo?.error?.message || `HTTP ${r.status}`;
    noArranco.sinPrecondicion(`el proveedor rechazó el envío: ${msg}`,
      msg === 'EMAIL_NOT_FOUND'
        ? 'la cuenta no está en el proyecto al que apunta la clave del front'
        : 'revisa el mensaje del proveedor');
  }

  console.log(`  MANDADO. El proveedor aceptó el envío a ${cuerpo.email || CORREO}.`);
  console.log('');
  console.log('  QUÉ SIGNIFICA ESO Y QUÉ NO:');
  console.log('    · Firebase aceptó el mensaje y lo encoló. Eso es lo medido.');
  console.log('    · Que el buzón `orlando@` exista NO se midió y no se puede');
  console.log('      medir desde aquí. Si no está dado de alta en el proveedor de');
  console.log(`      correo de ${DOMINIO}, el mensaje rebota y nadie ve el enlace.`);
  console.log('    · El enlace caduca (una hora por omisión). Si pasa de ahí, se');
  console.log('      vuelve a correr esto y sale uno nuevo.');
  console.log('    · El remitente es el de Firebase, no `no-reply@cotea.com.mx`:');
  console.log('      puede caer en correo no deseado. Vale revisar esa carpeta.');
  console.log('    · La página donde elige la contraseña es de Firebase');
  console.log(`      (${PROYECTO_DEL_FRONT}.firebaseapp.com), NO es la app. Después`);
  console.log('      de elegirla tiene que entrar por la dirección de siempre.');
  console.log('');
})();
