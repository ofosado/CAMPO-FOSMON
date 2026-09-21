#!/usr/bin/env node
// Guarda de fix/series-desincronizadas.
//
// EL DEFECTO. Las dos gráficas de la pantalla de obra reconstruían el dinero
// ejecutado como `avancePonderado% × presupuesto` en vez de leer el
// `montoEjecutado` que el snapshot ya trae guardado. Mientras todos los
// snapshots fueron del esquema 1 las dos cosas daban el mismo número —es una
// identidad algebraica: el `montoEjecutado` del esquema 1 también iba topado y
// `avanceFisicoPonderado` divide entre Σimp, que coincide con el presupuesto—,
// así que el defecto era LATENTE. Con el esquema 2 el `montoEjecutado` deja de
// toparse y la identidad se rompe: la gráfica se queda con el dinero recortado
// mientras el KPI de la misma pantalla muestra el real. Medido en producción el
// 2026-09-21: 0112 diverge $2,777,997 y 0125 $1,046,494.
//
// Arrastraba tres cosas más:
//   · el margen histórico heredaba el ejecutado contaminado;
//   · el ritmo de la proyección restaba un punto topado de uno sin topar, que
//     mide el cambio de definición, no el avance de la obra;
//   · la proyección topaba el dinero con `Math.min(presupuesto, …)` y terminaba
//     cuando el dinero alcanzaba el contrato, en vez de cuando el avance FÍSICO
//     llega al 100%.
//
// Esta prueba NO busca frases en el código: extrae por AST el prólogo de
// cálculo de `TendenciasMensuales` y `ProyeccionAvanceGasto` —todo lo anterior
// al render— y lo EJECUTA fuera de React con dobles, comparando las series
// resultantes contra números calculados a mano. Es P3: se verifica que el
// comportamiento ocurre, no que el mecanismo esté escrito.
//
// Lo que NO cubre: el render, el SVG, los textos de las leyendas, el tooltip.
//
// Uso:  node scripts/prueba-series-sincronizadas.cjs [archivo]
//
// El argumento corre la prueba contra una versión anterior para comprobar que
// ahí falla — una prueba que nunca ha fallado no prueba nada:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-series-sincronizadas.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const ARCHIVO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(raiz, 'src/App.jsx');
const codigo = fs.readFileSync(ARCHIVO, 'utf8');
const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};
const ast = parse(codigo, OPTS);

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};
// Los importes se comparan al peso: si la diferencia es de centavos es ruido
// del double, no una definición distinta.
const casi = (a, b, tol = 1) => typeof a === 'number' && Math.abs(a - b) <= tol;
const MXN = v => (typeof v === 'number')
  ? '$' + v.toLocaleString('es-MX', { maximumFractionDigits: 0 })
  : String(v);

// ── Extracción del código real ─────────────────────────────────────────

// Helpers de módulo que el prólogo necesita. Se copian tal cual del archivo
// bajo prueba: si `desgloseEjecutado` cambia, esta prueba usa la versión nueva.
const HELPERS = ['importeEjecutadoPartida', 'importeCatalogoPartida', 'desgloseEjecutado',
                 'avanceFisicoPonderado', 'ESQUEMA_SNAPSHOT', 'sonComparables',
                 'montoEjecutadoSnap', 'esquemaDe'];
const fuentesHelper = [];
const funcs = {};
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && HELPERS.includes(d.id.name)) {
      fuentesHelper.push(codigo.slice(p.node.start, p.node.end));
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (n === 'TendenciasMensuales' || n === 'ProyeccionAvanceGasto') funcs[n] = p.node;
  },
});
const PRELUDIO = fuentesHelper.join('\n');

// El prólogo = todas las sentencias del cuerpo ANTERIORES al primer `return`
// de primer nivel. El render vive después de ese return; los returns tempranos
// (p.ej. "falta presupuesto") están dentro de un `if`, así que no cortan aquí.
function prologoDe(nodo) {
  const cuerpo = nodo.body.body;
  const corte = cuerpo.findIndex(s => s.type === 'ReturnStatement');
  const hasta = corte === -1 ? cuerpo.length : corte;
  if (hasta === 0) return null;
  return codigo.slice(cuerpo[0].start, cuerpo[hasta - 1].end);
}

