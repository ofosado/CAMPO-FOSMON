#!/usr/bin/env node
// EL CANDADO QUE IMPIDE RESTAURAR ENCIMA DE PRODUCCIÓN
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// `probar-la-restauracion.cjs` importa un respaldo a una base de Firestore.
// Importar apunta a una base, y un destino mal escrito mete los 7,748
// documentos del respaldo ENCIMA DE PRODUCCIÓN. No es hipotético: el
// 2026-10-09 se escribieron 270 documentos en producción por olvidar una
// variable de entorno, y esto es la misma clase de error con un cero más.
//
// El guion prueba su propio candado antes de cada corrida, pero eso lo
// comprueba sólo quien lo corre. Este banco lo pone en `npm test`, que es
// donde se mira sin que nadie se acuerde.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `destinoAceptable` se EXTRAE del guion y SE
// EJECUTA contra los nombres con los que alguien podría tumbar producción —y
// contra los que sí son válidos, porque un candado que no deja pasar nada
// tampoco sirve—.
//
// Uso:
//   node scripts/prueba-el-candado-de-la-restauracion.cjs
//   node scripts/prueba-el-candado-de-la-restauracion.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const GUION = process.env.ARCH_GUION || path.join(raiz, 'scripts/probar-la-restauracion.cjs');
noArranco.vigilarExcepciones(path.relative(raiz, GUION));

const CP = require('./contraprueba.cjs');

