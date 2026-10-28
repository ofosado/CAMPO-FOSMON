#!/usr/bin/env node
// ¿Lo que está en `main` es lo que están usando las personas?
//
// NO es una prueba de la suite, y por eso no se llama `prueba-*`: la suite
// corre contra el emulador y no debe depender de la red ni de credenciales de
// producción. Esto se corre a mano, antes de creerle a un `CERRADO` de
// `PENDIENTES.md` y después de cualquier despliegue.
//
// POR QUÉ EXISTE
//
// El 2026-10-28, al ir a desplegar el #50, producción llevaba 36 commits de
// atraso: 655 líneas de `src/App.jsx` que estaban mezcladas, verdes, y que
// ningún usuario había recibido. El índice marcaba UN renglón pendiente de
// subir. El atraso no se veía porque no había con qué verlo.
//
// El primer intento de arreglo fue comparar `origin/main` contra `main`, y
// eso NO basta: empujar construye el front y nada más. Las reglas y las
// funciones suben por su cuenta, así que el push puede estar al día mientras
// dos de los cuatro canales se quedaron atrás. Hay que medir LO VIVO, uno por
// uno, y comparar CONTENIDO —no fechas, no generaciones, no el "Deploy
// complete!" del comando, que sólo dice que el comando terminó.
//
// LOS CUATRO CANALES, y qué se compara en cada uno:
//
//   front     el bundle servido trae dentro el commit con el que se compiló
//             (`__BUILD_SHA__`, ver vite.config.js). Se compara ese commit
//             contra HEAD, pero SÓLO en las rutas que cambian el bundle: un
//             commit de documentación no desactualiza el front.
//   firestore el ruleset vivo se baja de la API y se diffea contra el archivo.
//   storage   igual, contra el release del bucket que de verdad usa la app
//             —se lee de `src/App.jsx`, no se teclea aquí.
//   funciones se baja el ZIP DE ORIGEN que Cloud Functions guardó al
//             desplegar, y se compara su `index.js` con el del repositorio.
//             Una por una: un canario deja unas al día y otras atrás, y ese
//             es justo el estado que nadie nota.
//
// TRES ESTADOS: verde 0 · ROJO 1 · NO ARRANCÓ 2. Si un canal no se puede
// medir —sin token, sin red, sin `unzip`— esto sale 2, nunca 0. «No se pudo
// mirar» no es «está bien»: es la confusión que dejó pasar los 36 commits.
//
// Uso:
//   export PATH="/opt/homebrew/bin:$PATH"
//   gcloud auth login            # si hiciera falta
//   node scripts/verificar-despliegue.cjs

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const PROYECTO = process.env.PROYECTO || 'campo-fosmon';
const SITIO = process.env.SITIO || 'https://campo-fosmon.netlify.app';

// Rutas que cambian el bundle. Un commit que sólo toca PENDIENTES.md no deja
// al front atrasado, y marcarlo sería un rojo falso — que en un verificador
// cuesta igual que un verde falso: enseña a ignorarlo.
const RUTAS_FRONT = ['src', 'index.html', 'vite.config.js', 'package.json', 'public'];
// Lo que se despliega por otros canales, para la revisión de «ni commiteado».
const RUTAS_DESPLEGABLES = [...RUTAS_FRONT, 'functions', 'firestore.rules', 'storage.rules'];

let atrasados = 0;
const sinMedir = [];

const ok = (canal, detalle) => console.log(` ok    ${canal.padEnd(12)} ${detalle}`);
const rojo = (canal, detalle) => {
  console.log(`ATRÁS  ${canal.padEnd(12)} ${detalle}`);
  atrasados++;
};
// Un canal que no se pudo medir no cuenta como atrasado ni como al día: se
// aparta, y al final manda sobre el veredicto.
const nomedido = (canal, porque) => {
  console.log(`  ?    ${canal.padEnd(12)} NO SE PUDO MEDIR: ${porque}`);
  sinMedir.push(canal);
};

const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8' }).trim();

class NoSePudo extends Error {}

// Un tropiezo de red NO es un veredicto. La primera corrida de esto dijo «1 de
// 17 no se pudieron leer» y la siguiente, sin tocar nada, dijo las 17 al día:
// una de diecisiete descargas simultáneas se cayó sola. Eso es peor que un
// rojo falso — un verificador que a veces no mide enseña a correrlo otra vez
// hasta que salga verde, y ese hábito es exactamente lo que dejó pasar los 36
// commits. Así que se reintenta lo que es claramente pasajero (429, 5xx, caída
// de conexión) y se rinde a la primera con lo que no lo es (401, 403, 404),
// porque ésos sí son el veredicto.
const PASAJEROS = new Set([408, 429, 500, 502, 503, 504]);
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

