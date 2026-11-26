#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// UN BANCO QUE NO CONTESTA NO PARA LA SUITE — PENDIENTES #44
// ════════════════════════════════════════════════════════════════════════════
//
// Los bancos corren en serie. Uno que no vuelve no retrasa la suite: la deja
// quieta para siempre, y lo que hace quien la lanzó es matarla con ^C. Esa
// corrida no dijo ni verde ni rojo, y el silencio se lee como «estaba
// tardando». Es el P4 por el peor lado: ni siquiera hay un código de salida
// que clasificar.
//
// El caso que lo abrió es concreto: un banco apuntado a un puerto que no
// contesta. `net.connect` sin plazo espera a que se aburra el sistema
// operativo —más de 75 s en macOS— y con reintentos no se aburre nunca.
//
// QUÉ SE AFIRMA AQUÍ, y por qué no se puede afirmar leyendo el corredor:
//
// Mirar que `pruebas.cjs` contenga la palabra `timeout` sería afirmar que un
// símbolo existe. Lo que importa es la CONDUCTA: que puesto delante de un
// banco que no vuelve, el corredor TERMINE, lo cuente como no comprobado, y
// salga con 1. Así que se le construye esa situación: un directorio temporal
// con el corredor de verdad —copiado, no imitado— y tres bancos de mentira,
// uno que se cuelga, uno verde y uno rojo. Los dos últimos están para que el
// plazo no se pueda «cumplir» matándolo todo.
//
// Y este banco se pone a sí mismo un plazo sobre el corredor. Si el corredor
// no vuelve, lo que NO puede pasar es que este banco se cuelgue también: eso
// sería el mismo defecto una planta más arriba. Se mata y se dice ROJO.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, NO_ARRANCO } = require('./no-arranco.cjs');

vigilarExcepciones('el corredor de la suite');

const DIR = __dirname;

