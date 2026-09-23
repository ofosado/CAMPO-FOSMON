#!/usr/bin/env node
// Prueba: una nómina no se guarda con una semana que nadie confirmó.
//
// El daño que cubre ya ocurrió. La obra 0125 (TAMSA) tiene once nóminas
// guardadas con el número de semana equivocado, y nadie lo notó nunca, porque
// un número de semana mal puesto NO SE VE: la fila aparece, con su dinero y su
// gente correctos, solo que colocada donde no va. El historial de TAMSA ordena
// 04, 07, 11, 14, 18, 21, 25, 30 —junio antes que mayo— y pinta una curva de
// nómina en zigzag sobre una obra cuya cuadrilla creció de 2 a 141 personas sin
// una sola bajada. Dos semanas distintas acabaron fundidas en una sola fila.
//
// Por eso esto NO comprueba que el parser "extraiga bien la semana". Comprueba
// lo único que impide que vuelva a pasar: que cuando el archivo no dice a qué
// semana pertenece —o dice dos cosas distintas— la pantalla PREGUNTE y no haya
// forma de guardar hasta que alguien conteste.
//
// No afirma que existan nombres. Saca `parsearNomina` de `src/App.jsx` con sus
// ayudantes, le da archivos con forma de producción, y luego RENDERIZA el
// diálogo real de revisión para leer el texto que le sale al usuario en la
// pantalla.
//
// Uso:  node scripts/prueba-semana-de-nomina.cjs [archivo]
//       node scripts/prueba-semana-de-nomina.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const contraprueba = process.argv.includes('--contraprueba');
const archivo = process.argv.find(a => a.endsWith('.jsx')) || path.join(raiz, 'src/App.jsx');
let src = fs.readFileSync(archivo, 'utf8');

// ── La contraprueba ────────────────────────────────────────────────────────
// Quita el CONTRASTE y deja que la primera fuente que hable decida, que es
// exactamente lo que hacía el parser viejo. No toca andamiaje: cambia la
// semántica —"hace falta acuerdo" pasa a "basta con que alguien lo diga"— y la
// prueba tiene que caerse por eso. Si sigue pasando en verde, la prueba no
// está mirando lo que dice que mira.
if (contraprueba) {
  const antes = src;
  src = src.replace(
    /numero: distintos\.length === 1 \? distintos\[0\] : null,/,
    'numero: fuentes.length ? fuentes[0].n : null,');
  src = src.replace(
    /acuerdo: fuentes\.length === 0 \? null : distintos\.length === 1,/,
    'acuerdo: fuentes.length === 0 ? null : true,');
  if (src === antes) {
    console.error('La contraprueba no encontró qué romper — el código cambió de forma.');
    process.exit(2);
  }
}

const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

// ── Extracción ─────────────────────────────────────────────────────────────
// Se toman las declaraciones de nivel superior y se sigue la cadena de lo que
// cada una usa, para no tener que mantener a mano una lista de nombres.
const fuente = {};
const enRaiz = (p) => !p.getFunctionParent() && p.parentPath.parent.type === 'Program';
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && enRaiz(p))
      fuente[p.node.id.name] ||= `const ${p.node.id.name} = ${src.slice(p.node.init.start, p.node.init.end)};`;
  },
  FunctionDeclaration(p) {
    if (p.node.id && p.parent.type === 'Program')
      fuente[p.node.id.name] ||= src.slice(p.node.start, p.node.end);
  },
});

const usados = (codigo) => {
  const sub = parse(codigo, { sourceType: 'module', plugins: ['jsx'] });
  const out = new Set();
  traverse(sub, { Identifier(p) { if (p.isReferencedIdentifier()) out.add(p.node.name); } });
  return out;
};

const cierre = (semillas) => {
  const puestos = new Set(), orden = [], pendientes = [...semillas];
  while (pendientes.length) {
    const n = pendientes.shift();
    if (puestos.has(n) || !fuente[n]) continue;
    puestos.add(n);
    for (const u of usados(fuente[n])) if (!puestos.has(u) && fuente[u]) pendientes.push(u);
    orden.unshift(fuente[n]);
  }
  return orden.join('\n\n');
};

// ── El diálogo real, sacado de la pantalla ─────────────────────────────────
// Se localiza por su forma, no por una línea: la expresión JSX que se pinta
// cuando hay algo pendiente de revisar.
let jsxDialogo = null;
traverse(ast, {
  JSXExpressionContainer(p) {
    const e = p.node.expression;
    if (e.type === 'LogicalExpression' && e.operator === '&&' &&
        e.left.type === 'Identifier' && e.left.name === 'pendienteRevisar')
      jsxDialogo ||= src.slice(e.start, e.end);
  },
});
if (!jsxDialogo) { console.error('No se encontró el diálogo de revisión en la pantalla.'); process.exit(2); }

// Colores de mentira: al texto de la pantalla no le importan, y pedirlos de
// verdad ataría la prueba a cómo se llaman hoy.
const C = new Proxy({}, { get: () => '#888' });

