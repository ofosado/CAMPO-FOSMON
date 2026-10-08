#!/usr/bin/env node
// Prueba de INTEGRACIÓN: la gestión de usuarios no cruza organizaciones, y un
// perfil no se lo crea su propio dueño.
//
// ── QUÉ SE ENCONTRÓ (2026-10-07) ────────────────────────────────────────────
// Dos agujeros, los dos en producción, los dos en el camino que había que abrir
// para que un municipio pueda dar de alta a su gente sin que nosotros corramos
// un script.
//
// 1) LAS CINCO FUNCIONES DE GESTIÓN NO SABÍAN DE ORGANIZACIONES.
//    `requireAdmin` contesta «quién llama y si es admin», nunca «de qué
//    organización», y `ROLES_ADMIN` incluye `director_obras` y `subdirector`.
//    Así que un directivo de cualquier dependencia podía:
//      · `listarUsuarios`  → el padrón completo de todos los clientes.
//      · `cambiarPassword` → la contraseña de un director general ajeno, y
//        entrar como él. Ésta es la grave.
//      · `eliminarUsuario`, `actualizarUsuario` → sobre cualquier cuenta.
//    Que la interfaz no le ofreciera la pantalla no era defensa: un `onCall` se
//    invoca desde el SDK sin pasar por la interfaz.
//
// 2) UN PERFIL SE LO PODÍA CREAR SU PROPIO DUEÑO, CON EL ROL QUE QUISIERA.
//    `allow create: if esOwnUserDoc(docId)` quedó de cuando el login inventaba
//    el perfil que no encontraba. `esOwnUserDoc` NO pide `esAuth()` —basta
//    `request.auth != null` y que el correo case con el id—, así que una cuenta
//    recién nacida, sin un solo claim, lo cumplía. Y el alta propia de cuentas
//    en Auth no estaba deshabilitada. La cadena completa: crear cuenta →
//    escribir `usuarios/{yo}` con `rol:'director_general'`, `orgId:'fosmon'` →
//    `sincronizarClaims` lo valida (rol existe, org existe y está activa, rol
//    pertenece al tipo) y LO CONCEDE.
//
// ── CÓMO SE MIDE ────────────────────────────────────────────────────────────
// §1 y §2 corren contra el emulador con las reglas DEL REPO, cargadas aquí por
// la API del emulador: así la prueba no depende de cuándo se arrancó.
// §3 ejecuta las cinco funciones REALES, extraídas de `functions/index.js` por
// AST, con un `admin` de mentira que sólo sirve para mirar qué escribieron. No
// están reescritas: una prueba que recopia la función se comprueba contra sí
// misma.
// §4 ejecuta `notifARoles` tal como está en App.jsx.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-aislamiento-de-usuarios.cjs
//   node scripts/prueba-aislamiento-de-usuarios.cjs --contraprueba

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// El `FieldValue` de verdad, el mismo que la función usa en producción.
const { FieldValue } = require(path.join(raiz, 'functions/node_modules/firebase-admin/lib/firestore'));
noArranco.vigilarExcepciones();

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

// Los tres archivos bajo prueba. Se pueden apuntar a copias mutadas: es como
// funciona la contraprueba de abajo.
const ARCH_REGLAS = process.env.ARCH_REGLAS || path.join(raiz, 'firestore.rules');
const ARCH_FUNCS  = process.env.ARCH_FUNCS  || path.join(raiz, 'functions/index.js');
const ARCH_APP    = process.env.ARCH_APP    || path.join(raiz, 'src/App.jsx');

