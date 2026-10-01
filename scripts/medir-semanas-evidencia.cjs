#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿SE PUEDE CONSULTAR LA EVIDENCIA POR SEMANA, CON LOS DATOS DE HOY? (#30)
// ════════════════════════════════════════════════════════════════════════════
//
// Solo LEE. No escribe nada en ninguna parte.
//
// Hermano de `medir-fotos.cjs`, que midió el PESO. Éste mide la CONSULTA, que
// es el problema de verdad del #30: el director quiere abrir la obra de hace
// tres semanas y compararla con hoy.
//
// Contesta dos preguntas, y las dos deciden plan:
//
//   1. ¿Se le puede deducir la semana a la evidencia que YA existe? Si todas
//      las fotos traen `fecha`, agrupar por semana es un cambio de LECTURA y
//      no necesita migración, ni subcolección, ni soltar la URL. Si alguna no
//      la trae, hay un hueco que la pantalla tiene que decir en voz alta.
//
//   2. ¿Cuántas partidas tienen foto en DOS semanas o más? De eso depende que
//      "comparar dos semanas alineando las partidas en común" tenga material.
//      Si cada semana se fotografía otra cosa —que es lo que hace un residente
//      honesto—, dos columnas alineadas por partida salen casi todas en hueco,
//      y el eje de la comparación tiene que ser otro.
//
// La semana se calcula con el convenio ISO 8601 (la del jueves), el mismo que
// usa la migración de nómina para `Y2026-S38`. Si eso cambiara, cambia aquí.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-semanas-evidencia.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const OBRAS = ['0112', '0114', '0125', '0126', '0127'];
const DETALLE = '0114';          // la que tiene captura semanal de verdad
const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch {
  console.error('Falta /tmp/adc.tok — corre');
  console.error('  gcloud auth application-default print-access-token > /tmp/adc.tok');
  process.exit(2);
}

