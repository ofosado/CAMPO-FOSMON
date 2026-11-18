#!/usr/bin/env node
// Guion DESECHABLE para poder MIRAR en el preview la frase nueva del #28: qué
// le dice la pantalla a una obra cuyo historial se recortó POR TAMAÑO y no por
// haber cumplido el año.
//
// Por qué hace falta. La siembra del preview no escribe ningún `recorte`, así
// que las tres pantallas que muestran el hueco de arranque caen siempre en la
// rama «no hay cierres anteriores» —la que no afirma causa— y la frase que se
// vino a mirar no sale nunca. El hueco en sí ya está: la 0114 del emulador
// arranca el 2026-03-01 (S09) y su primer cierre es el S40-2026.
//
// Lo que hace: a `obras/0114/avance/historial` del EMULADOR le añade el sello
// `recorte` con `motivo: "tamaño"`, que es lo que escribe el guardado cuando el
// documento se llenó ANTES de completar el año. No toca las semanas.
//
// Se corre dos veces, una por rama, para poder comparar lo que sale en pantalla:
//   --tamano   el documento se llenó antes del año   (la frase nueva)
//   --anio     el historial llegó al tope de 52      (la frase de siempre)
//
// No se queda. `node scripts/sembrar-preview-emulador.cjs` devuelve el
// emulador a la demo de siempre, y así se deja al terminar.
//
// Uso:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     node scripts/mirar-el-recorte-por-tamano-en-pantalla.cjs --tamano --escribir

'use strict';

const path = require('path');
const { resolverDestino } = require(path.join(__dirname, 'destino.cjs'));

const d = resolverDestino({
  escribe: 'pone un sello de recorte en el historial de la 0114 del emulador',
});
if (d.prod) {
  console.error('Esto es un fixture de laboratorio. No tiene nada que hacer en producción.');
  process.exit(2);
}

const MOTIVO = process.argv.includes('--anio') ? 'año' : 'tamaño';

const HOST = '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PROYECTO = 'campo-fosmon';
const fsURL = (ruta) =>
  `http://${HOST}:${PUERTO}/v1/projects/${PROYECTO}/databases/(default)/documents/${ruta}`;

const RUTA = 'obras/0114/avance/historial';

(async () => {
  const sello = {
    mapValue: { fields: {
      perdidas: { integerValue: '23' },
      motivo: { stringValue: MOTIVO },
      ultimaPerdida: { stringValue: 'S39-2026' },
      primeraConservada: { stringValue: 'S40-2026' },
      en: { stringValue: '2026-11-17T12:00:00.000Z' },
    } },
  };
  const r = await fetch(`${fsURL(RUTA)}?updateMask.fieldPaths=recorte`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { recorte: sello } }),
  });
  if (!r.ok) {
    console.error(`PATCH ${RUTA}: ${r.status} ${await r.text()}`);
    process.exit(2);
  }
  console.log(`\nlisto · 0114 recortada con motivo «${MOTIVO}», 23 semanas perdidas.`);
  console.log(`la obra arranca el 2026-03-01 (S09) y su primer cierre es el S40-2026.\n`);
})().catch(e => { console.error(e.message); process.exit(2); });
