// Una prueba que no arranca tiene que gritar igual que una que falla.
// Ver PENDIENTES, principio P4.
//
// Las pruebas de este repositorio sacan el código vivo de `src/App.jsx`
// recorriendo el AST y buscando declaraciones POR NOMBRE. Eso no choca con el
// P3 —el P3 prohíbe *afirmar* que un nombre existe, no usarlo como dirección
// para llegar al código— pero tiene una consecuencia: el día que alguien
// renombra un símbolo, la prueba deja de encontrar lo que iba a ejercitar.
//
// Ese día la prueba no sabe nada. No sabe si la conducta sigue viva bajo otro
// nombre ni si se rompió: sabe que no pudo mirar. Decirlo como "FALLA" es
// mentir en una dirección y callarlo es mentir en la otra, así que se dice lo
// que es, y se sale con un código PROPIO (2) para que el corredor de la suite
// lo pueda separar de un rojo de verdad.
//
// Esto salió de un caso concreto: el 2026-09-23 el renombre de
// `eliminarSemana` a `eliminarCarga` dejó `prueba-nomina-no-guarda-callado`
// muerta antes de montar nada, y main pasó horas en rojo sin que se notara.

// Fija el huso con el que se juzga, por efecto de carga. Vive aquí y no en
// cada banco porque éste es el único módulo que los 55 ya requieren en su
// cabecera, antes de construir ninguna fecha. El porqué está en `reloj.cjs`.
require('./reloj.cjs');

const NO_ARRANCO = 2;

module.exports = function noArranco(faltantes, archivo = 'src/App.jsx') {
  const lista = (Array.isArray(faltantes) ? faltantes : [faltantes])
    .map(n => String(n).replace(/^fn:/, ''));
  console.log('');
  console.log('NO ARRANCÓ — la prueba no pudo encontrar en ' + archivo + ':');
  for (const n of lista) console.log('  · `' + n + '`');
  console.log('');
  console.log('Lo más probable es que el símbolo haya cambiado de nombre. Eso NO');
  console.log('dice que haya una regresión — y tampoco que no la haya: la conducta');
  console.log('se quedó SIN COMPROBAR, que es lo peligroso.');
  console.log('');
  console.log('Buscar cómo se llama ahora y apuntar la extracción al nombre nuevo.');
  console.log('Si la conducta ya no existe, borrar la prueba con ella; lo que no');
  console.log('puede quedarse es una prueba que nadie ve morir.');
  process.exit(NO_ARRANCO);
};

module.exports.NO_ARRANCO = NO_ARRANCO;

// El tercer modo de no arrancar: falta algo del ENTORNO.
//
// No un símbolo renombrado ni una excepción, sino un insumo que la prueba
// necesita y que no se puede fabricar sola: un volcado de producción, una
// credencial, un archivo que alguien tiene que bajar antes. Es el caso más
// fácil de clasificar mal porque la prueba sabe exactamente qué le falta, y
// decirlo con `exit(1)` sale gratis.
//
// Sale caro después. Un rojo que lleva semanas puesto porque a alguien le
// falta un archivo en /tmp es un rojo que se aprende a saltar, y el día que
// esa misma prueba encuentre una regresión de verdad nadie la va a mirar. El
// P4 existe para esto: tres estados, y "no pude mirar" es el tercero.
module.exports.sinPrecondicion = function sinPrecondicion(queFalta, comoConseguirlo) {
  const pasos = Array.isArray(comoConseguirlo) ? comoConseguirlo : [comoConseguirlo];
  console.log('');
  console.log('NO ARRANCÓ — le falta un insumo del entorno:');
  console.log('  · ' + queFalta);
  console.log('');
  console.log('Esto NO es un rojo: no se comprobó nada, ni bien ni mal. Para que');
  console.log('corra, conseguir eso primero:');
  console.log('');
  for (const p of pasos) if (p) console.log('  ' + p);
  console.log('');
  process.exit(NO_ARRANCO);
};

