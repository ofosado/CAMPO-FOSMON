#!/usr/bin/env node
// Prueba de INTEGRACIÓN: la subcolección `obras/{id}/nomina_historial/{semana}`
// se puede escribir y leer de verdad, con `firestore.rules` puestas.
//
// Por qué existe: es la comprobación que no se hizo con el histórico de
// subcontratos y que le costó TRES AÑOS de silencio (PENDIENTES #31). Aquella
// ruta no tenía regla, caía en el `match /{document=**}` final que deniega
// todo, y como la escritura pasaba por un helper que se traga el fallo, nadie
// se enteró: el debounce se disparaba, la escritura rebotaba y la gráfica
// pintaba vacío. No se perdió un dato — se perdió una funcionalidad entera,
// sin un solo mensaje de error.
//
// La migración de nómina estrena una ruta nueva. Esta prueba se escribe ANTES
// de moverle un solo dato, y no comprueba que la regla EXISTA en el archivo:
// intenta escribir contra un Firestore de verdad y mira si la escritura llega.
// Un `match` puede existir y no aplicar.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-reglas-nomina-subcoleccion.cjs

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc,
        collection, getDocs } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';
const OBRA = '0126';           // la que rayó su semana 38 en dos archivos

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
// Se mira `code`, no el texto. Una lectura denegada por el emulador llega con
// `code: 'permission-denied'` y un mensaje que NO dice "permission": dice
// `false for 'get' @ L225`. Reconocerla por el texto daba rojo donde las
// reglas estaban bien — un falso fallo, que en una prueba de permisos es tan
// caro como un falso verde: enseña a desconfiar de la prueba.
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied/i.test(e?.message || '');

// Una semana con la forma que tendrá en la subcolección: guarda las PARTES,
// porque la 38 de la 0126 vino en dos archivos y borrar una no puede borrar
// la otra.
const SEMANA_38 = {
  año: 2026, semana: 38, clave: 'Y2026-S38',
  partes: [
    { semana: 'Semana 38', fecha: '21/9/2026', archivo: 's38-a.xlsx', totalNomina: 502603, trabajadores: [{ nombre: 'A', salSem: 3000 }] },
    { semana: 'Semana 38', fecha: '21/9/2026', archivo: 's38-b.xlsx', totalNomina: 152950, trabajadores: [{ nombre: 'B', salSem: 2800 }] },
  ],
};

