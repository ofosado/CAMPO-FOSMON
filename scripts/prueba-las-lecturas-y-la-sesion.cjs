#!/usr/bin/env node
// El ciclo de vida de las lecturas está atado al de la sesión.
//
// QUÉ SE AFIRMA. Cuatro defectos de una misma naturaleza: la app leía antes de
// tener sesión, seguía leyendo después de perderla, oía obras que no eran del
// usuario, y comparaba los permisos nuevos contra los del login.
//
//   #40 — `useGPConstruct` recibía `!esDependencia(usuario) && !esPlataforma(
//       usuario)`, y los dos cortes son FALSOS con `usuario === null`. Al
//       montar —sin credencial— se pedía `global/gp_construct`: Firestore
//       contesta `permission-denied`, que está clasificado como terminal y no
//       se reintenta, así que el estado quedaba en `'error'`. Después el
//       usuario entraba como constructora y `activo` seguía valiendo `true`:
//       no CAMBIABA, así que el efecto no se rearmaba. La sesión a la que sí
//       le toca el Gasto Programado se pasaba entera con el chip ámbar «Gasto
//       GP · no disponible» por una lectura hecha antes de que hubiera quien
//       la hiciera.
//
//   #6b — no existía `onAuthStateChanged`. A una cuenta deshabilitada, borrada
//       o con el token revocado, la app no se enteraba: la pantalla seguía en
//       pie con todo lo ya leído —obras, montos, avance, nómina— mientras cada
//       lectura nueva rebotaba en las reglas hacia un `console.warn`.
//
//   #62 — la carga a granel levanta nueve oyentes por obra e iteraba las obras
//       ACTIVAS, no las de la sesión. La lista de la pantalla sí filtraba por
//       asignadas; el granel no. Hoy lo tapan las reglas, que es un fallo de
//       permiso por obra y no un acierto de diseño; y deja de taparlo nada en
//       cuanto las asignaciones cambian a media sesión.
//
//   #46 — el aviso «Tus permisos se actualizaron» armaba el «antes» con el
//       `usuario` que el efecto tenía cerrado encima, y ese efecto depende de
//       `[usuario?.emailId]`: no se rearma mientras la sesión sea la misma. A
//       la SEGUNDA modificación de la misma sesión el «antes» seguía siendo el
//       del login, así que el aviso decía mal el rol y mal cuántas obras.
//
// LA FORMA DE AFIRMARLO. Nada se comprueba por nombre ni por cadena. Los nueve
// trozos se SACAN del archivo —el argumento del hook, los tres efectos, el
// desmontaje, el botón de salir, las dos listas de obras y el chip de GP— y se
// EJECUTAN con sus dependencias sustituidas por registradores. El chip además
// se RENDERIZA, porque «no disponible» es lo que el usuario lee.
//
// `--contraprueba` devuelve CADA conducta a su forma vieja, por separado y
// dejando el andamiaje en pie. Cada mutación tiene que poner esto en ROJO.
//
// Uso:  node scripts/prueba-las-lecturas-y-la-sesion.cjs [archivo]
//       node scripts/prueba-las-lecturas-y-la-sesion.cjs --contraprueba

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');

// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const archivo = process.argv.find(a => a.endsWith('.jsx')) || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

