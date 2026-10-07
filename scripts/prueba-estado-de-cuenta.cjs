#!/usr/bin/env node
// La relación de estimaciones, en renglones: un estado de cuenta.
//
// POR QUÉ ESTA PRUEBA. Pasar de tarjetas a tabla no es cosmético: la tabla
// AFIRMA dos cosas nuevas sobre dinero que antes no se decían en ninguna
// pantalla —el acumulado y el porcentaje del contrato— y abre un camino de
// escritura que antes no existía, porque ahora el renglón que se teclea no
// está en el mismo orden que el arreglo que se guarda. Las tres maneras de
// equivocarse son caras y ninguna se ve en pantalla:
//
//   1. Sumar el acumulado en el orden en que están GUARDADAS las estimaciones.
//      El arreglo está en orden de captura; la tabla se ordena por número. En
//      cuanto alguien registra la 5 antes que la 4, el renglón de la 4 enseña
//      un acumulado que no es «cuánto llevo cobrado hasta la 4». La tabla se
//      ve impecable y el número está mal.
//   2. Escribir por la POSICIÓN DEL RENGLÓN en vez de por la del arreglo. Con
//      los dos órdenes distintos, teclear el monto de una estimación se lo
//      guarda a otra. Dinero movido en silencio, sin un solo aviso.
//   3. Que el renglón de TOTALES sume por su cuenta. Dos sumas de lo mismo en
//      la misma pantalla acaban contradiciéndose delante del cliente, y el
//      cliente no concluye que un total está mal: concluye que el sistema no
//      cuadra.
//
// Y una cuarta que no es de suma: un «0.00% del contrato» cuando lo que pasa
// es que NO HAY contrato capturado. Cero es una afirmación —no he cobrado
// nada— y la verdad es que no se sabe contra cuánto (P2).
//
// Todo se extrae de src/App.jsx por AST y se EJECUTA. Ni una cuenta está
// escrita aquí: una prueba que reimplementa el código se comprueba a sí misma
// y deja pasar justo el cambio de definición silencioso que vino a vigilar.
//
// Uso:  node scripts/prueba-estado-de-cuenta.cjs [App.jsx]
//       node scripts/prueba-estado-de-cuenta.cjs --contraprueba
//
// CONTRAPRUEBA. No se hace contra la versión anterior: antes no había tabla, y
// correrla contra `main` da NO ARRANCÓ —el andamiaje no encuentra qué extraer—,
// que no demuestra nada. Se hace rompiendo la versión de hoy: cuatro mutaciones
// que dejan la pantalla compilando y viéndose igual, una por cada defecto que
// esta prueba vino a vigilar. Cada una tiene que poner ROJA al menos una
// aserción. La que no lo logre señala una aserción que no mide lo que dice.

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

