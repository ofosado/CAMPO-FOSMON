#!/usr/bin/env node
// Prueba: el cierre semanal se le rinde a quien responde por la obra EN LA
// ORGANIZACIÓN QUE LO CERRÓ, y queda constancia de a quién — o se dice que no
// la hubo.
//
// ── EL DEFECTO ─────────────────────────────────────────────────────────────
//
// `GuardarAvanceBtn.guardar`, el único sitio de todo el repositorio que avisa
// de un cierre semanal, llamaba a `notifARoles` con cuatro nombres tecleados:
// `director_general`, `director_operaciones`, `gerente_construccion` y
// `admin_sistema`. Los cuatro son roles de constructora. NINGUNO existe en
// `ROLES_POR_TIPO.dependencia`.
//
// Un supervisor del municipio puede cerrar la semana —`supervisor_obra` tiene
// `captura: "editar"` en `PERMISOS`—, y cuando lo hacía, `notifARoles` cruzaba
// esos cuatro nombres contra los usuarios de SU organización, no encontraba a
// nadie, y mandaba cero avisos. No fallaba: callaba. La pantalla decía
// «Guardado» igual, y el Director de Obras —que es quien firma la
// corresponsabilidad del art. 73 de la Ley 233— no se enteraba de un solo
// cierre.
//
// El segundo defecto es del mismo origen y peor: `notifARoles` devolvía
// `undefined` en las tres salidas —salió, no había a quién, no se pudo— y
// `crearNotifPara` devolvía `undefined` tanto al confirmar como al fallar. Con
// eso no hay manera de dejar constancia honesta de una rendición: cualquier
// constancia que se escribiera afirmaría algo que el código no sabe.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
//
// No que exista `ROLES_QUE_SE_ENTERAN_DEL_CIERRE`. EXTRAE de `src/App.jsx` el
// `guardar` de verdad y lo EJECUTA sobre un Firestore de mentira poblado con
// usuarios de dos organizaciones, y después mira dos cosas: a qué buzones
// llegaron avisos, y qué quedó escrito en el documento de rendiciones.
//
// La §1 es la que habría salido roja antes del arreglo: cruza las dos listas
// de destinatarios contra `ROLES_POR_TIPO` del tipo al que dicen pertenecer. Un
// rol que no existe en su tipo no avisa a nadie mientras aparenta avisar, y eso
// es indistinguible de una organización sin mandos — por eso hace falta la §5,
// que separa las dos.
//
// Uso:  node scripts/prueba-a-quien-se-le-rinde-la-semana.cjs [archivo]
//
// El argumento opcional corre el banco contra una copia mutilada, que es cómo
// se comprueba que de verdad sale ROJO (1). `--contraprueba` lo hace solo.

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');

// El fuente se toma del primer argumento que NO sea una bandera: pasarle
// `--contraprueba` a `readFileSync` sale NO ARRANCÓ con un ENOENT, y eso no es
// una medición. Y se usa `fuenteDe(archivo, …)` y no `fuenteDeApp`, porque
// `fuenteDeApp` lee siempre `src/App.jsx` y un mutante pasado por `argv`
// no afectaría a nada de nivel de módulo: la contraprueba saldría verde
// midiendo el código bueno.
const archivo = process.argv.slice(2).find(a => !a.startsWith('--'))
  || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');

// ── Extracción ──────────────────────────────────────────────────────────────

// Lo de nivel de módulo se pide por nombre y el cierre transitivo lo resuelve
// `fuenteDe`. Tener aquí la lista de dependencias tecleada sería una segunda
// copia del grafo, y las copias se desincronizan.
const PEDIDOS = ['quienSeEnteraDelCierre', 'ROLES_QUE_SE_ENTERAN_DEL_CIERRE',
  'ROLES_POR_TIPO', 'ROL_LABEL', 'can', 'notifARoles', 'crearNotifPara',
  'guardarRendicionDelCierre', 'fraseDeRendicion', 'snapshotId'];

// Lo que `guardar` usa del nivel de módulo y NO es lo que se mide aquí. Va al
// cuerpo real, sin doblar: un doble en medio del camino dejaría de recorrerlo.
// Si `guardar` empieza a usar algo nuevo de nivel de módulo, este banco
// revienta con NO ARRANCÓ (2) nombrándolo, que es lo correcto —la conducta se
// quedó sin medir— y no un rojo.
const APOYO = ['ErrorSnapshot', 'mensajeFalloSnapshot', 'corteDeEstimaciones',
  'importeCatalogoPartida', 'seSuscribe', 'soloCatalogo', 'soloExtraordinarias'];

// Lo que se deja FUERA del cuerpo para poder inyectar el doble. Si se declarara
// dentro, la declaración de verdad pisaría al doble —o reventaría por
// declaración duplicada— y el banco mediría la nube de producción.
//   · `fbDb` y `docObra`: el Firestore de mentira.
//   · `fsSetA` y `crearSnapshotAvance`: el guardado del avance y el snapshot.
//     No son lo que se mide aquí, y arrastrarían medio archivo.
const EXCLUIR = ['fbDb', 'docObra', 'fsSetA', 'crearSnapshotAvance'];

let cuerpo;
try {
  cuerpo = fuenteDe(archivo, [...PEDIDOS, ...APOYO], { excluir: EXCLUIR }).cuerpo;
} catch (e) {
  if (!(e instanceof SimboloPerdido)) throw e;
  console.error(e.message);
  console.error('\nSi el aviso del cierre semanal se reescribió, este banco hay que');
  console.error('rehacerlo contra el camino nuevo, no borrarlo: lo que afirma —que el');
  console.error('cierre llegue al mando de la organización que cerró— sigue siendo cierto.');
  process.exit(1);
}

