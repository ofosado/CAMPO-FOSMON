#!/usr/bin/env node
// La hoja de GP entra completa, o no entra.
//
// QUÉ SE AFIRMA. `parsearGPConstruct` (functions/index.js) es la única puerta
// por la que el gasto real llega a cotea: baja la hoja que Luis Mayo actualiza
// los domingos y de ahí salen las obras que existen, sus rubros, sus
// proveedores y el gasto por semana, mes y año. Lo que este banco exige no es
// que el parser devuelva los números que yo escriba —eso sería compararlo
// contra una copia mía— sino que CUADRE CONTRA LA PROPIA HOJA:
//
//   · la suma de las obras es el «Total general» que la hoja ya trae escrito
//   · cada obra es la suma de sus rubros, y cada rubro la de sus proveedores,
//     en el acumulado, por año, por mes y por semana
//   · los meses de un nodo suman su total de ese mismo año
//   · los meses publicados son los del año más reciente de la hoja, tantos
//     como bloques mensuales tenga ese año a la derecha
//
// La hoja de prueba es un recorte fiel de la real: dos años con sus totales
// anuales, meses con su «Total N .- Mes» por año, semanas repetidas por año,
// la fila de sección «2 EGRESOS», un subtotal «Total 0101 …» y el «Total
// general» de cierre. Se CARGA de `scripts/hoja-gp-de-prueba.csv` (P7: un
// banco carga su insumo, no lo hereda del entorno ni lo lleva en una cadena
// dentro del propio código, que volvería a ser una copia).
//
// POR QUÉ ESTE BANCO EXISTE. Medido contra la hoja real el 2026-10-27, el
// parser tiraba o mentía en cuatro sitios, y los cuatro en silencio:
//
//   A. Rubros indexados por el código de 3 dígitos. 14 de 34 obras traen
//      «300 INDIRECTOS» y «300 SUBCONTRATOS»: el segundo nunca se creaba y sus
//      proveedores se colgaban del primero. $1,308,275.55 de subcontratos de
//      la 0112 salían rotulados «INDIRECTOS», y $2,487,929.25 de la 0114.
//   B. Los totales mensuales eran los de 2024 con etiqueta de 2026. Los doce
//      meses «de 2026» de la 0099 sumaban $20,119,989.65 — exactamente su
//      total de 2024 — y la hoja listaba noviembre y diciembre de un año que
//      iba por la semana 43.
//   C. El proveedor cuyo nombre empieza con dígito se descartaba. «3.1 SWEET
//      INMOBILIARIA…», $22,000.00 en la 0099.
//   D. El filtro de subtotales era «empieza con total», y se comía a TOTAL
//      PLAY TELECOMUNICACIONES, un proveedor real: $37,092.90 en la 0001 y
//      $35,988.79 en la 0037.
//
// Ninguno dejaba un hueco visible. Dejaban una cifra creíble y distinta, que
// es la forma en que el dinero se pierde sin que nadie lo note: 16 de 34 obras
// tenían una tabla de rubros que no sumaba su propio KPI.
//
// Uso:  node scripts/prueba-parser-gp.cjs
//
// CONTRAPRUEBA, comprobada, devolviendo cada defecto uno por uno sobre
// `functions/index.js` y corriendo este mismo banco:
//
//   · rubro indexado por `label.slice(0,3)`         → 11 en rojo, salida 1
//   · meses sin año (la primera «Total 1 .- Enero»)  →  2 en rojo, salida 1
//   · el guardia `!/^\d/.test(label)` del proveedor  →  5 en rojo, salida 1
//   · el filtro `/^total/i` suelto                   →  5 en rojo, salida 1
//
// Y el dato que justifica la forma: con el defecto A puesto, «la suma de las
// obras es el Total general» SIGUE EN VERDE —el dinero no se va a ningún lado,
// sólo cambia de etiqueta— y lo que se mueve son los renglones de cada rubro.
// Un banco que sólo mirara el gran total habría firmado eso como bueno. Con el
// defecto B pasa lo contrario y por eso hace falta la sección 3: todas las
// sumas cuadran entre sí, porque el parser lee consistentemente la columna
// equivocada; lo único que lo delata es comparar los meses contra el total
// ANUAL de su propio año.

'use strict';

const fs = require('fs');
const path = require('path');
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion, vigilarExcepciones } = noArranco;

const RAIZ = path.resolve(__dirname, '..');
const HOJA = path.join(__dirname, 'hoja-gp-de-prueba.csv');

vigilarExcepciones('functions/index.js');

