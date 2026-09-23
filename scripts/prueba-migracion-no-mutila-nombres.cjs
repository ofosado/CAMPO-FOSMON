#!/usr/bin/env node
// Prueba: la migración de nómina no mutila los nombres, y se da cuenta si
// alguien los mutila.
//
// El 2026-09-23 la migración de la 0112 falló en el paso 4 y pasó al
// repetirla, con los datos idénticos. La causa era el transporte: el cuerpo de
// la respuesta se juntaba con `b += trozo`, que decodifica cada trozo por su
// cuenta, y un carácter UTF-8 de varios bytes partido en la frontera de dos
// trozos TCP salía como carácter de reemplazo. Dónde caen las fronteras
// depende de la red.
//
// El rojo falso era lo de menos. Lo grave es el verde falso: si se corrompe la
// lectura del ORIGEN, el guion escribe el nombre mutilado y luego lo compara
// contra la misma lectura corrupta. Cuadran, la bandera sube, y el apellido
// queda roto sin nada que lo delate. Por eso aquí se comprueban las dos cosas:
// que el transporte no parta caracteres, y que exista una comparación que
// mire el origen LEÍDO OTRA VEZ.
//
// No comprueba que existan nombres: extrae del guion las funciones reales y
// les da entradas que distinguen un arreglo de verdad de un andamio.
//
// Uso:  node scripts/prueba-migracion-no-mutila-nombres.cjs [archivo]

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');

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

const NECESARIOS = ['juntarCuerpo', 'firmaNombres', 'compararNombres'];
const faltan = NECESARIOS.filter(n => !decl[n]);

// El cotejo de nombres tiene que correr ANTES de la bandera, y contra el
// origen releído. Se ancla en la ESCRITURA de la bandera —el PATCH a
// config/info— no en su nombre, que también sale en los comentarios.
let iBandera = -1;
traverse(ast, {
  CallExpression(p) {
    if (iBandera >= 0 || p.node.callee.name !== 'pedir') return;
    const [metodo, ruta] = p.node.arguments;
    if (metodo?.value !== 'PATCH' || !ruta) return;
    if (/config\/info/.test(src.slice(ruta.start, ruta.end))) iBandera = p.node.start;
  },
});
const iCotejo = src.indexOf('compararNombres(ahoraRegs, leidos)');
const iRelectura = src.indexOf('await leerOrigen(obra)');
if (iCotejo < 0)
  faltan.push('la llamada a compararNombres contra el origen releído');
if (iRelectura < 0)
  faltan.push('la relectura del origen (leerOrigen) en el programa');
if (iBandera < 0) faltan.push('el PATCH que sube la bandera en config/info');
if (iCotejo >= 0 && iBandera >= 0 && iCotejo > iBandera)
  faltan.push('el cotejo de nombres corre DESPUÉS de subir la bandera, no antes');
if (iCotejo >= 0 && iRelectura >= 0 && iRelectura > iCotejo)
  faltan.push('el origen se relee DESPUÉS de cotejar, así que no se coteja contra nada');
if (faltan.length) noArranco(faltan, path.basename(archivo));

const { juntarCuerpo, compararNombres } = new Function(`"use strict";
  ${NECESARIOS.map(n => `const ${n} = ${decl[n]};`).join('\n  ')}
  return { juntarCuerpo, firmaNombres, compararNombres };`)();

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Nombres reales de las nóminas de la 0112 y la 0127: los acentos y la Ñ no
// son adorno, son lo que se parte.
const NOMBRE = 'MARÍA DE LOURDES MUÑOZ PEÑA';
const CUERPO = JSON.stringify({ fields: { nombre: { stringValue: NOMBRE } } });

// Emite el cuerpo en dos trozos, cortando EN MEDIO del carácter que se indique.
const enDosTrozos = (texto, caracter) => {
  const bytes = Buffer.from(texto, 'utf8');
  const i = bytes.indexOf(Buffer.from(caracter, 'utf8'));
  if (i < 0) throw new Error(`«${caracter}» no está en el cuerpo de prueba`);
  const resp = new EventEmitter();
  process.nextTick(() => {
    resp.emit('data', bytes.subarray(0, i + 1));   // primer byte del carácter
    resp.emit('data', bytes.subarray(i + 1));      // el segundo, aparte
    resp.emit('end');
  });
  return resp;
};

const juntarConPromesa = (resp) => new Promise(res => juntarCuerpo(resp, res));

