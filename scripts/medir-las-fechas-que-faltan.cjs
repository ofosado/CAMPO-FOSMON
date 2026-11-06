#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ FECHAS FALTAN HOY, Y EN CUÁNTOS DOCUMENTOS? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. #17 (auditar el hueco de «fecha faltante» en los demás módulos) es
// el renglón que dejó debiendo el lote del relleno. Ahí se arreglaron dos
// huecos de fecha —el `?? i+1` del número de estimación y el 999 de «última
// captura»— y el acuerdo dice que el patrón se arregla en todo el repo, no en
// el renglón que falló. Falta saber DÓNDE más hay hueco, y sobre todo cuáles
// huecos están poblados hoy y cuáles son futuros.
//
// EL ERROR QUE NO SE VA A REPETIR. El 2026-10-27 se midió el 999 y salió
// «5 de 5 obras traen la fecha, está LATENTE». Nueve días después eran 2 de 7
// las que no la traían, y el correo del lunes llevaba semanas acusándolas. La
// latencia no era una propiedad del defecto: era el padrón de ese día. Por eso
// este censo no se pregunta «¿puede faltar?» sino «¿en cuántos falta HOY?», y
// por eso imprime el conteo aunque sea cero —un cero fechado se puede volver a
// medir; un «está latente» sin número, no—.
//
// QUÉ SE MIDE. No una lista de campos que yo decida de antemano: eso mediría
// mi suposición. Se recorren los documentos, se recogen TODAS las claves con
// pinta de fecha —`fecha*`, `*En`, `ts`, `inicio`, `fin`, `ultimaActualiz*`— y
// para cada una se reporta en cuántos documentos está presente, en cuántos
// falta, y en cuántos está pero vacía. La cadena vacía se cuenta aparte de la
// ausencia a propósito: `new Date(undefined)` y `new Date("")` dan los dos
// Invalid Date, pero `x && new Date(x)` sólo atrapa el segundo si la guarda es
// de verdad, y hay guardas que miran `'fecha' in doc`.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()`, y hace
// GET. No hay PATCH, POST ni DELETE, ni `firebase-admin`, que es el que trae
// `.set()` detrás. Una bandera se puede teclear mal; un verbo que no está
// escrito no se puede mandar.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-las-fechas-que-faltan.cjs --prod
//
// Contra el emulador:
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-las-fechas-que-faltan.cjs

'use strict';

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
  console.error('    node scripts/medir-las-fechas-que-faltan.cjs --prod\n');
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

const txt = (f, k) => f?.[k]?.stringValue ?? null;
const arreglo = (campo) => (campo?.arrayValue?.values || []).map(v => v?.mapValue?.fields || {});

// Un valor REST a algo comparable, SIN normalizar de más: distinguir `3` de
// `"3"` de `""` de ausente es justo lo que esta medición viene a hacer.
function crudo(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  return undefined;
}

// Qué clave tiene pinta de fecha. Deliberadamente ancho: sobra una clave que
// no lo sea —se ve en la salida y se descarta— antes que falte una que sí.
const PINTA_DE_FECHA = /^(fecha|ts$|.*En$|inicio$|fin$|ultima|ultimo|creado|actualizado|vence|pago)/i;

// El estado de UN valor REST, distinguiendo los tres casos que el código de
// pantalla trata distinto aunque se parezcan.
function estado(v) {
  if (v === undefined) return 'ausente';
  if (v && typeof v === 'object' && 'nullValue' in v) return 'nula';
  const s = v?.stringValue;
  if (s === '') return 'vacía';
  if (typeof s === 'string') return 'presente';
  if (v && typeof v === 'object' && ('timestampValue' in v || 'integerValue' in v || 'doubleValue' in v)) return 'presente';
  return 'otra';
}

// El acumulador: por «forma» (qué clase de documento) y por clave.
const censo = new Map();
function anota(forma, claves, fields) {
  if (!censo.has(forma)) censo.set(forma, { docs: 0, claves: new Map() });
  const f = censo.get(forma);
  f.docs++;
  for (const k of claves) {
    if (!f.claves.has(k)) f.claves.set(k, { ausente: 0, nula: 0, vacía: 0, presente: 0, otra: 0, ejemplo: null });
    const c = f.claves.get(k);
    const e = estado(fields?.[k]);
    c[e]++;
    if (e === 'presente' && !c.ejemplo) c.ejemplo = String(fields[k].stringValue ?? fields[k].timestampValue ?? fields[k].integerValue ?? '').slice(0, 19);
  }
}

