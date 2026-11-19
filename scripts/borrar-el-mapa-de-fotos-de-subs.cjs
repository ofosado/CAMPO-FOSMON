#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// QUITAR EL MAPA `fotos` DE `avance/subs` — EL ÚLTIMO PASO DE LA MIGRACIÓN
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ BORRA, EXACTAMENTE. La llave `fotos` de cada partida de
// `obras/{id}/avance/subs → data[]`. Nada más: ni la partida, ni el documento,
// ni un solo objeto de Storage. Las fotos siguen existiendo —se ven por la
// subcolección `obras/{id}/evidencia`, que es de donde la app las lee desde que
// la bandera `config/evidencia.migrada` está arriba—. Lo que desaparece es la
// SEGUNDA copia de la referencia, que ya no alimenta ninguna pantalla.
//
// POR QUÉ HAY QUE QUITARLA Y NO BASTA CON IGNORARLA. Mientras el mapa exista,
// hay dos lugares donde puede vivir la referencia de una foto y sólo uno se
// lee. Eso ya costó cinco semanas de 14 fotos invisibles. Una fuente que nadie
// lee pero que todavía se puede escribir es una trampa, no un respaldo.
//
// ESTO NO SE DEJA DECIDIR POR UNA CORRIDA ANTERIOR. El verificador
// (`verificar-las-fotos-de-subs-son-redundantes.cjs`) ya dijo que se puede, pero
// un veredicto de hace un rato no es una medición de ahora: entre una cosa y la
// otra alguien pudo subir una foto. Así que este guion REHACE el cruce él mismo,
// obra por obra, y si encuentra UNA sola URL que no tenga documento propio en la
// subcolección, no borra NADA de esa obra. El cruce es por RUTA DE STORAGE, no
// por URL entera: el `?alt=media&token=…` no tenía por qué conservarse igual al
// migrar, y comparar URLs completas daría «no está» para fotos que sí están.
//
// TAMPOCO BORRA DE UNA OBRA QUE NO ESTÉ MIGRADA. Si `config/evidencia.migrada`
// no está arriba, la app lee el mapa: quitárselo sería borrarle la galería.
//
// EL RESPALDO ES PARTE DEL BORRADO, NO UN PASO APARTE. Antes de tocar nada
// escribe el documento `avance/subs` ENTERO, tal como viene de Firestore, en
// `~/Desarrollo/CAMPO-datos-produccion/`. Firestore no tiene papelera. Si el
// respaldo no se puede escribir, el guion se para: borrar sin red no es una
// opción que este guion ofrezca.
//
// SE OPERA SOBRE EL JSON CRUDO DE FIRESTORE, no sobre objetos de JavaScript.
// Convertir `{integerValue:"3"}` a `3` y de vuelta puede devolverlo como
// `doubleValue`, y un timestamp mal convertido cambia de tipo en silencio. Aquí
// cada partida se devuelve con sus `fields` intactos, menos la llave `fotos`.
// Lo único que cambia es lo que se quita.
//
// Uso:
//   gcloud auth application-default print-access-token > /tmp/adc.tok
//   node scripts/borrar-el-mapa-de-fotos-de-subs.cjs --prod              (ensayo)
//   node scripts/borrar-el-mapa-de-fotos-de-subs.cjs --prod --escribir   (borra)
//
// Salidas: 0 pudo (o ensayó) · 1 alguna obra quedó sin tocar por el cruce · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const P = 'campo-fosmon';
const { resolverDestino } = require('./destino.cjs');
const destino = resolverDestino({
  escribe: 'quita la llave `fotos` de cada partida de obras/{id}/avance/subs',
  projectIdProd: P,
});

const [EMU_HOST, PUERTO_PEGADO] = destino.emulador
  ? (() => { const [h, p] = String(destino.emulador).split(':'); return [h, p]; })()
  : [null, null];
const EMU_PORT = Number(PUERTO_PEGADO || process.env.EMU_PORT || 8080);
const ESCRIBIR = destino.escribir;
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

// ── Transporte ──────────────────────────────────────────────────────────────
// El cuerpo se junta en BUFFERS y se decodifica UNA vez: concatenar por trozo
// parte los caracteres UTF-8 en la frontera de dos trozos TCP, y aquí hay
// descripciones de partida con acentos en casi cada renglón.
const pedirA = (mod, opciones, cuerpo) => new Promise((res, rej) => {
  const r = mod.request(opciones, resp => {
    const trozos = [];
    resp.on('data', d => trozos.push(Buffer.from(d)));
    resp.on('end', () => {
      const b = Buffer.concat(trozos).toString('utf8');
      if (resp.statusCode >= 200 && resp.statusCode < 300) return res(b ? JSON.parse(b) : {});
      if (resp.statusCode === 404 && opciones.method === 'GET') return res(null);
      rej(new Error(`${opciones.method} ${opciones.path} → ${resp.statusCode}\n${b.slice(0, 400)}` +
        (resp.statusCode === 401 || resp.statusCode === 403
          ? '\nSuele ser el token vencido: `gcloud auth application-default print-access-token > /tmp/adc.tok`'
          : '')));
    });
  });
  r.on('error', rej);
  if (cuerpo) r.write(JSON.stringify(cuerpo));
  r.end();
});

