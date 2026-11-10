#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ TRAEN DE VERDAD LAS DOS CURVAS? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El mandato pide la sección 3 —«la gráfica única de cuatro series»—
// y la 7 —«la versión de gobierno de la gráfica»—. Antes de dibujar hay que
// saber qué se va a dibujar, y sobre todo QUÉ NO SE VA A PODER DIBUJAR: una
// gráfica con dos de cuatro líneas se lee como una gráfica completa si no
// declara las otras dos. En pantalla esa declaración ya existe (`ausentes`);
// en el papel hay que reservarle el sitio, y para eso hay que saber cuántas
// son y de qué largo son sus motivos.
//
// LAS CINCO PREGUNTAS:
//
//   1. ¿CUÁNTAS DE LAS CUATRO LÍNEAS SE DIBUJAN, obra por obra? Si en
//      producción lo normal fueran dos, la sección 3 es sobre todo una lista
//      de ausencias y el dibujo es lo de menos.
//
//   2. ¿CUÁNTOS TRAMOS SALEN POR LÍNEA? `tramosDeSerie` parte cada serie en
//      rachas: sólido donde hay semanas seguidas medidas, punteado donde el
//      trecho salta un hueco, tenue donde el tramo es del esquema viejo. Si
//      las series reales vinieran enteras, el punteado sería código sin caso y
//      no habría cómo comprobarlo con datos de verdad.
//
//   3. ¿QUÉ RANGO TIENE EL EJE? Para saber si el eje puede arrancar en cero
//      sin aplastar la curva, y si las áreas cruzan el cero.
//
//   4. ¿LA CURVA DE GOBIERNO FILTRA ALGO? Pregunta estructural, no de estilo:
//      se recorre TODO lo que devuelve buscando las claves de la economía del
//      contratista. Es la frontera que no se negocia.
//
//   5. ¿CUÁNTO MIDEN LOS MOTIVOS? El más largo decide cuántos renglones hay
//      que reservar debajo del dibujo.
//
// LAS CUENTAS SE EXTRAEN DE LA APP. `curvaUnicaDeObra`, `curvaDeGobierno` y
// `tramosDeSerie` salen de `src/App.jsx`. Una copia aquí mediría mi idea de
// las curvas, no las curvas.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-que-traen-las-dos-curvas.cjs --prod

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { deApp } = require('./extraer-de-app.cjs');
const { curvaUnicaDeObra, curvaDeGobierno, semanasDeVentana, tramosDeSerie } =
  deApp('curvaUnicaDeObra', 'curvaDeGobierno', 'semanasDeVentana', 'tramosDeSerie');

// La misma ventana que usa el documento interno (`VENTANA = 12`). Si aquí se
// midiera con otra, la medición describiría una gráfica que el papel no dibuja.
const RANGO = 12;

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-que-traen-las-dos-curvas.cjs --prod\n');
  process.exit(2);
}

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
    if (r.status === 401 || r.status === 403) console.error(
      '\nSuele ser el token vencido:\n' +
      '  TOKEN=$(gcloud auth application-default print-access-token)');
    process.exit(2);
  }
  return r.json();
}

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

