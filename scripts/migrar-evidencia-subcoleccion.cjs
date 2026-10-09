#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// MIGRACIÓN DE EVIDENCIA: DEL MAPA INCRUSTADO A LA SUBCOLECCIÓN (#30, #52)
// ════════════════════════════════════════════════════════════════════════════
//
// Mueve las fotos de `obras/{id}/avance/subs` → `data[].fotos{}` a un documento
// por foto en `obras/{id}/evidencia/{eid}`, y al final levanta la bandera
// `obras/{id}/config/evidencia.migrada = true`, que es lo que hace que la app
// lea de ahí.
//
// POR OMISIÓN NO ESCRIBE NADA. Sin `--escribir` hace el ensayo completo.
//
//   node scripts/migrar-evidencia-subcoleccion.cjs
//   node scripts/migrar-evidencia-subcoleccion.cjs --obra 0126 --escribir
//   EMU_HOST=127.0.0.1 EMU_PORT=8080 node scripts/migrar-evidencia-subcoleccion.cjs --escribir
//
// ── LOS DOS DATOS QUE NO SE COPIAN TAL CUAL ─────────────────────────────────
//
//   1. LA FECHA DEL TELÉFONO NO SE ASCIENDE A HECHO. `addFoto` guardaba
//      `fecha: hoyLocalISO()`, el reloj del aparato. Medidas las 656 fotos de
//      producción contra `timeCreated` de Storage —que lo pone el servidor de
//      Google al recibir el archivo—, 48 están corridas un día. La comparación
//      fácil, en UTC, decía «656 de 656 coinciden», que era una mentira
//      tranquilizadora (ver `medir-evidencia-para-migrar.cjs`).
//
//      Así que la hora del servidor va a `subidaEn` y el valor del teléfono a
//      `fechaDeclarada`, con ese nombre. `subidaEn` NO se llama `capturadaEn`:
//      es cuándo LLEGÓ el archivo, no cuándo se apretó el botón, y nadie midió
//      lo segundo. Un campo que dijera «capturada» inventaría el dato.
//
//   2. ESTAS FOTOS NO TIENEN AUTOR Y NO ES RECUPERABLE. Ningún documento guarda
//      un uid y Storage no expone quién subió el objeto. Se escriben con
//      `origen: 'legado'` y SIN `capturadaPor`, que es exactamente lo que hace
//      que `evidenciaNormalizada` les niegue `verificada` y que la pantalla les
//      ponga otro sello. Una foto de legado con la insignia de evidencia
//      verificada sería el mismo defecto que mostrar cero cuando falta el dato.
//
// ── EL ID ES DETERMINISTA, A PROPÓSITO ──────────────────────────────────────
//
// La app usa `nuevoIdEvidencia()`, que es azar. Aquí no se puede: un segundo
// pase con ids nuevos duplicaría las 656 fotos y la galería contaría doble sin
// que nada reventara. El id sale del hash de `rutaStorage`, que es único por
// objeto, así que repetir la migración REESCRIBE los mismos documentos. Eso es
// lo que permite correrla dos veces después de un corte de red.
//
// ── EL ORDEN, Y POR QUÉ LA BANDERA VA AL FINAL ──────────────────────────────
//
//   1. Leer `avance/subs` y la hora de servidor de cada objeto de Storage.
//   2. Validar TODO antes de escribir nada. Una foto sin objeto en Storage, o
//      sin hora de servidor, para la obra entera: media obra migrada enseñaría
//      media galería, porque la bandera es por obra y no por foto.
//   3. Escribir un documento por foto.
//   4. Releerlos y comparar contra lo que la PANTALLA veía antes — no contra mi
//      propia lectura. La cuenta se saca ejecutando `evidenciaDeObra` del
//      archivo, la misma función que pinta la galería, sobre las dos formas.
//   4b. Releer `avance/subs` y comprobar que nadie capturó mientras corríamos.
//   5. Sólo entonces, la bandera.
//
// Entre 3 y 5 la app sigue leyendo el mapa viejo, que está completo. Si esto se
// interrumpe, lo peor que queda es una subcolección que nadie lee todavía.
//
// El mapa viejo NO se vacía. Se queda como red, igual que en la migración de
// nómina, y se vacía a mano cuando la obra lleve días sin incidencias.
//
// ── QUÉ QUEDA FUERA ─────────────────────────────────────────────────────────
//
// Las fotos de `subcontratos/lista` → `conceptos[].fotos`. Son `{url, fecha}`
// sin id, indexadas por posición, y son documentación interna del contratista:
// no son el expediente que el §7.7 gobierna. Se anotan en PENDIENTES y no se
// tocan aquí. Este guion las deja en paz pero SÍ las cuenta al decidir si un
// objeto de Storage está huérfano.
//
//   gcloud auth application-default print-access-token > /tmp/adc.tok

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const raiz = path.resolve(__dirname, '..');
const P = 'campo-fosmon';
const BUCKET = 'campo-fosmon.firebasestorage.app';

