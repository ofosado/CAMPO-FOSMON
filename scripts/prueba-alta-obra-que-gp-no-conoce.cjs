#!/usr/bin/env node
// Dar de alta una obra que GP no conoce, sin mentir sobre su dinero.
//
// QUÉ SE AFIRMA. Dos cosas, y la segunda es la que importa:
//
//   1. Que la obra recién contratada SE PUEDA dar de alta. El catálogo de GP se
//      arma de los cheques, así que una obra que no ha pagado nada no está en
//      él y el paso 1 del alta no la ofrece. La salida es teclear su clave, y
//      la clave tiene que pasar la MISMA regla que usa el servidor: si no, la
//      obra entra a CAMPO y el gasto no se le pega nunca.
//   2. Que mientras GP no tenga nada de ella, la pantalla NO afirme un margen.
//      Sin gasto, el margen de una obra sale cerca del 100%, y ése es el número
//      más peligroso del tablero: se lee como una obra extraordinaria.
//
// POR QUÉ EXISTE. El hueco se cierra con un formulario, y un formulario es la
// parte fácil. Lo difícil es que el alta CREA un estado nuevo que antes no
// existía: una obra de CAMPO que el documento de gasto no conoce. Hasta hoy
// `resolverGastoGP` devolvía un número para ese caso —0— y el tablero no tenía
// forma de distinguir «GP contestó y no hay cheques» (gasto 0 de verdad) de
// «nadie le ha preguntado a GP por esta obra» (no se sabe). Las dos cosas se
// veían igual en pantalla: margen ~100%.
//
// La asimetría que lo permite distinguir YA estaba en producción y no se
// estaba usando: el job publica `obrasPedidas` con TODAS las claves que pidió,
// y `obras` sólo con las que devolvieron renglones. Una clave que está en
// `obrasPedidas` y no en `obras` es un cero medido. Una que no está en ninguna
// de las dos es una obra que se dio de alta después de la última corrida.
//
// NO SE INVENTA NINGÚN DATO NUEVO para este banco: se ejercita esa asimetría.
//
// Uso:  node scripts/prueba-alta-obra-que-gp-no-conoce.cjs
//
// CONTRAPRUEBA, comprobada, devolviendo cada defecto uno por uno y corriendo
// este mismo banco:
//
//   · `validarClaveGPManual` aceptando cualquier cosa con dígitos  → 27 rojas, salida 1
//   · `validarClaveGPManual` rellenando los ceros por su cuenta    →  9 rojas, salida 1
//   · una clave que ya está en el catálogo, dada de alta otra vez  →  3 rojas, salida 1
//   · `estadoGastoGP` diciendo `medido` cuando la clave no se pidió →  3 rojas, salida 1
//   · «no se puede saber» tratado como un cero medido              →  1 roja,  salida 1
//   · el KPI dejando de arrastrar el veredicto, sólo la cifra      →  2 rojas, salida 1
//   · el renglón pintando el % de margen aunque no haya gasto      →  1 roja,  salida 1
//   · el renglón pintando el importe absoluto de un margen sin medir → 2 rojas, salida 1
//   · el color de «sin medir» siendo el del margen aparente        →  3 rojas, salida 1
//   · el bloque móvil volviendo a decidir el color por su cuenta   →  8 rojas, salida 1
//   · el orden por margen colocando la sin medir entre las medidas →  1 roja,  salida 1
//   · el consolidado callando que le falta el gasto de una obra    →  3 rojas, salida 1
//
// Sobre el archivo bueno: 114 en verde, 0 en rojo, salida 0.
//
// La más importante es la novena: con el color del nivel, una obra sin su gasto
// se pinta VERDE —el verde de un 98% de margen— y es exactamente el estado que
// este trabajo crea. Es la que hay que cuidar que siga en rojo.

'use strict';

const fs = require('fs');
const path = require('path');
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion, vigilarExcepciones } = noArranco;

const RAIZ = path.resolve(__dirname, '..');
const APP = path.join(RAIZ, 'src/App.jsx');
const FUNCIONES = path.join(RAIZ, 'functions/index.js');

vigilarExcepciones('src/App.jsx', 'functions/index.js');

const { deApp, SimboloPerdido } = require('./extraer-de-app.cjs');

let validarClaveGPManual, estadoGastoGP, resolverGastoGP, nivelMargen, MXN, NUM, C;
try {
  ({ validarClaveGPManual, estadoGastoGP, resolverGastoGP, nivelMargen, MXN, NUM, C } =
    deApp('validarClaveGPManual', 'estadoGastoGP', 'resolverGastoGP',
          'nivelMargen', 'MXN', 'NUM', 'C'));
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}

// ── utilería de reporte ────────────────────────────────────────────────────
let fallas = 0;
const ok = (texto) => console.log('   ok    ' + texto);
const mal = (texto, detalle) => {
  fallas++;
  console.log('   FALLA ' + texto);
  if (detalle) for (const d of [].concat(detalle)) console.log('         ' + d);
};
const exigir = (cond, texto, detalle) => cond ? ok(texto) : mal(texto, detalle);
const seccion = (t) => console.log('\n' + t);

