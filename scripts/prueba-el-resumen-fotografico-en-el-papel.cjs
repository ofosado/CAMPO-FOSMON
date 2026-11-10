#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA SECCIÓN 5 NO DICE DE LAS FOTOS MÁS DE LO QUE LAS FOTOS DICEN
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que la sección 5 del documento interno ESCRIBE en la hoja,
// comparado contra lo que `seleccionFotografica` devuelve con los mismos
// insumos. No que la función exista, y tampoco que el generador la llame: que
// el número impreso sea el que esa cuenta dio. Toda expectativa de este banco
// sale de EJECUTAR la cuenta; tecleada, sería una segunda copia que se
// comprueba contra sí misma.
//
// POR QUÉ ESTA SECCIÓN NECESITA UN BANCO. Es la única del papel que afirma
// algo sobre el RESPALDO de todo lo demás, y las cuatro maneras de mentir ahí
// son calladas —ninguna imprime un número equivocado; todas imprimen un número
// correcto que se lee como otra cosa—:
//
//   A. EL PORCENTAJE QUE EL CLIENTE NO VE. El reporte del cliente se niega a
//      imprimir la cobertura debajo del piso, y hace bien: un «35.5%» suelto se
//      lee como una medición cumplida. Hacia adentro la cifra hace falta, y
//      entonces el papel tiene que DECIR que allá no está y por qué. Si esa
//      frase se pierde, los dos documentos se contradicen sin avisar. Medido en
//      producción el 2026-11-10: TRES de siete obras caen debajo del piso.
//
//   B. LA COBERTURA ALTA CON RESPALDO SIN AUTOR. La 0112 tiene 94.6% —la mejor
//      de la cartera— y sus 270 fotos son de archivo: se subieron antes de que
//      la app registrara quién las tomaba, y ese dato no se puede reconstruir.
//      El número cumple y nada de lo que lo sostiene se puede atribuir. Si el
//      papel publica el 94.6% sin esa frase, afirma un respaldo que no tiene.
//
//   C. «15 FOTOS» CUANDO HAY 304. El tope del reparto es quince. Decir quince
//      sin decir de cuántas hace creer que quince es lo que hay, y manda a
//      fotografiar una obra cuyo problema es que sus fotos no se ven. Pasa en
//      CINCO de las siete obras vivas.
//
//   D. EL CERO QUE NO SE MIDIÓ. Sin lectura de evidencia no hay cobertura, y un
//      «0.0%» impreso ahí es indistinguible de una obra sin una sola foto. Las
//      dos cosas piden lo contrario: una se arregla reintentando la lectura y
//      la otra yendo a campo. Debajo del piso el papel sí publica el número;
//      sin medición NO PUBLICA NINGUNO.
//
//   node scripts/prueba-el-resumen-fotografico-en-el-papel.cjs
//   node scripts/prueba-el-resumen-fotografico-en-el-papel.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno, textoCorrido } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
const PEDIDOS = ['generarPDFInterno', 'seleccionFotografica', 'frasesDeCobertura',
  'fraseOrigenEvidencia', 'selloDeEvidencia', 'TOPE_FOTOS',
  'COBERTURA_TECHO', 'COBERTURA_PISO', 'MXN'];
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
const { generarPDFInterno, seleccionFotografica, fraseOrigenEvidencia,
        selloDeEvidencia, TOPE_FOTOS, COBERTURA_TECHO, COBERTURA_PISO, MXN } = APP;

// El formato del porcentaje. Es lo ÚNICO que este banco escribe por su cuenta,
// y es un `toFixed`, no una cuenta: lo que se afirma es que el papel imprime el
// número que `seleccionFotografica` devolvió, no que sepa redondear.
const pct1 = (n) => `${n.toFixed(1)}%`;

