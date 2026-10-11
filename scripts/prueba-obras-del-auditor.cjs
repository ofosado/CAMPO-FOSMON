#!/usr/bin/env node
// ¿Qué obras le llegan al concentrado de un auditor?
//
// El auditor es un EXTERNO: hoy son tres cuentas de @hytorc.com.mx y
// @noleaks.com.mx auditando una obra que FOSMON ejecuta con esas mismas
// empresas. Tiene `todas_obras:false` y, a la vez, está en
// `ROLES_PANEL_EJECUTIVO`. Esas dos cosas juntas son la pregunta: si el
// consolidado recibiera la lista completa, un auditor de una empresa estaría
// viendo contratado, ejecutado y MARGEN de obras que no le asignaron. No es un
// detalle de orden en la pantalla; es la razón por la que no se toca la
// navegación antes de medir esto.
//
// Son DOS cerrojos en serie y los dos se afirman aquí, porque no contestan lo
// mismo: el cargador decide qué se LEE de Firestore, y el filtro de la pantalla
// decide qué se PINTA. Lo que los separa es que la carga MEZCLA lo que trae la
// red con lo que ya hay en el estado (`[...actualizadas, ...nuevas]`), así que
// lo que el panel recibe no es «lo que se acaba de leer»: es todo lo que haya
// quedado. Que hoy no haya nada de más es mérito del `setObras([])` del logout,
// que está ahí por un defecto que ya pasó —un municipio entrando sobre la
// sesión de FOSMON y sumando las obras del contratista a su consolidado—. O
// sea: estos dos cerrojos coinciden hoy, y coinciden por un tercero.
//
// Comprobado también en el preview, que es donde se ve: con las 4 obras del
// director general en memoria un segundo antes y SIN recargar la página, el
// auditor sembrado con `obras_asignadas:['0114']` pinta 1 obra y CONTRATADO
// $38,500,000, que es el contrato de 0114 y nada más. La 0121 —$24,800,000— no
// aparece en ninguna cifra.
//
// Cómo se mide, para que esto no se compruebe contra sí mismo: no se copia la
// cuenta. Se busca en el JSX el elemento del concentrado, se lee QUÉ EXPRESIÓN
// le pasan en el atributo `obras`, se resuelve esa expresión contra los
// `const` de la propia pantalla, y se EJECUTA. Si mañana alguien cambia
// `obras={todasObras}` por `obras={obras}`, este banco no se entera por el
// nombre: se entera porque el resultado cambia.
//
// Uso:  node scripts/prueba-obras-del-auditor.cjs [archivo]

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion } = noArranco;

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
noArranco.vigilarExcepciones(archivo);
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
const texto = (n) => src.slice(n.start, n.end);

// ── Lo que vive en el módulo ───────────────────────────────────────────────
const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= texto(p.node.init);
  },
});
for (const n of ['PERMISOS', 'ROLES_PANEL_EJECUTIVO'])
  if (!decl[n]) noArranco([n], archivo);

const PERMISOS = new Function(`"use strict"; return ${decl['PERMISOS']};`)();
const ROLES_PANEL = new Function(`"use strict"; return ${decl['ROLES_PANEL_EJECUTIVO']};`)();

// ── La pantalla de obras y sus `const` de primer nivel ─────────────────────
//
// Sólo los del cuerpo de la función, no los que viven dentro de sus closures:
// en 22 000 renglones hay más de un `asignadas` y resolver por nombre a ciegas
// agarraría el de otro sitio.
let cuerpoPantalla = null;
const locales = new Map();   // nombre → nodo init
traverse(ast, {
  FunctionDeclaration(p) {
    if (!p.node.id || p.node.id.name !== 'PantallaObras') return;
    cuerpoPantalla = p;
    for (const st of p.node.body.body) {
      if (st.type !== 'VariableDeclaration') continue;
      for (const d of st.declarations)
        if (d.id.type === 'Identifier' && d.init && !locales.has(d.id.name))
          locales.set(d.id.name, d.init);
    }
  },
});
if (!cuerpoPantalla) noArranco(['PantallaObras'], archivo);

