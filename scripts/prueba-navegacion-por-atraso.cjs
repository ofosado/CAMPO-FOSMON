#!/usr/bin/env node
// La lista de obras: quién la ve, con qué orden abre, y de dónde sale ese orden.
//
// QUÉ SE AFIRMA. Tres cosas que la pantalla de obras AFIRMA sobre el dato, no
// que presenta:
//
//   1. «Esta obra está más atrasada que aquélla» — el orden por atraso.
//   2. «Ésta no se puede ordenar por atraso» — las obras sin desviación medible,
//      que van al final y NO al lugar que les daría un cero.
//   3. «A este rol la tabla ya le dice lo que decían las tarjetas» — el cerrojo
//      que esconde la lista.
//
// POR QUÉ ESTO ES UN BANCO Y NO UN VISTAZO. El orden por atraso existe para dos
// roles —`contralor` y `administrativo`— que tienen la cartera completa y
// ninguna vista concentrada. Para ellos la primera obra de la lista es la
// respuesta a «¿a cuál voy?». Si ese orden sale de una resta escrita en la
// pantalla en vez de la cuenta única, puede ordenar por un atraso distinto del
// que el tablero enseña al abrir la obra que la lista puso primero: el usuario
// llega a una pantalla que dice «+23 d» por haber hecho clic en el lugar de
// «+40». Y si `null` se tratara como 0, una obra de la que no se sabe nada
// aterrizaría justo entre −1 y +1 día, donde se lee «va en tiempo» — la cifra
// inventada, dicha por omisión.
//
// CÓMO SE MIDE. Se extraen del archivo las cuatro funciones y se EJECUTAN
// (P3: una copia mía se comprobaría contra sí misma):
//
//   atrasoDeObra         los días de atraso de una obra
//   porAtrasoDesc        el orden
//   veListaDeTarjetas    quién ve las tarjetas
//   ordenInicialDeLista  con qué orden abre cada rol
//
// Y la contraprueba es SEMÁNTICA: se vuelve a armar el módulo con
// `atrasoProyectado` sustituido por una versión que NIEGA el signo, y se exige
// que el orden se invierta. Una resta escrita a mano no se habría movido.
//
// Uso:  node scripts/prueba-navegacion-por-atraso.cjs [App.jsx]
//
// CONTRAPRUEBA, comprobada, y la forma importa. Contra `main` esto sale 2 —NO
// ARRANCÓ—, porque allá las cuatro funciones todavía no existen, y un 2 no
// demuestra nada sobre las aserciones. Lo que se hizo fue romper UNA cosa a la
// vez sobre este mismo archivo; las tres salen con 1:
//
//   · `porAtrasoDesc` usa `(x ?? 0)` en vez de mandar los nulos al final
//       → 6 en rojo, salida 1. Y el detalle que lo explica todo: la 0126, la
//         obra ADELANTADA 227 días, se va al ÚLTIMO lugar y las dos obras de
//         las que no se sabe nada quedan en los lugares 3 y 4 — en medio de la
//         lista, donde se leen «van en tiempo».
//   · `atrasoDeObra` arma la resta por su cuenta —`proyeccionDeAvance` directo,
//     sobre `{...obra}`— en vez de llamar a `atrasoProyectado`
//       → 2 en rojo, salida 1
//   · `veListaDeTarjetas` pierde el `verHistorial ||`
//       → 1 en rojo, salida 1
//   · la pantalla pinta `listaActual.map` sin el cerrojo `veLista &&`
//       → 1 en rojo, salida 1  (el cableado, que es lo que vuelve esto medible
//         en vez de cuatro funciones correctas y muertas)
//   · `ordenar` se queda sin su rama `"atraso"`
//       → 1 en rojo, salida 1
//   · `necesitaDatosDeCartera` vuelve a preguntar sólo por el panel ejecutivo
//       → 1 en rojo, salida 1. Ésta es la que importa: era el estado REAL del
//         archivo hasta que se miró la pantalla, con las 31 comprobaciones
//         anteriores en verde sobre un orden que no podía existir.
//
// El dato que justifica el método: con la resta a mano puesta, la sección 2
// entera —los días de cada obra— SIGUE EN VERDE, y la sección 3 —el orden de
// hoy— también. Da los mismos 169 días y el mismo orden. Una prueba de valores
// habría firmado la copia como buena. Lo que se mueve es la sección 4, que es
// la única que pregunta de DÓNDE sale el número.

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const noArranco = require('./no-arranco.cjs');
const { sinPrecondicion } = noArranco;

