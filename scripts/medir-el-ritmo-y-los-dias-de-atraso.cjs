#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿CUÁL ES EL RITMO, Y CUÁNTOS DÍAS DE ATRASO SALEN DE ÉL? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El bloque «Proyección al término» va a quedarse con UN veredicto:
// «+N días» o «−N días». Ese número sale de dividir lo que falta por un ritmo,
// y hoy hay al menos tres ritmos distintos que se podrían llamar igual:
//
//   A) EL DE LA APP HOY — `src/App.jsx:14300`: `am / (plazoTranscurrido/7)`.
//      Promedia TODO el plazo corrido desde el inicio de la obra, incluidas
//      las semanas en que no se avanzó nada porque la obra no había arrancado.
//   B) EL DE LAS ÚLTIMAS N SEMANAS CERRADAS — las que tienen `fechaCierre`,
//      que son las oficiales.
//   C) EL DE LAS ÚLTIMAS N SEMANAS CUALESQUIERA — incluye los cortes
//      `intermedio`, que no están cerrados y pueden cambiar.
//
// Son tres números, no tres formas de decir el mismo. Y el rótulo que se pidió
// —«al ritmo de las últimas N semanas»— describe B o C, no A. Poner ese rótulo
// sobre el ritmo A sería rotular una cuenta con el nombre de otra.
//
// QUÉ SE MIDE, Y POR QUÉ ESO:
//
//   1. LOS TRES RITMOS, lado a lado, por obra.
//   2. LOS DÍAS DE ATRASO que salen de cada uno. Si el veredicto cambia de
//      signo o de magnitud según el ritmo, entonces la elección del ritmo NO
//      es un detalle de implementación: es la conclusión.
//   3. CUÁNTAS SEMANAS HAY PARA PROMEDIAR. Una obra con cero cortes no tiene
//      ritmo B ni C, y entonces el bloque no puede proyectar: tiene que
//      decirlo. Con un solo corte tampoco: un ritmo necesita dos puntos.
//   4. LA TARJETA «Semanas p/ facturar todo» (`src/App.jsx:14312-14313`), que
//      divide `presupuesto − totalEstimado` entre el ritmo de EJECUCIÓN. Son
//      dos velocidades distintas en un cociente, y se mide cuánto se desvía
//      del número que saldría de la cuenta que su rótulo promete.
//
// SÓLO LEE, Y NO POR DISCIPLINA SINO POR CONSTRUCCIÓN. La única función de red
// de este archivo es `leer()`, y hace GET. No hay PATCH, ni POST, ni DELETE, ni
// `firebase-admin` —que es el que trae `.set()` detrás—.
//
// NO REIMPLEMENTA. El plazo y el ejecutado salen de `src/App.jsx` por
// `fuenteDeApp` y se EJECUTAN. Lo único que este guion calcula por su cuenta
// son los ritmos B y C, porque esa cuenta todavía no existe en la app: es
// justo lo que la medición tiene que decidir si vale la pena escribir.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-el-ritmo-y-los-dias-de-atraso.cjs --prod
//
// Contra el emulador:
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-el-ritmo-y-los-dias-de-atraso.cjs

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { fuenteDeApp } = require('./extraer-de-app.cjs');

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-el-ritmo-y-los-dias-de-atraso.cjs --prod\n');
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

// ── REST → JavaScript ──────────────────────────────────────────────────────
function valor(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return objeto(v.mapValue.fields || {});
  return undefined;
}
const objeto = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, valor(v)]));

// ── EL CÓDIGO VIVO DE LA APP ───────────────────────────────────────────────
const PEDIDOS = ['plazoDeObra', 'desgloseEjecutado', 'avanceFisicoPonderado'];
let APP;
try {
  const { cuerpo } = fuenteDeApp(PEDIDOS);
  APP = new Function('"use strict";\n' + cuerpo +
    '\nreturn { plazoDeObra, desgloseEjecutado, avanceFisicoPonderado };')();
} catch (e) {
  console.error(`\nNO ARRANCÓ: ${e.message}`);
  console.error('El guion mide con el código de la app; si el símbolo cambió de');
  console.error('nombre, lo que hay que arreglar es la petición, no la medición.\n');
  process.exit(2);
}

const MXN = (n) => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
const M = (n) => n == null ? '  —  ' : '$' + (n / 1e6).toFixed(2) + 'M';

// Días entre dos ISO de día suelto, sin pasar por la zona: `2026-11-06` menos
// `2026-09-26` tiene que dar 41 en cualquier huso.
const diasEntre = (a, b) => Math.round(
  (Date.UTC(...a.slice(0, 10).split('-').map(Number).map((x, i) => i === 1 ? x - 1 : x)) -
   Date.UTC(...b.slice(0, 10).split('-').map(Number).map((x, i) => i === 1 ? x - 1 : x))
  ) / 86400000);

