#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// NINGÚN ANCLAJE DE CONTRAPRUEBA APUNTA AL VACÍO
// ════════════════════════════════════════════════════════════════════════════
//
// El defecto que arregla este banco se midió, no se supuso:
//
//   · `scripts/pruebas.cjs` lanza cada banco SIN ARGUMENTOS.
//   · 46 de las contrapruebas sólo arrancan con `--contraprueba`.
//   · Luego `npm test` no corre NUNCA esas contrapruebas.
//
// O sea que son de un solo uso: valen el día que se escriben y nada las vuelve
// a mirar. Y de las cuatro maneras de que una contraprueba deje de proteger
// algo, hay UNA que llega sola con el tiempo, sin que nadie toque el banco: el
// fuente se mueve y el anclaje de la mutación deja de casar. La contraprueba
// no se rompe — se vuelve adorno, y en silencio.
//
// NO ES HIPOTÉTICO. La primera corrida de este banco encontró que
// `prueba-la-marca-se-lee-no-se-teclea` anclaba en
//
//     if (obra.ubicacion) T(obra.ubicacion, ML, 82);
//
// mientras `src/App.jsx` ya decía `textoCapturado(obra.ubicacion)`. Esa
// mutación llevaba sin aplicar desde que se metió `textoCapturado`, su propia
// contraprueba estaba en 7 de 8, y la suite llevaba todo ese tiempo en verde.
//
// Correr las 64 contrapruebas en la suite no cabe —medido: entre 3 s y 74 s
// cada una—. Pero comprobar que sus anclajes TODAVÍA EXISTEN es estático y
// gratis, y es justo la mitad que se podre sola. Eso es lo que hace esto, en
// un banco y no en 64 parches: un anclaje viejo deja de ser un hallazgo de
// dentro de meses y pasa a ser un rojo de hoy.
//
// ── POR QUÉ NO SE RESUELVE «QUÉ FUENTE MUTA CADA BANCO» ────────────────────
//
// Fue el primer intento y salió mal: un medidor que adivinaba el fuente de
// cada banco publicó 46 falsos positivos. Se borró sin reportar sus números.
//
// La pregunta a la que este banco SÍ sabe contestar sin adivinar es más
// modesta y basta: ¿existe el anclaje en ALGÚN archivo del repositorio? Si no
// está en ninguno, no está en el que el banco muta — eso es seguro, y es la
// única dirección en la que esto afirma algo. Un anclaje que se mudó de
// archivo no se detecta, y se dice aquí en vez de insinuar que sí.
//
// Uso:  node scripts/prueba-ningun-anclaje-apunta-al-vacio.cjs
//       node scripts/prueba-ningun-anclaje-apunta-al-vacio.cjs --contraprueba
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const RAIZ = path.join(__dirname, '..');

// El anclaje que está ausente A PROPÓSITO lleva esta marca. La usa el banco
// del corredor para sus fixtures. Es una marca y no una lista de excepciones
// aquí dentro porque una lista se queda vieja y nadie la ve envejecer; la
// marca vive junto al anclaje que exime.
const MARCA_A_PROPOSITO = 'NO-EXISTE:';

let parse, traverse;
try {
  parse = require(path.join(RAIZ, 'node_modules/@babel/parser')).parse;
  traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;
} catch (e) {
  noArranco.sinPrecondicion('no está @babel/parser, con el que se leen los bancos',
    ['npm install', '', 'Viene con vite; si falta, el árbol de node_modules está a medias.']);
}

// ── Leer los anclajes de un banco ──────────────────────────────────────────
//
// Un anclaje es el primer argumento de un `.replace(` cuando es una cadena
// literal. Las mutaciones de este repositorio tienen esa forma:
//
//     (t) => t.replace('la cadena de antes', 'la de después')
//
// Un `.replace(/regex/, …)` no se mira: no hay cadena que buscar. Y de paso se
// recogen los fuentes de juguete que un banco trae dentro, en plantilla, para
// que los anclajes que apuntan a ellos no salgan como huérfanos.
function leerBanco(code) {
  const anclajes = [];
  const fuentesDeJuguete = [];
  const ast = parse(code, { sourceType: 'script', plugins: ['jsx'] });
  traverse(ast, {
    TemplateLiteral(p) {
      const t = p.node.quasis.map(q => q.value.cooked || '').join('');
      if (t.length > 60) fuentesDeJuguete.push(t);
    },
    CallExpression(p) {
      const c = p.node.callee;
      if (!(c.type === 'MemberExpression' && c.property.name === 'replace')) return;
      const a = p.node.arguments[0];
      if (a && a.type === 'StringLiteral')
        anclajes.push({ linea: p.node.loc.start.line, valor: a.value });
    },
  });
  return { anclajes, fuentesDeJuguete };
}

