#!/usr/bin/env node
// Guarda de #9, la mitad de PANTALLA: ningún sitio imprime una cantidad con
// menos precisión de la que trae guardada.
//
// EL DEFECTO, medido el 2026-11-13. `fmtCant` se escribió en el #30 justo para
// esto —"Sustituye al `maximumFractionDigits: 2` que truncaba lo capturado"— y
// tres sitios nunca se enteraron: las dos tablas del catálogo (la que se revisa
// antes de reemplazar y la del catálogo ya guardado) y el renglón de concepto
// del subcontrato en modo porcentaje. Los tres seguían con `2` tecleado a mano.
// La partida 129 de la 0125 tiene `cant = 994.4961` en Firestore y en esas tres
// pantallas salía 994.5.
//
// POR QUÉ IMPORTA MÁS QUE UN DECIMAL. En esas tablas la cantidad va AL LADO de
// su PU y de su importe, y el residente las lee juntas para cuadrar: 994.5 ×
// $85.50 da $85,029.75 y la columna de importe dice $85,029.42. La pantalla
// pone tres números donde dos no producen el tercero, y el que está mal es el
// que ella misma truncó. En la tabla de revisión, además, la cantidad puede ir
// marcada `(calc)` —deducida como importe/PU—, o sea que es precisamente la que
// se dedujo para que cuadrara.
//
// POR QUÉ ES UN BARRIDO Y NO TRES ASERCIONES. «El patrón se arregla en todo el
// repo, no en el renglón que falló». Este banco no nombra los tres sitios: los
// BUSCA. Recorre el AST de `src/App.jsx`, se queda con cada contenedor JSX hoja
// —sin JSX dentro— que imprima una cantidad con formato, EJECUTA su expresión
// tal como está escrita con una cantidad de cuatro decimales sembrada, y exige
// que los cuatro salgan. Un sitio nuevo escrito mañana con un `2` a mano cae
// solo. Es P3: se ejecuta la expresión de la pantalla, no se afirma que exista
// `fmtCant`.
//
// Lo que NO cubre: la ESCRITURA. Que la cantidad deducida al importar el Excel
// se guarde con la precisión que pide su precio lo mide
// `prueba-decimales-capturados.cjs`, que es donde vive `decimalesPorPU`.
//
// Uso:  node scripts/prueba-la-cantidad-se-ve-como-se-guardo.cjs [App.jsx]
//
// El argumento corre la prueba contra una versión anterior para comprobar que
// ahí falla — una prueba que nunca ha fallado no prueba nada:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-la-cantidad-se-ve-como-se-guardo.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const { cierreDe } = require('./extraer-de-app.cjs');

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

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);

