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
      /\? `sin contestar en \$\{Math\.round\(tardó \/ 1000\)\} s`\n/,
      "? 'no contestó'\n"],
    // El defecto del reloj, exacto: creerle al reloj de pared contra el plazo.
    ['creerle al reloj aunque contradiga al plazo',
      /const relojCreible = \(plazo, tardó\) => tardó <= plazo \* 1\.25 \+ 10_000;/,
      'const relojCreible = (plazo, tardó) => true;'],
    // Y el otro lado: desconfiar de todo deja a las colgadas de verdad sin su
    // número, que es el dato con el que se decide si subir el plazo.
    ['desconfiar del reloj siempre, hasta de una colgada de verdad',
      /const relojCreible = \(plazo, tardó\) => tardó <= plazo \* 1\.25 \+ 10_000;/,
      'const relojCreible = (plazo, tardó) => false;'],
    // Tirar la medición de un rojo y dejar sólo el titular: el estado exacto
    // en el que un fallo irreproducible dejó de poder clasificarse.
    ['publicar el titular del rojo y tirar lo que midió',
      /\/\^FALLA\.\*\(\?:\\n\[ \\t\]\+\.\*\)\*\$\/gm/, '/^FALLA.*$/gm'],
    // Y por el otro lado: vaciar el informe entero de un rojo.
    ['no publicar nada de lo que dijo el rojo',
      /console\.log\(\(salida\.match\(\/\^FALLA[\s\S]*?\.join\('\\n'\)\);/,
      "console.log('(en rojo)');"],
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
// Se lee la copia DEL TALLER, no `scripts/pruebas.cjs`. Son el mismo archivo
// en una corrida normal, pero bajo la contraprueba el del taller es el mutado:
// leer el de verdad haría que esta sección saliera verde contra un corredor
// roto, que es la prueba comprobándose contra sí misma.
const fuenteCorredor = fs.readFileSync(path.join(dentro, 'pruebas.cjs'), 'utf8');
const saca = (nombre) => {
  const m = fuenteCorredor.match(
    new RegExp(`^const ${nombre} = [\\s\\S]*?;$`, 'm'));
  return m && m[0];
};
const textoReloj = saca('relojCreible');
const textoFrase = saca('frasePorNoContestar');
if (!textoReloj || !textoFrase) {
  sinPrecondicion('no se pudieron sacar las cuentas del reloj de pruebas.cjs',
    ['`relojCreible` y `frasePorNoContestar` son las que deciden qué se',
     'publica de una colgada. Si se renombraron, esta sección no midió nada:',
     'eso no es verde.']);
}
const { relojCreible, frasePorNoContestar } =
  new Function(`${textoReloj}\n${textoFrase}\n` +
    'return { relojCreible, frasePorNoContestar };')();

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

try { fs.rmSync(taller, { recursive: true, force: true }); } catch {}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas === 0) console.log('El corredor no se cuelga, y lo que no pudo medir lo dice.');
process.exit(fallas > 0 ? 1 : 0);
