#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ SE PERDERÍA AL QUITAR CADA BLOQUE DEL TABLERO? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. Hay cuatro bloques del tablero señalados como repetición de los
// KPIs de arriba. Leyendo el código se ve qué cifra de cada bloque YA está
// arriba y cuál no; eso ya se midió. Lo que el código no dice es si la cifra
// que NO está arriba trae dato en las obras vivas. No es lo mismo perder un
// número que hoy dice $2.4M y perder una columna de ceros: en el primer caso
// la cifra sube arriba, en el segundo se decide por su valor futuro y no por
// lo que hoy se vería desaparecer.
//
// Las cuatro cifras que el código señaló como únicas, y de dónde salen:
//
//   · estTotal / estPorCob / estPag — `obras/{id}/config/estimaciones`, campo
//     `data`. Ninguna de las tres está en un KPI de arriba, y `estPag` es la
//     tercera serie de la gráfica de gobierno («lo pagado al contratista»).
//   · `am` sin almacén contra `me` con almacén — `am` sale del catálogo
//     (`avance/subs`) y `alm` de `avance/materiales`. Si no hay materiales
//     capturados, `am === me` y el bloque entero es una copia del KPI.
//   · la PROCEDENCIA de la plantilla: qué semana es y de cuántos archivos se
//     sumó. El desglose directo/indirecto ya está en el KPI de arriba, así
//     que lo único del bloque es de cuándo es el número.
//   · el veredicto del margen y el umbral del 15%. Eso es cálculo, no dato:
//     no hace falta medirlo en producción.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()`, y hace
// GET. No hay PATCH, ni POST, ni DELETE, ni `firebase-admin` —que es el que
// trae `.set()` detrás—. Una bandera se puede teclear mal; un verbo que no
// está escrito no se puede mandar.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-lo-que-se-perderia-del-tablero.cjs --prod

'use strict';

require('./reloj.cjs');

// EL EJECUTADO NO SE TECLEA AQUÍ. `am` es `desgloseEjecutado(subs, modoVol)
// .total`, y si este medidor reimplementara esa suma estaría comparando la
// pantalla contra una segunda cuenta mía: una cuenta por número, también para
// el que mide. Se piden por `deApp` para que la petición quede escrita donde
// `prueba-herramientas-de-medicion-viven.cjs` la encuentra, y un renombre se
// vea el día que ocurre y no el día que se quería medir.
const { deApp } = require('./extraer-de-app.cjs');
const { desgloseEjecutado, avanceFisicoPonderado, plazoDeObra } =
  deApp('desgloseEjecutado', 'avanceFisicoPonderado', 'plazoDeObra');

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
  console.error('    node scripts/medir-lo-que-se-perderia-del-tablero.cjs --prod\n');
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

// Firestore REST devuelve cada valor etiquetado con su tipo. Un número puede
// llegar como `integerValue` (cadena) o `doubleValue`, y hay campos guardados
// como texto («1,234.50»). Se desenvuelve a JS plano antes de sumar, porque
// sumar `integerValue` como cadena concatena en silencio.
const plano = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plano);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = plano(x);
    return o;
  }
  return null;
};

const docPlano = (j) => {
  if (!j || !j.fields) return null;
  const o = {};
  for (const [k, v] of Object.entries(j.fields)) o[k] = plano(v);
  return o;
};

// La misma normalización de estatus que usa la app: el estatus viene escrito a
// mano y «Pagada», «pagada» y «PAGADA » son el mismo estado.
const normEst = (s) => String(s ?? '').trim().toLowerCase();

// Los montos del alta llegan a veces como texto con comas. La app los pasa por
// su propio parseador; aquí se replica el mismo criterio para no medir una
// cifra distinta de la que la pantalla suma.
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const MXN = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

