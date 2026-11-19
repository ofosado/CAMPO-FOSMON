#!/usr/bin/env node
// Prueba: la evidencia se ANULA, no se borra — y la foto que se sube deja por
// escrito cómo volver a su objeto en Storage.
//
// Por qué existe. La `×` de la pantalla de captura quitaba la foto del arreglo
// y ahí terminaba todo. Dos consecuencias MEDIDAS en producción el 2026-10-08:
//
//   · 80 objetos en Storage, 27 MiB, que ya no están referenciados por ningún
//     documento. Nadie puede decir a qué partida pertenecían ni quién los
//     subió: son el rastro de la `×`.
//   · el expediente perdía el hecho de que alguien subió algo y alguien lo
//     quitó. En una obra pública eso es parte del expediente (§7.7 del alcance
//     municipal), y por eso las reglas niegan `delete` a todo el mundo.
//
// Y el #30: la única forma de volver al objeto era la URL con token, que trae
// `avance_${clave}__${índice}` dentro del nombre. Con el índice de la partida
// metido en la ruta, mover una partida de lugar en el catálogo deja la foto
// irrecuperable. Desde esta rama cada documento guarda su `rutaStorage`.
//
// No comprueba que el código diga `anulada` ni que exista `rutaStorage`:
// EXTRAE `evid` de App y `addFoto` de Captura, los EJECUTA con un Firestore y
// un Storage de mentira, y afirma lo que queda escrito y lo que la pantalla
// cuenta después.
//
// Uso:  node scripts/prueba-anular-no-borra.cjs [archivo]
//
// El argumento opcional sirve para correrla contra una copia mutilada y
// comprobar que de verdad se pone en ROJO (1) y no en NO ARRANCÓ (2). Las
// contrapruebas corridas están al final de este comentario:
//
//   · `anular` vuelve a BORRAR el documento en vez de marcarlo      → rojo
//   · `agregar` deja de guardar `rutaStorage`                        → rojo
//   · el motivo se acepta vacío (`.length >= 0`)                     → rojo
//   · si la escritura rebota, el objeto de Storage no se rescata     → rojo
//
// Y las de las secciones 8 y 9, corridas el 2026-11-18 — las cinco en ROJO (1),
// ninguna en NO ARRANCÓ:
//
//   · se quita el candado de `addFoto` y vuelve a escribir sin saber
//     la bandera                                                     → rojo
//   · `banderaConocida` se declara `true` siempre                     → rojo
//   · el cruce se hace por la URL COMPLETA y no por la ruta de
//     Storage, que es el error que daría «no está» para una foto que
//     sí está — el token cambió al migrar                            → rojo
//   · `fotosAtrapadasEnElMapa` devuelve siempre `[]`                  → rojo
//   · se acusa también a la obra SIN migrar, donde el mapa es la
//     fuente y se lee entero                                         → rojo

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

// ── Extracción ──────────────────────────────────────────────────────────────
const modulo = {}, dentro = {};
traverse(ast, {
  // Las declaraciones de función también: `fechaDeTimestamp` está hoisteada y
  // quien la llama se declara antes. Sin esto el banco saldría en NO ARRANCÓ
  // por una razón que no tiene nada que ver con lo que afirma.
  FunctionDeclaration(p) {
    if (!p.node.id || p.getFunctionParent()) return;
    const n = p.node.id.name;
    if (!(n in modulo)) modulo[n] = src.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    const n = p.node.id.name;
    const código = src.slice(p.node.init.start, p.node.init.end);
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn) { if (!(n in modulo)) modulo[n] = código; return; }
    const host = fn.node.id.name;
    const llave = `${host}.${n}`;
    if (!(llave in dentro)) dentro[llave] = código;
  },
});

