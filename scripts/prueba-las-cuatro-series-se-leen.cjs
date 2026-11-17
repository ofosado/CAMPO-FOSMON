#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// CADA CIFRA DE LA GRÁFICA ES LA DE SU SERIE Y LA DE SU SEMANA
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ CAMBIÓ EL 2026-11-16 Y POR QUÉ ESTE BANCO NACE CON ÉL. La gráfica única
// dibujaba tres líneas y sólo UNA llevaba cifras. El pedido del usuario fue
// textual: «Me gustaría que se mostraran los puntos semanales y las etiquetas
// de datos… También deberían de aparecer el programado (%) y el gasto. Busca
// como desplegarlo sin que se vea muy apretado.»
//
// POR QUÉ ES ALTO Y NO BAJO. Hasta ayer la gráfica PRESENTABA el dato: una
// curva suave que el ojo lee como tendencia. Desde hoy AFIRMA sobre el dato:
// cada número impreso junto a un punto es la aserción «en esta semana, esta
// serie valía esto». Tres series rotuladas en el mismo lienzo es la situación
// en la que esa aserción se puede volver falsa sin que nada se vea roto:
//
//   · la cifra del gasto impresa junto al punto del ejecutado —se lee como
//     margen sano cuando no lo hay, y nadie la va a desconfiar porque está
//     pegada a la curva correcta;
//   · la cifra de la semana equivocada, que es el mismo defecto desplazado;
//   · la cifra que no cabe y se recorta: «$22.1M · 57%» salía como «$22.1»,
//     que es un número DISTINTO y plausible;
//   · la cifra de ESTA semana saltada por el raleo, que es justo la que se
//     busca primero;
//   · y en la tarjeta de dependencia, cualquier cifra del gasto o del margen,
//     que es la frontera que no se cruza ni en forma de etiqueta.
//
// QUÉ AFIRMA ESTE BANCO, Y CÓMO. No comprueba que exista ningún símbolo ni
// busca cadenas en el código. Saca de `src/App.jsx` el panel que dibuja
// (`PanelSemanal`), las dos cuentas que lo alimentan y LOS PROPS CON LOS QUE
// LAS DOS TARJETAS LO LLAMAN DE VERDAD —leídos del JSX del sitio de llamada,
// no tecleados aquí: con otra altura o otro formato se mediría otro dibujo—,
// lo RENDERIZA con un escenario de obra y afirma sobre el SVG que sale.
//
// La geometría no se recalcula en ningún sitio. Cada punto se lee del dibujo
// junto con su cifra —van en el mismo `<g>`, así que el emparejamiento es
// estructural y no una cuenta repetida— y el suelo del lienzo se lee de la guía
// sólida, que es la única con `stroke-dasharray="0"`.
//
// LAS SEIS AFIRMACIONES:
//
//   §1. Hay un punto por cada semana CON dato, en las tres series, y ninguno
//       donde no hay dato. El punto es la medición; la línea es interpolación.
//   §2. La cifra impresa junto a un punto es el valor de ESA serie en ESA
//       semana, con el formato de ESA serie.
//   §3. La cifra de la última semana se escribe siempre que haya cifra que
//       escribir —un cero no lo es, §5— y ancla por el final para no salirse
//       del lienzo.
//   §4. El lado del rótulo lo pide la serie, pero ninguno cae sobre el eje de
//       semanas: cuando abajo no cabe, se sube.
//   §5. Un cero no se rotula.
//   §6. En 26 semanas la cifra se ralea y en 4 no: ni apretado ni mudo. Y en la
//       tarjeta de dependencia no aparece una cifra de gasto ni de margen.
//
// LO QUE NO CUBRE: los colores, la tipografía, las áreas sombreadas y las
// series como DATO —eso es `prueba-la-grafica-que-no-miente-por-omision.cjs`,
// que mide la cuenta y declara en su cabecera que no mira el SVG. Este banco es
// la otra mitad, y mide el SVG.
//
// Uso:
//     node scripts/prueba-las-cuatro-series-se-leen.cjs
//     node scripts/prueba-las-cuatro-series-se-leen.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');
const callado = !!process.env.CALLADO;

const muere = (...lineas) => {
  console.error(`\nNO ARRANCÓ: ${lineas[0]}`);
  lineas.slice(1).forEach(l => console.error(`  ${l}`));
  process.exit(2);
};

// ── EL PANEL Y LAS DOS CUENTAS, SACADOS DEL ARCHIVO ────────────────────────
// Por la puerta única y con cierre transitivo. `React` y `useState` no se piden
// —son importaciones, no declaraciones— y entran como parámetros: el `useState`
// es el de verdad porque el panel se renderiza de verdad, y el estado inicial
// —ninguna línea apagada— es el que ve quien abre la pantalla.
const PEDIDOS = ['PanelSemanal', 'curvaUnicaDeObra', 'curvaDeGobierno',
  'semanasDeVentana', 'fmtDineroCorto', 'C'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan, path.basename(archivo));
let APP;
try {
  const compilado = esbuild.transformSync(cuerpo, { loader: 'jsx' }).code;
  APP = new Function('React', 'useState',
    `"use strict";\n${compilado}\nreturn { ${PEDIDOS.join(', ')} };`)(React, React.useState);
} catch (e) {
  muere(`el panel no se pudo armar fuera de React: ${e.message}`);
}
const { PanelSemanal, curvaUnicaDeObra, curvaDeGobierno, semanasDeVentana,
        fmtDineroCorto } = APP;

// ── LOS PROPS DE VERDAD, LEÍDOS DEL SITIO DE LLAMADA ───────────────────────
//
// No se teclean aquí. El panel dibuja distinto con otra altura y rotula
// distinto con otro formato, así que un banco que invente sus propios props
// mide un dibujo que nadie ve. Se busca la tarjeta por el TÍTULO QUE IMPRIME
// —el día que alguien renombre el componente la prueba tiene que seguir mirando
// esta misma tarjeta— y de ahí se leen los atributos del `<PanelSemanal/>` tal
// como están escritos.
const funcionQueImprime = (que, marca) => {
  const hallados = [];
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    FunctionDeclaration(p) {
      const txt = src.slice(p.node.start, p.node.end);
      if (txt.includes(marca) && !p.node.async) hallados.push(txt);
    },
    VariableDeclarator(p) {
      if (p.scope.parent || !p.node.init) return;
      const txt = src.slice(p.node.start, p.node.end);
      if (txt.includes(marca)) hallados.push(txt);
    },
  });
  if (hallados.length === 1) return hallados[0];
  muere(`${que} casó ${hallados.length} veces en ${path.basename(archivo)}.`,
    `se buscaba el título impreso: ${marca}`,
    'Si la tarjeta se reescribió, lo que hay que arreglar es el ancla.');
};

