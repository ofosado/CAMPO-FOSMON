// Puente para que los bancos de prueba que montan funciones de App.jsx en un
// sandbox puedan resolver rutas de obra.
//
// Desde que las obras pueden colgar de una organización, las funciones que
// esos bancos extraen de App.jsx llaman a `conOrg()`. Sin ella en el ámbito,
// el sandbox revienta con un ReferenceError y la prueba sale en rojo por
// andamiaje, no por conducta.
//
// Devuelve la función DE VERDAD, importada de src/rutas-org.js — no una copia.
// Una copia se desincroniza del original y entonces la prueba pasa mientras la
// app falla, que es exactamente el modo de fallo que estas pruebas existen
// para atrapar.
//
// Fija el prefijo de CONSTRUCTORA, que resuelve a la raíz: estos bancos
// afirman sobre rutas como `obras/0125/...` y esa es la forma que tienen en
// FOSMON. La conducta del lado dependencia la cubre
// scripts/prueba-prefijo-organizacion.cjs.

const path = require('path');

let cache = null;

module.exports = async function rutasOrgParaPruebas() {
  if (cache) return cache;
  const mod = await import(path.resolve(__dirname, '../src/rutas-org.js'));
  if (typeof mod.conOrg !== 'function' || typeof mod.fijarPrefijoOrg !== 'function') {
    throw new Error('src/rutas-org.js no expone conOrg/fijarPrefijoOrg');
  }
  mod.fijarPrefijoOrg('constructora', 'fosmon');
  cache = { conOrg: mod.conOrg };
  return cache;
};
