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

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

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

// ── 3. El catálogo del SUBCONTRATO ─────────────────────────────────────
//
// El modo de captura existe en dos sitios: la obra y cada subcontrato. El
// mismo diagnóstico tiene que servir a los dos, y los dos catálogos no se
// escriben igual: la partida de obra trae `cant` e `imp`, el concepto de
// subcontrato trae `cantidad` e `importe` —el importador traduce uno en otro
// al guardar—.
//
// Lo que se mide aquí es el BLOQUEO FALSO, que es el daño de leer una sola
// forma. Un subcontrato con sus volúmenes completos quedaría bloqueado para
// pasar a volumen, para siempre, y el aviso diría «N de N conceptos no tienen
// cantidad ni precio unitario» sobre conceptos que la tienen. Un bloqueo que
// miente enseña a no creerle al que sí es verdadero.
console.log('\n3. El mismo diagnóstico, sobre conceptos de subcontrato');
// Un subcontrato sano, con la forma que escribe `agregarConcepto`.
const conceptosSanos = Array.from({ length: 9 }, (_, i) => ({
  id: i, clave: `C${i}`, unidad: 'm2', cantidad: 400, pu: 250,
  importe: 100000, avance: i < 6 ? 50 : 0, cantEjec: i < 6 ? 200 : 0,
}));
const dSub = llamar(conceptosSanos, 'porcentaje', 'volumen');
check(dSub.puedeVolumen === true,
  `un subcontrato con sus volúmenes completos SÍ puede pasar a volumen (dio ${dSub.puedeVolumen})`);
check(dSub.sinVolumen === 0,
  `y no se le inventan conceptos sin volumen (dio ${dSub.sinVolumen} de ${dSub.partidas})`);

// Y el bloqueo verdadero sigue bloqueando: un subcontrato importado sin
// cantidades es exactamente el caso que la guarda existe para atajar.
const conceptosSinVol = conceptosSanos.map(c => ({ ...c, cantidad: 0, pu: 0, cantEjec: 0 }));
const dSubCojo = llamar(conceptosSinVol, 'porcentaje', 'volumen');
check(dSubCojo.puedeVolumen === false,
  `un subcontrato sin cantidades sigue bloqueado (dio ${dSubCojo.puedeVolumen})`);
check(dSubCojo.sinVolumen === 9, `y los cuenta los 9 (dio ${dSubCojo.sinVolumen})`);

// Las cifras que verá el proveedor en la confirmación. 6 conceptos al 50% de
// $100,000 son $300,000; en volumen, 6 × 200 × $250 son los mismos $300,000.
check(casi(dSub.ejecutadoAntes, 300000, 1),
  `el subcontrato hoy ejecuta ${MXN(dSub.ejecutadoAntes)} (esperado $300,000)`);
check(casi(dSub.ejecutadoDespues, 300000, 1),
  `y después del cambio ${MXN(dSub.ejecutadoDespues)}`);

// Un concepto con volumen capturado por encima del catálogo: al volver a
// porcentaje el dinero se cae, y eso es justo lo que hay que enseñar antes.
const conceptoExcedido = [{ id: 'X', cantidad: 100, pu: 1000, importe: 100000,
                            avance: 100, cantEjec: 160 }];
const dSubExc = llamar(conceptoExcedido, 'volumen', 'porcentaje');
check(casi(dSubExc.ejecutadoAntes, 160000, 1),
  `con volumen excedido ejecuta ${MXN(dSubExc.ejecutadoAntes)} (esperado $160,000)`);
check(casi(dSubExc.delta, -60000, 1),
  `y el aviso del subcontrato dice −$60,000 (dio ${MXN(dSubExc.delta)})`);

