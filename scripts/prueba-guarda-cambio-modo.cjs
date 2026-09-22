#!/usr/bin/env node
// Guardas 1 y 2 de PENDIENTES #21 — cambiar a modo volumen sin volúmenes.
//
// La guarda 3 (que el capturador caiga a `a` y nunca escriba `a: 0`) ya está
// cerrada y la cubre scripts/prueba-guarda-modo-volumen.cjs. Ésta cubre las
// otras dos:
//
//   1. BLOQUEO DURO. A modo volumen no se pasa si las partidas no tienen
//      `cant` y `pu`. No es una preferencia: con `cant = 0` el capturador
//      deriva 0% en todas y no hay de dónde recuperar el avance.
//   2. CONFIRMACIÓN con cifras. Cuántas partidas se mueven y en cuánto queda
//      el ejecutado antes y después.
//
// Los escenarios son las formas reales medidas en producción el 2026-09-19:
//
//   | obra              | partidas | cant>0 | pu>0 | a>0 |
//   | 0114 Oaxaca       | 335      | 0      | 0    | 305 |
//   | 0126 Cangrejera   | 51       | 0      | 0    | 36  |
//   | 0112 Malecón      | 14       | 14     | 14   | 12  |
//
// QUÉ CUBRE Y QUÉ NO. Cubre la decisión: `diagnosticoCambioModo` se extrae por
// AST de src/App.jsx y se EJECUTA sobre esos catálogos. No cubre el render del
// modal — eso necesitaría un renderer de React. El cableado (que el clic llame
// a `pedirCambioModo` y no escriba el modo directo) sí se comprueba, pero por
// AST, y eso es verificar el mecanismo, no el comportamiento: vale como red
// contra una regresión de cableado, no como prueba de la guarda.
//
// Uso:  node scripts/prueba-guarda-cambio-modo.cjs [App.jsx]
//
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-guarda-cambio-modo.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const ARCH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};
const casi = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;
const MXN = v => typeof v === 'number'
  ? '$' + v.toLocaleString('es-MX', { maximumFractionDigits: 0 }) : String(v);

// ── Extracción del código real ─────────────────────────────────────────
const NOMBRES = ['importeEjecutadoPartida', 'importeCatalogoPartida',
                 'desgloseEjecutado', 'diagnosticoCambioModo'];
