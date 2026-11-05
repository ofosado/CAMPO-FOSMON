#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL TALLER: EJECUTAR UN TROZO DE `App.jsx` FUERA DE REACT
// ════════════════════════════════════════════════════════════════════════════
//
// Esto NO es un banco: es la herramienta con la que varios bancos ejercitan
// código que el portón (`extraer-de-app.cjs`) no alcanza.
//
// El portón resuelve símbolos de NIVEL SUPERIOR a partir del archivo en disco,
// y con eso basta para la mayoría. Dos cosas se le salen:
//
//   · El prólogo de cálculo de DENTRO de un componente. No es un símbolo que se
//     pueda pedir: es el tramo de sentencias antes del primer `return`, y hay
//     que cortarlo por AST y correrlo con los hooks doblados.
//   · `generarPDFObra`, que es una `async function` de dos mil líneas cuyo
//     `return` viene al final. Lo que se afirma del PDF son las CADENAS que
//     salen al papel, así que hay que dejarlo dibujar entero.
//
// Y una tercera razón, la que justifica que esto sea un módulo y no otra copia
// pegada en cada banco: `taller` recibe el CÓDIGO COMO TEXTO, no la ruta. Eso
// es lo que permite que una contraprueba mute la fuente y vuelva a correr en el
// MISMO proceso, sin archivos temporales.
//
// Estaba escrito dentro de `prueba-el-numero-con-su-calificativo.cjs`. Salió
// aquí cuando un segundo banco lo necesitó: dos talleres se habrían separado al
// primer cambio, y un banco que mide con un taller viejo sale verde por el
// motivo equivocado. La regla que aplica es la misma que persigue la rama que
// lo movió — una cuenta por número, un taller por repositorio.
//
// REGLA DE ORO, heredada y no negociable: **se dobla el hook, nunca la cuenta.**
// Lo que entra por el preludio queda fuera de `libres`, así que ningún doble lo
// puede tapar. Si una cuenta bajo examen apareciera en `STUBS`, el banco se
// estaría examinando a sí mismo.

'use strict';

const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

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

// El código sin su prosa. Se borran los comentarios dejando los huecos, para
// que ningún barrido de molde confunda una explicación con un defecto.
const sinComentarios = (src) => {
  const a = parse(src, OPTS);
  let out = src;
  [...(a.comments || [])].sort((x, y) => y.start - x.start)
    .forEach(c => { out = out.slice(0, c.start) + ' ' + out.slice(c.end); });
  return out;
};

