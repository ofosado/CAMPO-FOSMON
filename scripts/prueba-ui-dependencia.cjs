#!/usr/bin/env node
// Prueba: un usuario de una organización de tipo `dependencia` NI VE LA
// PESTAÑA NI SUSCRIBE LA RUTA de la economía interna del contratista (P5).
//
// Las dos mitades del título son dos defectos distintos y hay que probar las
// dos, porque arreglar una sola deja el agujero abierto por el otro lado:
//
//   · "ni ve la pestaña" — hasta hoy `TABS_POR_ROL[rol] ||
//     TABS_POR_ROL.director_operaciones` mandaba a `director_obras` —un rol que
//     la tabla no conocía— al menú de constructora, con Gastos incluido. Al
//     director de Obras Públicas del municipio le salía la nómina de FOSMON.
//
//   · "ni suscribe la ruta" — y esto es lo que de verdad importa. Esconder la
//     pestaña y seguir pidiendo la ruta NO es el arreglo. La lectura falla por
//     reglas, `alFallar` resuelve la clave con `[]`, y los KPIs suman ese
//     vacío como CERO. Una dependencia no vería "no disponible": vería
//     "Gasto acumulado $0" y "Margen 100%". Un número falso es peor que un
//     número ausente, y ése es el modo de fallo que esta prueba vigila.
//
// Nada de lo que se afirma aquí es que un nombre exista (P3): se le pregunta
// al menú qué etiquetas entrega, al predicado de suscripción qué rutas admite,
// y al hook de GP cuántos documentos leyó.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta un archivo por argumento justamente para poder correrse contra una
// copia mutilada de App.jsx. Cada mutación de abajo rompe SEMÁNTICA —no
// andamiaje— y se verificó que saca rojo (salida 1), no NO ARRANCÓ (salida 2):
//
//   · `tabsDe` con el respaldo viejo `|| TABS_POR_ROL.director_operaciones`
//        → 2 rojas: al rol de dependencia desconocido le sale Gastos.
//   · borrar `'nomina/historial'` de RUTAS_SOLO_CONSTRUCTORA
//        → 1 roja: la dependencia vuelve a pedir la nómina.
//   · quitar `if (!activo)` de `cargarGP`
//        → 2 rojas: Refrescar lee la contabilidad de FOSMON.
//   · quitar los DOS cortes de `useGPConstruct`
//        → 4 rojas: lee al montar y el estado sale 'sin_sincronizar'.
//   · borrar `soloConstructora: true` de la regla del gasto
//        → 1 roja: se le evalúa una alerta que no es suya.
//   · `CLAVES_BULK_DEPENDENCIA = CLAVES_BULK`
//        → 2 rojas: la pantalla espera para siempre las cinco que no pidió.
//   · borrar `'fin_001'` de RIESGOS_SOLO_CONSTRUCTORA
//        → 2 rojas: el riesgo de margen se cuela.
//   · quitar del `logout` el vaciado de obras y de datos por obra
//        → 2 rojas: el municipio hereda las obras de FOSMON.
//   · `destinoNav` sin el corte: `return { tab: tabId, subTab: subTabId }`
//        → 13 rojas: un clic en «Requiere atención» abre la Operación entera.
//   · borrar `'operacion/avance'` del mapa `DESTINOS_DEPENDENCIA`
//        → 1 roja: la tarjeta queda muerta. El recorte no puede ser "nada
//          lleva a ningún lado"; lo que tiene equivalente tiene que llevar.
//   · en `navTab`, `destinoNav(...) || { tab: tabId, subTab: subTabId }`
//        → 9 rojas. Es la mutación que más tienta —un respaldo "por si
//          acaso"— y es justamente el defecto: caer al destino original es
//          llegar a la pestaña que el menú no ofrece.
//   · `nombreOrg` con el respaldo sin condición: `marca?.empresa ||
//     "FOSMON Construcciones"`
//        → 6 rojas: la barra del municipio vuelve a nombrar al contratista.
//   · volver a pintar el emblema de FOSMON en la barra
//        → 1 roja. Antes esto lo cuidaba `vaElEmblema`, una guardia que
//          escondía la marca del contratista en la sesión del municipio. Con
//          el renombre a cotea el producto ya tiene marca propia y la guardia
//          sobra, pero la REGLA no: se afirma barriendo el JSX, porque lo que
//          se cumple «por construcción» se rompe callado.
//   · borrar `EMB_WHITE`/`EMB_NEGRO` del archivo
//        → 1 roja, y ésta va en la otra dirección. El emblema del contratista
//          sigue siendo correcto en la portada de SU reporte; lo que no puede
//          es llegar a pantalla. Una prueba que sólo empuja hacia un lado
//          acaba pidiendo que se borre lo que no estorba.
//   · el pie pinta `PRODUCTO.descriptor` sin preguntar si hay
//        → 1 roja. Hoy está vacío —no hay eslogan decidido— y sin preguntar
//          el pie dice «cotea — » con la raya colgando.
//   · el pie del reporte ejecutivo vuelve a la sigla vieja
//        → 2 rojas, y hubo que ensanchar el barrido para que las hubiera:
//          miraba sólo JSX y eso es un `T(…)` de jsPDF. Un PDF que el cliente
//          descarga y archiva es donde una marca vieja dura más.
//   · devolver `usuario@fosmon.com.mx` al marcador de la casilla de correo
//        → 1 roja. Lo encontró la captura del preview, no la prueba: la
//          pantalla de acceso le decía al municipio de quién es la app antes
//          de que nadie se identificara, en letra chica.
//   · `vaElReporteEjecutivo = () => true`
//        → 1 roja: se le ofrece el PDF con margen, gasto, almacén y nómina.
//   · volver a escribir «FOSMON CONSTRUCCIONES» a mano en el encabezado
//        → 1 roja, la del barrido. El defecto original eran DOS sitios con la
//          misma cadena literal; arreglar uno dejaba el otro.
//   · `vanLasOT = (usuario, obra) => !!obra?.cargaOT`, como estaba
//        → 1 roja: con la bandera prendida —así está sembrada OBRA DEMO 3—
//          el municipio vuelve a ver «Cargar Orden de Trabajo».
//   · `vaElInterruptorOT = () => false`, escondiéndola "por limpieza"
//        → 1 roja: la constructora se queda sin manera de prender la función.
//   · `vanLasOT = usuario => !esDependencia(usuario)`, ignorando la bandera
//        → 2 rojas: el bloque le aparece a toda obra de constructora.
//   · `camposContrato = () => CAMPOS_CONTRATO.constructora`, dejando el
//     formulario como estaba
//        → 13 rojas: no se pregunta la empresa ejecutante, ni su RFC, ni el
//          supervisor, ni el origen de los recursos, y en cambio se le pide al
//          municipio su propio nombre en «Cliente».
//   · devolver `cliente` a la tabla de dependencia
//        → 1 roja. Vale la pena anotar que la de escritura NO se puso roja:
//          la obra de prueba no trae `cliente`, así que la clave se omite y
//          nada aterriza. El tamaño del formulario lo cuida esta prueba; la
//          otra cuida lo que se escribe.
//   · quitar `fuente:"padron"` de los dos campos de la empresa
//        → 1 roja: la leyenda se deja de pintar y el capturista no sabe por
//          qué escribe a mano un dato que la dependencia ya tiene.
//   · dejar la marca pero recortar la leyenda a «Se captura a mano.»
//        → 1 roja. Es la pareja de la anterior: la marca sin texto en
//          pantalla es una nota para programadores, no una explicación.
//   · `puedeEditarContrato` sin el corte, cayendo a `can(rol, "captura", …)`
//        → 2 rojas aquí y 1 en la de escritura: al supervisor y al
//          administrativo se les ofrece un botón que guarda la mitad.
//   · la etiqueta del sub-tab vuelve a ser `"Presupuesto"` a secas
//        → 3 rojas: al ayuntamiento se le vuelve a llamar «Presupuesto» a lo
//          que no es su presupuesto, y la ruta que se le dicta deja de cuadrar
//          con su propio menú.
//   · borrar `rutaCatalogo` de la columna de dependencia del léxico
//        → 2 rojas: las dos columnas dejan de traducir las mismas claves y la
//          ruta sale `undefined`. Es la razón de que el léxico sean CLAVES.
//   · `pasosDe` sin el corte: `PASOS_BIENVENIDA[rol] || …administrador_obra`
//        → 2 rojas: a los seis roles de dependencia les sale, en su PRIMERA
//          pantalla, un tutorial que los manda a Estimaciones y a Gastos.
//   · el EmptyState de captura vuelve a dictar «Planeación → Presupuesto»
//        → 1 roja. El clic siempre llegó bien —lo traduce `destinoNav`—; lo
//          que estaba mal era el texto, y eso es peor: el usuario busca una
//          pestaña que no existe y reporta como defecto algo que funciona.
//   · devolver «Sube el Excel en Planeación → Presupuesto» a `cmp_001`
//        → 1 roja, y hubo que escribir la comprobación para que la hubiera.
//          Salía VERDE: las plantillas de riesgo no viven dentro de ningún
//          componente y `extra` se arma dentro de `detect`, que para esa sólo
//          dispara sin catálogo. Dos puntos ciegos sumados.
//   · devolver la copia a mano del descriptor a la pantalla de acceso
//        → 1 roja. Ahí estaba, literal, aunque `PRODUCTO` existía desde antes
//          justamente para que no estuviera: el mismo «dos sitios, se arregla
//          uno» del nombre de la organización.
//
// El pie que dictaba «Maquinaria, Personal» al municipio se arregló primero
// con una guardia, `vaElDescriptor`, y horas después el renombre a cotea dejó
// el descriptor vacío y la guardia sin objeto. Las contrapruebas de aquella
// tarde —la guardia puesta, la guardia contestando, el descriptor recortado—
// se fueron con ella; las que quedaron son las de arriba, que afirman la misma
// regla sin depender de que exista tal predicado. Vale la pena el registro:
// una guardia que dura medio día no significa que el arreglo estuviera mal,
// significa que el arreglo de fondo llegó después.
//
// ── Y DOS SOBRE LA PRUEBA MISMA (P4) ───────────────────────────────────────
// Las dos salieron de contraprobar lo de arriba, y las dos eran el banco
// mintiendo, no el producto:
//
//   · renombrar `PASOS_DEPENDENCIA_BASE`
//        → salida 2. Lo atrapa `NECESARIOS`, como debe ser.
//   · romper la FORMA de `LEXICO` sin tocar su nombre (`dependencia` →
//     `dependenciaX`)
//        → salida 2 gracias a `vigilarExcepciones`. ANTES salía 1 con cero
//          FALLA: el banco reventaba al construir el sandbox de la §1 y Node
//          devolvía el mismo código que un rojo. Un `.catch` al final no
//          alcanzaba — esos sandboxes se arman en el ámbito del módulo.
//
// La mutación del `logout` es la que enseñó algo. Con la primera versión de esta
// prueba salía VERDE: el contexto de dependencia no lleva `kpis.mpct`, los
// detectores comparaban contra `undefined` y devolvían null solos. La prueba
// estaba pasando por falta de dato y no por recorte. De ahí el bloque que le
// entrega a propósito el contexto completo del gasto marcado como dependencia.
//
// Mutación que NO saca rojo, y está bien que no: quitar `if (!activo)` sólo del
// efecto de montaje. `cargarGP` tiene su propio corte y se planta igual. El
// corte está en dos sitios a propósito, porque `cargarGP` sale del hook.
//
// Uso:  node scripts/prueba-ui-dependencia.cjs [archivo]

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
// Antes de leer nada: si esto revienta, es NO ARRANCÓ (2) y no rojo (1).
noArranco.vigilarExcepciones(archivo);
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

