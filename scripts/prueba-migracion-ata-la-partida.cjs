#!/usr/bin/env node
// Prueba de INTEGRACIÓN: la migración de evidencia no suelta la foto de su
// partida. Corre el guion de verdad —`migrar-evidencia-subcoleccion.cjs`, como
// proceso, con sus argumentos— contra el emulador, y después cuenta las fotos
// POR PARTIDA ejecutando `evidenciaDePartida` del archivo.
//
// POR QUÉ EXISTE. Lo vi pasar entero en el preview el 2026-10-08, y es el peor
// defecto que me he encontrado en esta rama porque se ve bien desde casi todas
// las pantallas:
//
//   `partidaId` es lo único que ata una foto a su partida después de migrar, y
//   `idDePartida` cae a `sec` cuando la partida no tiene `id`. Sólo que la app
//   NO se queda con `sec`: al abrir la obra, la auto-migración de `avance/subs`
//   le asigna `id = ${sec}__${idx}` y lo GUARDA. Así que migrar antes de que
//   eso pase escribe `partidaId: '1'` y la app renombra la partida a `1__0` por
//   debajo.
//
//   La galería «La obra, semana por semana» siguió enseñando las 13 fotos —no
//   mira la partida, agrupa por semana— mientras la pantalla de captura decía
//   «Agregar foto» en las doce partidas, el PDF salía sin fotos y el tablero
//   contaba cero. Trece fotos presentes y cero alcanzables, sin un error.
//
// Lo que afirma no es que el guion tenga una guarda: es que las dos cuentas por
// partida —antes y después de migrar— son el mismo número, y que una obra con
// partidas sin `id` se PARA en vez de migrarse mal.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore --project campo-fosmon
//   node scripts/prueba-migracion-ata-la-partida.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const raiz = path.resolve(__dirname, '..');
const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
// El guion tiene el proyecto escrito dentro (`campo-fosmon`); contra el
// emulador es el mismo nombre y no hay nada que configurar.
const P = 'campo-fosmon';
const BASE = `/v1/projects/${P}/databases/(default)/documents`;
// Una obra que no existe en ningún otro lado. Se borra al final por la API de
// administración, que no pasa por reglas.
const OBRA = 'ZZPRUEBA-ATA-PARTIDA';
const LISTADO = '/tmp/storage-prueba-ata-partida.txt';
const BUCKET = 'campo-fosmon.firebasestorage.app';

// ── Transporte contra el emulador ───────────────────────────────────────────
const pedir = (metodo, ruta, cuerpo) => new Promise((res, rej) => {
  const r = http.request({ host: HOST, port: PUERTO, path: ruta, method: metodo,
    headers: { Authorization: 'Bearer owner',
               ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) } }, resp => {
    const t = [];
    resp.on('data', d => t.push(Buffer.from(d)));
    resp.on('end', () => {
      const b = Buffer.concat(t).toString('utf8');
      if (resp.statusCode >= 200 && resp.statusCode < 300) return res(b ? JSON.parse(b) : {});
      if (resp.statusCode === 404 && metodo === 'GET') return res(null);
      rej(new Error(`${metodo} ${ruta} → ${resp.statusCode} ${b.slice(0, 200)}`));
    });
  });
  r.on('error', rej);
  if (cuerpo) r.write(JSON.stringify(cuerpo));
  r.end();
});
const fs_ = (m, r, c) => pedir(m, BASE + r, c);

const deValor = (v) => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
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
const aValor = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(aValor) } };
  return { mapValue: { fields: aCampos(v) } };
};
const aCampos = (o) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, aValor(v)]));

// ── Las piezas de la pantalla, extraídas y EJECUTADAS ───────────────────────
// `evidenciaDePartida` es la función que usan los TRES consumidores que se
// quedaron en cero: la pantalla de captura, el PDF y el tablero. Se ejecuta la
// del archivo, no una copia: una copia se comprobaría contra sí misma.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const fuente = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const piezas = {};
traverse(parse(fuente, { sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'] }), {
  FunctionDeclaration(p) {
    if (!p.node.id || p.getFunctionParent()) return;
    if (!(p.node.id.name in piezas)) piezas[p.node.id.name] = fuente.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init || p.getFunctionParent()) return;
    if (!(p.node.id.name in piezas)) piezas[p.node.id.name] = fuente.slice(p.node.init.start, p.node.init.end);
  },
});
const NECESARIAS = ['ORIGEN_LEGADO', 'ORIGEN_EN_VIVO', 'fechaDeTimestamp',
  'evidenciaNormalizada', 'idDePartida', 'evidenciaMigrada', 'evidenciaDeObra',
  'evidenciaVigente', 'evidenciaDePartida'];