// ── POR QUÉ SON CUATRO Y NO SEIS ────────────────────────────────────────────
//
// El candado tiene capas REDUNDANTES a propósito, y al medirlo salió algo que
// conviene tener escrito: **la única capa portante es la forma**
// (`^restauracion-…`). Quitar la lista de nombres prohibidos, o la regla de
// los paréntesis, o el rechazo del vacío, NO deja pasar nada — la forma los
// para a todos igual.
//
// Las mutaciones que quitaban sólo esas capas salían en VERDE, y eso no es un
// hueco del banco: es el diseño funcionando. Dejarlas puestas sería peor que
// quitarlas, porque una contraprueba que no muerde enseña a no creerle a las
// que sí. Y quitarlas sin decir por qué sería bajar la vara en silencio.
//
// Las capas de más siguen en el guion, y no sobran: el día que alguien afloje
// la forma —para permitir otro prefijo, pongamos— la lista de prohibidos y
// los paréntesis son lo que queda entre ese cambio y producción. Lo que este
// comentario fija es que HOY no se puede comprobar su valor por separado.
const MUTANTES = [
  { nombre: 'el candado se vacía: cualquier nombre pasa',
    cambios: [
      [`  if (PROHIBIDAS.includes(n.toLowerCase())) {`, `  if (false) {`],
      [`  if (/[()]/.test(n)) throw new Candado(\`«\${n}» lleva paréntesis: eso sólo lo tiene (default)\`);`,
       `  if (false) throw new Candado('');`],
      [`  if (!FORMA.test(n)) {`, `  if (false) {`],
    ] },
  { nombre: 'se va la forma `restauracion-…`, que es la capa portante',
    de: `  if (!FORMA.test(n)) {`,
    a:  `  if (false) {` },
  { nombre: 'la forma se afloja a «cualquier cosa con letras», que es como se aflojan de verdad',
    de: `const FORMA = /^restauracion-[a-z0-9][a-z0-9-]{2,38}$/;`,
    a:  `const FORMA = /^[a-z0-9()._ -]{1,60}$/i;` },
  { nombre: 'el nombre deja de recortarse: « (default) » con espacios se cuela',
    de: `  const n = String(nombre == null ? '' : nombre).trim();`,
    a:  `  const n = String(nombre == null ? '' : nombre);` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(GUION, 'utf8'),
    { archivo: GUION, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(GUION, 'utf8'),
    archivo: GUION, extension: '.cjs',
    comoCorrer: (ruta) => ({ args: [], env: { ARCH_GUION: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── LA PIEZA REAL ───────────────────────────────────────────────────────────
// Se extrae por AST y se ejecuta. Copiar la función aquí sería comprobarla
// contra sí misma.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const src = fs.readFileSync(GUION, 'utf8');
const trozos = {};
traverse(parse(src, { sourceType: 'script' }), {
  FunctionDeclaration(p) {
    if (p.parent.type === 'Program' && p.node.id)
      trozos[p.node.id.name] = src.slice(p.node.start, p.node.end);
  },
  ClassDeclaration(p) {
    if (p.parent.type === 'Program' && p.node.id)
      trozos[p.node.id.name] = src.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (n && p.node.init && p.scope.block.type === 'Program')
      trozos[n] = `const ${n} = ${src.slice(p.node.init.start, p.node.init.end)};`;
  },
});

const NECESITA = ['Candado', 'PROHIBIDAS', 'FORMA', 'destinoAceptable'];
const sin = NECESITA.filter(n => !trozos[n]);
if (sin.length) noArranco([`no se hallaron en el guion: ${sin.join(', ')}`],
  path.relative(raiz, GUION));

let destinoAceptable, Candado;
try {
  ({ destinoAceptable, Candado } = new Function(`"use strict";
    ${trozos['Candado']}
    ${trozos['PROHIBIDAS']}
    ${trozos['FORMA']}
    ${trozos['destinoAceptable']}
    return { destinoAceptable, Candado };`)());
} catch (e) {
  noArranco([`el candado no se pudo montar: ${e.message}`], path.relative(raiz, GUION));
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

const pasa = (n) => { try { destinoAceptable(n); return true; } catch { return false; } };

// Cada uno es una forma real de escribir mal el destino: el nombre de la base
// de producción tal cual, sus variantes de capitalización y espaciado, los
// vacíos que deja una variable sin definir, y los nombres de producción que
// alguien podría teclear de memoria.
const PELIGROSOS = [
  ['(default)',                'la base de producción, tal cual'],
  ['(DEFAULT)',                'la misma en mayúsculas'],
  [' (default) ',              'la misma con espacios alrededor'],
  ['default',                  'sin paréntesis, que es como la escribe gcloud a veces'],
  ['DEFAULT',                  'y en mayúsculas'],
  ['',                         'la cadena vacía de una variable sin definir'],
  ['   ',                      'sólo espacios'],
  [null,                       'null, de una bandera que no se pasó'],
  [undefined,                  'undefined, de leer una clave que no está'],
  ['campo-fosmon',             'el nombre del PROYECTO, confundido con el de la base'],
  ['produccion',               'tecleado de memoria'],
  ['prod',                     'su abreviatura'],
  ['restauracion',             'el prefijo solo, sin nombre'],
  ['restauracion_prueba',      'con guion bajo: no es la forma que se declaró'],
  ['Restauracion-Prueba',      'con mayúsculas'],
  ['../(default)',             'un intento de salirse por la ruta'],
  ['(default)/../restauracion-x', 'el mismo, al revés'],
];

const SANOS = [
  'restauracion-prueba',
  'restauracion-2026-11-22',
  'restauracion-del-domingo',
];

(async () => {
  console.log('\n── EL CANDADO DE LA RESTAURACIÓN ──\n');

  console.log('§1 · lo que NO puede pasar');
  const colados = [];
  for (const [n, porque] of PELIGROSOS) {
    const paso = pasa(n);
    if (paso) colados.push(n);
    check(!paso, `rechaza «${String(n)}» — ${porque}`, paso ? 'SE COLÓ' : '');
  }

  console.log('\n§2 · y lo que sí, porque un candado que no abre tampoco sirve');
  for (const n of SANOS) check(pasa(n), `acepta «${n}»`, pasa(n) ? '' : 'LO RECHAZÓ');

  console.log('\n§3 · lo que devuelve cuando acepta');
  // Un reventón aquí tiene que salir ROJO y no matar el banco: si el recorte
  // desaparece, `destinoAceptable` LANZA con este nombre, y un banco que se
  // cae en ese punto sale con 2 —«no se pudo comprobar»— cuando lo que pasó
  // es que la conducta se rompió. Son dos veredictos distintos.
  const devuelve = (n) => { try { return destinoAceptable(n); } catch (e) { return `(lanzó: ${e.message.slice(0, 60)})`; } };
  check(devuelve('  restauracion-prueba  ') === 'restauracion-prueba',
    'recorta los espacios y devuelve el nombre limpio, no el que llegó',
    `«${devuelve('  restauracion-prueba  ')}»`);
  let tipoBien = false;
  try { destinoAceptable('(default)'); } catch (e) { tipoBien = e instanceof Candado; }
  check(tipoBien,
    'y cuando se niega lanza un `Candado`, no un error cualquiera que alguien pueda atrapar por accidente',
    tipoBien ? 'Candado' : 'otro tipo de error');

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? `los ${PELIGROSOS.length} nombres con los que se tumbaría producción se paran\n` +
      'antes de que el guion abra una sola conexión.'
    : 'un destino mal escrito mete 7,748 documentos encima de producción.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
