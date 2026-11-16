#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA CONTRASEÑA DE LA CUENTA DE DEMO, TECLEADA POR UNA PERSONA
// ════════════════════════════════════════════════════════════════════════════
//
// PARA QUÉ. La cuenta `orlando@cotea.com.mx` es para que OSCAR entre y enseñe
// cómo opera cotea del lado de gobierno. Orlando no va a hacer ningún trámite:
// el correo con su nombre es marketing, no un buzón que alguien vaya a abrir.
// Así que hace falta una contraseña que se pueda TECLEAR en la pantalla de
// entrada, y el correo de restablecimiento no sirve para eso — manda el enlace
// a un buzón que probablemente no está dado de alta, y caduca en una hora.
//
// POR QUÉ ASÍ Y NO MÁS FÁCIL. Hay tres formas de poner una contraseña y dos
// dejan rastro permanente:
//
//   · tecleármela en el chat   → queda en la transcripción, para siempre;
//   · escribirla en el guion   → queda en el historial de git, para siempre;
//   · pasarla como argumento   → queda en el historial del shell (~/.zsh_history)
//     o en una variable de entorno → la ve cualquier proceso con `ps -E`.
//
// Las tres son irretirables. Esta es la cuarta: se teclea aquí, con el eco
// apagado, y de este proceso no sale a ningún archivo, ni a la pantalla, ni al
// registro. Nadie más que quien la teclea la conoce.
//
// LA CONSOLA DE FIREBASE NO SIRVE PARA ESTO, y conviene saberlo antes de ir a
// buscar: en Authentication → Users, el menú de una cuenta YA CREADA sólo
// ofrece «Reset password», que es el correo que ya no queremos. Teclear una
// contraseña sólo se puede al CREAR el usuario, y recrearlo cambiaría el uid —y
// con el uid se van los claims (`tipo: dependencia`, `orgId`) y el `uid`
// guardado en el perfil. Esa cuenta tardó tres escrituras en quedar bien.
//
// EL PORTÓN. Esto escribe en Firebase Auth de producción, y los claims de Auth
// no los respalda ni un export de Firestore ni el respaldo que tenemos. Pasa
// por `destino.cjs` como cualquier escritura.
//
// Uso:
//     export NODE_PATH="$PWD/functions/node_modules"
//     node scripts/ponle-contrasena-a-la-cuenta-de-demo.cjs --prod
//         mide la cuenta y NO la toca
//
//     node scripts/ponle-contrasena-a-la-cuenta-de-demo.cjs --prod --escribir
//         pide la contraseña dos veces y la pone
//
//     …  --correo=supervisor@cotea.com.mx
//         la otra cuenta de la org de demo. El correo es un FLAG y no un
//         argumento suelto a propósito: el guardarraíl de abajo rechaza
//         argumentos sueltos porque podrían ser la contraseña, y un correo que
//         quedara en `~/.zsh_history` no hace daño — una contraseña sí.

'use strict';

// El portón ANTES de `firebase-admin`: vive en `functions/node_modules`, y sin
// `NODE_PATH` el require muere. Si el portón fuera después, un destino mal
// puesto se reportaría como un módulo que falta.
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({
  escribe: 'fija la contraseña de la cuenta de demo en Firebase Auth',
});

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const fs = require('fs');

// La org de demo tiene ahora DOS cuentas —`director_obras` y `supervisor_obra`,
// porque sin organigrama la rendición del cierre semanal no tiene destinatario
// y no se puede enseñar—, así que el correo deja de estar clavado. Lo que NO
// cambia es que la contraseña no entra por aquí.
const CORREO = (process.argv.slice(2).find(a => a.startsWith('--correo='))
  || '--correo=orlando@cotea.com.mx').slice('--correo='.length).trim().toLowerCase();
const MINIMO = 6;   // el mínimo que impone Firebase Auth

if (!CORREO.includes('@')) noArranco.sinPrecondicion(
  `\`--correo=${CORREO}\` no parece un correo`,
  'no sigo con un correo a medias: `getUserByEmail` diría «no existe» y eso se ' +
  'lee como que falta sembrar la cuenta, cuando lo que falta es la arroba');

