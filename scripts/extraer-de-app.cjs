// ── SACAR CÓDIGO VIVO DE `src/App.jsx`, Y DECIRLO EN VOZ ALTA ──────────────
//
// Los bancos y los guiones de medición no reimplementan lo que mide la app: lo
// sacan del archivo y lo EJECUTAN. Una medición que copia la cuenta se está
// comprobando contra sí misma.
//
// Sacar por nombre tiene una consecuencia conocida: el día que alguien renombra
// el símbolo, la herramienta deja de encontrar lo que iba a ejercitar. Para los
// BANCOS eso ya estaba resuelto —salen con 2 y la suite grita—, pero los
// GUIONES DE MEDICIÓN no están en la suite, así que nadie los ve morir.
//
// Y sí murieron: `medir-evidencia-para-migrar.cjs` buscaba `fotosDeSub` y
// `medir-fotos.cjs` buscaba `conFotos` dentro de `FotosCliente`; las dos cosas
// cambiaron de nombre y de sitio en la unificación de evidencia, y los dos
// guiones llevaban semanas sin arrancar. Importa porque son la herramienta con
// la que se decide una escritura a producción: el día que alguien quiera medir
// antes de migrar se encuentra el guion muerto, y la tentación va a ser migrar
// sin medir.
//
// Este módulo es el sitio único por donde se pide. Dos cosas a cambio:
//
//   1. Resuelve las dependencias. Pedir `evidenciaDeObra` trae consigo los
//      helpers de nivel superior que usa, sin que el guion los enumere. Una
//      lista de dependencias tecleada a mano es una copia más que mantener.
//   2. La petición queda ESCRITA en una llamada reconocible, y por eso
//      `prueba-herramientas-de-medicion-viven.cjs` puede recorrer los guiones,
//      leer qué pide cada uno y exigirlo de verdad — sin repetir la lista.
//
// Cuando algo no está, se lanza `SimboloPerdido` con los nombres. Quien lo
// atrape decide si eso es un 2 (un banco) o un mensaje y un 2 (un guion); lo
// que no puede pasar es seguir con un hueco.

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARCHIVO = path.join(RAIZ, 'src/App.jsx');
const ARCHIVO_FUNCIONES = path.join(RAIZ, 'functions/index.js');

class SimboloPerdido extends Error {
  constructor(faltantes, donde) {
    super(`No se pudo extraer de ${donde}: ` + faltantes.map(n => `\`${n}\``).join(', '));
    this.name = 'SimboloPerdido';
    this.faltantes = faltantes;
    this.archivo = donde;
  }
}

// Lo que no hay que buscar en el archivo porque lo pone el motor. Se toma del
// propio `globalThis` más lo del navegador, que en Node no existe pero el
// código de la app nombra. No se repite la lista de `verificar-ambito.cjs`:
// aquí sobra ser generoso —un falso global sólo provoca un `is not defined` al
// ejecutar, que es ruidoso— mientras que allá un falso global ESCONDE un
// defecto, y por eso aquella es la estricta.
const DEL_MOTOR = new Set(Object.getOwnPropertyNames(globalThis).concat([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'fetch',
  'alert', 'confirm', 'prompt', 'console', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'FileReader', 'Blob',
  'File', 'FormData', 'Image', 'URL', 'URLSearchParams', 'XMLHttpRequest',
  'Event', 'CustomEvent', 'AbortController', 'crypto', 'btoa', 'atob',
  'structuredClone', 'performance', 'location', 'history', 'matchMedia',
  'undefined', 'arguments',
]));

const _cache = new Map();

function indexar(archivo) {
  if (_cache.has(archivo)) return _cache.get(archivo);
  const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
  const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;
  const src = fs.readFileSync(archivo, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

  // Sólo nivel superior del módulo. Un `const` dentro de un componente no es
  // un símbolo del que se pueda depender: hoy está y mañana se mueve, que es
  // exactamente lo que le pasó a `conFotos`.
  const decl = new Map();
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.type !== 'Identifier' || !p.node.init) return;
      if (p.scope.parent) return;
      if (decl.has(p.node.id.name)) return;
      decl.set(p.node.id.name, {
        nombre: p.node.id.name, inicio: p.node.start,
        fuente: `const ${p.node.id.name} = ${src.slice(p.node.init.start, p.node.init.end)};`,
      });
    },
    FunctionDeclaration(p) {
      if (!p.node.id || p.scope.parent?.parent) return;
      if (decl.has(p.node.id.name)) return;
      decl.set(p.node.id.name, {
        nombre: p.node.id.name, inicio: p.node.start,
        fuente: src.slice(p.node.start, p.node.end),
      });
    },
  });

  // Los identificadores libres de un trozo: los que usa y no declara. Se
  // calcula parseando el trozo, no leyéndolo con una expresión regular — una
  // regular contaría nombres de propiedad y cadenas.
  const libresDe = (fuente) => {
    const sub = parse(fuente, { sourceType: 'module', plugins: ['jsx'] });
    const libres = new Set();
    traverse(sub, {
      ReferencedIdentifier(p) {
        const n = p.node.name;
        if (DEL_MOTOR.has(n)) return;
        if (p.scope.hasBinding(n, true)) return;
        libres.add(n);
      },
    });
    return libres;
  };

  const idx = { decl, libresDe };
  _cache.set(archivo, idx);
  return idx;
}

