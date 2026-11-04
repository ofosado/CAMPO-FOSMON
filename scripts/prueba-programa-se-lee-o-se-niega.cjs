#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL PROGRAMA SE LEE O SE NIEGA — PENDIENTES #51
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. Un presupuesto mal leído se nota: salen claves raras y
// el total no cuadra con el contrato. Un PROGRAMA mal leído no se nota — sale
// una curva plausible — y contra esa curva se decide si una obra va atrasada.
// Por eso `parsearPrograma` se niega en vez de adivinar, y aquí se exige que
// se niegue.
//
// LO QUE SE AFIRMA ES CONDUCTA: qué partidas, qué pesos y qué avisos salen de
// una hoja con la forma de las de verdad, y qué dice cuando no puede leerla.
// La cuenta se extrae de `src/App.jsx` y se EJECUTA.
//
// ── LAS DOS FORMAS OFICIALES, Y POR QUÉ SE CONFUNDEN ───────────────────────
//
// El AE11 (obra pública estatal) pone UN renglón por partida con los pesos del
// mes, y una columna «Total» ANTES y DESPUÉS de los meses. El DE-5 (Pemex)
// pone DOS renglones: arriba el VOLUMEN del mes, abajo el IMPORTE, y una sola
// columna «Total», al final.
//
// Leer el DE-5 como si fuera AE11 es el error caro: se tomarían las TONELADAS
// del mes como si fueran pesos. En el caso real medido eso convierte
// $75,635,416 en 1,247 — y la curva seguiría dibujándose, con la forma
// equivocada y sin una sola señal de que algo salió mal.
//
// El discriminador no es «el de abajo trae números más grandes», que es
// adivinar. Es estructural y se mide: en el renglón de volumen los meses suman
// la CANTIDAD de la partida; en el de importe suman su TOTAL.
//
// Uso:  node scripts/prueba-programa-se-lee-o-se-niega.cjs
//       node scripts/prueba-programa-se-lee-o-se-niega.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const path = require('path');
const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = ['parsearPrograma', 'pctProgramadoEnFecha', 'acumuladoProgramado'];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── Las hojas de prueba, con la forma de las de verdad ─────────────────────
//
// Los renglones están donde están en los archivos reales: el encabezado del
// AE11 en el 18 y el del DE-5 en el 13. No es decorado — el parser tiene que
// encontrarlo sin que se le diga dónde, y una hoja cuyo encabezado estuviera
// en el primer renglón no probaría eso.

const vacia = (n) => Array.from({ length: n }, () => null);
const en = (n, pares) => {
  const f = vacia(n);
  for (const [i, v] of pares) f[i] = v;
  return f;
};

// AE11: arranca el 29 de agosto de 2026 (serial 46263). Tres meses.
// Columnas: 0 Código · 1 Descripción · 2 Unidad · 3 Cantidad · 4 Total ·
//           5,6,7 Mes 1..3 · 8 Total
const AE11 = [
  en(9, [[0, 'GRUPO PENTÁGONO CONSTRUCCIONES S.A. DE C.V.']]),
  vacia(9),
  en(9, [[0, 'Cliente:'], [1, 'GOBIERNO DEL ESTADO DE VERACRUZ']]),
  vacia(9), vacia(9),
  en(9, [[0, 'Concurso No:'], [1, 'AD-112T00000-6000-031-2026']]),
  en(9, [[0, 'Obra:'], [1, 'REHABILITACIÓN DE RED DE DRENAJE SANITARIO (EMISOR)']]),
  vacia(9), vacia(9), vacia(9), vacia(9),
  en(9, [[4, 'Duración:'], [5, '90 días naturales']]),
  en(9, [[4, 'Inicio obra:'], [5, 46263]]),
  en(9, [[0, 'Lugar:'], [1, 'Coatzacoalcos, Veracruz'], [4, 'Fin obra:'], [5, 46352]]),
  vacia(9),
  en(9, [[0, 'ANEXO AE11.- PROGRAMA MENSUAL DE EROGACIONES']]),
  vacia(9),
  en(9, [[0, 'Código'], [1, 'Descripción'], [2, 'Unidad'], [3, 'Cantidad'],
    [4, 'Total'], [5, 'Mes  1'], [6, 'Mes  2'], [7, 'Mes  3'], [8, 'Total']]),
  // Renglón de sección: trae código y descripción, pero no unidad.
  en(9, [[0, '1.-'], [1, 'REHABILITACIÓN DE EMISOR SANITARIO'],
    [5, 0], [6, 0], [7, 0], [8, 0]]),
  // Renglón de subsección: sólo código y descripción.
  en(9, [[0, '1000 00'], [1, 'RUPTURA Y DEMOLICIÓN DE:']]),
  en(9, [[0, '1000 03'], [1, 'BANQUETA DE CONCRETO.'], [2, 'M2'], [3, 87.27],
    [4, 1000], [5, 100], [6, 900], [7, 0], [8, 1000]]),
  en(9, [[5, 'Barra=90.32-100,0-70,0-0']]),
  en(9, [[0, '1001 01'], [1, 'BASE DE GRAVA CEMENTADA.'], [2, 'M3'], [3, 388.05],
    [4, 1000], [5, 0], [6, 0], [7, 1000], [8, 1000]]),
  en(9, [[5, 'Barra=0-0,0-0,0-100']]),
  vacia(9),
  en(9, [[0, 'TOTAL DEL PRESUPUESTO MOSTRADO:'], [5, 100], [6, 900], [7, 1000]]),
  en(9, [[0, 'ACUMULADO:'], [5, 100], [6, 1000], [7, 2000]]),
  en(9, [[0, 'PORCENTAJE PERIODO:'], [5, 0.05], [6, 0.45], [7, 0.5]]),
  en(9, [[0, 'PORCENTAJE ACUMULADO:'], [5, 0.05], [6, 0.5], [7, 1]]),
];

