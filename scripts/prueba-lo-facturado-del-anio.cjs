#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LO FACTURADO DEL AÑO, Y EL HUECO QUE NO CABE EN ÉL
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE ESTA CIFRA. Se pidió cerrar una obra terminada con tres
// propiedades, y la segunda era «que siga en el tablero el año en curso para
// poder sumar lo facturado». O sea: el número del año es la RAZÓN por la que
// la obra cerrada no desaparece. Si el número miente, el cierre no sirvió.
//
// Y PODÍA MENTIR DE LA FORMA MÁS CARA. Medido contra producción el 2026-11-10
// con `medir-que-hace-archivar-una-obra.cjs --prod` (sólo lectura): hay
// $287,437,918 de histórico, de los cuales $181,695,981 traen fecha de factura
// de 2026 y $105,741,937 —ocho estimaciones— NO TRAEN FECHA NINGUNA. Un total
// del año que se las tragara estaría inventando $105M de calendario; uno que
// las omitiera en silencio enseñaría $181M que se leen como «todo lo del año».
// La cifra no se ajusta: se declara lo que no cupo.
//
// LAS OCHO NO SON EL MISMO CASO, Y ÉSE ES EL PUNTO FINO. Cuatro están
// `Facturada` o `Pagada` sin fecha: el dinero se facturó y la fecha no se
// tecleó. Son $32,575,838 y son las ÚNICAS que la alarma nombra, porque son
// las únicas donde hay algo que hacer. Las otras cuatro están `En proceso` o
// `Aprobada`: no se han facturado, no tienen fecha que teclear, están bien.
// Son $73,166,100. Meter las ocho en la misma alarma sería mandar a corregir
// lo que no está roto — el defecto del #126 con otra cara: el problema de una
// lista no es que sea larga, es que sea FALSA.
//
// LA TARJETA DEL AÑO YA NO ESTÁ EN LA PANTALLA (2026-11-16). Se quitó por
// pedido expreso —«me expresé mal cuando pedí la construcción»— y con ella se
// fueron de este banco siete aserciones y cuatro mutaciones que miraban su
// `valor`, su `deltaSub` y su `nota`. NO ES UNA PÉRDIDA DE COBERTURA, y conviene
// dejar dicho por qué, porque borrar pruebas es exactamente lo que hace alguien
// que quiere que el verde sea barato:
//
//   · La CUENTA no se fue. `facturadoDelAnio` sigue viva y sigue siendo quien
//     parte el hueco en dos; §1, §2, §4 y §6 la miden igual que antes, y ocho
//     de las doce mutaciones siguen aquí porque muerden la cuenta, no el JSX.
//   · Lo que esas siete aserciones defendían era UNA LECTURA: que $181M no se
//     leyeran como «todo lo del año». Esa mala lectura ya no es posible, no
//     porque se declare mejor, sino porque no hay cifra anual en pantalla que
//     se pueda leer mal. Un riesgo que se elimina no se sigue vigilando.
//   · Lo que SÍ sobrevive en pantalla es la alarma `factura_sin_fecha`, y es la
//     mitad accionable: nombra obra, filas y dinero, y de eso alguien puede
//     hacer algo. Esa mitad se mide aquí abajo con más cuidado que antes,
//     porque ahora es el único sitio donde el hueco se ve.
//
// QUÉ AFIRMA ESTE BANCO, Y CÓMO. No afirma que exista ningún símbolo. Saca de
// `src/App.jsx` la cuenta y la EJECUTA; y para la pantalla no se conforma con
// eso: saca del JSX el `texto` de la alarma —la expresión que de verdad se
// imprime— y lo evalúa con el resultado de la cuenta. Así la alarma no puede
// publicar una cifra distinta de la que calculó: una cuenta por número.
//
// LAS SEIS AFIRMACIONES:
//
//   §1. Al año sólo entra lo que trae fecha de factura DE ESE AÑO. Ni el
//       periodo, ni «es del año porque la obra es de este año».
//   §2. El hueco se parte en dos, y con los números medidos en producción.
//   §3. La alarma nombra sólo lo corregible, agrupado por obra y con el rótulo
//       de cada fila — una alarma que no dice a qué renglón ir es ruido.
//   §4. Una obra CERRADA sigue sumando al año. Es la propiedad por la que el
//       cierre existe, y por eso se mide aquí y no sólo en las reglas.
//   §5. La pantalla imprime lo que la cuenta dice: el renglón de la alarma
//       publica las filas y el dinero que devolvió la misma llamada.
//   §6. La basura no envenena: estatus en mayúsculas, monto en texto, fecha
//       mal formada. Un `NaN` en este total sería un «$NaN» en el tablero.
//
// Uso:
//     node scripts/prueba-lo-facturado-del-anio.cjs
//     node scripts/prueba-lo-facturado-del-anio.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');