const { deFunciones, deApp, SimboloPerdido } = require('./extraer-de-app.cjs');

let parsearGPConstruct, parseCsvLine, parseMonto, extraerGastoTotalGP, resolverGastoGP;
try {
  ({ parsearGPConstruct, parseCsvLine, parseMonto } =
    deFunciones('parsearGPConstruct', 'parseCsvLine', 'parseMonto'));
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}
try {
  ({ extraerGastoTotalGP, resolverGastoGP } = deApp('extraerGastoTotalGP', 'resolverGastoGP'));
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}

if (!fs.existsSync(HOJA)) {
  sinPrecondicion(
    'la hoja de prueba ' + path.relative(RAIZ, HOJA),
    ['Es un archivo del repositorio, no un volcado: debería estar versionado.',
     'Recuperarlo con `git checkout -- ' + path.relative(RAIZ, HOJA) + '`.']);
}
const csv = fs.readFileSync(HOJA, 'utf8');

// ── utilería de reporte ──
let fallas = 0;
const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-MX',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cerca = (a, b) => Math.abs((a || 0) - (b || 0)) < 0.01;

const ok = (texto) => console.log('   ok    ' + texto);
const mal = (texto, detalle) => {
  fallas++;
  console.log('   FALLA ' + texto);
  if (detalle) for (const d of [].concat(detalle)) console.log('         ' + d);
};
const exigir = (cond, texto, detalle) => cond ? ok(texto) : mal(texto, detalle);
const exigirCifra = (real, esperado, texto) =>
  exigir(cerca(real, esperado), texto,
    cerca(real, esperado) ? null : [`esperado ${pesos(esperado)} · salió ${pesos(real)} · ` +
      `difiere en ${pesos((real || 0) - (esperado || 0))}`]);

const seccion = (t) => console.log('\n' + t);

// ── lo que la hoja dice de sí misma, leído aparte del parser ──
// Releer el CSV a mano no es duplicar la cuenta: es el ANCLA. Si el banco se
// conformara con la salida del parser comparada consigo misma, un parser que
// tirara la mitad de la hoja seguiría saliendo consistente.
const filas = csv.split('\n').map(parseCsvLine);
const r = parsearGPConstruct(csv);
const COL_GT = r.colMap.grand_total;

if (COL_GT === undefined) {
  mal('el parser no encontró la columna «Total general» en la hoja de prueba',
      ['sin esa columna no hay nada que cuadrar; revisar la cabecera del CSV']);
  console.log('\n1 FALLA');
  process.exit(1);
}

const filaTotalGeneral = filas.find(f => /^total\s+general$/i.test((f[1] || '').trim()));
const totalDeLaHoja = filaTotalGeneral ? Math.abs(parseMonto(filaTotalGeneral[COL_GT]) || 0) : NaN;

const obras = Object.values(r.obras);

// ───────────────────────────────────────────────────────────────────────────
seccion('1 · el dinero de la hoja llega entero y cada cuenta cuadra con la suya');

exigir(obras.length === 2,
  `la hoja trae 2 obras y el parser devuelve ${obras.length}`,
  obras.length === 2 ? null : ['obras vistas: ' + obras.map(o => o.id).join(', ')]);

const sumaObras = obras.reduce((t, o) => t + o.grandTotal, 0);
exigirCifra(sumaObras, totalDeLaHoja,
  'la suma de las obras es el «Total general» que la hoja ya traía escrito');

// Cada obra contra sus rubros y cada rubro contra sus proveedores, en TODAS
// las series, no sólo en el acumulado. Un proveedor perdido mueve el renglón
// del rubro pero no el total de la obra, que sale de su propia fila.
const sumarSerie = (nodos, serie) => {
  const t = {};
  for (const n of nodos) for (const [k, v] of Object.entries(n[serie] || {})) t[k] = (t[k] || 0) + v;
  return t;
};
const compararSeries = (quien, propia, hijos, serie) => {
  const suma = sumarSerie(hijos, serie);
  const llaves = new Set([...Object.keys(propia || {}), ...Object.keys(suma)]);
  const malas = [...llaves].filter(k => !cerca((propia || {})[k], suma[k]));
  exigir(malas.length === 0, `${quien} · ${serie} cuadra con la suma de sus hijos`,
    malas.map(k => `${k}: el renglón dice ${pesos((propia || {})[k])} y sus hijos suman ${pesos(suma[k])}`));
};