const modulo = `
${cierre(['parsearNomina'])}

function Dialogo({pendienteRevisar, semanaManual, historial, error}) {
  const setPendienteRevisar = () => {};
  const setSemanaManual = () => {};
  const guardarSemana = () => {};
  return <div>{${jsxDialogo}}</div>;
}
module.exports = { parsearNomina, Dialogo };
`;

const compilado = esbuild.transformSync(modulo, { loader: 'jsx', format: 'cjs' }).code;
const sandbox = { module: { exports: {} }, exports: {}, React, C, console };
new Function('module', 'exports', 'React', 'C', 'console', compilado)(
  sandbox.module, sandbox.exports, React, C, console);
const { parsearNomina, Dialogo } = sandbox.module.exports;

// ── Lo que ve el usuario ───────────────────────────────────────────────────
// Se pinta el diálogo y se le quitan las etiquetas: queda el texto que de
// verdad aparece en la pantalla, que es sobre lo que se afirma.
const pantalla = (pendienteRevisar, semanaManual = '', historial = [], error = null) =>
  renderToStaticMarkup(React.createElement(Dialogo, {pendienteRevisar, semanaManual, historial, error}))
    .replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();

const hayBotonGuardar = (pendienteRevisar, semanaManual = '', historial = []) =>
  /<button[^>]*>\s*Guardar/.test(renderToStaticMarkup(
    React.createElement(Dialogo, {pendienteRevisar, semanaManual, historial, error: null})));

// ── Archivos con forma de producción ───────────────────────────────────────
// Las filas de trabajadores son las mínimas para que el parser reconozca una
// nómina; lo que se prueba está arriba, en el encabezado y en el nombre.
const FILAS = (encabezado) => [
  ...encabezado.map(t => [t, null, null, null, null, null]),
  ['NOMBRE DEL TRABAJADOR', 'CATEGORIA', 'TIPO (D/I)', 'D.T.', 'T.E. (HRS)', 'IMPORTE TOTAL'],
  ['JUAN PEREZ LOPEZ', 'OFICIAL', 'D', 6, 4, 3200],
  ['MARIA GOMEZ RUIZ', 'AYUDANTE', 'D', 6, 0, 2400],
  ['LUIS HERNANDEZ SOL', 'ADMINISTRADOR', 'I', 6, 0, 5100],
];

// Los nueve archivos reales de TAMSA 0125, tal como están guardados hoy en el
// campo `archivo` de cada registro. El número que declara el nombre coincide
// con la semana de calendario del día de CIERRE en los nueve.
const TAMSA = [
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 19 DEL 30 DE ABR AL 06 DE MAY DE 2026.xlsx', 19],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 20 DEL 07 DE MAY AL 13 DE MAY DE 2026.xlsx', 20],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 21 DEL 14 DE MAY AL 20 DE MAY DE 2026.xlsx', 21],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 22 DEL 21 DE MAY AL 27 DE MAY DE 2026.xlsx', 22],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 23 DEL 28 DE MAY AL 03 DE JUN DE 2026.xlsx', 23],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 24 DEL 04 DE JUN AL 10 DE JUN DE 2026.xlsx', 24],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 25 DEL 11 DE JUN AL 17 DE JUN DE 2026.xlsx', 25],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 26 DEL 18 DE JUN AL 24 DE JUN DE 2026.xlsx', 26],
  ['0125 TAMSA VER SERVICIOS ESPECIALIZADOS NÓMINA_SEM. 27 DEL 25 DE JUN AL 01 DE JUL DE 2026 rev2.xlsx', 27],
];

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// El diálogo se arma igual que lo arma la pantalla al procesar un archivo.
const revisar = (filas, nombre, {errores = [], advertencias = []} = {}) => {
  const r = parsearNomina(filas, nombre);
  return {
    r,
    pendiente: {
      nueva: { semana: r.semana, fecha: '22/09/2026', archivo: nombre,
        trabajadores: r.trabajadores, totalNomina: 10700 },
      errores, advertencias,
      semanaInfo: r.semanaInfo,
      preguntarSemana: r.semanaInfo.acuerdo !== true,
    },
  };
};

console.log('\n── Los nueve archivos de TAMSA 0125 ──\n');
for (const [nombre, esperada] of TAMSA) {
  const { r } = revisar(FILAS(['SERVICIOS ESPECIALIZADOS TAMSA', 'NOMINA SEMANAL']), nombre);
  check(r.semana === `Semana ${String(esperada).padStart(2,'0')}`,
    `«SEM. ${esperada}» se guarda como Semana ${String(esperada).padStart(2,'0')}`,
    `guardó «${r.semana || 'nada'}»`);
}

