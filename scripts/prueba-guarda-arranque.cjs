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

// ── ALCANZABILIDAD ─────────────────────────────────────────────────────
// Lo anterior sólo prueba que el mecanismo EXISTE. El defecto real fue
// otro: existía y era inalcanzable. `cargarGP` leía con `fsGet`, que hace
// `catch { return null; }`, así que la excepción nunca llegaba, el catch
// era código muerto, `error_transitorio` no se ponía nunca y el reintento
// automático jamás corría. Principio P3: probar el comportamiento, no la
// existencia del mecanismo.
//
// Primero, catálogo de helpers que se tragan excepciones: capturan y
// devuelven un valor en vez de propagar.
const tragones = [];
traverse(ast, {
  VariableDeclarator(p) {
    if (p.getFunctionParent()) return;                 // solo módulo
    const init = p.node.init;
    if (!init || !/Function/.test(init.type)) return;
    const src = fuente(init);
    if (/catch\s*(\([^)]*\))?\s*\{[^{}]*return/.test(src) && !/throw/.test(src)) {
      tragones.push(p.node.id.name);
    }
  },
});
check(tragones.includes('fsGet'),
  `el detector reconoce helpers que se tragan excepciones (${tragones.join(', ') || 'ninguno'})`);

// Segundo: el camino de lectura de GP no puede pasar por ninguno de ellos.
let cargarGPpath = null;
traverse(ast, {
  VariableDeclarator(p) {
    if (cargarGPpath || p.node.id?.name !== 'cargarGP') return;
    cargarGPpath = p;
  },
});
check(!!cargarGPpath, 'se encontró cargarGP');
const cargarGPsrc = cargarGPpath ? fuente(cargarGPpath.node.init) : '';

const usados = tragones.filter(t => new RegExp(`\\b${t}\\s*\\(`).test(cargarGPsrc || ''));
check(usados.length === 0,
  `cargarGP no lee a través de un helper que se traga el error${usados.length ? ' — usa: ' + usados.join(', ') : ''}`);
