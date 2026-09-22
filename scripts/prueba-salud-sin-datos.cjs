#!/usr/bin/env node
// Prueba: la pantalla de salud distingue las tres cosas que se parecen y no
// son lo mismo — "corrió bien", "lleva callada demasiado" y "nunca registró
// nada".
//
// La tercera es la que importa y la que nadie programa bien. Una función que
// jamás escribió su rastro no lleva "0 días sin correr": no se sabe cuánto
// lleva. Poner cero ahí la pinta de verde y es justo el estado que en agosto
// pasó ~16 días desapercibido (PENDIENTES #26, P2).
//
// No comprueba que exista un `if`: extrae `estadoDeJob`, `haceCuanto` y la
// tabla real de jobs del archivo, y les pregunta qué contestan.
//
// Uso:  node scripts/prueba-salud-sin-datos.cjs [archivo]

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  FunctionDeclaration(p) {
    if (p.node.id) decl['fn:' + p.node.id.name] ||= src.slice(p.node.start, p.node.end);
  },
});

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

for (const n of ['fn:estadoDeJob', 'fn:haceCuanto', 'JOBS_PROGRAMADOS'])
  if (!decl[n]) check(false, `se pudo extraer \`${n.replace('fn:', '')}\``);
if (fallas) { console.log('\nNo se pudo montar la prueba.'); process.exit(1); }

const mod = new Function(`
  "use strict";
  const C = { textMut:'GRIS', red:'ROJO', green:'VERDE' };
  ${decl['fn:haceCuanto']}
  ${decl['fn:estadoDeJob']}
  const JOBS = ${decl['JOBS_PROGRAMADOS']};
  return { estadoDeJob, haceCuanto, JOBS };
`)();
const { estadoDeJob, haceCuanto, JOBS } = mod;

const AHORA = Date.parse('2026-09-22T12:00:00-06:00');
const haceHoras = h => new Date(AHORA - h * 3600000).toISOString();
const buscar = id => JOBS.find(j => j.id === id);

// ── La tabla cubre los seis jobs que existen de verdad ────────────────────
const ESPERADOS = ['backupSemanalFirestore', 'resumenSemanalEmail', 'recordatorioLunes',
  'recordatorioCapturaSubs', 'recordatorioCapturaObra', 'actualizarGPSheet'];
console.log('1. La tabla corresponde a las funciones que existen');
check(JOBS.length === ESPERADOS.length, `hay ${JOBS.length} jobs declarados`, `esperados ${ESPERADOS.length}`);
for (const f of ESPERADOS)
  check(JOBS.some(j => j.funcion === f), `cubre \`${f}\``);
check(JOBS.every(j => j.id && j.nombre && j.que && j.cuando && j.limiteHoras > 0),
  'cada job dice qué es, cada cuándo debería correr y a partir de cuándo es tarde');

