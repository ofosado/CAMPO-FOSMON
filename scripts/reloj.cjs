// El reloj con el que se juzga la suite. UN solo sitio.
//
// Toda la suite afirma sobre un producto mexicano: semanas ISO de captura,
// cierres de nómina, "hace 7 días sin captura". Y esas cuentas resuelven una
// marca de tiempo completa por su DÍA LOCAL, que es lo correcto —un instante
// designa un instante— pero local es local de la máquina que corre.
//
// El 2026-10-10, con la laptop en Europe/Madrid, la suite dio 52 verdes y UN
// rojo: `2026-08-03T01:00:00Z` es domingo 2 a las 19:00 en México y lunes 3 a
// las 03:00 en Madrid, así que la misma prueba sin cambiar una letra decía 31
// en un sitio y 32 en el otro.
//
// Eso se atendió fijando `TZ` en el corredor. No alcanzó, y el 2026-10-11 se
// vio por qué: el corredor es UNA de las dos formas de correr un banco. La
// otra —`node scripts/prueba-loquesea.cjs`, que es como se trabaja mientras se
// arregla algo— no pasaba por ahí. Con la laptop en Madrid, el mismo banco
// daba verde por `npm test` y ROJO a mano. Un veredicto que depende de cómo lo
// invocaste es peor que uno rojo: el rojo se arregla, éste se aprende a
// ignorar.
//
// Por eso el reloj se fija aquí, en el preámbulo que los 55 bancos ya cargan,
// y no en cada banco ni sólo en el corredor. El corredor importa la constante
// de este archivo en vez de teclearla otra vez: la zona es UNA decisión, y dos
// copias de una decisión se desincronizan.
//
// Lo que ESTO NO ARREGLA, y vive en PENDIENTES #61: un teléfono fuera de
// México sigue archivando su foto en la semana de su propio día local. Aquí se
// hizo determinista la MEDICIÓN, no la conducta.

const ZONA = 'America/Mexico_City';

// El huso que traía la máquina, leído ANTES de pisarlo. Se guarda porque el
// corredor avisa en voz alta cuando está ignorando el reloj de la computadora,
// y ese aviso es la mitad del valor: sin él, alguien en Madrid ve una suite
// verde y concluye que su máquina mide igual que la de México. No es `env.TZ`
// sino el huso RESUELTO, que es el que de verdad gobierna, y que existe
// también cuando nadie exportó nada.
const AMBIENTE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Asignar `process.env.TZ` en marcha sí reajusta el huso en Node moderno
// (invalida la caché de zona), así que basta con hacerlo antes de que el banco
// construya su primera fecha — y como este módulo se carga en el `require` de
// cabecera, eso está garantizado.
//
// Se respeta un `TZ` puesto a mano para poder escribir la contraprueba: sin
// esta puerta no habría forma de comprobar desde fuera que el fijado sirve,
// porque cualquier intento de correr en otro huso quedaría pisado por esto
// mismo. `FORZAR_TZ=1` es el interruptor, y sólo lo usa su propio banco.
if (!process.env.FORZAR_TZ) process.env.TZ = ZONA;

module.exports = { ZONA, AMBIENTE };