(async () => {
  const abrir = async (nombre, uid, claims) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, nombre);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    await signInWithCustomToken(auth, tokenDe(uid, claims));
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  let residente;
  try {
    residente = await abrir(`res-${Date.now()}`, 'residente-0126', {
      tipo: 'constructora', rol: 'residente', orgId: 'fosmon', todas: false, obras: [OBRA],
    });
  } catch (e) {
    console.error(`\nNo hay emuladores escuchando en ${HOST}:${PUERTO}/${PUERTO_AUTH}.\n` +
      `Arráncalos con:\n  firebase emulators:start --only firestore,auth --project ${PROYECTO}\n\n(${e.message})`);
    process.exit(1);
  }

  const ruta = ['obras', OBRA, 'nomina_historial', 'Y2026-S38'];

  // ── 1. LA PREGUNTA DEL #31: ¿la escritura llega? ────────────────────────
  console.log('1. La ruta nueva acepta escritura de quien captura');
  let errEscritura = null;
  try { await setDoc(doc(residente, ...ruta), SEMANA_38); }
  catch (e) { errEscritura = e; }
  check(!errEscritura, 'el residente de la obra puede escribir una semana',
    errEscritura ? `DENEGADA: ${errEscritura.message}` : 'Y2026-S38');
  if (errEscritura) {
    console.log('\nEsto es el #31 otra vez: la ruta no tiene regla que la permita.');
    console.log('NO migrar hasta que esto salga en verde — la escritura rebotaría');
    console.log('en silencio y la migración parecería funcionar sin guardar nada.');
    process.exit(1);
  }

  // Y releerla: escribir sin poder leer sería igual de inútil.
  const leido = (await getDoc(doc(residente, ...ruta))).data();
  check(leido?.clave === 'Y2026-S38', 'y volver a leerla', leido?.clave || 'no se leyó');
  check(Array.isArray(leido?.partes) && leido.partes.length === 2,
    'con sus DOS partes intactas: una semana partida en dos archivos sigue siendo dos cargas',
    `${leido?.partes?.length} parte(s)`);
  check(leido?.partes?.[0]?.trabajadores?.[0]?.nombre === 'A',
    'y los trabajadores anidados llegan enteros');

  // ── 2. Consultar la subcolección completa ───────────────────────────────
  // Es como leerá la app: una consulta a la colección, no documento a
  // documento. Que un `get` funcione no garantiza que un `list` funcione —
  // son permisos distintos en las reglas de Firestore.
  console.log('\n2. La subcolección se puede LISTAR, no solo leer documento a documento');
  await setDoc(doc(residente, 'obras', OBRA, 'nomina_historial', 'Y2026-S37'),
    { año: 2026, semana: 37, clave: 'Y2026-S37', partes: [{ semana: 'Semana 37', fecha: '14/9/2026', totalNomina: 410000, trabajadores: [] }] });
  let errLista = null, claves = [];
  try {
    const snap = await getDocs(collection(residente, 'obras', OBRA, 'nomina_historial'));
    snap.forEach(d => claves.push(d.id));
  } catch (e) { errLista = e; }
  check(!errLista, 'la consulta a la colección no rebota',
    errLista ? `DENEGADA: ${errLista.message}` : `${claves.length} documento(s)`);
  check(claves.length === 2, 'trae las dos semanas', claves.join(', '));
  // El id se eligió `Y2026-S38` y no `S38-2026` precisamente para esto:
  // ordenar por nombre tiene que ser ordenar por calendario, o la primera
  // semana de enero de 2027 se colaría entre las de 2026.
  check(JSON.stringify([...claves].sort()) === JSON.stringify(['Y2026-S37', 'Y2026-S38']),
    'y ordenarlas por nombre es ordenarlas por calendario');

  // ── 3. Las reglas de verdad están puestas ───────────────────────────────
  // Sin esto, todo lo verde de arriba sería compatible con unas reglas
  // abiertas de par en par, que es un resultado peor que el rojo.
  console.log('\n3. Las reglas discriminan — esto no está abierto de par en par');
  const ajeno = await abrir(`ajeno-${Date.now()}`, 'residente-otra', {
    tipo: 'constructora', rol: 'residente', orgId: 'fosmon', todas: false, obras: ['0127'],
  });
  let eW = null;
  try { await setDoc(doc(ajeno, ...ruta), { clave: 'Y2026-S38', partes: [] }); }
  catch (e) { eW = e; }
  check(eW && denegado(eW), 'un residente de OTRA obra no puede escribir aquí',
    eW ? 'rebotó' : 'ESCRIBIÓ — las reglas no protegen esta ruta');
  let eR = null;
  try { await getDoc(doc(ajeno, ...ruta)); } catch (e) { eR = e; }
  check(eR && denegado(eR), 'ni leerla', eR ? 'rebotó' : 'LEYÓ');

  // El cliente ve avance y fotos de su obra, pero la nómina no: es el sueldo
  // de la gente. El documento viejo ya se lo negaba; la subcolección tiene
  // que negárselo igual, o la migración filtraría datos que hoy no se filtran.
  const cliente = await abrir(`cli-${Date.now()}`, 'cliente-0126', {
    tipo: 'cliente', rol: 'cliente', orgId: 'municipio', todas: false, obras: [OBRA],
  });
  let eC = null;
  try { await getDoc(doc(cliente, ...ruta)); } catch (e) { eC = e; }
  check(eC && denegado(eC),
    'el cliente NO puede ver la nómina, igual que con el documento viejo',
    eC ? 'rebotó' : 'LEYÓ LA NÓMINA — la migración filtraría sueldos');

  // ── Limpieza ────────────────────────────────────────────────────────────
  for (const id of ['Y2026-S37', 'Y2026-S38'])
    await deleteDoc(doc(residente, 'obras', OBRA, 'nomina_historial', id)).catch(() => {});

  console.log(fallas === 0
    ? '\nLa ruta nueva funciona de verdad: se escribe, se lee, se lista y discrimina.'
    : `\n${fallas} comprobación(es) en rojo. NO migrar hasta resolverlas.`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
