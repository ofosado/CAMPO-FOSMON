#!/usr/bin/env node
// Prueba: en Estimaciones ya no hay dos cifras distintas rotuladas igual.
//
// Hasta hoy la pantalla mostraba DOS "Pagado", uno encima del otro, con
// números que no coincidían: el de arriba en bruto, el de abajo neto de fondo
// de garantía, retención estratégica y amortización de anticipo. En la 0114
// eso era $109.2M contra $54.6M. Ninguno estaba mal; lo que estaba mal era
// que se llamaran igual, porque así se lee como un error del sistema y el
// usuario deja de creerle a la pantalla entera (PENDIENTES #11).
//
// No comprueba que existan las etiquetas: extrae las cuentas reales del
// archivo y verifica que las dos cifras SIGUEN siendo distintas —por eso
// necesitan nombres distintos— y que las rescatadas del bloque que se fue
// pasan por el mismo helper de retenciones que sus vecinas.
//
// Uso:  node scripts/prueba-pagado-sin-ambiguedad.cjs [archivo]

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

// El bloque que nos interesa vive dentro de `Estimaciones`. Sacamos de ahí las
// declaraciones por nombre, no del archivo entero: hay otros `cE` y otros
// `totalEst` en el módulo y tomar el primero que aparezca mediría otra cosa.
let decl = null;
traverse(ast, {
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'Estimaciones') return;
    decl = {};
    p.traverse({
      VariableDeclarator(q) {
        if (q.node.id.type === 'Identifier' && q.node.init)
          decl[q.node.id.name] ||= src.slice(q.node.init.start, q.node.init.end);
      },
    });
  },
});

