#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// #81 — DEVOLVER A LA PANTALLA LA SEMANA 42 DE LA 0126
// ════════════════════════════════════════════════════════════════════════════
//
// El 2026-10-23 la pantalla de nómina escribió dos cargas de la Semana 42 en
// `obras/0126/nomina/historial` —el documento VIEJO— cuando esa obra ya leía de
// `obras/0126/nomina_historial`. Ver el #80: el estado arrancaba suponiendo el
// formato viejo, y el formato viejo escribe el arreglo entero de un golpe.
//
// El #80 corta la causa. Este guion repara el daño: copia esas dos cargas al
// documento de semana que les toca. 132 trabajadores, $679,126.67.
//
// Tres cosas que este guion NO hace, y por qué:
//
//   · NO toca el documento viejo. Mientras tenga contenido, `avisarSiFaltanSemanas`
//     sigue comparando los dos lados en cada lectura. Es la alarma que encontró
//     esto; vaciarla es el #28b y se decide aparte, con la medición en verde.
//   · NO sobrescribe. La escritura lleva `currentDocument.exists=false`, así que
//     si Y2026-S42 apareciera entre la medición y el momento de escribir, el
//     servidor la rechaza. Reparar pisando sería repetir el defecto que repara.
//   · NO reconstruye los registros. Copia los valores CRUDOS tal como los
//     devuelve Firestore, sin pasarlos por JavaScript: un `17000` entero que
//     vuelve como `doubleValue` ya no es el mismo dato, y el dinero no se
//     redondea de camino a su propia reparación.
//
// La clave de la semana y el nombre del documento salen de `src/App.jsx`, no
// tecleados aquí: si la app cambia de criterio, este guion cambia con ella.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/reparar-nomina-0126-s42.cjs             # mide y enseña, no escribe
//   node scripts/reparar-nomina-0126-s42.cjs --escribir  # escribe

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const BASE = '/v1/projects/campo-fosmon/databases/(default)/documents';
const OBRA = '0126';
const ESCRIBIR = process.argv.includes('--escribir');

// A DÓNDE escribe, dicho en voz alta antes de nada. `EMU_HOST=127.0.0.1:8080`
// lo manda al emulador. El 2026-10-09 un guion de migración escribió 270
// documentos en producción porque el destino era el valor por omisión y nadie
// lo leyó: por eso el destino se imprime siempre, aunque sea un ensayo.
const EMU = process.env.EMU_HOST || '';
const http = EMU ? require('http') : https;
const [HOST, PUERTO] = EMU ? EMU.split(':') : ['firestore.googleapis.com', '443'];
console.log(EMU ? `→ EMULADOR ${EMU}\n` : '→ PRODUCCIÓN campo-fosmon\n');

let TOKEN = EMU ? 'owner' : (process.env.ADC_TOKEN || '');
if (!TOKEN) { try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); } catch { /* abajo */ } }
if (!TOKEN) {
  console.error('No hay credencial para hablar con producción.');
  console.error('  gcloud auth application-default print-access-token > /tmp/adc.tok');
  process.exit(2);
}

const llamar = (metodo, ruta, cuerpo) => new Promise((res, rej) => {
  const datos = cuerpo ? JSON.stringify(cuerpo) : null;
  const r = http.request({
    host: HOST, port: Number(PUERTO), path: BASE + ruta, method: metodo,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      ...(datos ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(datos) } : {}),
    },
  }, (resp) => {
    let b = ''; resp.on('data', d => b += d);
    resp.on('end', () => {
      if (resp.statusCode === 404 && metodo === 'GET') return res(null);
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        return rej(new Error(`HTTP ${resp.statusCode} ${metodo} ${ruta}: ${b.slice(0, 300)}`));
      }
      res(b ? JSON.parse(b) : {});
    });
  });
  r.on('error', rej);
  if (datos) r.write(datos);
  r.end();
});

// Firestore REST → JS, sólo para MIRAR. Lo que se escribe no pasa por aquí.
const valor = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return Object.fromEntries(
    Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, valor(x)]));
  return null;
};

// De la app, ejecutadas: cómo se llama la semana y cómo se llama su documento.
const { deApp, SimboloPerdido } = require(path.join(RAIZ, 'scripts/extraer-de-app.cjs'));
let claveSemanaNomina, CLAVE_SIN_SEMANA, rutaSemanaNomina;
try {
  ({ claveSemanaNomina, CLAVE_SIN_SEMANA, rutaSemanaNomina } =
    deApp('claveSemanaNomina', 'CLAVE_SIN_SEMANA', 'rutaSemanaNomina'));
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('Sin el criterio de la app, este guion inventaría el suyo.');
  process.exit(2);
}
const claveDocSemana = (reg) => claveSemanaNomina(reg) || CLAVE_SIN_SEMANA;

