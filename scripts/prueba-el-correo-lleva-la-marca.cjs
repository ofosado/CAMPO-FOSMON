#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL CORREO LLEVA LA MARCA, Y LA LLEVA DE FORMA QUE UN BUZÓN LA PINTE
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ HABÍA. Medido el 2026-11-17 sobre el HTML que salió de verdad,
// interceptado antes de Resend: el encabezado y el botón iban en `#0D1619`
// —la paleta VIEJA de la interfaz, la que `src/styles/tokens.css` dice que
// todavía no cruzó el puente—, los dos colores de cotea aparecían CERO veces,
// y no había ni un `<img>` en todo el documento. La marca era la palabra
// «cotea» en texto plano. Es el #152.
//
// ── LAS TRES COSAS QUE ESTE BANCO AFIRMA, Y POR QUÉ CADA UNA ───────────────
//
// 1. EL LOGO VIAJA POR URL ABSOLUTA. Un `<img>` de correo lo pide el cliente
//    de correo SIN SESIÓN. Eso descarta Storage —todas sus rutas exigen
//    `request.auth`— y descarta el data URI con que el cliente guarda su marca
//    en `orgs/{oid}/config/branding`, porque Gmail y Outlook no pintan data
//    URIs. Una ruta relativa tampoco: en un buzón no hay página desde la cual
//    resolverla. Así que el banco no afirma «hay un logo»: afirma que es
//    `http(s)://…`, que es lo único que un buzón sabe pedir.
//
// 2. EL CORREO SE LEE CON LAS IMÁGENES APAGADAS. Es como llega la primera vez
//    a un buzón que no conoce al remitente, y con el #150 abierto —la entrega
//    cuelga de una sola pata DKIM— es el caso probable, no el raro. Por eso el
//    `<img>` lleva `alt`, y por eso se exige que el título del aviso esté en
//    TEXTO: un correo cuyo mensaje vive dentro de una imagen llega mudo.
//
// 3. LA MARCA DEL CLIENTE NO ENTRA AL ENCABEZADO. No es sólo que falte la ruta
//    pública: el correo sale de `no-reply@cotea.com.mx`, y un logo ajeno en la
//    cabecera dice que escribió el ayuntamiento cuando escribió el sistema.
//    El cliente SÍ va nombrado —`marcaDeOrg` lo resuelve y el nombre va bajo
//    el logo—, que es lo que contesta «¿de cuál de mis clientes es este
//    aviso?» sin fingir remitente. Donde el logo del cliente sí va es en la
//    portada del PDF, que es un documento suyo.
//
// ── Y QUE LOS SOBRES SIGAN SIENDO DOS ─────────────────────────────────────
//
// `PENDIENTES` decía que los cuatro correos compartían molde. Medido el
// 2026-11-20: son DOS. El resumen del lunes lleva una tabla de obras a 640 px
// que no cabe en el sobre de 560 de los avisos, así que tiene el suyo. Eso
// está bien; lo que no puede pasar es que aparezca un TERCERO sin marca. El
// banco cuenta los `<body` del archivo: si alguien escribe otro correo, esto
// sale en rojo y tiene que decidir —meterlo en un sobre o marcar el nuevo—.
//
// CONTRAPRUEBAS — corridas el 2026-11-21, las siete en ROJO (1), ninguna en
// NO ARRANCÓ (2). Entre paréntesis, cuántas aserciones mordió cada una:
//   · el logo desaparece de los avisos                      → rojo (≥1)
//   · el logo del lunes desaparece                          → rojo  (1)
//   · el logo se sirve por ruta relativa                    → rojo  (1)
//   · el encabezado vuelve a la paleta vieja                → rojo  (2)
//   · el botón vuelve a la paleta vieja                     → rojo  (3)
//   · el logo pierde su `alt`                               → rojo  (1)
//   · el logo del cliente se cuela en el encabezado         → rojo  (3)
//
// Las tres primeras se anclaron DOS veces: el `<img>` con su firma aparece
// igual en los dos sobres —que es justo lo que el banco quiere— y el portón
// AMBIGUA lo dijo en el primer intento. Cada anclaje lleva ahora la cola que
// distingue a su sobre.
//
// Uso:  node scripts/prueba-el-correo-lleva-la-marca.cjs
//       node scripts/prueba-el-correo-lleva-la-marca.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const CP = require('./contraprueba.cjs');
const { deArchivo, SimboloPerdido } = require('./extraer-de-app.cjs');

