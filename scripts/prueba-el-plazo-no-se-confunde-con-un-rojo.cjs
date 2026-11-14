#!/usr/bin/env node
// Guardia del quinto modo de no arrancar: un hijo al que se lleva el plazo NO
// es un rojo.
//
// EL DEFECTO, medido el 2026-11-14. La máquina estaba en batería al 18% y
// macOS la suspendía cada ~16 minutos («Maintenance Sleep», 914 a 1074 s por
// vez). `Date.now()` cuenta el rato suspendido y el plazo de un `spawnSync`
// también, pero el hijo no corrió durante él: al despertar, un plazo de 180 s
// llevaba mil segundos vencido y el hijo murió sin haber hecho nada. Vuelve
// como `status: null`, `signal: 'SIGTERM'`, `error.code: 'ETIMEDOUT'`, y
// CUALQUIER comparación contra un número sale falsa — `null === 2` es falso,
// `null === 0` es falso, `null === 1` es falso, y hasta `null > 0` es falso.
//
// Ese día `prueba-el-cli-que-no-contesta-deja-rastro` salió ROJO con 7
// comprobaciones caídas («sale NO ARRANCÓ (2), no rojo · vio: salió null») y
// las dos vueltas siguientes salieron verdes sin tocar nada. Es el ROJO FALSO
// del #139: un NO ARRANCÓ dice «no medí», un ROJO afirma que hay un defecto y
// manda a buscarlo donde no está.
//
// LA FORMA PEOR eran los 7 corredores de mutaciones, que hacen
// `const vio = r.status === 1 && rojas > 0`: un mutante al que se lleva el
// plazo se publica como «la mutación NO se vio», o sea una afirmación sobre el
// poder de la prueba que nadie midió. No dice «no pude»: dice que el banco
// está ciego.
//
// QUÉ SE AFIRMA AQUÍ, y son dos cosas distintas:
//
//   (1) LA CONDUCTA DE LA PUERTA. No que `hijoConPlazo` exista: qué le pasa al
//       PROCESO. Se escriben bancos de mentira en /tmp, se corren como hijos de
//       verdad y se lee su código de salida, que es lo que el corredor lee para
//       clasificar en los tres estados. Es el mismo método que
//       `prueba-la-puerta-del-no-arranco.cjs`, y por la misma razón: la
//       conducta entera es «con qué sale el proceso» y eso no se ve desde
//       dentro.
//
//   (2) QUE NO QUEDE UN SITIO FUERA. No se nombran los 16 convertidos: se
//       BUSCAN. Se recorre el AST de cada `.cjs` de `scripts/` y todo
//       `spawnSync`/`spawn`/`execFileSync`/`execSync` que lleve `timeout` tiene
//       que ir por la puerta, o estar en la tabla de abajo con su razón y su
//       cuenta. El sitio 17 escrito mañana cae solo.
//
// EL RELOJ DORMIDO SE SIEMBRA, no se espera. Dormir la máquina para medir esto
// no es una prueba, es una tarde. El banco de mentira precarga un módulo que
// hace que la SEGUNDA lectura de `Date.now()` salte veinte minutos, que es
// exactamente lo que ve la puerta cuando la máquina se suspendió entre sus dos
// lecturas. Es la misma clase de instrumento que `fecha-falsa.cjs`.
//
// Uso:  node scripts/prueba-el-plazo-no-se-confunde-con-un-rojo.cjs
//       node scripts/prueba-el-plazo-no-se-confunde-con-un-rojo.cjs --contraprueba

const fs = require('fs');
const os = require('os');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const MODULO = path.join(__dirname, 'no-arranco.cjs');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok  ' : 'FALLA'} ${titulo}${detalle ? `  ·  ${detalle}` : ''}`);
  if (!ok) fallas++;
};

