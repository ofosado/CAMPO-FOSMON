#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LOS GUIONES DE MEDICIÓN SIGUEN ARRANCANDO — PENDIENTES #65
// ════════════════════════════════════════════════════════════════════════════
//
// Los bancos sacan el código de `src/App.jsx` por nombre y lo ejecutan. Eso
// tiene una consecuencia conocida: el día que alguien renombra el símbolo, la
// extracción deja de encontrarlo. Para los BANCOS eso está resuelto —salen con
// 2 y `npm test` grita—, pero los GUIONES DE MEDICIÓN no están en la suite, y
// nadie los ve morir.
//
// Murieron tres, y nadie se enteró:
//
//   · `medir-evidencia-para-migrar.cjs` pedía `fotosDeSub`
//   · `medir-fotos.cjs` pedía `conFotos` dentro de `FotosCliente`
//   · `medir-dano-semana-0125.cjs` leía `nominaSemanas` del oyente de nómina,
//     que hoy deja el crudo en `_nomDoc` y arma el calendario más tarde
//
// Importa porque son la herramienta con la que se decide una escritura a
// producción. El día que alguien quiera medir antes de migrar se encuentra el
// guion muerto, y la tentación va a ser migrar sin medir.
//
// Esto NO repite la lista de lo que pide cada guion. La LEE del guion: recorre
// `scripts/medir-*.cjs`, encuentra las llamadas a `deApp('x', 'y')`, y le pide
// esos mismos nombres al `deApp` de verdad contra el `src/App.jsx` de hoy. Una
// lista tecleada aquí sería la segunda copia, y se desincronizaría igual que
// los guiones.
//
// Contraprueba:  node scripts/prueba-herramientas-de-medicion-viven.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion } = require('./no-arranco.cjs');
const { deApp, SimboloPerdido, ARCHIVO } = require('./extraer-de-app.cjs');

vigilarExcepciones('scripts/medir-*.cjs y src/App.jsx');

const DIR_PROPIO = __dirname;
const RAIZ = path.join(DIR_PROPIO, '..');
// La contraprueba apunta esto a copias mutadas. El `deApp` sigue siendo el de
// verdad contra el `src/App.jsx` de verdad: lo que se muta es la PETICIÓN, que
// es la forma en que se manifiesta un renombre en la app.
const DIR = process.env.DIR_MEDICIONES || DIR_PROPIO;

const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

// ── Leer qué pide cada guion ────────────────────────────────────────────────
//
// Devuelve, por archivo: los nombres pedidos, los argumentos que NO son cadena
// literal (que esta prueba no puede exigir), si el archivo se parsea, y si lee
// `src/App.jsx` por su cuenta.
function cosechar(archivo) {
  const ruta = path.join(DIR, archivo);
  const texto = fs.readFileSync(ruta, 'utf8');
  const r = { archivo, pide: [], opacos: [], roto: null,
    leeLaAppPorSuCuenta: /@babel\/parser/.test(texto) && /src\/App\.jsx/.test(texto),
    usaDeApp: /\bdeApp\s*\(/.test(texto) };
  let ast;
  try { ast = parse(texto, { sourceType: 'module', plugins: ['jsx'] }); }
  catch (e) { r.roto = e.message.split('\n')[0]; return r; }
  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== 'deApp') return;
      for (const a of p.node.arguments) {
        if (a.type === 'StringLiteral') r.pide.push(a.value);
        else r.opacos.push(texto.slice(a.start, a.end).slice(0, 40));
      }
    },
  });
  return r;
}

let guiones;
try {
  guiones = fs.readdirSync(DIR).filter(f => /^medir-.*\.cjs$/.test(f)).sort();
} catch {
  sinPrecondicion(`no se pudo leer ${DIR}`,
    ['Ahí viven los guiones de medición. Sin ellos esto no mide nada.']);
}
if (guiones.length < 5)
  sinPrecondicion(`sólo se encontraron ${guiones.length} guion(es) de medición en ${DIR}`,
    ['Esperaba al menos cinco. Verde por vacío es la forma más barata de no',
     'comprobar nada: si el patrón del nombre cambió, esto deja de mirar.']);

