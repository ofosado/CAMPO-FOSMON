#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ OBRA DEL GP ES ESTA OBRA? TRES RESPUESTAS DISTINTAS EN EL MISMO ARCHIVO
// ════════════════════════════════════════════════════════════════════════════
//
// Esto NO es un banco: es una medición. No afirma nada todavía, sólo ejecuta
// las tres resoluciones que conviven en `src/App.jsx` sobre el MISMO escenario
// y enseña qué contesta cada una.
//
// Las tres que había cuando se escribió:
//   1. `estadoGastoGP`   — la del repositorio, con sus guardas.
//   2. el prólogo de `TendenciasMensuales` — resuelve `datosObraGP` a mano.
//   3. el prólogo de `ProyeccionAvanceGasto` — otra copia, más corta.
//
// Y LO QUE MIDE HOY SON DOS. La respuesta de esta medición fue que las copias
// 2 y 3 NO tenían la guarda; se arreglaron, y el 2026-11-06 las tres gráficas
// del tablero se unificaron en una. Las copias 2 y 3 dejaron de existir: la
// gráfica única pide el gasto a `serieGastoDeSemanas`, que lo pide a
// `estadoGastoGP`. La medición se queda —sigue siendo la forma de ver si
// vuelven a brotar copias— pero enseña dos renglones, no tres, y el segundo ya
// no es una copia sino la misma cuenta vista desde la gráfica.
//
// El escenario es el que ya está escrito en el comentario de `estadoGastoGP`:
// la 0129 («AYU-COAT-REHABILITACION DEL MALECON») comparte «COAT» y «REHAB»
// con la 0121 («SIOP Coatza Rehab. Av. Universidad»). Esa guarda se puso ahí
// después del incidente; la pregunta que esta medición contesta es si las
// otras copias la tienen.
//
// Sólo lee archivos. No toca red, ni emulador, ni producción.

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

// Lo que se puede pedir por el portón se pide por el portón: `estadoGastoGP`
// y el preludio de cada prólogo. Lo que queda de Babel aquí es sólo lo que
// `deApp` no alcanza —el prólogo de cálculo de DENTRO de un componente—, que
// es justo el motivo por el que existe `fuenteDeApp`. Si alguien renombra
// `estadoGastoGP`, esto revienta nombrándolo en vez de medir otra cosa.
const { deApp, fuenteDeApp, ARCHIVO } = require('./extraer-de-app.cjs');
const FUENTE = fs.readFileSync(ARCHIVO, 'utf8');
const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining',
            'nullishCoalescingOperator', 'dynamicImport'],
};

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

const ast = parse(FUENTE, OPTS);
const comps = {};
traverse(ast, {
  FunctionDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    if (p.node.id?.name) comps[p.node.id.name] = p.node;
  },
});

// Los nombres que un trozo declara. Hace falta para saber qué queda LIBRE una
// vez pegado el preludio: eso es lo que hay que doblar.
const declaradosEn = (src) => {
  const a = parse(src, { ...OPTS, allowReturnOutsideFunction: true });
  let d = [];
  traverse(a, { Program(p) { d = Object.keys(p.scope.bindings); p.stop(); } });
  return d;
};

// El preludio sale de `fuenteDeApp`, o sea del mismo cierre transitivo que usan
// los bancos, y en modo tolerante porque aquí se le pasan TODOS los libres del
// prólogo —hooks incluidos— y los que no son de nivel superior no son un error:
// son los que toca doblar.
const preludioPara = (src) =>
  fuenteDeApp(libresDe(src), { tolerante: true }).cuerpo;

// `resolverGastoGP` NO se dobla aquí: es justo una de las tres respuestas que
// se están comparando. Doblarla convertiría la medición en un examen del doble.
const STUBS = () => ({
  useState: (v) => [v, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useMemo: (f) => (typeof f === 'function' ? f() : f),
  useCallback: (f) => f,
  C: new Proxy({}, { get: () => '#000000' }),
  React: {},
});

function correr(nombre, props) {
  const nodo = comps[nombre];
  if (!nodo) throw new Error(`no se encontró \`${nombre}\``);
  const cuerpo = nodo.body.body;
  const corte = cuerpo.findIndex(s => s.type === 'ReturnStatement');
  const hasta = corte === -1 ? cuerpo.length : corte;
  const prologo = sinJSX(FUENTE.slice(cuerpo[0].start, cuerpo[hasta - 1].end));
  const preludio = preludioPara(prologo);
  const declarados = declaradosEn(prologo);
  const delPreludio = new Set(declaradosEn(preludio));
  const libres = libresDe(`${preludio}\n${prologo}`).filter(n => !delPreludio.has(n));
  const entorno = { ...STUBS(), ...props };
  const fn = new Function(...libres,
    `${preludio}\n${prologo}\n;return {${declarados.join(',')}};`);
  return fn(...libres.map(k => entorno[k]));
}

// ── El escenario ───────────────────────────────────────────────────────────
const semanasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n * 7); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
                   `${String(d.getDate()).padStart(2, '0')}`;
