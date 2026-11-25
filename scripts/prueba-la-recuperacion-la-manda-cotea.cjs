#!/usr/bin/env node
// EL CORREO DE RECUPERAR LO MANDA COTEA, Y NO DICE QUIÉN TIENE CUENTA
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El #24. El 2026-11-24 se midió que Google tiene BLOQUEADA la plantilla de
// correo de este proyecto: `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED` por API, y la
// consola dice lo mismo con otras palabras. El mismo candado tapa
// `callbackUri`, que es el campo del host del enlace; el dominio propio de
// Auth contesta 200 y no guarda nada.
//
// O sea que mientras el correo lo mandara Firebase, el enlace que recibe
// alguien bloqueado fuera de la app iba a seguir diciendo
// `campo-fosmon.firebaseapp.com` —el nombre de un CLIENTE de cotea— y el texto
// iba a seguir siendo el de Google. Por eso el correo lo manda ahora
// `mandarRecuperacion`.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. Las piezas puras se EXTRAEN y se EJECUTAN, y
// el `onCall` se MONTA ENTERO sobre una base de mentira cuyo Admin SDK
// devuelve el enlace con el host de Firebase —como el de verdad— y lanza
// `auth/user-not-found` cuando la cuenta no está. Lo que se mide es el correo
// que sale, el enlace que lleva dentro, y qué se contesta.
//
// Las cuatro conductas que no se pueden perder:
//
//   1. El enlace que se manda NO dice el nombre del proyecto, y conserva el
//      `oobCode` —sin él no abre nada— y la ruta que cotea de verdad sirve.
//   2. La respuesta es LA MISMA exista o no la cuenta. Es el único `onCall`
//      sin sesión del archivo: contestar distinto lo vuelve un comprobador de
//      correos, y en un padrón de 18 personas eso es la lista del personal.
//   3. Para una cuenta que no existe NO sale correo. La respuesta idéntica no
//      sirve de nada si el envío delata por otro lado.
//   4. Una dirección no se puede inundar dándole al botón.
//
// Uso:
//   node scripts/prueba-la-recuperacion-la-manda-cotea.cjs
//   node scripts/prueba-la-recuperacion-la-manda-cotea.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');
const CP = require('./contraprueba.cjs');
const andamios = require('./montar-trabajo-de-funciones.cjs');
const { baseFalsa } = andamios;

