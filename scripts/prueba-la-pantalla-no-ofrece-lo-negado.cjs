#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA PANTALLA NO OFRECE NI AFIRMA LO QUE LA REGLA NIEGA
// ════════════════════════════════════════════════════════════════════════════
//
// EL CANDADO YA ESTABA Y YA ESTABA PROBADO. `firestore.rules` niega toda
// escritura contra una obra cerrada salvo la que la vuelve a abrir, y
// `prueba-reglas-obra-cerrada.cjs` lo ejercita ruta por ruta. Esa mitad es la
// que tiene que vivir en el servidor, porque una escritura puede venir de un
// guion, de otra pestaña o de una versión vieja del front.
//
// LA OTRA MITAD FALTABA, Y SE VIO. El 2026-11-10, en el preview y con la 0128
// recién cerrada, la pantalla de captura seguía ofreciendo «Guardar registro»
// y «Cerrar semana». Al apretarlos salió lo que tenía que salir —`ESCRITURA
// PERDIDA · obras/0128/avance/materiales · permission-denied`, una franja de
// «3 cambios NO se guardaron», y nada en la base— y encima de todo eso un
// modal que decía, textualmente:
//
//     «Tu captura de avance SÍ quedó guardada.»
//
// No había quedado. Esa frase era una constante del mensaje: cierta para el
// caso que lo motivó —la 0114, donde sólo falló el punto del histórico— y
// falsa en cuanto la escritura del avance también se rechaza. Y es la peor
// clase de falsedad que puede imprimir esta pantalla: con un «Error al
// guardar» el residente vuelve a capturar; con esta frase se va a su casa.
//
// SON DOS DEFECTOS DE LA MISMA NATURALEZA, y por eso van en la misma rama: un
// botón que la regla va a rechazar es una promesa falsa, y un aviso que afirma
// un guardado que no ocurrió es una afirmación falsa. Las dos convierten el
// candado en una trampa.
//
// QUÉ AFIRMA ESTE BANCO, Y CÓMO. No afirma que exista ningún símbolo. Saca de
// `src/App.jsx` la razón y el mensaje y los EJECUTA; y para la pantalla saca
// del JSX las CONDICIONES que de verdad deciden qué se pinta —la del guardado
// y la del botón de borrar— y las evalúa con obras de cada estado. Así no se
// puede cambiar el candado de la regla sin que la pantalla lo siga.
//
// LAS SEIS AFIRMACIONES:
//
//   §1. La razón existe exactamente cuando la obra no admite escrituras, y
//       dice CÓMO se sale. Un «no se puede» sin salida es un callejón.
//   §2. El aviso de fallo no afirma lo que no le consta. Las tres ramas.
//   §3. Lo que el aviso recibe es lo que la escritura DEVOLVIÓ, no un supuesto:
//       se comprueba por identidad entre las dos expresiones del archivo.
//   §4. Con la obra cerrada no hay botón de guardar, y en su lugar se imprime
//       la razón misma — no un «no disponible» que haya que ir a adivinar.
//   §5. «Eliminar» tampoco se ofrece, porque `allow delete` exige
//       `!obraCerradaC(id)`. La salida es «Reabrir», que está al lado.
//   §6. Los OTROS controles de esa misma pantalla tampoco. Quitar los dos
//       botones de guardado dejó en pie el input de avance, el «anular» de
//       cada foto, el cuadro de «Agregar foto» y el alta de extraordinarias
//       —se vieron los cuatro en el preview, sobre la 0114 ya cerrada—. El
//       cuadro de fotos era el peor: abría el selector de archivos, se tragaba
//       la imagen y no pasaba nada, ni guardado ni aviso. Todos cuelgan de
//       `editar`, que mira el rol; ahora mira también el estado de la obra, y
//       el banner de «tu rol no tiene permiso» se quedó colgado del rol para
//       no decirle a un gerente que le falta un permiso que tiene.
//
// Uso:
//     node scripts/prueba-la-pantalla-no-ofrece-lo-negado.cjs
//     node scripts/prueba-la-pantalla-no-ofrece-lo-negado.cjs --contraprueba
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
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));

const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');
const ast = () => parse(src, { sourceType: 'module', plugins: ['jsx'] });

// ── LO VIVO ────────────────────────────────────────────────────────────────
const PEDIDOS = ['motivoParaNoEscribir', 'mensajeFalloSnapshot',
                 'selloDeEstadoLegible', 'ErrorSnapshot'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan, path.basename(archivo));
const APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
const { motivoParaNoEscribir, mensajeFalloSnapshot, ErrorSnapshot } = APP;

