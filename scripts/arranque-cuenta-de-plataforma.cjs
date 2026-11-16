#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL ARRANQUE DE LA CUENTA DE PLATAFORMA (PENDIENTES #147)
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE ESTE GUION, Y POR QUÉ NO DEBERÍA CORRERSE DOS VECES.
//
// `PantallaPlataforma` (src/App.jsx) da de alta clientes sin consola: crear la
// organización y su primer usuario, dos actos y nada más. Está construida, las
// callables existen y las reglas ya admiten a `soporte`. Lo único que faltaba
// era que hubiera UN usuario con ese rol, y medido el 2026-11-16 en producción
// no había ninguno: la pantalla escrita para que un cliente nuevo no cueste una
// sesión de consola no la podía abrir nadie, así que cada cliente nuevo costaba
// una sesión de consola.
//
// No se podía dar de alta desde la app por diseño: `exigirPuedeOtorgarRol`
// (functions/index.js) sólo deja otorgar un rol cross a quien ya lo tiene. Eso
// es correcto —si cualquier admin de una organización pudiera otorgar
// `soporte`, el aislamiento entre clientes lo decidiría el admin del cliente
// más descuidado— y tiene como consecuencia que el PRIMERO nazca por fuera.
// Este guion es ese «por fuera», una vez.
//
// SE NIEGA A SER LA PUERTA DE ATRÁS. Si ya existe un usuario con rol `soporte`,
// este guion NO crea otro: sale 2 y manda a la pantalla. Un guion de Admin SDK
// que otorgue el rol más privilegiado de la plataforma cada vez que se le
// invoque es una segunda forma de conceder plataforma, viviendo fuera de la
// bitácora y fuera de las reglas. La primera cuenta no se puede evitar; la
// segunda sí, y se evita aquí.
//
// LO QUE ESTA CUENTA PUEDE Y LO QUE NO. Puede crear organizaciones y usuarios
// en cualquier cliente. NO lee operación: `esConstructora()` y `esDependencia()`
// son falsas para `soporte` en firestore.rules, y de ellas cuelga todo lo
// operativo —avance, montos, evidencia, bitácora de los clientes—. Pero sí
// puede crearse un usuario dentro de un cliente y entrar con él, así que es la
// llave de la casa y conviene que sea de una persona, no compartida.
//
// LA CONTRASEÑA NO SE PONE AQUÍ. La identidad en Auth se crea sin contraseña.
// La teclea una persona con:
//     node scripts/ponle-contrasena-a-la-cuenta-de-demo.cjs \
//          --prod --escribir --correo=soporte@cotea.com.mx
// (ese guion exige `tipo: dependencia` para las cuentas de demo; para ésta hay
// que mirar su guarda antes de correrlo — ver el aviso que imprime al final).
//
// Uso:
//   gcloud auth application-default login
//   export NODE_PATH="$PWD/functions/node_modules"
//   node scripts/arranque-cuenta-de-plataforma.cjs --prod              (ensayo)
//   node scripts/arranque-cuenta-de-plataforma.cjs --prod --escribir   (aplica)

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({
  escribe: 'crea la PRIMERA cuenta con rol `soporte` — la llave de la plataforma',
});
const ESCRIBIR = DESTINO.escribir;

const path = require('path');
const admin = require('firebase-admin');
const { fuenteDe } = require('./extraer-de-app.cjs');

const USUARIO = {
  correo: 'soporte@cotea.com.mx',
  nombre: 'Soporte cotea',
  rol: 'soporte',
};

// ── EL ROL CROSS SE LE PREGUNTA AL CÓDIGO ───────────────────────────────────
//
// Que `soporte` sea cross, y que por tanto sus claims lleven `orgId: null`, no
// se teclea: lo dice `ROLES_CROSS` en producción. Si alguien lo saca de esa
// lista, este guion deja de arrancar en vez de escribir una cuenta cuyo claim
// el login rechazaría.
const raiz = path.join(__dirname, '..');
const ARCH_FUNCS = process.env.ARCHIVO_FUNCS || path.join(raiz, 'functions/index.js');
const PEDIDOS = ['ROLES_CROSS', 'ROLES_VALIDOS', 'ROLES_TODAS_OBRAS'];

let tablas;
try {
  const { cuerpo } = fuenteDe(ARCH_FUNCS, PEDIDOS);
  tablas = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
} catch (e) {
  console.error(`No se pudieron leer las tablas de roles de ${ARCH_FUNCS}: ${e.message}`);
  process.exit(2);
}

if (!tablas.ROLES_VALIDOS.includes(USUARIO.rol)) {
  console.error(`\n«${USUARIO.rol}» no está en ROLES_VALIDOS: el disparador ` +
                '`sincronizarClaims` rechazaría el perfil con `rol_invalido`.');
  process.exit(2);
}
if (!tablas.ROLES_CROSS.includes(USUARIO.rol)) {
  console.error(`\n«${USUARIO.rol}» ya no está en ROLES_CROSS. Este guion existe para ` +
                'crear una cuenta de PLATAFORMA; con un rol que no cruza organizaciones\n' +
                'lo que crearía es un usuario de ningún cliente, que no puede entrar.');
  process.exit(2);
}

const idDeCorreo = c => c.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

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