// ── La contraprueba ────────────────────────────────────────────────────────
// Cada mutación es un buscar-y-reemplazar sobre el archivo de hoy, escrito a
// un temporal, y la prueba se vuelve a correr contra él. Son los cuatro
// defectos de la cabecera, en el mismo orden.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const base = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
  // Las dos primeras se aplican a LAS DOS pantallas de un golpe, porque así es
  // como pasaría de verdad: un buscar-y-reemplazar, no una edición a mano en
  // una sola. Que las dos queden rotas a la vez es el caso difícil: si la
  // prueba sólo mirara una, la otra se iría en verde.
  const MUTACIONES = [
    { nombre: 'el acumulado se suma en el orden en que están guardadas',
      de: `      .sort((x, y) => (Number(x.e?.no)||0) - (Number(y.e?.no)||0))\n`,
      a: `` },
    { nombre: 'teclear un monto escribe por la posición del RENGLÓN, no del arreglo',
      de: `      .map(({ e, i }) => {`,
      a: `      .map(({ e }, i) => {` },
    { nombre: 'sin contrato capturado el renglón dice 0.00%',
      de: `obra.presupuesto > 0 ? acum / obra.presupuesto * 100 : null`,
      a: `obra.presupuesto > 0 ? acum / obra.presupuesto * 100 : 0` },
    { nombre: 'los porcentajes del contrato vuelven a entrar crudos (NaN → «$0»)',
      de: `const cE=e=>{const a=e.monto*_pct(obra.pctAnticipo)/100`,
      a: `const cE=e=>{const a=e.monto*obra.pctAnticipo/100` },
    { nombre: 'un estatus de fuera del trámite vuelve a disfrazarse de «Recibida»',
      de: `                        {!ESTATUS_ESTIMACION_DEPENDENCIA.includes(e.estatus) &&\n`
        + `                          <option value={e.estatus||""}>\n`
        + `                            {e.estatus ? \`\${e.estatus} — fuera del trámite\` : "sin estatus"}\n`
        + `                          </option>}\n`,
      a: `` },
    { nombre: 'se agrega una columna de IVA con una tasa inventada',
      de: `    {id:'acu',  lbl:'Acumulado',         num:true},`,
      a: `    {id:'iva',  lbl:'IVA 16%',            num:true},\n`
       + `    {id:'acu',  lbl:'Acumulado',         num:true},` },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en el archivo; la mutación no se pudo hacer.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `estado-cuenta-mut-${Date.now()}.jsx`);
    fs.writeFileSync(roto, base.replaceAll(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename, roto], { encoding: 'utf8' });
    const rojas = (r.stdout.match(/^ {3}✗ /gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : `NO LA VE   `}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} aserción(es) en rojo. ` +
        `Una mutación que no se ve es una aserción que no mide.`);
      if (r.status === 2) console.log(r.stdout.split('\n').slice(0, 8).map(l => '             ' + l).join('\n'));
    } else {
      for (const l of r.stdout.match(/^ {3}✗ .*/gm) || []) console.log(`             ${l.trim()}`);
    }
    fs.unlinkSync(roto);
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven. La prueba mide lo que dice medir.`
    : `\n${malas} mutación(es) pasaron inadvertidas.`);
  process.exit(malas > 0 ? 1 : 0);
}