// ── Qué expresión recibe cada concentrado en su atributo `obras` ───────────
const CONCENTRADOS = ['DashboardPrincipal', 'PortafolioDependencia'];
const recibe = {};
cuerpoPantalla.traverse({
  JSXOpeningElement(q) {
    const nombre = q.node.name.name;
    if (!CONCENTRADOS.includes(nombre)) return;
    const attr = q.node.attributes.find(a =>
      a.type === 'JSXAttribute' && a.name.name === 'obras');
    if (!attr || !attr.value || attr.value.type !== 'JSXExpressionContainer') return;
    recibe[nombre] ||= attr.value.expression;
  },
});
const sinAtributo = CONCENTRADOS.filter(c => !recibe[c]);
if (sinAtributo.length)
  sinPrecondicion(
    `no encontré con qué lista se pinta ${sinAtributo.join(' ni ')} dentro de PantallaObras`,
    ['O el concentrado dejó de recibir sus obras por un atributo `obras`, o se',
     'movió de componente. Lo que este banco mediría es un render que nadie',
     'pinta: hay que apuntarlo al lugar nuevo antes de creerle.']);

// ── Resolver una expresión contra los `const` de la pantalla y ejecutarla ──
//
// Las únicas entradas de fuera que se aceptan son `usuario` y `obras`, que es
// justo lo que la pantalla recibe por props. Si la cadena pide cualquier otra
// cosa —un `useState`, una lectura a Firestore—, esto NO es rojo: es que la
// cuenta ya no se puede aislar y hay que medirla de otra forma.
const ENTRADAS = ['usuario', 'obras'];
const DEL_MODULO = ['PERMISOS'];
const GLOBALES = new Set(['Array', 'Object', 'Math', 'JSON', 'Boolean', 'Number',
  'String', 'Set', 'Map', 'undefined', 'NaN']);

// Los nombres que una expresión toma de FUERA. Los que ella misma ata —los
// parámetros de sus propias flechas, como la `o` de `obras.filter(o => …)`— no
// cuentan: pedirlos como insumo del entorno sería inventar una carencia.
const atados = (n, dentro) => {
  const anotar = (pat) => {
    if (!pat) return;
    if (pat.type === 'Identifier') dentro.add(pat.name);
    else if (pat.type === 'ObjectPattern') pat.properties.forEach(p => anotar(p.value || p.argument));
    else if (pat.type === 'ArrayPattern') pat.elements.forEach(anotar);
    else if (pat.type === 'AssignmentPattern') anotar(pat.left);
    else if (pat.type === 'RestElement') anotar(pat.argument);
  };
  if (Array.isArray(n.params)) n.params.forEach(anotar);
  if (n.type === 'VariableDeclarator') anotar(n.id);
  if (n.type === 'CatchClause') anotar(n.param);
};

const referenciados = (nodo) => {
  const fuera = new Set();
  const visitar = (n, padre, ligados) => {
    if (!n || typeof n.type !== 'string') return;
    const propios = new Set(ligados);
    atados(n, propios);
    if (n.type === 'Identifier') {
      // `o.id` → `o` sí, `id` no.  `{ a: 1 }` → `a` no.
      //
      // `OptionalMemberExpression` va en la lista por algo concreto: la cuenta
      // que se mide aquí es `PERMISOS[usuario.rol]?.todas_obras`, y sin este
      // caso el banco pedía un `const todas_obras` que no existe y salía NO
      // ARRANCÓ culpando al archivo medido en vez de a su propio andamiaje.
      const esMiembro = padre && (padre.type === 'MemberExpression' ||
                                  padre.type === 'OptionalMemberExpression');
      if (esMiembro && padre.property === n && !padre.computed) return;
      if (padre && padre.type === 'ObjectProperty' && padre.key === n && !padre.computed) return;
      if (!ligados.has(n.name)) fuera.add(n.name);
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && visitar(c, n, propios));
      else if (v && typeof v.type === 'string') visitar(v, n, propios);
    }
  };
  visitar(nodo, null, new Set());
  return fuera;
};

const ejecutable = (nodo, etiqueta) => {
  const orden = [];           // nombres locales en orden de dependencia
  const pendientes = [nodo];
  const vistos = new Set();
  while (pendientes.length) {
    const n = pendientes.pop();
    for (const nombre of referenciados(n)) {
      if (GLOBALES.has(nombre) || ENTRADAS.includes(nombre) || DEL_MODULO.includes(nombre)) continue;
      if (vistos.has(nombre)) continue;
      if (!locales.has(nombre))
        sinPrecondicion(
          `para saber qué obras recibe ${etiqueta} hace falta \`${nombre}\`, que no es un const de PantallaObras`,
          ['La cuenta dejó de depender sólo de `usuario` y `obras`. Medirla aquí',
           'daría un número sacado de un sandbox incompleto, que es peor que no',
           'medirla. Hay que llevar esta comprobación al preview.']);
      vistos.add(nombre);
      orden.unshift(nombre);
      pendientes.push(locales.get(nombre));
    }
  }
  // Orden de aparición en el archivo: un `const` no puede usar a otro que se
  // declara después.
  const unicos = [...new Set(orden)].sort((a, b) => locales.get(a).start - locales.get(b).start);
  const cuerpo = unicos.map(n => `  const ${n} = ${texto(locales.get(n))};`).join('\n');
  return new Function('PERMISOS', 'usuario', 'obras',
    `"use strict";\n${cuerpo}\n  return (${texto(nodo)});`);
};