// Los atributos del `<PanelSemanal/>` de una tarjeta, ya evaluados. Las
// expresiones del sitio de llamada hablan de `semanas`, de `g` —el resultado de
// la cuenta— y de los formateadores del módulo; eso es todo lo que recibe el
// ámbito. Un atributo nuevo que nombre otra cosa revienta aquí con su nombre a
// la vista, que es ruidoso y señala el renglón.
const propsDeLaTarjeta = (que, marca) => {
  const fuente = funcionQueImprime(que, marca);
  const ast = parse(`(${fuente})`, { sourceType: 'module', plugins: ['jsx'] });
  let attrs = null;
  traverse(ast, {
    JSXOpeningElement(p) {
      if (attrs || p.node.name?.name !== 'PanelSemanal') return;
      attrs = p.node.attributes.map(a => ({
        nombre: a.name?.name,
        expr: a.value?.type === 'JSXExpressionContainer'
          ? `(${fuente})`.slice(a.value.expression.start, a.value.expression.end)
          : null,
      }));
    },
  });
  if (!attrs || attrs.some(a => !a.nombre || !a.expr)) {
    muere(`no se hallaron los props del <PanelSemanal/> de ${que}`,
      'Se busca el elemento JSX dentro de la tarjeta y se leen sus atributos.');
  }
  const cuerpoProps = `return { ${attrs.map(a => `${a.nombre}: (${a.expr})`).join(', ')} };`;
  let armar;
  try {
    armar = new Function('semanas', 'g', 'fmtDineroCorto', 'MXN', 'MXNS', cuerpoProps);
  } catch (e) {
    muere(`los props de ${que} no se pudieron leer: ${e.message}`, cuerpoProps);
  }
  return (semanas, g) => {
    try { return armar(semanas, g, fmtDineroCorto); }
    catch (e) {
      muere(`los props de ${que} nombran algo que este banco no da: ${e.message}`,
        cuerpoProps);
    }
  };
};

const PROPS_CONSTRUCTORA = propsDeLaTarjeta('la gráfica única de constructora',
  'Curva S, avance programado, avance físico y gastos</Tit>');
const PROPS_GOBIERNO = propsDeLaTarjeta('la gráfica de la dependencia',
  'Curva S, avance programado, avance físico y lo pagado</Tit>');

// ── EL ESCENARIO ───────────────────────────────────────────────────────────
//
// Una obra de $10M que arrancó hace 34 semanas, con cortes cada dos semanas y
// gasto del GP sólo desde la semana 20: así la ventana de 26 trae semanas de
// gasto en CERO al principio —que es el caso del cero que no se rotula— y
// semanas sin corte en medio —que es el tramo sin medir—. Las fechas se derivan
// de hoy: un fixture con fechas fijas sale rojo cuando pasa el tiempo, y un
// rojo por el calendario enseña a ignorar los rojos.
const PRESUPUESTO = 10_000_000;
const DIA = 86_400_000;
const haceSemanas = (n) => new Date(Date.now() - n * 7 * DIA);
// El día LOCAL del instante, no el de UTC: `toISOString` escribe la fecha de
// mañana a partir de las 18:00 en México, y entonces el arranque de la obra cae
// una semana después que los cortes, que sí viajan como instante.
const fechaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
                        `${String(d.getDate()).padStart(2, '0')}`;
const semanaISOde = (d) => {
  const j = new Date(d); j.setHours(0, 0, 0, 0);
  j.setDate(j.getDate() + 4 - (j.getDay() || 7));
  const ene = new Date(j.getFullYear(), 0, 1);
  return { sem: Math.ceil(((j - ene) / DIA + 1) / 7), año: j.getFullYear() };
};

const OBRA = {
  id: '0114', nombre: 'Obra de prueba', clave: '0114', gpId: '0114',
  presupuesto: PRESUPUESTO,
  fechaInicio: fechaISO(haceSemanas(34)),
  fechaTermino: fechaISO(haceSemanas(-18)),
  esquemaSnapshot: 3,
};

// Un corte cada dos semanas, con monto ejecutado, avance físico y lo pagado
// —que es lo que la tarjeta de dependencia dibuja—. Los montos no son
// múltiplos redondos entre sí a propósito: con cifras que se repitieran entre
// series, una etiqueta puesta en la curva equivocada podría pasar por correcta.
const corte = (atras) => {
  const d = haceSemanas(atras);
  const { sem, año } = semanaISOde(d);
  const avanzadas = 34 - atras;
  return {
    semana: sem, año, fecha: fechaISO(d), fechaCaptura: d.toISOString(),
    avancePonderado: Math.round(avanzadas * 1.7 * 10) / 10,
    montoEjecutado: Math.round(avanzadas * 171_000),
    montoPagado: Math.round(avanzadas * 123_000),
    esquema: 3,
  };
};
const HISTORIAL = [];
for (let a = 32; a >= 0; a -= 2) HISTORIAL.push(corte(a));

// EL GASTO ARRANCA TARDE A PROPÓSITO: la obra lleva 34 semanas y el primer peso
// de GP cae en la 20, así que la ventana larga siempre trae semanas en cero por
// delante. De ahí sale el canario de §5 —un cero no se rotula—, que sin ceros
// en el dibujo se cumpliría solo.
//
// Lo que esta serie NO sostiene es dónde cae la curva en el lienzo. GP detalla
// por semana sólo el AÑO DE CALENDARIO en curso, así que de enero a marzo la
// ventana larga cae casi entera en un año ya cerrado y el gasto sale en cero o
// sin dato: cualquier afirmación sobre la ALTURA de esta curva sería verde nueve
// meses al año y roja los otros tres. La geometría del rótulo se mide en §4 con
// un escenario propio.
const semGP = (n) => `S${String(semanaISOde(haceSemanas(n)).sem).padStart(2, '0')}`;
const SEMANAS_GP = {};
for (let a = 20; a >= 15; a--) SEMANAS_GP[semGP(a)] = 70_000;
for (let a = 14; a >= 0; a--) SEMANAS_GP[semGP(a)] = 180_000 + (14 - a) * 9_000;
const GP = { obras: { '0114': { id: '0114', nombre: 'Obra de prueba',
  semanas: SEMANAS_GP } }, pedidas: ['0114'] };

