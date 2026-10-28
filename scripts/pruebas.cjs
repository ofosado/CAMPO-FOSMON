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
  'prueba-reglas-extraordinarias.cjs',
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

// ── EL PLAZO: UN BANCO QUE NO TERMINA NO ES UN BANCO QUE PASA ──────────────
//
// Los bancos corren en serie, así que uno que no vuelve no tarda la suite: la
// para para siempre. Y colgarse es exactamente lo que hace un banco apuntado a
// un puerto que no contesta — un `net.connect` sin plazo espera hasta que el
// sistema operativo se aburra, y en macOS eso son más de 75 segundos por
// intento; con reintentos, nunca. Lo que ve quien corrió `npm test` es una
// terminal quieta, y lo que hace es matarla con ^C: la suite no dijo ni verde
// ni rojo, y el silencio se interpretó como «estaba tardando».
//
// Un banco que se pasa del plazo NO es verde ni rojo: es el tercer estado. No
// se comprobó la conducta, se comprobó que no contesta. Se cuenta con las que
// no arrancaron —que es lo que es— y la suite sale con 1.
//
// El plazo es generoso a propósito: los bancos de reglas levantan sesiones
// contra el emulador y `prueba-puente-color` arranca un Chrome. Se puede subir
// con `PLAZO_BANCO` cuando haga falta, pero no desactivar: un plazo que se
// puede quitar con una variable vacía es el defecto otra vez.
const PLAZO_BANCO = Math.max(10_000, Number(process.env.PLAZO_BANCO) || 240_000);

const verdes = [], rojas = [], mudas = [], sinEmulador = [], colgadas = [];

for (const f of archivos) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    encoding: 'utf8', cwd: path.join(dir, '..'), env: entorno,
    timeout: PLAZO_BANCO, killSignal: 'SIGKILL',
  });
  const tardó = Date.now() - t0;
  const salida = (r.stdout || '') + (r.stderr || '');
  const rojasAqui = (salida.match(/^FALLA/gm) || []).length;

  // `spawnSync` marca el plazo vencido con `error.code === 'ETIMEDOUT'`; la
  // señal sola no basta, porque un banco también puede morir por SIGKILL del
  // sistema (sin memoria, por ejemplo) y eso no es lo mismo.
  const seColgó = r.error && r.error.code === 'ETIMEDOUT';

  let estado;
  if (seColgó) { estado = 'SE COLGÓ'; colgadas.push([f, tardó, salida]); }
  else if (r.status === 0) { estado = 'verde'; verdes.push(f); }
  else if (r.status === NO_ARRANCO) { estado = 'NO ARRANCÓ'; mudas.push([f, salida]); }
  else if (NECESITAN_EMULADOR.has(f) && !hayEmulador) { estado = 'sin emulador'; sinEmulador.push(f); }
  else { estado = 'ROJO'; rojas.push([f, salida, rojasAqui]); }

  const detalle = seColgó
    ? `sin contestar en ${Math.round(tardó / 1000)} s`
    : (rojasAqui > 0 ? `${rojasAqui} comprobación(es)` : '');
  console.log(`${estado.padEnd(12)} ${f.replace(/^prueba-|\.cjs$/g, '').padEnd(34)} ${detalle}`);
}

console.log('');
console.log(`${verdes.length} en verde · ${rojas.length} en rojo · ` +
            `${mudas.length} sin arrancar · ${colgadas.length} colgada(s) · ` +
            `${sinEmulador.length} sin emulador ` +
            `(de ${archivos.length})`);

for (const [f, tardó, salida] of colgadas) {
  console.log(`\n──────── ${f} no contestó en ${Math.round(tardó / 1000)} s ────────`);
  console.log('Se le dio muerte. No se comprobó nada: no es verde ni rojo.');
  console.log('Suele ser una conexión a un puerto que no contesta — un emulador');
  console.log('caído, o un puerto cambiado— sin plazo propio. El banco debería');
  console.log('ponerle plazo a lo que espera y salir 2 si no llega.');
  const cola = salida.trim().split('\n').slice(-8).join('\n');
  if (cola) console.log('\nLo último que alcanzó a decir:\n' + cola);
}
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

process.exit(rojas.length + mudas.length + colgadas.length > 0 ? 1 : 0);
