#!/usr/bin/env node
// Diagnóstico (no es prueba): ¿por qué el bloque de KPIs de arriba de Nómina
// sale en cero? Extrae los DOS bloques reales de `src/App.jsx` y los corre
// contra los cierres de nómina de producción, volcados aparte con
// `TOKEN=... python3 /tmp/dump-nomina.py` (solo lectura).
//
// No inventa datos: si el volcado no está, no corre.
//
// Uso:  node scripts/diagnostico-kpis-nomina.cjs [volcado.json]

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const volcado = process.argv[2] || '/tmp/nomina-prod.json';
if (!fs.existsSync(volcado)) {
  console.error(`No está el volcado de producción en ${volcado}.`);
  process.exit(2);
}
const prod = JSON.parse(fs.readFileSync(volcado, 'utf8'));

const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

// Del bloque de arriba nos interesan sus CUENTAS, no su JSX. Sacamos el cuerpo
// de `MiniDashNomina` hasta el `return` y lo reejecutamos tal cual.
let cuerpoArriba = null;
traverse(ast, {
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'MiniDashNomina') return;
    const ret = p.node.body.body.find(n => n.type === 'ReturnStatement' && n.argument?.type === 'JSXElement');
    cuerpoArriba = src.slice(p.node.body.start + 1, ret.start);
  },
});
if (!cuerpoArriba) { console.error('No se pudo extraer MiniDashNomina.'); process.exit(1); }

const arriba = new Function('semanaActual', `
  "use strict";
  ${cuerpoArriba.replace(/const semanaActual[^;]+;/, '').replace(/if \(!semanaActual\)[\s\S]*?\}\n/, '')}
  return { totalNom, totalHE, directos, indirectos, trabajadoresActivos,
           inasistentes, altasHE, pctHE, hayImpDias, totalSueldosBase };
`);

// El de abajo lee los campos del snapshot directo; sus cuatro cifras son
// literales en el JSX, así que se reproducen aquí sin extraer.
const abajo = (act, ant) => ({
  totalPersonal: act.totalDir + act.totalInd,
  directo: act.totalDir,
  indirecto: act.totalInd,
  totalNomina: act.totalNomina,
  horasExtra: act.totalHE,
  deltaHE: ant ? act.totalHE - ant.totalHE : 0,
});

const MXN = n => n == null ? '—'
  : (Number.isFinite(n) ? '$' + Math.round(n).toLocaleString('es-MX') : String(n));

let cerosArriba = 0, cerosAbajo = 0;
for (const [oid, semanas] of Object.entries(prod)) {
  const act = semanas[semanas.length - 1];
  const ant = semanas.length > 1 ? semanas[semanas.length - 2] : null;
  const A = arriba(act);
  const B = abajo(act, ant);
  console.log(`\n═══ obra ${oid} · ${act.semana} · ${semanas.length} semanas ═══`);
  console.log('  ARRIBA (MiniDashNomina)');
  console.log(`    Total nómina  ${MXN(A.totalNom)}`);
  console.log(`    Activos       ${A.trabajadoresActivos}  (${A.directos}D · ${A.indirectos}I)`);
  console.log(`    Horas extra   ${MXN(A.totalHE)}  (${A.pctHE.toFixed(1)}% del total)`);
  console.log(`    Sueldos base  ${A.hayImpDias ? MXN(A.totalSueldosBase) : '—'}`);
  console.log(`    Riesgo HE     ${A.altasHE}   Sin asistencia  ${A.inasistentes}`);
  console.log('  ABAJO (dentro de Nomina())');
  console.log(`    Total personal ${B.totalPersonal}  ·  ${B.directo}D / ${B.indirecto}I`);
  console.log(`    Total nómina   ${MXN(B.totalNomina)}`);
  console.log(`    Horas extra    ${MXN(B.horasExtra)}  (Δ ${MXN(B.deltaHE)})`);
  for (const [k, v] of Object.entries(A))
    if (typeof v === 'number' && v === 0) { console.log(`    → ARRIBA en cero: ${k}`); cerosArriba++; }
  for (const [k, v] of Object.entries(B))
    if (typeof v === 'number' && v === 0 && k !== 'deltaHE') { console.log(`    → ABAJO en cero: ${k}`); cerosAbajo++; }
  console.log(`  totalHE === totalHEImp ? ${act.totalHE === act.totalHEImp}` +
    `   (totalHE=${act.totalHE}, totalHEImp=${act.totalHEImp}, totalHEHrs=${act.totalHEHrs})`);
}
console.log(`\nCifras en cero — arriba: ${cerosArriba} · abajo: ${cerosAbajo}`);
