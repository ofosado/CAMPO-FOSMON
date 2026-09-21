#!/usr/bin/env node
// Guarda de fix/compensacion-volumenes.
//
// EL DEFECTO. El avance físico de una obra se calculaba topando PARTIDA POR
// PARTIDA: se sumaba min(ejecutado_partida, catálogo_partida) y se dividía
// entre el presupuesto. Eso ignora la COMPENSACIÓN DE VOLÚMENES, que es como
// se ejecuta de verdad una obra: unas partidas se pasan del volumen del
// catálogo, otras quedan cortas, y la obra cierra en el importe contratado.
// Topar por partida deja como pendiente un alcance que ya se compensó.
//
// Medido en producción el 2026-09-21: la 0112 marcaba 83.92% de avance con el
// contrato ejercido al 94.67%. Once puntos de obra que existen, están
// ejecutados y no aparecían en ninguna pantalla.
//
// Arrastraba dos cosas más:
//
//   · EL DENOMINADOR NO ESTABA DECIDIDO. De los 19 puntos que pedían el avance,
//     7 pasaban el contrato y 12 pasaban Σ catálogo. Nadie lo notó porque en
//     las 5 obras de producción Σ catálogo === contrato al peso. Es una
//     coincidencia, no una garantía: con el tope por partida daba exactamente
//     igual cuál de los dos se pasara, y por eso el código tenía las dos
//     formas mezcladas. Sin el tope, ya no da igual.
//
//   · EL CORREO Y LA PANTALLA DABAN NÚMEROS DISTINTOS. `calcularKpisObra` en
//     functions/index.js tenía su propia fórmula (Σ cantEjec×pu, sin tope y sin
//     caída a `a`) y reportaba la 0112 al 94.67% mientras la pantalla mostraba
//     83.92%. Los dos números estaban mal y por razones distintas.
//
// Esta prueba NO busca frases en el código: extrae por AST las funciones reales
// de src/App.jsx Y de functions/index.js y las EJECUTA sobre los mismos
// catálogos, comparando contra números calculados a mano. Es P3: se verifica
// que el comportamiento ocurre. Los dos archivos son dos despliegues distintos
// sin build compartido, así que la única forma de garantizar que coinciden es
// correr los dos y comparar.
//
// Lo que NO cubre: el render, el SVG, los snapshots que se escriben a
// Firestore (eso lo cubre prueba-series-sincronizadas.cjs por el lado de la
// frontera de esquema).
//
// Uso:  node scripts/prueba-avance-sobre-contrato.cjs [App.jsx] [functions.js]
//
// Los argumentos corren la prueba contra una versión anterior para comprobar
// que ahí falla — una prueba que nunca ha fallado no prueba nada:
//     git show main:src/App.jsx        > /tmp/antes.jsx
//     git show main:functions/index.js > /tmp/antes-functions.js
//     node scripts/prueba-avance-sobre-contrato.cjs /tmp/antes.jsx /tmp/antes-functions.js

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
const ARCH_FN = process.argv[3]
  ? path.resolve(process.argv[3]) : path.join(raiz, 'functions/index.js');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};
const casi = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;
const MXN = v => (typeof v === 'number')
  ? '$' + v.toLocaleString('es-MX', { maximumFractionDigits: 0 }) : String(v);
const PCT = v => (typeof v === 'number') ? v.toFixed(2) + '%' : String(v);

// ── Extracción del código real ─────────────────────────────────────────
// Se toman los helpers de nivel de módulo tal cual están escritos. Si alguno
// cambia, esta prueba usa la versión nueva: no hay copias del cálculo aquí.
function preludioDe(archivo, nombres) {
  const src = fs.readFileSync(archivo, 'utf8');
  const ast = parse(src, OPTS);
  const trozos = [];
  const vistos = new Set();
  traverse(ast, {
    VariableDeclaration(p) {
      if (p.parent.type !== 'Program') return;
      const d = p.node.declarations[0];
      if (d?.id?.type === 'Identifier' && nombres.includes(d.id.name)) {
        trozos.push(src.slice(p.node.start, p.node.end));
        vistos.add(d.id.name);
      }
    },
    FunctionDeclaration(p) {
      const n = p.node.id?.name;
      if (p.parent.type === 'Program' && nombres.includes(n)) {
        trozos.push(src.slice(p.node.start, p.node.end));
        vistos.add(n);
      }
    },
  });
  return { fuente: trozos.join('\n'), vistos, src, ast };
}

