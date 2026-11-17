#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL EXPEDIENTE PIDE EL DATO QUE AFIRMA — PENDIENTES #3 (residual)
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ DEFECTO CIERRA, Y NO ES EL QUE DECÍA EL RENGLÓN. El renglón del #3 decía
// que el encabezado de Evidencia «afirma 0 semanas cerradas MIENTRAS CARGA».
// Medido: para los roles `cliente` y `contratista` el historial no se pide
// NUNCA. La condición de carga diferida nombraba dos pestañas —`dash` y
// `operacion/avance`— escritas antes de que la galería usara el riel, y ninguno
// de esos dos roles tiene ninguna de las dos. Así que «0 semanas cerradas» no
// era un parpadeo de medio segundo: era permanente, en la única pantalla que se
// le enseña al cliente, sobre una obra con cierres de verdad.
//
// Y EL ARREGLO OBVIO ERA FALSO. Lo primero que se hizo fue meter
// `fotos_cliente` en la lista que pide el dato. El preview lo desmintió: como
// `contratista`, el encabezado seguía diciendo «0 semanas cerradas» de una obra
// con cuatro cierres. Medido entonces sobre REST con idToken de verdad
// (2026-11-16, emulador): `obras/OP-2026-001/avance/historial` devuelve
//
//     contratista     → 403 PERMISSION_DENIED
//     director_obras  → 200 OK
//
// Las reglas niegan ese documento a `esContratista()` y a `esCliente()` a
// propósito, y resulta que ésos son exactamente los dos únicos roles cuyo menú
// lleva `fotos_cliente`. Pedirlo ahí es pedir un rebote en cada apertura de
// obra; y `fsGet`, con su `catch` pelado, convertía el rebote en `null` y la
// pantalla el `null` en un cero. Mismo cero, otra causa.
//
// LAS CUATRO RAZONES DE UN CERO. Una lista vacía significa «no hay», «no se
// pudo leer», «nadie preguntó todavía» o —la cuarta, que este banco añadió— «a
// este rol no se le enseña ese dato, por diseño». Las cuatro se imprimían «0».
//
// QUÉ AFIRMA, Y CÓMO. No afirma que exista ningún símbolo. Saca de `src/App.jsx`
// los sitios que montan `<FotosCliente`, les lee su guarda de pestaña POR EL
// JSX, EJECUTA el efecto de carga diferida con dobles, EJECUTA las dos frases
// del encabezado sobre los cuatro estados y RENDERIZA la galería para afirmar
// sobre el HTML.
//
// LAS CINCO AFIRMACIONES:
//
//   §1. Todo sitio que monta la galería, o está en la lista que pide el riel, o
//       declara el riel NO VISIBLE. Es la mitad silenciosa: montar la galería
//       en una pestaña nueva sin decidir nada no rompe nada, sólo vuelve a
//       mentir el encabezado.
//   §2. El efecto de carga, ejecutado: pide el dato donde las reglas lo
//       permiten, NO lo pide en la pestaña donde lo niegan, y una lectura
//       negada queda en «no se pudo», no en «leído».
//   §3. El encabezado distingue los cuatro estados: sin leer no publica ningún
//       cero, no se pudo lo dice, no visible CALLA, y un cero MEDIDO sí se dice.
//   §4. La frase del expediente vacío, los mismos cuatro.
//   §5. La galería renderizada: con el riel sin pedir no sale «0 semanas
//       cerradas»; con el riel no visible no sale ni el cero ni una promesa de
//       lectura que no va a venir, y las fotos se siguen viendo.
//
// Uso:
//     node scripts/prueba-el-expediente-pide-su-riel.cjs
//     node scripts/prueba-el-expediente-pide-su-riel.cjs --contraprueba
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
const astDe = (txt, tipo = 'module') =>
  parse(txt, { sourceType: tipo, plugins: ['jsx'] });

