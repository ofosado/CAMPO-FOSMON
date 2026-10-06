#!/usr/bin/env node
// Prueba: los días de atraso o de adelanto, como KPI, con el signo puesto y
// sin inventar un cero.
//
// POR QUÉ ESTA PRUEBA. Hasta hoy la desviación contra el plazo se decía en un
// párrafo de treinta palabras debajo del tablero de avance. El párrafo era
// correcto y nadie lo leía. Ahora es un número con signo —«−27 d» o «+55 d»—
// y al comprimirlo aparecen tres maneras nuevas de mentir, que son las que se
// miden aquí:
//
//   1. PERDER EL SIGNO. `27 d` no dice si la obra llega antes o tarde. Es el
//      riesgo específico de pasar de una frase a un número: la frase decía
//      «antes» o «DESPUÉS» con palabras, el número sólo lo dice con el signo.
//      Y entre los dos casos hay 54 días de diferencia.
//   2. INVENTAR UN CERO. Hay CINCO razones distintas por las que puede no
//      haber desviación que enseñar, y la peor —la obra detenida o en
//      retroceso— es la que más se parece a «todo bien». Un `0 d` ahí se lee
//      como «justo en el plazo», que es la mentira más cómoda de todas.
//   3. QUE LAS DOS PANTALLAS NO COINCIDAN. El mismo número sale en el tablero
//      de avance y en el de plazo de la dependencia. «¿Cuántos días lleva de
//      retraso?» tiene una sola respuesta buena; dos cuentas acabarían
//      contradiciéndose en la misma sesión, y entonces la pantalla deja de
//      servir para decidir nada.
//
// Lo que se afirma es CONDUCTA: el TEXTO y el COLOR que salen a pantalla. La
// paleta se extrae de la de verdad, los KPI se renderizan con React y las dos
// expresiones `desvPlazo` —una por pantalla— se EJECUTAN con los mismos datos
// para poder comparar lo que cada una produce. No se afirma que exista ningún
// nombre (P3).
//
// Uso:  node scripts/prueba-desviacion-plazo.cjs [archivo.jsx]
//       node scripts/prueba-desviacion-plazo.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const archivo = process.argv.find(a => a.endsWith('.jsx')) || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'] });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Extracción del código real ─────────────────────────────────────────────
// Todo lo que hace falta para que la cuenta corra de punta a punta. Se pide por
// nombre sólo para PODER EJECUTARLO; lo que se afirma más abajo es lo que sale.
const NECESARIOS = [
  'tok', 'C', 'NUM',
  'fechaLocalDeISO', 'hoyLocalISO', 'snapshotId', 'semanaISO',
  'lunesDeClaveSemana', 'sonComparables',
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'finVigenteDe', 'estadoPorSemana', 'corteDeEstimaciones', 'FRASE_SIN_CORTE_EST',
  'montoEjecutadoSnap', 'montoEstimadoSnap', 'montoPagadoSnap',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'SIN_PROY_POCOS_CIERRES', 'SIN_PROY_NO_COMPARABLES', 'SIN_PROY_SIN_AVANCE',
  'proyeccionDeAvance', 'frasePorQueSinDesviacion', 'kpiDesviacionPlazo',
];

const trozos = [];           // declaraciones completas, en orden de fuente
const vistos = new Set();
const rango = {};            // para poder mutar el original en la contraprueba
// Las dos expresiones `desvPlazo`, una por pantalla, con el nombre de la
// función donde viven. Se localizan por lo que ALIMENTAN, no por su posición.
const cuentas = [];
let kpiContraPlazo = null;   // el <Kpi> del tablero de avance
let tarjetaPlazo = null;     // el <Card> de «Plazo» del tablero de dependencia
let fuenteAvance = null;     // el cuerpo del tablero de avance, para el párrafo

const nombreDeFuncionPadre = (p) => {
  let q = p;
  while (q) {
    if (q.node.type === 'FunctionDeclaration' && q.node.id) return q.node.id.name;
    q = q.parentPath;
  }
  return '(anónima)';
};

traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    const n = d?.id?.name;
    if (n && NECESARIOS.includes(n) && !vistos.has(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
      if (d.init) rango[n] = [d.init.start, d.init.end];
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && n && NECESARIOS.includes(n) && !vistos.has(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
    // El tablero de avance se localiza por el párrafo que YA NO debe pintar.
    if (p.parent.type === 'Program' && /\bdesvPlazo\b/.test(src.slice(p.node.start, p.node.end))
        && /avanceFisicoPonderado/.test(src.slice(p.node.start, p.node.end))
        && fuenteAvance === null) {
      fuenteAvance = src.slice(p.node.start, p.node.end);
    }
  },
  // Las dos cuentas de la desviación. NO se buscan por posición: se busca
  // cualquier variable local que alimente a un KPI de desviación, y se espera
  // encontrar DOS. Si mañana hay una tercera pantalla, esta prueba la recoge
  // sola y exige que diga lo mismo que las otras dos.
  VariableDeclarator(p) {
    if (p.node.id?.name !== 'desvPlazo' || !p.node.init) return;
    cuentas.push({ donde: nombreDeFuncionPadre(p), fuente: src.slice(p.node.init.start, p.node.init.end) });
  },
  JSXElement(p) {
    const abre = p.node.openingElement;
    const txt = src.slice(p.node.start, p.node.end);
    if (abre.name?.name === 'Kpi' && !kpiContraPlazo
        && /label\s*=\s*"Contra el plazo"/.test(txt)) {
      kpiContraPlazo = txt;
    }
    if (abre.name?.name === 'Card' && !tarjetaPlazo
        && /<Tit>Plazo<\/Tit>/.test(txt) && /desvPlazo/.test(txt)) {
      tarjetaPlazo = txt;
    }
  },
});

const faltan = NECESARIOS.filter(n => !vistos.has(n));
// Estos cuatro no se piden por nombre sino por lo que hacen o lo que dicen. Si
// no aparecen, no es un renombre: es que el sitio dejó de existir, y el efecto
// es el mismo — la conducta se quedó sin mirar.
if (!kpiContraPlazo) faltan.push('el KPI «Contra el plazo» del tablero de avance');
if (!tarjetaPlazo)   faltan.push('la tarjeta «Plazo» del tablero de dependencia');
if (!fuenteAvance)   faltan.push('el tablero de avance');
if (cuentas.length < 2) faltan.push(`las dos cuentas de desviación (encontradas ${cuentas.length})`);
if (faltan.length) noArranco(faltan, path.basename(archivo));

// ── Contraprueba ──────────────────────────────────────────────────────────
// Se le quita el SIGNO al KPI, que es el defecto específico de comprimir una
// frase en un número. Todo lo demás queda intacto: el nombre sigue existiendo,
// las dos pantallas siguen llamándolo, los colores siguen siendo los mismos y
// las cinco razones siguen diciéndose. Lo único que cambia es que «llegó 27
// días antes» y «llegó 27 días tarde» pasan a escribirse igual.
if (process.argv.includes('--contraprueba')) {
  const sinSigno = `((proy) => {
    const porque = frasePorQueSinDesviacion(proy);
    if (porque !== null) return { valor: '—', sub: porque, dias: null, color: C.textMut };
    const d = proy.desviacionDias;
    const contra = proy.ampliado ? 'del plazo ampliado' : 'del plazo del contrato';
    if (d === 0) return { valor: 'en el plazo', sub: 'justo ' + contra, dias: 0, color: C.greenDk };
    return { valor: Math.abs(d) + ' d', sub: 'de atraso, ' + contra, dias: d,
             color: d > 15 ? C.red : d > 0 ? C.yellow : C.greenDk };
  })`;
  const [ini, fin] = rango.kpiDesviacionPlazo;
  const mutado = path.join(require('os').tmpdir(), 'contraprueba-desviacion-plazo.jsx');
  fs.writeFileSync(mutado, src.slice(0, ini) + sinSigno + src.slice(fin));
  console.log('Contraprueba: el KPI pierde el signo. «27 días antes» y «27 días');
  console.log('tarde» se escriben igual. Todo lo demás queda en su sitio.\n');
  const r = require('child_process').spawnSync(process.execPath, [__filename, mutado],
    { encoding: 'utf8' });
  const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
  console.log(r.stdout.replace(/^/gm, '  │ '));
  console.log(rojas > 0
    ? `Contraprueba correcta: ${rojas} comprobación(es) se cayeron al borrar el signo.`
    : 'CONTRAPRUEBA EN ROJO: borrar el signo no tumbó nada. La prueba no sirve.');
  process.exit(rojas > 0 ? 0 : 1);
}

