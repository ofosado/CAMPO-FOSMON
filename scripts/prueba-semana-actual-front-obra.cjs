#!/usr/bin/env node
// Prueba: dentro de UNA obra, "la semana actual" de nómina es la última del
// CALENDARIO con sus partes sumadas, no la última raya que se subió.
//
// Cubre el camino del front de obra, que se alimenta del state
// `nominaHistorial`: el PDF ejecutivo, los tres avisos de nómina y el KPI
// "Personal en campo" del tablero. (El camino del portafolio va por el
// `onSnapshot` y lo cubre `prueba-semana-actual-nomina.cjs`.)
//
// El defecto era real y estaba en producción el 2026-09-22. La 0126 rayó su
// semana 38 en dos archivos —99 trabajadores por $502,603.33 y otros 35 por
// $152,950.00, gente distinta— porque así llegó la raya. Como todos estos
// lectores tomaban `nominaHistorial[nominaHistorial.length - 1]`, el PDF que
// se entrega al cliente decía 35 trabajadores donde había 134.
//
// Lo que se afirma aquí son CIFRAS QUE SALEN A PANTALLA. El cargador se
// localiza por la RUTA que lee y los avisos por su `id`, no por el nombre de
// ninguna función; la tarjeta del tablero se renderiza de verdad y se afirma
// sobre su texto. Así un renombre no pone esto en rojo y un cambio de conducta
// sí.
//
// Uso:  node scripts/prueba-semana-actual-front-obra.cjs [archivo]
//       node scripts/prueba-semana-actual-front-obra.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const archivo = process.argv.find(a => a.endsWith('.jsx')) || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const $ = n => (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cerca = (a, b) => Math.abs(a - b) < 0.005;

// ── Extracción ────────────────────────────────────────────────────────────
const global = {};
const rango = {};       // dónde vive cada uno, para poder mutarlo
let cargador = null;    // el .then() del fsGet de obras/{id}/nomina/historial
let tarjetaKPI = null;  // el <Card> de "Personal en campo"
const avisos = {};      // los `detect` de nom_001..003, por id

traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent) {
      if (global[p.node.id.name] === undefined) {
        global[p.node.id.name] = src.slice(p.node.init.start, p.node.init.end);
        rango[p.node.id.name] = [p.node.init.start, p.node.init.end];
      }
    }
  },
  // El cargador del historial de la obra: `fsGet('obras/${obraId}/nomina/
  // historial').then(cb)`. Se localiza por la RUTA que pide.
  CallExpression(p) {
    const c = p.node.callee;
    if (c.type !== 'MemberExpression' || c.property.name !== 'then') return;
    const obj = c.object;
    if (obj.type !== 'CallExpression' || obj.callee.name !== 'fsGet') return;
    const ruta = src.slice(obj.arguments[0].start, obj.arguments[0].end);
    if (!/nomina\/historial/.test(ruta)) return;
    cargador = src.slice(p.node.arguments[0].start, p.node.arguments[0].end);
  },
  // Los avisos viven en un arreglo de objetos con `id` y `detect`.
  ObjectExpression(p) {
    const props = Object.fromEntries(p.node.properties
      .filter(x => x.type === 'ObjectProperty' && x.key.name)
      .map(x => [x.key.name, x.value]));
    if (!props.id || !props.detect || props.id.type !== 'StringLiteral') return;
    if (!/^nom_00[123]$/.test(props.id.value)) return;
    avisos[props.id.value] = src.slice(props.detect.start, props.detect.end);
  },
  // La tarjeta del tablero se busca por lo que DICE, no por dónde está.
  JSXElement(p) {
    if (tarjetaKPI) return;
    const txt = src.slice(p.node.start, p.node.end);
    if (p.node.openingElement.name.name !== 'Card') return;
    if (!/Personal en campo/.test(txt)) return;
    if (!/<Kpi\b/.test(txt)) return;
    tarjetaKPI = txt;
  },
});

const NECESARIOS = ['semanaISO', 'heImporte', 'numSemanaNomina', 'fechaCargaNomina',
  'añoSemanaNomina', 'claveSemanaNomina', 'semanasDeNomina'];
for (const n of NECESARIOS)
  if (!global[n]) check(false, `se pudo extraer \`${n}\` de ${path.basename(archivo)}`);
