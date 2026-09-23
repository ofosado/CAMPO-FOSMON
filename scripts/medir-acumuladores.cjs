#!/usr/bin/env node
// SOLO LECTURA. Inventario de TODO documento de Firestore que guarde un arreglo
// que crece con el tiempo, en las cinco obras y en `global`.
//
// No parte de una lista escrita a mano: recorre las subcolecciones de cada obra
// con `listCollectionIds`, mide cada documento con la regla de tamaño de
// Firestore —no bytes de JSON— y marca como "acumulador" a todo el que tenga un
// campo de tipo arreglo con más de un elemento. Así aparecen también los que
// nadie recordaba.
//
// El ritmo de crecimiento se estima con el ÚLTIMO elemento del arreglo, que es
// lo que pesó el cierre más reciente; el promedio mentiría en `avance` porque
// los snapshots viejos traían descripciones y los nuevos no.
//
// Uso:
//   export PATH="/opt/homebrew/bin:$PATH"
//   TOKEN=$(gcloud auth application-default print-access-token) \
//     node scripts/medir-acumuladores.cjs

const fs = require('fs');
const path = require('path');
const https = require('https');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const PROYECTO = 'campo-fosmon';
const BASE = `/v1/projects/${PROYECTO}/databases/(default)/documents`;
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Falta TOKEN.'); process.exit(1); }

const pedir = (metodo, ruta, cuerpo) => new Promise((res, rej) => {
  const datos = cuerpo ? JSON.stringify(cuerpo) : null;
  const req = https.request({
    host: 'firestore.googleapis.com', path: BASE + ruta, method: metodo,
    headers: {
      Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO,
      ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}),
    },
  }, r => {
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => r.statusCode === 200 ? res(JSON.parse(b))
      : r.statusCode === 404 ? res(null)
      : rej(new Error(`HTTP ${r.statusCode} en ${ruta}: ${b.slice(0, 300)}`)));
  });
  req.on('error', rej);
  if (datos) req.write(datos);
  req.end();
});
const get = ruta => pedir('GET', ruta);
const subcolecciones = async ruta => {
  const r = await pedir('POST', `${ruta}:listCollectionIds`, { pageSize: 100 });
  return (r && r.collectionIds) || [];
};
const listar = async ruta => {
  const salida = [];
  let tok = '';
  do {
    const r = await get(`${ruta}?pageSize=300${tok ? `&pageToken=${tok}` : ''}`);
    if (!r) break;
    salida.push(...(r.documents || []));
    tok = r.nextPageToken || '';
  } while (tok);
  return salida;
};

