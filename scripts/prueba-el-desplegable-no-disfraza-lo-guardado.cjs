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

const aliasDeCampo = (nombre, ruta) => {
  const fuente = declaracionLocal(nombre, ruta);
  if (!fuente) return null;
  const ini = sinOmision(parse(`const __a = (${fuente});`, OPTS)
    .program.body[0].declarations[0].init);
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
  if (v.type === 'Identifier') {
    const ini = aliasDeCampo(v.name, s.ruta);
    if (ini) { sitios.push({ ...s, alias: v.name, aliasInit: ini }); continue; }
  }
  descartados.push({ ...s, motivo: motivoDe(v) });
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
  gpData: { obras: { [PROPIA]: { id: PROPIA, nombre: 'La propia' } } },
  // Los alias locales NO se siembran: se declaran con su propia fuente en
  // `monta`, para que la omisión que el sitio les puso siga corriendo.
  // Listas que no viven en el módulo.
  ROLES: LISTA_PARES, opciones: LISTA_CADENAS, campos: [],
  // Lo que el renglón ya había desempacado.
  key: 'campoCualquiera', i: 0, editar: true,
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
  const { cuerpo, faltan } = fuenteDe(ARCH_APP, libres,
    { tolerante: true, excluir: [...NOMBRES_SIEMBRA, ...(sitio.alias ? [sitio.alias] : [])] });
  // Lo que el módulo no resuelve puede estar declarado dentro del componente.
  // Se busca ahí antes de darlo por perdido, porque dónde esté declarada una
  // lista no es asunto de este banco.
  const huerfanos = [], declaraLocales = [];
  for (const n of faltan.map(x => String(x).replace(/^fn:/, ''))) {
    if (n in siembra || n in global || n === 'React' || n === sitio.alias) continue;
    const ini = declaracionLocal(n, sitio.ruta);
    if (ini) declaraLocales.push(`const ${n} = (${ini});\n`);
    else huerfanos.push(n);
  }
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
