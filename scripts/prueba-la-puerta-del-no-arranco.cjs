#!/usr/bin/env node
// Prueba: PEDIR UNA PUERTA QUE NO EXISTE NO SALE VERDE.  (#132)
//
// Los 129 sitios que piden el tercer estado lo piden destructurando:
// `const { sinPrecondicion } = require('./no-arranco.cjs')`. El módulo exporta
// una FUNCIÓN con propiedades, así que un nombre mal escrito no revienta el
// require: deja `undefined`, y la llamada falla sólo **cuando la precondición
// falla** — el único día en que esa puerta servía de algo. Hasta entonces el
// banco sale verde sin su tercer estado, y el NO ARRANCÓ (2) queda degradado en
// silencio a 0.
//
// Cinco sitios estuvieron así y se corrigieron uno por uno. Lo que se mide aquí
// es que el sexto ya no pueda.
//
// CÓMO SE MIDE. No se afirma que exista ningún `Proxy` ni ningún nombre: se
// escriben bancos de mentira en /tmp, se corren en procesos hijos de verdad, y
// se mira el CÓDIGO DE SALIDA y lo que imprimieron. Un banco que pide una
// puerta buena tiene que seguir corriendo igual; uno que pide una inventada
// tiene que salir 2 y decir cuál pidió. Es la única forma de medirlo: la
// conducta entera es «qué le pasa al proceso», y eso no se ve desde dentro.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
//   node scripts/prueba-la-puerta-del-no-arranco.cjs --contraprueba
// Corre este banco contra copias mutiladas de `no-arranco.cjs` y exige que cada
// una lo ponga en ROJO (1), nunca en NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-la-puerta-del-no-arranco.cjs [archivo]

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const ORIGINAL = path.join(__dirname, 'no-arranco.cjs');
const esContraprueba = process.argv[2] === '--contraprueba';
const MODULO = esContraprueba ? ORIGINAL : (process.argv[2] || ORIGINAL);

// Ojo con el orden: este banco mide `no-arranco.cjs`, así que no puede fiarse
// de él para su propio tercer estado cuando lo que se está midiendo es
// precisamente la copia mutilada. Se requiere el del REPO, siempre, y por ruta
// absoluta — nunca el `MODULO` que puede venir mutilado por argumento.
const noArranco = require(path.join(__dirname, 'no-arranco.cjs'));
noArranco.vigilarExcepciones(path.relative(raiz, MODULO));

if (!fs.existsSync(MODULO)) noArranco.sinPrecondicion(
  `no existe ${MODULO}`, ['Pasar la ruta de un `no-arranco.cjs` que exista.']);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Un banco de mentira, en un proceso de verdad ───────────────────────────
//
// El cuerpo se escribe a un archivo y se corre con el `node` de esta misma
// corrida. Importa que sea un hijo y no un `vm`: lo que se mide es el código de
// salida del PROCESO, que es lo que la suite lee para clasificar en los tres
// estados, y un `vm` no tiene código de salida.
let n = 0;
const correr = (cuerpo) => {
  const archivo = path.join(os.tmpdir(),
    `banco-de-mentira-${process.pid}-${n++}.cjs`);
  fs.writeFileSync(archivo, `const MOD = ${JSON.stringify(MODULO)};\n${cuerpo}\n`);
  try {
    // Por la puerta del módulo del REPO, igual que `vigilarExcepciones` y por
    // la misma razón de arriba: nunca por el `MODULO` que puede venir mutilado.
    // Un hijo al que se lleve el plazo deja `status: null`, y `null` comparado
    // contra los códigos de abajo da falso en todos — o sea un FALLA publicado
    // sobre un banco de mentira que no llegó a correr.
    const r = noArranco.hijoConPlazo(process.execPath, [archivo],
      { encoding: 'utf8', timeout: 20000 });
    return { estado: r.status, salida: (r.stdout || '') + (r.stderr || '') };
  } finally { fs.unlinkSync(archivo); }
};

