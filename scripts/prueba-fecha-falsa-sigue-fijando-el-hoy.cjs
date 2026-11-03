#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// `fecha-falsa.cjs` SIGUE FIJANDO EL HOY — y sigue sin tocar la zona
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE ESTO. `scripts/fecha-falsa.cjs` es la herramienta con la que
// se contesta "¿es una regresión o es el calendario?": fija `new Date()` y
// `Date.now()` en un instante para correr un banco en el día que uno quiera.
// Así se encontró el #29. Pero NINGÚN banco de la suite la carga —se usa a
// mano, con `--require`—, así que si un día deja de parchear nada, nadie se
// entera. Es el mismo defecto que #65 arregló para los `medir-*.cjs`, y la
// forma en que muere es peor: no revienta, **miente**. El banco corre con el
// hoy de verdad y da verde, y el verde se lee como "en ese día no falla".
//
// La herramienta llegó aquí rescatada de `feature/resumen-semanal`, que se
// cerró sin portar. Un rescate que nadie ejecuta es un cadáver en el árbol.
//
// CÓMO MIDE. No lee el archivo ni lo copia: lo CARGA con `--require` en un
// proceso aparte y le pregunta al `Date` de ese proceso qué contesta. Lo que
// se afirma es la conducta que la herramienta promete en su propia cabecera,
// incluidas las dos promesas negativas —que los argumentos pasan intactos y
// que la zona horaria NO se toca—, que son las que se rompen sin ruido.
//
// La zona la fija `scripts/reloj.cjs`, y a propósito está en otro lado. Si
// `fecha-falsa.cjs` empezara a tocar `TZ`, habría dos sitios decidiendo la
// zona y el banco que carga las dos vería una que no pidió. §6 lo vigila.
//
// Contraprueba:  node scripts/prueba-fecha-falsa-sigue-fijando-el-hoy.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion } = require('./no-arranco.cjs');

vigilarExcepciones('scripts/fecha-falsa.cjs');

const RAIZ = path.join(__dirname, '..');
// La contraprueba apunta esto a copias mutadas de la herramienta.
const HERRAMIENTA = process.env.RUTA_FECHA_FALSA
  || path.join(__dirname, 'fecha-falsa.cjs');

if (!fs.existsSync(HERRAMIENTA))
  sinPrecondicion(`no está ${path.relative(RAIZ, HERRAMIENTA)}`,
    ['Es la herramienta bajo prueba. Sin ella esto no mide nada; si se',
     'renombró, hay que renombrarla aquí también o la suite se queda muda.']);

// El instante fijo y la cadena con la que se pide. 2026-09-21 es el lunes con
// el que se encontró el #29, así que vale como caso de verdad.
const CADENA = '2026-09-21T18:00:00Z';
const FIJO = Date.parse(CADENA);

// ── Correr un programa con la herramienta puesta ───────────────────────────
// Devuelve { salida, texto, datos }. `datos` es lo que el programa imprimió
// como JSON; si murió, viene null y el texto trae el motivo.
function conLaHerramienta(programa, { fecha = CADENA, tz = 'UTC', conBarra = true } = {}) {
  const env = { ...process.env, TZ: tz, FORZAR_TZ: '1' };
  if (fecha === null) delete env.FECHA_FALSA; else env.FECHA_FALSA = fecha;
  const ruta = conBarra
    ? HERRAMIENTA
    // Sin `./` Node la busca en node_modules. La cabecera avisa de la trampa;
    // §7 comprueba que sigue siendo una muerte RUIDOSA y no un verde vacío.
    : path.relative(RAIZ, HERRAMIENTA);
  const r = spawnSync(process.execPath, ['--require', ruta, '-e', programa],
    { encoding: 'utf8', cwd: RAIZ, timeout: 60000, env });
  const texto = (r.stdout || '') + (r.stderr || '');
  let datos = null;
  const linea = (r.stdout || '').trim().split('\n').pop();
  try { datos = JSON.parse(linea); } catch { /* murió antes de imprimir */ }
  return { salida: r.status, texto, datos };
}