// `atrasadas` dejó de llevar su propia cuenta del plazo de pago y ahora llama
// a `atrasoDeEstimacion`, que vive en el módulo porque la columna «Plazo de
// pago» de cada renglón la comparte. Se trae de ahí, EJECUTABLE, junto con lo
// que ella necesita: `C` para los colores —y `tok`, con el que `C` se arma— y
// `fechaLocalDeISO`, que es la lectura de fecha correcta y la razón de haberla
// sacado del componente. Copiar la cuenta aquí sería comprobar esta prueba
// contra sí misma: el KPI «Atrasado» podría volver a discrepar de la columna
// de su propio renglón y esto seguiría en verde.
const RAIZ = ['tok', 'C', 'fechaLocalDeISO', 'atrasoDeEstimacion'];
const raizDecl = {};
for (const n of ast.program.body) {
  const d = n.type === 'VariableDeclaration' ? n
          : n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'VariableDeclaration' ? n.declaration
          : null;
  if (!d) continue;
  for (const v of d.declarations)
    if (v.id.type === 'Identifier' && v.init && RAIZ.includes(v.id.name))
      raizDecl[v.id.name] ||= src.slice(v.init.start, v.init.end);
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
if (!decl) noArranco(['Estimaciones']);

// En orden de dependencia, que es el mismo que tienen en el archivo.
// `_pct` va antes de `cE` porque es lo que lee los porcentajes del contrato.
// Sin él, una obra a la que nadie le capturó anticipo daba NaN y `MXN` lo
// imprimía «$0»: justo el «COBRADO EFECTIVO $0» al lado de un «PAGADO BRUTO
// $9,300,000» que esta prueba existe para que no vuelva a pasar.
const NECESARIAS = ['_pct', 'cE', 'totalEst', 'pagadas', 'pagadoBruto', 'cobradoEfectivo',
  'facturado', 'porCobrar', 'diasPago', 'atrasadas', 'montoAtrasado'];
const faltan = [...NECESARIAS.filter(n => !decl[n]), ...RAIZ.filter(n => !raizDecl[n])];
if (faltan.length) noArranco(faltan);

const montar = (obra, estimaciones) => new Function('obra', 'estimaciones', `
  "use strict";
  ${RAIZ.map(n => `const ${n} = ${raizDecl[n]};`).join('\n  ')}
  ${NECESARIAS.map(n => `const ${n} = ${decl[n]};`).join('\n  ')}
  return { cE, totalEst, pagadoBruto, cobradoEfectivo, facturado,
           porCobrar, diasPago, atrasadas, montoAtrasado };
`)(obra, estimaciones);

const MXN = n => '$' + Math.round(n).toLocaleString('es-MX');
const casi = (a, b) => Math.abs(a - b) < 1;

// ── Caso de laboratorio, con los porcentajes reales de la 0114 ────────────
// Anticipo 30%, fondo de garantía 0%, retención estratégica 20%. Con eso, de
// cada peso pagado entran 50 centavos. Es justo la mitad que se perdía al
// rotular las dos cifras igual.
const obra = { presupuesto: 200_000_000, pctAnticipo: 30, pctFondoGar: 0, pctRetencion: 20, diasPago: 30 };
const hace = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const est = [
  { no: 1, estatus: 'Pagada',     monto: 60_000_000 },
  { no: 2, estatus: 'Pagada',     monto: 49_200_000 },
  { no: 3, estatus: 'Facturada',  monto: 20_000_000, fechaFact: hace(45) },  // vencida
  { no: 4, estatus: 'Facturada',  monto: 10_000_000, fechaFact: hace(10) },  // en plazo
  { no: 5, estatus: 'Aprobada',   monto:  8_000_000 },
  { no: 6, estatus: 'En proceso', monto:  5_000_000 },
];
const r = montar(obra, est);

console.log('1. Las dos cifras que se llamaban igual siguen siendo distintas');
check(casi(r.pagadoBruto, 109_200_000), `pagado bruto ${MXN(r.pagadoBruto)}`, 'esperado $109,200,000');
check(casi(r.cobradoEfectivo, 54_600_000), `cobrado efectivo ${MXN(r.cobradoEfectivo)}`, 'esperado $54,600,000');
check(r.pagadoBruto !== r.cobradoEfectivo,
  'no coinciden — por eso no pueden compartir etiqueta',
  `diferencia ${MXN(r.pagadoBruto - r.cobradoEfectivo)}`);
check(casi(r.pagadoBruto - r.cobradoEfectivo, 54_600_000),
  'y la diferencia es exactamente lo retenido y amortizado, no un descuadre');

console.log('\n2. Ninguna de las dos se perdió al consolidar');
check(r.pagadoBruto > 0 && r.cobradoEfectivo > 0,
  'las dos siguen calculándose; la consolidación no eligió una y tiró la otra');
check(!/\bpagado\b\s*=/.test(Object.keys(decl).join(' ')) && decl['pagado'] === undefined,
  'ya no queda una variable `pagado` a secas que pueda volver a rotularse mal');

console.log('\n3. Lo rescatado del bloque que se fue usa el MISMO helper');
// Neto de Facturada ($20M + $10M) + Aprobada ($8M), al 50%.
check(casi(r.porCobrar, 19_000_000), `por cobrar neto ${MXN(r.porCobrar)}`, 'esperado $19,000,000');
check(!casi(r.porCobrar, 38_000_000),
  'y NO los $38,000,000 en bruto que mostraba el bloque de arriba');
check(r.atrasadas.length === 1, 'una sola estimación fuera de plazo', `${r.atrasadas.length}`);
check(casi(r.montoAtrasado, 10_000_000), `atrasado neto ${MXN(r.montoAtrasado)}`, 'esperado $10,000,000');
check(!casi(r.montoAtrasado, 20_000_000),
  'y NO los $20,000,000 en bruto: si la vecina va neta, esta también');
check(r.diasPago === 30, 'el plazo sale del contrato, no de una constante', String(r.diasPago));

// Una obra sin `diasPago` no puede quedarse sin plazo ni tomar uno inventado
// distinto del que usa el resto de la app (30 días, como en detectarRiesgos).
const sinPlazo = montar({ ...obra, diasPago: undefined }, est);
check(sinPlazo.diasPago === 30, 'sin plazo en el contrato usa 30 días, el mismo default del resto');

console.log('\n4. Una estimación facturada sin fecha no se declara atrasada');
const sinFecha = montar(obra, [{ no: 1, estatus: 'Facturada', monto: 9_000_000 }]);
check(sinFecha.atrasadas.length === 0 && sinFecha.montoAtrasado === 0,
  'sin fechaFact no hay con qué medir el atraso, así que no se inventa');

console.log('\n5. Obra sin retenciones — el cambio no mueve el caso simple');
const limpia = montar({ presupuesto: 10_000_000, pctAnticipo: 0, pctFondoGar: 0, pctRetencion: 0, diasPago: 30 },
  [{ no: 1, estatus: 'Pagada', monto: 3_000_000 }]);
check(casi(limpia.pagadoBruto, limpia.cobradoEfectivo),
  'sin porcentajes que descontar, las dos cifras coinciden — y está bien que coincidan',
  MXN(limpia.cobradoEfectivo));

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