console.log('1. Las puertas que SÍ existen se siguen pudiendo pedir');

// Si esto se rompiera, los 129 bancos dejarían de arrancar a la vez, así que se
// mide primero: un guardia que cierra la puerta buena es peor que no tenerlo.
const buenas = correr(`
  const { sinPrecondicion, vigilarExcepciones, exigirPuertos, NO_ARRANCO } = require(MOD);
  const mod = require(MOD);
  if (typeof sinPrecondicion !== 'function') { console.log('sinPrecondicion no es función'); process.exit(7); }
  if (typeof vigilarExcepciones !== 'function') { console.log('vigilarExcepciones no es función'); process.exit(7); }
  if (typeof exigirPuertos !== 'function') { console.log('exigirPuertos no es función'); process.exit(7); }
  if (NO_ARRANCO !== 2) { console.log('NO_ARRANCO vale ' + NO_ARRANCO); process.exit(7); }
  if (typeof mod !== 'function') { console.log('el módulo dejó de ser función'); process.exit(7); }
  console.log('CUATRO PUERTAS ABIERTAS');
  process.exit(0);`);
check(buenas.estado === 0 && /CUATRO PUERTAS ABIERTAS/.test(buenas.salida),
  'las cuatro puertas y la función del módulo llegan enteras',
  buenas.estado === 0 ? 'salida 0' : `salida ${buenas.estado} · ${buenas.salida.trim().split('\n').pop()}`);

// El motor pregunta por cosas que nadie escribió: `util.inspect` recorre el
// objeto, un `await` por accidente busca `then`. Contestarle a eso con una
// salida del proceso sería cambiar un defecto por otro, y éste se vería como un
// banco que muere al imprimir un mensaje de diagnóstico.
const motor = correr(`
  const mod = require(MOD);
  require('util').inspect(mod);
  JSON.stringify({ mod });
  Object.prototype.toString.call(mod);
  mod.name; mod.length;
  (async () => { await mod; console.log('EL MOTOR PREGUNTÓ Y NADIE SE MURIÓ'); process.exit(0); })();`);
check(motor.estado === 0 && /NADIE SE MURIÓ/.test(motor.salida),
  'y lo que pregunta el motor —`inspect`, `then`, `name`— pasa sin matar a nadie',
  motor.estado === 0 ? 'salida 0' : `salida ${motor.estado} · ${motor.salida.trim().slice(-120)}`);

console.log('\n2. Pedir una puerta que no existe sale 2, no 0');

// EL CASO. `sinPrecondicon` sin la `i`: el error real que estuvo cinco veces
// en el repo. El banco de mentira hace después todo lo que haría un banco
// verdadero —comprobar algo cierto e imprimir «todo verde»—, que es justo lo
// que pasaba antes: salía 0 con la puerta tapiada.
const typo = correr(`
  const { sinPrecondicon } = require(MOD);
  console.log('todo verde');
  process.exit(0);`);
check(typo.estado === 2,
  'un nombre mal escrito contesta con el tercer estado (2) en el destructurado',
  `salida ${typo.estado}`);
check(!/todo verde/.test(typo.salida),
  'y el banco no alcanza a publicar su verde: se para donde lo pidió',
  /todo verde/.test(typo.salida) ? 'IMPRIMIÓ SU VERDE' : 'no llegó a imprimirlo');
check(/sinPrecondicon/.test(typo.salida),
  'el mensaje dice QUÉ puerta pidió, que es lo que hace falta para corregirlo',
  typo.salida.split('\n').filter(l => /sinPrecondicon/.test(l))[0] || 'no la nombró');
check(/sinPrecondicion/.test(typo.salida) && /exigirPuertos/.test(typo.salida),
  'y dice cuáles hay, para no mandar a nadie a leer el módulo',
  'lista publicada');
check(!/`length`|`prototype`/.test(typo.salida),
  'sin anunciar como puertas las propiedades que tiene cualquier función',
  /`length`/.test(typo.salida) ? 'anunció `length`' : 'sólo las cuatro');

