#!/usr/bin/env node
// Un expediente al que le falta el principio lo DICE.
//
// POR QUÉ ESTA PRUEBA. `crearSnapshotAvance` recorta el historial a las últimas
// 52 semanas porque el documento de Firestore tiene un límite de 1 MiB —y la
// 0114 ya lo reventó una vez, perdiendo siete cierres en silencio—. El recorte
// quita por el PRINCIPIO.
//
// Mientras las obras duraban un año o menos eso quitaba algo que no había
// pasado. Con obras MULTIANUALES quita la cimentación, el trazo y las
// preliminares: lo que una controversia mira primero. Y lo hacía callando:
// alguien abre la pantalla, ve que el expediente empieza en la semana 30 del
// segundo año, y concluye que la obra empezó ahí.
//
// Lo que se afirma aquí es CONDUCTA: qué frase sale por pantalla en cada
// situación, y qué se graba cuando el recorte ocurre. No se afirma que exista
// ningún nombre (P3). El código se extrae por AST de src/App.jsx y se EJECUTA.
//
// LA DISTINCIÓN QUE SE MIDE, y es la razón de ser de la prueba: el hueco se
// afirma contra la fecha de INICIO capturada, que es un dato; la CAUSA sólo se
// nombra cuando consta que hubo recorte. Deducir el recorte de que haya 52
// semanas justas sería inventar (P2): una obra puede tener 52 cierres sin haber
// perdido ninguno.
//
// Uso:  node scripts/prueba-arranque-perdido.cjs [App.jsx]
//
// Contraprueba contra la versión anterior, donde tiene que ponerse ROJA:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-arranque-perdido.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

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

const RAIZ_NOMBRES = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'semanaISO', 'snapshotId',
  'fechaLocalDeISO', 'MESES_CORTO', 'lunesDeClaveSemana', 'fechaEnPalabras',
  'finVigenteDe', 'estadoPorSemana',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'HUECO_POR_RECORTE', 'HUECO_SIN_CIERRES',
  'huecoDeArranque', 'fraseHuecoDeArranque',
];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && RAIZ_NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && RAIZ_NOMBRES.includes(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
  },
});

