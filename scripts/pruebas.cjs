#!/usr/bin/env node
// Corre TODA la suite y dice en qué estado quedó cada prueba.
//
// Por qué existe: hasta hoy no había forma de correr la suite entera. Cada
// prueba se invocaba a mano, así que en la práctica sólo se corrían las de la
// rama en la que uno andaba. El 2026-09-23 un renombre de símbolo dejó
// `prueba-nomina-no-guarda-callado` sin arrancar y main pasó horas en rojo sin
// que nadie lo viera: la prueba que se rompió no era la que se estaba mirando.
//
// Distingue TRES estados, no dos (PENDIENTES, principio P4):
//
//   verde       la conducta se comprobó y se sostiene
//   ROJO        la conducta se comprobó y NO se sostiene  → regresión
//   NO ARRANCÓ  la conducta no se pudo comprobar          → punto ciego
//
// El tercero es el que se inventó este corredor. Antes se confundía con el
// segundo, y un punto ciego disfrazado de regresión se "arregla" tocando la
// prueba hasta que pase, que es exactamente como se pierde la cobertura.
//
// Y un cuarto veredicto, que no es un estado del banco sino del banco EN EL
// TIEMPO: CADUCA — verde hoy, rojo con el reloj adelantado. Ver el bloque del
// barrido más abajo.
//
// Sale con código 1 si hay rojos, si hay pruebas que no arrancaron o si hay
// alguna que caduca. Las tres cosas paran un merge.
//
// Uso:  npm test
//       node scripts/pruebas.cjs            todas, con barrido de fechas
//       node scripts/pruebas.cjs nomina     sólo las que digan "nomina", sin barrido
//       BARRIDO=no npm test                 sin barrido, y lo dice
//       BARRIDO=2028-01-11 npm test         barrido a una fecha a mano

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { NO_ARRANCO } = require('./no-arranco.cjs');

const dir = __dirname;
const filtro = process.argv[2] || '';
const archivos = fs.readdirSync(dir)
  .filter(f => /^prueba-.*\.cjs$/.test(f))
  .filter(f => !filtro || f.includes(filtro))
  .sort();

if (archivos.length === 0) {
  console.log(`No hay pruebas que empaten con "${filtro}".`);
  process.exit(1);
}

// ── QUÉ EMULADOR NECESITA CADA BANCO ───────────────────────────────────────
//
// Sin el emulador que necesita, de un banco no se puede decir que la conducta
// esté bien ni mal: no se miró. Es un NO ARRANCÓ con otra causa, y se marca
// aparte para que no se confunda con un renombre.
//
// Hasta el 2026-11-06 esto era una LISTA de archivos y la pregunta era una
// sola: «¿contesta el 8080?». Firestore no es el único emulador que levantan.
// `prueba-reglas-dependencia-captura` también habla con Storage —es el único
// banco del repo que ejercita `storage.rules`—, y con el 8080 arriba y el 9199
// caído ese banco pasaba el filtro, arrancaba, y el SDK de Storage se quedaba
// reintentando la subida hasta que el corredor lo mató: `SE COLGÓ ·
// reglas-dependencia-captura · sin contestar en 240 s`, con una cola de ruido
// de gRPC que no nombraba a Storage por ninguna parte. Cuatro minutos para no
// medir nada, y un informe que mandaba a buscar un banco lento.
//
// Lo que estaba mal no era el banco: era que el corredor preguntaba por UN
// puerto y clasificaba como si hubiera preguntado por todos. Así que cada banco
// declara QUÉ emuladores necesita, y se pregunta por cada uno.
const EMULADORES = {
  firestore: Number(process.env.EMU_PORT || 8080),
  auth:      Number(process.env.EMU_AUTH_PORT || 9099),
  storage:   Number(process.env.EMU_STOR_PORT || 9199),
};
const NECESITAN_EMULADOR = new Map([
  ['prueba-cierre-emulador.cjs',             ['firestore', 'auth']],
  ['prueba-reglas-nomina-subcoleccion.cjs',  ['firestore', 'auth']],
  ['prueba-reglas-dependencia-captura.cjs',  ['firestore', 'auth', 'storage']],
  ['prueba-reglas-evidencia.cjs',            ['firestore', 'auth']],
  ['prueba-reglas-extraordinarias.cjs',      ['firestore', 'auth']],
  ['prueba-migracion-ata-la-partida.cjs',    ['firestore']],
  ['prueba-prefijo-organizacion.cjs',        ['firestore', 'auth']],
  ['prueba-aislamiento-de-usuarios.cjs',     ['firestore', 'auth']],
]);