// Desenvuelve un Value REST de Firestore.
const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue'    in v) return v.stringValue;
  if ('booleanValue'   in v) return v.booleanValue;
  if ('nullValue'      in v) return null;
  if ('integerValue'   in v) return Number(v.integerValue);
  if ('doubleValue'    in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'     in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue'       in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

// ── `tamañoFirestore` y `LIMITE_DOC_FIRESTORE` salen de la app, no de una copia ──
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
const decl = {};
traverse(ast, { VariableDeclarator(p) {
  if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
    decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
}});
for (const n of ['tamañoFirestore', 'LIMITE_DOC_FIRESTORE'])
  if (!decl[n]) { console.error(`No se pudo extraer \`${n}\` de src/App.jsx`); process.exit(1); }
const { tamañoFirestore, LIMITE_DOC_FIRESTORE } = new Function(`
  "use strict";
  const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
  const tamañoFirestore = ${decl['tamañoFirestore']};
  return { tamañoFirestore, LIMITE_DOC_FIRESTORE };
`)();

const KB = b => `${(b / 1024).toFixed(1)} KB`;
const PCT = b => b / LIMITE_DOC_FIRESTORE * 100;
const hoy = new Date();
const fechaEn = semanas => {
  if (!isFinite(semanas)) return 'nunca';
  const d = new Date(hoy.getTime() + semanas * 7 * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

(async () => {
  const obras = (await listar('/obras')).map(d => d.name.split('/').pop()).sort();
  console.log(`Obras en producción: ${obras.join(', ')}\n`);

  const hallazgos = [];

  // Recorre obras/{id}/{sub}/{doc} buscando campos de tipo arreglo.
  for (const obra of obras) {
    for (const sub of await subcolecciones(`/obras/${obra}`)) {
      for (const d of await listar(`/obras/${obra}/${sub}`)) {
        const id = d.name.split('/').pop();
        const datos = campos(d);
        for (const [campo, v] of Object.entries(datos)) {
          if (!Array.isArray(v) || v.length < 2) continue;
          hallazgos.push({ ruta: `obras/${obra}/${sub}/${id}`, obra, campo, arr: v, doc: datos });
        }
      }
    }
  }
  // `global` también: ahí vive el registro de obras dadas de baja.
  for (const d of await listar('/global')) {
    const id = d.name.split('/').pop();
    const datos = campos(d);
    for (const [campo, v] of Object.entries(datos)) {
      if (!Array.isArray(v) || v.length < 2) continue;
      hallazgos.push({ ruta: `global/${id}`, obra: '—', campo, arr: v, doc: datos });
    }
  }

  // ── Tabla ────────────────────────────────────────────────────────────────
  console.log('ACUMULADORES — todo documento con un arreglo de 2+ elementos');
  console.log('═'.repeat(118));
  console.log(
    'documento'.padEnd(46) + 'campo'.padEnd(10) + 'n'.padStart(5) +
    'hoy'.padStart(12) + '%'.padStart(8) + 'último'.padStart(11) +
    'caben'.padStart(8) + 'se llena'.padStart(11));
  console.log('─'.repeat(118));

  const orden = h => -PCT(tamañoFirestore(h.doc));
  for (const h of hallazgos.sort((a, b) => orden(a) - orden(b))) {
    const bytes = tamañoFirestore(h.doc);
    const ultimo = tamañoFirestore(h.arr[h.arr.length - 1]);
    const caben = ultimo > 0 ? Math.floor((LIMITE_DOC_FIRESTORE - bytes) / ultimo) : Infinity;
    console.log(
      h.ruta.padEnd(46) + h.campo.padEnd(10) +
      String(h.arr.length).padStart(5) +
      KB(bytes).padStart(12) + PCT(bytes).toFixed(1).padStart(8) +
      KB(ultimo).padStart(11) +
      (isFinite(caben) ? String(caben) : '∞').padStart(8) +
      fechaEn(caben).padStart(11));
  }

  // ── Detalle de los que aprietan ──────────────────────────────────────────
  console.log('\n\nDETALLE — los que se llenan antes de 3 años');
  console.log('═'.repeat(118));
  for (const h of hallazgos) {
    const bytes = tamañoFirestore(h.doc);
    const ultimo = tamañoFirestore(h.arr[h.arr.length - 1]);
    const caben = ultimo > 0 ? Math.floor((LIMITE_DOC_FIRESTORE - bytes) / ultimo) : Infinity;
    if (caben > 156) continue;
    console.log(`\n${h.ruta}  ·  campo \`${h.campo}\`  ·  ${h.arr.length} elementos`);
    const pesos = h.arr.map(e => tamañoFirestore(e));
    const eti = e => e && (e.id || e.semana || e.fecha || '');
    console.log(`  primero  ${String(eti(h.arr[0])).padEnd(12)} ${KB(pesos[0])}`);
    console.log(`  último   ${String(eti(h.arr[h.arr.length - 1])).padEnd(12)} ${KB(pesos[pesos.length - 1])}`);
    console.log(`  medio    ${KB(pesos.reduce((a, b) => a + b, 0) / pesos.length)}` +
      `   ·   max ${KB(Math.max(...pesos))}`);
    // Cuánto del documento es el arreglo y cuánto es lo demás.
    const sinArr = tamañoFirestore({ ...h.doc, [h.campo]: [] });
    console.log(`  el arreglo es ${KB(bytes - sinArr)} de ${KB(bytes)} ` +
      `(${((bytes - sinArr) / bytes * 100).toFixed(1)}% del documento)`);
  }

  // ── Qué pasaría si cada elemento fuera su propio documento ───────────────
  console.log('\n\nSI CADA ELEMENTO FUERA UN DOCUMENTO');
  console.log('═'.repeat(118));
  let peorElem = null;
  for (const h of hallazgos) {
    for (const e of h.arr) {
      const b = tamañoFirestore(e);
      if (!peorElem || b > peorElem.bytes) peorElem = { bytes: b, ruta: h.ruta, id: e && e.id };
    }
  }
  console.log(`  El elemento más pesado de todo el portafolio: ${KB(peorElem.bytes)} ` +
    `(${PCT(peorElem.bytes).toFixed(1)}% del límite)`);
  console.log(`  en ${peorElem.ruta}, id ${peorElem.id}`);
  console.log(`  margen antes de que UN solo cierre no quepa: ` +
    `×${(LIMITE_DOC_FIRESTORE / peorElem.bytes).toFixed(0)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