// El programa que se le hace correr: todo lo que la herramienta promete, en
// una sola lectura, para no pagar seis arranques de Node por comprobación.
const SONDA = `
  const sinArgs = new Date();
  const conCadena = new Date('2027-01-28T05:00:00Z');
  const conPartes = new Date(2027, 0, 28, 7, 0, 0);
  console.log(JSON.stringify({
    sinArgs: sinArgs.getTime(),
    ahora: Date.now(),
    conCadena: conCadena.getTime(),
    conPartes: conPartes.getFullYear() + '-' + conPartes.getMonth() + '-' + conPartes.getDate(),
    esDate: sinArgs instanceof Date,
    iso: sinArgs.toISOString(),
    horaLocal: sinArgs.getHours(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
`;

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
//
// Las roturas son semánticas: se le quita a COPIAS de la herramienta cada una
// de las promesas de su cabecera. Si alguna no se ve, este banco cubre menos
// de lo que dice y la herramienta puede morir igual.
if (process.argv.includes('--contraprueba')) {
  if (process.env.RUTA_FECHA_FALSA)
    sinPrecondicion('la contraprueba corriendo sobre una copia ya mutada',
      ['Se invocó con RUTA_FECHA_FALSA puesto. Eso mutaría lo mutado.']);

  const MUTACIONES = [
    ['no parchea nada: deja el `Date` de verdad',
      (t) => t.replace('global.Date = DateFija;', '// global.Date = DateFija;')],
    ['`Date.now()` vuelve al reloj real',
      (t) => t.replace('static now() { return FIJO; }', 'static now() { return Real.now(); }')],
    ['se come los argumentos: toda fecha es la fija',
      (t) => t.replace('if (args.length === 0) super(FIJO);\n    else super(...args);',
        'super(FIJO);')],
    ['se traga la variable que falta y se inventa un hoy',
      (t) => t.replace("if (!bruto) {\n  throw new Error('fecha-falsa.cjs: falta FECHA_FALSA (p.ej. 2026-09-21T12:00:00Z)');\n}",
        'const _hoy = Date.now();')
        .replace('const FIJO = new Real(bruto).getTime();',
          'const FIJO = bruto ? new Real(bruto).getTime() : _hoy;')],
    ['acepta una fecha que no se entiende y fija NaN',
      (t) => t.replace('if (Number.isNaN(FIJO)) {', 'if (false) {')],
    ['además fija la zona horaria, que no es su trabajo',
      (t) => t.replace('const Real = Date;', "process.env.TZ = 'UTC';\nconst Real = Date;")],
  ];

  let vistas = 0;
  for (const [nombre, romper] of MUTACIONES) {
    const antes = fs.readFileSync(HERRAMIENTA, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}  ·  el ancla ya no está en el archivo`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-fecha-falsa-'));
    const copia = path.join(dir, 'fecha-falsa.cjs');
    fs.writeFileSync(copia, despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, RUTA_FECHA_FALSA: copia },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const rojas = (salida.match(/^FALLA/gm) || []).length;
    const vio = r.status === 1 && rojas > 0;
    console.log(`${vio ? `ROJA ×${rojas}`.padEnd(12) : 'NO LA VE    '} ${nombre}`
      + (vio ? '' : `  ·  salió ${r.status}`
        + (r.status === 2 ? ' (el banco se cayó, que no es lo mismo que ver el defecto)' : '')));
    if (vio) vistas++;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: el banco no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── Las comprobaciones ─────────────────────────────────────────────────────
console.log('\n── `fecha-falsa.cjs` sigue fijando el hoy ──');
console.log(`herramienta: ${path.relative(RAIZ, HERRAMIENTA)} · instante: ${CADENA}\n`);

let fallas = 0, oks = 0;
const ok = (q) => { oks++; console.log(` ok   ${q}`); };
const falla = (q, esp, obt) => {
  fallas++; console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esp}`);
  console.log(`        obtuvo:   ${obt}`);
};

const puesta = conLaHerramienta(SONDA);
if (!puesta.datos)
  sinPrecondicion('la herramienta no dejó correr ni la sonda',
    [`salió ${puesta.salida}`, ...puesta.texto.trim().split('\n').slice(0, 4),
      'Sin una sonda que conteste no hay nada que afirmar.']);
const d = puesta.datos;

// §1. `new Date()` sin argumentos es el instante pedido, no el de hoy.
if (d.sinArgs === FIJO) ok(`\`new Date()\` da ${d.iso}`);
else falla('`new Date()` da el instante pedido', `${FIJO} (${CADENA})`,
  `${d.sinArgs} (${d.iso}) — ${Math.round((d.sinArgs - FIJO) / 86400000)} día(s) de diferencia`);

// §2. `Date.now()` también. Media base de código mide con uno y media con el
// otro; parchear sólo el constructor deja la mitad corriendo en el día real.
if (d.ahora === FIJO) ok('`Date.now()` da el mismo instante');
else falla('`Date.now()` da el instante pedido', String(FIJO),
  `${d.ahora} — el constructor quedó fijo y el reloj no`);

