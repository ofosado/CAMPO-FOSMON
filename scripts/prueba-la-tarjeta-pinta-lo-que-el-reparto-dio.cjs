#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA TARJETA PINTA LO QUE EL REPARTO LE DIO — NI MÁS, NI DOS A CADA QUIEN
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ DEFECTO CIERRA. `seleccionFotografica` reparte las fotos en proporción al
// peso de cada partida, y la tarjeta del tablero las pintaba en una rejilla
// FIJA de dos cuadros, `[0,1]`. El reparto se calculaba y se tiraba.
//
// Medido en producción el 2026-11-09 con `medir-lo-que-la-tarjeta-no-ensena.cjs`
// (sólo lectura): de 75 fotos elegidas en las siete obras vivas, la tarjeta
// pintaba 23. En la 0112, la partida que vale el **57.5% del contrato** tenía 24
// fotos y el reparto le daba 12; la pantalla le daba las mismas 2 que a una del
// 5.6%, a la que el reparto daba 1. El reparto las separaba 12× y la pantalla
// 2× — y con dos huecos fijos la razón en pantalla NO PUEDE pasar de 2, así que
// la propiedad que pidió el mandato («una partida del 25% no puede quedar
// representada por una sola foto mientras otra del 5% se lleva seis») era
// inalcanzable por construcción, no por un valor mal puesto.
//
// Y EL SEGUNDO DEFECTO, QUE ES UNA AFIRMACIÓN FALSA EN PANTALLA. La rejilla
// rellenaba el cuadro sobrante con «Sin foto» aunque la partida tuviera fotos de
// sobra. En la 0112 el cuadro decía «Sin foto» justo encima del renglón que
// decía «1 de 31 fotografías de esta partida». Las dos cosas en la misma
// tarjeta, y una de las dos era mentira.
//
// QUÉ AFIRMA ESTE BANCO. No afirma que exista un símbolo: EXTRAE el bloque de la
// tarjeta de `src/App.jsx` buscándolo por lo que DICE en pantalla —su título—,
// lo compila y lo RENDERIZA, y afirma sobre el HTML que sale: cuántas imágenes
// lleva cada partida, qué dice el cuadro vacío, y si la partida que pesa más
// sale con más fotos que la que pesa menos.
//
// LO QUE NO SE AFIRMA. Cuántas partidas caben en la tarjeta (`topePartidas`) ni
// el valor del tope: eso es maquetación, y vive en `prueba-se-enseña-lo-que-pesa`
// como lo que es —la regla compartida—. Aquí sólo se afirma que la pantalla NO
// DESHACE lo que la regla decidió.
//
// LA FRONTERA CON EL EXPEDIENTE SIGUE EN PIE, y es la razón de que esto no sea
// un retroceso: el tope del reparto es el mismo (`TOPE_FOTOS`) y la tarjeta
// pinta un SUBCONJUNTO de ese reparto. Nunca otra lista. Si algún día alguien
// recorta el reparto a lo que cabe en la tarjeta, el que muerde es
// `prueba-se-enseña-lo-que-pesa` §8, que para eso está.
//
// Uso:
//     node scripts/prueba-la-tarjeta-pinta-lo-que-el-reparto-dio.cjs
//     node scripts/prueba-la-tarjeta-pinta-lo-que-el-reparto-dio.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');

// ── LA REGLA VIVA ─────────────────────────────────────────────────────────
// Sale del archivo por la puerta única. Las raíces son las que el banco llama;
// `fuenteDe` arrastra el cierre transitivo, que es justo lo que evita el
// defecto del 2026-10-26 y del 2026-11-09 —cuatro bancos muertos por una lista
// de dependencias tecleada a mano.
const PEDIDOS = ['seleccionFotografica', 'frasesDeCobertura', 'TOPE_FOTOS',
  'COBERTURA_TECHO', 'MXN', 'NUM', 'C'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length && !process.env.ARCHIVO_APP) noArranco(faltan, path.basename(archivo));
const APP = new Function(
  `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.filter(n => !faltan.includes(n)).join(', ')} };`)();