// El cuarto modo: UN PUERTO QUE NO CONTESTA.
//
// Es un insumo del entorno como el de arriba, pero falla distinto y por eso
// lleva su propia puerta. Un emulador caído no da error: da silencio. El SDK de
// Firebase reintenta, y un banco apuntado a un puerto muerto no sale ni con 1
// ni con 2 — se queda. Corrido a mano, es una terminal quieta que se mata con
// ^C; dentro de la suite, cuatro minutos hasta que el corredor lo mata y
// publica «sin contestar en 240 s», que manda a buscar un banco lento.
//
// El caso que lo abrió, 2026-11-06: `prueba-reglas-dependencia-captura` es el
// único banco que ejercita `storage.rules`, los emuladores se habían levantado
// con `--only firestore,auth`, y el 9199 estaba caído. El banco corrió ocho
// secciones en verde, llegó a la novena, intentó subir la carátula y se quedó
// ahí. En la cola del informe sólo había ruido de gRPC de Firestore: Storage no
// aparecía por ninguna parte. Es el P4 por el peor lado — no hay ni código de
// salida que clasificar.
//
// Se pregunta ANTES de la primera aserción, no donde se usa el puerto: llegar a
// la novena sección y declarar entonces que no se midió nada deja ocho verdes
// publicados sobre un entorno incompleto.
//
// `spawnSync` y no `net.connect` porque esto tiene que correr arriba del
// archivo, antes del IIFE, y porque lo que hace falta es un plazo: un
// `net.connect` a un puerto muerto espera a que se aburra el sistema operativo
// —más de 75 s en macOS—, que es el defecto otra vez una planta más abajo.
module.exports.exigirPuertos = function exigirPuertos(puertos, host = '127.0.0.1') {
  const { spawnSync } = require('child_process');
  const muertos = Object.entries(puertos).filter(([, p]) =>
    spawnSync(process.execPath, ['-e', `
      const net = require('net');
      const s = net.connect(${Number(p)}, ${JSON.stringify(host)});
      s.on('connect', () => { s.end(); process.exit(0); });
      s.on('error', () => process.exit(1));
      setTimeout(() => process.exit(1), 1500);
    `]).status !== 0);
  if (muertos.length === 0) return;
  module.exports.sinPrecondicion(
    muertos.map(([n, p]) => `${n} no contesta en ${host}:${p}`).join(' · '),
    ['export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"',
     'firebase emulators:start --only ' +
       Object.keys(puertos).join(',') + ' --project campo-fosmon-prueba',
     '',
     'Levántalos JUNTOS: con uno a medias el puerto queda tomado y el',
     'siguiente intento falla por otra razón.']);
};

// El mismo principio, para el otro modo de no arrancar.
//
// Un símbolo que cambió de nombre lo atrapa `noArranco` arriba. Lo que no
// atrapaba nadie es una excepción: el banco revienta a media extracción y Node
// sale con 1 — el MISMO código que un rojo de verdad. La suite entonces dice
// "falla" cuando lo que pasó es que la prueba no pudo mirar, y se busca una
// regresión que no existe mientras la que sí existe sigue sin comprobarse.
//
// Salió de una contraprueba: al romper la FORMA de `LEXICO` —no su nombre— el
// banco de dependencia salió 1 con 0 FALLA. Un `.catch` al final del IIFE no
// alcanza: estos bancos construyen sandboxes en el ámbito del módulo, antes de
// que el IIFE empiece. Hay que vigilar el proceso, no una promesa.
module.exports.vigilarExcepciones = function vigilarExcepciones(archivo) {
  const donde = archivo ? ' mientras leía ' + archivo : '';
  const salir = (etiqueta, e) => {
    console.log('');
    console.log('NO ARRANCÓ — la prueba reventó' + donde + ':');
    console.log('');
    console.log('  ' + etiqueta + ': ' + (e && e.stack ? e.stack : e));
    console.log('');
    console.log('Esto NO es un rojo. La conducta se quedó SIN COMPROBAR. Suele ser');
    console.log('que una declaración cambió de forma —no de nombre, de forma— y el');
    console.log('andamiaje que la extrae ya no sirve; en los bancos que usan el');
    console.log('emulador, que el emulador no está. Arreglar eso y volver a correr');
    console.log('para saber si además hay regresión.');
    process.exit(NO_ARRANCO);
  };
  process.on('uncaughtException', e => salir('excepción sin atrapar', e));
  process.on('unhandledRejection', e => salir('promesa rechazada sin atrapar', e));
};

