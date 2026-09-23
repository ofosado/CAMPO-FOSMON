#!/usr/bin/env node
// Prueba: la migración de nómina no sube la bandera si alguien capturó
// mientras corría.
//
// El hueco: entre que el guion lee el documento viejo y que levanta la
// bandera pasan segundos, y en ese rato un residente puede guardar una raya
// desde la app. Esa carga entra al documento viejo —el que la app todavía
// usa— y la subcolección recién escrita no la tiene. Al subir la bandera
// desaparecería de la pantalla, y en nómina no hay copia en ningún otro lado
// salvo el Excel, si alguien lo guardó.
//
// No comprueba que exista un `if`: extrae del guion la comparación real y le
// da pares de historiales, incluidos los que la harían fallar si sólo contara
// registros.
//
// Uso:  node scripts/prueba-migracion-no-pisa-capturas.cjs [archivo]

'use strict';

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

const archivo = process.argv[2] ||
  path.join(raiz, 'scripts/migrar-nomina-subcoleccion.cjs');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'script' });

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
});

const NECESARIOS = ['MXN', 'huella', 'nombrar', 'compararOrigen'];
const faltan = NECESARIOS.filter(n => !decl[n]);

// La otra mitad: que la comparación esté ENCHUFADA antes de la bandera. Una
// comparación perfecta que nadie llama no protege nada. Se busca la ESCRITURA
// de la bandera —el PATCH a config/info— no su nombre, que también sale en los
// comentarios de cabecera.
let iBandera = -1;
traverse(ast, {
  CallExpression(p) {
    if (iBandera >= 0 || p.node.callee.name !== 'pedir') return;
    const [metodo, ruta] = p.node.arguments;
    if (metodo?.value !== 'PATCH' || !ruta) return;
    if (/config\/info/.test(src.slice(ruta.start, ruta.end))) iBandera = p.node.start;
  },
});
const iLlamada = src.indexOf('seMovioElOrigen(obra, plan)');
if (iLlamada < 0) faltan.push('la llamada a seMovioElOrigen en el programa');
if (iBandera < 0) faltan.push('el PATCH que sube la bandera en config/info');
if (iLlamada >= 0 && iBandera >= 0 && iLlamada > iBandera)
  faltan.push('la comprobación corre DESPUÉS de subir la bandera, no antes');
if (faltan.length) noArranco(faltan, path.basename(archivo));

const { compararOrigen } = new Function(`"use strict";
  ${NECESARIOS.map(n => `const ${n} = ${decl[n]};`).join('\n  ')}
  return { compararOrigen };`)();

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Las cargas reales de la 0126: su semana 38 rayada en dos archivos.
const carga = (archivo, semana, total, n) => ({
  archivo, semana, fecha: '22/9/2026', totalNomina: total,
  trabajadores: [...Array(n)].map((_, i) => ({ nombre: `T${i}` })),
});
const P1 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 38.xlsx', 'SEM 38', 502603, 51);
const P2 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 38. P2xlsx.xlsx', 'SEM 38', 152950, 35);
const S37 = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 37.xlsx', 'SEM 37', 647179, 138);

console.log('1. Si nadie tocó nada, la migración sigue\n');
check(compararOrigen([S37, P1, P2], [S37, P1, P2]) === null,
  'un origen idéntico deja subir la bandera');
// El orden del arreglo no significa nada: Firestore no lo garantiza y la app
// reescribe el arreglo entero en cada guardado. Reordenar no es capturar.
check(compararOrigen([S37, P1, P2], [P2, S37, P1]) === null,
  'y reordenar el arreglo tampoco lo frena — el orden no es un cambio');
check(compararOrigen([], []) === null,
  'una obra sin nómina no se toma por movida');

console.log('\n2. Una captura durante la migración la PARA\n');
const nueva = carga('NOMINA_FOSMON_0126_CANGREJERA_SEM 39.xlsx', 'SEM 39', 700000, 140);
const conNueva = compararOrigen([S37, P1, P2], [S37, P1, P2, nueva]);
check(conNueva !== null,
  'una raya capturada a media migración detiene la bandera');
check(/SEM 39/.test(conNueva || ''),
  'y el aviso dice QUÉ entró, no sólo que algo cambió',
  (conNueva || '').split('\n').find(l => /entró/.test(l))?.trim());
check(/entró/.test(conNueva || '') && !/salió/.test(conNueva || ''),
  'lo llama entrada, no salida');

console.log('\n3. Los cambios que NO cambian la cuenta — que contar no ve\n');
// Éste es el caso que hace que contar registros no baste: el residente
// corrige una carga mal subida. Un archivo sale, otro entra, la cuenta no se
// mueve, y la subcolección se quedó con la versión vieja.
const corregida = { ...P2, totalNomina: 160000 };
const editado = compararOrigen([S37, P1, P2], [S37, P1, corregida]);
check(editado !== null,
  'una carga EDITADA para la migración aunque la cuenta no cambie');
check(/entró/.test(editado || '') && /salió/.test(editado || ''),
  'y se reporta como la que salió y la que entró',
  `${(editado || '').split('\n').length - 1} línea(s) de detalle`);

// Borrar una carga y subir otra: misma cuenta, historial distinto.
const canjeada = compararOrigen([S37, P1, P2], [S37, P1, nueva]);
check(canjeada !== null,
  'borrar una carga y subir otra también para la migración');

console.log('\n4. Un borrado solo también la para\n');
const borrado = compararOrigen([S37, P1, P2], [S37, P1]);
check(borrado !== null, 'si alguien borró una carga, no se sube la bandera');
check(/salió/.test(borrado || '') && /SEM 38/.test(borrado || ''),
  'y se dice cuál se fue',
  (borrado || '').split('\n').find(l => /salió/.test(l))?.trim());

// El caso más caro: el documento viejo se vació entero. Si esto pasara
// inadvertido, la bandera subiría sobre una subcolección que sí tiene datos y
// nadie se enteraría hasta que faltara la última semana.
const vaciado = compararOrigen([S37, P1, P2], []);
check(vaciado !== null, 'un documento viejo vaciado entero la para en seco');

console.log('\n5. Las dos partes de una semana rayada se distinguen entre sí\n');
// P1 y P2 son la MISMA semana y el mismo día. Si la huella no mirara el
// archivo y el dinero, se verían iguales y perder una no se notaría.
const perdidaUnaParte = compararOrigen([S37, P1, P2], [S37, P1, P1]);
check(perdidaUnaParte !== null,
  'sustituir una parte por una copia de la otra no pasa desapercibido');

console.log(fallas
  ? `\n${fallas} comprobación(es) en rojo.`
  : '\nTodas las comprobaciones en verde.');
process.exit(fallas ? 1 : 0);
