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
//   · que sin programa cargado el número sigue saliendo, pero ROTULADO como
//     recta, y que la palabra «programado» NO aparece en ese rótulo;
//   · que cuando no hay nada contra qué medir el número es `null` y no 0;
//   · y que la alerta de «avance bajo programa» —la que le llega al residente
//     con severidad alta— dispara contra el programa cuando lo hay.
//
// EL RÓTULO ES LA MITAD DEL DEFECTO. Medido el 2026-11-04 sobre los tres
// programas reales de producción, la recta se separa del programa hasta 27.3
// puntos (emisor), −9.9 (colector) y +14.1 (la Cangrejera). Una app que publica
// la recta llamándola «Avance programado» no da una cifra aproximada: da una
// cifra con un respaldo contractual que no tiene. Y el signo importa, porque
// son dos defectos distintos: con la recta por debajo del programa una obra
// atrasada se publica como al día, y con la recta por encima una obra al día se
// publica como atrasada.
//
// POR QUÉ LA ALERTA Y NO SÓLO EL KPI. El umbral de la alerta es 15 puntos de
// desviación. La separación entre la recta y el programa llega a 27. O sea que
// el disparo de una alerta de severidad alta lo decidía el error de la cuenta y
// no el estado de la obra. Es el sitio donde este defecto cuesta más caro.
//
// Lo que se afirma es CONDUCTA: el número y el rótulo que devuelven las cuentas
// extraídas de `src/App.jsx` y ejecutadas aquí. No se afirma que exista ningún
// nombre; los nombres se piden sólo para poder ejecutar.
//
// LO QUE ESTE BANCO NO ALCANZA. `generarPDFObra` no se puede ejecutar fuera del
// navegador —necesita jsPDF desde un CDN y un `document`—, así que el rótulo de
// la hoja 1 del PDF y el de su leyenda no se afirman aquí. Lo que sí se afirma
// es la fuente de la que los dos leen, que es `avanceProgramadoA`: si ésa no
// distingue, ningún rótulo del PDF puede distinguir. Queda dicho para que nadie
// lea este banco como si cubriera el PDF.
//
// Uso:  node scripts/prueba-pantalla-dice-de-donde-sale-el-programado.cjs
//       node scripts/prueba-pantalla-dice-de-donde-sale-el-programado.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = [
  'avanceProgramadoA', 'ROTULO_PROGRAMADO', 'pctProgramadoEnFecha', 'ALERTA_REGLAS',
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

