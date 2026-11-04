#!/usr/bin/env node
// Prueba de INTEGRACIÓN: `obras/{id}/config/programa` — PENDIENTES #51.
//
// POR QUÉ EXISTE. La ruta es nueva, y una ruta sin regla cae en el
// `match /{document=**}` final que deniega todo. `fsSetA` se TRAGA el rechazo
// y devuelve `false`, así que la pantalla del programa podría leer el AE11
// completo, enseñar su curva, decir «guardado» y no haber guardado nada. Peor
// que en el catálogo: cuando el programa falta, el «avance programado» vuelve
// solo a la recta — o sea que el defecto se disfraza con la cifra vieja, que
// es plausible. Nadie se enteraría.
//
// LA SEGUNDA RAZÓN, que es la que no se puede deducir leyendo las reglas:
// Firestore NO admite un arreglo dentro de un arreglo. El programa guarda
// `partidas: [{ …, montos: [pesos del mes 1, mes 2, …] }]`, que es un arreglo
// de MAPAS y cada mapa trae un arreglo. Eso sí se admite — pero «sí se admite»
// es una creencia hasta que un documento de verdad da la vuelta completa. Si
// no diera la vuelta, el programa se guardaría sin sus meses y la curva se
// dibujaría plana. Aquí se escribe y se RELEE, mes por mes.
//
// LA DECISIÓN QUE SE VIGILA: las mismas llaves que `config/catalogo`, rol por
// rol, y EL CLIENTE LO LEE. El programa es el calendario que él firmó y es la
// vara con la que se le mide el atraso; esconderle la vara mientras se le
// publica la desviación es la media verdad que este expediente no puede
// contar. Es decisión de producto, no omisión — por eso se afirma, para que
// nadie «complete la simetría» con `!esCliente()` algún día.
//
// No comprueba que el `match` exista en el archivo: un `match` puede existir y
// no aplicar. Manda operaciones de verdad contra el emulador con las reglas
// del repositorio cargadas.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-reglas-programa.cjs
//
// Contraprueba: la corre sola al final, cargando rulesets DERIVADOS del
// archivo real. Cada derivación tiene que salir ROJA (código 1).

'use strict';

const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } = require('firebase/firestore');
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
const OBRA = '0131';          // el emisor: es el programa que se midió
const OTRA = '0127';

const ARCH_REGLAS = path.join(raiz, 'firestore.rules');
const REGLAS_DERIVADAS = process.env.ARCH_REGLAS ? path.resolve(process.env.ARCH_REGLAS) : null;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied/i.test(e?.message || '');
const intentar = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
// Una lectura denegada es un resultado ROJO, no un banco que revienta.
const leerODenegada = async (ref) => { try { return (await getDoc(ref)).data(); } catch { return null; } };

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

