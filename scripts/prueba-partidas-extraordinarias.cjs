#!/usr/bin/env node
// Guarda de fix/partidas-extraordinarias.
//
// EL DEFECTO, medido en producción el 2026-10-28 y no supuesto. La obra 0112
// —el malecón— tiene contrato de $25,849,801, su catálogo congelado suma
// exactamente lo mismo al peso, y lleva ejecutados $25,183,452: 97.42% de
// avance, con 6 de sus 14 partidas ya por encima del 100%. Los $666,349 que
// faltan para ejercer el contrato son obra que YA SE HIZO y que no tenía
// dónde teclearse, porque CAMPO no sabía registrar una partida que no venga
// del archivo del catálogo. El techo de esa obra no era el 100%: era el
// 97.42%, y nadie lo había dicho en voz alta.
//
// Lo que faltaba no era una cuenta nueva. Las veinte cuentas que importan ya
// suman sobre `subs` —`desgloseEjecutado`, `avanceFisicoPonderado`,
// `compensacionVolumenes`, el corte semanal, el PDF, el correo del lunes—.
// Faltaba el RENGLÓN. Por eso el diseño es: una extraordinaria es una partida
// más, con `extra: true`, MEZCLADA en memoria y SEPARADA en disco.
//
// Separada en disco porque `avance/subs` SE REESCRIBE ENTERO cada vez que
// alguien vuelve a subir el catálogo —el de la 0114 pesa ~1.4 MB con 335
// partidas—, y una extraordinaria guardada ahí desaparecería en la siguiente
// carga sin un solo error. Mezclada en memoria porque la alternativa era
// enhebrar un segundo arreglo por veinte sitios de cálculo, y el sitio
// veintiuno se queda atrás en silencio.
//
// Ese diseño tiene cuatro formas de romperse, y son las cuatro que se miden:
//
//   1. QUE NO CUENTE. La extraordinaria se guarda y el avance no se mueve.
//      Es el defecto original con pintura nueva.
//   2. QUE SE ESCONDA. La extraordinaria entra al árbol del catálogo y se
//      vuelve indistinguible de una partida contratada. Lo que se hizo fuera
//      de contrato tiene que verse fuera de contrato: la dependencia lo va a
//      pedir con su convenio.
//   3. QUE SE DUPLIQUE O SE PIERDA al partir en disco y volver a juntar.
//   4. QUE LA PANTALLA Y EL CORREO DEL LUNES DIGAN NÚMEROS DISTINTOS.
//      `calcularKpisObra` vive en functions/index.js, es otro despliegue y no
//      comparte build: la única forma de exigir que coincidan es correr las
//      dos y comparar. Es cómo nació el #30.
//
// Nada de esto se mide buscando frases en el archivo. El componente `Captura`
// se EXTRAE y se RENDERIZA, y `calcularKpisObra` se extrae y se EJECUTA sobre
// documentos de mentira. Se prueba la pantalla, no una copia mía de la
// pantalla.
//
// Uso:  node scripts/prueba-partidas-extraordinarias.cjs [App.jsx] [functions.js]
//
// Contraprueba: la corre sola al final, mutando los archivos reales. Cada
// mutación tiene que salir en ROJO (código 1) y no NO ARRANCÓ (código 2): un
// banco que revienta no comprueba nada.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const raiz = path.resolve(__dirname, '..');
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));
const { fuenteDe, SimboloPerdido } = require(path.join(raiz, 'scripts/extraer-de-app.cjs'));

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

// P7: el banco carga su propio insumo. Los argumentos existen para la
// contraprueba, que apunta a copias mutadas en /tmp.
const ARCH_APP = process.argv[2] ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
const ARCH_FN  = process.argv[3] ? path.resolve(process.argv[3]) : path.join(raiz, 'functions/index.js');

