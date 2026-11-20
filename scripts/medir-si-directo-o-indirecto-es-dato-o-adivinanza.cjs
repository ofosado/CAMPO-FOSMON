#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿«N DIRECTOS · M INDIRECTOS» ES UN DATO O ES UNA INFERENCIA?
// ════════════════════════════════════════════════════════════════════════════
//
// LA PREGUNTA. El KPI de Personal publica «N directos · M indirectos» en la
// pantalla principal (`src/App.jsx:13658`), y el reporte de obra lo va a
// imprimir. Antes de imprimirlo hay que saber de dónde sale cada cifra, porque
// el importador de nómina tiene DOS caminos para el tipo de un trabajador
// (`src/App.jsx:22944-22951`):
//
//   DATO       la columna «Tipo (D/I)» del Excel lo dice: 'I' o contiene 'IND'.
//   ADIVINANZA no hay columna, y el tipo se deduce de PALABRAS del puesto:
//              GERENTE, ADMINISTRAT, CONTROL, HSE, COORDINADOR, SUPERINT,
//              SUPERVISOR, INGENIERO, AUX, ESTIMACION, JEFE, ADMIN.
//              Lo que no casa con ninguna cae a 'D' POR OMISIÓN.
//
// Las dos acaban en el mismo campo `tipo`, y desde el campo no se distinguen.
// Una cifra adivinada impresa en un reporte de obra es una cifra inventada con
// pasos intermedios, y en este proyecto eso no se teclea para llenar una
// columna. La pantalla ya la publica sin distinguir; que lleve meses ahí no la
// vuelve cierta: quiere decir que la pantalla también afirma de más.
//
// POR QUÉ NO SE PUEDE LEER LA RESPUESTA DEL CAMPO `tipo`. El importador corre
// en el navegador y lo que guarda es el RESULTADO. El Excel de origen no está
// en Firestore. Así que la procedencia no se lee: se RECONSTRUYE, aplicando a
// cada trabajador guardado las mismas palabras que usó el importador. Si el
// puesto de un trabajador marcado 'I' casa con la lista, ese 'I' es
// INDISTINGUIBLE de una adivinanza. Si NO casa, sólo pudo venir de la columna:
// ninguna otra cosa lo pone en 'I'.
//
// Esa asimetría es lo que hace la medición posible, y también su límite, que se
// dice y no se esconde:
//
//   · un 'I' que NO casa  →  la columna existía. Es DATO, con certeza.
//   · un 'I' que SÍ casa  →  pudo ser columna o pudo ser palabra. INDISTINTO.
//   · una semana sin ningún 'I' que no case  →  no se puede afirmar que haya
//     tenido columna. Se cuenta como SIN EVIDENCIA DE COLUMNA, que no es lo
//     mismo que «adivinada»: es «no se puede saber», y por eso va aparte.
//
// Lo que NO se hace es contar «indistinto» como dato. En duda, no cuenta.
//
// SÓLO LECTURA. No escribe en Firestore ni en disco. Lee la nómina por los dos
// caminos que existen hoy —la subcolección `nomina_historial`, que es de donde
// leen las obras migradas, y el documento viejo `nomina/historial`— porque una
// obra puede tener uno, el otro o los dos (ver #28b).
//
// LO QUE SALIÓ, medido en producción el 2026-11-19 (9 obras, 6 con nómina):
//
//   · Por OBRA las seis salen DATO. Ese número no sirve para decidir: basta un
//     desacuerdo en una semana de febrero para probar que la columna existió
//     alguna vez, y el reporte no imprime febrero.
//   · Por SEMANA —que es como se imprime— 40 de 67 traen evidencia propia de
//     columna. 21 son SOSPECHOSAS de inferencia y 6 indistintas.
//   · La semana que el reporte imprimiría hoy es dato en 5 obras de 6. En la
//     0114 (Y2026-S46, 22 trabajadores) no se puede afirmar.
//   · NO hay frontera limpia en el tiempo. Las sospechosas arrancan en la S36
//     de 2026 en cinco obras, pero después de la S36 todavía hay 22 semanas con
//     evidencia —la 0114 tiene la S37 con columna entre S36 y S38 sin ella—.
//     Así que no se puede escribir «desde tal fecha se infiere»: la columna va y
//     viene por archivo. La procedencia hay que comprobarla en la semana que se
//     está imprimiendo, cada vez.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/medir-si-directo-o-indirecto-es-dato-o-adivinanza.cjs --prod
//
// Salidas: 0 la semana impresa es dato en todas las obras · 1 en alguna no lo
// es · 2 no arrancó.

