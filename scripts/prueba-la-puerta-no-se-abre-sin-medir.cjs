#!/usr/bin/env node
// LA PUERTA DE LA SUITE NO SE ABRE CON BANCOS SIN COMPROBAR
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El 2026-11-25, al matar un emulador que llevaba dos días corriendo olvidado
// en la máquina, `npm test` imprimió:
//
//     137 en verde · 0 en rojo · 0 sin arrancar · 16 sin emulador
//     Las 16 de "sin emulador" no se comprobaron.
//
// y **salió con 0**. El informe decía la verdad; la puerta no. Dieciséis
// bancos que nadie corrió pasaron por verde, y lo que lee un CI —o yo, al
// reportar— es el código de salida.
//
// Peor que no decirlo: decirlo y no hacerlo cumplir invita a confiar en el
// número. «Una prueba que no arranca es roja, no es casi» es la regla de la
// casa, y 16 que no arrancaron no pueden valer 0.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `codigoDeSalida` se EXTRAE de
// `scripts/pruebas.cjs` y SE EJECUTA contra los recuentos con los que la
// suite termina de verdad, incluidos los que la rompieron.
//
// Uso:
//   node scripts/prueba-la-puerta-no-se-abre-sin-medir.cjs
//   node scripts/prueba-la-puerta-no-se-abre-sin-medir.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const CORREDOR = process.env.ARCH_CORREDOR || path.join(raiz, 'scripts/pruebas.cjs');
noArranco.vigilarExcepciones(path.relative(raiz, CORREDOR));

const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'vuelve el hueco: los bancos sin comprobar dejan la puerta abierta',
    de: `  if (sinEmulador > 0) return NO_ARRANCO;   // 2: no se pudo medir, no es verde`,
    a:  `  if (false) return NO_ARRANCO;` },
  { nombre: 'lo no medido sale con 1 y se confunde con un fallo que sí se midió',
    de: `  if (sinEmulador > 0) return NO_ARRANCO;   // 2: no se pudo medir, no es verde`,
    a:  `  if (sinEmulador > 0) return 1;` },
  { nombre: 'un rojo deja de cerrar la puerta',
    de: `  if (enRojo > 0) return 1;`,
    a:  `  if (false) return 1;` },
  { nombre: 'el barrido de fechas se cae de la cuenta y lo caducado pasa por verde',
    de: `  const enRojo = rojas + mudas + colgadas + caducas`,
    a:  `  const enRojo = rojas + mudas + colgadas + 0 * caducas` },
  { nombre: 'el reloj ausente deja de contar, que es el caso que no tiene banco propio',
    de: `    + exclusionesFantasma + sinDeclarar + (faltaElReloj ? 1 : 0);`,
    a:  `    + exclusionesFantasma + sinDeclarar;` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(CORREDOR, 'utf8'),
    { archivo: CORREDOR, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(CORREDOR, 'utf8'),
    archivo: CORREDOR, extension: '.cjs',
    comoCorrer: (ruta) => ({ args: [], env: { ARCH_CORREDOR: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── LA PIEZA REAL ───────────────────────────────────────────────────────────
// Se extrae por AST y se ejecuta. El corredor entero NO se puede requerir: al
// cargarse lanza los 153 bancos.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const src = fs.readFileSync(CORREDOR, 'utf8');
let trozo = null;
traverse(parse(src, { sourceType: 'script' }), {
  FunctionDeclaration(p) {
    if (p.parent.type === 'Program' && p.node.id?.name === 'codigoDeSalida')
      trozo = src.slice(p.node.start, p.node.end);
  },
});
if (!trozo) noArranco(['no se halló `codigoDeSalida` en el corredor'],
  path.relative(raiz, CORREDOR));

const { NO_ARRANCO } = require('./no-arranco.cjs');
let codigoDeSalida;
try {
  codigoDeSalida = new Function('NO_ARRANCO',
    `"use strict";\n${trozo}\nreturn codigoDeSalida;`)(NO_ARRANCO);
} catch (e) {
  noArranco([`la puerta no se pudo montar: ${e.message}`], path.relative(raiz, CORREDOR));
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

console.log('\n── LA PUERTA DE LA SUITE ──\n');

console.log('§1 · los tres estados de la casa');
const CASOS = [
  [{}, 0, 'todo medido y todo verde'],
  [{ rojas: 1 }, 1, 'un banco en rojo'],
  [{ sinEmulador: 16 }, NO_ARRANCO,
    'dieciséis sin comprobar: el caso exacto del 2026-11-25'],
  [{ sinEmulador: 1 }, NO_ARRANCO, 'uno solo sin comprobar basta'],
];
for (const [recuento, esperado, porque] of CASOS) {
  const r = codigoDeSalida(recuento);
  check(r === esperado, `${porque} → ${esperado}`,
    r === esperado ? '' : `DIO ${r}`);
}

console.log('\n§2 · rojo gana sobre no-medido, y las dos cierran');
check(codigoDeSalida({ rojas: 1, sinEmulador: 16 }) === 1,
  'con rojo y sin medir a la vez, manda el rojo: es lo accionable',
  String(codigoDeSalida({ rojas: 1, sinEmulador: 16 })));
check(codigoDeSalida({ rojas: 1, sinEmulador: 16 }) !== 0 &&
      codigoDeSalida({ sinEmulador: 16 }) !== 0,
  'y ninguna de las dos devuelve 0, que es lo único que no puede pasar');

console.log('\n§3 · todo lo que el corredor sabe contar cierra la puerta');
for (const clave of ['rojas', 'mudas', 'colgadas', 'caducas',
                     'exclusionesFantasma', 'sinDeclarar']) {
  const r = codigoDeSalida({ [clave]: 1 });
  check(r === 1, `\`${clave}\` cierra con 1`, r === 1 ? '' : `DIO ${r}`);
}
check(codigoDeSalida({ faltaElReloj: true }) === 1,
  '`faltaElReloj` también, que es bandera y no cuenta',
  String(codigoDeSalida({ faltaElReloj: true })));

console.log('\n§4 · y no se abre por omisión');
check(codigoDeSalida() === 0 && codigoDeSalida(undefined) === 0,
  'sin argumentos da 0 — es el único camino a 0 y pide que TODO esté en cero',
  `${codigoDeSalida()} / ${codigoDeSalida(undefined)}`);
const todoEnUno = { rojas: 1, mudas: 1, colgadas: 1, caducas: 1,
                    exclusionesFantasma: 1, sinDeclarar: 1,
                    faltaElReloj: true, sinEmulador: 1 };
check(codigoDeSalida(todoEnUno) === 1, 'y con todo a la vez sigue siendo 1',
  String(codigoDeSalida(todoEnUno)));

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'un banco que no se pudo correr ya no pasa por verde.'
  : 'la suite puede volver a salir con 0 sobre bancos que nadie comprobó.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
