#!/usr/bin/env node
// ── UNA SEMANA QUE NO SE SABE CUÁL ES ──────────────────────────────────────
//
// Dos defectos de la misma familia: una semana escrita sin lo que la hace
// única, y una pantalla que afirma sobre ella de todos modos.
//
//   (A) LA SEMANA SIN SU AÑO. `gpData.semanasDisponibles` son claves `S42` sin
//       año, y el parser del Sheet además sólo conserva el año más reciente.
//       El 5 de enero la lista entera es ["S1"], y cuatro sitios hacían
//       `slice(-4)` y dividían entre `length` — con el renglón diciendo
//       «últimas 4 semanas» pase lo que pase. Un promedio de una semana
//       presentado como promedio de cuatro es una cifra inventada (P2).
//
//   (B) LA SEMANA SIN SU LUGAR. El día de un instante depende de dónde se
//       pregunte. `fechaDeTimestamp` lo resolvía con `getDate()`, o sea en el
//       huso del APARATO: un domingo por la noche en México ya es lunes en
//       Madrid, y la foto se archivaba en la semana siguiente.
//
// Las dos cuentas se SACAN de `src/App.jsx` por AST y se EJECUTAN. Nada aquí
// afirma que un símbolo exista: lo que se afirma es qué sale.
//
// Para (B) hace falta mover el huso del proceso, y la suite lo fija en
// `America/Mexico_City` (ver `scripts/reloj.cjs`). Mover `process.env.TZ` en
// caliente funciona en Node moderno, pero si algún día dejara de funcionar
// esto daría verde por no haber probado nada — así que se COMPRUEBA que el
// cambio mordió, y si no, NO ARRANCÓ 2.

'use strict';

const path = require('path');
const { deApp, SimboloPerdido } = require('./extraer-de-app.cjs');
const { noArranco, NO_ARRANCO } = require('./no-arranco.cjs');