const args = process.argv.slice(2);
const ESCRIBIR = args.includes('--escribir');
const iObra = args.indexOf('--obra');
const SOLO = iObra >= 0 ? args[iObra + 1] : null;

// Contra el emulador no hay token ni bucket: se apunta el transporte a
// localhost y la hora de servidor se toma de un listado sembrado. Es como se
// ensaya esto sin pedir permiso para tocar producción.
const EMU_HOST = process.env.EMU_HOST || null;
const EMU_PORT = Number(process.env.EMU_PORT || 8080);

// ── PRODUCCIÓN SE PIDE, NO SE HEREDA ───────────────────────────────────────
//
// Antes el destino se decidía por la AUSENCIA de `EMU_HOST`: sin esa variable,
// el guion apuntaba a producción. O sea que el modo más destructivo era el que
// salía por omisión, y olvidar una variable de entorno era suficiente para
// escribir en producción creyendo que se escribía en el emulador.
//
// Eso me pasó el 2026-10-09 a la 01:43: corrí `--obra 0114 --escribir` sin
// `EMU_HOST` queriendo migrar la obra del preview y escribí 270 documentos en
// producción. No se perdió nada —el mapa viejo es la red y quedó intacto— pero
// fue una escritura a producción sin autorización, que es justo lo que este
// proyecto reserva para un OK explícito.
//
// Ahora producción exige `--prod` escrito a mano, junto con `--escribir`. Un
// olvido ya no apunta a producción: no apunta a ningún lado y el guion se para.
const PROD = args.includes('--prod');
if (!EMU_HOST && !PROD) {
  console.error(
    '\nNo hay destino.\n\n' +
    '  Emulador:    EMU_HOST=127.0.0.1 EMU_PORT=8080 node ' + path.basename(__filename) + ' …\n' +
    '  Producción:  node ' + path.basename(__filename) + ' --prod …\n\n' +
    'Producción se pide con `--prod`. Antes era lo que salía por omisión y el\n' +
    '2026-10-09 eso escribió 270 documentos en producción por una variable de\n' +
    'entorno olvidada. El destino se escribe, no se deduce.');
  process.exit(2);
}
if (EMU_HOST && PROD) {
  console.error('\n`--prod` y EMU_HOST a la vez. Decide uno: no voy a adivinar cuál.');
  process.exit(2);
}
const BASE = EMU_HOST
  ? `/v1/projects/${P}/databases/(default)/documents`
  : `/v1/projects/${P}/databases/(default)/documents`;

let TOKEN = null;
if (!EMU_HOST) {
  try { TOKEN = fs.readFileSync('/tmp/adc.tok', 'utf8').trim(); }
  catch {
    console.error('Falta /tmp/adc.tok — corre `gcloud auth application-default print-access-token > /tmp/adc.tok`');
    process.exit(1);
  }
}

