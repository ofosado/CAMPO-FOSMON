#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// DOS CIFRAS DISTINTAS NO PUEDEN LLAMARSE IGUAL EN LA MISMA PANTALLA
// ════════════════════════════════════════════════════════════════════════════
//
// Un banco para una CLASE de defecto, no para un renglón. La medición encontró
// cinco divergencias en el tablero y en el PDF, y las cinco eran la misma cosa:
// la pantalla publicaba dos números con el mismo nombre, o uno solo calculado
// de dos maneras según quién preguntara.
//
// ── QUÉ SE AFIRMA ──────────────────────────────────────────────────────────
//
// 1 · EL PLAZO SE CUENTA UNA VEZ. Había dos cuentas:
//     · la tarjeta de la dependencia medía contra `finVigenteDe` y tomaba el
//       hoy del calendario de la OBRA;
//     · la proyección del tablero del contratista hacía `new Date(obra.fin)`
//       —el fin del CONTRATO, ignorando la ampliación— y `Date.now()`.
//     O sea que en una obra ampliada la dependencia veía un plazo más veraz
//     que el contratista dueño de la obra, y el contratista se veía más
//     atrasado de lo que estaba. Ahora las dos pasan por `plazoDeObra`.
//
// 2 · EL DÍA NO SE CORRE. "2026-05-27" se interpreta como UTC, que en México
//     es el 26 a las 18:00. Para una DIFERENCIA entre dos fechas cortas eso se
//     cancela, pero `Date.now()` no es una fecha corta: restarle una fecha UTC
//     metía hasta un día de error en los días transcurridos. Se afirma el
//     entero exacto, que es donde el corrimiento se ve.
//
// 3 · UN PLAZO QUE NO SE PUEDE MEDIR NO ES CERO. Sin una de las dos puntas la
//     cuenta devuelve `null`, y la pantalla dice que falta la fecha. Un 0%
//     afirmaría que la obra acaba de arrancar.
//
// 4 · EL PDF NO SE QUEDA CON UN GASTO MÁS CHICO QUE LA PANTALLA. El prólogo
//     del PDF filtraba maquinaria y almacén por descripción no vacía; el
//     tablero (`calcularKPIsObra`) los suma sin preguntar. Un renglón con
//     importe pero sin describir desaparecía del documento QUE SE ENTREGA, y
//     el margen del papel salía MEJOR que el de la pantalla. De las cuatro
//     sumas de maquinaria del archivo, tres no filtran; ésa era la única.
//
// 5 · NINGÚN RÓTULO PUBLICA DOS CIFRAS. Se recorre el JSX de `Dashboard` por
//     AST, se emparejan los rótulos literales con la expresión de dinero que
//     los acompaña, y se exige que un mismo rótulo no lleve dos expresiones
//     distintas. Así estaba «Monto ejecutado»: valía `me` en la tarjeta del
//     margen y `am` en la de estimaciones — $1,040,000 de diferencia en el
//     Parque Lineal, que es el pendiente #8 (las tres fórmulas de ejecutado).
//
// CON CANARIO. «Que no divergan» se cumple trivialmente devolviendo siempre
// cero o callándose, así que cada aserción tiene su gemela: la obra SIN
// ampliación tiene que seguir midiendo contra `obra.fin`, el plazo completo
// tiene que seguir saliendo, y el PDF con todo descrito tiene que seguir
// cuadrando. Una cuenta que se calla no pasa este banco.
//
// Lo que NO cubre: los colores, el SVG de las gráficas, la selección de fotos.
//
// Uso:  node scripts/prueba-dos-numeros-con-el-mismo-nombre.cjs
//       node scripts/prueba-dos-numeros-con-el-mismo-nombre.cjs --contraprueba
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

const { taller, alPapel, sinComentarios, OPTS } = require("./taller-de-app.cjs");

const ARCHIVO = path.join(raiz, 'src/App.jsx');
const FUENTE = fs.readFileSync(ARCHIVO, 'utf8');

// ── El escenario ───────────────────────────────────────────────────────────
const diasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
                   `${String(d.getDate()).padStart(2, '0')}`;
const semDe = (n) => {
  const t = diasAtras(n * 7); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return Math.ceil(((t - ini) / 86400000 + 1) / 7);
};

