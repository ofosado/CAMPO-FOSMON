#!/usr/bin/env node
// Guarda de #57: ningún desplegable pinta un valor distinto del que está
// guardado.
//
// EL DEFECTO. `<select value="X">` cuando ninguna de sus `<option>` vale "X"
// no avisa de nada: el navegador pinta la PRIMERA. El dato guardado se lee
// entonces como otro —uno que nadie escribió— y en los formularios que mandan
// el campo entero al guardar, apretar «Guardar» lo escribe de verdad.
//
// Medido en el archivo el 2026-11-13: de los nueve `<Sel>` que leen dato
// guardado contra una lista, TRES llevaban guardia y SEIS no. El peor no era
// de pantalla: `ModalUsuario` siembra `form.rol` con `usuario?.rol`,
// `ROLES_CONSTRUCTORA` y `ROLES_DEPENDENCIA` no comparten ni un identificador,
// y `onConfirm` manda `{...form}` — así que abrir un usuario migrado de tipo de
// organización y apretar «Guardar» para reasignarle una obra le reescribía el
// rol al primero de la lista, que es mando. Los otros cinco: el concepto de
// materiales (donde «Anticipo» es la primera opción Y otra cuenta económica),
// el estado del subcontrato, la modalidad de adjudicación en sus dos pantallas,
// y el `gpId` de GP.
//
// POR QUÉ ES UN BARRIDO Y NO NUEVE ASERCIONES. «El patrón se arregla en todo
// el repo, no en el renglón que falló». Las tres guardias que ya existían se
// pusieron una por una, cada una con su `includes` tecleado, y el día que se
// escribió el cuarto desplegable nadie se acordó. Este banco no nombra los
// sitios: los BUSCA. Recorre el AST de `src/App.jsx`, se queda con cada `<Sel>`
// cuyo `value` venga de un campo guardado, lo RENDERIZA de verdad con
// `react-dom/server` y exige que un valor de fuera de la lista aparezca entre
// las opciones. Un desplegable nuevo escrito mañana cae solo.
//
// CÓMO SE DISCRIMINA, Y POR QUÉ NO SE SALTA NADA EN SILENCIO. Hay `<Sel>` que
// no aplican: el orden de una tabla, la semana que se mira, el tipo de
// organización en su alta. Su `value` es estado de pantalla, no un campo de un
// documento, y un valor de fuera no puede llegar ahí. La condición se decide
// por AST —el `value`, quitándole el `|| omisión`, es una lectura de propiedad,
// o un identificador local que a su vez lo es— y los descartados se IMPRIMEN
// con su renglón y su motivo. Un barrido que se calla lo que no midió es el P4
// por el lado que no avisa.
//
// La siembra va por NOMBRE de identificador, nunca por sitio: así un `<Sel>`
// nuevo que lea `obra` o `e` queda cubierto sin tocar este archivo, y uno que
// traiga una raíz de datos nueva sale NO ARRANCÓ con el nombre puesto. Es la
// misma elección que en `prueba-la-cantidad-se-ve-como-se-guardo`.
//
// Es P3: se ejecuta el desplegable del archivo. No se afirma que exista
// `opcionAjena` ni que nadie la llame.
//
// Uso:  node scripts/prueba-el-desplegable-no-disfraza-lo-guardado.cjs [App.jsx]
//
// El argumento corre la prueba contra una versión anterior para comprobar que
// ahí falla — una prueba que nunca ha fallado no prueba nada:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-el-desplegable-no-disfraza-lo-guardado.cjs /tmp/antes.jsx

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const { fuenteDe } = require('./extraer-de-app.cjs');

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m, detalle) => {
  const cola = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${cola}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${cola}`); }
};

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const lineaDe = i => src.slice(0, i).split('\n').length;

// ── 1. El barrido: todos los desplegables del archivo ──────────────────────
//
// Se recoge el elemento entero —no sólo el `value`— porque lo que se va a
// ejecutar es el desplegable completo: su valor y sus opciones juntos, que es
// lo único que decide si miente.
//
// Entran `<Sel>` y `<select>`. Buscar sólo `<Sel>` era creer que todos los
// desplegables pasan por el envoltorio, y no es verdad: hay seis `<select>`
// crudos en el archivo. Para el `<select>` no hace falta ni el doble de
// `Sel` — lo pinta React tal cual, que es mejor medición todavía.
const ETIQUETAS = ['Sel', 'select'];
const todos = [];
traverse(ast, {
  JSXElement(p) {
    const n = p.node.openingElement.name;
    if (n.type !== 'JSXIdentifier' || !ETIQUETAS.includes(n.name)) return;
    const attr = p.node.openingElement.attributes.find(a =>
      a.type === 'JSXAttribute' && a.name.name === 'value');
    todos.push({
      linea: lineaDe(p.node.start),
      fuente: src.slice(p.node.start, p.node.end),
      valor: attr && attr.value && attr.value.type === 'JSXExpressionContainer'
        ? attr.value.expression : null,
      // La ruta misma, para preguntarle a su ÁMBITO LÉXICO por los nombres que
      // el módulo no resuelve. No basta la función que lo envuelve: el
      // desplegable del estatus vive dentro de un `.map`, y su vocabulario
      // estaba declarado en el componente de afuera.
      ruta: p,
    });
  },
});

if (todos.length === 0) {
  noArranco(['ningún `<Sel>` ni `<select>` en el archivo'], ARCH_APP);
}

// ── 2. ¿Cuál lee un campo guardado? ────────────────────────────────────────
//
// El `value` de un desplegable que puede mentir es una LECTURA DE PROPIEDAD:
// `obra[key]`, `e.estatus`, `form.rol`. El de uno que no puede es estado de
// pantalla: `orden`, `semanaVer`, o una plantilla armada con él. Se le quita
// antes el `|| omisión`, que no cambia de dónde viene el dato.
const sinOmision = nodo => {
  let n = nodo;
  while (n && n.type === 'LogicalExpression' && (n.operator === '||' || n.operator === '??'))
    n = n.left;
  return n;
};

// Un alias local de un solo salto: `const cc = m.concepto || "En almacén"`.
// Sin esto, el desplegable del concepto de materiales —que es donde «Anticipo»
// se disfraza de otra cuenta— se habría descartado por leerse `cc` a secas.
//
// Devuelve la FUENTE del inicializador, no un sí o un no. Hace falta entera
// porque el `|| "En almacén"` es la respuesta del sitio al campo sin capturar:
// la primera versión de este banco sembraba `cc` con el valor de prueba y con
// eso borraba la omisión, de modo que la sección 4 acusaba al sitio de algo que
// no hace. El escenario no puede contestar por el código que mide.
// La fuente del `const` que declara `nombre` dentro de la función que envuelve
// al desplegable. Sirve para dos cosas distintas y es la misma búsqueda: el
// alias del valor, y cualquier VOCABULARIO que el componente se guarde para sí.
//
// Lo segundo hace falta porque un banco que sólo resuelve nombres del módulo
// cree saber dónde viven las listas, y eso no es verdad: `ESTATUS` vivía dentro
// de su componente, y contra esa versión del archivo este barrido salía 2 —«no
// supe sembrarle ESTATUS»— en vez de rojo. Un contraste que no pone la
// aserción en rojo no prueba nada, y la causa no era el defecto: era el banco
// suponiendo un lugar.
// Se resuelve por el ámbito léxico de Babel, no recorriendo la función que
// envuelve al desplegable: ésa fue la primera versión y no alcanzaba, porque el
// `<Sel>` del estatus está dentro de un `.map` y su lista se declaraba un
// nivel más arriba. Enumerar niveles es la misma clase de error que enumerar
// sitios. Lo que esté en el módulo se devuelve nulo a propósito: de eso se
// encarga `fuenteDe`, que es la única puerta al archivo.
const declaracionLocal = (nombre, ruta) => {
  if (!ruta) return null;
  const b = ruta.scope.getBinding(nombre);
  if (!b || b.path.type !== 'VariableDeclarator' || !b.path.node.init) return null;
  if (b.scope.block.type === 'Program') return null;
  return src.slice(b.path.node.init.start, b.path.node.init.end);
};

const exprDe = (fuente) =>
  parse(`const __a = (${fuente});`, OPTS).program.body[0].declarations[0].init;

// ── El CAMINO hasta el dato guardado, no la forma de la punta ───────────────
//
// Un valor llega al `value` por varios saltos: una local (`const cc =
// m.concepto`), un condicional (`v===null?"null":v`), una llamada a una función
// que lo resuelve (`claveAccion(valorActual(rol, mod))`). La primera versión de
// este banco clasificaba la PUNTA, y con eso dejaba fuera el desplegable de los
// permisos por rol —el único del archivo que además ESCRIBE lo que pinta—
// porque su punta es una llamada. Lo dejó escrito su propio preámbulo: decirle
// «estado de pantalla» a un documento guardado era una afirmación sin medir.
//
// Así que se recorre el camino. Lo que decide es si en algún salto hay la
// LECTURA de una propiedad: eso es un campo, venga de donde venga. Enumerar
// formas del lenguaje es la misma clase de error que enumerar sitios, y este
// banco ya la cometió dos veces.
//
// Devuelve `{campo:true}` o `{corte}` con el nodo donde se acabó el camino,
// que es lo que el informe imprime como motivo. La plantilla NO se recorre a
// propósito: lo que sale de un `${}` ya es texto armado, y un desplegable cuyo
// valor se arma con texto no puede comparar contra lo guardado ni queriendo.
const RECURSION = 16;
const lecturaDeCampo = (nodo, ruta, vistos = new Set(), hondo = 0) => {
  if (!nodo || hondo > RECURSION) return { corte: nodo };
  const porAhi = (lista) => {
    for (const r of lista) {
      const x = lecturaDeCampo(r, ruta, vistos, hondo + 1);
      if (x.campo) return x;
    }
    return null;
  };
  switch (nodo.type) {
    case 'MemberExpression': case 'OptionalMemberExpression':
      return { campo: true };
    case 'LogicalExpression':
      // El `|| omisión` no cambia de dónde viene el dato.
      return (nodo.operator === '||' || nodo.operator === '??')
        ? lecturaDeCampo(nodo.left, ruta, vistos, hondo + 1) : { corte: nodo };
    case 'ConditionalExpression':
      return porAhi([nodo.consequent, nodo.alternate]) || { corte: nodo };
    case 'Identifier': {
      if (vistos.has(nodo.name)) return { corte: nodo };
      vistos.add(nodo.name);
      const ini = declaracionLocal(nodo.name, ruta);
      if (!ini) return { corte: nodo };
      return lecturaDeCampo(exprDe(ini), ruta, vistos, hondo + 1);
    }
    case 'CallExpression': case 'OptionalCallExpression': {
      // Los dos lados de una llamada cuentan: lo que la función DEVUELVE y lo
      // que se le PASA. Sólo el primero dejaría fuera a un formateador de
      // módulo —`claveAccion(v)`— que es puro pasamanos; sólo el segundo
      // dejaría fuera a la función que va a leer el documento ella misma.
      const ramas = [...nodo.arguments];
      if (nodo.callee.type === 'Identifier' && !vistos.has(nodo.callee.name)) {
        vistos.add(nodo.callee.name);
        const ini = declaracionLocal(nodo.callee.name, ruta);
        if (ini) ramas.push(...devueltosDe(exprDe(ini)));
      }
      return porAhi(ramas) || { corte: nodo };
    }
    default:
      return { corte: nodo };
  }
};

// Las expresiones que una función devuelve. Cuerpo de expresión (`x => x.a`) y
// cuerpo de bloque con `return`, que son las dos formas que hay en el archivo.
const devueltosDe = (fn) => {
  if (!fn) return [];
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return [];
  if (fn.body.type !== 'BlockStatement') return [fn.body];
  const salidas = [];
  traverse(fn.body, {
    ReturnStatement(q) { if (q.node.argument) salidas.push(q.node.argument); },
    noScope: true,
  });
  return salidas;
};

const aliasDeCampo = (nombre, ruta) => {
  const fuente = declaracionLocal(nombre, ruta);
  if (!fuente) return null;
  const ini = sinOmision(exprDe(fuente));
  return (ini && (ini.type === 'MemberExpression' || ini.type === 'OptionalMemberExpression'))
    ? fuente : null;
};

// El motivo dice la forma que se encontró, no una sola frase para todo. La
// primera versión contestaba «es estado de pantalla» a cualquier cosa que no
// fuera una lectura de propiedad, y eso es una AFIRMACIÓN que el banco no había
// comprobado: el desplegable de los permisos por rol lee `valorActual(rol, mod)`
// —un documento guardado— y habría salido en el informe como estado de
// pantalla. Un barrido que se equivoca al decir por qué no midió algo es peor
// que uno que no lo dice.
const motivoDe = v => ({
  ConditionalExpression: 'su valor sale de un condicional, no de una lectura de campo',
  CallExpression: 'su valor sale de una llamada, no de una lectura de campo',
  TemplateLiteral: 'su valor se arma con una plantilla',
  Identifier: 'su valor es una local que no lee ningún campo guardado',
}[v.type] || `su valor no es una lectura de campo (${v.type})`);

const sitios = [], descartados = [];
for (const s of todos) {
  const v = sinOmision(s.valor);
  if (!v) { descartados.push({ ...s, motivo: 'no tiene `value`' }); continue; }
  if (v.type === 'MemberExpression' || v.type === 'OptionalMemberExpression') {
    sitios.push(s); continue;
  }
  // El alias de un salto se conserva como caso propio porque la siembra entra
  // por su RAÍZ y la omisión que el sitio le puso tiene que seguir corriendo.
  if (v.type === 'Identifier') {
    const ini = aliasDeCampo(v.name, s.ruta);
    if (ini) { sitios.push({ ...s, alias: v.name, aliasInit: ini }); continue; }
  }
  // Y si no es ninguno de los dos, se recorre el camino antes de darlo por
  // estado de pantalla.
  const camino = lecturaDeCampo(v, s.ruta);
  if (camino.campo) { sitios.push(s); continue; }
  descartados.push({ ...s, motivo: motivoDe(camino.corte || v) });
}

console.log(`\nArchivo: ${path.relative(raiz, ARCH_APP)}`);
console.log(`Desplegables en el archivo: ${todos.length}` +
  `  ·  leen un campo guardado: ${sitios.length}  ·  descartados: ${descartados.length}`);
// Lo descartado se dice, no se calla: un barrido que se guarda lo que no midió
// sale verde sin haber mirado.
for (const d of descartados)
  console.log(`   — App.jsx:${d.linea} no se mide: ${d.motivo}`);

if (sitios.length === 0) {
  noArranco(['ningún `<Sel>` cuyo valor venga de un campo guardado'], ARCH_APP);
}

// ── 3. La siembra, por nombre de identificador ─────────────────────────────
//
// `AJENO` es un valor que NINGUNA lista del archivo contiene: es el dato
// guardado que quedó fuera del catálogo. Lleva acento y espacio a propósito,
// para que un sitio que lo imprima sin escapar se note.
const AJENO = 'Vocablo ajeno ñ';
const PROPIA = '__propia__';

// Una raíz de datos: cualquier propiedad que se le lea devuelve el valor ajeno.
// Es lo que convierte `obra[key]`, `e.estatus` y `form.rol` en el mismo
// escenario sin tener que saber qué campo lee cada sitio.
//
// `salvo` existe porque una raíz no sólo lleva campos: el renglón del alta de
// obra guarda SU PROPIA lista en `c.opciones`, así que ese campo tiene que
// contestar una lista y no un valor.
const raizDeDatos = (devuelve = AJENO, salvo = {}) => new Proxy({}, {
  get: (_, prop) => (prop === Symbol.toPrimitive ? () => devuelve
    : (Object.prototype.hasOwnProperty.call(salvo, prop) ? salvo[prop] : devuelve)),
  has: () => true,
});

// Una raíz de DOS niveles. El documento de permisos por obra se guarda como
// `override[rol][modulo]`, así que el dato no está en la primera propiedad sino
// en la segunda. Con una raíz de un nivel, `override[rol][mod]` sale
// `undefined` y el sitio cae a su permiso por omisión: el banco mediría el
// DEFAULT en vez de lo guardado y saldría verde sin haber mirado el caso.
const raizAnidada = (devuelve = AJENO) => new Proxy({}, {
  get: () => raizDeDatos(devuelve),
  has: () => true,
});

// Las listas locales o que llegan por prop. No son el vocabulario de verdad y
// no hacen falta: lo que se mide es si el desplegable sabe representar un
// valor que no está entre las opciones QUE ÉL MISMO PINTA, y eso se lee del
// HTML. Las del módulo —`CPTS`, `ESTATUS`, `ESTADOS_SUBCONTRATO`— sí entran de
// verdad, por `fuenteDe`.
//
// Van en las DOS formas que hay en el archivo porque el sitio las pinta con su
// propio `.map`: `ROLES` saca la etiqueta del par y `opciones` imprime la
// cadena. Sembrar pares donde el sitio espera cadenas pintaría
// `value="__propia__,La propia"` y la sección 3 compararía contra basura.
const LISTA_PARES = [[PROPIA, 'La propia']];
const LISTA_CADENAS = [PROPIA];

// La siembra es FUNCIÓN del valor guardado, no un objeto que se muta entre
// secciones. El primer intento lo mutaba y lo restauraba, y al reconstruir las
// raíces perdía la excepción de `c.opciones`: el banco salía 2 en la sección 3
// después de haber salido verde en la 1. Un escenario que depende del orden en
// que se leen las secciones es un escenario que no se puede creer.
const siembraPara = (v) => ({
  // Raíces de datos: el documento que se está editando.
  obra: raizDeDatos(v), e: raizDeDatos(v), sub: raizDeDatos(v),
  form: raizDeDatos(v), m: raizDeDatos(v),
  c: raizDeDatos(v, { opciones: LISTA_CADENAS }),
  usuario: raizDeDatos(v),
  // El documento de permisos de la obra, con sus dos niveles.
  override: raizAnidada(v),
  gpData: { obras: { [PROPIA]: { id: PROPIA, nombre: 'La propia' } } },
  // Los alias locales NO se siembran: se declaran con su propia fuente en
  // `monta`, para que la omisión que el sitio les puso siga corriendo.
  // Listas que no viven en el módulo.
  ROLES: LISTA_PARES, opciones: LISTA_CADENAS, campos: [],
  // Lo que el renglón ya había desempacado.
  key: 'campoCualquiera', i: 0, editar: true,
  // El rol de quien mira y la fila que se está pintando. `rol` va crudo —y no
  // `puedeEditar` ya resuelto— para que la condición que decide si el
  // desplegable se habilita la siga calculando el código del archivo.
  rol: 'director_general', rolKey: 'superintendente',
  // Estado de guardado: una local de `useState` que ninguna siembra puede
  // reconstruir desde su declaración, porque ahí dice `useState(false)`.
  guardando: false, setValor: () => {},
  // Los `onChange` no se disparan en un render estático, pero tienen que
  // existir para que el JSX se monte.
  f: () => {}, onUpdate: () => {}, setForm: () => {}, setObra: () => {},
  setMateriales: () => {}, actualiza: () => {}, actualizarEstimacion: () => {},
  fsSet: async () => {}, ESTATUS_PAGADA: 'Pagada',
});
const NOMBRES_SIEMBRA = Object.keys(siembraPara(''));

// ── 4. Montar y renderizar cada desplegable ────────────────────────────────
//
// `Sel` se sustituye por un `<select>` pelón: lo que se mide son las OPCIONES,
// no los estilos. Se monta con `readOnly` porque React protesta de un `value`
// sin `onChange` controlado y ese aviso no es el defecto de nadie.
const PRELUDIO =
  `const Sel = q => React.createElement('select',` +
  ` {value:q.value, readOnly:true}, q.children);\n`;

// Los identificadores que el desplegable usa y no declara. Se le pregunta al
// ÁMBITO de Babel en vez de enumerar formas de declaración: la primera versión
// de esto llevaba una lista de patrones tecleada a mano —`Identifier`,
// `ObjectPattern`— y el `ROLES.map(([id,lbl])=>…)` del rol, que destructura un
// arreglo, se colaba como libre. Enumerar las formas del lenguaje es la misma
// clase de error que enumerar los sitios.
//
// Se peca de generoso con lo que entra: `fuenteDe` es tolerante y lo que sobre
// cae en `faltan`, donde la siembra o el NO ARRANCÓ lo recogen.
const identificadoresLibres = (fuente) => {
  const sub = parse(`const __x = (${fuente});`, OPTS);
  const nombres = new Set();
  traverse(sub, {
    Identifier(q) {
      const pad = q.parent;
      if (pad.type === 'MemberExpression' && pad.property === q.node && !pad.computed) return;
      if (pad.type === 'OptionalMemberExpression' && pad.property === q.node && !pad.computed) return;
      if (pad.type === 'ObjectProperty' && pad.key === q.node) return;
      if (pad.type === 'JSXAttribute' || pad.type === 'JSXIdentifier') return;
      if (q.scope.hasBinding(q.node.name, { noGlobals: true })) return;
      nombres.add(q.node.name);
    },
  });
  nombres.delete('__x');
  return [...nombres];
};

const monta = (sitio, valor) => {
  const siembra = siembraPara(valor);
  // El alias se reconstruye con la fuente del archivo —`const cc = (m.concepto
  // || "En almacén")`— y el valor de prueba entra por la RAÍZ, que es por donde
  // entra de verdad. Así la omisión del sitio decide, no este banco.
  const declaraAlias = sitio.alias ? `const ${sitio.alias} = (${sitio.aliasInit});\n` : '';
  const libres = [...new Set([
    ...identificadoresLibres(sitio.fuente),
    ...(sitio.alias ? identificadoresLibres(sitio.aliasInit) : []),
  ])].filter(n => n !== sitio.alias);

  // ── El cierre transitivo de las locales del componente ──────────────────
  //
  // Lo que el módulo no resuelve puede estar declarado dentro del componente, y
  // ESO a su vez nombra cosas que nadie ha pedido todavía: el desplegable de
  // permisos lee `v`, que es `valorActual(rol, mod)`, que lee `override` y
  // `PERMISOS`. Una sola pasada declaraba `v` con una función que no existe y el
  // banco salía 2 culpando al archivo medido.
  //
  // Es el #139 en las locales: `cierreDe` cierra las dependencias de nivel
  // superior, y aquí hay que cerrar las de DENTRO del componente. Se hace por
  // rondas y se le pregunta a `fuenteDe` PRIMERO en cada una, porque el módulo
  // es quien manda: una lista declarada arriba no se sustituye por una local
  // que se llame igual.
  const pedidos = new Set(libres);
  const locales = new Map();
  let cuerpo, faltan;
  for (let ronda = 0; ronda <= RECURSION; ronda++) {
    ({ cuerpo, faltan } = fuenteDe(ARCH_APP, [...pedidos], {
      tolerante: true,
      excluir: [...NOMBRES_SIEMBRA, ...locales.keys(),
        ...(sitio.alias ? [sitio.alias] : [])],
    }));
    let nuevos = 0;
    for (const n of faltan.map(x => String(x).replace(/^fn:/, ''))) {
      if (n in siembra || n in global || n === 'React' || n === sitio.alias) continue;
      if (locales.has(n)) continue;
      const ini = declaracionLocal(n, sitio.ruta);
      if (!ini) continue;
      locales.set(n, ini);
      for (const q of identificadoresLibres(ini))
        if (!pedidos.has(q)) { pedidos.add(q); nuevos++; }
    }
    if (nuevos === 0) break;
  }
  // En orden de dependencia, no en el que aparecieron: `const v =
  // valorActual(…)` se evalúa al montar el cierre, así que `valorActual`
  // declarada después deja a `v` en la zona muerta del `const` y el banco sale
  // 2 por un orden que él mismo eligió.
  const declaraLocales = [];
  {
    const puestas = new Set(), enCurso = new Set();
    const poner = (n) => {
      if (puestas.has(n) || enCurso.has(n)) return;
      enCurso.add(n);
      for (const q of identificadoresLibres(locales.get(n)))
        if (locales.has(q)) poner(q);
      enCurso.delete(n); puestas.add(n);
      declaraLocales.push(`const ${n} = (${locales.get(n)});\n`);
    };
    for (const n of locales.keys()) poner(n);
  }
  const huerfanos = faltan.map(x => String(x).replace(/^fn:/, ''))
    .filter(n => !(n in siembra) && !(n in global) && n !== 'React'
      && n !== sitio.alias && !locales.has(n));
  // Lo que ni el módulo resuelve, ni el componente declara, ni este banco
  // siembra: se dice con el nombre y el renglón, y se sale con 2. No con un
  // verde por haberlo saltado.
  if (huerfanos.length) {
    noArranco([`App.jsx:${sitio.linea} es un desplegable de un campo guardado y este ` +
               `banco no supo sembrarle ${huerfanos.map(n => '`' + n + '`').join(', ')}`],
      ARCH_APP);
  }
  let codigo;
  try {
    codigo = esbuild.transformSync(
      `${PRELUDIO}${cuerpo}\n${declaraLocales.join('')}${declaraAlias}` +
      `return () => (${sitio.fuente});`,
      { loader: 'jsx' }).code;
  } catch (err) {
    noArranco([`App.jsx:${sitio.linea} no se pudo transformar — ${err.message}`], ARCH_APP);
  }
  let fn;
  try {
    fn = new Function('React', ...NOMBRES_SIEMBRA, codigo)(
      React, ...NOMBRES_SIEMBRA.map(n => siembra[n]));
  } catch (err) {
    noArranco([`App.jsx:${sitio.linea} no se pudo montar — ${err.message}`], ARCH_APP);
  }
  try { return renderToStaticMarkup(fn()); }
  catch (err) {
    noArranco([`App.jsx:${sitio.linea} reventó al pintarse — ${err.message}`], ARCH_APP);
  }
};

const opcionesDe = html =>
  [...html.matchAll(/<option[^>]*?value="([^"]*)"[^>]*>([^<]*)<\/option>/g)]
    .map(m => ({ valor: m[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), texto: m[2] }));

// ── 5. La invariante ───────────────────────────────────────────────────────
//
// Dicha de frente: EL `value` QUE EL `<select>` PINTA TIENE QUE ESTAR ENTRE SUS
// OPCIONES. Todo lo demás son casos de ésta.
//
// Se lee de `selected` y no del atributo `value` del `<select>`, porque React no
// lo imprime: resuelve el valor contra las opciones y marca con `selected` la
// que coincide. Si ninguna coincide, no marca ninguna — y un `<select>` sin
// opción marcada es exactamente el defecto, porque el navegador pinta la
// PRIMERA. Medirlo así no es un rodeo: es la misma resolución que hace el
// navegador, hecha por quien de verdad la hace, en vez de una comparación que
// este banco repetiría por su cuenta contra la siembra.
const seleccionada = html => {
  const m = /<option[^>]*?value="([^"]*)"[^>]*?selected/.exec(html);
  return m ? m[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : null;
};