// ── Transporte ──────────────────────────────────────────────────────────────
// El cuerpo se junta en BUFFERS y se decodifica UNA vez. Concatenar strings por
// trozo parte los caracteres UTF-8 de varios bytes en la frontera de dos trozos
// TCP y los decodifica a medias por cada lado — el 2026-09-23 eso dio un rojo
// falso en la migración de nómina y, lo peor, podía dar un verde falso
// comparando dato mutilado contra dato mutilado. Aquí hay descripciones de
// partida con acentos en casi cada renglón.
const juntarCuerpo = (resp, listo) => {
  const trozos = [];
  resp.on('data', d => trozos.push(Buffer.from(d)));
  resp.on('end', () => listo(Buffer.concat(trozos).toString('utf8')));
};

// Ningún fallo se traga. Una migración que sigue después de un error de red
// reporta éxito sobre datos a medio mover.
const pedirA = (mod, opciones, cuerpo) => new Promise((res, rej) => {
  const r = mod.request(opciones, resp => juntarCuerpo(resp, b => {
    if (resp.statusCode >= 200 && resp.statusCode < 300) return res(b ? JSON.parse(b) : {});
    if (resp.statusCode === 404 && opciones.method === 'GET') return res(null);
    rej(new Error(`${opciones.method} ${opciones.path} → ${resp.statusCode}\n${b.slice(0, 400)}` +
      (resp.statusCode === 401 || resp.statusCode === 403
        ? '\nSuele ser el token vencido: `gcloud auth application-default print-access-token > /tmp/adc.tok`'
        : '')));
  }));
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

// ── Conversión de tipos ─────────────────────────────────────────────────────
const deValor = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  // Un timestamp se devuelve con la forma `{seconds, nanoseconds}`, que es la
  // que el SDK del navegador le entrega a la app. Si se devolviera la cadena
  // ISO, la verificación del paso 4 leería el campo de una forma que la
  // pantalla nunca ve, y una hora que se recorta mal en la app saldría bien
  // aquí. La verificación tiene que mirar lo que mira la pantalla.
  if ('timestampValue' in v) {
    const ms = Date.parse(v.timestampValue);
    return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 };
  }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deValor);
  if ('mapValue' in v) return deCampos(v.mapValue);
  return null;
};
const deCampos = (d) => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, deValor(v)]));

// `TS(iso)` marca un valor para que salga como `timestampValue` y no como
// texto. Importa más de lo que parece: `subidaEn` escrito como cadena ISO se
// lee con `t.slice(0,10)`, que recorta en UTC, y una foto que llegó a las 23:40
// del 28 en México queda fechada el 29. Es el mismo error de un día que vinimos
// a corregir, cometido al escribir la corrección. El campo tiene que tener el
// MISMO tipo que escribe la app con `serverTimestamp()`.
const TS = (iso) => ({ __ts: iso });
const aValor = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'object' && v && '__ts' in v) return { timestampValue: v.__ts };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v)
    ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter(x => x !== undefined).map(aValor) } };
  if (typeof v === 'object') return { mapValue: { fields: aCampos(v) } };
  throw new Error(`Tipo que no sé escribir: ${typeof v}`);
};
const aCampos = (o) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, aValor(v)]));

// ── Lo que hace la app, extraído de la app ──────────────────────────────────
// `evidenciaDeObra` y compañía NO se reimplementan: se sacan del archivo y se
// ejecutan. La verificación del paso 4 compara «lo que la galería veía» contra
// «lo que la galería verá», y para que eso quiera decir algo la cuenta tiene que
// salir de la función que pinta la galería, no de una copia mía que puede
// divergir el día que alguien toque el aplanado. Ya pasó: había tres copias y
// una perdió su `.flat()` (#32).
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const src = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
const modulo = {};
traverse(ast, {
  FunctionDeclaration(p) {
    if (!p.node.id || p.getFunctionParent()) return;
    if (!(p.node.id.name in modulo)) modulo[p.node.id.name] = src.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init || p.getFunctionParent()) return;
    if (!(p.node.id.name in modulo)) modulo[p.node.id.name] = src.slice(p.node.init.start, p.node.init.end);
  },
});
const PIEZAS = ['fechaLocalDeISO', 'semanaISO', 'snapshotId', 'ORIGEN_LEGADO',
  'ORIGEN_EN_VIVO', 'fechaDeTimestamp', 'evidenciaNormalizada', 'idDePartida',
  'evidenciaMigrada', 'evidenciaDeObra', 'evidenciaVigente', 'semanaDeEvidencia'];