// ¿Está escuchando ese puerto?
//
// Se pregunta CON PLAZO PROPIO: un `net.connect` a un puerto que no contesta
// espera a que se aburra el sistema operativo, y entonces el corredor tendría
// el mismo defecto que vino a detectar.
//
// Y se pregunta antes de correr, no después: si el puerto no contesta, de ese
// banco no hay nada que clasificar. Lo que NO se hace es atribuirle al emulador
// un fallo con el emulador ARRIBA — el 2026-09-24 eso escondió un
// ReferenceError real, la prueba reventaba con los emuladores vivos y el
// resumen decía «sin emulador». Si el puerto responde, una prueba que falla
// está ROJA y se dice ROJA.
const contesta = (puerto) => spawnSync(process.execPath, ['-e', `
  const net = require('net');
  const s = net.connect(${puerto}, '127.0.0.1');
  s.on('connect', () => { s.end(); process.exit(0); });
  s.on('error', () => process.exit(1));
  setTimeout(() => process.exit(1), 1500);
`]).status === 0;

// Se pregunta una vez por puerto y no una vez por banco: ocho bancos de reglas
// serían veintitantas sondas, y el estado de un puerto no cambia a media suite.
const vivos = new Map();
const estáVivo = (nombre) => {
  if (!vivos.has(nombre)) vivos.set(nombre, contesta(EMULADORES[nombre]));
  return vivos.get(nombre);
};
// Los que le faltan a este banco, por su nombre. El NOMBRE es el punto: «sin
// emulador» a secas es lo que mandó a levantar `--only firestore,auth` tres
// veces seguidas sin que nadie se enterara de que faltaba Storage.
const faltanA = (f) => (NECESITAN_EMULADOR.get(f) || []).filter(e => !estáVivo(e));

// ── El reloj con el que se juzga ────────────────────────────────────────────
//
// La suite entera afirma sobre un producto mexicano: semanas ISO de captura,
// cierres de nómina, "hace 7 días sin captura". Y `semanaISO` resuelve una
// marca de tiempo completa por su DÍA LOCAL, que es lo correcto —un instante
// designa un instante— pero local es local de la máquina que corre.
//
// El 2026-10-10, con la laptop en Europe/Madrid, la suite dio 52 verdes y UN
// rojo: `2026-08-03T01:00:00Z` es domingo 2 a las 19:00 en México y lunes 3 a
// las 03:00 en Madrid, así que la misma prueba sin cambiar una letra decía 31
// en un sitio y 32 en el otro. Eso no es una prueba roja: es una suite cuyo
// veredicto dependía de en qué país estaba abierta la computadora, que es la
// forma más cara de "falla y luego pasa".
//
// Se fija aquí y no en el banco que falló porque el que falló fue el único que
// tenía una marca de tiempo con hora; los demás usan la forma de diez letras y
// hoy no se enteran. Esperar a que se enteren de uno en uno es volver a buscar
// el defecto cada vez que alguien viaje.
//
// Lo que ESTO NO ARREGLA, y queda anotado en PENDIENTES #61: un teléfono fuera
// de México sigue archivando su foto en la semana de su propio día local. Aquí
// se hizo determinista la medición, no se cambió la conducta.
//
// ACTUALIZADO el 2026-10-11: fijarlo AQUÍ tampoco alcanzaba. El corredor es una
// de las dos formas de correr un banco; la otra es a mano, que es justo como se
// trabaja mientras se arregla algo, y ésa no pasaba por este renglón. Con la
// laptop en Madrid, `prueba-series-sincronizadas` daba verde por `npm test` y
// ROJO por `node scripts/…`: el mismo código, dos veredictos, según cómo lo
// invocaras. Ahora el huso lo fija `reloj.cjs` desde el preámbulo que los 55
// bancos ya cargan, y de ahí sale también esta constante — la zona es UNA
// decisión y no se teclea en dos archivos. Lo de abajo se queda porque los
// subprocesos heredan el entorno y porque el aviso vale: una suite verde en
// Madrid no significa que la máquina de Madrid mida igual.
const { ZONA, AMBIENTE } = require('./reloj.cjs');
const entorno = { ...process.env, TZ: ZONA };
console.log(`reloj de la suite: TZ=${ZONA}` +
  (AMBIENTE !== ZONA
    ? `  (la máquina está en ${AMBIENTE}; se ignora a propósito)` : ''));

