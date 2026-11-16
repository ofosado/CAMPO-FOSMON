#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL SEGUNDO USUARIO DE LA DEMO: ALGUIEN A QUIEN RENDIRLE (PENDIENTES #69)
// ════════════════════════════════════════════════════════════════════════════
//
// `orgs/coatzacoalcos` quedó sembrada con UN solo usuario, y eso deja la
// rendición del cierre semanal imposible de demostrar: `rendirCierreSemanal`
// avisa al mando de quien cierra y **excluye a quien cerró**. Con un único
// usuario, el único destinatario posible es él mismo, así que la pantalla dice
// «nadie a quien avisar» y la constancia nace vacía. No es un defecto de la
// función: es que la organización de demo no tiene organigrama.
//
// Este guion da de alta al de abajo: un supervisor de obra asignado a UNA obra.
// Al cerrar él la semana, el aviso sube al `director_obras` —Orlando— y queda
// la primera constancia real en `avance/rendiciones`.
//
// LOS CLAIMS NO SE TECLEAN, SE CALCULAN CON EL CÓDIGO DE PRODUCCIÓN.
// `todas` y `obras` los decide `aplicarClaimsUsuario` a partir de
// `ROLES_TODAS_OBRAS`, y la validez del rol la decide `ROLES_POR_TIPO`. Las dos
// tablas se EXTRAEN de `functions/index.js` y se evalúan aquí. Teclear
// `todas: false` sería una segunda copia de una decisión que ya está escrita, y
// se desincronizaría igual que se desincronizó el correo que
// `sembrar-dependencia-demo.cjs` todavía trae a mano
// (`orlando@ayuntamientocoatza.gob`, cuando en producción es `@cotea.com.mx`).
//
// LA CONTRASEÑA NO SE PONE AQUÍ, igual que en la siembra: la identidad en Auth
// se crea sin contraseña y la establece una persona desde la consola de
// Firebase. Este guion no genera, no escribe y no imprime ninguna credencial.
//
// Uso:
//   gcloud auth application-default login
//   export NODE_PATH="$PWD/functions/node_modules"
//   node scripts/alta-supervisor-demo.cjs --prod              (ensayo)
//   node scripts/alta-supervisor-demo.cjs --prod --escribir   (aplica)
//
// Idempotente: lo que ya exista no se vuelve a escribir, y se dice cuál.

'use strict';

// El portón va PRIMERO, antes de `require("firebase-admin")`.
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({
  escribe: 'crea el supervisor de obra de la demo en orgs/coatzacoalcos',
});
const ESCRIBIR = DESTINO.escribir;

const path = require('path');
const admin = require('firebase-admin');
const { fuenteDe } = require('./extraer-de-app.cjs');

// ── LO QUE SE VA A DAR DE ALTA ──────────────────────────────────────────────

const ORG_ID = 'coatzacoalcos';
const USUARIO = {
  correo: 'supervisor@cotea.com.mx',
  nombre: 'Supervisor de Obra — Dirección de Obras Públicas',
  rol: 'supervisor_obra',
  obras: ['0128'],   // SIOP COLECTOR MALECON PENTAGONO 0926
};

// ── LAS TABLAS SALEN DEL CÓDIGO DE PRODUCCIÓN ───────────────────────────────

const raiz = path.join(__dirname, '..');
const ARCH_FUNCS = process.env.ARCHIVO_FUNCS || path.join(raiz, 'functions/index.js');
const PEDIDOS = ['ROLES_TODAS_OBRAS', 'ROLES_POR_TIPO'];

let tablas;
try {
  const { cuerpo } = fuenteDe(ARCH_FUNCS, PEDIDOS);
  tablas = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
} catch (e) {
  console.error(`No se pudieron leer las tablas de roles de ${ARCH_FUNCS}: ${e.message}`);
  console.error('Sin ellas este guion tendría que teclear los claims, y eso es lo que no hace.');
  process.exit(2);
}

const idDeCorreo = c => c.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

// ── ARRANQUE ────────────────────────────────────────────────────────────────

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: DESTINO.projectId,
  });
} catch (e) {
  console.error(`No se pudo inicializar el Admin SDK: ${e.message}`);
  console.error('¿Corriste `gcloud auth application-default login`?');
  process.exit(2);
}

const db = admin.firestore();
const auth = admin.auth();

const hechas = [];
async function poner(ruta, datos, { nota = '' } = {}) {
  hechas.push(ruta);
  console.log(`  ${ESCRIBIR ? 'ESCRIBE' : 'escribiría'}  ${ruta}${nota ? `   ← ${nota}` : ''}`);
  if (ESCRIBIR) await db.doc(ruta).set(datos, { merge: true });
}

