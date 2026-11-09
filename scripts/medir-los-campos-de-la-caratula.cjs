#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ TRAE HOY CADA CAMPO DE LA CARÁTULA DEL REPORTE? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El bloque «Datos del contrato» de la portada (`src/App.jsx:348`)
// imprime nueve renglones, y siete de ellos salen de un campo del alta con un
// `|| ''` detrás. Un `|| ''` deja el renglón CON SU ETIQUETA y sin valor: la
// hoja dice «Residente:» y a la derecha no hay nada. Eso no es declarar una
// ausencia, es un renglón a medias que el lector completa solo — y el lector de
// esta hoja es un cliente que la firma.
//
// Y hay un segundo defecto, peor, en las firmas (`src/App.jsx:2097`):
//
//     [obra.residente || obra.superintendente || 'Residente', …]
//
// Cuando no hay residente capturado, el pie imprime al SUPERINTENDENTE bajo el
// rótulo «Residente de Obra · Elaboró». No queda vacío: queda ocupado por otra
// persona. Un documento que atribuye a alguien un cargo que no tiene, en el
// renglón donde firma, no tiene un hueco: tiene un dato falso.
//
// QUÉ SE MIDE, Y POR QUÉ ESO. No «¿puede pasar?» —el código ya dice que puede—
// sino «¿qué le está saliendo hoy a cada obra viva?»:
//
//   1. CADA CAMPO DE LA CARÁTULA, OBRA POR OBRA, con lo que trae crudo. Hace
//      falta el valor crudo y no un «sí/no» porque un campo puede estar
//      ocupado y no servir: ver el punto 3.
//   2. CUÁNTAS VECES EL PIE SUSTITUYE AL RESIDENTE POR EL SUPERINTENDENTE.
//      Es el defecto que imprime un dato falso, así que se cuenta aparte.
//   3. CAMPOS OCUPADOS QUE NO DICEN LO QUE SU ETIQUETA PROMETE. Dos clases
//      medidas a mano antes de escribir esto:
//        · `contrato` con una DESCRIPCIÓN en vez de un número de contrato.
//          Se detecta por lo que un número de contrato tiene y una
//          descripción no: dígitos y separadores. No se afirma cuál es el
//          formato bueno —no hay uno declarado— sólo si el valor PODRÍA ser
//          un identificador o es prosa.
//        · El relleno explícito: `N/A`, `n/a`, `NA`, `-`, `—`, `.`, `x`.
//          Un `N/A` tecleado por alguien es una ausencia DICHA, pero la
//          carátula la imprime como si fuera el nombre de la persona.
//
// La diferencia entre 1 y 3 es la que hace falta para decidir: un campo vacío
// se declara ausente y se acabó; un campo ocupado con prosa o con «N/A» exige
// decidir si se declara ausente también, y eso no se puede decidir sin saber
// cuántos son.
//
// SÓLO LEE, Y NO POR DISCIPLINA SINO POR CONSTRUCCIÓN. La única función de red
// de este archivo es `leer()`, y hace GET. No hay PATCH, ni POST, ni DELETE, ni
// `firebase-admin` —que es el que trae `.set()` detrás—. Una bandera se puede
// teclear mal; un verbo que no está escrito no se puede mandar.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-los-campos-de-la-caratula.cjs --prod
//
// Contra el emulador, para ensayarlo sin tocar nada de afuera:
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-los-campos-de-la-caratula.cjs

'use strict';

require('./reloj.cjs');
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-los-campos-de-la-caratula.cjs --prod\n');
  process.exit(2);
}

// LA ÚNICA PUERTA A LA RED. GET y nada más.
async function leer(ruta) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'GET',
    headers: DESTINO.prod
      ? { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO }
      : { Authorization: 'Bearer owner' },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    console.error(`\nNO ARRANCÓ: HTTP ${r.status} en ${ruta}`);
    console.error((await r.text()).slice(0, 300));
    process.exit(2);
  }
  return r.json();
}

const txt = (f, k) => f?.[k]?.stringValue ?? null;

