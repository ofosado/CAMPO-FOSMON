#!/usr/bin/env node
// Prueba de INTEGRACIÓN: `obras/{id}/avance/extraordinarias` del lado
// CONSTRUCTORA, que es donde viven las cinco obras de producción y donde está
// el malecón —la 0112— que motivó todo esto.
//
// POR QUÉ EXISTE, y por qué se mide aparte del banco de cálculo.
//
// El cálculo ya está probado: `prueba-partidas-extraordinarias.cjs` renderiza
// la pantalla y corre `calcularKpisObra`. Pero esa prueba no toca Firestore, y
// la ruta es NUEVA. Una ruta sin regla cae en el `match /{document=**}` final
// que deniega todo, y la pantalla guarda con `fsSetA`, que se TRAGA el rechazo
// y devuelve `false`. O sea: Omar teclearía el muro del convenio, vería el
// avance subir a 100% en su pantalla, cerraría la semana, y al recargar no
// habría nada. Es el #31 exacto, en una ruta recién nacida.
//
// LA DECISIÓN QUE SE VIGILA: las mismas llaves que `avance/subs`, rol por rol.
// Son partidas, se capturan en la misma pantalla y cuentan en el mismo
// ejecutado. En particular EL CLIENTE LAS VE, igual que ve `subs`: enseñarle
// el avance que produce la obra extraordinaria mientras se le oculta de qué
// está hecha es la clase de media verdad que este expediente no puede contar.
// Es una decisión de producto, no una omisión — por eso se afirma, no se deja
// a que alguien «complete la simetría» con `!esCliente()` algún día.
//
// No comprueba que el `match` exista en el archivo: un `match` puede existir y
// no aplicar. Manda operaciones de verdad contra el emulador con las reglas
// del repositorio cargadas.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-reglas-extraordinarias.cjs
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
const OBRA = '0112';          // el malecón
const OTRA = '0127';

const ARCH_REGLAS = path.join(raiz, 'firestore.rules');
// La contraprueba manda el ruleset derivado por aquí. Es un ARCHIVO y no una
// cadena por el entorno: el proceso hijo es otro `node`.
const REGLAS_DERIVADAS = process.env.ARCH_REGLAS ? path.resolve(process.env.ARCH_REGLAS) : null;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied/i.test(e?.message || '');
const intentar = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
// Una lectura denegada es un resultado ROJO, no un banco que revienta. Sin
// esto, `(await getDoc(x)).data()` tira hacia el `.catch` de arriba y la
// corrida sale con 2 —«no arrancó»— cuando en realidad SÍ se midió: la regla
// cerró la puerta. Devolver `null` deja que la aserción falle con su texto.
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

// El documento con la forma que escribe la pantalla: el muro del convenio.
const EXTRAS = { data: [{ id: 'EXTRA__1', extra: true, sec: 'E-1',
  sub: 'Muro de contención no previsto', imp: 666349, cant: 1, pu: 666349,
  unidad: 'LOTE', cantEjec: 1, a: 100, fotos: {}, cat: null, catDesc: null, ruta: [],
  convenio: 'CONV-2026-03', autorizadoPor: 'SIOP', autorizadoEn: null,
  creadoPor: 'residente@fosmon.com.mx', creadoEn: '2026-10-28T12:00:00.000Z' }],
  fecha: '2026-10-28T12:00:00.000Z' };
