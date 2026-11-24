#!/usr/bin/env node
// EL CORREO ENTREGA POR DOS PATAS, Y SE SABE EL DÍA QUE SE CAE UNA
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El #150. El 200 de Resend no es una entrega: Resend acepta el mensaje y
// contesta 200 aunque el buzón lo mande a spam, así que los tres renglones de
// correo de `global/health` pueden estar los tres en VERDE mientras ningún
// residente recibe nada. Y eso apaga justo el aviso que existe para que un
// residente no deje de capturar sin saberlo: el vigilante del silencio se
// apagaría en silencio.
//
// Lo que decide si entra al buzón es la autenticación del dominio, y vive en
// el DNS —en GoDaddy, fuera del repo y fuera de la consola de Firebase—, donde
// un dedo ajeno la puede mover sin avisarnos. Son dos patas: la FIRMA (DKIM,
// en `resend._domainkey.<dominio>`) y la RUTA DE RETORNO (`send.<dominio>`,
// con su SPF y su MX, que es el Return-Path que Resend pone en cada mensaje).
//
// ── LA CORRECCIÓN QUE ESTE BANCO AFIRMA ─────────────────────────────────────
// El #150 decía dos cosas que la medición del 2026-11-23 con `dig` desmintió:
// que NO había subdominio de retorno, y que por eso la entrega iba en una sola
// pata. `send.cotea.com.mx` sí existe —CNAME a `send.forge.rmta.net`, SPF
// propio con tres `ip4:` y MX a `feedback.forge.rmta.net`—, así que las dos
// patas están puestas. Y de ahí se sigue lo otro que estaba al revés: el SPF
// de la RAÍZ no necesita incluir a Resend, porque el sobre no sale de la raíz.
// El §5 de este banco afirma exactamente eso, porque era la premisa con la que
// casi se escribió al DNS de producción sin necesidad.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `medirLaEntregaDelCorreo` se EXTRAE de
// `functions/index.js` y se EJECUTA contra DNS armados —el de producción tal
// como se midió hoy, y uno por cada forma de romperlo—, y lo que se mide es el
// veredicto y el mensaje que quedarían escritos en `global/health`. El cron
// que lo llama se monta entero y se mide el documento que deja. Y del front se
// extrae la tabla de la pantalla de salud, porque un vigilante que nadie
// enseña no vigila.
//
// Sin red: el `dns` entra por parámetro justamente para que este banco no
// dependa de que GoDaddy conteste.
//
// Uso:
//   node scripts/prueba-el-correo-entrega-por-dos-patas.cjs
//   node scripts/prueba-el-correo-entrega-por-dos-patas.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');
const ARCH_APP = process.env.ARCH_APP || path.join(raiz, 'src/App.jsx');

// ── La contraprueba ─────────────────────────────────────────────────────────
// Cada mutación es una avería de verdad: o devuelve el código al estado en que
// estaba antes de este cambio, o rompe la semántica de la medición. Ninguna
// toca andamiaje.
//
// El corredor es el del repositorio (`contraprueba.cjs`) y no un bucle propio:
// este banco nació con el bucle copiado, que es la clase de defecto que ese
// archivo existe para cerrar —once copias, veintidós bancos sin guarda— y le
// faltaban las tres guardas que importan. La que más: la revisión de anclajes
// corre en CADA `npm test`, así que el día que uno de estos textos se mueva
// sale en rojo hoy y no dentro de meses.
//
// Son dos ficheros, y `correr` toma uno, así que se llama dos veces y los
// sobrevivientes se suman. Ninguna mutación cruza de fichero.
const CP = require('./contraprueba.cjs');

