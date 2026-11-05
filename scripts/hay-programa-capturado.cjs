#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿CUÁNTAS OBRAS TIENEN SU PROGRAMA CAPTURADO? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. La gráfica de avance tiene que decidir contra qué compara el avance
// real: contra el PROGRAMA contractual (`obras/{id}/config/programa`, el anexo
// que se firma) o contra una recta de inicio a fin. Esa decisión no se puede
// tomar mirando el emulador, donde el programa está sembrado a propósito: la
// pregunta es cuántas obras REALES lo tienen hoy. Si son cero, dibujar el
// programa es dibujar un hueco; si son todas, la recta es una mentira que ya
// nadie necesita; y lo más probable es que sean algunas, y entonces la gráfica
// tiene que saber decir «esta obra no tiene programa cargado» sin inventarse
// una diagonal que parece un compromiso contractual y no lo es.
//
// Es el #51 (el avance contra una recta) el que espera esta medición.
//
// SÓLO LEE, Y NO POR DISCIPLINA SINO POR CONSTRUCCIÓN. La única función de red
// de este archivo es `leer()`, y hace GET. No hay PATCH, ni POST, ni DELETE, ni
// `firebase-admin` —que es el que trae `.set()` detrás—. Una bandera se puede
// teclear mal; un verbo que no está escrito no se puede mandar.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/hay-programa-capturado.cjs --prod
//
// Contra el emulador, para ensayarlo sin tocar nada de afuera:
//     EMU_HOST=127.0.0.1:8080 node scripts/hay-programa-capturado.cjs

'use strict';

// El portón va PRIMERO, igual que en los guiones que sí escriben: el destino se
// escribe, no se deduce. Aquí no hay nada que autorizar —no escribe— pero sí
// hay a dónde apuntar, y apuntar por omisión es el hábito que ya costó caro.
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
  console.error('    node scripts/hay-programa-capturado.cjs --prod\n');
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
const num = (f, k) => {
  const v = f?.[k];
  if (!v) return null;
  return v.integerValue !== undefined ? Number(v.integerValue)
       : v.doubleValue !== undefined ? v.doubleValue : null;
};

(async () => {
  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];
  if (!docs.length) { console.log('No hay obras que leer.\n'); process.exit(0); }

  console.log(`Obras leídas: ${docs.length}\n`);
  console.log('clave  obra                                       estado      programa');
  console.log('─'.repeat(92));

  const con = [], sin = [];
  for (const d of docs) {
    const id = d.name.split('/').pop();
    const f = d.fields || {};
    const nombre = (txt(f, 'nombre') || '—').slice(0, 42);
    const estado = txt(f, 'estado') || 'activa';

    const p = await leer(`obras/${id}/config/programa`);
    if (!p) {
      sin.push({ id, nombre, estado });
      console.log(`${id.padEnd(6)} ${nombre.padEnd(43)} ${estado.padEnd(11)} —`);
      continue;
    }
    const pf = p.fields || {};
    const partidas = pf.partidas?.arrayValue?.values?.length ?? 0;
    const total = num(pf, 'total');
    const decl = num(pf, 'totalDeclarado');
    const cuadra = (total !== null && decl !== null) ? (Math.round(total) === Math.round(decl)) : null;
    con.push({ id, nombre, estado, partidas, total, decl, cuadra,
               inicio: txt(pf, 'inicio'), fin: txt(pf, 'fin'),
               archivo: txt(pf, 'archivo'), fecha: txt(pf, 'fechaCarga') });
    console.log(`${id.padEnd(6)} ${nombre.padEnd(43)} ${estado.padEnd(11)} ` +
                `${partidas} partidas · cargado ${txt(pf, 'fechaCarga') || '—'}`);
  }

  const act = o => (o.estado || 'activa') !== 'archivada';
  const conAct = con.filter(act), sinAct = sin.filter(act);

  console.log('');
  console.log('─'.repeat(92));
  console.log(`CON programa: ${con.length} de ${docs.length}  ` +
              `(entre las no archivadas, ${conAct.length} de ${conAct.length + sinAct.length})`);

  if (con.length) {
    console.log('');
    console.log('Detalle de las que sí lo tienen:');
    for (const o of con) {
      console.log(`  ${o.id} · ${o.partidas} partidas · ${o.inicio || '—'} → ${o.fin || '—'}`);
      console.log(`         total ${o.total} vs declarado ${o.decl}` +
                  `${o.cuadra === null ? '' : o.cuadra ? ' · cuadra' : '  ← NO CUADRA'}`);
      console.log(`         ${o.archivo || '(sin nombre de archivo)'}`);
    }
  }

  console.log('');
  if (conAct.length === 0) {
    console.log('NINGUNA obra viva tiene programa. La gráfica no puede dibujarlo hoy:');
    console.log('tiene que decir que falta, no sustituirlo por una recta en silencio.');
  } else if (sinAct.length === 0) {
    console.log('TODAS las obras vivas tienen programa. La recta ya no hace falta.');
  } else {
    console.log(`MIXTO: ${conAct.length} con programa y ${sinAct.length} sin él. La gráfica`);
    console.log('necesita las dos conductas, y la de «sin programa» tiene que DECIRLO.');
    console.log(`Sin programa: ${sinAct.map(o => o.id).join(', ')}`);
  }
  console.log('');
})();
