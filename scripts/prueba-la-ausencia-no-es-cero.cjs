#!/usr/bin/env node
// La ausencia de medida no se publica como cero.
//
// QUÉ SE AFIRMA. Dos series distintas aplanaban a 0 una semana que nadie midió,
// y el 0 sale a pantalla como un hecho sobre la obra:
//
//   #113 — `serieAvanceDeSemanas` arrastra el último avance conocido, pero
//       ANTES de la primera captura no hay nada que arrastrar y el `?? 0`
//       llenaba esas semanas con «0.0%» en la columna Avance de la tabla de
//       la gráfica. Una obra recién dada de alta se leía como una obra PARADA.
//       Y la obra sin catálogo de conceptos —que no tiene avance vivo con qué
//       medirse— se llenaba de ceros de punta a punta.
//
//   #116 — `semanasDeNomina` une las partes de una semana sumando campo por
//       campo. La suma vacía da 0, así que un archivo de nómina que no trae el
//       conteo de personal entregaba `totalDir: 0, totalInd: 0` y las cuatro
//       pantallas que publican plantilla afirmaban «0 personas». Peor: el
//       consolidado del portafolio metía a esa obra al total sumando cero y
//       publicaba la baja de toda su plantilla como un delta medido.
//
// LA FORMA DE AFIRMARLO. Las dos cuentas se EXTRAEN del archivo y se EJECUTAN,
// y la del avance además se RENDERIZA con la `TablaSemanas` y las columnas
// reales de los dos tableros —el de constructora y el de dependencia— para leer
// lo que de verdad sale impreso en la celda. Un banco que comprobara que existe
// un `null` en el código no vería volver el defecto por la otra rama.
//
// La sección 0 no prueba la aplicación: protege al banco. Si la fixture no
// produjera de verdad una semana sin medir y otra medida, todo lo de abajo
// pasaría por vacío.
//
// `--contraprueba` devuelve CADA UNA de las cuentas a su conducta vieja, por
// separado, dejando el andamiaje entero en pie: los nombres siguen existiendo,
// la tabla sigue siendo la misma y las columnas siguen llamándose igual. Cada
// mutación tiene que poner esto en ROJO; si una no lo pone, ese trozo del banco
// no está mirando nada.
//
// Uso:  node scripts/prueba-la-ausencia-no-es-cero.cjs [archivo]
//       node scripts/prueba-la-ausencia-no-es-cero.cjs --contraprueba

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');

// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const archivo = process.argv.find(a => a.endsWith('.jsx')) || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Lo que se saca del archivo ─────────────────────────────────────────────
// Las columnas de la tabla se localizan por el sitio donde se MONTAN —el
// `columnas` de un `<TablaSemanas/>`—, no por un nombre: son un literal dentro
// de la tarjeta y no hay nada que pedir por nombre. Hay dos, uno por tablero, y
// los dos se miran: el defecto estaba en los dos y arreglar uno solo deja a la
// dependencia leyendo el cero.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const columnasSrc = [];
// Y el rótulo del KPI «Personal» de la pestaña de Nómina, por el mismo motivo:
// es un atributo de un literal JSX, no hay nombre que pedir. Ese rótulo es lo
// que la pantalla afirma sobre DE DÓNDE sale el número, y por él se pide el
// archivo que falta: decía «en listado» junto a un listado que no vino.
let subPersonalSrc = null;
traverse(parse(src, { sourceType: 'module', plugins: ['jsx'] }), {
  JSXOpeningElement(p) {
    if (p.node.name.name === 'TablaSemanas') {
      const attr = p.node.attributes.find(a => a.name?.name === 'columnas');
      if (attr) columnasSrc.push(src.slice(attr.value.expression.start, attr.value.expression.end));
      return;
    }
    if (p.node.name.name !== 'Kpi' || subPersonalSrc) return;
    const lbl = p.node.attributes.find(a => a.name?.name === 'label');
    if (lbl?.value?.value !== 'Personal') return;
    const sub = p.node.attributes.find(a => a.name?.name === 'sub');
    // DESDE EL 2026-11-25 HAY DOS `<Kpi label="Personal"/>`: el de la pestaña
    // de Nómina —que es el de esta prueba— y el del tablero de obra, que se
    // llamaba «Personal» y se acortó al fijar la lista de seis
    // indicadores. El rótulo dejó de bastar para distinguirlos.
    //
    // Se distinguen por lo que el `sub` LEE, que es lo que cada uno afirma:
    // el de Nómina habla de la carga de la semana (`fuente`, `trabs`…) y el
    // del tablero se cuelga de `plantilla`. Atarlo a la posición —«el
    // primero»— volvería a romperse el día que alguien mueva una pantalla.
    const fuenteSub = sub?.value?.expression
      ? src.slice(sub.value.expression.start, sub.value.expression.end) : '';
    if (/\bplantilla\b/.test(fuenteSub)) return;   // ése es el del tablero de obra
    if (sub?.value?.expression)
      subPersonalSrc = src.slice(sub.value.expression.start, sub.value.expression.end);
  },
});

