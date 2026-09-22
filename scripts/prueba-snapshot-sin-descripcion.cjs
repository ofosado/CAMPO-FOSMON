#!/usr/bin/env node
// Prueba: los snapshots semanales NO replican la descripción de la partida.
//
// Existe porque la obra 0114 perdió SIETE cierres semanales (semanas 32 a 38
// de 2026) al toparse con el límite de 1 MiB de Firestore, y el 84% del peso
// de cada snapshot era la misma descripción copiada semana tras semana.
//
// No comprueba que el campo esté ausente del código: ejecuta el `.map(...)`
// real de `crearSnapshotAvance` y `crearSnapshotAvanceSub` con una partida de
// la 0114 y mide, con las reglas de tamaño de Firestore, cuánto pesa el
// resultado. Contra el estado anterior estas comprobaciones fallan.
//
// Uso:  node scripts/prueba-snapshot-sin-descripcion.cjs [archivo]
//
// El argumento opcional sirve para correrla contra una copia del archivo con
// el estado anterior y comprobar que la prueba de verdad se pone en rojo.

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

// ── Extracción ──────────────────────────────────────────────────────────────
// Declaraciones de módulo por nombre (para las que se pueden ejecutar solas).
const declaraciones = {};
// El callback de `X.map(...)` dentro de una función con nombre dado.
const mapeos = {};

traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    if (p.scope.block.type !== 'Program' && p.parentPath.parentPath?.scope?.block?.type !== 'Program') return;
    declaraciones[p.node.id.name] = src.slice(p.node.init.start, p.node.init.end);

    // Dentro de esta función de módulo, busca `algo.map(cb)` y guarda el cb.
    const contenedor = p.node.id.name;
    p.traverse({
      CallExpression(c) {
        const callee = c.node.callee;
        if (callee.type !== 'MemberExpression' || callee.property.name !== 'map') return;
        if (callee.object.type !== 'Identifier') return;
        const arg = c.node.arguments[0];
        if (!arg || arg.type !== 'ArrowFunctionExpression') return;
        const llave = `${contenedor}.${callee.object.name}`;
        // Solo el primero que aparezca: es el que arma el snapshot.
        if (!mapeos[llave]) mapeos[llave] = src.slice(arg.start, arg.end);
      },
    });
  },
});

const ejecutar = (nombre, codigo, deps = '') =>
  new Function(`"use strict"; ${deps} const ${nombre} = ${codigo}; return ${nombre};`)();

const tamañoFirestore = ejecutar('tamañoFirestore', declaraciones['tamañoFirestore']);
const LIMITE = Number(declaraciones['LIMITE_DOC_FIRESTORE']);

const mapSubs = mapeos['crearSnapshotAvance.subs']
  ? ejecutar('cb', mapeos['crearSnapshotAvance.subs']) : null;
const mapConceptos = mapeos['crearSnapshotAvanceSub.conceptos']
  ? ejecutar('cb', mapeos['crearSnapshotAvanceSub.conceptos']) : null;

// ── Datos reales de la 0114 ─────────────────────────────────────────────────
// Descripción y clave copiadas del snapshot S30-2026 que hay en producción.
// Es la descripción de longitud mediana de esas 335 partidas (308 caracteres;
// el promedio es 368). No es un ejemplo inventado a modo: si se usa una
// descripción corta, el ahorro se ve menor del que realmente hay.
const DESC = 'SUMINISTRO E INSTALACION DE VARILLA DE TIERRA SOLDADAS CON ' +
  'SOLDADURA HEXOTERMICA PARA REGISTROS DE BAJA TENSION DE REMATE,  ' +
  'INCLUYE:  MANO  DE OBRA,  SOLDADURA  CADWELD  N.  90, CABLE DE COBRE ' +
  'DESNUDO CAL. 2 Y HERRAMIENTAS NECESARIAS PARA SU CORRECTA INSTALACION. ' +
  'P.U.O.T. (PRECIO UNITARIO DE OBRA TERMINADA)';
const SEC = '0219-OAX-ACA1-10.';
const PARTIDAS_0114 = 335;
const SNAPSHOTS_0114 = 8;
// Medido contra producción con las reglas de tamaño de Firestore.
const BYTES_SNAPSHOT_HOY = 140386;   // S30-2026 tal como está guardado
const BYTES_HIST_0114_HOY = 983531;  // el documento completo, 93.8% del límite
const RETENCION_SEMANAS = 52;        // el `slice(-52)` de crearSnapshotAvance

