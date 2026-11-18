#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// QUÉ LLENA `avance/subs` Y `avance/historial` — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE. `medir-los-candidatos-del-lote.cjs` ya contestó que el #30 y
// el #28 siguen vivos, pero dejó una cifra que desmiente el renglón: en la
// 0112 las URLs son el 75% del documento, y en la PEOR —la 0114, al 25.7% del
// tope— son el 21%. El otro 79% es algo que el renglón no nombra, y la 0125
// tiene 461 partidas con CERO URLs y pesa 73 KB.
//
// Arreglar «las URLs» sin saber eso dejaría el documento que de verdad está
// cerca del tope casi igual de gordo. Es el mismo error del #47, donde el
// renglón culpaba al parser equivocado.
//
// LAS TRES PREGUNTAS:
//
//   1. ¿QUÉ CAMPO LLENA CADA DOCUMENTO? Peso por nombre de campo, de la partida
//      hacia adentro. No «las fotos pesan»: cuál campo, cuántos bytes.
//
//   2. ¿ESAS 741 URLs SON LA FUENTE VIVA O PESO MUERTO? La evidencia migró a
//      `obras/{id}/evidencia/{eid}` y cada obra declara su fuente en
//      `config/evidencia`. Si una obra ya está migrada, el mapa `fotos` de
//      `avance/subs` ya no lo lee nadie — y entonces el arreglo no es
//      reconstruir la URL desde la ruta, es dejar de arrastrar un campo muerto,
//      que es mucho más barato y no puede perder una foto.
//
//   3. ¿EL RECORTE DE 52 SEMANAS YA MORDIÓ? El renglón dice que borró 7 cierres
//      de la 0114. `crearSnapshotAvance` deja constancia (`perdidas`,
//      `ultimaPerdida`, `primeraConservada`). Si el campo no está, no mordió
//      nunca y el renglón cuenta un hecho que no pasó.
//
// SÓLO LEE, POR CONSTRUCCIÓN. La única función de red es `pedir()` y hace
// `https.get`. Este archivo no contiene un POST, un PATCH ni un DELETE, y no
// carga `firebase-admin`. Apunta a producción SIEMPRE y a propósito: la
// pregunta es qué hay en producción, y un emulador contestaría que no hay nada.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-que-llena-los-dos-documentos.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;
const TOPE = 1048576; // 1 MiB, el tope de un documento de Firestore

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(2); }