// ── Los cuatro sitios que NO van por la puerta, y por qué ──────────────────
//
// Una exclusión que no se ve es una exclusión que nadie vuelve a discutir, así
// que las razones se IMPRIMEN en cada corrida. Es el precedente del #133.
//
// Lleva la CUENTA de sitios descubiertos, no sólo el nombre del archivo: con el
// archivo a secas, un `spawnSync` nuevo escrito mañana en cualquiera de estos
// cuatro heredaría la excepción en silencio. Y no lleva números de renglón,
// que es el ancla que se rompió en el #140 al realinear una tabla.
const PLAZO_PROPIO = new Map([
  ['pruebas.cjs', { cuantos: 2, porque:
    'el corredor ES el plazo: es quien lo impone a los 125 bancos y quien ' +
    'publica «el reloj saltó». Pasarlo por la puerta sería pedirle a la ' +
    'puerta que juzgue a quien la define.' }],
  ['prueba-corredor-no-se-cuelga.cjs', { cuantos: 9, porque:
    'su asunto es el plazo del corredor: mide bancos de mentira que se ' +
    'cuelgan a propósito. Un hijo muerto por el plazo es aquí el dato, no ' +
    'la avería.' }],
  ['prueba-el-destino-se-escribe.cjs', { cuantos: 2, porque:
    'los dos resuelven el plazo mejor que la puerta: el del CLI cae en su ' +
    '`sinPrecondicion` con `rastroDelCLI` entero pegado, y el de dentro de ' +
    '`rastroDelCLI` no puede salir sin cortar el informe que existe para dar.' }],
  ['prueba-puente-color.cjs', { cuantos: 1, porque:
    '`execFileSync` no devuelve un status al vencer el plazo: LANZA, y el ' +
    '`catch` ya manda a `sinPrecondicion`. El modo de fallar no es el mismo, ' +
    'y ahí ya es 2.' }],
]);

console.log('\n── Los sitios con plazo propio, y su razón ───────────────────────────');
for (const [f, { cuantos, porque }] of PLAZO_PROPIO)
  console.log(`  ${f} (${cuantos})\n     ${porque}`);

// ── Un banco de mentira, en un proceso de verdad ───────────────────────────
//
// El reloj que salta se precarga con `--require`, antes que el cuerpo, porque
// la puerta lee `Date.now()` en cuanto se la llama.
const SALTO = path.join(os.tmpdir(), `reloj-que-salta-${process.pid}.cjs`);
fs.writeFileSync(SALTO, `
// Hace que la SEGUNDA lectura de \`Date.now()\` salte 20 minutos: es lo que ve
// un proceso entre cuyas dos lecturas la máquina estuvo suspendida.
const Real = Date.now;
let n = 0;
Date.now = () => Real() + (n++ === 0 ? 0 : 20 * 60 * 1000);
`);
process.on('exit', () => { try { fs.unlinkSync(SALTO); } catch { /* ya no está */ } });

let n = 0;
const correr = (cuerpo, { conRelojQueSalta = false } = {}) => {
  const archivo = path.join(os.tmpdir(), `plazo-de-mentira-${process.pid}-${n++}.cjs`);
  fs.writeFileSync(archivo,
    `const MOD = ${JSON.stringify(MODULO)};\n` +
    `const { hijoConPlazo } = require(MOD);\n${cuerpo}\n`);
  const args = conRelojQueSalta ? ['--require', SALTO, archivo] : [archivo];
  try {
    // La puerta del repo para correr los hijos de este banco, igual que
    // `prueba-la-puerta-del-no-arranco`: si a UNO DE ÉSTOS se lo lleva el
    // plazo, lo que no puede pasar es que se lea como un veredicto.
    const r = noArranco.hijoConPlazo(process.execPath, args,
      { encoding: 'utf8', timeout: 60000 });
    return { estado: r.status, salida: (r.stdout || '') + (r.stderr || '') };
  } finally { fs.unlinkSync(archivo); }
};

const DUERME = `[process.execPath, ['-e', 'setTimeout(() => {}, 20000)']]`;

// ── 1. Al hijo se lo lleva el plazo: 2, y el reloj cuadra ──────────────────
console.log('\n1. Un hijo que de verdad no contesta: NO ARRANCÓ (2), sin acusar al reloj');
{
  const r = correr(`
    hijoConPlazo(...${DUERME}, { encoding: 'utf8', timeout: 400 });
    console.log('LA PUERTA DEVOLVIÓ Y EL BANCO SIGUIÓ');`);
  check(r.estado === noArranco.NO_ARRANCO,
    'sale 2, no 1', `salió ${r.estado}`);
  check(!/LA PUERTA DEVOLVIÓ/.test(r.salida),
    'y no devuelve: el banco no llega a comparar un `null` contra un número');
  check(/sin contestar en \d+ s/.test(r.salida),
    'dice cuántos segundos esperó, porque esta vez sí los esperó');
  check(!/el reloj saltó/.test(r.salida),
    'y NO culpa a la máquina dormida, que no se durmió');
  check(/NO es un rojo/.test(r.salida),
    'y lo nombra: no es un rojo');
}

