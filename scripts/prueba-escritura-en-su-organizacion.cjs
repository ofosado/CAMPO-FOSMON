#!/usr/bin/env node
// Prueba de INTEGRACIÓN: las escrituras de la app aterrizan en la organización
// de la sesión, y la captura del supervisor no se pierde en silencio.
//
// ── POR QUÉ EXISTE, SI YA HAY prueba-prefijo-organizacion.cjs ───────────────
// Porque esa prueba no habría atrapado esto, y no lo atrapó. Su helper
// `guardar()` llama a `conOrg` ÉL MISMO:
//
//     const real = conOrg(rutaLogica);
//     await setDoc(doc(db, ...real.split('/')), datos, { merge: true });
//
// Es decir: ejercita `src/rutas-org.js`, que estaba bien, y no los helpers de
// escritura de App.jsx, que era donde estaba el defecto. `fsSetAEstricto`
// escribía con `path.split('/')` pelón —sin prefijo— mientras su propia
// lectura previa sí pasaba por `fsGet`, que sí prefijaba. Esa asimetría es lo
// que lo hizo invisible: la bitácora quedaba con el «antes» correcto y el dato
// en otra parte. Y en una dependencia, en ninguna: las reglas niegan la raíz,
// `fsSetA` se traga el rechazo y devuelve `false`, y el supervisor veía
// «guardado» con su captura perdida.
//
// Reproducido el 2026-10-01 en el emulador contra OBRA DEMO 3: un cambio de
// cantEjec 31 → 44 dejaba tres `permission-denied` en consola, la raíz en 404
// y el documento de la organización intacto con el valor viejo.
//
// Por eso esta prueba monta los helpers REALES de App.jsx —extraídos por AST,
// no copiados— y los corre contra el emulador. Si alguien vuelve a armar una
// ruta de obra sin `conOrg`, esto sale en rojo.
//
// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
// Cada mutación rompe SEMÁNTICA, no andamiaje, y da ROJO (salida 1) — no
// NO ARRANCÓ (salida 2). Verificadas el 2026-10-01:
//
//   1. `fsSetAEstricto`: volver la escritura a `path.split('/')`
//        → 4 rojas en §1. La reveladora: «el guardado reporta éxito» da
//          `false`, que es exactamente lo que el supervisor no vio.
//   2. `uploadFoto`: quitar `conOrg` de la ruta de Storage
//        → 2 rojas (§4 y el barrido del §7)
//   3. `GuardarAvanceBtn`: quitar los dos `if (seSuscribe(...))`
//        → 1 roja en §5: se vuelven a pedir maquinaria y almacén
//   4. `src/ot.jsx`: volver `refOT` a `doc(fbDb, 'obras', ...segs)`
//        → 2 rojas (§6 y el barrido del §7)
//   5. `rutas-org.js`: que `prefijoOrg()` devuelva '' en vez de lanzar
//        → 3 rojas en §3, incluida «LO PISÓ LA ESCRITURA HUÉRFANA»: el
//          documento de FOSMON sobrescrito por una sesión sin organización.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-escritura-en-su-organizacion.cjs

const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc,
        deleteDoc, collection, getDocs } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const ORG_DEP = 'coatzacoalcos';
const OBRA_DEP = 'OP-2026-001';
const OBRA_CONS = '0114';

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const noArranco = (motivo, pistaEmulador = false) => {
  console.error(`\nNO ARRANCÓ: ${motivo}\n`);
  if (pistaEmulador) {
    console.error('Los emuladores tienen que estar arriba:');
    console.error('  firebase emulators:start --only firestore,auth --project campo-fosmon-prueba\n');
  }
  process.exit(2);
};

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenDe = (uid, claims) => {
  const ahora = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({ iss: `prueba@${PROYECTO}.iam.gserviceaccount.com`,
          sub: `prueba@${PROYECTO}.iam.gserviceaccount.com`,
          aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
          iat: ahora, exp: ahora + 3600, uid, claims }),
    '',
  ].join('.');
};

// ── Extracción por AST ──────────────────────────────────────────────────────
// Se extraen las declaraciones REALES de App.jsx y src/ot.jsx. No se copian:
// una copia se desincroniza y entonces la prueba pasa mientras la app falla.
const astDe = (archivo) => {
  const codigo = fs.readFileSync(archivo, 'utf8');
  return {
    codigo,
    ast: parse(codigo, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining',
                'nullishCoalescingOperator', 'dynamicImport'],
    }),
  };
};

