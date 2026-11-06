#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ PLAZO Y QUÉ FECHAS SE ESTÁN IMPRIMIENDO HOY? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El comentario de `plazoDeObra` (`src/App.jsx:4194`) dice que el
// defecto ya se arregló: «la proyección del tablero del contratista hacía
// `new Date(obra.fin)` —el fin del CONTRATO, ignorando la ampliación—». Dos
// sitios se quedaron fuera de ese arreglo:
//
//   `src/App.jsx:5618` (regla `fin_006`, «Velocidad de quema insostenible»)
//   `src/App.jsx:16924` (la tarjeta «Proyección de gasto», que lo IMPRIME:
//                        «quedan N semanas de plazo contractual»)
//
// Los dos cuentan `new Date(obra.fin) - new Date()`. Dos errores encima:
//   · `obra.fin` es el fin del CONTRATO. Si la obra tiene `finAmpliado`, el
//     plazo vigente es otro, y `finVigenteDe` existe precisamente para eso.
//   · `new Date("2026-05-27")` se lee como UTC —en México, el 26 a las 18:00—
//     mientras `new Date()` es el instante real. Restarlos mete hasta un día.
//
// Y tres sitios más imprimen una fecha que sólo comprobaron que EXISTE, no que
// se pueda leer. Cuando no se puede, la pantalla dice «Invalid Date»:
//
//   `src/App.jsx:9039`  catálogo de GP → ` · al Invalid Date`
//   `src/App.jsx:24262` alerta leída   → `Leída por X el Invalid Date`
//   `src/App.jsx:14979` nota editada   → no dice «Invalid Date»; dice los
//                       primeros 10 caracteres de lo que haya, que es peor:
//                       parece una fecha sin serlo.
//
// QUÉ SE MIDE, Y POR QUÉ ESO. La pregunta no es «¿puede pasar?» —el código ya
// dice que puede— sino «¿está pasando hoy, y en cuáles?»:
//
//   1. OBRAS CON `finAmpliado` DISTINTO DE `fin`. Ésas son exactamente las que
//      hoy ven dos plazos distintos en dos pantallas de la misma obra. Se
//      imprimen las dos cuentas, la de `obra.fin` y la de `finVigenteDe`, para
//      que la diferencia se vea en semanas y no en teoría.
//   2. SI LA CUENTA CRUZA EL UMBRAL. La tarjeta pinta rojo bajo 8 semanas. Una
//      diferencia que no cruza el umbral es un número mal; una que lo cruza
//      cambia el color de la tarjeta.
//   3. FECHAS GUARDADAS QUE `new Date` NO PUEDE LEER, en los tres sitios que
//      las imprimen sin comprobarlas.
//
// SÓLO LEE, Y NO POR DISCIPLINA SINO POR CONSTRUCCIÓN. La única función de red
// de este archivo es `leer()`, y hace GET. No hay PATCH, ni POST, ni DELETE, ni
// `firebase-admin` —que es el que trae `.set()` detrás—. Una bandera se puede
// teclear mal; un verbo que no está escrito no se puede mandar.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-el-plazo-y-las-fechas-impresas.cjs --prod
//
// Contra el emulador, para ensayarlo sin tocar nada de afuera:
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-el-plazo-y-las-fechas-impresas.cjs

'use strict';

require('./reloj.cjs');
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-el-plazo-y-las-fechas-impresas.cjs --prod\n');
  process.exit(2);
}

// LA ÚNICA PUERTA A LA RED. GET y nada más.
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
    process.exit(2);
  }
  return r.json();
}

const txt = (f, k) => f?.[k]?.stringValue ?? null;

async function todaLaColeccion(ruta) {
  const docs = [];
  let token = null;
  do {
    const sep = ruta.includes('?') ? '&' : '?';
    const j = await leer(`${ruta}${sep}pageSize=300${token ? `&pageToken=${token}` : ''}`);
    if (!j) break;
    docs.push(...(j.documents || []));
    token = j.nextPageToken || null;
  } while (token);
  return docs;
}

const mapa = (campo) => campo?.mapValue?.fields || {};

// ¿`new Date(x)` puede leerlo? Es LA pregunta de los tres sitios que imprimen
// sin comprobar, así que se hace con `new Date`, no con una validación propia.
const sePuedeLeer = (s) => s != null && Number.isFinite(new Date(s).getTime());

