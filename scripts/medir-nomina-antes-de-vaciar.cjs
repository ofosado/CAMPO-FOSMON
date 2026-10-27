#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿SE PUEDE VACIAR EL DOCUMENTO VIEJO DE NÓMINA? (#28b) — NO ESCRIBE NADA
// ════════════════════════════════════════════════════════════════════════════
//
// Vaciar el documento viejo no es sólo quitar la red: APAGA LA ALARMA. La
// guarda `avisarSiFaltanSemanas` (src/App.jsx) empieza con
//
//     if (antes.length === 0) return;   // ya se limpió: la migración terminó
//
// o sea que mientras el documento viejo tenga semanas, cada lectura de la
// pantalla compara subcolección contra documento viejo y LANZA si falta alguna.
// En cuanto se vacía, esa comparación deja de existir para siempre. Por eso el
// vaciado no se decide por fecha —«ya pasó el 2026-09-30»— sino por equivalencia
// comprobada, obra por obra, registro por registro.
//
// Esto es lo que este guion mide, leyendo de producción y sin escribir:
//
//   1. La bandera `config/info.formatoHistorial.nomina`. Si no es 2, la obra
//      sigue LEYENDO del documento viejo: vaciarlo le borra la nómina.
//   2. Que cada semana del documento viejo esté en la subcolección — la misma
//      cuenta que hace la guarda, con la misma función de clave.
//   3. Que las CARGAS coincidan: la unidad del documento viejo no es un
//      trabajador, es un archivo cargado —`semana`, `archivo`, `totalNomina`,
//      `trabajadores[]`— y una misma semana puede venir partida en dos
//      archivos. Que esté la clave no dice que estén las dos partes.
//   4. Que los TRABAJADORES coincidan uno a uno, por nombre y por su `total`.
//      Una carga puede estar presente con la mitad de la gente: la clave pasa,
//      la carga pasa por nombre de archivo, y el dinero no está. El único
//      renglón que no se puede falsear es la persona con su pago.
//
// Sale 0 sólo si TODAS las obras migradas son equivalentes. Si alguna no lo es,
// sale 1: no se vacía nada, y se dice cuál y qué le falta.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-nomina-antes-de-vaciar.cjs

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN = process.env.ADC_TOKEN || '';
if (!TOKEN) {
  try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); } catch { /* abajo */ }
}
if (!TOKEN) {
  try {
    TOKEN = require('child_process')
      .execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'],
        { encoding: 'utf8' }).trim();
  } catch (e) {
    console.error('No hay credencial para leer producción.');
    console.error('  gcloud auth application-default print-access-token > /tmp/adc.tok');
    process.exit(2);   // no arrancó: no es verde ni rojo
  }
}

const pedir = (ruta) => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: 'Bearer ' + TOKEN } }, (r) => {
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => {
      if (r.statusCode === 404) return res(null);
      if (r.statusCode < 200 || r.statusCode >= 300) {
        return rej(new Error(`HTTP ${r.statusCode} en ${ruta}: ${b.slice(0, 200)}`));
      }
      res(b ? JSON.parse(b) : {});
    });
  }).on('error', rej);
});

// Firestore REST → JS. Sólo lo que hace falta para comparar registros.
const valor = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return campos(v.mapValue.fields || {});
  return null;
};
const campos = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, valor(v)]));

// La MISMA clave que usa la app. Se extrae del archivo y se ejecuta: copiarla
// aquí sería comprobar la migración contra una segunda definición de «semana».
const { deApp, SimboloPerdido } = require(path.join(RAIZ, 'scripts/extraer-de-app.cjs'));
let claveSemanaNomina;
try {
  ({ claveSemanaNomina } = deApp('claveSemanaNomina'));
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('Sin la clave de la app no se puede comparar lo que compara la app.');
  process.exit(2);
}

const dinero = (n) => Math.round(Number(n || 0) * 100) / 100;

// Huella de una CARGA: la clave de su semana, el archivo del que salió, cuánta
// gente trae y cuánto suma. Dos cargas de la misma semana se distinguen por
// archivo; si el archivo se repite, las distingue el recuento en la bolsa.
const huellaCarga = (c) => JSON.stringify([
  claveSemanaNomina(c) || '(sin semana)',
  String(c?.archivo ?? '(sin archivo)').trim(),
  (c?.trabajadores || []).length,
  dinero(c?.totalNomina),
]);

// Huella de un TRABAJADOR dentro de su semana. Es el renglón que no se puede
// falsear: si una carga llegó a medias, aquí faltan personas con su pago.
const huellaTrabajador = (clave, t) => JSON.stringify([
  clave,
  String(t?.nombre ?? '').trim().toUpperCase(),
  dinero(t?.total),
]);

const bolsa = (huellas) => {
  const m = new Map();
  for (const h of huellas) m.set(h, (m.get(h) || 0) + 1);
  return m;
};