// ── Qué cuenta como «un sitio que imprime una cantidad» ────────────────
//
// Nombra una cantidad Y la pasa por un formateador. Las dos mitades hacen
// falta: sin la primera entran todos los pesos, y sin la segunda entran los
// `cant > 0` de las guardas, que no imprimen nada.
//
// Se descartan los contenedores que llevan JSX dentro porque son los PADRES de
// estos mismos: el `{modoVol ? <>Cat: {fmtCant(…)}…</> : …}` envuelve al hoja
// que de verdad imprime. Quedarse con los dos contaría el mismo sitio dos veces
// y obligaría a montar React para ejecutar el de arriba.
const NOMBRA_CANTIDAD = /\b(cant|cantidad|cantEjec|cantCat)\b/;
const FORMATEA = /toLocaleString|fmtCant|\bNUM\s*\(|toFixed/;

const sitios = [];
traverse(ast, {
  JSXExpressionContainer(p) {
    const texto = src.slice(p.node.start, p.node.end);
    if (!NOMBRA_CANTIDAD.test(texto) || !FORMATEA.test(texto)) return;
    let conJSX = false;
    p.traverse({
      JSXElement() { conJSX = true; },
      JSXFragment() { conJSX = true; },
    });
    if (conJSX) return;
    sitios.push({
      linea: src.slice(0, p.node.start).split('\n').length,
      // Sin las llaves: lo que se ejecuta es la expresión.
      expr: src.slice(p.node.expression.start, p.node.expression.end),
    });
  },
});

console.log(`\nArchivo: ${path.relative(raiz, ARCH_APP)}`);
console.log(`Sitios hoja que imprimen una cantidad con formato: ${sitios.length}\n`);

// Un barrido de cero sitios sale verde sin haber mirado nada: es el P4 por el
// lado que no avisa. Si el JSX cambió de forma hasta dejar de parecerse a esto,
// lo que hay que decir es que no se midió.
if (sitios.length === 0) {
  noArranco(['ningún contenedor JSX que imprima una cantidad con formato'], ARCH_APP);
}

// ── El escenario sembrado ──────────────────────────────────────────────
//
// La partida 129 real de la 0125: 994.4961 M2 a $85.50. PU bajo, así que el
// piso de `decimalesPorPU` es 2 y los cuatro decimales sólo sobreviven si el
// sitio respeta lo capturado.
const CANT = 994.4961;
const PU = 85.50;
const ESPERADO = '994.4961';

// Las locales del componente en el que vive cada expresión. No son la app: son
// el escenario. Van por `excluir` para que ninguna declaración de módulo las
// pise, y si mañana un sitio nombra una local que no está aquí el banco sale 2
// con el nombre puesto — no verde por haberlo saltado.
const ESCENARIO = {
  // Los dos objetos de partida que recorren las tablas y los renglones.
  s: { cant: CANT, cantEjec: CANT, pu: PU, unidad: 'M2', imp: CANT * PU, importe: CANT * PU },
  c: { cant: CANT, cantidad: CANT, cantEjec: CANT, pu: PU, unidad: 'M2', importe: CANT * PU },
  // Las que el componente ya había desempacado antes de imprimir.
  cant: CANT, cantCat: CANT, cantEjec: CANT,
  // En modo volumen y con volumen derivable: es la rama que imprime cantidad.
  modoVol: true, pctDerivable: true, pctDisplay: 100,
};
const NOMBRES = Object.keys(ESCENARIO);

const render = (sitio) => {
  const cuerpo = cierreDe(sitio.expr, { archivo: ARCH_APP, excluir: NOMBRES });
  let fn;
  try {
    fn = new Function(...NOMBRES, `"use strict";\n${cuerpo}\nreturn (${sitio.expr});`);
  } catch (e) {
    noArranco([`la expresión de App.jsx:${sitio.linea} no se pudo montar — ${e.message}`], ARCH_APP);
  }
  try {
    return String(fn(...NOMBRES.map(n => ESCENARIO[n])));
  } catch (e) {
    if (e instanceof ReferenceError) {
      noArranco([`App.jsx:${sitio.linea} imprime una cantidad y este banco no supo ` +
                 `sembrarle \`${String(e.message).replace(/ is not defined.*/, '')}\``], ARCH_APP);
    }
    throw e;
  }
};

// ── 1. Todos los sitios, uno por uno ───────────────────────────────────
console.log('1. Cada sitio imprime los cuatro decimales guardados (994.4961 M2 a $85.50)');
for (const sitio of sitios) {
  const salida = render(sitio);
  check(salida.includes(ESPERADO),
    `App.jsx:${sitio.linea} muestra ${ESPERADO} (imprimió "${salida.trim().slice(0, 40)}")`);
}

// ── 2. Y ninguno la trunca ─────────────────────────────────────────────
// La aserción de arriba podría pasar con un sitio que imprimiera las dos
// cifras. Ésta exige que la truncada NO esté: «994.5» suelto, sin los dos
// decimales que siguen.
console.log('\n2. Y ninguno imprime además la versión truncada');
for (const sitio of sitios) {
  const salida = render(sitio);
  check(!/994\.5(?![0-9])/.test(salida),
    `App.jsx:${sitio.linea} no imprime «994.5» (imprimió "${salida.trim().slice(0, 40)}")`);
}

// ── 3. El piso del PU alto sigue respetado ─────────────────────────────
// La otra mitad de `decimalesPorPU`: con un precio de siete cifras el piso es 6
// y cortar en 4 esconde pesos, no centavos. Un sitio que hiciera `toFixed(4)`
// pasaría la sección 1 y caería aquí.
console.log('\n3. Con PU de siete cifras no se baja del piso de seis decimales');
{
  const CANT6 = 1.234567, PU6 = 1265249;
  const alto = { ...ESCENARIO,
    s: { ...ESCENARIO.s, cant: CANT6, cantEjec: CANT6, pu: PU6 },
    c: { ...ESCENARIO.c, cant: CANT6, cantidad: CANT6, cantEjec: CANT6, pu: PU6 },
    cant: CANT6, cantCat: CANT6, cantEjec: CANT6 };
  for (const sitio of sitios) {
    const cuerpo = cierreDe(sitio.expr, { archivo: ARCH_APP, excluir: NOMBRES });
    const fn = new Function(...NOMBRES, `"use strict";\n${cuerpo}\nreturn (${sitio.expr});`);
    const salida = String(fn(...NOMBRES.map(n => alto[n])));
    check(salida.includes('1.234567'),
      `App.jsx:${sitio.linea} muestra 1.234567 con PU $1,265,249 (imprimió "${salida.trim().slice(0, 40)}")`);
  }
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log(`VERDE — los ${sitios.length} sitios imprimen la cantidad como se guardó.\n`);
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