const ARCH = process.argv[2] ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(ARCH, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const fallos = [];
const check = (cond, m, detalle) => {
  const d = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${d}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${d}`); }
};

// ── Extracción ─────────────────────────────────────────────────────────────
// De módulo: la paleta (con `tok`, sin el que no se arma), la lectura de fecha
// local y la cuenta del plazo de pago, que la tabla comparte con el KPI
// «Atrasado» justo para que no puedan discrepar.
const RAIZ = ['tok', 'C', 'fechaLocalDeISO', 'atrasoDeEstimacion'];
// Del componente: por nombre y por DUEÑO. Hay un `renglones`, un `actualiza` y
// un `monto` en cada una de las dos pantallas; tomar el primero que aparezca
// mediría la pantalla equivocada.
const ANIDADOS = [
  'Estimaciones._pct',
  'Estimaciones.cE', 'Estimaciones.renglones', 'Estimaciones.actualiza',
  'Estimaciones.COLS', 'Estimaciones.totalEst',
  'Estimaciones.anticipoAmort', 'Estimaciones.retenido', 'Estimaciones.retenEstra',
  'EstimacionesDependencia.monto', 'EstimacionesDependencia.total',
  'EstimacionesDependencia.renglones', 'EstimacionesDependencia.actualiza',
];

const raizSrc = {};
const anid = {};
// Los encabezados de la tabla de la dependencia son un literal en el JSX, no
// una tabla de columnas como la de la constructora. Se saca el arreglo de
// cadenas que se recorre para pintar el `thead`.
let encabezadosDep = null;
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    for (const d of p.node.declarations)
      if (d.id?.type === 'Identifier' && RAIZ.includes(d.id.name) && d.init)
        raizSrc[d.id.name] ||= src.slice(d.init.start, d.init.end);
  },
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (!n || !p.node.init) return;
    const dueño = p.findParent(q => q.isFunctionDeclaration())?.node?.id?.name;
    const clave = `${dueño}.${n}`;
    if (ANIDADOS.includes(clave) && anid[clave] === undefined)
      anid[clave] = src.slice(p.node.init.start, p.node.init.end);
  },
  ArrayExpression(p) {
    if (encabezadosDep) return;
    const dueño = p.findParent(q => q.isFunctionDeclaration())?.node?.id?.name;
    if (dueño !== 'EstimacionesDependencia') return;
    const els = p.node.elements;
    if (!els.length || !els.every(e => e?.type === 'StringLiteral')) return;
    if (!els.some(e => /^N[ºo°]$/.test(e.value))) return;
    encabezadosDep = els.map(e => e.value);
  },
});

const faltan = [...RAIZ.filter(n => !raizSrc[n]), ...ANIDADOS.filter(n => !anid[n])];
if (faltan.length) noArranco(faltan);

const PRELUDIO = RAIZ.map(n => `const ${n} = ${raizSrc[n]};`).join('\n');

// Arma el bloque de dinero de la constructora con las piezas del archivo, en
// orden de dependencia. Devuelve lo que la pantalla tiene a la mano cuando
// pinta la tabla: los renglones, las columnas, y los totales de los KPIs.
const constructora = (obra, estimaciones, setEstimaciones = () => {}) =>
  new Function('obra', 'estimaciones', 'setEstimaciones', `
    "use strict";
    ${PRELUDIO}
    const _pct = ${anid['Estimaciones._pct']};
    const cE = ${anid['Estimaciones.cE']};
    const totalEst = ${anid['Estimaciones.totalEst']};
    const anticipoAmort = ${anid['Estimaciones.anticipoAmort']};
    const retenido = ${anid['Estimaciones.retenido']};
    const retenEstra = ${anid['Estimaciones.retenEstra']};
    const actualiza = ${anid['Estimaciones.actualiza']};
    const renglones = ${anid['Estimaciones.renglones']};
    const COLS = ${anid['Estimaciones.COLS']};
    return { cE, totalEst, anticipoAmort, retenido, retenEstra,
             actualiza, renglones, COLS };
  `)(obra, estimaciones, setEstimaciones);

const dependencia = (obra, estimaciones, setEstimaciones = () => {}) =>
  new Function('obra', 'estimaciones', 'setEstimaciones', `
    "use strict";
    ${PRELUDIO}
    const diasDeRecepcion = () => null;
    const monto = ${anid['EstimacionesDependencia.monto']};
    const total = ${anid['EstimacionesDependencia.total']};
    const periodoEnPalabras = (a, b) => [a, b].filter(Boolean).join(' a ');
    const actualiza = ${anid['EstimacionesDependencia.actualiza']};
    const renglones = ${anid['EstimacionesDependencia.renglones']};
    return { monto, total, actualiza, renglones };
  `)(obra, estimaciones, setEstimaciones);

const MXN = n => '$' + Math.round(n).toLocaleString('en-US');
const casi = (a, b) => Math.abs(a - b) < 1;

console.log(`\nArchivo: ${path.relative(raiz, ARCH)}\n`);

// ── 1. El acumulado va por número de estimación, no por orden de captura ───
console.log('1. El acumulado suma por número de estimación');
// EL ARREGLO ESTÁ DESORDENADO A PROPÓSITO, y es el caso real: la 3 se capturó
// primero porque llegó primero al escritorio. Con los montos distintos, un
// acumulado sumado en orden de arreglo da números que NO se pueden confundir
// con los correctos.
const obraC = { presupuesto: 100_000_000, pctAnticipo: 30, pctFondoGar: 5,
                pctRetencion: 0, diasPago: 30 };
const desordenadas = [
  { no: 3, monto: 30_000_000, estatus: 'En proceso', periodo: '03' },
  { no: 1, monto: 10_000_000, estatus: 'Pagada',     periodo: '01' },
  { no: 2, monto: 20_000_000, estatus: 'Facturada',  periodo: '02' },
];
const rC = constructora(obraC, desordenadas);
const porNo = rC.renglones.map(r => r.e.no);
check(JSON.stringify(porNo) === '[1,2,3]',
  'la tabla pinta los renglones en orden de estimación, no en el que se capturaron',
  `arreglo [3,1,2] → pantalla [${porNo.join(',')}]`);

const acums = rC.renglones.map(r => r.acum);
check(casi(acums[0], 10_000_000) && casi(acums[1], 30_000_000) && casi(acums[2], 60_000_000),
  'cada renglón acumula lo suyo más lo de las estimaciones ANTERIORES por número',
  acums.map(MXN).join(' → '));
// Lo que saldría sumando en orden de arreglo: 30 / 40 / 60. El tercero
// coincide por fuerza —es el total— así que el primero es el que delata.
check(!casi(acums[0], 30_000_000),
  'y no el de la primera estimación guardada, que es otra cifra',
  `sumado en orden de captura diría ${MXN(30_000_000)}`);

// ── 2. El TOTALES de la tabla es el mismo número de los KPIs de arriba ─────
console.log('\n2. El renglón de TOTALES no lleva su propia suma');
check(casi(rC.renglones.at(-1).acum, rC.totalEst),
  'el último acumulado de la columna cierra exactamente en el total de los KPIs',
  `${MXN(rC.renglones.at(-1).acum)} = ${MXN(rC.totalEst)}`);
const sumaNetos = rC.renglones.reduce((t, r) => t + r.c.ef, 0);
const netoKpis  = rC.totalEst - rC.anticipoAmort - rC.retenido - rC.retenEstra;
check(casi(sumaNetos, netoKpis),
  'la columna «Neto a pagar» sumada renglón por renglón da el mismo neto que los KPIs',
  `${MXN(sumaNetos)} = ${MXN(netoKpis)}`);
const sumaDed = rC.renglones.reduce((t, r) => t + r.c.a + r.c.fg + r.c.re, 0);
check(casi(sumaDed, rC.anticipoAmort + rC.retenido + rC.retenEstra),
  'y las deducciones de cada renglón cuadran con las tres cifras retenidas de arriba',
  MXN(sumaDed));
check(casi(sumaNetos + sumaDed, rC.totalEst),
  'importe = neto + deducciones, renglón por renglón: la tabla no pierde ni un peso',
  `${MXN(sumaNetos)} + ${MXN(sumaDed)} = ${MXN(rC.totalEst)}`);

// ── 2bis. Una obra sin porcentajes capturados no cobra cero ───────────────
// ESTO ESTABA EN PRODUCCIÓN, visto en el preview. Una obra a la que nadie le
// capturó anticipo ni fondo de garantía los tiene `undefined`, `monto *
// undefined` es NaN, y `MXN` —que hace `Math.abs(n)||0`— lo imprime «$0». La
// pantalla enseñaba «PAGADO BRUTO $9,300,000» con «COBRADO EFECTIVO $0» al
// lado. El estado de cuenta lo empeora porque lo repite en cada renglón y en
// un TOTALES que declara cero neto sobre $9.3M estimados.
//
// No se afirma que exista ningún guardián: se le pasa la obra sin capturar y
// se mira qué cifra sale. Sin deducciones pactadas, el neto ES el importe.
console.log('\n2bis. Una obra sin porcentajes capturados');
const sinPcts = constructora(
  { presupuesto: 24_800_000, diasPago: 30 },          // ni anticipo ni fondo
  [{ no: 1, monto: 4_200_000, estatus: 'Pagada' },
   { no: 2, monto: 5_100_000, estatus: 'Pagada' }]);
const netos = sinPcts.renglones.map(r => r.c.ef);
check(netos.every(Number.isFinite),
  'el neto a pagar de cada renglón es un número, no un NaN que se imprima como «$0»',
  JSON.stringify(netos));
check(casi(netos[0], 4_200_000) && casi(netos[1], 5_100_000),
  'y sin deducciones pactadas el neto es el importe completo, al peso',
  netos.map(MXN).join(' · '));
check(Number.isFinite(sinPcts.anticipoAmort) && casi(sinPcts.anticipoAmort, 0)
   && Number.isFinite(sinPcts.retenido)      && casi(sinPcts.retenido, 0),
  'las deducciones acumuladas de los KPIs son cero de verdad, no NaN disfrazado',
  `anticipo ${sinPcts.anticipoAmort} · fondo ${sinPcts.retenido}`);
check(casi(sinPcts.renglones.reduce((t, r) => t + r.c.ef, 0), sinPcts.totalEst),
  'así el TOTALES de «Neto a pagar» cierra en los $9,300,000 estimados y no en cero',
  MXN(sinPcts.renglones.reduce((t, r) => t + r.c.ef, 0)));

// ── 3. Teclear un monto se lo guarda a la estimación del renglón ───────────
// LA PRUEBA MÁS IMPORTANTE DE TODAS. La tabla ordena por número y el arreglo
// está en orden de captura: con el renglón de la EST-01 en la posición 0 de la
// PANTALLA y en la 1 del ARREGLO, escribir por la posición del renglón le mete
// el monto a la EST-03. Se ejecuta el `actualiza` del archivo con el `i` que el
// renglón de verdad carga, y se mira a qué estimación le llegó el cambio.
console.log('\n3. El monto que se teclea le llega a la estimación de ese renglón');
for (const [nombre, armar] of [['constructora', constructora], ['dependencia', dependencia]]) {
  let guardado = null;
  const r = armar(obraC, desordenadas.map(e => ({ ...e })),
    f => { guardado = f(desordenadas.map(e => ({ ...e }))); });
  const primero = r.renglones[0];                 // el de la EST-01 en pantalla
  r.actualiza(primero.i, { monto: 999 });
  const tocadas = (guardado || []).filter(e => e.monto === 999).map(e => e.no);
  check(tocadas.length === 1 && tocadas[0] === 1,
    `${nombre}: el cambio del primer renglón le llega a la EST-01 y a nadie más`,
    `renglón 1 de pantalla = posición ${primero.i} del arreglo → tocó EST-${tocadas.join(',') || 'ninguna'}`);
  // Y el resto queda intacto: no es que haya escrito en todas.
  const intactas = (guardado || []).filter(e => e.no !== 1)
    .every(e => e.monto === desordenadas.find(d => d.no === e.no).monto);
  check(intactas, `${nombre}: las otras dos estimaciones no se movieron`);
}

// ── 4. Sin contrato capturado no se afirma un porcentaje ───────────────────
console.log('\n4. El % del contrato cuando no hay contrato capturado');
for (const [nombre, armar] of [['constructora', constructora], ['dependencia', dependencia]]) {
  const r = armar({ ...obraC, presupuesto: 0 }, desordenadas);
  const pcts = r.renglones.map(x => x.pctAcum);
  check(pcts.every(v => v === null),
    `${nombre}: ningún renglón dice «0.00% del contrato» cuando no hay contrato`,
    JSON.stringify(pcts));
  // Y con contrato sí lo dice, para que el null no sea «nunca calcula nada».
  const con = armar(obraC, desordenadas);
  check(casi(con.renglones.at(-1).pctAcum, 60),
    `${nombre}: con contrato capturado el último renglón sí llega al 60% del contrato`,
    `${con.renglones.at(-1).pctAcum?.toFixed?.(2)}%`);
}

// ── 5. Las columnas de la constructora ────────────────────────────────────
console.log('\n5. Las columnas del estado de cuenta');
const lbls = rC.COLS.map(c => c.lbl);
for (const quiere of ['Nº', 'Periodo de ejecución', 'Importe', 'Total deducciones',
                      'Neto a pagar', 'Acumulado', '% contrato', 'Estatus', 'Plazo de pago'])
  check(lbls.includes(quiere), `está la columna «${quiere}»`);
// El sistema guarda los montos SIN IVA y no tiene en ningún lado la tasa de la
// obra: 16% general, 8% en franja fronteriza, contratos exentos. Una columna
// «IVA» sería un porcentaje inventado multiplicando dinero real (P2).
check(!lbls.some(l => /iva|impuesto/i.test(l)),
  'ninguna columna multiplica por una tasa de impuesto que el sistema no tiene capturada',
  lbls.filter(l => /iva|impuesto/i.test(l)).join(', ') || 'ninguna');

// Una deducción pactada en CERO no abre columna: una columna de puros ceros en
// un estado de cuenta se lee como que algo se dejó de calcular.
check(!lbls.some(l => /Ret\. estrat/i.test(l)),
  'con retención estratégica al 0% no se abre su columna',
  lbls.join(' | '));
const conRet = constructora({ ...obraC, pctRetencion: 20 }, desordenadas);
check(conRet.COLS.some(c => /Ret\. estrat.*20/.test(c.lbl)),
  'y pactada al 20% la columna aparece, con su porcentaje en el encabezado',
  conRet.COLS.map(c => c.lbl).filter(l => /Ret/.test(l)).join(', '));
check(conRet.COLS.length === rC.COLS.length + 1,
  'exactamente una columna más, no dos ni ninguna',
  `${rC.COLS.length} → ${conRet.COLS.length}`);

// ── 6. La tabla de la dependencia no enseña la economía del contratista ───
// P5. `EstimacionesDependencia` es pantalla aparte justo por esto, y la tabla
// es donde reaparecería: «Neto a pagar» y «Fondo de garantía» son del lado de
// allá. Lo que sí es suyo —cuándo llegó a ventanilla y cuánto tardaron— tiene
// que estar, o la pantalla no sirve para lo que se hizo.
console.log('\n6. La tabla de la dependencia, del lado correcto de la frontera');
if (!encabezadosDep) {
  const m = 'la tabla de la dependencia enseña sus columnas';
  fallos.push(m);
  console.log(`   ✗ ${m}  ·  no hay encabezados que extraer de este archivo`);
} else {
  const prohibidas = /fondo de gar|anticipo|retenci|neto a pagar|margen|utilidad|n[oó]mina|personal|costo/i;
  const colados = encabezadosDep.filter(l => prohibidas.test(l));
  check(colados.length === 0,
    'ninguna columna enseña deducciones, neto ni economía interna del contratista',
    colados.join(', ') || encabezadosDep.filter(Boolean).join(' | '));
  for (const quiere of [/recibida|ventanilla/i, /d[ií]as/i, /acumulado/i, /% ?contrato/i])
    check(encabezadosDep.some(l => quiere.test(l)),
      `está la columna que buscaba ${quiere}`,
      encabezadosDep.find(l => quiere.test(l)) || 'falta');
}
const rD = dependencia(obraC, desordenadas);
check(casi(rD.renglones.at(-1).acum, rD.total),
  'y su acumulado cierra en el mismo total que el KPI «Total recibido»',
  `${MXN(rD.renglones.at(-1).acum)} = ${MXN(rD.total)}`);
check(JSON.stringify(rD.renglones.map(r => r.e.no)) === '[1,2,3]',
  'también ordena por número de estimación, no por orden de recepción capturada',
  rD.renglones.map(r => r.e.no).join(','));

// ── 6bis. Un estatus de fuera del trámite se ve, no se disfraza ───────────
// Visto en el preview. Los dos lados del mostrador tienen vocabularios
// distintos —allá se FACTURA, aquí se RECIBE— y un `<select>` cuyo `value` no
// es ninguna de sus opciones no avisa: pinta la primera. Una estimación
// guardada «Facturada» se veía como «Recibida», que es otro estado del
// trámite. No se afirma que exista un guardián: se renderiza la celda con ese
// dato y se mira qué cadena sale.
console.log('\n6bis. Un estatus que no es del trámite de la dependencia');
{
  const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
  const React = require(path.join(raiz, 'node_modules/react'));
  const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));
  // Sólo el `<td>` del estatus, con las piezas de verdad: la lista de estados
  // del archivo y el JSX del archivo. El `<Sel>` real es un `<select>` con
  // estilos; aquí basta uno pelón, porque lo que se mide son las OPCIONES.
  const jsx = src.slice(
    src.indexOf('<td style={celda}>', src.indexOf('function EstimacionesDependencia')),
  );
  const celdaEstatus = jsx.slice(jsx.indexOf('<Sel value={e.estatus'),
                                 jsx.indexOf('</Sel>') + 6);
  const lista = src.match(/const ESTATUS_ESTIMACION_DEPENDENCIA\s*=\s*\[[^\]]*\]/)?.[0];
  if (!lista || !/<Sel value=\{e\.estatus/.test(celdaEstatus)) {
    const m = 'un estatus de fuera del trámite se ve tal cual en la celda';
    fallos.push(m);
    console.log(`   ✗ ${m}  ·  no se pudo extraer la celda del estatus de este archivo`);
  } else {
    const cuerpo = esbuild.transformSync(
      `const ESTATUS_PAGADA = "Pagada";\n${lista};\n` +
      `const Sel = p => React.createElement('select', {value:p.value, readOnly:true}, p.children);\n` +
      `return (e, actualiza) => (${celdaEstatus});`,
      { loader: 'jsx' }).code;
    const celda = new Function('React', cuerpo)(React);
    const pinta = est => renderToStaticMarkup(
      React.createElement('table', null, React.createElement('tbody', null,
        React.createElement('tr', null, celda({ estatus: est }, () => {})))));

    const ajeno = pinta('Facturada');
    check(/Facturada/.test(ajeno),
      'la celda enseña «Facturada» tal cual, en vez de pintar la primera opción de la lista',
      ajeno.match(/<option[^>]*>([^<]*)<\/option>/)?.[1] || '?');
    check(/fuera del trámite/.test(ajeno),
      'y dice que ese estado no es del trámite de la dependencia, para que lo corrijan',
      ajeno.match(/>([^<]*fuera del trámite[^<]*)</)?.[1] || 'no lo dice');
    check((ajeno.match(/<option/g) || []).length === 5,
      'son los cuatro estados del trámite más el ajeno, ninguno de más',
      `${(ajeno.match(/<option/g) || []).length} opciones`);

    // Y uno del trámite NO se marca: si se marcara todo, la marca no diría nada.
    const propio = pinta('Autorizada');
    check(!/fuera del trámite/.test(propio),
      'un estado que sí es del trámite no lleva ninguna advertencia encima',
      (propio.match(/<option/g) || []).length + ' opciones');
    check(/sin estatus/.test(pinta('')),
      'y una estimación sin estatus lo dice, en vez de pasar por «Recibida»');
  }
}

