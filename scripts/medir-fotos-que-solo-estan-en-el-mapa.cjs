#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS FOTOS QUE SÓLO ESTÁN EN `avance/subs` — ¿DE CUÁNDO SON? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. `verificar-las-fotos-de-subs-son-redundantes.cjs` dice CUÁNTAS fotos
// viven sólo en el mapa incrustado y bloquea el borrado por eso. Lo que no dice
// —y es lo que decide qué hay que arreglar— es de cuándo son:
//
//   · Si son ANTERIORES a `config/evidencia.migradaEn`, la migración se las
//     dejó: es un rescate de una vez y el camino de escritura está bien.
//   · Si son POSTERIORES, algo siguió escribiendo en el mapa DESPUÉS de que la
//     bandera subiera. Entonces rescatarlas no sirve de nada: mañana hay más,
//     y el defecto está en el camino de escritura, no en los datos.
//
// Son dos trabajos distintos y la diferencia no se adivina, se mide. La hora la
// pone el servidor de Google al recibir el archivo (`timeCreated` de Storage),
// no el teléfono: la fecha declarada del mapa está corrida un día en 48 de las
// 656 fotos de producción (ver `medir-evidencia-para-migrar.cjs`), así que
// decidir con ella podría poner una foto del lado equivocado de la frontera.
// Se enseñan las dos.
//
// SE CRUZA POR LA RUTA DE STORAGE, NO POR LA URL ENTERA, por lo mismo que el
// verificador: el `?alt=media&token=…` no tenía por qué conservarse igual y
// comparar URLs completas daría «no está» para fotos que sí están.
//
// SÓLO LEE, POR CONSTRUCCIÓN. La única función de red es `pedir()` y hace
// `https.get`. No hay POST, PATCH ni DELETE, y no se carga `firebase-admin`.
//
// Esto NO tiene veredicto: mide y describe. Sale 0 si pudo medir y 2 si no.
// Quien decide si se puede borrar es el verificador, que sí tiene veredicto.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-fotos-que-solo-estan-en-el-mapa.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const P = 'campo-fosmon';
const BUCKET = 'campo-fosmon.firebasestorage.app';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('NO SE PUDO MEDIR: falta /tmp/adc.tok'); process.exit(2); }

const pedir = (host, ruta) => new Promise((res, rej) => {
  https.get({ host, path: ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } }, r => {
    const trozos = [];
    r.on('data', d => trozos.push(Buffer.from(d)));
    r.on('end', () => {
      const b = Buffer.concat(trozos).toString('utf8');
      if (r.statusCode === 200) return res(JSON.parse(b));
      if (r.statusCode === 404) return res(null);
      rej(new Error(`${host} contestó ${r.statusCode} en ${ruta}\n${b.slice(0, 300)}`));
    });
  }).on('error', rej);
});
const fsPedir = (ruta) => pedir('firestore.googleapis.com', BASE + ruta);

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

