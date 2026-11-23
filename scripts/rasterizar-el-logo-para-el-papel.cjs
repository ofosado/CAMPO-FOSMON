#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL LOGO DE COTEA, EN PNG, PARA QUE QUEPA EN UN PDF
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE. `jsPDF.addImage` NO pinta SVG y NO hace fetch: lo único que
// acepta es un mapa de bits ya en memoria. La marca de cotea vive en SVG
// (`src/assets/brand/`), así que para que la portada del papel lleve el logo de
// verdad —y no la palabra «cotea» escrita en Helvetica, que es lo que llevaba
// hasta el 2026-11-22— hay que rasterizarlo una vez y meterlo al bundle.
//
// Y EN BLANCO, porque la mitad izquierda de la portada es pizarra oscura. El
// PNG que ya existía (`public/cotea-horizontal.png`) es la versión a color
// sobre claro: puesta sobre el panel oscuro no se ve. La de una tinta en
// blanco es `cotea-horizontal-1tinta-blanco.svg`, que es la que el manual de
// marca da para fondos oscuros.
//
// FONDO TRANSPARENTE. Rasterizarlo sobre el pizarra sería más simple —no hay
// alfa que negociar— pero ataría el PNG a un color: el día que el panel cambie
// de tono, el logo llevaría pegado el viejo en un rectángulo. Con alfa el
// mismo archivo sirve sobre cualquier fondo oscuro.
//
// TRES VECES EL TAMAÑO IMPRESO. En el papel mide ~40 mm de ancho; a 300 ppp
// eso son ~472 px, así que se rasteriza a 480. Menos se ve pastoso al imprimir
// y más es peso muerto en un bundle que ya es grande.
//
// NO CORRE EN LA SUITE. Es una herramienta de un solo uso: se ejecuta cuando
// la marca cambia, y lo que la suite vigila es que el PNG resultante siga
// estando y siga entrando al papel (`prueba-la-portada-lleva-los-logos`).
//
// Uso:  node scripts/rasterizar-el-logo-para-el-papel.cjs

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const ORIGEN = path.join(raiz, 'src/assets/brand/cotea-horizontal-1tinta-blanco.svg');
const DESTINO = path.join(raiz, 'src/assets/brand/cotea-horizontal-blanco.png');
const ANCHO = 480;

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
                '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) {
  console.error('NO ARRANCÓ: no se encontró Chrome para rasterizar.');
  process.exit(2);
}
if (!fs.existsSync(ORIGEN)) {
  console.error(`NO ARRANCÓ: no está ${path.relative(raiz, ORIGEN)}.`);
  process.exit(2);
}

const svg = fs.readFileSync(ORIGEN, 'utf8');
// La proporción sale del `viewBox`, no de un alto tecleado: si la marca cambia
// de proporción, el PNG la sigue en vez de deformarla.
const vb = /viewBox="([-\d. ]+)"/.exec(svg);
if (!vb) {
  console.error('NO ARRANCÓ: el SVG no trae `viewBox`, y sin él no se sabe su proporción.');
  process.exit(2);
}
const [, , vw, vh] = vb[1].trim().split(/\s+/).map(Number);
const ALTO = Math.round(ANCHO * (vh / vw));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-png-'));
const html = path.join(dir, 'logo.html');
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
svg{display:block;width:${ANCHO}px;height:${ALTO}px}</style>
${svg}`);

execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  // Fondo TRANSPARENTE: sin esto Chrome compone sobre blanco y el logo blanco
  // desaparece en un rectángulo blanco, que es el modo en que esto falla sin
  // que nadie lo note hasta ver el PDF.
  '--default-background-color=00000000',
  `--window-size=${ANCHO},${ALTO}`,
  `--screenshot=${DESTINO}`,
  `file://${html}`,
], { stdio: 'pipe' });

const bytes = fs.statSync(DESTINO).size;
console.log(`${path.relative(raiz, DESTINO)} · ${ANCHO}×${ALTO} · ${bytes} bytes`);
// El PNG entra al bundle como data URI (`?inline`), así que su peso se paga en
// cada carga de la app. Se dice en voz alta en vez de descubrirlo en el build.
if (bytes > 60 * 1024)
  console.log(`AVISO: ${(bytes/1024).toFixed(0)} KB es mucho para incrustar. `
    + 'Revisa que el SVG no traiga detalle que a 480 px no se ve.');