const fs_ = (metodo, ruta, cuerpo) => EMU_HOST
  ? pedirA(http, { host: EMU_HOST, port: EMU_PORT, path: BASE + ruta, method: metodo,
      headers: { Authorization: 'Bearer owner',
                 ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) } }, cuerpo)
  : pedirA(https, { host: 'firestore.googleapis.com', path: BASE + ruta, method: metodo,
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P,
                 ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) } }, cuerpo);

// ── Lectura de valores, sólo para MEDIR (nunca para reescribir) ─────────────
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

// La ruta de Storage, que es lo único estable entre el mapa y la subcolección.
const rutaDeStorage = (s) => {
  const t = String(s || '');
  const m = t.match(/\/o\/([^?]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return m[1]; } }
  return /^https?:\/\//.test(t) ? '' : t;
};

// ── Respaldo ────────────────────────────────────────────────────────────────
// Fuera del árbol del repositorio, a propósito: los volcados de producción no
// se versionan ni se suben por accidente.
// El DESTINO va en el nombre de la carpeta. Una corrida contra el emulador y
// una contra producción dejan archivos con el mismo nombre y pinta idéntica; si
// comparten carpeta, el día que haya que restaurar se elige entre dos y no hay
// forma de saber cuál es cuál. El respaldo que confunde es peor que ninguno.
const DIR = path.join(os.homedir(), 'Desarrollo', 'CAMPO-datos-produccion',
  `subs-antes-de-borrar-el-mapa-${destino.prod ? 'PRODUCCION' : 'emulador'}` +
  `-${new Date().toISOString().slice(0, 10)}`);

const respaldar = (obraId, doc) => {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const f = path.join(DIR, `${obraId}-avance-subs.json`);
  fs.writeFileSync(f, JSON.stringify(doc, null, 2), { mode: 0o600 });
  // Releer y comparar: un respaldo que no se puede volver a leer no es red.
  const vuelta = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (JSON.stringify(vuelta) !== JSON.stringify(doc))
    throw new Error(`el respaldo de ${obraId} no se releyó igual que lo guardado`);
  return f;
};

// ── Obras ───────────────────────────────────────────────────────────────────
const todasLasObras = async () => {
  const out = [];
  for (const d of ((await fs_('GET', '/obras?pageSize=300'))?.documents || []))
    out.push({ id: d.name.split('/').pop(), prefijo: '' });
  for (const o of ((await fs_('GET', '/orgs?pageSize=50'))?.documents || [])) {
    const oid = o.name.split('/').pop();
    for (const d of ((await fs_('GET', `/orgs/${oid}/obras?pageSize=300`))?.documents || []))
      out.push({ id: d.name.split('/').pop(), prefijo: `orgs/${oid}/` });
  }
  return out;
};

// Las rutas de Storage que YA tienen documento propio en la subcolección.
const rutasConDocumento = async (o) => {
  const set = new Set();
  let tok = null;
  do {
    const q = `?pageSize=300${tok ? `&pageToken=${encodeURIComponent(tok)}` : ''}`;
    const r = await fs_('GET', `/${o.prefijo}obras/${o.id}/evidencia${q}`);
    if (!r) break;
    for (const doc of (r.documents || [])) {
      const c = campos(doc);
      for (const cand of [c.rutaStorage, c.urlOriginal, c.url]) {
        const x = rutaDeStorage(cand);
        if (x) set.add(x);
      }
    }
    tok = r.nextPageToken || null;
  } while (tok);
  return set;
};

