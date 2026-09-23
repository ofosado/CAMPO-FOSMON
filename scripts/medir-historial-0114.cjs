#!/usr/bin/env node
// SOLO LECTURA. Cuánto pesa hoy `obras/0114/avance/historial` y cuánto pesaría
// un snapshot nuevo escrito por el camino normal, con el formato sin
// descripciones.
//
// La cuenta NO es la del JSON: Firestore cobra por su propia regla —cada
// string sus bytes UTF-8 + 1, cada número 8, cada clave de mapa su nombre + 1—
// y el límite duro es 1 MiB por documento. Se reusa `tamañoFirestore` extraída
// de src/App.jsx por AST, no una copia: si la de la app cambia, esta medición
// cambia con ella.
//
// Uso:
//   export PATH="/opt/homebrew/bin:$PATH"
//   TOKEN=$(gcloud auth application-default print-access-token) \
//     node scripts/medir-historial-0114.cjs

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
const OBRA = process.argv[2] || '0114';

const get = ruta => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO } }, r => {
    // Ver PENDIENTES, «El transporte que decodificaba a medias»: sin
    // `setEncoding`, un carácter UTF-8 partido entre dos trozos TCP se
    // decodifica a la mitad por cada lado.
    r.setEncoding('utf8');
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => r.statusCode === 200 ? res(JSON.parse(b))
      : r.statusCode === 404 ? res(null) : rej(new Error(`HTTP ${r.statusCode}: ${b.slice(0,200)}`)));
  }).on('error', rej);
});

// Desenvuelve un Value REST de Firestore.
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
for (const n of ['tamañoFirestore', 'LIMITE_DOC_FIRESTORE', 'ESQUEMA_SNAPSHOT'])
  if (!decl[n]) { console.error(`No se pudo extraer \`${n}\` de src/App.jsx`); process.exit(1); }
const { tamañoFirestore, LIMITE_DOC_FIRESTORE, ESQUEMA_SNAPSHOT } = new Function(`
  "use strict";
  const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
  const ESQUEMA_SNAPSHOT = ${decl['ESQUEMA_SNAPSHOT']};
  const tamañoFirestore = ${decl['tamañoFirestore']};
  return { tamañoFirestore, LIMITE_DOC_FIRESTORE, ESQUEMA_SNAPSHOT };
`)();

const KB = b => `${(b / 1024).toFixed(1)} KB`;
const PCT = b => `${(b / LIMITE_DOC_FIRESTORE * 100).toFixed(1)}%`;

(async () => {
  const hist = campos(await get(`/obras/${OBRA}/avance/historial`));
  const subsDoc = campos(await get(`/obras/${OBRA}/avance/subs`));
  const semanas = hist.semanas || [];
  const subs = subsDoc.data || [];

  console.log(`OBRA ${OBRA}\n${'═'.repeat(70)}`);
  console.log(`\n1. El documento hoy`);
  const bytesDoc = tamañoFirestore(hist);
  console.log(`   ${semanas.length} snapshots · ${KB(bytesDoc)} de 1024 KB  (${PCT(bytesDoc)})`);
  console.log(`   margen libre: ${KB(LIMITE_DOC_FIRESTORE - bytesDoc)}`);

  console.log(`\n   Desglose por snapshot:`);
  for (const s of semanas) {
    const b = tamañoFirestore(s);
    const conDesc = (s.subs || []).some(x => x.sub !== undefined || x.desc !== undefined);
    console.log(`     ${s.id}  ${String(s.tipo).padEnd(11)} esquema ${s.esquema || 1}  ` +
      `${String((s.subs || []).length).padStart(3)} partidas  ${KB(b).padStart(9)}` +
      `${conDesc ? '  ← trae descripciones' : ''}`);
  }

  console.log(`\n2. El catálogo vivo`);
  console.log(`   ${subs.length} conceptos en avance/subs`);

  console.log(`\n3. Lo que pesaría un snapshot nuevo (formato sin descripciones)`);
  // Mismo mapeo exacto que `crearSnapshotAvance`.
  const nuevo = {
    id: 'S39-2026', semana: 39, año: 2026,
    fechaCaptura: new Date().toISOString(),
    fechaCierre: new Date().toISOString(),
    tipo: 'oficial', capturadoPor: 'residente@fosmon.com.mx',
    subs: subs.map(s => ({
      sec: s.sec, a: s.a || 0, imp: s.imp || 0,
      cant: parseFloat(s.cant) || 0,
      pu: parseFloat(s.pu) || 0,
      cantEjec: parseFloat(s.cantEjec) || 0,
    })),
    avancePonderado: 41.234567, montoEjecutado: 67500000.12,
    montoCatalogo: 67500000.12, montoExcedente: 0,
    contratoRef: 163703079.43, modoAvance: 'porcentaje',
    esquema: ESQUEMA_SNAPSHOT,
  };
  const bytesNuevo = tamañoFirestore(nuevo);
  console.log(`   ${subs.length} partidas · ${KB(bytesNuevo)}  (${(bytesNuevo / subs.length).toFixed(0)} B por partida)`);

  // El mismo snapshot pero copiando la descripción, que es lo que hacía antes.
  const conDesc = { ...nuevo, subs: subs.map((s, i) => ({ ...nuevo.subs[i], sub: s.sub || s.desc || '' })) };
  const bytesConDesc = tamañoFirestore(conDesc);
  console.log(`   el MISMO snapshot con descripciones: ${KB(bytesConDesc)}  ` +
    `(${(bytesConDesc / subs.length).toFixed(0)} B por partida)`);
  console.log(`   ahorro: ${KB(bytesConDesc - bytesNuevo)}  ` +
    `(${(100 - bytesNuevo / bytesConDesc * 100).toFixed(0)}% menos)`);

  console.log(`\n4. ¿Cabe el cierre de esta semana?`);
  const despues = tamañoFirestore({ ...hist, semanas: [...semanas, nuevo] });
  console.log(`   documento después de escribirlo: ${KB(despues)}  (${PCT(despues)})`);
  console.log(`   ${despues < LIMITE_DOC_FIRESTORE ? 'CABE' : 'NO CABE'} ` +
    `· margen restante ${KB(LIMITE_DOC_FIRESTORE - despues)}`);

  const cuantasMas = Math.floor((LIMITE_DOC_FIRESTORE - despues) / bytesNuevo);
  console.log(`   a este ritmo caben ~${cuantasMas} semanas más antes del límite ` +
    `(~${(cuantasMas / 52).toFixed(1)} años)`);

  console.log(`\n   Si se siguiera copiando la descripción:`);
  const despuesDesc = tamañoFirestore({ ...hist, semanas: [...semanas, conDesc] });
  const cuantasDesc = Math.floor((LIMITE_DOC_FIRESTORE - despuesDesc) / bytesConDesc);
  console.log(`   documento: ${KB(despuesDesc)} · caben ~${cuantasDesc} semanas más ` +
    `(~${(cuantasDesc / 52).toFixed(1)} años)`);
})().catch(e => { console.error(e.message); process.exit(1); });