// La forma que importa de verdad: no un typo, sino un RENOMBRE aquí. El banco
// escribe bien lo que creía que se llamaba la puerta, y el módulo ya no la
// tiene. Es el mismo hueco por el otro lado, y es el que nadie va a escribir a
// propósito.
const renombrada = correr(`
  const { avisarQueNoSePudoMirar } = require(MOD);
  avisarQueNoSePudoMirar && avisarQueNoSePudoMirar('x');
  console.log('todo verde');
  process.exit(0);`);
check(renombrada.estado === 2 && !/todo verde/.test(renombrada.salida),
  'una puerta que se renombró en el módulo falla igual, no sólo los typos',
  `salida ${renombrada.estado}`);

// Y el caso que distingue este guardia de un `throw`: salir con 1 sería
// indistinguible de un rojo, y la suite buscaría una regresión que no existe.
check(typo.estado !== 1 && renombrada.estado !== 1,
  'ninguno de los dos sale con 1 — eso se leería como una regresión que no hubo',
  `typo ${typo.estado} · renombre ${renombrada.estado}`);

console.log('\n3. Las puertas siguen funcionando cuando se usan');

// Que el guardia no haya roto la conducta de las puertas mismas. Se ejercitan
// las dos que terminan el proceso, y se exige el 2.
const usandoSinPrecondicion = correr(`
  const { sinPrecondicion } = require(MOD);
  sinPrecondicion('falta un volcado', ['bajarlo primero']);
  console.log('todo verde');`);
check(usandoSinPrecondicion.estado === 2
      && /falta un volcado/.test(usandoSinPrecondicion.salida)
      && !/todo verde/.test(usandoSinPrecondicion.salida),
  '`sinPrecondicion` sigue saliendo con 2 y diciendo qué falta',
  `salida ${usandoSinPrecondicion.estado}`);

const usandoNoArranco = correr(`
  const noArranco = require(MOD);
  noArranco(['unSimboloQueYaNoEsta'], 'src/App.jsx');
  console.log('todo verde');`);
check(usandoNoArranco.estado === 2
      && /unSimboloQueYaNoEsta/.test(usandoNoArranco.salida),
  'y la función del módulo también, con el nombre del símbolo perdido',
  `salida ${usandoNoArranco.estado}`);

const usandoVigilar = correr(`
  const { vigilarExcepciones } = require(MOD);
  vigilarExcepciones('src/App.jsx');
  Promise.reject(new Error('reventó a media extracción'));`);
check(usandoVigilar.estado === 2 && /reventó a media extracción/.test(usandoVigilar.salida),
  '`vigilarExcepciones` sigue convirtiendo una promesa rechazada en 2',
  `salida ${usandoVigilar.estado}`);

console.log('\n4. El huso se sigue fijando al cargar');

// `no-arranco.cjs` requiere `reloj.cjs` por efecto de carga, y es el único
// módulo que los bancos requieren antes de construir una fecha. Envolver el
// export en otra cosa no puede haber movido eso de sitio.
const huso = correr(`
  delete process.env.TZ;
  require(MOD);
  console.log('TZ=' + process.env.TZ);
  process.exit(0);`);
check(huso.estado === 0 && /TZ=America\/Mexico_City/.test(huso.salida),
  'requerir el módulo sigue fijando `TZ`, que es de lo que cuelgan las fechas',
  huso.salida.trim().split('\n').pop());

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);

if (!esContraprueba) process.exit(fallas > 0 ? 1 : 0);

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación rompe el guardia de una forma distinta y las dos cosas que se
// exigen son: que el banco salga ROJO (1) y que NO salga NO ARRANCÓ (2). Un 2
// aquí querría decir que la mutación tiró el andamiaje en vez de la conducta, y
// entonces la mutación no prueba nada.
if (fallas > 0) {
  console.log('\nLa contraprueba no corre: el banco ya está en rojo sin mutar nada.');
  process.exit(1);
}