// ── EL PLAZO: UN BANCO QUE NO TERMINA NO ES UN BANCO QUE PASA ──────────────
//
// Los bancos corren en serie, así que uno que no vuelve no tarda la suite: la
// para para siempre. Y colgarse es exactamente lo que hace un banco apuntado a
// un puerto que no contesta — un `net.connect` sin plazo espera hasta que el
// sistema operativo se aburra, y en macOS eso son más de 75 segundos por
// intento; con reintentos, nunca. Lo que ve quien corrió `npm test` es una
// terminal quieta, y lo que hace es matarla con ^C: la suite no dijo ni verde
// ni rojo, y el silencio se interpretó como «estaba tardando».
//
// Un banco que se pasa del plazo NO es verde ni rojo: es el tercer estado. No
// se comprobó la conducta, se comprobó que no contesta. Se cuenta con las que
// no arrancaron —que es lo que es— y la suite sale con 1.
//
// El plazo es generoso a propósito: los bancos de reglas levantan sesiones
// contra el emulador y `prueba-puente-color` arranca un Chrome. Se puede subir
// con `PLAZO_BANCO` cuando haga falta, pero no desactivar: un plazo que se
// puede quitar con una variable vacía es el defecto otra vez.
const PLAZO_BANCO = Math.max(10_000, Number(process.env.PLAZO_BANCO) || 240_000);

// ── EL RELOJ CON EL QUE SE MIDE LA ESPERA ──────────────────────────────────
//
// `Date.now()` es reloj de pared: cuenta el tiempo que la máquina pasó
// suspendida. El plazo del `spawnSync` no, así que las dos cifras pueden
// contradecirse — y cuando lo hacen, la del reloj es la que miente.
//
// El 2026-11-05 la suite salió con cuatro bancos «sin contestar en 901 s»
// teniendo un plazo de 240: imposible, porque a los 240 el banco ya estaba
// muerto. La máquina se durmió cruzando la medianoche. Las corridas de antes y
// de después salieron 85/85, y una de las cuatro ni lanza subprocesos ni toca
// la red —sólo recorre un AST—, o sea que no había nada que esperar.
//
// Importa porque el número manda a un sitio distinto: 901 s dice «súbele el
// plazo o arregla ese banco», y la verdad era «repítela con la máquina
// despierta». Media tarde de diferencia.
//
// Un rebase legítimo del reloj es chico: matar el proceso y recoger su salida
// costó 12 ms sobre un plazo de 1200 en la medición del 2026-11-05. El margen
// es multiplicativo con un piso, porque un plazo de 10 s y uno de 240 no
// toleran lo mismo en términos absolutos.
const relojCreible = (plazo, tardó) => tardó <= plazo * 1.25 + 10_000;

// Lo que se publica de una colgada. No es cosmético: cuando el reloj saltó, lo
// que NO se puede decir es un número de segundos, porque no se esperó eso.
const frasePorNoContestar = (plazo, tardó) => relojCreible(plazo, tardó)
  ? `sin contestar en ${Math.round(tardó / 1000)} s`
  : `no se pudo medir · el reloj saltó ${Math.round(tardó / 1000)} s ` +
    `sobre un plazo de ${Math.round(plazo / 1000)} s`;

// Cómo se nombra un banco en el informe: sin el `prueba-` ni el `.cjs`, que
// son ruido repetido en 118 renglones.
const corto = (f) => f.replace(/^prueba-|\.cjs$/g, '');