// Los avisos de consola se recogen en vez de imprimirse. Dos razones: no
// ensucian el informe, y así se puede EXIGIR que el aviso exista — la consola
// es por donde alguien diagnostica una obra con el gasto sin medir, y un aviso
// que se borró no se nota en ninguna pantalla.
const avisos = [];
console.warn = (...a) => { avisos.push(a.map(String).join(' ')); };
const ultimoAviso = () => avisos.length ? avisos[avisos.length - 1] : '';

const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const srcApp = fs.readFileSync(APP, 'utf8');
const astApp = parse(srcApp, { sourceType: 'module', plugins: ['jsx'] });

// ════════════════════════════════════════════════════════════════════════════
seccion('1. LA CLAVE QUE EL FORMULARIO ACEPTA ES LA QUE EL SERVIDOR SABE PEDIR');
// ════════════════════════════════════════════════════════════════════════════
// Esto no es validación cosmética. `clavesGPdeCAMPO` —el job que le pregunta a
// GP cuánto se ha gastado— sólo toma una clave si cumple `/^\d{4}$/`; cualquier
// otra forma manda la obra al montón de `sinClave` y entonces NADIE le va a
// preguntar nunca por ella. Una obra así entra a CAMPO, se ve bien, y su gasto
// se queda en blanco para siempre sin un solo error.
//
// Así que no se afirma «el regex es éste»: se CORRE el job del servidor sobre
// la obra que el formulario habría creado, y se exige que la pida.
// Se saca SOLO el cuerpo de la función, no su cierre de dependencias: el
// cierre arrastraría el `admin` de verdad —el que habla con Firestore— y aquí
// hace falta sustituirlo por uno que devuelva los documentos de la prueba.
const srcFn = fs.readFileSync(FUNCIONES, 'utf8');
let cuerpoFn = null;
traverse(parse(srcFn, { sourceType: 'module', plugins: ['jsx'] }), {
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'clavesGPdeCAMPO') return;
    cuerpoFn = srcFn.slice(p.node.start, p.node.end);
  },
});
if (!cuerpoFn) noArranco(['clavesGPdeCAMPO'], 'functions/index.js');
const correrClavesDeCAMPO = (docs) => {
  const admin = { firestore: () => ({
    collection: (c) => {
      if (c !== 'obras') throw new Error(`el job leyó la colección ${c}, no obras`);
      return { get: async () => ({ docs }) };
    },
  }) };
  const fn = new Function('admin', `"use strict";\n${cuerpoFn}\nreturn clavesGPdeCAMPO;`)(admin);
  return fn();
};
// El documento que el alta escribe: `obras/{clave}` con `gpId` = la clave.
// Es lo que hace `altaManual` en el modal, y es lo único que el job ve.
const docDeAlta = (clave, nombre = 'OBRA RECIEN CONTRATADA') =>
  ({ id: clave, data: () => ({ gpId: clave, nombre, gastoGP: 0 }) });

const CASOS_CLAVE = [
  // [lo que se teclea, se acepta?, motivo esperado]
  ['0127',   true,  null],
  ['0001',   true,  null],
  ['9999',   true,  null],
  ['',       false, 'vacia'],
  ['   ',    false, 'vacia'],
  ['127',    false, 'formato'],
  ['27',     false, 'formato'],
  ['01270',  false, 'formato'],
  ['012a',   false, 'formato'],
  ['GP0127', false, 'formato'],
  ['01 27',  false, 'formato'],
  ['12.7',   false, 'formato'],
  ['-127',   false, 'formato'],
  [null,     false, 'vacia'],
  [undefined,false, 'vacia'],
];

