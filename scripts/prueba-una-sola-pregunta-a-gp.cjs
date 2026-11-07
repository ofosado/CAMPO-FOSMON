#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ OBRA DEL GP ES ESTA OBRA? UNA SOLA RESPUESTA EN TODO EL ARCHIVO
// ════════════════════════════════════════════════════════════════════════════
//
// EL DEFECTO QUE ESTO VIGILA SE MIDIÓ, NO SE SUPUSO. `src/App.jsx` contestaba
// esa pregunta CUATRO veces: `estadoGastoGP` —la del KPI, con sus guardas—, el
// prólogo de `TendenciasMensuales`, el de `ProyeccionAvanceGasto`, y
// `_serieGastoAcumulado`, que alimenta la columna de Δ margen. Sólo la primera
// tenía la guarda que se puso tras el incidente de la 0129: una clave de GP
// capturada que el documento de gasto todavía no conoce significa «no hay
// dato», NUNCA «búscale parecido por nombre».
//
// Medido sobre el escenario de abajo, antes del arreglo:
//   · `estadoGastoGP`        → $0, medido, motivo `sin-cheques`
//   · `TendenciasMensuales`  → $19,900,000 — el dinero de la 0121
//   · `ProyeccionAvanceGasto`→ $0, pero por no tener el paso difuso siquiera
// O sea: la tarjeta de economía dibujaba una curva semanal de casi veinte
// millones para una obra cuyo propio KPI, arriba en la misma pantalla, decía
// cero. La obra 0129 («AYU-COAT-REHABILITACION DEL MALECON») comparte «COAT» y
// «REHAB» con la 0121 («SIOP Coatza Rehab. Av. Universidad»).
//
// CUATRO VÍAS, Y DESDE EL 2026-11-06 TRES. Las tres gráficas del tablero se
// unificaron en una: `TendenciasMensuales` y `ProyeccionAvanceGasto` se
// borraron y las dos preguntan ahora por una sola, `curvaUnicaDeObra`, dentro
// de `TarjetaGraficaUnica`. Dos copias menos de la misma pregunta es
// exactamente la dirección en la que este banco empuja, así que el banco se
// mudó con ellas en vez de reescribirse: las aserciones son las mismas, sobre
// el mismo dato, contadas sobre tres vías.
//
// QUÉ SE AFIRMA AQUÍ. Que todas las vías publican el MISMO gasto, y que ese
// gasto es el que midió `estadoGastoGP`. No se busca ninguna frase en el código
// ni se comprueba que exista ningún nombre: se extrae por AST el prólogo de
// cálculo de cada componente y se EJECUTA fuera de React.
//
// CON CANARIO, Y POR LOS DOS LADOS. «La 0129 no se lleva los $19.9M» es trivial
// de cumplir si el gasto se apaga entero: el mismo banco corre el escenario
// GEMELO en el que la obra SÍ es la 0121, y entonces los $19.9M tienen que
// aparecer en todas. Un verde sobre un canario sordo no prueba nada.
//
// Lo que NO cubre: el SVG, los colores, el texto de la leyenda.
//
// Uso:  node scripts/prueba-una-sola-pregunta-a-gp.cjs
//       node scripts/prueba-una-sola-pregunta-a-gp.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ARCHIVO = path.join(raiz, 'src/App.jsx');
const FUENTE = fs.readFileSync(ARCHIVO, 'utf8');
const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining',
            'nullishCoalescingOperator', 'dynamicImport'],
};

// ── La máquina de extracción ───────────────────────────────────────────────
//
// Los helpers de módulo NO se listan a mano: se toma el cierre transitivo de
// las variables libres sobre las `const` de primer nivel del archivo y se
// copian TAL CUAL. Y `estadoGastoGP` no se dobla por nada del mundo: es la
// cuenta bajo examen, y un doble que devolviera la obra «correcta» convertiría
// este banco en un examen del doble.

const BUILTINS = new Set(['Object','Math','Date','Number','String','Array','JSON','Boolean',
  'isNaN','isFinite','parseFloat','parseInt','console','Map','Set','NaN','undefined',
  'Infinity','RegExp','Error','Promise','Intl','Symbol','globalThis']);

