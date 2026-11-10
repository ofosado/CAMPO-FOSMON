#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL DOCUMENTO INTERNO DE COTEA DICE LO QUE SABE Y DECLARA LO QUE NO
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que el papel IMPRIME. Nada de que `generarPDFInterno`
// exista: el generador se saca de `src/App.jsx`, se mueve sobre un jsPDF de
// mentira y lo que se mira es el texto que manda a la hoja, con su página.
//
// POR QUÉ ESTE DOCUMENTO NECESITA SU PROPIO BANCO. Es el papel al revés del
// reporte ejecutivo: aquél se calla lo que no puede afirmar porque se entrega
// al cliente, y éste lo PUBLICA porque se lee hacia adentro y un hueco es lo
// que sirve para ir a cerrarlo. Los dos criterios son opuestos, así que un
// banco que midiera los dos a la vez tendría que elegir uno.
//
// LAS CINCO AFIRMACIONES:
//
//   A. ES DE COTEA Y DICE QUE ES INTERNO, EN CADA PÁGINA. El sello no vive sólo
//      en la portada: una hoja suelta de este papel tiene que decir lo que es
//      sin la portada al lado. Y el nombre de la organización aparece como
//      VALOR de un campo de identificación, nunca como marca del documento.
//
//   B. NINGUNA CIFRA NUEVA. El gasto y el margen que imprime son, letra por
//      letra, los que `presentacionEconomiaObra` ya resolvió para la pantalla.
//      El banco los calcula con la MISMA función y exige la coincidencia: si el
//      generador se pusiera a formatear por su cuenta, el papel y el tablero
//      podrían discrepar sobre la misma obra el mismo día.
//
//   C. EL MARGEN SEMANA A SEMANA SALE DE `comportamientoDelMargen`, con la
//      ventana de DOCE semanas del tablero. Un renglón por semana del tramo, y
//      el cambio en PUNTOS PORCENTUALES. Cuando no hay tramo NO se dibuja una
//      tabla vacía ni se imprime un cero: se imprime el motivo.
//
//   D. LOS TRES ESTADOS DEL RIESGO, LOS TRES IMPRESOS. Detectados con la cifra
//      con la que disparó, no evaluables con el DATO que les faltó, y sin
//      hallazgo NOMBRADOS uno por uno. Más la frase, escrita: una lista vacía
//      no significa que no hay riesgo.
//
//   E. LA FRONTERA. Con el gasto de GP sin medir, el papel no publica un solo
//      porcentaje de margen; y con el gasto llegando SIN FECHA, no publica una
//      tendencia — porque lo que se movería es el gasto alcanzando su serie.
//
// LAS SEMANAS SON LAS DE HOY, no unas fijas: `semanasDeVentana` arma su ventana
// contra el reloj y el gasto de GP se indexa con el año en curso. Un caso con
// semanas tecleadas fallaría al cambiar de año, que es justo la frecuencia con
// la que se culpa al azar.
//
//   node scripts/prueba-el-documento-interno-de-cotea.cjs
//   node scripts/prueba-el-documento-interno-de-cotea.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
// Se piden las que el banco necesita EJECUTAR para armar su expectativa, no
// sólo el generador: la expectativa de B y de C sale de la misma función que
// alimenta la pantalla, así que el banco no tiene una segunda copia de ninguna
// cuenta. El cierre transitivo trae el resto.
const PEDIDOS = ['generarPDFInterno', 'calcularKPIsObra', 'presentacionEconomiaObra',
  'evaluarRiesgos', 'curvaUnicaDeObra', 'comportamientoDelMargen',
  'semanasDeVentana', 'selloDeTiempo', 'SEVERIDADES', 'textoImprimible'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltan.join(', ')}`);
  process.exit(2);
}
let APP;
try {
  APP = new Function('React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
    `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)(...Array(6).fill(() => {}));
} catch (e) {
  console.error(`\nNO ARRANCÓ: no se pudo montar lo extraído de ${archivo}: ${e.message}`);
  process.exit(2);
}
const { generarPDFInterno, calcularKPIsObra, presentacionEconomiaObra, evaluarRiesgos,
        curvaUnicaDeObra, comportamientoDelMargen, semanasDeVentana, selloDeTiempo,
        textoImprimible } = APP;