// OJO con el visitante `FunctionDeclaration`: los otros bancos de prueba sólo
// recorren `VariableDeclarator`, y `useGPConstruct` es una declaración de
// función. Sin esta línea la prueba saldría NO ARRANCÓ diciendo que falta un
// símbolo que sí está — un punto ciego fabricado por el andamiaje (P4).
const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  FunctionDeclaration(p) { if (p.node.id) decl[p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
  ClassDeclaration(p) { decl[p.node.id.name] = src.slice(p.node.start, p.node.end); },
});

// El efecto que carga la marca no es una declaración: es la flecha que va
// dentro de un `useEffect`, y por eso no cae en el `decl` de arriba. Se busca
// por lo que HACE —preguntar por `config/branding`— y no por el nombre de
// ninguna variable, que no tiene.
let efectoMarca = null;
traverse(ast, {
  CallExpression(p) {
    if (p.node.callee.name !== 'useEffect') return;
    const cuerpo = p.node.arguments[0];
    if (!cuerpo) return;
    const texto = src.slice(cuerpo.start, cuerpo.end);
    if (/config\/branding/.test(texto)) efectoMarca ||= texto;
  },
});

const NECESARIOS = [
  'TABS_POR_ROL', 'TABS_DEPENDENCIA', 'tabsDe', 'esDependencia',
  'SUBTABS_OPERACION_DEPENDENCIA', 'SUBTABS_PLANEACION_DEPENDENCIA',
  'RUTAS_SOLO_CONSTRUCTORA', 'seSuscribe',
  'DESTINOS_DEPENDENCIA', 'destinoNav', 'navTab',
  'PRODUCTO', 'nombreOrg', 'vaElReporteEjecutivo',
  'vanLasOT', 'vaElInterruptorOT',
  'CAMPOS_CONTRATO', 'camposContrato', 'ROLES_EDITAN_CONTRATO_D', 'puedeEditarContrato',
  'MODALIDADES_ADJUDICACION', 'PERMISOS', 'can',
  'LEXICO', 'lexico', 'PASOS_DEPENDENCIA_BASE', 'PASOS_BIENVENIDA', 'pasosDe',
  'useGPConstruct',
  'BIBLIOTECA_RIESGOS', 'RIESGOS_SOLO_CONSTRUCTORA', 'detectarRiesgos', 'SEVERIDADES',
  'ALERTA_REGLAS',
  'CLAVES_BULK', 'CLAVES_BULK_DEPENDENCIA', 'datosObraCompletos',
  'MXN', 'avanceFisicoPonderado', 'heImporte',
];
const faltan = NECESARIOS.filter(n => !decl[n]);
if (efectoMarca === null) faltan.push('el efecto que carga orgs/{orgId}/config/branding');
if (faltan.length) noArranco(faltan, archivo);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const seccion = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);

// ════════════════════════════════════════════════════════════════════════════
// 1) EL MENÚ: qué etiquetas le llegan a la pantalla
// ════════════════════════════════════════════════════════════════════════════
const menus = new Function(`"use strict";
  const esDependencia = ${decl['esDependencia']};
  const TABS_DEPENDENCIA = ${decl['TABS_DEPENDENCIA']};
  const TABS_POR_ROL = ${decl['TABS_POR_ROL']};
  const tabsDe = ${decl['tabsDe']};
  const LEXICO = ${decl['LEXICO']};
  return { tabsDe, TABS_POR_ROL,
           SUBTABS_OPERACION_DEPENDENCIA: ${decl['SUBTABS_OPERACION_DEPENDENCIA']},
           SUBTABS_PLANEACION_DEPENDENCIA: ${decl['SUBTABS_PLANEACION_DEPENDENCIA']} };`)();

seccion('El menú');

const ROLES_DEP = ['director_obras', 'subdirector', 'jefe_supervision',
                   'supervisor_obra', 'administrativo', 'contralor'];

// Lo que el municipio tiene que ver. Cinco pestañas: el Dashboard recortado
// carga las cifras del contrato, y las otras cuatro son avance, estimaciones
// —lo que se recibió en ventanilla—, evidencia y contrato.
const ESPERADAS = ['Dashboard', 'Avance', 'Estimaciones', 'Evidencia', 'Contrato'];

for (const rol of ROLES_DEP) {
  const labels = menus.tabsDe({ rol, tipo: 'dependencia' }).map(t => t.label);
  check(JSON.stringify(labels) === JSON.stringify(ESPERADAS),
    `${rol} ve exactamente las cinco pestañas del contrato`, labels.join(' · '));
}

// LO QUE IMPORTA de este bloque: no basta con que salgan las cinco buenas.
// Hay que afirmar que NINGUNA de las palabras de la economía interna aparece,
// porque el defecto original no fue una pestaña de menos sino una de más.
const PROHIBIDAS = /gasto|n[oó]mina|subcontrat|maquinaria|almac[eé]n|margen|personal/i;
for (const rol of ROLES_DEP) {
  const texto = menus.tabsDe({ rol, tipo: 'dependencia' }).map(t => t.label).join(' ');
  check(!PROHIBIDAS.test(texto), `${rol} no ve ninguna etiqueta de economía interna`);
}

// El respaldo. Es el defecto literal que se arregló, y volverá a hacer falta:
// van a llegar roles nuevos de dependencia antes de que nadie toque la tabla.
const rolNuevo = menus.tabsDe({ rol: 'coordinador_juridico', tipo: 'dependencia' });
check(!PROHIBIDAS.test(rolNuevo.map(t => t.label).join(' ')),
  'un rol de dependencia que la tabla NO conoce tampoco cae en el menú de constructora',
  rolNuevo.map(t => t.label).join(' · '));
check(JSON.stringify(rolNuevo.map(t => t.label)) === JSON.stringify(ESPERADAS),
  'y cae en el menú de dependencia, no en uno vacío');

// El contratista de una dependencia es el equivalente al `cliente`: ve lo suyo.
const contratista = menus.tabsDe({ rol: 'contratista', tipo: 'dependencia' }).map(t => t.label);
check(!PROHIBIDAS.test(contratista.join(' ')) && contratista.length > 0,
  'el contratista ve sus propias pestañas, ninguna de economía ajena', contratista.join(' · '));

// La otra mitad del respaldo: una constructora no se quedó sin Gastos por el
// camino. Un recorte que también recorta al que sí debe ver no es un recorte.
const dirOp = menus.tabsDe({ rol: 'director_operaciones', tipo: 'constructora' }).map(t => t.label);
check(dirOp.includes('Gastos'), 'una constructora SÍ conserva Gastos', dirOp.join(' · '));
const rolNuevoC = menus.tabsDe({ rol: 'coordinador_compras', tipo: 'constructora' }).map(t => t.label);
check(rolNuevoC.includes('Gastos'),
  'y un rol nuevo de constructora también, que es para lo que el respaldo servía');

// Sub-pestañas: el recorte tiene que llegar un nivel más abajo, porque entrar
// a Avance y encontrar "Nómina" dentro sería el mismo defecto una capa adentro.
const subOp = menus.SUBTABS_OPERACION_DEPENDENCIA.map(t => t.label).join(' ');
const subPl = menus.SUBTABS_PLANEACION_DEPENDENCIA.map(t => t.label).join(' ');
check(!PROHIBIDAS.test(subOp), 'dentro de Avance no hay sub-pestañas de economía interna', subOp);
check(!PROHIBIDAS.test(subPl), 'dentro de Contrato tampoco', subPl);
check(menus.SUBTABS_OPERACION_DEPENDENCIA.length > 0 && menus.SUBTABS_PLANEACION_DEPENDENCIA.length > 0,
  'y ninguna de las dos quedó vacía — una pestaña sin contenido es una pestaña rota');

// ════════════════════════════════════════════════════════════════════════════
// 2) LAS RUTAS: qué se pide y qué no
// ════════════════════════════════════════════════════════════════════════════
const rutas = new Function(`"use strict";
  const RUTAS_SOLO_CONSTRUCTORA = ${decl['RUTAS_SOLO_CONSTRUCTORA']};
  const seSuscribe = ${decl['seSuscribe']};
  return { seSuscribe };`)();

seccion('Las rutas');

// Estas seis son exactamente las que firestore.rules deja FUERA del lado
// dependencia, a propósito. Si el front pidiera una, la lectura sería rechazada
// y el vacío se sumaría como cero.
const NEGADAS = [
  ['avance/maquinaria',   'equipo propio del contratista'],
  ['avance/materiales',   'almacén del contratista'],
  ['config/otros_gastos', 'gasto manual del contratista'],
  ['nomina/historial',    'personal, formato viejo'],
  ['nomina_historial',    'personal, subcolección'],
  ['subcontratos/lista',  'a quién le paga el contratista'],
];
for (const [ruta, porque] of NEGADAS) {
  check(rutas.seSuscribe(ruta, 'dependencia') === false,
    `una dependencia NO pide ${ruta}`, porque);
}

// Y éstas son su propio dinero y su propia obra. Cortarlas de más dejaría la
// pantalla en blanco, que es el otro modo de fallar.
const PERMITIDAS = [
  ['config/info',          'la ficha de la obra'],
  ['avance/subs',          'el avance capturado'],
  ['avance/historial',     'el histórico semanal'],
  ['config/estimaciones',  'lo que el municipio le paga a su contratista'],
  ['config/catalogo',      'el catálogo contratado'],
];
for (const [ruta, porque] of PERMITIDAS) {
  check(rutas.seSuscribe(ruta, 'dependencia') === true,
    `una dependencia SÍ pide ${ruta}`, porque);
}

// Una constructora sigue pidiéndolo todo. El corte es por tipo, no global.
check(NEGADAS.every(([r]) => rutas.seSuscribe(r, 'constructora') === true),
  'una constructora sigue pidiendo las seis');

// El discriminante es `tipo`, no la presencia de `orgId`: los 14 usuarios de
// FOSMON ya traen orgId y sus obras siguen en la raíz. Un tipo ausente no
// puede recortar — recortarle a una sesión a medio resolver le vaciaría los
// KPIs a un usuario de constructora.
check(rutas.seSuscribe('nomina/historial', undefined) === true,
  'sin tipo resuelto no se recorta: el corte lo decide `tipo`, nada más');

