#!/usr/bin/env node
// Prueba: UNA ORGANIZACIÓN SE DA DE ALTA DESDE LA APP, por el rol de soporte,
// y esa sesión no alcanza la operación de nadie.
//
// Por qué existe. Dar de alta un cliente costaba una sesión de consola con
// `scripts/crear-org-fosmon.cjs`. Al llevarlo a la pantalla aparecieron cuatro
// cosas, y tres no eran la que se iba a arreglar:
//
//   · SOPORTE NO PODÍA ENTRAR. El rol existe en firestore.rules desde
//     septiembre, pero sus claims traen `tipo: null` —así se los escribe
//     `aplicarClaimsUsuario` y así lo documenta la cabecera de las reglas— y
//     `fijarPrefijoOrg` LANZA con un tipo que no reconoce. Tiene razón en
//     lanzar: caer a la raíz convertiría a soporte en un usuario de FOSMON. Lo
//     que faltaba era el tercer estado, no un valor por omisión. El login
//     sacaba al rol de la sesión antes de pintar una sola pantalla.
//
//   · Y UNA VEZ DENTRO, PEDÍA LA CONTABILIDAD DE FOSMON. `useGPConstruct(
//     !esDependencia(usuario))` es TRUE para una sesión sin tipo, así que lo
//     primero que hacía al montar era pedir `global/gp_construct`. Las reglas
//     lo niegan, y un read denegado pinta el chip ámbar «GP Sheet · no
//     disponible»: la pantalla diría «falló» donde la verdad es «no me toca».
//
//   · Y LA CARGA DE OBRAS IBA A DECIR «ERROR» DONDE NO LO HAY. Medido: con un
//     perfil de soporte recién creado NO reventaba —`PERMISOS.soporte` trae
//     `todas_obras:false`, así que caía a «sólo las asignadas» y su lista está
//     vacía—. El caso que importa es el perfil que SÍ trae asignadas, y es
//     alcanzable: `actualizarUsuario` escribe con merge sólo los campos que
//     recibe, así que cambiarle el rol a `soporte` a una cuenta que era
//     residente le deja su `obras_asignadas` intacto. Ahí `docObra` resuelve
//     con `conOrg`, que revienta a propósito, el catch por obra se lo traga y
//     la consola dice «1 de 1 obras asignadas no se cargaron».
//
//   · EL ALTA PODÍA FUNDIR DOS CLIENTES. Un id repetido escrito con
//     `set({merge:true})` funde los dos documentos campo por campo sin fallar:
//     el nombre del cliente nuevo encima del viejo, el `tipo` del viejo si el
//     nuevo no lo trae. Es el #31 con el tenant completo dentro. `create()`
//     revienta con ALREADY_EXISTS, y eso es lo que §4 afirma.
//
// Nada de lo que se afirma aquí es que un símbolo exista (P3). El §1 ejecuta
// `src/rutas-org.js`, el §2 y el §3 ejecutan bloques EXTRAÍDOS de App.jsx por
// AST, y el §4 ejecuta el cuerpo de `crearOrganizacion` extraído de
// functions/index.js contra un Firestore de mentiras, mirando QUÉ escribió y
// con qué método. La frontera de soporte en las reglas se mide en el emulador,
// en `prueba-prefijo-organizacion.cjs` §5.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta archivos por variable de entorno para correrse contra copias
// mutiladas. Cada mutación rompe SEMÁNTICA —no andamiaje— y se verificó que
// saca rojo (1) y no NO ARRANCÓ (2). Los conteos están al pie.
//
// Uso:  node scripts/prueba-alta-de-organizacion.cjs
//       ARCH_APP=/tmp/App.mutilado.jsx node scripts/prueba-alta-de-organizacion.cjs

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');
// El `FieldValue` de verdad, el que la función va a usar en producción.
const { FieldValue } = require(path.join(raiz, 'functions/node_modules/firebase-admin/lib/firestore'));

const archivoApp = process.env.ARCH_APP || path.join(raiz, 'src/App.jsx');
const archivoFns = process.env.ARCH_FNS || path.join(raiz, 'functions/index.js');
const archivoRutas = process.env.ARCH_RUTAS || path.join(raiz, 'src/rutas-org.js');
noArranco.vigilarExcepciones(archivoApp);

const PLUGINS = ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'];