const NOMBRES_APP = ['importeEjecutadoPartida', 'importeCatalogoPartida', 'desgloseEjecutado',
                     'avanceFisicoPonderado', 'contratoDeSub', 'compensacionVolumenes',
                     'ESQUEMA_SNAPSHOT', 'ESQUEMA_DINERO', 'ESQUEMA_AVANCE'];

const APP = preludioDe(ARCH_APP, NOMBRES_APP);
const faltanApp = NOMBRES_APP.filter(n => !APP.vistos.has(n));
// Un nombre ausente no revienta la prueba: se expone como `undefined` y la
// aserción que lo use falla, que es lo correcto contra la versión vieja.
const app = new Function(`${APP.fuente}\n;return {${[...APP.vistos].join(',')}};`)();

// `calcularKpisObra` lee Firestore. Se le pasa un `admin` de mentira con los
// documentos del escenario: así se ejerce la función COMPLETA, la misma que
// llena el correo del lunes, no una reescritura suya.
const NOMBRES_FN = [...NOMBRES_APP, 'calcularKpisObra'];
const FN = preludioDe(ARCH_FN, NOMBRES_FN);
const adminFalso = (docs) => ({
  firestore: () => ({
    doc: (ruta) => ({
      get: async () => ({
        exists: Object.prototype.hasOwnProperty.call(docs, ruta),
        data: () => docs[ruta],
      }),
    }),
  }),
});
function kpisDelCorreo(obraId, docs) {
  const fabricar = new Function('admin',
    `${FN.fuente}\n;return calcularKpisObra;`);
  return fabricar(adminFalso(docs))(obraId, null);
}
// Documentos mínimos que `calcularKpisObra` espera para una obra.
const docsDe = (obraId, { presupuesto, modoAvance, subs }) => ({
  [`obras/${obraId}/config/info`]: { presupuesto, modoAvance, nombre: 'Obra de prueba' },
  [`obras/${obraId}/avance/subs`]: { data: subs },
});

// ── Catálogos ──────────────────────────────────────────────────────────
const CONTRATO = 10_000_000;

// El caso 0112, con números redondos. Una partida muy por encima de su volumen
// de catálogo y otra muy por debajo: exactamente la compensación.
//   A-01  630 de 100 unidades × $10,000  →  ejecutado $6,300,000  (630 %)
//   A-02  300 de 900 unidades × $10,000  →  ejecutado $3,000,000  ( 33 %)
//   Σ catálogo = $10,000,000 = contrato
const CAT_COMPENSADO = [
  { sec: 'A-01', imp: 1_000_000, cant: 100, pu: 10_000, cantEjec: 630 },
  { sec: 'A-02', imp: 9_000_000, cant: 900, pu: 10_000, cantEjec: 300 },
];
const EJEC_COMPENSADO = 9_300_000;
const AVANCE_NUEVO = 93.00;   // 9.3M / 10M — el contrato ejercido
const AVANCE_VIEJO = 40.00;   // min(6.3M,1M) + min(3M,9M) = 4M / 10M

// ── Las pruebas ────────────────────────────────────────────────────────
// Cada escenario se aísla: contra la versión vieja faltan funciones enteras y
// si una excepción cortara la corrida no se vería el resto de la divergencia,
// que es justo lo que la prueba tiene que enseñar.
function escenario(titulo, fn) {
  console.log(`\n${titulo}`);
  try { fn(); }
  catch (e) {
    fallos.push(`${titulo} — ${e.message}`);
    console.log(`   ✗ el escenario reventó: ${e.message}`);
  }
}

if (faltanApp.length) {
  console.log(`\n! en ${path.basename(ARCH_APP)} no existen: ${faltanApp.join(', ')}`);
}

escenario('1. EL CASO QUE IMPORTA: el avance es el contrato ejercido', () => {
  console.log(`   Obra de ${MXN(CONTRATO)} con una partida al 630% y otra al 33%.`);
  console.log(`   Ejecutado ${MXN(EJEC_COMPENSADO)} → ${PCT(AVANCE_NUEVO)} del contrato.`);
  const av = app.avanceFisicoPonderado(CAT_COMPENSADO, CONTRATO, true);
  check(casi(av, AVANCE_NUEVO),
    `avance físico ${PCT(av)} (esperado ${PCT(AVANCE_NUEVO)})`);
  check(!casi(av, AVANCE_VIEJO),
    `y NO el ${PCT(AVANCE_VIEJO)} de topar partida por partida, que esconde volumen ya ejecutado`);

  // El avance y el dinero salen de la MISMA función: si no, vuelven a
  // separarse en cuanto una de las dos cambie.
  const ejec = app.desgloseEjecutado(CAT_COMPENSADO, true).total;
  check(casi(ejec, EJEC_COMPENSADO, 1),
    `el KPI de dinero da ${MXN(ejec)}`);
  check(casi(av, (ejec / CONTRATO) * 100),
    'y el avance es exactamente ese dinero entre el contrato — una sola definición');

  // El trío que sustituye al "sobre catálogo · pendiente de clasificar".
  const porEjecutar = Math.max(CONTRATO - ejec, 0);
  check(casi(porEjecutar, 700_000, 1),
    `por ejecutar ${MXN(porEjecutar)} = contrato − ejecutado`);
});

