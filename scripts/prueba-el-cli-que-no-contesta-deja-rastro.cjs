#!/usr/bin/env node
// Guarda de #97: cuando el `firebase` de la línea de comandos no contesta, el
// informe tiene que dejar con qué averiguar por qué.
//
// EL DEFECTO. `prueba-el-destino-se-escribe` §7 le pregunta al CLI a dónde
// desplegaría si nadie le dice, y ya clasificaba bien: un CLI que no contesta
// es NO ARRANCÓ (2), no rojo. Lo que no hacía era dejar rastro. Repetía la
// frase genérica del CLI —«An unexpected error has occurred»— y nada más. El
// 2026-11-04 la suite salió con 1 por eso y la corrida siguiente dio 83 en
// verde sin tocar nada: media hora que acabó en «volví a correrla y pasó», que
// es justo lo que el acuerdo prohíbe. No se reproduce en aislamiento, así que
// la información hay que recogerla EN EL MOMENTO.
//
// LO QUE SE AFIRMA AQUÍ no es que exista una función de diagnóstico: es qué
// sale impreso cuando el CLI no contesta. Se corre el banco de verdad como
// proceso hijo con un `firebase` postizo delante en el PATH, y se lee su
// salida. El postizo es la única manera de provocar la avería: el CLI real
// contesta —ése es el problema, que casi siempre contesta—.
//
// LA MITAD QUE MÁS IMPORTA es la sección 2. El diagnóstico vuelve a preguntar,
// y un reintento que decidiera el veredicto sería convertir «si falla y luego
// pasa, no quedó» en «volvé a correrla». Así que se exige explícitamente que
// con la segunda pregunta contestada el banco SIGA saliendo con 2.
//
// Uso:  node scripts/prueba-el-cli-que-no-contesta-deja-rastro.cjs

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const raiz = path.resolve(__dirname, '..');
const BANCO = path.join(__dirname, 'prueba-el-destino-se-escribe.cjs');

const fallos = [];
const check = (cond, m, visto) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${visto ? `  ·  vio: ${visto}` : ''}`); }
};

// ── El `firebase` postizo ──────────────────────────────────────────────────
//
// Cada escenario es un guion de shell que imita una forma distinta de no
// contestar. Se ponen en un directorio propio y ese directorio va DELANTE del
// PATH que recibe el hijo: así el banco llama a `firebase` como siempre, sin
// una sola bandera de prueba en su código. Un banco que hubiera que avisar de
// que lo están midiendo mide otra cosa.
const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-postizo-'));
const postizo = (nombre, cuerpo) => {
  const dir = path.join(taller, nombre);
  fs.mkdirSync(dir);
  const f = path.join(dir, 'firebase');
  fs.writeFileSync(f, `#!/bin/sh\n${cuerpo}\n`);
  fs.chmodSync(f, 0o755);
  return dir;
};