for (const o of obras) {
  const rubros = Object.values(o.rubros);
  exigirCifra(rubros.reduce((t, x) => t + x.grandTotal, 0), o.grandTotal,
    `${o.id} · la tabla de rubros suma el total de la obra`);
  for (const serie of ['años', 'meses', 'semanas']) compararSeries(`${o.id}`, o[serie], rubros, serie);

  for (const ru of rubros) {
    exigirCifra(ru.proveedores.reduce((t, p) => t + p.grandTotal, 0), ru.grandTotal,
      `${o.id} · «${ru.nombre}» suma lo de sus proveedores`);
    for (const serie of ['años', 'meses', 'semanas'])
      compararSeries(`${o.id}/${ru.nombre}`, ru[serie], ru.proveedores, serie);
  }
}

// ───────────────────────────────────────────────────────────────────────────
seccion('2 · dos rubros con el mismo código son dos rubros (defecto A)');

const obra1 = obras.find(o => o.id === '0101');
if (!obra1) {
  mal('la obra 0101 de la hoja de prueba no salió del parser');
} else {
  const con300 = Object.values(obra1.rubros).filter(ru => ru.id === '300');
  exigir(con300.length === 2,
    `0101 · los dos rubros con código 300 conviven (salieron ${con300.length})`,
    con300.length === 2 ? null :
      ['rubros de la obra: ' + Object.values(obra1.rubros).map(x => x.nombre).join(' | '),
       'la hoja trae «300 INDIRECTOS» y «300 SUBCONTRATOS» por separado']);

  const nombres = con300.map(x => x.nombreCorto).sort();
  exigir(nombres.join('|') === 'INDIRECTOS|SUBCONTRATOS',
    '0101 · cada uno conserva su nombre, no el del primero',
    [`nombres vistos: ${nombres.join(' | ') || '(ninguno)'}`]);

  const sub = con300.find(x => x.nombreCorto === 'SUBCONTRATOS');
  const dueño = (nombre) => {
    for (const ru of Object.values(obra1.rubros))
      if (ru.proveedores.some(p => p.nombre.startsWith(nombre))) return ru.nombreCorto;
    return '(ninguno)';
  };
  exigir(dueño('CONSTRUCTORA EJEMPLO') === 'SUBCONTRATOS',
    '0101 · el proveedor de subcontratos NO cuelga de indirectos',
    [`«CONSTRUCTORA EJEMPLO…» salió rotulada «${dueño('CONSTRUCTORA EJEMPLO')}»`]);
  if (sub) exigirCifra(sub.grandTotal, 12000,
    '0101 · el rubro de subcontratos trae su propio dinero');
}

// ───────────────────────────────────────────────────────────────────────────
seccion('3 · los meses traen el año que les toca (defecto B)');

// El año más reciente, leído de la hoja: la última cabecera «20NN» por columna.
const filaAños = filas.find(f => f.some(c => /^20\d{2}$/.test((c || '').trim())));
const añosEnHoja = (filaAños || []).map(c => (c || '').trim())
  .filter(c => /^20\d{2}$/.test(c)).sort();
const añoReciente = añosEnHoja[añosEnHoja.length - 1];
const colAñoReciente = (filaAños || []).findIndex(c => (c || '').trim() === añoReciente);

// Cuántos bloques mensuales hay a la derecha de ese año: ése es el número de
// meses que la hoja puede sostener. Ni uno más.
const filaMeses = filas.find(f => f.some(c => /total\s+\d+\s*[.\-]+\s*[a-záéíóúA-ZÁÉÍÓÚ]+/i.test(c || '')));
const mesesDelAñoReciente = (filaMeses || []).filter((c, ci) =>
  ci > colAñoReciente && /total\s+\d+\s*[.\-]+\s*[a-záéíóúA-ZÁÉÍÓÚ]+/i.test(c || '')).length;

exigir(r.mesesDisponibles.length === mesesDelAñoReciente,
  `se publican ${mesesDelAñoReciente} meses, los que la hoja tiene en ${añoReciente}`,
  [`mesesDisponibles: ${r.mesesDisponibles.join(' ') || '(vacío)'}`]);

const deOtroAño = r.mesesDisponibles.filter(m => !m.startsWith('M' + añoReciente));
exigir(deOtroAño.length === 0,
  `ningún mes publicado es de un año que no sea ${añoReciente}`,
  [`colados: ${deOtroAño.join(' ')}`]);

