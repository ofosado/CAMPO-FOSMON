#!/usr/bin/env node
// La consulta por obra tiene que decir EXACTAMENTE lo mismo que la hoja.
//
// QUÉ SE AFIRMA. El gasto real de cada obra deja de venir de la hoja que Luis
// Mayo refresca a mano y empieza a venir de la consulta de cheques por obra
// (`agruparRenglonesGP` en functions/index.js). Lo que este banco exige no es
// que el agrupador devuelva los números que yo escriba —eso sería compararlo
// contra una copia mía— sino que las DOS FUENTES COINCIDAN AL CENTAVO sobre
// los mismos movimientos:
//
//   · las mismas obras, con las mismas etiquetas
//   · los mismos rubros, con las mismas etiquetas, incluidos los dos «300»
//   · los mismos proveedores, con las mismas cifras
//   · las mismas series por año, por mes y por semana
//   · las mismas listas publicadas (semanas y meses disponibles)
//
// Y además exige lo que sólo la fuente nueva puede garantizar: que el dinero
// que no se pudo clasificar SE PUBLIQUE en vez de desaparecer.
//
// LOS DOS INSUMOS SE CARGAN DE ARCHIVO (P7: un banco carga su insumo, no lo
// hereda del entorno ni lo lleva en una cadena dentro del propio código, que
// volvería a ser una copia):
//
//   · `scripts/hoja-gp-de-prueba.csv`      — el pivote, como lo exporta el Sheet
//   · `scripts/renglones-gp-de-prueba.json` — los mismos movimientos en crudo,
//     con los campos y formatos medidos sobre los 46,367 renglones del volcado
//     del 2026-10-30
//
// POR QUÉ ESTE BANCO EXISTE. Medido el 2026-11-02 contra la hoja real, agrupar
// los renglones por `DesProy` → `AgrConce` → `Nombre_Beneficiario` y sumar
// `ImporteDisSIva` reproduce la hoja al centavo: la 0127 completa —4 rubros, 66
// proveedores, 20 semanas, 5 meses— y la 0126 con 4 rubros y 116 de 117
// proveedores. El único que difería, NR FINANCE MEXICO por $28,357.66, son
// cinco renglones con fecha 15-oct que la API ya tenía y la hoja nunca vio: la
// API no sobraba, la hoja faltaba.
//
// Es decir: la hoja ES este pivote. Y por eso la única manera de equivocarse
// aquí es equivocarse en la CLAVE con la que se agrupa, que es justo el error
// que no deja hueco. Dos ejemplos medidos sobre el volcado real:
//
//   A. `ENumProy` parece la clave de la obra —es texto de cuatro dígitos con
//      ceros a la izquierda— y no lo es. `ENumProy` 0001 aparece en 21 obras
//      distintas, y 29 de los 67 valores los comparten varias obras. Agrupar
//      por ahí mete el gasto de una obra en otra sin dar error.
//   B. El código de 3 dígitos del rubro se repite: «300 INDIRECTOS» (19,374
//      renglones) y «300 SUBCONTRATOS» (929) conviven. Es el mismo defecto que
//      ya costó $1,308,275.55 mal rotulados en la 0112 por el lado de la hoja.
//
// Uso:  node scripts/prueba-agrupador-gp.cjs
//
// CONTRAPRUEBA, comprobada, devolviendo cada defecto uno por uno sobre
// `functions/index.js` y corriendo este mismo banco:
//
//   · agrupar la obra por `fila.ENumProy`            →  8 en rojo, salida 1
//   · clave del rubro `etiquetaRubro.slice(0, 3)`    →  8 en rojo, salida 1
//   · quitar la poda del proveedor en cero           →  3 en rojo, salida 1
//   · no acumular `descartes.montoSinObra`           →  3 en rojo, salida 1
//   · asignar la semana con `=` en vez de `+=`       → 10 en rojo, salida 1
//
// Sobre el archivo bueno: 87 en verde, 0 en rojo, salida 0.
//
// Un dato que justifica la forma del banco: con el defecto del rubro puesto, el
// acumulado de la obra SIGUE EN VERDE —el dinero no se va a ningún lado, sólo
// cambia de etiqueta— y lo que se mueve son los renglones de cada rubro. Un
// banco que sólo mirara el gran total habría firmado eso como bueno.