const partida = {
  sec: SEC, sub: DESC, a: 100, imp: 47114.74,
  cant: 994.4961, pu: 1853.42, cantEjec: 616.5876,
};
const concepto = {
  clave: SEC, desc: DESC,
  avance: 100, importe: 47114.74, cantEjec: 616.5876, cantidad: 994.4961, pu: 1853.42,
};

// ── Comprobaciones ──────────────────────────────────────────────────────────
let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

check(typeof tamañoFirestore === 'function', 'se pudo extraer `tamañoFirestore`');
check(LIMITE === 1048576, 'el límite declarado es 1 MiB', `${LIMITE} B`);
check(!!mapSubs, 'se pudo extraer el armado de `subs` de `crearSnapshotAvance`');
check(!!mapConceptos, 'se pudo extraer el armado de `conceptos` de `crearSnapshotAvanceSub`');
if (fallas) process.exit(1);

const guardada = mapSubs(partida, 0, [partida]);
const guardadoConcepto = mapConceptos(concepto, 0, [concepto]);

// 1) La descripción no viaja al snapshot.
const textos = JSON.stringify(guardada) + JSON.stringify(guardadoConcepto);
check(!textos.includes('SUMINISTRO'),
  'la descripción no queda en el snapshot',
  Object.keys(guardada).join(', '));

// 2) Pero la llave sí: sin ella el historial no se puede cruzar con el catálogo.
check(guardada.sec === SEC, 'la partida conserva su llave `sec`');
check(guardadoConcepto.clave === SEC, 'el concepto conserva su llave `clave`');

// 3) Y los números tampoco se pierden: la serie sigue siendo recalculable.
check(guardada.a === 100 && guardada.imp === 47114.74, 'conserva avance e importe');
check(guardada.cant === 994.4961 && guardada.pu === 1853.42 && guardada.cantEjec === 616.5876,
  'conserva cantidad, precio unitario y cantidad ejecutada');
check(guardadoConcepto.importe === 47114.74 && guardadoConcepto.cantEjec === 616.5876,
  'el concepto del sub conserva sus números');

// 4) El peso baja. Esta es la comprobación que importa: las anteriores
//    describen la forma, esta el efecto. Se mide con las reglas de tamaño de
//    Firestore, no con bytes de JSON, que dan un número distinto.
const bytesPartida = tamañoFirestore(guardada);
const bytesConDesc = tamañoFirestore({ ...guardada, sub: DESC });
check(bytesPartida < bytesConDesc * 0.25,
  'la partida pesa menos de un cuarto de lo que pesaba',
  `${bytesConDesc} B → ${bytesPartida} B`);

const snapshotNuevo = bytesPartida * PARTIDAS_0114;
check(snapshotNuevo < BYTES_SNAPSHOT_HOY * 0.25,
  'el snapshot semanal de la 0114 baja a menos de un cuarto',
  `${Math.round(BYTES_SNAPSHOT_HOY / 1024)} KB → ${Math.round(snapshotNuevo / 1024)} KB`);

// 5) Cuántos cierres caben. Con descripción la 0114 reventó en el noveno.
const cabenAntes = Math.floor(LIMITE / BYTES_SNAPSHOT_HOY);
const cabenDespues = Math.floor(LIMITE / snapshotNuevo);
check(cabenAntes <= SNAPSHOTS_0114,
  'con descripción se llenaba con los 8 snapshots que ya tiene',
  `cabían ${cabenAntes}`);
check(cabenDespues >= cabenAntes * 4,
  'sin descripción caben al menos cuatro veces más semanas',
  `${cabenAntes} → ${cabenDespues} semanas`);

// 6) Lo que este arreglo NO resuelve. El código retiene 52 semanas; si en la
//    obra más pesada no caben 52, el documento se vuelve a llenar — más
//    tarde, pero se llena. Se imprime siempre, en verde o en rojo, para que
//    nadie cierre el tema creyendo que quedó resuelto de raíz.
const pct = n => (n / LIMITE * 100).toFixed(1) + '%';
console.log(`\n       0114 · 335 partidas · ${SNAPSHOTS_0114} snapshots · ` +
  `hoy ${pct(BYTES_HIST_0114_HOY)} del límite  →  ` +
  `${pct(snapshotNuevo * SNAPSHOTS_0114)} en el formato nuevo`);
if (cabenDespues < RETENCION_SEMANAS) {
  console.log(`\n       AVISO · el código retiene ${RETENCION_SEMANAS} semanas pero en la 0114 ` +
    `solo caben ${cabenDespues}.\n       Quitar la descripción da aire para ` +
    `${cabenDespues - SNAPSHOTS_0114} cierres más, no resuelve el fondo.\n` +
    `       El fondo es un documento por semana en subcolección (PENDIENTES).`);
}

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