// Una lectura que falla TIENE que parar el guion, y esto no es teoría: la
// primera versión traía `.catch(() => null)` y, apuntando al campo equivocado,
// contestó "0 fotos en las cinco obras". Es una respuesta creíble y falsa —el
// P2 aplicado a la herramienta— y se tardó en notar justamente por creíble.
const get = ruta => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
    r.setEncoding('utf8');                       // ver «El transporte que decodificaba a medias»
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => {
      if (r.statusCode === 200) return res(JSON.parse(b));
      rej(new Error(`Firestore contestó ${r.statusCode} en ${ruta}.` +
        (r.statusCode === 401 || r.statusCode === 403
          ? '\nSuele ser el token vencido: gcloud auth application-default print-access-token > /tmp/adc.tok'
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
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

// El catálogo vivo guarda las partidas en `data`, no en `subs` — `subs` es el
// nombre del DOCUMENTO. Confundirlos es lo que dio los ceros.
const partidasDe = doc => {
  const c = campos(doc);
  if (!Array.isArray(c.data)) throw new Error(
    `el documento no trae \`data\` como arreglo (campos: ${Object.keys(c).join(', ')})`);
  return c.data;
};

// Las fotos de una partida: el esquema es mixto a propósito —arreglo o mapa de
// arreglos— y así es como lo lee `FotosCliente`.
const fotosDe = s => (Array.isArray(s.fotos) ? s.fotos
                                             : Object.values(s.fotos || {}).flat()).filter(Boolean);

// ISO 8601: la semana a la que pertenece el jueves de esa semana.
const semanaISO = iso => {
  const d = new Date(iso + 'T00:00:00Z');
  const juev = new Date(d);
  juev.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const ene4 = new Date(Date.UTC(juev.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((juev - ene4) / 86400000 - 3 + ((ene4.getUTCDay() + 6) % 7)) / 7);
  return `${juev.getUTCFullYear()}-S${String(n).padStart(2, '0')}`;
};

(async () => {
  let total = 0, conSemana = 0, cadena = 0, sinCampo = 0, ilegible = 0;
  const semanasGlobal = {}, resumen = {};
  const semDetalle = {};   // semana → Set de `sec`, solo para DETALLE

  for (const obra of OBRAS) {
    const partidas = partidasDe(await get(`/obras/${obra}/avance/subs`));
    let n = 0; const suyas = new Set();
    for (const s of partidas) {
      for (const f of fotosDe(s)) {
        total++; n++;
        if (typeof f === 'string') { cadena++; continue; }
        if (!f.fecha) { sinCampo++; continue; }
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(f.fecha))) { ilegible++; continue; }
        conSemana++;
        const w = semanaISO(String(f.fecha).slice(0, 10));
        semanasGlobal[w] = (semanasGlobal[w] || 0) + 1;
        suyas.add(w);
        if (obra === DETALLE) (semDetalle[w] = semDetalle[w] || new Set()).add(s.sec);
      }
    }
    resumen[obra] = { fotos: n, partidas: partidas.length, semanas: [...suyas].sort() };
  }

  console.log('\n════ 1. ¿Se le puede deducir la semana a lo que ya existe? ════\n');
  const fila = (t, v) => console.log(`  ${t.padEnd(52)}${String(v).padStart(6)}`);
  fila('fotos de avance referenciadas en el catálogo', total);
  fila('con `fecha` usable, o sea con semana deducible', conSemana);
  fila('cadena suelta, sin ningún campo de fecha', cadena);
  fila('objeto sin `fecha`', sinCampo);
  fila('`fecha` con formato que no se puede leer', ilegible);
  console.log(`\n  => deducibles ${total ? (100 * conSemana / total).toFixed(1) : 0}%` +
              `  ·  SIN semana ${total - conSemana}`);
  console.log(total && conSemana === total
    ? '\n  Agrupar por semana es un cambio de LECTURA: no necesita migración.'
    : '\n  Hay fotos sin semana. La pantalla tiene que decirlo, no esconderlas (P2).');

  console.log('\n  obra   partidas   fotos   semanas con evidencia');
  for (const o of OBRAS) {
    const r = resumen[o];
    console.log(`  ${o}   ${String(r.partidas).padStart(8)}   ${String(r.fotos).padStart(5)}   ` +
                (r.semanas.join(', ') || '—'));
  }
  const ws = Object.keys(semanasGlobal).sort();
  console.log(`\n  todas las obras: ${ws.length} semana(s) distintas, de ${ws[0] || '—'} a ${ws[ws.length - 1] || '—'}`);
  for (const w of ws) console.log(`    ${w}  ${semanasGlobal[w]} foto(s)`);

  console.log(`\n════ 2. ¿Hay material para comparar dos semanas? (obra ${DETALLE}) ════\n`);
  const d = Object.keys(semDetalle).sort();
  if (d.length < 2) { console.log('  Menos de dos semanas con evidencia: no hay nada que comparar.'); return; }

  console.log('  partidas en común entre cada par (la diagonal es las de esa semana)\n');
  console.log('        ' + d.map(w => w.slice(5).padStart(5)).join(''));
  for (const a of d) {
    let l = a.slice(5).padEnd(8);
    for (const b of d) l += String(a === b ? semDetalle[a].size
      : [...semDetalle[a]].filter(x => semDetalle[b].has(x)).length).padStart(5);
    console.log(l);
  }

  const veces = {};
  for (const w of d) for (const p of semDetalle[w]) veces[p] = (veces[p] || 0) + 1;
  const vs = Object.values(veces);
  console.log(`\n  partidas que alguna vez tuvieron foto: ${vs.length}`);
  for (let k = 1; k <= Math.max(...vs); k++) {
    const n = vs.filter(x => x === k).length;
    if (n) console.log(`    con foto en ${k} semana(s): ${n} partida(s)`);
  }
  const enVarias = vs.filter(x => x >= 2).length;
  const ultimo = semDetalle[d[d.length - 1]];
  const tresAtras = semDetalle[d[Math.max(0, d.length - 4)]];
  const comun = [...tresAtras].filter(x => ultimo.has(x)).length;
  console.log(`\n  «hace tres semanas contra hoy» (${d[Math.max(0, d.length - 4)]} vs ${d[d.length - 1]}):` +
              ` ${comun} partida(s) en común`);
  console.log(`  una partida a lo largo de sus semanas: ${enVarias} partida(s) con dos o más`);
  console.log(comun < enVarias / 2
    ? '\n  El eje de la comparación es la PARTIDA, no el par de semanas.\n'
    : '\n  Las dos columnas por semana tienen material.\n');
})().catch(e => { console.error('\nNO SE PUDO MEDIR:', e.message); process.exit(2); });
