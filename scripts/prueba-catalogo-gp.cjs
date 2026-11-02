#!/usr/bin/env node
// Para dar de alta una obra hay que poder VERLA en la lista.
//
// QUÉ SE AFIRMA. El alta de obra del lado constructora obliga a escoger primero
// una obra de GP. Este banco exige que la lista de ese paso salga del CATÁLOGO
// —qué obras existen en la contabilidad— y no del documento de GASTO, y que el
// catálogo diga la verdad sobre lo que trae: sin montos, sin obras inventadas y
// sin renglones callados.
//
// POR QUÉ EXISTE. Es un defecto que ya pasó y que no dio ningún error. Mientras
// el gasto venía de la hoja de GP había 34 obras en `global/gp_construct` y el
// selector de alta las ofrecía todas. El 2026-11-02 el gasto pasó a pedirse
// obra por obra —cinco obras, las que CAMPO ya tiene— y el selector se quedó
// con esas cinco: la obra que alguien quiere dar de alta nunca está en la lista
// del gasto, porque no está en CAMPO, y no entra a CAMPO porque no está en la
// lista. El círculo se cierra sin una sola excepción en consola, y la pantalla
// se ve perfectamente bien: una lista corta no parece una lista mutilada.
//
// Medido el 2026-11-02 contra fosedy.org: GP conoce 67 obras y CAMPO tiene 5.
// Tres de las 67 —0128, 0129 y 0131— se abrieron en octubre de 2026 y son justo
// las que hay que poder dar de alta.
//
// EL INSUMO SE CARGA DE ARCHIVO (P7): `scripts/renglones-gp-de-prueba.json`,
// los mismos renglones crudos con los campos y formatos medidos en producción.
// Los dos casos que la producción NO tiene —una obra con dos grafías y un
// empate de fechas— se derivan de renglones de ese archivo cambiándoles el
// nombre y la fecha, y eso se dice aquí: la FORMA sigue siendo la medida, lo
// único explícito es la variación que se quiere ejercitar.
//
// Uso:  node scripts/prueba-catalogo-gp.cjs
//
// CONTRAPRUEBA, comprobada, devolviendo cada defecto uno por uno y corriendo
// este mismo banco:
//
//   · agrupar el catálogo por `fila.ENumProy`                  → rojo, salida 1
//   · el nombre, el más repetido en vez del del cheque reciente → rojo, salida 1
//   · quitar el corte de catálogo vacío antes de escribir       → rojo, salida 1
//   · el selector, leyendo `gpData.obras` antes que el catálogo → rojo, salida 1
//   · el renglón, pintando el gasto sin mirar si fue medido     → rojo, salida 1

'use strict';

const fs = require('fs');
const path = require('path');
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion, vigilarExcepciones } = noArranco;

const RAIZ = path.resolve(__dirname, '..');
const RENGLONES = path.join(__dirname, 'renglones-gp-de-prueba.json');
const APP = path.join(RAIZ, 'src/App.jsx');
const FUNCIONES = path.join(RAIZ, 'functions/index.js');

vigilarExcepciones('functions/index.js', 'src/App.jsx');

const { deFunciones, SimboloPerdido } = require('./extraer-de-app.cjs');

let catalogoDeRenglonesGP;
try {
  ({ catalogoDeRenglonesGP } = deFunciones('catalogoDeRenglonesGP'));
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
  throw e;
}

