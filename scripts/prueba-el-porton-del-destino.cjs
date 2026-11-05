#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL PORTÓN DEL DESTINO SE PARA CUANDO TIENE QUE PARARSE
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. `scripts/destino.cjs` es la tapa del botón: decide si un
// guion apunta al emulador o a producción y si escribe o ensaya. Nació después
// del 2026-10-09, cuando correr la migración de evidencia sin `EMU_HOST`
// escribió 270 documentos en producción. Siete guiones lo usan y NINGUNO lo
// medía: la tapa misma no tenía prueba.
//
// Lo que se afirma es CONDUCTA —con qué salida termina el proceso y qué frase
// alcanza a leer quien se equivocó—, nunca que exista un nombre. Cada caso
// EJECUTA el módulo real en un proceso aparte, con su `argv` y su entorno.
//
// Lo que más importa que esté medido no es el camino feliz sino los tres que
// PARAN, porque un portón que deja de parar no se nota: el guion simplemente
// corre, y lo que hay del otro lado es producción.
//
// Uso:  node scripts/prueba-el-porton-del-destino.cjs
//       node scripts/prueba-el-porton-del-destino.cjs --contraprueba

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const MODULO = path.join(__dirname, 'destino.cjs');
const FUENTE = fs.readFileSync(MODULO, 'utf8');

const fallos = [];
const check = (cond, m, detalle = '') => {
  if (cond) console.log(`   ✓ ${m}${detalle ? ` (${detalle})` : ''}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${detalle ? ` (${detalle})` : ''}`); }
};
const sec = (t) => console.log(`\n${t}`);

// Corre el portón de verdad, en un proceso aparte, con el `argv` y el entorno
// que se le den. `fuente` permite correr una versión MUTADA del módulo: eso es
// lo que usa la contraprueba.
// El invocador se escribe a un ARCHIVO temporal en vez de pasarse por `node
// -e`: con `-e`, Node se queda él mismo con los argumentos que empiezan por
// `--` y nunca llegan a `process.argv` del guion. El banco salía 9 («invalid
// argument» de Node) en todos los casos que llevaban `--prod`, y 9 no es
// ninguno de los tres estados — habría sido un rojo que no mide nada.
function correrPorton(args, env = {}, opciones = {}, fuente = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'porton-'));
  let modulo = MODULO;
  if (fuente !== null) {
    modulo = path.join(dir, 'destino.cjs');
    fs.writeFileSync(modulo, fuente);
  }
  const invocador = path.join(dir, 'invocador.cjs');
  fs.writeFileSync(invocador, `
    const { resolverDestino } = require(${JSON.stringify(modulo)});
    const d = resolverDestino(${JSON.stringify(opciones)});
    console.log('RESUELTO ' + JSON.stringify(d));
  `);

  // El entorno se arma desde cero en lo que toca a las variables de emulador:
  // heredar un `FIRESTORE_EMULATOR_HOST` de la terminal de quien corre la suite
  // cambiaría la respuesta del portón y el banco mediría otra cosa.
  const limpio = { ...process.env };
  delete limpio.FIRESTORE_EMULATOR_HOST;
  delete limpio.FIREBASE_AUTH_EMULATOR_HOST;
  delete limpio.EMU_HOST;

  const r = spawnSync(process.execPath, [invocador, ...args],
    { encoding: 'utf8', env: { ...limpio, ...env } });
  fs.rmSync(dir, { recursive: true, force: true });

  const salida = `${r.stdout || ''}${r.stderr || ''}`;
  const linea = (salida.match(/RESUELTO (.*)/) || [])[1];
  return { codigo: r.status, salida, resuelto: linea ? JSON.parse(linea) : null };
}

const EMU = { EMU_HOST: '127.0.0.1:8080' };

