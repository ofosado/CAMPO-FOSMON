#!/usr/bin/env node
// Un número que nadie midió no se publica, ni en pantalla ni en el correo.
//
// QUÉ SE AFIRMA. Que los dos sitios donde el código escribía una cifra para
// tapar un dato ausente ahora dicen que falta:
//
//   #58 (el EST-NaN) — el consecutivo de la estimación. `Math.max` con un solo
//       `NaN` adentro devuelve `NaN`, así que UNA fila guardada sin `no` dejaba
//       a la obra ENTERA sin poder dar de alta estimaciones con número, y el
//       rótulo salía «EST-NaN» en pantalla, en las notificaciones y en el PDF
//       que se entrega firmado. Dos sitios lo tapaban con la POSICIÓN DE LA
//       FILA (`e.no ?? i+1`), que es peor: «EST-04» es creíble y es falso.
//
//   #79 (el 999 del correo del lunes) — `calcularKpisObra` escribía `999` días
//       sin captura cuando no había fecha, y el correo de dirección lo imprimía
//       en rojo como «Sin captura 999d». Medido en producción el 2026-11-05,
//       dos obras ACTIVAS recién dadas de alta —0128 y 0131— recibían esa
//       acusación cada lunes. No están atrasadas: no han empezado.
//
// Y una tercera cosa que apareció al medir: ese 999 no sólo rellenaba, también
// medía OTRA COSA. Leía `avance/subs.fecha` —cuándo se guardó el catálogo de
// conceptos— mientras `recordatorioLunes` cuenta desde la última semana cerrada
// en `avance/historial`. Dos fuentes para el mismo número, en dos correos que
// se mandan el mismo día a dos personas que se hablan.
//
// LA FORMA DE AFIRMARLO. Se EJECUTAN las cuentas extraídas de los dos archivos
// —no se compara su texto— y además se dibuja el PDF de verdad con un lienzo
// falso para ver qué manda a imprimir. Un banco que buscara la cadena «EST-»
// en el archivo se rompería con un comentario y no se rompería con una rama
// que vuelve a inventar el número.
//
// La sección 0 no prueba la aplicación: protege al banco. Si la fixture no
// produjera de verdad los estados distintos, todo lo de abajo pasaría por
// vacío.
//
// Uso:  node scripts/prueba-un-numero-que-nadie-midio.cjs
//       node scripts/prueba-un-numero-que-nadie-midio.cjs --contraprueba
//
// Tres estados: verde 0 · ROJO 1 · NO ARRANCÓ 2.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion, vigilarExcepciones } = noArranco;

const RAIZ = path.resolve(__dirname, '..');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');
const ARCH_FN = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');