// DE-5: dos renglones por partida. NO declara «Inicio obra».
// Columnas: 0 Código · 1 Descripción · 2 Unidad · 3 Cantidad · 4,5,6 Mes 1..3 ·
//           7 Total.  Los meses del primer renglón suman la CANTIDAD (30 TON);
//           los del segundo suman el TOTAL ($585,972).
const DE5 = [
  en(8, [[0, 'FOSMON CONSTRUCCIONES, S.A. DE C.V.']]),
  en(8, [[0, 'COATZACOALCOS, VERACRUZ.']]),
  en(8, [[0, 'Cliente:'], [1, 'PETRÓLEOS MEXICANOS']]),
  en(8, [[0, 'Concurso No:'], [1, 'DPI-CAN-O-GCTEL-2-105876-52-26-2']]),
  en(8, [[0, 'Obra:'], [1, 'REHABILITACIÓN DE ESTRUCTURAS METÁLICAS']]),
  vacia(8),
  en(8, [[0, 'Fecha:'], [1, 46105]]),
  en(8, [[0, 'Duración:'], [1, '90 DIAS NAT.']]),
  en(8, [[0, 'Lugar:'], [1, 'COMPLEJO PETROQUIMICO CANGREJERA']]),
  vacia(8),
  en(8, [[0, 'DE-5   PROGRAMA MENSUAL CALENDARIZADO']]),
  vacia(8),
  en(8, [[0, 'Código'], [1, 'Descripción'], [2, 'Unidad'], [3, 'Cantidad'],
    [4, 'Mes  1'], [5, 'Mes  2'], [6, 'Mes  3'], [7, 'Total']]),
  vacia(8),
  en(8, [[0, '1.'], [1, 'DESMONTAJE DE ESTRUCTURAS METÁLICAS'], [2, 'TON'],
    [3, 30], [4, 2.6], [5, 6.5], [6, 20.9], [7, 30]]),
  en(8, [[4, 50784.24], [5, 126960.60], [6, 408227.16], [7, 585972]]),
  en(8, [[4, 'Barra=63.33-100,0-100,0-100']]),
  en(8, [[0, '2.'], [1, 'DESMONTAJE DE CANALONES PLUVIALES'], [2, 'ML'],
    [3, 1100], [4, 0], [5, 150], [6, 950], [7, 1100]]),
  en(8, [[4, 0], [5, 27189], [6, 172197], [7, 199386]]),
  en(8, [[4, 'Barra=0-0,41.94-100,0-100']]),
  vacia(8),
  en(8, [[0, 'TOTAL DEL PRESUPUESTO MOSTRADO:'], [4, 50784.24], [5, 154149.60], [6, 580424.16]]),
  en(8, [[0, 'ACUMULADO:'], [4, 50784.24], [5, 204933.84], [6, 785358]]),
];