// ── 2. La máquina dormida: 2, y se dice que el reloj no cuadra ─────────────
//
// Ésta es LA sección. Lo que separa este caso del de arriba es a dónde manda:
// «sin contestar en 180 s» dice «súbele el plazo o arregla ese hijo», y la
// verdad era «repítela con la máquina despierta». Media tarde de diferencia.
console.log('\n2. La máquina se suspendió a mitad: 2, y se le echa la culpa al reloj');
{
  const r = correr(`
    hijoConPlazo(...${DUERME}, { encoding: 'utf8', timeout: 400 });
    console.log('LA PUERTA DEVOLVIÓ Y EL BANCO SIGUIÓ');`,
  { conRelojQueSalta: true });
  check(r.estado === noArranco.NO_ARRANCO, 'sale 2, no 1', `salió ${r.estado}`);
  check(!/LA PUERTA DEVOLVIÓ/.test(r.salida), 'y tampoco devuelve');
  check(/el reloj saltó \d+ s sobre un plazo de \d+ s/.test(r.salida),
    'dice que el reloj saltó, con las dos cifras que no cuadran');
  check(/no se pudo medir/.test(r.salida),
    'y publica «no se pudo medir», que es lo que pasó');
  check(!/sin contestar en \d+ s/.test(r.salida),
    'sin publicar un número de segundos que nadie esperó');
  check(/caffeinate -i. NO alcanza en batería|caffeinate -i` NO alcanza/.test(r.salida),
    'y manda a donde hay que ir: `caffeinate -i` no alcanza en batería');
}

// ── 3. El hijo que SÍ contesta vuelve tal cual ─────────────────────────────
//
// La simétrica, y hace falta: las secciones de arriba sólo miran los hijos que
// no contestan, así que una puerta que devolviera un código inventado —el caso
// callado: todo sigue andando, y todos los veredictos son de otro— las pasaría
// todas. Aquí se le pregunta por dos hijos que sí contestan, y con códigos
// distintos, para que ni «siempre 0» ni «siempre el del último» cuelen.
console.log('\n3. Un hijo que contesta vuelve con su código, y el banco sigue');
{
  const r = correr(`
    const a = hijoConPlazo(process.execPath, ['-e', 'process.exit(7)'],
      { encoding: 'utf8', timeout: 20000 });
    const b = hijoConPlazo(process.execPath, ['-e', 'process.exit(0)'],
      { encoding: 'utf8', timeout: 20000 });
    console.log('STATUS=' + a.status + ',' + b.status);
    process.exit(0);`);
  check(r.estado === 0, 'el banco de mentira termina normal', `salió ${r.estado}`);
  check(/STATUS=7,0/.test(r.salida),
    'y la puerta devolvió los dos códigos sin tocarlos',
    (/STATUS=[^\s]*/.exec(r.salida) || ['nada'])[0]);
}

// ── 4. Un hijo que no se pudo lanzar NO lo tapa la puerta ──────────────────
//
// `el-destino-se-escribe` manda a `npm i -g firebase-tools` cuando el CLI no
// está. Ése es un diagnóstico mejor que cualquiera que se pueda dar desde la
// puerta, así que `ENOENT` tiene que volver al banco para que lo trate él.
console.log('\n4. Un comando que no existe vuelve al banco, no lo traga la puerta');
{
  const r = correr(`
    const a = hijoConPlazo('no-existe-este-comando-ni-de-lejos', [],
      { encoding: 'utf8', timeout: 20000 });
    console.log('ERRCODE=' + (a.error && a.error.code));
    process.exit(0);`);
  check(r.estado === 0, 'el banco de mentira sigue vivo', `salió ${r.estado}`);
  check(/ERRCODE=ENOENT/.test(r.salida),
    'y recibe el `ENOENT` para dar su propio diagnóstico',
    (/ERRCODE=[^\s]*/.exec(r.salida) || ['nada'])[0]);
}

// ── 5. Un hijo sin plazo no se admite ──────────────────────────────────────
//
// Un `spawnSync` sin plazo no se cuelga con un veredicto equivocado: se cuelga
// para siempre, y lo que ve quien corrió la suite es una terminal quieta. Es el
// defecto del #109 una planta más abajo, así que la puerta no lo deja pasar.
console.log('\n5. Pedir la puerta sin plazo es NO ARRANCÓ, no un hijo eterno');
{
  for (const [como, opciones] of [['sin opciones', ''],
                                  ['con opciones y sin `timeout`', ", { encoding: 'utf8' }"],
                                  ['con `timeout: 0`', ", { timeout: 0 }"]]) {
    const r = correr(`
      hijoConPlazo(process.execPath, ['-e', '']${opciones});
      console.log('PASÓ SIN PLAZO');`);
    check(r.estado === noArranco.NO_ARRANCO && !/PASÓ SIN PLAZO/.test(r.salida),
      `${como}: sale 2 y no corre`, `salió ${r.estado}`);
  }
}

// ── 6. Muerto por otra señal: 2, y no se le echa al plazo ──────────────────
console.log('\n6. Un hijo que muere por otra señal también deja sin veredicto');
{
  const r = correr(`
    hijoConPlazo(process.execPath,
      ['-e', 'process.kill(process.pid, "SIGKILL")'],
      { encoding: 'utf8', timeout: 20000 });
    console.log('LA PUERTA DEVOLVIÓ');`);
  check(r.estado === noArranco.NO_ARRANCO, 'sale 2', `salió ${r.estado}`);
  check(/señal SIGKILL/.test(r.salida),
    'nombra la señal que lo mató');
  check(!/Se lo llevó el plazo/.test(r.salida),
    'y no le echa la culpa al plazo, que no venció');
}

// ── 7. El barrido: ningún sitio con plazo se queda fuera ───────────────────
//
// No se nombran los convertidos: se buscan. Y se pregunta al CÓDIGO, no al
// texto — el precedente es el #140, donde una expresión regular sobre el texto
// hizo que el único archivo cuyo asunto es el corredor se denunciara a sí mismo
// por llevar el nombre dentro de una plantilla.
console.log('\n7. Todo hijo con plazo va por la puerta, o está en la tabla con su cuenta');
{
  const LANZAN = /^(spawnSync|spawn|execFileSync|execSync|execFile|exec)$/;
  const fuera = new Map();   // archivo → nº de sitios con plazo fuera de la puerta
  const porLaPuerta = [];
  const noParsean = [];

  for (const f of fs.readdirSync(__dirname).filter(a => a.endsWith('.cjs'))) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    let ast;
    try { ast = parse(src, { sourceType: 'unambiguous', plugins: ['jsx'] }); }
    catch (e) { noParsean.push(`${f}: ${e.message}`); continue; }
    traverse(ast, {
      CallExpression(p) {
        const c = p.node.callee;
        const nom = c.type === 'Identifier' ? c.name
          : c.type === 'MemberExpression' && c.property.type === 'Identifier'
            ? c.property.name : '';
        const linea = src.slice(0, p.node.start).split('\n').length;
        if (nom === 'hijoConPlazo') { porLaPuerta.push(`${f}:${linea}`); return; }
        if (!LANZAN.test(nom)) return;
        const o = p.node.arguments[p.node.arguments.length - 1];
        const conPlazo = o && o.type === 'ObjectExpression' && o.properties.some(
          pr => pr.type === 'ObjectProperty' && pr.key
             && (pr.key.name === 'timeout' || pr.key.value === 'timeout'));
        if (conPlazo) fuera.set(f, (fuera.get(f) || 0) + 1);
      },
    });
  }

  // Un barrido que no parsea algo no midió ese algo. No clasificado no es lo
  // mismo que no declarado — el precedente es el #140.
  if (noParsean.length)
    noArranco.sinPrecondicion(
      `${noParsean.length} guion(es) de scripts/ no se pudieron parsear`,
      ['Sin parsearlos no se puede decir si llevan un hijo con plazo:',
       '', ...noParsean.map(x => '  ' + x)]);

  // Un barrido de cero sitios sale verde sin haber mirado nada: es el P4 por el
  // lado que no avisa.
  if (porLaPuerta.length === 0)
    noArranco.sinPrecondicion(
      'ninguna llamada a `hijoConPlazo` en todo scripts/',
      ['O la puerta cambió de nombre, o los 16 sitios se revirtieron a la vez.',
       'En los dos casos este barrido no mide nada y decir «verde» sería',
       'mentir.']);

  console.log(`   (${porLaPuerta.length} sitio(s) por la puerta · ` +
              `${[...fuera.values()].reduce((a, b) => a + b, 0)} con plazo propio)`);

  for (const [f, cuantos] of [...fuera].sort()) {
    const permiso = PLAZO_PROPIO.get(f);
    if (!permiso) {
      check(false, `${f} lanza ${cuantos} hijo(s) con plazo sin pasar por la puerta`,
        'un hijo muerto por el plazo le saldría como un rojo');
      continue;
    }
    check(cuantos === permiso.cuantos,
      `${f}: sus ${permiso.cuantos} sitio(s) de plazo propio siguen siendo ${permiso.cuantos}`,
      `encontró ${cuantos}`);
  }

  // La exclusión fantasma, por los dos lados. Una tabla de excepciones sin
  // mantener es una puerta sin llave: el precedente es el #133.
  for (const f of PLAZO_PROPIO.keys()) {
    if (!fs.existsSync(path.join(__dirname, f)))
      check(false, `la tabla nombra \`${f}\`, que no existe`,
        'borrar su renglón, o apuntarlo al archivo que sí está');
    else
      check(fuera.has(f), `\`${f}\` sigue teniendo sitios de plazo propio`,
        'ya no tiene ninguno: su renglón de la tabla sobra y hay que quitarlo');
  }
}

