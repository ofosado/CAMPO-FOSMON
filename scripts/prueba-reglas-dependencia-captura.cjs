#!/usr/bin/env node
// Prueba de INTEGRACIÓN: la obra de dependencia acepta captura de avance, y
// NO deja pasar el costo del contratista.
//
// Por qué existe. El modelo escrito decía «la constructora ejecuta y captura,
// la dependencia supervisa», y de ahí salieron cinco subcolecciones
// documentales sin una sola ruta de captura. Es falso: el supervisor de obra
// va, verifica y levanta el avance. Sin las rutas, `orgs/{oid}/obras/{id}/
// avance/subs` cae en el `match /{document=**}` final —que deniega— y `fsSet`
// devuelve `false` en silencio: la captura de la demo parecería funcionar
// enfrente del cliente sin guardar un solo dato.
//
// Eso es literalmente el #31 (tres años de histórico de subcontratos que
// nunca existió) y lo que se evitó a tiempo en el #28. Tercera vez que
// aparece el patrón, así que esta prueba se escribe ANTES de desplegar.
//
// La segunda mitad es igual de importante y no es de seguridad genérica: es
// LA DECISIÓN DE PRODUCTO. Una dependencia no ve el margen del contratista.
// Ni su nómina, ni sus subcontratos, ni su maquinaria, ni su almacén, ni sus
// otros gastos. Si alguien "completa la simetría" copiando las seis rutas que
// faltan, esta prueba se pone roja. Es su única razón de ser.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-reglas-dependencia-captura.cjs

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc,
        addDoc, collection, getDocs } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const ORG = 'dep-demo';         // la dependencia
const OTRA_ORG = 'dep-vecina';  // otra dependencia, para probar el aislamiento
const OBRA = 'OP-2026-001';     // la obra asignada al supervisor
const OBRA_AJENA = 'OP-2026-099';

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
// Se mira `code`, no el texto: el emulador deniega con un mensaje que NO dice
// "permission", dice `false for 'get' @ L225`. Reconocerla por el texto daba
// rojo donde las reglas estaban bien.
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied/i.test(e?.message || '');

const escribe = async (db, ruta, datos) => {
  try { await setDoc(doc(db, ...ruta), datos); return null; } catch (e) { return e; }
};
const lee = async (db, ruta) => {
  try { return { dato: (await getDoc(doc(db, ...ruta))).data(), err: null }; }
  catch (e) { return { dato: null, err: e }; }
};

