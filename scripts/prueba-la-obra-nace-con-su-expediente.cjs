#!/usr/bin/env node
// Prueba: una obra dada de alta hoy nace con su expediente de evidencia, y la
// primera foto que le suben sale con autor y con hora del servidor.
//
// ── EL DEFECTO (#143) ──────────────────────────────────────────────────────
//
// `obras/{id}/config/evidencia.migrada` decide A DÓNDE va una foto: a su propio
// documento en `obras/{id}/evidencia` —con `origen`, `capturadaPor`, `subidaEn`
// y `rutaStorage`— o al mapa incrustado de `avance/subs`, donde una foto son
// tres campos: `fecha`, `id`, `url`.
//
// Esa bandera se escribía en UN SOLO SITIO de todo el repositorio:
// `scripts/migrar-evidencia-subcoleccion.cjs:573`, al terminar de migrar una
// obra que ya existía. El alta no la escribía. Consecuencia: toda obra creada
// desde el día de la migración nacía en el camino viejo, y nadie lo vio porque
// el alta termina bien — lo que faltaba era algo que nunca apareció.
//
// Medido en el emulador el 2026-11-14 recorriendo el #69, sobre `OB-2026-TMFOU0`
// creada por la propia pantalla de alta: `config/evidencia` contestaba 404, la
// subcolección `evidencia` estaba vacía, y la foto que un `director_obras` con
// nombre y sesión acababa de subir tenía exactamente `['fecha','id','url']`. La
// galería la rotulaba «de archivo · Subida antes de que la app registrara autor.
// No se puede saber quién la tomó.» Las dos frases son falsas, y la segunda
// viaja al PDF que se le entrega al cliente.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
//
// No que exista una llamada a `fsSet` con la cadena `config/evidencia`. EXTRAE
// `agregarObra` de `PantallaObras`, la EJECUTA contra un Firestore de mentira,
// y después toma el documento QUE ELLA ESCRIBIÓ y lo mete como `cfgEvidencia`
// en el `evidenciaDeObra` de verdad, y sube una foto por el `evid.agregar` y el
// `Captura.addFoto` de verdad. Lo que se afirma es el rótulo que acaba en
// pantalla. Si mañana alguien cambia el nombre del campo, o la bandera, o el
// sitio del documento, las dos mitades dejan de encajar y esto se pone rojo sin
// que haya que acordarse de este archivo.
//
// Las secciones 3 y 4 son las del orden. La bandera se escribe PRIMERO y el
// alta aborta si rebota, porque al revés —obra creada y bandera fallida— deja
// el defecto consumado sin vuelta atrás: habría que migrar una obra de un día.
// Fallando antes no existe nada que arreglar.
//
// Uso:  node scripts/prueba-la-obra-nace-con-su-expediente.cjs [archivo]
//
// El argumento opcional corre el banco contra una copia mutilada, que es cómo
// se comprueba que de verdad sale ROJO (1) y no NO ARRANCÓ (2). Las
// contrapruebas corridas están en
// `scripts/contraprueba-la-obra-nace-con-su-expediente.cjs`.

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

// `argv.slice(2)` lleva también las banderas (`--contraprueba`), así que el
// fuente se toma del primer argumento que NO sea una: pasarle `--contraprueba`
// a `readFileSync` salía NO ARRANCÓ con un ENOENT, y eso no es una medición.
const archivo = process.argv.slice(2).find(a => !a.startsWith('--'))
  || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

// ── Extracción ──────────────────────────────────────────────────────────────
const dentro = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    const n = p.node.id.name;
    const código = src.slice(p.node.init.start, p.node.init.end);
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn) return;
    const llave = `${fn.node.id.name}.${n}`;
    if (!(llave in dentro)) dentro[llave] = código;
  },
});

// `fuenteDe` y NO `fuenteDeApp`, y es la diferencia entre medir y no medir:
// `fuenteDeApp` lee siempre `src/App.jsx`, así que un mutante pasado por
// `argv[2]` no afectaba a nada de nivel de módulo. Medido al correr la
// contraprueba la primera vez: las dos mutaciones del corte por obra
// —`evidenciaMigrada` y la rama de `evidenciaDeObra`— SOBREVIVIERON, porque el
// banco seguía ejecutando el código bueno del archivo de verdad.
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');