// El documento con la forma EXACTA que escribe la pantalla, con los dos
// renglones del emisor que sirvieron de ancla para descifrar el formato
// `Barra=` (agosto 2026: 90.32% de 31 días = el día 29, que es el arranque que
// el propio archivo declara).
const PROGRAMA = {
  obraId: OBRA,
  esquema: 1,
  inicio: '2026-08-29',
  fin: '2027-02-24',
  duracion: '180 días naturales',
  obraDelArchivo: 'REHABILITACIÓN DE RED DE DRENAJE SANITARIO (EMISOR)',
  meses: 3,
  total: 2000,
  totalDeclarado: 2000,
  partidas: [
    { sec: '1000 03', desc: 'BANQUETA DE CONCRETO.', unidad: 'M2', cant: 87.27,
      importe: 1000, montos: [100, 900, 0], barra: 'Barra=90.32-100,0-70,0-0' },
    { sec: '1001 01', desc: 'BASE DE GRAVA CEMENTADA.', unidad: 'M3', cant: 388.05,
      importe: 1000, montos: [0, 0, 1000], barra: 'Barra=0-0,0-0,0-100' },
  ],
  avisos: [],
  filaEncabezado: 18,
  archivo: 'AE11 PROGRAMA GENERAL MONTOS EMISOR.xlsx',
  fechaCarga: '2026-11-04',
};
const CATALOGO = { obraId: OBRA, importeContrato: 2000, totalLeido: 2000,
  conceptos: [{ clave: '1000 03', desc: 'BANQUETA DE CONCRETO.', importe: 1000 }],
  fechaCarga: '04/11/2026' };

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

  let residente;
  try {
    residente = await abrir(`res-${sello}`, `residente-${OBRA}`, cons('residente', [OBRA]));
  } catch (e) {
    console.error(`\nNo hay emuladores escuchando en ${HOST}:${PUERTO}/${PUERTO_AUTH}.\n` +
      `Arráncalos con:\n  firebase emulators:start --only firestore,auth --project ${PROYECTO}\n\n(${e.message})`);
    process.exit(1);
  }

  const ruta = (db, docu) => doc(db, 'obras', OBRA, 'config', docu);

  // ── 1. EL #31 EN LA RUTA NUEVA ──────────────────────────────────────────
  console.log('1. El residente del emisor carga el programa, y QUEDA');
  const e1 = await intentar(() => setDoc(ruta(residente, 'programa'), PROGRAMA));
  check(!e1, 'el residente asignado escribe `config/programa`',
    e1 ? `DENEGADA: ${e1.message}` : 'el AE11 del emisor');
  if (e1) {
    console.log('\nEsto es el #31 otra vez. NO desplegar: `fsSetA` se traga el');
    console.log('rechazo, así que la pantalla diría «guardado» y el avance');
    console.log('programado seguiría saliendo de la recta, sin una sola señal.');
    process.exit(1);
  }

  // ── 2. LOS MESES DAN LA VUELTA COMPLETA ─────────────────────────────────
  // Firestore no admite arreglo dentro de arreglo. `partidas` es un arreglo de
  // mapas y cada mapa trae `montos`, que sí se admite; esto lo MIDE en vez de
  // creerlo. Si los meses no volvieran, la curva saldría plana y plausible.
  console.log('\n2. Los pesos de cada mes vuelven como se guardaron');
  const leido = await leerODenegada(ruta(residente, 'programa'));
  check(Array.isArray(leido?.partidas) && leido.partidas.length === 2,
    'las dos partidas vuelven', `volvieron ${leido?.partidas?.length}`);
  check(Array.isArray(leido?.partidas?.[0]?.montos) &&
    leido.partidas[0].montos.length === 3,
    'y cada partida trae su arreglo de meses: un arreglo DENTRO de un mapa DENTRO de un arreglo',
    JSON.stringify(leido?.partidas?.[0]?.montos));
  check(leido?.partidas?.[0]?.montos?.[1] === 900 &&
    leido?.partidas?.[1]?.montos?.[2] === 1000,
    'con los pesos en el mes que les toca, y no corridos ni aplanados',
    `p1 mes2 ${leido?.partidas?.[0]?.montos?.[1]} · p2 mes3 ${leido?.partidas?.[1]?.montos?.[2]}`);
  check(leido?.partidas?.[0]?.barra === 'Barra=90.32-100,0-70,0-0',
    'la barra vuelve en TEXTO, tal como venía: lo derivado se calcula al leer',
    leido?.partidas?.[0]?.barra);
  check(leido?.inicio === '2026-08-29' && leido?.meses === 3,
    'y el arranque que el archivo declaraba sigue siendo el del archivo',
    `${leido?.inicio} · ${leido?.meses} meses`);

  await setDoc(ruta(residente, 'catalogo'), CATALOGO);

  // ── 3. MISMAS LLAVES QUE EL CATÁLOGO, ROL POR ROL ───────────────────────
  // El catálogo dice QUÉ se contrató y el programa CUÁNDO. Si una de las dos
  // columnas se mueve, hay un calendario con permisos propios — y entonces
  // alguien puede ver el alcance sin ver el plazo, o al revés.
  console.log('\n3. El programa se gobierna igual que `config/catalogo`');
  const actores = [
    ['el director general', await abrir(`dg-${sello}`, 'dg', cons('director_general', [], true))],
    ['el cliente de la obra', await abrir(`cli-${sello}`, 'cliente', cons('cliente', [OBRA]))],
    ['un residente de otra obra', await abrir(`aje-${sello}`, 'ajeno', cons('residente', [OTRA]))],
    ['el auditor', await abrir(`aud-${sello}`, 'auditor', cons('auditor', [OBRA]))],
  ];
  for (const [quien, db] of actores) {
    const rC = await intentar(() => getDoc(ruta(db, 'catalogo')));
    const rP = await intentar(() => getDoc(ruta(db, 'programa')));
    const wC = await intentar(() => setDoc(ruta(db, 'catalogo'), CATALOGO));
    const wP = await intentar(() => setDoc(ruta(db, 'programa'), PROGRAMA));
    check(!!rC === !!rP && !!wC === !!wP,
      `${quien}: lo mismo en las dos rutas`,
      `catalogo lee ${rC ? 'no' : 'sí'}/escribe ${wC ? 'no' : 'sí'} · ` +
      `programa lee ${rP ? 'no' : 'sí'}/escribe ${wP ? 'no' : 'sí'}`);
  }

  // ── 4. LA DECISIÓN DE PRODUCTO, DICHA EN VOZ ALTA ───────────────────────
  // La simetría de arriba se cumpliría igual si las dos rutas estuvieran
  // cerradas al cliente. Esto afirma el contenido, no sólo la simetría.
  console.log('\n4. El cliente VE la vara con la que se le mide');
  const cliente = actores[1][1];
  let vistaCli = null;
  const cLee = await intentar(async () => {
    vistaCli = (await getDoc(ruta(cliente, 'programa'))).data();
  });
  check(!cLee, 'el cliente lee el programa de su obra',
    cLee ? `DENEGADA: ${cLee.message} — vería su desviación sin poder ver contra qué` : 'lo ve');
  check(vistaCli?.partidas?.[0]?.montos?.[1] === 900,
    'y ve cuánto le toca a cada mes, no sólo el total del contrato',
    JSON.stringify(vistaCli?.partidas?.[0]?.montos));
  const cEsc = await intentar(() => setDoc(ruta(cliente, 'programa'), PROGRAMA));
  check(cEsc && denegado(cEsc), 'pero no lo escribe',
    cEsc ? 'rebotó' : 'ESCRIBIÓ — el cliente estaría recalendarizando la obra que paga');

  // La frontera del margen no se movió de sitio: el programa es PLAZO, no
  // economía del contratista. El cliente sigue sin ver maquinaria.
  const cMaq = await intentar(() => getDoc(doc(cliente, 'obras', OBRA, 'avance', 'maquinaria')));
  check(cMaq && denegado(cMaq),
    'y sigue sin ver la maquinaria: abrirle el calendario no abrió el costo',
    cMaq ? 'rebotó' : 'LEYÓ la maquinaria — la frontera del margen se rompió');

  // ── 5. LA DEPENDENCIA CARGA EL MISMO ANEXO, EN SU PROPIA RUTA ───────────
  // Se le añadió al banco el 2026-11-04, al descubrir que la pantalla del
  // programa NO es de constructora: `CargaDelPrograma` no lleva guarda por
  // tipo de organización, y la dependencia llega a ella por «Contrato →
  // Catálogo de conceptos» (`SUBTABS_PLANEACION_DEPENDENCIA`). O sea que un
  // supervisor municipal ve el cargador, arrastra su DE-5 y oprime confirmar.
  //
  // Su ruta NO es la misma: `conOrg` antepone `orgs/{oid}/`, así que el
  // documento es `orgs/{oid}/obras/{id}/config/programa`. El bloque de
  // dependencia de las reglas tiene `config/info`, `parametros`, `catalogo`,
  // `estimaciones`, `permisos` y `evidencia` — y NO tenía `config/programa`.
  //
  // El señuelo que hizo que esto pasara inadvertido: sí existe un
  // `match /programa/{pid}` unos renglones más arriba. Es una SUBCOLECCIÓN
  // documental de las cinco del modelo viejo, y no cubre un documento que se
  // llama `programa` dentro de `config`. Leyendo las reglas de corrido parece
  // que la ruta está contemplada. Por eso esto se mide con operaciones y no
  // comprobando que el `match` exista: un `match` puede existir y no aplicar.
  console.log('\n5. El supervisor de la dependencia carga el programa de SU obra');
  const dep = (rol, obras, todas = false) => ({
    tipo: 'dependencia', rol, orgId: 'coatza', todas, obras });
  const OID = 'coatza';
  const rutaD = (db, docu) => doc(db, 'orgs', OID, 'obras', OBRA, 'config', docu);

  const supervisor = await abrir(`sup-${sello}`, `sup-${OBRA}`, dep('supervisor_obra', [OBRA]));
  const e5 = await intentar(() => setDoc(rutaD(supervisor, 'programa'), PROGRAMA));
  check(!e5, 'el supervisor asignado escribe `config/programa` en su organización',
    e5 ? `DENEGADA: ${e5.message} — la pantalla diría «no se pudo guardar» y el ` +
         'avance seguiría midiéndose contra la recta' : 'queda guardado');

  // Que el catálogo sí pase y el programa no es la prueba de que no es un
  // problema de claims ni de la obra: es esa ruta y ninguna otra.
  const e5cat = await intentar(() => setDoc(rutaD(supervisor, 'catalogo'), CATALOGO));
  check(!e5cat && !e5,
    'y el catálogo de la misma obra pasa por la misma sesión: si uno pasa y el otro no, es la RUTA',
    `catalogo ${e5cat ? 'DENEGADO' : 'pasa'} · programa ${e5 ? 'DENEGADO' : 'pasa'}`);

  const leidoD = await leerODenegada(rutaD(supervisor, 'programa'));
  check(leidoD?.partidas?.[0]?.montos?.[1] === 900,
    'y sus meses vuelven como se guardaron, igual que del lado de la constructora',
    JSON.stringify(leidoD?.partidas?.[0]?.montos));

  // ── 6. LAS MISMAS LLAVES QUE `config/catalogo`, TAMBIÉN AQUÍ ────────────
  // Mismo principio que §3: el catálogo dice QUÉ y el programa CUÁNDO. Si las
  // llaves se separan, alguien ve el alcance sin el plazo o al revés.
  console.log('\n6. En la dependencia el programa se gobierna igual que el catálogo');
  const actoresD = [
    ['el director de Obras', await abrir(`dob-${sello}`, 'dob', dep('director_obras', [], true))],
    ['el contralor', await abrir(`ctr-${sello}`, 'ctr', dep('contralor', [], true))],
    ['el contratista de la obra', await abrir(`ctt-${sello}`, 'ctt', dep('contratista', [OBRA]))],
    ['un supervisor de otra obra', await abrir(`sup2-${sello}`, 'sup2', dep('supervisor_obra', [OTRA]))],
  ];
  for (const [quien, db] of actoresD) {
    const rC = await intentar(() => getDoc(rutaD(db, 'catalogo')));
    const rP = await intentar(() => getDoc(rutaD(db, 'programa')));
    const wC = await intentar(() => setDoc(rutaD(db, 'catalogo'), CATALOGO));
    const wP = await intentar(() => setDoc(rutaD(db, 'programa'), PROGRAMA));
    check(!!rC === !!rP && !!wC === !!wP,
      `${quien}: lo mismo en las dos rutas`,
      `catalogo lee ${rC ? 'no' : 'sí'}/escribe ${wC ? 'no' : 'sí'} · ` +
      `programa lee ${rP ? 'no' : 'sí'}/escribe ${wP ? 'no' : 'sí'}`);
  }

  // ── 7. EL CONTRATISTA VE LA VARA, Y EL CONTRALOR NO RECALENDARIZA ───────
  // El espejo de §4. Allá el que paga es el cliente de la constructora; aquí
  // el que ejecuta es el contratista del municipio, y la decisión es la misma
  // por la misma razón: se le publica su desviación, tiene que poder ver
  // contra qué. Y el contralor fiscaliza: lee todo y no corrige nada.
  console.log('\n7. El contratista ve el programa; el contralor no lo mueve');
  const contratista = actoresD[2][1];
  let vistaCtt = null;
  const cttLee = await intentar(async () => {
    vistaCtt = (await getDoc(rutaD(contratista, 'programa'))).data();
  });
  check(!cttLee, 'el contratista lee el programa de su obra',
    cttLee ? `DENEGADA: ${cttLee.message}` : 'lo ve');
  check(vistaCtt?.partidas?.[0]?.montos?.[1] === 900,
    'y ve el reparto por mes, no sólo el total',
    JSON.stringify(vistaCtt?.partidas?.[0]?.montos));
  const cttEsc = await intentar(() => setDoc(rutaD(contratista, 'programa'), PROGRAMA));
  check(cttEsc && denegado(cttEsc), 'pero no lo escribe',
    cttEsc ? 'rebotó' : 'ESCRIBIÓ — el contratista se recalendarizaría a sí mismo');
  const ctrEsc = await intentar(() => setDoc(rutaD(actoresD[1][1], 'programa'), PROGRAMA));
  check(ctrEsc && denegado(ctrEsc), 'y el contralor tampoco: quien fiscaliza no corrige',
    ctrEsc ? 'rebotó' : 'ESCRIBIÓ — la decisión de 2026-09 dice lectura amplia sin edición');

  // ── 8. LA FRONTERA DEL MARGEN NO SE MOVIÓ ───────────────────────────────
  // Abrirle el calendario a la dependencia no le abre la economía del
  // contratista. Es el mismo principio que la maquinaria en §4, y aquí vale
  // doble: las seis rutas de costo NO tienen equivalente en este bloque a
  // propósito, y el programa es plazo, no costo.
  console.log('\n8. El programa es plazo, no economía del contratista');
  const dirObras = actoresD[0][1];
  const dMaq = await intentar(() => getDoc(doc(dirObras, 'orgs', OID, 'obras', OBRA, 'avance', 'maquinaria')));
  check(dMaq && denegado(dMaq),
    'el director de Obras lee el programa y NO la maquinaria de quien ejecuta',
    dMaq ? 'rebotó' : 'LEYÓ la maquinaria — la frontera del margen se rompió');

  veredicto();
})().catch(e => { console.error(e); process.exit(2); });

