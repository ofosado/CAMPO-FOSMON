#!/usr/bin/env node
// Prueba: la galería de evidencia del CLIENTE pinta las fotos que anuncia.
//
// Existe porque durante meses no pintó ninguna. `FotosCliente` aplanaba mal
// el mapa de fotos —`Object.values` sin `.flat()`— y las consecuencias
// encadenaban de la peor manera posible: la insignia contaba GRUPOS, así que
// una partida con 43 fotos anunciaba "1 foto", y al pintar cada elemento era
// un arreglo, que no tiene `.url` ni `.src`, así que el `if(!url) return null`
// se las saltaba todas. Encabezado con insignia que miente y debajo una
// rejilla vacía. Las 475 fotos de producción eran invisibles justo en la
// pantalla que se le enseña al cliente (PENDIENTES #32).
//
// REHECHA (#30, la mitad de lectura): la pantalla se reescribió entera para
// consultar la evidencia por semana y por partida. La versión anterior de
// este banco extraía `conFotos` y la expresión `url` de la rejilla, y las dos
// desaparecieron; cuando eso pasó, el banco salió en ROJO diciendo
// exactamente eso —«hay que rehacerla contra la pantalla nueva, no borrarla»—
// y es lo que se hizo. Lo que afirma no cambió.
//
// La pantalla nueva resuelve la URL al aplanar, así que anunciar y pintar
// coinciden POR CONSTRUCCIÓN. Esa es justo la razón de seguir comprobándolo:
// lo que se cumple por construcción se rompe callado el día que alguien
// vuelve a meter una foto a la lista sin url.
//
// No comprueba que el código diga `.flat()`. Ejecuta los trozos reales
// extraídos de `FotosCliente` y afirma dos números que son lo que el cliente
// ve: cuántas fotos ANUNCIA la insignia de cada partida y cuántas imágenes
// PINTA su rejilla. El defecto de fondo era que esos dos números no
// coincidían.
//
// Uso:  node scripts/prueba-galeria-cliente.cjs [archivo]
//
// El argumento opcional sirve para correrla contra una copia del archivo con
// el estado anterior y comprobar que de verdad se pone en rojo. Comprobado
// sobre la pantalla nueva; las dos salen en ROJO (1), no en NO ARRANCÓ (2):
//
//   · el aplanado pierde el `.flat()` otra vez (el defecto del #32) → 7 rojas
//   · la lista a pintar admite entradas sin url                     → 3 rojas

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

// ── Extracción ──────────────────────────────────────────────────────────────
// Todo lo que hace falta vive dentro de `FotosCliente`, no en el módulo, más
// las cuatro piezas de módulo de las que depende el aplanado.
const modulo = {}, dentro = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    const nombre = p.node.id.name;
    const código = src.slice(p.node.init.start, p.node.init.end);
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn) { if (!(nombre in modulo)) modulo[nombre] = código; return; }
    if (fn.node.id.name !== 'FotosCliente') return;
    if (!(nombre in dentro)) dentro[nombre] = código;
  },
});

const falta = [];
const PIEZAS_MODULO = ['semanaISO', 'snapshotId', 'fechaLocalDeISO', 'semanaDeFoto'];
const PIEZAS_PANTALLA = ['todas', 'partidas', 'porPartida'];
for (const n of PIEZAS_MODULO) if (!(n in modulo)) falta.push(n);
for (const n of PIEZAS_PANTALLA) if (!(n in dentro)) falta.push(`FotosCliente.${n}`);

if (falta.length) {
  console.error('No se encontraron estas piezas en ' + archivo + ':');
  for (const f of falta) console.error('  · ' + f);
  console.error('\nSi la pantalla se reescribió otra vez, esta prueba hay que rehacerla');
  console.error('contra la pantalla nueva, no borrarla: anunciar y pintar siguen teniendo');
  console.error('que ser el mismo número.');
  process.exit(1);
}

const cuerpoModulo = PIEZAS_MODULO.map(n => `const ${n} = ${modulo[n]};`).join('\n');
const desenvolverMemo = (código) => {
  const m = /^useMemo\s*\(([\s\S]*),\s*\[[^\]]*\]\s*\)$/.exec(código.trim());
  return m ? m[1].trim() : código;
};

// `galeria(subs)` devuelve lo que la pantalla tiene en la mano para pintar.
const galeria = new Function('subs', `"use strict";
${cuerpoModulo}
const useMemo = (fn) => fn();
const todas = (${desenvolverMemo(dentro.todas)})();
const partidas = (${desenvolverMemo(dentro.partidas)})();
const porPartida = ${dentro.porPartida};
return { todas, partidas, porPartida };`);

// ── Lo que el cliente ve de una partida ─────────────────────────────────────
// `anuncia` es el texto exacto de la insignia; `pinta` es cuántas imágenes
// sobreviven hasta la rejilla, que sólo pinta las que traen url.
const loQueSeVe = (subs) => {
  const { todas, porPartida } = galeria(subs);
  return porPartida(todas).map(([, g]) => ({
    sec: g.sec,
    anuncia: `${g.fotos.length} foto${g.fotos.length > 1 ? 's' : ''}`,
    pinta: g.fotos.filter(f => f.url).length,
  }));
};

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Datos con la forma que tienen en producción ─────────────────────────────
const foto = (n) => ({
  id: `f${n}`,
  url: `https://firebasestorage.googleapis.com/v0/b/campo-fosmon.appspot.com/o/obras%2F0112%2Ffotos%2Favance_p1_${n}.jpg?alt=media`,
  fecha: '2026-07-24',
});
const muchas = (n) => Array.from({ length: n }, (_, i) => foto(i + 1));