// ── LA CONTRASEÑA NO PUEDE VENIR DE NINGÚN OTRO SITIO ──────────────────────
// Se rechazan de forma explícita las tres vías que dejan rastro. No se
// «ignoran»: quien las usa cree haber pedido algo que va a pasar, y además
// creería que su contraseña quedó puesta cuando lo que quedó fue un rastro.
for (const v of ['PASS', 'PASSWORD', 'CONTRASENA', 'CONTRASEÑA']) {
  if (process.env[v]) noArranco.sinPrecondicion(
    `la contraseña viene en la variable de entorno ${v}`,
    'quítala: una variable de entorno la ve cualquier proceso con `ps -E`. ' +
    'Este guion la pide por teclado a propósito');
}
if (process.argv.slice(2).some(a => !a.startsWith('--'))) noArranco.sinPrecondicion(
  'hay un argumento suelto en la línea de comandos',
  'si es la contraseña, quítala: los argumentos quedan en ~/.zsh_history. ' +
  'Este guion la pide por teclado');

// ── PEDIRLA POR TECLADO, SIN ECO ───────────────────────────────────────────
//
// Se lee de `/dev/tty` y no de `process.stdin` a propósito: si fuera stdin, un
// `echo "secreto" | node …` funcionaría, y eso es exactamente el caso que deja
// la contraseña en el historial del shell. Pidiéndola a la terminal de verdad,
// esa forma no existe: sin terminal el guion se para.
function pedirOculta(rotulo) {
  return new Promise((resolve, reject) => {
    let tty;
    try { tty = fs.openSync('/dev/tty', 'r+'); }
    catch { return reject(new Error('sin terminal')); }

    fs.writeSync(tty, rotulo);
    const entrada = fs.createReadStream('', { fd: tty, autoClose: false });
    entrada.setRawMode?.(true);
    if (entrada.setRawMode) entrada.setRawMode(true);
    else if (process.stdin.isTTY) process.stdin.setRawMode(true);

    let acc = '';
    entrada.on('data', (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          if (entrada.setRawMode) entrada.setRawMode(false);
          fs.writeSync(tty, '\n');
          entrada.pause();
          entrada.removeAllListeners('data');
          return resolve(acc);
        }
        if (ch === '\u0003') {                       // Ctrl-C
          if (entrada.setRawMode) entrada.setRawMode(false);
          fs.writeSync(tty, '\n');
          return reject(new Error('cancelado'));
        }
        if (ch === '\u007f' || ch === '\b') { acc = acc.slice(0, -1); continue; }
        acc += ch;
      }
    });
  });
}

let admin;
try { admin = require('firebase-admin'); }
catch (e) {
  noArranco.sinPrecondicion(`no se pudo cargar firebase-admin: ${e.message}`,
    'export NODE_PATH="$PWD/functions/node_modules"   (vive en functions/, no en la raíz)');
}
admin.initializeApp({ projectId: DESTINO.projectId });
const auth = admin.auth();
const db = admin.firestore();

const idDeCorreo = (c) => String(c || '').toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

// ── QUÉ VA A VER LA SESIÓN, QUE ES LO QUE AQUÍ SE GUARDA ───────────────────
//
// La guarda de abajo exigía `tipo == dependencia` y nada más, porque cuando se
// escribió la única cuenta sin contraseña era la de la demo. Con la cuenta de
// plataforma (#147) eso se volvió falso: `soporte` tiene `tipo: null` **a
// propósito** —el login niega la entrada a un rol cross que traiga `orgId`— y
// la guarda la rechazaba como si el claim estuviera mal puesto.
//
// Lo que hay que seguir impidiendo no cambia: poner contraseña a una cuenta
// cuyo claim la haría ver una interfaz distinta de la que quien teclea cree.
// Así que en vez de comparar con una constante, se CLASIFICA el claim y se
// imprime qué pantalla sale. `ROLES_CROSS` se extrae de producción en vez de
// teclear `'soporte'`: la lista de roles que cruzan organizaciones ya está
// escrita una vez.
const { fuenteDe } = require('./extraer-de-app.cjs');
const ARCH_FUNCS = process.env.ARCHIVO_FUNCS ||
  require('path').join(__dirname, '..', 'functions/index.js');
