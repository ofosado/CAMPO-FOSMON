#!/usr/bin/env node
// Lo que el servidor manda por su cuenta no se sale de la organización.
//
// ── QUÉ SE ENCONTRÓ (2026-10-28) ────────────────────────────────────────────
// El #73 puso frontera a lo que un usuario PIDE. Lo que el servidor manda SOLO
// —el correo de los lunes y los dos recordatorios— se quedó sin ella: leía
// `obras/` de la raíz y después elegía a quién hablarle MIRANDO EL NOMBRE DEL
// ROL.
//
// Medido contra producción el 2026-10-28: hoy no muerde. Hay una sola
// organización (`fosmon`), los 14 usuarios son suyos y los 4 destinatarios
// también. No muerde porque `director_general`, `director_operaciones` y
// `gerente_construccion` no existen en `ROLES_POR_TIPO.dependencia` — o sea,
// por una coincidencia de vocabularios, no por una defensa. `ROLES_RESUMEN
// _SEMANAL` es una lista escrita a mano: el día que alguien quiera que un
// municipio reciba un resumen de SUS obras, mete su rol en la lista y con eso
// basta para que el presupuesto, el gasto acumulado y lo cobrado de las cinco
// obras de FOSMON salgan en el correo del municipio. El margen bruto de un
// contratista no es dato de la dependencia que lo contrata: es el principio
// que ya costó partir `auditoria` en el #73.
//
// Y una sexta función de gestión se había quedado fuera de aquel barrido:
// `backfillClaims` devolvía `detalle` con el correo y el rol de TODOS los
// usuarios de TODAS las organizaciones, y de paso les reescribía los claims.
// `ROLES_ADMIN` incluye `director_obras` y `subdirector`.
//
// ── CÓMO SE MIDE ────────────────────────────────────────────────────────────
// No se describe la conducta: se EJECUTA. Las cuatro piezas salen de
// `functions/index.js` por AST —el cuerpo de los manejadores de `onSchedule`/
// `onCall` y el cierre transitivo de los símbolos que nombran— y corren sobre
// un Firestore de mentira y un `fetch` de mentira. Lo que se afirma es a
// quién le llegó el correo y a quién la notificación, no que exista un
// símbolo llamado `orgDeLaRaiz`.
//
// La lista de dependencias NO está tecleada: se calculan los identificadores
// libres del manejador y se le piden a `fuenteDe`, que resuelve el resto. Una
// lista a mano es una copia del grafo, y las copias se desincronizan (ver el
// preámbulo de `extraer-de-app.cjs`).
//
// Uso:
//   node scripts/prueba-correo-no-cruza-organizaciones.cjs
//   node scripts/prueba-correo-no-cruza-organizaciones.cjs --contraprueba

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
    { nombre: 'el resumen semanal vuelve a elegir destinatario sólo por el rol',
      de: `  const reparto = partirPorOrg(candidatos, orgRaiz);\n  const destinatarios = reparto.dentro.map(u => u.email).filter(Boolean);`,
      a:  `  const reparto = partirPorOrg(candidatos, orgRaiz);\n  const destinatarios = candidatos.map(u => u.email).filter(Boolean);` },
    { nombre: '`orgDeLaRaiz` vuelve a adivinar cuando no hay una sola constructora',
      de: `  if (ids.length !== 1) {\n    throw new Error(`,
      a:  `  if (false) {\n    throw new Error(` },
    { nombre: 'el correo deja de decir a quién NO le llegó',
      de: `function bloqueFueraDeAlcance({ sinOrg = [], deOtra = [] } = {}) {\n  if (!sinOrg.length && !deOtra.length) return "";`,
      a:  `function bloqueFueraDeAlcance({ sinOrg = [], deOtra = [] } = {}) {\n  if (true) return "";` },
    { nombre: '`usuariosCapturaDeObra` vuelve a no mirar la organización',
      de: `  const snap = await admin.firestore().collection("usuarios")\n    .where("orgId", "==", orgId).get();`,
      a:  `  const snap = await admin.firestore().collection("usuarios").get();` },
    { nombre: 'y vuelve a descartar al perfil que no trae el campo `activo`',
      de: `    if (u.activo === false) return;\n    if (!rolesCaptura.includes(u.rol)) return;`,
      a:  `    if (u.activo !== true) return;\n    if (!rolesCaptura.includes(u.rol)) return;` },
    { nombre: 'la alerta del lunes vuelve a buscar gerentes en todas las organizaciones',
      de: `        const gerentesSnap = await admin.firestore().collection("usuarios")\n          .where("orgId", "==", orgRaiz).get();`,
      a:  `        const gerentesSnap = await admin.firestore().collection("usuarios").get();` },
    { nombre: '`backfillClaims` vuelve a recorrer el padrón entero',
      de: `  const snap = await (ambito.cross ? col.get() : col.where("orgId", "==", ambito.orgId).get());\n  const resultados = [];`,
      a:  `  const snap = await col.get();\n  const resultados = [];` },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(ARCH_FUNCS, 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en ${path.basename(ARCH_FUNCS)}.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `corr-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
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
// El ÚLTIMO argumento de `exports.NOMBRE = onCall(…)` / `onSchedule(opts, …)`:
// así sirve igual para las dos formas sin tener que distinguirlas.
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
    noArranco([`exports.${nombre} = onCall/onSchedule(…)`], path.relative(raiz, archivo));
  }
  // Los identificadores que el manejador usa y no declara. De ahí sale la
  // lista de raíces para `fuenteDe`, en vez de teclearla.
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

// ── El Firestore de mentira ─────────────────────────────────────────────────
// Lo mínimo para que el código real corra y se pueda mirar qué hizo. No simula
// reglas: aquí se mide la LÓGICA de los trabajos, que es donde estaba el
// agujero —las reglas no protegen a un trabajo que corre como administrador—.
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
          // La prueba lo reproduce: es justo el modo de fallo que medimos.
          if (f.op === '!=') return v !== undefined && v !== f.val;
          if (f.op === 'in') return f.val.includes(v);
          return v === f.val;
        });
      }
      return { docs: filas, size: filas.length, empty: filas.length === 0, forEach: cb => filas.forEach(cb) };
    },
    listDocuments: async () => hijos(col).map(x => ({ id: x.id })),
    doc: (id) => refDoc(`${col}/${id}`),
    add: async (d) => {
      const ruta = `${col}/auto-${++seq}`;
      escrituras.push({ ruta, d });
      docs.set(ruta, d);
      return refDoc(ruta);
    },
  });

  // Auth sólo lo usa `backfillClaims` a través de `aplicarClaimsUsuario`. Lo
  // que se mide allí es SOBRE QUIÉN recorre, no qué claim calcula.
  const claimsPuestos = [];
  const auth = () => ({
    getUser: async (uid) => {
      const fila = [...docs.entries()].find(([r, d]) => r.startsWith('usuarios/') && d.uid === uid);
      if (!fila) throw new Error(`sin cuenta para ${uid}`);
      return { uid, email: fila[1].email, customClaims: {} };
    },
    getUserByEmail: async (email) => {
      const fila = [...docs.entries()].find(([r, d]) => r.startsWith('usuarios/') && d.email === email);
      if (!fila) throw new Error(`sin cuenta para ${email}`);
      return { uid: fila[1].uid, email, customClaims: {} };
    },
    setCustomUserClaims: async (uid, claims) => { claimsPuestos.push({ uid, claims }); },
    revokeRefreshTokens: async () => {},
  });

  return {
    docs, escrituras, claimsPuestos,
    admin: { firestore: () => ({ doc: refDoc, collection: coleccion }), auth },
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
  // aparece en el `to` y QUÉ dice el cuerpo.
  const fetchFalso = async (url, opciones) => {
    correos.push({ url, ...JSON.parse(opciones.body || '{}') });
    return { ok: true, status: 200, json: async () => ({ id: `re_${correos.length}` }) };
  };
  // `admin` NO se inyecta: el cierre transitivo trae la línea real
  // `const admin = require("firebase-admin")`, y lo que se sustituye es el
  // `require`. Así corre el cableado del archivo tal cual en vez de uno que la
  // prueba se invente. `FieldValue` sí se inyecta, porque llega por una
  // declaración DESESTRUCTURADA y el extractor sólo indexa identificadores
  // sueltos: se pasa el objeto de verdad de `firebase-admin`, no un remedo
  // —ver el preámbulo de `functions/index.js` sobre ese mismo objeto—.
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

// ── La siembra: una constructora y un municipio ─────────────────────────────
const ORG_C = 'fosmon', ORG_D = 'coatzacoalcos';
const HACE_30_DIAS = new Date(Date.now() - 30 * 86400000).toISOString();

// `0112` es un id de cuatro dígitos. Que el municipio tenga una obra con el
// mismo id no es rebuscado: los códigos los pone cada quien, y `obras_asignadas`
// es una lista de cadenas sin más.
const OBRA = '0112';

function siembra({ dosConstructoras = false, sinConstructora = false } = {}) {
  const d = {};
  if (!sinConstructora) d[`orgs/${ORG_C}`] = { nombre: 'FOSMON', tipo: 'constructora', activa: true };
  d[`orgs/${ORG_D}`] = { nombre: 'Coatzacoalcos', tipo: 'dependencia', activa: true };
  if (dosConstructoras) d['orgs/otra'] = { nombre: 'Otra Constructora', tipo: 'constructora', activa: true };

  // La obra de la raíz, con su dinero.
  d[`obras/${OBRA}`] = { nombre: '0112 CANGREJERA', estado: 'activa' };
  d[`obras/${OBRA}/config/info`] = {
    nombre: '0112 CANGREJERA', contrato: 'FOS-2026-0112', cliente: 'PEMEX',
    presupuesto: 10000000, modoAvance: 'importe',
  };
  d[`obras/${OBRA}/avance/subs`] = { data: [{ imp: 10000000, a: 40 }], fecha: HACE_30_DIAS };
  d[`obras/${OBRA}/avance/historial`] = { semanas: [{ id: 'S36-2026', fechaCierre: HACE_30_DIAS }] };
  d[`obras/${OBRA}/avance/maquinaria`] = { data: [{ desc: 'Retro', imp: 50000 }] };
  d[`obras/${OBRA}/avance/materiales`] = { data: [{ desc: 'Cemento', imp: 70000 }] };
  d[`obras/${OBRA}/config/otros_gastos`] = { items: [{ importe: 30000 }] };
  d[`obras/${OBRA}/config/estimaciones`] = { data: [{ monto: 1500000, estatus: 'pagada' }] };

  // El padrón. La clave del documento se calcula como lo hace el servidor
  // —`emailAId`— y no a mano: `requireAdmin` busca el perfil por ahí, y una
  // clave inventada haría que §4 fallara por no encontrar a quien llama, no
  // por la frontera que se está midiendo.
  const idDe = (email) => email.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');
  const u = (clave, email, rol, orgId, extra = {}) => {
    d[`usuarios/${idDe(email)}`] =
      { email, nombre: clave, rol, orgId, activo: true, uid: `uid-${clave}`, ...extra };
  };
  u('dg_c', 'dg@fosmon.com.mx', 'director_general', ORG_C);
  u('ger_c', 'ger@fosmon.com.mx', 'gerente_construccion', ORG_C);
  u('res_c', 'res@fosmon.com.mx', 'residente', ORG_C, { obras_asignadas: [OBRA] });
  // Sin el campo `activo`: un perfil creado a mano. Está activo.
  d[`usuarios/${idDe('sup@fosmon.com.mx')}`] = { email: 'sup@fosmon.com.mx', nombre: 'sup_c',
    rol: 'superintendente', orgId: ORG_C, uid: 'uid-sup_c', obras_asignadas: [OBRA] };

  u('dir_d', 'dir@coatza.gob.mx', 'director_operaciones', ORG_D);
  u('ger_d', 'ger@coatza.gob.mx', 'gerente_construccion', ORG_D);
  u('res_d', 'res@coatza.gob.mx', 'residente', ORG_D, { obras_asignadas: [OBRA] });

  // Y uno de la casa al que le falta la organización: el defecto espejo.
  d[`usuarios/${idDe('huerfano@fosmon.com.mx')}`] = { email: 'huerfano@fosmon.com.mx',
    nombre: 'huerfano', rol: 'director_operaciones', activo: true, uid: 'uid-huerfano' };
  return d;
}

const notificados = (base) => base.escrituras
  .filter(e => e.ruta.startsWith('notificaciones/'))
  .map(e => e.ruta.split('/')[1]);

(async () => {
  console.log('\n── LO QUE EL SERVIDOR MANDA SOLO NO SE SALE DE LA ORGANIZACIÓN ──\n');

  // ═══ §1 · El correo del lunes ═════════════════════════════════════════════
  console.log('§1 · el resumen semanal lleva dinero, y el dinero no cruza');
  {
    const base = baseFalsa(siembra());
    const correos = [];
    const fn = montar('resumenSemanalEmail', base, { correos });
    await fn({});

    check(correos.length === 1, 'el correo sale', `${correos.length} envío(s)`);
    const to = (correos[0] || {}).to || [];
    check(to.includes('dg@fosmon.com.mx') && to.includes('ger@fosmon.com.mx'),
      'le llega a la dirección y a la gerencia de la constructora', to.join(', ') || 'a nadie');
    check(!to.includes('dir@coatza.gob.mx'),
      'y NO al director de operaciones del municipio, que tiene un rol del portafolio',
      to.includes('dir@coatza.gob.mx') ? 'LE LLEGÓ — con el gasto de las obras de FOSMON' : 'fuera');
    check(!to.includes('huerfano@fosmon.com.mx'),
      'ni a la cuenta sin organización, de la que no se puede afirmar de quién es',
      to.includes('huerfano@fosmon.com.mx') ? 'LE LLEGÓ' : 'fuera');

    // Que el dinero iba de verdad dentro: si el cuerpo no trajera cifras, las
    // tres comprobaciones de arriba estarían midiendo un sobre vacío.
    const html = (correos[0] || {}).html || '';
    check(/\$10,000,000/.test(html) && /\$1,500,000/.test(html),
      'y el cuerpo sí trae el presupuesto y lo cobrado de la obra',
      /\$/.test(html) ? 'con cifras' : 'SIN UNA SOLA CIFRA');

    // La pérdida silenciosa, dicha en voz alta.
    check(/huerfano@fosmon\.com\.mx/.test(html),
      'el correo nombra a la cuenta de la casa que se quedó fuera por no tener organización',
      /huerfano/.test(html) ? 'nombrada' : 'NO SE DICE — el que no recibe no se entera');
    check(!/dir@coatza\.gob\.mx/.test(html) && /otra organización/.test(html),
      'y dice CUÁNTAS son de otra organización sin nombrar a ninguna',
      /dir@coatza/.test(html) ? 'DELATÓ EL PADRÓN AJENO' : 'sólo el conteo');
  }

  // Dos constructoras: la raíz no tiene dueño único y el correo no sale.
  {
    const base = baseFalsa(siembra({ dosConstructoras: true }));
    const correos = [];
    const fn = montar('resumenSemanalEmail', base, { correos });
    let err = null;
    try { await fn({}); } catch (e) { err = e; }
    check(!!err && correos.length === 0,
      'con DOS constructoras el correo no sale: no se sabe de quién son las obras',
      correos.length ? `SE MANDÓ a ${(correos[0].to || []).join(', ')}` : 'no salió');
    check(!!err, 'y el trabajo sale rojo, no verde en silencio',
      err ? 'lanzó' : 'TERMINÓ BIEN — Scheduler lo contaría como exitoso');
  }

  // Sin constructora, lo mismo: no se adivina.
  {
    const base = baseFalsa(siembra({ sinConstructora: true }));
    const correos = [];
    const fn = montar('resumenSemanalEmail', base, { correos });
    let err = null;
    try { await fn({}); } catch (e) { err = e; }
    check(!!err && correos.length === 0,
      'sin ninguna constructora tampoco se adivina',
      correos.length ? `SE MANDÓ a ${(correos[0].to || []).join(', ')}` : 'no salió');
  }

  // ═══ §2 · Los recordatorios ═══════════════════════════════════════════════
  console.log('\n§2 · el recordatorio del viernes no toca la puerta de otro cliente');
  {
    const base = baseFalsa(siembra());
    const fn = montar('recordatorioCapturaObra', base);
    await fn({});
    const avisados = notificados(base);
    check(avisados.includes('uid-res_c'),
      'el residente de la constructora recibe el recordatorio de su obra',
      avisados.join(', ') || 'nadie');
    check(!avisados.includes('uid-res_d'),
      'y el residente del municipio NO, aunque tenga «0112» en sus obras asignadas',
      avisados.includes('uid-res_d') ? 'LE LLEGÓ un aviso de una obra ajena' : 'fuera');
    check(avisados.includes('uid-sup_c'),
      'el superintendente sin campo `activo` también lo recibe: no tenerlo es estar activo',
      avisados.includes('uid-sup_c') ? 'avisado' : 'SE QUEDÓ SIN AVISO');
  }

  console.log('\n§3 · la alerta del lunes tampoco');
  {
    const base = baseFalsa(siembra());
    const fn = montar('recordatorioLunes', base);
    await fn({});
    const avisados = notificados(base);
    check(avisados.includes('uid-ger_c'),
      'la gerencia de la constructora recibe la alerta de la obra sin captura',
      avisados.join(', ') || 'nadie');
    check(!avisados.includes('uid-ger_d'),
      'y la gerencia del municipio no se entera de una obra que no es suya',
      avisados.includes('uid-ger_d') ? 'LE LLEGÓ' : 'fuera');
    check(!avisados.includes('uid-dir_d'),
      'ni su dirección de operaciones',
      avisados.includes('uid-dir_d') ? 'LE LLEGÓ' : 'fuera');
  }

  // ═══ §4 · La sexta función de gestión ═════════════════════════════════════
  console.log('\n§4 · `backfillClaims` es la sexta, y se había quedado fuera');
  {
    const base = baseFalsa(siembra());
    const fn = montar('backfillClaims', base);
    // Los claims se aplican de verdad; lo que se mide es SOBRE QUIÉN.
    const pedir = (correo) => ({ auth: { token: { email: correo } }, data: {} });
    let r = null, err = null;
    try { r = await fn(pedir('dir@coatza.gob.mx')); } catch (e) { err = e; }
    const correos = r ? r.detalle.map(x => x.email).sort() : [];
    check(!err && correos.length > 0 && correos.every(c => /coatza\.gob\.mx$/.test(c)),
      'el directivo del municipio sólo recorre a los suyos',
      err ? `LANZÓ: ${err.code || err.message}` : correos.join(', ') || 'vacío');
    check(!correos.includes('dg@fosmon.com.mx'),
      'y el correo del director general de FOSMON no viaja en la respuesta',
      correos.includes('dg@fosmon.com.mx') ? 'VIAJÓ' : 'fuera');
  }
  {
    const base = baseFalsa(siembra());
    const fn = montar('backfillClaims', base);
    let r = null, err = null;
    try { r = await fn({ auth: { token: { email: 'dg@fosmon.com.mx' } }, data: {} }); }
    catch (e) { err = e; }
    const correos = r ? r.detalle.map(x => x.email) : [];
    check(!err && correos.length > 0 && correos.every(c => /fosmon\.com\.mx$/.test(c)),
      'y el de la constructora, sólo a los suyos',
      err ? `LANZÓ: ${err.code || err.message}` : correos.join(', ') || 'vacío');
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0
    ? 'el correo, los avisos y el padrón se quedan dentro de su organización'
    : `${fallas} falla(s)`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
