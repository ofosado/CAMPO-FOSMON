#!/usr/bin/env node
// EL ENLACE DE «ELEGIR CONTRASEÑA NUEVA» NO SACA AL USUARIO DE COTEA
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El correo de recuperación lo manda Firebase Auth y el enlace de adentro
// apunta al manejador de acciones de Google, que por omisión vive en
// `campo-fosmon.firebaseapp.com` —el id del proyecto de GCP, permanente—.
//
// FOSMON es un CLIENTE de cotea. Ese enlace es lo único que recibe alguien que
// está bloqueado fuera de la app, y mandarlo a una dirección con el nombre de
// un cliente lo dice en el peor momento: cuando el que mira ya desconfía.
//
// `public/_redirects` hace que `app.cotea.com.mx/__/auth/…` sirva el manejador
// sin que el navegador salga de cotea, y `callbackUri` de Auth apunta ahí.
//
// ── POR QUÉ ESTO ES UN BANCO Y NO UNA REVISIÓN A OJO ────────────────────────
// El archivo son tres campos y las tres maneras de romperlo son invisibles
// desde «¿sirve el enlace?»:
//
//   · sin `:splat` la página carga y se queda muerta —el manejador pide
//     `action.js` por ruta relativa— sin un error en pantalla;
//   · con `301` en vez de `200` el enlace FUNCIONA y la barra de direcciones
//     vuelve a decir `campo-fosmon`, que es justo lo que se vino a evitar;
//   · con el comodín abierto (`/*`) la app entera se va al otro host.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un archivo contenga una cadena. Se PARSEA `_redirects` como lo
// parsea Netlify y se EJECUTA la decisión de ruteo para direcciones de verdad:
// el enlace del correo, los dos guiones que el manejador pide, y las rutas de
// la app que no se deben tocar. El host de destino no se teclea aquí: se
// compara contra el `authDomain` que declara `src/App.jsx`, porque si los dos
// pueden discrepar es un defecto esperando.
//
// Uso:
//   node scripts/prueba-el-enlace-de-recuperar-no-sale-de-cotea.cjs
//   node scripts/prueba-el-enlace-de-recuperar-no-sale-de-cotea.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const REGLAS = process.env.ARCH_REDIRECTS || path.join(raiz, 'public/_redirects');
const VITE   = process.env.ARCH_VITE      || path.join(raiz, 'vite.config.js');
noArranco.vigilarExcepciones(path.relative(raiz, REGLAS));

const CP = require('./contraprueba.cjs');

const MUTANTES_REGLAS = [
  { nombre: 'se va `:splat`: el manejador carga y se queda mudo sin pedir sus guiones',
    de: `/__/auth/:splat  200`,
    a:  `/__/auth/  200` },
  { nombre: 'el 200 se vuelve 301: el enlace sirve y la barra delata el proyecto',
    de: `/__/auth/:splat  200`,
    a:  `/__/auth/:splat  301` },
  { nombre: 'el destino apunta a otro host del proyecto, que no canjea el código',
    de: `https://campo-fosmon.firebaseapp.com/__/auth/:splat`,
    a:  `https://campo-fosmon.web.app/__/auth/:splat` },
  { nombre: 'el comodín se abre: la app entera se sirve desde el host de Google',
    de: `/__/auth/*  https://`,
    a:  `/*  https://` },
  { nombre: 'la regla se retira: el enlace del correo cae en un 404',
    de: `/__/auth/*  https://campo-fosmon.firebaseapp.com/__/auth/:splat  200`,
    a:  `# (sin regla)` },
];

// La otra mitad del mismo defecto vive en otro archivo: el rebote de
// navegación del service worker. Son dos fuentes, así que son dos listas.
const MUTANTES_PWA = [
  { nombre: 'el service worker vuelve a tragarse `/__/`: el enlace abre la app, no el manejador',
    de: `navigateFallbackDenylist: [/^\\/api/, /^\\/__\\//],`,
    a:  `navigateFallbackDenylist: [/^\\/api/],` },
  { nombre: 'la exclusión se escribe sin anclar y deja de casar con la ruta del correo',
    de: `/^\\/__\\//],`,
    a:  `/__\\/x/],` },
];

const LOTES = [
  { arch: REGLAS, mutaciones: MUTANTES_REGLAS, extension: '', env: 'ARCH_REDIRECTS' },
  { arch: VITE,   mutaciones: MUTANTES_PWA,    extension: '.js', env: 'ARCH_VITE' },
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

// ── EL RUTEO DE NETLIFY, COMO LO HACE NETLIFY ───────────────────────────────
// Reglas en orden, primera que casa gana; `*` al final del origen captura el
// resto y se sustituye en `:splat`. Es la parte de la especificación que esta
// regla usa, y no se finge soportar más.
function reglasDe(texto) {
  return texto.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map((l, i) => {
      const campos = l.split(/\s+/);
      if (campos.length < 2) return { renglon: i + 1, malformada: l };
      const [origen, destino, estado] = campos;
      return { renglon: i + 1, origen, destino, estado: Number(estado || 301) };
    });
}

function rutear(reglas, pedido) {
  for (const r of reglas) {
    if (r.malformada) continue;
    if (r.origen.endsWith('/*')) {
      const raizDeLaRegla = r.origen.slice(0, -1);        // «/__/auth/»
      if (pedido.startsWith(raizDeLaRegla))
        return { ...r, destinoFinal: r.destino.replace(':splat', pedido.slice(raizDeLaRegla.length)) };
    } else if (r.origen === pedido) {
      return { ...r, destinoFinal: r.destino };
    }
  }
  return null;
}

const hostDe = (url) => { try { return new URL(url).host; } catch { return ''; } };

// El host esperado NO se teclea: se lee de la configuración del SDK, que es
// quien declara cuál es el dominio de Auth de este proyecto.
const APP = path.join(raiz, 'src/App.jsx');
const mAuth = /authDomain:\s*["']([^"']+)["']/.exec(fs.readFileSync(APP, 'utf8'));
if (!mAuth) noArranco(['no se halló `authDomain` en src/App.jsx: sin él no hay contra qué comparar'],
  'src/App.jsx');
const HOST_DE_AUTH = mAuth[1];

const reglas = reglasDe(fs.readFileSync(REGLAS, 'utf8'));

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Lo que de verdad llega: el enlace del correo tal como Firebase lo arma, y
// los dos guiones que la página pide después por ruta relativa.
const DEL_CORREO = '/__/auth/action';
const PIDE_DESPUES = ['/__/auth/action.js', '/__/auth/experiments.js'];
const DE_LA_APP = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png',
                   '/una-ruta-que-nadie-escribió'];