async function todaLaColeccion(ruta) {
  const docs = [];
  let token = null;
  do {
    const sep = ruta.includes('?') ? '&' : '?';
    const j = await leer(`${ruta}${sep}pageSize=300${token ? `&pageToken=${token}` : ''}`);
    if (!j) break;
    docs.push(...(j.documents || []));
    token = j.nextPageToken || null;
  } while (token);
  return docs;
}

// El relleno que alguien teclea cuando el formulario le exige algo. Es una
// ausencia DICHA, y la carátula la imprime como si fuera el dato.
const RELLENO = new Set(['n/a', 'na', 'n.a.', '-', '--', '—', '.', '..', 'x',
  'xx', 'sin dato', 'sin datos', 'pendiente', 'por definir', 'nd', 'n/d', '0']);
const esRelleno = (s) => s != null && RELLENO.has(String(s).trim().toLowerCase());

// ¿Esto PODRÍA ser un identificador de contrato? No se afirma cuál es el
// formato bueno —no hay uno declarado en el modelo—; se mide lo que un número
// de contrato tiene y una descripción no: dígitos. Una descripción de obra
// («Construcción del colector…») no los lleva, o lleva sólo un año perdido en
// la prosa, así que la prueba es por densidad y no por presencia.
const pareceIdentificador = (s) => {
  if (s == null) return false;
  const v = String(s).trim();
  if (!v) return false;
  const digitos = (v.match(/\d/g) || []).length;
  const palabras = v.split(/\s+/).length;
  // Un identificador es corto y con dígitos; una descripción es larga y casi
  // sin ellos. Las dos condiciones a la vez, porque «2026» solo no es un
  // contrato y «CONTRATO DE OBRA PÚBLICA SOBRE PRECIOS UNITARIOS» tampoco.
  return digitos >= 3 && palabras <= 6;
};