// ── Extracción ──────────────────────────────────────────────────────────────
// Un lector por archivo. `decl` recoge declaraciones de módulo; lo que vive
// dentro de un componente o de una función se busca por DÓNDE vive, sin
// confiar en que el nombre sea único en 22 000 renglones: hoy lo es, y es
// exactamente el tipo de cosa que deja de ser verdad sin que nadie lo note.
function lector(archivo) {
  const src = fs.readFileSync(archivo, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: PLUGINS });
  const decl = {};
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.type === 'Identifier' && p.node.init)
        decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
    },
    FunctionDeclaration(p) { if (p.node.id) decl[p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
  });
  return { src, ast, decl, archivo };
}

const app = lector(archivoApp);
const fns = lector(archivoFns);

// El bloque del login que resuelve la organización: el `try` MÁS INTERNO que
// vive dentro de `handleLogin` y nombra a `fijarPrefijoOrg` —hay otro por fuera
// que envuelve todo el handler—, junto con la sentencia que lo precede, que es
// donde se declaran `tipoOrg` y `orgIdUsuario` que el try asigna. Se toma por
// posición en el bloque y no copiando el `let`: así, si mañana alguien cambia
// esas variables, la prueba se lleva el cambio en vez de comprobar su copia.
function bloqueResolucionOrg() {
  let elegido = null;
  traverse(app.ast, {
    FunctionDeclaration(p) {
      if (!p.node.id || p.node.id.name !== 'handleLogin') return;
      p.traverse({
        TryStatement(q) {
          if (!app.src.slice(q.node.start, q.node.end).includes('fijarPrefijoOrg')) return;
          // El más interno es el de menor extensión.
          if (!elegido || (q.node.end - q.node.start) < (elegido.node.end - elegido.node.start)) {
            elegido = q;
          }
        },
      });
    },
  });
  if (!elegido) return null;
  const hermanos = (elegido.parent && elegido.parent.body) || [];
  const i = hermanos.indexOf(elegido.node);
  if (i <= 0) return null;
  return app.src.slice(hermanos[i - 1].start, elegido.node.end);
}

// El argumento con el que se activa el hook de GP. La afirmación es sobre la
// EXPRESIÓN que decide, no sobre el texto: se evalúa para tres usuarios.
function argumentoDe(nombreFn) {
  let hallado = null;
  traverse(app.ast, {
    CallExpression(p) {
      if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== nombreFn) return;
      if (p.node.arguments.length !== 1) return;
      hallado ||= app.src.slice(p.node.arguments[0].start, p.node.arguments[0].end);
    },
  });
  return hallado;
}

// El callback del `useEffect` que carga las obras: se reconoce por lo que hace
// —reportar `cargar obras` en consola— y no por su posición en el archivo.
function efectoCargarObras() {
  let hallado = null;
  traverse(app.ast, {
    CallExpression(p) {
      if (p.node.callee.type !== 'Identifier' || p.node.callee.name !== 'useEffect') return;
      const s = app.src.slice(p.node.arguments[0].start, p.node.arguments[0].end);
      if (s.includes("'cargar obras'")) hallado ||= s;
    },
  });
  return hallado;
}

// El cuerpo del onCall: `exports.crearOrganizacion = onCall(<esto>)`.
function manejadorOnCall(nombre) {
  let hallado = null;
  traverse(fns.ast, {
    AssignmentExpression(p) {
      const izq = p.node.left;
      if (izq.type !== 'MemberExpression') return;
      if (izq.object.name !== 'exports' || izq.property.name !== nombre) return;
      const der = p.node.right;
      if (der.type !== 'CallExpression' || !der.arguments.length) return;
      hallado ||= fns.src.slice(der.arguments[0].start, der.arguments[0].end);
    },
  });
  return hallado;
}

const loginSrc = bloqueResolucionOrg();
const gpArgSrc = argumentoDe('useGPConstruct');
const efectoObrasSrc = efectoCargarObras();
const crearOrgSrc = manejadorOnCall('crearOrganizacion');

const NEC_APP = ['ROLES_CROSS', 'esPlataforma', 'esDependencia', 'PERMISOS'];
const NEC_FNS = ['RE_ORG_ID', 'TIPOS_ORG', 'ROLES_POR_TIPO', 'ROLES_ADMIN', 'ROLES_CROSS',
                 'emailAId', 'requireAdmin', 'ambitoDe'];
const faltan = [
  ...NEC_APP.filter(n => !app.decl[n]).map(n => `\`${n}\` en ${path.basename(archivoApp)}`),
  ...NEC_FNS.filter(n => !fns.decl[n]).map(n => `\`${n}\` en functions/index.js`),
];
if (!loginSrc) faltan.push('el `try` de resolución de organización dentro de `handleLogin`');
if (!gpArgSrc) faltan.push('la llamada a `useGPConstruct(...)` con un solo argumento');
if (!efectoObrasSrc) faltan.push("el `useEffect` que reporta `'cargar obras'`");
if (!crearOrgSrc) faltan.push('`exports.crearOrganizacion = onCall(...)`');
if (faltan.length) noArranco(faltan, archivoApp);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const seccion = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);
const lanza = (fn) => {
  try { const r = fn(); return { lanzo: false, valor: r }; }
  catch (e) { return { lanzo: true, mensaje: e.message || String(e) }; }
};