// ── EL AUTOCONTROL, ANTES DE MEDIR NADA ────────────────────────────────────
//
// Sin esto, el día que `leerBanco` deje de casar publicaría «0 anclajes
// huérfanos» y la suite se pondría verde por no haber mirado. Un cero que sale
// de un extractor que no casó no es una medición. Así que primero se le da un
// banco de juguete con un huérfano SEMBRADO y se exige que lo encuentre, y
// sólo uno.
{
  const BANCO_FALSO = `'use strict';
const t = leer();
t.replace('const VIVO = 1;', 'const VIVO = 2;');
t.replace('const MUERTO = 9;', 'const MUERTO = 8;');
t.replace(/[0-9]+/g, 'x');
t.replace('${MARCA_A_PROPOSITO} const AUSENTE = 3;', '${MARCA_A_PROPOSITO} const AUSENTE = 4;');
`;
  const FUENTE_FALSA = 'const VIVO = 1;\nconst otro = 2;\n';
  const { anclajes } = leerBanco(BANCO_FALSO);
  const vistos = anclajes.map(a => a.valor);
  const huerfanos = vistos
    .filter(v => !v.startsWith(MARCA_A_PROPOSITO))
    .filter(v => !FUENTE_FALSA.includes(v));

  const quejas = [];
  if (anclajes.length !== 3)
    quejas.push(`el extractor saca ${anclajes.length} anclajes de un banco con 3 (la regex no cuenta)`);
  if (huerfanos.length !== 1 || huerfanos[0] !== 'const MUERTO = 9;')
    quejas.push(`sembrado 1 huérfano, encontrados ${huerfanos.length}: ${JSON.stringify(huerfanos)}`);
  if (vistos.some(v => v.startsWith(MARCA_A_PROPOSITO)) === false)
    quejas.push('el anclaje marcado a propósito ni se extrajo, así que la marca no se está probando');
  if (quejas.length) noArranco(quejas, 'el autocontrol del extractor');
}

// ── Los fuentes candidatos: todo el repositorio ────────────────────────────
//
// Todo menos los bancos mismos. Un banco lleva su anclaje escrito dentro, así
// que admitirlo como fuente haría la comprobación vacía: cada anclaje se
// encontraría a sí mismo y el verde no diría nada.
const fuentes = [];
const leidos = [];
(function recorrer(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|[/\\]dist$|coverage|[/\\]\.git$/.test(p)) recorrer(p);
      continue;
    }
    if (/^prueba-.*\.cjs$/.test(e.name)) continue;
    try {
      // `continue`, NO `return`. Con `return` aquí, el primer archivo pesado de
      // una carpeta abortaba el recorrido de toda la carpeta: `package-lock.json`
      // pesa más de 4 MB y viene antes que `src/`, así que `src/App.jsx` no
      // entraba en la lista y 178 anclajes vivos salieron reportados como
      // rancios. De ahí viene el suelo de fuentes de más abajo.
      if (fs.statSync(p).size > 4e6) continue;
      const s = fs.readFileSync(p, 'utf8');
      if (!s.includes('\u0000')) { fuentes.push(s); leidos.push(path.relative(RAIZ, p)); }
    } catch { /* ilegible: no es un fuente */ }
  }
})(RAIZ);

// El suelo de los FUENTES, que es el que faltaba cuando pasó lo de arriba.
// `src/App.jsx` es el archivo que mutan casi todos los bancos: si no está en
// la lista, no hay nada que comprobar y el rojo sería del recorrido, no de los
// anclajes. Un rojo que culpa al banco equivocado se aprende a ignorar.
const IMPRESCINDIBLES = ['src/App.jsx'];
const sinLeer = IMPRESCINDIBLES.filter(f => !leidos.includes(f));
if (sinLeer.length || fuentes.length < 100) {
  noArranco([
    ...sinLeer.map(f => `${f} no entró en la lista de fuentes`),
    `se leyeron ${fuentes.length} fuentes y se esperaban al menos 100`,
    'esto es el recorrido del repositorio, no un anclaje rancio',
  ], 'la lista de fuentes');
}

