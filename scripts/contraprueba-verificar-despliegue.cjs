#!/usr/bin/env node
// ¿El verificador de despliegue sabe decir que NO?
//
// `verificar-despliegue.cjs` salió verde la primera vez que se corrió. Un
// verificador que nace en verde no ha demostrado nada: puede estar midiendo
// de verdad, o puede estar imprimiendo cinco «ok» pase lo que pase. La única
// forma de distinguirlo es ponerlo en un mundo donde la respuesta correcta es
// roja y ver si lo dice.
//
// NO es una prueba de la suite —no empieza con `prueba-`— porque necesita red
// y credenciales de producción. Se corre a mano, y sobre todo se corre cuando
// se toca el verificador.
//
// Cómo se fabrica el mundo roto: se clona el repositorio a un directorio
// desechable y se le cambia AHÍ lo que haga falta. Nunca se toca el árbol de
// trabajo ni, por supuesto, producción: todas las lecturas siguen siendo de
// sólo lectura. Lo que cambia es el lado del repositorio, que es el barato.
//
// Cada escenario dice qué código de salida espera y qué renglón espera ver.
// Las dos cosas: un `exit 1` con el canal equivocado en rojo también es un
// defecto, y es el que más se parece a estar bien.
//
// Uso:  node scripts/contraprueba-verificar-despliegue.cjs

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const VERIFICADOR = path.join('scripts', 'verificar-despliegue.cjs');
const NO_ARRANCO = 2;

let fallas = 0;

const correr = (cmd, args, opciones = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opciones }).trim();

// Un clon local desechable. `--no-hardlinks` para que escribir dentro no pueda
// tocar los objetos del repositorio de verdad ni por accidente.
function clonar() {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'contra-despliegue-'));
  const caja = path.join(destino, 'repo');
  correr('git', ['clone', '--local', '--no-hardlinks', '--quiet', raiz, caja]);
  // El verificador se copia del árbol de trabajo, no se toma del clon: lo que
  // se está poniendo a prueba es el archivo que tengo delante, que puede estar
  // sin commitear todavía. Tomarlo del clon probaría la versión anterior y
  // daría verde sobre un arreglo que no existe.
  //
  // Va a `scripts/`, que a propósito NO está en las rutas desplegables: si
  // estuviera, este archivo de más ensuciaría el canal «árbol» y los seis
  // escenarios restantes saldrían rojos por culpa del andamio.
  fs.copyFileSync(path.join(raiz, VERIFICADOR), path.join(caja, VERIFICADOR));
  return { destino, caja };
}

function ejecutar(caja, entorno = {}) {
  const r = spawnSync(process.execPath, [VERIFICADOR], {
    cwd: caja, encoding: 'utf8',
    env: { ...process.env, ...entorno },
    timeout: 180_000,
  });
  return { salida: (r.stdout || '') + (r.stderr || ''), codigo: r.status };
}

// `esperaba` es el renglón que debe aparecer: 'ATRÁS  front', '  ?    storage'.
function escenario(titulo, { codigo, canal, marca }, preparar, entorno = {}) {
  const { destino, caja } = clonar();
  try {
    preparar(caja);
    const r = ejecutar(caja, entorno);
    const renglon = r.salida.split('\n')
      .find(l => l.includes(` ${canal.padEnd(12)}`) || l.trim().startsWith(canal));
    const marcaOk = renglon ? renglon.startsWith(marca) : false;
    const codigoOk = r.codigo === codigo;

    if (codigoOk && marcaOk) {
      console.log(`  ok   ${titulo}`);
      console.log(`       → ${renglon.trim()}`);
    } else {
      fallas++;
      console.log(`FALLA  ${titulo}`);
      if (!codigoOk) console.log(`       esperaba salir ${codigo} y salió ${r.codigo}`);
      if (!marcaOk) {
        console.log(`       esperaba «${marca}» en el renglón de ${canal}`);
        console.log(`       y vi: ${renglon ? renglon.trim() : '(ningún renglón de ese canal)'}`);
      }
      console.log(r.salida.split('\n').map(l => `       | ${l}`).join('\n'));
    }
  } finally {
    fs.rmSync(destino, { recursive: true, force: true });
  }
}

const commitear = (caja, mensaje) => {
  correr('git', ['add', '-A'], { cwd: caja });
  correr('git', ['-c', 'user.email=contraprueba@local', '-c', 'user.name=contraprueba',
    'commit', '--quiet', '--no-verify', '-m', mensaje], { cwd: caja });
};

console.log('\n¿El verificador sabe decir que NO?\n');

// ── 1. Lo que ni llegó a un commit no está desplegado en ningún lado ────────
escenario('un archivo desplegable sin commitear se ve como ATRÁS',
  { codigo: 1, canal: 'árbol', marca: 'ATRÁS' },
  caja => fs.writeFileSync(path.join(caja, 'src', 'zz-contraprueba.js'), '// nada\n'));

// ── 2. El front vivo compiló otro commit ────────────────────────────────────
// Se retrocede el clon al commit anterior que tocó `src`: así lo vivo y el
// HEAD del clon difieren en lo que sí compila el bundle.
escenario('un HEAD que no es el commit del bundle vivo se ve como ATRÁS',
  { codigo: 1, canal: 'front', marca: 'ATRÁS' },
  caja => {
    const previos = correr('git', ['log', '-n', '2', '--format=%H', '--', 'src'], { cwd: caja })
      .split('\n');
    if (previos.length < 2) throw new Error('no hay dos commits que toquen src');
    correr('git', ['checkout', '--detach', '--quiet', previos[1]], { cwd: caja });
  });

// ── 3 y 4. Las reglas del repositorio no son las que están vivas ────────────
for (const [canal, archivo] of [['firestore', 'firestore.rules'], ['storage', 'storage.rules']]) {
  escenario(`un ${archivo} que no es el vivo se ve como ATRÁS`,
    { codigo: 1, canal, marca: 'ATRÁS' },
    caja => {
      const p = path.join(caja, archivo);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\n// renglón de contraprueba\n');
      commitear(caja, 'contraprueba: reglas distintas de las vivas');
    });
}

// ── 5. Las funciones desplegadas corren otro index.js ───────────────────────
escenario('un functions/index.js que no es el desplegado se ve como ATRÁS',
  { codigo: 1, canal: 'funciones', marca: 'ATRÁS' },
  caja => {
    const p = path.join(caja, 'functions', 'index.js');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\n// renglón de contraprueba\n');
    commitear(caja, 'contraprueba: funciones distintas de las desplegadas');
  });

// ── 6. Sin poder mirar el sitio no se dice «está bien», se dice «no sé» ─────
escenario('un sitio que no contesta sale 2, no 0',
  { codigo: NO_ARRANCO, canal: 'front', marca: '  ?' },
  () => {},
  { SITIO: 'https://campo-fosmon.netlify.app/no-existe-contraprueba' });

// ── 7. Sin token tampoco se adivina ─────────────────────────────────────────
// Se le quita `gcloud` del PATH: es la forma honesta de simular «no hay
// credenciales» sin tocar la sesión de nadie.
escenario('sin credenciales los tres canales de nube salen 2, no 0',
  { codigo: NO_ARRANCO, canal: 'funciones', marca: '  ?' },
  () => {},
  { PATH: '/usr/bin:/bin' });

console.log('\n' + '─'.repeat(70));
if (fallas) {
  console.log(`${fallas} escenario(s) en rojo: el verificador no distingue lo que dice distinguir.`);
  process.exit(1);
}
console.log('Los siete escenarios: el verificador dice que no cuando la respuesta es no.');
process.exit(0);