(async () => {
  const docId = idDeCorreo(USUARIO.correo);

  // ── a) ¿YA HAY UNA LLAVE? ────────────────────────────────────────────────
  //
  // El padrón se consulta por ROL, no por este correo: lo que hace falta saber
  // no es si existe ESTA cuenta, sino si la plataforma ya tiene quien la
  // administre. Si la tiene, la siguiente se da de alta desde la pantalla, que
  // deja fila en la bitácora.
  console.log('a) ¿YA EXISTE UNA CUENTA DE PLATAFORMA?');
  const yaHay = [];
  for (const rol of tablas.ROLES_CROSS) {
    const s = await db.collection('usuarios').where('rol', '==', rol).get();
    s.forEach(d => yaHay.push(`${d.id} (${rol})`));
  }
  if (yaHay.length && !yaHay.every(x => x.startsWith(`${docId} `))) {
    console.error(`\n  Ya hay cuenta(s) de plataforma: ${yaHay.join(', ')}`);
    console.error('\n  Este guion es el ARRANQUE, no una forma de repartir el rol. La');
    console.error('  siguiente se da de alta desde `PantallaPlataforma`, entrando con la');
    console.error('  que ya existe: así queda fila en la bitácora y la decide una sesión,');
    console.error('  no un guion con credenciales de administrador. No se escribió nada.');
    process.exit(2);
  }
  console.log(yaHay.length
    ? `  sólo ${docId}, que es la de este guion — se puede reparar`
    : '  ninguna. Este es el arranque.');

  // ── b) LA IDENTIDAD ──────────────────────────────────────────────────────
  console.log('\nb) LA IDENTIDAD EN AUTH');
  let uid = null;
  try {
    const u = await auth.getUserByEmail(USUARIO.correo);
    uid = u.uid;
    console.log(`  ya existe en Auth  ${USUARIO.correo}  uid=${uid} — no se toca`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    console.log(`  ${ESCRIBIR ? 'CREA' : 'crearía'}  Auth  ${USUARIO.correo}  ` +
                '← SIN contraseña');
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

  // ── c) LOS CLAIMS: `orgId` NULO NO ES UN DESCUIDO, ES EL REQUISITO ───────
  //
  // El login niega la entrada en voz alta a un rol cross que traiga `orgId`
  // (src/App.jsx:10275): «tu cuenta es de soporte pero tiene la organización X
  // asignada». Y tiene razón — una sesión así no sabría si es de plataforma o
  // de ese cliente. Así que esto no es «le falta el orgId»: es que tenerlo
  // sería la inconsistencia.
  console.log('\nc) LOS CLAIMS');
  const claims = {
    rol: USUARIO.rol,
    orgId: null,
    tipo: null,
    todas: tablas.ROLES_TODAS_OBRAS.has(USUARIO.rol),
    obras: [],
  };
  console.log(`  ${ESCRIBIR ? 'APLICA' : 'aplicaría'}  ${JSON.stringify(claims)}`);
  console.log('  `orgId: null` es el requisito del login para una sesión de plataforma,');
  console.log('  no una omisión: con organización asignada, la entrada se niega.');
  if (ESCRIBIR && uid) await auth.setCustomUserClaims(uid, claims);

  // ── d) EL PERFIL ─────────────────────────────────────────────────────────
  //
  // `esPlataforma` (src/App.jsx:9076) decide con `usuario.rol`, que sale de
  // ESTE documento: sin él la sesión entra y pinta el armazón de un cliente.
  // Y `orgId` no se escribe —ni como `null`— porque el perfil de soporte no
  // pertenece a ninguna organización.
  console.log('\nd) EL PERFIL');
  const perfil = {
    nombre: USUARIO.nombre, correo: USUARIO.correo, email: USUARIO.correo,
    rol: USUARIO.rol, activo: true,
    obras_asignadas: [], bienvenidaVista: false,
    ...(uid ? { uid } : {}),
  };
  console.log(`  ${ESCRIBIR ? 'ESCRIBE' : 'escribiría'}  usuarios/${docId}` +
              '   ← sin `orgId`: no pertenece a ningún cliente');
  if (ESCRIBIR) await db.doc(`usuarios/${docId}`).set(perfil, { merge: true });

  // ── e) SE VUELVE A LEER, NO SE CONFIA EN QUE NO LANZÓ ────────────────────
  if (ESCRIBIR) {
    const v = await auth.getUserByEmail(USUARIO.correo);
    const c = v.customClaims || {};
    const p = await db.doc(`usuarios/${docId}`).get();
    console.log('\ne) COMO QUEDÓ');
    console.log(`  claims: ${JSON.stringify(c)}`);
    console.log(`  perfil: rol=${(p.data() || {}).rol}  orgId=${JSON.stringify((p.data() || {}).orgId)}`);
    if (c.rol !== USUARIO.rol || c.orgId) {
      console.error('\n  Los claims no quedaron como se pidieron. El disparador ' +
                    '`sincronizarClaims` pudo haberlos recalculado:\n  revísalo antes de ' +
                    'intentar entrar.');
      process.exit(2);
    }
    console.log('\nLISTA, salvo la contraseña. Lo que sigue:');
    console.log('  1. que una persona le ponga contraseña (este guion no la pone);');
    console.log('  2. entrar por la app: debe salir la pantalla de plataforma, no un');
    console.log('     tablero de obras. Si sale un tablero, el perfil no tiene `rol`.');
    console.log('');
    console.log('AVISO sobre el guion de la contraseña: su guarda exige');
    console.log('`claim tipo == dependencia` —se escribió para las cuentas de demo— y');
    console.log('esta cuenta tiene `tipo: null` a propósito, así que saldrá NO ARRANCÓ.');
    console.log('Eso es la guarda funcionando, no un defecto: hay que enseñarle el caso');
    console.log('de plataforma antes de usarlo aquí.');
  } else {
    console.log('\nEnsayo: no se tocó nada. Agrega `--escribir` para aplicar.');
  }
  process.exit(0);
})().catch(e => {
  console.error(`\nFALLÓ: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
