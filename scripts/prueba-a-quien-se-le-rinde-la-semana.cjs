#!/usr/bin/env node
// Prueba: el cierre semanal se le rinde a quien responde por la obra EN LA
// ORGANIZACIÓN QUE LO CERRÓ, y queda constancia de a quién — o se dice que no
// la hubo.
//
// ── EL DEFECTO, EN TRES CAPAS QUE SALIERON UNA DEBAJO DE OTRA ──────────────
//
// 1) LA LISTA DE DESTINATARIOS ERA DE OTRO TIPO DE ORGANIZACIÓN. El único sitio
//    del repositorio que avisa de un cierre llamaba con cuatro nombres
//    tecleados —`director_general`, `director_operaciones`,
//    `gerente_construccion`, `admin_sistema`—, los cuatro de constructora.
//    NINGUNO existe en `ROLES_POR_TIPO.dependencia`. Un supervisor del
//    municipio puede cerrar la semana, y cuando lo hacía se cruzaban esos
//    cuatro nombres contra los usuarios de SU organización, no se encontraba a
//    nadie, y salían cero avisos. No fallaba: callaba.
//
// 2) QUIEN RINDE NO PUEDE LEER EL PADRÓN. Visto en el emulador el 2026-11-16,
//    cerrando como Laura Méndez (supervisor de obra): `permission-denied` al
//    listar `usuarios`. Las reglas sólo dejan listar esa colección a los admin
//    de cada organización, así que el reparto desde el navegador estaba al
//    revés de lo que pide la ley: quien está OBLIGADO a rendir —el residente en
//    la constructora, el supervisor de obra en la dependencia— es justo quien no
//    podía avisar, y quien sí podía era el jefe, que no tiene a quién rendirle.
//
// 3) LA CONSTANCIA LA FIRMABA EL INTERESADO. Mientras la escribía el navegador,
//    las reglas tenían que dejar que cualquiera capaz de editar la obra pusiera
//    CUALQUIER contenido en `avance/rendiciones`: firmar un acuse nombrando a
//    tres mandos a los que nunca se avisó costaba una línea en la consola. Para
//    el papel con el que alguien sostiene que cumplió el art. 73 de la Ley 233,
//    eso no acredita nada.
//
// El reparto se mudó a `rendirCierreSemanal` (functions/index.js), que lee el
// padrón con el Admin SDK —sin pasar por reglas y sin que el padrón salga hacia
// el cliente— y escribe la constancia él mismo. Desde el cliente la ruta quedó
// de SÓLO LECTURA.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
//
// No que exista ningún símbolo. Extrae de los DOS archivos el código de verdad
// y lo EJECUTA:
//
//   · De `functions/index.js`, el manejador de `rendirCierreSemanal`, encima de
//     un Admin SDK de mentira poblado con usuarios de tres organizaciones. Se
//     mira a qué buzones llegaron avisos y qué quedó escrito en el expediente.
//   · De `src/App.jsx`, el `guardar` de `GuardarAvanceBtn` con un `callFn`
//     doblado: que llame a la función en el cierre oficial y en ningún otro,
//     que le pase la obra y la semana de verdad, y que pinte lo que contesta.
//
// La §1 cruza las tablas de la función contra las de la app. Viven en dos
// archivos que se despliegan por separado y sin build compartido, así que una
// divergencia no la ve nadie: un rol que no existe en su tipo no avisa a nadie
// mientras aparenta avisar, y eso es indistinguible de una organización sin
// mandos — por eso hace falta la §6, que separa las dos.
//
// Uso:  node scripts/prueba-a-quien-se-le-rinde-la-semana.cjs
//       node scripts/prueba-a-quien-se-le-rinde-la-semana.cjs --contraprueba
//
// Los mutantes entran por `ARCHIVO_APP` y `ARCHIVO_FUNCS`, uno por archivo: la
// contraprueba corre dos veces, porque la conducta vive en los dos lados.

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');

// El `FieldValue` de verdad, el mismo que la función usa en producción. No se
// fabrica: el namespace `admin.firestore.FieldValue` es justo lo que el emulador
// de funciones pierde al envolver el módulo, y una prueba que se lo inventa deja
// de ver ese modo de fallo entero. Ver el `require` de functions/index.js.
const { FieldValue } = require(path.join(raiz, 'functions/node_modules/firebase-admin/lib/firestore'));

const ARCH_APP   = process.env.ARCHIVO_APP   || path.join(raiz, 'src/App.jsx');
const ARCH_FUNCS = process.env.ARCHIVO_FUNCS || path.join(raiz, 'functions/index.js');
const srcApp   = fs.readFileSync(ARCH_APP, 'utf8');
const srcFuncs = fs.readFileSync(ARCH_FUNCS, 'utf8');

// ════════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN
// ════════════════════════════════════════════════════════════════════════════

// ── Del front ──────────────────────────────────────────────────────────────
// Lo de nivel de módulo se pide por nombre y el cierre transitivo lo resuelve
// `fuenteDe`. Tener aquí la lista de dependencias tecleada sería una segunda
// copia del grafo, y las copias se desincronizan.
const PEDIDOS_APP = ['ROLES_POR_TIPO', 'ROL_LABEL', 'PERMISOS', 'can',
  'fraseDeRendicion', 'snapshotId'];

// Lo que `guardar` usa del nivel de módulo y NO es lo que se mide aquí. Va al
// cuerpo real, sin doblar: un doble en medio del camino dejaría de recorrerlo.
// Si `guardar` empieza a usar algo nuevo de nivel de módulo, este banco
// revienta con NO ARRANCÓ (2) nombrándolo, que es lo correcto —la conducta se
// quedó sin medir— y no un rojo.
const APOYO_APP = ['ErrorSnapshot', 'mensajeFalloSnapshot', 'corteDeEstimaciones',
  'importeCatalogoPartida', 'seSuscribe', 'soloCatalogo', 'soloExtraordinarias'];

// Lo que se deja FUERA del cuerpo para poder inyectar el doble. Si se declarara
// dentro, la declaración de verdad pisaría al doble —o reventaría por
// declaración duplicada— y el banco mediría la nube de producción.
//   · `callFn`: la llamada a la Cloud Function. Doblarla es lo que permite
//     afirmar CON QUÉ la llama y qué hace con lo que contesta.
//   · `fsSetA` y `crearSnapshotAvance`: el guardado del avance y el snapshot.
//     No son lo que se mide aquí, y arrastrarían medio archivo.
const EXCLUIR_APP = ['callFn', 'fsSetA', 'crearSnapshotAvance'];

let cuerpoApp;
try {
  cuerpoApp = fuenteDe(ARCH_APP, [...PEDIDOS_APP, ...APOYO_APP],
    { excluir: EXCLUIR_APP }).cuerpo;
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('\nSi el aviso del cierre semanal se reescribió, este banco hay que');
  console.error('rehacerlo contra el camino nuevo, no borrarlo: lo que afirma —que el');
  console.error('cierre llegue al mando de la organización que cerró— sigue siendo cierto.');
  process.exit(1);
}

// `guardar` vive DENTRO de `GuardarAvanceBtn` y es el único sitio que cierra
// una semana. Se saca por AST y se ejecuta entero: es la diferencia entre
// afirmar que el cable está conectado y recorrerlo.
const astApp = parse(srcApp, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
let fuenteGuardar = null;
traverse(astApp, {
  Function(p) {
    if (!p.node.id || p.node.id.name !== 'guardar' || fuenteGuardar) return;
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn || fn.node.id.name !== 'GuardarAvanceBtn') return;
    fuenteGuardar = srcApp.slice(p.node.start, p.node.end);
  },
});
if (!fuenteGuardar) {
  console.error('No se encontró `GuardarAvanceBtn.guardar` en ' + ARCH_APP + '.');
  console.error('Es el único sitio que cierra una semana; si se movió, este banco');
  console.error('hay que apuntarlo al sitio nuevo.');
  process.exit(1);
}

// ── De las funciones ───────────────────────────────────────────────────────
const PEDIDOS_FUNCS = ['QUIEN_SE_ENTERA', 'QUIEN_CIERRA', 'ROLES_TODAS_OBRAS',
  'emailAId', 'rutaObrasDeOrg'];

let cuerpoFuncs;
try {
  cuerpoFuncs = fuenteDe(ARCH_FUNCS, PEDIDOS_FUNCS).cuerpo;
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('\n`rendirCierreSemanal` reparte el cierre y escribe la constancia. Si sus');
  console.error('tablas cambiaron de nombre, este banco hay que apuntarlo a los nombres');
  console.error('nuevos: lo que vigila —que el cierre suba y que el acuse no lo firme el');
  console.error('interesado— no cambió.');
  process.exit(1);
}