// ── 4. Que ningún interruptor de modo se salte el diagnóstico ──────────
//
// Esto es mecanismo, no comportamiento, y se dice: comprueba el cableado, no
// la guarda. Pero es un barrido y no una lista, y ésa es la diferencia que
// importa. La versión anterior tecleaba la forma exacta del clic de la obra
// —`onClick={()=>pedirCambioModo(opt.v)}`— y por eso salía verde con el
// interruptor del subcontrato, en la pantalla de al lado, escribiendo el modo
// de un clic. Una regla que sólo mira donde ya se miró no es una guarda.
//
// Los interruptores se BUSCAN: un arreglo literal que ofrezca a la vez
// "volumen" y "porcentaje" y que se recorra con `.map` para pintar algo. Ésa
// es la forma de un selector de modo, la tengan los dos o la tengan diez.
const interruptores = [];
traverse(ast, {
  CallExpression(p) {
    const cal = p.node.callee;
    if (cal.type !== 'MemberExpression') return;
    if (cal.property?.name !== 'map' || cal.object?.type !== 'ArrayExpression') return;
    const lista = src.slice(cal.object.start, cal.object.end);
    if (!/["']volumen["']/.test(lista) || !/["']porcentaje["']/.test(lista)) return;
    interruptores.push({
      linea: src.slice(0, p.node.start).split('\n').length,
      fuente: src.slice(p.node.start, p.node.end),
    });
  },
});

console.log(`\n4. Ningún interruptor de modo escribe sin diagnóstico`);
console.log(`   (interruptores de modo encontrados: ${interruptores.length})`);
// Cero interruptores sale verde sin haber mirado nada: es el P4 por el lado
// que no avisa. Si el JSX cambió de forma, lo que hay que decir es que no se
// midió — no dar por buena una pantalla que no se encontró.
if (interruptores.length === 0) {
  noArranco(['ningún selector de modo con "volumen" y "porcentaje" en src/App.jsx'], ARCH);
}

// Quién tiene el diagnóstico adentro: se resuelve por el cuerpo de la función,
// no por su nombre. `pedirCambioModo` y `pedirCambioModoSub` son dos nombres
// del mismo deber.
const conDiagnostico = new Set();
traverse(ast, {
  Function(p) {
    const nombre = p.node.id?.name
      || (p.parent.type === 'VariableDeclarator' ? p.parent.id?.name : null);
    if (!nombre) return;
    if (/diagnosticoCambioModo\s*\(/.test(src.slice(p.node.start, p.node.end))) {
      conDiagnostico.add(nombre);
    }
  },
});

for (const sw of interruptores) {
  // Sin comentarios: el que documenta el defecto cita el código viejo, y sin
  // esto la prueba se encuentra a sí misma y da rojo.
  const limpio = sw.fuente.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ');

  const manejador = /onClick=\{([^]*?)\}\s*\n?\s*style=/.exec(limpio)
                 || /onClick=\{(\(\)\s*=>\s*[A-Za-z_$][\w$]*\([^)]*\))\}/.exec(limpio);
  const cuerpo = manejador ? manejador[1] : '';
  check(!/\{\s*modoAvance\s*:/.test(cuerpo) && !/["']modoAvance["']\s*,/.test(cuerpo),
    `App.jsx:${sw.linea} no escribe el modo desde el clic` +
    (cuerpo ? '' : '  ·  no se halló su `onClick`'));
  const llamada = /([A-Za-z_$][\w$]*)\s*\(/.exec(cuerpo);
  const destino = llamada ? llamada[1] : null;
  check(destino && conDiagnostico.has(destino),
    `App.jsx:${sw.linea} el clic llega al diagnóstico` +
    (destino ? `  ·  via \`${destino}\`` : '  ·  el clic no llama a nada'));
}

// Y el asiento propio en la bitácora, uno por cada interruptor: sin él, la
// cifra se mueve mañana sin que nadie pueda decir por qué.
const asientos = (src.match(/fsAudit\(\s*"cambio-modo-avance"/g) || []).length;
check(asientos >= interruptores.length,
  `cada cambio de modo deja su asiento propio en la bitácora ` +
  `(${asientos} asiento(s) para ${interruptores.length} interruptor(es))`);

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
