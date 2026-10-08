#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA EVIDENCIA QUE YA EXISTE, MEDIDA ANTES DE MOVERLA (PENDIENTES #30 y #52)
// ════════════════════════════════════════════════════════════════════════════
//
// Solo LEE. No escribe en Firestore ni en Storage.
//
// La parte 0 saca las fotos de dentro de `obras/{id}/avance/subs` y les da un
// documento propio en `obras/{id}/evidencia/{eid}`. Antes de mover nada hay que
// saber qué se está moviendo, porque la migración tiene dos datos que NO se
// pueden copiar tal cual:
//
//   1. LA FECHA NO ES CONFIABLE. `addFoto` guarda `fecha: hoyLocalISO()`, o sea
//      el reloj del teléfono del residente. Un teléfono con la fecha mal puesta
//      —o puesta a mano, o simplemente en otro huso— mete evidencia en el día
//      que quiera. La hora de verdad es `timeCreated` del objeto en Storage,
//      que la pone el servidor de Google cuando recibe el archivo.
//
//      **La comparación entre las dos hay que hacerla con cuidado, porque la
//      versión fácil miente.** `timeCreated` viene en UTC y `hoyLocalISO()` es
//      la fecha LOCAL del teléfono. Comparar `timeCreated.slice(0,10)` contra
//      `fecha` da «656 de 656 coinciden» —acuerdo perfecto, cero sospecha— y es
//      falso: convirtiendo a `America/Mexico_City` aparecen 48 fotos donde el
//      servidor dice el día ANTERIOR al declarado. Son subidas de cerca de la
//      medianoche con el teléfono en UTC-5 en vez de UTC-6. Medido 2026-10-08.
//      Este guion hace las dos comparaciones y enseña las dos, justo para que
//      nadie vuelva a creerle a la fácil.
//
//   2. NO HAY AUTOR Y NUNCA LO VA A HABER. Ninguna foto de hoy guarda un uid.
//      No es recuperable: Storage no registra quién subió el objeto en los
//      metadatos que podemos leer. Así que estas fotos se migran marcadas como
//      legado, y la pantalla no puede presentarlas igual que una captura en
//      vivo con coordenadas y hora de servidor.
//
// La tercera pregunta es la del #30: ¿el emparejado entre lo que dice Firestore
// y lo que hay en Storage es completo? Si hay fotos en el documento que no
// tienen objeto, migrarlas es migrar una URL muerta. Si hay objetos que nadie
// referencia, son huérfanos que el borrado local dejó atrás.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   gsutil ls -l -r "gs://campo-fosmon.firebasestorage.app/obras/**" > /tmp/storage-obras.txt
//   node scripts/medir-evidencia-para-migrar.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const raiz = path.resolve(__dirname, '..');

const P = 'campo-fosmon';
const BUCKET = 'campo-fosmon.firebasestorage.app';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(2); }

// Una lectura que falla PARA el guion. Devolver `null` y seguir hace que un
// token vencido salga como «0 fotos», que es una respuesta creíble y falsa.
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

// ── Lo que hace la app, extraído de la app ──────────────────────────────────
// `fotosDeSub` no se reimplementa: se saca del archivo y se ejecuta, para que
// lo medido sea lo que la pantalla ve y no lo que yo crea que ve.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
let fotosDeSubSrc = null;
traverse(ast, { VariableDeclarator(p) {
  if (p.node.id.name === 'fotosDeSub' && p.node.init && !fotosDeSubSrc)
    fotosDeSubSrc = src.slice(p.node.init.start, p.node.init.end);
} });
if (!fotosDeSubSrc) { console.error('No se pudo extraer `fotosDeSub` de src/App.jsx'); process.exit(2); }
const fotosDeSub = new Function(`"use strict"; return ${fotosDeSubSrc};`)();