const src = fs.readFileSync(ORIGINAL, 'utf8');
const MUTACIONES = [
  ['no hay guardia: el destructurado vuelve a dejar `undefined`',
   'module.exports = new Proxy(module.exports, {', 'module.exports = (x => x)({'],
  ['el guardia avisa pero sale con 1, que se lee como un rojo',
   '    process.exit(NO_ARRANCO);\n  },\n});', '    process.exit(1);\n  },\n});'],
  ['el guardia no dice qué puerta se pidió',
   "    console.log('NO ARRANCÓ — un banco pidió a `no-arranco.cjs` una puerta que no');\n"
   + "    console.log('existe: `' + String(prop) + '`.');",
   "    console.log('NO ARRANCÓ — algo salió mal.');"],
  ['el guardia tapia también las puertas buenas',
   '    if (Object.prototype.hasOwnProperty.call(destino, prop))\n'
   + '      return Reflect.get(destino, prop, recibidor);',
   ''],
  ['el guardia contesta al motor con una salida del proceso',
   "    if (typeof prop === 'symbol' || prop in Function.prototype || DEL_MOTOR.has(prop))\n"
   + '      return Reflect.get(destino, prop, recibidor);',
   ''],
  // La que encontró el defecto de verdad la primera vez: `toJSON` no está en
  // `Function.prototype`, así que sin la lista propia un `JSON.stringify` sobre
  // el módulo mata al banco que lo serializa.
  ['`toJSON` se cae de la lista del motor',
   "['then', 'toJSON', 'inspect'", "['then', 'inspect'"],
  ['el envoltorio se come el `require` del reloj',
   "require('./reloj.cjs');", ''],
];

let mutantesVivos = 0;
let noArrancaron = 0;
for (const [titulo, de, a] of MUTACIONES) {
  console.log(`\n── ${titulo} ──`);
  if (!src.includes(de)) {
    console.log('  la contraprueba dejó de apuntar: el texto que mutaba ya no está.');
    mutantesVivos++;
    continue;
  }
  const mutado = src.replace(de, a);
  if (mutado === src) {
    console.log('  la sustitución no cambió nada: el mutante no ocurrió.');
    mutantesVivos++;
    continue;
  }
  const destino = path.join(os.tmpdir(), `no-arranco.mutado-${process.pid}-${n++}.cjs`);
  // El mutante tiene que poder requerir `./reloj.cjs`, que está junto al
  // original. Se escribe AL LADO, no en /tmp, y se borra después.
  const alLado = path.join(__dirname, path.basename(destino));
  fs.writeFileSync(alLado, mutado);
  let r;
  try {
    // Por la puerta del repo: un mutante al que se lleve el plazo caería en el
    // `rojos === 0 || r.status !== 1` de abajo y se publicaría como MUTANTE
    // VIVO, que es una afirmación sobre el poder de este banco que nadie midió.
    r = noArranco.hijoConPlazo(process.execPath, [__filename, alLado],
      { encoding: 'utf8', timeout: 120000 });
  } finally { fs.unlinkSync(alLado); }
  const rojos = ((r.stdout || '').match(/^FALLA/gm) || []).length;
  if (r.status === 2) {
    console.log(`  NO ARRANCÓ (2): la mutación tiró el andamiaje, no la conducta.`);
    noArrancaron++;
  } else if (rojos === 0 || r.status !== 1) {
    console.log(`  MUTANTE VIVO: salida ${r.status}, ${rojos} en rojo.`);
    mutantesVivos++;
  } else {
    console.log(`  correcta: salida 1, ${rojos} comprobación(es) en rojo.`);
  }
}

console.log('');
if (mutantesVivos === 0 && noArrancaron === 0) {
  console.log(`Contraprueba correcta: las ${MUTACIONES.length} formas de romper el guardia`);
  console.log('se miran por separado, y ninguna pasa por verde.');
  process.exit(0);
}
console.log(`Contraprueba floja: ${mutantesVivos} mutante(s) vivo(s)`
  + `, ${noArrancaron} que no arrancaron.`);
process.exit(1);
