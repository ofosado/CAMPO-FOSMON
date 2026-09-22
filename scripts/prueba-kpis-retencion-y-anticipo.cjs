#!/usr/bin/env node
// Prueba de dos cosas del Resumen económico de Estimaciones:
//
//   A. Una retención pactada en CERO no ocupa lugar en la rejilla. "Retenido
//      FG · fondo 0% · $0" no contesta ninguna pregunta. Medido contra
//      producción el 2026-09-22: `pctFondoGar` está en 0 en LAS CINCO obras,
//      así que ese KPI era ruido en todas; `pctRetencion` está en 0 en cuatro.
//
//   B. "Por recuperar ant." se ve siempre que haya anticipo pactado, haya o no
//      estimaciones. Antes se calculaba como la amortización embebida en las
//      estimaciones NO pagadas, que es otra pregunta: la 0114 (todo cobrado) y
//      la 0127 (sin estimaciones) daban $0 teniendo $16.3M y $41.9M sin
//      amortizar. Un $0 ahí se lee como "ya no debemos nada".
//
// No comprueba que exista un `if`. Para la visibilidad localiza cada KPI por su
// etiqueta, extrae la condición que REALMENTE lo gobierna —sea cual sea— y la
// evalúa contra las cinco obras de producción. Para las cifras extrae las
// declaraciones de `Estimaciones` y las ejecuta.
//
// Uso:  node scripts/prueba-kpis-retencion-y-anticipo.cjs [archivo]

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Extracción, acotada a `Estimaciones` ──────────────────────────────────
// Hay otros `cE` y otros `totalEst` en el módulo; tomar el primero del archivo
// mediría otra pantalla.
let decl = null;
const guardas = {};          // etiqueta del Kpi -> código de la condición que lo tapa
traverse(ast, {
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'Estimaciones') return;
    decl = {};
    p.traverse({
      VariableDeclarator(q) {
        if (q.node.id.type === 'Identifier' && q.node.init)
          decl[q.node.id.name] ||= src.slice(q.node.init.start, q.node.init.end);
      },
      // Para cada <Kpi label="..."/>, subir hasta el `&&` más cercano que lo
      // tenga del lado derecho. Esa es la condición que decide si se pinta,
      // la haya escrito quien la haya escrito.
      JSXOpeningElement(q) {
        if (q.node.name.name !== 'Kpi') return;
        const attr = q.node.attributes.find(a => a.name?.name === 'label');
        const label = attr?.value?.value;
        if (!label) return;
        let n = q.parentPath;                      // el JSXElement
        while (n) {
          if (n.node.type === 'LogicalExpression' && n.node.operator === '&&') {
            guardas[label] ??= src.slice(n.node.left.start, n.node.left.end);
            return;
          }
          if (n.node.type === 'FunctionDeclaration') break;
          n = n.parentPath;
        }
        guardas[label] ??= null;                   // sin condición: siempre visible
      },
    });
  },
});
if (!decl) { console.log('No se pudo extraer `Estimaciones`.'); process.exit(1); }

const NECESARIAS = ['cE', 'totalEst', 'retenido', 'retenEstra',
  'anticipoPactado', 'anticipoAmort', 'porRecuperarAnt'];
for (const n of NECESARIAS)
  if (!decl[n]) check(false, `se pudo extraer \`${n}\``);
if (fallas) { console.log('\nNo se pudo montar la prueba.'); process.exit(1); }

const montar = (obra, estimaciones) => new Function('obra', 'estimaciones', `
  "use strict";
  ${NECESARIAS.map(n => `const ${n} = ${decl[n]};`).join('\n  ')}
  return { retenido, retenEstra, anticipoPactado, anticipoAmort, porRecuperarAnt };
`)(obra, estimaciones);

// ¿Se pinta este KPI para esta obra? Se evalúa la condición real.
const seVe = (label, obra, estimaciones) => {
  if (!(label in guardas)) return null;            // el KPI ya no existe
  if (guardas[label] === null) return true;        // sin condición
  return !!new Function('obra', 'estimaciones',
    `"use strict"; return (${guardas[label]});`)(obra, estimaciones);
};