(async () => {
  let rutas;
  try { rutas = await import(archivoRutas); }
  catch (e) { noArranco([`no se pudo cargar ${path.basename(archivoRutas)} — ${e.message}`], archivoRutas); }
  for (const n of ['conOrg', 'fijarPrefijoOrg', 'fijarSesionDePlataforma', 'esSesionDePlataforma',
                   'limpiarPrefijoOrg', 'orgIdSesion']) {
    if (typeof rutas[n] !== 'function') noArranco([`\`${n}\` exportada por rutas-org.js`], archivoRutas);
  }
  const { conOrg, fijarPrefijoOrg, fijarSesionDePlataforma, esSesionDePlataforma,
          limpiarPrefijoOrg, orgIdSesion } = rutas;

  // ══════════════════════════════════════════════════════════════════════════
  seccion('§1 · LA SESIÓN DE PLATAFORMA NO ADMINISTRA OBRAS');
  // ══════════════════════════════════════════════════════════════════════════
  // El estado correcto para soporte no es «la raíz» sino «esta sesión no tiene
  // obras», y la forma de decirlo es que cualquier ruta de obra reviente. Si
  // cayera a la raíz, sus lecturas apuntarían a las cinco obras de FOSMON.
  limpiarPrefijoOrg();
  fijarSesionDePlataforma();

  check(esSesionDePlataforma() === true,
        'la sesión se puede preguntar sin provocar la excepción');

  check(conOrg('usuarios/soporte_cotea_com_mx') === 'usuarios/soporte_cotea_com_mx',
        'el padrón de usuarios sigue alcanzable: es raíz y compartido');
  check(conOrg('auditoria/x') === 'auditoria/x',
        'y la auditoría también, que es donde queda su rastro');

  const lista = lanza(() => conOrg('obras'));
  check(lista.lanzo && /plataforma/i.test(lista.mensaje),
        'pedir la LISTA de obras revienta, y dice por qué',
        lista.lanzo ? lista.mensaje : `NO LANZÓ — devolvió «${lista.valor}»`);

  const unaObra = lanza(() => conOrg('obras/0114/avance/subs'));
  check(unaObra.lanzo,
        'y una obra concreta de FOSMON tampoco resuelve a nada',
        unaObra.lanzo ? 'revienta' : `NO LANZÓ — devolvió «${unaObra.valor}»`);
  check(!unaObra.lanzo || !/^obras\//.test(String(unaObra.valor || '')),
        'en particular NO resuelve a la raíz, donde están los datos de FOSMON');

  const sinOrg = lanza(() => orgIdSesion());
  check(sinOrg.lanzo && /plataforma/i.test(sinOrg.mensaje),
        'una consulta por organización tiene que decir a cuál se refiere',
        sinOrg.lanzo ? sinOrg.mensaje : `NO LANZÓ — devolvió «${sinOrg.valor}»`);

  // Y el estado no se queda pegado: entrar como cliente después resuelve, y
  // cerrar sesión lo borra. Sin esto la siguiente sesión arrancaría apuntando
  // a donde apuntaba la anterior.
  fijarPrefijoOrg('dependencia', 'coatzacoalcos');
  check(esSesionDePlataforma() === false && conOrg('obras') === 'orgs/coatzacoalcos/obras',
        'y el estado no se queda pegado: la sesión siguiente resuelve normal',
        conOrg('obras'));
  limpiarPrefijoOrg();
  check(esSesionDePlataforma() === false,
        'cerrar sesión no deja a nadie en estado de plataforma');

  // El tercer estado NO es una puerta trasera al valor por omisión: un tipo
  // ausente sigue reventando, que es el §4 de prueba-prefijo-organizacion.
  limpiarPrefijoOrg();
  const tipoAusente = lanza(() => fijarPrefijoOrg(undefined, undefined));
  check(tipoAusente.lanzo,
        'admitir plataforma no abrió la puerta a «sin tipo, a la raíz»',
        tipoAusente.lanzo ? tipoAusente.mensaje : 'NO LANZÓ — ACEPTÓ UN TIPO AUSENTE');

  // ══════════════════════════════════════════════════════════════════════════
  seccion('§2 · EL LOGIN DEJA ENTRAR A SOPORTE');
  // ══════════════════════════════════════════════════════════════════════════
  // Se ejecuta el bloque REAL del login contra las funciones REALES de
  // rutas-org.js envueltas en espías. Lo que se mide es qué sesión quedó
  // fijada y si el usuario acabó fuera.
  const correrLogin = async (claims) => {
    limpiarPrefijoOrg();
    const llamadas = [];
    const errores = [];
    let salio = false;
    const ctx = {
      ROLES_CROSS: eval(`(${app.decl['ROLES_CROSS']})`),
      getIdTokenResult: async () => ({ claims }),
      cred: { user: { uid: 'u-prueba' } },
      fijarPrefijoOrg: (...a) => { llamadas.push({ fn: 'fijarPrefijoOrg', args: a }); return fijarPrefijoOrg(...a); },
      fijarSesionDePlataforma: () => { llamadas.push({ fn: 'fijarSesionDePlataforma', args: [] }); return fijarSesionDePlataforma(); },
      limpiarPrefijoOrg: () => { llamadas.push({ fn: 'limpiarPrefijoOrg', args: [] }); return limpiarPrefijoOrg(); },
      setError: m => errores.push(m),
      signOut: async () => { salio = true; },
      fbAuth: {},
      setLoading: () => {},
    };
    const fabrica = new Function('ctx', `"use strict";
      const { ROLES_CROSS, getIdTokenResult, cred, fijarPrefijoOrg, fijarSesionDePlataforma,
              limpiarPrefijoOrg, setError, signOut, fbAuth, setLoading } = ctx;
      return async function handleLogin() {
        ${loginSrc}
        return { tipoOrg, orgIdUsuario };
      };`);
    const resultado = await fabrica(ctx)();
    return {
      llamadas, errores, salio,
      entro: resultado !== undefined,
      sesion: resultado,
      deMeteoro: esSesionDePlataforma(),
    };
  };

  const soporte = await correrLogin({ rol: 'soporte', orgId: null, tipo: null });
  check(soporte.entro && !soporte.salio,
        'soporte entra: ya no lo saca el login antes de pintar nada',
        soporte.salio ? `LO SACÓ — ${soporte.errores[0] || ''}` : 'entró');
  check(soporte.deMeteoro === true,
        'y entra con sesión de plataforma, no con la de un cliente');
  check(!soporte.llamadas.some(l => l.fn === 'fijarPrefijoOrg'),
        'no se le pide a `fijarPrefijoOrg` resolver un tipo que no existe');
  check(soporte.sesion && soporte.sesion.tipoOrg === null && soporte.sesion.orgIdUsuario === null,
        'la sesión queda sin tipo y sin organización, que es la verdad');

  const soporteConOrg = await correrLogin({ rol: 'soporte', orgId: 'coatzacoalcos', tipo: null });
  check(!soporteConOrg.entro && soporteConOrg.salio,
        'un soporte con organización asignada es inconsistencia: no entra',
        soporteConOrg.entro ? 'ENTRÓ' : 'lo sacó');
  check(/coatzacoalcos/.test(soporteConOrg.errores[0] || ''),
        'y el mensaje nombra la organización que no debería tener',
        soporteConOrg.errores[0] || 'sin mensaje');
  check(soporteConOrg.deMeteoro === false,
        'sin quedarse a medio camino en sesión de plataforma');

  const dep = await correrLogin({ rol: 'director_obras', orgId: 'coatzacoalcos', tipo: 'dependencia' });
  check(dep.entro && !dep.salio && dep.sesion.orgIdUsuario === 'coatzacoalcos',
        'una dependencia sigue entrando por donde entraba',
        dep.entro ? `tipo=${dep.sesion.tipoOrg} org=${dep.sesion.orgIdUsuario}` : 'NO ENTRÓ');
  check(dep.deMeteoro === false && conOrg('obras') === 'orgs/coatzacoalcos/obras',
        'y su prefijo quedó fijado en su propia organización', conOrg('obras'));

  const cons = await correrLogin({ rol: 'director_general', orgId: 'fosmon', tipo: 'constructora' });
  check(cons.entro && conOrg('obras') === 'obras',
        'y FOSMON sigue en la raíz, que es donde están sus cinco obras', conOrg('obras'));

  // El caso que no debe aflojarse: un rol de cliente SIN tipo sigue sin entrar.
  const roto = await correrLogin({ rol: 'residente', orgId: 'fosmon', tipo: undefined });
  check(!roto.entro && roto.salio,
        'un usuario normal sin tipo sigue sin entrar: no se le dio la raíz',
        roto.entro ? 'ENTRÓ CON UNA SESIÓN A MEDIAS' : 'lo sacó');

  // ══════════════════════════════════════════════════════════════════════════
  seccion('§3 · NO SE PIDE LO QUE NO LE TOCA');
  // ══════════════════════════════════════════════════════════════════════════
  // Un read denegado no es inofensivo: pinta «no disponible» y manda a buscar
  // un problema de permisos donde lo que hay es que no corresponde.
  const activaGP = new Function('usuario', `"use strict";
    const ROLES_CROSS = ${app.decl['ROLES_CROSS']};
    const esDependencia = ${app.decl['esDependencia']};
    const esPlataforma = ${app.decl['esPlataforma']};
    return !!(${gpArgSrc});`);

  check(activaGP({ rol: 'soporte', tipo: null }) === false,
        'la sesión de plataforma NO pide `global/gp_construct`',
        'la contabilidad de FOSMON');
  check(activaGP({ rol: 'director_obras', tipo: 'dependencia' }) === false,
        'una dependencia tampoco, como ya era (P5)');
  check(activaGP({ rol: 'director_general', tipo: 'constructora' }) === true,
        'y FOSMON sigue pidiéndola: el hook no se apagó para todos');

  const correrEfectoObras = async (usuario) => {
    const llamadas = [];
    const errores = [];
    const ctx = {
      usuario,
      PERMISOS: eval(`(${app.decl['PERMISOS']})`),
      esPlataforma: new Function('usuario', `"use strict";
        const ROLES_CROSS = ${app.decl['ROLES_CROSS']};
        return (${app.decl['esPlataforma']})(usuario);`),
      // `collObra` y `docObra` resuelven con el `conOrg` REAL: para una sesión
      // de plataforma revientan, que es justo lo que el guardia evita.
      collObra: () => { llamadas.push('collObra'); return { ruta: conOrg('obras') }; },
      docObra: id => { llamadas.push('docObra'); return { ruta: conOrg(`obras/${id}`) }; },
      getDocs: async () => ({ docs: [] }),
      getDoc: async () => ({ exists: () => false }),
      fsGet: async () => null,
      setObras: () => { llamadas.push('setObras'); },
      consola: {
        error: (...a) => errores.push(a.join(' ')),
        warn: (...a) => errores.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')),
      },
    };
    const fabrica = new Function('ctx', `"use strict";
      const { usuario, PERMISOS, esPlataforma, collObra, docObra, getDocs, getDoc,
              fsGet, setObras, consola } = ctx;
      const console = consola;
      return (${efectoObrasSrc});`);
    fabrica(ctx)();
    await new Promise(r => setTimeout(r, 30));
    return { llamadas, errores };
  };

  limpiarPrefijoOrg();
  fijarSesionDePlataforma();
  const obrasPlataforma = await correrEfectoObras({ uid: 's1', rol: 'soporte', obras_asignadas: [] });
  check(!obrasPlataforma.llamadas.includes('collObra'),
        'la sesión de plataforma no sale a listar obras');

  // El caso que hace falta vigilar: el perfil de soporte que arrastra obras
  // asignadas de cuando era otra cosa. `actualizarUsuario` escribe con merge
  // sólo los campos que recibe, así que cambiar el rol no las borra.
  limpiarPrefijoOrg();
  fijarSesionDePlataforma();
  const obrasHeredadas = await correrEfectoObras({
    uid: 's2', rol: 'soporte', obras_asignadas: ['0114', 'OP-2026-001'],
  });
  check(!obrasHeredadas.llamadas.includes('docObra'),
        'y no va a buscar las obras que el perfil arrastra de cuando era residente',
        obrasHeredadas.llamadas.join(', ') || 'no pidió ninguna');
  check(obrasHeredadas.errores.length === 0,
        'así que la consola no reporta un fallo de carga que no hubo',
        obrasHeredadas.errores[0] || 'callada');

  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');
  const obrasCons = await correrEfectoObras({ uid: 'd1', rol: 'director_general', obras_asignadas: [] });
  check(obrasCons.llamadas.includes('collObra'),
        'y un directivo de FOSMON sí las lista: el guardia no apagó la carga',
        obrasCons.llamadas.join(', ') || 'no hizo nada');
  check(obrasCons.errores.length === 0,
        'sin errores en el camino', obrasCons.errores[0] || 'callada');
  limpiarPrefijoOrg();

  // ══════════════════════════════════════════════════════════════════════════
  seccion('§4 · EL ALTA DE ORGANIZACIÓN');
  // ══════════════════════════════════════════════════════════════════════════
  // Se ejecuta el cuerpo real del onCall con `requireAdmin` y `ambitoDe`
  // también reales, contra un Firestore de mentiras que apunta qué método se
  // usó para escribir cada documento. Lo que importa no es que escriba: es CON
  // QUÉ MÉTODO, porque `set` funde y `create` revienta.
  const fabricaCrearOrg = (perfilEnPadron, fallaCommit) => {
    const escrituras = [];
    const lote = {
      create: (ref, data) => escrituras.push({ metodo: 'create', ruta: ref.ruta, data }),
      set: (ref, data) => escrituras.push({ metodo: 'set', ruta: ref.ruta, data }),
      commit: async () => { if (fallaCommit) throw fallaCommit; },
    };
    const db = {
      doc: ruta => ({
        ruta,
        get: async () => ({ exists: !!perfilEnPadron, data: () => perfilEnPadron }),
      }),
      batch: () => lote,
    };
    // `admin` entra como la fábrica de Firestore y NADA MÁS: a propósito no
    // lleva `.firestore.FieldValue`. El `FieldValue` que se inyecta es el real,
    // el de `firebase-admin/firestore`, para que la hora del alta sea el mismo
    // centinela que se escribe en producción y no una cadena que yo elija. Las
    // dos cosas juntas fijan de dónde tiene que venir: si el código vuelve a
    // `admin.firestore.FieldValue`, aquí revienta —como revienta dentro del
    // emulador de funciones, que envuelve el módulo y pierde esa propiedad—.
    const firestore = () => db;
    class HttpsErrorFalso extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    const fabrica = new Function('admin', 'HttpsError', 'FieldValue', `"use strict";
      const emailAId = ${fns.decl['emailAId']};
      const ROLES_ADMIN = ${fns.decl['ROLES_ADMIN']};
      const ROLES_CROSS = ${fns.decl['ROLES_CROSS']};
      const TIPOS_ORG = ${fns.decl['TIPOS_ORG']};
      const ROLES_POR_TIPO = ${fns.decl['ROLES_POR_TIPO']};
      const RE_ORG_ID = ${fns.decl['RE_ORG_ID']};
      ${fns.decl['requireAdmin']}
      ${fns.decl['ambitoDe']}
      return (${crearOrgSrc});`);
    const handler = fabrica({ firestore }, HttpsErrorFalso, FieldValue);
    return { escrituras, handler };
  };

  const llamar = async (perfil, data, fallaCommit) => {
    const { escrituras, handler } = fabricaCrearOrg(perfil, fallaCommit);
    const peticion = { auth: { token: { email: perfil ? perfil.email : 'nadie@cotea.com.mx' } }, data };
    try { return { ok: true, valor: await handler(peticion), escrituras }; }
    catch (e) { return { ok: false, code: e.code, mensaje: e.message, escrituras }; }
  };

  const SOPORTE = { email: 'soporte@cotea.com.mx', rol: 'soporte', orgId: null };
  const DIR_DEP = { email: 'oscar@cotea.com.mx', rol: 'director_obras', orgId: 'coatzacoalcos' };
  const ADMIN_C = { email: 'admin@fosmon.com.mx', rol: 'admin_sistema', orgId: 'fosmon' };
  const RESIDENTE = { email: 'res@fosmon.com.mx', rol: 'residente', orgId: 'fosmon' };
  const BUENA = { orgId: 'minatitlan', nombre: 'Municipio de Minatitlán', tipo: 'dependencia' };

  // (a) Quién puede
  const porDirDep = await llamar(DIR_DEP, BUENA);
  check(!porDirDep.ok && porDirDep.code === 'permission-denied',
        'el director de Obras Públicas de un municipio NO da de alta clientes',
        porDirDep.ok ? 'LA CREÓ' : `${porDirDep.code}`);
  check(porDirDep.escrituras.length === 0,
        'y no escribió nada en el intento',
        porDirDep.escrituras.map(e => e.ruta).join(', ') || 'nada');

  const porAdminC = await llamar(ADMIN_C, BUENA);
  check(!porAdminC.ok && porAdminC.code === 'permission-denied',
        'ni el admin_sistema de la constructora',
        porAdminC.ok ? 'LA CREÓ' : `${porAdminC.code}`);

  const porResidente = await llamar(RESIDENTE, BUENA);
  check(!porResidente.ok && porResidente.code === 'permission-denied',
        'y un residente se queda en la puerta de siempre',
        porResidente.ok ? 'LA CREÓ' : `${porResidente.code}`);

  const sinPerfil = await llamar(null, BUENA);
  check(!sinPerfil.ok && sinPerfil.escrituras.length === 0,
        'quien no está en el padrón tampoco',
        sinPerfil.ok ? 'LA CREÓ' : `${sinPerfil.code}`);

  // (b) El identificador es parte de la ruta de todos los datos del cliente
  for (const malo of ['Minatitlan', 'con/barra', 'a', 'punto.punto', 'con espacio', '-empieza-mal', '']) {
    const r = await llamar(SOPORTE, { ...BUENA, orgId: malo });
    check(!r.ok && r.code === 'invalid-argument' && r.escrituras.length === 0,
          `«${malo}» no se acepta ni se corrige en silencio`,
          r.ok ? 'LA CREÓ' : r.code);
  }
  const buenos = ['minatitlan', 'san-andres-tuxtla', 'fosmon', 'org2026'];
  for (const bueno of buenos) {
    const r = await llamar(SOPORTE, { ...BUENA, orgId: bueno });
    check(r.ok, `«${bueno}» sí se acepta: la regla no quedó tan cerrada que no pase nada`,
          r.ok ? 'creada' : `${r.code}: ${r.mensaje}`);
  }

  // (c) El tipo decide los roles válidos y la ruta de las obras
  const tipoMalo = await llamar(SOPORTE, { ...BUENA, tipo: 'municipio' });
  check(!tipoMalo.ok && tipoMalo.code === 'invalid-argument' && tipoMalo.escrituras.length === 0,
        'un tipo que no existe no crea una organización inservible',
        tipoMalo.ok ? 'LA CREÓ' : tipoMalo.code);
  const sinNombre = await llamar(SOPORTE, { orgId: 'minatitlan', nombre: '   ', tipo: 'dependencia' });
  check(!sinNombre.ok && sinNombre.escrituras.length === 0,
        'y un nombre en blanco no pasa por nombre',
        sinNombre.ok ? 'LA CREÓ' : sinNombre.code);

  // (d) El camino bueno: qué quedó escrito y con qué método
  const alta = await llamar(SOPORTE, BUENA);
  check(alta.ok, 'soporte da de alta la organización', alta.ok ? 'creada' : `${alta.code}: ${alta.mensaje}`);
  const org = alta.escrituras.find(e => e.ruta === 'orgs/minatitlan');
  const marca = alta.escrituras.find(e => e.ruta === 'orgs/minatitlan/config/branding');
  check(!!org && org.metodo === 'create',
        'y la escribe con `create`, no con `set`: un id repetido tiene que fallar',
        org ? org.metodo : 'NO ESCRIBIÓ LA ORGANIZACIÓN');
  check(!!org && org.data.tipo === 'dependencia' && org.data.nombre === 'Municipio de Minatitlán'
        && org.data.activa === true,
        'con su tipo, su nombre y activa',
        org ? JSON.stringify({ tipo: org.data.tipo, activa: org.data.activa }) : 'sin datos');
  check(!!org && org.data.creadaPor === 'soporte@cotea.com.mx',
        'y con quién la creó, que es lo que la auditoría va a querer');
  // Cuándo nació un cliente no lo dice el reloj de la máquina de quien dio el
  // alta: lo dice el servidor. Se compara contra el centinela real, así que un
  // `new Date()` o un `Date.now()` puestos ahí no pasan.
  check(!!org && typeof org.data.creadaEn === 'object'
        && FieldValue.serverTimestamp().isEqual(org.data.creadaEn),
        'y la fecha de alta es la del servidor, no la del reloj de quien la creó',
        org ? `${org.data.creadaEn && org.data.creadaEn.constructor.name}` : 'sin datos');
  check(!!marca,
        'la marca entra en el mismo lote: una org sin marca sale en blanco en la demo');
  check(!!marca && marca.data.empresa === 'Municipio de Minatitlán',
        'y por omisión la marca es el nombre que se acaba de teclear, no una invención',
        marca ? marca.data.empresa : 'sin marca');
  check(!!marca && !('empresaCorta' in marca.data) && !('dominio' in marca.data),
        'lo que no se dio queda AUSENTE, no como cadena vacía que luego parezca capturada',
        marca ? Object.keys(marca.data).join(', ') : 'sin marca');

  const conMarca = await llamar(SOPORTE, {
    ...BUENA,
    branding: { empresa: 'H. Ayuntamiento de Minatitlán', empresaCorta: 'Minatitlán', dominio: 'minatitlan.gob.mx' },
  });
  const marca2 = conMarca.escrituras.find(e => e.ruta.endsWith('config/branding'));
  check(!!marca2 && marca2.data.empresa === 'H. Ayuntamiento de Minatitlán'
        && marca2.data.empresaCorta === 'Minatitlán' && marca2.data.dominio === 'minatitlan.gob.mx',
        'y la marca que se dio se guarda tal cual',
        marca2 ? JSON.stringify(marca2.data) : 'sin marca');

  check(alta.ok && alta.valor.tipo === 'dependencia'
        && Array.isArray(alta.valor.roles) && alta.valor.roles.includes('director_obras')
        && !alta.valor.roles.includes('residente'),
        'el alta devuelve los roles del tipo, que son los que el primer usuario puede llevar',
        alta.ok ? (alta.valor.roles || []).join(', ') : 'no devolvió nada');

  // (e) El id repetido: lo que separa «no se creó» de «se fundieron dos clientes»
  const yaExiste = Object.assign(new Error('entity already exists: app: ... ALREADY_EXISTS'), { code: 6 });
  const repetida = await llamar(SOPORTE, BUENA, yaExiste);
  check(!repetida.ok && repetida.code === 'already-exists',
        'un identificador ya ocupado falla en la cara de quien da el alta',
        repetida.ok ? 'LA CREÓ ENCIMA DE LA OTRA' : repetida.code);
  check(!repetida.ok && /no se escribió nada/i.test(repetida.mensaje || ''),
        'y el mensaje dice que no quedó nada escrito a medias',
        repetida.mensaje || 'sin mensaje');

  const otroFallo = await llamar(SOPORTE, BUENA, Object.assign(new Error('se cayó la red'), { code: 14 }));
  check(!otroFallo.ok && otroFallo.code === 'internal' && /se cayó la red/.test(otroFallo.mensaje),
        'cualquier otra caída se reporta como lo que es, sin disfrazarla de duplicado',
        otroFallo.code);

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0 ? 'el alta de organización se sostiene' : `${fallas} fallas`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});

