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
// LAS DOS ÚLTIMAS SE QUEDARON SIN SUJETO EL 2026-11-06. Las tres gráficas de la
// pantalla de obra se unificaron en una y `ProyeccionAvanceGasto` se borró con
// su ritmo, su proyección y su margen al cierre; las secciones 5, 5b y 6 de
// este banco medían ESE código y se fueron con él, porque una prueba que mide
// algo que ya no existe es una prueba que no mide nada. Las dos reglas que
// defendían —ningún ritmo resta a través de una frontera de esquema, y la obra
// termina cuando el avance FÍSICO llega al 100%, no cuando el dinero alcanza el
// contrato— siguen siendo reglas, y vuelven a tener banco cuando se reconstruya
// el bloque de ritmo sobre cortes CERRADOS. Queda anotado aquí, donde se medía,
// y no sólo en PENDIENTES.
//
// Esta prueba NO busca frases en el código: extrae por AST `curvaUnicaDeObra`
// —la cuenta que arma las series que dibujan el tablero y el PDF— y la EJECUTA
// fuera de React, comparando las series resultantes contra números calculados a
// mano. Es P3: se verifica que el comportamiento ocurre, no que el mecanismo
// esté escrito.
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

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

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
                 'avanceFisicoPonderado', 'contratoDeSub', 'compensacionVolumenes',
                 'ESQUEMA_SNAPSHOT', 'ESQUEMA_DINERO', 'ESQUEMA_AVANCE', 'sonComparables',
                 'montoEjecutadoSnap', 'esquemaDe',
                 // Las dos conversiones de fecha↔semana entran por aquí a
                 // propósito. Son las que deciden en qué semana cae el arranque
                 // de la obra, y si la prueba se las imitara con un `new Date`
                 // propio dejaría de ver justamente el defecto que encontró: el
                 // lunes que se iba a la semana de antes.
                 'fechaLocalDeISO', 'jueveDeSemanaISO', 'semanaISO',
                 // El eje de semanas y las dos series salieron de dentro del
                 // componente a nivel de módulo cuando el tablero del municipio
                 // pasó a dibujar la misma Curva S. Entran por aquí, copiadas
                 // del archivo, y NO como dobles: si `serieAvanceDeSemanas`
                 // dejara de anclar la última semana al avance de hoy, esta
                 // prueba lo tiene que ver. Un doble que devolviera la serie
                 // «correcta» convertiría el guardián de los $2.7M en un
                 // examen de la prueba a sí misma.
                 'claveSemanaISO', 'semanasDeVentana', 'serieAvanceDeSemanas',
                 'serieProgramadaDeSemanas',
                 // Cuál de dos snapshots de la misma semana se dibuja. Entra
                 // copiada y NO como doble por la misma razón que las de
                 // arriba: esta decisión estaba escrita dos veces —en la serie
                 // del PDF y en la del tablero— y las dos descartaban el
                 // snapshot nuevo en silencio cuando le faltaba
                 // `fechaCaptura`, porque `NaN > x` es falso. Un doble que
                 // siempre eligiera «el bueno» taparía exactamente eso.
                 'capturaMasReciente',
                 // El gasto por semana salió también a nivel de módulo, y con
                 // él la pregunta «¿qué obra del GP es ésta?»: la contestan
                 // `estadoGastoGP` y nadie más. Entran copiadas, NO como
                 // dobles, por la misma razón que las de arriba: el defecto que
                 // provocó el cambio fue que las dos copias de esta cuenta
                 // resolvían la obra del GP por su lado, sin la guarda contra el
                 // match difuso, y la tarjeta le colgaba a una obra el dinero de
                 // otra. Un doble que devolviera la serie «correcta» taparía eso.
                 'serieGastoDeSemanas', 'estadoGastoGP', 'resolverGastoGP',
                 'extraerGastoTotalGP',
                 // El programado y su rótulo: `serieProgramadaDeSemanas` llama
                 // a `avanceProgramadoA`, que arrastra el resto de la cadena
                 // del anexo. Con `programa` undefined ninguna de estas se
                 // ejecuta —la serie sale toda en `null` y la fuente es
                 // `cargando`—, pero tienen que EXISTIR o el prólogo revienta.
                 'avanceProgramadoA', 'programaConArranque', 'pctProgramadoEnFecha',
                 'acumuladoProgramado', 'mesesDelPrograma', 'diaDeBarra', 'diasDelMes',
                 'tramosDeBarra', 'hoyLocalISO', 'fechaEnZonaObra', 'ZONA_OBRA',
                 'ROTULO_PROGRAMADO', 'finVigenteDe',
                 // LA CUENTA BAJO EXAMEN. Antes se recortaba el prólogo del
                 // componente por AST y se corría con los hooks doblados;
                 // ahora las series las arma `curvaUnicaDeObra` a nivel de
                 // módulo, porque el PDF dibuja el mismo objeto y una segunda
                 // copia es una segunda cuenta. Se ejercita la cuenta directa:
                 // es la que publica las cifras, y entrar por el componente
                 // sólo añadía andamiaje que se rompe con cada renombre.
                 'curvaUnicaDeObra', 'COLOR_CURVA', 'fmtDineroCorto',
                 'tramosDeSerie',
                 // El formateador real, no un doble: los pp de la tabla salen
                 // de él y un `String(v)` escondería un redondeo distinto.
                 'NUM'];
