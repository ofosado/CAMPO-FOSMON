#!/usr/bin/env node
// El dinero de una estimación se lee en un solo sitio — y se demuestra.
//
// QUÉ SE AFIRMA. Que el «por cobrar» del KPI de la obra, el de la tarjeta de
// riesgo `fin_004` que se pinta EN ESA MISMA PANTALLA, el de la pantalla de
// Estimaciones, el de la vista de dependencia y el «cobrado» del correo de
// dirección salen de UNA lectura, no de cinco que hoy pueden coincidir.
//
// POR QUÉ, y no era una hipótesis. Medido contra producción el 2026-11-13:
//
//   0126   KPI $53,523,612.95  ·  fin_004 $33,399,787.90   (difieren $20.1M)
//          la tarjeta decía «medio (62%)» donde correspondía «ALTO (100%)»
//   0128   KPI  $3,944,641.77  ·  fin_004          $0.00   (difieren $3.9M)
//          la tarjeta NO SE PINTABA, con $3.9M por cobrar
//
// El KPI contaba «facturada + aprobada + cualquier cosa que diga proceso»;
// `fin_004` se había quedado con la definición vieja —`['Facturada','Aprobada']`,
// coincidencia exacta y sin «En proceso»—, y el comentario del propio KPI dejaba
// constancia de que la definición había cambiado. La de la 0128 es la peor de
// las dos: una tarjeta de riesgo que no se pinta se lee como tranquilidad.
//
// Y había CUATRO formas de leer el `monto`: `parseFloat`, `Number`, `(m||0)` y
// crudo. No son equivalentes ante un monto guardado como texto.
//
// CÓMO SE MIDE, y es lo único que hace que esto valga. No se compara el número
// de cada pantalla contra uno que yo teclee: eso pasaría igual con cinco
// cuentas gemelas, que es exactamente el estado que se quiere prohibir. Se hace
// al revés, y la contraprueba es el método y no un paso posterior:
//
//   1. Se extrae la expresión REAL de cada sitio (por AST, del archivo).
//   2. Se ejecuta con las lecturas de verdad.
//   3. Se vuelve a ejecutar con la lectura MUTADA, inyectada como parámetro.
//   4. Se exige que TODAS se hayan movido.
//
// Un sitio que no se mueva con la lectura mutada no la está llamando: trae su
// propia copia, y hoy coincide de casualidad. Eso es rojo aquí aunque el número
// de hoy sea correcto.
//
// Uso:  node scripts/prueba-el-dinero-de-una-estimacion.cjs [App.jsx]
//
// CONTRAPRUEBA, comprobada el 2026-11-13 y la forma importa. No vale contra
// `main`: allá las lecturas únicas no existen y la salida es 2 —NO ARRANCÓ—,
// que no demuestra nada sobre las aserciones. Lo que se hizo fue devolverle su
// copia a UN sitio a la vez, sobre este mismo archivo:
//
//   · `fin_004` vuelve a `['Facturada','Aprobada'].includes(e.estatus)`
//                                                       → 8 en rojo, salida 1
//     y reproduce los números de producción: «tarjeta 62% · KPI 100%» en la
//     0126, y en la 0128 «no se pintó — y hay dinero por cobrar».
//   · el `porCobrar` de Estimaciones vuelve a su literal → 1 en rojo, salida 1
//     El rojo dice «$28,389,819.71 → $28,389,819.71»: el sitio NO SE MOVIÓ con
//     el predicado mutado. Es el rojo que sólo da este método; comparar contra
//     un número teclado habría pasado en verde.
//   · `montoDeEstimacion` vuelve a `parseFloat`          → 2 en rojo, salida 1
//   · el `cobrado` de functions/index.js vuelve a
//     `/pagada|cobrada/i`                                → 1 en rojo, salida 1
//     «un estatus que dice no pagada: correo $5,000.00 vs pantalla $0.00».
//
// Y el dato que justifica el método: con la copia de `fin_004` puesta, la
// sección de valores sobre la 0126 SIGUE DANDO las mismas cifras de monto. Lo
// que se mueve es el veredicto y la sección 3.

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const { fuenteDe, ARCHIVO_FUNCIONES } = require('./extraer-de-app.cjs');
const { pantallasDe } = require('./expresion-de-pantalla.cjs');

