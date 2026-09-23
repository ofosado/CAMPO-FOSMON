#!/usr/bin/env node
// Medición: qué enseña hoy el tablero de la 0125 con los números de semana
// mal raspados, y qué enseñaría con los buenos.
//
// No es una prueba —no afirma nada, no falla—: es un contraste, para poder
// decir con cifras qué quedó mal etiquetado. Corre el MISMO recorrido que la
// app (el oyente de `obras/{id}/nomina/historial` se extrae de `src/App.jsx`
// y se ejecuta) sobre los datos de producción leídos el 2026-09-22, dos
// veces: con el campo `semana` tal como está guardado, y con las nueve
// correcciones de `scripts/migracion-nomina-anios.cjs`.
//
// Uso:  node scripts/medir-dano-semana-0125.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

const global = {};
let oyenteNomina = null;
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
      global[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  CallExpression(p) {
    if (p.node.callee.name !== 'onSnapshot' || p.node.arguments.length < 2) return;
    if (!/'nomina'\s*,\s*'historial'/.test(src.slice(p.node.arguments[0].start, p.node.arguments[0].end))) return;
    oyenteNomina = src.slice(p.node.arguments[1].start, p.node.arguments[1].end);
  },
});

const necesarios = ['semanaISO', 'heImporte', 'numSemanaNomina', 'fechaCargaNomina',
  'añoSemanaNomina', 'claveSemanaNomina', 'semanasDeNomina'];
const faltan = necesarios.filter(n => !global[n]);
if (faltan.length || !oyenteNomina) {
  console.error('No se pudo montar la medición. Falta: ' + (faltan.join(', ') || 'el oyente de nómina'));
  process.exit(2);
}
const api = new Function(`"use strict";
  ${necesarios.map(n => `const ${n} = ${global[n]};`).join('\n  ')}
  return { ${necesarios.join(', ')} };`)();

const loQueRecibeElTablero = (registros) => {
  let recibido = null;
  new Function('snap', 'patch', 'o', ...necesarios, `"use strict"; (${oyenteNomina})(snap);`)(
    { exists: () => true, data: () => ({ semanas: registros }) },
    (_id, parche) => { recibido = parche.nominaSemanas; },
    { id: '0125' },
    ...necesarios.map(n => api[n]),
  );
  return recibido;
};

// ── Producción, 0125 (TAMSA Veracruz), leída el 2026-09-22 ─────────────────
// El arreglo va en ORDEN DE CARGA, que es como está guardado. `semanaMala` es
// el campo tal como lo escribió el parser; `semanaBuena` sale del nombre del
// archivo (ver la tabla SEMANAS de scripts/migracion-nomina-anios.cjs).
const trabs = (n, totalCada) => [...Array(n)].map(() => ({ total: totalCada, impHE: 0, dias: 6, tipo: 'D' }));
const reg = (semanaMala, semanaBuena, fecha, n, total) => ({
  semanaMala, semanaBuena, fecha, n, total,
  hacer: (num) => ({
    semana: `Semana ${String(num).padStart(2, '0')}`,
    fecha, archivo: `S${semanaBuena}.xlsx`,
    trabajadores: trabs(n, total / (n || 1)),
    totalNomina: total, totalDir: n, totalInd: 0,
    totalHEImp: 0, totalHEHrs: 0, totalDias: n * 6,
  }),
});

const P = [
  reg( 4, 24, '19/6/2026',  94,  485378.33),
  reg(11, 25, '19/6/2026', 118,  762466.67),
  reg(30, 19, '19/6/2026',   2,    3000.00),
  reg( 7, 20, '19/6/2026',  11,   50833.33),
  reg(14, 21, '19/6/2026',  14,   76850.00),
  reg(21, 22, '19/6/2026',  50,  240546.33),
  reg(21, 23, '19/6/2026',  33,  160000.00),
  reg(18, 26, '6/7/2026',  136,  894083.03),
  reg(25, 27, '6/7/2026',  141, 1047028.99),
  reg(36, 36, '3/9/2026',  143,  918432.78),
  reg(37, 37, '14/9/2026', 143,  846044.13),
];

const HOY  = loQueRecibeElTablero(P.map(r => r.hacer(r.semanaMala)));
const BIEN = loQueRecibeElTablero(P.map(r => r.hacer(r.semanaBuena)));