const { seleccionFotografica, TOPE_FOTOS, C, MXN, NUM } = APP;

// ── EL BLOQUE DE LA TARJETA, SACADO DEL ARCHIVO ────────────────────────────
// Se busca por lo que la tarjeta DICE, no por una variable: el día que alguien
// renombre `sel` o `p` la prueba tiene que seguir mirando esta tarjeta.
let fuenteBloque = null;
{
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    CallExpression(p) {
      if (fuenteBloque) return;
      if (p.node.callee.type !== 'ArrowFunctionExpression') return;
      if (p.node.arguments.length) return;
      const txt = src.slice(p.node.start, p.node.end);
      if (!txt.includes('seleccionFotografica({')) return;
      if (!txt.includes('sel.mostradas.map')) return;
      fuenteBloque = txt;
    },
  });
}
if (!fuenteBloque) {
  console.error('\nNO ARRANCÓ: no se encontró el bloque de fotos del tablero.');
  console.error('Se busca el IIFE que llama a `seleccionFotografica` y recorre `sel.mostradas`.');
  console.error('Si la tarjeta se reescribió, lo que hay que arreglar es el ancla.');
  process.exit(2);
}

// Los componentes de mentira dejan rastro legible: lo que se afirma es el texto
// y el número de `<img>`, no la forma del árbol.
const Bar = () => null;
const SelloEvidencia = () => null;

const pintar = ({ subs, evidencia, evidenciaCargada = true, historialAvance = [] }) => {
  const js = esbuild.transformSync(`(${fuenteBloque})`, { loader: 'jsx' }).code;
  const el = new Function('React', 'C', 'MXN', 'NUM', 'Bar', 'SelloEvidencia',
    'seleccionFotografica', 'frasesDeCobertura', 'TOPE_FOTOS', 'COBERTURA_TECHO',
    'subs', 'evidencia', 'evidenciaCargada', 'historialAvance', 'setLbFoto',
    `return ${js}`)(
    React, C, MXN, NUM, Bar, SelloEvidencia,
    seleccionFotografica, APP.frasesDeCobertura, TOPE_FOTOS, APP.COBERTURA_TECHO,
    subs, evidencia, evidenciaCargada, historialAvance, () => {});
  // Un render que revienta es un ROJO, no un «no arrancó»: en pantalla no sale
  // un número mal, no sale nada. Armar el bloque sí es andamiaje y sube.
  try {
    return renderToStaticMarkup(el);
  } catch (e) {
    return `LA TARJETA SE CAYO AL PINTARSE: ${e.message}`;
  }
};

// ── EL CATÁLOGO ───────────────────────────────────────────────────────────
// Reproduce la forma del defecto medido en la 0112: UNA partida que se lleva
// casi todo el contrato y varias chicas, todas con fotos de sobra. Con este
// catálogo el reparto tiene que separar mucho a la grande de las chicas, y la
// pregunta es si la pantalla lo respeta.
//
// Va revuelto a propósito, por lo mismo que el otro banco: un catálogo ya
// ordenado por importe deja pasar la mutación que cambia el criterio de corte,
// porque las dos cuentas dan la misma lista.
const CAT = [
  { sec: 'CH1', sub: 'Guarnición',  imp:  6_000_000, a: 50 },
  { sec: 'GDE', sub: 'Pavimentos',  imp: 60_000_000, a: 40 },
  { sec: 'CH2', sub: 'Banqueta',    imp:  6_000_000, a: 60 },
  { sec: 'CH3', sub: 'Señalamiento',imp:  5_000_000, a: 90 },
];

let n = 0;
const foto = (partidaId, fechaServidor) => ({
  id: `ev${++n}`, url: `https://x/${n}.jpg`, partidaId,
  sec: partidaId, sub: 'toma', origen: 'captura_en_vivo',
  verificada: true, fechaServidor, fechaDeclarada: null,
  anulada: false, motivoAnulacion: null,
});
const fotosDe = (id, k, mesBase = 1) =>
  Array.from({ length: k }, (_, i) =>
    foto(id, `2026-${String(mesBase + i).padStart(2, '0')}-10`));