// ── Las cinco obras de producción, leídas el 2026-09-22 ───────────────────
// Copiadas de `obras/{id}` y `obras/{id}/config/{parametros,estimaciones}` con
// scripts/anticipo-por-recuperar.py, que es de solo lectura. Van aquí y no en
// un archivo aparte para que la prueba no dependa de nada externo.
const PROD = {
  '0112': { presupuesto: 25849801.33, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 0,
    est: [{ no:1, estatus:'Pagada',    monto: 6290869.59 },
          { no:2, estatus:'Pagada',    monto: 4896107.97 },
          { no:3, estatus:'Pagada',    monto: 6616095.77 },
          { no:4, estatus:'Facturada', monto: 3680420.19 },
          { no:5, estatus:'Facturada', monto: 2778026.78 }] },
  '0114': { presupuesto: 163703079.43, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 20,
    est: [{ no:1, estatus:'Pagada', monto: 47087183.32 },
          { no:2, estatus:'Pagada', monto: 62153353.98 }] },
  '0125': { presupuesto: 126536301.46, pctAnticipo: 0, pctFondoGar: 0, pctRetencion: 0,
    est: [] },
  '0126': { presupuesto: 75635416.41, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 0,
    est: [{ no:1, estatus:'Facturada',  monto:    73180.96 },
          { no:2, estatus:'Facturada',  monto:  2252743.18 },
          { no:3, estatus:'En proceso', monto: 11206520.36 }] },
  '0127': { presupuesto: 144596003.2, pctAnticipo: 29, pctFondoGar: 0, pctRetencion: 0,
    est: [] },
};
const NOMBRE = { '0112': 'Andadores', '0114': 'Malecón', '0125': 'TAMSA',
                 '0126': 'Área 41', '0127': 'Centro de Convenciones' };
const MXN = n => '$' + Math.round(n).toLocaleString('es-MX');
const casi = (a, b) => Math.abs(a - b) < 1;

// Cómo se calculaba ANTES, para poder afirmar que cambió y en cuánto.
const comoAntes = (obra, est) =>
  est.filter(e => e.estatus !== 'Pagada')
     .reduce((t, e) => t + e.monto * obra.pctAnticipo / 100, 0);

console.log('A. Una retención pactada en cero no ocupa lugar');
for (const [id, d] of Object.entries(PROD)) {
  const obra = { presupuesto: d.presupuesto, pctAnticipo: d.pctAnticipo,
                 pctFondoGar: d.pctFondoGar, pctRetencion: d.pctRetencion };
  check(seVe('Retenido FG', obra, d.est) === (d.pctFondoGar > 0),
    `${NOMBRE[id]}: FG al ${d.pctFondoGar}% → ${d.pctFondoGar > 0 ? 'se ve' : 'no se ve'}`);
  check(seVe('Ret. estratégica', obra, d.est) === (d.pctRetencion > 0),
    `${NOMBRE[id]}: ret. estratégica al ${d.pctRetencion}% → ${d.pctRetencion > 0 ? 'se ve' : 'no se ve'}`);
}
// El caso que justificó el cambio: FG está en cero en las cinco.
check(Object.values(PROD).every(d => d.pctFondoGar === 0),
  'las cinco obras tienen FG en 0% — el KPI era ruido en todas');
// Y el criterio es el PORCENTAJE, no el monto: pactada pero aún sin retener
// nada, el $0 sí informa y tiene que verse.
const pactadaSinRetener = { presupuesto: 10e6, pctAnticipo: 0, pctFondoGar: 5, pctRetencion: 0 };
check(seVe('Retenido FG', pactadaSinRetener, []) === true,
  'una FG pactada al 5% sin estimaciones aún SÍ se ve, aunque acumule $0',
  'el criterio es lo pactado, no lo acumulado');

console.log('\nB. "Por recuperar ant." no depende de que haya estimaciones');
for (const [id, d] of Object.entries(PROD)) {
  const obra = { presupuesto: d.presupuesto, pctAnticipo: d.pctAnticipo,
                 pctFondoGar: d.pctFondoGar, pctRetencion: d.pctRetencion };
  const r = montar(obra, d.est);
  const antes = comoAntes(obra, d.est);
  const visible = seVe('Por recuperar ant.', obra, d.est);
  check(visible === (d.pctAnticipo > 0),
    `${NOMBRE[id]}: anticipo al ${d.pctAnticipo}% → ${d.pctAnticipo > 0 ? 'se ve' : 'no se ve'}`);
  if (!visible) continue;
  check(casi(r.anticipoPactado, d.presupuesto * d.pctAnticipo / 100),
    `${NOMBRE[id]}: pactado ${MXN(r.anticipoPactado)}`);
  check(casi(r.porRecuperarAnt, r.anticipoPactado - r.anticipoAmort),
    `${NOMBRE[id]}: por recuperar ${MXN(r.porRecuperarAnt)}`,
    `antes mostraba ${MXN(antes)}`);
}

