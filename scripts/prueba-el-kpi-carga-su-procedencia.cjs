#!/usr/bin/env node
// Prueba: al quitar del tablero de la obra las tarjetas «Personal en campo —
// Semana N» y «Margen bruto de obra», lo que esas tarjetas decían Y LOS KPIS
// NO siguió saliendo a pantalla.
//
// Las dos tarjetas repetían cifras de la fila de KPIs de arriba —el mismo
// personal, el mismo margen— y por eso se fueron. Pero ninguna era 100%
// repetición: la de personal era el único sitio que decía DE QUÉ SEMANA son
// las cifras y si esa semana vino rayada en varios archivos, y la de margen el
// único que decía CÓMO se cuenta («Ejecutado + almacén − Gasto total»).
// Borrarlas de golpe se habría llevado ese 20% sin que nada se pusiera rojo:
// la pantalla seguiría enseñando un número correcto, sólo que sin decir de
// cuándo es ni de qué sale.
//
// Lo que se afirma aquí son CIFRAS Y CADENAS QUE SALEN A PANTALLA: los dos
// `<Kpi>` se localizan por su rótulo, se RENDERIZAN de verdad y se afirma
// sobre el texto y sobre el `title` que producen. Las cuentas salen de
// `plantillaDeObra` y `presentacionEconomiaObra` extraídas del archivo y
// ejecutadas; este banco no teclea ninguna.
//
// Uso:  node scripts/prueba-el-kpi-carga-su-procedencia.cjs [archivo]
//       node scripts/prueba-el-kpi-carga-su-procedencia.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const noArranco = require('./no-arranco.cjs');
const { fuenteDe } = require('./extraer-de-app.cjs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const archivo = process.argv.find(a => a.endsWith('.jsx')) || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Los dos sitios de pantalla, buscados por lo que DICEN ─────────────────
// No por dónde están ni por qué función los arma: un `<Kpi>` con ese rótulo es
// la conducta. Si el rótulo cambia, este banco no arranca —sale con 2— y eso
// es correcto: significa que nadie está mirando lo que el rótulo prometía.
const kpiDe = {};          // rótulo → fuente del <Kpi>
let rangoPlantilla = null; // para la contraprueba
let fuenteDashboard = null;

traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.name === 'plantillaDeObra' && p.node.init && !p.scope.parent) {
      rangoPlantilla = [p.node.init.start, p.node.init.end];
    }
  },
  FunctionDeclaration(p) {
    if (p.node.id?.name === 'Dashboard' && !p.scope.parent?.parent) {
      fuenteDashboard = src.slice(p.node.start, p.node.end);
    }
  },
  JSXElement(p) {
    if (p.node.openingElement.name.name !== 'Kpi') return;
    const txt = src.slice(p.node.start, p.node.end);
    const m = txt.match(/label="(Personal campo|Margen bruto)"/);
    if (!m || kpiDe[m[1]]) return;
    kpiDe[m[1]] = txt;
  },
});