const pesos = (n) => '$' + Number(n || 0).toLocaleString('es-MX',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const viejo = await llamar('GET', `/obras/${OBRA}/nomina/historial`);
  const crudas = viejo?.fields?.semanas?.arrayValue?.values || [];
  if (crudas.length === 0) {
    console.error(`El documento viejo de la ${OBRA} está vacío. No hay nada que copiar,`);
    console.error('y que esté vacío no es lo que decía la medición: revisar antes de seguir.');
    process.exit(2);
  }

  // Agrupar por documento de semana, con el criterio de la app. No se da por
  // hecho que las dos cargas son de la S42: se pregunta.
  const porClave = new Map();
  crudas.forEach((cruda, i) => {
    const c = valor(cruda);
    const k = claveDocSemana(c);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push({ cruda, leida: c, i });
  });

  console.log(`Documento viejo de la ${OBRA} — ${crudas.length} carga(s), ` +
              `escrito ${viejo.updateTime}\n`);

  const sub = await llamar('GET', `/obras/${OBRA}/nomina_historial?pageSize=300`);
  const yaEstan = new Set((sub?.documents || []).map(d => d.name.split('/').pop()));
  console.log(`Subcolección: ${[...yaEstan].sort().join(' ') || '(vacía)'}\n`);

  const planes = [];
  for (const [clave, grupo] of porClave) {
    const trabajadores = grupo.reduce((n, g) => n + (g.leida.trabajadores || []).length, 0);
    const dinero = grupo.reduce((n, g) => n + Number(g.leida.totalNomina || 0), 0);
    const etiqueta = `${clave}  ${grupo.length} carga(s) · ${trabajadores} trabajador(es) · ${pesos(dinero)}`;
    if (yaEstan.has(clave)) {
      console.log(`  ${etiqueta}\n      YA ESTÁ en la subcolección — no se toca.`);
      continue;
    }
    console.log(`  ${etiqueta}  → FALTA, se copia`);
    for (const g of grupo) console.log(`        · ${g.leida.archivo || '(sin archivo)'}  ` +
      `${(g.leida.trabajadores || []).length} trab · ${pesos(g.leida.totalNomina)}`);
    planes.push({ clave, grupo });
  }

  if (planes.length === 0) {
    console.log('\nNo falta ninguna semana. Nada que reparar.');
    return;
  }

  if (!ESCRIBIR) {
    console.log(`\nEnsayo. ${planes.length} documento(s) se crearían. Nada se escribió.`);
    console.log('Para escribir: node scripts/reparar-nomina-0126-s42.cjs --escribir');
    return;
  }

  for (const { clave, grupo } of planes) {
    const ruta = rutaSemanaNomina(OBRA, clave);
    const cuerpo = {
      fields: {
        clave: { stringValue: clave },
        actualizado: { stringValue: new Date().toISOString() },
        // Los valores CRUDOS, sin pasar por JavaScript.
        partes: { arrayValue: { values: grupo.map(g => g.cruda) } },
      },
    };
    // `exists=false`: crear, nunca pisar.
    await llamar('PATCH', `/${ruta}?currentDocument.exists=false`, cuerpo);
    console.log(`\nescrito  ${ruta}  (${grupo.length} parte(s))`);
  }

  // Releer y comparar contra lo que se quería dejar, no contra lo que se mandó.
  console.log('\nRelectura:');
  let mal = 0;
  for (const { clave, grupo } of planes) {
    const d = await llamar('GET', `/obras/${OBRA}/nomina_historial/${clave}`);
    const partes = (d?.fields?.partes?.arrayValue?.values || []).map(valor);
    const t = partes.reduce((n, p) => n + (p.trabajadores || []).length, 0);
    const m = partes.reduce((n, p) => n + Number(p.totalNomina || 0), 0);
    const tQ = grupo.reduce((n, g) => n + (g.leida.trabajadores || []).length, 0);
    const mQ = grupo.reduce((n, g) => n + Number(g.leida.totalNomina || 0), 0);
    const bien = partes.length === grupo.length && t === tQ && Math.abs(m - mQ) < 0.005;
    console.log(`  ${clave}  ${partes.length} parte(s) · ${t} trabajador(es) · ${pesos(m)}  ` +
                `${bien ? 'coincide' : `NO COINCIDE (se quería ${grupo.length}/${tQ}/${pesos(mQ)})`}`);
    if (!bien) mal++;
  }

  const despues = await llamar('GET', `/obras/${OBRA}/nomina/historial`);
  const intacto = despues.updateTime === viejo.updateTime;
  console.log(`\nDocumento viejo: ${intacto ? 'INTACTO' : 'CAMBIÓ'} (${despues.updateTime})`);
  if (!intacto) mal++;

  if (mal) { console.error('\nAlgo no quedó como se quería. Revisar antes de cerrar el #81.'); process.exit(1); }
  console.log('\nLa Semana 42 de la 0126 vuelve a estar donde la pantalla la lee.');
})().catch(e => { console.error(e.message || e); process.exit(2); });