// Los dos casos que daban $0 y no eran cero.
console.log('\n   Las dos obras que mostraban $0 teniendo anticipo sin amortizar');
for (const [id, esperado] of [['0114', 16_338_763], ['0127', 41_932_841]]) {
  const d = PROD[id];
  const obra = { presupuesto: d.presupuesto, pctAnticipo: d.pctAnticipo,
                 pctFondoGar: d.pctFondoGar, pctRetencion: d.pctRetencion };
  const r = montar(obra, d.est);
  check(comoAntes(obra, d.est) === 0, `${NOMBRE[id]}: antes daba exactamente $0`);
  check(Math.abs(r.porRecuperarAnt - esperado) < 1,
    `${NOMBRE[id]}: ahora ${MXN(r.porRecuperarAnt)}`, `esperado ${MXN(esperado)}`);
  check(r.porRecuperarAnt > 0, `${NOMBRE[id]}: y deja de leerse como "ya no debemos nada"`);
}

// Sin NINGUNA estimación el anticipo pendiente es el anticipo entero: es el
// estado de una obra recién arrancada (0127 hoy) y el que antes salía en cero.
console.log('\n   Una obra sin estimaciones');
const cero = montar({ presupuesto: 100e6, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 0 }, []);
check(casi(cero.porRecuperarAnt, 30e6),
  'sin estimaciones, queda por recuperar el anticipo completo', MXN(cero.porRecuperarAnt));
check(cero.anticipoAmort === 0, 'y lo amortizado es 0, que ahí sí es una medición');

// Todo cobrado tampoco lo apaga: lo que manda es cuánto se amortizó.
const todoPagado = montar({ presupuesto: 100e6, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 0 },
  [{ no: 1, estatus: 'Pagada', monto: 50e6 }]);
check(casi(todoPagado.porRecuperarAnt, 15e6),
  'con todas las estimaciones pagadas sigue dando la cifra real', MXN(todoPagado.porRecuperarAnt));

// El estatus ya no cambia la respuesta — era justo la dependencia a quitar.
const est = [{ no: 1, estatus: 'Pagada', monto: 20e6 }, { no: 2, estatus: 'En proceso', monto: 10e6 }];
const o = { presupuesto: 100e6, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 0 };
const base = montar(o, est).porRecuperarAnt;
const mismos = ['En proceso', 'Aprobada', 'Facturada', 'Pagada'].every(s =>
  casi(montar(o, est.map(e => ({ ...e, estatus: s }))).porRecuperarAnt, base));
check(mismos, 'mover TODAS las estimaciones de estatus no mueve la cifra', MXN(base));

// ── Las tres retenciones miden igual ──────────────────────────────────────
// Fondo de garantía, retención estratégica y amortización de anticipo son el
// mismo tipo de cifra: lo que el contrato descuenta de cada estimación al
// formularla. Si una contara solo las pagadas y las otras todas, la pantalla
// mostraría tres números que parecen comparables y no lo son — que es
// exactamente cómo empezó lo de los dos "Pagado". No se comprueba leyendo el
// código: se mueven los estatus y se verifica que ninguna se inmuta.
console.log('\nC. Las tres retenciones miden sobre las mismas estimaciones');
const ESTATUS = ['En proceso', 'Aprobada', 'Facturada', 'Pagada'];
const oMixta = { presupuesto: 100e6, pctAnticipo: 30, pctFondoGar: 5, pctRetencion: 10 };
const eMixta = [{ no:1, estatus:'Pagada', monto: 20e6 }, { no:2, estatus:'Facturada', monto: 10e6 },
                { no:3, estatus:'En proceso', monto: 5e6 }];
