#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL PROGRAMA NO ES UNA RECTA — PENDIENTES #51
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. El «avance programado» se repartía en línea recta sobre
// el plazo. Medido el 2026-11-04 sobre tres programas reales de producción,
// pasados por el parser de la app (`scripts/medir-programa-real-se-lee.cjs`),
// donde más se separan la recta y el programa difieren +27.3 puntos en el
// emisor, −9.9 en el colector y −17.2 en la Cangrejera. O sea que la
// «desviación» que la app publicaba era la distancia a una recta inventada, y
// el art. 61 manda medir contra el programa CONTRACTUAL.
//
// Las cifras son el MÁXIMO a lo largo del plazo, no el punto medio. A mitad del
// plazo dieron +17.4, +0.3 y −5.9: en el colector el punto medio dice 0.3 donde
// el máximo dice −9.9, porque una curva S cruza la recta por el centro por
// construcción. Medir ahí habría dado la conclusión contraria a la correcta.
//
// Lo que se afirma aquí es CONDUCTA: los pesos y el por ciento que la cuenta
// devuelve ante un programa con forma real. No se afirma que exista ningún
// nombre — los nombres se piden sólo para PODER EJECUTAR la cuenta de verdad,
// extraída de `src/App.jsx`.
//
// ── LAS CUATRO MANERAS DE ARRUINAR ESTO ────────────────────────────────────
//
//   1. INVENTAR UN CERO. Sin programa cargado la respuesta es «no se sabe»,
//      no «0% programado». Un cero ahí se lee como «no había nada que hacer
//      todavía», que convierte a cualquier obra en adelantada.
//   2. TIRAR LA BARRA. La fila `Barra=` es la que da resolución intra-mes. Sin
//      ella un programa mensual sólo se puede leer el día 1, y el avance de la
//      app es semanal: habría que inventar el reparto dentro del mes.
//   3. CONFUNDIR EL MES CON TREINTA DÍAS. Los meses del programa son meses de
//      CALENDARIO, y el porcentaje de la barra es el día de ESE mes. Tomarlos
//      como bloques de 30 días desde el arranque corre las fechas varios días
//      y, en una obra de siete meses, acumula una semana de corrimiento.
//   4. PERDER EL DINERO DE UN MES QUE NO SE ENTENDIÓ. Si la barra de un mes no
//      se puede leer, su importe se reparte a lo largo del mes entero. Lo que
//      no puede pasar es que desaparezca: el programa dejaría de sumar su
//      propio total y el por ciento saldría inflado para siempre.
//
// LOS DOS ANCLAJES. El formato de la barra no se supuso. El archivo del emisor
// declara su arranque y su fin por separado, y la barra los reproduce:
//
//     90.32% de agosto 2026 (31 días) = 28/31 → día 29  = «Inicio obra»
//     85.71% de febrero 2027 (28 días) = 24/28 → día 24 = «Fin obra»
//
// Las dos cuentas se exigen aquí, y son la razón por la que la mutación 3 tiene
// que salir en rojo: con meses de 30 días, 90.32% cae el día 28 y no el 29.
//
// Uso:  node scripts/prueba-programa-no-es-una-recta.cjs
//       node scripts/prueba-programa-no-es-una-recta.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = [
  'tramosDeBarra', 'diasDelMes', 'mesesDelPrograma', 'diaDeBarra',
  'acumuladoProgramado', 'pctProgramadoEnFecha', 'programaConArranque',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── Programas de prueba, con la forma de los de verdad ─────────────────────
//
// Mensuales, por monto, con una fila `Barra=` por partida y el arranque a
// media quincena, que es lo que traen los AE11 de la SIOP.

// Arranca el 29 de agosto de 2026. Siete meses de calendario: ago…feb.
// Los dos anclajes verificados viven aquí: la primera partida arranca el 29 de
// agosto (90.32% de un mes de 31) y la última cierra el 24 de febrero (85.71%
// de un mes de 28).
const EMISOR = {
  inicio: '2026-08-29',
  meses: 7,
  total: 2000,
  partidas: [
    { sec: '1000 03', montos: [100, 900, 0, 0, 0, 0, 0],
      barra: 'Barra=90.32-100,0-70,0-0,0-0,0-0,0-0,0-0' },
    { sec: '1001 01', montos: [0, 0, 0, 0, 0, 0, 1000],
      barra: 'Barra=0-0,0-0,0-0,0-0,0-0,0-0,0-85.71' },
  ],
};

