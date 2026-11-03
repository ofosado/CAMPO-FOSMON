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

// Anota PÁGINA y POSICIÓN, no sólo el texto. Tirar las posiciones hace que un
// banco afirme más de lo que comprueba: el pie de la portada y el marco de cada
// página dibujan cosas parecidas en el mismo renglón, así que un `includes` se
// cumple con el marco aunque la portada esté mal. La portada es la página 1
// —`pageFrame` corre sólo después de cada `addPage`—.
function lienzo() {
  const dibujos = [];
  let pagina = 1;
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
async function dibujarPDF(generarPDFObra, branding, obra) {
  const { doc, dibujos } = lienzo();
  const guardados = { window: global.window, document: global.document, alert: global.alert };
  global.window = { jspdf: { jsPDF: function () { return doc; } }, _atLoaded: true };
  global.document = { createElement: () => ({}), head: { appendChild: () => {} } };
  global.alert = () => {};
  try {
    await generarPDFObra(obra, [], [], [], [], [], branding, [], null, [], null, [], []);
  } finally {
    global.window = guardados.window;
    global.document = guardados.document;
    global.alert = guardados.alert;
  }
  return dibujos;
}

module.exports = { lienzo, dibujarPDF };
