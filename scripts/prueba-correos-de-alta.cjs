#!/usr/bin/env node
// Los tres avisos del alta salen de la app, y salen bien.
//
// ── QUÉ HABÍA ANTES (2026-11-03) ────────────────────────────────────────────
// Nada que salga del navegador. Dar de alta un usuario escribía una cuenta en
// Auth con una contraseña TECLEADA por quien daba el alta, y después alguien
// escribía un correo a mano —`CORREO_Aldo_Torres.md`, `CORREO_Julian_Islas.txt`
// quedaron en el repo como prueba— con esa contraseña dentro. Las dos mitades
// fallaban: las contraseñas que quedaron escritas son adivinables (nombre más
// año) y repetidas, y si el correo no se escribía, el usuario tenía cuenta y no
// lo sabía. El aviso de obra nueva sí existía, pero sólo en la campana, y
// encima se perdía: lo creaba el navegador con `notifARoles`, que necesita
// LISTAR `usuarios`, y la regla sólo se lo permite a un admin de la org — el
// `gerente_construccion`, que es quien da de alta las obras, no lo es, así que
// la lectura se denegaba, un `catch` se tragaba el error y el alta se consumaba
// sin avisarle a nadie. Es el #85.
//
// ── QUÉ SE MIDE AQUÍ ────────────────────────────────────────────────────────
// Seis conductas, y ninguna es «existe tal función»:
//
//  §1 La contraseña que viaja en el correo es LA MISMA que recibió Auth, se
//     sortea distinta cada vez, y el correo no lleva una sola cifra de dinero.
//  §2 El alta de una dependencia nombra SUS obras —no las de la raíz, que
//     llevan el mismo id— y va firmada con SU marca.
//  §3 Al editar un usuario sólo se avisan las obras que se AGREGARON, y no se
//     avisa nada si en el mismo acto se desactiva la cuenta.
//  §4 El aviso de obra nueva le llega a los roles de la casa UNIÓN los
//     asignados a esa obra, menos los ajenos a la casa (cliente, contratista),
//     menos los de otra organización, menos los inactivos. Y la campana recibe
//     exactamente a los mismos.
//  §5 Un presupuesto en cero no se pinta como «$0», ni en el correo ni en la
//     campana.
//  §6 La dependencia recibe su etiqueta («Monto contratado», «Empresa
//     ejecutante»), no la de la constructora.
//  §7 Si no se puede leer el tipo de la organización, no se avisa a NADIE.
//
// No se describe la conducta: se EJECUTA. Las cuatro piezas —`crearUsuario`,
// `actualizarUsuario`, `obraNuevaRaiz`, `obraNuevaDeOrg`— salen de
// `functions/index.js` por AST, con el cierre transitivo de los símbolos que
// nombran, y corren sobre un Firestore, un Auth y un `fetch` de mentira. Lo
// que se afirma es quién aparece en el `to` y qué dice el cuerpo.
//
// La lista de dependencias NO está tecleada: se calculan los identificadores
// libres del manejador y se le piden a `fuenteDe` (ver el preámbulo de
// `extraer-de-app.cjs`: una lista a mano es una copia del grafo).
//
// Uso:
//   node scripts/prueba-correos-de-alta.cjs
//   node scripts/prueba-correos-de-alta.cjs --contraprueba

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');

