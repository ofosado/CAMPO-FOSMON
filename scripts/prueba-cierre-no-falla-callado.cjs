#!/usr/bin/env node
// Prueba: si el historial semanal no se puede guardar, el cierre NO dice
// "listo". El error sube hasta quien cerró la semana.
//
// Existe por la obra 0114. Durante siete semanas el residente cerró, la
// bitácora anotó "captura oficial", la pantalla dijo "Guardado" y el historial
// llevaba parado desde julio: el documento rozaba el límite de 1 MiB y la
// escritura fallaba. `fsSet` devolvía `false`, nadie miraba el resultado, y la
// función devolvía el snapshot como si lo hubiera escrito.
//
// Un guardado exitoso NO demuestra que esto esté arreglado — antes también
// "funcionaba" mientras hubiera sitio. Lo que hay que probar es el fallo: que
// cuando la escritura revienta, revienta hacia arriba y con un mensaje útil.
//
// Uso:  node scripts/prueba-cierre-no-falla-callado.cjs [archivo]

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  ClassDeclaration(p) { decl[p.node.id.name] = src.slice(p.node.start, p.node.end); },
});

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

const faltan = ['crearSnapshotAvance', 'tamañoFirestore', 'mensajeFalloSnapshot',
                'avanceFisicoPonderado'].filter(n => !decl[n]);
if (faltan.length) noArranco(faltan);

// ── Montaje: el entorno mínimo que `crearSnapshotAvance` necesita ───────────
// `setDoc` es el punto de fallo que se quiere probar; se controla desde fuera.
let modoEscritura = 'ok';
let escrituras = 0;

const preludio = `
  const ESQUEMA_SNAPSHOT = 3;
  const fbDb = {};
  const doc = (...a) => ({ ruta: a.slice(1).join('/') });
  const setDoc = async (ref, datos) => {
    escrituras++;
    if (modoEscritura === 'lleno') {
      const e = new Error('Document cannot be written because its size (1,398,101 bytes) exceeds the maximum allowed size of 1,048,576 bytes.');
      e.code = 'invalid-argument';
      throw e;
    }
    if (modoEscritura === 'red') throw new Error('Failed to get document because the client is offline.');
    return undefined;
  };
  const fsGet = async () => ({ semanas: historialFalso });
  // El ayudante viejo, tal como se comportaba: se traga el error y devuelve
  // false. Está aquí para que la contraprueba —el mismo archivo con la
  // escritura anterior— se pueda montar y salga en rojo por comportamiento,
  // no por falta de dependencias.
  const fsSet = async (ruta, datos) => {
    try { await setDoc({ ruta }, datos, { merge: true }); return true; }
    catch (e) { return false; }
  };
  const semanaISO = () => ({ semana: 39, año: 2026 });
  const snapshotId = (s, a) => 'S' + s + '-' + a;
  ${decl['ErrorSnapshot']}
  const tamañoFirestore = ${decl['tamañoFirestore']};
  const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
  const mensajeFalloSnapshot = ${decl['mensajeFalloSnapshot']};
  const importeEjecutadoPartida = ${decl['importeEjecutadoPartida']};
  const importeCatalogoPartida = ${decl['importeCatalogoPartida']};
  const desgloseEjecutado = ${decl['desgloseEjecutado']};
  const avanceFisicoPonderado = ${decl['avanceFisicoPonderado']};
`;

const montar = () => new Function(
  'escrituras', 'modoEscritura', 'historialFalso', 'reportar',
  `"use strict";
   let _e = escrituras;
   const _inc = () => _e++;
   ${preludio.replace('escrituras++;', '_inc();')}
   const crearSnapshotAvance = ${decl['crearSnapshotAvance']};
   return { crearSnapshotAvance, cuenta: () => _e, ErrorSnapshot };`
);

