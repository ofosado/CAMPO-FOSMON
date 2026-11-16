#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LO QUE SE TECLEA ES LO QUE LLEGA — PENDIENTES #148
// ════════════════════════════════════════════════════════════════════════════
//
// `ponle-contrasena-a-la-cuenta-de-demo.cjs` pide la contraseña dos veces y
// las compara. Si el lector de teclado pierde bytes, el guion no se rompe: le
// echa la culpa a la persona. Dice «las dos no coinciden» y la manda a
// repetirlo, y repetirlo falla otra vez, porque el defecto no estaba en sus
// dedos.
//
// Eso pasó el 2026-11-16 en producción, con tres cuentas esperando contraseña.
// La causa: un `fs.createReadStream` por prompt al que se le creía apagando el
// modo crudo con `entrada.setRawMode(...)`, método que un `fs.ReadStream` NO
// tiene —es de `tty.ReadStream`—, así que el stream del primer prompt quedaba
// vivo con una lectura en vuelo y se comía teclas del segundo. Medido:
// teclando `abc` las dos veces, la segunda llegaba como `b`. Y de paso el eco
// nunca se apagaba, de modo que la primera contraseña salía en pantalla
// mientras el guion prometía que no se veía.
//
// NINGUNA DE LAS DOS COSAS LA VE UNA PRUEBA QUE NO TECLEE. No hay forma de
// medir esto leyendo el archivo: hace falta una terminal de verdad, teclas que
// lleguen separadas en el tiempo como las de una persona, y mirar qué quedó.
// Por eso esta prueba levanta un pseudo-terminal con `expect` y escribe en él.
//
// Lo que se afirma, en los tres casos, es CONDUCTA:
//   1. teclear lo mismo dos veces produce lo mismo dos veces;
//   2. borrar quita un CARÁCTER, aunque ocupe dos bytes (`ñ`, `é`);
//   3. nada de lo tecleado aparece en la pantalla.
//
// El lector no se copia aquí: se extrae del guion con `fuenteDe` y se EJECUTA.
// Lo único copiado es el espécimen de la contraprueba —el lector anterior, el
// que se comía teclas—, y ése no es el sujeto de la medición sino el defecto
// que hay que poder ver.
//
// Contraprueba:  node scripts/prueba-la-contrasena-que-se-teclea.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { vigilarExcepciones, sinPrecondicion, hijoConPlazo } = require('./no-arranco.cjs');

vigilarExcepciones('el lector de teclado del guion de la contraseña');

const DIR = __dirname;
const RAIZ = path.join(DIR, '..');
const GUION = path.join(DIR, 'ponle-contrasena-a-la-cuenta-de-demo.cjs');
const PEDIDOS = ['ttyMod', 'sinElUltimoCaracter', 'pedirOculta'];

// ── LOS INSUMOS DEL ENTORNO ────────────────────────────────────────────────
//
// Sin `expect` no hay pseudo-terminal, y sin pseudo-terminal esto no mide
// nada: es NO ARRANCÓ, no verde. Un verde aquí por no haber podido teclear
// sería la peor de las tres respuestas.
const EXPECT = ['/usr/bin/expect', '/opt/homebrew/bin/expect', '/usr/local/bin/expect']
  .find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
if (!EXPECT) sinPrecondicion('no hay `expect` en esta máquina',
  ['Es lo que levanta el pseudo-terminal donde se teclea. Sin él no se puede',
   'saber si el lector pierde teclas: leer el archivo no lo dice.',
   'En macOS viene en /usr/bin/expect.']);

try { fs.accessSync(GUION); }
catch {
  sinPrecondicion('no está scripts/ponle-contrasena-a-la-cuenta-de-demo.cjs',
    ['Es el guion cuyo lector de teclado se mide. Esta prueba no lo',
     'reimplementa: le extrae el lector y lo ejecuta.']);
}

let fuenteDelLector;
try {
  const { fuenteDe } = require('./extraer-de-app.cjs');
  fuenteDelLector = fuenteDe(GUION, PEDIDOS).cuerpo;
} catch (e) {
  sinPrecondicion(`no se pudo extraer el lector del guion: ${e.message}`,
    [`Se buscan ${PEDIDOS.join(', ')}. Si alguno se renombró, esta prueba`,
     'dejó de mirar el lector de verdad y hay que apuntarla al nombre nuevo.']);
}