// ── EL QUINTO MODO: UN HIJO AL QUE SE LLEVÓ EL PLAZO ───────────────────────
//
// EL DEFECTO, medido el 2026-11-14. La máquina estaba en batería al 18% y
// macOS la suspendía cada ~16 minutos. `Date.now()` cuenta el rato suspendido;
// el plazo de un `spawnSync` también, pero el hijo no corrió durante él: al
// despertar, un plazo de 180 s llevaba 1000 s vencido y el hijo murió sin
// haber hecho nada. Eso vuelve del `spawnSync` como `status: null`, `signal:
// 'SIGTERM'`, `error.code: 'ETIMEDOUT'`, y **cualquier** comparación contra un
// número sale falsa: `null === 2` es falso, `null === 0` es falso, `null === 1`
// es falso y hasta `null > 0` es falso.
//
// Así que el banco que compara publica un FALLO. Ese día
// `prueba-el-cli-que-no-contesta-deja-rastro` salió **ROJO con 7
// comprobaciones caídas** —«sale NO ARRANCÓ (2), no rojo · vio: salió null»—
// y las dos vueltas siguientes salieron verdes sin tocar nada. Es el ROJO
// FALSO del #139 otra vez: «un NO ARRANCÓ dice *no medí*, un ROJO afirma que
// hay un defecto y manda a buscarlo donde no está».
//
// LA FORMA PEOR es la de los corredores de mutaciones, que son 7 de los 12
// sitios: hacen `const vio = r.status === 1 && rojas > 0`, así que un mutante
// al que se llevó el plazo se publica como **«la mutación NO se vio»** — una
// afirmación sobre el poder de la prueba que nadie midió. El veredicto no dice
// «no pude»: dice que el banco está ciego.
//
// Por qué una puerta y no un arreglo en los doce sitios: el corredor ya sabía
// distinguir esto para SUS hijos desde el #133, y los bancos no. Dos cuentas
// del mismo número, y la que faltaba era la de los doce. El criterio vive aquí
// —`relojCreible`— y el corredor lo importa, para que no puedan discrepar.
//
// Un rebase legítimo del reloj es chico: matar el proceso y recoger su salida
// costó 12 ms sobre un plazo de 1200 en la medición del #133. El margen es
// multiplicativo con un piso, porque un plazo de 10 s y uno de 240 no toleran
// lo mismo en términos absolutos.
const relojCreible = (plazo, tardó) => tardó <= plazo * 1.25 + 10_000;
module.exports.relojCreible = relojCreible;

// Lo que se publica de una colgada. No es cosmético: cuando el reloj saltó, lo
// que NO se puede decir es un número de segundos, porque no se esperó eso.
// 901 s con un plazo de 240 manda a «súbele el plazo o arregla ese banco», y
// la verdad era «repítela con la máquina despierta». Media tarde de
// diferencia.
module.exports.frasePorNoContestar = function frasePorNoContestar(plazo, tardó) {
  return relojCreible(plazo, tardó)
    ? `sin contestar en ${Math.round(tardó / 1000)} s`
    : `no se pudo medir · el reloj saltó ${Math.round(tardó / 1000)} s ` +
      `sobre un plazo de ${Math.round(plazo / 1000)} s`;
};

