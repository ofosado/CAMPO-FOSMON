#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL INFORME DEL ART. 73: EL AVANCE FÍSICO CONTRA EL FINANCIERO, Y NADA MÁS
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que el papel IMPRIME. `generarPDFArt73` se saca de
// `src/App.jsx`, se mueve sobre un jsPDF de mentira y lo que se mira es el
// texto que manda a la hoja.
//
// POR QUÉ ESTE PAPEL NECESITA SU PROPIO BANCO, y no una sección más del banco
// del documento interno: los dos papeles tienen criterios OPUESTOS sobre la
// misma obra el mismo día. El interno se lee hacia adentro y publica el gasto y
// el margen; éste SE ENTREGA A LA DEPENDENCIA y no los conoce. Un banco que
// midiera los dos tendría que elegir uno de los dos criterios.
//
// Y SE ARCHIVA POR AÑOS. Es la diferencia de riesgo con los otros dos papeles:
// una cifra mal puesta en el reporte semanal se corrige la semana que entra, y
// una mal puesta aquí queda en un expediente que alguien va a leer para
// discutir una multa cuando nadie se acuerde de cómo se generó.
//
// LAS SIETE AFIRMACIONES:
//
//   A. LA FRONTERA ESTÁ EN LA FIRMA, NO EN UN FILTRO. Al generador se le pasa
//      la economía ENTERA del contratista —gasto de GP, nómina, maquinaria,
//      subcontratos, materiales— y el papel no imprime ni una de esas cifras.
//      No porque las esconda: no las recibe. La prueba se hace EMPUJÁNDOSELAS,
//      que es la única forma de afirmar la frontera en vez de suponerla.
//
//   B. NINGUNA CIFRA NUEVA. Las cinco de dinero y el avance físico son, letra
//      por letra, los que `presentacionDependencia` ya resolvió para el tablero
//      de la dependencia. El banco los calcula con la MISMA función y exige la
//      coincidencia: si el generador formateara por su cuenta, el papel que el
//      municipio archiva y la pantalla desde la que lo pidió podrían discrepar
//      sobre el mismo peso.
//
//   C. LA DIFERENCIA ES UNA RESTA DE LAS DOS CIFRAS PUBLICADAS, no una tercera
//      medición — y cuando le falta cualquiera de los dos lados NO se imprime
//      ningún número. Es el corazón del papel: la pregunta que la dependencia
//      le hace a una obra es cómo va el avance económico contra el físico.
//
//   D. UN CERO NO SE DISFRAZA DE MEDICIÓN. Sin catálogo de conceptos el avance
//      físico y el ejecutado salen con RAYA, no con «0.0%» y «$0»; y sin
//      estimaciones leídas, lo estimado, lo pagado y el saldo también. Las dos
//      lecturas de un cero —«no arrancó» y «no sabemos»— llevan a cosas
//      opuestas, y la primera se le reclama a un contratista.
//
//   E. SE ENTREGA, ASÍ QUE NO LLEVA SELLO DE INTERNO — y declara de dónde salió
//      en vez de inventar quién lo firma.
//
//   F. LAS FOTOS SE ROTULAN «SUBIDA», NUNCA CON UNA FECHA DE EJECUCIÓN. El
//      sistema no lee la fecha de la cámara. Un expediente que archiva una foto
//      como «avance de la semana N» afirma por años algo que nadie capturó.
//
//   G. LOS CORRESPONSABLES VAN NOMBRADOS, Y SON LOS DOS QUE LA LEY NOMBRA. El
//      art. 73 párr. 2 hace al residente designado por el Ente Público y al
//      superintendente CORRESPONSABLES de la calidad y debida ejecución. Un
//      informe de corresponsabilidad que no los nombra deja al expediente sin
//      saber a quién se le reclama. Y el residente que va aquí es el de la
//      DEPENDENCIA: imprimir en su lugar al residente del contratista —que es
//      otra persona, guardada en otra clave, y es a quien la app le dio esa
//      palabra— publicaría a un empleado del contratista como el servidor
//      público designado. El banco se lo empuja al generador para medirlo.
//      Cuando el campo no está capturado el papel lo DECLARA, que es lo único
//      honesto en una hoja que se archiva por años.
//
// LAS SEMANAS SON LAS DE HOY, no unas fijas: `semanasDeVentana` arma su ventana
// contra el reloj de la obra. Un caso con semanas tecleadas fallaría al cambiar
// de año, que es justo la frecuencia con la que se culpa al azar.
//
//   node scripts/prueba-el-informe-del-articulo-73.cjs
//   node scripts/prueba-el-informe-del-articulo-73.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
// `textoCorrido` pega los renglones que salieron de UNA llamada a `text`. Las
// notas de este papel son párrafos largos que el generador parte para que
// quepan en la caja, así que un `includes` renglón por renglón pierde justo la
// frase que queda a caballo del corte.
const { dibujarPDFInterno, textoCorrido } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
// Se piden las que el banco necesita EJECUTAR para armar su expectativa, no
// sólo el generador: la de B sale de la misma función que alimenta la pantalla,
// así que el banco no tiene una segunda copia de ninguna cuenta. El cierre
// transitivo trae el resto.
// `camposContrato` y `NO_CAPTURADO` entran por la §G: la una dice con qué
// rótulo se CAPTURA al residente y el papel dice con cuál se PUBLICA, y los dos
// tienen que ser el mismo; el otro es el vocabulario de la ausencia, que el
// banco no debe tener tecleado por su cuenta —si mañana la casa cambia
// «(no capturado)» por otra fórmula, la aserción tiene que seguirla, no
// contradecirla.
// `riesgosDeDependencia` y `BIBLIOTECA_RIESGOS` entran por la §H, y por el
// mismo motivo que `economiaDeDependencia` entró por la §B: la §5 del papel
// publica un veredicto de riesgo, y la expectativa de lo que tiene que estar
// impreso sale del MISMO veredicto que lo alimenta. Teclear aquí los títulos de
// las reglas haría que la aserción siguiera diciendo verde el día que el papel
// dejara de imprimirlos y la biblioteca los renombrara.
// `hoyLocalISO` es el calendario de la obra: las fechas del caso se construyen
// desde ahí, no desde `new Date()`, que al oeste de Greenwich pinta el día
// anterior y correría el plazo de ley un día.
const PEDIDOS = ['generarPDFArt73', 'economiaDeDependencia', 'presentacionDependencia',
  'semanasDeVentana', 'selloDeTiempo', 'textoImprimible',
  'camposContrato', 'NO_CAPTURADO',
  'riesgosDeDependencia', 'BIBLIOTECA_RIESGOS', 'hoyLocalISO'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltan.join(', ')}`);
  process.exit(2);
}
let APP;
try {
  APP = new Function('React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
    `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)(...Array(6).fill(() => {}));
} catch (e) {
  console.error(`\nNO ARRANCÓ: no se pudo montar lo extraído de ${archivo}: ${e.message}`);
  process.exit(2);
}
const { generarPDFArt73, economiaDeDependencia, presentacionDependencia,
        semanasDeVentana, textoImprimible, camposContrato, NO_CAPTURADO,
        riesgosDeDependencia, BIBLIOTECA_RIESGOS, hoyLocalISO } = APP;

// La única transformación que el papel le hace a la cadena de la pantalla es
// pasarla por la puerta de la fuente: las helvetica estándar de jsPDF sólo
// escriben WinAnsi. Ver `prueba-el-pdf-escribe-lo-que-se-lee.cjs`, que es donde
// se afirma la puerta.
const enLaHoja = (s) => textoImprimible(s);

// ── EL ARMADO DE LOS CASOS ─────────────────────────────────────────────────
const AÑO = new Date().getFullYear();
const SELLO = { ms: Date.UTC(2026, 2, 15, 18, 0, 0), fuente: 'servidor' };

// La obra se llama de modo que su nombre NO contenga el de ninguna empresa: la
// §A mira cuántas veces aparece «FOSMON» en la hoja, y un nombre de obra que lo
// trajera la cumpliría por accidente.
//
// LOS TRES NOMBRES SON DISTINTOS Y NINGUNO ES PREFIJO DE OTRO, a propósito: la
// §G afirma que el papel publica al residente DE LA DEPENDENCIA y no al del
// contratista, y con nombres parecidos un `includes` daría verde con el
// equivocado impreso.
const RESIDENTE_DEP   = 'Arq. Rosalba Uscanga Prieto';
const SUPERINTENDENTE = 'Ing. Aldo Torres Aculteco';
const RESIDENTE_CONTR = 'C. Melquiades Fierro Zavaleta';

