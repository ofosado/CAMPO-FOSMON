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
const { vigilarExcepciones, sinPrecondicion } = require('./no-arranco.cjs');

vigilarExcepciones('el corredor de la suite');

const DIR = __dirname;

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
  const fuente = fs.readFileSync(path.join(DIR, 'pruebas.cjs'), 'utf8');
  const MUTACIONES = [
    ['quitarle el plazo al spawn (el defecto original)',
      /timeout: PLAZO_BANCO,/, ''],
    ['no contar las colgadas al salir',
      /rojas\.length \+ mudas\.length \+ colgadas\.length/, 'rojas.length + mudas.length'],
    ['contar la colgada como verde',
      /if \(seColgó\) \{ estado = 'SE COLGÓ'; colgadas\.push\(\[f, tardó, salida\]\); \}/,
      `if (seColgó) { estado = 'verde'; verdes.push(f); }`],
    ['borrar las colgadas del resumen',
      /`\$\{mudas\.length\} sin arrancar · \$\{colgadas\.length\} colgada\(s\) · ` \+\n            /,
      '`${mudas.length} sin arrancar · ` +\n            '],
    ['quitarle el suelo al plazo',
      /Math\.max\(10_000, Number\(process\.env\.PLAZO_BANCO\) \|\| 240_000\)/,
      'Number(process.env.PLAZO_BANCO) || 240_000'],
    ['callar cuánto esperó',
      /\? `sin contestar en \$\{Math\.round\(tardó \/ 1000\)\} s`/,
      "? 'no contestó'"],
  ];

  let vistas = 0;
  for (const [nombre, busca, pone] of MUTACIONES) {
    if (!busca.test(fuente)) {
      console.log(`NO LA VE  ${nombre}  ·  el ancla ya no está en pruebas.cjs`);
      continue;
    }
    const arch = path.join(os.tmpdir(), `corredor-mutado-${Date.now()}-${vistas}.cjs`);
    fs.writeFileSync(arch, fuente.replace(busca, pone));
    const r = correr(process.execPath, [__filename], {
      encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL',
      env: { ...process.env, ARCH_CORREDOR: arch },
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
const MODULOS = ['pruebas.cjs', 'no-arranco.cjs', 'reloj.cjs'];
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
fs.writeFileSync(path.join(dentro, 'prueba-de-mentira-roja.cjs'),
  `console.log('FALLA algo que sí se midió y no se sostiene'); process.exit(1);\n`);
// Lenta pero sana: tarda dos segundos y pasa. Existe para la sección del
// suelo, donde se comprueba que un plazo ridículo no la convierte en colgada.
fs.writeFileSync(path.join(dentro, 'prueba-de-mentira-lenta.cjs'),
  `setTimeout(() => { console.log(' ok   tardé lo normal'); process.exit(0); }, 2000);\n`);

// Permite correr contra una copia mutada del corredor (la contraprueba).
if (process.env.ARCH_CORREDOR)
  fs.copyFileSync(process.env.ARCH_CORREDOR, path.join(dentro, 'pruebas.cjs'));

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

console.log('\n── El corredor, con un banco que no vuelve delante ──');
const t0 = Date.now();
const r = spawnSync(process.execPath, [path.join(dentro, 'pruebas.cjs')], {
  encoding: 'utf8', cwd: taller, killSignal: 'SIGKILL',
  timeout: PLAZO_DEL_CORREDOR,
  env: { PATH: process.env.PATH, HOME: process.env.HOME,
         PLAZO_BANCO: String(PLAZO_DEL_BANCO) },
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
    env: { PATH: process.env.PATH, HOME: process.env.HOME,
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

// 6. Y dice cuánto esperó. Sin el número, quien lo lea no sabe si subir el
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
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PLAZO_BANCO: '1' },
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

try { fs.rmSync(taller, { recursive: true, force: true }); } catch {}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas === 0) console.log('El corredor no se cuelga, y lo que no pudo medir lo dice.');
process.exit(fallas > 0 ? 1 : 0);