// ── 8. El criterio del reloj existe UNA vez ────────────────────────────────
//
// «Una cuenta por número». El criterio vivía sólo en el corredor y por eso los
// bancos no lo tenían; si vuelve a haber dos copias, pueden discrepar y el día
// que discrepen uno de los dos publicará un rojo falso. Se mide ejecutando la
// cuenta, no leyéndola.
console.log('\n8. La cuenta del reloj contesta en los bordes, y está en un sitio');
{
  // La primera versión comparaba `mod.relojCreible` contra el mismo módulo
  // pedido por otro camino y publicaba `MISMA=true`: una tautología, que es una
  // comprobación que no puede salir falsa y por tanto no afirma nada. Lo que
  // sostiene que el corredor use ESTA cuenta y no una propia está medido donde
  // corresponde: `prueba-corredor-no-se-cuelga` requiere el `no-arranco.cjs` de
  // su taller y lo ejecuta, y sus dos mutaciones del criterio salen en ROJO.
  // Aquí queda lo que sí es de este banco: que la cuenta conteste bien en los
  // bordes, y que el corredor no haya vuelto a teclear una segunda copia.
  const r = correr(`
    const mod = require(MOD);
    console.log('BORDES=' + [mod.relojCreible(240000, 250000),
                             mod.relojCreible(240000, 954000),
                             mod.relojCreible(10000, 20000),
                             mod.relojCreible(10000, 31000)].join(','));
    process.exit(0);`);
  check(/BORDES=true,false,true,false/.test(r.salida),
    'y contesta lo que tiene que contestar en los cuatro bordes medidos',
    (/BORDES=[^\s]*/.exec(r.salida) || ['nada'])[0]);

  // Y que nadie haya vuelto a teclear una segunda copia en el corredor.
  const corredor = fs.readFileSync(path.join(__dirname, 'pruebas.cjs'), 'utf8');
  check(!/^const relojCreible = /m.test(corredor),
    'el corredor ya no lleva su propia copia del criterio');
}

