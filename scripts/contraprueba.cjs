#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL CORREDOR DE CONTRAPRUEBAS, UNO PARA TODO EL REPOSITORIO
// ════════════════════════════════════════════════════════════════════════════
//
// Esto NO es un banco: es la herramienta con la que un banco se pone a prueba
// a sí mismo. Mete un defecto en el fuente que el banco examina y exige que el
// banco lo vea. Una aserción que nadie puede hacer caer no afirma nada, y un
// banco de cincuenta aserciones puede estar protegiendo cero conductas.
//
// Salió aquí porque estaba escrito CINCUENTA Y UNA VECES. Al medirlo había
// ONCE formas distintas del mismo bucle y **22 bancos sin guarda alguna**: cada
// quien reimplementó el corredor, y cada copia se quedó con el descuido del día
// en que se escribió. El #124 señaló la guarda más débil —`mutado === src`, que
// sólo comprueba que ALGO cambió—, pero el hueco de fondo era tenerlo copiado.
//
// ── LO QUE ESTE CORREDOR SE NIEGA A DEJAR PASAR ────────────────────────────
//
// Las cuatro maneras de que una contraprueba salga verde sin proteger nada.
// Desde `mutado !== src` las cuatro se ven idénticas, y de ahí el cambio:
//
//   1. PARCIAL  — la mutación trae varios cambios y alguno no casa. El banco
//                 enrojece por el trozo que sí entró y el que no entró queda
//                 sin vigilar para siempre. Es el caso que nombra el #124.
//   2. AMBIGUA  — el anclaje aparece más veces de las declaradas. `replace`
//                 con una cadena toca SÓLO la primera, así que quien creía
//                 cubrir un patrón cubre un renglón. Por eso el número de
//                 apariciones se DECLARA: `veces: 3` dice «sé que son tres y
//                 las tres se van», y el día que sean cuatro, para.
//   3. RANCIA   — el anclaje ya no existe porque el fuente se movió. La
//                 mutación dejó de aplicar y nadie se enteró, porque ninguna
//                 contraprueba se vuelve a correr sola (ver abajo).
//   4. MUDA     — el mutante revienta el banco en vez de romper su semántica.
//                 Salida 2, no 1: no demuestra que la aserción muerda, sólo
//                 que el andamio se cae. Nunca cuenta como éxito.
//
// ── POR QUÉ LA REVISIÓN DE ANCLAJES CORRE SIEMPRE ──────────────────────────
//
// Medido, no supuesto: `scripts/pruebas.cjs` lanza cada banco **sin
// argumentos**, y 46 de 51 contrapruebas sólo arrancan con `--contraprueba`.
// O sea que `npm test` no las corre NUNCA. Son de un solo uso: valen el día
// que se escriben y nada las vuelve a mirar.
//
// Correrlas todas en la suite no cabe —medido: entre 3 s y 74 s por banco—,
// así que el trabajo se parte en dos:
//
//   · `revisarAnclajes` es estático y gratis, y se llama SIEMPRE, en el
//     arranque normal del banco. Eso atrapa la RANCIA en `npm test`, que es
//     la única de las cuatro que llega sola con el tiempo.
//   · `correr` lanza los procesos hijos y sigue siendo a pedido.
//
// Lo barato de continuo y lo caro a propósito. Un anclaje que se queda viejo
// deja de ser un hallazgo de dentro de meses y pasa a ser un rojo de hoy.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');

const NO_ARRANCO = 2;

// ── Normalizar lo que el banco declara ─────────────────────────────────────
// Se aceptan dos formas, porque una mutación de un solo cambio no tiene por
// qué pagar la ceremonia de la lista:
//
//   { titulo, de, a, veces }           un cambio
//   { titulo, cambios: [[de,a], …] }   varios, y cada uno se revisa aparte
//
// `veces` es el número de apariciones del anclaje que el autor AFIRMA que hay,
// y por omisión es 1. No es un tope ni un mínimo: es una igualdad. Un anclaje
// que aparece dos veces cuando se declaró una es una mutación ambigua, y da
// igual que `replace` haya cambiado algo: lo que cambió no es lo que se dijo.
function normalizar(m, i) {
  const titulo = m.titulo || m.nombre || `mutación #${i + 1}`;
  let cambios;
  if (Array.isArray(m.cambios)) {
    cambios = m.cambios.map(c => Array.isArray(c)
      ? { de: c[0], a: c[1], veces: c[2] === undefined ? 1 : c[2] }
      : { de: c.de, a: c.a, veces: c.veces === undefined ? 1 : c.veces });
  } else {
    cambios = [{ de: m.de, a: m.a, veces: m.veces === undefined ? 1 : m.veces }];
  }
  return { titulo, cambios };
}