// ── LAS CONDICIONES QUE DECIDEN QUÉ SE PINTA, SACADAS DEL JSX ──────────────
//
// El ancla de cada una es el TEXTO que el usuario ve, no una variable: el día
// que alguien renombre `cerrada` o `motivoNoEscribir`, esta prueba tiene que
// seguir mirando el mismo botón. Si el ancla se rompe es NO ARRANCÓ, porque lo
// que hay que arreglar es el ancla y no se puede fingir que se midió.
const muere = (...lineas) => {
  console.error(`\nNO ARRANCÓ: ${lineas[0]}`);
  for (const l of lineas.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

// Un `<button>` cuyo texto visible es `rotulo`, y la condición que lo deja
// aparecer: todo lo que hay a la izquierda del `&&` que lo precede.
function condicionDelBoton(rotulo) {
  let hallado = null;
  traverse(ast(), {
    JSXElement(p) {
      if (hallado) return;
      if (p.node.openingElement.name?.name !== 'button') return;
      const texto = p.node.children
        .filter(c => c.type === 'JSXText').map(c => c.value.trim()).join('');
      if (texto !== rotulo) return;
      // Subir hasta la raíz de la cadena de `&&` que lo gobierna.
      let n = p, padre = p.parentPath;
      while (padre && padre.node.type === 'LogicalExpression' &&
             padre.node.operator === '&&' && padre.node.right === n.node) {
        n = padre; padre = padre.parentPath;
      }
      if (n === p) return;  // no está tras ningún `&&`: no hay condición
      hallado = src.slice(n.node.start, p.node.start).replace(/&&\s*$/, '').trim();
    },
  });
  return hallado;
}

// El `if (…) return (…)` que corta el render antes de llegar a los botones:
// se busca por la posición, que es lo que significa «salida temprana», y se
// devuelven su condición, su JSX y si de verdad va ANTES del botón.
function salidaTempranaAntesDe(rotuloBoton) {
  const a = ast();
  let boton = null;
  traverse(a, {
    JSXElement(p) {
      if (boton) return;
      if (p.node.openingElement.name?.name !== 'button') return;
      const texto = p.node.children
        .filter(c => c.type === 'JSXText').map(c => c.value.trim()).join('');
      if (texto === rotuloBoton) boton = p.node;
    },
  });
  if (!boton) return null;
  let hallado = null;
  traverse(a, {
    IfStatement(p) {
      if (hallado) return;
      const c = p.node.consequent;
      const ret = c.type === 'ReturnStatement' ? c
        : (c.type === 'BlockStatement' && c.body.length === 1 &&
           c.body[0].type === 'ReturnStatement' ? c.body[0] : null);
      if (!ret || !ret.argument) return;
      const fn = p.getFunctionParent();
      if (!fn || boton.start < fn.node.start || boton.end > fn.node.end) return;
      hallado = {
        condicion: src.slice(p.node.test.start, p.node.test.end),
        jsx: src.slice(ret.argument.start, ret.argument.end),
        antes: p.node.end < boton.start,
      };
    },
  });
  return hallado;
}

// Las expresiones que CABLEAN el aviso: a qué se le asigna lo que devolvió la
// escritura del avance, y qué argumentos recibe el mensaje. La identidad entre
// las dos es la aserción — no «se pasa algo», sino «se pasa EXACTAMENTE lo que
// la escritura devolvió».
//
// La escritura se busca DENTRO del mismo componente que arma el aviso, y eso
// no es ceremonia: `obras/{id}/avance/subs` se escribe también desde la
// confirmación del catálogo de presupuesto, que es otro componente y otra
// historia. Sin acotar, esta prueba comparaba el `okSubs` de aquella con el
// `quedo.captura` de ésta y declaraba un defecto que no existía.
function cableadoDelAviso() {
  const a = ast();
  let componente = null, argumentosDelMensaje = null;
  traverse(a, {
    CallExpression(p) {
      if (argumentosDelMensaje) return;
      if (p.node.callee.type !== 'Identifier') return;
      if (p.node.callee.name !== 'mensajeFalloSnapshot') return;
      argumentosDelMensaje = p.node.arguments.map(x => src.slice(x.start, x.end));
      // El componente, no la función interna: el aviso se arma en el `catch`
      // de `guardar` y la escritura está en su `try`, pero la variable que las
      // une vive un piso más arriba.
      let fn = p.getFunctionParent();
      while (fn?.getFunctionParent()) fn = fn.getFunctionParent();
      componente = fn?.node || null;
    },
  });
  let destinoDeLaEscritura = null;
  if (componente) traverse(a, {
    CallExpression(p) {
      if (destinoDeLaEscritura) return;
      if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== 'fsSetA') return;
      if (p.node.start < componente.start || p.node.end > componente.end) return;
      const prim = p.node.arguments[0];
      if (!prim || !/avance\/subs/.test(src.slice(prim.start, prim.end))) return;
      // `await fsSetA(…)` → el padre es el `await`, y el abuelo la asignación.
      const arriba = p.parentPath?.node.type === 'AwaitExpression'
        ? p.parentPath.parentPath : p.parentPath;
      if (arriba?.node.type === 'AssignmentExpression') {
        destinoDeLaEscritura = src.slice(arriba.node.left.start, arriba.node.left.end);
      } else if (arriba?.node.type === 'VariableDeclarator') {
        destinoDeLaEscritura = src.slice(arriba.node.id.start, arriba.node.id.end);
      }
    },
  });
  return { destinoDeLaEscritura, argumentosDelMensaje };
}

// La condición `&&` que gobierna el elemento cuyo texto visible contiene
// `fragmento`. Mismo criterio que `condicionDelBoton`: el ancla es lo que se
// lee en pantalla, no el nombre de una variable.
function condicionDeLoQueDice(fragmento) {
  let hallado = null;
  traverse(ast(), {
    JSXElement(p) {
      if (hallado) return;
      const texto = p.node.children
        .filter(c => c.type === 'JSXText').map(c => c.value.trim()).join(' ');
      if (!texto.includes(fragmento)) return;
      let n = p, padre = p.parentPath;
      while (padre && padre.node.type === 'LogicalExpression' &&
             padre.node.operator === '&&' && padre.node.right === n.node) {
        n = padre; padre = padre.parentPath;
      }
      if (n === p) return;
      hallado = src.slice(n.node.start, p.node.start).replace(/&&\s*$/, '').trim();
    },
  });
  return hallado;
}

// Lo que gobierna la captura del catálogo de avance. El ancla es el componente
// que MONTA el cuadro de fotos: de ahí se sacan la inicialización de `editar`
// —el interruptor del que cuelgan el input de avance, el «anular», el cuadro
// de subida y el alta de extraordinarias— y el valor que `onAdd` recibe cuando
// no se puede editar, que es lo que decide si el cuadro ofrece o no.
function gobiernoDeLaCaptura() {
  const a = ast();
  let componente = null, propOnAdd = null;
  traverse(a, {
    JSXElement(p) {
      if (componente) return;
      if (p.node.openingElement.name?.name !== 'ConceptoFotos') return;
      const at = p.node.openingElement.attributes
        .find(x => x.type === 'JSXAttribute' && x.name.name === 'onAdd');
      const e = at?.value?.type === 'JSXExpressionContainer' ? at.value.expression : null;
      if (e) propOnAdd = e.type === 'ConditionalExpression'
        ? { cond: src.slice(e.test.start, e.test.end),
            sino: src.slice(e.alternate.start, e.alternate.end) }
        : { cond: null, sino: src.slice(e.start, e.end) };
      let fn = p.getFunctionParent();
      while (fn?.getFunctionParent()) fn = fn.getFunctionParent();
      componente = fn?.node || null;
    },
  });
  let exprEditar = null;
  if (componente) traverse(a, {
    VariableDeclarator(p) {
      if (exprEditar) return;
      if (p.node.id.name !== 'editar' || !p.node.init) return;
      if (p.node.start < componente.start || p.node.end > componente.end) return;
      exprEditar = src.slice(p.node.init.start, p.node.init.end);
    },
  });
  return { exprEditar, propOnAdd };
}

// El cuadro de fotos entero, para pintarlo de verdad. Es la única forma de
// afirmar que NO ofrece: la oferta era un `<div>` clicable, no un `<button>`,
// y mirar el árbol a ojo es exactamente como se colaba.
function fuenteDeComponente(nombre) {
  let f = null;
  traverse(ast(), {
    FunctionDeclaration(p) {
      if (f || p.node.id?.name !== nombre) return;
      f = src.slice(p.node.start, p.node.end);
    },
  });
  return f;
}

const COND_ELIMINAR = condicionDelBoton('Eliminar');
if (!COND_ELIMINAR) muere(
  'no se halló el botón «Eliminar» de la tarjeta de obra, o no está tras un `&&`.',
  'Es el botón que esta prueba viene a mirar: la regla niega borrar una obra cerrada.');

const GUARDA = salidaTempranaAntesDe('Cerrar semana');
if (!GUARDA) muere(
  'no se halló la salida temprana de la pantalla de captura.',
  'Se busca un `if (…) return (…)` en la misma función que el botón «Cerrar semana».',
  'Si el guardado se reescribió, lo que hay que arreglar es el ancla.');

const CABLE = cableadoDelAviso();
if (!CABLE.argumentosDelMensaje) muere(
  'no se halló ninguna llamada a `mensajeFalloSnapshot`.',
  'Es el aviso que decía «Tu captura de avance SÍ quedó guardada».');
// Que la escritura NO asigne su resultado NO es andamiaje roto: es el defecto
// exacto que esta rama vino a quitar —`fsSetA` devolvía el booleano y esta
// función lo tiraba—. Por eso no muere aquí; cae en ROJO abajo, en §3.

const { exprEditar: EXPR_EDITAR, propOnAdd: PROP_ONADD } = gobiernoDeLaCaptura();
if (!EXPR_EDITAR) muere(
  'no se halló la inicialización de `editar` en el componente que monta `<ConceptoFotos/>`.',
  'Es el interruptor del que cuelgan el input de avance, el «anular» y el alta de extraordinarias.');

const COND_BANNER = condicionDeLoQueDice('Vista de solo lectura');
if (!COND_BANNER) muere(
  'no se halló el aviso «Vista de solo lectura», o no está tras un `&&`.',
  'Es la frase que no puede decirle «no tienes permiso» a quien sí lo tiene.');

// La condición que MONTA el bloque de guardado. No es un detalle de montaje:
// la razón del cierre se imprime desde dentro de ese bloque, así que si la
// condición mira `editar` —que una obra cerrada pone en falso— la pantalla se
// queda muda. Se vio en el preview: sin inputs, sin botones y sin una línea
// que explicara nada.
const COND_MONTA_GUARDADO = (() => {
  let hallado = null;
  traverse(ast(), {
    JSXElement(p) {
      if (hallado) return;
      if (p.node.openingElement.name?.name !== 'GuardarAvanceBtn') return;
      let n = p, padre = p.parentPath;
      while (padre && padre.node.type === 'LogicalExpression' &&
             padre.node.operator === '&&' && padre.node.right === n.node) {
        n = padre; padre = padre.parentPath;
      }
      if (n === p) return;
      hallado = src.slice(n.node.start, p.node.start).replace(/&&\s*$/, '').trim();
    },
  });
  return hallado;
})();
if (!COND_MONTA_GUARDADO) muere(
  'no se halló la condición que monta `<GuardarAvanceBtn/>`, o no está tras un `&&`.',
  'Es el bloque que imprime la razón del cierre al pie de la pantalla de captura.');

const FUENTE_FOTOS = fuenteDeComponente('ConceptoFotos');
if (!FUENTE_FOTOS) muere(
  'no se halló el componente `ConceptoFotos`, que es el cuadro de subida de fotos.');

// ── EL CUADRO DE FOTOS, PINTADO DE VERDAD ──────────────────────────────────
// Los colores salen de un Proxy: este banco no juzga estilo y no tiene por qué
// cargar la paleta entera para preguntarle al cuadro qué ofrece.
const compilarJSX = (f) => esbuild.transformSync(`(${f})`, { loader: 'jsx' }).code;
const PALETA = new Proxy({}, { get: () => '#808080' });
const pintarFotos = (props) => {
  const entorno = {
    React,
    useRef: () => ({ current: null }),
    useState: (ini) => [ini, () => {}],
    useCallback: (f) => f,
    useMemo: (f) => f(),
    C: PALETA,
    semanaISO: () => ({ semana: 46, año: 2026 }),
    snapshotId: (s, an) => `S${s}-${an}`,
    semanaDeEvidencia: () => null,
    SelloEvidencia: () => null,
    Lightbox: () => null,
    ModalAnularFoto: () => null,
  };
  const nombres = Object.keys(entorno);
  let Comp;
  try {
    Comp = new Function(...nombres, `return ${compilarJSX(FUENTE_FOTOS)}`)
      (...nombres.map(n => entorno[n]));
  } catch (e) {
    muere(`el cuadro de fotos no se pudo montar: ${e.message}`);
  }
  try { return renderToStaticMarkup(React.createElement(Comp, props)); }
  catch (e) { return `EL CUADRO SE CAYÓ AL PINTARSE: ${e.message}`; }
};

// Evalúa UNA condición del JSX con los nombres que el render le da de comer.
const evaluar = (expr, ambito) => {
  const nombres = Object.keys(ambito);
  try {
    return new Function(...nombres, `"use strict"; return (${expr});`)
      (...nombres.map(n => ambito[n]));
  } catch (e) {
    muere(`no se pudo evaluar una condición de la pantalla: ${e.message}`,
          `era: ${String(expr).slice(0, 200)}`);
  }
};

// ── LAS OBRAS DEL ESCENARIO ────────────────────────────────────────────────
// La 0112 es «el malecón», que es la obra terminada por la que se pidió todo
// esto. El sello es el que escribe `guardarEstadoDeObra`.
const malecon = (estado) => ({
  id: '0112', nombre: 'Malecón Coatzacoalcos', contrato: 'SIOP-0112',
  estado, estadoDesde: '2026-11-09T18:30:00.000Z',
  estadoPor: 'gerencia@fosmon.com.mx', estadoPorNombre: 'Gerencia',
});
const CERRADA = malecon('cerrada');
const ARCHIVADA = malecon('archivada');
const ACTIVA = malecon('activa');

const falloDe = (mensaje) => new ErrorSnapshot(new Error(mensaje), [], '0112');
const AFIRMA_GUARDADO = /captura de avance S[IÍ] qued[oó] guardada/i;

function correr() {
  const fallos = [];
  const callado = !!process.env.CALLADO;
  const ok = (cond, que, detalle = '') => {
    if (cond) { if (!callado) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`);
  };
  const sec = (t) => { if (!callado) console.log(`\n${t}`); };

  // ══ §1 · LA RAZÓN, Y SU SALIDA ═══════════════════════════════════════════
  sec('§1 · la razón existe cuando la regla niega, y dice cómo se sale');

  ok(motivoParaNoEscribir(ACTIVA) === null,
    'una obra activa no tiene razón para no escribir: se captura y punto',
    `devolvió: ${JSON.stringify(motivoParaNoEscribir(ACTIVA))}`);
  ok(motivoParaNoEscribir({ id: '0112' }) === null &&
     motivoParaNoEscribir(undefined) === null &&
     motivoParaNoEscribir({ id: '0112', estado: 'pausada' }) === null,
    'tampoco una pausada, una sin estado, ni un hueco — el candado no se contagia');

  const rc = motivoParaNoEscribir(CERRADA);
  ok(typeof rc === 'string' && rc.length > 0,
    'una obra cerrada SÍ la tiene', `devolvió: ${JSON.stringify(rc)}`);
  ok(/cerrada/i.test(rc), 'y dice en qué estado está, no «no disponible»', rc);
  ok(/09\/11\/2026|9\/11\/2026/.test(rc) && /Gerencia/.test(rc),
    'con la fecha y el quién del cierre: la pregunta que se hace es «¿quién la cerró?»', rc);
  ok(/reabrir/i.test(rc),
    'y nombra la salida — un «no se puede» sin salida es un callejón', rc);
  ok(/registrad/i.test(rc),
    'advirtiendo que reabrir queda registrado, que fue la condición de que exista', rc);

  const ra = motivoParaNoEscribir(ARCHIVADA);
  ok(typeof ra === 'string' && /archivada/i.test(ra),
    'una archivada también, con su propia palabra', String(ra));
  ok(/reactivar/i.test(ra),
    'y su propia salida: de una archivada no se «reabre», se reactiva', String(ra));

  // Sin sello, no se inventa. Es la regla de `selloDeEstadoLegible`.
  const sinSello = motivoParaNoEscribir({ id: '0112', estado: 'cerrada' });
  ok(/cerrada/i.test(sinSello) && !/undefined|NaN|Invalid/i.test(sinSello),
    'una cerrada sin sello lo dice igual, sin inventar fecha ni nombre', sinSello);

  // ══ §2 · EL AVISO NO AFIRMA LO QUE NO LE CONSTA ══════════════════════════
  sec('§2 · el aviso de fallo no afirma un guardado que no ocurrió');

  // La rama que motivó todo esto: la 0114, histórico lleno, avance sí guardado.
  const siQuedo = mensajeFalloSnapshot(falloDe('deadline-exceeded'), true, null);
  ok(AFIRMA_GUARDADO.test(siQuedo),
    'cuando la captura SÍ quedó, lo dice — el caso de la 0114 no se perdió',
    siQuedo.split('\n')[0]);
  ok(/reintenta|vuelve a intentar/i.test(siQuedo),
    'y manda a reintentar el cierre, que es lo único que falta');

  // La que mentía.
  const noQuedo = mensajeFalloSnapshot(falloDe('permission-denied'), false, null);
  ok(!AFIRMA_GUARDADO.test(noQuedo),
    'cuando NO quedó, el aviso ya no afirma que sí',
    noQuedo.replace(/\n+/g, ' | '));
  ok(/TAMPOCO/.test(noQuedo),
    'lo dice con todas sus letras: la captura tampoco quedó',
    noQuedo.replace(/\n+/g, ' | '));
  ok(/anota/i.test(noQuedo),
    'y manda a anotar lo capturado antes de salir, que es lo que lo salva',
    noQuedo.replace(/\n+/g, ' | '));
  ok(!/vuelve a intentar el cierre/i.test(noQuedo),
    'sin mandar a reintentar el cierre: lo que falló fue la escritura',
    noQuedo.replace(/\n+/g, ' | '));

  // La rama del límite de tamaño, que tenía la misma frase fija.
  const lleno = falloDe('Document exceeds maximum size');
  ok(AFIRMA_GUARDADO.test(mensajeFalloSnapshot(lleno, true, null)),
    'con el histórico lleno y la captura guardada, sigue diciendo que está a salvo');
  const llenoYPerdido = mensajeFalloSnapshot(lleno, false, null);
  ok(!AFIRMA_GUARDADO.test(llenoYPerdido) && /TAMPOCO/.test(llenoYPerdido),
    'con el histórico lleno y la captura perdida, tampoco lo afirma',
    llenoYPerdido.replace(/\n+/g, ' | '));
  ok(/l[ií]mite/i.test(llenoYPerdido),
    'y no se come el diagnóstico del tamaño: son dos problemas y se nombran los dos',
    llenoYPerdido.replace(/\n+/g, ' | '));

  // Y el caso que lo trajo: obra cerrada. El motivo MANDA.
  const cerrado = mensajeFalloSnapshot(falloDe('permission-denied'), false, rc);
  ok(!AFIRMA_GUARDADO.test(cerrado),
    'con la obra cerrada, el aviso no afirma ningún guardado',
    cerrado.replace(/\n+/g, ' | '));
  ok(cerrado.startsWith(rc),
    'y abre con la razón, que es lo que el residente necesita leer primero',
    cerrado.split('\n')[0]);
  ok(!/compacte|sistemas/i.test(cerrado),
    'sin mandar a sistemas a compactar un historial que no está roto',
    cerrado.replace(/\n+/g, ' | '));

  // La omisión no afirma. Un llamador que no pase el dato recibe la versión
  // prudente, nunca la que promete.
  ok(!AFIRMA_GUARDADO.test(mensajeFalloSnapshot(falloDe('qué sé yo'))),
    'y si nadie dice si quedó, el aviso NO lo da por hecho');

  // ══ §3 · EL CABLEADO: LO QUE SE PASA ES LO QUE SE DEVOLVIÓ ═══════════════
  sec('§3 · el aviso recibe lo que la escritura devolvió, no un supuesto');

  const { destinoDeLaEscritura, argumentosDelMensaje } = CABLE;
  ok(!!destinoDeLaEscritura,
    'la escritura de `avance/subs` guarda lo que devolvió, en vez de tirarlo',
    'sin eso el aviso no puede saber si la captura quedó, y vuelve a suponerlo');
  ok(argumentosDelMensaje.length >= 2,
    'la llamada al aviso le pasa si la captura quedó',
    `pasa ${argumentosDelMensaje.length}: ${argumentosDelMensaje.join(' , ')}`);
  ok(argumentosDelMensaje[1] === destinoDeLaEscritura,
    'y lo que le pasa es EXACTAMENTE lo que devolvió la escritura de `avance/subs`',
    `escribe en «${destinoDeLaEscritura}», pasa «${argumentosDelMensaje[1]}»`);
  ok(!/^(true|false|!!)/.test(String(argumentosDelMensaje[1]).trim()),
    'no una constante ni una suposición, que es como nació la frase falsa',
    `pasa «${argumentosDelMensaje[1]}»`);
  ok(argumentosDelMensaje.length >= 3 && /motivo/i.test(argumentosDelMensaje[2]),
    'y le pasa la razón, para que el aviso pueda explicar el candado',
    `pasa «${argumentosDelMensaje[2] || '(nada)'}»`);

  // ══ §4 · LA PANTALLA DE CAPTURA NO OFRECE EL BOTÓN ═══════════════════════
  sec('§4 · con la obra cerrada no hay botón de guardar, y se imprime la razón');

  ok(GUARDA.antes,
    'la salida corta el render ANTES de los botones, no después',
    'si va después, los botones se pintan igual y el candado no se nota');

  // La condición se evalúa con el valor que de verdad le llega: el resultado
  // de `motivoParaNoEscribir` sobre cada obra. No con un `true` de laboratorio.
  ok(!!conMotivo(GUARDA.condicion, motivoParaNoEscribir(CERRADA)),
    'con la obra cerrada, la condición de la salida se cumple: no hay botones',
    `condición: ${GUARDA.condicion}`);
  ok(!!conMotivo(GUARDA.condicion, motivoParaNoEscribir(ARCHIVADA)),
    'con la archivada también');
  ok(!conMotivo(GUARDA.condicion, motivoParaNoEscribir(ACTIVA)),
    'y con la obra activa NO se cumple: los botones siguen ahí',
    `condición: ${GUARDA.condicion} con ${JSON.stringify(motivoParaNoEscribir(ACTIVA))}`);

  const dentro = IDENTIFICADORES(GUARDA.condicion);
  ok(dentro.some(n => new RegExp(`\\{\\s*${n}\\s*\\}`).test(GUARDA.jsx)),
    'y lo que se pinta en su lugar es la razón MISMA, no un «no disponible»',
    `pinta: ${GUARDA.jsx.replace(/\s+/g, ' ').slice(0, 220)}`);
  ok(!/<button/.test(GUARDA.jsx),
    'sin dejar un botón deshabilitado a la vista, que se lee como «ahora no»',
    GUARDA.jsx.replace(/\s+/g, ' ').slice(0, 220));

  // ══ §5 · «ELIMINAR» TAMPOCO ══════════════════════════════════════════════
  sec('§5 · borrar una obra cerrada lo niega la regla, así que no se ofrece');

  const puedeBorrar = (o, permisos = {}) => evaluar(COND_ELIMINAR, {
    puedeEliminar: true, puedeGestionar: true,
    cerrada: o?.estado === 'cerrada', archivada: o?.estado === 'archivada',
    o, usuario: { rol: 'gerente_construccion' }, ...permisos,
  });

  ok(!puedeBorrar(CERRADA),
    'sobre una obra cerrada no se ofrece «Eliminar»',
    `condición: ${COND_ELIMINAR}`);
  ok(!!puedeBorrar(ACTIVA),
    'sobre una activa sí — el candado es del cierre, no del botón',
    `condición: ${COND_ELIMINAR}`);
  ok(!evaluar(COND_ELIMINAR, {
      puedeEliminar: false, puedeGestionar: false, cerrada: false,
      archivada: false, o: ACTIVA, usuario: { rol: 'residente' } }),
    'y quien no tiene el permiso sigue sin verlo: no se aflojó nada de antes');

  // ══ §6 · LOS OTROS CONTROLES DE LA MISMA PANTALLA ════════════════════════
  sec('§6 · el input de avance, el «anular», el cuadro de fotos y las extraordinarias');

  // `editar` se evalúa con los dos insumos que de verdad lo deciden: lo que el
  // rol permite y el estado de la obra. El `can` de mentira devuelve lo que el
  // rol diría, para que la expresión siga midiendo si alguien la reescribe sin
  // la variable intermedia.
  const editarCon = (rolPuede, obra) => evaluar(EXPR_EDITAR, {
    puedeCapturarElRol: rolPuede, can: () => rolPuede, rol: 'gerente_construccion',
    obra, motivoParaNoEscribir,
  });

  ok(editarCon(true, ACTIVA) === true,
    'sobre una obra activa, quien tiene el permiso del rol captura',
    `expresión: ${EXPR_EDITAR}`);
  ok(editarCon(true, CERRADA) === false,
    'sobre una cerrada NO captura, aunque el rol se lo permita: la regla rechaza la escritura',
    `expresión: ${EXPR_EDITAR} · dio ${JSON.stringify(editarCon(true, CERRADA))}`);
  ok(editarCon(true, ARCHIVADA) === false,
    'y sobre una archivada tampoco');
  ok(editarCon(false, ACTIVA) === false,
    'y sin el permiso del rol sigue sin poder: el candado nuevo no aflojó el viejo');

  // El banner quedó colgado del rol a propósito. Si cuelga de `editar`, una
  // obra cerrada le dice a un gerente de construcción que su rol no tiene
  // permiso — y es falso: el permiso lo tiene, lo que no tiene es obra abierta.
  const bannerCon = (rolPuede, obra) => !!evaluar(COND_BANNER, {
    puedeCapturarElRol: rolPuede, can: () => rolPuede, rol: 'gerente_construccion',
    obra, motivoParaNoEscribir,
    editar: rolPuede && !motivoParaNoEscribir(obra),
  });
  ok(bannerCon(true, CERRADA) === false,
    'el aviso de «tu rol no tiene permiso» NO sale sobre una obra cerrada: el permiso está',
    `condición: ${COND_BANNER}`);
  ok(bannerCon(true, ARCHIVADA) === false, 'ni sobre una archivada');
  ok(bannerCon(false, ACTIVA) === true,
    'pero sigue saliendo cuando de verdad es el rol el que no alcanza',
    `condición: ${COND_BANNER}`);

  // Y la pantalla no se queda muda: el bloque que imprime la razón sigue
  // montándose sobre la obra cerrada. Quitar los controles sin decir por qué
  // deja al residente mirando una pantalla que no responde.
  const montaCon = (rolPuede, obra) => !!evaluar(COND_MONTA_GUARDADO, {
    puedeCapturarElRol: rolPuede, can: () => rolPuede, rol: 'gerente_construccion',
    obra, motivoParaNoEscribir, tab: 'volumenes',
    editar: rolPuede && !motivoParaNoEscribir(obra),
  });
  ok(montaCon(true, CERRADA) === true,
    'sobre la obra cerrada el bloque del guardado SIGUE montándose: es quien imprime la razón',
    `condición: ${COND_MONTA_GUARDADO}`);
  ok(montaCon(true, ACTIVA) === true, 'y sobre la activa también, con sus botones');
  ok(montaCon(false, ACTIVA) === false,
    'pero no para quien no tiene el permiso del rol: ahí habla el aviso de solo-lectura');

  // El cuadro de fotos: lo que recibe, y lo que pinta con lo que recibe.
  ok(!!PROP_ONADD && /^null$/.test(PROP_ONADD.sino.trim()),
    'cuando no se puede editar, el cuadro de fotos no recibe una función vacía: recibe `null`',
    `recibe «${PROP_ONADD?.sino}» — con un no-op abría el selector, se tragaba la imagen y no pasaba nada`);

  const sinAlta = pintarFotos({ fotos: [], onAdd: null, onAnular: null });
  ok(!/Agregar foto/.test(sinAlta),
    'y sin función para añadir, el cuadro no ofrece «Agregar foto»',
    sinAlta.replace(/\s+/g, ' ').slice(0, 180) || '(no pintó nada)');
  ok(!/type="file"/.test(sinAlta),
    'ni deja el selector de archivos colgado del DOM, que es lo que abría el clic',
    sinAlta.replace(/\s+/g, ' ').slice(0, 180) || '(no pintó nada)');

  const conFotos = pintarFotos({
    fotos: [{ id: 'a', url: 'uno.jpg' }, { id: 'b', url: 'dos.jpg' }],
    onAdd: null, onAnular: null });
  ok(/2 foto\(s\)/.test(conFotos),
    'el conteo sí se queda: las fotos del expediente son un dato, no una oferta',
    conFotos.replace(/\s+/g, ' ').slice(0, 180));
  ok(!/>anular</.test(conFotos),
    'pero el «anular» se va, porque anular escribe y la regla lo rechaza');

  const abierta = pintarFotos({ fotos: [], onAdd: () => {}, onAnular: () => {} });
  ok(/Agregar foto/.test(abierta) && /type="file"/.test(abierta),
    'y con la obra abierta el cuadro sigue ofreciendo la subida: no se aflojó nada',
    abierta.replace(/\s+/g, ' ').slice(0, 180));

  return fallos;
}

// Los identificadores libres de una expresión, para poder darle de comer sin
// teclear su nombre aquí — el día que `motivoNoEscribir` se renombre, esto
// sigue midiendo en vez de reventar.
const IDENTIFICADORES = (expr) => {
  const a = parse(`(${expr})`, { sourceType: 'module', plugins: ['jsx'] });
  const vistos = new Set();
  traverse(a, { Identifier(p) { if (!p.parentPath.isMemberExpression({ property: p.node })) vistos.add(p.node.name); } });
  return [...vistos];
};
const conMotivo = (expr, motivo) => {
  const ambito = {};
  for (const n of IDENTIFICADORES(expr)) ambito[n] = motivo;
  return evaluar(expr, Object.keys(ambito).length ? ambito : { _: null });
};

// ── LAS MUTACIONES ─────────────────────────────────────────────────────────
// Cada una vuelve a poner un defecto plausible, dejando el archivo compilando
// y la pantalla con aspecto razonable. Varias son, literalmente, el estado del
// archivo antes de esta rama.
const MUTACIONES = [
  ['el aviso vuelve a afirmar el guardado aunque la captura se haya perdido',
    `  const porque = err?.message || 'error desconocido';
  if (!quedoLaCaptura) {`,
    `  const porque = err?.message || 'error desconocido';
  if (false) {`],

  ['con el histórico lleno, el aviso vuelve a dar la captura por buena',
    `    if (!quedoLaCaptura) {
      // El límite explica el histórico, no el avance: son dos documentos. Que`,
    `    if (false) {
      // El límite explica el histórico, no el avance: son dos documentos. Que`],

  ['la razón deja de mandar y el aviso diagnostica tamaño sobre una obra cerrada',
    `  if (motivo) {
    return \`\${motivo}\\n\\n\` +`,
    `  if (false) {
    return \`\${motivo}\\n\\n\` +`],

  ['la escritura del avance vuelve a tirar su resultado y el aviso lo supone',
    `      quedo.captura = await fsSetA(\`obras/\${obra.id}/avance/subs\`, avanceData,`,
    `      await fsSetA(\`obras/\${obra.id}/avance/subs\`, avanceData,`],

  ['al aviso se le pasa un `true` fijo en vez de lo que devolvió la escritura',
    `          mensaje: mensajeFalloSnapshot(e, quedo.captura, motivoNoEscribir),`,
    `          mensaje: mensajeFalloSnapshot(e, true, motivoNoEscribir),`],

  ['el aviso deja de recibir la razón y manda a reintentar contra el candado',
    `          mensaje: mensajeFalloSnapshot(e, quedo.captura, motivoNoEscribir),`,
    `          mensaje: mensajeFalloSnapshot(e, quedo.captura),`],

  ['una obra archivada deja de tener razón: vuelven los botones',
    `  if (estado !== 'cerrada' && estado !== 'archivada') return null;`,
    `  if (estado !== 'cerrada') return null;`],

  ['el candado se contagia a las pausadas, que sí se capturan',
    `  if (estado !== 'cerrada' && estado !== 'archivada') return null;`,
    `  if (estado === 'activa') return null;`],

  ['la razón deja de decir cómo se sale: queda el callejón',
    `  return \`\${quees}\${desde}: no admite capturas ni cierres de semana. \${comoSeAbre}\`;`,
    `  return \`\${quees}\${desde}: no admite capturas ni cierres de semana.\`;`],

  ['reabrir y reactivar se confunden en una sola frase',
    `  const comoSeAbre = estado === 'cerrada'
    ? 'Para volver a capturar contra ella hay que reabrirla desde el listado de obras, y eso queda registrado.'
    : 'Para volver a capturar contra ella hay que reactivarla desde el listado de obras.';`,
    `  const comoSeAbre = 'Para volver a capturar contra ella hay que reactivarla desde el listado de obras.';`],

  ['la salida temprana se va y los botones se pintan sobre la obra cerrada',
    `  if (motivoNoEscribir) return (`,
    `  if (false) return (`],

  ['en lugar de la razón se pinta una frase genérica que no dice nada',
    `      <div style={{fontSize:11,lineHeight:1.5,color:C.textSec}}>{motivoNoEscribir}</div>`,
    `      <div style={{fontSize:11,lineHeight:1.5,color:C.textSec}}>No disponible</div>`],

  ['«Eliminar» vuelve a ofrecerse sobre una obra que la regla no deja borrar',
    `            {puedeEliminar&&!cerrada&&<button onClick={e=>{e.stopPropagation();iniciarEliminar(o);}}`,
    `            {puedeEliminar&&<button onClick={e=>{e.stopPropagation();iniciarEliminar(o);}}`],

  ['la captura vuelve a mirar sólo el rol: input de avance y «anular» sobre la obra cerrada',
    `  const editar=puedeCapturarElRol && !motivoParaNoEscribir(obra);`,
    `  const editar=puedeCapturarElRol;`],

  ['el aviso de solo-lectura vuelve a colgar de `editar` y acusa al rol de un permiso que tiene',
    `    {!puedeCapturarElRol&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
       Vista de solo lectura — tu rol no tiene permiso para editar este módulo.`,
    `    {!editar&&<div style={{background:"rgba(202,138,4,0.1)",border:"0.5px solid rgba(202,138,4,0.3)",
      borderRadius:8,padding:"8px 12px",fontSize:11,color:C.yellow}}>
       Vista de solo lectura — tu rol no tiene permiso para editar este módulo.`],

  ['el cuadro de fotos vuelve a recibir un no-op: ofrece subir y se traga la imagen',
    `                onAdd={editar ? (foto=>addFoto(s, foto)) : null}`,
    `                onAdd={editar ? (foto=>addFoto(s, foto)) : (()=>{})}`],

  ['el bloque del guardado se monta con `editar` y la pantalla cerrada se queda muda',
    `    {tab!=="nomina"&&puedeCapturarElRol&&<GuardarAvanceBtn`,
    `    {tab!=="nomina"&&editar&&<GuardarAvanceBtn`],

  ['el cuadro de subida deja de mirar si hay dónde poner la foto y vuelve a ofrecerse siempre',
    `  {onAdd
    ? <div className="fotodrop" style={{fontSize:9,padding:"5px 8px"}} onClick={()=>ref.current?.click()}>
        {fotos.length>0?\`\${fotos.length} foto(s)\`:"Agregar foto"}
      </div>
    : fotos.length>0 && <div style={{fontSize:9,padding:"5px 8px",color:C.textMut}}>{fotos.length} foto(s)</div>}
  {onAdd && <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>leer(e.target.files)}/>}`,
    `  <div className="fotodrop" style={{fontSize:9,padding:"5px 8px"}} onClick={()=>ref.current?.click()}>
     {fotos.length>0?\`\${fotos.length} foto(s)\`:"Agregar foto"}
  </div>
  <input ref={ref} type="file" accept="image/*" multiple style={{display:"none"}} onChange={e=>leer(e.target.files)}/>`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantalla-negado-'));
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

console.log('LA PANTALLA NO OFRECE NI AFIRMA LO QUE LA REGLA NIEGA');
const fallos = correr();
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) caídas.`);
  for (const f of fallos) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('\nverde: el candado del servidor se ve en la pantalla, y nadie promete lo que no guardó.\n');
process.exit(0);