const OBRA = {
  id: '0131', nombre: 'Centro de convenciones', contrato: 'SIOP-2026-0131',
  cliente: 'H. Ayuntamiento de Coatzacoalcos',
  inicio: `${AÑO - 1}-02-02`, fin: `${AÑO + 1}-06-30`,
  presupuesto: 45000000, gpId: '0131', diasPago: 30,
  supervisorDependencia: RESIDENTE_DEP,
  superintendente: SUPERINTENDENTE,
  // El residente del CONTRATISTA viaja en la obra porque en producción viaja:
  // es el mismo documento. Que esté aquí es lo que permite afirmar que el papel
  // no lo confunde con el otro, en vez de suponerlo porque la clave no se lee.
  residente: RESIDENTE_CONTR,
};

const SEMS = semanasDeVentana(OBRA, 12);
if (SEMS.length < 5) {
  console.error(`\nNO ARRANCÓ: la ventana salió con ${SEMS.length} semanas; `
    + 'sin ventana la gráfica de la §4 no dibuja y las aserciones de la curva '
    + 'saldrían verdes por vacío.');
  process.exit(2);
}
const N = SEMS.length;

// Un corte de avance por semana de la ventana, con el dinero subiendo. Es lo
// que le da ritmo a la proyección y semanas a la gráfica.
const HIST = SEMS.map((s, i) => ({
  tipo: 'oficial', año: s.año, semana: s.sem,
  avance: 10 * (i + 1), avancePonderado: 10 * (i + 1),
  montoEjecutado: 2000000 * (i + 1),
  fechaCaptura: '2026-03-10T12:00:00.000Z',
  fechaCierre: '2026-03-10T12:00:00.000Z',
}));

// Dos partidas que suman el contrato al peso, con avances distintos: así el
// ejecutado ponderado no coincide con ninguno de los dos porcentajes de partida
// y la §B no puede salir verde por casualidad aritmética.
const CATALOGO = [
  { id: 'p1', sec: 'A-01', sub: 'Obra civil',     imp: 31500000, a: 70.67 },
  { id: 'p2', sec: 'A-02', sub: 'Instalaciones',  imp: 13500000, a: 20 },
];

// Estimaciones con DOS estados: una pagada y una nada más recibida. Lo pagado
// tiene que salir distinto de lo estimado, o la §C mediría una resta en la que
// los dos lados son el mismo número.
const ESTIMACIONES = [
  { id: 'e1', num: 1, monto: 9000000, estatus: 'Pagada',   fecha: `${AÑO}-01-15` },
  { id: 'e2', num: 2, monto: 7000000, estatus: 'Recibida', fecha: `${AÑO}-02-15` },
];

// La evidencia llega al generador YA NORMALIZADA: `evidenciaNormalizada` se
// aplica al leerla de Firestore, no dentro del generador. Un caso con la forma
// cruda mediría un papel que en producción no existe.
const EVIDENCIA = [
  { id: 'f1', partidaId: 'p1', sec: 'A-01', sub: 'Obra civil', url: null,
    origen: 'captura_en_vivo', verificada: true,
    fechaServidor: '2026-02-10', fechaDeclarada: null, anulada: false },
  { id: 'f2', partidaId: 'p1', sec: 'A-01', sub: 'Obra civil', url: null,
    origen: 'galeria', verificada: false,
    fechaServidor: null, fechaDeclarada: '2026-01-22', anulada: false },
  { id: 'f3', partidaId: 'p2', sec: 'A-02', sub: 'Instalaciones', url: null,
    origen: 'galeria', verificada: false,
    fechaServidor: null, fechaDeclarada: null, anulada: false },
];

const datosDe = (extra = {}) => ({
  obra: OBRA, subs: CATALOGO, estimaciones: ESTIMACIONES,
  historialAvance: HIST, programa: null, instante: SELLO,
  organizacion: 'H. Ayuntamiento de Coatzacoalcos',
  generadoPor: 'supervisor@coatza.gob.mx',
  evidencia: EVIDENCIA, evidenciaCargada: true, estCargadas: true,
  ...extra,
});

// La expectativa de B sale de la función de verdad con los MISMOS insumos.
const esperadoDe = (d) => {
  const eco = economiaDeDependencia({ obra: d.obra, subs: d.subs,
    estimaciones: d.estimaciones, estCargadas: d.estCargadas });
  return { eco, pres: presentacionDependencia(eco) };
};

// LAS PÁGINAS DONDE SE PUBLICAN LAS CIFRAS, que son las secciones 2 y 3. Hace
// falta acotarlo porque el EJE de la gráfica de la sección 4 rotula su origen
// «$0», y ése sí es un cero legítimo: es la marca de una escala, no una cifra
// medida. Un «no aparece $0 en ninguna parte» acusaría al papel de publicar un
// cero disfrazado cuando lo que publicó fue una regla graduada.
//
// Y SE BUSCAN POR EL TÍTULO, no por el número de página: el informe pagina
// distinto según cuántas incidencias y cuántas fotos traiga la obra, así que un
// `pagina === 2` tecleado dejaría de mirar las cifras el día que la portada
// creciera un renglón.
const paginasDeCifras = (hoja) => {
  const pagDe = (re) => (hoja.find(x => re.test(x.texto)) || {}).pagina;
  const desde = pagDe(/^2\s+AVANCE FÍSICO Y AVANCE FINANCIERO$/);
  const hasta = pagDe(/^4\s+LA OBRA SEMANA A SEMANA$/);
  if (!desde || !hasta || hasta <= desde) {
    console.error('\nNO ARRANCÓ: no se encontraron las secciones 2 y 4 en la hoja, '
      + `así que no se puede acotar dónde van las cifras (2 en ${desde}, 4 en ${hasta}).`);
    process.exit(2);
  }
  return hoja.filter(x => x.pagina >= desde && x.pagina < hasta).map(x => x.texto);
};

const dibujar = async (d) => {
  let dibujos;
  try { dibujos = await dibujarPDFInterno(generarPDFArt73, d); }
  catch (e) {
    console.error(`\nNO ARRANCÓ: el informe no se pudo dibujar: ${e.message}`);
    process.exit(2);
  }
  if (dibujos.length < 60) {
    console.error(`\nNO ARRANCÓ: el informe sólo dibujó ${dibujos.length} textos; `
      + 'con la hoja casi vacía cualquier «no aparece» se cumple por vacío.');
    process.exit(2);
  }
  // UN REVENTÓN ES NO ARRANCÓ, NO UN ROJO. El generador atrapa su propia
  // excepción y alerta; si eso pasa, el papel que el banco mide está cortado a
  // la mitad y las aserciones que buscan ausencias saldrían verdes por vacío.
  if (dibujos.reventones.length) {
    console.error('\nNO ARRANCÓ: el generador reventó y se tragó el error: '
      + JSON.stringify(dibujos.reventones));
    process.exit(2);
  }
  return dibujos;
};