const app = new Function(`"use strict";\n${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const { C, kpiDesviacionPlazo, proyeccionDeAvance, estadoPorSemana, snapshotId,
  ESQUEMA_AVANCE, SIN_PROY_SIN_AVANCE, SIN_PROY_NO_COMPARABLES,
  SIN_PROY_POCOS_CIERRES } = app;

console.log(`\nArchivo:   ${path.relative(raiz, archivo)}`);
console.log(`Cuentas de desviación encontradas: ${cuentas.map(c => c.donde).join(', ')}\n`);

// Nombre legible de un color de la paleta, para que el detalle del renglón diga
// «verde» y no «#2f6f4e».
const nombreColor = (hex) => Object.keys(C).find(k => C[k] === hex) || hex;

// ══════════════════════════════════════════════════════════════════════════
console.log('1. El signo, que es la mitad del dato\n');

const proyCon = (desviacionDias, extra = {}) => ({
  desviacionDias, razon: null, ampliado: false, velocidad: 1.5,
  semanasBase: 4, fechaFin: new Date('2026-11-03T12:00:00'), ...extra,
});

const adelanto = kpiDesviacionPlazo(proyCon(-27));
check(/^−27 d$/.test(adelanto.valor),
  'veintisiete días antes del plazo se escriben «−27 d», con el menos delante',
  `«${adelanto.valor}»`);
check(adelanto.color === C.greenDk, 'y en verde', nombreColor(adelanto.color));
check(/adelanto/i.test(adelanto.sub) && !/atraso/i.test(adelanto.sub),
  'el renglón de abajo dice adelanto y no atraso', `«${adelanto.sub}»`);

const atraso = kpiDesviacionPlazo(proyCon(55));
check(/^\+55 d$/.test(atraso.valor),
  'cincuenta y cinco días después se escriben «+55 d», con el más delante',
  `«${atraso.valor}»`);
check(atraso.color === C.red, 'y en rojo', nombreColor(atraso.color));
check(/atraso/i.test(atraso.sub) && !/adelanto/i.test(atraso.sub),
  'el renglón de abajo dice atraso', `«${atraso.sub}»`);

// LO QUE IMPORTA de esta sección: los dos casos tienen que ser DISTINGUIBLES
// entre sí. Es el defecto que la contraprueba introduce, y el único que importa.
check(adelanto.valor !== atraso.valor.replace('+', '−')
      || adelanto.valor !== atraso.valor,
  'y los dos casos no se escriben igual',
  `${adelanto.valor} ≠ ${atraso.valor}`);
check(kpiDesviacionPlazo(proyCon(-27)).valor !== kpiDesviacionPlazo(proyCon(27)).valor,
  'veintisiete antes y veintisiete después no se confunden',
  `${kpiDesviacionPlazo(proyCon(-27)).valor} vs ${kpiDesviacionPlazo(proyCon(27)).valor}`);

// Una semana tarde no es una emergencia, y pintarla de rojo enseña a ignorar
// el rojo. Dos umbrales, no uno.
const poco = kpiDesviacionPlazo(proyCon(7));
check(poco.color === C.yellow,
  'una semana de atraso sale en ámbar, no en rojo: el rojo se gasta si grita siempre',
  `+7 d en ${nombreColor(poco.color)}`);

const justo = kpiDesviacionPlazo(proyCon(0));
check(!/^0/.test(justo.valor) && /plazo/i.test(justo.valor),
  'caer justo en el plazo se dice con palabras, no con un «0 d» que se lee como «no hay dato»',
  `«${justo.valor}»`);

// Contra QUÉ fecha se mide. Un plazo ampliado que no se declara se lee como el
// del contrato firmado, y eso cambia quién va tarde.
const ampl = kpiDesviacionPlazo(proyCon(12, { ampliado: true }));
check(/ampliado/i.test(ampl.sub),
  'si el plazo está ampliado, el KPI lo declara', `«${ampl.sub}»`);
check(!/ampliado/i.test(atraso.sub),
  'y si no lo está, dice que es el del contrato', `«${atraso.sub}»`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n2. Las cinco razones por las que puede no haber número — y ningún cero\n');

const SIN_DATO = [
  ['la obra no avanza',   { razon: SIN_PROY_SIN_AVANCE, velocidad: 0 }],
  ['la obra retrocede',   { razon: SIN_PROY_SIN_AVANCE, velocidad: -0.8 }],
  ['cierres no comparables', { razon: SIN_PROY_NO_COMPARABLES }],
  ['hay un solo cierre',  { razon: SIN_PROY_POCOS_CIERRES }],
  // El caso que el KPI escrito a mano contestaba mal: proyección perfecta, pero
  // la obra no tiene plazo capturado. Decirle «requiere 2 cierres» manda al
  // director a buscar el problema donde no está.
  ['la obra no tiene plazo capturado', { razon: null }],
];
const subs = new Set();
for (const [caso, extra] of SIN_DATO) {
  const k = kpiDesviacionPlazo({ desviacionDias: null, ampliado: false, semanasBase: 1, ...extra });
  subs.add(k.sub);
  check(k.valor === '—' && k.dias === null,
    `${caso}: no sale ninguna cifra`, `«${k.valor}» · ${k.sub}`);
}
check(subs.size === SIN_DATO.length,
  'las cinco razones se dicen con cinco frases distintas, no con una sola',
  `${subs.size} frase(s) para ${SIN_DATO.length} caso(s)`);
check([...subs].every(s => s && s.length > 3),
  'y ninguna se queda en blanco');

const detenida = kpiDesviacionPlazo({ desviacionDias: null, razon: SIN_PROY_SIN_AVANCE, velocidad: -1 });
const pocos = kpiDesviacionPlazo({ desviacionDias: null, razon: SIN_PROY_POCOS_CIERRES });
check(detenida.color === C.red && pocos.color !== C.red,
  'la obra detenida se pinta en rojo; «faltan cierres» no, porque no es lo mismo',
  `detenida=${nombreColor(detenida.color)} · pocos cierres=${nombreColor(pocos.color)}`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n3. La cuenta completa, desde el historial semanal\n');

// Cuatro cierres reales, de 44% a 56% en tres semanas: 4 pp por semana. Con
// 44 pp pendientes son 11 semanas más, o sea 77 días desde hoy.
const AHORA = new Date('2026-10-06T12:00:00').getTime();
const historial = [0, 1, 2, 3].map(k => {
  const f = new Date(AHORA - (4 - k) * 7 * 86400000);
  const semana = Math.ceil(((f - new Date(f.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
  const avance = 44 + k * 4;
  return { id: snapshotId(semana, f.getFullYear()), semana, año: f.getFullYear(),
    tipo: 'oficial', fechaCaptura: f.toISOString(), fechaCierre: f.toISOString(),
    capturadoPor: 'prueba@local', subs: [], avancePonderado: avance,
    contratoRef: 10000000, esquema: ESQUEMA_AVANCE };
});
const estados = estadoPorSemana(historial);
const obraTarde = { inicio: '2026-03-01', fin: '2026-11-30' };
const kTarde = kpiDesviacionPlazo(proyeccionDeAvance(estados, 56, obraTarde, AHORA));
check(/^\+\d+ d$/.test(kTarde.valor),
  'con el plazo al 30 de noviembre, la obra sale con signo de atraso',
  `${kTarde.valor} · ${kTarde.sub}`);

// La MISMA obra con el plazo un año después tiene que salir con el signo al
// revés. Es la comprobación de que el signo sale del dato y no está escrito.
const obraSobrada = { inicio: '2026-03-01', fin: '2027-11-30' };
const kSobra = kpiDesviacionPlazo(proyeccionDeAvance(estados, 56, obraSobrada, AHORA));
check(/^−\d+ d$/.test(kSobra.valor),
  'y con el plazo un año más lejos, con signo de adelanto',
  `${kSobra.valor} · ${kSobra.sub}`);

// El plazo AMPLIADO manda sobre el del contrato, y el KPI lo declara. Si no lo
// declarara, el lector mediría contra la fecha equivocada sin enterarse.
const obraAmpliada = { inicio: '2026-03-01', fin: '2026-11-30', finAmpliado: '2027-11-30' };
const kAmpl = kpiDesviacionPlazo(proyeccionDeAvance(estados, 56, obraAmpliada, AHORA));
check(kAmpl.valor === kSobra.valor && /ampliado/i.test(kAmpl.sub),
  'la ampliación mueve la cuenta Y queda declarada en el renglón de abajo',
  `${kAmpl.valor} · ${kAmpl.sub}`);

// Una obra detenida no proyecta nada, y lo que se dice es que está detenida.
const plana = historial.map(s => ({ ...s, avancePonderado: 44 }));
const kPlana = kpiDesviacionPlazo(proyeccionDeAvance(estadoPorSemana(plana), 44, obraTarde, AHORA));
check(kPlana.valor === '—' && /no avanza/i.test(kPlana.sub) && kPlana.color === C.red,
  'una obra que no se movió en cuatro cierres no proyecta fecha: lo dice, y en rojo',
  `«${kPlana.valor}» · ${kPlana.sub}`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n4. Las dos pantallas, una sola cuenta\n');

// Se ejecutan las DOS expresiones `desvPlazo` del código con los MISMOS datos y
// se compara lo que produce cada una. Es el cable A→B: una prueba puede cubrir
// que la cuenta está bien y que la pantalla la pinta, y seguir sin cubrir que
// la pantalla pinta ESA cuenta.
const correrCuenta = (fuente) => new Function(
  'kpiDesviacionPlazo', 'proyeccionDeAvance', 'estadoPorSemana',
  'estados', 'estadosSemana', 'avanceActual', 'avance', 'obra', 'proy',
  `"use strict"; return ${fuente};`)(
  kpiDesviacionPlazo, (e, a, o) => proyeccionDeAvance(e, a, o, AHORA), estadoPorSemana,
  estados, estados, 56, 56, obraTarde, proyeccionDeAvance(estados, 56, obraTarde, AHORA));

const resultados = cuentas.map(c => ({ donde: c.donde, k: correrCuenta(c.fuente) }));
for (const r of resultados) console.log(`       ${r.donde}: ${r.k.valor} · ${r.k.sub}`);
const distintos = new Set(resultados.map(r => `${r.k.valor}|${r.k.sub}|${r.k.color}`));
check(distintos.size === 1,
  `las ${resultados.length} pantallas que lo dicen dicen lo mismo, hasta el color`,
  distintos.size === 1 ? resultados[0].k.valor : [...distintos].join('  ≠  '));
check(resultados.every(r => r.k.valor === kTarde.valor),
  'y es la cuenta de verdad, no una copia que se quedó atrás', kTarde.valor);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n5. Lo que sale pintado\n');

const Kpi = ({ label, value, sub }) => React.createElement('div', null, `${label} = ${value} (${sub}) `);
const Tit = ({ children }) => React.createElement('div', null, children, ' ');
const Card = ({ children }) => React.createElement('div', null, children);
const Bar = () => React.createElement('div', null, ' ');
const pintar = (jsx, vars) => {
  const js = esbuild.transformSync(`(${jsx})`, { loader: 'jsx' }).code;
  const nombres = Object.keys(vars);
  const el = new Function('React', 'Kpi', 'Tit', 'Card', 'Bar', ...nombres,
    `"use strict"; return ${js};`)(React, Kpi, Tit, Card, Bar, ...nombres.map(n => vars[n]));
  return renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

const textoKpi = pintar(kpiContraPlazo, { desvPlazo: kTarde });
console.log(`       « ${textoKpi} »`);
check(textoKpi.includes(kTarde.valor) && textoKpi.includes(kTarde.sub),
  'el tablero de avance pinta el número con su signo y la razón debajo');
check(/Contra el plazo/.test(textoKpi),
  'y dice contra qué se está comparando en la etiqueta');

const textoTarjeta = pintar(tarjetaPlazo, {
  desvPlazo: kTarde, C, pctPlazo: 86.4, totalDias: 274, transcurridos: 219,
  restantes: 55, ampliado: false, ampliaciones: [], obra: obraTarde,
  finVigente: '2026-11-30', NUM: app.NUM,
});
console.log(`       « ${textoTarjeta} »`);
check(textoTarjeta.includes(kTarde.valor),
  'la tarjeta de plazo de la dependencia pinta el MISMO número', kTarde.valor);
// LO QUE IMPORTA: «86.4% del plazo» y «+77 d de atraso» son dos cosas
// distintas. La barra dice cuánto calendario se gastó —la obra podría ir al 2%—
// y el KPI dice si al ritmo medido llega. Las dos tienen que estar, y la de
// arriba no puede sustituir a la otra.
check(/86\.4/.test(textoTarjeta) && textoTarjeta.includes(kTarde.valor),
  'junto al porcentaje de plazo consumido, que es otra pregunta y no la sustituye');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n6. El párrafo que se quitó\n');

check(!/Se compara contra/.test(fuenteAvance),
  'el tablero de avance ya no puede pintar el párrafo de treinta palabras');
check(!/Al ritmo de los últimos \$\{/.test(fuenteAvance),
  'ni la frase que lo abría');
// Pero NO se perdió ninguna de las razones por el camino: siguen saliendo, en
// el renglón de abajo del KPI, que es el único sitio donde el lector las
// necesita. Esto es lo que separa «quitar un párrafo» de «esconder un aviso».
check(SIN_DATO.every(([, extra]) =>
  kpiDesviacionPlazo({ desviacionDias: null, ampliado: false, ...extra }).sub),
  'y las cinco razones del párrafo siguen diciéndose en el KPI');

// ══════════════════════════════════════════════════════════════════════════
console.log('');
if (fallas) {
  console.log(`${fallas} comprobación(es) en rojo.`);
  process.exit(1);
}
console.log('Todas las comprobaciones en verde.');
