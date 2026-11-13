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
// ── POR QUÉ LA SECCIÓN 4 CAMBIÓ DE SITIO EL 2026-11-12 ─────────────────────
//
// `generarPDFObra` se retiró y el papel se partió en dos: `generarPDFArt73`
// para la dependencia y `generarPDFInterno` para la constructora. Con el papel
// viejo se fue la RELACIÓN DE ESTIMACIONES: ninguno de los dos imprime ya un
// renglón por estimación. Medido, no supuesto — `rotuloEstimacion` no aparece
// dentro de ningún generador, y dibujados los dos papeles con dos estimaciones
// cargadas no sale un solo texto que empiece con «EST-».
//
// Así que las tres afirmaciones de la sección 4 —«no se dibuja EST-NaN», «la
// numerada sale rotulada», «el TOTAL de la tabla es la suma de sus renglones»—
// se quedaron sin tabla que mirar. No se les busca un anclaje parecido: lo que
// queda del mismo defecto en los papeles de hoy es su mitad que importaba más.
//
// El defecto nunca fue el rótulo: era que una fila sin `no` perdiera su DINERO.
// El filtro viejo `e.no && e.monto > 0` la sacaba de la tabla y su importe
// seguía dentro del total DE ESA MISMA TABLA — un expediente firmado con un
// total que no cuadra con sus renglones y un faltante sin nombre. Hoy los dos
// papeles publican el agregado y no los renglones, así que la pregunta se hace
// sobre el agregado: con una estimación numerada de $100,000 y una SIN NUMERAR
// de $200,000, los dos papeles tienen que publicar $300,000. Y ninguno de los
// dos puede imprimir un «NaN» en ninguna hoja, que es la otra cara del mismo
// relleno.
//
// Al reanclar eso se midió algo que esta rama no arregla y que queda anotado en
// `PENDIENTES.md`: cada papel suma las estimaciones por su cuenta —el Art. 73
// con `corteDeEstimaciones`, el interno con `estTotal`— y las dos cuentas no
// tienen la misma robustez. Por eso aquí hay una mutación por papel.
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

    // ── Los dos papeles vuelven a perder dinero sin dueño ───────────────────
    // REANCLADAS el 2026-11-12. Las tres de antes apuntaban a la relación de
    // estimaciones del papel viejo, que ya no existe (ver el encabezado).
    //
    // Y al reanclarlas salió un hallazgo que esta rama NO arregla: la suma de
    // las estimaciones se cuenta DOS VECES, con dos robusteces distintas. El
    // informe del Art. 73 la saca de `corteDeEstimaciones` (`parseFloat`); el
    // documento interno, de `estTotal` dentro de `calcularKPIsObra` (`||0`,
    // que no lee un monto guardado como texto). Son dos papeles del mismo mes
    // sobre la misma obra, en manos de dos lectores que se hablan, y pueden
    // discrepar. Es un «una cuenta por número» esperando, y unificar una cuenta
    // de dinero no entra en una rama que parte un papel en dos: va a
    // `PENDIENTES.md` medido.
    //
    // Mientras eso siga así, cada papel necesita SU mutación: una sola no los
    // pone rojos a los dos, y presentarla como si lo hiciera sería decir que el
    // banco cubre dos cuentas cubriendo una.
    ['app', 'el total del informe del Art. 73 vuelve a descartar la fila sin número, con su dinero',
      (t) => t.replace('    estimado: estimaciones.reduce((t, e) => t + monto(e), 0),',
        '    estimado: estimaciones.filter(e => e?.no).reduce((t, e) => t + monto(e), 0),')],
    ['app', 'el total del documento interno vuelve a descartar la fila sin número',
      (t) => t.replace('  const estTotal  = estimaciones.reduce((t,e) => t + (e.monto||0), 0);',
        '  const estTotal  = estimaciones.filter(e=>e.no).reduce((t,e) => t + (e.monto||0), 0);')],
    ['app', 'el monto sin capturar vuelve a envenenar el total del Art. 73: dice NaN',
      (t) => t.replace('  const monto = e => parseFloat(e?.monto) || 0;',
        '  const monto = e => parseFloat(e?.monto);')],
    ['app', 'el monto sin capturar vuelve a envenenar el total del interno: dice NaN',
      (t) => t.replace('  const estTotal  = estimaciones.reduce((t,e) => t + (e.monto||0), 0);',
        '  const estTotal  = estimaciones.reduce((t,e) => t + e.monto, 0);')],

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
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');

let noDeEstimacion; let siguienteNoDeEstimacion; let rotuloEstimacion;
let ROTULO_EST_SIN_NUMERO; let ordenDeEstimaciones; let APP_dias;
let generarPDFArt73; let generarPDFInterno;
let bloqueCaptura; let avisoDeCaptura; let correoResumenSemanal;
let FN_dias; let FN_kpis;

