#!/usr/bin/env node
// Guion DESECHABLE para poder MIRAR en el preview el caso del #135: el tramo
// de margen que no alcanza para hablar de tendencia.
//
// Por qué hace falta. La siembra del preview no puede producir ese caso, y no
// por descuido: sus tres obras de constructora traen el gasto de GP repartido
// en semanas que suman MUCHO menos que el `grandTotal` de la obra ($4.97 M
// contra $19.9 M en la 0121), así que `serieGastoDeSemanas` marca
// `sinFechar` y el margen semanal se apaga entero —`cola = 0`, que es otra
// rama del documento, la que dice que no hay serie—. Y las obras que sí tienen
// el gasto repartido llevan tres o más cierres de avance seguidos, con lo que
// la cola alcanza y el tramo SÍ se afirma. Ninguna de las dos es la rama nueva.
//
// Lo que hace: deja la 0121 del EMULADOR con las dos condiciones a la vez.
//
//   · el gasto de GP cuadra al peso con su reparto semanal  → `sinFechar` false
//   · sólo los dos últimos cierres de avance                → cola 3, < 4
//
// No se queda. Es un estado de laboratorio para un recorrido por pantalla:
// `node scripts/sembrar-preview-emulador.cjs` lo devuelve a la demo de siempre
// y así es como se deja al terminar.
//
// Uso:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node scripts/mirar-el-tramo-corto-en-pantalla.cjs --escribir

const path = require('path');
const { resolverDestino } = require(path.join(__dirname, 'destino.cjs'));

const d = resolverDestino({
  escribe: 'deja la obra 0121 del emulador con un tramo de margen corto y el gasto fechado',
});
if (d.prod) {
  console.error('Esto es un fixture de laboratorio. No tiene nada que hacer en producción.');
  process.exit(2);
}

const HOST = '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PROYECTO = 'campo-fosmon';
const fsURL = (ruta) =>
  `http://${HOST}:${PUERTO}/v1/projects/${PROYECTO}/databases/(default)/documents/${ruta}`;

const aValor = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(
    Object.entries(v).map(([k, x]) => [k, aValor(x)])) } };
  return { stringValue: String(v) };
};