(async () => {

const d = datosDe();
const e = esperadoDe(d);
const hoja = await dibujar(d);
const textos = hoja.map(x => x.texto);
const corrido = textoCorrido(hoja).map(x => x.texto);
const dice = (re) => corrido.some(t => re.test(t));

// ══════════════════════════════════════════════════════════════════════════
// A · LA FRONTERA ESTÁ EN LA FIRMA: LA ECONOMÍA DEL CONTRATISTA NO ENTRA
// ══════════════════════════════════════════════════════════════════════════
// Se le EMPUJA la economía entera. Si la frontera fuera un filtro dentro del
// generador, un filtro mal escrito dejaría pasar una cifra y este bloque la
// vería; si la frontera está en la firma, estos campos no tienen por dónde
// llegar a la hoja. Las dos cosas se miden igual desde aquí, y eso es lo
// correcto: lo que se afirma es que el municipio NO LEE el margen, no cómo se
// consiguió.
console.log('\n── A · la economía del contratista no entra ──────────────────');

const GASTO_GP = 31500000;
const dEmpujado = datosDe({
  maquinaria:   [{ id: 'm1', nombre: 'Retroexcavadora', costoDia: 4500, dias: 40 }],
  materiales:   [{ id: 'mt1', desc: 'Varilla', monto: 320000 }],
  subcontratos: [{ id: 's1', proveedor: 'Pilotes del Golfo', monto: 1200000, pagado: 400000 }],
  otrosGastos:  [{ id: 'g1', concepto: 'Fletes', monto: 180000 }],
  nominaHistorial: [{ semana: `S${SEMS[0].sem}`, año: AÑO, total: 540000 }],
  gpData: { ultimaSemana: `S${SEMS[N-1].sem}`,
    semanasDisponibles: SEMS.map(s => ({ año: s.año, semana: s.sem })),
    obrasPedidas: ['0131'],
    obras: { '0131': { id: '0131', nombre: OBRA.nombre, grandTotal: GASTO_GP,
      semanas: Object.fromEntries(SEMS.map((s, i) => [`S${s.sem}`, 2625000])) } } },
  gpDetalle: [{ obra: '0131', concepto: 'Diesel', monto: 94000 }],
});
const hojaEmp = await dibujar(dEmpujado);
const corridoEmp = textoCorrido(hojaEmp).map(x => x.texto);

// (a) NI UNA DE LAS PALABRAS DE LA ECONOMÍA INTERNA. Se miran por separado para
//     que la falla diga cuál se colló, no sólo que algo se colló.
for (const [palabra, re] of [
  ['gasto',        /\bgast(o|os|ado|ada)\b/i],
  ['margen',       /\bmargen\b/i],
  ['utilidad',     /\butilidad\b/i],
  ['nómina',       /\bn[óo]mina\b/i],
  ['maquinaria',   /\bmaquinaria\b/i],
  ['subcontrato',  /\bsubcontrat/i],
  ['proveedor',    /\bproveedor/i],
]) {
  const donde = corridoEmp.filter(t => re.test(t));
  ok(donde.length === 0,
    `el informe no dice «${palabra}» ni una vez`
    + (donde.length ? ` — sale en: «${donde[0].slice(0, 90)}»` : ''));
}

// (b) NI LA CIFRA, en ninguna de las formas en que se imprimiría. $31,500,000 es
//     el gasto de GP que se le empujó, y además es el importe de la partida
//     grande del catálogo — a propósito: si el papel publicara el gasto, la
//     cifra sería indistinguible de una que sí tiene derecho a estar, y el banco
//     la dejaría pasar. Así que lo que se mide es el RÓTULO que la acompañaría.
ok(!corridoEmp.some(t => /\bgasto total\b/i.test(t) || /por cada \$1/i.test(t)),
  'ni el rótulo del gasto total ni la razón gasto/ejecutado llegan a la hoja');
ok(!corridoEmp.some(t => /\$?540,000/.test(t)),
  'la nómina de la semana no aparece en la hoja con ninguna de sus cifras');
ok(!corridoEmp.some(t => /Pilotes del Golfo/.test(t) || /Retroexcavadora/i.test(t)
                      || /Varilla/i.test(t) || /Diesel/i.test(t)),
  'ningún proveedor, equipo, material ni concepto de gasto se nombra en la hoja');

// (c) Y EMPUJARLE LA ECONOMÍA NO CAMBIÓ EL PAPEL. Es la afirmación de verdad:
//     no es que las cifras no se vean, es que no participan. El mismo informe,
//     letra por letra, con y sin la economía del contratista encima.
const soloTextos = (xs) => JSON.stringify(xs.map(x => [x.pagina, x.texto]));
ok(soloTextos(hoja) === soloTextos(hojaEmp),
  'el informe sale IDÉNTICO con y sin la economía del contratista: no la filtra, no la usa');

// ══════════════════════════════════════════════════════════════════════════
// B · NINGUNA CIFRA NUEVA: LAS CADENAS SON LAS DE LA PANTALLA
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── B · ninguna cifra nueva ───────────────────────────────────');

ok(e.eco.conCatalogo === true && e.eco.medido === true
   && e.eco.pagado !== null && e.eco.avance !== null,
  'el caso completo mide las dos mitades, que es lo que esta sección necesita');

for (const [rotulo, txt] of [
  ['Contratado',  e.pres.contratadoTxt],
  ['Ejecutado',   e.pres.ejecutadoTxt],
  ['Estimado',    e.pres.estimadoTxt],
  ['Pagado',      e.pres.pagadoTxt],
  ['Por ejercer', e.pres.porEjercerTxt],
  ['Avance físico', e.pres.avanceTxt],
]) {
  ok(textos.includes(enLaHoja(txt)),
    `«${rotulo}» imprime lo que la pantalla dice: «${txt}»`);
}
// Y SUS GLOSAS TAMBIÉN. La cifra sola no dice de qué es: «$9,000,000» sin «20%
// del contrato» al lado se lee distinto, y esa glosa es la que un lector usa
// para saber si la obra va cara.
for (const sub of [e.pres.ejecutadoSub, e.pres.estimadoSub, e.pres.pagadoSub,
                   e.pres.porEjercerSub, e.pres.avanceSub]) {
  ok(textos.includes(enLaHoja(sub)),
    `la glosa sale de la pantalla y no de aquí: «${sub}»`);
}

// EL CORTE DECLARA SU ORIGEN. Un informe fechado con el reloj del aparato que
// apretó el botón es un documento oficial con una fecha que nadie puede
// defender; `selloDeTiempo` dice si la hora es del servidor.
ok(dice(/hora del servidor/),
  'el corte del informe declara que la hora es del servidor, no del aparato');

// ══════════════════════════════════════════════════════════════════════════
// C · LA DIFERENCIA ES UNA RESTA DE LAS DOS PUBLICADAS
// ══════════════════════════════════════════════════════════════════════════
// Es la pregunta del papel: cómo va el avance económico contra el físico. La
// cifra impresa tiene que ser la resta de las dos que ya están arriba, al
// decimal, y no una tercera medición.
console.log('\n── C · la diferencia es una resta, no una medición ───────────');

const brecha = e.eco.avance - e.eco.pctPag;
const signo = brecha > 0 ? '+' : brecha < 0 ? '−' : '';
const brechaTxt = `${signo}${Math.abs(brecha).toFixed(1)} pp`;
ok(Math.abs(brecha) > 1,
  `el caso deja una brecha de ${brechaTxt}, así que la aserción no mide un cero`);
ok(textos.includes(enLaHoja(brechaTxt)),
  `la diferencia impresa es la resta de las dos publicadas: «${brechaTxt}»`);
ok(dice(/físico menos financiero/),
  'y el papel dice que es una resta de las dos de arriba, no una medición aparte');
ok(dice(/CONSTRUIDA POR DELANTE DE LO PAGADO/),
  'el signo se lee en palabras: con la obra por delante, lo dice así');

// EL PLAZO NO ES LA VARA DEL AVANCE. El mismo número bajo dos rótulos —«plazo
// transcurrido» y «avance esperado»— se lee como dos mediciones que resultan
// coincidir, y el segundo rótulo afirma que el calendario es la vara. Es el
// defecto que ya se pagó una vez, y del lado del municipio es peor porque el
// atraso es la cifra que una dependencia reclama.
ok(!dice(/avance esperado/i),
  'el papel no rotula ninguna cifra como «avance esperado»');
ok(dice(/NO ES EL AVANCE QUE SE ESPERABA/),
  'y dice con letras que el plazo transcurrido es calendario, no la vara del avance');

// SIN LO PAGADO NO HAY RESTA. Restarle un cero al avance físico daría la brecha
// más grande posible, impresa en un expediente, afirmando que al contratista no
// se le ha pagado nada — cuando lo que pasa es que no se sabe.
const dSinEst = datosDe({ estimaciones: [], estCargadas: false });
const eSinEst = esperadoDe(dSinEst);
ok(eSinEst.eco.pagado === null && eSinEst.eco.avance !== null,
  'el caso sin estimaciones leídas deja el físico medido y lo pagado sin medir');
const corridoSinEst = textoCorrido(await dibujar(dSinEst)).map(x => x.texto);
ok(corridoSinEst.some(t => /sin lo pagado no hay resta/.test(t)),
  'y entonces la diferencia no publica número: dice que sin lo pagado no hay resta');
ok(!corridoSinEst.some(t => /\d+\.\d pp$/.test(t)),
  'ninguna cifra en puntos porcentuales se imprime cuando falta un lado de la resta');
ok(corridoSinEst.some(t => /NO SE PUDO CALCULAR/.test(t)
                        && /no se le ha pagado\s*nada/.test(t)),
  'el motivo va impreso, y dice qué lectura falsa se está evitando');

// ══════════════════════════════════════════════════════════════════════════
// D · UN CERO NO SE DISFRAZA DE MEDICIÓN
// ══════════════════════════════════════════════════════════════════════════
// Sin catálogo de conceptos no hay nada que sumar, y `desgloseEjecutado([])`
// suma cero. Ese cero impreso dice «la obra no ha arrancado», que es una
// afirmación sobre la obra; lo que pasa es que no hay con qué medirla. Las dos
// lecturas llevan a cosas opuestas y la primera se le reclama a alguien.
console.log('\n── D · el cero que no se disfraza de medición ────────────────');

const dSinCat = datosDe({ subs: [] });
const eSinCat = esperadoDe(dSinCat);
ok(eSinCat.eco.conCatalogo === false
   && eSinCat.eco.avance === null && eSinCat.eco.ejecutado === null
   && eSinCat.eco.pctEjec === null,
  'sin catálogo la economía devuelve raya y no cero, que es de donde sale el papel');
// Y LO QUE NO DEPENDE DEL CATÁLOGO SIGUE MEDIDO. Un `null` contagioso borraría
// lo estimado y lo pagado, que salen de las estimaciones y son válidos: el papel
// quedaría vacío y la dependencia sin la mitad que sí se sabe.
ok(eSinCat.eco.pagado === 9000000 && eSinCat.eco.porEjercer === 36000000,
  'lo pagado y el saldo por ejercer NO dependen del catálogo y siguen medidos');

const hojaSinCat = await dibujar(dSinCat);
const textosSinCat = hojaSinCat.map(x => x.texto);
const cifrasSinCat = paginasDeCifras(hojaSinCat);
const corridoSinCat = textoCorrido(hojaSinCat).map(x => x.texto);

ok(!cifrasSinCat.some(t => /^0\.0%$/.test(t)),
  'sin catálogo no se publica «0.0%» en las secciones de avance y de pesos');
ok(!cifrasSinCat.some(t => t === '$0'),
  'ni «$0» en ellas');
ok(textosSinCat.includes(enLaHoja(eSinCat.pres.avanceTxt))
   && eSinCat.pres.avanceTxt === '—',
  'el avance físico sale con raya');
ok(textosSinCat.includes(enLaHoja(eSinCat.pres.ejecutadoSub))
   && /catálogo de conceptos no está cargado/.test(eSinCat.pres.ejecutadoSub),
  'y la glosa nombra el dato que falta: el catálogo de conceptos');
ok(corridoSinCat.some(t => /LA OBRA NO TIENE CATÁLOGO DE CONCEPTOS CARGADO/.test(t)),
  'la sección de observaciones lo declara en voz alta, con su número de renglón');
ok(corridoSinCat.some(t => /no ha arrancado/.test(t) && /no sabemos/.test(t)),
  'y explica las dos lecturas del cero que no se imprimió');
ok(textosSinCat.includes(enLaHoja(eSinCat.pres.pagadoTxt))
   && eSinCat.pres.pagadoTxt === '$9,000,000',
  'lo pagado sigue impreso con su cifra: el hueco del catálogo no se contagia');

// LAS ESTIMACIONES QUE NO LLEGARON, el otro hueco y por otro motivo.
const cifrasSinEst = paginasDeCifras(await dibujar(dSinEst));
ok(cifrasSinEst.filter(t => t === '—').length >= 3,
  'sin estimaciones leídas, lo estimado, lo pagado y el saldo salen con raya');
ok(!cifrasSinEst.some(t => t === '$0'),
  'y ninguno de los tres sale como «$0»');
ok(corridoSinEst.some(t => /NO SE PUDIERON LEER/.test(t)
                        && /no quiere decir que no haya estimaciones/i.test(t)),
  'con el motivo escrito: no es que no haya estimaciones, es que no se sabe');

// ══════════════════════════════════════════════════════════════════════════
// E · SE ENTREGA: NO LLEVA SELLO DE INTERNO, Y DECLARA DE DÓNDE SALIÓ
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── E · se entrega, así que no es interno ─────────────────────');

const paginas = [...new Set(hoja.map(x => x.pagina))].sort((a, b) => a - b);
ok(paginas.length >= 6, `el informe sale de ${paginas.length} páginas`);
ok(!corrido.some(t => /DOCUMENTO INTERNO/i.test(t) || /uso interno/i.test(t)),
  'ninguna página lleva el sello de documento interno: este papel se entrega');
const sinCotea = paginas.filter(p =>
  !hoja.filter(x => x.pagina === p).some(x => /cotea/.test(x.texto)));
ok(sinCotea.length === 0,
  'cotea firma todas las páginas'
  + (sinCotea.length ? ` — sin firma: ${sinCotea.join(', ')}` : ''));
ok(corrido.some(t => /Art\.?\s*73/.test(t)),
  'y el papel se nombra por lo que es: el informe del Art. 73');

// SIN RENGLONES DE FIRMA INVENTADOS. El sistema no conoce los cargos de quien
// suscribe: imprimir «Supervisor» y «Jefe de Obras Públicas» sobre dos rayas
// sería inventar el organigrama de una dependencia que no lo capturó.
//
// ESTA ASERCIÓN YA NO PUEDE MIRAR «Residente de obra», y la §G es la razón: el
// papel ahora SÍ nombra al residente, porque el art. 73 lo obliga. La
// diferencia entre nombrar y inventar no está en el rótulo, está en lo que va
// al lado: un dato capturado lleva un valor —el nombre, o la declaración de que
// falta— y un renglón de firma lleva una raya para que alguien escriba encima.
// Lo que se mide aquí es la raya.
ok(!corrido.some(t => /^_{5,}/.test(t) || /Nombre y firma/i.test(t)
                   || /^Firma del?\b/i.test(t) || /\bsello y firma\b/i.test(t)),
  'no hay rayas de firma, ni rótulos de firma, ni cargos inventados');
ok(dice(/no lleva renglones de firma porque el sistema no conoce los cargos/),
  'y se dice por qué no los lleva, en vez de dejar el hueco a la vista');
ok(dice(/ORIGEN DE ESTE INFORME/) && dice(/Generado por cotea el/)
   && dice(/es un defecto de cotea y hay que reportarlo/),
  'el cierre declara de dónde salió el papel y qué hacer si contradice la pantalla');

// ══════════════════════════════════════════════════════════════════════════
// F · LAS FOTOS SE ROTULAN «SUBIDA», NUNCA CON UNA FECHA DE EJECUCIÓN
// ══════════════════════════════════════════════════════════════════════════
// El sistema no lee la fecha de la cámara. Una foto de un trabajo de agosto
// subida en septiembre aparece con fecha de septiembre, y un expediente que la
// archiva como «avance de la semana N» afirma por años algo que nadie capturó.
console.log('\n── F · la fecha de la foto es la de subida ───────────────────');

ok(dice(/LA FECHA DE CADA FOTO ES LA FECHA EN QUE SE SUBIÓ AL SISTEMA/)
   && dice(/no la fecha en que se ejecutó el trabajo/),
  'la advertencia va completa en la primera hoja del respaldo');
ok(dice(/acredita QUÉ partida tiene evidencia, no CUÁNDO se ejecutó/),
  'y dice qué acredita el respaldo y qué no');

// Los tres pies, uno por cada forma de fecha que la evidencia trae.
ok(textos.includes('subida 2026-02-10'),
  'la foto con fecha de servidor se rotula «subida», con la fecha');
ok(textos.includes('subida 2026-01-22 (declarada)'),
  'la que sólo trae la fecha del teléfono dice además que es declarada');
ok(textos.includes('sin fecha de subida'),
  'y la que no trae ninguna lo dice: no se rellena con la de hoy');
// Ningún pie de foto afirma una fecha de obra.
ok(!textos.some(t => /^(tomada|ejecutada|del d[íi]a|avance de la semana)/i.test(t)),
  'ningún pie de foto se rotula como fecha de ejecución ni de toma');

// ══════════════════════════════════════════════════════════════════════════
// G · LOS CORRESPONSABLES VAN NOMBRADOS, Y SON LOS DOS QUE LA LEY NOMBRA
// ══════════════════════════════════════════════════════════════════════════
// Art. 73 párr. 2: el residente de obra designado por el Ente Público y el
// superintendente de construcción son CORRESPONSABLES de la calidad y debida
// ejecución. Los dos campos ya se capturaban y ninguno se imprimía: el papel
// que se archiva por años decía cómo iba la obra y no a quién se le reclama.
console.log('\n── G · los dos corresponsables, nombrados ───────────────────');

// EL NOMBRE QUE VA AL LADO DEL RÓTULO, no el que esté en algún sitio de la
// hoja. La §1 dibuja el rótulo en `xR` y su valor 38 mm a la derecha, en el
// mismo renglón; con un `includes` sobre la hoja entera, un papel que imprimiera
// los dos nombres cruzados —el superintendente bajo «Residente»— saldría verde.
const valorDe = (hoja, rotulo) => {
  const i = hoja.findIndex(x => x.texto === rotulo);
  if (i < 0) return { falta: true };
  const lbl = hoja[i];
  const val = hoja.slice(i + 1).find(x => x.pagina === lbl.pagina && x.y === lbl.y
                                       && x.x > lbl.x);
  return val ? { texto: val.texto } : { vacio: true };
};

const resid = valorDe(hoja, 'Residente de obra:');
const supte = valorDe(hoja, 'Superintendente:');

ok(resid.texto === enLaHoja(RESIDENTE_DEP),
  `el residente designado por la dependencia va nombrado en la §1: `
  + `«${RESIDENTE_DEP}»` + (resid.texto === undefined
    ? ` — el rótulo ${resid.falta ? 'no está' : 'está vacío'}`
    : ` — dice «${resid.texto}»`));
ok(supte.texto === enLaHoja(SUPERINTENDENTE),
  `y el superintendente de construcción también: «${SUPERINTENDENTE}»`
  + (supte.texto === undefined ? '' : ` — dice «${supte.texto}»`));

// EL RESIDENTE DEL CONTRATISTA NO ES ÉSTE, Y NO ENTRA. La app le dio la palabra
// de la ley a la figura contraria: `obra.residente` es personal del contratista.
// Publicarlo aquí nombraría a un empleado de la constructora como el servidor
// público designado por el Ente Público, en el papel que el municipio archiva.
ok(!corrido.some(t => t.includes(enLaHoja(RESIDENTE_CONTR))),
  'el residente del CONTRATISTA no aparece en ninguna parte de la hoja');

// POR QUÉ ESTÁN AHÍ, DICHO EN EL PAPEL. Sin la leyenda los dos renglones se
// leen como dos datos administrativos más, y el informe no dice qué obligación
// está cumpliendo ni de dónde sale.
ok(dice(/corresponsables de la calidad y debida ejecución/),
  'el papel dice que los dos son corresponsables de la calidad y debida ejecución');
ok(dice(/designación del residente debe constar por escrito/),
  'y que la designación del residente debe constar por escrito (art. 62)');

// CUANDO NO ESTÁ CAPTURADO, SE DECLARA. Es el caso de la demo: las dos obras de
// la cita traen superintendente y NO traen residente. Un rótulo con el renglón
// en blanco se lee como que la obra no tiene residente designado —que es una
// afirmación sobre la dependencia—; lo que pasa es que nadie lo capturó.
const dSinNombres = datosDe({ obra: { ...OBRA,
  supervisorDependencia: null, superintendente: undefined } });
const hojaSinNombres = await dibujar(dSinNombres);
for (const [rotulo, quien] of [['Residente de obra:', 'el residente'],
                               ['Superintendente:', 'el superintendente']]) {
  const v = valorDe(hojaSinNombres, rotulo);
  ok(v.texto === enLaHoja(NO_CAPTURADO),
    `sin capturar, ${quien} sale declarado como «${NO_CAPTURADO}»`
    + (v.texto === undefined
      ? ` — el rótulo ${v.falta ? 'desapareció' : 'quedó con el renglón en blanco'}`
      : ` — dice «${v.texto}»`));
}

// Y UN RELLENO DE CAPTURA TAMPOCO ES UN NOMBRE. «N/A» teclado en el formulario
// es la forma en que alguien declara que no lo sabe; imprimirlo tal cual
// publicaría «Residente de obra: N/A» en un expediente.
const vRelleno = valorDe(await dibujar(datosDe({
  obra: { ...OBRA, supervisorDependencia: 'N/A' } })), 'Residente de obra:');
ok(vRelleno.texto === enLaHoja(NO_CAPTURADO),
  `un «N/A» capturado se publica como «${NO_CAPTURADO}», no como el nombre del residente`
  + (vRelleno.texto === undefined ? '' : ` — dice «${vRelleno.texto}»`));

// EL FORMULARIO Y EL PAPEL LLAMAN IGUAL A LA MISMA PERSONA. El informe publica
// `supervisorDependencia` bajo el rótulo legal «Residente de obra»; si el alta
// lo pidiera como «supervisor», el papel estaría publicando bajo un título de
// ley a quien se capturó bajo otro, y nadie podría saber si es la persona que
// la dependencia designó por escrito.
const camposDep = camposContrato({ tipo: 'dependencia' });
const campoResid = (camposDep || []).find(c => c.key === 'supervisorDependencia');
ok(!!campoResid && /\bresidente\b/i.test(campoResid.lbl || ''),
  'el alta de la dependencia pide al residente con la palabra que el papel imprime'
  + (campoResid ? ` — la etiqueta dice «${campoResid.lbl}»` : ' — el campo no está'));

// Y LAS DOS FIGURAS SIGUEN SIENDO DISTINGUIBLES. Del lado constructora hay otro
// campo con la misma palabra para la figura contraria; si las dos etiquetas
// fueran iguales, quien captura las dos altas no tendría cómo saber a quién le
// está poniendo el nombre.
const camposCon = camposContrato({ tipo: 'constructora' });
const campoResidCon = (camposCon || []).find(c => c.key === 'residente');
ok(!!campoResidCon && !!campoResid && campoResidCon.lbl !== campoResid.lbl
   && /contratista/i.test(campoResidCon.lbl || ''),
  'y el residente del contratista se pide con otra etiqueta, que dice de quién es'
  + (campoResidCon ? ` — «${campoResidCon.lbl}»` : ' — el campo no está'));

// ══════════════════════════════════════════════════════════════════════════
// H · EL PLAZO DE PAGO DEL ART. 63, Y LAS TRES REGLAS QUE MIRABAN AL REVÉS
// ══════════════════════════════════════════════════════════════════════════
// ESTE PAPEL PODÍA IMPRIMIR «revisada sin hallazgo» DE COBRANZA EN UNA OBRA
// QUE EL MUNICIPIO NO HA PAGADO. Tres reglas medían la deuda con el vocabulario
// del otro mostrador: dos buscaban estatus que la ventanilla de la dependencia
// no tiene («Facturada», «Aprobada», «En proceso») y por eso contaban cero, y la
// tercera pedía para siempre un `diasPago` que esa alta no captura. Ninguna
// disparaba nunca, todas caían en «sin hallazgo», y el papel las nombraba una
// por una — en el documento que el municipio archiva cinco años.
//
// En su lugar va el plazo que la Ley 233 sí le pone al Ente Público: 20 días
// naturales desde que el residente autoriza la estimación para pago (art. 62
// párr. 3 y art. 63). Lo que esta sección afirma es lo que se IMPRIME, no lo
// que el motor calcula —eso lo mide `prueba-el-reloj-del-articulo-63.cjs`—.
console.log('\n── H · el plazo de pago del Ente, en el papel ────────────────');

const tituloDe = (id) => (BIBLIOTECA_RIESGOS.find(r => r.id === id) || {}).titulo;
const TIT_PLAZO = tituloDe('ctr_003');
const RETIRADAS = ['fin_003', 'fin_004', 'ctr_001'];
if (!TIT_PLAZO || RETIRADAS.some(id => !tituloDe(id))) {
  console.error('\nNO ARRANCÓ: la biblioteca de riesgos no tiene las reglas que esta '
    + `sección mide (ctr_003: ${TIT_PLAZO || 'no está'}; retiradas: `
    + `${RETIRADAS.map(id => `${id}: ${tituloDe(id) || 'no está'}`).join(', ')}).`);
  process.exit(2);
}

// NINGUNA DE LAS TRES SE NOMBRA EN LA HOJA, por ningún motivo: ni detectada, ni
// sin hallazgo, ni como hueco. Un «no se pudo medir los días de pago» sería
// pedirle al municipio un dato del contratista.
for (const id of RETIRADAS) {
  const t = enLaHoja(tituloDe(id));
  ok(!corrido.some(x => x.includes(t)),
    `«${tituloDe(id)}» no aparece en el papel: su cuenta es del otro mostrador`);
}

// Y EL CASO DE LA DEMO: una estimación pagada que no dice cuándo se autorizó ni
// cuándo se pagó. El plazo de ley NO se puede medir, y la obligación del papel
// es decirlo en la lista de lo que falta pedir — nunca callarlo.
const vFixture = riesgosDeDependencia({ obra: OBRA, subs: CATALOGO,
  estimaciones: ESTIMACIONES, historialAvance: HIST, programa: null, eco: e.eco });
const huecoPlazo = vFixture.noEvaluables.find(r => r.id === 'ctr_003');
ok(!!huecoPlazo,
  'con las fechas sin capturar, el plazo de ley sale como hueco y no como hallazgo'
  + ` — salió en ${['detectados','sinHallazgo','noEvaluables','reventaron']
      .find(k => vFixture[k].some(r => r.id === 'ctr_003')) || 'ninguno'}`);
ok(corrido.some(x => x.includes(enLaHoja(TIT_PLAZO))),
  `y el papel lo nombra: «${TIT_PLAZO}»`);
if (huecoPlazo) {
  // EL DATO QUE HAY QUE PEDIR, con las palabras del motor y no con las del
  // banco: el renglón de la tabla es lo único que le dice al municipio qué
  // capturar para que el papel pueda medir el plazo.
  const dato = (huecoPlazo.faltan || [])[0] || {};
  ok(!!dato.nombre && corrido.some(x => x.includes(enLaHoja(dato.nombre))),
    `y dice qué dato falta: «${dato.nombre || 'sin nombre'}»`);
  ok(!!dato.porQue && corrido.some(x => x.includes(enLaHoja(dato.porQue))),
    `y por qué no se pudo medir: «${(dato.porQue || '').slice(0, 60)}…»`);
}

// EL CASO QUE LE CUESTA DINERO AL ENTE: autorizada hace 70 días y sin pagar.
// La fecha se construye desde el calendario de la obra, y hacia atrás, para que
// el caso no dependa de la hora en que corra el banco.
const haceDias = (k) => {
  const [a, m, d] = hoyLocalISO().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - k)).toISOString().slice(0, 10);
};
const EST_VENCIDA = [
  { id: 'e1', num: 1, monto: 4000000, estatus: 'Autorizada',
    fecha: haceDias(75), fechaAutorizacion: haceDias(70) },
  { id: 'e2', num: 2, monto: 7000000, estatus: 'Recibida', fecha: haceDias(10) },
];
const dVencida = datosDe({ estimaciones: EST_VENCIDA });
const hojaVencida = await dibujar(dVencida);
const corridoVencida = textoCorrido(hojaVencida).map(x => x.texto);
const vVencida = riesgosDeDependencia({ obra: OBRA, subs: CATALOGO,
  estimaciones: EST_VENCIDA, historialAvance: HIST, programa: null,
  eco: economiaDeDependencia({ obra: OBRA, subs: CATALOGO,
    estimaciones: EST_VENCIDA, estCargadas: true }) });
