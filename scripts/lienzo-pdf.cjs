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
  let pagina = 1;
  let tablas = 0;
  const base = {
    internal: {
      pageSize: { getWidth: () => 279, getHeight: () => 216, width: 279, height: 216 },
      getNumberOfPages: () => 1,
      pages: [1],
    },
    splitTextToSize: (t) => (Array.isArray(t) ? t.map(String) : [String(t)]),
    getTextWidth: () => 10,
    getNumberOfPages: () => 1,
    output: () => 'blob',
    save: () => {},
    addImage: () => {},
    lastAutoTable: { finalY: 50 },
  };
  const doc = new Proxy(base, {
    get(o, k) {
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
      if (k in o) return o[k];
      return (...args) => {
        if (k === 'text') {
          const [v, x, y, opts] = args;
          for (const t of (Array.isArray(v) ? v : [v]))
            dibujos.push({ texto: String(t), x, y, pagina, align: opts && opts.align });
        }
        return undefined;
      };
    },
  });
  return { doc, dibujos };
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
async function dibujarPDF(generarPDFObra, branding, obra, datos = {}) {
  const {
    subs = [], estimaciones = [], maquinaria = [], materiales = [],
    subcontratos = [], historialAvance = [], gpData = null, otrosGastos = [],
    gpDetalle = null, nominaHistorial = [], evidencia = [], programa = null,
    evidenciaCargada = true, instante = null,
  } = datos;
  const { doc, dibujos } = lienzo();
  const guardados = { window: global.window, document: global.document, alert: global.alert };
  global.window = { jspdf: { jsPDF: function () { return doc; } }, _atLoaded: true };
  global.document = { createElement: () => ({}), head: { appendChild: () => {} } };
  global.alert = () => {};
  try {
    await generarPDFObra(obra, subs, estimaciones, maquinaria, materiales,
      subcontratos, branding, historialAvance, gpData, otrosGastos, gpDetalle,
      nominaHistorial, evidencia, programa, evidenciaCargada, instante);
  } finally {
    global.window = guardados.window;
    global.document = guardados.document;
    global.alert = guardados.alert;
  }
  return dibujos;
}

module.exports = { lienzo, dibujarPDF };