// ── EL BARRIDO DE FECHAS: VERDE HOY NO ES VERDE ────────────────────────────
//
// Una suite verde dice «la conducta se sostiene». Lo que no dice es CUÁNDO, y
// buena parte de esta suite siembra sus datos contándolos desde hoy: «hace 45
// días», «la semana pasada», «el año en curso». Un dato así no es un dato: es
// una función del día en que se corre.
//
// El 2026-11-12 se midió la suite entera con el reloj congelado en 2027-02-15
// y salieron CUATRO bancos en rojo y DOS sin arrancar, con el mismo código que
// esa misma mañana había dado 118 verdes. Ninguno de los cuatro tenía un
// defecto de producto: tres sembraban una hoja de Gastos Pendientes que GP no
// puede mandar —semanas detalladas de un año ya cerrado (#136)— y uno
// serializaba un instante local como día UTC, que es el #61 dentro del
// instrumento que lo vigila. El quinto, en cambio, SÍ era producto: `hace 12
// días → 13`, y es el #137.
//
// Eso es lo que este barrido compra: la diferencia entre «se nos rompe la
// suite el 1 de enero» —que se descubre el 1 de enero, en caliente, sin saber
// si lo roto es la prueba o el producto— y «este banco caduca», hoy, con el
// banco nombrado.
//
// Cómo: se repiten los bancos que ya salieron en VERDE, cada uno con
// `fecha-falsa.cjs` precargado. Sólo los verdes, porque de uno que ya está
// rojo no hay nada que re-medir: lo que hay que arreglar ya se dijo.
//
// La fecha se DERIVA, no se teclea: 15 de febrero del año que viene. Se deriva
// porque una fecha fija escrita en el archivo deja de ser futuro sin que nadie
// se entere, y el barrido se volvería un segundo «hoy». Y es ese día y no otro
// por dos razones: cae en el año SIGUIENTE —así cruza la frontera de año, que
// es donde vive la clase entera de defectos del #136 y del #47— y cae en
// febrero, lejos de la pared de enero, donde una obra tiene estructuralmente
// menos de cuatro semanas detallables y un banco honesto no puede afirmar lo
// mismo.
const fechaDeBarrido = (hoy = new Date()) => `${hoy.getFullYear() + 1}-02-15`;

// El módulo que adelanta el reloj. Va por `--require` y NO por una variable de
// entorno a secas: `fecha-falsa.cjs` revienta si no hay `FECHA_FALSA`, pero
// `FECHA_FALSA=… node banco.cjs` sin precargarlo no hace nada — y no hace nada
// EN SILENCIO, con la suite en verde, que es la forma de barrido más caro que
// hay: el que certifica que no hay nada.
const RUTA_FECHA_FALSA = path.join(dir, 'fecha-falsa.cjs');

// ── LOS QUE NO SE PUEDEN BARRER, CON SU RAZÓN ESCRITA ──────────────────────
//
// Esta tabla es la parte peligrosa del barrido. Un banco que falla con el
// reloj adelantado porque tiene un defecto se ARREGLA; si se mete aquí, la
// puerta nueva certifica una mentira y encima la certifica para siempre. Así
// que aquí entra sólo lo que el INSTRUMENTO no alcanza, y entra con la razón
// escrita en una línea que se publica en cada corrida: una exclusión que no se
// ve es una exclusión que nadie vuelve a discutir.
//
// Los dos primeros comparan el «ahora» del proceso contra una marca de tiempo
// que escribió el EMULADOR, y `fecha-falsa.cjs` congela el reloj de este
// proceso, no el del emulador. Con el reloj adelantado un año, todo lo que el
// emulador escriba queda un año en el pasado, y el banco mide esa distancia.
// No es un defecto suyo: es que no hay un solo reloj que adelantar.
const NO_SE_BARREN = new Map([
  ['prueba-canal-que-avisa.cjs',
    'compara contra marcas que escribe el emulador, cuyo reloj no se congela'],
  ['prueba-mensaje-de-permiso.cjs',
    'igual: la marca la pone el emulador, no este proceso'],
  ['prueba-corredor-no-se-cuelga.cjs',
    'corre este corredor dentro de un taller; barrerlo es barrer el barrido'],
]);

// Una sola perilla, `BARRIDO`. Sin ella, el barrido va con la fecha derivada:
// una puerta que hay que acordarse de abrir está cerrada.
const BARRIDO = (process.env.BARRIDO || '').trim();
const esFecha = /^\d{4}-\d{2}-\d{2}$/.test(BARRIDO);
if (BARRIDO && !esFecha && !/^(no|0|off)$/i.test(BARRIDO)) {
  // Lo que NO se hace es caer al valor por omisión: un `BARRIDO=si` que se
  // interpreta como «la fecha derivada» y un `BARRIDO=2027-2-15` que se
  // interpreta igual son la misma perilla diciendo que entendió algo distinto
  // de lo que se le pidió.
  console.log(`BARRIDO="${BARRIDO}" no se entiende. Es "no", o una fecha AAAA-MM-DD.`);
  process.exit(NO_ARRANCO);
}

