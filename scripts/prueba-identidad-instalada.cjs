#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   PRUEBA DE LA IDENTIDAD DE LA APP INSTALADA
   ─────────────────────────────────────────────────────────────────────────────

   El manifiesto es el único archivo del repositorio cuyos errores no se ven
   nunca en desarrollo. Nadie instala la PWA para programar: se abre en una
   pestaña, y en una pestaña un ícono que da 404, un `sizes` que miente o un
   `background_color` que no pega con el ícono se ven exactamente igual que si
   estuvieran bien. El error aparece en el teléfono de un supervisor, el día de
   la demo, y lo único que se ve es "no salió el botón de instalar".

   Por eso esta prueba no lee el manifiesto como texto: lo **ejecuta** —lo saca
   del AST de `vite.config.js` y lo evalúa, que es el mismo objeto que va a
   acabar en `manifest.webmanifest`— y después abre los PNG y les lee los bytes
   de verdad. Las cinco cosas que afirma son las cinco que fallan calladas:

     1. Cada ícono que el manifiesto promete EXISTE en `public/`.
     2. Sus pixeles reales son los que el `sizes` declara. Un `512x512` sobre
        un PNG de 192 no truena: Android lo descarta y deja de ofrecer la
        instalación, sin decir por qué.
     3. La identidad de la app instalada no se movió. `id` tiene que estar
        escrito y valer lo mismo que el `start_url` que la app YA instalada
        resolvió (`/`). Si no está escrito, la identidad ES el `start_url`, y
        el día que alguien le cuelgue un `?origen=pwa` para medir, los
        teléfonos de FOSMON dejan de reconocer su propia app y la siguiente
        visita ofrece instalar una segunda.
     4. El fondo del splash es el MISMO crema que el ícono trae de fondo. No
        se compara contra un hex escrito a mano: se decodifica el pixel de la
        esquina del PNG y se compara contra el `background_color`. Un ícono
        crema sobre splash negro se ve como una calcomanía pegada, y eso nadie
        lo reporta como bug.
     5. Ya no dice FOSMON en ningún lado. El manifiesto es del producto, no
        del cliente: la marca del municipio entra en tiempo de ejecución desde
        `orgs/{orgId}/config/branding`.

   Uso:  node scripts/prueba-identidad-instalada.cjs
   ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('vite.config.js');

const RAIZ = path.resolve(__dirname, '..');
const PUBLICO = path.join(RAIZ, 'public');

// ── Lo que la app YA instalada tiene en la pantalla de inicio ───────────────
// No se deriva del archivo: es el patrón de oro. Es lo que FOSMON instaló y
// lo que no se puede mover sin que el teléfono crea que es otra app.
const IDENTIDAD_INSTALADA = '/';

// ── El manifiesto, ejecutado ────────────────────────────────────────────────
const fuente = fs.readFileSync(path.join(RAIZ, 'vite.config.js'), 'utf8');
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

let manifiesto = null;
traverse(parse(fuente, { sourceType: 'module' }), {
  ObjectProperty(p) {
    if (manifiesto) return;
    const k = p.node.key;
    if ((k.name || k.value) !== 'manifest') return;
    if (p.node.value.type !== 'ObjectExpression') return;
    const src = fuente.slice(p.node.value.start, p.node.value.end);
    manifiesto = new Function(`"use strict"; return (${src});`)();
  },
});
if (!manifiesto) noArranco('manifest (objeto literal dentro de VitePWA)', 'vite.config.js');