// LA ÚNICA TRANSFORMACIÓN QUE EL PAPEL LE HACE A LA CADENA DE LA PANTALLA es
// pasarla por la puerta de la fuente: las helvetica estándar de jsPDF sólo
// escriben WinAnsi, así que la flecha del tramo y el menos tipográfico de
// `MXNS` salen como «->» y «-». El banco compara contra `textoImprimible(…)`
// de lo que la pantalla dice, no contra una cadena tecleada: si lo comparara
// con la cadena cruda estaría exigiendo que el papel imprima algo que su
// fuente no sabe escribir, y si lo comparara con una copia tecleada del
// resultado dejaría de ver el día que la pantalla cambie. Ver
// `prueba-el-pdf-escribe-lo-que-se-lee.cjs`, que es donde se afirma la puerta.
const enLaHoja = (s) => textoImprimible(s);

// ── EL ARMADO DE UN CASO ───────────────────────────────────────────────────
const AÑO = new Date().getFullYear();
const MS = Date.UTC(2026, 2, 15, 18, 0, 0);   // 15 mar 2026, 12:00 en México
const SELLO = { ms: MS, fuente: 'servidor' };

// La obra se llama de modo que su nombre NO contenga el nombre de ninguna
// organización: la afirmación A mira cuántas veces aparece «FOSMON» en la hoja
// y un nombre de obra que lo trajera la cumpliría por accidente.
const OBRA_BASE = {
  id: '0131', nombre: 'Centro de convenciones', contrato: 'SIOP-2026-0131',
  cliente: 'H. Ayuntamiento de Coatzacoalcos',
  inicio: `${AÑO - 1}-02-02`, fin: `${AÑO + 1}-06-30`,
  presupuesto: 45000000, gpId: '0131', diasPago: 30,
};

// Las doce semanas de la ventana del documento, pedidas a la MISMA función que
// usa el generador. Tecleadas aquí serían una segunda ventana, y entonces el
// banco mediría una tabla de doce renglones contra una serie de otras doce.
const SEMS = semanasDeVentana(OBRA_BASE, 12);
if (SEMS.length < 5) {
  console.error(`\nNO ARRANCÓ: la ventana salió con ${SEMS.length} semanas; `
    + 'sin tramo no hay tabla de margen que mirar y la §C saldría verde por vacío.');
  process.exit(2);
}
const N = SEMS.length;

// `ejec` y `gastoAcum` son arreglos de largo N. GP guarda el DELTA de cada
// semana, no el acumulado, igual que en la app.
const armar = ({ ejec, gastoAcum, grandTotal = null, conGP = true }) => {
  const obra = { ...OBRA_BASE };
  const historialAvance = [];
  ejec.forEach((m, i) => {
    if (m === null) return;
    historialAvance.push({ tipo: 'oficial', año: AÑO, semana: SEMS[i].sem,
                           avance: 10, avancePonderado: 10, montoEjecutado: m });
  });
  const semanasGP = {};
  let prev = 0;
  gastoAcum.forEach((g, i) => { semanasGP[`S${SEMS[i].sem}`] = g - prev; prev = g; });
  const gpData = conGP ? {
    ultimaSemana: `S${SEMS[N - 1].sem}`,
    semanasDisponibles: SEMS.map(s => ({ año: s.año, semana: s.sem })),
    obrasPedidas: [OBRA_BASE.gpId],
    obras: { [OBRA_BASE.gpId]: {
      id: OBRA_BASE.gpId, nombre: OBRA_BASE.nombre,
      grandTotal: grandTotal === null ? prev : grandTotal,
      semanas: semanasGP,
    } },
  } : null;
  return { obra, gpData, historialAvance };
};

// EL CATÁLOGO HACE FALTA. `calcularKPIsObra` saca el ejecutado del CATÁLOGO y
// no del historial semanal, así que sin partidas `me` vale cero, el margen sale
// «indefinido» y `pres.margenTxt` es una raya — y entonces la §B afirmaría que
// el papel imprime una raya, que se cumple por vacío. Con catálogo el margen es
// un porcentaje de verdad y la §B puede acotar.
//
// Una sola partida al 70.67% del contrato: deja el ejecutado cerca del último
// punto de la serie semanal, que es la forma de una obra de verdad.
const CATALOGO = [{ id: 'p1', desc: 'Obra civil', imp: 45000000, a: 70.67 }];

// Los datos tal como entran al generador.
const datosDe = (f, extra = {}) => ({
  obra: f.obra, subs: CATALOGO, estimaciones: [], maquinaria: [], materiales: [],
  subcontratos: [], historialAvance: f.historialAvance, gpData: f.gpData,
  gpDetalle: null, otrosGastos: [], nominaHistorial: [], programa: null,
  instante: SELLO, organizacion: 'FOSMON Construcciones',
  generadoPor: 'demo@fosmon.com.mx', ...extra,
});

