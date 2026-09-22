#!/usr/bin/env node
// Prueba de INTEGRACIÓN: el cierre semanal de la 0114 por el camino real,
// contra un Firestore de verdad (el emulador), con los 335 conceptos de la
// obra y los 10 snapshots que ya tiene.
//
// Por qué existe además de `prueba-cierre-no-falla-callado.cjs`: aquella
// prueba sustituye `setDoc` por un doble para poder forzar el fallo. Es lo
// correcto para probar el fallo, pero deja sin probar lo otro — que la
// escritura real sucede y que lo escrito se puede releer. El rescate de las
// semanas 37 y 38 se hizo por script, con el Admin SDK y saltándose las
// reglas; el camino de la app no se ha ejercido desde que falló siete veces.
//
// Aquí no hay dobles: `setDoc`, `doc` y `getDoc` son los del SDK de la app,
// apuntando al emulador. `crearSnapshotAvance` se extrae de src/App.jsx por
// AST, no se copia: si la función cambia, esta prueba cambia con ella.
//
// Y se entra AUTENTICADO como residente de la 0114, con `firestore.rules`
// cargadas. El rescate corrió con el Admin SDK, que se salta las reglas; la
// app no. Así que la prueba también contesta si el residente tiene permiso
// para escribir ese documento — que es media pregunta de "¿funciona el clic?".
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-cierre-emulador.cjs [/tmp/0114-produccion.json]
//
// El volcado lo produce `scripts/volcar-0114.cjs` (solo lectura de producción).

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } =
  require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const VOLCADO = process.argv[2] || '/tmp/0114-produccion.json';
const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';
const OBRA = '0114';

// El emulador de Auth acepta custom tokens sin firmar; no hace falta una
// llave de servicio. Los `claims` son los que la app pone al residente y los
// que `firestore.rules` lee en `puedeEditarObraC`.
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

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Extracción por AST de lo que usa el camino de escritura ────────────────
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  ClassDeclaration(p) { decl[p.node.id.name] = src.slice(p.node.start, p.node.end); },
  FunctionDeclaration(p) {
    if (p.node.id) decl[p.node.id.name] ||= src.slice(p.node.start, p.node.end);
  },
});
const NECESARIAS = ['crearSnapshotAvance', 'tamañoFirestore', 'LIMITE_DOC_FIRESTORE',
  'ESQUEMA_SNAPSHOT', 'mensajeFalloSnapshot', 'ErrorSnapshot', 'avanceFisicoPonderado',
  'desgloseEjecutado', 'importeEjecutadoPartida', 'importeCatalogoPartida',
  'semanaISO', 'snapshotId'];
for (const n of NECESARIAS)
  if (!decl[n]) { console.error(`No se pudo extraer \`${n}\` de src/App.jsx`); process.exit(1); }