// Todo el dinero en el último mes. Es el programa donde la recta miente más, y
// existe para que la mentira se pueda medir en puntos.
const COLA = {
  inicio: '2026-08-29',
  meses: 7,
  total: 1000,
  partidas: [
    { sec: 'EP 9003 04', montos: [0, 0, 0, 0, 0, 0, 1000],
      barra: 'Barra=0-0,0-0,0-0,0-0,0-0,0-0,0-100' },
  ],
};

// Arranca el último día de enero. Sirve para distinguir meses de CALENDARIO de
// bloques de 30 días: con calendario, el mes 2 es febrero y empieza el 1 de
// febrero; con bloques, no empezaría hasta el 2 de marzo.
const FIN_DE_MES = {
  inicio: '2026-01-31',
  meses: 2,
  total: 1000,
  partidas: [
    { sec: 'A.1', montos: [0, 1000], barra: 'Barra=0-0,0-100' },
  ],
};

// Las partidas suman MÁS que el total que el programa declara. No es un caso
// de laboratorio: la medición del 2026-11-04 encontró una obra cuyo contrato
// cargado y cuyo catálogo difieren en $14.6M (#95). Cuando el numerador y el
// denominador vienen de dos sitios, pueden discrepar — y el por ciento no
// puede salir por arriba de 100 ni por abajo de 0.
const DESCUADRADO = {
  inicio: '2026-03-01',
  meses: 2,
  total: 1000,
  partidas: [
    { sec: 'C.1', montos: [0, 1600], barra: 'Barra=0-0,0-100' },
    // Una partida deductiva, y sola en el primer mes: el programa arranca
    // restando, así que el acumulado es NEGATIVO antes de abril.
    { sec: 'C.2', montos: [-200, 0], barra: 'Barra=0-100,0-0' },
  ],
};

// La barra del primer mes no se puede leer. El importe de ese mes NO se pierde.
const BARRA_ILEGIBLE = {
  inicio: '2026-03-01',
  meses: 2,
  total: 1000,
  partidas: [
    { sec: 'B.1', montos: [500, 500], barra: 'Barra=vino-aquí-otra-cosa,0-100' },
  ],
};

// ── Las aserciones ─────────────────────────────────────────────────────────