// ── LA CUENTA VIVA ─────────────────────────────────────────────────────────
const PEDIDOS = ['facturadoDelAnio', 'alarmasDeFacturaSinFecha',
                 'ESTATUS_YA_FACTURADO', 'MXN'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan, path.basename(archivo));
const APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
const { facturadoDelAnio, alarmasDeFacturaSinFecha, MXN } = APP;

// ── LO QUE LA PANTALLA IMPRIME, SACADO DEL JSX ─────────────────────────────
// El `texto` de la alarma, buscado por su etiqueta de tipo —no por una
// variable: el día que alguien renombre `facturado`, esta prueba tiene que
// seguir mirando el mismo renglón. Si el ancla se rompe es NO ARRANCÓ, porque
// lo que hay que arreglar es el ancla y no se puede fingir que se midió.
//
// Es el renglón que el usuario lee y sobre el que pincha, y desde que la
// tarjeta del año salió del tablero es el ÚNICO sitio donde el hueco se ve.
function textoDeLaAlarma() {
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  let hallado = null;
  traverse(ast, {
    ObjectExpression(p) {
      if (hallado) return;
      const props = p.node.properties.filter(q => q.type === 'ObjectProperty');
      const tipo = props.find(q => q.key?.name === 'tipo');
      if (!tipo || src.slice(tipo.value.start, tipo.value.end) !== "'factura_sin_fecha'") return;
      const texto = props.find(q => q.key?.name === 'texto');
      if (texto) hallado = src.slice(texto.value.start, texto.value.end);
    },
  });
  return hallado;
}

const TEXTO_ALARMA = textoDeLaAlarma();
if (!TEXTO_ALARMA) {
  console.error("\nNO ARRANCÓ: no se halló la excepción `tipo: 'factura_sin_fecha'`.");
  console.error('Es el renglón de «Requiere atención» que esta prueba viene a mirar.');
  process.exit(2);
}

// Evalúa UNA expresión del JSX con los nombres que el tablero le da de comer.
// Un `ReferenceError` aquí es andamiaje roto, no semántica: sube como 2.
const evaluar = (expr, ambito) => {
  const nombres = Object.keys(ambito);
  try {
    return new Function(...nombres, `"use strict"; return (${expr});`)
      (...nombres.map(n => ambito[n]));
  } catch (e) {
    console.error(`\nNO ARRANCÓ: no se pudo evaluar una expresión del tablero: ${e.message}`);
    console.error(`  era: ${String(expr).slice(0, 200)}`);
    process.exit(2);
  }
};

// El ámbito se le da COMPLETO, igual que el tablero: donde vive esa expresión
// están a la vista `a` —la alarma de una obra— y también `facturado`, el
// resumen de toda la cartera. Darle sólo `a` haría que un renglón que publica
// el total de la cartera reventara el banco en vez de salir en rojo, o sea que
// el defecto más probable de este renglón no se podría medir.
const pintarAlarma = (a, facturado) => evaluar(TEXTO_ALARMA, { a, facturado, MXN });

