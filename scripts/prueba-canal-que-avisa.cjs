#!/usr/bin/env node
// Prueba: EL CANAL CON EL QUE PENSAMOS ENTERARNOS NO PUEDE SER DE LOS QUE NO
// AVISAN.
//
// ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
// El #74 hizo que el front, cuando las reglas le niegan una escritura a quien
// SÍ tiene la obra asignada, deje una fila `tipo:"error_permiso"` en la
// bitácora. Esa fila es el único rastro de un defecto que el usuario no puede
// corregir y que nosotros no sabemos explicar.
//
// Escribirla no es enterarse. La bitácora tiene 4,201 filas de actividad
// normal al 2026-10-23: una fila nuestra ahí dentro sólo existe si a alguien
// se le ocurre bajar a buscarla. Y al ir a construir el aviso aparecieron las
// apariciones QUINTA y SEXTA del P7 —un banco (o un canal) CARGA su insumo; si
// no puede, sale NO ARRANCÓ, nunca verde— en los dos instrumentos con los que
// pensábamos enterarnos de todo lo demás:
//
//   · `registrarSalud` terminaba en `catch { console.warn("fallo
//     silencioso") }`. El nombre lo decía y aun así se quedó. Lo que producía
//     no era «no se registró», era PEOR: Cloud Scheduler marcaba la corrida
//     como exitosa —la función no lanzaba— mientras `global/health` se quedaba
//     con el registro anterior, así que la pantalla de salud, pasado el plazo,
//     decía «sin correr» en rojo. «Sin correr» es una AFIRMACIÓN SOBRE EL DATO
//     y en ese caso es falsa: sí corrió, lo que no se pudo fue anotarlo. Dos
//     averías con dos reacciones distintas —revisar el cron contra revisar los
//     permisos de escritura— vueltas indistinguibles por el silencio.
//
//   · `fsAudit`, en el front, devolvía `undefined` pasara lo que pasara. Eso
//     se mide en `prueba-mensaje-de-permiso.cjs`, que es donde vive la cola.
//     Aquí se mide la mitad del servidor.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
// Nada de que un símbolo exista (P3). Todo lo que se juzga aquí es código
// EXTRAÍDO POR AST de `functions/index.js` y EJECUTADO: contra el emulador de
// Firestore cuando toca Firestore, y contra dobles sólo donde el doble es el
// defecto que se quiere provocar.
//
//   §1  `registrarSalud` lanza en vez de tragarse su propio fallo.
//   §2  `registrarFalloDeSalud` conserva el error original y nombra el segundo.
//   §3  `contarDenegaciones` recorre la bitácora PARTIDA (#73), respeta la
//       ventana, cuenta la fila sin fecha, y LANZA en vez de devolver 0.
//   §4  lo que el front ESCRIBE es lo que el servidor CUENTA: la fila se
//       fabrica con el `construirRastro` de verdad, no con un literal tecleado
//       aquí. Una cuenta por número: si las dos mitades dejan de nombrar lo
//       mismo, esto sale rojo.
//   §5  el semáforo: la ventana se encadena entre corridas —ni cuenta dos
//       veces ni se salta nada—, la primera corrida DICE que su ventana es
//       supuesta, y cuando el conteo falla el trabajo lanza Y deja el rojo
//       anotado.
//   §6  el correo: tres estados distintos, y cuando el conteo falló NO dice
//       «0». El cero inventado es peor que el silencio, porque este renglón
//       existe para que alguien confíe en él sin abrir la aplicación.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta `functions/index.js` por `ARCH_FNS` para correrse contra copias
// mutiladas. Cada mutación rompe SEMÁNTICA, no andamiaje, y se verificó que
// saca ROJO (1) y no NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-canal-que-avisa.cjs
//       node scripts/prueba-canal-que-avisa.cjs --contraprueba
//
// Necesita el emulador:
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const PROYECTO = 'campo-fosmon-prueba';
const EMU = '127.0.0.1:8080';
const ARCH_FNS = process.env.ARCH_FNS || path.join(raiz, 'functions/index.js');

