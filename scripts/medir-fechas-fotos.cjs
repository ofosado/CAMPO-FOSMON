#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿LAS FOTOS SE ACUMULARON SEMANA A SEMANA, O FUERON UN VOLCADO? (#30)
// ════════════════════════════════════════════════════════════════════════════
//
// Solo LEE. No escribe nada en ninguna parte.
//
// Por qué existe: al medir las fotos para el #30 se vio que las 255 de la
// obra 0112 comparten la misma `fecha`, y de ahí se concluyó que se subieron
// de golpe. Esa conclusión se apoyaba en UN campo escrito por el cliente, y
// si ese campo fuera un artefacto —reescrito al guardar, o puesto por una
// carga inicial— la conclusión sería falsa y el diseño de la evidencia por
// semana se decidiría sobre arena.
//
// Así que se pregunta a dos fuentes que no dependen de ese campo:
//
//   a) Firebase Storage guarda `timeCreated` por objeto, del lado del
//      servidor. Es la hora real de subida y el cliente no puede falsearla.
//   b) La bitácora `auditoria`, que registra cada captura de avance con su
//      `ts`, también de servidor.
//
// Si las dos dicen lo mismo que `fecha`, el campo es fiel y la migración del
// #30 puede reconstruir a qué semana pertenece cada foto. Si discrepan, gana
// Storage: es la única de las tres que no pasó por el reloj de un teléfono.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-fechas-fotos.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const OBRAS = ['0112', '0114', '0126'];   // las tres que tienen fotos
const P = 'campo-fosmon';
const BUCKET = 'campo-fosmon.firebasestorage.app';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(1); }

// Un fallo de lectura para el guion. Seguir con `null` convierte un token
// vencido en "0 fotos, ninguna fecha", que es creíble y falso. Ya pasó una
// vez escribiendo `medir-fotos.cjs`; no se repite.
const pedir = (host, ruta, cuerpo) => new Promise((res, rej) => {
  const opts = {
    host, path: ruta,
    method: cuerpo ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P,
               ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
  };
  const r = https.request(opts, resp => {
    let b = ''; resp.on('data', d => b += d);
    resp.on('end', () => {
      if (resp.statusCode === 200) return res(JSON.parse(b));
      rej(new Error(`${host} contestó ${resp.statusCode} en ${ruta.slice(0, 90)}` +
        (resp.statusCode === 401 || resp.statusCode === 403
          ? '\nSuele ser el token vencido: `gcloud auth application-default print-access-token > /tmp/adc.tok`'
          : `\n${b.slice(0, 400)}`)));
    });
  });
  r.on('error', rej);
  if (cuerpo) r.write(JSON.stringify(cuerpo));
  r.end();
});

// ── Semana ISO, para poder hablar de "semanas" y no de días sueltos ─────────
const semanaISO = (iso) => {
  const d = new Date(iso);
  const j = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  j.setUTCDate(j.getUTCDate() + 4 - (j.getUTCDay() || 7));
  const ene1 = new Date(Date.UTC(j.getUTCFullYear(), 0, 1));
  return `${j.getUTCFullYear()}-S${String(Math.ceil((((j - ene1) / 86400000) + 1) / 7)).padStart(2, '0')}`;
};
const dia = (iso) => iso.slice(0, 10);

// ── a) Storage: la hora de subida que escribió el servidor ──────────────────
const listarStorage = async (obra) => {
  const objetos = [];
  let token = null;
  do {
    const q = new URLSearchParams({
      prefix: `obras/${obra}/fotos/`,
      fields: 'items(name,timeCreated,size),nextPageToken',
      maxResults: '1000',
    });
    if (token) q.set('pageToken', token);
    const r = await pedir('storage.googleapis.com',
      `/storage/v1/b/${encodeURIComponent(BUCKET)}/o?${q}`);
    for (const it of r.items || []) objetos.push(it);
    token = r.nextPageToken || null;
  } while (token);
  return objetos;
};

