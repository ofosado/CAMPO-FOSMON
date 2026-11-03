#!/usr/bin/env node
// El renglón sí quedó, y el canal gritaba que no.
//
// ── EL DEFECTO (#87) ───────────────────────────────────────────────────────
//
// Visto en consola el 2026-11-03: cuatro
//
//   fsAudit: el renglón NO quedó en la bitácora · logout already-exists — va a la cola
//
// El mensaje es falso, y de los dos lados. `addDoc` manda su escritura con una
// precondición —`Precondition.exists(false)`, dentro del SDK— y el id lo
// genera el cliente, veinte caracteres al azar que nunca se reusan. Por eso
// `already-exists` no puede ser una colisión con el renglón de otro: dice que
// ESA MISMA mutación ya se escribió. El stream la reintenta cuando se corta
// sin recibir el acuse, y el segundo intento rebota contra lo que dejó el
// primero.
//
// Lo que pasaba entonces era doble:
//
//   1. El canal del #75 —el que existe para que una bitácora que se cae no se
//      caiga callada— gritaba por un renglón que SÍ estaba. Un canal que
//      grita en falso se deja de creer, y es el mismo canal con el que
//      pensamos enterarnos de los fallos de verdad. Es el #22 al revés.
//   2. Acto seguido encolaba una copia. Al drenar, la copia aterrizaba como un
//      SEGUNDO renglón con el mismo `ts` y otro id. Así se vio: dos `logout`
//      de `gerencia@fosmon.com.mx` con el sello `2026-11-03T17:31:16.543Z`.
//      Un duplicado en el expediente, puesto por nosotros.
//
// Y la causa de que el reintento ocurriera al cerrar sesión: `logout` llamaba
// a `fsAudit` SIN `await` y luego hacía `await signOut`. La escritura se
// quedaba en vuelo y la sesión se iba debajo.
//
// ── LO QUE AFIRMA ESTE BANCO ───────────────────────────────────────────────
//
//  §1  EL ERROR ES REAL Y EL RENGLÓN ESTÁ. No se inventa un `{code:...}`: se
//      reproduce la carrera contra el emulador —mutación en la cola local, el
//      id ocupado desde otra conexión, y la red de vuelta— y se mide que el
//      rechazo trae `already-exists` Y que la bitácora tiene el renglón. Toda
//      la clasificación de abajo descansa en esas dos cosas juntas; si alguna
//      deja de ser cierta, lo que sigue no vale y este banco se pone rojo
//      antes que nada.
//  §2  `fsAudit` CON ESE ERROR —el objeto que devolvió el emulador, no una
//      maqueta— no grita, no encola, y dice que quedó. Porque quedó.
//  §3  CON `permission-denied` —también del emulador— sigue gritando y
//      encolando. La mitad que no se puede perder al arreglar la otra.
//  §4  LA COLA no reintenta para siempre lo que ya está escrito, y no se
//      cobra como entregado lo que no entregó: `yaEstaban` va aparte de
//      `enviados`.
//  §5  `logout` ESPERA el renglón antes de `signOut` —ahí nacía la carrera— y
//      con tope, porque en obra sin señal la promesa de escritura no se
//      resuelve y un `await` pelado dejaría al usuario sin poder salir.
//
// Ejecuta `fsAudit` y `logout` sacados de `src/App.jsx`, y `drenarCola` y
// `yaEstabaEscrito` del módulo que importa la app. Ninguna cuenta se copia.
//
// ── LO QUE NO MIDE ─────────────────────────────────────────────────────────
// Que el SDK siga mandando la precondición. Eso no se afirma leyendo su
// código: §1 lo ejercita, y el día que el SDK cambie de conducta §1 es lo que
// se pone rojo — que es donde tiene que doler, porque ese día `already-exists`
// dejaría de significar «ya quedó» y la clasificación sería incorrecta.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-el-canal-no-grita-en-falso.cjs
//   node scripts/prueba-el-canal-no-grita-en-falso.cjs --contraprueba

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const ARCH_APP = process.env.ARCH_APP || path.join(raiz, 'src/App.jsx');
const ARCH_PERMISO = process.env.ARCH_PERMISO || path.join(raiz, 'src/permiso-denegado.js');