// ── Los bancos con contraprueba ────────────────────────────────────────────
const bancos = fs.readdirSync(__dirname)
  .filter(f => /^prueba-.*\.cjs$/.test(f)).sort()
  .filter(f => /--contraprueba|SIN_CONTRAPRUEBA/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));

const anclajes = [];
const noParsean = [];
for (const f of bancos) {
  let leido;
  try { leido = leerBanco(fs.readFileSync(path.join(__dirname, f), 'utf8')); }
  catch (e) { noParsean.push(`${f}: ${e.message}`); continue; }
  for (const t of leido.fuentesDeJuguete) fuentes.push(t);
  for (const a of leido.anclajes) anclajes.push({ banco: f, ...a });
}

// Un banco que no parsea no es «cero anclajes»: es un banco sin medir.
if (noParsean.length) noArranco(noParsean, 'los bancos no se pudieron leer');

// ── El suelo, para que un cero nunca se lea como tranquilidad ─────────────
//
// Si mañana la forma de declarar mutaciones cambia y el extractor deja de
// casar, lo honesto es NO ARRANCÓ. Los números son los medidos el 2026-11-10:
// 64 bancos con contraprueba y 187 anclajes. El suelo se pone holgado para que
// no estorbe al borrar un banco, y aun así atrape un derrumbe.
const SUELO_BANCOS = 40;
const SUELO_ANCLAJES = 120;
if (bancos.length < SUELO_BANCOS || anclajes.length < SUELO_ANCLAJES) {
  noArranco([
    `${bancos.length} banco(s) con contraprueba y ${anclajes.length} anclaje(s)`,
    `se esperaban al menos ${SUELO_BANCOS} y ${SUELO_ANCLAJES} (el 2026-11-10 eran 64 y 187)`,
    'un desplome así es el extractor que dejó de casar, no un repositorio más limpio',
  ], 'la medición');
}

const aProposito = anclajes.filter(a => a.valor.startsWith(MARCA_A_PROPOSITO));
const vigilados = anclajes.filter(a => !a.valor.startsWith(MARCA_A_PROPOSITO));
const rancios = vigilados.filter(a => !fuentes.some(s => s.includes(a.valor)));

console.log('\n── Ningún anclaje de contraprueba apunta al vacío ──\n');
console.log(`${bancos.length} bancos con contraprueba · ${vigilados.length} anclajes vigilados`
  + ` · ${aProposito.length} ausentes a propósito · ${fuentes.length} fuentes`);

if (aProposito.length) {
  console.log('');
  for (const a of aProposito)
    console.log(`  a propósito  ${a.banco}:${a.linea}`);
}

if (rancios.length === 0) {
  console.log(`\nverde: los ${vigilados.length} anclajes siguen existiendo en el repositorio.\n`);
  if (!process.argv.includes('--contraprueba') || process.env.SIN_CONTRAPRUEBA) process.exit(0);
} else {
  console.log('');
  console.log(`ROJO: ${rancios.length} anclaje(s) de contraprueba ya no existen en ningún archivo.`);
  console.log('Esa mutación no aplica, así que la aserción que decía proteger no está protegida');
  console.log('y la contraprueba del banco está en rojo sin que nadie la corra.');
  console.log('');
  for (const a of rancios) {
    console.log(`  · ${a.banco}:${a.linea}`);
    console.log(`      buscaba: ${JSON.stringify(a.valor.replace(/\s+/g, ' ').slice(0, 110))}`);
  }
  console.log('');
  console.log('Arreglar es reapuntar el anclaje al texto nuevo y volver a correr la');
  console.log('contraprueba de ese banco para comprobar que la mutación vuelve a morder.');
  console.log('');
  process.exit(1);
}