(async () => {
  console.log(`Destino: ${DESTINO.prod ? 'PRODUCCIÓN (lectura)' : `emulador ${DESTINO.emulador}`}\n`);

  const obrasDocs = await todaLaColeccion('obras');
  const filas = [];

  for (const d of obrasDocs) {
    const id = d.name.split('/').pop();
    const raiz = docPlano(d) || {};
    const info = docPlano(await leer(`obras/${id}/config/info`)) || {};
    const campo = (k) => (info[k] !== undefined && info[k] !== null && info[k] !== '' ? info[k] : raiz[k]);

    // ── EJECUTADO, con la función de la app ──────────────────────────────
    const subsDoc = docPlano(await leer(`obras/${id}/avance/subs`));
    const subs = Array.isArray(subsDoc?.data) ? subsDoc.data : [];
    const modoVol = (campo('modoAvance') === 'volumen');
    const am = desgloseEjecutado(subs, modoVol).total;

    // ── EL HISTORIAL SEMANAL DE AVANCE ───────────────────────────────────
    //
    // Lo que B.2 exige y hoy no se usa: «al ritmo de las últimas N semanas»
    // con N salido de la cuenta. El ritmo de hoy (`am / (transcurridos/7)`)
    // es el promedio de TODO el plazo, así que no necesita historial; un
    // ritmo de las últimas N semanas sí. Si una obra no tiene cortes
    // semanales guardados, ese ritmo no se puede calcular para ella y el
    // bloque tiene que decirlo en vez de proyectar.
    // Y el corte de estimaciones de cada semana vive en el mismo snapshot
    // (`montoEstimado`, `montoPagado`), con `null` explícito cuando el cierre
    // corrió sin poder afirmarlo. Eso es lo que permite separar las dos
    // velocidades que hoy se mezclan: la de EJECUCIÓN y la de ESTIMACIÓN.
    const histDoc = docPlano(await leer(`obras/${id}/avance/historial`));
    const hist = (Array.isArray(histDoc?.semanas) ? histDoc.semanas : [])
      .slice().sort((a, b) => (num(a?.año) - num(b?.año)) || (num(a?.semana) - num(b?.semana)));
    const conEjec = hist.filter((h) => num(h?.montoEjecutado) > 0).length;
    const conEst = hist.filter((h) => h?.montoEstimado != null).length;
    const conPag = hist.filter((h) => h?.montoPagado != null).length;
    const semEtq = (h) => `${num(h?.año)}-S${String(num(h?.semana)).padStart(2, '0')}`;
    const tramo = hist.length ? `${semEtq(hist[0])}→${semEtq(hist[hist.length - 1])}` : '—';

    // El ritmo de las ÚLTIMAS N semanas, que es lo que B.2 pide y hoy no se
    // calcula. Se mide como delta entre el primer y el último snapshot de la
    // ventana dividido entre las semanas que separan a los dos, no entre N:
    // dos snapshots de semanas 40 y 45 son cinco semanas de obra aunque sean
    // dos registros. Si la ventana no tiene dos cortes, no hay ritmo.
    const ritmoUlt = (campoMonto, n) => {
      const v = hist.filter((h) => h?.[campoMonto] != null).slice(-n);
      if (v.length < 2) return null;
      const a = v[0], b = v[v.length - 1];
      const sem = (num(b.año) - num(a.año)) * 52 + (num(b.semana) - num(a.semana));
      if (sem <= 0) return null;
      return { ritmo: (num(b[campoMonto]) - num(a[campoMonto])) / sem, sem, cortes: v.length };
    };
    const ritmoEjec4 = ritmoUlt('montoEjecutado', 5);
    const ritmoEst4 = ritmoUlt('montoEstimado', 5);

    // ── ESTIMACIONES ─────────────────────────────────────────────────────
    const estDoc = docPlano(await leer(`obras/${id}/config/estimaciones`));
    const ests = Array.isArray(estDoc?.data) ? estDoc.data : [];
    const estTotal = ests.reduce((t, e) => t + num(e?.monto), 0);
    const estPag = ests.filter((e) => normEst(e?.estatus) === 'pagada')
      .reduce((t, e) => t + num(e?.monto), 0);
    const estPorCob = ests.filter((e) => ['facturada', 'aprobada'].includes(normEst(e?.estatus)) ||
      normEst(e?.estatus).includes('proceso')).reduce((t, e) => t + num(e?.monto), 0);
    const estatus = {};
    for (const e of ests) {
      const k = normEst(e?.estatus) || '(sin estatus)';
      estatus[k] = (estatus[k] || 0) + 1;
    }

    // ── MATERIALES (el almacén que hace que `me` ≠ `am`) ─────────────────
    const matDoc = docPlano(await leer(`obras/${id}/avance/materiales`));
    const mats = Array.isArray(matDoc?.data) ? matDoc.data : [];
    // La app cuenta sólo los materiales con importe, igual que el PDF
    // (`matActivos`): un renglón capturado con importe cero no es almacén.
    const matActivos = mats.filter((m) => num(m?.imp) > 0);
    const alm = matActivos.reduce((t, m) => t + num(m?.imp), 0);

    // ── NÓMINA: de cuándo es la plantilla y de cuántos archivos se sumó ──
    //
    // LA FORMA LA DICE LA BANDERA, NO LOS DATOS. `leerHistorialNomina`
    // (`src/App.jsx:5724`) deja escrito por qué: una subcolección vacía, una
    // que no se pudo leer y una obra que no ha migrado se ven igual desde
    // afuera, y adivinar mal enseña CERO SEMANAS con la misma cara que tres.
    // Si este medidor adivinara por los datos mediría la forma que la app NO
    // está leyendo, que es justo el modo de medir bien y reportar mal.
    const formato = info?.formatoHistorial?.nomina === 2 ? 2 : 1;
    let nomCargas = [];
    if (formato === 1) {
      const nomDoc = docPlano(await leer(`obras/${id}/nomina/historial`));
      nomCargas = Array.isArray(nomDoc?.semanas) ? nomDoc.semanas : [];
    } else {
      for (const nd of await todaLaColeccion(`obras/${id}/nomina_historial`)) {
        const p = docPlano(nd)?.partes;
        if (Array.isArray(p)) nomCargas.push(...p);
      }
    }
    const forma = nomCargas.length === 0 ? '—' : (formato === 2 ? 'subcolección' : 'documento');

    // La pantalla toma la ÚLTIMA semana por calendario y suma las partes de esa
    // misma semana (`semanasDeNomina`). Aquí se agrupa igual, por el número de
    // semana que trae el registro, para poder decir de cuántos archivos salió
    // el número que hoy se ve. Se agrupa por NÚMERO y no por la clave
    // `Y2026-S42` completa porque el año de la clave se deduce de la fecha de
    // carga y esa deducción no hace falta para contar partes; si una obra
    // tuviera semanas de dos años distintos, el conteo de abajo lo diría.
    const nSemana = (c) => {
      const m = String(c?.semana ?? '').match(/(\d+)/);
      const n = m ? parseInt(m[1], 10) : NaN;
      return (n >= 1 && n <= 53) ? n : null;
    };
    const porSemana = new Map();
    let sinClave = 0;
    for (const c of nomCargas) {
      const n = nSemana(c);
      if (n === null) { sinClave++; continue; }
      if (!porSemana.has(n)) porSemana.set(n, []);
      porSemana.get(n).push(c);
    }
    const nums = [...porSemana.keys()].sort((a, b) => a - b);
    const ultNum = nums.length ? nums[nums.length - 1] : null;
    const partesDeUlt = ultNum === null ? [] : porSemana.get(ultNum);
    const ultClave = partesDeUlt[0]?.semana ?? null;
    const partesUlt = partesDeUlt.length;
    const dir = partesDeUlt.reduce((t, c) => t + num(c?.totalDir), 0);
    const ind = partesDeUlt.reduce((t, c) => t + num(c?.totalInd), 0);

    filas.push({
      id, nombre: String(campo('nombre') || '(sin nombre)').slice(0, 34),
      presupuesto: num(campo('presupuesto')), am, nSubs: subs.length,
      af: avanceFisicoPonderado(subs, num(campo('presupuesto')), modoVol),
      plazo: plazoDeObra({ ...raiz, ...info }),
      nHist: hist.length, conEjec, conEst, conPag, tramo, ritmoEjec4, ritmoEst4,
      nEst: ests.length, estTotal, estPag, estPorCob, estatus,
      nMat: mats.length, nMatActivos: matActivos.length, alm,
      forma, nSemanas: nums.length, ultClave, partesUlt, dir, ind, sinClave,
      nCargas: nomCargas.length,
    });
  }

  filas.sort((a, b) => a.id.localeCompare(b.id));

  console.log('══ 1 · ESTIMACIONES — las tres cifras que NINGÚN KPI de arriba trae ══\n');
  console.log('obra  nombre                             #  estimado       por cobrar     pagado');
  for (const f of filas) {
    console.log(`${f.id}  ${f.nombre.padEnd(34)} ${String(f.nEst).padStart(2)}  ` +
      `${MXN(f.estTotal).padStart(13)}  ${MXN(f.estPorCob).padStart(13)}  ${MXN(f.estPag).padStart(13)}`);
  }
  const totEst = filas.reduce((t, f) => t + f.estTotal, 0);
  const totPag = filas.reduce((t, f) => t + f.estPag, 0);
  const nConEst = filas.filter((f) => f.nEst > 0).length;
  const nConDinero = filas.filter((f) => f.estTotal > 0).length;
  console.log(`\nObras con al menos una estimación capturada: ${nConEst} de ${filas.length}`);
  console.log(`Obras con estimado mayor que cero:           ${nConDinero} de ${filas.length}`);
  console.log(`Estimado de toda la cartera:                 ${MXN(totEst)}`);
  console.log(`PAGADO de toda la cartera (3ª serie de la gráfica de gobierno): ${MXN(totPag)}`);
  const todosLosEstatus = {};
  for (const f of filas) for (const [k, n] of Object.entries(f.estatus)) todosLosEstatus[k] = (todosLosEstatus[k] || 0) + n;
  console.log(`Estatus presentes: ${Object.entries(todosLosEstatus).map(([k, n]) => `${k}×${n}`).join(', ') || '(ninguno)'}`);

  console.log('\n══ 2 · ALMACÉN — lo que hace que `am` (sin almacén) ≠ `me` (con almacén) ══\n');
  console.log('obra  nombre                             renglones  con importe  almacén');
  for (const f of filas) {
    console.log(`${f.id}  ${f.nombre.padEnd(34)} ${String(f.nMat).padStart(9)}  ` +
      `${String(f.nMatActivos).padStart(11)}  ${MXN(f.alm).padStart(13)}`);
  }
  const nConAlm = filas.filter((f) => f.alm > 0).length;
  console.log(`\nObras donde el almacén separa las dos cifras: ${nConAlm} de ${filas.length}`);
  console.log(`Almacén de toda la cartera: ${MXN(filas.reduce((t, f) => t + f.alm, 0))}`);

  console.log('\n══ 3 · PLANTILLA — la procedencia, que es lo único que el KPI no trae ══\n');
  console.log('obra  nombre                             forma         sem  última    partes  dir  ind  sin semana');
  for (const f of filas) {
    console.log(`${f.id}  ${f.nombre.padEnd(34)} ${f.forma.padEnd(13)} ` +
      `${String(f.nSemanas).padStart(3)}  ${String(f.ultClave ?? '—').padStart(8)}  ` +
      `${String(f.partesUlt).padStart(6)}  ${String(f.dir).padStart(3)}  ${String(f.ind).padStart(3)}  ` +
      `${String(f.sinClave).padStart(10)}`);
  }
  const nMultiParte = filas.filter((f) => f.partesUlt > 1).length;
  const nSinNomina = filas.filter((f) => f.nSemanas === 0).length;
  const nSinClave = filas.filter((f) => f.sinClave > 0).length;
  console.log(`\nObras sin ninguna semana de nómina:        ${nSinNomina} de ${filas.length}`);
  console.log(`Obras cuya última semana se sumó de >1 archivo (el badge «N partes · sumadas»): ${nMultiParte} de ${filas.length}`);
  console.log(`Obras con cargas SIN número de semana (saldrían primero en la lista): ${nSinClave} de ${filas.length}`);

  // ── 4 ────────────────────────────────────────────────────────────────────
  // Las tres cifras del bloque «Obra ejecutada vs Estimaciones» y las del
  // bloque de proyección salen todas de estas cuatro columnas. Van juntas
  // porque la pregunta de B.1 («¿qué se perdería?») y la de B.2 («¿el divisor
  // está mal?») se contestan con los mismos números.
  console.log('\n══ 4 · EJECUTADO · ESTIMADO · PRESUPUESTO — y el divisor de B.2 ══\n');
  console.log('obra  presupuesto      ejecutado (am)   estimado         pendiente am    presup−est      part');
  for (const f of filas) {
    console.log(`${f.id}  ${MXN(f.presupuesto).padStart(15)}  ${MXN(f.am).padStart(15)}  ` +
      `${MXN(f.estTotal).padStart(15)}  ${MXN(Math.max(f.presupuesto - f.am, 0)).padStart(14)}  ` +
      `${MXN(Math.max(f.presupuesto - f.estTotal, 0)).padStart(14)}  ${String(f.nSubs).padStart(4)}`);
  }

  console.log('\n══ 5 · PLAZO Y AVANCE FÍSICO — el resto del bloque de proyección ══\n');
  console.log('obra  avance físico  transc.  total  restantes  vencido  sem.rest');
  for (const f of filas) {
    const p = f.plazo || {};
    console.log(`${f.id}  ${(`${(f.af ?? 0).toFixed(1)}%`).padStart(13)}  ` +
      `${String(p.transcurridos ?? '—').padStart(7)}  ${String(p.totalDias ?? '—').padStart(5)}  ` +
      `${String(p.restantes ?? '—').padStart(9)}  ${String(p.vencidoDias ?? '—').padStart(7)}  ` +
      `${String(p.semanasRestantes ?? '—').padStart(8)}`);
  }

  // ── 6 ────────────────────────────────────────────────────────────────────
  // El ritmo de hoy es el promedio de TODO el plazo; B.2 pide el de las
  // últimas N semanas con N contado. Esto mide si ese N existe, obra por obra,
  // y si las dos velocidades —ejecutar y estimar— se pueden separar.
  console.log('\n══ 6 · HISTORIAL SEMANAL — ¿hay con qué calcular «las últimas N semanas»? ══\n');
  console.log('obra  cortes  c/ejec  c/est  c/pag  tramo               ritmo ejec (N)      ritmo est (N)');
  for (const f of filas) {
    const r = (x) => (x ? `${MXN(x.ritmo)}/sem (${x.sem}s)` : 'no se puede');
    console.log(`${f.id}  ${String(f.nHist).padStart(6)}  ${String(f.conEjec).padStart(6)}  ` +
      `${String(f.conEst).padStart(5)}  ${String(f.conPag).padStart(5)}  ${f.tramo.padEnd(18)}  ` +
      `${r(f.ritmoEjec4).padStart(18)}  ${r(f.ritmoEst4).padStart(18)}`);
  }
  console.log(`\nObras sin ningún corte semanal:                        ${filas.filter(f => f.nHist === 0).length} de ${filas.length}`);
  console.log(`Obras sin dos cortes con monto (no hay ritmo reciente): ${filas.filter(f => !f.ritmoEjec4).length} de ${filas.length}`);
  console.log(`Obras sin corte de estimaciones en el historial:        ${filas.filter(f => f.conEst === 0).length} de ${filas.length}`);

  // ── 7 ────────────────────────────────────────────────────────────────────
  // La aritmética de B.2, con la obra que la produjo. El medidor no la
  // reproduce de memoria: recalcula las tres cuentas —la de hoy, la propuesta
  // y la corregida— con los números de producción, para que la diferencia se
  // vea en vez de afirmarse.
  console.log('\n══ 7 · EL DIVISOR DE B.2, LAS TRES CUENTAS ══\n');
  console.log('obra  hoy: (presup−est)/ritmo   propuesta: (presup−am)/ritmo   atraso hoy  atraso propuesta');
  for (const f of filas) {
    const p = f.plazo || {};
    const trans = p.transcurridos || 0;
    // El ritmo que la tarjeta usa HOY: todo el ejecutado entre todo el plazo
    // corrido. No es el de las últimas N semanas; por eso están los dos.
    const ritmoHoy = (f.am > 0 && trans > 0) ? f.am / (trans / 7) : 0;
    const semHoy = ritmoHoy > 0 ? Math.max(f.presupuesto - f.estTotal, 0) / ritmoHoy : null;
    const semProp = ritmoHoy > 0 ? Math.max(f.presupuesto - f.am, 0) / ritmoHoy : null;
    const atraso = (s) => (s == null || p.restantes == null) ? '—'
      : `${Math.round(s * 7) - p.restantes > 0 ? '+' : ''}${Math.round(s * 7) - p.restantes} d`;
    console.log(`${f.id}  ${(semHoy == null ? 'no se puede' : `${semHoy.toFixed(1)} sem`).padStart(22)}   ` +
      `${(semProp == null ? 'no se puede' : `${semProp.toFixed(1)} sem`).padStart(27)}   ` +
      `${atraso(semHoy).padStart(10)}  ${atraso(semProp).padStart(17)}`);
  }
})();