(async () => {
  const obras = await todasLasObras();
  let tocadas = 0, urlsQuitadas = 0, bloqueadas = 0, sinNada = 0;

  for (const o of obras) {
    const cfg = campos(await fs_('GET', `/${o.prefijo}obras/${o.id}/config/evidencia`));
    const migrada = !!(cfg && cfg.migrada === true);

    const doc = await fs_('GET', `/${o.prefijo}obras/${o.id}/avance/subs`);
    if (!doc || !doc.fields || !doc.fields.data) { sinNada++; continue; }

    const partidas = doc.fields.data.arrayValue?.values || [];
    const conFotos = partidas.filter(p => p?.mapValue?.fields?.fotos);
    if (!conFotos.length) { sinNada++; continue; }

    // Cuántas URLs hay en el mapa, y cuáles son.
    const urls = [];
    for (const p of conFotos) {
      const f = val(p.mapValue.fields.fotos);
      const lista = Array.isArray(f) ? f : Object.values(f || {}).flat();
      for (const foto of lista.filter(Boolean))
        urls.push(typeof foto === 'string' ? foto : (foto.url || foto.src || ''));
    }

    if (!migrada) {
      console.log(`\n${o.id}  NO SE TOCA — la obra no está migrada: la app lee este mapa.`);
      console.log(`      ${urls.length} URL(s) se quedan donde están.`);
      bloqueadas++;
      continue;
    }

    // El cruce, rehecho aquí y ahora. No se le cree a ninguna corrida anterior.
    const conDoc = await rutasConDocumento(o);
    const huerfanas = urls.filter(u => {
      const r = rutaDeStorage(u);
      return !r || !conDoc.has(r);
    });

    if (huerfanas.length) {
      console.log(`\n${o.id}  NO SE TOCA — ${huerfanas.length} de ${urls.length} URL(s) no tienen`);
      console.log(`      documento propio en la subcolección. Borrar sería perderlas.`);
      for (const h of huerfanas.slice(0, 5)) console.log(`        ${rutaDeStorage(h) || h}`);
      if (huerfanas.length > 5) console.log(`        … y ${huerfanas.length - 5} más`);
      bloqueadas++;
      continue;
    }

    console.log(`\n${o.id}  ${urls.length} URL(s) en ${conFotos.length} partida(s), todas con documento propio.`);

    if (!ESCRIBIR) {
      console.log(`      (ensayo: no se escribe nada)`);
      tocadas++; urlsQuitadas += urls.length;
      continue;
    }

    const f = respaldar(o.id, doc);
    console.log(`      respaldo  ${f}`);

    // El array se devuelve con cada partida intacta MENOS la llave `fotos`.
    // Se trabaja sobre el JSON crudo para no cambiar ningún tipo por el camino.
    const nuevas = partidas.map(p => {
      if (!p?.mapValue?.fields?.fotos) return p;
      const campos2 = { ...p.mapValue.fields };
      delete campos2.fotos;
      return { mapValue: { fields: campos2 } };
    });

    await fs_('PATCH',
      `/${o.prefijo}obras/${o.id}/avance/subs?updateMask.fieldPaths=data`,
      { fields: { data: { arrayValue: { values: nuevas } } } });

    // Releer y comprobar sobre lo que QUEDÓ, no sobre lo que se mandó.
    const vuelta = await fs_('GET', `/${o.prefijo}obras/${o.id}/avance/subs`);
    const quedan = (vuelta?.fields?.data?.arrayValue?.values || [])
      .filter(p => p?.mapValue?.fields?.fotos).length;
    const antesSinFotos = partidas.map(p => {
      if (!p?.mapValue?.fields?.fotos) return p;
      const c = { ...p.mapValue.fields }; delete c.fotos;
      return { mapValue: { fields: c } };
    });
    const ahora = vuelta?.fields?.data?.arrayValue?.values || [];
    const igual = JSON.stringify(ahora) === JSON.stringify(antesSinFotos);

    if (quedan) {
      console.log(`      ROJO: quedaron ${quedan} partida(s) con mapa. No se completó.`);
      bloqueadas++;
      continue;
    }
    if (!igual) {
      console.log(`      ROJO: lo que quedó no es lo de antes menos \`fotos\` — cambió algo más.`);
      console.log(`      El respaldo está en ${f}.`);
      bloqueadas++;
      continue;
    }
    console.log(`      hecho: ${urls.length} URL(s) fuera; el resto de cada partida, idéntico.`);
    tocadas++; urlsQuitadas += urls.length;
  }

  console.log('\n' + '─'.repeat(74));
  if (!ESCRIBIR) {
    console.log(`ENSAYO: se quitarían ${urlsQuitadas} URL(s) de ${tocadas} obra(s).`);
    if (bloqueadas) console.log(`${bloqueadas} obra(s) NO se tocarían.`);
    console.log('Para aplicar: agrega `--escribir`.');
  } else {
    console.log(`${urlsQuitadas} URL(s) quitadas de ${tocadas} obra(s). Las fotos siguen en`);
    console.log(`Storage y se leen por la subcolección \`evidencia\`, como desde la migración.`);
    if (bloqueadas) console.log(`${bloqueadas} obra(s) quedaron SIN TOCAR — arriba dice por qué.`);
    if (tocadas) console.log(`Respaldos en ${DIR}`);
  }
  if (sinNada) console.log(`${sinNada} obra(s) no tenían mapa que quitar.`);
  console.log('');
  process.exit(bloqueadas ? 1 : 0);
})().catch(e => { console.error('\nNO ARRANCÓ:', e.message); process.exit(2); });
