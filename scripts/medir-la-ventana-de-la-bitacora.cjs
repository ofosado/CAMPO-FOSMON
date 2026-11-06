#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿A QUÉ LE DICE «NINGÚN REGISTRO» LA BITÁCORA? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. La pantalla de Bitácora (`src/App.jsx:24322`) lee los últimos N por
// `ts` descendente —N es 200 por omisión— y DESPUÉS filtra en memoria por obra,
// usuario, tipo, módulo y rango de fechas (`src/App.jsx:24333`). Cuando el
// filtro no encuentra nada, la pantalla dice:
//
//     «Ningún registro coincide con los filtros.»
//
// Eso se lee como «no hubo esa actividad». Lo que de verdad pasó es «no hubo
// esa actividad DENTRO DE LA VENTANA QUE LEÍ», y la ventana no se nombra en
// ninguna parte. Quien usa esta pantalla es un contralor o un auditor, o sea
// justo la persona cuyo trabajo es averiguar si algo pasó.
//
// QUÉ SE MIDE, Y POR QUÉ ESO Y NO OTRA COSA. Tres números deciden si esto es un
// defecto de verdad o una teoría:
//
//   1. CUÁNTAS FILAS HAY. Si son menos de 200, la ventana nunca recorta y el
//      defecto es sólo futuro.
//   2. QUÉ PERIODO CUBRE LA VENTANA. Si los últimos 200 son los últimos dos
//      años, el filtro de fechas casi nunca miente. Si son tres días, miente
//      casi siempre.
//   3. CUÁNTAS OBRAS QUEDAN INVISIBLES. Una obra con actividad real cuyo
//      registro más reciente cae fuera de la ventana es una obra sobre la que
//      la pantalla AFIRMA que no hubo nada. Ésas son las que importan: no es
//      que falte información, es que se publica una conclusión falsa.
//
// Se mide para las cuatro ventanas que ofrece el desplegable (100, 200, 500,
// 1000), porque el usuario puede subirla y hay que saber si subirla alcanza.
//
// SÓLO LEE, Y NO POR DISCIPLINA SINO POR CONSTRUCCIÓN. La única función de red
// de este archivo es `leer()`, y hace GET. No hay PATCH, ni POST, ni DELETE, ni
// `firebase-admin` —que es el que trae `.set()` detrás—. Una bandera se puede
// teclear mal; un verbo que no está escrito no se puede mandar.
//
// Por eso también se pagina con `GET …?pageSize=` y se ORDENA AQUÍ en vez de
// pedirle a Firestore un `orderBy`: el `orderBy` de REST vive en `:runQuery`,
// que es un POST. Leer con un POST seguiría siendo leer, pero dejaría de ser
// imposible escribir, y la garantía de este archivo es la imposibilidad.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-la-ventana-de-la-bitacora.cjs --prod
//
// Contra el emulador, para ensayarlo sin tocar nada de afuera:
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-la-ventana-de-la-bitacora.cjs

'use strict';

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
  console.error('    node scripts/medir-la-ventana-de-la-bitacora.cjs --prod\n');
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

// Todas las páginas de una colección. Sin `orderBy`: ver el preámbulo.
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

const VENTANAS = [100, 200, 500, 1000];