const archivo = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
noArranco.vigilarExcepciones(path.relative(raiz, archivo));

let fallas = 0, oks = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok  ' : 'FALLA'} ${titulo}${detalle ? `  ·  ${detalle}` : ''}`);
  ok ? oks++ : fallas++;
};
const seccion = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 60 - t.length))}`);
const MXN = n => (typeof n === 'number'
  ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
  : String(n));

// ── Las lecturas, extraídas y EJECUTADAS ───────────────────────────────────
//
// `BIBLIOTECA_RIESGOS` entra entero porque `fin_004` es una propiedad de un
// objeto de ese arreglo: no se puede pedir por nombre, y copiar su `detect`
// aquí sería comprobarlo contra sí mismo.
//
// `_ne` se pide explícitamente aunque el cierre ya lo arrastre: el `por pagar`
// de la vista de cliente lo nombra en su propio filtro, y lo que no esté en el
// objeto devuelto no llega al entorno de la pantalla — salía NO ARRANCÓ.
const DE_MODULO = [
  'montoDeEstimacion', 'esEstimacionPagada', 'esEstimacionPorCobrar',
  'esEstimacionFacturada', 'esEstimacionEnProceso', 'sumaDeEstimaciones',
  'calcularKPIsObra', 'BIBLIOTECA_RIESGOS', 'corteDeEstimaciones', '_ne',
];
// Sin éstas no hay nada que medir: son las lecturas únicas cuya existencia da
// sentido a la pregunta. Que falten es renombre, no regresión, y por eso es 2.
const IMPRESCINDIBLES = ['montoDeEstimacion', 'esEstimacionPorCobrar',
  'sumaDeEstimaciones', 'calcularKPIsObra', 'BIBLIOTECA_RIESGOS'];

// El módulo, armado con los dobles que se le pidan. `excluir` saca del cuerpo
// los nombres que se van a inyectar: si quedaran declarados dentro, la
// declaración ganaría sobre el parámetro y la sustitución no se notaría — el
// banco mediría la app creyendo que mide con su doble.
const armar = (dobles = {}) => {
  const inyectados = Object.keys(dobles);
  const { cuerpo, presentes, faltan } =
    fuenteDe(archivo, DE_MODULO, { tolerante: true, excluir: inyectados });
  const pendientes = IMPRESCINDIBLES.filter(n => faltan.includes(n));
  if (pendientes.length) noArranco(pendientes, path.relative(raiz, archivo));
  // El doble SALE también en el objeto devuelto. `excluir` lo quita del cuerpo,
  // así que no está entre los `presentes`, y sin esto las pantallas que lo
  // nombran en su propia expresión —el `por cobrar`, vía `cE`— se quedaban sin
  // insumo y la sección 3 moría en NO ARRANCÓ justo al mutar.
  return new Function(...inyectados,
    `"use strict";\n${cuerpo}\n;return {${[...presentes, ...inyectados].join(',')}};`)(
    ...inyectados.map(n => dobles[n]));
};
const mod = armar();
const riesgo = (id, m = mod) => {
  const r = m.BIBLIOTECA_RIESGOS.find(x => x.id === id);
  if (!r) noArranco([`el riesgo \`${id}\``], path.relative(raiz, archivo));
  return r;
};

// ── Los sitios de pantalla, extraídos por dueño y nombre ───────────────────
const QUIERO = [
  // sitio                                   dueño                      nombre
  ['estimado · Estimaciones',     'Estimaciones',            'totalEst'],
  ['por cobrar · Estimaciones',   'Estimaciones',            'porCobrar'],
  ['pagado · Estimaciones',       'Estimaciones',            'pagadoBruto'],
  ['facturado · Estimaciones',    'Estimaciones',            'facturado'],
  ['en proceso · Estimaciones',   'Estimaciones',            'enProceso'],
  ['estimado · dependencia',      'EstimacionesDependencia', 'total'],
  ['pagado · dependencia',        'EstimacionesDependencia', 'pagado'],
  ['estimado · cliente',          'EstimacionesCliente',     'totalEst'],
  ['pagado · cliente',            'EstimacionesCliente',     'pagado'],
  ['por pagar · cliente',         'EstimacionesCliente',     'factur'],
];
const { expr, corre } = pantallasDe(
  archivo,
  QUIERO.map(([sitio, dueño, nombre]) => ({ dueño, nombre, sitio })),
  {
    queFalta: (sin) => 'no encontré la cuenta de ' +
      sin.map(q => q.sitio).join(', '),
  });