// Lo de nivel de módulo se pide por nombre y el cierre transitivo lo resuelve
// `fuenteDe`: tener la lista de dependencias tecleada aquí sería una segunda
// copia del grafo, y las copias se desincronizan (ver el preámbulo de ese
// módulo, y los tres bancos que murieron por eso el 2026-10-26).
const PIEZAS_MODULO = ['evidenciaMigrada', 'evidenciaDeObra', 'evidenciaNormalizada',
  'evidenciaVigente', 'selloDeEvidencia', 'SELLO_LEGADO', 'SELLO_VERIFICADA',
  'fraseOrigenEvidencia', 'ORIGEN_LEGADO', 'ORIGEN_EN_VIVO', 'nuevoIdEvidencia',
  'idDePartida'];
// `hoyLocalISO` se deja FUERA del cuerpo a propósito: el banco lo inyecta para
// fijar el día. Si se declarara dentro, la declaración de verdad pisaría al
// doble y la fecha quedaría a merced del reloj de la máquina.
const EXCLUIR = ['hoyLocalISO'];
const PIEZAS_DENTRO = ['PantallaObras.agregarObra', 'App.evid', 'Captura.addFoto'];

let cuerpoModulo;
try {
  cuerpoModulo = fuenteDe(archivo, PIEZAS_MODULO, { excluir: EXCLUIR }).cuerpo;
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('\nSi el corte de evidencia se reescribió, este banco hay que rehacerlo');
  console.error('contra el camino nuevo, no borrarlo: lo que afirma sigue siendo cierto.');
  process.exit(1);
}

const falta = PIEZAS_DENTRO.filter(n => !(n in dentro));
if (falta.length) {
  console.error('No se encontraron estas piezas en ' + archivo + ':');
  for (const f of falta) console.error('  · ' + f);
  console.error('\nSi el alta de obra se reescribió, este banco hay que rehacerlo contra');
  console.error('el camino nuevo, no borrarlo: lo que afirma sigue siendo cierto.');
  process.exit(1);
}

const desenvolverMemo = (código) => {
  const m = /^useMemo\s*\(([\s\S]*),\s*\[[^\]]*\]\s*\)$/.exec(código.trim());
  return m ? m[1].trim() : código;
};

// ── El mundo de mentira ─────────────────────────────────────────────────────
//
// `fsSet` de la app devuelve `false` cuando las reglas la niegan; no lanza. Eso
// importa aquí más que en ningún otro banco: el defecto original era
// exactamente no leer ese `false`.
const mundo = () => {
  const w = {
    store: new Map(),
    escrituras: [],          // [{ruta, data}] EN ORDEN — el orden es la mitad
    rebota: new Set(),       // rutas que las reglas niegan
    obras: [],
    auditorias: [],
    modalAbierto: true,
    navegadoA: null,
    avisos: [],
    docsEvidencia: [],
    subs: [],
    cambiosPendientes: false,
    huerfanasBorradas: [],
    alertas: [],
  };
  const niega = (ruta) => [...w.rebota].some(r => r === ruta);
  w.fsSet = async (ruta, data) => {
    if (niega(ruta)) return false;
    w.store.set(ruta, { ...(w.store.get(ruta) || {}), ...data });
    w.escrituras.push({ ruta, data });
    return true;
  };
  // El de la subcolección de evidencia LANZA al ser negado, y por eso es otro.
  w.serverTimestamp = () => ({ __servidor: true });
  w.fsSetAEstricto = async (ruta, data) => {
    if (niega(ruta)) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
    const resuelto = {};
    for (const [k, v] of Object.entries(data))
      resuelto[k] = (v && v.__servidor) ? { seconds: Math.floor(Date.UTC(2026, 10, 14, 17, 0, 0) / 1000) } : v;
    w.store.set(ruta, { ...(w.store.get(ruta) || {}), ...resuelto });
    w.escrituras.push({ ruta, data: resuelto });
    return true;
  };
  w.fsGet = async (ruta) => w.store.get(ruta) || null;
  w.fsAudit = (accion, datos) => { w.auditorias.push({ accion, ...datos }); };
  w.setObras = (f) => { w.obras = typeof f === 'function' ? f(w.obras) : f; };
  w.setModalNueva = (v) => { w.modalAbierto = v; };
  w.onSelect = (id, destino) => { w.navegadoA = { id, destino }; };
  w.setDocsEvidencia = (f) => { w.docsEvidencia = typeof f === 'function' ? f(w.docsEvidencia) : f; };
  w.setSubs = (f) => { w.subs = typeof f === 'function' ? f(w.subs) : f; };
  w.setCambiosPendientes = (v) => { w.cambiosPendientes = v; };
  w.borrarFotoHuerfana = async (ref) => { w.huerfanasBorradas.push(ref && ref.fullPath); };
  w.uploadFoto = async (obraId, carpeta, id) => ({
    url: `https://storage/${obraId}/${carpeta}/${id}?token=abc`,
    ref: { fullPath: `obras/${obraId}/fotos/${carpeta}/${id}` },
  });
  w.alert = (m) => w.alertas.push(String(m));
  w.consola = { warn: (m) => w.avisos.push(String(m)), error: () => {} };
  return w;
};

