#!/usr/bin/env node
// Lo que el PDF manda a la hoja tiene que poder escribirse con la fuente que lo
// pinta.
//
// QUÉ SE AFIRMA. Que NINGUNA cadena que los dos generadores mandan dibujar
// —texto libre y celdas de tabla, en el reporte del cliente y en el documento
// interno— lleva un carácter fuera de WinAnsi, que es todo lo que las fuentes
// estándar de jsPDF saben escribir. Y que el blindaje que lo consigue no se
// cobra los acentos por delante.
//
// POR QUÉ EXISTE. jsPDF no avisa. Cuando una cadena trae un carácter que la
// fuente no tiene, la serializa en UTF-16 y el lector la pinta como basura. El
// 2026-11-09, abriendo por primera vez un PDF de verdad contra el emulador, el
// reporte QUE SE ENTREGA AL CLIENTE llevaba nueve cadenas así:
//
//     «✓ PAGADA»                        (la columna de estado de estimaciones)
//     «Avance ≥ 75%»                    (el criterio de la cobertura)
//     «Operación → Nómina»              (tres instrucciones de captura)
//
// y el documento interno llevaba «Sin avance ≥2 semanas · 9, 10, 12» en la
// columna que dice con qué número disparó un riesgo. Ninguna de las 107 pruebas
// lo vio, y no por descuido: TODAS miran la cadena de JavaScript, y el destrozo
// pasa después, al serializar. El defecto no está en lo que el generador decide
// —eso estaba bien— sino en que nadie había mirado la hoja.
//
// Hay además una trampa propia: `MXNS` escribe el menos con el signo
// tipográfico `−` (U+2212), no con el guion. Así que CADA cifra negativa de los
// dos documentos salía ilegible, y el margen negativo es justo el número por el
// que se abre el papel.
//
// LA FORMA DE AFIRMARLO. No se mira la tabla de sustitutos ni se comprueba que
// `textoImprimible` exista: se CORREN los dos generadores sobre datos que traen
// los caracteres del problema metidos a mano —en el nombre de la obra, en las
// descripciones de las partidas, en el cliente— y se barre TODO lo que quedó
// anotado en la hoja buscando un carácter que la fuente no sepa escribir. La
// aserción es sobre la hoja, no sobre el código que la escribe.
//
// Por eso hace falta el blindaje DENTRO del `doc` y no en cada sitio que
// escribe: las celdas de `autoTable` no pasan por `text()` del generador, las
// coloca el plugin. El lienzo falso contesta lo que el generador haya instalado
// encima (ver `lienzo-pdf.cjs`), así que lo que este banco anota es lo que la
// hoja recibiría.
//
// Uso:  node scripts/prueba-el-pdf-escribe-lo-que-se-lee.cjs
//       node scripts/prueba-el-pdf-escribe-lo-que-se-lee.cjs --contraprueba
//
// Tres estados: verde 0 · ROJO 1 · NO ARRANCÓ 2.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { dibujarPDF, dibujarPDFInterno, lienzo,
        textoCorrido } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

const PEDIDOS = ['generarPDFObra', 'generarPDFInterno', 'textoImprimible',
                 'blindarTextoDelPDF', 'MXNS'];
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
const { generarPDFObra, generarPDFInterno, textoImprimible, blindarTextoDelPDF, MXNS } = APP;

// ── QUÉ SABE ESCRIBIR LA FUENTE ────────────────────────────────────────────
// WinAnsi, dicho aquí por su DEFINICIÓN y no copiando la del generador: los
// imprimibles de ASCII, el bloque alto de Latin-1, y los 27 huecos que Windows
// metió en 0x80–0x9F. Si este banco importara el conjunto del generador, los
// dos se equivocarían a la vez y el banco diría verde.
const EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const loEscribe = (c) => {
  const n = c.codePointAt(0);
  return (n >= 32 && n <= 126) || (n >= 0xA0 && n <= 0xFF) || EXTRA.has(c)
         || c === '\n' || c === '\t';
};
const ilegibles = (s) => [...String(s)].filter(c => !loEscribe(c));

