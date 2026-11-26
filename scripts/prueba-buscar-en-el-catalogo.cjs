#!/usr/bin/env node
// BUSCAR UN CONCEPTO EN UN CATÁLOGO DE CUATROCIENTOS RENGLONES
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El catálogo de una obra se despliega en un árbol de categorías y hasta hoy
// la única forma de llegar a un concepto era abrir ramas y mirar.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `conceptoCasa` se EXTRAE y SE EJECUTA contra
// conceptos con la forma que trae un catálogo de verdad —clave jerárquica,
// descripción con acentos y unidad—.
//
// Lo que se mide no es «filtra»: es que filtre SIN DEJAR FUERA lo que el
// usuario está buscando y sin devolver de más, que en cuatrocientos renglones
// es la diferencia entre un buscador y una lista nueva.
//
// Uso:
//   node scripts/prueba-buscar-en-el-catalogo.cjs
//   node scripts/prueba-buscar-en-el-catalogo.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const ARCHIVO_APP = process.env.ARCHIVO_APP || path.join(raiz, 'src/App.jsx');
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'el término vacío deja de pasar todo: el catálogo nace filtrado a nada',
    de: `  if (!t) return true;`,
    a:  `  if (!t) return false;` },
  // Se muta el lado del CATÁLOGO y no el del término: quitarle los acentos
  // sólo a lo que se teclea no cambia nada —nadie los teclea— y la mutación
  // saldría verde sin que el banco tenga un hueco. El acento está en el
  // catálogo, así que ahí es donde duele.
  { nombre: 'el catálogo se busca con sus acentos y «excavacion» ya no encuentra «excavación»',
    de: `  const heno = sinAcentos(\`\${s?.sec ?? ''} \${s?.sub ?? ''} \${s?.unidad ?? ''}\`);`,
    a:  `  const heno = String(\`\${s?.sec ?? ''} \${s?.sub ?? ''} \${s?.unidad ?? ''}\`).toLowerCase();` },
  { nombre: 'basta UNA palabra y el buscador devuelve media obra',
    de: `  return t.split(/\\s+/).every(p => heno.includes(p));`,
    a:  `  return t.split(/\\s+/).some(p => heno.includes(p));` },
  { nombre: 'deja de buscar en la clave, que es lo que la gente tiene a mano',
    de: `  const heno = sinAcentos(\`\${s?.sec ?? ''} \${s?.sub ?? ''} \${s?.unidad ?? ''}\`);`,
    a:  `  const heno = sinAcentos(\`\${s?.sub ?? ''}\`);` },
  { nombre: 'deja de buscar en la descripción, que es lo que se recuerda',
    de: `  const heno = sinAcentos(\`\${s?.sec ?? ''} \${s?.sub ?? ''} \${s?.unidad ?? ''}\`);`,
    a:  `  const heno = sinAcentos(\`\${s?.sec ?? ''}\`);` },
  { nombre: 'el filtro se aplica pero la pantalla no dice que no encontró nada',
    de: `        const nadaQueMostrar = subsConImp.length === 0 && todosLosConceptos.length > 0;`,
    a:  `        const nadaQueMostrar = false;` },
  { nombre: 'el árbol se arma con todo y el filtro no filtra',
    de: `        const subsConImp = todosLosConceptos.filter(s => conceptoCasa(s, busquedaConcepto));`,
    a:  `        const subsConImp = todosLosConceptos;` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCHIVO_APP, 'utf8'),
    { archivo: ARCHIVO_APP, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCHIVO_APP, 'utf8'),
    archivo: ARCHIVO_APP, extension: '.jsx' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

