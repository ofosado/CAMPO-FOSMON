#!/usr/bin/env node
// Prueba de INTEGRACIÓN: la bitácora de un cliente no es dato de otro cliente,
// y dejar constancia de un rechazo no puede rechazarse por el mismo motivo.
//
// ── QUÉ SE ENCONTRÓ (2026-10-22) ───────────────────────────────────────────
//
// `match /auditoria/{id}` vivía en la RAÍZ con
// `allow read: if esDirectivoC() || esDirectivoD()`. Ninguno de los dos
// ayudantes mira `orgId()` y la regla no miraba el documento, así que la
// frontera entre inquilinos sencillamente no estaba. Medido con el motor de
// reglas contra el ruleset PUBLICADO: las cuatro lecturas cruzadas —municipio
// A leyendo la constructora, municipio A leyendo al municipio B, y la
// constructora leyendo al municipio A— salieron ALLOW.
//
// No era un registro de metadatos. De las 4200 filas que hay en producción,
// 2212 llevan dentro de `antes`/`despues` las claves `monto` (1689), `pu`
// (201), `pctRetencion` y `pctAnticipo` (54), `importeContrato` y
// `totalNomina` (248): es la economía del contratista con su valor anterior y
// el nuevo. El P5 —una dependencia nunca lee la economía del contratista—
// roto un nivel por debajo de la pantalla, donde nadie lo estaba mirando.
//
// No ha filtrado porque el inquilino capaz de leer todavía no existe: los 14
// usuarios de Auth de producción son de constructora y sólo hay una
// organización. Es el mismo perfil que el #66: late, y muerde el día de la
// demo. Por eso el #73 cierra ANTES de que el #69 dé de alta esa cuenta.
//
// ── POR QUÉ SE PARTIÓ Y NO SE ACOTÓ ────────────────────────────────────────
//
// Acotar habría sido `resource.data.orgId == orgId()`. Ninguna de las 4200
// filas trae `orgId`, el documento lo redacta el cliente, y todo lo demás de
// dependencia ya vive bajo `/orgs/{oid}/`. Un campo mal puesto filtra; una
// ruta mal puesta no existe. §1 y §2 miden la partición.
//
// ── Y LA PIEZA QUE NO SE PODÍA PERDER EN EL CAMINO ─────────────────────────
//
// El create de la bitácora es deliberadamente ancho: no mira la obra ni el
// rol, sólo la organización. Es lo que permite registrar un rechazo de
// permisos sin que el registro lo rechace la misma condición que acaba de
// rechazar la escritura. Si al apretar la frontera se hubiera apretado
// también el create, el rastro de permisos denegados —lo que se va a escribir
// encima de esto— nacería muerto. §3 lo afirma en los dos tipos de
// organización.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-frontera-de-la-bitacora.cjs
//   node scripts/prueba-frontera-de-la-bitacora.cjs --contraprueba

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const ARCH_REGLAS = process.env.ARCH_REGLAS || path.join(raiz, 'firestore.rules');