// Los ids tienen que ser los que escribe `registrarSalud` en functions/index.js,
// o la pantalla leería llaves que nadie escribe y mostraría seis "sin datos".
const fnSrc = (() => { try { return fs.readFileSync(path.join(raiz, 'functions/index.js'), 'utf8'); } catch { return ''; } })();
if (fnSrc) {
  const escritos = [...fnSrc.matchAll(/registrarSalud\(\s*"([^"]+)"/g)].map(m => m[1]);
  const unicos = [...new Set(escritos)];
  check(unicos.length > 0 && unicos.every(id => JOBS.some(j => j.id === id)),
    'los ids que lee la pantalla son los que escriben las funciones',
    unicos.filter(id => !JOBS.some(j => j.id === id)).join(', ') || unicos.join(', '));
  check(JOBS.every(j => unicos.includes(j.id)),
    'y no hay ninguno declarado que nadie escriba',
    JOBS.filter(j => !unicos.includes(j.id)).map(j => j.id).join(', ') || 'ninguno');
}

// ── LO QUE IMPORTA: nunca registró nada ───────────────────────────────────
console.log('\n2. Una función que nunca registró nada NO va como "hace 0 días" (P2)');
const nunca = estadoDeJob(buscar('backup'), undefined, AHORA);
check(nunca.estado === 'sin datos', 'va como "sin datos"', nunca.estado);
check(nunca.color === 'GRIS', 'en gris, no en verde ni en rojo', nunca.color);
check(!nunca.h, 'y no trae ningún "hace N" que inventar', nunca.h?.texto || 'ninguno');
check(nunca.estado !== 'al día',
  'sobre todo: no se pinta de verde por no haber dicho nada');

// Registro presente pero sin fecha utilizable: mismo caso, no "hace 0 días".
for (const [etiqueta, reg] of [
  ['sin campo de fecha',   { ok: true, mensaje: 'OK' }],
  ['fecha vacía',          { ok: true, ultimaEjecucion: '' }],
  ['fecha ilegible',       { ok: true, ultimaEjecucion: 'el domingo pasado' }],
  ['fecha nula',           { ok: true, ultimaEjecucion: null }],
]) {
  const r = estadoDeJob(buscar('backup'), reg, AHORA);
  check(r.estado === 'sin datos', `un registro con ${etiqueta} también es "sin datos"`, r.estado);
}
check(haceCuanto(undefined, AHORA) === null && haceCuanto('x', AHORA) === null,
  'y la medición devuelve null en vez de 0 cuando no hay qué medir');

// ── Al día vs silencio, en el borde ───────────────────────────────────────
console.log('\n3. El rojo aparece por silencio, no solo por fallo');
const sem = buscar('email_semanal');   // semanal: aguanta 9 días
check(estadoDeJob(sem, { ok: true, ultimaEjecucion: haceHoras(24) }, AHORA).estado === 'al día',
  'una semanal que corrió ayer está al día');
check(estadoDeJob(sem, { ok: true, ultimaEjecucion: haceHoras(8 * 24) }, AHORA).estado === 'al día',
  'a los 8 días sigue al día — una corrida puede atrasarse sin ser un problema');
const callada = estadoDeJob(sem, { ok: true, ultimaEjecucion: haceHoras(10 * 24) }, AHORA);
check(callada.estado === 'sin correr' && callada.color === 'ROJO',
  'a los 10 días se pone en rojo aunque la última corrida haya salido BIEN',
  `${callada.estado} / ${callada.color}`);

const dia = buscar('gp_sync');         // diaria: aguanta 36 h
check(estadoDeJob(dia, { ok: true, ultimaEjecucion: haceHoras(30) }, AHORA).estado === 'al día',
  'una diaria a las 30 h está al día');
check(estadoDeJob(dia, { ok: true, ultimaEjecucion: haceHoras(40) }, AHORA).color === 'ROJO',
  'a las 40 h se pone en rojo');
check(estadoDeJob(sem, { ok: true, ultimaEjecucion: haceHoras(40) }, AHORA).estado === 'al día',
  'y esas mismas 40 h no alarman a la semanal: cada una con su plazo');

console.log('\n4. Un fallo registrado se ve, con su mensaje');
const fallo = estadoDeJob(dia, { ok: false, ultimaEjecucion: haceHoras(2),
  mensaje: 'The caller does not have permission' }, AHORA);
check(fallo.estado === 'falló' && fallo.color === 'ROJO',
  'una corrida reciente que falló va en rojo, no en verde por ser reciente',
  `${fallo.estado} / ${fallo.color}`);
check(fallo.e.mensaje === 'The caller does not have permission',
  'y el mensaje textual del error llega intacto a la pantalla');

console.log('\n5. Textos de antigüedad');
for (const [h, esperado] of [[0.2, 'hace un momento'], [3, 'hace 3 h'],
  [24, 'hace 1 día'], [72, 'hace 3 días'], [23, 'hace 23 h']]) {
  const t = haceCuanto(haceHoras(h), AHORA)?.texto;
  check(t === esperado, `${h} h → "${esperado}"`, t);
}
check(haceCuanto(haceHoras(-5), AHORA)?.texto === 'con fecha futura',
  'un registro con fecha futura se nombra, no se redondea a "hace un momento"');

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