// ── Lo que se saca del archivo ─────────────────────────────────────────────
// Casi todo esto vive DENTRO de un componente, así que no hay nombre de nivel
// superior que pedirle a `extraer-de-app`. Se localiza por el SITIO: el
// argumento de la llamada al hook, el efecto que llama a `cargarGP`, el que
// escucha `claimsVersion`, el que registra en Auth. Localizar por sitio y no
// por texto es lo que permite que la contraprueba cambie la conducta sin
// tumbar el banco.
const tajada = n => src.slice(n.start, n.end);
const pieza = {};
traverse(parse(src, { sourceType: 'module', plugins: ['jsx'] }), {
  CallExpression(p) {
    const callee = p.node.callee;
    if (callee.name === 'useGPConstruct' && p.node.arguments.length === 1)
      pieza.argGP ||= tajada(p.node.arguments[0]);
    if (callee.type === 'ArrowFunctionExpression' && p.node.arguments.length === 0) {
      const t = tajada(callee);
      if (/'no disponible'/.test(t) && /_GP_NOTA/.test(t)) pieza.chip ||= t;
    }
    if (callee.name !== 'useEffect') return;
    const fn = p.node.arguments[0];
    if (!fn) return;
    const t = tajada(fn);
    // Por las DEPENDENCIAS, no por el cuerpo. Hay dos efectos que llaman a
    // `cargarGP()` y ponen `setGpEstado` —éste y el vigilante de reintentos—, y
    // el del vigilante aparece antes en el archivo. Mirar el cuerpo tampoco
    // serviría para distinguirlos por el `'sin_sesion'`, porque eso es
    // justamente lo que una de las mutaciones quita: el banco se iría a buscar
    // el vigilante y saldría NO ARRANCÓ donde tiene que salir ROJO.
    const deps = p.node.arguments[1] ? tajada(p.node.arguments[1]) : '';
    if (deps === '[activo, cargarGP]') pieza.efectoGP ||= t;
    if (/claimsVersion/.test(t)) pieza.efectoPerfil ||= t;
    if (/onAuthStateChanged/.test(t)) pieza.efectoAuth ||= t;
    // El `activas` del granel: hay tres `activas` en el archivo y el que
    // importa es el del efecto que levanta oyentes. Se baja por el AST del
    // efecto, no buscando el tercero por orden de aparición.
    if (/seSuscribe/.test(t) && /onSnapshot/.test(t)) {
      p.get('arguments.0').traverse({ VariableDeclarator(q) {
        if (q.node.id.name === 'activas' && q.node.init)
          pieza.activasGranel ||= tajada(q.node.init);
      }});
    }
  },
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    const n = p.node.id.name;
    if (n === 'obrasActivasKey')  pieza.llaveGranel ||= tajada(p.node.init);
    if (n === 'todasObras')       pieza.listaPantalla ||= tajada(p.node.init);
    if (n === 'olvidarSesion')    pieza.olvidar ||= tajada(p.node.init);
    if (n === 'logout')           pieza.logout ||= tajada(p.node.init);
  },
});

const PEDIDOS = ['PERMISOS', 'veTodasLasObras', 'obrasDeLaSesion', 'esDependencia',
  'esPlataforma', 'GP_SIN_VEREDICTO', '_GP_NOTA', 'frescuraDeGP', 'fechaHoraLegible',
  'ROL_LABEL', 'C'];
const ESPERADAS = ['argGP', 'efectoGP', 'chip', 'activasGranel', 'llaveGranel',
  'listaPantalla', 'efectoPerfil', 'efectoAuth', 'olvidar', 'logout'];
const faltan = ESPERADAS.filter(k => !pieza[k]).map(k => `el trozo \`${k}\``);
let api = null;
try {
  const { cuerpo } = fuenteDe(archivo, PEDIDOS);
  const js = esbuild.transformSync(cuerpo, { loader: 'jsx' }).code;
  api = new Function('React', `"use strict";\n${js}\nreturn { ${PEDIDOS.join(', ')} };`)(React);
} catch (e) {
  faltan.push(...(e.faltantes || [e.message]));
}
if (faltan.length) noArranco(faltan, path.basename(archivo));

const { PERMISOS, obrasDeLaSesion, GP_SIN_VEREDICTO, _GP_NOTA, frescuraDeGP,
        fechaHoraLegible, ROL_LABEL, C } = api;

// Cada trozo, ejecutable. `arma` compila la expresión extraída recibiendo por
// parámetro lo que en la app le llega del entorno del componente.
const arma = (fuente, params) => new Function(...params,
  `"use strict"; return (${esbuild.transformSync(fuente, { loader: 'jsx' }).code.trim().replace(/;\s*$/, '')});`);

