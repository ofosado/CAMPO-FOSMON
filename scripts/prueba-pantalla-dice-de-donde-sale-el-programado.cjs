#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA PANTALLA DICE DE DÓNDE SALE EL PROGRAMADO — PENDIENTES #51
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. `prueba-programa-no-es-una-recta.cjs` afirma que la
// cuenta del programa es correcta. Eso no basta: la cuenta puede estar bien y
// la pantalla seguir pintando la recta, que es exactamente el estado en que
// estaba la app. Este banco afirma lo otro —LO QUE SE PUBLICA—:
//
//   · que con un programa cargado el número que sale es el del programa;
//   · que sin programa cargado NO SALE NINGÚN NÚMERO: `pct` es `null`, la
//     fuente lo dice, y el rótulo nombra lo que falta en vez de nombrar un
//     avance;
//   · que ese `null` nunca se rellena con un 0;
//   · y que la alerta de «avance bajo programa» —la que le llega al residente
//     con severidad alta— dispara contra el programa cuando lo hay y CALLA
//     cuando no lo hay.
//
// EL RÓTULO FUE LA MITAD DEL DEFECTO, Y NO ALCANZÓ. Medido el 2026-11-04 sobre
// los tres programas reales de producción, la recta se separa del programa
// hasta +27.3 puntos (emisor), −9.9 (colector) y −17.2 (la Cangrejera). El
// primer corte dejó la cifra en pantalla rotulada «Avance lineal» para no
// mentir en el nombre. El 2026-11-06 se quitó entera: una línea que parte el
// contrato en dos entre el inicio y el fin SE LEE COMO UN PLAN diga lo que
// diga la leyenda, y el signo importa porque son dos defectos distintos —con
// la recta por debajo del programa una obra atrasada se publica como al día, y
// con la recta por encima una obra al día se publica como atrasada.
//
// POR QUÉ LA ALERTA Y NO SÓLO EL KPI. El umbral de la alerta es 15 puntos de
// desviación. La separación entre la recta y el programa llega a 27. O sea que
// el disparo de una alerta de severidad alta lo decidía el error de la cuenta y
// no el estado de la obra. Es el sitio donde este defecto cuesta más caro, y es
// por eso que ahora sin anexo esa alerta no se levanta: una alerta alta que le
// llega al residente tiene que poder citar contra qué midió.
//
// Lo que se afirma es CONDUCTA: el número y el rótulo que devuelven las cuentas
// extraídas de `src/App.jsx` y ejecutadas aquí. No se afirma que exista ningún
// nombre; los nombres se piden sólo para poder ejecutar.
//
// EL PDF SÍ SE ALCANZA, Y AQUÍ DECÍA QUE NO. Hasta el 2026-11-06 esta cabecera
// afirmaba que `generarPDFObra` «no se puede ejecutar fuera del navegador». Es
// falso: `scripts/lienzo-pdf.cjs` le pone un jsPDF de mentira y lo mueve de
// verdad, y dos bancos ya lo usaban. La consecuencia de creerse esa frase fue
// que el PDF —la única cosa de todo esto que sale impresa, se firma y se
// entrega al cliente— era la superficie SIN comprobar. La sección 6 la cubre.
//
// Y DESDE EL 2026-11-12 SON DOS PAPELES. `generarPDFObra` se retiró: el que se
// entrega es `generarPDFArt73` —el informe de avance de la dependencia— y el de
// la constructora es `generarPDFInterno`, que lleva su sello de uso interno. La
// sección 6 mira los dos, porque el programado se puede publicar mal en cada
// uno por su lado, y el motivo que dice CÓMO cargar el anexo tiene que ser
// distinto en cada papel: quien lo carga es otra persona y entra por otro lado.
//
// Uso:  node scripts/prueba-pantalla-dice-de-donde-sale-el-programado.cjs
//       node scripts/prueba-pantalla-dice-de-donde-sale-el-programado.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