escenario('2. Compensación de volúmenes: cuántas se pasaron y cuántas quedaron cortas', () => {
  const c = app.compensacionVolumenes(CAT_COMPENSADO, true);
  check(c?.partidas === 2 && c?.excedidas === 1 && c?.cortas === 1 && c?.completas === 0,
    `2 partidas: 1 excedida, 1 corta, 0 completas (${c?.excedidas}/${c?.cortas}/${c?.completas})`);
  check(casi(c?.montoExcedente, 5_300_000, 1),
    `excedente ${MXN(c?.montoExcedente)} de la partida que se pasó`);
  check(casi(c?.montoFaltante, 6_000_000, 1),
    `faltante ${MXN(c?.montoFaltante)} de la que quedó corta`);
  // Invariante: con Σ catálogo = contrato, el neto ES lo que falta por
  // ejecutar, con el signo cambiado. Si el neto dejara de cuadrar con el KPI
  // la pantalla estaría contando dos historias distintas del mismo catálogo.
  check(casi(c?.neto, -700_000, 1),
    `neto ${MXN(c?.neto)} — lo mismo que queda por ejecutar, en negativo`);

  // Una obra que se compensó SOLA: se pasó tanto como se quedó corta.
  const parejo = [
    { sec: 'B-01', imp: 5_000_000, cant: 100, pu: 50_000, cantEjec: 140 },
    { sec: 'B-02', imp: 5_000_000, cant: 100, pu: 50_000, cantEjec: 60 },
  ];
  const cp = app.compensacionVolumenes(parejo, true);
  check(casi(cp?.neto, 0, 1),
    `obra compensada: neto ${MXN(cp?.neto)} con una partida al 140% y otra al 60%`);
  check(casi(app.avanceFisicoPonderado(parejo, CONTRATO, true), 100),
    'y su avance es 100%: el alcance del contrato está ejecutado completo');
});

escenario('3. El tope va AL TOTAL, no por partida — y el dinero no se topa (P1)', () => {
  // Ejecutado $13,000,000 sobre un contrato de $10,000,000.
  const sobreContrato = [
    { sec: 'C-01', imp: 5_000_000, cant: 100, pu: 50_000, cantEjec: 200 },
    { sec: 'C-02', imp: 5_000_000, cant: 100, pu: 50_000, cantEjec: 60 },
  ];
  const av = app.avanceFisicoPonderado(sobreContrato, CONTRATO, true);
  check(casi(av, 100),
    `el avance se topa en ${PCT(av)}: la obra no puede avanzar más de su contrato`);
  check(av <= 100 + 1e-9, 'y en ningún caso pasa de 100');

  const d = app.desgloseEjecutado(sobreContrato, true);
  check(casi(d?.total, 13_000_000, 1),
    `pero el dinero NO se topa: ${MXN(d?.total)} contra un contrato de ${MXN(CONTRATO)}`);
  // Dos excesos distintos que es fácil confundir:
  //   `excedente` del desglose = sobreejecución PARTIDA POR PARTIDA. Aquí
  //     C-01 ejecutó $10M contra $5M de catálogo → $5,000,000. C-02 quedó
  //     corta y no aporta. Es lo que se muestra en el detalle de partida.
  //   sobre contrato = total − contrato = $3,000,000. Es lo que hay que
  //     convenir. Los $2M de diferencia son justo lo que C-02 dejó de
  //     ejecutar: la compensación.
  check(casi(d?.excedente, 5_000_000, 1),
    `el excedente por partida es ${MXN(d?.excedente)} — lo que se pasó C-01 de su catálogo`);
  check(casi(d?.total - CONTRATO, 3_000_000, 1),
    `y sobre el CONTRATO sólo hay ${MXN(d?.total - CONTRATO)}, porque C-02 compensó $2,000,000`);
  check(d?.excedente > d?.total - CONTRATO,
    'los dos excesos no son el mismo número: cobrar el de partida sería cobrar de más');
});