// ── Las dos obras de producción, tal como están hoy ────────────────────────
//
// Documentos REALES, leídos de `obras/<id>/config/estimaciones` el 2026-11-13.
// No son cifras de ejemplo: son las dos obras en las que las dos cuentas
// discrepaban, y la 0128 es la que dejaba la tarjeta sin pintar. Si algún día
// cambian en producción, esta prueba sigue valiendo: lo que mide es que todos
// los sitios lean igual, no que la 0126 siga teniendo cinco estimaciones.
const EST_0126 = [
  { no: 1, monto: 73180.96,    estatus: 'Facturada' },
  { no: 2, monto: 2252743.19,  estatus: 'Facturada' },
  { no: 3, monto: 12218012.92, estatus: 'Facturada' },
  { no: 4, monto: 18855850.83, estatus: 'Facturada' },
  { no: 5, monto: 20123825.05, estatus: 'En proceso' },
];
const EST_0128 = [
  { no: 1, monto: 3944641.77, estatus: 'En proceso' },
];
// La que separa las dos definiciones por el acento y la mayúscula: ningún
// `<select>` la escribe hoy, pero el dato viejo existe y la comparación exacta
// la dejaba fuera de la suma sin que nada lo dijera.
const EST_ACENTOS = [
  { no: 1, monto: 1000, estatus: 'PAGADA' },
  { no: 2, monto: 2000, estatus: 'facturada' },
  { no: 3, monto: 4000, estatus: 'en proceso' },
];
const OBRA = { id: '0126', nombre: 'Obra de prueba', presupuesto: 60000000,
  pctAnticipo: 10, pctFondoGar: 5, pctRetencion: 0, diasPago: 30 };

const MATRIZ = [
  ['0126 — cuatro facturadas y una en proceso', EST_0126],
  ['0128 — una sola, en proceso',               EST_0128],
  ['acentos y mayúsculas',                      EST_ACENTOS],
];

// Cómo se le arma el entorno a cada sitio de pantalla. Las lecturas entran por
// aquí: ahí está todo el método de esta prueba.
const entornoDe = (ests, m) => ({
  Estimaciones:            { estimaciones: ests, obra: OBRA, ...m },
  EstimacionesDependencia: { estimaciones: ests, obra: OBRA, ...m },
  EstimacionesCliente:     { estimaciones: ests, obra: OBRA, ...m },
});
const leer = (ests, m) => {
  const ent = entornoDe(ests, m);
  const out = {};
  for (const [sitio, dueño, nombre] of QUIERO)
    out[`${dueño}.${nombre}`] =
      { sitio, valor: corre(dueño, nombre, ent[dueño], sitio) };
  return out;
};

console.log(`\nArchivo: ${path.relative(raiz, archivo)}`);
console.log('Las expresiones que se van a ejecutar:');
for (const [sitio, d, n] of QUIERO)
  console.log(`  ${sitio.padEnd(30)} ${expr[`${d}.${n}`].replace(/\s+/g, ' ').slice(0, 68)}`);

