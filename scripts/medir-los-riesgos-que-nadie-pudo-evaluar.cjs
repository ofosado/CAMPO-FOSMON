#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ RIESGOS NO SE PUDIERON EVALUAR, Y CUÁNTOS NO SE VEN? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. La A.6 pide que el tablero deje de callar los riesgos que NO SE
// PUDIERON MEDIR. Hoy `evaluarRiesgos` separa cuatro estados —detectados, sin
// hallazgo, no evaluables, reventaron— y la pantalla pinta UNO: `detectados`.
// El documento interno ya publica los cuatro (#123); la pantalla no.
//
// Lo que se calla es exactamente lo que el mandato llama inaceptable: una
// regla que se calló porque midió y no encontró nada se ve IGUAL que una que
// se calló porque le faltó el dato. El panel dice «3 indicadores» y quien lo
// lee concluye que los demás están bien.
//
// LAS CUATRO PREGUNTAS, y ninguna se contesta de memoria:
//
//   1. ¿CUÁNTOS RIESGOS SE ESTÁN CALLANDO HOY? Por obra: cuántos detectados
//      (lo único que se ve) contra cuántos no evaluables (lo que no se ve).
//      Si no evaluables fuera cero en las siete obras, la A.6 sería código
//      para una hipótesis y habría que decirlo antes de escribirla.
//
//   2. ¿QUÉ DATO FALTA, Y SE REPITE? Un hueco accionable nombra el dato. Si
//      veinte reglas se caen por el MISMO dato, la pantalla no puede listar
//      veinte renglones: tiene que agrupar por dato, porque lo que se va a
//      arreglar es el dato, no la regla.
//
//   3. ¿REVIENTA ALGUNA? `reventaron` es un defecto nuestro, no un hueco de
//      captura. Si hay alguno en producción hay que verlo antes de diseñar
//      cómo se pinta — y si no hay ninguno, hay que decir que la conducta se
//      escribe sin un caso que la ejerza.
//
//   4. ¿LE PASA LO MISMO A LA DEPENDENCIA? La biblioteca se recorta por
//      `tipo`, así que el municipio ve otra lista. Un panel diseñado sobre la
//      forma de la constructora puede no tener sentido del otro lado.
//
// LAS CUENTAS SE EXTRAEN DE LA APP, NO SE REESCRIBEN. `evaluarRiesgos`,
// `calcularKPIsObra`, `curvaUnicaDeObra`, `semanasDeVentana` y
// `comportamientoDelMargen` salen de `src/App.jsx` por `deApp`. Una copia aquí
// mediría mi idea del motor, no el motor.
//
// EL CONTEXTO SE ARMA COMO EL DEL TABLERO, campo por campo. Con un insumo de
// menos la medición inventaría huecos: una obra que SÍ capturó nómina saldría
// como «no evaluable por falta de nómina» porque el guion no la leyó, y la
// A.6 se diseñaría sobre huecos que no existen.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-los-riesgos-que-nadie-pudo-evaluar.cjs --prod
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-los-riesgos-que-nadie-pudo-evaluar.cjs

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { deApp } = require('./extraer-de-app.cjs');
const { evaluarRiesgos, calcularKPIsObra, curvaUnicaDeObra, semanasDeVentana,
        comportamientoDelMargen, BIBLIOTECA_RIESGOS, RIESGOS_SOLO_CONSTRUCTORA } =
  deApp('evaluarRiesgos', 'calcularKPIsObra', 'curvaUnicaDeObra', 'semanasDeVentana',
        'comportamientoDelMargen', 'BIBLIOTECA_RIESGOS', 'RIESGOS_SOLO_CONSTRUCTORA');

// La misma ventana que la pantalla usa para la gráfica única y para la serie
// de margen del riesgo `fin_007`. Con otra, la evaluabilidad de esa regla
// sería la de una pantalla que no existe.
const RANGO = 12;

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-los-riesgos-que-nadie-pudo-evaluar.cjs --prod\n');
  process.exit(2);
}

// Un 404 es «no existe» y vuelve `null`; cualquier otro error PARA el guion.
// Un token vencido saldría si no como «ninguna obra tiene riesgos», que es una
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

// El armado de `subs` es el de la app: si el id no se deriva igual, ninguna
// partida encuentra su avance y el ejecutado sale en cero.
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

