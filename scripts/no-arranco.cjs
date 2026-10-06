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

// El tercer modo de no arrancar: falta algo del ENTORNO.
//
// No un símbolo renombrado ni una excepción, sino un insumo que la prueba
// necesita y que no se puede fabricar sola: un volcado de producción, una
// credencial, un archivo que alguien tiene que bajar antes. Es el caso más
// fácil de clasificar mal porque la prueba sabe exactamente qué le falta, y
// decirlo con `exit(1)` sale gratis.
//
// Sale caro después. Un rojo que lleva semanas puesto porque a alguien le
// falta un archivo en /tmp es un rojo que se aprende a saltar, y el día que
// esa misma prueba encuentre una regresión de verdad nadie la va a mirar. El
// P4 existe para esto: tres estados, y "no pude mirar" es el tercero.
module.exports.sinPrecondicion = function sinPrecondicion(queFalta, comoConseguirlo) {
  const pasos = Array.isArray(comoConseguirlo) ? comoConseguirlo : [comoConseguirlo];
  console.log('');
  console.log('NO ARRANCÓ — le falta un insumo del entorno:');
  console.log('  · ' + queFalta);
  console.log('');
  console.log('Esto NO es un rojo: no se comprobó nada, ni bien ni mal. Para que');
  console.log('corra, conseguir eso primero:');
  console.log('');
  for (const p of pasos) if (p) console.log('  ' + p);
  console.log('');
  process.exit(NO_ARRANCO);
};

// El mismo principio, para el otro modo de no arrancar.
//
// Un símbolo que cambió de nombre lo atrapa `noArranco` arriba. Lo que no
// atrapaba nadie es una excepción: el banco revienta a media extracción y Node
// sale con 1 — el MISMO código que un rojo de verdad. La suite entonces dice
// "falla" cuando lo que pasó es que la prueba no pudo mirar, y se busca una
// regresión que no existe mientras la que sí existe sigue sin comprobarse.
//
// Salió de una contraprueba: al romper la FORMA de `LEXICO` —no su nombre— el
// banco de dependencia salió 1 con 0 FALLA. Un `.catch` al final del IIFE no
// alcanza: estos bancos construyen sandboxes en el ámbito del módulo, antes de
// que el IIFE empiece. Hay que vigilar el proceso, no una promesa.
module.exports.vigilarExcepciones = function vigilarExcepciones(archivo) {
  const donde = archivo ? ' mientras leía ' + archivo : '';
  const salir = (etiqueta, e) => {
    console.log('');
    console.log('NO ARRANCÓ — la prueba reventó' + donde + ':');
    console.log('');
    console.log('  ' + etiqueta + ': ' + (e && e.stack ? e.stack : e));
    console.log('');
    console.log('Esto NO es un rojo. La conducta se quedó SIN COMPROBAR. Suele ser');
    console.log('que una declaración cambió de forma —no de nombre, de forma— y el');
    console.log('andamiaje que la extrae ya no sirve; en los bancos que usan el');
    console.log('emulador, que el emulador no está. Arreglar eso y volver a correr');
    console.log('para saber si además hay regresión.');
    process.exit(NO_ARRANCO);
  };
  process.on('uncaughtException', e => salir('excepción sin atrapar', e));
  process.on('unhandledRejection', e => salir('promesa rechazada sin atrapar', e));
};