// Un AE11 con una partida a MEDIO CALENDARIZAR: su importe de catálogo dice
// $1,500 y sus meses sólo reparten $1,000. Pasa de verdad —el programa se
// calendariza a mano— y es invisible si uno compara los meses contra la columna
// «Total» de la DERECHA, porque ésa es la suma de los meses y por construcción
// cuadra siempre. Aquí las dos columnas «Total» valen distinto a propósito:
// es la única hoja del banco que puede distinguir una de la otra.
const SUBPROGRAMADO = JSON.parse(JSON.stringify(AE11));
SUBPROGRAMADO[20][4] = 1500;

// Una hoja que no es un programa: trae partidas, pero ni Código ni meses.
const NO_ES_PROGRAMA = [
  en(4, [[0, 'Resumen de estimaciones']]),
  en(4, [[0, 'Número'], [1, 'Periodo'], [2, 'Importe'], [3, 'Pagado']]),
  en(4, [[0, 1], [1, 'agosto'], [2, 100], [3, 100]]),
];

// Encabezado bueno, pero debajo sólo secciones: ninguna partida con unidad.
const SIN_PARTIDAS = [
  en(6, [[0, 'Código'], [1, 'Descripción'], [2, 'Unidad'], [3, 'Cantidad'],
    [4, 'Mes  1'], [5, 'Mes  2']]),
  en(6, [[0, '1.-'], [1, 'UNA SECCIÓN']]),
  en(6, [[0, '1000 00'], [1, 'OTRA SECCIÓN:']]),
];

