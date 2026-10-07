#!/usr/bin/env node
// La llave de React del renglón de una estimación.
//
// POR QUÉ ESTA PRUEBA. Las dos listas de estimaciones —la tabla de la
// constructora y la relación del cliente— se llaveaban con `e.no`, el número
// de estimación. Pero `no` SE TECLEA, y una llave no puede depender de algo
// que se teclea:
//
//   · Puede FALTAR. El propio `sort` de la tabla ya lo admite —ordena con
//     `Number(x.e?.no)||0`—, así que el archivo sabe desde antes que `no`
//     puede no estar. Un `key={undefined}` no es «una llave rara»: para React
//     es una llave AUSENTE, y lo dice con el mismo aviso de consola que si no
//     se hubiera escrito ninguna.
//   · Puede REPETIRSE. Nada impide capturar dos estimaciones con el número 3.
//     Dos hermanos con la misma llave es el caso que React resuelve
//     descartando uno.
//
// Por qué importa más de lo que parece: en ESTA pantalla se teclea dinero, y
// lo que identifica al renglón que se escribe es `i` —`actualiza(i,…)` y el
// botón de borrar usan la posición en el arreglo—. Si la llave de React usa
// una identidad y la escritura usa otra, los dos criterios pueden separarse.
// La prueba exige que la llave sea la MISMA identidad que ya usa la escritura.
//
// La llave se extrae del archivo por AST y se EJECUTA. No está reescrita aquí:
// una prueba que recopia la expresión se comprueba contra sí misma.
//
// Uso:  node scripts/prueba-llave-estimacion.cjs [App.jsx]
//       node scripts/prueba-llave-estimacion.cjs --contraprueba

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const generate = require(path.join(raiz, 'node_modules/@babel/generator')).default;
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

// ── La contraprueba ────────────────────────────────────────────────────────
// Volver a poner `e.no` de llave, que es exactamente el código de antes. Una
// por pantalla y no una sola compartida: si fueran la misma mutación, bastaría
// con que la prueba viera la de la constructora para salir en rojo, y la del
// cliente se iría en verde sin que nadie la mida.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const base = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
  const MUTACIONES = [
    { nombre: 'la tabla de la constructora vuelve a llavear por `e.no`',
      de: `              return <tr key={i}>`,
      a:  `              return <tr key={e.no}>` },
    { nombre: 'la relación del cliente vuelve a llavear por `e.no`',
      de: `        return <div key={i} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,`,
      a:  `        return <div key={e.no} style={{background:C.bg,borderRadius:8,padding:"11px 13px",marginBottom:8,` },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en el archivo.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `llave-est-mut-${Date.now()}.jsx`);
    fs.writeFileSync(roto, base.replaceAll(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename, roto], { encoding: 'utf8' });
    const rojas = (r.stdout.match(/^ {3}✗ /gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : `NO LA VE   `}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} aserción(es) en rojo. ` +
        `Una mutación que no se ve es una aserción que no mide.`);
      if (r.status === 2) console.log(r.stdout.split('\n').slice(0, 8).map(l => '             ' + l).join('\n'));
    } else {
      for (const l of r.stdout.match(/^ {3}✗ .*/gm) || []) console.log(`             ${l.trim()}`);
    }
    fs.unlinkSync(roto);
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven. La prueba mide lo que dice medir.`
    : `\n${malas} mutación(es) pasaron inadvertidas.`);
  process.exit(malas > 0 ? 1 : 0);
}

