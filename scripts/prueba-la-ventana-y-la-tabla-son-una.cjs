#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// UNA VENTANA SEGÚN LA EDAD, Y UNA SOLA TABLA SEMANAL
// ════════════════════════════════════════════════════════════════════════════
//
// DOS COSAS QUE VENÍAN MAL, Y SON DISTINTAS.
//
// 1. LA VENTANA ESTABA CLAVADA EN 12 en los dos papeles, y 12 es la respuesta
//    equivocada en los dos extremos: una obra de seis semanas sale con media
//    gráfica vacía —y el hueco se lee como meses sin capturar—, y una de año y
//    medio se publica sin los trimestres que explican dónde se torció. Los
//    cortes son 8 / 12 / 24 según la edad, y la edad se mide desde
//    `obra.inicio` y no desde la primera captura: medirla desde el primer dato
//    premiaría a la obra por no haber capturado.
//
// 2. LA TABLA SEMANAL NO ESTABA EN EL PAPEL, y sus tres deltas estaban
//    escritos DOS VECES en la app —una por tablero—. Traerla al PDF copiando
//    los deltas habría sido la tercera copia de tres cuentas con trampas finas:
//    la frontera de criterio que no se cruza, el nulo que no es cero, y el
//    ancla de gasto sin fechar que convierte un salto de $13.4M en «lo que se
//    gastó en siete días».
//
// ── LA FRONTERA SE SOSTIENE AL COMPARTIR ──────────────────────────────────
//
// Lo que se comparte es la CUENTA, no la tabla. Las dos tablas no son la
// misma: la de la dependencia lleva «Pagado» y «Falta pagar» donde la de la
// constructora lleva «Gasto» y «Margen». Compartir la lista de columnas le
// pondría al municipio la economía del contratista en las manos. Por eso se
// comparten los dos deltas que ambas usan —avance y programa— y la lista de
// nueve columnas la arma sólo quien puede verlas.
//
// CONTRAPRUEBAS — corridas el 2026-11-23, las seis en ROJO (1), ninguna en
// NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-la-ventana-y-la-tabla-son-una.cjs
//       node scripts/prueba-la-ventana-y-la-tabla-son-una.cjs --contraprueba

'use strict';

const fs = require('fs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m, d = '') => {
  if (c) { verdes++; console.log(`  ok   ${m}${d ? '  ·  ' + d : ''}`); }
  else { fallas++; console.log(`FALLA  ${m}${d ? '  ·  ' + d : ''}`); }
};

const PEDIDOS = ['ventanaDeLaObra', 'columnasSemanales', 'deltaDeAvance',
  'deltaContraPrograma', 'VENTANA_CORTA', 'VENTANA_MEDIA', 'VENTANA_LARGA'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltan.join(', ')}`);
  process.exit(2);
}
let API;
try {
  API = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
} catch (e) {
  console.error(`\nNO ARRANCÓ: no se pudo montar lo extraído: ${e.message}`);
  process.exit(2);
}
const { ventanaDeLaObra, columnasSemanales, deltaDeAvance, deltaContraPrograma,
        VENTANA_CORTA, VENTANA_MEDIA, VENTANA_LARGA } = API;

// Una obra que arrancó hace N semanas, contado desde el reloj de verdad: el
// corte depende de la edad, así que una fecha fija caducaría sola.
const haceSemanas = (n) => {
  const d = new Date(Date.now() - n * 7 * 86400000);
  return { inicio: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-`
                   + String(d.getDate()).padStart(2,'0') };
};

// ══════════════════════════════════════════════════════════════════════════
console.log('1. La ventana sale de la edad de la obra, en sus tres cortes');

ok(ventanaDeLaObra(haceSemanas(1)) === VENTANA_CORTA,
  'una obra de una semana mira 8', String(ventanaDeLaObra(haceSemanas(1))));
ok(ventanaDeLaObra(haceSemanas(7)) === VENTANA_CORTA,
  'una de siete, también 8: la obra entera y sin relleno',
  String(ventanaDeLaObra(haceSemanas(7))));
ok(ventanaDeLaObra(haceSemanas(10)) === VENTANA_MEDIA,
  'una de diez mira 12, que es como se revisa el trimestre',
  String(ventanaDeLaObra(haceSemanas(10))));
ok(ventanaDeLaObra(haceSemanas(40)) === VENTANA_LARGA,
  'una de cuarenta mira 24: medio año, donde se ve la curva',
  String(ventanaDeLaObra(haceSemanas(40))));