const PRESUPUESTO = 25_800_000;

// Los días se eligen exactos y redondos para que el corrimiento de UTC se vea:
// arrancó hace 200 días justos, el plazo de CONTRATO se venció hace 40, y la
// ampliación lo lleva 90 días hacia adelante.
const DIAS_TRANSCURRIDOS = 200;
const DIAS_CONTRATO      = 160;   // inicio → fin del contrato
const DIAS_VIGENTE       = 290;   // inicio → fin ampliado

// La obra ampliada. Con el fin del contrato ya vencido, leer `obra.fin` da
// «100% del plazo, 0 días restantes» y leer el vigente da algo muy distinto:
// es el escenario donde las dos cuentas no se pueden confundir.
const LA_AMPLIADA = {
  id: '0126', gpId: '0126',
  nombre: 'AYU-COAT-LA CANGREJERA',
  presupuesto: PRESUPUESTO,
  inicio: iso(diasAtras(DIAS_TRANSCURRIDOS)),
  fin:    iso(diasAtras(DIAS_TRANSCURRIDOS - DIAS_CONTRATO)),
  finAmpliado: iso(diasAtras(DIAS_TRANSCURRIDOS - DIAS_VIGENTE)),
  modoAvance: 'volumen',
  diasPago: 30,
};

// El canario: la MISMA obra sin ampliación. Aquí el fin vigente ES el del
// contrato, y el plazo tiene que seguir saliendo completo.
const LA_LLANA = { ...LA_AMPLIADA };
delete LA_LLANA.finAmpliado;

// Y la que no se puede medir: sin fin de ninguna clase.
const LA_SIN_FIN = { ...LA_LLANA };
delete LA_SIN_FIN.fin;

const DINERO_MEDIDO = 14_000_000;
const GP = {
  obras: {
    '0126': {
      id: '0126', nombre: '0126 AYU-COAT-LA CANGREJERA',
      grandTotal: DINERO_MEDIDO, años: {},
      semanas: { [`S${semDe(6)}`]: DINERO_MEDIDO / 2,
                 [`S${semDe(3)}`]: DINERO_MEDIDO / 2 },
    },
  },
  obrasPedidas: ['0126'],
};

const SUBS = [{ sec: 'A-01', imp: PRESUPUESTO, cant: 100, pu: 258_000, cantEjec: 60 }];

// EL RENGLÓN SIN DESCRIBIR. Tiene importe y no tiene descripción: es un hueco
// de captura, no un renglón vacío. El tablero lo sumaba y el PDF lo tiraba.
const MAQ_SIN_DESCRIBIR = 1_200_000;
const ALM_SIN_DESCRIBIR =   500_000;
const MAQUINARIA = [
  { desc: 'Retroexcavadora CAT 320', vol: 120, und: 'hr', pu: 6_666.67, imp: 800_000 },
  { desc: '',                        vol: 0,   und: '',   pu: 0,        imp: MAQ_SIN_DESCRIBIR },
];
const MATERIALES = [
  { desc: 'Varilla #4', concepto: 'Acero', vol: 20, und: 'ton', imp: 300_000 },
  { desc: '',           concepto: '',      vol: 0,  und: '',    imp: ALM_SIN_DESCRIBIR },
];
// El canario del PDF: lo mismo, pero todo descrito. Los totales no cambian, y
// por eso sirve: si el documento cuadra aquí y no allá, lo que lo rompía era la
// descripción y no el importe.
const MAQ_DESCRITA = MAQUINARIA.map((m, i) => ({ ...m, desc: m.desc || `Equipo sin ficha ${i}` }));
const MAT_DESCRITO = MATERIALES.map((m, i) => ({ ...m, desc: m.desc || `Material sin ficha ${i}` }));

const snap = (n, av, me) => {
  const d = diasAtras(n * 7); const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return { semana: Math.ceil(((t - ini) / 86400000 + 1) / 7), año: t.getFullYear(),
           fechaCaptura: d.toISOString(), avancePonderado: av, montoEjecutado: me,
           esquema: 3 };
};
const HISTORIAL = [snap(6, 45, 11_610_000), snap(3, 60, 15_480_000)];

