#!/usr/bin/env node
// El correo del lunes no puede enseñar un cero que nadie midió.
//
// QUÉ SE AFIRMA. Que `functions/index.js` distingue «GP midió cero» de «GP no
// midió», que esa distinción llega intacta hasta el HTML del correo, y que el
// veredicto que da aquí es el MISMO que da la pantalla para la misma entrada.
//
// POR QUÉ EXISTE. `calcularKpisObra` tenía `let totGP = 0` y, si la obra no
// aparecía en el documento de gasto, se quedaba en cero sin decirlo. Los dos
// casos salían idénticos por el correo —misma cifra, mismo color, misma
// tipografía—, y no son lo mismo: con el gasto en cero el margen sale cerca
// del 100%, o sea todo ingreso y ningún costo. Esa obra se lee como la joya
// del portafolio. Y le toca justo a la recién dada de alta, que es la que más
// se mira la semana que entra.
//
// El #88 (la tarjeta que pintaba un margen inflado) cerró esto EN LA PANTALLA:
// `presentacionEconomiaObra` ya dice «gasto sin medir» y apaga el color. El
// correo del lunes nunca se enteró, y el correo es lo que llega a Dirección
// sin que nadie abra la app. Es el mismo defecto por el otro despliegue.
//
// LA FORMA DE AFIRMARLO. No se compara el texto de las dos copias: se corren
// las dos sobre la misma matriz de entradas y se exige el mismo VEREDICTO. Un
// banco que comparara el código se rompería con un comentario y no se rompería
// con una rama que cambia de signo.
//
// Uso:  node scripts/prueba-el-gasto-sin-medir-no-es-cero.cjs
//       node scripts/prueba-el-gasto-sin-medir-no-es-cero.cjs --contraprueba
//
// La contraprueba corre el banco contra copias mutadas de `functions/index.js`
// (variable `ARCH_FUNCIONES`) y exige que CADA mutación lo ponga en ROJO con
// salida 1. Un 2 no cuenta: el banco cayéndose no es el banco viendo el
// defecto.
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
const ARCH_FN = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');