const fuentesHelper = [];
const hallados = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && HELPERS.includes(d.id.name)) {
      fuentesHelper.push(codigo.slice(p.node.start, p.node.end));
      hallados.add(d.id.name);
    }
  },
});
const PRELUDIO = fuentesHelper.join('\n');
// Si falta uno, el preludio revienta al evaluarse y la excepción se classifica
// como NO ARRANCÓ (2) por el vigilante de arriba. Se pregunta antes y por
// nombre para que el informe diga CUÁL falta en vez de dejar una traza de
// `ReferenceError` a media cuenta. Ver `no-arranco`.
const faltanHelpers = HELPERS.filter(h => !hallados.has(h));
if (faltanHelpers.length) noArranco(faltanHelpers, ARCHIVO);

const BUILTINS = new Set(['Object','Math','Date','Number','String','Array','JSON','Boolean',
  'isNaN','isFinite','parseFloat','parseInt','console','Map','Set','NaN','undefined','Infinity',
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

// Dobles: React fuera de React, y nada más. El gasto del Sheet NO se dobla —
// entra por HELPERS, sacado del archivo—: los escenarios de aquí dicen qué
// contestó GP y la cuenta real saca sus conclusiones sola, que es la respuesta
// que hay que vigilar, no una que la prueba se cablea.
//
// OJO con qué significa `gpData: null`. Hasta #100 significaba «el gasto de
// esta obra es cero», porque `resolverGastoGP` devolvía un número y cero era
// el único número que podía devolver sin documento. Ya no: sin documento de
// gasto el veredicto es SIN MEDIR, y una serie sin medir sale en `null` para
// que nadie reste contra ella. Por eso el escenario que quiera afirmar algo
// sobre el gasto tiene que decir que GP SÍ contestó —ver `gpContestoCero`—;
// `gpData: null` sigue sirviendo para los escenarios que no hablan de gasto.
const STUBS = () => ({
  useState: (v) => [v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useMemo: (f) => (typeof f === 'function' ? f() : f),
  useCallback: (f) => f,
  MXN: (v) => String(v),
  fmtMXN: (v) => String(v),
  C: new Proxy({}, { get: () => '#000000' }),
  Card: () => null, Tit: () => null, Btn: () => null, Chip: () => null,
  React: {},
});

// Saca del preludio una de las cuentas, ya evaluada. Las variables libres que
// quedan después del preludio son sólo las de pantalla —`C`, los componentes—
// y entran dobladas: se dobla el hook, nunca la cuenta.
const deModulo = (() => {
  const libres = libresDe(PRELUDIO).filter(n => !hallados.has(n));
  const entorno = STUBS();
  const sinDoble = libres.filter(n => !(n in entorno));
  if (sinDoble.length) {
    // Se inyectan como undefined pero se avisan: una variable libre inesperada
    // puede estar silenciando parte del cálculo.
    console.log(`   ! variables libres sin doble: ${sinDoble.join(', ')}`);
  }
  return (nombre) => new Function(...libres, `${PRELUDIO}\n;return ${nombre};`)(
    ...libres.map(k => entorno[k]));
})();

const curvaUnicaDeObra = deModulo('curvaUnicaDeObra');
const semanasDeVentana = deModulo('semanasDeVentana');
const serieAvanceDeSemanas = deModulo('serieAvanceDeSemanas');

// La curva de una obra con la ventana que abre la tarjeta. El rango por omisión
// es el de `TarjetaGraficaUnica`; las obras de estos escenarios son de 10
// semanas, así que la ventana la recorta el arranque de la obra y no el rango.
const curva = (props, rango = 12) =>
  curvaUnicaDeObra({ semanas: semanasDeVentana(props.obra, rango), ...props });

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

// `datosObraGP` ya no existe como prop: la obra del GP se resuelve DENTRO, con
// `estadoGastoGP`. Inyectarla por prop era justamente la rendija por la que
// cada componente se armaba su propio match.
const vacios = (extra) => {
  const o = { gpData: null, estimaciones: [], otrosGastos: [],
              maquinaria: [], materiales: [], subs: [], historialAvance: [] };
  return { ...o, ...extra };
};

// Una corrida del gasto que SÍ preguntó por esta clave y no trajo un peso.
// Eso es un cero MEDIDO —distinto del hueco de «no se le preguntó»— y es lo
// que le hace falta a un escenario cuyo gasto es todo manual: sin esto el
// gasto de GP queda sin medir, y con un sumando de tres sin medir el total
// tampoco es afirmable. El par va junto: la clave en la obra y la clave en
// `obrasPedidas`, que es exactamente lo que el cron escribe.
const CLAVE_GP = '0199';
const gpContestoCero = () => ({ obras: {}, obrasPedidas: [CLAVE_GP] });

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

  const t = curva(props);
  const i4 = idxDe(4);
  check(casi(t.ejecutado?.[i4], EJEC_REAL),
    `la curva, semana del snapshot: ${MXN(t.ejecutado?.[i4])} (esperado ${MXN(EJEC_REAL)})`);
  check(!casi(t.ejecutado?.[i4], EJEC_RECONSTRUIDO),
    `y NO es el dinero recortado ${MXN(EJEC_RECONSTRUIDO)}`);
  check(casi(t.ejecutado?.[t.ejecutado.length - 1], EJEC_REAL),
    'el último punto se ancla al mismo ejecutado que el KPI del Dashboard');
  // El avance físico SÍ se topa: la misma obra va al 60%, no al 72%.
  check(casi(t.avance?.[i4], 60, 0.01),
    `el avance físico de esa semana sigue siendo 60% (P1: el avance sí se topa)`);
  // Y el rótulo de la línea del ejecutado publica el MISMO número que la serie,
  // en sus dos unidades. Era de donde salía la discrepancia visible: la cifra
  // del eje y la del rótulo venían de dos cuentas.
  const lEjec = t.lineas?.find(l => l.clave === 'ejec');
  check(!!lEjec && typeof lEjec.fmt === 'function',
    'la línea del ejecutado trae su propio rótulo');
  check(lEjec?.fmt(EJEC_REAL) === '$7.2M · 72%',
    `el rótulo del punto del snapshot dice los pesos y el 72% del contrato (${lEjec?.fmt(EJEC_REAL)})`);
  // El porcentaje es del VALOR QUE SE ROTULA, no de otra serie que por casualidad
  // valga lo mismo. Se pregunta dos veces con valores distintos: un rótulo que
  // leyera el avance físico, o el último punto, o una constante, contestaría el
  // mismo número las dos veces. Esto es lo que ninguna comprobación de
  // subcadena sobre un solo valor alcanza a ver.
  check(lEjec?.fmt(t.presupuesto / 2) === '$5.0M · 50%',
    `y la mitad del contrato se rotula como el 50% (${lEjec?.fmt(t.presupuesto / 2)})`);
}

console.log('\n2. Frontera de esquema en tendencias — tramo viejo señalado, no borrado');
{
  // Esquema 1 hasta la semana −3, esquema 2 desde la −2.
  const hist = [
    snap(6, { av: 30, me: 3_000_000, esquema: 1 }),
    snap(2, { av: 60, me: 7_000_000, esquema: 2 }),
  ];
  const props = vacios({ obra: obraBase(), historialAvance: hist });
  const t = curva(props);
  // El esquema por semana lo resuelve `serieAvanceDeSemanas` y la curva no lo
  // republica: se le pregunta a la cuenta que lo decide, no a la que lo usa.
  const av = serieAvanceDeSemanas({ semanas: t.semanas, ...props });

  check(t.semanas?.length === 10, `la ventana tiene las 10 semanas del contrato (${t.semanas?.length})`);
  check(t.fronteraDinero?.idx === idxDe(2),
    `la frontera del DINERO cae en la semana del primer snapshot esquema 2 (idx ${t.fronteraDinero?.idx}, esperado ${idxDe(2)})`);
  check(t.fronteraDinero?.hay === true,
    'se marca que hay tramo viejo de dinero: la serie mezcla dos definiciones');
  // La frontera es POR MÉTRICA. El avance no cambió de definición entre el
  // esquema 1 y el 2 —cambió en el 3—, así que su serie NO se puntea aquí.
  // Con un solo umbral para todo, este escenario habría dibujado el avance
  // roto por un cambio que no le tocó.
  check(t.fronteraAvance?.hay === false && t.fronteraAvance?.idx === -1,
    `el AVANCE no ve frontera: su definición no cambió en el esquema 2 (idx ${t.fronteraAvance?.idx})`);
  // Ningún punto se pierde: 0112 tiene un solo snapshot nuevo y con un corte
  // se quedaría con un punto suelto.
  check(t.ejecutado?.filter(v => typeof v === 'number').length === 7,
    'no se corta la serie: los 7 puntos con dato siguen ahí');
  check(casi(t.ejecutado?.[idxDe(6)], 3_000_000),
    'el tramo viejo conserva su propio dinero (el que se guardó topado)');
  check(casi(t.ejecutado?.[idxDe(2)], 7_000_000),
    `el tramo nuevo muestra ${MXN(7_000_000)}, no ${MXN(6_000_000)}`);
  check(av.esquemaPorSemana?.[idxDe(4)] === 1 && av.esquemaPorSemana?.[idxDe(1)] === 2,
    'el esquema se arrastra igual que el valor: una semana sin captura hereda la definición');
  // Y las semanas sin captura se dibujan PUNTEADAS, no sólidas: el valor es
  // arrastrado y una recta sólida afirma que el ejecutado no se movió. Es la
  // 0114. Lo que lo decide es `ejecutadoMedido`, que la curva publica para que
  // el panel pueda partir la línea en tramos.
  check(t.ejecutadoMedido?.[idxDe(6)] === true && t.ejecutadoMedido?.[idxDe(5)] === false,
    'la semana del snapshot va medida y la de arrastre no');
}

console.log('\n3. Obra con puro esquema viejo — no se inventa una frontera');
{
  const hist = [
    snap(6, { av: 30, me: 3_000_000, esquema: 1 }),
    snap(2, { av: 45, me: 4_500_000, esquema: 1 }),
  ];
  const t = curva(vacios({ obra: obraBase(), historialAvance: hist }));
  check(t.fronteraDinero?.hay === false && t.fronteraAvance?.hay === false,
    'sin snapshots del esquema nuevo no hay nada que separar, así que no se puntea nada');
  check(t.fronteraDinero?.idx === -1 && t.fronteraAvance?.idx === -1,
    `y ninguna de las dos métricas tiene índice de frontera (${t.fronteraDinero?.idx} / ${t.fronteraAvance?.idx})`);
}

console.log('\n4. Snapshot sin `montoEjecutado` — no disponible, no cero (P2)');
{
  // Un snapshot antiguo al que le falta el dato. Reconstruirlo desde el avance
  // daría $3,000,000 inventados; y el margen restaría contra ese número.
  const hist = [snap(6, { av: 30, esquema: 1 })];
  // El gasto va MEDIDO a propósito —GP preguntó por la clave y contestó cero,
  // y los $2M están capturados a mano—: con el gasto sin medir el margen
  // saldría null de todas formas y la aserción de abajo pasaría por el motivo
  // equivocado. Lo que tiene que faltar aquí es el ejecutado, nada más.
  const props = vacios({
    obra: { ...obraBase(), gpId: CLAVE_GP }, gpData: gpContestoCero(),
    historialAvance: hist,
    otrosGastos: [{ fecha: fechaISO(haceSemanas(7)), importe: 2_000_000 }],
  });
  const t = curva(props);
  check(t.ejecutado?.[idxDe(6)] === null,
    `la semana queda en "no disponible" (valor: ${t.ejecutado?.[idxDe(6)]})`);
  check(!casi(t.ejecutado?.[idxDe(6)], 3_000_000),
    'no se rellena con los $3,000,000 que daría reconstruirlo desde el avance');
  check(t.idxPrimerAvance === idxDe(6),
    'la semana SÍ cuenta como primera con avance capturado — el avance físico existe');
  check(casi(t.gasto?.[idxDe(6)], 2_000_000),
    `canario: el gasto de esa semana SÍ está medido (${MXN(t.gasto?.[idxDe(6)])})`);
  check(t.margen?.[idxDe(6)] === null,
    `y aun así el margen queda en null: restar $2,000,000 de gasto contra un cero inventado dibujaría una pérdida que nadie midió (valor: ${t.margen?.[idxDe(6)]})`);
  // Y el área tampoco se sombrea con un borde que no existe: la curva declara
  // qué falta y con qué motivo, en vez de dejar el hueco sin dibujar y que se
  // lea como «no hay margen».
  const aMargen = t.areas?.find(a => a.clave === 'margen');
  const auMargen = t.ausentes?.find(a => a.clave === 'margen');
  check(!aMargen && !!auMargen,
    `el margen no se sombrea y se declara ausente (${auMargen ? 'declarado' : 'callado'})`);
  // Y el motivo nombra QUÉ LADO falta. Aquí el que falta es el ejecutado —el
  // gasto está medido, el canario de arriba lo comprueba—, así que decir «no
  // hay línea de gasto» sería un motivo falso. Un rótulo sin el lado ausente no
  // se puede discutir: el lector no sabe qué capturar para que aparezca.
  check(/ejecutado/.test(auMargen?.motivo || ''),
    `y el motivo nombra el lado que falta, el ejecutado (${auMargen?.motivo || 'sin motivo'})`);
}

// Aquí vivían las secciones 5, 5b y 6: el ritmo acotado a la frontera de su
// métrica, la proyección que termina al 100% de avance FÍSICO y el margen al
// cierre sin topar el ingreso. Medían `ProyeccionAvanceGasto`, que se borró el
// 2026-11-06 al unificarse las tres gráficas en una. No se reescribieron contra
// otro sujeto porque no hay otro: el ritmo se reconstruye aparte, sobre cortes
// CERRADOS, y ahí vuelven a tener banco. El porqué está arriba, en la cabecera.

console.log('\n7. Obra sin excedente — el arreglo no mueve el caso normal');
{
  // Sin sobreejecución, `montoEjecutado` y `avance × presupuesto` coinciden.
  // Si este escenario se moviera, el arreglo habría roto las obras sanas.
  const hist = [
    snap(6, { av: 30, me: 3_000_000, esquema: 2 }),
    snap(2, { av: 45, me: 4_500_000, esquema: 2 }),
  ];
  const t = curva(vacios({ obra: obraBase(), historialAvance: hist }));
  check(casi(t.ejecutado?.[idxDe(6)], 3_000_000) && casi(t.ejecutado?.[idxDe(2)], 4_500_000),
    'las dos semanas dan lo mismo que antes del arreglo');
  check(t.ejecutado?.slice(0, idxDe(6)).every(v => v === null),
    'y antes del primer snapshot la serie sigue en "no disponible", no en cero');
}

console.log('\n8. El LUNES cae en su semana, no en la de antes');
console.log('   Esta sección existe porque el defecto se descubrió por accidente:');
console.log('   las secciones de arriba salían rojas los lunes y verdes los demás');
console.log('   días. Aquí el lunes se fija a propósito para que no dependa de');
console.log('   qué día se corra la prueba.');
{
  // `new Date("2026-08-03")` se interpreta como UTC, que en México es el 2 de
  // agosto a las 18:00 — domingo, semana anterior. Un gasto capturado el lunes
  // se contabilizaba en la semana que ya cerró, y el arranque de una obra que
  // empezó en lunes metía en la gráfica una semana entera previa al contrato.
  const lunesDe = (d) => {
    const x = new Date(d); x.setHours(0,0,0,0);
    x.setDate(x.getDate() - ((x.getDay() || 7) - 1));
    return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  };
  const kDe = (n) => { const { sem, año } = isoDe(haceSemanas(n)); return `${año}-W${String(sem).padStart(2,'0')}`; };

  const lunes4 = lunesDe(haceSemanas(4));
  check(new Date(lunes4 + 'T12:00:00').getDay() === 1,
    `la fecha de prueba ${lunes4} es efectivamente un lunes`);

  const props = vacios({
    obra: obraBase(),
    historialAvance: [snap(4, { av: 40, me: 4_000_000, esquema: 2 })],
    otrosGastos: [{ fecha: lunes4, importe: 500_000 }],
  });
  // Se mira el ACUMULADO por semana y no el incremental: el incremental vivía
  // dentro del componente y ahora es interno a `serieGastoDeSemanas`. El
  // acumulado es además lo que la tabla publica, así que la aserción pasa a
  // morder sobre la cifra que alguien lee.
  const t = curva(props);

  // a) El arranque de la obra. La ventana no puede tener 11 semanas en lunes.
  check(t.semanas?.length === 10,
    `la ventana sigue teniendo las 10 semanas del contrato (${t.semanas?.length})`);
  check(t.semanas?.[0]?.key === kDe(9),
    `la primera semana es la del arranque, no la de antes (${t.semanas?.[0]?.key}, esperado ${kDe(9)})`);

  // b) Un gasto manual capturado en lunes.
  check(t.gastoPorSem?.[kDe(4)] === 500_000,
    `el gasto del lunes se suma a su propia semana ${kDe(4)} (${t.gastoPorSem?.[kDe(4)]})`);
  check(t.gastoPorSem?.[kDe(5)] === 0,
    `y la semana anterior ${kDe(5)} sigue en cero (${t.gastoPorSem?.[kDe(5)]})`);

  // Aquí iba (c): la misma comprobación sobre una estimación cobrada en lunes.
  // La serie de estimaciones por semana se armaba dentro de la tarjeta y
  // NINGUNA línea de la gráfica ni renglón de la tabla la leía; se borró con la
  // gráfica única el 2026-11-06. El lunes de un cobro no se mide en ningún
  // sitio hoy, así que no hay dónde afirmarlo. La regla de fecha —día LOCAL— la
  // siguen defendiendo (b), (d) y (e), que es la misma cuenta.

  // d) Una marca de tiempo CON hora no se toca: designa un instante, y su día
  //    local ya es el correcto. Arreglarla sería inventar el error al revés.
  const sabado = new Date(`${lunes4}T12:00:00`); sabado.setDate(sabado.getDate() - 2);
  const finDeSemana = sabado.toISOString();
  const props2 = vacios({
    obra: obraBase(),
    historialAvance: [snap(4, { av: 40, me: 4_000_000, esquema: 2 })],
    otrosGastos: [{ fecha: finDeSemana, importe: 700_000 }],
  });
  const t2 = curva(props2);
  check(t2.gastoPorSem?.[kDe(5)] === 700_000,
    `un sello de tiempo completo del sábado anterior sigue en ${kDe(5)} (${t2.gastoPorSem?.[kDe(5)]})`);
  check(t2.gastoPorSem?.[kDe(6)] === 0,
    `y no se va una semana más atrás ${kDe(6)} (${t2.gastoPorSem?.[kDe(6)]})`);

  // e) Y la función de la que cuelga todo lo demás —fotos, nómina, alertas,
  //    el id del snapshot— con fechas FIJAS, que no dependen de hoy.
  //    El 3 de agosto de 2026 es lunes y vive en la semana 32; con la lectura
  //    UTC daba 31. El 28 de enero de 2027 es el jueves de la semana 4, el año
  //    en que el 1 de enero cae en viernes.
  //    Salen por `deModulo`, igual que las demás: el prólogo ya no se puede
  //    evaluar a secas porque trae cuentas que miran `C` —los colores de la
  //    curva—, y `C` es un doble, no una constante del archivo.
  const semanaISO = deModulo('semanaISO');
  const jueveDeSemanaISO = deModulo('jueveDeSemanaISO');

  const s0803 = semanaISO('2026-08-03');
  check(s0803.semana === 32 && s0803.año === 2026,
    `el lunes 2026-08-03 es la semana 32 de 2026 (dio ${s0803.año}-W${s0803.semana})`);
  const s0802 = semanaISO('2026-08-02');
  check(s0802.semana === 31,
    `y el domingo anterior sigue siendo la 31 (dio ${s0802.semana})`);
  // Una marca de tiempo completa designa un instante: su día local manda.
  //
  // Esta afirmación es sobre México, y por eso `scripts/pruebas.cjs` corre toda
  // la suite con TZ=America/Mexico_City. No es decoración: el 2026-10-10, con
  // la laptop en Madrid, este mismo renglón dio 32 y la suite salió roja sin
  // que nadie hubiera tocado el código. Si corres este banco a mano desde otro
  // país, el aviso de abajo te lo dice en vez de dejarte buscar un defecto que
  // no existe.
  const zonaDeHoy = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!/Mexico|America\/(Merida|Monterrey|Cancun|Chihuahua|Tijuana)/.test(zonaDeHoy))
    console.log(`      (ojo: esta máquina está en ${zonaDeHoy}; con \`npm test\` se fija México)`);
  const sInst = semanaISO('2026-08-03T01:00:00Z');   // 2 de agosto, 19:00 en México
  check(sInst.semana === 31,
    `un instante que en México cae el domingo se queda en la 31 (dio ${sInst.semana})`);

  // Y lo que fijar la zona NO debe esconder: la regla real es «día local del
  // aparato», no «día en México». Se afirma sin depender de en qué país corre,
  // calculando el día local con el mismo `Date` que usa la cuenta. Un teléfono
  // en otro huso archiva su foto en la semana de SU domingo, y eso hoy es así
  // a propósito —`fechaDeclarada` es el reloj del teléfono— pero conviene que
  // esté escrito donde se mide, no sólo en PENDIENTES.
  const instante = '2026-08-03T01:00:00Z';
  const diaLocal = new Date(instante);
  const esperadaLocal = semanaISO(
    `${diaLocal.getFullYear()}-${String(diaLocal.getMonth() + 1).padStart(2, '0')}-` +
    `${String(diaLocal.getDate()).padStart(2, '0')}`).semana;
  check(semanaISO(instante).semana === esperadaLocal,
    `la semana de un instante es la de su día LOCAL, corra donde corra ` +
    `(${zonaDeHoy}: W${esperadaLocal})`);

  // f) El inverso tiene que invertir, también en un año que no empieza en jueves.
  const pares = [[2026, 1], [2026, 4], [2026, 53], [2027, 1], [2027, 4], [2027, 13], [2028, 9]];
  const malos = pares.filter(([a, s]) => {
    const r = semanaISO(jueveDeSemanaISO(a, s));
    return !(r.semana === s && r.año === a);
  });
  check(malos.length === 0,
    `el jueves de cada semana vuelve a su semana en ${pares.length} pares de año/semana` +
    (malos.length ? ` — falla en ${malos.map(p => p.join('-W')).join(', ')}` : ''));
  const jue2027 = jueveDeSemanaISO(2027, 4);
  check(jue2027.getMonth() === 0 && jue2027.getDate() === 28,
    `la semana 4 de 2027 es la del jueves 28 de enero (dio ${jue2027.toDateString()})`);
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
