#!/usr/bin/env node
// UNA OBRA CERRADA NO ACUMULA DÍAS DE ATRASO
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// «Ya cerramos el malecón y sigue diciendo que no se carga hace tantos días.»
// Medido el 2026-11-25 contra producción: la obra 0112 tiene `estado:
// 'cerrada'` y el tablero seguía publicando su contador, creciendo solo.
//
// No es cosmética. El número mide el tiempo desde que dejó de haber algo que
// capturar, así que cada semana es más grande y más falso, y manda a mirar
// la obra que menos lo necesita. En el informe era peor todavía: avisaba de
// «lo que se haya construido después», y después del cierre no se construyó
// nada.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `obraSeCaptura` se EXTRAE y SE EJECUTA
// contra los cuatro estados que la app declara, y se comprueba que los cuatro
// sitios del tablero pasen por ella — porque una función correcta que una
// pantalla no llama no arregla nada.
//
// Uso:
//   node scripts/prueba-la-obra-cerrada-no-lleva-atraso.cjs
//   node scripts/prueba-la-obra-cerrada-no-lleva-atraso.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const ARCHIVO_APP = process.env.ARCHIVO_APP || path.join(raiz, 'src/App.jsx');
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'la obra cerrada vuelve a contar días de atraso',
    de: `  return estado !== 'cerrada' && estado !== 'archivada' && estado !== 'pausada';`,
    a:  `  return true;` },
  { nombre: 'la archivada se escapa del predicado',
    de: `  return estado !== 'cerrada' && estado !== 'archivada' && estado !== 'pausada';`,
    a:  `  return estado !== 'cerrada' && estado !== 'pausada';` },
  { nombre: 'una obra sin campo `estado` deja de contar, y son casi todas las viejas',
    de: `  const estado = obra?.estado || 'activa';`,
    a:  `  const estado = obra?.estado || 'cerrada';` },
  { nombre: 'el tablero deja de preguntar y vuelve a contar siempre (excepciones)',
    de: `    const dias = obraSeCaptura(o) ? diasSinCapturaDe(avSemanas, HOY) : null;`,
    a:  `    const dias = diasSinCapturaDe(avSemanas, HOY);` },
  { nombre: 'la columna «última captura» deja de preguntar',
    de: `    const diasCap = obraSeCaptura(o) ? diasSinCapturaDe(avSemanas, HOY) : null;`,
    a:  `    const diasCap = diasSinCapturaDe(avSemanas, HOY);` },
  { nombre: 'el informe vuelve a avisar de lo construido después del cierre',
    de: `  const sinCaptura = obraSeCaptura(obra)\n    ? diasSinCapturaDe(historialAvance, msCorte) : undefined;`,
    a:  `  const sinCaptura = diasSinCapturaDe(historialAvance, msCorte);` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCHIVO_APP, 'utf8'),
    { archivo: ARCHIVO_APP, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCHIVO_APP, 'utf8'),
    archivo: ARCHIVO_APP, extension: '.jsx' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

const { deArchivo } = require('./extraer-de-app.cjs');
let obraSeCaptura, ESTADOS_DE_OBRA;
try {
  ({ obraSeCaptura, ESTADOS_DE_OBRA } =
    deArchivo(ARCHIVO_APP, 'obraSeCaptura', 'ESTADOS_DE_OBRA'));
} catch (e) {
  noArranco([`no se pudo extraer \`obraSeCaptura\`: ${e.message}`], 'src/App.jsx');
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

console.log('\n── LA OBRA CERRADA NO LLEVA DÍAS DE ATRASO ──\n');

console.log('§1 · los cuatro estados que la app declara, ejecutados');
const ESPERADO = { activa: true, pausada: false, cerrada: false, archivada: false };
for (const estado of ESTADOS_DE_OBRA) {
  const r = obraSeCaptura({ estado });
  check(r === ESPERADO[estado],
    `«${estado}» ${ESPERADO[estado] ? 'SÍ' : 'NO'} se captura`,
    r === ESPERADO[estado] ? '' : `dijo ${r}`);
}
check(ESTADOS_DE_OBRA.every(e => e in ESPERADO),
  'y no hay un estado declarado que este banco no mida',
  ESTADOS_DE_OBRA.join(', '));

console.log('\n§2 · la obra vieja, sin campo `estado`, sigue contando');
// Casi todas las obras de producción se dieron de alta antes de que existiera
// el campo. Tratarlas como cerradas apagaría el aviso en las que sí importa.
for (const obra of [{}, { estado: '' }, { estado: null }, null, undefined])
  check(obraSeCaptura(obra) === true,
    `«${JSON.stringify(obra)}» cuenta como activa`,
    obraSeCaptura(obra) === true ? '' : 'LA DIO POR CERRADA');

console.log('\n§3 · y la 0112 de producción, que es la de la queja');
check(obraSeCaptura({ id: '0112', estado: 'cerrada' }) === false,
  'el malecón, cerrado el 2026-11, deja de acumular días');

console.log('\n§4 · los sitios que pintan el número pasan por el predicado');
// Una función correcta que nadie llama no arregla nada. Se mide sobre el
// fuente: son CUATRO sitios, y el día que alguien añada un quinto sin
// preguntar, este renglón lo dice.
const app = fs.readFileSync(ARCHIVO_APP, 'utf8');
const llamadas = app.match(/diasSinCapturaDe\(/g) || [];
const guardadas = app.match(/obraSeCaptura\((?:o|obra)\)\s*\n?\s*\?\s*diasSinCapturaDe\(|obraSeCaptura\((?:o|obra)\) \? diasSinCapturaDe\(/g) || [];
check(llamadas.length === guardadas.length,
  `las ${llamadas.length} llamadas a \`diasSinCapturaDe\` preguntan antes si la obra se captura`,
  `${guardadas.length} de ${llamadas.length}`);
check(llamadas.length >= 5,
  'y siguen siendo al menos las cinco que había, no se perdió ningún aviso',
  `${llamadas.length} llamada(s)`);

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'una obra cerrada sale con una raya, no con un reproche que crece solo.'
  : 'el tablero vuelve a acusar de atraso a una obra que ya terminó.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