// Por qué NO se barre, cuando no se barre. Siempre hay una frase: el barrido
// se puede omitir, pero no en silencio.
const sinBarridoPorque =
  /^(no|0|off)$/i.test(BARRIDO) ? 'apagado a mano con BARRIDO=no'
  : filtro ? `la corrida está filtrada por "${filtro}", y el barrido es de la suite entera`
  : !fs.existsSync(RUTA_FECHA_FALSA)
    ? `falta scripts/${path.basename(RUTA_FECHA_FALSA)}, que es con lo que se adelanta el reloj`
    : null;
const FECHA_BARRIDO = sinBarridoPorque ? null : (esFecha ? BARRIDO : fechaDeBarrido());
// Querer barrer y no poder no es lo mismo que no querer: si el módulo no está,
// la suite entera queda sin medir en el tiempo y eso sale con 1.
const faltaElReloj = !/^(no|0|off)$/i.test(BARRIDO) && !filtro
  && !fs.existsSync(RUTA_FECHA_FALSA);

// Una exclusión que nombra un archivo que ya no existe es un agujero: el banco
// se renombró y ahora se barre sin que nadie lo decidiera, o desapareció y la
// razón quedó de adorno. Las dos cosas se denuncian y paran la suite, porque
// la tabla de arriba sólo vale si alguien la mantiene.
//
// Se revisa sólo cuando el barrido corre de verdad. La tabla es parte del
// barrido: en una corrida sin barrido no se usó, y un veredicto sobre ella
// sería un veredicto sobre algo que no se midió.
const exclusionesFantasma = !FECHA_BARRIDO ? []
  : [...NO_SE_BARREN.keys()].filter(f => !fs.existsSync(path.join(dir, f)));

const verdes = [], rojas = [], mudas = [], sinEmulador = [], colgadas = [], caducas = [];

for (const f of archivos) {
  // Si le falta un emulador, NO SE CORRE. Antes se corría y se clasificaba
  // después, y el resultado era el de arriba: cuatro minutos de reintentos
  // contra un puerto muerto para acabar en la misma casilla. Lo que se gana no
  // es tiempo, es que el informe nombre el puerto en vez de publicar una
  // colgada que manda a buscar un banco lento.
  const faltan = faltanA(f);
  if (faltan.length > 0) {
    sinEmulador.push([f, faltan]);
    console.log(`${'sin emulador'.padEnd(12)} ${corto(f).padEnd(34)} ` +
      `falta ${faltan.join(', ')}`);
    continue;
  }

  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], {
    encoding: 'utf8', cwd: path.join(dir, '..'), env: entorno,
    timeout: PLAZO_BANCO, killSignal: 'SIGKILL',
  });
  const tardó = Date.now() - t0;
  const salida = (r.stdout || '') + (r.stderr || '');
  const rojasAqui = (salida.match(/^FALLA/gm) || []).length;

  // `spawnSync` marca el plazo vencido con `error.code === 'ETIMEDOUT'`; la
  // señal sola no basta, porque un banco también puede morir por SIGKILL del
  // sistema (sin memoria, por ejemplo) y eso no es lo mismo.
  const seColgó = r.error && r.error.code === 'ETIMEDOUT';

  let estado;
  if (seColgó) { estado = 'SE COLGÓ'; colgadas.push([f, tardó, salida]); }
  else if (r.status === 0) { estado = 'verde'; verdes.push(f); }
  else if (r.status === NO_ARRANCO) { estado = 'NO ARRANCÓ'; mudas.push([f, salida]); }
  else { estado = 'ROJO'; rojas.push([f, salida, rojasAqui]); }

  const detalle = seColgó
    ? frasePorNoContestar(PLAZO_BANCO, tardó)
    : (rojasAqui > 0 ? `${rojasAqui} comprobación(es)` : '');
  console.log(`${estado.padEnd(12)} ${corto(f).padEnd(34)} ${detalle}`);
}