(async () => {
  const obrasDocs = await todaLaColeccion('obras');
  const nombreDe = new Map(obrasDocs.map(d => [
    d.name.split('/').pop(),
    txt(d.fields || {}, 'nombre') || '—',
  ]));
  const estadoDe = new Map(obrasDocs.map(d => [
    d.name.split('/').pop(),
    txt(d.fields || {}, 'estado') || 'activa',
  ]));

  const docs = await todaLaColeccion('auditoria');
  if (!docs.length) {
    console.log('La bitácora está vacía. No hay ventana que medir.\n');
    process.exit(0);
  }

  // `ts` es una CADENA ISO en este modelo —así la comparan los filtros de
  // fecha de la pantalla, con `<` sobre texto— así que ordenar por texto es
  // ordenar igual que la pantalla, no parecido.
  const filas = docs.map(d => {
    const f = d.fields || {};
    return {
      ts: txt(f, 'ts') || '',
      obraId: txt(f, 'obraId') || null,
      modulo: txt(f, 'modulo') || null,
      tipo: txt(f, 'tipo') || null,
      usuario: txt(f, 'usuario') || null,
    };
  }).sort((a, b) => b.ts.localeCompare(a.ts));

  const dia = (t) => (t || '').slice(0, 10) || '—';

  console.log(`Filas en la bitácora: ${filas.length}`);
  console.log(`La más reciente: ${dia(filas[0].ts)} · la más vieja: ${dia(filas[filas.length - 1].ts)}\n`);

  // ── 1 · QUÉ PERIODO CUBRE CADA VENTANA ────────────────────────────────────
  console.log('ventana  filas leídas  cubre desde  o sea');
  console.log('─'.repeat(78));
  for (const n of VENTANAS) {
    const corte = filas.slice(0, n);
    const desde = corte[corte.length - 1].ts;
    const dias = Math.max(1, Math.round(
      (Date.parse(filas[0].ts) - Date.parse(desde)) / 86400000));
    const recorta = filas.length > n;
    console.log(`${String(n).padEnd(8)} ${String(corte.length).padEnd(13)} ${dia(desde).padEnd(12)} ` +
      (recorta ? `los últimos ${dias} día(s) — y hay ${filas.length - n} filas más viejas que no se leen`
               : 'toda la bitácora cabe'));
  }

  // ── 2 · CUÁNTAS OBRAS QUEDAN INVISIBLES EN CADA VENTANA ───────────────────
  // Una obra «invisible» es una que SÍ tiene registros y cuyo más reciente cae
  // fuera de la ventana: la pantalla, filtrada por ella, afirma que no hubo
  // nada. Es el caso que importa, porque no es falta de dato sino conclusión
  // falsa.
  const ultimoPorObra = new Map();
  const conteoPorObra = new Map();
  for (const f of filas) {
    if (!f.obraId) continue;
    conteoPorObra.set(f.obraId, (conteoPorObra.get(f.obraId) || 0) + 1);
    if (!ultimoPorObra.has(f.obraId)) ultimoPorObra.set(f.obraId, f.ts);
  }
  // El rango de cada obra en el orden que usa la pantalla.
  const rangoPorObra = new Map();
  for (const [id, ts] of ultimoPorObra) {
    rangoPorObra.set(id, filas.findIndex(f => f.ts === ts && f.obraId === id) + 1);
  }

  console.log('');
  console.log(`Obras con registros en la bitácora: ${ultimoPorObra.size} ` +
    `(de ${obrasDocs.length} obras que existen)`);
  const sinNada = [...nombreDe.keys()].filter(id => !ultimoPorObra.has(id));
  if (sinNada.length) console.log(
    `Obras sin NINGÚN registro —ahí «no hubo actividad» es verdad—: ${sinNada.join(', ')}`);

  console.log('');
  console.log('ventana  obras invisibles  cuáles');
  console.log('─'.repeat(78));
  for (const n of VENTANAS) {
    const invisibles = [...rangoPorObra.entries()]
      .filter(([, r]) => r > n)
      .map(([id]) => id)
      .sort();
    console.log(`${String(n).padEnd(8)} ${String(invisibles.length).padEnd(17)} ` +
      (invisibles.length ? invisibles.join(', ') : '—'));
  }

  // ── 3 · EL DETALLE POR OBRA ───────────────────────────────────────────────
  console.log('');
  console.log('obra   nombre                                   filas  último      rango');
  console.log('─'.repeat(92));
  const porRango = [...rangoPorObra.entries()].sort((a, b) => a[1] - b[1]);
  const anchoId = Math.max(6, ...porRango.map(([id]) => id.length));
  for (const [id, rango] of porRango) {
    const n = conteoPorObra.get(id);
    const est = estadoDe.get(id) || '(no existe la obra)';
    const marca = rango > 200 ? '  ← fuera de la ventana por omisión' : '';
    console.log(`${id.padEnd(anchoId)} ${(nombreDe.get(id) || '(obra borrada)').slice(0, 40).padEnd(40)} ` +
      `${String(n).padStart(5)}  ${dia(ultimoPorObra.get(id)).padEnd(11)} ${String(rango).padStart(5)}` +
      `${marca}${est === 'archivada' ? ' (archivada)' : ''}`);
  }

  // ── 4 · EL VEREDICTO ──────────────────────────────────────────────────────
  const invisibles200 = [...rangoPorObra.values()].filter(r => r > 200).length;
  const invisibles1000 = [...rangoPorObra.values()].filter(r => r > 1000).length;
  const corte200 = filas.slice(0, 200);
  const diasVentana = Math.max(1, Math.round(
    (Date.parse(filas[0].ts) - Date.parse(corte200[corte200.length - 1].ts)) / 86400000));

  console.log('');
  console.log('─'.repeat(92));
  if (filas.length <= 200) {
    console.log('La bitácora entera cabe en la ventana por omisión. El defecto todavía');
    console.log('no muerde: hoy «ningún registro» es verdad. Muerde cuando crezca.');
  } else {
    console.log(`La ventana por omisión cubre ${diasVentana} día(s) de ${filas.length} filas.`);
    if (invisibles200 === 0) {
      console.log('Ninguna obra queda invisible HOY porque todas tienen actividad reciente,');
      console.log('pero el filtro de FECHAS sí miente: preguntar por un mes anterior a');
      console.log(`${dia(corte200[corte200.length - 1].ts)} contesta «ningún registro» sin haber mirado.`);
    } else {
      console.log(`${invisibles200} obra(s) quedan INVISIBLES con la ventana por omisión: la pantalla,`);
      console.log('filtrada por ellas, afirma que no hubo actividad y sí la hubo.');
      console.log(invisibles1000
        ? `Subir la ventana a 1000 no alcanza: quedan ${invisibles1000} invisibles.`
        : 'Subir la ventana a 1000 las alcanza a todas — hoy.');
    }
    console.log('');
    console.log('En los dos casos el defecto es el mismo y no es el tamaño de la ventana:');
    console.log('es que la pantalla no dice cuál es. «Ningún registro coincide» tiene que');
    console.log('decir sobre qué miró, o filtrar donde están los datos y no en memoria.');
  }
  console.log('');
})();