const plazoVencido = vVencida.detectados.find(r => r.id === 'ctr_003');
ok(!!plazoVencido,
  'con una estimación autorizada hace 70 días y sin pagar, el plazo de ley dispara'
  + ` — salió en ${['detectados','sinHallazgo','noEvaluables','reventaron']
      .find(k => vVencida[k].some(r => r.id === 'ctr_003')) || 'ninguno'}`);
if (plazoVencido) {
  // UNA CUENTA POR NÚMERO: el papel publica la cifra del motor, no una suya.
  // Si el generador recalculara el monto vencido por su cuenta, el expediente
  // y la pantalla podrían discrepar el mismo día sobre la misma obra.
  ok(corridoVencida.some(x => x.includes(enLaHoja(plazoVencido.detalle))),
    `y publica la cifra con la que se disparó: «${plazoVencido.detalle}»`);
  ok(corridoVencida.some(x => x.includes(enLaHoja(plazoVencido.extra))),
    'y que corren gastos financieros a cargo del Ente, con los días de atraso');
}
// Y NO SE DISFRAZA DE TRANQUILIDAD. Con el municipio debiendo 4 millones fuera
// de plazo, ningún renglón de «revisadas sin hallazgo» puede hablar de cobranza.
const sinHallazgoVencida = vVencida.sinHallazgo.map(r => r.titulo || r.id);
ok(!sinHallazgoVencida.some(t => /atrasad|por cobrar|d[íi]as de pago/i.test(t)),
  'y ninguna revisión «sin hallazgo» habla de cobranza'
  + ` — las que se callaron: ${sinHallazgoVencida.length}`);