// ── Resultado ──────────────────────────────────────────────────────────────
console.log('');
if (fallas === 0) {
  console.log('VERDE — un hijo al que se lleva el plazo deja sin veredicto, no en rojo.\n');
} else {
  console.log(`ROJO — ${fallas} comprobación(es) fallaron.`);
  console.log('');
  console.log('Si lo que falló es el barrido: un hijo con plazo que no va por la');
  console.log('puerta publica un ROJO el día que la máquina se duerma, y un rojo');
  console.log('falso manda a buscar un defecto donde no hay ninguno.');
  console.log('');
}

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
//
// Se muta `no-arranco.cjs` —y uno de los bancos convertidos— y se exige que
// este banco lo vea EN ROJO (1), no en 2: un 2 sería el andamiaje cayéndose,
// que no es haber visto nada.
if (process.argv[2] === '--contraprueba') {
  console.log('── CONTRAPRUEBA ───────────────────────────────────────────────');
  const original = fs.readFileSync(MODULO, 'utf8');
  const unBanco = path.join(__dirname, 'prueba-un-numero-que-nadie-midio.cjs');
  const bancoOriginal = fs.readFileSync(unBanco, 'utf8');

  const MUTACIONES = [
    ['el reloj siempre cuadra: la máquina dormida se publica como un hijo lento',
     MODULO, 'tardó <= plazo * 1.25 + 10_000', 'true'],
    ['la puerta devuelve en vez de salir: el banco vuelve a comparar un `null`',
     MODULO, 'if (!loMatóElPlazo && !loMatóOtraCosa) return r;',
     'if (true) return r;'],
    // No «sale con 2 siempre»: ésa se lleva a este banco puesto —sus propios
    // hijos van por la puerta— y vuelve con 2, que es el andamiaje cayéndose y
    // no haber visto nada. Y además sería una avería a gritos: los 18 sitios
    // dejarían de medir en la misma corrida. La que hay que ver es la callada:
    // la puerta devuelve, sí, pero con un código que no es el del hijo.
    ['la puerta devuelve un código inventado en vez del que trajo el hijo',
     MODULO, 'if (!loMatóElPlazo && !loMatóOtraCosa) return r;',
     'if (!loMatóElPlazo && !loMatóOtraCosa) return { ...r, status: 0 };'],
    ['la puerta se traga el `ENOENT` y le quita al banco su diagnóstico',
     MODULO, "const loMatóElPlazo = !!(r.error && r.error.code === 'ETIMEDOUT');",
     'const loMatóElPlazo = !!r.error;'],
    ['el plazo deja de ser obligatorio: vuelve el hijo eterno',
     MODULO, 'if (!Number.isFinite(plazo) || plazo <= 0) {', 'if (false) {'],
    ['la frase no distingue: siempre dice los segundos que nadie esperó',
     MODULO, 'return relojCreible(plazo, tardó)', 'return true'],
    ['un banco ya convertido vuelve a `spawnSync`, que es la regresión de hoy',
     unBanco, 'noArranco.hijoConPlazo(process.execPath, [__filename], {',
     'require(\'child_process\').spawnSync(process.execPath, [__filename], {'],
  ];

  let vistas = 0;
  const { spawnSync } = require('child_process');
  for (const [titulo, archivo, de, a] of MUTACIONES) {
    const src = fs.readFileSync(archivo, 'utf8');
    if (!src.includes(de)) {
      console.log(`   ANCLA PERDIDA  «${titulo}»`);
      console.log('                  la mutación no se pudo aplicar: no mide nada.');
      continue;
    }
    fs.writeFileSync(archivo, src.split(de).join(a));
    let r;
    try {
      // El propio corredor de mutaciones va por la puerta, por lo mismo que
      // todos: un mutante al que se lleve el plazo no es un mutante vivo.
      r = noArranco.hijoConPlazo(process.execPath, [__filename],
        { encoding: 'utf8', timeout: 180000 });
    } finally {
      fs.writeFileSync(MODULO, original);
      fs.writeFileSync(unBanco, bancoOriginal);
    }
    const rojas = ((r.stdout || '').match(/^FALLA/gm) || []).length;
    const vio = r.status === 1 && rojas > 0;
    if (vio) vistas++;
    console.log(`   ${vio ? '✓' : '✗'} «${titulo}» → ` +
      (vio ? `ROJO (${rojas} en rojo)`
           : `salida ${r.status}, ${rojas} en rojo` +
             (r.status === 2 ? ' — el banco se cayó, que no es verlo' : '')));
  }
  console.log('');
  console.log(`${vistas} de ${MUTACIONES.length} mutaciones vistas en ROJO.`);
  // Una contraprueba que no ve todo lo que tira no es una contraprueba.
  if (vistas !== MUTACIONES.length) fallas++;
  console.log('');
  // La guarda del propio taller: si la restauración falló, lo que queda en el
  // árbol es un módulo mutado y el verde de nadie vale.
  if (fs.readFileSync(MODULO, 'utf8') !== original
      || fs.readFileSync(unBanco, 'utf8') !== bancoOriginal)
    noArranco.sinPrecondicion('el árbol quedó con un archivo mutado',
      ['Restaurarlo antes de creerle a nada:',
       '  git checkout -- scripts/no-arranco.cjs ' +
         'scripts/prueba-un-numero-que-nadie-midio.cjs']);
}

process.exit(fallas > 0 ? 1 : 0);