const faltan = PIEZAS.filter(n => !(n in modulo));
if (faltan.length) {
  console.error('No se pudieron extraer de src/App.jsx: ' + faltan.join(', '));
  console.error('La migración no puede verificarse contra la pantalla sin ellas. No corre.');
  process.exit(1);
}
const app = new Function(`"use strict";
  ${PIEZAS.map(n => `const ${n} = ${modulo[n]};`).join('\n')}
  return { ${PIEZAS.join(', ')} };`)();

// ── Storage: la hora del servidor, leída del servidor ───────────────────────
// Se lista el bucket por la API de GCS en el momento de migrar, no de un archivo
// que alguien generó antes: un listado viejo deja sin `subidaEn` a toda foto
// subida después de generarlo, y como la validación es todo-o-nada eso PARA la
// obra en vez de migrarla mal. Que pare está bien; que el listado sea de hoy,
// mejor.
//
// Con EMU_HOST se lee de /tmp/storage-obras.txt (`gsutil ls -l -r`), que es lo
// que permite ensayar esto sin credenciales.
const inventarioStorage = async () => {
  const objetos = new Map();   // ruta → { creado, bytes }
  if (EMU_HOST) {
    const LISTADO = process.env.LISTADO_STORAGE || '/tmp/storage-obras.txt';
    if (!fs.existsSync(LISTADO)) {
      console.error(`Falta ${LISTADO}. En modo emulador la hora de servidor se lee de ahí:`);
      console.error(`  gsutil ls -l -r "gs://${BUCKET}/obras/**" > ${LISTADO}`);
      process.exit(1);
    }
    for (const linea of fs.readFileSync(LISTADO, 'utf8').split('\n')) {
      const m = linea.match(/^\s*(\d+)\s+(\S+Z)\s+gs:\/\/[^/]+\/(.+)$/);
      if (m) objetos.set(m[3], { creado: m[2], bytes: Number(m[1]) });
    }
    return objetos;
  }
  let pageToken = null;
  do {
    const q = new URLSearchParams({ prefix: 'obras/', maxResults: '1000',
      fields: 'items(name,timeCreated,size),nextPageToken' });
    if (pageToken) q.set('pageToken', pageToken);
    const r = await pedirA(https, {
      host: 'storage.googleapis.com', method: 'GET',
      path: `/storage/v1/b/${encodeURIComponent(BUCKET)}/o?${q}`,
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': P },
    });
    for (const it of (r.items || []))
      objetos.set(it.name, { creado: it.timeCreated, bytes: Number(it.size) });
    pageToken = r.nextPageToken || null;
  } while (pageToken);
  return objetos;
};