'use strict';

const fs = require('fs');
const path = require('path');
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion, vigilarExcepciones } = noArranco;

const RAIZ = path.resolve(__dirname, '..');
const HOJA = path.join(__dirname, 'hoja-gp-de-prueba.csv');
const RENGLONES = path.join(__dirname, 'renglones-gp-de-prueba.json');

vigilarExcepciones('functions/index.js');

const { deFunciones, SimboloPerdido } = require('./extraer-de-app.cjs');

let parsearGPConstruct, agruparRenglonesGP, mesDeRenglonGP, semanaDeRenglonGP;
try {
  ({ parsearGPConstruct, agruparRenglonesGP, mesDeRenglonGP, semanaDeRenglonGP } =
    deFunciones('parsearGPConstruct', 'agruparRenglonesGP', 'mesDeRenglonGP', 'semanaDeRenglonGP'));
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}

for (const [etiqueta, archivo] of [['la hoja de prueba', HOJA], ['los renglones de prueba', RENGLONES]]) {
  if (!fs.existsSync(archivo)) {
    sinPrecondicion(
      etiqueta + ' ' + path.relative(RAIZ, archivo),
      ['Es un archivo del repositorio, no un volcado: debería estar versionado.',
       'Recuperarlo con `git checkout -- ' + path.relative(RAIZ, archivo) + '`.']);
  }
}

const csv = fs.readFileSync(HOJA, 'utf8');
let filas;
try {
  filas = JSON.parse(fs.readFileSync(RENGLONES, 'utf8'));
} catch (e) {
  sinPrecondicion('los renglones de prueba ' + path.relative(RAIZ, RENGLONES),
    ['No es JSON legible: ' + e.message]);
}
if (!Array.isArray(filas) || filas.length === 0) {
  sinPrecondicion('los renglones de prueba ' + path.relative(RAIZ, RENGLONES),
    ['El archivo existe pero no trae una lista de renglones.']);
}

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
    cerca(real, esperado) ? null : [`hoja ${pesos(esperado)} · consulta ${pesos(real)} · ` +
      `difiere en ${pesos((real || 0) - (esperado || 0))}`]);
const seccion = (t) => console.log('\n' + t);

// Dos series se comparan por sus CLAVES y por sus valores. Comparar sólo los
// valores de las claves de una de las dos dejaría pasar que la otra publique
// una semana de más, que es una semana que la pantalla pintaría sin respaldo.
const compararSeries = (nombre, deLaConsulta, deLaHoja) => {
  const a = deLaConsulta || {}, b = deLaHoja || {};
  const claves = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const malas = claves.filter(k => !cerca(a[k], b[k]));
  exigir(malas.length === 0, nombre,
    malas.map(k => `${k}: hoja ${pesos(b[k])} · consulta ${pesos(a[k])}`));
};

// ── las dos fuentes, cada una por su lado ──
const hoja = parsearGPConstruct(csv);
const api = agruparRenglonesGP(filas);

// Precondiciones del insumo. Si el archivo de renglones pierde la propiedad que
// hace falta para que una aserción signifique algo, el banco NO ARRANCA: pasar
// en verde porque el insumo se quedó sin la trampa es peor que fallar.
{
  const conObra = filas.filter(f => /^\d{4}\s/.test(String(f.DesProy || '')));
  const porEnum = {};
  for (const f of conObra) {
    const id = String(f.DesProy).slice(0, 4);
    (porEnum[String(f.ENumProy)] = porEnum[String(f.ENumProy)] || new Set()).add(id);
  }
  const compartido = Object.entries(porEnum).some(([, s]) => s.size > 1);
  if (!compartido) {
    sinPrecondicion('un `ENumProy` compartido por dos obras en ' + path.relative(RAIZ, RENGLONES),
      ['Sin él, agrupar por `ENumProy` daría el mismo resultado que agrupar bien',
       'y la sección 7 de este banco no afirmaría nada.',
       'Medido en producción: `ENumProy` 0001 aparece en 21 obras distintas.']);
  }
  const codigos = {};
  for (const f of conObra) {
    const etiqueta = String(f.AgrConce || '');
    (codigos[etiqueta.slice(0, 3)] = codigos[etiqueta.slice(0, 3)] || new Set()).add(etiqueta);
  }
  if (!Object.values(codigos).some(s => s.size > 1)) {
    sinPrecondicion('dos rubros con el mismo código de 3 dígitos en ' + path.relative(RAIZ, RENGLONES),
      ['Sin ellos, indexar el rubro por `slice(0,3)` daría lo mismo que indexar',
       'por la etiqueta completa y la sección 3 no afirmaría nada.',
       'Medido en producción: «300 INDIRECTOS» y «300 SUBCONTRATOS» conviven.']);
  }
  const sinObra = filas.filter(f => !/^\d{4}\s/.test(String(f.DesProy || '')));
  if (sinObra.length === 0 || !sinObra.some(f => Math.abs(Number(f.ImporteDisSIva) || 0) > 0)) {
    sinPrecondicion('un renglón con dinero y sin obra reconocible en ' + path.relative(RAIZ, RENGLONES),
      ['Sin él, la sección 6 no puede exigir que ese dinero se publique.',
       'Medido en producción: 16 renglones así, $69,981.48.']);
  }
  if (Object.keys(hoja.obras).length === 0) {
    sinPrecondicion('obras en ' + path.relative(RAIZ, HOJA),
      ['El parser de la hoja no detectó ninguna obra; sin ancla no hay con qué comparar.']);
  }
}

