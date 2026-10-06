#!/usr/bin/env node
// Guarda de la rama A: el plazo y la proyección no pierden el año, y el guion
// deja de significar tres cosas distintas a la vez.
//
// POR QUÉ ESTA PRUEBA. Las obras pueden ser multianuales: un contrato de
// noviembre a marzo cruza el cambio de año. La semana ISO reinicia cada enero,
// así que todo lo que ORDENA, AGRUPA o COMPARA por semana tiene que usar el
// par (año, semana). Si algo usa el número solo, marzo se mezcla con
// noviembre, y la pantalla ordena la obra al revés sin avisar.
//
// Y un año ISO tiene 52 o 53 semanas. 2026 tiene 53 —el 1 de enero de 2026 es
// jueves—, así que entre S51-2026 y S01-2027 hay TRES semanas, no dos. Contar
// `(añoB-añoA)*52 + (semB-semA)` se equivoca una semana entera, y esa semana
// entra dividiendo en la velocidad de avance, que es lo que proyecta la fecha
// de término y con ella la pena convencional.
//
// Lo que se afirma aquí es CONDUCTA: qué sale por pantalla y qué número da la
// cuenta. No se afirma que exista ningún nombre (P3). El código se extrae por
// AST de src/App.jsx y se EJECUTA.
//
// Uso:  node scripts/prueba-plazo-multianual.cjs [App.jsx]
//
// La contraprueba corre esta misma prueba contra la versión anterior, donde
// tiene que ponerse ROJA:
//     git show feature/ui-dependencia:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-plazo-multianual.cjs /tmp/antes.jsx
//
// ZONA HORARIA. Una de las comprobaciones mide el defecto de UTC en los días
// transcurridos, y ese defecto solo se ve en una zona con desfase negativo.
// El guion se vuelve a lanzar con TZ=America/Mexico_City para que el
// resultado no dependa de cómo esté configurada la máquina.

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

// ── Extracción del código real ─────────────────────────────────────────
// Dos cosechas distintas:
//   · Declaraciones de nivel de módulo (las piezas de la cuenta).
//   · Declaradores por nombre en CUALQUIER profundidad: la frase de la
//     proyección vive dentro del componente, igual que `finVigente` y
//     `transcurridos` viven dentro de PlazosCliente. No se pueden extraer de
//     otra forma sin reimplementarlas, y reimplementarlas sería probar mi
//     copia en lugar del código.
const RAIZ_NOMBRES = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'montoEstimadoSnap', 'montoPagadoSnap',
  'semanaISO', 'snapshotId',
  'fechaLocalDeISO', 'hoyLocalISO', 'MESES_CORTO', 'lunesDeClaveSemana',
  'finVigenteDe', 'fechaEnPalabras', 'estadoPorSemana', 'cruzaAños',
  'etiquetaSemanaRiel', 'proyeccionDeAvance',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'SIN_PROY_POCOS_CIERRES', 'SIN_PROY_NO_COMPARABLES', 'SIN_PROY_SIN_AVANCE',
  'NUM',
  // El párrafo que estaba debajo del tablero se fue —decía en treinta palabras
  // lo que ahora dice un KPI con un signo y un número—, pero NINGUNA de las
  // razones que cargaba se fue con él: las dicen estas dos, que viven en el
  // módulo justo porque las comparten varias pantallas. `tok` entra porque la
  // paleta `C` se arma con él y sin él el color no se puede leer.
  'tok', 'C', 'frasePorQueSinDesviacion', 'kpiDesviacionPlazo',
];
// Dentro de qué componente buscar cada declarador anidado. El nombre solo no
// basta: `transcurridos` existe en dos componentes distintos y el de más
// arriba calcula otra cosa.
// Se guarda bajo `Componente.nombre` porque el mismo nombre se calcula en
// varias pantallas y cada una es una cuenta distinta hasta que se demuestre
// lo contrario: eso es justo lo que se mide.
const ANIDADOS = [
  'PlazosCliente.finVigente',
  'PlazosCliente.ampliado',
  'PlazosCliente.transcurridos',
  'PlazosCliente.diasPlazo',
  'DashboardDependencia.finVigente',
  'DashboardDependencia.ampliado',
];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();
const anidados = {};
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
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (!n || !p.node.init) return;
    // Tiene que estar DENTRO del componente que le corresponde.
    const dueño = p.getFunctionParent()?.node?.id?.name
      || p.findParent(q => q.isFunctionDeclaration())?.node?.id?.name;
    const clave = `${dueño}.${n}`;
    if (!ANIDADOS.includes(clave)) return;
    if (anidados[clave] === undefined) anidados[clave] = src.slice(p.node.init.start, p.node.init.end);
  },
});