const cuenta = (heno, aguja) => {
  let n = 0, i = 0;
  for (;;) {
    const j = heno.indexOf(aguja, i);
    if (j < 0) return n;
    n++; i = j + aguja.length;
  }
};

// ── 1) LA REVISIÓN BARATA, LA QUE CORRE SIEMPRE ────────────────────────────
//
// Devuelve la lista de quejas. No imprime ni mata el proceso: el banco decide,
// porque es el banco el que sabe cómo se llama su archivo y qué más tiene que
// decir. `exigirAnclajes` es el atajo para el caso normal.
function revisarAnclajes(mutaciones, src, { archivo = '' } = {}) {
  const quejas = [];
  mutaciones.map(normalizar).forEach(({ titulo, cambios }) => {
    cambios.forEach(({ de, a, veces }, k) => {
      const cual = cambios.length > 1 ? ` (cambio ${k + 1} de ${cambios.length})` : '';
      if (typeof de !== 'string' || de === '') {
        quejas.push(`«${titulo}»${cual}: el anclaje no es una cadena`);
        return;
      }
      if (typeof a !== 'string') {
        quejas.push(`«${titulo}»${cual}: el reemplazo no es una cadena`);
        return;
      }
      if (de === a) {
        quejas.push(`«${titulo}»${cual}: el anclaje y su reemplazo son idénticos, no muta nada`);
        return;
      }
      const n = cuenta(src, de);
      if (n === 0) {
        quejas.push(`«${titulo}»${cual}: RANCIA — el anclaje ya no existe en ${path.basename(archivo) || 'el fuente'}\n` +
                    `      buscaba: ${JSON.stringify(recorte(de))}`);
      } else if (n !== veces) {
        quejas.push(`«${titulo}»${cual}: AMBIGUA — el anclaje aparece ${n} vez(ces) y se declaró ${veces}\n` +
                    `      buscaba: ${JSON.stringify(recorte(de))}\n` +
                    `      si las ${n} tienen que irse, declara \`veces: ${n}\`; si no, alarga el anclaje`);
      }
    });
  });
  return quejas;
}

const recorte = (s) => {
  const una = s.replace(/\s+/g, ' ').trim();
  return una.length > 110 ? una.slice(0, 110) + '…' : una;
};

// Lo que llama un banco en su arranque normal. Si hay queja es NO ARRANCÓ (2)
// y no rojo (1): el banco no midió nada, ni bien ni mal, y lo que hay que
// arreglar es el anclaje. Decir «rojo» mandaría a buscar una regresión en el
// producto que no existe.
function exigirAnclajes(mutaciones, src, { archivo = '', callado = false } = {}) {
  const quejas = revisarAnclajes(mutaciones, src, { archivo });
  if (quejas.length === 0) return;
  const salida = [
    `NO ARRANCÓ: ${quejas.length} mutación(es) de la contraprueba ya no aplican.`,
    'Una mutación que no aplica no vigila nada, y el banco seguiría en verde sin protegerlo.',
    ...quejas.map(q => `  · ${q}`),
  ].join('\n');
  if (!callado) console.error(salida);
  process.exit(NO_ARRANCO);
}

