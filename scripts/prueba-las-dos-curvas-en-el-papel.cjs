#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS DOS GRÁFICAS DEL DOCUMENTO INTERNO NO AFIRMAN LO QUE NADIE MIDIÓ
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que el papel DIBUJA: los trazos, con su color, su grosor y
// su guión, anotados por el lienzo de mentira. No que `dibujarCurvaEnPDF`
// exista, y tampoco sólo sus rótulos: en una gráfica los rótulos son el
// adorno y la línea es la afirmación.
//
// POR QUÉ UNA GRÁFICA NECESITA SU PROPIO BANCO. Una tabla que no sabe un dato
// imprime una raya y el lector la ve. Una gráfica que no sabe un dato
// simplemente no traza, y el hueco se lee como un cero medido. Las cuatro
// mentiras que este banco persigue son las cuatro maneras en que eso pasa:
//
//   A. EL EJE CORTADO POR ABAJO. Medido en producción, la 0114 se mueve entre
//      $80M y $161M. Con el eje arrancando en $80M, un margen de $4M ocupa un
//      quinto del alto del dibujo. El eje arranca en CERO.
//
//   B. EL TRECHO CONTINUO SOBRE UN HUECO. Nueve de las treinta y seis series
//      de las siete obras vivas saltan semanas sin captura. Trazadas sólido,
//      afirman una medición que nadie hizo: va PUNTEADO.
//
//   C. LA SERIE QUE ESTÁ EN LA LEYENDA Y NO EN EL DIBUJO. Tres de esas treinta
//      y seis no dibujaban NADA —una sola semana medida, o dos de las que una
//      viene sin medir— y la leyenda las nombraba con su color. Se marca el
//      punto Y se dice con palabras por qué no hay línea.
//
//   D. LA GRÁFICA INCOMPLETA QUE SE VE COMPLETA. Lo que la curva no pudo
//      dibujar sale NOMBRADO y con su motivo, como la sección 6.
//
//   E. LA FRONTERA DE LA SECCIÓN 7. La gráfica de la dependencia no trae la
//      economía del contratista: ni la cifra en la hoja, ni la clave en el
//      objeto que la alimenta. Las dos cosas, porque esconder una serie deja
//      el dato vivo a una línea de reaparecer.
//
//   F. LOS COLORES. `C.blueDk` ya no es un color sino `var(--c-blueDk)`, un
//      puntero a `tokens.css`. jsPDF quiere tres números. La tabla `RGB_DE_TOKEN`
//      es una COPIA de ese CSS, y este banco LEE el archivo y la compara terna
//      por terna: una copia que nadie enfrenta se desincroniza.
//
//   node scripts/prueba-las-dos-curvas-en-el-papel.cjs
//   node scripts/prueba-las-dos-curvas-en-el-papel.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { lienzo, dibujarPDFInterno, textoCorrido } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const CSS = path.join(path.dirname(archivo), 'styles', 'tokens.css');

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
// Se piden las dos curvas Y el dibujante Y el generador. Las curvas porque la
// expectativa de D y de E sale de ejecutarlas con los MISMOS insumos que
// recibe el papel: tecleada aquí, la expectativa sería una segunda copia que
// se comprueba contra sí misma.
const PEDIDOS = ['dibujarCurvaEnPDF', 'generarPDFInterno', 'curvaUnicaDeObra',
  'curvaDeGobierno', 'semanasDeVentana', 'RGB_DE_TOKEN', 'rgbDeColorToken',
  'COLOR_CURVA', 'fmtDineroCorto', 'MXN', 'C'];
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
const { dibujarCurvaEnPDF, generarPDFInterno, curvaUnicaDeObra, curvaDeGobierno,
        semanasDeVentana, RGB_DE_TOKEN, rgbDeColorToken, COLOR_CURVA,
        fmtDineroCorto, MXN, C } = APP;

// ── EL CASO ────────────────────────────────────────────────────────────────
// Las semanas son las de HOY, pedidas a la misma función que usa el generador.
// Tecleadas, el banco mediría una ventana contra otra al cambiar de año.
const AÑO = new Date().getFullYear();
const SELLO = { ms: Date.UTC(2026, 2, 15, 18, 0, 0), fuente: 'servidor' };
const OBRA = {
  id: '0131', nombre: 'Centro de convenciones', contrato: 'SIOP-2026-0131',
  cliente: 'H. Ayuntamiento de Coatzacoalcos',
  inicio: `${AÑO - 1}-02-02`, fin: `${AÑO + 1}-06-30`,
  presupuesto: 45000000, gpId: '0131', diasPago: 30,
};
const SEMS = semanasDeVentana(OBRA, 12);
if (SEMS.length < 6) {
  console.error(`\nNO ARRANCÓ: la ventana salió con ${SEMS.length} semanas; `
    + 'con tan pocas no hay hueco que saltar y la §B saldría verde por vacío.');
  process.exit(2);
}
const N = SEMS.length;
const CATALOGO = [{ id: 'p1', desc: 'Obra civil', imp: 45000000, a: 70.67 }];

// EL CASO CON HUECO. Hay corte de avance en todas las semanas MENOS en un
// tramo de en medio: eso es lo que obliga al trecho punteado de la §B. Y el
// gasto arranca alto —$9M en la primera semana— para que el eje tenga de
// dónde cortarse por abajo si alguien se lo propusiera: la §A no se cumple
// por vacío si la serie ya pasa cerca de cero.
const HUECO = [3, 4];   // índices sin corte capturado
const historialAvance = [];
SEMS.forEach((s, i) => {
  if (HUECO.includes(i)) return;
  historialAvance.push({ tipo: 'oficial', año: AÑO, semana: s.sem,
    avance: 10, avancePonderado: 10, montoEjecutado: 12000000 + 1800000 * i });
});
let prev = 0;
const semanasGP = {};
SEMS.forEach((s, i) => { const g = 9000000 + 1500000 * i; semanasGP[`S${s.sem}`] = g - prev; prev = g; });
const gpData = {
  ultimaSemana: `S${SEMS[N - 1].sem}`,
  semanasDisponibles: SEMS.map(s => ({ año: s.año, semana: s.sem })),
  obrasPedidas: [OBRA.gpId],
  obras: { [OBRA.gpId]: { id: OBRA.gpId, nombre: OBRA.nombre,
                          grandTotal: prev, semanas: semanasGP } },
};