// ════════════════════════════════════════════════════════════════════════════
// 1) El KPI y la tarjeta de riesgo de la MISMA pantalla dicen lo mismo
// ════════════════════════════════════════════════════════════════════════════
seccion('El KPI y la tarjeta de riesgo, sobre los mismos datos');
const fin004 = riesgo('fin_004');
for (const [nombre, ests] of MATRIZ) {
  const k = mod.calcularKPIsObra(OBRA, [], [], [], ests, null, []);
  const v = fin004.detect({ estimaciones: ests, obra: OBRA });
  // El porcentaje que la tarjeta PUBLICA, contra el que sale del KPI. Se
  // compara el texto que ve el usuario, no una variable interna.
  const pctKpi = k.estTotal > 0 ? `${(k.estPorCob / k.estTotal * 100).toFixed(0)}%` : null;
  check(v !== null,
    `${nombre}: la tarjeta de riesgo SE PINTA`,
    v ? `«${v.severidad} ${v.valor}»` : 'no se pintó — y hay dinero por cobrar');
  check(v !== null && v.valor === pctKpi,
    `${nombre}: y publica el mismo porcentaje que el KPI`,
    `tarjeta ${v ? v.valor : '—'} · KPI ${pctKpi}`);
  // El detalle que lee el usuario trae las cifras ya formateadas y redondeadas
  // por el `MXN` de la app. No se compara el texto: se le sacan los montos y se
  // exige que uno de ellos SEA el «por cobrar» del KPI. Comparar cadenas aquí
  // habría dado rojo por el separador de miles y no por la cuenta.
  const montosDe = (s) => [...String(s).matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)]
    .map(x => Number(x[1].replace(/,/g, '')));
  check(v !== null && v.extra
    ? montosDe(v.extra).some(x => Math.abs(x - k.estPorCob) <= 1) : true,
    `${nombre}: y el detalle habla del mismo monto`,
    v && v.extra ? `${v.extra} · KPI ${MXN(k.estPorCob)}` : '(sin detalle)');
}

// La 0128 nombrada aparte: es el caso que importaba. Una lista con dinero por
// cobrar y una pantalla que no dice nada se lee como tranquilidad.
{
  const v = fin004.detect({ estimaciones: EST_0128, obra: OBRA });
  check(v !== null && v.severidad === 'alto',
    'la 0128, con todo su dinero en proceso, dispara ALTO y no silencio',
    v ? `${v.severidad} ${v.valor}` : 'null — la tarjeta no se pinta');
}

