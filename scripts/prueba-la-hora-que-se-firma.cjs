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
//   §4  LOS DOS PAPELES, dibujados sobre el lienzo falso. Se les da un
//       instante de marzo y se exige que marzo salga en todos los sitios que
//       citan la hora. Un sitio que siguiera leyendo el reloj imprimiría la
//       fecha de hoy, que es lo que se busca.
//
// Y la frontera: un documento sellado con el reloj del aparato NO puede decir
// en ninguna parte «hora del servidor». Eso no es un hueco —es una afirmación
// falsa, en la portada de un papel que se firma.
//
// ── POR QUÉ §4 CAMBIÓ DE FORMA EL 2026-11-12 ──────────────────────────────
//
// `generarPDFObra` se retiró. El papel único se partió en dos porque los dos
// lectores no son el mismo: `generarPDFArt73` es el informe que se entrega a
// la dependencia y `generarPDFInterno` es el documento de la constructora.
//
// Eso movió los CUATRO sitios que leían el reloj:
//
//   · el corte de la portada y el encabezado de las páginas interiores viven
//     en los DOS papeles, y se siguen comprobando en los dos;
//   · la tabla de plazo con «Corte actual» y la marca de HOY de la gráfica de
//     plazo —las que se comprobaban buscando «15/Mar/26» y «15/Mar»— se
//     fueron con `generarPDFObra`. Ya no existen en ningún papel: medido, no
//     supuesto. Buscarles un anclaje parecido convertiría una afirmación sobre
//     la gráfica de plazo en una afirmación sobre otra cosa con el nombre de
//     la vieja.
//
// Lo que las sustituye es más fuerte que una cadena de fecha: el informe del
// Art. 73 calcula ARITMÉTICA sobre el sello —días transcurridos, días por
// correr y el porcentaje de plazo— y §4 la rehace por su cuenta a DOS
// instantes distintos. Un sitio que leyera el reloj daría el mismo número con
// los dos sellos, y una constante también. El documento interno no lleva
// ninguna cifra derivada del instante, y eso se dice en vez de inventarle una.
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
// El módulo ES la función; las otras tres puertas son propiedades suyas.
// Destructurar `noArranco` de ahí lo deja en `undefined` sin ruido.
const noArranco = require('./no-arranco.cjs');
const { vigilarExcepciones, sinPrecondicion } = noArranco;
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');

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
    // Antes esta mutación era `const hoyD = sello.momento;` → `new Date()`, y
    // mordía la gráfica de plazo del papel único. Ese `hoyD` se fue con
    // `generarPDFObra`. El plazo que hoy se calcula sobre el sello es el del
    // informe del Art. 73, y es el que se rompe aquí.
    //
    // EL ENCABEZADO NO SE MUTA AQUÍ, A PROPÓSITO: `const hoy = sello.fecha;`
    // está en los dos generadores, y las dos copias ya las mutan
    // `prueba-el-informe-del-articulo-73` y `prueba-el-documento-interno-de-cotea`,
    // cada uno sobre su papel. Repetirlo aquí haría que el día que ese renglón
    // cambie haya tres archivos que arreglar para un solo movimiento.
    ['APP', 'el plazo del informe vuelve a leer el reloj en vez del sello',
      (t) => t.replace(
        '  const plazo = plazoDeObra(obra, fechaEnZonaObra(sello.momento) || hoyLocalISO());',
        '  const plazo = plazoDeObra(obra, hoyLocalISO());')],
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
    APP = fuenteDe(ARCH_APP,
      ['generarPDFArt73', 'generarPDFInterno', 'selloDeTiempo'], { tolerante: true });
  } catch (e) {
    if (e instanceof SimboloPerdido) noArranco(e.faltantes, path.relative(RAIZ, ARCH_APP));
    throw e;
  }
  if (APP.faltan.length) noArranco(APP.faltan, path.relative(RAIZ, ARCH_APP));

  const armarAPP = (e) => new Function(
    'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
    `"use strict";\n${APP.cuerpo}\nreturn (${e});`
  )(...Array(6).fill(() => {}));

  let selloDeTiempo, generarPDFArt73, generarPDFInterno;
  try {
    selloDeTiempo = armarAPP('selloDeTiempo');
    generarPDFArt73 = armarAPP('generarPDFArt73');
    generarPDFInterno = armarAPP('generarPDFInterno');
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

  // ═══ §4 · LOS DOS PAPELES: UN SOLO INSTANTE ══════════════════════════════
  //
  // Dos instantes, los dos a meses de hoy. MARZO es el que se imprime y se
  // mira renglón por renglón; JUNIO existe para que una cifra derivada del
  // sello no pueda pasar por constante ni por lectura del reloj: con los dos
  // sellos tiene que dar DISTINTO, y lo que dé tiene que cuadrar con la
  // aritmética de las fechas de la obra, rehecha aquí.
  const MS_MARZO = Date.UTC(2026, 2, 15, 18, 0, 0); // 15 mar 2026, 12:00 en México
  const MS_JUNIO = Date.UTC(2026, 5, 15, 18, 0, 0); // 15 jun 2026, 13:00 en México
  const OBRA = {
    id: '0114', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001',
    cliente: 'H. Ayuntamiento de Coatzacoalcos', ubicacion: 'Coatzacoalcos, Ver.',
    inicio: '2026-01-10', fin: '2026-12-20', presupuesto: 38500000,
  };
  // Los dos sellos, con el día de calendario que les toca en la obra DICHO
  // AQUÍ. Preguntárselo al código que se está midiendo haría que una fecha mal
  // calculada cuadrara consigo misma.
  const SELLOS = [['marzo', MS_MARZO, '2026-03-15'], ['junio', MS_JUNIO, '2026-06-15']];

  // Días entre dos fechas ISO, al mediodía para que ningún cambio de horario
  // de verano mueva la cuenta. Es la aritmética del banco: si coincide con la
  // del papel es porque las dos están bien, no porque sean la misma copia.
  const diasEntre = (a, b) =>
    Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

  const dibujarCon = async (generar, cual, instante) => {
    try {
      return await dibujarPDFInterno(generar, { obra: OBRA, subs: [], instante });
    } catch (e) {
      sinPrecondicion(`${cual} no se pudo dibujar`,
        [e.message.split('\n')[0],
         'Sin dibujo, «no dice tal cosa» se cumple por no haber impreso nada.']);
    }
    return [];
  };

  // El valor de una teja se lee POR SU RÓTULO y no por su posición: el papel
  // se reordena y una posición tecleada aquí empezaría a medir la teja de al
  // lado sin que nada se pusiera rojo.
  const trasElRotulo = (textos, rotulo, cuantos = 3) => {
    const i = textos.indexOf(rotulo);
    return i < 0 ? [] : textos.slice(i + 1, i + 1 + cuantos);
  };

  const PAPELES = [
    ['el informe del Art. 73', generarPDFArt73],
    ['el documento interno', generarPDFInterno],
  ];

  // ── Lo que se le exige a LOS DOS papeles ─────────────────────────────────
  for (const [cual, generar] of PAPELES) {
    const hoja = await dibujarCon(generar, cual, { ms: MS_MARZO, fuente: 'servidor' });
    const textos = hoja.map((d) => String(d.texto));
    if (textos.length < 20)
      sinPrecondicion(`${cual} sólo dibujó ${textos.length} textos`,
        ['Con el dibujo casi vacío cualquier «no aparece» se cumple por vacío.']);

    const sello = selloDeTiempo({ ms: MS_MARZO, fuente: 'servidor' });

    // (a) La portada declara el corte, con hora y con origen.
    const portada = hoja.filter((d) => d.pagina === 1);
    check(portada.some((d) => String(d.texto) === sello.corte),
      `${cual}: la portada imprime el corte con su hora y declara de dónde salió`,
      `«${sello.corte}» en la página 1`,
      portada.filter((d) => /marzo|servidor|equipo/.test(String(d.texto)))
        .map((d) => `«${d.texto}»`).join(' · ') || 'nada parecido');

    // (b) El encabezado de las páginas interiores lleva esa misma fecha.
    const interiores = hoja.filter((d) => d.pagina > 1);
    if (!interiores.length)
      sinPrecondicion(`${cual} se quedó en una sola página`,
        ['Sin páginas interiores no se puede mirar el encabezado, que es el',
         'segundo sitio que leía el reloj.']);
    check(interiores.some((d) => String(d.texto) === sello.fecha && d.align === 'right'),
      `${cual}: el encabezado de cada página lleva la fecha del sello, no la del reloj`,
      `«${sello.fecha}» alineada a la derecha en una página interior`,
      interiores.filter((d) => d.align === 'right' && /20\d\d/.test(String(d.texto)))
        .slice(0, 3).map((d) => `«${d.texto}»`).join(' · ') || 'ninguna fecha a la derecha');

    // (c) Ningún sitio del papel se quedó leyendo el reloj: la fecha de HOY no
    // puede aparecer en ninguna parte. Con un sello de marzo y la suite
    // corriendo cualquier otro día, verla es la prueba de que algo no pasó por
    // el sello.
    const hoyLarga = new Date().toLocaleDateString('es-MX',
      { timeZone: 'America/Mexico_City', day: '2-digit', month: 'long', year: 'numeric' });
    if (hoyLarga === sello.fecha) {
      // Hoy ES el 15 de marzo de 2026: esta comprobación no distingue nada, así
      // que no se afirma. Decirlo es mejor que dar un verde que no midió.
      console.log(` --   ${cual}: hoy coincide con el instante de prueba; esto no acota`);
    } else {
      const coladas = textos.filter((t) => t === hoyLarga);
      check(coladas.length === 0,
        `${cual}: ningún renglón se quedó leyendo el reloj del aparato`,
        `cero apariciones de «${hoyLarga}»`,
        `${coladas.length} aparición(es)`);
    }

    // (d) La frontera. Sellado con el reloj del aparato, el papel entero no
    // puede decir «hora del servidor» en ninguna página.
    const conEquipo = (await dibujarCon(generar, cual, { ms: MS_MARZO, fuente: 'equipo' }))
      .map((d) => String(d.texto));
    const presume = conEquipo.filter((t) => /hora del servidor/.test(t));
    check(presume.length === 0 && conEquipo.some((t) => /este equipo/.test(t)),
      `${cual}: sellado con el reloj del aparato lo dice, y no presume el servidor`,
      'cero «hora del servidor» y al menos un «este equipo»',
      `${presume.length} presunción(es) · `
        + `${conEquipo.filter((t) => /este equipo/.test(t)).length} declaración(es)`);
  }

  // ── Lo que sólo tiene el informe del Art. 73: ARITMÉTICA sobre el sello ──
  //
  // El documento interno no deriva ninguna cifra del instante —sólo imprime
  // fechas— y por eso no se le exige nada de esto. Medido, no supuesto: con
  // los dos sellos, el interno cambia en sus renglones de fecha y en ningún
  // número. Inventarle un plazo transcurrido para simetría sería inventar una
  // cifra.
  const PLAZO_TOTAL = diasEntre(OBRA.inicio, OBRA.fin);
  const transcurridos = {};
  for (const [nombre, ms, iso] of SELLOS) {
    const textos = (await dibujarCon(generarPDFArt73, 'el informe del Art. 73',
      { ms, fuente: 'servidor' })).map((d) => String(d.texto));

    // El plazo transcurrido, contado por el banco desde el inicio de la obra
    // hasta el día de calendario del sello.
    const esperado = `${diasEntre(OBRA.inicio, iso)} de ${PLAZO_TOTAL} días`;
    const dicho = trasElRotulo(textos, 'PLAZO TRANSCURRIDO')
      .find((t) => /^\d+ de \d+ días$/.test(t));
    check(dicho === esperado,
      `el plazo transcurrido del informe se cuenta desde el sello de ${nombre}`,
      `«${esperado}» bajo PLAZO TRANSCURRIDO`,
      dicho ? `«${dicho}»` : 'ningún renglón con esa forma bajo ese rótulo');

    // Y el porcentaje de la misma teja tiene que ser ESOS días, no otra
    // cuenta: un KPI que discrepa del renglón que lo explica es el defecto
    // «una cuenta por número» dentro de un solo recuadro.
    const pct = trasElRotulo(textos, 'PLAZO TRANSCURRIDO').find((t) => /^\d+\.\d%$/.test(t));
    const n = dicho ? Number(dicho.match(/^(\d+) de (\d+)/)[1]) : NaN;
    const tot = dicho ? Number(dicho.match(/^(\d+) de (\d+)/)[2]) : NaN;
    const pctEsperado = `${(n / tot * 100).toFixed(1)}%`;
    check(pct === pctEsperado,
      `el porcentaje de plazo de ${nombre} es el de sus propios días, no otra cuenta`,
      `«${pctEsperado}», que es ${n} de ${tot}`,
      pct ? `«${pct}»` : 'ningún porcentaje bajo ese rótulo');

    // Los días por correr son el resto del mismo plazo, no una tercera cuenta.
    const porCorrer = trasElRotulo(textos, 'DÍAS POR CORRER').find((t) => /^-?\d+$/.test(t));
    check(porCorrer === String(tot - n),
      `los días por correr de ${nombre} son el resto de ese mismo plazo`,
      `«${tot - n}»`,
      porCorrer ? `«${porCorrer}»` : 'ningún número bajo DÍAS POR CORRER');

    // Y el cierre cita el corte con su origen, en el papel que se entrega.
    const sello = selloDeTiempo({ ms, fuente: 'servidor' });
    check(textos.some((t) => t.includes(`Generado por cotea el ${sello.corte}`)),
      `el cierre del informe de ${nombre} cita el corte con su origen`,
      `un renglón con «Generado por cotea el ${sello.corte}»`,
      textos.filter((t) => /Generado por cotea/.test(t))
        .map((t) => `«${t.slice(0, 80)}…»`).join(' · ') || 'ningún renglón de cierre');

    transcurridos[nombre] = dicho;
  }

  // El cierre de la sección: con dos sellos distintos la cifra TIENE que haber
  // cambiado. Si no, no se midió el sello —se midió una constante o el reloj—
  // y las comprobaciones de arriba podrían estar pasando por casualidad.
  check(transcurridos.marzo !== transcurridos.junio
    && !!transcurridos.marzo && !!transcurridos.junio,
    'mover el sello mueve el plazo del informe: la cifra sale del sello y de nada más',
    'dos plazos distintos para dos sellos distintos',
    `marzo «${transcurridos.marzo}» · junio «${transcurridos.junio}»`);

  console.log('');
  if (fallas) {
    console.log(`${fallas} comprobación(es) en rojo.`);
    process.exit(1);
  }
  console.log('La hora que el documento cita es la que dice que es.');
})();