const { deArchivo } = require('./extraer-de-app.cjs');
let conceptoCasa;
try {
  ({ conceptoCasa } = deArchivo(ARCHIVO_APP, 'conceptoCasa'));
} catch (e) {
  noArranco([`no se pudo extraer \`conceptoCasa\`: ${e.message}`], 'src/App.jsx');
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Conceptos con la forma de un catálogo de verdad.
const CAT = [
  { sec: '5.3.2',  sub: 'Excavación en material tipo II con maquinaria', unidad: 'M3' },
  { sec: '5.3.3',  sub: 'Relleno compactado al 95% proctor',             unidad: 'M3' },
  { sec: '7.1.1',  sub: "Concreto f'c=250 kg/cm2 en losa",               unidad: 'M3' },
  { sec: '7.1.2',  sub: "Concreto f'c=200 kg/cm2 en firme",              unidad: 'M3' },
  { sec: '12.4.1', sub: 'Suministro y colocación de luminaria LED',      unidad: 'PZA' },
];
const halla = (t) => CAT.filter(s => conceptoCasa(s, t)).map(s => s.sec);

console.log('\n── BUSCAR EN EL CATÁLOGO ──\n');

console.log('§1 · por la clave, que es lo que se tiene a mano');
check(JSON.stringify(halla('5.3.2')) === JSON.stringify(['5.3.2']),
  '«5.3.2» encuentra ese concepto y sólo ése', halla('5.3.2').join(', '));
check(JSON.stringify(halla('7.1')) === JSON.stringify(['7.1.1', '7.1.2']),
  '«7.1» encuentra la rama entera, que es lo que se espera de un prefijo',
  halla('7.1').join(', '));

console.log('\n§2 · por la descripción, que es lo que se recuerda');
check(JSON.stringify(halla('luminaria')) === JSON.stringify(['12.4.1']),
  '«luminaria» encuentra el concepto', halla('luminaria').join(', '));
check(JSON.stringify(halla('EXCAVACION')) === JSON.stringify(['5.3.2']),
  '«EXCAVACION» en mayúsculas y sin tilde encuentra «Excavación»',
  halla('EXCAVACION').join(', '));
check(JSON.stringify(halla('compactado')) === JSON.stringify(['5.3.3']),
  'y una palabra de en medio también');

console.log('\n§3 · todas las palabras, no cualquiera');
check(JSON.stringify(halla('concreto 250')) === JSON.stringify(['7.1.1']),
  '«concreto 250» encuentra UNO, no los dos concretos',
  halla('concreto 250').join(', '));
check(halla('concreto').length === 2,
  'y «concreto» a secas sí encuentra los dos', halla('concreto').join(', '));
check(halla('concreto luminaria').length === 0,
  'dos palabras que no coinciden en el mismo concepto no devuelven nada',
  halla('concreto luminaria').join(', ') || '(ninguno)');

console.log('\n§4 · el vacío no esconde el catálogo');
for (const t of ['', '   ', null, undefined])
  check(CAT.every(s => conceptoCasa(s, t)),
    `con «${String(t)}» pasan los ${CAT.length} conceptos`,
    `${CAT.filter(s => conceptoCasa(s, t)).length} de ${CAT.length}`);

console.log('\n§5 · y los bordes no revientan');
check(conceptoCasa({}, 'algo') === false, 'un concepto sin campos no casa, y no lanza');
check(conceptoCasa(null, 'algo') === false, 'ni un concepto nulo');
check(conceptoCasa(null, '') === true, 'pero con término vacío pasa, como todos');
check(halla('m3').length === 4, 'la unidad también se busca: «m3» trae los de volumen',
  halla('m3').join(', '));

console.log('\n§6 · la pantalla lo usa, y dice cuando no encuentra');
const app = fs.readFileSync(ARCHIVO_APP, 'utf8');
check(/filter\(s => conceptoCasa\(s, busquedaConcepto\)\)/.test(app),
  'el árbol se arma con los conceptos filtrados, no con todos');
check(/nadaQueMostrar = subsConImp\.length === 0 && todosLosConceptos\.length > 0/.test(app),
  'y hay un estado para «no encontré nada», que si no la pantalla se ve vacía');
check(/setBusquedaConcepto\(""\)/.test(app),
  'el filtro se limpia al cambiar de obra, para no heredar una pantalla medio vacía');

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'se llega a un concepto escribiendo, no desplegando ramas.'
  : 'el buscador deja fuera lo que se busca, o devuelve media obra.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
