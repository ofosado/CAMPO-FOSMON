#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS FOTOS DE AVANCE, MEDIDAS CONTRA PRODUCCIÓN (PENDIENTES #30)
// ════════════════════════════════════════════════════════════════════════════
//
// Solo LEE. No escribe nada en ninguna parte.
//
// Contesta cuatro preguntas sobre la evidencia fotográfica que hoy vive dentro
// de `obras/{id}/avance/subs`:
//
//   1. ¿Se acumulan sin limpiarse nunca?
//   2. ¿Cada foto sabe de qué semana es, o solo tiene fecha?
//   3. ¿Cuántas hay por partida, y cuál es el máximo?
//   4. Al reemplazar el catálogo, ¿se preservan o se pierden?
//
// Las 1, 2 y 4 se contestan leyendo el código; aquí se comprueban contra los
// datos reales, que es donde las teorías se caen.
//
// Lo que cuenta las fotos no se reimplementa: se EXTRAE del archivo y se le
// pasan las partidas de producción tal como vienen. Así lo que se mide es lo
// que la pantalla hace hoy, no lo que yo creo que hace.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-fotos.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

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
    // Ver PENDIENTES, «El transporte que decodificaba a medias»: sin
    // `setEncoding`, un carácter UTF-8 partido entre dos trozos TCP se
    // decodifica a la mitad por cada lado.
    r.setEncoding('utf8');
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
//
// Este guion buscaba `conFotos` DENTRO de `FotosCliente` y `fotosDeSub` en el
// nivel superior. Las dos cosas se fueron en la unificación de evidencia —hoy
// hay UNA forma, la que devuelve `evidenciaDeObra`— y el guion llevaba semanas
// sin arrancar sin que nadie lo viera: no está en la suite. Ahora pide por
// `deApp`, y `prueba-herramientas-de-medicion-viven.cjs` lee esa petición y la
// exige en cada corrida.
//
// Las preguntas 5 y 6 se fueron con el símbolo, y es la respuesta correcta:
// medían una galería que mostraba todo junto sin mirar la fecha. Esa galería
// ya no existe —hoy hay riel de semanas— así que la pregunta no tiene objeto.
// Una medición que sobrevive a su objeto mide otra cosa y lo llama igual.
const { deApp } = require('./extraer-de-app.cjs');
const { evidenciaDeObra, idDePartida, tamañoFirestore, LIMITE_DOC_FIRESTORE } =
  deApp('evidenciaDeObra', 'idDePartida', 'tamañoFirestore', 'LIMITE_DOC_FIRESTORE');
const LIMITE = LIMITE_DOC_FIRESTORE;

// La evidencia de una obra sin migrar, agrupada por partida con el MISMO id
// con el que la pantalla la agrupa. Derivar el id aquí a mano sería la segunda
// cuenta: el día que una partida no tenga `id` ni `sec`, las dos divergirían.
const porPartida = (subs) => {
  const m = new Map();
  for (const e of evidenciaDeObra({ cfgEvidencia: null, docsEvidencia: [], subs })) {
    if (!m.has(e.partidaId)) m.set(e.partidaId, []);
    m.get(e.partidaId).push(e);
  }
  return m;
};

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
  const todasLasFotos = [];   // normalizadas, como las recibe la pantalla
  const todasLasCrudas = [];  // tal como están guardadas, para la pregunta 2
  for (const { obraId, subs, bytes } of todo) {
    let fotos = 0, conFotos = 0, max = { n: 0 };
    let bytesFotos = 0;
    const porP = porPartida(subs);
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const f = porP.get(idDePartida(s, i)) || [];
      bytesFotos += tamañoFirestore(s.fotos || {});
      for (const arr of Object.values(s.fotos || {}))
        if (Array.isArray(arr)) todasLasCrudas.push(...arr);
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
    const porP = porPartida(subs);
    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const f = porP.get(idDePartida(s, i)) || [];
      if (!f.length) continue;
      const suyas = {};
      f.forEach(x => {
        if (!x.fechaDeclarada) return;
        const w = semanaISO(x.fechaDeclarada);
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
  const fechas = todasLasFotos.map(f => f.fechaDeclarada).filter(Boolean).sort();
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
  // Esta pregunta es sobre lo GUARDADO, no sobre lo normalizado: la forma que
  // devuelve `evidenciaDeObra` trae siempre las mismas llaves —las rellena ella
  // cuando faltan—, así que censarla diría "todas tienen fechaDeclarada" aunque
  // el documento no guarde ninguna. Se leen los objetos crudos.
  const llaves = new Map();
  todasLasCrudas.forEach(f => Object.keys(f && typeof f === 'object' ? f : { url: f })
    .forEach(k => llaves.set(k, (llaves.get(k) || 0) + 1)));
  console.log('Campos presentes en las fotos de producción, como están guardadas:');
  [...llaves].sort((a, b) => b[1] - a[1]).forEach(([k, c]) =>
    console.log(`  ${k.padEnd(14)} en ${c}/${todasLasCrudas.length} fotos`));
  const conSemana = [...llaves.keys()].some(k => /semana|week|iso/i.test(k));
  console.log(`\n¿Alguna guarda la semana? ${conSemana ? 'SÍ' : 'NO — ninguna.'}`);
  if (todasLasCrudas.length) {
    const ej = todasLasCrudas[0];
    console.log(`Ejemplo guardado: ${typeof ej === 'string' ? '"…"' :
      `{${Object.keys(ej).map(k => `${k}: ${k === 'url' ? '"…"' : JSON.stringify(ej[k])}`).join(', ')}}`}`);
  }
  if (todasLasFotos.length) {
    const ej = todasLasFotos[0];
    console.log(`Ejemplo ya normalizado, que es lo que ve la pantalla: ` +
      `{${Object.keys(ej).filter(k => k !== 'obraId' && k !== 'sec')
        .map(k => `${k}: ${k === 'url' || k === 'rutaStorage' ? '"…"' : JSON.stringify(ej[k])}`).join(', ')}}`);
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

  console.log(`\n(Límite de documento: ${n(LIMITE)} bytes.)`);
})().catch(e => { console.error(e); process.exit(1); });
