#!/usr/bin/env node
// ¿La bitácora de auditoría respeta la frontera entre organizaciones?
// Se lo pregunta al MOTOR, y al ruleset que está PUBLICADO en producción.
//
// ── EL DEFECTO, MEDIDO AQUÍ EL 2026-10-22 ──────────────────────────────────
//
// `match /auditoria/{id}` vivía en la RAÍZ con
// `allow read: if esDirectivoC() || esDirectivoD()`. Ninguno de los dos
// ayudantes mira `orgId()` —`esDirectivoD()` sólo comprueba
// `tipo == 'dependencia'` y el rol— y la regla no miraba el documento. Contra
// el ruleset `1b223bc0`, las cuatro lecturas cruzadas salieron **ALLOW**: el
// municipio A leía la bitácora de la constructora y la del municipio B, y la
// constructora la del municipio A.
//
// Y dentro iba la economía del contratista: de las 4200 filas, 2212 llevan
// `monto`, `pu`, `pctRetencion`, `pctAnticipo`, `importeContrato` o
// `totalNomina` en `antes`/`despues`.
//
// Importaba ahora porque íbamos a empezar a escribir ahí `obraId`, correo,
// uid y ruta intentada para el rastro de permisos denegados: el arreglo del
// mensaje habría agravado la fuga.
//
// ── LO QUE MIDE DESDE EL ARREGLO (#73) ─────────────────────────────────────
//
// La colección se PARTIÓ por ruta: la raíz es de la constructora, cada
// dependencia tiene la suya bajo `/orgs/{oid}/auditoria`. Acotar por campo
// no se sostenía —ninguna de las 4200 filas trae `orgId`, y el documento lo
// redacta el cliente—. Un campo mal puesto filtra; una ruta mal puesta no
// existe.
//
// Este guion es el gemelo de producción de `prueba-frontera-de-la-bitacora.cjs`:
// aquel mide el archivo del repo en el emulador, éste mide lo que de verdad
// está decidiendo. Se corre DESPUÉS de cada despliegue de reglas.
//
// Medido contra el ruleset `ebd4f8bb` (2026-10-23), los 17 casos en verde.
// Contra `1b223bc0`, el de la víspera, 4 en rojo. Ojo al leer ese rojo: en el
// ruleset viejo la colección ENTERA vivía en la raíz, así que «la org A lee la
// bitácora de la org B» se manifestaba como «la org A lee la raíz», que es
// donde estaban las filas de todos. Los casos que apuntan a
// `/orgs/{oid}/auditoria` salen DENY ahí por una razón vacía —esa ruta no
// existía—, no porque hubiera frontera.
//
// NO ESCRIBE NADA: dos lecturas al servicio de reglas y una llamada a
// `:test`, que evalúa sin tocar Firestore.
//
// Uso:
//   node scripts/medir-auditoria-entre-inquilinos.cjs
//   node scripts/medir-auditoria-entre-inquilinos.cjs --ruleset <id>   (contraprueba)

const { execSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const PROYECTO = process.env.PROYECTO_PROD || 'campo-fosmon';
const API = 'https://firebaserules.googleapis.com/v1';

const DEP = (rol, org, extra = {}) => ({ tipo: 'dependencia', rol, orgId: org,
  todas: true, obras: [], ...extra });
const CON = (rol, extra = {}) => ({ tipo: 'constructora', rol, orgId: 'fosmon',
  todas: true, obras: [], ...extra });

// Tres filas de auditoría de tres inquilinos distintos. La regla no mira el
// contenido, pero se lo damos igual: así la medición dice «leyó ESTA fila,
// la de la constructora», no «leyó una ruta».
const FILA = (usuario, org, obra) => ({
  'usuario': { stringValue: usuario },
  'orgId':   { stringValue: org },
  'obraId':  { stringValue: obra },
  'tipo':    { stringValue: 'error_permiso' },
  'path':    { stringValue: `obras/${obra}/evidencia/x` },
});

// La RUTA es la frontera: por eso cada caso dice en cuál de las dos bitácoras
// está la fila que intenta tocar. Un caso que no diga su ruta no mide nada.
const RAIZ = 'auditoria';
const ORG = oid => `orgs/${oid}/auditoria`;

const DOC = (col, id, datos) => ({
  name: `projects/${PROYECTO}/databases/(default)/documents/${col}/${id}`,
  data: datos,
});

const caso = (nombre, expectation, col, id, method, token, datos) => ({
  nombre, expectation,
  request: {
    auth: { uid: 'sonda-medicion', token },
    path: `/databases/(default)/documents/${col}/${id}`,
    method,
    time: new Date().toISOString(),
  },
  ...(datos ? { resource: DOC(col, id, datos) } : {}),
});

// La expectativa de cada caso es LA FRONTERA QUE CREÍAMOS TENER. Un FALLA
// aquí no es un error del banco: es el motor diciendo que la frontera no
// está.
const CASOS = [
  // ── Las cuatro que salieron ALLOW contra `1b223bc0` ─────────────────────
  caso('un director de Obras de la org A NO lee la bitácora de la CONSTRUCTORA',
    'DENY', RAIZ, 'fila-constructora', 'get', DEP('director_obras', 'coatzacoalcos'),
    FILA('residente@fosmon.mx', 'fosmon', '0127')),

  caso('un director de Obras de la org A NO lee la bitácora de la ORG B',
    'DENY', ORG('veracruz'), 'fila-org-b', 'get', DEP('director_obras', 'coatzacoalcos'),
    FILA('super@veracruz.gob.mx', 'veracruz', 'OP-2026-999')),

  caso('un contralor de la org A tampoco (misma regla, rol de fiscalización)',
    'DENY', ORG('veracruz'), 'fila-org-b', 'get', DEP('contralor', 'coatzacoalcos'),
    FILA('super@veracruz.gob.mx', 'veracruz', 'OP-2026-999')),

  caso('un director_general de la constructora NO lee la bitácora de la org A',
    'DENY', ORG('coatzacoalcos'), 'fila-org-a', 'get', CON('director_general'),
    FILA('super@coatza.gob.mx', 'coatzacoalcos', 'OP-2026-001')),

  // Y la ruta vieja no queda de puerta trasera: una fila de dependencia
  // colgada de la raíz la leería cualquier directivo de la constructora.
  // Por eso el cliente ya no escribe ahí (ver `rutaAuditoria`).
  caso('la org A tampoco lee la RAÍZ aunque el documento diga ser suyo',
    'DENY', RAIZ, 'fila-org-a', 'get', DEP('director_obras', 'coatzacoalcos'),
    FILA('super@coatza.gob.mx', 'coatzacoalcos', 'OP-2026-001')),

  // ── Contraste: lo que SÍ debe poder leer cada quien ─────────────────────
  // Si estos salieran en rojo, el problema sería el banco, no la regla.
  caso('un director de Obras de la org A SÍ lee la bitácora de su PROPIA org',
    'ALLOW', ORG('coatzacoalcos'), 'fila-org-a', 'get',
    DEP('director_obras', 'coatzacoalcos'),
    FILA('super@coatza.gob.mx', 'coatzacoalcos', 'OP-2026-001')),

  caso('un director_general de la constructora SÍ lee la suya',
    'ALLOW', RAIZ, 'fila-constructora', 'get', CON('director_general'),
    FILA('residente@fosmon.mx', 'fosmon', '0127')),

  // ── Quienes NO son directivos siguen sin leer ───────────────────────────
  caso('un supervisor de obra no lee la bitácora de su org',
    'DENY', ORG('coatzacoalcos'), 'fila-org-a', 'get',
    DEP('supervisor_obra', 'coatzacoalcos', { todas: false, obras: ['OP-2026-001'] }),
    FILA('super@coatza.gob.mx', 'coatzacoalcos', 'OP-2026-001')),

  caso('un contratista tampoco',
    'DENY', ORG('coatzacoalcos'), 'fila-org-a', 'get',
    DEP('contratista', 'coatzacoalcos'),
    FILA('super@coatza.gob.mx', 'coatzacoalcos', 'OP-2026-001')),

  // El auditor, un nivel más abajo que la pregunta del panel ejecutivo. Si
  // `esDirectivoC()` lo incluyera, leería las 2212 filas con `pu`,
  // `pctRetencion`, `pctAnticipo` y `totalNomina` en `antes`/`despues`.
  caso('un auditor de constructora NO lee la bitácora de su propia org',
    'DENY', RAIZ, 'fila-constructora', 'get', CON('auditor'),
    FILA('residente@fosmon.mx', 'fosmon', '0127')),

  caso('ni un cliente, que tampoco es directivo',
    'DENY', RAIZ, 'fila-constructora', 'get', CON('cliente'),
    FILA('residente@fosmon.mx', 'fosmon', '0127')),

  // ── La circularidad: crear no depende de la obra ────────────────────────
  // Es la pieza en la que se apoya el rastro de permisos denegados. Si
  // `create` pidiera la obra, el denegado por no tener la obra tampoco
  // podría dejar constancia de que se lo denegaron.
  caso('un supervisor SIN la obra asignada SÍ deja constancia en su org',
    'ALLOW', ORG('coatzacoalcos'), 'nueva', 'create',
    DEP('supervisor_obra', 'coatzacoalcos', { todas: false, obras: ['OTRA'] })),

  caso('un residente de la constructora SIN la obra también, en la raíz',
    'ALLOW', RAIZ, 'nueva', 'create',
    CON('residente', { todas: false, obras: ['OTRA'] })),

  // Pero constancia en la bitácora PROPIA, no en la del vecino.
  caso('y no la deja en la bitácora de la ORG B',
    'DENY', ORG('veracruz'), 'nueva', 'create',
    DEP('supervisor_obra', 'coatzacoalcos')),

  caso('ni la constructora en la de la org A',
    'DENY', ORG('coatzacoalcos'), 'nueva', 'create', CON('director_general')),

  // ── Append-only ─────────────────────────────────────────────────────────
  caso('una vez escrita, nadie la corrige: append-only',
    'DENY', ORG('coatzacoalcos'), 'fila-org-a', 'update',
    DEP('director_obras', 'coatzacoalcos'),
    FILA('super@coatza.gob.mx', 'coatzacoalcos', 'OP-2026-001')),

  caso('ni la borra el director_general de la constructora',
    'DENY', RAIZ, 'fila-constructora', 'delete', CON('director_general'),
    FILA('residente@fosmon.mx', 'fosmon', '0127')),
];

const token = () => {
  try {
    return execSync('gcloud auth application-default print-access-token',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    noArranco.sinPrecondicion(
      'credenciales de aplicación para leer el servicio de reglas de producción',
      ['gcloud auth application-default login']);
  }
};

(async () => {
  const TOKEN = token();
  const cab = { Authorization: `Bearer ${TOKEN}` };

  const pedir = async (url, init) => {
    let r;
    try { r = await fetch(url, init); }
    catch (e) { noArranco.sinPrecondicion(`no se pudo hablar con ${API} (${e.message})`,
      ['Hace falta red: esto mide PRODUCCIÓN, no el emulador.']); }
    if (!r.ok) noArranco.sinPrecondicion(
      `el servicio de reglas respondió ${r.status}`, [(await r.text()).slice(0, 400)]);
    return r.json();
  };

  // `--ruleset <id>` le hace las MISMAS preguntas a un ruleset viejo. Es la
  // contraprueba de este guion: contra `1b223bc0`, el que estaba publicado
  // antes del arreglo, tiene que salir en rojo. Un medidor que sólo sabe
  // decir verde no es un medidor.
  const iArg = process.argv.indexOf('--ruleset');
  const pedido = iArg >= 0 ? process.argv[iArg + 1] : null;
  if (iArg >= 0 && !pedido) noArranco.sinPrecondicion(
    '`--ruleset` sin id', ['node scripts/medir-auditoria-entre-inquilinos.cjs --ruleset <id>']);

  let nombreRuleset;
  if (pedido) {
    nombreRuleset = `projects/${PROYECTO}/rulesets/${pedido}`;
  } else {
    const rels = await pedir(`${API}/projects/${PROYECTO}/releases`, { headers: cab });
    const rel = (rels.releases || []).find(x => x.name.endsWith('cloud.firestore'));
    if (!rel) noArranco.sinPrecondicion(
      `el proyecto ${PROYECTO} no tiene una release de cloud.firestore`, []);
    nombreRuleset = rel.rulesetName;
  }

  const meta = await pedir(`${API}/${nombreRuleset}`, { headers: cab });
  const fuente = meta.source.files.map(f => f.content).join('\n');

  console.log(pedido
    ? `\nCONTRAPRUEBA: ruleset PEDIDO a mano en ${PROYECTO}`
    : `\nReglas PUBLICADAS en ${PROYECTO}`);
  console.log(`  ruleset   ${nombreRuleset.split('/').pop()}`);
  console.log(`  publicado ${meta.createTime}\n`);

  const res = await pedir(`${API}/projects/${PROYECTO}:test`,
    { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: { files: [{ name: 'firestore.rules', content: fuente }] },
        testSuite: { testCases: CASOS.map(c => {
          const t = { expectation: c.expectation, request: c.request };
          if (c.resource) t.resource = c.resource;
          return t;
        }) } }) });

  const errores = (res.issues || []).filter(i => i.severity === 'ERROR');
  if (errores.length) noArranco.sinPrecondicion(
    `el ruleset ${nombreRuleset.split('/').pop()} no compila contra el motor de pruebas`,
    errores.map(e => `L${e.sourcePosition && e.sourcePosition.line}: ${e.description}`));

  let malos = 0;
  (res.testResults || []).forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) malos++;
    const dijo = ok ? CASOS[i].expectation : (CASOS[i].expectation === 'DENY' ? 'ALLOW' : 'DENY');
    console.log(`  ${ok ? ' ok  ' : 'FALLA'}  [motor: ${dijo.padEnd(5)}] ${CASOS[i].nombre}`);
  });

  const cual = pedido ? `el ruleset ${pedido}` : 'las reglas PUBLICADAS';
  if (malos === 0) {
    console.log(`\nLa frontera entre organizaciones está puesta en \`auditoria\`, según ${cual}.`);
    process.exit(0);
  }
  console.log(`\n${malos} de ${CASOS.length} en ROJO contra ${cual}.`);
  if (pedido) console.log(
    'Era una contraprueba: el rojo es lo que se esperaba de un ruleset sin la frontera.');
  process.exit(1);
})();