const PEDIDOS = ['semanasDeNomina', 'plantillaDeObra', 'presentacionEconomiaObra',
  'nivelMargen', 'C', 'MXN'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
const ausentes = [...faltan];
if (!kpiDe['Personal campo']) ausentes.push('el <Kpi> «Personal campo» del tablero');
if (!kpiDe['Margen bruto'])   ausentes.push('el <Kpi> «Margen bruto» del tablero');
if (!fuenteDashboard)         ausentes.push('el componente Dashboard');
if (!rangoPlantilla)          ausentes.push('`plantillaDeObra` como const de módulo');
if (ausentes.length) noArranco(ausentes, path.relative(raiz, archivo));

const api = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
const { semanasDeNomina, plantillaDeObra, presentacionEconomiaObra, nivelMargen, C } = api;

// ── Contraprueba ──────────────────────────────────────────────────────────
// Dos mutaciones, una por conducta, cada una devolviendo la pantalla a cómo
// estaba ANTES de esta rama. Las dos dejan intacto el andamiaje: los rótulos
// siguen ahí, los símbolos siguen existiendo, el banco se monta igual. Lo
// único que cambia es lo que sale a pantalla.
if (process.argv.includes('--contraprueba')) {
  const mutaciones = [
    { nombre: '`plantillaDeObra` vuelve a entregar sólo el número, como el KPI viejo',
      hacer: () => {
        const viejo = '((h = []) => { const u = h.length ? h[h.length - 1] : null;'
          + ' const d = u?.totalDir || 0, i = u?.totalInd || 0;'
          + ' return { hayNomina: true, total: d + i, dir: d, ind: i, semana: null,'
          + ' partes: 1, valor: String(d + i), sub: `${d}D · ${i}I` }; })';
        const [ini, fin] = rangoPlantilla;
        return src.slice(0, ini) + viejo + src.slice(fin);
      } },
    { nombre: 'el KPI de margen vuelve a colgar del `margenTitulo` de antes',
      hacer: () => src.replace('title={pres.margenTooltip}', 'title={pres.margenTitulo}') },
  ];
  let malas = 0;
  for (const m of mutaciones) {
    const texto = m.hacer();
    if (texto === src) {
      console.log(`CONTRAPRUEBA NO APLICADA: ${m.nombre} no cambió nada.`);
      malas++;
      continue;
    }
    const destino = path.join(require('os').tmpdir(),
      `contraprueba-kpi-procedencia-${malas}-${Date.now()}.jsx`);
    fs.writeFileSync(destino, texto);
    console.log(`\nContraprueba: ${m.nombre}.\n`);
    const r = require('child_process').spawnSync(process.execPath, [__filename, destino],
      { encoding: 'utf8' });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    console.log(r.stdout.replace(/^/gm, '  │ '));
    if (rojas > 0) console.log(`  → ${rojas} comprobación(es) se cayeron.`);
    else { console.log('  → NADA SE CAYÓ. Esa conducta no está mirada.'); malas++; }
  }
  console.log(malas === 0
    ? '\nContraprueba correcta: las dos conductas están miradas.'
    : `\nCONTRAPRUEBA EN ROJO: ${malas} conducta(s) se pueden romper sin que nada grite.`);
  process.exit(malas > 0 ? 1 : 0);
}

// ── Renderizado de verdad de los dos KPIs ─────────────────────────────────
// El `Kpi` de la app se sustituye por uno que escupe sus partes en texto plano
// y conserva el `title`, que es donde vive la fórmula.
const Kpi = ({ label, value, sub, color, title }) =>
  React.createElement('div', { title }, `${label}|${value}|${sub}|${color} `);

const pinta = (jsx, ambito) => {
  const js = esbuild.transformSync(`(${jsx})`, { loader: 'jsx' }).code;
  const nombres = Object.keys(ambito);
  const markup = renderToStaticMarkup(
    new Function('React', 'Kpi', ...nombres, `"use strict"; return ${js};`)(
      React, Kpi, ...nombres.map(n => ambito[n])));
  return {
    markup,
    texto: markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    title: (markup.match(/title="([^"]*)"/) || [, ''])[1],
  };
};

const pintaPersonal = (historial) =>
  pinta(kpiDe['Personal campo'], { plantilla: plantillaDeObra(historial), C });

const pintaMargen = (kpis) => {
  const pres = presentacionEconomiaObra(kpis);
  return { pres, ...pinta(kpiDe['Margen bruto'],
    { pres, me: kpis.me, mNiv: nivelMargen(kpis.mpct), C }) };
};

// La nómina real de la 0126 (Cangrejera), leída de producción el 2026-09-22:
// la semana 38 llegó en dos archivos, 99 personas en uno y 35 en el otro.
const P0126 = require(path.join(__dirname, 'nomina-produccion-2026-09-22.cjs'))['0126'];
const H = semanasDeNomina(P0126);

// ══════════════════════════════════════════════════════════════════════════
console.log('1. Sin nómina cargada el KPI no publica un cero\n');
// La 0131 no tiene ninguna semana. Publicaba `0`, idéntico al `0` de una obra
// con cero personas medidas, y se leía como una obra vacía de gente en vez de
// como una obra sin medir.
const vacio = pintaPersonal([]);
console.log('       « ' + vacio.texto + ' »');
check(/\|sin nómina\|/.test(vacio.texto),
  'el valor dice «sin nómina», no una cifra',
  vacio.texto.match(/Personal campo\|([^|]*)\|/)?.[1] || '?');
check(!/\|0\|/.test(vacio.texto), 'y en particular NO dice 0');
check(/no se ha cargado nómina/.test(vacio.texto),
  'y debajo dice por qué no hay cifra');
check(!vacio.texto.includes(C.green),
  'el color no es el verde de una plantilla medida', C.green);

console.log('\n2. Con nómina, el KPI dice de qué semana son las cifras\n');
const lleno = pintaPersonal(H);
console.log('       « ' + lleno.texto + ' »');
check(/\|134\|/.test(lleno.texto), 'el total en pantalla es 134',
  lleno.texto.match(/Personal campo\|([^|]*)\|/)?.[1] || '?');
check(/51D · 83I/.test(lleno.texto),
  'con el desglose en directos e indirectos que decía la tarjeta borrada');
check(/Semana 38/.test(lleno.texto),
  'y DE QUÉ SEMANA habla, que el KPI viejo no decía');
check(/2 partes/.test(lleno.texto),
  'y que esa semana vino rayada en 2 archivos sumados');
// Una obra al día y una con la plantilla de hace tres semanas publicaban el
// mismo rótulo. Seis de las siete obras vivas van en la 45 y la 0114 en la 44.
const atrasada = pintaPersonal(semanasDeNomina(P0126.slice(0, 2)));
check(/Semana 37/.test(atrasada.texto) && !/Semana 38/.test(atrasada.texto),
  'otra obra con la nómina más vieja dice su propia semana, no la de hoy',
  atrasada.texto.match(/\|[^|]*(Semana \d+)/)?.[1] || '?');
check(!/partes/.test(atrasada.texto),
  'y una semana que vino en un solo archivo no habla de partes');

console.log('\n3. El tablero no vuelve a contar la plantilla por su cuenta\n');
// Una cuenta por número: el criterio vive en `plantillaDeObra` y el Dashboard
// lo consume. Mientras la tarjeta existió, el mismo `totalDir + totalInd`
// estaba escrito dos veces en el mismo componente.
check(!/totalDir|totalInd/.test(fuenteDashboard),
  'el Dashboard de la obra no suma `totalDir`/`totalInd` en ningún renglón');
check(!/nominaHistorial\s*\[/.test(fuenteDashboard),
  'ni va a buscar la última semana del arreglo a mano');
check(/plantillaDeObra\s*\(\s*nominaHistorial\s*\)/.test(fuenteDashboard),
  'lo que hace es pedírsela a `plantillaDeObra`');

console.log('\n4. El margen dice CÓMO se cuenta, sin apagar la señal del hueco\n');
// La tarjeta borrada traía la fórmula escrita debajo del título. Era lo único
// que decía y el KPI no.
const medido = pintaMargen({ gastoGPMedido: true, me: 52_200_000, gt: 44_000_000,
  presupuesto: 144_596_003, pctGasto: 30.4, mpct: 15.7, diff: 8_200_000 });
console.log('       « ' + medido.texto + ' »');
console.log('       title: « ' + medido.title + ' »');
check(/Ejecutado \+ almacén − Gasto total/.test(medido.title),
  'la fórmula sale a pantalla, al alcance del cursor');
check(/÷ \(Ejecutado \+ almacén\)/.test(medido.title),
  'con su denominador: el margen se divide entre lo ejecutado, no entre el contrato');
check(/GP \+ maquinaria propia \+ otros gastos/.test(medido.title),
  'y dice qué suma el gasto, que es de dónde salía el margen inflado');
check(/de ejec\.\+almacén/.test(medido.texto),
  'el subtítulo nombra el denominador');
check(!/ejec\. vs gastado/.test(medido.texto),
  'y ya no dice «ejec. vs gastado», que decía contra qué sin decir sobre qué');
check(medido.pres.margenTitulo === undefined,
  'con el margen medido NO hay explicación de hueco: esa señal queda libre');

// El campo `margenTitulo` vale `undefined` cuando el margen sí se pudo medir, y
// seis pantallas preguntan por él para saber si hay algo que no se puede
// afirmar. Meter la fórmula ahí habría contestado «sí hay un hueco» en las
// siete obras. Por eso son dos campos y el tooltip los junta una sola vez.
const sinMedir = pintaMargen({ gastoGPMedido: false, gastoGPMotivo: 'no-pedida',
  me: 52_200_000, gt: 0, presupuesto: 144_596_003, pctGasto: 0, mpct: 0, diff: 0 });
console.log('       « ' + sinMedir.texto + ' »');
check(typeof sinMedir.pres.margenTitulo === 'string' && sinMedir.pres.margenTitulo.length > 0,
  'sin gasto medido sí hay explicación de hueco: la señal sigue sirviendo');
check(/la corrida del cron lo llena/.test(sinMedir.title),
  'y el tooltip la dice: la obra se dio de alta después de la última corrida');
check(/Ejecutado \+ almacén − Gasto total/.test(sinMedir.title),
  'sin perder la fórmula: el motivo y la cuenta caben los dos');
check(/no se puede afirmar sin el gasto/.test(sinMedir.texto),
  'y el subtítulo no afirma ningún porcentaje');
check(!/15\.7|%/.test(sinMedir.texto.replace(/\|[^|]*$/, '')),
  'en particular no se cuela un porcentaje de la obra medida');

console.log('\n5. Las dos tarjetas se fueron y su 20% único está arriba\n');
// Lo que se midió antes de borrarlas, pieza por pieza. Esta es la lista que
// decide si borrar era seguro.
const enPantalla = lleno.texto + ' ' + lleno.title + ' ' + medido.texto + ' ' + medido.title;
for (const [pieza, re] of [
  ['la semana de la que son las cifras de plantilla', /Semana 38/],
  ['que esa semana vino en varias partes', /2 partes/],
  ['el desglose directos / indirectos', /51D · 83I/],
  ['la fórmula del margen bruto', /Ejecutado \+ almacén − Gasto total/],
  ['el nivel del margen en palabras', /Normal|Bien|Aceptable|Atención|Crítico/],
]) check(re.test(enPantalla), `sigue en pantalla: ${pieza}`);

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