const libresDe = (src) => {
  const a = parse(src, { ...OPTS, allowReturnOutsideFunction: true });
  let g = [];
  traverse(a, { Program(p) { g = Object.keys(p.scope.globals); p.stop(); } });
  return g.filter(n => !BUILTINS.has(n));
};

const sinJSX = (src) => {
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
};

function taller(codigo) {
  const ast = parse(codigo, OPTS);
  const consts = [];
  const porNombre = new Map();
  const comps = {};
  traverse(ast, {
    VariableDeclaration(p) {
      if (p.parent.type !== 'Program') return;
      const d = p.node.declarations[0];
      if (d?.id?.type !== 'Identifier') return;
      const reg = { nombre: d.id.name, fuente: codigo.slice(p.node.start, p.node.end),
                    orden: consts.length };
      consts.push(reg);
      porNombre.set(reg.nombre, reg);
    },
    FunctionDeclaration(p) {
      if (p.parent.type !== 'Program') return;
      if (p.node.id?.name) comps[p.node.id.name] = p.node;
    },
  });

  const preludioPara = (src) => {
    const necesarios = new Set();
    const pendientes = libresDe(src);
    while (pendientes.length) {
      const n = pendientes.pop();
      if (necesarios.has(n) || !porNombre.has(n)) continue;
      necesarios.add(n);
      libresDe(porNombre.get(n).fuente).forEach(m => {
        if (m !== n && !necesarios.has(m)) pendientes.push(m);
      });
    }
    return consts.filter(c => necesarios.has(c.nombre))
                 .sort((a, b) => a.orden - b.orden)
                 .map(c => c.fuente).join('\n');
  };

  const STUBS = () => ({
    useState: (v) => [v, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useMemo: (f) => (typeof f === 'function' ? f() : f),
    useCallback: (f) => f,
    MXN: (v) => String(v),
    NUM: (v) => String(v),
    C: new Proxy({}, { get: () => '#000000' }),
    Card: () => null, Tit: () => null, Btn: () => null, Chip: () => null,
    React: {},
  });

  const cache = {};
  function correr(nombre, props) {
    if (!comps[nombre]) throw new Error(`no se encontró \`${nombre}\` — ¿se renombró?`);
    if (!cache[nombre]) {
      const cuerpo = comps[nombre].body.body;
      const corte = cuerpo.findIndex(s => s.type === 'ReturnStatement');
      const hasta = corte === -1 ? cuerpo.length : corte;
      if (hasta === 0) throw new Error(`\`${nombre}\` no tiene prólogo de cálculo`);
      const prologo = sinJSX(codigo.slice(cuerpo[0].start, cuerpo[hasta - 1].end));
      const preludio = preludioPara(prologo);
      const declarados = [];
      {
        const a = parse(prologo, { ...OPTS, allowReturnOutsideFunction: true });
        traverse(a, {
          Program(p) { declarados.push(...Object.keys(p.scope.bindings)); p.stop(); },
        });
      }
      const libres = libresDe(`${preludio}\n${prologo}`).filter(n => !porNombre.has(n));
      cache[nombre] = { preludio, prologo, declarados, libres };
    }
    const { preludio, prologo, declarados, libres } = cache[nombre];
    const entorno = { ...STUBS(), ...props };
    const fn = new Function(...libres,
      `${preludio}\n${prologo}\n;return {${declarados.join(',')}};`);
    return fn(...libres.map(k => entorno[k]));
  }

  function cuenta(nombre) {
    const reg = porNombre.get(nombre);
    if (!reg) throw new Error(`no se encontró la cuenta \`${nombre}\``);
    const preludio = preludioPara(reg.fuente);
    const libres = libresDe(`${preludio}\n${reg.fuente}`).filter(n => !porNombre.has(n));
    const entorno = STUBS();
    return new Function(...libres, `${preludio}\n${reg.fuente}\n;return ${nombre};`)(
      ...libres.map(k => entorno[k]));
  }

  return { correr, cuenta };
}

// ── El escenario ───────────────────────────────────────────────────────────
const semanasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n * 7); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
                   `${String(d.getDate()).padStart(2, '0')}`;
const semDe = (n) => {
  const t = semanasAtras(n); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return Math.ceil(((t - ini) / 86400000 + 1) / 7);
};

