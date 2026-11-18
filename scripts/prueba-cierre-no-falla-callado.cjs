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
const { cierreDe } = require('./extraer-de-app.cjs');

// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

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
`;

// LO QUE EL CIERRE NECESITA NO SE TECLEA. Aquí había ocho renglones
// enumerando a mano lo que `crearSnapshotAvance` usa del archivo, y la lista
// era una copia del grafo de dependencias. Murió el 2026-11-17: el recorte del
// historial pasó a contarse en bytes, el cierre empezó a llamar a
// `recortarHistorialAvance`, y este banco salió en rojo con catorce aserciones
// acusando al cierre de no avisar cuando falla —cosa que sigue haciendo
// perfectamente—. Ahora el cierre de dependencias lo resuelve `cierreDe`
// leyendo el archivo.
//
// Lo de `excluir` sí tiene que estar escrito, y no es lo mismo: son los
// DOBLES. `setDoc` es el punto de fallo que este banco controla desde fuera, y
// si la declaración de verdad entrara, el banco mediría la app en lugar de
// medir con su doble.
const DOBLES = [
  'ESQUEMA_SNAPSHOT', 'fbDb', 'doc', 'setDoc', 'fsGet', 'fsSet',
  'semanaISO', 'snapshotId', 'docObra',
];
// El cierre se le pide a una expresión que nombra TRES cosas: el cierre, y las
// dos que este banco devuelve para mirarlas aparte —el error y la frase—, que
// no son dependencias del cierre y nadie las traería por él.
const delArchivo = cierreDe(
  `[ ${decl['crearSnapshotAvance']}, mensajeFalloSnapshot, ErrorSnapshot ]`,
  { archivo, excluir: DOBLES });

// `conOrg` entra como parámetro y no como copia: es la función real de
// src/rutas-org.js, la misma con la que la app decide bajo qué organización
// cuelga cada ruta de obra. `docObra` se arma aquí igual que en App.jsx, con
// el `doc` de mentira del preludio, para poder seguir preguntando por la ruta.
let conOrgReal = null;
const montar = () => new Function(
  'escrituras', 'modoEscritura', 'historialFalso', 'reportar', 'conOrg',
  `"use strict";
   let _e = escrituras;
   const _inc = () => _e++;
   ${preludio.replace('escrituras++;', '_inc();')}
   const docObra = (...segs) => doc(fbDb, ...conOrg(['obras', ...segs].join('/')).split('/'));
   ${delArchivo}
   const crearSnapshotAvance = ${decl['crearSnapshotAvance']};
   return { crearSnapshotAvance, cuenta: () => _e, ErrorSnapshot,
            mensajeFalloSnapshot };`
);

// El AVISO que verá quien cerró la semana. Ya no es `error.message`: el error
// lleva los HECHOS y la frase se arma donde además se sabe si la captura de
// avance quedó, que es un dato del llamador y no de esta función. El cambio
// vino de que la frase «Tu captura de avance SÍ quedó guardada» era fija, y
// sobre una obra cerrada —donde la regla niega las dos escrituras— era falsa.
//
// Esta prueba sigue juzgando lo mismo que juzgaba: lo que el residente LEE.
// Por eso pasa `true` donde antes el mensaje lo daba por hecho — ése es el
// caso de la 0114 que la trajo al mundo— y hay una comprobación nueva para el
// otro, que antes ni existía.
const avisoDe = (mod, resultado, quedoLaCaptura = true, motivo = null) =>
  mod.mensajeFalloSnapshot(resultado.lanzo, quedoLaCaptura, motivo);

const correr = async (modo, historial = [], subsPropias = null) => {
  const mod = montar()(0, modo, historial, null, conOrgReal);
  const subs = subsPropias || [
    { sec: 'A-1', a: 100, imp: 1000000, cant: 10, pu: 100000, cantEjec: 10 },
    { sec: 'A-2', a: 50,  imp: 2000000, cant: 20, pu: 100000, cantEjec: 10 },
  ];
  try {
    const r = await mod.crearSnapshotAvance('0114', subs, 'pcastillo@fosmon.com.mx',
      'oficial', false, 3000000);
    return { devolvio: r, lanzo: null, escrituras: mod.cuenta(), mod };
  } catch (e) {
    return { devolvio: undefined, lanzo: e, escrituras: mod.cuenta(), mod };
  }
};

(async () => {
  ({ conOrg: conOrgReal } = await require('./rutas-org-para-pruebas.cjs')());

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

  check(Array.isArray(lleno.lanzo?.semanas) && lleno.lanzo?.obraId === '0114',
    'y el error lleva los hechos —las semanas y la obra— para que el aviso se arme arriba',
    `obra ${lleno.lanzo?.obraId} · ${lleno.lanzo?.semanas?.length} semana(s)`);

  // 3) El mensaje tiene que servirle a quien cerró la semana, no a sistemas.
  const m = avisoDe(lleno.mod, lleno, true);
  check(/límite de tamaño/i.test(m), 'el mensaje dice que el historial llegó al límite');
  check(/captura de avance SÍ quedó guardada/i.test(m),
    'y le dice que su captura NO se perdió — sin eso, recaptura lo que ya está');
  // El mismo fallo con la captura PERDIDA. Es el caso de la obra cerrada: la
  // regla niega el avance y el histórico, y el aviso no puede prometer el uno
  // porque el otro suele quedar.
  const mPerdido = avisoDe(lleno.mod, lleno, false);
  check(!/captura de avance SÍ quedó guardada/i.test(mPerdido),
    'y si la captura NO quedó, no lo promete', mPerdido.replace(/\n+/g, ' | '));
  check(/0114/.test(m), 'nombra la obra, para que sistemas sepa cuál compactar');
  check(!/undefined|NaN|\[object/.test(m), 'el mensaje no trae basura', m.slice(0, 60) + '…');
  // Firestore puede rechazar por tamaño sin que la medición local lo confirme
  // —aquí el historial va vacío—. Entonces la cifra se calla, en vez de decir
  // "llegó al límite (0 KB de 1024 KB)", que se desmiente sola.
  check(!/\b0 KB\b/.test(m),
    'no afirma un tamaño absurdo cuando su propia medición no lo respalda',
    /\d+ KB/.test(m) ? `dice "${m.match(/\d+ KB[^)]*/)?.[0]}"` : 'omite la cifra');

  // El mismo caso pero con un documento que SÍ pesa: entonces la cifra sí sale.
  //
  // LO GORDO ES LA SEMANA QUE SE ESTÁ ESCRIBIENDO, y no una semana vieja. Hasta
  // el 2026-11-17 el peso se le ponía al historial —una semana de 4000
  // partidas—, y eso dejó de poder pasar: desde que el recorte se cuenta en
  // bytes, una semana vieja que no cabe se tira antes de escribir, y el
  // documento que el aviso mide vuelve a ser pequeño. Entonces la cifra se
  // calla, y hace bien: es la aserción de arriba.
  //
  // El único peso que el recorte NO puede quitar es el del cierre que se está
  // haciendo, porque el piso es una semana. Así que el catálogo monstruoso va
  // en la captura, que además es el caso real: la obra cuyo catálogo ya no cabe
  // en un documento.
  // 16 000 partidas, no 4000. El snapshot NO guarda la descripción de la
  // partida —sólo `sec` y cinco números—, así que el relleno de 240 caracteres
  // que antes hacía el peso no llega al documento: 4000 partidas pesan 288 KB
  // y el aviso calla la cifra por debajo de 943 KB, que es el 90% del tope.
  // Con 16 000 el documento mide 1161 KB y la cifra tiene que salir. Medido
  // ejecutando `tamañoFirestore` del archivo, no estimado.
  const catalogoMonstruo = Array.from({ length: 16000 },
    (_, i) => ({ sec: 'P-' + i, a: 50, imp: 1000, cant: 10, pu: 100, cantEjec: 5 }));
  const pesado = await correr('lleno', [], catalogoMonstruo);
  const mPesado = avisoDe(pesado.mod, pesado, true);
  check(/\d{3,} KB de 1024 KB/.test(mPesado),
    'y cuando sí lo respalda, la cifra aparece',
    mPesado.match(/\d+ KB de 1024 KB/)?.[0] || 'no salió');

  // 4) Un fallo de red también se propaga, con otro mensaje.
  const red = await correr('red');
  const mRed = avisoDe(red.mod, red, true);
  check(red.lanzo?.name === 'ErrorSnapshot', 'un fallo de red también se propaga');
  check(/Vuelve a intentar/i.test(mRed),
    'y ese sí invita a reintentar, porque puede ser pasajero');
  check(!/límite de tamaño/i.test(mRed),
    'sin culpar al tamaño cuando el problema es otro');
  // Con una razón de por medio —la obra cerrada— reintentar es mandar a chocar
  // contra el candado. El aviso tiene que decir la razón y nada más.
  const mCerrada = avisoDe(red.mod, red, false,
    'Esta obra está cerrada: no admite capturas ni cierres de semana.');
  check(/est[áa] cerrada/i.test(mCerrada) && !/Vuelve a intentar/i.test(mCerrada),
    'y con la obra cerrada se dice la razón, sin mandar a reintentar contra el candado',
    mCerrada.replace(/\n+/g, ' | '));

  // 5) La causa original se conserva para el log.
  check(!!lleno.lanzo?.causa, 'conserva la causa original para diagnóstico',
    lleno.lanzo?.causa?.code || '');

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})();
