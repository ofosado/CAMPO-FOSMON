#!/usr/bin/env node
// Verifica las reglas que están PUBLICADAS en producción. No las del repo.
//
// Se corre DESPUÉS de cada `firebase deploy --only firestore:rules`.
//
// Por qué no se llama `prueba-*`: el corredor de la suite descubre por
// `/^prueba-.*\.cjs$/`, y este guion necesita red y credenciales de
// producción. Un banco que depende de que haya internet no pertenece a la
// suite; saldría NO ARRANCÓ en cada corrida y eso enseña a no mirar.
//
// ── Qué lo hace distinto de `prueba-reglas-evidencia` ───────────────────────
//
// Aquel mide `firestore.rules`, el archivo. Éste mide lo que de verdad está
// decidiendo en producción ahora mismo: baja el `source` del ruleset
// RELEASED desde el servicio y se lo da al motor. Si alguien desplegó a mano
// algo distinto de lo que hay en `main`, o si un deploy falló a medias y
// quedó publicada la versión anterior, el archivo sale verde y producción
// está mintiendo. Es el mismo principio por el que los bancos cargan su
// insumo en vez de heredarlo, aplicado al otro extremo de la tubería.
//
// Esto salió del 2026-10-22: el `create` de `evidencia` en el bloque de
// dependencia colgaba `&& obraId in obrasAsignadas()` de las tres ramas del
// `or`, y `backfill-claims.cjs` acuña a los directivos con `obras: []`
// siempre — la rama del directivo era inalcanzable por construcción. No
// estaba mordiendo (producción no tiene inquilino de dependencia todavía),
// pero apuntaba a la demo: un director de Obras Públicas sin poder subir
// evidencia, en la pantalla con la que se vende el producto.
//
// NO ESCRIBE NADA. Dos llamadas de lectura al servicio de reglas y una al
// endpoint `:test`, que evalúa sin tocar Firestore. No crea usuarios, no
// crea documentos, no toca el expediente.
//
// Uso:
//   node scripts/verificar-reglas-publicadas.cjs
//   CONTRAPRUEBA=1 node scripts/verificar-reglas-publicadas.cjs   (debe salir 1)

const { execSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const PROYECTO = process.env.PROYECTO_PROD || 'campo-fosmon';
const API = 'https://firebaserules.googleapis.com/v1';

// Los claims tal como los acuña `backfill-claims.cjs`. Si esa lista de roles
// cambia, estos casos dejan de representar a producción y hay que rehacerlos.
const DEP = (rol, extra = {}) => ({ tipo: 'dependencia', rol, orgId: 'coatzacoalcos',
  todas: true, obras: [], ...extra });
const CON = (rol, extra = {}) => ({ tipo: 'constructora', rol, orgId: 'fosmon',
  todas: true, obras: [], ...extra });

const EV_DEP = '/orgs/coatzacoalcos/obras/OP-2026-001/evidencia/sonda1';
const EV_CON = '/obras/0127/evidencia/sonda1';

const caso = (nombre, expectation, path, method, token) => ({
  nombre, expectation,
  request: { auth: { uid: 'sonda-verificacion', token },
             path: `/databases/(default)/documents${path}`, method,
             time: new Date().toISOString() },
});

const CASOS = [
  // El acto que el defecto del 2026-10-22 impedía, y las dos aserciones que
  // demuestran que se abrió la rama del directivo y no la puerta.
  caso('un directivo de dependencia (todas:true, obras:[]) CAPTURA evidencia',
    'ALLOW', EV_DEP, 'create', DEP('director_obras')),
  caso('y también subdirector y jefe_supervision, que traen el mismo claim',
    'ALLOW', EV_DEP, 'create', DEP('subdirector')),
  caso('un supervisor SIN esa obra asignada rebota',
    'DENY', EV_DEP, 'create', DEP('supervisor_obra', { todas: false, obras: ['OTRA'] })),
  caso('un supervisor CON la obra asignada captura',
    'ALLOW', EV_DEP, 'create', DEP('supervisor_obra', { todas: false, obras: ['OP-2026-001'] })),
  caso('el contralor NO captura aunque traiga todas:true — fiscaliza, no ejecuta',
    'DENY', EV_DEP, 'create', DEP('contralor')),
  // El §7.7: la evidencia municipal no se borra, se anula.
  caso('nadie borra del expediente municipal, ni el director de Obras',
    'DENY', EV_DEP, 'delete', DEP('director_obras')),
  // El camino de constructora, que es donde viven las 4 obras migradas hoy.
  caso('un director_general de constructora captura en la 0127 migrada',
    'ALLOW', EV_CON, 'create', CON('director_general')),
  caso('un auditor de constructora NO captura ni en su propia obra',
    'DENY', EV_CON, 'create', CON('auditor', { todas: false, obras: ['0127'] })),
  // El P5 por el otro lado.
  caso('una sesión de constructora no escribe en el expediente municipal',
    'DENY', EV_DEP, 'create', CON('director_general')),
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
      ['Hace falta red: este guion mide PRODUCCIÓN, no el emulador.']); }
    if (!r.ok) noArranco.sinPrecondicion(
      `el servicio de reglas respondió ${r.status}`, [(await r.text()).slice(0, 300)]);
    return r.json();
  };

  // 1. Cuál es el ruleset que está RELEASED ahora mismo.
  const rels = await pedir(`${API}/projects/${PROYECTO}/releases`, { headers: cab });
  const rel = (rels.releases || []).find(x => x.name.endsWith('cloud.firestore'));
  if (!rel) noArranco.sinPrecondicion(
    `el proyecto ${PROYECTO} no tiene una release de cloud.firestore`,
    ['¿Se ha desplegado alguna vez `firebase deploy --only firestore:rules`?']);

  // 2. Su fuente, bajada del servicio.
  const meta = await pedir(`${API}/${rel.rulesetName}`, { headers: cab });
  let fuente = meta.source.files.map(f => f.content).join('\n');

  console.log(`\nReglas PUBLICADAS en ${PROYECTO}`);
  console.log(`  ruleset  ${rel.rulesetName.split('/').pop()}`);
  console.log(`  publicado ${meta.createTime}`);
  console.log(`  ${fuente.split('\n').length} renglones, bajados del servicio\n`);

  // El filo del vigilante. Un verde que no puede ponerse rojo no vale; con
  // esto se comprueba que estos casos de verdad dependen de la regla.
  if (process.env.CONTRAPRUEBA === '1') {
    const antes = fuente;
    fuente = fuente.replace('&& (todasObras() || obraId in obrasAsignadas());',
                            '&& obraId in obrasAsignadas();');
    if (fuente === antes) noArranco.sinPrecondicion(
      'no se encontró en el ruleset publicado el renglón que la contraprueba revierte',
      ['O la regla se reescribió, o esta contraprueba ya no muerde. Rehacerla.']);
    console.log('CONTRAPRUEBA: al ruleset publicado se le quitó el `todasObras()`.');
    console.log('Si esto NO sale en rojo, el vigilante está ciego.\n');
  }

  // 3. Al motor, sin tocar Firestore.
  const res = await pedir(`${API}/projects/${PROYECTO}:test`,
    { method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: fuente }] },
        testSuite: { testCases: CASOS.map(c => ({ expectation: c.expectation, request: c.request })) } }) });

  const errores = (res.issues || []).filter(i => i.severity === 'ERROR');
  if (errores.length) noArranco.sinPrecondicion(
    'el ruleset publicado no compila contra el motor de pruebas',
    errores.map(e => `L${e.sourcePosition && e.sourcePosition.line}: ${e.description}`));

  let malos = 0;
  (res.testResults || []).forEach((r, i) => {
    const ok = r.state === 'SUCCESS';
    if (!ok) malos++;
    console.log(`  ${ok ? ' ok  ' : 'FALLA'}  ${CASOS[i].nombre}`);
    if (!ok) console.log(`          esperaba ${CASOS[i].expectation} y el motor dijo lo contrario`);
  });

  if (malos === 0) {
    console.log('\nLo que está decidiendo en producción es lo que debe decidir.');
    process.exit(0);
  }
  console.log(`\n${malos} de ${CASOS.length} en ROJO contra las reglas PUBLICADAS.`);
  console.log('Esto no es el repo: es lo que está gobernando los datos ahora mismo.');
  process.exit(1);
})();