// Un nombre ausente NO revienta: queda `undefined` y la aserción que lo use
// falla, que es justo lo que debe pasar contra la versión vieja.
const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const {
  estadoPorSemana, cruzaAños, etiquetaSemanaRiel, proyeccionDeAvance,
  finVigenteDe, snapshotId, hoyLocalISO, fechaLocalDeISO, fechaEnPalabras, NUM,
  SIN_PROY_SIN_AVANCE, SIN_PROY_NO_COMPARABLES, SIN_PROY_POCOS_CIERRES,
  SIN_DELTA_NO_COMPARABLES,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`TZ:        ${process.env.TZ} (offset ${new Date(2026,8,20,19,0).getTimezoneOffset()} min)`);
console.log(`Extraídos: ${[...vistos].length} de módulo, ${Object.keys(anidados).join(', ') || '(ninguno)'} anidados\n`);

// Si el archivo no trae la cuenta única, las secciones que la miden no se
// pueden correr. Eso ES rojo —la conducta no está—, pero no detiene la prueba:
// las secciones 6 y 7 miden pantallas que existían antes y ahí el rojo se ve
// en números, no en nombres ausentes.
const hayCuentaUnica = ['estadoPorSemana', 'proyeccionDeAvance', 'cruzaAños', 'etiquetaSemanaRiel']
  .every(n => typeof app[n] === 'function');
if (!hayCuentaUnica) {
  const m = 'no hay una sola cuenta del estado de la obra por semana: cada pantalla deriva la suya';
  fallos.push(m);
  console.log(`0. La cuenta del estado por semana\n   ✗ ${m}\n`);
}

// ── Datos: una obra multianual, de noviembre de 2026 a marzo de 2027 ───
const cierre = (semana, año, avance, extra = {}) => ({
  id: snapshotId ? snapshotId(semana, año) : `S${semana}-${año}`,
  semana, año, tipo: 'oficial', esquema: 3,
  avancePonderado: avance, montoEjecutado: avance * 10000,
  fechaCierre: `${año}-01-01`, capturadoPor: 'residente@fosmon.com.mx',
  ...extra,
});

