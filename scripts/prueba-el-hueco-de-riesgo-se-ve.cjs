#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL RIESGO QUE NO SE PUDO MEDIR SE VE EN PANTALLA — PENDIENTES #127 (A.6)
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ DEFECTO CIERRA. El motor separa cuatro estados desde el #120 y el
// documento interno los publica desde el #123. El tablero pintaba UNO. Una
// regla que se calló porque le faltó el dato salía igual que una que midió y no
// encontró nada: no salía. La pantalla decía «5 indicadores de riesgo» y quien
// la leía entendía que de los otros 27 no había nada que decir.
//
// Y EL CASO PEOR ERA EL ÚNICO INVISIBLE. La guarda del tablero era
// `riesgos.length > 0`. Una obra con cero disparos y veintidós reglas sin dato
// no enseñaba tarjeta ninguna — ni vacía: ausente. El sitio donde tenía que
// decir «no sé» era el único sitio en blanco.
//
// NO ES TEORÍA. Medido en producción el 2026-11-10 con
// `medir-los-riesgos-que-nadie-pudo-evaluar.cjs` (sólo lectura), las SIETE
// obras vivas callaban más de lo que enseñaban: 76 reglas sin dato contra 29
// detectadas. El malecón enseñaba 5 y se guardaba 9. La 0131 enseñaba 4 y se
// guardaba 16. Del lado de la dependencia, las siete también.
//
// QUÉ AFIRMA ESTE BANCO, Y CÓMO. No afirma que exista ningún símbolo. Saca de
// `src/App.jsx` el panel y el banner buscándolos por LO QUE DICEN EN PANTALLA,
// los compila, los RENDERIZA con el veredicto que devuelve el motor de verdad,
// y afirma sobre el HTML que sale. La guarda del tablero se saca del propio
// `<BannerRiesgos/>` —resolviendo la variable por su enlace de ámbito, no por
// su nombre— y se EJECUTA contra los tres veredictos.
//
// LAS SIETE AFIRMACIONES:
//
//   §1. El hueco se agrupa POR DATO, no por regla, y el orden lo encabeza el
//       dato que tumba más reglas. Lo que se va a capturar es el dato.
//   §2. La pantalla NOMBRA el dato que falta —todos, no una muestra— y lo dice
//       como HUECO, no como cero: lleva el verbo «falta capturar» y no afirma
//       en ningún sitio que el dato no exista.
//   §3. Con CERO riesgos detectados y huecos, la tarjeta se pinta igual. La
//       guarda del tablero lo permite.
//   §4. Un hueco NO lleva severidad. No se midió: ponerle color de semáforo
//       inventaría un juicio que nadie hizo, y el verde no se pinta encima.
//   §5. Lo que REVENTÓ va aparte y en rojo, no revuelto con los huecos de
//       captura — y sin nombrarnos ante el cliente.
//   §6. CERO CUENTAS, no dos: la nota NO publica ningún número de reglas ni de
//       grupos. Las dos cuentas del mismo hecho pueden discrepar, y «reglas»
//       no es una palabra del cliente. El detalle vive en los dos PDF.
//   §7. La dependencia ve SU hueco, y la frontera aguanta: ni nómina, ni
//       almacén, ni el gasto del contratista se nombran de ese lado.
//
// QUÉ CAMBIÓ EL 2026-11-16 Y QUÉ NO. El panel se reescribió como NOTA: fuera el
// encabezado «LO QUE NO SE PUDO MEDIR», la insignia de «N reglas sin dato», el
// desplegable, el párrafo de «una lista vacía no significa que no haya riesgo»
// y la palabra «cotea» en la confesión del defecto. La afirmación NO se movió,
// y §2 es ahora más estricto que antes: no sólo comprueba que el dato se nombre,
// comprueba que la pantalla **no diga «no hay»** de ningún dato. Ése era el
// riesgo real del acortamiento y es el que queda clavado.
//
// Uso:
//     node scripts/prueba-el-hueco-de-riesgo-se-ve.cjs
//     node scripts/prueba-el-hueco-de-riesgo-se-ve.cjs --contraprueba
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

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
// Por la puerta única, con cierre transitivo. `evaluarRiesgos` arrastra la
// biblioteca entera y `DATOS_DEL_RIESGO`; `huecosPorDato` es la cuenta nueva.
const PEDIDOS = ['evaluarRiesgos', 'huecosPorDato', 'SEVERIDADES', 'C',
  'BIBLIOTECA_RIESGOS', 'RIESGOS_SOLO_CONSTRUCTORA'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan, path.basename(archivo));
const APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
const { evaluarRiesgos, huecosPorDato, SEVERIDADES, C } = APP;