console.log(`\n1. Un valor guardado que no está en la lista aparece entre las opciones`);
const pintados = [];
for (const sitio of sitios) {
  const html = monta(sitio, AJENO);
  const ops = opcionesDe(html);
  pintados.push({ sitio, html, ops });
  const lo_ofrece = ops.some(o => o.valor === AJENO);
  check(lo_ofrece,
    `App.jsx:${sitio.linea} ofrece «${AJENO}», el valor guardado`,
    lo_ofrece ? `${ops.length} opciones` : `pintaría «${ops[0] ? ops[0].texto : '(nada)'}»`);
}

// Y se dice que es ajeno. Ofrecerlo sin marcarlo deja al usuario creyendo que
// ese estado es parte del trámite, y nadie lo corrige.
console.log(`\n2. Y va marcado, para que quien lo lea sepa que hay que corregirlo`);
for (const { sitio, ops } of pintados) {
  const o = ops.find(x => x.valor === AJENO);
  check(!!o && o.texto.length > AJENO.length,
    `App.jsx:${sitio.linea} dice que ese valor no es de su lista`,
    o ? `«${o.texto}»` : 'no lo ofrece');
}

// ── 6. Y la marca no se pone siempre ───────────────────────────────────────
//
// La mitad que un «añade siempre una opción con el valor» pasaría. Si todo
// valor se marcara, la marca no diría nada: se vuelve decoración y se aprende
// a ignorar. Se re-renderiza con un valor que SÍ está entre las opciones que
// el sitio pintó, y se exige que no lleve advertencia y que la lista sea una
// opción más corta.
console.log(`\n3. Un valor que sí está en la lista no lleva advertencia`);
for (const { sitio, ops } of pintados) {
  const propia = ops.find(o => o.valor !== AJENO && o.valor !== '');
  if (!propia) {
    check(false, `App.jsx:${sitio.linea} pinta alguna opción propia contra la que comparar`,
      `${ops.length} opciones y ninguna propia`);
    continue;
  }
  const ops2 = opcionesDe(monta(sitio, propia.valor));
  const sinAjeno = !ops2.some(o => o.valor === AJENO);
  const unaMenos = ops2.length === ops.length - 1;
  check(sinAjeno && unaMenos,
    `App.jsx:${sitio.linea} con «${propia.valor}» pinta una opción menos y ninguna advertencia`,
    `${ops.length} → ${ops2.length} opciones`);
}

