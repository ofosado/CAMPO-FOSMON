#!/usr/bin/env node
// EL ESTADO NO VA SOLO EN COLOR
//
// POR QUÉ ESTE BANCO. Una pantalla que distingue dos hechos cambiando un tono
// no se los dice a quien no distingue ese par de tonos —y tampoco a quien
// imprime el expediente en blanco y negro, que es como viaja a una sesión de
// cabildo—. Lo que para el que lo escribió es «obvio, está en rojo» es, para
// el que lo lee, una pantalla que no dice nada. El renglón #36 de PENDIENTES
// lo pedía así: «el estado no puede ir sólo en color».
//
// Ese renglón venía con una premisa que se midió y es FALSA: decía que el
// naranja de la marca choca con el naranja de estado. `#FF6B35` sólo aparece
// una vez en el repo, en la paleta del PDF (`andamioDeCotea`), que no toca la
// pantalla. El choque no existe. Lo que sí existía, y es lo que este banco
// vigila, son dos cosas medidas:
//
//   1. EL RIEL PINTABA IGUAL «no se cerró» Y «no sé si se cerró». Las dos
//      salían de `cierre: null` y las dos daban la misma barra apagada. La
//      primera afirma algo de la obra; la segunda no afirma nada. Al
//      contratista y al cliente —a quienes la regla les niega
//      `avance/historial`— el riel les decía «sólo fotos, sin cierre» de
//      semanas que sí estaban cerradas. Dos hechos distintos con el mismo
//      pixel y el mismo nombre accesible.
//
//   2. DOS INSIGNIAS DEL MISMO RENGLÓN SE DISTINGUÍAN SÓLO POR EL TONO. En el
//      capturador de avance, un concepto pintaba «3» en morado (fotos) y
//      «117%» en ámbar (lo ejecutado por encima del catálogo). Sin los tonos
//      el renglón decía «1.1 · Terracerías · 3 · 117%». Lo mismo en la lista
//      de partidas con evidencia: un número pelado al lado de otro que sí
//      traía su unidad («5 sems»).
//
// QUÉ AFIRMA, Y CÓMO. Conducta, no símbolos. Saca del archivo la cuenta del
// riel, la marca del riel ENTERA —el `marcas.map` tal como está, con su
// `aria-label`— y las insignias, las EJECUTA, y afirma sobre lo que sale
// pintado. En particular:
//
//   · ninguna pareja de estados del riel se pinta Y se lee igual;
//   · entre «no cerrada» y «no se sabe» la diferencia SOBREVIVE a borrar
//     todos los colores: está en la forma, no en el tono;
//   · ningún nombre accesible lleva un «undefined» —un estado nuevo sin
//     palabra se delata— ni afirma sobre el cierre que no se leyó;
//   · la pantalla le DICE al riel si pudo leer el cierre, y sólo le dice que
//     sí cuando de verdad lo leyó;
//   · ninguna insignia que cuenta fotos o mide el excedente pinta un número
//     pelado: todas llevan su sustantivo.
//
// Uso:  node scripts/prueba-el-estado-no-va-solo-en-color.cjs
//       node scripts/prueba-el-estado-no-va-solo-en-color.cjs --contraprueba
//       ARCHIVO_APP=/tmp/otro.jsx node scripts/prueba-el-estado-no-va-solo-en-color.cjs
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const { fuenteDe, cierreDe, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

const muere = (...lineas) => {
  console.error(`\nNO ARRANCÓ: ${lineas[0]}`);
  for (const l of lineas.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

const callado = !!process.env.CALLADO;
const fallos = [];
const check = (ok, m, detalle = '') => {
  if (!ok) fallos.push(m);
  if (!callado || !ok)
    console.log(`   ${ok ? '✓' : '✗'} ${m}${detalle ? `  ·  ${detalle}` : ''}`);
};
const titulo = (t) => { if (!callado) console.log(`\n${t}`); };

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
const PEDIDOS = ['rielDeSemanas', 'marcaCerrada', 'marcaCierreNoLeido',
  'MARCA_CERRADA', 'MARCA_SIN_COMPARAR', 'MARCA_SOLO_FOTOS', 'MARCA_SIN_DATO',
  'MARCA_NO_LEIDO', 'HIST_SIN_LEER', 'HIST_LEIDO', 'HIST_NO_SE_PUDO',
  'HIST_NO_VISIBLE', 'etiquetaSemanaRiel', 'NOTA_FALTA', 'C', 'snapshotId'];
const APP = (() => {
  const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
  // Un nombre ausente NO revienta el banco: queda `undefined` y la aserción
  // que lo use se cae en ROJO, que es lo que tiene que pasar al correrlo
  // contra el archivo de antes del arreglo.
  if (!callado && faltan.length)
    console.log(`   (no están en el archivo: ${faltan.join(', ')})`);
  return new Function(`"use strict";\n${cuerpo}\nreturn { ${
    PEDIDOS.filter(n => !faltan.includes(n)).join(', ')} };`)();
})();
const { rielDeSemanas, marcaCierreNoLeido, MARCA_CERRADA, MARCA_SIN_COMPARAR,
  MARCA_SOLO_FOTOS, MARCA_SIN_DATO, MARCA_NO_LEIDO,
  HIST_SIN_LEER, HIST_LEIDO, HIST_NO_SE_PUDO, HIST_NO_VISIBLE, C } = APP;

// Los estados del riel tienen que ser valores DISTINTOS. Si dos colapsan —un
// copiar y pegar basta— las aserciones de abajo siguen pasando mientras la
// pantalla ya no distingue dos hechos: el banco dejó de medir. Eso no es rojo.
{
  const vs = [MARCA_CERRADA, MARCA_SIN_COMPARAR, MARCA_SOLO_FOTOS,
    MARCA_SIN_DATO, MARCA_NO_LEIDO].filter(v => v !== undefined);
  if (vs.length && new Set(vs).size !== vs.length)
    muere(`los estados de la marca no son valores distintos: ${vs.join(', ')}`,
      'Con dos colapsados este banco mediría un estado creyendo medir dos.');
}

// ── EL SITIO QUE PINTA UNA MARCA, SACADO DEL JSX ───────────────────────────
// Se extrae la flecha completa de `marcas.map(...)`: el `aria-label` y las
// barras son el MISMO sitio, y medirlos por separado permitiría que el nombre
// accesible dijera una cosa y el pixel otra.
//
// El anclaje es la llamada a `.map` sobre `marcas`. No es el nombre de una
// función ni un comentario: es la única forma que tiene la pantalla de pintar
// una marca por semana, y sobrevive a todas las mutaciones de abajo —que es
// el requisito de un anclaje: si la mutación lo destruye, el banco sale 2 y
// no mide nada.
const fuenteMarca = (() => {
  const hallados = [];
  traverse(ast, {
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type !== 'MemberExpression') return;
      if (c.property.name !== 'map' || c.object.name !== 'marcas') return;
      if (p.node.arguments.length !== 1) return;
      // Hay otro `marcas.map` que sólo saca las claves. El que pinta es el que
      // devuelve JSX.
      let pinta = false;
      p.get('arguments.0').traverse({ JSXElement() { pinta = true; } });
      if (!pinta) return;
      hallados.push(src.slice(p.node.arguments[0].start, p.node.arguments[0].end));
    },
  });
  if (hallados.length !== 1)
    muere(`se esperaba un solo \`marcas.map(…)\` en ${path.basename(archivo)}; se hallaron ${hallados.length}`,
      'Ahí vive la marca del riel. Si se movió, hay que rehacer este banco contra',
      'el sitio nuevo, no borrarlo: el estado sigue sin poder ir sólo en color.');
  return hallados[0];
})();

// El diccionario de palabras de los estados vive DENTRO del componente, así
// que no se puede pedir por nombre. Se halla por lo que es: el objeto cuyas
// llaves son los estados de la marca. Así aguanta que lo renombren.
const diccionario = (() => {
  let hallado = null;
  traverse(ast, {
    ObjectExpression(p) {
      const llaves = p.node.properties.filter(pr => pr.computed
        && pr.key?.type === 'Identifier' && /^MARCA_/.test(pr.key.name));
      if (llaves.length < 3) return;
      const decl = p.findParent(q => q.isVariableDeclarator());
      if (!decl || decl.node.id.type !== 'Identifier') return;
      hallado = { nombre: decl.node.id.name, fuente: src.slice(p.node.start, p.node.end) };
    },
  });
  if (!hallado)
    muere('no se halló el diccionario que le pone palabra a cada estado de la marca',
      'Sin él, el estado del riel sólo existe como color y como pixel.');
  return hallado;
})();

// ── RENDERIZAR UNA MARCA ───────────────────────────────────────────────────
const compilar = (fuente) => esbuild.transformSync(`(${fuente})`, { loader: 'jsx' }).code;
const INYECTADOS = ['semActiva', 'refMarcas', 'setSemanaSel', 'conAño'];
const pintarMarca = (() => {
  // El cierre se pide para las DOS piezas a la vez —la marca y el diccionario
  // de palabras—, envueltas en una expresión que el analizador acepte: el
  // diccionario nombra los estados y la marca no, así que pedirlo sólo para la
  // marca dejaba el cuerpo sin ellos.
  const cuerpo = cierreDe(`[${fuenteMarca}, ${diccionario.fuente}]`,
    { archivo, excluir: [...INYECTADOS, diccionario.nombre] });
  const fn = new Function('React', ...INYECTADOS, `"use strict";
${cuerpo}
const ${diccionario.nombre} = ${diccionario.fuente};
return ${compilar(fuenteMarca)};`);
  return (m, act = false) => {
    const elemento = fn(React, act ? m.clave : '__otra__',
      { current: {} }, () => {}, false)(m);
    return renderToStaticMarkup(elemento);
  };
})();

const marcaDe = (estado, extra = {}) => ({
  clave: 'S41-2026', semana: 41, año: 2026, fotos: 0, nota: null,
  cierre: estado === MARCA_CERRADA ? { avancePonderado: 33 }
    : estado === MARCA_SIN_COMPARAR ? { avancePonderado: 33, sinDelta: 'x' } : null,
  estado, ...extra,
});
const ESTADOS = [
  ['cerrada', MARCA_CERRADA], ['cerrada sin comparar', MARCA_SIN_COMPARAR],
  ['sólo fotos', MARCA_SOLO_FOTOS], ['sin cierre ni fotos', MARCA_SIN_DATO],
  ['no se sabe si cerró', MARCA_NO_LEIDO],
];

// Lo pintado sin UN SOLO color. Se reemplaza cada valor de la paleta —y
// cualquier hexadecimal— por el mismo signo: lo que quede es lo que la marca
// dice sin contar con que el lector distinga tonos.
const COLORES = [...new Set(Object.values(C || {}).filter(v => typeof v === 'string'))]
  .sort((a, b) => b.length - a.length);
const sinColor = (txt) => {
  let t = txt;
  for (const c of COLORES) t = t.split(c).join('§');
  return t.replace(/#[0-9a-fA-F]{3,8}\b/g, '§')
    .replace(/rgba?\([^)]*\)/g, '§')
    .replace(/\btransparent\b/g, '§');
};
const estilosDe = (markup) =>
  (markup.match(/style="[^"]*"/g) || []).join(' | ');
const nombreAccesible = (markup) =>
  (markup.match(/aria-label="([^"]*)"/) || [])[1] || '';

// ── LAS INSIGNIAS QUE CUENTAN ALGO ─────────────────────────────────────────
// Se buscan por lo que CUENTAN, no por lo que dicen: la insignia de fotos es
// la que lee una cuenta de fotos, y la del excedente la que lee el porcentaje
// sobre catálogo. Anclarlas en la palabra «foto» sería anclarlas en el
// arreglo, y entonces la mutación que quita la palabra se llevaría el anclaje
// y el banco saldría 2 en vez de rojo.
const insignias = (() => {
  const fuera = [];
  traverse(ast, {
    JSXElement(p) {
      const n = p.node.openingElement.name;
      if (n.type !== 'JSXIdentifier' || n.name !== 'Bdg') return;
      if (!p.node.closingElement) return;
      const hijos = src.slice(p.node.openingElement.end, p.node.closingElement.start);
      const clase = /\bnF\b|\bnFotos\b|fotos\.length/.test(hijos) ? 'fotos'
        : /pctDerivado|pctSinTopar/.test(hijos) ? 'excedente' : null;
      if (clase) fuera.push({ clase, hijos, linea: p.node.loc.start.line });
    },
  });
  return fuera;
})();

// Dobles numéricos. Un identificador al que nadie le pide una propiedad se ata
// a un número de verdad —así React lo puede pintar—; uno al que se le pide
// `.fotos.length` se ata a un objeto que contesta números a cualquier
// profundidad. Nada de esto adivina: sale de leer el propio trozo.
const DOBLE = 117;
const objetoDoble = () => new Proxy({}, {
  get(_, k) {
    if (k === 'length') return DOBLE;
    if (k === 'toFixed') return (d) => Number(DOBLE).toFixed(d);
    if (k === 'size') return DOBLE;
    if (typeof k === 'symbol') return undefined;
    return objetoDoble();
  },
});
const pintarInsignia = (hijos) => {
  const fuente = `() => <>${hijos}</>`;
  const sub = parse(`(${fuente})`, { sourceType: 'module', plugins: ['jsx'] });
  const conPropiedad = new Set(), libres = new Set();
  traverse(sub, {
    Identifier(p) {
      if (!p.isReferencedIdentifier() || p.scope.hasBinding(p.node.name, true)) return;
      libres.add(p.node.name);
      if (p.parent.type === 'MemberExpression' && p.parent.object === p.node)
        conPropiedad.add(p.node.name);
    },
  });
  const nombres = [...libres];
  const valores = nombres.map(n => conPropiedad.has(n) ? objetoDoble() : DOBLE);
  const fn = new Function('React', ...nombres, `"use strict";\nreturn ${compilar(fuente)};`);
  return renderToStaticMarkup(React.createElement(fn(React, ...valores)));
};

// ── LO QUE SE AFIRMA ───────────────────────────────────────────────────────
const correr = () => {
  titulo('1. El riel no afirma que una semana no cerró cuando no pudo leer el cierre');
  // Las dos entradas son idénticas —historial vacío— y la única diferencia es
  // si la pantalla pudo leerlo. El defecto era que daban lo mismo.
  const fotos = ['S40-2026', 'S40-2026', 'S41-2026'];
  const legible = typeof rielDeSemanas === 'function'
    ? rielDeSemanas([], fotos, {}, true) : [];
  const noLegible = typeof rielDeSemanas === 'function'
    ? rielDeSemanas([], fotos, {}, false) : [];
  check(legible.length === 2 && noLegible.length === 2,
    'el eje es el mismo: no leer el cierre no borra semanas',
    `${legible.length} y ${noLegible.length} marca(s)`);
  check(legible.length > 0 && legible.every(m => m.estado === MARCA_SOLO_FOTOS),
    'leído y vacío: las semanas con foto se afirman sin cierre',
    legible.map(m => m.estado).join(', '));
  check(noLegible.length > 0 && noLegible.every(m => m.estado === MARCA_NO_LEIDO),
    'no leído: ninguna semana se afirma sin cierre',
    noLegible.map(m => m.estado).join(', '));
  check(noLegible.length > 0 && noLegible.every(m => marcaCierreNoLeido?.(m) === true)
    && legible.every(m => marcaCierreNoLeido?.(m) === false),
    'y la regla que decide la pintura lo distingue, no lo adivina de `cierre`');
  // Un cierre de verdad manda sobre todo: `cierreLegible` no puede volverse
  // una forma de esconder lo que sí se leyó. Van DOS cierres porque el primero
  // no tiene con qué comparar y sale `sinComparar` por derecho propio.
  const cierre = (s, a, av) => ({ id: `S${s}-${a}`, semana: s, año: a, tipo: 'oficial',
    esquema: 3, avancePonderado: av, montoEjecutado: av * 10000,
    fechaCierre: `${a}-10-10`, capturadoPor: 'residente@fosmon.com.mx' });
  const conCierre = typeof rielDeSemanas === 'function'
    ? rielDeSemanas([cierre(40, 2026, 28), cierre(41, 2026, 33)], [], {}, true) : [];
  check(conCierre.length === 2 && conCierre[1].estado === MARCA_CERRADA,
    'y el historial de verdad sigue dando semanas cerradas',
    conCierre.map(m => m.estado).join(', '));

  titulo('2. Ninguna pareja de estados se pinta y se lee igual');
  const pintado = new Map();
  for (const [nombre, estado] of ESTADOS) {
    if (estado === undefined) { check(false, `el estado «${nombre}» no existe en el archivo`); continue; }
    pintado.set(nombre, pintarMarca(marcaDe(estado)));
  }
  const nombres = [...pintado.keys()];
  for (let i = 0; i < nombres.length; i++)
    for (let j = i + 1; j < nombres.length; j++) {
      const a = nombres[i], b = nombres[j];
      check(pintado.get(a) !== pintado.get(b),
        `«${a}» y «${b}» no se ven iguales`);
    }

  titulo('3. Entre «no cerrada» y «no se sabe» la diferencia no es un tono');
  // Las dos son barras apagadas: entre ellas no hay grado, hay una frontera.
  // Si la única diferencia fuera el color, para quien no lo distingue serían
  // el mismo pixel — y una afirma algo de la obra que la otra no afirma.
  const apagadas = ['sin cierre ni fotos', 'no se sabe si cerró']
    .map(n => pintado.get(n)).filter(Boolean);
  check(COLORES.length > 5, 'la paleta se pudo leer para borrarle los colores',
    `${COLORES.length} color(es)`);
  if (apagadas.length === 2) {
    check(estilosDe(apagadas[0]) !== estilosDe(apagadas[1]),
      'las dos barras no llevan el mismo estilo');
    check(sinColor(estilosDe(apagadas[0])) !== sinColor(estilosDe(apagadas[1])),
      'y la diferencia sobrevive a borrar todos los colores: está en la forma',
      sinColor(estilosDe(apagadas[1])).slice(0, 110));
  } else {
    check(false, 'no se pudieron pintar las dos barras apagadas');
  }

  titulo('4. El nombre accesible dice el estado, y no afirma el que no leyó');
  for (const [nombre] of ESTADOS) {
    const markup = pintado.get(nombre);
    if (!markup) continue;
    const dice = nombreAccesible(markup);
    check(dice.length > 0 && !/undefined/.test(dice),
      `«${nombre}» se lee en voz alta con palabras`, dice);
  }
  const diceNoLeido = nombreAccesible(pintado.get('no se sabe si cerró') || '');
  check(!/sin cierre|no se cerr|cerrada/i.test(diceNoLeido),
    'el estado que no se leyó no afirma nada sobre el cierre', diceNoLeido);
  const dichos = [...pintado.values()].map(nombreAccesible);
  check(new Set(dichos).size === dichos.length,
    'y ningún par de estados se lee con la misma frase');

  titulo('5. La pantalla le dice al riel si de verdad pudo leer el cierre');
  // El cuarto argumento de la llamada. Sin él, el riel supone que sí —que es
  // lo correcto para quien le pasa un historial de verdad— y la pantalla del
  // contratista volvería a afirmar.
  const llamada = (() => {
    let hallada = null;
    traverse(ast, {
      CallExpression(p) {
        if (p.node.callee.name !== 'rielDeSemanas') return;
        hallada = p.node;
      },
    });
    return hallada;
  })();
  if (!llamada) {
    check(false, 'la pantalla no llama a la cuenta del riel');
  } else {
    const args = llamada.arguments;
    check(args.length >= 4,
      'la llamada declara si el cierre es legible', `${args.length} argumento(s)`);
    if (args.length >= 4) {
      const fuenteArg = src.slice(args[3].start, args[3].end);
      // Si el cuarto argumento es un nombre, lo que importa es su cuenta.
      const decidir = (() => {
        if (args[3].type !== 'Identifier') return fuenteArg;
        let fuente = null;
        traverse(ast, {
          VariableDeclarator(p) {
            if (p.node.id.name === fuenteArg && p.node.init && !fuente)
              fuente = src.slice(p.node.init.start, p.node.init.end);
          },
        });
        if (!fuente) muere(`el cuarto argumento es \`${fuenteArg}\` y no se halló su cuenta`);
        return fuente;
      })();
      const fn = new Function('historialEstado', 'HIST_SIN_LEER', 'HIST_LEIDO',
        'HIST_NO_SE_PUDO', 'HIST_NO_VISIBLE', `"use strict";\nreturn !!(${decidir});`);
      const dice = (e) => fn(e, HIST_SIN_LEER, HIST_LEIDO, HIST_NO_SE_PUDO, HIST_NO_VISIBLE);
      check(dice(HIST_LEIDO) === true,
        'con el historial leído, el riel puede afirmar');
      for (const [n, e] of [['sin leer', HIST_SIN_LEER], ['no se pudo', HIST_NO_SE_PUDO],
        ['no visible', HIST_NO_VISIBLE]])
        check(dice(e) === false, `con el historial «${n}», no`);
    }
  }

  titulo('6. Ninguna insignia que cuenta algo pinta un número pelado');
  const porClase = (c) => insignias.filter(i => i.clase === c);
  check(porClase('fotos').length >= 3,
    'se hallaron las insignias que cuentan fotos',
    `${porClase('fotos').length}`);
  check(porClase('excedente').length >= 2,
    'y las que miden lo ejecutado sobre el catálogo',
    `${porClase('excedente').length}`);
  if (insignias.length < 5)
    muere(`sólo se hallaron ${insignias.length} insignia(s) que cuentan`,
      'Este banco mediría casi nada. Si las insignias se movieron, hay que',
      'rehacerlo contra el sitio nuevo.');
  for (const ins of insignias) {
    let texto;
    try { texto = pintarInsignia(ins.hijos); }
    catch (e) {
      muere(`la insignia de la línea ${ins.linea} no se pudo pintar: ${e.message}`,
        `  fuente: ${ins.hijos.trim().slice(0, 120)}`);
    }
    const plano = texto.replace(/<[^>]*>/g, '').replace(/&#x27;|&quot;/g, '');
    check(/[a-záéíóúñ]/i.test(plano),
      `la insignia de ${ins.clase} (línea ${ins.linea}) dice su sustantivo`,
      `pinta «${plano}»`);
  }

  return fallos;
};

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
// Cada mutación es un retroceso PLAUSIBLE, y cada una tiene que salir en ROJO
// (1). Un 2 significaría que la mutación rompió el andamio del banco en vez de
// la semántica de la pantalla, y entonces el banco no estaría midiendo eso.
const MUTACIONES = [
  ['el riel vuelve a afirmar «sin cierre» cuando no pudo leer el cierre',
    `        : !cierreLegible ? MARCA_NO_LEIDO\n`, ''],

  ['la barra de «no se sabe» vuelve a ser la misma barra apagada de «no cerró»',
    `                    background:marcaCierreNoLeido(m) ? "transparent"
                      : marcaCerrada(m) ? C.green : C.borderM,
                    border:marcaCierreNoLeido(m) ? \`1px dashed \${C.borderM}\` : "none",
                    boxSizing:"border-box"}}/>`,
    `                    background:marcaCerrada(m)?C.green:C.borderM}}/>`],

  ['la distinción se queda en el tono: gris claro en vez de hueca',
    `                    background:marcaCierreNoLeido(m) ? "transparent"
                      : marcaCerrada(m) ? C.green : C.borderM,
                    border:marcaCierreNoLeido(m) ? \`1px dashed \${C.borderM}\` : "none",`,
    `                    background:marcaCierreNoLeido(m) ? C.border
                      : marcaCerrada(m) ? C.green : C.borderM,
                    border:"none",`],

  ['el estado nuevo se queda sin palabra en el nombre accesible',
    `    [MARCA_NO_LEIDO]:     "el cierre no se muestra",\n`, ''],

  ['la palabra del estado nuevo vuelve a afirmar sobre el cierre',
    `    [MARCA_NO_LEIDO]:     "el cierre no se muestra",`,
    `    [MARCA_NO_LEIDO]:     "sin cierre ni fotos",`],

  ['la pantalla deja de decirle al riel si pudo leer el cierre',
    `rielDeSemanas(historialAvance, todas.map(f => f.semana), notasSemana, cierreLegible)`,
    `rielDeSemanas(historialAvance, todas.map(f => f.semana), notasSemana)`],

  ['la pantalla le dice que sí siempre',
    `  const cierreLegible = historialEstado === HIST_LEIDO;`,
    `  const cierreLegible = true;`],

  ['la insignia de fotos del capturador vuelve al número pelado',
    `{nF>0&&<Bdg color={C.purple} small>{\`\${nF} foto\${nF===1?'':'s'}\`}</Bdg>}
                  {excedePresup && <Bdg color={C.yellow} small>{\`\${pctDerivado.toFixed(0)}% del catálogo\`}</Bdg>}`,
    `{nF>0&&<Bdg color={C.purple} small>{nF}</Bdg>}
                  {excedePresup && <Bdg color={C.yellow} small>{\`\${pctDerivado.toFixed(0)}%\`}</Bdg>}`],

  ['la insignia del concepto de la sub-obra vuelve al número pelado',
    `{nFotos > 0 && <Bdg color={C.purple} small>{\`\${nFotos} foto\${nFotos===1?'':'s'}\`}</Bdg>}`,
    `{nFotos > 0 && <Bdg color={C.purple} small>{nFotos}</Bdg>}`],

  ['la insignia de la lista de partidas vuelve al número pelado',
    `<Bdg color={C.blue} small>{p.fotos.length} foto{p.fotos.length===1?"":"s"}</Bdg>`,
    `<Bdg color={C.blue} small>{p.fotos.length}</Bdg>`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estado-color-'));
  let i = 0;
  for (const [t, de, a] of MUTACIONES) {
    if (!src.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${t}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 220)}`);
      process.exit(2);
    }
    const f = path.join(dir, `app-${i++}.jsx`);
    fs.writeFileSync(f, src.replace(de, a));
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f, CALLADO: '1' }, encoding: 'utf8' });
    if (r.status === 2) {
      console.error(`NO ARRANCÓ: «${t}» revienta el banco en vez de romper la semántica`);
      console.error([r.stdout, r.stderr].join('\n').split('\n')
        .filter(l => /NO ARRANCÓ|excepción|  /.test(l)).slice(0, 8).join('\n'));
      process.exit(2);
    }
    if (r.status === 0) {
      console.log(`   ✗ PASÓ  ${t}  ·  NADIE la detectó`);
      process.exit(1);
    }
    const caidas = Number((r.stderr.match(/ROJO: (\d+) aserción/) || [])[1]) || 0;
    console.log(`   ✓ ROJO  ${t}  ·  ${caidas || '≥1'} aserción(es) mordieron`);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.\n`);
  process.exit(0);
}

if (!callado) console.log('EL ESTADO NO VA SOLO EN COLOR');
correr();
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
if (!callado) console.log('\nverde');
process.exit(0);
