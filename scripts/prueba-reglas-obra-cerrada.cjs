#!/usr/bin/env node
// Prueba de INTEGRACIÓN: una obra CERRADA no se puede mover.
//
// POR QUÉ EXISTE. Se pidió cerrar una obra con tres propiedades, y la primera
// es «que ya no se pueda mover». Esa propiedad NO la puede sostener la
// pantalla. Un botón que no se pinta no es un candado:
//
//   · la sesión que ya tenía la pestaña abierta sigue teniendo las llaves;
//   · basta mover un `can()` de sitio para que la captura vuelva;
//   · y cualquier guion con las credenciales del usuario escribe directo.
//
// Hay precedente en este mismo archivo de reglas: hasta el 2026-10-07 el único
// candado sobre la captura de estimaciones de dependencia era la interfaz,
// porque `PERMISOS` ya daba el acceso y las reglas usaban un ayudante más
// permisivo que la app. Lo que se decidió entonces vale aquí: manda la regla y
// la interfaz la acompaña.
//
// LO QUE SE AFIRMA, y no se puede deducir LEYENDO las reglas:
//
//   1. Con la obra abierta la captura PASA. Un candado que cierra todo siempre
//      «funciona», así que la línea base va primero o lo demás no significa
//      nada.
//   2. Cerrada, rebota TODA escritura bajo `/obras/{id}` — las rutas no se
//      teclean aquí: se SACAN del archivo de reglas y se prueban una por una.
//      Una ruta nueva entra sola a este banco.
//   3. Queda exactamente una puerta: un directivo mueve el estado, y nada más
//      que el estado. Ni el presupuesto de pasada, ni los permisos, ni borrar
//      la obra, ni corregir la bitácora.
//   4. El candado lee el estado de los DOS documentos y en el mismo orden que
//      la pantalla (`config/info` gana, la raíz respalda). Esto es lo único que
//      impide una obra que en pantalla dice «Cerrada» y cuyas capturas pasan,
//      y es imposible de ver leyendo: hace falta construir los tres estados
//      desparejos y escribir en cada uno.
//   5. Una obra que todavía no tiene `config/info` NO queda bloqueada. Es
//      cómo nace cada obra, y un `get()` de un documento ausente que tumbe la
//      regla rompería el alta entera.
//
// No comprueba que el `match` exista ni que el ayudante se llame como se
// llama: manda operaciones de verdad contra el emulador con las reglas del
// repositorio cargadas.
//
// ── EL RUIDO QUE VA A SALIR EN LA SALIDA, Y POR QUÉ NO ES UN DEFECTO ───────
// Cada rechazo de este banco imprime algo así:
//
//   evaluation error at L393:25 for 'update' @ L393, …, false for 'update' @ L393
//
// `evaluation error` asusta y significa lo contrario de lo que parece: no es
// la regla reventando, es la PRIMERA PASADA del motor. Cuando una regla llama
// a `get()`, el motor evalúa una vez sin los documentos referenciados —y ahí
// el `get` todavía no tiene nada, así que la expresión truena—, los va a
// buscar y vuelve a evaluar. El veredicto que manda es el último, y es el
// `false` del final. Medido variante por variante el 2026-11-10 antes de
// darlo por cierto: con los dos documentos en `activa` la escritura PASA, con
// `config/info` en `cerrada` o `archivada` se NIEGA, y con un valor cualquiera
// vuelve a pasar. O sea que el candado discrimina por estado y no por error.
//
// Lo que de verdad descarta un verde por la razón equivocada es §1: si el
// `get()` estuviera roto, las 21 rutas rebotarían con la obra ABIERTA y la
// línea base saldría roja. Por eso va primero.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-reglas-obra-cerrada.cjs
//
// Contraprueba: la corre sola al final, con rulesets DERIVADOS del archivo
// real. Cada derivación tiene que salir ROJA (código 1).

'use strict';

const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const raiz = path.resolve(__dirname, '..');
const { cargarReglas } = require('./reglas-del-repo.cjs');
const { limpiarDatos } = require('./emulador-limpio.cjs');

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';
const OBRA = '0112';          // el malecón: la obra que se pidió cerrar
const OTRA = '0126';
const NUEVA = '0199';         // la que nace sin `config/info`