// El ritmo entre el PRIMERO y el ÚLTIMO de una ventana de cortes: la pendiente
// de la recta que los une, no el promedio de los saltos. Con cortes
// irregularmente espaciados —que es lo que hay— promediar los saltos le daría
// el mismo peso a un salto de una semana y a uno de siete.
function ritmoDeVentana(cortes) {
  if (cortes.length < 2) return { ritmo: null, motivo: cortes.length ? 'un solo corte: un ritmo necesita dos puntos' : 'ningún corte semanal' };
  const pri = cortes[0], ult = cortes[cortes.length - 1];
  const dias = diasEntre(ult.fecha, pri.fecha);
  if (dias <= 0) return { ritmo: null, motivo: `los ${cortes.length} cortes caen el mismo día` };
  const delta = ult.ejec - pri.ejec;
  return { ritmo: delta / (dias / 7), dias, delta, semanas: dias / 7, de: pri.id, a: ult.id };
}

const atrasoDe = (pendiente, ritmo, plazoRest) => {
  if (!ritmo || ritmo <= 0) return null;
  return Math.round((pendiente / ritmo) * 7) - plazoRest;
};

const VENTANA = Number(process.env.VENTANA || 4);

(async () => {
  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];

  console.log(`Obras leídas: ${docs.length} · ventana pedida: últimas ${VENTANA} semanas\n`);

  const filas = [];

  for (const d of docs) {
    const id = d.name.split('/').pop();
    const raiz = objeto(d.fields);
    if (raiz.estado === 'archivada') continue;

    const [infoD, subsD, histD, estD] = await Promise.all([
      leer(`obras/${id}/config/info`),
      leer(`obras/${id}/avance/subs`),
      leer(`obras/${id}/avance/historial`),
      leer(`obras/${id}/config/estimaciones`),
    ]);

    const info = infoD ? objeto(infoD.fields) : {};
    const obra = { ...raiz, ...info, id };
    const subs = subsD ? (objeto(subsD.fields).data || []) : [];
    const ests = estD ? (objeto(estD.fields).data || []) : [];
    const semanas = histD ? (objeto(histD.fields).semanas || []) : [];

    const pz = APP.plazoDeObra(obra);
    const des = APP.desgloseEjecutado(subs, obra);
    const am = des.total;
    const ppto = Number(obra.presupuesto) || 0;
    const totalEst = ests.reduce((s, e) => s + (Number(e.importe) || 0), 0);

    // A) el ritmo que la app imprime hoy
    const trans = Math.max(pz.transcurridos, 1);
    const ritmoApp = am > 0 && trans > 0 ? am / (trans / 7) : 0;

    // Los cortes, ordenados por la fecha con la que se guardaron. `fechaCierre`
    // sólo la traen los oficiales; los intermedios se fechan por `fechaCaptura`.
    const orden = (s) => s.fechaCierre || s.fechaCaptura || '';
    const todos = semanas
      .map(s => ({ id: s.id, fecha: orden(s), ejec: Number(s.montoEjecutado) || 0, cerrado: !!s.fechaCierre }))
      .filter(s => s.fecha)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const cerrados = todos.filter(s => s.cerrado);

    // B) y C) — las últimas `VENTANA` semanas. Se toman VENTANA+1 cortes
    // porque un ritmo de N semanas necesita los dos extremos del intervalo.
    const rB = ritmoDeVentana(cerrados.slice(-(VENTANA + 1)));
    const rC = ritmoDeVentana(todos.slice(-(VENTANA + 1)));

    const pend = Math.max(ppto - am, 0);
    const faltaEst = Math.max(ppto - totalEst, 0);

    filas.push({
      id, nombre: (obra.nombre || '—').slice(0, 30), ppto, am, totalEst,
      pz, ritmoApp, rB, rC, pend, faltaEst,
      cortes: todos.length, cerrados: cerrados.length,
      // lo que imprime hoy la tarjeta, tal cual
      semsParaEstImpreso: ritmoApp > 0 ? Math.ceil(faltaEst / ritmoApp) : null,
      semsPendReal: ritmoApp > 0 ? pend / ritmoApp : null,
      pondera: APP.avanceFisicoPonderado(subs, obra),
    });
  }

  // ── 1. LOS TRES RITMOS ────────────────────────────────────────────────────
  console.log('obra   cortes  cerr.  ritmo A (app)  ritmo B (cerradas)  ritmo C (todas)');
  console.log('─'.repeat(84));
  for (const f of filas) {
    console.log(`${f.id.padEnd(6)} ${String(f.cortes).padStart(5)}  ${String(f.cerrados).padStart(5)}  ` +
      `${M(f.ritmoApp).padStart(13)}  ${M(f.rB.ritmo).padStart(18)}  ${M(f.rC.ritmo).padStart(15)}`);
  }

  // ── 2. LOS DÍAS DE ATRASO SEGÚN CADA RITMO ────────────────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('Los días de atraso, uno por ritmo. El veredicto es el que cambia.');
  console.log('');
  console.log('obra   plazo rest.   pendiente    atraso con A   con B      con C');
  console.log('─'.repeat(84));
  const rot = (n) => n == null ? 'no se puede' : (n > 0 ? `+${n}` : String(n));
  for (const f of filas) {
    const pr = f.pz.restantes ?? 0;
    console.log(`${f.id.padEnd(6)} ${String(pr).padStart(11)}   ${M(f.pend).padStart(9)}    ` +
      `${rot(atrasoDe(f.pend, f.ritmoApp, pr)).padStart(12)}   ` +
      `${rot(atrasoDe(f.pend, f.rB.ritmo, pr)).padStart(9)}  ` +
      `${rot(atrasoDe(f.pend, f.rC.ritmo, pr)).padStart(9)}`);
  }

  // ── 3. QUÉ OBRAS NO PUEDEN PROYECTAR ──────────────────────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('¿De qué obras NO se puede sacar el ritmo de las últimas semanas?');
  console.log('');
  for (const f of filas) {
    if (f.rC.ritmo != null && f.rB.ritmo != null) continue;
    console.log(`  ${f.id} ${f.nombre}`);
    if (f.rB.ritmo == null) console.log(`       cerradas: ${f.rB.motivo}`);
    if (f.rC.ritmo == null) console.log(`       todas:    ${f.rC.motivo}`);
  }
  const sinB = filas.filter(f => f.rB.ritmo == null).length;
  const sinC = filas.filter(f => f.rC.ritmo == null).length;
  console.log('');
  console.log(`  Sin ritmo B (semanas cerradas): ${sinB} de ${filas.length}`);
  console.log(`  Sin ritmo C (todas):            ${sinC} de ${filas.length}`);
  if (sinB || sinC) {
    console.log('');
    console.log('  Ésas son las obras en las que el bloque TIENE que decir que no');
    console.log('  proyecta. Una recta trazada desde un punto no es una proyección.');
  }

  // ── 4. LA TARJETA «Semanas p/ facturar todo» ──────────────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('«Semanas p/ facturar todo» — `src/App.jsx:14312-14313`');
  console.log('');
  console.log('La tarjeta divide `presupuesto − ESTIMADO` entre el ritmo de EJECUCIÓN.');
  console.log('Al lado, lo que saldría de dividir el PENDIENTE DE EJECUTAR por el mismo');
  console.log('ritmo: es la cuenta cuyo número alimenta los días de atraso.');
  console.log('');
  console.log('obra   estimado      impreso   pendiente de ejecutar   difer.');
  console.log('─'.repeat(84));
  for (const f of filas) {
    const imp = f.semsParaEstImpreso;
    const real = f.semsPendReal;
    const dif = (imp != null && real != null) ? imp - real : null;
    console.log(`${f.id.padEnd(6)} ${M(f.totalEst).padStart(9)}  ` +
      `${(imp != null ? `~${imp} sem` : '—').padStart(10)}  ` +
      `${(real != null ? `${real.toFixed(1)} sem` : '—').padStart(21)}   ` +
      `${dif != null ? (dif > 0 ? `+${dif.toFixed(1)}` : dif.toFixed(1)) + ' sem' : '—'}`);
  }

  const sinEstimar = filas.filter(f => f.totalEst === 0);
  console.log('');
  if (sinEstimar.length) {
    console.log(`  ${sinEstimar.length} obra(s) con CERO estimado: ${sinEstimar.map(f => f.id).join(', ')}.`);
    console.log('  En ésas `presupuesto − estimado` ES el presupuesto entero, y la');
    console.log('  tarjeta imprime el contrato completo dividido por el ritmo. El error');
    console.log('  no es que ignore el ejecutado: es que resta lo ESTIMADO, que vale');
    console.log('  cero, y luego divide por la velocidad de EJECUTAR. Dos velocidades');
    console.log('  en un cociente, y el resultado tranquiliza.');
  }

  // ── EL DETALLE DE LAS VENTANAS, PARA PODER DISCUTIRLO ─────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('De dónde sale cada ritmo B/C — los dos extremos de la ventana');
  console.log('');
  for (const f of filas) {
    console.log(`  ${f.id} ${f.nombre}`);
    for (const [eti, r] of [['B cerradas', f.rB], ['C todas   ', f.rC]]) {
      if (r.ritmo == null) { console.log(`     ${eti}  — ${r.motivo}`); continue; }
      console.log(`     ${eti}  ${r.de} → ${r.a} · ${r.dias} días (${r.semanas.toFixed(1)} sem) · ` +
        `${MXN(r.delta)} · ${M(r.ritmo)}/sem`);
    }
    console.log(`     A app      ${f.pz.transcurridos} días transcurridos · ${MXN(f.am)} · ${M(f.ritmoApp)}/sem`);
  }
  console.log('');
})();