escenario('4. El denominador es el CONTRATO, no lo que sume el catálogo', () => {
  // Catálogo incompleto: sólo se capturaron $8,000,000 de un contrato de $10M,
  // y está ejecutado entero. La obra va al 80%, no al 100%: lo que falta de
  // catálogo es alcance contratado que nadie ha capturado todavía.
  const catCorto = [
    { sec: 'D-01', imp: 8_000_000, cant: 100, pu: 80_000, cantEjec: 100 },
  ];
  const av = app.avanceFisicoPonderado(catCorto, CONTRATO, true);
  check(casi(av, 80),
    `avance ${PCT(av)} sobre el contrato (esperado 80.00%)`);
  check(!casi(av, 100),
    'y NO el 100% que da dividir entre Σ catálogo, que declararía terminada una obra a la que le falta alcance por capturar');
});

escenario('5. Las obras en modo porcentaje no se mueven (0114, 0126)', () => {
  // Sin volumen capturado el avance se lee de `a`, que nunca pasa de 100 por
  // partida: no hay nada que compensar y el número tiene que ser el de antes.
  const catPct = [
    { sec: 'E-01', imp: 4_000_000, a: 50 },
    { sec: 'E-02', imp: 6_000_000, a: 25 },
  ];
  const av = app.avanceFisicoPonderado(catPct, CONTRATO, false);
  check(casi(av, 35),
    `avance ${PCT(av)} — igual que con la fórmula anterior, que aquí daba lo mismo`);
  const c = app.compensacionVolumenes(catPct, false);
  check(c?.excedidas === 0 && casi(c?.montoExcedente, 0, 1),
    'y no hay ninguna partida excedida: en modo porcentaje no se puede sobreejecutar');
});

console.log('\n6. El correo del lunes y la pantalla dan el MISMO número');
{
  // Sólo las cuatro del cálculo tienen que estar duplicadas en functions/: las
  // constantes de esquema son de la pantalla, el correo no dibuja series.
  const CALCULO = ['importeEjecutadoPartida', 'importeCatalogoPartida',
                   'desgloseEjecutado', 'avanceFisicoPonderado'];
  const faltanFn = CALCULO.filter(n => !FN.vistos.has(n));
  if (faltanFn.length) {
    console.log(`   ! en ${path.basename(ARCH_FN)} no existen: ${faltanFn.join(', ')}`);
  }

  const casos = [
    ['compensada (el caso 0112)', 'volumen', CAT_COMPENSADO, AVANCE_NUEVO],
    ['sobre contrato', 'volumen', [
      { sec: 'C-01', imp: 5_000_000, cant: 100, pu: 50_000, cantEjec: 200 },
      { sec: 'C-02', imp: 5_000_000, cant: 100, pu: 50_000, cantEjec: 60 },
    ], 100],
    // El caso que divergía en silencio: obra en modo volumen con el avance
    // capturado en PORCENTAJE y sin `cantEjec`. La app caía a (a/100)×imp; el
    // correo sumaba cantEjec×pu y reportaba la obra en ceros.
    ['volumen sin cantEjec, avance capturado en %', 'volumen', [
      { sec: 'F-01', imp: 2_000_000, cant: 100, pu: 20_000, cantEjec: 0, a: 50 },
    ], 10],
    ['modo porcentaje', 'porcentaje', [
      { sec: 'E-01', imp: 4_000_000, a: 50 },
      { sec: 'E-02', imp: 6_000_000, a: 25 },
    ], 35],
  ];

  (async () => {
    for (const [etiqueta, modo, subs, esperado] of casos) {
      const pantalla = app.avanceFisicoPonderado(subs, CONTRATO, modo === 'volumen');
      let correo;
      try {
        const k = await kpisDelCorreo('0199', docsDe('0199', {
          presupuesto: CONTRATO, modoAvance: modo, subs,
        }));
        correo = k?.avancePct;
      } catch (e) {
        correo = `reventó: ${e.message}`;
      }
      check(casi(pantalla, esperado) && casi(correo, esperado),
        `${etiqueta}: pantalla ${PCT(pantalla)} · correo ${PCT(correo)} (esperado ${PCT(esperado)})`);
    }
    cerrar();
  })().catch(e => {
    fallos.push(`escenario 6 — ${e.message}`);
    console.log(`   ✗ el escenario reventó: ${e.message}`);
    cerrar();
  });
}

// ── Resultado ──────────────────────────────────────────────────────────
// El escenario 6 es asíncrono, así que el cierre lo dispara él y no el final
// del archivo.
function cerrar() {
  console.log('\n' + '─'.repeat(70));
  if (fallos.length === 0) {
    console.log('TODO EN VERDE — el avance es el contrato ejercido, y el correo lo confirma.');
    process.exit(0);
  }
  console.log(`${fallos.length} FALLA(S):`);
  fallos.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