const $ = n => '$' + (n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
const personal = s => (s.totalDir || 0) + (s.totalInd || 0);
const num = s => parseInt(String(s.semana).match(/(\d+)/)?.[1] ?? '0', 10);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n1. EL ORDEN DEL HISTORIAL Y DE LA GRÁFICA\n');
console.log('   hoy   ', HOY.map(num).map(n => String(n).padStart(2, '0')).join(' → '));
console.log('   bien  ', BIEN.map(num).map(n => String(n).padStart(2, '0')).join(' → '));
console.log(`\n   ${HOY.length} filas hoy, ${BIEN.length} con los números buenos.`);

console.log('\n2. LA CURVA DE NÓMINA QUE SE PINTA\n');
const curva = (serie) => serie.map(s => `S${String(num(s)).padStart(2,'0')}:${personal(s)}`).join('  ');
console.log('   personal, hoy   ', curva(HOY));
console.log('   personal, bien  ', curva(BIEN));
const bajadas = (serie) => serie.reduce((c, s, i) =>
  i > 0 && personal(s) < personal(serie[i - 1]) ? c + 1 : c, 0);
console.log(`\n   bajadas de plantilla que dibuja la gráfica: hoy ${bajadas(HOY)}, de verdad ${bajadas(BIEN)}.`);

console.log('\n3. LA FILA QUE NUNCA EXISTIÓ\n');
for (const s of HOY) {
  if ((s.partes || []).length > 1)
    console.log(`   hoy: «${s.semana}» = ${personal(s)} trabajadores, ${$(s.totalNomina)}, ` +
      `fundida de ${s.partes.length} archivos.`);
}
for (const s of BIEN) {
  if ((s.partes || []).length > 1)
    console.log(`   bien: «${s.semana}» viene en ${s.partes.length} partes.`);
}
const f22 = BIEN.find(s => num(s) === 22), f23 = BIEN.find(s => num(s) === 23);
if (f22 && f23) console.log(`   de verdad son dos: S22 = ${personal(f22)} por ${$(f22.totalNomina)} ` +
  `y S23 = ${personal(f23)} por ${$(f23.totalNomina)}.`);

console.log('\n4. LOS KPIs DE "SEMANA ACTUAL" Y SUS DELTAS\n');
const kpis = (serie, etiqueta) => {
  const act = serie[serie.length - 1], ant = serie[serie.length - 2];
  console.log(`   ${etiqueta}  actual «${act.semana}» ${personal(act)} pers · ${$(act.totalNomina)}` +
    `   ·   anterior «${ant.semana}» ${personal(ant)} pers · ${$(ant.totalNomina)}`);
  console.log(`   ${' '.repeat(etiqueta.length)}  delta personal ${personal(act) - personal(ant) >= 0 ? '+' : ''}` +
    `${personal(act) - personal(ant)}   delta nómina ${act.totalNomina - ant.totalNomina >= 0 ? '+' : ''}` +
    `${$(act.totalNomina - ant.totalNomina)}`);
};
kpis(HOY, 'hoy '); kpis(BIEN, 'bien');

console.log('\n5. HUECOS: SEMANAS QUE FALTAN EN EL HISTORIAL\n');
const huecos = (serie) => {
  const ns = serie.map(num).sort((a, b) => a - b);
  const out = [];
  for (let n = ns[0]; n <= ns[ns.length - 1]; n++) if (!ns.includes(n)) out.push(n);
  return out;
};
console.log(`   hoy   ${huecos(HOY).length} semanas sin captura aparente: ${huecos(HOY).join(', ')}`);
console.log(`   bien  ${huecos(BIEN).length} semanas sin captura: ${huecos(BIEN).join(', ') || '(ninguna entre la 19 y la 27; el corte real es jul–ago)'}`);

console.log('\n6. EN QUÉ MES CREE EL TABLERO QUE PASÓ CADA COSA\n');
const MES = ['', 'ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const mesDe = (n) => { const d = new Date(2026, 0, 1 + (n - 1) * 7); return MES[d.getMonth() + 1]; };
for (const r of P.filter(r => r.semanaMala !== r.semanaBuena))
  console.log(`   ${r.hacer(r.semanaBuena).archivo.padEnd(9)} ` +
    `se enseña como S${String(r.semanaMala).padStart(2,'0')} (${mesDe(r.semanaMala)}) ` +
    `y es S${String(r.semanaBuena).padStart(2,'0')} (${mesDe(r.semanaBuena)})`);

console.log('');