const ESTIMACIONES = [
  { num: 1, monto: 6_000_000, estatus: 'Pagada',    fechaFact: iso(diasAtras(60)) },
  { num: 2, monto: 4_000_000, estatus: 'Facturada', fechaFact: iso(diasAtras(20)) },
];

const PROPS = (obra, maquinaria = MAQUINARIA, materiales = MATERIALES) => ({
  obra, subs: SUBS, maquinaria, materiales, estimaciones: ESTIMACIONES,
  subcontratos: [], historialAvance: HISTORIAL, gpData: GP, otrosGastos: [],
  nominaHistorial: [], evidencia: [], programa: null, onNavTab: null,
});

// ── El detector de rótulos que publican dos cifras ─────────────────────────
//
// Empareja cada llamada a un formateador de dinero con el rótulo que la
// acompaña, y exige que un rótulo no lleve dos expresiones distintas.
//
// El emparejamiento se hace SÓLO en las tres formas en que este archivo arma
// una cifra con su nombre, y en ninguna otra. La primera versión subía por los
// ancestros hasta encontrar cualquier cadena, y eso daba once choques falsos:
// recogía los valores de CSS de los objetos de estilo («flex», «uppercase»,
// «0.06em») y hermanaba rótulos de tarjetas vecinas. Un detector que grita
// once veces no se lee, y no se habría leído el que importaba.
//
//   (a) `<Kpi label="X" value={MXN(y)}/>`  — el rótulo es el atributo.
//   (b) `[MXN(y), "X", …]`                 — misma tupla de un arreglo.
//   (c) `<div>X</div><div>{MXN(y)}</div>`  — el hermano ANTERIOR, cuando su
//       contenido es puro texto. Es la forma «rotulito arriba, cifra abajo»
//       que usan todas las tarjetas del tablero.
//
// Nunca se miran cadenas dentro de un `ObjectExpression`: ahí vive el CSS.
// No afirma que exista ningún nombre, sólo que ninguno lleve dos cifras, así
// que sobrevive a que se renombre cualquier tarjeta.
const FORMATEADORES = new Set(['MXN', 'MXNS', 'MXND']);
const ATRIBUTOS_DE_ROTULO = new Set(['label', 'title']);

const limpia = (s) => s.replace(/\s+/g, ' ').trim();
const esRotulo = (s) => s.length > 2 && /[a-záéíóúñ]/i.test(s);

// El texto de un elemento JSX, sólo si TODO su contenido es texto. Si trae una
// expresión dentro no es un rótulo: es otra cifra.
function textoPuroDe(nodo) {
  if (nodo?.type !== 'JSXElement') return null;
  const hijos = nodo.children.filter(h => !(h.type === 'JSXText' && !limpia(h.value)));
  if (!hijos.length || hijos.some(h => h.type !== 'JSXText')) return null;
  return limpia(hijos.map(h => h.value).join(' '));
}

// Cuántas cifras de dinero lleva un trozo. Se cuenta a mano sobre el AST en
// vez de con `traverse`, que sobre un nodo suelto pide un `scope` que aquí no
// hay.
function cifrasEn(nodo) {
  let n = 0;
  const ver = (x) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(ver); return; }
    if (x.type === 'CallExpression' && x.callee?.type === 'Identifier'
        && FORMATEADORES.has(x.callee.name)) n++;
    for (const k of Object.keys(x)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      ver(x[k]);
    }
  };
  ver(nodo);
  return n;
}