// Los returns tempranos devuelven JSX, que `new Function` no sabe leer.
// Se sustituye cada elemento JSX de nivel superior por `null`: no cambia el
// cálculo porque esas ramas no se toman con los datos de prueba, y si alguna
// se tomara el `null` haría que el escenario falle de forma visible.
function sinJSX(src) {
  const a = parse(src, { ...OPTS, allowReturnOutsideFunction: true });
  const rangos = [];
  traverse(a, {
    'JSXElement|JSXFragment'(p) {
      if (p.findParent(q => q.isJSXElement() || q.isJSXFragment())) return;
      rangos.push([p.node.start, p.node.end]);
      p.skip();
    },
  });
  rangos.sort((x, y) => y[0] - x[0]);
  let out = src;
  rangos.forEach(([i, j]) => { out = out.slice(0, i) + 'null' + out.slice(j); });
  return out;
}

const BUILTINS = new Set(['Object','Math','Date','Number','String','Array','JSON','Boolean',
  'isNaN','parseFloat','parseInt','console','Map','Set','NaN','undefined','Infinity',
  'RegExp','Error','Promise','Intl','Symbol','globalThis']);

// Variables libres del prólogo, detectadas por ámbito. No se listan a mano:
// así la prueba sigue funcionando contra una versión del archivo que use
// variables distintas, en vez de reventar por una lista desactualizada.
function libresDe(src) {
  const a = parse(src, { ...OPTS, allowReturnOutsideFunction: true });
  let globals = [];
  traverse(a, { Program(p) { globals = Object.keys(p.scope.globals); p.stop(); } });
  return globals.filter(n => !BUILTINS.has(n));
}

