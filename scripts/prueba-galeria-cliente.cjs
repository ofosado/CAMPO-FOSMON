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
// No comprueba que el código diga `.flat()`. Ejecuta las dos expresiones
// reales extraídas de `FotosCliente` —la que arma la lista y la que resuelve
// la URL de cada foto— y afirma dos números que son lo que el cliente ve:
// cuántas fotos ANUNCIA la insignia y cuántas imágenes PINTA la rejilla. El
// defecto de fondo era que esos dos números no coincidían.
//
// Uso:  node scripts/prueba-galeria-cliente.cjs [archivo]
//
// El argumento opcional sirve para correrla contra una copia del archivo con
// el estado anterior y comprobar que de verdad se pone en rojo.

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
// Las dos expresiones viven dentro de `FotosCliente`, no en el módulo, así
// que se buscan por su función contenedora.
let conFotosSrc = null;   // arma la lista de partidas con sus fotos
let urlSrc = null;        // resuelve la URL de UNA foto al pintarla

traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    // `url` se declara dentro del `.map` de la rejilla, así que el padre
    // inmediato es una flecha anónima: hay que subir hasta la función con
    // nombre para saber en qué componente estamos.
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (fn?.node?.id?.name !== 'FotosCliente') return;
    const código = src.slice(p.node.init.start, p.node.init.end);
    if (p.node.id.name === 'conFotos') conFotosSrc = código;
    if (p.node.id.name === 'url' && !urlSrc) urlSrc = código;
  },
});

if (!conFotosSrc || !urlSrc) {
  console.error('No se encontró `conFotos` y/o `url` dentro de `FotosCliente` en ' + archivo);
  console.error('Si la pantalla se reescribió (el #30 la reescribe entera), esta prueba');
  console.error('hay que rehacerla contra la pantalla nueva, no borrarla.');
  process.exit(1);
}

const galeria = new Function('subs', `"use strict"; return ${conFotosSrc};`);
const urlDe = new Function('foto', `"use strict"; return ${urlSrc};`);

// ── Lo que el cliente ve de una partida ─────────────────────────────────────
// `anuncia` es el texto exacto de la insignia; `pinta` es cuántas imágenes
// sobreviven al `if(!url) return null` de la rejilla.
const loQueSeVe = (subs) => galeria(subs).map(s => ({
  sec: s.sec,
  anuncia: `${s._fotos.length} foto${s._fotos.length > 1 ? 's' : ''}`,
  pinta: s._fotos.filter(f => urlDe(f)).length,
}));

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
];
const verVacías = loQueSeVe(vacías);
check(verVacías.length === 0,
  'ninguna de las tres aparece con encabezado',
  verVacías.length ? `aparecen: ${verVacías.map(v => `${v.sec} anuncia ${v.anuncia} y pinta ${v.pinta}`).join('; ')}` : 'ninguna');

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
