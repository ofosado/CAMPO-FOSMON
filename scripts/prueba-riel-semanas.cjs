#!/usr/bin/env node
// El riel de la línea de tiempo: los huecos se ven, y donde no hay número se
// dice por qué no lo hay.
//
// POR QUÉ ESTA PRUEBA. El riel es lo primero que mira quien abre el
// expediente de una obra, y lo que decide qué conclusión saca antes de leer
// un número. Dos formas de mentir sin equivocarse en ninguna cifra:
//
//   1. ESCONDER EL HUECO. Si el eje sólo pinta las semanas que tienen dato,
//      una S37 queda pegada a una S41 y se leen como consecutivas. Cuatro
//      semanas sin cierre desaparecen de la vista y la obra parece seguida.
//      El hueco no es ausencia de información: es la información.
//
//   2. EL GUION MUDO. Una casilla con "—" significa lo mismo «no cambió» que
//      «nadie capturó» que «los dos cierres no se pueden comparar». Son tres
//      hechos distintos y el expediente tiene que distinguirlos con palabras.
//
// Y una tercera, de arquitectura: que el riel calcule el estado de la semana
// por su cuenta. En septiembre la gráfica y el KPI leían dos cuentas del
// mismo dinero y se contradecían en la misma pantalla (commit 078585e). Aquí
// se comprueba que la marca del riel trae EXACTAMENTE lo que dice
// `estadoPorSemana`, no una copia que pueda derivar.
//
// Lo que se afirma es CONDUCTA: qué número da la cuenta y qué frase sale por
// pantalla. No se afirma que exista ningún nombre (P3). El código se extrae
// por AST de src/App.jsx y se EJECUTA.
//
// Uso:  node scripts/prueba-riel-semanas.cjs [App.jsx]
//
// La contraprueba corre esta misma prueba contra el archivo de antes del
// riel, donde tiene que ponerse ROJA:
//     git show HEAD:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-riel-semanas.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

// Las semanas se arman desde cadenas "YYYY-MM-DD" y el día local decide la
// semana ISO. Se fija la zona para que el resultado no dependa de la máquina.
const TZ_PRUEBA = 'America/Mexico_City';
if (process.env.TZ !== TZ_PRUEBA) {
  const r = require('child_process').spawnSync(process.execPath,
    [__filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, TZ: TZ_PRUEBA } });
  process.exit(r.status === null ? 2 : r.status);
}

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

const NOMBRES = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'semanaISO', 'snapshotId',
  'fechaLocalDeISO', 'MESES_CORTO', 'lunesDeClaveSemana',
  'rangoSemanaEnPalabras', 'leyendaSemanaSubida', 'etiquetaSemanaCorta',
  'estadoPorSemana', 'cruzaAños', 'etiquetaSemanaRiel',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'NOTA_SIN_NOVEDAD', 'NOTA_ESCRITA', 'NOTA_FALTA',
  'notaDeCierre', 'fraseNota',
  'MARCA_CERRADA', 'MARCA_SIN_COMPARAR', 'MARCA_SOLO_FOTOS', 'MARCA_SIN_DATO',
  'rielDeSemanas', 'marcaInicialDelRiel', 'frasePanelSinCierre', 'fraseSinDelta',
];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && NOMBRES.includes(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
  },
});

// Un nombre ausente NO revienta: queda `undefined` y la aserción que lo use
// falla, que es justo lo que debe pasar contra la versión de antes.
const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const {
  rielDeSemanas, marcaInicialDelRiel, frasePanelSinCierre, fraseSinDelta,
  estadoPorSemana, cruzaAños, etiquetaSemanaRiel, snapshotId, fraseNota,
  rangoSemanaEnPalabras, leyendaSemanaSubida,
  MARCA_CERRADA, MARCA_SIN_COMPARAR, MARCA_SOLO_FOTOS, MARCA_SIN_DATO,
  NOTA_FALTA, NOTA_ESCRITA, NOTA_SIN_NOVEDAD,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`TZ:        ${process.env.TZ}`);
console.log(`Extraídos: ${[...vistos].length} de ${NOMBRES.length}\n`);

// Sin la cuenta del riel no hay nada que medir. Es ROJO —la conducta no
// está—, no NO ARRANCÓ: la pregunta «¿se ven los huecos?» tiene respuesta, y
// es que no.
const hayRiel = typeof rielDeSemanas === 'function';
if (!hayRiel) {
  const m = 'no hay riel: no existe una cuenta que diga qué pasó en cada semana del eje';
  fallos.push(m);
  console.log(`0. La cuenta del riel\n   ✗ ${m}\n`);
}

const id = (s, a) => `S${String(s).padStart(2, '0')}-${a}`;
const cierre = (semana, año, avance, extra = {}) => ({
  id: id(semana, año), semana, año, tipo: 'oficial', esquema: 3,
  avancePonderado: avance, montoEjecutado: avance * 10000,
  fechaCierre: `${año}-06-05`, capturadoPor: 'residente@fosmon.com.mx',
  ...extra,
});

