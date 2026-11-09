#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿CUÁNTAS DE LAS FOTOS QUE EL REPARTO ELIGE LLEGAN A LA PANTALLA? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El mandato de B.3 pide para el tablero la misma regla del 80/20 que
// el PDF, con tope de 15, «que se vean bien», y el reparto proporcional al
// peso: «una partida del 25% no puede quedar representada por una sola foto
// mientras otra del 5% se lleva seis».
//
// La regla ya está escrita y es compartida: el tablero llama a
// `seleccionFotografica` con `tope: TOPE_FOTOS` (15) y `topePartidas: 4`. Pero
// la tarjeta pinta una rejilla FIJA de dos columnas por partida, `[0,1]`. Eso
// abre dos preguntas que no se pueden contestar razonando:
//
//   1. ¿Cuántas de las 15 fotos que el reparto asigna NO se pintan? Las que
//      cayeron en partidas más allá de la cuarta, y las que cayeron en las
//      cuatro primeras por encima de la segunda, no llegan a la pantalla.
//      Si la cifra es alta, el argumento `tope: 15` no describe la tarjeta: la
//      tarjeta tiene ocho huecos y pide quince fotos.
//
//   2. ¿La proporcionalidad SOBREVIVE a la rejilla? El reparto puede darle
//      seis fotos a la partida del 25% y una a la del 5%, pero si las dos
//      salen con dos huecos, en pantalla pesan igual. La propiedad que el
//      mandato pide es justo la que la rejilla fija aplana.
//
// NO SE MIDE CONTRA EL EMULADOR. Ahí las fotos están sembradas y el reparto da
// lo que la siembra quiso. La pregunta es qué pasa con las fotos REALES, donde
// una partida grande puede tener catorce y otra ninguna.
//
// LA CUENTA SE EXTRAE DE LA APP, NO SE REESCRIBE. `seleccionFotografica` y
// `TOPE_FOTOS` salen de `src/App.jsx` por `deApp`. Una copia del reparto aquí
// mediría mi idea del reparto, no el reparto.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-lo-que-la-tarjeta-no-ensena.cjs --prod
//
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-lo-que-la-tarjeta-no-ensena.cjs

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { deApp } = require('./extraer-de-app.cjs');
const {
  evidenciaDeObra, idDePartida, importeCatalogoPartida, soloCatalogo,
  coberturaDeEvidencia, esExtraordinaria, evidenciaDePartida,
  seleccionFotografica, TOPE_FOTOS, COBERTURA_TECHO,
} = deApp('evidenciaDeObra', 'idDePartida', 'importeCatalogoPartida', 'soloCatalogo',
         'coberturaDeEvidencia', 'esExtraordinaria', 'evidenciaDePartida',
         'seleccionFotografica', 'TOPE_FOTOS', 'COBERTURA_TECHO');

// LO QUE LA TARJETA PINTA HOY, tomado de la pantalla y no supuesto:
// `topePartidas: 4` en la llamada, y la rejilla `[0,1].map(...)` adentro.
// Están tecleados aquí porque son justamente lo que se está midiendo; el banco
// que venga después tendrá que sacarlos del archivo.
const PARTIDAS_EN_TARJETA = 4;
const HUECOS_POR_PARTIDA  = 2;

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-lo-que-la-tarjeta-no-ensena.cjs --prod\n');
  process.exit(2);
}

// Un 404 es «no existe» y vuelve `null`; cualquier otro error PARA el guion.
// Un token vencido saldría si no como «ninguna obra pierde fotos», que es una
// respuesta creíble y falsa.
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

// El armado de `subs` es el de la app, copiado de `medir-cobertura-de-evidencia`
// por la misma razón que allá: si el id no se deriva igual, ninguna foto
// encuentra su partida y todo sale en cero.
async function subsDeObra(obraId) {
  const d = campos(await leer(`obras/${obraId}/avance/subs`));
  const dExtra = campos(await leer(`obras/${obraId}/avance/extraordinarias`));
  const extras = (Array.isArray(dExtra.data) ? dExtra.data : [])
    .map((s, i) => ({ ...s, extra: true, id: s.id || `EXTRA__${i}` }));
  const base = Array.isArray(d.data) ? d.data : [];
  const necesitaMigrar = base.some(s => !s.id);
  const conId = necesitaMigrar
    ? base.map((s, idx) => ({ ...s, id: s.id || `${s.sec || 'C'}__${idx}` }))
    : base;
  return [...conId, ...extras];
}

const pct = n => (n === null ? '—' : n.toFixed(1) + '%');