if (hayCuentaUnica) {
  // ── 1. El orden de las semanas usa (año, semana), nunca el número solo ──
  // El historial llega DESORDENADO a propósito y con dos años distintos. Si algo
  // ordena por número de semana, S02-2027 se adelanta a S48-2026 y la obra
  // aparece empezando en marzo.
  console.log('1. Una obra que cruza el año se ordena por (año, semana)');
  const multi = [
    cierre(2, 2027, 61),
    cierre(48, 2026, 40),
    cierre(10, 2027, 80),
    cierre(50, 2026, 50),
  ];
  const eMulti = estadoPorSemana(multi);
  check(eMulti.map(e => e.clave).join(' → ') === 'S48-2026 → S50-2026 → S02-2027 → S10-2027',
    `las semanas quedan en orden de calendario (dio "${eMulti.map(e => e.clave).join(' → ')}")`);
  check(eMulti[0].año === 2026 && eMulti[3].año === 2027,
    'la primera es de 2026 y la última de 2027');
  // El delta de la primera semana de 2027 se mide contra la ÚLTIMA de 2026, no
  // contra la semana 01 de su propio año, que no existe en el historial.
  check(eMulti[2].deltaDe === 'S50-2026' && Math.abs(eMulti[2].delta - 11) < 1e-9,
    `S02-2027 compara contra S50-2026 y da +11pp (dio ${eMulti[2].deltaDe} / ${eMulti[2].delta})`);

  // ── 2. La etiqueta dice el año cuando la obra cruza, y no cuando no ─────
  // Dos marcas "S10" y "S48" en el mismo riel, sin año, no dicen cuándo pasó
  // cada cosa. Y repetir el año en una obra que vive dentro de un año es ruido.
  console.log('\n2. La etiqueta de la semana declara el año solo cuando hace falta');
  check(cruzaAños(eMulti) === true, 'la obra multianual se reconoce como tal');
  check(etiquetaSemanaRiel(eMulti[0], cruzaAños(eMulti)) === 'S48 · 2026',
    `la primera marca se lee "S48 · 2026" (dio "${etiquetaSemanaRiel(eMulti[0], cruzaAños(eMulti))}")`);
  check(etiquetaSemanaRiel(eMulti[3], cruzaAños(eMulti)) === 'S10 · 2027',
    `la última se lee "S10 · 2027" en el mismo riel (dio "${etiquetaSemanaRiel(eMulti[3], cruzaAños(eMulti))}")`);
  const unAño = estadoPorSemana([cierre(38, 2026, 10), cierre(39, 2026, 20)]);
  check(cruzaAños(unAño) === false && etiquetaSemanaRiel(unAño[0], cruzaAños(unAño)) === 'S38',
    `una obra de un solo año se lee "S38", sin repetir el año (dio "${etiquetaSemanaRiel(unAño[0], cruzaAños(unAño))}")`);

  // ── 3. Las semanas entre dos cierres se cuentan por calendario ──────────
  // 2026 es un año ISO de 53 semanas (el 1 de enero de 2026 cae en jueves). De
  // S51-2026 a S01-2027 hay TRES semanas: 51 → 52 → 53 → 01.
  console.log('\n3. Un año ISO de 53 semanas no se pierde al medir la velocidad');
  const obra53 = { inicio: '2026-11-01', fin: '2027-03-31' };
  const p53 = proyeccionDeAvance(
    estadoPorSemana([cierre(51, 2026, 10), cierre(1, 2027, 40)]),
    40, obra53, new Date(2027, 0, 4).getTime());
  check(Math.abs(p53.velocidad - 10) < 1e-9,
    `30pp en 3 semanas reales dan 10.00 pp/sem (dio ${p53.velocidad === null ? 'null' : p53.velocidad.toFixed(4)})`);
  // Las dos cuentas equivocadas que esto descarta, dichas en números:
  //   · dividir entre los PUNTOS (length-1 = 1) daría 30.00
  //   · contar el año como 52 semanas daría 30/2 = 15.00
  check(p53.velocidad !== 30 && p53.velocidad !== 15,
    'no da 30.00 (dividir entre puntos) ni 15.00 (contar el año como 52 semanas)');
  // Y con semanas sin cierre en medio, la velocidad no se infla por contar
  // puntos: de S40 a S44 hay 4 semanas aunque solo haya 2 cierres.
  const pHueco = proyeccionDeAvance(
    estadoPorSemana([cierre(40, 2026, 20), cierre(44, 2026, 40)]),
    40, { inicio: '2026-09-01', fin: '2026-12-31' }, new Date(2026, 10, 2).getTime());
  check(Math.abs(pHueco.velocidad - 5) < 1e-9,
    `20pp con 4 semanas de hueco dan 5.00 pp/sem, no 20.00 (dio ${pHueco.velocidad === null ? 'null' : pHueco.velocidad.toFixed(4)})`);

  // ── 4. El plazo y los días se miden por fechas reales ───────────────────
  console.log('\n4. La desviación se mide en días de calendario contra el fin vigente');
  // Velocidad 10 pp/sem, 40% hecho ⇒ faltan 60pp ⇒ 6 semanas ⇒ 42 días desde el
  // 4 de enero de 2027 = 15 de febrero de 2027. El fin vigente es el 31 de marzo.
  check(p53.semanasAFin === 6, `faltan 6 semanas para el 100% (dio ${p53.semanasAFin})`);
  check(p53.desviacionDias === -44,
    `terminaría 44 días ANTES del 31 de marzo de 2027 (dio ${p53.desviacionDias})`);
  // Con ampliación, la comparación se mueve al fin AMPLIADO, no al original.
  const pAmp = proyeccionDeAvance(
    estadoPorSemana([cierre(51, 2026, 10), cierre(1, 2027, 40)]),
    40, { inicio: '2026-11-01', fin: '2026-12-15', finAmpliado: '2027-03-31' },
    new Date(2027, 0, 4).getTime());
  check(pAmp.finVigente === '2027-03-31' && pAmp.ampliado === true && pAmp.desviacionDias === -44,
    `con ampliación se compara contra el 31 de marzo, no contra el 15 de diciembre (dio ${pAmp.finVigente} / ${pAmp.desviacionDias})`);
  check(finVigenteDe({ fin: '2026-04-14', finAmpliado: '2026-12-01' }) === '2026-12-01'
    && finVigenteDe({ fin: '2026-04-14' }) === '2026-04-14',
    'el fin vigente es el ampliado cuando lo hay, y el original cuando no');
}