const MUTANTES = [
  { nombre: 'el host deja de cambiarse: el enlace vuelve a decir el nombre del proyecto',
    de: `  u.protocol = propio.protocol;\n  u.host = propio.host;`,
    a:  `  void propio;` },
  { nombre: 'se cambia el host sin comprobar la ruta: enlace muerto con buena pinta',
    de: `  if (!u.pathname.startsWith(RUTA_QUE_COTEA_SIRVE)) return null;`,
    a:  `  if (false) return null;` },
  { nombre: 'la query se tira al reescribir y el `oobCode` se queda en el camino',
    de: `  return u.toString();`,
    a:  `  return u.origin + u.pathname;` },
  { nombre: 'la cuenta que no existe se contesta distinto, y la pantalla queda de padrón',
    de: `      if (!CUENTA_QUE_NO_ESTA.has(e?.code))`,
    a:  `      if (true) throw new HttpsError("not-found", "esa cuenta no existe");\n      if (!CUENTA_QUE_NO_ESTA.has(e?.code))` },
  { nombre: 'vuelve el código del SDK del cliente, que el Admin SDK no lanza nunca',
    de: `const CUENTA_QUE_NO_ESTA = new Set(["auth/email-not-found", "auth/user-not-found"]);`,
    a:  `const CUENTA_QUE_NO_ESTA = new Set(["auth/user-not-found"]);` },
  { nombre: 'el intento se anota después de hablar con Auth: probar direcciones queda sin tope',
    de: `    try { await ref.set({ ultimoIntentoMs: ahora }, { merge: true }); } catch (e) {`,
    a:  `    try { if (false) await ref.set({ ultimoIntentoMs: ahora }, { merge: true }); } catch (e) {` },
  { nombre: 'la espera corta vuelve a contar envíos y no intentos, que es el hueco medido',
    de: `  const ultimo = Number(previo?.ultimoIntentoMs || 0);`,
    a:  `  const ultimo = Number(previo?.ultimoEnvioMs || 0);` },
  { nombre: 'el tope del día cuenta intentos: cualquiera le quema el día a una persona real',
    de: `  const delDia = Array.isArray(previo?.enviosMs) ? previo.enviosMs.map(Number) : [];`,
    a:  `  const delDia = previo?.ultimoIntentoMs ? [Number(previo.ultimoIntentoMs)] : [];` },
  { nombre: 'vuelve el «Hola:» de plantilla y el correo deja de decir a quién va',
    de: `      titulo: pila ? \`¡Hola, \${pila}!\` : "¡Hola!",`,
    a:  `      titulo: "Hola:",` },
  { nombre: 'sin nombre se saluda con la dirección entera en vez de sin nombre',
    de: `      titulo: pila ? \`¡Hola, \${pila}!\` : "¡Hola!",`,
    a:  `      titulo: \`¡Hola, \${pila || correo}!\`,` },
  { nombre: 'el nombre deja de leerse del perfil: todos vuelven a ser anónimos',
    de: `      nombre = ((await db.doc(\`usuarios/\${emailAId(crudo)}\`).get()).data() || {}).nombre || "";`,
    a:  `      nombre = "";` },
  { nombre: 'la regla del nombre se separa de la del front: «J. Alberto» saluda «J.»',
    de: `  return n.split(/\\s+/).find(p => p.length > 2 && !p.endsWith(".")) || n;`,
    a:  `  return n.split(/\\s+/)[0] || n;` },
  { nombre: 'el tope de seguidos se va: un botón basta para inundar un buzón',
    de: `  if (ultimo && ahoraMs - ultimo < ESPERA_ENTRE_INTENTOS_MS)\n    return { puede: false, motivo: "demasiado-seguido" };`,
    a:  `  if (false) return { puede: false, motivo: "demasiado-seguido" };` },
  { nombre: 'el tope diario se va: cinco al minuto se vuelven mil al día',
    de: `  if (recientes.length >= TOPE_POR_DIA)\n    return { puede: false, motivo: "tope-diario" };`,
    a:  `  if (false) return { puede: false, motivo: "tope-diario" };` },
  { nombre: 'el tope diario deja de olvidar: a los seis intentos la cuenta queda muerta para siempre',
    de: `  const recientes = delDia.filter(t => ahoraMs - t < DIA_MS);`,
    a:  `  const recientes = delDia;` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCH_FUNCS, 'utf8'),
    { archivo: ARCH_FUNCS, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCH_FUNCS, 'utf8'),
    archivo: ARCH_FUNCS, extension: '.js',
    comoCorrer: (ruta) => ({ args: [], env: { ARCH_FUNCS: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── LAS PIEZAS PURAS, EXTRAÍDAS Y EJECUTADAS ────────────────────────────────
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const src = fs.readFileSync(ARCH_FUNCS, 'utf8');
const trozos = {};
traverse(parse(src, { sourceType: 'script' }), {
  FunctionDeclaration(p) {
    if (p.parent.type === 'Program' && p.node.id)
      trozos[p.node.id.name] = src.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (n && p.node.init && p.scope.block.type === 'Program')
      trozos[n] = `const ${n} = ${src.slice(p.node.init.start, p.node.init.end)};`;
  },
});

const NECESITA = ['RUTA_QUE_COTEA_SIRVE', 'APP_URL', 'enlaceEnCotea',
                  'ESPERA_ENTRE_INTENTOS_MS', 'TOPE_POR_DIA', 'DIA_MS', 'puedeMandarOtro'];
const sin = NECESITA.filter(n => !trozos[n]);
if (sin.length) noArranco([`no se hallaron en las funciones: ${sin.join(', ')}`],
  path.relative(raiz, ARCH_FUNCS));

let enlaceEnCotea, puedeMandarOtro, APP_URL, TOPE_POR_DIA, ESPERA_ENTRE_INTENTOS_MS;
try {
  ({ enlaceEnCotea, puedeMandarOtro, APP_URL, TOPE_POR_DIA, ESPERA_ENTRE_INTENTOS_MS } =
    new Function(`"use strict";
      ${NECESITA.map(n => trozos[n]).join('\n')}
      return { enlaceEnCotea, puedeMandarOtro, APP_URL, TOPE_POR_DIA, ESPERA_ENTRE_INTENTOS_MS };`)());
} catch (e) {
  noArranco([`las piezas no se pudieron montar: ${e.message}`], path.relative(raiz, ARCH_FUNCS));
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Lo que el Admin SDK devuelve de verdad en producción.
const COMO_LO_DA_EL_SDK =
  'https://campo-fosmon.firebaseapp.com/__/auth/action' +
  '?mode=resetPassword&oobCode=AbC-123_xYz&apiKey=AIzaFalsa&lang=es';

const correr = async (opciones = {}) => {
  const { cuentas = {}, docs = {}, enlaceDeAuth = null, rebota = false } = opciones;
  const base = baseFalsa(docs, { cuentasIniciales: cuentas, enlaceDeAuth });
  const correos = [];
  const fetchRuteado = async (url, o = {}) => {
    if (rebota) return { ok: false, status: 422, json: async () => ({ message: 'buzón inexistente' }) };
    correos.push(JSON.parse(o.body || '{}'));
    return { ok: true, status: 200, json: async () => ({ id: `re_${correos.length}` }) };
  };
  // El registro se captura porque es una conducta, no un adorno: un camino
  // ESPERADO que sale por `console.error` llena el registro de alarmas falsas,
  // y un registro con alarmas falsas es cómo se dejan de ver las de verdad.
  const registro = { error: [], warn: [], log: [] };
  const consolaFalsa = {
    error: (...a) => registro.error.push(a.join(' ')),
    warn:  (...a) => registro.warn.push(a.join(' ')),
    log:   (...a) => registro.log.push(a.join(' ')),
  };
  const fn = andamios.montar(ARCH_FUNCS, 'mandarRecuperacion', base,
    { inyecciones: { fetch: fetchRuteado, console: consolaFalsa } });
  let devolvio = null, lanzo = null;
  try { devolvio = await fn({ data: opciones.data || { correo: 'quien@fosmon.com.mx' } }); }
  catch (e) { lanzo = e; }
  return { base, correos, devolvio, lanzo, registro };
};

(async () => {
  console.log('\n── EL CORREO DE RECUPERAR LO MANDA COTEA ──\n');

  console.log('§1 · el enlace se muda a cotea sin perder lo que lo hace servir');
  const movido = enlaceEnCotea(COMO_LO_DA_EL_SDK);
  const u = movido ? new URL(movido) : null;
  check(!!movido, 'el enlace del SDK se puede reescribir', movido ? '' : 'DEVOLVIÓ null');
  check(!!u && u.host === new URL(APP_URL).host,
    `el host es el de cotea (${new URL(APP_URL).host})`, u ? u.host : '');
  check(!!movido && !/campo-fosmon|fosmon/i.test(movido),
    'y en el enlace entero no queda el nombre del proyecto ni del cliente',
    movido && /campo-fosmon/i.test(movido) ? 'LO SIGUE DICIENDO' : '');
  check(!!u && u.searchParams.get('oobCode') === 'AbC-123_xYz',
    'el `oobCode` llega intacto, que es lo único que abre la pantalla',
    u ? (u.searchParams.get('oobCode') || 'SE PERDIÓ') : '');
  check(!!u && u.pathname === new URL(COMO_LO_DA_EL_SDK).pathname,
    'la ruta es la que dio el SDK, no una inventada aquí', u ? u.pathname : '');

  console.log('\n§2 · y se niega a reescribir lo que cotea no sirve');
  const NO_SE_TOCAN = [
    ['https://campo-fosmon.firebaseapp.com/otra/ruta?oobCode=x', 'una ruta que la reescritura no cubre'],
    ['http://127.0.0.1:9099/emulator/action?oobCode=x', 'la del emulador, que no existe en cotea'],
    ['https://campo-fosmon.firebaseapp.com/__/auth/action?mode=resetPassword', 'sin `oobCode`: no abriría nada'],
    ['no-es-una-url', 'basura'],
    ['', 'vacío'],
    [null, 'null'],
  ];
  for (const [e, porque] of NO_SE_TOCAN)
    check(enlaceEnCotea(e) === null, `devuelve null para ${porque}`,
      enlaceEnCotea(e) ? `DEVOLVIÓ «${String(enlaceEnCotea(e)).slice(0, 48)}»` : '');

  console.log('\n§3 · la misma respuesta exista o no la cuenta, y correo sólo si existe');
  const existe = await correr({ cuentas: { 'quien@fosmon.com.mx': 'uid-1' } });
  const noExiste = await correr({ cuentas: {} });
  // El mismo caso con perfil, que es el que trae nombre con el que saludar.
  // Se corre aparte para que §3 siga comparando una cuenta SIN perfil contra
  // una que no existe: son los dos casos en que el correo no sabe cómo llamar
  // a nadie, y tienen que seguir contestando igual.
  const conNombre = await correr({
    cuentas: { 'quien@fosmon.com.mx': 'uid-1' },
    docs: { 'usuarios/quien_fosmon_com_mx': { nombre: 'J. Alberto Ruiz Pérez' } },
  });
  check(!existe.lanzo && !noExiste.lanzo, 'ninguno de los dos casos lanza',
    [existe.lanzo && `existe: ${existe.lanzo.message}`,
     noExiste.lanzo && `no existe: ${noExiste.lanzo.message}`].filter(Boolean).join('; '));
  check(JSON.stringify(existe.devolvio) === JSON.stringify(noExiste.devolvio),
    'contestan EXACTAMENTE lo mismo',
    `${JSON.stringify(existe.devolvio)} vs ${JSON.stringify(noExiste.devolvio)}`);
  check(existe.correos.length === 1, 'a la cuenta que existe le sale un correo',
    `${existe.correos.length}`);
  check(noExiste.correos.length === 0,
    'y a la que no existe NO le sale ninguno, que es la otra mitad de no delatar',
    `${noExiste.correos.length}`);

  console.log('\n§4 · lo que ese correo lleva dentro');
  const sobre = conNombre.correos[0] || {};
  const html = String(sobre.html || '');
  check(!/campo-fosmon/i.test(html + String(sobre.subject || '')),
    'ni el asunto ni el cuerpo dicen `campo-fosmon`',
    /campo-fosmon/i.test(html) ? 'EL CUERPO LO DICE' : '');
  check(html.includes(`${APP_URL}/__/auth/action`),
    'el enlace del cuerpo apunta a cotea', html.includes(APP_URL) ? '' : 'NO ESTÁ');
  check(/oobCode=CODIGO-uid-1/.test(html),
    'y lleva el código que el SDK generó para esa cuenta',
    /oobCode=/.test(html) ? '' : 'SIN CÓDIGO');
  check(String(sobre.to || '') === 'quien@fosmon.com.mx' ||
        (Array.isArray(sobre.to) && sobre.to[0] === 'quien@fosmon.com.mx'),
    'va sólo a quien lo pidió', JSON.stringify(sobre.to));

  // ── EL SALUDO ─────────────────────────────────────────────────────────────
  // «Hola:» a secas es de plantilla de sistema. El nombre sale del perfil, y
  // la regla para cortarlo es la MISMA que usa la app al entrar: la persona no
  // puede llamarse distinto en la pantalla y en el correo.
  console.log('\n§4b · saluda por su nombre, con la regla de la app');
  check(/¡Hola, Alberto!/.test(html),
    'saluda «¡Hola, Alberto!» — nombre de pila, no la inicial ni el nombre entero',
    (/¡Hola[^<]*/.exec(html) || ['no saluda'])[0]);
  check(!/Hola:/.test(html) && !/¡Hola!/.test(html),
    'y ya no queda el «Hola:» de plantilla cuando sí hay nombre');
  const sinPerfil = existe.correos[0] || {};
  check(/¡Hola!/.test(String(sinPerfil.html || '')),
    'sin perfil saluda sin nombre, en vez de inventarse uno o pegar la dirección',
    (/¡Hola[^<]*/.exec(String(sinPerfil.html || '')) || ['no saluda'])[0]);
  check(!/undefined|null|\[object/.test(String(sinPerfil.html || '')),
    'y no se le cuela un `undefined` al cuerpo por no tener nombre');

  console.log('\n§4c · la regla del nombre es UNA, aunque esté escrita dos veces');
  // Dos tiempos de ejecución, sin build compartido: la copia del front y la de
  // las funciones no se pueden fundir. Lo que sí se puede es correrlas a las
  // dos y exigir que contesten igual, que es lo que impide que se separen.
  const { deApp, deArchivo } = require('./extraer-de-app.cjs');
  let delFront, deLasFunciones;
  try {
    ({ nombreDePila: delFront } = deApp('nombreDePila'));
    ({ nombreDePila: deLasFunciones } = deArchivo(ARCH_FUNCS, 'nombreDePila'));
  } catch (e) {
    noArranco([`no se pudieron extraer las dos copias de \`nombreDePila\`: ${e.message}`],
      'src/App.jsx + functions/index.js');
  }
  const NOMBRES = [
    ['Oscar Fosado Galland', 'Oscar',   'tres palabras, la de siempre'],
    ['J. Alberto Ruiz',      'Alberto', 'inicial con punto: no es el nombre de pila'],
    ['Ma. Luz Hernández',    'Luz',     'la abreviatura tampoco'],
    ['Ana',                  'Ana',     'una sola palabra'],
    ['Ed',                   'Ed',      'dos letras: no hay nada mejor, se usa tal cual'],
    ['  Luis  Ramos  ',      'Luis',    'con espacios de sobra'],
    ['pepe@fosmon.com.mx',   'pepe',    'cuando el «nombre» es la dirección, se corta en la arroba'],
    ['',                     '',        'vacío'],
    [null,                   '',        'null'],
    [undefined,              '',        'undefined'],
  ];
  for (const [entrada, esperado, porque] of NOMBRES) {
    const a = delFront(entrada), b = deLasFunciones(entrada);
    check(a === b && a === esperado,
      `«${String(entrada)}» → «${esperado}» — ${porque}`,
      a === b ? (a === esperado ? '' : `las dos dicen «${a}»`)
              : `DISCREPAN: front «${a}» · funciones «${b}»`);
  }

  // Son DOS topes con cuentas distintas, y el banco mide las dos: la espera
  // corta se apoya en INTENTOS —para que probar direcciones también cueste— y
  // el tope del día en ENVÍOS, para que nadie pueda agotarle a una persona
  // real su recuperación probando su dirección.
  console.log('\n§5 · dos topes, y cada uno cuenta lo suyo');
  const ahora = Date.now();
  const casos = [
    [{}, true, 'la primera vez'],
    [{ ultimoIntentoMs: ahora - 5000 }, false,
      'cinco segundos después, aunque no se haya mandado nada: el intento cuenta'],
    [{ ultimoIntentoMs: ahora - 61000 }, true, 'pasado el minuto'],
    [{ ultimoIntentoMs: ahora - 120000,
       enviosMs: Array.from({ length: TOPE_POR_DIA }, (_, i) => ahora - 120000 - i * 1000) },
      false, `con ${TOPE_POR_DIA} ya MANDADOS hoy`],
    [{ ultimoIntentoMs: ahora - 120000,
       enviosMs: Array.from({ length: TOPE_POR_DIA - 1 }, (_, i) => ahora - 120000 - i * 1000) },
      true, `con ${TOPE_POR_DIA - 1} mandados: el del día no se agota antes de tiempo`],
    [{ ultimoIntentoMs: ahora - 26 * 3600 * 1000,
       enviosMs: Array.from({ length: TOPE_POR_DIA }, (_, i) => ahora - (26 + i) * 3600 * 1000) },
      true, 'los de ayer ya no cuentan: la cuenta no queda muerta para siempre'],
  ];
  for (const [previo, esperado, porque] of casos) {
    const r = puedeMandarOtro(previo, ahora);
    check(r.puede === esperado, `${esperado ? 'deja' : 'frena'} ${porque}`,
      r.puede === esperado ? (r.motivo || '') : `dijo ${r.puede} (${r.motivo || 'sin motivo'})`);
  }
  check(ESPERA_ENTRE_INTENTOS_MS > 0 &&
        puedeMandarOtro({ ultimoIntentoMs: ahora - (ESPERA_ENTRE_INTENTOS_MS - 1) }, ahora).puede === false &&
        puedeMandarOtro({ ultimoIntentoMs: ahora - (ESPERA_ENTRE_INTENTOS_MS + 1) }, ahora).puede === true,
    'la frontera del minuto está donde se declaró, no un segundo antes ni después',
    `${ESPERA_ENTRE_INTENTOS_MS} ms`);

  console.log('\n§6 · probar una dirección que no existe también deja rastro, y por eso cuesta');
  const probada = await correr({ cuentas: {}, data: { correo: 'nadie@fosmon.com.mx' } });
  const rastro = probada.base.docs.get('recuperaciones/nadie_fosmon_com_mx') || {};
  check(Number(rastro.ultimoIntentoMs) > 0,
    'queda anotado el intento, así que el siguiente martillazo se frena',
    rastro.ultimoIntentoMs ? 'anotado' : 'SIN RASTRO: el buzón de llamadas queda sin tope');
  check(!Array.isArray(rastro.enviosMs) || rastro.enviosMs.length === 0,
    'y NO cuenta como envío: nadie le puede quemar el día a una persona real probando su dirección',
    `enviosMs=${JSON.stringify(rastro.enviosMs || [])}`);

  // El defecto que el emulador vio y el banco no: el Admin SDK lanza
  // `auth/email-not-found`, no `auth/user-not-found`. Con el código
  // equivocado en la lista, CADA dirección probada salía por `console.error`
  // como si fuera una avería. Probar direcciones es el camino esperado de esta
  // función —es justo lo que no se contesta—, así que no es una avería y no
  // puede sonar como una.
  check(probada.registro.error.length === 0,
    'y no sale por `console.error`: una dirección sin cuenta es un camino esperado, no una avería',
    probada.registro.error.length
      ? `${probada.registro.error.length} alarma(s) falsa(s): «${probada.registro.error[0].slice(0, 80)}»`
      : '');
  // La otra cara, y va con cuenta que SÍ existe a propósito: sin eso el caso
  // sale por el camino de «no hay cuenta» y la aserción pasaría sin haber
  // llegado nunca al renglón que dice medir.
  const reventado = await correr({
    cuentas: { 'quien@fosmon.com.mx': 'uid-9' }, data: { correo: 'quien@fosmon.com.mx' },
    enlaceDeAuth: 'https://campo-fosmon.firebaseapp.com/sin/la/ruta?oobCode=x',
  });
  check(reventado.correos.length === 0,
    'un enlace que cotea no sirve no se manda: un enlace muerto es peor que ningún correo',
    `${reventado.correos.length} correo(s)`);
  check(/no tiene la ruta/.test(reventado.registro.error.join(' ')),
    'y eso SÍ suena en el registro, nombrando el archivo que hay que revisar',
    reventado.registro.error[0]
      ? reventado.registro.error[0].slice(0, 90) : 'REGISTRO MUDO');

  console.log('\n§7 · y lo frenado no se nota desde fuera');
  const frenado = await correr({
    cuentas: { 'quien@fosmon.com.mx': 'uid-1' },
    docs: { 'recuperaciones/quien_fosmon_com_mx': { ultimoIntentoMs: Date.now() - 1000 } },
  });
  check(frenado.correos.length === 0, 'el frenado no manda correo', `${frenado.correos.length}`);
  check(JSON.stringify(frenado.devolvio) === JSON.stringify(existe.devolvio),
    'y contesta lo mismo que el que sí salió',
    `${JSON.stringify(frenado.devolvio)} vs ${JSON.stringify(existe.devolvio)}`);

  console.log('\n§8 · un correo que el servidor rechaza tampoco delata, pero queda contado');
  const rebotado = await correr({ cuentas: { 'quien@fosmon.com.mx': 'uid-1' }, rebota: true });
  check(JSON.stringify(rebotado.devolvio) === JSON.stringify(existe.devolvio),
    'contesta lo mismo: un envío sólo falla para una cuenta que existe',
    `${JSON.stringify(rebotado.devolvio)}`);
  const anotado = rebotado.base.docs.get('recuperaciones/quien_fosmon_com_mx') || {};
  check(Number(anotado.fallos) === 1,
    'y el fallo queda anotado, que es donde SÍ se puede decir la verdad',
    `fallos=${anotado.fallos} motivo=«${anotado.ultimoMotivo || ''}»`);

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'quien recupera su contraseña recibe un correo de cotea, y nadie\n' +
      'averigua quién tiene cuenta dándole al botón.'
    : 'o el enlace delata el proyecto, o la pantalla delata el padrón.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