const ARCH_REGLAS = path.join(raiz, 'firestore.rules');
const REGLAS_DERIVADAS = process.env.ARCH_REGLAS ? path.resolve(process.env.ARCH_REGLAS) : null;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const intentar = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

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

// ── SEMBRAR EL ESTADO SALTÁNDOSE LAS REGLAS ─────────────────────────────────
// Por la API REST con el token `owner`, que el emulador acepta como el Admin
// SDK: ignora el ruleset. Hace falta porque los tres estados desparejos de §6
// —sólo `config/info` cerrada, sólo la raíz cerrada, las dos en desacuerdo— no
// se pueden construir con las reglas puestas, que es justamente lo que las
// hace interesantes: son estados que nacen de una escritura a medias, no de
// un acto deliberado.
const REST = `http://${HOST}:${PUERTO}/v1/projects/${PROYECTO}/databases/(default)/documents`;
const comoOwner = async (metodo, ruta, cuerpo, mascara = []) => {
  const q = mascara.map(c => `updateMask.fieldPaths=${c}`).join('&');
  const r = await fetch(`${REST}/${ruta}${q ? '?' + q : ''}`, {
    method: metodo,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok && r.status !== 404) {
    noArranco.sinPrecondicion(
      `No se pudo sembrar ${metodo} ${ruta}: HTTP ${r.status}\n${(await r.text()).slice(0, 300)}`);
  }
  return r.status;
};
const cadena = o => ({ fields: Object.fromEntries(
  Object.entries(o).map(([k, v]) => [k, { stringValue: String(v) }])) });

// Pone (o quita) el campo `estado` en cada documento, sin tocar lo demás.
const sembrarEstado = async (obraId, { raizEstado, infoEstado }) => {
  for (const [ruta, valor] of [
    [`obras/${obraId}`, raizEstado],
    [`obras/${obraId}/config/info`, infoEstado],
  ]) {
    if (valor === 'SIN_DOCUMENTO') { await comoOwner('DELETE', ruta); continue; }
    if (valor === undefined) continue;
    if (valor === null) {
      // El documento existe y NO trae `estado`: es la obra legada, la que
      // nunca pasó por un cierre.
      await comoOwner('PATCH', ruta, { fields: {} }, ['estado']);
      continue;
    }
    await comoOwner('PATCH', ruta, cadena({ estado: valor }), ['estado']);
  }
};

// ── LAS RUTAS DE ESCRITURA, SACADAS DEL ARCHIVO DE REGLAS ───────────────────
// No se teclean. Este archivo ya enterró tres veces el mismo defecto —una ruta
// nueva sin regla, cayendo en el `match` final, con la escritura fallando
// callada durante meses (#31, #51, #28)—. Si las rutas se teclearan aquí, la
// ruta número 21 nacería fuera de este banco y el candado tendría un hueco que
// nadie vería. Sacándolas del archivo, una ruta nueva entra sola.
function rutasDelBloqueDeConstructora(src) {
  const i = src.indexOf('match /obras/{obraId} {');
  const j = src.indexOf('match /orgs/{oid}/obras/{obraId} {');
  if (i < 0 || j < 0 || j < i) {
    noArranco.sinPrecondicion(
      'No se encontró el bloque de constructora en firestore.rules: ' +
      'el banco no sabría qué rutas probar.');
  }
  // Sin comentarios: el bloque habla de rutas en prosa —«match /config/programa»,
  // «match /{document=**}»— y un enumerador que las creyera probaría rutas que
  // no existen y, peor, daría por cubiertas las que sí.
  const bloque = src.slice(i, j).replace(/\/\/.*$/gm, '');
  const rutas = [];
  const re = /match \/(\S+) \{/g;
  let m;
  while ((m = re.exec(bloque))) {
    if (m[1] === 'obras/{obraId}') continue;
    rutas.push(m[1]);
  }
  // SUELO, no lista: si el enumerador se rompe, estas tres faltan y el banco
  // no arranca en vez de pasar en verde probando cuatro rutas.
  for (const imprescindible of ['avance/subs', 'config/estimaciones', 'evidencia/{eid}']) {
    if (!rutas.includes(imprescindible)) {
      noArranco.sinPrecondicion(
        `El enumerador de rutas no encontró \`${imprescindible}\`. ` +
        `Sacó ${rutas.length}: ${rutas.join(', ')}`);
    }
  }
  return rutas;
}

// Los comodines se rellenan con un id POR FASE. Si la fase cerrada reusara el
// id de la fase abierta, la escritura sería un `update` y no un `create`, y
// `evidencia/{eid}` la negaría por la regla de la anulación —no por el
// candado—. Saldría verde afirmando otra cosa.
const concretar = (ruta, fase) => ruta.replace(/\{[^}]*\}/g, `sonda-${fase}`);

(async () => {
  await limpiarDatos({ proyecto: PROYECTO, host: HOST, puerto: PUERTO });
  const usado = await cargarReglas({ proyecto: PROYECTO, host: HOST, puerto: PUERTO,
    archivo: REGLAS_DERIVADAS || ARCH_REGLAS });
  console.log(`(reglas cargadas desde ${usado})\n`);

  const abrir = async (nombre, uid, claims) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, nombre);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    await signInWithCustomToken(auth, tokenDe(uid, claims));
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  const sello = Date.now();
  const cons = (rol, obras, todas = false) => ({
    tipo: 'constructora', rol, orgId: 'fosmon', todas, obras });

  let residente, gerente;
  try {
    residente = await abrir(`res-${sello}`, `residente-${OBRA}`, cons('residente', [OBRA]));
    gerente = await abrir(`ger-${sello}`, 'gerente', cons('gerente_construccion', [], true));
  } catch (e) {
    console.error(`\nNo hay emuladores escuchando en ${HOST}:${PUERTO}/${PUERTO_AUTH}.\n` +
      `Arráncalos con:\n  firebase emulators:start --only firestore,auth --project ${PROYECTO}\n\n(${e.message})`);
    process.exit(1);
  }

  // Escribe en una ruta de `/obras/{OBRA}/…` con una sonda inocua. Devuelve el
  // error o `null`. La sonda es un campo propio para que el `merge` no pise
  // datos del documento y para que `affectedKeys()` traiga exactamente un
  // nombre que NO es del estado.
  const sondar = (db, ruta, fase, obraId = OBRA) => intentar(() => setDoc(
    doc(db, ...`obras/${obraId}${ruta ? '/' + concretar(ruta, fase) : ''}`.split('/')),
    { sonda: `${fase}-${sello}` }, { merge: true }));

  const RUTAS = rutasDelBloqueDeConstructora(fs.readFileSync(ARCH_REGLAS, 'utf8'));
  // El documento raíz también se prueba: la cadena vacía es él.
  const TODAS = ['', ...RUTAS];

  // ── 1. LÍNEA BASE: CON LA OBRA ABIERTA SE CAPTURA ───────────────────────
  console.log('1. Con la obra ABIERTA, la captura pasa (si no, lo demás no significa nada)');
  await sembrarEstado(OBRA, { raizEstado: 'activa', infoEstado: 'activa' });
  const abiertas = [];   // las rutas que de verdad admiten escritura
  const negadasSiempre = [];
  for (const ruta of TODAS) {
    const e = await sondar(gerente, ruta, 'abierta');
    (e ? negadasSiempre : abiertas).push(ruta || '(el documento de la obra)');
  }
  check(abiertas.length >= 15,
    `el gerente escribe en ${abiertas.length} de las ${TODAS.length} rutas del bloque`,
    negadasSiempre.length
      ? `negadas con la obra abierta (y por eso fuera de §2): ${negadasSiempre.join(', ')}`
      : 'todas');
  const eRes = await sondar(residente, 'avance/subs', 'abierta-res');
  check(!eRes, 'y el residente asignado captura avance',
    eRes ? `DENEGADA: ${eRes.message}` : 'pasa');

  // ── 2. CERRADA, NO SE MUEVE NADA ────────────────────────────────────────
  // Sin lista de excepciones a propósito: TODA ruta que admitía escritura con
  // la obra abierta tiene que rebotar con la obra cerrada, incluidos los dos
  // documentos del estado. La puerta de §3 no es una ruta, son cuatro campos.
  console.log('\n2. Cerrada, rebota TODA escritura bajo `/obras/0112` — ni el gerente');
  await sembrarEstado(OBRA, { raizEstado: 'cerrada', infoEstado: 'cerrada' });
  const pasaron = [];
  for (const ruta of TODAS) {
    const r = await sondar(gerente, ruta, 'cerrada');
    if (!r) pasaron.push(ruta || '(el documento de la obra)');
  }
  check(pasaron.length === 0,
    `las ${abiertas.length} rutas que admitían escritura ahora rebotan`,
    pasaron.length ? `PASARON: ${pasaron.join(', ')}` : 'ninguna pasó');
  const eRes2 = await sondar(residente, 'avance/subs', 'cerrada-res');
  check(!!eRes2, 'y el residente que capturaba ayer ya no captura',
    eRes2 ? 'rebotó' : 'ESCRIBIÓ — la obra cerrada sigue moviéndose');

  // Archivada es lo mismo. Archivar nunca fue un candado tampoco: sólo sacaba
  // la obra de la lista en siete filtros.
  await sembrarEstado(OBRA, { raizEstado: 'archivada', infoEstado: 'archivada' });
  const eArch = await sondar(gerente, 'avance/subs', 'archivada');
  check(!!eArch, 'una obra ARCHIVADA tampoco se mueve',
    eArch ? 'rebotó' : 'ESCRIBIÓ — archivar sigue siendo sólo un filtro de pantalla');

  // ── 3. LA ÚNICA PUERTA: REABRIR ─────────────────────────────────────────
  console.log('\n3. Queda una puerta: el directivo mueve el estado, y vuelve a entrar');
  await sembrarEstado(OBRA, { raizEstado: 'cerrada', infoEstado: 'cerrada' });
  const estado = (e) => ({ estado: e, estadoDesde: new Date().toISOString(),
    estadoPor: 'gerencia@fosmon.com.mx', estadoPorNombre: 'Ana Rivera' });
  const eInfo = await intentar(() => setDoc(
    doc(gerente, 'obras', OBRA, 'config', 'info'), estado('activa'), { merge: true }));
  const eRaiz = await intentar(() => setDoc(
    doc(gerente, 'obras', OBRA), { id: OBRA, ...estado('activa') }, { merge: true }));
  check(!eInfo && !eRaiz, 'el gerente reabre la obra: los DOS documentos del estado',
    `config/info ${eInfo ? 'DENEGADO: ' + eInfo.message : 'pasa'} · ` +
    `raíz ${eRaiz ? 'DENEGADO: ' + eRaiz.message : 'pasa'}`);
  const eVuelve = await sondar(residente, 'avance/subs', 'reabierta');
  check(!eVuelve, 'y reabierta, el residente vuelve a capturar',
    eVuelve ? `DENEGADA: ${eVuelve.message} — la obra habría quedado cerrada para siempre` : 'pasa');

  // ── 4. LA PUERTA ES ANGOSTA ─────────────────────────────────────────────
  // Acotada por CAMPOS, no por confianza en que quien reabre no toque nada
  // más. Esto es lo que separa «reabrir queda registrado» de «el directivo
  // puede con todo».
  console.log('\n4. Por esa puerta no cabe nada más que el estado');
  await sembrarEstado(OBRA, { raizEstado: 'cerrada', infoEstado: 'cerrada' });
  const eConPolizon = await intentar(() => setDoc(
    doc(gerente, 'obras', OBRA, 'config', 'info'),
    { ...estado('activa'), presupuesto: 999000000 }, { merge: true }));
  check(!!eConPolizon, 'el presupuesto NO se cuela junto con el estado',
    eConPolizon ? 'rebotó' : 'ESCRIBIÓ $999M en una obra cerrada, de pasada');
  const eSoloPpto = await intentar(() => setDoc(
    doc(gerente, 'obras', OBRA, 'config', 'info'),
    { presupuesto: 999000000 }, { merge: true }));
  check(!!eSoloPpto, 'ni solo', eSoloPpto ? 'rebotó' : 'ESCRIBIÓ');
  const ePermisos = await intentar(() => setDoc(
    doc(gerente, 'obras', OBRA, 'config', 'permisos'), { sonda: 1 }, { merge: true }));
  check(!!ePermisos, 'los permisos de una obra cerrada no se reparten',
    ePermisos ? 'rebotó' : 'ESCRIBIÓ');
  // La bitácora de una obra cerrada tampoco se corrige. Se prueba `update` y
  // no `create` porque el `create` ya pasa por el ayudante y lo cubre §2; lo
  // que esta ruta tiene aparte es la corrección, que es facultad de directivo
  // y por eso lleva el candado escrito a mano.
  await comoOwner('PATCH', `obras/${OBRA}/bitacora/renglon-viejo`,
    cadena({ nota: 'se colocó plantilla en el eje 3' }));
  const eBit = await intentar(() => setDoc(
    doc(gerente, 'obras', OBRA, 'bitacora', 'renglon-viejo'),
    { nota: 'otra cosa' }, { merge: true }));
  check(!!eBit, 'y un renglón de la bitácora de una obra cerrada no se corrige',
    eBit ? 'rebotó' : 'REESCRIBIÓ la bitácora de una obra ya cerrada');

  // Borrar es el movimiento más grande de todos.
  const { deleteDoc } = require('firebase/firestore');
  const eBorrar = await intentar(() => deleteDoc(doc(gerente, 'obras', OBRA)));
  check(!!eBorrar, 'y la obra cerrada no se BORRA',
    eBorrar ? 'rebotó' : 'BORRÓ — «ya no se puede mover» con el hueco que importa');

  // ── 5. QUIÉN PUEDE REABRIR ──────────────────────────────────────────────
  // «Sí, directivo y queda registrado» fue la decisión. La mitad de
  // «directivo» se afirma aquí; la de «queda registrado» no la sostiene esta
  // regla sino `fsSetA`, que audita, y la bitácora vive en `/auditoria/{id}`,
  // colección raíz: el candado no la alcanza y el rastro se puede dejar
  // aunque la escritura rebote.
  console.log('\n5. Reabrir es acto de directivo');
  const nadie = [
    ['el residente de la obra', await abrir(`res2-${sello}`, 'res2', cons('residente', [OBRA]))],
    ['el superintendente', await abrir(`sup-${sello}`, 'sup', cons('superintendente', [], true))],
    ['el administrador de obra', await abrir(`ado-${sello}`, 'ado', cons('administrador_obra', [OBRA]))],
    ['el auditor', await abrir(`aud-${sello}`, 'aud', cons('auditor', [OBRA]))],
    ['el cliente', await abrir(`cli-${sello}`, 'cli', cons('cliente', [OBRA]))],
  ];
  for (const [quien, db] of nadie) {
    const eI = await intentar(() => setDoc(
      doc(db, 'obras', OBRA, 'config', 'info'), estado('activa'), { merge: true }));
    const eR = await intentar(() => setDoc(
      doc(db, 'obras', OBRA), { id: OBRA, ...estado('activa') }, { merge: true }));
    check(!!eI && !!eR, `${quien} no reabre la obra`,
      eI && eR ? 'rebotó en los dos documentos'
               : `config/info ${eI ? 'rebotó' : 'ESCRIBIÓ'} · raíz ${eR ? 'rebotó' : 'ESCRIBIÓ'}`);
  }
  const dirGral = await abrir(`dg-${sello}`, 'dg', cons('director_general', [], true));
  const eDirGral = await intentar(() => setDoc(
    doc(dirGral, 'obras', OBRA, 'config', 'info'), estado('activa'), { merge: true }));
  check(!eDirGral, 'el director general sí: la regla dice `esDirectivoC()`, los cuatro',
    eDirGral ? `DENEGADA: ${eDirGral.message}` : 'pasa');

  // ── 6. EL CANDADO LEE DONDE LEE LA PANTALLA ─────────────────────────────
  // Lo único de todo esto que es imposible de ver leyendo las reglas.
  //
  // El estado vive dos veces porque `loadObras` hidrata con `{...raiz,...info}`:
  // `config/info` GANA la mezcla, así que una escritura que sólo toque la raíz
  // se deshace en el siguiente login. Si el candado leyera un documento y la
  // pantalla el otro, podría quedar una obra que dice «Cerrada» y cuyas
  // capturas pasan — y eso es peor que no tener candado, porque nadie va a
  // volver a revisar un candado que cree puesto.
  //
  // Los tres estados desparejos no son hipótesis: nacen de una escritura a
  // medias, que es exactamente lo que `guardarEstadoDeObra` devuelve como
  // `ok:false`.
  console.log('\n6. El candado lee el estado de los dos documentos, en el orden de la pantalla');
  await sembrarEstado(OBRA, { raizEstado: 'activa', infoEstado: 'cerrada' });
  const d1 = await sondar(residente, 'avance/subs', 'desparejo-1');
  check(!!d1, 'sólo `config/info` dice cerrada → rebota (es el documento que gana al hidratar)',
    d1 ? 'rebotó' : 'ESCRIBIÓ — en pantalla diría «Cerrada» y la captura pasaría');

  await sembrarEstado(OBRA, { raizEstado: 'cerrada', infoEstado: null });
  const d2 = await sondar(residente, 'avance/subs', 'desparejo-2');
  check(!!d2, 'sólo la raíz dice cerrada y `config/info` no trae el campo → rebota (la raíz respalda)',
    d2 ? 'rebotó' : 'ESCRIBIÓ — la obra legada, cerrada antes de que `config/info` lo supiera');

  await sembrarEstado(OBRA, { raizEstado: 'cerrada', infoEstado: 'activa' });
  const d3 = await sondar(residente, 'avance/subs', 'desparejo-3');
  check(!d3, 'los dos en desacuerdo y `config/info` dice activa → PASA, igual que en pantalla',
    d3 ? `rebotó: ${d3.message} — el candado y la pantalla no dirían lo mismo` : 'pasa');

  // ── 7. LA OBRA QUE ACABA DE NACER ───────────────────────────────────────
  // Cada obra nace así: la raíz creada y `config/info` todavía no. Si el
  // `get()` de un documento ausente tumbara la regla, el alta de obra dejaría
  // de funcionar entera — y de la peor forma, porque `fsSetA` se traga el
  // rechazo y la pantalla diría «guardado».
  console.log('\n7. La obra que acaba de nacer, sin `config/info`, no está bloqueada');
  await comoOwner('PATCH', `obras/${NUEVA}`, cadena({ nombre: 'OBRA RECIÉN DADA DE ALTA' }));
  await sembrarEstado(NUEVA, { infoEstado: 'SIN_DOCUMENTO' });
  const eNace = await intentar(() => setDoc(
    doc(gerente, 'obras', NUEVA, 'config', 'info'),
    { nombre: 'OBRA RECIÉN DADA DE ALTA', presupuesto: 1000 }, { merge: true }));
  check(!eNace, 'el gerente escribe `config/info` de una obra sin `config/info`',
    eNace ? `DENEGADA: ${eNace.message} — el alta de obra quedaría roto` : 'pasa');
  const eNace2 = await intentar(() => setDoc(
    doc(gerente, 'obras', NUEVA, 'avance', 'subs'), { sonda: 1 }, { merge: true }));
  check(!eNace2, 'y captura en ella', eNace2 ? `DENEGADA: ${eNace2.message}` : 'pasa');

  // ── 8. EL CANDADO ES DE ESTA OBRA, NO DEL TABLERO ───────────────────────
  // Una obra cerrada no puede arrastrar a las demás: `get()` de la obra
  // equivocada, o un ayudante que mire `request` en vez de `obraId`, cerraría
  // la constructora entera. Sale en verde por construcción si todo está bien,
  // y ese es el punto: es la aserción que distingue «cerré una obra» de
  // «paré la operación».
  console.log('\n8. Cerrar una obra no cierra las demás');
  await sembrarEstado(OBRA, { raizEstado: 'cerrada', infoEstado: 'cerrada' });
  await sembrarEstado(OTRA, { raizEstado: 'activa', infoEstado: 'activa' });
  const eOtra = await sondar(gerente, 'avance/subs', 'otra', OTRA);
  check(!eOtra, `con 0112 cerrada, 0126 sigue capturando`,
    eOtra ? `DENEGADA: ${eOtra.message} — el candado es del tablero, no de la obra` : 'pasa');

  // ── 9. LA FRONTERA DE ESTE CAMBIO, DICHA EN VOZ ALTA ────────────────────
  // El cierre es de constructora. El bloque de dependencia NO lleva candado, y
  // es deliberado: allá no hay pantalla que escriba `estado`, y una regla que
  // bloquee un estado que nadie puede poner es un candado sin llave — y de los
  // que muerden, porque el día que un dato viejo trajera `estado:'cerrada'`
  // por copia, la captura municipal se caería sin que nadie supiera por qué.
  //
  // Esto se afirma para que la frontera no se cruce por descuido: el día que
  // exista un cierre de dependencia, esta aserción es la que hay que venir a
  // cambiar, y cambiarla obliga a leer este párrafo.
  console.log('\n9. La frontera: el cierre es de constructora');
  const OID = 'coatza';
  await comoOwner('PATCH', `orgs/${OID}/obras/${OBRA}/config/info`, cadena({ estado: 'cerrada' }));
  const supD = await abrir(`supd-${sello}`, 'supd',
    { tipo: 'dependencia', rol: 'supervisor_obra', orgId: OID, todas: false, obras: [OBRA] });
  const eDep = await intentar(() => setDoc(
    doc(supD, 'orgs', OID, 'obras', OBRA, 'avance', 'subs'), { sonda: 1 }, { merge: true }));
  check(!eDep, 'una obra de dependencia con `estado:"cerrada"` sigue admitiendo captura',
    eDep ? `rebotó: ${eDep.message} — hay candado donde no hay cierre que lo ponga` : 'pasa');

  veredicto();
})().catch(e => { console.error(e); process.exit(2); });