// ── Storage: el inventario real, con la hora del servidor ───────────────────
// `gsutil ls -l -r` da «bytes  timeCreated  gs://…», que es exactamente
// `timeCreated` del objeto: la hora que puso Google al recibirlo.
const LISTADO = '/tmp/storage-obras.txt';
if (!fs.existsSync(LISTADO)) {
  console.error(`Falta ${LISTADO} — corre:\n  gsutil ls -l -r "gs://${BUCKET}/obras/**" > ${LISTADO}`);
  process.exit(2);
}
const objetos = new Map();   // ruta dentro del bucket → {bytes, creado}
for (const linea of fs.readFileSync(LISTADO, 'utf8').split('\n')) {
  const m = linea.match(/^\s*(\d+)\s+(\S+Z)\s+gs:\/\/[^/]+\/(.+)$/);
  if (m) objetos.set(m[3], { bytes: Number(m[1]), creado: m[2] });
}

const n = x => x.toLocaleString('es-MX');
const kb = b => (b / 1024).toFixed(1) + ' KB';
const dia = iso => (iso || '').slice(0, 10);

// La fecha LOCAL de México de un instante UTC. Sin esto la comparación con
// `fecha` —que es la fecha local del teléfono— compara peras con manzanas y
// sale un acuerdo perfecto que no existe.
const fmtMX = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
const diaMX = iso => fmtMX.format(new Date(iso));