const faltan = NECESARIAS.filter(n => !(n in piezas));
if (faltan.length) {
  console.error('No se encontraron estas piezas en src/App.jsx: ' + faltan.join(', '));
  console.error('Si el corte por obra se reescribió, esta prueba hay que rehacerla:');
  console.error('la foto sigue teniendo que poder alcanzarse DESDE SU PARTIDA.');
  process.exit(2);
}
const app = new Function(`"use strict";
${NECESARIAS.map(n => `const ${n} = ${piezas[n]};`).join('\n')}
return { ${NECESARIAS.join(', ')} };`)();

// `porPartida(cfg, docs, subs)` es la cuenta que ven la captura, el PDF y el
// tablero: cuántas fotos alcanza cada partida POR SU ID.
const porPartida = (cfg, docs, subs) => {
  const lista = app.evidenciaDeObra({ cfgEvidencia: cfg, docsEvidencia: docs, subs });
  const out = {};
  subs.forEach((s, i) => {
    out[app.idDePartida(s, i)] = app.evidenciaDePartida(lista, app.idDePartida(s, i)).length;
  });
  return out;
};

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Los datos: la forma que tienen en producción ────────────────────────────
const urlDe = (ruta) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(ruta)}?alt=media&token=abc`;
// Dos partidas con fotos y una sin ninguna. La tercera está a propósito: una
// partida vacía antes tiene que seguir vacía después, y es donde se vería si la
// migración repartiera las fotos por posición.
const PARTIDAS = [
  { sec: '1', sub: 'PRELIMINARES', rutas: ['a1', 'a2', 'a3'] },
  { sec: '2', sub: 'TERRACERÍAS', rutas: ['b1'] },
  { sec: '3', sub: 'PAVIMENTOS', rutas: [] },
];
const rutaLarga = (p, k) => `obras/${OBRA}/fotos/avance_${p}/${k}.jpg`;
const subsDe = (conId) => PARTIDAS.map((p, i) => ({
  ...(conId ? { id: `${p.sec}__${i}` } : {}),
  sec: p.sec, sub: p.sub, n: 1, a: 0.5, imp: 100000,
  fotos: { [conId ? `${p.sec}__${i}` : p.sec]: p.rutas.map((k, j) => ({
    id: `f-${p.sec}-${j}`, url: urlDe(rutaLarga(p.sec, k)), fecha: '2026-10-01',
  })) },
}));

const sembrarListado = () => {
  // El formato de `gsutil ls -l -r`, que es lo que el guion sabe leer en modo
  // emulador. La hora es de «servidor» para la prueba.
  const lineas = PARTIDAS.flatMap(p => p.rutas.map(k =>
    `    102400  2026-10-01T18:30:00Z  gs://${BUCKET}/${rutaLarga(p.sec, k)}`));
  fs.writeFileSync(LISTADO, lineas.join('\n') + '\n');
};

const borrarObra = async () => {
  for (const sub of ['avance/subs', 'config/evidencia'])
    await pedir('DELETE', `${BASE}/obras/${OBRA}/${sub}`).catch(() => {});
  const r = await fs_('GET', `/obras/${OBRA}/evidencia?pageSize=300`).catch(() => null);
  for (const d of (r?.documents || []))
    await fs_('DELETE', `/obras/${OBRA}/evidencia/${d.name.split('/').pop()}`).catch(() => {});
  await pedir('DELETE', `${BASE}/obras/${OBRA}`).catch(() => {});
};

const correrMigracion = (args) => {
  try {
    return { salida: 0, texto: execFileSync(process.execPath,
      [path.join(raiz, 'scripts/migrar-evidencia-subcoleccion.cjs'), '--obra', OBRA, ...args],
      { cwd: raiz, encoding: 'utf8',
        env: { ...process.env, EMU_HOST: HOST, EMU_PORT: String(PUERTO), LISTADO_STORAGE: LISTADO } }) };
  } catch (e) {
    return { salida: e.status === undefined ? -1 : e.status,
             texto: (e.stdout || '') + (e.stderr || '') };
  }
};

const evidenciaEnFirestore = async () => {
  const r = await fs_('GET', `/obras/${OBRA}/evidencia?pageSize=300`);
  return (r?.documents || []).map(d => ({ id: d.name.split('/').pop(), ...deCampos(d) }));
};