// ── LOS DOS BLOQUES DE PANTALLA, SACADOS DEL ARCHIVO ───────────────────────
// Se buscan por lo que PUBLICAN, no por su nombre: el día que alguien renombre
// el componente, la prueba tiene que seguir mirando esta misma tarjeta. Si el
// ancla se rompe es un «no arrancó», porque lo que hay que arreglar es el ancla
// y no se puede fingir que se midió.
// EL ANCLA LLEVA EL `</span>` A PROPÓSITO. El primer corte buscaba el rótulo a
// secas y «INDICADORES DE RIESGO» también es el encabezado de la sección 6 del
// documento interno, que vive dentro de `generarPDFObra` y aparece MÁS ARRIBA
// en el archivo. El banco agarraba esa función —que es `async`— y renderizaba
// una promesa. Con el cierre de etiqueta, el ancla sólo casa con el rótulo tal
// como se PINTA, que es lo que esta prueba vino a mirar.
const bloquePorTexto = (marca) => {
  const hallados = [];
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    FunctionDeclaration(p) {
      const txt = src.slice(p.node.start, p.node.end);
      if (txt.includes(marca) && !p.node.async) hallados.push(txt);
    },
  });
  return hallados;
};

const unico = (que, marca) => {
  const h = bloquePorTexto(marca);
  if (h.length === 1) return h[0];
  console.error(`\nNO ARRANCÓ: ${que} casó ${h.length} veces en ${path.basename(archivo)}.`);
  console.error(`  se buscaba el rótulo pintado: ${marca}`);
  console.error('Si la tarjeta se reescribió, lo que hay que arreglar es el ancla.');
  process.exit(2);
};

// EL ANCLA DEL PANEL ES «No se pudo calcular», no «Falta capturar». El rótulo
// que encabeza la nota también lo usa el tablero de dependencia para titular su
// tarjeta, así que buscar por él casa dos funciones y el banco no arranca. Este
// otro rótulo lo pinta un solo sitio, y es un sitio del mismo panel.
const FUENTE_PANEL  = unico('la nota de lo que falta capturar', 'No se pudo calcular</div>');
const FUENTE_BANNER = unico('el banner de indicadores de riesgo', 'INDICADORES DE RIESGO</span>');

// LA GUARDA DEL TABLERO, SACADA DEL PROPIO `<BannerRiesgos/>`. Es la que dejaba
// la obra sin tarjeta, así que no alcanza con probar el componente: hay que
// probar la condición que decide si se monta. Se llega a ella por el JSX —no
// por el nombre de la variable— y se resuelve el enlace en su ámbito.
let FUENTE_GUARDA = null;
{
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    JSXOpeningElement(p) {
      if (FUENTE_GUARDA) return;
      if (p.node.name?.name !== 'BannerRiesgos') return;
      const log = p.findParent(q => q.isLogicalExpression());
      if (!log) return;
      const izq = log.node.left;
      if (izq.type === 'Identifier') {
        const enlace = log.scope.getBinding(izq.name);
        const init = enlace?.path?.node?.init;
        if (init) FUENTE_GUARDA = src.slice(init.start, init.end);
      } else {
        FUENTE_GUARDA = src.slice(izq.start, izq.end);
      }
    },
  });
}
if (!FUENTE_GUARDA) {
  console.error('\nNO ARRANCÓ: no se halló la condición que monta el banner de riesgos.');
  console.error('Se busca el `<BannerRiesgos/>` y la expresión lógica que lo envuelve.');
  process.exit(2);
}
// Se ejecuta la condición de verdad, con los dos nombres que el tablero le da
// de comer. Un `ReferenceError` aquí sería andamiaje roto, no semántica: sube.
let montaLaTarjeta;
try {
  montaLaTarjeta = new Function('riesgos', 'veredictoRiesgos',
    `"use strict"; return !!(${FUENTE_GUARDA});`);
  montaLaTarjeta([], { detectados: [], sinHallazgo: [], noEvaluables: [], reventaron: [] });
} catch (e) {
  console.error(`\nNO ARRANCÓ: la guarda del tablero no se pudo ejecutar: ${e.message}`);
  console.error(`  era: ${FUENTE_GUARDA}`);
  process.exit(2);
}

// ── EL RENDER ──────────────────────────────────────────────────────────────
// Los componentes de mentira dejan rastro legible: el acento de la tarjeta sale
// como atributo para poder afirmar sobre él, y las insignias quedan marcadas
// para poder leer QUÉ número publica cada una.
const Card = ({ accent, children }) =>
  React.createElement('div', { 'data-acento': accent || '' }, children);
const Bdg = ({ color, children }) =>
  React.createElement('span', { 'data-insignia': color || '' }, children);

const compilar = (fuente) => esbuild.transformSync(`(${fuente})`, { loader: 'jsx' }).code;