// LOS BORDES, que es donde un `<` por un `<=` cambia la respuesta sin avisar.
//
// LA EDAD SE CUENTA EN SEMANAS DE VIDA, INCLUIDA LA ACTUAL: una obra que
// arrancó HOY lleva una semana, y una que arrancó hace 8 lleva NUEVE —las ocho
// cumplidas más la que corre—. Por eso el salto a 12 cae entre arrancar hace 7
// y hace 8: con 9 semanas de vida, una ventana de 8 le cortaría la primera, y
// el corte de 8 existe justamente para que la obra entera quepa sin relleno.
// La primera versión de esta prueba lo contó sin la semana en curso y señaló
// un borde que no era.
const vida = (n) => ventanaDeLaObra(haceSemanas(n - 1));   // n semanas de vida
ok(vida(8) === VENTANA_CORTA && vida(9) === VENTANA_MEDIA,
  'el salto de 8 a 12 cae entre la octava y la novena semana de vida',
  `8 de vida→${vida(8)} · 9 de vida→${vida(9)}`);
ok(vida(12) === VENTANA_MEDIA && vida(13) === VENTANA_LARGA,
  'y el de 12 a 24 entre la duodécima y la decimotercera',
  `12 de vida→${vida(12)} · 13 de vida→${vida(13)}`);

console.log('\n2. Sin fecha de arranque no se adivina la edad');
for (const [caso, obra] of [['sin obra', null], ['sin inicio', {}],
                            ['inicio ilegible', { inicio: 'no es fecha' }]]) {
  ok(ventanaDeLaObra(obra) === VENTANA_MEDIA,
    `${caso}: se cae a 12, la ventana de siempre`, String(ventanaDeLaObra(obra)));
}
// Y NO a 24: inventar medio año sobre una obra sin fecha dibujaría veinticuatro
// semanas vacías, que se leen como medio año sin capturar.
ok(ventanaDeLaObra({}) !== VENTANA_LARGA,
  'y NO a 24, que dibujaría medio año de semanas que nadie midió');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n3. Las nueve columnas salen de UNA cuenta');

const SEM = ['S40','S41','S42','S43'].map((label, i) => ({ label, key: `K${i}` }));
const CURVA = {
  avance:        [10, 20, null, 45],
  programadoPct: [12, 24, 36, 48],
  ejecutado:     [1000, 2000, null, 4500],
  programado:    [1200, 2400, 3600, 4800],
  gasto:         [800, 1600, 2400, 3200],
  margen:        [200, 400, null, 1300],
  gastoPorSem:   { K0: 800, K1: 1600, K2: 2400, K3: 3200 },
  gastoMedido: true, gastoSinFechar: false,
  fronteraAvance: { hay: false, idx: -1 },
};
const cols = columnasSemanales(CURVA, SEM);
ok(cols.length === 9, 'la tabla trae nueve columnas', String(cols.length));
ok(cols.every(c => Array.isArray(c.valores) && c.valores.length === SEM.length),
  'y cada una trae un valor por semana');
ok(cols.every(c => typeof c.formato === 'string' && typeof c.vacio === 'string'),
  'con su formato NOMBRADO y su texto de vacío — no cadenas ya pintadas, '
  + 'para que la pantalla y el papel puedan pintar cada uno con lo suyo');

const porTitulo = (t) => cols.find(c => c.titulo === t)?.valores;
ok(JSON.stringify(porTitulo('Δ semana')) === JSON.stringify(deltaDeAvance(CURVA, SEM)),
  'la columna «Δ semana» ES `deltaDeAvance`, no una copia');
ok(JSON.stringify(porTitulo('Contra el programa'))
   === JSON.stringify(deltaContraPrograma(CURVA, SEM)),
  'y «Contra el programa» ES `deltaContraPrograma`');

console.log('\n4. Los deltas no afirman donde no se midió');
// Una semana sin avance medido no produce delta: restar contra un hueco daría
// un salto inventado, y en la tabla se lee como obra que avanzó de golpe.
const d = porTitulo('Δ semana');
ok(d[0] === null, 'la primera semana no tiene contra qué restar');
ok(d[2] === null && d[3] === null,
  'y las que tocan una semana sin medir quedan en nulo, no en cero',
  JSON.stringify(d));
// La frontera de criterio: el delta de la semana que cruza se calla.
const conFrontera = columnasSemanales(
  { ...CURVA, avance: [10, 20, 30, 45], fronteraAvance: { hay: true, idx: 2 } }, SEM);