// ── EL ESCENARIO: PRODUCCIÓN, TAL COMO SE MIDIÓ ────────────────────────────
// Los montos y los estatus salen de `medir-que-hace-archivar-una-obra.cjs
// --prod` del 2026-11-10. Son los que ESA SALIDA IMPRIME, o sea ya redondeados
// al peso; por eso las sumas derivadas de aquí pueden quedar a un peso de las
// que imprime la medición ($105,741,938 contra $105,741,937, $181,695,980
// contra $181,695,981). Se deja dicho en vez de cuadrarlo a mano: un número
// ajustado para que case es exactamente lo que esta prueba vino a impedir.
const SIN_FECHA_PROD = [
  { obra: '0112', no: 6, estatus: 'Pagada',     monto: 1157648 },
  { obra: '0112', no: 7, estatus: 'Pagada',     monto: 289997 },
  { obra: '0127', no: 1, estatus: 'Facturada',  monto: 7315124 },
  { obra: '0127', no: 2, estatus: 'Facturada',  monto: 23813069 },
  { obra: '0126', no: 5, estatus: 'En proceso', monto: 20123825 },
  { obra: '0127', no: 3, estatus: 'En proceso', monto: 44044477 },
  { obra: '0128', no: 1, estatus: 'En proceso', monto: 3944642 },
  { obra: '0131', no: 1, estatus: 'Aprobada',   monto: 5053156 },
];
const A_CORREGIR_PROD  = 1157648 + 289997 + 7315124 + 23813069;   // 32,575,838
const TODAVIA_NO_PROD  = 20123825 + 44044477 + 3944642 + 5053156; // 73,166,100

// Lo SÍ fechado en 2026, por obra. Va condensado en un renglón por obra: lo
// que se mide aquí es la agregación y lo que la tarjeta publica, no cuántas
// filas tiene cada obra — y partir $24,261,520 en cinco montos que nadie midió
// sería teclear cinco cifras falsas para que la cuenta de renglones cuadre.
const DEL_ANIO_PROD = [
  { obra: '0112', monto: 24261520 },
  { obra: '0114', monto: 109240537 },
  { obra: '0125', monto: 14794135 },
  { obra: '0126', monto: 33399788 },
];
const DEL_ANIO_TOTAL = DEL_ANIO_PROD.reduce((t, e) => t + e.monto, 0); // 181,695,980

const obraDe = (id, extra = {}) => ({ id, clave: id, nombre: `Obra ${id}`, ...extra });

// El escenario en la forma que el tablero le pasa a la cuenta.
const carteraProd = () => {
  const porObra = new Map();
  const mete = (id, fila) => {
    if (!porObra.has(id)) porObra.set(id, { obra: obraDe(id), estimaciones: [] });
    porObra.get(id).estimaciones.push(fila);
  };
  for (const e of SIN_FECHA_PROD) mete(e.obra, { no: e.no, estatus: e.estatus, monto: e.monto });
  for (const e of DEL_ANIO_PROD)
    mete(e.obra, { no: 99, estatus: 'Pagada', monto: e.monto, fechaFact: '2026-06-30' });
  return [...porObra.values()];
};