// §3. Con argumentos NO se toca. Los bancos construyen fechas a propósito
// ("el snapshot de hace 9 semanas"); si el parcheo se las come, todas las
// fechas del escenario colapsan al mismo día y el banco afirma sobre un
// escenario que no existe — y encima da verde.
const esperadoCadena = Date.parse('2027-01-28T05:00:00Z');
if (d.conCadena === esperadoCadena && d.conPartes === '2027-0-28')
  ok('`new Date(...)` con argumentos pasa intacto (cadena y partes)');
else falla('`new Date(...)` con argumentos pasa intacto',
  `${esperadoCadena} y 2027-0-28`, `${d.conCadena} y ${d.conPartes}`);

// §4. Sigue siendo un `Date` de verdad: es una subclase, no un objeto nuevo.
if (d.esDate) ok('lo que devuelve sigue siendo `instanceof Date`');
else falla('lo que devuelve sigue siendo `instanceof Date`', 'true',
  'false — el parcheo cambió el tipo, no sólo el valor');

// §5. Sin la variable, muere RUIDOSA. Inventarse un hoy por omisión sería la
// peor de las salidas: el `--require` estaría puesto y no haría nada.
const sinVar = conLaHerramienta(SONDA, { fecha: null });
if (sinVar.salida !== 0 && /FECHA_FALSA/.test(sinVar.texto) && !sinVar.datos)
  ok('sin `FECHA_FALSA` muere y lo dice (no se inventa un hoy)');
else falla('sin `FECHA_FALSA` muere y lo dice', 'salida ≠ 0 y el nombre de la variable',
  `salió ${sinVar.salida}${sinVar.datos ? ` y la sonda corrió con hoy=${sinVar.datos.iso}` : ''}`);

// §5b. Una fecha que no se entiende tiene que morir, no fijar NaN: con NaN
// todas las cuentas del banco salen `Invalid Date` y el diagnóstico se va
// horas por el camino equivocado.
const basura = conLaHerramienta(SONDA, { fecha: 'el lunes pasado' });
if (basura.salida !== 0 && /no se entiende/.test(basura.texto) && !basura.datos)
  ok('una fecha ilegible muere y la cita, en vez de fijar NaN');
else falla('una fecha ilegible muere y la cita', 'salida ≠ 0 citando el valor',
  `salió ${basura.salida}${basura.datos ? ` con hoy=${basura.datos.iso}` : ''}`);

// §6. NO toca la zona horaria: ése es el trabajo de `reloj.cjs`, y por eso
// están separadas. Se mide con dos zonas distintas: el MISMO instante fijo
// tiene que pintar horas locales distintas. Si las dos salen iguales, algo
// aquí dentro decidió la zona.
const enTokio = conLaHerramienta(SONDA, { tz: 'Asia/Tokyo' });
if (!enTokio.datos)
  falla('la zona la sigue decidiendo el entorno', 'una sonda que conteste bajo TZ=Asia/Tokyo',
    `salió ${enTokio.salida}`);
else if (enTokio.datos.tz === 'Asia/Tokyo' && d.tz === 'UTC'
  && enTokio.datos.horaLocal !== d.horaLocal)
  ok(`la zona la sigue decidiendo el entorno (UTC ${d.horaLocal}h · Tokio ${enTokio.datos.horaLocal}h)`);
else falla('la zona la sigue decidiendo el entorno (`reloj.cjs` es quien la fija)',
  'horas locales distintas bajo UTC y Asia/Tokyo',
  `${d.tz} ${d.horaLocal}h y ${enTokio.datos.tz} ${enTokio.datos.horaLocal}h`);

// §7. La trampa de la cabecera: sin `./` Node la busca como paquete. Lo que
// se exige no es que falle —eso lo decide Node—, sino que falle RUIDOSAMENTE:
// salida ≠ 0 y sin sonda. El día que un `grep -c '✗'` envuelva esto, un cero
// callado se lee como verde.
const sinBarra = conLaHerramienta(SONDA, { conBarra: false });
if (sinBarra.datos && sinBarra.datos.sinArgs === FIJO)
  ok('sin `./` Node ya la resuelve igual (la cabecera puede quitar el aviso)');
else if (sinBarra.salida !== 0 && !sinBarra.datos)
  ok('sin `./` muere ruidosamente, como avisa la cabecera');
else falla('sin `./` o funciona o muere ruidosamente', 'salida ≠ 0, o la sonda con el instante fijo',
  `salió ${sinBarra.salida}${sinBarra.datos ? ` con hoy=${sinBarra.datos.iso}` : ' sin sonda'}`);

console.log('');
if (fallas) {
  console.log('Esta herramienta no revienta cuando se rompe: deja correr el banco');
  console.log('con el hoy de verdad y lo pinta verde. El verde se lee entonces como');
  console.log('"en ese día del calendario no falla", y nadie corrió ese día.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);
