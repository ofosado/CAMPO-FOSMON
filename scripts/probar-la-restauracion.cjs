#!/usr/bin/env node
// PROBAR QUE UN RESPALDO SE PUEDE RESTAURAR — SIN TOCAR LA BASE DE PRODUCCIÓN
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
// El #5. Los respaldos se escriben solos cada domingo y están verificados
// como ESCRITOS. El del 2026-11-22 incluso está verificado como COMPLETO —su
// manifiesto nombra 62 archivos, los 62 están, ninguno vacío—. Lo que nunca
// se ha hecho es LEERLO DE VUELTA, y un respaldo que nadie restauró no consta
// que sirva: puede estar entero, corrupto o a medias y se ve igual desde
// fuera. Caducan a los 112 días.
//
// `probarBackup` no contesta esto: medido el 2026-10-23, llama al mismo
// `ejecutarBackupFirestore` que el cron, o sea que hace OTRO export.
//
// ── EL CANDADO, QUE ES LA RAZÓN DE QUE ESTO SEA UN GUION Y NO UN COMANDO ────
//
// Importar apunta a una base. Un `--database` mal escrito mete los 7,748
// documentos del respaldo ENCIMA DE PRODUCCIÓN. No es una hipótesis: el
// 2026-10-09 se escribieron 270 documentos en producción por olvidar una
// variable de entorno, y ésta es la misma clase de error con un cero más.
//
// Cuatro candados, y el cuarto es el que de verdad cierra:
//
//   1. El destino se pasa SIEMPRE y a mano. No hay valor por omisión: un
//      guion que adivina su destino es el defecto.
//   2. `(default)` está prohibido por nombre, en cualquier forma en que se
//      escriba, y el guion muere antes de hablar con nadie.
//   3. El nombre tiene que casar con `restauracion-…`. Cualquier otra cosa
//      —un nombre de producción, un dedazo— no pasa.
//   4. LA URL DE IMPORTACIÓN NO SE CONSTRUYE CONCATENANDO lo que me dieron:
//      se le pide la base a la API, y se usa EL NOMBRE DE RECURSO QUE ELLA
//      DEVUELVE. Si lo que vuelve no es exactamente la base que pedí, o si
//      termina en `(default)`, no se importa. Así, entre lo que yo tecleé y
//      lo que se escribe hay una comprobación contra el servidor y no contra
//      mi propia variable — que es la lección de «una comparación vale por
//      sus dos lados».
//
// Y nada de esto se escribe sin `--importar`. Sin esa bandera el guion dice
// lo que haría y se calla.
//
// Uso:
//   node scripts/probar-la-restauracion.cjs --candado        (prueba el candado)
//   node scripts/probar-la-restauracion.cjs --base=restauracion-prueba --crear
//   node scripts/probar-la-restauracion.cjs --base=restauracion-prueba \
//        --desde=gs://campo-fosmon-backups/firestore/2026-11-22 --importar
//   node scripts/probar-la-restauracion.cjs --base=restauracion-prueba --verificar

'use strict';

const { execFileSync } = require('child_process');

const PROYECTO = 'campo-fosmon';
const UBICACION = 'us-central1';

// ── EL CANDADO ──────────────────────────────────────────────────────────────

const PROHIBIDAS = [
  '(default)', 'default', '', '-', '*', 'null', 'undefined',
];
const FORMA = /^restauracion-[a-z0-9][a-z0-9-]{2,38}$/;

class Candado extends Error {}

// Lo único que decide si un nombre puede recibir escrituras. Vive aparte,
// sin red y sin estado, para poder EJECUTARLO contra los nombres peligrosos
// en vez de confiar en que lo escribí bien.
function destinoAceptable(nombre) {
  const n = String(nombre == null ? '' : nombre).trim();
  if (!n) throw new Candado('no se dio base de destino, y no hay ninguna por omisión');
  if (PROHIBIDAS.includes(n.toLowerCase())) {
    throw new Candado(`«${n}» es la base de producción o un alias suyo: aquí nunca se escribe`);
  }
  // Los paréntesis sólo aparecen en `(default)`. Cualquier variante
  // —`(DEFAULT)`, `(default) `— cae aquí aunque no esté en la lista.
  if (/[()]/.test(n)) throw new Candado(`«${n}» lleva paréntesis: eso sólo lo tiene (default)`);
  if (!FORMA.test(n)) {
    throw new Candado(`«${n}» no tiene la forma «restauracion-…». Una base de prueba se ` +
      'llama como lo que es, para que nadie la confunda con una de verdad');
  }
  return n;
}

// ── LA PRUEBA DEL PROPIO CANDADO ────────────────────────────────────────────
// Se corre ANTES de usarlo, y el guion se niega a seguir si alguno pasa.
const PELIGROSOS = [
  '(default)', '(DEFAULT)', ' (default) ', 'default', 'DEFAULT', '',
  '   ', null, undefined, '-', 'campo-fosmon', 'produccion', 'prod',
  'restauracion', 'restauracion_prueba', 'Restauracion-Prueba',
  '../(default)', '(default)/../restauracion-x',
];
const SANOS = ['restauracion-prueba', 'restauracion-2026-11-22', 'restauracion-del-domingo'];