(async () => {
  for (const [entrada, aceptaEsperado, motivoEsperado] of CASOS_CLAVE) {
    const ver = validarClaveGPManual(entrada, []);
    exigir(ver.ok === aceptaEsperado,
      `«${String(entrada)}» → ${aceptaEsperado ? 'se acepta' : 'se rechaza'}`,
      [`el formulario dijo ok=${ver.ok} motivo=${ver.motivo}`]);
    if (!aceptaEsperado) {
      exigir(ver.motivo === motivoEsperado,
        `  y el motivo es «${motivoEsperado}», que es lo que decide qué se le pide al usuario`,
        [`dijo ${JSON.stringify(ver.motivo)}`]);
      exigir(typeof ver.mensaje === 'string' && ver.mensaje.length > 10,
        '  y trae un mensaje que dice qué hacer');
    }
  }
  // Y ahora lo de fondo: las que se aceptan, el servidor las pide; las que se
  // rechazan por formato, si se colaran, el servidor NO las pediría.
  seccion('   la regla del formulario y la del servidor son la misma regla');
  const aceptadas = CASOS_CLAVE.filter(c => c[1]).map(c => c[0]);
  const rechazadasPorFormato = CASOS_CLAVE
    .filter(c => !c[1] && c[2] === 'formato' && typeof c[0] === 'string' && c[0].trim())
    .map(c => c[0].trim());
  if (aceptadas.length === 0 || rechazadasPorFormato.length === 0) {
    sinPrecondicion('los casos de clave',
      ['Hacen falta claves aceptadas Y rechazadas por formato para comparar',
       'las dos reglas; con sólo unas o sólo otras la comparación no distingue.']);
  }
  {
    const r = await correrClavesDeCAMPO(aceptadas.map(cl => docDeAlta(cl)));
    exigir(r.claves.join('|') === [...aceptadas].sort().join('|'),
      `el job pide las ${aceptadas.length} claves que el formulario aceptó`,
      [`pidió ${r.claves.join(' ')}`, `aceptadas ${[...aceptadas].sort().join(' ')}`]);
    exigir(r.sinClave.length === 0,
      'y ninguna se le queda sin clasificar',
      r.sinClave.map(s => `${s.obraId} quedó sin clave: su gasto no se mediría nunca`));
  }
  {
    const r = await correrClavesDeCAMPO(rechazadasPorFormato.map(cl => docDeAlta(cl)));
    exigir(r.claves.length === 0,
      `ninguna de las ${rechazadasPorFormato.length} claves que el formulario rechaza la sabría pedir el servidor`,
      [`el servidor pediría ${r.claves.join(' ')}`]);
    exigir(r.sinClave.length === rechazadasPorFormato.length,
      'todas caerían en `sinClave`, que es el estado del que no se vuelve',
      [`cayeron ${r.sinClave.length} de ${rechazadasPorFormato.length}`]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  seccion('2. LA CLAVE A MANO NO SE ADIVINA NI PISA AL CATÁLOGO');
  // ══════════════════════════════════════════════════════════════════════════
  // Rellenar «127» a «0127» por nuestra cuenta sería decidir de qué obra se
  // trata. Se sugiere y lo confirma una persona.
  {
    const ver = validarClaveGPManual('127', []);
    exigir(ver.ok === false && ver.sugerencia === '0127',
      '«127» no se acepta sola, pero se sugiere «0127» para no pelear con el usuario',
      [`ok=${ver.ok} sugerencia=${JSON.stringify(ver.sugerencia)}`]);
    exigir(validarClaveGPManual(ver.sugerencia, []).ok === true,
      'y la sugerencia, confirmada, sí se acepta');
    exigir(/127/.test(String(ver.mensaje || '')) && /0127/.test(String(ver.mensaje || '')),
      'y el mensaje enseña la forma que se propone, no sólo que está mal',
      [`dijo ${JSON.stringify(ver.mensaje)}`]);
  }
  for (const basura of ['012a', 'GP0127', '01270']) {
    exigir(validarClaveGPManual(basura, []).sugerencia == null,
      `«${basura}» no produce una sugerencia inventada`,
      [`sugirió ${JSON.stringify(validarClaveGPManual(basura, []).sugerencia)}`]);
  }
  // Una clave que SÍ está en el catálogo se devuelve a la lista: de ahí sale con
  // el nombre con el que la contabilidad la llama hoy, y teclearlo a mano sería
  // una segunda grafía de la misma obra.
  {
    const catalogo = [
      { id: '0121', nombre: 'SIOP Coatza Rehab. Av. Universidad', ultimoCheque: '2026-10-30' },
      { id: '0112', nombre: 'SIOP Coatza Malecón', ultimoCheque: '2026-10-28' },
    ];
    const ver = validarClaveGPManual('0121', catalogo);
    exigir(ver.ok === false && ver.motivo === 'ya-en-catalogo',
      'una clave que ya está en el catálogo no se da de alta a mano',
      [`ok=${ver.ok} motivo=${ver.motivo}`]);
    exigir(ver.obra && ver.obra.id === '0121',
      'y se devuelve la obra encontrada, para poder llevar al usuario a ella');
    exigir(String(ver.mensaje || '').includes('SIOP Coatza Rehab. Av. Universidad'),
      'y el mensaje la nombra, para que se reconozca que es la misma',
      [`dijo ${JSON.stringify(ver.mensaje)}`]);
    exigir(validarClaveGPManual('0128', catalogo).ok === true,
      'una clave que NO está en el catálogo sí se acepta — que es el caso de este banco');
    // Robustez del insumo: el catálogo puede no haber cargado.
    for (const [etiqueta, cat] of [['nulo', null], ['sin cargar', undefined],
                                   ['vacío', []], ['con huecos', [null, undefined, { id: '0128' }]]]) {
      const v = validarClaveGPManual('0127', cat);
      exigir(v.ok === true, `con el catálogo ${etiqueta}, la clave buena se sigue aceptando`,
        [`dijo ${JSON.stringify(v)}`]);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  seccion('3. UNA OBRA QUE EL GASTO NO CONOCE NO TIENE GASTO 0: NO TIENE GASTO');
  // ══════════════════════════════════════════════════════════════════════════
  // Los tres estados, con la asimetría real del documento: `obrasPedidas` trae
  // todas las claves que el job pidió, `obras` sólo las que contestaron con
  // renglones.
  const OBRA_NUEVA = { id: '0128', gpId: '0128', nombre: 'OBRA RECIEN CONTRATADA' };
  const OBRA_VIEJA = { id: '0112', gpId: '0112', nombre: 'SIOP COATZA MALECON' };
  const gastoDe = (clave, total) => ({ [`${clave} ALGO`]: { id: clave, grandTotal: total } });

  // a) recién dada de alta: el job todavía no la ha pedido.
  {
    const gpData = { obrasPedidas: ['0112'], obras: gastoDe('0112', 4004156) };
    const antes = avisos.length;
    const e = estadoGastoGP(OBRA_NUEVA, gpData);
    exigir(e.medido === false && e.motivo === 'no-pedida',
      'dada de alta después de la última corrida → no medido, y se sabe por qué',
      [`dijo medido=${e.medido} motivo=${e.motivo} valor=${e.valor}`]);
    exigir(avisos.length > antes && /SIN MEDIR/.test(ultimoAviso()),
      'y queda un aviso en consola: es por donde se diagnostica',
      [`avisos nuevos ${avisos.length - antes}`, `último: ${JSON.stringify(ultimoAviso())}`]);
    exigir(/0128/.test(ultimoAviso()),
      'y el aviso nombra la clave, no obliga a adivinar qué obra es',
      [`dijo ${JSON.stringify(ultimoAviso())}`]);
    exigir(e.valor === 0,
      'el valor es 0 porque el campo es numérico, pero `medido:false` es lo que manda');
    // Y la obra que sí se pidió sigue leyendo lo suyo: el corte no se llevó el camino bueno.
    const v = estadoGastoGP(OBRA_VIEJA, gpData);
    exigir(v.medido === true && v.valor === 4004156,
      'y la obra que el job sí pidió lee su gasto, sin cambios',
      [`dijo medido=${v.medido} valor=${v.valor}`]);
  }
  // b) ya se pidió y GP no tiene cheques: ahí el cero SÍ es una medición.
  {
    const gpData = { obrasPedidas: ['0112', '0128'], obras: gastoDe('0112', 4004156) };
    const e = estadoGastoGP(OBRA_NUEVA, gpData);
    exigir(e.medido === true && e.motivo === 'sin-cheques' && e.valor === 0,
      'pedida y sin cheques → gasto 0 MEDIDO: eso sí se puede afirmar',
      [`dijo medido=${e.medido} motivo=${e.motivo} valor=${e.valor}`]);
  }
  // c) ya tiene cheques: el gasto normal.
  {
    const gpData = { obrasPedidas: ['0112', '0128'],
      obras: { ...gastoDe('0112', 4004156), ...gastoDe('0128', 250000) } };
    const e = estadoGastoGP(OBRA_NUEVA, gpData);
    exigir(e.medido === true && e.valor === 250000,
      'con cheques → el gasto de la obra, medido',
      [`dijo medido=${e.medido} valor=${e.valor}`]);
  }
  // d) `obrasPedidas` ausente (documento viejo): no se puede saber, y no se finge.
  {
    const gpData = { obras: gastoDe('0112', 4004156) };
    const e = estadoGastoGP(OBRA_NUEVA, gpData);
    exigir(e.medido === false && e.motivo === 'no-se-puede-saber',
      'sin `obrasPedidas` en el documento, no se puede saber — y se dice, no se supone',
      [`dijo medido=${e.medido} motivo=${e.motivo}`]);
  }
  // e) sin documento de gasto: tampoco es un cero.
  {
    const e = estadoGastoGP(OBRA_NUEVA, null);
    exigir(e.medido === false && e.motivo === 'sin-documento',
      'sin documento de gasto, no medido');
  }
  // f) la obra nueva NO hereda el gasto de otra parecida. Es el defecto que ya
  //    pasó una vez (la 0129 con los $19.9M de la 0121) y lo que lo evita es
  //    que la clave corte antes del difuso por nombre.
  {
    const gpData = { obrasPedidas: ['0121'],
      obras: { 'OBRA RECIEN CONTRATADA PENTAGONO': { id: '0121', grandTotal: 19900000 } } };
    const e = estadoGastoGP(OBRA_NUEVA, gpData);
    exigir(e.valor !== 19900000 && e.medido === false,
      'con un nombre parecido al de una obra con dinero, no hereda su cifra',
      [`dijo medido=${e.medido} valor=${e.valor}`]);
  }
  // g) `resolverGastoGP` sigue siendo el acceso al número, y es el MISMO número.
  //    Una cuenta por número: si se separaran, la pantalla y el KPI discreparían.
  {
    const casos = [
      { obrasPedidas: ['0112'], obras: gastoDe('0112', 4004156) },
      { obrasPedidas: ['0112', '0128'], obras: gastoDe('0112', 4004156) },
      { obrasPedidas: ['0128'], obras: gastoDe('0128', 250000) },
      { obras: gastoDe('0112', 1) },
      null,
    ];
    const discrepan = casos.filter(g =>
      resolverGastoGP(OBRA_NUEVA, g) !== estadoGastoGP(OBRA_NUEVA, g).valor);
    exigir(discrepan.length === 0,
      'el número que devuelve `resolverGastoGP` es el del veredicto, en los 5 casos',
      discrepan.map(g => `con ${JSON.stringify(g)} discrepan`));
  }

  // ══════════════════════════════════════════════════════════════════════════
  seccion('4. EL KPI DE LA OBRA ARRASTRA EL VEREDICTO, NO SÓLO LA CIFRA');
  // ══════════════════════════════════════════════════════════════════════════
  // Si `calcularKPIsObra` devolviera sólo el número, la pantalla no tendría con
  // qué decidir, y la única salida sería recalcular el veredicto aparte — una
  // segunda cuenta del mismo número.
  let calcularKPIsObra;
  try {
    ({ calcularKPIsObra } = deApp('calcularKPIsObra'));
  } catch (e) {
    if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
    throw e;
  }
  const kpisDe = (obra, gpData) => calcularKPIsObra(obra, [], [], [], [], gpData, []);
  {
    const obra = { ...OBRA_NUEVA, presupuesto: 10000000, modoAvance: 'importe' };
    const sinPedir = kpisDe(obra, { obrasPedidas: [], obras: {} });
    exigir(sinPedir.gastoGPMedido === false && sinPedir.gastoGPMotivo === 'no-pedida',
      'el KPI dice si el gasto fue medido y por qué, no sólo cuánto',
      [`dijo medido=${sinPedir.gastoGPMedido} motivo=${sinPedir.gastoGPMotivo}`]);
    const pedida = kpisDe(obra, { obrasPedidas: ['0128'], obras: {} });
    exigir(pedida.gastoGPMedido === true && pedida.gastoGPMotivo === 'sin-cheques',
      'y cuando el cero es real, lo dice medido');
    exigir(sinPedir.gastoGP === pedida.gastoGP && sinPedir.gastoGP === 0,
      'las dos cifras son el mismo 0: lo que las distingue es el veredicto, no el número',
      [`${sinPedir.gastoGP} vs ${pedida.gastoGP}`]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  seccion('5. LA TABLA NO AFIRMA UN MARGEN QUE NO MIDIÓ');
  // ══════════════════════════════════════════════════════════════════════════
  // Se ejecutan las expresiones VIVAS del renglón —las propiedades que la fila
  // prepara para pintar— sacadas de `src/App.jsx`. No es una copia: si alguien
  // cambia el condicional, este banco ejercita el nuevo.
  let objRenglon = null;
  let mapasDeFilas = [];
  traverse(astApp, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== 'DashboardPrincipal') return;
      p.traverse({
        ObjectExpression(q) {
          if (!q.node.properties.some(pr =>
            pr.type === 'ObjectProperty' && pr.key?.name === 'margenTxt')) return;
          objRenglon = q.node;
        },
        CallExpression(q) {
          const s = srcApp.slice(q.node.start, q.node.end);
          if (!/^filas\.map\(/.test(s)) return;
          mapasDeFilas.push(s);
        },
      });
    },
  });
  if (!objRenglon) {
    noArranco(['el renglón preparado de la tabla (el objeto con `margenTxt`)'], 'src/App.jsx');
  }
  const propDeRenglon = (nombre) => {
    const pr = objRenglon.properties.find(x =>
      x.type === 'ObjectProperty' && x.key?.name === nombre);
    if (!pr) noArranco([`la propiedad \`${nombre}\` del renglón de la tabla`], 'src/App.jsx');
    return srcApp.slice(pr.value.start, pr.value.end);
  };
  // Se evalúa cada expresión con sus insumos atados a mano. Los nombres son los
  // que el renglón usa; si cambiaran, el `new Function` revienta y el banco no
  // arranca, que es lo correcto.
  const ARGS = ['kpis', 'gastoSinMedir', 'margenIndefinido', 'C', 'MXN', 'NUM', 'nivelMargen'];
  const evaluar = (nombre, kpis, gastoSinMedir, margenIndefinido) =>
    new Function(...ARGS, `"use strict";\nreturn (${propDeRenglon(nombre)});`)(
      kpis, gastoSinMedir, margenIndefinido, C, MXN, NUM, nivelMargen);
  const renglonDe = (kpis, gastoSinMedir, margenIndefinido) => ({
    margenTxt:       evaluar('margenTxt', kpis, gastoSinMedir, margenIndefinido),
    margenAbsTxt:    evaluar('margenAbsTxt', kpis, gastoSinMedir, margenIndefinido),
    margenColor:     evaluar('margenColor', kpis, gastoSinMedir, margenIndefinido),
    margenTitulo:    evaluar('margenTitulo', kpis, gastoSinMedir, margenIndefinido),
    margenConFlecha: evaluar('margenConFlecha', kpis, gastoSinMedir, margenIndefinido),
  });

  // a) gasto sin medir: ni porcentaje ni importe. Las DOS cosas, porque al
  //    importe también le falta el sumando que no se midió.
  {
    // 98.2% sería el margen aparente de una obra de $11M sin su gasto de GP:
    // el número más convincente del tablero, y falso.
    const kpis = { mpct: 98.2, diff: 10800000, me: 11000000, gt: 200000,
                   gastoGPMedido: false, gastoGPMotivo: 'no-pedida' };
    const r = renglonDe(kpis, true, false);
    exigir(r.margenTxt === '—',
      'sin gasto medido, el porcentaje NO se pinta (ni 98.2% ni 0.0%)',
      [`pintó ${JSON.stringify(r.margenTxt)}`]);
    exigir(!/\d/.test(r.margenAbsTxt),
      'y el importe absoluto tampoco: le falta el gasto que no se midió',
      [`pintó ${JSON.stringify(r.margenAbsTxt)}`]);
    exigir(/sin medir/i.test(r.margenAbsTxt),
      'lo que se pinta en su lugar dice qué pasa, no queda en blanco',
      [`pintó ${JSON.stringify(r.margenAbsTxt)}`]);
    exigir(r.margenColor === C.textMut,
      'el color es apagado: no es buena noticia ni mala, es que no se sabe',
      [`pintó ${JSON.stringify(r.margenColor)}`]);
    exigir(r.margenColor !== nivelMargen(98.2).color,
      'y en particular NO es el verde que le tocaría a un 98.2%');
    exigir(typeof r.margenTitulo === 'string' && /mide|medi/i.test(r.margenTitulo),
      'y hay una explicación al alcance del cursor',
      [`dijo ${JSON.stringify(r.margenTitulo)}`]);
    exigir(r.margenConFlecha === false,
      'sin margen que afirmar, tampoco se pinta la flecha de variación');
  }
  // b) el motivo cambia la explicación: «se dio de alta» es accionable (esperar
  //    la corrida), «no se pudo medir» es otra cosa.
  {
    const base = { mpct: 98.2, diff: 1, me: 2, gt: 1, gastoGPMedido: false };
    const t1 = renglonDe({ ...base, gastoGPMotivo: 'no-pedida' }, true, false).margenTitulo;
    const t2 = renglonDe({ ...base, gastoGPMotivo: 'sin-match' }, true, false).margenTitulo;
    exigir(t1 !== t2,
      'una obra recién dada de alta y una que no se pudo medir no dicen lo mismo',
      [`las dos dicen ${JSON.stringify(t1)}`]);
    exigir(/alta/i.test(t1),
      'la recién dada de alta explica que es por eso, que es lo que el usuario acaba de hacer',
      [`dijo ${JSON.stringify(t1)}`]);
  }
  // c) margen indefinido (gasto sin ejecución): es OTRO caso y sigue intacto.
  //    Ahí el importe sí es real y se enseña: ese dinero se gastó.
  {
    const kpis = { mpct: 0, diff: -300000, me: 0, gt: 300000, gastoGPMedido: true, gastoGPMotivo: 'medido' };
    const r = renglonDe(kpis, false, true);
    exigir(r.margenTxt === '—', 'margen indefinido: el porcentaje sigue siendo guion');
    exigir(r.margenAbsTxt === `−${MXN(300000)}`,
      'pero el importe SÍ se pinta: ese dinero se gastó de verdad',
      [`pintó ${JSON.stringify(r.margenAbsTxt)}`]);
    exigir(r.margenColor === C.redDk,
      'y el color es rojo, porque es pérdida — no «no se sabe»',
      [`pintó ${JSON.stringify(r.margenColor)}`]);
    exigir(r.margenColor !== renglonDe({ ...kpis, gastoGPMedido: false }, true, true).margenColor,
      'los dos casos no se pintan igual: uno es pérdida y el otro es ignorancia');
  }
  // d) el caso normal, que es el que no se puede haber roto.
  {
    const kpis = { mpct: 18.4, diff: 1840000, me: 10000000, gt: 8160000,
                   gastoGPMedido: true, gastoGPMotivo: 'medido' };
    const r = renglonDe(kpis, false, false);
    exigir(r.margenTxt === `${NUM(18.4, 1)}%`, 'margen medido: el porcentaje de siempre',
      [`pintó ${JSON.stringify(r.margenTxt)}`]);
    exigir(r.margenAbsTxt === MXN(1840000), 'y el importe de siempre',
      [`pintó ${JSON.stringify(r.margenAbsTxt)}`]);
    exigir(r.margenColor === nivelMargen(18.4).color, 'y el color del nivel de siempre');
    exigir(r.margenTitulo === undefined, 'y sin explicación encima: no hay nada que explicar');
    exigir(r.margenConFlecha === true, 'y con su flecha de variación');
  }
  // e) y lo pinta UNA sola cuenta. Los dos bloques —móvil y escritorio— tienen
  //    que consumir lo preparado; si cada uno vuelve a escribir el condicional,
  //    las dos vistas del mismo número pueden discrepar, y han discrepado.
  seccion('   y el mismo número se pinta en los dos bloques con la misma cuenta');
  exigir(mapasDeFilas.length === 2,
    'hay exactamente dos bloques que pintan las filas (móvil y escritorio)',
    [`se encontraron ${mapasDeFilas.length}`]);
  mapasDeFilas.forEach((s, i) => {
    const cual = i === 0 ? 'el primero' : 'el segundo';
    exigir(/f\.margenTxt/.test(s) && /f\.margenAbsTxt/.test(s) && /f\.margenColor/.test(s),
      `${cual} consume el texto, el importe y el color ya preparados`,
      ['falta alguno: ese bloque está armando el margen por su cuenta']);
    exigir(!/margenIndefinido/.test(s),
      `${cual} no vuelve a preguntar por \`margenIndefinido\``,
      ['si lo pregunta, hay dos condicionales para un mismo número']);
    exigir(!/nivelMargen/.test(s),
      `${cual} no vuelve a calcular el color con \`nivelMargen\``);
    // `MXN(` sí aparece en estos bloques, para «Por cobrar» — ése es otro
    // número y sí se formatea aquí. Lo que no puede aparecer son las cifras
    // CRUDAS del margen: tocarlas es volver a decidir qué se pinta.
    exigir(!/\bmargenAbs\b|\bmargenPct\b/.test(s),
      `${cual} no toca las cifras crudas del margen (\`margenAbs\`, \`margenPct\`)`,
      ['las usa: ese bloque está decidiendo por su cuenta qué pintar']);
  });

  // ══════════════════════════════════════════════════════════════════════════
  seccion('6. EL ORDEN POR MARGEN NO COLOCA UNA OBRA SIN MEDIR ENTRE LAS MEDIDAS');
  // ══════════════════════════════════════════════════════════════════════════
  // Ordenar por un número que no es un número le asigna una posición, y una
  // posición en un ranking de margen afirma algo. Van al final, como cualquier
  // otro dato faltante en esta tabla.
  let fuenteCmp = null;
  traverse(astApp, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== 'DashboardPrincipal') return;
      p.traverse({
        VariableDeclarator(q) {
          if (q.node.id.name !== 'cmpFilas') return;
          fuenteCmp = srcApp.slice(q.node.init.start, q.node.init.end);
        },
      });
    },
  });
  if (!fuenteCmp) noArranco(['`cmpFilas`, el comparador de la tabla'], 'src/App.jsx');
  const ordenarCon = (ordenTabla, filas) => {
    const cmp = new Function('ordenTabla', `"use strict";\nreturn (${fuenteCmp});`)(ordenTabla);
    return [...filas].sort(cmp).map(f => f.nombre);
  };
  const FILAS = [
    { nombre: 'MEDIDA MALA',   margenPct: -12.0, margenAbs: -1200000, margenIndefinido: false, gastoSinMedir: false, af: 50, porCobrar: 1, personal: 1, diasSinCaptura: 1 },
    { nombre: 'MEDIDA BUENA',  margenPct: 22.0,  margenAbs: 2200000,  margenIndefinido: false, gastoSinMedir: false, af: 60, porCobrar: 2, personal: 2, diasSinCaptura: 2 },
    { nombre: 'SIN EJECUCION', margenPct: 0,     margenAbs: -300000,  margenIndefinido: true,  gastoSinMedir: false, af: 0,  porCobrar: 3, personal: 3, diasSinCaptura: 3 },
    { nombre: 'SIN MEDIR',     margenPct: 98.2,  margenAbs: 10800000, margenIndefinido: false, gastoSinMedir: true,  af: 10, porCobrar: 4, personal: 4, diasSinCaptura: 4 },
  ];
  for (const dir of ['asc', 'desc']) {
    const o = ordenarCon({ col: 'margen', dir }, FILAS);
    exigir(o[o.length - 1] === 'SIN MEDIR',
      `por margen ${dir}, la obra sin medir va al final`,
      [`salió ${o.join(' → ')}`]);
    exigir(o[0] === 'SIN EJECUCION',
      `por margen ${dir}, la de gasto sin ejecución sigue yendo primero`,
      [`salió ${o.join(' → ')}`]);
  }
  exigir(ordenarCon({ col: 'margen', dir: 'asc' }, FILAS).indexOf('MEDIDA MALA')
       < ordenarCon({ col: 'margen', dir: 'asc' }, FILAS).indexOf('MEDIDA BUENA'),
    'y entre las medidas, ascendente sigue siendo peor margen primero',
    [`salió ${ordenarCon({ col: 'margen', dir: 'asc' }, FILAS).join(' → ')}`]);
  // Dos sin medir no se ordenan por su margen aparente: por nombre, que no
  // afirma nada sobre el dinero.
  {
    const dos = [
      { ...FILAS[3], nombre: 'ZETA', margenPct: 99.9 },
      { ...FILAS[3], nombre: 'ALFA', margenPct: 10.0 },
    ];
    const o = ordenarCon({ col: 'margen', dir: 'desc' }, dos);
    exigir(o.join('|') === 'ALFA|ZETA',
      'dos obras sin medir se ordenan entre sí por nombre, no por su margen aparente',
      [`salió ${o.join(' → ')}`]);
  }
  // Las otras columnas no se tocan: ahí el dato sí está medido.
  {
    const o = ordenarCon({ col: 'avance', dir: 'desc' }, FILAS);
    exigir(o[0] === 'MEDIDA BUENA',
      'ordenar por avance no se ve afectado: ese dato sí está medido',
      [`salió ${o.join(' → ')}`]);
    const n = ordenarCon({ col: 'nombre', dir: 'asc' }, FILAS);
    exigir(n.join('|') === [...n].sort((a, b) => a.localeCompare(b, 'es')).join('|'),
      'y por nombre sigue siendo alfabético, con la obra sin medir en su letra',
      [`salió ${n.join(' → ')}`]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  seccion('7. EL CONSOLIDADO DICE QUE LE FALTA DINERO');
  // ══════════════════════════════════════════════════════════════════════════
  // Al total de Gastado le falta el gasto de la obra no medida, así que el
  // margen consolidado sale MEJOR de lo que es. No se puede corregir —no se
  // sabe cuánto falta— pero no declararlo es dejar que el número se lea como
  // bueno. Se ejecuta la cuenta viva del dashboard.
  let fuenteSinMedir = null;
  traverse(astApp, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== 'DashboardPrincipal') return;
      const lim = {};
      p.traverse({
        VariableDeclarator(q) {
          const n = q.node.id.name;
          if (n !== 'obrasGastoSinMedir' && n !== 'sinMedirTxt') return;
          lim[n] = [q.parentPath.node.start, q.parentPath.node.end];
        },
      });
      if (lim.obrasGastoSinMedir && lim.sinMedirTxt) {
        fuenteSinMedir = srcApp.slice(lim.obrasGastoSinMedir[0], lim.sinMedirTxt[1]);
      }
    },
  });
  if (!fuenteSinMedir) {
    noArranco(['la cuenta del consolidado (obrasGastoSinMedir…sinMedirTxt)'], 'src/App.jsx');
  }
  const correrConsolidado = (kpisPorObra) =>
    new Function('kpisPorObra',
      `"use strict";\n${fuenteSinMedir}\nreturn { obrasGastoSinMedir, sinMedirTxt };`)(kpisPorObra);
  {
    const medida = { obra: OBRA_VIEJA, kpis: { gastoGPMedido: true, gt: 4004156 } };
    const sinMedir = { obra: OBRA_NUEVA, kpis: { gastoGPMedido: false, gt: 0 } };
    const todoMedido = correrConsolidado([medida, medida]);
    exigir(todoMedido.sinMedirTxt === null && todoMedido.obrasGastoSinMedir.length === 0,
      'con todas las obras medidas no se dice nada: no hay nada que advertir',
      [`dijo ${JSON.stringify(todoMedido.sinMedirTxt)}`]);
    const una = correrConsolidado([medida, sinMedir]);
    exigir(una.obrasGastoSinMedir.length === 1,
      'con una sin medir, la cuenta la encuentra',
      [`encontró ${una.obrasGastoSinMedir.length}`]);
    exigir(typeof una.sinMedirTxt === 'string' && /1 obra\b/.test(una.sinMedirTxt),
      'y lo dice en singular, con el número de obras',
      [`dijo ${JSON.stringify(una.sinMedirTxt)}`]);
    exigir(/alto|arriba|mejor|por encima/i.test(una.sinMedirTxt),
      'y dice EN QUÉ DIRECCIÓN miente el número, que es lo accionable',
      [`dijo ${JSON.stringify(una.sinMedirTxt)}`]);
    const dos = correrConsolidado([medida, sinMedir, sinMedir]);
    exigir(/2 obras\b/.test(dos.sinMedirTxt),
      'y con dos, en plural',
      [`dijo ${JSON.stringify(dos.sinMedirTxt)}`]);
    // Y no inventa un ajuste: no puede haber una cifra de dinero en el aviso,
    // porque la cifra que faltaría es justo la que no se midió.
    exigir(!/\$/.test(dos.sinMedirTxt),
      'el aviso no trae ninguna cifra de dinero: la que falta es la que no se midió',
      [`dijo ${JSON.stringify(dos.sinMedirTxt)}`]);
  }
  // Y el renglón de la pantalla lo consume: el aviso de «sin medir» tiene que
  // ganarle al de «sin ejecución», porque aquél matiza un total correcto y éste
  // avisa de un total incompleto.
  {
    let bloqueMargen = null;
    traverse(astApp, {
      JSXElement(p) {
        const s = srcApp.slice(p.node.start, p.node.end);
        if (!/label="Margen"/.test(s)) return;
        if (!bloqueMargen || s.length < bloqueMargen.length) bloqueMargen = s;
      },
    });
    if (!bloqueMargen) noArranco(['la tarjeta de Margen del consolidado'], 'src/App.jsx');
    exigir(/sinMedirTxt/.test(bloqueMargen),
      'la tarjeta de Margen del consolidado consume el aviso',
      ['no lo menciona: el número se presentaría como completo']);
    const iSinMedir = bloqueMargen.indexOf('sinMedirTxt');
    const iSinEjec = bloqueMargen.indexOf('obrasSinEjec');
    exigir(iSinEjec === -1 || iSinMedir < iSinEjec,
      'y el aviso de «sin medir» va ANTES que el de «sin ejecución» en la condicional',
      ['si gana el otro, un total incompleto se presenta sólo con un matiz']);
  }

  // ── cierre ───────────────────────────────────────────────────────────────
  console.log('');
  if (fallas > 0) {
    console.log(`ROJO: ${fallas} aserción(es) en rojo.`);
    console.log('Mientras eso siga así, o la obra recién contratada no se puede dar de');
    console.log('alta, o se puede dar de alta y aparece en el tablero con un margen');
    console.log('cercano al 100% que nadie midió — que es peor que no poder darla de alta.');
    process.exit(1);
  }
  console.log('VERDE: la obra que GP no conoce se puede dar de alta con su clave, y');
  console.log('mientras GP no tenga nada de ella la pantalla no afirma ningún margen.');
  process.exit(0);
})().catch(e => {
  console.log('');
  console.log('NO ARRANCÓ: ' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