async function coleccion(ruta) {
  const out = [];
  let token = null;
  do {
    const q = `pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const r = await leer(`${ruta}?${q}`);
    if (!r) break;
    for (const d of (r.documents || [])) out.push({ id: d.name.split('/').pop(), ...campos(d) });
    token = r.nextPageToken || null;
  } while (token);
  return out;
}

async function subsDeObra(obraId) {
  const d = campos(await leer(`obras/${obraId}/avance/subs`));
  const dExtra = campos(await leer(`obras/${obraId}/avance/extraordinarias`));
  const extras = (Array.isArray(dExtra.data) ? dExtra.data : [])
    .map((s, i) => ({ ...s, extra: true, id: s.id || `EXTRA__${i}` }));
  const bases = Array.isArray(d.data) ? d.data : [];
  const necesitaMigrar = bases.some(s => !s.id);
  const conId = necesitaMigrar
    ? bases.map((s, idx) => ({ ...s, id: s.id || `${s.sec || 'C'}__${idx}` }))
    : bases;
  return [...conId, ...extras];
}

const M = n => n === null || n === undefined || !Number.isFinite(n)
  ? '—' : (n < 0 ? '−$' : '$') + (Math.abs(n) / 1e6).toFixed(1) + 'M';

// Los tramos de una línea, contados como los cuenta la pantalla. `pts` es lo
// que `tramosDeSerie` espera: una entrada por semana, falsa donde no hay dato.
// Las coordenadas dan igual para contar —lo que decide el corte es dónde hay
// punto y dónde no—, así que se usa el índice como X y el valor como Y.
const tramosDe = (linea) => {
  const pts = (linea.valores || []).map((v, i) =>
    (typeof v === 'number' && Number.isFinite(v)) ? [i, v] : null);
  const iF = typeof linea.idxFrontera === 'number' ? linea.idxFrontera : -1;
  return tramosDeSerie({ pts, medido: linea.medido, idxFrontera: iF });
};

(async () => {
  const gp = campos(await leer('global/gp_construct'));
  const gpData = gp?.data && typeof gp.data === 'object' ? gp.data : gp;

  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];
  if (!docs.length) { console.log('No hay obras que leer.\n'); process.exit(0); }

  console.log('');
  console.log(`VENTANA DE ${RANGO} SEMANAS · ${DESTINO.prod ? 'PRODUCCIÓN' : 'emulador'}` +
              `  ·  corrida de GP: ${gpData?.ultimaSemana || 'sin ultimaSemana'}`);
  console.log('');

  const medidas = [];

  for (const d of docs) {
    const obraId = d.name.split('/').pop();
    const base = campos(d);
    const info = campos(await leer(`obras/${obraId}/config/info`)) || {};
    const obra = { id: obraId, ...base, ...info };
    // El campo real es `estado`, no `archivada`: ver el defecto anotado en
    // `medir-la-serie-semanal-de-margen.cjs`, que filtra por el que no existe.
    if (obra.estado === 'archivada') continue;

    const subs = await subsDeObra(obraId);
    const hist = campos(await leer(`obras/${obraId}/avance/historial`)) || {};
    const historialAvance = Array.isArray(hist.semanas) ? hist.semanas : [];
    const otrosGastos  = await coleccion(`obras/${obraId}/otrosGastos`);
    const maquinaria   = await coleccion(`obras/${obraId}/maquinaria`);
    const estimaciones = await coleccion(`obras/${obraId}/estimaciones`);
    const prog         = campos(await leer(`obras/${obraId}/config/programa`));
    const programa = prog && Object.keys(prog).length ? prog : null;

    const semanas = semanasDeVentana(obra, RANGO);

    const cons = curvaUnicaDeObra({ semanas, obra, historialAvance, subs, gpData,
                                    otrosGastos, maquinaria, programa });
    // `estCargadas: true` porque aquí la lista YA se leyó: pasarle falso
    // mediría la curva a media carga, que no es la que se imprime.
    const gob = curvaDeGobierno({ semanas, obra, historialAvance, subs, programa,
                                  estimaciones, estCargadas: true });

    medidas.push({ obraId, nombre: (obra.nombre || '').slice(0, 30), semanas, cons, gob });

    for (const [quien, c] of [['constructora', cons], ['gobierno', gob]]) {
      const trs = c.lineas.map(l => ({ clave: l.clave, t: tramosDe(l) }));
      console.log(`${obraId}  ${(obra.nombre || '').slice(0, 28).padEnd(29)} ${quien}`);
      console.log(`      ${semanas.length} semanas · ${c.lineas.length} línea(s) · ` +
                  `${c.areas.length} área(s) · ${c.ausentes.length} ausente(s) · ${c.notas.length} nota(s)`);
      for (const { clave, t } of trs) {
        const rotos = t.filter(x => !x.medido).length;
        const viejos = t.filter(x => !x.vigente).length;
        console.log(`        ${clave.padEnd(7)} ${String(t.length).padStart(2)} tramo(s)` +
                    `${rotos ? ` · ${rotos} PUNTEADO(S) por hueco` : ''}` +
                    `${viejos ? ` · ${viejos} del esquema viejo` : ''}`);
      }
      for (const a of c.ausentes)
        console.log(`        FALTA ${a.clave.padEnd(8)} ${a.motivo}`);
      console.log('');
    }
  }

  // ── 1 · CUÁNTAS LÍNEAS SE DIBUJAN DE VERDAD ───────────────────────────────
  console.log('════════════════════════════════════════════════════════════════');
  console.log('1 · ¿CUÁNTAS DE LAS LÍNEAS SE DIBUJAN?');
  console.log('');
  for (const [quien, cual, total] of [['constructora', 'cons', 3], ['gobierno', 'gob', 3]]) {
    const n = medidas.map(m => m[cual].lineas.length);
    const reparto = {};
    for (const v of n) reparto[v] = (reparto[v] || 0) + 1;
    console.log(`  ${quien.padEnd(13)} de ${total} posibles: ` +
      Object.entries(reparto).sort().map(([k, v]) => `${v} obra(s) con ${k}`).join(' · '));
  }
  console.log('');
  console.log('  los motivos de ausencia, por clave y cuántas veces:');
  const porMotivo = new Map();
  for (const m of medidas) for (const cual of ['cons', 'gob'])
    for (const a of m[cual].ausentes) {
      const k = `${a.clave} · ${a.motivo}`;
      porMotivo.set(k, (porMotivo.get(k) || 0) + 1);
    }
  for (const [k, v] of [...porMotivo].sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(v).padStart(2)}×  ${k}`);

  // ── 2 · LOS TRAMOS ────────────────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('2 · ¿HAY HUECOS QUE PUNTEAR, O LAS SERIES VIENEN ENTERAS?');
  console.log('');
  let conHueco = 0, conViejo = 0, lineasTotal = 0, maxTramos = 0;
  for (const m of medidas) for (const cual of ['cons', 'gob'])
    for (const l of m[cual].lineas) {
      const t = tramosDe(l);
      lineasTotal++;
      maxTramos = Math.max(maxTramos, t.length);
      if (t.some(x => !x.medido)) conHueco++;
      if (t.some(x => !x.vigente)) conViejo++;
    }
  console.log(`  líneas dibujadas en total:          ${lineasTotal}`);
  console.log(`  con al menos un tramo PUNTEADO:     ${conHueco}`);
  console.log(`  con al menos un tramo viejo:        ${conViejo}`);
  console.log(`  el mayor número de tramos de una:   ${maxTramos}`);
  if (!conHueco) console.log('  OJO: ningún hueco en producción — el punteado no tiene caso real hoy.');

  // ── 3 · EL RANGO DEL EJE ──────────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('3 · ¿QUÉ RANGO TIENE EL EJE, Y CRUZAN EL CERO LAS ÁREAS?');
  console.log('');
  for (const m of medidas) {
    const vals = m.cons.lineas.flatMap(l => (l.valores || []).filter(Number.isFinite));
    if (!vals.length) continue;
    const cruza = m.cons.areas.filter(a => {
      const v = (a.valores || []).filter(Number.isFinite);
      return v.some(x => x > 0) && v.some(x => x < 0);
    }).map(a => a.clave);
    console.log(`  ${m.obraId}  min ${M(Math.min(...vals)).padStart(8)} · ` +
      `max ${M(Math.max(...vals)).padStart(8)} · ` +
      `contrato ${M(m.cons.presupuesto).padStart(8)}` +
      `${cruza.length ? `  · el área ${cruza.join('/')} CRUZA EL CERO` : ''}`);
  }

  // ── 4 · LA FRONTERA ───────────────────────────────────────────────────────
  // No se mira «la gráfica de gobierno no pinta el gasto»: se recorre TODO lo
  // que devuelve, a cualquier profundidad, buscando las claves de la economía
  // del contratista. Una bandera que no se pinta pero viaja en el objeto es
  // igual de filtrada: el papel la tendría a mano.
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('4 · ¿LA CURVA DE GOBIERNO LLEVA ALGO DE LA ECONOMÍA DEL CONTRATISTA?');
  console.log('');
  const PROHIBIDAS = ['gasto', 'margen', 'gastoPorSem', 'gastoMedido',
                      'gastoSinFechar', 'utilidad', 'costo'];
  const hallados = new Set();
  const hurgar = (v, ruta, visto = new Set()) => {
    if (!v || typeof v !== 'object' || visto.has(v)) return;
    visto.add(v);
    for (const [k, sub] of Object.entries(v)) {
      const low = k.toLowerCase();
      if (PROHIBIDAS.some(p => low.includes(p.toLowerCase())))
        hallados.add(`${ruta}.${k}`);
      hurgar(sub, `${ruta}.${k}`, visto);
    }
  };
  for (const m of medidas) hurgar(m.gob, m.obraId);
  if (hallados.size) {
    console.log('  LA FRONTERA ESTÁ ABIERTA. Claves encontradas:');
    for (const h of [...hallados].slice(0, 20)) console.log(`    ${h}`);
  } else {
    console.log(`  Limpia: ninguna de las ${PROHIBIDAS.length} claves prohibidas aparece,`);
    console.log('  a ninguna profundidad, en ninguna de las obras leídas.');
  }

  // ── 5 · EL LARGO DE LOS MOTIVOS ───────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('5 · ¿CUÁNTO SITIO HAY QUE RESERVAR PARA LAS AUSENCIAS?');
  console.log('');
  const todos = [];
  for (const m of medidas) for (const cual of ['cons', 'gob'])
    for (const a of m[cual].ausentes) todos.push(`${a.nombre}: ${a.motivo}`);
  for (const m of medidas) for (const cual of ['cons', 'gob'])
    for (const n of m[cual].notas) todos.push(n);
  if (!todos.length) { console.log('  No hay ninguna ausencia ni nota que imprimir.'); }
  else {
    const largos = todos.map(t => t.length).sort((a, b) => b - a);
    console.log(`  frases a imprimir (ausencias + notas): ${todos.length}`);
    console.log(`  la más larga:  ${largos[0]} caracteres`);
    console.log(`  la mediana:    ${largos[Math.floor(largos.length / 2)]} caracteres`);
    console.log('');
    console.log('  la más larga, entera:');
    console.log(`    «${todos.find(t => t.length === largos[0])}»`);
    const maxAus = Math.max(...medidas.flatMap(m =>
      ['cons', 'gob'].map(c => m[c].ausentes.length + m[c].notas.length)));
    console.log('');
    console.log(`  el peor caso de UNA gráfica: ${maxAus} frase(s) bajo el dibujo.`);
  }

  console.log('');
})();