const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const {
  huecoDeArranque, fraseHuecoDeArranque, estadoPorSemana, snapshotId,
  HUECO_POR_RECORTE, HUECO_SIN_CIERRES,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${[...vistos].length} de módulo\n`);

const hayCuenta = typeof huecoDeArranque === 'function'
  && typeof fraseHuecoDeArranque === 'function';
if (!hayCuenta) {
  const m = 'el expediente no sabe si le falta su arranque: nada lo mide';
  fallos.push(m);
  console.log(`0. La cuenta del arranque perdido\n   ✗ ${m}\n`);
}

const cierre = (semana, año, avance) => ({
  id: snapshotId ? snapshotId(semana, año) : `S${semana}-${año}`,
  semana, año, tipo: 'oficial', esquema: 3,
  avancePonderado: avance, montoEjecutado: avance * 10000,
  fechaCierre: `${año}-01-01`, capturadoPor: 'residente@fosmon.com.mx',
});

if (hayCuenta) {
  // ── 1. Una obra multianual recortada declara lo que le falta ───────────
  // El caso real del pendiente: contrato de dos años, el historial llegó al
  // tope y las semanas del primer año se borraron. Lo que queda empieza en la
  // semana 30 del segundo año.
  console.log('1. Una obra a la que el tope le comió el primer año lo dice, y dice cuántas semanas');
  const obraLarga = { inicio: '2025-11-03', fin: '2027-03-31' };
  const sobrevivientes = [];
  for (let s = 30; s <= 52; s++) sobrevivientes.push(cierre(s, 2026, 40 + s * 0.5));
  const recorte = { perdidas: 17, ultimaPerdida: 'S29-2026',
    primeraConservada: 'S30-2026', en: '2026-08-01T10:00:00.000Z' };
  const h = huecoDeArranque(estadoPorSemana(sobrevivientes), obraLarga, recorte);
  check(h !== null, 'el expediente reconoce que le falta el principio');
  // Del lunes de la semana del 3 de noviembre de 2025 (S45-2025) al lunes de
  // S30-2026 hay 37 semanas de calendario.
  check(h && h.faltan === 37,
    `faltan 37 semanas entre el arranque de la obra y el primer cierre que queda (dijo ${h && h.faltan})`);
  const f = h && fraseHuecoDeArranque(h);
  check(!!f && /37 semanas/.test(f),
    `la frase dice cuántas semanas faltan (dijo: "${f}")`);
  check(!!f && /3 de nov de 2025/.test(f),
    'la frase dice la fecha en que arrancó la obra, con año');
  check(!!f && /S30/.test(f),
    'la frase dice en qué semana empieza lo que sí hay');
  check(!!f && /tope de 52 semanas/.test(f) && /ya no se puede consultar/.test(f),
    'cuando consta el recorte, la frase dice que esos cierres se borraron');

  // ── 2. Sin registro de recorte NO se afirma que hubo recorte ───────────
  // Los mismos datos, sin el registro. El hueco es igual de cierto —la obra
  // arrancó en 2025 y el expediente empieza en 2026— pero la causa no consta.
  // Decir "se borraron" aquí sería inventar: pudo ser que nadie capturara.
  console.log('\n2. Sin constancia del recorte, se dice el hueco pero no se inventa la causa');
  const hSin = huecoDeArranque(estadoPorSemana(sobrevivientes), obraLarga, null);
  check(hSin !== null && hSin.faltan === 37,
    `el hueco se afirma igual, porque sale de la fecha de inicio (dijo ${hSin && hSin.faltan})`);
  check(hSin && hSin.causa === HUECO_SIN_CIERRES && h.causa === HUECO_POR_RECORTE,
    'las dos situaciones se distinguen por dentro');
  const fSin = hSin && fraseHuecoDeArranque(hSin);
  check(!!fSin && !/tope de 52|borraron/.test(fSin),
    `no se afirma un recorte que no consta (dijo: "${fSin}")`);
  check(!!fSin && /No hay cierres registrados de ese periodo/.test(fSin),
    'se dice lo único que consta: que de ese periodo no hay cierres');
  check(fSin !== f, 'las dos situaciones no se cuentan con la misma frase');

  // ── 3. Un expediente completo NO inventa un hueco ──────────────────────
  // Y esto es lo que impide que el aviso se vuelva ruido: si el primer cierre
  // es el de la semana en que arrancó la obra, no falta nada y no se dice nada.
  console.log('\n3. Un expediente que empieza donde empezó la obra no avisa de nada');
  const obraCorta = { inicio: '2026-09-14', fin: '2026-12-31' };
  // El 14 de septiembre de 2026 es lunes: su semana ISO es la 38.
  const completos = [cierre(38, 2026, 10), cierre(39, 2026, 25), cierre(40, 2026, 41)];
  check(huecoDeArranque(estadoPorSemana(completos), obraCorta, null) === null,
    'sin hueco, no hay aviso');
  // 52 semanas justas tampoco son prueba de recorte.
  const justas = [];
  for (let s = 1; s <= 52; s++) justas.push(cierre(s, 2026, s));
  const obraDe52 = { inicio: '2025-12-29', fin: '2026-12-31' };
  check(huecoDeArranque(estadoPorSemana(justas), obraDe52, null) === null,
    'tener 52 cierres justos no se toma como prueba de que se perdió algo');

  // ── 4. Sin fecha de inicio capturada no se afirma nada ─────────────────
  // No hay contra qué medir. Decir "le faltan N semanas" exigiría suponer
  // cuándo arrancó la obra, y eso es inventar un dato que nadie capturó.
  console.log('\n4. Sin fecha de inicio capturada, no se afirma un hueco que no se puede medir');
  check(huecoDeArranque(estadoPorSemana(sobrevivientes), { fin: '2027-03-31' }, recorte) === null,
    'sin inicio capturado no se dice nada, ni siquiera con recorte registrado');
  check(huecoDeArranque([], obraLarga, recorte) === null,
    'sin ningún cierre tampoco: no hay expediente del que hablar todavía');

  // ── 5. El hueco se cuenta por calendario, no restando números ──────────
  // 2026 es un año ISO de 53 semanas. Restar números de semana se come una.
  console.log('\n5. El hueco cruza el año sin perder la semana 53');
  const obra53 = { inicio: '2026-12-21', fin: '2027-12-31' };  // S52-2026
  const tras53 = [cierre(2, 2027, 30), cierre(3, 2027, 35)];
  const h53 = huecoDeArranque(estadoPorSemana(tras53), obra53, null);
  // De S52-2026 a S02-2027 hay 3 semanas: 2026 tiene 53.
  check(h53 && h53.faltan === 3,
    `de la S52 de 2026 a la S02 de 2027 hay 3 semanas, no 2 (dijo ${h53 && h53.faltan})`);
}

// ── 6. El recorte queda registrado cuando ocurre ───────────────────────
// Sin esto, la pantalla no puede distinguir «se recortó» de «no se capturó»:
// una vez borradas las semanas no queda nada que diga que existieron. Se mide
// la conducta del guardado, extrayendo el cuerpo real de la función.
console.log('\n6. Al recortar, queda escrito qué se perdió');
const mCrear = /const crearSnapshotAvance[\s\S]*?\n\};/.exec(src);
if (!mCrear) {
  fallos.push('no se pudo leer el guardado del cierre semanal');
  console.log('   ✗ no se pudo leer el guardado del cierre semanal');
} else {
  const cuerpo = mCrear[0];
  // Se simula el recorte con la misma lógica que el guardado: 60 semanas
  // entran, 52 salen. Lo que se mide es si lo que se ESCRIBE lleva constancia.
  const mRecorte = /const cuantasSeFueron[\s\S]*?\n      : recortePrevio;/.exec(cuerpo);
  if (!mRecorte) {
    fallos.push('el recorte del historial no deja constancia de lo que borró');
    console.log('   ✗ el recorte del historial no deja constancia de lo que borró');
  } else {
    const semanas = [];
    for (let s = 1; s <= 60; s++) semanas.push(cierre(s, 2026, s));
    const recortadas = semanas.slice(-52);
    const calc = new Function('semanas', 'recortadas', 'hist',
      `"use strict"; ${mRecorte[0]} return recorte;`);
    const r1 = calc(semanas, recortadas, { semanas: [] });
    check(r1 && r1.perdidas === 8,
      `se registran las 8 semanas que se fueron (dijo ${r1 && r1.perdidas})`);
    check(r1 && r1.ultimaPerdida === 'S08-2026' && r1.primeraConservada === 'S09-2026',
      `queda dicha la frontera: última perdida y primera conservada (dijo ${r1 && r1.ultimaPerdida} / ${r1 && r1.primeraConservada})`);
    // Se recorta de una en una: la cuenta tiene que ACUMULAR, o el segundo
    // recorte borraría la memoria del primero y el expediente diría que sólo
    // perdió la última semana.
    const r2 = calc(semanas, recortadas, { semanas: [], recorte: { perdidas: 5 } });
    check(r2 && r2.perdidas === 13,
      `las pérdidas se acumulan entre recortes sucesivos (dijo ${r2 && r2.perdidas})`);
    // Y si no se recortó nada, no se inventa un recorte.
    const r3 = calc(recortadas, recortadas, { semanas: [] });
    check(r3 === null || r3 === undefined,
      'sin recorte no se escribe constancia de recorte');
  }
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log('VERDE — el expediente incompleto se presenta como incompleto.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