// ── La contraprueba ─────────────────────────────────────────────────────────
// Una mutación por defensa, separadas a propósito: si fueran una sola, la
// prueba se pondría roja en la primera y las demás se irían en verde sin que
// nadie las mida.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    { nombre: 'la contraseña del correo deja de ser la que recibió Auth',
      de: '    email: emailNorm,\n    password,\n    rol,',
      a:  '    email: emailNorm,\n    password: generarPasswordTemporal(),\n    rol,' },
    { nombre: 'las obras se buscan siempre en la raíz, también las de una dependencia',
      de: 'const rutaObrasDeOrg = (orgId, tipo) =>\n  tipo === "dependencia" ? `orgs/${orgId}/obras` : "obras";',
      a:  'const rutaObrasDeOrg = (orgId, tipo) =>\n  "obras";' },
    { nombre: 'el correo de bienvenida ya no dice cómo cambiar la contraseña',
      de: '    pasosHTML("Cámbiala en cuanto entres", PASOS_CAMBIO_PASS) +',
      a:  '    "" +' },
    { nombre: 'la etiqueta del rol viaja tal como la mandó el cliente',
      de: '  const limpio = String(rolLabel || "")\n    .trim().slice(0, 40)\n    .replace(/[^\\p{L}\\p{M} .\\-]/gu, "")\n    .trim();',
      a:  '  const limpio = String(rolLabel || "").trim();' },
    { nombre: 'la marca sale siempre de la constructora',
      de: '    const b = await db.doc(`orgs/${orgId}/config/branding`).get();',
      a:  '    const b = await db.doc("orgs/fosmon/config/branding").get();' },
    { nombre: 'al editar se avisan TODAS las obras, no sólo las agregadas',
      de: '  const obrasAgregadas = obrasAhora === null\n    ? []\n    : obrasAhora.filter(o => o && !obrasAntes.includes(o));',
      a:  '  const obrasAgregadas = obrasAhora === null ? [] : obrasAhora.filter(Boolean);' },
    { nombre: 'el correo de obra asignada sale aunque la cuenta se esté desactivando',
      de: '  if (obrasAgregadas.length > 0 && quedaActivo) {',
      a:  '  if (obrasAgregadas.length > 0) {' },
    { nombre: 'la obra nueva se avisa sólo por rol: los asignados se caen',
      de: '    return porRol.includes(u.rol) || asignado;',
      a:  '    return porRol.includes(u.rol);' },
    { nombre: 'el aviso de obra nueva vuelve a incluir a los ajenos a la casa',
      de: '    if (ROLES_AJENOS_A_LA_CASA.includes(u.rol)) return false;',
      a:  '    if (false) return false;' },
    { nombre: '`perfilesDeOrg` vuelve a no mirar la organización',
      de: '  const snap = await admin.firestore().collection("usuarios").where("orgId", "==", orgId).get();',
      a:  '  const snap = await admin.firestore().collection("usuarios").get();' },
    { nombre: 'y vuelve a descartar al perfil que no trae el campo `activo`',
      de: '  return snap.docs.map(d => d.data() || {}).filter(u => u.activo !== false);',
      a:  '  return snap.docs.map(d => d.data() || {}).filter(u => u.activo === true);' },
    { nombre: 'un presupuesto en cero se pinta como «$0»',
      de: '      [dep ? "Monto contratado" : "Presupuesto", monto > 0 ? MXN_FMT(monto) : ""],',
      a:  '      [dep ? "Monto contratado" : "Presupuesto", MXN_FMT(monto)],' },
    { nombre: 'la campana se queda sin el aviso de obra nueva',
      de: '  const notifs = await crearNotifServidor(destinatarios.map(u => u.uid), {',
      a:  '  const notifs = await crearNotifServidor([], {' },
    { nombre: 'la obra de la dependencia se etiqueta como la de la constructora',
      de: '  const dep = tipo === "dependencia";',
      a:  '  const dep = false;' },
    { nombre: 'el tipo de la organización se adivina en vez de leerse',
      de: '  const tipo = org?.tipo || null;',
      a:  '  const tipo = org?.tipo || "constructora";' },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(ARCH_FUNCS, 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en ${path.basename(ARCH_FUNCS)}.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `alta-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(roto, base.replace(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_FUNCS: roto } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : `NO LA VE   `}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      console.log((r.stdout + r.stderr).split('\n').slice(0, 12).map(l => '             ' + l).join('\n'));
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

const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { FieldValue } = require(path.join(raiz, 'functions/node_modules/firebase-admin/lib/firestore'));
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── El manejador de una Cloud Function, y lo que necesita ───────────────────
// El ÚLTIMO argumento de `exports.NOMBRE = onCall(opts, …)` /
// `onDocumentCreated(opts, …)`: así sirve igual con opciones y sin ellas. Con
// el PRIMERO se extraería el objeto de opciones el día que a una función se le
// enlaza un `secrets`, y el banco entero moriría como NO ARRANCÓ.
function manejadorYLibres(archivo, nombre) {
  const codigo = fs.readFileSync(archivo, 'utf8');
  const ast = parse(codigo, { sourceType: 'module' });
  let src = null;
  traverse(ast, {
    AssignmentExpression(p) {
      const iz = p.node.left;
      if (!(iz.type === 'MemberExpression' && iz.object.name === 'exports'
            && iz.property.name === nombre)) return;
      const de = p.node.right;
      if (de.type !== 'CallExpression' || !de.arguments.length) return;
      const ultimo = de.arguments[de.arguments.length - 1];
      src = codigo.slice(ultimo.start, ultimo.end);
    },
  });
  if (!src) {
    noArranco([`exports.${nombre} = onCall/onDocumentCreated(…)`], path.relative(raiz, archivo));
  }
  const sub = parse(`(${src})`, { sourceType: 'module' });
  const libres = new Set();
  traverse(sub, {
    ReferencedIdentifier(p) {
      if (p.scope.hasBinding(p.node.name, true)) return;
      libres.add(p.node.name);
    },
  });
  return { src, libres: [...libres] };
}

class HttpsErrorFalso extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ── Firestore y Auth de mentira ─────────────────────────────────────────────
// Lo mínimo para que el código real corra y se pueda mirar qué hizo. Auth
// guarda la contraseña que recibió: es el único modo de afirmar que la que
// viaja en el correo ABRE la cuenta, en vez de afirmar que el correo trae una.
function baseFalsa(docsIniciales) {
  const docs = new Map(Object.entries(docsIniciales));
  const escrituras = [];
  let seq = 0;

  const refDoc = (ruta) => ({
    id: ruta.split('/').pop(),
    get: async () => ({
      exists: docs.has(ruta), id: ruta.split('/').pop(),
      data: () => docs.get(ruta), updateTime: null,
    }),
    set: async (d, opt) => {
      escrituras.push({ ruta, d });
      docs.set(ruta, opt && opt.merge ? { ...(docs.get(ruta) || {}), ...d } : d);
    },
    update: async (d) => { escrituras.push({ ruta, d }); docs.set(ruta, { ...(docs.get(ruta) || {}), ...d }); },
    delete: async () => { escrituras.push({ ruta, borrado: true }); docs.delete(ruta); },
    collection: (sub) => coleccion(`${ruta}/${sub}`),
  });

  const hijos = (col) => [...docs.entries()]
    .filter(([r]) => r.startsWith(`${col}/`) && !r.slice(col.length + 1).includes('/'))
    .map(([r, d]) => ({ id: r.slice(col.length + 1), data: () => d, updateTime: null, ref: refDoc(r) }));

  const coleccion = (col, filtros = []) => ({
    where: (campo, op, val) => {
      if (!['==', '!=', 'in'].includes(op)) {
        noArranco([`la base de mentira no sabe del operador '${op}'`], 'baseFalsa');
      }
      return coleccion(col, [...filtros, { campo, op, val }]);
    },
    get: async () => {
      let filas = hijos(col);
      for (const f of filtros) {
        filas = filas.filter(x => {
          const v = x.data()[f.campo];
          // Firestore DESCARTA los documentos sin el campo en una desigualdad.
          if (f.op === '!=') return v !== undefined && v !== f.val;
          if (f.op === 'in') return f.val.includes(v);
          return v === f.val;
        });
      }
      return { docs: filas, size: filas.length, empty: filas.length === 0, forEach: cb => filas.forEach(cb) };
    },
    listDocuments: async () => hijos(col).map(x => ({ id: x.id })),
    // Sin argumento es un id automático: así pide `crearNotifServidor` su
    // documento en `notificaciones/{uid}/items`.
    doc: (id) => refDoc(`${col}/${id === undefined ? `auto-${++seq}` : id}`),
    add: async (d) => {
      const ruta = `${col}/auto-${++seq}`;
      escrituras.push({ ruta, d });
      docs.set(ruta, d);
      return refDoc(ruta);
    },
  });

  const batch = () => {
    const ops = [];
    return {
      set: (ref, d, opt) => ops.push(() => ref.set(d, opt)),
      create: (ref, d) => ops.push(() => ref.set(d)),
      update: (ref, d) => ops.push(() => ref.update(d)),
      commit: async () => { for (const op of ops) await op(); },
    };
  };

  // Las cuentas de Auth que ya existen salen del padrón sembrado: un perfil en
  // `usuarios/` sin cuenta en Auth es el caso huérfano, y no es el que se mide
  // aquí.
  const cuentas = new Map();
  for (const [ruta, d] of docs) {
    if (ruta.startsWith('usuarios/') && !ruta.slice(9).includes('/') && d.email) {
      cuentas.set(d.email, {
        uid: d.uid, password: '(la que ya tenía)', displayName: d.nombre,
        disabled: d.activo === false,
      });
    }
  }
  const authCreados = [];
  const auth = () => ({
    createUser: async ({ email, password, displayName }) => {
      if (cuentas.has(email)) {
        const e = new Error('email already exists'); e.code = 'auth/email-already-exists'; throw e;
      }
      const uid = `uid-nuevo-${++seq}`;
      cuentas.set(email, { uid, password, displayName, disabled: false });
      authCreados.push({ email, password, displayName, uid });
      return { uid, email, displayName };
    },
    getUser: async (uid) => {
      const fila = [...cuentas.entries()].find(([, c]) => c.uid === uid);
      if (!fila) throw new Error(`sin cuenta para ${uid}`);
      return { uid, email: fila[0], customClaims: {} };
    },
    getUserByEmail: async (email) => {
      const c = cuentas.get(email);
      if (!c) throw new Error(`sin cuenta para ${email}`);
      return { uid: c.uid, email, customClaims: {} };
    },
    updateUser: async (uid, cambios) => {
      const fila = [...cuentas.entries()].find(([, c]) => c.uid === uid);
      if (!fila) throw new Error(`sin cuenta para ${uid}`);
      Object.assign(fila[1], cambios);
      return { uid };
    },
    setCustomUserClaims: async () => {},
    revokeRefreshTokens: async () => {},
  });

  return {
    docs, escrituras, cuentas, authCreados,
    admin: { firestore: () => ({ doc: refDoc, collection: coleccion, batch }), auth },
  };
}

// Monta una pieza real de `functions/index.js` sobre una base de mentira.
function montar(nombreExport, base, { correos = [] } = {}) {
  const { src, libres } = manejadorYLibres(ARCH_FUNCS, nombreExport);
  let cuerpo;
  try {
    ({ cuerpo } = fuenteDe(ARCH_FUNCS, libres, { tolerante: true }));
  } catch (e) {
    if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
    throw e;
  }
  // El `fetch` de mentira: queda el sobre entero para poder afirmar QUIÉN
  // aparece en el `to` y QUÉ dice el cuerpo. Node trae un `fetch` global, así
  // que sin esto el banco le tocaría la puerta a api.resend.com en cada alta.
  const fetchFalso = async (url, opciones) => {
    correos.push({ url, ...JSON.parse(opciones.body || '{}') });
    return { ok: true, status: 200, json: async () => ({ id: `re_${correos.length}` }) };
  };
  const requiereFalso = (modulo) => {
    if (modulo === 'firebase-admin') return { ...base.admin, initializeApp: () => {} };
    if (modulo === 'firebase-admin/firestore') return { FieldValue };
    return require(modulo);
  };
  const inyectar = {
    require: requiereFalso,
    FieldValue,
    HttpsError: HttpsErrorFalso,
    fetch: fetchFalso,
    defineSecret: () => ({ value: () => 'clave-de-mentira' }),
  };
  const nombres = Object.keys(inyectar);
  try {
    return new Function(...nombres,
      `"use strict";\n${cuerpo}\nreturn (${src});`)(...nombres.map(n => inyectar[n]));
  } catch (e) {
    noArranco([`no se pudo montar \`${nombreExport}\`: ${e.message}`], path.relative(raiz, ARCH_FUNCS));
  }
}

