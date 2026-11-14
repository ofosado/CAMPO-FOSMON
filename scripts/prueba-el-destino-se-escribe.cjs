#!/usr/bin/env node
// ¿Puede un olvido mandar un guion a producción?
//
// La conducta que se afirma aquí no es que exista un módulo ni una bandera: es
// que CORRER UN GUION SIN DECIR A DÓNDE NO ESCRIBE NADA. Se comprueba
// ejecutando los guiones de verdad como procesos hijos y mirando con qué código
// salen y qué dijeron, porque lo que importa es lo que pasa cuando alguien
// teclea el comando, no lo que diga una función aislada.
//
// Por qué existe: el 2026-10-09 a la 01:43 `migrar-evidencia-subcoleccion.cjs`
// escribió 270 documentos en producción porque elegía destino por la AUSENCIA
// de `EMU_HOST`. Buscando el mismo patrón salieron tres guiones de Admin SDK
// con las DOS omisiones a la vez —destino Y escritura— y el peor,
// `backfill-claims`, reescribe custom claims de Firebase Auth, que ni las
// reglas ni el export de Firestore que usamos como respaldo pueden devolver.
//
// Los tres guiones resuelven destino ANTES de inicializar el Admin SDK, así que
// este banco corre sin credenciales de ninguna clase y no toca ninguna red.
// Si algún día uno de ellos mueve el portón después de `initializeApp`, esta
// prueba se pone roja por el motivo correcto: ya habría abierto una credencial
// contra algo antes de saber contra qué.

const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, NO_ARRANCO, hijoConPlazo } = require('./no-arranco.cjs');

vigilarExcepciones('los guiones que pueden escribir');

const DIR = __dirname;

// Los guiones que pasan por el portón. Si mañana hay otro, va aquí.
//
// Están en dos listas y no por capricho. Los tres de `GUIONES` cargan el Admin
// SDK, que no está instalado en la raíz de este repo: aunque el portón los
// deje pasar, se caen en el `require` antes de tocar nada, así que correrlos
// con `--prod --escribir` desde la suite es seguro.
//
// `migrar-evidencia-subcoleccion.cjs` NO: habla REST con un token de
// `/tmp/adc.tok`, y en la laptop de quien tenga sesión abierta ese comando
// escribe de verdad en producción. Correrlo así desde la suite sería cometer
// el accidente del 2026-10-09 una vez por `npm test`. Por eso entra en las
// secciones donde el portón lo PARA —que son las que afirman algo sobre el
// cerrojo— y se queda fuera de las dos que lo dejan proceder.
const GUIONES = [
  'backfill-claims.cjs',
  'crear-org-fosmon.cjs',
  'migrar-supervisor-a-auditor.cjs',
];

const PASAN_POR_EL_PORTON = [...GUIONES, 'migrar-evidencia-subcoleccion.cjs'];

for (const g of PASAN_POR_EL_PORTON) {
  try { require('fs').accessSync(path.join(DIR, g)); }
  catch { sinPrecondicion(`no está scripts/${g}`, 'Si el guion se borró, borrar su renglón de GUIONES aquí.'); }
}

// Corre un guion con argumentos y entorno dados. `env` se construye desde cero
// para que las variables de la sesión que lo invoca no decidan el resultado:
// una prueba que pasa o falla según lo que haya exportado el usuario no mide
// nada. Por eso se arranca de un entorno limpio y se agrega sólo lo que la
// prueba quiere decir.
const correr = (guion, args = [], extra = {}) => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...extra };
  const r = hijoConPlazo(process.execPath, [path.join(DIR, guion), ...args], {
    encoding: 'utf8', cwd: path.join(DIR, '..'), env, timeout: 30000,
  });
  return { status: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};