// ── b) La bitácora ──────────────────────────────────────────────────────────
// Filtro de un solo campo: no necesita el índice compuesto que falta (#29).
const bitacora = async (obra) => {
  const r = await pedir('firestore.googleapis.com', `${BASE}:runQuery`, {
    structuredQuery: {
      from: [{ collectionId: 'auditoria' }],
      where: { fieldFilter: { field: { fieldPath: 'obraId' }, op: 'EQUAL',
                              value: { stringValue: obra } } },
      limit: 3000,
    },
  });
  return (r || []).filter(x => x.document).map(x => ({
    ts: x.document.fields?.ts?.stringValue || '',
    modulo: x.document.fields?.modulo?.stringValue || '',
    tipo: x.document.fields?.tipo?.stringValue || '',
    usuario: x.document.fields?.usuario?.stringValue || '',
  })).filter(e => e.ts);
};

// ── El campo `fecha` que vive dentro del documento, para contrastarlo ───────
// El valor REST de Firestore viene etiquetado (`{stringValue: …}`); se
// convierte a JS plano antes de mirarlo. El catálogo vive en el campo `data`,
// no en uno llamado `subs`.
const valor = (v) => {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue) return (v.arrayValue.values || []).map(valor);
  if (v.mapValue) return Object.fromEntries(
    Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, valor(x)]));
  return undefined;
};

const fechasEnDocumento = async (obra) => {
  const d = await pedir('firestore.googleapis.com', `${BASE}/obras/${obra}/avance/subs`);
  const subs = valor({ mapValue: { fields: d.fields || {} } }).data || [];
  const fechas = [];
  for (const s of subs) {
    if (!s?.fotos) continue;
    const lista = Array.isArray(s.fotos) ? s.fotos : Object.values(s.fotos).flat();
    for (const f of lista) if (f && typeof f === 'object') fechas.push(f);
  }
  return fechas;
};

const tabla = (conteo) => Object.entries(conteo).sort(([a], [b]) => a < b ? -1 : 1);