const PRESUPUESTO = 9_750_000;
// La obra recién dada de alta: su clave de GP está capturada en Contrato, pero
// la corrida del gasto todavía no la conoce. Es el caso real, no uno inventado:
// el catálogo de obras va aparte y el gasto se arma por obra.
const LA_NUEVA = {
  id: '0129', gpId: '0129',
  nombre: 'AYU-COAT-REHABILITACION DEL MALECON',
  presupuesto: PRESUPUESTO,
  inicio: iso(semanasAtras(8)), fin: iso(semanasAtras(-20)),
  modoAvance: 'volumen',
};
// La vecina de nombre parecido, la que SÍ tiene dinero en el Sheet.
const LA_VECINA = { ...LA_NUEVA, id: '0121', gpId: '0121' };

// Las mismas dos obras, pero con el id que pone Firestore al darlas de alta: la
// clave de GP vive SÓLO en `gpId`. Estas formas hacen falta porque hay DOS
// guardas contra el difuso —la de `gpId` y la del prefijo del id— y con un id de
// cuatro dígitos la segunda tapa a la primera: quitar una de las dos no se
// notaría nunca. Y es la forma en la que se da de alta una obra hoy.
const LA_NUEVA_SIN_PREFIJO  = { ...LA_NUEVA, id: 'k7Qm2x9aB3cD' };
const LA_VECINA_SIN_PREFIJO = { ...LA_NUEVA, id: 'k7Qm2x9aB3cD', gpId: '0121' };
// La obra vieja: nadie capturó `gpId`, su id ES la clave. Aquí la guarda que
// trabaja es la del prefijo, la que estaba latente.
const LA_NUEVA_SIN_CLAVE  = { ...LA_NUEVA, gpId: undefined };
const LA_VECINA_SIN_CLAVE = { ...LA_NUEVA, id: '0121', gpId: undefined };

const DINERO_DE_LA_VECINA = 19_900_000;

// El documento del gasto: trae la 0121 con dinero y declara haber PEDIDO la
// 0129. Ese detalle es el que hace que el cero de la 0129 sea un cero MEDIDO
// —`sin-cheques`— y no un hueco; si no se hubiera pedido, la respuesta correcta
// sería «sin medir», que es otra cosa.
const GP = {
  obras: {
    '0121': {
      id: '0121', nombre: '0121 SIOP Coatza Rehab. Av. Universidad',
      grandTotal: DINERO_DE_LA_VECINA,
      años: {},
      semanas: {
        [`S${semDe(6)}`]: DINERO_DE_LA_VECINA / 2,
        [`S${semDe(3)}`]: DINERO_DE_LA_VECINA / 2,
      },
    },
  },
  obrasPedidas: ['0121', '0129'],
};

const SUBS = [{ sec: 'A-01', imp: PRESUPUESTO, cant: 100, pu: 97_500, cantEjec: 40 }];

const snap = (n, av, me) => {
  const d = semanasAtras(n); const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return { semana: Math.ceil(((t - ini) / 86400000 + 1) / 7), año: t.getFullYear(),
           fechaCaptura: d.toISOString(), avancePonderado: av, montoEjecutado: me,
           esquema: 3 };
};
const HISTORIAL = [snap(6, 20, 1_950_000), snap(3, 35, 3_412_500)];

const PROPS = (obra) => ({
  obra, historialAvance: HISTORIAL, subs: SUBS,
  gpData: GP, estimaciones: [],
  otrosGastos: [], maquinaria: [], materiales: [], programa: null,
});

// ── Las aserciones ─────────────────────────────────────────────────────────

const MXN = (v) => (typeof v === 'number')
  ? '$' + Math.round(v).toLocaleString('es-MX') : String(v);
const casi = (a, b, tol = 1) => typeof a === 'number' && Math.abs(a - b) <= tol;
const tope = (arr) => {
  const nums = (arr || []).filter(v => typeof v === 'number');
  return nums.length ? Math.max(...nums) : 0;
};

