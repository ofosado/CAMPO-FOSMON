#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// QUÉ PODRÍA AFIRMAR LA SECCIÓN 5 DEL DOCUMENTO INTERNO — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. La sección 5 es «el resumen fotográfico 80/20» del papel de cotea.
// Antes de escribirla hay que saber qué va a decir en las obras de verdad,
// porque una sección cuyo caso interesante no existe es decoración, y una que
// sólo tiene un caso se calibra contra ese caso sin saberlo (el error del #122,
// donde el umbral del margen se eligió sobre una sola observación).
//
// LAS CUATRO PREGUNTAS QUE DECIDEN LA SECCIÓN:
//
//   1. ¿CUÁNTAS OBRAS CAEN DEBAJO DEL PISO? El reporte del CLIENTE se niega a
//      imprimir el porcentaje debajo del 50% —un «31.2%» pelón se lee como una
//      medición cumplida cuando lo que dice es que el expediente no se
//      sostiene—. Hacia adentro la cifra sí hace falta: cotea necesita saber si
//      va en 31 o en 48 para decidir a quién manda a fotografiar. Esa
//      diferencia de criterio sólo vale la pena si hay obras debajo del piso.
//
//   2. ¿CUÁNTAS FOTOS NO TIENEN AUTOR? Las 656 fotos viejas de producción se
//      subieron antes de que la app registrara quién las tomaba, y nunca lo van
//      a tener. En el reporte del cliente el sello va foto por foto, en el pie.
//      Hacia adentro lo que importa es el AGREGADO: si el expediente que se
//      entrega se apoya en treinta fotos que nadie puede atribuir, quien firma
//      tiene que saberlo antes de firmar, no leyéndose treinta pies de foto.
//
//   3. ¿HAY FOTOS HUÉRFANAS? Una foto cuyo `partidaId` no corresponde a ninguna
//      partida viva existe, ocupa Storage y NO CUENTA para la cobertura. Desde
//      afuera eso se ve igual que «faltan fotos», y la orden que se da es la
//      contraria: no hay que ir a tomarlas, hay que recuperarlas.
//
//   4. ¿EL REPARTO TIRA MUCHO? El tope son 15 fotos. Si una obra tiene 80, el
//      expediente enseña 15 y las otras 65 no aparecen en ningún lado. Decir
//      «15 fotos» sin decir «de 80» hace creer que 15 es lo que hay.
//
// LA CUENTA SE EXTRAE DE LA APP, NO SE REESCRIBE. `seleccionFotografica`,
// `coberturaDeEvidencia`, `frasesDeCobertura`, `fraseOrigenEvidencia` y los dos
// umbrales salen de `src/App.jsx`. Una copia del reparto aquí mediría un
// documento que no es el que se imprime.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-el-resumen-fotografico.cjs --prod
//
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-el-resumen-fotografico.cjs

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const { deApp } = require('./extraer-de-app.cjs');
const {
  evidenciaDeObra, idDePartida, seleccionFotografica, frasesDeCobertura,
  fraseOrigenEvidencia, selloDeEvidencia, TOPE_FOTOS,
  COBERTURA_TECHO, COBERTURA_PISO,
} = deApp('evidenciaDeObra', 'idDePartida', 'seleccionFotografica',
         'frasesDeCobertura', 'fraseOrigenEvidencia', 'selloDeEvidencia',
         'TOPE_FOTOS', 'COBERTURA_TECHO', 'COBERTURA_PISO');

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-el-resumen-fotografico.cjs --prod\n');
  process.exit(2);
}

// LA ÚNICA PUERTA A LA RED. GET y nada más. Un 404 es «no existe» y vuelve
// `null`; cualquier otro error PARA el guion, porque un token vencido tratado
// como lista vacía sale como «0% de cobertura» y eso es creíble y falso.
async function leer(ruta) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'GET',
    headers: DESTINO.prod
      ? { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO }
      : { Authorization: 'Bearer owner' },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    console.error(`\nNO ARRANCÓ: HTTP ${r.status} en ${ruta}`);
    console.error((await r.text()).slice(0, 300));
    if (r.status === 401 || r.status === 403) console.error(
      '\nSuele ser el token vencido:\n' +
      '  TOKEN=$(gcloud auth application-default print-access-token)');
    process.exit(2);
  }
  return r.json();
}

const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