// `abierto` fuerza el estado desplegado sin tocar el componente: `useState` se
// le entrega devuelto ya abierto. Es el único modo de ver la rama de «desplegar»
// con un render estático, y es la rama donde salen los títulos de las reglas.
const armar = (fuente, extras = {}, abierto = false) => {
  const useState = (ini) => [abierto ? true : ini, () => {}];
  const nombres = ['React', 'useState', 'C', 'Card', 'Bdg', 'SEVERIDADES', 'huecosPorDato',
    ...Object.keys(extras)];
  const valores = [React, useState, C, Card, Bdg, SEVERIDADES, huecosPorDato,
    ...Object.values(extras)];
  return new Function(...nombres, `return ${compilar(fuente)}`)(...valores);
};

const pintar = (fuente, props, { abierto = false, extras = {} } = {}) => {
  const Comp = armar(fuente, extras, abierto);
  try {
    return renderToStaticMarkup(React.createElement(Comp, props));
  } catch (e) {
    return `EL PANEL SE CAYO AL PINTARSE: ${e.message}`;
  }
};

const panel  = (props, opts) => pintar(FUENTE_PANEL, props, opts);
const banner = (props, opts) => pintar(FUENTE_BANNER, props,
  { ...opts, extras: { PanelSinDato: armar(FUENTE_PANEL, {}, opts?.abierto) } });