// La URL de descarga lleva la ruta percent-encoded entre `/o/` y `?`. Es la
// única forma de volver al objeto desde una foto vieja, y es justamente por eso
// que de hoy en adelante `rutaStorage` se guarda aparte (#30).
const rutaDeURL = (url) => {
  const m = String(url || '').match(/\/o\/([^?]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
};

// Determinista y derivado del objeto: ver la cabecera. 20 caracteres de sha256
// en base36 sobre una ruta que ya es única; no hay sorteo que sesgar.
const idDeEvidencia = (ruta) =>
  'l' + BigInt('0x' + crypto.createHash('sha256').update(ruta).digest('hex').slice(0, 24))
    .toString(36);

const n = (x) => Number(x).toLocaleString('es-MX');

// ── 1 y 2. Plan y validación ────────────────────────────────────────────────
const planDe = async (o, objetos) => {
  const doc = await fs_('GET', `/${o.prefijo}obras/${o.id}/avance/subs`);
  const subs = Array.isArray(deCampos(doc).data) ? deCampos(doc).data : [];
  const cfg = deCampos(await fs_('GET', `/${o.prefijo}obras/${o.id}/config/evidencia`));

  const docs = [], errores = [];
  // ── LA PARTIDA TIENE QUE TENER `id` ANTES DE MIGRAR ──────────────────────
  //
  // `partidaId` es lo único que ata una foto a su partida después de migrar, y
  // `idDePartida` cae a `sec` cuando no hay `id`. El problema es que la app NO
  // se queda con `sec`: al abrir la obra, la auto-migración de `avance/subs`
  // (`necesitaMigrar`) le asigna `id = ${sec}__${idx}` y lo GUARDA. O sea que
  // migrar antes de que eso pase escribe `partidaId: '1'` y la app renombra la
  // partida a `1__0` por debajo, dejando la evidencia huérfana.
  //
  // Y es huérfana de la peor manera: la galería por semana sigue enseñando
  // todas las fotos —no mira la partida—, mientras la pantalla de captura, el
  // PDF y el tablero cuentan CERO en esa partida. Lo vi pasar entero en el
  // preview el 2026-10-08: 13 fotos en la galería y «Agregar foto» en las doce
  // partidas, porque la siembra derivó el id igual que esto y la app reescribió
  // los ids después.
  //
  // No se arregla derivando `${sec}__${idx}` aquí: sería duplicar la regla de
  // la auto-migración en un segundo lugar, y el día que una cambie, la
  // evidencia de las obras ya migradas queda colgada sin que nada avise. Se
  // para la obra y se dice qué hacer, que cuesta una visita a la pantalla.
  const sinId = subs.map((s, i) => [s, i]).filter(([s]) => !(s && s.id));
  if (sinId.length)
    errores.push(`${sinId.length} de ${subs.length} partida(s) no tienen \`id\`` +
      ` (${sinId.slice(0, 4).map(([s, i]) => `#${i} sec=${(s && s.sec) || '?'}`).join(', ')}` +
      `${sinId.length > 4 ? ', …' : ''}).\n` +
      '    Abre la obra una vez en la app: la auto-migración de `avance/subs` les\n' +
      '    asigna el id y lo guarda. Migrar antes ata la evidencia a un id que la\n' +
      '    app va a renombrar, y la partida se queda sin fotos sin decirlo.');
  const vistos = new Set();
  subs.forEach((s, is) => {
    const partidaId = app.idDePartida(s, is);
    const lista = (Array.isArray(s.fotos) ? s.fotos
      : Object.values(s.fotos || {}).flat()).filter(Boolean);
    lista.forEach((foto, i) => {
      const esObj = foto && typeof foto === 'object';
      const url = esObj ? (foto.url || foto.src || '') : String(foto || '');
      if (!url) return;
      const ruta = rutaDeURL(url);
      if (!ruta) {
        errores.push(`${partidaId} #${i}: la URL no trae ruta de Storage — ${url.slice(0, 70)}`);
        return;
      }
      const obj = objetos.get(ruta);
      if (!obj) {
        errores.push(`${partidaId} #${i}: no hay objeto en Storage para ${ruta}`);
        return;
      }
      const id = idDeEvidencia(ruta);
      if (vistos.has(id)) {
        // Dos partidas apuntando al mismo objeto: migrarlas daría UN documento
        // y la galería perdería una foto en silencio. Para la obra.
        errores.push(`${partidaId} #${i}: ${ruta} ya está referenciada por otra foto de esta obra`);
        return;
      }
      vistos.add(id);
      docs.push({
        id,
        // La forma es la que escribe `evid.agregar`, con dos diferencias que son
        // el punto de todo esto: `origen` legado y sin `capturadaPor`.
        datos: {
          urlOriginal: url,
          rutaStorage: ruta,
          partidaId,
          partidaClave: s.sec || '',
          partidaDesc: s.sub || '',
          origen: app.ORIGEN_LEGADO,
          fechaDeclarada: (esObj && foto.fecha) || null,
          subidaEn: TS(obj.creado),
          anulada: esObj && !!foto.anulada,
          // Si la foto ya se anuló desde la app antes de migrar, la anulación
          // viaja completa. Perderla aquí sería devolver al expediente una foto
          // que alguien retiró con su nombre y su motivo.
          ...(esObj && foto.anulada ? {
            motivoAnulacion: foto.motivoAnulacion || '',
            anuladaPor: foto.anuladaPor || '',
            anuladaEn: foto.anuladaEn ? TS(foto.anuladaEn) : null,
          } : {}),
          fotoIdLegado: (esObj && foto.id) || `${partidaId}-${i}`,
        },
      });
    });
  });

  // La cuenta de referencia: lo que la galería ve HOY, sacado de la función que
  // pinta la galería.
  const antes = app.evidenciaDeObra({ cfgEvidencia: { migrada: false }, subs });
  return { subs, cfg, docs, errores, antes };
};

// Firma de una foto para comparar las dos formas. Lleva lo que la pantalla usa
// para pintarla y agruparla, no el documento entero: `subidaEn` aparece en la
// forma nueva y no en la vieja justamente porque es el dato que se recupera.
const firma = (e) => [e.url, e.partidaId, e.sec, e.anulada ? 'anulada' : 'vigente'].join('\u0000');

// Para enseñar una firma hay que recortar por el FINAL de la URL, no por el
// principio. La URL de descarga son 240 caracteres de los que los primeros 80
// son el bucket: recortando al revés, dos fotos distintas salían impresas
// idénticas y el reporte de discrepancia no se podía leer. Pasó al correr la
// contraprueba que pierde una foto.
const legible = (f) => {
  const [url, partidaId, sec, estado] = f.split('\u0000');
  const archivo = decodeURIComponent((url.match(/\/o\/([^?]+)/) || [, url])[1] || url);
  return `…${archivo.slice(-38)}  partida ${partidaId} (${sec})  ${estado}`;
};

// ── 4. Releer y comparar contra lo que la pantalla veía ─────────────────────
const verificar = async (o, plan) => {
  const fallas = [];
  const leidos = ((await fs_('GET', `/${o.prefijo}obras/${o.id}/evidencia?pageSize=1000`))?.documents || [])
    .map(d => ({ id: d.name.split('/').pop(), ...deCampos(d) }));
  if (leidos.length !== plan.docs.length)
    fallas.push(`se escribieron ${plan.docs.length} documento(s) y se leen ${leidos.length}`);

  const despues = leidos.map(app.evidenciaNormalizada);
  const a = plan.antes.map(firma).sort(), b = despues.map(firma).sort();
  if (a.length !== b.length)
    fallas.push(`la galería veía ${a.length} foto(s) y vería ${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i])
    fallas.push(`foto ${i + 1}:\n      antes  ${legible(a[i])}\n      ahora  ${legible(b[i])}`);

  // Las dos cosas que la migración promete y que ninguna cuenta revelaría:
  const sinRuta = despues.filter(e => !e.rutaStorage).length;
  if (sinRuta) fallas.push(`${sinRuta} documento(s) sin \`rutaStorage\` — el #30 sigue abierto para ellos`);
  const presumidas = despues.filter(e => e.verificada);
  if (presumidas.length)
    fallas.push(`${presumidas.length} foto(s) de legado saldrían con el sello de VERIFICADA ` +
                `(${presumidas.slice(0, 3).map(e => e.id).join(', ')})`);
  const sinServidor = despues.filter(e => !e.fechaServidor).length;
  if (sinServidor) fallas.push(`${sinServidor} documento(s) sin hora de servidor en \`subidaEn\``);

  // Y la que decide si el riel de evidencia se mueve: la semana.
  const sem = (lista) => {
    const m = new Map();
    for (const e of app.evidenciaVigente(lista)) {
      const w = app.semanaDeEvidencia(e) || 'sin semana';
      m.set(w, (m.get(w) || 0) + 1);
    }
    return m;
  };
  const sA = sem(plan.antes), sD = sem(despues);
  const movidas = [];
  for (const w of new Set([...sA.keys(), ...sD.keys()]))
    if ((sA.get(w) || 0) !== (sD.get(w) || 0))
      movidas.push(`${w}: ${sA.get(w) || 0} → ${sD.get(w) || 0}`);
  return { fallas, leidos, despues, movidas };
};

// ── Programa ────────────────────────────────────────────────────────────────
(async () => {
  console.log(ESCRIBIR
    ? (EMU_HOST ? `*** ESCRITURA contra el EMULADOR ${EMU_HOST}:${EMU_PORT} ***\n`
                : '*** MODO ESCRITURA — esto toca PRODUCCIÓN ***\n')
    : 'Ensayo. No se escribe nada. Agrega --escribir cuando esté revisado.\n');

  const objetos = await inventarioStorage();
  console.log(`${n(objetos.size)} objeto(s) en Storage con su hora de servidor.\n`);

  const obras = [];
  for (const d of ((await fs_('GET', '/obras?pageSize=300'))?.documents || []))
    obras.push({ id: d.name.split('/').pop(), prefijo: '' });
  for (const d of ((await fs_('GET', '/orgs?pageSize=100'))?.documents || [])) {
    const oid = d.name.split('/').pop();
    for (const s of ((await fs_('GET', `/orgs/${oid}/obras?pageSize=300`))?.documents || []))
      obras.push({ id: s.name.split('/').pop(), prefijo: `orgs/${oid}/` });
  }
  const aMigrar = SOLO ? obras.filter(o => o.id === SOLO) : obras;
  if (!aMigrar.length) { console.error(`No hay obra «${SOLO}».`); process.exit(1); }

  let problemas = 0, migradas = 0, fotos = 0;

  for (const o of aMigrar) {
    const nombre = o.prefijo + o.id;
    console.log('═'.repeat(72));
    console.log(`OBRA ${nombre}`);
    console.log('═'.repeat(72));

    const plan = await planDe(o, objetos);

    if (app.evidenciaMigrada(plan.cfg)) {
      console.log('Ya está migrada (config/evidencia.migrada = true). Se salta.');
      console.log('Volver a correrla reescribiría los mismos documentos —el id es');
      console.log('determinista— pero no hay por qué.\n');
      continue;
    }
    if (!plan.antes.length) {
      console.log('No tiene fotos. No se escribe nada y la bandera NO se levanta:');
      console.log('una obra sin evidencia no necesita migrarse, y marcarla migrada');
      console.log('mandaría su próxima captura a una subcolección sin que nadie la\n' +
                  'haya verificado.\n');
      continue;
    }

    console.log(`\n${n(plan.antes.length)} foto(s) que la galería ve hoy → ` +
                `${n(plan.docs.length)} documento(s)`);
    const anuladas = plan.docs.filter(d => d.datos.anulada).length;
    if (anuladas) console.log(`  ${anuladas} ya venían anuladas desde la app; la anulación viaja completa.`);
    // La comparación se hace con `fechaDeTimestamp`, la función de la app, y no
    // recortando el ISO: recortado en UTC este contador dice cero. Lo dijo, al
    // ensayar esto contra el emulador, con una foto sembrada a las 23:40 hora
    // de México a propósito. La zona es la de quien corre el guion, igual que
    // en la pantalla es la de quien mira.
    const diaServidor = (ts) => app.fechaDeTimestamp({ seconds: Date.parse(ts.__ts) / 1000 });
    const corridas = plan.docs.filter(d =>
      d.datos.fechaDeclarada && d.datos.fechaDeclarada !== diaServidor(d.datos.subidaEn)).length;
    console.log(`  ${corridas} con la fecha del teléfono distinta de la del servidor` +
                ` (se conservan las dos: \`fechaDeclarada\` y \`subidaEn\`)`);

    if (plan.errores.length) {
      console.log(`\n${plan.errores.length} foto(s) que no se pueden migrar:\n`);
      for (const e of plan.errores.slice(0, 15)) console.log('  ' + e);
      if (plan.errores.length > 15) console.log(`  … y ${plan.errores.length - 15} más`);
      console.log('\nLa obra NO se migra, ni a medias. La bandera es por obra: con media');
      console.log('subcolección escrita y la bandera arriba, la galería enseñaría media');
      console.log('galería y diría que eso es todo lo que hay.');
      problemas++;
      continue;
    }

    if (!ESCRIBIR) { console.log('\n(ensayo: no se escribió nada)\n'); continue; }

    console.log('\nEscribiendo…');
    for (const d of plan.docs)
      await fs_('PATCH', `/${o.prefijo}obras/${o.id}/evidencia/${d.id}`, { fields: aCampos(d.datos) });
    console.log(`  ${n(plan.docs.length)} documento(s) escritos`);

    console.log('\nVerificando contra lo que la galería veía…');
    const v = await verificar(o, plan);
    if (v.fallas.length) {
      console.log(`\n${v.fallas.length} problema(s):`);
      for (const f of v.fallas.slice(0, 20)) console.log('  ' + f);
      if (v.fallas.length > 20) console.log(`  … y ${v.fallas.length - 20} más`);
      console.log('\nLa bandera NO se levanta. La app sigue leyendo el mapa viejo, que');
      console.log('está intacto, así que la obra no ha perdido nada. Revisa y repite:');
      console.log('el id es determinista, repetir reescribe y no duplica.');
      problemas++;
      continue;
    }
    console.log(`  ${n(v.despues.length)} de ${n(plan.antes.length)} fotos idénticas, ` +
                'todas con ruta y hora de servidor, ninguna presumiendo de verificada.');
    if (v.movidas.length) {
      console.log('\n  La semana de algunas fotos cambia al usar la hora del servidor:');
      for (const m of v.movidas) console.log('    ' + m);
      console.log('  No es un error: la hora del servidor es la buena. Queda dicho porque');
      console.log('  el riel de evidencia agrupa por semana y alguien va a notar el cambio.');
    } else {
      console.log('  El riel por semana no se mueve: ningún desfase cruza un lunes.');
    }

    // 4b. Última mirada al origen antes del punto de no retorno.
    const ahora = await planDe(o, objetos);
    if (ahora.antes.map(firma).sort().join('\n') !== plan.antes.map(firma).sort().join('\n')) {
      console.log('\n`avance/subs` CAMBIÓ mientras corríamos: alguien capturó o anuló.');
      console.log('La bandera NO se levanta. Si la subiéramos, esa foto desaparecería de');
      console.log('la pantalla porque no está en la subcolección. Repite cuando no haya');
      console.log('nadie capturando.');
      problemas++;
      continue;
    }

    // 5. La bandera, al final.
    await fs_('PATCH', `/${o.prefijo}obras/${o.id}/config/evidencia`, {
      fields: aCampos({ migrada: true, migradaEn: new Date().toISOString(),
                        fotosMigradas: plan.docs.length }),
    });
    const cfg = deCampos(await fs_('GET', `/${o.prefijo}obras/${o.id}/config/evidencia`));
    if (!app.evidenciaMigrada(cfg)) {
      console.log('\nLa bandera no quedó en true. La app sigue leyendo el mapa viejo.');
      problemas++;
      continue;
    }
    console.log('\nBandera arriba: la obra lee ya de `evidencia`. El mapa viejo se queda');
    console.log('como estaba — es la red, y se vacía a mano cuando lleve días sin ruido.\n');
    migradas++; fotos += plan.docs.length;
  }

  console.log('═'.repeat(72));
  if (problemas) {
    console.log(`${problemas} obra(s) con problemas. Ninguna quedó a medias: la bandera`);
    console.log('sólo sube después de verificar contra lo que la pantalla veía.');
    process.exit(1);
  }
  console.log(ESCRIBIR
    ? `${migradas} obra(s) migradas · ${n(fotos)} foto(s) con documento propio.\n` +
      'Siguiente paso, cuando lleve días sin incidencias: vaciar `fotos` de\n' +
      '`avance/subs`, que es lo que libera el peso del documento.'
    : 'Ensayo limpio. Con --escribir hace lo de arriba de verdad.');
  process.exit(0);
})().catch(e => { console.error('\n' + (e.stack || e.message || e)); process.exit(1); });