(async () => {
  console.log('Fuente de verdad: `timeCreated` de Storage (lo pone el servidor).');
  console.log('Se contrasta con la bitácora y con el campo `fecha` del documento.\n');

  for (const obra of OBRAS) {
    console.log('═'.repeat(74));
    console.log(`OBRA ${obra}`);
    console.log('═'.repeat(74));

    // a) Storage
    const todosLosObjetos = await listarStorage(obra);
    // Bajo `obras/{id}/fotos/` cuelgan CUATRO cosas: las fotos de avance
    // (`avance_…`), los documentos de subcontrato (`subdoc_…`), las fotos de
    // concepto de subcontrato (`sub_…`) y los documentos de la obra
    // (`documentos`). Compararlas todas contra el catálogo de avance daría
    // huérfanas que no lo son.
    const categoria = (n) => {
      const c = n.split('/')[3] || '';
      if (c.startsWith('avance_')) return 'avance';
      if (c.startsWith('subdoc_')) return 'subdoc';
      if (c.startsWith('sub_')) return 'sub';
      return c || '(raíz)';
    };
    const porCategoria = {};
    for (const o of todosLosObjetos)
      (porCategoria[categoria(o.name)] ||= []).push(o);
    const objetos = porCategoria['avance'] || [];
    console.log(`\n   objetos bajo obras/${obra}/fotos/ por tipo: ` +
      tabla(Object.fromEntries(Object.entries(porCategoria).map(([k, v]) => [k, v.length])))
        .map(([k, n]) => `${k}:${n}`).join('  '));

    const porSemana = {}, porDia = {};
    for (const o of objetos) {
      porSemana[semanaISO(o.timeCreated)] = (porSemana[semanaISO(o.timeCreated)] || 0) + 1;
      porDia[dia(o.timeCreated)] = (porDia[dia(o.timeCreated)] || 0) + 1;
    }
    const semanas = tabla(porSemana), dias = tabla(porDia);
    console.log(`\na) Storage — ${objetos.length} foto(s) de AVANCE (las que mide el #30)`);
    if (objetos.length === 0) {
      console.log('   Ninguno. Las fotos del documento apuntan a otro sitio, o no existen.');
    } else {
      console.log(`   repartidos en ${semanas.length} semana(s) y ${dias.length} día(s) distintos`);
      for (const [s, n] of semanas) console.log(`     ${s}  ${String(n).padStart(4)}  ${'█'.repeat(Math.min(50, Math.ceil(n / 2)))}`);
      console.log(`   días:  ${dias.map(([d, n]) => `${d}:${n}`).join('  ')}`);
      const veredicto = dias.length === 1
        ? 'VOLCADO: todo cabe en un solo día.'
        : semanas.length === 1
          ? 'VOLCADO REPARTIDO: varios días, pero una sola semana.'
          : `ACUMULACIÓN: ${semanas.length} semanas distintas.`;
      console.log(`   → ${veredicto}`);
    }

    // c) El campo `fecha` del documento, contra lo anterior
    const enDoc = await fechasEnDocumento(obra);
    const porFecha = {};
    for (const f of enDoc) if (f.fecha) porFecha[f.fecha] = (porFecha[f.fecha] || 0) + 1;
    console.log(`\nc) Campo \`fecha\` del documento — ${enDoc.length} foto(s), ` +
      `${Object.keys(porFecha).length} fecha(s) distinta(s)`);
    console.log(`   ${tabla(porFecha).map(([f, n]) => `${f}:${n}`).join('  ')}`);
    const diasStorage = new Set(dias.map(([d]) => d));
    const diasDoc = new Set(Object.keys(porFecha));
    const coinciden = [...diasDoc].filter(d => diasStorage.has(d));
    console.log(`   coinciden con días de Storage: ${coinciden.length} de ${diasDoc.size}` +
      (diasDoc.size && coinciden.length === diasDoc.size ? '  → el campo es fiel' :
       diasStorage.size === 0 ? '  → no hay con qué comparar' : '  → DISCREPAN'));

    // Objetos en Storage que el catálogo no menciona. No es un detalle
    // contable: cada uno es una subida que llegó y una escritura que no, que
    // es la firma del #22. El cliente pagó los bytes y no ve la foto.
    const idsDoc = new Set(enDoc.map(f => String(f.id)).filter(Boolean));
    const huerfanas = objetos.filter(o => !idsDoc.has(o.name.split('/').pop()));
    const porSemHuerfana = {};
    for (const o of huerfanas)
      porSemHuerfana[semanaISO(o.timeCreated)] = (porSemHuerfana[semanaISO(o.timeCreated)] || 0) + 1;
    console.log(`   en Storage y NO en el catálogo: ${huerfanas.length} foto(s)` +
      (huerfanas.length ? `  (${tabla(porSemHuerfana).map(([s, n]) => `${s}:${n}`).join('  ')})` : ''));

    // b) Bitácora
    const eventos = await bitacora(obra);
    const porModulo = {};
    for (const e of eventos) {
      const k = `${e.modulo}/${e.tipo}`;
      porModulo[k] = (porModulo[k] || 0) + 1;
    }
    console.log(`\nb) Bitácora — ${eventos.length} registro(s) con obraId=${obra}`);
    for (const [k, n] of tabla(porModulo)) console.log(`     ${k.padEnd(34)} ${String(n).padStart(4)}`);
    const capturas = eventos.filter(e => /avance|captura/i.test(`${e.modulo} ${e.tipo}`));
    if (capturas.length) {
      const sem = {};
      for (const c of capturas) sem[semanaISO(c.ts)] = (sem[semanaISO(c.ts)] || 0) + 1;
      const ord = tabla(sem);
      console.log(`   capturas de avance: ${capturas.length} en ${ord.length} semana(s)`);
      console.log(`     ${ord.map(([s, n]) => `${s}:${n}`).join('  ')}`);
      const primera = capturas.map(c => c.ts).sort()[0];
      const ultima = capturas.map(c => c.ts).sort().slice(-1)[0];
      console.log(`   de ${dia(primera)} a ${dia(ultima)}`);
    } else {
      console.log('   ninguna captura de avance registrada.');
    }
    console.log('');
  }

  console.log('═'.repeat(74));
  console.log('La bitácora tiene un techo: `auditoria` guarda desde que se activó,');
  console.log('y su retención no está documentada. Storage no lo tiene: el objeto');
  console.log('lleva su `timeCreated` mientras exista. Ante duda, manda Storage.');
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