ok(conFrontera.find(c => c.titulo === 'Δ semana').valores[2] === null,
  'y el delta de la semana que cruza la frontera del criterio se calla');
// Sin programa no hay desviación: un cero diría «va justo en programa».
const sinPrograma = columnasSemanales(
  { ...CURVA, programadoPct: [null, null, null, null] }, SEM);
ok(sinPrograma.find(c => c.titulo === 'Contra el programa').valores.every(v => v === null),
  'sin programa la desviación es nula en toda la ventana, no cero');

console.log('\n5. El gasto de la semana no se inventa');
const sinFechar = columnasSemanales({ ...CURVA, gastoSinFechar: true }, SEM);
ok(sinFechar.find(c => c.titulo === 'Gasto de la semana').valores[SEM.length-1] === null,
  'con el acumulado sin fechar, la última semana no afirma un gasto');
const sinMedir = columnasSemanales({ ...CURVA, gastoMedido: false }, SEM);
ok(sinMedir.find(c => c.titulo === 'Gasto de la semana').valores.every(v => v === null),
  'y sin gasto medido ninguna semana lo afirma');

console.log('\n6. La frontera: la tabla compartida NO va al tablero del municipio');
const src = fs.readFileSync(archivo, 'utf8');
// `columnasSemanales` trae gasto y margen; que la llame el tablero de la
// dependencia sería la economía del contratista en el papel del municipio.
const enGobierno = /function GraficaDelContrato[\s\S]*?\n}/.exec(src)?.[0] || '';
ok(enGobierno.length > 200, 'se localizó el tablero de la dependencia',
  `${enGobierno.length} caracteres`);
ok(!enGobierno.includes('columnasSemanales'),
  'el tablero de la dependencia NO llama a `columnasSemanales`: esa lista '
  + 'lleva gasto y margen');
ok(enGobierno.includes('deltaDeAvance') && enGobierno.includes('deltaContraPrograma'),
  'pero sí usa los dos deltas compartidos: lo que se comparte es la cuenta');
ok(!/titulo:\s*'Margen'/.test(enGobierno) && !/titulo:\s*'Gasto/.test(enGobierno),
  'y ninguna de sus columnas se llama «Margen» ni «Gasto»');

console.log(`\n${verdes} en verde · ${fallas} en rojo`);
if (fallas) process.exit(1);

// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const CP = require('./contraprueba.cjs');
  const MUTANTES = [
    { titulo: 'la ventana vuelve a estar clavada en doce',
      cambios: [['const ventanaDeLaObra = (obra) => {', 'const ventanaDeLaObra = (obra) => { return 12;', 1]] },
    { titulo: 'la edad se mide mal y el corte de 8 se come al de 12',
      cambios: [['  if (semanas <= VENTANA_CORTA) return VENTANA_CORTA;',
                 '  if (semanas <= VENTANA_MEDIA) return VENTANA_CORTA;', 1]] },
    { titulo: 'una obra sin fecha de arranque se trata como vieja',
      cambios: [['  if (!inicio || isNaN(inicio)) return VENTANA_MEDIA;',
                 '  if (!inicio || isNaN(inicio)) return VENTANA_LARGA;', 1]] },
    { titulo: 'el delta de avance vuelve a cruzar la frontera del criterio',
      cambios: [['    if (g.fronteraAvance?.hay && i === g.fronteraAvance.idx) return null;\n', '', 1]] },
    { titulo: 'la desviación sin programa se publica como cero',
      cambios: [['    if (p === null || p === undefined) return null;\n'
                 + '    if (typeof g.avance[i] !== \'number\') return null;\n'
                 + '    return g.avance[i] - p;',
                 '    return (g.avance[i] || 0) - (p || 0);', 1]] },
    { titulo: 'el tablero del municipio se trae la tabla con gasto y margen',
      cambios: [['  const avanceDelta = deltaDeAvance(g, semanas);\n'
                 + '  const desviacion = deltaContraPrograma(g, semanas);\n\n'
                 + '  const colorDelta',
                 '  const avanceDelta = deltaDeAvance(g, semanas);\n'
                 + '  const desviacion = deltaContraPrograma(g, semanas);\n'
                 + '  const _COLS = columnasSemanales(g, semanas);\n\n'
                 + '  const colorDelta', 1]] },
  ];
  CP.exigirAnclajes(MUTANTES, src, { archivo });
  const s = CP.correr({ mutaciones: MUTANTES, src, archivo, prefijo: 'ventana-tabla-' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}
