#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿SE PUEDEN BORRAR LAS URLs DE `avance/subs`? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. En las obras ya migradas, el mapa `fotos` de `obras/{id}/avance/subs`
// no lo lee nadie: `evidenciaDeObra` (App.jsx) devuelve la subcolección y nada
// más en cuanto `config/evidencia.migrada` es `true`. Son 668 URLs de peso
// muerto —el 90% de las 741 de producción— y además un token de acceso a
// Storage replicado en un documento que lee todo el que puede leer la obra.
//
// Quitarlas es un BORRADO de producción, así que se pide. Lo que este guion
// contesta es la pregunta que hay que tener contestada ANTES de pedirlo: si
// borrarlas pierde una sola foto del expediente.
//
// LO QUE NO VALE COMO RESPUESTA: que los números cuadren. La 0114 tiene 284
// URLs en `subs` y 304 documentos en `evidencia`, y de ahí no se sigue que las
// 284 estén entre las 304 — podrían ser 284 distintas. Comparar dos cuentas es
// la misma trampa que comparar una lista contra su propio `.sort()`: no afirma
// nada. Aquí se cruza URL POR URL.
//
// Y SE CRUZA POR LA RUTA DE STORAGE, NO POR LA URL ENTERA. La URL lleva un
// `?alt=media&token=…` que la migración no tenía por qué conservar igual; lo
// que identifica al archivo es la ruta del objeto, que va en el path y sale
// igual de las dos formas. Comparar las URLs completas daría «no está» para
// fotos que sí están, y eso habría dejado el borrado bloqueado para siempre
// por una diferencia que no es de contenido.
//
// SÓLO LEE, POR CONSTRUCCIÓN. La única función de red es `pedir()` y hace
// `https.get`. No hay POST, PATCH ni DELETE, y no se carga `firebase-admin`.
//
// Tres estados, como todo aquí:
//   0  se puede borrar: cada URL de `subs` tiene su archivo en la subcolección
//   1  NO se puede: hay al menos una foto que sólo existe en `subs`
//   2  no se pudo medir
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/verificar-las-fotos-de-subs-son-redundantes.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('NO SE PUDO MEDIR: falta /tmp/adc.tok'); process.exit(2); }

const pedir = (ruta) => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
    r.setEncoding('utf8');
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => {
      if (r.statusCode === 200) return res(JSON.parse(b));
      if (r.statusCode === 404) return res(null);
      rej(new Error(`Firestore contestó ${r.statusCode} en ${ruta}`));
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

// La ruta del objeto dentro del bucket, que es lo que identifica al archivo.
// En una URL de descarga va percent-encoded entre `/o/` y el `?`.
const rutaDeStorage = (s) => {
  const t = String(s || '');
  const m = t.match(/\/o\/([^?]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  // Ya es una ruta y no una URL (así la guarda la subcolección en `rutaStorage`).
  return /^https?:\/\//.test(t) ? '' : t;
};

(async () => {
  const obras = [];
  const raiz = await pedir('/obras?pageSize=300');
  for (const d of ((raiz && raiz.documents) || [])) obras.push({ id: d.name.split('/').pop(), ruta: '/obras' });
  const orgs = await pedir('/orgs?pageSize=50');
  for (const o of ((orgs && orgs.documents) || [])) {
    const oid = o.name.split('/').pop();
    const l = await pedir(`/orgs/${oid}/obras?pageSize=300`);
    for (const d of ((l && l.documents) || [])) obras.push({ id: d.name.split('/').pop(), ruta: `/orgs/${oid}/obras` });
  }

  console.log(`\n${'obra'.padEnd(8)}${'en subs'.padStart(9)}${'en evidencia'.padStart(14)}` +
              `${'sólo en subs'.padStart(14)}  veredicto`);
  console.log('─'.repeat(74));

  let huerfanas = 0, borrables = 0, obrasListas = [], obrasNo = [];
  for (const o of obras) {
    const cfg = campos(await pedir(`${o.ruta}/${o.id}/config/evidencia`));
    if (!(cfg && cfg.migrada === true)) continue;   // sin migrar, el mapa es la fuente viva

    const d = campos(await pedir(`${o.ruta}/${o.id}/avance/subs`));
    const lista = Array.isArray(d.data) ? d.data : [];
    const enSubs = new Set();
    for (const p of lista) {
      const f = (p && p.fotos) || {};
      const todas = Array.isArray(f) ? f : Object.values(f).flat();
      for (const foto of todas) {
        const url = typeof foto === 'string' ? foto : (foto && (foto.url || foto.src)) || '';
        const r = rutaDeStorage(url);
        if (r) enSubs.add(r);
      }
    }

    // Paginando: contar las primeras 300 diría que faltan fotos que sí están,
    // y eso bloquearía un borrado que sí se puede hacer.
    const enSub = new Set();
    let tok = null;
    do {
      const q = `?pageSize=300${tok ? `&pageToken=${encodeURIComponent(tok)}` : ''}`;
      const r = await pedir(`${o.ruta}/${o.id}/evidencia${q}`);
      if (!r) break;
      for (const doc of (r.documents || [])) {
        const c = campos(doc);
        for (const cand of [c.rutaStorage, c.urlOriginal, c.url]) {
          const x = rutaDeStorage(cand);
          if (x) enSub.add(x);
        }
      }
      tok = r.nextPageToken || null;
    } while (tok);

    const solo = [...enSubs].filter(r => !enSub.has(r));
    huerfanas += solo.length;
    borrables += enSubs.size - solo.length;
    const ok = solo.length === 0;
    (ok ? obrasListas : obrasNo).push(o.id);
    console.log(`${o.id.padEnd(8)}${String(enSubs.size).padStart(9)}${String(enSub.size).padStart(14)}` +
                `${String(solo.length).padStart(14)}  ${ok ? 'se puede borrar' : 'NO — se perderían fotos'}`);
    for (const r of solo.slice(0, 3)) console.log(`        sólo en subs: ${r}`);
  }

  console.log('─'.repeat(74));
  if (huerfanas > 0) {
    console.log(`\nROJO — ${huerfanas} foto(s) existen SÓLO en \`avance/subs\`.`);
    console.log(`Borrar el mapa las perdería. Obras afectadas: ${obrasNo.join(', ')}.`);
    process.exit(1);
  }
  console.log(`\nVERDE — las ${borrables} URL(s) de \`avance/subs\` están todas en la`);
  console.log(`subcolección \`evidencia\`, cruzadas por ruta de Storage y no por conteo.`);
  console.log(`Obras listas: ${obrasListas.join(', ') || '(ninguna migrada)'}.`);
  console.log(`\nEl borrado NO lo hace este guion: se pide aparte.\n`);
})().catch(e => { console.error('\nNO SE PUDO MEDIR:', e.message); process.exit(2); });
