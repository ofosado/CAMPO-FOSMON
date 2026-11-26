#!/usr/bin/env node
// LAS FOTOS Y LOS PDF NO SE BAJAN DE UNA DIRECCIÓN QUE DICE EL NOMBRE DE UN CLIENTE
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// La regla general del 2026-11-24: cotea es cotea y FOSMON es un CLIENTE. Al
// medir dónde se asomaba el nombre quedó esto último, y es lo que más cuesta
// ver porque no está en ningún texto de pantalla: la URL de descarga de
// Firebase lleva el bucket DENTRO de la ruta.
//
//   https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/<objeto>
//
// Se ve al compartir una foto por WhatsApp, al abrir un PDF de OT en otra
// pestaña —ahí queda en la barra de direcciones— y al copiar la dirección de
// una imagen.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `archivoEnCotea` se EXTRAE y SE EJECUTA
// contra URLs con la forma real que devuelve Storage, y el resultado se RUTEA
// con `public/_redirects` parseado como lo parsea Netlify, para comprobar que
// vuelve al MISMO objeto del MISMO bucket. Las dos piezas viven en archivos
// distintos y tienen que cuadrar: una reescritura que el `_redirects` no sabe
// deshacer es una foto que no se ve.
//
// Uso:
//   node scripts/prueba-los-archivos-se-bajan-por-cotea.cjs
//   node scripts/prueba-los-archivos-se-bajan-por-cotea.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const MODULO = process.env.ARCH_MODULO || path.join(raiz, 'src/archivo-en-cotea.js');
const REGLAS = process.env.ARCH_REDIRECTS || path.join(raiz, 'public/_redirects');
noArranco.vigilarExcepciones(path.relative(raiz, MODULO));

const CP = require('./contraprueba.cjs');
const { reglasDe, rutear, hostDe } = require('./ruteo-de-netlify.cjs');

const MUTANTES_MODULO = [
  { nombre: 'deja de reescribir: la foto se vuelve a bajar del bucket que delata',
    de: `  if (u.host !== HOST_DE_STORAGE) return url;`,
    a:  `  return url;` },
  { nombre: 'se pierde la query y con ella el `alt=media` que hace que sea el archivo',
    de: `  return \`\${RUTA_DE_ARCHIVOS}\${m[1]}\${u.search}\`;`,
    a:  `  return \`\${RUTA_DE_ARCHIVOS}\${m[1]}\`;` },
  { nombre: 'se decodifica la ruta del objeto y Storage la rechaza con 400',
    de: `  const m = /^\\/v0\\/b\\/[^/]+\\/o\\/(.+)$/.exec(u.pathname);`,
    a:  `  const m = /^\\/v0\\/b\\/[^/]+\\/o\\/(.+)$/.exec(decodeURIComponent(u.pathname));` },
  { nombre: 'una URL que no es de Storage también se reescribe, y se rompe',
    de: `  if (u.host !== HOST_DE_STORAGE) return url;`,
    a:  `  if (false) return url;` },
  { nombre: 'la ruta se vuelve absoluta y ata las fotos a un host escrito a mano',
    de: `  return \`\${RUTA_DE_ARCHIVOS}\${m[1]}\${u.search}\`;`,
    a:  `  return \`https://app.cotea.com.mx\${RUTA_DE_ARCHIVOS}\${m[1]}\${u.search}\`;` },
];

const MUTANTES_REGLAS = [
  { nombre: 'la regla apunta a otro bucket: la foto existe y no se encuentra',
    de: `/archivo/*  https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/:splat  200`,
    a:  `/archivo/*  https://firebasestorage.googleapis.com/v0/b/otro-bucket.appspot.com/o/:splat  200` },
  { nombre: 'la regla rebota con 301 y la barra de direcciones vuelve a delatar',
    de: `/archivo/*  https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/:splat  200`,
    a:  `/archivo/*  https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/:splat  301` },
  { nombre: 'se va `:splat` y todas las fotos piden el mismo objeto vacío',
    de: `/archivo/*  https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/:splat  200`,
    a:  `/archivo/*  https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/  200` },
];

