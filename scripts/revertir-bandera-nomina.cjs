#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA SALIDA: DEVOLVER LA NÓMINA AL DOCUMENTO VIEJO
// ════════════════════════════════════════════════════════════════════════════
//
// Baja `config/info.formatoHistorial.nomina` de 2 a 1. La app vuelve a leer
// `obras/{id}/nomina/historial` en la siguiente carga de pantalla. **No hace
// falta desplegar código**: la bandera es dato, no build, y el camino de
// lectura del formato 1 sigue vivo y probado.
//
// ── Lo que hay que entender antes de usarlo ─────────────────────────────────
//
// La escritura **no es dual**. `escribirHistorialNomina` escribe en UN
// formato, el que diga la bandera (`src/App.jsx`). Con la bandera en 2 una
// nómina nueva entra SOLO a la subcolección y el documento viejo se queda
// donde estaba.
//
// De ahí sale la única regla que importa:
//
//   Revertir es gratis mientras nadie haya capturado nómina después del
//   despliegue. En cuanto alguien captura, bajar la bandera a secas esconde
//   esa captura: sigue guardada en la subcolección, pero la pantalla deja de
//   enseñarla, y en nómina nadie nota una semana que no sabe que existe.
//
// Por eso este guion **no baja la bandera a ciegas**. Compara primero, y si
// la subcolección tiene algo que el documento viejo no tiene, se planta y
// dice qué es. Para bajarla igual hay que pedirlo con `--reconciliar`, que
// copia la subcolección al documento viejo ANTES de bajarla.
//
// El caso peor es el documento viejo ya vaciado a mano (el último paso de la
// migración). Ahí revertir dejaría la pantalla en cero semanas, y el guion lo
// trata como bloqueo, no como aviso.
//
// ── Uso ─────────────────────────────────────────────────────────────────────
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/revertir-bandera-nomina.cjs                 # ensayo, todas
//   node scripts/revertir-bandera-nomina.cjs --obra 0114     # ensayo, una
//   node scripts/revertir-bandera-nomina.cjs --escribir      # revertir
//   node scripts/revertir-bandera-nomina.cjs --escribir --reconciliar
//
// Sin `--escribir` no toca nada: lee, compara y dice qué haría.

'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');
const { AÑOS } = require(path.join(__dirname, 'migracion-nomina-anios.cjs'));

const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

const args = process.argv.slice(2);
const ESCRIBIR = args.includes('--escribir');
const RECONCILIAR = args.includes('--reconciliar');
const iObra = args.indexOf('--obra');
const OBRAS = iObra >= 0 && args[iObra + 1] ? [args[iObra + 1]] : Object.keys(AÑOS);