// Una lectura que falla PARA el guion. Devolver `null` y seguir convierte un
// token vencido en «cero fotos», que es creíble y falso.
const pedir = (ruta) => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
    r.setEncoding('utf8');
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => {
      if (r.statusCode === 200) return res(JSON.parse(b));
      if (r.statusCode === 404) return res(null);
      rej(new Error(`Firestore contestó ${r.statusCode} en ${ruta}\n${b.slice(0, 300)}`));
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

const kb = n => `${(n / 1024).toFixed(1)} KB`;
const H = (t) => console.log(`\n${'─'.repeat(74)}\n${t}\n${'─'.repeat(74)}`);

// Peso por NOMBRE DE CAMPO, una capa adentro de la partida. Lo que se cobra es
// la llave más el valor, porque Firestore guarda las dos y una llave repetida
// 461 veces también pesa.
const pesoPorCampo = (lista) => {
  const acc = {};
  const peso = (x) => {
    if (typeof x === 'string') return Buffer.byteLength(x);
    if (typeof x === 'number') return 8;
    if (typeof x === 'boolean') return 1;
    if (Array.isArray(x)) return x.reduce((a, v) => a + peso(v), 0);
    if (x && typeof x === 'object') {
      return Object.entries(x).reduce((a, [k, v]) => a + Buffer.byteLength(k) + peso(v), 0);
    }
    return 0;
  };
  for (const p of lista) {
    if (!p || typeof p !== 'object') continue;
    for (const [k, v] of Object.entries(p)) {
      acc[k] = (acc[k] || 0) + Buffer.byteLength(k) + peso(v);
    }
  }
  return acc;
};

const contarUrls = (x) => {
  let n = 0, bytes = 0;
  const and = (y) => {
    if (typeof y === 'string') {
      if (/firebasestorage|storage\.googleapis/.test(y)) { n++; bytes += Buffer.byteLength(y); }
      return;
    }
    if (Array.isArray(y)) return y.forEach(and);
    if (y && typeof y === 'object') return Object.values(y).forEach(and);
  };
  and(x);
  return { n, bytes };
};

(async () => {
  const veredicto = [];

  const raiz = await pedir('/obras?pageSize=300');
  const obras = ((raiz && raiz.documents) || []).map(d => ({ id: d.name.split('/').pop(), ruta: '/obras' }));
  const orgs = await pedir('/orgs?pageSize=50');
  for (const o of ((orgs && orgs.documents) || [])) {
    const oid = o.name.split('/').pop();
    const l = await pedir(`/orgs/${oid}/obras?pageSize=300`);
    for (const d of ((l && l.documents) || [])) {
      obras.push({ id: d.name.split('/').pop(), ruta: `/orgs/${oid}/obras`, org: oid });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1 · QUÉ CAMPO LLENA `avance/subs`
  // ══════════════════════════════════════════════════════════════════════════
  H('1 · `avance/subs`: peso por campo, no «las fotos pesan»');
  for (const o of obras) {
    const d = await pedir(`${o.ruta}/${o.id}/avance/subs`);
    if (!d) continue;
    const c = campos(d);
    const lista = Array.isArray(c.data) ? c.data : [];
    if (!lista.length) { console.log(`  ${o.id}  (sin \`data\`; campos: ${Object.keys(c).join(', ') || '—'})`); continue; }
    const acc = pesoPorCampo(lista);
    const total = Object.values(acc).reduce((a, b) => a + b, 0);
    const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`\n  ${o.id}  ${lista.length} partida(s), ≈${kb(total)} (${(total / TOPE * 100).toFixed(1)}% del tope)`);
    for (const [k, v] of top) {
      console.log(`      ${k.padEnd(12)} ${kb(v).padStart(9)}  ${(v / total * 100).toFixed(0).padStart(3)}%`);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2 · ¿LAS URLs DE `subs` SON LA FUENTE VIVA, O PESO MUERTO?
  // ══════════════════════════════════════════════════════════════════════════
  H('2 · ¿quién manda hoy, el mapa `fotos` de subs o la subcolección `evidencia`?');
  let muertas = 0, vivas = 0;
  for (const o of obras) {
    const bandera = campos(await pedir(`${o.ruta}/${o.id}/config/evidencia`));
    const d = campos(await pedir(`${o.ruta}/${o.id}/avance/subs`));
    const lista = Array.isArray(d.data) ? d.data : [];
    const enSubs = contarUrls(lista.map(p => (p && p.fotos) || null));

    // Cuántos documentos hay en la subcolección (paginando: 300 no alcanza en
    // la 0114, y contar los primeros 300 diría que faltan fotos que sí están).
    let enSub = 0, tok = null;
    do {
      const q = `?pageSize=300${tok ? `&pageToken=${encodeURIComponent(tok)}` : ''}`;
      const r = await pedir(`${o.ruta}/${o.id}/evidencia${q}`);
      if (!r) break;
      enSub += (r.documents || []).length;
      tok = r.nextPageToken || null;
    } while (tok);

    if (!enSubs.n && !enSub) continue;
    const migrada = !!(bandera && (bandera.migrada || bandera.formato === 2 || bandera.fuente === 'subcoleccion'));
    if (migrada) muertas += enSubs.n; else vivas += enSubs.n;
    console.log(`  ${o.id.padEnd(8)} subs:${String(enSubs.n).padStart(4)} URL(s) ≈${kb(enSubs.bytes).padStart(8)}   ` +
      `evidencia/:${String(enSub).padStart(4)} doc(s)   bandera: ${
        bandera && Object.keys(bandera).length ? JSON.stringify(bandera).slice(0, 60) : 'NO EXISTE'}`);
  }
  console.log(`\n  URLs en \`subs\` de obras YA migradas (peso muerto): ${muertas}`);
  console.log(`  URLs en \`subs\` de obras NO migradas (fuente viva):  ${vivas}`);
  veredicto.push(muertas > 0 && vivas === 0
    ? `#30 ES OTRA COSA: las ${muertas} URLs de \`subs\` ya no las lee nadie — el arreglo es dejar de arrastrarlas, no reconstruirlas`
    : vivas > 0
      ? `#30 COMO DICE EL RENGLÓN en ${vivas} URL(s): esas obras todavía leen el mapa de \`subs\``
      : `#30 sin URLs que clasificar`);

  // ══════════════════════════════════════════════════════════════════════════
  // 3 · ¿EL RECORTE DE 52 SEMANAS YA MORDIÓ?
  // ══════════════════════════════════════════════════════════════════════════
  H('3 · `avance/historial`: ¿el recorte dejó constancia de haber borrado?');
  let algunRecorte = false;
  for (const o of obras) {
    const c = campos(await pedir(`${o.ruta}/${o.id}/avance/historial`));
    if (!c || !Object.keys(c).length) continue;
    const sem = Array.isArray(c.semanas) ? c.semanas : [];
    const rec = c.recorte || {};
    const perdidas = Number(rec.perdidas || c.perdidas || 0) || 0;
    if (perdidas > 0) algunRecorte = true;
    const acc = pesoPorCampo(sem);
    const total = Object.values(acc).reduce((a, b) => a + b, 0);
    const top = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k} ${kb(v)}`).join(' · ');
    console.log(`  ${o.id.padEnd(8)} ${String(sem.length).padStart(3)} sem  ≈${kb(total).padStart(9)}  ` +
      `perdidas:${String(perdidas).padStart(3)}  ${top}`);
  }
  veredicto.push(algunRecorte
    ? '#28 YA MORDIÓ: hay constancia de semanas borradas en producción'
    : '#28 TODAVÍA NO MUERDE: ninguna obra tiene constancia de recorte — el renglón dice que borró 7 cierres de la 0114 y eso no está en el dato de hoy');

  // ══════════════════════════════════════════════════════════════════════════
  // 4 · ¿EL TOPE DE 52 SEMANAS LLEGA ANTES QUE EL TOPE DE 1 MiB?
  // ══════════════════════════════════════════════════════════════════════════
  //
  // El recorte existe para que el documento no reviente. Sólo sirve si 52
  // semanas pesan menos de 1 MiB. Como cada cierre guarda una COPIA del
  // catálogo entero, el peso por semana lo fija el tamaño del catálogo de ESA
  // obra — y el 52 se calibró sobre una sola.
  H('4 · ¿quién llega primero, el recorte de 52 o el tope de 1 MiB?');
  let hayCapado = false;
  for (const o of obras) {
    const c = campos(await pedir(`${o.ruta}/${o.id}/avance/historial`));
    if (!c || !Object.keys(c).length) continue;
    const sem = Array.isArray(c.semanas) ? c.semanas : [];
    if (!sem.length) continue;
    const total = Object.values(pesoPorCampo(sem)).reduce((a, b) => a + b, 0);
    const porSemana = total / sem.length;
    const cabenEn1MiB = Math.floor(TOPE / porSemana);
    const gana = cabenEn1MiB < 52 ? 'EL TOPE DE 1 MiB' : 'el recorte de 52';
    if (cabenEn1MiB < 52) hayCapado = true;
    console.log(`  ${o.id.padEnd(8)} ${String(sem.length).padStart(3)} sem · ${kb(porSemana).padStart(9)}/sem · ` +
      `caben ${String(cabenEn1MiB).padStart(4)} antes de 1 MiB → gana ${gana}` +
      (cabenEn1MiB < 52 ? `  (revienta en la semana ~${cabenEn1MiB}, faltan ${cabenEn1MiB - sem.length})` : ''));
  }
  veredicto.push(hayCapado
    ? '#28 EL RECORTE DE 52 NO PROTEGE: en al menos una obra el documento llega a 1 MiB ANTES de la semana 52, así que lo que pasa no es que se borre el cierre viejo — es que el cierre nuevo no se puede escribir'
    : '#28 el recorte de 52 llega antes que el tope en todas las obras medidas');

  H('EN UN RENGLÓN CADA UNO');
  for (const s of veredicto) console.log(`  · ${s}`);
  console.log('');
})().catch(e => { console.error('\nNO SE PUDO MEDIR:', e.message); process.exit(2); });