// ── LOS CASOS ──────────────────────────────────────────────────────────────
// Cada uno copia la forma de una obra real, y están los cuatro porque las
// cuatro conductas de la sección se ejercen hoy en producción (medido con
// `scripts/medir-el-resumen-fotografico.cjs --prod`, 2026-11-10).
const foto = (partidaId, i, verificada) => ({
  partidaId, url: `https://x/${partidaId}-${i}.jpg`, verificada,
  fechaServidor: verificada ? `2026-11-0${(i % 9) + 1}T12:00:00Z` : '',
  fechaDeclarada: `2026-11-0${(i % 9) + 1}`, sub: `toma ${i}`,
});
const fotos = (partidaId, n, verificada) =>
  Array.from({ length: n }, (_, i) => foto(partidaId, i, verificada));

// BAJO — debajo del piso, origen mezclado, y muchas más fotos que el tope.
// Es la 0114: 45.4%, 12 de 15 enseñadas de archivo, 304 disponibles.
const CAT_BAJO = [
  { id: 'p1', sec: 'A-01', sub: 'Suministro de tubería de poliéster reforzado', imp: 20000000, a: 12 },
  { id: 'p2', sec: 'A-02', sub: 'Pavimento de concreto premezclado de 20 cm',   imp: 15000000, a: 0 },
  { id: 'p3', sec: 'A-03', sub: 'Carpeta asfáltica de granulometría densa',      imp: 12000000, a: 64 },
  { id: 'p4', sec: 'A-04', sub: 'Aire acondicionado',                            imp:  8000000, a: 30 },
  { id: 'p5', sec: 'A-05', sub: 'Señalamiento horizontal',                       imp:  5000000, a: 0 },
  { id: 'p6', sec: 'A-06', sub: 'Jardinería',                                    imp:  2000000, a: 90 },
];
const EV_BAJO = [...fotos('p3', 20, false), ...fotos('p4', 10, true), ...fotos('p6', 2, true)];

// MEDIO — entre el piso y el techo, TODO verificado. Es la 0127: 51.7% con sus
// quince enseñadas verificadas. Existe para que la frase de «el cliente no ve
// este número» tenga dónde comprobarse AUSENTE: una nota que sale siempre deja
// de leerse el día que importa.
const CAT_MEDIO = [
  { id: 'r1', sec: 'B-01', sub: 'Estructura metálica',  imp: 10000000, a: 55 },
  { id: 'r2', sec: 'B-02', sub: 'Albañilería',          imp:  9000000, a: 20 },
  { id: 'r3', sec: 'B-03', sub: 'Instalación eléctrica', imp: 3000000, a: 80 },
];
const EV_MEDIO = [...fotos('r1', 4, true), ...fotos('r3', 3, true)];

// ALTO — arriba del techo y TODO de archivo. Es la 0112: 94.6% de cobertura
// sostenida por 270 fotos sin un solo autor. Y aquí todo cabe en el tope, para
// que «no se ven N» tenga dónde comprobarse ausente.
const CAT_ALTO = [
  { id: 'q1', sec: 'C-01', sub: 'Obra civil del malecón', imp: 30000000, a: 98 },
  { id: 'q2', sec: 'C-02', sub: 'Guarniciones y banquetas', imp: 10000000, a: 95 },
  { id: 'q3', sec: 'C-03', sub: 'Limpieza final', imp: 2000000, a: 0 },
];
const EV_ALTO = [...fotos('q1', 3, false), ...fotos('q2', 2, false)];

const SELLO = { ms: Date.UTC(2026, 10, 10, 18, 0, 0), fuente: 'servidor' };
const base = (subs, evidencia, evidenciaCargada) => ({
  obra: { id: '0114', nombre: 'Oaxaca Parque Lineal', contrato: 'SIOP-2026-0114',
          cliente: 'H. Ayuntamiento de Coatzacoalcos',
          inicio: '2025-08-01', fin: '2027-06-30',
          presupuesto: subs.reduce((t, s) => t + s.imp, 0), gpId: '0114', diasPago: 30 },
  subs, evidencia, evidenciaCargada,
  estimaciones: [], estCargadas: true, maquinaria: [], materiales: [],
  subcontratos: [], historialAvance: [], gpData: null, gpDetalle: null,
  otrosGastos: [], nominaHistorial: [], programa: null, instante: SELLO,
  organizacion: 'FOSMON Construcciones', generadoPor: 'demo@fosmon.com.mx',
});

