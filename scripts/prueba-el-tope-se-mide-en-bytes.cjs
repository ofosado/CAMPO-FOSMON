#!/usr/bin/env node
// El tope que protege el documento se cuenta en la unidad del documento.
//
// POR QUÉ ESTA PRUEBA. El historial de avance vive en UN documento de Firestore
// y Firestore corta en 1 MiB. El recorte que existía para eso contaba PIEZAS:
// las últimas 52 semanas. Pero una semana no pesa lo mismo en todas las obras,
// porque lo que pesa es el catálogo de ESA obra. Medido en producción el
// 2026-11-17:
//
//     0128   46 partidas ·  3.4 KB/semana · caben 299 semanas en 1 MiB
//     0126   51 partidas · 11.6 KB/semana · caben  88
//     0114  335 partidas · 18.6 KB/semana · caben  55
//     0125  461 partidas · 29.9 KB/semana · caben  34   ← revienta ANTES del 52
//
// En la 0125 el tope de 52 no llega nunca. El documento se llena en la semana
// ~34 y entonces lo que pasa NO es que se borre el cierre viejo: es que el
// cierre NUEVO no se puede escribir. Esa es la avería que dejó a la 0114 siete
// semanas sin histórico mientras la pantalla decía «Guardado».
//
// LO QUE SE AFIRMA AQUÍ ES CONDUCTA, no que exista ningún nombre. Se simulan
// sesenta cierres consecutivos sobre un catálogo del tamaño del de la 0125 y se
// exige que NINGUNA de las sesenta escrituras pase de 1 MiB. Con el recorte de
// 52 piezas eso falla alrededor del cierre 35; con el recorte en bytes no falla
// ninguna. El tamaño no se estima: se mide con la misma `tamañoFirestore` que
// usa la app, extraída del archivo.
//
// Y SE EXIGE LA RESERVA, que es la parte que una comprobación ingenua no ve.
// Caber hoy no sirve de nada si la semana que viene no cabe: cuando el cierre
// 35 no entra, el residente ya cerró. Así que lo que se mide es que el
// documento escrito MÁS un cierre más siga cabiendo.
//
// Uso:  node scripts/prueba-el-tope-se-mide-en-bytes.cjs [App.jsx]
//
// Contraprueba contra la versión anterior, donde tiene que ponerse ROJA:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-el-tope-se-mide-en-bytes.cjs /tmp/antes.jsx

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const CP = require('./contraprueba.cjs');
const { fuenteDe, cierreDe } = require('./extraer-de-app.cjs');

// `ARCHIVO_APP` es por donde el corredor de contrapruebas mete el mutante; el
// argumento es para comparar a mano contra una versión vieja.
const argRuta = process.argv.slice(2).find(a => !a.startsWith('--'));
const ARCH_APP = process.env.ARCHIVO_APP
  ? path.resolve(process.env.ARCHIVO_APP)
  : (argRuta ? path.resolve(argRuta) : path.join(raiz, 'src/App.jsx'));
const srcApp = fs.readFileSync(ARCH_APP, 'utf8');

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

