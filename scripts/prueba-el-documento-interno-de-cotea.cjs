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
// `textoCorrido` pega los renglones que salieron de UNA llamada a `text`. Los
// riesgos sin hallazgo se nombran dentro de un párrafo largo que el generador
// parte para que quepa en la caja, así que un `includes` renglón por renglón
// pierde justo el nombre que queda a caballo del corte: el banco acusaría al
// papel de no nombrar una regla que sí nombra.
const { dibujarPDFInterno, textoCorrido } = require('./lienzo-pdf.cjs');
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
    // El año es el de CADA semana, no el de hoy. Las doce semanas de la ventana
    // caben en dos años cuando hoy cae en enero, febrero o marzo, y entonces
    // etiquetar todas con `AÑO` deja sin pareja a las del año anterior: el
    // generador no las encuentra, la serie sale en ceros y la §C se queda sin
    // tramo que medir. Medido el 2026-11-12 con el reloj puesto en el
    // 2027-03-12: «la serie del caso limpio trae 0 semanas de tramo, con las 4
    // que pide el reporte». No era el reporte: era el caso.
    historialAvance.push({ tipo: 'oficial', año: SEMS[i].año, semana: SEMS[i].sem,
                           avance: 10, avancePonderado: 10, montoEjecutado: m });
  });
  // EL GASTO, COMO GP LO MANDA. La hoja no desglosa los años cerrados: los
  // manda sumados en `años` y sólo detalla las semanas del año en curso. No es
  // una simplificación del caso, es una imposibilidad del origen — las claves
  // de `semanas` van sin año (`S42` a secas, el #47), así que una semana de
  // diciembre metida ahí el producto la fecha en el año en curso y la manda al
  // futuro. Poner las doce semanas de la ventana en `semanas` fabricaba una
  // hoja que GP no puede producir, y de enero a marzo eso sacaba la mitad de
  // la serie de su sitio.
  const semanasGP = {};
  let gastadoEnAñosCerrados = 0;
  let prev = 0;
  gastoAcum.forEach((g, i) => {
    if (SEMS[i].año === AÑO) semanasGP[`S${SEMS[i].sem}`] = g - prev;
    else gastadoEnAñosCerrados = g;   // el acumulado hasta el último año cerrado
    prev = g;
  });
  const añosGP = {};
  if (gastadoEnAñosCerrados > 0) añosGP[`Y${AÑO - 1}`] = gastadoEnAñosCerrados;
  const gpData = conGP ? {
    ultimaSemana: `S${SEMS[N - 1].sem}`,
    // GP sólo publica las semanas que trae detalladas.
    semanasDisponibles: SEMS.filter(s => s.año === AÑO).map(s => ({ año: s.año, semana: s.sem })),
    obrasPedidas: [OBRA_BASE.gpId],
    obras: { [OBRA_BASE.gpId]: {
      id: OBRA_BASE.gpId, nombre: OBRA_BASE.nombre,
      grandTotal: grandTotal === null ? prev : grandTotal,
      años: añosGP,
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
//     tramo: un renglón de margen por cada semana dibujada.
//
// EL MARGEN TIENE QUE CAER FUERTE, no sólo caer. `fin_007` dispara con una
// caída de 3 pp o más EN EL TRAMO, y el tramo no mide doce semanas todo el
// año: de enero a marzo la parte dibujada es sólo la del año en curso, porque
// los años cerrados llegan sumados y sin semana. Con la pendiente de antes
// —$1.5M por semana contra $1.8M de ejecutado— el margen caía 5.2 pp en doce
// semanas pero sólo 1.6 pp en siete, así que en febrero no disparaba ningún
// riesgo y la §D se quedaba sin un solo detectado que mirar. Con $2.1M cae
// 3.9 pp aun en el tramo más corto que la §C acepta (cuatro semanas), y sigue
// siendo un margen positivo: el caso «limpio» no se vuelve una catástrofe.
const sube = (base, paso) => Array.from({ length: N }, (_, i) => base + paso * i);
const LIMPIA = armar({
  ejec:      sube(12000000, 1800000),
  gastoAcum: sube(8000000, 2100000),
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

// 4 · TRAMO CORTO: el gasto está medido y fechado como en el caso limpio, pero
//     el PRIMER corte de avance cae en la penúltima semana de la ventana. Es la
//     forma de una obra recién capturada, y es lo que deja `cola: 2` con
//     `suficiente: false`.
//
// POR QUÉ ESTE CASO Y NO EL CALENDARIO. La §C ya tenía una rama para el tramo
// corto, pero sólo muerde en las primeras semanas de enero —cuando GP no puede
// detallar cuatro semanas del año en curso—, y una aserción que sólo corre tres
// semanas al año es una aserción que no corre. Aquí el tramo se acorta por el
// lado del AVANCE, que el caso sí controla: `margen` arranca en
// `idxPrimerAvance`, así que sin cortes anteriores el porcentaje semanal es
// `null` antes de la penúltima y la cola contigua mide dos, cualquier día del
// año y con el reloj puesto donde sea.
const TRAMO_CORTO = armar({
  ejec:      Array.from({ length: N }, (_, i) =>
               i >= N - 2 ? 12000000 + 1800000 * i : null),
  gastoAcum: sube(8000000, 2100000),
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

// ── UNA HOJA SUELTA SIGUE DICIENDO QUÉ PAPEL ES ──────────────────────────
//
// Aquí se exigía la banda «DOCUMENTO INTERNO · EL QUE SE ENTREGA ES EL INFORME
// DE AVANCE» en todas las páginas interiores. La banda se retiró el 2026-11-23
// por decisión de producto: cotea produce UN reporte de avance de obra por
// obra —la variante de gobierno es el mismo con sus particularidades— y la
// banda existía para distinguirlo de otro papel que ya no hay. Peor: su
// segunda mitad mandaba a buscar el informe del Art. 73, que una sesión de
// constructora NO PUEDE generar.
//
// Lo que esa banda protegía de verdad sigue vigilado: que una hoja arrancada y
// dejada sobre un escritorio diga de qué documento salió. Eso lo sostiene
// ahora el rótulo de la cabecera, que el andamio pinta en cada página.
const interiores = paginas.filter(p => p > 1);
const sinRotulo = interiores.filter(p =>
  !textosDe(p).some(t => /Reporte de avance de obra/i.test(t)));
ok(interiores.length > 0 && sinRotulo.length === 0,
  `las ${interiores.length} páginas interiores se identifican por su nombre`
  + (sinRotulo.length ? ` — sin rótulo: ${sinRotulo.join(', ')}` : ''));
// Y QUE LA BANDA NO VUELVA SOLA: si alguien la repone, este papel vuelve a
// prometer un informe que su lector no puede generar.
ok(!interiores.some(p => textosDe(p).some(t => /EL QUE SE ENTREGA ES EL INFORME/.test(t))),
  'y ninguna manda a buscar un informe que esta sesión no puede generar');

const portada = textosDe(1);
ok(portada.some(t => /REPORTE DE AVANCE DE OBRA/i.test(t)),
  'la portada nombra el reporte',
  portada.find(t => /REPORTE DE AVANCE/i.test(t)) || '(no sale)');
ok(!portada.some(t => /no es el reporte que se entrega/i.test(t)),
  'y ya no se declara un papel que no se entrega: no hay otro con el que compararse');

// La marca del papel es cotea, en todas las páginas.
const sinCotea = paginas.filter(p => !textosDe(p).some(t => /cotea/.test(t)));
ok(sinCotea.length === 0,
  'cotea firma todas las páginas'
  + (sinCotea.length ? ` — sin firma: ${sinCotea.join(', ')}` : ''));

// Y la organización aparece como VALOR de un campo, no como marca. Una sola
// vez, en la portada, con su rótulo al lado.
const todos = textoCorrido(hojaLimpia).map(x => x.texto);
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
// SE CUENTA SOBRE EL TEXTO UNIDO, no sobre renglones iguales al corte entero.
// El corte sale DOS veces —en la franja oscura de la portada y en la lista de
// identificación— y en la lista va dentro de una columna que `splitTextToSize`
// parte. Mientras cupo, el renglón era idéntico a la cadena y la comparación
// `t === corte` funcionaba por casualidad; el 2026-11-21, al ensanchar la
// columna de etiquetas para la letra nueva, dejó de caber y el banco acusó al
// papel de no declarar su origen cuando lo declaraba partido en dos líneas.
const unido = todos.join(' ').replace(/\s+/g, ' ');
const vecesCorte = unido.split(corte.replace(/\s+/g, ' ')).length - 1;
ok(vecesCorte >= 2,
  `el corte del documento sale del sello y declara su origen: «${corte}»`,
  `${vecesCorte} vez(ces)`);
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

// CUÁNTAS SEMANAS DE LA VENTANA PUEDE GP DETALLAR: las del año en curso, y
// nada más. En las primeras semanas de enero son una o dos, y entonces no hay
// tramo que medir — no porque el caso sea pobre, sino porque el origen no
// manda el desglose de los años cerrados. Lo que se exige ahí es lo contrario
// y es igual de duro: que el papel NO afirme una tendencia que no puede
// sostener. Medido con el reloj en 2027-01-05: una sola semana detallable.
//
// No es un «esta comprobación no acota»: las dos ramas afirman conducta, y la
// que corre cada día la decide el calendario, no el caso.
const detallables = SEMS.filter(s => s.año === AÑO).length;
const hayTramoPosible = detallables >= cm.minimo;

if (!hayTramoPosible) {
  ok(cm.suficiente === false,
    `GP sólo puede detallar ${detallables} semana(s) de la ventana: no hay tramo que medir`);
  // Lo que SÍ tiene que salir es el motivo que la curva declaró, con todo y la
  // cuenta de semanas que le faltan.
  ok(todos.some(t => t.includes(enLaHoja(cm.motivo))),
    `y el papel publica el motivo que la curva declaró: «${cm.motivo}»`);
  // La otra mitad —que el papel NO afirme el tramo— se mide abajo, sobre un
  // caso que la controla todos los días del año y no sólo en enero.
}

ok(!hayTramoPosible || (cm.renglones.length >= 4 && cm.suficiente === true),
  `la serie del caso limpio trae ${cm.renglones.length} semanas de tramo, con las `
  + `${cm.minimo} que pide el reporte`);

// Un renglón por semana del tramo, con su etiqueta. La tabla del margen es la
// única del documento con una columna «Margen %», así que se la pide por ahí.
const tablaMargen = (() => {
  const conCabecera = hojaLimpia.filter(x => x.tabla && x.texto === 'Margen %');
  return conCabecera.length ? conCabecera[0].tabla : null;
})();
if (!hayTramoPosible) {
  // ya medido arriba: sin tramo posible no hay tabla que revisar
} else if (tablaMargen === null) {
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
if (hayTramoPosible) {
  const FLECHA = enLaHoja('→');
  const tramoTxt = todos.find(t => t.includes(FLECHA) && /pp/.test(t));
  ok(!!tramoTxt
     && tramoTxt.includes(`${cm.desde.toFixed(1)}%`)
     && tramoTxt.includes(`${cm.hasta.toFixed(1)}%`),
    `el renglón del tramo dice de cuánto a cuánto: «${tramoTxt || 'no está'}»`);
  ok(todos.some(t => new RegExp(`${cm.cola} semanas seguidas`).test(t)),
    `y en cuántas semanas: ${cm.cola}`);
}

// ── C-bis · EL TRAMO QUE NO ALCANZA NO SE AFIRMA  (#135) ───────────────────
// El papel imprimía el titular del tramo SIEMPRE que hubiera un renglón, y
// tres notas más abajo admitía que ese tramo no alcanzaba para hablar de
// tendencia. Las dos cosas en la misma hoja: la de arriba en negritas y la de
// abajo en letra chica. Lo que se afirma aquí es que cuando
// `comportamientoDelMargen` dice `suficiente: false`, el recorrido no sale —ni
// de cuánto a cuánto, ni en cuántas semanas— y el motivo va delante de las
// cifras, no detrás.
console.log('');
const dCorto = datosDe(TRAMO_CORTO);
const eCorto = esperadoDe(dCorto);
const cmCorto = eCorto.cm;

// PRECONDICIÓN, NO ASERCIÓN. Las dos negativas de abajo se cumplen por vacío
// sobre cualquier caso que no tenga tramo corto —sin renglones no hay titular
// que buscar—, así que si el caso deja de producirlo esto es NO ARRANCÓ (2) y
// no un verde. Es la misma razón por la que la ventana se revisa arriba.
if (!(cmCorto.renglones.length > 0 && cmCorto.suficiente === false
      && eCorto.curva.gastoSinFechar === false
      && eCorto.curva.gastoMedido === true)) {
  console.error(`\nNO ARRANCÓ: el caso del tramo corto salió con `
    + `${cmCorto.renglones.length} renglón(es), suficiente=${cmCorto.suficiente}, `
    + `gasto medido=${eCorto.curva.gastoMedido}, sin fechar=${eCorto.curva.gastoSinFechar}. `
    + 'Hace falta un tramo CORTO Y REAL —gasto medido y fechado, cola por debajo del '
    + 'mínimo— o las dos negativas de esta sección se cumplen por vacío.');
  process.exit(2);
}

const hojaCorto = await dibujar(dCorto);
const textosCorto = hojaCorto.map(x => x.texto);
ok(cmCorto.cola > 0 && cmCorto.cola < cmCorto.minimo,
  `el caso del tramo corto trae ${cmCorto.cola} semana(s) de cola contra las `
  + `${cmCorto.minimo} que pide el reporte`);

// La tabla del margen, que es lo que ancla la sección: se la pide por su
// columna «Margen %», la única del documento.
const tablaCorto = hojaCorto.find(x => x.tabla && x.texto === 'Margen %');
const iTablaCorto = hojaCorto.indexOf(tablaCorto);

// (a) El motivo SÍ se publica, Y DELANTE DE LAS CIFRAS. Hacia adentro un hueco
// es lo que sirve para ir a cerrarlo, y éste dice cuántas semanas faltan.
//
// SE BUSCA EN SU SECCIÓN, no en el documento entero: el motivo del margen sale
// TAMBIÉN en la §6, como el «por qué no se pudo medir» de la regla de riesgo
// que lee esta misma cuenta. Buscarlo en toda la hoja dejaba la comprobación
// satisfecha por esa otra tabla —medido: la mutación que borra el motivo de la
// §4 salía en verde—, y entonces la §4 podía callarse sin que nada lo viera.
const antesDeLaTabla = iTablaCorto > 0
  ? textoCorrido(hojaCorto.slice(0, iTablaCorto)
      .filter(x => x.pagina === tablaCorto.pagina)).map(d => d.texto)
  : [];
ok(antesDeLaTabla.some(t => t.includes(enLaHoja(cmCorto.motivo))),
  `la sección publica el motivo ANTES de la tabla: «${cmCorto.motivo}»`);

// (b) El titular en negritas NO sale. Se busca la frase que imprimía, armada
// con la cola de ESTE caso: tecleada, dejaría de verse el día que cambie.
const TITULAR = enLaHoja(
  `${cmCorto.cola} semanas seguidas con las dos líneas en el mismo corte`);
ok(!textosCorto.includes(TITULAR),
  `y NO titula «${TITULAR}» sobre una serie que acaba de declarar insuficiente`);
// Ni con otra cuenta de semanas. La frase se busca ANCLADA, como renglón
// entero: el MOTIVO que el papel sí publica la contiene —«sólo hay 2 semanas
// seguidas con las dos líneas en el mismo corte, y se necesitan 4»— y un
// `includes` suelto acusaría al papel de titular justo donde se está
// desdiciendo. Lo que no puede existir es el titular SOLO.
ok(!textosCorto.some(t =>
    new RegExp(`^\\d+ semanas? seguidas? con las dos l${enLaHoja('í')}neas en el mismo corte$`)
      .test(t.trim())),
  'ni con otra cuenta de semanas: el titular suelto no está en la hoja');

// (c) Ni el recorrido de cuánto a cuánto. Es la cifra que el preview encontró
// publicada al lado de su propio desmentido.
const FLECHA_CORTO = enLaHoja('→');
const recorrido = textosCorto.find(t => t.includes(FLECHA_CORTO) && /pp/.test(t));
ok(!recorrido,
  'no publica el recorrido del tramo en ninguna parte'
  + (recorrido ? ` — salió «${recorrido}»` : ''));

// (d) Y LA TABLA SIGUE AHÍ. Cada renglón es una semana MEDIDA y se lee sola;
// callarla también sería perder el dato que sí hay, que es lo contrario de lo
// que este papel existe para hacer.
const celdasCorto = tablaCorto ? hojaCorto.filter(x => x.tabla === tablaCorto.tabla) : [];
const faltanSem = cmCorto.renglones.map(r => r.label)
  .filter(l => !celdasCorto.some(c => c.celda === 0 && c.texto === l));
ok(!!tablaCorto && faltanSem.length === 0,
  `la tabla sigue dibujando las ${cmCorto.renglones.length} semanas medidas`
  + (faltanSem.length ? ` — faltan ${faltanSem.join(', ')}` : ''));

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
const hojaRecien = textoCorrido(await dibujar(dRecien)).map(x => x.texto);
ok(rayas.every(() => hojaRecien.includes(FRASE_SIN_CIFRA)),
  'una regla que dispara por una captura ausente lo dice con palabras, no con una raya');
const detRecien = eRecien.veredicto.detectados;
ok(detRecien.every(r => hojaRecien.some(t => t === comoDebeSalir(r))),
  `los ${detRecien.length} detectados de esa obra publican todos con qué disparó`);

// ── LAS DOS LISTAS SE FUERON, Y QUEDAN DOS NÚMEROS ────────────────────────
//
// Aquí se afirmaba que los no evaluables salían UNO POR UNO con el dato que
// les faltó, y que los sin hallazgo se nombraban en fila. Las dos listas se
// retiraron del papel de la constructora el 2026-11-21: la columna «por qué no
// se pudo medir» citaba al MOTOR —«falta `historialAvance` en esta lectura»— y
// eso le habla a quien escribió la regla, no a quien lee el expediente de su
// obra; y la fila de nombres de reglas no la lee nadie.
//
// LO QUE NO SE PUEDE PERDER es la razón por la que esas listas existían: que
// «ningún riesgo detectado» NO se lea como «obra sana». Eso lo sostiene un
// número, no una lista, y es lo que se afirma ahora. El detalle por dato sigue
// vivo en el informe del Art. 73 —lo comprueba `prueba-el-hueco-de-riesgo-se-ve`—,
// así que no desapareció del producto: se quedó donde es accionable.
const diceConteo = (frase) => todos.some(t => t.includes(frase));
ok(diceConteo(`${v.noEvaluables.length} sin poder medir`),
  `el papel publica «${v.noEvaluables.length} sin poder medir» en vez de la tabla`,
  todos.find(t => /sin poder medir/.test(t)) || 'no sale');
ok(diceConteo(`${v.sinHallazgo.length} evaluados sin hallazgo`),
  `y «${v.sinHallazgo.length} evaluados sin hallazgo» en vez de la fila de nombres`,
  todos.find(t => /evaluados sin hallazgo/.test(t)) || 'no sale');

// Y QUE DE VERDAD YA NO SALGAN LOS NOMBRES. Sin esto, el banco diría que los
// conteos están y no se enteraría de que las listas siguen debajo.
const nombresNoEv = v.noEvaluables.filter(r => todos.some(t => t === (r.titulo || r.id)));
ok(nombresNoEv.length === 0,
  'y ningún no evaluable sale por su nombre',
  nombresNoEv.length ? `siguen ${nombresNoEv.map(r => r.id).join(', ')}` : 'ninguno');
const porQueSuelto = todos.filter(t => /Por qué no se pudo medir/.test(t));
ok(porQueSuelto.length === 0,
  'ni la columna del porqué, que era la que citaba al motor');

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
// SE MIRA LA TEJA, no todo el documento. Contaba los textos iguales a «sin
// medir» en la hoja entera, y el 2026-11-23 el papel ganó la tabla semanal,
// donde «sin medir» es el TEXTO DE UNA CELDA VACÍA —la semana que no trae
// avance o gasto—. Con esas celdas presentes, la cuenta pasaba de uno siempre
// y la aserción dejó de afirmar nada: la contraprueba que formatea el gasto a
// mano y publica la cifra cruda ya no la hacía caer.
//
// La teja son TRES TEXTOS SEGUIDOS —rótulo en mayúsculas, valor, pie—, que es
// como `kpiBox` los manda al papel.
const iGasto = hojaSinGP.findIndex(t => /^GASTO TOTAL$/i.test(String(t).trim()));
const valorGasto = iGasto >= 0 ? String(hojaSinGP[iGasto + 1] || '') : '(no hay teja)';
ok(valorGasto === 'sin medir',
  'el gasto se imprime «sin medir» y no como un cero',
  `la teja dice «${valorGasto}»`);
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
// ══════════════════════════════════════════════════════════════════════════
// EL BOTÓN DE LA PANTALLA LLAMA AL PAPEL POR SU NOMBRE
// ══════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTO EXISTE. El 2026-11-23 el papel pasó a llamarse «Reporte de
// avance de obra» —en la portada, en la cabecera de cada hoja, en el nombre
// del archivo y en el `title` del botón— y el RÓTULO del botón se quedó
// diciendo «Documento interno». La suite siguió en verde: ningún banco miraba
// el botón, sólo el papel. Lo vio el usuario.
//
// Lo que se afirma no es un texto concreto, que cambiaría con el próximo
// nombre: es que lo que la pantalla OFRECE y lo que el papel SE LLAMA sean lo
// mismo. Por eso el rótulo se compara contra el título que el propio papel
// imprime en su portada, no contra una cadena escrita aquí.
{
  const srcApp = fs.readFileSync(archivo, 'utf8');
  // El botón se localiza por su `title`, que es lo que describe el acto, y de
  // ahí se lee el texto suelto que queda entre las etiquetas.
  const botonDe = (title) => {
    const i = srcApp.indexOf(`title="${title}"`);
    if (i < 0) return null;
    const fin = srcApp.indexOf('</button>', i);
    if (fin < 0) return null;
    const trozo = srcApp.slice(i, fin);
    // Fuera comentarios JSX y etiquetas; queda el texto que el usuario lee.
    return trozo.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/<[^>]*>/g, ' ').replace(/title="[^"]*"/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').slice(-3).join(' ');
  };
  const normal = (t) => String(t).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const rotuloInterno = botonDe('Descargar el reporte de avance de obra en PDF');
  ok(!!rotuloInterno, 'se localizó el botón que descarga el papel de la constructora',
    rotuloInterno || '(no está)');
  // La portada imprime el nombre del papel en mayúsculas; el botón lleva el
  // corto, así que se exige que el corto esté CONTENIDO en el nombre largo.
  const tituloEnLaPortada = textosDe(1).find(t => /REPORTE DE AVANCE/i.test(t)) || '';
  ok(rotuloInterno && tituloEnLaPortada
     && normal(tituloEnLaPortada).includes(normal(rotuloInterno)),
    'y su rótulo es el nombre del papel, no otro',
    `botón «${rotuloInterno}» · portada «${tituloEnLaPortada}»`);
  ok(rotuloInterno && !/documento interno/i.test(rotuloInterno),
    'en particular ya no ofrece un «documento interno», que es un papel que '
    + 'dejó de existir con ese nombre');
}

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
    // Las dos formas de perder el sello, y son distintas desde que el marco
    // vive en `andamioDeCotea`: que el ANDAMIO deje de pintar la banda, o que
    // ESTE PAPEL deje de pedirla. La segunda es la que la extracción hizo
    // posible —el andamio queda intacto y correcto, y la hoja sale limpia—, y
    // es justo la que no existía cuando el marco era un cierre de aquí.
    // RETIRADA el 2026-11-23. Mutaba el dibujo de la banda dentro del marco
    // del andamio para comprobar que el sello llegaba a todas las páginas. Este
    // papel YA NO PIDE BANDA —se retiró por decisión de producto—, así que
    // borrar su dibujo no cambia nada de lo que este banco mira y la mutación
    // pasaba sin que nadie la viera. El andamio sigue sabiendo pintarla y el
    // informe del Art. 73 tampoco la usa; el día que algún papel vuelva a
    // pedirla, es su banco el que tiene que vigilarla.
    //
    // Lo que aquí protegía —que una hoja suelta diga de qué documento salió—
    // lo afirma ahora el rótulo de la cabecera, arriba, y la mutación que
    // devuelve la banda al papel.
    // DADA LA VUELTA el 2026-11-23. Vigilaba que el papel PIDIERA la banda de
    // documento interno; la banda se retiró por decisión de producto —cotea
    // produce un solo reporte de avance de obra— así que lo que hay que
    // proteger es lo contrario: que no vuelva sola, con su promesa de un
    // informe que una sesión de constructora no puede generar.
    { nombre: 'la banda de documento interno vuelve al papel',
      hacer: () => src.replace(
        "    rotulo: 'Reporte de avance de obra', banda: null,",
        "    rotulo: 'Reporte de avance de obra',\n"
        + "    banda: 'DOCUMENTO INTERNO · USO DE COTEA · EL QUE SE ENTREGA ES EL INFORME DE AVANCE',") },
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
        + '  // ── EL ANDAMIO, CON EL SELLO DE INTERNO EN LA BANDA ──',
        '  const sello = selloDeTiempo(null);\n  const hoy = sello.fecha;\n'
        + "  const nombreCorto = resolverNombreCortoObra(obra, gpData) || (obra?.nombre || 'Obra');\n\n"
        + '  // ── EL ANDAMIO, CON EL SELLO DE INTERNO EN LA BANDA ──') },

    // ── C · el margen semana a semana ──────────────────────────────────────
    // REANCLADA el 2026-11-23: la ventana dejó de estar clavada en 12 y la
    // elige `ventanaDeLaObra` por la EDAD de la obra —8, 12 o 24—, que es la
    // misma regla con la que abre el tablero. La mutación sigue diciendo lo
    // mismo: que el papel use una ventana propia en vez de la compartida.
    { nombre: 'la ventana del papel se despega de la del tablero',
      hacer: () => src.replace(
        '  const VENTANA = ventanaDeLaObra(obra);',
        '  const VENTANA = 6;') },
    { nombre: 'la columna del cambio se rotula en por ciento y no en puntos porcentuales',
      hacer: () => src.replace(
        "    ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} pp`;",
        "    ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;") },
    // Las dos mitades del #135, una mutación cada una: el titular que vuelve a
    // salir sobre una serie insuficiente, y el motivo que se calla.
    { nombre: 'el titular del tramo vuelve a salir aunque la cola no alcance',
      hacer: () => src.replace(
        '    if (cm.suficiente) {',
        '    if (true) {') },
    { nombre: 'la tabla corta se queda sola y el papel se calla por qué no hay tendencia',
      hacer: () => src.replace(
        '      y = nota(`Esta tabla no dice hacia dónde va el margen: ${cm.motivo}. Cada renglón `',
        '      y = nota(`Margen semana a semana. Cada renglón `') },
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
    // ── TRES MUTACIONES RETIRADAS EL 2026-11-23 ───────────────────────────
    //
    // Vigilaban la TABLA de no evaluables y la fila de nombres de los sin
    // hallazgo: que la tabla no se callara, que nombrara el dato que faltó, y
    // que los sin hallazgo salieran uno por uno. Las dos listas se retiraron
    // del papel de la constructora el 2026-11-21 por decisión de producto —la
    // columna del porqué citaba al MOTOR, y eso le habla a quien escribió la
    // regla— y quedaron dos conteos.
    //
    // Sus anclajes dejaron de existir y el corredor lo dijo con un NO ARRANCÓ.
    // Lo que protegían no se perdió: que «ningún riesgo detectado» no se lea
    // como «obra sana» lo sostienen ahora los dos números, con sus propias
    // aserciones arriba, y el DETALLE por dato sigue vigilado en el informe
    // del Art. 73 por `prueba-el-hueco-de-riesgo-se-ve`.
    { nombre: 'la frase de que una lista vacía no significa que no hay riesgo se borra',
      hacer: () => src.replace(
        "  y = nota('UNA LISTA VACÍA NO SIGNIFICA QUE NO HAY RIESGO. Una regla puede callarse porque midió '",
        "  y = nota('Riesgos de la obra. Una regla puede callarse porque midió '") },
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
