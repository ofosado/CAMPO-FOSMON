#!/usr/bin/env node
// El corte de estimaciones en el cierre semanal: lo estimado y lo pagado
// quedan congelados en la semana que los vio, y la semana que no los vio lo
// dice.
//
// POR QUÉ ESTA PRUEBA. El cierre semanal es el expediente. Hasta hoy congelaba
// el avance físico y el dinero ejecutado, pero NO lo estimado ni lo pagado, y
// eso deja una pregunta sin poder contestar: «en la semana 32, ¿cuánto
// llevábamos estimado?». La única respuesta disponible era el total de HOY,
// que es otra pregunta y además se mueve cada vez que alguien captura.
//
// Guardarlo abre tres maneras nuevas de mentir, y las tres se miden aquí:
//
//   1. Escribir $0 cuando la lista de estimaciones todavía no llegó de
//      Firestore. La lista arranca en `[]` y se llena después; cerrar en esa
//      ventana congelaría un cero. Medido en producción el 2026-10-05: la
//      obra 0114 lleva $109,240,537.30 estimados. Un cero ahí no se distingue
//      de «esa semana no había nada estimado» y se queda en el expediente
//      para siempre.
//   2. Rellenar hacia atrás. Las 33 semanas ya cerradas en producción NO
//      tienen el dato y no hay forma honesta de deducirlo. Tienen que decir
//      que no lo tienen —con la razón— y no heredar el de la semana vecina ni
//      el total de hoy.
//   3. Partir las series. Si el esquema subiera por agregar dos campos, los
//      cierres de antes y los de después dejarían de ser comparables y la
//      gráfica perdería la historia por un cambio que no tocó ninguna cifra
//      vieja.
//
// Lo que se afirma es CONDUCTA: qué número queda guardado, qué devuelve la
// serie semanal y qué TEXTO sale en el panel del riel. No se afirma que
// exista ningún nombre (P3). Todo se extrae por AST de src/App.jsx y se
// EJECUTA, incluidas las expresiones de los KPI del panel: se prueba el
// código de la pantalla, no una copia mía.
//
// Uso:  node scripts/prueba-corte-estimaciones.cjs [App.jsx]
//
// Contraprueba — contra la versión anterior tiene que ponerse ROJA:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-corte-estimaciones.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m, detalle) => {
  const d = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${d}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${d}`); }
};

// ── Extracción del código real ─────────────────────────────────────────────
const RAIZ_NOMBRES = [
  '_ne', 'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'snapshotId',
  'montoEjecutadoSnap', 'montoEstimadoSnap', 'montoPagadoSnap',
  'FRASE_SIN_CORTE_EST', 'corteDeEstimaciones',
  'estadoPorSemana', 'semanaISO', 'desgloseEjecutado', 'avanceFisicoPonderado',
  'importeEjecutadoPartida', 'importeCatalogoPartida',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();

// Las expresiones de los KPI del panel de la semana, por etiqueta. Se guardan
// como TEXTO de la expresión para poder ejecutarlas con una semana inventada
// y ver qué sale escrito.
const kpis = {};

// El escritor del cierre, aparte: se arma con un Firestore de mentira para
// poder mirar el documento que deja escrito.
let fuenteEscritor = '';

// Y el ARGUMENTO con que el botón de cerrar la semana le pasa el corte. Es la
// pieza que una refactorización rompe sin que nada se queje: el corte se
// calcula bien, el cierre lo guardaría bien, y entre los dos no pasa nada.
let fuenteArgCorte = null;

traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && RAIZ_NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
    if (d?.id?.name === 'crearSnapshotAvance' && d.init) {
      fuenteEscritor = src.slice(d.init.start, d.init.end);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && RAIZ_NOMBRES.includes(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
  },
  CallExpression(p) {
    if (p.node.callee?.name !== 'crearSnapshotAvance') return;
    const arg = p.node.arguments[6];
    if (arg && fuenteArgCorte === null) fuenteArgCorte = src.slice(arg.start, arg.end);
  },
  JSXElement(p) {
    const abre = p.node.openingElement;
    if (abre.name?.name !== 'Kpi') return;
    const attr = {};
    for (const a of abre.attributes) {
      if (a.type !== 'JSXAttribute' || !a.name?.name) continue;
      const v = a.value;
      if (!v) continue;
      attr[a.name.name] = v.type === 'StringLiteral'
        ? JSON.stringify(v.value)
        : src.slice(v.expression.start, v.expression.end);
    }
    const lbl = attr.label && /^"/.test(attr.label) ? JSON.parse(attr.label) : null;
    if (lbl && kpis[lbl] === undefined) kpis[lbl] = attr;
  },
});

const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const {
  _ne, corteDeEstimaciones, estadoPorSemana, snapshotId,
  montoEstimadoSnap, montoPagadoSnap, FRASE_SIN_CORTE_EST, ESQUEMA_SNAPSHOT,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${[...vistos].length} de módulo, ` +
  `${Object.keys(kpis).length} KPI del panel de la semana\n`);

