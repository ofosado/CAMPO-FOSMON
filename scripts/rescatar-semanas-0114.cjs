#!/usr/bin/env node
// Reconstruye los snapshots de las semanas 37 y 38 de 2026 de la obra 0114,
// que se cerraron oficialmente pero nunca llegaron al historial.
//
// POR QUÉ EXISTE
// El documento `obras/0114/avance/historial` llegó al límite de 1 MiB. Siete
// cierres (semanas 32 a 38) fallaron al escribir y el código de entonces no
// revisaba el resultado, así que el usuario vio "listo" siete veces.
//
// QUÉ SE PUEDE Y QUÉ NO
// Solo dos de las siete son reconstruibles, porque solo de esas dos existe el
// estado por partida del momento del cierre:
//   · semana 37 — respaldo `2026-09-11-preseguridad`, tomado 3h después
//   · semana 38 — `avance/subs` en vivo, sin tocar desde el cierre
// Las semanas 32 a 36 NO se escriben. La bitácora solo guarda `avancePromedio`
// (promedio simple de `a`), que no es `avancePonderado` (ejecutado/contrato):
// en la 37 difieren 5.46 puntos. Y sus registros por partida vienen recortados
// a las primeras 50 de 335. Quedan como hueco declarado; inventarlas violaría
// el P2.
//
// CÓMO SE SABE QUE LA FUENTE ES LA CORRECTA
// No por la fecha. De cada fuente se recalcula el promedio simple de `a` sobre
// las 335 partidas y se compara con el que la bitácora guardó en ese cierre.
// Si no coincide al quinto decimal, ABORTA. Una fuente "cercana" al cierre no
// sirve: escribiría como oficial un estado que nadie firmó.
//
// USO
//     node scripts/rescatar-semanas-0114.cjs              ← simulación
//     node scripts/rescatar-semanas-0114.cjs --escribir   ← escribe
//
// Requiere `gcloud auth application-default login` vigente.

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROYECTO = 'campo-fosmon';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const OBRA = '0114';
const RUTA = `obras/${OBRA}/avance/historial`;
const LIMITE = 1048576;
const ESQUEMA_SNAPSHOT = 3;

const escribir = process.argv.includes('--escribir');
const dirCopias = path.join(os.homedir(), 'campo-backups');

// ── Las dos semanas, su fuente y la huella que tiene que cuadrar ────────────
// `avancePromedio` es el valor que la bitácora guardó en el cierre oficial.
// Es el promedio SIMPLE de `a`, no el ponderado. Sirve como huella digital de
// la fuente, no como la cifra a escribir.
const SEMANAS = [
  {
    id: 'S37-2026', semana: 37, año: 2026,
    fuente: path.join(dirCopias, 'fuente-rescate-0114-S37-respaldo-2026-09-11.json'),
    procedencia: 'respaldo 2026-09-11-preseguridad',
    avancePromedioBitacora: 82.13134,
    fechaCierre: '2026-09-11T23:13:50.000Z',
    capturadoPor: 'pcastillo@fosmon.com.mx',
  },
  {
    id: 'S38-2026', semana: 38, año: 2026,
    fuente: path.join(dirCopias, 'fuente-rescate-0114-S38-subs-vivo-2026-09-19.json'),
    procedencia: 'avance/subs en vivo (sin cambios desde el cierre)',
    avancePromedioBitacora: 83.75821,
    fechaCierre: '2026-09-19T05:59:52.000Z',
    capturadoPor: 'pcastillo@fosmon.com.mx',
  },
];

// ── Las fórmulas, copiadas de src/App.jsx sin alterarlas ────────────────────
// La 0114 es modoAvance "porcentaje", así que modoVol = false.
const MODO_VOL = false;
const CONTRATO = 163703079.43;   // obras/0114.presupuesto

const importeEjecutadoPartida = (s, modoVol = false) => {
  if (modoVol) {
    const cantEjec = parseFloat(s?.cantEjec) || 0, pu = parseFloat(s?.pu) || 0;
    if (cantEjec > 0 && pu > 0) return cantEjec * pu;
  }
  const a = parseFloat(s?.a ?? s?.avance) || 0;
  return (a / 100) * (parseFloat(s?.imp ?? s?.importe) || 0);
};
const importeCatalogoPartida = (s) => parseFloat(s?.imp ?? s?.importe) || 0;
const desgloseEjecutado = (subs = [], modoVol = false) => {
  let catalogo = 0, excedente = 0;
  for (const s of (subs || [])) {
    const total = importeEjecutadoPartida(s, modoVol);
    const tope = importeCatalogoPartida(s);
    if (total > tope) { catalogo += tope; excedente += total - tope; }
    else catalogo += total;
  }
  return { catalogo, excedente, total: catalogo + excedente };
};
const avanceFisicoPonderado = (subs = [], contrato = 0, modoVol = false) => {
  if (!(contrato > 0)) return 0;
  return Math.min(100, (desgloseEjecutado(subs, modoVol).total / contrato) * 100);
};