// Lo que el banco espera, sacado de las funciones de verdad con los MISMOS
// insumos que recibe el generador.
const esperadoDe = (d) => {
  const kpis = calcularKPIsObra(d.obra, d.subs, d.maquinaria, d.materiales,
                                d.estimaciones, d.gpData, d.otrosGastos);
  const curva = curvaUnicaDeObra({ semanas: SEMS, obra: d.obra,
    historialAvance: d.historialAvance, subs: d.subs, gpData: d.gpData,
    otrosGastos: d.otrosGastos, maquinaria: d.maquinaria, programa: d.programa });
  const cm = comportamientoDelMargen(curva);
  const kpisCtx = { gt: kpis.gt, am: kpis.am, alm: kpis.alm, me: kpis.me,
                    af: kpis.af, diff: kpis.diff, mpct: kpis.mpct,
                    pctGasto: kpis.pctGasto, brecha: kpis.brecha };
  const veredicto = evaluarRiesgos({
    obra: d.obra, subs: d.subs, maquinaria: d.maquinaria, materiales: d.materiales,
    estimaciones: d.estimaciones, subcontratos: d.subcontratos,
    historialAvance: d.historialAvance, gpData: d.gpData, kpis: kpisCtx,
    nominaHistorial: d.nominaHistorial, programa: d.programa,
    comportamientoMargen: cm,
  });
  return { kpis, pres: presentacionEconomiaObra(kpis), curva, cm, veredicto };
};

const dibujar = async (d) => {
  let dibujos;
  try { dibujos = await dibujarPDFInterno(generarPDFInterno, d); }
  catch (e) {
    console.error(`\nNO ARRANCÓ: el documento no se pudo dibujar: ${e.message}`);
    process.exit(2);
  }
  if (dibujos.length < 40) {
    console.error(`\nNO ARRANCÓ: el documento sólo dibujó ${dibujos.length} textos; `
      + 'con la hoja casi vacía cualquier «no aparece» se cumple por vacío.');
    process.exit(2);
  }
  return dibujos;
};

// ── LOS TRES CASOS ─────────────────────────────────────────────────────────
// 1 · MEDIDA Y LIMPIA: gasto fechado semana por semana, `grandTotal` igual a la
//     suma de las semanas, y un corte de avance en cada una. Es el caso con
//     tramo: doce renglones de margen.
const sube = (base, paso) => Array.from({ length: N }, (_, i) => base + paso * i);
const LIMPIA = armar({
  ejec:      sube(12000000, 1800000),
  gastoAcum: sube(9000000, 1500000),
});

// 2 · SIN MEDIR: no hay documento de gasto. El margen no se puede afirmar.
const SIN_GP = armar({
  ejec:      sube(12000000, 1800000),
  gastoAcum: sube(9000000, 1500000),
  conGP: false,
});

// 3 · SIN FECHAR: el `grandTotal` de GP es mucho mayor que la suma de las
//     semanas fechadas. Es la forma que el preview encontró en producción: el
//     acumulado semanal arranca casi en cero y el ancla del último punto le
//     mete de golpe lo que nunca estuvo fechado.
const SIN_FECHA = armar({
  ejec:      sube(12000000, 1800000),
  gastoAcum: Array.from({ length: N }, (_, i) => i >= N - 4 ? 2000000 * (i - (N - 5)) : 0),
  grandTotal: 21400000,
});

