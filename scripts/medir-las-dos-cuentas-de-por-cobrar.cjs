#!/usr/bin/env node
// SOLO LECTURA. Cuánto discrepan HOY las dos cuentas de «por cobrar» que la
// misma pantalla puede publicar sobre la misma obra.
//
// POR QUÉ. El KPI de la pantalla de obra (`estPorCob`, en `calcularKPIsObra`)
// cuenta facturada + aprobada + CUALQUIER COSA que diga «proceso», y lo hace
// sin acentos y en minúsculas. El detector de riesgo `fin_004` —que se pinta
// en esa misma pantalla, pestaña `operacion` / `estimaciones`— cuenta
// `['Facturada','Aprobada'].includes(e.estatus)`: coincidencia exacta y SIN
// «En proceso». El comentario del propio KPI dice que la definición cambió
// («Antes: solo Facturada + Aprobada») y el detector se quedó con la vieja.
//
// Lo que se mide es la diferencia en pesos, obra por obra, con los datos de
// producción de hoy. Un renglón de PENDIENTES que dice «es un defecto
// esperando» no distingue entre «esperando» y «ya pasó»; esto sí.
//
// También se mide, de paso, si existe algún `monto` guardado como TEXTO, que
// es el caso que convierte `(e.monto || 0)` en concatenación de cadenas: tres
// estimaciones de 1500, 2000 y 800 suman "015002000800", o sea $15,002,000,800
// en vez de $4,300.
//
// Uso:
//   export PATH="/opt/homebrew/bin:$PATH"
//   TOKEN=$(gcloud auth application-default print-access-token) \
//     node scripts/medir-las-dos-cuentas-de-por-cobrar.cjs

const PROYECTO = 'campo-fosmon';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN;
if (!TOKEN) {
  console.error('Falta TOKEN. Uso:\n  TOKEN=$(gcloud auth application-default ' +
    'print-access-token) node scripts/medir-las-dos-cuentas-de-por-cobrar.cjs');
  process.exit(2);
}

const MXN = n => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const traer = async (ruta) => {
  const r = await fetch(`${BASE}/${ruta}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} en ${ruta}: ${await r.text()}`);
  return r.json();
};

// Firestore REST devuelve los valores etiquetados. Se desenvuelve lo justo.
const val = (v) => {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = val(x);
    return o;
  }
  return v;
};

// Las dos cuentas, copiadas TAL CUAL de src/App.jsx. No se "mejoran" aquí: lo
// que se quiere medir es la discrepancia que el código tiene hoy.
const _ne = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const porCobrarDelKpi = (ests) => ests.filter(e => {
  const s = _ne(e.estatus);
  return s === 'facturada' || s === 'aprobada' || s.includes('proceso');
}).reduce((t, e) => t + (e.monto || 0), 0);
const porCobrarDelRiesgo = (ests) =>
  ests.filter(e => ['Facturada', 'Aprobada'].includes(e.estatus))
      .reduce((t, e) => t + (e.monto || 0), 0);

// El veredicto de `fin_004` tal cual: lo que importa no son los pesos, es si la
// tarjeta de riesgo se pinta y con qué severidad. Una alerta que no se dispara
// se lee como tranquilidad.
const veredictoFin004 = (total, porCob) => {
  if (total === 0) return 'no evalúa (total 0)';
  const pct = porCob / total * 100;
  if (pct > 70) return `ALTO (${pct.toFixed(0)}%)`;
  if (pct > 50) return `medio (${pct.toFixed(0)}%)`;
  return `no alerta (${pct.toFixed(0)}%)`;
};

(async () => {
  const lista = await traer('obras');
  const obras = (lista?.documents || []).map(d => d.name.split('/').pop()).sort();
  console.log(`\n${obras.length} obras en producción. Las dos cuentas de «por cobrar»:\n`);

  let conDiferencia = 0, sumaDif = 0, montosDeTexto = 0, totalEst = 0, cambiaVeredicto = 0;
  const estatusVistos = new Map();

  for (const obraId of obras) {
    const doc = await traer(`obras/${obraId}/config/estimaciones`);
    const ests = val(doc?.fields?.data) || [];
    if (!Array.isArray(ests) || ests.length === 0) continue;
    totalEst += ests.length;

    for (const e of ests) {
      estatusVistos.set(e.estatus, (estatusVistos.get(e.estatus) || 0) + 1);
      if (typeof e.monto === 'string') {
        montosDeTexto++;
        console.log(`  ⚠ ${obraId}: un monto guardado como TEXTO: ${JSON.stringify(e.monto)}`);
      }
    }

    const a = porCobrarDelKpi(ests);
    const b = porCobrarDelRiesgo(ests);
    const dif = a - b;
    if (dif !== 0) {
      conDiferencia++;
      sumaDif += Math.abs(dif);
      const enProceso = ests.filter(e => _ne(e.estatus).includes('proceso'));
      const total = ests.reduce((t, e) => t + (e.monto || 0), 0);
      console.log(`  ${obraId}  KPI ${MXN(a).padStart(16)}  ·  riesgo ${MXN(b).padStart(16)}` +
        `  ·  difieren en ${MXN(Math.abs(dif))}` +
        (enProceso.length ? `  (${enProceso.length} en proceso)` : ''));
      const vMal = veredictoFin004(total, b);
      const vBien = veredictoFin004(total, a);
      console.log(`        la alerta de riesgo dice «${vMal}»` +
        `, y con la cuenta del KPI diría «${vBien}»` +
        (vMal === vBien ? '  → mismo veredicto' : '  → VEREDICTO DISTINTO'));
      if (vMal !== vBien) cambiaVeredicto++;
    }
  }

  console.log(`\n── Resumen ──`);
  console.log(`  estimaciones leídas: ${totalEst}`);
  console.log(`  obras donde las dos cuentas NO coinciden: ${conDiferencia}`);
  console.log(`  suma de las diferencias: ${MXN(sumaDif)}`);
  console.log(`  obras donde la ALERTA cambia de veredicto: ${cambiaVeredicto}`);
  console.log(`  montos guardados como texto: ${montosDeTexto}` +
    (montosDeTexto === 0 ? '  (el caso de la concatenación es latente, no vivo)' : ''));
  console.log(`  estatus que existen de verdad:`);
  for (const [s, n] of [...estatusVistos].sort((x, y) => y[1] - x[1]))
    console.log(`    ${String(JSON.stringify(s)).padEnd(16)} ${n}`);
  console.log('');
})().catch(e => { console.error(e); process.exit(2); });