// ── La siembra: una constructora, un municipio y una org sin tipo ───────────
const ORG_C = 'fosmon', ORG_D = 'coatzacoalcos', ORG_X = 'limbo';

// El MISMO id de obra en las dos organizaciones. No es rebuscado: los códigos
// los pone cada quien y `obras_asignadas` es una lista de cadenas. Es la forma
// exacta en que un correo nombraría la obra equivocada si se buscara en la
// ruta equivocada.
const OBRA = '0112';

const idDe = (email) => email.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

function siembra({ dosConstructoras = false } = {}) {
  const d = {};
  d[`orgs/${ORG_C}`] = { nombre: 'FOSMON Construcciones', tipo: 'constructora', activa: true };
  d[`orgs/${ORG_C}/config/branding`] = { empresa: 'FOSMON Construcciones', empresaCorta: 'FOSMON' };
  d[`orgs/${ORG_D}`] = { nombre: 'Municipio de Coatzacoalcos', tipo: 'dependencia', activa: true };
  d[`orgs/${ORG_D}/config/branding`] = { empresa: 'Municipio de Coatzacoalcos', empresaCorta: 'Coatzacoalcos' };
  // Una organización a la que no se le puede leer el tipo: documento sin
  // `tipo`. Pasa con las orgs anteriores al modelo multi-tenant.
  d[`orgs/${ORG_X}`] = { nombre: 'Obras del Limbo', activa: true };
  d[`orgs/${ORG_X}/config/branding`] = { empresa: 'Obras del Limbo' };
  if (dosConstructoras) d['orgs/otra'] = { nombre: 'Otra Constructora', tipo: 'constructora', activa: true };

  // Las obras de la constructora, en la raíz.
  d[`obras/${OBRA}`] = { nombre: 'CANGREJERA', contrato: 'FOS-2026-0112', cliente: 'PEMEX',
    presupuesto: 10000000, creadaPor: 'ger@fosmon.com.mx' };
  d['obras/0126'] = { nombre: 'MALECON', contrato: 'FOS-2026-0126', cliente: 'PEMEX', presupuesto: 4000000 };
  // Y la del municipio, bajo su organización, con el mismo id que la primera.
  d[`orgs/${ORG_D}/obras/${OBRA}`] = { nombre: 'PARQUE INDEPENDENCIA', contrato: 'MUN-0112',
    empresaEjecutante: 'Constructora Ajena', presupuesto: 2500000, creadaPor: 'jefe@coatza.gob.mx' };

  // El padrón. La clave del documento se calcula como lo hace el servidor
  // —`emailAId`— y no a mano: `requireAdmin` busca por ahí el perfil de quien
  // llama, y una clave inventada haría fallar las secciones por no encontrar
  // al llamador, no por la conducta que se mide.
  const u = (clave, email, rol, orgId, extra = {}) => {
    d[`usuarios/${idDe(email)}`] =
      { email, nombre: clave, rol, orgId, activo: true, uid: `uid-${clave}`, ...extra };
  };
  u('Rodrigo Director', 'dg@fosmon.com.mx', 'director_general', ORG_C);
  u('Gerardo Gerente', 'ger@fosmon.com.mx', 'gerente_construccion', ORG_C);
  u('Raul Residente', 'res@fosmon.com.mx', 'residente', ORG_C, { obras_asignadas: [OBRA] });
  u('Otilio Otra Obra', 'otro@fosmon.com.mx', 'residente', ORG_C, { obras_asignadas: ['0126'] });
  u('Baldomero Baja', 'baja@fosmon.com.mx', 'gerente_construccion', ORG_C, { activo: false });
  u('Clemente Cliente', 'cli@pemex.com', 'cliente', ORG_C, { obras_asignadas: [OBRA] });
  // Sin el campo `activo`: un perfil creado a mano. Está activo.
  d[`usuarios/${idDe('sup@fosmon.com.mx')}`] = { email: 'sup@fosmon.com.mx', nombre: 'Sergio Super',
    rol: 'superintendente', orgId: ORG_C, uid: 'uid-Sergio Super', obras_asignadas: [OBRA] };

  u('Dolores Dir Obras', 'dir@coatza.gob.mx', 'director_obras', ORG_D);
  u('Jacinta Jefa', 'jefe@coatza.gob.mx', 'jefe_supervision', ORG_D);
  u('Saul Supervisor', 'sup@coatza.gob.mx', 'supervisor_obra', ORG_D, { obras_asignadas: [OBRA] });
  u('Conrado Contratista', 'contra@ajena.com', 'contratista', ORG_D, { obras_asignadas: [OBRA] });

  u('Limbo Director', 'dg@limbo.mx', 'director_general', ORG_X);
  return d;
}

