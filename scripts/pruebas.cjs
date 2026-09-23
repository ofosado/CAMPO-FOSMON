#!/usr/bin/env node
// Corre TODA la suite y dice en qué estado quedó cada prueba.
//
// Por qué existe: hasta hoy no había forma de correr la suite entera. Cada
// prueba se invocaba a mano, así que en la práctica sólo se corrían las de la
// rama en la que uno andaba. El 2026-09-23 un renombre de símbolo dejó
// `prueba-nomina-no-guarda-callado` sin arrancar y main pasó horas en rojo sin
// que nadie lo viera: la prueba que se rompió no era la que se estaba mirando.
//
// Distingue TRES estados, no dos (PENDIENTES, principio P4):
//
//   verde       la conducta se comprobó y se sostiene
//   ROJO        la conducta se comprobó y NO se sostiene  → regresión
//   NO ARRANCÓ  la conducta no se pudo comprobar          → punto ciego
//
// El tercero es el que se inventó este corredor. Antes se confundía con el
// segundo, y un punto ciego disfrazado de regresión se "arregla" tocando la
// prueba hasta que pase, que es exactamente como se pierde la cobertura.
//
// Sale con código 1 si hay rojos o si hay pruebas que no arrancaron. Las dos
// cosas paran un merge.
//
// Uso:  npm test
//       node scripts/pruebas.cjs            todas
//       node scripts/pruebas.cjs nomina     sólo las que digan "nomina"

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { NO_ARRANCO } = require('./no-arranco.cjs');

const dir = __dirname;
const filtro = process.argv[2] || '';
const archivos = fs.readdirSync(dir)
  .filter(f => /^prueba-.*\.cjs$/.test(f))
  .filter(f => !filtro || f.includes(filtro))
  .sort();

if (archivos.length === 0) {
  console.log(`No hay pruebas que empaten con "${filtro}".`);
  process.exit(1);
}

// Las que necesitan el emulador de Firestore corriendo. Sin él no se puede
// decir que la conducta esté bien ni mal: no se miró. Es un NO ARRANCÓ con
// otra causa, y se marca aparte para que no se confunda con un renombre.
const NECESITAN_EMULADOR = new Set([
  'prueba-cierre-emulador.cjs',
  'prueba-reglas-nomina-subcoleccion.cjs',
]);

const verdes = [], rojas = [], mudas = [], sinEmulador = [];

for (const f of archivos) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    encoding: 'utf8', cwd: path.join(dir, '..'),
  });
  const salida = (r.stdout || '') + (r.stderr || '');
  const rojasAqui = (salida.match(/^FALLA/gm) || []).length;

  let estado;
  if (r.status === 0) { estado = 'verde'; verdes.push(f); }
  else if (r.status === NO_ARRANCO) { estado = 'NO ARRANCÓ'; mudas.push([f, salida]); }
  else if (NECESITAN_EMULADOR.has(f)) { estado = 'sin emulador'; sinEmulador.push(f); }
  else { estado = 'ROJO'; rojas.push([f, salida, rojasAqui]); }

  const detalle = rojasAqui > 0 ? `${rojasAqui} comprobación(es)` : '';
  console.log(`${estado.padEnd(12)} ${f.replace(/^prueba-|\.cjs$/g, '').padEnd(34)} ${detalle}`);
}

console.log('');
console.log(`${verdes.length} en verde · ${rojas.length} en rojo · ` +
            `${mudas.length} sin arrancar · ${sinEmulador.length} sin emulador ` +
            `(de ${archivos.length})`);

for (const [f, salida] of mudas) {
  console.log(`\n──────── ${f} no arrancó ────────`);
  console.log(salida.trim());
}
for (const [f, salida] of rojas) {
  console.log(`\n──────── ${f} en rojo ────────`);
  console.log((salida.match(/^FALLA.*$/gm) || [salida.trim()]).join('\n'));
}
if (sinEmulador.length > 0) {
  console.log('\nLas de "sin emulador" no se comprobaron. Para correrlas:');
  console.log('  export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"');
  console.log('  firebase emulators:start --only firestore,auth --project campo-fosmon-prueba');
}

process.exit(rojas.length + mudas.length > 0 ? 1 : 0);