// Lo de nivel de módulo se pide por `fuenteDeApp`, que resuelve el cierre
// transitivo. La lista de abajo nombra lo que este banco QUIERE; lo que eso
// necesita a su vez no se teclea aquí. Tenerlo tecleado fue lo que mató a este
// banco el 2026-10-26: `fechaDeTimestamp` empezó a apoyarse en
// `fechaEnZonaObra`, la lista seguía completa —así que la comprobación de
// abajo no dijo nada— y reventó al ejecutar.
//
// `fuenteDe(archivo, …)` y NO `fuenteDeApp(…)`: este banco acepta un fuente
// MUTILADO por `argv[2]` para que su contraprueba lo corra, y `fuenteDeApp` lee
// siempre `src/App.jsx`. Con `fuenteDeApp` las piezas de nivel de módulo venían
// del archivo BUENO aunque el banco creyera estar midiendo el mutante, así que
// cualquier mutación en `evidenciaNormalizada`, `selloDeEvidencia` o
// `evidenciaDeObra` sobrevivía sin que nadie la viera. Medido el 2026-11-14 al
// escribir la contraprueba de `prueba-la-obra-nace-con-su-expediente`: dos
// mutaciones de nivel de módulo salieron «PASÓ · NADIE la detectó» y la causa
// era ésta. Arreglado en los cuatro bancos que toman el fuente por argumento.
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const PIEZAS_MODULO = ['fechaLocalDeISO', 'semanaISO', 'snapshotId',
  'ORIGEN_LEGADO', 'ORIGEN_EN_VIVO', 'fechaDeTimestamp', 'evidenciaNormalizada',
  'idDePartida', 'evidenciaMigrada', 'evidenciaDeObra', 'evidenciaVigente',
  'fotosAtrapadasEnElMapa',
  'evidenciaDePartida', 'semanaDeEvidencia',
  'MOTIVO_ANULACION_MIN', 'motivoDeAnulacionValido', 'nuevoIdEvidencia',
  'SELLO_VERIFICADA', 'SELLO_LEGADO', 'selloDeEvidencia'];
const PIEZAS_DENTRO = ['App.evid', 'Captura.addFoto', 'Captura.anularFoto'];

let cuerpoModulo;
try {
  cuerpoModulo = fuenteDe(archivo, PIEZAS_MODULO).cuerpo;
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('\nSi la escritura de evidencia se reescribió, este banco hay que rehacerlo');
  console.error('contra el camino nuevo, no borrarlo: lo que afirma sigue siendo cierto.');
  process.exit(1);
}

const falta = PIEZAS_DENTRO.filter(n => !(n in dentro));
if (falta.length) {
  console.error('No se encontraron estas piezas en ' + archivo + ':');
  for (const f of falta) console.error('  · ' + f);
  console.error('\nSi la escritura de evidencia se reescribió, este banco hay que rehacerlo');
  console.error('contra el camino nuevo, no borrarlo: lo que afirma sigue siendo cierto.');
  process.exit(1);
}
const desenvolverMemo = (código) => {
  const m = /^useMemo\s*\(([\s\S]*),\s*\[[^\]]*\]\s*\)$/.exec(código.trim());
  return m ? m[1].trim() : código;
};

// ── El mundo de mentira ─────────────────────────────────────────────────────
// Un Firestore que hace `merge` como el de verdad (`fsSetAEstricto` escribe con
// `{merge:true}`), un Storage que sabe si le pidieron borrar, y los `setX` de
// React convertidos en estado mutable para poder mirarlo después.
const mundo = () => {
  const w = {
    store: new Map(),         // ruta → documento
    escrituras: [],           // [{ruta, data}]
    borrados: [],             // rutas que alguien pidió BORRAR de Firestore
    huerfanasBorradas: [],    // refs de Storage rescatadas
    docsEvidencia: [],
    subs: [],
    cambiosPendientes: false,
    fallarEscritura: false,
    alertas: [],
  };
  w.serverTimestamp = () => ({ __servidor: true });
  // El servidor pone la hora AL LLEGAR, y sólo entonces se puede leer.
  w.fsSetAEstricto = async (ruta, data) => {
    if (w.fallarEscritura) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
    const resuelto = {};
    for (const [k, v] of Object.entries(data))
      resuelto[k] = (v && v.__servidor) ? { seconds: Math.floor(Date.UTC(2026, 9, 8, 17, 0, 0) / 1000) } : v;
    w.store.set(ruta, { ...(w.store.get(ruta) || {}), ...resuelto });
    w.escrituras.push({ ruta, data: resuelto });
    return true;
  };
  w.fsGet = async (ruta) => w.store.get(ruta) || null;
  w.fsDel = async (ruta) => { w.borrados.push(ruta); w.store.delete(ruta); return true; };
  w.setDocsEvidencia = (f) => { w.docsEvidencia = typeof f === 'function' ? f(w.docsEvidencia) : f; };
  w.setSubs = (f) => { w.subs = typeof f === 'function' ? f(w.subs) : f; };
  w.setCambiosPendientes = (v) => { w.cambiosPendientes = v; };
  w.borrarFotoHuerfana = async (ref) => { w.huerfanasBorradas.push(ref && ref.fullPath); };
  w.subidas = [];           // lo que de verdad se subió a Storage
  w.uploadFoto = async (obraId, carpeta, id) => {
    w.subidas.push(`obras/${obraId}/fotos/${carpeta}/${id}`);
    return {
      url: `https://storage/v0/b/campo.appspot.com/o/` +
           encodeURIComponent(`obras/${obraId}/fotos/${carpeta}/${id}`) + `?alt=media&token=abc`,
      ref: { fullPath: `obras/${obraId}/fotos/${carpeta}/${id}` },
    };
  };
  w.alert = (m) => w.alertas.push(String(m));
  return w;
};

