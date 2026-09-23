#!/usr/bin/env node
// Prueba: en Nómina queda UN bloque de KPIs, los dos conteos de personal
// siguen ahí con nombre propio, y el importe de horas extra se calcula en un
// solo lugar.
//
// Lo de las horas extra no arregla nada visible: hoy el escritor pone
// `totalHEImp` y el alias `totalHE` con el mismo valor, y los tres lectores
// que leían el alias pelón daban la cifra correcta. Medido contra las cinco
// obras de producción el 2026-09-22. El problema es el día que el escritor
// deje de poner el alias: esos tres se van a cero, sin excepción y sin que
// nada falle. Esta prueba fija ese día en verde por adelantado — le pasa a
// los lectores un snapshot SIN alias y comprueba que ninguno se apaga.
//
// Uso:  node scripts/prueba-nomina-kpi-unico.cjs [archivo]

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Extracción ────────────────────────────────────────────────────────────
const global = {};
const enNomina = {};
let rendersMiniDashNomina = false;
let leenAliasPelon = [];

traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
      global[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'Nomina') return;
    p.traverse({ VariableDeclarator(q) {
      if (q.node.id.type === 'Identifier' && q.node.init)
        enNomina[q.node.id.name] ||= src.slice(q.node.init.start, q.node.init.end);
    }});
  },
  JSXOpeningElement(p) {
    if (p.node.name.name === 'MiniDashNomina') rendersMiniDashNomina = true;
  },
  // Cualquier `X.totalHE` que no esté dentro de `heImporte` es un lector
  // suelto: exactamente lo que este cambio elimina.
  MemberExpression(p) {
    if (p.node.property?.name !== 'totalHE') return;
    let f = p.getFunctionParent();
    while (f) {
      const id = f.node.id?.name || f.parent?.id?.name;
      if (id === 'heImporte') return;
      if (id === 'MiniDashNomina') return;   // deprecada, ya no se renderiza
      f = f.getFunctionParent();
    }
    leenAliasPelon.push(src.slice(0, p.node.start).split('\n').length);
  },
});

if (!global['heImporte']) noArranco(['heImporte']);

const heImporte = new Function(`"use strict"; return ${global['heImporte']};`)();

// ── 1. Un solo bloque ─────────────────────────────────────────────────────
console.log('1. Queda un solo bloque de KPIs en Nómina');
check(!rendersMiniDashNomina,
  'MiniDashNomina ya no se renderiza en ninguna parte',
  rendersMiniDashNomina ? 'sigue montándose' : 'ningún <MiniDashNomina/>');

// ── 2. Un solo cálculo de horas extra ─────────────────────────────────────
console.log('\n2. El importe de horas extra se calcula en un solo lugar');
check(leenAliasPelon.length === 0,
  'ningún lector suelto de `.totalHE` fuera de `heImporte`',
  leenAliasPelon.length ? `líneas ${leenAliasPelon.join(', ')}` : 'ninguno');

console.log('\n3. Y ese cálculo aguanta que el alias desaparezca');
const conAmbos  = { totalHEImp: 9610, totalHE: 9610, totalNomina: 846044, trabajadores: [] };
const sinAlias  = { totalHEImp: 9610, totalNomina: 846044, trabajadores: [] };
const soloAlias = { totalHE: 9610, totalNomina: 846044, trabajadores: [] };
const ninguno   = { totalNomina: 846044,
  trabajadores: [{ impHE: 6000 }, { impHE: 3610 }, { impHE: 0 }] };
check(heImporte(conAmbos) === 9610,  'con los dos campos da la cifra', String(heImporte(conAmbos)));
check(heImporte(sinAlias) === 9610,  'SIN el alias sigue dando la cifra — no cae a cero', String(heImporte(sinAlias)));
check(heImporte(soloAlias) === 9610, 'con snapshots viejos que solo traen el alias, también', String(heImporte(soloAlias)));
check(heImporte(ninguno) === 9610,   'y sin ninguno de los dos la recalcula desde trabajadores', String(heImporte(ninguno)));
check(heImporte(undefined) === 0 && heImporte({}) === 0,
  'sin semana devuelve 0 sin reventar');
// Si alguien volviera a leer el alias pelón, ESTE es el caso que lo delata.
check(sinAlias.totalHE === undefined,
  'el caso de prueba es justo el que apagaba a los lectores sueltos');

// ── 4. Los dos conteos de personal, con nombre ────────────────────────────
console.log('\n4. Los dos conteos de personal siguen ahí, ya no confundibles');
for (const n of ['enListado', 'conPago', 'heActual', 'pctHE'])
  if (!enNomina[n]) check(false, `se pudo extraer \`${n}\` de Nomina()`);
if (fallas) { console.log(`\n${fallas} comprobación(es) en rojo.`); process.exit(1); }

const calcular = semanaActual => new Function('semanaActual', 'heImporte', `
  "use strict";
  const enListado = ${enNomina['enListado']};
  const conPago   = ${enNomina['conPago']};
  const heActual  = ${enNomina['heActual']};
  const pctHE     = ${enNomina['pctHE']};
  return { enListado, conPago, heActual, pctHE };
`)(semanaActual, heImporte);

// Los números reales del último cierre de la 0125 (Semana 37): 106 directos,
// 37 indirectos = 143 en el listado; 141 con algo cobrado. Los 2 de
// diferencia son las altas del día del cierre, sin días trabajados.
const s0125 = { totalDir: 106, totalInd: 37, totalNomina: 846044.132,
  totalHEImp: 9610, totalHE: 9610,
  trabajadores: [...Array(141)].map(() => ({ total: 5000, impHE: 0 }))
    .concat([{ total: 0, impHE: 0 }, { total: 0, impHE: 0 }]) };
const r = calcular(s0125);
check(r.enListado === 143, 'en listado 143', String(r.enListado));
check(r.conPago === 141,   'con pago 141',   String(r.conPago));
check(r.enListado !== r.conPago,
  'siguen siendo distintos — por eso cada uno lleva su etiqueta');

// Un snapshot viejo sin array de trabajadores no puede inventar el segundo
// conteo: va en "no disponible" y el KPI cae al único que sí midió (P2).
const viejo = calcular({ totalDir: 30, totalInd: 13, totalNomina: 153833 });
check(viejo.enListado === 43, 'un snapshot sin trabajadores conserva el conteo del listado');
check(viejo.conPago === null,
  'y NO inventa un "con pago" de 0, que se leería como que nadie cobró',
  String(viejo.conPago));

console.log('\n5. El color de horas extra avisa por proporción, no solo por delta');
check(Math.abs(r.pctHE - 1.136) < 0.01, `0125 al ${r.pctHE.toFixed(2)}% de la nómina`);
const s0114 = { totalDir: 80, totalInd: 10, totalNomina: 656713.67,
  totalHEImp: 217980, totalHE: 217980, trabajadores: [] };
const r14 = calcular(s0114);
check(r14.pctHE > 15,
  `la 0114 va al ${r14.pctHE.toFixed(1)}% — pasa del 15% y por eso se pinta`,
  'su delta contra la semana anterior era NEGATIVO: el delta solo no lo decía');
check(r14.heActual === 217980, 'y la cifra es la real, no la del alias por casualidad');

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