// ── Las aserciones ─────────────────────────────────────────────────────────

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
    typeof a === 'number' && Math.abs(a - b) <= tol;

  // 1 · SE NIEGA CUANDO NO PUEDE LEER
  const no = fn.parsearPrograma(NO_ES_PROGRAMA);
  check(no && no.ok === false && typeof no.porQue === 'string' && no.porQue.length > 20,
    'una hoja que no es un programa se rechaza, con el porqué escrito',
    no && no.ok === false ? no.porQue.slice(0, 60) + '…' : JSON.stringify(no));
  check(no && no.ok === false && !('partidas' in no),
    'y no devuelve un programa a medias que alguien pueda guardar');
  const sinP = fn.parsearPrograma(SIN_PARTIDAS);
  check(sinP && sinP.ok === false && /partida/i.test(sinP.porQue || ''),
    'con encabezado pero sin partidas también se rechaza, y lo dice',
    sinP && sinP.porQue ? sinP.porQue.slice(0, 60) + '…' : JSON.stringify(sinP));
  check(fn.parsearPrograma([]).ok === false && fn.parsearPrograma(null).ok === false,
    'una hoja vacía o ausente se rechaza sin reventar');

  // 2 · AE11: UN RENGLÓN POR PARTIDA
  const a = fn.parsearPrograma(AE11);
  check(a.ok === true, 'el AE11 se lee', a.ok ? '' : a.porQue);
  check(a.filaEncabezado === 18,
    'el encabezado del AE11 se halla en el renglón 18 sin que se le diga',
    `dijo ${a.filaEncabezado}`);
  check(a.meses === 3, 'cuenta tres meses', `dijo ${a.meses}`);
  check(a.partidas.length === 2,
    'dos partidas: las secciones «1.-» y «1000 00» no son partidas',
    `contó ${a.partidas.length}: ${a.partidas.map(p => p.sec).join(', ')}`);
  check(a.partidas[0].sec === '1000 03' && a.partidas[1].sec === '1001 01',
    'y los códigos son los de las partidas, no los de las secciones');
  check(cerca(a.total, 2000), 'el total son los pesos de las partidas', `dio ${a.total}`);
  check(a.inicio === '2026-08-29',
    'el arranque sale del serial de Excel, no de una suposición',
    `dio ${a.inicio}`);
  check(a.fin === '2026-11-26', 'y el fin también', `dio ${a.fin}`);
  check(a.partidas[0].barra === 'Barra=90.32-100,0-70,0-0',
    'la fila «Barra=» se pega a la partida de arriba, no se tira',
    `dio ${JSON.stringify(a.partidas[0].barra)}`);
  check(cerca(a.totalDeclarado, 2000),
    'el ACUMULADO final del archivo se lee, para poder contrastarlo',
    `dio ${a.totalDeclarado}`);
  check(!a.partidas.some(p => p.sec === 'ACUMULADO' || /PORCENTAJE/.test(p.sec)),
    'las filas de resumen no entran como partidas');

  // 3 · DE-5: EL RENGLÓN DE ABAJO TRAE LOS PESOS
  // Es la aserción caliente. Si se leyeran los meses del renglón de arriba,
  // el total sería 1,130 toneladas en vez de $785,358.
  const d = fn.parsearPrograma(DE5);
  check(d.ok === true, 'el DE-5 se lee', d.ok ? '' : d.porQue);
  check(d.filaEncabezado === 13,
    'su encabezado está en el renglón 13, y también se halla solo',
    `dijo ${d.filaEncabezado}`);
  check(d.partidas.length === 2,
    'dos partidas, no cuatro: el renglón de importes no es una partida aparte',
    `contó ${d.partidas.length}`);
  check(cerca(d.total, 785358, 0.5),
    'el total son los PESOS, no las toneladas del renglón de arriba',
    `dio ${d.total}`);
  check(cerca(d.partidas[0].montos[0], 50784.24),
    'el primer mes de la primera partida son $50,784.24 y no 2.6 TON',
    `dio ${d.partidas[0].montos[0]}`);
  check(d.partidas[0].cant === 30 && d.partidas[0].unidad === 'TON',
    'la cantidad y la unidad siguen siendo las del renglón de la partida');
  check(d.partidas[1].barra === 'Barra=0-0,41.94-100,0-100',
    'la barra se pega a la partida aunque haya un renglón de importes en medio',
    `dio ${JSON.stringify(d.partidas[1].barra)}`);
  check(d.inicio === null && d.avisos.some(x => /Inicio obra/i.test(x)),
    'el DE-5 no declara arranque, y eso se avisa en vez de inventarlo',
    JSON.stringify(d.avisos));

  // 4 · LO QUE NO CUADRA SE AVISA
  const descuadrado = JSON.parse(JSON.stringify(AE11));
  descuadrado[26][7] = 500;          // el ACUMULADO final deja de cuadrar
  const des = fn.parsearPrograma(descuadrado);
  check(des.ok === true && des.avisos.some(x => /acumulado final/i.test(x)),
    'si el acumulado del archivo no es lo que suman sus partidas, se avisa',
    JSON.stringify(des.avisos));
  check(cerca(des.total, 2000),
    'y el total sigue siendo lo que suman las partidas, no lo que el archivo dice',
    `dio ${des.total}`);
  const sinBarra = JSON.parse(JSON.stringify(AE11));
  sinBarra[21][5] = null;            // le quitamos la fila Barra= a la primera
  const sb = fn.parsearPrograma(sinBarra);
  check(sb.ok === true && sb.avisos.some(x => /Barra/i.test(x)),
    'una partida sin barra no tumba la lectura: se avisa y se reparte en el mes',
    JSON.stringify(sb.avisos));

  // 4b · LA PARTIDA A MEDIO CALENDARIZAR
  // El importe que se compara es el del catálogo —la columna «Total» de la
  // IZQUIERDA—, no la suma de los meses que está a la derecha. Contra la de la
  // derecha la comprobación no puede fallar nunca, y una comprobación que no
  // puede fallar no está midiendo nada.
  check(cerca(a.partidas[0].importe, 1000),
    'la partida trae el importe que le da el catálogo del archivo',
    `dio ${a.partidas[0].importe}`);
  check(!a.avisos.some(x => /no suman el importe/i.test(x)),
    'y cuando sí cuadra no se avisa nada: el aviso no es ruido de fondo',
    JSON.stringify(a.avisos));
  const sub = fn.parsearPrograma(SUBPROGRAMADO);
  check(sub.ok === true && sub.avisos.some(x => /no suman el importe/i.test(x)),
    'una partida de $1,500 con sólo $1,000 calendarizados se delata',
    JSON.stringify(sub.avisos));
  check(sub.avisos.some(x => /1000 03/.test(x)),
    'y el aviso dice QUÉ partida es, no sólo que algo no cuadra');
  check(cerca(sub.total, 2000),
    'el total del programa sigue siendo lo calendarizado, no lo contratado',
    `dio ${sub.total}`);

  // 5 · PARSER MÁS CUENTA: EL ANCLAJE SOBREVIVE EL VIAJE
  // Es la prueba de que las dos mitades hablan el mismo idioma. 90.32% de un
  // agosto de 31 días es el día 29, que es justo el «Inicio obra» del archivo.
  check(cerca(fn.acumuladoProgramado(a, '2026-08-29'), 0),
    'leído del archivo, el día del arranque no tiene nada acumulado',
    `dio ${fn.acumuladoProgramado(a, '2026-08-29')}`);
  check(cerca(fn.acumuladoProgramado(a, '2026-09-01'), 100),
    'al cerrar agosto va el importe del mes 1',
    `dio ${fn.acumuladoProgramado(a, '2026-09-01')}`);
  check(cerca(fn.acumuladoProgramado(a, '2026-09-22'), 1000),
    'y el mes 2 se completa el 22, donde acaba su barra',
    `dio ${fn.acumuladoProgramado(a, '2026-09-22')}`);
  check(fn.pctProgramadoEnFecha(a, '2026-11-27') === 100,
    'el programa leído llega a 100% al terminar su último día',
    `dio ${fn.pctProgramadoEnFecha(a, '2026-11-27')}`);
  // Y la mentira que se está corrigiendo: el AE11 de prueba tiene la mitad de
  // su dinero en el último mes, así que a mitad del plazo la recta se separa.
  const mitad = fn.pctProgramadoEnFecha(a, '2026-10-13');
  check(mitad !== null && Math.abs(mitad - 50) > 5,
    'a mitad del plazo el programa leído no dice 50%, que es lo que decía la recta',
    `dijo ${mitad === null ? 'null' : mitad.toFixed(1) + '%'}`);

  return fallos;
}

