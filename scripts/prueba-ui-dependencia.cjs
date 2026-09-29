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
//
// Esa última mutación es la que enseñó algo. Con la primera versión de esta
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

const NECESARIOS = [
  'TABS_POR_ROL', 'TABS_DEPENDENCIA', 'tabsDe', 'esDependencia',
  'SUBTABS_OPERACION_DEPENDENCIA', 'SUBTABS_PLANEACION_DEPENDENCIA',
  'RUTAS_SOLO_CONSTRUCTORA', 'seSuscribe',
  'useGPConstruct',
  'BIBLIOTECA_RIESGOS', 'RIESGOS_SOLO_CONSTRUCTORA', 'detectarRiesgos', 'SEVERIDADES',
  'ALERTA_REGLAS',
  'CLAVES_BULK', 'CLAVES_BULK_DEPENDENCIA', 'datosObraCompletos',
  'MXN', 'avanceFisicoPonderado', 'heImporte',
];
const faltan = NECESARIOS.filter(n => !decl[n]);
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
  return { tabsDe, TABS_POR_ROL,
           SUBTABS_OPERACION_DEPENDENCIA: ${decl['SUBTABS_OPERACION_DEPENDENCIA']},
           SUBTABS_PLANEACION_DEPENDENCIA: ${decl['SUBTABS_PLANEACION_DEPENDENCIA']} };`)();

seccion('El menú');

const ROLES_DEP = ['director_obras', 'subdirector', 'jefe_supervision',
                   'supervisor_obra', 'administrativo', 'contralor'];

// Lo que el municipio tiene que ver. Cuatro pestañas, no tres: el Dashboard
// recortado carga las cifras del contrato y las otras tres son avance,
// evidencia y contrato.
const ESPERADAS = ['Dashboard', 'Avance', 'Evidencia', 'Contrato'];

for (const rol of ROLES_DEP) {
  const labels = menus.tabsDe({ rol, tipo: 'dependencia' }).map(t => t.label);
  check(JSON.stringify(labels) === JSON.stringify(ESPERADAS),
    `${rol} ve exactamente las cuatro pestañas del contrato`, labels.join(' · '));
}

// LO QUE IMPORTA de este bloque: no basta con que salgan las cuatro buenas.
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

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})();