// ── El taller ──────────────────────────────────────────────────────────────
// Recibe el CÓDIGO como texto —no el archivo— para que la contraprueba pueda
// mutarlo y volver a correr en el mismo proceso.
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

  // `omitir` saca un símbolo del preludio para que caiga en `libres` y se
  // pueda doblar. Hace falta para los hooks que hablan con Firestore: el
  // prólogo de `Dashboard` llama a `useProgramaDeObra`, y arrastrarlo tal cual
  // trae `initializeApp` detrás. Se dobla el hook, nunca la cuenta.
  const preludioPara = (src, omitir = new Set()) => {
    const necesarios = new Set();
    const pendientes = libresDe(src);
    while (pendientes.length) {
      const n = pendientes.pop();
      if (necesarios.has(n) || !porNombre.has(n) || omitir.has(n)) continue;
      necesarios.add(n);
      libresDe(porNombre.get(n).fuente).forEach(m => {
        if (m !== n && !necesarios.has(m) && !omitir.has(m)) pendientes.push(m);
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
    C: new Proxy({}, { get: () => '#000000' }),
    Card: () => null, Tit: () => null, Btn: () => null, Chip: () => null,
    React: {},
  });

  function correr(nombre, props, omitir = []) {
    if (!comps[nombre]) throw new Error(`no se encontró \`${nombre}\` — ¿se renombró?`);
    const fuera = new Set(omitir);
    const cuerpo = comps[nombre].body.body;
    const corte = cuerpo.findIndex(s => s.type === 'ReturnStatement');
    const hasta = corte === -1 ? cuerpo.length : corte;
    if (hasta === 0) throw new Error(`\`${nombre}\` no tiene prólogo de cálculo`);
    const prologo = sinJSX(codigo.slice(cuerpo[0].start, cuerpo[hasta - 1].end));
    const preludio = preludioPara(prologo, fuera);
    const declarados = [];
    {
      const a = parse(prologo, { ...OPTS, allowReturnOutsideFunction: true });
      traverse(a, {
        Program(p) { declarados.push(...Object.keys(p.scope.bindings)); p.stop(); },
      });
    }
    const libres = libresDe(`${preludio}\n${prologo}`)
      .filter(n => !porNombre.has(n) || fuera.has(n));
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

  // El cuerpo de un componente en texto, para las guardas de molde: la
  // pantalla no puede volver a resolver por su cuenta lo que ya trae resuelto.
  function cuerpoDe(nombre) {
    if (!comps[nombre]) throw new Error(`no se encontró \`${nombre}\``);
    return codigo.slice(comps[nombre].start, comps[nombre].end);
  }

  // Como `cuenta`, pero para lo declarado con `function`. Hace falta porque
  // `generarPDFObra` es una `async function` de nivel superior y no se puede
  // ejercitar con `correr`: `correr` corta en el primer `return`, y el del PDF
  // viene al final, después de las dos mil líneas que dibujan el documento. Y
  // dibujarlas es justo lo que hay que ejercitar: lo que se afirma son las
  // CADENAS que salen al papel que se entrega.
  //
  // Se midió antes de escribirlo: las quince dependencias de `generarPDFObra`
  // —`estadoGastoGP`, `MXN`, `MXNS`, `desgloseEjecutado`, …— son todas consts
  // de nivel superior, así que `preludioPara` las trae enteras y NINGUNA se
  // dobla. Lo único que se dobla es el papel.
  // `entornoExtra` es por donde entra el navegador de mentira. No vale ponerlo
  // en `globalThis`: los identificadores libres del trozo —`window`,
  // `document`, `alert`— se vuelven PARÁMETROS del `new Function`, así que
  // tapan al global y llegan en `undefined` por mucho que se haya asignado
  // fuera. Se intentó así primero y el resultado fue el peor posible: el
  // generador reventaba con un `Cannot read properties of undefined (reading
  // 'jspdf')`, la promesa quedaba colgada y Node salía con CERO. Un banco en
  // verde con el papel en blanco.
  function funcion(nombre, entornoExtra = {}) {
    if (!comps[nombre]) throw new Error(`no se encontró \`${nombre}\` — ¿se renombró?`);
    const fuente = codigo.slice(comps[nombre].start, comps[nombre].end);
    const preludio = preludioPara(fuente);
    const libres = libresDe(`${preludio}\n${fuente}`).filter(n => !porNombre.has(n));
    const entorno = { ...STUBS(), ...entornoExtra };
    const sinDoble = libres.filter(n => !(n in entorno));
    if (sinDoble.length) {
      throw new Error(`\`${nombre}\` usa ${sinDoble.map(n => `\`${n}\``).join(', ')} `
        + 'y nadie los dobla: llegarían en `undefined` y el trozo reventaría a '
        + 'media corrida');
    }
    return new Function(...libres, `${preludio}\n${fuente}\n;return ${nombre};`)(
      ...libres.map(k => entorno[k]));
  }

  return { correr, cuenta, cuerpoDe, funcion };
}

// ── El papel ───────────────────────────────────────────────────────────────
// Un jsPDF de mentira que no dibuja nada: APUNTA cada cadena que se le manda
// al papel, y las filas de cada tabla con el estilo que `didParseCell` les
// acabó poniendo. Ese estilo es el veredicto —el color de la celda del margen
// ES la afirmación— así que el doble lo ejecuta en vez de ignorarlo.
//
// Lo que NO hace: medir texto de verdad, paginar, ni comprobar que algo quepa.
// Estas pruebas no afirman nada sobre el dibujo; afirman lo que el documento
// DICE.
function papelDeMentira() {
  const textos = [];
  const celdas = [];
  const doc = {};
  const igual = () => doc;
  const planaDe = (c) => (c && typeof c === 'object' && 'content' in c)
    ? String(c.content) : String(c);
  Object.assign(doc, {
    text(t) { [].concat(t).forEach(s => textos.push(String(s))); return doc; },
    splitTextToSize: (t) => [String(t)],
    getTextWidth: (t) => String(t).length * 1.6,
    autoTable(cfg) {
      const filas = (cfg.body || []).map(f => [].concat(f).map(planaDe));
      filas.forEach(f => f.forEach(c => textos.push(c)));
      if (cfg.didParseCell) {
        filas.forEach((f, fi) => f.forEach((c, ci) => {
          const cell = { styles: {}, text: [c] };
          cfg.didParseCell({ row: { index: fi }, column: { index: ci },
                             cell, section: 'body' });
          celdas.push({ fila: f, col: ci, texto: c, estilos: cell.styles });
        }));
      }
      doc.lastAutoTable = { finalY: 60 };
      return doc;
    },
    internal: { getNumberOfPages: () => 1 },
    save(nombre) { doc.guardado = nombre; return doc; },
    lastAutoTable: { finalY: 60 },
    addPage: igual, setPage: igual, rect: igual, line: igual, circle: igual,
    triangle: igual, lines: igual, addImage: igual, setFont: igual,
    setFontSize: igual, setTextColor: igual, setFillColor: igual,
    setDrawColor: igual, setLineWidth: igual, setLineDashPattern: igual,
  });
  return { doc, textos, celdas };
}

// Correr el generador del PDF con el papel de mentira puesto. Devuelve lo que
// el documento dijo.
//
// El `catch` de `generarPDFObra` se COME cualquier excepción —`console.error` y
// un `alert`— así que si no se interceptara, un generador roto daría la prueba
// en verde con el papel en blanco. Por eso `alert` vuelve a lanzar: un PDF que
// no se pudo armar sale por la puerta del 2, no por la del 0.
async function alPapel(funcion, props) {
  const papel = papelDeMentira();
  const falla = [];
  const generar = funcion('generarPDFObra', {
    // El jsPDF ya está «cargado», así que las dos esperas de CDN pasan de
    // largo. Si algún día dejan de pasar de largo, `document.createElement`
    // devuelve un objeto cuyo `onload` nadie llama: la promesa se queda
    // colgada y Node sale con 0 — por eso cada banco mide el reloj.
    window: { jspdf: { jsPDF: function () { return papel.doc; } }, _atLoaded: true },
    document: { createElement: () => ({}), head: { appendChild() {} } },
    alert: (m) => { falla.push(String(m)); },
    setTimeout,
    // Estas pruebas no tocan red. Si el generador intenta bajar una foto, que
    // lo diga en voz alta en vez de esperar ocho segundos a su propio
    // `timeout`.
    fetch: () => { throw new Error('el PDF pidió red: esta prueba no la tiene'); },
    FileReader: function FileReader() {},
    EMB_WHITE: undefined, EMB_NEGRO: undefined,
  });
  await generar(
    props.obra, props.subs, props.estimaciones, props.maquinaria,
    props.materiales, props.subcontratos, {}, props.historialAvance,
    props.gpData, props.otrosGastos, null, props.nominaHistorial,
    props.evidencia, props.programa ?? null);
  if (falla.length) throw new Error(`generarPDFObra reventó: ${falla[0]}`);
  if (!papel.doc.guardado) {
    throw new Error('generarPDFObra terminó sin guardar nada: no llegó al final');
  }
  return papel;
}

module.exports = {
  taller, papelDeMentira, alPapel,
  libresDe, sinJSX, sinComentarios, OPTS, BUILTINS,
};