// ── Utilidades Firestore ────────────────────────────────────────────────────
const token = execSync('gcloud auth application-default print-access-token',
  { encoding: 'utf8' }).trim();
const cabeceras = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'x-goog-user-project': PROYECTO,
};
const pedir = async (url, opciones = {}) => {
  const r = await fetch(url, { headers: cabeceras, ...opciones });
  const cuerpo = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(cuerpo.error || cuerpo)}`);
  return cuerpo;
};

// Igual que en compactar-historial.cjs: Firestore no conserva el orden de las
// claves, así que comparar con JSON.stringify directo da falsos positivos.
const canonico = v => JSON.stringify(v, (k, val) =>
  (val && typeof val === 'object' && !Array.isArray(val))
    ? Object.fromEntries(Object.keys(val).sort().map(c => [c, val[c]]))
    : val);

const aValor = v => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  return { mapValue: { fields: Object.fromEntries(
    Object.entries(v).map(([k, x]) => [k, aValor(x)])) } };
};

const bytesDe = v => {
  const k = Object.keys(v)[0], x = v[k];
  if (k === 'stringValue') return Buffer.byteLength(x, 'utf8') + 1;
  if (k === 'integerValue' || k === 'doubleValue' || k === 'timestampValue') return 8;
  if (k === 'booleanValue' || k === 'nullValue') return 1;
  if (k === 'arrayValue') return (x.values || []).reduce((t, e) => t + bytesDe(e), 0);
  if (k === 'mapValue') return bytesDeCampos(x.fields || {});
  return 0;
};
const bytesDeCampos = f => Object.keys(f)
  .reduce((t, k) => t + Buffer.byteLength(k, 'utf8') + 1 + bytesDe(f[k]), 0);
const bytesDeNombre = n => n.split('/documents/').pop().split('/')
  .reduce((t, s) => t + Buffer.byteLength(s, 'utf8') + 1, 0) + 16;
const bytesDeDoc = d => bytesDeNombre(d.name) + bytesDeCampos(d.fields || {}) + 32;
const pct = n => (n / LIMITE * 100).toFixed(1) + '%';
const dinero = n => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const antes = await pedir(`${BASE}/${RUTA}`);
  const existentes = antes.fields?.semanas?.arrayValue?.values || [];
  const idsExistentes = existentes.map(s => s.mapValue.fields.id?.stringValue);

  // Copia local antes de calcular nada.
  fs.mkdirSync(dirCopias, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const copia = path.join(dirCopias, `historial-${OBRA}-antes-rescate-${sello}.json`);
  fs.writeFileSync(copia, JSON.stringify(antes, null, 2));

  console.log(`\n${RUTA}`);
  console.log(`  copia local        ${copia}`);
  console.log(`  snapshots hoy      ${existentes.length}  (${idsExistentes.join(', ')})`);
  console.log(`  contrato           ${dinero(CONTRATO)}\n`);

  const nuevos = [];
  for (const S of SEMANAS) {
    if (idsExistentes.includes(S.id))
      throw new Error(`${S.id} ya está en el historial. Abortado: este script no sobrescribe.`);

    const subs = JSON.parse(fs.readFileSync(S.fuente, 'utf8'));
    if (!Array.isArray(subs) || subs.length === 0)
      throw new Error(`${S.fuente} no trae un arreglo de partidas.`);

    // VERIFICACIÓN DE PROCEDENCIA. Esta es la que decide si se escribe.
    const promedioSimple = subs.reduce((t, s) => t + (parseFloat(s.a) || 0), 0) / subs.length;
    const delta = Math.abs(promedioSimple - S.avancePromedioBitacora);
    const cuadra = delta < 0.000005;

    console.log(`  ${S.id}  ·  ${S.procedencia}`);
    console.log(`     partidas        ${subs.length}`);
    console.log(`     promedio simple ${promedioSimple.toFixed(5)}  vs bitácora ${S.avancePromedioBitacora.toFixed(5)}  ${cuadra ? '✓ cuadra' : '✗ NO CUADRA'}`);
    if (!cuadra)
      throw new Error(`${S.id}: la fuente no es el estado del cierre (difiere ${delta}). No se escribe nada.`);

    const { catalogo, excedente, total } = desgloseEjecutado(subs, MODO_VOL);
    const avancePonderado = avanceFisicoPonderado(subs, CONTRATO, MODO_VOL);

    console.log(`     ponderado       ${avancePonderado.toFixed(5)}%   (el promedio simple difiere ${(promedioSimple - avancePonderado).toFixed(2)} pp — por eso la bitácora sola no basta)`);
    console.log(`     ejecutado       ${dinero(total)}   (catálogo ${dinero(catalogo)} · excedente ${dinero(excedente)})\n`);

    nuevos.push(aValor({
      id: S.id, semana: S.semana, año: S.año,
      fechaCaptura: S.fechaCierre,
      fechaCierre: S.fechaCierre,
      tipo: 'oficial',
      capturadoPor: S.capturadoPor,
      subs: subs.map(s => ({
        sec: s.sec, a: s.a || 0, imp: s.imp || 0,
        cant: parseFloat(s.cant) || 0,
        pu: parseFloat(s.pu) || 0,
        cantEjec: parseFloat(s.cantEjec) || 0,
      })),
      avancePonderado,
      montoEjecutado: total,
      montoCatalogo: catalogo,
      montoExcedente: excedente,
      contratoRef: CONTRATO,
      modoAvance: MODO_VOL ? 'volumen' : 'porcentaje',
      // Esquema 3 porque se calcularon con la definición vigente
      // (ejecutado/contrato, compensado). Marcarlos como esquema 1 fingiría
      // que son comparables con los ocho viejos y el salto de 69.7% a 87.6%
      // se leería como avance de obra cuando es, en parte, cambio de
      // definición. `sonComparables` ya corta ahí.
      esquema: ESQUEMA_SNAPSHOT,
    }));
  }

  const todas = [...existentes, ...nuevos];
  const despues = { ...antes, fields: { ...antes.fields,
    semanas: { arrayValue: { values: todas } } } };
  const bytesAntes = bytesDeDoc(antes), bytesDespues = bytesDeDoc(despues);

  console.log(`  tamaño             ${bytesAntes.toLocaleString('es-MX')} B (${pct(bytesAntes)})  →  ${bytesDespues.toLocaleString('es-MX')} B (${pct(bytesDespues)})`);

  // Los ocho que ya estaban no se tocan. Ni un byte.
  const intactos = canonico(existentes) === canonico(todas.slice(0, existentes.length));
  if (!intactos) {
    console.error('\nABORTA · los snapshots existentes cambiaron. No se escribió nada.');
    process.exit(1);
  }
  console.log(`  verificación       los ${existentes.length} snapshots previos quedan idénticos; se agregan ${nuevos.length}`);
  console.log(`  hueco declarado    semanas 32 a 36 NO se escriben (no reconstruibles)`);

  if (!escribir) {
    console.log('\nSIMULACIÓN · no se escribió nada. Para aplicarlo:');
    console.log('    node scripts/rescatar-semanas-0114.cjs --escribir\n');
    return;
  }

  console.log('\nEscribiendo…');
  await pedir(`${BASE}/${RUTA}?updateMask.fieldPaths=semanas`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { semanas: { arrayValue: { values: todas } } } }),
  });

  // Relectura: no se confía en el 200.
  const releido = await pedir(`${BASE}/${RUTA}`);
  const semRel = releido.fields?.semanas?.arrayValue?.values || [];
  const problemas = [];
  if (semRel.length !== todas.length)
    problemas.push(`quedaron ${semRel.length} snapshots de ${todas.length}`);
  if (canonico(semRel) !== canonico(todas))
    problemas.push('lo guardado no coincide con lo que se envió');
  const idsRel = semRel.map(s => s.mapValue.fields.id?.stringValue);
  if (canonico(idsRel) !== canonico(todas.map(s => s.mapValue.fields.id?.stringValue)))
    problemas.push(`las semanas no son las esperadas: ${idsRel.join(', ')}`);

  if (problemas.length) {
    console.error('\nESCRITO PERO CON PROBLEMAS:');
    problemas.forEach(p => console.error('  · ' + p));
    console.error(`\nEl original está en ${copia}.`);
    process.exit(1);
  }

  const bytesFinal = bytesDeDoc(releido);
  console.log(`Listo · ${RUTA} quedó en ${bytesFinal.toLocaleString('es-MX')} B (${pct(bytesFinal)}) ` +
    `con ${semRel.length} snapshots: ${idsRel.join(', ')}`);
})().catch(e => {
  console.error('\nFALLÓ:', e.message);
  console.error('No se escribió nada si el error ocurrió antes del PATCH.');
  process.exit(1);
});