const MUT_FUNCS = [
    { nombre: 'una sola pata vuelve a contar como entrega buena',
      de: `  return { ok: patas === 2, dominio, patas, firma, rutaEntera,`,
      a:  `  return { ok: patas >= 1, dominio, patas, firma, rutaEntera,` },
    { nombre: 'el renglón de salud vuelve a decir `true` tecleado',
      de: `    await registrarSalud("entrega_correo", m.ok, m.mensaje, {`,
      a:  `    await registrarSalud("entrega_correo", true, m.mensaje, {` },
    { nombre: 'el TXT partido en trozos deja de unirse: la llave DKIM se lee como ausente',
      de: `  .map((f) => (Array.isArray(f) ? f.join("") : String(f || "")));`,
      a:  `  .map((f) => (Array.isArray(f) ? f[0] : String(f || "")));` },
    { nombre: 'la ruta de retorno se declara entera sin su MX: los rebotes dejan de volver',
      de: `  const rutaEntera = retornoAutoriza && mxRetorno.length > 0;`,
      a:  `  const rutaEntera = retornoAutoriza;` },
    { nombre: 'un SPF sin un solo mecanismo —que no autoriza a nadie— vuelve a pasar por pata',
      de: `  const retornoAutoriza = /(^|\\s)(ip4:|ip6:|include:|a[:\\s]|mx[:\\s])/i.test(spfRetorno);`,
      a:  `  const retornoAutoriza = !!spfRetorno;` },
    { nombre: 'el dominio se vuelve a teclear en vez de salir del remitente',
      de: `async function medirLaEntregaDelCorreo(dns, from) {\n  const dominio = dominioDelRemitente(from);`,
      a:  `async function medirLaEntregaDelCorreo(dns, from) {\n  const dominio = "cotea.com.mx";` },
    { nombre: 'un nombre que no resuelve vuelve a reventar el vigilante en vez de ser un dato',
      de: `    try { return unirTxt(await dns.resolveTxt(n)); } catch (e) { return ausenciaOReventar(e); }`,
      a:  `    return unirTxt(await dns.resolveTxt(n));` },
    { nombre: 'y un resolvedor caído vuelve a presentarse como «los registros no están»',
      de: `    if (AUSENTE.has(e?.code)) return [];\n    throw e;`,
      a:  `    return [];` },
    { nombre: 'el fallo midiendo el DNS se lo vuelve a tragar el cron',
      de: `    await registrarFalloDeSalud("entrega_correo", e, { duracionMs: Date.now() - tCorreo });`,
      a:  `    void 0;` },
    { nombre: 'el vigilante del correo, al caerse, vuelve a tumbar al de las denegaciones',
      de: `    await registrarFalloDeSalud("entrega_correo", e, { duracionMs: Date.now() - tCorreo });\n  }`,
      a:  `    await registrarFalloDeSalud("entrega_correo", e, { duracionMs: Date.now() - tCorreo });\n    throw e;\n  }` },
];

const MUT_APP = [
  { nombre: 'el renglón sale de la pantalla de salud: nadie ve el vigilante',
    de: `  { id:"entrega_correo",    funcion:"vigilarDenegaciones",    nombre:"Entrega del correo · autenticación del dominio",`,
    a:  `  { id:"entrega_correo_OTRO", funcion:"vigilarDenegaciones",  nombre:"Entrega del correo · autenticación del dominio",` },
  { nombre: 'y el renglón aguanta nueve días de silencio como si fuera semanal',
    de: `    que:"Mide en el DNS que la firma y la ruta de retorno sigan en pie.",\n    cuando:"diario 8:30",    limiteHoras: 36 },`,
    a:  `    que:"Mide en el DNS que la firma y la ruta de retorno sigan en pie.",\n    cuando:"diario 8:30",    limiteHoras: 9*24 },` },
];

