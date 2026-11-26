#!/usr/bin/env node
// EL TABLERO Y EL PDF PUBLICAN LOS MISMOS SEIS INDICADORES
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// Oscar fijó la lista el 2026-11-25: presupuesto total, ejecutado, gasto
// acumulado, margen, personal y días de atraso. El tablero publicaba otra
// —traía «Por ejecutar» y no traía los días— y el PDF una TERCERA, con avance
// físico y un bloque de cobranza.
//
// Tres listas para la misma obra no es un asunto de gusto: quien descarga el
// papel desde la pantalla no sabe cuál de los dos leer, y la diferencia entre
// ellos parece un dato.
//
// ── QUÉ AFIRMA, Y QUÉ NO ───────────────────────────────────────────────────
// Dos cosas distintas, y conviene no confundirlas:
//
//   · Las piezas que CALCULAN —`kpiDesviacionPlazo` y `plantillaDeObra`— se
//     extraen y se EJECUTAN. Ahí se mide conducta.
//   · Qué indicadores publica cada superficie se lee del fuente, porque el
//     rótulo vive en el JSX y en un arreglo del PDF. No es «existe el
//     símbolo»: se EXTRAEN las dos listas y se comparan ENTRE SÍ y contra la
//     acordada. Lo que afirma es que las dos superficies coinciden, que es la
//     propiedad que se rompió.
//
// Lo que este banco NO cubre: cómo se ve el PDF. Eso se mira en el preview.
//
// Uso:
//   node scripts/prueba-los-kpis-de-obra-son-los-seis.cjs
//   node scripts/prueba-los-kpis-de-obra-son-los-seis.cjs --contraprueba

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
  { nombre: 'el tablero pierde los días de atraso, que es la única que contesta «¿llegamos?»',
    de: `          <Kpi label="Días de atraso" value={desvPlazo.valor}`,
    a:  `          <Kpi label="Otra cosa" value={desvPlazo.valor}` },
  { nombre: 'el PDF publica un indicador que el tablero no, y los dos papeles se separan',
    de: `    ['Presupuesto total', MXN(PPTO), 'contrato base', Q.piz],`,
    a:  `    ['Contratado', MXN(PPTO), 'contrato base', Q.piz],` },
  // El pie del personal se mide por DÓNDE SALE, no por lo que dice: las dos
  // superficies tienen que pasar `plantilla.sub` tal cual. Armar uno a mano
  // —que es lo que hice primero— pierde la semana y abre una segunda regla
  // para decidir cuándo el desglose es publicable.
  { nombre: 'el tablero se escribe su propio pie del personal en vez de usar el de la cuenta',
    de: `          <Kpi label="Personal" value={plantilla.valor} sub={plantilla.sub}`,
    a:  `          <Kpi label="Personal" value={plantilla.valor} sub={plantilla.dir + "D"}` },
  { nombre: 'el PDF se escribe el suyo',
    de: `    ['Personal', plantilla.valor, plantilla.sub,`,
    a:  `    ['Personal', plantilla.valor, plantilla.dir + "D",` },
  { nombre: 'el signo del atraso se pierde y el adelanto se lee como atraso',
    de: `  return { valor: \`−\${Math.abs(d)} d\`, sub: \`de adelanto, \${contra}\`, dias: d, color: C.greenDk };`,
    a:  `  return { valor: \`\${Math.abs(d)} d\`, sub: \`de adelanto, \${contra}\`, dias: d, color: C.greenDk };` },
  { nombre: 'el ejecutado deja de decir que incluye el almacén y el rótulo afirma de menos',
    de: `              ? \`\${NUM(pctEjec,1)}% del contrato · incluye almacén · ver ›\``,
    a:  `              ? \`\${NUM(pctEjec,1)}% del contrato · ver ›\`` },
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
let kpiDesviacionPlazo, plantillaDeObra;
try {
  ({ kpiDesviacionPlazo, plantillaDeObra } =
    deArchivo(ARCHIVO_APP, 'kpiDesviacionPlazo', 'plantillaDeObra'));
} catch (e) {
  noArranco([`no se pudieron extraer las piezas del KPI: ${e.message}`], 'src/App.jsx');
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

const src = fs.readFileSync(ARCHIVO_APP, 'utf8');

// ── LAS DOS LISTAS, EXTRAÍDAS DEL FUENTE ───────────────────────────────────
// Del tablero: los `<Kpi label="…">` del bloque 1 de `Dashboard`.
const iniTablero = src.indexOf('BLOQUE 1: KPIs PRINCIPALES');
const finTablero = src.indexOf('BLOQUE 1.5', iniTablero);
if (iniTablero < 0 || finTablero < 0)
  noArranco(['no se halló el bloque 1 de KPIs del tablero'], 'src/App.jsx');
const delTablero = [...src.slice(iniTablero, finTablero)
  .matchAll(/<Kpi label="([^"]+)"/g)].map(m => m[1]);

// Del PDF: los rótulos de los `kpiRow` de la sección «2  INDICADORES».
// Hasta «LA COBRANZA, APARTE DE LOS SEIS»: esa fila existe a propósito y no
// es un indicador de la obra —es el estado del cobro, y este documento es el
// único que lo lleva—. Medirla aquí haría que la lista de seis se «arreglara»
// borrando dinero del informe, que es exactamente lo que pasó al fijarla.
const iniPdf = src.indexOf("secHead('2  INDICADORES'");
const finPdf = src.indexOf('LA COBRANZA, APARTE DE LOS SEIS', iniPdf);
if (iniPdf < 0 || finPdf < 0)
  noArranco(['no se halló la sección de indicadores del PDF'], 'src/App.jsx');
const delPdf = [...src.slice(iniPdf, finPdf).matchAll(/^\s*\['([^']+)',/gm)].map(m => m[1]);

const ACORDADOS = ['Presupuesto total', 'Ejecutado', 'Gasto acumulado',
                   'Margen', 'Personal', 'Días de atraso'];
const RETIRADOS = ['Por ejecutar', 'Avance físico', 'Contratado',
                   'Margen bruto', 'Ejecutado + almacén',
                   'Personal campo', 'Personal en campo', 'Gasto total'];

console.log('\n── LOS SEIS INDICADORES DE UNA OBRA ──\n');

console.log('§1 · el tablero publica los seis acordados, y nada más');
for (const k of ACORDADOS)
  check(delTablero.includes(k), `está «${k}»`, delTablero.includes(k) ? '' : 'FALTA');
const sobranT = delTablero.filter(k => !ACORDADOS.includes(k));
check(sobranT.length === 0, 'y no publica ninguno de los retirados',
  sobranT.length ? `SOBRA: ${sobranT.join(', ')}` : `${delTablero.length} indicadores`);

console.log('\n§2 · el PDF publica EXACTAMENTE los mismos');
for (const k of ACORDADOS)
  check(delPdf.includes(k), `está «${k}»`, delPdf.includes(k) ? '' : 'FALTA');
const sobranP = delPdf.filter(k => !ACORDADOS.includes(k));
check(sobranP.length === 0, 'y ninguno de más',
  sobranP.length ? `SOBRA: ${sobranP.join(', ')}` : `${delPdf.length} indicadores`);

console.log('\n§3 · y las dos listas son la MISMA lista');
const mismo = JSON.stringify([...delTablero].sort()) === JSON.stringify([...delPdf].sort());
check(mismo, 'pantalla y papel no pueden publicar indicadores distintos de la misma obra',
  mismo ? '' : `pantalla: ${delTablero.join(', ')} · papel: ${delPdf.join(', ')}`);
for (const viejo of RETIRADOS)
  check(!delTablero.includes(viejo) && !delPdf.includes(viejo),
    `«${viejo}» ya no se publica en ninguna de las dos`);

// ── §3b · EL RÓTULO SE ACORTÓ; LO QUE LA CIFRA CONTIENE NO ────────────────
//
// La lista pide «Ejecutado», y el número es ejecutado + ALMACÉN. Mientras el
// rótulo decía «Ejecutado + almacén» eso se leía solo; con el rótulo corto,
// si el pie tampoco lo dice, la tarjeta afirma menos de lo que la cifra
// contiene — y es el desajuste por el que este KPI y el de estimaciones
// llegaron a enseñar dos cifras distintas llamadas igual.
console.log('\n§3b · «Ejecutado» dice en el pie que incluye el almacén');
const pieTablero = src.slice(iniTablero, finTablero);
const piePdf = src.slice(iniPdf, finPdf);
check(/incluye almacén/.test(pieTablero),
  'el tablero lo dice', /incluye almacén/.test(pieTablero) ? '' : 'NO LO DICE');
check(/incluye almacén/.test(piePdf),
  'y el PDF también', /incluye almacén/.test(piePdf) ? '' : 'NO LO DICE');

console.log('\n§4 · los días de atraso, ejecutados: el signo es la mitad del dato');
const CASOS = [
  [{ desviacionDias: 12, ampliado: false }, '+12 d', /atraso/i, 'doce días tarde'],
  [{ desviacionDias: -8, ampliado: false }, '−8 d',  /adelanto/i, 'ocho días antes'],
  [{ desviacionDias: 0,  ampliado: false }, 'en el plazo', /justo/i, 'justo a tiempo'],
];
for (const [proy, valor, subRe, porque] of CASOS) {
  const r = kpiDesviacionPlazo(proy);
  check(r.valor === valor && subRe.test(r.sub), `${porque} → «${valor}»`,
    `${r.valor} · ${r.sub}`);
}
check(kpiDesviacionPlazo({ desviacionDias: -8, ampliado: false }).valor.startsWith('−'),
  'el adelanto lleva signo: sin él, «8 d» se lee como atraso',
  kpiDesviacionPlazo({ desviacionDias: -8, ampliado: false }).valor);
check(/plazo ampliado/.test(kpiDesviacionPlazo({ desviacionDias: 5, ampliado: true }).sub),
  'y dice contra QUÉ plazo se mide, que es lo que cambia quién va tarde',
  kpiDesviacionPlazo({ desviacionDias: 5, ampliado: true }).sub);

console.log('\n§5 · el personal: el desglose sólo si alguien lo declaró');
// La forma REAL de una carga: el desglose viene en `totalDir`/`totalInd`, y
// la procedencia la deciden los contadores `tipoDeColumna`/`tipoDePuesto` de
// cada parte. Se construye así y no con un `diDe` tecleado porque un fixture
// que se salta esa cadena mide el fixture, no la pieza.
const semana = (partes) => [{ numSemana: 40, totalDir: 30, totalInd: 5, partes }];
const conColumna = plantillaDeObra(semana([{ tipoDeColumna: 35, tipoDePuesto: 0 }]));
const porPuesto  = plantillaDeObra(semana([{ tipoDeColumna: 20, tipoDePuesto: 15 }]));
check(conColumna.diDe === 'columna',
  'una semana cuyo Excel traía la columna Tipo se distingue', String(conColumna.diDe));
check(porPuesto.diDe !== 'columna',
  'y una cuyo desglose se dedujo del puesto también', String(porPuesto.diDe));
check(conColumna.total === porPuesto.total,
  'el TOTAL se publica en los dos casos: es un conteo y vale',
  `${conColumna.total} / ${porPuesto.total}`);
// La decisión de imprimir o no el desglose vive en el JSX y en el arreglo del
// PDF; aquí se comprueba que las DOS la toman mirando `diDe`, no `total`.
// Las dos superficies pasan `plantilla.sub` TAL CUAL. Ahí es donde vive la
// decisión de publicar o no el desglose, y donde ya se dice de qué semana son
// las cifras. Una pantalla que se escriba su propio pie pierde eso y abre una
// segunda regla; se mide que no lo haga.
check((src.match(/sub=\{plantilla\.sub\}/g) || []).length === 1,
  'el tablero pasa el pie de la cuenta, no uno propio',
  `${(src.match(/sub=\{plantilla\.sub\}/g) || []).length} de 1`);
check(/\['Personal', plantilla\.valor, plantilla\.sub,/.test(src),
  'y el PDF también');
check(!/\$\{plantilla\.dir\}/.test(src),
  'y ninguna de las dos arma «N directos» por su cuenta',
  /\$\{plantilla\.dir\}/.test(src) ? 'ALGUIEN LO ARMA' : '');

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'la obra se resume con los mismos seis números en la pantalla y en el papel.'
  : 'el tablero y el PDF vuelven a publicar listas distintas de la misma obra.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
