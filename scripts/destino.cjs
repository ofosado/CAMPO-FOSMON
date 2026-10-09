// ── EL DESTINO SE ESCRIBE, NO SE DEDUCE ────────────────────────────────────
//
// Portón único para cualquier guion que pueda escribir. Contesta dos preguntas
// que antes cada guion contestaba a su manera, y mal:
//
//   ¿A DÓNDE escribe?   antes: a producción, por la AUSENCIA de una variable.
//   ¿ESCRIBE o ensaya?  antes: escribía, y `--dry-run` era la forma de pedirle
//                       que no lo hiciera.
//
// Las dos omisiones apuntaban al modo destructivo. El 2026-10-09 a la 01:43
// eso costó 270 documentos escritos en producción en `obras/0114/evidencia`:
// corrí la migración de evidencia sin `EMU_HOST` queriendo el emulador. No se
// perdió nada —el mapa viejo quedó intacto— pero fue una escritura a producción
// sin autorización, que es justo lo que este proyecto reserva para un OK.
//
// Buscando el mismo patrón aparecieron tres guiones de Admin SDK peores,
// porque traían las DOS omisiones a la vez:
//
//   backfill-claims.cjs            setCustomUserClaims a todos los usuarios
//   crear-org-fosmon.cjs           orgs/{id} + batch.update sobre usuarios
//   migrar-supervisor-a-auditor.cjs batch.update de roles
//
// `backfill-claims` es el peor de los tres y no por su tamaño: los custom
// claims viven en Firebase Auth, y de ahí no los saca una regla de Firestore
// ni un export de Firestore. El respaldo que tenemos NO los respalda. Era un
// botón sin tapa.
//
// Este módulo es la tapa. Producción se pide con `--prod` y escribir se pide
// con `--escribir`. Un olvido ya no apunta a ningún lado: el guion se para.
//
// Por qué un módulo y no el mismo bloque pegado tres veces: tres copias del
// portón son tres lugares donde relajarlo por separado. Si mañana hay que
// endurecerlo —pedir confirmación, exigir el nombre del proyecto— se endurece
// aquí y queda endurecido en todos.

const path = require('path');

const SALIDA_SIN_DESTINO = 2;

// ¿Hay un emulador apuntado? Se acepta cualquiera de las variables que entiende
// el Admin SDK, más la `EMU_HOST` que usan los guiones de REST de este repo.
const emuladorApuntado = () => (
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.EMU_HOST ||
  null
);

// Resuelve a dónde y con qué permiso corre este guion, o para el proceso.
//
// Devuelve `{ prod, escribir, emulador, projectId }`. Nunca devuelve un destino
// ambiguo: si no se puede decir con certeza, sale con 2 (NO ARRANCÓ) en lugar
// de elegir por el usuario.
function resolverDestino({ escribe, projectIdProd = 'campo-fosmon' } = {}) {
  const args = process.argv.slice(2);
  const guion = path.basename(process.argv[1] || 'guion.cjs');

  const prod = args.includes('--prod');
  const escribir = args.includes('--escribir');
  const emulador = emuladorApuntado();
  const dryRunViejo = args.includes('--dry-run');

  const parar = (...lineas) => {
    console.error('\n' + lineas.join('\n') + '\n');
    process.exit(SALIDA_SIN_DESTINO);
  };

  if (!emulador && !prod) parar(
    'No hay destino.',
    '',
    `  Emulador:    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \\`,
    `                 node scripts/${guion} …`,
    `  Producción:  node scripts/${guion} --prod …            (ensayo, no escribe)`,
    `               node scripts/${guion} --prod --escribir …  (escribe de verdad)`,
    '',
    'Producción se pide con `--prod` y escribir se pide con `--escribir`. Antes',
    'las dos eran lo que salía por omisión, y el 2026-10-09 eso escribió 270',
    'documentos en producción por una variable de entorno olvidada.');

  if (emulador && prod) parar(
    `\`--prod\` y un emulador apuntado (${emulador}) a la vez.`,
    'Decide uno: no voy a adivinar cuál.');

  // `--dry-run` era la forma vieja de pedir «no escribas». Ya no hace falta y
  // aceptarlo callado sería peor que rechazarlo: quien lo teclea cree que la
  // bandera es la que lo protege, cuando lo que lo protege es la AUSENCIA de
  // `--escribir`. Si viene junto con `--escribir` el usuario se está
  // contradiciendo y lo que pide no se puede cumplir de las dos maneras.
  if (dryRunViejo && escribir) parar(
    '`--dry-run` y `--escribir` a la vez: eso es pedir las dos cosas.',
    '',
    'Ya no existe `--dry-run`. Ahora el ensayo es lo que sale por omisión y',
    'escribir se pide con `--escribir`. Quita una de las dos.');

  if (dryRunViejo) console.log(
    '`--dry-run` ya no hace falta: sin `--escribir` este guion no escribe nada.\n');

  console.log(prod
    ? `DESTINO: PRODUCCIÓN (${projectIdProd})`
    : `DESTINO: emulador (${emulador})`);
  console.log(escribir
    ? `MODO:    ESCRITURA — ${escribe || 'esto escribe de verdad'}`
    : 'MODO:    ensayo — no se escribe nada (agrega `--escribir` para aplicar)');
  if (prod && escribir) console.log(
    '\n*** Esto toca PRODUCCIÓN y escribe. Es de las cosas que en este\n' +
    '*** proyecto necesitan un OK explícito.');
  console.log('');

  return { prod, escribir, emulador, projectId: prod ? projectIdProd : (process.env.GCLOUD_PROJECT || 'campo-fosmon-prueba') };
}

module.exports = { resolverDestino, SALIDA_SIN_DESTINO };