// ── 7. El plazo de pago del renglón y el KPI «Atrasado» son una sola cuenta ─
// Estaban escritas dos veces en la pantalla y las dos leían la fecha en UTC:
// el KPI podía contar como atrasada una estimación que la columna de su propio
// renglón declaraba dentro de plazo, en la misma vista.
console.log('\n7. El plazo de pago: una sola cuenta para el renglón y el KPI');
const hace = d => {
  const f = new Date(); f.setDate(f.getDate() - d);
  return `${f.getFullYear()}-${String(f.getMonth()+1).padStart(2,'0')}-${String(f.getDate()).padStart(2,'0')}`;
};
const plazos = constructora(obraC, [
  { no: 1, monto: 1_000_000, estatus: 'Facturada', fechaFact: hace(45) },  // vencida
  { no: 2, monto: 1_000_000, estatus: 'Facturada', fechaFact: hace(26) },  // por vencer
  { no: 3, monto: 1_000_000, estatus: 'Facturada', fechaFact: hace(3)  },  // holgada
  { no: 4, monto: 1_000_000, estatus: 'En proceso' },                      // nada que decir
  { no: 5, monto: 1_000_000, estatus: 'Facturada' },                       // sin fecha
]);
const dichos = plazos.renglones.map(r => r.atraso?.texto ?? null);
check(/15 ?d de atraso/.test(String(dichos[0])),
  'una facturada hace 45 días con plazo de 30 dice 15 d de atraso, no 14 ni 16',
  `«${dichos[0]}»`);