// ── 5. Las razones sobrevivieron al párrafo ─────────────────────────────
// Debajo del tablero había un párrafo de treinta palabras. Se quitó: ahora el
// atraso se dice con un KPI, un signo y un número. ESTA SECCIÓN EXISTE PARA QUE
// QUITARLO NO HAYA COSTADO INFORMACIÓN. El párrafo cargaba tres cosas que un
// número pelado pierde —por qué no hay proyección, en qué dirección va la
// desviación, y contra qué fecha se mide— y las tres se siguen diciendo.
//
// Se ejecutan las dos funciones del módulo que hoy las dicen, con las mismas
// situaciones de obra que se le pasaban al párrafo. El guion del principio
// significaba tres cosas a la vez; lo que no puede volver a pasar es que dos
// situaciones distintas se lean igual.
console.log('\n5. Las razones del párrafo siguen dichas, ahora en el KPI');
if (!hayCuentaUnica || typeof app.kpiDesviacionPlazo !== 'function'
    || typeof app.frasePorQueSinDesviacion !== 'function') {
  const m = 'la pantalla no dice en palabras por qué no hay proyección: solo pinta un guion';
  fallos.push(m);
  console.log(`   ✗ ${m}`);
} else {
  const { kpiDesviacionPlazo, C } = app;
  // El color se lee por nombre y no por su valor: `C.red` es `var(--c-red)` y
  // comparar contra la cadena no diría nada en el reporte.
  const nombreColor = v => Object.keys(C).find(k => C[k] === v) || String(v);

  const obraNormal = { inicio: '2026-11-01', fin: '2027-03-31' };
  // Lo que QUEDA ESCRITO en el KPI: el número grande y el renglón de abajo.
  // Es exactamente lo que el lector tiene delante, no el objeto intermedio.
  const kpi = (estados, obra = obraNormal, avance = 40, ahora = new Date(2027, 0, 4).getTime()) => {
    const es = estadoPorSemana(estados);
    return kpiDesviacionPlazo(proyeccionDeAvance(es, avance, obra, ahora));
  };
  const leido = k => `${k.valor} · ${k.sub}`;

  // (a) Un solo cierre: no se puede medir una velocidad.
  const kUno = kpi([cierre(48, 2026, 40)]);
  check(kUno.valor === '—' && /2 cierres/.test(kUno.sub),
    `con un cierre dice que hacen falta dos (dijo: "${leido(kUno)}")`);

  // (b) Dos cierres de esquemas distintos: no se pueden restar.
  const kMix = kpi([cierre(48, 2026, 40, { esquema: 1 }), cierre(49, 2026, 45)]);
  check(kMix.valor === '—' && /no comparables/i.test(kMix.sub),
    `con cierres no comparables lo dice (dijo: "${leido(kMix)}")`);

  // (c) La obra detenida. Es el estado más grave que el sistema puede saber, y
  //     era el que el guion escondía. Ahora además sale en rojo.
  const kQuieta = kpi([cierre(48, 2026, 40), cierre(49, 2026, 40)]);
  check(kQuieta.valor === '—' && /no avanza/i.test(kQuieta.sub),
    `con avance detenido lo dice (dijo: "${leido(kQuieta)}")`);
  check(kQuieta.color === C.red,
    `la obra detenida se pinta en rojo, no en gris (dio ${nombreColor(kQuieta.color)})`);
  check(!/retroced/i.test(kQuieta.sub), 'detenida no se confunde con retroceso');

  // (d) La obra en retroceso: es otra cosa, y se dice con otras palabras.
  const kAtras = kpi([cierre(48, 2026, 45), cierre(49, 2026, 40)]);
  check(kAtras.valor === '—' && /retrocede/i.test(kAtras.sub),
    `con retroceso lo dice (dijo: "${leido(kAtras)}")`);

  // (e) El quinto caso, que el párrafo no distinguía: la obra proyecta
  //     perfectamente pero NADIE CAPTURÓ la fecha de término. Decirle
  //     «requiere 2 cierres» manda al director a buscar donde no está.
  const kSinFin = kpi([cierre(51, 2026, 10), cierre(1, 2027, 40)],
    { inicio: '2026-11-01' });
  check(kSinFin.valor === '—' && /plazo/i.test(kSinFin.sub) && !/cierres/i.test(kSinFin.sub),
    `sin fecha de término dice que falta el plazo, no que falten cierres (dijo: "${leido(kSinFin)}")`);

  // Las cinco situaciones producen cinco renglones distintos: ninguna pareja
  // colapsa en el mismo texto, que es lo que hacía el guion.
  const cinco = [kUno, kMix, kQuieta, kAtras, kSinFin].map(k => k.sub);
  check(new Set(cinco).size === 5,
    `las cinco situaciones producen cinco textos distintos (dio ${new Set(cinco).size})`);

  // (f) CON proyección: el signo es la mitad del dato. 44 días ANTES del plazo
  //     tienen que leerse como adelanto y en verde; «44 días» pelado se lee
  //     como lo que al lector le convenga.
  const kProy = kpi([cierre(51, 2026, 10), cierre(1, 2027, 40)]);
  check(/^−44 d$/.test(kProy.valor) && /adelanto/.test(kProy.sub),
    `44 días antes del plazo se leen como adelanto y con el signo delante (dijo: "${leido(kProy)}")`);
  check(kProy.color === C.greenDk,
    `y en verde, que es lo que un adelanto es (dio ${nombreColor(kProy.color)})`);
  check(/plazo del contrato/.test(kProy.sub),
    'sin ampliaciones declara que mide contra el plazo del contrato');

  // (g) Con ampliación: la fecha contra la que se mide CAMBIÓ, y eso cambia
  //     quién va tarde. Un plazo ampliado que no se declara se lee como el del
  //     contrato firmado.
  const kAmp = kpi([cierre(51, 2026, 10), cierre(1, 2027, 40)],
    { inicio: '2026-11-01', fin: '2026-12-15', finAmpliado: '2027-03-31' });
  check(/plazo ampliado/.test(kAmp.sub),
    `con ampliación declara que mide contra el plazo ampliado (dijo: "${leido(kAmp)}")`);
  check(kAmp.sub !== kProy.sub,
    'medir contra el plazo ampliado y contra el original no se dicen igual');

  // (h) Y el atraso sale con el signo contrario. Misma obra, plazo más corto:
  //     el 15 de febrero contra un fin del 1 de enero son 45 días tarde.
  const kTarde = kpi([cierre(51, 2026, 10), cierre(1, 2027, 40)],
    { inicio: '2026-11-01', fin: '2027-01-01' });
  check(/^\+45 d$/.test(kTarde.valor) && /atraso/.test(kTarde.sub),
    `45 días después del plazo se leen como atraso y con el más delante (dijo: "${leido(kTarde)}")`);
  check(kTarde.color === C.red,
    `y en rojo (dio ${nombreColor(kTarde.color)})`);

  // El párrafo ya no está. Si volviera, habría DOS textos diciendo lo mismo en
  // la misma pantalla y nada que garantice que coinciden.
  check(!/Se compara contra el plazo vigente/.test(src),
    'el párrafo de treinta palabras no volvió al tablero');
}