// ── La contraprueba ────────────────────────────────────────────────────────
// Seis mutaciones, una por cada defensa, y separadas a propósito: si fueran una
// sola, bastaría con que la prueba viera la primera para salir en rojo y las
// otras cinco se irían en verde sin que nadie las mida.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    { archivo: ARCH_REGLAS, env: 'ARCH_REGLAS', ext: '.rules',
      nombre: 'el perfil vuelve a poderlo crear su propio dueño',
      de: `      allow create: if esAdminDeOrg(request.resource.data.orgId);`,
      a:  `      allow create: if esOwnUserDoc(docId) || esAdminDeOrg(request.resource.data.orgId);` },
    { archivo: ARCH_REGLAS, env: 'ARCH_REGLAS', ext: '.rules',
      nombre: 'las lecturas del padrón vuelven a no mirar la organización',
      de: `      allow read: if esOwnUserDoc(docId) || esAdminDeOrg(resource.data.orgId);`,
      a:  `      allow read: if esOwnUserDoc(docId) || esAdminSistemaOSoporte();` },
    { archivo: ARCH_FUNCS, env: 'ARCH_FUNCS', ext: '.js',
      nombre: '`crearUsuario` vuelve a no escribir `orgId`',
      de: `    orgId: orgId || null,\n`, a: `` },
    // Las tres mutaciones que siguen quitan la MISMA comprobación de tres
    // funciones distintas, y por eso el texto que buscan arrastra la línea de
    // abajo: las dos primeras líneas son idénticas en las tres, y un `replace`
    // de cadena sólo cambia la primera aparición. Sin el ancla, la mutación de
    // `cambiarPassword` desarmaba en realidad `eliminarUsuario`, y una defensa
    // se quedaba sin medir.
    { archivo: ARCH_FUNCS, env: 'ARCH_FUNCS', ext: '.js',
      nombre: '`cambiarPassword` vuelve a no mirar la organización',
      de: `  const perfilSnap = await admin.firestore().doc(\`usuarios/\${emailAId(emailNorm)}\`).get();\n  exigirMismaOrg(ambito, perfilSnap.exists ? perfilSnap.data() : null, emailNorm);\n\n  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);\n  if (!userRecord) {`,
      a:  `  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);\n  if (!userRecord) {` },
    { archivo: ARCH_FUNCS, env: 'ARCH_FUNCS', ext: '.js',
      nombre: '`eliminarUsuario` vuelve a no mirar la organización',
      de: `  const perfilSnap = await admin.firestore().doc(\`usuarios/\${emailAId(emailNorm)}\`).get();\n  exigirMismaOrg(ambito, perfilSnap.exists ? perfilSnap.data() : null, emailNorm);\n\n  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);\n  if (userRecord) {`,
      a:  `  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);\n  if (userRecord) {` },
    { archivo: ARCH_FUNCS, env: 'ARCH_FUNCS', ext: '.js',
      nombre: '`actualizarUsuario` vuelve a no mirar la organización',
      de: `  const perfilObjetivo = snap.data() || {};\n  exigirMismaOrg(ambito, perfilObjetivo, emailNorm);`,
      a:  `  const perfilObjetivo = snap.data() || {};` },
    { archivo: ARCH_FUNCS, env: 'ARCH_FUNCS', ext: '.js',
      nombre: '`listarUsuarios` vuelve a devolver la colección entera',
      de: `  const snap = await (ambito.cross ? col.get() : col.where("orgId", "==", ambito.orgId).get());`,
      a:  `  const snap = await col.get();` },
    { archivo: ARCH_APP, env: 'ARCH_APP', ext: '.jsx',
      nombre: '`notifARoles` vuelve a buscar por rol en todas las organizaciones',
      de: `    const q = query(collection(fbDb, 'usuarios'), where('orgId', '==', orgIdSesion()));`,
      a:  `    const q = query(collection(fbDb, 'usuarios'), where('rol', 'in', roles));` },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(m.archivo, 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en ${path.basename(m.archivo)}.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `aisl-mut-${Date.now()}${m.ext}`);
    fs.writeFileSync(roto, base.replace(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, [m.env]: roto } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : `NO LA VE   `}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        `Una mutación que no se ve es una aserción que no mide.`);
      if (r.status === 2) console.log((r.stdout + r.stderr).split('\n').slice(0, 10).map(l => '             ' + l).join('\n'));
    } else {
      for (const l of r.stdout.match(/^FALLA.*/gm) || []) console.log(`             ${l.replace(/^FALLA\s+/, '· ')}`);
    }
    fs.unlinkSync(roto);
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven. La prueba mide lo que dice medir.`
    : `\n${malas} mutación(es) pasaron inadvertidas.`);
  process.exit(malas > 0 ? 1 : 0);
}

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc,
        deleteDoc, collection, query, where, getDocs } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken,
        createUserWithEmailAndPassword } = require('firebase/auth');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
// Se mira `code` y no el texto: el emulador deniega con `false for 'get' @ L225`,
// que no dice «permission».
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied|false for/i.test(e?.message || '');

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

// ── Extracción por AST ─────────────────────────────────────────────────────
const astDe = (archivo, plugins = []) => {
  const codigo = fs.readFileSync(archivo, 'utf8');
  return { archivo, codigo, ast: parse(codigo, { sourceType: 'module', plugins }) };
};

// Devuelve el código de cada `const X = …` / `function X(){}` pedido, en el
// orden en que aparece en el archivo (importa: unos usan a otros).
function declaraciones(mod, nombres) {
  const halladas = new Map();
  traverse(mod.ast, {
    VariableDeclarator(p) {
      const n = p.node.id && p.node.id.name;
      if (!nombres.includes(n) || halladas.has(n)) return;
      halladas.set(n, [p.parent.start, mod.codigo.slice(p.parent.start, p.parent.end)]);
    },
    FunctionDeclaration(p) {
      const n = p.node.id && p.node.id.name;
      if (!nombres.includes(n) || halladas.has(n)) return;
      halladas.set(n, [p.node.start, mod.codigo.slice(p.node.start, p.node.end)]);
    },
  });
  const faltan = nombres.filter(n => !halladas.has(n));
  if (faltan.length) {
    noArranco(`no se encontraron en ${path.basename(mod.archivo)}: ${faltan.join(', ')} — ¿se renombraron?`);
  }
  return [...halladas.values()].sort((a, b) => a[0] - b[0]).map(x => x[1]).join('\n');
}

// El manejador de una Cloud Function: el único argumento de `onCall(...)` en
// `exports.NOMBRE = onCall(handler)`.
function manejador(mod, nombre) {
  let src = null;
  traverse(mod.ast, {
    AssignmentExpression(p) {
      const iz = p.node.left;
      if (!(iz.type === 'MemberExpression' && iz.object.name === 'exports'
            && iz.property.name === nombre)) return;
      const de = p.node.right;
      if (de.type !== 'CallExpression' || !de.arguments.length) return;
      src = mod.codigo.slice(de.arguments[0].start, de.arguments[0].end);
    },
  });
  if (!src) noArranco(`no se encontró \`exports.${nombre} = onCall(…)\` en ${path.basename(mod.archivo)}`);
  return src;
}