let fallas = 0, oks = 0;
const ok = (q, d) => { oks++; console.log(` ok   ${q}${d ? `  ·  ${d}` : ''}`); };
const falla = (q, esperado, obtenido) => {
  fallas++;
  console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esperado}`);
  console.log(`        obtuvo:   ${obtenido}`);
};

// ── 1. Sin decir destino, el guion se para y no escribe ────────────────────
//
// Ésta es LA afirmación. Antes de hoy este mismo comando —el nombre del
// archivo, sin un argumento— apuntaba a producción y escribía.
console.log('\n── Correrlo sin decir a dónde ──');
for (const g of PASAN_POR_EL_PORTON) {
  const { status, salida } = correr(g, []);
  if (status !== NO_ARRANCO)
    falla(`${g} sin argumentos se para`, `salida ${NO_ARRANCO}`, `salida ${status}`);
  else if (!/No hay destino/.test(salida))
    falla(`${g} dice por qué se paró`, 'el texto «No hay destino»', salida.trim().split('\n')[0] || '(nada)');
  else if (/campo-fosmon(?!-prueba)/.test(salida) && !/producción/i.test(salida))
    falla(`${g} no nombra producción como si fuera el destino`, 'sin destino resuelto', salida.trim());
  else
    ok(`${g} sin argumentos se para y lo dice`, `salida ${status}`);
}

// ── 2. Dos destinos a la vez tampoco se adivina ────────────────────────────
console.log('\n── Pedirle emulador y producción al mismo tiempo ──');
for (const g of PASAN_POR_EL_PORTON) {
  const { status, salida } = correr(g, ['--prod'], { EMU_HOST: '127.0.0.1', EMU_PORT: '8080' });
  if (status !== NO_ARRANCO)
    falla(`${g} con --prod y emulador se para`, `salida ${NO_ARRANCO}`, `salida ${status}`);
  else if (!/a la vez/.test(salida))
    falla(`${g} dice que son dos destinos`, 'el texto «a la vez»', salida.trim().split('\n')[0] || '(nada)');
  else
    ok(`${g} con dos destinos se para`, `salida ${status}`);
}

// ── 3. `--dry-run` junto con `--escribir` es una contradicción ─────────────
//
// Importa porque `--dry-run` es memoria muscular: era la bandera con la que uno
// se protegía. Aceptarla callada sería peor que rechazarla — quien la teclea
// creería que ella lo protege, cuando lo que lo protege es la AUSENCIA de
// `--escribir`.
console.log('\n── La bandera vieja junto con la nueva ──');
for (const g of PASAN_POR_EL_PORTON) {
  const { status, salida } = correr(g, ['--prod', '--dry-run', '--escribir']);
  if (status !== NO_ARRANCO)
    falla(`${g} con --dry-run y --escribir se para`, `salida ${NO_ARRANCO}`, `salida ${status}`);
  else if (!/ya no existe|las dos cosas/.test(salida))
    falla(`${g} explica que --dry-run ya no existe`, 'el texto «ya no existe»', salida.trim().split('\n')[0] || '(nada)');
  else
    ok(`${g} rechaza la contradicción`, `salida ${status}`);
}

// ── 4. Con destino pero sin `--escribir`, el ensayo es lo de omisión ───────
//
// No se puede llegar hasta el final sin credenciales, pero sí se puede afirmar
// lo que decide el portón: que el modo por omisión es ensayo y que lo dice.
// Se mira el ANUNCIO, no un símbolo: es la línea que el usuario lee antes de
// que el guion toque algo.
console.log('\n── Con destino, pero sin pedir escribir ──');
for (const g of GUIONES) {
  const { salida } = correr(g, ['--prod']);
  const anunciaEnsayo = /MODO:\s+ensayo/.test(salida);
  const anunciaEscritura = /MODO:\s+ESCRITURA/.test(salida);
  if (!anunciaEnsayo || anunciaEscritura)
    falla(`${g} con --prod y sin --escribir anuncia ensayo`,
      'MODO: ensayo', (salida.match(/MODO:.*/) || ['(no anunció modo)'])[0]);
  else
    ok(`${g} con --prod anuncia ensayo, no escritura`);
}

// ── 5. Y cuando sí se piden las dos, lo dice con todas sus letras ─────────
//
// La simétrica de la anterior: el portón tiene que ser igual de claro cuando la
// respuesta es sí. Un portón que sólo avisa cuando bloquea enseña a ignorarlo.
console.log('\n── Pidiendo producción Y escribir ──');
for (const g of GUIONES) {
  const { salida } = correr(g, ['--prod', '--escribir']);
  if (!/MODO:\s+ESCRITURA/.test(salida))
    falla(`${g} con --prod --escribir anuncia escritura`,
      'MODO: ESCRITURA', (salida.match(/MODO:.*/) || ['(no anunció modo)'])[0]);
  else if (!/PRODUCCIÓN/.test(salida))
    falla(`${g} nombra producción`, 'el texto «PRODUCCIÓN»', salida.trim().split('\n')[0] || '(nada)');
  else
    ok(`${g} anuncia producción y escritura antes de tocar nada`);
}

// ── 6. El portón corre antes incluso de CARGAR el Admin SDK ───────────────
//
// Esta comprobación nació en verde por el motivo equivocado, y vale anotarlo
// porque es el modo de fallo que más engaña. La primera versión sólo miraba que
// no apareciera el error de ADC. Aparecía limpio... porque `firebase-admin` no
// está instalado en la raíz de este repo y los tres guiones reventaban en el
// `require` con MODULE_NOT_FOUND y salida 1, antes de llegar al portón. O sea
// que "pasaba" gracias a una caída.
//
// Lo que se afirma ahora es lo que hay que afirmar: que la salida es la DEL
// PORTÓN (2, con su mensaje) y no la de un proceso que se cayó por otra razón.
// De paso queda cubierto el orden de los `require`: si alguien vuelve a poner
// `require("firebase-admin")` arriba, esto se pone rojo, porque quien se
// equivoque de destino recibiría un stack trace de Node en lugar de «No hay
// destino».
console.log('\n── El portón va antes de cargar el Admin SDK ──');
for (const g of PASAN_POR_EL_PORTON) {
  const { status, salida } = correr(g, []);
  if (/MODULE_NOT_FOUND|Cannot find module/.test(salida))
    falla(`${g} contesta el destino sin depender de firebase-admin`,
      'el portón, antes del require', 'MODULE_NOT_FOUND: el require va primero');
  else if (/inicializando Firebase Admin|applicationDefault/.test(salida))
    falla(`${g} no inicializa el Admin SDK sin destino`,
      'ni una mención a ADC', salida.trim().split('\n').slice(0, 3).join(' / '));
  else if (status !== NO_ARRANCO)
    falla(`${g} se para con el código del portón`, `salida ${NO_ARRANCO}`, `salida ${status}`);
  else
    ok(`${g} se para en el portón, sin cargar el SDK`);
}

// ── 7. La CUARTA aparición: el destino de omisión del proyecto entero ─────
//
// Las seis secciones de arriba tapan los guiones. Pero `.firebaserc` decía
// `default: campo-fosmon` —PRODUCCIÓN— así que `firebase deploy --only
// firestore:rules` sin `--project` desplegaba a producción, y nada en la
// pantalla lo decía. Es el mismo patrón que costó los 270 documentos del
// 2026-10-09, un escalón más arriba: ya no un guion, la configuración del
// repositorio. De esa raíz salieron los otros tres.
//
// Esto NO se comprueba leyendo `.firebaserc`. Leer el archivo sería afirmar
// que un símbolo existe, y además mediría la mitad equivocada: el `firebase`
// real resuelve el proyecto activo mirando TAMBIÉN el configstore del usuario
// (`~/.config/configstore/firebase-tools.json`), que vive fuera del
// repositorio y que un `firebase use produccion` vuelve a fijar. Un
// `.firebaserc` impecable con un configstore apuntado a producción da
// exactamente el defecto que esta sección existe para impedir.
//
// Así que se le pregunta al `firebase` de verdad, desde la raíz del
// repositorio, qué resuelve cuando nadie le dice nada. Es local y sin red.
// Se mide con el comando que de verdad destruye —`firebase deploy`— y no con
// `firebase use <alias>`, que valida el proyecto CONTRA EL SERVIDOR: eso
// metería red y credenciales en la suite, y además FIJA el proyecto activo en
// el configstore, o sea que la prueba dejaría puesto el defecto que mide.
// `deploy` sin `--project` se para antes de tocar nada, es local, tarda ~1.5 s,
// no escribe en ningún sitio, y de paso imprime los alias con su proyecto: la
// misma corrida contesta «no hay destino de omisión» y «los dos destinos
// siguen siendo pedibles por nombre».
// ── El rastro, para cuando el CLI no contesta ──────────────────────────────
//
// EL DEFECTO (#97). Esta sección ya clasificaba bien —un CLI que no contesta
// es NO ARRANCÓ, no rojo— pero el mensaje repetía la frase genérica del CLI
// («An unexpected error has occurred») y no dejaba nada más. El 2026-11-04 la
// suite salió con 1 por esto y la corrida siguiente dio 83 en verde sin tocar
// nada: media hora de diagnóstico que acabó en «volví a correrla y pasó», que
// es exactamente lo que el acuerdo prohíbe. No se reproduce en aislamiento
// —nueve intentos en verde, sueltos y en paralelo— así que la información hay
// que recogerla EN EL MOMENTO, que es el único en que existe.
//
// Esto NO reintenta para ponerse verde. La segunda pregunta es con `--debug` y
// su respuesta no se usa para juzgar nada: el banco sale 2 igual, conteste o
// no. Un reintento que decide el veredicto convierte «si falla y luego pasa,
// no quedó» en «volvé a correrla», que es el hábito que se está combatiendo.
// Si la segunda SÍ contesta, eso tampoco se calla: que el fallo no se repita a
// los dos segundos es el dato más útil que tiene el informe.
//
// Lo que se recoge son las tres cosas que cada aparición costaba averiguar a
// mano: el log que `--debug` sí escribe, qué otros `firebase` estaban vivos
// —la hipótesis que trae escrita el banco es el configstore tomado, y el
// corredor es secuencial, así que la suite no puede ser consigo misma— y si el
// configstore existía y de cuándo era.
const rastroDelCLI = (RAIZ) => {
  const fs = require('fs');
  const lineas = [];
  const LOG = path.join(RAIZ, 'firebase-debug.log');
  // De cuándo era el log de antes: si `--debug` no lo reescribe, lo que se
  // lea es de otra corrida y pegarlo sería inventar evidencia.
  const antes = (() => { try { return fs.statSync(LOG).mtimeMs; } catch { return 0; } })();

  // POR `spawnSync` Y NO POR `hijoConPlazo`, a propósito, y es la única razón
  // que vale: esto ya está DENTRO del diagnóstico. `hijoConPlazo` sale con 2 en
  // el momento, que aquí cortaría el informe justo antes de las tres cosas que
  // esta función existe para recoger —el log, los `firebase` vivos, el
  // configstore—. Un plazo vencido aquí no se calla: se publica en la línea de
  // abajo con su `status` y su `signal`, que es más de lo que diría la puerta.
  const t0 = Date.now();
  const otra = spawnSync('firebase',
    ['deploy', '--only', 'firestore:rules', '--dry-run', '--debug'], {
      encoding: 'utf8', cwd: RAIZ, timeout: 45000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
  const tardo = ((Date.now() - t0) / 1000).toFixed(1);
  const dijo2 = ((otra.stdout || '') + (otra.stderr || '')).trim();
  const contesto = otra.status === 0 || /No project active|No active project/i.test(dijo2);

  lineas.push(`Se volvió a preguntar con \`--debug\` (${tardo} s): ` + (contesto
    ? 'ESTA VEZ SÍ CONTESTÓ. El fallo es intermitente y no está en el ' +
      'repositorio; lo de abajo es de la corrida que sí anduvo.'
    : `tampoco — status=${otra.status} signal=${otra.signal}.`));

  // El log sólo se cita si `--debug` lo escribió ahora. Se copia fuera del
  // árbol porque la corrida siguiente lo pisa, y la que se quiere leer es ésta.
  let ahora = 0;
  try { ahora = fs.statSync(LOG).mtimeMs; } catch { /* no lo escribió */ }
  if (ahora > antes) {
    const guardado = path.join(require('os').tmpdir(),
      `firebase-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    let cola = [];
    try {
      fs.copyFileSync(LOG, guardado);
      cola = fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-12);
    } catch (e) { cola = [`(no se pudo leer el log: ${e.message})`]; }
    lineas.push('', `Log completo guardado en ${guardado}`, '', 'Últimas líneas:',
      ...cola.map(l => '  ' + l.slice(0, 160)));
  } else {
    // Qué significa que no haya log depende de si contestó, y decir lo mismo
    // en los dos casos sería inventar la mitad de las veces.
    lineas.push('', contesto
      ? '`--debug` no dejó `firebase-debug.log` pese a haber contestado, que ' +
        'no es lo normal: el CLI salió por un camino que no abre el log.'
      : '`--debug` no dejó `firebase-debug.log`: murió antes de abrirlo, y eso ' +
        'ya es un dato — no llegó ni a arrancar.');
  }

  // El único otro candidato vivo que nombra la fila: otro `firebase` tomando
  // el configstore. Se dicen los que hay, no se afirma que sean la causa.
  const ps = spawnSync('/bin/ps', ['-eo', 'pid,lstart,command'], { encoding: 'utf8' });
  const otros = (ps.stdout || '').split('\n')
    .filter(l => /\bfirebase\b/.test(l) && !/\bps -eo\b/.test(l))
    .map(l => '  ' + l.trim().slice(0, 140));
  lineas.push('', otros.length
    ? `Otros procesos \`firebase\` vivos en este momento (${otros.length}):`
    : 'No había ningún otro proceso `firebase` vivo en este momento.',
    ...otros);

  const CONFIG = path.join(process.env.HOME || '',
    '.config/configstore/firebase-tools.json');
  try {
    const st = fs.statSync(CONFIG);
    lineas.push('', `Configstore: ${CONFIG} — ${st.size} bytes, ` +
      `tocado ${new Date(st.mtimeMs).toISOString()}`);
  } catch {
    lineas.push('', `Configstore: no existe (${CONFIG}). Sin él no hay sesión.`);
  }
  return lineas;
};

console.log('\n── Qué despliega `firebase` cuando nadie le dice a dónde ──');
{
  const RAIZ = path.join(DIR, '..');
  // POR `spawnSync` Y NO POR `hijoConPlazo`: este sitio ya resuelve el plazo, y
  // mejor. Un CLI al que se lleva el plazo deja `status: null`, o sea `!== 0` y
  // sin «No project active», así que cae en el `sinPrecondicion` de abajo —2,
  // no 1— y además con `rastroDelCLI` entero pegado. La puerta genérica saldría
  // con el mismo código pero sin el rastro, que es lo único que sirve el día
  // que pasa.
  const cli = spawnSync('firebase',
    ['deploy', '--only', 'firestore:rules', '--dry-run'], {
      encoding: 'utf8', cwd: RAIZ, timeout: 60000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });

  if (cli.error && cli.error.code === 'ENOENT') {
    sinPrecondicion(
      'el `firebase` de la línea de comandos, que es quien resuelve el proyecto activo',
      ['Sin él no se puede medir a dónde apunta un deploy sin `--project`.',
       'Leer `.firebaserc` no sirve, y por dos razones: afirmaría que un',
       'símbolo existe en vez de qué pasa al teclear el comando, y mide la',
       'mitad equivocada — el proyecto activo también sale del configstore',
       'del usuario, que vive FUERA del repositorio.',
       'npm i -g firebase-tools']);
  }

  const dijo = ((cli.stdout || '') + (cli.stderr || '')).trim();
  const primera = dijo.split('\n').find(l => l.trim()) || '(nada)';
  const sinActivo = /No project active|No active project/i.test(dijo);

  // UN FALLO AL CONSULTAR NO ES UN FALLO DE LO CONSULTADO.
  //
  // El 2026-10-26 esta sección salió ROJA ×3 bajo la suite y VERDE al volver a
  // correrla sola, seis veces seguidas. Eso es un no determinismo, y por el
  // acuerdo («si falla y luego pasa, no quedó») se persiguió hasta la causa:
  // el único modo de no-arranque contemplado era `ENOENT`. Cualquier OTRA
  // forma de que el CLI no conteste —se lo llevó el plazo de 60 s, el
  // configstore estaba tomado, pidió sesión, le falló la red al buscar
  // actualización— deja `dijo` sin la respuesta, y las tres aserciones de
  // abajo se disparaban en rojo. O sea: el banco acusaba al destino de haber
  // cambiado cuando lo que se había roto era el instrumento.
  //
  // Dos averías distintas, dos reacciones distintas. Así que antes de juzgar
  // se exige que el CLI HAYA CONTESTADO LA PREGUNTA: o procedió (status 0), o
  // dijo que no tenía proyecto activo. Cualquier otra cosa es NO ARRANCÓ (2),
  // que en la suite grita igual de fuerte que un rojo pero no manda a nadie a
  // buscar una regresión que no existe.
  //
  // Esto NO afloja la medición: quitarle los alias a `.firebaserc` sigue
  // saliendo con «No project active» —con otra frase detrás— así que sigue
  // llegando a las comprobaciones de abajo; y reponer el `default`, que es el
  // defecto que esta sección persigue, hace que proceda y caiga en el rojo.
  if (cli.status !== 0 && !sinActivo) {
    sinPrecondicion(
      'una respuesta de `firebase` a «¿a dónde desplegarías si nadie te dice?»',
      ['El CLI está instalado pero no contestó la pregunta. Salió con ' +
         `status=${cli.status} signal=${cli.signal}` +
         (cli.error ? ` error=${cli.error.code || cli.error.message}` : '') +
         ', y dijo:',
       '',
       '  ' + (dijo ? dijo.split('\n').slice(0, 6).join('\n  ') : '(nada)'),
       '',
       'Eso no dice NADA sobre el destino de omisión, ni a favor ni en contra.',
       '',
       ...rastroDelCLI(RAIZ),
       '',
       'Si el rastro de arriba no señala a nadie, suele ser sesión caducada:',
       '  firebase login',
       '  node scripts/prueba-el-destino-se-escribe.cjs']);
  }

  // LA afirmación de esta sección: que se pare por no tener destino.
  if (cli.status === 0)
    falla('`firebase deploy` sin `--project` no procede',
      'que se pare', `salió 0 — procedió: ${primera}`);
  else
    ok('`firebase deploy` sin `--project` se para por no tener destino');

  // La simétrica: quitar el destino de omisión no puede volver imposible
  // desplegar. Si lo volviera, alguien repondría el `default` a la primera
  // urgencia y estaríamos peor que antes, porque ya nadie lo estaría mirando.
  for (const [alias, esperado] of [['produccion', 'campo-fosmon'],
                                   ['prueba', 'campo-fosmon-prueba']]) {
    if (!new RegExp(`${alias}\\s*\\(${esperado}\\)`).test(dijo))
      falla(`el alias \`${alias}\` sigue nombrando a ${esperado}`,
        `«${alias} (${esperado})» entre las opciones`, primera);
    else
      ok(`y ofrece \`--project ${alias}\` → ${esperado}`);
  }

  // Y que no haya nombrado producción como el destino que iba a usar. El
  // nombre `campo-fosmon` SÍ aparece arriba, pero como alias ofrecido; lo que
  // no puede aparecer es una línea que lo dé por elegido.
  const lineaDestino = dijo.split('\n').find(l =>
    /campo-fosmon(?!-prueba)/.test(l) && !/\bproduccion\s*\(/.test(l));
  if (lineaDestino)
    falla('no da producción por elegida en ninguna línea',
      'producción sólo como alias ofrecido', lineaDestino.trim());
  else
    ok('y en ninguna línea da producción por elegida');
}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas > 0) {
  console.log('');
  console.log('Un guion que escribe sin que se le diga a dónde es el defecto que');
  console.log('costó 270 documentos en producción el 2026-10-09. Si esto está rojo,');
  console.log('alguno volvió a decidir el destino por omisión.');
}
process.exit(fallas > 0 ? 1 : 0);
