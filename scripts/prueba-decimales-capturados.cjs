#!/usr/bin/env node
// Guarda de #30: la pantalla nunca muestra menos precisión de la que se guardó.
//
// EL DEFECTO. `decimalesPorPU` se escribió como un PISO — el mínimo de
// decimales para que el último dígito no valiera más de un peso — pero
// `fmtCant` lo estaba usando como TECHO (`maximumFractionDigits`). En partidas
// de precio unitario bajo el piso es 2, así que un volumen capturado con 4
// decimales se guardaba con 4, se cobraba con 4, y en pantalla salía con 2.
// El dato sí se tomó; el residente veía que no.
//
// Verificado en producción el 2026-09-21 antes de tocar nada: NO hay redondeo
// al guardar. La captura es `parseFloat(e.target.value)` con `step="any"` y el
// guardado es `cantEjec: s.cantEjec || 0`, sin `toFixed` en medio. La obra 0125
// tiene la partida 129 con `cant = 994.4961`, los cuatro decimales intactos en
// Firestore, y la pantalla la mostraba como 994.5.
//
// LA REGLA NUEVA: mostrar los decimales que el usuario capturó, hasta 4, sin
// bajar nunca del piso que marca `decimalesPorPU`. Las dos mitades importan:
// subir hasta lo capturado, y no bajar del piso en partidas de PU alto.
//
// Esta prueba NO busca frases en el código: extrae por AST `decimalesPorPU`,
// `decimalesDe` y `fmtCant` de src/App.jsx y las EJECUTA. Es P3.
//
// Uso:  node scripts/prueba-decimales-capturados.cjs [App.jsx]
//
// El argumento corre la prueba contra una versión anterior para comprobar que
// ahí falla — una prueba que nunca ha fallado no prueba nada:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-decimales-capturados.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const { fuenteDe } = require('./extraer-de-app.cjs');

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

// ── Extracción del código real ─────────────────────────────────────────
// Por `fuenteDe` y no con un `traverse` propio: aquí había una lista de tres
// nombres tecleada a mano, y al entrar `parsearPresupuesto` —21 KB de cierre—
// enumerar sus dependencias habría sido la segunda copia del grafo contra la
// que existe ese módulo (#139).
const NOMBRES = ['decimalesPorPU', 'decimalesDe', 'fmtCant', 'parsearPresupuesto'];
const { cuerpo, faltan, presentes } =
  fuenteDe(ARCH_APP, NOMBRES, { tolerante: true });
// Un nombre ausente no revienta: se expone como `undefined` y la aserción que
// lo use falla, que es lo correcto contra la versión vieja.
const app = new Function(
  `${cuerpo}\n;return {${presentes.join(',')}};`)();