if (!cargador)   check(false, 'se localizó el cargador de obras/{id}/nomina/historial');
if (!tarjetaKPI) check(false, 'se localizó la tarjeta «Personal en campo» del tablero');
for (const id of ['nom_001', 'nom_002', 'nom_003'])
  if (!avisos[id]) check(false, `se localizó el aviso \`${id}\``);
if (fallas) { console.log('\nNo se pudo montar la prueba.'); process.exit(1); }

// ── Contraprueba ──────────────────────────────────────────────────────────
// Se devuelve `semanasDeNomina` a la conducta vieja —entregar las cargas tal
// como vienen, sin ordenar por calendario ni sumar las partes— dejando INTACTO
// todo lo demás: el nombre sigue existiendo, la ruta sigue siendo la misma, los
// avisos conservan su id y la tarjeta su texto. La prueba sigue montándose sin
// problema; lo único que cambia es lo que sale a pantalla. Si esto no la pone
// en rojo, la prueba no está mirando la conducta.
if (process.argv.includes('--contraprueba')) {
  const viejo = '((registros) => (Array.isArray(registros) ? registros : []))';
  const [ini, fin] = rango.semanasDeNomina;
  const mutado = path.join(require('os').tmpdir(), 'contraprueba-front-obra.jsx');
  fs.writeFileSync(mutado, src.slice(0, ini) + viejo + src.slice(fin));
  console.log('Contraprueba: `semanasDeNomina` devuelve las cargas en orden de');
  console.log('llegada, como antes del fix. Todo lo demás queda igual.\n');
  const r = require('child_process').spawnSync(process.execPath, [__filename, mutado],
    { encoding: 'utf8' });
  const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
  console.log(r.stdout.replace(/^/gm, '  │ '));
  console.log(rojas > 0
    ? `Contraprueba correcta: ${rojas} comprobación(es) se cayeron al romper la conducta.`
    : 'CONTRAPRUEBA EN ROJO: romper la conducta no tumbó nada. La prueba no sirve.');
  process.exit(rojas > 0 ? 0 : 1);
}

const api = new Function(`"use strict";
  ${NECESARIOS.map(n => `const ${n} = ${global[n]};`).join('\n  ')}
  return { ${NECESARIOS.join(', ')} };`)();
const { heImporte } = api;