const muere = (...lineas) => {
  console.error(`\nNO ARRANCÓ: ${lineas[0]}`);
  for (const l of lineas.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

// ── LAS CUENTAS VIVAS, POR LA PUERTA ÚNICA ─────────────────────────────────
const PEDIDOS = ['TABS_QUE_PIDEN_EL_RIEL', 'encabezadoDelExpediente',
  'fraseExpedienteVacio', 'frasePanelSinCierre',
  'EVID_LEYENDO', 'EVID_LEIDA', 'EVID_NO_SE_PUDO',
  'HIST_SIN_LEER', 'HIST_LEIDO', 'HIST_NO_SE_PUDO', 'HIST_NO_VISIBLE'];
{
  const { faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
  if (faltan.length) noArranco(faltan, path.basename(archivo));
}
const APP = (() => {
  const { cuerpo } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
  return new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
})();
const { TABS_QUE_PIDEN_EL_RIEL, encabezadoDelExpediente, fraseExpedienteVacio,
  frasePanelSinCierre, EVID_LEYENDO, EVID_LEIDA, EVID_NO_SE_PUDO,
  HIST_SIN_LEER, HIST_LEIDO, HIST_NO_SE_PUDO, HIST_NO_VISIBLE } = APP;

// Los cuatro estados tienen que ser cuatro valores distintos. Si dos colapsan
// —un copiar y pegar basta—, todas las aserciones de abajo siguen pasando
// mientras la pantalla ya no distingue dos hechos. Eso no es rojo: es que el
// banco dejó de medir, y entonces no arranca.
{
  const estados = [HIST_SIN_LEER, HIST_LEIDO, HIST_NO_SE_PUDO, HIST_NO_VISIBLE];
  if (new Set(estados).size !== 4)
    muere(`los cuatro estados del riel no son cuatro valores distintos: ${estados.join(', ')}`,
      'Con dos colapsados este banco mediría dos estados creyendo medir cuatro.');
}

// ── LOS SITIOS QUE MONTAN LA GALERÍA, SACADOS DEL JSX ──────────────────────
//
// Se llega a ellos por el `<FotosCliente` y se le lee la guarda de pestaña a la
// cadena de `&&` que lo envuelve. No se busca el texto `tab==="x"` con una
// expresión regular: una regular encuentra también las guardas de las otras
// treinta pestañas, y lo que hay que medir es la de ESTE montaje. Del propio
// elemento se lee además qué le pasa como `historialEstado`, que es la otra
// mitad de la decisión.
const guardasDeMontaje = (texto) => {
  const sitios = [];
  traverse(astDe(texto), {
    JSXOpeningElement(p) {
      if (p.node.name?.name !== 'FotosCliente') return;

      // Qué declara este montaje sobre el riel: el nombre de la constante que
      // le pasa, o null si le pasa una variable o no le pasa nada.
      let declara = null;
      for (const a of p.node.attributes || []) {
        if (a.type !== 'JSXAttribute' || a.name?.name !== 'historialEstado') continue;
        const e = a.value?.type === 'JSXExpressionContainer' ? a.value.expression : null;
        declara = e?.type === 'Identifier' ? e.name : '(expresión)';
      }

      // La cadena `screen==="obra" && tab==="evidencia" && obra && <Galería/>`
      // es un árbol de `&&` anidado a la izquierda. Se sube al más alto y se
      // recogen TODAS las comparaciones contra `tab`.
      let log = p.findParent(q => q.isLogicalExpression());
      const linea = p.node.loc.start.line;
      if (!log) { sitios.push({ linea, tabs: [], declara }); return; }
      while (log.parentPath?.isLogicalExpression()) log = log.parentPath;
      const tabs = [];
      const recorrer = (n) => {
        if (!n) return;
        if (n.type === 'LogicalExpression') { recorrer(n.left); recorrer(n.right); return; }
        if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '==')) {
          const lados = [n.left, n.right];
          const id = lados.find(l => l.type === 'Identifier' && l.name === 'tab');
          const lit = lados.find(l => l.type === 'StringLiteral');
          if (id && lit) tabs.push(lit.value);
        }
      };
      recorrer(log.node);
      sitios.push({ linea, tabs, declara });
    },
  });
  return sitios;
};

const MONTAJES = guardasDeMontaje(src);
if (!MONTAJES.length)
  muere('no se halló ni un sitio que monte `<FotosCliente` en ' + path.basename(archivo),
    'Si la galería se renombró, lo que hay que arreglar es este anclaje.',
    'Cero montajes en verde sería una prueba que no mira nada.');

// ── EL EFECTO DE CARGA DIFERIDA, SACADO Y EJECUTADO ────────────────────────
//
// Es lo que dejaba al cliente sin historial, y después lo que se arregló mal.
// No se extrae sólo la condición: se extrae el efecto ENTERO, porque la mitad
// nueva del arreglo no está en la condición sino en qué se hace con una lectura
// que las reglas negaron. Se le pasa un `fsGetConEstado` de mentira y se mira
// qué estado deja.
// Se le llega por las DOS cosas que sólo él tiene juntas: lee
// `avance/historial` —que casa también con otras tres lecturas del archivo— y
// mueve el estado del riel. El ancla NO puede ser la lista de pestañas ni el
// nombre de la función lectora: quitar una y cambiar la otra son dos de las
// mutaciones, y una mutación que descoloca el ancla sale 2 sin medir nada.
let FUENTE_EFECTO = null;
{
  const hallados = [];
  traverse(astDe(src), {
    CallExpression(p) {
      if (p.node.callee?.name !== 'useEffect') return;
      const cb = p.node.arguments?.[0];
      if (!cb) return;
      const txt = src.slice(cb.start, cb.end);
      if (txt.includes('avance/historial') && txt.includes('setHistorialEstado'))
        hallados.push(txt);
    },
  });
  if (hallados.length !== 1)
    muere(`el efecto que lee el historial casó ${hallados.length} veces`,
      'Se busca el `useEffect` que lea `avance/historial` y mueva el estado del riel.',
      'Si la lectura se movió a otra parte, lo que hay que arreglar es este anclaje.');
  FUENTE_EFECTO = hallados[0];
}

// QUÉ NECESITA EL EFECTO. Como con la galería, la lista NO se teclea: se
// calcula de la propia fuente. Un nombre libre para el que no haya doble es NO
// ARRANCÓ, porque ejecutar el efecto con un `undefined` silencioso mediría otro
// efecto.
const DEL_LENGUAJE = new Set(['Boolean', 'Map', 'Math', 'Set', 'String', 'Number',
  'Object', 'Array', 'JSON', 'Date', 'undefined', 'NaN', 'Infinity', 'console',
  'Promise']);

const libresDe = (fuente) => {
  let libres = [];
  traverse(astDe(fuente, 'script'), { Program(p) { libres = Object.keys(p.scope.globals); } });
  return libres.filter(n => !DEL_LENGUAJE.has(n));
};

// Corre el efecto una vez y devuelve lo que pasó: qué rutas se leyeron y con
// qué estado quedó el riel.
const correrEfecto = ({ tab, subTabOper = '', obraId = '0199',
                        historialEstado = HIST_SIN_LEER, lectura }) => {
  const visto = { rutas: [], estado: null, semanas: null, recorte: undefined,
                  notas: undefined };
  const resultado = lectura || { ok: true, datos: { semanas: [{ semana: 44 }], recorte: null } };

  const MESA = {
    obraId, tab, subTabOper, historialEstado,
    TABS_QUE_PIDEN_EL_RIEL, HIST_SIN_LEER, HIST_LEIDO, HIST_NO_SE_PUDO,
    HIST_NO_VISIBLE,
    // El doble fiel: devuelve `{ok, datos}` y registra la ruta.
    fsGetConEstado: (ruta) => { visto.rutas.push(ruta); return Promise.resolve(resultado); },
    // El de antes, con su `catch` pelado emulado: una negación sale `null`.
    // Está en la mesa para que volver a usarlo sea posible y se vea romperse.
    fsGet: (ruta) => {
      visto.rutas.push(ruta);
      return Promise.resolve(resultado.ok ? resultado.datos : null);
    },
    setHistorialAvance: (v) => { visto.semanas = v; },
    setRecorteHistorial: (v) => { visto.recorte = v; },
    setHistorialEstado: (v) => { visto.estado = v; },
    setNotasSemana: (v) => { visto.notas = v; },
  };

  const libres = libresDe(FUENTE_EFECTO);
  const faltan = libres.filter(n => !(n in MESA));
  if (faltan.length)
    muere(`el efecto de carga usa ${faltan.length} nombre(s) sin doble: ${faltan.join(', ')}`,
      'Ejecutarlo con undefined silenciosos mediría otro efecto, así que no se ejecuta.');

  const nombres = libres;
  const valores = nombres.map(n => MESA[n]);
  let fn;
  try {
    fn = new Function(...nombres, `"use strict"; return (${FUENTE_EFECTO});`)(...valores);
  } catch (e) {
    muere(`el efecto de carga no se pudo compilar: ${e.message}`);
  }
  try { fn(); } catch (e) { visto.excepcion = e.message; }
  return visto;
};

// Las promesas del efecto se resuelven en microtareas; todo lo que mide §2 se
// mira después de drenarlas.
const drenar = () => new Promise(r => setImmediate(r));

// ── LA GALERÍA, SACADA DEL ARCHIVO Y PINTADA ───────────────────────────────
//
// Se busca por LO QUE PINTA —el título del panel— y no por su nombre: el día
// que alguien renombre el componente, esta prueba tiene que seguir mirando la
// misma tarjeta.
const ANCLA_GALERIA = 'La obra, semana por semana</Tit>';
let FUENTE_GALERIA = null;
{
  const hallados = [];
  traverse(astDe(src), {
    FunctionDeclaration(p) {
      const txt = src.slice(p.node.start, p.node.end);
      if (txt.includes(ANCLA_GALERIA) && !p.node.async) hallados.push(txt);
    },
  });
  if (hallados.length !== 1)
    muere(`la galería casó ${hallados.length} veces en ${path.basename(archivo)}`,
      `se buscaba el título pintado: ${ANCLA_GALERIA}`,
      'Si la tarjeta se reescribió, lo que hay que arreglar es el ancla.');
  FUENTE_GALERIA = hallados[0];
}

const DOBLES = {
  // Los dobles dejan rastro legible para poder afirmar sobre él.
  Card: ({ accent, children }) => React.createElement('div', { 'data-acento': accent || '' }, children),
  Tit: ({ children }) => React.createElement('div', { 'data-titulo': '' }, children),
  Bdg: ({ color, children }) => React.createElement('span', { 'data-insignia': color || '' }, children),
  Kpi: ({ label, value, sub }) => React.createElement('div', { 'data-kpi': String(label || '') },
    `${value == null ? '' : value} ${sub || ''}`),
  SelloEvidencia: ({ children }) => React.createElement('span', { 'data-sello': '' }, children),
  React,
  useState: (ini) => [ini, () => {}],
  useMemo: (fn) => fn(),
  useRef: (v) => ({ current: v }),
  useEffect: () => {},
};

const LIBRES = libresDe(FUENTE_GALERIA);
const DEL_MODULO = LIBRES.filter(n => !(n in DOBLES)).sort();
{
  const { cuerpo, faltan } = fuenteDe(archivo, DEL_MODULO, { tolerante: true });
  if (faltan.length)
    muere(`la galería usa ${faltan.length} nombre(s) que no se pudieron resolver: ${faltan.join(', ')}`,
      'Ni el extractor los encuentra en el archivo ni hay un doble para ellos.',
      'Pintar la galería sin ellos mediría otra pantalla, así que no se pinta.');
  var CUERPO_MODULO = cuerpo;
}

const compilar = (fuente) => esbuild.transformSync(`(${fuente})`, { loader: 'jsx' }).code;
const GALERIA = (() => {
  const nombres = Object.keys(DOBLES);
  const valores = Object.values(DOBLES);
  return new Function(...nombres,
    `"use strict";\n${CUERPO_MODULO}\nreturn ${compilar(FUENTE_GALERIA)}`)(...valores);
})();

const pintar = (props) => {
  try {
    return renderToStaticMarkup(React.createElement(GALERIA, props));
  } catch (e) {
    return `LA GALERIA SE CAYO AL PINTARSE: ${e.message}`;
  }
};

const texto = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const dice = (html, frase) => texto(html).toUpperCase().includes(frase.toUpperCase());
const SALE_UN_CERO = /\b0 semanas? cerradas?/i;

// ── EL ESCENARIO: UNA OBRA CON CIERRES DE VERDAD ───────────────────────────
//
// Dos cierres comparables y dos fotos. Lo que hace que el escenario signifique
// algo es que la obra SÍ tiene semanas cerradas: así, «0 semanas cerradas» no
// es una lectura optimista, es una afirmación falsa.
const OBRA = { id: '0199', clave: '0199', nombre: 'Obra del banco',
  presupuesto: 100e6, inicio: '2026-10-05', fin: '2027-06-30' };
const cierre = (semana, avance, monto) => ({
  tipo: 'oficial', semana, año: 2026, esquema: 2,
  avancePonderado: avance, montoEjecutado: monto,
  fechaCierre: '2026-11-09', capturadoPor: 'El residente',
});
const HISTORIAL = [cierre(44, 0.30, 30e6), cierre(45, 0.42, 42e6)];
const foto = (id, partidaId, sec, fecha) => ({
  id, partidaId, sec, sub: 'Tubería', url: `https://x/${id}.jpg`,
  fechaServidor: fecha, origen: 'en_vivo',
});
const EVIDENCIA = [foto('f1', 'p1', 'A-01', '2026-11-09'),
  foto('f2', 'p1', 'A-01', '2026-11-09')];

// Las cinco combinaciones que importan. `sinPedir` es el medio segundo normal;
// `noVisible` es el montaje del cliente, al que las reglas le niegan el riel.
const PROPS_BASE = { obra: OBRA, evidencia: EVIDENCIA, notasSemana: {},
  recorteHistorial: null };
const TODO_LEIDO = { ...PROPS_BASE, evidenciaEstado: EVID_LEIDA,
  historialAvance: HISTORIAL, historialEstado: HIST_LEIDO };
const SIN_PEDIR = { ...PROPS_BASE, evidenciaEstado: EVID_LEIDA,
  historialAvance: [], historialEstado: HIST_SIN_LEER };
const LEYENDO = { ...PROPS_BASE, evidenciaEstado: EVID_LEYENDO,
  historialAvance: [], historialEstado: HIST_SIN_LEER };
const NO_SE_PUDO_RIEL = { ...PROPS_BASE, evidenciaEstado: EVID_LEIDA,
  historialAvance: [], historialEstado: HIST_NO_SE_PUDO };
const NO_SE_PUDO = { ...PROPS_BASE, evidenciaEstado: EVID_NO_SE_PUDO,
  historialAvance: [], historialEstado: HIST_LEIDO };
const NO_VISIBLE = { ...PROPS_BASE, evidenciaEstado: EVID_LEIDA,
  historialAvance: [], historialEstado: HIST_NO_VISIBLE };

async function correr() {
  const fallos = [];
  const callado = !!process.env.CALLADO;
  const ok = (cond, que, detalle = '') => {
    if (cond) { if (!callado) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`);
  };
  const sec = (t) => { if (!callado) console.log(`\n${t}`); };

  // ══ §1 · CADA MONTAJE DECIDE, Y LO DICE ══════════════════════════════════
  sec('§1 · cada sitio que monta la galería o pide el riel o lo declara no visible');

  ok(MONTAJES.length >= 2,
    `la galería se monta en ${MONTAJES.length} sitios del archivo`,
    'con un solo montaje esta sección no comprueba el defecto, que era tener dos');

  const sinGuarda = MONTAJES.filter(m => m.tabs.length === 0);
  ok(sinGuarda.length === 0,
    'cada montaje se puede leer de qué pestaña cuelga',
    `sin guarda legible: líneas ${sinGuarda.map(m => m.linea).join(', ')}`);

  // La afirmación central. Un montaje tiene DOS salidas honestas, y callar no
  // es ninguna de las dos.
  const calladas = MONTAJES.filter(m =>
    !m.tabs.some(t => TABS_QUE_PIDEN_EL_RIEL.includes(t))
    && m.declara !== 'HIST_NO_VISIBLE');
  ok(calladas.length === 0,
    `los ${MONTAJES.length} montajes deciden qué hacen con el riel`,
    `callan: líneas ${calladas.map(m => `${m.linea} (${m.tabs.join('/') || 'sin pestaña'} → ${m.declara || 'nada'})`).join(', ')}` +
    ' — ese montaje enseña el riel sobre un historial que nadie pidió, ' +
    'y el encabezado publica «0 semanas cerradas»');

  // Y las dos salidas son excluyentes: un montaje que pide el dato no puede
  // además declarar que su rol no lo ve, ni al revés.
  const contradictorias = MONTAJES.filter(m =>
    m.tabs.some(t => TABS_QUE_PIDEN_EL_RIEL.includes(t)) && m.declara === 'HIST_NO_VISIBLE');
  ok(contradictorias.length === 0,
    'y ningún montaje pide el riel y a la vez lo declara no visible',
    `líneas ${contradictorias.map(m => m.linea).join(', ')}`);

  const montadas = [...new Set(MONTAJES.flatMap(m => m.tabs))].sort();
  const deSobra = TABS_QUE_PIDEN_EL_RIEL.filter(t => !montadas.includes(t));
  ok(deSobra.length === 0,
    'la lista no pide el historial para pestañas que no lo enseñan',
    `de sobra: ${deSobra.join(' · ')} — leería Firestore para nadie`);

  // LO QUE LAS REGLAS NIEGAN NO SE PIDE. Medido sobre REST el 2026-11-16:
  // `avance/historial` sale 403 a `contratista` y a `cliente`, los dos únicos
  // roles con `fotos_cliente`. Esta aserción es la que el preview enseñó.
  ok(!TABS_QUE_PIDEN_EL_RIEL.includes('fotos_cliente'),
    'la pestaña del cliente NO pide el historial: las reglas se lo niegan',
    'medido: contratista → 403 PERMISSION_DENIED, director_obras → 200 OK. ' +
    'Pedirlo ahí es un rebote garantizado en cada apertura de obra');

  const delCliente = MONTAJES.filter(m => m.tabs.includes('fotos_cliente'));
  ok(delCliente.length === 1 && delCliente[0].declara === 'HIST_NO_VISIBLE',
    'y ese montaje declara el riel NO VISIBLE en vez de callar',
    `halló ${delCliente.length} montaje(s), declara: ${delCliente.map(m => m.declara).join(', ')}`);

  // ══ §2 · EL EFECTO DE CARGA, EJECUTADO ═══════════════════════════════════
  sec('§2 · el efecto de carga, ejecutado con dobles');

  for (const t of TABS_QUE_PIDEN_EL_RIEL) {
    const r = correrEfecto({ tab: t });
    await drenar();
    ok(r.rutas.some(x => x.includes('avance/historial')),
      `en «${t}» la app sí lee el historial de la obra`,
      'era el defecto: el riel se pintaba sobre un arreglo que nunca se llenaba');
  }

  const rDash = correrEfecto({ tab: 'dash' });
  await drenar();
  ok(rDash.rutas.some(x => x.includes('avance/historial')),
    'y sigue leyéndolo en el tablero, que ya lo pedía');

  const rGastos = correrEfecto({ tab: 'gastos' });
  await drenar();
  ok(rGastos.rutas.length === 0,
    'y NO lo lee en una pestaña que no lo enseña: la carga sigue siendo diferida',
    `leyó: ${rGastos.rutas.join(', ')}`);

  // LA AFIRMACIÓN QUE CAMBIÓ EL ARREGLO. La pestaña del cliente no pide nada.
  const rCliente = correrEfecto({ tab: 'fotos_cliente' });
  await drenar();
  ok(rCliente.rutas.length === 0,
    'en la pestaña del cliente el efecto no pide NADA',
    `leyó: ${rCliente.rutas.join(', ')} — las reglas niegan esas rutas a ese rol, ` +
    'así que pedirlas es un 403 por obra abierta y un cero en pantalla');

  // UNA LECTURA NEGADA NO ES UNA LECTURA. Es la otra mitad de la reparación:
  // donde sí se pide, un rebote tiene que dejar el riel en «no se pudo».
  const rNegado = correrEfecto({ tab: TABS_QUE_PIDEN_EL_RIEL[0],
    lectura: { ok: false, datos: null, error: 'permission-denied' } });
  await drenar();
  ok(rNegado.estado === HIST_NO_SE_PUDO,
    'una lectura que las reglas negaron deja el riel en «no se pudo leer»',
    `quedó en «${rNegado.estado}» — si queda en «leído», el cero vuelve a pasar por contado`);
  ok(!rNegado.excepcion, 'y el efecto no revienta al recibir una negación',
    String(rNegado.excepcion));

  const rOk = correrEfecto({ tab: TABS_QUE_PIDEN_EL_RIEL[0] });
  await drenar();
  ok(rOk.estado === HIST_LEIDO,
    'y una lectura que sí llegó deja el riel en «leído»',
    `quedó en «${rOk.estado}»`);
  ok(Array.isArray(rOk.semanas) && rOk.semanas.length === 1,
    'con las semanas que vinieron en el documento',
    `semanas: ${JSON.stringify(rOk.semanas)}`);

  // Y no se relee en bucle: el efecto corre en cada cambio de pestaña.
  const rYaLeido = correrEfecto({ tab: TABS_QUE_PIDEN_EL_RIEL[0],
    historialEstado: HIST_LEIDO });
  await drenar();
  ok(rYaLeido.rutas.length === 0,
    'con el historial ya leído no se vuelve a pedir',
    `leyó otra vez: ${rYaLeido.rutas.join(', ')}`);

  // ══ §3 · EL ENCABEZADO DISTINGUE LAS CUATRO RAZONES DE UN CERO ═══════════
  sec('§3 · el encabezado: las cuatro razones de una lista vacía se dicen distinto');

  const enc = (p) => encabezadoDelExpediente(p);

  // SIN PEDIR. Es el caso del defecto original.
  const hSinPedir = enc({ cerradas: 0, historialEstado: HIST_SIN_LEER, fotos: 2,
    partidas: 1, origen: 'en vivo', evidenciaEstado: EVID_LEIDA });
  ok(!/\d+\s*semanas?\s*cerradas?/i.test(hSinPedir),
    `sin historial leído el encabezado no publica ningún cero: «${hSinPedir}»`,
    'un «0 semanas cerradas» sobre una obra con dos cierres es una cifra falsa');
  ok(/sin leer/i.test(hSinPedir),
    'y dice que no se ha leído, con esas palabras');

  // NO SE PUDO. La negación de las reglas, dicha.
  const hNoSePudo = enc({ cerradas: 0, historialEstado: HIST_NO_SE_PUDO, fotos: 2,
    partidas: 1, origen: 'en vivo', evidenciaEstado: EVID_LEIDA });
  ok(!/\d+\s*semanas?\s*cerradas?/i.test(hNoSePudo) && /no se pudieron leer/i.test(hNoSePudo),
    `si el riel no se pudo leer lo dice, sin publicar un cero: «${hNoSePudo}»`);

  // NO VISIBLE. El estado nuevo, y el único cuya conducta correcta es CALLAR.
  const hNoVisible = enc({ cerradas: 0, historialEstado: HIST_NO_VISIBLE, fotos: 2,
    partidas: 1, origen: 'en vivo', evidenciaEstado: EVID_LEIDA });
  ok(!/semanas?\s*cerradas?/i.test(hNoVisible),
    `al rol que no ve cierres el encabezado no le habla de cierres: «${hNoVisible}»`,
    'ni un cero, ni «sin leer» —que sería prometerle una lectura que no va a venir—, ' +
    'ni «no se pudo» —que sería acusar de una falla a una regla deliberada—');
  ok(/2 fotos en 1 partida/i.test(hNoVisible),
    'y sí le dice lo que sí tiene: las fotos');

  // UN CERO MEDIDO SÍ SE DICE. La otra mitad: callar el cero que sí se midió
  // sería el defecto simétrico, y es la trampa de arreglar esto con un `if`
  // sobre el número en vez de sobre su procedencia.
  const hCeroReal = enc({ cerradas: 0, historialEstado: HIST_LEIDO, fotos: 0,
    partidas: 0, evidenciaEstado: EVID_LEIDA });
  ok(/0 semanas cerradas/i.test(hCeroReal),
    `un cero MEDIDO sí se publica: «${hCeroReal}»`,
    'si esto calla, la obra sin cierres pasa a verse igual que la que no se leyó');

  const hLeido = enc({ cerradas: 2, historialEstado: HIST_LEIDO, fotos: 2, partidas: 1,
    origen: 'en vivo', semanasConCargas: 1, evidenciaEstado: EVID_LEIDA });
  ok(/2 semanas cerradas/i.test(hLeido),
    `y las dos cerradas se publican cuando se leyeron: «${hLeido}»`);
  ok(/1 semana cerrada\b/i.test(enc({ cerradas: 1, historialEstado: HIST_LEIDO,
    evidenciaEstado: EVID_LEIDA })),
    'una sola se dice en singular: la pantalla no dice «1 semanas»');

  // LA EVIDENCIA, SUS TRES ESTADOS. Las fotos ya tenían el estado triple; lo
  // que se comprueba es que el encabezado lo use y no lo aplane.
  const hFotosLeyendo = enc({ cerradas: 2, historialEstado: HIST_LEIDO,
    fotos: 0, partidas: 0, evidenciaEstado: EVID_LEYENDO });
  ok(!/\d+\s*fotos?\b/i.test(hFotosLeyendo),
    `leyendo las fotos no publica una cuenta de fotos: «${hFotosLeyendo}»`);
  const hFotosFalla = enc({ cerradas: 2, historialEstado: HIST_LEIDO,
    fotos: 0, partidas: 0, evidenciaEstado: EVID_NO_SE_PUDO });
  ok(!/\d+\s*fotos?\b/i.test(hFotosFalla) && /no se pudieron leer/i.test(hFotosFalla),
    `y si falló lo dice, en vez de publicar un cero: «${hFotosFalla}»`);
  ok(/2 fotos en 1 partida\b/i.test(hLeido),
    'y con la evidencia leída publica las dos cuentas, en singular y plural');

  // ══ §4 · LA FRASE DEL EXPEDIENTE VACÍO ═══════════════════════════════════
  sec('§4 · el expediente vacío: cuatro razones, cuatro frases');

  const fSinPedir = fraseExpedienteVacio({ historialEstado: HIST_SIN_LEER,
    evidenciaEstado: EVID_LEIDA });
  ok(/no se leen|sin leer/i.test(fSinPedir) && !/no hay cierres/i.test(fSinPedir),
    `sin historial leído no afirma que no haya cierres: «${fSinPedir}»`);

  const fNoSePudoRiel = fraseExpedienteVacio({ historialEstado: HIST_NO_SE_PUDO,
    evidenciaEstado: EVID_LEIDA });
  ok(/no se pudieron leer/i.test(fNoSePudoRiel) && !/no hay cierres/i.test(fNoSePudoRiel),
    `si el riel no se pudo leer lo dice y no afirma el vacío: «${fNoSePudoRiel}»`);

  const fNoVisible = fraseExpedienteVacio({ historialEstado: HIST_NO_VISIBLE,
    evidenciaEstado: EVID_LEIDA });
  ok(!/cierre/i.test(fNoVisible) && /no hay fotos/i.test(fNoVisible),
    `al rol que no ve cierres la frase sólo habla de fotos: «${fNoVisible}»`,
    'mencionar los cierres —para bien o para mal— es hablar de un dato que no tiene');

  const fLeyendo = fraseExpedienteVacio({ historialEstado: HIST_SIN_LEER,
    evidenciaEstado: EVID_LEYENDO });
  ok(/leyendo/i.test(fLeyendo) && !/no se pudo/i.test(fLeyendo),
    `leyendo dice que está leyendo, y no acusa una falla: «${fLeyendo}»`);

  const fFalla = fraseExpedienteVacio({ historialEstado: HIST_LEIDO,
    evidenciaEstado: EVID_NO_SE_PUDO });
  ok(/no se pudo leer/i.test(fFalla) && !/no hay fotos\b/i.test(fFalla),
    `si falló la evidencia lo dice y no afirma que no haya fotos: «${fFalla}»`);

  const fVacio = fraseExpedienteVacio({ historialEstado: HIST_LEIDO,
    evidenciaEstado: EVID_LEIDA });
  ok(/no hay/i.test(fVacio),
    `y el vacío MEDIDO sí se afirma: «${fVacio}»`,
    'la obra de verdad vacía tiene que poder decirse vacía');

  // LA MISMA AFIRMACIÓN, UNA CAPA MÁS ABAJO. El encabezado ya callaba el cero,
  // y el panel de la semana seguía diciendo «Esta semana no se cerró» —que es
  // la misma afirmación repartida en quince renglones—. Lo vio el preview: con
  // el encabezado ya arreglado, el panel del contratista seguía mintiendo.
  const SEMANA = { clave: 'S46-2026', semana: 46, año: 2026, cierre: null,
    fotos: 3, nota: null };
  const pLeido = frasePanelSinCierre(SEMANA, HIST_LEIDO);
  ok(/no se cerró/i.test(pLeido) && /3 fotos/.test(pLeido),
    `con el riel leído el panel sí afirma que la semana no se cerró: «${pLeido}»`);

  const pNoVisible = frasePanelSinCierre(SEMANA, HIST_NO_VISIBLE);
  ok(!/no se cerró/i.test(pNoVisible),
    `al rol que no ve cierres el panel no le dice que la semana no se cerró: «${pNoVisible}»`,
    'es el «0 semanas cerradas» otra vez, repartido semana por semana');
  ok(/3 fotos/.test(pNoVisible),
    'pero sí le dice lo que consta: las fotos de esa semana');

  const pSinLeer = frasePanelSinCierre(SEMANA, HIST_SIN_LEER);
  ok(!/no se cerró/i.test(pSinLeer) && /(todavía|aún)/i.test(pSinLeer),
    `sin haber leído el riel tampoco lo afirma: «${pSinLeer}»`);
  ok(frasePanelSinCierre(SEMANA) === pSinLeer,
    'y el valor por omisión del panel es el pesimista, como el de la galería');

  ok(frasePanelSinCierre({ ...SEMANA, cierre: { semana: 46 } }, HIST_LEIDO) === null,
    'una semana que SÍ se cerró no recibe ninguna de estas frases');

  // ══ §5 · LA GALERÍA PINTADA ══════════════════════════════════════════════
  sec('§5 · la galería renderizada no publica el cero que no midió');

  const htmlLeido = pintar(TODO_LEIDO);
  ok(!/SE CAYO AL PINTARSE/.test(htmlLeido), 'la galería se pinta',
    htmlLeido.slice(0, 200));
  ok(dice(htmlLeido, '2 semanas cerradas'),
    'con todo leído publica las 2 semanas cerradas de la obra');

  const htmlSinPedir = pintar(SIN_PEDIR);
  ok(!/SE CAYO AL PINTARSE/.test(htmlSinPedir), 'y se pinta sin historial',
    htmlSinPedir.slice(0, 200));
  ok(!SALE_UN_CERO.test(texto(htmlSinPedir)),
    'sin historial pedido no sale «0 semanas cerradas» por ningún lado',
    `salió: ${texto(htmlSinPedir).slice(0, 220)}`);
  ok(dice(htmlSinPedir, 'sin leer'),
    'y en su lugar la pantalla dice que no se ha leído');

  const htmlNoSePudoRiel = pintar(NO_SE_PUDO_RIEL);
  ok(!SALE_UN_CERO.test(texto(htmlNoSePudoRiel))
    && dice(htmlNoSePudoRiel, 'no se pudieron leer'),
    'con el riel negado la pantalla lo dice en vez de publicar un cero',
    `salió: ${texto(htmlNoSePudoRiel).slice(0, 220)}`);

  // EL MONTAJE DEL CLIENTE, PINTADO. Es la pantalla de la demo: ni un cero
  // falso, ni una promesa de carga, y las fotos sí se ven.
  const htmlNoVisible = pintar(NO_VISIBLE);
  ok(!/SE CAYO AL PINTARSE/.test(htmlNoVisible), 'la galería del cliente se pinta',
    htmlNoVisible.slice(0, 200));
  ok(!SALE_UN_CERO.test(texto(htmlNoVisible)),
    'al cliente no se le publica «0 semanas cerradas» de una obra con cierres',
    `salió: ${texto(htmlNoVisible).slice(0, 220)}`);
  ok(!dice(htmlNoVisible, 'semanas cerradas: aún sin leer'),
    'ni se le promete una lectura que las reglas no le van a dar',
    `salió: ${texto(htmlNoVisible).slice(0, 220)}`);
  ok(!dice(htmlNoVisible, 'las semanas cerradas no se pudieron leer'),
    'ni se le acusa de una falla a una regla deliberada');
  ok(dice(htmlNoVisible, '2 fotos en 1 partida'),
    'y sus fotos se siguen viendo: callar el riel no apaga la galería');

  const htmlLeyendo = pintar(LEYENDO);
  ok(!/SE CAYO AL PINTARSE/.test(htmlLeyendo), 'y se pinta mientras carga',
    htmlLeyendo.slice(0, 200));
  ok(!dice(htmlLeyendo, 'No se pudo leer la evidencia'),
    'mientras carga NO acusa una falla de lectura',
    'el aviso amarillo salía durante el medio segundo normal de toda carga');

  const htmlFalla = pintar(NO_SE_PUDO);
  ok(dice(htmlFalla, 'No se pudo leer la evidencia'),
    'pero cuando la lectura falló de verdad, el aviso sí sale');
  ok(!dice(htmlFalla, 'Aún no hay cierres ni fotos'),
    'y entonces no afirma que la obra no tenga nada');

  // LOS VALORES POR OMISIÓN, EJERCIDOS. Todo lo de arriba le pasa los dos
  // estados a mano, así que ninguna de esas aserciones mira las omisiones —y la
  // galería se monta desde dos sitios que podrían dejar de pasarlas. Montarla
  // SIN ellas es el tercer montaje posible, y tiene que caer del lado
  // pesimista: un defecto por olvidar un parámetro se ve; una mentira, no.
  const htmlPelado = pintar({ obra: OBRA, evidencia: EVIDENCIA, notasSemana: {} });
  ok(!/SE CAYO AL PINTARSE/.test(htmlPelado), 'la galería se pinta sin que le digan qué se leyó',
    htmlPelado.slice(0, 200));
  ok(!SALE_UN_CERO.test(texto(htmlPelado)),
    'y sin que le digan qué se leyó NO afirma un cero: las omisiones son pesimistas',
    `salió: ${texto(htmlPelado).slice(0, 220)}`);
  ok(dice(htmlPelado, 'sin leer') && !dice(htmlPelado, 'No se pudo leer la evidencia'),
    'dice «sin leer», y tampoco acusa una falla que nadie midió');

  return fallos;
}

// ── LAS MUTACIONES ─────────────────────────────────────────────────────────
// Cada una vuelve a poner un defecto que esta rama cerró, dejando la pantalla
// compilando. Ninguna toca el título «La obra, semana por semana», que es por
// donde el banco encuentra la galería: romper el ancla sale 2 y no mide nada.
const MUTACIONES = [
  // LA MUTACIÓN QUE JUSTIFICA LA RAMA. Es el estado anterior exacto: la lista
  // de pestañas de la carga diferida no incluye la de la galería.
  ['la carga diferida vuelve a olvidar las pestañas de la galería',
    `    const necesario = (tab === "dash") || (tab === "operacion" && subTabOper === "avance")
      || TABS_QUE_PIDEN_EL_RIEL.includes(tab);`,
    `    const necesario = (tab === "dash") || (tab === "operacion" && subTabOper === "avance");`],

  // EL ARREGLO QUE EL PREVIEW DESMINTIÓ. La pestaña del cliente vuelve a pedir
  // el documento que las reglas le niegan. Compila, se ve razonable, y es un
  // 403 por obra abierta: §1 y §2 tienen que morder.
  ['la pestaña del cliente vuelve a pedir el documento que las reglas le niegan',
    `const TABS_QUE_PIDEN_EL_RIEL = ['evidencia'];`,
    `const TABS_QUE_PIDEN_EL_RIEL = ['evidencia', 'fotos_cliente'];`],

  // La mitad silenciosa: el montaje del cliente deja de declarar nada. No pide
  // el dato y tampoco dice que no lo ve, así que vuelve a pintar el cero.
  ['el montaje del cliente deja de declarar el riel y vuelve a callar',
    `historialAvance={[]} historialEstado={HIST_NO_VISIBLE} notasSemana={notasSemana} recorteHistorial={null}/>}`,
    `historialAvance={historialAvance} notasSemana={notasSemana} recorteHistorial={null}/>}`],

  // Y la simétrica: la lista pide el dato para una pestaña que no lo enseña.
  ['la lista pide el historial para una pestaña que no enseña el riel',
    `const TABS_QUE_PIDEN_EL_RIEL = ['evidencia'];`,
    `const TABS_QUE_PIDEN_EL_RIEL = ['evidencia', 'gastos'];`],

  // UNA NEGACIÓN VUELVE A CONTAR COMO LECTURA. Es el defecto que `fsGet`
  // cometía con su `catch` pelado, escrito a mano.
  ['una lectura negada vuelve a contar como leída',
    `        setHistorialEstado(r.ok ? HIST_LEIDO : HIST_NO_SE_PUDO);`,
    `        setHistorialEstado(HIST_LEIDO);`],

  // El encabezado vuelve a publicar el cero que no midió.
  ['el encabezado vuelve a imprimir «0 semanas cerradas» sin haber leído nada',
    `  if (historialEstado === HIST_LEIDO) {
    partes.push(\`\${cerradas} semana\${cerradas === 1 ? '' : 's'} cerrada\${cerradas === 1 ? '' : 's'}\`);
  } else if (historialEstado === HIST_NO_SE_PUDO) {`,
    `  if (true) {
    partes.push(\`\${cerradas} semana\${cerradas === 1 ? '' : 's'} cerrada\${cerradas === 1 ? '' : 's'}\`);
  } else if (historialEstado === HIST_NO_SE_PUDO) {`],

  // El defecto simétrico: se calla también el cero que SÍ se midió. Es cómo se
  // "arregla" esto mirando el número en vez de su procedencia.
  ['el arreglo mira el número y calla también el cero que sí se midió',
    `  if (historialEstado === HIST_LEIDO) {`,
    `  if (historialEstado === HIST_LEIDO && cerradas > 0) {`],

  // EL CUARTO ESTADO SE APLANA AL TERCERO. Al rol que no ve cierres se le
  // vuelve a prometer una lectura que las reglas no le van a dar.
  ['al rol que no ve cierres se le vuelve a prometer la lectura',
    `  } else if (historialEstado !== HIST_NO_VISIBLE) {
    partes.push('semanas cerradas: aún sin leer');
  }`,
    `  } else {
    partes.push('semanas cerradas: aún sin leer');
  }`],

  // LA CAPA DE ABAJO. El panel de la semana vuelve a afirmar sobre el cierre
  // desde la ausencia del dato: el encabezado calla y el panel miente, que es
  // exactamente lo que el preview encontró.
  ['el panel de la semana vuelve a afirmar «no se cerró» sin haber leído el riel',
    `  if (historialEstado !== HIST_LEIDO) {`,
    `  if (false) {`],

  // Y la frase del vacío hace lo mismo: le habla de cierres a quien no los ve.
  ['la frase del vacío le habla de cierres al rol que no los ve',
    `    : historialEstado === HIST_NO_VISIBLE ? null`,
    `    : historialEstado === HIST_NO_VISIBLE ? 'no hay cierres'`],

  // Los tres estados de la evidencia se aplanan a dos y «cargando» vuelve a
  // ser «falló»: el aviso amarillo acusa durante la carga normal.
  ['«cargando» y «falló» vuelven a ser el mismo estado y el aviso acusa cargando',
    `      {evidenciaEstado === EVID_NO_SE_PUDO && (`,
    `      {evidenciaEstado !== EVID_LEIDA && (`],

  // El cero de fotos vuelve a imprimirse sin haberlas leído.
  ['la cuenta de fotos se publica aunque la evidencia no se haya leído',
    `  if (evidenciaEstado === EVID_LEIDA) {
    partes.push(\`\${fotos} foto\${fotos === 1 ? '' : 's'} en \``,
    `  if (true) {
    partes.push(\`\${fotos} foto\${fotos === 1 ? '' : 's'} en \``],

  // Los valores por omisión dejan de ser pesimistas: quien monte la galería sin
  // decirle qué se leyó vuelve a obtener una afirmación en cero.
  ['los valores por omisión de la galería vuelven a ser optimistas',
    `function FotosCliente({obra, evidencia = [], evidenciaEstado = EVID_LEYENDO,
                       historialAvance = [], historialEstado = HIST_SIN_LEER,`,
    `function FotosCliente({obra, evidencia = [], evidenciaEstado = EVID_LEIDA,
                       historialAvance = [], historialEstado = HIST_LEIDO,`],
];

(async () => {
  if (process.argv.includes('--contraprueba')) {
    console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expediente-riel-'));
    let i = 0;
    for (const [titulo, de, a] of MUTACIONES) {
      if (!src.includes(de)) {
        console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
        console.error(`  buscaba: ${de.slice(0, 200)}`);
        process.exit(2);
      }
      const f = path.join(dir, `app-${i++}.jsx`);
      fs.writeFileSync(f, src.replace(de, a));
      const r = spawnSync(process.execPath, [__filename],
        { env: { ...process.env, ARCHIVO_APP: f, CALLADO: '1' }, encoding: 'utf8' });
      if (r.status === 2) {
        console.error(`NO ARRANCÓ: «${titulo}» revienta el banco en vez de romper la semántica`);
        console.error([r.stdout, r.stderr].join('\n').split('\n')
          .filter(l => /NO ARRANCÓ|excepción/.test(l)).join('\n'));
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

  console.log('EL EXPEDIENTE PIDE EL DATO QUE AFIRMA');
  const fallos = await correr();
  if (fallos.length) {
    console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nverde');
  process.exit(0);
})();