const fallos = [];
const check = (cond, m, detalle) => {
  const d = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${d}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${d}`); }
};
const casi = (a, b, tol = 0.01) => typeof a === 'number' && Math.abs(a - b) <= tol;
const MXN = v => (typeof v === 'number')
  ? '$' + Math.round(v).toLocaleString('en-US') : String(v);
const PCT = v => (typeof v === 'number') ? v.toFixed(2) + '%' : String(v);

// ── Extracción de src/App.jsx ───────────────────────────────────────────────
// `Captura` arrastra su cierre transitivo entero: los helpers del cálculo, el
// léxico, los componentes de UI. No se teclea una lista de dependencias —esa
// lista sería la segunda copia del grafo y se desincroniza—.
const PEDIDOS_APP = ['Captura', 'esExtraordinaria', 'soloCatalogo', 'soloExtraordinarias',
  'importeEjecutadoPartida', 'importeCatalogoPartida', 'desgloseEjecutado',
  'avanceFisicoPonderado'];

let cuerpoApp, presentesApp;
try {
  // `tolerante`: si falta un símbolo, la aserción que lo use sale ROJA en vez
  // de que el banco no arranque. Contra una versión vieja del archivo no
  // existen `soloCatalogo` ni los demás, y eso es precisamente lo que la
  // contraprueba tiene que poder enseñar en rojo.
  ({ cuerpo: cuerpoApp, presentes: presentesApp } =
    fuenteDe(ARCH_APP, PEDIDOS_APP, { tolerante: true }));
} catch (e) {
  noArranco(`no se pudo extraer de ${path.relative(raiz, ARCH_APP)} — ${e.message}`);
}
if (!presentesApp.includes('Captura')) {
  noArranco(`${path.relative(raiz, ARCH_APP)} no tiene la pantalla de Captura: no hay qué medir`);
}

// Lo que el motor pone y la app nombra. Todo lo que no es el objeto de la
// medición entra como pieza de mentira; el resto es el código real.
const nada = () => {};
const vacio = () => ({});
const DEL_ENTORNO = {
  React,
  CASO: {}, ErrorHistorialNomina: Error, ErrorSnapshot: Error,
  addDoc: async () => ({}), collection: vacio, conOrg: p => p,
  conReintentoDePermiso: async (f) => f(), construirRastro: vacio,
  deleteDoc: async () => {}, deleteObject: async () => {}, doc: vacio,
  encolarRastro: nada, getAuth: () => ({ currentUser: null }),
  getDoc: async () => ({ exists: () => false, data: vacio }),
  getDocs: async () => ({ docs: [] }), getDownloadURL: async () => 'x',
  getFirestore: vacio, getIdToken: async () => '',
  getIdTokenResult: async () => ({ claims: {} }),
  getStorage: vacio, initializeApp: vacio, orgIdSesion: () => 'fosmon',
  query: vacio, rutaAuditoria: () => 'auditoria', serverTimestamp: vacio,
  setDoc: async () => {}, storageRef: (_s, r) => ({ fullPath: r }),
  uploadString: async () => {},
  useCallback: React.useCallback, useEffect: React.useEffect,
  useMemo: React.useMemo, useRef: React.useRef, useState: React.useState,
  where: vacio, writeBatch: () => ({ set: nada, commit: async () => {} }),
};

let app;
try {
  const js = esbuild.transformSync(
    `${cuerpoApp}\n;return { ${presentesApp.join(', ')} };`, { loader: 'jsx' }).code;
  const nombres = Object.keys(DEL_ENTORNO);
  app = new Function(...nombres, `"use strict";\n${js}`)(...nombres.map(n => DEL_ENTORNO[n]));
} catch (e) {
  noArranco(`el código extraído de ${path.relative(raiz, ARCH_APP)} no se pudo armar — ${e.message}`);
}

// ── Extracción de functions/index.js ────────────────────────────────────────
// `calcularKpisObra` hace `admin.firestore()`. Se le da un `require` de
// mentira con los documentos del escenario: así se ejerce la función COMPLETA
// —la misma que llena el correo del lunes— y no una reescritura suya.
let cuerpoFn, presentesFn;
try {
  ({ cuerpo: cuerpoFn, presentes: presentesFn } =
    fuenteDe(ARCH_FN, ['calcularKpisObra'], { tolerante: true }));
} catch (e) {
  noArranco(`no se pudo extraer de ${path.relative(raiz, ARCH_FN)} — ${e.message}`);
}
const hayKpis = presentesFn.includes('calcularKpisObra');

function kpisDelCorreo(obraId, docs) {
  const requireFalso = (mod) => {
    if (mod !== 'firebase-admin') return require(mod);
    return { firestore: () => ({
      doc: (ruta) => ({ get: async () => ({
        exists: Object.prototype.hasOwnProperty.call(docs, ruta),
        data: () => docs[ruta],
      }) }),
    }) };
  };
  return new Function('require', `"use strict";\n${cuerpoFn}\n;return calcularKpisObra;`)
    (requireFalso)(obraId, null);
}

console.log(`\nApp:       ${path.relative(raiz, ARCH_APP)}`);
console.log(`Funciones: ${path.relative(raiz, ARCH_FN)}`);
console.log(`Extraídos: ${presentesApp.join(', ')}${hayKpis ? ', calcularKpisObra' : ''}`);
const faltanApp = PEDIDOS_APP.filter(n => !presentesApp.includes(n));
if (faltanApp.length) console.log(`!          en App.jsx NO existen: ${faltanApp.join(', ')}`);

// ── El escenario: el malecón en miniatura ───────────────────────────────────
// Mismos hechos que la 0112, con números redondos para que la cuenta se pueda
// seguir a mano. Contrato = Σ catálogo al peso, igual que en las cinco obras
// de producción. Una partida se pasó de su volumen, otra quedó corta, y la
// compensación deja la obra en 97.42% — el techo real.
//
//   A-01  110 de 100 ud × $60,000  →  ejecutado $6,600,000   (110 %)
//   A-02  78.55 de 100 ud × $40,000 → ejecutado $3,142,000   ( 79 %)
//                                      Σ ejecutado $9,742,000
const CONTRATO = 10_000_000;
const CATALOGO = [
  { id: 'A-01', sec: 'A-01', sub: 'Terracerías', imp: 6_000_000, cant: 100, pu: 60_000,
    unidad: 'M3', cantEjec: 110, ruta: [{ clave: 'A', desc: 'PRELIMINARES', nivel: 1 }], cat: 'A' },
  { id: 'A-02', sec: 'A-02', sub: 'Pavimento asfáltico', imp: 4_000_000, cant: 100, pu: 40_000,
    unidad: 'M2', cantEjec: 78.55, ruta: [{ clave: 'A', desc: 'PRELIMINARES', nivel: 1 }], cat: 'A' },
];
const EJEC_CATALOGO = 9_742_000;
const TECHO_SIN_EXTRA = 97.42;
const FALTANTE = CONTRATO - EJEC_CATALOGO;   // $258,000 de obra sin renglón

// La extraordinaria que cierra la obra: el muro que no estaba en el catálogo.
const EXTRA = {
  id: 'EXTRA__1', extra: true, sec: 'E-1', sub: 'Muro de contención no previsto',
  imp: FALTANTE, cant: 1, pu: FALTANTE, unidad: 'LOTE', cantEjec: 1,
  convenio: 'CONV-2026-03', autorizadoPor: 'SIOP', ruta: [], cat: null,
  creadoPor: 'residente@fosmon.mx', creadoEn: '2026-10-28T12:00:00.000Z',
};

const OBRA = { id: '0112', nombre: 'MALECON', contrato: 'SIOP-COATZA-0112',
               presupuesto: CONTRATO, modoAvance: 'volumen' };

// ── La pantalla ─────────────────────────────────────────────────────────────
const pinta = (subs, { rol = 'residente' } = {}) => renderToStaticMarkup(
  React.createElement(app.Captura, {
    subs, setSubs: nada, maquinaria: [], setMaquinaria: nada,
    materiales: [], setMateriales: nada, rol, obra: OBRA, forceTab: 'volumenes',
    usuario: { correo: 'residente@fosmon.mx', rol },
    historialAvance: [], setHistorialAvance: nada, setCambiosPendientes: nada,
    estimaciones: [], estCargadas: true, evid: null,
  }));
const texto = m => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function escenario(titulo, fn) {
  console.log(`\n${titulo}`);
  try { return fn(); }
  catch (e) {
    fallos.push(`${titulo} — ${e.message}`);
    console.log(`   ✗ el escenario reventó: ${e.message}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
escenario('1 · EL CASO DEL MALECÓN: sin el renglón, la obra tiene techo', () => {
  const solo = app.avanceFisicoPonderado(CATALOGO, CONTRATO, true);
  check(casi(solo, TECHO_SIN_EXTRA),
    `con el catálogo entero ejecutado hasta donde se pudo, la obra va al ${PCT(solo)}`,
    `${MXN(EJEC_CATALOGO)} de ${MXN(CONTRATO)}`);
  check(!casi(solo, 100),
    `y NO llega al 100%: faltan ${MXN(FALTANTE)} de contrato sin partida donde capturarlos`);

  const con = app.avanceFisicoPonderado([...CATALOGO, EXTRA], CONTRATO, true);
  check(casi(con, 100),
    `con la extraordinaria capturada la obra cierra en ${PCT(con)}`,
    `el muro de ${MXN(FALTANTE)} es obra hecha que ya cuenta`);

  // Y el avance sigue siendo el dinero ejercido entre el contrato: una sola
  // definición. Si la extraordinaria entrara por otra puerta, el KPI de dinero
  // y el de avance volverían a separarse.
  const ejec = app.desgloseEjecutado([...CATALOGO, EXTRA], true).total;
  check(casi(ejec, CONTRATO, 1),
    `el KPI de dinero da ${MXN(ejec)} — el contrato ejercido`);
  check(casi(con, (ejec / CONTRATO) * 100),
    'y el avance es exactamente ese dinero entre el contrato: una sola cuenta');
});

// ════════════════════════════════════════════════════════════════════════════
escenario('2 · El dinero NO se topa; el avance SÍ (P1, también con extraordinarias)', () => {
  // Catálogo ejercido al 100% y además una extraordinaria de $1,500,000.
  const completo = [
    { id: 'B-01', sec: 'B-01', sub: 'Obra contratada', imp: CONTRATO,
      cant: 100, pu: 100_000, cantEjec: 100 },
  ];
  const extraGorda = { ...EXTRA, id: 'EXTRA__2', imp: 1_500_000, cant: 1,
                       pu: 1_500_000, cantEjec: 1 };
  const d = app.desgloseEjecutado([...completo, extraGorda], true);
  check(casi(d?.total, 11_500_000, 1),
    `ejecutado ${MXN(d?.total)} contra un contrato de ${MXN(CONTRATO)} — el dinero no se topa`);
  const av = app.avanceFisicoPonderado([...completo, extraGorda], CONTRATO, true);
  check(casi(av, 100),
    `pero el avance físico se queda en ${PCT(av)}: una obra no avanza más que su contrato`);
  check(av <= 100 + 1e-9, 'y en ningún caso pasa de 100');
  // Una extraordinaria ejecutada POR ENCIMA de lo autorizado también se ve:
  // es sobreejecución de un convenio, y se cobra distinto.
  const sobre = { ...extraGorda, cantEjec: 2 };
  const ds = app.desgloseEjecutado([sobre], true);
  check(casi(ds?.excedente, 1_500_000, 1),
    `y lo ejecutado por encima del convenio sale aparte: ${MXN(ds?.excedente)}`);
});

// ════════════════════════════════════════════════════════════════════════════
escenario('3 · Mezcladas en memoria, separadas en disco — sin perder ni duplicar', () => {
  const todo = [...CATALOGO, EXTRA];

  check(app.esExtraordinaria(EXTRA) === true && app.esExtraordinaria(CATALOGO[0]) === false,
    'la marca distingue una extraordinaria de una partida del catálogo');
  // `extra: true` y nada más. Un truthy cualquiera marcando partidas sería la
  // puerta para que un campo heredado de otro import vuelva extraordinaria a
  // media obra.
  check(app.esExtraordinaria({ extra: 'sí' }) === false
     && app.esExtraordinaria({ extra: 1 }) === false
     && app.esExtraordinaria(undefined) === false,
    'y sólo `extra === true` la marca: ni un 1, ni una cadena, ni un hueco');

  const cat = app.soloCatalogo(todo);
  const ext = app.soloExtraordinarias(todo);
  check(cat.length === 2 && ext.length === 1,
    `al partir para disco: ${cat.length} al catálogo, ${ext.length} a extraordinarias`);
  check(cat.length + ext.length === todo.length
     && !cat.some(app.esExtraordinaria) && ext.every(app.esExtraordinaria),
    'la partición no pierde ni duplica ninguna partida');

  // El viaje completo: se parte, se guardan dos documentos, se vuelven a
  // juntar al cargar. El avance tiene que ser el mismo a los dos lados.
  const recargado = [...cat, ...ext.map(s => ({ ...s, extra: true }))];
  check(casi(app.avanceFisicoPonderado(recargado, CONTRATO, true),
             app.avanceFisicoPonderado(todo, CONTRATO, true)),
    'ida y vuelta por disco: el avance después de recargar es el mismo');

  // Y una obra SIN extraordinarias se comporta exactamente como antes: las
  // cinco de producción no se pueden mover un peso por este cambio.
  check(app.soloCatalogo(CATALOGO).length === CATALOGO.length
     && app.soloExtraordinarias(CATALOGO).length === 0,
    'una obra sin extraordinarias no cambia: el catálogo pasa entero y nada se parte');
});

// ════════════════════════════════════════════════════════════════════════════
escenario('4 · LA PANTALLA: se ve, y se ve FUERA del catálogo', () => {
  const markup = pinta([...CATALOGO, EXTRA]);
  const t = texto(markup);
  console.log(`       « ${t.slice(0, 260)} »`);

  check(/fuera de cat[áa]logo/i.test(t),
    'la pantalla las agrupa bajo un rótulo que dice que están fuera de catálogo');
  check(/1 extraordinaria\b/.test(t),
    'y dice cuántas hay', `«${(t.match(/\d+ extraordinaria\w*/) || ['—'])[0]}»`);
  check(t.includes(MXN(FALTANTE)),
    `y cuánto suman: ${MXN(FALTANTE)} — no se pueden esconder dentro del total`);

  // EL PUNTO 2 DEL PREÁMBULO. La categoría del catálogo tiene que seguir
  // diciendo DOS conceptos. Si dijera tres, la extraordinaria se metió al
  // árbol y ya es indistinguible de obra contratada.
  const conceptos = t.match(/(\d+) conceptos?/);
  check(conceptos && conceptos[1] === '2',
    'el árbol del catálogo sigue teniendo 2 conceptos: la extraordinaria no se coló',
    conceptos ? `la categoría dice «${conceptos[0]}»` : 'no se encontró el contador');
  const impCat = t.match(/\$10,000,000/);
  check(!!impCat,
    'y el importe de la categoría sigue siendo el del contrato, sin el convenio sumado');

  // Y no está DOS veces. Una extraordinaria no trae `ruta`, así que si la
  // dejan entrar al árbol no se mete dentro de la categoría —ahí el contador
  // de conceptos no se mueve y todo parece bien—: cae como hoja suelta en la
  // raíz Y vuelve a salir en su bloque. El residente vería el mismo muro dos
  // veces y tendría dos casillas donde capturarle avance al mismo concepto.
  const veces = (markup.match(/Muro de contenci[óo]n no previsto/g) || []).length;
  check(veces === 1,
    'la extraordinaria aparece UNA sola vez en la pantalla',
    `aparece ${veces} vez(ces)`);
  const iRotulo = t.search(/fuera de cat[áa]logo/i);
  const iMuro = t.search(/Muro de contenci[óo]n/);
  const iMuroEdit = markup.search(/Muro de contenci[óo]n/);
  const iRotuloEdit = markup.search(/FUERA DE CAT[ÁA]LOGO/i);
  check((iMuro === -1 || iMuro > iRotulo) && iMuroEdit > iRotuloEdit,
    'y siempre DESPUÉS del rótulo que la separa del catálogo, nunca antes');

  // El convenio viaja con ella: una extraordinaria sin oficio es cobro que la
  // dependencia rechaza, y es mejor verlo al capturarla que al estimarla.
  check(/CONV-2026-03/.test(markup),
    'el convenio que la autoriza se ve en el renglón');
  const sinConvenio = texto(pinta([...CATALOGO, { ...EXTRA, convenio: '' }]));
  check(/sin convenio capturado/i.test(sinConvenio),
    'y si no lo tiene, la pantalla lo dice en vez de callarlo');

  // Se puede dar de alta. Sin el botón no hay forma de arreglar el malecón.
  check(/agregar extraordinaria/i.test(t),
    'el residente tiene cómo agregar una');

  // Quien no edita no ve botones, pero SÍ ve las extraordinarias: ocultarle a
  // un auditor la obra que se hizo fuera de catálogo mientras se le enseña el
  // avance que ella produce es justo la media verdad que no se puede contar.
  const auditor = texto(pinta([...CATALOGO, EXTRA], { rol: 'auditor' }));
  check(/fuera de cat[áa]logo/i.test(auditor) && /Muro de contenci[óo]n/.test(auditor),
    'un rol de sólo lectura las ve, con su descripción');
  check(!/agregar extraordinaria/i.test(auditor),
    'pero no puede agregarlas');

  // Y una obra sin extraordinarias no se llena de ruido con cifras falsas.
  const limpia = texto(pinta(CATALOGO));
  check(/no hay partidas extraordinarias/i.test(limpia) && !/\$0\b/.test(limpia),
    'una obra sin ninguna lo dice en palabras, sin inventar un $0');
});

// ════════════════════════════════════════════════════════════════════════════
// El correo del lunes es asíncrono, así que el veredicto lo dispara él.
console.log('\n5 · EL CORREO DEL LUNES DICE EL MISMO NÚMERO QUE LA PANTALLA');
(async () => {
  if (!hayKpis) {
    check(false, `${path.relative(raiz, ARCH_FN)} no tiene calcularKpisObra: el correo no se puede medir`);
    return veredicto();
  }
  const docsDe = ({ subs, extras }) => {
    const d = {
      [`obras/0112/config/info`]: { presupuesto: CONTRATO, modoAvance: 'volumen', nombre: 'MALECON' },
      [`obras/0112/avance/subs`]: { data: subs },
    };
    if (extras) d[`obras/0112/avance/extraordinarias`] = { data: extras };
    return d;
  };

  for (const [etiqueta, extras, esperado] of [
    ['sin extraordinarias (las cinco obras de hoy)', null, TECHO_SIN_EXTRA],
    ['con el documento vacío', [], TECHO_SIN_EXTRA],
    ['con el muro del convenio', [EXTRA], 100],
  ]) {
    const enPantalla = app.avanceFisicoPonderado(
      [...CATALOGO, ...(extras || [])], CONTRATO, true);
    let enCorreo;
    try {
      const k = await kpisDelCorreo('0112', docsDe({ subs: CATALOGO, extras }));
      enCorreo = k?.avancePct;
    } catch (e) { enCorreo = `reventó: ${e.message}`; }
    check(casi(enPantalla, esperado) && casi(enCorreo, esperado),
      `${etiqueta}: pantalla ${PCT(enPantalla)} · correo ${PCT(enCorreo)}`,
      `esperado ${PCT(esperado)}`);
  }

  // El caso que NO se puede romper: una obra vieja no tiene el documento de
  // extraordinarias. Leerlo no debe cambiarle un peso ni hacer reventar el
  // cron de los lunes.
  try {
    const k = await kpisDelCorreo('0112', docsDe({ subs: CATALOGO, extras: null }));
    check(casi(k?.montoEjecutado ?? k?.ejecutado, EJEC_CATALOGO, 1)
       || casi(k?.avancePct, TECHO_SIN_EXTRA),
      'sin el documento, el cron corre igual que antes y no se cae',
      `avance ${PCT(k?.avancePct)}`);
  } catch (e) {
    check(false, 'sin el documento, el cron corre igual que antes y no se cae', e.message);
  }

  veredicto();
})().catch(e => {
  fallos.push(`escenario 5 — ${e.message}`);
  console.log(`   ✗ el escenario reventó: ${e.message}`);
  veredicto();
});

// ── Contraprueba ────────────────────────────────────────────────────────────
// Cada mutación rompe UNA semántica del diseño y tiene que salir ROJA (1).
// No se muta andamiaje: se muta la decisión.
const MUTACIONES = [
  ['las extraordinarias no cuentan para el avance de la pantalla',
    'app', s => s.replace(
      /const avanceFisicoPonderado = \(subs = \[\]/,
      'const avanceFisicoPonderado = (subs0 = [], contrato0 = 0, modoVol0 = false) => ' +
      'avanceFisicoPonderadoReal(soloCatalogo(subs0), contrato0, modoVol0);\n' +
      'const avanceFisicoPonderadoReal = (subs = []')],
  ['la extraordinaria se cuela en el árbol del catálogo',
    'app', s => s.replace(
      /const subsConImp = soloCatalogo\(subs\)\.filter/,
      'const subsConImp = subs.filter')],
  ['la pantalla ya no agrupa ni rotula el bloque fuera de catálogo',
    'app', s => s.replace(
      /const bloqueExtras = \(extras\.length > 0 \|\| editar\)/,
      'const bloqueExtras = false')],
  ['cualquier `extra` truthy marca la partida',
    'app', s => s.replace(
      /const esExtraordinaria = s => s\?\.extra === true;/,
      'const esExtraordinaria = s => !!s?.extra;')],
  ['la partición deja la extraordinaria también en el catálogo',
    'app', s => s.replace(
      /const soloCatalogo = \(subs = \[\]\) => \(subs \|\| \[\]\)\.filter\(s => !esExtraordinaria\(s\)\);/,
      'const soloCatalogo = (subs = []) => (subs || []);')],
  ['el correo del lunes no lee las extraordinarias',
    'fn', s => s.replace(
      /const subs = \[\.\.\.delCatalogo, \.\.\.extraordinarias\];/,
      'const subs = [...delCatalogo];')],
];

function contraprueba() {
  if (process.env.SIN_CONTRAPRUEBA) return 0;
  console.log('\n── CONTRAPRUEBA ───────────────────────────────────────────────');
  const srcApp = fs.readFileSync(ARCH_APP, 'utf8');
  const srcFn  = fs.readFileSync(ARCH_FN, 'utf8');
  let malas = 0;
  for (const [nombre, cual, mutar] of MUTACIONES) {
    const original = cual === 'app' ? srcApp : srcFn;
    const mutado = mutar(original);
    if (mutado === original) {
      console.log(`   ✗ «${nombre}»: la mutación no aplicó — la prueba no la vigila`);
      malas++; continue;
    }
    const ext = cual === 'app' ? 'jsx' : 'js';
    const tmp = path.join(os.tmpdir(),
      `contraprueba-extra-${Math.random().toString(36).slice(2)}.${ext}`);
    fs.writeFileSync(tmp, mutado);
    const args = cual === 'app' ? [__filename, tmp, ARCH_FN] : [__filename, ARCH_APP, tmp];
    const r = require('child_process').spawnSync(process.execPath, args,
      { encoding: 'utf8', env: { ...process.env, SIN_CONTRAPRUEBA: '1' } });
    fs.unlinkSync(tmp);
    if (r.status === 1) console.log(`   ✓ «${nombre}» → ROJO`);
    else {
      malas++;
      console.log(`   ✗ «${nombre}» → salió ${r.status} ` +
        `(${r.status === 0 ? 'VERDE: la prueba no lo detecta' : 'NO ARRANCÓ: el banco revienta'})`);
      if (r.status === 2) console.log((r.stdout || '').split('\n').slice(-6).join('\n'));
    }
  }
  return malas;
}

function veredicto() {
  const malas = contraprueba();
  const n = fallos.length;
  console.log('\n' + '─'.repeat(70));
  if (n === 0 && malas === 0) {
    console.log('TODO EN VERDE — el malecón ya tiene dónde teclear el muro, y cuenta.');
    process.exit(0);
  }
  if (n) { console.log(`${n} FALLA(S):`); fallos.forEach(f => console.log('  · ' + f)); }
  if (malas) console.log(`${malas} contraprueba(s) no sirven.`);
  process.exit(1);
}