console.log('');
if (fallas) {
  console.log(`${verdes} en verde · ${fallas} en rojo.`);
  process.exit(1);
}
console.log(`${verdes} en verde. El informe del Art. 73 contesta cómo va el avance `
  + 'económico contra el físico, y no sabe nada más.');

// ══════════════════════════════════════════════════════════════════════════
// LA CONTRAPRUEBA
// ══════════════════════════════════════════════════════════════════════════
// Cada mutación mueve UNA decisión y tiene que salir en ROJO. Viven dentro de
// `generarPDFArt73`, de `economiaDeDependencia` o de `presentacionDependencia`:
// las tres son el papel. Una que tocara `evaluarRiesgos` o `curvaDeGobierno`
// mediría el banco de AQUELLA cuenta y no éste.
if (process.argv.includes('--contraprueba')) {
  console.log('\n── CONTRAPRUEBA ─────────────────────────────────────────────');
  const src = fs.readFileSync(archivo, 'utf8');
  const MUTANTES = [
    // ── A · la frontera ────────────────────────────────────────────────────
    // La frontera se rompe de la única forma en que se puede romper desde que
    // está en la firma: abriéndola Y LEYENDO lo que entra. Abrirla a secas no
    // es una mutación — es andamiaje, y el papel sale idéntico porque nada la
    // usa. Eso fue lo primero que se intentó aquí y la contraprueba salió
    // amarilla con razón: no había nada que poner en rojo. Lo que hay que
    // afirmar es que el municipio NO LEE el gasto, así que la mutación tiene
    // que hacerlo leer.
    { nombre: 'la firma se abre al gasto de GP y el papel lo publica',
      hacer: () => src
        .replace(
          "  evidencia = [], evidenciaCargada = false, estCargadas = false,\n} = {}) {",
          "  evidencia = [], evidenciaCargada = false, estCargadas = false,\n"
          + "  gpData = null,\n} = {}) {")
        .replace(
          "    ['Contratado', pres.contratadoTxt, 'monto del contrato', Q.piz],",
          "    ['Contratado', pres.contratadoTxt, 'monto del contrato', Q.piz],\n"
          + "    ['Gasto total', MXN(gpData?.obras?.[obra?.gpId]?.grandTotal || 0),\n"
          + "      'gastado por el contratista', Q.piz],") },
    { nombre: 'el informe imprime un renglón de gasto total',
      hacer: () => src.replace(
        "    ['Contratado', pres.contratadoTxt, 'monto del contrato', Q.piz],",
        "    ['Contratado', pres.contratadoTxt, 'monto del contrato', Q.piz],\n"
        + "    ['Gasto total', '$31,500,000', 'gastado por el contratista', Q.piz],") },

    // ── B · ninguna cifra nueva ────────────────────────────────────────────
    { nombre: 'el ejecutado se formatea en el papel en vez de pedírselo a la pantalla',
      hacer: () => src.replace(
        "    ['Ejecutado', pres.ejecutadoTxt, pres.ejecutadoSub, Q.piz],",
        "    ['Ejecutado', MXN(eco.ejecutado), pres.ejecutadoSub, Q.piz],") },
    { nombre: 'el avance físico se formatea en el papel y pierde la raya de la pantalla',
      hacer: () => src.replace(
        "    ['Avance físico', pres.avanceTxt, pres.avanceSub,",
        "    ['Avance físico', PCT(eco.avance), pres.avanceSub,") },
    // El `resolverNombreCortoObra(obra, null)` va en la mutación a propósito:
    // las dos primeras líneas son idénticas en `generarPDFInterno`, que recibe
    // `gpData`, así que sin ese renglón el `replace` muta el OTRO papel y éste
    // sale intacto — la contraprueba salía amarilla por mutar el archivo
    // equivocado, que es la forma más silenciosa de no comprobar nada.
    { nombre: 'el sello deja de recibir el instante y el informe vuelve al reloj del aparato',
      hacer: () => src.replace(
        '  const sello = selloDeTiempo(instante);\n  const hoy = sello.fecha;\n'
        + "  const nombreCorto = resolverNombreCortoObra(obra, null) || (obra?.nombre || 'Obra');",
        '  const sello = selloDeTiempo(null);\n  const hoy = sello.fecha;\n'
        + "  const nombreCorto = resolverNombreCortoObra(obra, null) || (obra?.nombre || 'Obra');") },

    // ── C · la diferencia es una resta ─────────────────────────────────────
    { nombre: 'la diferencia se calcula contra lo estimado en vez de lo pagado',
      hacer: () => src.replace(
        '    ? null : eco.avance - eco.pctPag;',
        '    ? null : eco.avance - eco.pctEstim;') },
    { nombre: 'sin lo pagado la resta se hace contra un cero y publica la brecha máxima',
      hacer: () => src.replace(
        '  const brechaPP = (eco.avance === null || eco.pctPag === null)\n'
        + '    ? null : eco.avance - eco.pctPag;',
        '  const brechaPP = eco.avance === null\n'
        + '    ? null : eco.avance - (eco.pctPag ?? 0);') },
    { nombre: 'el plazo transcurrido vuelve a publicarse como «avance esperado»',
      hacer: () => src.replace(
        "    ['Plazo transcurrido', plazo.pctPlazo === null ? '—' : PCT(plazo.pctPlazo),",
        "    ['Avance esperado', plazo.pctPlazo === null ? '—' : PCT(plazo.pctPlazo),") },

    // ── D · el cero que se disfraza ────────────────────────────────────────
    { nombre: 'sin catálogo el ejecutado vuelve a sumar cero y se imprime como medición',
      hacer: () => src.replace(
        '  const ejecutado = conCatalogo ? desgloseEjecutado(subs, modoVol).total : null;',
        '  const ejecutado = desgloseEjecutado(subs, modoVol).total;') },
    { nombre: 'sin catálogo el avance físico vuelve a salir 0.0%',
      hacer: () => src.replace(
        '  const avance    = (conCatalogo && contrato > 0)\n'
        + '    ? avanceFisicoPonderado(subs, contrato, modoVol) : null;',
        '  const avance    = avanceFisicoPonderado(subs, contrato, modoVol);') },
    { nombre: 'la raya del ejecutado se vuelve «$0» en la presentación',
      hacer: () => src.replace(
        "    ejecutadoTxt:  eco.ejecutado === null ? '—' : MXN(eco.ejecutado),",
        '    ejecutadoTxt:  MXN(eco.ejecutado || 0),') },
    { nombre: 'la glosa del catálogo ausente deja de nombrar el dato que falta',
      hacer: () => src.replace(
        "  const SIN_CAT = 'el catálogo de conceptos no está cargado';",
        "  const SIN_CAT = 'no se pudo medir';") },
    { nombre: 'el hueco del catálogo se contagia a lo pagado, que no depende de él',
      hacer: () => src.replace(
        '  const pagado   = corte ? corte.pagado   : null;',
        '  const pagado   = (corte && conCatalogo) ? corte.pagado : null;') },
    { nombre: 'la observación del catálogo ausente no se escribe',
      hacer: () => src.replace(
        '  if (!eco.conCatalogo)\n    obs.push(\'LA OBRA NO TIENE CATÁLOGO DE CONCEPTOS CARGADO',
        '  if (false)\n    obs.push(\'LA OBRA NO TIENE CATÁLOGO DE CONCEPTOS CARGADO') },

    // ── E · se entrega ─────────────────────────────────────────────────────
    { nombre: 'el informe que se entrega se sella como documento interno',
      hacer: () => src.replace(
        "    rotulo: 'Informe de avance · Art. 73', banda: null,",
        "    rotulo: 'Informe de avance · Art. 73', banda: 'DOCUMENTO INTERNO',") },
    { nombre: 'el cierre inventa renglones de firma con cargos que el sistema no conoce',
      hacer: () => src.replace(
        "  y = nota('Este informe no lleva renglones de firma porque el sistema no conoce los cargos '\n"
        + "    + 'de quien lo suscribe. Quién lo firma y ante quién se presenta lo define el '\n"
        + "    + 'expediente de la dependencia.', y);",
        "  st(Q.ng); fs(FS_TD); fw('normal');\n"
        + "  T('______________________________', ML, y+20);\n"
        + "  T('Residente de obra', ML, y+25);") },

    // ── F · la fecha de la foto ────────────────────────────────────────────
    { nombre: 'el pie de la foto deja de decir «subida» y se lee como fecha de obra',
      hacer: () => src.replace(
        "        T(foto.fecha\n"
        + "            ? `subida ${foto.fecha}${foto.fechaEs === 'declarada' ? ' (declarada)' : ''}`\n"
        + "            : 'sin fecha de subida',",
        "        T(foto.fecha\n"
        + "            ? `${foto.fecha}`\n"
        + "            : '',") },
    { nombre: 'la foto sin fecha se rellena con la del corte del informe',
      hacer: () => src.replace(
        "      fecha: f.fechaServidor || f.fechaDeclarada || null,",
        "      fecha: f.fechaServidor || f.fechaDeclarada || hoy,") },
    { nombre: 'la fecha del teléfono se publica sin decir que es declarada',
      hacer: () => src.replace(
        "      fechaEs: f.fechaServidor ? 'servidor' : (f.fechaDeclarada ? 'declarada' : null),",
        "      fechaEs: 'servidor',") },
    { nombre: 'la advertencia de que la fecha es la de subida se recorta',
      hacer: () => src.replace(
        "      yf = nota('LA FECHA DE CADA FOTO ES LA FECHA EN QUE SE SUBIÓ AL SISTEMA, no la fecha '\n"
        + "        + 'en que se ejecutó el trabajo ni la fecha en que se tomó la foto. El sistema no lee '\n"
        + "        + 'la fecha de la cámara. Una foto de un trabajo de agosto subida en septiembre '\n"
        + "        + 'aparece con fecha de septiembre, y por eso el pie de cada una dice «subida». Este '\n"
        + "        + 'respaldo acredita QUÉ partida tiene evidencia, no CUÁNDO se ejecutó.', yf);",
        "      yf = nota('Fotografías que respaldan el avance de esta obra.', yf);") },

    // ── G · los corresponsables ────────────────────────────────────────────
    { nombre: 'el informe vuelve a no nombrar al residente designado por la dependencia',
      hacer: () => src.replace(
        "    ['Residente de obra:', comoSeImprime(obra?.supervisorDependencia)],\n",
        '') },
    { nombre: 'el informe vuelve a no nombrar al superintendente',
      hacer: () => src.replace(
        "    ['Superintendente:', comoSeImprime(obra?.superintendente)],\n",
        '') },
    // LA PEOR DE LAS SIETE, y la que justifica que el caso traiga los dos
    // nombres: el papel publica al residente DEL CONTRATISTA como el servidor
    // público designado por el Ente Público. No es un hueco, es una afirmación
    // falsa sobre quién responde, firmada por cotea y archivada por años.
    { nombre: 'el residente que se imprime es el del contratista, no el de la dependencia',
      hacer: () => src.replace(
        "    ['Residente de obra:', comoSeImprime(obra?.supervisorDependencia)],",
        "    ['Residente de obra:', comoSeImprime(obra?.residente)],") },
    { nombre: 'el residente sin capturar sale con el renglón en blanco en vez de declarado',
      hacer: () => src.replace(
        "    ['Residente de obra:', comoSeImprime(obra?.supervisorDependencia)],",
        "    ['Residente de obra:', obra?.supervisorDependencia || ''],") },
    { nombre: 'la leyenda de la corresponsabilidad no se escribe',
      hacer: () => src.replace(
        "  T(doc.splitTextToSize(\n"
        + "    'Art. 73: el residente de obra designado por el Ente Público y el '",
        "  if (false) T(doc.splitTextToSize(\n"
        + "    'Art. 73: el residente de obra designado por el Ente Público y el '") },
    { nombre: 'el alta vuelve a pedir al residente como «supervisor» y el papel lo publica como residente',
      hacer: () => src.replace(
        '{ lbl:"Residente de obra (lo designa la dependencia)",  key:"supervisorDependencia", tipo:"text" },',
        '{ lbl:"Supervisor por parte de la dependencia",  key:"supervisorDependencia", tipo:"text" },') },
    { nombre: 'las dos altas vuelven a llamar igual a las dos figuras contrarias',
      hacer: () => src.replace(
        '{ lbl:"Residente de obra (del contratista)", key:"residente",  tipo:"text" },',
        '{ lbl:"Residente de obra (lo designa la dependencia)", key:"residente",  tipo:"text" },') },

    // ── H · el plazo de pago del Ente ──────────────────────────────────────
    // LAS DOS MUTACIONES SON DEL PAPEL, no del motor de riesgo: lo que la §H
    // afirma es que el veredicto se IMPRIME. Que el plazo del art. 63 se mida
    // bien lo afirma `prueba-el-reloj-del-articulo-63.cjs`, con sus catorce.
    //
    // El encabezado se queda y las filas se van: es la forma exacta en que esta
    // sección miente sin decir una sola cosa falsa. «Sin poder medir» con la
    // tabla vacía se lee como que no faltó ningún dato.
    { nombre: 'la tabla de lo que no se pudo medir se queda sin renglones',
      hacer: () => src.replace(
        "      ['Incidencia', 'Dato que falta', 'Por qué no se pudo medir'],\n"
        + '      noEvaluables.map(r => [',
        "      ['Incidencia', 'Dato que falta', 'Por qué no se pudo medir'],\n"
        + '      [].map(r => [') },
    // Y la incidencia detectada sin la cifra con la que se detectó: el papel
    // dice que el pago está vencido y no dice de cuánto ni de cuántos días, que
    // es lo único con lo que el municipio puede hacer algo.
    { nombre: 'la incidencia se publica sin la cifra con la que se detectó',
      hacer: () => src.replace(
        "      ['Nivel', 'Incidencia', 'Cifra', 'Qué dice'],\n"
        + '      detectados.map(r => [\n'
        + '        labelSev(r.severidad),\n'
        + '        r.titulo || r.id,\n'
        + '        disparoCon(r.valor),\n'
        + "        [r.detalle, r.extra].filter(Boolean).join(' · ') || '—',",
        "      ['Nivel', 'Incidencia', 'Cifra', 'Qué dice'],\n"
        + '      detectados.map(r => [\n'
        + '        labelSev(r.severidad),\n'
        + '        r.titulo || r.id,\n'
        + "        '',\n"
        + "        '—',") },
  ];

  // ── QUE LA MUTACIÓN CAIGA DONDE DEBE ──────────────────────────────────────
  //
  // `String.replace` con una cadena cambia LA PRIMERA aparición, y este papel
  // comparte renglones literales con `generarPDFInterno`: las dos primeras
  // líneas del sello son idénticas en los dos generadores. Una mutación que
  // apunte a un renglón ambiguo muta el OTRO papel, éste sale intacto, y la
  // contraprueba se declara amarilla —«no puso nada en rojo»— por una razón que
  // no tiene nada que ver con la aserción. Pasó aquí, con esa mutación exacta.
  //
  // Así que no se confía en el ojo: se mide DÓNDE cayó el cambio. El papel son
  // tres cuentas y nada más, y una mutación que caiga fuera de las tres no está
  // midiendo este banco.
  // `CAMPOS_CONTRATO` entra desde la §G y no es una excepción al criterio: el
  // papel publica `supervisorDependencia` bajo el rótulo legal «Residente de
  // obra», así que el rótulo con el que ese campo SE CAPTURA es parte de lo que
  // este informe afirma. Una etiqueta y la otra tienen que decir lo mismo o el
  // papel publica bajo un título de ley a quien se capturó bajo otro.
  const ESPACIO = ['async function generarPDFArt73(',
                   'const economiaDeDependencia = (',
                   'const presentacionDependencia = (',
                   'const CAMPOS_CONTRATO = {'];
  const tramos = ESPACIO.map((ancla) => {
    const i = src.indexOf(ancla);
    if (i < 0) {
      console.error(`\nNO ARRANCÓ: no se encontró «${ancla}» en ${archivo}, así que no se `
        + 'puede saber si una mutación cayó dentro del papel.');
      process.exit(2);
    }
    // Hasta el arranque de la siguiente declaración de primer nivel.
    const j = src.indexOf('\n}\n', i);
    const k = src.indexOf('\n};\n', i);
    const fin = Math.min(j < 0 ? Infinity : j, k < 0 ? Infinity : k);
    return [i, fin === Infinity ? src.length : fin];
  });
  // Primer y último carácter que cambió. Con una sola sustitución el tramo
  // cambiado es contiguo, así que estos dos lo acotan.
  const dondeCayo = (a, b) => {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0;
    while (q < a.length - p && q < b.length - p
           && a[a.length-1-q] === b[b.length-1-q]) q++;
    return [p, a.length - q];
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art73-'));
  let n = 0;
  for (const m of MUTANTES) {
    const mutado = m.hacer();
    if (mutado === src) {
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» no cambió nada.`);
      process.exit(2);
    }
    const [ini, fin] = dondeCayo(src, mutado);
    if (!tramos.some(([a, b]) => ini >= a && fin <= b)) {
      const linea = src.slice(0, ini).split('\n').length;
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» cayó en la línea ${linea} de `
        + `${archivo}, que está FUERA del informe del Art. 73 y de sus dos cuentas. `
        + 'Casi siempre es un renglón que este papel comparte literalmente con el '
        + 'documento interno: hay que darle más contexto a la sustitución.');
      process.exit(2);
    }
    const f2 = path.join(dir, `app-${n}.jsx`);
    fs.writeFileSync(f2, mutado);
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f2 }, encoding: 'utf8' });
    // LAS ROJAS SE LEEN DEL VEREDICTO DEL HIJO, no contando renglones `FALLA`:
    // el día que este banco se calle una falla, contar renglones daría cero y
    // la contraprueba se daría por buena sin haber comprobado nada.
    const dicho = (r.stdout + r.stderr).match(/(\d+) en rojo/);
    const caidas = dicho ? Number(dicho[1]) : 0;
    console.log(`\n  «${m.nombre}»`);
    console.log(`     ${caidas} aserción(es) en rojo` + (r.status === 2 ? '  ← NO ARRANCÓ' : ''));
    if (r.status === 2) {
      console.log((r.stdout + r.stderr).split('\n').filter(l => /NO ARRANCÓ/.test(l)).join('\n'));
      process.exit(2);
    }
    if (caidas === 0) {
      console.log('     la contraprueba NO puso nada en rojo: la aserción no afirma lo que dice');
      process.exit(1);
    }
    n++;
  }
  console.log(`\n${n} mutación(es), todas en rojo.\n`);
}

})().catch((e) => {
  console.error(`\nNO ARRANCÓ: ${e.stack}`);
  process.exit(2);
});
