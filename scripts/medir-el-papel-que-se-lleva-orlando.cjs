#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL PAPEL QUE SE LLEVA ORLANDO, CON LOS DATOS DE VERDAD — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. El informe del Art. 73 tiene su banco de pruebas y está verde, pero
// ese banco mide el papel contra una obra ARMADA PARA MEDIRLO: dos partidas que
// suman el contrato al peso, estimaciones con dos estados, tres fotos. Las dos
// obras que Orlando va a abrir en la cita son otra cosa —46 y 73 partidas
// reales, una curva de 5 y 7 meses, cero avance capturado— y un papel puede
// estar verde en su banco y salir ilegible, o con huecos, sobre el dato vivo.
//
// Lo que esto contesta es una sola pregunta: SI ORLANDO APRIETA EL BOTÓN HOY,
// ¿QUÉ SALE EN LA HOJA? No «¿existe el generador?» —existe, está en
// `src/App.jsx:1282`— sino qué dice el papel con lo que hay en producción.
//
// CÓMO. Se lee producción (GET, nada más) por las MISMAS rutas que la app pide
// al entrar a una obra, se arman los insumos como los arma la app —incluida la
// derivación de `subs` desde el catálogo, que es lo que pasa en una obra recién
// sembrada— y se corre el generador DE VERDAD, extraído del archivo, sobre un
// jsPDF de mentira que apunta lo que se manda a la hoja.
//
// LO QUE ESTO NO ES. No es el recorrido del #69. Esto mide el último paso —el
// papel— sin pasar por el navegador ni por el login, porque la cuenta de
// Orlando todavía no tiene contraseña. Las reglas de Firestore ya se midieron
// aparte (`medir-que-ve-la-cuenta-de-demo.cjs`, 29/29). Lo que falta del
// recorrido es la sesión de verdad, y eso no lo puede hacer un guion.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN: la única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-el-papel-que-se-lleva-orlando.cjs --prod
//
//     ... --prod --hoja        imprime la hoja entera, renglón por renglón

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { conJsPDFFalso, textoCorrido } = require('./lienzo-pdf.cjs');

const HOJA = process.argv.includes('--hoja');
const ORG = 'coatzacoalcos';
const OBRAS = ['0128', '0131'];

// ── EL GENERADOR, VIVO ─────────────────────────────────────────────────────
// `evidenciaDeObra` entra porque la forma de la evidencia que el papel espera
// no es la que está en Firestore: la normaliza el lector de la app. Un medidor
// que le pasara los documentos crudos mediría un papel que no existe.
const PEDIDOS = ['generarPDFArt73', 'economiaDeDependencia', 'presentacionDependencia',
  'evidenciaDeObra', 'evidenciaMigrada'];
const { cuerpo, faltan } = fuenteDe(ARCHIVO, PEDIDOS, { tolerante: true });
if (faltan.length) noArranco.sinPrecondicion(
  `faltan en ${ARCHIVO}: ${faltan.join(', ')}`,
  'el generador del informe cambió de nombre o se movió');