// Las dos cuentas de `src/App.jsx:16924`, tal cual. No se reescriben «mejor»:
// el punto es reproducir lo que la pantalla imprime hoy.
const comoLoImprimeHoy = (fin) =>
  Math.max(Math.floor((new Date(fin) - new Date()) / (1000 * 60 * 60 * 24 * 7)), 0);

(async () => {
  console.log(`Destino: ${DESTINO.prod ? 'PRODUCCIÓN (lectura)' : `emulador ${DESTINO.emulador}`}\n`);

  // ── 1. EL PLAZO: ¿UNA CUENTA O DOS? ───────────────────────────────────────
  const obrasDocs = await todaLaColeccion('obras');
  const obras = obrasDocs.map(d => {
    const f = d.fields || {};
    return {
      id: d.name.split('/').pop(),
      nombre: txt(f, 'nombre') || '—',
      estado: txt(f, 'estado') || 'activa',
      fin: txt(f, 'fin'),
      finAmpliado: txt(f, 'finAmpliado'),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  console.log('obra   fin contrato  finAmpliado   sem s/ obra.fin  sem s/ vigente  dif');
  console.log('─'.repeat(84));

  const ampliadas = [];
  const finIlegible = [];

  for (const o of obras) {
    const vigente = o.finAmpliado || o.fin;
    const ampliada = !!o.finAmpliado && o.finAmpliado !== o.fin;

    if (o.fin && !sePuedeLeer(o.fin)) finIlegible.push(o);

    const semContrato = o.fin ? comoLoImprimeHoy(o.fin) : null;
    const semVigente = vigente ? comoLoImprimeHoy(vigente) : null;
    const dif = (semContrato != null && semVigente != null) ? semVigente - semContrato : null;

    if (ampliada) ampliadas.push({ ...o, semContrato, semVigente, dif });

    console.log(`${o.id.padEnd(6)} ${(o.fin || '(no hay)').padEnd(12)} ` +
      `${(o.finAmpliado || '—').padEnd(13)} ${String(semContrato ?? '—').padStart(14)}  ` +
      `${String(semVigente ?? '—').padStart(14)}  ${dif ? `+${dif}` : (dif === 0 ? '0' : '—')}` +
      `${o.estado === 'archivada' ? '  (archivada)' : ''}`);
  }

  // ── 2. LAS FECHAS QUE SE IMPRIMEN SIN COMPROBARSE ─────────────────────────
  const cat = await leer('global/gp_catalogo');
  const catUlt = cat ? txt(cat.fields || {}, 'ultimaActualizacion') : null;

  const leidasDoc = await leer('global/alertas_leidas');
  const items = leidasDoc ? mapa((leidasDoc.fields || {}).items) : {};
  const leidasMalas = [];
  for (const [id, v] of Object.entries(items)) {
    const le = txt(mapa(v), 'leidaEn');
    if (!sePuedeLeer(le)) leidasMalas.push({ id, le });
  }

  const notasMalas = [];
  for (const o of obras) {
    const nd = await leer(`obras/${o.id}/avance/notas`);
    if (!nd) continue;
    for (const [clave, v] of Object.entries(mapa((nd.fields || {}).notas))) {
      const ed = txt(mapa(v), 'editadaEn');
      if (ed != null && !sePuedeLeer(ed)) notasMalas.push({ obra: o.id, clave, ed });
    }
  }

  // `fechaCierre` es el cuarto campo de la misma familia, y el único que se
  // guarda como DÍA SUELTO (`2026-11-05`) y no como instante. Por eso se
  // cuentan dos cosas distintas de él: cuántos no se pueden leer —que es el
  // defecto compartido— y cuántos vienen sin hora, que es donde el día se
  // puede adelantar en uno si se lee como medianoche UTC.
  let cierres = 0, cierresMalos = [], cierresSoloDia = 0;
  for (const o of obras) {
    const hd = await leer(`obras/${o.id}/avance/historial`);
    const snaps = (hd?.fields?.snapshots?.arrayValue?.values || [])
      .map(v => v?.mapValue?.fields || {});
    for (const s of snaps) {
      const fc = txt(s, 'fechaCierre');
      if (fc == null) continue;
      cierres++;
      if (!sePuedeLeer(fc)) cierresMalos.push({ obra: o.id, fc });
      else if (/^\d{4}-\d{2}-\d{2}$/.test(fc)) cierresSoloDia++;
    }
  }

  // ── EL VEREDICTO ──────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('#17b — el plazo contado dos veces (App.jsx:5618 y :16924)');
  if (!ampliadas.length) {
    console.log('  Hoy ninguna obra tiene `finAmpliado` distinto de `fin`, así que las dos');
    console.log('  cuentas coinciden y el número impreso todavía no miente por la');
    console.log('  ampliación. Lo dispara la PRIMERA ampliación que se capture: desde ese');
    console.log('  momento la tarjeta «Proyección de gasto» resta contra un fin que ya se');
    console.log('  movió, mientras `plz_001` y `plz_002` de la misma obra miden contra el');
    console.log('  vigente. Dos pantallas, dos plazos, una obra.');
  } else {
    for (const a of ampliadas) {
      console.log(`  ${a.id} ${a.nombre.slice(0, 30)}: la tarjeta imprime «quedan ` +
        `${a.semContrato} semanas», el plazo vigente da ${a.semVigente} (${a.dif} de más)`);
      const cruza = (a.semContrato < 8) !== (a.semVigente < 8);
      if (cruza) {
        console.log(`       y cruza el umbral de 8: la tarjeta se pinta ` +
          `${a.semContrato < 8 ? 'ROJA' : 'azul'} cuando le toca ` +
          `${a.semVigente < 8 ? 'ROJA' : 'azul'}`);
      }
    }
  }

  console.log('');
  console.log('La resta contra `new Date()` (los dos sitios, haya ampliación o no)');
  console.log('  `new Date("' + (obras.find(o => o.fin)?.fin || '2026-05-27') +
    '")` se lee como UTC y `new Date()` es el instante real: la resta');
  console.log('  arrastra el desfase de la zona. En semanas enteras casi siempre se');
  console.log('  absorbe, y por eso no se ve: asoma en los días en que el cociente cae');
  console.log('  justo en la frontera de la semana. Un número que es correcto casi');
  console.log('  siempre es un número en el que no se puede confiar nunca.');

  console.log('');
  console.log('Fechas guardadas que `new Date` no puede leer');
  console.log(`  global/gp_catalogo.ultimaActualizacion: ${catUlt === null ? '(no hay campo)' : `«${catUlt}»`}` +
    ` → ${catUlt === null ? 'no se imprime' : (sePuedeLeer(catUlt) ? 'se lee bien' : 'IMPRIME «Invalid Date»')}`);
  console.log(`  global/alertas_leidas: ${Object.keys(items).length} marcada(s), ` +
    `${leidasMalas.length} con \`leidaEn\` ilegible`);
  for (const m of leidasMalas) console.log(`    ${m.id} → «${m.le}» IMPRIME «Invalid Date»`);
  console.log(`  avance/notas: ${notasMalas.length} nota(s) con \`editadaEn\` ilegible`);
  for (const m of notasMalas) console.log(`    ${m.obra} ${m.clave} → «${m.ed}» imprime «${String(m.ed).slice(0, 10)}»`);
  console.log(`  avance/historial: ${cierres} cierre(s) con \`fechaCierre\`, ` +
    `${cierresMalos.length} ilegible(s), ${cierresSoloDia} guardado(s) como día suelto`);
  for (const m of cierresMalos) console.log(`    ${m.obra} → «${m.fc}» imprime «${String(m.fc).slice(0, 10)}»`);
  if (cierresSoloDia) {
    console.log('    Los días sueltos son los que `Date.parse` leería como medianoche UTC,');
    console.log('    o sea el día ANTERIOR en la zona de la obra. Van por `fechaLocalDeISO`.');
  }
  if (finIlegible.length) {
    console.log(`  obras con \`fin\` ilegible: ${finIlegible.map(o => o.id).join(', ')}`);
  }
  if (!leidasMalas.length && !notasMalas.length && sePuedeLeer(catUlt)) {
    console.log('');
    console.log('  Hoy los tres campos los escribe la propia aplicación con `toISOString()`,');
    console.log('  así que se leen. El hueco es la comprobación que no está: basta un');
    console.log('  documento tocado a mano, una migración, o el día en que alguien guarde');
    console.log('  ahí un `toLocaleString` —que es exactamente el defecto que acabamos de');
    console.log('  arreglar en el sello de GP— para que la pantalla publique «Invalid Date».');
  }
  console.log('');
})();