console.log('\n── El renglón que engañaba al parser viejo ──\n');
{
  // "SERVICIOS ESPECIALIZADOS" seguido de un número: el respaldo viejo mordía
  // cualquier palabra acabada en "s" pegada a dos dígitos.
  const { r, pendiente } = revisar(
    FILAS(['SERVICIOS ESPECIALIZADOS 30', 'TOTAL DIAS 21', 'PERIODO DEL MES']),
    'nomina final.xlsx');
  check(r.semana === '', 'un renglón con números sueltos ya no se toma por una semana',
    `guardó «${r.semana || 'nada'}»`);

  const txt = pantalla(pendiente);
  check(/¿A qué semana corresponde esta nómina\?/.test(txt),
    'la pantalla PREGUNTA a qué semana corresponde');
  check(/Semana sin determinar/.test(txt),
    'la cabecera dice que la semana está sin determinar, no un número inventado');
  check(!hayBotonGuardar(pendiente),
    'sin contestar no hay manera de guardar: el botón no está');
  check(hayBotonGuardar(pendiente, '22'),
    'en cuanto se contesta 22, aparece el botón de guardar');
  check(/Se guardará como «Semana 22»/.test(pantalla(pendiente, '22')),
    'y la pantalla enseña con qué nombre va a quedar');
  check(!hayBotonGuardar(pendiente, '0') && !hayBotonGuardar(pendiente, '54'),
    'un 0 o un 54 no son semanas: tampoco dejan guardar');
}

console.log('\n── Cuando el archivo dice dos cosas distintas ──\n');
{
  const { r, pendiente } = revisar(
    FILAS(['TAMSA VERACRUZ', 'SEM. 21 DEL 14 AL 20 DE MAY DE 2026']),
    '0125 TAMSA NÓMINA_SEM. 23 DEL 28 DE MAY AL 03 DE JUN DE 2026.xlsx');
  check(r.semana === '', 'con las fuentes en desacuerdo no se elige ninguna',
    `guardó «${r.semana || 'nada'}»`);

  const txt = pantalla(pendiente);
  check(/El archivo dice dos cosas distintas/.test(txt),
    'la pantalla avisa de la contradicción antes de guardar');
  check(/Semana 21 según la hoja/.test(txt),
    'y enseña la semana que dice la hoja');
  check(/Semana 23 según el nombre del archivo/.test(txt),
    'y la que dice el nombre del archivo');
  check(!hayBotonGuardar(pendiente), 'tampoco aquí se puede guardar sin decidir');
}

console.log('\n── La semana repetida ──\n');
{
  const { pendiente } = revisar(
    FILAS(['NOMINA', 'CUADRILLA COMPLETA']), 'nomina sin semana.xlsx');
  const historial = [{ semana: 'Semana 22', fecha: '10/09/2026' }];
  check(/Ya existe una carga con el nombre «Semana 22» \(10\/09\/2026\)/
    .test(pantalla(pendiente, '22', historial)),
    'si el número que se teclea ya está cargado, la pantalla lo dice',
    'el duplicado se mide contra el número contestado, no contra el del archivo');
  check(!/Ya existe una carga/.test(pantalla(pendiente, '23', historial)),
    'y con un número libre no estorba');
}

console.log('\n── El cambio de año ──\n');
{
  // Una nómina que empieza en diciembre y cierra en enero pertenece a la
  // semana en que CIERRA. Si se tomara la del inicio, caería en la 53 del año
  // anterior y el nombre del archivo y el periodo se pelearían para siempre.
  const { r } = revisar(
    FILAS(['NOMINA SEMANAL', 'DEL 31 DE DIC AL 06 DE ENE DE 2027']),
    'NÓMINA_SEM. 1 DEL 31 DE DIC AL 06 DE ENE DE 2027.xlsx');
  check(r.semana === 'Semana 01', 'la semana a caballo entre dos años es la del cierre',
    `guardó «${r.semana || 'nada'}»`);
}

console.log('\n── Cuando todo cuadra ──\n');
{
  const { r, pendiente } = revisar(
    FILAS(['FOSMON CONSTRUCCIONES', 'NÓMINA SEM. 37 DEL 10 AL 16 DE SEP DE 2026']),
    '0126 NÓMINA SEM. 37.xlsx');
  check(r.semana === 'Semana 37' && r.semanaInfo.acuerdo === true,
    'con las tres fuentes de acuerdo la semana sale sola, sin preguntar nada',
    `guardó «${r.semana || 'nada'}»`);
  check(!/¿A qué semana corresponde/.test(pantalla(pendiente)),
    'y la pantalla no molesta al usuario con una pregunta que ya está contestada');
}

console.log('');
if (contraprueba) {
  console.log(fallas > 0
    ? `CONTRAPRUEBA OK — al quitar el contraste, ${fallas} afirmacion${fallas===1?'':'es'} se cae${fallas===1?'':'n'}.\n`
    : 'CONTRAPRUEBA MAL — se quitó el contraste y la prueba siguió en verde.\n');
  process.exit(fallas > 0 ? 0 : 1);
}
console.log(fallas === 0 ? 'Todo en orden.\n' : `${fallas} fallas.\n`);
process.exit(fallas === 0 ? 0 : 1);