const rutaDeStorage = (s) => {
  const t = String(s || '');
  const m = t.match(/\/o\/([^?]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return /^https?:\/\//.test(t) ? '' : t;
};

// El inventario de Storage, para la hora que puso el servidor.
const inventario = async () => {
  const objetos = new Map();
  let tok = null;
  do {
    const q = new URLSearchParams({ prefix: 'obras/', maxResults: '1000',
      fields: 'items(name,timeCreated,size),nextPageToken' });
    if (tok) q.set('pageToken', tok);
    const r = await pedir('storage.googleapis.com',
      `/storage/v1/b/${encodeURIComponent(BUCKET)}/o?${q}`);
    for (const it of (r.items || []))
      objetos.set(it.name, { creado: it.timeCreated, bytes: Number(it.size) });
    tok = r.nextPageToken || null;
  } while (tok);
  return objetos;
};

(async () => {
  const objetos = await inventario();
  console.log(`\n${objetos.size.toLocaleString('es-MX')} objeto(s) en Storage con su hora de servidor.`);

  const obras = [];
  for (const d of ((await fsPedir('/obras?pageSize=300'))?.documents || []))
    obras.push({ id: d.name.split('/').pop(), ruta: '/obras' });
  for (const o of ((await fsPedir('/orgs?pageSize=50'))?.documents || [])) {
    const oid = o.name.split('/').pop();
    for (const d of ((await fsPedir(`/orgs/${oid}/obras?pageSize=300`))?.documents || []))
      obras.push({ id: d.name.split('/').pop(), ruta: `/orgs/${oid}/obras` });
  }

  let totalSolo = 0, antes = 0, despues = 0, sinObjeto = 0, sinHora = 0;

  for (const o of obras) {
    const cfg = campos(await fsPedir(`${o.ruta}/${o.id}/config/evidencia`));
    if (!(cfg && cfg.migrada === true)) continue;

    // Las rutas que YA tienen documento propio.
    const enSub = new Set();
    let tok = null;
    do {
      const q = `?pageSize=300${tok ? `&pageToken=${encodeURIComponent(tok)}` : ''}`;
      const r = await fsPedir(`${o.ruta}/${o.id}/evidencia${q}`);
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

    // Las del mapa, con su partida y su fecha declarada.
    const d = campos(await fsPedir(`${o.ruta}/${o.id}/avance/subs`));
    const lista = Array.isArray(d.data) ? d.data : [];
    const solo = [];
    lista.forEach((p, ip) => {
      const f = (p && p.fotos) || {};
      const todas = Array.isArray(f) ? f : Object.values(f).flat();
      for (const foto of todas.filter(Boolean)) {
        const esObj = foto && typeof foto === 'object';
        const url = esObj ? (foto.url || foto.src || '') : String(foto || '');
        const r = rutaDeStorage(url);
        if (!r || enSub.has(r)) continue;
        solo.push({ ruta: r,
          partida: (p && (p.id || p.sec)) || `#${ip}`,
          clave: (p && p.sec) || '',
          declarada: (esObj && foto.fecha) || null,
          anulada: !!(esObj && foto.anulada),
          objeto: objetos.get(r) || null });
      }
    });
    if (!solo.length) continue;

    const frontera = cfg.migradaEn || null;
    console.log('\n' + '═'.repeat(76));
    console.log(`OBRA ${o.id}  ·  ${solo.length} foto(s) sólo en el mapa`);
    console.log(`bandera arriba desde: ${frontera || '(config/evidencia no guarda migradaEn)'}` +
                `  ·  fotosMigradas: ${cfg.fotosMigradas ?? '(no dice)'}`);
    console.log('═'.repeat(76));
    for (const s of solo) {
      totalSolo++;
      const creado = s.objeto?.creado || null;
      let lado = 'no se puede situar';
      if (!s.objeto) { sinObjeto++; lado = 'NO HAY OBJETO EN STORAGE'; }
      else if (!frontera) { sinHora++; lado = 'sin frontera que comparar'; }
      else if (creado < frontera) { antes++; lado = 'ANTES de la bandera'; }
      else { despues++; lado = 'DESPUÉS de la bandera'; }
      console.log(`  ${lado}`);
      console.log(`    ruta      ${s.ruta}`);
      console.log(`    partida   ${s.partida}  (${s.clave})${s.anulada ? '  · anulada' : ''}`);
      console.log(`    servidor  ${creado || '—'}    declarada  ${s.declarada || '—'}`);
    }
  }

  console.log('\n' + '─'.repeat(76));
  if (!totalSolo) {
    console.log('Ninguna foto vive sólo en el mapa. No hay nada que situar.\n');
    process.exit(0);
  }
  console.log(`${totalSolo} foto(s) sólo en el mapa:`);
  console.log(`  ${antes} de ANTES de que subiera la bandera  → la migración se las dejó;`);
  console.log(`      es un rescate de una vez y el camino de escritura está bien.`);
  console.log(`  ${despues} de DESPUÉS  → algo siguió escribiendo en el mapa con la bandera`);
  console.log(`      arriba. Rescatarlas no alcanza: el defecto es del camino de escritura.`);
  if (sinObjeto) console.log(`  ${sinObjeto} sin objeto en Storage  → la URL del mapa no apunta a nada.`);
  if (sinHora) console.log(`  ${sinHora} sin frontera con la que comparar.`);
  console.log('');
  process.exit(0);
})().catch(e => { console.error('\nNO SE PUDO MEDIR:', e.message); process.exit(2); });
