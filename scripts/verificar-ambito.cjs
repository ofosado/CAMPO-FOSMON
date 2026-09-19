#!/usr/bin/env node
// Verificación de ámbito: busca identificadores referenciados que no estén
// declarados en ningún scope léxico ni sean globales conocidos.
//
// Existe porque el proyecto no tiene linter y `src/App.jsx` tiene ~18k líneas:
// un identificador sin declarar pasa el build de Vite sin ruido y revienta en
// runtime. Usa @babel/parser + @babel/traverse, que ya están en node_modules
// como dependencias transitivas.
//
// Uso:
//     node scripts/verificar-ambito.cjs [archivo...]
//
// Sin argumentos revisa src/App.jsx. Sale con código 1 si encuentra algo.

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const archivos = process.argv.slice(2);
if (archivos.length === 0) archivos.push(path.join(raiz, 'src/App.jsx'));

const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis).concat([
  'window','document','navigator','localStorage','sessionStorage','fetch','alert','confirm','prompt',
  'console','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
  'FileReader','Blob','File','FormData','Image','URL','URLSearchParams','XMLHttpRequest','Event',
  'CustomEvent','AbortController','IntersectionObserver','ResizeObserver','MutationObserver',
  'crypto','btoa','atob','structuredClone','performance','location','history','matchMedia',
  'process','require','module','exports','__dirname','__filename',
  '__BUILD_SHA__','__BUILD_DATE__',
]));

let fallas = 0;

for (const archivo of archivos) {
  const rel = path.relative(raiz, path.resolve(archivo));
  const ast = parse(fs.readFileSync(archivo, 'utf8'), {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
  });

  const problemas = [];
  traverse(ast, {
    ReferencedIdentifier(p) {
      const n = p.node.name;
      if (GLOBALS.has(n)) return;
      if (p.scope.hasBinding(n, true)) return;
      problemas.push(`${rel}:${p.node.loc.start.line}  ·  ${n}`);
    },
  });

  if (problemas.length === 0) {
    console.log(`OK  ${rel} — ningún identificador sin declarar.`);
  } else {
    fallas += problemas.length;
    console.log(`FALLA  ${rel} — ${problemas.length} identificador(es) sin declarar:`);
    problemas.forEach(p => console.log('  ' + p));
  }
}

process.exit(fallas > 0 ? 1 : 0);