// Lo que dice en pantalla un KPI del panel, ejecutando SU expresión con una
// semana inventada. Devuelve { valor, sub } — el número grande y el renglón
// de abajo, que es donde vive la explicación.
const NUM = (n, d) => Number(n || 0).toFixed(d);
const diceElKpi = (etiqueta, cierre) => {
  const k = kpis[etiqueta];
  if (!k) return null;
  const ev = expr => expr === undefined ? undefined
    : new Function('marcaActiva', 'NUM', 'fraseSinDelta', 'FRASE_SIN_CORTE_EST',
        `return (${expr});`)({ cierre }, NUM, () => '(delta)', FRASE_SIN_CORTE_EST);
  return { valor: ev(k.value), sub: ev(k.sub) };
};

// Un cierre oficial mínimo. `extra` manda sobre todo lo demás.
let nSem = 29;
const cierre = (extra = {}) => {
  const semana = extra.semana ?? ++nSem;
  return {
    id: `2026-S${String(semana).padStart(2, '0')}`, semana, año: 2026,
    tipo: 'oficial', fechaCaptura: '2026-07-24T12:00:00.000Z',
    fechaCierre: '2026-07-24T12:00:00.000Z', capturadoPor: 'ana@x.mx',
    avancePonderado: 40, montoEjecutado: 1000000,
    esquema: ESQUEMA_SNAPSHOT, ...extra,
  };
};