// Devuelve el código fuente de `const NOMBRE = ...` para cada nombre pedido,
// en el orden en que aparecen en el archivo (importa: unos usan a otros).
function declaraciones({ codigo, ast }, nombres) {
  const halladas = new Map();
  traverse(ast, {
    VariableDeclarator(p) {
      const n = p.node.id?.name;
      if (!nombres.includes(n) || halladas.has(n)) return;
      halladas.set(n, codigo.slice(p.parent.start, p.parent.end));
    },
    FunctionDeclaration(p) {
      const n = p.node.id?.name;
      if (!nombres.includes(n) || halladas.has(n)) return;
      halladas.set(n, codigo.slice(p.node.start, p.node.end));
    },
  });
  const faltan = nombres.filter(n => !halladas.has(n));
  if (faltan.length) {
    noArranco(`no se encontraron en ${path.basename(archivo0)}: ${faltan.join(', ')} — ¿se renombraron?`);
  }
  // Orden de aparición en el archivo.
  return nombres
    .map(n => ({ n, src: halladas.get(n) }))
    .sort((a, b) => codigo.indexOf(a.src) - codigo.indexOf(b.src))
    .map(x => x.src)
    .join('\n');
}
let archivo0 = '';

// Extrae una función interna (declarada DENTRO de otra) por nombre.
function declaracionInterna({ codigo, ast }, contenedor, interna) {
  let src = null;
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== contenedor) return;
      p.traverse({
        FunctionDeclaration(q) {
          if (!src && q.node.id?.name === interna) src = codigo.slice(q.node.start, q.node.end);
        },
      });
    },
  });
  if (!src) noArranco(`no se encontró \`${interna}\` dentro de \`${contenedor}\` — ¿se renombró?`);
  return src;
}