// ════════════════════════════════════════════════════════════════════════════
// 3) EL GP SHEET: cuántos documentos se leyeron
// ════════════════════════════════════════════════════════════════════════════
// El chip "GP Sheet · hace X horas" vive en la primera pantalla. El hook que lo
// alimenta arranca AL MONTAR, antes de que exista una pantalla que esconder, y
// lee `global/gp_construct` — la contabilidad de FOSMON, un documento que no
// lleva prefijo de organización. Por eso el corte no puede estar en el chip:
// tiene que estar en el hook. Se cuenta leyendo, no mirando el código.
seccion('El GP Sheet');

const montarGP = () => {
  const leidos = [];
  const estados = [];
  const timers = [];
  const fakeSetTimeout = () => { timers.push(1); return timers.length; };
  const fabrica = new Function(
    'useState', 'useCallback', 'useEffect', 'getDoc', 'doc', 'fsGet',
    'httpsCallable', 'fbDb', 'fbFn', 'setTimeout', 'clearTimeout', '_estados',
    `"use strict";
     ${decl['useGPConstruct']}
     return useGPConstruct;`);

  // Hooks de mentira: no hay React. Alcanza para observar el efecto de montaje,
  // que es donde ocurre —o no— la lectura.
  const useState = inicial => {
    let v = inicial;
    return [v, nuevo => { estados.push(typeof nuevo === 'function' ? '(fn)' : nuevo); }];
  };
  const useCallback = fn => fn;
  const efectos = [];
  const useEffect = fn => { efectos.push(fn); };
  const getDoc = async (ref) => { leidos.push(ref.ruta); return { exists: () => false }; };
  const doc = (_db, ...segs) => ({ ruta: segs.join('/') });
  const fsGet = async (ruta) => { leidos.push(ruta); return null; };
  const httpsCallable = () => async () => ({ data: {} });

  const useGPConstruct = fabrica(useState, useCallback, useEffect, getDoc, doc, fsGet,
    httpsCallable, {}, {}, fakeSetTimeout, () => {}, estados);

  return { useGPConstruct, leidos, estados, correrEfectos: () => efectos.forEach(f => f()) };
};