function rotulosQuePublicanDosCifras(cuerpo) {
  const ast = parse(cuerpo, { ...OPTS, allowReturnOutsideFunction: true });
  const porRotulo = new Map();
  const anota = (rotulo, expr) => {
    const r = limpia(rotulo);
    if (!esRotulo(r)) return;
    if (!porRotulo.has(r)) porRotulo.set(r, new Set());
    porRotulo.get(r).add(expr);
  };

  traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      if (callee.type !== 'Identifier' || !FORMATEADORES.has(callee.name)) return;
      if (p.node.arguments.length !== 1) return;
      const expr = cuerpo.slice(p.node.arguments[0].start, p.node.arguments[0].end)
                         .replace(/\s+/g, '');

      // (a) El elemento JSX que lleva esta cifra en algún atributo.
      const elem = p.findParent(q => q.isJSXElement());
      if (elem && !p.findParent(q => q.isObjectExpression())) {
        elem.node.openingElement.attributes.forEach(at => {
          if (at.type !== 'JSXAttribute' || !ATRIBUTOS_DE_ROTULO.has(at.name?.name)) return;
          if (at.value?.type === 'StringLiteral') anota(at.value.value, expr);
        });
      }

      // (b) La misma tupla de un arreglo.
      const arr = p.findParent(q => q.isArrayExpression());
      if (arr && !p.findParent(q => q.isObjectExpression())) {
        arr.node.elements.forEach(el => {
          if (el?.type === 'StringLiteral') anota(el.value, expr);
        });
      }

      // (c) El hermano anterior de puro texto — pero sólo si este elemento
      // lleva UNA sola cifra. Si lleva varias, el hermano anterior no es su
      // rótulo: es el encabezado de la sección. Así salía
      // «Proyección al término de obra» acusada de publicar el ritmo, la
      // proyección y lo que falta por facturar, que son tres tarjetas debajo
      // de un mismo título.
      if (elem && cifrasEn(elem.node) === 1) {
        const padre = elem.parentPath;
        const hermanos = (padre?.isJSXElement() || padre?.isJSXFragment())
          ? padre.node.children.filter(h => h.type === 'JSXElement') : [];
        const i = hermanos.indexOf(elem.node);
        if (i > 0) {
          const txt = textoPuroDe(hermanos[i - 1]);
          if (txt) anota(txt, expr);
        }
      }
    },
  });

  return [...porRotulo.entries()]
    .filter(([, exprs]) => exprs.size > 1)
    .map(([rotulo, exprs]) => `«${rotulo}» publica ${[...exprs].join(' y ')}`);
}