// La puerta. Lanza el hijo, mide el reloj de pared, y si al hijo se lo llevó
// el plazo —o cualquier otra señal— NO devuelve nada que se pueda comparar:
// sale con 2 diciendo qué pasó.
//
// Lo que NO intercepta, a propósito: un hijo que no se pudo lanzar. `ENOENT`
// vuelve tal cual, porque varios bancos lo tratan ellos —`el-destino-se-escribe`
// manda a `npm i -g firebase-tools`, que es un diagnóstico mejor que cualquiera
// que se pueda dar desde aquí—. Tragárselo sería cambiar un mensaje útil por
// uno genérico.
//
// El plazo es obligatorio y se exige aquí: un `spawnSync` sin plazo no se
// cuelga con un veredicto equivocado, se cuelga para siempre, que es el defecto
// del #109 una planta más abajo.
module.exports.hijoConPlazo = function hijoConPlazo(cmd, args, opciones) {
  const { spawnSync } = require('child_process');
  const plazo = opciones && opciones.timeout;
  if (!Number.isFinite(plazo) || plazo <= 0) {
    console.log('');
    console.log('NO ARRANCÓ — se pidió `hijoConPlazo` sin plazo:');
    console.log('  · ' + [cmd, ...(args || [])].join(' ').slice(0, 120));
    console.log('');
    console.log('Un hijo sin plazo no se cuelga con un veredicto equivocado: se');
    console.log('cuelga para siempre, y lo que ve quien corrió la suite es una');
    console.log('terminal quieta. Poner `timeout` en las opciones.');
    process.exit(NO_ARRANCO);
  }

  const t0 = Date.now();
  const r = spawnSync(cmd, args, opciones);
  const tardó = Date.now() - t0;

  // Dos formas de que no haya veredicto, y se distinguen porque mandan a
  // sitios distintos. `spawnSync` marca el plazo vencido con
  // `error.code === 'ETIMEDOUT'`; la señal sola no alcanza para decidir,
  // porque un ^C también deja `status: null`.
  const loMatóElPlazo = !!(r.error && r.error.code === 'ETIMEDOUT');
  const loMatóOtraCosa = !loMatóElPlazo && r.status === null && !!r.signal;
  if (!loMatóElPlazo && !loMatóOtraCosa) return r;

  const qué = [cmd, ...(args || [])].join(' ');
  console.log('');
  console.log('NO ARRANCÓ — al hijo que esta prueba necesitaba no le dio tiempo:');
  console.log('  · ' + qué.slice(0, 140));
  console.log('');
  if (loMatóOtraCosa) {
    console.log(`Murió por señal ${r.signal} a los ${Math.round(tardó / 1000)} s, antes`);
    console.log('de vencer su plazo. No lo mató esta prueba.');
  } else if (relojCreible(plazo, tardó)) {
    console.log(`Se lo llevó el plazo: ${module.exports.frasePorNoContestar(plazo, tardó)},`);
    console.log(`sobre un plazo de ${Math.round(plazo / 1000)} s. El reloj cuadra, así que`);
    console.log('el hijo de verdad estuvo ese rato sin contestar: o tarda más de lo que');
    console.log('se le dio, o se quedó esperando algo que no llega.');
  } else {
    console.log(module.exports.frasePorNoContestar(plazo, tardó) + '.');
    console.log('');
    console.log('El reloj no cuadra con el plazo, y cuando no cuadran el que miente es');
    console.log('el reloj: a los ' + Math.round(plazo / 1000) + ' s el hijo ya estaba muerto, así que no');
    console.log('pudo esperar ' + Math.round(tardó / 1000) + ' s. Lo que pasó es que la máquina se');
    console.log('suspendió a mitad de la corrida y el plazo venció mientras dormía.');
    console.log('');
    console.log('Repítela despierta. `caffeinate -i` NO alcanza en batería: macOS');
    console.log('suspende igual. Enchúfala, o `caffeinate -dimsu` con corriente.');
  }
  console.log('');
  console.log('Esto NO es un rojo. El hijo no llegó a contestar, así que su código de');
  console.log('salida es `null` y comparado contra CUALQUIER número da falso — lo que');
  console.log('publicaría el banco es un defecto que nadie midió.');
  const dijo = ((r.stdout || '') + (r.stderr || '')).trim();
  if (dijo) {
    console.log('');
    console.log('Lo último que alcanzó a decir:');
    for (const l of dijo.split('\n').slice(-8)) console.log('  ' + l.slice(0, 160));
  }
  process.exit(NO_ARRANCO);
};