// ── Un decodificador de PNG del tamaño justo ────────────────────────────────
// Sólo necesita dos cosas: el ancho y alto reales (IHDR) y el pixel de la
// esquina superior izquierda. No se trae una dependencia para eso.
function leerPNG(archivo) {
  const b = fs.readFileSync(archivo);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${archivo} no es PNG`);
  const ancho = b.readUInt32BE(16), alto = b.readUInt32BE(20);
  const profundidad = b[24], tipoColor = b[25];
  if (profundidad !== 8) throw new Error(`${archivo}: profundidad ${profundidad}, no 8`);
  const canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipoColor];
  if (!canales) throw new Error(`${archivo}: tipo de color ${tipoColor} (paleta) sin soporte`);

  // Juntar los IDAT (pueden venir partidos) e inflar.
  const trozos = [];
  for (let i = 8; i + 8 <= b.length;) {
    const largo = b.readUInt32BE(i);
    const tipo = b.toString('ascii', i + 4, i + 8);
    if (tipo === 'IDAT') trozos.push(b.subarray(i + 8, i + 8 + largo));
    if (tipo === 'IEND') break;
    i += largo + 12;
  }
  const crudo = zlib.inflateSync(Buffer.concat(trozos));

  // Sólo hace falta la PRIMERA línea. Con la fila 0 los filtros que miran
  // hacia arriba (Up, Average, Paeth) ven ceros, así que basta con Sub.
  const filtro = crudo[0];
  const linea = Buffer.from(crudo.subarray(1, 1 + ancho * canales));
  if (filtro === 1 || filtro === 3 || filtro === 4) {
    for (let i = canales; i < linea.length; i++) {
      const izq = linea[i - canales];
      linea[i] = (linea[i] + (filtro === 1 ? izq : filtro === 3 ? (izq >> 1) : izq)) & 0xff;
    }
  } else if (filtro !== 0 && filtro !== 2) {
    throw new Error(`${archivo}: filtro ${filtro} desconocido en la primera línea`);
  }
  const px = tipoColor === 0 ? [linea[0], linea[0], linea[0]]
                             : [linea[0], linea[1], linea[2]];
  const hex = '#' + px.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { ancho, alto, esquina: hex };
}

// ── Marcador ────────────────────────────────────────────────────────────────
let fallas = 0;
const check = (ok, dice, visto) => {
  console.log(`  ${ok ? '·' : '✗'} ${dice}${ok ? '' : `\n      visto: ${visto}`}`);
  if (!ok) fallas++;
};

console.log('\nIDENTIDAD DE LA APP INSTALADA — manifiesto ejecutado desde vite.config.js\n');

// ── 1 y 2 · los íconos existen y miden lo que dicen medir ───────────────────
console.log('Los íconos que el manifiesto promete:');
const pixeles = [];
for (const ic of manifiesto.icons || []) {
  const archivo = path.join(PUBLICO, ic.src.replace(/^\//, ''));
  if (!fs.existsSync(archivo)) {
    check(false, `${ic.src} se puede abrir`, 'no existe en public/');
    continue;
  }
  const png = leerPNG(archivo);
  pixeles.push({ ic, png });
  check(`${png.ancho}x${png.alto}` === ic.sizes,
        `${ic.src} mide de verdad los ${ic.sizes} que declara`,
        `${png.ancho}x${png.alto}`);
}
check(pixeles.length === (manifiesto.icons || []).length && pixeles.length >= 3,
      'los tres íconos están: 192, 512 y el enmascarable',
      `${pixeles.length} de ${(manifiesto.icons || []).length}`);
check((manifiesto.icons || []).some(i => /maskable/.test(i.purpose || '')),
      'hay un ícono enmascarable, que es el que Android recorta en círculo',
      JSON.stringify((manifiesto.icons || []).map(i => i.purpose)));

// ── 3 · la identidad no se movió ────────────────────────────────────────────
console.log('\nLa identidad de la app que FOSMON ya tiene instalada:');
check(manifiesto.id === IDENTIDAD_INSTALADA,
      'el `id` está escrito y vale lo que la app instalada resolvió',
      JSON.stringify(manifiesto.id));
check(manifiesto.start_url === IDENTIDAD_INSTALADA,
      'el `start_url` sigue donde estaba (es la identidad en iOS, que no lee `id`)',
      JSON.stringify(manifiesto.start_url));
check(manifiesto.scope === IDENTIDAD_INSTALADA,
      'el `scope` sigue donde estaba',
      JSON.stringify(manifiesto.scope));

// ── 4 · el splash pega con el ícono ─────────────────────────────────────────
console.log('\nLa pantalla de arranque:');
const esquinas = [...new Set(pixeles.map(p => p.png.esquina))];
check(esquinas.length === 1,
      'los tres íconos comparten el mismo fondo',
      esquinas.join(' / '));
check(esquinas.length === 1 &&
      esquinas[0] === String(manifiesto.background_color || '').toUpperCase(),
      'el `background_color` del splash ES el fondo del ícono, no un recuadro detrás',
      `ícono ${esquinas.join('/')} · manifiesto ${manifiesto.background_color}`);
check(/^#[0-9A-Fa-f]{6}$/.test(String(manifiesto.theme_color || '')),
      'el `theme_color` es un hex que el navegador puede pintar',
      JSON.stringify(manifiesto.theme_color));

// ── 5 · el manifiesto es del producto, no del cliente ───────────────────────
console.log('\nDe quién es la app:');
const nombres = [manifiesto.name, manifiesto.short_name, manifiesto.description].join(' ');
check(!/fosmon/i.test(nombres),
      'ni el nombre ni la descripción nombran a un cliente',
      nombres);
check(/^cotea\b/i.test(String(manifiesto.short_name || '')),
      'el nombre corto —el que cabe bajo el ícono— es el del producto',
      JSON.stringify(manifiesto.short_name));

// ── Y lo que `index.html` pinta antes de que exista el bundle ───────────────
console.log('\nLo que el navegador lee antes del bundle:');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const metaTema = (html.match(/<meta\s+name="theme-color"\s+content="([^"]+)"/i) || [])[1];
check(String(metaTema).toUpperCase() === String(manifiesto.theme_color).toUpperCase(),
      'el `theme-color` del HTML dice lo mismo que el del manifiesto',
      `html ${metaTema} · manifiesto ${manifiesto.theme_color}`);
const tituloIOS = (html.match(/apple-mobile-web-app-title"\s+content="([^"]+)"/i) || [])[1];
check(!/fosmon|campo/i.test(String(tituloIOS)),
      'el rótulo de iOS tampoco dice CAMPO ni FOSMON',
      JSON.stringify(tituloIOS));
const touch = (html.match(/rel="apple-touch-icon"[^>]*href="([^"]+)"/i) || [])[1];
check(!!touch && fs.existsSync(path.join(PUBLICO, String(touch).replace(/^\//, ''))),
      'el `apple-touch-icon` apunta a un archivo que existe',
      JSON.stringify(touch));
if (touch) {
  const p = leerPNG(path.join(PUBLICO, String(touch).replace(/^\//, '')));
  check(p.ancho === 180 && p.alto === 180,
        'y mide los 180×180 que iOS pide, sin que iOS tenga que reescalarlo',
        `${p.ancho}x${p.alto}`);
}

// Los archivos sueltos que el manifiesto no nombra pero el HTML sí: si uno de
// estos da 404 no se rompe nada visible, y por eso se pudre sin que nadie mire.
for (const href of [...html.matchAll(/<link\s+rel="icon"[^>]*href="([^"]+)"/gi)].map(m => m[1])) {
  check(fs.existsSync(path.join(PUBLICO, href.replace(/^\//, ''))),
        `${href} existe`, 'no está en public/');
}

console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0
  ? 'la app se instala con la cara de cotea y sigue siendo la misma app'
  : `${fallas} afirmación(es) en rojo`}\n`);