check(/4 ?d para vencer/.test(String(dichos[1])),
  'una que va a vencer lo avisa antes, con los días que le quedan',
  `«${dichos[1]}»`);
check(String(dichos[2]) === 'Dentro de plazo',
  'una recién facturada dice que está dentro de plazo',
  `«${dichos[2]}»`);
check(dichos[3] === null && dichos[4] === null,
  'una «En proceso» y una facturada sin fecha no dicen nada: todavía no hay plazo corriendo',
  JSON.stringify([dichos[3], dichos[4]]));
// La fecha se lee LOCAL. Con `new Date(iso)` —medianoche UTC— al oeste de
// Greenwich se cuenta un día de más, y un día de más en un plazo de pago es un
// reclamo al cliente que no procede.
const rojos = plazos.renglones.filter(r => r.atraso?.color === plazos.renglones[0].atraso.color
                                        && /atraso/.test(r.atraso.texto));
check(rojos.length === 1,
  'y la cuenta del renglón marca en rojo exactamente una, la misma que contaría el KPI',
  `${rojos.length} en rojo de 5`);

// ── Resultado ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
if (fallos.length === 0) {
  console.log('VERDE — el estado de cuenta suma por número, escribe donde debe y no inventa porcentajes.\n');
  process.exit(0);
}
console.log(`ROJO — ${fallos.length} fallo(s):`);
for (const f of fallos) console.log(`  · ${f}`);
console.log('');
process.exit(1);
