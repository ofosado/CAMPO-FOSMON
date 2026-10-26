#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// NINGÚN IDENTIFICADOR SIN DECLARAR — PENDIENTES #20
// ════════════════════════════════════════════════════════════════════════════
//
// El proyecto no tiene linter y `src/App.jsx` pasa de las 23 mil líneas. Un
// identificador sin declarar —una variable renombrada a medias, un helper que
// se movió, un `const` que se borró de más— atraviesa el build de Vite sin un
// ruido y revienta en la pantalla del usuario, en el renglón que nadie probó.
//
// `verificar-ambito.cjs` ya contestaba esa pregunta desde el 2026-09. El
// problema no era la herramienta: era que había que ACORDARSE de correrla.
// Una verificación que depende de la memoria de alguien no es una
// verificación, es una buena intención — y la clase de defecto que atrapa es
// justo la que aparece cuando uno anda con prisa, que es cuando no se acuerda.
//
// Esto la mete en la suite. No la reimplementa ni la copia: la EJECUTA, que es
// la única forma de que lo medido sea lo que la herramienta hace hoy. Si la
// herramienta se rompe, esto no arranca; si encuentra algo, esto es rojo.
//
// Contraprueba:  node scripts/prueba-ambito-declarado.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion } = require('./no-arranco.cjs');

vigilarExcepciones('los archivos de código del repositorio');

const DIR = __dirname;
const RAIZ = path.join(DIR, '..');
const HERRAMIENTA = path.join(DIR, 'verificar-ambito.cjs');

// Qué se revisa. Todo lo que se ENVÍA: la app, sus módulos sueltos y las
// Cloud Functions. No se enumera a mano la lista de `src/`: un archivo nuevo
// que nadie agregue aquí sería un archivo sin revisar, y el defecto volvería
// por donde entró.
const fuentes = [
  ...fs.readdirSync(path.join(RAIZ, 'src'))
    .filter(f => /\.(jsx?|mjs)$/.test(f))
    .map(f => path.join('src', f)),
  'functions/index.js',
].filter(rel => fs.existsSync(path.join(RAIZ, rel)));

try { fs.accessSync(HERRAMIENTA); }
catch {
  sinPrecondicion('no está scripts/verificar-ambito.cjs',
    ['Es la herramienta que contesta la pregunta. Sin ella esta prueba no',
     'mide nada: no la reimplementa a propósito.']);
}
if (fuentes.length < 3)
  sinPrecondicion(`sólo se encontraron ${fuentes.length} archivos de código`,
    ['Esperaba al menos la app, un módulo suelto y las funciones. Verde por',
     'vacío es la forma más barata de no comprobar nada.']);

const revisar = (archivos) => {
  const r = spawnSync(process.execPath, [HERRAMIENTA, ...archivos], {
    encoding: 'utf8', cwd: RAIZ, timeout: 120000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  return { status: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
//
// Las roturas son semánticas: se mete en una COPIA exactamente el defecto que
// esto existe para atrapar —un identificador que nadie declaró— en las formas
// en que aparece de verdad. Si alguna no se ve, la prueba cubre menos de lo
// que dice.
if (process.argv.includes('--contraprueba')) {
  const original = fs.readFileSync(path.join(RAIZ, 'src/rutas-org.js'), 'utf8');
  const MUTACIONES = [
    ['una llamada a algo que no existe',
      src => src + '\nexport const colada = () => helperQueNadieDeclaro(1);\n'],
    ['un renombre a medias: se declara `a` y se usa `b`',
      src => src + '\nexport const otra = () => { const a = 1; return bQueNoEs + a; };\n'],
    ['una variable perdida dentro de un bloque',
      src => src + '\nexport const tercera = (x) => { if (x) { return perdidaEnElBloque; } return 0; };\n'],
    ['un typo en un helper del propio archivo',
      src => src.replace(/^export /m, 'const _roto = () => prefijoDeOrgg;\nexport ')],
  ];

  let vistas = 0;
  for (const [nombre, romper] of MUTACIONES) {
    const mutado = romper(original);
    if (mutado === original) {
      console.log(`NO LA VE  ${nombre}  ·  el ancla ya no está en src/rutas-org.js`);
      continue;
    }
    const arch = path.join(os.tmpdir(), `ambito-mutado-${Date.now()}-${vistas}.js`);
    fs.writeFileSync(arch, mutado);
    const { status, salida } = revisar([arch]);
    const vio = status === 1 && /^FALLA/m.test(salida);
    console.log(`${vio ? 'ROJA     ' : 'NO LA VE '} ${nombre}` +
      (vio ? '' : `  ·  salió ${status}`));
    if (vio) vistas++;
    try { fs.unlinkSync(arch); } catch {}
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: la prueba no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── La corrida de verdad ────────────────────────────────────────────────────
console.log('\n── Identificadores sin declarar en lo que se envía ──');
console.log(`Revisando ${fuentes.length} archivo(s): ${fuentes.join(', ')}\n`);

const { status, salida } = revisar(fuentes);

// Una herramienta que no contesta no dice que el código esté bien. Salida
// distinta de 0 y 1 —o una excepción de Babel— es no haber mirado.
if (status !== 0 && status !== 1)
  sinPrecondicion('una respuesta de `verificar-ambito.cjs`',
    [`Salió con ${status} en vez de 0 (limpio) o 1 (encontró algo), y dijo:`,
     '',
     '  ' + (salida.trim().split('\n').slice(0, 8).join('\n  ') || '(nada)'),
     '',
     'Eso no dice nada sobre el código, ni a favor ni en contra. Suele ser',
     'que un archivo trae sintaxis que el parser no tiene habilitada.']);

let fallas = 0, oks = 0;
const problemas = salida.split('\n').filter(l => /^\s+\S+:\d+\s+·\s+/.test(l));

if (status === 0) {
  oks++;
  console.log(` ok   ningún identificador sin declarar en ${fuentes.length} archivo(s)`);
} else {
  fallas++;
  console.log('FALLA hay identificadores sin declarar en lo que se envía');
  console.log(`        esperaba: ninguno`);
  console.log(`        obtuvo:   ${problemas.length}, el primero en` +
    `${(problemas[0] || '').replace(/\s+·\s+/, ' · ')}`);
  console.log('');
  for (const p of problemas.slice(0, 40)) console.log(p);
  if (problemas.length > 40) console.log(`  … y ${problemas.length - 40} más`);
  console.log('');
  console.log('Esto no lo atrapa el build: Vite empaqueta un identificador');
  console.log('libre sin decir nada y revienta en la pantalla del usuario.');
}

// Que la herramienta MIRÓ cada archivo, no que no se quejó de ninguno. Sin
// esto, un argumento mal pasado daría verde por no haber revisado nada.
const mirados = (salida.match(/^(OK|FALLA)\s+\S+/gm) || []).length;
if (mirados === fuentes.length) {
  oks++;
  console.log(` ok   los ${fuentes.length} archivos se revisaron de verdad`);
} else {
  fallas++;
  console.log('FALLA los archivos se revisaron de verdad');
  console.log(`        esperaba: ${fuentes.length} archivos con veredicto`);
  console.log(`        obtuvo:   ${mirados}`);
}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);