function probarElCandado({ ruidoso = true } = {}) {
  const colados = [];
  for (const n of PELIGROSOS) {
    try { destinoAceptable(n); colados.push(String(n)); }
    catch (e) { if (!(e instanceof Candado)) throw e; }
  }
  const rechazados = [];
  for (const n of SANOS) {
    try { destinoAceptable(n); } catch { rechazados.push(n); }
  }
  if (ruidoso) {
    console.log(`candado: ${PELIGROSOS.length} nombres peligrosos, ` +
      `${colados.length} colados · ${SANOS.length} sanos, ${rechazados.length} rechazados`);
  }
  if (colados.length || rechazados.length) {
    console.error('\nEL CANDADO NO SIRVE. No se toca nada.');
    for (const n of colados) console.error(`  · dejó pasar «${n}»`);
    for (const n of rechazados) console.error(`  · rechazó «${n}», que es válido`);
    process.exit(2);
  }
}

// ── HABLAR CON GOOGLE ───────────────────────────────────────────────────────

const token = () => execFileSync('gcloud',
  ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim();

async function api(url, { metodo = 'GET', cuerpo = null } = {}) {
  const r = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token()}`,
      'X-Goog-User-Project': PROYECTO,
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${metodo} ${url.split('/').slice(-1)[0]} → ${r.status}: ` +
    `${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// EL CANDADO Nº4. Devuelve el nombre de recurso QUE DIO EL SERVIDOR, nunca
// uno armado aquí, y sólo si coincide con el que se pidió.
async function recursoDeLaBase(destino) {
  const n = destinoAceptable(destino);
  const d = await api(`https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/${encodeURIComponent(n)}`);
  const nombre = String(d.name || '');
  const cola = nombre.split('/databases/')[1];
  if (cola !== n) {
    throw new Candado(`pedí «${n}» y el servidor devolvió «${cola}». No se escribe nada.`);
  }
  if (/\(default\)\s*$/.test(nombre)) {
    throw new Candado(`el recurso devuelto es la base de producción: ${nombre}`);
  }
  return nombre;
}

// ── LOS PASOS ───────────────────────────────────────────────────────────────

async function crear(destino) {
  const n = destinoAceptable(destino);
  console.log(`creando la base «${n}» en ${PROYECTO} (${UBICACION})…`);
  const r = await api(
    `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases?databaseId=${encodeURIComponent(n)}`,
    { metodo: 'POST', cuerpo: { type: 'FIRESTORE_NATIVE', locationId: UBICACION } });
  console.log('  operación:', r.name || JSON.stringify(r).slice(0, 160));
}

async function importar(destino, desde) {
  const recurso = await recursoDeLaBase(destino);       // candado 4
  if (!/^gs:\/\/[a-z0-9._-]+\/.+/.test(String(desde || ''))) {
    throw new Candado(`«${desde}» no parece un prefijo de export en Cloud Storage`);
  }
  console.log(`importando\n  de : ${desde}\n  a  : ${recurso}`);
  const r = await api(`https://firestore.googleapis.com/v1/${recurso}:importDocuments`,
    { metodo: 'POST', cuerpo: { inputUriPrefix: desde } });
  console.log('  operación:', r.name);
  return r.name;
}

// Cuenta lo que llegó con el MISMO método con que se contó el original: un
// export de la base restaurada, cuya operación reporta los documentos. Dos
// números medidos igual se pueden comparar; uno contado con aggregaciones y
// otro con un export, no del todo.
async function exportarParaContar(destino, aDonde) {
  const recurso = await recursoDeLaBase(destino);
  const r = await api(`https://firestore.googleapis.com/v1/${recurso}:exportDocuments`,
    { metodo: 'POST', cuerpo: { outputUriPrefix: aDonde } });
  return r.name;
}

async function esperar(operacion, { plazoMs = 20 * 60 * 1000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const o = await api(`https://firestore.googleapis.com/v1/${operacion}`);
    const m = o.metadata || {};
    if (o.done) return { ok: !o.error, estado: m.operationState, meta: m, error: o.error };
    if (Date.now() - t0 > plazoMs) {
      return { ok: false, estado: 'SIN VERIFICAR', meta: m,
        error: { message: `no terminó en ${Math.round((Date.now() - t0) / 1000)} s` } };
    }
    console.log(`  … ${m.operationState || 'en curso'}` +
      (m.progressDocuments ? ` · ${m.progressDocuments.completedWork || 0} docs` : ''));
    await new Promise(r => setTimeout(r, 15000));
  }
}

