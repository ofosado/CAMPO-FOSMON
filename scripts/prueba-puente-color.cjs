#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   PRUEBA DEL PUENTE DE COLOR
   ─────────────────────────────────────────────────────────────────────────────

   Afirma una sola cosa, y la afirma contra un navegador de verdad:

       el puente de var() no cambió un solo pixel.

   No comprueba que exista un token ni que `C` tenga tal llave. Eso se puede
   cumplir con la pantalla en blanco. Carga `src/styles/tokens.css` en Chrome,
   pinta un elemento por color, y lee con getComputedStyle lo que el navegador
   resolvió. Si `--c-red` no existiera, el color resuelto no sería el esperado
   y la prueba lo diría — que es justo el modo de fallar que tiene este cambio:
   silencioso. Un `var()` que no resuelve no truena, se cae la declaración.

   Los valores esperados son literales tomados de la paleta `C` tal como estaba
   ANTES del puente (commit 348b85b, src/App.jsx:1953-1984). Son el patrón de
   oro: no se derivan del código nuevo, porque entonces la prueba se estaría
   midiendo contra sí misma.

   Uso:  node scripts/prueba-puente-color.cjs
   ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');

// ── El patrón de oro: la paleta antes del puente ────────────────────────────
const ANTES = {
  bg: '#F0F2F5', surface: '#FFFFFF', card: '#FFFFFF',
  border: '#E8EAF0', borderM: '#D0D4DC',
  caliza: '#0D1619', textPri: '#0D1619', textSec: '#555E6B', textMut: '#9AA0AC',
  green: '#639922', greenBg: '#EAF3DE', greenDk: '#3B6D11',
  red: '#E24B4A', redBg: '#FCEBEB', redDk: '#A32D2D',
  blue: '#378ADD', blueBg: '#E6F1FB', blueDk: '#185FA5',
  yellow: '#EF9F27', yellowBg: '#FAEEDA', yellowDk: '#854F0B',
  purple: '#7F77DD', purpleBg: '#EEEDFE', purpleDk: '#3C3489',
  orange: '#D97706', orangeBg: '#FEF3C7',
  pink: '#F43F5E', indigo: '#6366F1',
};

// Los seis alfas que existían como sufijo hex, con el porcentaje que los
// sustituyó.
const ALFAS = [['10', 6.27], ['15', 8.24], ['22', 13.33],
               ['44', 26.67], ['55', 33.33], ['66', 40.00]];
// Sólo estas llaves se usan hoy con transparencia (ver los 27 sitios de alfa).
const CON_ALFA = ['red', 'yellow', 'green', 'blue', 'textMut'];

const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb2css = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;

// ── Por qué §2 compara navegador contra navegador ───────────────────────────
// El primer intento calculaba el color compuesto en Node y lo comparaba con lo
// que pintaba Chrome. Dieron 4 fallas de 149, todas de un paso en un canal, y
// ninguna era del puente: era que `Math.round` no es como compone el
// navegador. La prueba estaba midiendo mi aritmética.
//
// Así que §2 no calcula nada. Pinta el valor VIEJO —el hex con alfa literal,
// "#E24B4A15", que sigue siendo válido porque nunca dependió de var()— junto
// al valor NUEVO, y exige que Chrome los serialice igual. Mismo insumo, mismo
// camino: si el navegador los resuelve al mismo rgba, los compone igual por
// construcción, sin que haga falta modelar el compuesto.

// ── Se arma la página ───────────────────────────────────────────────────────
const tokens = fs.readFileSync(path.join(RAIZ, 'src/styles/tokens.css'), 'utf8');

const casosSolidos = Object.keys(ANTES).map(k => ({
  id: `s_${k}`, nombre: `C.${k} sigue siendo ${ANTES[k]}`,
  css: `background: var(--c-${k})`, esperado: rgb2css(hex2rgb(ANTES[k])),
}));

// Cada caso de alfa son DOS elementos: el viejo y el nuevo. El esperado del
// nuevo es lo que el navegador haya resuelto para el viejo, no un número mío.
const casosAlfa = [];
for (const k of CON_ALFA) {
  for (const [h, pct] of ALFAS) {
    casosAlfa.push({
      id: `a_${k}_${h}`,
      nombre: `alfa(C.${k}, ${pct}) pinta lo mismo que el viejo ${ANTES[k]}${h}`,
      css: `background: rgb(var(--c-${k}-rgb) / ${pct}%)`,
      referencia: { id: `v_${k}_${h}`, css: `background: ${ANTES[k]}${h}` },
    });
  }
}

// La contraparte: que el modo viejo de pedir alfa efectivamente se rompa. Si
// esto dejara de fallar, `alfa()` sobraría — y saberlo importa.
const casoRoto = {
  id: 'roto', nombre: 'el modo viejo `${C.red}15` ya NO pinta (por eso existe alfa())',
  css: 'background: var(--c-red)15', esperado: 'rgba(0, 0, 0, 0)',
};

const todos = [...casosSolidos, ...casosAlfa, casoRoto];