// LO QUE LA SECCIÓN 5 ESCRIBIÓ, Y SÓLO ESO. Se recorta por ÍNDICE y no por
// página: la sección se desborda a una segunda hoja cuando la lista de huecos
// es larga, y filtrar por página dejaría fuera justo el caso en que la lista
// importa. El corte de arriba es su encabezado y el de abajo el de la sección
// 6, que siempre va después.
function seccion5(hoja) {
  const i = hoja.findIndex(d => String(d.texto).startsWith('5  RESUMEN FOTOGRÁFICO'));
  const j = hoja.findIndex(d => String(d.texto).startsWith('6  INDICADORES DE RIESGO'));
  if (i < 0 || j < 0 || j <= i) return null;
  return hoja.slice(i, j);
}
const dice = (trozo, frase) =>
  textoCorrido(trozo).some(d => d.texto.includes(frase));

// EL VALOR DE UN RECUADRO, NO UNA CADENA SUELTA EN LA PÁGINA. Los recuadros de
// indicador de esta sección llevan cifras chicas —«4», «2»— y buscarlas como
// subcadena en todo el trozo no afirma nada: un «4» aparece en un importe, en
// un porcentaje y en «4 de 6 partidas con foto». La regla es la geometría del
// recuadro, que `kpiBox` fija: la etiqueta en MAYÚSCULAS en (x+3, y+5) y el
// valor en el MISMO x, ocho milímetros abajo, con otro tamaño de letra. Así la
// aserción habla del renglón grande de ESE recuadro y de ningún otro.
const PASO_KPI_MM = 8;
function valorDelKpi(trozo, etiqueta) {
  const et = trozo.find(d => String(d.texto) === etiqueta.toUpperCase());
  if (!et) return null;
  const val = trozo.find(d => d !== et && d.pagina === et.pagina
    && Math.abs(d.x - et.x) < 0.01
    && Math.abs(d.y - (et.y + PASO_KPI_MM)) < 0.01);
  return val ? String(val.texto) : null;
}

