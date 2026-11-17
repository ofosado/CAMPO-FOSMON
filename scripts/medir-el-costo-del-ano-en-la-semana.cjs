#!/usr/bin/env node
// ¿CUÁNTO CUESTA PONERLE EL AÑO A LA SEMANA, Y PUBLICAR LOS AÑOS QUE FALTAN?
//
// El #47 tiene dos mitades y sólo una es gratis:
//
//   (a) la clave de la semana no lleva el año (`S47`), así que la S1 de 2026 y
//       la de 2027 son la misma clave. Cambiar la forma de la clave NO cambia
//       cuántas claves hay: cuesta bytes por clave, no claves.
//   (b) sólo se publica el año más reciente (`esAñoVivo`), así que la serie
//       multianual no existe. Quitar esa restricción SÍ multiplica las claves
//       por el número de años que arrastra cada nodo.
//
// Esto NO decide; mide. Lee en producción `global/gp_construct` y los
// documentos de `global/gp_detalle/obras/*`, y contesta tres cosas:
//
//   · qué años arrastra cada obra de verdad (ya están en `años`, que nunca se
//     restringió al año vivo — es la única evidencia que hay sin pedirle a GP
//     los 46,367 renglones otra vez)
//   · cuánto pesa hoy cada documento, y a qué distancia del tope de 1 MiB
//   · cuánto pesaría con (a) sola, y cuánto con (a) y (b) juntas
//
// La proyección de (b) no se inventa: se construye el documento con las claves
// nuevas y se vuelve a serializar. El único supuesto que lleva, y va dicho en
// voz alta, es que un nodo que movió dinero en un año movió dinero en tantas
// semanas de ese año como las que hoy se le ven en el año vivo. Es un supuesto
// GENEROSO a propósito: si el resultado cabe con él, cabe de verdad.
//
// SÓLO LECTURA. No escribe en producción ni en el emulador.
//
// Uso:  gcloud auth application-default print-access-token > /tmp/adc.tok
//       node scripts/medir-el-costo-del-ano-en-la-semana.cjs

'use strict';

const fs = require('fs');
const https = require('https');

const PROYECTO = 'campo-fosmon';
const TOPE = 1048576; // 1 MiB, el tope de un documento de Firestore

let token;
try {
  token = fs.readFileSync('/tmp/adc.tok', 'utf8').trim();
} catch (e) {
  console.error('NO ARRANCÓ — falta /tmp/adc.tok (el de ADC).');
  console.error('  gcloud auth application-default print-access-token > /tmp/adc.tok');
  process.exit(2);
}
if (!token) {
  console.error('NO ARRANCÓ — /tmp/adc.tok está vacío.');
  process.exit(2);
}

const pedir = (ruta) => new Promise((res, rej) => {
  const url = `https://firestore.googleapis.com/v1/projects/${PROYECTO}` +
    `/databases/(default)/documents/${ruta}`;
  https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (r) => {
    let cuerpo = '';
    r.on('data', (d) => { cuerpo += d; });
    r.on('end', () => {
      if (r.statusCode === 404) return res(null);
      if (r.statusCode !== 200) return rej(new Error(`HTTP ${r.statusCode} en ${ruta}: ${cuerpo.slice(0, 200)}`));
      try { res(JSON.parse(cuerpo)); } catch (err) { rej(err); }
    });
  }).on('error', rej);
});

// Firestore REST devuelve valores envueltos. Se desenvuelve lo justo.
const plano = (v) => {
  if (v == null) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const o = {};
    for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = plano(x);
    return o;
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plano);
  return null;
};
const campos = (doc) => {
  const o = {};
  for (const [k, v] of Object.entries((doc && doc.fields) || {})) o[k] = plano(v);
  return o;
};

const bytes = (n) => `${(n / 1024).toFixed(1)} KB`;
const pct = (n) => `${(100 * n / TOPE).toFixed(1)}%`;

// Recorre los nodos que llevan series: la obra, sus rubros, sus proveedores.
function nodosConSeries(obra) {
  const fuera = [{ etiqueta: 'obra', nodo: obra }];
  for (const [nombre, r] of Object.entries(obra.rubros || {})) {
    fuera.push({ etiqueta: `rubro ${nombre}`, nodo: r });
    for (const p of (r.proveedores || [])) fuera.push({ etiqueta: `prov ${p.nombre}`, nodo: p });
  }
  return fuera;
}