// ── Contraprueba ──────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  const MUTACIONES = [
    ['#40 · el corte vuelve a tener dos valores, y sin sesión contesta «sí, lee»',
     `useGPConstruct(
      !usuario ? null : (!esDependencia(usuario) && !esPlataforma(usuario)))`,
     'useGPConstruct(!esDependencia(usuario) && !esPlataforma(usuario))'],
    ['#40 · el efecto vuelve a pedir GP sin mirar si hay sesión',
     `    if (activo === null) { setGpEstado('sin_sesion'); return; }
    if (!activo) { setGpEstado('inactivo'); return; }
    cargarGP();`,
     `    if (!activo) { setGpEstado('inactivo'); return; }
    cargarGP();`],
    ['#40 · el chip vuelve a anunciar la falla de una lectura que no ha salido',
     `const GP_SIN_VEREDICTO = new Set(['sin_sesion', 'cargando', 'error_transitorio']);`,
     `const GP_SIN_VEREDICTO = new Set(['cargando', 'error_transitorio']);`],
    ['#62 · el granel vuelve a oír todas las obras activas',
     `    const activas = obrasDeLaSesion(usuario, obras).filter(o=>o.estado!=="archivada");`,
     `    const activas = obras.filter(o=>o.estado!=="archivada");`],
    ['#62 · y la llave vuelve a no moverse cuando cambian las asignaciones',
     `  const obrasActivasKey = obrasDeLaSesion(usuario, obras)
    .filter(o=>o.estado!=="archivada").map(o=>o.id).sort().join(",");`,
     `  const obrasActivasKey = obras.filter(o=>o.estado!=="archivada").map(o=>o.id).sort().join(",");`],
    ['#46 · el aviso vuelve a comparar contra el perfil del login',
     `        const rolViejo = visto.rol;
        const obrasViejas = visto.obras;`,
     `        const rolViejo = usuario.rol;
        const obrasViejas = Array.isArray(usuario.obras_asignadas) ? usuario.obras_asignadas : [];`],
    ['#6b · la revocación vuelve a no desmontar nada',
     `    if (!haySesionRef.current) return;`,
     `    if (!haySesionRef.current) return;
    if (cuenta === null) return;`],
    ['#6b · y el botón de salir vuelve a desmontar por su cuenta',
     `    olvidarSesion();
  };`,
     `    limpiarPrefijoOrg();
    setUsuario(null); setScreen("obras"); setObraId(null);
  };`],
    ['#6b · salir a propósito vuelve a leerse como una revocación',
     `    if (salidaVoluntariaRef.current) { salidaVoluntariaRef.current = false; return; }`,
     ''],
  ];
  let malas = 0;
  MUTACIONES.forEach(([titulo, de, a], n) => {
    console.log(`\nContraprueba — ${titulo}`);
    if (!src.includes(de)) {
      console.log('  La conducta vieja ya no se puede reinstalar: el trozo cambió de forma.');
      console.log('  Eso NO es que el banco mire; es que la contraprueba dejó de apuntar.');
      malas++;
      return;
    }
    const mutado = path.join(require('os').tmpdir(), `contra-sesion-${n}.jsx`);
    fs.writeFileSync(mutado, src.replace(de, a));
    const r = require('child_process').spawnSync(process.execPath, [__filename, mutado],
      { encoding: 'utf8' });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    console.log(r.stdout.replace(/^/gm, '  │ '));
    if (r.status === 2) { console.log('  NO ARRANCÓ: la mutación tumbó el andamiaje, no la conducta.'); malas++; }
    else if (rojas === 0) { console.log('  EN ROJO: romper la conducta no tumbó nada.'); malas++; }
    else console.log(`  Correcta: ${rojas} comprobación(es) se cayeron.`);
  });
  console.log(malas === 0
    ? `\nContraprueba correcta: las ${MUTACIONES.length} conductas se miran por separado.`
    : `\nCONTRAPRUEBA EN ROJO: ${malas} mutación(es) no se notaron.`);
  process.exit(malas === 0 ? 0 : 1);
}

