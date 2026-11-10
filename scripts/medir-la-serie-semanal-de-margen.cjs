#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿SE PUEDE MEDIR EL MARGEN SEMANA POR SEMANA, Y EN CUÁNTAS SEMANAS? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. A.4 pide «el comportamiento del margen en por lo menos las últimas
// 4 semanas», y de esa serie depende la regla «margen cayendo», que está
// autorizada a construirse pero NO a escribirse hasta proponer el umbral con
// números. «Cuánto tiene que caer y en cuántas semanas» no se puede inventar:
// sale de ver qué trae la serie en las obras vivas.
//
// LAS TRES PREGUNTAS:
//
//   1. ¿CUÁNTAS SEMANAS TRAEN MARGEN MEDIBLE? El margen semanal necesita las
//      DOS líneas —ejecutado y gasto— en la misma semana. `curvaUnicaDeObra` ya
//      devuelve `margen` en pesos con `null` donde falta un lado. Lo que hace
//      falta saber es cuántas semanas de cada obra traen número, si están
//      SEGUIDAS, y en cuántas obras se llega a cuatro.
//
//   2. ¿DE CUÁNTO SON LOS SALTOS REALES? El umbral se propone contra la
//      variación que las obras tienen de verdad. Si el margen de una obra se
//      mueve 8 puntos entre semanas contiguas por el ancla del último punto y
//      no porque la obra haya empeorado, un umbral de «cae 5 puntos» dispara
//      por un artefacto de la serie.
//
//   3. ¿EL PORCENTAJE POR SEMANA ES DIVIDIBLE? El margen del tablero es
//      `margen ÷ ejecutado`. Si en una semana el ejecutado acumulado es cero o
//      casi, el porcentaje explota. Hay que ver dónde pasa antes de proponer
//      un umbral en puntos porcentuales.
//
// LA CUENTA SE EXTRAE DE LA APP, NO SE REESCRIBE. `curvaUnicaDeObra` y
// `semanasDeVentana` salen de `src/App.jsx` por `deApp`. Una copia aquí mediría
// mi idea de la curva, no la curva.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-la-serie-semanal-de-margen.cjs --prod

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { deApp } = require('./extraer-de-app.cjs');
const { curvaUnicaDeObra, semanasDeVentana, finVigenteDe, estadoGastoGP,
        comportamientoDelMargen } =
  deApp('curvaUnicaDeObra', 'semanasDeVentana', 'finVigenteDe', 'estadoGastoGP',
        'comportamientoDelMargen');

// La ventana que la pantalla usa hoy para la gráfica única. Tecleada aquí
// porque es justo lo que se está midiendo: con 12 semanas, ¿cuántas traen
// margen?
const RANGO = 12;

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-la-serie-semanal-de-margen.cjs --prod\n');
  process.exit(2);
}

// Un 404 es «no existe» y vuelve `null`; cualquier otro error PARA el guion.
// Un token vencido saldría si no como «ninguna obra tiene margen medible», que
// es una respuesta creíble y falsa.
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

const MXN = n => n === null || n === undefined
  ? '—'
  : (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const PP = n => n === null || n === undefined ? '  —  '
  : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1);