const elementos = [];
for (const c of todos) {
  elementos.push([c.id, c.css]);
  if (c.referencia) elementos.push([c.referencia.id, c.referencia.css]);
}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${tokens}
div { width: 40px; height: 12px; }
</style></head><body>
${elementos.map(([id, css]) => `<div id="${id}" style="${css}"></div>`).join('\n')}
<pre id="salida"></pre>
<script>
document.getElementById('salida').textContent = JSON.stringify(
  ${JSON.stringify(elementos.map(([id]) => id))}.reduce((acc, id) => {
    acc[id] = getComputedStyle(document.getElementById(id)).backgroundColor;
    return acc;
  }, {}));
</script></body></html>`;

// ── Se renderiza en Chrome ──────────────────────────────────────────────────
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));

if (!CHROME) {
  console.error('NO ARRANCÓ: no se encontró Chrome ni Chromium.');
  console.error('Esta prueba necesita un navegador de verdad: mide lo que se pinta,');
  console.error('no lo que el código dice que se pintaría. Sin él no hay prueba.');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'puente-color-'));
const pagina = path.join(tmp, 'p.html');
fs.writeFileSync(pagina, html);

// La salida va a un ARCHIVO, no a una tubería. Con `stdio: 'pipe'` Chrome
// headless imprime el DOM y después se queda colgado sin cerrar: se agota el
// plazo y la prueba parece rota cuando en realidad ya había medido bien.
// Medido: 120 s de espera contra ~6 s redirigiendo a archivo.
const volcado = path.join(tmp, 'dom.html');
let dom;
try {
  const fd = fs.openSync(volcado, 'w');
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run',
    `--user-data-dir=${path.join(tmp, 'perfil')}`,
    '--virtual-time-budget=3000', '--dump-dom', `file://${pagina}`,
  ], { stdio: ['ignore', fd, 'ignore'], timeout: 90000 });
  fs.closeSync(fd);
  dom = fs.readFileSync(volcado, 'utf8');
} catch (e) {
  try { dom = fs.readFileSync(volcado, 'utf8'); } catch { dom = ''; }
  if (!dom) {
    console.error('NO ARRANCÓ: Chrome no devolvió el DOM.', e.message);
    process.exit(1);
  }
}

const m = /<pre id="salida">([\s\S]*?)<\/pre>/.exec(dom);
if (!m) {
  console.error('NO ARRANCÓ: la página no dejó salida. El script no corrió.');
  process.exit(1);
}
const obtenido = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

// ── Veredicto ───────────────────────────────────────────────────────────────
console.log('\n── PUENTE DE COLOR ─────────────────────────────────────────────');
console.log(`   ${path.basename(CHROME)} · ${todos.length} afirmaciones\n`);

let fallas = 0, seccion = '';
for (const c of todos) {
  const sec = c.id.startsWith('s_') ? '§1 los colores sólidos no se movieron'
            : c.id.startsWith('a_') ? '§2 los transparentes pintan idéntico al modo viejo'
            : '§3 el modo viejo está roto, y por eso existe alfa()';
  if (sec !== seccion) { seccion = sec; console.log(`\n${sec}`); }
  const real = obtenido[c.id];
  // Cuando hay referencia, el esperado lo dicta el navegador pintando el valor
  // viejo — no un número calculado aquí.
  c.esperado = c.referencia ? obtenido[c.referencia.id] : c.esperado;
  const ok = real === c.esperado;
  if (!ok) fallas++;
  console.log(`  ${ok ? 'ok   ' : 'FALLA'} ${c.nombre}`
    + (ok ? '' : `\n         esperaba ${c.esperado}  ·  obtuvo ${real}`));
}

fs.rmSync(tmp, { recursive: true, force: true });

// ── §4 que los tokens lleguen de verdad al bundle ───────────────────────────
// Hasta aquí la prueba leyó `tokens.css` del disco, así que diría VERDE aunque
// alguien borrara el `import` de main.jsx y la app entera se quedara sin un
// solo color. Ese es exactamente el modo de fallar de este cambio. Si hay
// build, se mira el CSS construido.
console.log('\n§4 los tokens llegan al bundle');
const dist = path.join(RAIZ, 'dist/assets');
let total = todos.length;
if (!fs.existsSync(dist)) {
  console.log('  ----  sin construir: corre `npm run build` para que esto se pruebe.');
  console.log('        (no cuenta como falla, pero tampoco como verde)');
} else {
  total++;
  const css = fs.readdirSync(dist).filter(f => f.endsWith('.css'))
    .map(f => fs.readFileSync(path.join(dist, f), 'utf8')).join('\n');
  const llego = css.includes('--c-red-rgb') && css.includes('--c-textMut');
  if (!llego) fallas++;
  console.log(`  ${llego ? 'ok   ' : 'FALLA'} el CSS construido trae la paleta`
    + (llego ? '' : '\n         dist/assets/*.css no contiene --c-red-rgb.'
              + '\n         ¿se borró el import de src/main.jsx? La app quedaría sin color.'));
}

console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${total - fallas}/${total}\n`);
process.exit(fallas === 0 ? 0 : 1);