// ════════════════════════════════════════════════════════════════════════════
console.log('1 · EL CIERRE NO ESCRIBE UN CERO QUE NO SABE');
// ════════════════════════════════════════════════════════════════════════════
{
  const ests = [
    { no: 1, monto: 4000000, estatus: 'Pagada' },
    { no: 2, monto: 2500000, estatus: 'Facturada' },
  ];

  const antesDeCargar = corteDeEstimaciones?.([], false);
  check(antesDeCargar === null,
    'la lista todavía no llegó de Firestore: no hay corte que guardar',
    `devolvió ${JSON.stringify(antesDeCargar)}`);

  // El caso que de verdad duele: la lista ya tiene forma de arreglo vacío
  // —que es su estado inicial— y las estimaciones reales valen millones.
  const enLaVentana = corteDeEstimaciones?.([], false);
  check(enLaVentana === null || enLaVentana?.estimado !== 0,
    'cerrar en la ventana de carga NO congela $0 en una obra con millones',
    'la 0114 lleva $109.2M estimados en producción');

  const yaCargada = corteDeEstimaciones?.(ests, true);
  check(yaCargada && yaCargada.estimado === 6500000,
    'con la lista cargada, lo estimado es la suma de todas',
    `estimado = ${yaCargada && yaCargada.estimado}`);
  check(yaCargada && yaCargada.pagado === 4000000,
    'lo pagado cuenta sólo las estimaciones pagadas',
    `pagado = ${yaCargada && yaCargada.pagado}`);

  // Una obra sin ninguna estimación capturada SÍ puede afirmar cero: la lista
  // llegó y está vacía. Eso es un hecho, no un hueco. Medido: las obras 0125
  // y 0127 están así hoy en producción.
  const vacíaDeVerdad = corteDeEstimaciones?.([], true);
  check(vacíaDeVerdad && vacíaDeVerdad.estimado === 0 && vacíaDeVerdad.pagado === 0,
    'la obra que cargó y no tiene estimaciones sí afirma cero',
    'la 0125 y la 0127 están así en producción');

  // El estatus se captura a mano en un selector que ha cambiado de texto.
  const mayus = corteDeEstimaciones?.([{ monto: 100, estatus: 'PAGADA' }], true);
  const minus = corteDeEstimaciones?.([{ monto: 100, estatus: 'pagada' }], true);
  check(mayus?.pagado === 100 && minus?.pagado === 100,
    '«PAGADA» y «pagada» cuentan igual que «Pagada»',
    `${mayus?.pagado} / ${minus?.pagado}`);

  // Un monto capturado como texto —pasa, el campo es de captura libre— no
  // puede convertir la suma en "40000002500000" ni en NaN.
  const texto = corteDeEstimaciones?.(
    [{ monto: '4000000', estatus: 'Pagada' }, { monto: '2500000', estatus: 'En proceso' }], true);
  check(texto?.estimado === 6500000,
    'un monto capturado como texto se suma como número',
    `estimado = ${texto?.estimado}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2 · LA SEMANA QUE NO LO REGISTRÓ LO DICE, Y NO HEREDA');
// ════════════════════════════════════════════════════════════════════════════
{
  // Tres cierres: el primero sin corte (de antes de este cambio), el segundo
  // con corte, el tercero otra vez sin corte —un cierre que corrió antes de
  // que cargaran las estimaciones.
  const serie = estadoPorSemana?.([
    cierre({ semana: 30, avancePonderado: 30 }),
    cierre({ semana: 31, avancePonderado: 35, montoEstimado: 6500000, montoPagado: 4000000 }),
    cierre({ semana: 32, avancePonderado: 40, montoEstimado: null, montoPagado: null }),
  ]) || [];

  check(serie.length === 3 && serie[0].estimado === null && serie[0].pagado === null,
    'un cierre anterior al corte no inventa su estimado',
    `S30 → ${JSON.stringify([serie[0]?.estimado, serie[0]?.pagado])}`);

  check(serie[1]?.estimado === 6500000 && serie[1]?.pagado === 4000000,
    'la semana que sí lo registró lo devuelve tal cual quedó guardado',
    `S31 → ${JSON.stringify([serie[1]?.estimado, serie[1]?.pagado])}`);

  check(serie[2]?.estimado === null && serie[2]?.pagado === null,
    'la semana sin corte NO hereda el de la semana anterior',
    `S32 → ${JSON.stringify([serie[2]?.estimado, serie[2]?.pagado])}`);

  // Ni hacia atrás: la S30 no toma el de la S31 que viene después.
  check(serie[0]?.estimado !== serie[1]?.estimado,
    'tampoco se rellena hacia atrás desde la primera semana que sí lo tiene');

  // El total de HOY no se cuela por ningún lado. Si alguien cruzara la serie
  // con el documento vivo de estimaciones, las tres semanas dirían lo mismo.
  const distintos = new Set(serie.map(s => JSON.stringify(s.estimado)));
  check(distintos.size > 1,
    'la serie no es una línea plana con el total vigente repetido',
    `valores distintos: ${[...distintos].join(' / ')}`);

  // Un cero guardado es un cero, no un hueco: la obra que cerró sin
  // estimaciones capturadas tiene que poder decir "$0" y no "sin dato".
  const conCero = estadoPorSemana?.([
    cierre({ semana: 33, montoEstimado: 0, montoPagado: 0 }),
  ]) || [];
  check(conCero[0]?.estimado === 0 && conCero[0]?.pagado === 0,
    'un cero REGISTRADO se distingue de un hueco',
    `S33 → ${JSON.stringify([conCero[0]?.estimado, conCero[0]?.pagado])}`);

  // El campo ausente y el campo en null se leen igual. Son dos historias
  // distintas —snapshot viejo contra cierre a ciegas— y ninguna autoriza un
  // número, así que en pantalla valen lo mismo.
  check(montoEstimadoSnap?.({}) === null && montoEstimadoSnap?.({ montoEstimado: null }) === null
     && montoPagadoSnap?.({}) === null && montoPagadoSnap?.({ montoPagado: null }) === null,
    'el campo ausente y el campo en null valen lo mismo: no hay número');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3 · EL PANEL DE LA SEMANA DICE POR QUÉ NO HAY NÚMERO');
// ════════════════════════════════════════════════════════════════════════════
{
  const conDato = estadoPorSemana?.([
    cierre({ semana: 31, montoEstimado: 6500000, montoPagado: 4000000 }),
  ])?.[0];
  const sinDato = estadoPorSemana?.([cierre({ semana: 30 })])?.[0];

  for (const [etiqueta, campo, valor] of [
    ['Estimado al cierre', 'estimado', 6500000],
    ['Pagado al cierre',   'pagado',   4000000],
  ]) {
    const hay = diceElKpi(etiqueta, conDato?.cierre && conDato);
    const no  = diceElKpi(etiqueta, sinDato);

    check(hay && String(hay.valor).replace(/[,$]/g, '') === `${valor}`,
      `«${etiqueta}» escribe la cifra del cierre`,
      hay ? `dice «${hay.valor}»` : 'el KPI no está en la pantalla');

    check(no && /sin dato/i.test(String(no.valor)),
      `«${etiqueta}» sin registro no escribe una cifra`,
      no ? `dice «${no.valor}»` : 'el KPI no está en la pantalla');

    // Un guion es lo peor: se lee «no aplica» y cierra la pregunta.
    check(no && !/^\s*[—–-]\s*$/.test(String(no.valor)) && !/^\$?0$/.test(String(no.valor)),
      `«${etiqueta}» sin registro no sale como guion ni como $0`,
      no ? `dice «${no.valor}»` : '—');

    check(no && /no registr/i.test(String(no.sub)),
      `«${etiqueta}» sin registro explica que el cierre no lo anotó`,
      no ? `dice «${no.sub}»` : '—');

    check(hay && !/no registr/i.test(String(hay.sub)),
      `«${etiqueta}» con cifra no arrastra la explicación del hueco`,
      hay ? `dice «${hay.sub}»` : '—');
  }

  // Una sola cuenta: la razón se escribe en un lugar y los dos KPI la leen.
  const veces = (src.match(/el cierre de esa semana no registró las estimaciones/g) || []).length;
  check(veces === 1,
    'la razón del hueco está escrita UNA vez en todo el archivo',
    `aparece ${veces} ${veces === 1 ? 'vez' : 'veces'}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4 · AGREGAR DOS CIFRAS NO PARTE LAS SERIES VIEJAS');
// ════════════════════════════════════════════════════════════════════════════
{
  // El esquema de los cierres que YA ESTÁN en producción. Va escrito como 3 a
  // propósito y no leído de `ESQUEMA_SNAPSHOT`: es un hecho de los datos,
  // medido el 2026-10-05, y no una constante del código. Si se leyera de la
  // constante, subirla movería las dos puntas a la vez y la prueba seguiría
  // verde mientras la gráfica pierde la historia.
  const ESQUEMA_EN_PRODUCCION = 3;

  const serie = estadoPorSemana?.([
    // Como están hoy los 33 cierres de producción: sin corte de estimaciones.
    cierre({ semana: 34, avancePonderado: 30, esquema: ESQUEMA_EN_PRODUCCION }),
    // Y el primero que se escriba después de este cambio.
    cierre({ semana: 35, avancePonderado: 35, montoEstimado: 1, montoPagado: 0 }),
  ]) || [];

  check(serie[1]?.delta !== null && Math.abs(serie[1].delta - 5) < 1e-9,
    'el avance se sigue comparando contra los cierres que ya están en producción',
    `delta = ${serie[1]?.delta}`);

  check(serie[1]?.dinero === 1000000,
    'el dinero ejecutado del cierre viejo se sigue leyendo',
    `dinero = ${serie[1]?.dinero}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5 · EL BOTÓN DE CERRAR LA SEMANA SÍ LE PASA EL CORTE');
// ════════════════════════════════════════════════════════════════════════════
// Entre calcular bien el corte y guardarlo bien hay un cable, y un cable que
// se corta no se queja: las dos puntas siguen pasando sus pruebas. Aquí se
// ejecuta el ARGUMENTO tal como lo escribe el botón de cerrar la semana.
{
  const MILLONES = [{ monto: 109240537.30, estatus: 'Pagada' }];
  const loQuePasaElBoton = (estimaciones, estCargadas) => {
    if (fuenteArgCorte === null) return undefined;
    return new Function('estimaciones', 'estCargadas', 'corteDeEstimaciones',
      `return (${fuenteArgCorte});`)(estimaciones, estCargadas, corteDeEstimaciones);
  };

  const cargado = loQuePasaElBoton(MILLONES, true);
  check(cargado && cargado.estimado === 109240537.30,
    'con las estimaciones cargadas, el botón le entrega el corte al cierre',
    `entregó ${JSON.stringify(cargado)}`);

  const sinCargar = loQuePasaElBoton(MILLONES, false);
  check(sinCargar === null,
    'con las estimaciones sin cargar, el botón NO le entrega un corte',
    `entregó ${JSON.stringify(sinCargar)}`);

  // Si alguien deja de pasarle la bandera por el camino de props, llega
  // `undefined`. La omisión tiene que caer del lado seguro: sin corte, nunca
  // con un corte inventado.
  const sinBandera = loQuePasaElBoton(MILLONES, undefined);
  check(sinBandera === null,
    'si la bandera se pierde en el camino, el cierre se queda sin corte y no con un cero',
    `entregó ${JSON.stringify(sinBandera)}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6 · LO QUE DE VERDAD QUEDA ESCRITO EN EL EXPEDIENTE');
// ════════════════════════════════════════════════════════════════════════════
// Las secciones de arriba miden el corte y la lectura. Ésta mira el
// DOCUMENTO: se le pone al cierre un Firestore de mentira y se revisa la
// semana que deja guardada. Es la única que detecta que el corte se calcule
// bien y luego nadie lo meta en el snapshot.
{
  // Lo escrito en el Firestore de mentira, para poder leerlo después.
  let escrito = null;
  const cerrar = fuenteEscritor && new Function(
    'semanaISO', 'snapshotId', 'desgloseEjecutado', 'avanceFisicoPonderado',
    'ESQUEMA_SNAPSHOT', 'fsGet', 'setDoc', 'docObra', 'ErrorSnapshot',
    'mensajeFalloSnapshot', 'guardaLoEscrito',
    `return (${fuenteEscritor});`)(
      app.semanaISO, app.snapshotId, app.desgloseEjecutado, app.avanceFisicoPonderado,
      ESQUEMA_SNAPSHOT,
      async () => ({ semanas: [] }),
      async (_ref, doc) => { escrito = doc; },
      (obraId, col, id) => ({ obraId, col, id }),
      class ErrorSnapshot extends Error {},
      () => 'no se pudo guardar',
      null);

  const subs = [{ sec: '1', a: 50, imp: 2000000, cant: 10, pu: 200000, cantEjec: 5 }];
  const semanaDe = doc => (doc?.semanas || [])[0] || null;
  // Si el archivo bajo prueba no tiene corte, esto le pasa `null` al cierre:
  // el banco sigue corriendo y las aserciones salen ROJAS. Reventar aquí
  // daría exit 2 —«sin comprobar»— y taparía la regresión (P4).
  const corte = (ests, cargadas) =>
    typeof corteDeEstimaciones === 'function' ? corteDeEstimaciones(ests, cargadas) : null;

  const corrida = async () => {
    if (!cerrar) { check(false, 'el cierre se pudo armar para mirarlo escribir'); return; }

    // (a) Cierre con el corte en la mano.
    escrito = null;
    await cerrar('0114', subs, 'ana@x.mx', 'oficial', false, 4000000,
      corte([{ monto: 6500000, estatus: 'Pagada' }], true));
    const conCorte = semanaDe(escrito);
    check(conCorte && conCorte.montoEstimado === 6500000 && conCorte.montoPagado === 6500000,
      'el cierre guarda el corte de estimaciones en la semana',
      `quedó montoEstimado=${conCorte?.montoEstimado} montoPagado=${conCorte?.montoPagado}`);

    // (b) Cierre a ciegas: las estimaciones no habían llegado.
    escrito = null;
    await cerrar('0114', subs, 'ana@x.mx', 'oficial', false, 4000000,
      corte([], false));
    const aCiegas = semanaDe(escrito);
    check(aCiegas && aCiegas.montoEstimado === null && aCiegas.montoPagado === null,
      'el cierre a ciegas deja el hueco escrito, no un cero',
      `quedó montoEstimado=${aCiegas?.montoEstimado} montoPagado=${aCiegas?.montoPagado}`);
    check(aCiegas && 'montoEstimado' in aCiegas,
      'el hueco se escribe como null explícito, no omitiendo el campo',
      'así se distingue «cerró sin saber» de «snapshot anterior al corte»');

    // (c) Las cifras viejas siguen intactas: esto AGREGA, no reemplaza.
    check(conCorte && conCorte.montoEjecutado === 1000000
       && Math.abs(conCorte.avancePonderado - 25) < 1e-9,
      'el avance y el dinero ejecutado del cierre no cambiaron',
      `avance=${conCorte?.avancePonderado} ejecutado=${conCorte?.montoEjecutado}`);

    // (d) Y una semana recién escrita se lee igual que cualquier otra.
    const leida = estadoPorSemana([conCorte])[0];
    check(leida?.estimado === 6500000 && leida?.pagado === 6500000,
      'la semana recién escrita la lee la serie sin traducción de por medio',
      `leyó ${JSON.stringify([leida?.estimado, leida?.pagado])}`);
  };

  // El resto del banco es síncrono; esta parte no, así que el veredicto
  // cuelga de ella. Un rechazo aquí sube a `no-arranco` y sale con 2, no
  // con 1: un banco que revienta no es lo mismo que una aserción en rojo.
  corrida().then(() => {
    const n = fallos.length;
    console.log(`\n${n === 0 ? '✅  todo en verde' : `❌  ${n} en rojo`}\n`);
    if (n) fallos.forEach(f => console.log(`   · ${f}`));
    process.exit(n ? 1 : 0);
  });
}
