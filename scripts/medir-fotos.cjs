#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS FOTOS DE AVANCE, MEDIDAS CONTRA PRODUCCIÓN (PENDIENTES #30)
// ════════════════════════════════════════════════════════════════════════════
//
// Solo LEE. No escribe nada en ninguna parte.
//
// Contesta seis preguntas sobre la evidencia fotográfica que hoy vive dentro
// de `obras/{id}/avance/subs`:
//
//   1. ¿Se acumulan sin limpiarse nunca?
//   2. ¿Cada foto sabe de qué semana es, o solo tiene fecha?
//   3. ¿Cuántas hay por partida, y cuál es el máximo?
//   4. Al reemplazar el catálogo, ¿se preservan o se pierden?
//   5. ¿Se puede ver una semana concreta?
//   6. ¿Se puede ver la obra de hace tres semanas?
//
// Las 1, 2, 4, 5 y 6 se contestan leyendo el código; aquí se comprueban contra
// los datos reales, que es donde las teorías se caen.
//
// La comprobación que importa es la de la GALERÍA: `FotosCliente` no se
// reimplementa, se EXTRAE del archivo con Babel y se le pasan las partidas de
// producción tal como vienen. Así lo que se mide es lo que la pantalla hace
// hoy, no lo que yo creo que hace.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-fotos.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const OBRAS = ['0112', '0114', '0125', '0126', '0127'];
const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;
let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(1); }

// Una lectura que falla TIENE que parar el guion. Devolver `null` y seguir
// hace que un token vencido salga como "0 fotos en las cinco obras", que es
// una respuesta creíble y falsa — el P2 aplicado a las herramientas, no solo
// a la pantalla. Pasó de verdad mientras se escribía esto.
const get = (ruta) => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => {
      if (r.statusCode === 200) return res(JSON.parse(b));
      rej(new Error(`Firestore contestó ${r.statusCode} en ${ruta}.` +
        (r.statusCode === 401 || r.statusCode === 403
          ? '\nSuele ser el token vencido: `gcloud auth application-default print-access-token > /tmp/adc.tok`'
          : `\n${b.slice(0, 300)}`)));
    });
  }).on('error', rej);
});
const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

// ── Lo que hace la app, extraído de la app ──────────────────────────────────
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

// `tamañoFirestore` es de nivel superior. `conFotos` vive DENTRO de
// `FotosCliente`, así que se busca por su función contenedora: es la línea que
// decide qué se pinta en la galería del cliente y es justo la que se audita.
const decl = {};
let conFotosSrc = null;
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    if (!p.scope.parent?.parent) decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
    if (p.node.id.name === 'conFotos') {
      const fn = p.getFunctionParent();
      if (fn?.node?.id?.name === 'FotosCliente')
        conFotosSrc = src.slice(p.node.init.start, p.node.init.end);
    }
  },
  FunctionDeclaration(p) { if (p.node.id) decl['fn:' + p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
});
for (const n of ['tamañoFirestore', 'LIMITE_DOC_FIRESTORE'])
  if (!decl[n]) { console.error(`No se pudo extraer \`${n}\` de src/App.jsx.`); process.exit(1); }
if (!conFotosSrc) { console.error('No se pudo extraer `conFotos` de `FotosCliente`.'); process.exit(1); }

// Se declara con su propio nombre porque es recursiva: se llama a sí misma.
const tamañoFirestore = new Function(
  `"use strict"; const tamañoFirestore = ${decl['tamañoFirestore']}; return tamañoFirestore;`)();
const LIMITE = new Function(`"use strict"; return ${decl['LIMITE_DOC_FIRESTORE']};`)();
// Lo que la galería del cliente considera "las fotos de esta partida".
const galeriaCliente = new Function('subs', `"use strict"; return ${conFotosSrc};`);
// Lo que el PDF y el tablero consideran lo mismo (con `.flat()`).
const fotosDeSubPDF = new Function(`"use strict"; return ${
  src.slice(...(() => { let r = null; traverse(ast, { VariableDeclarator(p) {
    if (p.node.id.name === 'fotosDeSub' && !r) r = [p.node.init.start, p.node.init.end]; } }); return r; })())
};`)();

const n = x => x.toLocaleString('es-MX');
const kb = b => (b / 1024).toFixed(1) + ' KB';