// `guardar` vive DENTRO de `GuardarAvanceBtn` y es el único sitio que notifica
// un cierre. Se saca por AST y se ejecuta entero: es la diferencia entre
// afirmar que el cable está conectado y recorrerlo.
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
let fuenteGuardar = null;
traverse(ast, {
  Function(p) {
    if (!p.node.id || p.node.id.name !== 'guardar' || fuenteGuardar) return;
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn || fn.node.id.name !== 'GuardarAvanceBtn') return;
    fuenteGuardar = src.slice(p.node.start, p.node.end);
  },
});
if (!fuenteGuardar) {
  console.error('No se encontró `GuardarAvanceBtn.guardar` en ' + archivo + '.');
  console.error('Es el único sitio que avisa de un cierre semanal; si se movió, este');
  console.error('banco hay que apuntarlo al sitio nuevo.');
  process.exit(1);
}

// ── El mundo de mentira ─────────────────────────────────────────────────────
//
// Dos organizaciones en la misma colección raíz `usuarios`, que es como está en
// producción. La consulta de `notifARoles` filtra por `orgId`; aquí el doble de
// `getDocs` RESPETA ese filtro, porque si lo ignorara el banco no podría ver la
// fuga de una organización a otra.
//
// EL CORREO VA EN `correo`, no en `email`, porque así está en el documento de
// usuario de Firestore. Medido en el emulador el 2026-11-16: de 9 usuarios
// sembrados, 9 tienen `correo` y ninguno `email`. Sembrar aquí `email` —que es
// lo que el banco hacía la primera vez— verificaba una forma que no existe, y
// dejaba pasar una constancia que nombraba `uid`s.
const USUARIOS = [
  // Ayuntamiento de Coatzacoalcos — dependencia
  { orgId: 'coatza', uid: 'u-dirobras', rol: 'director_obras', correo: 'dir@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-subdir', rol: 'subdirector', correo: 'sub@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-jefesup', rol: 'jefe_supervision', correo: 'jefe@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-sup', rol: 'supervisor_obra', correo: 'sup@coatza.gob.mx' },
  // Un SEGUNDO supervisor, y está aquí por una razón: con uno solo, «no se le
  // rinde al que cerró» y «no se le rinde a un par» son la misma frase, y meter
  // `supervisor_obra` en la lista de destinos no se notaba en ninguna parte. Con
  // dos, el aviso al par aparece como lo que es: un cierre que circula de lado
  // y no hacia arriba, y que no descarga la corresponsabilidad del art. 73.
  { orgId: 'coatza', uid: 'u-sup2', rol: 'supervisor_obra', correo: 'sup2@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-contralor', rol: 'contralor', correo: 'contraloria@coatza.gob.mx' },
  { orgId: 'coatza', uid: 'u-contratista', rol: 'contratista', correo: 'ventas@constructora.mx' },
  { orgId: 'coatza', uid: 'u-jefe-baja', rol: 'jefe_supervision', correo: 'exjefe@coatza.gob.mx',
    activo: false },
  // FOSMON — constructora. Al gerente se le siembra `email` y no `correo`: hay
  // documentos viejos así, y el aviso tiene que seguir nombrándolo.
  { orgId: 'fosmon', uid: 'f-dg', rol: 'director_general', correo: 'dg@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-dop', rol: 'director_operaciones', correo: 'dop@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-gc', rol: 'gerente_construccion', email: 'gerencia@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-admin', rol: 'admin_sistema', correo: 'sistemas@fosmon.mx' },
  { orgId: 'fosmon', uid: 'f-res', rol: 'residente', correo: 'residente@fosmon.mx' },
  // Otro municipio, con un director_obras propio: la fuga que se vigila.
  { orgId: 'minatitlan', uid: 'm-dirobras', rol: 'director_obras', correo: 'dir@minatitlan.gob.mx' },
];

const mundo = (orgId, { usuarios = USUARIOS, rebotaAviso = false,
    rebotaRendicion = false, lecturaRevienta = false } = {}) => {
  const w = {
    orgId,
    store: new Map(),
    buzones: {},          // uid → [payload]
    escrituras: [],       // rutas EN ORDEN: el orden es la mitad del asunto
    errores: [],
  };
  w.orgIdSesion = () => w.orgId;
  w.fbDb = { __falso: true };
  w.collection = (db, ruta) => ({ ruta });
  w.query = (col, ...cond) => ({ col, cond });
  w.where = (campo, op, valor) => ({ campo, op, valor });
  w.doc = (algo) => (algo && algo.ruta
    ? { ruta: `${algo.ruta}/auto-${Math.random().toString(36).slice(2, 8)}` }
    : { ruta: String(algo) });
  w.serverTimestamp = () => ({ __servidor: true });
  w.getDocs = async (q) => {
    if (lecturaRevienta) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
    if (q.col.ruta !== 'usuarios') return { docs: [] };
    const filtros = (q.cond || []).filter(c => c && c.campo);
    const pasa = (u) => filtros.every(f => f.op === '==' && u[f.campo] === f.valor);
    return { docs: usuarios.filter(pasa).map(u => ({ data: () => u })) };
  };
  w.writeBatch = () => {
    const puestos = [];
    return {
      set: (ref, data) => puestos.push({ ref, data }),
      commit: async () => {
        if (rebotaAviso) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
        for (const { ref, data } of puestos) {
          const uid = /^notificaciones\/([^/]+)\//.exec(ref.ruta);
          const quien = uid ? uid[1] : ref.ruta;
          (w.buzones[quien] = w.buzones[quien] || []).push(data);
          w.escrituras.push({ ruta: ref.ruta, data });
        }
      },
    };
  };
  // `docObra` de la app resuelve `obras/{id}/…` dentro de la organización. El
  // doble devuelve la ruta ya resuelta, que es lo que el banco necesita leer.
  w.docObra = (...segs) => ({ ruta: `orgs/${w.orgId}/obras/${segs.join('/')}` });
  w.setDoc = async (ref, data) => {
    if (rebotaRendicion) { const e = new Error('permission-denied'); e.code = 'permission-denied'; throw e; }
    const antes = w.store.get(ref.ruta) || {};
    w.store.set(ref.ruta, { ...antes,
      ...data,
      rendiciones: { ...(antes.rendiciones || {}), ...(data.rendiciones || {}) } });
    w.escrituras.push({ ruta: ref.ruta, data });
    return true;
  };
  w.consola = { error: (...a) => w.errores.push(a.map(String).join(' ')), warn: () => {} };
  return w;
};