// Una captura como la que hace el supervisor: partidas con volumen ejecutado.
const SUBS = { data: [
  { id: 'E-01', sec: 'Terracerías', sub: 'Excavación', unidad: 'm3',
    cat: 1200, cantEjec: 480, a: 40, imp: 384000, fotos: [] },
  { id: 'E-02', sec: 'Terracerías', sub: 'Relleno compactado', unidad: 'm3',
    cat: 900, cantEjec: 0, a: 0, imp: 0, fotos: [] },
] };

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
  const sello = Date.now();
  const dep = (nombre, rol, extra = {}) => abrir(`${nombre}-${sello}`, `${nombre}-${sello}`, {
    tipo: 'dependencia', rol, orgId: ORG, todas: false, obras: [OBRA], ...extra,
  });

  let supervisor;
  try {
    supervisor = await dep('supervisor', 'supervisor_obra');
  } catch (e) {
    console.error(`\nNo hay emuladores escuchando en ${HOST}:${PUERTO}/${PUERTO_AUTH}.\n` +
      `Arráncalos con:\n  firebase emulators:start --only firestore,auth --project ${PROYECTO}\n\n(${e.message})`);
    process.exit(1);
  }

  const enObra = (...resto) => ['orgs', ORG, 'obras', OBRA, ...resto];

  // ── 1. LA PREGUNTA DEL #31: ¿la captura llega? ──────────────────────────
  console.log('1. El supervisor de obra captura avance, y el dato queda');
  const errSubs = await escribe(supervisor, enObra('avance', 'subs'), SUBS);
  check(!errSubs, 'el supervisor asignado escribe `avance/subs`',
    errSubs ? `DENEGADA: ${errSubs.message}` : 'dos partidas');
  if (errSubs) {
    console.log('\nEsto es el #31 otra vez: la ruta de captura no tiene regla.');
    console.log('NO hacer la demo hasta que esto salga en verde — Oscar capturaría');
    console.log('enfrente del cliente y no se guardaría nada, sin un solo error.');
    process.exit(1);
  }
  const relectura = await lee(supervisor, enObra('avance', 'subs'));
  check(relectura.dato?.data?.[0]?.cantEjec === 480,
    'y al releerla el volumen ejecutado sigue ahí',
    `cantEjec = ${relectura.dato?.data?.[0]?.cantEjec}`);

  // El resto de la captura: sin estas cuatro no hay obra que enseñar.
  for (const [ruta, datos, que] of [
    [enObra('config', 'info'), { nombre: 'Pavimentación calle Hidalgo', estado: 'activa' }, 'la ficha de la obra'],
    [enObra('config', 'catalogo'), { conceptos: [{ clave: 'E-01', desc: 'Excavación', unidad: 'm3', cant: 1200, pu: 320 }], importeContrato: 384000 }, 'el catálogo de partidas'],
    [enObra('config', 'parametros'), { pctAnticipo: 30, pctRetencion: 5 }, 'anticipo y retención'],
    [enObra('config', 'estimaciones'), { data: [{ no: 1, periodo: '2026-09', monto: 120000, estatus: 'presentada' }] }, 'las estimaciones'],
  ]) {
    const e = await escribe(supervisor, ruta, datos);
    check(!e, `y ${que}`, e ? `DENEGADA: ${e.message}` : 'guardado');
  }

  // El corte semanal: de aquí sale el informe del artículo 73.
  const errHist = await escribe(supervisor, enObra('avance', 'historial'),
    { semanas: [{ semana: 38, año: 2026, avancePonderado: 40, montoEjecutado: 384000, fechaCierre: '2026-09-20' }] });
  check(!errHist, 'el corte semanal se guarda',
    errHist ? `DENEGADA: ${errHist.message}` : 'semana 38');

  // La incidencia: el segundo hueco del informe del 73.
  let errBit = null;
  try {
    await addDoc(collection(supervisor, ...enObra('bitacora')),
      { fecha: '2026-09-22', texto: 'Lluvia. Suspensión de terracerías por dos días.', autor: 'supervisor' });
  } catch (e) { errBit = e; }
  check(!errBit, 'y la incidencia queda en la bitácora',
    errBit ? `DENEGADA: ${errBit.message}` : 'una entrada');

  // ── 2. LA FRONTERA DEL MARGEN ───────────────────────────────────────────
  // Esta sección es la decisión de producto, no una prueba de seguridad
  // genérica. Si alguien copia las seis rutas de costo "para completar la
  // simetría", esto se pone rojo. Se prueba con el rol MÁS poderoso de la
  // dependencia: si el director no puede, nadie puede.
  console.log('\n2. La frontera del margen — la dependencia NO ve el costo del contratista');
  const director = await dep('director', 'director_obras', { todas: true, obras: [] });
  for (const [ruta, que] of [
    [enObra('nomina', 'historial'), 'la nómina (documento viejo)'],
    [enObra('nomina_historial', 'Y2026-S38'), 'la nómina (subcolección)'],
    [enObra('subcontratos', 'lista'), 'los subcontratos, con proveedor y monto'],
    [enObra('avance', 'maquinaria'), 'la maquinaria del contratista'],
    [enObra('avance', 'materiales'), 'el almacén del contratista'],
    [enObra('config', 'otros_gastos'), 'los otros gastos del contratista'],
  ]) {
    const eW = await escribe(director, ruta, { data: [] });
    const eR = await lee(director, ruta);
    check(eW && denegado(eW) && eR.err && denegado(eR.err),
      `ni el director de Obras Públicas toca ${que}`,
      eW && eR.err ? 'rebota lectura y escritura'
                   : `SE PUDO ${!eW ? 'ESCRIBIR' : ''}${!eR.err ? ' LEER' : ''} — la frontera se rompió`);
  }

  // ── 3. Quién escribe y quién sólo mira ──────────────────────────────────
  console.log('\n3. Los roles discriminan dentro de la propia dependencia');

  const contralor = await dep('contralor', 'contralor', { todas: true, obras: [] });
  const lecCont = await lee(contralor, enObra('avance', 'subs'));
  check(!lecCont.err && lecCont.dato?.data?.length === 2,
    'el contralor LEE el avance (fiscaliza)',
    lecCont.err ? `denegada: ${lecCont.err.message}` : 'dos partidas');
  const escCont = await escribe(contralor, enObra('avance', 'subs'), { data: [] });
  check(escCont && denegado(escCont),
    'pero NO lo escribe — fiscalizar no es corregir',
    escCont ? 'rebotó' : 'ESCRIBIÓ — el contralor no debería poder');

  // jefe_supervision manda sobre todo el cuerpo de supervisión: escribe en
  // cualquier obra de su org, aunque no la tenga asignada.
  const jefe = await dep('jefe', 'jefe_supervision', { todas: false, obras: [] });
  const escJefe = await escribe(jefe, enObra('avance', 'subs'), SUBS);
  check(!escJefe, 'el jefe de supervisión escribe sin tener la obra asignada',
    escJefe ? `DENEGADA: ${escJefe.message}` : 'guardado');

  // El supervisor de OTRA obra no entra aquí.
  const ajeno = await dep('ajeno', 'supervisor_obra', { obras: [OBRA_AJENA] });
  const escAjeno = await escribe(ajeno, enObra('avance', 'subs'), { data: [] });
  check(escAjeno && denegado(escAjeno),
    'un supervisor de otra obra no captura en ésta',
    escAjeno ? 'rebotó' : 'ESCRIBIÓ — el alcance por obra no aplica');

  // ── 4. El contratista, cuando exista, mira lo suyo y nada más ───────────
  // Hoy sólo lee. Cuando le toque capturar será una línea, pero hasta
  // entonces no se le regala escritura — y el margen de OTROS y el corte
  // semanal no los ve nunca.
  console.log('\n4. El contratista sólo lee, y no todo');
  const contratista = await dep('contratista', 'contratista');
  const cLee = await lee(contratista, enObra('avance', 'subs'));
  check(!cLee.err, 'el contratista ve el avance de su obra',
    cLee.err ? `denegada: ${cLee.err.message}` : 'lo ve');
  const cEsc = await escribe(contratista, enObra('avance', 'subs'), { data: [] });
  check(cEsc && denegado(cEsc), 'pero todavía no captura',
    cEsc ? 'rebotó' : 'ESCRIBIÓ — aún no le toca');
  const cHist = await lee(contratista, enObra('avance', 'historial'));
  check(cHist.err && denegado(cHist.err),
    'y no ve los cortes semanales, igual que el `cliente` en constructora',
    cHist.err ? 'rebotó' : 'LEYÓ el historial');

  // ── 5. Aislamiento entre organizaciones ─────────────────────────────────
  // Lo que se le va a prometer al cliente: "sus datos están aislados".
  console.log('\n5. El aislamiento entre organizaciones, que es lo que se le promete al cliente');
  const vecina = await abrir(`vecina-${sello}`, `vecina-${sello}`, {
    tipo: 'dependencia', rol: 'director_obras', orgId: OTRA_ORG, todas: true, obras: [],
  });
  const vLee = await lee(vecina, enObra('avance', 'subs'));
  check(vLee.err && denegado(vLee.err),
    'el director de OTRA dependencia no ve esta obra',
    vLee.err ? 'rebotó' : 'LEYÓ la obra de otra organización');

  // Y la constructora tampoco: FOSMON no ve las obras del municipio.
  const fosmon = await abrir(`fosmon-${sello}`, `fosmon-${sello}`, {
    tipo: 'constructora', rol: 'director_general', orgId: 'fosmon', todas: true, obras: [],
  });
  const fLee = await lee(fosmon, enObra('avance', 'subs'));
  check(fLee.err && denegado(fLee.err),
    'ni el director general de FOSMON, que es constructora',
    fLee.err ? 'rebotó' : 'LEYÓ — una constructora no debe entrar aquí');

  // Y al revés: la dependencia no ve las obras de FOSMON en la raíz.
  const dLee = await lee(director, ['obras', '0126', 'avance', 'subs']);
  check(dLee.err && denegado(dLee.err),
    'y la dependencia no ve las obras de FOSMON en la raíz',
    dLee.err ? 'rebotó' : 'LEYÓ una obra de constructora');

  // ── 6. La marca del cliente ─────────────────────────────────────────────
  // El manifest es del producto —la app se llama cotea para todos—; esto es
  // sólo el logo que va junto al saludo.
  console.log('\n6. La marca del cliente se lee en tiempo de ejecución');
  const admin = await dep('admin', 'director_obras', { todas: true, obras: [] });
  const errMarca = await escribe(admin, ['orgs', ORG, 'config', 'branding'],
    { nombre: 'H. Ayuntamiento de Demo', logoUrl: 'https://ejemplo/logo.png', acento: '#FF6B35' });
  check(!errMarca, 'la dirección guarda el logo de su organización',
    errMarca ? `DENEGADA: ${errMarca.message}` : 'guardado');
  const marcaSup = await lee(supervisor, ['orgs', ORG, 'config', 'branding']);
  check(!marcaSup.err && marcaSup.dato?.nombre === 'H. Ayuntamiento de Demo',
    'y cualquier miembro de la org lo lee al entrar',
    marcaSup.err ? `denegada: ${marcaSup.err.message}` : marcaSup.dato?.nombre);
  const marcaVecina = await lee(vecina, ['orgs', ORG, 'config', 'branding']);
  check(marcaVecina.err && denegado(marcaVecina.err),
    'pero la organización vecina no',
    marcaVecina.err ? 'rebotó' : 'LEYÓ la marca ajena');
  const marcaSup2 = await escribe(supervisor, ['orgs', ORG, 'config', 'branding'], { nombre: 'pirata' });
  check(marcaSup2 && denegado(marcaSup2),
    'y un supervisor no le cambia la marca a la organización',
    marcaSup2 ? 'rebotó' : 'ESCRIBIÓ la marca');

  console.log(fallas === 0
    ? '\nLa obra de dependencia captura de verdad, y el costo del contratista no cruza.'
    : `\n${fallas} comprobación(es) en rojo. NO desplegar hasta resolverlas.`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