'use strict';

const fs = require('fs');
const https = require('https');
const http = require('http');

const P = 'campo-fosmon';
const { resolverDestino } = require('./destino.cjs');
const destino = resolverDestino({
  escribe: 'nada: sólo lee la nómina para saber de dónde sale el tipo D/I',
  soloLectura: true,
  projectIdProd: P,
});

const [EMU_HOST, PUERTO] = destino.emulador
  ? (() => { const [h, p] = String(destino.emulador).split(':'); return [h, p]; })()
  : [null, null];
const EMU_PORT = Number(PUERTO || 8080);
const BASE = `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN = null;
if (!EMU_HOST) {
  try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
  catch {
    console.error('NO ARRANCÓ: falta /tmp/adc.tok — corre');
    console.error('  gcloud auth application-default print-access-token > /tmp/adc.tok');
    process.exit(2);
  }
}

const pedirA = (mod, opciones) => new Promise((res, rej) => {
  const r = mod.request(opciones, resp => {
    const trozos = [];
    resp.on('data', d => trozos.push(Buffer.from(d)));
    resp.on('end', () => {
      const b = Buffer.concat(trozos).toString('utf8');
      if (resp.statusCode >= 200 && resp.statusCode < 300) return res(b ? JSON.parse(b) : {});
      if (resp.statusCode === 404) return res(null);
      rej(new Error(`${opciones.method} ${opciones.path} → ${resp.statusCode}\n${b.slice(0, 300)}`));
    });
  });
  r.on('error', rej);
  r.end();
});

const get = (ruta) => EMU_HOST
  ? pedirA(http, { host: EMU_HOST, port: EMU_PORT, path: BASE + ruta, method: 'GET',
      headers: { Authorization: 'Bearer owner' } })
  : pedirA(https, { host: 'firestore.googleapis.com', path: BASE + ruta, method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P } });

// ── Lectura de valores crudos de Firestore ──────────────────────────────────
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

// ── LA SEMANA LA AGRUPA LA APP, NO ESTE GUION ───────────────────────────────
//
// La primera versión de esta medición contaba una semana por DOCUMENTO de
// Firestore, y por eso informó 99 semanas donde la pantalla enseña bastantes
// menos: salían `Y2026-S36` y `Semana 36` como dos semanas distintas siendo la
// misma, con los mismos 143 trabajadores. Dos errores en uno:
//
//   · La semana de calendario se arma UNIENDO cargas (`semanasDeNomina`,
//     `src/App.jsx:6340`): una semana que llegó en dos archivos es UNA semana.
//     Juzgar las mitades por separado puede llamar «sospechosa» a la mitad sin
//     evidencia de una semana que, unida, sí la tiene.
//   · Las dos fuentes NO se suman. Una bandera en `config/info` dice cuál
//     manda (`formatoHistorial`, `src/App.jsx:6538`) y la app lee ESA
//     (`src/App.jsx:29279-29288`). Leer las dos y concatenarlas mide una obra
//     que no existe.
//
// Así que la cuenta no se vuelve a teclear aquí: se EXTRAE de `src/App.jsx` y
// se EJECUTA. Copiarla sería comprobar la medición contra mi propia idea de
// cómo agrupa la app, que es justo lo que ya falló una vez.
//
// Y la petición va por `deApp`, no con un bloque de Babel propio —que es lo que
// este guion tenía y `prueba-herramientas-de-medicion-viven.cjs` puso en rojo—.
// Pasando por el portón, estos siete nombres quedan escritos en una llamada que
// la suite lee y ejercita en cada corrida: si alguien renombra
// `semanasDeNomina`, sale en rojo ese día y no el día que alguien vuelva a
// medir y crea el número que salga.
const { deApp } = require('./extraer-de-app.cjs');
const DEL_APP = deApp('semanaISO', 'heImporte', 'numSemanaNomina',
  'fechaCargaNomina', 'añoSemanaNomina', 'claveSemanaNomina', 'semanasDeNomina',
  'formatoHistorial', 'FORMATO_HISTORIAL_SUBCOLECCION',
  'TAGS_INDIRECTO', 'tipoDeTrabajador', 'procedenciaDI');

// Lo que el importador habría inferido para este trabajador SIN columna D/I.
//
// La regla NO se copia aquí. Antes sí: estaban las doce palabras tecleadas y un
// portón que comprobaba que siguieran siendo las de `src/App.jsx`. Se volvió
// innecesario el 2026-11-19, cuando la regla salió de dentro del importador a
// `tipoDeTrabajador`, de nivel superior: ahora se extrae y se EJECUTA, que es
// lo que el portón intentaba aproximar. Una lista menos que pueda separarse.
//
// Se le pasa `''` como tipo crudo A PROPÓSITO: es la pregunta «qué habría dicho
// la regla si la columna no estuviera», que es justo la reconstrucción. Pasarle
// el tipo guardado devolvería el tipo guardado y la medición se comprobaría
// contra sí misma.
const adivinariaIndirecto = (t) =>
  DEL_APP.tipoDeTrabajador('', t.categoria, t.clasif).tipo === 'I';

// ── Obras ───────────────────────────────────────────────────────────────────
const todasLasObras = async () => {
  const out = [];
  for (const d of ((await get('/obras?pageSize=300'))?.documents || []))
    out.push({ id: d.name.split('/').pop(), prefijo: '' });
  for (const o of ((await get('/orgs?pageSize=50'))?.documents || [])) {
    const oid = o.name.split('/').pop();
    for (const d of ((await get(`/orgs/${oid}/obras?pageSize=300`))?.documents || []))
      out.push({ id: d.name.split('/').pop(), prefijo: `orgs/${oid}/`, org: oid });
  }
  return out;
};

// LAS CARGAS DE NÓMINA DE UNA OBRA, POR LA FUENTE QUE LA APP LEE DE VERDAD.
//
// Devuelve el arreglo de CARGAS en crudo —no de semanas—, que es lo que los dos
// oyentes de la app ponen en el estado (`src/App.jsx:29360-29368`):
//
//   subcolección   cada documento trae `partes[]`; las partes SON las cargas.
//                  La semana vive en la parte (`semana`, `fecha`), no en el id
//                  del documento. Leerlo de la raíz daba «ninguna semana con
//                  listado» en las cinco obras: la clase de cero que este
//                  repositorio no deja pasar por medición.
//   documento viejo el campo `semanas[]`, y nada más. Antes aceptaba cualquier
//                  objeto de cualquier campo, que es cómo entraron semanas
//                  fantasma a la cuenta.
//
// Cuál de las dos, lo dice la bandera, igual que en la app: nunca las dos.
const cargasDeNomina = async (o) => {
  const info = campos(await get(`/${o.prefijo}obras/${o.id}/config/info`));
  const usaSub = DEL_APP.formatoHistorial(info, 'nomina')
    === DEL_APP.FORMATO_HISTORIAL_SUBCOLECCION;

  if (usaSub) {
    const cargas = [];
    let tok = null;
    do {
      const q = `?pageSize=300${tok ? `&pageToken=${encodeURIComponent(tok)}` : ''}`;
      const r = await get(`/${o.prefijo}obras/${o.id}/nomina_historial${q}`);
      if (!r) break;
      for (const d of (r.documents || [])) {
        const p = campos(d)?.partes;
        if (Array.isArray(p)) cargas.push(...p);
      }
      tok = r.nextPageToken || null;
    } while (tok);
    return { cargas, via: 'subcolección' };
  }

  const viejo = await get(`/${o.prefijo}obras/${o.id}/nomina/historial`);
  const s = campos(viejo)?.semanas;
  return { cargas: Array.isArray(s) ? s : [], via: 'documento viejo' };
};

(async () => {
  const obras = await todasLasObras();
  console.log(`\n${obras.length} obra(s) en total.\n`);
  console.log('─'.repeat(78));

  const filas = [];
  let sinNomina = 0;

  for (const o of obras) {
    const { cargas, via } = await cargasDeNomina(o);
    if (!cargas.length) { sinNomina++; continue; }
    // Aquí es donde las cargas se vuelven SEMANAS, y lo hace la app.
    const semanas = DEL_APP.semanasDeNomina(cargas);
    if (!semanas.length) { sinNomina++; continue; }

    let trabs = 0, conI = 0, iQueNoCasa = 0, iQueCasa = 0;
    let dQueCasaria = 0, sinPuesto = 0, conDesgloseSolo = 0, semanasConListado = 0;

    // LA PREGUNTA SE CONTESTA POR SEMANA, NO POR OBRA. El reporte imprime la
    // plantilla de UNA semana —la última—, así que un agregado de la obra puede
    // decir «aquí hubo columna» por semanas de hace meses mientras la semana
    // que se va a imprimir no la trae. Lo que decide qué se imprime es la
    // procedencia de ESA semana.
    const porSemana = [];

    for (const s of semanas) {
      const lista = Array.isArray(s.trabajadores) ? s.trabajadores : [];
      const clave = s.clave || '(semana ilegible)';
      const traeDesglose = typeof s.totalDir === 'number' && typeof s.totalInd === 'number';
      if (!lista.length) {
        // Semana con desglose (`totalDir`/`totalInd`) pero sin listado nominal:
        // la cifra existe y su procedencia no se puede reconstruir desde aquí.
        if (traeDesglose) conDesgloseSolo++;
        porSemana.push({ clave, trabs: 0, evid: 0, soloDesglose: traeDesglose,
          partes: s.partes?.length || 1 });
        continue;
      }
      semanasConListado++;
      let eT = 0, eI = 0, eNoCasa = 0, eCasa = 0, eD = 0;
      for (const t of lista) {
        trabs++; eT++;
        const tipo = String(t?.tipo || '');
        const casa = adivinariaIndirecto(t || {});
        if (!String((t?.categoria || '') + (t?.clasif || '')).trim()) sinPuesto++;
        if (tipo === 'I') {
          conI++; eI++;
          if (casa) { iQueCasa++; eCasa++; } else { iQueNoCasa++; eNoCasa++; }
        } else if (casa) {
          // Marcado DIRECTO y la palabra habría dicho indirecto: esto SÓLO pasa
          // si la columna existía y dijo 'D'. Es evidencia de columna, igual de
          // fuerte que un 'I' que no casa, y por el otro lado.
          dQueCasaria++; eD++;
        }
      }
      porSemana.push({ clave, trabs: eT, evid: eNoCasa + eD, soloDesglose: false,
        partes: s.partes?.length || 1 });
    }

    const evidenciaDeColumna = iQueNoCasa + dQueCasaria;
    const conListado = porSemana.filter(s => s.trabs > 0);
    const semanasSinEvidencia = conListado.filter(s => s.evid === 0);
    filas.push({ ...o, via, semanas: semanas.length, semanasConListado, conDesgloseSolo,
      trabs, conI, iQueCasa, iQueNoCasa, dQueCasaria, evidenciaDeColumna, sinPuesto,
      porSemana, semanasSinEvidencia });
  }

  const nombre = (f) => `${f.prefijo ? f.org + '/' : ''}${f.id}`;

  // ── TRES ESTADOS POR SEMANA, PORQUE «SIN EVIDENCIA» ESCONDE DOS COSAS ─────
  //
  // Una semana sin un solo desacuerdo entre el tipo guardado y lo que la
  // palabra habría dicho significa que la regla predice la semana ENTERA. Y eso
  // se lee de dos maneras opuestas según el tamaño:
  //
  //   2 trabajadores y ningún desacuerdo  →  casualidad corriente. INDISTINTO.
  //   143 trabajadores y ningún desacuerdo → que una columna escrita a mano
  //        coincida 143 de 143 veces con doce palabras no es plausible. Lo
  //        plausible es que la columna NO estuviera y la regla se aplicara.
  //        SOSPECHOSA de inferencia.
  //
  // El umbral no se pone a ojo: con 30 trabajadores, si la columna existiera y
  // discrepara de la regla aunque sea el 5% de las veces, la probabilidad de
  // cero desacuerdos es 0.95^30 ≈ 21%; con 60 baja a 4.6%. Se toma 40 como el
  // punto donde «ningún desacuerdo» deja de ser casualidad corriente, y se dice
  // el número para que se pueda discutir en vez de creer.
  const UMBRAL_SOSPECHA = 40;
  const estadoDeSemana = (s) => {
    if (s.trabs === 0) return s.soloDesglose ? 'solo-desglose' : 'vacia';
    if (s.evid > 0) return 'dato';
    return s.trabs >= UMBRAL_SOSPECHA ? 'sospechosa' : 'indistinta';
  };
  for (const f of filas) {
    f.est = { dato: [], sospechosa: [], indistinta: [] };
    for (const s of f.porSemana) {
      const e = estadoDeSemana(s);
      if (f.est[e]) f.est[e].push(s);
    }
  }

  console.log('\nOBRA               semanas  trabs   I   evidencia de columna   veredicto');
  console.log('─'.repeat(78));

  let esDato = 0, noSePuede = 0;
  for (const f of filas.sort((a, b) => b.trabs - a.trabs)) {
    const ok = f.evidenciaDeColumna > 0;
    if (f.trabs === 0) { noSePuede++; }
    else if (ok) esDato++; else noSePuede++;
    const ver = f.trabs === 0 ? 'SIN LISTADO — no se puede saber'
      : ok ? 'DATO (la columna existía)'
           : 'NO SE PUEDE AFIRMAR — indistinto';
    console.log(`${nombre(f).padEnd(18)} ${String(f.semanas).padStart(5)}  ` +
      `${String(f.trabs).padStart(6)} ${String(f.conI).padStart(4)}   ` +
      `${String(f.evidenciaDeColumna).padStart(6)}               ${ver}`);
  }

  console.log('\n' + '─'.repeat(78));
  console.log('DETALLE DE LA RECONSTRUCCIÓN\n');
  for (const f of filas.sort((a, b) => b.trabs - a.trabs)) {
    if (!f.trabs) {
      console.log(`${nombre(f)}: ${f.semanas} semana(s), ninguna con listado nominal` +
        `${f.conDesgloseSolo ? ` (${f.conDesgloseSolo} sólo con desglose Dir/Ind)` : ''}.`);
      continue;
    }
    console.log(`${nombre(f)}: ${f.trabs} trabajador(es) en ${f.semanasConListado} semana(s) ` +
      `con listado  (fuente que lee la app: ${f.via}).`);
    console.log(`   marcados INDIRECTO: ${f.conI}` +
      `  ·  de esos, ${f.iQueNoCasa} NO casan con ninguna palabra (sólo pudo decirlo la columna)` +
      `  ·  ${f.iQueCasa} sí casan (indistinto)`);
    console.log(`   marcados DIRECTO con puesto que la palabra habría llamado indirecto: ${f.dQueCasaria}` +
      `  (también es evidencia de columna)`);
    if (f.sinPuesto)
      console.log(`   ${f.sinPuesto} sin categoría ni clasificación: para esos la palabra no tenía nada que leer`);
    if (f.conDesgloseSolo)
      console.log(`   ${f.conDesgloseSolo} semana(s) traen sólo el desglose, sin listado: su procedencia no se reconstruye`);
    // Las semanas SUELTAS sin evidencia: son las que, impresas de una en una,
    // no se distinguen de una inferencia aunque la obra entera sí tenga columna.
    if (f.semanasSinEvidencia.length) {
      console.log(`   ⚠ ${f.semanasSinEvidencia.length} de ${f.semanasConListado} semana(s) con listado NO traen evidencia propia de columna:`);
      console.log(`      ${f.semanasSinEvidencia.map(s => `${s.clave} (${s.trabs} trab)`).join(', ')}`);
    } else {
      console.log(`   las ${f.semanasConListado} semana(s) con listado traen evidencia propia de columna`);
    }
  }

  console.log('\n' + '─'.repeat(78));
  console.log(`RESULTADO: en ${esDato} obra(s) la cifra es DATO; en ${noSePuede} NO se puede afirmar.`);
  console.log(`${sinNomina} obra(s) no tienen nómina.`);

  const totSem = filas.reduce((t, f) => t + f.semanasConListado, 0);
  const totSin = filas.reduce((t, f) => t + f.semanasSinEvidencia.length, 0);
  console.log('');
  console.log(`POR SEMANA, que es como se imprime: ${totSem - totSin} de ${totSem} semana(s) con`);
  console.log(`listado traen evidencia propia de columna. ${totSin} no la traen.`);

  console.log('\n' + '─'.repeat(78));
  console.log(`LOS TRES ESTADOS POR SEMANA (umbral de sospecha: ${UMBRAL_SOSPECHA} trabajadores)\n`);
  const tot = { dato: 0, sospechosa: 0, indistinta: 0 };
  for (const f of filas) {
    for (const k of Object.keys(tot)) tot[k] += f.est[k].length;
    console.log(`${nombre(f).padEnd(16)} dato ${String(f.est.dato.length).padStart(3)}  ·  ` +
      `SOSPECHOSA de inferencia ${String(f.est.sospechosa.length).padStart(3)}  ·  ` +
      `indistinta ${String(f.est.indistinta.length).padStart(3)}`);
    if (f.est.sospechosa.length)
      console.log(`     sospechosas: ${f.est.sospechosa
        .map(s => `${s.clave} (${s.trabs})`).join(', ')}`);
  }
  console.log('');
  console.log(`TOTAL: ${tot.dato} dato · ${tot.sospechosa} SOSPECHOSAS de inferencia · ${tot.indistinta} indistintas`);
  console.log('');
  // ── ¿HAY UNA FRONTERA EN EL TIEMPO? ────────────────────────────────────────
  // Si las sospechosas estuvieran repartidas al azar, serían ruido. Si todas
  // caen a partir de una semana y a partir de ahí NO hay ni una con evidencia,
  // entonces no es ruido: es que el archivo dejó de traer la columna ese día.
  // Eso cambia el defecto de «algunas cifras son flojas» a «desde tal fecha
  // ninguna es dato», que es una frase que se puede ir a arreglar.
  // La clave que entrega la app es "Y2026-S38", así que el orden es por (año,
  // semana) y no por el número suelto: una S02 de 2027 va DESPUÉS de una S44 de
  // 2026. Una semana sin clave legible (`clave: null`) no entra en la
  // comparación, porque no se sabe dónde ponerla.
  const nSem = (c) => {
    const m = /^Y(\d{4})-S(\d{2})$/.exec(String(c));
    return m ? Number(m[1]) * 100 + Number(m[2]) : null;
  };
  const comoSem = (n) => `S${String(n % 100).padStart(2, '0')} de ${Math.floor(n / 100)}`;
  const conN = [];
  for (const f of filas)
    for (const s of f.porSemana) {
      const n = nSem(s.clave);
      if (n && s.trabs > 0) conN.push({ obra: nombre(f), n, est: estadoDeSemana(s), trabs: s.trabs });
    }
  const sospechosas = conN.filter(s => s.est === 'sospechosa');
  if (sospechosas.length) {
    const primera = Math.min(...sospechosas.map(s => s.n));
    const datoDespues = conN.filter(s => s.n >= primera && s.est === 'dato');
    console.log('─'.repeat(78));
    console.log(`LA FRONTERA: la primera semana sospechosa de todas las obras es la ${comoSem(primera)}.`);
    if (datoDespues.length === 0) {
      console.log(`Y a partir de ahí NO hay NI UNA semana con evidencia de columna,`);
      console.log('en ninguna obra. No es ruido: el archivo dejó de traer la columna «Tipo (D/I)»');
      console.log(`y desde entonces el tipo se INFIERE por el puesto. Las cifras de directos e`);
      console.log('indirectos posteriores a esa semana no son dato en ninguna obra.');
    } else {
      console.log(`Pero DESPUÉS de la ${comoSem(primera)} todavía hay ${datoDespues.length} semana(s) con evidencia:`);
      console.log(`  ${datoDespues.slice(0, 12).map(s => `${s.obra} ${comoSem(s.n)}`).join(', ')}`);
      console.log('Así que no hay una frontera limpia: conviven las dos cosas.');
    }
    console.log('');
  }

  // ── LA SEMANA QUE SE VA A IMPRIMIR ────────────────────────────────────────
  //
  // Todo lo de arriba describe el historial. Pero el reporte no imprime el
  // historial: imprime UNA semana, la última. Así que la pregunta que decide si
  // el KPI de nómina sale al papel es ésta, y es la única fila que hay que leer
  // para contestarla. `semanasDeNomina` ya devuelve ordenado por calendario
  // (`src/App.jsx:6384`), así que la última del arreglo es la última semana.
  console.log('─'.repeat(78));
  console.log('LA SEMANA QUE EL REPORTE IMPRIMIRÍA HOY (la última de cada obra)\n');
  const ETIQ = {
    dato: 'DATO — la columna existía: se imprime',
    sospechosa: 'SOSPECHOSA de inferencia — NO se imprime como dato',
    indistinta: 'INDISTINTA — no se puede afirmar',
    'solo-desglose': 'sólo desglose, sin listado — no se reconstruye',
    vacia: 'sin listado ni desglose',
  };
  const ult = { dato: 0, otras: 0 };
  for (const f of filas) {
    const u = f.porSemana[f.porSemana.length - 1];
    if (!u) continue;
    const e = estadoDeSemana(u);
    if (e === 'dato') ult.dato++; else ult.otras++;
    console.log(`${nombre(f).padEnd(16)} ${String(u.clave).padEnd(12)} ` +
      `${String(u.trabs).padStart(4)} trab   ${ETIQ[e] || e}`);
  }
  console.log('');
  console.log(`En ${ult.dato} de ${ult.dato + ult.otras} obra(s) la ÚLTIMA semana es dato. ` +
    `En ${ult.otras} no lo es.`);
  console.log('');
  console.log('Y esto cambia cada vez que se sube un Excel: una obra que hoy imprime dato');
  console.log('mañana puede imprimir una semana sin columna. Por eso la regla no puede ser');
  console.log('una lista de obras ni una fecha de corte —no hay frontera limpia, arriba se');
  console.log('ve— sino una comprobación de la semana que se está imprimiendo.');
  console.log('');

  console.log('Una semana SOSPECHOSA es una donde la regla de las doce palabras predice el');
  console.log('tipo de TODOS los trabajadores, siendo muchos. Que una columna escrita a mano');
  console.log('coincida 143 de 143 veces con doce palabras no es plausible: lo plausible es');
  console.log('que no hubiera columna y el tipo se infiriera. Esas cifras NO son dato.');
  console.log('');
  console.log('Cómo leer «NO se puede afirmar»: no quiere decir que la cifra sea falsa.');
  console.log('Quiere decir que desde Firestore no se distingue de una inferencia por');
  console.log('palabras del puesto, y una cifra indistinguible de una adivinanza no se');
  console.log('imprime como hecho en un reporte de obra.');
  console.log('');

  // SALE EN 1 POR LA SEMANA QUE SE IMPRIME, NO POR LA OBRA.
  //
  // Al nivel de la obra las seis salen DATO, porque basta un desacuerdo en
  // cualquier semana de cualquier mes para probar que la columna existió alguna
  // vez. Ése es el agregado que engaña: no es el que se imprime. La pregunta
  // que se vino a contestar es si la cifra que va al papel es dato, y hoy en una
  // obra no lo es. Con la salida colgada del agregado, esta medición habría
  // salido en verde el día que todas las semanas impresas fueran adivinanza.
  const noImprimible = ult.otras;
  process.exit(noImprimible > 0 ? 1 : 0);
})().catch(e => { console.error('\nNO ARRANCÓ:', e.message); process.exit(2); });