const pad = (s, n) => String(s).padEnd(n).slice(0, n);

(async () => {
  const gp = campos(await leer('global/gp_construct'));
  const gpData = gp?.data && typeof gp.data === 'object' ? gp.data : gp;

  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];
  if (!docs.length) { console.log('No hay obras que leer.\n'); process.exit(0); }

  console.log('');
  console.log(`DESTINO: ${DESTINO.prod ? 'PRODUCCIÓN' : `emulador ${DESTINO.emulador}`}` +
              `  ·  ${BIBLIOTECA_RIESGOS.length} reglas en la biblioteca` +
              `  ·  ${RIESGOS_SOLO_CONSTRUCTORA.size} sólo para la constructora`);
  console.log('MODO:    SÓLO LECTURA — este guion no escribe, no tiene con qué');
  console.log('');

  const medidas = [];

  for (const d of docs) {
    const obraId = d.name.split('/').pop();
    const base = campos(d);
    const info = campos(await leer(`obras/${obraId}/config/info`)) || {};
    const obra = { id: obraId, ...base, ...info };

    const subs = await subsDeObra(obraId);
    const hist = campos(await leer(`obras/${obraId}/avance/historial`)) || {};
    const historialAvance = Array.isArray(hist.semanas) ? hist.semanas : [];
    const otrosGastos   = await coleccion(`obras/${obraId}/otrosGastos`);
    const maquinaria    = await coleccion(`obras/${obraId}/maquinaria`);
    const materiales    = await coleccion(`obras/${obraId}/materiales`);
    const estimaciones  = await coleccion(`obras/${obraId}/estimaciones`);
    const subcontratos  = await coleccion(`obras/${obraId}/subcontratos`);
    const nominaHistorial = await coleccion(`obras/${obraId}/nomina`);
    const prog = campos(await leer(`obras/${obraId}/config/programa`));
    const programa = prog && Object.keys(prog).length ? prog : null;

    const semanas = semanasDeVentana(obra, RANGO);
    const curva = curvaUnicaDeObra({ semanas, obra, historialAvance, subs, gpData,
                                     otrosGastos, maquinaria, programa });
    const comportamientoMargen = comportamientoDelMargen(curva);

    const k = calcularKPIsObra(obra, subs, maquinaria, materiales, estimaciones,
                               gpData, otrosGastos);
    const kpis = { gt: k.gt, am: k.am, alm: k.alm, me: k.me, af: k.af,
                   diff: k.diff, mpct: k.mpct, pctGasto: k.pctGasto, brecha: k.brecha };

    const ctx = { obra, subs, maquinaria, materiales, estimaciones, subcontratos,
                  historialAvance, gpData, kpis, nominaHistorial, programa,
                  comportamientoMargen };

    medidas.push({
      obraId, nombre: (obra.nombre || '').slice(0, 30),
      constructora: evaluarRiesgos(ctx),
      dependencia: evaluarRiesgos({ ...ctx, tipo: 'dependencia' }),
    });
  }

  // ── POR OBRA: LO QUE SE VE CONTRA LO QUE NO ───────────────────────────────
  console.log('  CLAVE  OBRA                             DETECT  NO EVAL  SIN HALL  REVENT');
  console.log('  ' + '─'.repeat(78));
  for (const m of medidas) {
    const v = m.constructora;
    console.log(`  ${pad(m.obraId, 6)} ${pad(m.nombre, 32)} ` +
      `${String(v.detectados.length).padStart(5)}   ` +
      `${String(v.noEvaluables.length).padStart(6)}   ` +
      `${String(v.sinHallazgo.length).padStart(7)}   ` +
      `${String(v.reventaron.length).padStart(5)}`);
  }
  console.log('');

  const raya = '─'.repeat(92);
  console.log(raya);
  console.log('QUÉ CONTESTA ESTA MEDICIÓN');
  console.log('');

  // 1 · CUÁNTO SE CALLA
  const conHuecos = medidas.filter(m => m.constructora.noEvaluables.length > 0);
  const totalNoEval = medidas.reduce((t, m) => t + m.constructora.noEvaluables.length, 0);
  console.log(`  1. SE CALLAN HOY: ${totalNoEval} riesgo(s) no evaluables en ${conHuecos.length} de ${medidas.length} obras.`);
  if (conHuecos.length) {
    for (const m of conHuecos)
      console.log(`       ${m.obraId}: la pantalla enseña ${m.constructora.detectados.length} y ` +
        `calla ${m.constructora.noEvaluables.length} que no se pudieron medir`);
    console.log('     Antes del #127 esos huecos NO estaban en ninguna pantalla: el tablero');
    console.log('     sólo pedía `detectados`, así que una regla sin dato se veía igual que');
    console.log('     una que midió y no encontró nada.');
  } else {
    console.log('     NINGUNA: todas las reglas que aplican pudieron medir en las obras vivas.');
    console.log('     La A.6 sería código para una hipótesis — decirlo antes de escribirla.');
  }
  console.log('');

  // 2 · QUÉ DATO FALTA, Y CUÁNTAS REGLAS TUMBA
  console.log('  2. EL DATO QUE FALTA, y cuántas reglas tumba cada uno:');
  const porDato = new Map();
  for (const m of medidas)
    for (const r of m.constructora.noEvaluables)
      for (const f of r.faltan) {
        const k = f.nombre || f.dato;
        if (!porDato.has(k)) porDato.set(k, { reglas: new Set(), obras: new Set(), porQue: new Set() });
        const e = porDato.get(k);
        e.reglas.add(r.id); e.obras.add(m.obraId);
        if (f.porQue) e.porQue.add(f.porQue);
      }
  if (porDato.size) {
    const orden = [...porDato.entries()].sort((a, b) => b[1].reglas.size - a[1].reglas.size);
    for (const [dato, e] of orden) {
      console.log(`       «${dato}»: ${e.reglas.size} regla(s) en ${e.obras.size} obra(s) ` +
        `— ${[...e.obras].join(', ')}`);
      for (const p of e.porQue) console.log(`           porque ${p}`);
    }
    const peor = orden[0];
    console.log('');
    console.log(`     El peor dato tumba ${peor[1].reglas.size} regla(s). Si la pantalla listara una fila por`);
    console.log('     regla, ese dato saldría repetido y el panel sería más largo que el de');
    console.log('     los riesgos que sí disparan — se AGRUPA POR DATO, que es lo que se arregla.');
  } else {
    console.log('       ninguno');
  }
  console.log('');

  // 3 · LO QUE REVIENTA
  const revent = medidas.filter(m => m.constructora.reventaron.length);
  console.log(`  3. REVENTARON: ${revent.length} de ${medidas.length} obras.`);
  for (const m of revent)
    for (const r of m.constructora.reventaron)
      console.log(`       ${m.obraId} · ${r.id}: ${r.error}`);
  if (!revent.length)
    console.log('       ninguna — la conducta se escribe SIN un caso en producción que la ejerza.');
  console.log('');

  // 4 · LA DEPENDENCIA
  console.log('  4. DEL LADO DE LA DEPENDENCIA (la biblioteca recortada por `tipo`):');
  for (const m of medidas) {
    const c = m.constructora, p = m.dependencia;
    console.log(`       ${m.obraId}: constructora ${c.detectados.length} detect / ${c.noEvaluables.length} sin dato` +
      `   ·   dependencia ${p.detectados.length} detect / ${p.noEvaluables.length} sin dato`);
  }
  const depHuecos = medidas.filter(m => m.dependencia.noEvaluables.length > 0);
  console.log(`     Con huecos del lado dependencia: ${depHuecos.length} de ${medidas.length} obras.`);
  console.log('');

  // ── LO QUE NO TIENE CASO ──────────────────────────────────────────────────
  const sinCaso = [];
  if (!revent.length) sinCaso.push('pintar los que reventaron');
  if (!conHuecos.length) sinCaso.push('pintar los no evaluables');
  if (!depHuecos.length) sinCaso.push('el panel de huecos del lado dependencia');
  console.log(raya);
  if (sinCaso.length) {
    console.log('CONDUCTAS SIN UNA SOLA OBRA QUE LAS EJERZA HOY — se escriben igual, pero');
    console.log('ninguna medición las respalda y la prueba es lo único que las va a ver:');
    for (const s of sinCaso) console.log(`  · ${s}`);
  } else {
    console.log('TODAS las conductas que la A.6 va a escribir tienen al menos una obra real');
    console.log('que las ejerce hoy. Ninguna se escribe contra una hipótesis.');
  }
  console.log('');
})();
