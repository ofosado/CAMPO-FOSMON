#!/usr/bin/env node
// La pestaña de estimaciones de una dependencia: qué dice en pantalla, qué
// deja escrito, y qué pasa cuando no se puede escribir.
//
// POR QUÉ ESTA PRUEBA. Es la primera pantalla donde una DEPENDENCIA captura
// dinero. Hasta hoy el único capturador de estimaciones era el de la
// constructora, que guarda con `fsSetA` — y `fsSetA` se traga el rechazo de
// las reglas y devuelve `false`. Del lado constructora eso casi nunca se nota
// porque las reglas de la raíz las dejan escribir; del lado dependencia la
// ruta lleva prefijo de organización y un rechazo es perfectamente posible.
// El resultado sería un supervisor que teclea $4,000,000, ve la pantalla
// idéntica, y no guardó nada. Dinero capturado que se evapora sin una sola
// señal: el peor modo de fallo que puede tener esto.
//
// Las seis cosas que se miden, todas como CONDUCTA —el texto que sale en
// pantalla y el valor que queda escrito—, nunca como «existe tal símbolo» (P3):
//
//   1. La ventana de carga no afirma ceros. La lista arranca en `[]`; pintar
//      «$0 recibido» mientras Firestore contesta es una afirmación falsa
//      sobre el expediente, no un hueco.
//   2. El periodo se captura con FECHA DE CIERRE, no como texto libre. Sin un
//      día de cierre el contador de días de recepción no existe, y «sep-2026»
//      no dice contra qué día contar.
//   3. Los días de recepción son un número, un hueco o nada — nunca un cero
//      inventado. Y la cuenta no se mueve un día por la zona horaria.
//   4. A→B (P6): el estatus que la pantalla OFRECE es el que
//      `corteDeEstimaciones` cuenta. Las dos puntas pueden estar bien por
//      separado y el cable entre ellas estar cortado: un selector que diga
//      «Pagado» deja el corte semanal en cero sin que nada se queje.
//   5. Un guardado que falla se ve. El error de las reglas llega hasta la
//      pantalla con el texto de lo que pasó.
//   6. La factura no se archiva bajo el permiso de las fotos. Va a su propia
//      ruta, con el prefijo de organización que `conOrg` calcula de verdad.
//
// El componente se EJECUTA: se extrae de src/App.jsx, se transpila el JSX y
// se renderiza. Se prueba la pantalla, no una copia mía de la pantalla.
//
// Uso:  node scripts/prueba-estimaciones-dependencia.cjs [App.jsx]
//
// Contraprueba: la corre sola al final, mutando cinco veces el archivo real.
// Cada mutación tiene que salir en ROJO (código 1) y no NO ARRANCÓ (código 2).

// La zona horaria se fija ANTES del primer Date. Al oeste de Greenwich,
// `new Date("2026-09-30")` cae el día 29, y ése es exactamente el error que
// la sección 3 persigue. Sin fijarla, la prueba pasaría en una máquina en UTC
// y el defecto llegaría a la demo.
process.env.TZ = 'America/Mexico_City';

const path = require('path');
const fs = require('fs');
const os = require('os');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ARCH_APP = process.argv[2] ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const fallos = [];
const check = (cond, m, detalle) => {
  const d = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${d}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${d}`); }
};

// ── Extracción del código real ─────────────────────────────────────────────
const NOMBRES = [
  '_ne', 'corteDeEstimaciones',
  'ESTATUS_PAGADA', 'ESTATUS_ESTIMACION_DEPENDENCIA',
  '_fechaLocal', 'periodoEnPalabras', 'diasDeRecepcion',
  'MXN', 'NUM', 'EST_COL', 'EST_COL_DEP',
  'subirAdjuntoEstimacion',
];
const FUNCIONES = ['EstimacionesDependencia'];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const trozos = [];
const vistos = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type !== 'Program') return;
    if (NOMBRES.includes(n) || FUNCIONES.includes(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
  },
});

if (!vistos.has('EstimacionesDependencia')) {
  noArranco('src/App.jsx no tiene la pantalla de estimaciones de dependencia');
}
if (!vistos.has('corteDeEstimaciones')) {
  noArranco('src/App.jsx no tiene corteDeEstimaciones: no hay contra qué medir el cable');
}

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${[...vistos].sort().join(', ')}\n`);