// ── Contraprueba ────────────────────────────────────────────────────────────
const DERIVACIONES = [
  ['el candado sale del ayudante y las 19 rutas quedan abiertas',
    s => s.replace(/\n          && !obraCerradaC\(id\);/, ';')],

  ['el candado lee sólo la raíz (la pantalla leería `config/info`)',
    s => s.replace(/      return info == null \? porRaiz : info\.data\.get\('estado', porRaiz\);/,
                   '      return porRaiz;')],
  ['el candado lee sólo `config/info`, sin respaldo de la raíz',
    s => s.replace(/      let porRaiz = raiz == null \? 'activa' : raiz\.data\.get\('estado', 'activa'\);/,
                   "      let porRaiz = 'activa';")],
  ['el `get()` de un documento ausente tumba la regla y rompe el alta de obra',
    s => s.replace(/      return info == null \? porRaiz : info\.data\.get\('estado', porRaiz\);/,
                   "      return info.data.get('estado', porRaiz);")],

  ['`archivada` se cae de la lista: el cajón vuelve a ser sólo un filtro',
    s => s.replace(/in \['cerrada', 'archivada'\]/, "in ['cerrada']")],

  ['la puerta se abre de par en par: cualquier campo con el estado',
    s => s.replace(/      return resource != null\n          && request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\n               \.hasOnly\(\['estado', 'estadoDesde', 'estadoPor', 'estadoPorNombre', 'id'\]\);/,
                   '      return resource != null;')],
  ['la puerta se le abre a cualquiera que vea la obra',
    s => s.replace(/        allow write: if puedeEditarObraC\(obraId\)\n                     \|\| \(esDirectivoC\(\) && soloMueveElEstado\(\)\);/,
                   '        allow write: if puedeEditarObraC(obraId)\n' +
                   '                     || (puedeVerObraC(obraId) && soloMueveElEstado());')],
  ['la puerta se cierra también: la obra cerrada ya no se podría reabrir',
    s => s.replace(/        allow write: if puedeEditarObraC\(obraId\)\n                     \|\| \(esDirectivoC\(\) && soloMueveElEstado\(\)\);/,
                   '        allow write: if puedeEditarObraC(obraId);')],

  ['la obra cerrada se puede BORRAR',
    s => s.replace(/      allow delete: if esDirectivoC\(\) && !obraCerradaC\(obraId\);/,
                   '      allow delete: if esDirectivoC();')],
  ['los permisos de una obra cerrada se reparten',
    s => s.replace(/        allow write: if esDirectivoC\(\) && !obraCerradaC\(obraId\);\n      \}\n      \/\/ LA BANDERA/,
                   '        allow write: if esDirectivoC();\n      }\n      // LA BANDERA')],
  ['la bitácora de una obra cerrada se corrige',
    s => s.replace(/        allow update, delete: if esDirectivoC\(\) && !obraCerradaC\(obraId\);/,
                   '        allow update, delete: if esDirectivoC();')],
  ['el `update` de la raíz no mira el cierre: el contrato de una obra cerrada se mueve',
    s => s.replace(/      allow update: if esDirectivoC\(\)\n                    && \(!obraCerradaC\(obraId\) \|\| soloMueveElEstado\(\)\);/,
                   '      allow update: if esDirectivoC();')],
  ['el candado mira la obra equivocada y cierra el tablero entero',
    s => s.replace(/    function obraCerradaC\(obraId\) \{\n      return estadoDeObraC\(obraId\)/,
                   `    function obraCerradaC(obraId) {\n      return estadoDeObraC('${OBRA}')`)],
];