// ── LA CONTRAPRUEBA ────────────────────────────────────────────────────────
//
// Se siembra un anclaje rancio en una COPIA de un banco de verdad y se exige
// que este banco lo vea. Se hace sobre una copia y no sobre el árbol porque
// este banco recorre el repositorio entero: tocar el original de verdad sería
// medir con el repositorio roto.
//
// La otra mitad —que el extractor que no casa sale NO ARRANCÓ y no verde— ya
// la cubre el autocontrol de arriba, y se comprueba aquí desde fuera.
{
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anclaje-rancio-'));
  let malas = 0;
  const ok = (c, t, d = '') => {
    console.log(`${c ? ' ok ' : 'FALLA'}  ${t}${d ? '  ·  ' + d : ''}`);
    if (!c) malas++;
  };

  console.log('CONTRAPRUEBA — se siembra un anclaje rancio y este banco tiene que verlo\n');

  // La aguja se ARMA EN PARTES a propósito, y esto no es manía: este banco
  // cuenta como fuente las plantillas que un banco trae dentro, y el banco de
  // juguete de aquí abajo vive en una plantilla de ESTE archivo. Escrita de
  // corrido, la aguja se encontraría a sí misma, el huérfano sembrado no
  // saldría nunca y la contraprueba daría verde sin haber sembrado nada. Pasó
  // en la primera corrida: cuatro comprobaciones en rojo por esto.
  const AGUJA = ['ANCLAJE', 'RANCIO', 'SEMBRADO', process.pid].join('-');
  const AGUJA_EXENTA = ['ANCLAJE', 'EXENTO', 'SEMBRADO', process.pid].join('-');

  // Un banco de juguete con contraprueba, colocado dentro de `scripts/` para
  // que el recorrido lo encuentre igual que a los demás.
  const sembrado = path.join(__dirname, 'prueba-zz-anclaje-sembrado-temporal.cjs');
  const limpiar = () => { try { fs.unlinkSync(sembrado); } catch { /* ya no está */ } };
  process.on('exit', limpiar);

  try {
    // El `SIN_CONTRAPRUEBA` del banco de juguete es lo que lo hace entrar en la
    // lista de bancos con contraprueba, igual que a los 64 de verdad.
    const juguete = (anclajes) => `'use strict';
// Banco de juguete: lo escribe prueba-ningun-anclaje-apunta-al-vacio al correr
// su contraprueba, y se borra al salir. SIN_CONTRAPRUEBA
const t = '';
${anclajes.map(a => `t.replace(${JSON.stringify(a)}, 'otro');`).join('\n')}
process.exit(0);
`;
    const correrme = () => {
      const r = spawnSync(process.execPath, [__filename],
        { encoding: 'utf8', env: { ...process.env, SIN_CONTRAPRUEBA: '1' } });
      return { status: r.status, texto: (r.stdout || '') + (r.stderr || '') };
    };

    fs.writeFileSync(sembrado, juguete([AGUJA]));
    const r = correrme();
    ok(r.status === 1, 'un anclaje rancio sembrado pone el banco en ROJO', `salida ${r.status}`);
    ok(r.texto.includes(AGUJA), 'y lo nombra, para poder ir a arreglarlo');
    ok(/anclaje-sembrado-temporal/.test(r.texto), 'y dice en qué banco estaba');
    limpiar();

    // Y sin la siembra, verde: si no, lo de arriba pasaría por cualquier razón.
    ok(correrme().status === 0, 'y sin sembrar nada vuelve a verde');

    // La marca no es un pase libre para cualquier cosa: exime al anclaje que
    // la lleva y a ninguno más.
    fs.writeFileSync(sembrado, juguete([`${MARCA_A_PROPOSITO} ${AGUJA_EXENTA}`, AGUJA]));
    const r3 = correrme();
    ok(r3.status === 1 && r3.texto.includes(AGUJA),
      'la marca exime al anclaje que la lleva, no al banco entero', `salida ${r3.status}`);
    ok(!(r3.texto.split('ROJO:')[1] || '').includes(AGUJA_EXENTA),
      'y el marcado no sale en la lista de rancios');
  } finally {
    limpiar();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da igual */ }
  }

  console.log(malas === 0
    ? '\nverde: el vigilante ve el anclaje rancio y se calla cuando no hay.\n'
    : `\nROJO: ${malas} de las comprobaciones de la contraprueba cayeron.\n`);
  process.exit(malas === 0 ? 0 : 1);
}