// La prueba de fondo: para cada nodo con meses, los meses suman su total de
// ESE año. Con el defecto puesto sumaban el del año anterior, que es un número
// creíble y completamente ajeno.
const todosLosNodos = [];
for (const o of obras) {
  todosLosNodos.push([o.id, o]);
  for (const ru of Object.values(o.rubros)) {
    todosLosNodos.push([`${o.id}/${ru.nombre}`, ru]);
    for (const p of ru.proveedores) todosLosNodos.push([`${o.id}/${ru.id}/${p.nombre.slice(0, 24)}`, p]);
  }
}
let mesesMal = 0, mesesIgualAlAnterior = 0;
const añoAnterior = añosEnHoja[añosEnHoja.length - 2];
for (const [quien, n] of todosLosNodos) {
  const suma = Object.values(n.meses || {}).reduce((t, v) => t + v, 0);
  const propio = (n.años || {})['Y' + añoReciente] || 0;
  if (!cerca(suma, propio)) {
    mesesMal++;
    const delAnterior = (n.años || {})['Y' + añoAnterior] || 0;
    if (cerca(suma, delAnterior)) mesesIgualAlAnterior++;
    console.log(`         ${quien}: meses suman ${pesos(suma)} y su Y${añoReciente} es ${pesos(propio)}` +
      (cerca(suma, delAnterior) ? `  ← es su Y${añoAnterior}` : ''));
  }
}
exigir(mesesMal === 0,
  `en los ${todosLosNodos.length} nodos, los meses suman el total de ${añoReciente}`,
  mesesMal === 0 ? null : [`${mesesMal} nodo(s) descuadrados` +
    (mesesIgualAlAnterior ? `, de los cuales ${mesesIgualAlAnterior} traen el total de ${añoAnterior}` : '')]);

// ───────────────────────────────────────────────────────────────────────────
seccion('4 · un proveedor que se llama con un número sigue siendo un proveedor (defecto C)');

const buscarProv = (re) => {
  for (const o of obras) for (const p of o.proveedores) if (re.test(p.nombre)) return { o, p };
  return null;
};
const sweet = buscarProv(/^3\.1 SWEET/);
exigir(!!sweet, 'el proveedor «3.1 SWEET INMOBILIARIA…» está en el resultado',
  ['la hoja lo trae bajo 300 INDIRECTOS de la 0101 con $440.00']);
if (sweet) {
  exigirCifra(sweet.p.grandTotal, 440, 'y conserva su dinero');
  exigir(sweet.p.rubroNombre === 'INDIRECTOS', 'y queda bajo el rubro que le toca',
    [`salió bajo «${sweet.p.rubroNombre}»`]);
}

// ───────────────────────────────────────────────────────────────────────────
seccion('5 · «TOTAL PLAY» es un proveedor; «Total 0101 …» es un subtotal (defecto D)');

const totalPlay = buscarProv(/^TOTAL PLAY/i);
exigir(!!totalPlay, 'el proveedor «TOTAL PLAY TELECOMUNICACIONES…» no se confunde con un total');
if (totalPlay) exigirCifra(totalPlay.p.grandTotal, 4400, 'y conserva su dinero');

const subtotalColado = buscarProv(/^total\s+\d/i);
exigir(!subtotalColado, 'el renglón «Total 0101 CANGREJERA UNO» NO entra como proveedor',
  subtotalColado ? [`entró «${subtotalColado.p.nombre}» por ${pesos(subtotalColado.p.grandTotal)}, ` +
    'que duplicaría el total de la obra dentro de su propio rubro'] : null);

const seccionColada = buscarProv(/^\d\s+(EGRESOS|INGRESOS)/i);
exigir(!seccionColada, 'el renglón de sección «2 EGRESOS» tampoco entra como proveedor');

const sinMovimiento = buscarProv(/^PROVEEDOR SIN MOVIMIENTO/);
exigir(!sinMovimiento, 'un proveedor sin un peso en toda la hoja no ocupa renglón');

// ───────────────────────────────────────────────────────────────────────────
seccion('6 · cotea lee de esta estructura el mismo número');

// La hoja no sirve de nada si la pantalla la lee distinto. Se corre el lector
// REAL de `src/App.jsx` sobre lo que acaba de salir del parser de
// `functions/index.js`: son dos despliegues sin build compartido, y la única
// forma de exigir que coincidan es correr los dos.
for (const o of obras) {
  const porGpId = resolverGastoGP({ id: 'cualquiera', nombre: 'sin parecido', gpId: o.id },
    { obras: r.obras });
  exigirCifra(porGpId, o.grandTotal, `${o.id} · resolverGastoGP por gpId da el total de la obra`);
  exigirCifra(extraerGastoTotalGP(o), o.grandTotal, `${o.id} · extraerGastoTotalGP da el mismo número`);
}