let ROLES_CROSS;
try {
  const { cuerpo } = fuenteDe(ARCH_FUNCS, ['ROLES_CROSS']);
  ({ ROLES_CROSS } = new Function(`"use strict";\n${cuerpo}\nreturn { ROLES_CROSS };`)());
} catch (e) {
  noArranco.sinPrecondicion(`no se pudo leer ROLES_CROSS de ${ARCH_FUNCS}: ${e.message}`,
    'sin esa lista no se puede distinguir una cuenta de plataforma de un claim roto, ' +
    'y esa distinción es lo que decide si se escribe');
}

// Devuelve `{ pantalla, problema }`. `problema` no nulo es NO ARRANCÓ.
function loQueVeria(claims) {
  const rol = claims.rol;
  if (!rol) return { problema: 'el claim no trae `rol`, así que la sesión no sabría qué es' };
  if (ROLES_CROSS.includes(rol)) {
    // Mismo criterio que src/App.jsx:10275, y por el mismo motivo: una sesión
    // de plataforma con organización asignada no sabría si es de plataforma o
    // de ese cliente, y el login la saca en voz alta.
    if (claims.orgId) return { problema:
      `es un rol de plataforma (\`${rol}\`) pero trae la organización ` +
      `\`${claims.orgId}\`; el login niega la entrada con ese claim` };
    return { pantalla: 'la pantalla de PLATAFORMA — alta de clientes, sin operación' };
  }
  if (claims.tipo === 'dependencia') return { pantalla: 'la interfaz de dependencia → informe del Art. 73' };
  if (claims.tipo === 'constructora') return { problema:
    'es una cuenta de CONSTRUCTORA: vería el documento interno, con el margen ' +
    'del contratista. Si eso es lo que quieres, este guion no es el camino' };
  return { problema: `el claim \`tipo\` dice \`${claims.tipo}\` y no es ni dependencia ` +
    'ni constructora ni plataforma: la sesión no se puede montar' };
}