const correr = async (modo, historial = []) => {
  const mod = montar()(0, modo, historial, null);
  const subs = [
    { sec: 'A-1', a: 100, imp: 1000000, cant: 10, pu: 100000, cantEjec: 10 },
    { sec: 'A-2', a: 50,  imp: 2000000, cant: 20, pu: 100000, cantEjec: 10 },
  ];
  try {
    const r = await mod.crearSnapshotAvance('0114', subs, 'pcastillo@fosmon.com.mx',
      'oficial', false, 3000000);
    return { devolvio: r, lanzo: null, escrituras: mod.cuenta() };
  } catch (e) {
    return { devolvio: undefined, lanzo: e, escrituras: mod.cuenta() };
  }
};

(async () => {
  // 1) Camino feliz: guarda y devuelve el snapshot.
  const ok = await correr('ok');
  check(!ok.lanzo && ok.devolvio && ok.devolvio.id === 'S39-2026',
    'cuando la escritura funciona, devuelve el snapshot',
    ok.devolvio ? ok.devolvio.id : String(ok.lanzo));

  // 2) LO QUE IMPORTA: el documento está lleno. Antes devolvía el snapshot
  //    igual y el cierre decía "listo". Ahora tiene que lanzar.
  const lleno = await correr('lleno');
  check(!!lleno.lanzo, 'si el documento está lleno, NO devuelve el snapshot: lanza',
    lleno.lanzo ? lleno.lanzo.name : `devolvió ${JSON.stringify(lleno.devolvio)?.slice(0, 40)}`);
  check(lleno.lanzo?.name === 'ErrorSnapshot',
    'lo que lanza es un ErrorSnapshot, distinguible de un fallo cualquiera');
  check(lleno.devolvio === undefined,
    'y no devuelve nada que el llamador pueda confundir con éxito');

  // 3) El mensaje tiene que servirle a quien cerró la semana, no a sistemas.
  const m = lleno.lanzo?.message || '';
  check(/límite de tamaño/i.test(m), 'el mensaje dice que el historial llegó al límite');
  check(/captura de avance SÍ quedó guardada/i.test(m),
    'y le dice que su captura NO se perdió — sin eso, recaptura lo que ya está');
  check(/0114/.test(m), 'nombra la obra, para que sistemas sepa cuál compactar');
  check(!/undefined|NaN|\[object/.test(m), 'el mensaje no trae basura', m.slice(0, 60) + '…');
  // Firestore puede rechazar por tamaño sin que la medición local lo confirme
  // —aquí el historial va vacío—. Entonces la cifra se calla, en vez de decir
  // "llegó al límite (0 KB de 1024 KB)", que se desmiente sola.
  check(!/\b0 KB\b/.test(m),
    'no afirma un tamaño absurdo cuando su propia medición no lo respalda',
    /\d+ KB/.test(m) ? `dice "${m.match(/\d+ KB[^)]*/)?.[0]}"` : 'omite la cifra');

  // El mismo caso pero con un historial que SÍ pesa: entonces la cifra sí sale.
  const gordo = [{ id: 'S1', subs: Array.from({ length: 4000 },
    (_, i) => ({ sec: 'P-' + i, sub: 'X'.repeat(240), a: 50, imp: 1000 })) }];
  const pesado = await correr('lleno', gordo);
  check(/\d{3,} KB de 1024 KB/.test(pesado.lanzo?.message || ''),
    'y cuando sí lo respalda, la cifra aparece',
    (pesado.lanzo?.message || '').match(/\d+ KB de 1024 KB/)?.[0] || 'no salió');

  // 4) Un fallo de red también se propaga, con otro mensaje.
  const red = await correr('red');
  check(red.lanzo?.name === 'ErrorSnapshot', 'un fallo de red también se propaga');
  check(/Vuelve a intentar/i.test(red.lanzo?.message || ''),
    'y ese sí invita a reintentar, porque puede ser pasajero');
  check(!/límite de tamaño/i.test(red.lanzo?.message || ''),
    'sin culpar al tamaño cuando el problema es otro');

  // 5) La causa original se conserva para el log.
  check(!!lleno.lanzo?.causa, 'conserva la causa original para diagnóstico',
    lleno.lanzo?.causa?.code || '');

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})();