(async () => {

// Las cuatro hojas, una por caso. Se generan una sola vez: cada corrida mueve
// el generador entero y las secciones 1 a 7 no cambian entre casos.
const casos = {};
for (const [nombre, subs, ev, cargada] of [
  ['BAJO',  CAT_BAJO,  EV_BAJO,  true],
  ['MEDIO', CAT_MEDIO, EV_MEDIO, true],
  ['ALTO',  CAT_ALTO,  EV_ALTO,  true],
  // La evidencia va LLENA y la bandera en `false`: así el caso distingue «no se
  // pudo leer» de «no hay fotos». Con la lista vacía las dos se verían igual, y
  // ésa es exactamente la confusión que la sección existe para no cometer.
  ['NOLEIDA', CAT_BAJO, EV_BAJO, false],
]) {
  const hoja = await dibujarPDFInterno(generarPDFInterno, base(subs, ev, cargada));
  if (hoja.reventones.length) {
    console.error(`\nNO ARRANCÓ: el generador reventó en el caso ${nombre}: `
      + hoja.reventones.join(' | '));
    process.exit(2);
  }
  const trozo = seccion5(hoja);
  if (!trozo) {
    console.error(`\nNO ARRANCÓ: en el caso ${nombre} no se encontró la sección 5 `
      + 'entre su encabezado y el de la 6. Sin recorte no hay nada que medir.');
    process.exit(2);
  }
  casos[nombre] = { hoja, trozo,
    sel: seleccionFotografica({ subs, evidencia: ev, evidenciaCargada: cargada,
                                tope: TOPE_FOTOS }) };
}

// ══════════════════════════════════════════════════════════════════════════
// A · EL PORCENTAJE, Y QUIÉN NO LO VE
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── A · el porcentaje que el cliente no ve ───────────────────');

const B = casos.BAJO, M = casos.MEDIO, A = casos.ALTO;

// Los tres casos están donde dicen estar. Sin esto el banco comprobaría las
// conductas en la banda equivocada y saldría verde sin haber medido nada.
ok(B.sel.cobertura.medible && B.sel.cobertura.pct < COBERTURA_PISO,
  `el caso BAJO cae debajo del piso: ${pct1(B.sel.cobertura.pct)} < ${COBERTURA_PISO}%`);
ok(M.sel.cobertura.pct >= COBERTURA_PISO && M.sel.cobertura.pct < COBERTURA_TECHO,
  `el caso MEDIO cae entre piso y techo: ${pct1(M.sel.cobertura.pct)}`);
ok(A.sel.cobertura.pct >= COBERTURA_TECHO,
  `el caso ALTO pasa el techo: ${pct1(A.sel.cobertura.pct)} >= ${COBERTURA_TECHO}%`);

// EL NÚMERO ESTÁ, EN LAS TRES BANDAS. El de abajo es el que el reporte del
// cliente calla, y es justo donde hace falta hacia adentro.
for (const [n, c] of [['BAJO', B], ['MEDIO', M], ['ALTO', A]]) {
  ok(dice(c.trozo, pct1(c.sel.cobertura.pct)),
    `${n}: la sección imprime ${pct1(c.sel.cobertura.pct)}, que es lo que `
    + '`seleccionFotografica` devolvió con estos mismos insumos');
}

// Y DICE QUE ALLÁ NO ESTÁ, sólo donde de verdad no está. La frase se busca por
// lo que afirma —que el otro documento no lleva este número— y no por una
// palabra suelta que podría aparecer por casualidad en otra nota.
ok(dice(B.trozo, 'NO imprime este'),
  'BAJO: el papel dice que el reporte que se entrega al cliente NO imprime ese '
  + 'porcentaje — sin eso, los dos documentos se contradicen sin avisar');
ok(dice(B.trozo, 'la evidencia fotográfica no alcanza'),
  'BAJO: y dice qué imprime el cliente en su lugar, así que quien compara los '
  + 'dos papeles no concluye que uno de los dos está mal');
ok(!dice(M.trozo, 'NO imprime este') && !dice(A.trozo, 'NO imprime este'),
  'MEDIO y ALTO: esa nota NO sale, porque arriba del piso los dos documentos '
  + 'imprimen el mismo número — una nota que sale siempre deja de leerse');

// EL VEREDICTO DEL CORTE. Las partidas que hay que cubrir salen con su número,
// y ese número es el de la cuenta, no uno contado aquí.
for (const [n, c] of [['BAJO', B], ['MEDIO', M], ['ALTO', A]]) {
  const impreso = valorDelKpi(c.trozo, 'Corte del 80%');
  const esperado = String(c.sel.cobertura.hastaTecho);
  ok(impreso === esperado,
    `${n}: el recuadro del corte dice ${esperado}, que es cuántas partidas hay que `
    + `cubrir para llegar al ${COBERTURA_TECHO}% — no el total del catálogo `
    + `(${c.sel.cobertura.partidas})`
    + (impreso === esperado ? '' : ` — dice «${impreso}»`));
}

// ══════════════════════════════════════════════════════════════════════════
// B · DE DÓNDE SALEN LAS FOTOS QUE RESPALDAN
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── B · el respaldo que no se puede atribuir ─────────────────');

const enseñadas = (c) => [...c.sel.partidas, ...c.sel.fuera].flatMap(p => p.fotos);
const archivoDe = (c) => enseñadas(c).filter(f => !selloDeEvidencia(f).verificada).length;

ok(enseñadas(A).length > 0 && archivoDe(A) === enseñadas(A).length,
  `el caso ALTO enseña ${enseñadas(A).length} fotos y TODAS son de archivo: `
  + 'es la forma de la 0112, donde la mejor cobertura de la cartera se sostiene '
  + 'en fotos sin un solo autor');
ok(dice(A.trozo, 'TODAS son de archivo'),
  'ALTO: el papel lo dice con esas palabras. Publicar 95.2% sin esta frase '
  + 'afirma un respaldo que no se puede acreditar');
ok(dice(A.trozo, 'no se puede es atribuirlo'),
  'ALTO: y separa las dos cosas — la cobertura es real, lo que no hay es a quién '
  + 'atribuírsela. Decir «no hay respaldo» sería la mentira contraria');

ok(archivoDe(B) > 0 && archivoDe(B) < enseñadas(B).length,
  `el caso BAJO enseña ${enseñadas(B).length} con origen MEZCLADO `
  + `(${archivoDe(B)} de archivo): es la forma de la 0114`);
ok(dice(B.trozo, `${archivoDe(B)} de ellas son de archivo`),
  `BAJO: el papel dice cuántas son de archivo (${archivoDe(B)}), no sólo que las hay`);
ok(!dice(B.trozo, 'TODAS son de archivo'),
  'BAJO: y NO dice «todas», que sería acusar de más a una obra que sí capturó parte');

ok(archivoDe(M) === 0 && enseñadas(M).length > 0,
  `el caso MEDIO enseña ${enseñadas(M).length}, todas verificadas: es la forma de la 0127`);
ok(dice(M.trozo, 'Todas se capturaron en la app'),
  'MEDIO: el papel lo afirma en positivo. Callarlo dejaría al lector sin saber '
  + 'si es que están verificadas o si es que nadie miró');
ok(!dice(M.trozo, 'de archivo'),
  'MEDIO: y no menciona el archivo, porque aquí no hay ni una');

// LA FRASE DEL ORIGEN ES LA DE LA APP, no una redacción de este papel. Si el
// documento la escribiera por su cuenta, la galería y el PDF contarían el mismo
// lote con dos frases y una de las dos envejecería.
for (const [n, c] of [['BAJO', B], ['MEDIO', M], ['ALTO', A]]) {
  const frase = fraseOrigenEvidencia(enseñadas(c));
  ok(frase && dice(c.trozo, frase),
    `${n}: usa la frase de origen de la app, «${frase}», y no una propia`);
}

// ══════════════════════════════════════════════════════════════════════════
// C · CUÁNTAS ENSEÑA DE CUÁNTAS HAY
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── C · quince de trescientas cuatro ─────────────────────────');

const haberDe = (c) => [...c.sel.partidas, ...c.sel.fuera]
  .reduce((t, p) => t + p.disponibles, 0);

ok(haberDe(B) > enseñadas(B).length,
  `el caso BAJO tiene ${haberDe(B)} fotos y el reparto sólo alcanza para `
  + `${enseñadas(B).length}: hay sobrante que callar`);
ok(dice(B.trozo, `${enseñadas(B).length} de ${haberDe(B)}`),
  `BAJO: el papel escribe «${enseñadas(B).length} de ${haberDe(B)}» y no sólo `
  + `«${enseñadas(B).length}», que haría creer que eso es lo que hay`);
ok(dice(B.trozo, 'NO es tomar más fotos'),
  'BAJO: y dice qué NO hace falta. El número solo manda a campo a una obra cuyo '
  + 'problema es que sus fotos no se ven');
ok(dice(B.trozo, String(TOPE_FOTOS)),
  `BAJO: y nombra el tope (${TOPE_FOTOS}), que es la razón del recorte`);

ok(haberDe(A) === enseñadas(A).length && enseñadas(A).length > 0,
  `el caso ALTO tiene ${haberDe(A)} y las enseña todas: no hay sobrante`);
ok(!dice(A.trozo, 'no aparecen impresas'),
  'ALTO: y la advertencia del sobrante NO sale, porque no hay nada guardado sin enseñar');

// ══════════════════════════════════════════════════════════════════════════
// D · LA LISTA DE TRABAJO: LAS GRANDES SIN UNA SOLA FOTO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── D · las partidas grandes que no tienen con qué ───────────');

ok(B.sel.sinEvidencia.length > 0,
  `el caso BAJO trae ${B.sel.sinEvidencia.length} partida(s) del corte sin una sola foto`);
for (const p of B.sel.sinEvidencia) {
  ok(dice(B.trozo, String(p.s.sub).slice(0, 64)),
    `BAJO: «${String(p.s.sub).slice(0, 40)}» aparece por su nombre, no contada en un total`);
  ok(dice(B.trozo, MXN(p.imp)),
    `BAJO: y con su importe (${MXN(p.imp)}), que es lo que la vuelve prioridad`);
}
ok(B.sel.sinEvidencia.every(p => dice(B.trozo, p.s.sec)),
  'BAJO: cada una con su clave, que es con lo que se busca en el catálogo');

ok(A.sel.sinEvidencia.length === 0,
  'el caso ALTO no tiene huecos en el corte: todas sus partidas grandes tienen foto');
ok(dice(A.trozo, 'Ninguna:'),
  'ALTO: y el papel lo DICE. Una tabla ausente se lee como una sección que se '
  + 'olvidó de imprimirse, no como una obra sin huecos');

// LA LISTA ES EXACTAMENTE LOS HUECOS DEL CORTE: NI UNA MÁS. Dos formas de
// alargarla, y las dos la vuelven inútil por razones distintas.
//
// Por abajo: si entraran las partidas de fuera del corte, la lista deja de ser
// corta —la 0114 imprimiría cincuenta renglones— y lo corto es lo que la hace
// una lista de trabajo y no un inventario. Se comprueba contra TODA partida de
// fuera del corte, con foto o sin ella, porque el nombre de una partida en
// esta sección sólo puede venir de esta tabla.
const clavesCorte = new Set(B.sel.partidas.map(p => p.s.sec));
const fueraDelCorte = CAT_BAJO.filter(s => !clavesCorte.has(s.sec));
ok(fueraDelCorte.length > 0,
  `el caso BAJO tiene ${fueraDelCorte.length} partida(s) fuera del corte: hay con `
  + 'qué comprobar que no se cuelan');
ok(fueraDelCorte.every(s => !dice(B.trozo, String(s.sub).slice(0, 64))),
  'BAJO: ninguna de ellas entra en la lista de trabajo — la lista es la del corte '
  + `del ${COBERTURA_TECHO}%, y una lista larga no se lee`);

// Por arriba: si entraran las partidas del corte que SÍ tienen foto, la tabla
// acusa de no tener evidencia a una partida que la tiene. Eso no es una lista
// larga: es una lista falsa, y manda a fotografiar lo que ya está fotografiado.
const corteConFoto = B.sel.partidas.filter(p => !p.sinEvidencia);
ok(corteConFoto.length > 0,
  `el caso BAJO tiene ${corteConFoto.length} partida(s) del corte CON foto: hay con `
  + 'qué comprobar que no se les acusa');
ok(corteConFoto.every(p => !dice(B.trozo, String(p.s.sub).slice(0, 64))),
  'BAJO: ninguna de ellas sale en la tabla de «sin una sola fotografía» — estar en '
  + 'el corte no es el defecto; no tener con qué respaldarlo sí');

// ══════════════════════════════════════════════════════════════════════════
// E · SIN LECTURA NO SE PUBLICA NINGÚN NÚMERO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── E · el cero que nadie midió ──────────────────────────────');

const NL = casos.NOLEIDA;
ok(!NL.sel.cobertura.medible && NL.sel.cobertura.razon === 'no-leida',
  'el caso NOLEIDA llega con la evidencia SIN leer, aunque la lista venga llena: '
  + 'es la diferencia que `evidenciaCargada` existe para marcar');

// NI UN PORCENTAJE. Se buscan TODOS, no una cadena concreta: una aserción
// contra «0.0%» dejaría pasar un «45.4%» calculado sobre la lista que no se
// debía leer, que es el defecto más probable de los dos.
const porcientos = textoCorrido(NL.trozo)
  .map(d => d.texto).join(' | ').match(/\d+[.,]\d+\s*%/g) || [];
ok(porcientos.length === 0,
  'NOLEIDA: la sección no imprime UN SOLO porcentaje' +
  (porcientos.length ? ` — salieron ${porcientos.join(', ')}` : ''));
ok(dice(NL.trozo, 'LA COBERTURA NO SE PUDO MEDIR'),
  'NOLEIDA: y dice que no se pudo medir, en vez de dejar el hueco callado');
ok(dice(NL.trozo, 'NO quiere decir que no haya fotos'),
  'NOLEIDA: y desmiente la lectura fácil — «no se sabe» no es «no hay»');
ok(dice(NL.trozo, 'no yendo a fotografiar'),
  'NOLEIDA: y dice qué NO arregla esto, porque los dos motivos de no-medible '
  + 'piden cosas opuestas y confundirlos manda gente a campo de balde');

// Y NO SE COLA LA LISTA DE TRABAJO. Sin cobertura medida no hay corte del 80%,
// así que una tabla de «partidas sin foto» aquí estaría acusando con un
// criterio que no se pudo calcular.
ok(!dice(NL.trozo, 'SIN una sola fotograf'),
  'NOLEIDA: tampoco sale la lista de partidas sin foto — sin cobertura medida no '
  + 'hay corte del 80% con el cual señalar a ninguna');

// ══════════════════════════════════════════════════════════════════════════
// F · LO QUE LA SECCIÓN NO ES
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── F · ni álbum, ni papel del cliente ───────────────────────');

// Que el lector sepa que las fotos no están porque no van, no porque falten.
ok(dice(B.trozo, 'Aquí no van las fotos'),
  'el papel avisa que el álbum no está aquí y dónde sí está: un resumen sin esa '
  + 'frase se lee como un álbum que no cargó');

// EL SELLO DE INTERNO EN LA PÁGINA DE LA SECCIÓN. Es la sección que publica lo
// que el cliente no ve; una hoja suelta de ésta sobre un escritorio tiene que
// decir lo que es.
const pagsDe5 = [...new Set(B.trozo.map(d => d.pagina))];
ok(pagsDe5.length > 0 && pagsDe5.every(p => B.hoja.some(d =>
      d.pagina === p && String(d.texto).includes('NO ES EL REPORTE QUE SE ENTREGA AL CLIENTE'))),
  `las ${pagsDe5.length} página(s) de la sección llevan el sello de documento interno`);

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${verdes} en verde · ${fallas} en rojo`);
if (fallas) process.exit(1);

// ══════════════════════════════════════════════════════════════════════════
// CONTRAPRUEBA
// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const src = fs.readFileSync(archivo, 'utf8');

  const MUTANTES = [
    // A · el porcentaje y la frontera entre los dos documentos
    { nombre: 'la sección se calla el porcentaje debajo del piso, como el del cliente',
      hacer: () => src.replace(
        "    if (cob.pct < COBERTURA_PISO)\n      y = nota(`El reporte que se entrega al cliente NO imprime este ${PCT(cob.pct)}:",
        "    if (false)\n      y = nota(`El reporte que se entrega al cliente NO imprime este ${PCT(cob.pct)}:") },
    { nombre: 'la nota de «el cliente no ve este número» sale en todas las bandas',
      hacer: () => src.replace(
        '    if (cob.pct < COBERTURA_PISO)\n      y = nota(`El reporte que se entrega al cliente',
        '    if (true)\n      y = nota(`El reporte que se entrega al cliente') },
    { nombre: 'el corte del 80% se cuenta aquí en vez de tomarse de la cuenta',
      hacer: () => src.replace(
        "      ['Corte del 80%', String(cob.hastaTecho),",
        "      ['Corte del 80%', String(cob.partidas),") },

    // B · el respaldo sin autor
    { nombre: 'el origen de las fotos no se dice: sólo cuántas enseña',
      hacer: () => src.replace(
        '    if (mostradas > 0) {\n      st(Q.ng); fs(FS_SEC); fw(\'bold\');\n'
        + "      T('De dónde salen las fotos que respaldan', ML, y + 4);",
        '    if (false) {\n      st(Q.ng); fs(FS_SEC); fw(\'bold\');\n'
        + "      T('De dónde salen las fotos que respaldan', ML, y + 4);") },
    { nombre: 'un lote entero de archivo se reporta como si fuera mezclado',
      hacer: () => src.replace(
        '        + (deArchivo === mostradas',
        '        + (false') },
    { nombre: 'el sello de cada foto se ignora y todas cuentan como verificadas',
      hacer: () => src.replace(
        '      .filter(f => !selloDeEvidencia(f).verificada).length;',
        '      .filter(() => false).length;') },
    { nombre: 'la frase de origen se redacta aquí en vez de usar la de la app',
      hacer: () => src.replace(
        '      y = nota(`Las ${mostradas} que el expediente enseña: ${fraseOrigenEvidencia(\n'
        + '          conFotos.flatMap(p => p.fotos))}. `',
        '      y = nota(`Las ${mostradas} que el expediente enseña. `') },

    // C · cuántas de cuántas
    { nombre: 'el indicador dice cuántas enseña y no de cuántas',
      hacer: () => src.replace(
        "      ['Fotos que enseña', `${mostradas} de ${haber}`,",
        "      ['Fotos que enseña', `${mostradas}`,") },
    { nombre: 'el sobrante guardado y no impreso se calla',
      hacer: () => src.replace(
        '    if (haber > mostradas)\n      y = nota(`Esta obra tiene ${haber} fotografías vigentes',
        '    if (false)\n      y = nota(`Esta obra tiene ${haber} fotografías vigentes') },
    { nombre: 'el disponible se cuenta como lo enseñado, y el sobrante desaparece',
      hacer: () => src.replace(
        '    const haber = conFotos.reduce((t, p) => t + p.disponibles, 0);',
        '    const haber = conFotos.reduce((t, p) => t + p.fotos.length, 0);') },

    // D · la lista de trabajo
    { nombre: 'la lista de partidas grandes sin foto no se imprime',
      hacer: () => src.replace(
        '    if (selFoto.sinEvidencia.length) {\n      y = autoT(\n'
        + "        ['Clave', 'Partida', 'Importe', '% contrato', '% avance'],",
        '    if (false) {\n      y = autoT(\n'
        + "        ['Clave', 'Partida', 'Importe', '% contrato', '% avance'],") },
    { nombre: 'sin huecos no se dice nada, y la ausencia se lee como un olvido',
      hacer: () => src.replace(
        "      y = nota(`Ninguna: las ${cob.hastaTecho} partidas que hacen falta para llegar al `",
        "      y = nota(`${''} `") },
    { nombre: 'la lista de trabajo acusa también a las partidas del corte que SÍ tienen foto',
      hacer: () => src.replace(
        '        selFoto.sinEvidencia.map(p => [',
        '        [...selFoto.sinEvidencia, ...selFoto.partidas].map(p => [') },
    { nombre: 'la lista de trabajo se alarga con las partidas de fuera del corte',
      hacer: () => src.replace(
        '        selFoto.sinEvidencia.map(p => [',
        '        [...selFoto.sinEvidencia, ...selFoto.fuera].map(p => [') },
    { nombre: 'los huecos salen sin importe, así que no se pueden priorizar',
      hacer: () => src.replace(
        '          MXN(p.imp),\n          PCT(p.pesoPct),',
        "          '—',\n          PCT(p.pesoPct),") },

    // E · sin lectura, ningún número
    { nombre: 'una lectura fallida se trata como una obra sin fotos y publica 0.0%',
      hacer: () => src.replace(
        '  const selFoto = seleccionFotografica({ subs, evidencia, evidenciaCargada,\n'
        + '                                         tope: TOPE_FOTOS });',
        '  const selFoto = seleccionFotografica({ subs, evidencia, evidenciaCargada: true,\n'
        + '                                         tope: TOPE_FOTOS });') },
    { nombre: 'los dos motivos de «no medible» se dicen con el mismo texto',
      hacer: () => src.replace(
        "      + (cob.razon === 'no-leida'",
        '      + (false') },

    // F · lo que la sección no es
    { nombre: 'no se avisa que el álbum va en el otro documento',
      hacer: () => src.replace(
        "  y = nota('Aquí no van las fotos: van en el reporte que se entrega al cliente.",
        "  y = nota('Lo que sigue.  ") },
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumen-foto-'));
  let n = 0;
  for (const m of MUTANTES) {
    const mutado = m.hacer();
    if (mutado === src) {
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» no cambió nada.`);
      process.exit(2);
    }
    const f2 = path.join(dir, `app-${n}.jsx`);
    fs.writeFileSync(f2, mutado);
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f2 }, encoding: 'utf8' });
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