const ARCH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(ARCH, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const fallos = [];
const check = (cond, m, detalle) => {
  const d = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${d}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${d}`); }
};

// ── Extracción ─────────────────────────────────────────────────────────────
// Del cuerpo de cada componente, el primer elemento JSX de la etiqueta que
// lleva el renglón, y de él su atributo `key`. Si no se encuentra, es NO
// ARRANCÓ: no hay nada que medir y decir «verde» sería mentir.
const PANTALLAS = [
  { nombre: 'constructora (tabla)',  componente: 'Estimaciones',        etiqueta: 'tr'  },
  { nombre: 'cliente (relación)',    componente: 'EstimacionesCliente', etiqueta: 'div' },
];

for (const p of PANTALLAS) {
  let fn = null;
  traverse(ast, {
    FunctionDeclaration(ruta) {
      if (ruta.node.id && ruta.node.id.name === p.componente) fn = ruta;
    },
  });
  if (!fn) noArranco(`no se encontró \`function ${p.componente}\` en ${path.basename(ARCH)}`);

  // El renglón: el primer <etiqueta> del componente que se construye dentro de
  // un `.map(` —es decir, el que es hermano de otros y por eso necesita llave—.
  let attr = null, params = null;
  fn.traverse({
    JSXOpeningElement(ruta) {
      if (attr) return;
      if (ruta.node.name.name !== p.etiqueta) return;
      const mapa = ruta.findParent(a =>
        a.isCallExpression() &&
        a.node.callee.type === 'MemberExpression' &&
        a.node.callee.property.name === 'map');
      if (!mapa) return;
      attr = ruta.node.attributes.find(a =>
        a.type === 'JSXAttribute' && a.name.name === 'key') || 'SIN_KEY';
      params = mapa.node.arguments[0] && mapa.node.arguments[0].params
        ? mapa.node.arguments[0].params.map(q => generate(q).code) : [];
    },
  });
  if (!attr) noArranco(`no se encontró un <${p.etiqueta}> dentro de un .map() en ${p.componente}`);

  console.log(`\n${p.nombre} — \`${p.componente}\``);

  check(attr !== 'SIN_KEY',
    `el <${p.etiqueta}> del renglón lleva atributo \`key\``,
    attr === 'SIN_KEY' ? 'no lo lleva' : 'lo lleva');
  if (attr === 'SIN_KEY') continue;

  const expr = generate(attr.value.expression).code;

  // Se EJECUTA la expresión del archivo. `e` e `i` son los nombres que usa el
  // componente; se toman de los parámetros reales del `.map`, no se suponen.
  const llave = new Function('e', 'i', `return (${expr});`);

  // Cuatro estimaciones como las que hay en un expediente de verdad: dos sin
  // número —legado capturado antes de que el campo existiera— y dos que
  // repiten el 3, que es lo que pasa cuando dos personas capturan lo mismo.
  const FILAS = [{ no: undefined }, { no: undefined }, { no: 3 }, { no: 3 }];
  const llaves = FILAS.map((e, i) => llave(e, i));

  check(llaves.every(k => k !== undefined && k !== null && !Number.isNaN(k)),
    'ninguna estimación se queda sin llave, ni cuando le falta el número',
    `llaves: ${llaves.map(k => String(k)).join(', ')}`);

  check(new Set(llaves.map(String)).size === FILAS.length,
    'dos estimaciones con el mismo número NO comparten llave',
    `${new Set(llaves.map(String)).size} distintas de ${FILAS.length}`);

  // Que la llave sea la misma identidad con la que se ESCRIBE el renglón.
  // `actualiza(i,…)` escribe por la posición en el arreglo; si la llave usara
  // otra cosa, los dos criterios podrían separarse sin que nadie lo note.
  check(llaves.every((k, i) => String(k) === String(i)),
    'la llave es la posición en el arreglo — la misma identidad que usa la escritura',
    `\`key={${expr}}\``);

  // Y que React, ejecutándolo, no tenga nada que reclamar. Ésta es la aserción
  // que mira el síntoma en vez del código: el aviso de consola.
  const avisos = [];
  const orig = console.error;
  console.error = (...a) => { avisos.push(String(a[0])); };
  try {
    const hijos = FILAS.map((e, i) =>
      React.createElement(p.etiqueta, { key: llave(e, i) },
        React.createElement(p.etiqueta === 'tr' ? 'td' : 'span', null, 'x')));
    renderToStaticMarkup(
      p.etiqueta === 'tr'
        ? React.createElement('table', null, React.createElement('tbody', null, hijos))
        : React.createElement('div', null, hijos));
  } finally { console.error = orig; }

  const deLlave = avisos.filter(a => /key/i.test(a));
  check(deLlave.length === 0,
    'React no reclama por las llaves al pintar los cuatro renglones',
    deLlave.length ? deLlave[0].split('%s')[0].trim() : 'sin avisos');
}

console.log();
if (fallos.length === 0) {
  console.log(`VERDE — las llaves de las ${PANTALLAS.length} listas de estimaciones aguantan un número ausente y uno repetido.`);
  process.exit(0);
}
console.log(`ROJO — ${fallos.length} aserción(es):`);
for (const f of fallos) console.log(`  · ${f}`);
process.exit(1);