function contraprueba() {
  if (process.env.SIN_CONTRAPRUEBA || REGLAS_DERIVADAS) return 0;
  console.log('\n── CONTRAPRUEBA ───────────────────────────────────────────────');
  const original = fs.readFileSync(ARCH_REGLAS, 'utf8');
  const os = require('os');
  let malas = 0;
  for (const [nombre, derivar] of DERIVACIONES) {
    const derivado = derivar(original);
    if (derivado === original) {
      console.log(`   ✗ «${nombre}»: la derivación no aplicó — la prueba no la vigila`);
      malas++; continue;
    }
    const tmp = path.join(os.tmpdir(),
      `contraprueba-obra-cerrada-${Math.random().toString(36).slice(2)}.rules`);
    fs.writeFileSync(tmp, derivado);
    const r = require('child_process').spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_REGLAS: tmp } });
    fs.unlinkSync(tmp);
    if (r.status === 1) console.log(`   ✓ «${nombre}» → ROJO`);
    else {
      malas++;
      console.log(`   ✗ «${nombre}» → salió ${r.status} ` +
        `(${r.status === 0 ? 'VERDE: la prueba no lo detecta' : 'NO ARRANCÓ: el banco revienta'})`);
      if (r.status === 2) console.log((r.stdout || '') + (r.stderr || '').slice(0, 800));
    }
  }
  return malas;
}

async function veredicto() {
  const malas = contraprueba();
  // El último ruleset que quedó puesto en el emulador es uno MUTILADO. Se
  // repone el del repositorio pase lo que pase.
  if (!process.env.SIN_CONTRAPRUEBA && !REGLAS_DERIVADAS) {
    await cargarReglas({ proyecto: PROYECTO, host: HOST, puerto: PUERTO, archivo: ARCH_REGLAS });
  }
  console.log('\n' + '─'.repeat(70));
  if (fallas === 0 && malas === 0) {
    console.log('Una obra cerrada no se mueve, y la única puerta es volver a abrirla.');
    process.exit(0);
  }
  if (fallas) console.log(`${fallas} comprobación(es) en rojo. NO desplegar hasta resolverlas.`);
  if (malas) console.log(`${malas} contraprueba(s) no sirven.`);
  process.exit(1);
}