(async () => {
  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];
  if (!docs.length) { console.log('No hay obras que leer.\n'); process.exit(0); }

  console.log('');
  console.log(`LA TARJETA PIDE ${TOPE_FOTOS} FOTOS Y TIENE ` +
              `${PARTIDAS_EN_TARJETA * HUECOS_POR_PARTIDA} HUECOS ` +
              `(${PARTIDAS_EN_TARJETA} partidas × ${HUECOS_POR_PARTIDA})`);
  console.log('');

  const medidas = [];

  for (const d of docs) {
    const obraId = d.name.split('/').pop();
    const o = campos(d);
    if ((o.estado || 'activa') === 'archivada') continue;

    const subs = await subsDeObra(obraId);
    const cfgEvidencia = campos(await leer(`obras/${obraId}/config/evidencia`));
    const migrada = cfgEvidencia.migrada === true;
    const docsEvidencia = migrada ? await coleccion(`obras/${obraId}/evidencia`) : [];
    const evidencia = evidenciaDeObra({ cfgEvidencia, docsEvidencia, subs });

    // LA LLAMADA DEL TABLERO, TAL CUAL ESTÁ EN `App.jsx:14710`.
    const sel = seleccionFotografica({
      subs, evidencia, evidenciaCargada: true,
      tope: TOPE_FOTOS, topePartidas: PARTIDAS_EN_TARJETA });

    // Cuántas fotos pinta de verdad: dos por cada partida mostrada, y nunca
    // más de las que el reparto le dio.
    const pintadas = sel.mostradas
      .reduce((t, p) => t + Math.min(p.fotos.length, HUECOS_POR_PARTIDA), 0);

    // Las que el reparto eligió — el trabajo que se hizo y se tira.
    const elegidas = sel.elegidas;

    // ¿La proporcionalidad sobrevive? Se compara el peso de la partida más
    // grande de la tarjeta contra el de la más chica, y cuántos huecos le tocó
    // a cada una EN PANTALLA. Si los pesos difieren y los huecos no, la
    // rejilla aplanó la regla.
    // LA PRIMERA VERSIÓN DE ESTA CUENTA DIJO «0 de 7» Y ERA FALSO. Exigía que
    // los huecos salieran IGUALES para llamarlo aplanamiento, y así el 0112
    // —57.5% con 2 huecos contra 5.6% con 1— pasaba por sano porque 2 ≠ 1. El
    // aplanamiento no es que los huecos empaten: es que la pantalla COMPRIMA
    // la diferencia que el reparto sí respetó. Con un techo de dos huecos la
    // razón en pantalla no puede pasar de 2, por grande que sea la del peso.
    const conFoto = sel.mostradas.filter(p => p.fotos.length > 0);
    let aplanada = null;
    if (conFoto.length >= 2) {
      const mayor = conFoto[0], menor = conFoto[conFoto.length - 1];
      const hMayor = Math.min(mayor.fotos.length, HUECOS_POR_PARTIDA);
      const hMenor = Math.min(menor.fotos.length, HUECOS_POR_PARTIDA);
      const razonReparto  = mayor.fotos.length / menor.fotos.length;
      const razonPantalla = hMayor / hMenor;
      aplanada = {
        mayorPct: mayor.pesoPct, menorPct: menor.pesoPct,
        mayorRepartidas: mayor.fotos.length, menorRepartidas: menor.fotos.length,
        hMayor, hMenor, razonReparto, razonPantalla,
        seAplano: razonReparto > razonPantalla + 1e-9,
      };
    }

    medidas.push({
      obraId, nombre: o.nombre || '—',
      medible: sel.medible,
      enCorte: sel.partidas.length,
      mostradas: sel.mostradas.length,
      recortadas: sel.recortadas,
      elegidas, pintadas, perdidas: elegidas - pintadas,
      sinEvidencia: sel.sinEvidencia.length,
      fuera: sel.fuera.length,
      fueraConFoto: sel.fuera.filter(p => p.fotos.length > 0).length,
      aplanada,
      detalle: sel.mostradas.map(p => ({
        nombre: (p.s?.sub || p.s?.sec || p.id || '').slice(0, 30),
        pesoPct: p.pesoPct, disponibles: p.disponibles,
        repartidas: p.fotos.length,
        pintadas: Math.min(p.fotos.length, HUECOS_POR_PARTIDA),
        sinEvidencia: p.sinEvidencia,
      })),
    });
  }

  console.log('clave  obra                              corte  mostr  elegidas  pintadas  se tiran');
  console.log('─'.repeat(88));
  for (const m of medidas) {
    console.log(
      `${m.obraId.padEnd(6)} ${m.nombre.slice(0, 31).padEnd(32)} ` +
      `${String(m.enCorte).padStart(5)}  ${String(m.mostradas).padStart(5)}  ` +
      `${String(m.elegidas).padStart(8)}  ${String(m.pintadas).padStart(8)}  ` +
      `${String(m.perdidas).padStart(8)}`);
  }

  const totElegidas = medidas.reduce((t, m) => t + m.elegidas, 0);
  const totPintadas = medidas.reduce((t, m) => t + m.pintadas, 0);
  console.log('─'.repeat(88));
  console.log(`${''.padEnd(39)}${String(totElegidas).padStart(21)}  ` +
              `${String(totPintadas).padStart(8)}  ` +
              `${String(totElegidas - totPintadas).padStart(8)}`);

  console.log('');
  console.log('─'.repeat(88));
  console.log('DETALLE POR OBRA — lo que la tarjeta reparte contra lo que pinta');
  console.log('');
  for (const m of medidas) {
    console.log(`${m.obraId} · ${m.nombre}`);
    if (!m.medible) { console.log('   la cobertura no es medible: la tarjeta no pinta partidas\n'); continue; }
    console.log(`   corte del ${COBERTURA_TECHO}%: ${m.enCorte} partidas · ` +
                `la tarjeta muestra ${m.mostradas} y recorta ${m.recortadas}`);
    for (const p of m.detalle) {
      console.log(`     ${p.nombre.padEnd(32)} ${pct(p.pesoPct).padStart(7)} ` +
        `· tiene ${String(p.disponibles).padStart(3)} · el reparto le da ` +
        `${String(p.repartidas).padStart(2)} · pinta ${p.pintadas}` +
        (p.sinEvidencia ? '  ← sin evidencia' : '') +
        (p.repartidas > p.pintadas ? `  ← se tiran ${p.repartidas - p.pintadas}` : ''));
    }
    if (m.aplanada) {
      const a = m.aplanada;
      console.log(`   la más pesada ${pct(a.mayorPct)} (reparto ${a.mayorRepartidas}, ` +
        `pinta ${a.hMayor}) contra la más ligera ${pct(a.menorPct)} ` +
        `(reparto ${a.menorRepartidas}, pinta ${a.hMenor})` +
        (a.seAplano
          ? `  ← APLANADO: el reparto las separa ${a.razonReparto.toFixed(1)}×, ` +
            `la pantalla ${a.razonPantalla.toFixed(1)}×`
          : ''));
    }
    if (m.fuera) console.log(`   fuera del corte: ${m.fuera} partidas, ${m.fueraConFoto} con foto`);
    console.log('');
  }

  const aplanadas = medidas.filter(m => m.aplanada?.seAplano);
  console.log('─'.repeat(88));
  console.log('QUÉ CONTESTA ESTA MEDICIÓN');
  console.log('');
  console.log(`  1. De ${totElegidas} fotos que el reparto elige, la tarjeta pinta ` +
              `${totPintadas}. Se tiran ${totElegidas - totPintadas}.`);
  const conDosOMas = medidas.filter(m => m.aplanada);
  console.log(`  2. En ${aplanadas.length} de las ${conDosOMas.length} obras que pintan dos ` +
              `partidas o más, la rejilla COMPRIME el reparto:`);
  for (const m of aplanadas) {
    const a = m.aplanada;
    console.log(`     ${m.obraId}: ${pct(a.mayorPct)} contra ${pct(a.menorPct)} ` +
      `— el reparto las separa ${a.razonReparto.toFixed(1)}× y la pantalla ${a.razonPantalla.toFixed(1)}×`);
  }
  console.log('');
  console.log(`     Con ${HUECOS_POR_PARTIDA} huecos por partida la razón en pantalla ` +
              `NO PUEDE pasar de ${HUECOS_POR_PARTIDA}.0×,`);
  console.log(`     así que el reparto proporcional se calcula y se tira en la rejilla.`);
  console.log('');
  const sinNada = medidas.filter(m => m.pintadas === 0);
  console.log(`  3. ${sinNada.length} de ${medidas.length} obras no pintan NI UNA foto: ` +
              sinNada.map(m => m.obraId).join(', ') || '—');
  console.log(`     No es que la tarjeta falle: sus partidas grandes no tienen evidencia, ` +
              `y eso es lo que dice.`);
  console.log('');
})();