// Las claves con pinta de fecha que aparecen en AL MENOS un documento de la
// forma. Se recolectan antes de contar, porque «ausente» sólo tiene sentido
// contra el conjunto de claves que esa forma usa en alguna parte.
function clavesDeFecha(listaDeFields) {
  const s = new Set();
  for (const f of listaDeFields) for (const k of Object.keys(f || {})) if (PINTA_DE_FECHA.test(k)) s.add(k);
  return [...s].sort();
}

function censar(forma, listaDeFields) {
  const claves = clavesDeFecha(listaDeFields);
  if (!claves.length) { censo.set(forma, { docs: listaDeFields.length, claves: new Map() }); return; }
  for (const f of listaDeFields) anota(forma, claves, f);
}

(async () => {
  const obrasDocs = await todaLaColeccion('obras');
  const obras = obrasDocs.map(d => ({
    id: d.name.split('/').pop(),
    fields: d.fields || {},
    estado: txt(d.fields || {}, 'estado') || 'activa',
  })).sort((a, b) => a.id.localeCompare(b.id));

  console.log(`Destino: ${DESTINO.prod ? 'PRODUCCIÓN (sólo lectura)' : `emulador ${DESTINO.emulador}`}`);
  console.log(`Fecha de la medición: ${new Date().toISOString().slice(0, 10)}`);
  console.log(`Obras: ${obras.length} (${obras.filter(o => o.estado !== 'archivada').length} activas)\n`);

  censar('obras/<id>', obras.map(o => o.fields));

  const estimaciones = [];
  const notas = [];
  const historial = [];
  const subs = [];
  // El detalle, para no quedarse en «falta en N de M»: un conteo dice que hay
  // hueco, pero no deja decidir si el hueco es un defecto o un dato legítimo.
  // Eso sólo se ve mirando de QUIÉN es cada hueco y con qué convive.
  const detalle = { fechaFact: [], subsFecha: [], fechaCierre: [] };

  for (const o of obras) {
    const [est, av, hist, nts] = await Promise.all([
      leer(`obras/${o.id}/config/estimaciones`),
      leer(`obras/${o.id}/avance/subs`),
      leer(`obras/${o.id}/avance/historial`),
      leer(`obras/${o.id}/config/notas`),
    ]);

    const filasEst = arreglo((est?.fields || {}).data);
    estimaciones.push(...filasEst);
    filasEst.forEach((f, i) => {
      if (estado(f.fechaFact) !== 'presente') {
        // `no` viene como entero: leerlo con `txt` daba «(sin no)» en las tres
        // y me hizo ver un hueco donde no lo hay. El censo de estimaciones ya
        // había medido que las 34 traen número.
        detalle.fechaFact.push({ obra: o.id, fila: i, no: crudo(f.no) ?? '(sin no)',
          estatus: crudo(f.estatus) ?? '(sin estatus)', monto: crudo(f.monto) });
      }
    });

    if (av) subs.push(av.fields || {});
    if (av && estado((av.fields || {}).fecha) !== 'presente') detalle.subsFecha.push({ obra: o.id });

    const semanas = arreglo((hist?.fields || {}).semanas);
    historial.push(...semanas);
    semanas.forEach((s) => {
      if (estado(s.fechaCierre) !== 'presente') {
        detalle.fechaCierre.push({
          obra: o.id,
          // `semana` viene como número, no como cadena: leerla con `txt` daba
          // «(sin clave)» en las 15 y me hizo creer que el campo no existía.
          semana: `${crudo(s.año) ?? '????'}·S${crudo(s.semana) ?? '??'}`,
          captura: (txt(s, 'fechaCaptura') || '—').slice(0, 10),
          ejecutado: crudo(s.montoEjecutado),
        });
      }
    });

    notas.push(...arreglo((nts?.fields || {}).data));
  }

  // Las claves que REALMENTE trae cada forma. Va impreso porque la primera
  // versión de este guion detallaba los huecos leyendo `semana` y `cerrada`,
  // que no existen, y sacaba una conclusión —«0 se declaran cerradas»— de un
  // campo ausente. Un censo que se inventa los nombres de los campos comete
  // el mismo pecado que vino a medir.
  const clavesDe = (lista) => [...new Set(lista.flatMap(f => Object.keys(f || {})))].sort();
  console.log('Claves que trae cada forma (para no leer campos que no existen):');
  console.log(`  config/estimaciones → ${clavesDe(estimaciones).join(', ') || '—'}`);
  console.log(`  avance/historial    → ${clavesDe(historial).join(', ') || '—'}`);
  console.log(`  avance/subs         → ${clavesDe(subs).join(', ').slice(0, 300) || '—'}`);
  console.log('');

  // `global/gp` va aparte porque no es una forma repetida sino un documento
  // único, y porque su fecha alimenta una afirmación de FRESCURA: si falta,
  // la insignia no dice «no se sabe», dice «hace un momento» en verde.
  const gp = await leer('global/gp_construct');
  const gpF = gp?.fields || {};
  console.log(`global/gp_construct → ${gp ? `existe · ultimaActualizacion: ${estado(gpF.ultimaActualizacion)}` +
    `${estado(gpF.ultimaActualizacion) === 'presente' ? ` (${crudo(gpF.ultimaActualizacion)})` : '   ← HUECO'}` +
    ` · parserVersion: ${crudo(gpF.parserVersion) ?? '(ausente)'}` +
    ` · data.ultimaActualizacion: ${estado((gp.fields?.data?.mapValue?.fields || {}).ultimaActualizacion)}`
    : 'NO EXISTE'}`);
  console.log('');

  censar('config/estimaciones → cada renglón', estimaciones);
  censar('avance/subs', subs);
  censar('avance/historial → cada semana', historial);
  censar('config/notas → cada nota', notas);

  // ── LA SALIDA ─────────────────────────────────────────────────────────────
  const huecos = [];
  for (const [forma, f] of censo) {
    console.log(`${forma}  (${f.docs})`);
    if (!f.claves.size) { console.log('  — ninguna clave con pinta de fecha —\n'); continue; }
    console.log('  clave                   presente  ausente  vacía  nula   ejemplo');
    console.log('  ' + '─'.repeat(74));
    for (const [k, c] of [...f.claves].sort()) {
      const falta = c.ausente + c.vacía + c.nula;
      console.log(`  ${k.padEnd(22)} ${String(c.presente).padStart(8)} ${String(c.ausente).padStart(8)} ` +
        `${String(c.vacía).padStart(6)} ${String(c.nula).padStart(5)}   ${c.ejemplo || '—'}` +
        `${falta ? '   ← HUECO' : ''}`);
      if (falta) huecos.push({ forma, clave: k, falta, de: f.docs });
    }
    console.log('');
  }

  console.log('─'.repeat(78));
  if (!huecos.length) {
    console.log('Hoy ninguna clave con pinta de fecha falta en ningún documento leído.');
    console.log('Eso NO quiere decir que el código esté a salvo: quiere decir que los');
    console.log('huecos que tenga son futuros. Vuelve a correr esto antes de declarar');
    console.log('latente nada —el 999 también estaba «latente» nueve días antes de');
    console.log('acusar a dos obras—.');
  } else {
    console.log(`${huecos.length} clave(s) de fecha con hueco HOY:\n`);
    for (const h of huecos) {
      console.log(`  ${h.forma} · ${h.clave}: falta en ${h.falta} de ${h.de}`);
    }
    console.log('');
    console.log('Cada una de ésas es un `new Date(...)` esperando: lo que haya que');
    console.log('revisar es qué imprime la pantalla cuando ese campo no llega.');

    // ── DE QUIÉN ES CADA HUECO ───────────────────────────────────────────────
    // Un hueco no es un defecto por sí solo. `fechaCierre` ausente en una
    // semana que NO está cerrada es el dato correcto; ausente en una que sí,
    // es un hueco. Sin esta vista las dos se cuentan igual y la medición
    // acusa de más, que es el mismo pecado que vinimos a arreglar.
    if (detalle.fechaFact.length) {
      console.log('\n  fechaFact — estimaciones sin fecha de facturación:');
      for (const d of detalle.fechaFact) {
        console.log(`    ${d.obra} · renglón ${d.fila} · EST-${d.no} · estatus=${d.estatus} · ` +
          `$${(d.monto ?? 0).toLocaleString('es-MX')}`);
      }
    }
    if (detalle.subsFecha.length) {
      console.log('\n  avance/subs.fecha — obras sin fecha de último avance:');
      for (const d of detalle.subsFecha) console.log(`    ${d.obra}`);
    }
    if (detalle.fechaCierre.length) {
      console.log('\n  fechaCierre — semanas con la fecha de cierre en null:');
      for (const d of detalle.fechaCierre) {
        console.log(`    ${d.obra} · ${d.semana} · capturada ${d.captura} · ` +
          `ejecutado ${d.ejecutado === undefined ? '(sin campo)' : d.ejecutado}`);
      }
      console.log('');
      console.log('    No hay campo `cerrada`: el documento señala el cierre con la');
      console.log('    PRESENCIA de `fechaCierre`, así que estas 15 son semanas');
      console.log('    capturadas y no cerradas, y el null es el dato correcto —no un');
      console.log('    hueco—. Lo que hay que revisar no es el documento sino la');
      console.log('    pantalla: qué imprime cuando ese null le llega a un `new Date`.');
    }
  }
  console.log('');
})();