// ── 7. El campo sin capturar no se disfraza tampoco ────────────────────────
//
// El vacío NO es un valor de fuera del catálogo: es un campo que nadie llenó,
// y los desplegables no coinciden en qué hacer con él. Unos ofrecen su propio
// «— Seleccionar —»; otros le ponen una omisión —`|| "activa"`, `|| "En
// proceso"`— que SÍ está en la lista y entonces no hay nada que decir. Lo que
// ninguno puede hacer es quedarse con el vacío pintando el primer estado del
// trámite, que es otra vez la mentira de la sección 1 por otra puerta.
//
// Se mide por la invariante, que cubre las tres salidas sin tener que saber
// cuál eligió cada sitio.
console.log(`\n4. Con el campo sin capturar, el desplegable pinta la opción que le toca`);
for (const { sitio } of pintados) {
  const html = monta(sitio, '');
  const ops = opcionesDe(html);
  const v = seleccionada(html);
  check(v !== null,
    `App.jsx:${sitio.linea} marca una opción`,
    v === null
      ? `ninguna marcada; el navegador pintaría «${ops[0] ? ops[0].texto : '(nada)'}»`
      : `«${v === '' ? '(vacío)' : v}», de ${ops.length}`);
}

// ── 8. La cuenta que decide, ejecutada aparte ──────────────────────────────
//
// Las secciones de arriba ejercitan los desplegables. Ésta ejercita la regla
// que todos comparten, con los casos que un render no alcanza: las dos formas
// de lista que hay en el archivo —cadenas y pares `[id, etiqueta]`— y el
// vacío, que no es lo mismo que un valor de fuera.
console.log(`\n5. La regla misma, con las dos formas de lista del archivo`);
{
  const { cuerpo, faltan } = fuenteDe(ARCH_APP, ['opcionAjena'], { tolerante: true });
  if (faltan.length) {
    noArranco(faltan, ARCH_APP);
  }
  const codigo = esbuild.transformSync(`${cuerpo}\nreturn opcionAjena;`, { loader: 'jsx' }).code;
  const opcionAjena = new Function('React', codigo)(React);
  const pinta = el => el === null ? null : renderToStaticMarkup(el);

  check(pinta(opcionAjena('Facturada', ['Recibida', 'Autorizada'], 'fuera del trámite'))
      === '<option value="Facturada">Facturada — fuera del trámite</option>',
    'una lista de cadenas: el valor de fuera sale con su marca',
    pinta(opcionAjena('Facturada', ['Recibida', 'Autorizada'], 'fuera del trámite')));
  check(opcionAjena('Autorizada', ['Recibida', 'Autorizada'], 'x') === null,
    'un valor que está en la lista no produce nada');
  // La forma de pares es la de `ROLES` y `ESTADOS_SUBCONTRATO`. Si no se
  // normalizara, cada rol se leería como ajeno y la advertencia saldría
  // siempre: la manera de que la marca no signifique nada.
  check(opcionAjena('residente', [['residente', 'Residente'], ['auditor', 'Auditor']], 'x') === null,
    'una lista de pares `[id, etiqueta]`: el id que está en ella tampoco');
  check(pinta(opcionAjena('director_obras', [['residente', 'Residente']], 'no existe aquí'))
      === '<option value="director_obras">director_obras — no existe aquí</option>',
    'y el id que no está en ella sale con su marca');
  // El vacío NO es un valor de fuera: es un campo sin capturar. Los
  // desplegables que ya ofrecen su «— Seleccionar —» no necesitan nada, y los
  // que no lo ofrecen tienen que decirlo con palabras.
  check(opcionAjena('', ['Recibida'], 'x') === null,
    'el vacío no inventa una opción donde el sitio ya ofrece la suya');
  check(pinta(opcionAjena('', ['Recibida'], 'x', 'sin estatus'))
      === '<option value="">sin estatus</option>',
    'y donde no la ofrece, el vacío se dice con palabras');
  check(opcionAjena(undefined, ['Recibida'], 'x') === null
     && opcionAjena(null, ['Recibida'], 'x') === null,
    '`undefined` y `null` son el vacío, no el texto «undefined»');
  check(pinta(opcionAjena(3, [1, 2], 'fuera')) === '<option value="3">3 — fuera</option>'
     && opcionAjena(2, [1, 2], 'fuera') === null,
    'un valor numérico se compara por su texto, no por su tipo');
  check(opcionAjena('x', null, 'fuera') !== null,
    'sin lista, un valor guardado no se da por bueno');
}