const LOTES = [
  { arch: MODULO, mutaciones: MUTANTES_MODULO, extension: '.js', env: 'ARCH_MODULO' },
  { arch: REGLAS, mutaciones: MUTANTES_REGLAS, extension: '',    env: 'ARCH_REDIRECTS' },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  for (const l of LOTES)
    CP.exigirAnclajes(l.mutaciones, fs.readFileSync(l.arch, 'utf8'),
      { archivo: l.arch, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  let sobrevivieron = 0, total = 0;
  for (const l of LOTES) {
    console.log(`\n── mutando ${path.relative(raiz, l.arch)} ──`);
    sobrevivieron += CP.correr({ mutaciones: l.mutaciones, src: fs.readFileSync(l.arch, 'utf8'),
      archivo: l.arch, extension: l.extension,
      comoCorrer: (ruta) => ({ args: [], env: { [l.env]: ruta, CALLADO: '1' } }) });
    total += l.mutaciones.length;
  }
  process.exit(CP.veredicto(sobrevivieron, total));
}

// ── LA PIEZA REAL ───────────────────────────────────────────────────────────
// Es un módulo ESM y este banco es CJS: se lee el fuente y se evalúa quitando
// los `export`, que es lo único que estorba. Copiar la función aquí sería
// comprobarla contra sí misma.
const fuente = fs.readFileSync(MODULO, 'utf8').replace(/^export\s+/gm, '');
let archivoEnCotea, RUTA_DE_ARCHIVOS, HOST_DE_STORAGE;
try {
  ({ archivoEnCotea, RUTA_DE_ARCHIVOS, HOST_DE_STORAGE } = new Function(
    `"use strict";\n${fuente}\nreturn { archivoEnCotea, RUTA_DE_ARCHIVOS, HOST_DE_STORAGE };`)());
} catch (e) {
  noArranco([`el módulo no se pudo montar: ${e.message}`], path.relative(raiz, MODULO));
}
if (typeof archivoEnCotea !== 'function')
  noArranco(['`archivoEnCotea` no quedó montada'], path.relative(raiz, MODULO));

const reglas = reglasDe(fs.readFileSync(REGLAS, 'utf8'));

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Las dos formas que de verdad existen en producción, leídas de un documento
// de evidencia de la obra 0112 el 2026-11-25.
const BUCKET = 'campo-fosmon.firebasestorage.app';
const OBJETO = 'obras%2F0112%2Ffotos%2Favance_SIOP-JS-MRN-002__9%2Feftobrv6lq';
const REALES = [
  [`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${OBJETO}?alt=media`,
    'una foto de evidencia, sin token'],
  [`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${OBJETO}?alt=media&token=abc-123`,
    'la misma con token de descarga'],
  [`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/obras%2F0112%2Fot%2Fot-7.pdf?alt=media`,
    'el PDF de una orden de trabajo'],
];

console.log('\n── LOS ARCHIVOS SE BAJAN POR UNA RUTA DE COTEA ──\n');

console.log('§1 · la dirección que ve el usuario ya no nombra al cliente');
for (const [url, porque] of REALES) {
  const r = archivoEnCotea(url);
  check(!/campo-fosmon|fosmon/i.test(String(r)),
    `${porque}: la dirección no dice el nombre`, /fosmon/i.test(String(r)) ? String(r) : String(r).slice(0, 56) + '…');
}
check(REALES.every(([u]) => String(archivoEnCotea(u)).startsWith(RUTA_DE_ARCHIVOS)),
  `y es RELATIVA (${RUTA_DE_ARCHIVOS}…), así que sirve en cualquier host de cotea`,
  String(archivoEnCotea(REALES[0][0])).slice(0, 40) + '…');

console.log('\n§2 · y la regla la devuelve al MISMO objeto del MISMO bucket');
for (const [url, porque] of REALES) {
  const reescrita = String(archivoEnCotea(url));
  const [ruta, query = ''] = reescrita.split('?');
  const r = rutear(reglas, ruta);
  const vuelta = r ? r.destinoFinal + (query ? `?${query}` : '') : null;
  check(vuelta === url, `${porque}: ida y vuelta da la URL original`,
    vuelta === url ? '' : `VOLVIÓ A «${String(vuelta).slice(0, 70)}…»`);
  check(!!r && r.estado === 200,
    '  y se sirve con 200, no con un rebote que enseñaría el bucket',
    r ? `estado ${r.estado}` : 'sin regla');
}

console.log('\n§3 · el `%2F` del nombre del objeto llega entero');
// Medido contra el bucket real: la forma codificada da 403 —el objeto existe y
// pide permiso— y la forma con barras de verdad da 400. O sea que decodificar
// no es un detalle de estilo: rompe la descarga.
const conBarras = archivoEnCotea(REALES[0][0]);
check(String(conBarras).includes('%2F'),
  'la ruta reescrita conserva los `%2F`, que es lo que Storage exige',
  String(conBarras).includes('%2F') ? '' : 'LOS PERDIÓ: Storage contestaría 400');
check(!/\/archivo\/obras\//.test(String(conBarras)),
  'y no quedó partida en segmentos, que es lo que pasa al decodificar');

console.log('\n§4 · lo que NO se toca, porque romperlo es peor que delatar');
const INTACTAS = [
  ['data:image/png;base64,iVBORw0KGgo=', 'un data URI, que es como entra el logo del cliente'],
  ['http://127.0.0.1:9199/v0/b/demo/o/x?alt=media', 'el emulador de Storage, otro host'],
  ['https://cdn.jsdelivr.net/npm/x.js', 'un CDN'],
  ['/archivo/ya-reescrita?alt=media', 'una ruta ya relativa: no se reescribe dos veces'],
  ['', 'vacío'],
  [null, 'null'],
  [undefined, 'undefined'],
];
for (const [url, porque] of INTACTAS) {
  const r = archivoEnCotea(url);
  check(r === url, `devuelve tal cual ${porque}`,
    r === url ? '' : `LA CAMBIÓ a «${String(r).slice(0, 50)}»`);
}

console.log('\n§5 · y la app pide los archivos por ahí, no por su cuenta');
// Que la función exista y sea correcta no sirve si la pantalla no la usa. Se
// mide sobre el fuente de verdad: los sitios que pintan una URL de archivo.
const app = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const ot  = fs.readFileSync(path.join(raiz, 'src/ot.jsx'), 'utf8');
check(/url: archivoEnCotea\(e\.urlOriginal/.test(app),
  'la foto normalizada —por donde pasa TODA la evidencia— sale reescrita');
check(/href=\{archivoEnCotea\(a\.url\)\}/.test(app),
  'el adjunto de una estimación también');
check(/href=\{archivoEnCotea\(ot\.pdfUrl\)\}/.test(ot),
  'y el PDF de la orden de trabajo');
check(/from ["']\.\/archivo-en-cotea["']/.test(app) && /from ["']\.\/archivo-en-cotea["']/.test(ot),
  'las dos pantallas importan la MISMA función, no una copia cada una');

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'ninguna dirección de archivo que vea un usuario dice el nombre del proyecto,\n' +
    'y todas vuelven al objeto correcto.'
  : 'o la dirección delata al cliente, o la foto no se ve.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