// El CÓDIGO de los símbolos pedidos y de todo lo que necesitan, en el orden
// del archivo, listo para pegar dentro de un `new Function`.
//
// Existe aparte de `deArchivo` porque hay bancos que no pueden conformarse con
// los símbolos ya ejecutables: tienen que pegar este cuerpo JUNTO a un trozo
// que vive DENTRO de un componente —`Captura.addFoto`, `App.evid`— y que por
// eso `deArchivo` no puede devolver. Hasta hoy esos bancos armaban el cuerpo
// con una lista tecleada a mano, y la lista era la segunda copia: el
// 2026-10-26 `fechaDeTimestamp` pasó a apoyarse en `fechaEnZonaObra` y TRES
// bancos —`reglas-evidencia`, `anular-no-borra`, `plazo-multianual`—
// reventaron con un `is not defined` a media corrida, después de que su propia
// comprobación de completitud diera la cosecha por buena. Nombrar lo que se
// quiere está bien; nombrar lo que eso necesita es mantener una copia del
// grafo de dependencias, y las copias se desincronizan.
//
// `tolerante` es para el banco cuya contraprueba QUITA un símbolo a propósito
// y quiere que la aserción salga ROJA en lugar de que el banco no arranque.
// Por omisión un símbolo raíz ausente es `SimboloPerdido`.
function fuenteDe(archivo, nombres, { tolerante = false } = {}) {
  const pedidos = [].concat(nombres).flat();
  const donde = path.relative(RAIZ, archivo);
  const { decl, libresDe } = indexar(archivo);

  const faltan = pedidos.filter(n => !decl.has(n));
  if (faltan.length && !tolerante) throw new SimboloPerdido(faltan, donde);

  // Cierre transitivo. Lo que no esté declarado arriba y no sea del motor se
  // deja pasar: si de verdad hacía falta, al ejecutar sale un `is not
  // defined`, que es ruidoso y señala el renglón. Pararse aquí sería negarse a
  // extraer un helper por un identificador que ninguna de sus ramas usa.
  const necesarios = new Map();
  const pendientes = [...pedidos];
  while (pendientes.length) {
    const n = pendientes.pop();
    if (necesarios.has(n) || !decl.has(n)) continue;
    const d = decl.get(n);
    necesarios.set(n, d);
    for (const libre of libresDe(d.fuente)) if (decl.has(libre)) pendientes.push(libre);
  }

  // En el orden en que están en el archivo: ahí se declaran antes de usarse, y
  // reordenar por el grafo rompería las referencias mutuas que sí funcionan por
  // izado.
  const cuerpo = [...necesarios.values()]
    .sort((a, b) => a.inicio - b.inicio)
    .map(d => d.fuente)
    .join('\n\n');

  return { cuerpo, presentes: pedidos.filter(n => decl.has(n)), faltan };
}

// Pide símbolos de un archivo del repo y devuelve un objeto con ellos, ya
// ejecutables, con sus dependencias de nivel superior resueltas.
function deArchivo(archivo, ...nombres) {
  const pedidos = nombres.flat();
  const { cuerpo } = fuenteDe(archivo, pedidos);
  const devuelve = `return { ${pedidos.join(', ')} };`;
  return new Function(`"use strict";\n${cuerpo}\n${devuelve}`)();
}

// De `src/App.jsx`. Es la llamada que `prueba-herramientas-de-medicion-viven`
// reconoce y ejercita, así que los guiones de medición piden por aquí.
const deApp = (...nombres) => deArchivo(ARCHIVO, ...nombres);

// De `functions/index.js`. Existe porque hay cuentas escritas DOS veces —una
// por despliegue, sin build compartido— y la única forma de exigir que
// coincidan es correr las dos. Ver el preámbulo de `diasSinCapturaDe` allá.
const deFunciones = (...nombres) => deArchivo(ARCHIVO_FUNCIONES, ...nombres);

// El cuerpo en texto, de `src/App.jsx`, para los bancos que además tienen que
// pegar un trozo de dentro de un componente.
const fuenteDeApp = (nombres, opciones) => fuenteDe(ARCHIVO, nombres, opciones);

module.exports = {
  deApp, deFunciones, deArchivo, fuenteDe, fuenteDeApp,
  SimboloPerdido, ARCHIVO, ARCHIVO_FUNCIONES,
};