// `fechaLocalDeISO` ya no la usa `avanceProgramadoA` —se fue con la recta— así
// que dejó de entrar por el cierre transitivo. Se pide explícitamente porque
// las contrapruebas que REPONEN la recta la necesitan: sin ella la mutación
// reventaría por un `ReferenceError` y saldría «no arrancó» en vez de ROJO, que
// es la contraprueba comprobándose contra su propio andamiaje.
const PEDIDOS = [
  'avanceProgramadoA', 'ROTULO_PROGRAMADO', 'pctProgramadoEnFecha', 'ALERTA_REGLAS',
  'fechaLocalDeISO', 'generarPDFArt73', 'generarPDFInterno',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── La obra y su programa, con la forma de los de verdad ───────────────────
//
// Siete meses, agosto a febrero, con el grueso del dinero al PRINCIPIO. Ese es
// el signo del emisor real: el 2026-09-22 lleva 40.3% programado mientras la
// recta va en 13.0%, 27.3 puntos por encima. El signo se eligió a propósito,
// porque es el que esconde una alerta: con el programa por encima de la recta,
// una obra que va «bien contra la recta» va mal contra lo que firmó.
const OBRA = { id: '0131', inicio: '2026-08-29', fin: '2027-02-24' };

const PROGRAMA = {
  inicio: '2026-08-29',
  meses: 7,
  total: 1000,
  partidas: [
    // $700 de los $1,000 en los dos primeros meses: para el 26 de noviembre el
    // programa pide 70% y la recta apenas 49.7%.
    { sec: '1000 03', montos: [400, 300, 0, 0, 0, 0, 0],
      barra: 'Barra=90.32-100,0-70,0-0,0-0,0-0,0-0,0-0' },
    { sec: '1001 01', montos: [0, 0, 0, 0, 0, 0, 300],
      barra: 'Barra=0-0,0-0,0-0,0-0,0-0,0-0,0-85.71' },
  ],
};

// El mismo programa sin arranque en el archivo: es el DE-5, que no declara
// «Inicio obra». La obra se lo presta y la cifra tiene que seguir siendo del
// programa, no de la recta.
const PROGRAMA_SIN_INICIO = { ...PROGRAMA, inicio: null };

// Una obra sin fechas capturadas y sin programa: no hay contra qué medir.
const OBRA_PELADA = { id: '0199' };

// La fecha de corte. Está a mitad del plazo a propósito: es el punto donde la
// curva S y la recta MÁS se parecen —una curva S cruza la recta por el centro
// por construcción—, así que una aserción que distingue aquí distingue en
// cualquier parte. Medir en el punto fácil sería medir el punto equivocado.
const CORTE = '2026-11-26';

async function correr(fuente) {
  const fn = construir(fuente);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const cerca = (a, b, tol = 0.01) =>
    a !== null && b !== null && Math.abs(a - b) <= tol;

  const A = fn.avanceProgramadoA;
  const ROT = fn.ROTULO_PROGRAMADO;

  // 1 · CON PROGRAMA CARGADO, EL NÚMERO ES EL DEL PROGRAMA
  const conProg = A(OBRA, PROGRAMA, CORTE);
  const sinProg = A(OBRA, null, CORTE);
  check(conProg.fuente === 'programa',
    'con un programa cargado la fuente es el programa',
    `dio ${conProg.fuente}`);
  check(cerca(conProg.pct, fn.pctProgramadoEnFecha(PROGRAMA, CORTE)),
    'y el número es exactamente el que da la cuenta del programa',
    `pantalla ${conProg.pct} · cuenta ${fn.pctProgramadoEnFecha(PROGRAMA, CORTE)}`);

  // 2 · SIN PROGRAMA NO HAY CIFRA — Y LA OBRA TIENE LAS DOS FECHAS
  // Éste es el corte del 2026-11-06. La obra de este fixture tiene inicio y
  // fin capturados, o sea que la recta se PODÍA calcular y daba un número
  // plausible: 49.7% al 26 de noviembre. Lo que se afirma es que ya no sale.
  check(sinProg.pct === null && sinProg.fuente === 'sin_programa',
    'sin programa cargado NO sale cifra, aunque la obra tenga inicio y fin',
    `${sinProg.fuente} · ${JSON.stringify(sinProg.pct)}`);
  check(sinProg.pct !== 0,
    'y el hueco no se rellena con un cero, que diría «no había nada programado»');
  check(A(OBRA, { ok: false, porQue: 'no es un programa' }, CORTE).fuente === 'sin_programa',
    'un programa RECHAZADO al leerlo tampoco produce cifra: no finge ser programa');
  check(A(OBRA_PELADA, null, CORTE).fuente === 'sin_programa',
    'y la obra sin fechas da la MISMA fuente: lo que falta es el anexo, no las fechas');

  // 3 · EL ARRANQUE PRESTADO NO SE PIERDE
  // El DE-5 no declara arranque. Si la falta del dato tirara el programa, un
  // tercio de los programas reales de producción se quedaría sin dibujar
  // teniendo el anexo cargado.
  const heredado = A(OBRA, PROGRAMA_SIN_INICIO, CORTE);
  check(heredado.fuente === 'programa' && heredado.heredado === true,
    'un programa sin arranque propio toma el de la obra y sigue siendo programa',
    `${heredado.fuente} · heredado ${heredado.heredado}`);
  check(cerca(heredado.pct, conProg.pct),
    'y da la misma cifra que si el archivo trajera la fecha',
    `${heredado.pct} vs ${conProg.pct}`);

  // 4 · EL RÓTULO NO MIENTE
  // Con cifra, nombra el contrato. Sin cifra, NO nombra un avance: nombra lo
  // que falta. Un KPI rotulado «Avance programado» con el valor vacío debajo
  // se lee como «el programado es cero».
  const rotSin = ROT[sinProg.fuente];
  const rotProg = ROT[conProg.fuente];
  check(/programado/i.test(rotProg.kpi),
    'con programa cargado el KPI se llama «programado»',
    rotProg.kpi);
  check(/contractual/i.test(rotProg.sub),
    'el subtítulo del programa cita el contrato, que es lo que le da respaldo',
    rotProg.sub);
  check(!!rotSin && !/^avance/i.test(rotSin.kpi),
    'sin programa el KPI NO se titula como un avance: no hay avance que dar',
    rotSin?.kpi);
  check(!!rotSin && /sin programa|falta/i.test(rotSin.kpi),
    'y dice que el programa falta',
    rotSin?.kpi);
  check(!!rotSin && /(AE11|DE-5|carga)/i.test(rotSin.sub),
    'el subtítulo dice qué archivo hay que cargar, que es la única salida',
    rotSin?.sub);
  check(rotProg.kpi !== rotSin.kpi,
    'los dos rótulos son distintos: si fueran iguales, el usuario no podría distinguirlos');
  // 'cargando' NO puede decir lo mismo que 'sin_programa': mientras la lectura
  // viaja todavía no se sabe que falte, y afirmarlo se vería en cada recarga.
  check(ROT.cargando && ROT.cargando.kpi !== rotSin.kpi
        && !/(AE11|DE-5)/i.test(ROT.cargando.sub),
    'mientras el anexo viaja el rótulo no acusa de que falte: todavía no se sabe',
    `${ROT.cargando?.kpi} · ${ROT.cargando?.sub}`);

  // 5 · LA ALERTA DISPARA CONTRA EL PROGRAMA, Y SIN PROGRAMA CALLA
  // Severidad alta, le llega al residente y a la dirección. El umbral es 15
  // puntos y la separación entre la recta y el programa llegaba a 27: aquí el
  // defecto no desviaba una cifra, inventaba y silenciaba alertas.
  const regla = (fn.ALERTA_REGLAS || []).find(r => r.id === 'avance_bajo_programa');
  if (!regla) {
    check(false, 'la regla «avance_bajo_programa» ya no existe en el motor de alertas');
    return fallos;
  }
  const hoy = new Date(2026, 10, 26).getTime();   // 2026-11-26, el mismo corte
  // Un avance que va MUY por debajo del programa, en una obra con las dos
  // fechas capturadas: la recta se podía calcular y daba 49.7%.
  const real = { avancePct: 20 };
  const conP = regla.evaluar(OBRA, { ...real, programa: PROGRAMA }, hoy);
  const sinP = regla.evaluar(OBRA, { ...real, programa: null }, hoy);
  check(conP !== null,
    'con el programa cargado la alerta SÍ dispara en una obra que va bajo programa',
    conP?.detalle);
  check(conP && /programa/i.test(conP.titulo) && !/recta|lineal/i.test(conP.titulo),
    'y el título habla del programa, sin nombrar ninguna recta',
    conP?.titulo);
  check(conP && !/recta|lineal/i.test(conP.detalle),
    'el detalle tampoco: cita el programa y el avance real, nada más',
    conP?.detalle);
  check(sinP === null,
    'SIN programa la alerta de severidad alta no se levanta: no hay contra qué medir',
    sinP?.titulo);
  // La misma obra, un avance aún más bajo, y sigue callada. Sin esto la
  // aserción de arriba pasaría por quedar debajo del umbral y no por el null.
  check(regla.evaluar(OBRA, { avancePct: 0, programa: null }, hoy) === null,
    'ni con la obra en 0%: lo que falta es el anexo, y eso no lo arregla el umbral');
  check(regla.evaluar(OBRA_PELADA, { avancePct: 0, programa: null }, hoy) === null,
    'sin fechas ni programa tampoco se levanta');

  // ── 6 · LOS DOS PAPELES, QUE ES LO QUE SE FIRMA Y SE ENTREGA ──────────────
  //
  // De todas las superficies de este corte, ésta es la única que sale del
  // aparato: se imprime, se guarda en un expediente y la lee alguien que no
  // puede preguntarle nada a la pantalla. Una recta rotulada «programa» en un
  // PDF entregado es la peor versión del defecto, porque sobrevive a cualquier
  // arreglo posterior de la app.
  //
  // Se mueven los generadores DE VERDAD con un jsPDF de mentira y se mira qué
  // texto mandan a dibujar. Las partidas hacen falta: sin ellas el generador
  // toma la rama de «no hay catálogo cargado» y nunca llega a la gráfica donde
  // vive la marca del programa, así que el banco pasaría por no haber mirado.
  //
  // LO QUE SE FUE CON `generarPDFObra`, Y POR QUÉ NO SE LE BUSCÓ ANCLAJE NUEVO.
  // El papel viejo publicaba el programado como una TEJA —rótulo, cifra y pie—
  // y como encabezado de la columna de barras, y este banco afirmaba sobre las
  // dos: que la teja llevara `ROT.sin_programa.kpi`, que su cifra dijera «n/d»
  // y nunca «0%», que la desviación dijera por qué no se midió, y que el
  // encabezado no prometiera «VS PROGRAMADO» sin programado. Ninguno de los dos
  // papeles nuevos tiene teja de programado ni columna de barras: el programado
  // sólo aparece como SERIE de la gráfica en pesos. Medido el 2026-11-12, en
  // los cuatro casos (los dos papeles, con anexo y sin él) no hay ni un `n/d`
  // ni un rótulo de programado fuera de la leyenda. Esas cinco aserciones se
  // retiran con su razón escrita y no se repuntan: buscarle un anclaje parecido
  // volvería una afirmación sobre una teja en una afirmación sobre otra cosa,
  // con el nombre de la vieja.
  const PARTIDAS_PDF = [
    { sec: '1000 03', sub: 'TERRACERÍAS', imp: 600, a: 20 },
    { sec: '1001 01', sub: 'PAVIMENTOS',  imp: 400, a: 20 },
  ];
  const hoja = async (generar, programa) =>
    (await dibujarPDFInterno(generar, {
      obra: { ...OBRA, presupuesto: 1000 }, subs: PARTIDAS_PDF, programa,
      estCargadas: true, evidenciaCargada: true,
    })).map(d => String(d.texto));
  const art73Con = await hoja(fn.generarPDFArt73, PROGRAMA);
  const art73Sin = await hoja(fn.generarPDFArt73, null);
  const intCon   = await hoja(fn.generarPDFInterno, PROGRAMA);
  const intSin   = await hoja(fn.generarPDFInterno, null);
  const dice = (lista, re) => lista.some(t => re.test(t));

  // (a) LA LEYENDA NOMBRA LO QUE DIBUJÓ, Y DECLARA LO QUE NO.
  check(dice(art73Con, /^Avance programado$/) && dice(intCon, /^Avance programado$/),
    'con anexo, los dos papeles nombran la serie del programa en su leyenda');
  check(!dice(art73Con, /no hay programa de obra capturado/)
     && !dice(intCon, /no hay programa de obra capturado/),
    'y ninguno de los dos declara que falte: la dibujaron');
  check(dice(art73Sin, /^Avance programado$/)
     && dice(art73Sin, /no hay programa de obra capturado: carga el anexo en Contrato/),
    'sin anexo el informe del Art. 73 nombra la serie Y dice ahí mismo que no la dibujó, con la tarea');
  check(dice(intSin, /no hay programa de obra capturado: carga el AE11 o el DE-5 en Planeación/),
    'y el documento interno manda a cargarlo donde lo carga la constructora');
  // LOS DOS MOTIVOS NO PUEDEN SER EL MISMO TEXTO. La dependencia no tiene
  // pestaña «Planeación» —su Contrato es de primer nivel—, así que mandarla ahí
  // es mandarla a un sitio que no existe. Un motivo que dice cómo arreglarlo
  // tiene que decirlo bien, y éste va impreso en un expediente.
  check(!dice(art73Sin, /Planeaci/) && !dice(art73Con, /Planeaci/),
    'el papel de la dependencia NO la manda a «Planeación»: esa pestaña no existe en su app');
  check(dice(art73Sin, /sin programa capturado no hay atraso que sombrear/)
     && !dice(art73Con, /sin programa capturado no hay atraso que sombrear/),
    'y el sombreado del atraso dice por qué no está, en vez de salir en blanco');

  // (b) LA AUSENCIA VIAJA A LAS OBSERVACIONES, QUE ES LO QUE SE LEE.
  // Una leyenda la mira quien mira la gráfica. La sección de observaciones la
  // lee quien hojea el informe, y es la que queda en el expediente diciendo qué
  // NO pudo afirmar este papel.
  check(dice(art73Sin, /La serie «Avance programado» no está en la gráfica de la sección 4: no hay programa de obra capturado/),
    'el informe del Art. 73 levanta la ausencia del anexo en sus observaciones, con el motivo que ya declaró la curva');
  check(!dice(art73Con, /La serie «Avance programado» no está/),
    'y no la levanta cuando el anexo sí está');

  // (c) NINGUNA CIFRA DE PROGRAMADO SIN ANEXO.
  // `avc_004` publica «70% programa vs 20% avance» en los dos papeles. Con el
  // anexo es una medición; sin él sería la recta otra vez, impresa.
  check(dice(art73Con, /\d+% programa vs \d+% avance/)
     && dice(intCon, /\d+% programa vs \d+% avance/),
    'con anexo, el atraso se publica con sus dos cifras: contra qué midió y qué midió');
  check(!dice(art73Sin, /% programa vs/) && !dice(intSin, /% programa vs/),
    'y sin anexo esa cifra NO sale en ninguno de los dos papeles');
  // Y no sale callándose: la revisión baja a «no evaluable» nombrando el dato
  // que falta. La conducta del motor de riesgos es de
  // `prueba-tres-estados-del-riesgo` y `prueba-el-semaforo-mide-contra-el-anexo`
  // —ellos mutan `requiere` y el guardia del detector—; aquí se afirma sólo que
  // eso LLEGA AL PAPEL, sin duplicarles la mutación.
  check(dice(art73Sin, /el programa de obra contractual/)
     && dice(intSin, /el programa de obra contractual/),
    'en su lugar la revisión sale como hueco declarado, nombrando el anexo que falta');

  // (d) LA RECTA, SOBRE EL PAPEL.
  // El documento interno no la nombra nunca. El informe del Art. 73 sí, UNA
  // vez y para negarla: su sección 2 publica «plazo transcurrido» junto al
  // avance, y restar esas dos cifras es exactamente el defecto de este corte
  // hecho a mano por quien lee la hoja. Decírselo es la única defensa que tiene
  // un papel impreso, que no puede preguntarle nada a nadie.
  check(!dice(intSin, /recta|lineal/i) && !dice(intCon, /recta|lineal/i),
    'el documento interno no dice «recta» ni «lineal» en ninguna parte');
  check(dice(art73Sin, /recta que nadie firmó/) && dice(art73Con, /recta que nadie firmó/),
    'el informe del Art. 73 le dice a quien lo lee que restar plazo menos avance sería un atraso contra una recta que nadie firmó');
  const rectas = [...art73Con, ...art73Sin].filter(t => /recta|lineal/i.test(t));
  check(rectas.every(t => /nadie firmó/.test(t)),
    'y ésa es la única vez que la nombra: ninguna serie ni ninguna cifra del papel va rotulada con una recta',
    `${rectas.length} mención(es)`);

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver al defecto: no reventar el
// andamiaje, sino publicar la recta como si fuera el programa. El banco sigue
// arrancando y ejecutando, y tiene que salir en ROJO.
const MUTACIONES = [
  // El defecto original, exacto: la pantalla no mira el programa aunque esté
  // cargado. Hoy eso ya no cae a la recta, cae a «sin programa» — que es un
  // defecto distinto y no menos grave: la obra tiene su anexo y la app dice
  // que falta.
  ['ignora el programa cargado',
    'const p = programaConArranque(programa, obra);\n  if (p) {',
    'const p = programaConArranque(programa, obra);\n  if (false) {'],
  // LA RECTA, DE VUELTA. Es la mutación que da nombre a este corte: alguien
  // repone el reparto lineal porque «la gráfica se ve vacía». El número vuelve
  // a salir, plausible, y sin nada que lo respalde.
  ['repone la recta del plazo donde no hay programa',
    "  return { pct: null, fuente: 'sin_programa' };",
    `  const ini = fechaLocalDeISO(obra?.inicio);
  const fin = fechaLocalDeISO(obra?.finAmpliado || obra?.fin);
  const corte = fechaLocalDeISO(fechaISO);
  if (!ini || !fin || !corte || fin <= ini) return { pct: null, fuente: 'sin_programa' };
  return { pct: Math.min(Math.max(((corte - ini) / (fin - ini)) * 100, 0), 100),
           fuente: 'sin_programa' };`],
  // La variante traicionera: usa el programa, pero no lo marca como tal. El
  // número sería correcto y la pantalla diría que falta el anexo.
  ['usa el programa pero declara que no lo hay',
    "return { pct, fuente: 'programa', heredado: !!p.inicioHeredado };",
    "return { pct, fuente: 'sin_programa', heredado: !!p.inicioHeredado };"],
  ['rellena con un cero lo que no sabe',
    "  return { pct: null, fuente: 'sin_programa' };",
    "  return { pct: 0, fuente: 'sin_programa' };"],
  // El rótulo: si el hueco se titula «Avance programado», un valor vacío
  // debajo se lee como un programado en cero.
  ['le pone «Avance programado» al hueco',
    "  sin_programa: { kpi: 'Sin programa cargado', sub: 'carga el AE11 o el DE-5 para medir contra lo contratado' },",
    "  sin_programa: { kpi: 'Avance programado', sub: 'sin programa cargado' },"],
  // Y el otro extremo del mismo rótulo: acusar durante el viaje. Se vería como
  // un parpadeo «falta el anexo» en cada recarga, en obras que sí lo tienen.
  ['acusa de que falta el anexo mientras la lectura viaja',
    "  cargando: { kpi: 'Avance programado', sub: 'leyendo el programa…' },",
    "  cargando: { kpi: 'Sin programa cargado', sub: 'carga el AE11 o el DE-5 para medir contra lo contratado' },"],
  ['el programa sin arranque propio se descarta',
    'const inicio = prog.inicio || obra?.inicio || null;',
    'const inicio = prog.inicio || null;'],
  // EL PAPEL. Eran tres mutaciones sobre `generarPDFObra`: la leyenda que
  // explicaba una marca no dibujada, la observación que se callaba, y el
  // encabezado «AVANCE REAL VS PROGRAMADO» sobre una columna sin programado.
  // Las tres perdieron su anclaje con el papel. Quedan dos, y son las dos que
  // este banco PUEDE tener:
  //
  // LAS COMPUERTAS DE LA LEYENDA NO SE MUTAN AQUÍ, A PROPÓSITO. El
  // `if (fuentePrograma === 'programa' && hayDato(programado))` de
  // `curvaUnicaDeObra` ya es anclaje de `prueba-la-grafica-que-no-miente-por-
  // omision`, el de `curvaDeGobierno` lo es de `prueba-la-grafica-de-gobierno`
  // y de `prueba-las-dos-curvas-y-un-eje`, y los dos motivos también. Dos
  // bancos mutando el mismo anclaje se estorban el día que el anclaje cambia:
  // los dos salen en 2 por la misma razón y hay que arreglar dos archivos para
  // un solo movimiento. Las aserciones (a) de la sección 6 se quedan como
  // guardas sobre una conducta que esas mutaciones ya muerden.
  //
  // Lo mismo con la cifra del atraso: `avc_004` es de
  // `prueba-el-semaforo-mide-contra-el-anexo`, que muta su `requiere` y el
  // guardia del detector. Aquí sólo se afirma que lo que decidan esas reglas
  // llega al papel.
  //
  // Éstas dos sí son de este banco y de nadie más: el acarreo de las ausencias
  // a las observaciones del informe que se entrega, y la frase que le enseña a
  // quien lo lee que el plazo no es la vara del avance.
  ['el informe del Art. 73 se calla en sus observaciones que falta el anexo',
    '  for (const a of (curva.ausentes || []))\n    obs.push(`La serie «${a.nombre || a.clave}» no está en la gráfica de la sección 4: `',
    '  for (const a of [])\n    obs.push(`La serie «${a.nombre || a.clave}» no está en la gráfica de la sección 4: `'],
  // Sin esta frase la sección 2 deja «plazo transcurrido» y «avance físico» uno
  // al lado del otro sin decir que restarlos no es un atraso. El defecto no lo
  // comete entonces la app: lo comete quien lee la hoja, con la hoja de
  // respaldo, y es el único sitio donde todavía se puede cometer.
  ['el papel del cliente deja de decir que el plazo no es la vara del avance',
    "    + 'sería reclamarlo contra una recta que nadie firmó. «Proyección al término» sí '",
    "    + 'sería el atraso de la obra. «Proyección al término» sí '"],
  // La alerta de severidad alta: no mirar el programa que sí está.
  ['la alerta no mira el programa cargado',
    'const p = avanceProgramadoA(obra, datos.programa, fechaEnZonaObra(new Date(hoy)));',
    'const p = avanceProgramadoA(obra, null, fechaEnZonaObra(new Date(hoy)));'],
  // Y la inversa: levantarla igual, con la recta por dentro. Es la forma en
  // que el defecto reaparecería sin tocar `avanceProgramadoA`.
  ['la alerta se levanta contra la recta cuando no hay anexo',
    '      const p = avanceProgramadoA(obra, datos.programa, fechaEnZonaObra(new Date(hoy)));\n      if (p.pct === null) return null;',
    `      const p = avanceProgramadoA(obra, datos.programa, fechaEnZonaObra(new Date(hoy)));
      if (p.pct === null) {
        const i = fechaLocalDeISO(obra?.inicio), f = fechaLocalDeISO(obra?.fin);
        const c = fechaEnZonaObra(new Date(hoy));
        if (!i || !f || f <= i) return null;
        p.pct = Math.min(Math.max(((fechaLocalDeISO(c) - i) / (f - i)) * 100, 0), 100);
      }`],
];

(async () => {
  if (process.argv.includes('--contraprueba')) {
    console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
    let sobrevivieron = 0;
    for (const [titulo, de, a] of MUTACIONES) {
      if (!cuerpo.includes(de)) {
        console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje en la fuente`);
        process.exit(2);
      }
      let fallos;
      process.env.CALLADO = '1';
      try { fallos = await correr(cuerpo.replace(de, a)); }
      catch (e) {
        // Reventar NO es salir en rojo: mide que el taller sabe parsear, no que
        // la aserción muerda. Contarlo como ROJO deja pasar mutaciones que en
        // realidad nadie detecta, así que es NO ARRANCÓ, que es un 2.
        console.error(`NO ARRANCÓ: la mutación «${titulo}» revienta el trozo ` +
                      `en vez de romper la semántica: ${e.message}`);
        process.exit(2);
      }
      delete process.env.CALLADO;
      if (fallos.length) {
        console.log(`   ✓ ROJO  ${titulo}  ·  ${fallos.length} aserción(es) mordieron`);
        console.log(`           la primera: ${fallos[0]}`);
      } else {
        console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
        sobrevivieron++;
      }
    }
    if (sobrevivieron) {
      console.error(`\nROJO: ${sobrevivieron} mutación(es) sobrevivieron. Las aserciones no muerden.`);
      process.exit(1);
    }
    console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.`);
    process.exit(0);
  }

  console.log('LA PANTALLA DICE DE DÓNDE SALE EL PROGRAMADO · #51\n');
  const fallos = await correr(cuerpo);
  if (fallos.length) {
    console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nverde');
  process.exit(0);
})();