const trabajadoresDe = (cargas) => {
  const out = [];
  for (const c of cargas) {
    const clave = claveSemanaNomina(c) || '(sin semana)';
    for (const t of (c?.trabajadores || [])) out.push(huellaTrabajador(clave, t));
  }
  return out;
};

// Lo que está en `antes` y no alcanza a estar en `ahora`.
const faltantes = (antes, ahora) => {
  const a = bolsa(antes), b = bolsa(ahora), out = [];
  for (const [h, n] of a) {
    const m = b.get(h) || 0;
    if (m < n) out.push(`${JSON.parse(h).join(' · ')}  (viejo ${n}, sub ${m})`);
  }
  return out;
};

(async () => {
  const lista = await pedir('/obras?pageSize=200&mask.fieldPaths=nombre');
  const obras = (lista?.documents || []).map(d => d.name.split('/').pop()).sort();
  console.log(`Producción: ${obras.length} obra(s) — ${obras.join(' ')}\n`);

  let bloquean = 0, vaciables = 0, nada = 0;

  for (const id of obras) {
    const info = await pedir(`/obras/${id}/config/info`);
    const fh = info?.fields?.formatoHistorial;
    const bandera = fh ? (campos({ x: fh }).x || {}).nomina : undefined;

    const viejo = await pedir(`/obras/${id}/nomina/historial`);
    const antes = viejo?.fields?.semanas
      ? (valor(viejo.fields.semanas) || []) : [];

    if (antes.length === 0) {
      console.log(`${id}  bandera=${bandera ?? '(sin bandera)'}  documento viejo YA VACÍO — nada que hacer`);
      nada++;
      continue;
    }

    if (bandera !== 2) {
      console.log(`${id}  bandera=${bandera ?? '(sin bandera)'}  ${antes.length} registro(s) en el documento viejo`);
      console.log(`      NO SE VACÍA: la obra todavía LEE de aquí. Vaciarlo le borra la nómina de la pantalla.`);
      bloquean++;
      continue;
    }

    const sub = await pedir(`/obras/${id}/nomina_historial?pageSize=300`);
    const ahora = [];
    for (const d of (sub?.documents || [])) {
      const partes = d.fields?.partes ? (valor(d.fields.partes) || []) : [];
      ahora.push(...partes);
    }

    // (2) las claves, igual que la guarda
    const hay = new Set(ahora.map(claveSemanaNomina).filter(Boolean));
    const faltanClaves = [...new Set(antes.map(claveSemanaNomina).filter(Boolean))]
      .filter(c => !hay.has(c)).sort();

    // (3) carga por carga
    const cargasPerdidas = faltantes(antes.map(huellaCarga), ahora.map(huellaCarga));

    // (4) trabajador por trabajador, con su pago
    const tAntes = trabajadoresDe(antes), tAhora = trabajadoresDe(ahora);
    const genteperdida = faltantes(tAntes, tAhora);

    const docs = (sub?.documents || []).length;
    const cuenta = `viejo ${antes.length} carga(s)/${tAntes.length} trab · ` +
                   `sub ${ahora.length} carga(s)/${tAhora.length} trab en ${docs} doc(s)`;

    if (faltanClaves.length === 0 && cargasPerdidas.length === 0 && genteperdida.length === 0) {
      console.log(`${id}  bandera=2  ${cuenta}  → EQUIVALENTE, se puede vaciar`);
      vaciables++;
    } else {
      console.log(`${id}  bandera=2  ${cuenta}`);
      if (faltanClaves.length) console.log(`      semanas que faltan en la subcolección: ${faltanClaves.join(', ')}`);
      for (const p of cargasPerdidas.slice(0, 10)) console.log(`      carga que falta: ${p}`);
      if (cargasPerdidas.length > 10) console.log(`      … y ${cargasPerdidas.length - 10} carga(s) más`);
      for (const p of genteperdida.slice(0, 10)) console.log(`      trabajador que falta: ${p}`);
      if (genteperdida.length > 10) console.log(`      … y ${genteperdida.length - 10} trabajador(es) más`);
      console.log(`      NO SE VACÍA.`);
      bloquean++;
    }
  }

  console.log(`\n${vaciables} vaciable(s) · ${bloquean} que lo impiden · ${nada} ya vacía(s)`);
  if (bloquean > 0) {
    console.log('\nNo se vacía NADA mientras haya una sola obra que lo impida: el');
    console.log('documento viejo es la única salida de la migración, y vaciarlo además');
    console.log('apaga la guarda que hoy compara los dos formatos en cada lectura.');
    process.exit(1);
  }
  console.log('\nTodas las obras migradas son equivalentes registro por registro.');
  console.log('Vaciar es seguro EN CUANTO AL DATO. Lo que se pierde a cambio es la');
  console.log('guarda: `avisarSiFaltanSemanas` deja de comparar y vuelve en silencio.');
})().catch(e => { console.error(e.message || e); process.exit(2); });