const PEDIDOS = ['serieAvanceDeSemanas', 'semanasDeVentana', 'semanasDeNomina',
  'personalDeSemana', 'trabsDeCarga', 'TablaSemanas', 'columnasSemanales'];
const faltan = [];
if (columnasSrc.length < 2)
  faltan.push(`los dos <TablaSemanas columnas={…}> de los tableros (hay ${columnasSrc.length})`);
if (!subPersonalSrc) faltan.push('el `sub` del <Kpi label="Personal"/> de la pestaña de Nómina');
let api = null;
try {
  const { cuerpo } = fuenteDe(archivo, PEDIDOS);
  const js = esbuild.transformSync(cuerpo, { loader: 'jsx' }).code;
  api = new Function('React', `"use strict";\n${js}\nreturn { ${PEDIDOS.join(', ')} };`)(React);
} catch (e) {
  faltan.push(...(e.faltantes || [e.message]));
}
if (faltan.length) noArranco(faltan, path.basename(archivo));

const { serieAvanceDeSemanas, semanasDeVentana, semanasDeNomina,
        personalDeSemana, trabsDeCarga, TablaSemanas, columnasSemanales } = api;

// La celda de la columna Avance, tal como la imprime la tabla real. Las otras
// columnas de la misma tabla necesitan datos que este banco no mide, y se les
// pasan vacías: lo que se lee es la celda de Avance, no el resto del renglón.
const columnaAvance = (tablero, semanas, avance) => {
  const vacias = semanas.map(() => null);
  const g = { avance, programadoPct: vacias, programado: vacias, ejecutado: vacias,
    gasto: vacias, margen: vacias };
  // LAS COLUMNAS SE PIDEN A `columnasSemanales`, que es donde viven desde el
  // 2026-11-23: antes se extraía el literal `columnas={[…]}` del JSX y se
  // ejecutaba con los deltas inyectados a mano. Ese literal pasó a ser
  // `COLS.map(…)` cuando la tabla se compartió con el PDF, y el banco salió NO
  // ARRANCÓ con `COLS is not defined` — sin medir nada, y por un cambio que no
  // tocó la conducta que vigila. Pedírselas a la función es además lo que el
  // banco quería decir: que la columna Avance de LA TABLA no publique ceros.
  const cols = columnasSemanales(
    { ...g, fronteraAvance: { hay: false, idx: -1 }, gastoPorSem: {},
      gastoMedido: false, gastoSinFechar: false },
    semanas);
  const colCruda = cols.find(c => c.titulo === 'Avance');
  // El formato lo pone el consumidor; aquí se pinta como la pantalla.
  const col = colCruda && { ...colCruda,
    fmt: (v) => Number(v || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + '%' };
  if (!col) noArranco(['la columna «Avance» de la tabla de semanas'], path.basename(archivo));
  const html = renderToStaticMarkup(
    React.createElement(TablaSemanas, { semanas, columnas: [col] }));
  // Una celda por semana, en el orden en que la tabla las pinta (de la más
  // reciente hacia atrás). Se devuelven en orden de calendario para poder
  // compararlas contra la serie sin reinvertir nada aquí.
  return [...html.matchAll(/<td[^>]*text-align:right[^>]*>([^<]*)<\/td>/g)]
    .map(m => m[1].trim()).reverse();
};

// ── Contraprueba ──────────────────────────────────────────────────────────
// Cada mutación devuelve UNA de las dos cuentas a su conducta vieja y vuelve a
// correr este mismo banco sobre el archivo mutado. Lo que cambia es sólo lo que
// sale a pantalla: los nombres, la tabla y los rótulos quedan intactos.
if (process.argv.includes('--contraprueba')) {
  const MUTACIONES = [
    ['#113 · el avance vuelve a publicar 0 donde nadie midió',
     'serie.push(acarreo);', 'serie.push(acarreo ?? 0);'],
    ['#116 · la unión de partes vuelve a aplanar el campo ausente a cero',
     `const suma = (campo) => partes.some(p => typeof p?.[campo] === 'number')
      ? partes.reduce((t, p) => t + (p?.[campo] || 0), 0)
      : null;`,
     'const suma = (campo) => partes.reduce((t, p) => t + (p?.[campo] || 0), 0);'],
    ['#116 · el renglón del listado vuelve a contar un listado que no vino',
     'const trabsDeCarga = (carga, { corto = false } = {}) => {',
     `const trabsDeCarga = (carga, { corto = false } = {}) => {
  return \`\${(carga?.trabajadores || []).length} \${corto ? 'trab' : 'trabajadores'}\`;`],
    ['#116 · el rótulo del KPI vuelve a nombrar un listado que no vino',
     `: \`\${persActual.fuente === 'desglose' ? 'del desglose' : 'contado del listado'}\` +
                \`\${conPago === null ? '' : ' · con pago'}\`}`,
     `: (persActual.fuente === 'listado' ? 'contado del listado'
                : conPago === null ? 'en listado' : 'en listado · con pago')}`],
  ];
  let malas = 0;
  MUTACIONES.forEach(([titulo, de, a], n) => {
    console.log(`\nContraprueba — ${titulo}`);
    if (!src.includes(de)) {
      console.log('  La conducta vieja ya no se puede reinstalar: el trozo cambió de forma.');
      console.log('  Eso NO es que el banco mire; es que la contraprueba dejó de apuntar.');
      malas++;
      return;
    }
    const mutado = path.join(require('os').tmpdir(), `contra-ausencia-${n}.jsx`);
    fs.writeFileSync(mutado, src.replace(de, a));
    const r = require('child_process').spawnSync(process.execPath, [__filename, mutado],
      { encoding: 'utf8' });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    console.log(r.stdout.replace(/^/gm, '  │ '));
    if (r.status === 2) { console.log('  NO ARRANCÓ: la mutación tumbó el andamiaje, no la conducta.'); malas++; }
    else if (rojas === 0) { console.log('  EN ROJO: romper la conducta no tumbó nada.'); malas++; }
    else console.log(`  Correcta: ${rojas} comprobación(es) se cayeron.`);
  });
  console.log(malas === 0
    ? `\nContraprueba correcta: las ${MUTACIONES.length} conductas se miran por separado.`
    : `\nCONTRAPRUEBA EN ROJO: ${malas} mutación(es) no se notaron.`);
  process.exit(malas === 0 ? 0 : 1);
}

// ══════════════════════════════════════════════════════════════════════════
// La ventana sale de la función real, así que las semanas son las de HOY y el
// banco no caduca con el reloj. Los cierres se cuelgan de las semanas que la
// ventana produjo —no de números tecleados— por lo mismo.
const obra = { inicio: '2024-01-15', presupuesto: 2_000_000, modoAvance: 'importe' };
const semanas = semanasDeVentana(obra, 6);
const cierre = (s, pct) => ({ semana: s.sem, año: s.año, avancePonderado: pct,
  esquema: 2, montoEjecutado: pct / 100 * 2_000_000 });
// Catálogo al 50% de un contrato de $2M → avance vivo del 25%.
const SUBS = [{ imp: 1_000_000, a: 50 }];

console.log('0. La fixture produce de verdad los dos estados (si no, lo de abajo pasa por vacío)');
check(semanas.length === 6, 'la ventana son seis semanas', String(semanas.length));
const tardia = serieAvanceDeSemanas({ semanas, subs: [], obra,
  historialAvance: [cierre(semanas[3], 40), cierre(semanas[5], 55)] });
check(tardia.idxPrimerAvance === 3,
  'el primer cierre cae en la cuarta semana de la ventana, no en la primera',
  `idx ${tardia.idxPrimerAvance}`);
check(tardia.serie.slice(3).every(v => typeof v === 'number'),
  'y de ahí en adelante todas las semanas sí traen avance medido');

console.log('\n1. #113 · Antes del primer cierre la columna Avance dice que no se midió');
check(tardia.serie.slice(0, 3).every(v => v === null),
  'las tres semanas anteriores al primer cierre llegan en null, no en 0',
  JSON.stringify(tardia.serie));
check(!tardia.serie.slice(0, 3).some(v => v === 0),
  'ni una sola de ellas vale 0 — un 0 es una obra parada, y nadie midió eso');
check(tardia.serie[3] === 40 && tardia.serie[4] === 40 && tardia.serie[5] === 55,
  'el arrastre del último valor conocido sigue funcionando: 40 · 40 · 55',
  tardia.serie.slice(3).join(' · '));

for (const [i, cual] of [[0, 'constructora'], [1, 'dependencia']]) {
  const celdas = columnaAvance(i, semanas, tardia.serie);
  check(celdas.slice(0, 3).every(c => c === 'sin medir'),
    `tablero de ${cual}: la celda imprime «sin medir»`, celdas.slice(0, 3).join(' | '));
  check(!celdas.slice(0, 3).some(c => /^0([.,]0)?%$/.test(c)),
    `tablero de ${cual}: y NO el «0.0%» que publicaba antes`, celdas.slice(0, 3).join(' | '));
  check(celdas[3] === '40%' && celdas[5] === '55%',
    `tablero de ${cual}: lo medido se sigue imprimiendo`, `${celdas[3]} … ${celdas[5]}`);
}

console.log('\n2. #113 · Una obra sin catálogo no va en 0%: no hay con qué medirla');
const sinCatalogo = serieAvanceDeSemanas({ semanas, subs: [], obra, historialAvance: [] });
check(sinCatalogo.serie.every(v => v === null),
  'la serie entera llega sin medir, no en ceros',
  JSON.stringify(sinCatalogo.serie));
check(sinCatalogo.avanceActual === null,
  'y el avance vivo tampoco se inventa un 0', String(sinCatalogo.avanceActual));
const celdasSin = columnaAvance(0, semanas, sinCatalogo.serie);
check(celdasSin.every(c => c === 'sin medir'),
  'en pantalla, las seis celdas dicen «sin medir»', celdasSin.join(' | '));

console.log('\n3. #113 · Lo que SÍ se pudo medir no se apagó de paso');
const conCatalogo = serieAvanceDeSemanas({ semanas, subs: SUBS, obra, historialAvance: [] });
check(conCatalogo.avanceActual === 25,
  'con catálogo al 50% de la mitad del contrato, el avance vivo es 25%',
  String(conCatalogo.avanceActual));
check(conCatalogo.serie.every(v => v === 25),
  'y la serie lo publica mientras el historial viaja, en vez de quedarse muda',
  JSON.stringify(conCatalogo.serie));
// Un cierre ANTERIOR a la ventana se arrastra igual que antes: la ventana corta
// la vista, no la obra.
const antes = { ...semanas[0] };
const previo = serieAvanceDeSemanas({ semanas, subs: [], obra,
  historialAvance: [{ semana: antes.sem, año: antes.año - 1, avancePonderado: 20, esquema: 2 }] });
check(previo.serie.every(v => v === 20),
  'y un cierre de antes de la ventana se arrastra a las seis semanas',
  JSON.stringify(previo.serie));

console.log('\n4. #116 · Un campo que ninguna parte trae no vale cero');
const SEM = { semana: 'Semana 38', fecha: '21/9/2026' };
const dosPartesSinConteo = semanasDeNomina([
  { ...SEM, archivo: 'A.xlsx', totalNomina: 500_000 },
  { ...SEM, archivo: 'B.xlsx', totalNomina: 150_000 },
]);
check(dosPartesSinConteo.length === 1 && dosPartesSinConteo[0].partes.length === 2,
  'las dos partes siguen uniéndose en una semana');
const u = dosPartesSinConteo[0];
check(u.totalDir === null && u.totalInd === null,
  'el conteo de personal que nadie trajo llega en null, no en 0',
  `${u.totalDir} · ${u.totalInd}`);
check(u.totalNomina === 650_000,
  'y el total en pesos, que SÍ trajeron las dos, se sigue sumando',
  String(u.totalNomina));
check(personalDeSemana(u).total === null,
  'así que la plantilla de esa semana es «sin conteo», no «0 personas»',
  String(personalDeSemana(u).total));

console.log('\n5. #116 · Pero si ALGUNA parte lo trae, se suman las que lo traen');
const mixta = semanasDeNomina([
  { ...SEM, archivo: 'A.xlsx', totalDir: 51, totalInd: 83, totalNomina: 500_000 },
  { ...SEM, archivo: 'B.xlsx', totalNomina: 150_000 },
])[0];
check(mixta.totalDir === 51 && mixta.totalInd === 83,
  'el dato de la parte que sí lo midió no se tira',
  `${mixta.totalDir}D · ${mixta.totalInd}I`);
check(personalDeSemana(mixta).total === 134,
  'y la plantilla son 134 personas, con su desglose',
  String(personalDeSemana(mixta).total));
check((mixta.partes || []).length === 2,
  'que la semana llegó en dos archivos lo dice `partes`, no un conteo recortado');

console.log('\n6. #116 · Sin desglose, el conteo sale del listado de trabajadores');
// La otra cara del mismo dato: el importador escribe el desglose Y el listado.
// Si falta el desglose pero está el listado, contarlo no es estimar — es la
// misma cuenta por el otro lado. Lo que no se hace es publicar 0.
const conListado = semanasDeNomina([{ ...SEM, archivo: 'A.xlsx', totalNomina: 300_000,
  tipoDeColumna: 3, tipoDePuesto: 0,
  trabajadores: [{ tipo: 'D' }, { tipo: 'D' }, { tipo: 'I' }] }])[0];
const p = personalDeSemana(conListado);
check(p.total === 3 && p.dir === 2 && p.ind === 1,
  'tres personas, dos directas y una indirecta, contadas del listado',
  `${p.total} · ${p.dir}D · ${p.ind}I`);
check(p.fuente === 'listado',
  'y la pantalla puede decir de dónde salió el número', String(p.fuente));
check(personalDeSemana({ totalDir: 51, totalInd: 83 }).fuente === 'desglose',
  'mientras que con desglose la fuente es el desglose');
check(personalDeSemana(undefined).total === null && personalDeSemana(null).total === null,
  'y sin semana no hay conteo, sin reventar');

// ── LA AUSENCIA QUE SE DESCUBRIÓ DESPUÉS: NO SABER DE DÓNDE SALIÓ EL TIPO ──
// Este banco existe porque un campo que nadie midió se publicaba como cero.
// El desglose D/I tenía la versión cara del mismo defecto: se publicaba como
// MEDIDO algo que en 27 de 67 semanas de producción había salido de aplicarle
// doce palabras al puesto (medido el 2026-11-19). Así que ahora la plantilla y
// su desglose se contestan por separado, y el desglose se calla cuando no
// consta que lo dijera el Excel. Callarse no es decir cero: el total sigue.
const sinProcedencia = semanasDeNomina([{ ...SEM, archivo: 'A.xlsx', totalNomina: 300_000,
  trabajadores: [{ tipo: 'D' }, { tipo: 'D' }, { tipo: 'I' }] }])[0];
const sp = personalDeSemana(sinProcedencia);
check(sp.total === 3, 'sin procedencia, las tres personas siguen contadas', String(sp.total));
check(sp.dir === null && sp.ind === null,
  'pero el desglose NO se publica: no consta que el Excel lo dijera',
  `${sp.dir}D · ${sp.ind}I`);
check(sp.diDe === null,
  'y se distingue de «el archivo no la traía»: aquí la carga no dice nada',
  String(sp.diDe));
// Media semana contada y media adivinada tampoco es un desglose: una sola fila
// inferida basta para callarlo. Si en vez de esto se publicara la parte
// contada, el número saldría más chico que el total y nadie sabría por qué.
const medioAdivinada = semanasDeNomina([{ ...SEM, archivo: 'A.xlsx', totalNomina: 300_000,
  tipoDeColumna: 2, tipoDePuesto: 1,
  trabajadores: [{ tipo: 'D' }, { tipo: 'D' }, { tipo: 'I' }] }])[0];
const ma = personalDeSemana(medioAdivinada);
check(ma.total === 3 && ma.dir === null && ma.diDe === 'puesto',
  'con una sola fila adivinada el desglose se calla, y dice que fue por el puesto',
  `${ma.total} · ${ma.dir}D · ${ma.diDe}`);
// Y una semana que llegó en dos archivos exige que los DOS lo declaren: con uno
// solo, la procedencia describe la mitad de la gente que el desglose cuenta.
const mitadDeclara = semanasDeNomina([
  { ...SEM, archivo: 'A.xlsx', tipoDeColumna: 2, tipoDePuesto: 0,
    trabajadores: [{ tipo: 'D' }, { tipo: 'D' }] },
  { ...SEM, archivo: 'B.xlsx', trabajadores: [{ tipo: 'I' }] },
])[0];
check(personalDeSemana(mitadDeclara).total === 3
   && personalDeSemana(mitadDeclara).dir === null,
  'si sólo una de las dos partes declara su procedencia, no hay desglose',
  `${personalDeSemana(mitadDeclara).total} · ${personalDeSemana(mitadDeclara).dir}D`);

console.log('\n7. #116 · El renglón del listado no cuenta un listado que no vino');
// Tres renglones de la pestaña de Nómina publicaban `trabajadores.length`, y ese
// cero quiere decir dos cosas distintas. El caso que se vio en pantalla: la
// semana de la 0121 con su desglose quitado decía «0 trabajadores» justo debajo
// de un KPI que decía «sin conteo».
check(trabsDeCarga(conListado) === '3 trabajadores',
  'con listado, se cuenta el listado', trabsDeCarga(conListado));
check(trabsDeCarga(mixta) === '134 trabajadores · sin listado nominal',
  'con desglose y sin listado, se publica el desglose y se dice que el listado no vino',
  trabsDeCarga(mixta));
check(trabsDeCarga(u) === 'sin conteo de personal',
  'y sin ninguno de los dos no hay cifra — ni un 0 que diga que no hubo gente',
  trabsDeCarga(u));
check(!/\b0 trab/.test([conListado, mixta, u].map(c => trabsDeCarga(c)).join(' | ')),
  'en ninguno de los tres casos sale un «0 trab»');
check(trabsDeCarga(mixta, { corto: true }) === '134 trab (del desglose)' &&
      trabsDeCarga(u, { corto: true }) === 'sin conteo de personal',
  'el renglón angosto del desglose por archivo dice lo mismo, más corto',
  trabsDeCarga(mixta, { corto: true }));
check(trabsDeCarga(undefined) === 'sin conteo de personal',
  'y sin carga tampoco revienta ni inventa un cero');

console.log('\n8. #116 · El rótulo del KPI sigue a la fuente del número');
// El rótulo se EJECUTA tal como está en el JSX. No se comprueba que diga una
// cadena concreta por gusto: es por él por donde el usuario sabe si le falta
// subir el listado nominal o no, y con el desglose decía «en listado».
const rotulo = (sem) => new Function('enListado', 'persActual', 'conPago',
  `"use strict"; return ${subPersonalSrc};`)(
  personalDeSemana(sem).total, personalDeSemana(sem),
  (sem?.trabajadores || []).length > 0
    ? sem.trabajadores.filter(x => (x.total || 0) > 0).length : null);
const soloDesglose = { totalDir: 26, totalInd: 8, totalNomina: 486_000, trabajadores: [] };
check(rotulo(soloDesglose) === 'del desglose',
  'con el desglose el rótulo dice desglose, y no nombra un listado que no vino',
  rotulo(soloDesglose));
check(!/listado/.test(rotulo(soloDesglose)),
  'ni la palabra «listado» aparece en ese caso');
check(rotulo({ trabajadores: [{ tipo: 'D', total: 5000 }, { tipo: 'I', total: 0 }] })
  === 'contado del listado · con pago',
  'con listado dice listado, y añade «con pago» porque esa pregunta sí se contestó',
  rotulo({ trabajadores: [{ tipo: 'D', total: 5000 }, { tipo: 'I', total: 0 }] }));
check(rotulo(u) === 'la nómina de la semana no trae el conteo',
  'y sin ninguno de los dos el rótulo lo dice en vez de rotular un cero',
  rotulo(u));

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