// ── La contraprueba ────────────────────────────────────────────────────────
// Cuatro mutaciones, una por defensa y separadas a propósito: si fueran una
// sola bastaría con que la prueba viera la primera para salir en rojo, y las
// otras tres se irían en verde sin que nadie las mida.
//
// La primera es literalmente la regla que estaba publicada hasta hoy: si esta
// prueba no la viera, no estaría midiendo el defecto que dice haber cerrado.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    { nombre: 'la raíz vuelve a dejar leer a cualquier directivo de dependencia',
      de: `      allow read:   if esDirectivoC();`,
      a:  `      allow read:   if esDirectivoC() || esDirectivoD();` },
    { nombre: 'la bitácora de una org se lee desde otra org',
      de: `      allow read:   if oid == orgId() && esDirectivoD();`,
      a:  `      allow read:   if esDirectivoD();` },
    // Esta mutación conserva `|| esSoporte()` a propósito. Quitándolo entero
    // también falla la SIEMBRA —que la hace soporte— y la prueba sale en NO
    // ARRANCÓ (2) en vez de en ROJO (1): se vería «la prueba se cayó», no «la
    // defensa desapareció». Lo que se quiere medir es lo segundo, así que la
    // mutación apunta sólo a la rama del miembro de la organización.
    { nombre: 'dejar constancia exige los mismos permisos que acaban de negar',
      de: `      allow create: if (oid == orgId() && esAuth()) || esSoporte();`,
      a:  `      allow create: if (oid == orgId() && esDirectivoD()) || esSoporte();` },
    { nombre: 'la bitácora deja de ser append-only',
      de: `      allow create: if (oid == orgId() && esAuth()) || esSoporte();\n      allow update, delete: if false;`,
      a:  `      allow create: if (oid == orgId() && esAuth()) || esSoporte();\n      allow update, delete: if oid == orgId() && esDirectivoD();` },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(ARCH_REGLAS, 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log('             el texto a mutar ya no está en firestore.rules.');
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `bitacora-mut-${Date.now()}.rules`);
    fs.writeFileSync(roto, base.replace(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_REGLAS: roto } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      if (r.status === 2) console.log((r.stdout + r.stderr).split('\n').slice(0, 12).map(l => '             ' + l).join('\n'));
    } else {
      for (const l of r.stdout.match(/^FALLA.*/gm) || []) console.log(`             ${l.replace(/^FALLA\s+/, '· ')}`);
    }
    fs.unlinkSync(roto);
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven. La prueba mide lo que dice medir.`
    : `\n${malas} mutación(es) pasaron inadvertidas.`);
  process.exit(malas > 0 ? 1 : 0);
}

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc,
        deleteDoc, collection, addDoc } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const { cargarReglas: cargarRulesetEnEmulador } = require('./reglas-del-repo.cjs');
const { limpiarDatos } = require('./emulador-limpio.cjs');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
// Se mira `code` y no el texto: el emulador deniega con `false for 'get' @ L225`,
// que no dice «permission».
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied|false for/i.test(e?.message || '');

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenDe = (uid, claims) => {
  const ahora = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({ iss: `prueba@${PROYECTO}.iam.gserviceaccount.com`,
          sub: `prueba@${PROYECTO}.iam.gserviceaccount.com`,
          aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
          iat: ahora, exp: ahora + 3600, uid, claims }),
    '',
  ].join('.');
};

// Una fila como las de producción: con la economía dentro, que es lo que hace
// que esto importe. Si el `antes`/`despues` fuera un metadato inocuo, la fuga
// sería un detalle de higiene.
const FILA = (usuario, obra) => ({
  tipo: 'editar', usuario, nombre: 'Quien sea', rol: 'administrador_obra',
  obraId: obra, obraNombre: `Obra ${obra}`, modulo: 'subcontratos',
  entidad: '1 subcontratos', path: `obras/${obra}/subcontratos/lista`,
  ts: new Date().toISOString(), userAgent: 'prueba',
  antes: { monto: 1200000, pu: 345.5, pctRetencion: 5, pctAnticipo: 30 },
  despues: { monto: 1850000, pu: 402.1, pctRetencion: 5, pctAnticipo: 30 },
});

(async () => {
  console.log('\n── LA BITÁCORA DE UN CLIENTE NO ES DATO DE OTRO CLIENTE ────────\n');

  // P7 — los documentos también se heredan. Antes de la primera sesión y
  // antes de la primera aserción: este banco empieza sobre un Firestore
  // vacío, no sobre lo que le dejó el que corrió antes. Si no puede limpiar,
  // no arranca (2); ver `emulador-limpio.cjs`.
  await limpiarDatos({ proyecto: PROYECTO, host: HOST, puerto: PUERTO });

  await cargarRulesetEnEmulador({ proyecto: PROYECTO, host: HOST, puerto: PUERTO, archivo: ARCH_REGLAS })
    .catch(e => {
      noArranco(`no se pudo hablar con el emulador de Firestore en ${HOST}:${PUERTO} — ${e.message}\n` +
        '  firebase emulators:start --only firestore,auth --project campo-fosmon-prueba');
    });

  const abrir = async (nombre, uid, claims) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, `${nombre}-${Date.now()}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    try { await signInWithCustomToken(auth, tokenDe(uid, claims)); }
    catch (e) { noArranco(`el emulador de Auth no aceptó el token — ${e.message}`); }
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  const ORG_C = 'fosmon', ORG_A = 'coatzacoalcos', ORG_B = 'veracruz';
  const OBRA_A = 'OP-2026-001';

  const DEP = (rol, org, extra = {}) =>
    ({ rol, orgId: org, tipo: 'dependencia', todas: true, obras: [], ...extra });
  const CON = (rol, extra = {}) =>
    ({ rol, orgId: ORG_C, tipo: 'constructora', todas: true, obras: [], ...extra });

  // La siembra la hace soporte, que es quien puede escribir en las tres
  // bitácoras: así no depende de la regla que se está midiendo.
  const dbSop = await abrir('sop', 'u-sop', { rol: 'soporte', orgId: null, tipo: null, todas: false, obras: [] });
  try {
    await setDoc(doc(dbSop, 'auditoria', 'fila-c'), FILA('residente@fosmon.com.mx', '0127'));
    await setDoc(doc(dbSop, 'orgs', ORG_A, 'auditoria', 'fila-a'), FILA('super@coatza.gob.mx', OBRA_A));
    await setDoc(doc(dbSop, 'orgs', ORG_B, 'auditoria', 'fila-b'), FILA('super@veracruz.gob.mx', 'OP-2026-999'));
  } catch (e) {
    // Precondición, no símbolo renombrado: sin las tres filas sembradas no hay
    // nada que intentar leer y las aserciones de §1 medirían el vacío.
    noArranco.sinPrecondicion(
      `soporte no pudo sembrar las tres bitácoras — ${e.message}`,
      ['Soporte escribe en las tres a propósito: es el único que cruza, y así',
       'la siembra no depende de la misma regla que la prueba está midiendo.']);
  }

  const dbDirA = await abrir('dira', 'u-dir-a', DEP('director_obras', ORG_A));
  const dbDirB = await abrir('dirb', 'u-dir-b', DEP('director_obras', ORG_B));
  const dbContralorA = await abrir('conta', 'u-cont-a', DEP('contralor', ORG_A));
  const dbDirC = await abrir('dirc', 'u-dir-c', CON('director_general'));
  const dbAuditorC = await abrir('audc', 'u-aud-c', CON('auditor', { todas: false, obras: ['0127'] }));

  const leer = async (db, ...ruta) => {
    try { return { snap: await getDoc(doc(db, ...ruta)), err: null }; }
    catch (e) { return { snap: null, err: e }; }
  };

  // ═══ §1 · NADIE LEE LA BITÁCORA DE OTRO INQUILINO ═════════════════════════
  console.log('§1 · nadie lee la bitácora de otro inquilino');

  let r = await leer(dbDirA, 'auditoria', 'fila-c');
  check(denegado(r.err),
    'el director de Obras del municipio A NO lee la bitácora de la CONSTRUCTORA',
    r.err ? 'denegado' : `LA LEYÓ — monto ${r.snap.data().despues.monto}`);

  r = await leer(dbDirA, 'orgs', ORG_B, 'auditoria', 'fila-b');
  check(denegado(r.err),
    'ni la del municipio B',
    r.err ? 'denegado' : `LA LEYÓ — pu ${r.snap.data().despues.pu}`);

  r = await leer(dbContralorA, 'orgs', ORG_B, 'auditoria', 'fila-b');
  check(denegado(r.err),
    'y el contralor del A tampoco, que es el rol de fiscalización y el que más tienta',
    r.err ? 'denegado' : 'LA LEYÓ');

  r = await leer(dbDirC, 'orgs', ORG_A, 'auditoria', 'fila-a');
  check(denegado(r.err),
    'la frontera corre en los dos sentidos: la constructora no lee la del municipio A',
    r.err ? 'denegado' : 'LA LEYÓ');

  r = await leer(dbAuditorC, 'auditoria', 'fila-c');
  check(denegado(r.err),
    'y el auditor de la constructora no lee ni la de su propia organización',
    r.err ? 'denegado' : `LA LEYÓ — pctRetencion ${r.snap.data().despues.pctRetencion}`);

  // Lo que SÍ tiene que seguir pasando. Sin esto la frontera podría ser una
  // pared ciega y la prueba no lo notaría.
  r = await leer(dbDirA, 'orgs', ORG_A, 'auditoria', 'fila-a');
  check(!r.err && r.snap.exists(),
    'cada quien sí lee la suya: el director del A lee la bitácora del A',
    r.err ? `DENEGADO: ${r.err.code || r.err.message}` : 'la lee');

  r = await leer(dbDirB, 'orgs', ORG_B, 'auditoria', 'fila-b');
  check(!r.err && r.snap.exists(),
    'y el del B la del B',
    r.err ? `DENEGADO: ${r.err.code || r.err.message}` : 'la lee');

  r = await leer(dbDirC, 'auditoria', 'fila-c');
  check(!r.err && r.snap.exists(),
    'y la constructora la raíz, que es donde están las 4200 filas de hoy',
    r.err ? `DENEGADO: ${r.err.code || r.err.message}` : 'la lee');

  // ═══ §2 · Y TAMPOCO SE ESCRIBE EN LA AJENA ════════════════════════════════
  // Una bitácora en la que cualquiera puede plantar renglones no sirve para
  // resolver una controversia, que es para lo que existe.
  console.log('\n§2 · ni escribe en la ajena');

  const crear = async (db, ...ruta) => {
    try { await addDoc(collection(db, ...ruta), FILA('intruso@x.mx', 'X')); return null; }
    catch (e) { return e; }
  };

  let err = await crear(dbDirA, 'orgs', ORG_B, 'auditoria');
  check(denegado(err), 'el municipio A no planta un renglón en la bitácora del B',
    err ? 'denegado' : 'LO PLANTÓ');

  err = await crear(dbDirA, 'auditoria');
  check(denegado(err), 'ni en la de la constructora',
    err ? 'denegado' : 'LO PLANTÓ');

  err = await crear(dbDirC, 'orgs', ORG_A, 'auditoria');
  check(denegado(err), 'ni la constructora en la del municipio A',
    err ? 'denegado' : 'LO PLANTÓ');

  // ═══ §3 · DEJAR CONSTANCIA NO DEPENDE DE LO QUE ACABAN DE NEGAR ═══════════
  // La circularidad, y es la razón por la que el create es ancho a propósito.
  // Si registrar «me negaron esto» exigiera el permiso que acaban de negar,
  // el defecto sólo quedaría en la consola del teléfono de un supervisor.
  console.log('\n§3 · a quien le niegan una escritura, le queda dónde dejar constancia');

  const dbSupSinObra = await abrir('supA', 'u-sup-a',
    DEP('supervisor_obra', ORG_A, { todas: false, obras: ['OTRA-OBRA'] }));

  err = null;
  try {
    await setDoc(doc(dbSupSinObra, 'orgs', ORG_A, 'obras', OBRA_A, 'evidencia', 'foto1'),
      { url: 'x', semana: 'Y2026-S43', capturadoPor: 'super@coatza.gob.mx' });
  } catch (e) { err = e; }
  check(denegado(err),
    'a un supervisor sin esa obra asignada se le niega la evidencia — el caso que motiva todo',
    err ? 'denegado' : 'LA SUBIÓ');

  err = await crear(dbSupSinObra, 'orgs', ORG_A, 'auditoria');
  check(!err,
    'y aun así deja constancia de la negación en la bitácora de SU organización',
    err ? `DENEGADO TAMBIÉN: ${err.code || err.message} — el defecto se registraría sólo en su teléfono` : 'queda constancia');

  const dbResSinObra = await abrir('resC', 'u-res-c',
    CON('residente', { todas: false, obras: ['0199'] }));

  err = null;
  try {
    await setDoc(doc(dbResSinObra, 'obras', '0127', 'evidencia', 'foto1'),
      { url: 'x', semana: 'Y2026-S43', capturadoPor: 'res@fosmon.com.mx' });
  } catch (e) { err = e; }
  check(denegado(err),
    'lo mismo del lado de la constructora: sin la obra asignada, la foto rebota',
    err ? 'denegado' : 'LA SUBIÓ');

  err = await crear(dbResSinObra, 'auditoria');
  check(!err,
    'y también le queda dónde dejarlo dicho',
    err ? `DENEGADO TAMBIÉN: ${err.code || err.message}` : 'queda constancia');

  // ═══ §4 · APPEND-ONLY ═════════════════════════════════════════════════════
  // Una bitácora que se puede corregir no resuelve ninguna controversia.
  console.log('\n§4 · lo escrito no se corrige ni se borra');

  err = null;
  try { await updateDoc(doc(dbDirA, 'orgs', ORG_A, 'auditoria', 'fila-a'), { tipo: 'otra cosa' }); }
  catch (e) { err = e; }
  check(denegado(err), 'el director del A no corrige un renglón de su propia bitácora',
    err ? 'denegado' : 'LO CORRIGIÓ');

  err = null;
  try { await deleteDoc(doc(dbDirA, 'orgs', ORG_A, 'auditoria', 'fila-a')); }
  catch (e) { err = e; }
  check(denegado(err), 'ni lo borra', err ? 'denegado' : 'LO BORRÓ');

  err = null;
  try { await deleteDoc(doc(dbDirC, 'auditoria', 'fila-c')); }
  catch (e) { err = e; }
  check(denegado(err), 'ni el director general de la constructora en la raíz',
    err ? 'denegado' : 'LO BORRÓ');

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0
    ? 'cada organización tiene su bitácora, y dejar constancia no depende de lo que se negó'
    : `${fallas} falla(s)`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.message ? e.message : e);
  process.exit(2);
});