const corta = (s, n) => {
  if (s == null) return '(no capturado)';
  const v = String(s);
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

// Los siete campos de la carátula que salen de un `|| ''`. El orden es el de
// la hoja, para poder leer el reporte al lado del PDF.
const CAMPOS = ['contrato', 'cliente', 'superintendente', 'residente', 'admin',
  'inicio', 'fin'];

(async () => {
  console.log(`Destino: ${DESTINO.prod ? 'PRODUCCIÓN (lectura)' : `emulador ${DESTINO.emulador}`}\n`);

  // El alta de una obra vive repartida: `obras/{id}` y `obras/{id}/config/info`
  // guardan los mismos campos, y la app lee el segundo encima del primero. Hay
  // que mirar los dos o se mide el documento que la carátula no usa.
  const obrasDocs = await todaLaColeccion('obras');
  const obras = [];
  for (const d of obrasDocs) {
    const id = d.name.split('/').pop();
    const raiz = d.fields || {};
    const infoDoc = await leer(`obras/${id}/config/info`);
    const info = infoDoc?.fields || {};
    const campo = (k) => txt(info, k) ?? txt(raiz, k);
    obras.push({
      id,
      nombre: campo('nombre') || '(sin nombre)',
      estado: campo('estado') || 'activa',
      ubicacion: campo('ubicacion'),
      valores: Object.fromEntries(CAMPOS.map(k => [k, campo(k)])),
    });
  }
  obras.sort((a, b) => a.id.localeCompare(b.id));

  const vivas = obras.filter(o => o.estado !== 'archivada' && o.estado !== 'cancelada');
  console.log(`${obras.length} obra(s) en la colección, ${vivas.length} viva(s).\n`);

  // ── 1. CADA CAMPO, OBRA POR OBRA ──────────────────────────────────────────
  console.log('── 1. LO QUE LA CARÁTULA IMPRIME HOY ─────────────────────────────────');
  const vacios = Object.fromEntries(CAMPOS.map(k => [k, []]));
  const rellenos = Object.fromEntries(CAMPOS.map(k => [k, []]));

  for (const o of vivas) {
    console.log(`\n${o.id}  ${corta(o.nombre, 54)}`);
    console.log(`      ubicacion        ${corta(o.ubicacion, 56)}`);
    for (const k of CAMPOS) {
      const v = o.valores[k];
      let marca = '';
      if (v == null || String(v).trim() === '') { vacios[k].push(o.id); marca = '  ← VACÍO'; }
      else if (esRelleno(v)) { rellenos[k].push(o.id); marca = '  ← RELLENO'; }
      console.log(`      ${k.padEnd(16)} ${corta(v, 56).padEnd(57)}${marca}`);
    }
  }

  // ── 2. EL CONTRATO: ¿NÚMERO O DESCRIPCIÓN? ────────────────────────────────
  console.log('\n\n── 2. `contrato`: ¿TRAE UN NÚMERO O UNA DESCRIPCIÓN? ─────────────────');
  const contratoProsa = [];
  for (const o of vivas) {
    const v = o.valores.contrato;
    const hay = v != null && String(v).trim() !== '';
    const relleno = esRelleno(v);
    const id = hay && !relleno && pareceIdentificador(v);
    if (hay && !relleno && !id) contratoProsa.push(o.id);
    const veredicto = !hay ? 'VACÍO' : relleno ? 'RELLENO' : id ? 'podría ser un número' : 'DESCRIPCIÓN, no número';
    console.log(`  ${o.id}  ${veredicto.padEnd(24)} ${corta(v, 48)}`);
  }
  console.log(`\n  ${contratoProsa.length} de ${vivas.length} traen una descripción donde la etiqueta promete un contrato.`);
  if (contratoProsa.length) console.log(`  → ${contratoProsa.join(', ')}`);

  // ── 3. EL PIE: ¿A QUIÉN IMPRIME BAJO «RESIDENTE DE OBRA · ELABORÓ»? ───────
  // Se reproduce la cuenta de `src/App.jsx:2097` TAL CUAL. No se reescribe
  // «mejor»: el punto es decir a quién le está saliendo el nombre hoy.
  console.log('\n\n── 3. EL PIE DE FIRMAS: A QUIÉN ATRIBUYE EL CARGO ────────────────────');
  const suplantados = [];
  for (const o of vivas) {
    const { residente, superintendente, admin } = o.valores;
    const comoLoImprimeHoy = residente || superintendente || 'Residente';
    const sustituye = (residente == null || String(residente).trim() === '')
      && superintendente != null && String(superintendente).trim() !== '';
    if (sustituye) suplantados.push(o.id);
    console.log(`  ${o.id}  «Residente de Obra · Elaboró» → ${corta(comoLoImprimeHoy, 40).padEnd(41)}${sustituye ? '← es el SUPERINTENDENTE' : ''}`);
    // Un `N/A` capturado no dispara la sustitución —es una cadena con
    // contenido— así que sale impreso tal cual bajo el rótulo del cargo.
    if (esRelleno(residente)) console.log(`        y «${String(residente).trim()}» sale impreso como si fuera el nombre.`);
    void admin;
  }

  // ── VEREDICTO ─────────────────────────────────────────────────────────────
  console.log('\n\n── LO QUE HAY QUE DECIDIR ────────────────────────────────────────────');
  for (const k of CAMPOS) {
    const v = vacios[k].length, r = rellenos[k].length;
    if (!v && !r) continue;
    const partes = [];
    if (v) partes.push(`${v} vacío(s): ${vacios[k].join(', ')}`);
    if (r) partes.push(`${r} con relleno: ${rellenos[k].join(', ')}`);
    console.log(`  ${k.padEnd(16)} ${partes.join(' · ')}`);
  }
  console.log(`\n  El pie sustituye al residente por el superintendente en ${suplantados.length} obra(s)` +
    `${suplantados.length ? `: ${suplantados.join(', ')}` : ''}.`);
  console.log('  Eso NO es un hueco: es un cargo atribuido a quien no lo tiene, en el renglón que se firma.\n');
})().catch(e => { console.error(`\nNO ARRANCÓ: ${e.message}`); process.exit(2); });