// ── Contraprueba ────────────────────────────────────────────────────────────
// Rulesets DERIVADOS del archivo real. Se muta sólo el bloque de constructora
// —la primera aparición—, que es el que este banco juzga.
const DERIVACIONES = [
  ['la ruta no tiene regla (el #31 en la ruta nueva)',
    s => s.replace(/      match \/config\/programa \{\n[^}]*\n      \}\n/, '')],
  ['al cliente se le esconde el programa contra el que se le mide',
    s => s.replace(/(match \/config\/programa \{\n\s*allow read: if puedeVerObraC\(obraId\))/,
                   '$1 && !esCliente()')],
  ['la escritura se abre a cualquiera que pueda VER la obra',
    s => s.replace(/(match \/config\/programa \{\n\s*allow read: if puedeVerObraC\(obraId\);\n\s*allow write: if )puedeEditarObraC\(obraId\)/,
                   '$1puedeVerObraC(obraId)')],

  // Las tres de la dependencia. Se distinguen del bloque de constructora por
  // `puedeVerObraD`, que sólo aparece en el de abajo: el `match` se llama
  // igual en los dos y una derivación que apuntara al nombre mutaría el que
  // no es, saldría roja por §1 y parecería que vigila algo que no vigila.
  ['la ruta de la DEPENDENCIA no tiene regla (es el defecto que se midió)',
    s => s.replace(/      match \/config\/programa \{\n        allow read:  if oid == orgId\(\) && puedeVerObraD\(obraId\);\n        allow write: if oid == orgId\(\) && puedeEditarObraD\(obraId\);\n      \}\n/, '')],
  ['al contratista se le esconde el programa contra el que se le mide',
    s => s.replace(/(match \/config\/programa \{\n\s*allow read:  if oid == orgId\(\) && puedeVerObraD\(obraId\))/,
                   '$1 && !esContratista()')],
  ['el contralor recalendariza la obra que fiscaliza',
    s => s.replace(/(match \/config\/programa \{\n\s*allow read:  if oid == orgId\(\) && puedeVerObraD\(obraId\);\n\s*allow write: if oid == orgId\(\) && )puedeEditarObraD\(obraId\)/,
                   '$1esDirectivoD()')],
  // El señuelo, puesto a prueba. Si `match /programa/{pid}` cubriera
  // `config/programa`, quitar la regla nueva daría igual y la derivación de
  // arriba saldría VERDE. Ésta afirma lo contrario desde el otro lado:
  // borrado el señuelo, nada cambia, porque nunca cubrió esta ruta. Una
  // derivación que NO debe poner nada en rojo no sirve como contraprueba, así
  // que se comprueba aquí mismo y aparte.
];

const SENUELO = ['borrar `match /programa/{pid}`, que parecía cubrir esta ruta',
  s => s.replace(/      match \/programa\/\{pid\} \{\n[^}]*\n      \}\n/, '')];

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
      `contraprueba-reglas-programa-${Math.random().toString(36).slice(2)}.rules`);
    fs.writeFileSync(tmp, derivado);
    const r = require('child_process').spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_REGLAS: tmp } });
    fs.unlinkSync(tmp);
    if (r.status === 1) console.log(`   ✓ «${nombre}» → ROJO`);
    else {
      malas++;
      console.log(`   ✗ «${nombre}» → salió ${r.status} ` +
        `(${r.status === 0 ? 'VERDE: la prueba no lo detecta' : 'NO ARRANCÓ: el banco revienta'})`);
      if (r.status === 2) console.log((r.stdout || '') + (r.stderr || '').slice(0, 600));
    }
  }

  // El señuelo, al revés que las demás: ésta tiene que salir VERDE.
  const [nomSen, derSen] = SENUELO;
  const derSenuelo = derSen(original);
  if (derSenuelo === original) {
    console.log(`   ✗ «${nomSen}»: la derivación no aplicó — el señuelo ya no está donde se creía`);
    malas++;
  } else {
    const tmp = path.join(os.tmpdir(),
      `contraprueba-senuelo-${Math.random().toString(36).slice(2)}.rules`);
    fs.writeFileSync(tmp, derSenuelo);
    const r = require('child_process').spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_REGLAS: tmp } });
    fs.unlinkSync(tmp);
    if (r.status === 0) console.log(`   ✓ «${nomSen}» → VERDE, que es lo correcto: nunca cubrió \`config/programa\``);
    else {
      malas++;
      console.log(`   ✗ «${nomSen}» → salió ${r.status}: entonces SÍ cubría algo de lo que este banco juzga, ` +
        'y la regla nueva puede estar de más o mal puesta');
      if (r.status === 2) console.log((r.stdout || '') + (r.stderr || '').slice(0, 600));
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
    console.log('El programa se guarda con sus meses, se relee, y el cliente lo ve.');
    process.exit(0);
  }
  if (fallas) console.log(`${fallas} comprobación(es) en rojo. NO desplegar hasta resolverlas.`);
  if (malas) console.log(`${malas} contraprueba(s) no sirven.`);
  process.exit(1);
}