// El manejador: el ÚLTIMO argumento de `onCall(...)`. El último y no el
// primero, porque el día que la función necesite otras opciones con el primero
// se extraería el objeto de opciones, el montaje reventaría y el banco se
// quedaría MUDO. Pasó el 2026-11-03 en el banco de aislamiento, y muda es la
// peor de las tres salidas: no afirma nada y no se ve.
const astFuncs = parse(srcFuncs, { sourceType: 'module' });
let fuenteManejador = null;
traverse(astFuncs, {
  AssignmentExpression(p) {
    const iz = p.node.left;
    if (!(iz.type === 'MemberExpression' && iz.object.name === 'exports'
          && iz.property.name === 'rendirCierreSemanal')) return;
    const de = p.node.right;
    if (de.type !== 'CallExpression' || !de.arguments.length) return;
    const ultimo = de.arguments[de.arguments.length - 1];
    fuenteManejador = srcFuncs.slice(ultimo.start, ultimo.end);
  },
});
if (!fuenteManejador) {
  console.error('No se encontró `exports.rendirCierreSemanal = onCall(…)` en ' + ARCH_FUNCS + '.');
  console.error('Es quien reparte el cierre semanal; si se renombró, este banco hay que');
  console.error('apuntarlo al nombre nuevo.');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════════
// EL MUNDO DE MENTIRA
// ════════════════════════════════════════════════════════════════════════════
//
// Tres organizaciones en la misma colección raíz `usuarios`, que es como está en
// producción. La consulta de la función filtra por `orgId`; aquí el doble de
// `where(...).get()` RESPETA ese filtro, porque si lo ignorara el banco no
// podría ver la fuga de una organización a otra.
//
// EL CORREO VA EN `correo`, no en `email`, porque así está el documento de
// usuario de Firestore. Medido en el emulador el 2026-11-16: de 9 usuarios
// sembrados, 9 tienen `correo` y ninguno `email`. Sembrar aquí `email` —que es
// lo que el banco hacía la primera vez— verificaba una forma que no existe, y
// dejaba pasar una constancia que nombraba `uid`s.
const USUARIOS = [
  // Ayuntamiento de Coatzacoalcos — dependencia
  { orgId: 'coatza', uid: 'u-dirobras', rol: 'director_obras', correo: 'dir@coatza.gob.mx',
    nombre: 'Director de Obras' },
  { orgId: 'coatza', uid: 'u-subdir', rol: 'subdirector', correo: 'sub@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-jefesup', rol: 'jefe_supervision', correo: 'jefe@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-sup', rol: 'supervisor_obra', correo: 'sup@coatza.gob.mx',
    nombre: 'Laura Méndez', obras_asignadas: ['0112'] },
  // Un SEGUNDO supervisor, y está aquí por una razón: con uno solo, «no se le
  // rinde al que cerró» y «no se le rinde a un par» son la misma frase, y meter
  // `supervisor_obra` en la lista de destinos no se notaba en ninguna parte. Con
  // dos, el aviso al par aparece como lo que es: un cierre que circula de lado
  // y no hacia arriba, y que no descarga la corresponsabilidad del art. 73.
  { orgId: 'coatza', uid: 'u-sup2', rol: 'supervisor_obra', correo: 'sup2@coatza.gob.mx',
    obras_asignadas: ['0112'] },
  { orgId: 'coatza', uid: 'u-contralor', rol: 'contralor', correo: 'contraloria@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-contratista', rol: 'contratista', correo: 'ventas@constructora.mx',
    obras_asignadas: ['0112'] },
  { orgId: 'coatza', uid: 'u-jefe-baja', rol: 'jefe_supervision', correo: 'exjefe@coatza.gob.mx',
    activo: false },
  // FOSMON — constructora. Al gerente se le siembra `email` y no `correo`: hay
  // documentos viejos así, y el aviso tiene que seguir nombrándolo.
  { orgId: 'fosmon', uid: 'f-dg', rol: 'director_general', correo: 'dg@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-dop', rol: 'director_operaciones', correo: 'dop@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-gc', rol: 'gerente_construccion', email: 'gerencia@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-admin', rol: 'admin_sistema', correo: 'sistemas@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-res', rol: 'residente', correo: 'residente@fosmon.mx',
    nombre: 'Residente', obras_asignadas: ['0112'] },
  // Otro municipio, con un director_obras propio: la fuga que se vigila.
  { orgId: 'minatitlan', uid: 'm-dirobras', rol: 'director_obras', correo: 'dir@minatitlan.gob.mx' },
];

// Las tablas y el `emailAId` de la función de verdad. `emailAId` hace falta para
// que las claves del padrón falso sean las que ella va a buscar: tecleadas, un
// renombre de esa regla dejaría al banco midiendo un Firestore donde nadie
// existe, y todo saldría «tu usuario no está activo» en verde.
const fnPiezas = new Function('admin', 'FieldValue', 'HttpsError',
  `"use strict";\n${cuerpoFuncs}\nreturn { ${PEDIDOS_FUNCS.join(', ')} };`)(
  null, FieldValue, null);

// Las obras que existen. La función comprueba que la obra sea de la
// organización de quien llama, así que el mundo tiene que tener obras.
//
// LA ASIMETRÍA NO SE TECLEA, se pregunta a `rutaObrasDeOrg`: las de la
// constructora viven en la raíz (`obras/0112`) y las de una dependencia bajo su
// organización (`orgs/coatza/obras/0112`). Escrita a mano, el banco se la había
// inventado al revés —las dos bajo `orgs/`— y salía verde mientras la función
// estaba muerta para toda constructora: la obra «no existía», contestaba
// `not-found`, y la pantalla pintaba «el aviso no salió». Lo cazó el emulador.
// Un banco que teclea la ruta se comprueba contra sí mismo.
const rutaObrasDeOrg = fnPiezas.rutaObrasDeOrg;
const rutaObra = (orgId, tipo, obraId) => `${rutaObrasDeOrg(orgId, tipo)}/${obraId}`;
const RUTA_COATZA = rutaObra('coatza', 'dependencia', '0112');
const RUTA_FOSMON = rutaObra('fosmon', 'constructora', '0112');
const RUTA_MINA = rutaObra('minatitlan', 'dependencia', '0112');
const OBRAS = [RUTA_COATZA, RUTA_FOSMON, RUTA_MINA];
const CONSTANCIA_COATZA = `${RUTA_COATZA}/avance/rendiciones`;
const CONSTANCIA_FOSMON = `${RUTA_FOSMON}/avance/rendiciones`;
const CONSTANCIA_MINA = `${RUTA_MINA}/avance/rendiciones`;

class HttpsErrorFalso extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// El Admin SDK de mentira. Lo mínimo para que la función real corra y se pueda
// mirar qué escribió y en qué orden — el orden es la mitad del asunto. No
// simula reglas: el Admin SDK no pasa por ellas, que es precisamente por lo que
// la función existe.
const mundo = ({ usuarios = USUARIOS, obras = OBRAS, rebotaAviso = false,
    rebotaConstancia = false, lecturaRevienta = false } = {}) => {
  const w = { store: new Map(), buzones: {}, escrituras: [], errores: [] };
  for (const r of obras) w.store.set(r, { nombre: 'Malecón' });
  for (const u of usuarios) {
    w.store.set(`usuarios/${fnPiezas.emailAId(u.correo || u.email)}`, u);
  }

  // La ruta viaja EN la referencia: `batch.set(ref, data)` recibe la referencia
  // y no la ruta, y sin ella no se puede saber a qué buzón fue cada aviso.
  const refDoc = (ruta) => ({
    __ruta: ruta,
    get: async () => ({ exists: w.store.has(ruta), data: () => w.store.get(ruta) }),
    set: async (d, opt) => {
      if (rebotaConstancia) { const e = new Error('permission-denied'); e.code = 7; throw e; }
      const antes = w.store.get(ruta) || {};
      w.store.set(ruta, opt && opt.merge
        ? { ...antes, ...d,
            rendiciones: { ...(antes.rendiciones || {}), ...(d.rendiciones || {}) } }
        : d);
      w.escrituras.push({ ruta, d });
    },
  });

  let serie = 0;
  const coleccion = (ruta) => {
    if (ruta !== 'usuarios') return { doc: () => refDoc(`${ruta}/auto-${++serie}`) };
    const hacer = (filtro) => ({
      get: async () => {
        if (lecturaRevienta) { const e = new Error('permission-denied'); e.code = 7; throw e; }
        return { docs: usuarios.filter(u => !filtro || filtro(u)).map(u => ({ data: () => u })) };
      },
      where: (campo, op, val) => {
        if (op !== '==') noArranco(`la base de mentira sólo sabe de '==', no de '${op}'`);
        return hacer(u => u[campo] === val);
      },
    });
    return hacer(null);
  };

  const db = {
    doc: refDoc,
    collection: coleccion,
    batch: () => {
      const puestos = [];
      return {
        set: (ref, data) => puestos.push({ ref, data }),
        commit: async () => {
          if (rebotaAviso) { const e = new Error('permission-denied'); e.code = 7; throw e; }
          for (const { ref, data } of puestos) {
            const m = /^notificaciones\/([^/]+)\//.exec(ref.__ruta);
            (w.buzones[m ? m[1] : ref.__ruta] = w.buzones[m ? m[1] : ref.__ruta] || [])
              .push(data);
            w.escrituras.push({ ruta: ref.__ruta, d: data });
          }
        },
      };
    },
  };
  w.admin = { firestore: () => db };
  w.consola = { error: (...a) => w.errores.push(a.map(String).join(' ')), warn: () => {} };
  return w;
};

// La función real, montada sobre un mundo. Nada reescrito: una prueba que
// recopia la función se comprueba contra sí misma.
const montar = (w) => {
  try {
    return new Function('admin', 'FieldValue', 'HttpsError', 'console',
      `"use strict";\n${cuerpoFuncs}\nreturn (${fuenteManejador});`)(
      w.admin, FieldValue, HttpsErrorFalso, w.consola);
  } catch (e) {
    noArranco('`rendirCierreSemanal` no se pudo montar — ' + e.message);
  }
};

// Quien llama, tal como se lo pasa el SDK: `tipo` y `orgId` van en los CLAIMS,
// que es de donde la función tiene que leerlos.
const quien = (u, extra = {}) => ({
  auth: { token: {
    email: u.correo || u.email,
    rol: u.rol,
    orgId: u.orgId,
    tipo: u.orgId === 'fosmon' ? 'constructora' : 'dependencia',
    ...extra,
  } },
});

const LAURA    = USUARIOS.find(u => u.uid === 'u-sup');
const DIRECTOR = USUARIOS.find(u => u.uid === 'u-dirobras');
const RESIDENTE = USUARIOS.find(u => u.uid === 'f-res');

const DATOS = { obraId: '0112', clave: 'S46-2026', obraNombre: 'Malecón',
  semana: 46, avance: 37.4 };

// Llamar sin que una excepción reviente el banco: un `HttpsError` es una salida
// legítima de la función y tiene que poder examinarse. Un `throw` que aborta el
// proceso sería NO ARRANCÓ, y eso deja la conducta sin medir.
const llamar = async (w, request) => {
  try { return { r: await montar(w)(request), err: null }; }
  catch (e) { return { r: null, err: e }; }
};

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Las piezas del front, para la §1 y la §7.
const appPiezas = (dobles = {}) => {
  const d = { callFn: async () => ({ ok: true, data: {} }),
    fsSetA: async () => true, crearSnapshotAvance: async () => null, ...dobles };
  const nombres = Object.keys(d);
  return new Function(...nombres, 'console',
    `"use strict";\n${cuerpoApp}\nreturn { ${PEDIDOS_APP.join(', ')} };`)(
    ...nombres.map(n => d[n]), console);
};

(async () => {

// ════════════════════════════════════════════════════════════════════════════
console.log('1. Las dos tablas de la función concuerdan con los roles de la app');
// Viven en archivos distintos que se despliegan por separado, sin build
// compartido: la de producción sería la que estuviera más atrasada, y nadie lo
// vería. Ésta es la sección que habría salido roja antes del arreglo.
{
  const app = appPiezas();
  const { QUIEN_SE_ENTERA, QUIEN_CIERRA } = fnPiezas;

  for (const tipo of ['dependencia', 'constructora']) {
    const destinos = QUIEN_SE_ENTERA[tipo] || [];
    const propios = app.ROLES_POR_TIPO[tipo];
    check(destinos.length > 0, `un cierre de ${tipo} tiene a quién rendirse`,
      JSON.stringify(destinos));
    const ajenos = destinos.filter(r => !propios.includes(r));
    check(ajenos.length === 0,
      `y los ${destinos.length} destinatarios de ${tipo} existen en su propia tabla de roles`,
      ajenos.length ? 'AJENOS: ' + ajenos.join(', ') : destinos.join(' · '));
    // Un aviso lleva link a una pantalla. Mandárselo a quien no puede abrirla
    // es ruido con la forma de una rendición.
    const ciegos = destinos.filter(r => !app.can(r, 'dash', 'ver'));
    check(ciegos.length === 0, 'y todos pueden abrir la pantalla a la que el aviso lleva',
      ciegos.length ? 'SIN ACCESO: ' + ciegos.join(', ') : 'todos ven el tablero');
    // Y tienen nombre en castellano, porque `fraseDeRendicion` los imprime.
    const anonimos = destinos.filter(r => !app.ROL_LABEL[r]);
    check(anonimos.length === 0, 'y tienen rótulo: la frase de la pantalla los nombra',
      anonimos.length ? 'SIN RÓTULO: ' + anonimos.join(', ') : 'todos rotulados');

    // `QUIEN_CIERRA` es la única copia que no se pudo evitar: el original es
    // `PERMISOS[rol].captura === 'editar'` y esa tabla no existe del lado de las
    // funciones. Como no se puede borrar, se mide — rol por rol y en los dos
    // sentidos, porque sobrar abre un permiso y faltar deja a alguien sin poder
    // rendir lo que la ley le obliga a rendir.
    const capturan = propios.filter(r => (app.PERMISOS[r] || {}).captura === 'editar').sort();
    const cierran = [...(QUIEN_CIERRA[tipo] || [])].sort();
    check(JSON.stringify(capturan) === JSON.stringify(cierran),
      `y quien cierra en ${tipo} es exactamente quien captura avance en PERMISOS`,
      capturan.join(',') === cierran.join(',') ? `${cierran.length} roles`
        : `PERMISOS: ${capturan.join(' · ')}\n         FUNCIÓN:  ${cierran.join(' · ')}`);
  }

  // Quien ejecuta la obra no es a quien se le rinde cuentas de ella.
  check(!(QUIEN_SE_ENTERA.dependencia || []).includes('contratista'),
    'al contratista NO se le rinde el cierre del municipio: está del otro lado del mostrador',
    (QUIEN_SE_ENTERA.dependencia || []).join(' · '));
  check(!(QUIEN_SE_ENTERA.constructora || []).includes('cliente'),
    'ni al cliente el de la constructora, por lo mismo');
  // Un tipo que no es ninguno de los dos no tiene destinatarios, y la función
  // lo trata como precondición fallida en vez de avisar a quien no toca.
  check(QUIEN_SE_ENTERA.soporte === undefined && QUIEN_SE_ENTERA[undefined] === undefined,
    'y una sesión sin tipo no cae en ninguna lista: no hay a quién rendirle por descarte',
    Object.keys(QUIEN_SE_ENTERA).join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. Un cierre del municipio le llega al mando del municipio');
// El recorrido entero: el manejador de verdad sobre el Admin SDK de mentira, y
// los buzones que de verdad quedaron escritos. Cierra LAURA, supervisora de
// obra: es el caso que el 2026-11-16 salía con `permission-denied` desde el
// navegador y mandaba cero avisos.
{
  const w = mundo();
  const { r, err } = await llamar(w, { ...quien(LAURA), data: DATOS });

  check(!err && r && r.ok === true, 'la supervisora puede rendir su cierre',
    err ? `LANZÓ ${err.code}: ${err.message}` : JSON.stringify(r));
  const quienes = Object.keys(w.buzones).sort();
  check(quienes.length > 0,
    'el aviso del cierre sale: antes del arreglo salían CERO avisos',
    quienes.join(' · ') || 'NINGÚN BUZÓN ESCRITO');
  check(quienes.includes('u-dirobras'),
    'y le llega al Director de Obras, que es quien firma la corresponsabilidad del art. 73',
    quienes.join(' · '));
  check(quienes.includes('u-subdir') && quienes.includes('u-jefesup'),
    'y a su subdirector y a su jefe de supervisión');

  // Los que NO. Cada uno por una razón distinta.
  check(!quienes.includes('u-contratista'),
    'al contratista no le llega el parte interno del municipio');
  check(!quienes.includes('u-contralor'),
    'ni al contralor, que revisa el expediente y no recibe el parte de cada semana');
  check(!quienes.includes('u-sup'),
    'ni a la propia supervisora que cerró: nadie se rinde cuentas a sí mismo');
  check(!quienes.includes('u-sup2'),
    'ni al otro supervisor: un cierre que circula de lado no se rindió a nadie',
    quienes.join(' · '));
  check(!quienes.includes('u-jefe-baja'),
    'ni a un jefe de supervisión dado de baja', quienes.join(' · '));
  // La fuga entre organizaciones. `usuarios` es una colección raíz compartida.
  check(!quienes.includes('m-dirobras'),
    'y el cierre del malecón de Coatzacoalcos no le llega al director de obras de Minatitlán',
    quienes.join(' · '));
  check(quienes.every(q => q.startsWith('u-')),
    'ni a nadie de FOSMON: ningún buzón de otra organización se toca',
    quienes.join(' · '));

  // Qué dice el aviso. Un aviso sin semana ni avance obliga a abrir la app
  // para saber si hay algo que mirar.
  const av = (w.buzones['u-dirobras'] || [])[0] || {};
  check(/S46/.test(av.titulo || ''), 'el aviso dice qué semana cerró', av.titulo || 'SIN TÍTULO');
  check(/Malecón/.test(av.titulo || ''), 'y de qué obra', av.titulo || 'SIN TÍTULO');
  check(/37\.4/.test(av.mensaje || ''), 'y con cuánto avance', av.mensaje || 'SIN MENSAJE');
  check(/Laura Méndez/.test(av.mensaje || ''), 'y quién lo cerró', av.mensaje || 'SIN MENSAJE');
  check((av.link || {}).obraId === '0112', 'y lleva a la obra', JSON.stringify(av.link));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. Cuando el que cierra ES uno de los que tienen que enterarse');
// Visto en el emulador el 2026-11-16, cerrando la semana como Director de
// Obras: «Rendida a jefesup@… · oscar@… · subdirector@…». El director de Obras
// es a la vez quien puede cerrar la semana y uno de los tres roles a los que
// hay que rendirla, así que la constancia del art. 73 quedaba acusando recibo a
// nombre de quien la firmaba. Un acuse que uno se extiende a sí mismo no
// acredita que nadie más se enterara.
//
// La §2 no podía verlo: allí cerraba una supervisora, que no está en la lista de
// destinos, así que «no se le avisó al que cerró» salía verde por el rol y no
// por el mecanismo.
{
  const w = mundo();
  const { r, err } = await llamar(w, { ...quien(DIRECTOR), data: DATOS });
  const quienes = Object.keys(w.buzones).sort();

  check(!err && r && r.ok === true, 'el cierre se consuma igual',
    err ? `LANZÓ: ${err.message}` : 'ok');
  check(!quienes.includes('u-dirobras'),
    'el director que cerró la semana NO recibe el aviso de su propio cierre',
    quienes.join(' · ') || 'NINGÚN BUZÓN');
  check(quienes.includes('u-subdir') && quienes.includes('u-jefesup'),
    'y los otros dos mandos sí: sacar al que cerró no apaga el aviso',
    quienes.join(' · '));

  // Y la constancia tampoco lo nombra: es el documento con el que alguien
  // sostendría que cumplió.
  const a = (r || {}).destinatarios || [];
  check(!a.includes('dir@coatza.gob.mx'),
    'la constancia no lo nombra entre aquéllos a quienes se rindió',
    a.join(' · ') || 'LISTA VACÍA');
  check(a.length === 2, 'quedan los dos que de verdad se enteraron, ni uno más',
    `${a.length}: ${a.join(' · ')}`);
  const grabado = ((w.store.get(CONSTANCIA_COATZA) || {})
    .rendiciones || {})['S46-2026'] || {};
  check(!(grabado.a || []).includes('dir@coatza.gob.mx'),
    'y el documento escrito en Firestore tampoco', JSON.stringify(grabado.a || null));
  check(grabado.porQuien === 'dir@coatza.gob.mx',
    'aunque sí dice que fue él quien rindió: el que firma y los que acusan son listas distintas',
    String(grabado.porQuien));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Un cierre de la constructora sigue llegando a donde llegaba');
// El arreglo mete un corte por tipo donde no había ninguno. Si eso hubiera
// desviado el cierre de la constructora, se cambiaría un defecto por otro.
{
  const w = mundo();
  const { r, err } = await llamar(w, { ...quien(RESIDENTE), data: DATOS });
  const quienes = Object.keys(w.buzones).sort();
  check(!err && r && r.ok === true, 'el residente cierra',
    err ? `LANZÓ: ${err.message}` : 'ok');
  check(quienes.includes('f-dg') && quienes.includes('f-dop')
        && quienes.includes('f-gc') && quienes.includes('f-admin'),
    'los cuatro mandos de la constructora siguen recibiendo el cierre',
    quienes.join(' · '));
  // El gerente tiene el correo en `email` y no en `correo`: hay documentos
  // viejos así, y la constancia tiene que nombrarlo igual.
  check(((r || {}).destinatarios || []).includes('gerencia@fosmon.mx'),
    'y un usuario viejo, con el correo en `email`, se nombra igual',
    JSON.stringify((r || {}).destinatarios));
  check(!quienes.includes('u-dirobras') && !quienes.includes('m-dirobras'),
    'y ningún municipio recibe el parte interno de la constructora',
    quienes.join(' · '));
  // La constancia va al expediente de SU organización, no al del municipio que
  // tiene una obra con la misma clave.
  check(!!w.store.get(CONSTANCIA_FOSMON)
        && !w.store.get(CONSTANCIA_COATZA),
    'y la constancia se escribe en el expediente de FOSMON, no en el del municipio',
    [...w.store.keys()].filter(k => k.includes('rendiciones')).join(' · ') || 'NINGUNA');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. Lo que la función se niega a rendir');
// Un `onCall` se invoca desde el SDK sin pasar por la interfaz: que la pantalla
// no ofrezca el botón no es defensa. Cada negativa va por separado — si fueran
// una sola aserción, bastaría con que la primera mordiera para que las demás se
// fueran en verde sin que nadie las mida.
{
  const sinAuth = await llamar(mundo(), { data: DATOS });
  check(sinAuth.err && sinAuth.err.code === 'unauthenticated',
    'sin sesión no se rinde nada', sinAuth.err ? sinAuth.err.code : 'NO LANZÓ');

  const sinObra = await llamar(mundo(), { ...quien(LAURA), data: { clave: 'S46-2026' } });
  check(sinObra.err && sinObra.err.code === 'invalid-argument',
    'sin obra tampoco: no se puede acreditar el cierre de nada',
    sinObra.err ? sinObra.err.code : 'NO LANZÓ');

  const sinSemana = await llamar(mundo(), { ...quien(LAURA), data: { obraId: '0112' } });
  check(sinSemana.err && sinSemana.err.code === 'invalid-argument',
    'ni sin la semana que se cerró: la constancia se guarda bajo esa clave',
    sinSemana.err ? sinSemana.err.code : 'NO LANZÓ');

  // Un usuario dado de baja conserva su documento. Si el claim no se hubiera
  // sincronizado todavía, el token sigue sirviendo y la función es la última
  // defensa.
  const baja = USUARIOS.map(u => u.uid === 'u-sup' ? { ...u, activo: false } : u);
  const rBaja = await llamar(mundo({ usuarios: baja }), { ...quien(LAURA), data: DATOS });
  check(rBaja.err && rBaja.err.code === 'permission-denied',
    'un usuario dado de baja no rinde, aunque su token siga vivo',
    rBaja.err ? rBaja.err.code : 'NO LANZÓ');

  // EL ROL. El contralor y el contratista ven la obra y no la capturan; sin este
  // corte podrían mandarle a los mandos el parte de una semana que nadie cerró,
  // y dejar la constancia grabada.
  for (const uid of ['u-contralor', 'u-contratista']) {
    const u = USUARIOS.find(x => x.uid === uid);
    const w = mundo();
    const { err } = await llamar(w, { ...quien(u), data: DATOS });
    check(err && err.code === 'permission-denied',
      `${u.rol} no captura avance, así que no cierra semanas`,
      err ? err.code : 'NO LANZÓ');
    check(Object.keys(w.buzones).length === 0 && !w.store.get(CONSTANCIA_COATZA),
      '  y no deja ni un aviso ni una constancia detrás',
      Object.keys(w.buzones).join(' · ') || 'nada');
  }

  // EL `orgId` SALE DEL CLAIM, NUNCA DE LA PETICIÓN. Es el mismo dato que
  // evalúan las reglas de Firestore. Si viniera en `data`, el cliente elegiría
  // a qué padrón entrar: aquí Laura pide el padrón de Minatitlán.
  {
    const w = mundo();
    const { r } = await llamar(w, { ...quien(LAURA),
      data: { ...DATOS, orgId: 'minatitlan', tipo: 'dependencia' } });
    const quienes = Object.keys(w.buzones);
    check(!quienes.includes('m-dirobras') && quienes.includes('u-dirobras'),
      'un `orgId` puesto en la petición se ignora: se rinde en la organización del claim',
      quienes.join(' · ') || 'NINGÚN BUZÓN');
    check(!!w.store.get(CONSTANCIA_COATZA)
          && !w.store.get(CONSTANCIA_MINA),
      'y la constancia se escribe en el expediente de su municipio, no en el del vecino',
      [...w.store.keys()].filter(k => k.includes('rendiciones')).join(' · ') || 'NINGUNA');
    check(((r || {}).destinatarios || []).length === 3, 'y se rinde a los tres de siempre',
      JSON.stringify((r || {}).destinatarios));
  }

  // Y EL `tipo`, IGUAL. Es lo que decide a qué mandos se avisa y quién puede
  // cerrar, así que si viniera en `data` el cliente elegiría su propio
  // organigrama: Laura, supervisora de un municipio, pide ser tratada como
  // constructora —donde `supervisor_obra` no cierra semanas— y de todas formas
  // rinde al mando del municipio, que es el que su claim dice.
  {
    const w = mundo();
    const { r, err } = await llamar(w, { ...quien(LAURA),
      data: { ...DATOS, tipo: 'constructora' } });
    check(!err && ((r || {}).roles || []).join() === 'director_obras,subdirector,jefe_supervision',
      'un `tipo` puesto en la petición se ignora: el organigrama sale del claim',
      err ? err.code : JSON.stringify((r || {}).roles));
    const quienes = Object.keys(w.buzones);
    check(quienes.length === 3 && !quienes.some(q => q.startsWith('f-')),
      'y el parte sigue yendo a los mandos del municipio, no a los de la constructora',
      quienes.join(' · ') || 'NINGÚN BUZÓN');
  }

  // Una obra que no existe en SU organización. Sin esto, un supervisor mandaría
  // a sus mandos el parte de una obra ajena.
  {
    const w = mundo({ obras: [RUTA_MINA] });
    const { err } = await llamar(w, { ...quien(LAURA), data: DATOS });
    check(err && err.code === 'not-found',
      'una obra que no es de su organización no se puede rendir',
      err ? err.code : 'NO LANZÓ');
    check(Object.keys(w.buzones).length === 0, '  y nadie recibe el parte de una obra ajena',
      Object.keys(w.buzones).join(' · ') || 'nada');
  }

  // Y una obra de su organización que no le asignaron. Quien no ve todas las
  // obras sólo rinde las suyas: es la misma frontera que el claim `todas`.
  {
    const sinAsignar = USUARIOS.map(u => u.uid === 'u-sup' ? { ...u, obras_asignadas: ['0126'] } : u);
    const w = mundo({ usuarios: sinAsignar });
    const { err } = await llamar(w, { ...quien(LAURA), data: DATOS });
    check(err && err.code === 'permission-denied',
      'una obra del municipio que no le asignaron, tampoco',
      err ? err.code : 'NO LANZÓ');
    // Y el director, que sí ve todas, la rinde sin tenerla asignada.
    const w2 = mundo({ usuarios: sinAsignar });
    const { err: e2 } = await llamar(w2, { ...quien(DIRECTOR), data: DATOS });
    check(!e2, '  pero el director de Obras, que ve todas, sí: la asignación no le aplica',
      e2 ? `LANZÓ: ${e2.code}` : 'rindió');
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. Queda constancia de a quién se le rindió, y de cuándo');
// Art. 74: el expediente se conserva cinco años. El histórico semanal se
// recorta a 52 semanas, así que la constancia NO puede vivir dentro del
// snapshot — vive en su propio documento.
{
  const w = mundo();
  await llamar(w, { ...quien(LAURA), data: DATOS });
  const ruta = CONSTANCIA_COATZA;
  const doc = w.store.get(ruta);
  check(!!doc, 'la rendición queda escrita en su propio documento del expediente',
    doc ? ruta : 'NO SE ESCRIBIÓ  ·  ' + [...w.store.keys()].filter(k => k.includes('obras')).join(', '));
  // La clave se pregunta a `snapshotId`, no se teclea. El banco la tenía
  // escrita como `2026-S46` y la app la escribe `S46-2026`: una comprobación
  // que inventa la forma del dato se comprueba contra sí misma, y ésta en
  // concreto es la que dice que la semana cerrada y su constancia se pueden
  // emparejar dentro de cinco años.
  const clave = appPiezas().snapshotId(46, 2026);
  const r = ((doc || {}).rendiciones || {})[clave];
  check(!!r, `bajo la clave que la app le da a esa semana (${clave})`,
    r ? clave : 'claves: ' + Object.keys((doc || {}).rendiciones || {}).join(', '));
  check(!!r && Array.isArray(r.a) && r.a.includes('dir@coatza.gob.mx'),
    'y dice A QUIÉN, con nombre y apellido, no «se notificó»',
    r ? JSON.stringify(r.a) : 'sin destinatarios');
  check(!!r && r.a.length === 3, 'a los tres y sólo a los tres',
    r ? `${r.a.length} destinatario(s)` : '');
  // El correo del documento de usuario vive en `correo`. Leerlo de `email`
  // —que en Firestore no existe— caía al `uid`, y el expediente quedaba
  // diciendo «a: ["KlK6gegZVnvmREvgnn9yydYJ9iQZ"]»: nombrar un identificador
  // opaco no es nombrar a nadie.
  check(!!r && r.a.every(x => /@/.test(x)),
    'y los nombra por su correo, no por un `uid` que nadie puede leer',
    r ? JSON.stringify(r.a) : '');
  check(!!r && Array.isArray(r.roles) && r.roles.includes('director_obras'),
    'y qué roles se buscaron: sin eso, una lista vacía no se puede leer',
    r ? JSON.stringify(r.roles) : '');
  check(!!r && r.porQuien === LAURA.correo && r.rol === 'supervisor_obra',
    'y quién rindió', r ? `${r.porQuien} · ${r.rol}` : '');
  check(!!r && typeof r.en === 'string' && !Number.isNaN(Date.parse(r.en)),
    'y cuándo', r ? r.en : '');

  // El orden. La constancia se escribe DESPUÉS del aviso, porque al revés
  // afirmaría en el expediente una rendición que puede no haber ocurrido — y
  // éste es el documento con el que alguien sostendría que cumplió.
  const rutas = w.escrituras.map(e => e.ruta);
  const iAviso = rutas.findIndex(x => x.startsWith('notificaciones/'));
  const iConst = rutas.indexOf(ruta);
  check(iAviso >= 0 && iConst >= 0 && iAviso < iConst,
    'los avisos se escriben primero y la constancia después',
    rutas.map(x => x.split('/')[0]).join(' → '));

  // Dos semanas cerradas no se pisan: `merge` y una clave por semana. Sin esto
  // el expediente sólo acreditaría la última, y el art. 74 pide cinco años.
  await llamar(w, { ...quien(LAURA), data: { ...DATOS, clave: 'S47-2026', semana: 47 } });
  const claves = Object.keys((w.store.get(ruta) || {}).rendiciones || {}).sort();
  check(claves.length === 2 && claves.includes('S46-2026') && claves.includes('S47-2026'),
    'y cerrar la semana siguiente no borra la constancia de la anterior',
    claves.join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n7. Un cierre que no llegó a nadie no se ve igual que uno que sí');
// Cuatro salidas, y distinguirlas es lo que permite no escribir una constancia
// falsa y que la pantalla diga la verdad.
{
  // (a) Salió.
  {
    const w = mundo();
    const { r } = await llamar(w, { ...quien(LAURA), data: DATOS });
    const f = appPiezas().fraseDeRendicion(r);
    check(r && r.ok === true && r.destinatarios.length === 3 && r.constancia === true,
      'cuando salió, la pantalla recibe a quién', JSON.stringify(r));
    check(!!f && f.tono === 'ok' && /dir@coatza\.gob\.mx/.test(f.texto),
      'y lo dice con los correos, en verde', f ? `${f.tono}: ${f.texto}` : 'SIN FRASE');
  }

  // (b) No había a quién: una organización sin mandos de alta. Es un hueco de
  // la organización, no un fallo del sistema, y se lee distinto.
  {
    const soloLosSup = USUARIOS.filter(u => u.orgId !== 'coatza' || u.rol === 'supervisor_obra');
    const w = mundo({ usuarios: soloLosSup });
    const { r } = await llamar(w, { ...quien(LAURA), data: DATOS });
    check(r && r.ok === true && r.destinatarios.length === 0,
      'sin nadie a quien rendirle, no se reporta un fallo que no hubo', JSON.stringify(r));
    check(!w.store.get(CONSTANCIA_COATZA),
      'y NO se escribe una constancia que diga que se rindió a nadie',
      w.store.get(CONSTANCIA_COATZA) ? 'LA ESCRIBIÓ' : 'no la escribió');
    const f = appPiezas().fraseDeRendicion(r);
    check(!!f && f.tono === 'hueco' && /no hay/i.test(f.texto),
      'y la pantalla dice que no hubo a quién, con los roles que se buscaron',
      f ? f.texto : 'SIN FRASE');
    check(!!f && /Director de Obras/.test(f.texto),
      'en castellano, no con las claves internas', f ? f.texto : '');
  }

  // (c) El aviso rebota. La función lanza y `callFn` lo traduce a `{ok:false}`:
  // ése es el caso «la semana cerró y nadie se enteró», que la pantalla sabe
  // decir. Lo que no puede quedar es constancia de una rendición que rebotó.
  {
    const w = mundo({ rebotaAviso: true });
    const { r, err } = await llamar(w, { ...quien(LAURA), data: DATOS });
    check(!!err && !r, 'un aviso que rebota no contesta una rendición cumplida',
      err ? `lanzó: ${err.message}` : JSON.stringify(r));
    check(!w.store.get(CONSTANCIA_COATZA),
      'y el expediente NO afirma una rendición que no salió',
      w.store.get(CONSTANCIA_COATZA) ? 'LA ESCRIBIÓ' : 'no la escribió');
    const f = appPiezas().fraseDeRendicion({ ok: false, roles: [], destinatarios: [] });
    check(!!f && f.tono === 'fallo' && /no (salió|lo sabe)/.test(f.texto),
      'y la pantalla dice que el cierre quedó pero el aviso no salió',
      f ? f.texto : 'SIN FRASE');
  }

  // (d) La lectura del padrón revienta. Mismo trato que (c).
  {
    const w = mundo({ lecturaRevienta: true });
    const { r, err } = await llamar(w, { ...quien(LAURA), data: DATOS });
    check(!!err && !r, 'si ni se pudo leer a quién avisar, tampoco se dice que se rindió',
      err ? `lanzó: ${err.message}` : JSON.stringify(r));
    check(!w.store.get(CONSTANCIA_COATZA), 'y no queda constancia');
  }

  // (e) La constancia rebota y el aviso sí salió. Es el único caso donde el
  // expediente se queda corto, y no puede tirar ni el aviso ni el cierre.
  {
    const w = mundo({ rebotaConstancia: true });
    const { r, err } = await llamar(w, { ...quien(LAURA), data: DATOS });
    check(!err && r && r.ok === true,
      'una constancia que rebota no tira el aviso que ya salió',
      err ? `LANZÓ: ${err.message}` : JSON.stringify(r));
    check(Object.keys(w.buzones).length === 3, 'los tres avisos ya salieron y no se deshacen',
      Object.keys(w.buzones).join(' · '));
    // Y LA PANTALLA NO PUEDE DECIR «Rendida a …». Esto pasaba de verdad, no en
    // un supuesto: hasta el 2026-11-16 la ruta `avance/rendiciones` no estaba
    // declarada en firestore.rules, así que TODA constancia rebotaba y el
    // cierre se anunciaba rendido con el expediente vacío. Visto en el
    // emulador cerrando como Director de Obras: la caja decía «Rendida a
    // jefesup@… · subdirector@…» y en Firestore no había documento.
    check((r || {}).constancia === false,
      'la pantalla se entera de que la constancia no se escribió',
      JSON.stringify((r || {}).constancia));
    const f = appPiezas().fraseDeRendicion(r) || {};
    check(f.tono !== 'ok',
      'y NO lo pinta como un cierre rendido: el aviso salió, el registro no',
      `${f.tono}: ${f.texto}`);
    check(/constancia/i.test(f.texto || ''),
      'y dice exactamente qué faltó, no un error genérico', f.texto || 'SIN TEXTO');
  }

  // (f) Las cuatro frases son distinguibles entre sí. Si dos dijeran lo mismo,
  // la pantalla volvería a tener dos estados que se ven iguales.
  {
    const app = appPiezas();
    const t = [
      app.fraseDeRendicion({ ok: true, roles: ['director_obras'], destinatarios: ['a@b.mx'], constancia: true }),
      app.fraseDeRendicion({ ok: true, roles: ['director_obras'], destinatarios: [] }),
      app.fraseDeRendicion({ ok: false, roles: ['director_obras'], destinatarios: [] }),
      app.fraseDeRendicion({ ok: true, roles: ['director_obras'], destinatarios: ['a@b.mx'], constancia: false }),
    ];
    check(new Set(t.map(x => x.tono)).size === 4, 'las cuatro salidas tienen tono distinto',
      t.map(x => x.tono).join(' · '));
    check(new Set(t.map(x => x.texto)).size === 4, 'y texto distinto',
      t.map(x => x.texto.slice(0, 32)).join(' | '));
    check(app.fraseDeRendicion(null) === null, 'y sin cierre reciente no se pinta nada');
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n8. La pantalla llama a la función y pinta lo que contesta');
// El `guardar` de verdad, con `callFn` doblado. Sin esta sección la función
// podría ser perfecta y no estar conectada a nada: afirmar que el cable existe
// no es recorrerlo.
const PROPS = ['obra', 'subs', 'maquinaria', 'materiales', 'usuario', 'estimaciones',
  'estCargadas', 'onSaved', 'onHistorialNuevo', 'onGuardarNota', 'quedo',
  'setEstado', 'setFalloNota', 'setFalloSnapshot', 'setRendicion',
  'motivoNoEscribir'];

const SNAP = { id: 'S46-2026', semana: 46, año: 2026, avancePonderado: 37.4 };

const cerrar = async (tipoSnapshot, { contesta = { ok: true, data: { ok: true, roles: ['director_obras'], destinatarios: ['dir@coatza.gob.mx'], constancia: true } } } = {}) => {
  const visto = { llamadas: [], estado: null, rendicion: undefined, snapshots: [] };
  const dobles = {
    callFn: async (nombre, data) => { visto.llamadas.push({ nombre, data }); return contesta; },
    fsSetA: async () => true,
    crearSnapshotAvance: async () => SNAP,
  };
  const nombres = Object.keys(dobles);
  const props = {
    obra: { id: '0112', nombre: 'Malecón' },
    subs: [{ id: 'p1', sec: '1.1', sub: 'Terracerías', imp: 100000, a: 40 }],
    maquinaria: [], materiales: [],
    usuario: { uid: 'u-sup', rol: 'supervisor_obra', tipo: 'dependencia',
      correo: LAURA.correo, nombre: 'Laura Méndez' },
    estimaciones: [], estCargadas: true,
    onSaved: () => {}, onHistorialNuevo: (s) => visto.snapshots.push(s),
    onGuardarNota: async () => true, quedo: { captura: false },
    setEstado: (v) => { visto.estado = v; },
    setFalloNota: () => {}, setFalloSnapshot: () => {},
    setRendicion: (v) => { visto.rendicion = v; },
    motivoNoEscribir: null,
  };
  const guardar = new Function(...nombres, 'console', '__p', `"use strict";
${cuerpoApp}
const { ${PROPS.join(', ')} } = __p;
${fuenteGuardar}
return guardar;`)(...nombres.map(n => dobles[n]), console, props);
  await guardar(tipoSnapshot, null);
  return visto;
};
{
  const v = await cerrar('oficial');
  check(v.estado === 'saved', 'el cierre oficial se consuma', String(v.estado));
  const l = v.llamadas.filter(x => x.nombre === 'rendirCierreSemanal');
  check(l.length === 1, 'y llama a `rendirCierreSemanal` exactamente una vez',
    v.llamadas.map(x => x.nombre).join(' · ') || 'NINGUNA LLAMADA');
  const d = (l[0] || {}).data || {};
  // Lo que le pasa. Si la clave no fuera la del snapshot, la constancia se
  // guardaría bajo una semana que no es la que cerró.
  check(d.obraId === '0112' && d.clave === SNAP.id,
    'con la obra y la clave de la semana que acaba de cerrar',
    `obraId=${d.obraId} clave=${d.clave}`);
  check(d.semana === 46 && d.avance === 37.4,
    'y con la semana y el avance que van en el aviso',
    `semana=${d.semana} avance=${d.avance}`);
  // Y lo que NO le pasa: el `orgId`. Mandarlo sería ofrecerle al cliente la
  // elección de padrón que la función se niega a aceptar.
  check(d.orgId === undefined && d.tipo === undefined,
    'y sin `orgId` ni `tipo`: eso sale del claim, no de la pantalla',
    Object.keys(d).join(' · '));
  check(v.rendicion && v.rendicion.ok === true
        && (v.rendicion.destinatarios || []).includes('dir@coatza.gob.mx'),
    'la pantalla pinta lo que la función contestó', JSON.stringify(v.rendicion));
}
{
  // La función no responde —no desplegada, sin red, sesión vencida—. `callFn`
  // no lanza: contesta `{ok:false}`, y eso es el caso «el cierre quedó y el
  // aviso no salió». Lo que no puede pasar es que se pinte como rendido.
  const v = await cerrar('oficial', { contesta: { ok: false, code: 'not-found' } });
  check(v.estado === 'saved', 'una función que no contesta no deshace el cierre',
    String(v.estado));
  check(v.rendicion && v.rendicion.ok === false,
    'y la pantalla lo pinta como aviso que no salió, no como rendición',
    JSON.stringify(v.rendicion));
  const f = appPiezas().fraseDeRendicion(v.rendicion);
  check(!!f && f.tono === 'fallo', 'con la frase del fallo', f ? f.tono : 'SIN FRASE');
}
{
  // Un guardado intermedio no rinde nada. Se guarda varias veces al día;
  // avisar de cada uno enseña a ignorar el aviso.
  const v = await cerrar('intermedio');
  check(v.estado === 'saved', 'el punto intermedio se guarda');
  check(v.llamadas.length === 0, 'y no llama a la función ni una vez',
    v.llamadas.map(x => x.nombre).join(' · ') || 'ninguna');
  check(v.rendicion === undefined, 'ni pinta una rendición que no hubo',
    JSON.stringify(v.rendicion));
}

console.log(fallas === 0
  ? '\nEl cierre semanal llega al mando de quien lo cerró, y el expediente dice a quién.'
  : `\n${fallas} comprobación(es) en rojo.`);
if (fallas) process.exit(1);

// ════════════════════════════════════════════════════════════════════════════
// CONTRAPRUEBA
// ════════════════════════════════════════════════════════════════════════════
//
// En dos tandas, una por archivo: la conducta vive en los dos lados y el
// corredor muta un archivo a la vez. El corredor es el del repositorio
// (`scripts/contraprueba.cjs`): revisa los anclajes SIEMPRE —también en el
// arranque normal, que es lo que atrapa el anclaje rancio en `npm test`— y
// lanza los procesos hijos sólo a pedido.
const CP = require('./contraprueba.cjs');

const MUTANTES_FUNCS = [
  // ── LAS DOS TABLAS ───────────────────────────────────────────────────────
  { titulo: 'el cierre del municipio vuelve a avisar a los cuatro roles de constructora',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],\n};',
               '  dependencia: ["director_general", "director_operaciones", "gerente_construccion", "admin_sistema"],\n};']] },
  { titulo: 'un rol que no existe en dependencia se cuela en la lista de destinos',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],\n};',
               '  dependencia: ["director_obras", "subdirector", "gerente_construccion"],\n};']] },
  { titulo: 'el municipio se queda sin destinatarios y nadie lo nota',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],\n};',
               '  dependencia: [],\n};']] },
  { titulo: 'el parte interno del municipio le llega al contratista',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],\n};',
               '  dependencia: ["director_obras", "subdirector", "jefe_supervision", "contratista"],\n};']] },
  { titulo: 'el cierre circula de lado: le llega a los supervisores, que son pares',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],\n};',
               '  dependencia: ["director_obras", "subdirector", "jefe_supervision", "supervisor_obra"],\n};']] },
  { titulo: 'la tabla de quién cierra se desincroniza de PERMISOS y abre un permiso',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision", "supervisor_obra",\n    "administrativo"],',
               '  dependencia: ["director_obras", "subdirector", "jefe_supervision", "supervisor_obra",\n    "administrativo", "contralor"],']] },
  { titulo: 'y al revés: se desincroniza por defecto y una supervisora no puede rendir',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision", "supervisor_obra",\n    "administrativo"],',
               '  dependencia: ["director_obras", "subdirector", "jefe_supervision",\n    "administrativo"],']] },

  // ── A QUIÉN NO, Y DE QUÉ ORGANIZACIÓN ────────────────────────────────────
  { titulo: 'el aviso se manda a toda la organización y deja de leerse',
    cambios: [['    .filter((u) => roles.includes(u.rol) && u.activo !== false && u.uid\n      && String(u.correo || u.email || "").toLowerCase() !== correo);',
               '    .filter((u) => u.uid);']] },
  { titulo: 'los usuarios dados de baja vuelven a recibir avisos',
    cambios: [['roles.includes(u.rol) && u.activo !== false && u.uid',
               'roles.includes(u.rol) && u.uid']] },
  { titulo: 'quien cierra la semana vuelve a extenderse el acuse a sí mismo',
    cambios: [['      && String(u.correo || u.email || "").toLowerCase() !== correo);', ');']] },
  { titulo: 'la consulta deja de filtrar por organización y el cierre se fuga al municipio vecino',
    cambios: [['const padron = await db.collection("usuarios").where("orgId", "==", orgId).get();',
               'const padron = await db.collection("usuarios").get();']] },
  { titulo: 'el `orgId` se toma de la petición y el cliente elige a qué padrón entrar',
    cambios: [['  const orgId = request.auth.token.orgId;',
               '  const orgId = request.data.orgId || request.auth.token.orgId;']] },
  { titulo: 'el `tipo` se toma de la petición y el cliente elige a qué mandos avisar',
    cambios: [['  const tipo = request.auth.token.tipo;',
               '  const tipo = request.data.tipo || request.auth.token.tipo;']] },

  // ── LAS NEGATIVAS ────────────────────────────────────────────────────────
  { titulo: 'un `onCall` sin sesión reparte el cierre',
    cambios: [['  if (!request.auth) {\n    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");\n  }\n'
               + '  const correo = String(request.auth.token.email || "").toLowerCase();\n'
               + '  if (!correo) throw new HttpsError("unauthenticated", "Token sin email.");',
               '  if (!request.auth) { request.auth = { token: { email: "cualquiera@nadie.mx" } }; }\n'
               + '  const correo = String(request.auth.token.email || "").toLowerCase();']] },
  { titulo: 'se rinde sin decir qué obra ni qué semana',
    cambios: [['  if (!obraId || !clave) {\n    throw new HttpsError("invalid-argument", "Falta la obra o la semana que se cerró.");\n  }',
               '']] },
  { titulo: 'un usuario dado de baja sigue rindiendo con su token viejo',
    cambios: [['  if (!perfil || perfil.activo === false) {',
               '  if (!perfil && false) {']] },
  { titulo: 'un rol que no captura avance puede anunciar un cierre que nadie hizo',
    cambios: [['  if (!(QUIEN_CIERRA[tipo] || []).includes(perfil.rol)) {',
               '  if (false) {']] },
  // Ésta es la que faltaba el 2026-11-16: la ruta tecleada bajo `orgs/` deja la
  // función correcta para el municipio y muerta para toda constructora.
  { titulo: 'la ruta de la obra se teclea bajo `orgs/` y la constructora deja de existir',
    cambios: [['  const rutaObra = `${rutaObrasDeOrg(orgId, tipo)}/${obraId}`;',
               '  const rutaObra = `orgs/${orgId}/obras/${obraId}`;']] },
  { titulo: 'y al revés: se teclea en la raíz y la que deja de existir es la obra del municipio',
    cambios: [['  const rutaObra = `${rutaObrasDeOrg(orgId, tipo)}/${obraId}`;',
               '  const rutaObra = `obras/${obraId}`;']] },
  { titulo: 'se rinde una obra que no existe en su organización',
    cambios: [['  if (!obraSnap.exists) {\n    throw new HttpsError("not-found", "Esa obra no existe en tu organización.");\n  }',
               '']] },
  { titulo: 'se rinde una obra de su organización que no le asignaron',
    cambios: [['  if (!ROLES_TODAS_OBRAS.has(perfil.rol)) {', '  if (false) {']] },
  { titulo: 'quien ve todas las obras deja de poder rendir las que no tiene asignadas',
    cambios: [['  if (!ROLES_TODAS_OBRAS.has(perfil.rol)) {', '  if (true) {']] },

  // ── LA CONSTANCIA ────────────────────────────────────────────────────────
  { titulo: 'el cierre deja de dejar constancia de a quién se rindió',
    cambios: [['    await db.doc(`${rutaObra}/avance/rendiciones`).set({',
               '    if (false) await db.doc(`${rutaObra}/avance/rendiciones`).set({']] },
  { titulo: 'la constancia se escribe ANTES del aviso, y afirma lo que todavía no ocurrió',
    cambios: [['  const lote = db.batch();',
               '  await db.doc(`${rutaObra}/avance/rendiciones`).set(\n'
               + '    { rendiciones: { [clave]: { a: ["antes@de.saber"] } } }, { merge: true });\n'
               + '  const lote = db.batch();']] },
  { titulo: 'la constancia se guarda dentro del snapshot, que se recorta a 52 semanas',
    cambios: [['await db.doc(`${rutaObra}/avance/rendiciones`).set({',
               'await db.doc(`${rutaObra}/avance/historial`).set({']] },
  { titulo: 'la constancia pisa la de la semana anterior',
    cambios: [['    }, { merge: true });', '    });']] },
  { titulo: 'la constancia no dice a quién, sólo que hubo',
    cambios: [['          a: destinatarios,', '          a: [],']] },
  { titulo: 'la constancia no dice cuándo',
    cambios: [['          en: new Date().toISOString(),', '          en: null,']] },
  { titulo: 'la constancia no dice quién rindió',
    cambios: [['          porQuien: correo,\n          rol: perfil.rol,',
               '          porQuien: null,\n          rol: null,']] },
  { titulo: 'la constancia no dice qué roles se buscaron, y una lista vacía deja de leerse',
    cambios: [['          roles,\n          porQuien: correo,', '          roles: [],\n          porQuien: correo,']] },
  { titulo: 'una constancia que rebotó se anuncia como rendición cumplida',
    cambios: [['    constancia = false;', '    constancia = true;']] },
  { titulo: 'una constancia que rebota tira el aviso que ya había salido',
    cambios: [['  } catch (e) {\n    // El aviso ya salió y no se deshace.', '  } catch (e) {\n    throw e;\n    // El aviso ya salió y no se deshace.']] },
  { titulo: 'se escribe constancia aunque no hubiera a quién rendirle',
    cambios: [['    return { ok: true, roles, destinatarios: [], constancia: null };', '']] },
  { titulo: 'la constancia vuelve a nombrar `uid`s en vez de correos',
    cambios: [['  const destinatarios = gente.map((u) => u.correo || u.email);',
               '  const destinatarios = gente.map((u) => u.email || u.uid);']] },

  // ── EL AVISO ─────────────────────────────────────────────────────────────
  { titulo: 'el aviso deja de decir qué semana cerró',
    cambios: [['  const titulo = `Cierre semanal${semana ? ` S${semana}` : ""} · ${obraNombre || obraId}`;',
               '  const titulo = `Cierre semanal · ${obraNombre || obraId}`;']] },
  { titulo: 'el aviso deja de decir cuánto avance',
    cambios: [['  const mensaje = `Avance: ${Number(avance || 0).toFixed(1)}% · ${perfil.nombre || correo} cerró el reporte`;',
               '  const mensaje = `${perfil.nombre || correo} cerró el reporte`;']] },
  { titulo: 'el aviso no lleva a la obra',
    cambios: [['      link: { tab: "operacion", subTab: "avance", obraId },',
               '      link: { tab: "operacion", subTab: "avance" },']] },
  { titulo: 'la marca de tiempo del aviso vuelve al namespace que el emulador pierde',
    cambios: [['      fecha: FieldValue.serverTimestamp(),\n      creadaPor: correo,',
               '      fecha: admin.firestore.FieldValue.serverTimestamp(),\n      creadaPor: correo,']] },
];