const HOY = '2026-11-14';
const hoyLocalISO = () => HOY;
const USUARIO = { uid: 'u-dir', correo: 'oscar@cotea.com.mx', nombre: 'Director de Obras' };

const ARGS_ALTA = ['usuario', 'fsGet', 'fsSet', 'hoyLocalISO', 'setObras',
  'fsAudit', 'setModalNueva', 'onSelect', 'console'];
const hacerAlta = (w) => new Function(...ARGS_ALTA, `"use strict";
${cuerpoModulo}
return (${dentro['PantallaObras.agregarObra']});`)(
  USUARIO, w.fsGet, w.fsSet, hoyLocalISO, w.setObras, w.fsAudit,
  w.setModalNueva, w.onSelect, w.consola);

// El otro extremo del cable: el `evid` y el `addFoto` de verdad, alimentados
// con el `cfgEvidencia` que salga del alta. No se teclea `{migrada:true}`: se
// lee lo que la pantalla escribió.
const ARGS_EVID = ['useMemo', 'cfgEvidencia', 'obra', 'evidencia', 'evidenciaCargada',
  'usuario', 'fsSetAEstricto', 'fsGet', 'serverTimestamp', 'setDocsEvidencia',
  'setSubs', 'setCambiosPendientes', 'hoyLocalISO'];
const ARGS_CAPTURA = ['obra', 'evid', 'setSubs', 'uploadFoto', 'borrarFotoHuerfana',
  'hoyLocalISO', 'alert', 'console'];

const galeria = (w, cfg, obra) => {
  const evidencia = new Function('subs', 'docsEvidencia', 'cfgEvidencia', 'hoyLocalISO',
    `"use strict";\n${cuerpoModulo}\nreturn evidenciaDeObra({ cfgEvidencia, docsEvidencia, subs });`
  )(w.subs, w.docsEvidencia, cfg, hoyLocalISO);
  const evid = new Function(...ARGS_EVID, `"use strict";
${cuerpoModulo}
return (${desenvolverMemo(dentro['App.evid'])})();`)(
    (fn) => fn(), cfg, obra, evidencia, true, USUARIO, w.fsSetAEstricto, w.fsGet,
    w.serverTimestamp, w.setDocsEvidencia, w.setSubs, w.setCambiosPendientes, hoyLocalISO);
  const { addFoto } = new Function(...ARGS_CAPTURA, `"use strict";
${cuerpoModulo}
const addFoto = ${dentro['Captura.addFoto']};
return { addFoto };`)(obra, evid, w.setSubs, w.uploadFoto, w.borrarFotoHuerfana,
    hoyLocalISO, w.alert, w.consola);
  return { evidencia, evid, addFoto };
};

const conCuerpo = (expr) => (...args) =>
  new Function('ev', 'lista', `"use strict";\n${cuerpoModulo}\nreturn ${expr};`)(...args);
const sello = conCuerpo('selloDeEvidencia(ev)');
const frase = (lista) => conCuerpo('fraseOrigenEvidencia(lista)')(null, lista);
const vigente = (lista) => conCuerpo('evidenciaVigente(lista)')(null, lista);
const TEXTO_LEGADO = new Function(`"use strict";\n${cuerpoModulo}\nreturn SELLO_LEGADO;`)();
const TEXTO_VERIFICADA = new Function(`"use strict";\n${cuerpoModulo}\nreturn SELLO_VERIFICADA;`)();