if (!fs.existsSync(RENGLONES)) {
  sinPrecondicion('los renglones de prueba ' + path.relative(RAIZ, RENGLONES),
    ['Es un archivo del repositorio, no un volcado: debería estar versionado.',
     'Recuperarlo con `git checkout -- ' + path.relative(RAIZ, RENGLONES) + '`.']);
}
let filas;
try {
  filas = JSON.parse(fs.readFileSync(RENGLONES, 'utf8'));
} catch (e) {
  sinPrecondicion('los renglones de prueba ' + path.relative(RAIZ, RENGLONES),
    ['No es JSON legible: ' + e.message]);
}
if (!Array.isArray(filas) || filas.length === 0) {
  sinPrecondicion('los renglones de prueba ' + path.relative(RAIZ, RENGLONES),
    ['El archivo existe pero no trae una lista de renglones.']);
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

// ── lo que el archivo de renglones dice, leído aparte del código que se mide ──
// Esto NO es una copia de la cuenta: es la MISMA pregunta contestada con una
// lectura directa del archivo. Si el agrupador del catálogo se equivoca en la
// clave, las dos lecturas dejan de coincidir.
const prefijo = (f) => {
  const m = /^(\d{4})\s+(\S.*)$/.exec(String(f && f.DesProy != null ? f.DesProy : '').trim());
  return m ? { id: m[1], nombre: m[2].trim() } : null;
};
const esperado = new Map();
let esperadoSinClave = 0;
for (const f of filas) {
  const p = prefijo(f);
  if (!p) { esperadoSinClave++; continue; }
  const e = esperado.get(p.id) || { id: p.id, nombres: new Set(), ultimo: '', renglones: 0 };
  e.nombres.add(p.nombre);
  e.renglones++;
  const fc = String(f.F_Cheque || '').slice(0, 10);
  if (fc > e.ultimo) e.ultimo = fc;
  esperado.set(p.id, e);
}
if (esperado.size < 2) {
  sinPrecondicion('los renglones de prueba',
    ['Traen menos de dos obras distintas: con una sola no se puede distinguir',
     'un catálogo bien agrupado de uno que revuelve el gasto de dos obras.']);
}

const cat = catalogoDeRenglonesGP(filas);

// ════════════════════════════════════════════════════════════════════════════
seccion('1. EL CATÁLOGO DICE QUÉ OBRAS EXISTEN, Y SON LAS DEL ARCHIVO');
// ════════════════════════════════════════════════════════════════════════════
const idsEsperados = [...esperado.keys()].sort();
const idsCat = cat.obras.map(o => o.id);
exigir(idsCat.join('|') === idsEsperados.join('|'),
  `las ${idsEsperados.length} obras del archivo, y ninguna más (${idsEsperados.join(' ')})`,
  [`archivo:  ${idsEsperados.join(' ')}`, `catálogo: ${idsCat.join(' ')}`]);
exigir(idsCat.join('|') === [...idsCat].sort().join('|'),
  'vienen ordenadas por clave, que es como se busca una obra por número');
for (const o of cat.obras) {
  const e = esperado.get(o.id);
  if (!e) continue;
  exigir(e.nombres.has(o.nombre), `la ${o.id} se llama como la llama la contabilidad`,
    [`catálogo: ${JSON.stringify(o.nombre)}`,
     `archivo:  ${[...e.nombres].map(n => JSON.stringify(n)).join(' · ')}`]);
  exigir(o.ultimoCheque === e.ultimo,
    `la ${o.id} trae la fecha de su cheque más reciente (${e.ultimo})`,
    [`salió ${JSON.stringify(o.ultimoCheque)}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('2. NINGÚN RENGLÓN SE QUEDA CALLADO');
// ════════════════════════════════════════════════════════════════════════════
// Un renglón sin clave de obra no se puede colgar de ninguna obra, pero tampoco
// se puede desaparecer: se CUENTA. Medido en producción: 16 de 46,470.
exigir(cat.renglonesLeidos === filas.length,
  `se leyeron los ${filas.length} renglones del archivo`,
  [`dijo ${cat.renglonesLeidos}`]);
exigir(cat.renglonesSinClave === esperadoSinClave,
  `los ${esperadoSinClave} renglón(es) sin clave de obra se cuentan, no se tiran`,
  [`archivo ${esperadoSinClave} · catálogo ${cat.renglonesSinClave}`]);
const sumaRenglones = [...esperado.values()].reduce((n, e) => n + e.renglones, 0);
exigir(sumaRenglones + cat.renglonesSinClave === filas.length,
  'los renglones de las obras más los sin clave son todos los del archivo',
  [`${sumaRenglones} + ${cat.renglonesSinClave} ≠ ${filas.length}`]);

// ════════════════════════════════════════════════════════════════════════════
seccion('3. EL CATÁLOGO NO LLEVA DINERO');
// ════════════════════════════════════════════════════════════════════════════
// No es estética: el gasto de una obra ya se publica en `global/gp_construct`,
// y una segunda cuenta del mismo número es una discrepancia esperando. Además
// el catálogo trae obras que CAMPO no tiene, y de ésas nadie midió nada.
const texto = JSON.stringify(cat.obras);
const camposDeDinero = ['total', 'grandTotal', 'importe', 'monto', 'gasto', 'saldo'];
const colados = camposDeDinero.filter(c => new RegExp(`"[^"]*${c}`, 'i').test(texto));
exigir(colados.length === 0, 'ninguna obra del catálogo trae un campo de dinero',
  colados.map(c => `aparece un campo que contiene «${c}»`));
// Y lo de fondo, que no depende de cómo se llame el campo: en el catálogo no
// hay un solo número. Clave, nombre y fecha son texto; cualquier cifra que
// apareciera aquí sería dinero o un conteo, y las dos cosas ya se publican en
// el documento de gasto.
const numericos = [];
for (const o of cat.obras) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== 'string') numericos.push(`${o.id}.${k} = ${JSON.stringify(v)} (${typeof v})`);
  }
}
exigir(numericos.length === 0,
  'en el catálogo no hay un solo número: clave, nombre y fecha son texto',
  numericos);
const campos = new Set();
for (const o of cat.obras) for (const k of Object.keys(o)) campos.add(k);
exigir([...campos].sort().join(',') === 'id,nombre,ultimoCheque',
  'cada obra trae exactamente id, nombre y fecha del último cheque',
  [`trae: ${[...campos].sort().join(', ')}`]);

// ════════════════════════════════════════════════════════════════════════════
seccion('4. LA CLAVE DE LA OBRA ES EL PREFIJO DE `DesProy`, NO `ENumProy`');
// ════════════════════════════════════════════════════════════════════════════
// `ENumProy` también es texto de cuatro dígitos con ceros a la izquierda, y por
// eso es la trampa. Medido sobre los 46,470 renglones: el 0001 aparece en 21
// obras distintas y 29 de los 67 valores los comparten varias obras. Agrupar
// por ahí fusiona obras sin dar error — y en un catálogo eso significa que la
// obra que alguien busca desaparece de la lista bajo el nombre de otra.
const enums = new Set(filas.map(f => String(f.ENumProy)));
const colados2 = idsCat.filter(id => enums.has(id) && !idsEsperados.includes(id));
exigir(colados2.length === 0, 'ningún `ENumProy` se coló como clave de obra',
  colados2.map(id => `la obra ${id} no existe en el archivo; es un ENumProy`));
// Y lo de fondo: dos obras que comparten `ENumProy` siguen siendo dos.
const porEnum = new Map();
for (const f of filas) {
  const p = prefijo(f);
  if (!p) continue;
  const k = String(f.ENumProy);
  if (!porEnum.has(k)) porEnum.set(k, new Set());
  porEnum.get(k).add(p.id);
}
const compartidos = [...porEnum.entries()].filter(([, s]) => s.size > 1);
exigir(compartidos.length > 0,
  'el archivo trae al menos un `ENumProy` compartido por dos obras (si no, la trampa no se está ejercitando)',
  ['ningún ENumProy del archivo lo comparten dos obras distintas']);
for (const [k, s] of compartidos) {
  const presentes = [...s].filter(id => idsCat.includes(id));
  exigir(presentes.length === s.size,
    `las ${s.size} obras que comparten el ENumProy ${k} siguen siendo ${s.size} en el catálogo`,
    [`esperadas ${[...s].join(' ')} · presentes ${presentes.join(' ')}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('5. UNA OBRA RENOMBRADA SE LLAMA COMO SE LLAMA HOY');
// ════════════════════════════════════════════════════════════════════════════
// Una obra con cientos de renglones viejos y tres nuevos se tiene que ofrecer
// con el nombre nuevo: el viejo es el que ya no se reconoce. El desempate por
// frecuencia es un desempate, no la regla; mandar al más repetido invertiría el
// resultado en todos los renombres reales.
const base = filas.find(f => prefijo(f));
const clon = (cambios) => ({ ...base, ...cambios });
const renombrada = [
  clon({ DesProy: '0900 NOMBRE VIEJO', F_Cheque: '2020-01-10T00:00:00.000Z' }),
  clon({ DesProy: '0900 NOMBRE VIEJO', F_Cheque: '2020-02-10T00:00:00.000Z' }),
  clon({ DesProy: '0900 NOMBRE VIEJO', F_Cheque: '2020-03-10T00:00:00.000Z' }),
  clon({ DesProy: '0900 NOMBRE NUEVO', F_Cheque: '2026-10-30T00:00:00.000Z' }),
];
const r1 = catalogoDeRenglonesGP(renombrada);
exigir(r1.obras.length === 1 && r1.obras[0].nombre === 'NOMBRE NUEVO',
  'con tres renglones viejos y uno reciente, gana el nombre del reciente',
  [`salió ${JSON.stringify(r1.obras.map(o => o.nombre))}`]);
exigir(r1.obras.length === 1 && r1.obras[0].ultimoCheque === '2026-10-30',
  'y la fecha del último cheque es la del reciente',
  [`salió ${JSON.stringify(r1.obras.map(o => o.ultimoCheque))}`]);
exigir(r1.obrasRenombradas.length === 1 && r1.obrasRenombradas[0].id === '0900'
  && r1.obrasRenombradas[0].grafias.length === 2,
  'la obra renombrada queda señalada, con las dos grafías, para que no haya que adivinar cuál se escogió',
  [`salió ${JSON.stringify(r1.obrasRenombradas)}`]);
// Empate de fecha: ahí sí manda la frecuencia.
const empatada = [
  clon({ DesProy: '0901 DOS VECES', F_Cheque: '2026-05-05T00:00:00.000Z' }),
  clon({ DesProy: '0901 DOS VECES', F_Cheque: '2026-05-05T00:00:00.000Z' }),
  clon({ DesProy: '0901 UNA VEZ', F_Cheque: '2026-05-05T00:00:00.000Z' }),
];
const r2 = catalogoDeRenglonesGP(empatada);
exigir(r2.obras.length === 1 && r2.obras[0].nombre === 'DOS VECES',
  'empatada la fecha, desempata la frecuencia',
  [`salió ${JSON.stringify(r2.obras.map(o => o.nombre))}`]);
const r3 = catalogoDeRenglonesGP([clon({ DesProy: '0902 UN SOLO NOMBRE' })]);
exigir(r3.obrasRenombradas.length === 0,
  'una obra con un solo nombre NO se señala como renombrada');

// ════════════════════════════════════════════════════════════════════════════
seccion('6. UNA ENTRADA ROTA NO PRODUCE OBRAS INVENTADAS');
// ════════════════════════════════════════════════════════════════════════════
// Es lo que separa «no se pudo medir» de una lista vacía que parece una lista.
for (const [etiqueta, entrada] of [
  ['una lista vacía', []],
  ['nulo', null],
  ['algo que no es lista', { DesProy: '0126 X' }],
  ['renglones sin `DesProy`', [clon({ DesProy: null }), clon({ DesProy: '' })]],
  ['una clave de 4 dígitos sin nombre', [clon({ DesProy: '0126' })]],
  ['una clave de 2 dígitos', [clon({ DesProy: '12 ALGO' })]],
  ['una clave de 5 dígitos', [clon({ DesProy: '00126 ALGO' })]],
]) {
  const r = catalogoDeRenglonesGP(entrada);
  exigir(Array.isArray(r.obras) && r.obras.length === 0,
    `${etiqueta} → ninguna obra`,
    [`salió ${JSON.stringify(r.obras)}`]);
}

// ════════════════════════════════════════════════════════════════════════════
seccion('7. UN CATÁLOGO VACÍO NO PISA AL BUENO');
// ════════════════════════════════════════════════════════════════════════════
// El peor fallo posible de esta función no es un error: es escribir una lista
// vacía. Deja el alta de obra sin lista —el defecto original, otra vez— y con
// pinta de haber funcionado. Se ejercita la función VIVA, con el transporte y
// Firestore sustituidos, no una copia de su cuerpo.
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const srcFn = fs.readFileSync(FUNCIONES, 'utf8');
const astFn = parse(srcFn, { sourceType: 'module', plugins: ['jsx'] });
let fuenteEscritor = null, versionCatalogo = null;
traverse(astFn, {
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'descargarYGuardarCatalogoGP') return;
    fuenteEscritor = srcFn.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    if (p.node.id.name === 'CATALOGO_GP_VERSION' && !p.scope.parent) {
      versionCatalogo = p.node.init && p.node.init.value;
    }
  },
});
if (!fuenteEscritor || versionCatalogo == null) {
  noArranco(['descargarYGuardarCatalogoGP', 'CATALOGO_GP_VERSION'].filter((n, i) =>
    i === 0 ? !fuenteEscritor : versionCatalogo == null), 'functions/index.js');
}

const armarEscritor = (filasQueDevuelve) => {
  const escrituras = [];
  const admin = { firestore: () => ({ doc: (ruta) => ({ set: async (d) => { escrituras.push({ ruta, d }); } }) }) };
  const pedirTodoGP = async () => filasQueDevuelve;
  const fn = new Function('admin', 'pedirTodoGP', 'catalogoDeRenglonesGP', 'CATALOGO_GP_VERSION',
    `"use strict";\n${fuenteEscritor}\nreturn descargarYGuardarCatalogoGP;`)(
    admin, pedirTodoGP, catalogoDeRenglonesGP, versionCatalogo);
  return { fn, escrituras };
};

(async () => {
  // a) El recorrido no trae ninguna obra con clave: tiene que reventar y NO escribir.
  {
    const { fn, escrituras } = armarEscritor([clon({ DesProy: 'SIN CLAVE' })]);
    let reventó = false, mensaje = '';
    try { await fn({ usuario: 'u', password: 'p' }); } catch (e) { reventó = true; mensaje = e.message; }
    exigir(reventó, 'un recorrido sin obras con clave revienta en vez de escribir',
      ['devolvió normal: la corrida saldría en verde con el catálogo vacío']);
    exigir(escrituras.length === 0, 'y no toca `global/gp_catalogo`',
      escrituras.map(e => `escribió en ${e.ruta}`));
    exigir(/renglon|clave|catálogo/i.test(mensaje),
      'y el mensaje dice qué fue lo que no se pudo medir',
      [`dijo ${JSON.stringify(mensaje)}`]);
  }
  // b) Sin credenciales: tampoco escribe.
  {
    const { fn, escrituras } = armarEscritor(filas);
    const antes = { u: process.env.GP_USUARIO, p: process.env.GP_PASSWORD };
    delete process.env.GP_USUARIO; delete process.env.GP_PASSWORD;
    let reventó = false;
    try { await fn({}); } catch (e) { reventó = true; }
    if (antes.u !== undefined) process.env.GP_USUARIO = antes.u;
    if (antes.p !== undefined) process.env.GP_PASSWORD = antes.p;
    exigir(reventó && escrituras.length === 0,
      'sin credenciales revienta y no escribe nada');
  }
  // c) Con renglones buenos: escribe el catálogo, con lo que trae dicho.
  {
    const { fn, escrituras } = armarEscritor(filas);
    await fn({ usuario: 'u', password: 'p' });
    exigir(escrituras.length === 1 && escrituras[0].ruta === 'global/gp_catalogo',
      'con renglones buenos escribe en `global/gp_catalogo`, y sólo ahí',
      escrituras.map(e => `escribió en ${e.ruta}`));
    const d = escrituras[0] ? escrituras[0].d : {};
    exigir(d.catalogoVersion === versionCatalogo,
      `el documento declara su versión (${versionCatalogo})`,
      [`dijo ${JSON.stringify(d.catalogoVersion)}`]);
    exigir(d.fuente === 'api-gp-completo',
      'y declara de dónde salió, que no es el mismo camino que el del gasto',
      [`dijo ${JSON.stringify(d.fuente)}`]);
    exigir(JSON.stringify(d.obras) === JSON.stringify(cat.obras),
      'las obras del documento son exactamente las del agrupador');
    exigir(d.totalObras === cat.obras.length,
      'el total que publica es el de la lista que publica, no otro',
      [`totalObras ${d.totalObras} · obras ${d.obras ? d.obras.length : '?'}`]);
    exigir(d.renglonesLeidos === filas.length && d.renglonesSinClave === esperadoSinClave,
      'y publica cuántos renglones leyó y cuántos no pudo clasificar',
      [`leídos ${d.renglonesLeidos}/${filas.length} · sin clave ${d.renglonesSinClave}/${esperadoSinClave}`]);
  }

  // ══════════════════════════════════════════════════════════════════════════
  seccion('8. EL SELECTOR DE ALTA OFRECE EL CATÁLOGO, NO EL DOCUMENTO DE GASTO');
  // ══════════════════════════════════════════════════════════════════════════
  // Aquí está el defecto. Se ejecuta la cuenta VIVA del modal —el trozo que va
  // de `gastoDeGpData` a `gpFiltradas`, extraído de `src/App.jsx`— con un
  // catálogo de muchas obras y un documento de gasto de pocas, que es la
  // situación real: 67 contra 5.
  const srcApp = fs.readFileSync(APP, 'utf8');
  const astApp = parse(srcApp, { sourceType: 'module', plugins: ['jsx'] });
  let trozo = null, renglonLista = null;
  traverse(astApp, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== 'ModalNuevaObra') return;
      const lim = {};
      p.traverse({
        VariableDeclarator(q) {
          const n = q.node.id.name;
          if (n !== 'gastoDeGpData' && n !== 'gpFiltradas') return;
          const stmt = q.parentPath.node;
          lim[n] = [stmt.start, stmt.end];
        },
        // El renglón de la lista: el JSXElement MÁS CHICO que pinta el id de la
        // obra. Quedarse con el más grande sería quedarse con el modal entero,
        // que "contiene" cualquier cadena del archivo y no afirma nada.
        JSXElement(q) {
          const s = srcApp.slice(q.node.start, q.node.end);
          if (!/ID: \{o\.id\}/.test(s)) return;
          if (!renglonLista || s.length < renglonLista.length) renglonLista = s;
        },
      });
      if (lim.gastoDeGpData && lim.gpFiltradas) {
        trozo = srcApp.slice(lim.gastoDeGpData[0], lim.gpFiltradas[1]);
      }
    },
  });
  if (!trozo || !renglonLista) {
    noArranco(['la cuenta del selector de alta (gastoDeGpData…gpFiltradas)',
      'el renglón de la lista de obras'].filter((n, i) =>
      i === 0 ? !trozo : !renglonLista), 'src/App.jsx');
  }

  const correrSelector = (gpData, catalogoGP, busqueda = '') =>
    new Function('gpData', 'catalogoGP', 'GP_OBRAS_CATALOGO', 'busqueda',
      `"use strict";\n${trozo}\nreturn { origenGP, gpCatalogo, gpFiltradas };`)(
      gpData, catalogoGP, [{ id: '0001', nombre: 'VIEJA', gastoGP: 1 }], busqueda);

  // El catálogo: las obras del archivo. El gasto: sólo la PRIMERA de ellas, que
  // es lo que pasa en producción —CAMPO tiene cinco de sesenta y siete—.
  const catalogoGP = { ultimaActualizacion: '2026-11-02T13:00:00.000Z', obras: cat.obras };
  const laQueCampoTiene = cat.obras[0];
  const gpDataPocas = {
    obras: {
      [`${laQueCampoTiene.id} ${laQueCampoTiene.nombre}`]: {
        id: laQueCampoTiene.id, grandTotal: 7777777, total2026: 0, meses: {}, años: {},
      },
    },
  };

  const conCatalogo = correrSelector(gpDataPocas, catalogoGP);
  exigir(conCatalogo.origenGP === 'catalogo',
    'con catálogo cargado, la lista viene del catálogo',
    [`dijo ${JSON.stringify(conCatalogo.origenGP)}`]);
  exigir(conCatalogo.gpFiltradas.length === cat.obras.length,
    `ofrece las ${cat.obras.length} obras del catálogo, no la(s) ${Object.keys(gpDataPocas.obras).length} que CAMPO ya tiene`,
    [`ofreció ${conCatalogo.gpFiltradas.length}`]);
  const idsOfrecidos = conCatalogo.gpFiltradas.map(o => o.id).sort();
  exigir(idsOfrecidos.join('|') === idsEsperados.join('|'),
    'y son exactamente las claves del catálogo',
    [`catálogo: ${idsEsperados.join(' ')}`, `ofrecidas: ${idsOfrecidos.join(' ')}`]);
  // Lo más reciente arriba: la obra nueva es justo la que se está buscando.
  const fechas = conCatalogo.gpFiltradas.map(o => o.ultimoCheque || '');
  exigir(fechas.join('|') === [...fechas].sort().reverse().join('|'),
    'ordenadas por movimiento más reciente, que es donde está la obra nueva',
    [`salió ${fechas.join(' ')}`]);

  seccion('   el gasto que se enseña es el medido, y sólo el medido');
  const conGasto = conCatalogo.gpFiltradas.find(o => o.id === laQueCampoTiene.id);
  const sinGasto = conCatalogo.gpFiltradas.filter(o => o.id !== laQueCampoTiene.id);
  exigir(!!conGasto && conGasto.gastoMedido === true && conGasto.gastoGP === 7777777,
    'la obra que CAMPO ya tiene trae su gasto, el del documento de gasto',
    [`salió ${JSON.stringify(conGasto && { m: conGasto.gastoMedido, g: conGasto.gastoGP })}`]);
  exigir(sinGasto.length > 0 && sinGasto.every(o => o.gastoMedido === false),
    'las que CAMPO no tiene quedan marcadas como gasto NO medido',
    sinGasto.filter(o => o.gastoMedido !== false).map(o => `${o.id} dice ${o.gastoMedido}`));
  exigir(sinGasto.every(o => o.ultimoCheque),
    'y traen la fecha del último movimiento, que es el dato que sí hay de ellas');
  exigir(conCatalogo.gpFiltradas.every(o => o.nombre === cat.obras.find(c => c.id === o.id).nombre),
    'el nombre que se ofrece es el del catálogo, no el de la etiqueta del gasto');
  // El renglón de la lista: el dinero sólo se pinta si fue medido. Es lo único
  // de este banco que se afirma sobre el ÁRBOL del JSX y no sobre un valor,
  // porque lo que se afirma es qué se PINTA y no hay React para pintarlo. No es
  // una expresión regular sobre el texto: se exige que cada llamada a `MXN`
  // esté DENTRO de la rama verdadera de una pregunta por `gastoMedido`. Un
  // `· Gasto GP: ${MXN(o.gastoGP)}` colgado fuera la pone en rojo.
  const envuelto = '(' + renglonLista + ')';
  const srcDe = (n) => envuelto.slice(n.start, n.end);
  const astRenglon = parse(envuelto, { plugins: ['jsx'] });
  const pinturasDeDinero = [];
  traverse(astRenglon, {
    CallExpression(q) {
      if (q.node.callee.type !== 'Identifier' || q.node.callee.name !== 'MXN') return;
      // La condicional más cercana cuya PREGUNTA mencione `gastoMedido`, y la
      // llamada tiene que caer en su rama verdadera —no en la falsa, no en la
      // pregunta—.
      let cubierta = false;
      for (let a = q.parentPath; a; a = a.parentPath) {
        if (!a.isConditionalExpression()) continue;
        if (!/gastoMedido/.test(srcDe(a.node.test))) continue;
        if (q.node.start >= a.node.consequent.start && q.node.end <= a.node.consequent.end) {
          cubierta = true;
        }
        break;
      }
      if (!cubierta) pinturasDeDinero.push(srcDe(q.node));
    },
  });
  exigir(pinturasDeDinero.length === 0,
    'el renglón sólo pinta dinero dentro de la rama donde el gasto SÍ fue medido',
    pinturasDeDinero.map(s => `${s} se pinta sin mirar si la cifra fue medida`));
  exigir(/gastoMedido/.test(renglonLista),
    'y la pregunta por el gasto medido está en el renglón, no se da por supuesta');
  exigir(!/\$\s*0|0\.00/.test(renglonLista),
    'y no tiene un cero escrito a mano para rellenar la columna');

  seccion('   sin catálogo la lista queda corta, y la pantalla lo dice');
  const sinCat = correrSelector(gpDataPocas, null);
  exigir(sinCat.origenGP === 'gasto',
    'sin catálogo cae al documento de gasto',
    [`dijo ${JSON.stringify(sinCat.origenGP)}`]);
  exigir(sinCat.gpFiltradas.length === Object.keys(gpDataPocas.obras).length,
    'y entonces sí ofrece sólo las obras que CAMPO tiene — que es por lo que ese caso avisa');
  const sinNada = correrSelector(null, null);
  exigir(sinNada.origenGP === 'estatico' && sinNada.gpFiltradas.length > 0,
    'sin ninguno de los dos cae a la lista vieja del archivo, no a una lista vacía');
  // Un catálogo que llegó vacío no cuenta como catálogo: ofrecer cero obras
  // sería dejar el alta igual de bloqueada, pero sin aviso.
  const catVacio = correrSelector(gpDataPocas, { obras: [] });
  exigir(catVacio.origenGP === 'gasto',
    'un catálogo vacío no se toma por catálogo',
    [`dijo ${JSON.stringify(catVacio.origenGP)}`]);

  seccion('   y se puede encontrar la obra nueva escribiendo su clave');
  const nueva = cat.obras[cat.obras.length - 1];
  const porClave = correrSelector(gpDataPocas, catalogoGP, nueva.id);
  exigir(porClave.gpFiltradas.length === 1 && porClave.gpFiltradas[0].id === nueva.id,
    `buscar «${nueva.id}» deja exactamente la ${nueva.id}`,
    [`salieron ${porClave.gpFiltradas.map(o => o.id).join(' ') || 'ninguna'}`]);
  const trozoNombre = nueva.nombre.slice(0, 6).toLowerCase();
  const porNombre = correrSelector(gpDataPocas, catalogoGP, trozoNombre);
  exigir(porNombre.gpFiltradas.some(o => o.id === nueva.id),
    `buscar «${trozoNombre}» también la encuentra`,
    ['no salió en los resultados']);

  // ── cierre ───────────────────────────────────────────────────────────────
  console.log('');
  if (fallas > 0) {
    console.log(`ROJO: ${fallas} aserción(es) en rojo.`);
    console.log('Mientras eso siga así, el paso obligatorio del alta de obra ofrece una');
    console.log('lista que no contiene la obra que se quiere dar de alta, y no hay forma');
    console.log('de darla de alta desde la aplicación.');
    process.exit(1);
  }
  console.log('VERDE: el catálogo dice qué obras existen sin tocar dinero, y el alta');
  console.log('de obra las ofrece todas.');
  process.exit(0);
})();
