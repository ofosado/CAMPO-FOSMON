#!/usr/bin/env node
// SOLO LECTURA. Cuánto pesan hoy los `avance/historial` de las obras del
// EMULADOR —las de la demo—, en cuántas semanas se llenan, y cuánto cambia
// eso si el cierre semanal empieza a guardar el corte de estimaciones.
//
// Dos preguntas que hay que contestar con números antes de escribir nada:
//
//   1. ¿Las tres obras de la demo aguantan el documento único, o hay que
//      adelantar la subcolección por semana del pendiente #28?
//   2. ¿Cuánto crece cada cierre si se le añaden los cuatro números del corte
//      de estimaciones, y eso acerca el límite de forma significativa?
//
// La cuenta NO es la del JSON: Firestore cobra por su propia regla —cada
// string sus bytes UTF-8 + 1, cada número 8, cada clave de mapa su nombre + 1,
// más el nombre del documento— y el límite duro es 1 MiB. Se reusa
// `tamañoFirestore` extraída de src/App.jsx por AST, no una copia: si la de la
// app cambia, esta medición cambia con ella.
//
// Uso (con el emulador de Firestore arriba en el 8080):
//   export PATH="/opt/homebrew/bin:$PATH"
//   node scripts/medir-cierres-demo.cjs
//
// Para medir producción está `medir-historial-0114.cjs`, que pide TOKEN.

const fs = require('fs');
const path = require('path');
const http = require('http');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const PROYECTO = 'campo-fosmon';
const HOST = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080').split(':');
const BASE = `/v1/projects/${PROYECTO}/databases/(default)/documents`;

const get = ruta => new Promise((res, rej) => {
  // `Bearer owner` es la credencial de administrador del emulador: salta las
  // reglas, igual que lo haría el SDK de admin. Sin ella la lectura la bloquea
  // `allow list` y la medición no arranca.
  http.get({ host: HOST[0], port: Number(HOST[1]), path: BASE + ruta,
    headers: { Authorization: 'Bearer owner' } }, r => {
    // Ver PENDIENTES, «El transporte que decodificaba a medias».
    r.setEncoding('utf8');
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => r.statusCode === 200 ? res(JSON.parse(b))
      : r.statusCode === 404 ? res(null) : rej(new Error(`HTTP ${r.statusCode}: ${b.slice(0,200)}`)));
  }).on('error', rej);
});

const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue'     in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

// ── `tamañoFirestore` y `LIMITE_DOC_FIRESTORE`, extraídas de la app ────────
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
const decl = {};
traverse(ast, { VariableDeclarator(p) {
  if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
    decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
}});
for (const n of ['tamañoFirestore', 'LIMITE_DOC_FIRESTORE'])
  if (!decl[n]) { console.error(`No se pudo extraer \`${n}\` de src/App.jsx`); process.exit(2); }
const { tamañoFirestore, LIMITE_DOC_FIRESTORE } = new Function(`
  "use strict";
  const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
  const tamañoFirestore = ${decl['tamañoFirestore']};
  return { tamañoFirestore, LIMITE_DOC_FIRESTORE };
`)();

// Los cuatro números del corte de estimaciones que el cierre guardaría. Los
// nombres son los que la rama B va a usar; el peso depende del nombre del
// campo tanto como del valor, así que se miden los nombres reales.
const CORTE_ESTIMACIONES = {
  estEstimadoAcum: 12345678.9,
  estAprobadoAcum: 11000000.5,
  estPagadoAcum: 9500000.25,
  estPorCobrarAcum: 1500000.25,
};

const KB = b => `${(b / 1024).toFixed(1)} KB`;
const PCT = b => `${(b / LIMITE_DOC_FIRESTORE * 100).toFixed(1)}%`;

(async () => {
  const lista = await get('/obras?pageSize=300');
  if (!lista) { console.error('El emulador no respondió. ¿Está arriba en el 8080?'); process.exit(2); }
  const ids = (lista.documents || []).map(d => d.name.split('/').pop()).sort();
  if (ids.length === 0) { console.error('No hay obras en el emulador. Siembra primero.'); process.exit(2); }

  console.log(`\nEMULADOR ${HOST.join(':')} · límite ${KB(LIMITE_DOC_FIRESTORE)} por documento`);
  console.log('═'.repeat(78));

  const pesoCorte = tamañoFirestore(CORTE_ESTIMACIONES);
  console.log(`\nEl corte de estimaciones pesa ${pesoCorte} B por cierre`);
  console.log(`   cuatro números, con estos nombres: ${Object.keys(CORTE_ESTIMACIONES).join(', ')}`);

  console.log(`\n${'obra'.padEnd(10)}${'cierres'.padStart(8)}${'documento'.padStart(12)}${'% de 1MiB'.padStart(11)}`
    + `${'último'.padStart(9)}${'quedan'.padStart(8)}${'con corte'.padStart(11)}${'se llena'.padStart(9)}`);
  for (const id of ids) {
    const hist = campos(await get(`/obras/${id}/avance/historial`));
    if (!hist || !Array.isArray(hist.semanas)) {
      console.log(`${id.padEnd(10)}${'—'.padStart(8)}   (sin historial: nunca ha cerrado una semana)`);
      continue;
    }
    const sem = hist.semanas;
    // El nombre del documento también cuenta contra el límite.
    const nombre = `projects/${PROYECTO}/databases/(default)/documents/obras/${id}/avance/historial`;
    const bytes = tamañoFirestore(hist) + Buffer.byteLength(nombre, 'utf8') + 1 + 32;
    const ult = sem.length ? tamañoFirestore(sem[sem.length - 1]) : 0;
    const libre = LIMITE_DOC_FIRESTORE - bytes;
    const quedan = ult > 0 ? Math.floor(libre / ult) : null;
    const quedanCorte = ult > 0 ? Math.floor(libre / (ult + pesoCorte)) : null;
    // El tope del código recorta a 52 semanas, así que lo que de verdad limita
    // es el menor de los dos: el peso y el tope.
    const TOPE = 52;
    const seLlena = quedanCorte === null ? '—'
      : quedanCorte > TOPE - sem.length ? `tope ${TOPE}`
      : `peso: ${quedanCorte} sem`;
    console.log(`${id.padEnd(10)}${String(sem.length).padStart(8)}${KB(bytes).padStart(12)}`
      + `${PCT(bytes).padStart(11)}${(ult + ' B').padStart(9)}`
      + `${String(quedan ?? '∞').padStart(8)}${String(quedanCorte ?? '∞').padStart(11)}${seLlena.padStart(9)}`);
  }

  console.log(`\nCómo se lee:`);
  console.log(`  quedan      · cuántos cierres más caben como está hoy`);
  console.log(`  con corte   · cuántos caben si cada cierre lleva los cuatro números`);
  console.log(`  se llena    · qué topa primero: el peso del documento o el recorte a 52 semanas`);
  console.log('');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(2); });
