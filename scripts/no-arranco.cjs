// Una prueba que no arranca tiene que gritar igual que una que falla.
// Ver PENDIENTES, principio P4.
//
// Las pruebas de este repositorio sacan el código vivo de `src/App.jsx`
// recorriendo el AST y buscando declaraciones POR NOMBRE. Eso no choca con el
// P3 —el P3 prohíbe *afirmar* que un nombre existe, no usarlo como dirección
// para llegar al código— pero tiene una consecuencia: el día que alguien
// renombra un símbolo, la prueba deja de encontrar lo que iba a ejercitar.
//
// Ese día la prueba no sabe nada. No sabe si la conducta sigue viva bajo otro
// nombre ni si se rompió: sabe que no pudo mirar. Decirlo como "FALLA" es
// mentir en una dirección y callarlo es mentir en la otra, así que se dice lo
// que es, y se sale con un código PROPIO (2) para que el corredor de la suite
// lo pueda separar de un rojo de verdad.
//
// Esto salió de un caso concreto: el 2026-09-23 el renombre de
// `eliminarSemana` a `eliminarCarga` dejó `prueba-nomina-no-guarda-callado`
// muerta antes de montar nada, y main pasó horas en rojo sin que se notara.

const NO_ARRANCO = 2;

module.exports = function noArranco(faltantes, archivo = 'src/App.jsx') {
  const lista = (Array.isArray(faltantes) ? faltantes : [faltantes])
    .map(n => String(n).replace(/^fn:/, ''));
  console.log('');
  console.log('NO ARRANCÓ — la prueba no pudo encontrar en ' + archivo + ':');
  for (const n of lista) console.log('  · `' + n + '`');
  console.log('');
  console.log('Lo más probable es que el símbolo haya cambiado de nombre. Eso NO');
  console.log('dice que haya una regresión — y tampoco que no la haya: la conducta');
  console.log('se quedó SIN COMPROBAR, que es lo peligroso.');
  console.log('');
  console.log('Buscar cómo se llama ahora y apuntar la extracción al nombre nuevo.');
  console.log('Si la conducta ya no existe, borrar la prueba con ella; lo que no');
  console.log('puede quedarse es una prueba que nadie ve morir.');
  process.exit(NO_ARRANCO);
};

module.exports.NO_ARRANCO = NO_ARRANCO;