let TOKEN;
try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
catch { console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`'); process.exit(1); }

// El cuerpo se junta en BUFFERS y se decodifica al final. Ver PENDIENTES,
// «El transporte que decodificaba a medias»: concatenar strings parte los
// caracteres UTF-8 en la frontera de los paquetes.
const juntarCuerpo = (resp, listo) => {
  const trozos = [];
  resp.on('data', d => trozos.push(Buffer.from(d)));
  resp.on('end', () => listo(Buffer.concat(trozos).toString('utf8')));
};

const pedir = (metodo, ruta, cuerpo) => new Promise((res, rej) => {
  const r = https.request({
    host: 'firestore.googleapis.com', path: BASE + ruta, method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P,
               ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
  }, resp => juntarCuerpo(resp, b => {
    if (resp.statusCode === 200) return res(JSON.parse(b));
    if (resp.statusCode === 404 && metodo === 'GET') return res(null);
    rej(new Error(`${metodo} ${ruta} → ${resp.statusCode}\n${b.slice(0, 400)}` +
      (resp.statusCode === 401 || resp.statusCode === 403
        ? '\nSuele ser el token vencido: `gcloud auth application-default print-access-token > /tmp/adc.tok`'
        : '')));
  }));
  r.on('error', rej);
  if (cuerpo) r.write(JSON.stringify(cuerpo));
  r.end();
});

const deValor = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) return deCampos(v.mapValue);
  return null;
};
const deCampos = (d) => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, deValor(v)]));

const aValor = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter(x => x !== undefined).map(aValor) } };
  if (typeof v === 'object') return { mapValue: { fields: aCampos(v) } };
  throw new Error(`Tipo que no sé escribir: ${typeof v}`);
};
const aCampos = (o) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, aValor(v)]));

const MXN = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');

// ── La comparación ──────────────────────────────────────────────────────────
// La misma huella que usa la migración, y por la misma razón: contar no basta.
// Editar una carga o cambiar una por otra deja el mismo número de registros.
const huella = (r) => JSON.stringify([
  String(r?.archivo ?? ''), String(r?.semana ?? ''), String(r?.fecha ?? ''),
  Number(r?.totalNomina) || 0, (r?.trabajadores || []).length,
]);
const nombrar = (r) => `«${r?.archivo || 'sin archivo'}» (semana «${r?.semana ?? '?'}», ` +
  `${(r?.trabajadores || []).length} trab, ${MXN(r?.totalNomina)})`;

// Qué dejaría de verse si la bandera bajara AHORA. Va aparte de la red para
// poder probarla: es la parte que decide, y la que nadie debería improvisar
// leyendo la consola de Firebase a las dos de la mañana.
//
// Devuelve `null` si revertir es inocuo. Si no, un objeto con el motivo y el
// detalle. `vacio` se distingue del resto porque no se arregla comparando:
// el documento viejo ya se limpió y revertir dejaría la pantalla en cero.
const loQueSePerderia = (viejoRegs, subPartes) => {
  if (subPartes.length > 0 && viejoRegs.length === 0)
    return {
      motivo: 'vacio',
      lineas: [`el documento viejo está VACÍO y la subcolección tiene ${subPartes.length} carga(s).`,
        '  Bajar la bandera dejaría la pantalla en cero semanas de nómina.',
        '  Esto no se revierte con la bandera: hay que copiar la subcolección de vuelta.'],
    };

  const cuenta = (lista) => {
    const m = new Map();
    for (const r of lista) m.set(huella(r), (m.get(huella(r)) || 0) + 1);
    return m;
  };
  const viejo = cuenta(viejoRegs), sub = cuenta(subPartes);
  const soloEnSub = [], soloEnViejo = [];
  for (const r of subPartes) if ((sub.get(huella(r)) || 0) > (viejo.get(huella(r)) || 0)) {
    soloEnSub.push(r); viejo.set(huella(r), (viejo.get(huella(r)) || 0) + 1);
  }
  for (const r of viejoRegs) if ((viejo.get(huella(r)) || 0) > (sub.get(huella(r)) || 0)) {
    soloEnViejo.push(r); sub.set(huella(r), (sub.get(huella(r)) || 0) + 1);
  }

  if (soloEnSub.length === 0) return null;   // lo del viejo que no está en la
                                             // sub reaparece al revertir: no
                                             // se pierde, se recupera.
  const lineas = [
    `la subcolección tiene ${soloEnSub.length} carga(s) que el documento viejo no tiene.`,
    '  Se capturaron después de migrar y dejarían de verse:',
    ...soloEnSub.map(r => `    esconde:  ${nombrar(r)}`),
  ];
  if (soloEnViejo.length)
    lineas.push('  (y estas del viejo no están en la subcolección, reaparecerían:)',
      ...soloEnViejo.map(r => `    reaparece: ${nombrar(r)}`));
  return { motivo: 'divergen', lineas, soloEnSub };
};

const leerViejo = async (obra) => {
  const d = deCampos(await pedir('GET', `/obras/${obra}/nomina/historial`));
  return Array.isArray(d?.semanas) ? d.semanas : [];
};

const leerSub = async (obra) => {
  const r = await pedir('GET', `/obras/${obra}/nomina_historial?pageSize=300`);
  const partes = [];
  for (const d of (r?.documents || [])) {
    const c = deCampos(d);
    if (Array.isArray(c.partes)) partes.push(...c.partes);
  }
  return partes;
};

// ── Programa ────────────────────────────────────────────────────────────────
(async () => {
  console.log(ESCRIBIR
    ? '*** MODO ESCRITURA — esto toca PRODUCCIÓN ***\n'
    : 'Ensayo. No se escribe nada. Agrega --escribir para revertir de verdad.\n');

  let problemas = 0, revertidas = 0;

  for (const obra of OBRAS) {
    const info = deCampos(await pedir('GET', `/obras/${obra}/config/info`));
    const bandera = info?.formatoHistorial?.nomina;
    if (bandera !== 2) {
      console.log(`${obra}  ya lee del documento viejo (bandera ${bandera ?? 'ausente'} = formato 1). Nada que hacer.`);
      continue;
    }

    const viejo = await leerViejo(obra);
    const sub = await leerSub(obra);
    const dineroViejo = viejo.reduce((t, r) => t + (Number(r.totalNomina) || 0), 0);
    const dineroSub = sub.reduce((t, r) => t + (Number(r.totalNomina) || 0), 0);
    console.log(`${obra}  bandera 2 · documento viejo ${viejo.length} carga(s) ${MXN(dineroViejo)}` +
      ` · subcolección ${sub.length} carga(s) ${MXN(dineroSub)}`);

    const riesgo = loQueSePerderia(viejo, sub);

    if (riesgo && !RECONCILIAR) {
      console.log(`  NO SE REVIERTE: ${riesgo.lineas.join('\n  ')}`);
      console.log('  Para revertir igual, copiando antes la subcolección al documento');
      console.log('  viejo:  --escribir --reconciliar');
      problemas++;
      continue;
    }

    if (riesgo) {
      console.log(`  Reconciliando: ${riesgo.motivo === 'vacio' ? 'el documento viejo está vacío' : `${riesgo.soloEnSub.length} carga(s) sólo en la subcolección`}.`);
      console.log('  El documento viejo se reescribe con TODO lo que hay en la subcolección,');
      console.log('  que es la fuente viva mientras la bandera esté en 2.');
      if (!ESCRIBIR) {
        console.log(`  (ensayo: se escribirían ${sub.length} carga(s) ${MXN(dineroSub)})`);
      } else {
        // Con máscara, aunque hoy `semanas` sea la única llave del documento:
        // un PATCH sin máscara reemplaza el documento entero y se llevaría por
        // delante cualquier llave que alguien añada mañana.
        await pedir('PATCH',
          `/obras/${obra}/nomina/historial?updateMask.fieldPaths=semanas`,
          { fields: aCampos({ semanas: sub }) });
        // Releer y comparar contra la subcolección leída otra vez, no contra
        // la variable que se acaba de escribir: dos lecturas distintas o la
        // comparación no vale (PENDIENTES #34).
        const ahoraViejo = await leerViejo(obra);
        const ahoraSub = await leerSub(obra);
        const falta = loQueSePerderia(ahoraViejo, ahoraSub);
        if (falta) {
          console.log('  LA RECONCILIACIÓN NO CUADRÓ. La bandera NO se baja:');
          console.log('  ' + falta.lineas.join('\n  '));
          problemas++;
          continue;
        }
        console.log(`  reconciliado: el documento viejo tiene ya las ${ahoraViejo.length} carga(s).`);
      }
    } else {
      console.log('  revertir es inocuo: el documento viejo tiene todo lo que hay en la subcolección.');
    }

    if (!ESCRIBIR) { console.log('  (ensayo: la bandera no se toca)\n'); continue; }

    // La máscara va ANIDADA, `formatoHistorial.nomina`. Con
    // `updateMask.fieldPaths=formatoHistorial` se reemplaza el mapa entero y
    // se borraría `avance` el día que exista.
    await pedir('PATCH',
      `/obras/${obra}/config/info?updateMask.fieldPaths=formatoHistorial.nomina`,
      { fields: aCampos({ formatoHistorial: { nomina: 1 } }) });

    const despues = deCampos(await pedir('GET', `/obras/${obra}/config/info`));
    if (despues?.formatoHistorial?.nomina !== 1) {
      console.log(`  LA BANDERA NO BAJÓ: sigue en ${despues?.formatoHistorial?.nomina}.`);
      problemas++;
      continue;
    }
    console.log('  bandera = 1. La obra lee otra vez del documento viejo.\n');
    revertidas++;
  }

  console.log('═'.repeat(72));
  console.log(ESCRIBIR
    ? `${revertidas} obra(s) revertida(s) · ${problemas} sin revertir.`
    : `Ensayo terminado · ${problemas} obra(s) no se podrían revertir a secas.`);
  console.log('La subcolección NO se borra: revertir la deja ahí, intacta, para');
  console.log('volver a intentarlo sin migrar de cero.');
  process.exit(problemas ? 1 : 0);
})().catch(e => { console.error('\n' + (e?.stack || e)); process.exit(1); });
