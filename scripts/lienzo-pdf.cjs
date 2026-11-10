// Un jsPDF de mentira para mover el generador de verdad.
//
// `generarPDFObra` llama decenas de métodos de jsPDF y lo único que a un banco
// le interesa es QUÉ TEXTO manda dibujar, EN QUÉ PÁGINA y EN QUÉ POSICIÓN. Un
// `Proxy` contesta a cualquier método que no esté previsto —así un método nuevo
// no tumba el banco— y anota los `text()`. Los que sí están previstos son los
// que devuelven algo de lo que el generador depende para seguir: si uno de ésos
// contestara `undefined`, el PDF reventaría a media página y el banco diría «no
// dice tal cosa» cuando lo que pasó es que no llegó.
//
// Vive aparte porque lo usan dos bancos (#43 y la dirección del producto). Dos
// copias de un doble se desincronizan, y entonces cada banco mide un generador
// distinto del que mide el otro.

'use strict';

// Anota lo que el generador manda a la hoja: los `text()` Y las celdas de
// `autoTable`. Anota PÁGINA y POSICIÓN, no sólo el texto. Tirar las posiciones hace que un
// banco afirme más de lo que comprueba: el pie de la portada y el marco de cada
// página dibujan cosas parecidas en el mismo renglón, así que un `includes` se
// cumple con el marco aunque la portada esté mal. La portada es la página 1
// —`pageFrame` corre sólo después de cada `addPage`—.
function lienzo() {
  const dibujos = [];
  // LOS TRAZOS, aparte del texto. Una gráfica no dibuja ni una letra en el
  // cuerpo del dibujo: son líneas, polígonos y círculos. Mientras el Proxy se
  // los tragaba como a cualquier método imprevisto, un banco de curvas sólo
  // podía afirmar de ellas lo que dijeran sus rótulos —o sea, nada de lo que
  // importa: si el trecho salió punteado, de qué color, y si el punto suelto
  // de una serie sin línea se marcó—.
  const trazos = [];
  let pagina = 1;
  let tablas = 0;
  let parrafos = 0;
  // EL ESTADO DE LA PLUMA. jsPDF es una máquina de estado: el color y el guión
  // se fijan con una llamada y valen para las siguientes. Un trazo anotado sin
  // su pluma no dice de qué color salió, y «de qué color» es justo lo que
  // distingue una serie de otra en una gráfica de cuatro.
  const pluma = { trazo: null, relleno: null, ancho: null, guion: [], opacidad: 1 };
  const conPluma = (o) => ({ ...o, pagina,
    trazo: pluma.trazo && [...pluma.trazo], relleno: pluma.relleno && [...pluma.relleno],
    ancho: pluma.ancho, guion: [...pluma.guion], opacidad: pluma.opacidad,
    punteado: pluma.guion.length > 0 });

  // EL ANCHO DEL TEXTO, MODELADO. No es el de jsPDF —que mide glifo por glifo
  // contra la métrica de la fuente— y no pretende serlo: es un ancho medio
  // declarado, en milímetros, con el tamaño de letra vigente. Hace falta porque
  // sin él `splitTextToSize` no podía partir nada y devolvía el párrafo entero
  // en un arreglo de UN elemento. Con eso, un generador que pega los renglones
  // de vuelta en una sola línea —`String(arreglo)` los une con comas— se veía
  // idéntico a uno correcto: el doble no podía distinguirlos, y el párrafo que
  // en el PDF de verdad se salía de la hoja por la derecha pasaba en verde.
  //
  // 0.5 em por carácter es el promedio de la Helvetica; 2.8346 es puntos por
  // milímetro. Un banco que mida AQUÍ está midiendo este modelo, así que lo que
  // puede afirmar es «cabe con holgura» o «se sale por el triple», no el
  // milímetro exacto. Eso basta para la clase de defecto que importa.
  const fuente = { tam: 16 };
  const PT_POR_MM = 72 / 25.4;
  const anchoDe = (t) => String(t).length * 0.5 * fuente.tam / PT_POR_MM;
  // LO QUE SE PARTIÓ Y SE VOLVIÓ A PEGAR. Cuando un párrafo sale en varios
  // renglones, se apunta aquí la forma que tendría si alguien lo aplastara de
  // vuelta a UNA cadena con la coerción por omisión de JavaScript —que es lo
  // que hacen `String(arreglo)` y `` `${arreglo}` ``, y lo que hacía el
  // ayudante `T` de los dos generadores—. Si un `text()` dibuja exactamente esa
  // forma, el generador está mandando a la hoja, de un tirón, algo que él mismo
  // pidió partir: los renglones salen pegados con comas en una línea varias
  // veces más ancha que la caja. No es una firma del defecto por casualidad; es
  // su definición dicha al revés.
  const pegados = new Map();   // la cadena aplastada → cuántos renglones eran
  const partir = (t, maxlen) => {
    const s = String(t);
    if (!(maxlen > 0)) return [s];
    const fuera = [];
    for (const parrafo of s.split('\n')) {
      let linea = '';
      for (const palabra of parrafo.split(' ')) {
        const cand = linea ? linea + ' ' + palabra : palabra;
        if (linea && anchoDe(cand) > maxlen) { fuera.push(linea); linea = palabra; }
        else linea = cand;
      }
      fuera.push(linea);
    }
    if (fuera.length > 1) pegados.set(String(fuera), fuera.length);
    return fuera;
  };
  const base = {
    internal: {
      pageSize: { getWidth: () => 279, getHeight: () => 216, width: 279, height: 216 },
      getNumberOfPages: () => 1,
      pages: [1],
    },
    splitTextToSize: (t, maxlen) => (Array.isArray(t)
      ? t.flatMap(v => partir(v, maxlen)) : partir(t, maxlen)),
    getTextWidth: (t) => anchoDe(t),
    getNumberOfPages: () => 1,
    output: () => 'blob',
    save: () => {},
    addImage: () => {},
    lastAutoTable: { finalY: 50 },
    // `GState` es un CONSTRUCTOR en jsPDF, y el generador lo usa con `new` para
    // sombrear las áreas con transparencia. El Proxy contestaba una función
    // cualquiera y `new` reventaba el generador entero —que lo atrapa y avisa
    // por `alert`, así que el documento salía corto y mudo—. Un doble que hace
    // fallar lo que el original soporta no mide al original: inventa un defecto.
    GState: function GState(o) { Object.assign(this, o || {}); },
  };
  const doc = new Proxy(base, {
    get(o, k) {
      // LO QUE EL GENERADOR HAYA INSTALADO ENCIMA, PRIMERO. `blindarTextoDelPDF`
      // envuelve `text`, `autoTable` y `splitTextToSize` del `doc` para que
      // ningún carácter que las fuentes del PDF no sepan escribir llegue a la
      // hoja. Si este trap contestara su propia versión antes de mirar lo
      // asignado, el banco anotaría la cadena ORIGINAL y mediría un documento
      // que no es el que se imprime: justo la clase de error que el blindaje
      // viene a tapar. `addPage`, `setPage` y `autoTable` no están en `base`,
      // así que mientras nadie los asigne esto no cambia nada.
      if (k in o) return o[k];
      if (k === 'addPage') return () => { pagina += 1; };
      if (k === 'setPage') return (i) => { pagina = Number(i) || pagina; };
      // Las TABLAS también son texto que el generador manda dibujar, y hasta
      // hoy el Proxy se las tragaba como a cualquier método imprevisto. Eso
      // dejaba ciega a la tabla principal de estimaciones del expediente —la
      // que lleva el consecutivo y el monto de cada una, o sea justo donde un
      // rótulo inventado se imprime y se firma—. Se anotan en `dibujos` y no
      // en una lista aparte porque son lo mismo: lo que acaba en la hoja. Van
      // sin `x`/`y` porque autoTable las coloca él.
      //
      // `tabla` es el NÚMERO de tabla del documento, contando desde 1, y
      // `celda` la columna. Las dos hacen falta: el expediente lleva una docena
      // de tablas y varias tienen una columna de montos, así que un banco que
      // sólo supiera «esto vino de una tabla» sumaría la columna de una tabla
      // con la de otra y compararía ese revoltijo contra un TOTAL que no es el
      // suyo. Con el número, un banco pide la tabla donde está lo que afirma.
      if (k === 'autoTable') return (opts = {}) => {
        tablas += 1;
        const filas = [...(opts.head || []), ...(opts.body || [])];
        for (const fila of filas) {
          for (const [celda, c] of (Array.isArray(fila) ? fila : [fila]).entries()) {
            const t = c && typeof c === 'object' && 'content' in c ? c.content : c;
            if (t === null || t === undefined) continue;
            dibujos.push({ texto: String(t), pagina, tabla: tablas, celda });
          }
        }
        base.lastAutoTable = { finalY: 50 };
        return undefined;
      };
      return (...args) => {
        if (k === 'text') {
          const [v, x, y, opts] = args;
          // `ancho` y `tam` viajan con cada renglón: sin ellos un banco que
          // quiera saber si el texto cabe en la caja tendría que remodelar el
          // ancho por su cuenta, y dos modelos del mismo ancho discrepan.
          //
          // `parrafo` es el número de LLAMADA a `text`. Un párrafo partido en
          // tres renglones llega aquí como tres entradas, y una frase que cruza
          // el corte no se encuentra con `includes` en ninguna de las tres: no
          // porque el papel no la diga, sino porque la dice en dos renglones.
          // Con este número, `textoCorrido` vuelve a pegar exactamente los
          // renglones que salieron de UNA llamada —y sólo ésos, para que una
          // frase no se arme juntando el pie de una caja con el título de la
          // siguiente—.
          parrafos += 1;
          for (const t of (Array.isArray(v) ? v : [v]))
            dibujos.push({ texto: String(t), x, y, pagina, align: opts && opts.align,
              tam: fuente.tam, ancho: anchoDe(t), parrafo: parrafos,
              pegado: pegados.get(String(t)) || 0 });
        }
        else if (k === 'setFontSize') fuente.tam = Number(args[0]) || fuente.tam;
        // El estado de la pluma, antes de los trazos: un `setDrawColor` que se
        // anotara después del `line` que lo usa pintaría cada trazo del color
        // del siguiente.
        else if (k === 'setDrawColor') pluma.trazo = args.slice();
        else if (k === 'setFillColor') pluma.relleno = args.slice();
        else if (k === 'setLineWidth') pluma.ancho = args[0];
        else if (k === 'setLineDashPattern') pluma.guion = Array.isArray(args[0]) ? args[0].slice() : [];
        else if (k === 'setGState') pluma.opacidad =
          (args[0] && args[0].opacity !== undefined) ? args[0].opacity : 1;
        else if (k === 'line')
          trazos.push(conPluma({ tipo:'line', x1:args[0], y1:args[1], x2:args[2], y2:args[3] }));
        else if (k === 'lines')
          trazos.push(conPluma({ tipo:'lines', x:args[1], y:args[2],
            vertices: Array.isArray(args[0]) ? args[0].length : 0, estilo: args[4] }));
        else if (k === 'circle')
          trazos.push(conPluma({ tipo:'circle', x:args[0], y:args[1], r:args[2], estilo:args[3] }));
        else if (k === 'rect')
          trazos.push(conPluma({ tipo:'rect', x:args[0], y:args[1], w:args[2], h:args[3], estilo:args[4] }));
        return undefined;
      };
    },
  });
  return { doc, dibujos, trazos };
}