const ARGS_EVID = ['useMemo', 'cfgEvidencia', 'docsEvidencia', 'subs', 'obra',
  'evidencia', 'evidenciaCargada',
  'usuario', 'fsSetAEstricto', 'fsGet', 'serverTimestamp', 'setDocsEvidencia',
  'setSubs', 'setCambiosPendientes', 'hoyLocalISO'];

const hacerEvid = new Function(...ARGS_EVID, `"use strict";
${cuerpoModulo}
return (${desenvolverMemo(dentro['App.evid'])})();`);

const ARGS_CAPTURA = ['obra', 'evid', 'setSubs', 'uploadFoto', 'borrarFotoHuerfana',
  'hoyLocalISO', 'alert', 'console'];
const hacerCaptura = new Function(...ARGS_CAPTURA, `"use strict";
${cuerpoModulo}
const addFoto = ${dentro['Captura.addFoto']};
const anularFoto = ${dentro['Captura.anularFoto']};
return { addFoto, anularFoto };`);

const HOY = '2026-10-08';
const hoyLocalISO = () => HOY;
const OBRA = { id: '0126', contrato: '0219-OAX-CBH-08', nombre: 'Malecón' };
const USUARIO = { uid: 'u-super', correo: 'super@minatitlan.gob.mx', nombre: 'Supervisor' };

// Monta el camino entero: `subs`/`docsEvidencia` crudos → `evidencia` → `evid`
// → `addFoto`/`anularFoto`. Es el mismo orden que en la app.
// `migrada` tiene TRES valores, no dos, y antes aquí había dos: `false` se
// montaba como `cfgEvidencia = null`, que no es «sin migrar» sino «todavía no
// se sabe». La app nunca deja la bandera en `null` después de leerla —si el
// documento no existe pone `{migrada:false}`—, así que modelarla así confundía
// el estado que de verdad existe durante unos milisegundos con el estado
// normal de una obra sin migrar. `null` es ese tercer estado y ahora se pide a
// propósito.
const montar = ({ migrada, subs = [], docsEvidencia = [] }) => {
  const w = mundo();
  w.subs = subs;
  w.docsEvidencia = docsEvidencia;
  const cfg = migrada === null ? null : { migrada: migrada === true };
  const rehacer = () => {
    const evidencia = new Function('subs', 'docsEvidencia', 'cfgEvidencia', `"use strict";
${cuerpoModulo}
return evidenciaDeObra({ cfgEvidencia, docsEvidencia, subs });`)(w.subs, w.docsEvidencia, cfg);
    const evid = hacerEvid((fn) => fn(), cfg, w.docsEvidencia, w.subs, OBRA,
      evidencia, true, USUARIO,
      w.fsSetAEstricto, w.fsGet, w.serverTimestamp, w.setDocsEvidencia,
      w.setSubs, w.setCambiosPendientes, hoyLocalISO);
    const cap = hacerCaptura(OBRA, evid, w.setSubs, w.uploadFoto, w.borrarFotoHuerfana,
      hoyLocalISO, w.alert, { error: () => {} });
    return { evidencia, evid, ...cap };
  };
  return { w, rehacer };
};