(async () => {
  // 3a) Dependencia: el hook inactivo no lee NADA.
  {
    const g = montarGP();
    const api = g.useGPConstruct(false);
    g.correrEfectos();
    await new Promise(r => setImmediate(r));
    check(g.leidos.length === 0,
      'en una dependencia el GP Sheet no se lee: cero documentos',
      g.leidos.length ? g.leidos.join(', ') : 'ninguno');
    check(g.estados.includes('inactivo'),
      'y el estado dice "inactivo", no "error": no aplica ≠ falló',
      g.estados.filter(e => typeof e === 'string').join(' → '));
    check(api.gpDisponible === false,
      'el dato no está disponible, así que el chip no tiene nada que anunciar');

    // `cargarGP` y `reintentarGP` salen del hook: cualquier pantalla puede
    // llamarlas. Si el corte viviera sólo en el efecto de montaje, un botón
    // Refrescar heredado bastaría para pedir la contabilidad de FOSMON.
    await api.cargarGP();
    await api.reintentarGP(true);
    check(g.leidos.length === 0,
      'ni siquiera llamando a cargarGP/reintentarGP a mano se lee nada',
      g.leidos.join(', ') || 'ninguno');

    const det = await api.cargarDetalleObra('0114');
    check(det === null && g.leidos.length === 0,
      'y el detalle por obra devuelve null sin pedir el documento de detalle');
  }

  // 3b) Constructora: el mismo banco SÍ registra la lectura. Sin esto, el
  //     "cero lecturas" de arriba no probaría nada — podría ser un banco que
  //     no sabe contar.
  {
    const g = montarGP();
    g.useGPConstruct(true);
    g.correrEfectos();
    await new Promise(r => setImmediate(r));
    check(g.leidos.includes('global/gp_construct'),
      'una constructora SÍ lee global/gp_construct — el banco sabe contar',
      g.leidos.join(', ') || 'ninguno');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4) LOS MOTORES DE RIESGO: qué alerta se le enseña
  // ══════════════════════════════════════════════════════════════════════════
  // Son DOS motores distintos y los dos se recortan. Una alerta de margen en
  // la pantalla de un municipio no sólo sobra: con el gasto en cero diría
  // "margen 100%" o "brecha 0", y eso es información falsa.
  seccion('Los motores de riesgo');

  const motor = new Function(`"use strict";
    const MXN = ${decl['MXN']};
    const SEVERIDADES = ${decl['SEVERIDADES']};
    const heImporte = ${decl['heImporte']};
    const importeCatalogoPartida = ${decl['importeCatalogoPartida']};
    const importeEjecutadoPartida = ${decl['importeEjecutadoPartida']};
    const avanceFisicoPonderado = ${decl['avanceFisicoPonderado']};
    const BIBLIOTECA_RIESGOS = ${decl['BIBLIOTECA_RIESGOS']};
    const RIESGOS_SOLO_CONSTRUCTORA = ${decl['RIESGOS_SOLO_CONSTRUCTORA']};
    const detectarRiesgos = ${decl['detectarRiesgos']};
    const ALERTA_REGLAS = ${decl['ALERTA_REGLAS']};
    return { detectarRiesgos, ALERTA_REGLAS };`)();

  // Una obra con margen negativo, nómina cara y sin captura reciente: da
  // material a los detectores de las dos familias a la vez.
  const hace30dias = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const obra = { id: '0125', nombre: 'OBRA DEMO 1', presupuesto: 10000000,
                 inicio: '2026-01-15', fin: '2026-06-30', diasPago: 30 };
  const subs = [
    { sec: 'A-1', sub: 'Terracerías', a: 40, imp: 4000000, cant: 100, pu: 40000, cantEjec: 40 },
    { sec: 'A-2', sub: 'Pavimento',   a: 20, imp: 6000000, cant: 200, pu: 30000, cantEjec: 40 },
  ];
  const ctxBase = {
    obra, subs,
    maquinaria: [{ imp: 900000 }],
    materiales: [{ imp: 700000 }],
    estimaciones: [{ num: 1, monto: 1500000, estatus: 'facturada', fecha: hace30dias }],
    subcontratos: [{ nombre: 'SUB SA', monto: 3000000, pagado: 2900000 }],
    historialAvance: [],
    gpData: null,
    nominaHistorial: [],
  };
  const kpisC = { me: 2800000, gt: 8000000, mpct: -185, af: 28, pctGasto: 80, brecha: 52 };

  const riesgosC = motor.detectarRiesgos({ ...ctxBase, kpis: kpisC });
  const riesgosD = motor.detectarRiesgos({
    tipo: 'dependencia', obra, subs,
    estimaciones: ctxBase.estimaciones, historialAvance: [],
    kpis: { af: 28, me: 2800000 },
  });

  const FAMILIAS_VEDADAS = /^(fin_001|fin_002|fin_006|nom_|mat_|maq_|sub_|gst_|ctr_002)/;
  const colados = riesgosD.filter(r => FAMILIAS_VEDADAS.test(r.id));
  check(colados.length === 0,
    'a una dependencia no le llega ningún riesgo de economía interna',
    colados.length ? colados.map(r => r.id + ':' + r.titulo).join(' | ') : `${riesgosD.length} riesgos, ninguno vedado`);

  const textoD = riesgosD.map(r => `${r.titulo} ${r.descripcion} ${r.detalle || ''} ${r.extra || ''}`).join(' ');
  check(!PROHIBIDAS.test(textoD),
    'y ni el texto de los que sí le llegan menciona margen, gasto, nómina ni almacén',
    PROHIBIDAS.exec(textoD)?.[0] || 'limpio');

  // LA MISMA PREGUNTA, PERO CON LOS DATOS PUESTOS. Hace falta aparte, y la
  // contraprueba lo demostró: si se borra un id de RIESGOS_SOLO_CONSTRUCTORA,
  // la comprobación de arriba sigue en verde. No porque el recorte funcione,
  // sino porque al contexto de dependencia no le llega un `kpis` con gasto y
  // los detectores comparan contra `undefined`, que nunca cumple la condición.
  // O sea: estaría pasando por falta de dato, no por recorte — y el día que
  // alguien le pase un kpis con ceros, el riesgo dispararía diciendo
  // "margen 100%". Así que se le entrega a propósito el contexto COMPLETO de
  // constructora marcado como dependencia: si algo se cuela, es el filtro el
  // que falló, y no hay excusa de dato ausente.
  const riesgosDconDatos = motor.detectarRiesgos({ ...ctxBase, tipo: 'dependencia', kpis: kpisC });
  const coladosConDatos = riesgosDconDatos.filter(r => FAMILIAS_VEDADAS.test(r.id));
  check(coladosConDatos.length === 0,
    'aun entregándole los datos del gasto, la biblioteca se niega a emitirlos',
    coladosConDatos.length ? coladosConDatos.map(r => r.id + ':' + r.titulo).join(' | ') : 'ninguno se coló');
  const textoConDatos = riesgosDconDatos
    .map(r => `${r.titulo} ${r.descripcion} ${r.detalle || ''} ${r.extra || ''}`).join(' ');
  check(!PROHIBIDAS.test(textoConDatos),
    'y el texto tampoco: el recorte es por id, no por casualidad',
    PROHIBIDAS.exec(textoConDatos)?.[0] || 'limpio');

  // La misma obra del lado constructora SÍ dispara los de economía. Si no, el
  // vacío de arriba no probaría el recorte: probaría que no había nada que
  // recortar.
  check(riesgosC.some(r => FAMILIAS_VEDADAS.test(r.id)),
    'la misma obra en una constructora SÍ dispara los de economía interna',
    riesgosC.filter(r => FAMILIAS_VEDADAS.test(r.id)).map(r => r.id).join(' ') || 'ninguno');

  // Y a la dependencia le tiene que quedar algo. Un recorte que la deja ciega
  // es tan inútil como no recortar: el plazo y el avance son suyos.
  check(riesgosD.length > 0,
    'a la dependencia le siguen llegando los riesgos que sí son suyos',
    riesgosD.map(r => r.id).join(' ') || 'NINGUNO');

  // ── Segundo motor: las alertas del portafolio ──────────────────────────────
  const reglasDep = motor.ALERTA_REGLAS.filter(r => !r.soloConstructora);
  const hoy = Date.now();
  // Los datos que una dependencia realmente tiene: sin totGasto, porque las
  // tres rutas que lo componen no se piden.
  const datosDep = { fechaUltCaptura: hace30dias, totGasto: 0, avancePct: 28,
                     tieneOficialEstaSemana: false, ejecutado: 2800000 };

  const dispararonDep = reglasDep
    .map(r => ({ id: r.id, titulo: r.titulo, r: r.evaluar(obra, datosDep, hoy) }))
    .filter(x => x.r);
  check(!dispararonDep.some(x => PROHIBIDAS.test(x.titulo + ' ' + x.r.detalle)),
    'ninguna alerta del portafolio le habla de gasto a una dependencia',
    dispararonDep.map(x => x.id).join(' ') || 'ninguna disparó');
  check(dispararonDep.length > 0,
    'pero sí le llega la de sin captura, que es la que le sirve',
    dispararonDep.map(x => x.titulo).join(' | '));

  // Y la razón de fondo por la que la regla del gasto se saca en vez de
  // dejarla: con los datos de una dependencia nunca podría dispararse. Una
  // alerta inerte no es inocua — ocupa el lugar de la que sí importaba.
  const reglaGasto = motor.ALERTA_REGLAS.find(r => /gasto/i.test(r.titulo));
  check(!!reglaGasto && reglaGasto.evaluar(obra, datosDep, hoy) === null,
    'la regla del gasto, con los datos de una dependencia, jamás dispararía',
    reglaGasto ? 'inerte' : 'no existe');
  check(!!reglaGasto && !reglasDep.includes(reglaGasto),
    'por eso no se le evalúa: está marcada como sólo constructora');
  const datosC = { ...datosDep, totGasto: 9500000 };
  check(!!reglaGasto && reglaGasto.evaluar(obra, datosC, hoy) !== null,
    'y en una constructora, con gasto real, sí dispara');

  // ══════════════════════════════════════════════════════════════════════════
  // 4bis) A DÓNDE LLEVAN LOS ENLACES
  // ══════════════════════════════════════════════════════════════════════════
  // Lo de arriba prueba QUÉ riesgos le llegan. Esto prueba A DÓNDE llevan al
  // picarlos, que resultó ser otro agujero entero.
  //
  // Medido en el emulador el 2026-10-01, con OBRA DEMO 3 y el plazo vencido:
  // la tarjeta «Avance vs plazo desbalanceado» del tablero de dependencia
  // abría la Operación COMPLETA de constructora —Avance físico · Estimaciones ·
  // Nómina · Subcontratos · Maquinaria · Almacén— y desde ahí Nómina pintaba
  // «Cargar nómina». Un clic deshacía el recorte entero.
  //
  // La causa no estaba en el menú ni en el filtro de riesgos, los dos
  // correctos: las plantillas que SÍ le llegan traen destinos escritos del
  // lado constructora (`tab:'operacion'`, `subTab:'avance'`), `setTab` pintaba
  // cualquier id que se le diera, y el sitio de render le pasaba la lista de
  // sub-pestañas POR OMISIÓN en vez de la recortada.
  //
  // Se corre el `navTab` de producción con dobles en lugar de los setters y se
  // le pregunta qué pestaña activó. No se afirma que exista ningún nombre (P3).
  seccion('A dónde llevan los enlaces');

  const nav = new Function('tipo', `"use strict";
    const esDependencia = ${decl['esDependencia']};
    const DESTINOS_DEPENDENCIA = ${decl['DESTINOS_DEPENDENCIA']};
    const destinoNav = ${decl['destinoNav']};
    return (tabPedido, subTabPedido) => {
      const visto = { tab: 'no se movió', subOper: 'no se movió', subPlan: 'no se movió' };
      const usuario = { rol: 'supervisor_obra', tipo };
      const setTab = v => { visto.tab = v; };
      const setSubTabOper = v => { visto.subOper = v; };
      const setSubTabPlan = v => { visto.subPlan = v; };
      const navTab = ${decl['navTab']};
      navTab(tabPedido, subTabPedido);
      return visto;
    };`);
  const navDep  = nav('dependencia');
  const navCons = nav('constructora');

  const IDS_DEP = new Set(menus.TABS_DEPENDENCIA
    ? menus.TABS_DEPENDENCIA.map(t => t.id)
    : menus.tabsDe({ rol: 'supervisor_obra', tipo: 'dependencia' }).map(t => t.id));
  const SUB_DEP = new Set([
    ...menus.SUBTABS_OPERACION_DEPENDENCIA.map(t => t.id),
    ...menus.SUBTABS_PLANEACION_DEPENDENCIA.map(t => t.id),
  ]);

  // LO QUE IMPORTA: ningún destino de la biblioteca de riesgos puede sacar a
  // una dependencia de sus cinco pestañas. Se recorren TODOS los destinos que
  // existen en las plantillas, no una muestra, porque el que se cuele va a ser
  // justo el que no se le ocurrió a nadie.
  const destinosBiblioteca = [...new Set(
    motor.detectarRiesgos({ ...ctxBase, kpis: kpisC })
      .concat(riesgosD)
      .map(r => JSON.stringify([r.tab, r.subTab || null])))].map(JSON.parse);
  const fugas = [];
  for (const [t, st] of destinosBiblioteca) {
    const v = navDep(t, st);
    const destino = st ? `${t}/${st}` : t;
    if (v.tab === 'no se movió') continue;            // no navegó: correcto
    if (!IDS_DEP.has(v.tab)) { fugas.push(`${destino} → pestaña ${v.tab}`); continue; }
    const sub = v.subOper !== 'no se movió' ? v.subOper
              : v.subPlan !== 'no se movió' ? v.subPlan : null;
    if (sub && !SUB_DEP.has(sub)) fugas.push(`${destino} → sub-pestaña ${sub}`);
  }
  check(fugas.length === 0,
    'ningún destino de la biblioteca de riesgos saca a una dependencia de sus pestañas',
    fugas.length ? fugas.join(' | ') : `${destinosBiblioteca.length} destinos revisados`);

  // Los destinos nombrados, uno por uno. Los de economía interna no navegan:
  // `null` quiere decir que la tarjeta no se puede ni picar. El corte es NO
  // LLEVAR, no llevar-y-esconder — igual que con las rutas.
  const NO_LLEVAN = [
    ['operacion', 'nomina',       'la nómina del contratista'],
    ['operacion', 'almacen',      'el almacén del contratista'],
    ['operacion', 'maquinaria',   'su equipo propio'],
    ['operacion', 'subcontratos', 'a quién le paga'],
    ['gastos',     null,          'la contabilidad de FOSMON'],
    ['planeacion', 'permisos',    'administración del sistema'],
    ['operacion',  null,          'la Operación entera'],
    ['planeacion', null,          'la Planeación entera'],
  ];
  for (const [t, st, porque] of NO_LLEVAN) {
    const v = navDep(t, st);
    check(v.tab === 'no se movió',
      `una dependencia no llega a ${st ? `${t}/${st}` : t}`,
      v.tab === 'no se movió' ? porque : `ABRIÓ ${v.tab}`);
  }

  // Y los que sí tienen equivalente llevan a donde corresponde. Un recorte que
  // deja «Requiere atención» muerto no es un recorte: es una tarjeta inerte.
  const LLEVAN = [
    [['operacion', 'avance'],       { tab: 'avance',   subOper: 'avance' }],
    [['planeacion', 'contrato'],    { tab: 'contrato', subPlan: 'contrato' }],
    [['planeacion', 'presupuesto'], { tab: 'contrato', subPlan: 'presupuesto' }],
    [['avance', null],              { tab: 'avance',   subOper: 'avance' }],
  ];
  for (const [[t, st], esperado] of LLEVAN) {
    const v = navDep(t, st);
    const ok = v.tab === esperado.tab
      && (!esperado.subOper || v.subOper === esperado.subOper)
      && (!esperado.subPlan || v.subPlan === esperado.subPlan);
    check(ok, `${st ? `${t}/${st}` : t} lleva a ${esperado.tab}`,
      `tab=${v.tab} subOper=${v.subOper} subPlan=${v.subPlan}`);
  }

  // Al menos una de las tarjetas que esta obra dispara tiene que ser clicable.
  // Si no, la prueba de arriba estaría pasando porque no lleva a ningún lado
  // nunca, que es el otro modo de fallar.
  const vivas = riesgosD.filter(r => navDep(r.tab, r.subTab).tab !== 'no se movió');
  check(vivas.length > 0,
    'y las tarjetas que sí tienen equivalente siguen llevando a su pantalla',
    vivas.map(r => r.id).join(' ') || 'NINGUNA — "Requiere atención" quedó muerto');

  // La otra mitad: en una constructora NADA cambió. Un recorte que también
  // recorta al que sí debe navegar no es un recorte.
  for (const [t, st] of [['operacion', 'nomina'], ['gastos', null], ['planeacion', 'permisos']]) {
    const v = navCons(t, st);
    check(v.tab === t, `una constructora sigue llegando a ${st ? `${t}/${st}` : t}`,
      `tab=${v.tab} subOper=${v.subOper} subPlan=${v.subPlan}`);
  }
  check(navCons('operacion', 'nomina').subOper === 'nomina',
    'y con su sub-pestaña puesta, como siempre');

  // ══════════════════════════════════════════════════════════════════════════
  // 4ter) QUÉ DICE LA BARRA DE ARRIBA, Y QUÉ SE PUEDE DESCARGAR
  // ══════════════════════════════════════════════════════════════════════════
  // Lo primero que ve el cliente. En la sesión del municipio el encabezado
  // decía «CAMPO / FOSMON CONSTRUCCIONES»: la app se presentaba como si fuera
  // de su contratista. Y el botón de «Reporte ejecutivo» seguía ahí, con un
  // PDF que lleva margen bruto, desglose de gasto, almacén y nómina —rutas
  // que en dependencia no se piden, así que habría impreso Gasto $0 y Margen
  // 100% con el logo de FOSMON en la portada.
  //
  // No se afirma que exista ningún nombre (P3): se le pregunta a `nombreOrg`
  // qué cadena entrega la pantalla y a los dos predicados qué se ofrece.
  seccion('La barra de arriba');

  const bar = new Function(`"use strict";
      const esDependencia = ${decl['esDependencia']};
      const PRODUCTO = ${decl['PRODUCTO']};
      const nombreOrg = ${decl['nombreOrg']};
      const vaElReporteEjecutivo = ${decl['vaElReporteEjecutivo']};
      const vanLasOT = ${decl['vanLasOT']};
      const vaElInterruptorOT = ${decl['vaElInterruptorOT']};
      return { PRODUCTO, nombreOrg, vaElReporteEjecutivo,
               vanLasOT, vaElInterruptorOT };`)();

  const DEP  = { rol: 'supervisor_obra', tipo: 'dependencia',  orgId: 'coatzacoalcos' };
  const CONS = { rol: 'director_general', tipo: 'constructora', orgId: 'fosmon' };
  const MUNI = { empresa: 'H. Ayuntamiento de Coatzacoalcos' };

  // Sin marca capturada, la línea no se pinta. `null` es la única respuesta
  // honesta: no se sabe de quién es la organización, y adivinar es cómo
  // apareció FOSMON ahí.
  check(bar.nombreOrg(null, DEP) === null,
    'en una dependencia sin marca capturada el encabezado no nombra a nadie',
    JSON.stringify(bar.nombreOrg(null, DEP)));
  check(bar.nombreOrg(undefined, DEP) === null,
    'y tampoco mientras la marca va cargando');

  // Con marca, dice la del municipio — y en ningún caso la del contratista.
  check(bar.nombreOrg(MUNI, DEP) === MUNI.empresa,
    'con marca capturada dice el nombre del municipio', bar.nombreOrg(MUNI, DEP));
  for (const m of [null, undefined, {}, MUNI, { empresa: '' }]) {
    const v = bar.nombreOrg(m, DEP) || '';
    check(!/fosmon/i.test(v),
      `ninguna variante de marca le nombra FOSMON a una dependencia  (${JSON.stringify(m)})`,
      v || 'sin línea');
  }

  // El nombre del producto es del producto: el mismo para los dos y sin
  // nombre de organización adentro. Si algún día se escribe «CAMPO FOSMON»
  // ahí, esto se pone rojo.
  check(typeof bar.PRODUCTO.nombre === 'string' && bar.PRODUCTO.nombre.length > 0
     && !/fosmon|ayuntamiento/i.test(bar.PRODUCTO.nombre),
    'el nombre del producto no nombra a ninguna organización', bar.PRODUCTO.nombre);

  // La constructora no pierde nada: es su app y su nombre.
  check(bar.nombreOrg(null, CONS) === 'FOSMON Construcciones',
    'una constructora sin marca capturada sigue diciendo FOSMON Construcciones',
    bar.nombreOrg(null, CONS));
  check(bar.nombreOrg({ empresa: 'Constructora Ajena SA' }, CONS) === 'Constructora Ajena SA',
    'y si capturó otra marca, manda la capturada: el respaldo es respaldo, no regla');

  // ── La marca del producto ──────────────────────────────────────────────────
  // Aquí vivían las comprobaciones de `vaElEmblema` y `vaElDescriptor`. Las dos
  // guardias se fueron con el renombre a cotea porque eran parches de «el
  // producto no tiene marca propia»: una escondía el emblema de FOSMON y la
  // otra el desarrollo de la sigla CAMPO. Ahora hay marca y el descriptor está
  // vacío, así que no hay nada que esconder.
  //
  // Lo que NO se puede ir con ellas es la REGLA: en la sesión de un municipio
  // no se pinta marca del contratista. Hoy se cumple por construcción —no
  // queda dónde pintarla— y lo que se cumple por construcción se rompe
  // callado, que es exactamente cómo apareció «CAMPO / FOSMON CONSTRUCCIONES»
  // en la barra del cliente. Así que se afirma sobre la fuente.
  const marcaAjena = [];
  traverse(ast, {
    JSXIdentifier(p) {
      if (!/^Emblema|FOSMON$/i.test(p.node.name)) return;
      if (!p.parentPath.isJSXOpeningElement()) return;
      marcaAjena.push(`<${p.node.name}> en ${src.slice(p.node.start - 60, p.node.start).trim().slice(-50)}`);
    },
  });
  check(marcaAjena.length === 0,
    'ninguna pantalla pinta el emblema del contratista: la marca en pantalla es la del producto',
    marcaAjena.length ? '\n        ' + marcaAjena.join('\n        ') : 'ninguna');

  // El emblema de FOSMON sigue existiendo donde SÍ es suyo —la portada del
  // reporte ejecutivo— y eso no es un descuido. Por eso la comprobación de
  // arriba mira el JSX y no la fuente entera: el PDF no es JSX, lo arma
  // `generarPDFObra` con jsPDF, y a una dependencia no se le ofrece.
  check(/EMB_(WHITE|NEGRO)/.test(src),
    'y el emblema del contratista no se borró del mundo: sigue en su propio reporte',
    'EMB_WHITE / EMB_NEGRO, que usa `generarPDFObra`');

  // ── El descriptor ──────────────────────────────────────────────────────────
  // Vacío a propósito mientras no haya eslogan decidido. Lo que se afirma no es
  // que esté vacío —eso lo cambia quien decida el eslogan— sino que VACÍO
  // signifique no pintar nada. Si alguien lo pinta sin preguntar, el pie dice
  // «cotea — » con la raya colgando, y eso se ve en la demo.
  check(typeof bar.PRODUCTO.descriptor === 'string',
    'el descriptor es una cadena, aunque hoy esté vacía: el campo queda preparado',
    JSON.stringify(bar.PRODUCTO.descriptor));

  const descriptorSinPreguntar = [];
  traverse(ast, {
    MemberExpression(p) {
      if (!(p.node.object.name === 'PRODUCTO' && p.node.property.name === 'descriptor')) return;
      if (!p.findParent(q => q.isJSXElement() || q.isJSXFragment())) return;
      // Pintarlo es correcto SI algo preguntó antes si hay. La pregunta vive en
      // el `&&` de arriba —`{PRODUCTO.descriptor && …}`— o en el `if` que
      // envuelve. Basta con que el sitio esté dentro de una condición cuyo
      // examen sea el propio descriptor.
      const guardado = p.findParent(q =>
        (q.isLogicalExpression() && q.node.operator === '&&'
         && /PRODUCTO\s*\.\s*descriptor/.test(src.slice(q.node.left.start, q.node.left.end)))
        || (q.isConditionalExpression()
            && /PRODUCTO\s*\.\s*descriptor/.test(src.slice(q.node.test.start, q.node.test.end))));
      if (!guardado)
        descriptorSinPreguntar.push(src.slice(p.node.start - 45, p.node.end + 15).replace(/\s+/g, ' '));
    },
  });
  check(descriptorSinPreguntar.length === 0,
    'el descriptor sólo se pinta donde alguien preguntó si hay descriptor',
    descriptorSinPreguntar.length
      ? '\n        SIN PREGUNTAR: ' + descriptorSinPreguntar.join('\n        SIN PREGUNTAR: ')
      : 'los sitios que lo pintan preguntan antes');

  // Y el barrido de siempre: ninguna copia a mano del desarrollo de la sigla
  // vieja. La pantalla de acceso lo tenía literal aunque `PRODUCTO` existía
  // desde antes justamente para que no lo tuviera.
  //
  // Barre TODA cadena del archivo, no sólo el JSX. La primera versión miraba
  // JSX y habría dejado pasar el pie de la portada del reporte ejecutivo, que
  // es un `T('CAMPO — Control de Avance, …')` de jsPDF: un PDF que el cliente
  // descarga y archiva, o sea el sitio donde una marca vieja dura más. Las
  // cadenas son nodos, así que los comentarios que cuentan esta historia —y
  // que nombran la sigla— no cuentan como copias.
  const copiasViejas = [];
  const SIGLA_VIEJA = /Control de Avance,\s*Maquinaria/i;
  traverse(ast, {
    StringLiteral(p) { if (SIGLA_VIEJA.test(p.node.value)) copiasViejas.push(p.node.value.slice(0, 70)); },
    TemplateLiteral(p) {
      const v = src.slice(p.node.start, p.node.end);
      if (SIGLA_VIEJA.test(v)) copiasViejas.push(v.slice(0, 70));
    },
    JSXText(p) { if (SIGLA_VIEJA.test(p.node.value)) copiasViejas.push(p.node.value.trim()); },
  });
  check(copiasViejas.length === 0,
    'el desarrollo de la sigla vieja no quedó escrito a mano en ninguna cadena  ·  PDF incluido',
    copiasViejas.length ? copiasViejas.join(' | ') : 'ninguna');

  // Y el nombre viejo tampoco, donde el cliente lo lee. `CAMPO` en mayúsculas
  // es también una palabra común —«personal en campo», `CAMPOS_CONTRATO`— así
  // que no se puede barrer el archivo entero a ciegas: se barren las cadenas
  // que terminan en pantalla o en papel, y se pide la palabra suelta.
  const nombreViejo = [];
  const NOMBRE_VIEJO = /(^|[^A-Za-z_])CAMPO([^A-Za-z_]|$)/;
  const EXCEPCIONES = /PERSONAL EN CAMPO|En CAMPO/;   // «personal en campo», y una etiqueta de consola
  traverse(ast, {
    StringLiteral(p) {
      const v = p.node.value;
      if (NOMBRE_VIEJO.test(v) && !EXCEPCIONES.test(v)) nombreViejo.push(v.slice(0, 60));
    },
    JSXText(p) {
      const v = p.node.value;
      if (NOMBRE_VIEJO.test(v) && !EXCEPCIONES.test(v)) nombreViejo.push(v.trim().slice(0, 60));
    },
  });
  check(nombreViejo.length === 0,
    'ninguna cadena visible sigue llamándole CAMPO al producto',
    nombreViejo.length ? nombreViejo.join(' | ') : `se llama ${bar.PRODUCTO.nombre}`);

  // Y el dominio del contratista tampoco se usa de ejemplo en pantalla. Lo
  // encontró la captura del preview: la casilla de correo de la pantalla de
  // acceso traía `usuario@fosmon.com.mx` de marcador. Es el mismo defecto que
  // el emblema —la app se presenta como del contratista antes de que nadie se
  // identifique— sólo que en letra chica, que es donde nadie lo busca.
  const dominioAjeno = [];
  traverse(ast, {
    JSXAttribute(p) {
      const v = p.node.value;
      if (!v || v.type !== 'StringLiteral') return;
      if (/@fosmon\.com/i.test(v.value))
        dominioAjeno.push(`${p.node.name.name}="${v.value}"`);
    },
  });
  check(dominioAjeno.length === 0,
    'ninguna casilla usa el dominio del contratista de ejemplo',
    dominioAjeno.length ? dominioAjeno.join(' | ') : 'ninguna');

  // El PDF.
  check(bar.vaElReporteEjecutivo(DEP) === false,
    'a una dependencia no se le ofrece el reporte ejecutivo  ·  margen, gasto, almacén y nómina');
  check(bar.vaElReporteEjecutivo(CONS) === true,
    'y a una constructora sí: es su reporte');

  // ── EL BARRIDO DE NOMBRES PROPIOS ──────────────────────────────────────────
  // Que no haya quedado una copia escrita a mano del nombre de la organización
  // —el defecto original eran DOS sitios con la misma cadena y arreglar uno
  // dejaba el otro— y, más ancho, que ningún texto de pantalla nombre a un
  // CLIENTE, una OBRA o un dato del contratista.
  //
  // POR QUÉ SE ENSANCHÓ. La versión anterior miraba sólo `JSXText` y
  // contenedores cuya expresión ES la cadena. Por ese hueco pasó, durante
  // meses, la ayuda del modo de captura:
  //
  //     {v:"volumen", lbl:"…", desc:"…pueden variar (TAMSA, servicios
  //      especializados)."}
  //
  // Un director de Obras Públicas del municipio que entrara a editar el
  // contrato leía ahí el nombre de un cliente industrial del contratista. No
  // era JSXText: era el valor de una propiedad de un objeto que se pinta más
  // abajo con `{opt.desc}`. El barrido no podía verlo y nadie más iba a mirar.
  //
  // Así que ahora también se miran los valores de las propiedades y los
  // atributos que LLEVAN TEXTO A PANTALLA, y la lista de nombres ya no es sólo
  // «FOSMON». Las obras de la constructora se llaman todas «TAMSA …», «PEMEX
  // …», «SIOP …», así que vigilar los prefijos vigila los nombres de obra.
  const NOMBRES_PROPIOS = /\b(TAMSA|PEMEX|SIOP|CONALEP)\b|FOSMON|fosmon\.com\.mx/i;
  const PROPS_QUE_SE_VEN = new Set(['placeholder', 'title', 'mensaje', 'desc',
    'descripcion', 'label', 'lbl', 'ayuda', 'tooltip', 'aria-label', 'alt',
    'texto', 'titulo', 'subtitulo', 'leyenda', 'nota', 'etiqueta', 'hint']);

  // Lo que SÍ puede nombrar al contratista, y por qué. Cada excepción nombra
  // la guardia que la mantiene fuera de la sesión del municipio: sin eso la
  // lista sería una manera de callar el barrido. Se comparan por FRAGMENTO y
  // no por línea, que las líneas se mueven.
  //
  // Una excepción que ya no corresponde a nada NO se reporta como roja: que
  // alguien borre una mención a FOSMON es exactamente lo que se quería. Se
  // anota para que se limpie.
  const PERMITIDAS = [
    { frag: 'usuario@fosmon.com.mx',
      guardia: 'el marcador es un ternario sobre `esDep`; a la dependencia le dice `usuario@dependencia.gob.mx`' },
    { frag: 'los equipos de FOSMON asignados',
      guardia: 'sub-pestaña «maquinaria», que no está en SUBTABS_OPERACION_DEPENDENCIA' },
    { frag: 'Recomendado para TAMSA',
      guardia: '`vaElInterruptorOT(usuario)`, que es `!esDependencia(usuario)`' },
  ];

  const nombresEnPantalla = [];
  const aptar = (donde, nodo, texto) => {
    if (!NOMBRES_PROPIOS.test(texto)) return;
    const n = String(texto).trim().replace(/\s+/g, ' ');
    const linea = src.slice(0, nodo.start).split('\n').length;
    if (PERMITIDAS.some(e => n.includes(e.frag))) return;
    nombresEnPantalla.push(`${donde}:${linea} «${n.slice(0, 80)}»`);
  };
  traverse(ast, {
    JSXText(p) { aptar('texto', p.node, p.node.value); },
    // Sólo el contenedor cuya expresión ES la cadena —`{'FOSMON …'}`—, no
    // cualquier subárbol que la contenga en algún rincón. Si no, el barrido
    // señala bloques enteros por un `placeholder` de correo adentro y nadie
    // vuelve a leerlo.
    JSXExpressionContainer(p) {
      const e = p.node.expression;
      const v = e.type === 'StringLiteral' ? e.value
              : e.type === 'TemplateLiteral' ? src.slice(e.start, e.end) : null;
      if (v) aptar('expr', p.node, v);
    },
    // Dentro de un atributo que lleva texto a pantalla sí se baja al subárbol:
    // ahí vive el ternario `esDep ? … : "usuario@fosmon.com.mx"`, y el ruido
    // queda acotado porque son atributos de ayuda, no bloques enteros.
    JSXAttribute(p) {
      if (!PROPS_QUE_SE_VEN.has(String(p.node.name?.name || ''))) return;
      p.traverse({ StringLiteral(q) { aptar(`@${p.node.name.name}`, q.node, q.node.value); } });
    },
    // Y el hueco por el que entró el defecto: la cadena que vive en un objeto
    // y se pinta después.
    ObjectProperty(p) {
      const k = String(p.node.key?.name ?? p.node.key?.value ?? '');
      if (!PROPS_QUE_SE_VEN.has(k)) return;
      if (p.node.value.type === 'StringLiteral') aptar(`.${k}`, p.node.value, p.node.value.value);
    },
  });
  check(nombresEnPantalla.length === 0,
    'ningún texto de pantalla nombra a un cliente, una obra o un dato del contratista',
    nombresEnPantalla.length ? nombresEnPantalla.join('  |  ') : 'ninguno');

  const huerfanas = PERMITIDAS.filter(e => !src.includes(e.frag));
  if (huerfanas.length) {
    console.log(`   · (nota: ${huerfanas.length} excepción(es) del barrido ya no corresponden a nada `
      + `y se pueden borrar: ${huerfanas.map(e => `«${e.frag}»`).join(', ')})`);
  }

  // ── Órdenes de Trabajo ─────────────────────────────────────────────────────
  // La OT es la orden que el cliente industrial le gira al contratista por
  // SAP. Un municipio no gira órdenes de trabajo: gira un contrato y estima.
  //
  // El caso que importa es con la bandera PRENDIDA, porque así está sembrada
  // OBRA DEMO 3: esconder la casilla del formulario y dejar el render colgando
  // de `obra.cargaOT` habría seguido pintando el bloque en la demo.
  const OBRA_CON = { id: 'OP-2026-001', cargaOT: true };
  const OBRA_SIN = { id: 'OP-2026-002' };

  check(bar.vanLasOT(DEP, OBRA_CON) === false,
    'una dependencia no ve el bloque de OT ni con la bandera prendida en la obra',
    'cargaOT: true');
  check(bar.vanLasOT(DEP, OBRA_SIN) === false, 'y menos sin bandera');
  check(bar.vaElInterruptorOT(DEP) === false,
    'ni la casilla para prenderla en Información del contrato');

  check(bar.vanLasOT(CONS, OBRA_CON) === true,
    'una constructora con la bandera prendida sigue viendo el bloque  ·  TAMSA');
  check(bar.vanLasOT(CONS, OBRA_SIN) === false,
    'y sin bandera no lo ve: eso ya lo hacía la bandera y sigue haciéndolo');
  check(bar.vaElInterruptorOT(CONS) === true,
    'pero la casilla se queda en constructora, también en las obras que no la usan',
    'un interruptor invisible es una función que no existe');
  check(bar.vanLasOT(CONS, null) === false && bar.vanLasOT(CONS, undefined) === false,
    'sin obra cargada todavía tampoco se pinta');

  // ══════════════════════════════════════════════════════════════════════════
  // 4quater) EL FORMULARIO DEL CONTRATO
  // ══════════════════════════════════════════════════════════════════════════
  // Era el de la constructora y no se tocó: al municipio le preguntaba su
  // «Cliente / Dependencia» —que es él mismo— y le pedía el «Residente de
  // obra» y el «Administrador de obra», que son personal del contratista.
  //
  // Se le pregunta a `camposContrato` qué etiquetas entrega la pantalla, no si
  // existe tal o cual nombre (P3).
  seccion('El formulario del contrato');

  const form = new Function(`"use strict";
      const esDependencia = ${decl['esDependencia']};
      const PERMISOS = ${decl['PERMISOS']};
      let _permisosObraOverride = null;
      ${decl['can']}
      const MODALIDADES_ADJUDICACION = ${decl['MODALIDADES_ADJUDICACION']};
      const CAMPOS_CONTRATO = ${decl['CAMPOS_CONTRATO']};
      const camposContrato = ${decl['camposContrato']};
      const ROLES_EDITAN_CONTRATO_D = ${decl['ROLES_EDITAN_CONTRATO_D']};
      const puedeEditarContrato = ${decl['puedeEditarContrato']};
      return { camposContrato, puedeEditarContrato, MODALIDADES_ADJUDICACION };`)();

  const etiquetasD = form.camposContrato(DEP).map(c => c.lbl);
  const clavesD    = form.camposContrato(DEP).map(c => c.key);
  const clavesC    = form.camposContrato(CONS).map(c => c.key);

  // Lo que el municipio pidió, campo por campo.
  const PEDIDOS = [
    [/empresa ejecutante/i,                          'la empresa ejecutante, por razón social'],
    [/rfc/i,                                         'su RFC'],
    [/supervisor por parte de la dependencia/i,      'el supervisor por parte de la dependencia'],
    [/superintendente por parte de la constructora/i,'el superintendente por parte de la constructora'],
    [/número de contrato/i,                          'el número de contrato'],
    [/modalidad de adjudicación/i,                   'la modalidad de adjudicación'],
    [/monto contratado/i,                            'el monto contratado'],
    [/origen de los recursos/i,                      'el origen de los recursos'],
  ];
  for (const [re, qué] of PEDIDOS)
    check(etiquetasD.some(l => re.test(l)), `el formulario de dependencia pregunta ${qué}`,
      etiquetasD.find(l => re.test(l)) || 'NO ESTÁ');

  // Y lo que no es suyo.
  for (const [clave, porqué] of [
    ['cliente',   'el municipio es el cliente: preguntárselo es preguntarle su propio nombre'],
    ['residente', 'el residente es personal del contratista'],
    ['admin',     'el administrador de obra también'],
    ['diasPago',  'los días de pago son el flujo del contratista'],
  ]) check(!clavesD.includes(clave),
      `el formulario de dependencia no pide \`${clave}\``, porqué);

  // Ningún campo pregunta dos veces lo mismo, y los dos lados comparten los
  // tres que significan lo mismo en vez de duplicarlos con otro nombre.
  check(new Set(clavesD).size === clavesD.length, 'ningún campo aparece dos veces',
    `${clavesD.length} campos`);
  for (const k of ['contrato', 'presupuesto', 'superintendente'])
    check(clavesD.includes(k) && clavesC.includes(k),
      `\`${k}\` es el mismo campo de los dos lados, no dos campos para un hecho`);

  // Las fechas NO se repiten aquí: viven en «Plazos y ampliaciones», que usa
  // este mismo guardado. Dos pantallas editando el mismo dato es el defecto.
  check(!clavesD.includes('inicio') && !clavesD.includes('fin'),
    'las fechas no se duplican en este formulario', 'están en Plazos y ampliaciones');

  // La constructora no perdió ni cambió nada.
  check(clavesC.join(',') === 'contrato,cliente,superintendente,residente,admin,presupuesto,diasPago',
    'el formulario de constructora quedó igual', clavesC.join(' · '));

  // La modalidad es una lista cerrada, no texto libre: con texto libre el
  // mismo concepto se captura de cuatro maneras y luego no se puede agrupar.
  const modal = form.camposContrato(DEP).find(c => /modalidad/i.test(c.lbl));
  check(modal?.tipo === 'opciones' && Array.isArray(modal.opciones) && modal.opciones.length >= 3,
    'la modalidad se elige de una lista, no se escribe a mano',
    (modal?.opciones || []).join(' · '));

  // El campo que algún día trae el padrón queda marcado desde ahora.
  const delPadron = form.camposContrato(DEP).filter(c => c.fuente === 'padron').map(c => c.key);
  check(delPadron.includes('empresaEjecutante') && delPadron.includes('empresaRFC'),
    'los datos de la empresa quedan marcados como futuros del padrón de contratistas',
    delPadron.join(' · '));
  // La marca sola es una nota para programadores. Lo que importa es que el
  // capturista lea en pantalla por qué está escribiendo a mano algo que la
  // dependencia ya tiene en otro sistema; si no, lo reporta como defecto.
  check(/fuente\s*===\s*["']padron["'][\s\S]{0,400}?padrón de contratistas/.test(src),
    'y junto al campo se explica, en pantalla, que algún día lo traerá el padrón');

  // Quién puede guardar. La intersección de las dos reglas que toca
  // `guardarDatos`: `config/info` (puedeEditarObraD) y el documento de la obra
  // (esDirectivoD). Ofrecerle el botón a un supervisor sería guardar la mitad.
  for (const rolD of ['director_obras', 'subdirector', 'jefe_supervision'])
    check(form.puedeEditarContrato(DEP, rolD) === true,
      `${rolD} puede asentar los datos del contrato`);
  for (const rolD of ['supervisor_obra', 'administrativo', 'contralor', 'contratista'])
    check(form.puedeEditarContrato(DEP, rolD) === false,
      `${rolD} lo ve pero no lo edita`,
      rolD === 'supervisor_obra' ? 'las reglas le niegan el documento de la obra' : '');
  check(form.puedeEditarContrato(CONS, 'director_operaciones') === true,
    'en constructora decide el mismo permiso de siempre');
  check(form.puedeEditarContrato(CONS, 'cliente') === false,
    'y un cliente sigue sin poder editarlo');

  // ══════════════════════════════════════════════════════════════════════════
  // 4quinquies) LAS PALABRAS QUE AHÍ SIGNIFICAN OTRA COSA
  // ══════════════════════════════════════════════════════════════════════════
  // El formulario del contrato se quedó sin traducir porque se recortó el menú
  // y nadie leyó lo que quedaba dentro. Este barrido es el guard contra el
  // siguiente caso igual. Dos clases de defecto, distintas:
  //
  //   1. La palabra que significa otra cosa. «Presupuesto», para un
  //      ayuntamiento, es su presupuesto de egresos; lo que hay en esa pantalla
  //      es el catálogo de conceptos. Lo resuelve `LEXICO`.
  //   2. El instructivo que nombra una pestaña inexistente. «Ve a Planeación →
  //      Presupuesto» en una sesión sin pestaña Planeación. El clic llegaba
  //      bien —`destinoNav` lo traduce— y el texto mandaba al vacío.
  //
  // La segunda es la peor de las dos, aunque parezca cosmética: el usuario
  // busca la pestaña, no la encuentra, y reporta como defecto algo que
  // funciona. Se gasta la confianza en la herramienta.
  seccion('Las palabras que ahí significan otra cosa');

  const lex = new Function(`"use strict";
      const esDependencia = ${decl['esDependencia']};
      const LEXICO = ${decl['LEXICO']};
      const lexico = ${decl['lexico']};
      return { LEXICO, lexico };`)();

  // Un léxico al que le falta una clave de un lado traduce a `undefined`, que
  // se pinta como "undefined" en pantalla. Que las dos tablas tengan las
  // mismas claves es la condición para que eso no pueda pasar.
  const kC = Object.keys(lex.LEXICO.constructora).sort().join(',');
  const kD = Object.keys(lex.LEXICO.dependencia).sort().join(',');
  check(kC === kD && kC.length > 0,
    'las dos columnas del léxico traducen exactamente las mismas claves',
    kC === kD ? kC : `constructora: ${kC}  ·  dependencia: ${kD}`);
  for (const [lado, u] of [['dependencia', DEP], ['constructora', CONS]])
    check(Object.values(lex.lexico(u)).every(v => typeof v === 'string' && v.length > 0),
      `del lado ${lado} ninguna traducción sale vacía`);

  // La pestaña. Lo que el usuario lee antes de hacer clic.
  const subPpto = menus.SUBTABS_PLANEACION_DEPENDENCIA.find(s => s.id === 'presupuesto');
  check(subPpto && !/presupuesto/i.test(subPpto.label),
    'a una dependencia la pestaña del catálogo no se le llama «Presupuesto»',
    subPpto?.label || 'NO EXISTE');
  check(subPpto?.label === lex.lexico(DEP).catalogo,
    'y se llama como dice el léxico, no como se acordó alguien aquí',
    subPpto?.label);
  check(lex.lexico(CONS).catalogo === 'Presupuesto',
    'mientras en constructora sigue llamándose Presupuesto, como siempre');

  // La ruta que se le dicta al usuario sólo puede nombrar pestañas que su
  // menú tiene. Esto se comprueba CONTRA EL MENÚ, no contra una lista escrita
  // a mano: si mañana cambia una etiqueta del menú y no la ruta, sale rojo.
  const etiquetasDep = [
    ...menus.tabsDe(DEP).map(t => t.label),
    ...menus.SUBTABS_OPERACION_DEPENDENCIA.map(s => s.label),
    ...menus.SUBTABS_PLANEACION_DEPENDENCIA.map(s => s.label),
  ];
  // Se parte de la cadena vacía, no de `undefined`: si falta la traducción, los
  // tramos salen vacíos y eso es rojo —la ruta que se le dicta no nombra
  // ninguna pestaña—, no una excepción. Un `.split` sobre `undefined` reventaría
  // el banco y lo convertiría en NO ARRANCÓ, que diría «no pude mirar» cuando sí
  // miró: el léxico incompleto es el defecto que se está buscando.
  const rutaDep = lex.lexico(DEP).rutaCatalogo;
  const tramosRuta = String(rutaDep ?? '').split('→').map(t => t.trim()).filter(Boolean);
  const huerfanos = tramosRuta.filter(t => !etiquetasDep.includes(t));
  check(tramosRuta.length > 0 && huerfanos.length === 0,
    'la ruta que se le dicta nombra sólo pestañas que su menú tiene',
    !tramosRuta.length ? `NO HAY RUTA: ${JSON.stringify(rutaDep)}`
      : huerfanos.length ? `NO EXISTEN: ${huerfanos.join(', ')}  ·  menú: ${etiquetasDep.join(' | ')}`
                         : rutaDep);

  // ── Lo primero que ve un usuario nuevo ──
  // Hasta hoy a los seis roles de dependencia les salían los pasos de
  // `administrador_obra`, que les pedían registrar cobros al cliente con su
  // factura y llevar el control de gastos. Es la PRIMERA pantalla.
  const bien = new Function(`"use strict";
      const esDependencia = ${decl['esDependencia']};
      const PASOS_DEPENDENCIA_BASE = ${decl['PASOS_DEPENDENCIA_BASE']};
      const PASOS_BIENVENIDA = ${decl['PASOS_BIENVENIDA']};
      const pasosDe = ${decl['pasosDe']};
      return { PASOS_BIENVENIDA, pasosDe };`)();

  const PALABRAS_AJENAS = /estimaci|n[óo]mina|subcontrat|almac[eé]n|maquinaria|gastos|planeaci[óo]n|operaci[óo]n|factura|margen|presupuesto|destajo|opus/i;

  // Antes de mirar QUÉ dicen los pasos hay que afirmar que SALEN pasos. No es
  // andamiaje: `pasosDe` devolviendo `undefined` es una pantalla de bienvenida
  // en blanco, y es la primera que ve un usuario nuevo. Y si no se afirma aquí,
  // el `.map` de abajo revienta y el banco entero sale por el camino del
  // NO ARRANCÓ, que diría «no pude mirar» cuando sí miró y lo que vio es rojo.
  const texto = pasos => (pasos || []).map(p => `${p.t} ${p.d}`).join(' ');
  const hayPasos = (pasos, quien) =>
    check(Array.isArray(pasos) && pasos.length > 0 && pasos.every(p => p && p.t && p.d),
      `${quien} recibe una bienvenida con pasos, no una pantalla en blanco`,
      Array.isArray(pasos) ? `${pasos.length} paso(s)` : String(pasos));

  for (const rolD of ROLES_DEP) {
    const pasos = bien.pasosDe({ rol: rolD, tipo: 'dependencia' });
    hayPasos(pasos, rolD);
    check(pasos !== bien.PASOS_BIENVENIDA.administrador_obra,
      `${rolD} no recibe el tutorial de un administrador de obra`);
    const halladas = texto(pasos).match(PALABRAS_AJENAS);
    check(!halladas,
      `y su tutorial no lo manda a pantallas que no tiene`,
      halladas ? `DICE «${halladas[0]}»: ${texto(pasos).slice(0, 90)}…` : `${(pasos||[]).length} pasos`);
  }
  // El respaldo. Un rol de dependencia que esta tabla no conozca —y van a
  // llegar— no puede caer del lado constructora: es el mismo "||" que le sacaba
  // Gastos a `director_obras`. Y tiene que seguir en pie aunque los roles de la
  // tabla cambien de nombre: por eso se le pregunta con un rol inventado.
  const pasosDesconocido = bien.pasosDe({ rol: 'titular_oic', tipo: 'dependencia' });
  hayPasos(pasosDesconocido, 'un rol de dependencia que la tabla no conoce');
  check(pasosDesconocido !== bien.PASOS_BIENVENIDA.administrador_obra,
    'un rol de dependencia que la tabla no conoce tampoco cae del lado constructora');
  check(!PALABRAS_AJENAS.test(texto(pasosDesconocido)),
    'y lo que le sale por respaldo tampoco nombra pantallas que no tiene');
  check(bien.pasosDe({ rol: 'superintendente', tipo: 'constructora' })
        === bien.PASOS_BIENVENIDA.superintendente,
    'en constructora cada rol sigue recibiendo sus mismos pasos');

  // ── Barrido: ningún texto alcanzable dicta una ruta del otro menú ──
  // Lo de arriba afirma sobre los sitios ya arreglados. Esto es el guard
  // contra el próximo. Se recorre el ÁRBOL de los componentes que una
  // dependencia alcanza —no el archivo entero— buscando cadenas que nombren
  // una ruta de menú con la flecha. Si aparece una nueva escrita a mano, sale
  // en rojo y hay que pasarla por `LEXICO`.
  const ALCANZABLES = ['PantallaObras', 'DashboardDependencia', 'Captura',
                       'FotosCliente', 'Contrato', 'Presupuesto', 'WelcomeBanner'];
  const rutasEscritasAMano = [];
  traverse(ast, {
    Function(p) {
      const nombre = p.node.id?.name || p.parent?.id?.name;
      if (!ALCANZABLES.includes(nombre)) return;
      p.traverse({
        StringLiteral(q) {
          if (!/(Planeaci[óo]n|Operaci[óo]n)\s*→/.test(q.node.value)) return;
          rutasEscritasAMano.push(`${nombre}:${q.node.loc.start.line}  ${q.node.value.slice(0, 60)}`);
        },
        JSXText(q) {
          if (!/(Planeaci[óo]n|Operaci[óo]n)\s*→/.test(q.node.value)) return;
          rutasEscritasAMano.push(`${nombre}:${q.node.loc.start.line}  ${q.node.value.trim().slice(0, 60)}`);
        },
      });
    },
  });
  check(rutasEscritasAMano.length === 0,
    'ninguna pantalla que la dependencia alcanza dicta una ruta escrita a mano',
    rutasEscritasAMano.length ? '\n        ' + rutasEscritasAMano.join('\n        ') : 'ninguna');

  // Las tarjetas de riesgo necesitan su propio barrido, y esto lo descubrió una
  // contraprueba: devolver «Sube el Excel en Planeación → Presupuesto» a la
  // plantilla `cmp_001` salía VERDE con todo lo de arriba. Por dos razones que
  // se suman. Una, las plantillas son datos en el ámbito del módulo, no viven
  // dentro de ningún componente, así que el recorrido de `ALCANZABLES` no las
  // mira. Dos, `extra` y `detalle` se arman DENTRO de `detect`, y `cmp_001` sólo
  // dispara cuando la obra no tiene catálogo: el contexto con el que se ejercita
  // el motor arriba sí lo tiene, así que ese texto nunca se producía.
  //
  // De ahí que esto se haga sobre la FUENTE de cada plantilla y no sobre su
  // salida: una leyenda que la dependencia puede llegar a leer no se puede
  // dejar sin vigilar porque haga falta un contexto raro para sacarla.
  const biblio = new Function(`"use strict";
      const MXN = ${decl['MXN']};
      const heImporte = ${decl['heImporte']};
      const BIBLIOTECA_RIESGOS = ${decl['BIBLIOTECA_RIESGOS']};
      const RIESGOS_SOLO_CONSTRUCTORA = ${decl['RIESGOS_SOLO_CONSTRUCTORA']};
      return { BIBLIOTECA_RIESGOS, RIESGOS_SOLO_CONSTRUCTORA };`)();
  const vedados = new Set(biblio.RIESGOS_SOLO_CONSTRUCTORA);

  const rutasEnRiesgos = [];
  traverse(ast, {
    VariableDeclarator(p) {
      if (p.node.id.name !== 'BIBLIOTECA_RIESGOS') return;
      p.traverse({
        ObjectExpression(q) {
          const propId = q.node.properties.find(
            r => r.key && (r.key.name === 'id' || r.key.value === 'id'));
          if (!propId || propId.value.type !== 'StringLiteral') return;
          const id = propId.value.value;
          if (vedados.has(id)) return;   // ésa no le llega nunca
          const fuente = src.slice(q.node.start, q.node.end);
          const hallada = fuente.match(/["'`][^"'`]*(Planeaci[óo]n|Operaci[óo]n)\s*→[^"'`]*["'`]/);
          if (hallada) rutasEnRiesgos.push(`${id}: ${hallada[0].slice(0, 60)}`);
        },
      });
    },
  });
  check(rutasEnRiesgos.length === 0,
    'ni una tarjeta de riesgo que la dependencia puede recibir dicta una ruta',
    rutasEnRiesgos.length ? '\n        ' + rutasEnRiesgos.join('\n        ')
                          : `${biblio.BIBLIOTECA_RIESGOS.length - vedados.size} plantillas revisadas`);

  // ══════════════════════════════════════════════════════════════════════════
  // 5) LA ESPERA DE DATOS: no esperar lo que no se pidió
  // ══════════════════════════════════════════════════════════════════════════
  // Consecuencia directa de no suscribir: si la pantalla siguiera esperando las
  // ocho claves, las cinco que nunca van a llegar la dejarían cargando para
  // siempre. Un spinner eterno es cómo "no pedir la ruta" se convierte en una
  // pantalla en blanco.
  seccion('La espera de datos');

  const espera = new Function(`"use strict";
    const CLAVES_BULK = ${decl['CLAVES_BULK']};
    const CLAVES_BULK_DEPENDENCIA = ${decl['CLAVES_BULK_DEPENDENCIA']};
    const datosObraCompletos = ${decl['datosObraCompletos']};
    return { datosObraCompletos, CLAVES_BULK, CLAVES_BULK_DEPENDENCIA };`)();

  const llegoLoDeDependencia = { _listos: { info: true, subs: true, estimaciones: true,
                                            historialAvanceSemanas: true } };
  check(espera.datosObraCompletos(llegoLoDeDependencia, true) === true,
    'con lo que una dependencia sí recibe, la obra ya está completa');
  check(espera.datosObraCompletos(llegoLoDeDependencia, false) === false,
    'y una constructora con lo mismo NO: le faltan las cinco que ella sí pide');
  const soloDep = new Set(espera.CLAVES_BULK_DEPENDENCIA);
  check(espera.CLAVES_BULK_DEPENDENCIA.every(k => espera.CLAVES_BULK.includes(k)),
    'las claves de dependencia son un subconjunto: es un recorte, no otra lista');
  check(!espera.CLAVES_BULK_DEPENDENCIA.some(k => PROHIBIDAS.test(k)),
    'y ninguna de ellas es de economía interna',
    espera.CLAVES_BULK.filter(k => !soloDep.has(k)).join(' ') + ' quedaron fuera');

  // ══════════════════════════════════════════════════════════════════════════
  // Todo lo de arriba decide A DÓNDE se pregunta. Esto decide QUÉ SE HEREDA.
  //
  // Visto en el emulador con las dos organizaciones sembradas: entrando como
  // FOSMON, saliendo y entrando como el municipio en la misma pestaña, el
  // panel del municipio decía "5 obras activas" y sumaba el monto contratado
  // de las dos obras del contratista. No lo evita ninguna regla —esas
  // lecturas ya se hicieron, con la sesión anterior y con todo el derecho— ni
  // el prefijo de ruta, que sólo elige dónde preguntar. Sobrevivían en el
  // estado de React, y la carga de obras MEZCLA lo que trae Firestore con lo
  // que ya hay.
  //
  // Se ejecuta el `logout` de producción con dobles en lugar de los setters,
  // y se le pregunta con qué valor llamó a cada uno. No se afirma que exista
  // ninguna línea ni ningún nombre (P3): se afirma qué hereda la sesión
  // siguiente.
  seccion('Lo que hereda la sesión siguiente');

  const herencia = await new Function(`"use strict";
    const visto = { obras: 'no se tocó', datos: 'no se tocó',
                    usuario: 'no se tocó', prefijo: 'no se limpió',
                    marca: 'no se tocó' };
    const usuario = { correo: 'demo@fosmon.com.mx' };
    const fbAuth = {};
    const fsAudit = () => {};
    const signOut = async () => {};
    const limpiarPrefijoOrg = () => { visto.prefijo = 'limpio'; };
    const setObras = v => { visto.obras = v; };
    const setDatosPorObra = v => { visto.datos = v; };
    const setUsuario = v => { visto.usuario = v; };
    const setMarca = v => { visto.marca = v; };
    const setAuditCtx = () => {}; const setPermisosObraOverride = () => {};
    const setScreen = () => {}; const setObraId = () => {};
    const logout = ${decl['logout']};
    return logout().then(() => visto);`)();

  check(Array.isArray(herencia.obras) && herencia.obras.length === 0,
    'al cerrar sesión la lista de obras queda vacía',
    Array.isArray(herencia.obras) ? `${herencia.obras.length} obra(s)` : String(herencia.obras));
  check(herencia.datos && typeof herencia.datos === 'object'
        && Object.keys(herencia.datos).length === 0,
    'y el catálogo, las estimaciones y la nómina cargadas también',
    typeof herencia.datos === 'object' && herencia.datos !== null
      ? `${Object.keys(herencia.datos).length} obra(s) con datos`
      : String(herencia.datos));
  check(herencia.prefijo === 'limpio' && herencia.usuario === null,
    'junto con el prefijo de organización y el usuario',
    `prefijo ${herencia.prefijo} · usuario ${JSON.stringify(herencia.usuario)}`);
  check(herencia.marca === null,
    'y la marca, que es lo que el encabezado afirma sobre de quién es la app',
    JSON.stringify(herencia.marca));

  // ══════════════════════════════════════════════════════════════════════════
  // El `logout` no alcanza. La marca también cambia sin pasar por él —basta
  // que cambie `orgId`— y, sobre todo, es el efecto el que decide qué
  // significa "esta organización no tiene marca". Como estaba, sólo sabía
  // asignar: si el documento no existía, se quedaba la marca anterior y nada
  // la corregía después.
  //
  // Visto en el emulador: entrando como el municipio, saliendo y entrando como
  // FOSMON en la misma pestaña, el encabezado del contratista seguía diciendo
  // «H. AYUNTAMIENTO DE COATZACOALCOS» sobre sus propias obras. La
  // organización `fosmon` no tiene `branding` sembrado.
  //
  // Es el mismo defecto que las obras heredadas, en un estado que aquel
  // barrido no tocó.
  //
  // Se ejecuta el efecto de producción con un `getDoc` doble y se recoge cada
  // valor que le pasa al encabezado, en orden. Y no se afirma sobre el objeto
  // `marca`, que es andamiaje: se le pregunta a `nombreOrg` —la misma función
  // que pinta la línea— QUÉ NOMBRE SALDRÍA EN PANTALLA (P3).
  seccion('La marca que se queda pintada cuando la siguiente no tiene');

  const nombreOrgF = new Function(`"use strict";
    const esDependencia = ${decl['esDependencia']};
    return ${decl['nombreOrg']};`)();

  const correrEfecto = async (existe, datos) => new Function(`"use strict";
    const recibidos = [];
    const usuario = { orgId: 'fosmon', correo: 'demo@fosmon.com.mx' };
    const fbDb = {};
    const doc = (db, ruta) => ruta;
    const getDoc = async () => ({
      exists: () => ${JSON.stringify(existe)},
      data: () => (${JSON.stringify(datos)}),
    });
    const setMarca = v => { recibidos.push(v); };
    const efecto = ${efectoMarca};
    const limpiar = efecto();
    // Dos vueltas: el \`getDoc\` doble resuelve ya, pero el \`.then\` corre en
    // la microcola.
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      if (typeof limpiar === 'function') limpiar();
      return recibidos;
    });`)();

  const MUNICIPIO = { empresa: 'H. Ayuntamiento de Coatzacoalcos' };

  // La sesión anterior dejó pintada la marca del municipio. Entra FOSMON, cuya
  // organización no tiene documento de marca.
  const sinDoc = await correrEfecto(false, null);
  const ultimoSinDoc = sinDoc.length ? sinDoc[sinDoc.length - 1] : MUNICIPIO;
  const salenSinDoc = nombreOrgF(ultimoSinDoc, { correo: 'demo@fosmon.com.mx' });
  check(salenSinDoc === 'FOSMON Construcciones',
    'entrando sobre la sesión de un municipio, el contratista lee su propio nombre',
    `el encabezado diría «${salenSinDoc}»`);

  // Y no sólo al final: durante la petición tampoco puede quedar la anterior.
  const primeroSinDoc = sinDoc.length ? sinDoc[0] : MUNICIPIO;
  check(nombreOrgF(primeroSinDoc, { correo: 'demo@fosmon.com.mx' }) !== MUNICIPIO.empresa,
    'y mientras Firestore contesta tampoco se queda la marca de la anterior',
    `primer valor: «${nombreOrgF(primeroSinDoc, { correo: 'demo@fosmon.com.mx' })}»`);

  // La contraparte: cuando la organización SÍ tiene marca, se pinta. Sin esto,
  // lo de arriba lo cumpliría un efecto que nunca asigna nada.
  const conDoc = await correrEfecto(true, MUNICIPIO);
  const ultimoConDoc = conDoc.length ? conDoc[conDoc.length - 1] : null;
  check(nombreOrgF(ultimoConDoc, { correo: 'oscar@cotea.com.mx', tipo: 'dependencia' })
        === MUNICIPIO.empresa,
    'y la organización que sí tiene marca la sigue viendo',
    `el encabezado diría «${nombreOrgF(ultimoConDoc, { correo: 'oscar@cotea.com.mx', tipo: 'dependencia' })}»`);

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})();
// Lo que pasa si esto revienta lo decide `vigilarExcepciones`, instalado arriba
// antes de leer el archivo. Un `.catch` aquí no serviría: los sandboxes de las
// §1 y §4 se construyen en el ámbito del módulo, antes de que esto empiece.