// ── 9. Un renglón más arriba: el formulario que inventa lo que no se guardó ─
//
// ESTO SALIÓ DEL RECORRIDO EN EL PREVIEW, no de leer el archivo. Con las ocho
// secciones de arriba en verde, el modal de Editar usuario abierto sobre el
// perfil `sinrol@fosmon.com.mx` enseñaba «Administrador de Obra» ya escogido.
// El desplegable estaba bien: pintaba fielmente lo que le daban. Lo que le
// daban era mentira, porque el estado inicial del formulario decía
// `usuario?.rol || "administrador_obra"` y el perfil no tiene rol.
//
// Es la misma afirmación de este banco un renglón más arriba, y es peor: no es
// que la pantalla enseñe un rol que el perfil no tiene, es que «Guardar
// cambios» manda ese rol a `actualizarUsuario` y se lo OTORGA. Una omisión que
// en un ALTA es correcta —hay que arrancar con un rol de la lista que se
// muestra— y al EDITAR escribe un privilegio.
//
// La regla: CON REGISTRO, UN CAMPO QUE EL REGISTRO NO TRAE SALE VACÍO. Sin
// registro —el alta— la omisión es libre.
//
// El barrido no nombra el modal: busca todo `useState({…})` que desempaque dos
// o más campos de una misma raíz, que es la forma de «un registro cargado en un
// formulario», y EJECUTA el inicializador dos veces. Hoy hay uno solo en el
// archivo; el modal que se escriba mañana cae igual.
console.log('\n6. Con registro cargado, el formulario no inventa un campo que no viene');
{
  const raizDe = (n) => {
    let c = n;
    while (c && (c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression')) c = c.object;
    return c && c.type === 'Identifier' ? c.name : null;
  };
  const formularios = [];
  traverse(ast, {
    CallExpression(p) {
      const cal = p.node.callee;
      if (!(cal.type === 'Identifier' && cal.name === 'useState')) return;
      const obj = p.node.arguments[0];
      if (!obj || obj.type !== 'ObjectExpression') return;
      const cuenta = {};
      for (const pr of obj.properties) {
        if (pr.type !== 'ObjectProperty') continue;
        const v = pr.value.type === 'LogicalExpression' ? pr.value.left : pr.value;
        if (v.type !== 'MemberExpression' && v.type !== 'OptionalMemberExpression') continue;
        const r = raizDe(v);
        if (r) cuenta[r] = (cuenta[r] || 0) + 1;
      }
      const registro = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
      if (!registro || registro[1] < 2) return;
      formularios.push({
        linea: src.slice(0, p.node.start).split('\n').length,
        registro: registro[0],
        fuente: src.slice(obj.start, obj.end),
        ruta: p,
      });
    },
  });

  // Cero formularios es el P4 por el lado que no avisa: si el archivo cambió de
  // forma hasta dejar de parecerse a esto, lo que hay que decir es que no se
  // midió.
  if (formularios.length === 0) {
    noArranco(['ningún `useState({…})` que cargue un registro en un formulario'], ARCH_APP);
  }
  console.log(`   (formularios con registro cargado: ${formularios.length})`);

  for (const f of formularios) {
    // Las libres del inicializador que no sean el registro: banderas como
    // `esDep`, que deciden la omisión del alta. Se les da los dos valores,
    // porque la omisión correcta en una rama no absuelve a la otra.
    const libres = identificadoresLibres(f.fuente).filter(n => n !== f.registro);
    const { cuerpo, faltan } = fuenteDe(ARCH_APP, libres,
      { tolerante: true, excluir: [f.registro, ...libres] });
    const perdidos = faltan.map(x => String(x).replace(/^fn:/, ''))
      .filter(n => !libres.includes(n) && !(n in global));
    if (perdidos.length) {
      noArranco([`App.jsx:${f.linea} carga un registro y este banco no supo ` +
                 `sembrarle ${perdidos.map(n => '`' + n + '`').join(', ')}`], ARCH_APP);
    }
    let hacer;
    try {
      const codigo = esbuild.transformSync(
        `${cuerpo}\nreturn (${f.registro}, ${libres.join(', ') || '__nada'}) => (${f.fuente});`,
        { loader: 'jsx' }).code;
      hacer = new Function('React', '__nada', codigo)(React, undefined);
    } catch (err) {
      noArranco([`App.jsx:${f.linea} no se pudo montar — ${err.message}`], ARCH_APP);
    }
    // Un registro que EXISTE y no trae ningún campo. Es el perfil sin rol, y es
    // el caso que distingue «no capturado» de «no hay registro».
    for (const bandera of [false, true]) {
      const estado = hacer({}, ...libres.map(() => bandera));
      const inventados = Object.entries(estado)
        .filter(([, v]) => typeof v === 'string' && v !== '')
        .map(([k, v]) => `${k}="${v}"`);
      check(inventados.length === 0,
        `App.jsx:${f.linea} con \`${f.registro}\` vacío` +
        (libres.length ? ` y ${libres.join('/')}=${bandera}` : '') +
        ' no inventa ningún campo',
        inventados.length ? inventados.join(', ') : 'todos vacíos');
    }
    // Y la otra mitad: en el ALTA la omisión sigue siendo libre, porque un
    // formulario nuevo que arranque en blanco en un campo de lista cerrada es
    // el defecto de la otra dirección. Esto no afirma CUÁL: afirma que el banco
    // no está pidiendo que desaparezca.
    const alta = hacer(undefined, ...libres.map(() => false));
    check(alta && typeof alta === 'object',
      `App.jsx:${f.linea} sin registro —el alta— sigue armando su estado inicial`,
      alta ? Object.keys(alta).length + ' campos' : '(nada)');
  }
}

// ── Resultado ──────────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log(`VERDE — los ${sitios.length} desplegables de campo guardado enseñan lo que está guardado.\n`);
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