const FORM = { id: 'OB-2026-NUEVA', nombre: 'Pavimentación Allende',
  contrato: 'MIN-2026-044', presupuesto: '4800000', cliente: 'Minatitlán' };

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

(async () => {

// ════════════════════════════════════════════════════════════════════════════
console.log('1. El alta deja escrito el expediente de evidencia de la obra');
{
  const w = mundo();
  const problema = await hacerAlta(w)(FORM);

  check(problema === null, 'el alta se consuma', problema || 'sin problema');
  check(!!w.store.get(`obras/${FORM.id}`), 'la obra queda escrita');

  const cfg = w.store.get(`obras/${FORM.id}/config/evidencia`);
  check(!!cfg,
    'y junto a ella `config/evidencia`, que antes del #143 no existía nunca',
    cfg ? JSON.stringify(cfg) : 'NO SE ESCRIBIÓ');
  // La afirmación no es «hay un documento»: es que el lector de verdad lo lea
  // como migrada. `evidenciaMigrada` exige `=== true`, no un valor verdadero.
  const leeMigrada = new Function('cfg', `"use strict";
${cuerpoModulo}
return evidenciaMigrada(cfg);`)(cfg);
  check(leeMigrada === true,
    'y el `evidenciaMigrada` de la app lo lee como migrada',
    `evidenciaMigrada(...) = ${leeMigrada}`);
  check(cfg && cfg.creadaPor === USUARIO.correo,
    'con quién la creó: el documento sabe de dónde salió la marca', cfg && cfg.creadaPor);
  check(cfg && cfg.creadaEn === HOY, 'y de cuándo', cfg && cfg.creadaEn);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. La primera foto de esa obra sale con autor y con hora del servidor');
// Ésta es la comprobación del #143 entera, y el cable va de punta a punta: el
// `cfgEvidencia` NO se teclea, se saca del almacén donde lo dejó el alta de
// arriba. Si el alta deja de escribirlo, aquí llega `undefined` y el rótulo se
// cae solo.
{
  const w = mundo();
  const problema = await hacerAlta(w)(FORM);
  check(problema === null, 'la obra se da de alta');

  const cfg = w.store.get(`obras/${FORM.id}/config/evidencia`);
  const obra = w.store.get(`obras/${FORM.id}`);
  const partida = { id: 'p1', sec: '1.1', sub: 'Terracerías' };

  let g = galeria(w, cfg, obra);
  await g.addFoto(partida, { id: 'f1', url: 'data:image/jpeg;base64,AAAA' });

  const docs = w.docsEvidencia;
  check(docs.length === 1,
    'la foto se guarda como documento propio de la obra, no en el mapa incrustado',
    `${docs.length} documento(s) · ${w.subs.length} partida(s) en el mapa`);
  check(w.subs.length === 0,
    'y el mapa viejo queda intacto: nunca hay mitad y mitad',
    `${w.subs.length} partida(s)`);

  const d = docs[0] || {};
  check(d.capturadaPor === USUARIO.uid,
    'queda escrito QUIÉN la subió — lo que el mapa viejo nunca va a tener',
    d.capturadaPor || 'SIN AUTOR');
  check(!!d.subidaEn, 'y la hora, la del servidor',
    d.subidaEn ? JSON.stringify(d.subidaEn) : 'SIN HORA DE SERVIDOR');
  check(!!d.rutaStorage, 'con la ruta de su objeto en Storage (#30)',
    d.rutaStorage || 'SIN RUTA');

  // El rótulo. Se arma con el lector de verdad sobre la lista de verdad.
  g = galeria(w, cfg, obra);
  const ev = g.evidencia[0];
  check(g.evidencia.length === 1, 'la galería la encuentra',
    `${g.evidencia.length} en la galería`);
  check(!!ev && sello(ev).verificada === true,
    `y la rotula «${TEXTO_VERIFICADA}»`, ev ? sello(ev).texto : '(no hay foto)');
  check(!!ev && sello(ev).texto !== TEXTO_LEGADO,
    `no «${TEXTO_LEGADO}», que es lo que decía de una foto recién subida por un ` +
    'director con nombre y sesión',
    ev ? sello(ev).texto : '(no hay foto)');
  check(!!ev && !/No se puede saber quién la tomó/.test(sello(ev).dice),
    'ni «No se puede saber quién la tomó» sobre alguien que acaba de firmarla',
    ev ? sello(ev).dice : '(no hay foto)');
  // El renglón que viaja al PDF del cliente.
  check(frase(vigente(g.evidencia)) === '1 verificada',
    'y el renglón de origen del lote dice «1 verificada», no «1 de archivo, sin autor»',
    frase(vigente(g.evidencia)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. La bandera se escribe ANTES que la obra');
// El orden no es estética. Al revés —obra escrita y bandera fallida— deja una
// obra que EXISTE y nació sin marca, que es el defecto consumado y sin vuelta:
// habría que migrar una obra de un día. Y es el orden que las reglas permiten,
// porque la regla exige que la obra no exista todavía.
{
  const w = mundo();
  await hacerAlta(w)(FORM);
  const rutas = w.escrituras.map(e => e.ruta);
  const iCfg = rutas.indexOf(`obras/${FORM.id}/config/evidencia`);
  const iObra = rutas.indexOf(`obras/${FORM.id}`);
  check(iCfg >= 0 && iObra >= 0 && iCfg < iObra,
    'la bandera va primero y el documento de la obra después',
    rutas.join(' → '));
  // La regla de Firestore condiciona el `create` a que la obra NO exista
  // (`!exists(.../obras/$(obraId))`). Escribirla después sería pedirle a las
  // reglas lo único que no conceden, y el alta rebotaría SIEMPRE en producción
  // aunque aquí, con un Firestore de mentira, saliera verde.
  check(iCfg === 0,
    'y es la PRIMERA escritura de todas: la regla sólo la concede sobre una obra ' +
    'que todavía no está',
    `la primera fue ${rutas[0]}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Si la bandera rebota, no se crea la obra');
// `fsSet` devuelve `false` cuando las reglas niegan, y no leer ese `false` es
// la familia de defectos de la que salió todo esto. Una obra creada sin bandera
// archivaría cada foto sin autor, y el usuario no tendría ni cómo enterarse.
{
  const w = mundo();
  w.rebota.add(`obras/${FORM.id}/config/evidencia`);
  const problema = await hacerAlta(w)(FORM);

  check(typeof problema === 'string' && problema.length > 0,
    'el alta devuelve el problema en vez de `null`',
    problema === null ? 'DEVOLVIÓ null' : String(problema).slice(0, 60) + '…');
  check(!w.store.get(`obras/${FORM.id}`),
    'y la obra NO se escribe: no queda una obra existente sin su marca',
    w.store.get(`obras/${FORM.id}`) ? 'LA ESCRIBIÓ' : 'no está');
  check(w.obras.length === 0,
    'ni aparece en la lista de la pantalla, con su monto, como si hubiera quedado',
    `${w.obras.length} obra(s) en pantalla`);
  check(w.modalAbierto === true,
    'el modal se queda abierto, con lo que el usuario tecleó, para reintentar');
  check(w.navegadoA === null,
    'y no se navega al catálogo de una obra que no existe',
    w.navegadoA ? JSON.stringify(w.navegadoA) : 'no navegó');
  check(w.auditorias.length === 0,
    'ni se audita un alta que no pasó: la bitácora no puede afirmar lo que no ocurrió',
    `${w.auditorias.length} entrada(s)`);
  // Y el mensaje tiene que decir de qué habla. «Error» no sirve: el usuario
  // tiene que poder repetírselo a alguien.
  check(/evidencia/i.test(String(problema)),
    'y el mensaje nombra la evidencia, no un «error» genérico',
    String(problema).slice(0, 90));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. Lo que ya funcionaba sigue funcionando');
// El #143 se arregla metiendo una escritura ANTES de todo lo demás. Si eso
// hubiera movido el id repetido o el rechazo de la obra, se cambiaría un
// defecto por otro.
{
  // Id repetido: `fsSet` escribe con `merge`, así que un id repetido se FUNDE
  // con la obra que ya estaba, campo por campo y sin aviso.
  const w = mundo();
  w.store.set(`obras/${FORM.id}`, { id: FORM.id, nombre: 'La que ya estaba',
    presupuesto: 9000000 });
  const problema = await hacerAlta(w)(FORM);
  check(/[Yy]a existe/.test(String(problema)), 'un id repetido se rechaza',
    String(problema).slice(0, 70));
  check(w.escrituras.length === 0,
    'y no escribe NADA — ni la bandera: comprobar después de escribir no sirve',
    w.escrituras.map(e => e.ruta).join(', ') || 'ninguna escritura');
  check(w.store.get(`obras/${FORM.id}`).nombre === 'La que ya estaba',
    'la obra que ya estaba no se funde con la nueva',
    w.store.get(`obras/${FORM.id}`).nombre);

  // Sin id no se intenta nada.
  const w2 = mundo();
  const p2 = await hacerAlta(w2)({ ...FORM, id: '' });
  check(typeof p2 === 'string' && w2.escrituras.length === 0,
    'una obra sin identificador tampoco escribe la bandera en `obras//config/...`',
    w2.escrituras.map(e => e.ruta).join(', ') || 'ninguna escritura');

  // La obra rechazada por reglas: la bandera ya está escrita y eso es inocuo
  // —es la bandera de una obra que no existe—, pero la obra no puede aparecer.
  const w3 = mundo();
  w3.rebota.add(`obras/${FORM.id}`);
  const p3 = await hacerAlta(w3)(FORM);
  check(typeof p3 === 'string' && p3.length > 0,
    'si las reglas niegan la obra, se dice', String(p3).slice(0, 60) + '…');
  check(w3.obras.length === 0,
    'y no aparece en la pantalla una obra que Firestore rechazó',
    `${w3.obras.length} obra(s)`);
  check(w3.auditorias.length === 0, 'ni se audita');

  // `config/info` sí puede rebotar sin abortar: `obras/{id}` ya tiene todo.
  const w4 = mundo();
  w4.rebota.add(`obras/${FORM.id}/config/info`);
  const p4 = await hacerAlta(w4)(FORM);
  check(p4 === null, 'un `config/info` negado NO tira el alta: la obra ya está completa',
    p4 || 'sin problema');
  check(w4.avisos.length === 1,
    'pero se avisa en consola, porque indica reglas desalineadas',
    w4.avisos[0] || 'NO AVISÓ');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. Una obra VIEJA sigue leyéndose por el mapa incrustado');
// El arreglo del #143 no puede empujar hacia el camino nuevo a las obras que
// no se migraron: sus fotos viven en `avance/subs` y leerlas por la
// subcolección las haría desaparecer de la galería. El corte sigue siendo por
// obra y explícito.
{
  const w = mundo();
  w.subs = [{ id: 'p1', sec: '1.1', sub: 'Terracerías', fotos: { p1: [
    { id: 'v1', url: 'https://storage/vieja.jpg', fecha: '2026-09-22' },
  ] } }];
  const obra = { id: '0112', nombre: 'Malecón' };
  const g = galeria(w, null, obra);   // sin `config/evidencia`: obra no migrada
  check(g.evid.migrada === false, 'la obra sin `config/evidencia` se lee sin migrar');
  check(g.evidencia.length === 1, 'y su foto del mapa viejo se sigue viendo',
    `${g.evidencia.length} en la galería`);
  check(sello(g.evidencia[0]).texto === TEXTO_LEGADO,
    `rotulada «${TEXTO_LEGADO}», que de ésa sí es verdad`,
    sello(g.evidencia[0]).texto);
}

console.log(fallas === 0
  ? '\nUna obra nace con su expediente, y su primera foto tiene autor y hora del servidor.'
  : `\n${fallas} comprobación(es) en rojo.`);
if (fallas) process.exit(1);

// ════════════════════════════════════════════════════════════════════════════
// CONTRAPRUEBA
// ════════════════════════════════════════════════════════════════════════════
//
// El corredor es el del repositorio (`scripts/contraprueba.cjs`, #124): revisa
// los anclajes SIEMPRE —también en el arranque normal, que es lo que atrapa el
// anclaje rancio en `npm test`— y lanza los procesos hijos sólo a pedido.
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  // ── La bandera, que es el #143 ────────────────────────────────────────────
  { titulo: 'el alta vuelve a no escribir la bandera: la obra nace sin migrar',
    cambios: [[
      "    if(!await fsSet(`obras/${nueva.id}/config/evidencia`,",
      '    if(false && !await fsSet(`obras/${nueva.id}/NO-SE-ESCRIBE`,',
    ]] },
  { titulo: 'la bandera se escribe en `false`, que es como no escribirla',
    cambios: [['                    { migrada: true, nacidaMigrada: true,',
               '                    { migrada: false, nacidaMigrada: true,']] },
  { titulo: 'la bandera se guarda en otro documento y el lector no la encuentra',
    cambios: [['`obras/${nueva.id}/config/evidencia`,\n                    { migrada: true',
               '`obras/${nueva.id}/evidencia/config`,\n                    { migrada: true']] },
  { titulo: 'la bandera no dice quién la puso',
    cambios: [['                      creadaPor: nueva.creadaPor, creadaEn: hoyLocalISO() }))',
               "                      creadaPor: '', creadaEn: hoyLocalISO() }))"]] },

  // ── El orden, que es lo que las reglas conceden ──────────────────────────
  { titulo: 'la obra se escribe ANTES que su bandera — el orden que la regla niega',
    cambios: [[
      "    if(!await fsSet(`obras/${nueva.id}/config/evidencia`,",
      '    await fsSet(`obras/${nueva.id}`, nueva);\n'
      + '    if(!await fsSet(`obras/${nueva.id}/config/evidencia`,',
    ]] },
  { titulo: 'el `false` de la bandera se ignora: la obra se crea sin marca y sin aviso',
    cambios: [[
      "    if(!await fsSet(`obras/${nueva.id}/config/evidencia`,\n"
      + '                    { migrada: true, nacidaMigrada: true,\n'
      + '                      creadaPor: nueva.creadaPor, creadaEn: hoyLocalISO() }))\n'
      + "      return 'No se pudo preparar",
      '    await fsSet(`obras/${nueva.id}/config/evidencia`,\n'
      + '                    { migrada: true, nacidaMigrada: true,\n'
      + '                      creadaPor: nueva.creadaPor, creadaEn: hoyLocalISO() });\n'
      + "    if(false)\n      return 'No se pudo preparar",
    ]] },

  // ── El corte por obra, que el arreglo no puede atropellar ────────────────
  { titulo: 'el lector ignora la bandera y la foto nueva no aparece en la galería',
    cambios: [['  if (evidenciaMigrada(cfgEvidencia))\n    return (docsEvidencia || []).map(evidenciaNormalizada);',
               '  if (false)\n    return (docsEvidencia || []).map(evidenciaNormalizada);']] },
  { titulo: 'toda obra se lee como migrada, y las fotos de las viejas desaparecen',
    cambios: [['const evidenciaMigrada = (cfg) => !!(cfg && cfg.migrada === true);',
               'const evidenciaMigrada = (cfg) => true;']] },

  // ── Lo que ya funcionaba y la escritura nueva podía romper ───────────────
  { titulo: 'el id repetido deja de comprobarse y la obra vieja se funde con la nueva',
    cambios: [['    if(await fsGet(`obras/${nueva.id}`))\n'
               + '      return `Ya existe una obra con el identificador ${nueva.id}. No se guardó nada.`;',
               '    if(false)\n'
               + '      return `Ya existe una obra con el identificador ${nueva.id}. No se guardó nada.`;']] },
  { titulo: 'un `config/info` negado tira el alta de una obra que ya está completa',
    cambios: [["    if(!await fsSet(`obras/${nueva.id}/config/info`, nueva))\n"
               + '      console.warn(',
               "    if(!await fsSet(`obras/${nueva.id}/config/info`, nueva))\n"
               + "      return 'config/info rebotó';\n    if(false)\n      console.warn("]] },
];

// La revisión barata corre SIEMPRE, menos cuando este proceso ES un mutante:
// ahí los anclajes faltan a propósito y exigirlos sería NO ARRANCÓ por diseño.
if (!process.env.SIN_CONTRAPRUEBA)
  CP.exigirAnclajes(MUTANTES, src, { archivo });

if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const sobrevivieron = CP.correr({
    mutaciones: MUTANTES, src, archivo,
    prefijo: 'nace-con-expediente-',
    // Este banco recibe el fuente por `argv[2]`, no por `ARCHIVO_APP`.
    comoCorrer: (ruta) => ({ args: [ruta], env: {} }),
  });
  process.exit(CP.veredicto(sobrevivieron, MUTANTES.length));
}

process.exit(0);

})();
