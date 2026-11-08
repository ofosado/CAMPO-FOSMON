#!/usr/bin/env node
// Prueba: LA HORA QUE UN DOCUMENTO CITA TIENE QUE SER LA QUE DICE QUE ES.
//
// ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
// La portada del reporte ejecutivo lleva un renglón que dice «Corte del
// reporte», y al pie del documento firman tres personas. Hasta hoy esa fecha
// la ponía `new Date()` en el navegador: el reloj del aparato de quien apretó
// el botón. Un reloj mal puesto no se nota al leer el papel —la fecha impresa
// es creíble sea cual sea— y el huso del aparato tampoco: desde las 18:00 en
// México, un navegador en UTC imprime el día siguiente.
//
// Además el documento leía el reloj CUATRO veces: el encabezado de cada
// página, el corte de la portada, la línea de HOY de la gráfica de plazo y el
// día contra el que se calcula el avance programado. Nada garantizaba que
// coincidieran. Un PDF armado a las 23:59:58 podía salir con la portada de un
// día y la gráfica del siguiente, y eso es «una cuenta por número» rota en el
// documento que se entrega.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
// Nada de que un símbolo exista. Todo se EXTRAE y se EJECUTA:
//
//   §1  La callable `horaDelServidor` de `functions/index.js`, movida con el
//       `admin` de Firebase sustituido por una MINA. Si la función tocara la
//       base para conseguir la hora, estalla. Sin sesión tiene que rechazar;
//       con sesión tiene que contestar un instante que sea de verdad el de
//       ahora, no una constante.
//   §2  `pedirHoraDelServidor` de `src/App.jsx`, con un `callFn` de mentira.
//       Lo que se mide es la DEGRADACIÓN: cuando la callable no contesta hay
//       que seguir pudiendo generar el PDF, pero el origen de la hora cambia.
//   §3  `selloDeTiempo`, que decide qué se imprime. Incluido el huso: la
//       sección se corre con el reloj del proceso puesto en Tokio, porque con
//       la máquina en México un sello sin `timeZone` sale bien por casualidad
//       y la contraprueba no vería nada.
//   §4  El PDF entero, dibujado sobre el lienzo falso. Se le da un instante de
//       marzo y se exige que marzo salga en los CUATRO sitios. Un sitio que
//       siguiera leyendo el reloj imprimiría la fecha de hoy, que es lo que se
//       busca.
//
// Y la frontera: un documento sellado con el reloj del aparato NO puede decir
// en ninguna parte «hora del servidor». Eso no es un hueco —es una afirmación
// falsa, en la portada de un papel que se firma.
//
// ── LA CONTRAPRUEBA ────────────────────────────────────────────────────────
// Seis mutaciones, repartidas entre los dos archivos. Cada una tiene que
// salir ROJO (1); una que salga 2 es el banco cayéndose, no el banco viendo.
//
// Uso:  node scripts/prueba-la-hora-que-se-firma.cjs
//       node scripts/prueba-la-hora-que-se-firma.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, noArranco } = require('./no-arranco.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDF } = require('./lienzo-pdf.cjs');

