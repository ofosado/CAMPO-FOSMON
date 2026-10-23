#!/usr/bin/env node
// Prueba: EL RESPALDO SE DECLARA BUENO CUANDO TERMINÓ, NO CUANDO ARRANCÓ.
//
// ── DE DÓNDE SALE (#77) ────────────────────────────────────────────────────
// `:exportDocuments` es una operación de larga duración. El POST vuelve en
// milisegundos con un `operationName` y el trabajo sigue en background. Hasta
// el 2026-10-23, `backupSemanalFirestore` escribía el registro de salud con
// ese POST: `ok: true`, mensaje «Iniciado: …». El panel se ponía VERDE por
// haber PEDIDO el respaldo.
//
// El export falla después del arranque por cosas corrientes —se acaba el
// permiso al bucket, el prefijo del día ya existe, lo cancelan— y en todas el
// panel seguía verde. Un respaldo es justo lo que uno mira cuando ya perdió lo
// demás: es el último renglón que puede permitirse mentir. Hay un ROJO del
// 2026-09-21 en `backup_historial` que sólo se vio porque el POST mismo
// devolvió 400; un minuto más tarde y nadie se entera.
//
// `probarBackup` tenía el mismo defecto en su `return { ok: true, ... }`.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
// Nada de que un símbolo exista (P3). Todo lo que se juzga aquí es código
// EXTRAÍDO POR AST de `functions/index.js` y EJECUTADO. No hace falta
// emulador: lo que se mide es la decisión, y sus insumos —la respuesta de la
// API, el reloj, el sueño entre consultas— se inyectan.
//
//   §1  `clasificarExport`: qué cuenta como terminado, terminado-mal y en
//       curso, contra respuestas con la forma que devuelve Firestore.
//   §2  `esperarFinDelExport`: encadena consultas hasta el estado terminal,
//       se rinde DENTRO del plazo, y no confunde «no pude consultar» con
//       «el export falló».
//   §3  `mensajeDeRespaldo`: tres renglones distintos. El de «sin verificar»
//       no se puede leer como un respaldo bueno.
//   §4  el manejador del cron DE VERDAD: lo que termina en `global/health`.
//       Verde sólo si el export llegó a SUCCESSFUL.
//   §5  `ejecutarBackupFirestore` se niega a devolver un export sin
//       `operationName`: un respaldo que no se puede vigilar no se puede
//       declarar bueno.
//   §6  `probarBackup` deja de contestar `ok: true` por haber arrancado.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta `functions/index.js` por `ARCH_FNS` para correrse contra copias
// mutiladas. Cada mutación rompe SEMÁNTICA, no andamiaje, y se verificó que
// saca ROJO (1) y no NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-respaldo-verificado.cjs
//       node scripts/prueba-respaldo-verificado.cjs --contraprueba

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const ARCH_FNS = process.env.ARCH_FNS || path.join(raiz, 'functions/index.js');