// ══════════════════════════════════════════════════════════════════════════
// Sesiones de verdad: los roles salen de `PERMISOS`, no de literales, y si
// alguno dejara de existir el banco lo dice en vez de medir contra un hueco.
const SESION = (rol, extra = {}) => ({ correo: 'x@y.mx', emailId: 'x_y_mx',
  uid: 'u1', rol, tipo: 'constructora', orgId: 'fosmon', obras_asignadas: [], ...extra });
const DIRECTIVO = SESION('director_general');
const AUDITOR   = SESION('auditor', { obras_asignadas: ['0112', '0125'] });
const MUNICIPIO = SESION('director_obras', { tipo: 'dependencia', orgId: 'coatza' });
const SOPORTE   = { ...SESION('soporte'), tipo: null, orgId: null };

console.log('0. Las sesiones de la fixture son las que dicen ser (si no, lo de abajo pasa por vacío)');
for (const [q, u] of [['directivo', DIRECTIVO], ['auditor', AUDITOR], ['municipio', MUNICIPIO]])
  if (!PERMISOS[u.rol]) check(false, `el rol \`${u.rol}\` del ${q} existe en PERMISOS`);
check(PERMISOS[DIRECTIVO.rol].todas_obras === true,
  'el directivo de la fixture ve todas las obras');
check(PERMISOS[AUDITOR.rol].todas_obras === false,
  'y el auditor sólo las asignadas — que es el caso del #62');

// ══ 1. El corte de GP tiene tres valores, y sin sesión no se pide nada ════
console.log('\n1. #40 · Sin sesión, el corte de GP no contesta «sí, lee»');
const corte = arma(pieza.argGP, ['usuario', 'esDependencia', 'esPlataforma']);
const corteDe = u => corte(u, api.esDependencia, api.esPlataforma);
check(corteDe(null) === null,
  'sin sesión el corte vale null: todavía no se sabe si toca leer', String(corteDe(null)));
check(corteDe(null) !== corteDe(DIRECTIVO),
  'y vale DISTINTO que con una sesión de constructora — por eso el efecto se rearma al entrar',
  `${corteDe(null)} → ${corteDe(DIRECTIVO)}`);
check(corteDe(DIRECTIVO) === true,  'una constructora sí lee GP');
check(corteDe(MUNICIPIO) === false, 'una dependencia no (P5)');
check(corteDe(SOPORTE) === false,   'ni la sesión de plataforma');

const efectoGP = arma(pieza.efectoGP, ['activo', 'setGpEstado', 'cargarGP']);
const correrEfectoGP = (activo) => {
  const visto = { estado: null, pedidas: 0 };
  efectoGP(activo, e => { visto.estado = e; }, () => { visto.pedidas++; })();
  return visto;
};
const sinSesion = correrEfectoGP(corteDe(null));
check(sinSesion.pedidas === 0,
  'con ese valor el efecto NO pide el documento de GP', `${sinSesion.pedidas} lectura(s)`);
check(sinSesion.estado === 'sin_sesion',
  'y el estado lo dice con su nombre, en vez de quedarse en una falla de permiso',
  String(sinSesion.estado));
check(correrEfectoGP(corteDe(MUNICIPIO)).estado === 'inactivo',
  'la dependencia sigue en «inactivo»: no aplica, que no es lo mismo que no hay sesión');
check(correrEfectoGP(corteDe(MUNICIPIO)).pedidas === 0, 'y tampoco pide nada');
const conSesion = correrEfectoGP(corteDe(DIRECTIVO));
check(conSesion.pedidas === 1,
  'y la constructora SÍ lo pide — una vez, cuando ya hay con qué', `${conSesion.pedidas}`);

// ══ 2. El chip no anuncia la falla de una lectura que no ha salido ════════
console.log('\n2. #40 · El chip de Gasto GP, tal como lo lee el usuario');
const chip = arma(pieza.chip, ['dep', 'gpDisponible', 'gpEstado', 'gpUltActualiz',
  'gpLoading', 'onRefreshGP', 'GP_SIN_VEREDICTO', '_GP_NOTA', 'frescuraDeGP',
  'fechaHoraLegible', 'C', 'React']);