// ── El banco de pruebas ────────────────────────────────────────────────────
// Infraestructura de mentira: las piezas que la pantalla USA pero que no son
// lo que se está midiendo. Todo lo demás es el código real del archivo.
const sinEstilo = (tipo, extra) => props => {
  const { children, ...resto } = props || {};
  return React.createElement(tipo, extra ? extra(resto) : null, children);
};
const UI = {
  Card: sinEstilo('div'),
  Tit:  sinEstilo('div'),
  Bdg:  ({ children }) => React.createElement('span', null, ' [', children, '] '),
  Kpi:  ({ label, value, sub }) =>
          React.createElement('div', null, ` «${label}» = ${value} (${sub ?? ''}) `),
  Inp:  props => React.createElement('input', { type: props.type || 'text',
          value: String(props.value ?? ''), readOnly: true }),
  Sel:  ({ children, value }) =>
          React.createElement('select', { value: String(value ?? ''), readOnly: true }, children),
  SecBtn: ({ children }) => React.createElement('button', null, children),
};
const C = new Proxy({}, { get: () => '#888' });

// Los dos escritores. Cada corrida decide qué hacen; `llamadas` guarda con
// qué los llamaron, que es lo que permite afirmar dónde quedó el dato.
let llamadas = [];
const hazBanco = ({ estricto, laxo, borrar, useState }) => {
  const js = esbuild.transformSync(
    `${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`,
    { loader: 'jsx' }).code;
  return new Function(
    'React', 'useState', 'can', 'C',
    'Card', 'Tit', 'Kpi', 'Bdg', 'Inp', 'Sel', 'SecBtn',
    'fsSetAEstricto', 'fsSetA', 'borrarFotoHuerfana',
    'storageRef', 'uploadString', 'getDownloadURL', 'fbStor', 'conOrg',
    `"use strict";\n${js}`)(
    React, useState || React.useState, () => true, C,
    UI.Card, UI.Tit, UI.Kpi, UI.Bdg, UI.Inp, UI.Sel, UI.SecBtn,
    estricto, laxo, borrar,
    (_s, ruta) => ({ fullPath: ruta }),
    async () => {}, async r => `https://fake/${r.fullPath}`,
    {}, p => p);
};

// El banco "de lectura": sólo para mirar qué dice la pantalla.
const banco = hazBanco({
  estricto: async (...a) => { llamadas.push(['estricto', ...a]); return true; },
  laxo:     async (...a) => { llamadas.push(['laxo', ...a]); return false; },
  borrar:   async () => {},
});
const { corteDeEstimaciones, periodoEnPalabras, diasDeRecepcion } = banco;

const OBRA = { id: '0001', nombre: 'LIBRAMIENTO', contrato: 'DOP-2026-01', presupuesto: 10000000 };
const USR  = { correo: 'supervisor@cotea.com.mx', rol: 'supervisor_obra', tipo: 'dependencia' };