// ── 2) EL BUCLE CARO, EL QUE SE PIDE ───────────────────────────────────────
//
// `comoCorrer` es lo único que cambia de banco a banco: unos le pasan la ruta
// del mutante por `ARCHIVO_APP`, otros por `argv[2]`. Por omisión se usa
// `ARCHIVO_APP`, que es la forma de la mayoría.
//
// Devuelve el número de mutaciones que NO salieron en rojo. El banco lo usa
// para su propio veredicto; aquí no se llama a `process.exit` salvo por un
// NO ARRANCÓ, que es un estado y no un resultado.
function correr({
  mutaciones,
  src,
  archivo,
  prefijo = 'contraprueba-',
  extension = path.extname(archivo || '') || '.jsx',
  comoCorrer = (ruta) => ({ args: [], env: { ARCHIVO_APP: ruta, CALLADO: '1' } }),
  banco = require.main ? require.main.filename : '',
  log = console.log,
} = {}) {
  if (!Array.isArray(mutaciones) || mutaciones.length === 0)
    noArranco(['la contraprueba no declara ni una mutación'], path.basename(banco));

  // La revisión barata otra vez, antes de gastar un solo proceso. No es
  // redundante: `correr` se llama también desde el corredor de todas las
  // contrapruebas, donde el banco no pasó por su propio arranque.
  exigirAnclajes(mutaciones, src, { archivo });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
  const normales = mutaciones.map(normalizar);
  let sobrevivieron = 0;
  let aplicadas = 0;

  normales.forEach(({ titulo, cambios }, i) => {
    // Cada cambio se aplica y se COMPRUEBA por separado. Aquí muere el hueco
    // del #124: un mutante de tres cambios cuyo segundo no case ya no pasa
    // por mutante bueno, porque el conteo de cada uno se verificó arriba y la
    // aplicación de cada uno se verifica aquí.
    let mutado = src;
    for (const { de, a, veces } of cambios) {
      const antes = mutado;
      let resto = mutado, hecho = '', puestos = 0;
      for (;;) {
        const j = resto.indexOf(de);
        if (j < 0 || puestos >= veces) break;
        hecho += resto.slice(0, j) + a;
        resto = resto.slice(j + de.length);
        puestos++;
      }
      mutado = hecho + resto;
      if (puestos !== veces || mutado === antes)
        noArranco([`la mutación «${titulo}» puso ${puestos} de ${veces} cambio(s)`],
                  path.basename(banco));
    }
    aplicadas++;

    const f = path.join(dir, `mutante-${i}${extension}`);
    fs.writeFileSync(f, mutado);
    const { args = [], env = {} } = comoCorrer(f) || {};
    const r = spawnSync(process.execPath, [banco, ...args],
      { encoding: 'utf8', env: { ...process.env, ...env, SIN_CONTRAPRUEBA: '1' } });

    if (r.status === NO_ARRANCO) {
      const pista = [r.stdout, r.stderr].join('\n').split('\n')
        .filter(l => /NO ARRANCÓ|excepción|Error/.test(l)).slice(0, 4).join('\n      ');
      noArranco([`«${titulo}» revienta el banco en vez de romper su semántica\n      ${pista}`],
                path.basename(banco));
    }
    if (r.status === 0) {
      sobrevivieron++;
      log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      return;
    }
    const caidas = Number(([r.stdout, r.stderr].join('\n')
      .match(/(\d+) (?:aserci|comprobaci|FALLA)/) || [])[1]) || 0;
    log(`   ✓ ROJO  ${titulo}  ·  ${caidas || '≥1'} aserción(es) mordieron`);
  });

  // Si esto no cuadra, el bucle se saltó una mutación en silencio. Un corredor
  // que dice «las 18 se ven» habiendo corrido 17 es la misma mentira que
  // persigue todo este archivo, nomás un nivel más arriba.
  if (aplicadas !== mutaciones.length)
    noArranco([`se declararon ${mutaciones.length} mutaciones y se aplicaron ${aplicadas}`],
              path.basename(banco));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da igual */ }
  return sobrevivieron;
}

// El veredicto de una contraprueba suelta, para los bancos que la corren con
// `--contraprueba` y nada más.
function veredicto(sobrevivieron, total, { log = console.log } = {}) {
  if (sobrevivieron === 0) {
    log(`\nverde: las ${total} mutaciones salieron en rojo.\n`);
    return 0;
  }
  log(`\nROJO: ${sobrevivieron} de ${total} mutación(es) pasaron sin que nadie las viera.\n`);
  return 1;
}

module.exports = { revisarAnclajes, exigirAnclajes, correr, veredicto, normalizar, cuenta };