const pintaChip = (gpEstado, { dep = false, gpDisponible = false, ult = '' } = {}) => {
  const el = chip(dep, gpDisponible, gpEstado, ult, false, null,
    GP_SIN_VEREDICTO, _GP_NOTA, frescuraDeGP, fechaHoraLegible, C, React)();
  return el === null ? '' : renderToStaticMarkup(el);
};
check(pintaChip('sin_sesion') === '',
  'con el estado de antes de la sesión el chip no se pinta', pintaChip('sin_sesion') || '(nada)');
check(!/no disponible/.test(pintaChip('sin_sesion')),
  'o sea que no dice «no disponible» de una lectura que todavía no ha salido');
check(/no disponible/.test(pintaChip('error')),
  'una lectura que sí falló y agotó los reintentos SIGUE avisando en ámbar');
check(pintaChip('cargando') === '' && pintaChip('error_transitorio') === '',
  'y mientras carga o reintenta tampoco, como antes');
check(/Gasto GP/.test(pintaChip('listo', { gpDisponible: true, ult: '2026-11-12T10:00:00Z' })),
  'con dato, el chip es el de siempre');
check(typeof _GP_NOTA['sin_sesion'] === 'string' && _GP_NOTA['sin_sesion'].length > 0,
  'el estado nuevo tiene su renglón de diagnóstico, no se queda sin explicación');

// ══ 3. Las obras que se oyen son las que la pantalla enseña ═══════════════
console.log('\n3. #62 · Se levantan oyentes sobre las obras de la sesión, no sobre todas');
const OBRAS = [
  { id: '0112', nombre: 'malecón',     estado: 'activa' },
  { id: '0125', nombre: 'bulevar',     estado: 'activa' },
  { id: '0126', nombre: 'Cangrejera',  estado: 'activa' },
  { id: '0099', nombre: 'vieja',       estado: 'archivada' },
];
const granel   = arma(pieza.activasGranel, ['usuario', 'obras', 'obrasDeLaSesion']);
const pantalla = arma(pieza.listaPantalla, ['usuario', 'obras', 'obrasDeLaSesion']);
const llave    = arma(pieza.llaveGranel,   ['usuario', 'obras', 'obrasDeLaSesion']);
const ids = l => l.map(o => o.id).sort().join(',');
const oye   = u => ids(granel(u, OBRAS, obrasDeLaSesion));
const lista = u => ids(pantalla(u, OBRAS, obrasDeLaSesion).filter(o => o.estado !== 'archivada'));

check(oye(AUDITOR) === '0112,0125',
  'el auditor con dos obras asignadas: se oyen esas dos', oye(AUDITOR));
check(!oye(AUDITOR).includes('0126'),
  'y NO la tercera, que no es suya — hoy la tapan las reglas, obra por obra');
check(oye(AUDITOR) === lista(AUDITOR),
  'la lista que se oye y la que la pantalla enseña son la misma — una cuenta por número',
  `${oye(AUDITOR)}  vs  ${lista(AUDITOR)}`);
check(oye(DIRECTIVO) === '0112,0125,0126',
  'al directivo no se le recortó nada: sigue oyendo las tres activas', oye(DIRECTIVO));
check(oye(DIRECTIVO) === lista(DIRECTIVO), 'y también coincide con su lista');
check(!oye(DIRECTIVO).includes('0099'),
  'la archivada no entra por ninguno de los dos caminos');
check(oye(SESION('residente')) === '',
  'un rol sin asignaciones no levanta ni un oyente, en vez de levantar nueve por obra');

const llaveAntes   = llave(AUDITOR, OBRAS, obrasDeLaSesion);
const llaveDespues = llave({ ...AUDITOR, obras_asignadas: ['0112'] }, OBRAS, obrasDeLaSesion);
check(llaveAntes !== llaveDespues,
  'si a media sesión le quitan una obra, la llave del efecto CAMBIA — por eso se suelta el oyente',
  `${llaveAntes || '(vacía)'} → ${llaveDespues || '(vacía)'}`);
check(llaveDespues === '0112',
  'y lo que queda es la obra que sigue siendo suya', llaveDespues);