process.exit(fallas === 0 ? 0 : 1);

/* ── CONTRAPRUEBAS MEDIDAS (2026-10-08) ──────────────────────────────────────
   Cada mutación se aplicó a `vite.config.js` / `index.html` / `public/` y se
   corrió esta prueba. 11 mutaciones, 11 en ROJO (salida 1, nunca 2):

     · `id` borrado del manifiesto ................................ ROJO
     · `id` puesto en '/?origen=pwa' .............................. ROJO
     · `start_url` movido a '/app' ................................ ROJO
     · `scope` movido a '/app' .................................... ROJO
     · icon-512 declarado como '1024x1024' ........................ ROJO
     · icon-192.png borrado de public/ ............................ ROJO
     · ícono enmascarable con purpose 'any' ....................... ROJO
     · `background_color` de vuelta en '#0D1619' .................. ROJO
     · `name` de vuelta en 'CAMPO — FOSMON' ....................... ROJO
     · `theme-color` del HTML distinto al del manifiesto .......... ROJO
     · `apple-touch-icon` apuntando a /icon-192.png (192, no 180) . ROJO

   La del fondo es la que justifica el decodificador de PNG. Comparar el
   `background_color` contra un hex escrito en la prueba no habría encontrado
   nada: el hex escrito y el del manifiesto serían el mismo texto copiado dos
   veces, y el ícono podría tener cualquier fondo. Se compara contra el pixel
   que está DENTRO del archivo, que es el único que el teléfono va a pintar.
   ───────────────────────────────────────────────────────────────────────── */