(async () => {
  const todo = [];
  for (const obraId of OBRAS) {
    const d = campos(await get(`/obras/${obraId}/avance/subs`));
    const subs = Array.isArray(d.data) ? d.data : [];
    todo.push({ obraId, subs, bytes: tamañoFirestore(d) });
  }

  // ── 3. Cuántas fotos por partida, y el máximo ────────────────────────────
  console.log('════ 3. FOTOS POR PARTIDA (lo que hay hoy) ════\n');
  console.log('obra   partidas  con fotos    fotos  máx/partida   doc     fotos son');
  let totalFotos = 0, maxGlobal = { n: 0 };
  const todasLasFotos = [];
  for (const { obraId, subs, bytes } of todo) {
    let fotos = 0, conFotos = 0, max = { n: 0 };
    let bytesFotos = 0;
    for (const s of subs) {
      const f = fotosDeSubPDF(s);
      bytesFotos += tamañoFirestore(s.fotos || {});
      if (!f.length) continue;
      conFotos++; fotos += f.length;
      f.forEach(x => todasLasFotos.push({ obraId, sec: s.sec, ...x }));
      if (f.length > max.n) max = { n: f.length, sec: s.sec, sub: s.sub };
      if (f.length > maxGlobal.n) maxGlobal = { n: f.length, sec: s.sec, sub: s.sub, obraId };
    }
    totalFotos += fotos;
    console.log(`${obraId}  ${String(subs.length).padStart(8)}  ${String(conFotos).padStart(8)}  ` +
      `${String(fotos).padStart(7)}  ${String(max.n).padStart(11)}   ${kb(bytes).padStart(8)}  ` +
      `${(100 * bytesFotos / (bytes || 1)).toFixed(0).padStart(3)}% del doc`);
  }
  console.log(`\nTotal: ${n(totalFotos)} fotos en las cinco obras.`);
  console.log(maxGlobal.n
    ? `Máximo en una partida: ${maxGlobal.n} · ${maxGlobal.obraId} ${maxGlobal.sec} — ${maxGlobal.sub}`
    : 'Ninguna partida tiene fotos.');

  // ── 3 bis. Repartidas por semana, que es la pregunta de verdad ───────────
  // El total por partida engaña: dice cuánta evidencia hay acumulada, no a
  // qué ritmo entra. Para decidir si un tope "3 o 4 por partida por semana"
  // estorbaría, lo que hay que mirar es el máximo POR SEMANA, no el histórico.
  console.log('\n════ 3 bis. EL RITMO REAL: FOTOS POR SEMANA ════');
  const semanaISO = f => {
    const d = new Date(f + 'T12:00:00Z');
    const j = new Date(d); j.setUTCDate(j.getUTCDate() + 4 - (j.getUTCDay() || 7));
    return Math.ceil(((j - new Date(Date.UTC(j.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
  };
  let topeSemanal = { n: 0 };
  for (const { obraId, subs } of todo) {
    const porSem = {};
    for (const s of subs) {
      const f = fotosDeSubPDF(s);
      if (!f.length) continue;
      const suyas = {};
      f.forEach(x => {
        if (!x.fecha) return;
        const w = semanaISO(x.fecha);
        porSem[w] = (porSem[w] || 0) + 1;
        suyas[w] = (suyas[w] || 0) + 1;
      });
      for (const [w, c] of Object.entries(suyas))
        if (c > topeSemanal.n) topeSemanal = { n: c, w, sec: s.sec, obraId };
    }
    const ws = Object.keys(porSem).map(Number).sort((a, b) => a - b);
    if (!ws.length) { console.log(`\n${obraId}: sin fotos.`); continue; }
    console.log(`\n${obraId}: ${ws.length} semana(s) con fotos`);
    ws.forEach(w => console.log(`   S${String(w).padStart(2)}  ${'█'.repeat(Math.min(porSem[w], 50))} ${porSem[w]}`));
  }
  console.log(`\nMáximo que una partida ha recibido EN UNA SOLA SEMANA: ${topeSemanal.n}` +
    (topeSemanal.n ? `  (${topeSemanal.obraId} S${topeSemanal.w} · ${topeSemanal.sec})` : ''));

  // ── 1. ¿Se limpian alguna vez? ───────────────────────────────────────────
  console.log('\n════ 1. ¿SE ACUMULAN SIN LIMPIARSE? ════\n');
  const fechas = todasLasFotos.map(f => f.fecha).filter(Boolean).sort();
  if (fechas.length) {
    console.log(`La foto más vieja que sigue en el documento es del ${fechas[0]},`);
    console.log(`la más nueva del ${fechas[fechas.length - 1]}.`);
    const dias = Math.round((Date.parse(fechas[fechas.length - 1]) - Date.parse(fechas[0])) / 86400000);
    console.log(`Son ${dias} días de evidencia conviviendo en el mismo documento:`);
    console.log('nada las recorta, porque nada las borra nunca.');
    const porFecha = {};
    fechas.forEach(f => porFecha[f] = (porFecha[f] || 0) + 1);
    console.log(`\nFechas distintas: ${Object.keys(porFecha).length}`);
    Object.entries(porFecha).forEach(([f, c]) => console.log(`  ${f}  ${'█'.repeat(Math.min(c, 60))} ${c}`));
  } else console.log('No hay fotos con fecha que medir.');

  // ── 2. ¿Qué sabe cada foto de sí misma? ──────────────────────────────────
  console.log('\n════ 2. ¿CADA FOTO SABE DE QUÉ SEMANA ES? ════\n');
  const llaves = new Map();
  todasLasFotos.forEach(f => Object.keys(f).filter(k => k !== 'obraId' && k !== 'sec')
    .forEach(k => llaves.set(k, (llaves.get(k) || 0) + 1)));
  console.log('Campos presentes en las fotos de producción:');
  [...llaves].sort((a, b) => b[1] - a[1]).forEach(([k, c]) =>
    console.log(`  ${k.padEnd(12)} en ${c}/${todasLasFotos.length} fotos`));
  const conSemana = [...llaves.keys()].some(k => /semana|week|iso/i.test(k));
  console.log(`\n¿Alguna guarda la semana? ${conSemana ? 'SÍ' : 'NO — ninguna.'}`);
  if (todasLasFotos.length) {
    const ej = todasLasFotos[0];
    console.log(`Ejemplo: {${Object.keys(ej).filter(k => k !== 'obraId' && k !== 'sec')
      .map(k => `${k}: ${k === 'url' ? '"…"' : JSON.stringify(ej[k])}`).join(', ')}}`);
  }

  // ── 4. ¿Sobreviven al reemplazo del catálogo? ────────────────────────────
  // La teoría: el mapa `fotos` se copia entero, con las llaves del catálogo
  // VIEJO (`clave__índice`). Si una partida cambia de posición, su id cambia,
  // y las fotos quedan bajo una llave que ya nadie consulta: siguen pesando,
  // pero son inalcanzables. Se comprueba mirando si la llave del mapa coincide
  // con el id actual de la partida que lo contiene.
  console.log('\n════ 4. ¿SOBREVIVEN AL REEMPLAZO DEL CATÁLOGO? ════\n');
  let alineadas = 0, huerfanas = 0, bytesHuerfanos = 0;
  const ejemplos = [];
  for (const { obraId, subs } of todo) {
    for (const s of subs) {
      if (!s.fotos || Array.isArray(s.fotos)) continue;
      for (const [llave, arr] of Object.entries(s.fotos)) {
        const cuantas = Array.isArray(arr) ? arr.length : 0;
        if (!cuantas) continue;
        // Así las busca `addFoto`/la captura: por id, y si no, por sec.
        if (llave === s.id || llave === s.sec) alineadas += cuantas;
        else {
          huerfanas += cuantas;
          bytesHuerfanos += tamañoFirestore(arr);
          if (ejemplos.length < 6) ejemplos.push(`${obraId} ${s.sec}: id actual "${s.id}", fotos bajo "${llave}" (${cuantas})`);
        }
      }
    }
  }
  console.log(`Fotos bajo una llave que la partida todavía reconoce: ${alineadas}`);
  console.log(`Fotos bajo una llave huérfana: ${huerfanas}${huerfanas ? `  (${kb(bytesHuerfanos)} que pesan sin poder verse)` : ''}`);
  ejemplos.forEach(e => console.log(`  ${e}`));
  console.log(huerfanas === 0
    ? '\nHoy ninguna está huérfana — pero el id lleva el índice del catálogo\n(`clave__idx`), así que basta con que una partida cambie de posición.'
    : '\nEl reemplazo del catálogo ya dejó fotos fuera de alcance.');

  // ── 5 y 6. ¿Se puede ver una semana concreta? ────────────────────────────
  console.log('\n════ 5 y 6. ¿SE PUEDE VER UNA SEMANA CONCRETA? ════\n');
  // No se argumenta: se le pasan las partidas reales a la galería del cliente
  // extraída del archivo, y se cuenta qué pintaría.
  for (const { obraId, subs } of todo) {
    const grupos = galeriaCliente(subs);
    let insignia = 0, pintadas = 0;
    for (const g of grupos) {
      insignia += g._fotos.length;
      for (const foto of g._fotos) {
        const url = typeof foto === 'string' ? foto : (foto.url || foto.src || '');
        if (url) pintadas++;     // la galería hace `if(!url) return null`
      }
    }
    const reales = subs.reduce((t, s) => t + fotosDeSubPDF(s).length, 0);
    console.log(`${obraId}  la galería anuncia "${insignia} foto(s)" en ${grupos.length} partida(s), ` +
      `pinta ${pintadas}, y en el documento hay ${reales}.`);
  }
  console.log('\nNingún filtro ni agrupación por fecha: `conFotos` no mira `fecha`,');
  console.log('no ordena, y no recibe ninguna semana. Todo lo que hay sale junto.');

  console.log(`\n(Límite de documento: ${n(LIMITE)} bytes.)`);
})().catch(e => { console.error(e); process.exit(1); });