const SUBS = { data: [{ id: 'A-01', sec: 'A-01', sub: 'Terracerías',
  imp: 6000000, cant: 100, pu: 60000, cantEjec: 110 }], fecha: '2026-10-28T12:00:00.000Z' };

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

  const ruta = (db, docu) => doc(db, 'obras', OBRA, 'avance', docu);

  // ── 1. LA PREGUNTA DEL #31 EN LA RUTA NUEVA ─────────────────────────────
  console.log('1. El residente del malecón captura la extraordinaria, y QUEDA');
  const e1 = await intentar(() => setDoc(ruta(residente, 'extraordinarias'), EXTRAS));
  check(!e1, 'el residente asignado escribe `avance/extraordinarias`',
    e1 ? `DENEGADA: ${e1.message}` : 'el muro del convenio');
  if (e1) {
    console.log('\nEsto es el #31 otra vez, en una ruta recién nacida.');
    console.log('NO desplegar: `fsSetA` se traga el rechazo, así que Omar vería');
    console.log('el avance llegar al 100% en pantalla y no habría guardado nada.');
    process.exit(1);
  }
  const leido = await leerODenegada(ruta(residente, 'extraordinarias'));
  check(leido?.data?.[0]?.convenio === 'CONV-2026-03',
    'y al releerla el convenio que la autoriza sigue ahí',
    leido?.data?.[0]?.convenio);
  check(leido?.data?.[0]?.cantEjec === 1 && leido?.data?.[0]?.pu === 666349,
    'con su volumen ejecutado y su precio unitario intactos',
    `cantEjec ${leido?.data?.[0]?.cantEjec} · PU ${leido?.data?.[0]?.pu}`);

  await setDoc(ruta(residente, 'subs'), SUBS);

  // ── 2. MISMAS LLAVES QUE EL CATÁLOGO, ROL POR ROL ───────────────────────
  // Si una de las dos columnas se mueve, hay una extraordinaria con permisos
  // propios — y entonces alguien puede ver el avance sin ver de qué está hecho,
  // o puede escribir una obra que no puede escribir.
  console.log('\n2. Las extraordinarias se gobiernan igual que `avance/subs`');
  const actores = [
    ['el director general', await abrir(`dg-${sello}`, 'dg', cons('director_general', [], true))],
    ['el cliente de la obra', await abrir(`cli-${sello}`, 'cliente', cons('cliente', [OBRA]))],
    ['un residente de otra obra', await abrir(`aje-${sello}`, 'ajeno', cons('residente', [OTRA]))],
    ['el auditor', await abrir(`aud-${sello}`, 'auditor', cons('auditor', [OBRA]))],
  ];
  for (const [quien, db] of actores) {
    const rS = await intentar(() => getDoc(ruta(db, 'subs')));
    const rE = await intentar(() => getDoc(ruta(db, 'extraordinarias')));
    const wS = await intentar(() => setDoc(ruta(db, 'subs'), SUBS));
    const wE = await intentar(() => setDoc(ruta(db, 'extraordinarias'), EXTRAS));
    check(!!rS === !!rE && !!wS === !!wE,
      `${quien}: lo mismo en las dos rutas`,
      `subs lee ${rS ? 'no' : 'sí'}/escribe ${wS ? 'no' : 'sí'} · ` +
      `extraordinarias lee ${rE ? 'no' : 'sí'}/escribe ${wE ? 'no' : 'sí'}`);
  }

  // ── 3. LA DECISIÓN DE PRODUCTO, DICHA EN VOZ ALTA ───────────────────────
  // La simetría de arriba se cumpliría igual si las dos rutas estuvieran
  // cerradas al cliente. Esto afirma el contenido, no sólo la simetría.
  console.log('\n3. El cliente VE lo que se hizo fuera de catálogo');
  const cliente = actores[1][1];
  // Se lee UNA sola vez y se guarda lo leído. Releer el documento para sacarle
  // el convenio revienta el banco cuando la lectura está denegada —salida 2,
  // «no arrancó»— y eso sería mentir sobre el resultado: una regla que le
  // cierra la puerta al cliente está MEDIDA y en desacuerdo, o sea ROJA.
  let vistaCli = null;
  const cLee = await intentar(async () => {
    vistaCli = (await getDoc(ruta(cliente, 'extraordinarias'))).data();
  });
  check(!cLee,
    'el cliente lee las extraordinarias de su obra',
    cLee ? `DENEGADA: ${cLee.message} — vería el avance sin saber de qué está hecho` : 'las ve');
  check(vistaCli?.data?.[0]?.convenio === 'CONV-2026-03',
    'y ve el convenio con el que se le va a cobrar, no sólo el importe',
    vistaCli?.data?.[0]?.convenio);
  const cEsc = await intentar(() => setDoc(ruta(cliente, 'extraordinarias'), EXTRAS));
  check(cEsc && denegado(cEsc), 'pero no las escribe',
    cEsc ? 'rebotó' : 'ESCRIBIÓ — el cliente estaría autorizándose obra');

  // Y la frontera del margen no se movió de sitio: la extraordinaria es
  // ALCANCE, no economía del contratista. El cliente sigue sin ver maquinaria.
  const cMaq = await intentar(() => getDoc(ruta(cliente, 'maquinaria')));
  check(cMaq && denegado(cMaq),
    'y sigue sin ver la maquinaria: abrirle las extraordinarias no abrió el costo',
    cMaq ? 'rebotó' : 'LEYÓ la maquinaria — la frontera del margen se rompió');

  veredicto();
})().catch(e => { console.error(e); process.exit(2); });

// ── Contraprueba ────────────────────────────────────────────────────────────
// Rulesets DERIVADOS del archivo real. Se muta sólo el bloque de constructora
// —la primera aparición—, que es el que este banco juzga.
const DERIVACIONES = [
  ['la ruta no tiene regla (el #31 en la ruta nueva)',
    s => s.replace(/      match \/avance\/extraordinarias \{\n[^}]*\n      \}\n/, '')],
  ['al cliente se le ocultan las extraordinarias',
    s => s.replace(/(match \/avance\/extraordinarias \{\n\s*allow read: if puedeVerObraC\(obraId\))/,
                   '$1 && !esCliente()')],
  ['la escritura se abre a cualquiera que pueda VER la obra',
    s => s.replace(/(match \/avance\/extraordinarias \{\n\s*allow read: if puedeVerObraC\(obraId\);\n\s*allow write: if )puedeEditarObraC\(obraId\)/,
                   '$1puedeVerObraC(obraId)')],
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
      `contraprueba-reglas-extra-${Math.random().toString(36).slice(2)}.rules`);
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
  // El archivo del repositorio se vuelve a dejar puesto en el emulador: los
  // bancos que corren después cargan el suyo, pero dejar un ruleset mutilado
  // es exactamente el defecto que `reglas-del-repo.cjs` documenta.
  return malas;
}

async function veredicto() {
  const malas = contraprueba();
  // Si esta corrida derivó rulesets, el último que quedó puesto en el emulador
  // es uno MUTILADO. Se repone el del repositorio pase lo que pase: el banco
  // que corra después carga el suyo, pero el que lea sin cargar vería reglas
  // que nadie escribió.
  if (!process.env.SIN_CONTRAPRUEBA && !REGLAS_DERIVADAS) {
    await cargarReglas({ proyecto: PROYECTO, host: HOST, puerto: PUERTO, archivo: ARCH_REGLAS });
  }
  console.log('\n' + '─'.repeat(70));
  if (fallas === 0 && malas === 0) {
    console.log('El muro del convenio se guarda, se relee, y el cliente lo ve.');
    process.exit(0);
  }
  if (fallas) console.log(`${fallas} comprobación(es) en rojo. NO desplegar hasta resolverlas.`);
  if (malas) console.log(`${malas} contraprueba(s) no sirven.`);
  process.exit(1);
}