// Tolerante a propósito: si la versión que se mide NO tiene la cuenta del
// recorte en bytes, eso es un ROJO —el documento sigue protegido por un tope
// que no mide lo que protege— y no un «no arrancó». La contraprueba rompe
// semántica, no andamiaje.
const PEDIDOS = [
  'recortarHistorialAvance', 'tamañoFirestore', 'LIMITE_DOC_FIRESTORE',
  'SEMANAS_DE_EXPEDIENTE', 'RECORTE_POR_AÑO', 'RECORTE_POR_TAMAÑO',
  'snapshotId', 'ESQUEMA_SNAPSHOT',
];
const { cuerpo, presentes, faltan } = fuenteDe(ARCH_APP, PEDIDOS, { tolerante: true });
const app = new Function(`"use strict";\n${cuerpo}\nreturn { ${presentes.join(', ')} };`)();
const {
  recortarHistorialAvance, tamañoFirestore, LIMITE_DOC_FIRESTORE,
  SEMANAS_DE_EXPEDIENTE, RECORTE_POR_AÑO, RECORTE_POR_TAMAÑO, snapshotId,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${presentes.length} de módulo${faltan.length ? ` · faltan ${faltan.join(', ')}` : ''}\n`);

// El sello del recorte pesa en el documento escrito, así que se le cobra aquí
// igual que en la app. Con sus valores más largos.
const SELLO = { recorte: {
  perdidas: 9999, motivo: 'tamaño', ultimaPerdida: 'S2026-52',
  primeraConservada: 'S2026-52', en: '2026-11-17T00:00:00.000Z',
} };

// Un cierre con la forma REAL del que escribe `crearSnapshotAvance`: `subs` sin
// la descripción, con `sec`/`a`/`imp`/`cant`/`pu`/`cantEjec`. El peso del
// historial es casi todo esto.
const cierre = (semana, año, nPartidas) => ({
  id: snapshotId ? snapshotId(semana, año) : `S${año}-${semana}`,
  semana, año,
  fechaCaptura: '2026-11-17T18:30:00.000Z',
  fechaCierre: '2026-11-17T18:30:00.000Z',
  tipo: 'oficial', capturadoPor: 'residente@fosmon.com.mx',
  subs: Array.from({ length: nPartidas }, (_, i) => ({
    sec: `${1 + (i % 9)}.${1 + (i % 7)}.${i}`,
    a: (i * 7) % 100, imp: 125430.55 + i, cant: 12.5 + i,
    pu: 983.44 + i, cantEjec: 4.25 + i,
  })),
  avancePonderado: 43.7, montoEjecutado: 9123456.78,
  montoCatalogo: 8900000.1, montoExcedente: 223456.68,
  contratoRef: 21000000, montoEstimado: 7000000, montoPagado: 6500000,
  modoAvance: 'porcentaje', esquema: 3,
});

const hayCuenta = typeof recortarHistorialAvance === 'function'
  && typeof tamañoFirestore === 'function';
if (!hayCuenta) {
  const m = 'nada recorta el historial en bytes: el tope sigue contándose en piezas, '
          + 'y una pieza no pesa lo mismo en todas las obras';
  fallos.push(m);
  console.log(`0. La cuenta del recorte en la unidad del límite\n   ✗ ${m}\n`);
}

// El tamaño del documento que de verdad se escribe: `{ semanas, recorte }`.
const pesoEscrito = lista => tamañoFirestore({ semanas: lista }) + tamañoFirestore(SELLO);

// Sesenta cierres consecutivos, como los vive una obra: se recorta, se escribe,
// y a la semana siguiente se vuelve a leer lo recortado.
const correrUnAño = (nPartidas, hasta = 60) => {
  let hist = [];
  const rondas = [];
  for (let s = 1; s <= hasta; s++) {
    const snap = cierre(s, 2026, nPartidas);
    const i = hist.findIndex(x => x.id === snap.id);
    if (i >= 0) hist[i] = snap; else hist.push(snap);
    hist.sort((a, b) => (a.año - b.año) || (a.semana - b.semana));
    const antes = hist.length;
    hist = recortarHistorialAvance(hist, snap);
    rondas.push({ s, antes, quedan: hist.length, bytes: pesoEscrito(hist),
                  ultimo: hist[hist.length - 1]?.id, primero: hist[0]?.id, snap });
  }
  return rondas;
};

if (hayCuenta) {
  // ── 1. La obra pesada: ninguna de las 60 escrituras pasa de 1 MiB ───────
  // Es el caso de la 0125 y es lo único que importa de todo esto. Con el
  // recorte de 52 piezas el documento pasa del límite alrededor del cierre 35
  // y a partir de ahí el cierre NUEVO ya no se puede escribir.
  console.log('1. Un catálogo del tamaño del de la 0125 cierra 60 semanas sin reventar el documento');
  const pesada = correrUnAño(461);
  const pasadas = pesada.filter(r => r.bytes > LIMITE_DOC_FIRESTORE);
  check(pasadas.length === 0,
    `ninguna de las 60 escrituras pasa de 1 MiB (pasaron ${pasadas.length}` +
    `${pasadas[0] ? `, la primera en el cierre ${pasadas[0].s} con ${pasadas[0].bytes} B` : ''})`);

  // Y la reserva: el documento escrito MÁS el cierre que viene tiene que
  // caber. Si no, lo de arriba sólo dice que hoy cupo.
  const sinSitio = pesada.filter(r =>
    r.bytes + tamañoFirestore(r.snap) > LIMITE_DOC_FIRESTORE);
  check(sinSitio.length === 0,
    `en las 60 queda sitio para el cierre siguiente (faltó en ${sinSitio.length})`);

  // Y recortó de verdad: si quedaran las 60, no se habría medido nada.
  const ultima = pesada[pesada.length - 1];
  check(ultima.quedan < 52,
    `en esta obra el byte muerde antes que el año: quedan ${ultima.quedan} de 52`);

  // ── 2. La obra ligera conserva su año completo ───────────────────────────
  // El recorte en bytes no puede cobrarse el expediente de las obras que sí
  // caben. 52 semanas es la PROMESA del expediente, y se cumple.
  console.log('\n2. Un catálogo del tamaño del de la 0128 conserva las 52 semanas que promete el expediente');
  const ligera = correrUnAño(46);
  const fin = ligera[ligera.length - 1];
  // El 52 va escrito y no leído de la constante: lo que se afirma es que el
  // expediente conserva UN AÑO, y comparar contra la propia constante del
  // archivo haría que bajarla a 20 saliera verde. La prueba mide la promesa,
  // no el valor que haya hoy en el fuente.
  check(fin.quedan === 52,
    `quedan las 52 del año, ni una menos (quedan ${fin.quedan})`);
  check(fin.bytes < LIMITE_DOC_FIRESTORE,
    `y el documento va holgado (${(fin.bytes / 1024).toFixed(1)} KB)`);

  // ── 3. Lo que se tira es lo VIEJO, nunca el cierre que se acaba de hacer ─
  // El residente acaba de cerrar la semana. Si el recorte se llevara el cierre
  // nuevo, la pantalla diría «Guardado» sobre algo que no está.
  console.log('\n3. El recorte se lleva lo más viejo; el cierre que se acaba de hacer siempre sobrevive');
  const perdioElNuevo = pesada.filter(r => r.ultimo !== r.snap.id);
  check(perdioElNuevo.length === 0,
    `el cierre de la semana sobrevive en las 60 rondas (falló en ${perdioElNuevo.length})`);
  const haciaAtras = pesada.filter((r, i) =>
    i > 0 && r.primero < pesada[i - 1].primero);
  check(haciaAtras.length === 0,
    'la frontera del expediente sólo avanza: nunca reaparece una semana ya tirada');

  // ── 4. El piso es UNA semana, no cero ───────────────────────────────────
  // Un historial vacío se lee como «a esta obra nadie le capturó nada», que es
  // una afirmación falsa sobre el trabajo de alguien. Si ni una semana cabe, no
  // se recorta más: la escritura falla de cara y eso ya se sabe decir.
  console.log('\n4. Si ni una semana cabe, el historial no se queda vacío: la escritura falla de cara');
  const monstruo = cierre(40, 2026, 40000);
  check(tamañoFirestore(monstruo) > LIMITE_DOC_FIRESTORE,
    'el caso es el que se quiere: un solo cierre que ya no cabe en el documento');
  const solaSemana = recortarHistorialAvance([monstruo], monstruo);
  check(solaSemana.length === 1,
    `queda la semana, no un historial vacío (quedaron ${solaSemana.length})`);
  const dos = recortarHistorialAvance(
    [cierre(39, 2026, 40000), monstruo], monstruo);
  check(dos.length === 1 && dos[0].id === monstruo.id,
    `con dos que no caben queda la nueva, no la vieja (quedaron ${dos.length})`);

  // ── 5. El sello dice POR CUÁL de los dos topes se recortó ───────────────
  // No significan lo mismo. Recortar por el año es el expediente cumpliendo su
  // promesa y no hay nada que arreglar. Recortar por el byte es que esta obra
  // ya no cabe en un documento, y eso es trabajo para sistemas ANTES de que el
  // cierre empiece a fallar. Anotados igual, el segundo se leería como rutina
  // hasta el día que se cayera la escritura.
  console.log('\n5. El sello distingue «cumplí el año» de «esta obra ya no cabe»');
  // El motivo NO se reimplementa aquí. Vive dentro de `crearSnapshotAvance`, así
  // que no se puede pedir por nombre: se saca por sitio y se ejecuta. Copiar la
  // expresión del motivo la haría comprobarse contra sí misma, y entonces el día
  // que la app anotara siempre el mismo motivo esta prueba seguiría verde.
  const mRecorte = /const cuantasSeFueron[\s\S]*?\n      : recortePrevio;/.exec(srcApp);
  if (!mRecorte) {
    const m = 'no se pudo leer el sello del recorte dentro del guardado del cierre';
    fallos.push(m); console.log(`   ✗ ${m}`);
  } else {
    const selloDe = new Function('semanas', 'recortadas', 'hist',
      `"use strict";\n${cierreDe(mRecorte[0], { archivo: ARCH_APP })}\n${mRecorte[0]} return recorte;`);
    check(RECORTE_POR_AÑO !== RECORTE_POR_TAMAÑO,
      'los dos motivos no son la misma palabra');
    // La ligera en su semana 53: se fue una, y es exactamente la que sobra del año.
    const l53 = [];
    for (let s = 1; s <= 53; s++) l53.push(cierre(s, 2026, 46));
    const rL = recortarHistorialAvance(l53, l53[52]);
    const sL = selloDe(l53, rL, { semanas: [] });
    check(rL.length === 52 && sL && sL.motivo === RECORTE_POR_AÑO,
      `la ligera que pasa de 52 se anota por el AÑO (dijo ${sL && sL.motivo})`);
    // La pesada en su semana 40: no ha llegado al año y ya se le fueron varias.
    const p40 = [];
    for (let s = 1; s <= 40; s++) p40.push(cierre(s, 2026, 461));
    const rP = recortarHistorialAvance(p40, p40[39]);
    const sP = selloDe(p40, rP, { semanas: [] });
    check(rP.length < 40 && sP && sP.motivo === RECORTE_POR_TAMAÑO,
      `la pesada que no llegó al año se anota por el TAMAÑO (dijo ${sP && sP.motivo})`);
    // Y el que se anota por tamaño no se puede confundir con rutina: es el que
    // manda a sistemas antes de que el cierre empiece a fallar.
    check(sL && sP && sL.motivo !== sP.motivo,
      'los dos casos no se anotan con el mismo motivo');
  }

  // ── 6. El convenio que agranda el catálogo a mitad de obra ──────────────
  // Esta sección existe porque la contraprueba la exigió, y la primera versión
  // estaba mal de dos maneras distintas.
  //
  // Una mutación que cambiaba la reserva por una FRACCIÓN FIJA del límite —el
  // 2%— pasó sin que nadie la viera. Y no porque la fracción fuera buena: es que
  // el recorte quita semanas ENTERAS, y entre un múltiplo de 34 KB y el
  // siguiente sobra holgura para absorber una reserva mal puesta. Medir dos
  // obras de catálogo constante cae justo en ese hueco.
  //
  // Lo primero que intenté fue barrer 117 tamaños de catálogo. Funcionaba y
  // tardaba minuto y medio, que para un banco de la suite es inaceptable — y
  // además era fuerza bruta buscando una coincidencia aritmética. Lo que hace
  // falta no es más tamaños: es el caso donde una fracción fija NO PUEDE
  // acertar, y ese caso además es real.
  //
  // UN CONVENIO AGRANDA EL CATÁLOGO. La obra lleva un año de cierres de 300
  // partidas, se firma un convenio y pasa a 1 200. El documento viene lleno de
  // semanas pequeñas, bien empaquetado contra el límite, y lo que entra ahora
  // pesa cuatro veces más. Una reserva que mira el CIERRE QUE LLEGA lo ve
  // venir; una fracción del límite no puede verlo, porque no sabe nada de esta
  // obra. Y eso no es un supuesto: es lo que pasa cada vez que un convenio
  // amplía el catálogo a media obra.
  console.log('\n6. Un convenio que cuadruplica el catálogo no deja el documento sin sitio');
  const crecio = [];
  let hist2 = [];
  for (let s = 1; s <= 52; s++) {
    const snap = cierre(s, 2026, 300);
    hist2.push(snap);
    hist2 = recortarHistorialAvance(hist2, snap);
  }
  const antesDelConvenio = hist2.length;
  for (let s = 1; s <= 8; s++) {
    const snap = cierre(s, 2027, 1200);
    hist2.push(snap);
    hist2 = recortarHistorialAvance(hist2, snap);
    const escrito = pesoEscrito(hist2);
    if (escrito > LIMITE_DOC_FIRESTORE
        || escrito + tamañoFirestore(snap) > LIMITE_DOC_FIRESTORE
        || hist2.length < 1) {
      crecio.push({ s, quedan: hist2.length, escrito,
                    conElSiguiente: escrito + tamañoFirestore(snap) });
    }
  }
  check(antesDelConvenio > 8,
    `antes del convenio el documento venía empaquetado con semanas chicas (${antesDelConvenio})`);
  check(crecio.length === 0,
    `los 8 cierres del catálogo nuevo caben y dejan sitio al siguiente ` +
    `(fallaron ${crecio.length}` +
    `${crecio[0] ? `, el primero: ${crecio[0].conElSiguiente} B de ${LIMITE_DOC_FIRESTORE}` : ''})`);
  check(hist2.length < antesDelConvenio,
    `y el expediente se acortó al encarecerse la semana (${antesDelConvenio} → ${hist2.length})`);
}

// ── LAS MUTACIONES ─────────────────────────────────────────────────────
// Cada una es una forma concreta de que el tope deje de proteger lo que dice
// proteger. Si alguna sale verde, la aserción que debía atraparla no afirma
// nada. Las dos primeras son las averías de producción; las otras son las
// maneras de «arreglarlo» que parecen razonables y pierden algo.
const MUTANTES = [
  { titulo: 'el tope vuelve a contarse sólo en piezas, como antes de medir',
    cambios: [['  while (lista.length > 1\n         && tamañoFirestore({ semanas: lista }) + reserva > LIMITE_DOC_FIRESTORE) {\n    lista = lista.slice(1);\n  }\n  return lista;',
               '  return lista;']] },
  { titulo: 'cabe hoy pero no se reserva el cierre que viene',
    cambios: [['  const reserva = tamañoFirestore(snapNuevo)\n                + tamañoFirestore({ recorte: SELLO_RECORTE_MUESTRA });',
               '  const reserva = 0;']] },
  // LA QUE NO ESTÁ Y POR QUÉ. Se probó «la reserva olvida el sello y se queda
  // ochenta bytes corta» y PASÓ sin que nadie la viera. No se añadió una
  // aserción para atraparla, porque no es un defecto: el recorte quita semanas
  // enteras, y una semana son decenas de KB. Ochenta bytes de reserva no pueden
  // cambiar ningún resultado — quedarían absorbidos por la holgura del siguiente
  // múltiplo de una semana. Cobrarle el sello a la reserva es correcto y se
  // queda; inventar una aserción que distinga 80 B sería medir el andamio.
  { titulo: 'la reserva vuelve a ser una fracción del límite en vez del peso del cierre',
    cambios: [['  const reserva = tamañoFirestore(snapNuevo)\n                + tamañoFirestore({ recorte: SELLO_RECORTE_MUESTRA });',
               '  const reserva = Math.round(LIMITE_DOC_FIRESTORE * 0.02);']] },
  { titulo: 'el piso baja a cero y el historial puede quedar vacío',
    cambios: [['  while (lista.length > 1', '  while (lista.length > 0']] },
  { titulo: 'el recorte se lleva el cierre que se acaba de hacer',
    cambios: [['    lista = lista.slice(1);', '    lista = lista.slice(0, -1);']] },
  { titulo: 'el año desaparece y el expediente crece sin promesa',
    cambios: [['  let lista = semanasOrdenadas.slice(-SEMANAS_DE_EXPEDIENTE);',
               '  let lista = semanasOrdenadas.slice();']] },
  { titulo: 'el año se cobra aunque la obra quepa de sobra',
    cambios: [['const SEMANAS_DE_EXPEDIENTE = 52;', 'const SEMANAS_DE_EXPEDIENTE = 20;']] },
  { titulo: 'el sello anota siempre el año, y «esta obra ya no cabe» se lee como rutina',
    cambios: [['          motivo: cuantasSeFueron > porElAño ? RECORTE_POR_TAMAÑO : RECORTE_POR_AÑO,',
               '          motivo: RECORTE_POR_AÑO,']] },
  { titulo: 'el sello anota siempre el tamaño, y cumplir el año se lee como avería',
    cambios: [['          motivo: cuantasSeFueron > porElAño ? RECORTE_POR_TAMAÑO : RECORTE_POR_AÑO,',
               '          motivo: RECORTE_POR_TAMAÑO,']] },
  { titulo: 'el límite se declara más alto que el de Firestore',
    cambios: [['const LIMITE_DOC_FIRESTORE = 1048576;', 'const LIMITE_DOC_FIRESTORE = 4194304;']] },
];

// La revisión barata corre SIEMPRE, también en `npm test`: un anclaje rancio es
// una mutación que dejó de aplicar, y ninguna contraprueba se vuelve a correr
// sola. Menos cuando este proceso ES un mutante, donde faltan a propósito.
if (!process.env.SIN_CONTRAPRUEBA && !process.env.ARCHIVO_APP && !argRuta) {
  CP.exigirAnclajes(MUTANTES, srcApp, { archivo: ARCH_APP });
}

if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba · src/App.jsx ──────────────────────────────');
  const s = CP.correr({
    mutaciones: MUTANTES, src: srcApp, archivo: ARCH_APP,
    prefijo: 'tope-bytes-',
    comoCorrer: (ruta) => ({ env: { ARCHIVO_APP: ruta, SIN_CONTRAPRUEBA: '1' } }),
  });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log('VERDE — el documento se protege en la unidad en que lo corta Firestore.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