(async () => {
  const gp = campos(await leer('global/gp_construct'));
  // El resumen vive plano o bajo `data`, según la versión del parser; la app
  // acepta las dos y aquí hay que hacer lo mismo o el gasto sale sin medir en
  // todas las obras por una razón que no es la obra.
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
    if (obra.archivada === true) continue;

    const subs = await subsDeObra(obraId);
    // EL HISTORIAL NO ES UNA COLECCIÓN. La primera versión de este guion leía
    // `obras/{id}/snapshots`, que no existe: el historial es un ARREGLO dentro
    // de `obras/{id}/avance/historial`. Una colección que no existe devuelve
    // `[]` sin error, así que la medición salió «0 semanas con margen en las
    // siete obras» —creíble y falsa, porque el gasto sí estaba medido en las
    // siete y el hueco venía de mi lectura, no de la obra.
    const hist = campos(await leer(`obras/${obraId}/avance/historial`)) || {};
    const historialAvance = Array.isArray(hist.semanas) ? hist.semanas : [];
    const otrosGastos = await coleccion(`obras/${obraId}/otrosGastos`);
    const maquinaria  = await coleccion(`obras/${obraId}/maquinaria`);
    const programa    = campos(await leer(`obras/${obraId}/config/programa`));

    const semanas = semanasDeVentana(obra, RANGO);
    const g = curvaUnicaDeObra({ semanas, obra, historialAvance, subs, gpData,
                                 otrosGastos, maquinaria,
                                 programa: programa && Object.keys(programa).length ? programa : null });

    // EL PORCENTAJE POR SEMANA SALE DE `comportamientoDelMargen`, que es la
    // función que la app usa. La primera versión de este guion llevaba su
    // propia división aquí, y eso volvía la medición una medida de MI idea del
    // margen semanal: si la guarda de la app y la de aquí se separaban algún
    // día, el umbral se habría propuesto contra una serie que la app no
    // publica. Una cuenta por número, incluso para medir.
    const comp = comportamientoDelMargen(g);
    const pct = comp.pct;

    const conDato = pct.map((p, i) => p !== null ? i : -1).filter(i => i >= 0);
    const colaSeguida = comp.cola;

    // Los saltos entre semanas CONTIGUAS, que es la única variación que una
    // regla de caída puede leer. Aquí sí se recorre la ventana entera y no sólo
    // la cola: para proponer el umbral hace falta ver TODOS los saltos que las
    // obras tuvieron, incluidos los de tramos anteriores a un hueco.
    const saltos = [];
    for (let i = 1; i < pct.length; i++)
      if (pct[i] !== null && pct[i - 1] !== null) saltos.push(pct[i] - pct[i - 1]);

    const gpEst = estadoGastoGP(obra, gpData);
    medidas.push({ obraId, nombre: (obra.nombre || '').slice(0, 34), semanas: semanas.length,
                   conDato: conDato.length, colaSeguida, pct, saltos, comp,
                   semanasKey: semanas,
                   ejec: g.ejecutado, gasto: g.gasto,
                   gastoMedido: gpEst.medido, motivo: gpEst.motivo,
                   anclada: g.gastoSinFechar, fin: finVigenteDe(obra) });

    const nums = pct.map(p => p === null ? '  —  ' : PP(p)).join(' ');
    console.log(`${obraId}  ${(obra.nombre || '').slice(0, 30).padEnd(31)}` +
                `${String(semanas.length).padStart(2)} sem · ${String(conDato.length).padStart(2)} con margen · cola ${colaSeguida}`);
    console.log(`      ${semanas.map(s => s.label.padStart(5)).join(' ')}`);
    console.log(`      ${nums}`);
    if (!gpEst.medido) console.log(`      gasto SIN MEDIR (${gpEst.motivo}): la serie entera es null, no cero`);
    if (g.gastoSinFechar) console.log(`      ojo: parte del gasto llega sin fecha, el último punto está anclado`);
    console.log('');
  }

  // ── EL RESUMEN QUE DECIDE EL UMBRAL ──────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════════');
  console.log('1 · ¿EN CUÁNTAS OBRAS HAY SERIE QUE LEER?');
  console.log('');
  const conCuatro = medidas.filter(m => m.colaSeguida >= 4);
  const conDos    = medidas.filter(m => m.colaSeguida >= 2);
  console.log(`  obras vivas:                              ${medidas.length}`);
  console.log(`  con el gasto medido en GP:                ${medidas.filter(m => m.gastoMedido).length}`);
  console.log(`  con 2+ semanas SEGUIDAS de margen:        ${conDos.length}  [${conDos.map(m => m.obraId).join(' ') || '—'}]`);
  console.log(`  con 4+ semanas SEGUIDAS (lo que pide A.4): ${conCuatro.length}  [${conCuatro.map(m => m.obraId).join(' ') || '—'}]`);
  const sinMedir = medidas.filter(m => !m.gastoMedido);
  if (sinMedir.length) {
    console.log('');
    console.log('  las que no tienen serie, con su motivo:');
    for (const m of sinMedir) console.log(`    ${m.obraId}  ${m.motivo}`);
  }

  console.log('');
  console.log('2 · ¿DE CUÁNTO SON LOS SALTOS REALES ENTRE SEMANAS CONTIGUAS?');
  console.log('');
  const todos = medidas.flatMap(m => m.saltos);
  if (!todos.length) {
    console.log('  NO HAY NI UN SALTO QUE MEDIR: ninguna obra tiene dos semanas');
    console.log('  contiguas con margen. Un umbral propuesto sobre esto sería');
    console.log('  una cifra inventada con cara de medida.');
  } else {
    const ord = [...todos].sort((a, b) => a - b);
    const q = (p) => ord[Math.min(ord.length - 1, Math.floor(p * ord.length))];
    console.log(`  saltos medibles:   ${todos.length}`);
    console.log(`  el peor descenso:  ${PP(ord[0])} pp`);
    console.log(`  mediana:           ${PP(q(0.5))} pp`);
    console.log(`  el mejor ascenso:  ${PP(ord[ord.length - 1])} pp`);
    for (const corte of [1, 2, 3, 5, 10]) {
      const n = todos.filter(s => s <= -corte).length;
      console.log(`  caídas de ${String(corte).padStart(2)}pp o más en una semana: ${String(n).padStart(3)} de ${todos.length}`);
    }
    console.log('');
    console.log('  LAS ANCLADAS CUENTAN APARTE: donde el gasto llega sin fecha, el');
    console.log('  último punto se sobrescribe con el total vivo, así que el último');
    console.log('  salto puede ser el ancla y no la obra.');
    const ancl = medidas.filter(m => m.anclada);
    console.log(`  obras con gasto sin fechar: ${ancl.length}  [${ancl.map(m => m.obraId).join(' ') || '—'}]`);
  }

  console.log('');
  console.log('3 · ¿DÓNDE EXPLOTA EL PORCENTAJE?');
  console.log('');
  const extremos = medidas.flatMap(m => m.pct.map((p, i) => ({ obraId: m.obraId, i, p })))
    .filter(x => x.p !== null && Math.abs(x.p) > 100);
  console.log(`  semanas con |margen| > 100%: ${extremos.length}` +
    (extremos.length ? `  [${extremos.map(x => x.obraId + ':' + PP(x.p)).join(' ')}]` : ''));
  console.log('  (el margen baja de −100% cuando el gasto pasa del doble de lo');
  console.log('   ejecutado; no es un defecto del cociente, es la obra)');

  // ── 4 · ¿DE QUÉ FORMA ES LA CAÍDA? ───────────────────────────────────────
  //
  // Las secciones 2 y 3 miden el tamaño del salto. Ésta mide la FORMA, que es
  // lo que decide si el umbral se escribe por semana o por tramo. Son dos
  // preguntas distintas y pueden contestar al revés:
  //
  //   · el PEOR SALTO DE UNA SEMANA puede ser un evento de captura —una
  //     estimación que entró tarde, un lote de cheques que se cargó de golpe—
  //     y no que la obra haya empeorado.
  //   · la CAÍDA DEL TRAMO ENTERO (primera semana contigua contra la última)
  //     puede ser la caída real y no superar el umbral en ninguna semana
  //     suelta, así que una regla por semana la deja pasar en silencio.
  //
  // Para no adivinar cuál de las dos es cada caso, en los saltos grandes se
  // imprime el par ejecutado/gasto de las dos semanas: si el que brinca es el
  // ejecutado, fue captura de avance; si es el gasto, fue carga de gasto.
  const SALTO_GRANDE = 20;
  console.log('');
  console.log('4 · ¿LA CAÍDA ES DE UNA SEMANA O DEL TRAMO?');
  console.log('');
  console.log('  obra  cola  primera→última     del tramo    peor semana   quietas  ¿cuál manda?');
  for (const m of medidas) {
    if (m.colaSeguida < 2) continue;
    const c = m.comp;
    const manda = c.delTramo <= c.peorSemana.delta ? 'EL TRAMO' : 'la semana';
    console.log(`  ${m.obraId}   ${String(m.colaSeguida).padStart(2)}   ` +
      `${PP(c.desde)}→${PP(c.hasta)}`.padEnd(19) +
      `${PP(c.delTramo)} pp`.padEnd(13) +
      `${PP(c.peorSemana.delta)} pp`.padEnd(14) +
      `${String(c.quietas).padStart(2)}/${c.cola}`.padEnd(9) + manda);

    // Los saltos grandes se abren con su par ejecutado/gasto: si el que brinca
    // es el ejecutado, fue captura de avance; si es el gasto, fue carga de
    // gasto. Adivinarlo es justo lo que no se puede hacer.
    const ini = m.pct.length - m.colaSeguida;
    for (const r of c.renglones) {
      if (r.delta === null || Math.abs(r.delta) < SALTO_GRANDE) continue;
      const i = m.semanasKey.findIndex(s => s.key === r.key);
      const culpa = Math.abs((m.ejec[i] || 0) - (m.ejec[i - 1] || 0)) >
                    Math.abs((m.gasto[i] || 0) - (m.gasto[i - 1] || 0))
        ? 'brincó el EJECUTADO (captura de avance)'
        : 'brincó el GASTO (carga de gasto)';
      console.log(`         ${m.semanasKey[i - 1].label}→${r.label}  ${PP(r.delta)} pp · ${culpa}` +
                  (r.ejecutadoQuieto ? ' · ejecutado QUIETO' : ''));
      console.log(`           ejecutado ${MXN(m.ejec[i - 1])} → ${MXN(m.ejec[i])}`);
      console.log(`           gasto     ${MXN(m.gasto[i - 1])} → ${MXN(m.gasto[i])}`);
    }
    void ini;
  }
  console.log('');
  const conTramo = medidas.filter(m => m.colaSeguida >= 2);
  const mandaTramo = conTramo.filter(m => m.comp.delTramo <= m.comp.peorSemana.delta);
  console.log(`  obras donde la caída del tramo es peor que cualquier semana suelta:` +
              ` ${mandaTramo.length}  [${mandaTramo.map(m => m.obraId).join(' ') || '—'}]`);
  console.log('  Ésas son las que una regla por semana no ve.');
  console.log('');
  const conQuietas = conTramo.filter(m => m.comp.quietas > 0);
  console.log(`  obras con al menos una semana de ejecutado QUIETO dentro del tramo:` +
              ` ${conQuietas.length}  [${conQuietas.map(m => m.obraId + ':' + m.comp.quietas).join(' ') || '—'}]`);
  console.log('  En esas semanas el margen se mueve porque el gasto sigue llegando');
  console.log('  contra un avance que nadie cerró. No es la obra, es la captura.');
  console.log('');
  console.log(`  obras donde A.4 tiene sus 4 semanas seguidas: ` +
    `${medidas.filter(m => m.comp.suficiente).length} de ${medidas.length}`);
  for (const m of medidas.filter(m => !m.comp.suficiente))
    console.log(`    ${m.obraId}  declara: ${m.comp.motivo}`);

  // ── 5 · ¿QUÉ DISPARARÍA CADA UMBRAL? ─────────────────────────────────────
  //
  // Esto es lo que hay que ver ANTES de escribir la regla «margen cayendo». No
  // alcanza con saber de qué tamaño son los saltos: hay que saber a QUIÉN
  // señalaría cada umbral y si a esa obra le pasa algo de verdad. Un umbral que
  // dispara en la obra cuya captura va atrasada no mide la obra, mide la
  // captura, y el reporte acabaría acusando al residente de un deterioro que
  // no existe.
  console.log('');
  console.log('5 · ¿QUÉ DISPARARÍA CADA UMBRAL?');
  console.log('');

  // (a) Las caídas de una semana, separadas por si el ejecutado se movió.
  const caidas = medidas.flatMap(m => m.comp.renglones
    .filter(r => r.delta !== null && r.delta < 0)
    .map(r => ({ obraId: m.obraId, label: r.label, d: r.delta, quieto: r.ejecutadoQuieto })));
  console.log('  (a) LAS CAÍDAS DE UNA SEMANA, dentro del tramo contiguo:');
  for (const corte of [1, 2, 3, 5, 10]) {
    const hits = caidas.filter(c => c.d <= -corte);
    const sobreQuieto = hits.filter(c => c.quieto);
    console.log(`      ${String(corte).padStart(2)}pp o más: ${String(hits.length).padStart(2)} caída(s)` +
      `  ·  ${sobreQuieto.length} de ellas con el EJECUTADO QUIETO` +
      (hits.length ? `  [${hits.map(c => c.obraId + ':' + c.label + (c.quieto ? '*' : '')).join(' ')}]` : ''));
  }
  console.log('      (* = esa semana el avance no se cerró: el margen se movió por el gasto solo)');

  // (b) El tramo completo, con y sin el filtro de captura. La pregunta de
  // fondo: ¿qué obras quedarían señaladas, y son las que están mal?
  console.log('');
  console.log('  (b) EL TRAMO COMPLETO (sólo obras con 4+ semanas seguidas):');
  const elegibles = medidas.filter(m => m.comp.suficiente);
  const capturaFloja = (m) => m.comp.quietas * 2 > m.comp.cola;
  console.log('      obra  tramo      quietas   ¿la captura manda?');
  for (const m of elegibles)
    console.log(`      ${m.obraId}  ${(PP(m.comp.delTramo) + ' pp').padEnd(11)}${String(m.comp.quietas)}/${m.comp.cola}` +
      `       ${capturaFloja(m) ? 'SÍ — no se puede medir la obra' : 'no'}`);
  console.log('');
  for (const corte of [2, 3, 4, 5, 8]) {
    const crudo = elegibles.filter(m => m.comp.delTramo <= -corte);
    const limpio = crudo.filter(m => !capturaFloja(m));
    console.log(`      umbral ${String(corte).padStart(2)}pp en el tramo:` +
      ` ${crudo.length} obra(s) [${crudo.map(m => m.obraId).join(' ') || '—'}]` +
      `  ·  descontando las de captura floja: ${limpio.length} [${limpio.map(m => m.obraId).join(' ') || '—'}]`);
  }
  console.log('');
  const fuera = elegibles.filter(capturaFloja);
  console.log(`  obras que el filtro de captura dejaría en NO EVALUABLE: ` +
    `${fuera.length} de ${elegibles.length}  [${fuera.map(m => m.obraId).join(' ') || '—'}]`);
  console.log('  No es que no tengan riesgo: es que su margen se movió sobre un');
  console.log('  avance que nadie cerró, y eso no se puede leer como deterioro.');
  console.log('');
  console.log(`  CUÁNTO PESA LA MUESTRA: de ${medidas.length} obras vivas, ` +
    `${elegibles.length} llegan a 4 semanas seguidas y ${elegibles.length - fuera.length} ` +
    `quedan legibles. Cualquier umbral que salga de aquí descansa en esas pocas.`);
  console.log('');
})();