// Dobles: React fuera de React, y el gasto del Sheet cableado a 0 para que el
// único gasto del escenario sea el que la prueba inyecta.
const STUBS = () => ({
  useState: (v) => [v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useMemo: (f) => (typeof f === 'function' ? f() : f),
  useCallback: (f) => f,
  resolverGastoGP: () => 0,
  MXN: (v) => String(v),
  fmtMXN: (v) => String(v),
  C: new Proxy({}, { get: () => '#000000' }),
  Card: () => null, Tit: () => null, Btn: () => null, Chip: () => null,
  React: {},
});

// Corre el prólogo de `nombre` con `props`, y devuelve los locales pedidos que
// de verdad existan en esa versión del archivo. Un nombre ausente sale como
// `undefined` y la aserción que lo use falla — que es lo correcto: contra la
// versión vieja `excedenteSobreContrato` no existe.
const cacheProl = {};
function correr(nombre, props, quiero) {
  if (!funcs[nombre]) throw new Error(`no se encontró \`${nombre}\` — ¿se renombró?`);
  if (!cacheProl[nombre]) {
    const p = prologoDe(funcs[nombre]);
    if (!p) throw new Error(`\`${nombre}\` no tiene prólogo de cálculo`);
    cacheProl[nombre] = sinJSX(p);
  }
  const prologo = cacheProl[nombre];

  // Qué declara el prólogo: sólo eso se puede devolver.
  const declarados = new Set();
  {
    const a = parse(prologo, { ...OPTS, allowReturnOutsideFunction: true });
    traverse(a, { Program(p) { Object.keys(p.scope.bindings).forEach(k => declarados.add(k)); p.stop(); } });
  }
  const devolver = quiero.filter(k => declarados.has(k));

  const entorno = { ...STUBS(), ...props };
  const libres = libresDe(PRELUDIO + '\n' + prologo)
    .filter(n => !HELPERS.includes(n));
  const faltantes = libres.filter(n => !(n in entorno));
  if (faltantes.length) {
    // Se inyectan como undefined pero se avisan: una variable libre inesperada
    // puede estar silenciando parte del cálculo.
    console.log(`   ! variables libres sin doble en ${nombre}: ${faltantes.join(', ')}`);
  }
  const nombres = libres;
  const cuerpo = `${PRELUDIO}\n${prologo}\n;return {${devolver.join(',')}};`;
  const fn = new Function(...nombres, cuerpo);
  return fn(...nombres.map(k => entorno[k]));
}

// ── Fixtures ───────────────────────────────────────────────────────────
// Las semanas se calculan con la MISMA regla ISO del componente, relativas a
// hoy, para que la prueba no caduque.
const isoDe = (fecha) => {
  const d = new Date(fecha);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const ini = new Date(d.getFullYear(), 0, 1);
  return { sem: Math.ceil(((d - ini)/86400000 + 1) / 7), año: d.getFullYear() };
};
const haceSemanas = (n) => { const d = new Date(); d.setDate(d.getDate() - n * 7); return d; };
const fechaISO = (d) => d.toISOString().slice(0, 10);

// Un snapshot en la semana de hace `n` semanas.
const snap = (n, { av, me, esquema }) => {
  const { sem, año } = isoDe(haceSemanas(n));
  const s = { semana: sem, año, fechaCaptura: haceSemanas(n).toISOString(), avancePonderado: av };
  if (me !== undefined) s.montoEjecutado = me;
  if (esquema !== undefined) s.esquema = esquema;
  return s;
};

const PRESUPUESTO = 10_000_000;
// Obra de 10 semanas: arranca hace 9 semanas y llega a hoy → índices 0..9,
// donde el índice i corresponde a la semana de hace (9 − i) semanas.
const obraBase = () => ({
  id: '0199-TEST', nombre: 'Obra de prueba', presupuesto: PRESUPUESTO,
  inicio: fechaISO(haceSemanas(9)), modoAvance: 'volumen',
});
const idxDe = (n) => 9 - n;   // semana de hace n semanas → índice en la serie

// Catálogo con SOBREEJECUCIÓN: A-01 lleva 120 de 100 unidades.
//   dinero ejecutado real  = 120 × 60,000            = $7,200,000
//   avance físico ponderado (topado) = 6,000,000/10M = 60.0 %
//   avance × presupuesto (la reconstrucción vieja)   = $6,000,000
// Los $1,200,000 de diferencia son exactamente el defecto.
const SUBS_CON_EXCEDENTE = [
  { sec: 'A-01', imp: 6_000_000, cant: 100, pu: 60_000, cantEjec: 120 },
  { sec: 'A-02', imp: 4_000_000, cant: 100, pu: 40_000, cantEjec: 0 },
];
const EJEC_REAL = 7_200_000;      // lo que muestra el KPI
const EJEC_RECONSTRUIDO = 6_000_000;  // lo que mostraba la gráfica

const PROPS_TEND = ['obra','historialAvance','gpData','estimaciones','datosObraGP',
                    'otrosGastos','maquinaria','materiales','subs'];
const vacios = (extra) => {
  const o = { gpData: null, datosObraGP: null, estimaciones: [], otrosGastos: [],
              maquinaria: [], materiales: [], subs: [], historialAvance: [] };
  return { ...o, ...extra };
};

const QUIERO_TEND = ['ejecutadoSeries','margenSeries','avanceSeries','esquemaPorSemana',
                     'idxFrontera','hayTramoViejo','semanas','idxPrimerAvance','ejecutadoPorSem'];
const QUIERO_PROY = ['ejecAcum','avancePctAcum','gastoAcum','ejecProy','gastoProy','avanceProy',
                     'semanasProy','semanasHist','ritmoEjec','ritmoAvance','ritmoGasto',
                     'idxFrontera','hayTramoViejo','margenFinProy','excedenteSobreContrato',
                     'ejecFinProy','gastoFinProy','presupuesto'];

// ── Las pruebas ────────────────────────────────────────────────────────
try {

console.log('\n1. EL CASO QUE IMPORTA: el dinero de la gráfica es el del KPI');
console.log('   Obra en modo volumen con una partida al 120%. Avance físico 60%,');
console.log(`   dinero ejecutado ${MXN(EJEC_REAL)}. Reconstruirlo da ${MXN(EJEC_RECONSTRUIDO)}.`);
{
  // Snapshot esquema 2 a media obra: trae el dinero SIN topar.
  const hist = [snap(4, { av: 60, me: EJEC_REAL, esquema: 2 })];
  const props = vacios({
    obra: obraBase(), historialAvance: hist, subs: SUBS_CON_EXCEDENTE,
    otrosGastos: [{ fecha: fechaISO(haceSemanas(5)), importe: 1_000_000 }],
  });

  const t = correr('TendenciasMensuales', props, QUIERO_TEND);
  const i4 = idxDe(4);
  check(casi(t.ejecutadoSeries?.[i4], EJEC_REAL),
    `gráfica de tendencias, semana del snapshot: ${MXN(t.ejecutadoSeries?.[i4])} (esperado ${MXN(EJEC_REAL)})`);
  check(!casi(t.ejecutadoSeries?.[i4], EJEC_RECONSTRUIDO),
    `y NO es el dinero recortado ${MXN(EJEC_RECONSTRUIDO)}`);
  check(casi(t.ejecutadoSeries?.[t.ejecutadoSeries.length - 1], EJEC_REAL),
    'el último punto se ancla al mismo ejecutado que el KPI del Dashboard');
  // El avance físico SÍ se topa: la misma obra va al 60%, no al 72%.
  check(casi(t.avanceSeries?.[i4], 60, 0.01),
    `el avance físico de esa semana sigue siendo 60% (P1: el avance sí se topa)`);

  const p = correr('ProyeccionAvanceGasto', props, QUIERO_PROY);
  const ult = p.ejecAcum?.[p.ejecAcum.length - 1];
  check(casi(ult, EJEC_REAL),
    `gráfica de proyección, último histórico: ${MXN(ult)} (esperado ${MXN(EJEC_REAL)})`);
  check(!casi(ult, EJEC_RECONSTRUIDO),
    `y tampoco ahí es ${MXN(EJEC_RECONSTRUIDO)}`);
  // La prueba de fondo: las dos gráficas y el KPI dan el MISMO número.
  check(casi(ult, t.ejecutadoSeries?.[t.ejecutadoSeries.length - 1]),
    'las dos gráficas coinciden entre sí en el ejecutado de hoy');
}

console.log('\n2. Frontera de esquema en tendencias — tramo viejo señalado, no borrado');
{
  // Esquema 1 hasta la semana −3, esquema 2 desde la −2.
  const hist = [
    snap(6, { av: 30, me: 3_000_000, esquema: 1 }),
    snap(2, { av: 60, me: 7_000_000, esquema: 2 }),
  ];
  const props = vacios({ obra: obraBase(), historialAvance: hist });
  const t = correr('TendenciasMensuales', props, QUIERO_TEND);

  check(t.semanas?.length === 10, `la ventana tiene las 10 semanas del contrato (${t.semanas?.length})`);
  check(t.idxFrontera === idxDe(2),
    `la frontera cae en la semana del primer snapshot esquema 2 (idx ${t.idxFrontera}, esperado ${idxDe(2)})`);
  check(t.hayTramoViejo === true,
    'se marca que hay tramo viejo: la serie mezcla dos definiciones');
  // Ningún punto se pierde: 0112 tiene un solo snapshot nuevo y con un corte
  // se quedaría con un punto suelto.
  check(t.ejecutadoSeries?.filter(v => typeof v === 'number').length === 7,
    'no se corta la serie: los 7 puntos con dato siguen ahí');
  check(casi(t.ejecutadoSeries?.[idxDe(6)], 3_000_000),
    'el tramo viejo conserva su propio dinero (el que se guardó topado)');
  check(casi(t.ejecutadoSeries?.[idxDe(2)], 7_000_000),
    `el tramo nuevo muestra ${MXN(7_000_000)}, no ${MXN(6_000_000)}`);
  check(t.esquemaPorSemana?.[idxDe(4)] === 1 && t.esquemaPorSemana?.[idxDe(1)] === 2,
    'el esquema se arrastra igual que el valor: una semana sin captura hereda la definición');
}

console.log('\n3. Obra con puro esquema viejo — no se inventa una frontera');
{
  const hist = [
    snap(6, { av: 30, me: 3_000_000, esquema: 1 }),
    snap(2, { av: 45, me: 4_500_000, esquema: 1 }),
  ];
  const t = correr('TendenciasMensuales', vacios({ obra: obraBase(), historialAvance: hist }), QUIERO_TEND);
  check(t.hayTramoViejo === false,
    'sin snapshots del esquema nuevo no hay nada que separar, así que no se punteaba nada');
  check(t.idxFrontera === -1, `y no hay índice de frontera (${t.idxFrontera})`);
}

console.log('\n4. Snapshot sin `montoEjecutado` — no disponible, no cero (P2)');
{
  // Un snapshot antiguo al que le falta el dato. Reconstruirlo desde el avance
  // daría $3,000,000 inventados; y el margen restaría contra ese número.
  const hist = [snap(6, { av: 30, esquema: 1 })];
  const props = vacios({
    obra: obraBase(), historialAvance: hist,
    otrosGastos: [{ fecha: fechaISO(haceSemanas(7)), importe: 2_000_000 }],
  });
  const t = correr('TendenciasMensuales', props, QUIERO_TEND);
  check(t.ejecutadoSeries?.[idxDe(6)] === null,
    `la semana queda en "no disponible" (valor: ${t.ejecutadoSeries?.[idxDe(6)]})`);
  check(!casi(t.ejecutadoSeries?.[idxDe(6)], 3_000_000),
    'no se rellena con los $3,000,000 que daría reconstruirlo desde el avance');
  check(t.idxPrimerAvance === idxDe(6),
    'la semana SÍ cuenta como primera con avance capturado — el avance físico existe');
  check(t.margenSeries?.[idxDe(6)] === null,
    `y aun así el margen queda en null: restar $2,000,000 de gasto contra un cero inventado dibujaría una pérdida que nadie midió (valor: ${t.margenSeries?.[idxDe(6)]})`);
}

console.log('\n5. Proyección: el ritmo no cruza la frontera de esquema');
{
  // Esquema 1 (topado) hasta la semana −4; esquema 2 desde la −3.
  //   ventana completa (mal):  (9.0M − 2.0M) / 8 = 875,000 por semana
  //   ventana acotada (bien):  (9.0M − 8.0M) / 3 = 333,333 por semana
  // La diferencia no es ritmo de obra: es el escalón del cambio de definición.
  const hist = [
    snap(8, { av: 20, me: 2_000_000, esquema: 1 }),
    snap(3, { av: 50, me: 8_000_000, esquema: 2 }),
    snap(0, { av: 60, me: 9_000_000, esquema: 2 }),
  ];
  const p = correr('ProyeccionAvanceGasto', vacios({ obra: obraBase(), historialAvance: hist }), QUIERO_PROY);

  check(p.hayTramoViejo === true && p.idxFrontera === idxDe(3),
    `la proyección ve la misma frontera que las tendencias (idx ${p.idxFrontera}, esperado ${idxDe(3)})`);
  check(casi(p.ritmoEjec, 1_000_000 / 3, 1),
    `ritmo del ejecutado ${MXN(p.ritmoEjec)}/sem — medido sólo dentro del esquema vigente`);
  check(!casi(p.ritmoEjec, 875_000, 1),
    'y NO los $875,000/sem que salen de restar un punto topado de uno sin topar');
  check(casi(p.ritmoAvance, 10 / 3, 0.01),
    `ritmo del avance físico ${p.ritmoAvance?.toFixed(2)} pp/sem, con la misma ventana acotada`);
}

console.log('\n6. Proyección: termina al 100% de avance FÍSICO, y el dinero no se topa');
{
  // Ritmo de avance 5 pp/sem desde 60% → 8 semanas para cerrar.
  // Ritmo del ejecutado 875,000/sem → al cierre $16,000,000 sobre un contrato
  // de $10,000,000. Ese exceso tiene que verse, no esconderse bajo un tope.
  const hist = [
    snap(8, { av: 20, me: 2_000_000, esquema: 2 }),
    snap(0, { av: 60, me: 9_000_000, esquema: 2 }),
  ];
  const props = vacios({
    obra: obraBase(), historialAvance: hist,
    otrosGastos: [
      { fecha: fechaISO(haceSemanas(8)), importe: 1_000_000 },
      { fecha: fechaISO(haceSemanas(1)), importe: 3_000_000 },
    ],
  });
  const p = correr('ProyeccionAvanceGasto', props, QUIERO_PROY);

  check(casi(p.ritmoAvance, 5, 0.01), `ritmo de avance ${p.ritmoAvance} pp/sem`);
  check(p.semanasProy?.length === 8,
    `la proyección dura 8 semanas: lo que falta de avance físico entre el ritmo (${p.semanasProy?.length})`);
  check(casi(p.avanceProy?.[p.avanceProy.length - 1], 100, 0.01),
    'la última semana proyectada es exactamente el 100% de avance físico');
  check(p.avanceProy?.every(v => v <= 100 + 1e-9),
    'ninguna semana proyectada pasa del 100% (P1: el avance sí se topa)');

  const ejecFin = p.ejecProy?.[p.ejecProy.length - 1];
  check(casi(ejecFin, 16_000_000),
    `ejecutado proyectado al cierre ${MXN(ejecFin)} (esperado ${MXN(16_000_000)})`);
  check(ejecFin > PRESUPUESTO,
    `el dinero proyectado rebasa el contrato de ${MXN(PRESUPUESTO)} y no se recorta (P1)`);
  check(casi(p.excedenteSobreContrato, 6_000_000),
    `el exceso se reporta aparte: ${MXN(p.excedenteSobreContrato)} sobre contrato, que no es ingreso sin convenio`);

  // MARGEN CONTRA EL CONTRATO. En obra se compensan volúmenes y el cierre es
  // el importe contratado: el ingreso final es el contrato, no lo ejecutado.
  check(casi(p.gastoFinProy, 7_000_000),
    `gasto proyectado al cierre ${MXN(p.gastoFinProy)}`);
  check(casi(p.margenFinProy, 3_000_000),
    `margen proyectado ${MXN(p.margenFinProy)} = contrato ${MXN(PRESUPUESTO)} − gasto ${MXN(7_000_000)}`);
  check(!casi(p.margenFinProy, 9_000_000),
    'y NO los $9,000,000 que saldrían de contar como ingreso el ejecutado sobre contrato');
}

console.log('\n7. Obra sin excedente — el arreglo no mueve el caso normal');
{
  // Sin sobreejecución, `montoEjecutado` y `avance × presupuesto` coinciden.
  // Si este escenario se moviera, el arreglo habría roto las obras sanas.
  const hist = [
    snap(6, { av: 30, me: 3_000_000, esquema: 2 }),
    snap(2, { av: 45, me: 4_500_000, esquema: 2 }),
  ];
  const t = correr('TendenciasMensuales', vacios({ obra: obraBase(), historialAvance: hist }), QUIERO_TEND);
  check(casi(t.ejecutadoSeries?.[idxDe(6)], 3_000_000) && casi(t.ejecutadoSeries?.[idxDe(2)], 4_500_000),
    'las dos semanas dan lo mismo que antes del arreglo');
  check(t.ejecutadoSeries?.slice(0, idxDe(6)).every(v => v === null),
    'y antes del primer snapshot la serie sigue en "no disponible", no en cero');
}

} catch (e) {
  console.log(`\n✗ la prueba reventó: ${e.message}`);
  console.log('  (si corres contra una versión vieja, esto también cuenta como falla)');
  console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
if (fallos.length === 0) {
  console.log('TODO EN VERDE — la gráfica y el KPI leen el mismo dinero.');
  process.exit(0);
}
console.log(`${fallos.length} FALLA(S):`);
fallos.forEach(f => console.log('  · ' + f));
process.exit(1);