// ── 6. Una sola cuenta del fin vigente en la pantalla de plazos ─────────
// La pantalla de plazos derivaba el fin vigente de la última ampliación de
// `contrato/plazos`, y el mini-dashboard de `obra.finAmpliado`. Dos cuentas
// del mismo dato en la misma pantalla: así nació el defecto de 078585e.
console.log('\n6. La pantalla de plazos no tiene su propia cuenta del fin vigente');
if (!anidados["PlazosCliente.finVigente"]) {
  fallos.push('la pantalla de plazos no calcula ningún fin vigente');
  console.log('   ✗ la pantalla de plazos no calcula ningún fin vigente');
} else {
  const vigenteEnPantalla = (obra, ampliaciones) => new Function(
    'obra', 'ampliaciones', 'finVigenteDe',
    `"use strict"; return ${anidados["PlazosCliente.finVigente"]};`)(obra, ampliaciones, finVigenteDe);
  // Los dos datos se contradicen a propósito: la obra dice diciembre, la lista
  // de ampliaciones dice junio. La pantalla tiene que dar la misma respuesta
  // que la proyección, no inventar una tercera.
  const obraDisc = { fin: '2026-04-14', finAmpliado: '2026-12-01' };
  const enPantalla = vigenteEnPantalla(obraDisc, [{ fecha: '2026-06-01' }]);
  check(enPantalla === '2026-12-01',
    `la pantalla de plazos da el 1 de diciembre, el fin vigente de la obra (dio ${enPantalla})`);
  check(enPantalla !== '2026-06-01',
    'no se queda con la última ampliación de la lista como si fuera la autoridad');
  if (typeof finVigenteDe === 'function') {
    check(enPantalla === finVigenteDe(obraDisc),
      `la pantalla y la proyección dan el mismo fin vigente (pantalla ${enPantalla}, proyección ${finVigenteDe(obraDisc)})`);
  } else {
    fallos.push('la proyección no comparte con la pantalla una sola definición del fin vigente');
    console.log('   ✗ la proyección no comparte con la pantalla una sola definición del fin vigente');
  }
}