const archivo = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');
noArranco.vigilarExcepciones(path.relative(raiz, archivo));

const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
const texto = n => src.slice(n.start, n.end);

let fallas = 0, oks = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok  ' : 'FALLA'} ${titulo}${detalle ? `  ·  ${detalle}` : ''}`);
  ok ? oks++ : fallas++;
};
const seccion = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`);

// ── El módulo, armado desde el archivo ─────────────────────────────────────
const DE_MODULO = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'montoEstimadoSnap', 'montoPagadoSnap',
  'semanaISO', 'snapshotId', 'fechaLocalDeISO', 'hoyLocalISO', 'lunesDeClaveSemana',
  'finVigenteDe', 'estadoPorSemana', 'proyeccionDeAvance',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'SIN_PROY_POCOS_CIERRES', 'SIN_PROY_NO_COMPARABLES', 'SIN_PROY_SIN_AVANCE',
  'importeEjecutadoPartida', 'importeCatalogoPartida', 'desgloseEjecutado',
  'avanceFisicoPonderado',
  'atrasoProyectado', 'atrasoDeObra', 'porAtrasoDesc',
  'PERMISOS', 'ROLES_PANEL_EJECUTIVO', 'vePanelEjecutivo',
  'ROLES_SIN_CONCENTRADO', 'veListaDeTarjetas', 'ordenInicialDeLista',
  'CLAVES_BULK', 'CLAVES_BULK_DEPENDENCIA', 'necesitaDatosDeCartera',
];
// Que falten éstas es renombre, no regresión: no hay nada que medir.
const IMPRESCINDIBLES = ['atrasoDeObra', 'porAtrasoDesc', 'veListaDeTarjetas',
  'ordenInicialDeLista', 'atrasoProyectado', 'avanceFisicoPonderado',
  'PERMISOS', 'ROLES_PANEL_EJECUTIVO', 'necesitaDatosDeCartera',
  'ROLES_SIN_CONCENTRADO', 'CLAVES_BULK_DEPENDENCIA'];

const trozos = new Map();   // nombre → texto de la declaración
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && DE_MODULO.includes(d.id.name) && !trozos.has(d.id.name))
      trozos.set(d.id.name, texto(p.node));
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && DE_MODULO.includes(n) && !trozos.has(n))
      trozos.set(n, texto(p.node));
  },
});
const faltan = IMPRESCINDIBLES.filter(n => !trozos.has(n));
if (faltan.length) noArranco(faltan, path.relative(raiz, archivo));

// `C` entra como proxy: aquí se miden números y orden, no colores, y un `C.red`
// que faltara reventaría la extracción y saldría NO ARRANCÓ culpando al archivo
// medido en vez de a este andamiaje.
//
// `sustituir` es la contraprueba semántica: el nombre sustituido se SACA de las
// declaraciones y entra como parámetro, así que todo lo que lo llame por cierre
// —`atrasoDeObra`, entre otros— ve la versión mutada. Es la única forma de
// preguntar de DÓNDE sale un número en vez de cuánto vale.
const armar = (sustituir = {}) => {
  const quitar = Object.keys(sustituir);
  const decls = [...trozos.entries()]
    .filter(([n]) => !quitar.includes(n))
    .sort((a, b) => src.indexOf(a[1]) - src.indexOf(b[1]))
    .map(([, t]) => t);
  const expuestos = [...trozos.keys()].filter(n => !quitar.includes(n));
  const params = ['C', ...quitar];
  return new Function(...params,
    `${decls.join('\n')}\n;return {${expuestos.join(',')}};`)(
    new Proxy({}, { get: () => '#000' }), ...quitar.map(n => sustituir[n]));
};
const mod = armar();

// ── Datos ──────────────────────────────────────────────────────────────────
//
// El reloj se fija: `atrasoDeObra` tiene `Date.now()` por omisión y la lista le
// pasa un `HOY`. Sin fijarlo, la proyección se movería un día cada día y la
// prueba saldría roja por el calendario, que es «falla y luego pasa».
const AHORA = new Date(2026, 8, 21, 12, 0).getTime();   // lunes 21-sep-2026

const cierre = (semana, avance, fecha) => ({
  id: mod.snapshotId(semana, 2026), semana, año: 2026, tipo: 'oficial', esquema: 3,
  avancePonderado: avance, montoEjecutado: avance * 10000,
  fechaCaptura: fecha, fechaCierre: fecha, capturadoPor: 'residente@fosmon.mx',
});
// Dos cierres separados por dos semanas: velocidad 3 puntos por semana. Con eso
// hay proyección, y moviendo SÓLO el fin de cada obra se obtienen atrasos
// distintos sin tocar el historial — así la diferencia entre obras es el plazo,
// que es lo que se quiere ordenar.
const HISTORIAL = [
  cierre(35, 18, '2026-08-31T18:00:00.000Z'),
  cierre(37, 24, '2026-09-14T18:00:00.000Z'),
];
const obra = (id, nombre, fin, extra = {}) => ({
  id, nombre, estado: 'activa', presupuesto: 38500000, inicio: '2026-04-01', fin, ...extra,
});

// Cinco obras: tres con atraso medible y distinto, y DOS sin él por razones
// diferentes. Las dos importan: una obra sin plazo capturado tiene
// `desviacionDias === null` con `razon === null`, que es el caso que la versión
// vieja del KPI confundía, y aquí es el que prueba que el orden mira el NÚMERO y
// no la razón.
const OBRAS = [
  obra('0112', 'Camino Rural El Mirador', '2026-11-30'),  // muy tarde
  obra('0114', 'Puente Vehicular Norte',  '2027-04-30'),  // poco tarde
  obra('0126', 'Red de Drenaje Poniente', '2027-12-31'),  // adelantada
  obra('0127', 'Pavimentación Sur',       '2026-12-31'),  // sin plazo que valga: 1 cierre
  obra('0125', 'Bordo de Contención',     null),          // dos cierres, sin fin capturado
];
const DATOS = {
  '0112': { subs: [], historialAvanceSemanas: HISTORIAL },
  '0114': { subs: [], historialAvanceSemanas: HISTORIAL },
  '0126': { subs: [], historialAvanceSemanas: HISTORIAL },
  '0127': { subs: [], historialAvanceSemanas: [HISTORIAL[0]] },
  '0125': { subs: [], historialAvanceSemanas: HISTORIAL },
};

const atrasoDeCon = (m) => (o) => m.atrasoDeObra(o, DATOS[o.id], AHORA);
const ordenDe = (lista) => lista.map(o => o.id);

console.log(`\nArchivo: ${path.relative(raiz, archivo)}`);

// ════════════════════════════════════════════════════════════════════════════
// 1) Quién ve la lista y con qué orden abre
// ════════════════════════════════════════════════════════════════════════════
seccion('Quién navega por tarjetas y quién por la tabla');
{
  // Los que el encargo nombró uno por uno: conservan la lista intacta.
  const CONSERVAN = ['supervisor_obra', 'superintendente', 'residente', 'administrador_obra'];
  const sinLista = CONSERVAN.filter(r => !mod.veListaDeTarjetas(r, false));
  check(sinLista.length === 0,
    'supervisor, superintendente, residente y administrador de obra conservan las tarjetas',
    sinLista.length ? `se les quitó a ${sinLista.join(', ')}` : CONSERVAN.join(' · '));

  // Y los que la pierden son EXACTAMENTE los que tienen tabla. Comparar los dos
  // conjuntos, no una lista escrita a mano: así el día que un rol entre o salga
  // del panel, su lista sigue el cambio sola o esto se pone rojo.
  const roles = Object.keys(mod.PERMISOS);
  const discrepan = roles.filter(r =>
    mod.veListaDeTarjetas(r, false) === mod.vePanelEjecutivo(r));
  check(discrepan.length === 0,
    'la lista se esconde exactamente donde hay tabla que la reemplace',
    discrepan.length ? `no cuadran: ${discrepan.join(', ')}` : `${roles.length} roles revisados`);

  check(mod.veListaDeTarjetas('auditor', false) === false
        && mod.vePanelEjecutivo('auditor') === true,
    'al auditor se le esconde, por instrucción expresa: tiene tabla',
    'auditor → tabla, sin tarjetas');

  // El Historial manda. Es el caso que deja la pantalla en blanco si se olvida:
  // el panel no se pinta ahí, así que si las tarjetas tampoco, no queda nada.
  const puedenHistorial = ['director_operaciones', 'gerente_construccion'];
  const ciegos = puedenHistorial.filter(r => !mod.veListaDeTarjetas(r, true));
  check(ciegos.length === 0,
    'en el Historial reaparecen: ahí no hay tabla, y sin tarjetas no quedaría nada',
    ciegos.length ? `${ciegos.join(', ')} verían una pantalla en blanco`
                  : puedenHistorial.join(' · '));
}

seccion('Con qué orden abre cada rol');
{
  // El conjunto se DERIVA de los permisos, así que esto comprueba la derivación
  // además del valor: son los roles con toda la cartera y sin consolidado.
  const esperados = Object.keys(mod.PERMISOS)
    .filter(r => mod.PERMISOS[r].todas_obras && !mod.vePanelEjecutivo(r)).sort();
  const abren = Object.keys(mod.PERMISOS)
    .filter(r => mod.ordenInicialDeLista(r) === 'atraso').sort();
  check(abren.join(',') === esperados.join(','),
    'abren por atraso los roles con toda la cartera y sin vista concentrada',
    abren.length ? abren.join(' · ') : '(ninguno)');
  check(abren.includes('contralor') && abren.includes('administrativo'),
    'y hoy ésos son contralor y administrativo, que es el encargo',
    abren.join(' · '));

  check(mod.ordenInicialDeLista('residente') === 'nombre'
        && mod.ordenInicialDeLista('director_general') === 'nombre',
    'los demás siguen abriendo en A → Z, con lista o con tabla',
    'residente · director_general → nombre');

  // El hueco de diseño, afirmado para que no se cierre por accidente ni se
  // quede sin que nadie lo vea: estos dos roles NO entran al panel ejecutivo.
  // En una constructora ese panel trae margen (P5). Está en PENDIENTES.
  const enPanel = ['contralor', 'administrativo'].filter(r => mod.vePanelEjecutivo(r));
  check(enPanel.length === 0,
    'y NO se les metió al panel ejecutivo: el orden es paliativo, no la solución',
    enPanel.length ? `${enPanel.join(', ')} ya ve el panel — eso trae margen`
                   : 'contralor y administrativo siguen fuera');
}

// ════════════════════════════════════════════════════════════════════════════
// 2) El atraso de cada obra, y que el fixture no sea degenerado
// ════════════════════════════════════════════════════════════════════════════
seccion('Qué atraso tiene cada obra');
{
  const atrasoDe = atrasoDeCon(mod);
  const v = {};
  for (const o of OBRAS) v[o.id] = atrasoDe(o);
  for (const o of OBRAS)
    console.log(`       ${o.id} ${o.nombre.padEnd(26)} ${v[o.id] === null ? 'null' : `${v[o.id] > 0 ? '+' : ''}${v[o.id]} d`}`);

  check([v['0112'], v['0114'], v['0126']].every(d => typeof d === 'number'),
    'las tres obras con plazo tienen atraso medible: hay algo que ordenar',
    `${v['0112']} · ${v['0114']} · ${v['0126']}`);
  check(new Set([v['0112'], v['0114'], v['0126']]).size === 3,
    'y los tres son DISTINTOS: con empates el orden pasaría solo',
    'tres valores distintos');
  check(v['0112'] > 0 && v['0126'] < 0,
    'hay una atrasada y una adelantada: el signo entra en la comparación',
    `${v['0112']} vs ${v['0126']}`);
  check(v['0127'] === null && v['0125'] === null,
    'y dos sin atraso medible, por razones distintas',
    'un cierre solo · sin fin capturado');

  // Las dos razones, nombradas: importa que la segunda tenga `razon: null`,
  // porque es la que demuestra que el orden mira el número y no la razón.
  const r127 = mod.atrasoProyectado(OBRAS[3], null, DATOS['0127'].historialAvanceSemanas, 0, AHORA);
  const r125 = mod.atrasoProyectado(OBRAS[4], null, DATOS['0125'].historialAvanceSemanas, 0, AHORA);
  check(r127.razon === mod.SIN_PROY_POCOS_CIERRES && r125.razon === null,
    'una por falta de cierres y la otra con proyección perfecta y sin plazo',
    `0127: ${r127.razon} · 0125: razon=${r125.razon}, fin=${r125.finVigente}`);

  // El avance EN VIVO entra a la cuenta: no es el del último cierre. Si el
  // catálogo de la obra no se leyera, dos obras con el mismo historial y
  // distinto ejecutado darían el mismo atraso.
  const conCatalogo = mod.atrasoDeObra(OBRAS[0],
    { subs: [{ imp: 38500000, a: 80 }], historialAvanceSemanas: HISTORIAL }, AHORA);
  check(typeof conCatalogo === 'number' && conCatalogo < v['0112'],
    'el avance en vivo del catálogo entra: más ejecutado, menos atraso',
    `sin catálogo ${v['0112']} d · con el 80% ejecutado ${conCatalogo} d`);
}

// ════════════════════════════════════════════════════════════════════════════
// 3) EL ORDEN, y de dónde sale
// ════════════════════════════════════════════════════════════════════════════
seccion('El orden por atraso');
{
  const atrasoDe = atrasoDeCon(mod);
  const puestos = ordenDe(mod.porAtrasoDesc(OBRAS, atrasoDe));
  console.log(`       ${puestos.join(' → ')}`);

  check(puestos.slice(0, 3).join(',') === '0112,0114,0126',
    'la más atrasada primero, la adelantada después de las dos tarde',
    puestos.slice(0, 3).join(' → '));

  // El corazón de la sección: `null` al FINAL, no en el lugar de un cero.
  // 0126 va a −228 días: si los nulos valieran 0 se colarían ANTES que ella, o
  // sea en medio de la lista, donde se leen como «ésta va en tiempo».
  check(puestos.slice(3).sort().join(',') === '0125,0127',
    'las dos sin atraso medible van AL FINAL, no en el lugar que les daría un 0',
    `${puestos[3]} · ${puestos[4]}`);
  const pos = id => puestos.indexOf(id);
  check(pos('0126') < pos('0125') && pos('0126') < pos('0127'),
    'incluso después de la obra ADELANTADA: `null` no es «cero días de atraso»',
    `0126 (${atrasoDe(OBRAS[2])} d) en el lugar ${pos('0126') + 1}, los nulos en ${pos('0125') + 1} y ${pos('0127') + 1}`);
  check(pos('0125') < pos('0127'),
    'y entre ellas por nombre, que es lo único que se sabe: Bordo antes de Pavimentación',
    'Bordo de Contención → Pavimentación Sur');

  // No reordena en su lugar: la pantalla le pasa su propia lista y mutarla
  // cambiaría el orden de las tarjetas de otros modos de orden.
  const copia = [...OBRAS];
  mod.porAtrasoDesc(copia, atrasoDe);
  check(ordenDe(copia).join(',') === ordenDe(OBRAS).join(','),
    'y no reordena la lista que recibe',
    ordenDe(copia).slice(0, 2).join(' → ') + ' …');

  check(ordenDe(mod.porAtrasoDesc([], atrasoDe)).length === 0,
    'una cartera vacía no revienta',
    '[]');
}

// ════════════════════════════════════════════════════════════════════════════
// 4) LA CONTRAPRUEBA SEMÁNTICA: se muta la cuenta y el orden tiene que seguirla
// ════════════════════════════════════════════════════════════════════════════
//
// Esto no mide el valor, mide de DÓNDE sale. Se vuelve a armar el módulo con
// `atrasoProyectado` NEGADO —atraso donde había adelanto— y se exige que el
// orden se dé la vuelta. Una resta escrita a mano dentro de `atrasoDeObra` no
// se habría movido, y los números de la sección 2 seguirían siendo correctos:
// una prueba de valores habría firmado la copia como buena.
seccion('Si se mueve la cuenta, se mueve el orden');
{
  const negado = armar({
    atrasoProyectado: (o, info, h, av, ahora) => {
      const real = mod.atrasoProyectado(o, info, h, av, ahora);
      return { ...real,
        desviacionDias: real.desviacionDias === null ? null : -real.desviacionDias };
    },
  });
  const atrasoDe = atrasoDeCon(negado);
  check(atrasoDe(OBRAS[0]) === -mod.atrasoDeObra(OBRAS[0], DATOS['0112'], AHORA),
    'el atraso de una obra pasa por `atrasoProyectado`, no por una resta propia',
    `real ${mod.atrasoDeObra(OBRAS[0], DATOS['0112'], AHORA)} d · mutado ${atrasoDe(OBRAS[0])} d`);

  const puestos = ordenDe(negado.porAtrasoDesc(OBRAS, atrasoDe));
  check(puestos.slice(0, 3).join(',') === '0126,0114,0112',
    'y el ORDEN se da la vuelta con ella: es la misma cuenta, no dos que coinciden',
    puestos.join(' → '));

  // Los nulos siguen al final: la mutación no los convierte en números, así que
  // su lugar no depende del valor sino de que no haya valor.
  check(puestos.slice(3).sort().join(',') === '0125,0127',
    'los nulos siguen al final: su lugar no depende de cuánto, sino de que no hay',
    `${puestos[3]} · ${puestos[4]}`);
}

{
  // Segunda mutación, sobre la OTRA mitad del armado: el plazo vigente. Si
  // `atrasoDeObra` armara la obra por su cuenta —o invirtiera la precedencia de
  // `info`— esto no se movería, y es justo el error que mide contra el plazo
  // firmado y declara a tiempo una obra que no lo está.
  const FIJO = 42;
  const plano = armar({
    proyeccionDeAvance: () => ({ velocidad: 1, semanasBase: 2, semanasAFin: 1,
      fechaFin: new Date(AHORA), desviacionDias: FIJO, finVigente: '2026-11-30',
      ampliado: false, razon: null }),
  });
  const atrasoDe = atrasoDeCon(plano);
  const todos = OBRAS.map(o => atrasoDe(o));
  check(todos.every(d => d === FIJO),
    'las cinco pasan por `proyeccionDeAvance`: ninguna trae su propia proyección',
    todos.join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════
// 5) Y LA PANTALLA LAS USA
// ════════════════════════════════════════════════════════════════════════════
//
// Todo lo de arriba comprueba cuatro funciones. Si la pantalla no las llamara,
// las cuatro estarían perfectas y la lista seguiría pintándose igual que antes:
// 24 verdes sobre código muerto. Esto lee el CABLEADO en el JSX.
seccion('La pantalla está cableada a ellas');
{
  let pantalla = null;
  traverse(ast, { FunctionDeclaration(p) {
    if (p.node.id?.name === 'PantallaObras') pantalla = p.node;
  } });
  const dentro = (n) => n.start >= pantalla.start && n.end <= pantalla.end;
  if (!pantalla)
    sinPrecondicion('no encontré `PantallaObras`',
      ['La pantalla de obras cambió de forma o de nombre. Las cuatro funciones',
       'de arriba pueden estar perfectas y no estar llamadas por nadie.']);

  // Los `const` de la pantalla y los nombres que menciona cada uno.
  const init = {};
  const guardas = [];     // expresiones de la forma `X && <jsx>`
  traverse(ast, {
    VariableDeclarator(p) {
      if (!dentro(p.node) || !p.node.init) return;
      const n = p.node.id?.name;
      if (n && !(n in init)) init[n] = texto(p.node.init);
      // `const[orden,setOrden]=useState(...)`: el nombre vive en el patrón.
      if (p.node.id?.type === 'ArrayPattern') {
        const prim = p.node.id.elements[0]?.name;
        if (prim && !(prim in init)) init[prim] = texto(p.node.init);
      }
    },
    LogicalExpression(p) {
      if (!dentro(p.node) || p.node.operator !== '&&') return;
      guardas.push({ izq: texto(p.node.left), der: texto(p.node.right) });
    },
  });

  check(/veListaDeTarjetas\s*\(/.test(init.veLista || ''),
    '`veLista` sale de `veListaDeTarjetas`, no de un condicional en la pantalla',
    (init.veLista || '(no existe)').replace(/\s+/g, ' ').slice(0, 64));
  check(/ordenInicialDeLista\s*\(/.test(init.orden || ''),
    'el orden de arranque sale de `ordenInicialDeLista`',
    (init.orden || '(no existe)').replace(/\s+/g, ' ').slice(0, 64));
  check(/porAtrasoDesc\s*\(/.test(init.ordenar || ''),
    '`ordenar` llama a `porAtrasoDesc` en vez de traer su propio comparador',
    /porAtrasoDesc/.test(init.ordenar || '') ? 'cableado' : '(no lo llama)');
  check(/atrasoDeObra\s*\(/.test(init.atrasoDe || ''),
    'y el atraso de cada obra sale de `atrasoDeObra`',
    (init.atrasoDe || '(no existe)').replace(/\s+/g, ' ').slice(0, 64));

  // El cerrojo de verdad: la lista de tarjetas detrás de `veLista`.
  const deLaLista = guardas.filter(g => /listaActual\s*\.\s*map\s*\(/.test(g.der));
  check(deLaLista.length > 0 && deLaLista.every(g => /\bveLista\b/.test(g.izq)),
    'las tarjetas se pintan detrás de `veLista`',
    deLaLista.length === 0 ? '`listaActual.map` no está detrás de ningún `&&`'
      : deLaLista.map(g => g.izq.replace(/\s+/g, ' ').slice(0, 40)).join(' · '));

  // Y el aviso de «no hay ninguna» NO, para que cero obras no deje una pantalla
  // en blanco que se lee como una falla de la app.
  const delAviso = guardas.filter(g => /listaActual\s*\.\s*length\s*===\s*0/.test(g.izq));
  check(delAviso.length > 0 && delAviso.every(g => !/\bveLista\b/.test(g.izq)),
    'el aviso de cartera vacía NO: con cero obras la pantalla no se queda en blanco',
    delAviso.length === 0 ? 'no encontré el aviso'
      : delAviso[0].izq.replace(/\s+/g, ' ').slice(0, 48));

  // Y que el orden se pueda ELEGIR: para los demás roles es la única entrada.
  const opciones = [];
  traverse(ast, { JSXAttribute(p) {
    if (!dentro(p.node) || p.node.name?.name !== 'value') return;
    if (p.parent.name?.name !== 'option') return;
    if (p.node.value?.type === 'StringLiteral') opciones.push(p.node.value.value);
  } });
  check(opciones.includes('atraso'),
    'y «Atraso» es una opción del selector, no sólo el valor de arranque de dos roles',
    opciones.filter(v => ['nombre', 'atraso', 'importe_desc'].includes(v)).join(' · '));
}

// ════════════════════════════════════════════════════════════════════════════
// 6) Y ALGUIEN CARGA LOS DATOS CON LOS QUE SE ORDENA
// ════════════════════════════════════════════════════════════════════════════
//
// Esta sección existe por un defecto que las cinco anteriores NO vieron, y vale
// la pena dejarlo escrito porque es el modo de fallo más caro de todos.
//
// El orden por atraso lee `datosPorObra[id]` —`subs` y `historialAvanceSemanas`—
// y ese mapa lo llena un `useEffect` con oyentes por obra, con su propio
// cerrojo. Ese cerrojo preguntaba SÓLO por el panel ejecutivo, y `contralor` y
// `administrativo` no están ahí: para ellos el mapa quedaba vacío, `atrasoDeObra`
// devolvía `null` en todas, los nulos se iban al final empatados por nombre, y
// la lista salía en orden alfabético.
//
// Y NADA estaba rojo. El orden era correcto, los nulos iban donde van, el banco
// tenía 31 verdes y el selector abría en «Atraso: Mayor → Menor». Lo único que
// pasaba es que el orden no podía existir. Se vio en la pantalla, con una cuenta
// de contralor sembrada, mirando tres tarjetas en «EJECUTADO $0».
seccion('Alguien carga los datos con los que se ordena');
{
  const sinPanel = [...mod.ROLES_SIN_CONCENTRADO];
  const huerfanos = sinPanel.filter(r => !mod.necesitaDatosDeCartera(r));
  check(sinPanel.length > 0 && huerfanos.length === 0,
    'los roles que ordenan por atraso piden los datos de su cartera',
    huerfanos.length ? `${huerfanos.join(', ')} ordenaría con el mapa vacío`
                     : sinPanel.join(' · '));

  // Y los del panel siguen pidiéndolos: ensanchar el cerrojo no puede haber
  // dejado fuera a los que ya estaban dentro.
  const perdidos = Object.keys(mod.PERMISOS)
    .filter(r => mod.vePanelEjecutivo(r) && !mod.necesitaDatosDeCartera(r));
  check(perdidos.length === 0,
    'y los del panel ejecutivo no los perdieron',
    perdidos.length ? perdidos.join(', ') : 'los 8 siguen dentro');

  // La frontera del margen NO se aflojó. Quién pide se amplió; qué se entrega
  // lo sigue decidiendo el TIPO de organización, no el rol. `contralor` y
  // `administrativo` son de dependencia, así que su recorte es el de cuatro
  // claves y ninguna de economía (P5).
  check(mod.CLAVES_BULK_DEPENDENCIA
        && !mod.CLAVES_BULK_DEPENDENCIA.some(k =>
          ['maquinaria', 'materiales', 'otrosGastos', 'nominaSemanas'].includes(k)),
    'el recorte de dependencia sigue sin economía interna del contratista',
    (mod.CLAVES_BULK_DEPENDENCIA || []).join(' · '));

  // Y el cerrojo del efecto está cableado a la función, no a una lista suelta.
  const gatillo = /const\s+cargarCartera\s*=\s*!!usuario\s*&&\s*necesitaDatosDeCartera\s*\(/
    .test(src);
  check(gatillo, 'el cerrojo del cargador sale de `necesitaDatosDeCartera`',
    gatillo ? 'cableado' : 'el efecto pregunta por su cuenta');
  check(/if\s*\(\s*!cargarCartera\s*\)\s*return/.test(src),
    'y el efecto se corta con él',
    /if\s*\(\s*!cargarCartera\s*\)\s*return/.test(src) ? 'cortado' : '(no lo usa)');
}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas > 0) {
  console.log('');
  console.log('Si esto está rojo, la primera obra de la lista del contralor puede no ser');
  console.log('la más atrasada — o puede serlo según una cuenta distinta de la que va a');
  console.log('ver cuando abra la obra. Para un rol sin vista concentrada, ese orden es');
  console.log('lo único que tiene para decidir a cuál entrar.');
}
process.exit(fallas > 0 ? 1 : 0);