async function traer(url, cabeceras = {}, intentos = 3) {
  let ultimo;
  for (let i = 1; i <= intentos; i++) {
    let r;
    try {
      r = await fetch(url, { headers: cabeceras });
    } catch (e) {
      ultimo = new NoSePudo(`${url} no contestó (${e.message})`);
      if (i < intentos) { await dormir(300 * i); continue; }
      throw ultimo;
    }
    if (r.ok) return r;
    ultimo = new NoSePudo(`${url} devolvió HTTP ${r.status}`);
    if (!PASAJEROS.has(r.status) || i === intentos) throw ultimo;
    await dormir(300 * i);
  }
  throw ultimo;
}

// Las descargas se hacen de a pocas. Diecisiete a la vez es lo que provocó el
// tropiezo de arriba, y no hay prisa que lo justifique: esto tarda segundos.
async function enTandas(lista, cuantas, fn) {
  const salida = new Array(lista.length);
  let siguiente = 0;
  await Promise.all(Array.from({ length: Math.min(cuantas, lista.length) }, async () => {
    while (siguiente < lista.length) {
      const i = siguiente++;
      salida[i] = await fn(lista[i]);
    }
  }));
  return salida;
}

// ── El insumo: el token. Sin él no se mide nada, y eso es un 2. ─────────────
function token() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new NoSePudo('`gcloud auth print-access-token` no dio token; corre `gcloud auth login`');
  }
}

// ── Reglas: se baja el ruleset VIVO y se compara con el archivo ─────────────
async function reglasVivas(tok, release) {
  const cab = { Authorization: `Bearer ${tok}`, 'x-goog-user-project': PROYECTO };
  const rel = await (await traer(
    `https://firebaserules.googleapis.com/v1/projects/${PROYECTO}/releases/${release}`, cab)).json();
  const rs = await (await traer(
    `https://firebaserules.googleapis.com/v1/${rel.rulesetName}`, cab)).json();
  const archivos = rs.source?.files || [];
  if (archivos.length !== 1) throw new NoSePudo(`el ruleset vivo trae ${archivos.length} archivos`);
  return { contenido: archivos[0].content, id: rel.rulesetName.split('/').pop() };
}

async function canalReglas(tok, canal, release, archivo) {
  try {
    const { contenido, id } = await reglasVivas(tok, release);
    const local = fs.readFileSync(path.join(raiz, archivo), 'utf8');
    if (contenido === local) ok(canal, `${archivo} idéntico a lo vivo (ruleset ${id.slice(0, 8)})`);
    else {
      const dv = contenido.split('\n').length, dl = local.split('\n').length;
      rojo(canal, `lo vivo NO es ${archivo} (ruleset ${id.slice(0, 8)}: ${dv} renglones, el archivo ${dl}) — falta desplegarlo`);
    }
  } catch (e) {
    if (e instanceof NoSePudo) nomedido(canal, e.message);
    else nomedido(canal, `${e.name}: ${e.message}`);
  }
}

// ── Front: el bundle vivo dice con qué commit se compiló ────────────────────
async function canalFront() {
  try {
    const html = await (await traer(SITIO)).text();
    const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
    if (!m) throw new NoSePudo(`no se halló el bundle en ${SITIO}`);
    const js = await (await traer(`${SITIO}/${m[0]}`)).text();
    // Ojo con `\b` al principio: la huella se imprime como `v2026-10-28 · …`
    // y entre `v` y `2` NO hay frontera de palabra, así que `\b` no empata
    // nunca. Costó un «no se pudo medir» con el bundle correcto enfrente.
    const h = js.match(/v?(\d{4}-\d{2}-\d{2}) · ([0-9a-f]{7})/);
    if (!h) throw new NoSePudo(`el bundle ${m[0]} no trae la huella «fecha · commit»`);
    const [, fecha, sha] = h;

    // Si el commit vivo no está en el clon, no se puede comparar. Eso es «no
    // se pudo medir», no «está atrasado»: lo más probable es un `git fetch`
    // pendiente, y declararlo rojo mandaría a buscar donde no es.
    try { git('cat-file', '-e', `${sha}^{commit}`); }
    catch { throw new NoSePudo(`el front vivo es ${sha}, que no está en este clon — corre \`git fetch\``); }

    const dif = git('diff', '--name-only', sha, 'HEAD', '--', ...RUTAS_FRONT);
    if (!dif) ok('front', `${sha} (${fecha}) — sin diferencias con HEAD en lo que compila`);
    else {
      const n = dif.split('\n').length;
      rojo('front', `vivo ${sha} (${fecha}); HEAD tiene ${n} archivo(s) distintos: ${dif.split('\n').slice(0, 3).join(', ')}${n > 3 ? '…' : ''}`);
    }
  } catch (e) {
    if (e instanceof NoSePudo) nomedido('front', e.message);
    else nomedido('front', `${e.name}: ${e.message}`);
  }
}