let APP;
try {
  APP = new Function('React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
    `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)(...Array(6).fill(() => {}));
} catch (e) {
  noArranco.sinPrecondicion(`no se pudo montar lo extraído de ${ARCHIVO}: ${e.message}`,
    'el cierre transitivo trajo algo que no corre fuera del navegador');
}
const { generarPDFArt73, economiaDeDependencia, presentacionDependencia,
        evidenciaDeObra, evidenciaMigrada } = APP;

// ── LA LECTURA ─────────────────────────────────────────────────────────────
const PROYECTO = 'campo-fosmon';
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) noArranco.sinPrecondicion(
  'falta TOKEN (el de ADC)',
  'TOKEN=$(gcloud auth application-default print-access-token) node ' +
  'scripts/medir-el-papel-que-se-lleva-orlando.cjs --prod');

async function leer(ruta) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'GET',
    headers: DESTINO.prod
      ? { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO }
      : { Authorization: 'Bearer owner' },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const cuerpoErr = (await r.text()).slice(0, 300);
    noArranco.sinPrecondicion(`HTTP ${r.status} en ${ruta}\n${cuerpoErr}`,
      (r.status === 401 || r.status === 403)
        ? 'suele ser el token vencido: vuelve a sacarlo con gcloud'
        : 'la ruta no contestó');
  }
  return r.json();
}

const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

const doc1 = async (ruta) => { const d = await leer(ruta); return d ? campos(d) : null; };
const coll = async (ruta) => {
  const d = await leer(`${ruta}?pageSize=300`);
  return (d?.documents || []).map(x => ({ id: x.name.split('/').pop(), ...campos(x) }));
};

// ── LOS INSUMOS, COMO LOS ARMA LA APP ──────────────────────────────────────
//
// `subs` derivado del catálogo es el camino que de verdad va a correr: las dos
// obras se sembraron con `config/catalogo` y SIN `avance/subs`, así que la
// primera vez que Orlando abra la obra la app las deriva (App.jsx:27327) y las
// escribe. Copiar aquí esa derivación es la única parte de este medidor que no
// sale del archivo, y se marca para que se vea.
const derivarSubs = (cat) => (cat.conceptos || []).map((c, idx) => ({
  id: `${c.clave || c.id || 'C'}__${idx}`,
  sec: c.clave || c.id, sub: c.desc || '(sin descripción)',
  imp: c.importe || 0, n: 1, a: 0, fotos: {},
  cat: c.cat || null, catDesc: c.catDesc || null, ruta: c.ruta || [],
  cant: c.cant || 0, pu: c.pu || 0, unidad: c.unidad || '', cantEjec: 0,
}));

async function insumosDe(obraId) {
  const raiz = `orgs/${ORG}/obras/${obraId}`;
  const base = await doc1(raiz);
  if (!base) noArranco.sinPrecondicion(`${raiz} no existe`,
    'la obra de la demo no está sembrada en este destino');
  const info = await doc1(`${raiz}/config/info`) || {};
  // El merge de la hidratación: `config/info` LE GANA a la raíz (App.jsx:9618).
  const obra = { ...base, ...info, id: obraId };

  const dSubs = await doc1(`${raiz}/avance/subs`);
  const cat = await doc1(`${raiz}/config/catalogo`);
  let subs, deDonde;
  if (dSubs && Array.isArray(dSubs.data) && dSubs.data.length) {
    subs = dSubs.data; deDonde = 'avance/subs (ya escrito)';
  } else if (cat && Array.isArray(cat.conceptos) && cat.conceptos.length) {
    subs = derivarSubs(cat); deDonde = 'derivado de config/catalogo (como lo hará la app)';
  } else {
    subs = []; deDonde = 'NO HAY NI SUBS NI CATÁLOGO';
  }

  const dEst = await doc1(`${raiz}/config/estimaciones`);
  // `estCargadas` es `true` porque la lectura VOLVIÓ. Es la misma semántica que
  // en la app: no significa «hay estimaciones», significa «ya sabemos».
  const estimaciones = (dEst && Array.isArray(dEst.data)) ? dEst.data : [];

  const dHist = await doc1(`${raiz}/avance/historial`);
  const historialAvance = (dHist && Array.isArray(dHist.semanas)) ? dHist.semanas : [];

  const programa = await doc1(`${raiz}/config/programa`);

  const cfgEvid = await doc1(`${raiz}/config/evidencia`);
  const docsEvidencia = evidenciaMigrada(cfgEvid) ? await coll(`${raiz}/evidencia`) : [];
  const evidencia = evidenciaDeObra({ cfgEvidencia: cfgEvid, docsEvidencia, subs });

  return { obra, subs, deDonde, estimaciones, historialAvance, programa,
           cfgEvid, evidencia, cat };
}

// ── LA SALIDA ──────────────────────────────────────────────────────────────
const MXN = n => (typeof n !== 'number' || !isFinite(n)) ? '—'
  : '$' + Math.round(n).toLocaleString('en-US');
const hay = s => typeof s === 'string' && s.trim().length > 0;

// Lo que delata un hueco EN LA HOJA. No se buscan campos vacíos en el dato: se
// busca lo que el papel imprimió, que es lo que Orlando va a leer.
const MARCAS_DE_HUECO = ['no capturado', 'sin capturar', 'no se pudo', 'sin dato',
  'no registra', 'todavía no', 'sin medición', '(sin descripción)'];

(async () => {
  console.log('');
  console.log(`EL PAPEL DEL ART. 73 CON DATOS DE VERDAD · ${DESTINO.prod ? 'PRODUCCIÓN' : 'emulador'}`);
  console.log(`org ${ORG} · obras ${OBRAS.join(', ')}`);
  console.log('');

  let huecosTotales = 0, reventonesTotales = 0;

  for (const obraId of OBRAS) {
    const I = await insumosDe(obraId);

    console.log('════════════════════════════════════════════════════════════════');
    console.log(`OBRA ${obraId} · ${I.obra.nombre || '(sin nombre)'}`);
    console.log('');
    console.log('  LO QUE ENTRA AL GENERADOR');
    console.log(`    partidas:           ${I.subs.length}   ← ${I.deDonde}`);
    console.log(`    importe del catálogo: ${MXN(I.subs.reduce((t, s) => t + (s.imp || 0), 0))}`);
    console.log(`    contrato:           ${MXN(I.obra.importeContrato ?? I.obra.presupuesto)}`);
    console.log(`    estimaciones:       ${I.estimaciones.length}`);
    console.log(`    cortes semanales:   ${I.historialAvance.length}`);
    // La curva NO vive en un `montos[]` de primer nivel: vive repartida en
    // `partidas[].montos`, y `meses` dice cuántas columnas tiene. Medirla por
    // un campo que no existe la habría declarado vacía estando completa.
    console.log(`    programa:           ${I.programa
      ? `${I.programa.meses ?? '?'} meses, ${(I.programa.partidas || []).length} partidas, ` +
        `${MXN(I.programa.totalDeclarado)}`
      : 'NO EXISTE'}`);
    console.log(`    evidencia:          ${I.evidencia.length} fotos ` +
      `(config/evidencia.migrada = ${I.cfgEvid ? I.cfgEvid.migrada : '(no existe el doc)'})`);
    console.log('');

    // El corte se fija para que dos corridas del mismo día digan lo mismo. La
    // fuente es `servidor` porque es lo que `pedirHoraDelServidor` devuelve en
    // la app cuando la hora viene de Firestore, y el papel rotula distinto
    // según eso.
    const instante = { ms: Date.now(), fuente: 'servidor' };

    const dibujos = await conJsPDFFalso(() => generarPDFArt73({
      obra: I.obra, subs: I.subs, estimaciones: I.estimaciones, estCargadas: true,
      historialAvance: I.historialAvance, programa: I.programa, instante,
      evidencia: I.evidencia, evidenciaCargada: true,
      organizacion: 'H. Ayuntamiento de Coatzacoalcos',
      generadoPor: 'orlando@cotea.com.mx',
    }));

    const reventones = dibujos.reventones || [];
    if (reventones.length) {
      reventonesTotales += reventones.length;
      console.log('  ⚠ EL GENERADOR AVISÓ:');
      reventones.forEach(m => console.log(`      ${m}`));
      console.log('');
    }

    const corrido = textoCorrido(dibujos);
    const paginas = Math.max(0, ...corrido.map(d => d.pagina || 1));
    console.log(`  LA HOJA: ${paginas} páginas, ${corrido.length} bloques de texto`);
    console.log('');

    // Las cifras de dinero del papel, sacadas de la MISMA función que las
    // resuelve para la pantalla. Si el papel y esto discreparan, el papel
    // estaría formateando por su cuenta.
    const eco = economiaDeDependencia({ obra: I.obra, subs: I.subs,
      estimaciones: I.estimaciones, estCargadas: true });
    const pres = presentacionDependencia(eco);
    console.log('  LAS CIFRAS QUE PUBLICA (vía presentacionDependencia)');
    for (const [k, v] of Object.entries(pres)) {
      if (typeof v === 'string') console.log(`    ${k.padEnd(22)} ${v}`);
    }
    console.log('');

    // Los títulos de sección: dicen qué secciones salieron de verdad, que no es
    // lo mismo que las que el generador tiene escritas — una sección sin dato
    // puede no dibujarse.
    const titulos = corrido
      .filter(d => /^\s*\d\s{1,3}[A-ZÁÉÍÓÚÑ]/.test(d.texto || ''))
      .map(d => `p${d.pagina}  ${d.texto.trim()}`);
    console.log('  LAS SECCIONES QUE SALIERON');
    titulos.forEach(t => console.log(`    ${t}`));
    if (!titulos.length) console.log('    ninguna  ← el papel salió sin títulos de sección');
    console.log('');

    // LOS HUECOS. Lo que el papel imprime cuando no tuvo con qué.
    const huecos = corrido.filter(d => hay(d.texto) &&
      MARCAS_DE_HUECO.some(m => d.texto.toLowerCase().includes(m)));
    huecosTotales += huecos.length;
    console.log(`  LO QUE EL PAPEL DICE QUE NO TIENE: ${huecos.length} renglones`);
    huecos.forEach(d => console.log(`    p${d.pagina}  ${d.texto.trim().slice(0, 110)}`));
    console.log('');

    if (HOJA) {
      console.log('  ── LA HOJA, RENGLÓN POR RENGLÓN ──────────────────────────');
      let pag = 0;
      for (const d of corrido) {
        if (d.pagina !== pag) { pag = d.pagina; console.log(`\n    ── página ${pag} ──`); }
        console.log(`    ${String(d.texto).trim()}`);
      }
      console.log('');
    }
  }

  console.log('════════════════════════════════════════════════════════════════');
  console.log('EN UNA LÍNEA');
  console.log('');
  console.log(`  el generador avisó ${reventonesTotales} veces; el papel declara ` +
    `${huecosTotales} huecos entre las dos obras.`);
  console.log('');
  console.log('  Lo que esto NO prueba: que Orlando pueda apretar el botón. Eso');
  console.log('  necesita sesión, y la cuenta sigue sin contraseña.');
  console.log('');
})();