const llamada = (correo, data) => ({ auth: { token: { email: correo } }, data });
const evento = (params, obra) => ({ params, data: { data: () => obra } });

const avisadosEnCampana = (base) => [...new Set(base.escrituras
  .filter(e => e.ruta.startsWith('notificaciones/'))
  .map(e => e.ruta.split('/')[1]))];

// Dinero en el cuerpo del correo. No `includes('$')`: un `$` sueltoqueda en
// cualquier estilo. Esto busca una cifra.
const traeCifra = (html) => /\$\s?[\d]/.test(html);
const mensajesCampana = (base) => base.escrituras
  .filter(e => e.ruta.startsWith('notificaciones/'))
  .map(e => e.d.mensaje || '');

(async () => {
  console.log('\n── LOS TRES AVISOS DEL ALTA ──\n');

  // ═══ §1 · La contraseña que viaja es la que abre ═══════════════════════════
  console.log('§1 · el alta de un usuario: la contraseña del correo abre la cuenta');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('crearUsuario', base, { correos });
    const r = await fn(llamada('dg@fosmon.com.mx', {
      email: 'Nuevo@Fosmon.com.mx', nombre: 'Aldo Torres Ramírez',
      rol: 'residente', rolLabel: 'Residente de Obra', obras_asignadas: [OBRA],
    }));

    check(r.ok === true && correos.length === 1, 'sale un correo, uno solo',
      `${correos.length} envío(s)`);
    const sobre = correos[0] || {};
    const to = [].concat(sobre.to || []);
    check(to.length === 1 && to[0] === 'nuevo@fosmon.com.mx',
      'y le llega al usuario nuevo y a nadie más', to.join(', ') || 'a nadie');

    // La aserción que da sentido a todo el lote: la cadena que Auth recibió es
    // la que va escrita en el correo. Si se sorteara dos veces, el correo
    // llevaría una contraseña que no abre nada y el usuario quedaría fuera.
    const cuenta = base.authCreados[0] || {};
    const html = sobre.html || '';
    check(!!cuenta.password && html.includes(cuenta.password),
      'la contraseña que recibió Auth está escrita en el correo',
      cuenta.password ? (html.includes(cuenta.password) ? 'la misma' : 'OTRA — el usuario no podría entrar') : 'Auth no recibió ninguna');
    check((cuenta.password || '').length >= 12,
      'y no es corta', `${(cuenta.password || '').length} caracteres`);

    // Que se sortee: dos altas seguidas no comparten contraseña. Era el caso
    // real —las que quedaron escritas en el repo se repetían entre usuarios—.
    await fn(llamada('dg@fosmon.com.mx', {
      email: 'otronuevo@fosmon.com.mx', nombre: 'Julián Islas',
      rol: 'residente', rolLabel: 'Residente de Obra',
    }));
    const dos = base.authCreados.map(c => c.password);
    check(dos.length === 2 && dos[0] !== dos[1],
      'dos altas seguidas no comparten contraseña',
      dos[0] === dos[1] ? 'LA MISMA PARA LOS DOS' : 'distintas');

    check(/FOS-2026-0112/.test(html),
      'el correo nombra la obra asignada como la nombra la bitácora, por su contrato',
      /0112 ?CANGREJERA|FOS-2026-0112/.test(html) ? 'por su contrato' : 'NO LA NOMBRA');
    check(!traeCifra(html),
      'y no lleva una sola cifra de dinero: un correo de acceso no trae presupuestos',
      traeCifra(html) ? `TRAE CIFRA: ${(html.match(/\$\s?[\d,]+/) || [])[0]}` : 'sin cifras');

    check((html.match(/<ol/g) || []).length === 2,
      'lleva los dos bloques de pasos: cambiar la contraseña e instalarla en el teléfono',
      `${(html.match(/<ol/g) || []).length} bloque(s) de pasos`);
    check(/temporal/i.test(html),
      'y dice que la contraseña es temporal', /temporal/i.test(html) ? 'lo dice' : 'NO LO DICE');

    check(/Residente de Obra/.test(html),
      'el rol sale con el nombre que la pantalla le enseñó a quien dio el alta',
      /Residente de Obra/.test(html) ? 'Residente de Obra' : 'con otro nombre');
    check(/FOSMON/.test(html), 'y el correo va firmado por su casa',
      /FOSMON/.test(html) ? 'FOSMON' : 'sin firma');
  }

  // La etiqueta del rol entra de fuera —la manda el cliente, porque es la que
  // el usuario YA vio en la pantalla— así que se sanea. Lo que se afirma no es
  // que no se pueda inyectar HTML (eso lo impide `ESC_HTML` de todas formas, y
  // una aserción que no puede ponerse roja no mide): es que las marcas NO
  // LLEGAN, ni siquiera escapadas. Un correo que dice «Residente &lt;b&gt; de
  // Obra» es un correo que delata que alguien tecleó algo raro.
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('crearUsuario', base, { correos });
    await fn(llamada('dg@fosmon.com.mx', {
      email: 'sucio@fosmon.com.mx', nombre: 'Prueba Sucia', rol: 'residente',
      rolLabel: 'Residente <b>alert(1)</b> de Obra',
    }));
    const html = (correos[0] || {}).html || '';
    check(!/&lt;|&gt;/.test(html),
      'de la etiqueta del rol no llega ninguna marca, ni escapada',
      /&lt;|&gt;/.test(html) ? 'LLEGÓ LA ETIQUETA ENTERA, escapada' : 'limpia');
  }
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('crearUsuario', base, { correos });
    await fn(llamada('dg@fosmon.com.mx', {
      email: 'largo@fosmon.com.mx', nombre: 'Prueba Larga', rol: 'residente',
      rolLabel: 'R'.repeat(200),
    }));
    const html = (correos[0] || {}).html || '';
    const seguidas = (html.match(/R+/g) || []).reduce((a, b) => Math.max(a, b.length), 0);
    check(seguidas > 0 && seguidas <= 40,
      'y una etiqueta de 200 caracteres se recorta antes de maquetar el correo',
      `${seguidas} caracteres seguidos`);
  }

  // ═══ §2 · El alta de una dependencia ══════════════════════════════════════
  console.log('\n§2 · el alta en una dependencia nombra SUS obras y firma con SU marca');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('crearUsuario', base, { correos });
    await fn(llamada('dir@coatza.gob.mx', {
      email: 'nuevo@coatza.gob.mx', nombre: 'Saúl Nuevo',
      rol: 'supervisor_obra', rolLabel: 'Supervisor de Obra', obras_asignadas: [OBRA],
    }));
    const html = (correos[0] || {}).html || '';

    check(/MUN-0112/.test(html) && !/FOS-2026-0112/.test(html),
      'nombra la obra del municipio, no la de la raíz que tiene el mismo id',
      /FOS-2026-0112/.test(html) ? 'NOMBRÓ LA OBRA DE LA CONSTRUCTORA' : 'MUN-0112');
    check(/Coatzacoalcos/.test(html) && !/FOSMON/.test(html),
      'va firmado por el municipio y en ninguna parte dice FOSMON',
      /FOSMON/.test(html) ? 'DICE FOSMON' : 'Coatzacoalcos');
    check(!traeCifra(html), 'y tampoco lleva cifras',
      traeCifra(html) ? 'TRAE CIFRA' : 'sin cifras');
  }

  // ═══ §3 · Sólo las obras que se agregaron ═════════════════════════════════
  console.log('\n§3 · al editar un usuario se avisa lo que se AGREGÓ, no la lista entera');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('actualizarUsuario', base, { correos });
    const r = await fn(llamada('dg@fosmon.com.mx', {
      email: 'res@fosmon.com.mx', cambios: { obras_asignadas: [OBRA, '0126'] },
    }));
    const html = (correos[0] || {}).html || '';
    check(correos.length === 1, 'sale un correo', `${correos.length} envío(s)`);
    check(/FOS-2026-0126/.test(html) && !/FOS-2026-0112/.test(html),
      'nombra la obra nueva y NO la que ya tenía',
      /FOS-2026-0112/.test(html) ? 'NOMBRÓ LAS DOS — parece un alta nueva' : 'sólo la nueva');
    check(JSON.stringify(r.obrasAgregadas) === JSON.stringify(['0126']),
      'y la diferencia que devuelve el servidor es la misma que nombró el correo',
      JSON.stringify(r.obrasAgregadas));
  }
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('actualizarUsuario', base, { correos });
    await fn(llamada('dg@fosmon.com.mx', {
      email: 'res@fosmon.com.mx', cambios: { obras_asignadas: [OBRA] },
    }));
    check(correos.length === 0,
      'guardar al usuario sin tocarle las obras no manda nada',
      correos.length ? 'MANDÓ UN CORREO por una obra que ya tenía' : 'nada');
  }
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('actualizarUsuario', base, { correos });
    await fn(llamada('dg@fosmon.com.mx', {
      email: 'res@fosmon.com.mx', cambios: { obras_asignadas: [OBRA, '0126'], activo: false },
    }));
    check(correos.length === 0,
      'y si en el mismo acto se desactiva la cuenta, el aviso no sale',
      correos.length ? 'LE AVISÓ DE UNA OBRA a quien acaba de perder el acceso' : 'nada');
  }
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('actualizarUsuario', base, { correos });
    await fn(llamada('dg@fosmon.com.mx', {
      email: 'res@fosmon.com.mx', cambios: { nombre: 'Raúl Residente Jr.' },
    }));
    check(correos.length === 0, 'cambiarle el nombre tampoco manda nada',
      correos.length ? 'MANDÓ UN CORREO' : 'nada');
  }

  // ═══ §4 · A quién le toca el aviso de obra nueva ══════════════════════════
  console.log('\n§4 · obra nueva en la raíz: los roles de la casa UNIÓN los asignados');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('obraNuevaRaiz', base, { correos });
    await fn(evento({ obraId: OBRA }, base.docs.get(`obras/${OBRA}`)));

    const to = [].concat((correos[0] || {}).to || []);
    check(correos.length === 1, 'sale un correo', `${correos.length} envío(s)`);
    check(to.includes('dg@fosmon.com.mx') && to.includes('ger@fosmon.com.mx'),
      'le llega a la dirección general y a la gerencia de construcción, por su rol',
      to.join(', ') || 'a nadie');
    // El superintendente no trae el campo `activo` —perfil creado a mano— y no
    // tenerlo es estar activo. Se nombra cuál de los dos faltó: «los asignados
    // se quedaron fuera» y «uno de los dos se quedó fuera» mandan a buscar el
    // defecto a sitios distintos.
    const asignados = ['res@fosmon.com.mx', 'sup@fosmon.com.mx'];
    const faltaron = asignados.filter(e => !to.includes(e));
    check(faltaron.length === 0,
      'y a los asignados a esa obra, aunque su rol no esté en la lista',
      faltaron.length ? `SE QUEDÓ FUERA: ${faltaron.join(', ')}` : 'los dos dentro');
    check(!to.includes('otro@fosmon.com.mx'),
      'al residente de otra obra no, que no es suya',
      to.includes('otro@fosmon.com.mx') ? 'LE LLEGÓ' : 'fuera');
    check(!to.includes('baja@fosmon.com.mx'),
      'ni a la cuenta dada de baja',
      to.includes('baja@fosmon.com.mx') ? 'LE LLEGÓ' : 'fuera');
    check(!to.includes('cli@pemex.com'),
      'ni al cliente, aunque esté asignado a la obra: el monto es de la casa',
      to.includes('cli@pemex.com') ? 'LE LLEGÓ EL MONTO al cliente' : 'fuera');
    check(!to.includes('sup@coatza.gob.mx') && !to.includes('contra@ajena.com'),
      'y a nadie del municipio, que tiene una obra con el mismo id',
      to.some(x => /coatza|ajena/.test(x)) ? 'LE LLEGÓ a otra organización' : 'fuera');

    const html = (correos[0] || {}).html || '';
    check(/\$10,000,000/.test(html) && /Presupuesto/.test(html),
      'el cuerpo trae el presupuesto de la obra, etiquetado como presupuesto',
      traeCifra(html) ? 'con cifra' : 'SIN CIFRA — se estaría midiendo un sobre vacío');
    check(/PEMEX/.test(html), 'y dice de qué cliente es', /PEMEX/.test(html) ? 'PEMEX' : 'no lo dice');
    check(/ger@fosmon\.com\.mx/.test(html),
      'y quién la dio de alta, que un disparador no trae autor si el documento no lo guarda',
      /ger@fosmon/.test(html) ? 'nombrado' : 'NO SE DICE');

    // La campana es el aviso que se perdía (#85). Los mismos, no unos cuantos.
    const campana = avisadosEnCampana(base).sort();
    const esperados = to
      .map(e => (base.docs.get(`usuarios/${idDe(e)}`) || {}).uid)
      .filter(Boolean).sort();
    check(campana.length > 0 && JSON.stringify(campana) === JSON.stringify(esperados),
      'y la campana recibe exactamente a los mismos que el correo',
      campana.length ? `${campana.length} de ${esperados.length}` : 'LA CAMPANA SE QUEDÓ VACÍA');
  }

  // ═══ §5 · El monto que no se capturó ══════════════════════════════════════
  console.log('\n§5 · una obra sin presupuesto no se avisa con «$0»');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('obraNuevaRaiz', base, { correos });
    await fn(evento({ obraId: '0160' },
      { nombre: 'PLANTA NUEVA', contrato: 'FOS-2026-0160', cliente: 'CFE',
        presupuesto: 0, creadaPor: 'ger@fosmon.com.mx' }));

    const html = (correos[0] || {}).html || '';
    check(correos.length === 1 && !traeCifra(html),
      'no aparece ninguna cifra donde no hubo captura',
      traeCifra(html) ? `PINTÓ ${(html.match(/\$\s?[\d,]+/) || [])[0]}` : 'ninguna');
    check(/no se puede medir/i.test(html),
      'y el correo dice en voz alta que falta el presupuesto',
      /no se puede medir/i.test(html) ? 'lo dice' : 'SE CALLA — el que lee creería que es gratis');
    const msj = mensajesCampana(base).join(' | ');
    check(msj.length > 0 && !/\$\s?0/.test(msj) && /sin capturar/i.test(msj),
      'la campana dice lo mismo que el correo, con las mismas palabras',
      msj.slice(0, 80) || 'sin aviso');
  }

  // ═══ §6 · La dependencia tiene sus propias etiquetas ══════════════════════
  console.log('\n§6 · obra nueva en una dependencia: su etiqueta y su gente');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('obraNuevaDeOrg', base, { correos });
    await fn(evento({ orgId: ORG_D, obraId: OBRA }, base.docs.get(`orgs/${ORG_D}/obras/${OBRA}`)));

    const to = [].concat((correos[0] || {}).to || []);
    check(to.includes('dir@coatza.gob.mx') && to.includes('jefe@coatza.gob.mx')
      && to.includes('sup@coatza.gob.mx'),
      'le llega a la dirección de obras, a la jefatura de supervisión y al supervisor asignado',
      to.join(', ') || 'a nadie');
    check(!to.includes('contra@ajena.com'),
      'y no al contratista, que ejecuta la obra pero no es de la casa',
      to.includes('contra@ajena.com') ? 'LE LLEGÓ EL MONTO al contratista' : 'fuera');
    check(!to.some(x => /fosmon\.com\.mx$/.test(x)),
      'ni a nadie de la constructora',
      to.some(x => /fosmon/.test(x)) ? 'LE LLEGÓ a la constructora' : 'fuera');

    const html = (correos[0] || {}).html || '';
    check(/Monto contratado/.test(html) && !/Presupuesto/.test(html),
      'la cifra se llama «Monto contratado», que no es lo mismo que un presupuesto',
      /Presupuesto/.test(html) ? 'DICE PRESUPUESTO' : 'Monto contratado');
    check(/Empresa ejecutante/.test(html) && /Constructora Ajena/.test(html),
      'y la contraparte es la empresa que ejecuta, no un cliente',
      /Empresa ejecutante/.test(html) ? 'empresa ejecutante' : 'la etiqueta de la constructora');
    check(/\$2,500,000/.test(html), 'con su monto', /\$/.test(html) ? 'con cifra' : 'SIN CIFRA');
    check(/Coatzacoalcos/.test(html) && !/FOSMON/.test(html),
      'firmado por el municipio', /FOSMON/.test(html) ? 'DICE FOSMON' : 'Coatzacoalcos');
  }

  // ═══ §7 · Lo que no se sabe no se adivina ═════════════════════════════════
  console.log('\n§7 · si no se puede leer el tipo de la organización, no se avisa a nadie');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('obraNuevaDeOrg', base, { correos });
    await fn(evento({ orgId: ORG_X, obraId: '0900' },
      { nombre: 'OBRA DEL LIMBO', contrato: 'LIM-0900', presupuesto: 1000000 }));
    check(correos.length === 0,
      'sin tipo no hay a quién avisarle: el aviso no sale',
      correos.length ? `SE MANDÓ a ${[].concat(correos[0].to).join(', ')}` : 'no salió');
    check(avisadosEnCampana(base).length === 0,
      'y la campana tampoco se escribe',
      avisadosEnCampana(base).join(', ') || 'vacía');
  }
  {
    const base = baseFalsa(siembra({ dosConstructoras: true }));
    const correos = [];
    const fn = montar('obraNuevaRaiz', base, { correos });
    await fn(evento({ obraId: OBRA }, base.docs.get(`obras/${OBRA}`)));
    check(correos.length === 0,
      'con dos constructoras no se sabe de quién es la raíz, y el aviso tampoco sale',
      correos.length ? `SE MANDÓ a ${[].concat(correos[0].to).join(', ')}` : 'no salió');
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0
    ? 'la contraseña que viaja abre la cuenta, y el aviso del alta le llega a quien le toca'
    : `${fallas} falla(s)`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