// ── Funciones: el ZIP de origen que guardó Cloud Functions, una por una ─────
async function canalFunciones(tok) {
  let tmp;
  try {
    try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); }
    catch { throw new NoSePudo('no hay `unzip` para abrir el origen desplegado'); }

    const cab = { Authorization: `Bearer ${tok}`, 'x-goog-user-project': PROYECTO };
    const lista = await (await traer(
      `https://cloudfunctions.googleapis.com/v2/projects/${PROYECTO}/locations/-/functions?pageSize=200`, cab)).json();
    const fns = lista.functions || [];
    if (!fns.length) throw new NoSePudo('la API no devolvió ninguna función');

    const esperado = require('crypto').createHash('sha256')
      .update(fs.readFileSync(path.join(raiz, 'functions', 'index.js'))).digest('hex');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desplegado-'));

    const revisar = async (fn) => {
      const nombre = fn.name.split('/').pop();
      const s = fn.buildConfig?.source?.storageSource
             || fn.buildConfig?.sourceProvenance?.resolvedStorageSource;
      if (!s) return { nombre, estado: 'sin-origen' };
      const url = `https://storage.googleapis.com/storage/v1/b/${s.bucket}/o/` +
        `${encodeURIComponent(s.object)}?alt=media&generation=${s.generation}`;
      const buf = Buffer.from(await (await traer(url, cab)).arrayBuffer());
      const zip = path.join(tmp, `${nombre}.zip`);
      fs.writeFileSync(zip, buf);
      const dentro = execFileSync('unzip', ['-p', zip, 'index.js'], { maxBuffer: 64 * 1024 * 1024 });
      const h = require('crypto').createHash('sha256').update(dentro).digest('hex');
      return { nombre, estado: h === esperado ? 'al-dia' : 'atras' };
    };

    const r = await enTandas(fns, 4, f => revisar(f).catch(e => ({
      nombre: f.name.split('/').pop(), estado: 'error',
      porque: e && e.message ? e.message : String(e) })));

    const malas = r.filter(x => x.estado === 'atras');
    const errores = r.filter(x => x.estado === 'error' || x.estado === 'sin-origen');
    if (errores.length) {
      // Se dice POR QUÉ falló cada una. Un «no se pudieron leer 1 de 17» sin
      // el motivo manda a reproducirlo a mano, y a mano suele funcionar: el
      // modo de fallo vive en el paralelismo, no en la descarga.
      throw new NoSePudo(`${errores.length} de ${r.length} no se pudieron leer:\n` +
        errores.map(x => `           · ${x.nombre}: ${x.porque || x.estado}`).join('\n'));
    }
    if (!malas.length) ok('funciones', `las ${r.length} corren el index.js del repositorio`);
    else rojo('funciones', `${malas.length} de ${r.length} con otro index.js: ` +
      `${malas.map(x => x.nombre).join(', ')} — falta desplegarlas`);
  } catch (e) {
    if (e instanceof NoSePudo) nomedido('funciones', e.message);
    else nomedido('funciones', `${e.name}: ${e.message}`);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── Lo que ni siquiera llegó a un commit ────────────────────────────────────
function canalArbol() {
  const sucio = git('status', '--porcelain', '--', ...RUTAS_DESPLEGABLES);
  if (!sucio) { ok('árbol', 'nada sin commitear en lo que se despliega'); return; }
  const n = sucio.split('\n').length;
  rojo('árbol', `${n} archivo(s) desplegables sin commitear — no están en ningún lado: ` +
    sucio.split('\n').slice(0, 3).map(l => l.slice(3)).join(', '));
}

(async () => {
  console.log(`\nQué está vivo, contra qué dice el repositorio (${PROYECTO})\n`);
  canalArbol();

  let tok = null;
  try { tok = token(); }
  catch (e) {
    for (const c of ['firestore', 'storage', 'funciones']) nomedido(c, e.message);
  }

  await canalFront();
  if (tok) {
    await canalReglas(tok, 'firestore', 'cloud.firestore', 'firestore.rules');
    // El bucket se LEE de la app. Hay un release viejo `firebase.storage` a
    // secas, deny-all sobre el bucket `appspot.com` que ya nadie usa;
    // juzgarlo daría un rojo eterno sobre algo inerte.
    const bucket = (fs.readFileSync(path.join(raiz, 'src', 'App.jsx'), 'utf8')
      .match(/storageBucket:\s*"([^"]+)"/) || [])[1];
    if (!bucket) nomedido('storage', 'no se halló `storageBucket` en src/App.jsx');
    else await canalReglas(tok, 'storage', `firebase.storage/${bucket}`, 'storage.rules');
    await canalFunciones(tok);
  }

  console.log('\n' + '─'.repeat(70));
  if (sinMedir.length) {
    console.log(`NO ARRANCÓ: no se pudo medir ${sinMedir.join(', ')}.`);
    console.log('No se puede decir si están al día. No es verde.');
    process.exit(2);
  }
  if (atrasados) {
    console.log(`${atrasados} canal(es) atrasados: hay arreglos que nadie está recibiendo.`);
    console.log('Los renglones CERRADO de PENDIENTES.md que dependan de ellos son POR DESPLEGAR.');
    process.exit(1);
  }
  console.log('Los cuatro canales corren lo que dice el repositorio.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
