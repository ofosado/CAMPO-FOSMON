// El ruleset con el que se juzga. UN solo sitio, por la misma razón que
// `reloj.cjs`.
//
// Los bancos que miden permisos abren el SDK de cliente contra el emulador y
// mandan operaciones de verdad, que es lo correcto: una regla puede existir y
// no aplicar, y eso sólo se ve ejecutando. Pero NINGUNO cargaba las reglas.
// Medían el ruleset que el emulador tuviera puesto de cuando alguien lo
// arrancó, o —peor— el que le hubiera dejado la prueba anterior.
//
// Las dos mitades del defecto, medidas el 2026-10-11:
//
//   · ARRANQUE VIEJO. `prueba-reglas-evidencia` reportaba la denegación en
//     `create @ L453`. El archivo en disco tenía ese `create` en L482 y el de
//     HEAD en L457: tres rulesets distintos, y el que opinaba no era ninguno
//     de los dos del repositorio. El emulador llevaba horas arriba y no
//     recargó. Un arreglo de reglas se podía editar, correr el banco, verlo
//     verde por las reglas VIEJAS y mezclar.
//
//   · CONTAMINACIÓN ENTRE BANCOS. Los nueve bancos de permisos comparten el
//     proyecto `campo-fosmon-prueba`, y `prueba-nota-no-calla` carga a
//     propósito un ruleset MUTILADO —firestore.rules menos los bloques de
//     `avance/notas`— para comprobar que la nota avisa cuando rebota. Nunca lo
//     restauraba. Y en orden alfabético corren después `prefijo-organizacion`,
//     `reglas-dependencia-captura` y `reglas-nomina-subcoleccion`, los tres
//     sobre reglas que nadie volvió a poner.
//
//     Comprobado, no deducido: con el archivo completo cargado, un residente
//     escribe en `avance/notas` y PASA; después de correr `nota-no-calla`, la
//     misma escritura REBOTA con `permission-denied`. El ruleset mutilado se
//     queda puesto.
//
// Lo que esto costaba no es un rojo: es que `npm test` y `node scripts/…`
// podían dar veredictos distintos sobre las MISMAS reglas, según qué corrió
// antes. Es la forma exacta del hallazgo del reloj, en otro insumo — y un
// veredicto que depende de cómo lo invocaste no se arregla, se aprende a
// ignorar.
//
// El arreglo no es restaurar al salir. Restaurar deja el orden importando: si
// un banco revienta a media corrida, no restaura, y el siguiente vuelve a
// heredar. Lo que quita el orden de la ecuación es que CADA banco cargue lo
// que va a juzgar antes de abrir su primera sesión. Entonces da igual qué
// corrió antes, si reventó, o cuántas horas lleva el emulador arriba.

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARCHIVO = path.join(RAIZ, 'firestore.rules');

// Si el emulador no está o no acepta el archivo, no se midió nada —ni bien ni
// mal— y eso es NO ARRANCÓ (2), no rojo. Un error de sintaxis en las reglas
// tampoco es una regresión de conducta: es que no hubo nada que ejecutar.
const noArranco = require('./no-arranco.cjs');

// `contenido` existe para los bancos que a propósito juzgan un ruleset
// derivado (`prueba-nota-no-calla` quita bloques para montar una ruta sin
// regla). Lo deriva quien lo necesita; el transporte es el mismo.
async function cargarReglas({ proyecto, host = '127.0.0.1', puerto = 8080,
                              archivo = ARCHIVO, contenido = null } = {}) {
  if (!proyecto) throw new Error('cargarReglas necesita `proyecto`');
  const cuerpo = contenido !== null ? contenido : fs.readFileSync(archivo, 'utf8');

  let r;
  try {
    r = await fetch(`http://${host}:${puerto}/emulator/v1/projects/${proyecto}:securityRules`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: cuerpo }] } }) });
  } catch (e) {
    noArranco.sinPrecondicion(
      `no hay emulador de Firestore en ${host}:${puerto} (${e.message})`,
      ['export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"',
       `firebase emulators:start --only firestore,auth --project ${proyecto}`]);
  }
  if (!r.ok) {
    noArranco.sinPrecondicion(
      `el emulador no aceptó el ruleset: ${r.status} ${(await r.text()).slice(0, 400)}`,
      ['Es un error de sintaxis en las reglas, no una regresión de conducta.',
       `Archivo: ${path.relative(RAIZ, archivo)}`]);
  }
  return contenido !== null ? '(ruleset derivado)' : path.relative(RAIZ, archivo);
}

module.exports = { cargarReglas, ARCHIVO, RAIZ };