// ── LA PUERTA QUE NO EXISTE ────────────────────────────────────────────────
//
// Las cuatro puertas de arriba se piden destructurando: `const {
// sinPrecondicion } = require('./no-arranco.cjs')`. 129 sitios lo hacen hoy.
// Si el nombre se escribe mal, o se renombra aquí, el destructurado deja
// `undefined` y nada pasa: la llamada sólo revienta **cuando la precondición
// falla**, o sea exactamente el día en que la puerta hacía falta. Hasta
// entonces el banco sale verde SIN SU TERCER ESTADO, y el NO ARRANCÓ (2) queda
// degradado en silencio a 0.
//
// Es la clase peor de todas las que hay en este repo: el andamio de las pruebas
// fallando HACIA EL VERDE. Los cinco sitios que estaban mal se corrigieron en su
// día uno por uno; nada impedía el sexto, y eso es lo que impide esto.
//
// Se contesta en el momento del destructurado, que es cuando se puede señalar
// el renglón, y se contesta con el código 2 directo en vez de lanzando: lanzar
// sale con 1 —el mismo código que un rojo— porque a esta altura del archivo
// `vigilarExcepciones` todavía no está puesta; y aunque lo estuviera, el banco
// que pide una puerta inexistente no tiene con qué reportar que no pudo mirar.
// Lo que no puede pasar es que la respuesta sea `undefined`.
//
// Pasan sin preguntas los símbolos, lo que hereda de `Function` y un puñado de
// nombres que pregunta el MOTOR y que ningún banco escribe: `then` cuando algo
// se awaitea, `toJSON` cuando algo se serializa, `inspect` cuando se imprime,
// `default`/`__esModule` si alguien lo importa desde un módulo ESM. Esos los
// pregunta la máquina, no una persona, y matar el proceso ahí sería cambiar un
// defecto por otro peor: un banco que muere al imprimir un diagnóstico.
//
// El primer intento dejó `toJSON` fuera y el propio banco de este guardia lo
// puso en rojo con un `JSON.stringify`. Vale escribirlo: la lista se midió, no
// se adivinó.
const DEL_MOTOR = new Set(['then', 'toJSON', 'inspect', 'default', '__esModule',
  'constructor', 'valueOf', 'toString']);
// `length`, `name` y `prototype` son propias de cualquier función, no puertas:
// se dejan pasar por el camino de siempre, pero no se anuncian como opciones.
const PUERTAS = Object.getOwnPropertyNames(module.exports)
  .filter(n => !['length', 'name', 'prototype'].includes(n));

module.exports = new Proxy(module.exports, {
  get(destino, prop, recibidor) {
    if (typeof prop === 'symbol' || prop in Function.prototype || DEL_MOTOR.has(prop))
      return Reflect.get(destino, prop, recibidor);
    if (Object.prototype.hasOwnProperty.call(destino, prop))
      return Reflect.get(destino, prop, recibidor);
    console.log('');
    console.log('NO ARRANCÓ — un banco pidió a `no-arranco.cjs` una puerta que no');
    console.log('existe: `' + String(prop) + '`.');
    console.log('');
    console.log('Las que hay son: ' + PUERTAS.map(n => '`' + n + '`').join(', ') + ',');
    console.log('más la función del módulo misma.');
    console.log('');
    console.log('Esto NO es un rojo, y tampoco se podía dejar pasar: un destructurado');
    console.log('que deja `undefined` no revienta hoy, revienta el día que la');
    console.log('precondición falle, que es el único día en que esa puerta servía de');
    console.log('algo. Hasta entonces el banco sale VERDE sin su tercer estado.');
    console.log('');
    console.log('Buscar el nombre bien escrito arriba y apuntar el `require` a él.');
    process.exit(NO_ARRANCO);
  },
});
