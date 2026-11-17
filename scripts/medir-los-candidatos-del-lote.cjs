#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿SIGUEN VIVOS? — MEDICIÓN EN LECTURA DE LOS CANDIDATOS DEL LOTE
// ════════════════════════════════════════════════════════════════════════════
//
// Sólo LEE producción por REST. No escribe nada, en ningún lado: el token sólo
// se usa con `https.get`, y este archivo no contiene un solo `POST`, `PATCH`
// ni `DELETE`.
//
// Existe por una razón de método: la lista de pendientes son HIPÓTESIS, no
// tareas. La noche del 2026-11-16 se trabajaron cuatro renglones y tres tenían
// la premisa equivocada. Así que antes de elegir un lote se mide cada
// candidato y se contesta una sola pregunta: ¿sigue vivo, ya no existe, o es
// otra cosa de la que dice?
//
// Lo que NO hace: construir nada para poder medir. Si un renglón no se puede
// contestar leyendo, contando o ejecutando lo que ya existe, sale como
// «no se puede medir sin hacerlo» y se reporta el costo.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-los-candidatos-del-lote.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(2); }

// Una lectura que falla PARA el guion. Devolver `null` y seguir convierte un
// token vencido en «0 semanas», que es una respuesta creíble y falsa.
const pedir = (ruta) => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
    r.setEncoding('utf8');
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => {
      if (r.statusCode === 200) return res({ json: JSON.parse(b), bytes: Buffer.byteLength(b) });
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

// El peso que cuenta Firestore no es el del JSON de REST: es el de los campos.
// Se aproxima por el tamaño serializado de los valores, que es lo que crece
// cuando se guarda una URL de 400 letras en vez de una ruta de 60.
const pesoDeTexto = (o) => {
  let n = 0;
  const and = (x) => {
    if (typeof x === 'string') n += Buffer.byteLength(x);
    else if (Array.isArray(x)) x.forEach(and);
    else if (x && typeof x === 'object') Object.entries(x).forEach(([k, v]) => { n += Buffer.byteLength(k); and(v); });
  };
  and(o);
  return n;
};

(async () => {
  const salida = [];

  // ── Qué obras hay, y dónde ────────────────────────────────────────────────
  const raiz = await pedir('/obras?pageSize=300');
  const obrasRaiz = ((raiz && raiz.json.documents) || []).map(d => ({
    id: d.name.split('/').pop(), ruta: '/obras', c: campos(d),
  }));

  const orgs = await pedir('/orgs?pageSize=50');
  const obrasOrg = [];
  for (const o of ((orgs && orgs.json.documents) || [])) {
    const oid = o.name.split('/').pop();
    const l = await pedir(`/orgs/${oid}/obras?pageSize=300`);
    for (const d of ((l && l.json.documents) || [])) {
      obrasOrg.push({ id: d.name.split('/').pop(), ruta: `/orgs/${oid}/obras`, c: campos(d) });
    }
  }
  const obras = [...obrasRaiz, ...obrasOrg];
  console.log(`\nProducción: ${obrasRaiz.length} obra(s) en la raíz + ${obrasOrg.length} en organizaciones = ${obras.length}`);

  // ══════════════════════════════════════════════════════════════════════════
  // #30 — ¿el catálogo vivo `avance/subs` lo llenan las URLs de Storage?
  // ══════════════════════════════════════════════════════════════════════════
  H('#30 · `avance/subs` se llena, y lo llenan las URLs de Storage');
  let peorSubs = null, totalFotos = 0, conUrl = 0, sinUrl = 0;
  for (const o of obras) {
    const d = await pedir(`${o.ruta}/${o.id}/avance/subs`);
    if (!d) continue;
    const c = campos(d.json);
    // Las fotos viven dentro de las partidas. Se recorre sin suponer la forma.
    let urlBytes = 0, nFotos = 0, nPartidas = 0;
    const and = (x) => {
      if (Array.isArray(x)) return x.forEach(and);
      if (!x || typeof x !== 'object') return;
      for (const [k, v] of Object.entries(x)) {
        if (typeof v === 'string' && /^https?:\/\//.test(v)) {
          urlBytes += Buffer.byteLength(v);
          if (/firebasestorage|storage\.googleapis/.test(v)) { nFotos++; v.length > 0 ? conUrl++ : sinUrl++; }
        } else and(v);
      }
    };
    for (const [k, v] of Object.entries(c)) { if (Array.isArray(v)) nPartidas += v.length; and(v); }
    const peso = pesoDeTexto(c);
    totalFotos += nFotos;
    const reg = { obra: o.id, ruta: o.ruta, bytes: d.bytes, peso, urlBytes, nFotos, nPartidas,
                  pct: peso ? (urlBytes / peso * 100) : 0 };
    if (!peorSubs || reg.peso > peorSubs.peso) peorSubs = reg;
    if (reg.peso > 20000 || reg.nFotos > 0) {
      console.log(`  ${o.id.padEnd(10)} peso≈${kb(reg.peso).padStart(9)}  URLs≈${kb(reg.urlBytes).padStart(9)} (${reg.pct.toFixed(0)}%)  ${reg.nFotos} URL(s) de Storage, ${reg.nPartidas} entradas`);
    }
  }
  if (peorSubs) {
    console.log(`\n  El más grande: ${peorSubs.obra} con ≈${kb(peorSubs.peso)} de 1,048,576 B de tope (${(peorSubs.peso / 1048576 * 100).toFixed(1)}%).`);
    console.log(`  URLs de Storage dentro de \`avance/subs\` en TODA producción: ${totalFotos}`);
    salida.push(totalFotos > 0
      ? `#30 VIVO si las fotos vuelven a subs; hoy ${totalFotos} URL(s) ahí y el peor documento va al ${(peorSubs.peso / 1048576 * 100).toFixed(1)}% del tope`
      : `#30 OTRA COSA: cero URLs de Storage en \`avance/subs\`; el peor documento va al ${(peorSubs.peso / 1048576 * 100).toFixed(1)}% del tope y lo llena algo que NO son las URLs`);
  } else salida.push('#30 NO MEDIDO: ninguna obra tiene `avance/subs`');

  // ══════════════════════════════════════════════════════════════════════════
  // #28 — el historial de avance en UN documento, con tope de 52 semanas
  // ══════════════════════════════════════════════════════════════════════════
  H('#28 · `avance/historial`: un documento, tope de 52 semanas');
  let peorHist = null;
  for (const o of obras) {
    const d = await pedir(`${o.ruta}/${o.id}/avance/historial`);
    if (!d) continue;
    const c = campos(d.json);
    const sem = Array.isArray(c.semanas) ? c.semanas : [];
    const peso = pesoDeTexto(c);
    const reg = { obra: o.id, n: sem.length, peso, pct: peso / 1048576 * 100 };
    if (!peorHist || reg.n > peorHist.n) peorHist = reg;
    console.log(`  ${o.id.padEnd(10)} ${String(reg.n).padStart(3)} semana(s)  peso≈${kb(peso).padStart(9)} (${reg.pct.toFixed(1)}% del tope)`);
  }
  if (peorHist) {
    const margen = 52 - peorHist.n;
    console.log(`\n  La más cargada: ${peorHist.obra} con ${peorHist.n}/52 semanas — quedan ${margen} cierres antes de que el recorte empiece a borrar.`);
    salida.push(`#28 VIVO: la obra más cargada va en ${peorHist.n}/52 semanas (${margen} cierres de margen, ≈${(margen / 4.3).toFixed(0)} meses al ritmo de uno por semana)`);
  } else salida.push('#28 NO MEDIDO: ninguna obra tiene `avance/historial`');

  // ══════════════════════════════════════════════════════════════════════════
  // #47 — el año de la semana se pierde en `global/gp`
  // ══════════════════════════════════════════════════════════════════════════
  H('#47 · el año de la semana, en las claves `week_` de `global/gp`');
  // `global/gp` no existe: el documento se llama `gp_construct` (App.jsx:2124).
  // Mi primer intento pidió `/global/gp`, cobró 404 y lo publicó como «no se
  // pudo leer» — correcto que no lo haya dado por vacío.
  const gp = await pedir('/global/gp_construct');
  if (gp) {
    const c = campos(gp.json);
    const ws = Object.keys(c).filter(k => /^week_/i.test(k));
    const anios = new Set();
    // Y las que viven dentro de un campo, no como llave suelta.
    const dentro = [];
    for (const [k, v] of Object.entries(c)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const k2 of Object.keys(v)) if (/^week_|^S\d|^Y\d{4}-S/.test(k2)) dentro.push(`${k}.${k2}`);
      }
    }
    for (const k of [...ws, ...dentro]) { const m = k.match(/20\d\d/); if (m) anios.add(m[0]); }
    console.log(`  claves \`week_\` sueltas: ${ws.length}`);
    console.log(`  claves de semana dentro de un campo: ${dentro.length}${dentro.length ? ` (p. ej. ${dentro.slice(0, 3).join(', ')})` : ''}`);
    console.log(`  años distintos detectados en los nombres: ${anios.size ? [...anios].sort().join(', ') : 'ninguno — las claves no llevan año'}`);
    salida.push(anios.size > 1
      ? `#47 MUERDE HOY: hay semanas de ${[...anios].sort().join(' y ')} y \`weekColsByYear\` se queda con el año más reciente`
      : `#47 LATENTE: ${ws.length + dentro.length} clave(s) de semana, ${anios.size ? `todas de ${[...anios][0]}` : 'sin año en el nombre'} — el daño llega con el primer cierre de 2027`);
  } else salida.push('#47 NO MEDIDO: `global/gp` no se pudo leer');

  // ══════════════════════════════════════════════════════════════════════════
  // #25 — `global/health` registra la intención o el hecho
  // ══════════════════════════════════════════════════════════════════════════
  H('#25 · `global/health`: lo último que se registró de cada trabajo');
  const salud = await pedir('/global/health');
  if (salud) {
    const c = campos(salud.json);
    const filas = Object.entries(c).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
    for (const [k, v] of filas.slice(0, 20)) {
      const cuando = v.ultimaEjecucion || v.ts || v.fecha || v.cuando || '—';
      console.log(`  ${k.padEnd(28)} ${String(v.estado || v.status || '—').padEnd(10)} ${String(cuando).slice(0, 19)}`);
    }
    salida.push(`#25 se contesta leyendo \`functions/index.js\`, no estos datos: ${filas.length} trabajo(s) con registro`);
  } else salida.push('#25 NO MEDIDO: `global/health` no se pudo leer');

  // ══════════════════════════════════════════════════════════════════════════
  // #7 — obra 0112: lo ejecutado contra las estimaciones del residente
  // ══════════════════════════════════════════════════════════════════════════
  H('#7 · obra 0112: lo ejecutado contra lo estimado');
  const o112 = obras.find(o => o.id.includes('0112'));
  if (!o112) { console.log('  no está en producción con ese id'); salida.push('#7 NO MEDIDO: no hay obra 0112'); }
  else {
    // Las estimaciones viven en `config/estimaciones`, y los dos campos que
    // mandan el dinero son `monto` y `estatus` (App.jsx:6867). `estimaciones/lista`
    // —mi primer intento— no existe: dio 404 y salió como no medido.
    const est = await pedir(`${o112.ruta}/${o112.id}/config/estimaciones`);
    const info = await pedir(`${o112.ruta}/${o112.id}/config/info`);
    const ce = est ? campos(est.json) : {};
    const lista = Object.values(ce).find(Array.isArray) || [];
    const sum = lista.reduce((a, e) => a + (Number(e && e.monto) || 0), 0);
    const porEstatus = {};
    for (const e of lista) { const k = (e && e.estatus) || 'sin estatus'; porEstatus[k] = (porEstatus[k] || 0) + (Number(e && e.monto) || 0); }
    const ci = info ? campos(info.json) : {};
    const contrato = Number(ci.montoContrato || ci.monto || ci.importe || 0) || 0;
    console.log(`  campos de \`config/estimaciones\`: ${Object.keys(ce).join(', ') || '(vacío)'}`);
    console.log(`  estimaciones capturadas: ${lista.length}, suman $${sum.toLocaleString('es-MX')}`);
    for (const [k, v] of Object.entries(porEstatus)) console.log(`    ${k.padEnd(14)} $${v.toLocaleString('es-MX')}`);
    console.log(`  contrato en \`config/info\` (campos: ${Object.keys(ci).slice(0, 12).join(', ')}): $${contrato.toLocaleString('es-MX')}`);
    salida.push(lista.length === 0
      ? `#7 NO SE PUEDE MEDIR EN LECTURA: la 0112 no tiene ninguna estimación capturada en \`config/estimaciones\`; el renglón compara contra un dato que no está en producción`
      : `#7 medible: ${lista.length} estimaciones por $${sum.toLocaleString('es-MX')} contra un contrato de $${contrato.toLocaleString('es-MX')}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  H('EN UN RENGLÓN CADA UNO');
  for (const s of salida) console.log(`  · ${s}`);
  console.log('');
})().catch(e => { console.error('\nNO SE PUDO MEDIR:', e.message); process.exit(2); });