(async () => {
  // src/rutas-org.js es ESM y este guion CJS (la raíz es "type": "module").
  let rutas;
  try { rutas = await import(path.resolve(raiz, 'src/rutas-org.js')); }
  catch (e) { noArranco(`no se pudo cargar src/rutas-org.js — ${e.message}`); }
  const { conOrg, fijarPrefijoOrg, limpiarPrefijoOrg } = rutas;
  if (typeof conOrg !== 'function') noArranco('src/rutas-org.js no expone conOrg');

  const app = initializeApp({ projectId: PROYECTO, apiKey: 'fake-api-key' }, `esc-${Date.now()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, HOST, PUERTO);
  connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });

  const entrarComo = async (uid, claims) => {
    try { await signInWithCustomToken(auth, tokenDe(uid, claims)); }
    catch (e) { noArranco(`el emulador de Auth no aceptó el token — ${e.message}`, true); }
  };

  // ── Montaje de los helpers de App.jsx ─────────────────────────────────────
  archivo0 = path.join(raiz, 'src/App.jsx');
  const modApp = astDe(archivo0);
  const NOMBRES = ['fsGet', 'fsSet', 'fsDel', 'fsSetAEstricto', 'fsSetA'];
  const fuenteHelpers = declaraciones(modApp, NOMBRES);

  const auditoria = [];                     // lo que la bitácora registró
  const LIBRES = ['doc', 'setDoc', 'getDoc', 'deleteDoc', 'collection', 'getDocs',
                  'fbDb', 'conOrg', 'fsAudit'];
  let helpers;
  try {
    const fabrica = new Function(...LIBRES,
      `${fuenteHelpers}; return { ${NOMBRES.join(', ')} };`);
    helpers = fabrica(doc, setDoc, getDoc, deleteDoc, collection, getDocs,
                      db, conOrg, async (tipo, op) => { auditoria.push({ tipo, ...op }); });
  } catch (e) {
    noArranco(`los helpers de App.jsx no se pudieron montar en el sandbox — ${e.message}`);
  }
  const { fsGet, fsSetA, fsSetAEstricto } = helpers;

  // Lectura cruda por ruta LITERAL, para poder afirmar dónde NO quedó.
  const leerCrudo = async (rutaLiteral) => {
    try {
      const d = await getDoc(doc(db, ...rutaLiteral.split('/')));
      return d.exists() ? d.data() : null;
    } catch { return null; }
  };

  try { await entrarComo('sondeo', { rol: 'director_general', orgId: 'fosmon', tipo: 'constructora', todas: true, obras: [] }); }
  catch { noArranco('sin emulador de Auth', true); }

  console.log('\n── LA ESCRITURA ATERRIZA EN SU ORGANIZACIÓN ────────────────────\n');

  // ── §1 La captura del supervisor de una dependencia ─────────────────────
  console.log('§1 · el supervisor captura y su captura queda guardada');
  await entrarComo('u-sup', {
    rol: 'supervisor_obra', orgId: ORG_DEP, tipo: 'dependencia',
    todas: false, obras: [OBRA_DEP],
  });
  limpiarPrefijoOrg();
  fijarPrefijoOrg('dependencia', ORG_DEP);

  const marcaDep = `cap-${Date.now()}`;
  auditoria.length = 0;
  let okDep;
  try {
    okDep = await fsSetA(`obras/${OBRA_DEP}/avance/subs`,
      { data: [{ sec: 'A-01', cantEjec: 44 }], marca: marcaDep },
      { modulo: 'avance_fisico', entidad: 'captura intermedio', obraId: OBRA_DEP, obraNombre: 'OBRA DEMO 1' });
  } catch (e) {
    noArranco(`la captura ni se intentó — ${e.message}`);
  }
  // Lo primero que vio el usuario con el defecto: «guardado» y `false` por
  // dentro. `fsSetA` no lanza, devuelve booleano, y nadie lo mira.
  check(okDep === true,
        'el guardado reporta éxito, no un `false` que nadie mira', String(okDep));

  const releido = await fsGet(`obras/${OBRA_DEP}/avance/subs`);
  check(releido?.marca === marcaDep,
        'y la app vuelve a leer lo que acaba de capturar',
        !releido ? 'NO LO ENCONTRÓ'
          : releido.marca === marcaDep ? `cantEjec=${releido.data?.[0]?.cantEjec}`
          : 'LEYÓ UNA VERSIÓN VIEJA — la captura no llegó');

  const enOrg = await leerCrudo(`orgs/${ORG_DEP}/obras/${OBRA_DEP}/avance/subs`);
  check(enOrg?.marca === marcaDep,
        'el documento está bajo su organización', `orgs/${ORG_DEP}/obras/${OBRA_DEP}/avance/subs`);

  // La afirmación que de verdad importa: no se fue a la raíz, donde viven las
  // obras de FOSMON.
  const enRaiz = await leerCrudo(`obras/${OBRA_DEP}/avance/subs`);
  check(enRaiz === null,
        'y NO se fue a la raíz, con las obras de FOSMON',
        enRaiz ? 'ESTÁ EN LA RAÍZ' : 'la raíz está limpia');

  check(auditoria.length === 1 && /crear|editar/.test(auditoria[0]?.tipo || ''),
        'la bitácora registró el cambio', auditoria[0]?.tipo || 'NO REGISTRÓ');

  // ── §2 FOSMON no se mueve ───────────────────────────────────────────────
  console.log('\n§2 · las obras de FOSMON siguen en la raíz');
  await entrarComo('u-fosmon', {
    rol: 'director_general', orgId: 'fosmon', tipo: 'constructora', todas: true, obras: [],
  });
  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');

  const marcaCons = `cons-${Date.now()}`;
  const okCons = await fsSetA(`obras/${OBRA_CONS}/avance/subs`,
    { data: [], marca: marcaCons },
    { modulo: 'avance_fisico', entidad: 'captura', obraId: OBRA_CONS, obraNombre: '0114' });
  check(okCons === true, 'el guardado de constructora reporta éxito', String(okCons));
  const consEnRaiz = await leerCrudo(`obras/${OBRA_CONS}/avance/subs`);
  check(consEnRaiz?.marca === marcaCons, 'y quedó en la raíz, donde estaba');
  const consEnPrefijo = await leerCrudo(`orgs/fosmon/obras/${OBRA_CONS}/avance/subs`);
  check(consEnPrefijo === null, 'no se duplicó bajo orgs/fosmon/');

  // ── §3 Sin organización resuelta no se escribe en ningún lado ───────────
  console.log('\n§3 · sin organización resuelta, revienta antes de tocar la red');
  limpiarPrefijoOrg();
  const marcaHuerfana = `huerfana-${Date.now()}`;
  let lanzo = false, mensaje = '';
  try {
    await fsSetAEstricto(`obras/${OBRA_CONS}/avance/subs`, { marca: marcaHuerfana },
      { modulo: 'avance_fisico', entidad: 'captura', obraId: OBRA_CONS });
  } catch (e) { lanzo = true; mensaje = e.message; }
  check(lanzo, 'la escritura estricta lanza en vez de caer a la raíz',
        mensaje || 'NO LANZÓ — ESCRIBIÓ');
  // Que lo anterior no sea palabrería: el documento quedó intacto.
  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');
  const tras = await leerCrudo(`obras/${OBRA_CONS}/avance/subs`);
  check(tras?.marca === marcaCons,
        'y el documento de FOSMON quedó intacto',
        tras?.marca === marcaHuerfana ? 'LO PISÓ LA ESCRITURA HUÉRFANA' : 'intacto');
  // Y la versión que se traga el error tampoco escribe: devuelve `false`, que
  // es lo correcto cuando no se pudo decidir dónde.
  limpiarPrefijoOrg();
  const okHuerfano = await fsSetA(`obras/${OBRA_CONS}/avance/subs`, { marca: marcaHuerfana });
  check(okHuerfano === false,
        'y la versión indulgente devuelve false, no un éxito falso', String(okHuerfano));

  // ── §4 La foto del supervisor ───────────────────────────────────────────
  // Storage tiene el MISMO esquema que Firestore (`storage.rules`: /obras/…
  // para constructora, /orgs/{oid}/obras/… para dependencia) y la rama de
  // constructora exige `tipo == 'constructora'`. Una foto sin prefijo se va a
  // una ruta que las reglas niegan.
  console.log('\n§4 · la foto que sube el supervisor apunta a su organización');
  const fuenteUpload = declaraciones(modApp, ['uploadFoto']);
  const rutasStorage = [];
  const fabricaUp = new Function('storageRef', 'fbStor', 'uploadString', 'getDownloadURL', 'conOrg',
    `${fuenteUpload}; return uploadFoto;`);
  const uploadFoto = fabricaUp(
    (_stor, ruta) => { rutasStorage.push(ruta); return { ruta }; },
    {}, async () => {}, async r => `https://ejemplo/${r.ruta}`, conOrg);

  limpiarPrefijoOrg();
  fijarPrefijoOrg('dependencia', ORG_DEP);
  await uploadFoto(OBRA_DEP, 'A-01', 'f1', 'data:image/png;base64,AAA');
  check(rutasStorage[0] === `orgs/${ORG_DEP}/obras/${OBRA_DEP}/fotos/A-01/f1`,
        'en dependencia la foto va bajo orgs/', rutasStorage[0]);

  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');
  await uploadFoto(OBRA_CONS, 'A-01', 'f1', 'data:image/png;base64,AAA');
  check(rutasStorage[1] === `obras/${OBRA_CONS}/fotos/A-01/f1`,
        'y en constructora sigue en la raíz', rutasStorage[1]);

  // ── §5 El guardado del supervisor no pide lo que no le toca ─────────────
  // `avance/maquinaria` y `avance/materiales` son costo del contratista: están
  // en RUTAS_SOLO_CONSTRUCTORA y las reglas no las declaran del lado
  // dependencia. Pedirlas deja dos `permission-denied` que `fsSetA` se traga —
  // ruido que entrena a ignorar la consola (P5: el corte es NO PEDIR).
  console.log('\n§5 · el guardado del supervisor no pide maquinaria ni almacén');
  const fuenteGuardar = declaracionInterna(modApp, 'GuardarAvanceBtn', 'guardar');
  const fuenteSeSuscribe = declaraciones(modApp, ['RUTAS_SOLO_CONSTRUCTORA', 'seSuscribe']);

  const correrGuardar = async (tipo) => {
    const pedidas = [];
    const LIBRES_G = ['setEstado', 'setFalloSnapshot', 'subs', 'maquinaria', 'materiales',
                      'obra', 'usuario', 'fsSetA', 'crearSnapshotAvance', 'onHistorialNuevo',
                      'onSaved', 'notifARoles', 'ErrorSnapshot'];
    const args = {
      setEstado: () => {}, setFalloSnapshot: () => {},
      subs: [{ sec: 'A-01', a: 50, cantEjec: 5 }],
      maquinaria: [], materiales: [],
      obra: { id: OBRA_DEP, nombre: 'OBRA DEMO 1', contrato: 'C-1' },
      usuario: { tipo, correo: 'x@y.z' },
      fsSetA: async (p) => { pedidas.push(p.replace(`obras/${OBRA_DEP}/`, '')); return true; },
      crearSnapshotAvance: async () => null,
      onHistorialNuevo: () => {}, onSaved: () => {},
      notifARoles: async () => {},
      ErrorSnapshot: class extends Error {},
    };
    const fabrica = new Function(...LIBRES_G,
      `${fuenteSeSuscribe}\n${fuenteGuardar}; return guardar;`);
    await fabrica(...LIBRES_G.map(k => args[k]))('intermedio');
    return pedidas;
  };

  const pedDep = await correrGuardar('dependencia');
  check(pedDep.includes('avance/subs'),
        'el avance físico sí se guarda', pedDep.join(', ') || 'nada');
  check(!pedDep.includes('avance/maquinaria') && !pedDep.includes('avance/materiales'),
        'y no se piden maquinaria ni almacén', pedDep.join(', ') || 'nada');

  const pedCons = await correrGuardar('constructora');
  check(pedCons.includes('avance/maquinaria') && pedCons.includes('avance/materiales'),
        'en constructora se siguen guardando los tres', pedCons.join(', '));

  // ── §6 Las órdenes de trabajo ───────────────────────────────────────────
  // El módulo armaba sus referencias por segmentos —`doc(fbDb, "obras", id, …)`—
  // y así se saltaba la decisión de dónde vive la obra.
  console.log('\n§6 · las órdenes de trabajo también resuelven su organización');
  const modOt = astDe(path.join(raiz, 'src/ot.jsx'));
  archivo0 = path.join(raiz, 'src/ot.jsx');
  const fuenteOt = declaraciones(modOt, ['refOT', 'collOT']);
  const fabricaOt = new Function('doc', 'collection', 'conOrg',
    `${fuenteOt}; return { refOT, collOT };`);
  const { refOT, collOT } = fabricaOt(
    (_db, ...segs) => segs.join('/'), (_db, ...segs) => segs.join('/'), conOrg);

  limpiarPrefijoOrg();
  fijarPrefijoOrg('dependencia', ORG_DEP);
  check(refOT({}, OBRA_DEP, 'ordenes_trabajo', 'OT-1') === `orgs/${ORG_DEP}/obras/${OBRA_DEP}/ordenes_trabajo/OT-1`,
        'la OT de una dependencia queda bajo su organización',
        refOT({}, OBRA_DEP, 'ordenes_trabajo', 'OT-1'));
  check(collOT({}, OBRA_DEP, 'ordenes_trabajo') === `orgs/${ORG_DEP}/obras/${OBRA_DEP}/ordenes_trabajo`,
        'y el histórico se lee del mismo lugar');
  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');
  check(refOT({}, '0112', 'config', 'ot_dict') === 'obras/0112/config/ot_dict',
        'y en TAMSA/FOSMON sigue en la raíz, donde están las OT cargadas');

  // ── §7 Barrido: ninguna ruta de obra se arma sin conOrg ─────────────────
  // Lo anterior afirma sobre los sitios que YA se arreglaron. Esto es el guard
  // contra el siguiente: cualquier referencia nueva que nombre la colección
  // `obras` sin pasar por `conOrg` vuelve a abrir el mismo agujero.
  console.log('\n§7 · ningún sitio nuevo arma una ruta de obra sin conOrg');
  const sospechosos = [];
  for (const archivo of ['src/App.jsx', 'src/ot.jsx']) {
    const { codigo, ast } = archivo === 'src/App.jsx' ? modApp : modOt;
    traverse(ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        const nombre = callee?.name;
        if (!['doc', 'collection', 'storageRef'].includes(nombre)) return;
        const args = p.node.arguments;
        if (args.length < 2) return;
        // ¿El segundo argumento nombra la colección `obras`?
        const seg = args[1];
        const literal = seg?.type === 'StringLiteral' ? seg.value
          : seg?.type === 'TemplateLiteral' ? (seg.quasis[0]?.value?.raw || '') : null;
        if (literal === null) return;
        if (!/^obras(\/|$)/.test(literal)) return;
        // Pasa si cualquier argumento es una llamada a conOrg (directa o
        // dentro de un .split('/')).
        const fuente = codigo.slice(p.node.start, p.node.end);
        if (/conOrg\s*\(/.test(fuente)) return;
        const linea = codigo.slice(0, p.node.start).split('\n').length;
        sospechosos.push(`${archivo}:${linea}  ${fuente.slice(0, 70).replace(/\s+/g, ' ')}`);
      },
    });
  }
  check(sospechosos.length === 0,
        'ninguna referencia nombra `obras` sin resolver la organización',
        sospechosos.length ? '\n        ' + sospechosos.join('\n        ') : 'ninguna');

  // ── Limpieza del rastro de la prueba ────────────────────────────────────
  try {
    await entrarComo('u-fosmon', {
      rol: 'director_general', orgId: 'fosmon', tipo: 'constructora', todas: true, obras: [],
    });
    await deleteDoc(doc(db, 'obras', OBRA_CONS, 'avance', 'subs'));
  } catch { /* el emulador se vuelve a sembrar; no es motivo de rojo */ }

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0 ? 'cada escritura en su organización' : `${fallas} falla(s)`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.message ? e.message : e);
  process.exit(2);
});