// ── LA SEGUNDA PASADA, CON EL RELOJ ADELANTADO ─────────────────────────────
if (FECHA_BARRIDO) {
  console.log(`\nbarrido de fechas: los ${verdes.length} en verde, otra vez, ` +
    `con el reloj en ${FECHA_BARRIDO}`);
  // Las exclusiones se publican ANTES de la pasada y salgan o no en el
  // recorrido, para que se vean también cuando el banco excluido ya venía rojo.
  for (const [f, razón] of NO_SE_BARREN)
    if (!exclusionesFantasma.includes(f))
      console.log(`${'no se barre'.padEnd(12)} ${corto(f).padEnd(34)} ${razón}`);

  for (const f of verdes) {
    if (NO_SE_BARREN.has(f)) continue;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['--require', RUTA_FECHA_FALSA, path.join(dir, f)], {
      encoding: 'utf8', cwd: path.join(dir, '..'),
      env: { ...entorno, FECHA_FALSA: FECHA_BARRIDO },
      timeout: PLAZO_BANCO, killSignal: 'SIGKILL',
    });
    const tardó = Date.now() - t0;
    const salida = (r.stdout || '') + (r.stderr || '');
    const seColgó = r.error && r.error.code === 'ETIMEDOUT';
    if (!seColgó && r.status === 0) continue;  // sigue en verde: no se publica

    // Un banco que no arranca con el reloj adelantado también caduca: no se
    // comprobó la conducta, y la causa es la fecha. Se cuenta igual que un
    // rojo, porque la razón de ser de esta pasada es que no haya puntos ciegos
    // con fecha de vencimiento.
    const causa = seColgó ? frasePorNoContestar(PLAZO_BANCO, tardó)
      : r.status === NO_ARRANCO ? 'no arranca con el reloj adelantado'
      : `${(salida.match(/^FALLA/gm) || []).length} comprobación(es)`;
    caducas.push([f, causa, salida]);
    console.log(`${'CADUCA'.padEnd(12)} ${corto(f).padEnd(34)} ${causa}`);
  }
  if (caducas.length === 0)
    console.log('ninguno caduca: lo verde de hoy sigue verde el ' + FECHA_BARRIDO);
} else {
  // Nunca callado. Una corrida sin barrido midió la mitad de lo que mide una
  // con barrido, y quien la lea tiene que saber cuál de las dos leyó.
  console.log(`\nSIN barrido de fechas: ${sinBarridoPorque}.`);
  if (filtro) console.log('Para la puerta completa, `npm test` sin filtro.');
}

console.log('');
console.log(`${verdes.length} en verde · ${rojas.length} en rojo · ` +
            `${mudas.length} sin arrancar · ${colgadas.length} colgada(s) · ` +
            `${sinEmulador.length} sin emulador · ` +
            `${caducas.length} que caduca(n) ` +
            `(de ${archivos.length})`);