// ════════════════════════════════════════════════════════════════════════════
// 2) Los números de cada pantalla, y que el fixture no sea degenerado
// ════════════════════════════════════════════════════════════════════════════
seccion('Lo que dice cada pantalla hoy');
const base = leer(EST_0126, mod);
{
  const estimados = ['Estimaciones.totalEst', 'EstimacionesDependencia.total',
    'EstimacionesCliente.totalEst'].map(k => base[k].valor);
  check(estimados.every(v => v === estimados[0]),
    'las tres pantallas dicen el mismo total estimado',
    estimados.map(MXN).join(' · '));
  const k = mod.calcularKPIsObra(OBRA, [], [], [], EST_0126, null, []);
  check(estimados[0] === k.estTotal,
    'y es el mismo que el KPI del tablero', MXN(k.estTotal));
  check(k.estTotal > 0 && k.estPorCob > 0,
    'hay dinero que comparar, no ceros en todo el fixture',
    `estimado ${MXN(k.estTotal)} · por cobrar ${MXN(k.estPorCob)}`);

  const pagados = ['Estimaciones.pagadoBruto', 'EstimacionesDependencia.pagado',
    'EstimacionesCliente.pagado'].map(k2 => base[k2].valor);
  check(pagados.every(v => v === pagados[0]),
    'y el mismo pagado', pagados.map(MXN).join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════
// 3) LA CONTRAPRUEBA SEMÁNTICA: se muta la lectura y se exige que TODO se mueva
// ════════════════════════════════════════════════════════════════════════════
//
// Esto no mide el valor, mide de DÓNDE sale.
seccion('Si se mueve la lectura del monto, se mueven todos');
{
  const FACTOR = 7;
  const m = armar({ montoDeEstimacion: (e) => mod.montoDeEstimacion(e) * FACTOR });
  const mut = leer(EST_0126, m);
  const quietos = QUIERO
    .map(([sitio, d, n]) => [`${d}.${n}`, sitio])
    .filter(([k]) => {
      const antes = base[k].valor, ahora = mut[k].valor;
      // Se admite redondeo: `cobradoEfectivo` multiplica porcentajes.
      return !(antes === 0 ? ahora === 0 : Math.abs(ahora / antes - FACTOR) < 1e-9);
    });
  check(quietos.length === 0,
    `los ${QUIERO.length} sitios de pantalla leen el monto por la lectura única`,
    quietos.length ? quietos.map(([, s]) => s).join(' · ') : 'todos se movieron ×7');

  const k = m.calcularKPIsObra(OBRA, [], [], [], EST_0126, null, []);
  const k0 = mod.calcularKPIsObra(OBRA, [], [], [], EST_0126, null, []);
  check(Math.abs(k.estPorCob / k0.estPorCob - FACTOR) < 1e-9,
    'y el KPI del tablero también', `${MXN(k0.estPorCob)} → ${MXN(k.estPorCob)}`);
  const corte = m.corteDeEstimaciones(EST_0126, true);
  const corte0 = mod.corteDeEstimaciones(EST_0126, true);
  check(corte && Math.abs(corte.estimado / corte0.estimado - FACTOR) < 1e-9,
    'y el corte que se congela en el expediente semanal',
    `${MXN(corte0.estimado)} → ${MXN(corte && corte.estimado)}`);
}

seccion('Si se mueve QUÉ es «por cobrar», se mueve la tarjeta y el KPI');
{
  // Mutación SEMÁNTICA, no un desplazamiento: se cambia QUÉ entra. Un ×7 en el
  // monto pasaría igual con un predicado copiado; cambiar lo que el predicado
  // AFIRMA, no. Aquí sólo cuenta lo que diga «proceso» — justo lo contrario de
  // la definición vieja, para que un sitio que se la haya quedado se note.
  const m = armar({ esEstimacionPorCobrar: (e) => /proceso/i.test(String(e?.estatus || '')) });
  const esperado = 20123825.05;   // la única en proceso de la 0126
  const k = m.calcularKPIsObra(OBRA, [], [], [], EST_0126, null, []);
  check(Math.abs(k.estPorCob - esperado) < 0.005,
    'el KPI «por cobrar» pasa por el predicado único',
    `${MXN(k.estPorCob)} (se esperaba ${MXN(esperado)})`);

  // La tarjeta tiene SUS PROPIOS umbrales —70% alto, 50% medio— y eso no es un
  // estorbo, es parte de lo que hay que medir. Con sólo «en proceso» el 0126
  // baja a 38% y la tarjeta DEJA DE PINTARSE: eso es seguirle el predicado,
  // porque con la lectura de verdad pintaba «alto». No se teclea el 38% aquí;
  // se le pregunta al KPI mutado.
  const vReal = riesgo('fin_004').detect({ estimaciones: EST_0126, obra: OBRA });
  const v = riesgo('fin_004', m).detect({ estimaciones: EST_0126, obra: OBRA });
  const pct = k.estTotal > 0 ? k.estPorCob / k.estTotal * 100 : 0;
  check(v === null && vReal && vReal.severidad === 'alto' && pct < 50,
    'y la tarjeta de riesgo le sigue el predicado hasta por debajo de su umbral',
    `con la lectura real «${vReal ? vReal.severidad : 'null'}», con el predicado ` +
    `mutado ${v ? v.valor : 'no se pinta'} — el KPI mutado da ${pct.toFixed(0)}%`);

  // Y que siga pintando cuando toca, con el número del predicado y no con uno
  // propio: un predicado que deja fuera la facturada más grande cae en la banda
  // de «medio», así que la tarjeta tiene que publicar ESE porcentaje.
  const m2 = armar({
    esEstimacionPorCobrar: (e) => mod.esEstimacionPorCobrar(e) && e?.no !== 4,
  });
  const k2 = m2.calcularKPIsObra(OBRA, [], [], [], EST_0126, null, []);
  const pct2 = `${(k2.estPorCob / k2.estTotal * 100).toFixed(0)}%`;
  const v2 = riesgo('fin_004', m2).detect({ estimaciones: EST_0126, obra: OBRA });
  check(v2 !== null && v2.valor === pct2,
    'y cuando sí toca pintar, publica el porcentaje del predicado mutado',
    `tarjeta ${v2 ? `${v2.severidad} ${v2.valor}` : 'null'} · KPI ${pct2}`);

  const mut = leer(EST_0126, m);
  const pc0 = base['Estimaciones.porCobrar'].valor;
  const pc1 = mut['Estimaciones.porCobrar'].valor;
  check(pc1 !== pc0 && pc1 > 0,
    'y el «por cobrar» de la pantalla de Estimaciones se mueve con él',
    `${MXN(pc0)} → ${MXN(pc1)}`);
}

seccion('Si se mueve QUÉ es «pagada», se mueve todo lo que la usa');
{
  const m = armar({ esEstimacionPagada: () => false });
  const mut = leer(EST_0126, m);
  const quietos = ['Estimaciones.pagadoBruto', 'EstimacionesDependencia.pagado',
    'EstimacionesCliente.pagado'].filter(k => mut[k].valor !== 0);
  check(quietos.length === 0,
    'los tres «pagado» pasan por el predicado único',
    quietos.length ? quietos.map(k => `${mut[k].sitio} dijo ${MXN(mut[k].valor)}`).join(' · ')
      : 'los tres cayeron a cero');
  const corte = m.corteDeEstimaciones(EST_0126, true);
  check(corte && corte.pagado === 0,
    'y el corte del expediente semanal, también',
    `pagado ${MXN(corte && corte.pagado)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 4) El monto que no es un número: ni concatena, ni vale 1
// ════════════════════════════════════════════════════════════════════════════
//
// Esto es LATENTE y se mide como latente: el 2026-11-13 no hay un solo monto
// guardado como texto en producción, y los tres sitios de captura escriben
// números. Se comprueba de todas formas porque las tres formas viejas de leer
// el monto siguen siendo lo que alguien teclearía, y las tres fallan distinto.
seccion('Un monto guardado como texto');
{
  const COMO_TEXTO = [
    { no: 1, monto: '1500', estatus: 'Facturada' },
    { no: 2, monto: '2000', estatus: 'Facturada' },
    { no: 3, monto: '800',  estatus: 'Facturada' },
  ];
  const suma = mod.sumaDeEstimaciones(COMO_TEXTO);
  check(suma === 4300,
    'tres montos de texto suman 4,300 y no se concatenan',
    `${MXN(suma)} — la cuenta vieja \`(m||0)\` daba "015002000800", o sea ${MXN(15002000800)}`);
  check(typeof suma === 'number',
    'y lo que sale es un número, no una cadena', typeof suma);

  // `parseFloat("1,500.00")` devuelve 1. Un 1 no se ve como error: se ve como
  // una estimación chica, y eso es lo que lo hacía la peor de las cuatro.
  const CON_COMA = [{ no: 1, monto: '1,500.00', estatus: 'Facturada' }];
  const conComa = mod.sumaDeEstimaciones(CON_COMA);
  check(conComa !== 1,
    'y "1,500.00" NO se lee como $1 — que es lo que daba `parseFloat`',
    MXN(conComa));

  // Lo que sí queda abierto, y queda escrito: un monto ilegible se cuenta como
  // cero y nada en la pantalla lo dice. Hoy no hay ninguno; está en PENDIENTES.
  check(conComa === 0,
    'hoy un monto ilegible se cuenta como 0 (hueco conocido, cero casos en producción)',
    MXN(conComa));
}

// ════════════════════════════════════════════════════════════════════════════
// 5) La copia de functions/index.js dice lo mismo
// ════════════════════════════════════════════════════════════════════════════
//
// No hay build compartido entre `functions/` y `src/`: son dos despliegues. La
// única forma de exigir que coincidan es CORRER LAS DOS. Lo que había allá era
// una quinta forma de decidir «pagada» —`/pagada|cobrada/i`, una subcadena— y
// esa cifra se publica en el correo de dirección como «cobrado del cliente».
seccion('La misma lectura en functions/index.js');
{
  if (!fs.existsSync(ARCHIVO_FUNCIONES))
    noArranco.sinPrecondicion('no encuentro functions/index.js',
      ['Sin la otra copia no hay dos cuentas que comparar, y esta sección es',
       'precisamente la que impide que divergan. Medir sólo una sería creerle',
       'al verde sobre la mitad del problema.']);
  const fn = (() => {
    const { cuerpo, presentes, faltan } = fuenteDe(ARCHIVO_FUNCIONES,
      ['montoDeEstimacion', 'esEstimacionPagada', 'esEstimacionPorCobrar',
       'esEstimacionFacturada', 'esEstimacionEnProceso', 'sumaDeEstimaciones'],
      { tolerante: true });
    if (faltan.length) noArranco(faltan, 'functions/index.js');
    return new Function(`"use strict";\n${cuerpo}\n;return {${presentes.join(',')}};`)();
  })();

  const casos = [
    ...MATRIZ,
    ['montos guardados como texto', [
      { no: 1, monto: '1500', estatus: 'Pagada' },
      { no: 2, monto: '2000', estatus: 'Facturada' }]],
    ['un estatus que dice «no pagada»', [
      { no: 1, monto: 5000, estatus: 'No pagada' }]],
  ];
  const difieren = [];
  const detalle = [];
  for (const [nombre, ests] of casos) {
    const a = [mod.sumaDeEstimaciones(ests),
      mod.sumaDeEstimaciones(ests, mod.esEstimacionPagada),
      mod.sumaDeEstimaciones(ests, mod.esEstimacionPorCobrar)];
    const b = [fn.sumaDeEstimaciones(ests),
      fn.sumaDeEstimaciones(ests, fn.esEstimacionPagada),
      fn.sumaDeEstimaciones(ests, fn.esEstimacionPorCobrar)];
    if (a.some((v, i) => v !== b[i])) difieren.push(`${nombre}: ${a.join('/')} vs ${b.join('/')}`);
    detalle.push(`${nombre}: ${MXN(a[1])} cobrado`);
  }
  check(difieren.length === 0,
    `las dos copias contestan igual en los ${casos.length} casos`,
    difieren.length ? difieren.join(' · ') : detalle.join(' · '));

  // Y el caso concreto que la subcadena contaba mal: «No pagada» CONTIENE
  // «pagada». Nadie lo escribe hoy; la cuenta vieja lo habría dado por cobrado.
  const noPagada = [{ no: 1, monto: 5000, estatus: 'No pagada' }];
  check(fn.sumaDeEstimaciones(noPagada, fn.esEstimacionPagada) === 0,
    'y «No pagada» no se cuenta como cobrada en el correo de dirección',
    MXN(fn.sumaDeEstimaciones(noPagada, fn.esEstimacionPagada)));

  // Y la cifra que SE PUBLICA, no sólo las lecturas que tiene a mano. Comparar
  // predicados dejaría pasar lo que de verdad pasaba: `cobrado` tenía su propio
  // criterio escrito en la misma línea, `/pagada|cobrada/i`, con las lecturas
  // únicas al lado sin que nadie las llamara. Se saca la expresión de
  // `calcularKpisObra.cobrado` del archivo y se EJECUTA.
  const { corre: correFn } = pantallasDe(ARCHIVO_FUNCIONES,
    [{ dueño: 'calcularKpisObra', nombre: 'cobrado', etiqueta: 'cobrado del correo' }],
    {
      queFalta: () => 'no encontré el `cobrado` de `calcularKpisObra` en functions/index.js',
      comoConseguirlo: [
        'Es la cifra que el correo de dirección publica como cobrado del',
        'cliente. Si cambió de nombre o de sitio, esta prueba dejó de mirar',
        'la cuenta que se despliega, y el verde no dice nada de ella.'],
    });
  const discrepan = [];
  for (const [nombre, ests] of casos) {
    const publicado = correFn('calcularKpisObra', 'cobrado',
      { estimaciones: ests, ...fn }, 'cobrado del correo');
    const pantalla = mod.sumaDeEstimaciones(ests, mod.esEstimacionPagada);
    if (publicado !== pantalla)
      discrepan.push(`${nombre}: correo ${MXN(publicado)} vs pantalla ${MXN(pantalla)}`);
  }
  check(discrepan.length === 0,
    'y el «cobrado» que publica el correo sale de esa lectura, no de un criterio propio',
    discrepan.length ? discrepan.join(' · ') : `igual en los ${casos.length} casos`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('');
if (fallas === 0) {
  console.log(`${oks} comprobación(es) en verde · 0 en rojo\n`);
  process.exit(0);
}
console.log(`${oks} en verde · ${fallas} EN ROJO\n`);
process.exit(1);