(async () => {
  // ── LA CUENTA, Y LAS DOS COSAS QUE LA HACEN SERVIR ───────────────────────
  // Se miden siempre, también en el ensayo: poner la contraseña de una cuenta
  // cuyo claim diga otra cosa dejaría a quien la teclea enseñando una interfaz
  // que no es la que cree —en la cita, el margen del contratista.
  let u;
  try { u = await auth.getUserByEmail(CORREO); }
  catch (e) {
    if (e.code === 'auth/user-not-found') noArranco.sinPrecondicion(
      `\`${CORREO}\` no existe en Auth de ${DESTINO.projectId}`,
      'siembra la cuenta primero: scripts/sembrar-dependencia-demo.cjs');
    throw e;
  }
  const claims = u.customClaims || {};
  const yaTienePass = (u.providerData || []).some(p => p.providerId === 'password');
  const idPerfil = idDeCorreo(CORREO);
  const perfil = await db.doc(`usuarios/${idPerfil}`).get();

  console.log('LA CUENTA');
  console.log(`  correo:          ${u.email}`);
  console.log(`  uid:             ${u.uid}`);
  console.log(`  deshabilitada:   ${u.disabled}`);
  console.log(`  ya tiene clave:  ${yaTienePass ? 'SÍ — esto la REEMPLAZA' : 'no'}`);
  const veria = loQueVeria(claims);
  console.log(`  claim rol/tipo:  ${claims.rol} / ${claims.tipo}`);
  console.log(`  claim org:       ${claims.orgId === null ? 'null (ninguna, es de plataforma)' : claims.orgId}`);
  console.log(`  al entrar verá:  ${veria.pantalla || `⚠ ${veria.problema}`}`);
  console.log(`  perfil del login: usuarios/${idPerfil}  ${perfil.exists ? 'existe' : 'NO EXISTE'}`);
  if (perfil.exists) console.log(`  saludo:          «Hola, ` +
    `${String(perfil.data().nombre || '').split(' ').find(p => p.length > 2 && !p.endsWith('.')) || '?'}!»`);
  console.log('');

  if (u.disabled) noArranco.sinPrecondicion('la cuenta está deshabilitada',
    'habilítala: con la contraseña puesta seguiría sin poder entrar');
  if (!perfil.exists) noArranco.sinPrecondicion(`falta usuarios/${idPerfil}`,
    'el login deriva ese id del correo tecleado (App.jsx:10207) y sin el ' +
    'documento cierra la sesión: la contraseña no serviría de nada');
  if (perfil.data().activo === false) noArranco.sinPrecondicion(
    `usuarios/${idPerfil} tiene \`activo: false\``,
    'el login lo rechaza igual que si no existiera');
  if (veria.problema) noArranco.sinPrecondicion(veria.problema,
    'corrige el claim primero: una contraseña puesta sobre un claim así da una ' +
    'cuenta que entra a una pantalla que no es la que esperas, o que no entra');
  // El perfil también tiene que decir el rol: `esPlataforma` (App.jsx:9076)
  // decide con `usuario.rol`, que sale del documento y no del token. Un claim
  // de soporte con un perfil sin rol monta el armazón de un cliente.
  if (perfil.data().rol !== claims.rol) noArranco.sinPrecondicion(
    `el perfil dice rol \`${perfil.data().rol}\` y el token dice \`${claims.rol}\``,
    'la pantalla se elige con el perfil y los permisos con el token: ' +
    'discrepando, la sesión ve una cosa y puede otra');

  if (!DESTINO.escribir) {
    console.log('La cuenta está lista para recibir una contraseña. No se tocó nada.');
    console.log('Con `--escribir` la pide por teclado (sin eco) y la pone.');
    console.log('');
    return;
  }

  // ── LA TECLEA UNA PERSONA ────────────────────────────────────────────────
  console.log('Tecléala dos veces. No se ve al escribir, no se imprime después,');
  console.log('y no se guarda en ningún archivo. Ctrl-C cancela.');
  console.log('');

  let p1, p2;
  try {
    p1 = await pedirOculta(`  contraseña para ${CORREO}: `);
    p2 = await pedirOculta('  otra vez, para confirmar:              ');
  } catch (e) {
    console.log('');
    noArranco.sinPrecondicion(
      e.message === 'cancelado' ? 'cancelado por el usuario' : 'no hay terminal para pedirla',
      'córrelo desde una terminal de verdad: la contraseña no se acepta por ' +
      'tubería ni por argumento, porque esas dos dejan rastro');
  }

  // Los diagnósticos hablan de la LONGITUD, nunca del contenido. Decir «te
  // faltó una mayúscula» ya es filtrar parte de la contraseña al registro.
  if (p1 !== p2) noArranco.sinPrecondicion('las dos no coinciden',
    'vuelve a correrlo; no se intenta adivinar cuál de las dos querías');
  if (p1.length < MINIMO) noArranco.sinPrecondicion(
    `tiene ${p1.length} caracteres y Firebase exige ${MINIMO}`,
    'elige una más larga');

  await auth.updateUser(u.uid, { password: p1 });

  // Se vuelve a leer de Auth en vez de confiar en que `updateUser` no lanzó: lo
  // que se afirma es que el proveedor `password` YA ESTÁ en la cuenta, que es la
  // condición para que la pantalla de entrada funcione.
  const v = await auth.getUserByEmail(CORREO);
  const quedo = (v.providerData || []).some(p => p.providerId === 'password');
  console.log('');
  if (!quedo) noArranco.sinPrecondicion(
    'Auth aceptó el cambio pero la cuenta no quedó con proveedor `password`',
    'vuelve a correrlo; no doy por puesta una contraseña que no se puede ver puesta');

  console.log('LISTA. La cuenta ya tiene contraseña y el proveedor `password`');
  console.log('aparece en Auth. Lo que sigue es entrar por la app con ese correo');
  console.log('y la contraseña que acabas de teclear — este guion no la sabe más.');
  console.log('');
})();