// Y el caso que importa del lector: una obra SIN grandTotal cae a la suma de
// años más el total del año en curso. Si los meses trajeran el año equivocado,
// ésta es la pantalla que enseñaría el gasto de otro año como si fuera suyo.
const o1 = obras.find(o => o.id === '0101');
if (o1) {
  const sinAcumulado = { años: o1.años, meses: o1.meses };
  const esperado = Object.values(o1.años).reduce((t, v) => t + v, 0) +
    Object.values(o1.meses).reduce((t, v) => t + v, 0);
  exigirCifra(extraerGastoTotalGP(sinAcumulado), esperado,
    '0101 · sin acumulado, el lector cae a años + meses del año en curso');
  exigir(!cerca(Object.values(o1.meses).reduce((t, v) => t + v, 0), o1.años['Y' + añoAnterior]),
    `0101 · y esos meses no son los de ${añoAnterior} disfrazados`);
}

// ───────────────────────────────────────────────────────────────────────────
seccion('7 · una semana partida en dos columnas sigue siendo una semana (defecto E)');

// La hoja es una tabla dinámica agrupada por mes, y una semana de calendario
// que cruza el cambio de mes sale PARTIDA EN DOS COLUMNAS: la última de un mes
// y la primera del siguiente. No es un caso raro —en la hoja real pasa cinco
// veces en 2026, cinco en 2025 y seis en 2024, siempre en frontera de mes.
//
// El anclaje es el mismo de la sección 3 y por la misma razón: las sumas
// internas cuadran igual con el defecto puesto, porque el parser lee la misma
// columna equivocada para TODAS las filas. Lo único que lo delata es comparar
// la serie semanal contra el total ANUAL de su propio año, que la hoja trae
// escrito aparte.

const colsSemanaPorAño = (() => {
  const filaAñosL = filas.find(f => f.some(c => /^20\d{2}$/.test((c || '').trim())));
  const filaSem = filas.find(f => f.filter(c => /^[1-5]?[0-9]$/.test((c || '').trim())).length >= 3);
  if (!filaAñosL || !filaSem) return null;
  const porCol = [];
  filaAñosL.forEach((c, ci) => { if (/^20\d{2}$/.test((c || '').trim())) porCol.push([(c || '').trim(), ci]); });
  porCol.sort((a, b) => a[1] - b[1]);
  const mapa = {};
  let año = null, k = 0;
  for (let ci = 0; ci < filaSem.length; ci++) {
    while (k < porCol.length && ci >= porCol[k][1]) { año = porCol[k][0]; k++; }
    const cel = (filaSem[ci] || '').trim();
    if (!/^[1-5]?[0-9]$/.test(cel) || !año) continue;
    const n = parseInt(cel);
    if (n < 1 || n > 53) continue;
    (mapa[año] ||= {});
    (mapa[año][n] ||= []).push(ci);
  }
  return mapa;
})();

if (!colsSemanaPorAño) {
  sinPrecondicion('la fila de semanas de la hoja de prueba',
    ['Sin ella no se puede saber qué columnas forman cada semana.']);
}

// La hoja de prueba TIENE que traer una semana partida, o esta sección entera
// mide aire y daría verde sin haber probado nada.
const partidasEnLaHoja = Object.entries(colsSemanaPorAño[añoReciente] || {})
  .filter(([, cols]) => cols.length > 1);
if (partidasEnLaHoja.length === 0) {
  sinPrecondicion(
    `una semana repartida en dos columnas dentro de ${añoReciente}`,
    ['La hoja de prueba dejó de reproducir la forma de la real.',
     'En la real, una semana a caballo entre dos meses ocupa la última',
     'columna de uno y la primera del otro. Sin ese caso aquí, esta',
     'sección no prueba nada y el defecto volvería sin que nadie lo viera.']);
}

// (a) estructural: el parser tiene que conservar TODAS las columnas de la
//     semana, no quedarse con una. Es lo que el panel de diagnóstico enseña.
for (const [n, cols] of partidasEnLaHoja) {
  const enMapa = r.colMap[`week_${añoReciente}_${n}`];
  const vistas = [].concat(enMapa === undefined ? [] : enMapa);
  exigir(vistas.length === cols.length,
    `la semana ${n} ocupa ${cols.length} columnas en la hoja y el parser reporta ${vistas.length}`,
    vistas.length === cols.length ? null :
      [`la hoja la tiene en [${cols.join(', ')}] y colMap dice [${vistas.join(', ')}]`,
       'quedarse con una columna tira el dinero de la otra, en silencio']);
}