(async () => {
  // ── a) LA ORGANIZACIÓN TIENE QUE ESTAR, Y SER DEL TIPO QUE DIGO ───────────
  //
  // No la crea: si no está, lo que falta es correr la siembra, no inventar la
  // org aquí por segunda vez.
  console.log('a) LA ORGANIZACIÓN (no se crea, se comprueba)');
  const orgSnap = await db.doc(`orgs/${ORG_ID}`).get();
  if (!orgSnap.exists) {
    console.error(`\n  orgs/${ORG_ID} no existe. Corre primero ` +
                  '`scripts/sembrar-dependencia-demo.cjs`.');
    process.exit(2);
  }
  const org = orgSnap.data() || {};
  const tipo = org.tipo || null;
  console.log(`  orgs/${ORG_ID}  «${org.nombre}»  tipo ${tipo}  activa=${org.activa !== false}`);
  if (org.activa === false) {
    console.error('\n  La org está inactiva: `aplicarClaimsUsuario` devolvería ' +
                  '`org_inactiva` y el usuario nacería sin poder entrar. Abortado.');
    process.exit(2);
  }

  // El rol se valida con la tabla de producción, no con mi memoria.
  const rolesDelTipo = tablas.ROLES_POR_TIPO[tipo] || [];
  if (!rolesDelTipo.includes(USUARIO.rol)) {
    console.error(`\n  El rol «${USUARIO.rol}» no pertenece al tipo «${tipo}» según ` +
                  'ROLES_POR_TIPO en functions/index.js.');
    console.error(`  Los de ese tipo son: ${rolesDelTipo.join(', ')}`);
    console.error('  El disparador `sincronizarClaims` rechazaría el perfil con ' +
                  '`rol_no_pertenece_tipo`. Abortado.');
    process.exit(2);
  }
  console.log(`  el rol «${USUARIO.rol}» es válido para tipo «${tipo}» (ROLES_POR_TIPO)`);

  // ── b) LA OBRA ASIGNADA TIENE QUE EXISTIR ────────────────────────────────
  //
  // Un `obras_asignadas` con una clave que no existe no da ningún error: da una
  // cuenta de demo que entra y no ve nada, que es peor de diagnosticar.
  console.log('\nb) LA OBRA ASIGNADA');
  for (const id of USUARIO.obras) {
    const s = await db.doc(`orgs/${ORG_ID}/obras/${id}`).get();
    if (!s.exists) {
      console.error(`\n  orgs/${ORG_ID}/obras/${id} no existe. El usuario entraría ` +
                    'sin ver ninguna obra. Abortado.');
      process.exit(2);
    }
    console.log(`  orgs/${ORG_ID}/obras/${id}  «${(s.data() || {}).nombre}»`);
  }

  // ── c) LA IDENTIDAD ──────────────────────────────────────────────────────
  console.log('\nc) LA IDENTIDAD EN AUTH');
  let uid = null;
  try {
    const u = await auth.getUserByEmail(USUARIO.correo);
    uid = u.uid;
    console.log(`  ya existe en Auth  ${USUARIO.correo}  uid=${uid} — no se toca`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    console.log(`  ${ESCRIBIR ? 'CREA' : 'crearía'}  Auth  ${USUARIO.correo}  ` +
                '← SIN contraseña: la establece una persona desde la consola');
    if (ESCRIBIR) {
      const u = await auth.createUser({
        email: USUARIO.correo,
        displayName: USUARIO.nombre,
        emailVerified: false,
      });
      uid = u.uid;
      console.log(`         uid=${uid}`);
    }
  }

  // ── d) LOS CLAIMS, CALCULADOS COMO LOS CALCULA PRODUCCIÓN ────────────────
  //
  // Misma expresión que `aplicarClaimsUsuario`: `todas` sale de la tabla, y las
  // obras sólo viajan en el claim cuando `todas` es falso. Se aplican además
  // explícitamente para no depender de que `sincronizarClaims` haya corrido
  // antes de que alguien intente entrar.
  console.log('\nd) LOS CLAIMS');
  const todas = tablas.ROLES_TODAS_OBRAS.has(USUARIO.rol);
  const claims = {
    rol: USUARIO.rol, orgId: ORG_ID, tipo,
    todas,
    obras: todas ? [] : USUARIO.obras.map(String),
  };
  console.log(`  todas=${todas}  ← ROLES_TODAS_OBRAS.has('${USUARIO.rol}')`);
  console.log(`  ${ESCRIBIR ? 'APLICA' : 'aplicaría'}  ${JSON.stringify(claims)}`);
  if (ESCRIBIR && uid) await auth.setCustomUserClaims(uid, claims);

  // ── e) EL PERFIL ─────────────────────────────────────────────────────────
  console.log('\ne) EL PERFIL');
  const docId = idDeCorreo(USUARIO.correo);
  const previo = await db.doc(`usuarios/${docId}`).get();
  if (previo.exists) {
    const d = previo.data() || {};
    console.log(`  ya existe  usuarios/${docId}  (rol ${d.rol}, org ${d.orgId}, ` +
                `obras ${JSON.stringify(d.obras_asignadas || [])})`);
  }
  await poner(`usuarios/${docId}`, {
    nombre: USUARIO.nombre, correo: USUARIO.correo, email: USUARIO.correo,
    rol: USUARIO.rol, activo: true, orgId: ORG_ID,
    obras_asignadas: USUARIO.obras.map(String), bienvenidaVista: false,
    ...(uid ? { uid } : {}),
  }, { nota: 'esto dispara `sincronizarClaims`, que recalcula los claims igual' });

  console.log(`\n${ESCRIBIR ? 'Escritas' : 'Se escribirían'} ${hechas.length} ruta(s).`);
  if (!ESCRIBIR) console.log('Ensayo: no se tocó nada. Agrega `--escribir` para aplicar.');
  else console.log('Falta lo que este guion NO hace: la contraseña, desde la consola ' +
                   'de Firebase, por una persona.');
  process.exit(0);
})().catch(e => {
  console.error(`\nFALLÓ: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