const PROGRAMA = {
  inicio: fechaISO(haceSemanas(34)), meses: 12, total: PRESUPUESTO,
  partidas: [{ sec: '1000 01',
    montos: [400_000, 500_000, 600_000, 700_000, 800_000, 900_000,
             900_000, 1_000_000, 1_000_000, 1_100_000, 1_100_000, 1_000_000],
    barra: 'Barra=' + Array(12).fill('0-100').join(',') }],
};

// Las estimaciones pagadas, que son el ancla de la última semana de lo pagado
// en la tarjeta de dependencia.
const ESTIMACIONES = [
  { no: 1, estatus: 'Pagada', monto: 1_830_000, fechaFact: fechaISO(haceSemanas(12)) },
  { no: 2, estatus: 'Pagada', monto: 2_240_000, fechaFact: fechaISO(haceSemanas(5)) },
];

const deConstructora = (rango) => {
  const semanas = semanasDeVentana(OBRA, rango);
  const g = curvaUnicaDeObra({ semanas, obra: OBRA, historialAvance: HISTORIAL,
    subs: [], gpData: GP, otrosGastos: [], maquinaria: [], programa: PROGRAMA });
  return { semanas, g, props: PROPS_CONSTRUCTORA(semanas, g) };
};
const deGobierno = (rango, extra = {}) => {
  const semanas = semanasDeVentana(OBRA, rango);
  const g = curvaDeGobierno({ semanas, obra: OBRA, historialAvance: HISTORIAL,
    subs: [], programa: PROGRAMA, estimaciones: ESTIMACIONES,
    estCargadas: true, ...extra });
  return { semanas, g, props: PROPS_GOBIERNO(semanas, g) };
};

const pintar = (props) => {
  try { return renderToStaticMarkup(React.createElement(PanelSemanal, props)); }
  catch (e) { return `EL PANEL SE CAYO AL PINTARSE: ${e.message}`; }
};

// ── LEER EL DIBUJO ─────────────────────────────────────────────────────────
//
// Un punto y su cifra viven en el MISMO `<g opacity="…">`, uno por semana
// dibujada. Por eso el emparejamiento se lee de la estructura y no se vuelve a
// calcular: si el banco recalculara la posición del rótulo para saber a qué
// punto pertenece, estaría comprobando su propia copia de la geometría.
const puntosDel = (html) =>
  [...html.matchAll(/<g opacity="[\d.]+">(.*?)<\/g>/g)].map(m => {
    const c = m[1].match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="2\.5" fill="([^"]+)"/);
    if (!c) return null;
    const t = m[1].match(
      /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="([^"]+)"[^>]*>([^<]*)<\/text>/);
    return { cx: +c[1], cy: +c[2], color: c[3],
      rotulo: t ? t[4] : null, lx: t ? +t[1] : null, ly: t ? +t[2] : null,
      anchor: t ? t[3] : null };
  }).filter(Boolean);

const deLaSerie = (puntos, serie) => puntos.filter(p => p.color === serie.color);
const conDato = (serie) => serie.valores
  .map((v, i) => i).filter(i => serie.valores[i] !== null && serie.valores[i] !== undefined);
const rotuloDe = (serie, props, v) => (serie.fmt || props.fmt)(v);

// EL SUELO DEL LIENZO, LEÍDO DEL DIBUJO. Es la guía sólida —la única sin
// `stroke-dasharray` de puntos— y debajo de ella empieza el eje de semanas. No
// se reconstruye de las constantes del panel: si se reconstruyera, cambiar la
// altura dejaría la prueba midiendo un lienzo que no existe.
const sueloDel = (html) => {
  const ys = [...html.matchAll(/<line [^>]*y1="([\d.]+)"[^>]*stroke-dasharray="0"/g)]
    .map(m => +m[1]);
  if (ys.length !== 1) {
    muere(`la guía sólida del panel casó ${ys.length} veces, y es por donde se lee el suelo`,
      'Si las guías se redibujaron, lo que hay que arreglar es el ancla.');
  }
  return ys[0];
};

