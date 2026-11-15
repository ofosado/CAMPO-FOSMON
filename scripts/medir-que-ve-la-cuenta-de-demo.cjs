#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// QUÉ VE —Y QUÉ NO— LA CUENTA DE DEMO DE LA DEPENDENCIA (#69)
// ════════════════════════════════════════════════════════════════════════════
//
// El 2026-11-15 se copiaron la 0128 y la 0131 bajo `orgs/coatzacoalcos/obras`
// con su catálogo y su curva, para enseñarle a un director de Obras Públicas
// cómo operaría. Las originales siguen en la RAÍZ, y ahí dentro vive la
// economía del contratista: `nomina/historial` (22 KB de nómina en la 0128),
// `config/otros_gastos`, `avance/maquinaria`, `avance/materiales`.
//
// Que la copia no se trajera esos documentos ya está medido por lectura. Eso
// NO es lo que mide este guion. Este mide la otra mitad, la que no se ve
// leyendo datos: **que la cuenta de demo no pueda alcanzar los originales**.
// Porque si pudiera, no haría falta que algo hubiera cruzado — le bastaría
// con pedirlo.
//
// Se le pregunta al MOTOR DE REGLAS con el ruleset PUBLICADO, no al del repo:
// lo que protege al cliente el día de la demo es lo que está publicado.
//
// Las dos mitades que mide:
//
//   a) PUEDE recorrer la demo: ve sus dos obras, su catálogo, su curva, y
//      puede escribir `avance/subs` —que no se sembró a propósito, porque la
//      app lo deriva del catálogo en la primera carga (src/App.jsx:27321); si
//      esa escritura rebotara, la pantalla de captura saldría vacía en la
//      demo— y puede subir evidencia.
//
//   b) NO alcanza nada de la constructora: ni la obra original en la raíz, ni
//      su nómina, ni sus otros gastos, ni la bitácora de la raíz. Y al revés:
//      la constructora no entra a la org de la dependencia.
//
// Y mide una tercera cosa que no es frontera sino producto: el `contralor`
// fiscaliza y NO corrige. Si un día esa línea se afloja, la demo seguiría
// viéndose bien y el principio estaría roto.
//
// Uso:
//   node scripts/medir-que-ve-la-cuenta-de-demo.cjs
//   node scripts/medir-que-ve-la-cuenta-de-demo.cjs --ruleset <id>   (contraprueba)
//
// Tres estados: verde 0 · ROJO 1 · NO ARRANCÓ 2.
//
// ── LO QUE LA CONTRAPRUEBA DEMUESTRA, Y LO QUE NO ──────────────────────────
//
// Las dos mitades muerden, medido el 2026-11-15 contra rulesets de verdad:
//
//   --ruleset 0330d4de  (2026-07-16)  → 11 ROJAS, todas de la mitad ALLOW:
//       ahí no existían las rutas de dependencia y todo salía DENY. Prueba
//       que los casos «puede recorrer la demo» no son verdes de adorno.
//
//   --ruleset 1b223bc0  (2026-10-22)  → 3 ROJAS, y una es de la mitad DENY:
//       «NO lee la bitácora de la raíz» sale **ALLOW**. Es la fuga del #73,
//       que este guion vuelve a encontrar por su cuenta sin saber nada de él.
//
// Lo que NO está demostrado por mutación: los casos de `nomina`,
// `otros_gastos` y la obra original de la raíz salen DENY en todos los
// rulesets de la historia del proyecto, porque esas rutas siempre pidieron
// `esDirectivoC()`. O sea que para esos la contraprueba no existe todavía —
// son verdes consistentes, no verdes probados. Si un día se afloja el lado
// constructora, este guion lo va a ver; pero no se puede decir que hoy esté
// midiendo esa frontera con la misma fuerza que las otras dos.

'use strict';

const { execSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const PROYECTO = process.env.PROYECTO_PROD || 'campo-fosmon';
const API = 'https://firebaserules.googleapis.com/v1';

// La org y las obras son las de verdad: las que se sembraron. Un medidor con
// ids inventados mediría una frontera que nadie va a cruzar.
const ORG = 'coatzacoalcos';
const OBRAS = ['0128', '0131'];

// `todas: true` es el claim que tiene la cuenta sembrada (se leyó de Auth).
const DEMO = (rol = 'director_obras', extra = {}) => ({
  tipo: 'dependencia', rol, orgId: ORG, todas: true, obras: [], ...extra });
const FOSMON = (rol = 'director_general', extra = {}) => ({
  tipo: 'constructora', rol, orgId: 'fosmon', todas: true, obras: [], ...extra });

const token = () => {
  try {
    return execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
  } catch (e) {
    noArranco.sinPrecondicion('no se pudo obtener un token de gcloud',
      ['Corre `gcloud auth application-default login`.']);
  }
};

const DOC = (ruta, datos) => ({
  name: `projects/${PROYECTO}/databases/(default)/documents/${ruta}`,
  data: datos || { x: { stringValue: 'y' } },
});

const caso = (nombre, expectation, ruta, method, tok, datos) => ({
  nombre, expectation,
  request: {
    auth: { uid: 'sonda-medicion', token: tok },
    path: `/databases/(default)/documents/${ruta}`,
    method,
    time: new Date().toISOString(),
  },
  ...(method === 'get' || method === 'list' ? { resource: DOC(ruta, datos) } : {}),
});

const CASOS = [];

// ── a) LO QUE TIENE QUE PODER, O LA DEMO NO SE PUEDE RECORRER ─────────────
for (const o of OBRAS) {
  CASOS.push(
    caso(`ve su obra ${o}`, 'ALLOW',
      `orgs/${ORG}/obras/${o}`, 'get', DEMO()),
    caso(`lee el catálogo de ${o} (las partidas y sus precios)`, 'ALLOW',
      `orgs/${ORG}/obras/${o}/config/catalogo`, 'get', DEMO()),
    caso(`lee la curva de ${o} (el programa mes a mes)`, 'ALLOW',
      `orgs/${ORG}/obras/${o}/config/programa`, 'get', DEMO()),
    // Si esta rebota, la primera carga no puede derivar `subs` del catálogo y
    // la pantalla de captura sale vacía delante del cliente.
    caso(`la app puede derivar \`subs\` de ${o} en la primera carga`, 'ALLOW',
      `orgs/${ORG}/obras/${o}/avance/subs`, 'create', DEMO()),
    caso(`captura evidencia en ${o} (la foto que se toma en vivo)`, 'ALLOW',
      `orgs/${ORG}/obras/${o}/evidencia/foto-nueva`, 'create', DEMO()),
  );
}

// ── b) LO QUE NO PUEDE ALCANZAR: LA OBRA ORIGINAL Y SU ECONOMÍA ──────────
for (const o of OBRAS) {
  CASOS.push(
    caso(`NO alcanza la obra ${o} original de la constructora, en la raíz`, 'DENY',
      `obras/${o}`, 'get', DEMO()),
    caso(`NO lee el catálogo de la ${o} de la raíz`, 'DENY',
      `obras/${o}/config/catalogo`, 'get', DEMO()),
    caso(`NO lee los OTROS GASTOS de la ${o}`, 'DENY',
      `obras/${o}/config/otros_gastos`, 'get', DEMO()),
    caso(`NO lee el avance semanal de la ${o} de la raíz`, 'DENY',
      `obras/${o}/avance/historial`, 'get', DEMO()),
  );
}
CASOS.push(
  caso('NO lee la NÓMINA de la 0128 (22 KB de sueldos del contratista)', 'DENY',
    'obras/0128/nomina/historial', 'get', DEMO()),
  caso('NO lee la maquinaria de la 0128', 'DENY',
    'obras/0128/avance/maquinaria', 'get', DEMO()),
  caso('NO lee los materiales de la 0128', 'DENY',
    'obras/0128/avance/materiales', 'get', DEMO()),
  caso('NO lee la bitácora de la raíz, que es de la constructora', 'DENY',
    'auditoria/una-fila', 'get', DEMO()),
  caso('NO escribe en la obra original', 'DENY',
    'obras/0128', 'update', DEMO()),
  // Y la frontera en el otro sentido.
  caso('la CONSTRUCTORA no entra a la obra de la dependencia', 'DENY',
    `orgs/${ORG}/obras/0128`, 'get', FOSMON()),
  caso('ni lee su catálogo', 'DENY',
    `orgs/${ORG}/obras/0128/config/catalogo`, 'get', FOSMON()),
);

// ── c) EL CONTRALOR FISCALIZA Y NO CORRIGE ───────────────────────────────
CASOS.push(
  caso('el contralor SÍ ve la obra de la demo', 'ALLOW',
    `orgs/${ORG}/obras/0128`, 'get', DEMO('contralor')),
  caso('el contralor NO toca el catálogo', 'DENY',
    `orgs/${ORG}/obras/0128/config/catalogo`, 'update', DEMO('contralor')),
  caso('el contralor NO sube evidencia', 'DENY',
    `orgs/${ORG}/obras/0128/evidencia/foto-suya`, 'create', DEMO('contralor')),
  caso('el contralor NO borra la obra', 'DENY',
    `orgs/${ORG}/obras/0128`, 'delete', DEMO('contralor')),
);

// Si la cosecha de casos se queda corta, algo se rompió al construirla y el
// verde sería por vacío. 20 es el piso de lo que este guion dice medir.
if (CASOS.length < 20) noArranco.sinPrecondicion(
  `sólo se armaron ${CASOS.length} casos`, ['Se esperaban 20 o más.']);

(async () => {
  const TOKEN = token();
  const cab = { Authorization: `Bearer ${TOKEN}`, 'x-goog-user-project': PROYECTO };

  const pedir = async (url, init) => {
    let r;
    try { r = await fetch(url, init); }
    catch (e) { noArranco.sinPrecondicion(`no se pudo hablar con ${API} (${e.message})`,
      ['Hace falta red: esto mide PRODUCCIÓN, no el emulador.']); }
    if (!r.ok) noArranco.sinPrecondicion(
      `el servicio de reglas respondió ${r.status}`, [(await r.text()).slice(0, 400)]);
    return r.json();
  };

  const iArg = process.argv.indexOf('--ruleset');
  const pedido = iArg >= 0 ? process.argv[iArg + 1] : null;
  if (iArg >= 0 && !pedido) noArranco.sinPrecondicion(
    '`--ruleset` sin id', ['node scripts/medir-que-ve-la-cuenta-de-demo.cjs --ruleset <id>']);

  let nombreRuleset;
  if (pedido) {
    // Se acepta el PREFIJO, no sólo el UUID entero: los rulesets se citan por
    // sus ocho primeros caracteres en `PENDIENTES.md` y en los commits, así
    // que es la forma en que alguien va a teclearlo. Pedirle el UUID completo
    // haría que la contraprueba saliera `NO ARRANCÓ (400)` justo cuando se la
    // necesita, y eso invita a saltársela.
    if (/^[0-9a-f-]{36}$/.test(pedido)) {
      nombreRuleset = `projects/${PROYECTO}/rulesets/${pedido}`;
    } else {
      const todos = await pedir(
        `${API}/projects/${PROYECTO}/rulesets?pageSize=100`, { headers: cab });
      const hallados = (todos.rulesets || [])
        .filter(r => r.name.split('/').pop().startsWith(pedido));
      if (!hallados.length) noArranco.sinPrecondicion(
        `ningún ruleset de ${PROYECTO} empieza con «${pedido}»`,
        [`Hay ${(todos.rulesets || []).length}. Revisa el id.`]);
      if (hallados.length > 1) noArranco.sinPrecondicion(
        `«${pedido}» es ambiguo: casa con ${hallados.length} rulesets`,
        hallados.map(r => r.name.split('/').pop()));
      nombreRuleset = hallados[0].name;
    }
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
    : `\nQué ve la cuenta de demo, según las reglas PUBLICADAS en ${PROYECTO}`);
  console.log(`  ruleset   ${nombreRuleset.split('/').pop()}`);
  console.log(`  publicado ${meta.createTime}`);
  console.log(`  cuenta    director_obras · orgId=${ORG} · todas=true\n`);

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

  const resultados = res.testResults || [];
  if (resultados.length !== CASOS.length) noArranco.sinPrecondicion(
    `el motor contestó ${resultados.length} resultados para ${CASOS.length} casos`, []);

  let malos = 0;
  resultados.forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) malos++;
    const dijo = ok ? CASOS[i].expectation : (CASOS[i].expectation === 'DENY' ? 'ALLOW' : 'DENY');
    console.log(`  ${ok ? ' ok  ' : 'FALLA'}  [motor: ${dijo.padEnd(5)}] ${CASOS[i].nombre}`);
  });

  const cual = pedido ? `el ruleset ${pedido}` : 'las reglas PUBLICADAS';
  if (malos === 0) {
    console.log(`\nLos ${CASOS.length} casos en verde contra ${cual}.`);
    console.log('La cuenta de demo recorre sus dos obras y no alcanza la economía de la constructora.');
    process.exit(0);
  }
  console.log(`\n${malos} de ${CASOS.length} en ROJO contra ${cual}.`);
  if (pedido) console.log(
    'Era una contraprueba: el rojo es lo que se esperaba de un ruleset sin la frontera.');
  process.exit(1);
})();