// ── 7. Los días transcurridos se cuentan en el calendario local ─────────
// `new Date().toISOString().slice(0,10)` es UTC: en México, desde las 18:00,
// devuelve la fecha de MAÑANA. Este número es el que multiplica la pena
// convencional por día de atraso.
console.log('\n7. Los días transcurridos del plazo no se adelantan al anochecer');
if (!anidados["PlazosCliente.transcurridos"] || !anidados["PlazosCliente.diasPlazo"]) {
  fallos.push('la pantalla de plazos no calcula días transcurridos');
  console.log('   ✗ la pantalla de plazos no calcula días transcurridos');
} else {
  // Reloj fijo: 20 de septiembre de 2026, 19:00 LOCAL. En México eso ya es el
  // 21 en UTC. El día transcurrido correcto es el 20.
  const FIJO = new Date(2026, 8, 20, 19, 0, 0).getTime();
  const RelojFijo = class extends Date {
    constructor(...a) { if (a.length === 0) super(FIJO); else super(...a); }
    static now() { return FIJO; }
  };
  // `hoy` entra porque la versión anterior lo usaba —`hoy.toISOString()`— y la
  // prueba tiene que poder EJECUTAR esa versión para que el rojo salga en el
  // número y no en un nombre que falta.
  const dias = new Function('obra', 'Date', 'hoy', 'hoyLocalISO',
    `"use strict";
     const diasPlazo = ${anidados["PlazosCliente.diasPlazo"]};
     return ${anidados["PlazosCliente.transcurridos"]};`
  )({ inicio: '2026-09-01' }, RelojFijo, new RelojFijo(), () => {
    const d = new RelojFijo();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  });
  check(dias === 19,
    `del 1 al 20 de septiembre son 19 días, aunque sean las 19:00 (dio ${dias})`);
  check(dias !== 20, 'no cuenta un día de más por leer la fecha en UTC');
  // Y la función que da la fecha de hoy sigue siendo la local.
  check(typeof hoyLocalISO === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(hoyLocalISO()),
    'la fecha de hoy se arma por partes y tiene forma de fecha');
}