const MUTANTES_APP = [
  { titulo: 'el cierre oficial deja de llamar a la función y no rinde nada',
    cambios: [['        const r = await callFn(\'rendirCierreSemanal\', {',
               '        const r = { ok: true, data: { ok: true, roles: [], destinatarios: [] } };\n        const _ = await callFn(\'nada\', {']] },
  { titulo: 'un guardado intermedio empieza a rendir el cierre cada vez',
    cambios: [['      if (tipoSnapshot === "oficial" && snap) {', '      if (snap) {']] },
  { titulo: 'la pantalla no se entera de cómo salió la rendición',
    cambios: [['        setRendicion(r.ok ? r.data : { ok: false, roles: [], destinatarios: [] });',
               '        setRendicion(null);']] },
  { titulo: 'una función que no contestó se pinta como cierre rendido',
    cambios: [['        setRendicion(r.ok ? r.data : { ok: false, roles: [], destinatarios: [] });',
               '        setRendicion(r.data || { ok: true, roles: [], destinatarios: [] });']] },
  { titulo: 'la constancia se pide bajo una semana que no es la que cerró',
    cambios: [['          obraId: obra.id, clave: snap.id, obraNombre: obra.nombre || obra.id,',
               '          obraId: obra.id, clave: \'S01-2026\', obraNombre: obra.nombre || obra.id,']] },
  { titulo: 'el aviso se queda sin la semana y el avance que lo hacen legible',
    cambios: [['          semana: snap.semana, avance: snap.avancePonderado,', '']] },
  { titulo: 'la pantalla le dicta a la función en qué organización rendir',
    cambios: [['          semana: snap.semana, avance: snap.avancePonderado,',
               '          semana: snap.semana, avance: snap.avancePonderado,\n          orgId: usuario?.orgId, tipo: usuario?.tipo,']] },
  { titulo: 'no haber tenido a quién rendirle se ve igual que haber rendido',
    cambios: [["  if (!(r.destinatarios || []).length) return { tono: 'hueco',",
               "  if (false) return { tono: 'hueco',"]] },
  { titulo: 'un aviso que no salió se ve igual que uno que sí',
    cambios: [["  if (!r.ok) return { tono: 'fallo',", "  if (false) return { tono: 'fallo',"]] },
  { titulo: 'una constancia que rebotó se anuncia como rendición cumplida',
    cambios: [["  if (r.constancia === false) return { tono: 'sin-constancia',",
               "  if (false) return { tono: 'sin-constancia',"]] },
  { titulo: 'la frase del hueco deja de nombrar los roles que se buscaron',
    cambios: [["         + `hay nadie activo con el rol de ${roles || 'mando'}.` };",
               '         + `hay nadie activo con el rol de mando.` };']] },
];

// La revisión barata corre SIEMPRE, menos cuando este proceso ES un mutante:
// ahí los anclajes faltan a propósito y exigirlos sería NO ARRANCÓ por diseño.
if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES_FUNCS, srcFuncs, { archivo: ARCH_FUNCS });
  CP.exigirAnclajes(MUTANTES_APP, srcApp, { archivo: ARCH_APP });
}

if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba · functions/index.js ────────────────────────');
  const s1 = CP.correr({
    mutaciones: MUTANTES_FUNCS, src: srcFuncs, archivo: ARCH_FUNCS,
    prefijo: 'rinde-funcs-',
    comoCorrer: (ruta) => ({ env: { ARCHIVO_FUNCS: ruta } }),
  });
  console.log('\n── contraprueba · src/App.jsx ──────────────────────────────');
  const s2 = CP.correr({
    mutaciones: MUTANTES_APP, src: srcApp, archivo: ARCH_APP,
    prefijo: 'rinde-app-',
    comoCorrer: (ruta) => ({ env: { ARCHIVO_APP: ruta } }),
  });
  process.exit(CP.veredicto(s1 + s2, MUTANTES_FUNCS.length + MUTANTES_APP.length));
}

process.exit(0);

})();