// ── La contraprueba ────────────────────────────────────────────────────────
// Se corre primero, antes de abrir nada, porque relanza este mismo archivo.
if (process.argv[2] === '--contraprueba') {
  const MUTACIONES = [
    // El defecto tal como estaba: el registro se escribe con el arranque.
    { nombre: 'el panel vuelve a ponerse verde por haber ARRANCADO el export',
      de: '    const fin = await esperarFinDelExport(res.operationName, { plazoMs: 420 * 1000 });',
      a:  '    const fin = { ok: true, verificado: true, estado: "SUCCESSFUL", intentos: 0, esperaMs: 0 };' },

    // La otra mitad: se espera al final pero el registro no lo mira.
    { nombre: 'el registro de salud ignora en qué acabó el export',
      de: '    await registrarSalud("backup", fin.ok, mensaje, {',
      a:  '    await registrarSalud("backup", true, mensaje, {' },

    // «No pude verificar» presentado como «salió bien». Es el cero inventado
    // del P2 en su versión booleana: sin dato no es verde.
    { nombre: 'rendirse sin verificar cuenta como respaldo bueno',
      de: '        terminal: false, ok: false, verificado: false,\n        estado: ultimo.estado, detalle: ultimo.detalle,',
      a:  '        terminal: false, ok: true, verificado: true,\n        estado: ultimo.estado, detalle: ultimo.detalle,' },

    // Una operación que cerró CON error contada como buena.
    { nombre: 'un export que cerró con error se cuenta como terminado bien',
      de: '    if (err) return { terminal: true, ok: false, estado: estado || "FAILED", detalle: detalleErr };',
      a:  '' },

    // FAILED/CANCELLED dejan de ser terminales: el fallo claro se degrada a
    // «no se pudo verificar», que manda a mirar el bucket en vez de al export.
    { nombre: 'FAILED y CANCELLED dejan de ser estados terminales',
      de: '  if (EXPORT_TERMINAL_MAL.includes(estado)) {',
      a:  '  if (false) {' },

    // `done:true` con un estado que no es SUCCESSFUL, aceptado por optimismo.
    { nombre: 'done:true basta aunque el estado no sea SUCCESSFUL',
      de: '    if (estado && estado !== EXPORT_TERMINAL_OK) {',
      a:  '    if (false) {' },

    // No poder CONSULTAR no es que el export fallara. Si la lectura revienta
    // la espera entera, un 503 pasajero tumba la corrida y el diagnóstico.
    { nombre: 'un fallo al consultar revienta la espera en vez de reintentarse',
      de: "      ultimo = { estado: \"ILEGIBLE\", detalle: e?.message || String(e) };",
      a:  '      throw e;' },

    // Rendirse DESPUÉS del plazo: la función se pasa del presupuesto que la
    // separa de su propio timeout, y ahí no escribe nada.
    { nombre: 'la espera se pasa del plazo que tenía',
      de: '    if (ahora() - t0 + pausaMs >= plazoMs) {',
      a:  '    if (ahora() - t0 >= plazoMs) {' },

    // El renglón que lee un humano diciendo lo contrario de lo que pasó.
    { nombre: 'el mensaje de «sin verificar» se lee como respaldo completo',
      de: '  return (\n    `SIN VERIFICAR tras ${seg} s: el export arrancó y a esta hora seguía en ` +',
      a:  '  if (true) return `Completado: ${destino}`;\n  return (\n    `SIN VERIFICAR tras ${seg} s: el export arrancó y a esta hora seguía en ` +' },

    // Un export sin `operationName` no se puede vigilar, y lo que no se puede
    // vigilar no se puede declarar bueno.
    { nombre: 'se acepta un export que no devolvió operationName',
      de: '  if (!data.name) {',
      a:  '  if (false) {' },

    // El callable con el mismo defecto que el cron.
    { nombre: 'probarBackup vuelve a contestar ok:true por haber arrancado',
      de: '      ok: fin.ok,\n      verificado: fin.verificado,',
      a:  '      ok: true,\n      verificado: fin.verificado,' },
  ];

  const base = fs.readFileSync(ARCH_FNS, 'utf8');
  let malas = 0, i = 0;
  while (i < MUTACIONES.length) {
    const grupo = [MUTACIONES[i]];
    while (MUTACIONES[i + 1]?.par) grupo.push(MUTACIONES[++i]);
    i++;
    const nombre = grupo[0].nombre;

    let roto = base, aplicada = true;
    for (const m of grupo) {
      if (!roto.includes(m.de)) { aplicada = false; break; }
      roto = roto.replace(m.de, m.a);
    }
    if (!aplicada) {
      console.log(`SIN APLICAR  ${nombre}`);
      console.log('             el texto a mutar ya no está en functions/index.js.');
      malas++; continue;
    }
    const arch = path.join(os.tmpdir(),
      `respaldo-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(arch, roto);
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_FNS: arch } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      console.log((r.stdout + r.stderr).split('\n').slice(-14).map(l => '             ' + l).join('\n'));
    }
    try { fs.unlinkSync(arch); } catch {}
  }
  const total = MUTACIONES.filter(m => !m.par).length;
  console.log(malas === 0
    ? `\nLas ${total} mutaciones se ven.`
    : `\n${malas} de ${total} NO se ven.`);
  process.exit(malas === 0 ? 0 : 1);
}

// ── El banco ───────────────────────────────────────────────────────────────
noArranco.vigilarExcepciones(ARCH_FNS);

const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const src = fs.readFileSync(ARCH_FNS, 'utf8');
const ast = parse(src, {
  sourceType: 'script',
  plugins: ['optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const decl = {};
traverse(ast, {
  FunctionDeclaration(p) { if (p.node.id) decl[p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
});

// El manejador de un `exports.X = onAlgo(opciones, manejador)`: el SEGUNDO
// argumento, tomado por posición porque no tiene nombre.
function manejadorDe(nombreExportado) {
  let fuente = null;
  traverse(ast, {
    AssignmentExpression(p) {
      const izq = p.node.left;
      if (izq.type !== 'MemberExpression') return;
      if (izq.object.name !== 'exports' || izq.property.name !== nombreExportado) return;
      const der = p.node.right;
      if (der.type !== 'CallExpression' || der.arguments.length < 2) return;
      fuente = src.slice(der.arguments[1].start, der.arguments[1].end);
    },
  });
  return fuente;
}

const FUENTE_CRON = manejadorDe('backupSemanalFirestore');
const FUENTE_CALLABLE = manejadorDe('probarBackup');

const faltan = [
  ...['clasificarExport', 'esperarFinDelExport', 'mensajeDeRespaldo',
      'ejecutarBackupFirestore', 'leerOperacionExport', 'emailAId',
      'EXPORT_TERMINAL_OK', 'EXPORT_TERMINAL_MAL', 'BACKUP_BUCKET', 'PROJECT_ID',
     ].filter(n => !decl[n]),
  ...(FUENTE_CRON ? [] : ['el manejador de exports.backupSemanalFirestore']),
  ...(FUENTE_CALLABLE ? [] : ['el manejador de exports.probarBackup']),
];
if (faltan.length) noArranco(faltan, path.relative(raiz, ARCH_FNS));

// Las constantes se EVALÚAN del módulo en vez de teclearse: si aquí estuviera
// "SUCCESSFUL" a mano, el banco estaría comparando el módulo contra una copia
// suya y no contra lo que Firestore responde.
const ev = (n) => new Function(`return ${decl[n]};`)();
const EXPORT_TERMINAL_OK = ev('EXPORT_TERMINAL_OK');
const EXPORT_TERMINAL_MAL = ev('EXPORT_TERMINAL_MAL');
const BACKUP_BUCKET = ev('BACKUP_BUCKET');
const PROJECT_ID = ev('PROJECT_ID');

const haz = (nombre, libres, valores) =>
  new Function(...libres, `${decl[nombre]}; return ${nombre};`)(...valores);
const hazFuente = (fuente, libres, valores) =>
  new Function(...libres, `return (${fuente});`)(...valores);

const clasificarExport = haz('clasificarExport',
  ['EXPORT_TERMINAL_OK', 'EXPORT_TERMINAL_MAL'], [EXPORT_TERMINAL_OK, EXPORT_TERMINAL_MAL]);
const mensajeDeRespaldo = haz('mensajeDeRespaldo', [], []);
// `emailAId` es una flecha asignada a un `const`, no una declaración: se
// evalúa su inicializador en vez de re-declararla.
const emailAId = ev('emailAId');

// `esperarFinDelExport` se arma con un reloj y un sueño FALSOS, inyectados como
// variables libres. Así corre el bucle de verdad —no una copia suya— sin red y
// sin esperar los minutos reales. `leer` entra por el mismo camino, usando el
// valor por omisión del parámetro, que es el que la función usa en producción.
function conReloj(leer) {
  let t = 0;
  const Reloj = { now: () => t };
  const dormirYa = (cb, ms) => { t += ms; cb(); };
  return haz('esperarFinDelExport',
    ['leerOperacionExport', 'clasificarExport', 'Date', 'setTimeout'],
    [leer, clasificarExport, Reloj, dormirYa]);
}

// ── Andamiaje de aserciones ────────────────────────────────────────────────
let fallas = 0;
const check = (cond, que, detalle) => {
  if (cond) console.log(` ok   ${que}${detalle ? `  ·  ${detalle}` : ''}`);
  else { fallas++; console.log(`FALLA  ${que}${detalle ? `  ·  ${detalle}` : ''}`); }
};
const lanza = async (fn, que, contiene) => {
  try { await fn(); check(false, que, 'no lanzó'); return null; }
  catch (e) {
    const m = e?.message || String(e);
    check(!contiene || m.includes(contiene), que, m.slice(0, 160));
    return e;
  }
};
// Para lo que NO debe lanzar. Sin esto, una regresión que propaga la excepción
// se lleva el proceso entero y sale NO ARRANCÓ (2) en vez de ROJO (1), y «no
// arrancó» no es haber visto el defecto.
const sinLanzar = async (fn, que) => {
  try { return await fn(); }
  catch (e) { check(false, que, `lanzó: ${(e?.message || String(e)).slice(0, 120)}`); return null; }
};

// Respuestas con la forma que devuelve `GET /v1/{operationName}`.
const OP = 'projects/campo-fosmon/databases/(default)/operations/ASA1MjAw';
const enCurso = (hechos = 3, total = 10) => ({
  name: OP,
  metadata: {
    '@type': 'type.googleapis.com/google.firestore.admin.v1.ExportDocumentsMetadata',
    operationState: 'PROCESSING',
    progressDocuments: { estimatedWork: String(total), completedWork: String(hechos) },
    outputUriPrefix: `${BACKUP_BUCKET}/firestore/2026-10-25`,
  },
});
const completo = {
  name: OP, done: true,
  metadata: { operationState: 'SUCCESSFUL', outputUriPrefix: `${BACKUP_BUCKET}/firestore/2026-10-25` },
  response: { '@type': 'type.googleapis.com/google.firestore.admin.v1.ExportDocumentsResponse' },
};
const fallido = {
  name: OP, done: true,
  metadata: { operationState: 'FAILED' },
  error: { code: 7, message: 'The caller does not have permission' },
};
const cancelado = { name: OP, metadata: { operationState: 'CANCELLED' } };

(async () => {
  // ──────────────────────────────────────────────────────────────────────
  console.log('\n§1 · qué cuenta como terminado');

  const cCurso = clasificarExport(enCurso(3, 10));
  check(cCurso.terminal === false && cCurso.ok === false,
    'un export en curso no es terminal y no es bueno', JSON.stringify(cCurso));
  check(/3/.test(cCurso.detalle) && /10/.test(cCurso.detalle),
    'el detalle en curso trae el avance medido, no inventado', cCurso.detalle);

  const cOk = clasificarExport(completo);
  check(cOk.terminal === true && cOk.ok === true && cOk.estado === EXPORT_TERMINAL_OK,
    'SUCCESSFUL con done:true es el único que cuenta como bueno', JSON.stringify(cOk));

  const cMal = clasificarExport(fallido);
  check(cMal.terminal === true && cMal.ok === false,
    'un export que cerró con error es terminal y NO es bueno', JSON.stringify(cMal));
  check(cMal.detalle.includes('does not have permission') && cMal.detalle.includes('7'),
    'el detalle conserva el error que devolvió la API', cMal.detalle);

  const cCancel = clasificarExport(cancelado);
  check(cCancel.terminal === true && cCancel.ok === false,
    'CANCELLED es terminal y NO es bueno aunque no traiga done', JSON.stringify(cCancel));

  for (const estado of EXPORT_TERMINAL_MAL) {
    const c = clasificarExport({ done: true, metadata: { operationState: estado } });
    check(c.terminal === true && c.ok === false,
      `done:true con estado ${estado} no se cuenta como bueno`, JSON.stringify(c));
  }

  // El caso que no pasa por la lista de estados malos: la operación cerró con
  // error y el estado no lo dice. Lo único que delata el fallo es `error`.
  const cErrorSolo = clasificarExport({ done: true, error: { code: 3, message: 'bucket does not exist' } });
  check(cErrorSolo.terminal === true && cErrorSolo.ok === false,
    'done:true con error y sin estado tampoco es bueno', JSON.stringify(cErrorSolo));
  check(cErrorSolo.detalle.includes('bucket does not exist'),
    'y el error viaja al detalle', cErrorSolo.detalle);

  const cErrorEnVerde = clasificarExport({ done: true, metadata: { operationState: 'SUCCESSFUL' }, error: { code: 3, message: 'quedó a medias' } });
  check(cErrorEnVerde.ok === false,
    'un SUCCESSFUL que además trae error no se da por bueno: mandan los hechos',
    JSON.stringify(cErrorEnVerde));

  const cRaro = clasificarExport({ done: true, metadata: { operationState: 'ALGO_NUEVO' } });
  check(cRaro.ok === false,
    'un estado terminal que no conocemos no se da por bueno', JSON.stringify(cRaro));

  const cSinMeta = clasificarExport({ done: true });
  check(cSinMeta.terminal === true && cSinMeta.ok === true,
    'done:true sin error y sin metadata sí cuenta como bueno', JSON.stringify(cSinMeta));

  const cVacio = clasificarExport({});
  check(cVacio.terminal === false && cVacio.ok === false,
    'una respuesta vacía no es terminal ni buena', JSON.stringify(cVacio));

  // ──────────────────────────────────────────────────────────────────────
  console.log('\n§2 · la espera encadena, se rinde a tiempo, y distingue averías');

  {
    const respuestas = [enCurso(1, 10), enCurso(6, 10), completo];
    let n = 0;
    const r = await conReloj(async () => respuestas[n++])(OP, { plazoMs: 420e3 });
    check(r.ok === true && r.verificado === true,
      'espera hasta que la operación cierra bien', JSON.stringify(r));
    check(r.intentos === 3,
      'consultó las veces que hizo falta, no una', `intentos=${r.intentos}`);
    check(r.esperaMs === 2 * 15e3,
      'el tiempo esperado es el medido, no uno supuesto', `esperaMs=${r.esperaMs}`);
  }

  {
    let n = 0;
    const r = await conReloj(async () => (n++ === 0 ? enCurso() : fallido))(OP, { plazoMs: 420e3 });
    check(r.verificado === true && r.ok === false && r.estado === 'FAILED',
      'un export que acaba mal se reporta verificado y malo', JSON.stringify(r));
  }

  {
    let consultas = 0;
    const r = await conReloj(async () => { consultas++; return enCurso(); })(OP, { plazoMs: 420e3 });
    check(r.verificado === false && r.ok === false,
      'si nunca termina: SIN VERIFICAR, y eso no es verde', JSON.stringify(r));
    check(r.esperaMs < 420e3,
      'se rinde DENTRO del plazo, no después', `esperaMs=${r.esperaMs} plazo=420000`);
    check(consultas === 28,
      'consultó hasta agotar el plazo, no se rindió antes', `consultas=${consultas}`);
  }

  {
    let n = 0;
    const r = await sinLanzar(() => conReloj(async () => {
      if (n++ < 2) throw new Error('HTTP 503 backend unavailable');
      return completo;
    })(OP, { plazoMs: 420e3 }), 'un fallo pasajero al consultar no tumba la verificación');
    if (r) check(r.ok === true && r.verificado === true,
      'un fallo pasajero al consultar no tumba la verificación', JSON.stringify(r));
  }

  {
    const r = await sinLanzar(
      () => conReloj(async () => { throw new Error('HTTP 403 sin permiso de lectura'); })(OP, { plazoMs: 60e3 }),
      'si nunca se pudo consultar: SIN VERIFICAR, no «falló el export»');
    check(r?.verificado === false && r?.ok === false,
      'si nunca se pudo consultar: SIN VERIFICAR, no «falló el export»', JSON.stringify(r));
    check(!!r?.detalle?.includes('403'),
      'y el detalle dice que lo que falló fue la consulta', r?.detalle);
    check(r?.estado !== 'FAILED' && r?.estado !== 'CANCELLED',
      'no se le cuelga al export un estado terminal que nadie midió', `estado=${r?.estado}`);
  }

  {
    // Un plazo más corto que una pausa: una sola consulta y a rendirse. Lo que
    // no puede hacer es dormirse y pasarse.
    const r = await conReloj(async () => enCurso())(OP, { plazoMs: 10e3, pausaMs: 15e3 });
    check(r.verificado === false && r.esperaMs === 0,
      'con el plazo más corto que la pausa consulta una vez y se rinde', JSON.stringify(r));
  }

  // ──────────────────────────────────────────────────────────────────────
  console.log('\n§3 · el renglón que lee un humano');

  const dst = `${BACKUP_BUCKET}/firestore/2026-10-25`;
  const mOk = mensajeDeRespaldo(dst, { verificado: true, ok: true, estado: 'SUCCESSFUL', esperaMs: 95000 });
  const mMal = mensajeDeRespaldo(dst, { verificado: true, ok: false, estado: 'FAILED', detalle: 'sin permiso al bucket', esperaMs: 30000 });
  const mSin = mensajeDeRespaldo(dst, { verificado: false, ok: false, estado: 'PROCESSING', detalle: '800/9000 documentos', esperaMs: 420000 });

  check(new Set([mOk, mMal, mSin]).size === 3,
    'los tres estados dan tres renglones distintos');
  check(/95 s/.test(mOk) && mOk.includes(dst),
    'el bueno dice dónde quedó y cuánto tardó en verificarse', mOk);
  check(mMal.includes('FAILED') && mMal.includes('sin permiso al bucket'),
    'el malo dice en qué acabó y por qué', mMal);
  check(!/completad/i.test(mSin) && !/^Iniciado/.test(mSin),
    'el de «sin verificar» no se puede leer como respaldo completo', mSin);
  check(/no se sabe/i.test(mSin) && mSin.includes(dst),
    'y dice que no se sabe, y a dónde ir a mirar', mSin);
  check(/420|7 min|\b420 s\b/.test(mSin) || /\d+ s/.test(mSin),
    'con el tiempo que sí esperó, medido', mSin);

  // ──────────────────────────────────────────────────────────────────────
  console.log('\n§4 · lo que el cron deja escrito en global/health');

  // El manejador DE VERDAD, con el arranque del export y los dos registradores
  // sustituidos por dobles que anotan lo que se les pidió. La espera es la de
  // verdad, armada con reloj falso.
  const correrCron = async (leer, { arranque } = {}) => {
    const anotado = [];
    const h = hazFuente(FUENTE_CRON,
      ['ejecutarBackupFirestore', 'esperarFinDelExport', 'mensajeDeRespaldo',
       'registrarSalud', 'registrarFalloDeSalud'],
      [arranque || (async () => ({ destino: dst, operationName: OP })),
       conReloj(leer),
       mensajeDeRespaldo,
       async (tipo, ok, mensaje, meta) => { anotado.push({ via: 'salud', tipo, ok, mensaje, meta }); },
       async (tipo, error, meta) => { anotado.push({ via: 'fallo', tipo, error: error?.message || String(error), meta }); }]);
    let lanzo = null;
    try { await h({}); } catch (e) { lanzo = e?.message || String(e); }
    return { anotado, lanzo };
  };

  {
    let n = 0;
    const { anotado, lanzo } = await correrCron(async () => (n++ === 0 ? enCurso() : completo));
    const a = anotado[0];
    check(anotado.length === 1 && a.via === 'salud' && a.tipo === 'backup',
      'una corrida buena anota la salud una sola vez', JSON.stringify(anotado.map(x => x.via)));
    check(a.ok === true, 'y la anota en VERDE, porque el export terminó bien', `ok=${a?.ok}`);
    check(a.meta.verificado === true && a.meta.estadoExport === EXPORT_TERMINAL_OK,
      'el registro guarda que se verificó y en qué estado', JSON.stringify(a.meta));
    check(a.meta.operationName === OP && a.meta.destino === dst,
      'y guarda el operationName y el destino', JSON.stringify([a.meta.operationName, a.meta.destino]));
    check(a.meta.consultas === 2, 'con las consultas que hizo, medidas', `consultas=${a.meta.consultas}`);
    check(lanzo === null, 'y no revienta la corrida', String(lanzo));
  }

  {
    const { anotado } = await correrCron(async () => fallido);
    const a = anotado[0];
    check(a?.via === 'salud' && a.ok === false,
      'un export que acaba mal deja el panel en ROJO', JSON.stringify(a && { via: a.via, ok: a.ok }));
    check(a?.meta.verificado === true && a.meta.estadoExport === 'FAILED',
      'y deja escrito que sí se verificó, y en qué acabó', JSON.stringify(a?.meta));
    check(/permission/i.test(a?.mensaje || ''),
      'con el error de la API en el mensaje', a?.mensaje);
  }

  {
    const { anotado } = await correrCron(async () => enCurso());
    const a = anotado[0];
    check(a?.via === 'salud' && a.ok === false,
      'un export que no se pudo verificar NO deja el panel en verde',
      JSON.stringify(a && { via: a.via, ok: a.ok }));
    check(a?.meta.verificado === false,
      'y se distingue del que falló: verificado=false', JSON.stringify(a?.meta));
    check(!/^Completado/.test(a?.mensaje || '') && !/^Iniciado/.test(a?.mensaje || ''),
      'el mensaje no dice ni «Completado» ni «Iniciado»', a?.mensaje);
    check(typeof a?.meta.duracionMs === 'number',
      'y la duración de la corrida queda medida', `duracionMs=${a?.meta.duracionMs}`);
  }

  {
    const { anotado, lanzo } = await correrCron(async () => completo,
      { arranque: async () => { throw new Error('Export error 400: Path already exists'); } });
    check(anotado[0]?.via === 'fallo' && anotado[0].tipo === 'backup',
      'si el export ni arranca, va por el registro de FALLO', JSON.stringify(anotado[0]));
    check(lanzo !== null && /Path already exists/.test(lanzo),
      'y la corrida revienta, para que el cron también lo vea', String(lanzo));
  }

  // ──────────────────────────────────────────────────────────────────────
  console.log('\n§5 · un export que no se puede vigilar no se declara bueno');

  const adminFalso = {
    app: () => ({ options: { credential: { getAccessToken: async () => ({ access_token: 't0k' }) } } }),
  };
  const arrancar = (respuesta, status = 200) => {
    const visto = {};
    const fn = haz('ejecutarBackupFirestore',
      ['BACKUP_BUCKET', 'PROJECT_ID', 'admin', 'fetch'],
      [BACKUP_BUCKET, PROJECT_ID, adminFalso, async (url, init) => {
        visto.url = url; visto.cuerpo = JSON.parse(init.body);
        return { ok: status >= 200 && status < 300, status, json: async () => respuesta };
      }]);
    return { fn, visto };
  };

  {
    const { fn, visto } = arrancar({ name: OP });
    const r = await fn();
    check(r.operationName === OP, 'un export con operationName se devuelve', JSON.stringify(r));
    check(r.destino.startsWith(`${BACKUP_BUCKET}/firestore/`),
      'y el destino va al bucket de respaldos', r.destino);
    check(visto.cuerpo.outputUriPrefix === r.destino,
      'el destino que se pidió es el que se reporta — una cuenta por número',
      `${visto.cuerpo.outputUriPrefix} vs ${r.destino}`);
    check(visto.url.includes(PROJECT_ID) && visto.url.includes('exportDocuments'),
      'y se le pidió a la base de este proyecto', visto.url);
  }

  await lanza(() => arrancar({}).fn(),
    'un export sin operationName se rechaza: no habría cómo verificarlo',
    'operationName');

  await lanza(() => arrancar({ error: { message: 'Path already exists' } }, 400).fn(),
    'un POST rechazado sigue reventando', 'Export error 400');

  // ──────────────────────────────────────────────────────────────────────
  console.log('\n§6 · probarBackup deja de contestar «ok» por haber arrancado');

  class HttpsErrorFalso extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const correrCallable = async (leer, { rol = 'director_general', auth = { token: { email: 'DIR@fosmon.com.mx' } } } = {}) => {
    const leido = {};
    const adminConPerfil = {
      firestore: () => ({
        doc: (ruta) => { leido.ruta = ruta; return { get: async () => ({ exists: !!rol, data: () => ({ rol }) }) }; },
      }),
    };
    const h = hazFuente(FUENTE_CALLABLE,
      ['HttpsError', 'admin', 'emailAId', 'ejecutarBackupFirestore', 'esperarFinDelExport', 'mensajeDeRespaldo'],
      [HttpsErrorFalso, adminConPerfil, emailAId,
       async () => ({ destino: dst, operationName: OP }), conReloj(leer), mensajeDeRespaldo]);
    return { h, leido };
  };

  {
    const { h, leido } = await correrCallable(async () => completo);
    const r = await h({ auth: { token: { email: 'DIR@fosmon.com.mx' } } });
    check(r.ok === true && r.verificado === true,
      'un export completo contesta ok y verificado', JSON.stringify(r));
    check(leido.ruta === `usuarios/${emailAId('dir@fosmon.com.mx')}`,
      'el rol se busca con el correo en minúsculas', leido.ruta);
  }

  {
    const { h } = await correrCallable(async () => enCurso());
    const r = await h({ auth: { token: { email: 'dir@fosmon.com.mx' } } });
    check(r.ok === false && r.verificado === false,
      'un export que no terminó NO contesta ok:true', JSON.stringify(r));
    check(!/^Completado/.test(r.mensaje || ''),
      'y su mensaje no dice que esté completo', r.mensaje);
  }

  {
    const { h } = await correrCallable(async () => fallido);
    const r = await h({ auth: { token: { email: 'dir@fosmon.com.mx' } } });
    check(r.ok === false && r.verificado === true && r.estado === 'FAILED',
      'un export fallido se distingue del que no se pudo verificar', JSON.stringify(r));
  }

  {
    const { h } = await correrCallable(async () => completo, { rol: 'residente' });
    await lanza(() => h({ auth: { token: { email: 'res@fosmon.com.mx' } } }),
      'un rol que no es dirección ni admin no puede lanzarlo', 'Solo dirección');
  }

  {
    const { h } = await correrCallable(async () => completo);
    await lanza(() => h({}), 'sin sesión no se lanza nada', 'iniciar sesión');
  }

  // ──────────────────────────────────────────────────────────────────────
  console.log(fallas === 0
    ? '\nTodo verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