function correr(codigo) {
  const { correr: ejecutar, cuenta } = taller(codigo);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const sec = (t) => { if (!process.env.CALLADO) console.log(`\n${t}`); };

  const estadoGastoGP = cuenta('estadoGastoGP');
  const serieGastoDeSemanas = cuenta('serieGastoDeSemanas');
  const semanasDeVentana = cuenta('semanasDeVentana');
  const _serieGastoAcumulado = cuenta('_serieGastoAcumulado');

  // ── 0 · EL ESCENARIO DICE LO QUE CREO QUE DICE ───────────────────────────
  // Si el fixture dejara de parecerse, todo lo de abajo pasaría por la razón
  // equivocada: la 0129 y la 0121 tienen que compartir palabras de verdad.
  sec('0. El escenario reproduce el incidente de la 0129');
  const estNueva = estadoGastoGP(LA_NUEVA, GP);
  const estVecina = estadoGastoGP(LA_VECINA, GP);
  check(estVecina.valor === DINERO_DE_LA_VECINA,
    'el Sheet trae el dinero de la 0121 y se puede leer', MXN(estVecina.valor));
  check(!GP.obras[LA_NUEVA.gpId],
    'la clave de la 0129 está capturada y el documento de gasto no la conoce',
    `gpId ${LA_NUEVA.gpId}`);
  // El parecido por nombre se mide ejecutando la normalización del archivo, no
  // mirando las cadenas: si cambiara el umbral, esto lo tendría que ver.
  const norm = s => (s || '').toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const palNueva = norm(LA_NUEVA.nombre).split(' ').filter(w => w.length > 3);
  const palVecina = norm(GP.obras['0121'].nombre).replace(/^\d{4}\s*/, '')
    .split(' ').filter(w => w.length > 3);
  const comunes = palNueva.filter(p => palVecina.some(g => g.includes(p) || p.includes(g)));
  check(comunes.length >= 2,
    'y los dos nombres comparten ≥2 palabras, que es lo que dispara el difuso',
    comunes.join(', '));

  // ── 1 · UNA SOLA RESPUESTA A «¿QUÉ OBRA DEL GP ES ÉSTA?» ─────────────────
  sec('1. La obra nueva no se lleva el dinero de su vecina');
  check(estNueva.valor === 0 && estNueva.medido === true &&
        estNueva.motivo === 'sin-cheques',
    'el KPI dice cero MEDIDO, no «sin dato» ni el dinero de la 0121',
    `${MXN(estNueva.valor)} · medido=${estNueva.medido} · ${estNueva.motivo}`);
  check(estNueva.obraGP === null,
    'y el veredicto declara que no cruzó con ninguna obra del Sheet',
    String(estNueva.obraGP));

  const tend = ejecutar('TarjetaGraficaUnica', PROPS(LA_NUEVA));

  check(tope(tend.g?.gasto) === 0,
    'la curva no dibuja un peso en ninguna de sus semanas',
    MXN(tope(tend.g?.gasto)));
  check(tope(Object.values(tend.g?.gastoPorSem || {})) === 0,
    'ni la columna de gasto acumulado de la tabla',
    MXN(tope(Object.values(tend.g?.gastoPorSem || {}))));
  check(tope(tend.gastoDelta) === 0,
    'ni la columna de «Gasto de la semana», que lee el mapa y no la serie',
    MXN(tope(tend.gastoDelta)));
  // El cero de esta obra es un cero MEDIDO: la 0129 sí está en la corrida del
  // gasto, lo que no tiene es cheques. Así que la gráfica dibuja su línea sobre
  // la base del eje y eso es correcto —es lo que se gastó—, y NO la declara
  // ausente. El hueco de verdad, la obra que la corrida no incluye, es otro
  // escenario y lo mide `prueba-el-numero-con-su-calificativo`. Aquí lo que se
  // vigila es que ese cero no se vuelva los $19.9M de la vecina, y el veredicto
  // que viaja con él tiene que llegar entero a la gráfica.
  check(tend.g?.gastoMedido === true,
    'el veredicto llega a la gráfica: el cero de esta obra está MEDIDO',
    `gastoMedido=${tend.g?.gastoMedido} · ${estNueva.motivo}`);
  check(!tend.g?.ausentes?.some(a => a.clave === 'gasto'),
    'y por eso no se declara ausente: un cero medido se dibuja, no se calla');

  const { gastoAcum: serieDelta } = _serieGastoAcumulado(LA_NUEVA, GP, []);
  check(tope(Object.values(serieDelta || {})) === 0,
    'y la columna de Δ margen de la lista de obras no la ve tampoco',
    MXN(tope(Object.values(serieDelta || {}))));

  // Las dos guardas, cada una sobre la forma de obra en la que es la única que
  // puede trabajar. Si sólo se probara con la 0129 —id de cuatro dígitos y
  // `gpId`—, la del prefijo taparía a la de `gpId` y quitar cualquiera de las
  // dos pasaría desapercibido.
  const estRara = estadoGastoGP(LA_NUEVA_SIN_PREFIJO, GP);
  check(estRara.valor === 0 && estRara.obraGP === null,
    'la obra cuyo id no es la clave tampoco: la guarda de `gpId` sola',
    `${MXN(estRara.valor)} · ${estRara.motivo}`);
  const estVieja = estadoGastoGP(LA_NUEVA_SIN_CLAVE, GP);
  check(estVieja.valor === 0 && estVieja.obraGP === null,
    'y la obra vieja sin `gpId` capturado: la guarda del prefijo sola',
    `${MXN(estVieja.valor)} · ${estVieja.motivo}`);

  // ── 2 · EL CANARIO: CUANDO SÍ ES SU DINERO, SE VE ────────────────────────
  // Lo de arriba se cumple solo si el gasto se apaga entero. Mismo escenario,
  // misma vecina, pero la obra ES la 0121: los $19.9M tienen que aparecer en
  // las cuatro vías. Sin esto, el banco no distingue «no le cuelga el dinero de
  // otra» de «no sabe leer el dinero».
  sec('2. Canario: cuando la obra SÍ es la del Sheet, el dinero aparece');
  const tendV = ejecutar('TarjetaGraficaUnica', PROPS(LA_VECINA));

  check(estVecina.obraGP?.id === '0121',
    'el veredicto trae la obra del Sheet con la que cruzó',
    String(estVecina.obraGP?.id));
  check(casi(tope(tendV.g?.gasto), DINERO_DE_LA_VECINA),
    'la curva llega al total del Sheet',
    MXN(tope(tendV.g?.gasto)));
  check(casi(tope(Object.values(tendV.g?.gastoPorSem || {})), DINERO_DE_LA_VECINA),
    'y la columna de la tabla también',
    MXN(tope(Object.values(tendV.g?.gastoPorSem || {}))));
  check(tendV.g?.lineas?.some(l => l.clave === 'gasto')
        && !tendV.g?.ausentes?.some(a => a.clave === 'gasto'),
    'y la línea SÍ se dibuja: no se declara ausente lo que se midió');
  const { gastoAcum: serieDeltaV } = _serieGastoAcumulado(LA_VECINA, GP, []);
  check(casi(tope(Object.values(serieDeltaV || {})), DINERO_DE_LA_VECINA),
    'y la columna de Δ margen la ve', MXN(tope(Object.values(serieDeltaV || {}))));
  // Y la ve cuando el id de CAMPO NO es la clave, que es donde se quedaba en
  // «—»: esa columna cruzaba por `o.id === obra.id`, sin mirar `gpId`.
  const { gastoAcum: serieDeltaR } = _serieGastoAcumulado(LA_VECINA_SIN_PREFIJO, GP, []);
  check(casi(tope(Object.values(serieDeltaR || {})), DINERO_DE_LA_VECINA),
    'y también con id de Firestore y la clave sólo en `gpId`',
    MXN(tope(Object.values(serieDeltaR || {}))));
  // Los dos ceros de arriba son ceros de verdad, no de que estas formas de obra
  // no sepan leer: las mismas dos, apuntadas a la 0121, cobran.
  check(casi(estadoGastoGP(LA_VECINA_SIN_PREFIJO, GP).valor, DINERO_DE_LA_VECINA),
    'la obra con id de Firestore sí cobra cuando su `gpId` está en el Sheet',
    MXN(estadoGastoGP(LA_VECINA_SIN_PREFIJO, GP).valor));
  check(casi(estadoGastoGP(LA_VECINA_SIN_CLAVE, GP).valor, DINERO_DE_LA_VECINA),
    'y la obra vieja sin `gpId` cobra por el prefijo de su id',
    MXN(estadoGastoGP(LA_VECINA_SIN_CLAVE, GP).valor));

  // ── 3 · LAS DOS VÍAS PUBLICAN EL MISMO GASTO ─────────────────────────────
  // Una cuenta por número, aplicada al gasto. Antes el par eran las dos
  // tarjetas del tablero —tendencias y proyección—; al unificarse las gráficas
  // quedó una sola, pero el par sigue existiendo y es el que de verdad importa
  // porque son DOS PANTALLAS distintas: la gráfica de la obra y la columna de
  // Δ margen de la lista de obras, que sale de `_serieGastoAcumulado`. Si
  // discrepan, el usuario ve dos gastos del mismo dinero según dónde mire.
  //
  // Las dos llavean la semana distinto —`2026-W37` la gráfica, `Y2026-S37` la
  // columna— así que hay que traducir. La traducción va aquí y no en el código:
  // lo que se afirma es que los NÚMEROS coinciden, no que las llaves se
  // escriban igual.
  sec('3. La gráfica y la columna de Δ margen publican el mismo gasto');
  const { gastoAcum: deltaVecina } = _serieGastoAcumulado(LA_VECINA, GP, []);
  const aISO = (k) => String(k).replace(/^Y(\d{4})-S(\d{1,2})$/,
    (_, a, s) => `${a}-W${String(s).padStart(2, '0')}`);
  const porSemDelta = {};
  Object.entries(deltaVecina || {}).forEach(([k, v]) => { porSemDelta[aISO(k)] = v; });
  const compartidas = (tendV.g?.semanas || [])
    .map(s => s.key)
    .filter(k => k in porSemDelta);
  // El canario de este par: que la comparación de abajo NO sea vacía. Si las
  // llaves dejaran de traducirse el solape caería a cero y «ninguna semana
  // discrepa» saldría en verde sin haber comparado nada. Se pide además que
  // alguna semana compartida traiga DINERO: dos ceros coinciden siempre.
  //
  // El umbral es 2, no 4, y es el del fixture: el documento de gasto de la
  // 0121 tiene dos semanas. Pedir cuatro sería pedirle al fixture algo que no
  // tiene y el banco saldría rojo por el escenario, no por el código.
  const conDinero = compartidas.filter(k => porSemDelta[k] > 0);
  check(compartidas.length >= 2 && conDinero.length >= 1,
    'los dos ejes se solapan de verdad y el solape trae dinero',
    `${compartidas.length} semanas en común, ${conDinero.length} con gasto`);
  const discrepan = compartidas.filter(k => {
    const i = tendV.g.semanas.findIndex(s => s.key === k);
    return !casi(tendV.g.gasto[i], porSemDelta[k]);
  });
  check(discrepan.length === 0,
    'y ninguna semana compartida publica dos gastos distintos',
    discrepan.length
      ? discrepan.map(k => `${k}: ${MXN(tendV.g.gasto[tendV.g.semanas.findIndex(s => s.key === k)])}`
          + ` vs ${MXN(porSemDelta[k])}`).join(' · ')
      : `${compartidas.length} semanas cuadran`);

  // ── 4 · EL GASTO QUE SE DIBUJA ES EL QUE MIDIÓ EL KPI ────────────────────
  // El último punto se ancla al total vivo. La cifra esperada no se teclea: sale
  // de `estadoGastoGP`, que es la del KPI del Dashboard.
  sec('4. El último punto de la curva es el gasto que publica el KPI');
  const uT = tendV.g.semanas.length - 1;
  check(casi(tendV.g.gasto[uT], estVecina.valor),
    'la curva cierra en el gasto del KPI',
    `${MXN(tendV.g.gasto[uT])} = ${MXN(estVecina.valor)}`);
  // Y en la obra nueva el cero del KPI es el cero de la curva, no una
  // coincidencia: las dos cifras salen de la misma cuenta.
  check(casi(tend.g.gasto[tend.g.semanas.length - 1], estNueva.valor),
    'y en la obra nueva, el cero de la curva es el cero del KPI',
    `${MXN(tend.g.gasto[tend.g.semanas.length - 1])} = ${MXN(estNueva.valor)}`);

  // ── 5 · EL GASTO MANUAL ANTERIOR A LA FIRMA NO SE PIERDE ─────────────────
  // La copia de la proyección no acarreaba lo de antes de la primera semana de
  // su ventana, y su ventana arranca en la firma del contrato: un gasto fechado
  // antes de ese día desaparecía de la curva sin que nada lo dijera.
  sec('5. Un gasto fechado antes del arranque sigue contando');
  const ANTIGUO = 777_000;
  const semanas = semanasDeVentana(LA_NUEVA, 12);
  const gs = serieGastoDeSemanas({
    semanas, obra: LA_NUEVA, gpData: GP,
    otrosGastos: [{ fecha: iso(semanasAtras(30)), importe: ANTIGUO }],
    maquinaria: [],
  });
  check(semanas.length > 0 && semanas[0].key >
        `${semanasAtras(30).getFullYear()}-W00`,
    'el fixture pone el gasto fuera de la ventana de verdad',
    `ventana desde ${semanas[0]?.key}`);
  check(casi(gs.porSem[semanas[0].key], ANTIGUO),
    'la primera semana de la ventana ya arranca con ese gasto encima',
    MXN(gs.porSem[semanas[0].key]));
  check(casi(gs.gtActual, ANTIGUO),
    'y el total vivo lo cuenta una sola vez', MXN(gs.gtActual));

  // ── 6 · EL GASTO QUE NO SE PUEDE FECHAR NO DESCUADRA EL ÚLTIMO PUNTO ─────
  // Una maquinaria sin fecha suma al total vivo y no se puede repartir por
  // semana. Sin ancla, el último punto de la gráfica publicaría un gasto
  // MENOR que el KPI de la misma pantalla. Y el ancla sólo se puede ver con un
  // gasto así: cuando todo está fechado, anclar no mueve nada.
  sec('6. Un gasto que el KPI suma y el reparto por semana no puede fechar');
  const SIN_FECHA = 1_250_000;
  const semanasV = semanasDeVentana(LA_VECINA, 12);
  const gsSF = serieGastoDeSemanas({
    semanas: semanasV, obra: LA_VECINA, gpData: GP,
    otrosGastos: [], maquinaria: [{ imp: SIN_FECHA }],
  });
  const ultSF = gsSF.serie[gsSF.serie.length - 1];
  const repartidoSF = gsSF.porSem[semanasV[semanasV.length - 1].key];
  check(casi(gsSF.gtActual, DINERO_DE_LA_VECINA + SIN_FECHA),
    'el total vivo suma el gasto sin fecha', MXN(gsSF.gtActual));
  check(casi(repartidoSF, DINERO_DE_LA_VECINA) && gsSF.sinFechar === true,
    'el reparto por semana no lo ve, y la cuenta lo declara',
    `reparto ${MXN(repartidoSF)} · sinFechar=${gsSF.sinFechar}`);
  check(casi(ultSF, gsSF.gtActual),
    'y el último punto publica el total vivo, no el reparto',
    `${MXN(ultSF)} = ${MXN(gsSF.gtActual)}`);

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver al defecto —tres de ellas son
// literalmente el código que había antes—, no de romper el andamiaje: el banco
// sigue arrancando y ejecutando, y tiene que salir ROJO.
const MUTACIONES = [
  ['la clave capturada que no está en el Sheet cae al match difuso',
    "    return veredictoDeClaveAusente(obra.gpId, 'capturada en Contrato');",
    ''],
  ['la clave derivada del prefijo del id cae al match difuso',
    "    const pedida = sePidio(clave);\n    if (pedida !== null) return veredictoDeClaveAusente(clave, 'prefijo del id');",
    ''],
  ['el veredicto deja de decir con qué obra del Sheet cruzó',
    '  const medido  = (valor, motivo = \'medido\', extra = {}) =>\n    ({ valor, medido: true, motivo, obraGP: null, ...extra });',
    '  const medido  = (valor, motivo = \'medido\', extra = {}) =>\n    ({ valor, medido: true, motivo, ...extra, obraGP: null });'],
  ['el gasto por semana se resuelve la obra del GP por su cuenta, como antes',
    '  const _gpEstado = estadoGastoGP(obra, gpData);\n  const obraGP = _gpEstado.obraGP;\n  const medido = _gpEstado.medido;\n\n  // El Sheet guarda',
    '  const medido = true;\n  const _arr = Object.values(gpData?.obras || {});\n  let obraGP = obra?.gpId ? _arr.find(o => o.id === obra.gpId) : null;\n  if (!obraGP && /^\\d{4}/.test(obra?.id || \'\')) {\n    obraGP = _arr.find(o => o.id === obra.id.slice(0, 4));\n  }\n  if (!obraGP && obra) {\n    const _n = s => (s || \'\').toString().toUpperCase().normalize(\'NFD\')\n      .replace(/[\\u0300-\\u036f]/g, \'\').replace(/[^\\w\\s]/g, \' \')\n      .replace(/\\s+/g, \' \').trim();\n    const _p = _n(obra.nombre).split(\' \').filter(w => w.length > 3);\n    let _mejor = null, _sc = 0;\n    for (const o of _arr) {\n      const _g = _n(o.nombre).replace(/^\\d{4}\\s*/, \'\').split(\' \').filter(w => w.length > 3);\n      const _m = _p.filter(p => _g.some(g => g.includes(p) || p.includes(g))).length;\n      if (_m > _sc) { _sc = _m; _mejor = o; }\n    }\n    if (_sc >= 2) obraGP = _mejor;\n  }\n\n  // El Sheet guarda'],
  ['el gasto por semana lee el total vivo pero no de quién es',
    '  const gtActual = resolverGastoGP(obra, gpData) + totMaq + totOtros;',
    '  const gtActual = Object.values(gpData?.obras || {})\n    .reduce((t, o) => t + extraerGastoTotalGP(o), 0) + totMaq + totOtros;'],
  ['la columna de Δ margen vuelve a cruzar por el id de CAMPO',
    '  const gpObra = estadoGastoGP(obra, gpData).obraGP;',
    '  const gpObra = gpData?.obras && Object.values(gpData.obras).find(o => o.id === obra.id);'],
  ['el gasto fechado antes del arranque se tira, como hacía la proyección',
    '  const primera = semanas[0]?.key;\n  if (primera) {\n    Object.keys(manualIncrem).forEach(k => {\n      if (k < primera) acumManual += manualIncrem[k];\n    });\n  }',
    ''],
  // La mutación «la proyección se arma otra vez su propia serie de gasto» se
  // fue con `ProyeccionAvanceGasto` el 2026-11-06: ya no hay una segunda
  // tarjeta que pueda armarse su serie, y eso es la mejora, no una pérdida de
  // cobertura.
  //
  // Lo que NO se puso aquí, a propósito: quitarle a la gráfica única la guarda
  // `gastoMedido` de la línea de gasto. Se intentó y SOBREVIVIÓ, y la razón es
  // el escenario: las dos obras de este banco tienen gasto MEDIDO —la 0129 es
  // un cero medido, no un hueco—, así que ninguna aserción de aquí puede verla.
  // Esa mutación vive en `prueba-el-numero-con-su-calificativo`, que es el
  // banco cuyo escenario sí es una obra que la corrida no incluye. Una
  // mutación que ningún escenario puede morder no mide nada: mide que el banco
  // la tiene escrita.
  ['el último punto de la curva deja de ser el gasto del KPI',
    '    return (anclada && i === semanas.length - 1) ? gtActual : (porSem[s.key] ?? null);',
    '    return porSem[s.key] ?? null;'],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!FUENTE.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje en la fuente`);
      process.exit(2);
    }
    let fallos;
    process.env.CALLADO = '1';
    try { fallos = correr(FUENTE.replace(de, a)); }
    catch (e) {
      // Reventar NO es salir en rojo: mide que el taller sabe parsear, no que
      // la aserción muerda. Contarlo como ROJO deja pasar mutaciones que en
      // realidad nadie detecta, así que es NO ARRANCÓ, que es un 2.
      console.error(`NO ARRANCÓ: la mutación «${titulo}» revienta el trozo ` +
                    `en vez de romper la semántica: ${e.message}`);
      process.exit(2);
    }
    delete process.env.CALLADO;
    if (fallos.length) {
      console.log(`   ✓ ROJO  ${titulo}  ·  ${fallos.length} aserción(es) mordieron`);
      console.log(`           la primera: ${fallos[0]}`);
    } else {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      sobrevivieron++;
    }
  }
  if (sobrevivieron) {
    console.error(`\nROJO: ${sobrevivieron} mutación(es) sobrevivieron. Las aserciones no muerden.`);
    process.exit(1);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.`);
  process.exit(0);
}

console.log('UNA SOLA PREGUNTA A GP · la 0129 no se lleva los $19.9M de la 0121');
const fallos = correr(FUENTE);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