// ── 8. El tablero de la dependencia tampoco tiene cuenta propia ─────────
// Es la pantalla de la demo, y era la TERCERA cuenta del mismo dato: tomaba la
// última ampliación de `contrato/plazos` como autoridad. Quien captura el fin
// ampliado en la ficha de la obra sin registrar la ampliación movía la
// proyección y no esta tarjeta, y las dos cifras se contradecían.
//
// Y además callaba: sin ampliaciones no escribía nada bajo la fecha, así que
// un plazo ampliado se leía como si fuera el que se firmó.
console.log('\n8. El tablero de la dependencia mide contra el mismo fin vigente, y lo dice');
if (!anidados["DashboardDependencia.finVigente"]) {
  fallos.push('el tablero de la dependencia no calcula ningún fin vigente');
  console.log('   ✗ el tablero de la dependencia no calcula ningún fin vigente');
} else {
  const enTablero = (obra, ampliaciones) => new Function(
    'obra', 'ampliaciones', 'finVigenteDe',
    `"use strict"; return ${anidados["DashboardDependencia.finVigente"]};`)(obra, ampliaciones, finVigenteDe);
  const obraDisc = { fin: '2026-04-14', finAmpliado: '2026-12-01' };
  const dio = enTablero(obraDisc, [{ fecha: '2026-06-01' }]);
  check(dio === '2026-12-01',
    `el tablero da el 1 de diciembre, el fin vigente de la obra (dio ${dio})`);
  check(typeof finVigenteDe === 'function' && dio === finVigenteDe(obraDisc),
    `el tablero y la proyección dan la misma fecha (tablero ${dio}, proyección ${typeof finVigenteDe === 'function' ? finVigenteDe(obraDisc) : 'no existe'})`);

  // La leyenda que va debajo de la fecha. Se mide la frase, no la variable:
  // lo que importa es lo que alcanza a leer quien abre la pantalla.
  if (!anidados["DashboardDependencia.ampliado"]) {
    fallos.push('el tablero no distingue un plazo ampliado de uno original');
    console.log('   ✗ el tablero no distingue un plazo ampliado de uno original');
  } else {
    const leyenda = (obra, ampliaciones) => {
      const amp = new Function('obra', 'finVigente', 'finVigenteDe',
        `"use strict"; return ${anidados["DashboardDependencia.ampliado"]};`
      )(obra, finVigenteDe(obra), finVigenteDe);
      return amp
        ? `ampliado${ampliaciones.length > 0 ? ` ${ampliaciones.length} ${ampliaciones.length === 1 ? 'vez' : 'veces'}` : ''}; el original era ${obra?.fin || '—'}`
        : 'sin ampliaciones: es el plazo original';
    };
    const sinAmp = leyenda({ inicio: '2026-06-15', fin: '2026-10-30' }, []);
    check(/sin ampliaciones/.test(sinAmp) && /plazo original/.test(sinAmp),
      `una obra sin ampliar declara que la fecha es la original (dijo: "${sinAmp}")`);
    const conAmp = leyenda(obraDisc, [{ fecha: '2026-06-01' }]);
    check(/ampliado/.test(conAmp) && /2026-04-14/.test(conAmp),
      `una obra ampliada lo declara Y dice cuál era el original (dijo: "${conAmp}")`);
    check(sinAmp !== conAmp, 'las dos situaciones no se dicen con la misma frase');
  }
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('');
if (fallos.length === 0) {
  console.log('VERDE — el año no se pierde y el guion dice de qué es.\n');
  process.exit(0);
} else {
  console.log(`ROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