const RAIZ = path.join(__dirname, '..');
const ARCH_FNS = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_FUNCIONES || process.env.ARCH_APP)
    sinPrecondicion('la contraprueba corriendo sobre copias ya mutadas',
      ['Se invocó con ARCH_FUNCIONES o ARCH_APP puesta.']);

  const MUTACIONES = [
    ['FNS', 'la callable de la hora deja de pedir sesión y queda abierta a cualquiera',
      (t) => t.replace(
        '  if (!request.auth) {\n    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");\n  }\n  return { ms: Date.now() };',
        '  return { ms: Date.now() };')],
    ['FNS', 'la hora se consigue escribiendo en la base, que es el efecto que se quería evitar',
      (t) => t.replace('  return { ms: Date.now() };',
        '  await admin.firestore().doc("global/hora").set({ t: FieldValue.serverTimestamp() });\n'
        + '  return { ms: Date.now() };')],
    ['APP', 'el sello presume origen: todo instante utilizable se declara del servidor',
      (t) => t.replace("const delServidor = medible && instante?.fuente === 'servidor';",
        'const delServidor = medible;')],
    ['APP', 'el sello imprime en el huso del aparato y no en el de la obra',
      (t) => t.replace(
        "    { timeZone: ZONA_OBRA, day: '2-digit', month: 'long', year: 'numeric' });",
        "    { day: '2-digit', month: 'long', year: 'numeric' });")],
    ['APP', 'la gráfica de plazo vuelve a leer el reloj por su cuenta',
      (t) => t.replace('  const hoyD = sello.momento;', '  const hoyD = new Date();')],
    ['APP', 'el cliente da por buena una llamada que no trajo hora',
      (t) => t.replace(
        "  if (r?.ok && Number.isFinite(ms) && ms > 0) return { ms, fuente: 'servidor' };",
        "  return { ms: Number.isFinite(ms) && ms > 0 ? ms : Date.now(), fuente: 'servidor' };")],
  ];

  const DESTINO = { FNS: ['ARCH_FUNCIONES', ARCH_FNS], APP: ['ARCH_APP', ARCH_APP] };

  let vistas = 0;
  for (const [cual, nombre, romper] of MUTACIONES) {
    const [variable, origen] = DESTINO[cual];
    const antes = fs.readFileSync(origen, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}`);
      console.log(`             el ancla ya no está en ${path.basename(origen)}. `
        + 'Una mutación que no se aplica no mide nada.');
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-hora-'));
    const copia = path.join(dir, path.basename(origen));
    fs.writeFileSync(copia, despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, [variable]: copia },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const rojas = (salida.match(/^FALLA/gm) || []).length;
    const vio = r.status === 1 && rojas > 0;
    console.log(`${vio ? `ROJA ×${String(rojas).padStart(2)}`.padEnd(12) : 'NO LA VE    '} ${nombre}`);
    if (!vio) {
      console.log(`             salió ${r.status} con ${rojas} en rojo`
        + (r.status === 2 ? ' (el banco se cayó, que no es verlo)' : ''));
      console.log(salida.split('\n').slice(-12).map((l) => '             ' + l).join('\n'));
    } else vistas++;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: el banco no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── EL BANCO ───────────────────────────────────────────────────────────────
vigilarExcepciones(`${path.relative(RAIZ, ARCH_FNS)} y ${path.relative(RAIZ, ARCH_APP)}`);

const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

let fallas = 0;
const ok = (q, d) => console.log(` ok   ${q}${d ? `  ·  ${d}` : ''}`);
const falla = (q, esp, obt) => {
  fallas++;
  console.log(`FALLA  ${q}\n       esperaba: ${esp}\n       obtuve:   ${obt}`);
};
const check = (cond, q, esp, obt) => (cond ? ok(q, obt) : falla(q, esp, obt));

// ═══ §1 · LA CALLABLE ══════════════════════════════════════════════════════
//
// El manejador se saca por AST —`exports.horaDelServidor = onCall(…, f)`, el
// ÚLTIMO argumento— y se mueve con todo su mundo sustituido por minas, menos
// `HttpsError`, que hace falta para poder mirar con qué código rechaza.
const fuenteFns = fs.readFileSync(ARCH_FNS, 'utf8');
const astFns = parse(fuenteFns,
  { sourceType: 'script', plugins: ['optionalChaining', 'nullishCoalescingOperator'] });

let fuenteManejador = null;
traverse(astFns, {
  AssignmentExpression(p) {
    const izq = p.node.left;
    if (izq.type !== 'MemberExpression') return;
    if (izq.object.name !== 'exports' || izq.property.name !== 'horaDelServidor') return;
    const der = p.node.right;
    if (der.type !== 'CallExpression' || !der.arguments.length) return;
    const ult = der.arguments[der.arguments.length - 1];
    if (ult.type !== 'ArrowFunctionExpression' && ult.type !== 'FunctionExpression') return;
    fuenteManejador = fuenteFns.slice(ult.start, ult.end);
  },
});

if (!fuenteManejador)
  noArranco(['no se halló el manejador de `exports.horaDelServidor = onCall(…)`; '
    + 'sin él no hay nada que ejecutar y este banco saldría verde por vacío'],
  path.relative(RAIZ, ARCH_FNS));

// Las variables libres del manejador, por el analizador de ámbitos y no a ojo:
// si mañana usa algo nuevo, se le inyecta solo —como mina—.
const libresDe = (texto) => {
  const env = parse(`const __m = ${texto};`,
    { sourceType: 'script', plugins: ['optionalChaining', 'nullishCoalescingOperator'] });
  let g = [];
  traverse(env, { Program(p) { g = Object.keys(p.scope.globals); p.stop(); } });
  return g;
};

class HttpsErrorFalso extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const mina = (nombre) => new Proxy(function () {}, {
  get(_, prop) { throw new Error(`MINA: se tocó ${nombre}.${String(prop)}`); },
  apply() { throw new Error(`MINA: se llamó ${nombre}()`); },
  construct() { throw new Error(`MINA: new ${nombre}()`); },
});
const DE_VERDAD = new Set(['Date', 'Number', 'Math', 'JSON', 'Object', 'String', 'Promise']);

let horaDelServidor;
try {
  const libres = libresDe(fuenteManejador).filter((n) => !DE_VERDAD.has(n));
  const valores = libres.map((n) => (n === 'HttpsError' ? HttpsErrorFalso : mina(n)));
  horaDelServidor = new Function(...libres,
    `"use strict";\nreturn (${fuenteManejador});`)(...valores);
} catch (e) {
  sinPrecondicion('no se pudo montar el manejador de la hora',
    [e.message.split('\n')[0],
     'Sin poder EJECUTARLO, mirar su texto sería comprobar que una cadena está',
     'escrita, no que la función se comporta.']);
}

(async () => {

  // Sin sesión: rechaza, y el código importa. Un `internal` manda a buscar un
  // fallo del servidor donde lo que falta es la sesión.
  let sinSesion = null;
  try {
    const r = await horaDelServidor({ data: {} });
    sinSesion = { lanzo: false, valor: JSON.stringify(r) };
  } catch (e) { sinSesion = { lanzo: true, code: e.code, msg: e.message }; }
  check(sinSesion.lanzo && sinSesion.code === 'unauthenticated',
    'la callable de la hora rechaza a quien no trae sesión',
    'lanza HttpsError con código `unauthenticated`',
    sinSesion.lanzo ? `lanzó con código ${sinSesion.code}` : `devolvió ${sinSesion.valor}`);

  // Con sesión: contesta el instante de AHORA. La ventana es de 5 s y el
  // punto es que no sea una constante ni el cero: un `return {ms: 0}` pasaría
  // cualquier comprobación que sólo preguntara si viene un número.
  const antes = Date.now();
  let conSesion = null;
  try {
    conSesion = await horaDelServidor({ auth: { uid: 'u1', token: { email: 'demo@fosmon.com.mx' } }, data: {} });
  } catch (e) { conSesion = { error: e.message }; }
  const despues = Date.now();
  const msDicho = Number(conSesion?.ms);
  const esDeAhora = Number.isFinite(msDicho) && msDicho >= antes - 1 && msDicho <= despues + 1;
  check(esDeAhora,
    'con sesión contesta el instante en que se le preguntó, no una constante',
    `un ms entre ${antes} y ${despues}`,
    conSesion?.error ? `reventó: ${conSesion.error}` : `contestó ms=${conSesion?.ms}`);

  // Y lo contesta SIN tocar la base. `admin` es una mina: si la función
  // escribiera un documento con `serverTimestamp()` para leerlo de vuelta
  // —la otra forma de resolver esto— habría estallado arriba.
  check(esDeAhora && !conSesion?.error,
    'consigue la hora sin tocar Firestore: generar un PDF no deja rastro en la base',
    '`admin` es una mina y la llamada igual contesta',
    conSesion?.error ? `tocó algo: ${conSesion.error}` : 'no tocó nada');

  // ═══ §2 · EL CLIENTE, CUANDO LA CALLABLE NO CONTESTA ═════════════════════
  //
  // `pedirHoraDelServidor` se saca por AST y se monta con un `callFn` de
  // mentira. Es la única forma de mover el camino de la degradación: con el
  // `callFn` de verdad habría que tener Firebase levantado para no poder
  // mirar justamente el caso en que Firebase no está.
  const fuenteApp = fs.readFileSync(ARCH_APP, 'utf8');
  const astApp = parse(fuenteApp, {
    sourceType: 'module',
    plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
  });
  let fuentePedir = null;
  traverse(astApp, {
    VariableDeclarator(p) {
      if (p.node.id.name !== 'pedirHoraDelServidor' || !p.node.init) return;
      if (p.getFunctionParent()) return;
      fuentePedir = fuenteApp.slice(p.node.init.start, p.node.init.end);
    },
  });
  if (!fuentePedir)
    noArranco(['no se halló `pedirHoraDelServidor` como declaración de primer nivel'],
      path.relative(RAIZ, ARCH_APP));

  const pedirCon = (respuesta) => new Function('callFn',
    `"use strict";\nreturn (${fuentePedir});`)(async () => respuesta)();

  const buena = await pedirCon({ ok: true, data: { ms: 1772928000000 } });
  check(buena.fuente === 'servidor' && buena.ms === 1772928000000,
    'cuando la callable contesta, el cliente usa ESE instante y lo marca del servidor',
    "{ms: 1772928000000, fuente: 'servidor'}", JSON.stringify(buena));

  const casos = [
    ['la llamada falló', { ok: false, error: 'unavailable' }],
    ['contestó sin hora', { ok: true, data: {} }],
    ['contestó una hora que no es número', { ok: true, data: { ms: 'ahorita' } }],
    ['contestó cero', { ok: true, data: { ms: 0 } }],
  ];
  for (const [porQue, respuesta] of casos) {
    const r = await pedirCon(respuesta);
    const usable = Number.isFinite(r?.ms) && r.ms > 0;
    check(usable && r.fuente === 'equipo',
      `si ${porQue}, el PDF se sigue pudiendo generar pero la hora queda marcada del equipo`,
      "un ms utilizable y fuente 'equipo'", JSON.stringify(r));
  }

  // ═══ §3 · EL SELLO ═══════════════════════════════════════════════════════
  let APP;
  try {
    APP = fuenteDe(ARCH_APP, ['generarPDFObra', 'selloDeTiempo'], { tolerante: true });
  } catch (e) {
    if (e instanceof SimboloPerdido) noArranco(e.faltantes, path.relative(RAIZ, ARCH_APP));
    throw e;
  }
  if (APP.faltan.length) noArranco(APP.faltan, path.relative(RAIZ, ARCH_APP));

  const armarAPP = (e) => new Function(
    'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
    `"use strict";\n${APP.cuerpo}\nreturn (${e});`
  )(...Array(6).fill(() => {}));

  let selloDeTiempo, generarPDFObra;
  try {
    selloDeTiempo = armarAPP('selloDeTiempo');
    generarPDFObra = armarAPP('generarPDFObra');
  } catch (e) {
    sinPrecondicion('no se pudo montar el código extraído de App.jsx',
      [e.message.split('\n')[0]]);
  }

  // 2026-11-09T02:00:00Z son las 20:00 del DÍA ANTERIOR en México. Es el caso
  // que rompe: a partir de las 18:00 el calendario de la obra y el UTC ya no
  // coinciden, y el aparato de quien genera el PDF puede estar en cualquiera
  // de los dos.
  const MS_NOCHE = Date.UTC(2026, 10, 9, 2, 0, 0);

  const servidor = selloDeTiempo({ ms: MS_NOCHE, fuente: 'servidor' });
  check(/hora del servidor/.test(servidor.corte) && !/equipo/.test(servidor.corte),
    'el sello con hora del servidor lo declara',
    'el renglón dice «hora del servidor» y no menciona el equipo',
    `«${servidor.corte}»`);

  const equipo = selloDeTiempo({ ms: MS_NOCHE, fuente: 'equipo' });
  check(/este equipo/.test(equipo.corte) && !/hora del servidor/.test(equipo.corte),
    'el sello con hora del aparato NO dice en ninguna parte «hora del servidor»',
    'el renglón declara el equipo y no presume el servidor',
    `«${equipo.corte}»`);

  // Un sello sin instante utilizable tiene que seguir siendo imprimible —el
  // PDF se genera igual— pero jamás presumiendo origen.
  const nulos = [
    ['sin instante', null],
    ['con un instante vacío', {}],
    ['con ms basura y fuente servidor', { ms: 'ahorita', fuente: 'servidor' }],
    ['con ms cero y fuente servidor', { ms: 0, fuente: 'servidor' }],
  ];
  for (const [porQue, instante] of nulos) {
    const s = selloDeTiempo(instante);
    const imprimible = typeof s?.corte === 'string' && /\d/.test(s.corte)
      && s.momento instanceof Date && !isNaN(s.momento);
    check(imprimible && !/hora del servidor/.test(s.corte),
      `${porQue}, el sello se imprime pero no presume origen`,
      'un renglón con fecha y sin «hora del servidor»',
      `«${s?.corte}»`);
  }

  // El huso. Con la máquina en México esto sale bien por casualidad, así que
  // la comprobación se hace con el reloj del PROCESO puesto en Tokio —donde
  // ese mismo instante ya es el día 9—. Se restaura enseguida: el resto del
  // banco mide con el huso de la suite.
  const husoAntes = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  let enTokio;
  try { enTokio = selloDeTiempo({ ms: MS_NOCHE, fuente: 'servidor' }); }
  finally { if (husoAntes === undefined) delete process.env.TZ; else process.env.TZ = husoAntes; }
  const diceDia8 = /\b08\b/.test(enTokio.fecha) && /noviembre/i.test(enTokio.fecha);
  check(diceDia8 && /20:00/.test(enTokio.corte),
    'la fecha impresa es la del calendario de la obra, no la del aparato que generó el PDF',
    'con el aparato en Tokio, «08 … noviembre … 2026, 20:00 h»',
    `«${enTokio.corte}»`);

  // Y el huso del proceso quedó como estaba: un banco que ensucia el ambiente
  // envenena a los que corren después en el mismo proceso.
  check(process.env.TZ === husoAntes,
    'el banco devuelve el huso del proceso como lo encontró',
    String(husoAntes), String(process.env.TZ));

  // ═══ §4 · EL DOCUMENTO: UN SOLO INSTANTE ═════════════════════════════════
  //
  // Un instante de MARZO, a meses de hoy. Cualquier sitio del generador que
  // siguiera leyendo el reloj imprimiría la fecha de hoy, y se ve.
  const MS_MARZO = Date.UTC(2026, 2, 15, 18, 0, 0); // 15 mar 2026, 12:00 en México
  const OBRA = {
    id: '0114', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001',
    cliente: 'H. Ayuntamiento de Coatzacoalcos', ubicacion: 'Coatzacoalcos, Ver.',
    inicio: '2026-01-10', fin: '2026-12-20', presupuesto: 38500000,
  };

  const dibujarCon = async (instante) => {
    try {
      return await dibujarPDF(generarPDFObra, {}, OBRA, { instante });
    } catch (e) {
      sinPrecondicion('el PDF no se pudo dibujar',
        [e.message.split('\n')[0],
         'Sin dibujo, «no dice tal cosa» se cumple por no haber impreso nada.']);
    }
    return [];
  };

  const conServidor = await dibujarCon({ ms: MS_MARZO, fuente: 'servidor' });
  const textos = conServidor.map((d) => d.texto);
  if (textos.length < 20)
    sinPrecondicion(`el PDF sólo dibujó ${textos.length} textos`,
      ['Con el dibujo casi vacío cualquier «no aparece» se cumple por vacío.']);

  // (a) La portada declara el corte, con hora y con origen.
  const portada = conServidor.filter((d) => d.pagina === 1);
  const corteEsperado = selloDeTiempo({ ms: MS_MARZO, fuente: 'servidor' }).corte;
  check(portada.some((d) => d.texto === corteEsperado),
    'la portada imprime el corte con su hora y declara de dónde salió',
    `«${corteEsperado}» en la página 1`,
    portada.filter((d) => /marzo|servidor|equipo/.test(d.texto))
      .map((d) => `«${d.texto}»`).join(' · ') || 'nada parecido');

  // (b) El encabezado de las páginas interiores lleva esa misma fecha.
  const interiores = conServidor.filter((d) => d.pagina > 1);
  if (!interiores.length)
    sinPrecondicion('el PDF se quedó en una sola página',
      ['Sin páginas interiores no se puede mirar el encabezado, que es el',
       'segundo de los cuatro sitios que leían el reloj.']);
  const fechaMarzo = selloDeTiempo({ ms: MS_MARZO, fuente: 'servidor' }).fecha;
  check(interiores.some((d) => d.texto === fechaMarzo && d.align === 'right'),
    'el encabezado de cada página lleva la fecha del sello, no la del reloj',
    `«${fechaMarzo}» alineada a la derecha en una página interior`,
    interiores.filter((d) => d.align === 'right' && /20\d\d/.test(d.texto))
      .slice(0, 3).map((d) => `«${d.texto}»`).join(' · ') || 'ninguna fecha a la derecha');

  // (c) La tabla de plazo: «Corte actual». Sale de `hoyD`, que era la tercera
  // lectura del reloj.
  check(textos.includes('15/Mar/26'),
    'el «Corte actual» de la tabla de plazo sale del mismo instante que la portada',
    '«15/Mar/26»',
    textos.filter((t) => /^\d\d\/[A-Z][a-z]{2}\/\d\d$/.test(t))
      .map((t) => `«${t}»`).join(' · ') || 'ninguna fecha con esa forma');

  // (d) Y la marca de HOY de la gráfica de plazo, que es la cuarta.
  check(textos.includes('15/Mar'),
    'la marca de HOY de la gráfica de plazo cae en el instante del sello',
    '«15/Mar»',
    textos.filter((t) => /^\d\d\/[A-Z][a-z]{2}$/.test(t))
      .map((t) => `«${t}»`).join(' · ') || 'ninguna marca con esa forma');

  // (e) Ningún sitio del documento se quedó leyendo el reloj: la fecha de HOY
  // no puede aparecer en ninguna parte. Con un sello de marzo y la suite
  // corriendo cualquier otro día, verla es la prueba de que algo no pasó por
  // el sello.
  const hoyLarga = new Date().toLocaleDateString('es-MX',
    { timeZone: 'America/Mexico_City', day: '2-digit', month: 'long', year: 'numeric' });
  if (hoyLarga === fechaMarzo) {
    // Hoy ES el 15 de marzo de 2026: esta comprobación no distingue nada, así
    // que no se afirma. Decirlo es mejor que dar un verde que no midió.
    console.log(' --   hoy coincide con el instante de prueba; esta comprobación no acota');
  } else {
    const coladas = textos.filter((t) => t === hoyLarga);
    check(coladas.length === 0,
      'ningún renglón del documento se quedó leyendo el reloj del aparato',
      `cero apariciones de «${hoyLarga}»`,
      `${coladas.length} aparición(es)`);
  }

  // (f) La frontera. Sellado con el reloj del aparato, el papel entero no
  // puede decir «hora del servidor» en ninguna página.
  const conEquipo = (await dibujarCon({ ms: MS_MARZO, fuente: 'equipo' })).map((d) => d.texto);
  const presume = conEquipo.filter((t) => /hora del servidor/.test(t));
  check(presume.length === 0 && conEquipo.some((t) => /este equipo/.test(t)),
    'un documento sellado con el reloj del aparato lo dice, y no presume el servidor',
    'cero «hora del servidor» y al menos un «este equipo»',
    `${presume.length} presunción(es) · `
      + `${conEquipo.filter((t) => /este equipo/.test(t)).length} declaración(es)`);

  console.log('');
  if (fallas) {
    console.log(`${fallas} comprobación(es) en rojo.`);
    process.exit(1);
  }
  console.log('La hora que el documento cita es la que dice que es.');
})();
