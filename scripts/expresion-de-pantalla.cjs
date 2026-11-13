// ── EJECUTAR LA EXPRESIÓN QUE UNA PANTALLA EVALÚA DE VERDAD ────────────────
//
// `extraer-de-app.cjs` saca símbolos de NIVEL SUPERIOR: una función, una
// constante, una clase. Eso sirve cuando la cuenta tiene nombre propio. Pero
// buena parte del dinero y de las fechas se calcula en un `const` DENTRO de un
// componente —`porCobrar`, `diasSinCaptura`, `totalEst`—, y esos no se pueden
// pedir por nombre: hay más de un `totalEst` en 24 000 renglones.
//
// Este módulo saca el TEXTO del inicializador de ese `const`, identificado por
// dueño y nombre, y lo EJECUTA con lo que el banco le dé de comer. Es lo que
// permite la única contraprueba que sirve para «una cuenta por número»: se
// inyecta la cuenta MUTADA y se exige que la pantalla se mueva. Una pantalla
// que no se mueve no está llamando a la cuenta única — trae su propia copia, y
// hoy coincide de casualidad.
//
// POR QUÉ ES UN MÓDULO Y NO ESTABA EN EL BANCO. Vivía dentro de
// `prueba-una-cuenta-por-numero.cjs`, y el segundo banco que lo necesitó
// —`prueba-el-dinero-de-una-estimacion.cjs`— iba a tener que copiarlo: cien
// renglones de resolución de dependencias locales, duplicados. Las copias se
// desincronizan, y ya hay un precedente exacto en este repositorio: las listas
// de dependencias tecleadas a mano que `extraer-de-app.cjs` existe para no
// mantener. Este andamiaje es del mismo tipo.
//
// LO QUE NO HACE, y es deliberado: cuando una expresión necesita algo que el
// banco no sabe fabricar, no devuelve un número incompleto. Llama a
// `sinPrecondicion` —NO ARRANCÓ (2)— porque un número salido de un sandbox al
// que le falta un insumo no es el número de la pantalla, y publicarlo en verde
// sería peor que no medirlo.

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;
const { sinPrecondicion } = require('./no-arranco.cjs');

// Lo que pone el motor. Generoso a propósito: un falso global aquí sólo provoca
// un `is not defined` al ejecutar —ruidoso, con renglón— mientras que darlo por
// faltante pararía la medición por un nombre que ninguna rama usa.
const GLOBALES = new Set(['Array', 'Object', 'Math', 'JSON', 'Date', 'Number',
  'String', 'Boolean', 'Set', 'Map', 'isNaN', 'parseFloat', 'parseInt',
  'undefined', 'NaN', 'Infinity', 'console']);

// Los nombres que un nodo ATA él mismo. La `e` de un `filter(e => …)` es suya:
// pedirla al banco sería inventarle una carencia.
const atados = (n, dentro) => {
  const anotar = (pat) => {
    if (!pat) return;
    if (pat.type === 'Identifier') dentro.add(pat.name);
    else if (pat.type === 'ObjectPattern') pat.properties.forEach(q => anotar(q.value || q.argument));
    else if (pat.type === 'ArrayPattern') pat.elements.forEach(anotar);
    else if (pat.type === 'AssignmentPattern') anotar(pat.left);
    else if (pat.type === 'RestElement') anotar(pat.argument);
  };
  if (Array.isArray(n.params)) n.params.forEach(anotar);
  if (n.type === 'VariableDeclarator') anotar(n.id);
  if (n.type === 'CatchClause') anotar(n.param);
  // Un BLOQUE ata todo lo que declara, y lo ata para TODOS sus hermanos. Sin
  // esto, `{const m = …, a = m * 2;}` denunciaba `m` como un insumo que falta:
  // el declarador de `a` lo nombra y el de `m` es su hermano, no su ancestro.
  // Eso no daba un rojo, daba un NO ARRANCÓ —peor— y apareció el 2026-11-13 en
  // cuanto las deducciones de una estimación pasaron a leer el monto una sola
  // vez en un `const` compartido.
  if (n.type === 'BlockStatement' || n.type === 'Program') {
    for (const s of (n.body || [])) {
      if (s.type === 'VariableDeclaration') s.declarations.forEach(d => anotar(d.id));
      else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') anotar(s.id);
    }
  }
};

// Los nombres que una expresión toma de FUERA.
const deFuera = (raizNodo) => {
  const fuera = new Set();
  const visitar = (n, padre, ligados) => {
    if (!n || typeof n.type !== 'string') return;
    const propios = new Set(ligados);
    atados(n, propios);
    if (n.type === 'Identifier') {
      const esMiembro = padre && (padre.type === 'MemberExpression' ||
                                  padre.type === 'OptionalMemberExpression');
      if (esMiembro && padre.property === n && !padre.computed) return;
      if (padre && padre.type === 'ObjectProperty' && padre.key === n && !padre.computed) return;
      if (!ligados.has(n.name)) fuera.add(n.name);
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && visitar(c, n, propios));
      else if (v && typeof v.type === 'string') visitar(v, n, propios);
    }
  };
  visitar(raizNodo, null, new Set());
  return fuera;
};