const ref = montar(oMixta, eMixta);
for (const campo of ['retenido', 'retenEstra', 'anticipoAmort']) {
  const inmutable = ESTATUS.every(s =>
    casi(montar(oMixta, eMixta.map(e => ({ ...e, estatus: s })))[campo], ref[campo]));
  check(inmutable, `\`${campo}\` no cambia al mover los estatus`, MXN(ref[campo]));
}
// Y el valor es el del total generado, no el de una porción.
const TOTAL = eMixta.reduce((t, e) => t + e.monto, 0);   // $35M generados
check(casi(ref.retenido,      TOTAL * 0.05), `FG = 5% de los ${MXN(TOTAL)} generados`, MXN(ref.retenido));
check(casi(ref.retenEstra,    TOTAL * 0.10), `ret. estratégica = 10% de lo generado`, MXN(ref.retenEstra));
check(casi(ref.anticipoAmort, TOTAL * 0.30), `amortización = 30% de lo generado`,     MXN(ref.anticipoAmort));
// El contraste que delata a una que contara solo pagadas: serían $20M, no $35M.
const soloPagadas = eMixta.filter(e => e.estatus === 'Pagada').reduce((t, e) => t + e.monto, 0);
check(!casi(ref.retenido, soloPagadas * 0.05) && !casi(ref.retenEstra, soloPagadas * 0.10)
   && !casi(ref.anticipoAmort, soloPagadas * 0.30),
  `ninguna quedó contando solo las pagadas`, `serían sobre ${MXN(soloPagadas)}, no ${MXN(TOTAL)}`);
// Un solo indicador por concepto: nada de "comprometido" junto a "efectivo".
for (const par of [['Retenido FG', 'FG comprometido'], ['Ret. estratégica', 'Ret. comprometida'],
                   ['Por recuperar ant.', 'Anticipo comprometido']])
  check(!(par[1] in guardas), `no hay un segundo KPI "${par[1]}" al lado de "${par[0]}"`);

console.log('\nD. Ninguna de las leyendas de frontera de esquema sigue en pantalla');
const FRASES = [
  'El tramo punteado usa otra definición de avance',
  'El tramo punteado usa otra definición.',
  'El tramo punteado del ejecutado usa otra definición',
  'El avance de las semanas anteriores usa otra definición',
];
// Se buscan en el TEXTO JSX que se renderiza, no en el archivo entero: los
// comentarios que explican por qué se fueron no deben hacer fallar la prueba.
let textoRenderizado = '';
traverse(ast, { JSXText(p) { textoRenderizado += ' ' + p.node.value.replace(/\s+/g, ' '); } });
for (const f of FRASES)
  check(!textoRenderizado.includes(f.replace(/\s+/g, ' ')), `ya no se renderiza: "${f.slice(0, 46)}…"`);
// Pero el punteado se queda: es lo que distingue los dos tramos, y sin él
// quitar las leyendas dejaría la gráfica sin ninguna señal del cambio de
// definición.
//
// Esto se comprobaba antes exigiendo que existiera `ptsEjecViejo`. Era una
// afirmación sobre un nombre, no sobre la conducta: cuando el dibujo pasó a
// resolverse por tramos con banderas, la prueba se puso roja por un renombre
// aunque el punteado seguía ahí. Ahora se extrae la expresión real del
// atributo `strokeDasharray` y se evalúa: lo que se afirma es qué sale por
// ese atributo según el tramo, que es lo que el usuario ve.
let exprDash = null;
traverse(ast, {
  JSXAttribute(p) {
    if (exprDash || p.node.name.name !== 'strokeDasharray') return;
    const e = p.node.value?.expression;
    // El que interesa es el del tramo histórico: depende del tramo `t`, no
    // una constante como la de las guías del eje.
    if (e && /\bt\s*\./.test(src.slice(e.start, e.end)))
      exprDash = src.slice(e.start, e.end);
  },
});
check(!!exprDash, 'el trazo de cada tramo decide su punteado en tiempo de dibujo',
  exprDash || 'no se encontró un strokeDasharray que dependa del tramo');

if (exprDash) {
  const dash = (vigente, medido) =>
    new Function('t', `"use strict"; return (${exprDash});`)({ vigente, medido });
  const puntea = (v, m) => dash(v, m) !== undefined && dash(v, m) !== '0';
  check(puntea(false, true),
    'un tramo de la definición anterior sale punteado', `-> ${dash(false, true)}`);
  check(puntea(false, false),
    'y también si además le faltan mediciones', `-> ${dash(false, false)}`);
  check(!puntea(true, true),
    'un tramo vigente y medido sale sólido', `-> ${String(dash(true, true))}`);
  check(puntea(true, false),
    'un tramo vigente con semanas sin captura sale punteado', `-> ${dash(true, false)}`);
}

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