let fallas = 0;
const check = (ok, que, detalle = '') => {
  if (ok) { console.log(`  ok   ${que}`); return; }
  fallas++;
  console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`);
};

let app;
try {
  app = deApp(
    'ultimasSemanasSeguidasGP', 'velocidadSemanalGP', 'semanaAnteriorGP',
    'proveedoresNuevosGP', 'incrementosDeProveedorGP',
    'fechaEnZonaObra', 'fechaDeTimestamp', 'semanaDeEvidencia',
    'semanaISO', 'snapshotId', 'ZONA_OBRA',
  );
} catch (e) {
  if (e instanceof SimboloPerdido) {
    noArranco(`${e.message}\n` +
      'O se renombró un ayudante, o alguien volvió a meter la cuenta de las\n' +
      'semanas dentro del componente que la pinta. Las dos cosas hay que verlas.');
  }
  throw e;
}

const {
  ultimasSemanasSeguidasGP, velocidadSemanalGP, semanaAnteriorGP,
  proveedoresNuevosGP, incrementosDeProveedorGP,
  fechaEnZonaObra, fechaDeTimestamp, semanaDeEvidencia, ZONA_OBRA,
} = app;

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. La serie dice cuántas semanas tiene de verdad');
// ════════════════════════════════════════════════════════════════════════════

const serieCompleta = Array.from({ length: 42 }, (_, i) => `S${i + 1}`);

// El caso de hoy, medido contra producción el 2026-10-26: 42 semanas seguidas.
check(
  JSON.stringify(ultimasSemanasSeguidasGP(serieCompleta, 4)) ===
    JSON.stringify(['S39', 'S40', 'S41', 'S42']),
  'con 42 semanas seguidas, las últimas cuatro son S39..S42',
  JSON.stringify(ultimasSemanasSeguidasGP(serieCompleta, 4)));

// El 5 de enero. Esto es lo que el parser produce al cambiar de año.
check(ultimasSemanasSeguidasGP(['S1'], 4) === null,
  'la primera semana del año NO son cuatro semanas');

// Un hueco en el Sheet: S38, S39, S41, S42 son cuatro claves pero cinco
// semanas de calendario.
check(ultimasSemanasSeguidasGP(['S36','S37','S38','S39','S41','S42'], 4) === null,
  'cuatro claves con un hueco en medio NO son cuatro semanas seguidas');

// El cruce de año en una lista que no se vació: 41, 42, 1, 2.
check(ultimasSemanasSeguidasGP(['S39','S40','S41','S42','S1','S2'], 4) === null,
  'S42 → S1 no es «la siguiente»: la lista cruza un año y se rechaza');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. La velocidad dice sobre cuántas semanas se calculó');
// ════════════════════════════════════════════════════════════════════════════

const gastoObra = Object.fromEntries(serieCompleta.map(s => [s, 100000]));
const vNormal = velocidadSemanalGP(gastoObra, serieCompleta);
check(vNormal.velocidad === 100000 && vNormal.semanasBase === 4,
  'cuatro semanas de 100 mil dan 100 mil por semana, con base 4',
  JSON.stringify(vNormal));

// EL DEFECTO. Una sola semana con un gasto grande: antes salía como
// «velocidad promedio · últimas 4 semanas». Ahora no sale nada.
const vEnero = velocidadSemanalGP({ S1: 400000 }, ['S1']);
check(vEnero.velocidad === null && vEnero.semanasBase === 0,
  'con una sola semana NO hay velocidad: null, no un promedio de uno',
  JSON.stringify(vEnero));

// `null` y no cero. Cero es un ritmo, y un ritmo de cero proyecta que el
// presupuesto no se agota nunca — que es la mentira tranquilizadora.
check(vEnero.velocidad !== 0,
  'lo que falta se dice null, nunca cero');

// La base viaja con la cifra para que el renglón no lleve un «4» tecleado.
const vTres = velocidadSemanalGP(gastoObra, serieCompleta, 3);
check(vTres.semanasBase === 3, 'la base la dice la cuenta, no el renglón',
  JSON.stringify(vTres));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. «Vs semana anterior» es la anterior de verdad');
// ════════════════════════════════════════════════════════════════════════════

check(semanaAnteriorGP(serieCompleta, 'S42') === 'S41',
  'la anterior de S42 es S41');
check(semanaAnteriorGP(['S1'], 'S1') === null,
  'la primera semana del año no tiene anterior');
check(semanaAnteriorGP(['S40','S42'], 'S42') === null,
  'con un hueco, la de la lista está a dos semanas y no sirve de «anterior»');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Un proveedor nuevo necesita un «antes» del que faltar');
// ════════════════════════════════════════════════════════════════════════════

const provs = [
  { nombre: 'Aceros del Norte', semanas: { S40: 10, S41: 20, S42: 40 }, total: 70 },
  { nombre: 'Grúas Omega',      semanas: { S42: 50 }, total: 50 },
  { nombre: 'Cementos Sur',     semanas: { S39: 10 }, total: 10 },
  // Justo en la raya: +50% exacto. El umbral es «más de 50», no «50 o más»,
  // y la raya se fija aquí para que nadie la mueva sin darse cuenta.
  { nombre: 'Arena y Grava',    semanas: { S41: 20, S42: 30 }, total: 50 },
];

const nuevos = proveedoresNuevosGP(provs, serieCompleta, 'S42');
check(nuevos.length === 1 && nuevos[0].nombre === 'Grúas Omega',
  'con historia, sólo el que aparece por primera vez es nuevo',
  nuevos.map(p => p.nombre).join(', '));

// EL DEFECTO. El 5 de enero todos tienen exactamente una semana y es la
// última, así que todos salían anunciados como proveedores nuevos.
const provsEnero = provs.map(p => ({ ...p, semanas: { S1: 10 } }));
check(proveedoresNuevosGP(provsEnero, ['S1'], 'S1').length === 0,
  'en la primera semana del año NO se anuncia a nadie como nuevo',
  `anunciados: ${proveedoresNuevosGP(provsEnero, ['S1'], 'S1').length}`);

// Un hueco en el Sheet NO borra la historia. Con S38..S41 y S43 —sin S42—
// Grúas Omega sigue sin aparecer nunca antes, y decirlo es cierto. Exigir
// cuatro semanas seguidas aquí escondía una tarjeta verdadera: lo comprobó el
// preview el 2026-10-27, con la tarjeta desapareciendo al abrir un hueco.
const conHueco = ['S38','S39','S40','S41','S42'];
const nuevosConHueco = proveedoresNuevosGP(provs, conHueco.filter(s => s !== 'S40'), 'S42');
check(nuevosConHueco.length === 1 && nuevosConHueco[0].nombre === 'Grúas Omega',
  'un hueco en el Sheet no borra la historia: el nuevo se sigue nombrando',
  nuevosConHueco.map(p => p.nombre).join(', ') || '(ninguno)');

const incs = incrementosDeProveedorGP(provs, serieCompleta, 'S42');
check(incs.length === 1 && incs[0].nombre === 'Aceros del Norte'
  && Math.round(incs[0].incrementoPct) === 100,
  'un salto de 20 a 40 es +100% contra la semana contigua, y es el único',
  JSON.stringify(incs.map(p => [p.nombre, p.incrementoPct])));

check(!incs.some(p => p.nombre === 'Arena y Grava'),
  '+50% exacto no pasa la raya de «más de 50%»');

check(incrementosDeProveedorGP(provs, ['S40','S42'], 'S42').length === 0,
  'sin semana contigua no se afirma ningún incremento «vs semana anterior»');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. El día de una foto es el de la OBRA, no el del aparato');
// ════════════════════════════════════════════════════════════════════════════

check(ZONA_OBRA === 'America/Mexico_City',
  'el calendario de referencia está escrito en un solo sitio', ZONA_OBRA);

// Domingo 25 de octubre de 2026, 23:40 hora de la Ciudad de México.
// En UTC eso ya es lunes 26 a las 05:40; en Madrid, lunes 26 a las 06:40.
// Es DOMINGO en la obra, así que es la semana que termina, no la que empieza.
const INSTANTE = new Date('2026-10-26T05:40:00Z');
const tsFirestore = { seconds: Math.floor(INSTANTE.getTime() / 1000) };

const HUSOS = ['America/Mexico_City', 'Europe/Madrid', 'UTC',
  'Pacific/Kiritimati', 'Pacific/Midway'];

const husoOriginal = process.env.TZ;
const conHuso = (tz, fn) => {
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = husoOriginal; }
};

// El cambio de huso tiene que MORDER, o este apartado entero está midiendo
// aire y daría verde sin haber probado nada.
const horaEn = tz => conHuso(tz, () => new Date(INSTANTE).getHours());
if (horaEn('America/Mexico_City') === horaEn('Pacific/Kiritimati')) {
  noArranco(
    'Cambiar `process.env.TZ` en caliente ya no mueve la hora local de Node\n' +
    `(${process.version}). Sin eso, este banco no puede poner el aparato en\n` +
    'otro país y lo de abajo no probaría nada. Hay que pasarlo a procesos hijo\n' +
    'con `TZ=` en el ambiente.');
}

const diasVistos = new Set();
const semanasVistas = new Set();
for (const tz of HUSOS) {
  const dia = conHuso(tz, () => fechaDeTimestamp(tsFirestore));
  const sem = conHuso(tz, () => semanaDeEvidencia({
    fechaServidor: fechaDeTimestamp(tsFirestore), fechaDeclarada: null }));
  diasVistos.add(dia);
  semanasVistas.add(sem);
  console.log(`       aparato en ${tz.padEnd(22)} → día ${dia}  semana ${sem}`);
}

check(diasVistos.size === 1 && diasVistos.has('2026-10-25'),
  'el mismo instante da el mismo día desde cinco husos: el domingo 25',
  [...diasVistos].join(' · '));

check(semanasVistas.size === 1,
  'y por lo tanto cae en UNA sola semana, no en dos según quién mire',
  [...semanasVistas].join(' · '));

// La semana correcta es la del domingo 25 —la 43 de 2026—, no la del lunes 26.
check(semanasVistas.has('S43-2026'),
  'la foto del domingo por la noche queda en la semana que termina, no en la que empieza',
  [...semanasVistas].join(' · '));

// `fechaEnZonaObra` no depende del idioma del aparato: `toLocaleDateString`
// con `es-MX` habría dado `25/10/2026`, que es cambiar un heredado por otro.
check(fechaEnZonaObra(INSTANTE) === '2026-10-25',
  'la fecha sale `YYYY-MM-DD` por partes, no por el formato del locale',
  String(fechaEnZonaObra(INSTANTE)));

check(fechaEnZonaObra(new Date('no es una fecha')) === null,
  'una fecha ilegible se dice null, no se inventa un día');

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} · ` +
  `${fallas === 0 ? 'todas las comprobaciones' : `${fallas} fallas`}`);
process.exit(fallas > 0 ? 1 : 0);
