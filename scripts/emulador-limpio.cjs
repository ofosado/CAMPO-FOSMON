// El P7, otra vez, en el insumo que faltaba: LOS DATOS.
//
// `reglas-del-repo.cjs` quitó el ruleset heredado. El barrido del 2026-10-22
// enseñó que quedaba la otra mitad: **6 de los 8 bancos que abren el emulador
// no borraban nada antes de empezar**. Las reglas ya no se heredan; los
// documentos sí. Los ocho comparten el proyecto `campo-fosmon-prueba`, así
// que cada uno empezaba sobre lo que le dejó el anterior — y el orden lo fija
// `ls`, no una decisión.
//
// Los dos que sí limpiaban no lo hacían por disciplina: `reglas-evidencia` y
// `reglas-nomina-subcoleccion` cuentan documentos («la subcolección trae DOS
// semanas»), y les salió rojo por restos de otra corrida. O sea que el defecto
// ya había mordido dos veces; lo que no había era un sitio donde arreglarlo
// una vez.
//
// ── Por qué esto NO lleva `.catch(() => {})` ───────────────────────────────
//
// Las dos limpiezas que existían se tragaban el fallo. Es el agujero exacto
// del P7: si no se puede limpiar, el banco corre igual, sobre estado ajeno, y
// emite un veredicto limpio sobre otra cosa. Un insumo que no se pudo cargar
// no es verde ni rojo — es NO ARRANCÓ (2). Aquí se cumple a propósito.
//
// No pasa por reglas: la API de administración del emulador las ignora, que
// es justo lo que hace falta cuando el borrado está negado (y en este
// proyecto `allow delete: if false` es la norma, no la excepción).

const noArranco = require('./no-arranco.cjs');

// Borra TODOS los documentos del proyecto en el emulador de Firestore.
// Se llama antes de la primera sesión y antes de la primera aserción.
async function limpiarDatos({ proyecto, host = '127.0.0.1', puerto = 8080 } = {}) {
  if (!proyecto) throw new Error('limpiarDatos necesita `proyecto`');
  const url = `http://${host}:${puerto}/emulator/v1/projects/${proyecto}` +
              '/databases/(default)/documents';

  let r;
  try {
    r = await fetch(url, { method: 'DELETE' });
  } catch (e) {
    noArranco.sinPrecondicion(
      `no hay emulador de Firestore en ${host}:${puerto} para limpiar (${e.message})`,
      ['export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"',
       `firebase emulators:start --only firestore,auth --project ${proyecto}`]);
  }
  if (!r.ok) {
    noArranco.sinPrecondicion(
      `el emulador no pudo borrar los datos de ${proyecto}: ${r.status} ` +
      `${(await r.text()).slice(0, 300)}`,
      ['Sin poder limpiar, este banco mediría sobre lo que dejó el anterior.',
       'Eso no es un rojo: es que no hay nada que medir.']);
  }
  return proyecto;
}

module.exports = { limpiarDatos };