// ── La medición, en una función para poder repetirla contra una mutación ────
function medir(fuente = null) {
  const antes = fallos.length;

  sec('1. Sin destino escrito, el portón para — y no elige por nadie');
  {
    const r = correrPorton([], {}, {}, fuente);
    check(r.codigo === 2,
      'sale con 2 (NO ARRANCÓ), no con 0 ni con 1', `salió ${r.codigo}`);
    check(/No hay destino/.test(r.salida),
      'y lo dice con todas sus letras');
    check(r.resuelto === null,
      'no devuelve ningún destino: pararse es no entregar uno');
    // El motivo, no sólo la regla: quien se equivocó tiene que entender por qué
    // existe el portón o lo va a rodear.
    check(/270/.test(r.salida),
      'y nombra el incidente que lo costó, para que no se lea como burocracia');
  }

  sec('2. Dos destinos a la vez tampoco se adivinan');
  {
    const r = correrPorton(['--prod'], EMU, {}, fuente);
    check(r.codigo === 2, 'sale con 2', `salió ${r.codigo}`);
    check(/no voy a adivinar/i.test(r.salida),
      'y se niega a elegir entre `--prod` y el emulador apuntado');
  }

  sec('3. Lo que escribe en producción lo anuncia como lo que es');
  {
    const r = correrPorton(['--prod', '--escribir'],
      {}, { escribe: 'reescribe los claims de todos' }, fuente);
    check(r.codigo === 0, 'deja pasar: está pedido de las dos formas', `salió ${r.codigo}`);
    check(/PRODUCCIÓN/.test(r.salida) && /ESCRITURA/.test(r.salida),
      'nombra el destino y el modo, los dos');
    check(/OK explícito/.test(r.salida),
      'y avisa que esto es de lo que necesita autorización');
    check(r.resuelto?.prod === true && r.resuelto?.escribir === true,
      'y lo devuelve así, para que el guion no tenga que re-leer `argv`');
  }

  sec('4. Producción sin `--escribir` es ensayo, y lo dice');
  {
    const r = correrPorton(['--prod'], {}, {}, fuente);
    check(r.codigo === 0, 'deja pasar', `salió ${r.codigo}`);
    check(/ensayo/.test(r.salida) && !/ESCRITURA/.test(r.salida),
      'anuncia ensayo y NO anuncia escritura');
    check(r.resuelto?.escribir === false,
      'y el guion recibe `escribir: false`');
  }

  // ── Lo nuevo: los guiones que no pueden escribir ──────────────────────────
  // Antes del 2026-11-05 un guion de sólo lectura tenía dos salidas y las dos
  // malas: pasar por el portón y anunciar «agrega `--escribir` para aplicar»
  // —cuando no hay nada que aplicar, y eso enseña a teclear la bandera— o
  // saltarse el portón y deducir el destino, que es el hábito del incidente.
  sec('5. A un guion que sólo lee, el portón no le ofrece escribir');
  {
    const r = correrPorton(['--prod'], {}, { soloLectura: true }, fuente);
    check(r.codigo === 0, 'deja pasar', `salió ${r.codigo}`);
    check(/SÓLO LECTURA/.test(r.salida),
      'anuncia el modo por su nombre');
    check(!/--escribir/.test(r.salida),
      'y NO le enseña la bandera `--escribir` a quien no puede usarla');
    check(/PRODUCCIÓN/.test(r.salida),
      'pero el destino se sigue anunciando: sólo leer no es no apuntar');
  }

  sec('6. Y si se la teclean de todos modos, para: no la ignora');
  {
    const r = correrPorton(['--prod', '--escribir'], {}, { soloLectura: true }, fuente);
    check(r.codigo === 2,
      'sale con 2 en vez de correr como si nada', `salió ${r.codigo}`);
    check(/sólo lee/.test(r.salida),
      'y explica que el guion no tiene con qué escribir');
    check(r.resuelto === null,
      'no devuelve destino: la petición no se puede cumplir, no se cumple a medias');
  }

  sec('7. El texto de ayuda enseña exactamente las banderas que sirven');
  {
    // Sin destino, el portón imprime las formas de invocarlo. Para un guion que
    // escribe son dos renglones; para uno que sólo lee, uno. Ofrecer el que no
    // sirve es el mismo defecto que la sección 5, en el mensaje de error.
    const escribe = correrPorton([], {}, {}, fuente);
    const lee = correrPorton([], {}, { soloLectura: true }, fuente);
    check(/--prod --escribir/.test(escribe.salida),
      'al que escribe le ofrece `--prod --escribir`');
    check(!/--prod --escribir/.test(lee.salida),
      'y al que sólo lee no se lo ofrece');
    check(/sólo lee/.test(lee.salida),
      'le dice en cambio que con `--prod` alcanza');
  }

  sec('8. El emulador apuntado se reconoce por cualquiera de sus tres nombres');
  {
    for (const v of ['EMU_HOST', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      const r = correrPorton([], { [v]: '127.0.0.1:8080' }, {}, fuente);
      check(r.codigo === 0 && /DESTINO: emulador/.test(r.salida),
        `\`${v}\` cuenta como destino`, `salió ${r.codigo}`);
    }
    const r = correrPorton([], EMU, {}, fuente);
    check(r.resuelto?.prod === false,
      'y con el emulador apuntado `prod` es false, nunca «no sé»');
  }

  return fallos.length - antes;
}

// ── Contraprueba ────────────────────────────────────────────────────────────
// Rompe la SEMÁNTICA del portón, no su andamiaje: cada mutación es una forma
// plausible de relajarlo —la clase de cambio que alguien hace con prisa— y
// todas tienen que dejar este banco en ROJO.
const MUTACIONES = [
  ['el portón deja pasar cuando no hay destino',
   s => s.replace('if (!emulador && !prod) parar(', 'if (false) parar(')],
  ['elige producción por omisión, como antes del incidente',
   s => s.replace('const prod = args.includes(\'--prod\');',
                  'const prod = true;')],
  ['acepta `--prod` y emulador a la vez, quedándose con producción',
   s => s.replace('if (emulador && prod) parar(', 'if (false) parar(')],
  ['ignora `--escribir` en un guion de sólo lectura en vez de pararse',
   s => s.replace('if (soloLectura && escribir) parar(', 'if (false) parar(')],
  ['le ofrece `--escribir` a un guion que sólo lee',
   s => s.replace('...(soloLectura ? [] :', '...(false ? [] :')],
  ['deja de avisar que escribir en producción necesita un OK',
   s => s.replace('if (prod && escribir) console.log(', 'if (false) console.log(')],
  ['devuelve un destino aunque haya parado',
   s => s.replace('process.exit(SALIDA_SIN_DESTINO);', '')],
];

if (process.argv.includes('--contraprueba')) {
  console.log('\nCONTRAPRUEBA — cada mutación tiene que poner el banco en ROJO\n');
  const silencio = console.log;
  let rojas = 0;
  MUTACIONES.forEach(([nombre, muta], i) => {
    const mutada = muta(FUENTE);
    if (mutada === FUENTE) {
      silencio(`${String(i + 1).padStart(2)}. NO ARRANCÓ: no halló su anclaje — ${nombre}`);
      process.exitCode = 2;
      return;
    }
    fallos.length = 0;
    console.log = () => {};
    const nuevos = medir(mutada);
    console.log = silencio;
    if (nuevos > 0) { rojas++; console.log(`${String(i + 1).padStart(2)}. ✓ ROJO (${nuevos}) — ${nombre}`); }
    else console.log(`${String(i + 1).padStart(2)}. ✗ PASÓ — ${nombre}`);
  });
  console.log(`\n${rojas} ✓ ROJO / ${MUTACIONES.length - rojas} ✗ PASÓ\n`);
  process.exit(rojas === MUTACIONES.length && !process.exitCode ? 0 : 1);
}

console.log('\nEl portón del destino');
console.log(`Módulo: ${path.relative(path.join(__dirname, '..'), MODULO)}`);
medir();

console.log('');
if (fallos.length === 0) {
  console.log('VERDE — la tapa del botón sigue puesta.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