const fn = {};
for (const c of CONCENTRADOS) fn[c] = ejecutable(recibe[c], c);

// ── Andamiaje ──────────────────────────────────────────────────────────────
let fallas = 0, oks = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok  ' : 'FALLA'} ${titulo}${detalle ? `  ·  ${detalle}` : ''}`);
  ok ? oks++ : fallas++;
};
const seccion = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 64 - t.length))}`);

const OBRAS = ['0112', '0114', '0125', '0126', '0127']
  .map(id => ({ id, nombre: `Obra ${id}`, estado: 'activa', presupuesto: 1e6, gastoGP: 1e5 }));
const ids = l => l.map(o => o.id).sort().join(',');
const paraRol = (rol, asignadas) => {
  const tipo = PERMISOS[rol] && ['director_obras', 'subdirector', 'jefe_supervision',
    'supervisor_obra', 'administrativo', 'contralor', 'contratista'].includes(rol)
    ? 'dependencia' : 'constructora';
  const u = { rol, tipo, uid: 'u1' };
  if (asignadas !== undefined) u.obras_asignadas = asignadas;
  const comp = tipo === 'dependencia' ? 'PortafolioDependencia' : 'DashboardPrincipal';
  return { lista: fn[comp](PERMISOS, u, OBRAS), comp };
};

console.log('El concentrado recibe:');
for (const c of CONCENTRADOS) console.log(`  ${c.padEnd(22)} obras={${texto(recibe[c])}}`);

// ════════════════════════════════════════════════════════════════════════════
// 1) EL AUDITOR. La medición bloqueante.
// ════════════════════════════════════════════════════════════════════════════
seccion('El auditor externo');
{
  const { lista } = paraRol('auditor', ['0114']);
  check(ids(lista) === '0114',
    'un auditor con UNA obra asignada recibe esa obra y nada más',
    `${lista.length} de ${OBRAS.length} · ${ids(lista) || '(vacío)'}`);

  const dos = paraRol('auditor', ['0112', '0127']).lista;
  check(ids(dos) === '0112,0127',
    'con dos asignadas, recibe exactamente esas dos', ids(dos));

  // Lo que duele no es que falte una: es que sobren. Se afirma la ausencia.
  const sobra = dos.filter(o => !['0112', '0127'].includes(o.id));
  check(sobra.length === 0,
    'y ninguna obra ajena se cuela al consolidado',
    sobra.length ? `se colaron ${ids(sobra)}` : 'ninguna');

  // Que el fixture no sea degenerado es parte de la afirmación: con una lista
  // de entrada ya corta, un filtro roto y uno bueno se ven igual.
  check(OBRAS.length > dos.length,
    'se mide con obras de más en el estado, no con una lista ya corta',
    `${OBRAS.length} en estado · ${dos.length} al panel`);

  const sinAsignar = paraRol('auditor', []).lista;
  check(sinAsignar.length === 0,
    'un auditor sin asignaciones no recibe NADA, no recibe todas',
    `${sinAsignar.length} obra(s)`);

  const sinCampo = paraRol('auditor', undefined).lista;
  check(sinCampo.length === 0,
    'y sin el campo `obras_asignadas` tampoco cae a la lista completa',
    `${sinCampo.length} obra(s)`);

  const fantasma = paraRol('auditor', ['0114', '9999']).lista;
  check(ids(fantasma) === '0114',
    'una asignación a una obra que no existe no inventa una fila', ids(fantasma));
}

// ════════════════════════════════════════════════════════════════════════════
// 2) TODOS los roles que ven consolidado, no sólo el auditor
// ════════════════════════════════════════════════════════════════════════════
//
// El defecto que esto previene no es el de hoy: es el rol que entre mañana a
// `ROLES_PANEL_EJECUTIVO` con `todas_obras:false` y nadie vuelva a mirar.
seccion('Todo rol con consolidado');
{
  const conPanel = [...ROLES_PANEL].filter(r => PERMISOS[r]);
  check(conPanel.length === [...ROLES_PANEL].length,
    'todos los roles del panel existen en PERMISOS',
    `${conPanel.length} de ${[...ROLES_PANEL].length}`);

  const parciales = conPanel.filter(r => PERMISOS[r].todas_obras !== true);
  const totales = conPanel.filter(r => PERMISOS[r].todas_obras === true);

  check(parciales.includes('auditor'),
    'el auditor sigue siendo un rol de obras parciales con consolidado',
    parciales.join(' · ') || '(ninguno)');

  const colados = [];
  for (const rol of parciales) {
    const l = paraRol(rol, ['0126']).lista;
    if (ids(l) !== '0126') colados.push(`${rol}→${ids(l) || 'vacío'}`);
  }
  check(colados.length === 0,
    `ninguno de los ${parciales.length} rol(es) parcial(es) recibe obras sin asignar`,
    colados.length ? colados.join(' · ') : parciales.join(' · '));

  // La otra mitad: un filtro que también recorta al que SÍ debe ver todo no es
  // un filtro, es una regresión.
  const recortados = [];
  for (const rol of totales) {
    const l = paraRol(rol, ['0126']).lista;
    if (l.length !== OBRAS.length) recortados.push(`${rol}→${l.length}`);
  }
  check(recortados.length === 0,
    `los ${totales.length} rol(es) con todas_obras siguen recibiendo las ${OBRAS.length}`,
    recortados.length ? recortados.join(' · ') : 'sin recorte');

  // Un rol que la tabla no conoce: `PERMISOS[rol]?.todas_obras` sale undefined
  // y debe caer del lado restrictivo, no del permisivo.
  const desconocido = fn['DashboardPrincipal'](PERMISOS,
    { rol: 'auditor_externo_nuevo', tipo: 'constructora', obras_asignadas: ['0112'] }, OBRAS);
  check(ids(desconocido) === '0112',
    'un rol que PERMISOS no conoce cae del lado restrictivo', ids(desconocido));
}

// ════════════════════════════════════════════════════════════════════════════
// 3) El primer cerrojo: qué obras se piden a la red
// ════════════════════════════════════════════════════════════════════════════
//
// La pantalla filtra, pero si el cargador pidiera la colección completa el
// auditor se traería los documentos aunque no los pinte. Son dos cerrojos en
// serie a propósito, no dos cuentas del mismo número: uno decide qué se lee,
// el otro qué se pinta.
seccion('Qué se le pide a Firestore');
{
  let efecto = null;
  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.name !== 'useEffect') return;
      const t = texto(p.node.arguments[0] || {});
      if (/esDirectivo/.test(t) && /obras_asignadas/.test(t)) efecto ||= t;
    },
  });
  if (!efecto)
    sinPrecondicion(
      'no encontré el efecto que decide qué obras se le piden a Firestore',
      ['Se reescribió la carga de obras. Mientras no se vuelva a apuntar, este',
       'banco sólo mide el segundo cerrojo.']);

  check(/PERMISOS\[usuario\.rol\]\?\.todas_obras === true/.test(efecto),
    'quién lista la colección completa lo decide `todas_obras`, no una lista de roles aparte');
  check(/collObra\(\)/.test(efecto) && /docObra\(/.test(efecto),
    'hay dos caminos: colección completa para directivos, documento por documento para los demás');
  // Lo que importa: el `getDocs` de la colección entera vive DENTRO de la rama
  // de directivos. Si se saliera de ahí, el auditor pediría todo.
  const ramaDirectivos = efecto.slice(efecto.indexOf('if (esDirectivo)'));
  const corte = ramaDirectivos.indexOf('} else {');
  check(corte > 0 && ramaDirectivos.slice(0, corte).includes('getDocs(collObra())'),
    'el `getDocs` de la colección entera está dentro de la rama de directivos');
  check(corte > 0 && !ramaDirectivos.slice(corte).includes('getDocs(collObra())'),
    'y no hay un segundo `getDocs` de todo en la rama de los demás');
  check(/asignadas\.length === 0/.test(efecto),
    'sin asignaciones no se pide nada, en vez de pedir todo');
}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas > 0) {
  console.log('');
  console.log('Si esto está rojo, un auditor externo —hoy cuentas de otras dos');
  console.log('empresas— puede estar viendo contratado, ejecutado y margen de obras');
  console.log('que no le asignaron. Eso se arregla antes de tocar la navegación.');
}
process.exit(fallas > 0 ? 1 : 0);