// Los talleres corren COPIAS del corredor en directorios temporales, y el
// corredor PARSEA los bancos para revisar la tabla de emuladores. Un temporal
// no tiene `node_modules`, así que sin esto el corredor copiado sale 2 —«no
// puedo revisar la tabla sin @babel/parser»— y los talleres medirían eso en vez
// de lo que vinieron a medir. Es darle al corredor copiado la misma resolución
// de módulos que tiene en el repositorio, nada más. Va en UN sitio: pegado a
// mano en los seis spawns se desincroniza en cuanto el corredor estrene otra
// dependencia, y se desincroniza hacia el no-veredicto.
const ENTORNO_BASE = {
  PATH: process.env.PATH, HOME: process.env.HOME,
  NODE_PATH: path.join(DIR, '..', 'node_modules'),
};

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
//
// Va PRIMERO porque una prueba que nunca ha estado roja no ha demostrado nada.
// Se rompe el corredor de seis maneras distintas, cada una en una copia, y se
// exige que esta misma prueba lo vea: salida 1 y al menos una FALLA. Las
// roturas son SEMÁNTICAS —quitar el plazo, contar la colgada como verde,
// borrarla del resumen— y no andamiaje: romper un `require` daría salida 2,
// que es otra cosa.
if (process.argv.includes('--contraprueba')) {
  const { spawnSync: correr } = require('child_process');
  // Cada mutación dice de qué módulo es. Antes todas eran de `pruebas.cjs` y el
  // módulo iba implícito; el criterio del reloj se mudó a `no-arranco.cjs` —para
  // que los bancos y el corredor no tengan dos cuentas del mismo número— y una
  // contraprueba que sólo sabe mutar un archivo deja sin medir justo el que
  // cambió de sitio. El cuarto elemento es el módulo, y `pruebas.cjs` por omisión.
  const fuentes = new Map();
  const fuenteDe = (m) => {
    if (!fuentes.has(m)) fuentes.set(m, fs.readFileSync(path.join(DIR, m), 'utf8'));
    return fuentes.get(m);
  };
  const MUTACIONES = [
    ['quitarle el plazo al spawn (el defecto original)',
      /timeout: PLAZO_BANCO,/, ''],
    // Ancla movida el 2026-11-25, por lo mismo que la de «no contar las
    // caducas»: la puerta pasó de expresión dentro del `process.exit` a la
    // función `codigoDeSalida`. Ver el comentario de allá.
    ['no contar las colgadas al salir',
      /const enRojo = rojas \+ mudas \+ colgadas/, 'const enRojo = rojas + mudas'],
    ['contar la colgada como verde',
      /if \(seColgó\) \{ estado = 'SE COLGÓ'; colgadas\.push\(\[f, tardó, salida\]\); \}/,
      `if (seColgó) { estado = 'verde'; verdes.push(f); }`],
    ['borrar las colgadas del resumen',
      /`\$\{mudas\.length\} sin arrancar · \$\{colgadas\.length\} colgada\(s\) · ` \+\n            /,
      '`${mudas.length} sin arrancar · ` +\n            '],
    ['quitarle el suelo al plazo',
      /Math\.max\(10_000, Number\(process\.env\.PLAZO_BANCO\) \|\| 240_000\)/,
      'Number(process.env.PLAZO_BANCO) || 240_000'],
    // Mudada a `no-arranco.cjs` con el resto del criterio del reloj. El ancla se
    // quedó apuntando a `pruebas.cjs` y la contraprueba lo cantó —«Sólo 35 de
    // 36»— en vez de contar 36 sobre una que no se aplicó: es el precedente del
    // #140, un ancla que deja de apuntar no mide y no avisa.
    ['callar cuánto esperó',
      /\? `sin contestar en \$\{Math\.round\(tardó \/ 1000\)\} s`\n/,
      "? 'no contestó'\n", 'no-arranco.cjs'],
    // El defecto del reloj, exacto: creerle al reloj de pared contra el plazo.
    // Vive en `no-arranco.cjs` desde el #142, y el corredor lo toma de ahí: si
    // se mutara la copia del corredor no habría nada que mutar, y la mutación
    // saldría NO LA VE sin que nada esté roto.
    ['creerle al reloj aunque contradiga al plazo',
      /const relojCreible = \(plazo, tardó\) => tardó <= plazo \* 1\.25 \+ 10_000;/,
      'const relojCreible = (plazo, tardó) => true;', 'no-arranco.cjs'],
    // Y el otro lado: desconfiar de todo deja a las colgadas de verdad sin su
    // número, que es el dato con el que se decide si subir el plazo.
    ['desconfiar del reloj siempre, hasta de una colgada de verdad',
      /const relojCreible = \(plazo, tardó\) => tardó <= plazo \* 1\.25 \+ 10_000;/,
      'const relojCreible = (plazo, tardó) => false;', 'no-arranco.cjs'],
    // Tirar la medición de un rojo y dejar sólo el titular: el estado exacto
    // en el que un fallo irreproducible dejó de poder clasificarse.
    ['publicar el titular del rojo y tirar lo que midió',
      /\/\^FALLA\.\*\(\?:\\n\[ \\t\]\+\.\*\)\*\$\/gm/, '/^FALLA.*$/gm'],
    // Y por el otro lado: vaciar el informe entero de un rojo.
    ['no publicar nada de lo que dijo el rojo',
      /console\.log\(\(salida\.match\(\/\^FALLA[\s\S]*?\.join\('\\n'\)\);/,
      "console.log('(en rojo)');"],
    // El defecto del 2026-11-06: preguntar por un puerto y clasificar como si
    // se hubiera preguntado por todos.
    ['preguntar sólo por Firestore y correr el banco igual',
      /const faltan = faltanA\(f\);/, 'const faltan = [];'],
    // El mismo defecto por la tabla: olvidar que ese banco habla con Storage.
    // El ancla tolera el espaciado: la tabla se realineó el 2026-11-12 al pasar
    // de 8 entradas a 16, y un ancla con los espacios contados dejó de empatar
    // — o sea, dejó de medir, en silencio y hacia el verde.
    ['olvidar que un banco necesita Storage',
      /\['prueba-reglas-dependencia-captura\.cjs',\s*\['firestore', 'auth', 'storage'\]\],/,
      `['prueba-reglas-dependencia-captura.cjs', ['firestore', 'auth']],`],
    // Clasificarlo bien y correrlo de todos modos: el informe diría la verdad y
    // la terminal se quedaría quieta igual.
    ['clasificarlo sin emulador y correrlo de todos modos',
      /`falta \$\{faltan\.join\(', '\)\}`\);\n    continue;/,
      "`falta ${faltan.join(', ')}`);"],
    // Y el consejo fijo, que es lo que mandó a levantar lo que ya estaba vivo.
    ['el consejo vuelve a nombrar sólo firestore,auth',
      /--only \$\{todos\.join\(','\)\}/, '--only firestore,auth'],

    // ── La revisión de la tabla de emuladores ─────────────────────────────
    // Ocho de las roturas que siguen dejan la tabla sin revisar por un lado
    // distinto. Van separadas porque el estado anterior —ninguna revisión— era
    // el agujero por los cinco lados a la vez, y arreglar uno no dice nada de
    // los otros cuatro.
    ['no revisar la tabla de emuladores en absoluto',
      /if \(!hablaConElEmulador\(llamadas\)\) continue;/, 'continue;'],
    // Ésta es la que se escapó: medir el TEXTO en vez del código. La rotura es
    // literalmente la primera versión de la puerta, y sólo se ve con la
    // comprobación que mira el repositorio de verdad — en los bancos de mentira
    // del taller las dos formas dan lo mismo.
    ['buscar los nombres en el texto en vez de las llamadas en el código',
      /if \(!hablaConElEmulador\(llamadas\)\) continue;/,
      'if (!/connect(?:Firestore|Auth|Storage)Emulator\\(|emulador-limpio\\.cjs' +
      '|reglas-del-repo\\.cjs/.test(src)) continue;'],
    ['dar por bueno el banco cuyo código no se puede leer',
      /sinDeclarar\.push\(\[f, `no se puede leer su código para saber si habla con ` \+\n\s*`el emulador: \$\{e\.message\}`\]\);/,
      ''],
    ['seguir sin el parser como si se hubiera revisado algo',
      /process\.exit\(2\);\n\}\n\n\/\/ Llamadas REALES/, '\n}\n\n// Llamadas REALES'],
    ['revisar sólo los bancos de la corrida filtrada',
      /for \(const f of todosLosBancos\) \{/, 'for (const f of archivos) {'],
    ['darle por buena la tabla al banco que no está en ella',
      /const enTabla = NECESITAN_EMULADOR\.get\(f\);/,
      `const enTabla = NECESITAN_EMULADOR.get(f) || ['firestore', 'auth'];`],
    ['dar por pedidos los puertos que el banco no pide',
      /const declara = puertosQueDeclara\(src\);/,
      'const declara = puertosQueDeclara(src) || enTabla;'],
    ['tolerar que la tabla y el banco digan cosas distintas',
      /juego\(declara\) !== juego\(enTabla\)/, 'false'],
    ['tolerar un emulador con un nombre que el corredor no conoce',
      /\.filter\(n => !\(n in EMULADORES\)\)/, '.filter(() => false)'],
    ['olvidar uno de los dos disparadores: el ayudante que limpia',
      /'require:\.\/emulador-limpio\.cjs', /, ''],
    ['denunciar callando: no publicar cuál banco es',
      /for \(const \[f, razón\] of sinDeclarar\) console\.log\(`  \$\{corto\(f\)\}: \$\{razón\}`\);/,
      ''],
    // Ancla movida el 2026-11-25 (misma causa: `codigoDeSalida`).
    ['ver la discrepancia y no contarla al salir',
      /\+ exclusionesFantasma \+ sinDeclarar \+/,
      '+ exclusionesFantasma +'],

    // ── El barrido de fechas ──────────────────────────────────────────────
    // La más importante de todas: `fecha-falsa.cjs` revienta si no hay
    // `FECHA_FALSA`, pero la variable SIN el `--require` no hace nada, y no
    // hace nada en silencio. Un barrido así corre la suite dos veces con el
    // mismo reloj y certifica que no hay nada que caduque.
    ['barrer sin precargar el reloj falso (la variable sola no hace nada)',
      /\['--require', RUTA_FECHA_FALSA, path\.join\(dir, f\)\]/,
      '[path.join(dir, f)]'],
    ['ver la caduca y no contarla',
      /caducas\.push\(\[f, causa, salida\]\);/, ''],
    // Ancla movida el 2026-11-25: la decisión de la puerta dejó de ser una
    // expresión dentro del `process.exit` y pasó a `codigoDeSalida`, para que
    // se pueda ejecutar sin correr la suite entera. La contraprueba lo cantó
    // como RANCIA, que es exactamente para lo que está.
    ['no contar las caducas al salir',
      /colgadas \+ caducas\n/, 'colgadas\n'],
    ['borrar las caducas del resumen',
      /`\$\{caducas\.length\} que caduca\(n\) ` \+\n            /, ''],
    // La tabla de exclusiones, por sus dos lados: no mirarla, y no publicarla.
    ['barrer igual a los que están excluidos',
      /if \(NO_SE_BARREN\.has\(f\)\) continue;/, ''],
    ['callar las exclusiones en el informe',
      /console\.log\(`\$\{'no se barre'\.padEnd\(12\)\} \$\{corto\(f\)\.padEnd\(34\)\} \$\{razón\}`\);/,
      ''],
    ['no denunciar una exclusión que nombra un archivo que no existe',
      /\.filter\(f => !fs\.existsSync\(path\.join\(dir, f\)\)\)/, '.filter(() => false)'],
    // Omitir el barrido está permitido; omitirlo callado, no.
    ['omitir el barrido sin decirlo',
      /console\.log\(`\\nSIN barrido de fechas: \$\{sinBarridoPorque\}\.`\);/, ''],
    // Y la fecha: que deje de ser futuro, y que deje de cruzar el año.
    ['barrer a una fecha ya pasada',
      /`\$\{hoy\.getFullYear\(\) \+ 1\}-02-15`/, '`${hoy.getFullYear() - 1}-02-15`'],
    ['barrer dentro del mismo año, sin cruzar la frontera',
      /`\$\{hoy\.getFullYear\(\) \+ 1\}-02-15`/, '`${hoy.getFullYear()}-12-15`'],
  ];

  let vistas = 0;
  for (const [nombre, busca, pone, modulo = 'pruebas.cjs'] of MUTACIONES) {
    const fuente = fuenteDe(modulo);
    if (!busca.test(fuente)) {
      console.log(`NO LA VE  ${nombre}  ·  el ancla ya no está en ${modulo}`);
      continue;
    }
    const arch = path.join(os.tmpdir(), `corredor-mutado-${Date.now()}-${vistas}.cjs`);
    fs.writeFileSync(arch, fuente.replace(busca, pone));
    const r = correr(process.execPath, [__filename], {
      encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL',
      env: { ...process.env, ARCH_MUTADO: arch, MOD_MUTADO: modulo },
    });
    const vio = r.status === 1 &&
      ((r.stdout || '') + (r.stderr || '')).split('\n').some(l => l.startsWith('FALLA'));
    console.log(`${vio ? 'ROJA     ' : 'NO LA VE '} ${nombre}`);
    if (vio) vistas++;
    try { fs.unlinkSync(arch); } catch {}
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: la prueba no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// El corredor de verdad y sus dos módulos. Si alguno no está, no se midió
// nada: no es rojo.
// `fecha-falsa.cjs` entra aquí porque el corredor ya no sólo corre bancos:
// los repite con el reloj adelantado, y ése es el módulo con el que lo
// adelanta. Sin él en el taller, el corredor de mentira no podría barrer y
// esta prueba mediría un corredor distinto del que corre la suite.
// `emulador-limpio.cjs` entra porque la sección de la tabla de emuladores
// construye bancos de mentira que lo requieren: es uno de los dos ayudantes que
// no sirven para otra cosa que hablar con el emulador, y por eso es uno de los
// disparadores que el corredor busca. Un banco de mentira que lo nombrara en un
// comentario sin requerirlo mediría la expresión regular, no la conducta.
const MODULOS = ['pruebas.cjs', 'no-arranco.cjs', 'reloj.cjs', 'fecha-falsa.cjs',
                 'emulador-limpio.cjs'];
for (const m of MODULOS) {
  try { fs.accessSync(path.join(DIR, m)); }
  catch { sinPrecondicion(`no está scripts/${m}`,
    ['El corredor de la suite y sus dos módulos tienen que existir para',
     'poder ponerlo delante de un banco que no vuelve.']); }
}

// ── El mundo de mentira ─────────────────────────────────────────────────────
const taller = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-corredor-'));
const dentro = path.join(taller, 'scripts');
fs.mkdirSync(dentro);
for (const m of MODULOS) fs.copyFileSync(path.join(DIR, m), path.join(dentro, m));

// El que se cuelga. Imita el caso real —una conexión a un puerto que nadie
// escucha— y además se asegura con un temporizador largo, para que la prueba
// no dependa de cuánto tarda el sistema operativo en rendirse.
fs.writeFileSync(path.join(dentro, 'prueba-puerto-muerto.cjs'), `
const net = require('net');
console.log('conectando a un puerto que no contesta…');
net.connect(1, '10.255.255.1').on('error', () => {});
setTimeout(() => { console.log('esto no se alcanza a imprimir'); }, 600000);
`);
fs.writeFileSync(path.join(dentro, 'prueba-de-mentira-verde.cjs'),
  `console.log(' ok   nada que ver'); process.exit(0);\n`);
// El rojo trae su medición DEBAJO y sangrada, como la traen los bancos de
// verdad. Importa que sea así y no en el mismo renglón: lo que el informe
// tiene que arrastrar hasta arriba es el número, no sólo el titular.
fs.writeFileSync(path.join(dentro, 'prueba-de-mentira-roja.cjs'),
  `console.log('FALLA algo que sí se midió y no se sostiene');
console.log('        esperaba: 2 en verde');
console.log('        obtuvo:   1 en verde · 2 colgada(s)');
console.log('una línea sin sangrar que no es parte de la falla');
process.exit(1);\n`);
// Lenta pero sana: tarda dos segundos y pasa. Existe para la sección del
// suelo, donde se comprueba que un plazo ridículo no la convierte en colgada.
fs.writeFileSync(path.join(dentro, 'prueba-de-mentira-lenta.cjs'),
  `setTimeout(() => { console.log(' ok   tardé lo normal'); process.exit(0); }, 2000);\n`);

// Permite correr contra una copia mutada del corredor o de uno de sus módulos
// (la contraprueba). El módulo viene nombrado en `MOD_MUTADO` porque desde el
// #142 no siempre es `pruebas.cjs`: el criterio del reloj vive en
// `no-arranco.cjs`, y suponer el archivo sería mutar el que no cambió.
const MOD_MUTADO = process.env.MOD_MUTADO || 'pruebas.cjs';
const ponerElMutante = (dir) => {
  if (process.env.ARCH_MUTADO)
    fs.copyFileSync(process.env.ARCH_MUTADO, path.join(dir, MOD_MUTADO));
};
ponerElMutante(dentro);

let fallas = 0, oks = 0;
const ok = (q, d) => { oks++; console.log(` ok   ${q}${d ? `  ·  ${d}` : ''}`); };
const falla = (q, esperado, obtenido) => {
  fallas++;
  console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esperado}`);
  console.log(`        obtuvo:   ${obtenido}`);
};

// ── Se le da al corredor un plazo corto y se le pone delante el colgado ─────
//
// `PLAZO_BANCO` en el suelo (10 s) para que esto tarde segundos y no minutos.
// El plazo de AQUÍ es cuatro veces mayor: si el corredor lo agota, es que no
// tiene plazo propio, que es justo el defecto.
const PLAZO_DEL_BANCO = 10_000;
const PLAZO_DEL_CORREDOR = 40000;

// `BARRIDO=no` en las corridas SIN FILTRO de este taller, y a propósito: lo
// que se mide aquí es la colgada, y el barrido repetiría los bancos verdes con
// el reloj adelantado —segundos de más y renglones de más— sobre un resumen
// cuyas cifras exactas son la afirmación. El barrido tiene su propio taller y
// sus propias secciones más abajo; apagarlo aquí no lo deja sin medir, y el
// corredor lo dice en voz alta en cada una de estas corridas.
const SIN_BARRIDO = { ...ENTORNO_BASE,
                      PLAZO_BANCO: String(PLAZO_DEL_BANCO), BARRIDO: 'no' };

console.log('\n── El corredor, con un banco que no vuelve delante ──');
const t0 = Date.now();
const r = spawnSync(process.execPath, [path.join(dentro, 'pruebas.cjs')], {
  encoding: 'utf8', cwd: taller, killSignal: 'SIGKILL',
  timeout: PLAZO_DEL_CORREDOR, env: SIN_BARRIDO,
});
const tardó = Date.now() - t0;
const salida = (r.stdout || '') + (r.stderr || '');
const seColgóElCorredor = r.error && r.error.code === 'ETIMEDOUT';

// 1. LA afirmación: vuelve.
if (seColgóElCorredor)
  falla('el corredor termina aunque un banco no conteste',
    `que volviera antes de ${PLAZO_DEL_CORREDOR / 1000} s`,
    `seguía esperando a los ${Math.round(tardó / 1000)} s — hubo que matarlo`);
else
  ok('el corredor termina aunque un banco no conteste',
    `volvió en ${(tardó / 1000).toFixed(1)} s`);

// 2. Y no vuelve diciendo que todo está bien.
//
// Se mide con el colgado SOLO, filtrando por su nombre. Con el rojo de mentira
// al lado la salida sería 1 de todos modos y esta comprobación estaría verde
// sin haber mirado nada: el rojo le estaría prestando su código de salida a la
// colgada. Una cuenta por número.
const rSolo = spawnSync(process.execPath,
  [path.join(dentro, 'pruebas.cjs'), 'puerto-muerto'], {
    encoding: 'utf8', cwd: taller, killSignal: 'SIGKILL',
    timeout: PLAZO_DEL_CORREDOR,
    env: { ...ENTORNO_BASE,
           PLAZO_BANCO: String(PLAZO_DEL_BANCO) },
  });
if (rSolo.error && rSolo.error.code === 'ETIMEDOUT')
  falla('una colgada sola basta para que el corredor salga con 1',
    'salida 1', 'no salió: lo matamos');
else if (rSolo.status !== 1)
  falla('una colgada sola basta para que el corredor salga con 1',
    'salida 1', `salida ${rSolo.status} — sin rojos al lado, la colgada no contó`);
else
  ok('una colgada sola basta para que el corredor salga con 1');

// 3. Dice CUÁL se colgó, por su nombre. Un resumen que dice «hubo un
//    problema» sin nombrar el archivo manda a leer 63 bancos.
if (/puerto-muerto/.test(salida) && /COLG/i.test(salida))
  ok('nombra el banco que no contestó');
else
  falla('nombra el banco que no contestó',
    'el nombre del archivo junto a «se colgó»',
    (salida.match(/.*puerto-muerto.*/) || ['(no lo nombró)'])[0].trim());

// 4. No lo cuenta como verde ni como rojo. Las dos mentiras son caras en
//    direcciones distintas: verde esconde el punto ciego, rojo manda a
//    buscar una regresión que nadie midió.
const resumen = (salida.match(/^\d+ en verde .*/m) || [''])[0];
if (/1 colgada/.test(resumen))
  ok('lo cuenta aparte, ni verde ni rojo', resumen.trim());
else
  falla('lo cuenta aparte, ni verde ni rojo',
    'el resumen dice «1 colgada(s)»', resumen.trim() || '(no hubo resumen)');

if (/^2 en verde/.test(resumen))
  ok('los verdes de al lado siguen contándose', resumen.trim());
else
  falla('los verdes de al lado siguen contándose',
    '2 en verde (los dos bancos de mentira que pasan)',
    resumen.trim() || '(no hubo resumen)');

// 5. El plazo no se come a los demás. Si matar al colgado matara también al
//    rojo, el corredor «cumpliría» el plazo perdiendo la medición buena.
if (/1 en rojo/.test(resumen))
  ok('el rojo de al lado sigue siendo rojo', resumen.trim());
else
  falla('el rojo de al lado sigue siendo rojo',
    '1 en rojo', resumen.trim() || '(no hubo resumen)');

// 6. De un rojo publica la MEDICIÓN, no sólo el titular. El 2026-11-06 salió
//    un rojo que no se reprodujo, y el número que lo habría explicado —el
//    banco lo midió y lo imprimió— se había quedado en el informe del
//    corredor. Un fallo irreproducible cuya medición se tiró no se puede
//    clasificar: ni máquina ni banco, y se acaba volviendo a correr hasta que
//    salga verde, que es como un defecto se vuelve ruido tolerado.
const bloqueRojo = (salida.match(/──+ prueba-de-mentira-roja\.cjs en rojo ──+\n([\s\S]*?)(?=\n──|\n*$)/) || ['', ''])[1];
if (/obtuvo:\s+1 en verde · 2 colgada\(s\)/.test(bloqueRojo))
  ok('del rojo publica lo que midió, no sólo el renglón de FALLA',
    (bloqueRojo.match(/obtuvo:.*/) || [''])[0].trim());
else
  falla('del rojo publica lo que midió, no sólo el renglón de FALLA',
    'el renglón «obtuvo:» que el banco imprimió debajo de su FALLA',
    bloqueRojo.trim().split('\n').join(' ⏎ ') || '(no publicó nada)');

// Y corta donde deja de estar sangrado: si arrastrara el archivo entero, el
// informe de una suite con varios rojos sería ilegible y nadie lo leería —
// que es la misma pérdida de la medición, por exceso en vez de por defecto.
if (!/una línea sin sangrar/.test(bloqueRojo))
  ok('y corta donde el banco deja de sangrar, sin arrastrar su salida entera');
else
  falla('y corta donde el banco deja de sangrar, sin arrastrar su salida entera',
    'que la línea sin sangrar quedara fuera', 'se publicó también');

// 7. Y dice cuánto esperó. Sin el número, quien lo lea no sabe si subir el
//    plazo o arreglar el banco.
if (/sin contestar en \d+ s/.test(salida))
  ok('dice cuánto esperó antes de rendirse',
    (salida.match(/sin contestar en \d+ s/) || [''])[0]);
else
  falla('dice cuánto esperó antes de rendirse',
    'el texto «sin contestar en N s»', '(no lo dijo)');

// ── El plazo tiene suelo ────────────────────────────────────────────────────
//
// La otra forma de que el plazo haga daño: que sea demasiado CORTO. Un
// `PLAZO_BANCO=1` tecleado con prisa mataría a todos los bancos sanos y la
// suite saldría entera «colgada» — la misma mentira que esto vino a arreglar,
// girada. Hay un suelo, y se comprueba con un banco que tarda dos segundos y
// pasa: con el interruptor en 1 tiene que seguir saliendo verde.
console.log('\n── Con PLAZO_BANCO=1, que es como se teclea un plazo por error ──');
const r1 = spawnSync(process.execPath, [path.join(dentro, 'pruebas.cjs')], {
  encoding: 'utf8', cwd: taller, killSignal: 'SIGKILL', timeout: 40000,
  env: { ...SIN_BARRIDO, PLAZO_BANCO: '1' },
});
const salida1 = (r1.stdout || '') + (r1.stderr || '');
const resumen1 = (salida1.match(/^\d+ en verde .*/m) || [''])[0];
if (r1.error && r1.error.code === 'ETIMEDOUT')
  falla('un plazo ridículo no mata a los bancos sanos',
    'que el corredor volviera', 'se quedó esperando');
else if (/^2 en verde/.test(resumen1))
  ok('un plazo ridículo no mata a los bancos sanos', resumen1.trim());
else
  falla('un plazo ridículo no mata a los bancos sanos',
    '2 en verde (el suelo del plazo los protege)',
    resumen1.trim() || '(no hubo resumen)');

// ── El reloj con el que mide no puede contradecir al plazo ─────────────────
//
// Las secciones de arriba miden conducta poniéndole bancos delante. Esta no
// puede: para que el reloj de pared se separe del plazo hay que suspender la
// máquina, y eso no se teclea en una prueba. Así que se SACAN las dos cuentas
// del corredor y se EJECUTAN con los números de la corrida real. No se lee el
// archivo buscando palabras: se corre lo que corre la suite.
//
// El caso: el 2026-11-05 salieron cuatro bancos «sin contestar en 901 s» con
// un plazo de 240. Es imposible —a los 240 el banco ya estaba muerto— y el
// número manda al sitio equivocado: 901 s dice «súbele el plazo o arregla ese
// banco», cuando lo que había que hacer era repetirla con la máquina despierta.
console.log('\n── El reloj no puede contradecir al plazo ──');
// Se toma la copia DEL TALLER, no la de `scripts/`. Son el mismo archivo en una
// corrida normal, pero bajo la contraprueba la del taller es la mutada: leer la
// de verdad haría que esta sección saliera verde contra un corredor roto, que es
// la prueba comprobándose contra sí misma.
//
// Desde el #142 las dos cuentas viven en `no-arranco.cjs` y el corredor las toma
// de ahí, para que los 125 bancos y el corredor no puedan tener dos cuentas del
// mismo número. Antes se sacaban del texto de `pruebas.cjs` con una expresión
// regular y se ejecutaban con un `new Function`; ya no hace falta, porque son
// exportaciones de un módulo: se requiere y se ejecutan. Lo que no cambia es que
// se EJECUTAN con los números de la corrida real, en vez de leer el archivo
// buscando palabras.
//
// Sin guarda a propósito: pedirle a `no-arranco.cjs` un nombre que no tiene
// contesta solo —con el nombre pedido, la lista de los que hay y salida 2—, que
// es la puerta del #132. Una guarda aquí sería una segunda respuesta peor.
const { relojCreible, frasePorNoContestar } =
  require(path.join(dentro, 'no-arranco.cjs'));

// El caso real, con sus cifras.
const PLAZO = 240_000, SALTO = 901_000;
if (!relojCreible(PLAZO, SALTO))
  ok('901 s sobre un plazo de 240 no se cree', 'el de la corrida del 2026-11-05');
else
  falla('901 s sobre un plazo de 240 no se cree',
    'que la cuenta lo declarara increíble',
    'lo dio por bueno: el corredor seguiría publicando los 901 s');

// Y lo que publica NO puede ser un número de segundos esperados, porque no se
// esperaron. Esta es la mentira que se vino a quitar.
const fraseSalto = frasePorNoContestar(PLAZO, SALTO);
if (!/sin contestar en \d+ s/.test(fraseSalto) && /no se pudo medir/.test(fraseSalto))
  ok('y lo dice como lo que es, no como una espera', fraseSalto);
else
  falla('y lo dice como lo que es, no como una espera',
    'que no afirmara «sin contestar en N s»', fraseSalto);

// El otro lado: una colgada de verdad tiene que seguir diciendo sus segundos.
// Sin esto, la cuenta podría declarar increíble TODO y quedarse verde: sería
// cambiar una mentira por otra.
const fraseReal = frasePorNoContestar(PLAZO, 241_500);
if (/sin contestar en 24[12] s/.test(fraseReal))
  ok('una colgada de verdad sigue diciendo sus segundos', fraseReal);
else
  falla('una colgada de verdad sigue diciendo sus segundos',
    '«sin contestar en ~241 s» (vencer el plazo por poco es lo normal)',
    fraseReal);

// Matar el proceso y recoger su salida cuesta milisegundos: medido el
// 2026-11-05, 12 ms sobre un plazo de 1200. Con el piso del plazo —10 s— ese
// sobrecosto no puede volverse sospecha, o la sección de arriba, que espera
// 12.3 s reales, se publicaría como «no se pudo medir».
if (relojCreible(10_000, 12_300))
  ok('el sobrecosto de matar al banco no se confunde con un salto',
    'los 12.3 s de la primera sección, con plazo de 10 s');
else
  falla('el sobrecosto de matar al banco no se confunde con un salto',
    'que 12.3 s sobre un plazo de 10 s se creyeran',
    'los declaró increíbles: la primera sección se volvería «no se pudo medir»');

// ════════════════════════════════════════════════════════════════════════════
// EL BARRIDO DE FECHAS: UN VERDE CON FECHA DE CADUCIDAD SE DENUNCIA HOY
// ════════════════════════════════════════════════════════════════════════════
//
// El corredor ya no sólo corre cada banco: repite los que salieron en verde con
// el reloj adelantado al 15 de febrero del año que viene. Por qué, medido: el
// 2026-11-12 la suite entera, con el reloj congelado en 2027-02-15, sacó cuatro
// bancos en rojo y dos sin arrancar que esa misma mañana habían dado 118 verdes.
// Cuatro eran fixturas que siembran sus datos contando desde hoy y uno era
// producto (#137). Sin esta pasada, eso se descubre el 1 de enero, en caliente,
// y sin saber si lo roto es la prueba o el producto.
//
// Lo que se afirma aquí es conducta, y se afirma con un taller propio: un banco
// de mentira que es VERDE HOY y ROJO el año que viene —la clase exacta del
// #136, un dato sembrado con el calendario de hoy— tiene que salir CADUCA,
// contarse, y hacer que el corredor salga con 1. Y uno que no caduca no puede
// salir nombrado: un barrido que pinta todo de rojo no distingue nada.
console.log('\n── El barrido: un banco verde hoy que no lo será el año que viene ──');

const taller2 = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-barrido-'));
const dentro2 = path.join(taller2, 'scripts');
fs.mkdirSync(dentro2);
for (const m of MODULOS) fs.copyFileSync(path.join(DIR, m), path.join(dentro2, m));
ponerElMutante(dentro2);

// El banco que caduca. No apuesta a nada raro: afirma que el dato que sembró
// —el año en que se escribió— sigue siendo el año en curso, que es lo que
// afirma sin darse cuenta cualquier fixtura que diga «la semana pasada».
const CADUCA = `// Verde hoy, rojo el año que viene: la clase del #136.
const AÑO_DE_SIEMBRA = ${new Date().getFullYear()};
const año = new Date().getFullYear();
if (año === AÑO_DE_SIEMBRA) {
  console.log(' ok   el dato sembrado sigue siendo del año en curso');
  process.exit(0);
}
console.log('FALLA el dato sembrado quedó en un año ya cerrado');
console.log('        esperaba: ' + AÑO_DE_SIEMBRA);
console.log('        obtuvo:   ' + año);
process.exit(1);
`;
fs.writeFileSync(path.join(dentro2, 'prueba-de-mentira-que-caduca.cjs'), CADUCA);
// El que no caduca, para que el barrido tenga que distinguir.
fs.writeFileSync(path.join(dentro2, 'prueba-de-mentira-firme.cjs'),
  `console.log(' ok   2 + 2 siguen siendo 4 en febrero'); process.exit(0);\n`);
// Los tres de la tabla de exclusiones tienen que EXISTIR en el taller, porque
// el corredor denuncia una exclusión que nombra un archivo fantasma. Y el
// primero se escribe CADUCANDO: es la afirmación de que la exclusión se
// respeta de verdad y no por casualidad.
const EXCLUIDOS = ['prueba-canal-que-avisa.cjs', 'prueba-mensaje-de-permiso.cjs',
                   'prueba-corredor-no-se-cuelga.cjs'];
fs.writeFileSync(path.join(dentro2, EXCLUIDOS[0]), CADUCA);
for (const f of EXCLUIDOS.slice(1))
  fs.writeFileSync(path.join(dentro2, f), `console.log(' ok   excluido'); process.exit(0);\n`);

const correrTaller2 = (extra = {}, filtro = null) => spawnSync(process.execPath,
  [path.join(dentro2, 'pruebas.cjs'), ...(filtro ? [filtro] : [])], {
    encoding: 'utf8', cwd: taller2, killSignal: 'SIGKILL', timeout: PLAZO_DEL_CORREDOR,
    env: { ...ENTORNO_BASE,
           PLAZO_BANCO: String(PLAZO_DEL_BANCO), ...extra },
  });

const rB = correrTaller2();
const salidaB = (rB.stdout || '') + (rB.stderr || '');
const resumenB = (salidaB.match(/^\d+ en verde .*/m) || [''])[0];

// 1. El banco que caduca sale nombrado y con el rótulo CADUCA.
const renglónCaduca = (salidaB.match(/^CADUCA\s+de-mentira-que-caduca.*/m) || [''])[0];
if (renglónCaduca)
  ok('un banco verde hoy y rojo el año que viene sale CADUCA', renglónCaduca.trim());
else
  falla('un banco verde hoy y rojo el año que viene sale CADUCA',
    'el renglón «CADUCA  de-mentira-que-caduca»',
    (salidaB.match(/.*que-caduca.*/) || ['(no lo nombró)'])[0].trim());

// 2. Se cuenta en el resumen. Sin cifra propia, una caduca se lee como un verde
//    con un renglón raro arriba.
if (/1 que caduca\(n\)/.test(resumenB))
  ok('se cuenta aparte en el resumen', resumenB.trim());
else
  falla('se cuenta aparte en el resumen',
    'el resumen dice «1 que caduca(n)»', resumenB.trim() || '(no hubo resumen)');

// 3. Y SOLA basta para salir con 1. En este taller no hay ningún rojo: si la
//    caduca no contara, la salida sería 0 y un merge pasaría por encima. Es la
//    misma cuenta por número de la sección de la colgada.
if (/ en rojo/.test(resumenB) && !/0 en rojo/.test(resumenB))
  falla('una caduca sola basta para que el corredor salga con 1',
    'un taller sin rojos, para que la salida 1 sea de la caduca',
    `había rojos: ${resumenB.trim()}`);
else if (rB.status === 1)
  ok('una caduca sola basta para que el corredor salga con 1');
else
  falla('una caduca sola basta para que el corredor salga con 1',
    'salida 1', `salida ${rB.status} — un verde caducado no paraba nada`);

// 4. El que no caduca no se nombra, y el informe dice la fecha con la que midió
//    y cómo repetirlo solo. Sin la fecha, el renglón no se puede investigar.
if (!/^CADUCA\s+de-mentira-firme/m.test(salidaB) && !/firme.*caduca/i.test(salidaB))
  ok('el banco que no caduca no sale nombrado',
    'un barrido que pinta todo de rojo no distingue nada');
else
  falla('el banco que no caduca no sale nombrado',
    'que «de-mentira-firme» no apareciera como caduca',
    (salidaB.match(/.*firme.*caduca.*/i) || [''])[0].trim());

const añoQueViene = new Date().getFullYear() + 1;
if (salidaB.includes(`${añoQueViene}-02-15`))
  ok('el informe dice con qué fecha midió', `${añoQueViene}-02-15`);
else
  falla('el informe dice con qué fecha midió',
    `la fecha ${añoQueViene}-02-15 escrita en el informe`, '(no la dijo)');

// El comando para repetirla no se compara contra una cadena: se EJECUTA, en el
// taller y tal como el informe lo imprimió. Esto no es rigor de adorno — la
// versión que se comparaba contra una cadena estuvo verde todo el tiempo sobre
// un comando que moría en el preload con MODULE_NOT_FOUND, porque
// `--require scripts/x.cjs` sin `./` se resuelve como nombre de módulo. Salía
// con 1 y sin FALLAs, o sea idéntico a «el banco está roto», y manda a
// investigar el banco en vez del reloj. Un comando que se fija por su texto
// está comprobado contra sí mismo.
const cmd = (salidaB.match(/^\s*(FECHA_FALSA=.*)$/m) || ['', ''])[1].trim();
if (!cmd) {
  falla('el informe entrega un comando para repetir la caduca',
    'un renglón que empiece con FECHA_FALSA=', '(no lo dijo)');
} else if (!cmd.includes('prueba-de-mentira-que-caduca.cjs')) {
  falla('el comando que entrega es el del banco que caducó',
    'que nombrara prueba-de-mentira-que-caduca.cjs', cmd);
} else {
  const rC = spawnSync('/bin/sh', ['-c', cmd],
    { encoding: 'utf8', cwd: taller2, timeout: PLAZO_DEL_BANCO,
      env: { ...ENTORNO_BASE } });
  const salidaC = (rC.stdout || '') + (rC.stderr || '');
  // Lo que se afirma es que CORRIÓ con el reloj adelantado: el banco del taller
  // está escrito para caer justo por eso y decirlo con su FALLA. Un rojo sin
  // FALLA es el preload que se murió, y es el caso que esto vigila.
  if (/MODULE_NOT_FOUND/.test(salidaC))
    falla('el comando que entrega el informe corre de verdad',
      'que el reloj falso se precargara',
      'murió en el preload con MODULE_NOT_FOUND: sale con 1 sin una sola FALLA, ' +
      'igual que un banco roto, y manda a investigar el banco');
  else if (/^FALLA el dato sembrado quedó en un año ya cerrado/m.test(salidaC))
    ok('y cómo repetir ese banco solo: el comando corre y reproduce la caduca');
  else
    falla('el comando que entrega el informe corre y reproduce la caduca',
      'la FALLA del banco que caduca, con el reloj adelantado',
      `salida ${rC.status}: ${salidaC.trim().split('\n').slice(-3).join(' / ') || '(nada)'}`);
}

// 5. La tabla de exclusiones se respeta Y se publica. El banco excluido es el
//    mismo código que caduca: si la tabla no se mirara, saldría CADUCA.
if (!/^CADUCA\s+canal-que-avisa/m.test(salidaB))
  ok('un banco de la tabla de exclusiones no se barre');
else
  falla('un banco de la tabla de exclusiones no se barre',
    'que «canal-que-avisa» no saliera CADUCA (está excluido)',
    'salió CADUCA: la tabla no se miró');

const renglónExcl = (salidaB.match(/^no se barre\s+canal-que-avisa\s+(.+)$/m) || ['', ''])[1];
if (renglónExcl && renglónExcl.trim().length > 20)
  ok('y la exclusión se publica con su razón escrita', renglónExcl.trim());
else
  falla('y la exclusión se publica con su razón escrita',
    'el renglón «no se barre  canal-que-avisa  <razón>»',
    renglónExcl.trim() || '(la exclusión no se vio: nadie la volverá a discutir)');

// ── Un barrido que no se hizo se DICE ──────────────────────────────────────
//
// Con filtro no se barre, y está bien: el barrido es de la suite entera. Lo que
// no puede pasar es que se calle, porque entonces una corrida filtrada en verde
// y una completa en verde se leen igual y no miden lo mismo.
console.log('\n── Una corrida filtrada no barre, y lo dice ──');
const rFiltrada = correrTaller2({}, 'que-caduca');
const salidaF = (rFiltrada.stdout || '') + (rFiltrada.stderr || '');
if (/SIN barrido de fechas/.test(salidaF) && /filtrada/.test(salidaF))
  ok('lo dice en voz alta, nombrando el filtro',
    (salidaF.match(/SIN barrido.*/) || [''])[0].trim());
else
  falla('lo dice en voz alta, nombrando el filtro',
    'el renglón «SIN barrido de fechas: la corrida está filtrada…»',
    (salidaF.match(/.*barrido.*/) || ['(no dijo nada del barrido)'])[0].trim());
if (rFiltrada.status === 0)
  ok('y el banco que caduca sigue en verde para la corrida filtrada',
    'sin barrido no hay veredicto sobre el tiempo, y no se finge uno');
else
  falla('y el banco que caduca sigue en verde para la corrida filtrada',
    'salida 0: lo que no se midió no se publica', `salida ${rFiltrada.status}`);

// ── La fecha se deriva, y lo que deriva es futuro ──────────────────────────
//
// Una fecha fija escrita en el archivo deja de ser futuro sin que nadie se
// entere, y el barrido se vuelve un segundo «hoy»: la puerta sigue ahí, verde,
// sin medir nada. Así que la cuenta se SACA del corredor del taller y se
// EJECUTA con varios «hoy», incluidos los dos bordes del año.
console.log('\n── La fecha del barrido se deriva del día en que se corre ──');
const fuente2 = fs.readFileSync(path.join(dentro2, 'pruebas.cjs'), 'utf8');
const textoFecha = (fuente2.match(/^const fechaDeBarrido = [\s\S]*?;$/m) || [])[0];
if (!textoFecha)
  sinPrecondicion('no se pudo sacar `fechaDeBarrido` de pruebas.cjs',
    ['Es la cuenta que decide a qué fecha se barre. Si se renombró, esta',
     'sección no midió nada, y eso no es verde.']);
const fechaDeBarrido = new Function(`${textoFecha}\nreturn fechaDeBarrido;`)();

const DIAS = ['2026-11-12', '2026-12-31', '2027-01-01', '2027-02-14', '2027-06-30'];
const noFuturos = [], fueraDeQ1 = [];
for (const d of DIAS) {
  const hoy = new Date(`${d}T12:00:00`);
  const f = fechaDeBarrido(hoy);
  if (!(f > d)) noFuturos.push(`${d} → ${f}`);
  // Q1 y año siguiente: cruzar la frontera de año es donde vive la clase del
  // #136, y febrero está lejos de la pared de enero —las primeras semanas del
  // año tienen estructuralmente menos de cuatro semanas detallables (#47), y
  // un banco honesto no puede afirmar ahí lo mismo que en febrero.
  const [a, m] = f.split('-');
  if (Number(a) !== hoy.getFullYear() + 1 || !['01', '02', '03'].includes(m))
    fueraDeQ1.push(`${d} → ${f}`);
}
if (noFuturos.length === 0)
  ok('la fecha derivada siempre está en el futuro', DIAS.map(d => fechaDeBarrido(new Date(`${d}T12:00:00`))).join(' · '));
else
  falla('la fecha derivada siempre está en el futuro',
    'que ningún «hoy» derivara una fecha ya pasada', noFuturos.join(', '));
if (fueraDeQ1.length === 0)
  ok('y cae en el primer trimestre del año siguiente, cruzando la frontera de año');
else
  falla('y cae en el primer trimestre del año siguiente, cruzando la frontera de año',
    'año+1 y mes 01–03', fueraDeQ1.join(', '));

// ── Una exclusión que nombra un archivo que ya no existe se denuncia ───────
//
// La tabla de exclusiones es la parte peligrosa del barrido: lo que entra ahí
// deja de medirse para siempre. Si uno de esos bancos se renombra, se estaría
// barriendo sin que nadie lo decidiera; si desaparece, la razón quedó de
// adorno. En los dos casos la tabla dejó de decir la verdad, y una lista de
// excepciones que nadie mantiene es una puerta sin llave.
console.log('\n── Una exclusión que ya no corresponde a ningún banco ──');
fs.unlinkSync(path.join(dentro2, EXCLUIDOS[1]));
const rFantasma = correrTaller2();
const salidaFa = (rFantasma.stdout || '') + (rFantasma.stderr || '');
if (new RegExp(`no existe[\\s\\S]*${EXCLUIDOS[1].replace('.', '\\.')}`).test(salidaFa))
  ok('se denuncia, por su nombre', EXCLUIDOS[1]);
else
  falla('se denuncia, por su nombre',
    `que el informe nombrara ${EXCLUIDOS[1]} como exclusión sin banco`,
    (salidaFa.match(/.*exclusion.*/i) || ['(no dijo nada)'])[0].trim());
if (rFantasma.status === 1)
  ok('y para la suite: una exclusión sin mantener no se tolera');
else
  falla('y para la suite: una exclusión sin mantener no se tolera',
    'salida 1', `salida ${rFantasma.status}`);
try { fs.rmSync(taller2, { recursive: true, force: true }); } catch {}

// ── LA TABLA DE EMULADORES NO PUEDE QUEDARSE ATRÁS ─────────────────────────
//
// La sección de abajo mide que un banco al que le falta un emulador se nombre y
// no se corra. Eso vale si el banco ESTÁ en la tabla del corredor. El
// 2026-11-12 se midió cuántos estaban: ocho entradas para dieciséis bancos que
// hablan con el emulador. Los otros ocho se corrían, y con el 9099 apagado dos
// de ellos —`reglas-programa` y `reglas-obra-cerrada`— salían con **1 y cero
// renglones `FALLA`**: el corredor publicaba `ROJO` sin número y mandaba a
// buscar una regresión en `firestore.rules` que no existía.
//
// Corregir las ocho entradas no cierra nada: la tabla ya había crecido de dos a
// ocho de una en una, y nada impedía la novena. Lo que se mide aquí es la
// puerta: que el corredor REVISE la tabla contra los bancos y pare la suite
// cuando discrepen. Y se mide por los cuatro modos de discrepar, separados,
// porque uno solo bastaría para que los otros tres se fueran en verde.
console.log('\n── Un banco que habla con el emulador y no está declarado ──');
const taller3 = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-tabla-emu-'));
const dentro3 = path.join(taller3, 'scripts');
fs.mkdirSync(dentro3);
for (const m of MODULOS) fs.copyFileSync(path.join(DIR, m), path.join(dentro3, m));
ponerElMutante(dentro3);
fs.writeFileSync(path.join(dentro3, 'prueba-de-mentira-verde.cjs'),
  `console.log(' ok   nada que ver'); process.exit(0);\n`);

// Los tres puertos apuntados al 1: tomado y cerrado, rechaza al instante. Así
// un banco que SÍ esté bien declarado se salta —«sin emulador»— en vez de
// tardar, y lo que queda medido es la revisión de la tabla y nada más.
const correrTaller3 = (filtro3) => {
  const r = spawnSync(process.execPath,
    [path.join(dentro3, 'pruebas.cjs'), ...(filtro3 ? [filtro3] : [])], {
      encoding: 'utf8', cwd: taller3, killSignal: 'SIGKILL', timeout: PLAZO_DEL_CORREDOR,
      env: { ...ENTORNO_BASE,
             PLAZO_BANCO: String(PLAZO_DEL_BANCO), BARRIDO: 'no',
             EMU_PORT: '1', EMU_AUTH_PORT: '1', EMU_STOR_PORT: '1' },
    });
  return { status: r.status, salida: (r.stdout || '') + (r.stderr || '') };
};

// 1. El que no está en la tabla. Abre la conexión al emulador de verdad —el
//    disparador es la llamada, no el nombre del archivo— y sale verde, así que
//    si la puerta no existe la corrida entera sale 0 y nadie se enteró.
//
//    Y se corre CON FILTRO, excluyéndolo del recorrido: la tabla es una
//    propiedad del repositorio, no de la corrida. Una revisión que sólo mirara
//    los bancos filtrados dejaría pasar al no declarado cada vez que alguien
//    trabaja con `npm test algo`, que es la mayor parte del tiempo.
const SIN_DECLARAR = 'prueba-zz-habla-con-el-emulador.cjs';
fs.writeFileSync(path.join(dentro3, SIN_DECLARAR),
  `const connectFirestoreEmulator = () => {};
connectFirestoreEmulator(null, '127.0.0.1', 8080);
console.log(' ok   salí verde sin declarar nada'); process.exit(0);\n`);
//    Se exige el nombre Y el motivo exacto. Con el nombre solo bastaría que el
//    corredor lo denunciara por cualquier otra razón —por ejemplo, creyendo que
//    sí está en la tabla y reclamándole el `exigirPuertos`— para que esto
//    saliera verde con la puerta quitada.
const rTabla = correrTaller3('de-mentira-verde');
const renglónTabla =
  (rTabla.salida.match(/.*zz-habla-con-el-emulador.*/) || [''])[0].trim();
if (/no está en la tabla/.test(renglónTabla))
  ok('se denuncia por su nombre, aunque la corrida esté filtrada', renglónTabla);
else
  falla('se denuncia por su nombre, aunque la corrida esté filtrada',
    'un renglón que lo nombre y diga que no está en la tabla',
    renglónTabla || rTabla.salida.trim().split('\n').slice(-2).join(' / ')
      || '(no dijo nada)');
if (rTabla.status === 1)
  ok('y para la suite: una tabla que no cuadra no se tolera');
else
  falla('y para la suite: una tabla que no cuadra no se tolera',
    'salida 1', `salida ${rTabla.status}`);
fs.unlinkSync(path.join(dentro3, SIN_DECLARAR));

// 2, 3, 4 y 5 van sobre un banco que SÍ está en la tabla del corredor, con
// cuatro contenidos. El nombre se reusa a propósito: lo que cambia entre los
// cuatro es sólo lo que el banco declara, que es la variable del experimento.
const EN_LA_TABLA = 'prueba-nota-no-calla.cjs';
const bancoQueDeclara = (linea) => {
  fs.writeFileSync(path.join(dentro3, EN_LA_TABLA),
    `const { limpiarDatos } = require('./emulador-limpio.cjs');\n${linea}` +
    `console.log(' ok   nada'); process.exit(0);\n`);
  return correrTaller3();
};

console.log('\n── Un banco declarado en la tabla que no pide sus puertos ──');
const rSinPedir = bancoQueDeclara('');
if (/exigirPuertos/.test(rSinPedir.salida) && rSinPedir.status === 1)
  ok('se denuncia: corrido a mano, la tabla del corredor no lo protege',
    (rSinPedir.salida.match(/.*exigirPuertos.*/) || [''])[0].trim());
else
  falla('se denuncia: corrido a mano, la tabla del corredor no lo protege',
    'el informe pide `exigirPuertos` y la suite sale con 1',
    `salida ${rSinPedir.status} · ${rSinPedir.salida.trim().split('\n').slice(-1)[0]}`);

// ── POR QUÉ AQUÍ SE ESPERA 2 Y NO 0 ────────────────────────────────────────
//
// `correrTaller3` corre el corredor con `EMU_PORT: '1'` y compañía: los
// emuladores están apagados A PROPÓSITO, porque lo que este taller mide es la
// DISCREPANCIA entre lo que un banco declara y lo que dice la tabla, no si
// los bancos pasan.
//
// Hasta el 2026-11-25 esto se comprobaba con `status === 0`, usando el código
// de salida como sinónimo de «no se denunció nada». Dejó de serlo el día que
// la puerta empezó a cerrar con 2 sobre bancos que no se pudieron comprobar
// —que es justo lo que pasa aquí, y es cierto—. La aserción se vuelve a
// escribir sobre lo que de verdad afirma: no hay denuncia, y no hay ROJO.
//
// Y se exige el 2 exacto, no un «cualquier cosa menos 1»: con los emuladores
// caídos no hay otro código correcto, y aflojarlo a «no es rojo» taparía que
// la puerta volviera a abrirse con 0.
console.log('\n── Un banco que declara lo mismo que la tabla ──');
const rCuadra = bancoQueDeclara(
  `require('./no-arranco.cjs').exigirPuertos({ firestore: 1, auth: 1 }, '127.0.0.1');\n`);
if (rCuadra.status === NO_ARRANCO && !/no dicen lo mismo/.test(rCuadra.salida))
  ok('no se denuncia nada: es el caso bueno y no puede salir en ROJO',
    (rCuadra.salida.match(/^\d+ en verde .*/m) || [''])[0].trim());
else
  falla('no se denuncia nada: es el caso bueno y no puede salir en ROJO',
    `ni una denuncia, y salida ${NO_ARRANCO} —sin emuladores, nada se comprobó—`,
    `salida ${rCuadra.status} · ${(rCuadra.salida.match(/.*no dicen lo mismo.*/) || ['(sin denuncia)'])[0].trim()}`);

console.log('\n── Un banco que declara MENOS emuladores que la tabla ──');
const rDiscrepa = bancoQueDeclara(
  `require('./no-arranco.cjs').exigirPuertos({ firestore: 1 }, '127.0.0.1');\n`);
if (/uno de los dos miente/.test(rDiscrepa.salida) && rDiscrepa.status === 1)
  ok('se denuncia la discrepancia, con las dos listas',
    (rDiscrepa.salida.match(/.*uno de los dos miente.*/) || [''])[0].trim());
else
  falla('se denuncia la discrepancia, con las dos listas',
    'el informe publica lo que dice la tabla y lo que pide el banco',
    `salida ${rDiscrepa.status} · ${rDiscrepa.salida.trim().split('\n').slice(-1)[0]}`);

// El quinto modo no es una discrepancia: es un nombre que el corredor no
// conoce. No da error — da `EMULADORES['firestoer'] === undefined`, una sonda a
// un puerto `NaN` que no contesta nunca, y el banco se queda «sin emulador»
// para siempre con los tres emuladores arriba. Verde que nunca se midió.
console.log('\n── Un banco que pide un emulador que el corredor no conoce ──');
// Se exige el renglón PROPIO —el que dice «no conoce»— y no sólo que el nombre
// aparezca: un `firestoer` también dispara la discrepancia de arriba, así que
// buscar la cadena a secas daría verde con esta puerta quitada. Medido.
const rDesconocido = bancoQueDeclara(
  `require('./no-arranco.cjs').exigirPuertos({ firestoer: 1, auth: 1 }, '127.0.0.1');\n`);
const renglónDesconocido =
  (rDesconocido.salida.match(/.*no conoce: firestoer.*/) || [''])[0].trim();
if (renglónDesconocido && /los que hay son/.test(renglónDesconocido)
    && rDesconocido.status === 1)
  ok('se denuncia el nombre que no existe, y se dicen los que sí',
    renglónDesconocido);
else
  falla('se denuncia el nombre que no existe, y se dicen los que sí',
    'un renglón propio que nombre `firestoer` y liste los emuladores que conoce',
    `salida ${rDesconocido.status} · ${renglónDesconocido || '(no hubo tal renglón)'}`);

// 6. Un banco que no se puede leer. El disparador es una llamada en el código,
//    así que un archivo que no parsea no se puede clasificar — y dejarlo pasar
//    sería el hueco otra vez, ahora con la excusa de la sintaxis. Se corre con
//    filtro para que no se EJECUTE: lo que se mide es la revisión, no el rojo
//    que ese banco daría al correrse.
console.log('\n── Un banco cuyo código no se puede leer ──');
const ROTO = 'prueba-zz-roto.cjs';
fs.writeFileSync(path.join(dentro3, ROTO),
  `connectFirestoreEmulator(null, '127.0.0.1', 8080\n`);
const rRoto = correrTaller3('de-mentira-verde');
const renglónRoto = (rRoto.salida.match(/.*zz-roto.*/) || [''])[0].trim();
if (/no se puede leer su código/.test(renglónRoto) && rRoto.status === 1)
  ok('se denuncia: no clasificado no es lo mismo que no declarado', renglónRoto);
else
  falla('se denuncia: no clasificado no es lo mismo que no declarado',
    'un renglón que lo nombre y diga que no se puede leer su código, y salida 1',
    `salida ${rRoto.status} · ${renglónRoto || '(no dijo nada)'}`);
fs.unlinkSync(path.join(dentro3, ROTO));

// 7. Y sin el parser no se revisa nada, así que la respuesta es NO ARRANCÓ.
//    Ésta es la conducta que distingue esta puerta de las anteriores: un
//    corredor que no puede mirar la tabla no tiene permitido contestar ni 0 ni
//    1. Con 0 la tabla deja de vigilarse el día que `node_modules` esté a
//    medias; con 1 vuelve el defecto de esta rama —un veredicto sobre algo que
//    no se midió—. Se mide quitándole el NODE_PATH al directorio temporal, que
//    es la única razón por la que el parser se encuentra ahí.
console.log('\n── El corredor sin el parser con el que revisa la tabla ──');
const rSinParser = spawnSync(process.execPath, [path.join(dentro3, 'pruebas.cjs')], {
  encoding: 'utf8', cwd: taller3, killSignal: 'SIGKILL', timeout: PLAZO_DEL_CORREDOR,
  // A propósito SIN `ENTORNO_BASE`: lo que se le quita es justo el `NODE_PATH`
  // que le hace encontrar el parser desde un temporal.
  env: { PATH: process.env.PATH, HOME: process.env.HOME,
         PLAZO_BANCO: String(PLAZO_DEL_BANCO), BARRIDO: 'no',
         EMU_PORT: '1', EMU_AUTH_PORT: '1', EMU_STOR_PORT: '1' },
});
const salidaSinParser = (rSinParser.stdout || '') + (rSinParser.stderr || '');
if (rSinParser.status === 2 && /@babel\/parser/.test(salidaSinParser))
  ok('sale 2 y nombra lo que le falta: no pude mirar, no es rojo ni verde',
    (salidaSinParser.match(/.*@babel\/parser.*/) || [''])[0].trim().slice(0, 110));
else
  falla('sale 2 y nombra lo que le falta: no pude mirar, no es rojo ni verde',
    'salida 2 nombrando `@babel/parser`',
    `salida ${rSinParser.status} · ${salidaSinParser.trim().split('\n').slice(-1)[0]}`);

try { fs.rmSync(taller3, { recursive: true, force: true }); } catch {}

// 8. Y LA TABLA DEL REPOSITORIO DE HOY CUADRA.
//
// Esta comprobación existe porque sin ella el defecto se escapó. Los siete
// casos de arriba corren en un directorio temporal con bancos de mentira: miden
// la puerta, pero no pueden medir el repositorio, y `prueba-corredor-no-se-
// cuelga.cjs` NO EXISTE ahí. Así que cuando el disparador buscaba los nombres
// en el TEXTO, este archivo —que lleva `'emulador-limpio.cjs'` en su tabla de
// módulos y escribe `connectFirestoreEmulator(` dentro de una plantilla— se
// denunciaba a sí mismo, y los siete casos seguían verdes. El rojo apareció por
// primera vez en la corrida completa sobre `main`, con todo ya mezclado.
//
// Se corre el corredor SOBRE LOS BANCOS DE VERDAD, con los tres puertos al 1 y
// un filtro que empata un solo banco de emulador: ese banco se salta por «sin
// emulador» y no se ejecuta nada, pero la revisión de la tabla recorre el
// repositorio entero, que es lo que hay que mirar.
//
// El directorio se arma con ENLACES a todo lo que hay en `scripts/`, y el
// corredor que se pone ahí es EL QUE SE ESTÁ MIDIENDO (el mutante cuando lo
// hay, el del repo cuando no). Apuntar directo a `scripts/pruebas.cjs`
// parecía más simple y era una trampa: la contraprueba lanza el mutante desde
// /tmp, así que esta comprobación corría el corredor SANO y la mutación que
// vuelve a buscar los nombres en el texto salía NO LA VE —medido, no deducido—.
// Enlaces y no copias para que `readFileSync` lea el contenido de hoy; `dir`
// sale de `__dirname`, así que el corredor enumera estos nombres y lee esos
// archivos.
console.log('\n── La tabla y los bancos del repositorio de hoy ──');
const tallerRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-repo-real-'));
const dentroRepo = path.join(tallerRepo, 'scripts');
fs.mkdirSync(dentroRepo);
for (const e of fs.readdirSync(DIR))
  if (e !== 'pruebas.cjs' && e !== MOD_MUTADO)
    fs.symlinkSync(path.join(DIR, e), path.join(dentroRepo, e));
// Los dos que pueden venir mutados se COPIAN, no se enlazan: un enlace al del
// repositorio pondría el archivo sano y la mutación saldría NO LA VE sin que
// nada estuviera roto. Se copian del repo primero y el mutante los pisa después,
// para que esto valga también cuando no hay contraprueba.
fs.copyFileSync(path.join(DIR, 'pruebas.cjs'), path.join(dentroRepo, 'pruebas.cjs'));
if (MOD_MUTADO !== 'pruebas.cjs')
  fs.copyFileSync(path.join(DIR, MOD_MUTADO), path.join(dentroRepo, MOD_MUTADO));
ponerElMutante(dentroRepo);
const rRepo = spawnSync(process.execPath,
  [path.join(dentroRepo, 'pruebas.cjs'), 'reglas-evidencia'], {
    encoding: 'utf8', cwd: tallerRepo, killSignal: 'SIGKILL',
    timeout: PLAZO_DEL_CORREDOR,
    env: { ...ENTORNO_BASE, BARRIDO: 'no', PLAZO_BANCO: String(PLAZO_DEL_BANCO),
           EMU_PORT: '1', EMU_AUTH_PORT: '1', EMU_STOR_PORT: '1' },
  });
const salidaRepo = (rRepo.stdout || '') + (rRepo.stderr || '');
// Mismo caso que arriba, y por el mismo motivo: esta corrida también lleva los
// puertos apagados, así que `reglas-evidencia` no se puede comprobar y 2 es el
// veredicto correcto. Lo que se mide es que no haya denuncia, no que pase.
if (!/no dicen lo mismo/.test(salidaRepo) && rRepo.status === NO_ARRANCO)
  ok('ningún banco del repositorio discrepa de la tabla',
    (salidaRepo.match(/^\d+ en verde .*/m) || ['(sin resumen)'])[0].trim());
else
  falla('ningún banco del repositorio discrepa de la tabla',
    `ni una denuncia sobre el repositorio real, y salida ${NO_ARRANCO}`,
    `salida ${rRepo.status} · ` +
    (salidaRepo.match(/^ {2}\S+:.*/m) || ['(sin renglón)'])[0].trim());
try { fs.rmSync(tallerRepo, { recursive: true, force: true }); } catch {}

// ── UN EMULADOR CAÍDO SE NOMBRA, NO SE ESPERA ───────────────────────────────
//
// El 2026-11-06 la suite salió `SE COLGÓ · reglas-dependencia-captura · sin
// contestar en 240 s`. No había nada lento: los emuladores se habían levantado
// con `--only firestore,auth` y ese banco es el único del repo que ejercita
// `storage.rules`. El corredor preguntaba por UN puerto —el 8080— y clasificaba
// como si hubiera preguntado por los tres, así que el banco pasó el filtro,
// arrancó, y el SDK de Storage se quedó reintentando contra el 9199 muerto. La
// cola del informe traía ruido de gRPC de Firestore y no mencionaba Storage por
// ninguna parte: cuatro minutos para no medir nada y un informe que mandaba al
// sitio equivocado.
//
// Se mide con los TRES puertos bajo control y con el NOMBRE REAL del banco, que
// es lo que lee la tabla del corredor: dos servidores de mentira hacen de
// Firestore y de Auth —vivos— y Storage apunta a un puerto que nadie escucha.
// Si se dejara que firestore saliera también caído, el informe diría «falta
// firestore, auth, storage» y esta sección estaría verde sin haber distinguido
// lo que importa: que se entere del que NO se veía.
//
// Y el banco de mentira NO VUELVE. Eso es la otra mitad: si el corredor lo
// corriera, aquí habría una colgada. Que no la haya es la afirmación.
console.log('\n── Con un banco que necesita Storage y el 9199 caído ──');
const net = require('net');
const servidor = (f) => { const s = net.createServer(c => c.end()); s.listen(0, '127.0.0.1', f); return s; };
const falso = path.join(dentro, 'prueba-reglas-dependencia-captura.cjs');
fs.writeFileSync(falso, `
console.log('fingiendo ser el banco de reglas que habla con Storage…');
require('net').connect(1, '10.255.255.1').on('error', () => {});
setTimeout(() => { console.log('esto no se alcanza a imprimir'); }, 600000);
`);
// Un puerto tomado y cerrado: nadie escucha, y rechaza al instante en vez de
// hacer esperar al sistema operativo.
const muerto = 1;
const sFs = servidor(), sAuth = servidor();
const esperarEscucha = (s) => new Promise(r => s.listening ? r() : s.once('listening', r));

(async () => {
  await Promise.all([esperarEscucha(sFs), esperarEscucha(sAuth)]);
  const rEmu = spawnSync(process.execPath,
    [path.join(dentro, 'pruebas.cjs'), 'dependencia-captura'], {
      encoding: 'utf8', cwd: taller, killSignal: 'SIGKILL', timeout: PLAZO_DEL_CORREDOR,
      env: { ...ENTORNO_BASE,
             PLAZO_BANCO: String(PLAZO_DEL_BANCO),
             EMU_PORT: String(sFs.address().port),
             EMU_AUTH_PORT: String(sAuth.address().port),
             EMU_STOR_PORT: String(muerto) },
    });
  const salidaEmu = (rEmu.stdout || '') + (rEmu.stderr || '');
  const resumenEmu = (salidaEmu.match(/^\d+ en verde .*/m) || [''])[0];

  if (/1 sin emulador/.test(resumenEmu))
    ok('un banco al que le falta un emulador se cuenta «sin emulador»', resumenEmu.trim());
  else
    falla('un banco al que le falta un emulador se cuenta «sin emulador»',
      'el resumen dice «1 sin emulador»', resumenEmu.trim() || '(no hubo resumen)');

  // Lo que faltaba el 2026-11-06 era el NOMBRE. «Sin emulador» a secas manda a
  // levantar lo que ya estaba levantado.
  if (/falta storage/.test(salidaEmu))
    ok('y dice CUÁL le falta, por su nombre',
      (salidaEmu.match(/.*falta storage.*/) || [''])[0].trim());
  else
    falla('y dice CUÁL le falta, por su nombre',
      'el renglón del banco dice «falta storage»',
      (salidaEmu.match(/.*dependencia-captura.*/) || ['(no lo nombró)'])[0].trim());

  // Que el 8080 conteste no autoriza a correrlo: era exactamente la mentira.
  if (!/colgad/i.test(resumenEmu) || /0 colgada/.test(resumenEmu))
    ok('no se corre, así que no hay colgada que explicar', resumenEmu.trim());
  else
    falla('no se corre, así que no hay colgada que explicar',
      '0 colgada(s): con el puerto muerto no hay nada que medir',
      resumenEmu.trim());

  // Y el consejo del informe tiene que nombrar Storage. Este renglón decía
  // `--only firestore,auth` fijo, y es el que se tecleó tres veces seguidas
  // dejando el 9199 caído: el consejo del informe era la causa del punto ciego.
  const consejo = (salidaEmu.match(/^\s*firebase emulators:start .*/m) || [''])[0];
  if (/--only\s+\S*storage/.test(consejo))
    ok('y el comando que sugiere incluye storage', consejo.trim());
  else
    falla('y el comando que sugiere incluye storage',
      'el `--only` nombra los tres emuladores que la suite necesita',
      consejo.trim() || '(no sugirió comando)');

  sFs.close(); sAuth.close();
  try { fs.rmSync(taller, { recursive: true, force: true }); } catch {}

  console.log('');
  console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
  if (fallas === 0) console.log('El corredor no se cuelga, y lo que no pudo medir lo dice.');
  process.exit(fallas > 0 ? 1 : 0);
})();