// La URL de descarga lleva la ruta percent-encoded entre `/o/` y `?`.
const rutaDeURL = (url) => {
  const m = String(url || '').match(/\/o\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};

(async () => {
  // ── Qué obras hay, y dónde viven ──────────────────────────────────────────
  const raizObras = (await pedir('/obras?pageSize=300'))?.documents || [];
  const orgs = ((await pedir('/orgs?pageSize=100'))?.documents || [])
    .map(d => d.name.split('/').pop());
  const obras = raizObras.map(d => ({ id: d.name.split('/').pop(), prefijo: '' }));
  for (const oid of orgs) {
    const sub = (await pedir(`/orgs/${oid}/obras?pageSize=300`))?.documents || [];
    for (const d of sub) obras.push({ id: d.name.split('/').pop(), prefijo: `orgs/${oid}/` });
  }

  console.log('\n════ LAS OBRAS Y SU CATÁLOGO VIVO ════\n');
  console.log('obra              doc actual   partidas  fotos en el doc   `fotos` pesa');

  const fotos = [];           // una entrada por foto referenciada en Firestore
  let totalDoc = 0;
  for (const o of obras) {
    const doc = await pedir(`/${o.prefijo}obras/${o.id}/avance/subs`);
    if (!doc) { console.log(`${(o.prefijo + o.id).padEnd(17)}  (sin avance/subs)`); continue; }
    const d = campos(doc);
    const subs = Array.isArray(d.data) ? d.data : [];
    const bytesDoc = Buffer.byteLength(JSON.stringify(doc.fields || {}), 'utf8');
    let bytesFotos = 0, cuantas = 0;
    for (const s of subs) {
      bytesFotos += Buffer.byteLength(JSON.stringify(s.fotos || {}), 'utf8');
      for (const f of fotosDeSub(s)) {
        cuantas++;
        fotos.push({
          obra: o.id, prefijo: o.prefijo,
          partidaId: s.id || s.sec || '', sec: s.sec || '', sub: s.sub || '',
          id: f.id || null, url: f.url || (typeof f === 'string' ? f : '') || '',
          fechaDeclarada: f.fecha || null,
        });
      }
    }
    totalDoc += bytesDoc;
    console.log(`${(o.prefijo + o.id).padEnd(17)}  ${kb(bytesDoc).padStart(9)}  ${String(subs.length).padStart(9)}  ` +
      `${String(cuantas).padStart(15)}  ${(100 * bytesFotos / (bytesDoc || 1)).toFixed(0).padStart(9)}%`);
  }
  console.log(`\n${n(fotos.length)} fotos referenciadas en Firestore · ${n(objetos.size)} objetos en Storage`);

  // ── 1. ¿Se emparejan? ─────────────────────────────────────────────────────
  console.log('\n════ 1. ¿CADA FOTO DEL DOCUMENTO TIENE SU ARCHIVO? ════\n');
  const referenciadas = new Set();
  let conObjeto = 0, sinObjeto = 0, sinRuta = 0;
  const faltantes = [];
  for (const f of fotos) {
    const r = rutaDeURL(f.url);
    if (!r) { sinRuta++; continue; }
    f.ruta = r;
    if (objetos.has(r)) { conObjeto++; referenciadas.add(r); f.creado = objetos.get(r).creado; }
    else { sinObjeto++; if (faltantes.length < 5) faltantes.push(`${f.obra} ${f.sec} → ${r}`); }
  }
  console.log(`con archivo en Storage:            ${String(conObjeto).padStart(5)}`);
  console.log(`sin archivo (URL muerta):          ${String(sinObjeto).padStart(5)}`);
  console.log(`sin URL de la que sacar la ruta:   ${String(sinRuta).padStart(5)}`);
  faltantes.forEach(x => console.log(`   falta: ${x}`));

  // Para decir «huérfano» hay que buscar la referencia en TODAS las
  // subcolecciones de la obra, no sólo en `avance/subs`. Las fotos de
  // subcontrato viven en `subcontratos/lista` y las cotizaciones también: si
  // sólo se mira `avance/subs`, cinco objetos perfectamente referenciados
  // salen acusados de huérfanos. Pasó mientras se escribía esto.
  const todasLasURLs = new Set();
  const recolectar = (x) => {
    if (typeof x === 'string') { const r = rutaDeURL(x); if (r) todasLasURLs.add(r); return; }
    if (Array.isArray(x)) return x.forEach(recolectar);
    if (x && typeof x === 'object') return Object.values(x).forEach(recolectar);
  };
  for (const o of obras)
    for (const col of ['avance', 'config', 'subcontratos', 'nomina', 'nomina_historial'])
      for (const d of ((await pedir(`/${o.prefijo}obras/${o.id}/${col}?pageSize=300`))?.documents || []))
        recolectar(d.fields);

  const huerfanos = [...objetos.keys()].filter(r => !todasLasURLs.has(r));
  const bytesHuerfanos = huerfanos.reduce((t, r) => t + objetos.get(r).bytes, 0);
  console.log(`\nURLs referenciadas en TODAS las subcolecciones: ${n(todasLasURLs.size)}`);
  console.log(`objetos en Storage que nadie referencia:        ${String(huerfanos.length).padStart(4)}` +
    `  (${(bytesHuerfanos / 1048576).toFixed(0)} MiB)`);
  console.log('Son el rastro de la `×`: borra del documento y deja el archivo.');
  huerfanos.slice(0, 5).forEach(r => console.log(`   huérfano: ${r.slice(0, 100)}`));

  // ── 2. La fecha declarada contra la del servidor ──────────────────────────
  console.log('\n════ 2. ¿CUÁNTO MIENTE EL RELOJ DEL TELÉFONO? ════\n');
  const comparables = fotos.filter(f => f.creado && f.fechaDeclarada);
  let iguales = 0, igualesIngenuo = 0;
  const desfases = new Map();     // días de diferencia → cuántas
  let peor = null;
  for (const f of comparables) {
    const dD = f.fechaDeclarada, dS = diaMX(f.creado);
    const difDias = Math.round((Date.parse(dS + 'T00:00:00Z') - Date.parse(dD + 'T00:00:00Z')) / 86400000);
    desfases.set(difDias, (desfases.get(difDias) || 0) + 1);
    if (difDias === 0) iguales++;
    if (dia(f.creado) === dD) igualesIngenuo++;    // la comparación que miente
    if (!peor || Math.abs(difDias) > Math.abs(peor.dif)) peor = { dif: difDias, f, srv: dS };
  }
  console.log(`fotos con las dos fechas: ${n(comparables.length)}`);
  console.log(`coinciden al día:         ${n(iguales)}  (${(100 * iguales / (comparables.length || 1)).toFixed(1)}%)`);
  console.log('\ndesfase (fecha local MX del servidor − fecha declarada), en días:');
  [...desfases].sort((a, b) => a[0] - b[0]).forEach(([d, c]) =>
    console.log(`  ${String(d).padStart(5)} d  ${'█'.repeat(Math.min(c, 60))} ${c}`));
  if (peor && peor.dif !== 0)
    console.log(`\npeor caso: ${peor.f.obra} ${peor.f.sec} — declarada ${peor.f.fechaDeclarada}, ` +
      `servidor ${peor.srv} (UTC ${peor.f.creado}) → ${peor.dif} d`);
  console.log(`\nLa comparación fácil, sin convertir de UTC: ${n(igualesIngenuo)} de ` +
    `${n(comparables.length)} «coinciden».`);
  console.log(igualesIngenuo > iguales
    ? `Es ${n(igualesIngenuo - iguales)} fotos más de acuerdo del que hay. Si alguien mide así,\n` +
      'concluye que el reloj del teléfono es confiable y no lo es.'
    : 'Las dos comparaciones dan lo mismo hoy; no quiere decir que siempre lo den.');

  // La pregunta que decide si el desfase importa: ¿cambia de SEMANA? El riel de
  // evidencia agrupa por semana, así que un desfase que no cruza el lunes es
  // invisible y uno que lo cruza mueve la foto de columna.
  const semanaISO = fecha => {
    const d = new Date(fecha + 'T12:00:00Z');
    const j = new Date(d); j.setUTCDate(j.getUTCDate() + 4 - (j.getUTCDay() || 7));
    const w = Math.ceil(((j - new Date(Date.UTC(j.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
    return `${j.getUTCFullYear()}-S${String(w).padStart(2, '0')}`;
  };
  const cambianDeSemana = comparables.filter(f => semanaISO(f.fechaDeclarada) !== semanaISO(diaMX(f.creado)));
  console.log(`\nfotos que cambian de SEMANA al usar la hora del servidor: ${n(cambianDeSemana.length)}` +
    ` de ${n(comparables.length)}`);
  cambianDeSemana.slice(0, 8).forEach(f =>
    console.log(`   ${f.obra} ${f.sec}: ${semanaISO(f.fechaDeclarada)} → ${semanaISO(diaMX(f.creado))}`));
  if (!cambianDeSemana.length)
    console.log('Ninguna. El riel de evidencia por semana NO se mueve con la migración:\n' +
      'los desfases son de cerca de la medianoche y ninguno cruza un lunes.');

  // ── 3. Qué sabe cada foto de sí misma ─────────────────────────────────────
  console.log('\n════ 3. ¿HAY AUTOR EN ALGUNA PARTE? ════\n');
  const llaves = new Map();
  for (const f of fotos) for (const k of Object.keys(f)) llaves.set(k, (llaves.get(k) || 0) + 1);
  const campoAutor = [...llaves.keys()].filter(k => /uid|autor|captur|usuario|supervisor/i.test(k));
  console.log(`campos con pinta de autor en las fotos: ${campoAutor.length ? campoAutor.join(', ') : 'NINGUNO'}`);
  console.log('Storage tampoco lo guarda de forma legible: el objeto tiene');
  console.log('`timeCreated` y tamaño, no el uid de quien lo subió.');
  console.log('\nO sea: las fotos que ya existen no tienen autor y no es recuperable.');
  console.log('Se migran marcadas como legado, no como evidencia verificada.');

  // ── 4. Lo que la migración tendría que escribir ───────────────────────────
  console.log('\n════ 4. LO QUE LA MIGRACIÓN ESCRIBIRÍA ════\n');
  const migrables = fotos.filter(f => f.ruta && f.creado);
  const porObra = new Map();
  migrables.forEach(f => porObra.set(f.prefijo + f.obra, (porObra.get(f.prefijo + f.obra) || 0) + 1));
  console.log(`documentos nuevos en \`evidencia\`: ${n(migrables.length)}`);
  [...porObra].forEach(([o, c]) => console.log(`   ${o.padEnd(17)} ${String(c).padStart(5)}`));
  console.log(`\nno migrables (sin archivo o sin ruta): ${n(fotos.length - migrables.length)}`);
  console.log(`\`fotos\` que desaparece de \`avance/subs\`: libera el peso medido arriba.`);
  process.exit(0);
})().catch(e => { console.error(e.message || e); process.exit(2); });