(async () => {

// ══════════════════════════════════════════════════════════════════════════
// A · ES DE COTEA, Y DICE QUE ES INTERNO EN CADA PÁGINA
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── A · de cotea, e interno en cada hoja ──────────────────────');

const dLimpia = datosDe(LIMPIA);
const hojaLimpia = await dibujar(dLimpia);
const paginas = [...new Set(hojaLimpia.map(x => x.pagina))].sort((a, b) => a - b);
const textosDe = (p) => hojaLimpia.filter(x => x.pagina === p).map(x => x.texto);

ok(paginas.length >= 4,
  `el documento sale de ${paginas.length} páginas`);

// El sello, en TODAS las páginas interiores. La portada lleva el suyo propio
// —en caja, con el nombre de la obra debajo—, así que se mira aparte.
const interiores = paginas.filter(p => p > 1);
const sinSello = interiores.filter(p =>
  !textosDe(p).some(t => /DOCUMENTO INTERNO/.test(t)));
ok(interiores.length > 0 && sinSello.length === 0,
  `las ${interiores.length} páginas interiores llevan el sello de documento interno`
  + (sinSello.length ? ` — sin sello: ${sinSello.join(', ')}` : ''));

const portada = textosDe(1);
ok(portada.some(t => t === 'DOCUMENTO INTERNO')
   && portada.some(t => /no es el reporte que se entrega al cliente/i.test(t)),
  'la portada declara que no es el reporte que se entrega al cliente');

// La marca del papel es cotea, en todas las páginas.
const sinCotea = paginas.filter(p => !textosDe(p).some(t => /cotea/.test(t)));
ok(sinCotea.length === 0,
  'cotea firma todas las páginas'
  + (sinCotea.length ? ` — sin firma: ${sinCotea.join(', ')}` : ''));

// Y la organización aparece como VALOR de un campo, no como marca. Una sola
// vez, en la portada, con su rótulo al lado.
const todos = hojaLimpia.map(x => x.texto);
const vecesOrg = todos.filter(t => /FOSMON Construcciones/.test(t)).length;
ok(vecesOrg === 1 && portada.includes('Organización:')
   && portada.includes('FOSMON Construcciones'),
  `la organización se imprime ${vecesOrg} vez como valor del campo «Organización», no como marca`);

// Sin organización capturada no se rellena con el nombre de nadie.
const hojaSinOrg = await dibujar(datosDe(LIMPIA, { organizacion: null, generadoPor: null }));
const textosSinOrg = hojaSinOrg.map(x => x.texto);
ok(!textosSinOrg.some(t => /FOSMON/.test(t))
   && textosSinOrg.filter(t => t === '(no capturado)').length >= 2,
  'sin organización ni autor capturados, los dos campos se declaran y no se rellenan');

// ══════════════════════════════════════════════════════════════════════════
// B · NINGUNA CIFRA NUEVA: LAS CADENAS SON LAS DE LA PANTALLA
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── B · ninguna cifra nueva ───────────────────────────────────');

const eLimpia = esperadoDe(dLimpia);
ok(eLimpia.pres.gastoSinMedir === false,
  'el caso limpio tiene el gasto de GP medido, que es lo que esta sección necesita para acotar');

// Y el margen del caso limpio es un PORCENTAJE, no una raya: lo que la §B
// afirma de abajo no se puede cumplir por vacío.
ok(eLimpia.pres.margenIndefinido === false && /%$/.test(eLimpia.pres.margenTxt),
  `y un margen afirmable: «${eLimpia.pres.margenTxt}»`);

ok(todos.includes(eLimpia.pres.gastoTxt),
  `el gasto que imprime es el de la pantalla: «${eLimpia.pres.gastoTxt}»`);
ok(todos.includes(eLimpia.pres.margenTxt),
  `el margen que imprime es el de la pantalla: «${eLimpia.pres.margenTxt}»`);
ok(todos.includes(eLimpia.pres.margenAbsTxt),
  `el margen en pesos es el de la pantalla: «${eLimpia.pres.margenAbsTxt}»`);

// El corte, con su origen declarado. Un instante de marzo con la suite
// corriendo cualquier otro día: un sitio que leyera el reloj se vería.
const corte = selloDeTiempo(SELLO).corte;
ok(todos.filter(t => t === corte).length >= 2,
  `el corte del documento sale del sello y declara su origen: «${corte}»`);
const hoyLarga = new Date().toLocaleDateString('es-MX',
  { timeZone: 'America/Mexico_City', day: '2-digit', month: 'long', year: 'numeric' });
if (hoyLarga === selloDeTiempo(SELLO).fecha) {
  console.log('  --   hoy coincide con el instante de prueba; esta comprobación no acota');
} else {
  ok(!todos.some(t => t === hoyLarga),
    'ningún renglón del documento se quedó leyendo el reloj del aparato');
}

// ══════════════════════════════════════════════════════════════════════════
// C · EL MARGEN SEMANA A SEMANA, CON LA VENTANA DEL TABLERO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── C · el margen semana a semana ─────────────────────────────');

const cm = eLimpia.cm;
ok(cm.renglones.length >= 4 && cm.suficiente === true,
  `la serie del caso limpio trae ${cm.renglones.length} semanas de tramo, con las `
  + `${cm.minimo} que pide el reporte`);

// Un renglón por semana del tramo, con su etiqueta. La tabla del margen es la
// única del documento con una columna «Margen %», así que se la pide por ahí.
const tablaMargen = (() => {
  const conCabecera = hojaLimpia.filter(x => x.tabla && x.texto === 'Margen %');
  return conCabecera.length ? conCabecera[0].tabla : null;
})();
if (tablaMargen === null) {
  console.log('FALLA  no hay ninguna tabla con la columna «Margen %» en el documento');
  fallas++;
} else {
  const celdas = hojaLimpia.filter(x => x.tabla === tablaMargen);
  const etiquetas = cm.renglones.map(r => r.label);
  const ausentes = etiquetas.filter(l => !celdas.some(c => c.celda === 0 && c.texto === l));
  ok(ausentes.length === 0,
    `la tabla lleva las ${etiquetas.length} semanas del tramo`
    + (ausentes.length ? ` — faltan ${ausentes.join(', ')}` : ''));

  // Los pesos de cada semana son los de `curva.margen`, no una resta hecha en
  // el generador.
  const pesos = cm.renglones.map(r => Math.round(r.pesos));
  const enHoja = celdas.filter(c => c.celda === 1).map(c => c.texto);
  const sinPeso = pesos.filter(p => !enHoja.some(t =>
    t.replace(/[^\d]/g, '') === String(Math.abs(p))));
  ok(sinPeso.length === 0,
    `los pesos de las ${pesos.length} semanas son los de la curva`
    + (sinPeso.length ? ` — faltan ${sinPeso.length}` : ''));

  // El cambio va en PUNTOS PORCENTUALES y se dice. «cayó 5%» y «cayó 5 pp» son
  // dos cosas y sólo una es la que mide esta columna.
  const cambios = celdas.filter(c => c.celda === 3).map(c => c.texto);
  ok(cambios.filter(t => /pp$/.test(t)).length >= cm.renglones.length - 1,
    'la columna del cambio está rotulada en puntos porcentuales');

  // El primer renglón del tramo no tiene contra qué compararse y lleva raya, no
  // un cero: un «+0.0 pp» ahí diría que no se movió.
  ok(cambios.includes('—'),
    'el primer renglón del tramo declara que no hay cambio que medir, y no imprime cero');
}

// El tramo, en una línea, con las tres cifras de `comportamientoDelMargen`.
const FLECHA = enLaHoja('→');
const tramoTxt = todos.find(t => t.includes(FLECHA) && /pp/.test(t));
ok(!!tramoTxt
   && tramoTxt.includes(`${cm.desde.toFixed(1)}%`)
   && tramoTxt.includes(`${cm.hasta.toFixed(1)}%`),
  `el renglón del tramo dice de cuánto a cuánto: «${tramoTxt || 'no está'}»`);
ok(todos.some(t => new RegExp(`${cm.cola} semanas seguidas`).test(t)),
  `y en cuántas semanas: ${cm.cola}`);

// ══════════════════════════════════════════════════════════════════════════
// D · LOS TRES ESTADOS DEL RIESGO, LOS TRES IMPRESOS
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── D · los tres estados del riesgo ───────────────────────────');

const v = eLimpia.veredicto;
ok(v.detectados.length > 0 && v.noEvaluables.length > 0 && v.sinHallazgo.length > 0,
  `el caso trae los tres estados poblados: ${v.detectados.length} detectados, `
  + `${v.noEvaluables.length} no evaluables, ${v.sinHallazgo.length} sin hallazgo`);

ok(todos.some(t => /UNA LISTA VACÍA NO SIGNIFICA QUE NO HAY RIESGO/.test(t)),
  'la frase va impresa, no implícita en que haya tres tablas');

const faltanDet = v.detectados.filter(r => !todos.some(t => t === (r.titulo || r.id)));
ok(faltanDet.length === 0,
  `los ${v.detectados.length} detectados salen por su nombre`
  + (faltanDet.length ? ` — faltan ${faltanDet.map(r => r.id).join(', ')}` : ''));

// Y cada uno dice CON QUÉ NÚMERO disparó.
const FRASE_SIN_CIFRA = 'sin cifra: lo que disparó es la ausencia de una captura';
const comoDebeSalir = (r) => {
  const s = (r.valor === null || r.valor === undefined) ? '' : String(r.valor).trim();
  return (s === '' || s === '—' || s === '-') ? FRASE_SIN_CIFRA : enLaHoja(s);
};
const sinCifra = v.detectados.filter(r => !todos.some(t => t === comoDebeSalir(r)));
ok(sinCifra.length === 0,
  `los ${v.detectados.length} detectados publican con qué disparó cada uno`
  + (sinCifra.length ? ` — callados: ${sinCifra.map(r => r.id).join(', ')}` : ''));
ok(v.detectados.some(r => /\d/.test(String(r.valor ?? ''))),
  'y al menos uno de ellos disparó con una cifra de verdad, no con la ausencia de un dato');

// LA RAYA SE ESCRIBE CON PALABRAS. Dos reglas de la biblioteca publican
// `valor: '—'` a propósito —lo que dispara es la AUSENCIA de una captura, no una
// medición— y bajo un rótulo que dice «disparó con», una raya suelta se lee
// como que el papel no lo trae. El caso lo da una obra recién dada de alta: sin
// catálogo, sin días de pago y sin corrida de GP.
const RECIEN = armar({ ejec: sube(0, 0), gastoAcum: sube(0, 0), conGP: false });
delete RECIEN.obra.diasPago;
const dRecien = { ...datosDe(RECIEN), subs: [] };
const eRecien = esperadoDe(dRecien);
const rayas = eRecien.veredicto.detectados.filter(r => String(r.valor ?? '').trim() === '—');
ok(rayas.length >= 1,
  `la obra recién dada de alta trae ${rayas.length} regla(s) que disparan sin cifra, `
  + 'que es lo que esta comprobación necesita');
const hojaRecien = (await dibujar(dRecien)).map(x => x.texto);
ok(rayas.every(() => hojaRecien.includes(FRASE_SIN_CIFRA)),
  'una regla que dispara por una captura ausente lo dice con palabras, no con una raya');
const detRecien = eRecien.veredicto.detectados;
ok(detRecien.every(r => hojaRecien.some(t => t === comoDebeSalir(r))),
  `los ${detRecien.length} detectados de esa obra publican todos con qué disparó`);

const faltanNoEv = v.noEvaluables.filter(r => !todos.some(t => t === (r.titulo || r.id)));
ok(faltanNoEv.length === 0,
  `los ${v.noEvaluables.length} no evaluables salen por su nombre`
  + (faltanNoEv.length ? ` — faltan ${faltanNoEv.map(r => r.id).join(', ')}` : ''));

// Y NOMBRAN EL DATO QUE FALTA, que es lo único que vuelve el hueco accionable.
const sinNombrarDato = v.noEvaluables.filter(r =>
  !todos.some(t => r.faltan.every(f => t.includes(f.nombre || f.dato))));
ok(sinNombrarDato.length === 0,
  `los ${v.noEvaluables.length} no evaluables nombran el dato que les faltó`
  + (sinNombrarDato.length ? ` — sin nombrarlo: ${sinNombrarDato.map(r => r.id).join(', ')}` : ''));

// Los sin hallazgo se NOMBRAN, no se cuentan: la regla que falte de la lista es
// la que nadie va a notar.
const faltanSin = v.sinHallazgo.filter(r =>
  !todos.some(t => t.includes(r.titulo || r.id)));
ok(faltanSin.length === 0,
  `los ${v.sinHallazgo.length} sin hallazgo se nombran uno por uno`
  + (faltanSin.length ? ` — faltan ${faltanSin.map(r => r.id).join(', ')}` : ''));

// Los cuatro conteos, impresos y correctos.
const cuentas = [
  ['Detectados', v.detectados.length], ['No evaluables', v.noEvaluables.length],
  ['Sin hallazgo', v.sinHallazgo.length], ['Reventaron', v.reventaron.length],
];
const malas = cuentas.filter(([lbl, n]) => {
  const i = todos.findIndex(t => t === lbl.toUpperCase());
  return i < 0 || todos[i + 1] !== String(n);
});
ok(malas.length === 0,
  'los cuatro conteos impresos son los del motor'
  + (malas.length ? ` — mal: ${malas.map(([l]) => l).join(', ')}` : ''));

// ══════════════════════════════════════════════════════════════════════════
// E · LA FRONTERA
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── E · lo que el papel se niega a afirmar ────────────────────');

// (a) Gasto de GP sin medir: ni un porcentaje de margen en todo el papel.
const dSinGP = datosDe(SIN_GP);
const eSinGP = esperadoDe(dSinGP);
ok(eSinGP.pres.gastoSinMedir === true,
  'el caso sin GP tiene el gasto sin medir, que es lo que esta frontera necesita');
const hojaSinGP = (await dibujar(dSinGP)).map(x => x.texto);
ok(hojaSinGP.filter(t => t === 'sin medir').length >= 1,
  'el gasto se imprime «sin medir» y no como un cero');
ok(hojaSinGP.some(t => /no está medido/.test(t) || /no se pudo medir/.test(t)),
  'y el documento dice por qué, en vez de dejar el hueco a la vista');
// El margen de ese caso saldría en 100% si se calculara con el gasto en cero.
ok(!hojaSinGP.some(t => /^100\.0%$/.test(t)),
  'con el gasto incompleto el margen inflado no se publica en ninguna parte');
ok(hojaSinGP.includes(eSinGP.pres.margenTxt),
  `el margen imprime lo que la pantalla dice: «${eSinGP.pres.margenTxt}»`);

// (b) Gasto sin fechar: ninguna tendencia. Es el caso que el preview encontró
// en producción —la 0114 publicó «el margen cayó 96.2 puntos en 8 semanas»— y
// lo que caía era el gasto llegando a su propia serie.
const dSinFecha = datosDe(SIN_FECHA);
const eSinFecha = esperadoDe(dSinFecha);
ok(eSinFecha.curva.gastoSinFechar === true && eSinFecha.cm.cola === 0,
  'el caso sin fechar levanta la bandera y no arma tramo, que es lo que esta frontera mide');
const hojaSinFecha = await dibujar(dSinFecha);
const textosSinFecha = hojaSinFecha.map(x => x.texto);
ok(!hojaSinFecha.some(x => x.tabla && x.texto === 'Margen %'),
  'sin fechas no se dibuja la tabla del margen semana a semana');
ok(textosSinFecha.some(t => /sin fecha/.test(t)),
  'y se imprime el motivo: parte del gasto llega sin fecha');
ok(!textosSinFecha.some(t => /semanas seguidas/.test(t)),
  'el papel no afirma una sola semana de tendencia sobre esa serie');

console.log('');
if (fallas) {
  console.log(`${verdes} en verde · ${fallas} en rojo.`);
  process.exit(1);
}
console.log(`${verdes} en verde. El documento interno dice lo que sabe y declara lo que no.`);

// ══════════════════════════════════════════════════════════════════════════
// LA CONTRAPRUEBA
// ══════════════════════════════════════════════════════════════════════════
// Cada mutación mueve UNA decisión del generador y tiene que salir en ROJO.
// Todas viven dentro de `generarPDFInterno`: una que tocara
// `comportamientoDelMargen` o `evaluarRiesgos` mediría el banco de AQUELLA
// cuenta y no éste, y dejaría al papel sin comprobar que la respeta.
//
// NO hay mutación del enganche `didDrawPage`: el lienzo falso no pagina, así
// que ninguna aserción de aquí la vería y la contraprueba saldría amarilla
// —cero rojas— por una razón honesta. Eso se mira en el preview, no aquí.
if (process.argv.includes('--contraprueba')) {
  console.log('\n── CONTRAPRUEBA ─────────────────────────────────────────────');
  const src = fs.readFileSync(archivo, 'utf8');
  const MUTANTES = [
    // ── A · es de cotea, y dice que es interno en cada hoja ────────────────
    { nombre: 'la banda del sello sale del marco y sobrevive sólo en la portada',
      hacer: () => src.replace(
        "    sf(Q.nar); R(0,HDR,PW,4);\n    st(Q.wh); fs(6); fw('bold');\n"
        + "    T(SELLO_INTERNO, PW/2, HDR+2.8, {align:'center'});",
        '    sf(Q.nar); R(0,HDR,PW,4);') },
    { nombre: 'la organización se rellena con una constructora teclada cuando no viene',
      hacer: () => src.replace(
        "    ['Organización:', comoSeImprime(organizacion)],",
        "    ['Organización:', organizacion || 'FOSMON Construcciones'],") },

    // ── B · lo que imprime es lo que la pantalla dice ──────────────────────
    { nombre: 'el corte del cuerpo se cambia por la fecha a secas y pierde su origen',
      hacer: () => src.replace(
        "    ['Corte del documento:', sello.corte],",
        "    ['Corte del documento:', hoy],") },
    { nombre: 'el sello deja de recibir el instante y el papel vuelve al reloj del aparato',
      hacer: () => src.replace(
        '  const sello = selloDeTiempo(instante);\n  const hoy = sello.fecha;\n'
        + "  const nombreCorto = resolverNombreCortoObra(obra, gpData) || (obra?.nombre || 'Obra');\n\n"
        + '  // ── LA ECONOMÍA, CALCULADA DONDE SE CALCULA PARA LA PANTALLA ──',
        '  const sello = selloDeTiempo(null);\n  const hoy = sello.fecha;\n'
        + "  const nombreCorto = resolverNombreCortoObra(obra, gpData) || (obra?.nombre || 'Obra');\n\n"
        + '  // ── LA ECONOMÍA, CALCULADA DONDE SE CALCULA PARA LA PANTALLA ──') },

    // ── C · el margen semana a semana ──────────────────────────────────────
    { nombre: 'la ventana del papel se despega de la del tablero',
      hacer: () => src.replace(
        '  const VENTANA = 12;',
        '  const VENTANA = 6;') },
    { nombre: 'la columna del cambio se rotula en por ciento y no en puntos porcentuales',
      hacer: () => src.replace(
        "    ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} pp`;",
        "    ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;") },
    { nombre: 'el renglón sin con qué compararse imprime «+0.0 pp» en vez de raya',
      hacer: () => src.replace(
        '  const PP = (n) => n === null || n === undefined || !Number.isFinite(n)',
        '  const PP = (n) => false') },

    // ── D · los tres estados del riesgo ────────────────────────────────────
    { nombre: 'la raya de la regla que dispara sin cifra se imprime como raya',
      hacer: () => src.replace(
        "    return (s === '' || s === '—' || s === '-')\n"
        + "      ? 'sin cifra: lo que disparó es la ausencia de una captura'\n"
        + '      : s;',
        '    return s;') },
    { nombre: 'la tabla de no evaluables se calla y el papel publica sólo los detectados',
      hacer: () => src.replace(
        "  if (noEvaluables.length) {\n    y = autoT(\n"
        + "      ['Riesgo', 'Dato que falta', 'Por qué no se pudo medir'],",
        "  if (false) {\n    y = autoT(\n"
        + "      ['Riesgo', 'Dato que falta', 'Por qué no se pudo medir'],") },
    { nombre: 'el no evaluable deja de nombrar el dato que le faltó',
      hacer: () => src.replace(
        "        r.faltan.map(f => f.nombre || f.dato).join(' · '),",
        "        '',") },
    { nombre: 'la frase de que una lista vacía no significa que no hay riesgo se borra',
      hacer: () => src.replace(
        "  y = nota('UNA LISTA VACÍA NO SIGNIFICA QUE NO HAY RIESGO. Una regla puede callarse porque midió '",
        "  y = nota('Riesgos de la obra. Una regla puede callarse porque midió '") },
    { nombre: 'los sin hallazgo se cuentan en vez de nombrarse',
      hacer: () => src.replace(
        "        ? sinHallazgo.map(r => r.titulo || r.id).join(' · ')",
        '        ? `${sinHallazgo.length} reglas midieron y no encontraron nada`') },
    { nombre: 'el conteo impreso de no evaluables deja de ser el del motor',
      hacer: () => src.replace(
        "    ['No evaluables', String(noEvaluables.length), 'les faltó un dato', Q.mu],",
        "    ['No evaluables', String(noEvaluables.length + 1), 'les faltó un dato', Q.mu],") },

    // ── E · la frontera ────────────────────────────────────────────────────
    { nombre: 'el gasto se formatea aquí y el sin medir vuelve a salir como cifra',
      hacer: () => src.replace(
        "    ['Gasto total', pres.gastoTxt,",
        "    ['Gasto total', MXN(kpis.gt),") },
    { nombre: 'el margen se formatea aquí y el inflado se publica',
      hacer: () => src.replace(
        "    ['Margen bruto', pres.margenTxt, pres.margenAbsTxt, colorMargen],",
        "    ['Margen bruto', PCT(kpis.mpct), pres.margenAbsTxt, colorMargen],") },
    { nombre: 'la tabla del margen se dibuja aunque no haya tramo que publicar',
      hacer: () => src.replace(
        '  if (cm.renglones.length) {',
        '  if (cm.renglones) {') },
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interno-cotea-'));
  let n = 0;
  for (const m of MUTANTES) {
    const mutado = m.hacer();
    if (mutado === src) {
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» no cambió nada.`);
      process.exit(2);
    }
    const f2 = path.join(dir, `app-${n}.jsx`);
    fs.writeFileSync(f2, mutado);
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f2 }, encoding: 'utf8' });
    // LAS ROJAS SE LEEN DEL VEREDICTO DEL HIJO, no contando renglones `FALLA`:
    // el día que este banco se calle una falla, contar renglones daría cero y
    // la contraprueba se daría por buena sin haber comprobado nada.
    const dicho = (r.stdout + r.stderr).match(/(\d+) en rojo/);
    const caidas = dicho ? Number(dicho[1]) : 0;
    console.log(`\n  «${m.nombre}»`);
    console.log(`     ${caidas} aserción(es) en rojo` + (r.status === 2 ? '  ← NO ARRANCÓ' : ''));
    if (r.status === 2) {
      console.log((r.stdout + r.stderr).split('\n').filter(l => /NO ARRANCÓ/.test(l)).join('\n'));
      process.exit(2);
    }
    if (caidas === 0) {
      console.log('     la contraprueba NO puso nada en rojo: la aserción no afirma lo que dice');
      process.exit(1);
    }
    n++;
  }
  console.log(`\n${n} mutación(es), todas en rojo.\n`);
}

})().catch((e) => {
  console.error(`\nNO ARRANCÓ: ${e.stack}`);
  process.exit(2);
});
