#!/usr/bin/env node
// Guion DESECHABLE para poder MIRAR en el preview la mitad de #116: una semana
// de nómina que existe pero no trae el conteo de personal.
//
// Por qué hace falta sólo para esa mitad. #113 ya se ve con la siembra tal
// cual: la ventana de la gráfica arranca en 12 semanas y la 0121 tiene 3
// cierres de avance, así que las nueve primeras semanas de su tabla son
// semanas sin captura previa — exactamente el caso. La nómina no: la siembra
// escribe `totalDir: 26, totalInd: 8` en TODAS las obras, y lo hace a
// propósito (ver su comentario: sembrarla sin esos campos era el defecto que
// el preview enseñaba de más). Sin este fixture no hay forma de mirar qué
// publica la pantalla cuando el archivo de nómina no trae el conteo.
//
// Lo que hace: a la 0121 del EMULADOR le quita de su única semana de nómina
//   · `totalDir` y `totalInd`  → sin desglose
//   · `trabajadores`           → sin listado del que contar
// y le DEJA `totalNomina`: la semana existe y costó dinero; lo que falta es
// cuánta gente hubo. Si se le quita el total también, la pantalla se calla por
// otra razón —la semana entera sin datos— y no se ve la que se vino a mirar.
//
// No se queda. `node scripts/sembrar-preview-emulador.cjs` lo devuelve a la
// demo de siempre, y así es como se deja al terminar.
//
// Uso:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node scripts/mirar-la-ausencia-en-pantalla.cjs --escribir

const path = require('path');
const { resolverDestino } = require(path.join(__dirname, 'destino.cjs'));

const d = resolverDestino({
  escribe: 'deja la semana de nómina de la 0121 del emulador sin conteo de personal',
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

const RUTA = 'obras/0121/nomina/historial';
const QUITAR = ['totalDir', 'totalInd', 'trabajadores'];

(async () => {
  if (!d.escribir) {
    console.log('Ensayo. Lo que haría:');
    console.log(`  · ${RUTA}: quitarle ${QUITAR.join(', ')} a sus semanas`);
    console.log('  · dejarle `totalNomina`, `totalHEImp` y `totalDias` intactos');
    process.exit(0);
  }

  // Se edita el documento TAL CUAL viene de Firestore, sin decodificarlo: lo
  // que se quiere es el mismo snapshot que sembró el guion de siembra con un
  // campo de menos, no una copia mía de su esquema. Un fixture con el esquema
  // casi-bien hace que la pantalla mienta y que la mentira parezca un defecto
  // del producto.
  const doc = await leer(RUTA);
  const semanas = doc.fields.semanas.arrayValue.values || [];
  const quitados = [];
  for (const s of semanas) {
    for (const campo of QUITAR) {
      if (campo in s.mapValue.fields) { delete s.mapValue.fields[campo]; quitados.push(campo); }
    }
  }
  await ponerCrudo(RUTA, doc.fields);

  const num = (v) => parseFloat(v?.doubleValue ?? v?.integerValue ?? 0);
  const total = num(semanas[0]?.mapValue.fields.totalNomina);
  console.log(`0121 · nómina: ${semanas.length} semana(s), sin ${[...new Set(quitados)].join(' ni ')}`);
  console.log(`         le queda su total de $${total.toLocaleString('es-MX')}: ` +
    'la semana existe y costó dinero, lo que falta es cuánta gente hubo');
  console.log('\nDónde mirarlo:');
  console.log('  1. obra 0121 → tablero → KPI «Personal» → debe decir «sin desglose», en gris');
  console.log('  2. obra 0121 → pestaña Nómina → los KPIs de personal, en «sin conteo»');
  console.log('  3. Tablero principal → KPI «Personal» → el total NO cuenta a la 0121,');
  console.log('     el renglón del delta dice «incompleto: 1 obra sin conteo de personal»');
  console.log('     y el tooltip la nombra');
  console.log('  4. Tablero principal → tabla de obras → renglón 0121 → «Nómina sin conteo de personal»');
  console.log('\nY la otra mitad (#113), que la siembra ya produce sola:');
  console.log('  5. obra 0121 → gráfica → tabla de semanas → columna Avance de las primeras');
  console.log('     nueve semanas de la ventana de 12 → «sin medir», no «0.0%»');
  console.log('\nPara devolver la demo a su sitio: node scripts/sembrar-preview-emulador.cjs');
})().catch((e) => { console.error(e); process.exit(2); });