const MXN = n => '$' + (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Corre el cargador real y devuelve lo que acaba en `nominaHistorial`.
const loQueVeLaObra = (registros) => {
  let recibido = null, fecha = null;
  new Function('d', 'setNominaHistorial', 'setFechasModulos', ...NECESARIOS,
    `"use strict"; (${cargador})(d);`)(
    { semanas: registros },
    (v) => { recibido = v; },
    (fn) => { fecha = fn({}).nomina; },
    ...NECESARIOS.map(n => api[n]),
  );
  return { historial: recibido, fechaModulo: fecha };
};

const correrAviso = (id, nominaHistorial) =>
  new Function('ctx', 'heImporte', 'MXN',
    `"use strict"; return (${avisos[id]})(ctx);`)({ nominaHistorial }, heImporte, MXN);

// ── Datos de producción, 0126 (Cangrejera), leídos el 2026-09-22 ──────────
// El arreglo va en ORDEN DE CARGA, que es como está guardado en Firestore.
const trabs = (n, totalCada, heHrs = 0, salSem = 0) =>
  [...Array(n)].map((_, i) => ({
    nombre: `TRABAJADOR NUMERO ${i}`, total: totalCada, horasExtra: heHrs,
    salSem, impHE: 0, dias: 6, tipo: i % 9 === 0 ? 'I' : 'D',
  }));

const P0126 = [
  { semana: 'Semana 36', fecha: '3/9/2026',  archivo: 'S36.xlsx', trabajadores: trabs(135, 4886.11),
    totalNomina: 659725.00, totalDir: 120, totalInd: 15, totalHEImp: 12000, totalHEHrs: 300, totalDias: 810 },
  { semana: 'Semana 37', fecha: '14/9/2026', archivo: 'S37.xlsx', trabajadores: trabs(138, 4689.70),
    totalNomina: 647179.17, totalDir: 123, totalInd: 15, totalHEImp: 11000, totalHEHrs: 275, totalDias: 828 },
  // La semana 38 llegó en dos archivos, con gente distinta en cada uno.
  // En el primero hay 24 personas con 22 horas extra; en el segundo, ninguna.
  { semana: 'Semana 38', fecha: '21/9/2026', archivo: 'S38-parte1.xlsx',
    trabajadores: [...trabs(24, 5076.80, 22, 1800), ...trabs(75, 5076.80, 0, 1800)],
    totalNomina: 502603.33, totalDir: 86, totalInd: 13, totalHEImp: 108000, totalHEHrs: 528, totalDias: 594 },
  { semana: 'Semana 38', fecha: '21/9/2026', archivo: 'S38-parte2.xlsx',
    trabajadores: trabs(35, 4370.00, 0, 1800),
    totalNomina: 152950.00, totalDir: 31, totalInd: 4, totalHEImp: 0, totalHEHrs: 0, totalDias: 210 },
];

const personal = s => (s.totalDir || 0) + (s.totalInd || 0);
const ultimaSubida = P0126[P0126.length - 1];

// ══════════════════════════════════════════════════════════════════════════
console.log('1. La obra ve su nómina completa, no la última raya que llegó\n');
const { historial: H, fechaModulo } = loQueVeLaObra(P0126);
const act = H[H.length - 1];

check(personal(act) === 134,
  'la semana actual son 134 trabajadores',
  `${personal(act)} (por posición daban ${personal(ultimaSubida)})`);
check(cerca(act.totalNomina, 655553.33),
  'y $655,553.33 de nómina',
  `$${$(act.totalNomina)} (por posición daba $${$(ultimaSubida.totalNomina)})`);
check(act.trabajadores.length === 134,
  'la plantilla trae a los 134, no a 35', String(act.trabajadores.length));
check(H.length === 3, 'cuatro cargas son tres semanas', `${P0126.length} → ${H.length}`);

console.log('\n2. El KPI «Personal en campo» del tablero dice de qué semana habla\n');
// Se renderiza la tarjeta de verdad y se afirma sobre el texto que produce.
const _ultNom = H.length > 0 ? H[H.length - 1] : null;
const dir = _ultNom?.totalDir || 0, ind = _ultNom?.totalInd || 0;
const Kpi = ({label, value, sub}) => React.createElement('div', null, `${label}|${value}|${sub} `);
const Tit = ({children}) => React.createElement('div', null, children);
const Card = ({children}) => React.createElement('div', null, children);
const Bdg  = ({children}) => React.createElement('span', null, ' [', children, '] ');
const C = new Proxy({}, { get: () => '#888' });
const js = esbuild.transformSync(`(${tarjetaKPI})`, { loader: 'jsx' }).code;
const pintado = renderToStaticMarkup(
  new Function('React', 'Card', 'Tit', 'Kpi', 'Bdg', 'C', '_ultNom', 'dir', 'ind',
    'clickableCard', 'onNavTab', 'heImporte', 'MXN', `"use strict"; return ${js};`)(
    React, Card, Tit, Kpi, Bdg, C, _ultNom, dir, ind,
    () => ({}), null, heImporte, MXN));
const texto = pintado.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('       « ' + texto + ' »');

check(/Personal en campo — Semana 38/.test(texto),
  'la tarjeta dice «Personal en campo — Semana 38»');
check(!/Personal en campo — Semana 39/.test(texto),
  'y no la semana del calendario de hoy, que es otra cosa');
check(/\|134\|/.test(texto), 'el total en pantalla es 134', texto.match(/Total\|(\d+)\|/)?.[1] || '?');
check(/partes/.test(texto) && /2 partes/.test(texto),
  'y avisa que esa semana vino en 2 partes sumadas');

console.log('\n3. Los tres avisos de nómina miran la semana completa\n');
const a1 = correrAviso('nom_001', H);
check(a1 !== null && a1.valor === '24',
  'nom_001 cuenta los 24 con horas extra ≥20 de la primera parte',
  a1 ? a1.valor : 'no disparó');
check(a1 !== null && a1.severidad === 'alto',
  'y lo marca ALTO porque son más de 10', a1 ? a1.severidad : '—');

const a2 = correrAviso('nom_002', H);
const pctReal = 108000 / 655553.33 * 100;
check(a2 !== null && a2.valor === `${pctReal.toFixed(0)}%`,
  `nom_002 mide las HE contra los $655,553 de la semana: ${pctReal.toFixed(0)}%`,
  a2 ? a2.valor : 'no disparó');
// Contra la parte 2 sola, el importe de HE es 0 y el aviso ni siquiera existe.
const soloParte2 = loQueVeLaObra([ultimaSubida]).historial;
check(correrAviso('nom_002', soloParte2) === null,
  'leyendo sólo la última raya, ese aviso no existiría');

// nom_003 no cuenta gente: cuenta anomalías de cálculo. Las 99 de la 0126
// están todas en la primera parte, así que leyendo sólo la última raya el
// aviso no aparece y esos 99 sueldos raros no los revisa nadie.
const a3 = correrAviso('nom_003', H);
check(a3 !== null && Number(a3.valor) === 99,
  'nom_003 revisa a los 134 y encuentra 99 sueldos fuera de rango',
  a3 ? a3.valor : 'no disparó');
check(correrAviso('nom_003', soloParte2) === null,
  'leyendo sólo la última raya, esos 99 no los revisaría nadie');

console.log('\n4. El PDF que se entrega imprime la semana completa\n');
// El PDF toma el mismo `nominaHistorial`; se reproduce su cálculo de cabecera.
const nomData = Array.isArray(act?.trabajadores) ? act.trabajadores : [];
const tot = nomData.filter(p => p.tipo === 'D').length + nomData.filter(p => p.tipo === 'I').length;
check(tot === 134, 'el PDF cuenta 134 trabajadores en sitio', String(tot));
check((act.partes?.length || 1) === 2,
  'y sabe que la cifra sale de 2 archivos, para poder decirlo', String(act.partes?.length));
check(/S38-parte1\.xlsx \+ S38-parte2\.xlsx/.test(act.archivo || ''),
  'con los dos archivos identificados', act.archivo);

console.log('\n5. La fecha del módulo es la de la última CARGA, no la de la última semana\n');
// Una raya atrasada no debe hacer parecer que la obra lleva un mes sin
// capturar, ni al revés.
const conAtrasada = loQueVeLaObra([...P0126,
  { semana: 'Semana 20', fecha: '28/9/2026', archivo: 'S20-tarde.xlsx',
    trabajadores: trabs(5, 1000), totalNomina: 5000, totalDir: 5, totalInd: 0 }]);
check(conAtrasada.historial[conAtrasada.historial.length - 1].semana === 'Semana 38',
  'subir una raya atrasada no la convierte en la semana actual',
  conAtrasada.historial[conAtrasada.historial.length - 1].semana);
check(conAtrasada.historial[0].semana === 'Semana 20',
  'la atrasada se coloca en su lugar del calendario', conAtrasada.historial[0].semana);
check(new Date(conAtrasada.fechaModulo).getDate() === 28,
  'pero la fecha de captura del módulo sí avanza al 28',
  new Date(conAtrasada.fechaModulo).toLocaleDateString('es-MX'));
check(new Date(fechaModulo).getDate() === 21,
  'y sin ella se queda en el 21, la última carga real',
  new Date(fechaModulo).toLocaleDateString('es-MX'));

console.log('\n6. Los bordes no dejan la pantalla en blanco ni inventan nada\n');
check(loQueVeLaObra([]).historial.length === 0, 'un historial vacío da cero semanas');
check(loQueVeLaObra([]).fechaModulo === undefined || loQueVeLaObra([]).fechaModulo === null,
  'y sin cargas no se inventa una fecha de captura (P2)');
const raro = { semana: 'Nómina extraordinaria', fecha: '14/9/2026', archivo: 'extra.xlsx',
  trabajadores: trabs(3, 1000), totalNomina: 3000, totalDir: 3, totalInd: 0 };
const mix = loQueVeLaObra([raro, ...P0126]).historial;
check(mix.length === 4 && mix[0].semana === 'Nómina extraordinaria',
  'una carga sin semana legible no se tira, va al principio');
check(personal(mix[mix.length - 1]) === 134,
  'y no se cuela como semana actual', String(personal(mix[mix.length - 1])));

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