const leer = async (ruta) => {
  const r = await fetch(fsURL(ruta), { headers: { Authorization: 'Bearer owner' } });
  if (!r.ok) throw new Error(`GET ${ruta}: ${r.status} ${await r.text()}`);
  return r.json();
};
const ponerCrudo = async (ruta, fields) => {
  const r = await fetch(fsURL(ruta), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error(`PATCH ${ruta}: ${r.status} ${await r.text()}`);
};

// El gasto, repartido en semanas que SUMAN el total. Los huecos de S39, S41 y
// S42 se respetan: son de la siembra a propósito —un ritmo medible con ceros
// dentro— y quitarlos cambiaría otra cosa de la demo.
//
// El total baja a $6 M de los $19.9 M sembrados por una razón de lectura, no
// de conveniencia: con el gasto entero y sólo los dos últimos cierres de
// avance ($7.2 M y $10.8 M ejecutados) el margen sale NEGATIVO las tres
// semanas, y una tabla de márgenes negativos no deja ver si el titular se
// publicó o no. Es un fixture, y se dice en voz alta que lo es.
const SEMANAS = { S38: 1400000, S40: 1700000, S43: 1300000, S44: 800000, S45: 800000 };
const TOTAL = Object.values(SEMANAS).reduce((t, v) => t + v, 0);

(async () => {
  if (!d.escribir) {
    console.log('Ensayo. Lo que haría:');
    console.log(`  · gasto de GP de la 0121: grandTotal $${TOTAL.toLocaleString('es-MX')} ` +
      `= ${Object.entries(SEMANAS).map(([k, v]) => `${k} $${v.toLocaleString('es-MX')}`).join(' + ')}`);
    console.log('  · historial de avance de la 0121: sólo los DOS últimos cierres');
    console.log('  · gasto de GP de la 0114: el grandTotal baja al que suman sus semanas, ' +
      'para tener en la misma corrida el tramo que SÍ alcanza');
    process.exit(0);
  }

  // ── 1 · El gasto cuadra con su reparto ─────────────────────────────────────
  // Se reescribe el renglón entero de la obra dentro de `global/gp_construct`,
  // que es el documento del que la app saca `gpData`. El detalle por obra se
  // reescribe también: la pestaña de Gastos lo prefiere, y dejarlos discrepando
  // haría que el recorrido por el preview enseñara una inconsistencia inventada
  // aquí en lugar de la rama que se vino a mirar.
  const obraGP = {
    id: '0121', nombre: 'SIOP Coatza Rehab. Av. Universidad',
    grandTotal: TOTAL, semanas: SEMANAS,
    rubros: { '100 MATERIALES': {
      id: '100', nombre: '100 MATERIALES', nombreCorto: 'Materiales',
      grandTotal: TOTAL, semanas: SEMANAS,
      proveedores: [{ nombre: 'Triturados del Golfo', rubroId: '100',
        rubroNombre: 'Materiales', total: TOTAL, grandTotal: TOTAL, semanas: SEMANAS }],
    } },
    proveedores: [{ nombre: 'Triturados del Golfo', rubroId: '100',
      rubroNombre: 'Materiales', total: TOTAL, grandTotal: TOTAL, semanas: SEMANAS }],
  };

  const construct = await leer('global/gp_construct');
  construct.fields.obras.mapValue.fields['0121'] = aValor(obraGP);
  await ponerCrudo('global/gp_construct', construct.fields);

  const detalle = await leer('global/gp_detalle/obras/0121');
  await ponerCrudo('global/gp_detalle/obras/0121', {
    parserVersion: detalle.fields.parserVersion,
    ultimaActualizacion: detalle.fields.ultimaActualizacion,
    fuente: detalle.fields.fuente,
    ...aValor(obraGP).mapValue.fields,
  });

  // ── 2 · Sólo los dos últimos cierres de avance ─────────────────────────────
  // Se recorta la lista TAL CUAL viene de Firestore, sin decodificarla: lo que
  // se quiere es el mismo snapshot que sembró el guion de siembra, no una copia
  // mía de su esquema. Un fixture con el esquema casi-bien hace que la pantalla
  // mienta y que la mentira parezca un defecto del producto.
  const hist = await leer('obras/0121/avance/historial');
  const todos = hist.fields.semanas.arrayValue.values;
  const quedan = todos.slice(-2);
  hist.fields.semanas.arrayValue.values = quedan;
  await ponerCrudo('obras/0121/avance/historial', hist.fields);

  // ── 3 · Y LA OTRA MITAD, PARA PODER COMPARAR EN PANTALLA ──────────────────
  // La 0114 lleva seis cierres de avance seguidos: con su gasto fechado, la
  // cola alcanza y el titular del tramo SÍ se publica. Hace falta mirar las dos
  // en la misma corrida; si sólo se mira la que calla, no se puede distinguir
  // «el titular se suprimió porque no alcanza» de «el titular ya no existe».
  // Aquí el total BAJA al que suman sus semanas ($8.0 M de $21.4 M): el reparto
  // es el dato medido y el total es el que no cuadra con él. Subir el reparto
  // para que llegue a los $21.4 M sería teclear dinero por semana que nadie
  // midió, y eso no se hace ni en un fixture.
  const c114 = await leer('global/gp_construct');
  const f114 = c114.fields.obras.mapValue.fields['0114'].mapValue.fields;
  const num = (v) => parseFloat(v.doubleValue ?? v.integerValue ?? 0);
  const sem114 = Object.fromEntries(Object.entries(f114.semanas.mapValue.fields)
    .map(([k, v]) => [k, num(v)]));
  const tot114 = Object.values(sem114).reduce((t, v) => t + v, 0);
  f114.grandTotal = aValor(tot114);
  await ponerCrudo('global/gp_construct', c114.fields);
  const det114 = await leer('global/gp_detalle/obras/0114');
  det114.fields.grandTotal = aValor(tot114);
  await ponerCrudo('global/gp_detalle/obras/0114', det114.fields);
  console.log(`0114 · gasto GP: grandTotal baja a $${tot114.toLocaleString('es-MX')}, ` +
    'que es lo que suman sus semanas — con seis cierres de avance, su tramo SÍ alcanza');

  const idDe = (v) => v.mapValue.fields.id.stringValue;
  console.log(`0121 · gasto GP: $${TOTAL.toLocaleString('es-MX')} en ` +
    `${Object.keys(SEMANAS).join(', ')} — el reparto suma el total, así que ya no llega sin fecha`);
  console.log(`0121 · avance: de ${todos.length} cierres quedan ${quedan.length} ` +
    `(${quedan.map(idDe).join(', ')}) — el margen semanal arranca en el primero de ellos`);
  console.log('\nAhora: http://localhost:5185/  (demo@fosmon.com.mx / demo1234) → obra 0121 → Documento interno');
  console.log('Para devolver la demo a su sitio: node scripts/sembrar-preview-emulador.cjs');
})().catch((e) => { console.error(e); process.exit(2); });