(async () => {
  console.log('1. El transporte no parte caracteres\n');

  for (const c of ['Í', 'Ñ']) {
    const texto = await juntarConPromesa(enDosTrozos(CUERPO, c));
    let leido;
    try { leido = JSON.parse(texto).fields.nombre.stringValue; }
    catch (e) { leido = `«JSON.parse reventó: ${e.message}»`; }
    check(leido === NOMBRE,
      `un cuerpo cortado en medio de la «${c}» se lee entero`,
      JSON.stringify(leido));
  }

  // Contraprueba: la forma vieja, sobre la MISMA entrada, sí la mutila. Si
  // esto dejara de fallar, la prueba de arriba no estaría midiendo nada.
  const comoEstabaAntes = (resp) => new Promise(res => {
    let b = ''; resp.on('data', d => b += d); resp.on('end', () => res(b));
  });
  const mutilado = JSON.parse(await comoEstabaAntes(enDosTrozos(CUERPO, 'Í')))
    .fields.nombre.stringValue;
  check(mutilado !== NOMBRE && mutilado.includes('\uFFFD'),
    'contraprueba: juntar con `b += trozo` sí lo mutila',
    JSON.stringify(mutilado));

  // Y que no se rompa lo normal: un cuerpo en un solo trozo, y uno vacío.
  const unTrozo = new EventEmitter();
  process.nextTick(() => {
    unTrozo.emit('data', Buffer.from(CUERPO, 'utf8'));
    unTrozo.emit('end');
  });
  check(JSON.parse(await juntarConPromesa(unTrozo)).fields.nombre.stringValue === NOMBRE,
    'un cuerpo que llega de una sola pieza sigue llegando bien');

  const vacio = new EventEmitter();
  process.nextTick(() => vacio.emit('end'));
  check(await juntarConPromesa(vacio) === '',
    'una respuesta sin cuerpo da cadena vacía, no revienta');

  console.log('\n2. Contra el origen releído: un nombre mutilado NO pasa\n');

  const carga = (archivo, nombres) => ({
    archivo, semana: 'Semana 36', fecha: '2/9/2026', totalNomina: 244087.5,
    trabajadores: nombres.map(nombre => ({ nombre })),
  });
  const NOMBRES = [NOMBRE, 'JOSÉ ANTONIO NÚÑEZ', 'FABIOLA MORENO CRUZ'];
  const ORIGEN = [carga('NOMINA_FOSMON_MALECON_SEM36.xlsx', NOMBRES)];

  check(compararNombres(ORIGEN, [carga('NOMINA_FOSMON_MALECON_SEM36.xlsx', NOMBRES)]).length === 0,
    'una copia fiel no levanta ninguna queja');

  // El caso que cierra el agujero: el nombre llegó con un carácter de
  // reemplazo. La suma de dinero no se mueve, así que sólo lo ve esto.
  const roto = [NOMBRE.replace('Í', '\uFFFD\uFFFD'), NOMBRES[1], NOMBRES[2]];
  const qRoto = compararNombres(ORIGEN, [carga('NOMINA_FOSMON_MALECON_SEM36.xlsx', roto)]);
  check(qRoto.length === 1, 'un nombre mutilado se detecta');
  check(/MAR.*A DE LOURDES/.test(qRoto[0] || '') && /trabajador 1/.test(qRoto[0] || ''),
    'y se dice QUIÉN y cómo se leyó de cada lado',
    (qRoto[0] || '').slice(0, 110));

  // Que la queja no dependa del orden en que vengan las cargas.
  const dos = [carga('A.xlsx', ['ANA']), carga('B.xlsx', ['BENITO'])];
  check(compararNombres(dos, [dos[1], dos[0]]).length === 0,
    'reordenar las cargas no se toma por mutilación');

  console.log('\n3. Lo que tampoco se le escapa\n');

  const faltaUno = compararNombres(ORIGEN,
    [carga('NOMINA_FOSMON_MALECON_SEM36.xlsx', NOMBRES.slice(0, 2))]);
  check(faltaUno.length === 1 && /3 trabajador\(es\) y la subcolección 2/.test(faltaUno[0]),
    'si a la subcolección le falta un trabajador, se dice',
    (faltaUno[0] || '').slice(0, 90));

  const otroArchivo = compararNombres(ORIGEN, [carga('OTRA_COSA.xlsx', NOMBRES)]);
  check(otroArchivo.length === 1 && /nombre del archivo/.test(otroArchivo[0]),
    'si el nombre del archivo no coincide, se dice eso y no se culpa a un nombre',
    (otroArchivo[0] || '').slice(0, 90));

  check(compararNombres(ORIGEN, []).length === 1,
    'una subcolección vacía contra un origen con cargas no pasa');
  check(compararNombres([], []).length === 0,
    'una obra sin nómina no se toma por mutilada');

  console.log('\n4. Sobre una respuesta HTTP de verdad, no simulada\n');

  // Las dos secciones anteriores usan un EventEmitter. Esto lo pasa por un
  // socket real, que es donde el defecto vivía.
  const bytes = Buffer.from(CUERPO, 'utf8');
  const corte = bytes.indexOf(Buffer.from('Í', 'utf8')) + 1;
  const servidor = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(bytes.subarray(0, corte));
    setTimeout(() => res.end(bytes.subarray(corte)), 20);
  });
  await new Promise(r => servidor.listen(0, r));
  const texto = await new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: servidor.address().port },
      resp => juntarCuerpo(resp, res)).on('error', rej);
  });
  servidor.close();
  check(JSON.parse(texto).fields.nombre.stringValue === NOMBRE,
    'por un socket real, con el carácter partido entre dos paquetes');

  console.log(fallas
    ? `\n${fallas} comprobación(es) en rojo.`
    : '\nTodas las comprobaciones en verde.');
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