function correr() {
  const fallos = [];
  const callado = !!process.env.CALLADO;
  const ok = (cond, que, detalle = '') => {
    if (cond) { if (!callado) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`);
  };
  const sec = (t) => { if (!callado) console.log(`\n${t}`); };

  // ══ §1 · AL AÑO SÓLO ENTRA LO QUE TRAE FECHA DE FACTURA DE ESE AÑO ═══════
  sec('§1 · al año sólo entra lo que trae fecha de factura de ese año');

  const UNA_OBRA = (filas) => [{ obra: obraDe('0112'), estimaciones: filas }];

  const conFecha = facturadoDelAnio(UNA_OBRA([
    { no: 1, estatus: 'Pagada',    monto: 1000, fechaFact: '2026-03-15' },
    { no: 2, estatus: 'Facturada', monto: 2000, fechaFact: '2026-11-01' },
  ]), 2026);
  ok(conFecha.monto === 3000 && conFecha.cuantas === 2,
    'dos fechadas en el año suman al año',
    `salió ${conFecha.monto} en ${conFecha.cuantas}`);

  const otroAnio = facturadoDelAnio(UNA_OBRA([
    { no: 1, estatus: 'Pagada', monto: 1000, fechaFact: '2025-12-31' },
    { no: 2, estatus: 'Pagada', monto: 2000, fechaFact: '2026-01-01' },
  ]), 2026);
  ok(otroAnio.monto === 2000 && otroAnio.cuantas === 1,
    'la del 31 de diciembre anterior no se cuela al año siguiente',
    `salió ${otroAnio.monto}`);
  ok(otroAnio.sinFecha.cuantas === 0,
    'y tampoco se cuenta como hueco: tiene fecha, sólo que de otro año',
    `se contaron ${otroAnio.sinFecha.cuantas} sin fecha`);

  // EL CASO QUE COSTABA $105M. La estimación trae el año escrito en el
  // periodo, en texto, y hasta en el estatus de pagada. Nada de eso es una
  // fecha de factura.
  const soloPeriodo = facturadoDelAnio(UNA_OBRA([
    { no: 1, estatus: 'Pagada', monto: 9999, periodo: '01-30 de septiembre de 2026' },
  ]), 2026);
  ok(soloPeriodo.monto === 0 && soloPeriodo.cuantas === 0,
    'un periodo que dice 2026 no coloca la estimación en 2026',
    `salió ${soloPeriodo.monto}`);
  ok(soloPeriodo.sinFecha.monto === 9999,
    'se va al hueco, que es el único sitio honesto para ella');

  // ══ §2 · EL HUECO SE PARTE EN DOS, CON LOS NÚMEROS DE PRODUCCIÓN ═════════
  sec('§2 · el hueco se parte en dos, con los números medidos en producción');

  const prod = facturadoDelAnio(carteraProd(), 2026);

  ok(prod.monto === DEL_ANIO_TOTAL,
    `lo fechado en 2026 suma ${MXN(DEL_ANIO_TOTAL)} — y es lo único que el año publica`,
    `salió ${MXN(prod.monto)}`);

  ok(prod.sinFecha.cuantas === 8,
    'las ocho sin fecha de producción se reconocen como hueco',
    `salieron ${prod.sinFecha.cuantas}`);

  ok(prod.aCorregir.length === 4 && prod.montoACorregir === A_CORREGIR_PROD,
    `a corregir: 4 estimaciones, ${MXN(A_CORREGIR_PROD)} — facturadas o pagadas sin fecha`,
    `salieron ${prod.aCorregir.length} por ${MXN(prod.montoACorregir)}`);

  ok(prod.todaviaNo.length === 4 && prod.montoTodaviaNo === TODAVIA_NO_PROD,
    `todavía no toca: 4 estimaciones, ${MXN(TODAVIA_NO_PROD)} — no se han facturado`,
    `salieron ${prod.todaviaNo.length} por ${MXN(prod.montoTodaviaNo)}`);

  ok(prod.montoACorregir + prod.montoTodaviaNo === prod.sinFecha.monto,
    'las dos partes suman el hueco entero: ninguna estimación se pierde al partir');

  ok(prod.aCorregir.every(f => ['Facturada', 'Pagada'].includes(f.estatus)),
    'y en «a corregir» no se cuela ninguna que todavía no se haya facturado',
    prod.aCorregir.map(f => `${f.rotulo} ${f.estatus}`).join(' · '));

  // ══ §3 · LA ALARMA NOMBRA SÓLO LO CORREGIBLE, Y DICE A QUÉ FILA IR ═══════
  sec('§3 · la alarma nombra sólo lo corregible, agrupado por obra');

  const alarmas = alarmasDeFacturaSinFecha(prod, (o) => o.nombre);
  ok(alarmas.length === 2,
    'dos obras tienen algo que corregir: la 0112 y la 0127',
    `salieron ${alarmas.length}: ${alarmas.map(a => a.obraId).join(' · ')}`);

  const a0112 = alarmas.find(a => a.obraId === '0112');
  ok(a0112 && a0112.rotulos.length === 2,
    'la obra con dos filas sin fechar es UN renglón, no dos',
    a0112 ? `trae ${a0112.rotulos.length} rótulos` : 'no salió la 0112');
  ok(a0112 && a0112.rotulos.join(',') === 'EST-06,EST-07',
    'y nombra cuál es cada una: EST-06 y EST-07',
    a0112 ? a0112.rotulos.join(',') : '—');
  ok(a0112 && a0112.monto === 1157648 + 289997,
    'con el dinero de esa obra, no el del total');

  const ids = alarmas.map(a => a.obraId);
  ok(!ids.includes('0126') && !ids.includes('0128') && !ids.includes('0131'),
    'y las obras cuyo único hueco es «todavía no se factura» NO reciben alarma',
    `se colaron: ${ids.filter(i => ['0126','0128','0131'].includes(i)).join(' · ')}`);

  const limpio = facturadoDelAnio(UNA_OBRA([
    { no: 1, estatus: 'Pagada', monto: 1000, fechaFact: '2026-03-15' },
  ]), 2026);
  ok(alarmasDeFacturaSinFecha(limpio).length === 0,
    'sin nada que corregir, la alarma calla — y eso es silencio honesto');

  // ══ §4 · LA OBRA CERRADA SIGUE SUMANDO AL AÑO ════════════════════════════
  sec('§4 · la obra cerrada sigue sumando al año — es para lo que existe el cierre');

  const cartera = [
    { obra: obraDe('0112', { estado: 'cerrada' }),
      estimaciones: [{ no: 1, estatus: 'Pagada', monto: 5000, fechaFact: '2026-05-10' }] },
    { obra: obraDe('0126'),
      estimaciones: [{ no: 1, estatus: 'Pagada', monto: 3000, fechaFact: '2026-06-10' }] },
  ];
  const conCerrada = facturadoDelAnio(cartera, 2026);
  ok(conCerrada.monto === 8000,
    'el dinero de la obra cerrada entra al total del año igual que el de la activa',
    `salió ${conCerrada.monto}`);

  // Y la cuenta no mira el estado: cerrar no cambia la aritmética, lo que la
  // cambia es quién le entrega la cartera. Ése es el reparto que esta rama
  // deja fijo, y el tablero no le pasa las archivadas.
  const soloActivas = facturadoDelAnio([cartera[1]], 2026);
  ok(soloActivas.monto === 3000,
    'y la que se saca de la cartera deja de sumar: por eso archivar se declara',
    `salió ${soloActivas.monto}`);

  // ══ §5 · LA PANTALLA IMPRIME LO QUE LA CUENTA DICE ═══════════════════════
  sec('§5 · la pantalla imprime lo que la cuenta dice, no un número tecleado aparte');

  // Lo que se mide aquí es el renglón de «Requiere atención», no una tarjeta:
  // el total del año salió del tablero el 2026-11-16 y con él sus aserciones
  // (ver la nota de la cabecera). Esta mitad es la accionable, y ahora es la
  // ÚNICA que enseña el hueco, así que se mide entera: la obra, las filas y el
  // dinero, los tres contra lo que devolvió la cuenta.
  //
  // La 0127 tiene que SEGUIR teniendo alarma. Si no la tiene, la cuenta dejó
  // de ver el hueco — y eso es una aserción caída, no un banco roto: por eso
  // se comprueba antes de pintar en vez de dejar que reviente al pintar.
  const a0127 = alarmas.find(a => a.obraId === '0127');
  ok(!!a0127, 'la 0127 sigue teniendo alarma que pintar',
    `alarmas: ${alarmas.map(a => a.obraId).join(' · ') || 'ninguna'}`);
  const renglon = a0127 ? pintarAlarma(a0127, prod) : '';
  ok(renglon.includes('EST-01') && renglon.includes('EST-02'),
    'la alarma impresa nombra las filas a las que hay que ir', renglon || '(no se pintó)');
  ok(renglon.includes(MXN(7315124 + 23813069)),
    'y publica el dinero de esa obra, el mismo que devolvió la cuenta', renglon || '(no se pintó)');
  ok(renglon.includes(a0127 ? a0127.nombre : '\u0000'),
    'y nombra la obra, que es a dónde lleva el enlace', renglon || '(no se pintó)');

  // Y no publica el total: el renglón habla del dinero de SU obra. Si pintara
  // el hueco entero, las dos alarmas dirían la misma cifra y el usuario leería
  // $105M dos veces — que es la mala lectura que la tarjeta del año tenía que
  // evitar, reapareciendo en el único sitio que queda.
  ok(!renglon.includes(MXN(prod.sinFecha.monto)),
    'y no publica el hueco de toda la cartera en el renglón de una obra',
    renglon || '(no se pintó)');

  // ══ §6 · LA BASURA NO ENVENENA EL TOTAL ══════════════════════════════════
  sec('§6 · la basura no envenena el total — un $NaN en el tablero es peor que un cero');

  const sucio = facturadoDelAnio(UNA_OBRA([
    { no: 1, estatus: '  PAGADA ', monto: '1000', fechaFact: '2026-03-15' },
    { no: 2, estatus: 'facturada', monto: 'no es un número' },
    { no: 3, estatus: 'Pagada',    monto: 500, fechaFact: 'en septiembre' },
    { no: 4 },
  ]), 2026);
  ok(sucio.monto === 1000,
    'un monto en texto se suma como número y el total no sale NaN',
    `salió ${sucio.monto}`);
  ok(Number.isFinite(sucio.sinFecha.monto),
    'el hueco tampoco sale NaN', `salió ${sucio.sinFecha.monto}`);
  ok(sucio.aCorregir.length === 2,
    'el estatus con mayúsculas o espacios se reconoce igual: son dos a corregir',
    `salieron ${sucio.aCorregir.length}: ${sucio.aCorregir.map(f => f.estatus).join(' · ')}`);
  ok(sucio.aCorregir.some(f => f.rotulo === 'EST-03'),
    'la de fecha ilegible se trata como sin fecha, no como del año');

  // «1,500.00» con coma de miles. `parseFloat` devuelve **1** —ése fue el
  // defecto que obligó a unificar la lectura del monto en `montoDeEstimacion`—
  // y un 1 no se ve como error, se ve como una estimación chica que nadie va a
  // ir a buscar. Un cero sí se ve como hueco.
  const conComa = facturadoDelAnio(UNA_OBRA([
    { no: 1, estatus: 'Pagada', monto: '1,500.00', fechaFact: '2026-04-01' },
  ]), 2026);
  ok(conComa.monto !== 1,
    'un monto con coma de miles no entra al año valiendo $1',
    `salió ${conComa.monto}`);
  ok(facturadoDelAnio([], 2026).monto === 0 &&
     facturadoDelAnio(undefined, 2026).monto === 0,
    'y una cartera vacía da cero sin reventar');

  return fallos;
}

// ── LAS MUTACIONES ─────────────────────────────────────────────────────────
// Cada una vuelve a poner un defecto plausible, dejando el archivo compilando
// y la pantalla con aspecto razonable.
const MUTACIONES = [
  ['las sin fecha se cuelan al año: $105M de calendario inventado',
    `    if (a === anio) { delAnio += monto(e); cuantasDelAnio++; continue; }`,
    `    if (a === anio || a === null) { delAnio += monto(e); cuantasDelAnio++; continue; }`],

  ['el año se saca del periodo cuando no hay fecha de factura',
    `  const t = String(e?.fechaFact || '');
  const m = /^(\\d{4})-\\d{2}-\\d{2}/.exec(t);`,
    `  const t = String(e?.fechaFact || e?.periodo || '');
  const m = /(\\d{4})/.exec(t);`],

  ['una fechada en otro año se cuenta como hueco del año en curso',
    `      if (a !== null) continue;             // fechada en otro año: ni suma ni es hueco`,
    `      if (false) continue;`],

  ['la alarma manda a corregir las ocho, incluidas las que están bien',
    `      (yaFacturado.has(normal(e?.estatus)) ? aCorregir : todaviaNo).push(fila);`,
    `      aCorregir.push(fila);`],

  ['la alarma deja de agrupar: tres filas de una obra son tres viajes',
    `  return [...porObra.entries()].map(([obraId, { obra, filas }]) => ({
    obraId,
    monto: filas.reduce((t, f) => t + f.monto, 0),
    rotulos: filas.map((f) => f.rotulo),
    nombre: nombreDe(obra),
  }));`,
    `  return (resumen?.aCorregir || []).map((f) => ({
    obraId: f.obraId, monto: f.monto, rotulos: [f.rotulo], nombre: nombreDe(f.obra),
  }));`],

  ['la alarma deja de nombrar la fila y dice «ve a buscar»',
    `      texto: \`\${a.nombre} — \${a.rotulos.join(', ')} sin fecha de factura (\${MXN(a.monto)}): no suman al año\`,`,
    `      texto: \`\${a.nombre} — tiene estimaciones sin fecha de factura\`,`],

  // ESTA MUTACIÓN ESTABA PODRIDA Y LA CONTRAPRUEBA ERA ROJA (2026-11-16).
  // Buscaba una copia local del monto —`const monto = (e) => { parseFloat… }`—
  // que ya no existe: `facturadoDelAnio` pasó a leer `montoDeEstimacion`, la
  // misma lectura que el resto del archivo, y el anclaje se quedó apuntando al
  // código viejo. O sea que desde ese cambio esta mutación salía como NO
  // ARRANCÓ y no medía nada. Se reancla en la lectura de hoy, y se parte en
  // dos porque son dos defectos distintos y sólo uno se veía antes.
  ['el monto deja de normalizarse y un texto envenena el total con NaN',
    `  const monto = montoDeEstimacion;`,
    `  const monto = (e) => Number(e?.monto);`],

  // Y el defecto que motivó unificar la lectura: `parseFloat("1,500.00")` es
  // **1**. Un cero se ve como hueco; un 1 se ve como una estimación chica, y
  // nadie lo va a buscar.
  ['la coma del monto se come la cifra y $1,500.00 entra al año como $1',
    `  const monto = montoDeEstimacion;`,
    `  const monto = (e) => {
    const n = parseFloat(e?.monto);
    return Number.isFinite(n) ? n : 0;
  };`],

  ['el estatus se compara crudo y una «PAGADA» deja de ser un hueco corregible',
    `  const normal = (s) => String(s || '').trim().toLowerCase();`,
    `  const normal = (s) => String(s || '');`],

  // AQUÍ ESTABAN CUATRO MUTACIONES MÁS, todas contra el JSX de la tarjeta del
  // año: que se callara el hueco, que revolviera las ocho en una advertencia,
  // que publicara el histórico en vez de lo del año, y que archivar dejara de
  // declararse. Se fueron con la tarjeta. No se sustituyen por equivalentes
  // sobre la alarma porque ya los hay —«manda a corregir las ocho», «deja de
  // agrupar», «deja de nombrar la fila»— y una mutación duplicada no mide dos
  // veces: da dos veces el mismo verde.

  // Dos defectos del renglón que antes no hacía falta vigilar porque la cifra
  // del año estaba al lado y los delataba por contraste. Ahora el renglón está
  // solo, así que se miden: que publique el hueco de TODA la cartera (y las dos
  // alarmas digan la misma cifra), y que deje de nombrar la obra (y el enlace
  // no diga a dónde lleva).
  ['el renglón de una obra publica el hueco de toda la cartera',
    `sin fecha de factura (\${MXN(a.monto)}): no suman al año\`,`,
    `sin fecha de factura (\${MXN(facturado.sinFecha.monto)}): no suman al año\`,`],

  ['el renglón deja de nombrar la obra y el enlace no dice a dónde lleva',
    `      texto: \`\${a.nombre} — \${a.rotulos.join(', ')} sin fecha`,
    `      texto: \`\${a.rotulos.join(', ')} sin fecha`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facturado-anio-'));
  let i = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!src.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 200)}`);
      process.exit(2);
    }
    const f = path.join(dir, `app-${i++}.jsx`);
    fs.writeFileSync(f, src.replace(de, a));
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f, CALLADO: '1' }, encoding: 'utf8' });
    if (r.status === 2) {
      console.error(`NO ARRANCÓ: «${titulo}» revienta el banco en vez de romper la semántica`);
      console.error([r.stdout, r.stderr].join('\n').split('\n')
        .filter(l => /NO ARRANCÓ|excepción/.test(l)).join('\n'));
      process.exit(2);
    }
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

console.log('LO FACTURADO DEL AÑO, Y EL HUECO QUE NO CABE EN ÉL');
const fallos = correr();
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) caídas.`);
  for (const f of fallos) console.error(`  · ${f}`);
  process.exit(1);
}
console.log('\nverde: el total del año no se traga lo que no puede fechar, y lo confiesa.\n');
process.exit(0);