function correr(fuente) {
  const fn = construir(fuente);
  const fallos = [];
  const cerca = (a, b, tol = 0.01) =>
    a !== null && b !== null && Math.abs(a - b) <= tol;
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };

  const acum = (p, f) => fn.acumuladoProgramado(p, f);
  const pct = (p, f) => fn.pctProgramadoEnFecha(p, f);

  // 1 · SIN PROGRAMA NO SE INVENTA UN NÚMERO
  check(pct(null, '2026-10-01') === null,
    'sin programa el programado es null, no 0',
    `dio ${JSON.stringify(pct(null, '2026-10-01'))}`);
  check(pct({ ...EMISOR, inicio: null }, '2026-10-01') === null,
    'sin arranque declarado el programado es null',
    `dio ${JSON.stringify(pct({ ...EMISOR, inicio: null }, '2026-10-01'))}`);
  check(pct({ ...EMISOR, total: 0 }, '2026-10-01') === null,
    'con total 0 el programado es null, no una división entre cero');
  check(pct(EMISOR, 'no-es-fecha') === null,
    'con una fecha que no se entiende el programado es null');

  // 2 · EL ANCLAJE DEL ARRANQUE: 90.32% de agosto es el día 29
  check(cerca(acum(EMISOR, '2026-08-29'), 0),
    'el día del arranque no hay nada acumulado todavía',
    `dio ${acum(EMISOR, '2026-08-29')}`);
  check(cerca(acum(EMISOR, '2026-08-28'), 0),
    'el día anterior al arranque tampoco');
  // Del 29 de agosto al 1 de septiembre son 3 días; un día es un tercio.
  check(cerca(acum(EMISOR, '2026-08-30'), 100 / 3),
    'al día siguiente del arranque va un tercio del primer mes',
    `dio ${acum(EMISOR, '2026-08-30')}`);
  check(cerca(acum(EMISOR, '2026-09-01'), 100),
    'al cerrar agosto está el importe entero del mes 1',
    `dio ${acum(EMISOR, '2026-09-01')}`);

  // 3 · EL ANCLAJE DEL CIERRE: 85.71% de febrero es el día 24
  check(cerca(acum(EMISOR, '2027-02-25'), 2000),
    'el programa completo se alcanza al terminar el 24 de febrero',
    `dio ${acum(EMISOR, '2027-02-25')}`);
  check(acum(EMISOR, '2027-02-24') < 2000,
    'el 24 de febrero todavía no está completo: ese día se trabaja',
    `dio ${acum(EMISOR, '2027-02-24')}`);
  check(cerca(fn.diaDeBarra(2027, 2, 85.71).getDate(), 25),
    '85.71% de un mes de 28 días cae al terminar el día 24',
    `dio el día ${fn.diaDeBarra(2027, 2, 85.71).getDate()}`);
  check(cerca(fn.diaDeBarra(2026, 8, 90.32).getDate(), 29),
    '90.32% de un mes de 31 días cae el día 29',
    `dio el día ${fn.diaDeBarra(2026, 8, 90.32).getDate()}`);

  // 4 · LA BARRA MANDA DENTRO DEL MES
  // El mes 2 tiene barra 0-70: del 1 al 22 de septiembre, no los 30 días.
  check(cerca(acum(EMISOR, '2026-09-22'), 1000),
    'el importe del mes 2 se completa el día 22, donde acaba su barra',
    `dio ${acum(EMISOR, '2026-09-22')}`);
  check(cerca(acum(EMISOR, '2026-09-11'), 100 + 900 * (10 / 21)),
    'a mitad de la barra del mes 2 va la mitad de su importe',
    `dio ${acum(EMISOR, '2026-09-11')}`);
  check(cerca(acum(EMISOR, '2026-09-30'), 1000),
    'pasada la barra no se sigue acumulando de ese mes');

  // 5 · MESES DE CALENDARIO, NO BLOQUES DE TREINTA DÍAS
  const meses = fn.mesesDelPrograma('2026-08-29', 7);
  check(meses.length === 7 && meses[0][1] === 8 && meses[6][0] === 2027 && meses[6][1] === 2,
    'siete meses desde agosto de 2026 terminan en febrero de 2027',
    JSON.stringify(meses));
  check(acum(FIN_DE_MES, '2026-02-15') > 0,
    'arrancando el 31 de enero, el mes 2 es febrero y ya corre el 15',
    `dio ${acum(FIN_DE_MES, '2026-02-15')}`);
  check(cerca(acum(FIN_DE_MES, '2026-03-01'), 1000),
    'y el mes 2 cierra al acabar febrero',
    `dio ${acum(FIN_DE_MES, '2026-03-01')}`);
  check(fn.diasDelMes(2026, 2) === 28 && fn.diasDelMes(2024, 2) === 29
    && fn.diasDelMes(2026, 8) === 31,
    'los días del mes son los del calendario, con año bisiesto incluido');

  // 6 · UN MES QUE NO SE ENTENDIÓ NO PIERDE SU DINERO
  const tr = fn.tramosDeBarra('Barra=vino-aquí-otra-cosa,0-100');
  check(Array.isArray(tr) && tr.length === 2 && tr[0] === null,
    'un tramo ilegible entra como null, distinto de «este mes no hay barra»',
    JSON.stringify(tr));
  check(cerca(acum(BARRA_ILEGIBLE, '2026-04-01'), 500),
    'con la barra ilegible, el importe del mes se reparte en el mes entero',
    `dio ${acum(BARRA_ILEGIBLE, '2026-04-01')}`);
  check(cerca(acum(BARRA_ILEGIBLE, '2026-05-01'), 1000),
    'y el programa sigue sumando su propio total',
    `dio ${acum(BARRA_ILEGIBLE, '2026-05-01')}`);
  check(fn.tramosDeBarra('Barra=0-0,0-0')[0][0] === 0,
    'un tramo 0-0 sí se entiende: es un mes sin barra');

  // 7 · LO QUE JUSTIFICA TODO: NO ES UNA RECTA
  // A mitad del plazo la recta dice la mitad. El programa de cola dice casi
  // nada, porque su dinero está al final. La separación es el defecto #51.
  const ini = new Date(2026, 7, 29); const fin = new Date(2027, 1, 24);
  const mitad = new Date((ini.getTime() + fin.getTime()) / 2);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const recta = ((mitad - ini) / (fin - ini)) * 100;
  const real = pct(COLA, iso(mitad));
  check(real !== null && Math.abs(real - recta) > 10,
    'a mitad del plazo el programa real se separa de la recta más de 10 puntos',
    `recta ${recta.toFixed(1)}% · programa ${real === null ? 'null' : real.toFixed(1) + '%'}`);
  check(pct(EMISOR, '2027-02-25') === 100 && pct(EMISOR, '2026-08-29') === 0,
    'el por ciento va de 0 al arrancar a 100 al cerrar');
  check(pct(EMISOR, '2028-01-01') === 100,
    'pasado el plazo se topa en 100, no se pasa');
  // Σ partidas = 1400 al cerrar, contra un total declarado de 1000. El
  // acumulado en pesos dice la verdad; el por ciento se topa.
  check(cerca(acum(DESCUADRADO, '2026-05-01'), 1400),
    'el acumulado en pesos no se topa: dice lo que suman las partidas',
    `dio ${acum(DESCUADRADO, '2026-05-01')}`);
  check(acum(DESCUADRADO, '2026-03-05') < 0,
    'con una partida deductiva sola al principio, el acumulado sale negativo',
    `dio ${acum(DESCUADRADO, '2026-03-05')}`);
  check(pct(DESCUADRADO, '2026-05-01') === 100,
    'si las partidas suman más que el total declarado, el por ciento se topa en 100',
    `dio ${pct(DESCUADRADO, '2026-05-01')}`);
  check(pct(DESCUADRADO, '2026-03-05') === 0,
    'y si el programa arranca restando, no sale un por ciento negativo',
    `dio ${pct(DESCUADRADO, '2026-03-05')}`);

  // 8 · EL ARRANQUE QUE EL ARCHIVO NO TRAE
  // El AE11 declara «Inicio obra»; el DE-5 no. La sustitución se hace al LEER
  // y no al guardar, para que el documento no afirme que el archivo traía una
  // fecha que no traía. Lo que se exige aquí es que la sustitución no mienta
  // en ninguna de las dos direcciones: ni pisa el dato del archivo, ni se
  // inventa un mes cuando no hay por dónde.
  const pca = fn.programaConArranque;
  const SIN_INICIO = { ...EMISOR, inicio: null };
  check(pca(EMISOR, { inicio: '2020-01-01' }) === EMISOR,
    'cuando el archivo declara su arranque, la obra NO lo pisa',
    `quedó ${pca(EMISOR, { inicio: '2020-01-01' })?.inicio}`);
  const heredado = pca(SIN_INICIO, { inicio: '2026-08-29' });
  check(heredado?.inicio === '2026-08-29' && heredado.inicioHeredado === true,
    'cuando no lo declara, se toma el de la obra y queda MARCADO como heredado',
    `${heredado?.inicio} · heredado ${heredado?.inicioHeredado}`);
  check(cerca(pct(heredado, '2026-09-01'), pct(EMISOR, '2026-09-01')),
    'y con el arranque heredado la cuenta sale igual que si el archivo lo trajera',
    `heredado ${pct(heredado, '2026-09-01')} · del archivo ${pct(EMISOR, '2026-09-01')}`);
  check(pca(SIN_INICIO, { inicio: null }) === null,
    'sin arranque por ningún lado devuelve null: adivinar el mes correría el programa entero');
  check(pca({ ...EMISOR, partidas: [] }, null) === null &&
    pca({ ...EMISOR, total: 0 }, null) === null &&
    pca(null, null) === null && pca({ ok: false, porQue: 'x' }, null) === null,
    'un programa vacío, sin total, ausente o rechazado tampoco pasa por aquí');

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación rompe la SEMÁNTICA de la cuenta, no el andamiaje: el banco
// sigue arrancando y ejecutando, y tiene que salir en ROJO. Una mutación que
// hiciera reventar la extracción probaría que la extracción funciona, no que
// las aserciones muerden.
const MUTACIONES = [
  ['inventa un cero donde no sabe',
    'if (acum === null) return null;', 'if (acum === null) return 0;'],
  ['tira la barra y reparte en el mes entero',
    'const tr = barra[i];', 'const tr = null;'],
  ['toma el mes como treinta días',
    'const d = diasDelMes(año, mes);\n  const offset', 'const d = 30;\n  const offset'],
  ['pierde el dinero del mes que no entendió',
    '        d0 = new Date(año, mes - 1, 1);', '        continue;\n        d0 = new Date(año, mes - 1, 1);'],
  ['no topa en cien al pasarse del plazo',
    'return Math.min(Math.max((acum / total) * 100, 0), 100);',
    'return (acum / total) * 100;'],
  ['el arranque de la obra le gana al que declara el archivo',
    'const inicio = prog.inicio || obra?.inicio || null;',
    'const inicio = obra?.inicio || prog.inicio || null;'],
  ['se inventa un mes cuando nadie declara el arranque',
    "if (!inicio) return null;\n  if (prog.inicio === inicio) return prog;",
    "if (!inicio) return { ...prog, inicio: '2026-01-01' };\n  if (prog.inicio === inicio) return prog;"],
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

console.log('EL PROGRAMA NO ES UNA RECTA · #51\n');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