const DOBLES_FIRESTORE = ['collection', 'query', 'where', 'getDocs', 'writeBatch',
  'doc', 'setDoc', 'serverTimestamp', 'fbDb', 'orgIdSesion', 'docObra'];

// Las piezas de nivel de módulo, construidas sobre el mundo que se le pase.
const piezas = (w, extra = {}) => {
  const d = {};
  for (const n of DOBLES_FIRESTORE) d[n] = w[n];
  Object.assign(d, extra);
  const nombres = Object.keys(d);
  return new Function(...nombres, 'console', `"use strict";
${cuerpo}
return { ${PEDIDOS.join(', ')} };`)(...nombres.map(n => d[n]), w.consola);
};

// ── El cierre de verdad, de punta a punta ───────────────────────────────────
//
// `guardar` se ejecuta con el `notifARoles` y el `guardarRendicionDelCierre`
// REALES encima del Firestore de mentira. Lo único doblado es lo que no se mide
// aquí: la escritura del avance y el snapshot.
const PROPS = ['obra', 'subs', 'maquinaria', 'materiales', 'usuario', 'estimaciones',
  'estCargadas', 'onSaved', 'onHistorialNuevo', 'onGuardarNota', 'quedo',
  'setEstado', 'setFalloNota', 'setFalloSnapshot', 'setRendicion',
  'motivoNoEscribir'];

const cerrar = async (w, usuario, { obra = { id: '0112', nombre: 'Malecón' },
    snap = { id: 'S46-2026', semana: 46, año: 2026, avancePonderado: 37.4 } } = {}) => {
  const pantalla = { estado: null, rendicion: undefined, falloSnapshot: null,
    falloNota: false, snapshots: [] };
  const dobles = {};
  for (const n of DOBLES_FIRESTORE) dobles[n] = w[n];
  dobles.fsSetA = async () => true;
  dobles.crearSnapshotAvance = async () => snap;
  const nombres = Object.keys(dobles);
  const props = {
    obra, subs: [{ id: 'p1', sec: '1.1', sub: 'Terracerías', imp: 100000, a: 40 }],
    maquinaria: [], materiales: [], usuario, estimaciones: [], estCargadas: true,
    onSaved: () => {}, onHistorialNuevo: (s) => pantalla.snapshots.push(s),
    onGuardarNota: async () => true, quedo: { captura: false },
    setEstado: (v) => { pantalla.estado = v; },
    setFalloNota: (v) => { pantalla.falloNota = v; },
    setFalloSnapshot: (v) => { pantalla.falloSnapshot = v; },
    setRendicion: (v) => { pantalla.rendicion = v; },
    motivoNoEscribir: null,
  };
  const guardar = new Function(...nombres, 'console', '__p', `"use strict";
${cuerpo}
const { ${PROPS.join(', ')} } = __p;
${fuenteGuardar}
return guardar;`)(...nombres.map(n => dobles[n]), w.consola, props);
  await guardar('oficial', null);
  return pantalla;
};

const EL_SUPERVISOR = { uid: 'u-sup', rol: 'supervisor_obra', tipo: 'dependencia',
  correo: 'sup@coatza.gob.mx', nombre: 'Supervisor de Obra' };
const EL_RESIDENTE = { uid: 'f-res', rol: 'residente', tipo: 'constructora',
  correo: 'residente@fosmon.mx', nombre: 'Residente' };

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