// Lo que se ve en pantalla, en texto plano.
const pantalla = (estimaciones, estCargadas = true) => {
  const el = React.createElement(banco.EstimacionesDependencia, {
    obra: OBRA, estimaciones, setEstimaciones: () => {}, estCargadas,
    rol: USR.rol, usuario: USR,
  });
  return renderToStaticMarkup(el);
};
const texto = markup => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ════════════════════════════════════════════════════════════════════════════
console.log('1 · LA VENTANA DE CARGA NO AFIRMA CEROS');
// ════════════════════════════════════════════════════════════════════════════
{
  // El caso que duele: la lista todavía viene en camino y la obra tiene
  // millones recibidos. Un «$0» aquí no se distingue de «esta obra no ha
  // recibido nada».
  const t = texto(pantalla([], false));
  console.log(`       « ${t} »`);
  check(!/\$\s?0\b/.test(t) && !/\$0/.test(t),
    'mientras carga NO escribe un $0 que no sabe', `dice «${t}»`);
  check(!/\bsin estimaciones recibidas\b/i.test(t),
    'mientras carga tampoco afirma que no hay estimaciones');
  check(/consultando|cargando/i.test(t),
    'mientras carga dice que está consultando', `dice «${t}»`);

  // Y con la lista ya cargada y vacía SÍ puede afirmarlo: eso es un hecho.
  const vacia = texto(pantalla([], true));
  check(/sin estimaciones recibidas/i.test(vacia),
    'con la lista cargada y vacía sí afirma que no hay ninguna');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2 · EL PERIODO LLEVA FECHA DE CIERRE, NO TEXTO LIBRE');
// ════════════════════════════════════════════════════════════════════════════
{
  const una = [{ no: 1, monto: 1000000, estatus: 'Recibida',
                 periodoIni: '2026-09-01', periodoFin: '2026-09-30',
                 periodo: periodoEnPalabras('2026-09-01', '2026-09-30'),
                 fechaRecepcion: '2026-10-05', adjuntos: [] }];
  const markup = pantalla(una);
  const t = texto(markup);
  console.log(`       « ${t} »`);

  check(/cierre del periodo/i.test(t),
    'la pantalla pide explícitamente el cierre del periodo');

  const fechas = (markup.match(/type="date"/g) || []).length;
  check(fechas >= 3,
    'inicio, cierre y recepción se capturan con selector de fecha',
    `${fechas} campos de fecha en el renglón`);

  // Que no quede un campo de texto donde se pueda teclear "sep-2026": si
  // existe, vuelve a haber dos versiones del periodo y una de las dos miente.
  const textos = (markup.match(/type="text"/g) || []).length;
  check(textos === 0,
    'no queda ningún campo de texto libre donde teclear el periodo',
    `${textos} campos de texto`);

  // La zona horaria: el cierre del 30 se tiene que leer «30», no «29».
  const frase = periodoEnPalabras('2026-09-01', '2026-09-30');
  check(/\b30\b/.test(frase) && !/\b29\b/.test(frase),
    'el cierre del 30 de septiembre se escribe 30, no 29',
    `dice «${frase}» (TZ=${process.env.TZ})`);

  // A→B con la pantalla de la constructora: allá el renglón sólo aparece si
  // `e.monto > 0 || (e.periodo && e.periodo.trim())`. El `periodo` derivado
  // tiene que pasar ese filtro, o la misma estimación desaparece del otro lado.
  check(typeof frase === 'string' && frase.trim().length > 0,
    'el periodo derivado es un string no vacío: la constructora lo sigue viendo',
    `«${frase}»`);
  check(periodoEnPalabras('', '') === '',
    'sin ninguna de las dos fechas el periodo queda vacío, no inventado');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3 · DÍAS DE RECEPCIÓN: NÚMERO, HUECO O NADA — NUNCA UN CERO');
// ════════════════════════════════════════════════════════════════════════════
{
  const d = (fin, rec) => diasDeRecepcion({ periodoFin: fin, fechaRecepcion: rec });

  check(d('2026-09-30', '2026-10-05') === 5,
    'cinco días entre el cierre y la ventanilla se cuentan como 5',
    `contó ${d('2026-09-30', '2026-10-05')}`);
  check(d('2026-09-30', '2026-09-30') === 0,
    'presentada el mismo día del cierre son 0 días — y ese 0 sí es un hecho');
  check(d('2025-12-31', '2026-01-02') === 2,
    'la cuenta cruza el fin de año', `contó ${d('2025-12-31', '2026-01-02')}`);
  check(d('2026-02-28', '2026-03-01') === 1,
    'la cuenta cruza el fin de mes', `contó ${d('2026-02-28', '2026-03-01')}`);

  check(d('2026-09-30', '') === null,
    'sin fecha de recepción no hay número: devuelve null, no 0');
  check(d('', '2026-10-05') === null,
    'sin fecha de cierre no hay número: devuelve null, no 0');
  check(d(undefined, undefined) === null,
    'una estimación vieja, sin ninguno de los dos campos, tampoco inventa un 0');

  // Y lo que de verdad importa: lo que sale ESCRITO.
  const sinRecibo = texto(pantalla([{ no: 1, monto: 100, estatus: 'Recibida',
    periodoFin: '2026-09-30', fechaRecepcion: '', adjuntos: [] }]));
  check(/sin fecha de recepci/i.test(sinRecibo),
    'la pantalla dice «sin fecha de recepción» y no «0 d»', `dice «${sinRecibo}»`);
  check(!/\b0 d\b/.test(sinRecibo),
    'y en ningún lado escribe «0 d» para esa estimación');

  const sinCierre = texto(pantalla([{ no: 1, monto: 100, estatus: 'Recibida',
    periodoFin: '', fechaRecepcion: '2026-10-05', adjuntos: [] }]));
  check(/sin fecha de cierre/i.test(sinCierre),
    'y distingue el hueco del cierre del hueco de la recepción', `dice «${sinCierre}»`);

  const conDias = texto(pantalla([{ no: 1, monto: 100, estatus: 'Recibida',
    periodoFin: '2026-09-30', fechaRecepcion: '2026-10-05', adjuntos: [] }]));
  check(/\b5 d\b/.test(conDias),
    'con las dos fechas escribe los 5 días', `dice «${conDias}»`);

  // El promedio NO mete las incompletas como cero, y dice sobre cuántas va.
  const mezcla = texto(pantalla([
    { no: 1, monto: 100, estatus: 'Recibida', periodoFin: '2026-09-30', fechaRecepcion: '2026-10-10' }, // 10
    { no: 2, monto: 100, estatus: 'Recibida', periodoFin: '2026-08-31', fechaRecepcion: '2026-09-10' }, // 10
    { no: 3, monto: 100, estatus: 'Recibida', periodoFin: '2026-07-31', fechaRecepcion: '' },           // —
  ]));
  check(/«Días de recepción» = 10 d/.test(mezcla),
    'el promedio es 10 y no 6.7: la incompleta no cuenta como cero',
    `dice «${(mezcla.match(/«Días de recepción»[^(]*\([^)]*\)/) || [''])[0]}»`);
  check(/promedio de 2 de 3/.test(mezcla),
    'y la pantalla dice sobre cuántas de cuántas se calculó');

  const ninguna = texto(pantalla([{ no: 1, monto: 100, estatus: 'Recibida' }]));
  check(/«Días de recepción» = sin dato/.test(ninguna),
    'sin ninguna fecha completa el KPI dice «sin dato», no «0 d»',
    `dice «${(ninguna.match(/«Días de recepción»[^(]*/) || [''])[0]}»`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4 · EL ESTATUS QUE LA PANTALLA OFRECE ES EL QUE CUENTA EL CORTE');
// ════════════════════════════════════════════════════════════════════════════
// El cable del P6. `corteDeEstimaciones` está probado aparte y esta pantalla
// está probada arriba; entre las dos hay un literal, y un literal que no
// empata no rompe nada visible: el corte semanal se queda en cero y el
// expediente guarda ese cero para siempre.
{
  const markup = pantalla([{ no: 1, monto: 100, estatus: 'Recibida', adjuntos: [] }]);
  const opciones = [...markup.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m => m[1]);
  check(opciones.length >= 2,
    'el selector de estatus ofrece opciones', `ofrece: ${opciones.join(' · ') || '(ninguna)'}`);

  const cuentan = opciones.filter(s =>
    corteDeEstimaciones([{ monto: 100, estatus: s }], true)?.pagado === 100);
  check(cuentan.length === 1,
    'exactamente UNA de las opciones del selector la cuenta el corte como pagada',
    `la cuentan: ${cuentan.join(' · ') || '(ninguna)'}`);

  // Y la que la cuenta es la que la pantalla llama pagada, no otra.
  const pagada = cuentan[0];
  const t = texto(pantalla([
    { no: 1, monto: 4000000, estatus: pagada,     adjuntos: [] },
    { no: 2, monto: 2500000, estatus: 'Recibida', adjuntos: [] },
  ]));
  console.log(`       « ${t.slice(0, 260)} »`);
  const corte = corteDeEstimaciones([
    { monto: 4000000, estatus: pagada }, { monto: 2500000, estatus: 'Recibida' }], true);
  check(corte?.pagado === 4000000 && corte?.estimado === 6500000,
    'lo capturado aquí entra completo al corte semanal',
    `estimado ${corte?.estimado} · pagado ${corte?.pagado}`);
  check(/«Pagado» = \$4,000,000/.test(t),
    'y la pantalla escribe el mismo pagado que el corte',
    `dice «${(t.match(/«Pagado»[^(]*/) || [''])[0]}»`);
  check(/«Total recibido» = \$6,500,000/.test(t),
    'y el mismo total');
  check(/«Por pagar» = \$2,500,000/.test(t),
    'lo que falta por pagar es la diferencia, no otra cuenta');

  // Lo que NO debe aparecer: la economía interna del contratista (P5).
  for (const prohibido of [/anticipo/i, /fondo de garant/i, /retenci/i, /efectivo/i, /margen/i]) {
    check(!prohibido.test(t),
      `la pantalla no muestra «${prohibido.source}» — es economía del contratista`,
      'P5');
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5 · UN GUARDADO QUE FALLA SE VE EN LA PANTALLA');
// ════════════════════════════════════════════════════════════════════════════
// Aquí no se renderiza: se EJECUTA el manejador del botón. Se le pone un
// escritor que rechaza —como lo haría una regla de Firestore— y se mira si
// algo llegó a la pantalla. Con `fsSetA` no llegaría nada: devuelve `false`.
{
  const RECHAZO = 'Missing or insufficient permissions.';
  const avisos = [];
  const estados = [];
  const useStateFalso = inicial => {
    const i = estados.length;
    estados.push(inicial);
    return [inicial, v => avisos.push([i, typeof v === 'function' ? v(inicial) : v])];
  };

  let llamoEstricto = false, llamoLaxo = false;
  const bancoFallo = hazBanco({
    useState: useStateFalso,
    estricto: async () => { llamoEstricto = true; throw new Error(RECHAZO); },
    laxo:     async () => { llamoLaxo = true; return false; },   // el que se traga el error
    borrar:   async () => {},
  });

  const ests = [{ no: 1, monto: 4000000, estatus: 'Recibida', adjuntos: [] }];
  const arbol = bancoFallo.EstimacionesDependencia({
    obra: OBRA, estimaciones: ests, setEstimaciones: () => {}, estCargadas: true,
    rol: USR.rol, usuario: USR,
  });

  const botones = [];
  const caminar = n => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(caminar);
    if (n.props?.onClick) botones.push(n);
    caminar(n.props?.children);
  };
  caminar(arbol);

  const dice = el => {
    const t = [];
    const rec = n => {
      if (n == null) return;
      if (typeof n === 'string' || typeof n === 'number') { t.push(String(n)); return; }
      if (Array.isArray(n)) return n.forEach(rec);
      if (typeof n === 'object') rec(n.props?.children);
    };
    rec(el.props?.children);
    return t.join(' ');
  };
  const guardar = botones.find(b => /guardar/i.test(dice(b)));
  check(!!guardar, 'la pantalla tiene un botón de guardar que se puede ejercitar',
    `botones encontrados: ${botones.map(dice).join(' · ') || '(ninguno)'}`);

  const corrida = (async () => {
    if (guardar) { try { await guardar.props.onClick(); } catch (e) { avisos.push([-1, `EXCEPCIÓN ${e.message}`]); } }

    const dichos = avisos.map(([, v]) => String(v));
    const aviso = dichos.find(v => /no se guard/i.test(v));

    check(llamoEstricto && !llamoLaxo,
      'el guardado usa el escritor que LANZA, no el que devuelve false',
      `estricto=${llamoEstricto} laxo=${llamoLaxo}`);
    check(!!aviso,
      'cuando las reglas rechazan, la pantalla dice que NO se guardó',
      `la pantalla recibió: ${dichos.filter(Boolean).join(' | ') || '(nada)'}`);
    check(aviso && aviso.includes(RECHAZO),
      'y dice QUÉ pasó, con el error de las reglas, no un «error» genérico',
      aviso ? `«${aviso}»` : '—');
    check(aviso && /no cierres|vuelve a intentar|todav/i.test(aviso),
      'y le dice al capturista que lo que ve en pantalla todavía no está guardado',
      aviso ? `«${aviso}»` : '—');

    // ══════════════════════════════════════════════════════════════════════
    console.log('\n6 · LA FACTURA NO SE ARCHIVA BAJO EL PERMISO DE LAS FOTOS');
    // ══════════════════════════════════════════════════════════════════════
    // La ruta se calcula con el `conOrg` REAL de src/rutas-org.js, el mismo
    // que usa la app: una copia aquí se desincronizaría y la prueba seguiría
    // verde mientras el archivo se va a un lugar que las reglas niegan.
    // Se importa el módulo directo y no el puente `rutas-org-para-pruebas`:
    // ese puente fija el prefijo de CONSTRUCTORA para todos sus clientes, y
    // aquí hace falta mover el prefijo a dependencia y de vuelta.
    let rutas;
    try { rutas = await import(path.resolve(raiz, 'src/rutas-org.js')); }
    catch (e) { noArranco(`no se pudo cargar src/rutas-org.js — ${e.message}`); }
    if (typeof rutas?.conOrg !== 'function' || typeof rutas?.fijarPrefijoOrg !== 'function') {
      noArranco('src/rutas-org.js no expone conOrg/fijarPrefijoOrg');
    }

    if (typeof banco.subirAdjuntoEstimacion !== 'function') {
      check(false, 'existe el subidor de adjuntos de estimación');
    } else {
      rutas.fijarPrefijoOrg('dependencia', 'cotea');
      let rutaUsada = null;
      // Se arma aparte, inyectando el `conOrg` real y capturando la ruta.
      const js = esbuild.transformSync(
        `${trozos.join('\n')}\n;return subirAdjuntoEstimacion;`, { loader: 'jsx' }).code;
      const subir = new Function('React', 'storageRef', 'uploadString', 'getDownloadURL',
        'fbStor', 'conOrg', 'C', `"use strict";\n${js}`)(
        React,
        (_s, ruta) => { rutaUsada = ruta; return { fullPath: ruta }; },
        async () => {}, async r => `https://fake/${r.fullPath}`,
        {}, rutas.conOrg, C);

      await subir('0001', 7, 'abc-factura', 'data:application/pdf;base64,AAA');

      check(rutaUsada === 'orgs/cotea/obras/0001/estimaciones/7/abc-factura',
        'el adjunto se archiva bajo la organización, en la ruta de estimaciones',
        `quedó en «${rutaUsada}»`);
      check(rutaUsada && !/\/fotos\//.test(rutaUsada),
        'y NO cuelga de /fotos/, que es lo que ve cualquiera con acceso a la galería');

      rutas.fijarPrefijoOrg('constructora', 'fosmon');
      let rutaC = null;
      const subirC = new Function('React', 'storageRef', 'uploadString', 'getDownloadURL',
        'fbStor', 'conOrg', 'C', `"use strict";\n${js}`)(
        React,
        (_s, ruta) => { rutaC = ruta; return { fullPath: ruta }; },
        async () => {}, async r => `https://fake/${r.fullPath}`,
        {}, rutas.conOrg, C);
      await subirC('0114', 1, 'xyz', 'data:application/pdf;base64,AAA');
      check(rutaC === 'obras/0114/estimaciones/1/xyz',
        'una constructora sigue archivando en la raíz, sin prefijo',
        `quedó en «${rutaC}»`);

      // Y si Storage rechaza, lanza — nunca devuelve una URL de mentira que
      // acabe guardada en Firestore apuntando a la nada.
      const subirRoto = new Function('React', 'storageRef', 'uploadString', 'getDownloadURL',
        'fbStor', 'conOrg', 'C', `"use strict";\n${js}`)(
        React, (_s, r) => ({ fullPath: r }),
        async () => { const e = new Error('no'); e.code = 'storage/unauthorized'; throw e; },
        async () => 'x', {}, rutas.conOrg, C);
      let lanzo = null;
      try { await subirRoto('0114', 1, 'xyz', 'data:x'); } catch (e) { lanzo = e; }
      check(lanzo instanceof Error,
        'si Storage rechaza el adjunto, lanza en vez de devolver una URL falsa',
        lanzo ? `«${lanzo.message}»` : 'devolvió sin lanzar');
    }

    veredicto();
  })();

  corrida.catch(e => noArranco(`el banco reventó — ${e?.stack || e}`));
}

// ── Contraprueba ───────────────────────────────────────────────────────────
// Cinco mutaciones del archivo real. Cada una tiene que salir ROJA (código 1)
// y no NO ARRANCÓ (código 2): un banco que revienta no comprueba nada, y un
// punto ciego disfrazado de regresión se "arregla" tocando la prueba.
const MUTACIONES = [
  ['guarda con el escritor que se traga el error',
    s => s.replace(/await fsSetAEstricto\(`obras\/\$\{obra\.id\}\/config\/estimaciones`/,
                   'await fsSetA(`obras/${obra.id}/config/estimaciones`')],
  ['el estatus pagado se escribe «Pagado»',
    s => s.replace(/const ESTATUS_PAGADA = "Pagada";/, 'const ESTATUS_PAGADA = "Pagado";')],
  ['la fecha se interpreta en UTC',
    s => s.replace(/return m \? new Date\(\+m\[1\], \+m\[2\] - 1, \+m\[3\]\) : null;/,
                   'return m ? new Date(s) : null;')],
  ['la falta de fecha cuenta como cero días',
    s => s.replace(/if \(!cierre \|\| !recibo\) return null;/, 'if (!cierre || !recibo) return 0;')],
  ['la pantalla pinta cifras mientras carga',
    s => s.replace(/if \(!estCargadas\) \{/, 'if (false) {')],
];

function contraprueba() {
  if (process.env.SIN_CONTRAPRUEBA) return 0;
  console.log('\n── CONTRAPRUEBA ───────────────────────────────────────────────');
  let malas = 0;
  for (const [nombre, mutar] of MUTACIONES) {
    const mutado = mutar(src);
    if (mutado === src) {
      console.log(`   ✗ «${nombre}»: la mutación no aplicó — la prueba no la vigila`);
      malas++; continue;
    }
    const tmp = path.join(os.tmpdir(), `contraprueba-est-dep-${Math.random().toString(36).slice(2)}.jsx`);
    fs.writeFileSync(tmp, mutado);
    const r = require('child_process').spawnSync(process.execPath, [__filename, tmp],
      { encoding: 'utf8', env: { ...process.env, SIN_CONTRAPRUEBA: '1' } });
    fs.unlinkSync(tmp);
    if (r.status === 1) console.log(`   ✓ «${nombre}» → ROJO`);
    else {
      malas++;
      console.log(`   ✗ «${nombre}» → salió ${r.status} ` +
        `(${r.status === 0 ? 'VERDE: la prueba no lo detecta' : 'NO ARRANCÓ: el banco revienta'})`);
    }
  }
  return malas;
}

function veredicto() {
  const malas = contraprueba();
  const n = fallos.length;
  console.log(`\n${n === 0 ? '✅  todo en verde' : `❌  ${n} en rojo`}` +
    `${malas ? ` · ${malas} contrapruebas no sirven` : ''}\n`);
  if (n) fallos.forEach(f => console.log(`   · ${f}`));
  process.exit(n || malas ? 1 : 0);
}