// ── La corrida ─────────────────────────────────────────────────────────────
async function correr(codigo) {
  const { correr: ejecutar, cuenta, cuerpoDe, funcion } = taller(codigo);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const sec = (t) => { if (!process.env.CALLADO) console.log(`\n${t}`); };

  const MXN  = cuenta('MXN');
  const MXNS = cuenta('MXNS');
  const plazoDeObra = cuenta('plazoDeObra');
  const calcularKPIsObra = cuenta('calcularKPIsObra');
  const estadoGastoGP = cuenta('estadoGastoGP');

  // ── 0 · EL ESCENARIO DICE LO QUE CREO QUE DICE ───────────────────────────
  sec('0. El escenario: una obra ampliada, con gasto medido y dos renglones sin describir');
  const est = estadoGastoGP(LA_AMPLIADA, GP);
  check(est.medido === true && est.valor === DINERO_MEDIDO,
    'el gasto de la 0126 SÍ está medido (si no, el PDF diría «sin medir» y no habría margen que comparar)',
    MXN(est.valor));
  check(LA_AMPLIADA.finAmpliado > LA_AMPLIADA.fin && LA_AMPLIADA.fin < iso(new Date()),
    'el fin de CONTRATO ya se venció y la ampliación lo lleva al futuro',
    `contrato ${LA_AMPLIADA.fin} · vigente ${LA_AMPLIADA.finAmpliado}`);

  // ── 1 · EL PLAZO SE CUENTA UNA VEZ, Y CONTRA EL FIN VIGENTE ──────────────
  sec('1. `plazoDeObra`: el fin vigente manda, y el día no se corre');
  const pzA = plazoDeObra(LA_AMPLIADA);
  check(pzA.totalDias === DIAS_VIGENTE,
    'el plazo total se mide contra el fin AMPLIADO, no contra el del contrato',
    `${pzA.totalDias} días (contrato: ${DIAS_CONTRATO})`);
  check(pzA.ampliado === true && pzA.finVigente === LA_AMPLIADA.finAmpliado,
    'y lo dice: `ampliado` viene en verdadero con el fin vigente',
    `${pzA.finVigente}`);
  check(pzA.restantes === DIAS_VIGENTE - DIAS_TRANSCURRIDOS,
    'quedan días por correr — con el fin del contrato habría dicho cero',
    `${pzA.restantes} días`);
  check(pzA.pctPlazo !== null && pzA.pctPlazo < 100,
    'y el plazo transcurrido no está en el tope — con el fin del contrato habría dicho 100%',
    `${pzA.pctPlazo.toFixed(1)}%`);

  // El corrimiento de UTC se ve en el ENTERO, no en el porcentaje.
  check(pzA.transcurridos === DIAS_TRANSCURRIDOS,
    'los días transcurridos son el entero exacto: ni uno más por el huso',
    `${pzA.transcurridos} (esperado ${DIAS_TRANSCURRIDOS})`);
  check(Number.isInteger(pzA.transcurridos) && Number.isInteger(pzA.totalDias),
    'y son enteros, no fracciones de día arrastradas desde `Date.now()`',
    `${pzA.transcurridos} / ${pzA.totalDias}`);

  // ── 2 · CANARIO: SIN AMPLIACIÓN, EL CONTRATO SIGUE MANDANDO ──────────────
  sec('2. Canario: la obra sin ampliar mide contra su propio fin, y sigue midiendo');
  const pzL = plazoDeObra(LA_LLANA);
  check(pzL.totalDias === DIAS_CONTRATO,
    'sin ampliación el plazo total es el del contrato',
    `${pzL.totalDias} días`);
  check(pzL.ampliado === false,
    'y no se inventa una ampliación que no hay', `ampliado=${pzL.ampliado}`);
  check(pzL.pctPlazo === 100 && pzL.restantes === 0,
    'con el contrato vencido el plazo SÍ llega al tope: la cuenta no se calló',
    `${pzL.pctPlazo}% · ${pzL.restantes} días`);

  // ── 3 · UN PLAZO QUE NO SE PUEDE MEDIR NO ES CERO ────────────────────────
  sec('3. Sin fecha de fin la cuenta dice que no sabe, no que son cero días');
  const pzS = plazoDeObra(LA_SIN_FIN);
  check(pzS.totalDias === null,
    'sin fin de ninguna clase el plazo total es `null`, no 0',
    `totalDias=${JSON.stringify(pzS.totalDias)}`);
  check(pzS.pctPlazo === null,
    'y el porcentaje también: un 0% afirmaría que la obra acaba de arrancar',
    `pctPlazo=${JSON.stringify(pzS.pctPlazo)}`);
  check(pzS.restantes === null,
    'y los restantes, que en 0 se leerían como «se acabó el plazo»',
    `restantes=${JSON.stringify(pzS.restantes)}`);

  // ── 4 · LA PANTALLA DE LA DEPENDENCIA USA ESA MISMA CUENTA ───────────────
  // Se ejecuta su prólogo de verdad y se compara contra `plazoDeObra`. Si
  // alguien le vuelve a escribir su propia copia, estos números se separan.
  sec('4. El prólogo de `DashboardDependencia` publica el plazo de `plazoDeObra`');
  const dep = ejecutar('DashboardDependencia', {
    obra: LA_AMPLIADA, subs: SUBS, estimaciones: ESTIMACIONES,
    historialAvance: HISTORIAL, recorteHistorial: null, notasSemana: {},
    onNavTab: null, fsGet: () => Promise.resolve(null),
    // `null` es «no hay programa capturado», que es distinto de `undefined`
    // («todavía cargando»). Esta prueba no afirma nada del programa; lo que
    // necesita es que el hook no hable con Firestore.
    useProgramaDeObra: () => null,
    // `fsGet` sale del preludio para poder doblarlo: tal cual arrastra
    // `initializeApp` detrás. Se dobla el hook, nunca la cuenta —`plazoDeObra`
    // y `calcularKPIsObra` siguen entrando por el preludio, intactas.
  }, ['useProgramaDeObra', 'fsGet']);
  check(dep.totalDias === pzA.totalDias && dep.transcurridos === pzA.transcurridos
        && dep.restantes === pzA.restantes,
    'los días de la tarjeta de la dependencia son los de `plazoDeObra`, no otros',
    `${dep.totalDias}/${dep.transcurridos}/${dep.restantes}`);
  check(dep.pctPlazo === pzA.pctPlazo,
    'y el porcentaje también sale de la misma cuenta',
    `${dep.pctPlazo?.toFixed?.(1)}% vs ${pzA.pctPlazo?.toFixed?.(1)}%`);
  check(dep.finVigente === LA_AMPLIADA.finAmpliado && dep.ampliado === true,
    'y el fin que presenta es el vigente', `${dep.finVigente}`);

  // ── 5 · NINGUNA PANTALLA SE VUELVE A RESOLVER EL PLAZO ───────────────────
  // Guarda de molde, y aquí hace falta: la proyección del tablero vive DENTRO
  // del JSX —después del `return`— así que `ejecutar` no la alcanza. Lo que se
  // afirma es que no queda en el archivo la forma que producía la segunda
  // cuenta: resolver el fin con `new Date(obra.fin)` en vez de pedir el vigente.
  sec('5. Ni el tablero ni la tarjeta vuelven a derivar el fin por su cuenta');
  for (const comp of ['Dashboard', 'DashboardDependencia']) {
    const cuerpo = sinComentarios(cuerpoDe(comp));
    check(!/new\s+Date\(\s*obra\.fin\s*\)/.test(cuerpo),
      `\`${comp}\` no resuelve el fin de plazo con \`new Date(obra.fin)\``,
      'el fin vigente se pide, no se deriva');
  }
  check(/plazoDeObra\(/.test(cuerpoDe('Dashboard'))
     && /plazoDeObra\(/.test(cuerpoDe('DashboardDependencia')),
    'las dos piden el plazo por la misma puerta', '`plazoDeObra`');

  // ── 6 · NINGÚN RÓTULO PUBLICA DOS CIFRAS ─────────────────────────────────
  sec('6. En `Dashboard`, un mismo rótulo no lleva dos expresiones de dinero');
  const choques = rotulosQuePublicanDosCifras(cuerpoDe('Dashboard'));
  check(choques.length === 0,
    'ningún rótulo del tablero publica dos cifras distintas',
    choques.length ? choques.join(' · ') : 'ninguno');

  // Las dos cifras que chocaban siguen SIENDO dos: lo que se separó son los
  // nombres, no las cuentas. Si alguien las unificara, el margen se mediría
  // contra el almacén o la facturación incluiría material en bodega.
  const kpis = calcularKPIsObra(LA_AMPLIADA, SUBS, MAQUINARIA, MATERIALES,
                                ESTIMACIONES, GP, []);
  check(kpis.me !== kpis.am && kpis.me - kpis.am === 800_000,
    'y las dos cuentas siguen existiendo por separado: `me` trae el almacén y `am` no',
    `${MXN(kpis.me)} vs ${MXN(kpis.am)} · almacén ${MXN(kpis.me - kpis.am)}`);

  // ── 7 · EL PDF NO ENTREGA UN GASTO MÁS CHICO QUE LA PANTALLA ─────────────
  sec('7. El papel que se entrega suma el mismo gasto que el tablero');
  const papel = await alPapel(funcion, PROPS(LA_AMPLIADA));
  const dice = (s) => papel.textos.some(t => t.includes(s));

  check(dice(MXN(MAQ_SIN_DESCRIBIR)),
    'el renglón de maquinaria sin describir SALE en el documento, con su importe',
    MXN(MAQ_SIN_DESCRIBIR));
  check(dice(MXN(ALM_SIN_DESCRIBIR)),
    'y el de almacén sin describir también', MXN(ALM_SIN_DESCRIBIR));
  check(dice(MXNS(kpis.diff)) || dice(MXN(kpis.diff)),
    'el margen del PDF es el MISMO que el del tablero',
    `${MXNS(kpis.diff)} (tablero) · el PDF filtrado publicaba ${MXNS(kpis.diff + MAQ_SIN_DESCRIBIR)}`);
  check(!dice(MXNS(kpis.diff + MAQ_SIN_DESCRIBIR)),
    'y no publica el margen inflado que salía de tirar el renglón sin describir',
    MXNS(kpis.diff + MAQ_SIN_DESCRIBIR));

  // ── 8 · CANARIO DEL PDF: CON TODO DESCRITO TAMBIÉN CUADRA ────────────────
  // Si el documento sólo cuadrara con renglones sin describir, lo que se
  // arregló sería otra cosa.
  sec('8. Canario: con todos los renglones descritos el papel sigue cuadrando');
  const kpisD = calcularKPIsObra(LA_AMPLIADA, SUBS, MAQ_DESCRITA, MAT_DESCRITO,
                                 ESTIMACIONES, GP, []);
  const papelD = await alPapel(funcion, PROPS(LA_AMPLIADA, MAQ_DESCRITA, MAT_DESCRITO));
  const diceD = (s) => papelD.textos.some(t => t.includes(s));
  check(kpisD.diff === kpis.diff,
    'describir un renglón no cambia ninguna cuenta del tablero',
    `${MXNS(kpisD.diff)}`);
  check(diceD(MXNS(kpisD.diff)) || diceD(MXN(kpisD.diff)),
    'y el PDF publica ese mismo margen', MXNS(kpisD.diff));
  check(diceD(MXN(MAQ_SIN_DESCRIBIR)),
    'el importe del renglón sigue en el papel cuando sí trae descripción',
    MXN(MAQ_SIN_DESCRIBIR));

  // ── 9 · LAS DOS FRASES DE «SIN FACTURAR» NO SE LLAMAN IGUAL ──────────────
  // `am − estimado` (obra ejecutada que todavía no se factura) y
  // `presupuesto − estimado` (todo el contrato que falta por facturar) son dos
  // cifras legítimas que vivían en la MISMA tarjeta llamadas «por estimar».
  sec('9. Las dos cifras de «sin facturar» salen con nombres distintos');
  // Sin la prosa: la primera versión de la cuenta de abajo salió en rojo
  // contando el COMENTARIO que explica el defecto. Una explicación no es una
  // cifra en pantalla.
  const cuerpoTablero = sinComentarios(cuerpoDe('Dashboard'));
  const ejecutadoSinFacturar = Math.max(kpis.am - kpis.estTotal, 0);
  const contratoSinFacturar  = Math.max(PRESUPUESTO - kpis.estTotal, 0);
  check(ejecutadoSinFacturar !== contratoSinFacturar,
    'el escenario las separa: son dos importes distintos',
    `${MXN(ejecutadoSinFacturar)} vs ${MXN(contratoSinFacturar)}`);
  check(/del contrato sin facturar/.test(cuerpoTablero),
    'la del contrato entero dice que es del contrato',
    '«del contrato sin facturar»');
  check(/obra ejecutada sin facturar/.test(cuerpoTablero),
    'y la de la obra ejecutada dice que es de lo ejecutado',
    '«obra ejecutada sin facturar»');
  check((cuerpoTablero.match(/por estimar/gi) || []).length <= 1,
    'y «por estimar» ya no es el nombre de las dos',
    `${(cuerpoTablero.match(/por estimar/gi) || []).length} aparición(es)`);

  return fallos;
}

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
// Cada mutación devuelve el archivo a la forma que tenía el defecto. Si alguna
// sobrevive, la aserción que la vigilaba es decorativa.
const MUTACIONES = [
  ['el plazo del tablero vuelve a medir contra el fin del CONTRATO',
    'const _pz=plazoDeObra(obra);',
    'const _pz=(()=>{const f=obra.fin,i=obra.inicio;'
    + 'const d=(a,b)=>Math.round((new Date(b)-new Date(a))/86400000);'
    + 'const t=d(i,f),tr=Math.max(d(i,hoyLocalISO()),0);'
    + 'return {finVigente:f,ampliado:false,totalDias:t,transcurridos:tr,'
    + 'restantes:Math.max(t-tr,0),pctPlazo:Math.min(tr/t*100,100)};})();'],

  ['`plazoDeObra` vuelve a resolver el fin sin mirar la ampliación',
    'const finVigente = finVigenteDe(obra);\n  const ampliado = !!finVigente && !!obra?.fin && finVigente !== obra.fin;',
    'const finVigente = obra?.fin || null;\n  const ampliado = false;'],

  // NO hay mutación que cambie `fechaLocalDeISO` por `new Date` DENTRO de
  // `dias`. Se escribió y sobrevivió, y al medir por qué resultó que la
  // mutación era la equivocada, no la aserción: entre dos fechas CORTAS el
  // corrimiento de UTC se cancela, porque las dos se corren el mismo día. El
  // corrimiento sólo aparece cuando uno de los dos lados es un instante —y eso
  // es justo la mutación de abajo, que muerde con cinco aserciones—. Queda
  // escrito para que nadie la vuelva a añadir creyendo que falta cobertura.
  ['los días transcurridos vuelven a salir del reloj del aparato',
    '  const transcurridos = obra?.inicio\n    ? Math.max(dias(obra.inicio, hoyISO) ?? 0, 0) : 0;',
    '  const transcurridos = obra?.inicio\n    ? Math.max((Date.now() - new Date(obra.inicio)) / 86400000, 0) : 0;'],

  ['un plazo sin medir vuelve a valer cero días en vez de `null`',
    '  const totalDias = dias(obra?.inicio, finVigente);',
    '  const totalDias = dias(obra?.inicio, finVigente) ?? 0;'],

  ['el porcentaje de plazo vuelve a salir en 0% cuando no se puede medir',
    '  const pctPlazo = (totalDias && totalDias > 0)\n    ? Math.min((transcurridos / totalDias) * 100, 100) : null;',
    '  const pctPlazo = (totalDias && totalDias > 0)\n    ? Math.min((transcurridos / totalDias) * 100, 100) : 0;'],

  ['la tarjeta de la dependencia se vuelve a escribir su propia cuenta de plazo',
    '  const { finVigente, ampliado, totalDias, transcurridos, restantes, pctPlazo } =\n    plazoDeObra(obra);',
    '  const finVigente = obra?.fin || null;\n'
    + '  const ampliado = false;\n'
    + '  const _d = (a,b) => (!a||!b) ? null : Math.round((new Date(b)-new Date(a))/86400000);\n'
    + '  const totalDias = _d(obra?.inicio, finVigente);\n'
    + '  const transcurridos = obra?.inicio ? Math.max(_d(obra.inicio, hoyLocalISO())||0,0) : 0;\n'
    + '  const restantes = totalDias != null ? Math.max(totalDias - transcurridos, 0) : null;\n'
    + '  const pctPlazo = (totalDias && totalDias > 0) ? Math.min((transcurridos/totalDias)*100,100) : null;'],

  ['el PDF vuelve a tirar el renglón de maquinaria sin describir',
    '  const maqActivos = maquinaria.filter(m=>pf(m.imp)>0);',
    '  const maqActivos = maquinaria.filter(m=>m.desc&&m.desc.trim()&&pf(m.imp)>0);'],

  ['el PDF vuelve a tirar el renglón de almacén sin describir',
    '  const matActivos = materiales.filter(m=>pf(m.imp)>0);',
    '  const matActivos = materiales.filter(m=>m.desc&&m.desc.trim()&&pf(m.imp)>0);'],

  ['el KPI de la tira vuelve a llamarse igual que la tarjeta de estimaciones',
    '<Kpi label="Ejecutado + almacén" value={MXN(me)}',
    '<Kpi label="Obra ejecutada" value={MXN(me)}'],

  ['la tarjeta del margen vuelve a llamar «Obra ejecutada» a `me`',
    '{[[MXN(me),"Ejecutado + almacén",C.blue,"avance+almacén"],',
    '{[[MXN(me),"Obra ejecutada",C.blue,"avance+almacén"],'],

  ['la cifra del contrato sin facturar vuelve a llamarse «por estimar»',
    'MXN(faltaEst)+" del contrato sin facturar"',
    'MXN(faltaEst)+" por estimar"'],
];

async function main() {
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
      try { fallos = await correr(FUENTE.replace(de, a)); }
      catch (e) { fallos = [`revienta: ${e.message}`]; }
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
    return;
  }

  console.log('DOS CIFRAS DISTINTAS NO PUEDEN LLAMARSE IGUAL');
  console.log('─'.repeat(74));
  const fallos = await correr(FUENTE);
  console.log('');
  if (fallos.length) {
    console.error(`ROJO: ${fallos.length} aserción(es) fallaron.`);
    fallos.forEach(f => console.error(`  · ${f}`));
    process.exit(1);
  }
  console.log('verde');
}

main().catch(e => {
  console.error(`NO ARRANCÓ: ${e && e.stack ? e.stack : e}`);
  process.exit(2);
});