console.log('1. La partida más cargada de producción: 0112 SIOP-JS-MRN-001, 43 fotos');
// El mapa real es `{ idPartida: [foto, …] }`. Es la forma que rompía todo.
const p43 = [{ sec: '1.1', sub: 'Demolición', id: 'p1', fotos: { 'p1': muchas(43) } }];
const v43 = loQueSeVe(p43)[0];
check(v43?.anuncia === '43 fotos', 'la insignia anuncia las 43', v43?.anuncia);
check(v43?.pinta === 43, 'y la rejilla pinta las 43', `pinta ${v43?.pinta}`);

console.log('\n2. Anunciar y pintar son el mismo número, siempre');
// Es la comprobación de fondo: el defecto no era pintar poco, era prometer
// una cifra y dibujar otra. Con varias partidas y varios tamaños a la vez.
const varias = [
  { sec: '1.1', sub: 'A', id: 'a', fotos: { a: muchas(8) } },
  { sec: '1.2', sub: 'B', id: 'b', fotos: { b: muchas(1) } },
  { sec: '1.3', sub: 'C', id: 'c', fotos: { c: muchas(2), 'c-bis': muchas(3) } },
];
for (const v of loQueSeVe(varias))
  check(v.anuncia === `${v.pinta} foto${v.pinta > 1 ? 's' : ''}`,
    `${v.sec}: anuncia lo que pinta`, `anuncia "${v.anuncia}", pinta ${v.pinta}`);

console.log('\n3. Una partida cuyo mapa reparte las fotos en varias llaves las suma');
// En la 0114 pasa: el mapa lleva más de una llave por partida. Contando
// grupos salían "2 fotos" donde hay cinco.
const vC = loQueSeVe(varias).find(v => v.sec === '1.3');
check(vC?.pinta === 5, 'las 2 + 3 de la partida C son cinco fotos', `pinta ${vC?.pinta}`);

console.log('\n4. Lo que no es una foto no entra en la galería');
// Diez partidas de la 0114 guardan un mapa con arreglos vacíos: son bytes
// que no representan nada. Antes contaban como "1 foto" y pintaban cero —
// el encabezado aparecía sobre una rejilla en blanco.
const vacías = [
  { sec: '2.1', sub: 'Mapa vacío', id: 'v1', fotos: { v1: [] } },
  { sec: '2.2', sub: 'Sin campo', id: 'v2' },
  { sec: '2.3', sub: 'Mapa nulo', id: 'v3', fotos: null },
  { sec: '2.4', sub: 'Objeto sin url', id: 'v4', fotos: { v4: [{ id: 'z', fecha: '2026-07-24' }] } },
];
const verVacías = loQueSeVe(vacías);
check(verVacías.length === 0,
  'ninguna de las cuatro aparece con encabezado',
  verVacías.length ? `aparecen: ${verVacías.map(v => `${v.sec} anuncia ${v.anuncia} y pinta ${v.pinta}`).join('; ')}` : 'ninguna');
// La lista que la pantalla pinta no lleva ni una entrada sin url: es lo que
// hace que anunciar y pintar coincidan por construcción.
check(galeria([...varias, ...vacías]).todas.every(f => f.url),
  'ninguna entrada de la lista a pintar llega sin url', 'todas con url');
// Y una partida sin fotos tampoco aparece en el eje «por partida».
check(galeria(vacías).partidas.length === 0,
  'ni aparece en la lista de partidas con evidencia',
  `${galeria(vacías).partidas.length} partida(s)`);

console.log('\n5. Los esquemas viejos siguen viéndose');
// El esquema es mixto: hay partidas con arreglo directo y fotos guardadas
// como cadena suelta. Arreglar el mapa no puede dejar ciegas a esas.
const viejas = [
  { sec: '3.1', sub: 'Arreglo directo', id: 'd1', fotos: muchas(4) },
  { sec: '3.2', sub: 'Cadenas sueltas', id: 'd2', fotos: { d2: ['https://ejemplo/a.jpg', 'https://ejemplo/b.jpg'] } },
];
const verViejas = loQueSeVe(viejas);
check(verViejas[0]?.pinta === 4, 'el arreglo directo pinta sus 4', `pinta ${verViejas[0]?.pinta}`);
check(verViejas[1]?.pinta === 2, 'las fotos guardadas como cadena pintan', `pinta ${verViejas[1]?.pinta}`);

console.log('\n6. Las cifras de producción, tal como se midieron para el #32');
// Los tres totales del informe del #32. Antes del arreglo la galería
// anunciaba 12, 88 y 22 partidas y pintaba cero en las tres obras.
const produccion = [
  { obra: '0112', partidas: 12, fotos: 255 },
  { obra: '0114', partidas: 78, fotos: 188 },
  { obra: '0126', partidas: 21, fotos: 32 },
];
for (const { obra, partidas, fotos } of produccion) {
  // Reparto cualquiera que sume: lo que se afirma es el total, no el reparto.
  const base = Math.floor(fotos / partidas), resto = fotos % partidas;
  const subs = Array.from({ length: partidas }, (_, i) => ({
    sec: `${i}`, sub: `P${i}`, id: `x${i}`,
    fotos: { [`x${i}`]: muchas(base + (i < resto ? 1 : 0)) },
  }));
  const visto = loQueSeVe(subs);
  const pintadas = visto.reduce((a, v) => a + v.pinta, 0);
  check(pintadas === fotos && visto.length === partidas,
    `${obra}: ${fotos} fotos repartidas en ${partidas} partidas llegan enteras a la pantalla`,
    `${visto.length} partida(s), ${pintadas} foto(s) pintada(s)`);
}

console.log(fallas === 0
  ? '\nLa galería del cliente pinta lo que anuncia.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
