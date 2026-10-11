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
  'prueba-reglas-dependencia-captura.cjs',
  'prueba-reglas-evidencia.cjs',
  'prueba-migracion-ata-la-partida.cjs',
  'prueba-prefijo-organizacion.cjs',
  'prueba-aislamiento-de-usuarios.cjs',
]);

// ¿Está el emulador de Firestore escuchando?
//
// Antes esto no se preguntaba: cualquier salida distinta de cero en una prueba
// de la lista de arriba se atribuía al emulador. El 2026-09-24 eso escondió un
// ReferenceError real —la prueba reventaba con los emuladores arriba y el
// resumen decía "sin emulador"—, que es justo el modo de fallo que la
// categoría existe para evitar. Si el puerto responde, una prueba que falla
// está ROJA y se dice ROJA.
const PUERTO_FIRESTORE = Number(process.env.EMU_PORT || 8080);
const hayEmulador = spawnSync(process.execPath, ['-e', `
  const net = require('net');
  const s = net.connect(${PUERTO_FIRESTORE}, '127.0.0.1');
  s.on('connect', () => { s.end(); process.exit(0); });
  s.on('error', () => process.exit(1));
  setTimeout(() => process.exit(1), 1500);
`]).status === 0;

// ── El reloj con el que se juzga ────────────────────────────────────────────
//
// La suite entera afirma sobre un producto mexicano: semanas ISO de captura,
// cierres de nómina, "hace 7 días sin captura". Y `semanaISO` resuelve una
// marca de tiempo completa por su DÍA LOCAL, que es lo correcto —un instante
// designa un instante— pero local es local de la máquina que corre.
//
// El 2026-10-10, con la laptop en Europe/Madrid, la suite dio 52 verdes y UN
// rojo: `2026-08-03T01:00:00Z` es domingo 2 a las 19:00 en México y lunes 3 a
// las 03:00 en Madrid, así que la misma prueba sin cambiar una letra decía 31
// en un sitio y 32 en el otro. Eso no es una prueba roja: es una suite cuyo
// veredicto dependía de en qué país estaba abierta la computadora, que es la
// forma más cara de "falla y luego pasa".
//
// Se fija aquí y no en el banco que falló porque el que falló fue el único que
// tenía una marca de tiempo con hora; los demás usan la forma de diez letras y
// hoy no se enteran. Esperar a que se enteren de uno en uno es volver a buscar
// el defecto cada vez que alguien viaje.
//
// Lo que ESTO NO ARREGLA, y queda anotado en PENDIENTES #61: un teléfono fuera
// de México sigue archivando su foto en la semana de su propio día local. Aquí
// se hizo determinista la medición, no se cambió la conducta.
//
// ACTUALIZADO el 2026-10-11: fijarlo AQUÍ tampoco alcanzaba. El corredor es una
// de las dos formas de correr un banco; la otra es a mano, que es justo como se
// trabaja mientras se arregla algo, y ésa no pasaba por este renglón. Con la
// laptop en Madrid, `prueba-series-sincronizadas` daba verde por `npm test` y
// ROJO por `node scripts/…`: el mismo código, dos veredictos, según cómo lo
// invocaras. Ahora el huso lo fija `reloj.cjs` desde el preámbulo que los 55
// bancos ya cargan, y de ahí sale también esta constante — la zona es UNA
// decisión y no se teclea en dos archivos. Lo de abajo se queda porque los
// subprocesos heredan el entorno y porque el aviso vale: una suite verde en
// Madrid no significa que la máquina de Madrid mida igual.
const { ZONA, AMBIENTE } = require('./reloj.cjs');
const entorno = { ...process.env, TZ: ZONA };
console.log(`reloj de la suite: TZ=${ZONA}` +
  (AMBIENTE !== ZONA
    ? `  (la máquina está en ${AMBIENTE}; se ignora a propósito)` : ''));

const verdes = [], rojas = [], mudas = [], sinEmulador = [];

for (const f of archivos) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    encoding: 'utf8', cwd: path.join(dir, '..'), env: entorno,
  });
  const salida = (r.stdout || '') + (r.stderr || '');
  const rojasAqui = (salida.match(/^FALLA/gm) || []).length;

  let estado;
  if (r.status === 0) { estado = 'verde'; verdes.push(f); }
  else if (r.status === NO_ARRANCO) { estado = 'NO ARRANCÓ'; mudas.push([f, salida]); }
  else if (NECESITAN_EMULADOR.has(f) && !hayEmulador) { estado = 'sin emulador'; sinEmulador.push(f); }
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