// ══ 4 y 5 ═════════════════════════════════════════════════════════════════
// Las dos secciones que faltan ejercitan trozos ASÍNCRONOS: el oyente de perfil
// pide el token nuevo antes de armar el aviso, y el botón de salir espera el
// renglón de auditoría antes de desmontar. Hay que esperarlos de verdad, porque
// lo que se afirma —qué dice el aviso, qué queda en memoria— sólo existe
// después. Por eso van dentro de una función `async`, y el informe final va con
// ellas: publicar el conteo antes de que esto termine sería contar verdes que
// todavía no se han medido. Si algo de aquí revienta, la promesa rechazada la
// recoge `vigilarExcepciones` y sale 2, que es lo correcto — no se midió.
async function principal() {
console.log('\n4. #46 · El aviso de permisos no compara contra el perfil del login');
const efectoPerfil = arma(pieza.efectoPerfil, ['usuario', 'doc', 'fbDb', 'onSnapshot',
  'perfilVistoRef', 'getIdToken', 'fbAuth', 'setUsuario', 'setToastPermisos', 'ROL_LABEL']);
// Una sesión que entra con un perfil y después recibe DOS cambios seguidos, que
// es el caso que el `usuario` congelado no podía ver.
const correrPerfil = async (inicial, cambios) => {
  const avisos = [];
  const ref = { current: null };
  let llegada = null;
  const desmonta = efectoPerfil(
    { ...SESION(inicial.rol, { obras_asignadas: inicial.obras_asignadas }) },
    () => ({}), {}, (_r, cb) => { llegada = cb; return () => {}; },
    ref, async () => {}, { currentUser: null },
    () => {}, t => avisos.push(t.detalle), ROL_LABEL)();
  if (!llegada) return { avisos: null };
  const entrega = p => llegada({ exists: () => true, data: () => p });
  await entrega({ claimsVersion: 1, rol: inicial.rol, nombre: 'X',
    obras_asignadas: inicial.obras_asignadas });
  for (const c of cambios) await entrega(c);
  if (typeof desmonta === 'function') desmonta();
  return { avisos, refTrasDesmontar: ref.current };
};

const dosRoles = await correrPerfil(
  { rol: 'residente', obras_asignadas: ['0112'] },
  [{ claimsVersion: 2, rol: 'superintendente', obras_asignadas: ['0112'] },
   { claimsVersion: 3, rol: 'gerente_construccion', obras_asignadas: ['0112'] }]);
check(dosRoles.avisos && dosRoles.avisos.length === 2,
  'dos cambios de permisos producen dos avisos', `${(dosRoles.avisos || []).length}`);
check((dosRoles.avisos || [])[0] === `Tu rol cambió a ${ROL_LABEL['superintendente']}.`,
  'el primero nombra el rol nuevo', String((dosRoles.avisos || [])[0]));
check((dosRoles.avisos || [])[1] === `Tu rol cambió a ${ROL_LABEL['gerente_construccion']}.`,
  'y el SEGUNDO también — antes repetía el del login, con el rol que ya tenía',
  String((dosRoles.avisos || [])[1]));

const dosAltas = await correrPerfil(
  { rol: 'auditor', obras_asignadas: ['0112'] },
  [{ claimsVersion: 2, rol: 'auditor', obras_asignadas: ['0112', '0125'] },
   { claimsVersion: 3, rol: 'auditor', obras_asignadas: ['0112', '0125', '0126'] }]);
check((dosAltas.avisos || [])[0] === 'Se agregó 1 obra a tu lista.',
  'la primera obra que llega: «1 obra»', String((dosAltas.avisos || [])[0]));
check((dosAltas.avisos || [])[1] === 'Se agregó 1 obra a tu lista.',
  'la segunda también es UNA — no «se agregaron 2», contando desde el login',
  String((dosAltas.avisos || [])[1]));
const bajaDespues = await correrPerfil(
  { rol: 'auditor', obras_asignadas: ['0112', '0125'] },
  [{ claimsVersion: 2, rol: 'auditor', obras_asignadas: ['0112'] },
   { claimsVersion: 3, rol: 'auditor', obras_asignadas: [] }]);
check((bajaDespues.avisos || [])[1] === 'Se quitó 1 obra de tu lista.',
  'y la retirada se cuenta igual de bien en la segunda vuelta',
  String((bajaDespues.avisos || [])[1]));
const sinIncremento = await correrPerfil(
  { rol: 'residente', obras_asignadas: [] },
  [{ claimsVersion: 1, rol: 'director_general', obras_asignadas: ['0112'] }]);
check((sinIncremento.avisos || ['x']).length === 0,
  'un snapshot que repite la versión no avisa nada: el guardarraíl anti-bucle sigue puesto');
check(dosRoles.refTrasDesmontar === null,
  'y al cambiar de sesión lo visto se olvida, para que la siguiente no herede el «antes»');

// ══ 5. Una sesión revocada se desmonta, por el mismo camino que el botón ══
console.log('\n5. #6b · Cuando Auth se queda sin credencial, la sesión se desmonta');
// Los nueve escritores de estado que desmontan una sesión, con su registrador.
// Se declaran UNA vez porque los reciben los dos caminos —`olvidarSesion` y
// `logout`—: dárselos sólo al primero haría que una mutación en la que `logout`
// desmonta por su cuenta reventara con un `is not defined` en vez de caerse por
// lo que de verdad está mal, que es dejar media sesión en memoria. Un andamiaje
// que decide cuál de las dos cosas pasa no sirve para distinguirlas.
const DESMONTAN = ['limpiarPrefijoOrg', 'setObras', 'setDatosPorObra', 'setMarca',
  'setAuditCtx', 'setPermisosObraOverride', 'setUsuario', 'setScreen', 'setObraId'];
// Lo que quedó en memoria después de desmontar. Arranca con la sesión montada
// —obras leídas, marca del cliente, usuario puesto— porque lo que se afirma es
// que eso se va.
const montada = () => ({ prefijo: 'orgs/fosmon', obras: OBRAS, datos: { '0112': {} },
  marca: { nombre: 'FOSMON' }, auditor: { correo: 'x@y.mx' }, override: { residente: {} },
  usuario: DIRECTIVO, screen: 'obra', obraId: '0112' });
const escritoresDe = (m) => [
  () => { m.prefijo = null; }, v => { m.obras = v; }, v => { m.datos = v; },
  v => { m.marca = v; }, v => { m.auditor = v; }, v => { m.override = v; },
  v => { m.usuario = typeof v === 'function' ? v(m.usuario) : v; },
  v => { m.screen = v; }, v => { m.obraId = v; },
];
const olvidarCrudo = arma(pieza.olvidar, ['useCallback', ...DESMONTAN]);
const olvidarCon = (m) => olvidarCrudo(f => f, ...escritoresDe(m));

const m1 = montada();
olvidarCon(m1)();
check(m1.usuario === null, 'no queda sesión', String(m1.usuario));
check(m1.obras.length === 0, 'no quedan obras en memoria', `${m1.obras.length}`);
check(Object.keys(m1.datos).length === 0,
  'ni lo pesado que alimenta el consolidado', JSON.stringify(m1.datos));
check(m1.marca === null, 'ni la marca del cliente anterior en el encabezado');
check(m1.prefijo === null, 'ni el prefijo de organización, que no es estado de React');
check(m1.override === null && m1.auditor.correo === 'anonimo',
  'ni los permisos de obra ni el contexto de auditoría');
check(m1.screen === 'obras' && m1.obraId === null, 'y la pantalla vuelve a la lista');

const efectoAuth = arma(pieza.efectoAuth, ['onAuthStateChanged', 'fbAuth',
  'haySesionRef', 'salidaVoluntariaRef', 'setAvisoSesion', 'olvidarSesion']);
// `voluntaria` es el ref que comparten los dos caminos. Se deja por fuera para
// poder darle el MISMO al botón de salir más abajo: ahí está el defecto que se
// vio en pantalla y que una prueba por separado no podía ver.
const avisarA = (cuenta, haySesion, voluntaria = { current: false }, alDesmontar = () => {}) => {
  const visto = { aviso: '', desmontes: 0 };
  let oyente = null;
  efectoAuth((_a, cb) => { oyente = cb; return () => {}; }, {},
    { current: haySesion }, voluntaria, a => { visto.aviso = a; },
    () => { visto.desmontes++; alDesmontar(); })();
  if (!oyente) return null;
  visto.oyente = oyente;
  oyente(cuenta);
  return visto;
};
const revocada = avisarA(null, true);
check(revocada && revocada.desmontes === 1,
  'Auth avisa sin cuenta y la sesión se desmonta — una vez', `${revocada && revocada.desmontes}`);
check(revocada && revocada.aviso.length > 0,
  'y el usuario lee por qué acabó en la pantalla de entrada', revocada ? revocada.aviso : '');
const siguePuesta = avisarA({ uid: 'u1' }, true);
check(siguePuesta && siguePuesta.desmontes === 0,
  'con cuenta no se desmonta nada: estar sin red no cierra la sesión');
const alArrancar = avisarA(null, false);
check(alArrancar && alArrancar.desmontes === 0 && alArrancar.aviso === '',
  'y el `null` del arranque —cuando nadie ha entrado— no pone aviso de nada');

// El botón de salir termina en el MISMO estado. Se ejecuta de verdad, con el
// `olvidarSesion` sacado del archivo: si los dos caminos se separaran, uno de
// los dos se quedaría enseñando las obras de la sesión anterior.
const logout = arma(pieza.logout, ['fsAudit', 'usuario', 'signOut', 'fbAuth',
  'olvidarSesion', 'salidaVoluntariaRef', ...DESMONTAN]);
const m2 = montada();
let salidas = 0;
// Los dos caminos atados, como en la app: `signOut` deja a Auth sin cuenta y el
// oyente dispara DENTRO de esa llamada, con la sesión todavía puesta porque el
// desmontaje viene después. Medir el botón y el oyente por separado dejaba
// pasar exactamente lo que se vio en el preview del 2026-11-12 — salir a
// propósito leía «tu acceso fue revocado»—, así que aquí se corren juntos.
const voluntaria = { current: false };
const porElBoton = { aviso: '', desmontes: 0 };
const signOutQueAvisaAAuth = async () => {
  salidas++;
  const r = avisarA(null, true, voluntaria, () => {});
  porElBoton.aviso = r ? r.aviso : '(no hubo oyente)';
  porElBoton.desmontes = r ? r.desmontes : -1;
};
await logout(async () => {}, DIRECTIVO, signOutQueAvisaAAuth, {},
  olvidarCon(m2), voluntaria, ...escritoresDe(m2))();
check(salidas === 1, 'el botón de salir cierra la sesión en Auth', `${salidas}`);
check(porElBoton.aviso === '',
  'y NO deja dicho que el acceso fue revocado: eso es un hecho sobre la cuenta, y es falso',
  porElBoton.aviso || '(sin aviso)');
check(porElBoton.desmontes === 0,
  'ni desmonta por el camino del oyente — el botón ya lo hace, y dos veces no es una',
  `${porElBoton.desmontes}`);
check(voluntaria.current === false,
  'la marca se consume: la revocación siguiente de esta misma pestaña sí avisa',
  String(voluntaria.current));
const traselBoton = avisarA(null, true, voluntaria);
check(traselBoton && traselBoton.aviso.length > 0,
  'y en efecto, un `null` posterior que nadie pidió vuelve a avisar');
check(m2.usuario === null && m2.obras.length === 0 && m2.marca === null && m2.prefijo === null,
  'y deja la memoria igual de vacía que la revocación: un solo desmontaje',
  `usuario ${m2.usuario} · ${m2.obras.length} obra(s) · marca ${JSON.stringify(m2.marca)}`);
check(Object.keys(m2.datos).length === 0 && m2.override === null,
  'incluida la parte que es fácil olvidar si cada camino desmonta por su cuenta',
  `${Object.keys(m2.datos).length} obra(s) con datos · override ${JSON.stringify(m2.override)}`);

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
}

principal();