const vigente = (lista) => new Function('lista', `"use strict";
${cuerpoModulo}
return evidenciaVigente(lista);`)(lista);
const dePartida = (lista, id) => new Function('lista', 'id', `"use strict";
${cuerpoModulo}
return evidenciaDePartida(lista, id);`)(lista, id);
const sello = (ev) => new Function('ev', `"use strict";
${cuerpoModulo}
return selloDeEvidencia(ev);`)(ev);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

(async () => {

// ════════════════════════════════════════════════════════════════════════════
console.log('1. Anular no borra: la foto sigue en el expediente y deja de contar');
// La obra MIGRADA, que es donde la foto es un documento propio.
{
  const doc1 = { id: 'e1', urlOriginal: 'https://storage/a.jpg', rutaStorage: 'obras/0126/fotos/avance_1.1/a',
                 partidaId: 'p1', partidaClave: '1.1', partidaDesc: 'Terracerías',
                 origen: 'captura_en_vivo', capturadaPor: 'u-super',
                 subidaEn: { seconds: Math.floor(Date.UTC(2026, 9, 6, 17, 0, 0) / 1000) } };
  const doc2 = { ...doc1, id: 'e2', urlOriginal: 'https://storage/b.jpg' };
  const { w, rehacer } = montar({ migrada: true, docsEvidencia: [doc1, doc2] });

  let m = rehacer();
  check(vigente(m.evidencia).length === 2, 'de entrada la partida tiene sus 2 fotos',
    `${vigente(m.evidencia).length} vigente(s)`);

  await m.evid.anular(m.evidencia.find(e => e.id === 'e1'), 'es de otra partida, me equivoqué');

  check(w.borrados.length === 0,
    'anular NO pide borrar el documento',
    w.borrados.length ? `pidió borrar ${w.borrados.join(', ')}` : 'ninguna baja');
  check(w.docsEvidencia.length === 2,
    'y el documento sigue en la lista: el expediente conserva los dos',
    `${w.docsEvidencia.length} documento(s)`);

  m = rehacer();
  const anulada = m.evidencia.find(e => e.id === 'e1');
  check(!!anulada, 'la foto anulada se sigue pudiendo encontrar por su id');
  check(anulada && anulada.anulada === true && anulada.motivoAnulacion === 'es de otra partida, me equivoqué',
    'con su motivo escrito, tal como se tecleó',
    anulada && anulada.motivoAnulacion);
  check(vigente(m.evidencia).length === 1,
    'pero la pantalla ya sólo cuenta 1: anulada no es evidencia vigente',
    `${vigente(m.evidencia).length} vigente(s)`);
  check(dePartida(m.evidencia, 'p1').length === 1,
    'y la rejilla de la partida tampoco la pinta',
    `${dePartida(m.evidencia, 'p1').length} en la rejilla`);

  const escrita = w.escrituras[w.escrituras.length - 1];
  check(!!escrita && escrita.data.anuladaPor === USUARIO.correo,
    'queda escrito QUIÉN la anuló', escrita && escrita.data.anuladaPor);
  check(!!escrita && !!escrita.data.anuladaEn,
    'y cuándo, con la hora del servidor',
    escrita && JSON.stringify(escrita.data.anuladaEn));
  // Lo que se escribe tiene que caber en lo que las reglas permiten tocar:
  // `hasOnly(['anulada','motivoAnulacion','anuladaPor','anuladaEn'])`. Una
  // llave de más y la escritura rebota entera en producción.
  const PERMITIDAS = ['anulada', 'motivoAnulacion', 'anuladaPor', 'anuladaEn'];
  const sobra = escrita ? Object.keys(escrita.data).filter(k => !PERMITIDAS.includes(k)) : ['(no escribió)'];
  check(sobra.length === 0,
    'y el parche sólo toca los cuatro campos que las reglas permiten',
    sobra.length ? `sobra(n): ${sobra.join(', ')}` : PERMITIDAS.join(', '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. Sin motivo no se anula nada');
// Un campo que acepta un punto es un campo opcional con pasos extra. El motivo
// es lo ÚNICO que dentro de un año va a explicar por qué esa foto no cuenta.
{
  const doc1 = { id: 'e1', urlOriginal: 'https://storage/a.jpg', partidaId: 'p1',
                 origen: 'captura_en_vivo', capturadaPor: 'u-super', subidaEn: { seconds: 1 } };
  const { w, rehacer } = montar({ migrada: true, docsEvidencia: [doc1] });
  const m = rehacer();
  for (const malo of ['', '   ', 'mal', 'error.']) {
    let err = null;
    try { await m.evid.anular(m.evidencia[0], malo); } catch (e) { err = e; }
    check(!!err, `«${malo}» no alcanza para anular`, err ? 'rebotó' : 'ANULÓ');
  }
  check(w.escrituras.length === 0,
    'y ninguno de los cuatro intentos escribió nada',
    `${w.escrituras.length} escritura(s)`);
  check(vigente(rehacer().evidencia).length === 1,
    'la foto sigue contando como evidencia');
  // Un motivo de verdad sí pasa — si no, lo de arriba sería verde con el botón
  // roto del todo.
  await m.evid.anular(m.evidencia[0], 'foto repetida de la misma trabe');
  check(w.escrituras.length === 1, 'y un motivo escrito de verdad sí anula',
    `${w.escrituras.length} escritura(s)`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. La obra que todavía no se migró tampoco borra');
// El despliegue del front y la migración son dos permisos distintos y pueden
// pasar con días en medio. Si en ese hueco la `×` siguiera borrando, el día de
// la migración faltarían fotos y nadie podría decir cuáles.
{
  const subs = [{ id: 'p1', sec: '1.1', sub: 'Terracerías', fotos: { p1: [
    { id: 'f1', url: 'https://storage/a.jpg', fecha: '2026-09-22' },
    { id: 'f2', url: 'https://storage/b.jpg', fecha: '2026-09-23' },
  ] } }];
  const { w, rehacer } = montar({ migrada: false, subs });
  let m = rehacer();
  check(m.evid.migrada === false, 'la obra se lee sin migrar');
  check(vigente(m.evidencia).length === 2, 'con sus 2 fotos del mapa incrustado');

  await m.evid.anular(m.evidencia.find(e => e.id === 'f1'), 'salió borrosa, no se ve nada');

  check(w.escrituras.length === 0,
    'no escribe a la subcolección: la obra no está migrada',
    `${w.escrituras.length} escritura(s)`);
  check(w.subs[0].fotos.p1.length === 2,
    'y el arreglo del mapa sigue teniendo las DOS fotos',
    `${w.subs[0].fotos.p1.length} foto(s)`);
  const cruda = w.subs[0].fotos.p1.find(f => f.id === 'f1');
  check(!!cruda && cruda.anulada === true && cruda.motivoAnulacion === 'salió borrosa, no se ve nada',
    'la anulación se guarda DENTRO de la foto, con su motivo',
    cruda && cruda.motivoAnulacion);
  check(w.cambiosPendientes === true,
    'y queda marcado que hay algo por guardar: si no, se perdería al salir');

  m = rehacer();
  check(vigente(m.evidencia).length === 1,
    'la galería ya sólo cuenta 1',
    `${vigente(m.evidencia).length} vigente(s)`);
  check(m.evidencia.length === 2,
    'aunque la evidencia completa siga siendo de 2',
    `${m.evidencia.length} en total`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. La foto que se sube deja escrito cómo volver a su objeto (#30)');
{
  const partida = { id: 'p7', sec: '3.4', sub: 'Carpeta asfáltica' };
  const { w, rehacer } = montar({ migrada: true, docsEvidencia: [] });
  const m = rehacer();
  await m.addFoto(partida, { id: 'nueva1', url: 'data:image/jpeg;base64,AAAA' });

  check(w.escrituras.length === 1, 'la foto se escribe como documento propio',
    `${w.escrituras.length} escritura(s)`);
  const d = w.escrituras[0] ? w.escrituras[0].data : {};
  check(!!d.rutaStorage,
    'y guarda `rutaStorage`: sin ella el objeto sólo se alcanza por la URL con token',
    d.rutaStorage || 'NO LA GUARDÓ');
  check(d.rutaStorage === 'obras/0126/fotos/avance_p7/nueva1',
    'que es la ruta real del objeto, la que devolvió Storage', d.rutaStorage);
  // Lo que cierra el #30: la ruta guardada NO depende de dónde esté la partida
  // en el catálogo. Mover la partida de lugar no la invalida.
  check(!/__\d+/.test(String(d.rutaStorage)),
    'y no lleva el ÍNDICE de la partida dentro, que es lo que la rompía al reordenar',
    String(d.rutaStorage));
  check(d.partidaId === 'p7' && d.partidaClave === '3.4',
    'el documento sabe de qué partida es, por id Y por clave',
    `${d.partidaId} / ${d.partidaClave}`);

  // Y no se inventa una hora de disparo. `subidaEn` es cuándo llegó; lo que
  // dijo el teléfono vive aparte y con nombre de declarado.
  check(d.capturadaEn === undefined,
    'no escribe `capturadaEn`: la hora del disparo no la sabe nadie',
    d.capturadaEn === undefined ? 'ausente' : JSON.stringify(d.capturadaEn));
  check(d.fechaDeclarada === HOY,
    'la fecha del teléfono se guarda como DECLARADA', d.fechaDeclarada);
  check(!!d.subidaEn, 'y la del servidor como `subidaEn`');
  check(d.capturadaPor === USUARIO.uid, 'con el autor, que el legado nunca va a tener',
    d.capturadaPor);
  check(d.anulada === false, 'y nace sin anular, no sin el campo');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. Si Firestore rebota, el objeto de Storage no se queda huérfano');
// Los 80 huérfanos de producción se juntaron así: nada los limpiaba. Con la
// obra migrada el commit es una escritura REAL y puede negarse por reglas, que
// es justamente lo que pasó tres años con el histórico de subcontratos (#31).
{
  const partida = { id: 'p7', sec: '3.4', sub: 'Carpeta asfáltica' };
  const { w, rehacer } = montar({ migrada: true, docsEvidencia: [] });
  w.fallarEscritura = true;
  const m = rehacer();
  await m.addFoto(partida, { id: 'nueva1', url: 'data:image/jpeg;base64,AAAA' });

  check(w.huerfanasBorradas.length === 1,
    'el objeto que ya se había subido se borra de Storage',
    w.huerfanasBorradas.length ? w.huerfanasBorradas[0] : 'SE QUEDÓ HUÉRFANO');
  check(w.huerfanasBorradas[0] === 'obras/0126/fotos/avance_p7/nueva1',
    'y se borra el objeto correcto, no otro', w.huerfanasBorradas[0]);
  check(w.alertas.length === 1,
    'y al supervisor se le dice que falló: no se guarda en silencio',
    w.alertas[0] || 'NO DIJO NADA');
  check(w.docsEvidencia.length === 0,
    'y la pantalla no se queda con una foto que no existe en ninguna parte');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. Dos fotos a la vez no se pisan');
// El selector de archivos acepta varias y las lee en paralelo. Con un id
// sacado del reloj, dos fotos del mismo milisegundo se escribirían encima la
// una de la otra y una de las dos se perdería sin aviso.
{
  const partida = { id: 'p7', sec: '3.4', sub: 'Carpeta' };
  const { w, rehacer } = montar({ migrada: true, docsEvidencia: [] });
  const m = rehacer();
  await Promise.all([
    m.addFoto(partida, { id: 'a', url: 'data:image/jpeg;base64,AAAA' }),
    m.addFoto(partida, { id: 'b', url: 'data:image/jpeg;base64,BBBB' }),
    m.addFoto(partida, { id: 'c', url: 'data:image/jpeg;base64,CCCC' }),
  ]);
  const rutas = new Set(w.escrituras.map(e => e.ruta));
  check(rutas.size === 3, 'tres fotos simultáneas son tres documentos distintos',
    `${rutas.size} ruta(s) para ${w.escrituras.length} escritura(s)`);
  check(w.store.size === 3, 'y las tres quedan guardadas', `${w.store.size} en el almacén`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n7. El sello no presume de lo que no se puede demostrar');
// Una foto de legado con la misma insignia que una captura en vivo sería el
// mismo error que mostrar cero cuando falta el dato.
{
  const legado = { id: 'v1', urlOriginal: 'https://storage/a.jpg', partidaId: 'p1',
                   origen: 'legado', fechaDeclarada: '2026-09-22' };
  const viva = { id: 'n1', urlOriginal: 'https://storage/b.jpg', partidaId: 'p1',
                 origen: 'captura_en_vivo', capturadaPor: 'u-super', subidaEn: { seconds: 1 } };
  const sinAutor = { ...viva, id: 'n2', capturadaPor: '' };
  const sinServidor = { ...viva, id: 'n3', subidaEn: null };
  const { rehacer } = montar({ migrada: true,
    docsEvidencia: [legado, viva, sinAutor, sinServidor] });
  const ev = rehacer().evidencia;
  const porId = (id) => ev.find(e => e.id === id);

  check(sello(porId('n1')).verificada === true && sello(porId('n1')).texto === modulo.SELLO_VERIFICADA.slice(1, -1),
    'la captura en vivo con autor y hora de servidor dice «verificada»',
    sello(porId('n1')).texto);
  check(sello(porId('v1')).verificada === false,
    'la de legado NO', sello(porId('v1')).texto);
  check(sello(porId('n2')).verificada === false,
    'ni una con hora de servidor pero SIN autor', sello(porId('n2')).texto);
  check(sello(porId('n3')).verificada === false,
    'ni una con autor pero sin hora de servidor: hacen falta las dos',
    sello(porId('n3')).texto);
  check(new Set(ev.map(e => sello(e).texto)).size === 2,
    'y los dos sellos se distinguen por TEXTO, no sólo por color (#36)',
    [...new Set(ev.map(e => sello(e).texto))].join(' | '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n8. Una obra migrada no se traga las fotos que quedaron en el mapa');
// Pasó de verdad: la bandera de la 0114 subió el 2026-10-09 y el front que
// escribe a la subcolección llegó al navegador el 14. Catorce capturas de esos
// cinco días cayeron en el mapa, y una obra migrada no lo lee: desaparecieron
// de la galería, del PDF y del tablero. Cinco semanas sin que nada lo dijera.
{
  const RUTA_A = 'obras/0126/fotos/avance_p1/a';
  const RUTA_B = 'obras/0126/fotos/avance_p1/b';
  const urlDe = (r, tok) => `https://storage/v0/b/campo.appspot.com/o/` +
    encodeURIComponent(r) + `?alt=media&token=${tok}`;
  // El documento guarda la ruta; el mapa guarda una URL con OTRO token. Es el
  // caso real: la migración no tenía por qué conservar el token, así que cruzar
  // por la URL completa diría «no está» de una foto que sí está.
  const doc = { id: 'e1', urlOriginal: urlDe(RUTA_A, 'nuevo'), rutaStorage: RUTA_A,
                partidaId: 'p1', partidaClave: '1.1', origen: 'legado',
                fechaDeclarada: '2026-09-22' };
  const subs = [{ id: 'p1', sec: '1.1', sub: 'Terracerías', fotos: { p1: [
    { id: 'f1', url: urlDe(RUTA_A, 'viejo'), fecha: '2026-09-22' },
    { id: 'f2', url: urlDe(RUTA_B, 'viejo'), fecha: '2026-10-09' },
  ] } }];

  const m = montar({ migrada: true, subs, docsEvidencia: [doc] }).rehacer();
  check(m.evid.atrapadas.length === 1,
    'la foto del mapa que NO tiene documento se nombra',
    `${m.evid.atrapadas.length} atrapada(s)`);
  check(m.evid.atrapadas[0] && m.evid.atrapadas[0].ruta === RUTA_B,
    'y es la que falta, no la otra', m.evid.atrapadas[0] && m.evid.atrapadas[0].ruta);
  check(m.evid.atrapadas[0] && m.evid.atrapadas[0].sec === '1.1',
    'con su partida, que es lo que hace falta para pedir el rescate',
    m.evid.atrapadas[0] && m.evid.atrapadas[0].sec);
  // La aserción que delata el cruce por URL completa: el token difiere.
  check(!m.evid.atrapadas.some(f => f.ruta === RUTA_A),
    'la que sí tiene documento NO se cuenta, aunque su URL traiga otro token',
    `tokens distintos: ${urlDe(RUTA_A, 'viejo') !== doc.urlOriginal}`);
  check(m.evidencia.length === 1,
    'la galería sigue enseñando sólo lo que está en el expediente — el aviso no las monta',
    `${m.evidencia.length} en la galería`);

  // Sin migrar el mapa ES la fuente y se lee entero: ahí no hay nada atrapado.
  const sinMigrar = montar({ migrada: false, subs, docsEvidencia: [] }).rehacer();
  check(sinMigrar.evid.atrapadas.length === 0,
    'en una obra SIN migrar no hay nada atrapado: el mapa es la fuente y se lee',
    `${sinMigrar.evid.atrapadas.length}`);
  check(vigente(sinMigrar.evidencia).length === 2,
    'y ahí sí se ven las dos fotos del mapa');

  // Y mientras la bandera no se sabe, no se afirma nada.
  const sinSaber = montar({ migrada: null, subs, docsEvidencia: [] }).rehacer();
  check(sinSaber.evid.atrapadas.length === 0,
    'y con la bandera sin leer tampoco se acusa: no se sabe de qué lado está la obra',
    `${sinSaber.evid.atrapadas.length}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n9. Mientras no se sepa la bandera, la foto no se guarda en ningún lado');
// `evidenciaMigrada(null)` es falso, así que una captura ocurrida antes de que
// llegue la bandera se iba al mapa incrustado de una obra que puede estar
// migrada — donde ninguna pantalla la lee. La ventana es de milisegundos y el
// precio es una foto invisible, así que se para y se dice.
{
  const partida = { id: 'p7', sec: '3.4', sub: 'Carpeta asfáltica' };
  const { w, rehacer } = montar({ migrada: null, docsEvidencia: [] });
  const m = rehacer();
  await m.addFoto(partida, { id: 'nueva1', url: 'data:image/jpeg;base64,AAAA' });

  check(w.subidas.length === 0,
    'ni siquiera sube el objeto a Storage: pararse después dejaría un huérfano',
    w.subidas.length ? w.subidas.join(', ') : 'ninguna subida');
  check(w.escrituras.length === 0, 'no escribe a la subcolección',
    `${w.escrituras.length} escritura(s)`);
  check(w.subs.length === 0,
    'y NO la mete en el mapa incrustado, que es donde se volvía invisible',
    JSON.stringify(w.subs).slice(0, 60));
  check(w.alertas.length === 1,
    'y se le dice al supervisor que lo intente otra vez — no se pierde en silencio',
    w.alertas[0] || 'NO DIJO NADA');

  // Y la simétrica, que es la que impide que esto sea «no guardar nunca»: con
  // la bandera YA leída y la obra sin migrar, la misma captura sí entra al mapa.
  const b = montar({ migrada: false, subs: [{ id: 'p7', sec: '3.4', fotos: {} }] });
  const m2 = b.rehacer();
  await m2.addFoto(partida, { id: 'nueva1', url: 'data:image/jpeg;base64,AAAA' });
  check(b.w.subidas.length === 1,
    'con la bandera leída la foto sí se sube', `${b.w.subidas.length} subida(s)`);
  check(((b.w.subs[0] || {}).fotos || {}).p7?.length === 1,
    'y entra al mapa, que en una obra sin migrar es su sitio',
    JSON.stringify((b.w.subs[0] || {}).fotos || {}).slice(0, 80));
}

console.log(fallas === 0
  ? '\nLa evidencia se anula con motivo, nunca se borra, y sabe volver a su objeto.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);

})();