const correr = () => {
  // ── 1. El eje no se salta las semanas de en medio ───────────────────────
  // Cierres en S36 y S37, un salto, y otro cierre en S41. Más fotos sueltas en
  // la S39. Si el riel pintara sólo lo que tiene dato, saldrían cuatro marcas
  // y la S37 quedaría pegada a la S39: tres semanas sin cierre invisibles.
  console.log('1. Las semanas sin dato siguen ocupando su lugar en el eje');
  const hist = [cierre(36, 2026, 20), cierre(37, 2026, 24), cierre(41, 2026, 33)];
  const fotos = ['S36-2026', 'S39-2026', 'S39-2026', 'S41-2026'];
  const riel = rielDeSemanas(hist, fotos, {});
  const claves = riel.map(m => m.clave);
  check(claves.join(' ') === 'S36-2026 S37-2026 S38-2026 S39-2026 S40-2026 S41-2026',
    `el eje va semana a semana de la primera a la última (dio "${claves.join(' ')}")`);
  check(riel.length === 6,
    `seis marcas para seis semanas de calendario, no cuatro con dato (dio ${riel.length})`);
  check(claves[0] === 'S36-2026' && claves[claves.length - 1] === 'S41-2026',
    'no se inventan semanas antes de la primera evidencia ni después de la última');

  // ── 2. Los cuatro estados se distinguen ─────────────────────────────────
  // Las cuatro situaciones son hechos distintos y la marca los nombra. Pintar
  // «sin cierre» y «sin nada» igual borraría la diferencia entre una semana en
  // que alguien estuvo en obra y una en que no consta que nadie estuviera.
  console.log('\n2. Cada marca dice en cuál de las cuatro situaciones está');
  const estadoDe = c => riel.find(m => m.clave === c)?.estado;
  check(estadoDe('S36-2026') === MARCA_SIN_COMPARAR,
    `el primer cierre no se puede comparar con nada y lo dice (dio "${estadoDe('S36-2026')}")`);
  check(estadoDe('S37-2026') === MARCA_CERRADA,
    `una semana cerrada con delta calculable queda cerrada (dio "${estadoDe('S37-2026')}")`);
  check(estadoDe('S38-2026') === MARCA_SIN_DATO,
    `una semana sin cierre y sin fotos queda como hueco (dio "${estadoDe('S38-2026')}")`);
  check(estadoDe('S39-2026') === MARCA_SOLO_FOTOS,
    `una semana con fotos pero sin cierre se distingue del hueco (dio "${estadoDe('S39-2026')}")`);
  check(new Set([MARCA_CERRADA, MARCA_SIN_COMPARAR, MARCA_SOLO_FOTOS, MARCA_SIN_DATO]).size === 4,
    'los cuatro estados son cuatro valores distintos, no alias del mismo');

  // Un cierre calculado con otra definición del avance tampoco se compara, aunque
  // tenga semana anterior: restar a través de un cambio de definición fabrica
  // un salto que no ocurrió.
  const otroEsquema = rielDeSemanas(
    [cierre(36, 2026, 20), cierre(37, 2026, 24, { esquema: 1, contratoRef: 'otro' })], [], {});
  check(otroEsquema.find(m => m.clave === 'S37-2026')?.estado === MARCA_SIN_COMPARAR,
    'un cierre con otra definición del avance se marca como no comparable, no como cerrado');

  // ── 3. Las fotos se cuentan por semana, y se distinguen del cierre ──────
  console.log('\n3. La marca dice cuántas fotos hay, y eso no la vuelve cerrada');
  check(riel.find(m => m.clave === 'S39-2026')?.fotos === 2,
    `la S39 trae sus dos fotos (dio ${riel.find(m => m.clave === 'S39-2026')?.fotos})`);
  check(riel.find(m => m.clave === 'S39-2026')?.cierre === null,
    'y sigue sin cierre: la foto no es una afirmación sobre el avance');
  check(riel.find(m => m.clave === 'S38-2026')?.fotos === 0,
    'la semana sin fotos dice cero, no undefined');
  // Una foto sin fecha no cuelga de ninguna semana: no se sabe de cuál es, y
  // colgarla de una sería inventar evidencia fechada.
  const conSinFecha = rielDeSemanas(hist, [...fotos, null, null], {});
  check(conSinFecha.reduce((t, m) => t + m.fotos, 0) === 4,
    'las fotos sin fecha no se le cuelgan a ninguna semana');

  // ── 4. Abre en la última semana CERRADA, no en la última con fotos ──────
  // Si abriera en la última con evidencia, una foto subida tarde mandaría el
  // panel a una semana sin cierre y recibiría con «no consta nada» a quien
  // entra a una obra que sí tiene cierres.
  console.log('\n4. El riel abre en la última semana cerrada');
  check(marcaInicialDelRiel(riel) === 'S41-2026',
    `abre en la última cerrada (dio "${marcaInicialDelRiel(riel)}")`);
  const fotoTardia = rielDeSemanas([cierre(36, 2026, 20), cierre(37, 2026, 24)],
    ['S41-2026'], {});
  check(marcaInicialDelRiel(fotoTardia) === 'S37-2026',
    `una foto subida tres semanas después no mueve la apertura (dio "${marcaInicialDelRiel(fotoTardia)}")`);
  check(marcaInicialDelRiel(rielDeSemanas([], ['S20-2026', 'S22-2026'], {})) === 'S22-2026',
    'una obra sin ningún cierre abre en la última semana con evidencia');
  check(marcaInicialDelRiel(rielDeSemanas([], [], {})) === null,
    'una obra sin cierres ni fotos no finge tener una semana seleccionada');
  check(rielDeSemanas([], [], {}).length === 0,
    'y su riel está vacío, no lleno de semanas inventadas');

  // ── 5. Donde no hay número, hay una frase que dice por qué ──────────────
  // El guion mudo es la forma más barata de mentir en un expediente.
  console.log('\n5. Nunca un guion: se dice POR QUÉ falta el número');
  const fSoloFotos = frasePanelSinCierre(riel.find(m => m.clave === 'S39-2026'));
  const fHueco     = frasePanelSinCierre(riel.find(m => m.clave === 'S38-2026'));
  check(/no se cerr/i.test(fSoloFotos) && /2 fotos/.test(fSoloFotos)
    && /(avance|dinero)/i.test(fSoloFotos),
    `la semana con sólo fotos explica qué consta y qué no ("${fSoloFotos}")`);
  check(/no se cerr/i.test(fHueco) && /no consta/i.test(fHueco),
    `la semana vacía dice que no consta nada ("${fHueco}")`);
  check(fSoloFotos !== fHueco,
    'y las dos situaciones no se dicen con la misma frase');
  for (const f of [fSoloFotos, fHueco]) {
    check(typeof f === 'string' && f.trim().length > 20 && !/^[—–-]+$/.test(f.trim()),
      `la explicación es una frase y no un guion ("${String(f).slice(0, 24)}…")`);
  }
  check(frasePanelSinCierre(riel.find(m => m.clave === 'S37-2026')) === null,
    'una semana que SÍ se cerró no recibe la explicación de las que no');

  // Y las dos razones para no tener delta se dicen distinto.
  const sinDeltaPrimero = fraseSinDelta(riel.find(m => m.clave === 'S36-2026'));
  const sinDeltaOtro    = fraseSinDelta(otroEsquema.find(m => m.clave === 'S37-2026'));
  check(/primer cierre/i.test(sinDeltaPrimero),
    `«no hay delta» del primer cierre se explica como tal ("${sinDeltaPrimero}")`);
  check(/definicion|definición/i.test(sinDeltaOtro),
    `y el cambio de definición se explica como tal ("${sinDeltaOtro}")`);
  check(sinDeltaPrimero !== sinDeltaOtro,
    'las dos razones no comparten frase: no son el mismo hecho');
  check(fraseSinDelta(riel.find(m => m.clave === 'S37-2026')) === null,
    'una semana con delta no arrastra una explicación de por qué no lo tiene');

  // ── 6. El hueco de la nota se ve, y tiene nombre ────────────────────────
  // Una nota obligatoria se llena con un punto. El hueco visible con el nombre
  // de quien cerró es lo que un director puede reclamar.
  console.log('\n6. La semana cerrada sin nota lo dice, y dice quién la cerró');
  const notas = { 'S37-2026': { texto: 'Tres días sin acceso al frente 2.',
                                autor: 'residente@fosmon.com.mx', escritaEn: '2026-09-11' },
                  'S41-2026': { sinNovedad: true, autor: 'residente@fosmon.com.mx' } };
  const conNotas = rielDeSemanas(hist, fotos, notas);
  const nota = c => conNotas.find(m => m.clave === c)?.nota;
  check(nota('S36-2026')?.estado === NOTA_FALTA,
    `la semana cerrada sin nota queda marcada como hueco (dio "${nota('S36-2026')?.estado}")`);
  check(/residente@fosmon\.com\.mx/.test(fraseNota(nota('S36-2026'))),
    `y la frase nombra a quien la cerró ("${fraseNota(nota('S36-2026'))}")`);
  check(nota('S37-2026')?.estado === NOTA_ESCRITA
    && fraseNota(nota('S37-2026')) === 'Tres días sin acceso al frente 2.',
    'la semana con nota enseña la nota tal cual se escribió');
  check(nota('S41-2026')?.estado === NOTA_SIN_NOVEDAD
    && !/sin nota/i.test(fraseNota(nota('S41-2026'))),
    '«sin novedad» se lee como una declaración, no como un hueco');
  check(nota('S38-2026') === null && nota('S39-2026') === null,
    'una semana que nadie cerró no tiene hueco de nota: no hay a quién reclamárselo');

  // ── 7. Una obra que cruza el año no pierde la semana 53 ─────────────────
  // 2026 es un año ISO de 53 semanas. De S51-2026 a S01-2027 hay tres saltos.
  // Un eje que contara `semana+1` se saltaría la 53 y el riel tendría un día
  // de menos por cada siete al pie de cada marca.
  console.log('\n7. El eje cruza el año por calendario, con sus 52 o 53 semanas');
  const multi = rielDeSemanas([cierre(51, 2026, 70), cierre(1, 2027, 78)], [], {});
  check(multi.map(m => m.clave).join(' ') === 'S51-2026 S52-2026 S53-2026 S01-2027',
    `la 53 de 2026 ocupa su lugar en el eje (dio "${multi.map(m => m.clave).join(' ')}")`);
  // Las marcas se buscan POR CLAVE y no por índice: un eje al que le falte una
  // semana ya falló arriba, y leerlo por posición lo volvería una excepción
  // —NO ARRANCÓ— en lugar del rojo que es. Ver `no-arranco`, principio P4.
  const marcaMulti = c => multi.find(m => m.clave === c);
  check(cruzaAños(multi) === true
    && etiquetaSemanaRiel(marcaMulti('S51-2026') || {}, true) === 'S51 · 2026'
    && etiquetaSemanaRiel(marcaMulti('S01-2027') || {}, true) === 'S01 · 2027',
    'las marcas del riel declaran el año cuando la obra lo cruza');
  check(multi.filter(m => m.año === 2026).length === 3 && multi.filter(m => m.año === 2027).length === 1,
    'cada marca sabe de qué año es, no sólo qué número de semana tiene');

  // ── 8. UNA SOLA CUENTA: la marca no recalcula el estado de la semana ────
  // Si el riel derivara sus propios números, en dos semanas estaría diciendo
  // algo distinto del KPI de la misma pantalla. Pasó en septiembre.
  console.log('\n8. La marca trae lo que dice la cuenta única, no una copia suya');
  const estados = estadoPorSemana(hist);
  for (const e of estados) {
    const m = riel.find(x => x.clave === e.clave);
    check(m && m.cierre.avance === e.avance && m.cierre.dinero === e.dinero
      && m.cierre.delta === e.delta && m.cierre.cerradoPor === e.cerradoPor,
      `${e.clave}: avance, dinero y delta son los mismos que la cuenta única`);
  }
  check(riel.filter(m => m.cierre).length === estados.length,
    'y el riel no inventa cierres que la cuenta única no tiene');

  // Un snapshot que no es 'oficial' no es un cierre, y no puede aparecer como
  // tal en el expediente.
  const conBorrador = rielDeSemanas(
    [cierre(36, 2026, 20), { ...cierre(37, 2026, 99), tipo: 'borrador' }], [], {});
  check(conBorrador.length === 1 && conBorrador[0].clave === 'S36-2026',
    'un snapshot que no es cierre oficial no entra al expediente como semana cerrada');

  // ── 9. Las fechas de la semana se dicen una sola vez ────────────────────
  // El panel del riel y la leyenda de las fotos afirman lo mismo sobre el
  // calendario. Escritas dos veces, una se arregla y la otra sigue mintiendo.
  console.log('\n9. El panel y la leyenda de fotos fechan la semana igual');
  check(rangoSemanaEnPalabras('S39-2026') === '21 al 27 de sep de 2026',
    `la S39 de 2026 va del 21 al 27 de sep (dio "${rangoSemanaEnPalabras('S39-2026')}")`);
  check(rangoSemanaEnPalabras('S53-2026') === '28 de dic de 2026 al 3 de ene de 2027',
    `la que cruza el año lleva los dos años (dio "${rangoSemanaEnPalabras('S53-2026')}")`);
  check(leyendaSemanaSubida('S39-2026').includes(rangoSemanaEnPalabras('S39-2026')),
    'la leyenda de las fotos usa esas mismas fechas, no unas propias');
  check(rangoSemanaEnPalabras(null) === null,
    'y una clave que no es una semana no recibe fechas inventadas');
};

if (hayRiel) correr();

if (fallos.length === 0) {
  console.log('\nVERDE — los huecos del eje se ven y lo que falta se dice con palabras.\n');
  process.exit(0);
}
console.log(`\nROJO — ${fallos.length} comprobación(es) fallaron:`);
fallos.forEach(f => console.log(`  · ${f}`));
console.log('');
process.exit(1);