// ── La contraprueba ────────────────────────────────────────────────────────
// Cada mutación es una forma concreta de volver al #87, o de romper la mitad
// que lo acompaña. Las de `App.jsx` y las del módulo van juntas a propósito:
// la clasificación vive repartida entre los dos y romperla por cualquiera de
// los dos lados tiene que verse.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    // El defecto entero, por su raíz: si `already-exists` no significa nada,
    // volvemos a gritar y a encolar la copia.
    { arch: 'permiso', nombre: 'already-exists vuelve a contar como fallo',
      de: "export function yaEstabaEscrito(e) {\n  return e?.code === 'already-exists';",
      a:  "export function yaEstabaEscrito(e) {\n  return false;" },

    // El mismo defecto entrando por el otro lado: el módulo clasifica bien
    // pero `fsAudit` no le pregunta.
    { arch: 'app', nombre: 'fsAudit no clasifica: grita y encola el que ya quedó',
      de: '    if (yaEstabaEscrito(e)) return true;\n    console.error("fsAudit: el renglón NO quedó',
      a:  '    if (false) return true;\n    console.error("fsAudit: el renglón NO quedó' },

    // El espejo, que es peor: callarse TODO. Un canal que nunca grita es el
    // defecto que el #75 existe para no tener.
    { arch: 'app', nombre: 'fsAudit se calla todo: cualquier fallo pasa por «ya quedó»',
      de: '    if (yaEstabaEscrito(e)) return true;\n    console.error("fsAudit: el renglón NO quedó',
      a:  '    if (true) return true;\n    console.error("fsAudit: el renglón NO quedó' },

    // Lo mismo en el rastro de denegación: es el otro escritor de la bitácora.
    { arch: 'app', nombre: 'el rastro de denegación sí encola la copia',
      de: "    if (yaEstabaEscrito(e)) return true;\n    console.error('rastro de denegación",
      a:  "    if (false) return true;\n    console.error('rastro de denegación" },

    // La fila ya escrita se queda en la cola: al próximo arranque se reintenta
    // y rebota otra vez. Una cola que no se vacía nunca.
    { arch: 'permiso', nombre: 'la cola reintenta para siempre lo que ya está escrito',
      de: '      if (yaEstabaEscrito(e)) { yaEstaban++; continue; }',
      a:  '      if (false) { yaEstaban++; continue; }' },

    // Se cobra como entregada una escritura que no hizo. El número deja de
    // decir qué pasó, que es para lo que está.
    { arch: 'permiso', nombre: 'la cola cuenta como entregado lo que ya estaba',
      de: '      if (yaEstabaEscrito(e)) { yaEstaban++; continue; }',
      a:  '      if (yaEstabaEscrito(e)) { enviados++; continue; }' },

    // El código de ayer, tal cual: la carrera de vuelta.
    { arch: 'app', nombre: 'logout no espera el renglón: la carrera de vuelta',
      de: '      await Promise.race([\n        fsAudit("logout", { modulo: "sesion", entidad: usuario?.correo || "" }),\n        new Promise(r => setTimeout(r, 3000)),\n      ]);',
      a:  '      fsAudit("logout", { modulo: "sesion", entidad: usuario?.correo || "" });' },

    // Sin tope: en obra sin señal el botón de salir deja de funcionar.
    { arch: 'app', nombre: 'logout sin tope: sin señal el usuario no puede salir',
      de: '      await Promise.race([\n        fsAudit("logout", { modulo: "sesion", entidad: usuario?.correo || "" }),\n        new Promise(r => setTimeout(r, 3000)),\n      ]);',
      a:  '      await fsAudit("logout", { modulo: "sesion", entidad: usuario?.correo || "" });' },
  ];
  const DE = { app: ARCH_APP, permiso: ARCH_PERMISO };
  const ENV = { app: 'ARCH_APP', permiso: 'ARCH_PERMISO' };
  const EXT = { app: '.jsx', permiso: '.js' };
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(DE[m.arch], 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en ${path.relative(raiz, DE[m.arch])}.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(),
      `canal-mut-${Date.now()}-${Math.random().toString(36).slice(2)}${EXT[m.arch]}`);
    fs.writeFileSync(roto, base.replace(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, [ENV[m.arch]]: roto } });
    const rojas = ((r.stdout || '').match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      if (r.status === 2) console.log('             (salió NO ARRANCÓ: la prueba se cayó, que no es lo mismo que ver el defecto.)');
    }
    try { fs.unlinkSync(roto); } catch {}
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven.`
    : `\n${malas} de ${MUTACIONES.length} NO se ven.`);
  process.exit(malas === 0 ? 0 : 1);
}

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, collection, addDoc, doc, setDoc,
        getDocs, disableNetwork, enableNetwork } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const { cargarReglas } = require('./reglas-del-repo.cjs');
const { limpiarDatos } = require('./emulador-limpio.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');

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
const DIRECTIVO = { tipo: 'constructora', rol: 'admin_sistema', orgId: 'fosmon',
  todas: true, obras: [] };

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Un `localStorage` de mentira: lo que la app toca de él y nada más.
const almacenDeMentira = () => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _crudo: () => m,
  };
};

// ── EXTRACCIÓN ─────────────────────────────────────────────────────────────
// `fsAudit` y `dejarRastroDenegacion` son de nivel de módulo. `logout` vive
// DENTRO del componente, así que se saca recorriendo el AST y se pega junto al
// cuerpo del módulo: sin eso habría que teclear sus dependencias a mano, que
// es la copia que se desincroniza.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const PIEZAS_MODULO = ['fsAudit', 'dejarRastroDenegacion', 'escribirRastroDenegacion'];
let cuerpoModulo;
try {
  cuerpoModulo = fuenteDe(ARCH_APP, PIEZAS_MODULO).cuerpo;
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('\nSi la escritura de la bitácora se movió, este banco hay que apuntarlo al');
  console.error('camino nuevo, no borrarlo: lo que afirma —que el canal no grite en falso—');
  console.error('sigue siendo cierto.');
  process.exit(noArranco.NO_ARRANCO);
}

const srcApp = fs.readFileSync(ARCH_APP, 'utf8');
const dentro = {};
traverse(parse(srcApp, { sourceType: 'module', plugins: ['jsx'] }), {
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn) return;
    const llave = `${fn.node.id.name}.${p.node.id.name}`;
    if (!(llave in dentro)) dentro[llave] = srcApp.slice(p.node.init.start, p.node.init.end);
  },
});
if (!('App.logout' in dentro)) noArranco(['App.logout'], path.relative(raiz, ARCH_APP));

// Arma un trozo con todo inyectado por parámetro: los nombres que se pasan
// SOMBREAN cualquier global, y por eso `console` y `setTimeout` de mentira
// llegan hasta dentro del código de la app sin tocarlo.
//
// `conModulo` decide si se pega el cuerpo del módulo. Para `fsAudit` hace
// falta —ahí vive—; para `logout` NO, y no por ahorrar: el cuerpo declara
// `function fsAudit`, que al pegarse PISA el espía con el mismo nombre y
// `logout` acabaría llamando a la función de verdad. El banco mediría
// entonces el orden de otra cosa.
const armar = (expresion, inyecciones, { conModulo = true } = {}) => new Function(
  ...Object.keys(inyecciones),
  `"use strict";\n${conModulo ? cuerpoModulo : ''}\nreturn (${expresion});`
)(...Object.values(inyecciones));

(async () => {
  await limpiarDatos({ proyecto: PROYECTO, host: HOST, puerto: PUERTO });
  console.log(`(reglas cargadas desde ${await cargarReglas(
    { proyecto: PROYECTO, host: HOST, puerto: PUERTO })})`);

  let M;
  try { M = await import('file://' + ARCH_PERMISO); }
  catch (e) { noArranco.sinPrecondicion(`no se pudo cargar ${ARCH_PERMISO}`, [e.message]); }
  const { encolarRastro, leerCola, drenarCola, yaEstabaEscrito } = M;
  for (const [n, f] of Object.entries({ encolarRastro, leerCola, drenarCola, yaEstabaEscrito })) {
    if (typeof f !== 'function') noArranco.sinPrecondicion(
      `${path.relative(raiz, ARCH_PERMISO)} no expone ${n}`, []);
  }

  const conexion = async (nombre, uid) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'fake-api-key' },
      `${nombre}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    await signInWithCustomToken(auth, tokenDe(uid, DIRECTIVO));
    return { app, auth, db };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // §1 · EL ERROR ES REAL Y EL RENGLÓN ESTÁ
  //
  // Se reproduce la carrera, no se imita: la mutación se queda en la cola
  // local con su id ya generado, otra conexión ocupa ese id —que es lo que
  // hace el PRIMER intento cuando el acuse se pierde— y al volver la red la
  // nuestra sale con su precondición contra lo que ya está escrito.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n§1 · el rechazo que da el emulador, y lo que hay en la bitácora');

  const tarde = await conexion('tarde', 'u-tarde');
  const antes = await conexion('antes', 'u-antes');
  const marca = 'carrera-' + Date.now();
  const fila = { tipo: 'logout', usuario: 'gerencia@fosmon.com.mx', nombre: 'Banco',
    rol: 'admin_sistema', obraId: null, obraNombre: '', modulo: 'sesion',
    entidad: marca, path: '', ts: new Date().toISOString(), userAgent: 'banco' };

  await disableNetwork(tarde.db);
  let errorReal = null;
  const enVuelo = addDoc(collection(tarde.db, 'auditoria'), fila)
    .then(() => null, e => { errorReal = e; });

  const enCache = await getDocs(collection(tarde.db, 'auditoria'));
  const ids = enCache.docs.filter(d => d.data()?.entidad === marca).map(d => d.id);
  if (ids.length !== 1) noArranco.sinPrecondicion(
    `no se pudo leer del cache el id que generó el cliente (encontrados: ${ids.length})`,
    ['El SDK dejó de aplicar la mutación al cache local antes de mandarla, o',
     '`disableNetwork` ya no retiene la escritura. Sin eso no se puede',
     'reproducir la carrera y este banco no mide nada.']);

  await setDoc(doc(antes.db, 'auditoria', ids[0]), { ...fila, quien: 'el-primer-intento' });
  await enableNetwork(tarde.db);
  await enVuelo;

  check(errorReal !== null && errorReal.code === 'already-exists',
    'el emulador rechaza la segunda mutación con `already-exists`',
    errorReal ? `code=${errorReal.code}` : 'no rechazó nada');

  const trasCarrera = await getDocs(collection(antes.db, 'auditoria'));
  const quedaron = trasCarrera.docs.filter(d => d.data()?.entidad === marca);
  check(quedaron.length === 1,
    'y el renglón SÍ está en la bitácora: por eso el grito era falso',
    `${quedaron.length} renglón(es) con la marca`);

  check(yaEstabaEscrito(errorReal) === true,
    'la clasificación reconoce ESE error, el del emulador');

  // El error de la otra mitad, también del emulador: una sesión sin claims de
  // constructora no puede crear en `auditoria` (la regla pide `esConstructora()`).
  const ajeno = initializeApp({ projectId: PROYECTO, apiKey: 'fake-api-key' },
    `ajeno-${Date.now()}`);
  const ajenoDb = getFirestore(ajeno);
  connectFirestoreEmulator(ajenoDb, HOST, PUERTO);
  let errorNegado = null;
  try { await addDoc(collection(ajenoDb, 'auditoria'), fila); }
  catch (e) { errorNegado = e; }
  check(errorNegado !== null && errorNegado.code === 'permission-denied',
    'y el ruleset del repo sigue dando `permission-denied` cuando de verdad no quedó',
    errorNegado ? `code=${errorNegado.code}` : 'no rechazó nada');
  check(yaEstabaEscrito(errorNegado) === false,
    'que la clasificación NO confunde con el anterior');

  // ───────────────────────────────────────────────────────────────────────────
  // §2 · `fsAudit` CON EL ERROR DEL EMULADOR
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n§2 · fsAudit cuando el renglón ya estaba escrito');

  // Los DOS escritores de la bitácora, con el mismo mundo de mentira: el de la
  // conducta del usuario y el del rastro de denegación. El #87 se vio en el
  // primero, pero la lectura equivocada de `already-exists` estaba igual en el
  // segundo, y un patrón se arregla en todo el repositorio o no se arregló.
  const conMundo = (error) => {
    const almacen = almacenDeMentira();
    const gritos = [];
    const { fsAudit, dejarRastroDenegacion } = armar(
      '{ fsAudit, dejarRastroDenegacion }', {
        rutaAuditoria: () => 'auditoria',
        encolarRastro, yaEstabaEscrito,
        collection: (_db, ruta) => ({ ruta }),
        addDoc: async () => { if (error) throw error; },
        // El cuerpo extraído trae consigo `const fbDb = getFirestore(fbApp)`,
        // así que lo que se sustituye son las fábricas, no `fbDb`: declararlo
        // por parámetro choca con el `const` del archivo.
        initializeApp: () => ({}),
        getFirestore: () => ({}),
        localStorage: almacen,
        navigator: { userAgent: 'banco' },
        console: { ...console, error: (...a) => gritos.push(a.join(' ')) },
      });
    return { fsAudit, dejarRastroDenegacion, gritos, cola: () => leerCola(almacen) };
  };

  const correrFsAudit = async (error) => {
    const m = conMundo(error);
    const devuelto = await m.fsAudit('logout', { modulo: 'sesion', entidad: 'quien@sea' });
    return { devuelto, gritos: m.gritos, cola: m.cola() };
  };

  const correrRastro = async (error) => {
    const m = conMundo(error);
    const devuelto = await m.dejarRastroDenegacion(
      { caso: 'inexplicado', obraId: '0114', ts: new Date().toISOString() });
    return { devuelto, gritos: m.gritos, cola: m.cola() };
  };

  const yaEstaba = await correrFsAudit(errorReal);
  check(yaEstaba.devuelto === true,
    'dice que quedó, porque quedó',
    `devolvió ${JSON.stringify(yaEstaba.devuelto)}`);
  check(yaEstaba.gritos.length === 0,
    'y no grita: el canal no se gasta en un renglón que sí está',
    yaEstaba.gritos.length ? yaEstaba.gritos[0].slice(0, 70) : 'sin grito');
  check(yaEstaba.cola.length === 0,
    'y NO encola la copia — ahí nacían los dos renglones con el mismo sello',
    `${yaEstaba.cola.length} fila(s) en la cola`);

  const rastroYaEstaba = await correrRastro(errorReal);
  check(rastroYaEstaba.devuelto === true && rastroYaEstaba.cola.length === 0
        && rastroYaEstaba.gritos.length === 0,
    'y el rastro de denegación, que es el otro escritor, hace lo mismo',
    `devolvió ${JSON.stringify(rastroYaEstaba.devuelto)}, `
      + `cola=${rastroYaEstaba.cola.length}, gritos=${rastroYaEstaba.gritos.length}`);

  // ───────────────────────────────────────────────────────────────────────────
  // §3 · LA MITAD QUE NO SE PUEDE PERDER
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n§3 · fsAudit cuando de verdad no quedó');

  const negado = await correrFsAudit(errorNegado);
  check(negado.gritos.length === 1 && /NO quedó en la bitácora/.test(negado.gritos[0]),
    'sigue gritando que el renglón no quedó',
    negado.gritos.length ? negado.gritos[0].slice(0, 60) : 'no gritó');
  check(negado.cola.length === 1 && negado.cola[0].fila?.tipo === 'logout',
    'y lo encola, con su ruta, para el próximo arranque',
    `${negado.cola.length} fila(s)`);
  check(negado.cola[0]?.ruta === 'auditoria',
    'con la ruta que resolvió la sesión que lo sufrió (#73)');

  const rastroNegado = await correrRastro(errorNegado);
  check(rastroNegado.gritos.length === 1 && rastroNegado.cola.length === 1,
    'y el rastro de denegación también sigue gritando y encolando',
    `gritos=${rastroNegado.gritos.length}, cola=${rastroNegado.cola.length}`);

  const bien = await correrFsAudit(null);
  check(bien.devuelto === true && bien.gritos.length === 0 && bien.cola.length === 0,
    'y cuando escribe sin tropiezo, ni grita ni encola');

  // ───────────────────────────────────────────────────────────────────────────
  // §4 · LA COLA NO REINTENTA LO QUE YA ESTÁ, NI SE LO COBRA
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n§4 · el drenado de una fila que ya estaba escrita');

  const almacenCola = almacenDeMentira();
  encolarRastro('auditoria', { ...fila, entidad: 'la-que-ya-esta' }, almacenCola);
  encolarRastro('auditoria', { ...fila, entidad: 'la-que-no-pudo' }, almacenCola);
  const escritas = [];
  const res = await drenarCola(almacenCola, async (ruta, f) => {
    if (f.entidad === 'la-que-ya-esta') throw errorReal;
    if (f.entidad === 'la-que-no-pudo') throw errorNegado;
    escritas.push({ ruta, f });
  }, null);

  check(res.yaEstaban === 1, 'la que ya estaba se cuenta aparte', `yaEstaban=${res.yaEstaban}`);
  check(res.enviados === 0,
    'y NO como entregada: esa escritura no la hizo este drenado',
    `enviados=${res.enviados}`);
  check(res.pendientes === 1 && leerCola(almacenCola).length === 1,
    'sale de la cola — si se quedara, cada arranque escribiría el duplicado',
    `pendientes=${res.pendientes}, cola=${leerCola(almacenCola).length}`);
  check(leerCola(almacenCola)[0]?.fila?.entidad === 'la-que-no-pudo',
    'y la que de verdad no pudo sí se queda a esperar');

  // ───────────────────────────────────────────────────────────────────────────
  // §5 · `logout` ESPERA EL RENGLÓN, Y CON TOPE
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n§5 · el orden de logout');

  const correrLogout = ({ auditTarda, topeDispara }) => {
    const orden = [];
    const inerte = () => {};
    const inyecciones = {
      usuario: { correo: 'gerencia@fosmon.com.mx' },
      fsAudit: (tipo) => new Promise(res => {
        orden.push('audit:empieza:' + tipo);
        if (auditTarda === 'nunca') return;           // la obra sin señal
        setTimeout(() => { orden.push('audit:termina'); res(true); }, 20);
      }),
      signOut: async () => { orden.push('signOut'); },
      fbAuth: {},
      // El tope de la app: aquí se decide si vence o no, sin esperar 3s.
      setTimeout: (fn) => { if (topeDispara) fn(); return 0; },
      limpiarPrefijoOrg: () => { orden.push('limpiarPrefijoOrg'); },
      setObras: inerte, setDatosPorObra: inerte, setMarca: inerte,
      setAuditCtx: inerte, setPermisosObraOverride: inerte,
      setUsuario: inerte, setScreen: inerte, setObraId: inerte,
    };
    const logout = armar(dentro['App.logout'], inyecciones, { conModulo: false });
    return { orden, promesa: logout() };
  };

  // Caso normal: la escritura responde, el tope no vence.
  const normal = correrLogout({ auditTarda: 20, topeDispara: false });
  await Promise.race([normal.promesa, new Promise(r => setTimeout(r, 1500))]);
  const iAudit = normal.orden.indexOf('audit:termina');
  const iSalir = normal.orden.indexOf('signOut');
  check(iAudit !== -1 && iSalir !== -1 && iAudit < iSalir,
    'el renglón se termina de escribir ANTES de cerrar la sesión',
    normal.orden.join(' → ') || 'no corrió');

  // Sin señal: la promesa de escritura no se resuelve nunca y el tope vence.
  const sinSenal = correrLogout({ auditTarda: 'nunca', topeDispara: true });
  const salio = await Promise.race([
    sinSenal.promesa.then(() => 'terminó'),
    new Promise(r => setTimeout(() => r('colgado'), 1500)),
  ]);
  check(salio === 'terminó',
    'y sin señal el botón de salir igual sale: el tope vence y se cierra',
    `logout ${salio}`);
  check(sinSenal.orden.includes('signOut') && sinSenal.orden.includes('limpiarPrefijoOrg'),
    'con la sesión cerrada y el prefijo limpio, no a medias',
    sinSenal.orden.join(' → '));

  // ───────────────────────────────────────────────────────────────────────────
  console.log('');
  if (fallas === 0) {
    console.log('Todo verde: el canal grita sólo cuando el renglón no está, y la cola');
    console.log('no vuelve a escribir lo que ya se escribió.');
  } else {
    console.log(`${fallas} en rojo.`);
  }
  process.exit(fallas === 0 ? 0 : 1);
})();