// ── La contraprueba ───────────────────────────────────────────────────────
//
// UNA MUTACIÓN QUE NO ESTÁ, Y POR QUÉ NO ESTÁ. Falta la obvia: forzar el
// discriminador a `true` para que también en el AE11 se coma el renglón de
// abajo. Se probó y sobrevivió, y sobrevive por una razón honesta: con los dos
// formatos que existen, el renglón de abajo de una partida del AE11 es su fila
// `Barra=`, y las otras dos condiciones —`!barraDe(sig)` y `sigTieneMontos`—
// ya la descartan. La condición es redundante AHÍ. Se deja escrito en vez de
// inventar una hoja que no existe para fabricar cobertura: si algún día
// aparece un tercer formato, esta nota es el aviso de dónde falta una prueba.
const MUTACIONES = [
  ['lee el DE-5 como si fuera AE11 (toneladas por pesos)',
    'if (pareceVolumen && !sigTieneCodigo', 'if (false && !sigTieneCodigo'],
  ['adivina el encabezado en vez de negarse',
    "return { ok: false, porQue: 'No se halló el encabezado",
    "hr = 0; cols = [1, 2]; cCod = 0; return { ok: true, partidas: [], meses: 2, total: 0, avisos: [], porQue: 'No se halló el encabezado"],
  ['mete las filas de resumen como partidas',
    'if (RESUMEN.includes(p0)) {', 'if (false) {'],
  ['compara contra la columna Total de la derecha, que cuadra siempre',
    'cImporte = totales.filter(j => j < cols[0]).pop() ?? -1;',
    'cImporte = totales.filter(j => j > cols[0]).pop() ?? -1;'],
  ['se calla la partida a medio calendarizar',
    'if (descuadradas.length) {', 'if (false) {'],
  ['tira la fila Barra en vez de pegarla a su partida',
    'if (partidas.length) partidas[partidas.length - 1].barra = bar;',
    'if (false) partidas[partidas.length - 1].barra = bar;'],
  ['se inventa un arranque cuando el archivo no lo trae',
    "const inicio = fechaISODeSerialExcel(cab.INICIOOBRA);",
    "const inicio = fechaISODeSerialExcel(cab.INICIOOBRA) || '2026-01-01';"],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!cuerpo.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      process.exit(2);
    }
    let fallos;
    process.env.CALLADO = '1';
    try { fallos = correr(cuerpo.replace(de, a)); }
    catch (e) { fallos = [`revienta: ${e.message}`]; }
    delete process.env.CALLADO;
    if (fallos.length) {
      console.log(`   ✓ ROJO  ${titulo}  ·  ${fallos.length} mordieron`);
      console.log(`           la primera: ${fallos[0]}`);
    } else {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      sobrevivieron++;
    }
  }
  if (sobrevivieron) {
    console.error(`\nROJO: ${sobrevivieron} mutación(es) sobrevivieron.`);
    process.exit(1);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.`);
  process.exit(0);
}

console.log('EL PROGRAMA SE LEE O SE NIEGA · #51\n');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
