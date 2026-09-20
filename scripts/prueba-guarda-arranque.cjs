#!/usr/bin/env node
// Guarda de la rama fix/arranque. Cubre los cuatro defectos de arranque:
//
//   1. desajuste de roles      → un solo predicado, sin listas literales
//   2. Promise.all de info     → tolerante por obra
//   3. gpData sin recuperación → reintento acotado y cifras "no disponible"
//   4. guard de completud      → llegada registrada, con tope de espera
//
// Mismo enfoque que prueba-guarda-modo-volumen.cjs y por la misma razón: no
// hay jsdom ni runner de componentes, así que en vez de renderizar se extrae
// del propio `src/App.jsx`, por AST, la expresión real que gobierna cada
// decisión, y se evalúa. Si alguien reintroduce el defecto en esas líneas,
// esta prueba falla.
//
// Lo que NO cubre: el render, el orden real de llegada de Firestore, el
// comportamiento de los timeouts en el tiempo.
//
// Uso:  node scripts/prueba-guarda-arranque.cjs [archivo]
//
// El argumento sirve para correrla contra una versión anterior y comprobar
// que efectivamente falla ahí — una prueba que nunca ha fallado no prueba
// nada:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-guarda-arranque.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const ARCHIVO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(raiz, 'src/App.jsx');
const codigo = fs.readFileSync(ARCHIVO, 'utf8');
const ast = parse(codigo, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
const fuente = n => codigo.slice(n.start, n.end);

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

// Inicializador de una variable declarada a nivel de módulo.
function initModulo(nombre) {
  let out = null;
  traverse(ast, {
    VariableDeclarator(p) {
      if (out || p.node.id?.name !== nombre) return;
      if (p.getFunctionParent()) return;   // solo top-level
      out = fuente(p.node.init);
    },
  });
  return out;
}

// ── 1. Roles: un solo predicado ────────────────────────────────────────
console.log('\n1. Roles — ¿una sola fuente de verdad?');

const rolesSrc = initModulo('ROLES_PANEL_EJECUTIVO');
check(!!rolesSrc, 'existe ROLES_PANEL_EJECUTIVO a nivel de módulo');

const roles = rolesSrc ? new Function(`return ${rolesSrc};`)() : new Set();
const DEBEN_VER = [
  'director_general', 'director_operaciones', 'gerente_construccion',
  'admin_sistema', 'auditor',
  'director_obras', 'subdirector', 'jefe_supervision',
];
DEBEN_VER.forEach(r => check(roles.has(r), `${r} ve el Panel Ejecutivo`));
// Quien no debe verlo. `cliente` y `residente` no son mandos de portafolio.
['cliente', 'residente', 'soporte'].forEach(r =>
  check(!roles.has(r), `${r} NO ve el Panel Ejecutivo`));

// El defecto original: la MISMA decisión escrita dos veces, y las dos
// copias se desincronizaron. No se vigilan todas las listas de roles del
// archivo —hay muchas, para otras decisiones— sino exactamente los dos
// sitios que tienen que coincidir: el que pinta el panel y el que carga
// sus datos. Si cualquiera de los dos vuelve a decidir por su cuenta,
// esto falla.

// a) El que pinta: la condición que envuelve a <DashboardPrincipal>.
let condRender = null;
traverse(ast, {
  JSXElement(p) {
    if (condRender || p.node.openingElement.name?.name !== 'DashboardPrincipal') return;
    const cont = p.findParent(q => q.isLogicalExpression());
    if (cont) condRender = fuente(cont.node);
  },
});
check(!!condRender, 'se encontró la condición que pinta <DashboardPrincipal>');
check(!!condRender && /vePanelEjecutivo\(/.test(condRender),
  'el render del panel decide con vePanelEjecutivo');
check(!!condRender && !/\.includes\(/.test(condRender),
  'el render del panel ya no lleva lista literal de roles');

// b) El que carga: el init de `verPanelEjecutivo`.
let condCarga = null;
traverse(ast, {
  VariableDeclarator(p) {
    if (condCarga || p.node.id?.name !== 'verPanelEjecutivo') return;
    condCarga = fuente(p.node.init);
  },
});
check(!!condCarga, 'se encontró la condición que carga los datos del panel');
check(!!condCarga && /vePanelEjecutivo\(/.test(condCarga),
  'la carga de datos decide con vePanelEjecutivo');
check(!!condCarga && !/\.includes\(/.test(condCarga),
  'la carga de datos ya no lleva lista literal de roles');

// ── 2. Promise.all de config/info ──────────────────────────────────────
console.log('\n2. config/info — ¿una obra sin permiso tumba el lote?');

let cuerpoInfo = null;
traverse(ast, {
  CallExpression(p) {
    if (cuerpoInfo) return;
    const c = p.node.callee;
    const esPromiseAll = c?.type === 'MemberExpression'
      && c.object?.name === 'Promise' && c.property?.name === 'all';
    if (!esPromiseAll) return;
    const src = fuente(p.node);
    // Hay otros Promise.all que tocan config/info (borrado de obra, carga de
    // una sola obra). El del lote es el que mapea sobre `obrasFromDB`.
    if (/config\/info/.test(src) && /obrasFromDB/.test(src)) cuerpoInfo = src;
  },
});
check(!!cuerpoInfo, 'se encontró el Promise.all de config/info');
check(!!cuerpoInfo && /try\s*\{/.test(cuerpoInfo) && /catch\s*\(/.test(cuerpoInfo),
  'cada obra se lee dentro de try/catch — el rechazo de una no aborta las demás');
check(!!cuerpoInfo && /infoFallida/.test(cuerpoInfo),
  'las obras cuyo config/info falló se registran, no se pierden en silencio');

// ── 3. GP: reintento acotado y nada de ceros ───────────────────────────
console.log('\n3. GP — ¿se recupera, y qué muestra mientras no?');

// El reintento tiene que ser finito: una lista de esperas, no un bucle.
let reintentos = null;
traverse(ast, {
  VariableDeclarator(p) {
    if (reintentos || p.node.id?.name !== 'GP_REINTENTOS_MS') return;
    reintentos = new Function(`return ${fuente(p.node.init)};`)();
  },
});
check(Array.isArray(reintentos) && reintentos.length > 0 && reintentos.length <= 5,
  `los reintentos de GP son finitos y acotados (${JSON.stringify(reintentos)})`);
check(Array.isArray(reintentos) && reintentos.every((v, i, a) => i === 0 || v > a[i - 1]),
  'la espera entre reintentos es creciente, no un martilleo a intervalo fijo');

// El estado terminal 'error' tiene que ser alcanzable: si no, "cargando"
// es absorbente y volvemos al bug que se está arreglando.
check(/setGpEstado\(\s*['"]error['"]\s*\)/.test(codigo),
  "existe transición explícita a 'error' (agotados los reintentos)");
check(/GP_TOPE_INTENTO_MS/.test(codigo),
  'existe tope duro por intento — la promesa que nunca resuelve igual sale de "cargando"');

// Los dos KPIs que dependen de GP no pueden pintar una cifra sin GP.
const kpis = {};
traverse(ast, {
  JSXElement(p) {
    const nombre = p.node.openingElement.name?.name;
    if (nombre !== '_KpiConDelta') return;
    const src = fuente(p.node);
    const m = src.match(/label="([^"]+)"/);
    if (m) kpis[m[1]] = src;
  },
});
for (const label of ['Gastado', 'Margen']) {
  const src = kpis[label];
  check(!!src && /gpDisponible/.test(src),
    `el KPI "${label}" está condicionado por gpDisponible`);
  check(!!src && /no disponible/.test(src),
    `el KPI "${label}" dice "no disponible" en vez de una cifra falsa`);
}
// Regresión del principio P2: ningún KPI puede caer a cero por falta de dato.
check(!!kpis['Contratado'] && !/gpDisponible/.test(kpis['Contratado']),
  'el KPI "Contratado" no depende de GP y se sigue mostrando');

// ── 4. Completud: llegada, no existencia ───────────────────────────────
console.log('\n4. Guard de carga — ¿distingue "vacío" de "no ha llegado"?');

const clavesSrc = initModulo('CLAVES_BULK');
const completosSrc = initModulo('datosObraCompletos');
check(!!clavesSrc && !!completosSrc, 'existen CLAVES_BULK y datosObraCompletos');

const CLAVES = clavesSrc ? new Function(`return ${clavesSrc};`)() : [];
// Si falta la declaración, el predicado no existe: se sustituye por uno que
// devuelve `true` siempre, que es EXACTAMENTE el comportamiento del guard
// viejo. Así los casos de abajo reportan qué se rompía en vez de reventar.
const completos = completosSrc
  ? new Function('CLAVES_BULK', `return ${completosSrc};`)(CLAVES)
  : () => true;

check(completos(undefined) === false, 'obra ausente → incompleta');
check(completos({}) === false, 'entrada recién creada, sin _listos → incompleta');

// EL defecto: la entrada se crea en cuanto llega el PRIMERO de los 8.
const soloSubs = { subs: [{}], _listos: { subs: true } };
check(completos(soloSubs) === false,
  'llegó solo `subs` → incompleta (antes esto se daba por cargado)');

// Siete de ocho tampoco alcanza.
const casiTodo = { _listos: Object.fromEntries(CLAVES.slice(0, -1).map(k => [k, true])) };
check(completos(casiTodo) === false, `${CLAVES.length - 1} de ${CLAVES.length} claves → incompleta`);

// Obra genuinamente vacía pero con todo resuelto → completa. Es la
// distinción que el guard viejo no podía hacer.
const vaciaResuelta = { subs: [], maquinaria: [], _listos: Object.fromEntries(CLAVES.map(k => [k, true])) };
check(completos(vaciaResuelta) === true,
  'obra sin partidas pero con las 8 claves resueltas → completa, no "cargando"');

// El tope de espera: sin él, una clave que nunca llega congela la pantalla.
check(/ESPERA_MAX_MS/.test(codigo) && /esperaAgotada/.test(codigo),
  'el guard tiene tope de espera (ESPERA_MAX_MS / esperaAgotada)');
check(/obrasIncompletas/.test(codigo),
  'las obras que no cargaron se listan, no se ocultan');

// ── 5. La precondición del guard: los 8 errores marcan resuelto ────────
// Si un callback de error no marca su clave, el guard nuevo convierte un
// bug intermitente en uno permanente. Esto es lo que más importa vigilar.
console.log('\n5. Los 8 listeners — ¿todo callback de error marca su clave?');

const escritas = new Set();   // claves que el camino feliz escribe
const falladas = new Set();   // claves que un callback de error resuelve

traverse(ast, {
  CallExpression(p) {
    const callee = p.node.callee;
    if (callee?.name === 'patch') {
      const arg = p.node.arguments[1];
      if (arg?.type === 'ObjectExpression') {
        arg.properties.forEach(pr => {
          const k = pr.key?.name || pr.key?.value;
          if (k && k !== '_listos') escritas.add(k);
        });
      }
    }
    if (callee?.name === 'alFallar') {
      const clave = p.node.arguments[1];
      if (clave?.type === 'StringLiteral') falladas.add(clave.value);
    }
  },
});

// `patch` también se llama dentro de alFallar con clave computada; esas no
// cuentan como camino feliz. Se comparan contra el catálogo declarado.
const faltan = CLAVES.filter(k => !falladas.has(k));
check(faltan.length === 0,
  `las ${CLAVES.length} claves de CLAVES_BULK tienen callback de error que las resuelve${faltan.length ? ' — faltan: ' + faltan.join(', ') : ''}`);

const sobran = [...falladas].filter(k => !CLAVES.includes(k));
check(sobran.length === 0,
  `ningún alFallar marca una clave fuera del catálogo${sobran.length ? ' — sobran: ' + sobran.join(', ') : ''}`);

const sinPatch = CLAVES.filter(k => !escritas.has(k));
check(sinPatch.length === 0,
  `las ${CLAVES.length} claves también se escriben en el camino feliz${sinPatch.length ? ' — faltan: ' + sinPatch.join(', ') : ''}`);

// ── Resultado ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
if (fallos.length === 0) {
  console.log('TODO EN VERDE — las cuatro guardas de fix/arranque se sostienen.');
  process.exit(0);
}
console.log(`${fallos.length} FALLA(S):`);
fallos.forEach(f => console.log('  · ' + f));
process.exit(1);