// ── EL ESPÉCIMEN: EL LECTOR QUE SE COMÍA TECLAS ────────────────────────────
//
// Copia literal del lector de antes del 2026-11-16. Está aquí para que la
// contraprueba tenga qué romper: si los tres casos no lo ven, no cubren lo que
// dicen cubrir.
const ESPECIMEN = `
function pedirOculta(rotulo) {
  return new Promise((resolve, reject) => {
    let tty;
    try { tty = fs.openSync('/dev/tty', 'r+'); }
    catch { return reject(new Error('sin terminal')); }
    fs.writeSync(tty, rotulo);
    const entrada = fs.createReadStream('', { fd: tty, autoClose: false });
    entrada.setRawMode?.(true);
    if (entrada.setRawMode) entrada.setRawMode(true);
    else if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let acc = '';
    entrada.on('data', (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\\r' || ch === '\\n') {
          if (entrada.setRawMode) entrada.setRawMode(false);
          fs.writeSync(tty, '\\n');
          entrada.pause();
          entrada.removeAllListeners('data');
          return resolve(acc);
        }
        if (ch === '\\u0003') {
          if (entrada.setRawMode) entrada.setRawMode(false);
          fs.writeSync(tty, '\\n');
          return reject(new Error('cancelado'));
        }
        if (ch === '\\u007f' || ch === '\\b') { acc = acc.slice(0, -1); continue; }
        acc += ch;
      }
    });
  });
}`;

// ── EL ARNÉS QUE CORRE DENTRO DEL PSEUDO-TERMINAL ──────────────────────────
//
// Imprime LONGITUDES, no el contenido: la comprobación del eco mira la
// pantalla del pseudo-terminal buscando las teclas, y si el arnés las
// imprimiera al final no se podría distinguir el eco del informe.
function escribirArnes(cuerpoDelLector) {
  const arch = path.join(os.tmpdir(), `arnes-teclado-${process.pid}-${Date.now()}.cjs`);
  // `fs` no se declara a ciegas: `fuenteDe` arrastra el `require` del guion
  // junto con el lector, y declararlo otra vez sería un SyntaxError que se lee
  // como «el pseudo-terminal no contestó».
  const traeFs = /\bconst\s+fs\s*=\s*require\(/.test(cuerpoDelLector);
  fs.writeFileSync(arch, `'use strict';
${traeFs ? '' : "const fs = require('fs');\n"}${cuerpoDelLector}
(async () => {
  const a = await pedirOculta('  uno: ');
  const b = await pedirOculta('  dos: ');
  const n = Buffer.byteLength(a, 'utf8');
  console.log('\\nVEREDICTO ' + (a === b ? 'IGUALES' : 'DISTINTAS') + ' bytes=' + n);
  process.exit(0);
})().catch(e => { console.log('\\nVEREDICTO LANZO ' + e.message); process.exit(3); });
`);
  return arch;
}

// ── TECLEAR DE VERDAD ──────────────────────────────────────────────────────
//
// Una tecla cada 150 ms. El intervalo no es decorativo: con todo pegado en un
// solo golpe el defecto se manifiesta de otra forma (el primer prompt se queda
// con el resto del golpe), y lo que hay que imitar es a una persona.
const TECLAS = { BS: '\\177', ENTER: '\\r', N: '\\u00f1' };
const comoTcl = t => TECLAS[t] || t;

function teclear(arnes, primera, segunda) {
  const guionTcl = path.join(os.tmpdir(), `teclea-${process.pid}-${Date.now()}.exp`);
  const manda = (teclas) => teclas
    .map(t => `send -- "${comoTcl(t)}"\nsleep 0.15`).join('\n');
  fs.writeFileSync(guionTcl, `set timeout 25
log_user 1
spawn ${process.execPath} ${arnes}
expect "uno: "
${manda([...primera, 'ENTER'])}
expect "dos: "
${manda([...segunda, 'ENTER'])}
expect {
  -re "VEREDICTO.*" { puts "" }
  timeout { puts "\\nVEREDICTO COLGADO" }
}
`);
  const r = hijoConPlazo(EXPECT, ['-f', guionTcl], {
    encoding: 'utf8', cwd: RAIZ, timeout: 90000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TERM: 'dumb' },
  });
  try { fs.unlinkSync(guionTcl); } catch {}
  const pantalla = (r.stdout || '') + (r.stderr || '');
  const m = pantalla.match(/VEREDICTO (IGUALES|DISTINTAS|COLGADO|LANZO [^\n]*)(?: bytes=(\d+))?/);
  return { pantalla, veredicto: m ? m[1] : null, bytes: m && m[2] ? Number(m[2]) : null };
}