// Mueve el PDF de verdad y devuelve lo dibujado. El `window` y el `document` se
// montan con jsPDF ya cargado para que el generador no intente bajarlo de un
// CDN: sin eso el banco pediría red, y un banco que pide red da rojo el día que
// no hay.
//
// `datos` son los argumentos que algún banco necesita de verdad; el resto van
// vacíos. Se pasan POR NOMBRE y no como una lista posicional más larga porque
// `generarPDFObra` ya lleva quince parámetros y contar comas hasta el
// decimoquinto es la clase de error que no se ve en la revisión: el banco de la
// cobertura necesita el 2, el 13, el 14 y el 15, y los tres últimos son
// `evidencia`, `programa` y `evidenciaCargada`, que es precisamente el que
// distingue «no hay fotos» de «no se pudieron leer».
// El `window` con jsPDF ya cargado, montado y desmontado alrededor de UNA
// corrida del generador. Está aparte porque lo necesitan los dos generadores
// —el reporte ejecutivo y el documento interno— y una segunda copia del montaje
// es una segunda copia de la parte que importa: `alert` silenciado y `window`
// devuelto como estaba. Un banco que se deja el `window` puesto envenena a los
// que corren después en el mismo proceso.
// LO QUE EL GENERADOR GRITÓ NO SE TIRA. Los dos generadores envuelven todo su
// cuerpo en un `try/catch` que avisa por `alert` y se traga la excepción: el
// PDF sale corto y nada en la hoja dice que reventó. Con el `alert` silenciado
// —como estaba—, un banco de veinte comprobaciones daba diecisiete en rojo por
// «el papel no dice tal cosa» cuando lo que pasó fue que el generador murió en
// la página tres. Es el mismo error de clase que una prueba que no arranca
// contada como roja: el diagnóstico apunta al sitio equivocado.
//
// Se devuelven en `dibujos.reventones`, y los trazos en `dibujos.trazos`, como
// propiedades no enumerables: los bancos que ya existen recorren el arreglo y
// no tienen por qué enterarse.
async function conJsPDFFalso(correr) {
  const { doc, dibujos, trazos } = lienzo();
  const reventones = [];
  const guardados = { window: global.window, document: global.document, alert: global.alert };
  global.window = { jspdf: { jsPDF: function () { return doc; } }, _atLoaded: true };
  global.document = { createElement: () => ({}), head: { appendChild: () => {} } };
  global.alert = (m) => { reventones.push(String(m)); };
  try {
    await correr();
  } finally {
    global.window = guardados.window;
    global.document = guardados.document;
    global.alert = guardados.alert;
  }
  Object.defineProperty(dibujos, 'trazos', { value: trazos, enumerable: false });
  Object.defineProperty(dibujos, 'reventones', { value: reventones, enumerable: false });
  return dibujos;
}

