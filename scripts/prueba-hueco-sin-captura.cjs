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
// archivo: extrae `tramosDeSerie` del archivo, la EJECUTA con la estructura de
// semanas verdadera de la 0114 y revisa qué tramos salen.
//
// Antes esto se medía recortando el bloque de la gráfica de proyección por
// texto, entre `const idxMedidos =` y `const ptsEjecArea =`. Esa gráfica se
// borró al unificarse las tres en una, y la conducta pasó a `tramosDeSerie`,
// que es de nivel superior y la usan todas las series de todos los paneles. El
// banco se mudó con ella. Un detalle que cambió al mudarse: los tramos ya no
// van de par en par sino por RACHAS de semanas consecutivas —de par en par la
// curva suavizada se vuelve una poligonal— así que "ancho mayor que uno" ya no
// significa "pisa un hueco", y la afirmación hay que escribirla por lo que
// quiere decir: ningún trazo sólido cubre una semana sin captura.
//
// Uso:  node scripts/prueba-hueco-sin-captura.cjs [archivo]

const fs = require('fs');
const path = require('path');

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const { taller } = require('./taller-de-app.cjs');

const raiz = path.resolve(__dirname, '..');
const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

let tramosDeSerie;
try {
  tramosDeSerie = taller(src).cuenta('tramosDeSerie');
} catch (e) {
  noArranco(['tramosDeSerie'], archivo);
}
if (typeof tramosDeSerie !== 'function') noArranco(['tramosDeSerie'], archivo);

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

const correr = (idxFrontera = -1) =>
  tramosDeSerie({ pts: ptsEjecHist, medido: ejecMedido, idxFrontera });

const tramos = correr();
const idxDe = w => w - PRIMERA;
const cubre = t => { const r = []; for (let i = t.desde; i <= t.hasta; i++) r.push(i); return r; };

// 1) El trecho 30→37 va en UN SOLO tramo y está marcado sin medir.
//
// El tramo que lo contiene arranca en la 28 y no en la 30, porque la 29
// tampoco se capturó: dos puentes punteados seguidos son UN camino punteado que
// pasa por el punto de la 30. Partirlos en dos cortaría la curva en una semana
// donde no cambia nada de lo que se afirma —sigue sin medirse a los dos
// lados— y el corte se leería como una marca.
const cubreEdge = (t, a, b) => t.desde <= idxDe(a) && t.hasta >= idxDe(b);
const dentro = tramos.filter(t => cubreEdge(t, 30, 37));
check(dentro.length === 1, 'el trecho de la semana 30 a la 37 va en un solo tramo',
  `${dentro.length} tramo(s) lo cubren`);
const hueco = dentro[0];
check(hueco && !hueco.medido, 'y va marcado como NO medido',
  hueco ? `semanas ${hueco.desde + PRIMERA} a ${hueco.hasta + PRIMERA}, ` +
          `${hueco.pts.length} puntos` : '');

// 2) Lo que importa de verdad: NINGÚN TRAMO SÓLIDO PISA UNA SEMANA SIN
//    CAPTURA. Esta es la afirmación falsa que se quería eliminar, y se escribe
//    sobre las semanas que el tramo cubre —no sobre su ancho— porque ahora un
//    tramo sólido ancho es una racha legítima de semanas capturadas.
const solidosSobreHueco = tramos.filter(
  t => t.medido && cubre(t).some(i => !ejecMedido[i]));
check(solidosSobreHueco.length === 0,
  'ningún tramo sólido cruza semanas sin captura',
  solidosSobreHueco.length ? `${solidosSobreHueco.length} lo hacen` : 'ninguno');

// 3) Las semanas contiguas SÍ se unen sólido: un hueco de una sola semana es
//    la operación normal y puntear todo volvería la gráfica ilegible.
const contiguo = tramos.find(
  t => t.medido && t.desde <= idxDe(23) && t.hasta >= idxDe(24));
check(!!contiguo, 'dos semanas seguidas con captura se unen sólido');

// 4) Y se unen en UNA SOLA racha, no en un tramo por par. Las 23 a la 28 son
//    seis cierres consecutivos: partirlos en cinco tramos de dos puntos
//    convierte la curva suavizada en una poligonal, que es un dibujo distinto
//    del que hace el resto del panel.
check(contiguo && contiguo.desde === idxDe(23) && contiguo.hasta === idxDe(28),
  'las seis semanas seguidas son una sola racha sólida',
  contiguo ? `${contiguo.pts.length} puntos en el tramo` : '');

// 5) Un hueco de UNA sola semana también se puntea. No hay umbral: la semana
//    22 no se capturó, así que el trecho 21→23 tampoco es una medición.
const salto1 = tramos.find(t => t.desde === idxDe(21) && t.hasta === idxDe(23));
check(salto1 && !salto1.medido, 'un hueco de una sola semana también se puntea',
  'semana 22 ausente, 21→23 punteado');

// 6) Ningún tramo arranca o termina en una semana sin dato: la línea va de
//    medición a medición, no pasa por valores arrastrados.
const extremos = tramos.flatMap(t => [t.desde, t.hasta]);
check(extremos.every(i => ejecMedido[i]),
  'todos los extremos de tramo son semanas con medición propia');

// 7) La frontera de esquema sigue funcionando y es independiente del hueco.
//    Tras el rescate la 0114 tiene ocho snapshots viejos y dos nuevos, así que
//    las dos marcas conviven en la misma serie.
const tramosConFrontera = correr(idxDe(37));
const viejos = tramosConFrontera.filter(t => !t.vigente);
const vigentes = tramosConFrontera.filter(t => t.vigente);
check(viejos.length > 0 && vigentes.length > 0,
  'la frontera de esquema sigue partiendo la serie',
  `${viejos.length} tramos viejos, ${vigentes.length} vigentes`);
const huecoConFrontera = tramosConFrontera.find(t => cubreEdge(t, 30, 37));
check(huecoConFrontera && !huecoConFrontera.medido && !huecoConFrontera.vigente,
  'el tramo del hueco carga las dos marcas a la vez: sin medir y esquema viejo');

// 8) Una serie SIN `medido` no se puntea por su cuenta. El programa de obra no
//    se captura semana a semana: está firmado de una vez, y puntearlo por los
//    huecos del historial de avance diría de él algo que no es cierto.
const sinMedido = tramosDeSerie({ pts: ptsEjecHist });
check(sinMedido.length === 1 && sinMedido[0].medido
      && sinMedido[0].desde === 0 && sinMedido[0].hasta === semanas.length - 1,
  'una serie sin marca de medición sale como una sola racha sólida',
  `${sinMedido.length} tramo(s)`);

console.log(`\n       0114 · semanas ${PRIMERA} a ${ULTIMA} · ${CON_SNAPSHOT.length} con captura · ` +
  `${tramos.length} tramos, ${tramos.filter(t => !t.medido).length} sin medir`);
console.log(`       El hueco 31-36 se declara; las semanas 32 a 36 no son ` +
  `reconstruibles (PENDIENTES #28).`);

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