const src = fs.readFileSync(ARCH, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    if (p.parent.type === 'Program' && NOMBRES.includes(p.node.id?.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(p.node.id.name);
    }
  },
});
const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const diag = app.diagnosticoCambioModo;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH)}`);
console.log(`Extraídos: ${[...vistos].join(', ') || '(ninguno)'}\n`);

if (typeof diag !== 'function') {
  console.log('   ✗ `diagnosticoCambioModo` no existe en este archivo — sin guarda.');
  fallos.push('diagnosticoCambioModo no existe');
}
const llamar = (...args) => (typeof diag === 'function' ? diag(...args) : {});

// ── Catálogos ──────────────────────────────────────────────────────────
// Oaxaca: importe y porcentaje, sin volúmenes. 305 de 335 con avance.
const oaxaca = Array.from({ length: 335 }, (_, i) => ({
  id: `O${i}`, imp: 500000, cant: 0, pu: 0, unidad: '',
  a: i < 305 ? 80 : 0, cantEjec: 0,
}));
// Malecón: volúmenes completos. 12 de 14 con volumen ejecutado.
const malecon = Array.from({ length: 14 }, (_, i) => ({
  id: `M${i}`, imp: 100000, cant: 1000, pu: 100, unidad: 'm3',
  a: i < 12 ? 50 : 0, cantEjec: i < 12 ? 500 : 0,
}));
// Una sola partida coja dentro de un catálogo por lo demás sano.
const casiSano = malecon.map((s, i) => i === 7 ? { ...s, cant: 0, pu: 0 } : s);

// ── 1. Bloqueo duro ────────────────────────────────────────────────────
console.log('1. Guarda 1 — a volumen no se pasa sin `cant` y `pu`');
const dOax = llamar(oaxaca, 'porcentaje', 'volumen');
check(dOax.puedeVolumen === false, `0114 Oaxaca queda bloqueada (dio ${dOax.puedeVolumen})`);
check(dOax.sinVolumen === 335, `cuenta las 335 partidas sin volumen (dio ${dOax.sinVolumen})`);
check(dOax.partidas === 335, `reporta el total de partidas (dio ${dOax.partidas})`);

const dMal = llamar(malecon, 'porcentaje', 'volumen');
check(dMal.puedeVolumen === true, `0112 Malecón sí puede pasar (dio ${dMal.puedeVolumen})`);
check(dMal.sinVolumen === 0, `no le falta ninguna (dio ${dMal.sinVolumen})`);

const dCoja = llamar(casiSano, 'porcentaje', 'volumen');
check(dCoja.puedeVolumen === false,
  `una sola partida coja de 14 bloquea el cambio (dio ${dCoja.puedeVolumen})`);
check(dCoja.sinVolumen === 1, `y la señala (dio ${dCoja.sinVolumen})`);

const dVacio = llamar([], 'porcentaje', 'volumen');
check(dVacio.puedeVolumen === false,
  `una obra sin catálogo leído no pasa a volumen (dio ${dVacio.puedeVolumen})`);

// ── 2. El ejecutado que se le enseña al usuario ────────────────────────
// Oaxaca en porcentaje: 305 × 80% × $500,000 = $122,000,000.
// En volumen no hay `cantEjec`, así que `importeEjecutadoPartida` cae a `a`
// y da lo mismo — por eso el bloqueo no se puede justificar con "el dinero se
// cae": hoy no se cae, pero el capturador sí borra el avance al primer teclazo.
console.log('\n2. Guarda 2 — las cifras que ve el usuario');
check(casi(dOax.ejecutadoAntes, 122000000, 1),
  `Oaxaca hoy ejecuta ${MXN(dOax.ejecutadoAntes)} (esperado $122,000,000)`);

// Malecón al revés: de volumen a porcentaje.
// En volumen: 12 × 500 × $100 = $600,000. En porcentaje: 12 × 50% × $100,000
// = $600,000. Iguales, así que nadie debería alarmarse.
const dVuelta = llamar(malecon, 'volumen', 'porcentaje');
check(casi(dVuelta.ejecutadoAntes, 600000, 1),
  `Malecón en volumen ejecuta ${MXN(dVuelta.ejecutadoAntes)} (esperado $600,000)`);
check(casi(dVuelta.ejecutadoDespues, 600000, 1),
  `y en porcentaje da lo mismo: ${MXN(dVuelta.ejecutadoDespues)}`);
check(casi(dVuelta.delta, 0, 0.01), `la diferencia es cero (dio ${dVuelta.delta})`);
check(dVuelta.cambian === 0,
  `ninguna partida cambia de importe (dio ${dVuelta.cambian})`);

// Ahora una obra donde sí se mueve: volumen capturado por encima del catálogo.
// P1: el dinero no se topa, así que en volumen se cuentan los $150,000 y al
// pasar a porcentaje se pierden — eso es exactamente lo que hay que enseñar.
const excedida = [{ id: 'X', imp: 100000, cant: 1000, pu: 100, a: 100, cantEjec: 1500 }];
const dExc = llamar(excedida, 'volumen', 'porcentaje');
check(casi(dExc.ejecutadoAntes, 150000, 1),
  `con volumen excedido, en volumen ejecuta ${MXN(dExc.ejecutadoAntes)} (esperado $150,000)`);
check(casi(dExc.ejecutadoDespues, 100000, 1),
  `al pasar a porcentaje queda en ${MXN(dExc.ejecutadoDespues)} (esperado $100,000)`);
check(casi(dExc.delta, -50000, 1), `el aviso dice −$50,000 (dio ${MXN(dExc.delta)})`);
check(dExc.cambian === 1, `y señala la partida que se mueve (dio ${dExc.cambian})`);

// ── 3. Cableado (mecanismo, no comportamiento) ─────────────────────────
// Se busca sobre el código con los comentarios en blanco. El comentario que
// documenta el defecto cita el código viejo literalmente, y sin esto la
// prueba se encontraba a sí misma y daba rojo. Blanquear en vez de borrar
// conserva las posiciones.
let codigo = src;
for (const c of (ast.comments || [])) {
  codigo = codigo.slice(0, c.start) + ' '.repeat(c.end - c.start) + codigo.slice(c.end);
}

console.log('\n3. Cableado del selector de modo');
check(!/onClick=\{\(\)=>f\("modoAvance"/.test(codigo),
  'el clic ya no escribe `modoAvance` directo, sin validar');
check(/onClick=\{\(\)=>pedirCambioModo\(opt\.v\)\}/.test(codigo),
  'el clic pasa por `pedirCambioModo`');
check(/fsAudit\(\s*"cambio-modo-avance"/.test(codigo),
  'el cambio se escribe a la bitácora con tipo propio');

// ── Resultado ──────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log('VERDE — el cambio de modo se valida, se explica y se registra.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