(async () => {
  try { await fs_('GET', '/obras?pageSize=1'); }
  catch (e) {
    console.error(`\nNo hay emulador de Firestore escuchando en ${HOST}:${PUERTO}.\n` +
      `  firebase emulators:start --only firestore --project ${P}\n\n(${e.message})`);
    process.exit(1);
  }
  sembrarListado();
  await borrarObra();

  // ── 1. SIN `id`, LA OBRA SE PARA ────────────────────────────────────────
  // Es el estado del que salió el defecto. No se migra «como se pueda»: se
  // para, porque el daño es invisible desde la galería y sólo se ve desde las
  // tres pantallas que cuentan por partida.
  console.log('1. Una obra con partidas sin `id` no se migra');
  await fs_('PATCH', `/obras/${OBRA}`, { fields: aCampos({ nombre: 'Prueba ata partida' }) });
  await fs_('PATCH', `/obras/${OBRA}/avance/subs`, { fields: aCampos({ data: subsDe(false) }) });

  const r1 = correrMigracion(['--escribir']);
  check(/no tienen `id`/.test(r1.texto), 'el guion dice por qué para',
    (r1.texto.match(/.*no tienen `id`.*/) || ['no lo dijo'])[0].trim().slice(0, 90));
  check(/La obra NO se migra/.test(r1.texto), 'y que no la migra ni a medias');
  const tras1 = await evidenciaEnFirestore();
  check(tras1.length === 0, 'y no escribió un solo documento',
    `${tras1.length} documento(s)`);
  const cfg1 = deCampos(await fs_('GET', `/obras/${OBRA}/config/evidencia`));
  check(!app.evidenciaMigrada(cfg1), 'ni levantó la bandera: la app sigue leyendo el mapa viejo');
  console.log('   (y dice qué hacer: abrir la obra una vez en la app)');
  check(/Abre la obra una vez en la app/.test(r1.texto), 'con la salida, no sólo con el diagnóstico');

  // ── 2. CON `id`, LA FOTO SIGUE ALCANZÁNDOSE DESDE SU PARTIDA ────────────
  // La afirmación de fondo. No «migró N documentos»: las mismas fotos POR
  // PARTIDA, contadas con la función de la captura, el PDF y el tablero.
  console.log('\n2. Migrada, cada partida alcanza las MISMAS fotos que antes');
  await fs_('PATCH', `/obras/${OBRA}/avance/subs`, { fields: aCampos({ data: subsDe(true) }) });
  const subs = deCampos(await fs_('GET', `/obras/${OBRA}/avance/subs`)).data;
  const antes = porPartida({ migrada: false }, [], subs);
  check(JSON.stringify(antes) === JSON.stringify({ '1__0': 3, '2__1': 1, '3__2': 0 }),
    'antes de migrar: 3, 1 y 0 fotos', JSON.stringify(antes));

  const r2 = correrMigracion(['--escribir']);
  check(r2.salida === 0, 'la migración corre y sale en verde',
    r2.salida === 0 ? '' : `salida ${r2.salida}\n${r2.texto.slice(-700)}`);
  const docs = await evidenciaEnFirestore();
  check(docs.length === 4, 'escribió un documento por foto', `${docs.length} documento(s)`);

  const cfg2 = deCampos(await fs_('GET', `/obras/${OBRA}/config/evidencia`));
  check(app.evidenciaMigrada(cfg2), 'y levantó la bandera al final');

  const despues = porPartida(cfg2, docs, subs);
  check(JSON.stringify(despues) === JSON.stringify(antes),
    'y cada partida sigue alcanzando sus fotos POR SU ID',
    `${JSON.stringify(despues)}  (antes ${JSON.stringify(antes)})`);
  if (JSON.stringify(despues) !== JSON.stringify(antes)) {
    console.log('\n   Esto es el defecto del preview: las fotos están guardadas y la galería');
    console.log('   por semana las enseña, pero la captura, el PDF y el tablero cuentan cero');
    console.log('   en la partida. Nada revienta. Nadie se entera.');
  }

  // Y que el `partidaId` escrito sea el id de verdad, no la clave. Es la
  // comprobación que nombra el campo: sin ella, un cambio en `idDePartida`
  // dejaría las dos cuentas de arriba en cero y seguirían «coincidiendo».
  const ids = [...new Set(docs.map(d => d.partidaId))].sort();
  check(JSON.stringify(ids) === JSON.stringify(['1__0', '2__1']),
    'el `partidaId` guardado es el id de la partida, no su clave', ids.join(', '));
  check(docs.every(d => d.origen === app.ORIGEN_LEGADO && !d.capturadaPor),
    'y las fotos migradas no presumen de autor que nadie guardó');

  await borrarObra();
  fs.unlinkSync(LISTADO);

  console.log(fallas === 0
    ? '\nLa migración ata cada foto a su partida, y para la obra cuando no puede.'
    : `\n${fallas} comprobación(es) en rojo. NO correr la migración en producción.`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