const { fmtCant, decimalesPorPU, parsearPresupuesto } = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${NOMBRES.filter(n => !faltan.includes(n)).join(', ') || '(ninguno)'}\n`);

// ── 1. El caso real de producción ──────────────────────────────────────
// PU bajo ⇒ piso 2. Antes salía 994.5 y se perdían $0.03 a la vista.
console.log('1. Obra 0125, partida 129 — cant 994.4961 guardada en Firestore');
check(fmtCant(994.4961, 85.50) === '994.4961',
  `cant 994.4961 con PU $85.50 se ve completa (dio "${fmtCant(994.4961, 85.50)}")`);

// ── 2. Subir hasta lo capturado, con techo 4 ───────────────────────────
console.log('\n2. Se muestran los decimales capturados, hasta 4');
check(fmtCant(12.3, 85.50) === '12.3',
  `1 decimal capturado se ve con 1 (dio "${fmtCant(12.3, 85.50)}")`);
check(fmtCant(12.345, 85.50) === '12.345',
  `3 decimales capturados se ven con 3 (dio "${fmtCant(12.345, 85.50)}")`);
check(fmtCant(12.3456, 85.50) === '12.3456',
  `4 decimales capturados se ven con 4 (dio "${fmtCant(12.3456, 85.50)}")`);
check(fmtCant(1.23456789, 85.50) === '1.2346',
  `más de 4 se cortan en 4 (dio "${fmtCant(1.23456789, 85.50)}")`);
check(fmtCant(12345.6789, 85.50) === '12,345.6789',
  `los miles siguen separados (dio "${fmtCant(12345.6789, 85.50)}")`);

// ── 3. El piso sigue siendo piso ───────────────────────────────────────
// Esta es la mitad que un "mostrar hasta 4 y ya" rompería: con PU de siete
// cifras el piso es 6 y bajarlo a 4 escondería pesos, no centavos.
console.log('\n3. Nunca se baja del piso que marca decimalesPorPU');
check(decimalesPorPU(1265249) === 6, `PU $1,265,249 pide piso 6 (dio ${decimalesPorPU(1265249)})`);
check(fmtCant(1.234567, 1265249) === '1.234567',
  `con piso 6, seis decimales se ven completos (dio "${fmtCant(1.234567, 1265249)}")`);
check(fmtCant(1.234567, 85.50) === '1.2346',
  `el mismo número con PU bajo se corta en 4 (dio "${fmtCant(1.234567, 85.50)}")`);

// ── 4. Nada de lo que ya se veía bien cambia ───────────────────────────
console.log('\n4. Lo que ya estaba bien se ve igual que antes');
check(fmtCant(120, 85.50) === '120',
  `una cantidad redonda no se rellena con ceros (dio "${fmtCant(120, 85.50)}")`);
check(fmtCant(0, 85.50) === '0', `cero se ve como 0 (dio "${fmtCant(0, 85.50)}")`);
check(fmtCant(null, 85.50) === '0', `null se ve como 0 (dio "${fmtCant(null, 85.50)}")`);
check(fmtCant(undefined, 85.50) === '0', `undefined se ve como 0 (dio "${fmtCant(undefined, 85.50)}")`);
check(fmtCant(1234.5, 0) === '1,234.5',
  `sin PU se usa el piso 2 (dio "${fmtCant(1234.5, 0)}")`);

// ── 5. El ruido del double no se filtra a la pantalla ──────────────────
// 0.1+0.2 se guarda como 0.30000000000000004. Sin el techo 4 saldrían 17
// decimales y el residente vería basura donde capturó 0.3.
console.log('\n5. El ruido del punto flotante no llega a pantalla');
check(fmtCant(0.1 + 0.2, 85.50) === '0.3',
  `0.1+0.2 se ve como 0.3 (dio "${fmtCant(0.1 + 0.2, 85.50)}")`);
check(fmtCant(1e-7, 85.50) === '0',
  `un exponencial diminuto no revienta (dio "${fmtCant(1e-7, 85.50)}")`);
check(fmtCant('994.4961', 85.50) === '994.4961',
  `una cantidad guardada como texto también (dio "${fmtCant('994.4961', 85.50)}")`);

// ── 6. LA ESCRITURA: la cantidad deducida al importar el Excel ─────────
//
// Esto NO es pantalla, y es la mitad grave del #9. Cuando el Excel no trae la
// cantidad —o la que trae no cuadra con su importe por más del 5%—,
// `parsearPresupuesto` la DEDUCE como `importe / pu` y la GUARDA. Se deducía a
// dos decimales fijos, y con eso deshacía la igualdad que acababa de restaurar:
// se deduce precisamente porque `cant × pu` no daba el importe.
//
// La propiedad que se exige es la que `decimalesPorPU` promete: el último
// dígito no vale más de un peso, así que la cantidad guardada tiene que
// RECUPERAR su importe con error menor a $1. Con dos decimales fijos, en un PU
// de siete cifras el error eran $5,778 en una sola partida.
//
// Se barre un abanico de precios en vez de afirmar un caso: el defecto no está
// en un número, está en que la precisión no depende del precio.
console.log('\n6. Al importar el catálogo, la cantidad deducida recupera su importe');
if (typeof parsearPresupuesto !== 'function') {
  check(false, 'se pudo extraer `parsearPresupuesto` para ejercitar la deducción');
} else {
  // PU de 2, 4, 5 y 7 cifras. La cantidad real lleva seis decimales, así que
  // ningún precio la captura con dos.
  const CANT_REAL = 1.234567;
  const PRECIOS = [85.50, 1000, 12500, 1265249];
  const filas = [['Clave', 'Descripción', 'Unidad', 'Cantidad', 'P.U.', 'Importe']];
  PRECIOS.forEach((pu, i) => {
    // El importe es el que trae el Excel: redondeado a centavos, como todo
    // importe de un presupuesto real.
    const importe = Math.round(CANT_REAL * pu * 100) / 100;
    // Cantidad en blanco: es el caso que dispara la deducción.
    filas.push([`A-0${i + 1}`, `Partida de prueba ${i + 1}`, 'M3', '', pu, importe]);
  });
  const contrato = filas.slice(1).reduce((t, f) => t + f[5], 0);
  const r = parsearPresupuesto(filas, contrato);
  const conceptos = r?.conceptos || [];
  check(conceptos.length === PRECIOS.length,
    `el Excel de prueba entra entero: ${conceptos.length} de ${PRECIOS.length} partidas`);
  check(conceptos.every(c => c.cantDeducida),
    'las cuatro cantidades se deducen (es el camino que se está midiendo)');
  for (const c of conceptos) {
    const recuperado = c.cant * c.pu;
    const error = Math.abs(recuperado - c.importe);
    check(error < 1,
      `PU ${c.pu}: cant ${c.cant} × PU recupera el importe con $${error.toFixed(2)} ` +
      `de error (importe $${c.importe})`);
  }
  // Y la mitad que un `toFixed(6)` para todos también pasaría: la cantidad no
  // se guarda con más resolución de la que su precio justifica, porque eso
  // escribe el ruido del double en Firestore.
  const conPrecioAlto = conceptos.find(c => c.pu === 1265249);
  check(conPrecioAlto && conPrecioAlto.cant === CANT_REAL,
    `con PU de siete cifras se guardan los seis decimales reales ` +
    `(guardó ${conPrecioAlto ? conPrecioAlto.cant : '—'}, se capturó ${CANT_REAL})`);
  const conPrecioBajo = conceptos.find(c => c.pu === 85.50);
  check(conPrecioBajo && String(conPrecioBajo.cant).replace(/^[^.]*\.?/, '').length <= 2,
    `con PU de dos cifras no se guarda más precisión de la que vale ` +
    `(guardó ${conPrecioBajo ? conPrecioBajo.cant : '—'})`);
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log('VERDE — la pantalla no esconde precisión guardada, y la cantidad deducida recupera su importe.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