// ── La contraprueba ────────────────────────────────────────────────────────
// Se corre primero, antes de abrir nada, porque relanza este mismo archivo.
if (process.argv[2] === '--contraprueba') {
  const MUTACIONES = [
    // El P7 en su quinta aparición, tal como estaba. Si vuelve, el §1 lo ve.
    { nombre: 'registrarSalud vuelve a tragarse su propio fallo',
      de: '  const ref = admin.firestore().doc("global/health");\n  const snap = await ref.get();',
      a:  '  try {\n  const ref = admin.firestore().doc("global/health");\n  const snap = await ref.get();' },
    { nombre: 'registrarSalud vuelve a tragarse su propio fallo',
      de: '  }, { mergeFields: [tipo, `${tipo}_historial`] });\n}',
      a:  '  }, { mergeFields: [tipo, `${tipo}_historial`] });\n  } catch (e) { console.warn("fallo silencioso"); }\n}',
      par: true },

    // El registro que mezcla dos corridas: el merge profundo deja encima las
    // cifras de la anterior y las presenta como si fueran de ésta.
    { nombre: 'el registro de salud vuelve a fundirse con el de la corrida previa',
      de: '  await ref.set({\n    [tipo]: entry,\n    [`${tipo}_historial`]: hist,\n  }, { mergeFields: [tipo, `${tipo}_historial`] });',
      a:  '  await ref.set({\n    ...actual,\n    [tipo]: entry,\n    [`${tipo}_historial`]: hist,\n  }, { merge: true });' },

    // Perder el error original cambia un diagnóstico por otro: el trabajo
    // reventó por una cosa y el registro cuenta otra.
    { nombre: 'el fallo de salud se come el error original',
      de: '      `${original} · y además no se pudo registrar la salud de ${tipo}: ` +\n      `${e2?.message || e2}`, { cause: error });',
      a:  '      `no se pudo registrar la salud de ${tipo}: ${e2?.message || e2}`);' },

    // Devolver 0 cuando la consulta falló pinta de verde la pantalla que
    // existe para avisar. Es el mismo defecto un nivel más adentro.
    { nombre: 'contar devuelve 0 cuando no pudo contar',
      de: 'async function contarDenegaciones(db, desde) {\n  const colecciones = await coleccionesDeBitacora(db);',
      a:  'async function contarDenegaciones(db, desde) {\n  try {\n  const colecciones = await coleccionesDeBitacora(db);' },
    { nombre: 'contar devuelve 0 cuando no pudo contar',
      de: '    sinFecha: enVentana.filter(f => cuando(f) === null).length,\n  };\n}',
      a:  '    sinFecha: enVentana.filter(f => cuando(f) === null).length,\n  };\n  } catch { return { total: 0, historicas: 0, obras: [], codigos: [], colecciones: [], sinFecha: 0 }; }\n}',
      par: true },

    // La bitácora está PARTIDA desde el #73. Mirar sólo la raíz deja a las
    // dependencias sin vigilancia y el semáforo en verde por no haber visto.
    { nombre: 'sólo se mira la bitácora de la raíz: las dependencias no se vigilan',
      de: '  const orgs = await db.collection("orgs").listDocuments();\n  return ["auditoria", ...orgs.map(o => `orgs/${o.id}/auditoria`)];',
      a:  '  return ["auditoria"];' },

    // No saber cuándo pasó no es no haber pasado. Descartarla es perder justo
    // la fila que viajó en la cola, que es la que más cuesta explicar.
    { nombre: 'la fila sin fecha utilizable se descarta en vez de contarse',
      de: '    return c === null || c >= desde;',
      a:  '    return c !== null && c >= desde;' },

    // Un semáforo que se pone verde con denegaciones encima no es un semáforo.
    { nombre: 'el semáforo se pone verde aunque haya denegaciones',
      de: '    await registrarSalud("permisos_denegados", r.total === 0, mensaje, {',
      a:  '    await registrarSalud("permisos_denegados", true, mensaje, {' },

    // Una ventana supuesta presentada como medida: la primera corrida diría
    // «desde ayer» sin tener de dónde saberlo.
    { nombre: 'la primera corrida no dice que su ventana es supuesta',
      de: '      (primera ? " · primera corrida: ventana supuesta de 24 h" : "");',
      a:  '      "";' },

    // El cero inventado del correo. El renglón entero existe para no tenerlo.
    { nombre: 'el correo dice «0» cuando el conteo falló',
      de: '  if (den.error) {',
      a:  '  if (false) {' },

    // Y la otra mitad del mismo cero: el fallo no viaja y llega como conteo.
    { nombre: 'el fallo del conteo no viaja al correo: llega como un conteo vacío',
      de: '    denegaciones = { error: e?.message || String(e) };',
      a:  '    denegaciones = { total: 0, obras: [], codigos: [], sinFecha: 0 };' },
  ];

  const base = fs.readFileSync(ARCH_FNS, 'utf8');
  let malas = 0, i = 0;
  while (i < MUTACIONES.length) {
    // Una mutación puede necesitar DOS reemplazos (abrir y cerrar un `try`).
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
      `canal-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
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
      if (r.status === 2) {
        console.log('             (salió NO ARRANCÓ: la prueba se cayó, que no es lo mismo');
        console.log('              que ver el defecto.)');
        console.log((r.stdout + r.stderr).split('\n').slice(-12).map(l => '             ' + l).join('\n'));
      }
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

// El destino se APUNTA aquí, antes de cargar nada del Admin SDK: sin esto el
// SDK iría a producción. Ver `scripts/destino.cjs` y el incidente del
// 2026-10-09.
process.env.FIRESTORE_EMULATOR_HOST = EMU;
process.env.GCLOUD_PROJECT = PROYECTO;
process.env.GOOGLE_CLOUD_PROJECT = PROYECTO;

const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const { limpiarDatos } = require('./emulador-limpio.cjs');

let adminReal;
try {
  adminReal = require(path.join(raiz, 'functions/node_modules/firebase-admin'));
  if (!adminReal.apps.length) adminReal.initializeApp({ projectId: PROYECTO });
} catch (e) {
  noArranco.sinPrecondicion(
    `no se pudo cargar firebase-admin desde functions/node_modules (${e.message})`,
    ['cd functions && npm install']);
}
const dbReal = adminReal.firestore();
const AHORA_SERVIDOR = adminReal.firestore.FieldValue.serverTimestamp;

// ── Extracción ─────────────────────────────────────────────────────────────
const src = fs.readFileSync(ARCH_FNS, 'utf8');
const ast = parse(src, { sourceType: 'script', plugins: ['optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'] });

const decl = {};
traverse(ast, {
  FunctionDeclaration(p) { if (p.node.id) decl[p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
});

// El manejador del cron: el SEGUNDO argumento de `onSchedule` en la asignación
// a `exports.vigilarDenegaciones`. Se toma por posición y no por nombre porque
// no tiene nombre.
function manejadorDelCron() {
  let fuente = null;
  traverse(ast, {
    AssignmentExpression(p) {
      const izq = p.node.left;
      if (izq.type !== 'MemberExpression') return;
      if (izq.object.name !== 'exports' || izq.property.name !== 'vigilarDenegaciones') return;
      const der = p.node.right;
      if (der.type !== 'CallExpression' || der.arguments.length < 2) return;
      fuente = src.slice(der.arguments[1].start, der.arguments[1].end);
    },
  });
  return fuente;
}

// El bloque 4bis del resumen semanal: el `let denegaciones;` y el `try` que lo
// asigna, tomados por posición dentro de `generarYEnviarResumenSemanal`. Se
// toma el hermano anterior en vez de teclear el `let` aquí: así, si mañana esa
// declaración cambia, la prueba se lleva el cambio en vez de medir su copia.
function bloque4bis() {
  let elegido = null;
  traverse(ast, {
    FunctionDeclaration(p) {
      if (!p.node.id || p.node.id.name !== 'generarYEnviarResumenSemanal') return;
      p.traverse({
        TryStatement(q) {
          if (!src.slice(q.node.start, q.node.end).includes('contarDenegaciones')) return;
          if (!elegido || (q.node.end - q.node.start) < (elegido.node.end - elegido.node.start)) elegido = q;
        },
      });
    },
  });
  if (!elegido) return null;
  const hermanos = (elegido.parent && elegido.parent.body) || [];
  const i = hermanos.indexOf(elegido.node);
  if (i <= 0) return null;
  return src.slice(hermanos[i - 1].start, elegido.node.end);
}

const FUENTE_CRON = manejadorDelCron();
const FUENTE_4BIS = bloque4bis();

const faltan = [
  ...['registrarSalud', 'registrarFalloDeSalud', 'coleccionesDeBitacora',
      'contarDenegaciones', 'textoDenegaciones', 'bloqueDenegaciones',
      'buildEmailHTML', 'TIPO_DENEGACION'].filter(n => !decl[n]),
  ...(FUENTE_CRON ? [] : ['el manejador de exports.vigilarDenegaciones']),
  ...(FUENTE_4BIS ? [] : ['el bloque 4bis de generarYEnviarResumenSemanal']),
];
if (faltan.length) noArranco(faltan, path.relative(raiz, ARCH_FNS));

// `TIPO_DENEGACION` se EVALÚA del módulo en vez de teclearse: si aquí
// estuviera la cadena a mano, el §4 estaría comparando el módulo contra una
// copia suya y no contra el front, que es lo que importa.
const TIPO_DENEGACION = new Function(`return ${decl.TIPO_DENEGACION};`)();

// Fábricas: cada pieza se arma con sus variables libres inyectadas. Los dobles
// son SÓLO donde hace falta provocar el fallo; lo demás es la pieza de verdad.
const haz = (nombre, libres, valores) =>
  new Function(...libres, `${decl[nombre]}; return ${nombre};`)(...valores);

const coleccionesDeBitacora = haz('coleccionesDeBitacora', [], []);
const textoDenegaciones = haz('textoDenegaciones', [], []);
const bloqueDenegaciones = haz('bloqueDenegaciones', [], []);
const contarDenegaciones = haz('contarDenegaciones',
  ['coleccionesDeBitacora', 'TIPO_DENEGACION'], [coleccionesDeBitacora, TIPO_DENEGACION]);
const conAdmin = admin => haz('registrarSalud', ['admin'], [admin]);
const conSalud = registrarSalud =>
  haz('registrarFalloDeSalud', ['registrarSalud'], [registrarSalud]);

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

const DIA = 24 * 3600 * 1000;
const dbQueRevienta = (porQue) => ({
  collection: () => ({
    listDocuments: async () => { throw new Error(porQue); },
    where: () => ({ get: async () => { throw new Error(porQue); } }),
  }),
  doc: () => ({ get: async () => { throw new Error(porQue); } }),
});

(async () => {
  await limpiarDatos({ proyecto: PROYECTO });

  // El `construirRastro` DE VERDAD, el del front. Lo que este banco siembra en
  // la bitácora es lo que la app escribiría, no un literal tecleado aquí.
  let construirRastro;
  try { ({ construirRastro } = await import(path.resolve(raiz, 'src/permiso-denegado.js'))); }
  catch (e) { noArranco(`no se pudo cargar src/permiso-denegado.js — ${e.message}`); }

  const sembrarRastro = async (coleccion, { obraId, ahoraISO, conServidor }) => {
    const fila = construirRastro({
      uid: 'u-sup', correo: 'sup@fosmon.mx', obraId,
      ruta: `obras/${obraId}/evidencia/foto.jpg`, codigo: 'permission-denied',
      ahoraISO, servidor: conServidor ? AHORA_SERVIDOR() : null,
    });
    await dbReal.collection(coleccion).add(fila);
  };

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n§1 · el que anota la salud ya no se traga su propio fallo (P7, 5ª)');

  const saludReal = conAdmin(adminReal);
  await saludReal('prueba_tipo', true, 'todo bien', { duracionMs: 7 });
  const h1 = (await dbReal.doc('global/health').get()).data();
  check(h1?.prueba_tipo?.ok === true && h1?.prueba_tipo?.mensaje === 'todo bien',
    'el camino de éxito deja el registro con su mensaje', JSON.stringify(h1?.prueba_tipo));
  check(Array.isArray(h1?.prueba_tipo_historial) && h1.prueba_tipo_historial.length === 1,
    'y abre el historial corto');

  // Cada registro es de UNA corrida. Lo contrario —el merge profundo— dejaba
  // las cifras de la corrida buena encima del registro de la fallida, y la
  // pantalla las leía como si fueran de ésta: una cifra que nadie midió
  // puesta justo en el renglón que avisa de que no se pudo medir.
  await saludReal('otro_tipo', true, 'vecino', { contadas: 99 });
  await saludReal('prueba_tipo', false, 'esta vez no se pudo', {});
  const h2 = (await dbReal.doc('global/health').get()).data();
  check(h2?.prueba_tipo?.ok === false && h2?.prueba_tipo?.mensaje === 'esta vez no se pudo',
    'el registro siguiente sustituye al anterior', JSON.stringify(h2?.prueba_tipo));
  check(h2?.prueba_tipo?.duracionMs === undefined,
    'y NO arrastra la cifra de la corrida previa: cada registro es de una corrida',
    JSON.stringify(h2?.prueba_tipo));
  check(h2?.otro_tipo?.contadas === 99,
    'mientras que el registro del vecino queda intacto: se toca un tipo, no el documento',
    JSON.stringify(h2?.otro_tipo));
  check(h2?.prueba_tipo_historial?.length === 2,
    'el historial sí se acumula, que para eso está', `${h2?.prueba_tipo_historial?.length}`);

  const saludSinLectura = conAdmin({ firestore: () => dbQueRevienta('no se pudo leer global/health') });
  await lanza(() => saludSinLectura('gp_sync', true, 'ok'),
    'si NO PUEDE LEER el documento de salud, lanza en vez de callar',
    'no se pudo leer global/health');

  const saludSinEscritura = conAdmin({ firestore: () => ({
    doc: () => ({
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async () => { throw new Error('PERMISSION_DENIED en global/health'); },
    }),
  }) });
  await lanza(() => saludSinEscritura('gp_sync', true, 'ok'),
    'y si no puede ESCRIBIRLO, también',
    'PERMISSION_DENIED');
  // Por qué importa que lance y no que avise por consola: un trabajo cuyo
  // resultado no se pudo anotar NO terminó bien, porque nadie se va a enterar
  // de que terminó. Callándolo, Cloud Scheduler lo da por exitoso y la
  // pantalla de salud, pasado el plazo, dice «sin correr»: una afirmación
  // sobre el dato que en ese caso es falsa.

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n§2 · el camino de fallo conserva el error que lo causó');

  const anotados = [];
  const falloConAnotacionBuena = conSalud(async (...a) => { anotados.push(a); });
  await falloConAnotacionBuena('backup', new Error('el bucket no existe'), { duracionMs: 3 });
  check(anotados.length === 1 && anotados[0][1] === false,
    'anota la corrida como NO ok', `ok=${anotados[0]?.[1]}`);
  check(anotados[0]?.[2] === 'el bucket no existe',
    'con el mensaje del error original, no con uno inventado', anotados[0]?.[2]);
  check(anotados[0]?.[3]?.duracionMs === 3, 'y arrastra la meta que le dieron');

  const original = new Error('el bucket no existe');
  const falloDoble = conSalud(async () => { throw new Error('PERMISSION_DENIED en global/health'); });
  const e2 = await lanza(() => falloDoble('backup', original, {}),
    'si TAMPOCO se puede anotar el fallo, lanza: los dos silencios no se suman',
    'el bucket no existe');
  check(!!e2 && e2.message.includes('PERMISSION_DENIED en global/health'),
    'y el mensaje nombra también el segundo fallo, que pide otra reacción',
    e2?.message?.slice(0, 120));
  check(e2?.cause === original,
    'el error original viaja entero en `cause`: la cadena no se corta');

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n§3 · contar sobre la bitácora PARTIDA, con su ventana');

  await limpiarDatos({ proyecto: PROYECTO });
  // Las organizaciones tienen que EXISTIR como documento para que
  // `listDocuments` las vea; una subcolección sola no basta.
  await dbReal.doc('orgs/coatzacoalcos').set({ nombre: 'Coatzacoalcos' });
  await dbReal.doc('orgs/veracruz').set({ nombre: 'Veracruz' });

  const hace10dias = new Date(Date.now() - 10 * DIA).toISOString();
  await sembrarRastro('auditoria',
    { obraId: '0114', ahoraISO: new Date().toISOString(), conServidor: true });
  await sembrarRastro('orgs/coatzacoalcos/auditoria',
    { obraId: '0127', ahoraISO: hace10dias, conServidor: false });
  await sembrarRastro('orgs/veracruz/auditoria',
    { obraId: '0130', ahoraISO: '', conServidor: false });
  // Ruido: actividad normal, que es el 100 % de la bitácora los días buenos.
  await dbReal.collection('auditoria').add({ tipo: 'login', usuario: 'ana@fosmon.mx' });
  await dbReal.collection('orgs/coatzacoalcos/auditoria')
    .add({ tipo: 'editar_obra', usuario: 'luis@coatza.gob.mx' });

  const cols = await coleccionesDeBitacora(dbReal);
  check(cols.length === 3 && cols.includes('auditoria') &&
        cols.includes('orgs/coatzacoalcos/auditoria') && cols.includes('orgs/veracruz/auditoria'),
    'se enumeran las tres bitácoras: la raíz y una por organización', cols.join(' · '));

  const r7 = await contarDenegaciones(dbReal, new Date(Date.now() - 7 * DIA));
  check(r7.total === 2,
    'en 7 días cuenta la de la raíz y la sin fecha, no la de hace 10 días', `total=${r7.total}`);
  check(r7.historicas === 3,
    'y separa el histórico del conteo de la ventana: tres en total', `historicas=${r7.historicas}`);
  check(r7.sinFecha === 1,
    'la fila sin fecha utilizable se cuenta Y se nombra: contar de más es el error permitido',
    `sinFecha=${r7.sinFecha}`);
  check(r7.obras.includes('0114') && r7.obras.includes('0130') && !r7.obras.includes('0127'),
    'y las obras que salen son las de la ventana, no las del histórico', r7.obras.join(', '));
  check(!cols.some(c => r7.total > 3), 'el ruido de actividad normal no entra al conteo');

  const r30 = await contarDenegaciones(dbReal, new Date(Date.now() - 30 * DIA));
  check(r30.total === 3,
    'con 30 días de ventana entran las tres: la ventana es la que decide', `total=${r30.total}`);

  await lanza(() => contarDenegaciones(dbQueRevienta('FAILED_PRECONDITION: falta el índice'),
    new Date(Date.now() - 7 * DIA)),
    'si no puede contar, LANZA: devolver 0 pintaría de verde justo lo que vino a avisar',
    'FAILED_PRECONDITION');

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n§4 · lo que el front escribe es lo que el servidor cuenta');
  // Las dos mitades nombran la misma cosa, y ninguna de las dos cadenas está
  // tecleada en este archivo: `TIPO_DENEGACION` sale de functions/index.js y
  // la fila la fabrica el `construirRastro` de src/permiso-denegado.js. Si
  // alguien renombra una de las dos, esto sale rojo — que es exactamente la
  // avería que un banco con dos literales copiados no vería nunca.
  const comoLaEscribeElFront = construirRastro({
    uid: 'u', correo: 'a@b.c', obraId: '0114', ruta: 'x', codigo: 'permission-denied',
    ahoraISO: new Date().toISOString(), servidor: null,
  });
  check(comoLaEscribeElFront.tipo === TIPO_DENEGACION,
    'la fila que fabrica el front trae el tipo que el servidor busca',
    `front:"${comoLaEscribeElFront.tipo}" · servidor:"${TIPO_DENEGACION}"`);
  check(r7.total > 0,
    'y por eso el conteo del §3, hecho sobre filas reales del front, no salió vacío',
    `total=${r7.total}`);

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n§5 · el semáforo: la ventana se encadena y el fallo se anota');

  await limpiarDatos({ proyecto: PROYECTO });
  const armarCron = (extra = {}) => new Function(
    'admin', 'contarDenegaciones', 'textoDenegaciones',
    'registrarSalud', 'registrarFalloDeSalud', 'console',
    `return (${FUENTE_CRON});`)(
    extra.admin || adminReal,
    extra.contarDenegaciones || contarDenegaciones,
    textoDenegaciones,
    extra.registrarSalud || saludReal,
    extra.registrarFalloDeSalud || conSalud(extra.registrarSalud || saludReal),
    { log: () => {}, error: () => {} });
  const leerSemaforo = async () =>
    (await dbReal.doc('global/health').get()).data()?.permisos_denegados;

  await sembrarRastro('auditoria',
    { obraId: '0114', ahoraISO: new Date().toISOString(), conServidor: true });

  await armarCron()();
  const s1 = await leerSemaforo();
  check(s1?.ok === false && s1?.denegaciones === 1,
    'con una denegación encima, el semáforo NO se pone verde', `ok=${s1?.ok} n=${s1?.denegaciones}`);
  check(/ventana supuesta/.test(s1?.mensaje || ''),
    'y la primera corrida DICE que su ventana es supuesta, no la presenta como medida',
    s1?.mensaje);
  check(/0114/.test(s1?.mensaje || ''), 'el mensaje nombra la obra, que es por donde se empieza a mirar');

  await armarCron()();
  const s2 = await leerSemaforo();
  check(s2?.denegaciones === 0 && s2?.ok === true,
    'la segunda corrida no vuelve a contar lo que la primera ya contó',
    `n=${s2?.denegaciones}`);
  check(!/ventana supuesta/.test(s2?.mensaje || ''),
    'y ya no habla de ventana supuesta: ahora arranca donde terminó la anterior', s2?.mensaje);
  check(s2?.desde === s1?.ultimaEjecucion,
    'la ventana nueva empieza exactamente donde acabó la corrida previa',
    `${s2?.desde} ← ${s1?.ultimaEjecucion}`);

  await sembrarRastro('auditoria',
    { obraId: '0127', ahoraISO: new Date().toISOString(), conServidor: true });
  await armarCron()();
  const s3 = await leerSemaforo();
  check(s3?.denegaciones === 1 && /0127/.test(s3?.mensaje || ''),
    'y la que llegó DESPUÉS se cuenta una vez: ni dos veces ni ninguna',
    `n=${s3?.denegaciones} · ${s3?.mensaje}`);

  const cronCiego = armarCron({
    contarDenegaciones: async () => { throw new Error('FAILED_PRECONDITION: falta el índice'); },
  });
  await lanza(cronCiego,
    'si el conteo revienta, el trabajo LANZA: Scheduler no lo da por bueno',
    'FAILED_PRECONDITION');
  const s4 = await leerSemaforo();
  check(s4?.ok === false && /FAILED_PRECONDITION/.test(s4?.mensaje || ''),
    'y aun así deja el rojo anotado con su causa, que es lo que se va a leer',
    s4?.mensaje);
  check(s4?.denegaciones === undefined,
    'sin inventar un conteo: «no se pudo contar» no se escribe como un número');

  // ────────────────────────────────────────────────────────────────────────
  console.log('\n§6 · el correo: tres estados, y el fallo no se dice «0»');

  const texto = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  const tCero = texto(bloqueDenegaciones({ total: 0, obras: [], codigos: [], sinFecha: 0 }));
  const tFallo = texto(bloqueDenegaciones({ error: 'FAILED_PRECONDITION: falta el índice' }));
  const tHay = texto(bloqueDenegaciones({ total: 2, obras: ['0114', '0127'], sinFecha: 0 }));

  check(/[Ss]in denegaciones/.test(tCero), 'el cero medido se dice como cero', tCero);
  check(/no es cero/.test(tFallo) && /FAILED_PRECONDITION/.test(tFallo),
    'el conteo que FALLÓ dice que falta el dato, y trae la causa', tFallo);
  check(!/\b0\b/.test(tFallo),
    'y en ninguna parte aparece un cero: el dato que falta no es un número', tFallo);
  check(tCero !== tFallo,
    '«no hubo» y «no se pudo contar» no se leen igual (P2)');
  check(/2 capturas fueron rechazadas/.test(tHay) && /0114/.test(tHay) && /0127/.test(tHay),
    'y con denegaciones encima, las nombra con sus obras', tHay);
  check(/1 captura fue rechazada/.test(texto(bloqueDenegaciones({ total: 1, obras: [] }))),
    'una sola se dice en singular');

  // El renglón llega al correo de verdad. El `bloqueDenegaciones` que se le
  // inyecta aquí es una MARCA, no el de arriba: lo que se mide es que el
  // armado del HTML lo monte, no lo que diga.
  const email = new Function('semaforoColor', 'APP_URL', 'PCT_FMT', 'MXN_FMT', 'bloqueDenegaciones',
    `${decl.buildEmailHTML}; return buildEmailHTML;`)(
    () => '#000', 'https://ejemplo', n => `${n}%`, n => `$${n}`,
    d => `<!--MARCA:${d?.error ? 'fallo' : d?.total}-->`);
  const html = email([{ obraId: '0114', nombre: 'Obra', avancePct: 10, pctGasto: 10,
    totGasto: 1, presupuesto: 2, cobrado: 1, diasDesdeCaptura: 1 }], 'hoy',
    { error: 'no se pudo' });
  check(html.includes('<!--MARCA:fallo-->'),
    'el correo semanal monta el renglón, y le pasa el fallo tal cual lo recibió');

  // Y el fallo VIAJA hasta ahí. El bloque 4bis sale de
  // `generarYEnviarResumenSemanal` y se corre con un conteo que revienta.
  const correr4bis = new Function('db', 'contarDenegaciones', 'console',
    `return (async () => { ${FUENTE_4BIS}; return denegaciones; })();`);
  const viajado = await correr4bis({}, async () => { throw new Error('sin índice'); },
    { error: () => {} });
  check(viajado?.error === 'sin índice',
    'cuando el conteo revienta, lo que llega al correo es el FALLO', JSON.stringify(viajado));
  check(viajado?.total === undefined,
    'y no un conteo en cero que nadie midió');
  const viajadoBien = await correr4bis({}, async () => ({ total: 4, obras: ['0114'] }),
    { error: () => {} });
  check(viajadoBien?.total === 4,
    'y cuando sí se pudo contar, viaja el conteo', JSON.stringify(viajadoBien));

  await limpiarDatos({ proyecto: PROYECTO });
  console.log(fallas === 0
    ? '\nEl canal avisa: lo que no se pudo anotar se grita, lo que no se pudo contar no se dice cero.'
    : `\n${fallas} comprobación(es) en ROJO.`);
  process.exit(fallas === 0 ? 0 : 1);
})();