// El texto que de verdad se lee, sin etiquetas. Afirmar sobre el HTML crudo
// deja pasar un rótulo partido en dos `<span>`.
const texto = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const dice = (html, frase) => texto(html).toUpperCase().includes(frase.toUpperCase());
// Lo que publica cada insignia: es ahí donde vive el número del hueco.
const insignias = (html) =>
  [...html.matchAll(/data-insignia="[^"]*">(.*?)<\/span>/g)]
    .map(m => texto(m[1]));

// ── LOS DOS VEREDICTOS, SALIDOS DEL MOTOR ──────────────────────────────────
//
// SANA: la obra que el tablero dejaba en blanco. Contrato con plazo holgado,
// catálogo, una semana cerrada al día — y nada de GP, nómina, almacén ni
// estimaciones. Cero reglas disparan y veintidós se quedan sin dato. Es el
// escenario exacto del defecto: la pantalla no pintaba NADA.
const OBRA_SANA = { id: '0199', nombre: 'Obra sana', clave: '0199',
  presupuesto: 100e6, pctAnticipo: 30, inicio: '2026-01-05', fin: '2027-12-31',
  diasPago: 30, gpId: '0199', contratista: 'X', pctFondoGar: 5,
  residente: 'R', supervisor: 'S' };
const CTX_SANA = {
  obra: OBRA_SANA,
  subs: [{ sec: 'A-01', sub: 'Tubería', imp: 100e6, a: 50 }],
  historialAvance: [{ semana: '2026-W45', avance: 50, tipo: 'oficial', fecha: '2026-11-06' }],
  estimaciones: [], maquinaria: [], materiales: [], subcontratos: [],
  nominaHistorial: [], gpData: null, programa: null,
  kpis: { gt: 0, am: 0, alm: 0, me: 50e6, af: 50, diff: 0, mpct: 50, pctGasto: 0, brecha: 0 },
};

// VACÍO: el contexto sin nada. Es el único que hace REVENTAR detectores de
// verdad (`ctr_001` y `ctr_002` leen de una obra que no está), y no se les pone
// un pañal a propósito: que revienten y que SE DIGA es lo que se comprueba.
// También es el que tiene una regla tumbada por DOS datos, que es lo que hace
// que la suma de los grupos no sea el número de reglas.
const CTX_VACIO = {};

const V_SANA   = evaluarRiesgos(CTX_SANA);
const V_VACIO  = evaluarRiesgos(CTX_VACIO);
const V_DEP    = evaluarRiesgos({ ...CTX_SANA, tipo: 'dependencia' });

function correr() {
  const fallos = [];
  const callado = !!process.env.CALLADO;
  const ok = (cond, que, detalle = '') => {
    if (cond) { if (!callado) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`);
  };
  const sec = (t) => { if (!callado) console.log(`\n${t}`); };

  // ══ §1 · EL HUECO SE AGRUPA POR DATO, NO POR REGLA ═══════════════════════
  sec('§1 · el hueco se agrupa por dato, y lo encabeza el que tumba más reglas');

  const H_SANA = huecosPorDato(V_SANA.noEvaluables);
  const H_VACIO = huecosPorDato(V_VACIO.noEvaluables);

  ok(V_SANA.noEvaluables.length > 0 && V_SANA.detectados.length === 0,
    `el escenario sí ejerce el defecto: 0 reglas disparan y ${V_SANA.noEvaluables.length} se quedan sin dato`,
    'si el escenario no tiene huecos, nada de lo que sigue comprueba algo');

  ok(H_SANA.length > 0 && H_SANA.length < V_SANA.noEvaluables.length,
    `agrupar acorta la lista: ${V_SANA.noEvaluables.length} reglas caben en ${H_SANA.length} datos`,
    'una fila por regla sería más larga que la de los riesgos que sí disparan');

  // Ninguna regla se pierde al agrupar: el hueco que no se nombra es el que
  // nadie va a capturar.
  const reglasAgrupadas = new Set(H_SANA.flatMap(g => g.reglas));
  const titulosSinDato = V_SANA.noEvaluables.map(r => r.titulo || r.id);
  ok(titulosSinDato.every(t => reglasAgrupadas.has(t)),
    'y no se pierde ninguna por el camino: las 22 reglas sin dato están en algún grupo',
    `faltaron: ${titulosSinDato.filter(t => !reglasAgrupadas.has(t)).join(', ')}`);

  const pesos = H_SANA.map(g => g.reglas.length);
  ok(pesos.every((p, i) => i === 0 || pesos[i - 1] >= p),
    `el orden lo encabeza el dato que tumba más reglas: [${pesos.join(' ')}]`);
  ok(pesos[0] > 1,
    `y el primero tumba ${pesos[0]} reglas, no una — por eso se agrupa`);

  // El nombre HUMANO del dato, no su llave. «renglonGP» no le dice nada a quien
  // tiene que ir a capturarlo.
  ok(H_SANA.every(g => g.nombre && g.nombre !== g.dato),
    'cada grupo lleva el nombre humano del dato, no su llave interna',
    H_SANA.filter(g => g.nombre === g.dato).map(g => g.dato).join(', '));

  // El `porQue` cuando el dato sabe decirlo. `serieMargen` lo sabe.
  const conPorQue = H_VACIO.filter(g => g.porQue);
  ok(conPorQue.length > 0,
    `el motivo sube cuando el dato lo tiene: «${(conPorQue[0]?.porQue || '').slice(0, 58)}…»`);

  // ══ §2 · NOMBRA EL DATO, Y LO DICE COMO HUECO, NO COMO CERO ══════════════
  sec('§2 · la pantalla nombra el dato que falta, todos, y no afirma que no exista');

  const htmlSana = panel({ noEvaluables: V_SANA.noEvaluables,
    reventaron: V_SANA.reventaron });
  ok(!/SE CAYO AL PINTARSE/.test(htmlSana), 'el panel se pinta', htmlSana.slice(0, 180));

  const noNombrados = H_SANA.filter(g => !dice(htmlSana, g.nombre));
  ok(noNombrados.length === 0,
    `los ${H_SANA.length} datos que faltan salen nombrados en pantalla, no una muestra`,
    `callados: ${noNombrados.map(g => g.nombre).join(' · ')}`);

  // EL VERBO. Sin él, el lector pone uno de gratis y el que pone es «no hay».
  ok(dice(htmlSana, 'falta capturar'),
    'y la nota dice FALTA CAPTURAR: el hueco lleva verbo, no se deja al lector');

  const htmlVacio = panel({ noEvaluables: V_VACIO.noEvaluables,
    reventaron: V_VACIO.reventaron });

  // ── LA AFIRMACIÓN QUE NO SE PUEDE HACER ───────────────────────────────────
  //
  // Es la aserción por la que esta rama existe. Al acortar el texto, la forma
  // más natural de decirlo es la que el usuario propuso con sus palabras: «no
  // hay movimientos en almacén». Y eso es FALSO en el único caso que le da
  // sentido al panel —la obra que sí tuvo movimientos y nadie los capturó—.
  // Así que no se comprueba que el texto sea corto: se comprueba que, por
  // corto que sea, no afirme el cero. Se mide sobre los DOS escenarios y sobre
  // el renglón del dato, no sobre el panel entero, para que un «no hay» dentro
  // de un mensaje de error de `reventaron` no dé un rojo que no corresponde.
  // La lista negra es corta y deliberada: NINGUNO de estos giros aparece en los
  // nombres de `DATOS_DEL_RIESGO`, así que un rojo aquí sólo puede venir de que
  // alguien escribió la afirmación. Palabras como «cero» NO entran a la lista
  // —«monto ejecutado mayor que cero» es un nombre de dato legítimo— porque una
  // lista negra que muerde al dato en vez de a la afirmación se desactiva sola.
  const CEROS = ['no hay', 'no existe', 'no tiene', 'no se registr',
    'sin movimientos', 'sin costos', 'está en orden', 'todo bien'];
  const parteDeHuecos = (html) => html.split('No se pudo calcular')[0];
  for (const [quien, html] of [['la obra sana', htmlSana], ['la obra vacía', htmlVacio]]) {
    const afirma = CEROS.filter(c => dice(parteDeHuecos(html), c));
    ok(afirma.length === 0,
      `en ${quien} la nota NO afirma que el dato no exista`,
      `dijo: ${afirma.join(' · ')} — «falta el dato» y «el dato es cero» no son ` +
      'la misma afirmación, y la segunda es falsa en la obra que sí capturó y no subió');
  }

  // Y EL RENGLÓN NO DICE NADA MÁS QUE EL NOMBRE DEL DATO. Es la otra mitad: lo
  // único que se afirma sobre cada dato lo afirma el encabezado, que lleva el
  // verbo. Un renglón que además opine reabre la puerta por la que entra el
  // cero sin que la lista negra de arriba lo vea venir.
  // EL RENGLÓN SE RECONOCE POR SU FRANJA IZQUIERDA, que es lo único que lo
  // distingue del encabezado, y en `border-left` —con guion—, que es como React
  // escribe `borderLeft` al pintar. Buscarlo en camelCase casa cero veces y
  // deja esta mitad de §2 pasando en verde sin haber mirado nada: fue el primer
  // rojo de esta reescritura, y un cero de renglones tiene que ser rojo.
  const renglones = [...parteDeHuecos(htmlSana)
    .matchAll(/<div style="[^"]*border-left[^"]*">([^<]+)<\/div>/g)].map(m => m[1].trim());
  ok(renglones.length === H_SANA.length,
    `la nota pinta ${H_SANA.length} renglones, uno por dato`,
    `pintó ${renglones.length}: ${JSON.stringify(renglones)}`);
  const conOpinion = renglones.filter(t => !H_SANA.some(g => g.nombre === t));
  ok(conOpinion.length === 0,
    'y cada renglón dice EXACTAMENTE el nombre del dato, sin añadir juicio',
    `de más: ${JSON.stringify(conOpinion)}`);

  // EL DETALLE SE FUE A LOS DOS PDF, y la pantalla no lo arrastra: ni los
  // títulos de las reglas, ni el motivo largo, ni la palabra «regla».
  const unTitulo = H_SANA[0].reglas[0];
  ok(!dice(htmlSana, unTitulo),
    `la nota NO lista los títulos de las reglas («${unTitulo}» no sale)`);
  ok(!dice(htmlSana, 'regla'),
    'y la palabra «regla» no aparece: no es vocabulario del cliente');
  const motivoLargo = (conPorQue[0]?.porQue || 'xxxx');
  ok(!dice(htmlVacio, motivoLargo.slice(0, 40)),
    `ni el motivo largo del dato («${motivoLargo.slice(0, 44)}…»), que vive en los PDF`);

  // Y QUE DE VERDAD VIVA EN LOS PDF, no que se haya perdido. Se afirma sobre
  // la fuente de los dos generadores: si alguien saca esa columna, el detalle
  // deja de existir en el producto y esta nota corta pasa a ser una pérdida.
  for (const gen of ['generarPDFInterno', 'generarPDFArt73']) {
    const i = src.indexOf(`function ${gen}(`);
    const trozo = i >= 0 ? src.slice(i, i + 40000) : '';
    ok(/Por qué no se pudo medir/.test(trozo) && /f\.porQue/.test(trozo),
      `${gen} sigue publicando el motivo por dato: el detalle no se perdió, se movió`,
      'si esto cae, la nota corta de la pantalla dejó al producto sin el detalle');
  }

  // ══ §3 · CON CERO DETECTADOS LA TARJETA SE PINTA IGUAL ═══════════════════
  sec('§3 · con cero riesgos detectados y huecos, la tarjeta se pinta y dice cuántos');

  // LA GUARDA DEL TABLERO, EJECUTADA. Era `riesgos.length > 0`, y con ella esta
  // obra no tenía tarjeta.
  ok(montaLaTarjeta(V_SANA.detectados, V_SANA) === true,
    'el tablero monta la tarjeta con 0 disparos y 22 huecos — antes la dejaba en blanco');
  ok(montaLaTarjeta(V_VACIO.detectados, V_VACIO) === true,
    'y la monta cuando además reventó algo');
  const nada = { detectados: [], sinHallazgo: [{ id: 'x' }], noEvaluables: [], reventaron: [] };
  ok(montaLaTarjeta([], nada) === false,
    'y NO la monta cuando todo midió y nada encontró: ahí no hay nada que decir');

  const bSana = banner({ riesgos: V_SANA.detectados, veredicto: V_SANA });
  ok(!/SE CAYO AL PINTARSE/.test(bSana), 'el banner se pinta sin un solo riesgo detectado', bSana.slice(0, 180));
  ok(dice(bSana, H_SANA[0].nombre),
    `y nombra el dato que más pesa («${H_SANA[0].nombre}»)`);
  // El silencio de arriba se explica, pero sin decir «reglas» ni «veredicto»:
  // lo que el lector necesita es que el vacío no se lea como «todo en orden» y
  // que sepa dónde mirar. Dos frases, no un párrafo.
  ok(dice(bSana, 'no encontraron nada') && dice(bSana, 'falta capturar'),
    'y dice que el silencio no es un visto bueno, y a dónde mirar');
  ok(!dice(bSana, 'veredicto sobre la obra'),
    'sin explicarle al cliente nuestra mecánica («veredicto sobre la obra» no sale)');

  // El panel vacío no deja un cascarón: si no hay nada que falte, no hay panel.
  // Un «todo medido» permanente enseña a ignorar el sitio.
  ok(panel({ noEvaluables: [], reventaron: [] }) === '',
    'sin un solo hueco el panel no pinta nada, ni un cascarón que diga «todo medido»');

  // ══ §4 · UN HUECO NO LLEVA SEVERIDAD, Y EL VERDE NO LO TAPA ══════════════
  sec('§4 · un hueco no lleva severidad, y el verde no se pinta encima');

  const etiquetasSev = Object.values(SEVERIDADES).map(s => s.label).filter(Boolean);
  const conSev = etiquetasSev.filter(l => dice(htmlSana, l));
  ok(conSev.length === 0,
    `ninguna etiqueta de severidad entra al panel de huecos [${etiquetasSev.join(', ')}]`,
    `se colaron: ${conSev.join(', ')}`);

  const acento = (html) => (html.match(/data-acento="([^"]*)"/) || [])[1] || '';
  ok(acento(bSana) !== C.green && acento(bSana) !== '',
    `el acento de una tarjeta con 22 huecos y cero disparos NO es el verde (es ${acento(bSana)})`,
    'el verde dice «revisado y en orden»; un «no sé» no puede ir debajo de él');

  // Y al revés: un hueco no rebaja una alarma. Si hay crítico, manda el crítico.
  const critico = { ...V_SANA,
    detectados: [{ id: 'z', severidad: 'critico', titulo: 'Margen negativo',
                   detalle: 'd', valor: '-5%', tab: 'operacion' }] };
  ok(acento(banner({ riesgos: critico.detectados, veredicto: critico })) === C.red,
    'y un hueco no rebaja una alarma: con un crítico el acento sigue siendo rojo');

  // ══ §5 · LO QUE REVIENTA, APARTE Y SIN NOMBRARNOS ════════════════════════
  sec('§5 · lo que reventó va aparte, en rojo, y sin confesarle el defecto al cliente');

  ok(V_VACIO.reventaron.length > 0,
    `el escenario sí hace reventar ${V_VACIO.reventaron.length} detectores de verdad: ` +
    V_VACIO.reventaron.map(r => r.id).join(', '),
    'sin un detector que truene esta sección no comprueba nada');

  // SEPARADO SIGUE, porque un hueco se arregla capturando y esto no se arregla
  // desde la app: revolverlos manda a capturar a quien no tiene nada que hacer.
  ok(dice(htmlVacio, 'no se pudo calcular'),
    'la pantalla lo pone bajo su propio rótulo, no entre los datos que faltan');
  ok(!dice(htmlVacio, 'cotea'),
    'y ya no nos nombra: el cliente no tiene por qué leer de quién es el defecto');
  const unError = V_VACIO.reventaron[0].error;
  ok(dice(htmlVacio, unError.slice(0, 40)),
    `pero sí publica qué falló («${unError.slice(0, 44)}…»), no un «error» a secas`);

  // No se cuela entre los huecos de captura: el grupo por dato no lo nombra.
  const tituloRevent = V_VACIO.reventaron[0].titulo || V_VACIO.reventaron[0].id;
  ok(!H_VACIO.some(g => g.reglas.includes(tituloRevent)),
    `lo que reventó no se cuela entre los datos que faltan («${tituloRevent}»)`,
    'juntarlos le pasaría nuestra falla al cliente');

  // Y pinta en rojo, que es lo que un defecto nuestro merece.
  const soloRevent = { detectados: [], sinHallazgo: [], noEvaluables: [],
                       reventaron: V_VACIO.reventaron };
  ok(acento(banner({ riesgos: [], veredicto: soloRevent })) === C.red,
    'y la tarjeta que sólo trae reventados se pinta en rojo');

  // ══ §6 · CERO CUENTAS, NO DOS ════════════════════════════════════════════
  sec('§6 · la nota no publica ningún conteo: ni el de reglas ni el de grupos');

  // EL ESCENARIO SIGUE DISTINGUIENDO LAS DOS CUENTAS. Se mide aunque ya no se
  // publique ninguna: es lo que hace que esta sección signifique algo. Si las
  // dos coincidieran, no publicar sería gratis.
  const suma = H_VACIO.reduce((t, g) => t + g.reglas.length, 0);
  ok(suma > V_VACIO.noEvaluables.length,
    `siguen siendo dos cuentas distintas: ${V_VACIO.noEvaluables.length} reglas sin dato ` +
    `pero ${suma} apariciones en grupos —hay reglas tumbadas por dos datos a la vez`,
    'si coincidieran, no publicar ninguna no demostraría nada');

  // Y NO SALE NINGUNA DE LAS DOS. Antes se publicaba la de reglas y se prohibía
  // la de grupos; hoy no se publica cuenta alguna, que es la forma fuerte de lo
  // mismo —dos cuentas del mismo hecho no pueden discrepar si no hay ninguna—.
  // La insignia desapareció con el rediseño: se comprueba que no volvió.
  ok(insignias(htmlVacio).length === 0,
    'la nota no lleva insignia con número: desapareció con el texto interno',
    `publicó: ${JSON.stringify(insignias(htmlVacio))}`);
  for (const n of [V_VACIO.noEvaluables.length, suma]) {
    ok(!dice(parteDeHuecos(htmlVacio), `${n} regla`),
      `y no publica «${n} reglas» por ningún lado`);
  }
  // Los renglones siguen siendo el número visible, y ése no puede discrepar con
  // nada: se cuenta mirándolo.
  ok(H_VACIO.length > 0,
    `lo que el lector cuenta son los ${H_VACIO.length} renglones, uno por dato`);

  // ══ §7 · LA DEPENDENCIA VE SU HUECO, Y LA FRONTERA AGUANTA ═══════════════
  sec('§7 · la dependencia ve su hueco, y la frontera del margen aguanta');

  const H_DEP = huecosPorDato(V_DEP.noEvaluables);
  ok(V_DEP.noEvaluables.length > 0,
    `del lado dependencia la misma obra deja ${V_DEP.noEvaluables.length} reglas sin medir`);

  const htmlDep = panel({ noEvaluables: V_DEP.noEvaluables,
    reventaron: V_DEP.reventaron });
  ok(H_DEP.every(g => dice(htmlDep, g.nombre)),
    `y los nombra todos en pantalla: ${H_DEP.map(g => g.nombre).join(' · ')}`);

  // LA FRONTERA. El municipio no lee la economía del contratista, ni siquiera
  // en forma de «te falta capturar tu nómina».
  const DEL_CONTRATISTA = ['nómina capturada de la obra', 'movimientos de almacén',
    'costos de maquinaria', 'el gasto de esta obra medido en GP',
    'el renglón de esta obra en la corrida de GP', 'subcontratos capturados',
    'la serie semanal de margen'];
  const colados = DEL_CONTRATISTA.filter(n => dice(htmlDep, n));
  ok(colados.length === 0,
    'y ni un dato de la economía del contratista se nombra de ese lado',
    `se colaron: ${colados.join(' · ')}`);
  // Y el escenario de verdad los tiene del otro lado: si no, no se comprueba nada.
  ok(DEL_CONTRATISTA.some(n => dice(htmlSana, n)),
    'aunque del lado constructora sí salen — la frontera recorta, no es que no existan');

  return fallos;
}

// ── LAS MUTACIONES ─────────────────────────────────────────────────────────
// Cada una vuelve a poner un defecto que esta rama cerró, dejando la pantalla
// compilando y con aspecto razonable. Mutan `src` entero porque lo que se
// prueba es LA PANTALLA, y la pantalla vive en el JSX.
//
// REESCRITAS EL 2026-11-16 CON EL PANEL. Seis de las once anclaban en texto que
// la nota ya no tiene —el encabezado interno, la insignia, el desplegable, el
// párrafo— y habrían salido como «no halló su anclaje», o sea 2, o sea nada
// medido. Las nuevas muerden los defectos que el ACORTAMIENTO hizo posibles, y
// la primera es la más importante del banco: es la que pone en la pantalla la
// afirmación que el texto corto invita a escribir y que sería falsa.
//
// NINGUNA TOCA «No se pudo calcular», que es por donde el banco encuentra el
// panel. Una mutación que rompe el ancla sale 2 y no demuestra nada; lo que se
// muta es la CONDICIÓN que decide si ese bloque se pinta, no su rótulo.
const MUTACIONES = [
  ['el hueco se agrupa por regla otra vez, y la lista vuelve a ser una fila por regla',
    `      const k = f.dato || f.nombre;`,
    `      const k = r.id;`],

  ['el orden del agrupado se invierte y encabeza el dato que tumba menos',
    `  return [...porDato.values()].sort((a, b) =>
    b.reglas.length - a.reglas.length || a.nombre.localeCompare(b.nombre, 'es'));`,
    `  return [...porDato.values()].sort((a, b) =>
    a.reglas.length - b.reglas.length || a.nombre.localeCompare(b.nombre, 'es'));`],

  ['la guarda del tablero vuelve a pedir un riesgo detectado para pintar la tarjeta',
    `  const hayQueDecirAlgo = riesgos.length > 0
    || veredictoRiesgos.noEvaluables.length > 0
    || veredictoRiesgos.reventaron.length > 0;`,
    `  const hayQueDecirAlgo = riesgos.length > 0;`],

  // LA MUTACIÓN QUE JUSTIFICA LA RAMA. Es el texto del usuario, puesto tal cual
  // en el renglón: «No hay movimientos de almacén». Compila, se lee natural,
  // cabe en una línea — y afirma un cero sobre un dato que nadie midió. Si esta
  // sale verde, el banco no está protegiendo nada de lo que importa aquí.
  ['el renglón afirma el cero en vez del hueco: «No hay ‹dato›»',
    `            borderLeft:\`3px solid \${C.border}\`,fontSize:10,color:C.textPri}}>
            {h.nombre}`,
    `            borderLeft:\`3px solid \${C.border}\`,fontSize:10,color:C.textPri}}>
            No hay {h.nombre}`],

  // Y LA VARIANTE SIN VERBO, que es cómo se llega a la de arriba sin escribirla:
  // el rótulo se queda en un sustantivo y el lector pone el verbo de gratis.
  ['el rótulo pierde el verbo y deja al lector poniendo «no hay»',
    `      <div style={{fontSize:10,fontWeight:700,color:C.textSec,marginBottom:6}}>
        Falta capturar
      </div>`,
    `      <div style={{fontSize:10,fontWeight:700,color:C.textSec,marginBottom:6}}>
        Almacén, maquinaria y demás
      </div>`],

  ['el renglón arrastra a la pantalla los títulos de las reglas internas',
    `            borderLeft:\`3px solid \${C.border}\`,fontSize:10,color:C.textPri}}>
            {h.nombre}`,
    `            borderLeft:\`3px solid \${C.border}\`,fontSize:10,color:C.textPri}}>
            {h.nombre} — {h.reglas.join(' · ')}`],

  ['el motivo largo del dato vuelve a la pantalla en vez de quedarse en los PDF',
    `            borderLeft:\`3px solid \${C.border}\`,fontSize:10,color:C.textPri}}>
            {h.nombre}`,
    `            borderLeft:\`3px solid \${C.border}\`,fontSize:10,color:C.textPri}}>
            {h.nombre}{h.porQue ? \` — \${h.porQue}\` : ''}`],

  // La insignia vuelve, y con ella las dos cuentas del mismo hecho.
  ['la insignia con el conteo de reglas vuelve al encabezado de la nota',
    `      <div style={{fontSize:10,fontWeight:700,color:C.textSec,marginBottom:6}}>
        Falta capturar
      </div>`,
    `      <div style={{fontSize:10,fontWeight:700,color:C.textSec,marginBottom:6}}>
        Falta capturar <Bdg color={C.textMut} small>
          {noEvaluables.length} regla{noEvaluables.length>1?'s':''} sin dato</Bdg>
      </div>`],

  // NO SE TOCA EL RÓTULO, SE TOCA LA CONDICIÓN. El bloque rojo deja de pintarse
  // en cuanto hay algo más en la nota, que es el defecto de maquetación típico:
  // se prueba con la obra que tiene las dos cosas y ahí desaparece.
  ['lo que reventó se calla en cuanto además falta capturar algo',
    `    {reventaron.length > 0 && <div style={{marginTop:huecos.length?7:0}}>`,
    `    {reventaron.length > 0 && huecos.length === 0 && <div style={{marginTop:0}}>`],

  ['la guarda del cascarón se cae y el panel pinta un marco vacío',
    `  if (!noEvaluables.length && !reventaron.length) return null;`,
    `  // la guarda se fue con el rediseño`],

  ['el banner deja de explicar el silencio y el vacío se lee como «todo en orden»',
    `      Las revisiones que pudieron medir no encontraron nada. Abajo, lo que falta
      capturar en esta obra.`,
    `      Sin indicadores de riesgo.`],

  ['el verde vuelve a pintarse encima de una tarjeta con huecos y cero disparos',
    `               : hayHuecos ? C.textMut : C.green;`,
    `               : C.green;`],

  ['la dependencia recibe la biblioteca entera y le entran los datos del contratista',
    `  const soloContrato = contexto?.tipo === 'dependencia';`,
    `  const soloContrato = false;`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hueco-riesgo-'));
  let i = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!src.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 160)}`);
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

console.log('EL RIESGO QUE NO SE PUDO MEDIR SE VE EN PANTALLA');
const fallos = correr();
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
