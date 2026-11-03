// Fija "hoy" para correr una prueba en un día concreto.
//
// PARA QUÉ. Varias pruebas construyen sus escenarios relativos a hoy —"el
// snapshot de hace 9 semanas"— para no caducar. El precio es que un defecto
// que sólo aparece ciertos días del calendario se manifiesta como una prueba
// que un día está verde y otro roja, sin que nadie haya tocado nada. Con esto
// se corre la misma prueba en el día que uno quiera y la pregunta se contesta
// en diez segundos: ¿es una regresión o es el calendario?
//
// Así se encontró el pendiente #29 (una obra que arranca en lunes pinta una
// semana que no existió):
//
//   for f in 2026-09-16 2026-09-18 2026-09-21 2026-09-22 2026-10-05; do
//     echo -n "$f → "
//     FECHA_FALSA="${f}T18:00:00Z" node --require ./scripts/fecha-falsa.cjs \
//       scripts/prueba-series-sincronizadas.cjs 2>&1 | grep -c '✗'
//   done
//
// Se usa con --require, ANTES del script, para que el parcheo esté puesto
// cuando el archivo bajo prueba se evalúe.
//
// LA RUTA VA CON `./`. Sin la barra, Node la busca como si fuera un paquete
// de node_modules, no la encuentra y **muere antes de correr nada**. Si eso
// pasa dentro de un `| grep -c '✗'`, el conteo sale 0 y parece que todo está
// verde cuando en realidad no se ejecutó ni una prueba. Vale la pena mirar la
// salida completa la primera vez.
//
// Ojo: sólo fija `new Date()` sin argumentos y `Date.now()`. No toca zonas
// horarias ni temporizadores, que es justo lo que hace falta aquí y nada más.

const Real = Date;
const bruto = process.env.FECHA_FALSA;
if (!bruto) {
  throw new Error('fecha-falsa.cjs: falta FECHA_FALSA (p.ej. 2026-09-21T12:00:00Z)');
}
const FIJO = new Real(bruto).getTime();
if (Number.isNaN(FIJO)) {
  throw new Error(`fecha-falsa.cjs: FECHA_FALSA no se entiende: "${bruto}"`);
}

class DateFija extends Real {
  constructor(...args) {
    if (args.length === 0) super(FIJO);
    else super(...args);
  }
  static now() { return FIJO; }
}
global.Date = DateFija;