const ARCHIVO = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');
const src = fs.readFileSync(ARCHIVO, 'utf8');
const callado = !!process.env.CALLADO;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Mutaciones ──────────────────────────────────────────────────────────────
const MUTANTES = [
  // Los dos anclajes de abajo llevan la COLA que distingue a cada sobre: el
  // `<img>` con su firma, él solo, aparece dos veces —los dos sobres lo
  // pintan igual, que es el punto— y el portón AMBIGUA lo dijo en el primer
  // intento. El de los avisos cierra la celda; el del lunes sigue al título.
  { titulo: 'el logo desaparece de los avisos',
    cambios: [['          <img src="${LOGO_URL}" width="160" height="46" alt="cotea" style="display:block;border:0;">\n          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n        </td></tr>',
               '          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n        </td></tr>']] },
  { titulo: 'el logo del lunes desaparece',
    cambios: [['          <img src="${LOGO_URL}" width="160" height="46" alt="cotea" style="display:block;border:0;">\n          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n          <div style="font-size:23px;',
               '          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n          <div style="font-size:23px;']] },
  { titulo: 'el logo se sirve por ruta relativa, que un buzón no sabe resolver',
    cambios: [['const LOGO_URL = `${APP_URL}/cotea-horizontal.png`;',
               'const LOGO_URL = "/cotea-horizontal.png";']] },
  { titulo: 'el encabezado vuelve a la paleta vieja de la interfaz',
    cambios: [['const MARCA_NARANJA = "#FF6B35";', 'const MARCA_NARANJA = "#0D1619";']] },
  { titulo: 'el botón vuelve a la paleta vieja de la interfaz',
    cambios: [['const MARCA_PIZARRA = "#4A5560";', 'const MARCA_PIZARRA = "#0D1619";']] },
  { titulo: 'el logo pierde su `alt` y el correo llega mudo con las imágenes apagadas',
    cambios: [['alt="cotea" style="display:block;border:0;">', 'style="display:block;border:0;">', 2]] },
  { titulo: 'el logo del cliente se cuela en el encabezado del aviso',
    cambios: [['          <img src="${LOGO_URL}" width="160" height="46" alt="cotea" style="display:block;border:0;">\n          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n        </td></tr>',
               '          <img src="${marca?.logo || LOGO_URL}" width="160" height="46" alt="cotea" style="display:block;border:0;">\n          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n        </td></tr>']] },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, src, { archivo: ARCHIVO, callado });
}
if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src, archivo: ARCHIVO,
    prefijo: 'correo-marca-', extension: '.js',
    comoCorrer: (ruta) => ({ args: [], env: { ARCH_FUNCS: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── Extracción ──────────────────────────────────────────────────────────────
let api;
try {
  api = deArchivo(ARCHIVO, 'sobreCorreo', 'botonHTML', 'LOGO_URL',
    'MARCA_PIZARRA', 'MARCA_NARANJA', 'MARCA_GRIS', 'MARCA_TINTA');
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, path.basename(ARCHIVO));
  noArranco([String(e.message || e)], path.basename(ARCHIVO));
}
const { sobreCorreo, botonHTML, LOGO_URL, MARCA_PIZARRA, MARCA_NARANJA } = api;

// Los `<img>` de un HTML, con su `src` y su `alt`.
const imagenes = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => ({
  tag,
  src: (tag.match(/\bsrc="([^"]*)"/) || [])[1] || '',
  alt: (tag.match(/\balt="([^"]*)"/) || [])[1],
}));
// El texto que queda cuando el buzón NO pinta las imágenes.
const conImagenesApagadas = (html) =>
  html.replace(/<img\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const PALETA_VIEJA = ['#0D1619', '#4A5160', '#9AA0AC'];

// ══════════════════════════════════════════════════════════════════════════
console.log('1. El aviso lleva el logo, y por una URL que un buzón sabe pedir');

const aviso = sobreCorreo({
  marca: { empresa: 'H. AYUNTAMIENTO DE COATZACOALCOS', empresaCorta: 'Coatzacoalcos' },
  titulo: 'Obra nueva · Rehabilitación Av. Universidad',
  entradilla: 'Se dio de alta una obra en la que participas.',
  cuerpoHTML: `<p>cuerpo</p>${botonHTML('Abrir cotea', 'https://ejemplo/obra')}`,
  pie: 'Este aviso lo manda cotea automáticamente.',
});

const imgs = imagenes(aviso);
check(imgs.length === 1, 'el aviso trae exactamente una imagen', `${imgs.length}`);
check(imgs.length === 1 && /^https?:\/\//.test(imgs[0].src),
  'y su `src` es una URL absoluta — ni relativa ni data URI',
  imgs[0] ? imgs[0].src : '(ninguna)');
check(!/src="data:/.test(aviso),
  'en particular NO hay ningún data URI: Gmail y Outlook no los pintan');
check(imgs.length === 1 && imgs[0].alt === 'cotea',
  'y lleva `alt`, que es lo que se ve con las imágenes apagadas',
  imgs[0] ? String(imgs[0].alt) : '(ninguna)');

console.log('\n2. Y se lee con las imágenes apagadas');
const apagado = conImagenesApagadas(aviso);
check(apagado.includes('Obra nueva · Rehabilitación Av. Universidad'),
  'el título del aviso está en TEXTO, no dentro de la imagen');
check(apagado.includes('Se dio de alta una obra en la que participas.'),
  'y la entradilla también');
check(apagado.includes('Abrir cotea'),
  'y el botón sigue siendo un enlace con palabras, no una imagen');

console.log('\n3. Los colores son los de la marca, no los de la interfaz vieja');
for (const c of PALETA_VIEJA)
  check(!aviso.includes(c), `el aviso no usa ${c}, de la paleta vieja`);
check(aviso.includes(MARCA_NARANJA),
  'y sí usa el naranja de cotea', MARCA_NARANJA);
check(botonHTML('Abrir', 'https://x').includes(MARCA_PIZARRA),
  'el botón va en el pizarra de cotea', MARCA_PIZARRA);
check(!botonHTML('Abrir', 'https://x').includes('#0D1619'),
  'y ya no en el negro de la interfaz');

console.log('\n4. El cliente va NOMBRADO, pero el encabezado lo firma cotea');
check(aviso.includes('H. AYUNTAMIENTO DE COATZACOALCOS'),
  'el nombre de la organización sale en el correo');
check(imgs.length === 1 && imgs[0].src === LOGO_URL,
  'pero la única imagen es el logo de cotea, no uno del cliente',
  imgs[0] ? imgs[0].src : '(ninguna)');
// Un logo de cliente cargado NO debe poder entrar por la marca: `marcaDeOrg`
// devuelve sólo `empresa` y `empresaCorta`, y aunque alguien le colara el
// campo, el sobre no lo lee. Se le pasa para comprobar que lo ignora.
const conLogoAjeno = sobreCorreo({
  marca: { empresa: 'OTRA', empresaCorta: 'OTRA', logo: 'data:image/png;base64,AAAA' },
  titulo: 'T', entradilla: '', cuerpoHTML: '', pie: 'p',
});
check(!conLogoAjeno.includes('data:image/png;base64,AAAA'),
  'y un logo del cliente pasado en la marca NO se cuela al encabezado');
check(imagenes(conLogoAjeno).length === 1
   && imagenes(conLogoAjeno)[0].src === LOGO_URL,
  'la imagen sigue siendo la de cotea', imagenes(conLogoAjeno)[0].src);

console.log('\n5. Sin marca el sobre no inventa una firma');
const sinMarca = sobreCorreo({ marca: { empresa: '' }, titulo: 'T',
  entradilla: '', cuerpoHTML: '', pie: 'p' });
check(!/FOSMON|AYUNTAMIENTO/i.test(sinMarca),
  'un correo sin organización no se firma con ninguna');
check(imagenes(sinMarca).length === 1,
  'pero el logo de cotea sigue ahí: el remitente no depende del cliente');

console.log('\n6. Los sobres son dos, y los dos llevan marca');
// Si aparece un tercero, esto sale en rojo y hay que decidir: meterlo en un
// sobre existente, o marcarlo. Un correo nuevo sin marca es el defecto que
// este banco existe para que no vuelva.
const cuerpos = (src.match(/<body\b/g) || []).length;
check(cuerpos === 2, 'hay exactamente dos sobres en functions/index.js',
  `${cuerpos}`);
const logosEnFuente = (src.match(/<img src="\$\{LOGO_URL\}"/g) || []).length;
check(logosEnFuente === 2, 'y los dos pintan el logo de cotea',
  `${logosEnFuente} de ${cuerpos}`);
// La paleta vieja no vive ya en ningún sitio del archivo salvo el comentario
// que la nombra para explicar de dónde se salió.
const sinComentarios = src.replace(/^\s*\/\/.*$/gm, '');
for (const c of PALETA_VIEJA)
  check(!sinComentarios.includes(c),
    `${c} no queda en ningún correo del archivo`,
    sinComentarios.includes(c) ? 'sigue ahí' : 'ninguna');

if (fallas) { console.log(`\n${fallas} comprobación(es) en rojo.`); process.exit(1); }
console.log('\nTodas las comprobaciones en verde.');