vigilarExcepciones('src/App.jsx', 'functions/index.js');

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_FUNCIONES)
    sinPrecondicion('la contraprueba corriendo sobre una copia ya mutada',
      ['Se invocó con ARCH_FUNCIONES puesta.']);

  const MUTACIONES = [
    // ── El veredicto se vuelve a perder en el origen ────────────────────────
    ['el gasto que no se pudo medir vuelve a ser un cero mudo',
      (t) => t.replace("      return sinDato('no-pedida');",
        "      return medido(0, 'no-pedida');")],
    ['`sin-match` se declara medido: el campo legacy pasa por gasto de GP',
      (t) => t.replace("  return sinDato('sin-match', obra?.gastoGP || 0);",
        "  return medido(obra?.gastoGP || 0, 'sin-match');")],
    ['un documento viejo sin `obrasPedidas` se trata como cero medido',
      (t) => t.replace("    return sinDato('no-se-puede-saber');",
        "    return medido(0, 'no-se-puede-saber');")],
    ['el cero MEDIDO se declara sin medir: se apaga lo que sí se sabe',
      (t) => t.replace("    if (pedida === true) return medido(0, 'sin-cheques');",
        "    if (pedida === true) return sinDato('sin-cheques');")],
    // ── La copia se desvía de la de la pantalla ─────────────────────────────
    ['la copia de las funciones afloja el match por nombre a una palabra',
      (t) => t.replace("  if (score >= 2 && mejor) return medido(extraerGastoTotalGP(mejor), 'por-nombre');",
        "  if (score >= 1 && mejor) return medido(extraerGastoTotalGP(mejor), 'por-nombre');")],
    ['la clave que no cuadra vuelve a caer al match difuso',
      (t) => t.replace("    return veredictoDeClaveAusente(obra.gpId, 'capturada en Contrato');",
        "    // (cae al difuso)")],
    // ── El veredicto no llega a los KPIs ────────────────────────────────────
    ['`calcularKpisObra` devuelve la cifra y se calla el veredicto',
      (t) => t.replace('    gastoGPMedido: gpEstado.medido, gastoGPMotivo: gpEstado.motivo,',
        "    gastoGPMedido: true, gastoGPMotivo: 'medido',")],
    // ── El correo vuelve a afirmar ──────────────────────────────────────────
    ['la fila del correo imprime el importe corto de todos modos',
      (t) => t.replace('${sinMedir ? "sin medir" : MXN_FMT(k.totGasto)}',
        '${MXN_FMT(k.totGasto)}')],
    ['la fila imprime «X% de $contrato» aunque falte el sumando grande',
      (t) => t.replace('${sinMedir ? motivoSinMedir(k.gastoGPMotivo) : `',
        '${false ? motivoSinMedir(k.gastoGPMotivo) : `')],
    ['el semáforo del gasto vuelve a premiar el hueco con verde',
      (t) => t.replace('    const colorGasto = sinMedir ? "#9AA0AC" : semaforoColor(k.pctGasto, "gasto");',
        '    const colorGasto = semaforoColor(k.pctGasto, "gasto");')],
    ['un motivo que nadie previó se traduce a nada',
      (t) => t.replace('    default: return "el gasto de GP no se pudo medir";',
        '    default: return "";')],
    ['el motivo normal se vuelve una frase que no dice nada',
      (t) => t.replace('    case "no-pedida": return "alta posterior a la última corrida de GP";',
        '    case "no-pedida": return "—";')],
    // ── El consolidado ──────────────────────────────────────────────────────
    ['el total deja de declarar que va corto',
      (t) => t.replace('  const avisoGastoCorto = sinMedirN > 0',
        '  const avisoGastoCorto = false && sinMedirN > 0')],
    ['el total EXCLUYE las obras sin medir: dos totales del mismo dinero',
      (t) => t.replace('  const gastoTotal = kpisObras.reduce((t, k) => t + k.totGasto, 0);',
        '  const gastoTotal = kpisObras.filter((k) => k.gastoGPMedido !== false).reduce((t, k) => t + k.totGasto, 0);')],
    ['el conteo de obras sin medir se hace con el valor y no con la bandera',
      (t) => t.replace('  const sinMedirN = kpisObras.filter(k => k.gastoGPMedido === false).length;',
        '  const sinMedirN = kpisObras.filter(k => k.totGasto === 0).length;')],
    // ── El rastro en la consola ─────────────────────────────────────────────
    ['el cron deja de avisar en la consola cuando no pudo medir',
      (t) => t.replace('      console.warn(`[GP] obra "${obra.nombre}" (clave ${clave}',
        '      String(`[GP] obra "${obra.nombre}" (clave ${clave}')],
    ['y deja de avisar cuando la obra no tiene por dónde cruzarse',
      (t) => t.replace('  console.warn(`[GP] obra "${obra.nombre}" (id=${obra.id}) sin match',
        '  String(`[GP] obra "${obra.nombre}" (id=${obra.id}) sin match')],
  ];

  let vistas = 0;
  for (const [nombre, romper] of MUTACIONES) {
    const antes = fs.readFileSync(path.join(RAIZ, 'functions/index.js'), 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}  ·  el ancla ya no está en functions/index.js`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-gasto-'));
    const copia = path.join(dir, 'index.js');
    fs.writeFileSync(copia, despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, ARCH_FUNCIONES: copia },
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
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── utilería de reporte ────────────────────────────────────────────────────
let fallas = 0;
const ok = (t) => console.log('   ok    ' + t);
const mal = (t, d) => {
  fallas++;
  console.log('   FALLA ' + t);
  if (d) for (const x of [].concat(d)) console.log('         ' + x);
};
const exigir = (c, t, d) => (c ? ok(t) : mal(t, d));
const seccion = (t) => console.log('\n' + t);

// Los avisos se recogen en vez de imprimirse: así se puede EXIGIR que existan.
// En un cron la consola es el único sitio donde alguien diagnostica una obra
// sin gasto, y un aviso borrado no se nota en ninguna pantalla.
const avisos = [];
console.warn = (...a) => { avisos.push(a.map(String).join(' ')); };

// ── el código vivo, de los dos archivos ────────────────────────────────────
const { deApp, fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');

let APP_estado;
let FN_estado; let FN_motivo; let FN_correo; let FN_kpis;
try {
  ({ estadoGastoGP: APP_estado } = deApp('estadoGastoGP'));

  const piezas = fuenteDe(ARCH_FN,
    ['estadoGastoGP', 'motivoSinMedir', 'correoResumenSemanal']);
  if (piezas.faltan.length) noArranco(piezas.faltan, 'functions/index.js');
  ({ estadoGastoGP: FN_estado, motivoSinMedir: FN_motivo,
    correoResumenSemanal: FN_correo } = new Function(
    `"use strict";\n${piezas.cuerpo}\nreturn { estadoGastoGP, motivoSinMedir, correoResumenSemanal };`)());
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

// ── la matriz de entradas ──────────────────────────────────────────────────
// Documento de gasto con la forma que escribe este mismo archivo: `obras` son
// las que contestaron con movimientos, `obrasPedidas` TODAS las claves que se
// pidieron. La asimetría entre las dos listas es el dato; no se inventa nada.
const GP = {
  obras: {
    '0112': { id: '0112', nombre: '0112 SIOP COATZA MALECON 0526', grandTotal: 22000000 },
    '0126': { id: '0126', nombre: '0126 LA CANGREJERA', grandTotal: 9000000 },
  },
  obrasPedidas: ['0112', '0126', '0130'],
};

const CASOS = [
  { que: 'clave capturada que SÍ está en el gasto',
    obra: { id: 'x1', nombre: 'Malecón', gpId: '0112' },
    medido: true, motivo: 'medido', valor: 22000000 },
  { que: 'clave capturada que se PIDIÓ y no trajo cheques',
    obra: { id: 'x2', nombre: 'Obra quieta', gpId: '0130' },
    medido: true, motivo: 'sin-cheques', valor: 0 },
  { que: 'clave capturada que NO se pidió (alta posterior a la corrida)',
    obra: { id: 'x3', nombre: 'Obra nueva', gpId: '0199' },
    medido: false, motivo: 'no-pedida', valor: 0 },
  { que: 'id de cuatro dígitos que SÍ está en el gasto',
    obra: { id: '0126-A', nombre: 'La Cangrejera' },
    medido: true, motivo: 'medido', valor: 9000000 },
  { que: 'id de cuatro dígitos pedido y sin cheques',
    obra: { id: '0130-B', nombre: 'Otra quieta' },
    medido: true, motivo: 'sin-cheques', valor: 0 },
  { que: 'id de cuatro dígitos que no se pidió',
    obra: { id: '0199-C', nombre: 'Otra nueva' },
    medido: false, motivo: 'no-pedida', valor: 0 },
  { que: 'sin clave, match por nombre con dos palabras',
    obra: { id: 'vieja', nombre: 'SIOP COATZA MALECON' },
    medido: true, motivo: 'por-nombre', valor: 22000000 },
  { que: 'sin clave y sin parecido: cae al campo legacy, que no es medición',
    obra: { id: 'vieja2', nombre: 'Puente Zacatal', gastoGP: 777 },
    medido: false, motivo: 'sin-match', valor: 777 },
  { que: 'no hay documento de gasto',
    obra: { id: '0112-Z', nombre: 'Malecón', gastoGP: 5 },
    gp: null,
    medido: false, motivo: 'sin-documento', valor: 5 },
  { que: 'documento viejo sin `obrasPedidas`: no se puede saber',
    obra: { id: 'x9', nombre: 'Obra nueva', gpId: '0199' },
    gp: { obras: GP.obras },
    medido: false, motivo: 'no-se-puede-saber', valor: 0 },
  // Una sola palabra en común no es identidad: «CANGREJERA» aparece en media
  // zona industrial. Colgarle los 9 millones de la 0126 a otra obra sería
  // inventar una cifra, que es peor que no tenerla.
  { que: 'una palabra parecida NO alcanza: el difuso no le cuelga dinero ajeno',
    obra: { id: 'x10', nombre: 'REHABILITACION CANGREJERA' },
    medido: false, motivo: 'sin-match', valor: 0 },
];

// ════════════════════════════════════════════════════════════════════════════
seccion('1. LAS DOS COPIAS DAN EL MISMO VEREDICTO');
// ════════════════════════════════════════════════════════════════════════════
// No hay build compartido entre `functions/` y `src/`: son dos despliegues
// distintos. La única forma de exigir que coincidan es correr las dos.
for (const c of CASOS) {
  const gp = 'gp' in c ? c.gp : GP;
  const a = APP_estado(c.obra, gp);
  const f = FN_estado(c.obra, gp);
  exigir(a.medido === f.medido && a.motivo === f.motivo && a.valor === f.valor,
    `mismo veredicto en pantalla y en el correo — ${c.que}`,
    [`pantalla: medido=${a.medido} motivo=${a.motivo} valor=${a.valor}`,
      `correo:   medido=${f.medido} motivo=${f.motivo} valor=${f.valor}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('2. Y ES EL VEREDICTO CORRECTO, NO SÓLO EL MISMO');
// ════════════════════════════════════════════════════════════════════════════
// Las dos copias podrían estar igual de mal, y la sección 1 no lo vería.
for (const c of CASOS) {
  const gp = 'gp' in c ? c.gp : GP;
  const f = FN_estado(c.obra, gp);
  exigir(f.medido === c.medido && f.motivo === c.motivo && f.valor === c.valor,
    `${c.que} → medido=${c.medido}, motivo=${c.motivo}, valor=${c.valor}`,
    [`salió: medido=${f.medido} motivo=${f.motivo} valor=${f.valor}`]);
}

// La distinción que paga todo esto, dicha en un renglón.
{
  const cero = FN_estado({ id: 'a', nombre: 'A', gpId: '0130' }, GP);
  const hueco = FN_estado({ id: 'b', nombre: 'B', gpId: '0199' }, GP);
  exigir(cero.valor === hueco.valor && cero.medido !== hueco.medido,
    'cero medido y hueco traen el MISMO número y distinto veredicto — la cifra sola no alcanza',
    [`cero:  valor=${cero.valor} medido=${cero.medido}`,
      `hueco: valor=${hueco.valor} medido=${hueco.medido}`]);
}

// El rastro se exige de la copia DEL CORREO, con el buzón vacío. Las dos
// copias avisan con el mismo texto; si no se vacía, el aviso de la pantalla
// tapa a la del correo y la afirmación se cumple sola.
{
  avisos.length = 0;
  FN_estado({ id: 'w1', nombre: 'Obra nueva', gpId: '0199' }, GP);
  exigir(avisos.some((a) => /SIN MEDIR, no cero/.test(a)),
    'el cron deja rastro en la consola cuando no pudo medir',
    [`el buzón quedó con ${avisos.length}: ${JSON.stringify(avisos)}`]);

  avisos.length = 0;
  FN_estado({ id: 'w2', nombre: 'Puente Zacatal', gastoGP: 777 }, GP);
  exigir(avisos.some((a) => /sin match en el gasto/.test(a)),
    'y también cuando la obra no tiene por dónde cruzarse',
    [`el buzón quedó con ${avisos.length}: ${JSON.stringify(avisos)}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('3. `calcularKpisObra` ARRASTRA EL VEREDICTO, NO SÓLO LA CIFRA');
// ════════════════════════════════════════════════════════════════════════════
const sembrar = (obraId, info) => {
  DOCS = {};
  DOCS[`obras/${obraId}/config/info`] = info;
  DOCS[`obras/${obraId}/avance/subs`] = {
    fecha: new Date().toISOString(),
    data: [{ imp: 1000000, a: 50 }],
  };
  DOCS[`obras/${obraId}/avance/maquinaria`] = { data: [{ imp: 30000 }] };
  DOCS[`obras/${obraId}/config/otros_gastos`] = { items: [{ importe: 20000 }] };
};
const kpisDe = async (obraId, info) => { sembrar(obraId, info); return FN_kpis(obraId, GP); };

(async () => {
  const nueva = await kpisDe('0199-C', { nombre: 'Obra nueva', presupuesto: 4000000 });
  const medida = await kpisDe('0112', { nombre: 'Malecón', gpId: '0112', presupuesto: 25849801 });
  const quieta = await kpisDe('0130-B', { nombre: 'Obra quieta', presupuesto: 1000000 });

  exigir(nueva.gastoGPMedido === false,
    'la obra que GP no conoce sale con `gastoGPMedido: false`',
    [`salió ${JSON.stringify(nueva.gastoGPMedido)}`]);
  exigir(nueva.gastoGPMotivo === 'no-pedida',
    'y dice por qué: `no-pedida`', [`salió ${nueva.gastoGPMotivo}`]);
  exigir(medida.gastoGPMedido === true,
    'la obra medida sale con `gastoGPMedido: true`');
  exigir(quieta.gastoGPMedido === true && quieta.gastoGPMotivo === 'sin-cheques',
    'la obra pedida sin cheques sale MEDIDA en cero, no sin medir',
    [`salió medido=${quieta.gastoGPMedido} motivo=${quieta.gastoGPMotivo}`]);

  // Maquinaria y otros SÍ están medidos; sumarlos no inventa nada. Lo que no
  // se puede afirmar es que esa suma sea el gasto de la obra.
  exigir(nueva.totGasto === 50000,
    'a la obra sin medir se le suma lo que SÍ está medido (maquinaria y otros)',
    [`totGasto=${nueva.totGasto}, se esperaba 30000+20000`]);
  exigir(medida.totGasto === 22000000 + 50000,
    'y a la medida se le suma además el gasto de GP completo',
    [`totGasto=${medida.totGasto}`]);

  // ══════════════════════════════════════════════════════════════════════════
  seccion('4. LA FILA DEL CORREO NO ENSEÑA UNA CIFRA QUE NO MIDIÓ');
  // ══════════════════════════════════════════════════════════════════════════
  const fila = (extra) => ({
    obraId: 'O1', nombre: 'OBRA DE PRUEBA', contrato: 'C-1', cliente: 'CLI',
    presupuesto: 4000000, avancePct: 31, pctGasto: 1.25, totGasto: 50000,
    cobrado: 0, diasDesdeCaptura: 2, modoVol: false,
    gastoGPMedido: true, gastoGPMotivo: 'medido', ...extra,
  });
  const htmlDe = (kpis) => FN_correo(kpis, '9 de noviembre de 2026',
    { total: 0 }, { sinOrg: [], otra: [] }, { empresa: 'FOSMON' }).html;

  const htmlSinMedir = htmlDe([fila({ gastoGPMedido: false, gastoGPMotivo: 'no-pedida' })]);
  const htmlMedida = htmlDe([fila({})]);

  // Se mira la CELDA, no el correo entero: el total de abajo sí imprime los
  // $50,000 y debe hacerlo —son maquinaria y otros, que están medidos—. Buscar
  // la cifra en todo el HTML confundiría el renglón con el consolidado.
  const trozoGasto = (html) => {
    const m = html.match(/<div style="font-size:14px;font-weight:600;color:([^;"]+);[^"]*">([^<]*)</);
    return m ? { color: m[1], texto: m[2] } : null;
  };
  const tSin = trozoGasto(htmlSinMedir);
  const tCon = trozoGasto(htmlMedida);

  exigir(tSin && tSin.texto === 'sin medir',
    'la obra sin medir dice «sin medir» en la columna de gasto',
    [`la celda decía "${tSin && tSin.texto}"`]);
  exigir(tSin && !/\d/.test(tSin.texto),
    'y NO imprime los $50,000 en su celda como si fueran su gasto',
    [`la celda decía "${tSin && tSin.texto}"`]);
  exigir(tCon && tCon.texto === '$50,000',
    'la obra medida sí imprime su cifra — no se apagó todo',
    [`la celda decía "${tCon && tCon.texto}"`]);
  exigir(!/sin medir/.test(htmlMedida),
    'y no dice «sin medir» cuando sí se midió');

  // El porcentaje es la mentira silenciosa: «1% de $4,000,000» se lee como una
  // obra baratísima, cuando lo que pasa es que falta el sumando grande.
  exigir(!/de \$4,000,000/.test(htmlSinMedir),
    'tampoco imprime «X% de $4,000,000»: sin el sumando de GP ese porcentaje no existe');
  exigir(/de \$4,000,000/.test(htmlMedida),
    'y la medida sí lo imprime');

  // ══════════════════════════════════════════════════════════════════════════
  seccion('5. SIN MEDICIÓN NO HAY SEMÁFORO');
  // ══════════════════════════════════════════════════════════════════════════
  // `semaforoColor(pct,"gasto")` pinta VERDE por debajo del 70%. Una obra sin
  // medir tiene el porcentaje bajísimo JUSTAMENTE porque le falta el gasto, o
  // sea que el semáforo la premiaba por el hueco. Mismo defecto que el #88
  // (la tarjeta con el margen inflado) cerró en la pantalla.
  const VERDE = '#3B6D11';
  const APAGADO = '#9AA0AC';
  exigir(tSin && tSin.color !== VERDE,
    'la celda de una obra sin medir NO sale en verde',
    [`color=${tSin && tSin.color}`]);
  exigir(tSin && tSin.color === APAGADO,
    'sale apagada, que es como la pantalla dice «no se sabe»',
    [`color=${tSin && tSin.color}`]);
  exigir(tCon && tCon.color === VERDE,
    'y la medida con poco gasto conserva su verde — el semáforo no se rompió',
    [`color=${tCon && tCon.color}`]);

  // ══════════════════════════════════════════════════════════════════════════
  seccion('6. SE DICE POR QUÉ, Y UN MOTIVO DESCONOCIDO NO SE DISFRAZA');
  // ══════════════════════════════════════════════════════════════════════════
  // «Sin medir» a secas invita a pensar que la app está rota. El caso normal
  // se arregla solo con la siguiente corrida del cron, y eso cambia qué hace
  // quien lo lee: nada, en vez de llamar a alguien un domingo.
  exigir(/alta posterior/.test(htmlSinMedir),
    'el correo explica que la obra es posterior a la última corrida de GP');
  for (const [motivo, trozo] of [
    ['no-pedida', 'alta posterior'],
    ['sin-documento', 'no hay corrida'],
    ['sin-match', 'sin clave de GP'],
    ['no-se-puede-saber', 'no dice qué obras pidió'],
  ]) {
    exigir(String(FN_motivo(motivo)).includes(trozo),
      `el motivo \`${motivo}\` se traduce a algo que se entiende`,
      [`salió: "${FN_motivo(motivo)}"`]);
  }
  const desconocido = String(FN_motivo('motivo-que-no-existe-todavia'));
  exigir(/no se pudo medir/.test(desconocido),
    'un motivo desconocido dice que no se pudo medir, no se queda en blanco',
    [`salió: "${desconocido}"`]);

  // ══════════════════════════════════════════════════════════════════════════
  seccion('7. EL TOTAL DECLARA QUE VA CORTO — Y SIGUE SIENDO EL MISMO TOTAL');
  // ══════════════════════════════════════════════════════════════════════════
  // El consolidado suma obras a las que les falta el sumando de GP entero, así
  // que sale corto y nadie lo nota: es un número redondo con su etiqueta, al
  // lado de otros tres completos.
  //
  // No se excluyen esas obras. El dashboard las incluye y declara
  // (`obrasGastoSinMedir` en src/App.jsx); excluirlas aquí daría DOS totales
  // del mismo dinero, que es el defecto que veníamos a cerrar, al revés.
  const dos = [
    fila({ obraId: 'A', totGasto: 1000000 }),
    fila({ obraId: 'B', totGasto: 50000, gastoGPMedido: false, gastoGPMotivo: 'no-pedida' }),
  ];
  const htmlDos = htmlDe(dos);
  exigir(/1 obra sin medir: va corto/.test(htmlDos),
    'el total avisa cuántas obras le faltan, pegado al número',
    ['no apareció el aviso junto al gasto acumulado']);
  exigir(/\$1,050,000/.test(htmlDos),
    'y el total sigue siendo la suma de TODAS: una cuenta por número',
    ['si dijera $1,000,000 estaría excluyendo, que es inventar otro total']);

  exigir(!/va corto/.test(htmlDe([fila({ obraId: 'A' }), fila({ obraId: 'B' })])),
    'cuando todo está medido no hay aviso — la advertencia significa algo');

  const tres = [
    fila({ obraId: 'A', gastoGPMedido: false, gastoGPMotivo: 'no-pedida' }),
    fila({ obraId: 'B', gastoGPMedido: false, gastoGPMotivo: 'sin-match' }),
    fila({ obraId: 'C' }),
  ];
  exigir(/2 obras sin medir: va corto/.test(htmlDe(tres)),
    'el conteo es el real y concuerda en plural',
    ['no apareció «2 obras sin medir»']);

  // Una obra con gasto 0 pero MEDIDO no entra al conteo: la advertencia habla
  // de huecos, no de obras baratas.
  exigir(!/va corto/.test(htmlDe([fila({ obraId: 'A', totGasto: 0, pctGasto: 0 })])),
    'una obra con gasto cero MEDIDO no se cuenta como hueco');

  // ══════════════════════════════════════════════════════════════════════════
  console.log('');
  console.log('   ' + '─'.repeat(62));
  console.log(fallas === 0 ? '   VERDE · 0 en rojo' : `   ROJO · ${fallas} en rojo`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\n   NO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
