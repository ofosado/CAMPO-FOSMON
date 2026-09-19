#!/usr/bin/env node
// Prueba de la guarda de PENDIENTES #21: cambiar una obra a modo volumen
// cuando el catálogo no tiene volúmenes no debe ocultar ni borrar el avance.
//
// No hay jsdom ni runner de componentes en el proyecto, y la app no tiene
// cableado de emuladores, así que esta prueba NO renderiza. Lo que hace es
// extraer del propio `src/App.jsx`, por AST, las expresiones reales que
// gobiernan el display y la escritura, y evaluarlas contra los casos. Si
// alguien reintroduce el defecto en esas líneas, esta prueba falla.
//
// Lo que cubre:  la derivación del % mostrado y el updater del input.
// Lo que NO cubre: el render, el guardado a Firestore, la navegación.
//
// Uso:  node scripts/prueba-guarda-modo-volumen.cjs

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const ARCHIVO = path.join(raiz, 'src/App.jsx');
const codigo = fs.readFileSync(ARCHIVO, 'utf8');
const ast = parse(codigo, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
const fuente = n => codigo.slice(n.start, n.end);

// ── Extracción ─────────────────────────────────────────────────────────
// Inicializadores de variables por nombre, dentro de la función que
// contenga un marcador dado (para no confundir homónimos de otras pantallas).
function initsDeclarados(nombres, marcador) {
  const encontrados = {};
  traverse(ast, {
    VariableDeclarator(p) {
      if (!p.node.id || p.node.id.type !== 'Identifier') return;
      if (!nombres.includes(p.node.id.name) || encontrados[p.node.id.name]) return;
      const fn = p.getFunctionParent();
      if (!fn || !fuente(fn.node).includes(marcador)) return;
      encontrados[p.node.id.name] = fuente(p.node.init);
    },
  });
  return encontrados;
}

// La función flecha (handler) que contenga todos los marcadores dados.
function handlerCon(marcadores) {
  let hallado = null;
  traverse(ast, {
    ArrowFunctionExpression(p) {
      if (hallado) return;
      const src = fuente(p.node);
      if (src.length < 4000 && marcadores.every(m => src.includes(m))) hallado = src;
    },
  });
  return hallado;
}

const fallos = [];
const ok = m => console.log(`   ✓ ${m}`);
const check = (cond, m) => { if (cond) ok(m); else { fallos.push(m); console.log(`   ✗ ${m}`); } };

// ── 1. Capturador de la obra: display ──────────────────────────────────
console.log('\n1. Capturador de la obra — ¿qué porcentaje muestra?');

const dispObra = initsDeclarados(
  ['cantCat', 'cantEjec', 'pctDerivable', 'pctDerivado', 'pctDisplay'],
  'Cantidad ejecutada acumulada');

for (const v of ['cantCat', 'cantEjec', 'pctDerivable', 'pctDerivado', 'pctDisplay']) {
  if (!dispObra[v]) {
    console.log(`   ✗ no se encontró la declaración de \`${v}\` — ¿se renombró?`);
    fallos.push(`declaración de ${v}`);
  }
}

function pctMostradoObra(s, modoVol) {
  const f = new Function('s', 'modoVol', `
    const cantCat = ${dispObra.cantCat};
    const cantEjec = ${dispObra.cantEjec};
    const pctDerivable = ${dispObra.pctDerivable};
    const pctDerivado = ${dispObra.pctDerivado};
    return ${dispObra.pctDisplay};`);
  return f(s, modoVol);
}

// El caso que motivó todo: Oaxaca / Cangrejera pasadas a volumen.
const partidaSinVolumen = { a: 88, cant: 0, pu: 0, cantEjec: 0, imp: 100000 };
check(pctMostradoObra(partidaSinVolumen, true) === 88,
  `a=88, cant=0, modo volumen → muestra ${pctMostradoObra(partidaSinVolumen, true)}% (esperado 88)`);

// Migración a medias: catálogo ya con volúmenes, avance aún en %.
const partidaMigrando = { a: 88, cant: 200, pu: 500, cantEjec: 0, imp: 100000 };
check(pctMostradoObra(partidaMigrando, true) === 88,
  `a=88, cant=200, cantEjec=0 → muestra ${pctMostradoObra(partidaMigrando, true)}% (esperado 88)`);

// Regresión: una partida que sí opera en volumen no debe cambiar.
const partidaVolumen = { a: 50, cant: 200, pu: 500, cantEjec: 100, imp: 100000 };
check(pctMostradoObra(partidaVolumen, true) === 50,
  `cant=200, cantEjec=100 → deriva ${pctMostradoObra(partidaVolumen, true)}% (esperado 50)`);

// Regresión: el excedente sobre catálogo se sigue viendo sin topar.
const partidaExcedida = { a: 630, cant: 100, pu: 500, cantEjec: 630, imp: 50000 };
check(pctMostradoObra(partidaExcedida, true) === 630,
  `cant=100, cantEjec=630 → muestra ${pctMostradoObra(partidaExcedida, true)}% sin topar (esperado 630)`);

// Regresión: modo porcentaje intacto.
check(pctMostradoObra({ a: 42, imp: 1000 }, false) === 42,
  `modo porcentaje, a=42 → muestra ${pctMostradoObra({ a: 42, imp: 1000 }, false)}% (esperado 42)`);

// ── 2. Capturador de la obra: escritura ────────────────────────────────
console.log('\n2. Capturador de la obra — ¿qué escribe al teclear?');

const onChangeObra = handlerCon(['setSubs', 'cantEjec', 'parseFloat(s.cant)']);
if (!onChangeObra) {
  console.log('   ✗ no se encontró el onChange del input de volumen');
  fallos.push('onChange de la obra');
}

function teclear(sub, valor) {
  let resultado = null;
  const setSubs = fn => { resultado = fn([sub])[0]; };
  const f = new Function('s', 'subId', 'setSubs', 'e', `(${onChangeObra})(e);`);
  f(sub, sub.id, setSubs, { target: { value: String(valor) } });
  return resultado;
}

const antes = { id: 'p1', a: 88, cant: 0, pu: 0, cantEjec: 0, imp: 100000 };
const despues = teclear(antes, 5);
check(despues.a === 88,
  `sin cant, teclear 5 → \`a\` queda en ${despues.a} (esperado 88, NO se borra)`);
check(despues.cantEjec === 5,
  `sin cant, teclear 5 → cantEjec queda en ${despues.cantEjec} (esperado 5)`);

// Regresión: con catálogo con volúmenes, `a` SÍ debe derivarse.
const antesVol = { id: 'p2', a: 0, cant: 200, pu: 500, cantEjec: 0, imp: 100000 };
const despuesVol = teclear(antesVol, 100);
check(despuesVol.a === 50,
  `con cant=200, teclear 100 → \`a\` derivado = ${despuesVol.a} (esperado 50)`);

// Regresión: el excedente no se recorta al escribir.
const despuesExc = teclear({ id: 'p3', a: 0, cant: 100, pu: 500, cantEjec: 0, imp: 50000 }, 630);
check(despuesExc.a === 630,
  `con cant=100, teclear 630 → \`a\` = ${despuesExc.a} sin topar (esperado 630)`);

// ── 3. Editor de conceptos de subcontratos ─────────────────────────────
console.log('\n3. Subcontratos — mismo defecto en la escritura');

const onChangeSub = handlerCon(['actualizarConcepto', 'cantEjec: v']);
if (!onChangeSub) {
  console.log('   ✗ no se encontró el onChange del editor de subcontratos');
  fallos.push('onChange de subcontratos');
}

function teclearSub(cant, valor) {
  let cambios = null;
  const actualizarConcepto = (_i, c) => { cambios = c; };
  const f = new Function('cant', 'i', 'actualizarConcepto', 'e', `(${onChangeSub})(e);`);
  f(cant, 0, actualizarConcepto, { target: { value: String(valor) } });
  return cambios;
}

const camSin = teclearSub(0, 5);
check(!('avance' in camSin),
  `sin cantidad, teclear 5 → no se toca \`avance\` (escribe ${JSON.stringify(camSin)})`);
check(camSin.cantEjec === 5,
  `sin cantidad, teclear 5 → cantEjec = ${camSin.cantEjec} (esperado 5)`);

const camCon = teclearSub(200, 100);
check(camCon.avance === 50,
  `con cantidad=200, teclear 100 → avance derivado = ${camCon.avance} (esperado 50)`);

// ── Resultado ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
if (fallos.length === 0) {
  console.log('TODO EN VERDE — la guarda de PENDIENTES #21 se sostiene.');
  process.exit(0);
}
console.log(`${fallos.length} FALLA(S):`);
fallos.forEach(f => console.log('  · ' + f));
process.exit(1);