// El nombre de la función que contiene un nodo, saltándose las anónimas.
const nombreDeFuncionQueContiene = (p) => {
  let q = p.parentPath;
  while (q) {
    if (q.isFunction()) {
      const n = q.node.id?.name
        || (q.parentPath?.isVariableDeclarator() ? q.parentPath.node.id?.name : null);
      if (n) return n;
    }
    q = q.parentPath;
  }
  return null;
};

// Pide las expresiones de un archivo. `quiero` es una lista de
// `{ dueño, nombre, etiqueta }`: el dueño es la función que las contiene —hace
// falta porque el nombre solo no distingue— y la etiqueta es cómo se llama ese
// número en la pantalla, para que un NO ARRANCÓ diga qué dejó de medirse.
//
// `queFalta` / `comoConseguirlo` son lo que se publica si alguna expresión no
// está: el banco sabe mejor que este módulo qué quiere decir que falte.
function pantallasDe(archivo, quiero, { queFalta, comoConseguirlo } = {}) {
  const src = fs.readFileSync(archivo, 'utf8');
  const ast = parse(src, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining',
      'nullishCoalescingOperator', 'dynamicImport'],
  });
  const texto = n => src.slice(n.start, n.end);

  const dueños = [...new Set(quiero.map(q => q.dueño))];
  const expr = {};
  // Todos los `const` de cada dueño, para poder resolver lo que su expresión
  // mencione. Sin esto una COPIA no se podría ejecutar —habla de sus propias
  // variables locales— y el banco saldría NO ARRANCÓ culpando al andamiaje
  // justo cuando acaba de aparecer el defecto que busca. Una copia tiene que
  // poder correr para que se pueda demostrar que es una copia.
  const locales = {};
  traverse(ast, {
    VariableDeclarator(p) {
      const n = p.node.id?.name;
      if (!n || !p.node.init) return;
      // El dueño es la función CON NOMBRE que contiene el `const`, y se llega a
      // ella SALTÁNDOSE las anónimas. Eso no es un detalle: la mitad de estas
      // cuentas vive dentro de un `.map(o => …)` —la fila de una tabla—, y
      // pararse en el primer arrow dejaría sin dueño justo a las que más
      // importan. Sirven las dos formas de nombrar una pantalla:
      // `function Estimaciones(){}` y `const Estimaciones = () => {}`.
      const dueño = nombreDeFuncionQueContiene(p);
      if (!dueño || !dueños.includes(dueño)) return;
      (locales[dueño] ||= new Map());
      if (!locales[dueño].has(n)) locales[dueño].set(n, p.node.init);
      for (const q of quiero) {
        if (q.dueño !== dueño || q.nombre !== n) continue;
        expr[`${dueño}.${n}`] ||= texto(p.node.init);
      }
    },
  });

  const sinExpr = quiero.filter(q => !expr[`${q.dueño}.${q.nombre}`]);
  if (sinExpr.length)
    sinPrecondicion(
      queFalta
        ? queFalta(sinExpr)
        : `no encontré ${sinExpr.map(q => `\`${q.dueño}.${q.nombre}\``).join(', ')}`,
      comoConseguirlo || [
        'La pantalla cambió de forma: o el `const` se llama de otro modo, o el',
        'número ya no se calcula en un `const` de primer nivel. Lo que esta',
        'prueba mediría es una pantalla que ya no existe, así que no mide nada.',
        'Hay que apuntar la extracción al lugar nuevo antes de creerle al verde.']);

  // Ejecuta una expresión con el entorno dado, resolviendo en cadena lo que
  // mencione y no esté: se busca entre los `const` de SU dueño, y así hacia
  // atrás. Lo que no se pueda resolver es NO ARRANCÓ, no un número a medias.
  const corre = (dueño, nombre, entorno, etiqueta = `${dueño}.${nombre}`) => {
    const t = expr[`${dueño}.${nombre}`];
    const mios = locales[dueño] || new Map();
    const prelud = [];
    const vistos = new Set([nombre]);
    const pendientes = [parse(`(${t})`).program.body[0].expression];
    const faltantes = new Set();
    while (pendientes.length) {
      for (const n of deFuera(pendientes.pop())) {
        if (GLOBALES.has(n) || n in entorno || vistos.has(n)) continue;
        vistos.add(n);
        if (!mios.has(n)) { faltantes.add(n); continue; }
        prelud.push(n);
        pendientes.push(mios.get(n));
      }
    }
    if (faltantes.size)
      sinPrecondicion(
        `la cuenta de ${etiqueta} ya necesita \`${[...faltantes].join('`, `')}\`, ` +
        'que esta prueba no sabe fabricar',
        ['La expresión dejó de depender sólo de lo que el banco le da de comer.',
         'Lo que saldría de este sandbox no es el número de la pantalla. Hay que',
         'llevar la comprobación al preview, o darle el insumo que pide.']);
    // Por posición en el archivo: un `const` no puede usar a otro posterior.
    const orden = [...new Set(prelud)].sort((a, b) => mios.get(a).start - mios.get(b).start);
    const cuerpo = orden.map(n => `  const ${n} = ${texto(mios.get(n))};`).join('\n');
    const nombres = Object.keys(entorno);
    return new Function(...nombres,
      `"use strict";\n${cuerpo}\n  return (${t});`)(...nombres.map(n => entorno[n]));
  };

  return { expr, corre, locales, ast, src, texto };
}

module.exports = { pantallasDe, GLOBALES, deFuera, atados };