const DATOS = {
  obra: OBRA, subs: CATALOGO, estimaciones: [], estCargadas: true,
  maquinaria: [], materiales: [], subcontratos: [], historialAvance,
  gpData, gpDetalle: null, otrosGastos: [], nominaHistorial: [], programa: null,
  instante: SELLO, organizacion: 'FOSMON Construcciones',
  generadoPor: 'demo@fosmon.com.mx',
};

const CURVA = curvaUnicaDeObra({ semanas: SEMS, obra: OBRA, historialAvance,
  subs: CATALOGO, gpData, otrosGastos: [], maquinaria: [], programa: null });
const CURVA_GOB = curvaDeGobierno({ semanas: SEMS, obra: OBRA, historialAvance,
  subs: CATALOGO, programa: null, estimaciones: [], estCargadas: true });

// Lo que el dibujante hace con una curva, a solas: el lienzo devuelve los
// trazos con la pluma que los pintó.
const dibujarSola = (curva) => {
  const { doc, dibujos, trazos } = lienzo();
  const r = dibujarCurvaEnPDF(doc, curva, { x: 14, y: 30, w: 251, h: 86 });
  return { ...r, dibujos, trazos };
};
const mismoColor = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length && a.every((v, i) => v === b[i]);

(async () => {

// ══════════════════════════════════════════════════════════════════════════
// A · EL EJE ARRANCA EN CERO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── A · el eje arranca en cero ───────────────────────────────');

const sola = dibujarSola(CURVA);
ok(!sola.parte.vacia && sola.parte.tramos > 0,
  `el caso dibuja ${sola.parte.tramos} trecho(s): hay gráfica que medir`);

// El mínimo de lo que se dibuja. Si el eje se cortara por abajo, la cifra más
// baja de la rejilla sería ésta y no el cero.
const valores = CURVA.lineas.flatMap(l => (l.valores || []).filter(v => typeof v === 'number'));
const minSerie = Math.min(...valores);
ok(minSerie > 5000000,
  `la serie más baja del caso arranca en ${fmtDineroCorto(minSerie)}: `
  + 'hay de dónde cortar el eje, así que la comprobación no se cumple por vacío');

// La rejilla imprime cinco cifras. La de abajo es el piso del eje.
const cifrasRejilla = sola.dibujos.filter(d => d.align === 'right').map(d => d.texto);
ok(cifrasRejilla.includes(fmtDineroCorto(0)),
  `la rejilla imprime el cero como piso del eje: «${fmtDineroCorto(0)}» entre `
  + `[${cifrasRejilla.join(', ')}]`);
ok(!cifrasRejilla.includes(fmtDineroCorto(minSerie)),
  `y NO arranca en el mínimo de la serie (${fmtDineroCorto(minSerie)}), que es `
  + 'la manera clásica de agrandar a la vista el hueco entre dos curvas');

// El techo sí sale de la serie: un eje que no llegara arriba recortaría la
// curva, que es la mentira contraria.
ok(sola.parte.ejeMax >= Math.max(...valores),
  `el techo del eje (${fmtDineroCorto(sola.parte.ejeMax)}) alcanza el máximo `
  + `de la serie (${fmtDineroCorto(Math.max(...valores))})`);

// ══════════════════════════════════════════════════════════════════════════
// B · EL TRECHO QUE SALTA SEMANAS SIN CAPTURA VA PUNTEADO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── B · lo que salta un hueco no se traza sólido ─────────────');

const ejec = CURVA.lineas.find(l => l.clave === 'ejec');
ok(!!ejec && (ejec.medido || []).filter(m => m === false).length === HUECO.length,
  `el ejecutado trae ${HUECO.length} semana(s) sin medir en la ventana: `
  + 'hay hueco que saltar');

const colorEjec = rgbDeColorToken(COLOR_CURVA.ejec);
ok(!!colorEjec, `el color del ejecutado resuelve a una terna: [${colorEjec}]`);

const lineasEjec = sola.trazos.filter(t => t.tipo === 'line' && mismoColor(t.trazo, colorEjec));
const punteadasEjec = lineasEjec.filter(t => t.punteado);
ok(lineasEjec.length > 0, `el ejecutado traza ${lineasEjec.length} segmento(s)`);
ok(punteadasEjec.length > 0,
  `y ${punteadasEjec.length} de ellos salen PUNTEADOS: el salto sobre las `
  + 'semanas sin captura no se afirma como medición');
ok(punteadasEjec.length < lineasEjec.length,
  'y no todos: lo que sí se midió se traza sólido, o el punteado no distinguiría nada');

ok(sola.parte.punteados > 0,
  `el parte del dibujante cuenta ${sola.parte.punteados} trecho(s) interpolado(s)`);

// ══════════════════════════════════════════════════════════════════════════
// C · LA SERIE SIN LÍNEA SE MARCA Y SE DICE
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── C · la serie que no traza línea no se queda callada ──────');

// Una curva de una sola semana medida. Es la forma de la 0112 y de la 0131 en
// producción: `tramosDeSerie` necesita DOS puntos para armar un trecho, así
// que la serie queda en la leyenda y no en el dibujo.
const UNA_SOLA = {
  semanas: SEMS.slice(0, 4).map(s => ({ ...s })),
  lineas: [{ clave: 'pagado', nombre: 'Pagado al contratista',
             color: COLOR_CURVA.pagado, valores: [null, null, 7000000, null] }],
  areas: [], ausentes: [], notas: [],
};
const solita = dibujarSola(UNA_SOLA);
ok(solita.parte.tramos === 0,
  'con una sola semana medida no se arma ningún trecho, que es el defecto medido');
ok(solita.parte.marcas === 1,
  `y el punto se marca igual: ${solita.parte.marcas} marca(s) en el dibujo`);
const circulos = solita.trazos.filter(t => t.tipo === 'circle');
ok(circulos.length === 1 && mismoColor(circulos[0].relleno, rgbDeColorToken(COLOR_CURVA.pagado)),
  'la marca va del color de SU serie, no de un gris que la volvería anónima');
ok(solita.parte.soloPuntos.length === 1
   && solita.parte.soloPuntos[0].clave === 'pagado',
  'y el parte delata por nombre la serie que no trazó línea, para que el pie lo diga');

// Y el documento lo dice CON PALABRAS. El punto solo no basta: un punto en una
// gráfica de doce semanas se confunde con un marcador de serie.
const { doc: d2 } = lienzo();
const sueltos = dibujarCurvaEnPDF(d2, UNA_SOLA, { x: 14, y: 30, w: 251, h: 86 });
ok(sueltos.parte.soloPuntos[0]?.puntos === 1,
  'el parte dice CUÁNTAS semanas sueltas trae, no sólo que las trae');

// ══════════════════════════════════════════════════════════════════════════
// D · LO QUE LA GRÁFICA NO DIBUJA SALE NOMBRADO Y CON SU MOTIVO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── D · lo ausente se imprime con su motivo ──────────────────');

let hoja;
try { hoja = await dibujarPDFInterno(generarPDFInterno, DATOS); }
catch (e) {
  console.error(`\nNO ARRANCÓ: el documento no se pudo dibujar: ${e.message}`);
  process.exit(2);
}
// EL GENERADOR ENVUELVE TODO EN UN `try/catch` Y AVISA POR `alert`. Sin mirar
// eso, un generador que revienta en la página tres deja veinte comprobaciones
// en rojo por «el papel no dice tal cosa» y el diagnóstico apunta al sitio
// equivocado. Un reventón es NO ARRANCÓ, no rojo.
if (hoja.reventones.length) {
  console.error(`\nNO ARRANCÓ: el generador reventó: ${hoja.reventones.join(' | ')}`);
  process.exit(2);
}
const textos = hoja.map(x => x.texto);
const enTabla = hoja.filter(x => x.tabla !== undefined).map(x => x.texto);
const enTexto = hoja.filter(x => x.tabla === undefined).map(x => x.texto);

ok(CURVA.ausentes.length > 0,
  `la curva del caso declara ${CURVA.ausentes.length} serie(s) ausente(s): `
  + 'hay algo que el papel tiene que confesar');
const sinNombrar = CURVA.ausentes.filter(a => !enTabla.includes(a.nombre));
ok(sinNombrar.length === 0,
  'las ausentes salen NOMBRADAS en la tabla de lo que la gráfica no dibuja'
  + (sinNombrar.length ? ` — faltan ${sinNombrar.map(a => a.clave).join(', ')}` : ''));
const sinMotivo = CURVA.ausentes.filter(a => !enTabla.includes(a.motivo));
ok(sinMotivo.length === 0,
  'y cada una con el motivo que la curva declaró, no con una raya'
  + (sinMotivo.length ? ` — callados: ${sinMotivo.map(a => a.clave).join(', ')}` : ''));

// LA LEYENDA NOMBRA SÓLO LO DIBUJADO. Una ausente en la leyenda manda a buscar
// una línea que no existe, y quien no la encuentra concluye que vale cero. La
// leyenda se dibuja con `text`; la tabla de ausentes con `autoTable`, así que
// un nombre que esté en las dos partes delata el defecto.
const ausenteEnLeyenda = CURVA.ausentes.filter(a => enTexto.includes(a.nombre));
ok(ausenteEnLeyenda.length === 0,
  'y NINGUNA de ellas aparece en la leyenda de los trazos'
  + (ausenteEnLeyenda.length ? ` — colada(s): ${ausenteEnLeyenda.map(a => a.clave).join(', ')}` : ''));
const dibujadaFueraDeLeyenda = CURVA.lineas.filter(l => !enTexto.includes(l.nombre));
ok(CURVA.lineas.length > 0 && dibujadaFueraDeLeyenda.length === 0,
  `las ${CURVA.lineas.length} series dibujadas SÍ están en la leyenda`
  + (dibujadaFueraDeLeyenda.length ? ` — faltan ${dibujadaFueraDeLeyenda.map(l => l.clave).join(', ')}` : ''));

ok(textos.some(t => /Lo que esta gr.fica NO dibuja/.test(t)),
  'y el bloque lleva su rótulo escrito, no implícito en que haya una tabla más');

// Las dos secciones del mandato, con su número. No se renumeran para tapar la
// 5, que todavía no se escribe.
ok(textos.some(t => /^3\s/.test(t)), 'la gráfica única sale como sección 3');
ok(textos.some(t => /^7\s/.test(t)), 'la de la dependencia sale como sección 7');
ok(!textos.some(t => /^5\s/.test(t)),
  'y la 5 no está: el hueco se deja a la vista en vez de correr los números');

// ══════════════════════════════════════════════════════════════════════════
// E · LA FRONTERA DE LA SECCIÓN 7
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── E · la dependencia no lee la economía del contratista ────');

// (1) EN EL OBJETO. `curvaDeGobierno` no CALCULA gasto ni margen; no es que los
// esconda. Se recorre todo lo que devuelve, a cualquier profundidad.
const PROHIBIDAS = ['gasto', 'margen', 'utilidad', 'costo', 'gastoPorSem',
                    'gastoMedido', 'gastoSinFechar'];
const halladas = [];
const recorrer = (v, ruta, visto = new Set()) => {
  if (!v || typeof v !== 'object' || visto.has(v)) return;
  visto.add(v);
  for (const [k, val] of Object.entries(v)) {
    if (PROHIBIDAS.includes(k)) halladas.push(`${ruta}.${k}`);
    recorrer(val, `${ruta}.${k}`, visto);
  }
};
recorrer(CURVA_GOB, 'curvaDeGobierno');
ok(halladas.length === 0,
  'lo que alimenta la sección 7 no trae ninguna clave de la economía del '
  + 'contratista a ninguna profundidad'
  + (halladas.length ? ` — vivas: ${halladas.join(', ')}` : ''));
// Y el control positivo: la OTRA curva sí las trae, o el recorrido no busca nada.
const control = [];
const recorrer2 = (v, ruta, visto = new Set()) => {
  if (!v || typeof v !== 'object' || visto.has(v)) return;
  visto.add(v);
  for (const [k, val] of Object.entries(v)) {
    if (PROHIBIDAS.includes(k)) control.push(k);
    recorrer2(val, `${ruta}.${k}`, visto);
  }
};
recorrer2(CURVA, 'curvaUnicaDeObra');
ok(control.length > 0,
  `el mismo recorrido encuentra ${control.length} clave(s) en la curva de la `
  + 'constructora: busca de verdad');

// (2) EN LA HOJA. La cifra del gasto y la del margen no se imprimen en las
// páginas de la sección 7. Las PALABRAS sí pueden salir —el preludio dice «NO
// LLEVA GASTO NI MARGEN», y decirlo es parte de la frontera—; lo que no puede
// salir es un NÚMERO de la economía del contratista.
const pagS7 = hoja.filter(x => /^7\s/.test(x.texto)).map(x => x.pagina);
ok(pagS7.length === 1, 'la sección 7 arranca en una página identificable');
const ultima = Math.max(...hoja.map(x => x.pagina));
const paginasS7 = [];
for (let p = pagS7[0]; p <= ultima; p++) paginasS7.push(p);
const textoS7 = hoja.filter(x => paginasS7.includes(x.pagina)).map(x => x.texto);
ok(textoS7.length > 10,
  `la sección 7 dibuja ${textoS7.length} textos: no se cumple por vacío`);

const gastoTotal = CURVA.gasto.filter(v => typeof v === 'number').pop();
const margenFinal = CURVA.margen.filter(v => typeof v === 'number').pop();
const cifrasProhibidas = [MXN(gastoTotal), fmtDineroCorto(gastoTotal),
                          MXN(margenFinal), fmtDineroCorto(margenFinal)];
const coladas = cifrasProhibidas.filter(c => textoS7.some(t => t.includes(c)));
ok(Number.isFinite(gastoTotal) && Number.isFinite(margenFinal),
  `el caso tiene gasto (${fmtDineroCorto(gastoTotal)}) y margen `
  + `(${fmtDineroCorto(margenFinal)}) de verdad que esconder`);
ok(coladas.length === 0,
  'y ninguna de las dos cifras aparece en las páginas de la sección 7'
  + (coladas.length ? ` — coladas: ${coladas.join(', ')}` : ''));

// (3) LOS NOMBRES DE LAS SERIES. Mirar sólo las CIFRAS deja pasar el defecto
// gordo: una gráfica casi no imprime números —la rejilla y nada más—, así que
// alimentar la sección 7 con la curva de la constructora colaba el gasto y el
// margen enteros sin tocar una sola cifra de las de arriba. Lo delató la
// contraprueba. Lo que se compara son los nombres de las series que EXISTEN en
// una curva y no en la otra, sacados de las dos curvas y no tecleados: así el
// día que se agregue una serie a la de la constructora, ésta la cubre sola.
const nombresDe = (c) => [...(c.lineas || []), ...(c.areas || []), ...(c.ausentes || [])]
  .map(x => x.nombre).filter(Boolean);
const soloDeLaConstructora = nombresDe(CURVA)
  .filter(n => !nombresDe(CURVA_GOB).includes(n));
ok(soloDeLaConstructora.length > 0,
  `la curva de la constructora tiene ${soloDeLaConstructora.length} serie(s) que `
  + `la de la dependencia no: ${soloDeLaConstructora.join(' · ')}`);
const nombresColados = soloDeLaConstructora.filter(n => textoS7.some(t => t.includes(n)));
ok(nombresColados.length === 0,
  'y ninguna de ellas se nombra en la sección 7, ni en la leyenda ni en el pie'
  + (nombresColados.length ? ` — colada(s): ${nombresColados.join(' · ')}` : ''));

// El control positivo de lo mismo: esas cifras SÍ están en el resto del papel.
const textoAntes = hoja.filter(x => x.pagina < pagS7[0]).map(x => x.texto);
ok(cifrasProhibidas.some(c => textoAntes.some(t => t.includes(c))),
  'las mismas cifras sí se imprimen antes de la sección 7: el documento interno '
  + 'no se las calla, la frontera es de la sección y no del papel');

// Y la frontera dicha con palabras, que es lo que un lector necesita para no
// pedir «la gráfica completa» a quien no puede dársela.
ok(textoS7.some(t => /NO LLEVA GASTO NI MARGEN/.test(t)),
  'la sección declara por escrito que no lleva gasto ni margen');

// ══════════════════════════════════════════════════════════════════════════
// F · LOS COLORES SON LOS DE `tokens.css`, LEÍDOS DEL ARCHIVO
// ══════════════════════════════════════════════════════════════════════════
console.log('\n── F · la copia de la paleta contra el CSS de verdad ────────');

let css;
try { css = fs.readFileSync(CSS, 'utf8'); }
catch (e) {
  console.error(`\nNO ARRANCÓ: no se pudo leer ${CSS}: ${e.message}`);
  process.exit(2);
}
const delCSS = {};
for (const m of css.matchAll(/--c-([A-Za-z]+)-rgb:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g))
  delCSS[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
ok(Object.keys(delCSS).length >= 15,
  `se leyeron ${Object.keys(delCSS).length} ternas de tokens.css: el archivo se parseó`);

const desfasados = Object.entries(RGB_DE_TOKEN)
  .filter(([k, v]) => !delCSS[k] || !mismoColor(v, delCSS[k]))
  .map(([k, v]) => `${k}: la tabla dice [${v}] y el CSS [${delCSS[k] || 'no existe'}]`);
ok(desfasados.length === 0,
  `las ${Object.keys(RGB_DE_TOKEN).length} ternas de la tabla son las del CSS`
  + (desfasados.length ? `\n         ${desfasados.join('\n         ')}` : ''));

// Y que la tabla alcance: un token que use alguna curva y no esté aquí se
// pintaría gris, y dos series del mismo gris son indistinguibles.
const usados = [
  ...Object.values(COLOR_CURVA),
  ...CURVA.areas.flatMap(a => [a.colorPos, a.colorNeg]),
  ...CURVA_GOB.areas.flatMap(a => [a.colorPos, a.colorNeg]),
];
const sinTerna = [...new Set(usados)].filter(c => !rgbDeColorToken(c));
ok(usados.length >= 6 && sinTerna.length === 0,
  `los ${new Set(usados).size} colores que usan las dos curvas resuelven a una terna`
  + (sinTerna.length ? ` — sin terna: ${sinTerna.join(', ')}` : ''));
ok(sola.parte.sinColor.length === 0,
  'y el dibujante no tuvo que apagar ninguna serie a gris por falta de color');

// UN TOKEN QUE NO ESTÁ EN LA TABLA DEVUELVE NADA, NO UN GRIS. Es lo que hace
// que las dos comprobaciones de arriba sirvan: con un gris de respaldo nunca
// faltaría un color, dos series saldrían del mismo gris y el banco las vería
// resueltas. El respaldo lo pone quien dibuja, y lo declara en `sinColor`.
ok(rgbDeColorToken('var(--c-estoNoExiste)') === null,
  'un token que no está en la tabla devuelve nada, no un gris de respaldo');
ok(rgbDeColorToken('#FF6B35') === null && rgbDeColorToken(null) === null,
  'y lo que ni siquiera es un token tampoco se resuelve a un color');
const CURVA_RARA = { semanas: SEMS.slice(0, 3).map(s => ({ ...s })),
  lineas: [{ clave: 'x', nombre: 'Serie con un color que no existe',
             color: 'var(--c-estoNoExiste)', valores: [1, 2, 3] }],
  areas: [], ausentes: [], notas: [] };
ok(dibujarSola(CURVA_RARA).parte.sinColor.includes('x'),
  'y el dibujante lo DECLARA en su parte en vez de pintarla y callarse');

// ══════════════════════════════════════════════════════════════════════════
// G · EL SOMBREADO CAMBIA DE COLOR DONDE CAMBIA DE SIGNO
// ══════════════════════════════════════════════════════════════════════════
// Medido en producción: el margen de la 0112 y el de la 0127 CRUZAN EL CERO
// dentro de la ventana. Una banda de un solo color diría «margen» encima del
// tramo en que hubo pérdida, que es la única parte del dibujo que urge ver.
console.log('\n── G · la banda se parte donde el margen cruza el cero ──────');

const CRUZA = {
  semanas: SEMS.slice(0, 6).map(s => ({ ...s })),
  lineas: [
    { clave: 'ejec', nombre: 'Avance ejecutado', color: COLOR_CURVA.ejec,
      valores: [4000000, 6000000, 8000000, 10000000, 12000000, 14000000] },
    { clave: 'gasto', nombre: 'Gasto acumulado', color: COLOR_CURVA.gasto,
      valores: [7000000, 8000000, 9000000, 9500000, 10000000, 10500000] },
  ],
  areas: [{ clave: 'margen', nombre: 'Margen bruto acumulado, en pesos',
            arriba: 'ejec', abajo: 'gasto',
            valores: [-3000000, -2000000, -1000000, 500000, 2000000, 3500000],
            colorPos: C.greenDk, colorNeg: C.redDk }],
  ausentes: [], notas: [],
};
const cruzada = dibujarSola(CRUZA);
ok(cruzada.parte.areas.length === 1,
  `el área se dibuja: ${cruzada.parte.areas.length} banda(s)`);
// Dos tramos y de signo distinto. No se compara contra la cadena «−+»: el
// glifo del signo es cosa del parte, y lo que esta prueba afirma es que la
// banda se PARTIÓ, no cómo se escribe un menos.
const signos = cruzada.parte.areas[0]?.signos || '';
ok(signos.length === 2 && signos[0] !== signos[1],
  `y se parte en dos tramos de signo contrario donde el margen cruza el cero: «${signos}»`);

const poligonos = cruzada.trazos.filter(t => t.tipo === 'lines');
const verde = rgbDeColorToken(C.greenDk), rojo = rgbDeColorToken(C.redDk);
ok(poligonos.length === 2, `se pintan ${poligonos.length} polígonos, uno por signo`);
// EL ORDEN IMPORTA. En este caso la pérdida va PRIMERO —el margen arranca en
// −$3M y cruza a positivo—, así que el rojo tiene que ser el polígono de la
// izquierda. Pedir sólo «hay uno de cada color» dejaría pasar los dos al revés,
// que es pintar de verde justo el tramo en que se perdió dinero.
ok(mismoColor(poligonos[0]?.relleno, rojo) && mismoColor(poligonos[1]?.relleno, verde),
  'el rojo es el tramo que empieza en pérdida y el verde el que cruza a favor, '
  + 'en ese orden: no una banda de un solo color ni los dos colores al revés');
ok(poligonos.length === 2 && poligonos.every(p => p.opacidad > 0 && p.opacidad < 1),
  `y los dos traslúcidos (opacidad ${poligonos[0]?.opacidad}): la banda no tapa las curvas`);

// Y el control de que el signo se lee del dato y no del orden: una curva sin
// cruce sale de una sola pieza.
const SIN_CRUCE = { ...CRUZA, areas: [{ ...CRUZA.areas[0],
  valores: [1000000, 2000000, 3000000, 4000000, 5000000, 6000000] }] };
const entera = dibujarSola(SIN_CRUCE);
ok(entera.parte.areas[0] && entera.parte.areas[0].signos === '+',
  `sin cruce la banda no se parte: «${entera.parte.areas[0]?.signos}»`);

// ══════════════════════════════════════════════════════════════════════════
// H · UNA GRÁFICA SIN DATO NO DIBUJA UNA REJILLA EN CEROS
// ══════════════════════════════════════════════════════════════════════════
// Es la mentira más barata de todas: el eje con sus cifras y ninguna curva
// encima se lee como una obra que no ha hecho nada, cuando lo que pasa es que
// nadie capturó. Hay semanas —la ventana existe— y no hay series.
console.log('\n── H · sin dato no se dibuja el eje ────────────────────────');

const VACIA = {
  semanas: SEMS.map(s => ({ ...s })), lineas: [], areas: [],
  ausentes: [{ clave: 'ejec', nombre: 'Avance ejecutado',
               motivo: 'esta obra todavía no tiene ningún corte de avance capturado' }],
  notas: [],
};
const nada = dibujarSola(VACIA);
ok(VACIA.semanas.length > 0,
  `el caso trae ${VACIA.semanas.length} semanas y ninguna serie: es la forma de `
  + 'una obra recién dada de alta, no un arreglo vacío');
ok(nada.parte.vacia === true, 'el dibujante declara la gráfica vacía');
ok(nada.trazos.length === 0,
  `y no traza ni un segmento: ${nada.trazos.length} trazo(s)`);
ok(nada.dibujos.length === 0,
  `ni imprime una sola cifra de rejilla: ${nada.dibujos.length} texto(s). Un eje `
  + 'rotulado y sin curvas encima se lee como una obra en ceros');

// Y EL DOCUMENTO LO DICE CON PALABRAS. Un hueco donde iba la gráfica tampoco
// sirve: el lector no sabe si falta el dato o falta la sección. Se mueve el
// generador entero sobre una obra recién dada de alta —sin cortes, sin GP—,
// que es la que produce esta forma en producción.
const OBRA_NUEVA = { ...OBRA, id: '0199', gpId: '0199' };
let hojaVacia;
try {
  hojaVacia = await dibujarPDFInterno(generarPDFInterno, {
    ...DATOS, obra: OBRA_NUEVA, historialAvance: [], gpData: null, subs: [] });
} catch (e) {
  console.error(`\nNO ARRANCÓ: el documento de la obra nueva no se pudo dibujar: ${e.message}`);
  process.exit(2);
}
if (hojaVacia.reventones.length) {
  console.error(`\nNO ARRANCÓ: el generador reventó: ${hojaVacia.reventones.join(' | ')}`);
  process.exit(2);
}
const curvaNueva = curvaUnicaDeObra({ semanas: SEMS, obra: OBRA_NUEVA,
  historialAvance: [], subs: [], gpData: null, otrosGastos: [], maquinaria: [],
  programa: null });
ok(curvaNueva.lineas.length === 0,
  'la obra recién dada de alta no produce ninguna serie, que es lo que esta sección necesita');
const txtVacia = hojaVacia.map(x => x.texto);
ok(txtVacia.some(t => /se lee como una obra en ceros/.test(t)),
  'y el papel escribe por qué no hay dibujo, en vez de dejar el hueco');
const sinNombrarNueva = curvaNueva.ausentes.filter(a => !txtVacia.includes(a.motivo));
ok(curvaNueva.ausentes.length > 0 && sinNombrarNueva.length === 0,
  `y las ${curvaNueva.ausentes.length} series que faltan salen con su motivo igual`
  + (sinNombrarNueva.length ? ` — callados: ${sinNombrarNueva.map(a => a.clave).join(', ')}` : ''));

// ══════════════════════════════════════════════════════════════════════════
// I · LO QUE EL PAPEL EXPLICA, CABE EN EL PAPEL
// ══════════════════════════════════════════════════════════════════════════
// Las dos secciones nuevas no se entienden sin su preludio: el párrafo que dice
// por qué el eje arranca en cero, qué es el sombreado y qué significa un trecho
// punteado. Un párrafo que se sale de la hoja por la derecha no es un defecto
// de maquetación —el final de cada renglón queda FUERA DEL PAPEL y no se lee—,
// y lo que se pierde ahí es justo la instrucción de cómo leer la gráfica.
//
// Pasó de verdad: el ayudante `T` hacía `String(s)` sobre el arreglo que
// devuelve `splitTextToSize`, y `String(['uno','dos'])` es `'uno,dos'`: los
// renglones salían pegados con comas en una sola línea tres veces más ancha que
// la hoja. Ningún banco lo vio porque el lienzo de mentira tampoco partía nada.
console.log('\n── I · lo que el papel explica, cabe en el papel ────────────');

// El ancho de la hoja se le pregunta al MISMO lienzo sobre el que dibujó el
// generador, en vez de teclear 279: dos sitios con la medida del papel acaban
// midiendo dos papeles distintos.
const ANCHO_HOJA = lienzo().doc.internal.pageSize.getWidth();
ok(ANCHO_HOJA > 100, `la hoja mide ${ANCHO_HOJA} mm de ancho`);

// EL CONTROL, PRIMERO. Si ningún párrafo del documento se parte en dos
// renglones, entonces nada de lo de abajo afirma nada: un documento de puras
// frases cortas cabe siempre. `textoCorrido` pega los renglones que se ven como
// un párrafo; los que no estaban ya enteros en el crudo son los que se
// partieron de verdad.
const corrido = textoCorrido(hoja);
const partidos = corrido.filter(c => !hoja.some(d => d.texto === c.texto));
ok(partidos.length > 0,
  `${partidos.length} párrafo(s) del documento se reparten en varios renglones: `
  + 'hay algo que de verdad hubo que partir');

// Y QUE EL PARTIDO MÁS LARGO SEA UNO DE LOS PRELUDIOS. Si lo único que se parte
// fuera un pie de página, esta sección estaría midiendo otra cosa.
const pags = hoja.filter(x => /^3\s/.test(x.texto) || /^7\s/.test(x.texto))
  .map(x => x.pagina);
const partidosEnLasCurvas = partidos.filter(p => pags.includes(p.pagina));
ok(partidosEnLasCurvas.length > 0,
  `y ${partidosEnLasCurvas.length} de ellos están en las páginas de las dos `
  + `gráficas (${pags.join(' y ')}), que es donde vive la explicación`);

// LA AFIRMACIÓN. Ningún renglón alineado a la izquierda termina fuera de la
// hoja. Se miden los renglones CRUDOS —lo que se manda dibujar— y no los
// pegados, porque lo que acaba en el papel es cada renglón por su lado. Los
// alineados a la derecha o al centro se excluyen: su `x` no es el borde
// izquierdo del texto, así que sumarle el ancho no significa nada.
const renglones = hoja.filter(x => x.tabla === undefined && x.x !== undefined
  && (!x.align || x.align === 'left'));
ok(renglones.length > 20,
  `hay ${renglones.length} renglones sueltos que medir: no se cumple por vacío`);
const fuera = renglones.filter(x => x.x + x.ancho > ANCHO_HOJA);
ok(fuera.length === 0,
  'ninguno termina fuera de la hoja'
  + (fuera.length ? ` — se salen ${fuera.length}, el peor por `
      + `${Math.round(Math.max(...fuera.map(x => x.x + x.ancho - ANCHO_HOJA)))} mm: `
      + `«${fuera[0].texto.slice(0, 60)}…»` : ''));

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${verdes} en verde · ${fallas} en rojo.`);
if (fallas) {
  console.log('Las dos gráficas afirman algo que nadie midió.');
  process.exit(1);
}
console.log('Las dos gráficas dibujan lo medido y confiesan lo que no.');

// ══════════════════════════════════════════════════════════════════════════
// LA CONTRAPRUEBA
// ══════════════════════════════════════════════════════════════════════════
// Cada mutación rompe la SEMÁNTICA de una afirmación —el eje, el punteado, la
// marca, la confesión, la frontera, el color—, nunca el andamiaje. Si una no
// pone nada en rojo, la aserción que debía cubrirla no afirma lo que dice.
if (process.argv.includes('--contraprueba')) {
  console.log('\n══ CONTRAPRUEBA ══════════════════════════════════════════');
  const src = fs.readFileSync(ARCHIVO, 'utf8');
  const MUTANTES = [
    // ── A · el eje ─────────────────────────────────────────────────────────
    { nombre: 'el eje se corta por abajo en el mínimo de la serie',
      hacer: () => src.replace(
        '  const piso = Math.min(...vals, 0);',
        '  const piso = Math.min(...vals);') },
    { nombre: 'el techo deja de alcanzar el máximo de la serie',
      hacer: () => src.replace(
        '  const crudoMax = Math.max(...vals, 0);',
        '  const crudoMax = Math.max(...vals, 0) * 0.8;') },

    // ── B · el punteado ────────────────────────────────────────────────────
    { nombre: 'el salto sobre semanas sin captura se traza sólido',
      hacer: () => src.replace(
        "        doc.setLineDashPattern((interpolado || esPunteada) ? [1.4, 1.1] : [], 0);",
        '        doc.setLineDashPattern([], 0);') },
    { nombre: 'todo se traza punteado y el punteado deja de distinguir nada',
      hacer: () => src.replace(
        "        doc.setLineDashPattern((interpolado || esPunteada) ? [1.4, 1.1] : [], 0);",
        '        doc.setLineDashPattern([1.4, 1.1], 0);') },

    // ── C · el punto suelto ────────────────────────────────────────────────
    { nombre: 'el punto que ningún trecho cubre deja de marcarse',
      hacer: () => src.replace(
        '    const sueltos = puntosSinTramo({ pts, medido: l.medido, idxFrontera: iF });',
        '    const sueltos = [];') },
    { nombre: 'la marca del punto suelto sale gris en vez del color de su serie',
      hacer: () => src.replace(
        "      sf(color); doc.circle(s.p[0], s.p[1], 0.9, 'F');",
        "      sf(gris); doc.circle(s.p[0], s.p[1], 0.9, 'F');") },
    { nombre: 'el parte deja de delatar la serie que no trazó línea',
      hacer: () => src.replace(
        '    if (tramos.length === 0 && sueltos.length > 0)',
        '    if (false)') },
    { nombre: 'un punto no medido se cuenta como punto suelto y la marca contradice a la línea',
      hacer: () => src.replace(
        "  const conDato = (i) => !!pts[i] && (!medido || medido[i] !== false);",
        '  const conDato = (i) => !!pts[i];') },

    // ── D · la confesión ───────────────────────────────────────────────────
    { nombre: 'la tabla de lo que la gráfica no dibuja desaparece',
      hacer: () => src.replace(
        '    if (aus.length) {\n      if (yy > 168)',
        '    if (false) {\n      if (yy > 168)') },
    { nombre: 'las ausentes se nombran sin decir por qué faltan',
      hacer: () => src.replace(
        "        aus.map(a => [a.nombre || a.clave, a.motivo || 'sin motivo declarado']),",
        "        aus.map(a => [a.nombre || a.clave, '—']),") },
    { nombre: 'la leyenda nombra también las series que no están en el dibujo',
      hacer: () => src.replace(
        "        ...(curva.lineas || []).map(l => ({ tipo:'linea', nombre:l.nombre,",
        "        ...(curva.ausentes || []).map(l => ({ tipo:'linea', nombre:l.nombre,\n"
        + "          col: Q.mu, punteada: true })),\n"
        + "        ...(curva.lineas || []).map(l => ({ tipo:'linea', nombre:l.nombre,") },
    { nombre: 'la leyenda deja de dibujarse y las series quedan sin nombre',
      hacer: () => src.replace(
        "        T(t.nombre || '', cx+9, cy);",
        '        T(\'\', cx+9, cy);') },
    { nombre: 'los números de sección se corren para tapar el hueco de la 5',
      hacer: () => src.replace(
        "  y = bloqueDeCurva('7  LA MISMA OBRA, COMO LA VE LA DEPENDENCIA', curvaGob,",
        "  y = bloqueDeCurva('5  LA MISMA OBRA, COMO LA VE LA DEPENDENCIA', curvaGob,") },

    // ── E · la frontera ────────────────────────────────────────────────────
    { nombre: 'la sección 7 se alimenta de la curva de la constructora',
      hacer: () => src.replace(
        "  y = bloqueDeCurva('7  LA MISMA OBRA, COMO LA VE LA DEPENDENCIA', curvaGob,",
        "  y = bloqueDeCurva('7  LA MISMA OBRA, COMO LA VE LA DEPENDENCIA', curva,") },
    // La curva de la dependencia empieza a DEVOLVER el gasto del contratista.
    // Es el defecto que no se ve en la hoja: el dato viaja en el objeto, a una
    // línea de que alguien lo dibuje. Por eso la §E mira las dos cosas.
    { nombre: 'la curva de la dependencia empieza a devolver el gasto del contratista',
      hacer: () => src.replace(
        '  return {\n    semanas, lineas, areas, ausentes, notas,\n'
        + '    avance, programadoPct, programado, ejecutado, pagado, porPagar,',
        '  return {\n    semanas, lineas, areas, ausentes, notas,\n'
        + '    gasto: ejecutado.map(v => (typeof v === \'number\' ? v * 0.8 : null)),\n'
        + '    avance, programadoPct, programado, ejecutado, pagado, porPagar,') },
    { nombre: 'la sección 7 deja de declarar que no lleva gasto ni margen',
      hacer: () => src.replace(
        "    + 'ver: lo construido, lo programado y lo pagado al contratista. NO LLEVA '\n"
        + "    + 'GASTO NI MARGEN, y no es un recorte de presentación: la economía del '",
        "    + 'ver: lo construido, lo programado y lo pagado al contratista. '\n"
        + "    + 'No es un recorte de presentación: la economía del '") },

    // ── F · los colores ────────────────────────────────────────────────────
    { nombre: 'una terna de la tabla se desincroniza del CSS',
      hacer: () => src.replace(
        '  blue:    [55, 138, 221],  blueDk:  [24, 95, 165],',
        '  blue:    [55, 138, 221],  blueDk:  [24, 95, 166],') },
    { nombre: 'un token que usan las curvas desaparece de la tabla',
      hacer: () => src.replace(
        '  green:   [99, 153, 34],   greenDk: [59, 109, 17],',
        '  green:   [99, 153, 34],') },
    { nombre: 'el color del token se resuelve a un gris de respaldo en vez de a null',
      hacer: () => src.replace(
        '  return (m && RGB_DE_TOKEN[m[1]]) ? RGB_DE_TOKEN[m[1]] : null;',
        '  return (m && RGB_DE_TOKEN[m[1]]) ? RGB_DE_TOKEN[m[1]] : [148, 155, 164];') },

    // ── G · el sombreado ───────────────────────────────────────────────────
    { nombre: 'la banda se pinta de un solo color y el tramo de pérdida se disfraza',
      hacer: () => src.replace(
        '      sf(t.signo ? cPos : cNeg);',
        '      sf(cPos);') },
    { nombre: 'la banda se pinta opaca y tapa las curvas que sombrea',
      hacer: () => src.replace(
        "      if (doc.setGState && doc.GState) doc.setGState(new doc.GState({ opacity: 0.13 }));",
        '      ;') },
    { nombre: 'el área deja de partirse por signo y sale de una sola pieza',
      hacer: () => src.replace(
        '    const porSigno = tramosDeSigno(difs, xs);',
        '    const porSigno = [{ signo: true, desde: xs[0], hasta: xs[xs.length - 1] }];') },

    // ── el lienzo vacío ────────────────────────────────────────────────────
    { nombre: 'una gráfica sin dato dibuja la rejilla en ceros en vez de declararse',
      hacer: () => src.replace(
        '  if (!semanas.length || !vals.length) {\n    parte.vacia = true;',
        '  if (!semanas.length) {\n    parte.vacia = true;') },

    // ── I · lo escrito cabe en la hoja ─────────────────────────────────────
    // El defecto tal como estaba: `String(arreglo)` pega los renglones con
    // comas y los dibuja de corrido, fuera del papel.
    { nombre: 'los renglones de un párrafo se dibujan pegados en una sola línea',
      hacer: () => src.replace(
        "  const T  = (s,x,y,o={}) => doc.text(\n"
        + "    Array.isArray(s) ? s.map(v => String(v ?? '')) : String(s||''), x, y, o);\n"
        + '\n  // El sello de INTERNO',
        "  const T  = (s,x,y,o={}) => doc.text(String(s||''),x,y,o);"
        + '\n\n  // El sello de INTERNO') },
    { nombre: 'el preludio se parte al ancho de la hoja y no al de la caja',
      hacer: () => src.replace(
        '      const ls = doc.splitTextToSize(String(preludio), CW);',
        '      const ls = doc.splitTextToSize(String(preludio), PW);') },
  ];

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dos-curvas-'));
  let n = 0;
  for (const m of MUTANTES) {
    const mutado = m.hacer();
    if (mutado === src) {
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» no cambió nada.`);
      process.exit(2);
    }
    const f2 = path.join(dir, `app-${n}.jsx`);
    fs.writeFileSync(f2, mutado);
    // El CSS vive al lado del `.jsx`, y la §F lo lee de ahí. Sin copiarlo, esa
    // sección daría NO ARRANCÓ en cada mutación y la contraprueba no mediría.
    const dirCss = path.join(dir, 'styles');
    if (!fs.existsSync(dirCss)) {
      fs.mkdirSync(dirCss);
      fs.copyFileSync(CSS, path.join(dirCss, 'tokens.css'));
    }
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