const correr = (dir) => {
  const r = spawnSync(process.execPath, [BANCO], {
    encoding: 'utf8', cwd: raiz, timeout: 180000,
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  return { salida: r.status, texto: (r.stdout || '') + (r.stderr || '') };
};

// El postizo que escribe el log lo deja en el cwd, igual que el CLI de verdad,
// o sea dentro del repositorio. Está en `.gitignore`, pero dejarlo tirado es
// ensuciar el árbol con basura de una prueba.
const LOG_EN_RAIZ = path.join(raiz, 'firebase-debug.log');
const limpiar = () => { try { fs.unlinkSync(LOG_EN_RAIZ); } catch { /* no estaba */ } };
process.on('exit', limpiar);

// ── 1. No contesta ninguna de las dos veces, y `--debug` deja log ──────────
console.log('\n1. El CLI no contesta y `--debug` sí escribe su log');
{
  limpiar();
  const dir = postizo('muere-con-log', `
for a in "$@"; do
  if [ "$a" = "--debug" ]; then
    printf '[debug] cli.js arrancó\\n[debug] leyendo configstore\\n[error] MARCA-DEL-LOG: configstore tomado\\n' > firebase-debug.log
  fi
done
echo "Error: An unexpected error has occurred." >&2
exit 2`);
  const { salida, texto } = correr(dir);

  check(salida === noArranco.NO_ARRANCO,
    `sale NO ARRANCÓ (2), no rojo`, `salió ${salida}`);
  check(/Se volvió a preguntar con `--debug`/.test(texto),
    'dice que volvió a preguntar, en vez de callar el segundo intento');
  check(/MARCA-DEL-LOG: configstore tomado/.test(texto),
    'pega las últimas líneas del log que dejó `--debug`');
  const guardado = /Log completo guardado en (\S+)/.exec(texto);
  check(guardado && fs.existsSync(guardado[1]),
    'y guarda el log entero fuera del repositorio, donde la corrida siguiente no lo pisa',
    guardado ? `dijo ${guardado[1]} y no está` : 'no dijo dónde');
  check(/procesos? `firebase` vivos|ningún otro proceso `firebase`/.test(texto),
    'dice qué otros `firebase` había vivos — la hipótesis que trae escrita el banco');
  check(/Configstore: /.test(texto),
    'y si el configstore existía y de cuándo era');
  // Que no se pierda lo que ya hacía bien.
  check(/An unexpected error has occurred/.test(texto),
    'sigue pegando lo que dijo el CLI la primera vez');
}

// ── 2. La segunda vez SÍ contesta ──────────────────────────────────────────
//
// Ésta es la que impide que el diagnóstico se vuelva un reintento. Que la
// segunda pregunta ande no absuelve a la primera: el banco no midió nada.
console.log('\n2. La segunda pregunta contesta, y aun así no se da por bueno');
{
  limpiar();
  const dir = postizo('intermitente', `
for a in "$@"; do
  if [ "$a" = "--debug" ]; then
    echo "Error: No project active, but project aliases are available."
    echo "produccion (campo-fosmon)"
    echo "prueba (campo-fosmon-prueba)"
    exit 1
  fi
done
echo "Error: An unexpected error has occurred." >&2
exit 2`);
  const { salida, texto } = correr(dir);

  check(salida === noArranco.NO_ARRANCO,
    'SIGUE saliendo NO ARRANCÓ (2) aunque el segundo intento anduviera',
    `salió ${salida}`);
  check(/ESTA VEZ SÍ CONTESTÓ/.test(texto),
    'y lo dice: que el fallo no se repita a los dos segundos es el dato más útil');
  check(!/26 comprobación\(es\) en verde/.test(texto),
    'no publica las comprobaciones de la sección como si se hubieran hecho');
}

// ── 3. Contesta a la primera: ni rastro ni segunda pregunta ────────────────
//
// El coste del diagnóstico no puede caer sobre el camino bueno, que es el que
// corre 124 veces al día. Y de paso: con un CLI que contesta «no hay proyecto
// activo» y nombra los dos alias, el banco llega entero a sus aserciones y
// sale verde — o sea que el postizo no está tapando la medición.
console.log('\n3. Cuando contesta a la primera, no se vuelve a preguntar');
{
  limpiar();
  const dir = postizo('contesta', `
echo "Error: No project active, but project aliases are available."
echo "produccion (campo-fosmon)"
echo "prueba (campo-fosmon-prueba)"
exit 1`);
  const { salida, texto } = correr(dir);

  check(salida === 0, 'el banco sale verde', `salió ${salida}`);
  check(!/Se volvió a preguntar/.test(texto),
    'y no gasta una segunda llamada al CLI en el camino bueno');
  check(!fs.existsSync(LOG_EN_RAIZ),
    'ni deja un `firebase-debug.log` tirado en la raíz del repositorio');
}

// ── 4. El CLI no está ──────────────────────────────────────────────────────
//
// El modo que el banco ya contemplaba antes del #97. Se mide para que arreglar
// el rastro no lo haya tapado: un PATH sin `firebase` tiene que seguir
// diciendo cómo instalarlo, no pegar un log que no existe.
console.log('\n4. Sin `firebase` instalado, el mensaje sigue siendo el de instalarlo');
{
  limpiar();
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'sin-cli-'));
  const r = spawnSync(process.execPath, [BANCO], {
    encoding: 'utf8', cwd: raiz, timeout: 180000,
    env: { ...process.env, PATH: vacio },
  });
  const texto = (r.stdout || '') + (r.stderr || '');
  check(r.status === noArranco.NO_ARRANCO, 'sale NO ARRANCÓ (2)', `salió ${r.status}`);
  check(/npm i -g firebase-tools/.test(texto), 'y dice cómo conseguirlo');
  check(!/Se volvió a preguntar/.test(texto),
    'sin volver a preguntarle a un comando que no existe');
}

// ── Resultado ──────────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log('VERDE — un CLI que no contesta deja con qué averiguar por qué.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