const texto = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function correr() {
  const fallos = [];
  const ok = (cond, que, detalle = '') => {
    if (cond) { if (!callado) console.log(`   ✓ ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`   ✗ ${que}${detalle ? `\n       ${detalle}` : ''}`);
  };
  const sec = (t) => { if (!callado) console.log(`\n${t}`); };

  // Las tres ventanas que el selector ofrece y que el usuario mira: la corta
  // —donde todo cabe—, la de doce y la larga, donde el raleo tiene que actuar.
  const vista = (rango) => {
    const v = deConstructora(rango);
    const html = pintar(v.props);
    if (/SE CAYO AL PINTARSE/.test(html)) muere(`${rango} semanas: ${html}`);
    return { ...v, rango, html, puntos: puntosDel(html) };
  };
  const V4 = vista(4), V12 = vista(12), V26 = vista(26);
  const HTML12 = V12.html, P12 = V12.puntos, SERIES12 = V12.props.series;

  // CANARIO DEL ESCENARIO. Sin las tres líneas dibujadas, todo lo que sigue se
  // cumple solo: un banco que mide una sola serie no puede ver una cifra puesta
  // en la curva de otra, que es el defecto que esta rama hizo posible.
  ok(SERIES12.length === 3,
    `canario: el escenario dibuja las tres líneas (${SERIES12.map(s => s.clave).join(', ')})`,
    'con menos de tres, ninguna aserción de este banco comprueba nada');
  ok(SERIES12.every(s => s.rotulada),
    'canario: las tres piden cifra — antes sólo la pedía el ejecutado',
    SERIES12.filter(s => !s.rotulada).map(s => s.clave).join(', '));

  // ══ §1 · UN PUNTO POR SEMANA CON DATO, EN LAS TRES ═══════════════════════
  sec('§1 · el punto es la medición: uno por semana con dato, en las tres series');

  for (const s of SERIES12) {
    const pts = deLaSerie(P12, s);
    const idx = conDato(s);
    ok(pts.length === idx.length,
      `«${s.nombre}» dibuja ${idx.length} puntos, uno por semana con dato`,
      `dibujó ${pts.length}`);
  }
  const ajenos = P12.filter(p => !SERIES12.some(s => s.color === p.color));
  ok(ajenos.length === 0, 'y no hay un punto de ningún color que no sea de una serie',
    ajenos.map(p => p.color).join(', '));
  ok(P12.length === SERIES12.reduce((n, s) => n + conDato(s).length, 0),
    `en total ${P12.length} puntos, ni uno donde no hay dato`);

  // Los puntos nuevos NO se comieron los marcadores del tramo sin medir, que
  // son huecos y de otro radio: el ojo tiene que seguir viendo dónde vuelve a
  // haber dato. Se mide con un escenario que SÍ tiene semanas sin corte.
  const huecos = (HTML12.match(/r="2\.2"/g) || []).length;
  ok(SERIES12.some(s => (s.medido || []).some(m => !m)),
    'canario: el escenario tiene semanas sin corte capturado');
  ok(huecos > 0,
    `y los extremos de esos tramos siguen marcados aparte (${huecos} marcadores huecos)`,
    'los puntos de cada semana no pueden tapar dónde se dejó de medir');

  // ══ §2 · LA CIFRA ES LA DE SU SERIE Y SU SEMANA ══════════════════════════
  sec('§2 · cada cifra es el valor de esa serie en esa semana, con su formato');

  for (const s of SERIES12) {
    const pts = deLaSerie(P12, s);
    const idx = conDato(s);
    const malas = pts.map((p, k) => ({ p, esperado: rotuloDe(s, V12.props, s.valores[idx[k]]) }))
      .filter(({ p, esperado }) => p.rotulo !== null && p.rotulo !== esperado);
    ok(malas.length === 0,
      `«${s.nombre}»: las ${pts.filter(p => p.rotulo !== null).length} cifras impresas son las suyas`,
      malas.slice(0, 3).map(({ p, esperado }) =>
        `dice «${p.rotulo}» donde su valor es «${esperado}»`).join(' · '));
  }

  // Y el formato es EL DE LA SERIE, no el del eje. El ejecutado lleva monto Y
  // porcentaje del contrato; el eje sólo pesos. Si el panel aplicara su propio
  // formato a todas, el ejecutado perdería el porcentaje sin que nada se vea
  // roto — y es el único número de la gráfica que contesta «cuánto del
  // contrato».
  const ejec = SERIES12.find(s => s.fmt && s.fmt !== V12.props.fmt);
  ok(!!ejec, 'canario: alguna serie trae formato propio, distinto al del eje');
  // El `?.` no es defensa de adorno: la mutación que hace que el panel pise el
  // formato de la serie deja esta lista VACÍA, y leer su último elemento
  // reventaría el banco —salida 2— donde lo que hay es un defecto. La
  // diferencia entre rojo y no arrancó es la mitad de lo que vale una prueba.
  const conPct = ejec
    ? deLaSerie(P12, ejec).filter(p => p.rotulo && p.rotulo.includes('%')) : [];
  ok(conPct.length > 0,
    `«${ejec?.nombre}» imprime su formato propio, con el porcentaje del contrato ` +
    `(«${conPct[conPct.length - 1]?.rotulo}»)`,
    'ninguna cifra lleva el porcentaje del contrato: con el formato del eje ' +
    'desaparece, el monto se queda, y nada se ve roto');

  // ══ §3 · LA CIFRA DE ESTA SEMANA SIEMPRE, Y DENTRO DEL LIENZO ════════════
  sec('§3 · la cifra de la última semana siempre se escribe, y no se sale del lienzo');

  // EN LAS TRES VENTANAS, y ésta es la razón de medir las tres: en la de doce
  // todas las cifras caben y el raleo no actúa, así que un raleo que cuente
  // desde la PRIMERA semana en vez de desde la última sale verde ahí y deja la
  // cifra de hoy en blanco en la ventana larga —la mitad de las veces, según la
  // paridad—. La cifra de esta semana es la que se busca primero.
  for (const v of [V4, V12, V26]) {
    for (const s of v.props.series) {
      const idx = conDato(s);
      if (idx[idx.length - 1] !== v.semanas.length - 1) continue;
      // «Siempre» es siempre que haya cifra que escribir. Un cero no se escribe
      // —§5— y esa regla gana: «$0» en la última semana no dice «hoy vamos en
      // cero», dice «hoy no hay dato», y son cosas distintas. Pasa de verdad:
      // GP detalla por semana sólo el AÑO DE CALENDARIO en curso, así que en los
      // primeros días de enero, cuando la semana corriente todavía es la 52 o 53
      // del año ISO anterior, la curva del gasto es una recta en cero. Lo cazó el
      // barrido con el reloj en 2027-01-04.
      if (s.valores[v.semanas.length - 1] === 0) continue;
      const pts = deLaSerie(v.puntos, s);
      // Igual que arriba: sin puntos esto sería una excepción —salida 2, nada
      // medido— donde lo que hay es la serie entera sin dibujar.
      const ult = pts[pts.length - 1] || { rotulo: null, anchor: '(no se dibujó)' };
      ok(ult.rotulo !== null,
        `${v.rango} semanas · «${s.nombre}» escribe la cifra de la última semana`,
        'es la que se busca primero y es la única que el raleo no puede saltar');
      ok(ult.anchor === 'end',
        `${v.rango} semanas · «${s.nombre}» la ancla por el final, y no se derrama`,
        `ancla con «${ult.anchor}»: con «start» «$22.1M · 57%» se recortaba a «$22.1»`);
    }
    // Ninguna cifra arranca a la derecha del último punto, que es el borde del
    // lienzo: el ancla del final es lo que lo garantiza.
    const borde = Math.max(...v.puntos.map(p => p.cx));
    const derramadas = v.puntos
      .filter(p => p.rotulo !== null && p.lx >= borde && p.anchor !== 'end');
    ok(derramadas.length === 0,
      `${v.rango} semanas · ninguna cifra pegada al borde derecho ancla por el principio`,
      derramadas.map(p => `«${p.rotulo}»`).join(', '));
  }

  // ══ §4 · EL LADO LO PIDE LA SERIE, PERO NINGUNO CAE SOBRE EL EJE ═════════
  sec('§4 · el rótulo va del lado que pide la serie, salvo cuando ahí no cabe');

  const arriba = (p) => p.ly < p.cy;
  const sinLado = SERIES12.filter(s => !s.ladoRotulo);
  const conAbajo = SERIES12.filter(s => s.ladoRotulo === 'abajo');
  ok(conAbajo.length > 0 && sinLado.length > 0,
    `canario: hay series de los dos lados (${conAbajo.length} abajo, ${sinLado.length} arriba)`);

  // Las dos ventanas, porque el lado del rótulo no es una propiedad de la serie
  // sino del sitio donde cae su curva: en la ventana larga el gasto arranca
  // pegado al suelo y en la corta ya va alto. Las dos se dibujan.
  for (const v of [V12, V26]) {
    const suelo = sueloDel(v.html);
    for (const s of v.props.series.filter(x => !x.ladoRotulo)) {
      const malas = deLaSerie(v.puntos, s).filter(p => p.rotulo !== null && !arriba(p));
      ok(malas.length === 0,
        `${v.rango} semanas · «${s.nombre}» rotula por encima de su línea`,
        `${malas.length} cifras por debajo`);
    }
    const caidas = v.puntos.filter(p => p.rotulo !== null && p.ly > suelo - 2);
    ok(caidas.length === 0,
      `${v.rango} semanas · ninguna cifra cae sobre el eje (suelo del lienzo en y=${suelo})`,
      caidas.map(p => `«${p.rotulo}» en y=${p.ly}`).join(', '));
  }

  // ── LAS DOS MITADES DEL LADO, MEDIDAS SOBRE EL PANEL Y NO SOBRE EL GASTO ──
  //
  // «Abajo salvo cuando ahí no cabe» tiene dos mitades, y la segunda —la cifra
  // que se sube porque entre su curva y el eje ya no cabe— sólo se ve si la
  // curva pasa por esa franja. Tomarla prestada del gasto de la obra parecía lo
  // natural y es un error de calendario: GP detalla por semana SÓLO el año en
  // curso, así que de enero a marzo la ventana larga cae casi entera en un año
  // cerrado, el gasto sale en cero o sin dato, los ceros no se rotulan, y la
  // comprobación se queda sin nada que mirar justo en el trimestre en que la
  // pantalla sí se usa. Eso lo cazó el barrido de fechas con el reloj en
  // 2027-02-15, y es el fixture el que no representaba a GP, no el producto.
  //
  // Elegir el lado es conducta de `PanelSemanal`, no de la curva de la obra, y
  // aquí se le pide directo con un escenario cuya geometría no depende del
  // calendario: un techo que fija el eje y una serie que pide `abajo` y pasa
  // por las dos zonas —tres semanas con holgura y tres pegadas al suelo— en un
  // mismo dibujo. El umbral no se copia: lo que se afirma es que las de arriba
  // de la franja rotulan abajo, las de la franja se suben, y NINGUNA cruza el
  // suelo. Dónde está la franja lo decide el panel.
  const SEM_LADO = ['01', '02', '03', '04', '05', '06'].map(n => ({
    key: `2026-W${n}`, sem: +n, año: 2026, label: `S${+n}`, fecha: `0${+n}/01` }));
  const HOLGADAS = [5_000_000, 4_000_000, 3_000_000];
  const PEGADAS = [150_000, 100_000, 60_000];
  const htmlLado = pintar({
    semanas: SEM_LADO, ejeAbajo: true, altura: V12.props.altura,
    fmt: fmtDineroCorto,
    series: [
      { clave: 'techo', nombre: 'Techo del eje', color: '#111111', rotulada: true,
        valores: SEM_LADO.map(() => 10_000_000) },
      { clave: 'pide', nombre: 'La que pide abajo', color: '#2E86C1', rotulada: true,
        ladoRotulo: 'abajo', valores: [...HOLGADAS, ...PEGADAS] },
    ],
  });
  if (/SE CAYO AL PINTARSE/.test(htmlLado)) muere(`escenario del lado: ${htmlLado}`);
  const sueloLado = sueloDel(htmlLado);
  const ptsLado = puntosDel(htmlLado).filter(p => p.color === '#2E86C1');
  ok(ptsLado.length === 6 && ptsLado.every(p => p.rotulo !== null),
    `canario: la serie que pide abajo dibuja y rotula sus 6 semanas`,
    `${ptsLado.length} puntos, ${ptsLado.filter(p => p.rotulo === null).length} sin cifra`);

  const holgadas = ptsLado.slice(0, 3), pegadas = ptsLado.slice(3);
  ok(holgadas.every(p => !arriba(p)),
    'con holgura, la serie que pide abajo rotula por debajo de su línea',
    'si sale encima choca con las cifras de las series de arriba, que es de lo ' +
    `que el lado protege · ${holgadas.map(p => `«${p.rotulo}» cy=${p.cy} ly=${p.ly}`).join(', ')}`);
  ok(pegadas.every(p => arriba(p)),
    'pegada al suelo, donde abajo no cabe, la cifra se sube',
    'una cifra que no se sube se lee como parte del eje de semanas · ' +
    pegadas.map(p => `«${p.rotulo}» cy=${p.cy} ly=${p.ly}`).join(', '));
  const cruzan = ptsLado.filter(p => p.ly > sueloLado - 2);
  ok(cruzan.length === 0,
    `y ninguna de las seis cruza el suelo del lienzo (y=${sueloLado})`,
    cruzan.map(p => `«${p.rotulo}» en y=${p.ly}`).join(', '));

  // Y QUE ESTO NO SEA UN ESCENARIO DE LABORATORIO: la serie que de verdad pide
  // el lado en la pantalla de la constructora es el gasto, con su nombre.
  ok(conAbajo.some(s => s.clave === 'gasto'),
    `en la tarjeta de verdad la que pide abajo es «${(conAbajo[0] || {}).nombre || '(ninguna)'}»`,
    'si ninguna serie real pide el lado, lo de arriba mide una conducta que ' +
    'la pantalla no usa');

  // ══ §5 · UN CERO NO SE ROTULA ════════════════════════════════════════════
  sec('§5 · un cero no se rotula: «$0» en doce semanas es ruido, no información');

  const P26 = V26.puntos;
  const SERIES26 = V26.props.series;

  let ceros = 0, cerosRotulados = [];
  for (const s of SERIES26) {
    const pts = deLaSerie(P26, s);
    const idx = conDato(s);
    pts.forEach((p, k) => {
      if (s.valores[idx[k]] !== 0) return;
      ceros++;
      if (p.rotulo !== null) cerosRotulados.push(`${s.clave}: «${p.rotulo}»`);
    });
  }
  ok(ceros > 0, `canario: la ventana de 26 trae ${ceros} semanas en cero`,
    'sin un cero en el dibujo esta sección no comprueba nada');
  ok(cerosRotulados.length === 0, 'y ninguno lleva cifra impresa',
    cerosRotulados.join(', '));

  // ══ §6 · NI APRETADO NI MUDO, Y LA FRONTERA DEL MARGEN ═══════════════════
  sec('§6 · en 26 semanas la cifra se ralea, en 4 no — y la dependencia no ve gasto');

  const sinCero = (s, pts) => {
    const idx = conDato(s);
    return pts.filter((p, k) => s.valores[idx[k]] !== 0);
  };
  // Se juzga a las series DENSAS: las que traen cifra en las 26 semanas. Para
  // una serie rala —dos o tres semanas con dato en toda la ventana— que lleven
  // todas su cifra no es apretujón, es que caben; y si lleva o no todas depende
  // de cómo caiga la paridad del raleo sobre esas pocas semanas, así que
  // juzgarla enseña a ignorar un rojo que no significa nada. Pasa de verdad: en
  // enero el gasto sólo tiene las semanas del año de calendario en curso. Lo
  // cazó el barrido con el reloj en 2027-01-11.
  const densas = SERIES26.filter(s =>
    sinCero(s, deLaSerie(P26, s)).length === V26.semanas.length);
  ok(densas.length > 0,
    `canario: ${densas.length} serie(s) con cifra en las 26 semanas, que es a quien el raleo tiene que apretar`,
    'sin una serie densa esta comprobación se cumple sola');
  const apretadas = densas.filter(s =>
    deLaSerie(P26, s).every(p => p.rotulo !== null));
  ok(apretadas.length === 0,
    'en 26 semanas ninguna serie escribe las 26 cifras: el raleo existe',
    `escriben todas: ${apretadas.map(s => s.nombre).join(', ')}`);

  // Y EL RALEO LO PONE CADA SERIE CON SU PROPIO ANCHO, no una constante
  // compartida. «$22.1M · 57%» ocupa el doble que «$3.0M», así que con un paso
  // único la serie de rótulo largo es justo la que se encima — y es la del
  // ejecutado, la única que publica el porcentaje del contrato. Se lee del
  // dibujo: el largo del texto que de verdad salió y cada cuántas semanas
  // salió. Nada de esto reconstruye la cuenta del panel.
  const raleo = SERIES26.map(s => {
    const pts = deLaSerie(P26, s);
    const idx = conDato(s);
    const rot = pts.map((p, k) => ({ i: idx[k], r: p.rotulo })).filter(x => x.r !== null);
    return { nombre: s.nombre,
      largo: Math.max(0, ...rot.map(x => x.r.length)),
      paso: rot.length > 1 ? Math.min(...rot.slice(1).map((x, j) => x.i - rot[j].i)) : null };
  }).filter(x => x.paso !== null);
  ok(raleo.length >= 2, `canario: ${raleo.length} series con cifras raleadas que comparar`);
  ok(new Set(raleo.map(x => x.paso)).size > 1,
    'y cada serie ralea con su propio paso: ' +
    raleo.map(x => `${x.nombre} ${x.largo} car/${x.paso} sem`).join(' · '),
    'todas con el mismo paso significa que el ancho se mide con una constante, ' +
    'y entonces la de rótulo largo se encima mientras la corta desperdicia sitio');
  const porLargo = [...raleo].sort((a, b) => a.largo - b.largo);
  const alReves = porLargo.filter((x, i) => i > 0 && porLargo[i - 1].paso > x.paso);
  ok(alReves.length === 0,
    'y el que escribe más largo escribe menos seguido, no al contrario',
    alReves.map(x => `${x.nombre} (${x.largo} car) ralea menos que otra más corta`).join(', '));

  const mudas = V4.props.series.filter(s => {
    const pts = sinCero(s, deLaSerie(V4.puntos, s));
    return pts.some(p => p.rotulo === null);
  });
  ok(mudas.length === 0,
    'y en 4 semanas se escriben todas: el raleo no se cobra cuando hay sitio',
    `callan cifras: ${mudas.map(s => s.nombre).join(', ')}`);

  // ── LA FRONTERA DEL MARGEN, DEL LADO DE LA DEPENDENCIA ───────────────────
  //
  // El municipio no lee la economía del contratista, ni en forma de etiqueta.
  // Se mide sobre LA MISMA OBRA, cuyo gasto y margen existen y están a mano: si
  // el escenario de dependencia no tuviera gasto que filtrar, no se comprobaría
  // nada.
  const VG = deGobierno(12);
  const HTMLG = pintar(VG.props);
  if (/SE CAYO AL PINTARSE/.test(HTMLG)) muere(HTMLG);
  const PG = puntosDel(HTMLG);

  ok(VG.props.series.length >= 2,
    `canario: la tarjeta de dependencia dibuja ${VG.props.series.length} líneas`);
  const prohibidas = VG.props.series.filter(s => s.clave === 'gasto' || s.clave === 'margen');
  ok(prohibidas.length === 0, 'ninguna línea de la dependencia es el gasto ni el margen',
    prohibidas.map(s => s.clave).join(', '));

  // Cada cifra del dibujo de dependencia es de una de SUS series: una que no lo
  // fuera sería una cifra que viene de otro sitio.
  const propias = new Set();
  for (const s of VG.props.series) {
    conDato(s).forEach(i => propias.add(rotuloDe(s, VG.props, s.valores[i])));
  }
  const intrusas = PG.filter(p => p.rotulo !== null && !propias.has(p.rotulo));
  ok(intrusas.length === 0,
    `las ${PG.filter(p => p.rotulo).length} cifras del dibujo de dependencia son de sus series`,
    intrusas.map(p => `«${p.rotulo}»`).join(', '));

  // Y el dibujo no NOMBRA el gasto ni el margen en ningún sitio: la leyenda es
  // parte del dibujo y un rótulo de leyenda también es una afirmación.
  const dicho = texto(HTMLG).toLowerCase();
  const palabras = ['gasto', 'margen'].filter(w => dicho.includes(w));
  ok(palabras.length === 0,
    'y no nombra «gasto» ni «margen» por ninguna parte del dibujo',
    `dijo: ${palabras.join(', ')}`);

  // EL CANARIO DE LA FRONTERA: del lado constructora el gasto SÍ se dibuja. La
  // frontera recorta, no es que el dato no exista.
  //
  // Se mide que la serie esté dibujada —con su punto por semana— y no que
  // imprima cifras, porque el gasto puede ser legítimamente cero en toda la
  // ventana: GP detalla por semana sólo el año de calendario en curso y en los
  // primeros días de enero la semana corriente aún pertenece al año ISO
  // anterior. El cero se dibuja y no se rotula, y eso está bien. Que las cifras
  // del gasto, cuando las hay, sean las suyas, lo afirma §2 sobre cada serie.
  const gasto12 = SERIES12.find(s => s.clave === 'gasto');
  ok(!!gasto12 && deLaSerie(P12, gasto12).length === conDato(gasto12).length
     && deLaSerie(P12, gasto12).length > 0,
    'canario: del lado constructora el gasto sí se dibuja, semana por semana',
    `${gasto12 ? deLaSerie(P12, gasto12).length : '(no es ni serie)'} puntos`);
  ok(texto(HTML12).toLowerCase().includes('gasto'),
    'y ahí sí se nombra: la frontera recorta, no es que el dato no exista');
  ok(!VG.props.series.some(s => /gasto|margen/.test(s.clave)),
    'mientras la dependencia no lo trae ni como serie apagada');

  // Y aunque se le entregue la economía del contratista, no la dibuja: el
  // aislamiento no depende de que el sitio de llamada se acuerde de no pasarla.
  const HTMLG_CON_GP = pintar(deGobierno(12, { gpData: GP, maquinaria: [],
    otrosGastos: [] }).props);
  ok(HTMLG_CON_GP === HTMLG,
    'pasándole el GP del contratista, la dependencia dibuja exactamente lo mismo',
    'el aislamiento no puede descansar en que el sitio de llamada no lo pase');

  return fallos;
}

// ── LAS MUTACIONES ─────────────────────────────────────────────────────────
//
// Cada una es un defecto plausible que deja la pantalla compilando y con
// aspecto razonable: una gráfica con sus líneas, sus puntos y sus números,
// afirmando algo falso. NINGUNA toca los dos títulos por los que el banco
// encuentra las tarjetas ni el nombre del panel: una mutación que rompe el
// ancla sale 2 y no demuestra nada.
const MUTACIONES = [
  // §1 · el punto vuelve a ser sólo de la serie que rotula.
  ['los puntos sólo se dibujan donde hay cifra, y la curva deja de decir cuántas semanas la sostienen',
    `                <circle cx={x} cy={y} r={2.5} fill={s.color} stroke="white" strokeWidth={1}/>`,
    `                {escribe && <circle cx={x} cy={y} r={2.5} fill={s.color} stroke="white" strokeWidth={1}/>}`],

  // §2 · el formato del eje se come el del ejecutado: el porcentaje del
  // contrato desaparece y el monto sigue ahí, así que nada se ve roto.
  ['el rótulo del panel pisa el de la serie y el ejecutado pierde el porcentaje del contrato',
    `                  {(s.fmt || fmt)(v)}`,
    `                  {fmt(v)}`],

  // §2 · la cifra de la semana de al lado. Es el defecto más difícil de ver a
  // ojo: todas las cifras existen, todas son plausibles, y cada una está en el
  // punto equivocado.
  ['la cifra se corre una semana y cada punto publica el valor del siguiente',
    `              const v = s.valores[i];
              if (v === null || v === undefined) return null;
              const x = xPos(i), y = yPos(v);`,
    `              const v = s.valores[i + 1] ?? s.valores[i];
              if (v === null || v === undefined) return null;
              const x = xPos(i), y = yPos(s.valores[i]);`],

  // §3 · el raleo cuenta desde la primera semana, y entonces la cifra de esta
  // semana se salta la mitad de las veces.
  ['el raleo cuenta desde la primera semana y deja la actual sin cifra',
    `              const escribe = s.rotulada && v !== 0
                && (semanas.length - 1 - i) % paso === 0;`,
    `              const escribe = s.rotulada && v !== 0
                && i % paso === 0;`],

  // §3 · el ancla del final se cae y el último rótulo se derrama por la derecha.
  ['la última cifra ancla por el principio y se derrama fuera del lienzo',
    `              let anchor = "middle";
              if (i === semanas.length - 1) anchor = "end";
              else if (rotar || i === 0) anchor = "start";`,
    `              let anchor = "middle";
              if (rotar || i === 0) anchor = "start";`],

  // §4 · la excepción del suelo se cae y la cifra del gasto se lee como parte
  // del eje de semanas.
  ['el rótulo de abajo deja de subirse cuando no cabe y cae sobre el eje de semanas',
    `              const abajo = s.ladoRotulo === 'abajo' && y + 13 <= PT + ch - 2;`,
    `              const abajo = s.ladoRotulo === 'abajo';`],

  // §4 · el lado que pide la serie se ignora y todo se rotula encima.
  ['el lado del rótulo se ignora y el gasto escribe encima de su línea, contra el ejecutado',
    `              const yLabel = abajo ? y + 13 : y - 8;`,
    `              const yLabel = y - 8;`],

  // §5 · el cero se rotula y doce «$0» tapan la gráfica.
  ['el cero se rotula y las semanas sin gasto publican «$0» con cara de medido',
    `              const escribe = s.rotulada && v !== 0`,
    `              const escribe = s.rotulada`],

  // §6 · el raleo se desactiva y 26 semanas por tres series se enciman.
  ['el raleo se desactiva y las tres series escriben las 26 semanas encimadas',
    `    const ocupa = (rotar ? ancho * 0.87 : ancho) + 6;`,
    `    const ocupa = 1;`],

  // §6 · el raleo se cobra incluso cuando hay sitio, y una ventana de 4 semanas
  // sale con la mitad de las cifras.
  ['el raleo se cobra aunque haya sitio y la ventana corta sale a medias',
    `    return Math.max(1, Math.ceil(ocupa / sep));`,
    `    return Math.max(2, Math.ceil(ocupa / sep));`],

  // §6 · el ancho se mide con una constante en vez de con lo que la serie de
  // verdad escribe, así que la de rótulo largo —la única con monto Y
  // porcentaje— es justo la que se encima.
  ['el ancho del rótulo se mide con una constante y la serie de rótulo largo se encima',
    `    const ancho = Math.max(1, ...semanas.map((m, i) => {
      const v = s.valores[i];
      return (v === null || v === undefined || v === 0) ? 0 : anchoTexto(f(v));
    }));`,
    `    const ancho = anchoTexto('$0.0M');`],

  // §6 · la frontera del margen: la tarjeta de la dependencia recibe la serie
  // del gasto del contratista. Compila, se ve bien, y publica en el tablero del
  // municipio una cifra que no le toca.
  ['la tarjeta de la dependencia dibuja además el gasto del contratista',
    `          <PanelSemanal
            semanas={semanas}
            ejeAbajo={true}
            altura={200}
            fmt={fmtDineroCorto}
            series={g.lineas}
            areas={g.areas}
            ausentes={g.ausentes}
            pie={g.notas.join(' · ')}/>

          <TablaSemanas semanas={semanas} columnas={[
            {titulo:'Avance', valores:g.avance, fmt:(v)=>\`\${NUM(v,1)}%\`,
             vacio:'sin medir'},
            {titulo:'Δ semana', valores:avanceDelta, fmt:pp, color:colorDelta,
             vacio:'—'},
            {titulo:'Programa',
             valores:g.programadoPct, fmt:(v)=>\`\${NUM(v,1)}%\`, vacio:'sin dato'},
            {titulo:'Contra el programa', valores:desviacion, fmt:pp,
             color:colorDelta, vacio:'sin dato'},
            {titulo:'Ejecutado', valores:g.ejecutado, fmt:MXN, vacio:'no disponible'},
            {titulo:'Programado $', valores:g.programado, fmt:MXN, vacio:'sin dato'},
            {titulo:'Pagado', valores:g.pagado, fmt:MXN,`,
    `          <PanelSemanal
            semanas={semanas}
            ejeAbajo={true}
            altura={200}
            fmt={fmtDineroCorto}
            series={[...g.lineas, {clave:'gasto', nombre:'Gasto acumulado',
              color:'#C0392B', rotulada:true, ladoRotulo:'abajo',
              fmt:fmtDineroCorto,
              valores:g.ejecutado.map(v => v === null ? null : v * 0.78)}]}
            areas={g.areas}
            ausentes={g.ausentes}
            pie={g.notas.join(' · ')}/>

          <TablaSemanas semanas={semanas} columnas={[
            {titulo:'Avance', valores:g.avance, fmt:(v)=>\`\${NUM(v,1)}%\`,
             vacio:'sin medir'},
            {titulo:'Δ semana', valores:avanceDelta, fmt:pp, color:colorDelta,
             vacio:'—'},
            {titulo:'Programa',
             valores:g.programadoPct, fmt:(v)=>\`\${NUM(v,1)}%\`, vacio:'sin dato'},
            {titulo:'Contra el programa', valores:desviacion, fmt:pp,
             color:colorDelta, vacio:'sin dato'},
            {titulo:'Ejecutado', valores:g.ejecutado, fmt:MXN, vacio:'no disponible'},
            {titulo:'Programado $', valores:g.programado, fmt:MXN, vacio:'sin dato'},
            {titulo:'Pagado', valores:g.pagado, fmt:MXN,`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuatro-series-'));
  let i = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    const veces = src.split(de).length - 1;
    if (veces !== 1) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» halló su anclaje ${veces} veces`);
      console.error(`  buscaba: ${de.slice(0, 200)}`);
      process.exit(2);
    }
    const f = path.join(dir, `app-${i++}.jsx`);
    // El reemplazo va en una función, no como cadena: `$'`, `` $` ``, `$&` son
    // patrones de `String.replace` y el texto de estas mutaciones los contiene
    // de verdad —`{titulo:'Programado $', …}` trae `$'`—, así que pasarlo como
    // cadena le empalma a App.jsx un pedazo de sí mismo y el archivo deja de
    // compilar: la mutación saldría en «NO ARRANCÓ» sin haber medido nada.
    fs.writeFileSync(f, src.replace(de, () => a));
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f, CALLADO: '1' }, encoding: 'utf8' });
    if (r.status === 2) {
      console.error(`NO ARRANCÓ: «${titulo}» revienta el banco en vez de romper la semántica`);
      console.error([r.stdout, r.stderr].join('\n').split('\n')
        .filter(l => /NO ARRANCÓ|excepción|^  /.test(l)).slice(0, 8).join('\n'));
      process.exit(2);
    }
    const caidas = Number((r.stderr.match(/ROJO: (\d+) aserción/) || [])[1]) || 0;
    if (r.status === 0) {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      process.exit(1);
    }
    console.log(`   ✓ ROJO  ${titulo}  ·  ${caidas || '≥1'} aserción(es) mordieron`);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.\n`);
  process.exit(0);
}

if (!callado) console.log('CADA CIFRA DE LA GRÁFICA ES LA DE SU SERIE Y LA DE SU SEMANA');
const fallos = correr();
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
if (!callado) console.log('\nverde');
process.exit(0);