(async () => {

// ════════════════════════════════════════════════════════════════════════════
console.log('1. Los destinatarios del cierre existen en el tipo de organización que los recibe');
// Ésta es la que habría salido roja antes del arreglo, y la que vuelve a salir
// roja si mañana se renombra un rol en `ROLES_POR_TIPO` y no aquí.
{
  const w = mundo('coatza');
  const fn = piezas(w);

  for (const tipo of ['dependencia', 'constructora']) {
    const destinos = fn.quienSeEnteraDelCierre(tipo);
    const propios = fn.ROLES_POR_TIPO[tipo];
    check(Array.isArray(destinos) && destinos.length > 0,
      `un cierre de ${tipo} tiene a quién rendirse`,
      JSON.stringify(destinos));
    const ajenos = (destinos || []).filter(r => !propios.includes(r));
    check(ajenos.length === 0,
      `y los ${(destinos || []).length} destinatarios de ${tipo} existen en su propia tabla de roles`,
      ajenos.length ? 'AJENOS: ' + ajenos.join(', ') : (destinos || []).join(' · '));
    // Un aviso lleva link a una pantalla. Mandárselo a quien no puede abrirla
    // es ruido con la forma de una rendición.
    const ciegos = (destinos || []).filter(r => !fn.can(r, 'dash', 'ver'));
    check(ciegos.length === 0,
      'y todos pueden abrir la pantalla a la que el aviso lleva',
      ciegos.length ? 'SIN ACCESO: ' + ciegos.join(', ') : 'todos ven el tablero');
    // Y tienen nombre en castellano, porque `fraseDeRendicion` los imprime.
    const anonimos = (destinos || []).filter(r => !fn.ROL_LABEL[r]);
    check(anonimos.length === 0,
      'y tienen rótulo: la frase de la pantalla los nombra',
      anonimos.length ? 'SIN RÓTULO: ' + anonimos.join(', ') : 'todos rotulados');
  }

  // Quien ejecuta la obra no es a quien se le rinde cuentas de ella.
  const dep = fn.quienSeEnteraDelCierre('dependencia');
  check(!dep.includes('contratista'),
    'al contratista NO se le rinde el cierre del municipio: está del otro lado del mostrador',
    dep.join(' · '));
  check(!fn.quienSeEnteraDelCierre('constructora').includes('cliente'),
    'ni al cliente el de la constructora, por lo mismo');
  // Un tipo desconocido no se queda sin avisar a nadie.
  check((fn.quienSeEnteraDelCierre(undefined) || []).length > 0,
    'una sesión sin tipo cae del lado constructora, no en el vacío',
    JSON.stringify(fn.quienSeEnteraDelCierre(undefined)));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. Un cierre del municipio le llega al mando del municipio');
// El recorrido entero: `guardar` de verdad, `notifARoles` de verdad, y los
// buzones que de verdad quedaron escritos.
{
  const w = mundo('coatza');
  const p = await cerrar(w, EL_SUPERVISOR);

  check(p.estado === 'saved', 'el cierre se consuma', String(p.estado));
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
    'ni al propio supervisor que cerró: nadie se rinde cuentas a sí mismo');
  check(!quienes.includes('u-sup2'),
    'ni al otro supervisor: un cierre que circula de lado no se rindió a nadie',
    quienes.join(' · '));
  check(!quienes.includes('u-jefe-baja'),
    'ni a un jefe de supervisión dado de baja',
    quienes.join(' · '));
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
  check(/37\.4/.test(av.mensaje || ''), 'y con cuánto avance',
    av.mensaje || 'SIN MENSAJE');
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
// La §2 no podía verlo: allí cerraba un supervisor, que no está en la lista de
// destinos, así que «no se le avisó al que cerró» salía verde por el rol y no
// por el mecanismo.
{
  const w = mundo('coatza');
  const EL_DIRECTOR = { uid: 'u-dirobras', rol: 'director_obras', tipo: 'dependencia',
    correo: 'dir@coatza.gob.mx', nombre: 'Director de Obras' };
  const p = await cerrar(w, EL_DIRECTOR);

  const quienes = Object.keys(w.buzones).sort();
  check(p.estado === 'saved', 'el cierre se consuma igual', String(p.estado));
  check(!quienes.includes('u-dirobras'),
    'el director que cerró la semana NO recibe el aviso de su propio cierre',
    quienes.join(' · ') || 'NINGÚN BUZÓN');
  check(quienes.includes('u-subdir') && quienes.includes('u-jefesup'),
    'y los otros dos mandos sí: sacar al que cerró no apaga el aviso',
    quienes.join(' · '));

  // Y la constancia tampoco lo nombra: es el documento con el que alguien
  // sostendría que cumplió.
  const rend = (p.rendicion || {});
  const a = rend.destinatarios || [];
  check(!a.includes('dir@coatza.gob.mx'),
    'la constancia no lo nombra entre aquéllos a quienes se rindió',
    a.join(' · ') || 'LISTA VACÍA');
  check(a.length === 2,
    'quedan los dos que de verdad se enteraron, ni uno más',
    `${a.length}: ${a.join(' · ')}`);
  const escrito = w.store.get('orgs/coatza/obras/0112/avance/rendiciones');
  const grabado = ((escrito || {}).rendiciones || {})['S46-2026'] || {};
  check(!(grabado.a || []).includes('dir@coatza.gob.mx'),
    'y el documento escrito en Firestore tampoco',
    JSON.stringify(grabado.a || null));
  check(grabado.porQuien === 'dir@coatza.gob.mx',
    'aunque sí dice que fue él quien rindió: el que firma y los que acusan son listas distintas',
    String(grabado.porQuien));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Un cierre de la constructora sigue llegando a donde llegaba');
// El arreglo mete un corte por tipo donde no había ninguno. Si eso hubiera
// desviado el cierre de la constructora, se cambiaría un defecto por otro.
{
  const w = mundo('fosmon');
  const p = await cerrar(w, EL_RESIDENTE);
  const quienes = Object.keys(w.buzones).sort();
  check(p.estado === 'saved', 'el cierre se consuma');
  check(quienes.includes('f-dg') && quienes.includes('f-dop')
        && quienes.includes('f-gc') && quienes.includes('f-admin'),
    'los cuatro mandos de la constructora siguen recibiendo el cierre',
    quienes.join(' · '));
  // El gerente tiene el correo en `email` y no en `correo`: hay documentos
  // viejos así, y la constancia tiene que nombrarlo igual.
  check((((p.rendicion || {}).destinatarios) || []).includes('gerencia@fosmon.mx'),
    'y un usuario viejo, con el correo en `email`, se nombra igual',
    JSON.stringify((p.rendicion || {}).destinatarios));
  check(!quienes.includes('u-dirobras') && !quienes.includes('m-dirobras'),
    'y ningún municipio recibe el parte interno de la constructora',
    quienes.join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. Queda constancia de a quién se le rindió, y de cuándo');
// Art. 74: el expediente se conserva cinco años. El histórico semanal se
// recorta a 52 semanas, así que la constancia NO puede vivir dentro del
// snapshot — vive en su propio documento.
{
  const w = mundo('coatza');
  await cerrar(w, EL_SUPERVISOR);
  const ruta = 'orgs/coatza/obras/0112/avance/rendiciones';
  const doc = w.store.get(ruta);
  check(!!doc, 'la rendición queda escrita en su propio documento del expediente',
    doc ? ruta : 'NO SE ESCRIBIÓ  ·  ' + [...w.store.keys()].join(', '));
  // La clave se pregunta a `snapshotId`, no se teclea. El banco la tenía
  // escrita como `2026-S46` y la app la escribe `S46-2026`: una comprobación
  // que inventa la forma del dato se comprueba contra sí misma, y ésta en
  // concreto es la que dice que la semana cerrada y su constancia se pueden
  // emparejar dentro de cinco años.
  const clave = piezas(w).snapshotId(46, 2026);
  const r = ((doc || {}).rendiciones || {})[clave];
  check(!!r, `bajo la clave que la app le da a esa semana (${clave})`,
    r ? clave : 'claves: ' + Object.keys((doc || {}).rendiciones || {}).join(', '));
  check(!!r && Array.isArray(r.a) && r.a.includes('dir@coatza.gob.mx'),
    'y dice A QUIÉN, con nombre y apellido, no «se notificó»',
    r ? JSON.stringify(r.a) : 'sin destinatarios');
  check(!!r && r.a.length === 3,
    'a los tres y sólo a los tres', r ? `${r.a.length} destinatario(s)` : '');
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
  check(!!r && r.porQuien === EL_SUPERVISOR.correo && r.rol === 'supervisor_obra',
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
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. Un cierre que no llegó a nadie no se ve igual que uno que sí');
// Las tres salidas de `notifARoles` eran `undefined` las tres. Distinguirlas es
// lo que permite no escribir una constancia falsa, y lo que hace que la
// pantalla diga la verdad.
{
  // (a) Salió.
  {
    const w = mundo('coatza');
    const p = await cerrar(w, EL_SUPERVISOR);
    const f = piezas(w).fraseDeRendicion(p.rendicion);
    check(!!p.rendicion && p.rendicion.ok === true && p.rendicion.destinatarios.length === 3,
      'cuando salió, la pantalla recibe a quién',
      JSON.stringify(p.rendicion));
    check(!!f && f.tono === 'ok' && /dir@coatza\.gob\.mx/.test(f.texto),
      'y lo dice con los correos, en verde', f ? `${f.tono}: ${f.texto}` : 'SIN FRASE');
  }

  // (b) No había a quién: una organización sin mandos de alta. Es un hueco de
  // la organización, no un fallo del sistema, y se lee distinto.
  {
    const soloElSup = USUARIOS.filter(u => u.orgId !== 'coatza'
      || u.rol === 'supervisor_obra');
    const w = mundo('coatza', { usuarios: soloElSup });
    const p = await cerrar(w, EL_SUPERVISOR);
    check(!!p.rendicion && p.rendicion.ok === true
          && p.rendicion.destinatarios.length === 0,
      'sin nadie a quien rendirle, no se reporta un fallo que no hubo',
      JSON.stringify(p.rendicion));
    check(!w.store.get('orgs/coatza/obras/0112/avance/rendiciones'),
      'y NO se escribe una constancia que diga que se rindió a nadie',
      w.store.get('orgs/coatza/obras/0112/avance/rendiciones')
        ? 'LA ESCRIBIÓ' : 'no la escribió');
    const f = piezas(w).fraseDeRendicion(p.rendicion);
    check(!!f && f.tono === 'hueco' && /no hay/i.test(f.texto),
      'y la pantalla dice que no hubo a quién, con los roles que se buscaron',
      f ? f.texto : 'SIN FRASE');
    check(!!f && /Director de Obras/.test(f.texto),
      'en castellano, no con las claves internas', f ? f.texto : '');
    check(p.estado === 'saved',
      'el cierre sí quedó: la falta de destinatarios no lo deshace');
  }

  // (c) No se pudo avisar. El cierre ya está escrito y no se deshace, pero no
  // puede quedar constancia de una rendición que rebotó.
  {
    const w = mundo('coatza', { rebotaAviso: true });
    const p = await cerrar(w, EL_SUPERVISOR);
    check(!!p.rendicion && p.rendicion.ok === false,
      'un aviso que rebota se reporta como fallo', JSON.stringify(p.rendicion));
    // Y la lista va vacía. Devolver a quién se INTENTÓ avisar deja un fallo con
    // la misma forma que un envío logrado para cualquiera que mire la lista sin
    // mirar el `ok` primero.
    check(!!p.rendicion && p.rendicion.destinatarios.length === 0,
      'y no nombra como destinatarios a quienes nunca lo recibieron',
      JSON.stringify(p.rendicion && p.rendicion.destinatarios));
    check(!w.store.get('orgs/coatza/obras/0112/avance/rendiciones'),
      'y el expediente NO afirma una rendición que no salió',
      w.store.get('orgs/coatza/obras/0112/avance/rendiciones')
        ? 'LA ESCRIBIÓ' : 'no la escribió');
    const f = piezas(w).fraseDeRendicion(p.rendicion);
    check(!!f && f.tono === 'fallo' && /no (salió|lo sabe)/.test(f.texto),
      'y la pantalla dice que el cierre quedó pero el aviso no salió',
      f ? f.texto : 'SIN FRASE');
    check(p.estado === 'saved',
      'el cierre no se deshace por un aviso que no salió: recerrar sería peor');
  }

  // (d) La lectura de usuarios revienta. Mismo trato que (c).
  {
    const w = mundo('coatza', { lecturaRevienta: true });
    const p = await cerrar(w, EL_SUPERVISOR);
    check(!!p.rendicion && p.rendicion.ok === false,
      'si ni se pudo leer a quién avisar, tampoco se dice que se rindió',
      JSON.stringify(p.rendicion));
    check(!w.store.get('orgs/coatza/obras/0112/avance/rendiciones'),
      'y no queda constancia');
    check(p.estado === 'saved',
      'y el cierre tampoco se deshace: la semana ya está escrita', String(p.estado));
  }

  // (e) La constancia rebota y el aviso sí salió. Es el único caso donde el
  // expediente se queda corto, y no puede tirar el cierre.
  {
    const w = mundo('coatza', { rebotaRendicion: true });
    const p = await cerrar(w, EL_SUPERVISOR);
    check(p.estado === 'saved',
      'una constancia que rebota no tira el cierre ni el aviso',
      String(p.estado));
    check(Object.keys(w.buzones).length === 3,
      'los avisos ya salieron y no se deshacen',
      Object.keys(w.buzones).join(' · '));
    // Y LA PANTALLA NO PUEDE DECIR «Rendida a …». Esto pasaba de verdad, no en
    // un supuesto: hasta el 2026-11-16 la ruta `avance/rendiciones` no estaba
    // declarada en firestore.rules, así que TODA constancia rebotaba y el
    // cierre se anunciaba rendido con el expediente vacío. Visto en el
    // emulador cerrando como Director de Obras: la caja decía «Rendida a
    // jefesup@… · subdirector@…» y en Firestore no había documento.
    check((p.rendicion || {}).constancia === false,
      'la pantalla se entera de que la constancia no se escribió',
      JSON.stringify((p.rendicion || {}).constancia));
    const fn = piezas(w);
    const f = fn.fraseDeRendicion(p.rendicion) || {};
    check(f.tono !== 'ok',
      'y NO lo pinta como un cierre rendido: el aviso salió, el registro no',
      `${f.tono}: ${f.texto}`);
    check(/constancia/i.test(f.texto || ''),
      'y dice exactamente qué faltó, no un error genérico',
      f.texto || 'SIN TEXTO');
  }

  // (f) Las cuatro frases son distinguibles entre sí. Si dos dijeran lo mismo,
  // la pantalla volvería a tener dos estados que se ven iguales.
  {
    const fn = piezas(mundo('coatza'));
    const t = [
      fn.fraseDeRendicion({ ok: true, roles: ['director_obras'], destinatarios: ['a@b.mx'], constancia: true }),
      fn.fraseDeRendicion({ ok: true, roles: ['director_obras'], destinatarios: [] }),
      fn.fraseDeRendicion({ ok: false, roles: ['director_obras'], destinatarios: [] }),
      fn.fraseDeRendicion({ ok: true, roles: ['director_obras'], destinatarios: ['a@b.mx'], constancia: false }),
    ];
    check(new Set(t.map(x => x.tono)).size === 4, 'las cuatro salidas tienen tono distinto',
      t.map(x => x.tono).join(' · '));
    check(new Set(t.map(x => x.texto)).size === 4, 'y texto distinto',
      t.map(x => x.texto.slice(0, 32)).join(' | '));
    check(fn.fraseDeRendicion(null) === null,
      'y sin cierre reciente no se pinta nada');
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n7. Un guardado intermedio no rinde nada');
// La rendición es del cierre OFICIAL. Un punto intermedio del histórico se
// guarda varias veces al día; avisar de cada uno enseña a ignorar el aviso.
{
  const w = mundo('coatza');
  const pantalla = { estado: null, rendicion: undefined };
  const dobles = {};
  for (const n of DOBLES_FIRESTORE) dobles[n] = w[n];
  dobles.fsSetA = async () => true;
  dobles.crearSnapshotAvance = async () => ({ id: 'S46-2026', semana: 46, año: 2026,
    avancePonderado: 37.4 });
  const nombres = Object.keys(dobles);
  const props = {
    obra: { id: '0112', nombre: 'Malecón' },
    subs: [{ id: 'p1', sec: '1.1', sub: 'Terracerías', imp: 100000, a: 40 }],
    maquinaria: [], materiales: [], usuario: EL_SUPERVISOR, estimaciones: [],
    estCargadas: true, onSaved: () => {}, onHistorialNuevo: () => {},
    onGuardarNota: async () => true, quedo: { captura: false },
    setEstado: (v) => { pantalla.estado = v; }, setFalloNota: () => {},
    setFalloSnapshot: () => {}, setRendicion: (v) => { pantalla.rendicion = v; },
    motivoNoEscribir: null,
  };
  const guardar = new Function(...nombres, 'console', '__p', `"use strict";
${cuerpo}
const { ${PROPS.join(', ')} } = __p;
${fuenteGuardar}
return guardar;`)(...nombres.map(n => dobles[n]), w.consola, props);
  await guardar('intermedio', null);
  check(pantalla.estado === 'saved', 'el punto intermedio se guarda');
  check(Object.keys(w.buzones).length === 0,
    'y no manda un solo aviso', Object.keys(w.buzones).join(' · ') || 'ninguno');
  check(!w.store.get('orgs/coatza/obras/0112/avance/rendiciones'),
    'ni escribe constancia de rendición');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n8. Las dos piezas que devolvían `undefined` ahora contestan');
// `crearNotifPara` devolvía `undefined` al confirmar y al fallar. Encima de eso
// no se puede construir ninguna constancia honesta.
{
  // «No lanza» es la mitad de lo que se afirma aquí, así que una excepción
  // tiene que salir ROJA y no reventar el banco: `contesta` la atrapa y la
  // convierte en un valor que ninguna comprobación acepta. Un `throw` que
  // aborta el proceso sería NO ARRANCÓ, y eso deja la conducta sin medir.
  const contesta = async (etiqueta, fn) => {
    try { return await fn(); }
    catch (e) { return `LANZÓ ${etiqueta}: ${e && e.message}`; }
  };

  const w = mundo('coatza');
  const fn = piezas(w);
  const payload = { categoria: 'actividad', tipo: 'cierre_semana', titulo: 'x' };
  const r1 = await contesta('al confirmar',
    () => fn.crearNotifPara(['u-dirobras'], payload));
  check(r1 === true, 'un aviso que salió contesta `true`', String(r1));
  const wMal = mundo('coatza', { rebotaAviso: true });
  const r2 = await contesta('al rebotar',
    () => piezas(wMal).crearNotifPara(['u-dirobras'], payload));
  check(r2 === false, 'y uno que rebotó contesta `false`, no `undefined`', String(r2));

  // La constancia no lanza: el cierre ya está escrito y una excepción aquí
  // dispararía el aviso de fallo del snapshot, que diría algo falso.
  const wRebota = mundo('coatza', { rebotaRendicion: true });
  const r3 = await contesta('la constancia', () =>
    piezas(wRebota).guardarRendicionDelCierre('0112', 'S46-2026',
      { a: ['x@y.mx'], roles: ['director_obras'] }));
  check(r3 === false, 'una constancia que rebota contesta `false` y no lanza', String(r3));
  const r4 = await contesta('sin obra',
    () => fn.guardarRendicionDelCierre('', 'S46-2026', {}));
  check(r4 === false, 'y sin obra no escribe en `obras//avance/rendiciones`', String(r4));
}

console.log(fallas === 0
  ? '\nEl cierre semanal llega al mando de quien lo cerró, y el expediente dice a quién.'
  : `\n${fallas} comprobación(es) en rojo.`);
if (fallas) process.exit(1);

// ════════════════════════════════════════════════════════════════════════════
// CONTRAPRUEBA
// ════════════════════════════════════════════════════════════════════════════
//
// El corredor es el del repositorio (`scripts/contraprueba.cjs`): revisa los
// anclajes SIEMPRE —también en el arranque normal, que es lo que atrapa el
// anclaje rancio en `npm test`— y lanza los procesos hijos sólo a pedido.
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  // ── EL DEFECTO, tal como estaba ──────────────────────────────────────────
  { titulo: 'el cierre del municipio vuelve a avisar a los cuatro roles de constructora',
    cambios: [['const quienSeEnteraDelCierre = (tipo) => ROLES_QUE_SE_ENTERAN_DEL_CIERRE[\n  tipo === "dependencia" ? "dependencia" : "constructora"];',
               'const quienSeEnteraDelCierre = (tipo) => ROLES_QUE_SE_ENTERAN_DEL_CIERRE.constructora;']] },
  { titulo: 'el aviso del cierre vuelve a llevar la lista tecleada en el sitio de la llamada',
    cambios: [['        const rend = await notifARoles(quienSeEnteraDelCierre(usuario?.tipo), {',
               "        const rend = await notifARoles(['director_general','director_operaciones','gerente_construccion','admin_sistema'], {"]] },
  { titulo: 'un rol que no existe en dependencia se cuela en la lista',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],',
               '  dependencia: ["director_obras", "subdirector", "gerente_construccion"],']] },
  { titulo: 'el municipio se queda sin destinatarios y nadie lo nota',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],',
               '  dependencia: [],']] },

  // ── A QUIÉN NO ───────────────────────────────────────────────────────────
  { titulo: 'el parte interno del municipio le llega al contratista',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],',
               '  dependencia: ["director_obras", "subdirector", "jefe_supervision", "contratista"],']] },
  { titulo: 'el aviso se manda a toda la organización y deja de leerse',
    cambios: [['      .filter(u => roles.includes(u.rol) && u.activo !== false && u.uid\n                   && u.uid !== excepto);',
               '      .filter(u => u.uid);']] },
  { titulo: 'los usuarios dados de baja vuelven a recibir avisos',
    cambios: [['u.activo !== false && u.uid\n                   && u.uid !== excepto);',
               'u.uid\n                   && u.uid !== excepto);']] },
  { titulo: 'la consulta deja de filtrar por organización y el cierre se fuga al municipio vecino',
    cambios: [["    const q = query(collection(fbDb, 'usuarios'), where('orgId', '==', orgIdSesion()));",
               "    const q = query(collection(fbDb, 'usuarios'));"]] },
  { titulo: 'el cierre circula de lado: le llega a los supervisores, que son pares',
    cambios: [['  dependencia: ["director_obras", "subdirector", "jefe_supervision"],',
               '  dependencia: ["director_obras", "subdirector", "jefe_supervision", "supervisor_obra"],']] },
  { titulo: 'quien cierra la semana vuelve a extenderse el acuse a sí mismo',
    cambios: [['u.activo !== false && u.uid\n                   && u.uid !== excepto);',
               'u.activo !== false && u.uid);']] },
  { titulo: 'el cierre deja de decir a quién no hace falta avisarle',
    cambios: [['        }, { excepto: usuario?.uid || null });',
               '        });']] },

  // ── LA CONSTANCIA ────────────────────────────────────────────────────────
  { titulo: 'el cierre deja de dejar constancia de a quién se rindió',
    cambios: [['        if (rend.ok && rend.destinatarios.length) {\n          constancia = await guardarRendicionDelCierre(',
               '        if (false) {\n          constancia = await guardarRendicionDelCierre(']] },
  { titulo: 'una constancia que rebotó se anuncia como rendición cumplida',
    cambios: [["  if (r.constancia === false) return { tono: 'sin-constancia',",
               "  if (false) return { tono: 'sin-constancia',"]] },
  { titulo: 'la pantalla no se entera de si la constancia se escribió',
    cambios: [['          constancia = await guardarRendicionDelCierre(',
               '          await guardarRendicionDelCierre(']] },
  { titulo: 'el expediente afirma una rendición cuando el aviso rebotó',
    cambios: [['        if (rend.ok && rend.destinatarios.length) {',
               '        if (true) {']] },
  { titulo: 'la constancia no dice a quién, sólo que hubo',
    cambios: [['            a: rend.destinatarios, roles: rend.roles,',
               '            a: [], roles: rend.roles,']] },
  { titulo: 'la constancia no dice cuándo',
    cambios: [["      rendiciones: { [clave]: {\n        en: new Date().toISOString(),",
               "      rendiciones: { [clave]: {\n        en: null,"]] },
  { titulo: 'la constancia no dice quién rindió',
    cambios: [['            porQuien: usuario?.correo || null, rol: usuario?.rol || null });',
               '            porQuien: null, rol: null });']] },
  { titulo: 'la constancia se escribe ANTES del aviso, y afirma lo que todavía no ocurrió',
    cambios: [['        const rend = await notifARoles(quienSeEnteraDelCierre(usuario?.tipo), {',
               '        await guardarRendicionDelCierre(obra.id, snap.id, { a: ["antes@de.saber"], roles: [] });\n'
               + '        const rend = await notifARoles(quienSeEnteraDelCierre(usuario?.tipo), {']] },
  { titulo: 'la constancia se guarda dentro del snapshot, que se recorta a 52 semanas',
    cambios: [["    await setDoc(docObra(obraId, 'avance', 'rendiciones'), {",
               "    await setDoc(docObra(obraId, 'avance', 'historial'), {"]] },

  // ── LAS TRES SALIDAS, QUE ANTES ERAN UNA ─────────────────────────────────
  { titulo: 'un aviso que rebotó vuelve a reportarse como salido',
    cambios: [['      : await crearNotifPara(gente.map(u => u.uid), payload) !== false;',
               '      : true;']] },
  { titulo: '`crearNotifPara` vuelve a devolver `undefined` al fallar',
    cambios: [["    console.error('crearNotifPara', e);", "    console.error('crearNotifPara', e);\n    return undefined;"]] },
  { titulo: 'un fallo de lectura se reporta como rendición cumplida',
    cambios: [["    console.error('notifARoles', e);\n    return { ok: false, roles, destinatarios: [] };",
               "    console.error('notifARoles', e);\n    return { ok: true, roles, destinatarios: [] };"]] },
  { titulo: 'un aviso que rebotó nombra como destinatarios a quienes no lo recibieron',
    cambios: [['      destinatarios: ok ? gente.map(u => u.correo || u.email || u.uid) : [] };',
               '      destinatarios: gente.map(u => u.correo || u.email || u.uid) };']] },
  // El defecto que pescó el emulador: `email` no existe en el documento de
  // usuario de Firestore, así que esto resolvía al `uid` SIEMPRE.
  { titulo: 'la constancia vuelve a nombrar `uid`s en vez de correos',
    cambios: [['      destinatarios: ok ? gente.map(u => u.correo || u.email || u.uid) : [] };',
               '      destinatarios: ok ? gente.map(u => u.email || u.uid) : [] };']] },
  { titulo: 'no haber tenido a quién rendirle se ve igual que haber rendido',
    cambios: [["  if (!(r.destinatarios || []).length) return { tono: 'hueco',",
               "  if (false) return { tono: 'hueco',"]] },
  { titulo: 'un aviso que no salió se ve igual que uno que sí',
    cambios: [["  if (!r.ok) return { tono: 'fallo',", "  if (false) return { tono: 'fallo',"]] },
  { titulo: 'la pantalla no se entera de cómo salió la rendición',
    cambios: [['        setRendicion({ ...rend, constancia });', '        setRendicion(null);']] },
  { titulo: 'la frase del hueco deja de nombrar los roles que se buscaron',
    cambios: [["         + `hay nadie activo con el rol de ${roles || 'mando'}.` };",
               '         + `hay nadie activo con el rol de mando.` };']] },

  // ── LO QUE YA FUNCIONABA ─────────────────────────────────────────────────
  { titulo: 'un guardado intermedio empieza a avisar del cierre cada vez',
    cambios: [['      if (tipoSnapshot === "oficial" && snap) {', '      if (snap) {']] },
  { titulo: 'un aviso que rebota lanza en vez de contestar',
    cambios: [["    console.error('crearNotifPara', e);\n", "    throw e;\n    console.error('crearNotifPara', e);\n"]] },
  { titulo: 'una constancia que rebota tira el cierre que ya estaba escrito',
    cambios: [["    console.error('guardarRendicionDelCierre', err);\n", "    throw err;\n    console.error('guardarRendicionDelCierre', err);\n"]] },
];

// La revisión barata corre SIEMPRE, menos cuando este proceso ES un mutante:
// ahí los anclajes faltan a propósito y exigirlos sería NO ARRANCÓ por diseño.
if (!process.env.SIN_CONTRAPRUEBA)
  CP.exigirAnclajes(MUTANTES, src, { archivo });

if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const sobrevivieron = CP.correr({
    mutaciones: MUTANTES, src, archivo,
    prefijo: 'a-quien-se-le-rinde-',
    // Este banco recibe el fuente por `argv`, no por `ARCHIVO_APP`.
    comoCorrer: (ruta) => ({ args: [ruta], env: {} }),
  });
  process.exit(CP.veredicto(sobrevivieron, MUTANTES.length));
}

process.exit(0);

})();