// La revisión barata, SIEMPRE: atrapa el anclaje rancio en `npm test`, que es
// la única de las cuatro averías de una contraprueba que llega sola con el
// tiempo. En el hijo mutante no corre, porque ahí el anclaje ya NO está a
// propósito — eso es la mutación.
if (!process.env.SIN_CONTRAPRUEBA) {
  const callado = !!process.env.CALLADO;
  CP.exigirAnclajes(MUT_FUNCS, fs.readFileSync(ARCH_FUNCS, 'utf8'),
    { archivo: ARCH_FUNCS, callado });
  CP.exigirAnclajes(MUT_APP, fs.readFileSync(ARCH_APP, 'utf8'),
    { archivo: ARCH_APP, callado });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s =
    CP.correr({ mutaciones: MUT_FUNCS, src: fs.readFileSync(ARCH_FUNCS, 'utf8'),
      archivo: ARCH_FUNCS, extension: '.js',
      comoCorrer: (ruta) => ({ args: [], env: { ARCH_FUNCS: ruta, CALLADO: '1' } }) }) +
    CP.correr({ mutaciones: MUT_APP, src: fs.readFileSync(ARCH_APP, 'utf8'),
      archivo: ARCH_APP, extension: '.jsx',
      comoCorrer: (ruta) => ({ args: [], env: { ARCH_APP: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUT_FUNCS.length + MUT_APP.length));
}

const { deArchivo } = require('./extraer-de-app.cjs');
const andamios = require('./montar-trabajo-de-funciones.cjs');
const { baseFalsa } = andamios;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── LAS PIEZAS REALES ───────────────────────────────────────────────────────
const { medirLaEntregaDelCorreo, dominioDelRemitente } =
  deArchivo(ARCH_FUNCS, 'medirLaEntregaDelCorreo', 'dominioDelRemitente');
const { JOBS_PROGRAMADOS, estadoDeJob } =
  deArchivo(ARCH_APP, 'JOBS_PROGRAMADOS', 'estadoDeJob');

// ── EL DNS, ARMADO ──────────────────────────────────────────────────────────
//
// `PRODUCCION` no es un ejemplo: es lo que `dig` contestó el 2026-11-23 para
// `cotea.com.mx`, copiado tal cual. La llave DKIM va recortada —lo que se mide
// es que hay un `p=` de más de 40 caracteres, no cuál—, y va PARTIDA en trozos
// de 255 porque así viaja de verdad un TXT largo.
const LLAVE = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3y/FfTfKDvVOuPm0bn/v/EHknlZJmjJ' +
  'PzgncEkBTYLslox6G9By+HUdKAoeE/dAgQHQY2tsp6UPnF9mnRqAei2SWX+Lj5kpWYrAqzpkEkTScyo' +
  'PyYfo0Pw2CITSxCXNQwhkcpxKsQ2i9g7ci5e2sutl3FPCQT414WGhN6sm1MWQIDAQAB';
const enTrozos = (s) => s.match(/.{1,255}/g) || [s];

const PRODUCCION = {
  txt: {
    'cotea.com.mx': [['v=spf1 include:secureserver.net -all']],
    '_dmarc.cotea.com.mx': [['v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;']],
    'resend._domainkey.cotea.com.mx': [enTrozos(`p=${LLAVE}`)],
    'send.cotea.com.mx': [['v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all']],
  },
  mx: {
    'cotea.com.mx': [{ priority: 0, exchange: 'smtp.secureserver.net' },
      { priority: 10, exchange: 'mailstore1.secureserver.net' }],
    'send.cotea.com.mx': [{ priority: 10, exchange: 'feedback.forge.rmta.net' }],
  },
};

// Un DNS de mentira que se comporta como el de verdad en lo que importa: un
// nombre que no está LANZA con ENOTFOUND, no devuelve una lista vacía. Ésa es
// la diferencia que convirtió en un doble permisivo a cuatro andamios de este
// repo, y es justo el caso de «alguien borró el registro».
const dnsArmado = (zona) => {
  const falta = (n) => {
    const e = new Error(`queryTxt ENOTFOUND ${n}`);
    e.code = 'ENOTFOUND';
    throw e;
  };
  return {
    resolveTxt: async (n) => (zona.txt[n] !== undefined ? zona.txt[n] : falta(n)),
    resolveMx: async (n) => (zona.mx[n] !== undefined ? zona.mx[n] : falta(n)),
  };
};

// Copia de la zona con un nombre borrado o cambiado.
const sin = (zona, ...nombres) => {
  const z = { txt: { ...zona.txt }, mx: { ...zona.mx } };
  for (const n of nombres) { delete z.txt[n]; delete z.mx[n]; }
  return z;
};
const conTxt = (zona, nombre, valor) => ({
  txt: { ...zona.txt, [nombre]: [[valor]] }, mx: { ...zona.mx },
});

const FROM = 'cotea <no-reply@cotea.com.mx>';

// Medir SIN que una excepción se lleve el resto del banco.
//
// Hacía falta: con la medición reventando —que es una de las averías que este
// banco persigue— el proceso salía con 2 y las otras treinta aserciones se
// quedaban sin correr. Un banco que no puede llegar a su propia aserción no la
// mide. Ahora un reventón es un RESULTADO del que se afirma (§8), y rojo.
const medir = async (dns, from) => {
  try { return await medirLaEntregaDelCorreo(dns, from); }
  catch (e) {
    return { reventó: e, ok: null, patas: null, firma: null, rutaEntera: null,
      mxRetorno: null, dominio: null, dmarc: null, mensaje: `REVENTÓ: ${e.message}` };
  }
};

(async () => {
  console.log('\n── LAS DOS PATAS DE LA ENTREGA ──\n');

  // ═══ §1 · EL DNS DE PRODUCCIÓN, TAL COMO SE MIDIÓ HOY ═════════════════════
  console.log('§1 · el DNS de producción del 2026-11-23');
  const hoy = await medir(dnsArmado(PRODUCCION), FROM);

  check(hoy.patas === 2 && hoy.ok === true,
    'las dos patas están puestas: firma DKIM y ruta de retorno con SPF y MX',
    `patas=${hoy.patas} · ok=${hoy.ok}`);
  check(hoy.firma === true && hoy.rutaEntera === true && hoy.mxRetorno === 1,
    'y las tres piezas se midieron por separado, no se dedujeron una de otra',
    `firma=${hoy.firma} · ruta=${hoy.rutaEntera} · mx=${hoy.mxRetorno}`);
  check(hoy.dominio === 'cotea.com.mx',
    'el dominio medido es el del remitente de verdad',
    hoy.dominio);
  check(hoy.dmarc === 'quarantine',
    'y la política de DMARC queda registrada: es la que decide qué pasa si falla',
    `p=${hoy.dmarc}`);
  check(/dos patas/.test(hoy.mensaje) && /send\.cotea\.com\.mx/.test(hoy.mensaje),
    'el mensaje nombra la ruta de retorno, que es el registro que hay que ir a ver',
    hoy.mensaje);

  // ═══ §2 · SE CAE LA FIRMA ═════════════════════════════════════════════════
  console.log('\n§2 · alguien borra el DKIM');
  const sinFirma = await medir(
    dnsArmado(sin(PRODUCCION, 'resend._domainkey.cotea.com.mx')), FROM);

  check(sinFirma.ok === false && sinFirma.patas === 1,
    'ROJO con una sola pata: la entrega queda colgando del SPF de la ruta de retorno',
    `patas=${sinFirma.patas} · ok=${sinFirma.ok}`);
  check(/UNA SOLA PATA/.test(sinFirma.mensaje) && /la firma/.test(sinFirma.mensaje)
    && /resend\._domainkey/.test(sinFirma.mensaje),
    'y el mensaje dice QUÉ registro falta, con su nombre completo',
    sinFirma.mensaje);
  check(/sin error/.test(sinFirma.mensaje),
    'y por qué importa: lo que sigue a la segunda caída es spam SIN error',
    /sin error/.test(sinFirma.mensaje) ? 'lo dice' : 'NO LO DICE');

  // ═══ §3 · SE CAE LA RUTA DE RETORNO ═══════════════════════════════════════
  console.log('\n§3 · alguien borra los registros de `send.`');
  const sinRuta = await medir(
    dnsArmado(sin(PRODUCCION, 'send.cotea.com.mx')), FROM);

  check(sinRuta.ok === false && sinRuta.patas === 1 && sinRuta.firma === true,
    'ROJO con una sola pata: queda la firma, y sólo la firma',
    `patas=${sinRuta.patas} · firma=${sinRuta.firma}`);
  check(/SPF de la ruta de retorno/.test(sinRuta.mensaje),
    'y nombra la ruta de retorno como lo que falta',
    sinRuta.mensaje);

  // El MX solo: el SPF sigue ahí, así que SPF pasaría, pero los rebotes no
  // vuelven y Resend acaba desverificando el dominio. Media pata no es pata.
  console.log('\n§4 · queda el SPF de `send.` pero se borra su MX');
  const sinMx = await medir(
    dnsArmado({ txt: PRODUCCION.txt, mx: { ...sin(PRODUCCION, 'send.cotea.com.mx').mx } }), FROM);
  check(sinMx.ok === false && sinMx.rutaEntera === false,
    'ROJO: sin MX los rebotes no vuelven y la ruta de retorno no está entera',
    `ruta=${sinMx.rutaEntera} · ok=${sinMx.ok}`);
  check(/MX de la ruta de retorno/.test(sinMx.mensaje),
    'y el mensaje distingue «falta el SPF» de «falta el MX»: son dos registros distintos',
    sinMx.mensaje);

  // Un SPF que está pero no autoriza a nadie —`v=spf1 -all`, que es lo que
  // queda si alguien «limpia» el registro sin borrarlo— no es una pata. Que el
  // registro exista no es lo que se mide.
  const spfVacio = await medir(
    dnsArmado(conTxt(PRODUCCION, 'send.cotea.com.mx', 'v=spf1 -all')), FROM);
  check(spfVacio.ok === false && spfVacio.rutaEntera === false,
    'un SPF sin un solo mecanismo no autoriza a Resend: no es pata aunque el registro esté',
    `ruta=${spfVacio.rutaEntera} · ok=${spfVacio.ok}`);

  // ═══ §5 · LA CORRECCIÓN AL #150 ═══════════════════════════════════════════
  //
  // Esto es lo que el renglón tenía al revés, y la razón por la que casi se
  // escribió al DNS de producción sin necesidad. El sobre no sale de la raíz:
  // sale de `send.`. Editar el SPF de la raíz —que es lo que un dedo ajeno
  // toca al cambiar cualquier otra cosa del dominio— no tumba el correo del
  // producto.
  console.log('\n§5 · se edita el SPF de la RAÍZ (lo que el #150 temía)');
  const raizEditada = await medir(
    dnsArmado(conTxt(PRODUCCION, 'cotea.com.mx', 'v=spf1 include:otracosa.net -all')), FROM);
  check(raizEditada.ok === true && raizEditada.patas === 2,
    'sigue VERDE: el sobre sale de `send.`, así que el SPF de la raíz no lo decide',
    `patas=${raizEditada.patas} · ok=${raizEditada.ok}`);
  check(/no hace falta/.test(raizEditada.mensaje),
    'y el mensaje lo dice, para que nadie vuelva a escribir al DNS por esta razón',
    raizEditada.mensaje);

  // Y sin SPF en la raíz tampoco cambia el veredicto, pero se declara.
  const raizSinSpf = await medir(
    dnsArmado(sin(PRODUCCION, 'cotea.com.mx')), FROM);
  check(raizSinSpf.ok === true && /la raíz no publica SPF/.test(raizSinSpf.mensaje),
    'la raíz sin SPF tampoco tumba la entrega, y queda declarado en el mensaje',
    raizSinSpf.mensaje);

  // ═══ §6 · LAS DOS CAÍDAS ══════════════════════════════════════════════════
  console.log('\n§6 · se caen las dos');
  const ninguna = await medir(
    dnsArmado(sin(PRODUCCION, 'resend._domainkey.cotea.com.mx', 'send.cotea.com.mx')), FROM);
  check(ninguna.ok === false && ninguna.patas === 0 && /SIN PATAS/.test(ninguna.mensaje),
    'SIN PATAS, y se distingue de «una sola»: son dos averías con dos urgencias',
    `patas=${ninguna.patas} · ${ninguna.mensaje.slice(0, 60)}…`);
  check(/DMARC dice quarantine/.test(ninguna.mensaje),
    'y nombra la política que va a decidir el destino de cada mensaje',
    /DMARC dice quarantine/.test(ninguna.mensaje) ? 'la nombra' : 'NO LA NOMBRA');

  // ═══ §7 · EL TXT PARTIDO ══════════════════════════════════════════════════
  //
  // Un TXT no puede llevar más de 255 caracteres por trozo, así que uno largo
  // viaja partido y `resolveTxt` lo devuelve como LISTA de trozos. Sin
  // unirlos, el `p=` de la llave se corta y la firma se leería como AUSENTE:
  // un rojo falso en el único vigilante del correo, que es peor que no tener
  // vigilante porque enseña a no creerle.
  //
  // La llave de HOY no es el caso: medida el 2026-11-23, son 216 caracteres
  // —una llave de 1024 bits— y caben en un trozo. El caso es la llave de 2048
  // bits, que es la que Resend emite ahora y la que llegaría si el dominio se
  // volviera a verificar. Así que se mide con las DOS, y por eso §1 no sirve
  // para esto.
  console.log('\n§7 · un TXT largo viaja partido en trozos de 255');
  const trozosHoy = PRODUCCION.txt['resend._domainkey.cotea.com.mx'][0];
  check(trozosHoy.length === 1 && trozosHoy[0].length < 255,
    'la llave de producción de hoy cabe en un trozo: 1024 bits, 216 caracteres',
    `${trozosHoy.length} trozo de ${trozosHoy[0].length}`);

  // El registro que de verdad obliga a unir: uno donde el `p=` empieza CERCA
  // DEL FINAL del primer trozo, de modo que la llave queda cortada a los
  // pocos caracteres. Pasa con los registros que llevan etiquetas antes de la
  // llave —`t=`, `s=`, una nota en `n=`— y es la forma en que un corte deja
  // la firma ilegible sin que el registro parezca roto. Quedarse con el
  // primer trozo aquí diría «no hay llave» teniendo la llave puesta.
  const RELLENO = ('n=' + 'rotada-el-2026-11-contacto-soporte-'.repeat(7)).slice(0, 225) + '; ';
  const LLAVE_2048 = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A' + 'Kq7Zx9WvL3nT'.repeat(26) + 'IDAQAB';
  const REG_DKIM = `v=DKIM1; k=rsa; ${RELLENO}p=${LLAVE_2048}`;
  const trozosLargos = enTrozos(REG_DKIM);
  const llaveEnElPrimero = trozosLargos[0].length - trozosLargos[0].indexOf('p=') - 2;
  check(trozosLargos.length > 1 && llaveEnElPrimero < 40,
    'el caso que se mide: el `p=` arranca al final del primer trozo y la llave queda cortada',
    `${trozosLargos.length} trozos · sólo ${llaveEnElPrimero} caracteres de llave en el primero`);
  const partida = await medir(dnsArmado({
    txt: { ...PRODUCCION.txt, 'resend._domainkey.cotea.com.mx': [trozosLargos] },
    mx: PRODUCCION.mx,
  }), FROM);
  check(partida.firma === true && partida.ok === true,
    'y la firma se lee como PRESENTE: los trozos se unen antes de buscar el `p=`',
    `firma=${partida.firma}`);

  // ═══ §8 · UN NOMBRE QUE NO RESUELVE ES UN DATO ════════════════════════════
  console.log('\n§8 · el DNS no contesta por un nombre');
  const zonaVacia = await medir(dnsArmado({ txt: {}, mx: {} }), FROM);
  check(!zonaVacia.reventó,
    'la medición NO lanza: un registro ausente es un resultado, no una avería del vigilante',
    zonaVacia.reventó ? `lanzó: ${zonaVacia.reventó.message}` : 'no lanzó');
  check(zonaVacia.patas === 0 && zonaVacia.ok === false,
    'y con la zona entera ausente sale SIN PATAS, no un reventón',
    `patas=${zonaVacia.patas} · ok=${zonaVacia.ok}`);
  // Las de §2–§7 también tienen que haber llegado sin reventar: si un ENOTFOUND
  // reventara, los casos de «borraron el registro» no se habrían medido.
  check(![sinFirma, sinRuta, sinMx, ninguna, spfVacio].some(r => r.reventó),
    'ninguno de los casos de registro borrado reventó: todos se MIDIERON',
    [sinFirma, sinRuta, sinMx, ninguna, spfVacio].filter(r => r.reventó).length + ' reventaron');

  // ═══ §9 · EL DOMINIO SALE DEL REMITENTE ═══════════════════════════════════
  console.log('\n§9 · el dominio se lee del remitente, no se teclea');
  check(dominioDelRemitente('cotea <no-reply@cotea.com.mx>') === 'cotea.com.mx'
    && dominioDelRemitente('no-reply@cotea.com.mx') === 'cotea.com.mx'
    && dominioDelRemitente('cotea <AVISOS@Cotea.COM.MX>') === 'cotea.com.mx',
    'con nombre, sin nombre y en mayúsculas sale el mismo dominio',
    dominioDelRemitente('cotea <AVISOS@Cotea.COM.MX>'));
  check(dominioDelRemitente('') === '' && dominioDelRemitente('sin arroba') === '',
    'y un remitente ilegible da vacío, no un dominio inventado',
    `"${dominioDelRemitente('sin arroba')}"`);

  // Si el remitente cambiara de dominio, se mide el NUEVO — y con el DNS de
  // hoy saldría en rojo, que es lo correcto: nadie puso las patas allá.
  const otroDominio = await medir(
    dnsArmado(PRODUCCION), 'cotea <no-reply@otrodominio.mx>');
  check(otroDominio.dominio === 'otrodominio.mx' && otroDominio.ok === false,
    'un remitente en otro dominio mide ESE dominio, y sale en rojo porque no tiene patas',
    `dominio=${otroDominio.dominio} · ok=${otroDominio.ok}`);
  check(otroDominio.patas === 0,
    'no se cuela ni una pata del dominio viejo',
    `patas=${otroDominio.patas}`);

  // ═══ §10 · EL CRON LO ESCRIBE, Y NO ENSUCIA AL VECINO ═════════════════════
  console.log('\n§10 · el cron diario escribe el renglón `entrega_correo`');
  const salud = (base, tipo) => (base.docs.get('global/health') || {})[tipo] || null;
  const correrCron = async (zona, opciones = {}) => {
    const base = baseFalsa({ 'global/health': {} }, opciones.base || {});
    // El doble entra SUSTITUYENDO el módulo `dns`, no inyectando el nombre:
    // la pieza real guarda `dnsDelSistema` en una constante de módulo, y un
    // parámetro con ese nombre choca con su declaración.
    const fn = andamios.montar(ARCH_FUNCS, 'vigilarDenegaciones', base, {
      modulos: { dns: { promises: zona ? dnsArmado(zona) : {
        resolveTxt: async () => { throw new Error('el resolvedor se cayó'); },
        resolveMx: async () => { throw new Error('el resolvedor se cayó'); },
      } } },
    });
    let lanzo = null;
    try { await fn({}); } catch (e) { lanzo = e; }
    return { base, lanzo };
  };

  {
    const { base } = await correrCron(PRODUCCION);
    const r = salud(base, 'entrega_correo');
    check(!!r && r.ok === true && r.patas === 2,
      'con el DNS de hoy queda en VERDE con las dos patas contadas',
      r ? `ok=${r.ok} · patas=${r.patas}` : 'NO SE ESCRIBIÓ EL RENGLÓN');
    check(!!r && r.dominio === 'cotea.com.mx' && r.dmarc === 'quarantine'
      && r.firma === true && r.rutaDeRetorno === true,
      'y el registro guarda las piezas medidas, no sólo el veredicto',
      r ? JSON.stringify({ dominio: r.dominio, firma: r.firma, ruta: r.rutaDeRetorno, dmarc: r.dmarc }) : 'sin renglón');
    check(!!salud(base, 'permisos_denegados'),
      'el renglón de las denegaciones se sigue escribiendo: dos vigilancias, dos registros',
      salud(base, 'permisos_denegados') ? 'escrito' : 'NO SE ESCRIBIÓ');
  }

  {
    const { base } = await correrCron(sin(PRODUCCION, 'send.cotea.com.mx'));
    const r = salud(base, 'entrega_correo');
    const d = salud(base, 'permisos_denegados');
    check(!!r && r.ok === false && r.patas === 1,
      'con la ruta de retorno borrada queda en ROJO',
      r ? `ok=${r.ok} · patas=${r.patas}` : 'sin renglón');
    check(!!d && d.ok === true,
      'y las denegaciones siguen en VERDE: un DNS roto no es un permiso denegado',
      d ? `ok=${d.ok}` : 'sin renglón');
  }

  // ═══ §11 · SI LA MEDICIÓN REVIENTA, SE ANOTA EN ROJO Y EL VECINO SIGUE ════
  console.log('\n§11 · el resolvedor de DNS revienta');
  {
    const { base, lanzo } = await correrCron(null);
    const r = salud(base, 'entrega_correo');
    const d = salud(base, 'permisos_denegados');
    check(!!r && r.ok === false && /se cayó/.test(r.mensaje || ''),
      'el fallo queda en ROJO con su motivo, no se lo traga el cron',
      r ? `ok=${r.ok} · ${r.mensaje}` : 'NO SE ESCRIBIÓ EL RENGLÓN');
    // La distinción que esto afirma: «no pude preguntar» NO se presenta como
    // «los registros no están». Las dos van en rojo, pero mandan a sitios
    // distintos — una al resolvedor, la otra a GoDaddy a buscar unos
    // registros que están puestos.
    check(!!r && !/SIN PATAS/.test(r.mensaje || '') && !/falta la firma/.test(r.mensaje || ''),
      'y NO dice que falten los registros: un resolvedor caído no es un DNS vacío',
      r ? r.mensaje : 'sin renglón');
    check(!!r && r.patas === undefined,
      'tampoco publica un conteo de patas: no se cuenta lo que no se pudo mirar',
      r ? `patas=${r.patas}` : 'sin renglón');
    check(!!d && d.ok === true,
      'y las denegaciones se midieron igual: el vigilante caído no se lleva al otro',
      d ? `ok=${d.ok}` : 'NO SE MIDIERON');
    check(lanzo === null,
      'el cron no relanza: un DNS en mal estado es un resultado, y relanzarlo haría que Scheduler reescribiera el mismo rojo',
      lanzo ? `lanzó ${lanzo.message}` : 'no relanzó');
  }

  // ═══ §12 · Y LA PANTALLA LO ENSEÑA ════════════════════════════════════════
  //
  // Un vigilante que nadie ve no vigila: es el #26 completo. La tabla sale de
  // `src/App.jsx` y se ejecuta `estadoDeJob`, que es la que pinta el color.
  console.log('\n§12 · la pantalla de salud enseña el renglón');
  const job = JOBS_PROGRAMADOS.find(j => j.id === 'entrega_correo');
  check(!!job,
    'el renglón está en la tabla de la pantalla, con el mismo id que escribe el cron',
    job ? job.nombre : 'NO ESTÁ EN LA TABLA');
  check(!!job && job.limiteHoras === 36,
    'y aguanta 36 h de silencio, como las diarias: no nueve días, que es lo de las semanales',
    job ? `${job.limiteHoras} h` : 'sin renglón');

  // Sin el renglón, `estadoDeJob` no tiene a quién clasificar. Un banco que
  // revienta ahí sale con 2 y se lleva las aserciones que sí podían medirse:
  // el renglón ausente se mide con un sustituto que las deja correr y falla
  // donde tiene que fallar.
  const AUSENTE = { id: '(ausente)', limiteHoras: -1 };
  const ahora = Date.parse('2026-11-23T20:00:00Z');
  const recienRojo = estadoDeJob(job || AUSENTE, { ok: false, mensaje: 'UNA SOLA PATA',
    ultimaEjecucion: new Date(ahora - 3600000).toISOString() }, ahora);
  check(recienRojo.estado === 'falló',
    'una pata caída pinta el renglón en ROJO aunque la corrida sea de hace una hora',
    recienRojo.estado);

  const calladoDiaYMedio = estadoDeJob(job || AUSENTE, { ok: true, mensaje: 'dos patas',
    ultimaEjecucion: new Date(ahora - 40 * 3600000).toISOString() }, ahora);
  check(calladoDiaYMedio.estado === 'sin correr',
    'y si el vigilante se calla día y medio, el ROJO es del vigilante',
    calladoDiaYMedio.estado);

  const alDia = estadoDeJob(job || AUSENTE, { ok: true, mensaje: 'dos patas',
    ultimaEjecucion: new Date(ahora - 2 * 3600000).toISOString() }, ahora);
  check(alDia.estado === 'al día',
    'con las dos patas y corrida reciente, al día — el gemelo en verde',
    alDia.estado);

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'la entrega del correo se mide en el DNS, que es la causa, y no en el 200\n' +
      'de Resend, que es una acusación de recibo. Dos patas puestas: se cae una\n' +
      'y alguien se entera al día siguiente, con el registro nombrado.'
    : 'el canal por el que el producto avisa no puede ser el único que no se\n' +
      'vigila: cuando se cae, se cae callado.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
