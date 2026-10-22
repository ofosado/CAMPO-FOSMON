#!/usr/bin/env node
// SOLO LECTURA de producción. Baja lo que hace falta para sembrar el emulador
// con la obra 0114 tal como está hoy: el historial con sus snapshots y el
// catálogo vivo.
//
// El destino por omisión es `insumos/`, DENTRO del repositorio. Estuvo en
// `/tmp` «porque son datos reales», y el precio fue que `prueba-cierre-emulador`
// se quedaba sin insumo cada vez que el sistema limpiaba el temporal, y que
// reponerlo exigía red y un token de ADC vivo. Un banco cuyo insumo lo pone el
// ambiente da veredictos que dependen del ambiente. Lo que se baja aquí es una
// INSTANTÁNEA, y una instantánea se versiona: así el diff de git enseña cuándo
// y en qué cambió, en vez de aparecer y desaparecer sin dejar rastro.
//
// Volver a correrlo SOBREESCRIBE el insumo versionado. Eso es a propósito:
// git lo hace visible y reversible, que es justo lo que `/tmp` no hacía.
//
// Uso:
//   export PATH="/opt/homebrew/bin:$PATH"
//   TOKEN=$(gcloud auth application-default print-access-token) \
//     node scripts/volcar-0114.cjs [obra] [destino]

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROYECTO = 'campo-fosmon';
const BASE = `/v1/projects/${PROYECTO}/databases/(default)/documents`;
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('Falta TOKEN.'); process.exit(1); }
const OBRA = process.argv[2] || '0114';
const DESTINO = process.argv[3] ||
  path.resolve(__dirname, '..', 'insumos', `${OBRA}-produccion.json`);

const get = ruta => new Promise((res, rej) => {
  https.get({ host: 'firestore.googleapis.com', path: BASE + ruta,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO } }, r => {
    // Ver PENDIENTES, «El transporte que decodificaba a medias»: sin
    // `setEncoding`, un carácter UTF-8 partido entre dos trozos TCP se
    // decodifica a la mitad por cada lado.
    r.setEncoding('utf8');
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => r.statusCode === 200 ? res(JSON.parse(b))
      : r.statusCode === 404 ? res(null) : rej(new Error(`HTTP ${r.statusCode}: ${b.slice(0,200)}`)));
  }).on('error', rej);
});

const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue'  in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue'    in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue'  in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue'     in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

(async () => {
  const hist = campos(await get(`/obras/${OBRA}/avance/historial`));
  const subs = campos(await get(`/obras/${OBRA}/avance/subs`));
  const obra = campos(await get(`/obras/${OBRA}`));
  // La procedencia va DENTRO del archivo, no en el nombre ni en un README.
  // Es lo único que distingue una instantánea de un dato vivo cuando alguien
  // la abre dentro de seis meses y no sabe de cuándo es ni de dónde salió.
  const salida = {
    _origen: `produccion ${PROYECTO} · Firestore REST, SOLO LECTURA`,
    _rutas: [`obras/${OBRA}`, `obras/${OBRA}/avance/historial`,
             `obras/${OBRA}/avance/subs`],
    _producidoPor: 'scripts/volcar-0114.cjs',
    _instantanea: `Esto NO es un dato vivo: es como estaba la ${OBRA} el día que se bajó.`,
    obra: OBRA,
    bajadoEl: new Date().toISOString(),
    contrato: obra.contrato ?? null,
    presupuesto: obra.presupuesto ?? null,
    modoVolumen: obra.modoVolumen ?? null,
    historial: { semanas: hist.semanas || [] },
    subs: { data: subs.data || [] },
  };
  fs.writeFileSync(DESTINO, JSON.stringify(salida, null, 1));
  console.log(`${OBRA} → ${DESTINO}`);
  console.log(`  ${salida.historial.semanas.length} snapshots: ` +
    salida.historial.semanas.map(s => s.id).join(', '));
  console.log(`  ${salida.subs.data.length} conceptos en el catálogo vivo`);
  console.log(`  presupuesto ${salida.presupuesto} · modoVolumen ${salida.modoVolumen}`);
})().catch(e => { console.error(e.message); process.exit(1); });