try {
  const pa = fuenteDe(ARCH_APP, ['noDeEstimacion', 'siguienteNoDeEstimacion',
    'rotuloEstimacion', 'ROTULO_EST_SIN_NUMERO', 'ordenDeEstimaciones',
    'diasSinCapturaDe', 'generarPDFArt73', 'generarPDFInterno']);
  if (pa.faltan.length) noArranco(pa.faltan, 'src/App.jsx');
  ({ noDeEstimacion, siguienteNoDeEstimacion, rotuloEstimacion,
    ROTULO_EST_SIN_NUMERO, ordenDeEstimaciones,
    diasSinCapturaDe: APP_dias, generarPDFArt73, generarPDFInterno } =
    new Function(`"use strict";\n${pa.cuerpo}\nreturn { noDeEstimacion, `
      + `siguienteNoDeEstimacion, rotuloEstimacion, ROTULO_EST_SIN_NUMERO, `
      + `ordenDeEstimaciones, diasSinCapturaDe, generarPDFArt73, `
      + `generarPDFInterno };`)());

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
// El día se escribe en el calendario de la OBRA, que es donde lo cuenta el
// producto desde el #137. Estuvo en UTC a propósito mientras ese defecto vivía:
// `diasSinCapturaDe` hacía `new Date('2026-10-31')` —medianoche UTC— y lo
// restaba de un instante real, así que el fixture y el producto se equivocaban
// en la misma dirección y el error se cancelaba; con el día local, este banco
// salía ROJO a cualquier hora después de las 18:00 y en las cuatro fechas del
// barrido. Arreglada la cuenta, el día correcto es el de la obra y la aserción
// de «hace 12 días → 12» sigue diciendo 12 a cualquier hora.
//
// Con `Intl` y la zona explícita, no con `getDate()`: el día del aparato que
// corre la suite no es un hecho de la obra, y una máquina en otro huso movería
// el fixture sin mover el producto.
const DIA_DE_OBRA = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const haceDias = (n) => DIA_DE_OBRA(new Date(Date.now() - n * DIA));

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

// Aquí no se busca una cadena en el archivo: se MUEVEN los dos generadores con
// un lienzo falso y se mira qué texto mandan a dibujar. El papel es el peor
// sitio donde puede salir un número inventado porque se imprime, se firma y se
// entrega. Vive en una función porque dibujar el PDF es asíncrono.
async function seccionDelPDF() {
  seccion('4. Y LOS DOS PAPELES QUE SE ENTREGAN FIRMADOS TAMPOCO');
  const obra = {
    id: '0199', nombre: 'Obra de prueba', contrato: 'CT-199', cliente: 'SIOP',
    presupuesto: 1000000, pctAnticipo: 10, pctFondoGar: 5,
    inicio: haceDias(60), fin: haceDias(-60),
  };
  // Tres estimaciones y tres huecos distintos a propósito: una completa, una
  // SIN NÚMERO con dinero —la que el filtro viejo tiraba—, y una numerada SIN
  // MONTO, que es por donde entra el NaN. La suma honesta de las tres es
  // $300,000, y ese número NO se teclea en la afirmación: se arma aquí abajo
  // sumando la fixture, para que cambiar la fixture no obligue a cambiar dos
  // sitios y dejar uno viejo.
  const estimaciones = [
    { no: 1, monto: 100000, periodo: 'ene', estatus: 'Pagada' },
    { monto: 200000, periodo: 'feb', estatus: 'En proceso' },
    { no: 3, periodo: 'mar', estatus: 'En proceso' },
  ];
  const TOTAL = estimaciones.reduce((t, e) => t + (parseFloat(e.monto) || 0), 0);
  const MXN_ESP = `$${TOTAL.toLocaleString('en-US')}`;

  exigir(estimaciones.filter((e) => !('no' in e)).length === 1
    && estimaciones.filter((e) => !('monto' in e)).length === 1
    && TOTAL === 300000,
    'la fixture del papel trae un hueco de número, un hueco de monto, y suma 300000',
    [`sumó ${TOTAL}; sin los dos huecos, esta sección pasaría por vacío`]);

  const PAPELES = [['el informe del Art. 73', generarPDFArt73],
                   ['el documento interno', generarPDFInterno]];
  for (const [cual, generar] of PAPELES) {
    let dibujos;
    try {
      dibujos = await dibujarPDFInterno(generar,
        { obra, subs: [], estimaciones, estCargadas: true });
    } catch (e) {
      noArranco([`${cual} no se pudo dibujar: ${e && e.message}`], 'src/App.jsx');
    }
    const textos = dibujos.map((x) => String(x.texto));
    if (textos.length < 20)
      noArranco([`${cual} sólo dibujó ${textos.length} textos`,
        'Con el papel casi vacío, «no imprime un NaN» se cumple por no haber '
        + 'impreso nada.'], 'src/App.jsx');

    // El relleno, en la forma que tiene hoy: ya no es un rótulo «EST-NaN»
    // —ningún papel imprime renglón por estimación— sino un NaN que se cuela a
    // una cifra de dinero. Se barre la hoja entera porque el agregado aparece
    // en la tabla de la carátula Y en la prosa.
    const sucios = textos.filter((t) => /NaN|undefined|null/.test(t));
    exigir(sucios.length === 0,
      `${cual} no manda a dibujar ningún NaN, undefined ni null`,
      sucios.length ? [`dibujó: ${sucios.slice(0, 5).join(' · ')}`] : null);

    // Y la afirmación que de verdad paga esta sección: el dinero de la fila SIN
    // NÚMERO está dentro del total que el papel publica. El filtro viejo la
    // sacaba de la relación y su importe se quedaba en el total, de modo que el
    // papel firmado enseñaba un faltante sin nombre. Hoy no hay relación, pero
    // el total sigue siendo lo que se entrega — y tiene que ser el de todas.
    exigir(textos.includes(MXN_ESP),
      `${cual} publica ${MXN_ESP}: el dinero de la fila sin número está dentro`,
      [`no dibujó ${MXN_ESP}. Cifras de dinero en la hoja: `
        + `${[...new Set(textos.filter((t) => /^\$[\d,]+$/.test(t)))].join(' · ') || '(ninguna)'}`]);
  }
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