// ── Carga de las reglas del repo en el emulador ─────────────────────────────
// Por la API del propio emulador, para que la prueba mida las reglas DEL
// ARCHIVO y no las que estuvieran cargadas de antes.
async function cargarReglas(archivo) {
  const r = await fetch(
    `http://${HOST}:${PUERTO}/emulator/v1/projects/${PROYECTO}:securityRules`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules',
        content: fs.readFileSync(archivo, 'utf8') }] } }) });
  if (!r.ok) noArranco(`el emulador no aceptó las reglas: ${r.status} ${await r.text()}`);
}

// Las organizaciones de la prueba llevan sufijo de corrida. NO es cosmético, y
// tampoco se resuelve borrando el emulador al empezar:
//   · Sin sufijo, `sembrar()` pisaba `orgs/fosmon` y `orgs/coatzacoalcos`, que
//     son las del preview: la prueba le borraba el nombre y el branding a la
//     pantalla con la que se verifica.
//   · Y los perfiles de corridas anteriores se sumaban a la cuenta de «lista a
//     los suyos», que pasó de 1 a 2 usuarios sola. Una prueba cuyo resultado
//     depende de cuántas veces se corrió antes no mide conducta.
// Borrar la base del emulador arreglaría lo segundo y empeoraría lo primero: se
// llevaría la siembra del preview por delante.
const SUFIJO = `p${Date.now().toString(36)}`;

// ── El `admin` de mentira ───────────────────────────────────────────────────
// Lo mínimo para que las funciones reales corran y se pueda mirar qué hicieron.
// No simula reglas: §3 mide la lógica de las funciones, y las reglas se miden
// contra el emulador en §1 y §2.
function baseFalsa(docsIniciales) {
  const docs = new Map(Object.entries(docsIniciales));
  const escrituras = [];
  const authOps = [];
  const cuentas = new Map();  // email → {uid, password}
  for (const [ruta, d] of docs) {
    if (ruta.startsWith('usuarios/')) cuentas.set(d.email, { uid: d.uid || `uid-${d.email}`, password: 'vieja' });
  }
  const refDoc = (ruta) => ({
    get: async () => ({ exists: docs.has(ruta), data: () => docs.get(ruta) }),
    set: async (d, opt) => {
      escrituras.push({ ruta, d });
      docs.set(ruta, opt && opt.merge ? { ...(docs.get(ruta) || {}), ...d } : d);
    },
    delete: async () => { escrituras.push({ ruta, borrado: true }); docs.delete(ruta); },
  });
  const filas = () => [...docs.entries()]
    .filter(([r]) => r.startsWith('usuarios/'))
    .map(([r, d]) => ({ id: r.slice('usuarios/'.length), data: () => d }));
  const firestore = () => ({
    doc: refDoc,
    collection: (nombre) => {
      if (nombre !== 'usuarios') noArranco(`la base de mentira no conoce la colección ${nombre}`);
      const hacer = (filtro) => ({
        get: async () => ({ docs: filas().filter(f => !filtro || filtro(f.data())), size: 0 }),
        where: (campo, op, val) => {
          if (op !== '==') noArranco(`la base de mentira sólo sabe de '==', no de '${op}'`);
          return hacer(d => (d[campo] === undefined ? null : d[campo]) === val);
        },
      });
      return hacer(null);
    },
  });
  // `admin` NO lleva `.firestore.FieldValue`, a propósito: el `FieldValue` de
  // verdad entra como su propio argumento al montar las funciones. El namespace
  // es justo lo que el emulador de funciones pierde al envolver el módulo
  // —`value.bind(target)` descarta las propiedades propias—, así que una prueba
  // que se lo fabrica deja de ver ese modo de fallo entero.
  return {
    escrituras, authOps, docs, cuentas,
    admin: {
      firestore,
      auth: () => ({
        createUser: async ({ email, password, displayName }) => {
          authOps.push({ op: 'createUser', email });
          if (cuentas.has(email)) { const e = new Error('existe'); e.code = 'auth/email-already-exists'; throw e; }
          const uid = `uid-${email}`;
          cuentas.set(email, { uid, password, displayName });
          return { uid, email };
        },
        getUserByEmail: async (email) => {
          if (!cuentas.has(email)) throw new Error(`no existe ${email}`);
          return { uid: cuentas.get(email).uid, email, disabled: false, customClaims: {} };
        },
        updateUser: async (uid, cambios) => {
          authOps.push({ op: 'updateUser', uid, cambios });
          for (const [em, c] of cuentas) if (c.uid === uid) cuentas.set(em, { ...c, ...cambios });
        },
        deleteUser: async (uid) => { authOps.push({ op: 'deleteUser', uid }); },
        revokeRefreshTokens: async () => {},
        setCustomUserClaims: async () => {},
      }),
    },
  };
}

