#!/usr/bin/env node
// Prueba: la gráfica NO dibuja una línea sólida sobre semanas que nadie midió.
//
// Existe por la obra 0114. Entre la semana 30 y la 37 hay seis cierres que se
// perdieron al llenarse el documento de historial. El código arrastraba el
// último valor conocido y dibujaba una recta sólida sobre ese trecho, lo que
// afirma "el ejecutado no se movió en seis semanas". Lo cierto es que no se
// sabe. Son cosas distintas y la pantalla tiene que distinguirlas (P2).
//
// No comprueba que exista una variable ni que haya un `strokeDasharray` en el
// archivo: extrae el bloque real que arma los tramos, lo ejecuta con la
// estructura de semanas verdadera de la 0114 y revisa qué tramos salen.
//
// Uso:  node scripts/prueba-hueco-sin-captura.cjs [archivo]

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Extracción del bloque que arma los tramos ───────────────────────────────
const ini = src.indexOf('const idxMedidos =');
const fin = src.indexOf('const haySinMedir =');
if (ini < 0 || fin < 0 || fin <= ini) {
  console.log('FALLA  no se encontró el armado de tramos en ' + archivo);
  console.log('\nLa gráfica no separa las semanas medidas de las arrastradas.');
  process.exit(1);
}
const bloque = src.slice(ini, fin);

// ── La 0114 de verdad ───────────────────────────────────────────────────────
// Semanas 21 a 38 de 2026. Hay snapshot en 21, 23-28, 30, y —tras el rescate—
// 37 y 38. Faltan la 22, la 29 y las seis del hueco (31 a 36).
const PRIMERA = 21, ULTIMA = 38;
const CON_SNAPSHOT = [21, 23, 24, 25, 26, 27, 28, 30, 37, 38];
const semanas = [];
for (let w = PRIMERA; w <= ULTIMA; w++) semanas.push(w);
const ejecMedido = semanas.map(w => CON_SNAPSHOT.includes(w));

// Coordenadas de juguete: x = índice, y = un valor cualquiera. Lo que se
// comprueba es qué puntos une cada tramo, no dónde caen en pantalla.
const ptsEjecHist = semanas.map((w, i) => [i, 100 - i]);

const correr = (hayTramoViejoDinero, idxFrontDinero) => new Function(
  'ejecMedido', 'ptsEjecHist', 'hayTramoViejoDinero', 'idxFrontDinero',
  `"use strict"; ${bloque} return tramosEjec;`
)(ejecMedido, ptsEjecHist, hayTramoViejoDinero, idxFrontDinero);

const tramos = correr(false, 0);
const idxDe = w => w - PRIMERA;
const anchoDe = t => t.pts[1][0] - t.pts[0][0];

// 1) El trecho 30→37 existe como UN SOLO tramo y está marcado sin medir.
const hueco = tramos.find(t => t.pts[0][0] === idxDe(30) && t.pts[1][0] === idxDe(37));
check(!!hueco, 'el trecho de la semana 30 a la 37 es un solo tramo');
check(hueco && !hueco.medido, 'y va marcado como NO medido', hueco ? `ancho ${anchoDe(hueco)} semanas` : '');

// 2) Lo que importa de verdad: no hay ningún tramo sólido que pise una semana
//    sin captura. Esta es la afirmación falsa que se quería eliminar.
const solidosSobreHueco = tramos.filter(t => t.medido && anchoDe(t) > 1);
check(solidosSobreHueco.length === 0,
  'ningún tramo sólido cruza semanas sin captura',
  solidosSobreHueco.length ? `${solidosSobreHueco.length} lo hacen` : 'ninguno');

// 3) Las semanas contiguas SÍ se unen sólido: un hueco de una sola semana es
//    la operación normal y puntear todo volvería la gráfica ilegible.
const contiguo = tramos.find(t => t.pts[0][0] === idxDe(23) && t.pts[1][0] === idxDe(24));
check(contiguo && contiguo.medido, 'dos semanas seguidas con captura se unen sólido');

// 4) Un hueco de UNA sola semana también se puntea. No hay umbral: la semana
//    22 no se capturó, así que el trecho 21→23 tampoco es una medición.
const salto1 = tramos.find(t => t.pts[0][0] === idxDe(21) && t.pts[1][0] === idxDe(23));
check(salto1 && !salto1.medido, 'un hueco de una sola semana también se puntea',
  'semana 22 ausente, 21→23 punteado');

// 5) Ningún tramo arranca o termina en una semana sin dato: la línea va de
//    medición a medición, no pasa por valores arrastrados.
const extremos = tramos.flatMap(t => [t.pts[0][0], t.pts[1][0]]);
check(extremos.every(i => ejecMedido[i]),
  'todos los extremos de tramo son semanas con medición propia');

// 6) La frontera de esquema sigue funcionando y es independiente del hueco.
//    Tras el rescate la 0114 tiene ocho snapshots viejos y dos nuevos, así que
//    las dos marcas conviven en la misma serie.
const tramosConFrontera = correr(true, idxDe(37));
const viejos = tramosConFrontera.filter(t => !t.vigente);
const vigentes = tramosConFrontera.filter(t => t.vigente);
check(viejos.length > 0 && vigentes.length > 0,
  'la frontera de esquema sigue partiendo la serie',
  `${viejos.length} tramos viejos, ${vigentes.length} vigentes`);
const huecoConFrontera = tramosConFrontera.find(
  t => t.pts[0][0] === idxDe(30) && t.pts[1][0] === idxDe(37));
check(huecoConFrontera && !huecoConFrontera.medido && !huecoConFrontera.vigente,
  'el tramo del hueco carga las dos marcas a la vez: sin medir y esquema viejo');

console.log(`\n       0114 · semanas ${PRIMERA} a ${ULTIMA} · ${CON_SNAPSHOT.length} con captura · ` +
  `${tramos.length} tramos, ${tramos.filter(t => !t.medido).length} sin medir`);
console.log(`       El hueco 31-36 se declara; las semanas 32 a 36 no son ` +
  `reconstruibles (PENDIENTES #28).`);

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