function correr(fuente) {
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
  const conProg = A(OBRA, PROGRAMA, CORTE, OBRA.fin);
  const sinProg = A(OBRA, null, CORTE, OBRA.fin);
  check(conProg.fuente === 'programa',
    'con un programa cargado la fuente es el programa',
    `dio ${conProg.fuente}`);
  check(cerca(conProg.pct, fn.pctProgramadoEnFecha(PROGRAMA, CORTE)),
    'y el número es exactamente el que da la cuenta del programa',
    `pantalla ${conProg.pct} · cuenta ${fn.pctProgramadoEnFecha(PROGRAMA, CORTE)}`);
  check(sinProg.fuente === 'recta' && sinProg.pct !== null,
    'sin programa cargado la cifra sigue saliendo, pero marcada como recta',
    `${sinProg.fuente} ${sinProg.pct}`);
  // Esto es el defecto #51 expresado como aserción: si las dos cifras fueran
  // la misma, cambiar la fuente no habría cambiado nada en la pantalla.
  check(Math.abs(conProg.pct - sinProg.pct) > 10,
    'las dos cifras se separan más de 10 puntos: cargar el programa SÍ cambia lo que se publica',
    `programa ${conProg.pct.toFixed(1)}% · recta ${sinProg.pct.toFixed(1)}%`);

  // 2 · EL ARRANQUE PRESTADO NO DEGRADA A RECTA
  // El DE-5 no declara arranque. Si la falta del dato hiciera caer a la recta,
  // un tercio de los programas reales de producción se leería como recta sin
  // que nadie lo notara, porque la pantalla diría un número plausible.
  const heredado = A(OBRA, PROGRAMA_SIN_INICIO, CORTE, OBRA.fin);
  check(heredado.fuente === 'programa' && heredado.heredado === true,
    'un programa sin arranque propio toma el de la obra y sigue siendo programa',
    `${heredado.fuente} · heredado ${heredado.heredado}`);
  check(cerca(heredado.pct, conProg.pct),
    'y da la misma cifra que si el archivo trajera la fecha',
    `${heredado.pct} vs ${conProg.pct}`);

  // 3 · SIN NADA CONTRA QUÉ MEDIR, null — NUNCA CERO
  // Un 0% programado no se lee como «no se sabe»: se lee como «no había nada
  // que hacer todavía», y eso convierte a cualquier obra en adelantada.
  const nada = A(OBRA_PELADA, null, CORTE);
  check(nada.pct === null && nada.fuente === 'sin_datos',
    'sin programa y sin fechas el programado es null y la fuente lo dice',
    `${nada.fuente} · ${JSON.stringify(nada.pct)}`);
  check(A({ id: 'x', inicio: '2026-05-01', fin: '2026-05-01' }, null, CORTE).pct === null,
    'con inicio y fin el mismo día tampoco se inventa un reparto');
  check(A(OBRA, { ok: false, porQue: 'no es un programa' }, CORTE, OBRA.fin).fuente === 'recta',
    'un programa RECHAZADO al leerlo no se usa: cae a la recta, no finge ser programa');

  // 4 · EL RÓTULO NO MIENTE
  // Éste es el corazón del corte: la cifra de la recta puede publicarse, pero
  // no con el nombre del programa contractual.
  const rotRecta = ROT[sinProg.fuente];
  const rotProg = ROT[conProg.fuente];
  const rotNada = ROT[nada.fuente];
  check(/programado/i.test(rotProg.kpi),
    'con programa cargado el KPI se llama «programado»',
    rotProg.kpi);
  check(!/programad/i.test(rotRecta.kpi),
    'sin programa cargado el KPI NO usa la palabra «programado»',
    rotRecta.kpi);
  check(/lineal|recta/i.test(rotRecta.kpi) && /sin programa/i.test(rotRecta.sub),
    'y dice que es lineal y que no hay programa cargado',
    `${rotRecta.kpi} · ${rotRecta.sub}`);
  check(/contractual/i.test(rotProg.sub),
    'el subtítulo del programa cita el contrato, que es lo que le da respaldo',
    rotProg.sub);
  check(rotProg.kpi !== rotRecta.kpi,
    'los dos rótulos son distintos: si fueran iguales, el usuario no podría distinguirlos');
  check(!!rotNada && /sin programa ni fechas/i.test(rotNada.sub),
    'y el caso sin datos tiene su propio rótulo, no el del programa',
    rotNada?.sub);

  // 5 · LA ALERTA DISPARA CONTRA EL PROGRAMA, NO CONTRA LA RECTA
  // Severidad alta, le llega al residente y a la dirección. El umbral es 15
  // puntos y la separación entre las dos cuentas llega a 27: aquí el defecto
  // no desviaba una cifra, inventaba y silenciaba alertas.
  const regla = (fn.ALERTA_REGLAS || []).find(r => r.id === 'avance_bajo_programa');
  if (!regla) {
    check(false, 'la regla «avance_bajo_programa» ya no existe en el motor de alertas');
    return fallos;
  }
  const hoy = new Date(2026, 10, 26).getTime();   // 2026-11-26, el mismo corte
  // Avance real por encima de la recta pero MUY por debajo del programa: con la
  // recta no hay alerta y con el programa sí. Es el caso que la app no veía.
  const real = { avancePct: sinProg.pct + 1 };
  const conP = regla.evaluar(OBRA, { ...real, programa: PROGRAMA }, hoy);
  const sinP = regla.evaluar(OBRA, { ...real, programa: null }, hoy);
  check(conP !== null,
    'con el programa cargado la alerta SÍ dispara en una obra que va bajo programa',
    conP?.detalle);
  check(sinP === null,
    'y con la recta esa misma obra no disparaba: la alerta se perdía',
    sinP?.detalle);
  check(conP && /programa/i.test(conP.titulo) && !/recta/i.test(conP.titulo),
    'el título de la alerta habla del programa cuando el programa existe',
    conP?.titulo);
  // El caso inverso: una obra que va bajo la recta, sin programa cargado. La
  // alerta tiene que seguir saliendo —es información útil— pero no puede
  // afirmar que va bajo un programa que nadie cargó.
  const bajoRecta = regla.evaluar(OBRA, { avancePct: 1, programa: null }, hoy);
  check(bajoRecta !== null && /recta/i.test(bajoRecta.titulo) && !/bajo programa/i.test(bajoRecta.titulo),
    'sin programa, la alerta sale pero se titula contra la recta, no contra el programa',
    bajoRecta?.titulo);
  check(bajoRecta !== null && /no tiene programa cargado/i.test(bajoRecta.detalle),
    'y el detalle avisa que esta obra no tiene programa cargado',
    bajoRecta?.detalle);
  // Sin fechas y sin programa no hay desviación que reportar. Una alerta de
  // severidad alta levantada sobre un null sería la peor versión del defecto.
  check(regla.evaluar(OBRA_PELADA, { avancePct: 0, programa: null }, hoy) === null,
    'sin fechas ni programa la alerta no se levanta: no hay contra qué medir');

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver al defecto: no reventar el
// andamiaje, sino publicar la recta como si fuera el programa. El banco sigue
// arrancando y ejecutando, y tiene que salir en ROJO.
const MUTACIONES = [
  // El defecto original, exacto: la pantalla calcula la recta y no mira el
  // programa aunque esté cargado.
  ['ignora el programa cargado y publica la recta',
    'const p = programaConArranque(programa, obra);\n  if (p) {',
    'const p = programaConArranque(programa, obra);\n  if (false) {'],
  // La variante traicionera: usa el programa, pero lo rotula como recta. El
  // número sería correcto y el usuario no sabría que lo es.
  ['usa el programa pero lo rotula como recta',
    "return { pct, fuente: 'programa', heredado: !!p.inicioHeredado };",
    "return { pct, fuente: 'recta', heredado: !!p.inicioHeredado };"],
  // La inversa, que es la que hace daño en una junta: la recta firmada como
  // programa contractual.
  ['rotula la recta como si fuera el programa',
    "    pct: Math.min(Math.max(((corte - ini) / (fin - ini)) * 100, 0), 100),\n    fuente: 'recta',",
    "    pct: Math.min(Math.max(((corte - ini) / (fin - ini)) * 100, 0), 100),\n    fuente: 'programa',"],
  ['rellena con un cero lo que no sabe',
    "if (!ini || !fin || !corte || fin <= ini) return { pct: null, fuente: 'sin_datos' };",
    "if (!ini || !fin || !corte || fin <= ini) return { pct: 0, fuente: 'recta' };"],
  // El rótulo, que es la mitad del corte: si la recta se llama «programado»,
  // la distinción deja de existir para quien lee la pantalla.
  ['le pone «Avance programado» a la recta',
    "recta: { kpi: 'Avance lineal', sub: 'sin programa cargado: reparto lineal del plazo' },",
    "recta: { kpi: 'Avance programado', sub: 'reparto lineal del plazo' },"],
  ['el programa sin arranque propio degrada a recta',
    'const inicio = prog.inicio || obra?.inicio || null;',
    'const inicio = prog.inicio || null;'],
  // La alerta: volver a la recta en la regla de severidad alta.
  ['la alerta vuelve a medirse contra la recta',
    'const p = avanceProgramadoA(obra, datos.programa, fechaEnZonaObra(new Date(hoy)), obra.fin);',
    'const p = avanceProgramadoA(obra, null, fechaEnZonaObra(new Date(hoy)), obra.fin);'],
  ['la alerta dice «bajo programa» aunque no haya programa',
    '        titulo: esProg\n          ? "Avance físico más de 15% bajo programa"\n          : "Avance físico más de 15% bajo la recta del plazo",',
    '        titulo: "Avance físico más de 15% bajo programa",'],
];

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
    try { fallos = correr(cuerpo.replace(de, a)); }
    catch (e) { fallos = [`revienta: ${e.message}`]; }
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
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
