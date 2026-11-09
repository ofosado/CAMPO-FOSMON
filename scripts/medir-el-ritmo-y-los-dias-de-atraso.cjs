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
const PEDIDOS = ['plazoDeObra', 'desgloseEjecutado', 'avanceFisicoPonderado',
  'atrasoProyectado', 'kpiDesviacionPlazo', 'tendenciaDeRitmo',
  'frasePorQueSinDesviacion', 'VENTANA_RITMO', 'CIERRES_MINIMOS',
  'estadoPorSemana', 'sonComparables', 'lunesDeClaveSemana'];
let APP;
try {
  const { cuerpo } = fuenteDeApp(PEDIDOS);
  APP = new Function('"use strict";\n' + cuerpo +
    `\nreturn { ${PEDIDOS.join(', ')} };`)();
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
    const ppto = Number(obra.presupuesto) || 0;
    // LAS FIRMAS, NO LO QUE PARECÍAN. `desgloseEjecutado(subs, modoVol)` y
    // `avanceFisicoPonderado(subs, contrato, modoVol)` reciben un BOOLEANO y un
    // NÚMERO en el segundo hueco; este guion les pasaba `obra` a las dos. El
    // objeto es truthy, así que el ejecutado se medía en modo volumen —otra
    // definición—, y como `obra` no es `> 0`, el avance ponderado salía 0 en
    // las siete obras. Ninguna de las dos cosas da error: dan una cifra.
    const des = APP.desgloseEjecutado(subs);
    const am = des.total;
    // EL CAMPO ES `monto`. Esto decía `importe`, que no existe en ningún
    // documento, así que la sección 4 imprimía «7 obras con CERO estimado» y
    // razonaba sobre ese cero: con tres estimaciones por $75M en la 0127, la
    // medición afirmaba que no se había estimado nada. Un campo mal escrito no
    // da error, da cero, y un cero se lee como una medición.
    const totalEst = ests.reduce((s, e) => s + (Number(e.monto) || 0), 0);

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
      avance: APP.avanceFisicoPonderado(subs, ppto),
      excedente: des.excedente,
      // Lo que la maquinaria de #114 dice hoy, sin reimplementarla.
      proy: APP.atrasoProyectado(obra, info, semanas, APP.avanceFisicoPonderado(subs, ppto)),
      // La MISMA ventana que usa `proyeccionDeAvance`, reconstruida con sus
      // mismas dos reglas —comparables con el último, y las últimas
      // `VENTANA_RITMO`— para poder mirar sus extremos en las dos unidades.
      ventana: (() => {
        const est = APP.estadoPorSemana(semanas);
        if (!est.length) return [];
        const ult = est[est.length - 1];
        return est.filter(e => APP.sonComparables(e.cierre, ult.cierre, 'avance') && e.avance !== null)
          .slice(-APP.VENTANA_RITMO);
      })(),
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

  // ── 5. LA MAQUINARIA QUE YA EXISTE, Y SI SE PUEDE DECIR EN PESOS ──────────
  //
  // `proyeccionDeAvance` (#114, desplegada) ya contesta la pregunta de B.2, pero
  // en PUNTOS DE AVANCE por semana. El mandato la plantea en PESOS. Si el bloque
  // nuevo inventa una cuenta en pesos, habrá DOS respuestas a «¿cuántos días
  // llevamos de atraso?», y entonces el tablero y la tarjeta de la dependencia
  // podrán discrepar. Lo que se mide aquí es si la presentación en pesos se
  // DERIVA de la cuenta que ya existe —pp/sem × contrato/100— o si es otra
  // cuenta disfrazada: si los dos ritmos no coinciden, el peso no es una
  // traducción del punto, y hay que decir cuál manda.
  console.log('');
  console.log('─'.repeat(84));
  console.log('`atrasoProyectado` + `kpiDesviacionPlazo` — lo que la app YA calcula');
  console.log('');
  console.log(`VENTANA_RITMO = ${APP.VENTANA_RITMO} cierres · CIERRES_MINIMOS = ${APP.CIERRES_MINIMOS}`);
  console.log('');
  console.log('obra   avance   veredicto   N (semanasBase)   fecha fin proy.   razón si no');
  console.log('─'.repeat(84));
  for (const f of filas) {
    const p = f.proy || {};
    const k = APP.kpiDesviacionPlazo(p);
    console.log(`${f.id.padEnd(6)} ${(f.avance.toFixed(1) + '%').padStart(6)}   ` +
      `${String(k.valor).padStart(9)}   ${String(p.semanasBase ?? '—').padStart(15)}   ` +
      `${String(p.fechaFin || '—').padStart(15)}   ${p.razon || ''}`);
  }

  console.log('');
  console.log('El `sub` que ya se publica, textual:');
  for (const f of filas) {
    const k = APP.kpiDesviacionPlazo(f.proy || {});
    console.log(`  ${f.id}  «${k.valor}» · ${k.sub}`);
  }

  console.log('');
  console.log('─'.repeat(84));
  console.log('¿El ritmo en PESOS es una traducción del ritmo en PUNTOS?');
  console.log('');
  console.log('  pp/sem × contrato/100  contra  el ritmo en pesos DE LA MISMA VENTANA.');
  console.log('');
  console.log('  La columna «ritmo B» de la sección 1 NO sirve para esto, y creerlo');
  console.log('  costó una conclusión equivocada: B toma `cerrados.slice(-5)` y la');
  console.log('  proyección toma `comparables.slice(-4)`, así que en la 0112 una mira');
  console.log('  S34→S44 y la otra S39→S44. Comparar dos UNIDADES sobre dos VENTANAS');
  console.log('  distintas no mide la unidad: mide la ventana. Aquí el dinero sale de');
  console.log('  los mismos dos cierres que el avance.');
  console.log('');
  console.log('obra   pp/sem   traducido a pesos   pesos de esa ventana   difer.');
  console.log('─'.repeat(84));
  for (const f of filas) {
    const p = f.proy || {};
    if (p.velocidad == null) { console.log(`${f.id.padEnd(6)}       —   (no proyecta: ${p.razon})`); continue; }
    const trad = p.velocidad / 100 * f.ppto;
    const base = f.ventana;
    const pri = base[0], ult = base[base.length - 1];
    // El MISMO espaciado que `ritmoEntreCierres`: lunes ISO de la clave, no la
    // fecha en que alguien cerró. Midiendo con `fechaCierre` la 0112 salía 20%
    // fuera —S39→S44 son 5 semanas de calendario y sus cierres se firmaron con
    // 6 de diferencia— y ese 20% se habría leído como desacuerdo entre las
    // unidades cuando era desacuerdo entre dos formas de contar semanas.
    const tramos = Math.max(Math.round(
      (APP.lunesDeClaveSemana(ult.clave) - APP.lunesDeClaveSemana(pri.clave)) / (7 * 86400000)), 1);
    const enPesos = ((ult.dinero || 0) - (pri.dinero || 0)) / tramos;
    const dif = enPesos ? (trad - enPesos) / enPesos * 100 : null;
    console.log(`${f.id.padEnd(6)} ${p.velocidad.toFixed(2).padStart(6)}   ${M(trad).padStart(17)}   ` +
      `${M(enPesos).padStart(20)}   ${dif == null ? '—' : (dif > 0 ? '+' : '') + dif.toFixed(1) + '%'}`);
  }

  // ── 5b. LA MISMA VENTANA, LAS DOS UNIDADES ────────────────────────────────
  //
  // La comparación de arriba cruza dos ventanas distintas, y así no se puede
  // concluir nada: la diferencia podría ser de la ventana y no de la unidad.
  // Aquí los dos números salen de los MISMOS dos cierres —los extremos de la
  // ventana que usa `proyeccionDeAvance`— y de los dos campos que
  // `estadoPorSemana` ya trae en cada uno: `avance` (`avancePonderado`) y
  // `dinero` (`montoEjecutadoSnap`). Si con los mismos extremos el avance se
  // movió 7 puntos y el dinero 28% del contrato, la unidad no es una
  // traducción de la otra, y la causa es el TOPE: el avance está topado al
  // 100% y el dinero no, así que el excedente de una partida son pesos que ya
  // no mueven el porcentaje.
  console.log('');
  console.log('─'.repeat(84));
  console.log('Los MISMOS dos cierres, medidos en puntos y en dinero');
  console.log('');
  console.log('obra   ventana          Δ avance   Δ dinero (del contrato)   excedente hoy');
  console.log('─'.repeat(84));
  for (const f of filas) {
    const p = f.proy || {};
    if (p.velocidad == null) { console.log(`${f.id.padEnd(6)} no proyecta (${p.razon})`); continue; }
    const base = f.ventana;
    if (!base || base.length < 2) { console.log(`${f.id.padEnd(6)} sin ventana`); continue; }
    const pri = base[0], ult = base[base.length - 1];
    const dAv = ult.avance - pri.avance;
    const dDin = (ult.dinero || 0) - (pri.dinero || 0);
    const dDinPct = f.ppto > 0 ? dDin / f.ppto * 100 : 0;
    console.log(`${f.id.padEnd(6)} ${(pri.clave + '→' + ult.clave).padEnd(16)} ` +
      `${(dAv.toFixed(1) + ' pp').padStart(8)}   ` +
      `${(M(dDin) + ' = ' + dDinPct.toFixed(1) + ' pp').padStart(23)}   ` +
      `${M(f.excedente)}`);
  }
  console.log('');
  console.log('  Las dos últimas columnas son el mismo intervalo en dos unidades. Donde');
  console.log('  no coinciden, el contrato ya está ejercido y el dinero que sigue');
  console.log('  entrando es excedente: avanza el gasto, no la obra.');

  // ── 6. LAS OBRAS YA VENCIDAS ──────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('Obras cuyo plazo YA se agotó. «+N días al ritmo actual» no es el');
  console.log('veredicto de una obra que debió terminar hace tres meses: el atraso');
  console.log('ya no es una proyección, es un hecho medido.');
  console.log('');
  for (const f of filas) {
    if ((f.pz.restantes ?? 0) > 0) continue;
    console.log(`  ${f.id} ${f.nombre}  fin ${f.pz.finVigente}` +
      `${f.pz.ampliado ? ' (ampliado)' : ''} · ${f.pz.transcurridos} de ${f.pz.totalDias} días` +
      ` · avance ${f.avance.toFixed(1)}%`);
  }

  // ── 7. LAS CUATRO TARJETAS DE HOY, TAL CUAL SALEN ─────────────────────────
  //
  // Para poder decir «esto es lo que decía antes» con la cifra, no con el
  // recuerdo. `pctProy` es la tarjeta «Proyección al fin», que se va porque
  // contesta lo mismo que los días de atraso y peor; al lado, el veredicto que
  // se queda. Donde los dos no coinciden en el signo, la tarjeta que se va
  // estaba diciendo otra cosa.
  console.log('');
  console.log('─'.repeat(84));
  console.log('Las cuatro tarjetas de hoy — `src/App.jsx` bloque «Proyección al término»');
  console.log('');
  console.log('obra   plazo          ritmo/sem   Proy. al fin   Sem p/fact.   veredicto nuevo');
  console.log('─'.repeat(84));
  for (const f of filas) {
    const semRest = (f.pz.restantes ?? 0) / 7;
    const proyFin = f.am + f.ritmoApp * semRest;
    const pctProy = f.ppto > 0 ? proyFin / f.ppto * 100 : 0;
    const k = APP.kpiDesviacionPlazo(f.proy || {});
    console.log(`${f.id.padEnd(6)} ${(f.pz.transcurridos + '/' + f.pz.totalDias + ' d').padEnd(14)} ` +
      `${M(f.ritmoApp).padStart(9)}   ${(pctProy.toFixed(1) + '%').padStart(12)}   ` +
      `${(f.semsParaEstImpreso != null ? '~' + f.semsParaEstImpreso + ' sem' : '—').padStart(11)}   ` +
      `${k.valor}`);
  }
  console.log('');
  console.log('  «Proyección al fin» pasa del 100% en toda obra con plazo restante y');
  console.log('  ritmo, porque extrapola el ritmo del plazo ENTERO sobre lo que queda.');
  console.log('  No es un segundo veredicto equivocado: es el mismo veredicto contado');
  console.log('  con el ritmo A, el que promedia las semanas en que la obra no había');
  console.log('  arrancado.');

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