(async () => {
  if (!fs.existsSync(VOLCADO)) {
    console.error(`Falta el volcado ${VOLCADO}. Córrelo antes:\n` +
      `  TOKEN=$(gcloud auth application-default print-access-token) node scripts/volcar-0114.cjs`);
    process.exit(1);
  }
  const prod = JSON.parse(fs.readFileSync(VOLCADO, 'utf8'));
  const semanasPrevias = prod.historial.semanas;
  const subs = prod.subs.data;

  console.log(`Volcado de producción del ${prod.bajadoEl}`);
  console.log(`  ${semanasPrevias.length} snapshots · ${subs.length} conceptos · ` +
    `contrato ${prod.presupuesto}\n`);

  // ── Firestore de verdad, en el emulador, con las reglas puestas ──────────
  const abrir = async (nombre, uid, claims) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, nombre);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    await signInWithCustomToken(auth, tokenDe(uid, claims));
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  let fbDb;
  try {
    fbDb = await abrir('residente', 'residente-0114', {
      tipo: 'constructora', rol: 'residente',
      orgId: 'fosmon', todas: false, obras: [OBRA],
    });
  } catch (e) {
    console.error(`\nNo hay emuladores escuchando en ${HOST}:${PUERTO}/${PUERTO_AUTH}.\n` +
      `Arráncalos con:\n  firebase emulators:start --only firestore,auth --project ${PROYECTO}\n\n` +
      `(${e.message})`);
    process.exit(1);
  }
  console.log(`Entrando como residente asignado a ${OBRA}, con firestore.rules cargadas.\n`);

  const refHist = doc(fbDb, 'obras', OBRA, 'avance', 'historial');
  try {
    await setDoc(refHist, { semanas: semanasPrevias });
  } catch (e) {
    console.error(`\nEl residente no pudo ni sembrar el historial: ${e.message}`);
    process.exit(1);
  }
  const sembrado = (await getDoc(refHist)).data();
  check(sembrado.semanas.length === semanasPrevias.length,
    'el emulador quedó sembrado con el historial real de 0114',
    `${sembrado.semanas.length} snapshots`);

  // Sin esto, todo lo verde de abajo sería compatible con unas reglas abiertas
  // de par en par. Un usuario que no tiene la obra asignada tiene que rebotar.
  const ajeno = await abrir('ajeno', 'residente-otra', {
    tipo: 'constructora', rol: 'residente',
    orgId: 'fosmon', todas: false, obras: ['0127'],
  });
  let reboto = false;
  try { await setDoc(doc(ajeno, 'obras', OBRA, 'avance', 'historial'), { semanas: [] }); }
  catch (e) { reboto = /permission|PERMISSION/.test(e.message); }
  check(reboto, 'las reglas están puestas: un residente de otra obra no puede escribir aquí');

  // ── El camino real, con las dependencias de la app ───────────────────────
  // `fsGet` es el lector de la app: aquí el de verdad, contra el emulador.
  let getsDeLaFuncion = 0;
  const fsGet = async ruta => {
    getsDeLaFuncion++;
    const d = await getDoc(doc(fbDb, ...ruta.split('/')));
    return d.exists() ? d.data() : null;
  };
  let escriturasReales = 0;
  const setDocContado = async (...a) => { escriturasReales++; return setDoc(...a); };

  const montar = new Function(
    'fbDb', 'doc', 'setDoc', 'fsGet', 'console',
    `"use strict";
     ${decl['ErrorSnapshot']}
     const ESQUEMA_SNAPSHOT = ${decl['ESQUEMA_SNAPSHOT']};
     const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
     const tamañoFirestore = ${decl['tamañoFirestore']};
     const mensajeFalloSnapshot = ${decl['mensajeFalloSnapshot']};
     const importeEjecutadoPartida = ${decl['importeEjecutadoPartida']};
     const importeCatalogoPartida = ${decl['importeCatalogoPartida']};
     const desgloseEjecutado = ${decl['desgloseEjecutado']};
     const avanceFisicoPonderado = ${decl['avanceFisicoPonderado']};
     const semanaISO = ${decl['semanaISO']};
     const snapshotId = ${decl['snapshotId']};
     const crearSnapshotAvance = ${decl['crearSnapshotAvance']};
     return { crearSnapshotAvance, ESQUEMA_SNAPSHOT, tamañoFirestore, LIMITE_DOC_FIRESTORE };`
  )(fbDb, doc, setDocContado, fsGet, console);

  console.log(`\n1. El cierre oficial, por el camino de la app`);
  const devuelto = await montar.crearSnapshotAvance(
    OBRA, subs, 'pcastillo@fosmon.com.mx', 'oficial',
    !!prod.modoVolumen, prod.presupuesto);

  check(!!devuelto, 'devolvió un snapshot (no null, que es como fallaba en silencio)',
    devuelto ? devuelto.id : 'null');
  check(escriturasReales === 1, 'escribió exactamente una vez contra Firestore',
    `${escriturasReales} escritura(s), ${getsDeLaFuncion} lectura(s)`);
  if (!devuelto) { console.log('\nSin snapshot no hay nada que comprobar.'); process.exit(1); }

  // ── Lo importante: releerlo desde el servidor, no fiarse del retorno ─────
  console.log(`\n2. Releído desde Firestore`);
  const releido = (await getDoc(refHist)).data();
  const semanas = releido.semanas || [];
  check(semanas.length === semanasPrevias.length + 1,
    'el historial creció en uno: el snapshot está en el servidor',
    `${semanasPrevias.length} → ${semanas.length}`);

  const enServidor = semanas.find(s => s.id === devuelto.id);
  check(!!enServidor, `\`${devuelto.id}\` aparece releído desde el servidor`);
  check(enServidor && (enServidor.subs || []).length === subs.length,
    'trae las 335 partidas completas, no un recorte',
    enServidor ? `${(enServidor.subs || []).length} partidas` : '');

  // Ningún snapshot previo se perdió por el camino.
  const idsAntes = semanasPrevias.map(s => s.id);
  const idsDespues = semanas.map(s => s.id);
  const perdidos = idsAntes.filter(id => !idsDespues.includes(id));
  check(perdidos.length === 0, 'no se perdió ningún snapshot anterior',
    perdidos.length ? 'faltan ' + perdidos.join(', ') : idsDespues.join(', '));
  check(idsDespues.join() === [...idsDespues].sort((a, b) => {
      const [sa, aa] = a.slice(1).split('-').map(Number);
      const [sb, ab] = b.slice(1).split('-').map(Number);
      return (aa - ab) || (sa - sb);
    }).join(), 'quedaron en orden cronológico');

  // El retorno y lo escrito tienen que ser la misma cosa. Si divergieran, la
  // pantalla mostraría una cifra que el historial no respalda.
  check(JSON.stringify(enServidor) === JSON.stringify(JSON.parse(JSON.stringify(devuelto))),
    'lo releído es idéntico a lo que la función devolvió a la pantalla');

  // ── 3. ¿El formato coincide con el de los snapshots rescatados? ──────────
  console.log(`\n3. Formato contra los snapshots rescatados (S37-2026, S38-2026)`);
  const rescatados = semanasPrevias.filter(s => ['S37-2026', 'S38-2026'].includes(s.id));
  check(rescatados.length === 2, 'los dos rescatados están en el volcado');

  const clavesDe = o => Object.keys(o).sort().join(',');
  for (const r of rescatados) {
    check(clavesDe(r) === clavesDe(enServidor),
      `${r.id}: mismos campos de primer nivel que el snapshot nuevo`,
      clavesDe(r) === clavesDe(enServidor) ? clavesDe(enServidor)
        : `rescatado{${clavesDe(r)}} vs nuevo{${clavesDe(enServidor)}}`);
    const cr = clavesDe(r.subs[0]), cn = clavesDe(enServidor.subs[0]);
    check(cr === cn, `${r.id}: mismos campos por partida`,
      cr === cn ? cn : `rescatado{${cr}} vs nuevo{${cn}}`);
    check(r.esquema === enServidor.esquema, `${r.id}: mismo esquema`,
      `${r.esquema} vs ${enServidor.esquema}`);
  }
  check(enServidor.esquema === montar.ESQUEMA_SNAPSHOT,
    `el esquema escrito es el vigente (${montar.ESQUEMA_SNAPSHOT})`);
  const conDesc = (enServidor.subs || []).some(s => 'sub' in s || 'desc' in s);
  check(!conDesc, 'ninguna partida arrastra la descripción del concepto');

  // ── 4. El tamaño real que quedó en el servidor ───────────────────────────
  console.log(`\n4. Tamaño`);
  const KB = b => `${(b / 1024).toFixed(1)} KB`;
  const bDoc = montar.tamañoFirestore(releido);
  const bSnap = montar.tamañoFirestore(enServidor);
  console.log(`   documento tras el cierre: ${KB(bDoc)} de 1024 KB ` +
    `(${(bDoc / montar.LIMITE_DOC_FIRESTORE * 100).toFixed(1)}%)`);
  console.log(`   el snapshot nuevo: ${KB(bSnap)}`);
  check(bDoc < montar.LIMITE_DOC_FIRESTORE, 'el documento sigue por debajo del límite');
  // El emulador acepta el mismo máximo que producción: que la escritura haya
  // pasado ya es la prueba de que cabe. La medición local solo lo corrobora.

  // ── 5. Reescritura de la misma semana (el residente vuelve a cerrar) ─────
  console.log(`\n5. Volver a cerrar la misma semana`);
  const antes = escriturasReales;
  const segundo = await montar.crearSnapshotAvance(
    OBRA, subs, 'pcastillo@fosmon.com.mx', 'oficial',
    !!prod.modoVolumen, prod.presupuesto);
  const tras = (await getDoc(refHist)).data().semanas;
  check(tras.length === semanas.length,
    'reemplaza el snapshot de la semana, no añade un duplicado',
    `${semanas.length} → ${tras.length}`);
  check(escriturasReales === antes + 1, 'y vuelve a escribir de verdad');
  check(!!segundo && segundo.id === devuelto.id, 'con el mismo id de semana');

  // Y el intermedio no puede pisar un oficial ya cerrado.
  const intermedio = await montar.crearSnapshotAvance(
    OBRA, subs, 'residente@fosmon.com.mx', 'intermedio',
    !!prod.modoVolumen, prod.presupuesto);
  const trasInter = (await getDoc(refHist)).data().semanas;
  check(intermedio === null, 'un intermedio NO pisa la semana ya cerrada como oficial');
  check(trasInter.find(s => s.id === devuelto.id).tipo === 'oficial',
    'y en el servidor la semana sigue siendo oficial');

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => { console.error('\n' + (e.stack || e.message)); process.exit(1); });