// ── LOS DATOS, CON EL PROBLEMA METIDO A MANO ───────────────────────────────
// Los caracteres van en los campos que el usuario TECLEA —nombre de obra,
// descripción de partida, cliente—, porque ahí es donde un carácter que nadie
// previó entra de verdad: se pega desde un Excel o un oficio. Un banco que
// sólo contara con los caracteres que el generador trae escritos comprobaría
// el blindaje de hoy y no el de mañana.
const RAROS = '→ ≥ ✓ − ≈ ≤ ✗ ⚑';
const AÑO = new Date().getFullYear();
const SELLO = { ms: Date.UTC(2026, 2, 15, 18, 0, 0), fuente: 'servidor' };

const OBRA = {
  // El nombre va LARGO a propósito: en la portada se parte en dos renglones
  // dentro de una caja que ocupa el 38% de la hoja, y ésa es la única manera de
  // que la §E mire un párrafo de verdad partido. Los nombres de obra de
  // producción son así de largos —«Construcción del malecón costero, etapa 2»—;
  // el corto de antes no partía nada y la §E habría dado verde por vacío.
  id: '0114',
  nombre: `Construcción del malecón costero ✓ etapa 2 → 3, Coatzacoalcos`,
  contrato: 'SIOP-2026-001',
  cliente: 'H. Ayuntamiento ≥ Coatzacoalcos', ubicacion: 'Coatzacoalcos, Ver.',
  inicio: `${AÑO - 1}-01-10`, fin: `${AÑO + 1}-12-20`, presupuesto: 38500000,
  gpId: '0114',
};
const SUBS = [
  { id: 'p1', desc: `Terracerías → corte ≥ 2 m`, imp: 20000000, a: 60 },
  { id: 'p2', desc: 'Pavimento ✓ autorizado', imp: 18500000, a: 30 },
];
// Una estimación PAGADA: es el renglón que imprimía «✓ PAGADA».
const ESTIMACIONES = [
  { id: 'e1', numero: 1, monto: 5000000, estado: 'pagada', fecha: `${AÑO}-02-10`,
    fechaPago: `${AÑO}-03-01` },
  { id: 'e2', numero: 2, monto: 3000000, estado: 'aprobada', fecha: `${AÑO}-04-10` },
];

// ── LAS DOS HOJAS ──────────────────────────────────────────────────────────
const hojaDe = async (quien, correr) => {
  let d;
  try { d = await correr(); }
  catch (e) {
    console.error(`\nNO ARRANCÓ: ${quien} no se pudo dibujar: ${e.message}`);
    process.exit(2);
  }
  if (!d || d.length < 20) {
    console.error(`\nNO ARRANCÓ: ${quien} sólo dibujó ${d ? d.length : 0} textos; `
      + 'con la hoja casi vacía un «no aparece» se cumple por vacío.');
    process.exit(2);
  }
  return d;
};