// Lee un documento de la base que se diga. Sirve para comparar producción
// contra lo restaurado: un conteo igual no prueba que el CONTENIDO volvió.
async function leerDoc(base, ruta) {
  const b = base === '(default)' ? '(default)' : destinoAceptable(base);
  const url = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/${encodeURIComponent(b)}/documents/${ruta}`;
  try { return await api(url); } catch (e) { return { _error: e.message }; }
}

// ── MAIN ────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const val = (k) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
  const tiene = (k) => args.includes(`--${k}`);

  // El candado se prueba SIEMPRE, antes de cualquier otra cosa.
  probarElCandado({ ruidoso: true });
  if (tiene('candado')) {
    console.log('El candado sirve. Nada más se hizo.');
    return;
  }

  const base = val('base');
  try { destinoAceptable(base); }
  catch (e) { console.error(`\nCANDADO: ${e.message}`); process.exit(2); }

  if (tiene('crear')) await crear(base);

  // Borrar pasa por el MISMO candado que escribir, y por el candado nº4: el
  // recurso que se borra es el que devolvió el servidor, no uno armado aquí.
  // Un borrado mal apuntado es peor que una escritura mal apuntada.
  if (tiene('borrar')) {
    const recurso = await recursoDeLaBase(base);
    console.log(`borrando ${recurso} …`);
    const r = await api(`https://firestore.googleapis.com/v1/${recurso}`, { metodo: 'DELETE' });
    console.log('  operación:', r.name || JSON.stringify(r).slice(0, 160));
  }

  if (tiene('importar')) {
    const desde = val('desde');
    const op = await importar(base, desde);
    const fin = await esperar(op);
    console.log(`import: ${fin.ok ? 'OK' : 'FALLÓ'} · estado=${fin.estado}` +
      (fin.error ? ` · ${JSON.stringify(fin.error).slice(0, 200)}` : ''));
    if (!fin.ok) process.exit(1);
  }

  if (tiene('verificar')) {
    const aDonde = val('a') || `gs://campo-fosmon-backups/verificacion/${base}-${Date.now()}`;
    console.log(`contando lo restaurado con un export a ${aDonde}…`);
    const op = await exportarParaContar(base, aDonde);
    const fin = await esperar(op);
    const docs = fin.meta?.progressDocuments?.completedWork;
    console.log(`export de verificación: ${fin.ok ? 'OK' : 'FALLÓ'} · documentos = ${docs ?? '(no dijo)'}`);
    if (!fin.ok) process.exit(1);
  }

  if (tiene('comparar')) {
    // Dos arreglos a la forma ingenua de comparar, y los dos los encontró la
    // primera corrida contra datos de verdad:
    //
    // 1. `JSON.stringify` depende del ORDEN DE LAS LLAVES, y Firestore no
    //    promete orden. `orgs/coatzacoalcos/config/branding` salió «DIFIERE»
    //    teniendo exactamente el mismo contenido con `empresa` y
    //    `empresaCorta` al revés. Una comparación que grita por el orden no
    //    mide el contenido: mide el orden.
    //
    // 2. Se comparaba contra producción DE HOY, y el respaldo es del domingo.
    //    Producción lleva dos días moviéndose —la 0112 se cerró, el registro
    //    de salud se escribe a diario—, así que una diferencia ahí no dice
    //    nada sobre la restauración. Lo que la explica es el `updateTime` del
    //    documento en producción: si cambió DESPUÉS del respaldo, la
    //    diferencia es de producción, no del respaldo.
    //
    // Sólo «DIFIERE SIN EXPLICAR» —contenido distinto en un documento que
    // producción no ha tocado desde el respaldo— significaría que lo
    // restaurado no es lo que se guardó. Ésa es la única categoría que
    // contesta el #5 en rojo.
    const canon = (v) => {
      if (Array.isArray(v)) return v.map(canon);
      if (v && typeof v === 'object') {
        return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
      }
      return v;
    };
    const texto = (d) => JSON.stringify(canon(d.fields || d._error || null));

    const CORTE = Date.parse(val('corte') || '2026-11-22T09:01:30Z');
    const rutas = (val('rutas') || 'obras/0112/config/info,global/health').split(',');
    let iguales = 0, movidos = 0, sinExplicar = 0;

    for (const ruta of rutas) {
      const [prod, rest] = await Promise.all([leerDoc('(default)', ruta), leerDoc(base, ruta)]);
      const a = texto(prod), b = texto(rest);
      if (a === b) {
        iguales++;
        console.log(` IGUAL    ${ruta}  ·  ${a.length} caracteres de campos, idénticos`);
        continue;
      }
      const tProd = Date.parse(prod.updateTime || '');
      const movido = Number.isFinite(tProd) && tProd > CORTE;
      if (movido) {
        movidos++;
        console.log(` movido   ${ruta}  ·  producción lo tocó el ` +
          `${String(prod.updateTime).slice(0, 19)}, después del respaldo — la diferencia es suya`);
      } else {
        sinExplicar++;
        console.log(`DIFIERE SIN EXPLICAR  ${ruta}  ·  producción no lo ha tocado desde el respaldo` +
          ` (updateTime=${prod.updateTime || 'ilegible'})` +
          `\n   prod: ${a.slice(0, 260)}\n   rest: ${b.slice(0, 260)}`);
      }
    }
    console.log(`\n${iguales} idénticos · ${movidos} que producción movió después · ` +
      `${sinExplicar} sin explicar`);
    if (sinExplicar > 0) process.exit(1);
  }
})().catch(e => {
  console.error(`\n${e instanceof Candado ? 'CANDADO' : 'NO ARRANCÓ'}: ${e.message}`);
  process.exit(2);
});