// ── CONTRAPRUEBAS MEDIDAS (2026-10-08) ──────────────────────────────────────
// 26 mutaciones, 26 en ROJO (salida 1), ninguna en NO ARRANCÓ (2). Las tres
// últimas van sobre `firestore.rules` real y las ve el §5 de
// `prueba-prefijo-organizacion.cjs` en el emulador.
//
//   src/rutas-org.js
//     la sesión de plataforma cae a la raíz "por si acaso" .......... 5
//     `prefijoOrg` devuelve la raíz en vez de lanzar ................ 2
//     `orgIdSesion` devuelve vacío en vez de lanzar ................. 1
//     `esSesionDePlataforma` siempre dice que no ..................... 2
//     cerrar sesión deja el estado de plataforma pegado .............. 1
//     un tipo ausente vuelve a caer a la raíz ........................ 2
//   src/App.jsx
//     el login vuelve a pedirle a `fijarPrefijoOrg` un tipo nulo ..... 5
//     se tolera un soporte con organización asignada ................. 3
//     vuelve a pedir la contabilidad de FOSMON al montar ............. 1
//     la carga de obras pierde el guardia ............................ 2
//     `esPlataforma` siempre dice que no ............................. 3
//   functions/index.js
//     el alta vuelve a escribir con `set`: dos clientes se funden .... 1
//     cualquier admin de cliente puede dar de alta clientes .......... 3
//     el identificador se acepta como venga .......................... 6
//     el identificador se "normaliza" en silencio a minúsculas ....... 1
//     un tipo inventado crea la organización igual ................... 1
//     la marca se escribe con cadenas vacías donde no hubo dato ...... 1
//     el id repetido se reporta como una caída cualquiera ............ 2
//     la organización nace inactiva .................................. 1
//     la marca ya no entra en el mismo lote .......................... 4
//     la hora del alta la pone el reloj de quien da el alta .......... 1
//     `FieldValue` vuelve al namespace que el emulador pierde ....... 17
//     el alta no dice los roles del tipo ............................. 6
//   firestore.rules (medidas contra el emulador)
//     devuelven el alta de clientes a los admins de cada cliente ..... 2
//     aceptan una organización con cualquier tipo .................... 1
//     cualquier sesión autenticada puede crear una organización ...... 3
//
// La mutación que al principio quedó VERDE —quitarle el guardia a la carga de
// obras— enseñó que la afirmación estaba mal escrita, no que la prueba
// estuviera flaca: un perfil de soporte recién creado no tiene obras asignadas
// y no reventaba. La afirmación se corrigió al caso que sí ocurre (el perfil
// que arrastra asignadas de cuando era residente) y la mutación pasó a ROJO.
//
// Las dos de `FieldValue` se agregaron DESPUÉS, y no por simetría: el recorrido
// en el preview reventó con «Cannot read properties of undefined (reading
// 'serverTimestamp')» y esta prueba no lo había visto porque inyectaba un
// `admin.firestore.FieldValue` de mentiras que siempre existía. Una prueba que
// fabrica el entorno que el código espera comprueba la fábrica, no el código.