// (b) de fondo: la serie semanal de cada nodo suma su total de ese año.
let semanasMal = 0, dineroTirado = 0;
for (const [quien, n] of todosLosNodos) {
  const suma = Object.values(n.semanas || {}).reduce((t, v) => t + v, 0);
  const propio = (n.años || {})['Y' + añoReciente] || 0;
  if (cerca(suma, propio)) continue;
  semanasMal++;
  dineroTirado += propio - suma;
  console.log(`         ${quien}: las semanas suman ${pesos(suma)} y su Y${añoReciente} es ${pesos(propio)}` +
    `  ← faltan ${pesos(propio - suma)}`);
}
exigir(semanasMal === 0,
  `en los ${todosLosNodos.length} nodos, las semanas suman el total de ${añoReciente}`,
  semanasMal === 0 ? null : [
    `${semanasMal} nodo(s) descuadrados, ${pesos(dineroTirado)} que la serie semanal no ve`,
    'medido contra la hoja real el 2026-10-28, esto eran $9,719,396.98 en las',
    'cinco obras activas y $15,409,486.89 en las 34 de la hoja']);

// (c) y la obra entera contra el «Total general», no sólo contra su año: si
//     alguna columna se contara DOS veces la suma se pasaría, y (b) sola no
//     distingue «faltó una columna» de «sobró una».
for (const o of obras) {
  const porAños = Object.values(o.años || {}).reduce((t, v) => t + v, 0);
  exigirCifra(porAños, o.grandTotal,
    `${o.id} · sumar los años da el «Total general», ni de más ni de menos`);
}

// ───────────────────────────────────────────────────────────────────────────
seccion('8 · los dos lados del despliegue hablan de la misma versión de parser');

// `PARSER_VERSION` está escrito DOS VECES —en `functions/index.js`, que lo
// graba en `global/gp_construct`, y en `src/App.jsx`, que rechaza la caché si
// no empata— y cada uno viaja por un canal de despliegue distinto. Mientras
// uno esté arriba y el otro no, la pantalla dice «version_vieja» y no enseña
// cifras: honesto, pero sin gasto en pantalla hasta que suban los dos.
//
// Esto se comprueba leyendo el número de los dos archivos, no ejecutando: el
// de `src/App.jsx` vive dentro de `useGPConstruct` y la comparación está en
// línea en `cargarGP`, un `useCallback` que no se puede sacar y correr sin
// montar React. Se deja dicho para que nadie lo confunda con una prueba de
// conducta: lo que se exige aquí es COHERENCIA entre dos archivos, y el día
// que la comparación se pueda ejecutar, esta sección sobra.

const versionDe = (archivo, re) => {
  const txt = fs.readFileSync(path.join(RAIZ, archivo), 'utf8');
  const hits = [...txt.matchAll(re)].map(m => Number(m[1]));
  return { archivo, hits };
};
const enFunciones = versionDe('functions/index.js', /^const PARSER_VERSION = (\d+);/gm);
const enApp = versionDe('src/App.jsx', /^\s*const PARSER_VERSION = (\d+);/gm);

for (const { archivo, hits } of [enFunciones, enApp]) {
  if (hits.length !== 1) {
    sinPrecondicion(`un único \`PARSER_VERSION\` en ${archivo}`,
      [`se encontraron ${hits.length}: ${hits.join(', ') || '(ninguno)'}`,
       'o se renombró la constante, o hay dos y entonces no se sabe cuál manda']);
  }
}

exigir(enFunciones.hits[0] === enApp.hits[0],
  `functions/index.js y src/App.jsx dicen ambos PARSER_VERSION ${enFunciones.hits[0]}`,
  enFunciones.hits[0] === enApp.hits[0] ? null : [
    `functions/index.js dice ${enFunciones.hits[0]} y src/App.jsx dice ${enApp.hits[0]}`,
    'con estos distintos, el front rechaza la caché y la pantalla de gastos',
    'se queda sin cifras hasta que el otro canal también se despliegue']);

// ───────────────────────────────────────────────────────────────────────────
console.log('');
if (fallas) {
  console.log(`${fallas} FALLA${fallas === 1 ? '' : 'S'} — la hoja de GP no entra entera.`);
  process.exit(1);
}
console.log('VERDE — la hoja entra completa y cuadra contra sí misma.');
process.exit(0);