console.log('\n── EL ENLACE DE RECUPERAR NO SALE DE COTEA ──\n');

console.log('§1 · el enlace del correo se atiende, y desde cotea');
const r1 = rutear(reglas, DEL_CORREO);
check(!!r1, `«${DEL_CORREO}» encuentra una regla`, r1 ? '' : 'NO LA ENCUENTRA: 404');
check(!!r1 && r1.estado === 200,
  'se sirve con 200, o sea que el navegador se queda en app.cotea.com.mx',
  r1 ? `estado ${r1.estado}${r1.estado !== 200 ? ' — la barra diría el otro host' : ''}` : '');
check(!!r1 && hostDe(r1.destinoFinal) === HOST_DE_AUTH,
  `apunta al mismo host que el \`authDomain\` del SDK (${HOST_DE_AUTH})`,
  r1 ? hostDe(r1.destinoFinal) || '(destino sin host)' : '');
check(!!r1 && new URL(r1.destinoFinal).pathname === DEL_CORREO,
  'y a la MISMA ruta, no a otra del mismo host',
  r1 ? new URL(r1.destinoFinal).pathname : '');

console.log('\n§2 · y lo que la página pide después, que es lo que compra `:splat`');
for (const p of PIDE_DESPUES) {
  const r = rutear(reglas, p);
  const bien = !!r && r.estado === 200 && hostDe(r.destinoFinal) === HOST_DE_AUTH
    && new URL(r.destinoFinal).pathname === p;
  check(bien, `«${p}» llega a su archivo`,
    r ? new URL(r.destinoFinal).pathname : 'sin regla');
}

console.log('\n§3 · y nada de la app se va al host de Google');
for (const p of DE_LA_APP) {
  const r = rutear(reglas, p);
  check(!r, `«${p}» lo sigue sirviendo cotea`,
    r ? `SE LO LLEVA A ${hostDe(r.destinoFinal)}` : '');
}

console.log('\n§4 · ninguna regla del archivo manda el navegador a otro host');
const delatan = reglas.filter(r => !r.malformada && r.estado !== 200
  && hostDe(r.destino) && hostDe(r.destino) !== 'app.cotea.com.mx');
check(delatan.length === 0,
  'no hay rebotes (3xx) hacia un host de fuera: un 3xx cambia la dirección que se ve',
  delatan.length ? delatan.map(r => `renglón ${r.renglon}: ${r.estado} → ${hostDe(r.destino)}`).join('; ') : '');
const malas = reglas.filter(r => r.malformada);
check(malas.length === 0, 'ninguna regla queda a medias, que Netlify ignora en silencio',
  malas.length ? malas.map(r => `renglón ${r.renglon}: «${r.malformada}»`).join('; ') : '');

// ── §5 · EL SERVICE WORKER NO SE LE ADELANTA A LA REESCRITURA ───────────────
// La reescritura de Netlify pasa por la red, y el service worker contesta
// ANTES de que haya red: su rebote de navegación devuelve el `index.html` de
// la caché para cualquier navegación que no esté excluida. El enlace del
// correo ES una navegación. Para quien no tiene la app instalada esto no se
// nota —de ahí que una verificación en un navegador limpio salga verde—; para
// todos los demás el enlace abre la app en vez del manejador.
console.log('\n§5 · y el service worker no contesta por él antes de que haya red');
const vite = fs.readFileSync(VITE, 'utf8');
const mLista = /navigateFallbackDenylist:\s*(\[[^\]]*\])/.exec(vite);
if (!mLista) noArranco(['no se halló `navigateFallbackDenylist` en la configuración de la PWA'],
  path.relative(raiz, VITE));

let excluye;
try {
  const lista = new Function(`"use strict"; return ${mLista[1]};`)();
  excluye = (p) => lista.some(r => r instanceof RegExp && r.test(p));
} catch (e) {
  noArranco([`la lista de exclusiones no se pudo evaluar: ${e.message}`],
    path.relative(raiz, VITE));
}

check(excluye(DEL_CORREO),
  `el rebote deja pasar «${DEL_CORREO}» a la red, donde la reescritura lo espera`,
  excluye(DEL_CORREO) ? '' : 'SE LO TRAGA: el enlace abriría la app, no el manejador');
for (const p of PIDE_DESPUES)
  check(excluye(p), `y también «${p}»`, excluye(p) ? '' : 'SE LO TRAGA');
check(!excluye('/') && !excluye('/una-ruta-que-nadie-escribió'),
  'y sigue rebotando lo de la app, que es para lo que existe: sin red, la app abre',
  excluye('/') ? 'YA NO REBOTA «/»: la app dejaría de abrir sin señal' : '');

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'quien recupera su contraseña no ve el nombre del proyecto en ningún paso.'
  : 'o el enlace no sirve, o sirve delatando el nombre de un cliente.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