class HttpsErrorFalso extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

(async () => {
  console.log('\n── LA GESTIÓN DE USUARIOS NO CRUZA ORGANIZACIONES ──────────────\n');

  // ═══ §1 y §2: las reglas, contra el emulador ═════════════════════════════
  await cargarReglas(ARCH_REGLAS).catch(e => {
    noArranco(`no se pudo hablar con el emulador de Firestore en ${HOST}:${PUERTO} — ${e.message}\n` +
      '  firebase emulators:start --only firestore,auth --project campo-fosmon-prueba');
  });

  const apps = [];
  const abrir = async (nombre, uid, claims) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, `${nombre}-${Date.now()}`);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    try { await signInWithCustomToken(auth, tokenDe(uid, claims)); }
    catch (e) { noArranco(`el emulador de Auth no aceptó el token — ${e.message}`); }
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  // Alta propia, con correo y contraseña: así nace la cuenta de quien se
  // registra solo. El token resultante lleva el correo y CERO claims.
  const abrirConAlta = async (nombre, email) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, `${nombre}-${Date.now()}`);
    apps.push(app);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    try { await createUserWithEmailAndPassword(auth, email, 'demo1234'); }
    catch (e) { noArranco(`el emulador de Auth no dio de alta ${email} — ${e.message}`); }
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  const ORG_C = `fosmon-${SUFIJO}`, ORG_D = `coatzacoalcos-${SUFIJO}`;
  // Con sufijo, por lo mismo que las organizaciones: la limpieza del final no
  // corre cuando la prueba sale en rojo —y la contraprueba la hace salir en
  // rojo a propósito—, así que un perfil de una corrida anterior se queda. Y se
  // queda con el `orgId` viejo, que ahora es INMUTABLE: la siembra de la
  // corrida siguiente no podía ni sobrescribirlo, y la prueba salía con «no
  // arrancó» por la basura de la anterior.
  const EMAIL_DG = `dg.${SUFIJO}@fosmon.com.mx`;
  const EMAIL_DIR_D = `dir.${SUFIJO}@coatza.gob.mx`;
  const idDe = e => e.replace('@', '_').replace(/\./g, '_');
  const DOC_DG = idDe(EMAIL_DG);              // director general de la constructora
  const DOC_DIR_D = idDe(EMAIL_DIR_D);        // director de obras del municipio

  // Siembra con un admin de cada organización. Se usa `soporte`, que es el
  // único que puede escribir en las dos, para no depender de la regla que se
  // está midiendo.
  const dbSop = await abrir('sop', 'u-sop', { rol: 'soporte', orgId: null, tipo: null, todas: false, obras: [] });
  const sembrar = async () => {
    await setDoc(doc(dbSop, 'orgs', ORG_C), { nombre: 'FOSMON', tipo: 'constructora', activa: true });
    await setDoc(doc(dbSop, 'orgs', ORG_D), { nombre: 'Coatzacoalcos', tipo: 'dependencia', activa: true });
    await setDoc(doc(dbSop, 'usuarios', DOC_DG),
      { email: EMAIL_DG, nombre: 'Dir General', rol: 'director_general', orgId: ORG_C, activo: true, uid: 'uid-dg' });
    await setDoc(doc(dbSop, 'usuarios', DOC_DIR_D),
      { email: EMAIL_DIR_D, nombre: 'Dir Obras', rol: 'director_obras', orgId: ORG_D, activo: true, uid: 'uid-dir-d' });
  };
  try { await sembrar(); }
  catch (e) { noArranco(`la siembra falló: soporte no pudo escribir — ${e.message}`); }

  // ── §1 El admin de una dependencia no alcanza el padrón de la constructora ─
  console.log('§1 · el padrón de un cliente no es dato de otro cliente');
  const dbDirD = await abrir('dird', 'u-dir-d',
    { rol: 'director_obras', orgId: ORG_D, tipo: 'dependencia', todas: true, obras: [] });

  let err = null;
  try { await getDoc(doc(dbDirD, 'usuarios', DOC_DG)); } catch (e) { err = e; }
  check(denegado(err),
    'el director de obras del municipio NO lee el perfil del director general de FOSMON',
    err ? 'denegado' : 'LO LEYÓ');

  err = null;
  try { await getDocs(collection(dbDirD, 'usuarios')); } catch (e) { err = e; }
  check(denegado(err),
    'ni recorre la colección entera sin decir de qué organización',
    err ? 'denegado' : 'LA RECORRIÓ COMPLETA');

  // Y lo que sí debe poder: su propia organización.
  let propios = null;
  err = null;
  try {
    propios = await getDocs(query(collection(dbDirD, 'usuarios'), where('orgId', '==', ORG_D)));
  } catch (e) { err = e; }
  // Se afirma QUIÉNES vinieron, no cuántos: `usuarios` es una colección
  // compartida con el preview, y una cuenta ajena no debe poder volver roja una
  // prueba que no la mide.
  const ids = propios ? propios.docs.map(d => d.id) : [];
  check(!err && ids.includes(DOC_DIR_D) && propios.docs.every(d => d.data().orgId === ORG_D),
    'pero sí lista a los suyos, acotando por su organización',
    err ? `DENEGADO: ${err.code || err.message}` : ids.join(', ') || 'NINGUNO');

  err = null;
  try { await updateDoc(doc(dbDirD, 'usuarios', DOC_DG), { rol: 'cliente' }); } catch (e) { err = e; }
  check(denegado(err),
    'no le cambia el rol a un usuario de otra organización',
    err ? 'denegado' : 'SE LO CAMBIÓ');

  err = null;
  try { await deleteDoc(doc(dbDirD, 'usuarios', DOC_DG)); } catch (e) { err = e; }
  check(denegado(err),
    'ni lo borra',
    err ? 'denegado' : 'LO BORRÓ');

  // El campo `orgId` no es un pasaporte: tampoco puede mudarse a un usuario.
  err = null;
  try { await updateDoc(doc(dbDirD, 'usuarios', DOC_DIR_D), { orgId: ORG_C }); } catch (e) { err = e; }
  check(denegado(err),
    'y no mueve a uno de los suyos a otra organización editándolo',
    err ? 'denegado' : 'LO MUDÓ');

  // ── §2 Un perfil no se lo crea su propio dueño ────────────────────────────
  // La cuenta se da de alta COMO SE DA EN LA CALLE: correo y contraseña contra
  // Auth, sin un solo claim. No con un token forjado: el token tiene que llevar
  // el CORREO del dueño, porque es justo lo que `esOwnUserDoc` compara. Un
  // token sin correo haría pasar esta sección por la razón equivocada —y la
  // lectura de más abajo es la que lo demuestra.
  console.log('\n§2 · una cuenta sin claims no se asciende a sí misma');
  const EMAIL_INTRUSO = `intruso.${Date.now()}@ejemplo.com`;
  const DOC_INTRUSO = EMAIL_INTRUSO.replace('@', '_').replace(/\./g, '_');
  const dbIntruso = await abrirConAlta('intruso', EMAIL_INTRUSO);
  err = null;
  try {
    await setDoc(doc(dbIntruso, 'usuarios', DOC_INTRUSO),
      { email: EMAIL_INTRUSO, nombre: 'Yo mismo', rol: 'director_general',
        orgId: ORG_C, activo: true });
  } catch (e) { err = e; }
  check(denegado(err),
    'no puede crearse su propio perfil con rol de director general',
    err ? 'denegado' : 'SE LO CREÓ — y sincronizarClaims se lo concedería');

  // Que lo anterior no sea palabrería: el documento no quedó.
  const quedo = await getDoc(doc(dbSop, 'usuarios', DOC_INTRUSO)).catch(() => null);
  check(!quedo || !quedo.exists(),
    'y el documento no quedó escrito',
    quedo && quedo.exists() ? `QUEDÓ con rol=${quedo.data().rol}` : 'no existe');

  // Pero su propio perfil, una vez que un administrador lo creó, lo tiene que
  // poder LEER: el login lo necesita antes de que existan claims.
  // La siembra va con el MISMO `orgId` que el intruso intentó, no con otro: si
  // una mutación le devuelve el poder de crearse el perfil, esta escritura
  // tiene que seguir siendo legal —`orgId` es inmutable en update— para que la
  // contraprueba salga en ROJO y no en «no arrancó».
  await setDoc(doc(dbSop, 'usuarios', DOC_INTRUSO),
    { email: EMAIL_INTRUSO, nombre: 'Yo mismo', rol: 'residente', orgId: ORG_C, activo: true });
  err = null;
  try { await getDoc(doc(dbIntruso, 'usuarios', DOC_INTRUSO)); } catch (e) { err = e; }
  check(!err, 'el login sigue pudiendo leer su propio perfil sin claims',
    err ? `DENEGADO: ${err.code || err.message}` : 'puede');

  // ═══ §3: las cinco funciones de gestión, ejecutadas ══════════════════════
  console.log('\n§3 · las cinco funciones de gestión miran la organización');
  const modF = astDe(ARCH_FUNCS);
  const fuenteF = declaraciones(modF, [
    'ROLES_POR_TIPO', 'ROLES_CROSS', 'ROLES_VALIDOS', 'ROLES_ADMIN', 'ROLES_TODAS_OBRAS',
    'emailAId', 'requireAdmin', 'ambitoDe', 'exigirMismaOrg', 'validarRolEnOrg',
    'exigirPuedeOtorgarRol', 'leerOrg',
  ]);
  const NOMBRES_FN = ['crearUsuario', 'actualizarUsuario', 'eliminarUsuario',
                      'cambiarPassword', 'listarUsuarios'];
  const fuentesFn = NOMBRES_FN.map(n => `${n}: (${manejador(modF, n)})`).join(',\n');

  // §3 corre en memoria, no contra el emulador: aquí los identificadores sí son
  // los legibles, y TIENEN que serlo — las funciones reales calculan la clave
  // del documento con `emailAId(email)`, y el correo viene de la petición.
  const F_DG = 'dg_fosmon_com_mx', F_DIR_D = 'dir_coatza_gob_mx';

  const DOCS_BASE = {
    [`orgs/${ORG_C}`]: { nombre: 'FOSMON', tipo: 'constructora', activa: true },
    [`orgs/${ORG_D}`]: { nombre: 'Coatzacoalcos', tipo: 'dependencia', activa: true },
    [`usuarios/${F_DG}`]: { email: 'dg@fosmon.com.mx', nombre: 'Dir General',
      rol: 'director_general', orgId: ORG_C, activo: true, uid: 'uid-dg@fosmon.com.mx' },
    [`usuarios/${F_DIR_D}`]: { email: 'dir@coatza.gob.mx', nombre: 'Dir Obras',
      rol: 'director_obras', orgId: ORG_D, activo: true, uid: 'uid-dir@coatza.gob.mx' },
    'usuarios/sop_cotea_com_mx': { email: 'sop@cotea.com.mx', nombre: 'Soporte',
      rol: 'soporte', orgId: null, activo: true, uid: 'uid-sop@cotea.com.mx' },
  };

  // Monta las funciones reales sobre una base nueva. Cada escenario arranca
  // limpio: una prueba que arrastra estado mide el orden, no la conducta.
  const montar = () => {
    const base = baseFalsa(DOCS_BASE);
    let fns;
    try {
      fns = new Function('admin', 'HttpsError', 'FieldValue',
        `"use strict";${fuenteF}\nreturn {\n${fuentesFn}\n};`)(base.admin, HttpsErrorFalso, FieldValue);
    } catch (e) {
      noArranco(`las funciones de ${path.basename(ARCH_FUNCS)} no se pudieron montar — ${e.message}`);
    }
    return { base, fns };
  };
  const pedir = (correo, data) => ({ auth: { token: { email: correo } }, data });
  const intentar = async (fn, req) => {
    try { return { valor: await fn(req), err: null }; } catch (e) { return { valor: null, err: e }; }
  };

  // ── El alta escribe la organización de quien da el alta ──
  {
    const { base, fns } = montar();
    const r = await intentar(fns.crearUsuario, pedir('dir@coatza.gob.mx', {
      email: 'sup@coatza.gob.mx', password: 'demo1234', nombre: 'Supervisor',
      rol: 'supervisor_obra', obras_asignadas: ['OP-2026-001'],
    }));
    const perfil = base.docs.get('usuarios/sup_coatza_gob_mx');
    check(!r.err && perfil && perfil.orgId === ORG_D,
      'el alta hecha por el municipio deja al usuario EN el municipio',
      r.err ? `LANZÓ: ${r.err.message}` : `orgId=${perfil ? JSON.stringify(perfil.orgId) : 'SIN CAMPO'}`);
  }

  // ── Y no se la puede dictar desde el cliente ──
  {
    const { base, fns } = montar();
    const r = await intentar(fns.crearUsuario, pedir('dg@fosmon.com.mx', {
      email: 'colado@fosmon.com.mx', password: 'demo1234', nombre: 'Colado',
      rol: 'residente', orgId: ORG_D,          // ← el intento
    }));
    const perfil = base.docs.get('usuarios/colado_fosmon_com_mx');
    check(!r.err && perfil && perfil.orgId === ORG_C,
      'un `orgId` puesto en la llamada no mete al usuario en otra organización',
      r.err ? `LANZÓ: ${r.err.message}` : `orgId=${perfil ? JSON.stringify(perfil.orgId) : 'SIN CAMPO'}`);
  }

  // ── Un rol del otro tipo se rechaza ANTES de crear la cuenta de Auth ──
  // Si no, queda un registro en Auth sin perfil: el huérfano que
  // `crearUsuario` tiene que repararse a sí mismo más tarde.
  {
    const { base, fns } = montar();
    const r = await intentar(fns.crearUsuario, pedir('dir@coatza.gob.mx', {
      email: 'raro@coatza.gob.mx', password: 'demo1234', nombre: 'Raro',
      rol: 'director_general',                 // rol de constructora en una dependencia
    }));
    check(!!r.err, 'un rol de constructora en una dependencia se rechaza',
      r.err ? r.err.code : 'LO ACEPTÓ — la cuenta nacería sin claims');
    check(base.authOps.filter(o => o.op === 'createUser').length === 0,
      'y se rechaza antes de crear la cuenta en Auth, sin dejar huérfano',
      base.authOps.map(o => o.op).join(', ') || 'ninguna operación de Auth');
  }

  // ── El rol que cruza organizaciones sólo lo otorga quien lo tiene ──
  {
    const { fns } = montar();
    const r = await intentar(fns.crearUsuario, pedir('dg@fosmon.com.mx', {
      email: 'falso@cotea.com.mx', password: 'demo1234', nombre: 'Falso', rol: 'soporte',
    }));
    check(r.err && r.err.code === 'permission-denied',
      'un director general no puede crear una cuenta de soporte',
      r.err ? r.err.code : 'LA CREÓ');
  }

  // ── La contraseña ajena: la que de verdad importa ──
  {
    const { base, fns } = montar();
    const antes = base.cuentas.get('dg@fosmon.com.mx');
    const r = await intentar(fns.cambiarPassword, pedir('dir@coatza.gob.mx', {
      email: 'dg@fosmon.com.mx', nuevaPassword: 'meloquedo',
    }));
    check(!!r.err, 'el municipio NO le cambia la contraseña al director general de FOSMON',
      r.err ? r.err.code : 'SE LA CAMBIÓ');
    const despues = base.cuentas.get('dg@fosmon.com.mx');
    check(despues && despues.password === antes.password,
      'y la contraseña quedó como estaba',
      despues && despues.password === 'meloquedo' ? 'LA PISÓ' : 'intacta');
    // El mensaje no delata que la cuenta exista: distinguir «no existe» de «no
    // puedes» convierte esta función en un modo de enumerar el padrón ajeno.
    check(r.err && r.err.code === 'not-found',
      'y el mensaje no revela que esa cuenta exista',
      r.err ? r.err.code : '—');
  }

  // ── Borrar y editar, lo mismo ──
  // Cada una con su propia base: si compartieran una, un borrado que la
  // mutación deja pasar le quitaría el documento a la comprobación siguiente, y
  // esa saldría en «no arrancó» en vez de en rojo.
  {
    const { base, fns } = montar();
    const r1 = await intentar(fns.eliminarUsuario, pedir('dir@coatza.gob.mx', { email: 'dg@fosmon.com.mx' }));
    check(!!r1.err && base.docs.has(`usuarios/${F_DG}`),
      'tampoco borra una cuenta de otra organización',
      r1.err ? r1.err.code : 'LA BORRÓ');
    check(base.authOps.filter(o => o.op === 'deleteUser').length === 0,
      'ni la saca de Auth',
      base.authOps.map(o => o.op).join(', ') || 'ninguna operación de Auth');
  }
  {
    const { base, fns } = montar();
    const r2 = await intentar(fns.actualizarUsuario, pedir('dir@coatza.gob.mx',
      { email: 'dg@fosmon.com.mx', cambios: { rol: 'cliente' } }));
    const rolQuedo = (base.docs.get(`usuarios/${F_DG}`) || {}).rol;
    check(!!r2.err && rolQuedo === 'director_general',
      'ni le cambia el rol',
      r2.err ? r2.err.code : `LO DEJÓ EN ${rolQuedo}`);
  }

  // ── Y sí puede con los suyos: el aislamiento no es una pared ciega ──
  {
    const { base, fns } = montar();
    const r = await intentar(fns.actualizarUsuario, pedir('dir@coatza.gob.mx',
      { email: 'dir@coatza.gob.mx', cambios: { nombre: 'Director de Obras Públicas' } }));
    check(!r.err && base.docs.get(`usuarios/${F_DIR_D}`).nombre === 'Director de Obras Públicas',
      'con los de su propia organización sí puede',
      r.err ? `LANZÓ: ${r.err.code} ${r.err.message}` : 'editado');
  }

  // ── El listado ──
  {
    const { fns } = montar();
    const rD = await intentar(fns.listarUsuarios, pedir('dir@coatza.gob.mx', {}));
    const correosD = rD.valor ? rD.valor.usuarios.map(u => u.email).sort() : [];
    check(!rD.err && correosD.length === 1 && correosD[0] === 'dir@coatza.gob.mx',
      'el listado del municipio trae sólo a los suyos',
      rD.err ? `LANZÓ: ${rD.err.message}` : correosD.join(', ') || 'vacío');

    const rC = await intentar(fns.listarUsuarios, pedir('dg@fosmon.com.mx', {}));
    const correosC = rC.valor ? rC.valor.usuarios.map(u => u.email) : [];
    check(!rC.err && correosC.length === 1 && correosC[0] === 'dg@fosmon.com.mx',
      'y el de la constructora, sólo a los suyos',
      rC.err ? `LANZÓ: ${rC.err.message}` : correosC.join(', ') || 'vacío');

    // Soporte sí cruza: es su razón de existir. Lo que no puede es leer
    // operación, y eso lo sostienen las reglas, no esta función.
    const rS = await intentar(fns.listarUsuarios, pedir('sop@cotea.com.mx', {}));
    check(!rS.err && rS.valor.usuarios.length === 3,
      'soporte sí ve a todos: es el rol que cruza organizaciones',
      rS.err ? `LANZÓ: ${rS.err.message}` : `${rS.valor ? rS.valor.usuarios.length : 0} usuario(s)`);
  }

  // ═══ §4: el aviso no se va a otra organización ═══════════════════════════
  console.log('\n§4 · el aviso de un alta no llega al director de otro municipio');
  const modApp = astDe(ARCH_APP, ['jsx', 'classProperties', 'optionalChaining',
                                  'nullishCoalescingOperator', 'dynamicImport']);
  const fuenteNotif = declaraciones(modApp, ['notifARoles']);
  const consultas = [];
  const padron = [
    { orgId: ORG_D, rol: 'director_obras', uid: 'uid-dir-d', activo: true },
    { orgId: ORG_C, rol: 'director_obras', uid: 'uid-ajeno', activo: true },
    { orgId: ORG_C, rol: 'director_general', uid: 'uid-dg', activo: true },
  ];
  const notificados = [];
  const notifARoles = new Function(
    'query', 'collection', 'where', 'getDocs', 'fbDb', 'orgIdSesion', 'crearNotifPara',
    `${fuenteNotif}; return notifARoles;`)(
    (_col, ...filtros) => ({ filtros }),
    () => 'usuarios',
    (campo, op, val) => { consultas.push(`${campo} ${op} ${JSON.stringify(val)}`); return { campo, op, val }; },
    async (q) => {
      let filas = padron;
      for (const f of q.filtros) {
        if (f.op === '==') filas = filas.filter(x => x[f.campo] === f.val);
        else if (f.op === 'in') filas = filas.filter(x => f.val.includes(x[f.campo]));
      }
      return { docs: filas.map(d => ({ data: () => d })) };
    },
    {}, () => ORG_D,
    async (uids) => { notificados.push(...uids); });

  await notifARoles(['director_obras'], { titulo: 'Nuevo usuario' });
  check(consultas.some(c => c.startsWith('orgId ==')),
    'la consulta dice de qué organización', consultas.join(' · ') || 'ninguna');
  check(notificados.length === 1 && notificados[0] === 'uid-dir-d',
    'y el aviso llega al director de SU municipio y a nadie más',
    notificados.join(', ') || 'a nadie');

  // ── Limpieza ──
  try {
    await deleteDoc(doc(dbSop, 'usuarios', DOC_DG));
    await deleteDoc(doc(dbSop, 'usuarios', DOC_DIR_D));
    await deleteDoc(doc(dbSop, 'usuarios', DOC_INTRUSO));
  } catch { /* el emulador se vuelve a sembrar; no es motivo de rojo */ }

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0
    ? 'cada organización administra a su propia gente, y nadie se asciende a sí mismo'
    : `${fallas} falla(s)`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.message ? e.message : e);
  process.exit(2);
});