const cosecha = guiones.map(cosechar);
const pidiendo = cosecha.filter(c => c.pide.length);
const totalSimbolos = pidiendo.reduce((t, c) => t + c.pide.length, 0);

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
//
// Las roturas son semánticas: se mete en COPIAS de los guiones exactamente el
// defecto que esto existe para atrapar, en las formas en que apareció de
// verdad. Si alguna no se ve, la prueba cubre menos de lo que dice.
if (process.argv.includes('--contraprueba')) {
  if (process.env.DIR_MEDICIONES)
    sinPrecondicion('la contraprueba corriendo sobre copias ya mutadas',
      ['Se invocó con DIR_MEDICIONES puesto. Eso mutaría lo mutado.']);

  const conPeticion = cosecha.find(c => c.pide.length >= 2);
  if (!conPeticion)
    sinPrecondicion('ningún guion que pida dos o más símbolos',
      ['Las mutaciones de renombre a medias necesitan una llamada con dos',
       'nombres. Sin eso no hay dónde meter el defecto.']);
  const [primero, segundo] = conPeticion.pide;

  const MUTACIONES = [
    ['un símbolo renombrado en la app',
      (t) => t.replace(`'${primero}'`, `'${primero}Renombrado'`)],
    ['el renombre histórico: el guion sigue pidiendo `fotosDeSub`',
      (t) => t.replace(`'${primero}'`, `'fotosDeSub'`)],
    ['el símbolo se movió DENTRO de un componente (`conFotos`)',
      (t) => t.replace(`'${primero}'`, `'conFotos'`)],
    ['un renombre a medias: el primer nombre está, el segundo no',
      (t) => t.replace(`'${segundo}'`, `'${segundo}SeFue'`)],
    ['un guion que lee src/App.jsx por su cuenta, sin pasar por `deApp`',
      (t) => t.replace(/\bdeApp\s*\(/g, 'extraerAMano(') +
        "\nconst _ = require('@babel/parser'); // src/App.jsx\n"],
    ['un guion con un error de sintaxis — muerto también, y callado',
      (t) => t + '\nconst (;\n'],
  ];

  let vistas = 0;
  for (const [nombre, romper] of MUTACIONES) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-mediciones-'));
    for (const g of guiones) fs.copyFileSync(path.join(DIR, g), path.join(tmp, g));
    const antes = fs.readFileSync(path.join(DIR, conPeticion.archivo), 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`NO LA VE  ${nombre}  ·  el ancla ya no está en ${conPeticion.archivo}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      continue;
    }
    fs.writeFileSync(path.join(tmp, conPeticion.archivo), despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, DIR_MEDICIONES: tmp },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const vio = r.status === 1 && /^FALLA/m.test(salida);
    console.log(`${vio ? 'ROJA     ' : 'NO LA VE '} ${nombre}` + (vio ? '' : `  ·  salió ${r.status}`));
    if (vio) vistas++;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: la prueba no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// Sin esta parada, el día que `deApp` se renombre o los guiones dejen de
// pedirle nada, esto daría verde sin haber ejercitado un solo símbolo.
if (pidiendo.length < 3 || totalSimbolos < 6)
  sinPrecondicion(`sólo ${pidiendo.length} guion(es) piden símbolos (${totalSimbolos} en total)`,
    ['Esperaba al menos tres guiones y seis símbolos. Esta prueba lee las',
     'llamadas a `deApp(\'x\')` en los guiones; si no encuentra ninguna, no',
     'está midiendo, está callada.']);

// ── Las comprobaciones ──────────────────────────────────────────────────────
console.log('\n── Los guiones de medición siguen arrancando ──');
console.log(`${guiones.length} guion(es) en ${path.relative(RAIZ, DIR) || '.'}; ` +
  `${pidiendo.length} piden ${totalSimbolos} símbolo(s) a ${path.relative(RAIZ, ARCHIVO)}\n`);

let fallas = 0, oks = 0;
const ok = (q) => { oks++; console.log(` ok   ${q}`); };
const falla = (q, esp, obt) => {
  fallas++; console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esp}`);
  console.log(`        obtuvo:   ${obt}`);
};

// §1. Cada símbolo que un guion pide sigue saliendo del archivo Y SE EJECUTA.
// `deApp` no comprueba que el nombre exista: reconstruye el código y lo corre.
for (const c of pidiendo) {
  const lista = c.pide.join(', ');
  try {
    const sacados = deApp(...c.pide);
    const vacios = c.pide.filter(n => sacados[n] === undefined);
    if (vacios.length) falla(`${c.archivo} saca lo que pide`, lista,
      `salió sin valor: ${vacios.join(', ')}`);
    else ok(`${c.archivo} · ${lista}`);
  } catch (e) {
    if (e instanceof SimboloPerdido)
      falla(`${c.archivo} saca lo que pide`, lista,
        `ya no está en el archivo: ${e.faltantes.map(n => `\`${n}\``).join(', ')}`);
    else
      falla(`${c.archivo} saca lo que pide`, lista,
        `reventó al ejecutarlo: ${e.message.split('\n')[0]}`);
  }
}

// §2. Un guion que arme la petición con una variable no se puede exigir desde
// aquí: la prueba lo daría por bueno sin haberlo mirado.
const opacos = cosecha.filter(c => c.opacos.length);
if (!opacos.length) ok('todas las peticiones son cadenas literales, legibles desde aquí');
else falla('todas las peticiones son cadenas literales', 'ninguna armada con variables',
  opacos.map(c => `${c.archivo}: deApp(${c.opacos.join(', ')})`).join(' · '));

// §3. Lo que no pasa por `deApp` queda fuera del alcance de esta prueba. Si se
// permite la puerta de atrás, el verde de arriba cubre menos de lo que dice.
const porFuera = cosecha.filter(c => c.leeLaAppPorSuCuenta && !c.usaDeApp);
if (!porFuera.length) ok('ningún guion extrae de src/App.jsx por fuera de `deApp`');
else falla('ningún guion extrae de src/App.jsx por fuera de `deApp`',
  'todos pasan por el portón',
  `${porFuera.length} por su cuenta: ${porFuera.map(c => c.archivo).join(', ')}`);

// §4. Un error de sintaxis mata el guion igual que un renombre, y además deja
// a esta prueba sin poder leer su petición.
const rotos = cosecha.filter(c => c.roto);
if (!rotos.length) ok(`los ${guiones.length} guiones se parsean`);
else falla('los guiones se parsean', `${guiones.length} sin errores de sintaxis`,
  rotos.map(c => `${c.archivo}: ${c.roto}`).join(' · '));

console.log('');
if (fallas) {
  console.log('Un guion de medición muerto no se nota hasta el día que hace');
  console.log('falta medir — y ese día es justo antes de escribir a producción.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);