const semDe = (n) => {
  const t = semanasAtras(n); t.setHours(0,0,0,0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return Math.ceil(((t - ini) / 86400000 + 1) / 7);
};

// La obra recién dada de alta: su clave de GP está capturada, pero la corrida
// del gasto todavía no la conoce.
const OBRA_0129 = {
  id: '0129', gpId: '0129',
  nombre: 'AYU-COAT-REHABILITACION DEL MALECON',
  presupuesto: 9_750_000, inicio: iso(semanasAtras(8)), fin: iso(semanasAtras(-20)),
  modoAvance: 'volumen',
};

const DINERO_DE_LA_0121 = 19_900_000;

// El documento del gasto: trae la 0121 con dinero, y dice que SÍ preguntó por
// la 0129 —o sea que el cero de la 0129 es un cero medido, no un hueco—.
const GP = {
  obras: {
    '0121': {
      id: '0121', nombre: '0121 SIOP Coatza Rehab. Av. Universidad',
      grandTotal: DINERO_DE_LA_0121,
      años: {},
      semanas: {
        [`S${semDe(6)}`]: DINERO_DE_LA_0121 / 2,
        [`S${semDe(3)}`]: DINERO_DE_LA_0121 / 2,
      },
    },
  },
  obrasPedidas: ['0121', '0129'],
};

const SUBS = [{ sec: 'A-01', imp: 9_750_000, cant: 100, pu: 97_500, cantEjec: 40 }];

const snap = (n, av, me) => {
  const d = semanasAtras(n); const t = new Date(d); t.setHours(0,0,0,0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return { semana: Math.ceil(((t - ini) / 86400000 + 1) / 7), año: t.getFullYear(),
           fechaCaptura: d.toISOString(), avancePonderado: av, montoEjecutado: me,
           esquema: 3 };
};
const HISTORIAL = [snap(6, 20, 1_950_000), snap(3, 35, 3_412_500)];

const PROPS = {
  obra: OBRA_0129, historialAvance: HISTORIAL, subs: SUBS,
  gpData: GP, datosObraGP: null, estimaciones: [],
  otrosGastos: [], maquinaria: [], materiales: [], programa: null,
};

// ── Las tres respuestas ────────────────────────────────────────────────────
const MXN = (v) => (v === null || v === undefined)
  ? String(v)
  : `$${Math.round(v).toLocaleString('es-MX')}`;

console.log('');
console.log('Qué obra del GP es la 0129, según cada copia');
console.log('─'.repeat(74));
console.log(`Obra:    ${OBRA_0129.nombre}  (id ${OBRA_0129.id}, gpId ${OBRA_0129.gpId})`);
console.log(`En GP:   sólo la 0121 «SIOP Coatza Rehab. Av. Universidad» con ${MXN(DINERO_DE_LA_0121)}`);
console.log(`         y la corrida declara haber PEDIDO la 0129.`);
console.log('');

const { estadoGastoGP } = deApp('estadoGastoGP');
const est = estadoGastoGP(OBRA_0129, GP);
console.log(`1. estadoGastoGP          → ${MXN(est.valor)}  · medido=${est.medido} · motivo=${est.motivo}`);

const tend = correr('TarjetaGraficaUnica', { ...PROPS });
const nums = (a) => (a || []).filter(v => typeof v === 'number');
const serieTend = tend.g?.gasto;
const ultTend = serieTend?.[serieTend.length - 1];
const maxTend = Math.max(0, ...nums(Object.values(tend.g?.gastoPorSem || {})));
console.log(`2. TarjetaGraficaUnica    → la serie de gasto por semana llega a ${MXN(maxTend)}`);
console.log(`                             último punto dibujado: ${
  typeof ultTend === 'number' ? MXN(ultTend) : 'sin dato'}`);
console.log(`                             veredicto que recibe:  medido=${tend.g?.gastoMedido}`);
console.log(`                             línea en la leyenda:   ${
  tend.g?.lineas?.some(l => l.clave === 'gasto') ? 'dibujada'
    : `AUSENTE · ${tend.g?.ausentes?.find(a => a.clave === 'gasto')?.motivo || 'sin motivo'}`}`);

console.log('');
console.log('3. ProyeccionAvanceGasto  → ya no existe: se borró el 2026-11-06 al');
console.log('                             unificarse las tres gráficas en una.');

console.log('');
console.log('─'.repeat(74));
const fuga = maxTend >= DINERO_DE_LA_0121;
if (fuga) {
  console.log('HAY DIVERGENCIA: la gráfica le cuelga a la 0129 el dinero de la 0121,');
  console.log('mientras `estadoGastoGP` —la que alimenta el KPI— dice que no hay gasto.');
} else {
  console.log('Las dos coinciden: ninguna le cuelga a la 0129 el dinero de la 0121.');
}
console.log('');