// ── LOS TRES CASOS ─────────────────────────────────────────────────────────
const CASOS = [
  {
    nombre: 'teclear lo mismo dos veces llega igual dos veces',
    primera: ['a', 'b', 'c'], segunda: ['a', 'b', 'c'],
    juzgar: ({ veredicto }) => veredicto === 'IGUALES'
      ? { ok: true }
      : { ok: false, esperaba: 'IGUALES', obtuvo: String(veredicto) },
  },
  {
    nombre: 'borrar quita un carácter completo, aunque ocupe dos bytes',
    primera: ['a', 'b', 'N', 'BS'], segunda: ['a', 'b'],
    juzgar: ({ veredicto }) => veredicto === 'IGUALES'
      ? { ok: true }
      : { ok: false, esperaba: 'IGUALES: «ab» + ñ + borrar == «ab»', obtuvo: String(veredicto) },
  },
  {
    nombre: 'un carácter de dos bytes llega entero',
    primera: ['a', 'N'], segunda: ['a', 'N'],
    juzgar: ({ veredicto, bytes }) => {
      // Si `expect` mandara la ñ en un solo byte, el caso de arriba no estaría
      // ejerciendo nada multibyte y daría verde por vacío. Esto lo delata.
      if (bytes === null) return { ok: false, esperaba: '3 bytes para «añ»', obtuvo: 'el arnés no contestó' };
      if (bytes !== 3) return { ok: false, esperaba: '3 bytes para «añ»', obtuvo: `${bytes} byte(s)` };
      return veredicto === 'IGUALES' ? { ok: true }
        : { ok: false, esperaba: 'IGUALES', obtuvo: String(veredicto) };
    },
  },
  {
    nombre: 'lo tecleado no aparece en la pantalla',
    // z, q y w no están en «uno», «dos», «VEREDICTO», «IGUALES», «DISTINTAS»
    // ni «bytes», así que verlas en la pantalla sólo puede ser el eco.
    primera: ['z', 'q', 'w'], segunda: ['z', 'q', 'w'],
    juzgar: ({ pantalla }) => {
      const sinRuta = pantalla.replace(/^spawn .*$/gm, '');   // la ruta del arnés la imprime expect
      const vistas = ['z', 'q', 'w'].filter(c => sinRuta.includes(c));
      return vistas.length === 0 ? { ok: true }
        : { ok: false, esperaba: 'ninguna tecla en pantalla',
            obtuvo: `se vieron ${vistas.join(', ')} — el eco está encendido` };
    },
  },
];

function correrCasos(cuerpoDelLector) {
  const arnes = escribirArnes(cuerpoDelLector);
  const salidas = [];
  try {
    for (const caso of CASOS) {
      const r = teclear(arnes, caso.primera, caso.segunda);
      salidas.push({ caso, r, juicio: caso.juzgar(r) });
    }
  } finally { try { fs.unlinkSync(arnes); } catch {} }
  return salidas;
}

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  console.log('\n── Contraprueba: el lector de antes, el que se comía teclas ──\n');
  const salidas = correrCasos(ESPECIMEN);
  let vistos = 0;
  for (const { caso, juicio, r } of salidas) {
    const lo = !juicio.ok;
    console.log(`${lo ? 'ROJA     ' : 'NO LA VE '} ${caso.nombre}` +
      (lo ? `  ·  ${juicio.obtuvo}` : `  ·  pasó igual (veredicto ${r.veredicto})`));
    if (lo) vistos++;
  }
  console.log('');
  // No se exige que el espécimen falle los CUATRO: el borrado de un carácter
  // ya lo hacía bien por recorrer la cadena y no los bytes. Lo que esta
  // contraprueba tiene que demostrar es que los dos defectos que de verdad
  // ocurrieron —perder teclas y dejar el eco— se ven.
  const MINIMO_VISTOS = 2;
  console.log(vistos >= MINIMO_VISTOS
    ? `El espécimen se ve en ${vistos} de ${CASOS.length} casos: la prueba muerde.`
    : `Sólo ${vistos} de ${CASOS.length}: la prueba no vería el defecto que ya ocurrió.`);
  process.exit(vistos >= MINIMO_VISTOS ? 0 : 1);
}

// ── LA CORRIDA DE VERDAD ────────────────────────────────────────────────────
console.log('\n── Lo que se teclea es lo que llega ──');
console.log(`Lector extraído de ${path.relative(RAIZ, GUION)} y ejecutado en un ` +
            'pseudo-terminal\n');

let oks = 0, fallas = 0;
for (const { caso, juicio, r } of correrCasos(fuenteDelLector)) {
  if (r.veredicto === null)
    sinPrecondicion(`el arnés no contestó en «${caso.nombre}»`,
      ['No se pudo teclear en el pseudo-terminal, así que no se midió nada.',
       'La pantalla fue:', '', '  ' + r.pantalla.trim().split('\n').slice(0, 8).join('\n  ')]);
  if (juicio.ok) {
    oks++;
    console.log(` ok   ${caso.nombre}`);
  } else {
    fallas++;
    console.log(`FALLA ${caso.nombre}`);
    console.log(`        esperaba: ${juicio.esperaba}`);
    console.log(`        obtuvo:   ${juicio.obtuvo}`);
  }
}

console.log('');
if (fallas) {
  console.log('Un lector que pierde teclas no se ve como un defecto del guion: se ve');
  console.log('como «las dos no coinciden», y manda a la persona a repetir algo que');
  console.log('va a fallar otra vez.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);