// ════════════════════════════════════════════════════════════════════════════
seccion('1. LAS DOS FUENTES NOMBRAN LAS MISMAS OBRAS');
// ════════════════════════════════════════════════════════════════════════════
const clavesHoja = Object.keys(hoja.obras).sort();
const clavesApi = Object.keys(api.obras).sort();
exigir(clavesApi.join('|') === clavesHoja.join('|'),
  `${clavesHoja.length} obras, con la misma etiqueta exacta`,
  [`hoja:     ${clavesHoja.join(' · ') || '(ninguna)'}`,
   `consulta: ${clavesApi.join(' · ') || '(ninguna)'}`]);
exigir(api.totalObras === hoja.totalObras,
  `totalObras coincide (${hoja.totalObras})`,
  [`hoja ${hoja.totalObras} · consulta ${api.totalObras}`]);
{
  const discrepan = clavesApi.filter(k => !hoja.obras[k] || api.obras[k].id !== hoja.obras[k].id);
  exigir(discrepan.length === 0, 'el id de cuatro dígitos de cada obra es el mismo',
    discrepan.map(k => `${k}: hoja ${hoja.obras[k] ? hoja.obras[k].id : '(no está)'} · ` +
      `consulta ${api.obras[k].id}`));
}

// ════════════════════════════════════════════════════════════════════════════
seccion('2. EL DINERO DE CADA OBRA, AL CENTAVO');
// ════════════════════════════════════════════════════════════════════════════
for (const k of clavesHoja) {
  const a = api.obras[k], b = hoja.obras[k];
  if (!a) { mal(`${k}: la consulta no trae esta obra`); continue; }
  exigirCifra(a.grandTotal, b.grandTotal, `${k} · acumulado`);
  exigirCifra(a.total2026, b.total2026, `${k} · total del año vivo`);
  compararSeries(`${k} · años`, a.años, b.años);
  compararSeries(`${k} · meses`, a.meses, b.meses);
  compararSeries(`${k} · semanas`, a.semanas, b.semanas);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('3. LOS RUBROS: MISMAS ETIQUETAS, INCLUIDOS LOS DOS QUE COMPARTEN CÓDIGO');
// ════════════════════════════════════════════════════════════════════════════
for (const k of clavesHoja) {
  const a = api.obras[k], b = hoja.obras[k];
  if (!a) continue;
  const rA = Object.keys(a.rubros || {}).sort(), rB = Object.keys(b.rubros || {}).sort();
  exigir(rA.join('|') === rB.join('|'), `${k} · ${rB.length} rubros con la misma etiqueta`,
    [`hoja:     ${rB.join(' · ')}`, `consulta: ${rA.join(' · ')}`]);
  for (const nombre of rB) {
    const x = a.rubros[nombre], y = b.rubros[nombre];
    if (!x) { mal(`${k} · ${nombre}: la consulta no trae este rubro`); continue; }
    exigirCifra(x.grandTotal, y.grandTotal, `${k} · ${nombre} · acumulado`);
    compararSeries(`${k} · ${nombre} · semanas`, x.semanas, y.semanas);
  }
  // Y que la obra sea la suma de sus rubros en la fuente nueva, no sólo que
  // coincida con la hoja: una tabla que no suma su propio KPI es el defecto
  // con el que empezó todo esto.
  const suma = Object.values(a.rubros || {}).reduce((t, r) => t + r.grandTotal, 0);
  exigirCifra(suma, a.grandTotal, `${k} · la obra es la suma de sus rubros`);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('4. LOS PROVEEDORES: MISMOS NOMBRES Y MISMAS CIFRAS');
// ════════════════════════════════════════════════════════════════════════════
for (const k of clavesHoja) {
  const a = api.obras[k], b = hoja.obras[k];
  if (!a) continue;
  // La clave es (rubro, nombre): el mismo proveedor en dos rubros son dos
  // renglones distintos en la hoja, y tienen que serlo también aquí.
  const mapa = (obra) => {
    const m = {};
    for (const [etiqueta, rubro] of Object.entries(obra.rubros || {}))
      for (const p of (rubro.proveedores || [])) m[`${etiqueta} ‖ ${p.nombre}`] = p;
    return m;
  };
  const mA = mapa(a), mB = mapa(b);
  const nA = Object.keys(mA).sort(), nB = Object.keys(mB).sort();
  exigir(nA.join('|') === nB.join('|'), `${k} · ${nB.length} proveedores, los mismos`,
    [`sólo en la hoja:     ${nB.filter(n => !mA[n]).join(' · ') || '(ninguno)'}`,
     `sólo en la consulta: ${nA.filter(n => !mB[n]).join(' · ') || '(ninguno)'}`]);
  for (const nombre of nB) {
    if (!mA[nombre]) continue;
    exigirCifra(mA[nombre].grandTotal, mB[nombre].grandTotal, `${k} · ${nombre} · acumulado`);
    exigirCifra(mA[nombre].total, mB[nombre].total, `${k} · ${nombre} · total`);
    compararSeries(`${k} · ${nombre} · semanas`, mA[nombre].semanas, mB[nombre].semanas);
    compararSeries(`${k} · ${nombre} · meses`, mA[nombre].meses, mB[nombre].meses);
  }
  // Y el rubro es la suma de sus proveedores.
  for (const [etiqueta, rubro] of Object.entries(a.rubros || {})) {
    const suma = (rubro.proveedores || []).reduce((t, p) => t + p.grandTotal, 0);
    exigirCifra(suma, rubro.grandTotal, `${k} · ${etiqueta} · el rubro es la suma de sus proveedores`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
seccion('5. LAS LISTAS PUBLICADAS Y LA SEMANA A CABALLO ENTRE DOS MESES');
// ════════════════════════════════════════════════════════════════════════════
exigir(api.semanasDisponibles.join(',') === hoja.semanasDisponibles.join(','),
  `semanasDisponibles (${hoja.semanasDisponibles.join(' ')})`,
  [`hoja:     ${hoja.semanasDisponibles.join(' ')}`,
   `consulta: ${api.semanasDisponibles.join(' ')}`]);
exigir(api.mesesDisponibles.join(',') === hoja.mesesDisponibles.join(','),
  `mesesDisponibles (${hoja.mesesDisponibles.join(' ')})`,
  [`hoja:     ${hoja.mesesDisponibles.join(' ')}`,
   `consulta: ${api.mesesDisponibles.join(' ')}`]);
exigir(api.ultimaSemana === hoja.ultimaSemana, `ultimaSemana (${hoja.ultimaSemana})`,
  [`hoja ${hoja.ultimaSemana} · consulta ${api.ultimaSemana}`]);
exigir(api.ultimoMes === hoja.ultimoMes, `ultimoMes (${hoja.ultimoMes})`,
  [`hoja ${hoja.ultimoMes} · consulta ${api.ultimoMes}`]);

// La semana partida: la que aparece en más de un mes del año vivo. En la hoja
// ocupa DOS columnas; aquí son renglones con el mismo `Semana` y distinto `Mes`.
// Lo que se exige es que SUME, no que se quede con el último.
{
  const porSemana = {};
  for (const f of filas) {
    if (Number(f.Amo) !== api.añoVivo) continue;
    const s = semanaDeRenglonGP(f.Semana), m = mesDeRenglonGP(f.Mes);
    if (!s || !m) continue;
    (porSemana[s] = porSemana[s] || new Set()).add(m);
  }
  const partidas = Object.entries(porSemana).filter(([, s]) => s.size > 1).map(([s]) => s);
  if (partidas.length === 0) {
    sinPrecondicion('una semana repartida entre dos meses en ' + path.relative(RAIZ, RENGLONES),
      ['Sin ella no se puede exigir que la semana SUME en vez de pisarse,',
       'que es el defecto que costó $15,409,486.89 por el lado de la hoja.']);
  }
  ok(`el insumo trae ${partidas.length} semana(s) repartida(s) entre dos meses: ${partidas.map(s => 'S' + s).join(' ')}`);
  for (const s of partidas) {
    const clave = 'S' + s;
    const esperado = filas
      .filter(f => Number(f.Amo) === api.añoVivo && semanaDeRenglonGP(f.Semana) === s &&
                   /^\d{4}\s/.test(String(f.DesProy || '')))
      .reduce((t, f) => t + Math.abs(Number(f.ImporteDisSIva) || 0), 0);
    const real = Object.values(api.obras).reduce((t, o) => t + (o.semanas[clave] || 0), 0);
    exigirCifra(real, esperado, `${clave} suma sus dos trozos de mes`);
    // Y contra la hoja, que la lleva en dos columnas bajo una sola clave.
    const deLaHoja = Object.values(hoja.obras).reduce((t, o) => t + (o.semanas[clave] || 0), 0);
    exigirCifra(real, deLaHoja, `${clave} vale lo mismo que en la hoja`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
seccion('6. EL DINERO QUE NO SE PUDO CLASIFICAR SE PUBLICA, NO SE CALLA');
// ════════════════════════════════════════════════════════════════════════════
{
  const huerfanos = filas.filter(f => !/^\d{4}\s/.test(String(f.DesProy || '')));
  const montoHuerfano = huerfanos.reduce((t, f) => t + Math.abs(Number(f.ImporteDisSIva) || 0), 0);
  exigir(api.descartes.sinObra === huerfanos.length,
    `${huerfanos.length} renglón(es) sin obra reconocible, contado(s)`,
    [`en el insumo ${huerfanos.length} · publicado ${api.descartes.sinObra}`]);
  exigirCifra(api.descartes.montoSinObra, montoHuerfano,
    'su dinero se publica en `descartes.montoSinObra`');
  // La cuenta que cierra: lo clasificado más lo descartado es TODO el insumo.
  // Sin ella, un descarte silencioso sería indistinguible de un renglón que
  // nunca existió.
  const todo = filas.reduce((t, f) => t + Math.abs(Number(f.ImporteDisSIva) || 0), 0);
  const clasificado = Object.values(api.obras).reduce((t, o) => t + o.grandTotal, 0);
  exigirCifra(clasificado + api.descartes.montoSinObra, todo,
    'lo clasificado más lo descartado es todo el insumo');
  exigir(api.descartes.renglones === filas.length,
    `se leyeron los ${filas.length} renglones del insumo`,
    [`insumo ${filas.length} · publicado ${api.descartes.renglones}`]);
}
{
  // El proveedor que sólo movió ceros: la hoja no lo lista y la consulta
  // tampoco debe listarlo, pero sí debe decir que lo podó.
  const enCero = new Set();
  const porProv = {};
  for (const f of filas) {
    if (!/^\d{4}\s/.test(String(f.DesProy || ''))) continue;
    const k = String(f.Nombre_Beneficiario || '');
    porProv[k] = (porProv[k] || 0) + Math.abs(Number(f.ImporteDisSIva) || 0);
  }
  for (const [k, v] of Object.entries(porProv)) if (v === 0) enCero.add(k);
  if (enCero.size === 0) {
    sinPrecondicion('un proveedor que sólo movió ceros en ' + path.relative(RAIZ, RENGLONES),
      ['Sin él no se puede exigir la poda, y la hoja de prueba sí trae uno',
       '(PROVEEDOR SIN MOVIMIENTO, renglón de celdas vacías).']);
  }
  const nombresApi = new Set(Object.values(api.obras).flatMap(o => (o.proveedores || []).map(p => p.nombre)));
  const nombresHoja = new Set(Object.values(hoja.obras).flatMap(o => (o.proveedores || []).map(p => p.nombre)));
  for (const n of enCero) {
    exigir(!nombresApi.has(n), `«${n}» no se publica (no movió dinero)`);
    exigir(!nombresHoja.has(n), `«${n}» tampoco está en la hoja`);
  }
  exigir(api.descartes.proveedoresEnCero >= enCero.size,
    `la poda se publica: ${api.descartes.proveedoresEnCero} proveedor(es) en cero`,
    [`en el insumo ${enCero.size} · publicado ${api.descartes.proveedoresEnCero}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('7. LA OBRA SE AGRUPA POR `DesProy`, NUNCA POR `ENumProy`');
// ════════════════════════════════════════════════════════════════════════════
// No se afirma «el código usa DesProy» —eso sería mirar el símbolo— sino lo que
// se VE si se usa la clave equivocada: las obras se mezclan y sus ids dejan de
// ser los de la hoja.
{
  const idsApi = Object.values(api.obras).map(o => o.id).sort();
  const idsHoja = Object.values(hoja.obras).map(o => o.id).sort();
  exigir(idsApi.join('|') === idsHoja.join('|'),
    `los ids son los de la hoja (${idsHoja.join(' ')})`,
    [`hoja:     ${idsHoja.join(' ')}`, `consulta: ${idsApi.join(' ')}`]);
  const enums = new Set(filas.map(f => String(f.ENumProy)));
  const colados = idsApi.filter(id => enums.has(id) && !idsHoja.includes(id));
  exigir(colados.length === 0, 'ningún `ENumProy` se coló como id de obra',
    colados.map(id => `la obra ${id} no existe en la hoja; es un ENumProy`));
  // Y el dinero de cada obra por separado, no revuelto: si se agrupara por el
  // ENumProy compartido, una sola obra se llevaría el total de las dos.
  const total = Object.values(api.obras).reduce((t, o) => t + o.grandTotal, 0);
  const maxObra = Math.max(...Object.values(api.obras).map(o => o.grandTotal));
  exigir(Object.keys(api.obras).length === idsHoja.length && maxObra < total,
    'ninguna obra se lleva el dinero de las demás',
    [`${Object.keys(api.obras).length} obras · la mayor ${pesos(maxObra)} de ${pesos(total)}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('8. EL MES Y LA SEMANA SE LEEN DEL FORMATO QUE MANDA EL SERVIDOR');
// ════════════════════════════════════════════════════════════════════════════
// Los doce formatos de `Mes` medidos en producción son «N .- Nombre». Se lee el
// número de adelante: el nombre trae acentos y no ordena.
for (const [entrada, esperado] of [
  ['1 .- Enero', '01'], ['9 .- Septiembre', '09'], ['10 .- Octubre', '10'],
  ['12 .- Diciembre', '12'],
  ['', null], [null, null], ['0 .- Nada', null], ['13 .- Nada', null], ['Octubre', null],
]) {
  const real = mesDeRenglonGP(entrada);
  exigir(real === esperado, `mes de ${JSON.stringify(entrada)} → ${JSON.stringify(esperado)}`,
    [`salió ${JSON.stringify(real)}`]);
}
// `Semana` va de 1 a 53 en los 46,367 renglones medidos, siempre numérica.
for (const [entrada, esperado] of [
  [1, '1'], [42, '42'], [53, '53'], ['42', '42'],
  [0, null], [54, null], ['', null], [null, null], ['cuarenta', null], [42.5, null],
]) {
  const real = semanaDeRenglonGP(entrada);
  exigir(real === esperado, `semana de ${JSON.stringify(entrada)} → ${JSON.stringify(esperado)}`,
    [`salió ${JSON.stringify(real)}`]);
}

// ── cierre ─────────────────────────────────────────────────────────────────
console.log('');
if (fallas > 0) {
  console.log(`ROJO: ${fallas} aserción(es) en rojo.`);
  console.log('La consulta por obra y la hoja no dicen lo mismo sobre los mismos');
  console.log('movimientos. Mientras eso siga así, el gasto que se pinta en pantalla');
  console.log('depende de cuál de las dos escribió el documento al final.');
  process.exit(1);
}
console.log('VERDE: la consulta por obra reproduce la hoja al centavo, y publica');
console.log('lo que no pudo clasificar.');
process.exit(0);