for (const [f, tardó, salida] of colgadas) {
  console.log(`\n──────── ${f}: ${frasePorNoContestar(PLAZO_BANCO, tardó)} ────────`);
  console.log('Se le dio muerte. No se comprobó nada: no es verde ni rojo.');
  if (!relojCreible(PLAZO_BANCO, tardó)) {
    // El consejo de abajo mandaría a buscar un banco lento que no existe.
    console.log('Y el reloj no cuadra con el plazo, así que esta medición NO vale:');
    console.log('el banco murió al vencer el plazo, no a los segundos que dice el');
    console.log('reloj de pared. Lo que pasó es que la máquina se suspendió a mitad');
    console.log('de la corrida. Repítela despierta —`caffeinate -i npm test`— antes');
    console.log('de tocar este banco: lo más probable es que no tenga nada.');
  } else {
    console.log('Suele ser una conexión a un puerto que no contesta — un emulador');
    console.log('caído, o un puerto cambiado— sin plazo propio. El banco debería');
    console.log('ponerle plazo a lo que espera y salir 2 si no llega.');
  }
  const cola = salida.trim().split('\n').slice(-8).join('\n');
  if (cola) console.log('\nLo último que alcanzó a decir:\n' + cola);
}
for (const [f, salida] of mudas) {
  console.log(`\n──────── ${f} no arrancó ────────`);
  console.log(salida.trim());
}
// De un rojo se publica el renglón `FALLA` Y LO QUE VENGA SANGRADO DEBAJO, que
// es donde los bancos ponen qué esperaban y qué midieron.
//
// Antes se publicaba sólo el renglón. El 2026-11-06 la suite sacó un rojo en
// `prueba-corredor-no-se-cuelga` que no volvió a aparecer ni corriéndolo solo
// ni cuatro veces en paralelo, y el número que lo habría explicado —el resumen
// que el banco sí había medido e impreso— lo había tirado esta línea. Un fallo
// que no se reproduce y cuya medición se descartó no se puede clasificar: no
// se sabe si fue la máquina o el banco, y «se arregla volviendo a correr» es
// exactamente la costumbre que convierte un defecto en ruido tolerado.
//
// El sangrado es el criterio porque es el que ya usan los bancos sin haberlo
// acordado (`esperaba:` / `obtuvo:`), y porque corta solo: el siguiente
// renglón sin sangrar vuelve a ser salida normal y no se arrastra el archivo
// entero hasta el informe.
for (const [f, salida] of rojas) {
  console.log(`\n──────── ${f} en rojo ────────`);
  console.log((salida.match(/^FALLA.*(?:\n[ \t]+.*)*$/gm) || [salida.trim()]).join('\n'));
}
if (sinEmulador.length > 0) {
  // El comando lleva TODOS los emuladores que la suite necesita, no sólo los
  // que faltan hoy. Este renglón decía `--only firestore,auth` fijo, y eso es
  // literalmente lo que se tecleó tres veces el 2026-11-06 dejando Storage
  // caído: el consejo del informe era la causa del punto ciego. Se arma de la
  // tabla de arriba, así que un banco nuevo que pida un emulador nuevo lo
  // agrega aquí sin que nadie se acuerde de venir a editar la cadena.
  const todos = [...new Set([...NECESITAN_EMULADOR.values()].flat())];
  const faltantes = [...new Set(sinEmulador.flatMap(([, q]) => q))];
  console.log(`\nLas ${sinEmulador.length} de "sin emulador" no se comprobaron: ` +
    `no contesta ${faltantes.join(', ')}.`);
  console.log('Levántalos JUNTOS —uno a medias deja el puerto tomado— y repite:');
  console.log('  export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"');
  console.log(`  firebase emulators:start --only ${todos.join(',')} --project campo-fosmon-prueba`);
}

for (const [f, causa, salida] of caducas) {
  console.log(`\n──────── ${f} caduca · con el reloj en ${FECHA_BARRIDO}: ${causa} ────────`);
  console.log('Hoy está en verde. Eso no lo salva: lo que se midió es que su');
  console.log('veredicto depende del día en que se corra, y ese día llega.');
  console.log('Casi siempre es el fixture —un dato sembrado contando desde hoy, que');
  console.log('en esa fecha ya no es el dato que el producto puede recibir—, pero a');
  console.log('veces es el producto, y de cuál de los dos es no se puede decidir sin');
  console.log('mirar. Lo que NO se hace es mover la fecha del barrido.');
  const falla = (salida.match(/^FALLA.*(?:\n[ \t]+.*)*$/gm) || []).join('\n');
  const cola = falla || salida.trim().split('\n').slice(-8).join('\n');
  if (cola) console.log('\n' + cola);
  console.log(`\nPara repetirlo solo:\n  FECHA_FALSA=${FECHA_BARRIDO} node --require ` +
    `scripts/${path.basename(RUTA_FECHA_FALSA)} scripts/${f}`);
}
if (exclusionesFantasma.length > 0) {
  console.log(`\nLa tabla de exclusiones del barrido nombra ${exclusionesFantasma.length} ` +
    `archivo(s) que no existe(n):`);
  for (const f of exclusionesFantasma) console.log(`  ${f}`);
  console.log('Si el banco se renombró, ahora se está barriendo sin que nadie lo');
  console.log('decidiera; si desapareció, la razón quedó escrita de adorno. En los');
  console.log('dos casos la exclusión ya no dice la verdad, así que esto sale con 1:');
  console.log('una lista de excepciones que nadie mantiene es una puerta sin llave.');
}
if (faltaElReloj) {
  console.log(`\nNo se pudo barrer: falta scripts/${path.basename(RUTA_FECHA_FALSA)}.`);
  console.log('La suite dice qué se sostiene hoy y nada sobre mañana, que es la mitad');
  console.log('de lo que esta puerta promete. Sale con 1: "no se pudo medir" no es');
  console.log('verde. Si de verdad se quiere sin barrido, se pide: BARRIDO=no.');
}

process.exit(rojas.length + mudas.length + colgadas.length + caducas.length
  + exclusionesFantasma.length + (faltaElReloj ? 1 : 0) > 0 ? 1 : 0);