(async () => {
  const resumen = campos(await pedir('global/gp_construct'));
  if (!resumen.obras) {
    console.error('NO ARRANCÓ — `global/gp_construct` no trae `obras`.');
    process.exit(2);
  }

  console.log('═══ 1. QUÉ AÑOS ARRASTRA CADA OBRA (de `años`, que nunca se restringió) ═══\n');
  const añosPorObra = {};
  for (const [etiqueta, o] of Object.entries(resumen.obras)) {
    const años = Object.keys(o.años || {}).sort();
    añosPorObra[o.id] = años;
    console.log(`  ${o.id}  ${años.length} año(s): ${años.join(' ') || '(ninguno)'}`);
  }
  const maxAños = Math.max(...Object.values(añosPorObra).map((a) => a.length));
  console.log(`\n  el peor caso son ${maxAños} año(s) en una sola obra`);
  console.log(`  semanasDisponibles hoy: ${(resumen.semanasDisponibles || []).length} clave(s)` +
    `, añoVivo ${resumen.añoVivo}`);

  console.log('\n═══ 2. LO QUE PESAN HOY LOS DOCUMENTOS ═══\n');
  const detalles = [];
  for (const id of Object.keys(añosPorObra).sort()) {
    const d = campos(await pedir(`global/gp_detalle/obras/${id}`));
    if (!d || !d.id) { console.log(`  ${id}  (sin documento de detalle)`); continue; }
    const tam = Buffer.byteLength(JSON.stringify(d));
    detalles.push({ id, d, tam });
    const nodos = nodosConSeries(d);
    const clavesSem = nodos.reduce((t, n) => t + Object.keys(n.nodo.semanas || {}).length, 0);
    const clavesMes = nodos.reduce((t, n) => t + Object.keys(n.nodo.meses || {}).length, 0);
    console.log(`  ${id}  ${bytes(tam)} (${pct(tam)} del tope) · ${nodos.length} nodo(s) con series` +
      ` · ${clavesSem} clave(s) de semana · ${clavesMes} de mes`);
  }
  const tamResumen = Buffer.byteLength(JSON.stringify(resumen));
  console.log(`  gp_construct  ${bytes(tamResumen)} (${pct(tamResumen)} del tope)`);

  console.log('\n═══ 3. (a) SOLA: LA CLAVE LLEVA EL AÑO, MISMAS CLAVES ═══\n');
  // `S47` → `S2026-47`: cinco caracteres más por clave de semana. Se mide
  // reescribiendo las claves de verdad y volviendo a serializar.
  const conAño = (nodo, año) => {
    const fuera = {};
    for (const [k, v] of Object.entries(nodo.semanas || {})) {
      const m = /^S(\d{1,2})$/.exec(k);
      fuera[m ? `S${año}-${String(m[1]).padStart(2, '0')}` : k] = v;
    }
    return fuera;
  };
  for (const { id, d, tam } of detalles) {
    const copia = JSON.parse(JSON.stringify(d));
    for (const { nodo } of nodosConSeries(copia)) nodo.semanas = conAño(nodo, resumen.añoVivo);
    const nuevo = Buffer.byteLength(JSON.stringify(copia));
    console.log(`  ${id}  ${bytes(tam)} → ${bytes(nuevo)}  (+${bytes(nuevo - tam)}, ${pct(nuevo)} del tope)`);
  }

  console.log('\n═══ 4. (a) Y (b): TAMBIÉN LOS AÑOS QUE HOY NO SE PUBLICAN ═══\n');
  console.log('  Supuesto GENEROSO, dicho en voz alta: cada nodo mueve dinero en');
  console.log('  tantas semanas de cada año viejo como las que hoy se le ven en el');
  console.log('  año vivo. Si cabe con esto, cabe de verdad.\n');
  for (const { id, d, tam } of detalles) {
    const copia = JSON.parse(JSON.stringify(d));
    const años = (añosPorObra[id] || []).map((k) => Number(String(k).replace(/^Y/, '')))
      .filter(Number.isInteger).sort();
    for (const { nodo } of nodosConSeries(copia)) {
      const vivas = Object.entries(nodo.semanas || {});
      const vivosMeses = Object.entries(nodo.meses || {});
      const sem = {}, mes = {};
      for (const año of años) {
        // Un año en el que ESE nodo no movió dinero no inventa claves.
        if (!(nodo.años || {})[`Y${año}`]) continue;
        for (const [k, v] of vivas) {
          const m = /^S(\d{1,2})$/.exec(k);
          if (m) sem[`S${año}-${String(m[1]).padStart(2, '0')}`] = v;
        }
        for (const [k, v] of vivosMeses) {
          const m = /^M\d{4}-(\d{2})$/.exec(k);
          if (m) mes[`M${año}-${m[1]}`] = v;
        }
      }
      nodo.semanas = Object.keys(sem).length ? sem : nodo.semanas;
      nodo.meses = Object.keys(mes).length ? mes : nodo.meses;
    }
    const nodos = nodosConSeries(copia);
    const clavesSem = nodos.reduce((t, n) => t + Object.keys(n.nodo.semanas || {}).length, 0);
    const nuevo = Buffer.byteLength(JSON.stringify(copia));
    const cabe = nuevo < TOPE;
    console.log(`  ${id}  ${bytes(tam)} → ${bytes(nuevo)}  (×${(nuevo / tam).toFixed(1)}, ` +
      `${pct(nuevo)} del tope) · ${clavesSem} clave(s) de semana · ${cabe ? 'cabe' : 'NO CABE'}`);
  }

  console.log('\n═══ 5. LA FORMA MIXTA: QUÉ PASA CON LA OBRA ARRASTRADA ═══\n');
  // El arrastre copia el `semanas` del documento ANTERIOR (forma vieja) al
  // documento nuevo (forma nueva). Eso es lo que decide si hace falta
  // traducir al arrastrar, y es conducta, no estética.
  console.log(`  obrasArrastradas en la última corrida: ` +
    `${JSON.stringify(resumen.obrasArrastradas || [])}`);
  console.log(`  obrasConError:                        ` +
    `${JSON.stringify((resumen.obrasConError || []).map((f) => f && f.clave))}`);
  console.log(`  obrasPedidas:                         ` +
    `${JSON.stringify(resumen.obrasPedidas || [])}`);
  console.log('\n  Si una obra se arrastra, su `semanas` viene del documento viejo.');
  console.log('  Con la clave nueva en las demás, sus claves no coincidirían con');
  console.log('  ninguna de `semanasDisponibles` → la pantalla leería 0, que es una');
  console.log('  cifra, no un hueco. Hay que traducir al arrastrar.');
})().catch((e) => {
  console.error(`NO ARRANCÓ — ${e.message}`);
  process.exit(2);
});