(async () => {

const hojaCliente = await hojaDe('el reporte del cliente', () => dibujarPDF(
  generarPDFObra, {}, OBRA,
  { subs: SUBS, estimaciones: ESTIMACIONES, instante: SELLO }));

const hojaInterna = await hojaDe('el documento interno', () => dibujarPDFInterno(
  generarPDFInterno,
  { obra: OBRA, subs: SUBS, estimaciones: ESTIMACIONES, instante: SELLO,
    organizacion: 'FOSMON Construcciones → Obra', generadoPor: 'demo@fosmon.com.mx' }));

// ══════════════════════════════════════════════════════════════════════════
// A · NADA ILEGIBLE LLEGA A LA HOJA
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── A · la hoja sólo lleva lo que la fuente escribe ───────────');

for (const [quien, hoja] of [['el reporte del cliente', hojaCliente],
                             ['el documento interno', hojaInterna]]) {
  const malas = hoja
    .map(d => ({ d, malos: ilegibles(d.texto) }))
    .filter(x => x.malos.length);
  const muestra = malas.slice(0, 3).map(x =>
    `«${String(x.d.texto).slice(0, 48)}» (${[...new Set(x.malos)].join('')})`);
  ok(malas.length === 0,
    `${quien}: ninguna de sus ${hoja.length} cadenas lleva un carácter que la fuente `
    + 'no sepa escribir'
    + (malas.length ? ` — ${malas.length} la(n) llevan: ${muestra.join(' · ')}` : ''));
}

// Y las CELDAS DE TABLA aparte, nombradas: no pasan por el `text()` del
// generador, las coloca el plugin. Si el blindaje se hubiera puesto sólo en
// `text()`, esta aserción sería la única en rojo.
for (const [quien, hoja] of [['el reporte del cliente', hojaCliente],
                             ['el documento interno', hojaInterna]]) {
  const celdas = hoja.filter(d => d.tabla);
  if (!celdas.length) {
    console.error(`\nNO ARRANCÓ: ${quien} no dibujó ninguna celda de tabla; `
      + 'sin celdas esta aserción se cumple por vacío.');
    process.exit(2);
  }
  const malas = celdas.filter(d => ilegibles(d.texto).length);
  ok(malas.length === 0,
    `${quien}: sus ${celdas.length} celdas de tabla también`
    + (malas.length ? ` — ${malas.length} ilegible(s)` : ''));
}

// ══════════════════════════════════════════════════════════════════════════
// B · EL CASO SE TRAJO EL PROBLEMA, NO SE DIO POR BUENO POR VACÍO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── B · el caso de verdad traía caracteres del problema ───────');

// Sin esta aserción, A pasaría con un generador que no imprime nada raro
// porque el CASO no le dio nada raro. Lo que entró lleva ocho de ellos.
ok(ilegibles(RAROS).length >= 6,
  `el caso mete ${ilegibles(RAROS).length} caracteres que la fuente no escribe`);
ok(ilegibles(OBRA.nombre).length >= 2 && ilegibles(SUBS[0].desc).length >= 2,
  'y los mete por donde se teclean: el nombre de la obra y la descripción de la partida');

// El menos de `MXNS` es el del problema, y es el que lleva toda cifra negativa.
ok(ilegibles(MXNS(-1000)).length === 1,
  `MXNS escribe el menos con un signo que la fuente no tiene: «${MXNS(-1000)}»`);
// Y aun así no llega así a la hoja.
ok(ilegibles(textoImprimible(MXNS(-1000))).length === 0
   && /^-\$/.test(textoImprimible(MXNS(-1000))),
  `pero a la hoja llega con guion corriente: «${textoImprimible(MXNS(-1000))}»`);

// Los que el generador trae escritos. Si el reporte dejara de imprimirlos, esta
// comprobación lo diría en vez de dar verde por un documento que cambió.
const crudoCliente = fs.readFileSync(archivo, 'utf8');
ok(/✓\s*PAGADA|✓ PAGADA/.test(crudoCliente) || /Avance ≥/.test(crudoCliente)
   || /Operación →/.test(crudoCliente),
  'el reporte del cliente sigue trayendo escritos los caracteres del hallazgo');

// ══════════════════════════════════════════════════════════════════════════
// C · LOS SUSTITUTOS DICEN LO MISMO, Y NO SE COMEN LOS ACENTOS
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── C · se sustituye, no se borra ────────────────────────────');

const PARES = [
  ['→', '->'], ['⇒', '->'], ['←', '<-'],
  ['≥', '>='], ['≤', '<='], ['≠', '!='], ['≈', '~'],
  ['−', '-'], ['✓', 'OK'], ['✗', 'X'],
];
const mal = PARES.filter(([de, a]) => textoImprimible(`[${de}]`) !== `[${a}]`);
ok(mal.length === 0,
  `los ${PARES.length} sustitutos dicen lo mismo en texto llano`
  + (mal.length ? ` — fallan ${mal.map(([d]) => d).join(' ')}` : ''));

// LO QUE NO SE PUEDE PERDER. Un blindaje que arrasara con lo que no reconoce
// se llevaría el español por delante, y nadie lo notaría hasta ver un PDF.
const ESPAÑOL = 'IDENTIFICACIÓN · qué faltó · años · Ñandú «cotea» – 25 € ±2 m² 3ª';
ok(textoImprimible(ESPAÑOL) === ESPAÑOL,
  'los acentos, la eñe, el punto medio, las comillas y el guion medio pasan intactos');
const sinAcentos = hojaInterna.filter(d => /IDENTIFICACION|Pagina|interes/.test(d.texto));
ok(sinAcentos.length === 0,
  'y en la hoja no quedó una sola palabra desacentuada'
  + (sinAcentos.length ? ` — ${sinAcentos[0].texto}` : ''));

// LO DESCONOCIDO SE VE. Un carácter que nadie previó tiene que salir como un
// hueco visible, no desaparecer: una cadena que se adelgaza en silencio es la
// que acaba firmada sin que nadie note que le falta algo.
const RARO_NUEVO = '\u2318';             // ⌘, que no está en la tabla
ok(textoImprimible(`a${RARO_NUEVO}b`) === 'a?b',
  'un carácter que la tabla no previó sale como «?» y no se borra en silencio');
ok(textoImprimible('abc') === 'abc' && textoImprimible(null) === null
   && textoImprimible(undefined) === undefined,
  'y lo que ya era escribible no se toca');

// ══════════════════════════════════════════════════════════════════════════
// D · EL PORTÓN NO LE CAMBIA LA FIRMA AL `doc` QUE ENVUELVE
// ══════════════════════════════════════════════════════════════════════════
// `doc.text` de jsPDF acepta una LISTA de renglones y pinta uno por renglón.
// Los dos generadores lo llaman así, y la §E lo mira desde la hoja; esta
// sección mira el PORTÓN, que es el otro sitio donde la lista se puede
// aplanar: un blindaje que saneara `['a','b']` a `'a,b'` dejaría la hoja
// correcta en el doble y rota en el PDF de verdad.
console.log('\n── D · el portón respeta la firma de lo que envuelve ─────────');

const juguete = () => {
  const visto = { text: [], partir: [], tabla: [] };
  const d = {
    text: (v) => { visto.text.push(v); },
    splitTextToSize: (v) => { visto.partir.push(v); return [String(v)]; },
    getTextWidth: (v) => { visto.text.push(v); return 1; },
    autoTable: (o) => { visto.tabla.push(o); },
  };
  return { d: blindarTextoDelPDF(d), visto };
};

const j1 = juguete();
j1.d.text(['Operación → Nómina', 'Avance ≥ 75%'], 10, 10);
const recibido = j1.visto.text[0];
ok(Array.isArray(recibido) && recibido.length === 2,
  'con una lista de renglones sigue pasando una lista, no una cadena pegada');
ok(Array.isArray(recibido)
   && recibido[0] === 'Operación -> Nómina' && recibido[1] === 'Avance >= 75%',
  'y sanea cada renglón por su cuenta');

const j2 = juguete();
j2.d.autoTable({ head: [['Avance ≥ 75%']],
                 body: [[{ content: '✓ PAGADA', styles: { fontStyle: 'bold' } }, '→']] });
const t = j2.visto.tabla[0];
ok(t.head[0][0] === 'Avance >= 75%', 'la cabecera de la tabla se sanea');
ok(t.body[0][0].content === 'OK PAGADA' && t.body[0][0].styles.fontStyle === 'bold',
  'y la celda con estilos se sanea SIN perder sus estilos');
ok(t.body[0][1] === '->', 'y la celda que es una cadena pelada también');

// ══════════════════════════════════════════════════════════════════════════
// E · LO QUE SE MANDÓ PARTIR LLEGA A LA HOJA PARTIDO
// ══════════════════════════════════════════════════════════════════════════
// La hermana de la §A. Allá se afirma que cada cadena se puede ESCRIBIR; aquí,
// que se puede LEER: que está dentro del papel y en los renglones en que se
// pidió partirla.
//
// Pasó de verdad el 2026-11-10, en el preludio de la gráfica única: el ayudante
// `T` de los dos generadores hacía `String(s)`, y `String(['uno','dos'])` es
// `'uno,dos'`. Un párrafo de tres renglones salía pegado con comas en una línea
// de 756 puntos sobre una hoja de 791 que empieza en 40: el final de la frase
// —«un trecho punteado es un salto sobre semanas sin captura, no una medición»—
// quedaba fuera del papel. Y en la portada, donde el nombre de la obra sí cabía
// aplastado, salía con una coma impresa en medio pisando la mitad derecha.
//
// Ningún banco lo vio, y la razón vale más que el defecto: el lienzo de mentira
// devolvía el párrafo entero en un arreglo de UN elemento, así que `String` de
// ese arreglo era el párrafo y el doble no podía distinguir un generador
// correcto de uno roto. Ahora el lienzo parte de verdad —con un ancho medio
// declarado, ver `lienzo-pdf.cjs`— y apunta qué forma tendría cada párrafo
// aplastado de vuelta.
console.log('\n── E · lo que se mandó partir llega a la hoja partido ────────');

// El ancho se le pregunta al MISMO lienzo sobre el que dibujaron los dos
// generadores, en vez de teclear 279: dos sitios con la medida del papel acaban
// midiendo dos papeles distintos.
const ANCHO_HOJA = lienzo().doc.internal.pageSize.getWidth();

for (const [quien, hoja] of [['el reporte del cliente', hojaCliente],
                             ['el documento interno', hojaInterna]]) {
  // EL CONTROL, PRIMERO, y en ROJO y no en NO ARRANCÓ. Un documento de puras
  // frases cortas no parte nada y dejaría vacías a las dos aserciones de abajo
  // —por eso el caso trae un nombre de obra largo—. Pero «no partió nada» es
  // también lo que se ve cuando alguien aplasta los renglones antes de
  // dibujarlos, que es el defecto mismo: eso es ROJO, no un banco que no pudo
  // arrancar.
  const partidos = textoCorrido(hoja).filter(c => !hoja.some(d => d.texto === c.texto));
  ok(partidos.length > 0,
    `${quien}: ${partidos.length} párrafo(s) se reparten de verdad en varios `
    + 'renglones. Cero querría decir que alguien los pegó antes de dibujarlos');

  const aplastados = hoja.filter(d => d.pegado > 1);
  ok(aplastados.length === 0,
    `${quien}: ninguno se dibuja aplastado de vuelta a un solo renglón`
    + (aplastados.length ? ` — ${aplastados.length} lo está(n), el primero con `
        + `${aplastados[0].pegado} renglones: «${aplastados[0].texto.slice(0, 60)}…»` : ''));

  // Y QUE NADA TERMINE FUERA DEL PAPEL. Los alineados a la derecha o al centro
  // se excluyen: su `x` no es el borde izquierdo del texto, así que sumarle el
  // ancho no significa nada.
  const izq = hoja.filter(d => d.tabla === undefined && d.x !== undefined
                               && (!d.align || d.align === 'left'));
  const fuera = izq.filter(d => d.x + d.ancho > ANCHO_HOJA);
  ok(fuera.length === 0,
    `${quien}: ninguno de sus ${izq.length} renglones termina fuera de la hoja`
    + (fuera.length ? ` — se salen ${fuera.length}, el peor por `
        + `${Math.round(Math.max(...fuera.map(d => d.x + d.ancho - ANCHO_HOJA)))} mm: `
        + `«${fuera[0].texto.slice(0, 60)}…»` : ''));
}

console.log('');
if (fallas) {
  console.log(`${verdes} en verde · ${fallas} en rojo.`);
  process.exit(1);
}
console.log(`${verdes} en verde. Lo que el PDF manda a la hoja se puede leer en la hoja.`);

// ══════════════════════════════════════════════════════════════════════════
// LA CONTRAPRUEBA
// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── CONTRAPRUEBA ─────────────────────────────────────────────');
  const src = fs.readFileSync(archivo, 'utf8');
  const MUTANTES = [
    { nombre: 'el blindaje se cae del reporte del cliente',
      hacer: () => src.replace(
        "  const doc = blindarTextoDelPDF(new jsPDF({orientation:'landscape',unit:'mm',format:'letter'}));\n"
        + '  const pf   = n => parseFloat(n)||0;',
        "  const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'letter'});\n"
        + '  const pf   = n => parseFloat(n)||0;') },
    { nombre: 'el blindaje se cae del documento interno',
      hacer: () => src.replace(
        "  const doc = blindarTextoDelPDF(new jsPDF({orientation:'landscape',unit:'mm',format:'letter'}));\n"
        + '  const PCT = (n,d=1) => `${(n||0).toFixed(d)}%`;',
        "  const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'letter'});\n"
        + '  const PCT = (n,d=1) => `${(n||0).toFixed(d)}%`;') },
    { nombre: 'el blindaje deja fuera las celdas de tabla',
      hacer: () => src.replace(
        '  const tablaOriginal = doc.autoTable.bind(doc);\n'
        + '  doc.autoTable = (opts = {}, ...resto) => tablaOriginal(\n'
        + '    { ...opts, head: filas(opts.head), body: filas(opts.body) }, ...resto);',
        '  const tablaOriginal = doc.autoTable.bind(doc);\n'
        + '  doc.autoTable = (opts = {}, ...resto) => tablaOriginal(opts, ...resto);') },
    { nombre: 'el blindaje deja fuera el texto libre',
      hacer: () => src.replace(
        '  const textoOriginal = doc.text.bind(doc);\n'
        + '  doc.text = (v, ...resto) => textoOriginal(sanear(v), ...resto);',
        '  const textoOriginal = doc.text.bind(doc);\n'
        + '  doc.text = (v, ...resto) => textoOriginal(v, ...resto);') },
    // Ésta sólo la ve la §D: ningún generador llama hoy a `text()` con lista,
    // así que desde la hoja no se puede ver. Por eso existe la §D.
    { nombre: 'el portón aplana la lista de renglones en una sola cadena',
      hacer: () => src.replace(
        '  const sanear = (v) => (Array.isArray(v) ? v.map(textoImprimible) : textoImprimible(v));',
        '  const sanear = (v) => textoImprimible(v);') },
    { nombre: 'el blindaje no mira dentro de la celda con estilos',
      hacer: () => src.replace(
        "  const celda = (c) => (c && typeof c === 'object' && 'content' in c\n"
        + '    ? { ...c, content: textoImprimible(c.content) }\n'
        + '    : textoImprimible(c));',
        "  const celda = (c) => (c && typeof c === 'object' && 'content' in c\n"
        + '    ? c\n'
        + '    : textoImprimible(c));') },
    { nombre: 'lo desconocido se borra en silencio en vez de verse',
      hacer: () => src.replace(
        "    else out += '?';",
        "    else out += '';") },
    // Ésta es la que importa de verdad: un blindaje que no reconozca el bloque
    // alto de Latin-1 pasa el barrido de la §A con sobresaliente —no queda un
    // solo carácter raro— porque se llevó los acentos por delante.
    { nombre: 'el blindaje deja de reconocer el bloque alto de Latin-1 y desacentúa el español',
      hacer: () => src.replace(
        "    if ((n >= 32 && n <= 126) || (n >= 0xA0 && n <= 0xFF) || WINANSI_EXTRA.has(c)) out += c;",
        "    if ((n >= 32 && n <= 126) || WINANSI_EXTRA.has(c)) out += c;") },
    { nombre: 'el mayor-o-igual se sustituye por algo que dice otra cosa',
      hacer: () => src.replace(
        "  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~',",
        "  '≥': '>', '≤': '<', '≠': '!=', '≈': '~',") },
    { nombre: 'el menos tipográfico se queda sin sustituto y toda cifra negativa sale ilegible',
      hacer: () => src.replace(
        "  '−': '-', '‒': '-', '―': '-',     // menos y rayas tipográficas",
        "  '‒': '-', '―': '-',     // menos y rayas tipográficas") },
    { nombre: 'la flecha se queda sin sustituto',
      hacer: () => src.replace(
        "  '→': '->', '⇒': '->', '←': '<-', '⇐': '<-', '↑': '^', '↓': 'v',",
        "  '⇒': '->', '←': '<-', '⇐': '<-', '↑': '^', '↓': 'v',") },

    // ── E · el párrafo aplastado, en los dos generadores ───────────────────
    // El defecto tal como estaba el 2026-11-10. Van los dos por separado:
    // arreglado en uno solo, el otro seguiría sacando párrafos fuera de la hoja
    // y nadie lo vería.
    { nombre: 'el reporte del cliente vuelve a aplastar los renglones de un párrafo',
      hacer: () => src.replace(
        "  const T  = (s,x,y,o={}) => doc.text(\n"
        + "    Array.isArray(s) ? s.map(v => String(v ?? '')) : String(s||''), x, y, o);\n"
        + '\n  // Dibuja header/footer en página actual',
        "  const T  = (s,x,y,o={}) => doc.text(String(s||''),x,y,o);"
        + '\n\n  // Dibuja header/footer en página actual') },
    { nombre: 'el documento interno vuelve a aplastar los renglones de un párrafo',
      hacer: () => src.replace(
        "  const T  = (s,x,y,o={}) => doc.text(\n"
        + "    Array.isArray(s) ? s.map(v => String(v ?? '')) : String(s||''), x, y, o);\n"
        + '\n  // El sello de INTERNO',
        "  const T  = (s,x,y,o={}) => doc.text(String(s||''),x,y,o);"
        + '\n\n  // El sello de INTERNO') },
  ];
  // NO hay mutación de `lienzo-pdf.cjs`. No hace falta: si el lienzo dejara de
  // contestar lo que el generador instaló encima del `doc`, anotaría la cadena
  // de antes del blindaje y la §A entera saldría en rojo con el repo intacto.
  // La fidelidad del lienzo la sostiene el verde de este banco, no una mutación.

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-legible-'));
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