vigilarExcepciones('src/App.jsx', 'functions/index.js');

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_APP || process.env.ARCH_FUNCIONES)
    sinPrecondicion('la contraprueba corriendo sobre una copia ya mutada',
      ['Se invocó con ARCH_APP o ARCH_FUNCIONES puesta.']);

  // Cada mutación es una forma de VOLVER a inventar el número. Las que tocan
  // `src/App.jsx` van con `app`, las de `functions/index.js` con `fn`.
  const MUTACIONES = [
    // ── El consecutivo vuelve a envenenarse ─────────────────────────────────
    ['app', 'el `no` ausente vuelve a entrar crudo al máximo: una fila lo tumba todo',
      (t) => t.replace(
        '  const usados = (Array.isArray(estimaciones) ? estimaciones : [])\n    .map(noDeEstimacion)\n    .filter((n) => n !== null);',
        '  const usados = (Array.isArray(estimaciones) ? estimaciones : []).map((e) => Number(e?.no));')],
    ['app', '`noDeEstimacion` acepta cualquier cosa y la deja pasar como número',
      (t) => t.replace('  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;',
        '  return n;')],
    ['app', 'el consecutivo de la primera estimación se vuelve cero',
      (t) => t.replace('  return usados.length ? Math.max(...usados) + 1 : 1;',
        '  return usados.length ? Math.max(...usados) + 1 : 0;')],
    ['app', 'el cero guardado se acepta como consecutivo: la EST-00 existe',
      (t) => t.replace('  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;',
        '  return Number.isFinite(n) ? Math.trunc(n) : null;')],

    // ── El rótulo vuelve a publicar lo que no se midió ──────────────────────
    ['app', 'el rótulo vuelve a imprimir el `no` crudo, con NaN y todo',
      (t) => t.replace(
        "  return n === null ? ROTULO_EST_SIN_NUMERO : `EST-${String(n).padStart(2, '0')}`;",
        "  return `EST-${String(e?.no).padStart(2, '0')}`;")],
    ['app', 'el rótulo tapa el hueco con la POSICIÓN de la fila',
      (t) => t.replace('const rotuloEstimacion = (e) => {\n  const n = noDeEstimacion(e);',
        'const rotuloEstimacion = (e, i = 0) => {\n  const n = noDeEstimacion(e) ?? (i + 1);')],
    ['app', 'el rótulo del hueco se vuelve una cadena que no dice nada',
      (t) => t.replace("const ROTULO_EST_SIN_NUMERO = 'EST-s/n';",
        "const ROTULO_EST_SIN_NUMERO = '';")],
    ['app', 'el rótulo del hueco se disfraza de consecutivo real',
      (t) => t.replace("const ROTULO_EST_SIN_NUMERO = 'EST-s/n';",
        "const ROTULO_EST_SIN_NUMERO = 'EST-01';")],

    // ── El orden vuelve a regalarle el lugar 0 al hueco ────────────────────
    ['app', 'la fila sin numerar vuelve al lugar 0: el acumulado de la EST-01 se infla',
      (t) => t.replace(
        'const ordenDeEstimaciones = (a, b) => {\n  const na = noDeEstimacion(a);\n  const nb = noDeEstimacion(b);',
        'const ordenDeEstimaciones = (a, b) => {\n  const na = noDeEstimacion(a) || 0;\n  const nb = noDeEstimacion(b) || 0;\n  return na - nb;\n  // eslint-disable-next-line no-unreachable')],
    ['app', 'las numeradas dejan de ir en orden de número',
      (t) => t.replace('  return na - nb;\n};', '  return nb - na;\n};')],
    // Que las DOS tablas usen esta orden —y no una copia suya— lo vigila
    // `prueba-estado-de-cuenta.cjs`, que las renderiza y lee el acumulado de
    // cada renglón. Aquí no se puede: este banco no monta componentes, así que
    // una mutación en el sitio de llamada se iría en «NO LA VE» y daría la
    // impresión falsa de que nadie la cubre.

    // ── El PDF deja de usar la cuenta única ─────────────────────────────────
    ['app', 'la tabla de estimaciones del PDF se vuelve a rotular sola',
      (t) => t.replace('        rotuloEstimacion(e),\n        e.periodo||\'\',',
        "        `EST-${String(e.no).padStart(2,'0')}`,\n        e.periodo||'',")],
    ['app', 'el detalle de estimaciones del PDF se vuelve a rotular solo',
      (t) => t.replace('      T(rotuloEstimacion(d), ML, rowY + 5);',
        "      T(`EST-${String(d.no).padStart(2,'0')}`, ML, rowY + 5);")],
    ['app', 'el expediente vuelve a descartar la estimación sin etiqueta, con su dinero',
      (t) => t.replace('  const estActivas=estimaciones.filter(e=>e.monto>0);',
        '  const estActivas=estimaciones.filter(e=>e.no&&e.monto>0);')],

    // ── El correo del lunes vuelve a rellenar ───────────────────────────────
    ['fn', 'el 999 regresa a `calcularKpisObra`',
      (t) => t.replace('  const diasDesdeCaptura = diasSinCapturaDe(semanasCerradas);',
        '  const diasDesdeCaptura = diasSinCapturaDe(semanasCerradas) ?? 999;')],
    ['fn', 'el hueco se vuelve un cero, que se lee «capturaron hoy»',
      (t) => t.replace('  const diasDesdeCaptura = diasSinCapturaDe(semanasCerradas);',
        '  const diasDesdeCaptura = diasSinCapturaDe(semanasCerradas) ?? 0;')],
    ['fn', '`calcularKpisObra` vuelve a tener su propia cuenta, sobre otra fuente',
      (t) => t.replace('  const diasDesdeCaptura = diasSinCapturaDe(semanasCerradas);',
        '  const _f = subsSnap.exists ? subsSnap.data().fecha : null;\n'
        + '  const diasDesdeCaptura = _f ? Math.floor((Date.now() - new Date(_f).getTime()) / 86400000) : null;')],
    ['fn', 'la marca de captura pinta el hueco de rojo como si fuera atraso',
      (t) => t.replace(
        '  if (dias === null || dias === undefined) {\n    return `<span style="color:#9AA0AC;font-size:11px;font-style:italic;">Sin cierre semanal aún</span>`;\n  }',
        '  if (dias === null || dias === undefined) { dias = 999; }')],
    ['fn', 'la marca de captura imprime el hueco como un número de días',
      (t) => t.replace('return `<span style="color:#9AA0AC;font-size:11px;font-style:italic;">Sin cierre semanal aún</span>`;',
        'return `<span style="color:#9AA0AC;font-size:11px;">Captura: ${dias}d</span>`;')],

    // ── El resumen vuelve a mezclar o a callar ──────────────────────────────
    ['fn', 'las obras que nunca cerraron desaparecen del resumen',
      (t) => t.replace('  if (sinUnCierre > 0) {',
        '  if (false && sinUnCierre > 0) {')],
    ['fn', 'las que nunca cerraron se cuentan entre las atrasadas otra vez',
      (t) => t.replace('  const obrasSinCaptura = kpisObras.filter(k => k.diasDesdeCaptura !== null && k.diasDesdeCaptura > 7).length;\n  const obrasSinUnCierre = kpisObras.filter(k => k.diasDesdeCaptura === null).length;',
        '  const obrasSinCaptura = kpisObras.filter(k => k.diasDesdeCaptura === null || k.diasDesdeCaptura > 7).length;\n  const obrasSinUnCierre = 0;')],
    ['fn', 'el aviso de captura se calla del todo',
      (t) => t.replace('  if (!partes.length) return "";',
        '  return "";\n  if (!partes.length) return "";')],
    ['fn', 'la fila del correo deja de usar la marca única',
      (t) => t.replace('    const alertaCaptura = bloqueCaptura(k.diasDesdeCaptura);',
        '    const alertaCaptura = `<span style="color:#9AA0AC;font-size:11px;">Captura: ${k.diasDesdeCaptura}d</span>`;')],
  ];

  let vistas = 0;
  for (const [cual, nombre, romper] of MUTACIONES) {
    const origen = cual === 'app' ? path.join(RAIZ, 'src/App.jsx') : path.join(RAIZ, 'functions/index.js');
    const antes = fs.readFileSync(origen, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}  ·  el ancla ya no está en ${cual === 'app' ? 'src/App.jsx' : 'functions/index.js'}`);
      process.exitCode = 2;
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-relleno-'));
    const copia = path.join(dir, cual === 'app' ? 'App.jsx' : 'index.js');
    fs.writeFileSync(copia, despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 180000,
      env: { ...process.env, [cual === 'app' ? 'ARCH_APP' : 'ARCH_FUNCIONES']: copia },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const rojas = (salida.match(/FALLA/g) || []).length;
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
  if (process.exitCode === 2) process.exit(2);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── utilería de reporte ────────────────────────────────────────────────────
let fallas = 0;
const CALLADO = !!process.env.CALLADO;
const ok = (t) => { if (!CALLADO) console.log('   ok    ' + t); };
const mal = (t, d) => {
  fallas++;
  console.log('   FALLA ' + t);
  if (d) for (const x of [].concat(d)) console.log('         ' + x);
};
const exigir = (c, t, d) => (c ? ok(t) : mal(t, d));
const seccion = (t) => { if (!CALLADO) console.log('\n' + t); };

// ── el código vivo, de los dos archivos ────────────────────────────────────
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDF } = require('./lienzo-pdf.cjs');

let noDeEstimacion; let siguienteNoDeEstimacion; let rotuloEstimacion;
let ROTULO_EST_SIN_NUMERO; let ordenDeEstimaciones; let APP_dias;
let generarPDFObra;
let bloqueCaptura; let avisoDeCaptura; let correoResumenSemanal;
let FN_dias; let FN_kpis;

try {
  const pa = fuenteDe(ARCH_APP, ['noDeEstimacion', 'siguienteNoDeEstimacion',
    'rotuloEstimacion', 'ROTULO_EST_SIN_NUMERO', 'ordenDeEstimaciones',
    'diasSinCapturaDe', 'generarPDFObra']);
  if (pa.faltan.length) noArranco(pa.faltan, 'src/App.jsx');
  ({ noDeEstimacion, siguienteNoDeEstimacion, rotuloEstimacion,
    ROTULO_EST_SIN_NUMERO, ordenDeEstimaciones,
    diasSinCapturaDe: APP_dias, generarPDFObra } =
    new Function(`"use strict";\n${pa.cuerpo}\nreturn { noDeEstimacion, `
      + `siguienteNoDeEstimacion, rotuloEstimacion, ROTULO_EST_SIN_NUMERO, `
      + `ordenDeEstimaciones, diasSinCapturaDe, generarPDFObra };`)());

  const pf = fuenteDe(ARCH_FN, ['bloqueCaptura', 'avisoDeCaptura',
    'diasSinCapturaDe', 'correoResumenSemanal']);
  if (pf.faltan.length) noArranco(pf.faltan, 'functions/index.js');
  ({ bloqueCaptura, avisoDeCaptura, diasSinCapturaDe: FN_dias,
    correoResumenSemanal } = new Function(
    `"use strict";\n${pf.cuerpo}\nreturn { bloqueCaptura, avisoDeCaptura, `
    + `diasSinCapturaDe, correoResumenSemanal };`)());
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}

// `calcularKpisObra` habla con Firestore, así que su cierre arrastra
// `firebase-admin`. Se le sustituye el CARGADOR DE MÓDULOS, no el código: el
// cuerpo que corre es el del archivo, letra por letra.
let DOCS = {};
try {
  const piezas = fuenteDe(ARCH_FN, ['calcularKpisObra']);
  if (piezas.faltan.length) noArranco(piezas.faltan, 'functions/index.js');
  const dbFalso = {
    doc: (ruta) => ({
      get: async () => ({
        exists: Object.prototype.hasOwnProperty.call(DOCS, ruta),
        data: () => DOCS[ruta],
      }),
    }),
  };
  const requireFalso = (m) => {
    if (m === 'firebase-admin') return { firestore: () => dbFalso, initializeApp: () => {} };
    return new Proxy({}, { get: () => () => {} });
  };
  FN_kpis = new Function('require',
    `"use strict";\n${piezas.cuerpo}\nreturn calcularKpisObra;`)(requireFalso);
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}

// ── la fixture ─────────────────────────────────────────────────────────────
const DIA = 86400000;
const haceDias = (n) => new Date(Date.now() - n * DIA).toISOString().slice(0, 10);

// Cuatro maneras de que a una estimación le falte el `no`, todas vistas en
// datos reales: nunca escrito, escrito vacío, escrito como texto que no es
// número, y el cero que dejó el relleno viejo `parseInt(e.no) || 0`.
const SIN_NUMERO = [
  { que: 'nunca se escribió', e: { monto: 100, estatus: 'En proceso' } },
  { que: 'cadena vacía', e: { no: '', monto: 100 } },
  { que: 'texto que no es número', e: { no: '—', monto: 100 } },
  { que: 'el cero del relleno viejo', e: { no: 0, monto: 100 } },
];

// Una lista con tres estimaciones buenas y UNA sin numerar. Ésta es la que
// envenenaba la obra entera.
const ENVENENADA = [
  { no: 1, monto: 100 }, { no: 2, monto: 200 },
  { monto: 300 },
  { no: 5, monto: 400 },
];

// ════════════════════════════════════════════════════════════════════════════
seccion('0. LA FIXTURE PRODUCE DE VERDAD LOS ESTADOS QUE SE VAN A PROBAR');
// ════════════════════════════════════════════════════════════════════════════
// Esto no prueba la aplicación: protege al banco. Si `ENVENENADA` no tuviera
// de verdad una fila sin numerar, la sección 1 pasaría por vacío. Y si la
// cuenta VIEJA no reventara con esta misma entrada, el banco estaría midiendo
// un defecto que no existía.
{
  exigir(ENVENENADA.filter((e) => !('no' in e)).length === 1,
    'la lista envenenada trae exactamente una fila sin `no`',
    [`trae ${ENVENENADA.filter((e) => !('no' in e)).length}`]);

  const comoEra = (es) => (es.length > 0 ? Math.max(...es.map((e) => e.no)) : 0) + 1;
  exigir(Number.isNaN(comoEra(ENVENENADA)),
    'y la cuenta VIEJA sí devolvía NaN con ella — el defecto que se arregla existía',
    [`la cuenta vieja dio ${comoEra(ENVENENADA)}`]);

  exigir(SIN_NUMERO.length === 4 &&
    new Set(SIN_NUMERO.map((c) => String(c.e.no))).size === 4,
    'las cuatro maneras de no tener `no` son cuatro valores distintos');

  exigir(typeof ROTULO_EST_SIN_NUMERO === 'string' && ROTULO_EST_SIN_NUMERO.length > 0,
    'hay un rótulo para el hueco y no es la cadena vacía',
    [`es ${JSON.stringify(ROTULO_EST_SIN_NUMERO)}`]);

  // Esto es lo que impide que el banco se compruebe contra sí mismo. Las
  // secciones 2, 3 y 4 afirman «el hueco se rotula `ROTULO_EST_SIN_NUMERO`»,
  // o sea comparan el rótulo contra la constante que lo produce: si la
  // constante fuera «EST-01», el hueco se publicaría como un consecutivo real
  // y TODAS esas afirmaciones seguirían en verde. La única forma de cerrarlo
  // es exigirle a la constante una propiedad literal, y la propiedad es que no
  // tenga la forma de un consecutivo.
  exigir(!/^EST-\d+$/.test(ROTULO_EST_SIN_NUMERO),
    'y no se puede confundir con un consecutivo real: no es «EST-» y dígitos',
    [`es ${JSON.stringify(ROTULO_EST_SIN_NUMERO)} — con esa forma, todo lo de `
      + 'abajo compararía el hueco contra sí mismo']);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('1. UNA FILA SIN NUMERAR NO ENVENENA A TODA LA OBRA (#58)');
// ════════════════════════════════════════════════════════════════════════════
{
  const sig = siguienteNoDeEstimacion(ENVENENADA);
  exigir(Number.isFinite(sig),
    'con una fila sin `no`, el siguiente consecutivo sigue siendo un número',
    [`salió ${sig}`]);
  exigir(sig === 6,
    'y es el sucesor del número más alto QUE SÍ SE USÓ, no de la fila sin numerar',
    [`salió ${sig}, se esperaba 6 (el más alto usado es 5)`]);

  for (const c of SIN_NUMERO) {
    const sigC = siguienteNoDeEstimacion([{ no: 3, monto: 1 }, c.e]);
    exigir(sigC === 4, `${c.que}: el consecutivo sale 4, no NaN`, [`salió ${sigC}`]);
  }

  exigir(siguienteNoDeEstimacion([]) === 1,
    'la primera estimación de la obra es la 1');
  exigir(siguienteNoDeEstimacion(undefined) === 1,
    'y una lista que no llegó también arranca en 1, no en NaN ni en 0');

  // El gemelo de subcontratos hacía la MISMA cuenta con otra robustez. Una
  // cuenta por número: ahora las dos entran por aquí, así que si una lista se
  // numera distinta de la otra es porque los datos son distintos.
  const sub = [{ no: '3', monto: 1 }, { no: 7, monto: 2 }];
  exigir(siguienteNoDeEstimacion(sub) === 8,
    'un `no` guardado como texto cuenta igual que uno guardado como número',
    [`salió ${siguienteNoDeEstimacion(sub)}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('2. EL RÓTULO NO PUBLICA UN NÚMERO QUE NADIE MIDIÓ');
// ════════════════════════════════════════════════════════════════════════════
{
  for (const c of SIN_NUMERO) {
    const r = rotuloEstimacion(c.e);
    exigir(!/NaN|undefined|null/.test(r),
      `${c.que}: el rótulo no dice NaN ni undefined`, [`salió «${r}»`]);
    exigir(r === ROTULO_EST_SIN_NUMERO,
      `${c.que}: el rótulo es el del hueco`, [`salió «${r}»`]);
  }
  exigir(rotuloEstimacion(undefined) === ROTULO_EST_SIN_NUMERO,
    'una estimación que no llegó tampoco se rotula con un número');

  exigir(rotuloEstimacion({ no: 3 }) === 'EST-03',
    'con el número puesto, el rótulo lleva dos dígitos',
    [`salió «${rotuloEstimacion({ no: 3 })}»`]);
  // El `` `EST-0${e.no}` `` de las notificaciones decía «EST-012» para la 12.
  exigir(rotuloEstimacion({ no: 12 }) === 'EST-12',
    'y la estimación doce es la EST-12, no la EST-012',
    [`salió «${rotuloEstimacion({ no: 12 })}»`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('3. NI LA POSICIÓN DE LA FILA DISFRAZADA DE CONSECUTIVO');
// ════════════════════════════════════════════════════════════════════════════
// Dos sitios tapaban el hueco con `i+1`. Es el relleno más peligroso de los
// tres porque NO SE VE: «EST-04» es un rótulo perfectamente creíble. Y es
// falso: pueden faltar estimaciones, pueden venir desordenadas, y el
// consecutivo lo fija el oficio del cliente, no el renglón en que quedó.
{
  const lista = [{ no: 7, monto: 1 }, { monto: 2 }, { no: 9, monto: 3 }];
  const rotulos = lista.map((e, i) => rotuloEstimacion(e, i));
  exigir(rotulos[1] === ROTULO_EST_SIN_NUMERO,
    'la fila sin numerar en segundo lugar NO se rotula «EST-02»',
    [`la lista salió ${JSON.stringify(rotulos)}`]);
  exigir(!rotulos.includes('EST-02'),
    'y en ningún renglón aparece un consecutivo que viene del índice',
    [`la lista salió ${JSON.stringify(rotulos)}`]);
  // Que el rótulo no mire el índice se exige directamente: la misma
  // estimación, en cualquier posición, se rotula igual.
  const e = { monto: 5 };
  exigir(rotuloEstimacion(e, 0) === rotuloEstimacion(e, 41),
    'la misma estimación se rotula igual en el renglón 1 que en el 42');
}

// ════════════════════════════════════════════════════════════════════════════
seccion('3bis. EL ACUMULADO DE LA EST-01 NO LLEVA DINERO DE UNA FILA SIN LUGAR');
// ════════════════════════════════════════════════════════════════════════════
// El `||0` del orden —`(Number(a.no)||0) - (Number(b.no)||0)`— era el mismo
// relleno con otra cara: le daba el lugar 0 a la fila sin numerar, o sea la
// ponía ANTES de la primera, y el acumulado se suma en ese orden. Visto en el
// emulador con una estimación sin numerar de $1,850,000: el renglón de la
// EST-01 publicaba $6,050,000 de acumulado, cifra que no es de nadie, mientras
// el pie de la misma tabla afirmaba que el acumulado suma «por número de
// estimación, de la 1 en adelante».
//
// No se prueba el orden por el orden: se reconstruye el acumulado tal como lo
// hacen las dos tablas —sumando en el orden que da `ordenDeEstimaciones`— y se
// exige que el de cada renglón numerado sea exactamente lo que el pie promete.
{
  const lista = [{ no: 5, monto: 400 }, { monto: 1850 }, { no: 1, monto: 100 },
    { no: 2, monto: 200 }];
  const ordenado = [...lista].sort(ordenDeEstimaciones);

  exigir(noDeEstimacion(ordenado[ordenado.length - 1]) === null,
    'la fila sin numerar queda al FINAL de la relación, no antes de la primera',
    [`el orden salió ${JSON.stringify(ordenado.map(rotuloEstimacion))}`]);
  exigir(ordenado.slice(0, 3).map(rotuloEstimacion).join(' ') === 'EST-01 EST-02 EST-05',
    'y las numeradas quedan en orden de número, que es lo que el pie promete',
    [`el orden salió ${JSON.stringify(ordenado.map(rotuloEstimacion))}`]);

  // El acumulado, armado como lo arman las tablas.
  let a = 0;
  const acum = ordenado.map((e) => ({ rotulo: rotuloEstimacion(e), acum: (a += e.monto) }));
  const de = (r) => (acum.find((x) => x.rotulo === r) || {}).acum;

  exigir(de('EST-01') === 100,
    'el acumulado de la EST-01 es su propio monto: lo cobrado hasta la 1',
    [`salió ${de('EST-01')} — con la fila sin numerar delante salía 1950`]);
  exigir(de('EST-02') === 300,
    'el de la EST-02 es la 1 más la 2, y nada más');
  exigir(de('EST-05') === 700,
    'y el de la última numerada es la suma de las numeradas');
  exigir(de(ROTULO_EST_SIN_NUMERO) === 2550,
    'la fila sin numerar acumula el TOTAL de la relación, que es lo único '
    + 'cierto que se puede decir de ella',
    [`salió ${de(ROTULO_EST_SIN_NUMERO)} de un total de 2550`]);

  // Y el total de la relación no cambia por haberla movido: lo que se corrigió
  // es DE QUIÉN es cada acumulado, no cuánto hay.
  exigir(acum[acum.length - 1].acum === lista.reduce((t, e) => t + e.monto, 0),
    'el último acumulado sigue siendo el total: no se perdió ni se duplicó dinero');

  // Dos sin numerar no se pisan ni desaparecen.
  const dos = [{ monto: 10 }, { no: 1, monto: 100 }, { no: '', monto: 20 }];
  const ord2 = [...dos].sort(ordenDeEstimaciones);
  exigir(ord2.filter((e) => noDeEstimacion(e) === null).length === 2
    && noDeEstimacion(ord2[0]) === 1,
    'con dos sin numerar, las dos quedan atrás de la numerada y las dos siguen ahí',
    [`el orden salió ${JSON.stringify(ord2.map(rotuloEstimacion))}`]);
}

// Aquí no se busca una cadena en el archivo: se MUEVE el generador de PDF con
// un lienzo falso y se mira qué texto manda a dibujar. El PDF es el peor sitio
// donde puede salir un «EST-NaN» porque se imprime, se firma y se entrega.
// Vive en una función porque dibujar el PDF es asíncrono.
async function seccionDelPDF() {
  seccion('4. Y EL EXPEDIENTE QUE SE ENTREGA FIRMADO TAMPOCO');
  const obra = {
    id: '0199', nombre: 'Obra de prueba', contrato: 'CT-199', cliente: 'SIOP',
    presupuesto: 1000000, pctAnticipo: 10, pctFondoGar: 5,
    inicio: haceDias(60), fin: haceDias(-60),
  };
  const estimaciones = [
    { no: 1, monto: 100000, periodo: 'ene', estatus: 'Pagada' },
    { monto: 200000, periodo: 'feb', estatus: 'En proceso' },
  ];
  let dibujos;
  try {
    dibujos = await dibujarPDF(generarPDFObra, {}, obra, { estimaciones });
  } catch (e) {
    noArranco([`el PDF no se pudo dibujar: ${e && e.message}`], 'src/App.jsx');
  }
  const textos = dibujos.map((x) => x.texto);
  // `EST-` a secas y `EST-NaN` son las dos formas en que este generador
  // publicaba el hueco. Se miran los dos. El encabezado de columna dice
  // «EST / PERIODO», así que se pide el guion: sin él, el encabezado se cuela
  // entre los rótulos y la cuenta de abajo sale de más.
  const rotulos = textos.filter((t) => /^EST-/.test(t));
  const sucios = rotulos.filter((t) => /NaN|undefined|null/.test(t) || t === 'EST-');
  exigir(sucios.length === 0,
    'el PDF no manda a dibujar ningún «EST-NaN» ni «EST-» a secas',
    sucios.length ? [`dibujó: ${sucios.slice(0, 5).join(' · ')}`] : null);
  exigir(rotulos.includes('EST-01'),
    'la estimación numerada sí sale rotulada en el PDF',
    [`rótulos dibujados: ${rotulos.join(' · ') || '(ninguno)'}`]);
  exigir(rotulos.includes(ROTULO_EST_SIN_NUMERO),
    'y la que no tiene número sale diciendo que no lo tiene',
    [`rótulos dibujados: ${rotulos.join(' · ') || '(ninguno)'}`]);

  // Y la afirmación que de verdad paga esta sección, sobre LA TABLA, no sobre
  // el desglose de al lado. El filtro pedía `e.no && e.monto > 0`, pero el
  // TOTAL sale de `te`, que suma TODAS las estimaciones. Una fila sin etiqueta
  // salía de la tabla y seguía dentro del total DE ESA MISMA TABLA: el
  // expediente firmado enseñaba un total que no cuadra con sus renglones, y el
  // faltante sin nombre ni renglón.
  // LA tabla de estimaciones, no cualquier tabla: el expediente lleva una
  // docena y varias tienen columna de montos. Se la identifica por su
  // contenido —la que rotula la EST-01— y no por su número de orden, que
  // cambia cada vez que alguien agrega una hoja.
  const cualTabla = (dibujos.find((d) => d.tabla && d.texto === 'EST-01') || {}).tabla;
  if (!cualTabla) {
    mal('la tabla de estimaciones del expediente se encuentra en el lienzo',
      ['ninguna celda de tabla rotula EST-01 — las dos afirmaciones de abajo '
        + 'no se pueden hacer']);
  }
  const col = (n) => dibujos
    .filter((d) => d.tabla === cualTabla && d.celda === n).map((d) => d.texto);
  const primeraCol = col(0);
  exigir(primeraCol.includes('EST-01') && primeraCol.includes(ROTULO_EST_SIN_NUMERO),
    'las DOS estimaciones con dinero salen en la tabla del expediente, numeradas o no',
    [`la primera columna de las tablas trae: ${primeraCol.join(' · ') || '(nada)'}`]);
  // El renglón TOTAL de la tabla y sus propios renglones tienen que cuadrar.
  // Se lee de la tabla dibujada, no se recalcula: recalcularlo aquí sería
  // comprobar el banco contra sí mismo.
  const iTotal = primeraCol.indexOf('TOTAL');
  const montos = col(2);
  const centavos = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
  const renglones = montos.filter((_, i) => i !== iTotal).reduce(
    (t, m) => t + (centavos(m) || 0), 0);
  exigir(iTotal >= 0 && centavos(montos[iTotal]) === renglones,
    'y el TOTAL de la tabla es la suma de los renglones DE LA TABLA',
    [`TOTAL dibujado: ${montos[iTotal]} · suma de los renglones: ${renglones}`,
      `columna de montos: ${montos.join(' · ') || '(nada)'}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('5. EL CORREO DEL LUNES: TRES ESTADOS DE CAPTURA, NO DOS (#79)');
// ════════════════════════════════════════════════════════════════════════════
{
  const hueco = bloqueCaptura(null);
  const atrasada = bloqueCaptura(15);
  const alDia = bloqueCaptura(2);

  exigir(!/999/.test(hueco) && !/\d+d/.test(hueco),
    'la obra que nunca cerró una semana NO sale con un número de días',
    [`salió: ${hueco}`]);
  exigir(/aún|todav|sin cierre/i.test(hueco),
    'sale diciendo que todavía no hay cierre',
    [`salió: ${hueco}`]);
  exigir(!/A32D2D|FCEBEB/.test(hueco),
    'y NO se pinta de rojo: no se sabe no es estar atrasado',
    [`salió: ${hueco}`]);
  exigir(bloqueCaptura(undefined) === hueco,
    'un `undefined` se trata igual que un `null`: las dos son «no se pudo contar»');

  exigir(/15d/.test(atrasada) && /A32D2D/.test(atrasada),
    'la obra atrasada de verdad sí sale en rojo con sus días',
    [`salió: ${atrasada}`]);
  exigir(/2d/.test(alDia) && !/A32D2D/.test(alDia),
    'y la que capturó hace dos días sale apagada',
    [`salió: ${alDia}`]);

  // Los tres se tienen que ver DISTINTO entre sí. Dos iguales es el defecto.
  exigir(new Set([hueco, atrasada, alDia]).size === 3,
    'los tres estados producen tres textos distintos');
}

// ════════════════════════════════════════════════════════════════════════════
seccion('6. DEJAR DE ACUSAR NO ES CALLARSE');
// ════════════════════════════════════════════════════════════════════════════
// El arreglo saca del `> 7` a las obras que nunca cerraron. Si nadie las
// nombrara, se habría cambiado una acusación falsa por un silencio: las dos
// obras que el 2026-11-05 recibían «999d» desaparecerían del resumen.
{
  const soloAtrasadas = avisoDeCaptura(3, 0);
  const soloSinCierre = avisoDeCaptura(0, 2);
  const ambas = avisoDeCaptura(3, 2);
  const ninguna = avisoDeCaptura(0, 0);

  exigir(soloSinCierre !== '' && /2/.test(soloSinCierre),
    'dos obras sin un solo cierre SÍ se nombran en el resumen',
    [`salió: ${soloSinCierre}`]);
  exigir(!/sin captura en los últimos 7/.test(soloSinCierre),
    'y no se nombran como si llevaran siete días sin capturar',
    [`salió: ${soloSinCierre}`]);
  exigir(/3/.test(soloAtrasadas) && /7/.test(soloAtrasadas),
    'tres obras atrasadas se nombran como atrasadas',
    [`salió: ${soloAtrasadas}`]);
  exigir(/3/.test(ambas) && /2/.test(ambas),
    'y cuando hay de las dos, el aviso trae los dos conteos',
    [`salió: ${ambas}`]);
  exigir(ninguna === '',
    'sin nada que avisar, no hay recuadro rojo',
    [`salió: ${ninguna}`]);
  // El caso que importa de verdad: los dos conteos no se suman en uno.
  exigir(soloAtrasadas !== soloSinCierre,
    'una obra atrasada y una que nunca cerró no producen el mismo aviso');
  exigir(avisoDeCaptura(1, 0) !== avisoDeCaptura(0, 1),
    'ni con un solo caso de cada tipo');
}

// ════════════════════════════════════════════════════════════════════════════
seccion('7. `calcularKpisObra` NO RELLENA, Y CUENTA LO MISMO QUE LA PANTALLA');
// ════════════════════════════════════════════════════════════════════════════
(async () => {
  const base = (obraId) => ({
    [`obras/${obraId}/config/info`]: { nombre: `Obra ${obraId}`, presupuesto: 1000000 },
    [`obras/${obraId}/avance/subs`]: { data: [], fecha: haceDias(1) },
  });

  // (a) La obra recién dada de alta: catálogo guardado ayer, ningún cierre.
  // Antes salía 999 POR LAS DOS razones: el relleno y la fuente equivocada.
  DOCS = base('0128');
  const nueva = await FN_kpis('0128', null);
  exigir(nueva.diasDesdeCaptura === null,
    'obra sin un solo cierre semanal → `null`, no 999 ni 0',
    [`salió ${JSON.stringify(nueva.diasDesdeCaptura)}`]);

  // (b) El `avance/subs.fecha` de ayer NO se usa como si fuera una captura.
  // Ésa era la segunda cuenta: guardar el catálogo no es cerrar la semana.
  exigir(nueva.diasDesdeCaptura !== 1 && nueva.diasDesdeCaptura !== 0,
    'y guardar el catálogo de conceptos no se cuenta como haber capturado avance',
    [`\`avance/subs.fecha\` era de ayer y salió ${JSON.stringify(nueva.diasDesdeCaptura)}`]);

  // (c) Una obra con cierres: la cuenta sale, y sale igual que en la pantalla.
  const semanas = [
    { semana: 'S30', fechaCierre: haceDias(30) },
    { semana: 'S31', fechaCaptura: haceDias(12) },
  ];
  DOCS = { ...base('0112'), 'obras/0112/avance/historial': { semanas } };
  const vieja = await FN_kpis('0112', null);
  exigir(vieja.diasDesdeCaptura === 12,
    'obra cuyo último cierre fue hace 12 días → 12',
    [`salió ${JSON.stringify(vieja.diasDesdeCaptura)}`]);
  exigir(vieja.diasDesdeCaptura === APP_dias(semanas),
    'y es EXACTAMENTE la cuenta de la pantalla, sobre el mismo historial',
    [`correo: ${vieja.diasDesdeCaptura} · pantalla: ${APP_dias(semanas)}`]);
  exigir(FN_dias(semanas) === APP_dias(semanas),
    'las dos copias de `diasSinCapturaDe` siguen coincidiendo',
    [`funciones: ${FN_dias(semanas)} · pantalla: ${APP_dias(semanas)}`]);

  // (d) Un historial con una fecha que no es fecha tampoco produce un número.
  DOCS = { ...base('0131'), 'obras/0131/avance/historial': { semanas: [{ semana: 'S1', fechaCierre: 'ya mero' }] } };
  const rota = await FN_kpis('0131', null);
  exigir(rota.diasDesdeCaptura === null,
    'una fecha de cierre ilegible → `null`, no un número gigante',
    [`salió ${JSON.stringify(rota.diasDesdeCaptura)}`]);

  // ══════════════════════════════════════════════════════════════════════════
  seccion('8. Y EL CORREO COMPLETO NO IMPRIME EL RELLENO EN NINGUNA PARTE');
  // ══════════════════════════════════════════════════════════════════════════
  // Las secciones 5 y 6 prueban las piezas. Ésta arma el correo de verdad con
  // una obra de cada clase y mira el HTML que saldría: una pieza honesta
  // cableada al revés seguiría dando verde arriba.
  {
    const kpis = [
      { obraId: '0112', nombre: 'Malecón', contrato: 'CT-1', cliente: 'SIOP',
        presupuesto: 1000000, avancePct: 40, pctGasto: 30, totGasto: 300000,
        cobrado: 100000, gastoGPMedido: true, gastoGPMotivo: 'medido',
        diasDesdeCaptura: 12 },
      { obraId: '0128', nombre: 'Colector Pentágono', contrato: 'CT-2', cliente: 'SIOP',
        presupuesto: 2000000, avancePct: 0, pctGasto: 0, totGasto: 0,
        cobrado: 0, gastoGPMedido: true, gastoGPMotivo: 'medido',
        diasDesdeCaptura: null },
      { obraId: '0126', nombre: 'La Cangrejera', contrato: 'CT-3', cliente: 'SIOP',
        presupuesto: 3000000, avancePct: 80, pctGasto: 70, totGasto: 2100000,
        cobrado: 1500000, gastoGPMedido: true, gastoGPMotivo: 'medido',
        diasDesdeCaptura: 2 },
    ];
    let html;
    try {
      ({ html } = correoResumenSemanal(kpis, '9 de noviembre de 2026',
        { total: 0 }, { sinOrg: [], otra: [] }, { empresa: 'FOSMON' }));
    } catch (e) {
      noArranco([`el correo no se pudo armar: ${e && e.message}`], 'functions/index.js');
    }
    exigir(!/999/.test(html),
      'el correo armado no contiene un 999 en ninguna parte',
      ['aparece 999 en el HTML']);
    exigir(!/Sin captura nulld|Captura: nulld|Captura: undefinedd|NaNd/.test(html),
      'ni un «Captura: nulld» por dejar pasar el `null` al texto');
    exigir(/Sin cierre semanal aún/.test(html),
      'la obra sin cierres sale nombrada como tal en su renglón');
    exigir(/Sin captura 12d/.test(html),
      'la atrasada sale con sus doce días');
    exigir(/no ha cerrado/.test(html),
      'y el aviso de arriba nombra a la que no ha cerrado ni una semana');
    // Una sola obra atrasada: el aviso no la puede confundir con la otra.
    exigir(/1 obra sin captura/.test(html),
      'el conteo de atrasadas es 1 y no 2: la que nunca cerró no se le suma',
      ['el aviso de arriba no dice «1 obra sin captura»']);
  }

  await seccionDelPDF();

  // ── veredicto ─────────────────────────────────────────────────────────────
  console.log('');
  if (fallas) {
    console.log(`ROJO: ${fallas} afirmación(es) en rojo.`);
    process.exit(1);
  }
  console.log('Verde: ningún número inventado se publica.');
  process.exit(0);
})().catch((e) => {
  console.error('\nNO ARRANCÓ:', (e && e.stack) || e);
  process.exit(2);
});