check(!!cargarGPsrc && /getDoc\s*\(/.test(cargarGPsrc),
  'cargarGP lee con getDoc directo, así que la excepción sí llega');
// El catch de MÁS AFUERA de cargarGP es el que recibe el fallo de lectura.
// Se mira ese, no el archivo entero: el `forzar` tiene su propio try/catch
// para la Cloud Function y no debe confundirse con éste.
let catchLectura = null;
if (cargarGPpath) {
  cargarGPpath.traverse({
    TryStatement(p) {
      if (catchLectura) return;
      if (!/getDoc\s*\(/.test(fuente(p.node.block))) return;   // el que lee
      catchLectura = fuente(p.node.handler);
    },
  });
}
check(!!catchLectura && /error_transitorio/.test(catchLectura),
  "el catch de la lectura clasifica como 'error_transitorio' — el estado que SÍ reintenta");

// Tercero: `sin_sincronizar` sólo puede salir de una ausencia comprobada
// del documento, no de un `null` de origen desconocido. Ése fue el
// diagnóstico erróneo que obligó a picar Refrescar a mano.
let ramaNoExiste = null;
if (cargarGPpath) {
  cargarGPpath.traverse({
    IfStatement(p) {
      if (ramaNoExiste) return;
      if (/^!\s*\w+\.exists\(\)$/.test(fuente(p.node.test).trim())) {
        ramaNoExiste = fuente(p.node.consequent);
      }
    },
  });
}
check(!!ramaNoExiste && /sin_sincronizar/.test(ramaNoExiste),
  "'sin_sincronizar' se pone sólo cuando el documento comprobadamente no existe");
// Y al revés: no puede ponerse en ningún otro sitio. Se cuentan llamadas
// reales por AST, no coincidencias de texto — los comentarios nombran el
// estado y falsearían el conteo.
let vecesSinSinc = 0;
if (cargarGPpath) {
  cargarGPpath.traverse({
    CallExpression(p) {
      if (p.node.callee?.name !== 'setGpEstado') return;
      const a = p.node.arguments[0];
      if (a?.type === 'StringLiteral' && a.value === 'sin_sincronizar') vecesSinSinc++;
    },
  });
}
check(vecesSinSinc === 1,
  `'sin_sincronizar' se pone en un solo lugar de cargarGP (${vecesSinSinc})`);
check(!!cargarGPsrc && /permission-denied/.test(cargarGPsrc),
  'los fallos terminales (permisos, sesión) se distinguen de los transitorios y no se reintentan');

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

// El motivo técnico no se pinta: va en el tooltip. En pantalla, "no
// disponible" y nada más. `_GP_NOTA` sólo puede consumirse dentro de un
// `title=`, nunca como texto de un KPI ni de un chip.
const notaSrc = initModulo('_GP_NOTA');
check(!!notaSrc, 'existe _GP_NOTA');
const NOTA = notaSrc ? new Function(`return ${notaSrc};`)() : {};
check(Object.keys(NOTA).length > 0 &&
      !Object.values(NOTA).some(v => /nunca|jamás|no se ha sincronizado/i.test(v)),
  'ningún motivo de _GP_NOTA usa frases alarmantes ("nunca", "jamás")');
for (const label of ['Gastado', 'Margen']) {
  check(!!kpis[label] && !/_GP_NOTA/.test(kpis[label]),
    `el KPI "${label}" no pinta el motivo técnico, sólo "no disponible"`);
}
// El chip: misma píldora que la de frescura (borderRadius 12 + punto de
// color), texto "no disponible", motivo en `title`.
let chip = null;
traverse(ast, {
  JSXElement(p) {
    if (chip) return;
    const src = fuente(p.node);
    if (/GP Sheet ·/.test(src) && /borderRadius:12/.test(src)) chip = src;
  },
});
check(!!chip, 'el estado de GP se muestra en la píldora "GP Sheet ·", no en una caja aparte');
check(!!chip && /no disponible/.test(chip), 'el chip dice "no disponible"');
check(!!chip && /title=\{tip\}/.test(chip) && /_GP_NOTA/.test(chip),
  'el motivo técnico del chip va en title (tooltip), no en el texto visible');
check(!!chip && /Refrescar/.test(chip),
  'el chip ofrece "Refrescar" como enlace al lado');

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
console.log('\n5. Los listeners — ¿todo callback de error deja las 8 resueltas?');

// Antes esto se comprobaba contando nombres: que cada clave del catálogo
// apareciera literal en un `alFallar`. Dejó de servir cuando `nominaSemanas`
// pasó a derivarse dentro de `patch` a partir de DOS oyentes (el documento
// viejo y la subcolección) más la bandera — ninguno de los tres se llama
// `nominaSemanas`, y el conteo lo leía como clave sin rescate. Contar nombres
// nunca fue la propiedad que importa; la que importa es que, si TODOS los
// oyentes fallan, el guard no se quede esperando. Así que en vez de contar,
// se corre: se extrae el `patch` real y se le dan los mismos valores vacíos
// que le daría cada `alFallar` del código.
const claveDeFallo = [];
traverse(ast, {
  CallExpression(p) {
    if (p.node.callee?.name !== 'alFallar') return;
    const clave = p.node.arguments[1];
    const vacio = p.node.arguments[2];
    if (clave?.type === 'StringLiteral' && vacio) {
      claveDeFallo.push({ clave: clave.value, vacio: fuente(vacio) });
    }
  },
});
check(claveDeFallo.length > 0, 'se encontraron los callbacks de error de los listeners');

let patchSrc = null;
traverse(ast, {
  VariableDeclarator(p) {
    if (patchSrc || p.node.id?.name !== 'patch') return;
    patchSrc = fuente(p.node.init);
  },
});
check(!!patchSrc, 'se encontró el `patch` que alimenta el mapa por obra');

// Los helpers que `patch` usa se toman del propio App.jsx, no se fingen: si
// la derivación cambia de criterio (otro agrupado de semanas, otra lectura de
// la bandera), esta prueba lo ve. Van en orden de dependencia.
const NECESARIOS = ['heImporte', 'semanaISO', 'numSemanaNomina', 'fechaCargaNomina',
                    'añoSemanaNomina', 'claveSemanaNomina', 'semanasDeNomina',
                    'FORMATO_HISTORIAL_ARREGLO', 'FORMATO_HISTORIAL_SUBCOLECCION',
                    'formatoHistorial'];
const sinHelper = NECESARIOS.filter(n => !initModulo(n));
check(sinHelper.length === 0,
  `se encontraron los helpers que alimentan la derivación${sinHelper.length ? ' — faltan: ' + sinHelper.join(', ') : ''}`);
const preludio = NECESARIOS.map(n => `const ${n} = ${initModulo(n)};`).join('\n');

let estado = {};
const hacerPatch = new Function('setDatosPorObra',
  `${preludio}\nreturn ${patchSrc};`)(f => { estado = f(estado); });

const vacioDe = {};
claveDeFallo.forEach(({ clave, vacio }) => {
  vacioDe[clave] = new Function(`return (${vacio});`)();
});

// Caso peor: se cayeron TODOS los oyentes.
estado = {};
claveDeFallo.forEach(({ clave }) => hacerPatch('0126', { [clave]: vacioDe[clave] }));
const listosTrasFallo = estado['0126']?._listos || {};
const sinResolver = CLAVES.filter(k => !listosTrasFallo[k]);
check(sinResolver.length === 0,
  `si fallan todos los listeners, las ${CLAVES.length} claves quedan resueltas${sinResolver.length ? ' — colgadas: ' + sinResolver.join(', ') : ''}`);

// Y el camino feliz: llegan los datos de verdad y las 8 quedan resueltas,
// con la nómina contada, no sólo marcada.
const registro = { numSemana: 38, fecha: '15/9/2026', totalNomina: 655553,
  trabajadores: Array.from({ length: 134 }, (_, i) => ({ nombre: `T${i}` })) };
estado = {};
claveDeFallo.forEach(({ clave }) => {
  const valor = clave === 'info' ? { formatoHistorial: { nomina: 2 } }
    : clave === '_nomSub' ? [registro]
    : vacioDe[clave];
  hacerPatch('0126', { [clave]: valor });
});
const feliz = estado['0126'] || {};
const sinCamino = CLAVES.filter(k => !feliz._listos?.[k]);
check(sinCamino.length === 0,
  `con datos reales las ${CLAVES.length} claves también quedan resueltas${sinCamino.length ? ' — faltan: ' + sinCamino.join(', ') : ''}`);
check((feliz.nominaSemanas || []).length === 1,
  'y la nómina de la subcolección llega contada, no vacía');

// La otra mitad de la derivación: con la bandera en subcolección, que llegue
// el documento VIEJO no basta. Si bastara, una obra migrada enseñaría cero
// semanas mientras su subcolección sigue en vuelo — y cero semanas de nómina
// se ve igual que una obra que nunca cargó gente.
estado = {};
hacerPatch('0126', { info: { formatoHistorial: { nomina: 2 } } });
hacerPatch('0126', { _nomDoc: [] });
check(!estado['0126']?._listos?.nominaSemanas,
  'con la bandera en subcolección, el documento viejo NO da por resuelta la nómina');
hacerPatch('0126', { _nomSub: [registro] });
check(estado['0126']?._listos?.nominaSemanas === true &&
      (estado['0126'].nominaSemanas || []).length === 1,
  'y al llegar la subcolección sí se resuelve, con sus semanas');

// Y al revés: sin bandera (obra no migrada) manda el documento viejo, aunque
// la subcolección conteste antes con nada.
estado = {};
hacerPatch('0126', { info: {} });
hacerPatch('0126', { _nomSub: [] });
check(!estado['0126']?._listos?.nominaSemanas,
  'sin bandera, una subcolección vacía NO da por resuelta la nómina');
hacerPatch('0126', { _nomDoc: [registro] });
check((estado['0126']?.nominaSemanas || []).length === 1,
  'la obra sin migrar sigue leyendo su documento viejo');

// ── Resultado ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
if (fallos.length === 0) {
  console.log('TODO EN VERDE — las cuatro guardas de fix/arranque se sostienen.');
  process.exit(0);
}
console.log(`${fallos.length} FALLA(S):`);
fallos.forEach(f => console.log('  · ' + f));
process.exit(1);