async function dibujarPDF(generarPDFObra, branding, obra, datos = {}) {
  const {
    subs = [], estimaciones = [], maquinaria = [], materiales = [],
    subcontratos = [], historialAvance = [], gpData = null, otrosGastos = [],
    gpDetalle = null, nominaHistorial = [], evidencia = [], programa = null,
    evidenciaCargada = true, instante = null,
  } = datos;
  return conJsPDFFalso(() => generarPDFObra(obra, subs, estimaciones, maquinaria,
    materiales, subcontratos, branding, historialAvance, gpData, otrosGastos,
    gpDetalle, nominaHistorial, evidencia, programa, evidenciaCargada, instante));
}

// El documento interno. Recibe UN objeto y se le pasa tal cual: `generarPDFInterno`
// toma sus parámetros por nombre, así que aquí no hay orden que respetar ni
// comas que contar — y un campo nuevo del generador no obliga a tocar esto.
async function dibujarPDFInterno(generarPDFInterno, datos = {}) {
  return conJsPDFFalso(() => generarPDFInterno(datos));
}

// LOS PÁRRAFOS, VUELTOS A PEGAR. Un banco que busca una frase con `includes`
// sobre `dibujos` sólo la encuentra si cabía entera en un renglón, y eso
// depende del ancho de la caja: la misma frase, en una caja más angosta, deja
// de encontrarse aunque el papel la siga diciendo. Lo que se pega aquí son los
// renglones de UNA llamada a `text` —ni más ni menos—, así que una frase
// «hallada» es una frase que el generador mandó dibujar de corrido. Las celdas
// de tabla no llevan `parrafo` y salen tal cual, cada una por su lado.
// Dos renglones son el mismo párrafo si se ven como tal en la hoja: misma
// página, mismo margen izquierdo, misma letra, y uno debajo del otro a un paso
// de renglón. La regla es geométrica y no «salieron de la misma llamada»
// porque las dos formas existen en el generador —`T(arreglo, x, y)` dibuja el
// bloque de una vez, y la banda de cobertura hace un `T` por renglón dentro de
// un `forEach`— y un banco no tiene por qué saber cuál de las dos usó la
// sección que está midiendo. El tope de 6 mm es lo que separa dos renglones de
// un párrafo; lo que separa dos bloques distintos es bastante más.
const MISMO_PARRAFO_MM = 6;
function textoCorrido(dibujos) {
  const fuera = [];
  let ult = null;
  for (const d of dibujos) {
    const encadena = ult && d.pagina === ult.pagina && d.x !== undefined
      && Math.abs(d.x - ult.x) < 0.01 && d.tam === ult.tam
      && ((d.parrafo !== undefined && d.parrafo === ult.parrafo && d.y === ult.y)
          || (d.y - ult.yUlt > 0 && d.y - ult.yUlt <= MISMO_PARRAFO_MM));
    if (encadena) { ult.texto += ' ' + d.texto; ult.yUlt = d.y; continue; }
    ult = { ...d, yUlt: d.y };
    fuera.push(ult);
  }
  return fuera.map(({ yUlt, ...d }) => d);
}

// ¿Lo dice el papel? Busca la frase en los párrafos pegados y en las celdas.
const papelDice = (dibujos, frase) =>
  textoCorrido(dibujos).some(d => d.texto.includes(frase));

module.exports = { lienzo, dibujarPDF, dibujarPDFInterno, conJsPDFFalso,
                   textoCorrido, papelDice };