function correr() {
  const fallos = [];
  const callado = !!process.env.CALLADO;
  const ok = (cond, que, detalle = '') => {
    if (cond) { if (!callado) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`  FALLA ${que}\n        ${detalle}`);
  };

  // ══ §1 · LA GRANDE SALE CON MÁS FOTOS QUE LAS CHICAS ═════════════════════
  if (!callado) console.log('\n§1 · el peso de la partida se ve en cuántas fotos trae');

  // Todas con fotos de sobra: si la pantalla reparte mal, no es por falta de
  // material. La grande tiene las mismas que una chica para que la diferencia
  // en pantalla NO pueda venir de la disponibilidad.
  const evid = [
    ...fotosDe('GDE', 12), ...fotosDe('CH1', 12),
    ...fotosDe('CH2', 12), ...fotosDe('CH3', 12),
  ];
  const sel = seleccionFotografica({ subs: CAT, evidencia: evid,
    evidenciaCargada: true, tope: TOPE_FOTOS, topePartidas: 4 });

  // LAS DOS PARTIDAS SE SACAN DE LO QUE LA TARJETA MUESTRA, no de ids escritos a
  // mano. Con este catálogo la grande vale 77.9% del contrato, así que el corte
  // del 80% se cierra con ella y UNA chica: «Señalamiento» queda fuera y la
  // pantalla no la publica. Preguntar por un rótulo que no está da `null`, y
  // `12 > null` es verdadero por coerción — la aserción se quedaría verde
  // aunque la pantalla no pintara nada. Así que la chica es la más barata de
  // las que SÍ salen, y abajo se exige que las dos se hayan encontrado.
  const enPantalla = [...sel.mostradas].sort((a, b) => b.imp - a.imp);
  const gde = enPantalla[0];
  const ch  = enPantalla[enPantalla.length - 1];
  ok(enPantalla.length >= 2 && gde.fotos.length > ch.fotos.length,
    `el escenario sí separa: el reparto da ${gde?.fotos.length} a la grande`
    + ` y ${ch?.fotos.length} a la chica que también sale`,
    'si el reparto no separa, lo que sigue no comprueba nada');

  const html = pintar({ subs: CAT, evidencia: evid });
  ok(!/SE CAYO AL PINTARSE/.test(html), 'la tarjeta se pinta', html.slice(0, 160));

  // Las `<img>` que caen DENTRO del trozo de cada partida. Se parte el HTML por
  // el rótulo de cada partida, que es texto que la pantalla publica.
  const trozoDe = (rotulo) => {
    const i = html.indexOf(`>${rotulo}<`);
    if (i < 0) return null;
    const sig = CAT.map(s => html.indexOf(`>${s.sub}<`))
      .filter(j => j > i).sort((a, b) => a - b)[0];
    return html.slice(i, sig === undefined ? html.length : sig);
  };
  const imgsDe = (rotulo) => {
    const t = trozoDe(rotulo);
    return t === null ? null : (t.match(/<img /g) || []).length;
  };

  const nGde = imgsDe(gde.s.sub);
  const nCh  = imgsDe(ch.s.sub);
  ok(nGde !== null && nCh !== null,
    `las dos partidas salen en la tarjeta: «${gde.s.sub}» y «${ch.s.sub}»`,
    `trozos ${nGde} y ${nCh} — un rótulo que no está da null y arruina la comparación`);
  ok(nGde !== null && nCh !== null && nGde > nCh,
    `y la que más pesa sale con MÁS fotos que la chica: ${nGde} contra ${nCh}`,
    'con una rejilla fija de dos cuadros las dos salen con 2 y el reparto se tira');

  // LA AFIRMACIÓN FUERTE: la pantalla no comprime. Si el reparto separa 12× y
  // la pantalla 2×, la propiedad pedida no se cumple por mucho que el reparto
  // la respete adentro.
  ok(nGde === gde.fotos.length,
    `la grande pinta EXACTAMENTE lo que el reparto le dio: ${nGde} de ${gde.fotos.length}`,
    'pintar menos de lo repartido es tirar el reparto');

  // ══ §2 · EL HUECO SE DECLARA SÓLO CUANDO ES UN HUECO ═════════════════════
  if (!callado) console.log('\n§2 · «sin evidencia» es de la que no tiene, no de la que no le tocó');

  // Una partida con MUCHAS fotos a la que el reparto le da pocas. La rejilla
  // vieja rellenaba el cuadro sobrante con «Sin foto» y la contradecía el
  // renglón de abajo, que decía «1 de 31».
  const chicaConMuchas = sel.partidas.find(
    p => p.disponibles > p.fotos.length && p.fotos.length > 0);
  ok(!!chicaConMuchas,
    'el escenario tiene una partida con más fotos de las que le tocaron',
    'sin eso, §2 no comprueba nada');
  if (chicaConMuchas) {
    const t = trozoDe(chicaConMuchas.s.sub);
    // NO SE PREGUNTA POR EL RÓTULO VIEJO, SE PREGUNTA POR LA CONDUCTA. La
    // primera versión de esto exigía que no apareciera la cadena «Sin foto»,
    // que era como se llamaba el cuadro antes. La mutación que vuelve a poner
    // el cuadro de ausencia encima de una partida con fotos pasó limpia: el
    // cuadro nuevo dice «Sin evidencia fotográfica», otra cadena, mismo
    // embuste. Lo que la pantalla no puede hacer es declarar un hueco donde no
    // lo hay, se llame como se llame; y si tiene fotos repartidas, tiene que
    // pintarlas.
    ok(t !== null && imgsDe(chicaConMuchas.s.sub) === chicaConMuchas.fotos.length,
      `la partida con fotos de sobra pinta las ${chicaConMuchas.fotos.length} que le tocaron`,
      `pintó ${imgsDe(chicaConMuchas.s.sub)}`);
    ok(t !== null && !/Sin (foto|evidencia)/i.test(t),
      'y NO publica ningún cuadro que declare que no hay evidencia',
      'tiene ' + chicaConMuchas.disponibles + ' y el cuadro decía que no hay');
    ok(t !== null && new RegExp(`${chicaConMuchas.fotos.length} de ${chicaConMuchas.disponibles}`).test(t),
      `y dice cuántas de cuántas: «${chicaConMuchas.fotos.length} de ${chicaConMuchas.disponibles}»`,
      'sin ese renglón, enseñar una de treinta y una se lee como que hay una');
  }

  // Y LA QUE DE VERDAD NO TIENE NADA SÍ APARECE DICIÉNDOLO. Es la excepción que
  // el mandato pide explícitamente: vale más un hueco declarado que una galería
  // que se ve completa.
  const evidSinGde = [...fotosDe('CH1', 4), ...fotosDe('CH2', 4), ...fotosDe('CH3', 4)];
  const htmlSinGde = pintar({ subs: CAT, evidencia: evidSinGde });
  ok(/Pavimentos/.test(htmlSinGde),
    'la partida del 60% sin una sola foto aparece igual, en vez de desaparecer');
  ok(/Sin evidencia/.test(htmlSinGde),
    'y la tarjeta dice que no hay evidencia de ella');
  const selSinGde = seleccionFotografica({ subs: CAT, evidencia: evidSinGde,
    evidenciaCargada: true, tope: TOPE_FOTOS, topePartidas: 4 });
  const gdeSin = selSinGde.partidas.find(p => p.id === 'GDE');
  ok(!!gdeSin?.sinEvidencia,
    'y es la grande la que está marcada sin evidencia, no otra',
    `sinEvidencia=${gdeSin?.sinEvidencia}`);

  // ══ §3 · NINGUNA FOTO QUE EL EXPEDIENTE NO IMPRIMA ═══════════════════════
  if (!callado) console.log('\n§3 · la tarjeta pinta un subconjunto del reparto, nunca otra lista');

  // Ésta es la frontera que NO se puede perder al arreglar lo de arriba. Todas
  // las `<img>` de la tarjeta tienen que ser urls que el reparto repartió.
  const urlsPintadas = [...html.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
  const urlsRepartidas = new Set(
    [...sel.partidas, ...sel.fuera].flatMap(p => p.fotos.map(f => f.url)));
  const colada = urlsPintadas.find(u => !urlsRepartidas.has(u));
  ok(!colada,
    `las ${urlsPintadas.length} fotos de la tarjeta salen todas del reparto`,
    colada ? `se coló ${colada}` : '');

  ok(urlsPintadas.length <= TOPE_FOTOS,
    `y no pasan del tope compartido: ${urlsPintadas.length} ≤ ${TOPE_FOTOS}`,
    'el tope es el del expediente; si la tarjeta lo pasa, el reparto ya no es el mismo');

  // ══ §4 · SIN COBERTURA MEDIBLE NO SE INVENTA UNA GALERÍA ═════════════════
  if (!callado) console.log('\n§4 · sin importes, la tarjeta lo dice y no pinta un ranking');

  const sinImportes = CAT.map(s => ({ ...s, imp: 0 }));
  const htmlSinImp = pintar({ subs: sinImportes, evidencia: evid });
  ok(!/SE CAYO AL PINTARSE/.test(htmlSinImp), 'con el catálogo sin importes la tarjeta se pinta',
    htmlSinImp.slice(0, 160));
  ok(!/% del contrato/.test(htmlSinImp),
    'y no publica un «% del contrato» que no se pudo calcular');

  return fallos;
}

// ── LAS MUTACIONES ────────────────────────────────────────────────────────
// Cada una vuelve a poner el defecto medido, dejando la tarjeta compilando y
// con aspecto razonable. Mutan `src` —el archivo entero— porque lo que se
// prueba es la PANTALLA, y la pantalla vive en el JSX, no en el cuerpo de
// módulo.
const MUTACIONES = [
  ['la rejilla vuelve a ser de dos cuadros fijos y tira el reparto',
    `                {p.fotos.map((foto,fi)=>(`,
    `                {[0,1].map(fi=>p.fotos[fi]).filter(Boolean).map((foto,fi)=>(`],
  ['el cuadro vacío vuelve a decir «Sin foto» en una partida que tiene fotos',
    `            {p.sinEvidencia ? (`,
    `            {(p.sinEvidencia || p.disponibles > p.fotos.length) ? (`],
  ['la partida grande SIN evidencia vuelve a desaparecer de la tarjeta',
    `            {p.sinEvidencia ? (`,
    `            {false ? (`],
  ['la tarjeta deja de decir cuántas de cuántas fotos enseña',
    `            {p.disponibles > p.fotos.length && (`,
    `            {false && (`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tarjeta-fotos-'));
  let i = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!src.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 120)}`);
      process.exit(2);
    }
    const f = path.join(dir, `app-${i++}.jsx`);
    fs.writeFileSync(f, src.replace(de, a));
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f, CALLADO: '1' }, encoding: 'utf8' });
    if (r.status === 2) {
      console.error(`NO ARRANCÓ: «${titulo}» revienta el banco en vez de romper la semántica`);
      console.error(r.stdout.split('\n').filter(l => /NO ARRANCÓ|excepción/.test(l)).join('\n'));
      process.exit(2);
    }
    // LA CUENTA SALE DEL RENGLÓN DE SALIDA DEL HIJO, no de contar «FALLA» en su
    // stdout: con CALLADO el hijo no imprime esos renglones, así que contarlos
    // daba cero y el informe caía al «|| 1». Decía «1 aserción mordió» cuando
    // habían mordido tres. Un número que no se midió no se teclea.
    const caidas = Number((r.stderr.match(/ROJO: (\d+) aserción/) || [])[1]) || 0;
    if (r.status === 0) {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      process.exit(1);
    }
    console.log(`   ✓ ROJO  ${titulo}  ·  ${caidas || '≥1'} aserción(es) mordieron`);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.\n`);
  process.exit(0);
}

console.log('LA TARJETA PINTA LO QUE EL REPARTO DIO');
const fallos = correr();
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