// Paginando: una obra con más de 300 fotos medida con las primeras 300 da una
// cobertura menor a la real, dicha con la misma seguridad.
async function coleccion(ruta) {
  const out = [];
  let token = null;
  do {
    const q = `pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const r = await leer(`${ruta}?${q}`);
    if (!r) break;
    for (const d of (r.documents || [])) out.push({ id: d.name.split('/').pop(), ...campos(d) });
    token = r.nextPageToken || null;
  } while (token);
  return out;
}

// El arreglo `subs` TAL COMO LO TIENE LA APP EN MEMORIA: las extraordinarias
// viven en otro documento y se mezclan al final, y a los `subs` viejos sin `id`
// la app les pone `${sec}__${idx}`, que es el id con el que la foto se guardó.
async function subsDeObra(obraId) {
  const d = campos(await leer(`obras/${obraId}/avance/subs`));
  const dExtra = campos(await leer(`obras/${obraId}/avance/extraordinarias`));
  const extras = (Array.isArray(dExtra.data) ? dExtra.data : [])
    .map((s, i) => ({ ...s, extra: true, id: s.id || `EXTRA__${i}` }));
  const base = Array.isArray(d.data) ? d.data : [];
  const necesitaMigrar = base.some(s => !s.id);
  const conId = necesitaMigrar
    ? base.map((s, idx) => ({ ...s, id: s.id || `${s.sec || 'C'}__${idx}` }))
    : base;
  return [...conId, ...extras];
}

const MXN = n => '$' + Math.round(n).toLocaleString('es-MX');

(async () => {
  console.log(`\nDESTINO: ${DESTINO.prod ? 'PRODUCCIÓN (campo-fosmon)' : 'emulador ' + DESTINO.emulador}`);
  console.log('MODO:    SÓLO LECTURA — este guion no escribe, no tiene con qué\n');

  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];
  if (!docs.length) { console.log('No hay obras que leer.\n'); process.exit(0); }

  const medidas = [];

  for (const d of docs) {
    const obraId = d.name.split('/').pop();
    const o = campos(d);
    if ((o.estado || 'activa') !== 'activa') continue;

    const subs = await subsDeObra(obraId);
    const cfgEvidencia = campos(await leer(`obras/${obraId}/config/evidencia`));
    const docsEvidencia = cfgEvidencia.migrada === true
      ? await coleccion(`obras/${obraId}/evidencia`) : [];
    const evidencia = evidenciaDeObra({ cfgEvidencia, docsEvidencia, subs });

    // El PDF no recorta partidas: `topePartidas` se queda en Infinity, igual
    // que en `generarPDFObra`. Lo que recorta es el tope de FOTOS.
    const sel = seleccionFotografica({
      subs, evidencia, evidenciaCargada: true, tope: TOPE_FOTOS });

    const vigentes = evidencia.filter(e => !e.anulada);
    const idsTodos = new Set(subs.map((s, i) => idDePartida(s, i)));
    const huerfanas = vigentes.filter(f => f.partidaId && !idsTodos.has(f.partidaId));
    const sinClave  = vigentes.filter(f => !f.partidaId);

    // Las fotos que el expediente ENSEÑARÍA, no todas las que hay.
    const elegidas = [...sel.partidas, ...sel.fuera].flatMap(p => p.fotos);
    const legadoElegidas = elegidas.filter(f => !selloDeEvidencia(f).verificada).length;
    const legadoTodas    = vigentes.filter(f => !selloDeEvidencia(f).verificada).length;

    // Cuántas hay disponibles contra cuántas caben. El sobrante es lo que el
    // expediente no enseña y nadie sabría que existe.
    const disponibles = [...sel.partidas, ...sel.fuera]
      .reduce((t, p) => t + p.disponibles, 0);

    medidas.push({
      id: obraId, nombre: o.nombre || obraId,
      c: sel.cobertura, frase: frasesDeCobertura(sel.cobertura),
      corte: sel.partidas.length,
      sinEvidencia: sel.sinEvidencia.length,
      elegidas: elegidas.length, disponibles,
      legadoElegidas, legadoTodas, vigentes: vigentes.length,
      origen: fraseOrigenEvidencia(elegidas),
      huerfanas: huerfanas.length, sinClave: sinClave.length,
      anuladas: evidencia.length - vigentes.length,
      fueraConFoto: sel.fuera.length,
    });
  }

  medidas.sort((a, b) => (b.c.pct ?? -1) - (a.c.pct ?? -1));

  for (const m of medidas) {
    console.log(`  ${m.id} · ${String(m.nombre).slice(0, 48)}`);
    console.log(`         ${m.frase.titulo}`);
    console.log(`         corte del 80%: ${m.corte} partidas · ${m.sinEvidencia} SIN una sola foto`);
    console.log(`         el expediente enseñaría ${m.elegidas} de ${m.disponibles} disponibles` +
                (m.disponibles > m.elegidas ? `  ← ${m.disponibles - m.elegidas} no se ven` : ''));
    console.log(`         origen de las que enseña: ${m.origen || '—'}`);
    if (m.huerfanas || m.sinClave) console.log(
      `         HUÉRFANAS: ${m.huerfanas} apuntan a una partida que no existe` +
      (m.sinClave ? `, ${m.sinClave} sin clave de partida` : ''));
    if (m.anuladas) console.log(`         ${m.anuladas} anulada(s), fuera de la cuenta`);
    console.log('');
  }

  const bajoPiso = medidas.filter(m => m.c.medible && m.c.pct < COBERTURA_PISO);
  const sobreTecho = medidas.filter(m => m.c.medible && m.c.pct >= COBERTURA_TECHO);
  const noMedibles = medidas.filter(m => !m.c.medible);
  const conLegado = medidas.filter(m => m.legadoElegidas > 0);
  const conHuerfanas = medidas.filter(m => m.huerfanas > 0 || m.sinClave > 0);
  const conSobrante = medidas.filter(m => m.disponibles > m.elegidas);
  const conHuecos = medidas.filter(m => m.sinEvidencia > 0);

  const raya = '─'.repeat(92);
  console.log(raya);
  console.log('QUÉ CONTESTA ESTA MEDICIÓN\n');

  console.log(`  1. DEBAJO DEL PISO (${COBERTURA_PISO}%): ${bajoPiso.length} de ${medidas.length} obras` +
    (bajoPiso.length ? ` — ${bajoPiso.map(m => `${m.id} (${m.c.pct.toFixed(1)}%)`).join(', ')}` : ''));
  console.log(`     El reporte del cliente NO imprime ese número. Si la sección 5 lo publica,`);
  console.log(`     la diferencia de criterio se ejerce en ${bajoPiso.length} obra(s) reales, no en una hipótesis.`);
  console.log(`     Arriba del techo (${COBERTURA_TECHO}%): ${sobreTecho.length}. No medibles: ${noMedibles.length}.\n`);

  console.log(`  2. FOTOS SIN AUTOR entre las que el expediente enseñaría: ${conLegado.length} de ${medidas.length} obras`);
  for (const m of conLegado) console.log(
    `       ${m.id}: ${m.legadoElegidas} de ${m.elegidas} enseñadas son de archivo ` +
    `(${m.legadoTodas} de ${m.vigentes} en toda la obra)`);
  if (!conLegado.length) console.log('       ninguna: todo lo que se enseñaría está verificado');
  console.log('');

  console.log(`  3. HUÉRFANAS: ${conHuerfanas.length} de ${medidas.length} obras`);
  for (const m of conHuerfanas) console.log(
    `       ${m.id}: ${m.huerfanas} apuntan a una partida que ya no existe, ${m.sinClave} sin clave`);
  if (!conHuerfanas.length) console.log('       ninguna: toda foto vigente encuentra su partida');
  console.log('');

  console.log(`  4. EL REPARTO TIRA FOTOS en ${conSobrante.length} de ${medidas.length} obras (tope ${TOPE_FOTOS})`);
  for (const m of conSobrante) console.log(
    `       ${m.id}: enseña ${m.elegidas} de ${m.disponibles} — ${m.disponibles - m.elegidas} no aparecen en el expediente`);
  if (!conSobrante.length) console.log('       ninguna: todas las fotos disponibles caben');
  console.log('');

  console.log(`  5. PARTIDAS GRANDES SIN UNA SOLA FOTO: ${conHuecos.length} de ${medidas.length} obras`);
  for (const m of conHuecos) console.log(
    `       ${m.id}: ${m.sinEvidencia} de las ${m.corte} del corte del 80%`);
  console.log('');

  // El veredicto que decide si la sección se puede construir. Lo que hace falta
  // es que cada conducta que la sección va a tener tenga obra que la ejerza; si
  // alguna no la tiene, la sección la va a llevar sin que nadie la haya visto.
  const sinCaso = [
    bajoPiso.length ? null : `publicar el % debajo del piso (ninguna obra debajo de ${COBERTURA_PISO}%)`,
    conLegado.length ? null : 'avisar de fotos sin autor',
    conHuerfanas.length ? null : 'avisar de huérfanas',
    conSobrante.length ? null : 'decir cuántas no se ven',
    conHuecos.length ? null : 'la lista de partidas grandes sin foto',
    noMedibles.length ? null : 'el caso de cobertura NO MEDIBLE',
  ].filter(Boolean);

  console.log(raya);
  if (!sinCaso.length) {
    console.log('TODAS las conductas de la sección 5 tienen obra real que las ejerce.');
  } else {
    console.log('CONDUCTAS SIN UNA SOLA OBRA QUE LAS EJERZA HOY — se escriben igual, pero');
    console.log('ninguna medición las respalda y la prueba es lo único que las va a ver:');
    for (const s of sinCaso) console.log(`  · ${s}`);
  }
  console.log('');
})();
