#!/usr/bin/env node
// Prueba: "la semana actual" de nómina es la última del CALENDARIO con sus
// partes sumadas, no la última subida.
//
// El defecto era real y estaba en producción el 2026-09-22. La 0126 rayó su
// semana 38 en dos archivos —99 trabajadores por $502,603.33 y otros 35 por
// $152,950.00, gente distinta— porque así llegó la raya. Como todos los
// lectores tomaban `historial[historial.length - 1]`, el tablero enseñaba el
// segundo archivo solo: $152,950 de $655,553 reales, el 23% de la nómina.
// El mismo criterio fallaba con la 0125, que subió siete semanas de golpe: el
// orden del arreglo es el de carga, no el del calendario.
//
// Lo que se afirma aquí son CIFRAS QUE SALEN A PANTALLA, no que exista una
// función: los datos son los de producción y el recorrido es el mismo que hace
// la app —el oyente de Firestore se extrae del código y se ejecuta— para que
// un renombre no ponga esto en rojo y un cambio de conducta sí.
//
// `--contraprueba` devuelve `semanasDeNomina` a la conducta vieja dejando el
// andamiaje entero en pie —el nombre sigue existiendo, el oyente sigue
// escuchando la misma ruta, el bloque del Panel sigue imprimiendo su rótulo—
// y tumba 21 comprobaciones, todas de conducta: la 0126 baja a 35 trabajadores
// y $152,950, la 0125 sale desordenada, el consolidado vuelve a 350 y
// $2,013,104 y el delta de personal a -71. Ninguna roja es por un renombre.
// Esas cifras son, exactamente, lo que el tablero enseña hoy en producción.
//
// Uso:  node scripts/prueba-semana-actual-nomina.cjs [archivo]
//       node scripts/prueba-semana-actual-nomina.cjs --contraprueba

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

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
const rango = {};          // dónde vive cada uno, para poder mutarlo
let oyenteNomina = null;   // el callback del onSnapshot de nomina/historial
let bloqueMO = null;       // el bloque «MANO DE OBRA CONSOLIDADA» del Panel
traverse(ast, {
  // El bloque de KPIs consolidados se busca por el rótulo que imprime.
  ArrowFunctionExpression(p) {
    if (bloqueMO) return;
    if (p.parent.type !== 'CallExpression' || p.parent.callee !== p.node) return;
    const txt = src.slice(p.node.start, p.node.end);
    if (!/MANO DE OBRA CONSOLIDADA/.test(txt)) return;
    bloqueMO = txt;
  },
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent) {
      if (global[p.node.id.name] === undefined) {
        global[p.node.id.name] = src.slice(p.node.init.start, p.node.init.end);
        rango[p.node.id.name] = [p.node.init.start, p.node.init.end];
      }
    }
  },
  // El oyente que alimenta al tablero: `onSnapshot(doc(...,'nomina','historial'), cb)`.
  // Se localiza por la RUTA que escucha, no por el nombre de nada.
  CallExpression(p) {
    if (p.node.callee.name !== 'onSnapshot' || p.node.arguments.length < 2) return;
    const ruta = src.slice(p.node.arguments[0].start, p.node.arguments[0].end);
    if (!/'nomina'\s*,\s*'historial'/.test(ruta)) return;
    oyenteNomina = src.slice(p.node.arguments[1].start, p.node.arguments[1].end);
  },
});

const necesarios = ['semanaISO', 'heImporte', 'numSemanaNomina', 'fechaCargaNomina',
  'añoSemanaNomina', 'claveSemanaNomina', 'semanasDeNomina'];
for (const n of necesarios)
  if (!global[n]) check(false, `se pudo extraer \`${n}\` de ${path.basename(archivo)}`);
if (!oyenteNomina) check(false, 'se localizó el oyente de obras/{id}/nomina/historial');
if (!bloqueMO) check(false, 'se localizó el bloque «MANO DE OBRA CONSOLIDADA»');
if (fallas) { console.log('\nNo se pudo montar la prueba.'); process.exit(1); }

// ── Contraprueba ──────────────────────────────────────────────────────────
// Se devuelve `semanasDeNomina` a la conducta vieja —entregar las cargas en
// el orden en que llegaron, sin ordenar por calendario ni sumar las partes—
// dejando el andamiaje entero en pie: el nombre sigue existiendo, el oyente
// sigue escuchando la misma ruta y el bloque del Panel sigue imprimiendo su
// rótulo. Sólo cambia lo que sale a pantalla.
if (process.argv.includes('--contraprueba')) {
  const [ini, fin] = rango.semanasDeNomina;
  const mutado = path.join(require('os').tmpdir(), 'contraprueba-nomina.jsx');
  fs.writeFileSync(mutado,
    src.slice(0, ini) + '((registros) => (Array.isArray(registros) ? registros : []))' + src.slice(fin));
  console.log('Contraprueba: `semanasDeNomina` devuelve las cargas en orden de');
  console.log('llegada, como antes del fix. Todo lo demás queda igual.\n');
  const r = require('child_process').spawnSync(process.execPath, [__filename, mutado], { encoding: 'utf8' });
  const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
  console.log(r.stdout.replace(/^/gm, '  │ '));
  console.log(rojas > 0
    ? `Contraprueba correcta: ${rojas} comprobación(es) se cayeron al romper la conducta.`
    : 'CONTRAPRUEBA EN ROJO: romper la conducta no tumbó nada. La prueba no sirve.');
  process.exit(rojas > 0 ? 0 : 1);
}

const api = new Function(`"use strict";
  ${necesarios.map(n => `const ${n} = ${global[n]};`).join('\n  ')}
  return { ${necesarios.join(', ')} };`)();
const { semanasDeNomina, añoSemanaNomina, fechaCargaNomina } = api;

// Ejecuta el oyente real con un documento falso y devuelve lo que el tablero
// acaba recibiendo en `nominaSemanas`.
const loQueRecibeElTablero = (registros) => {
  let recibido = null;
  new Function('snap', 'patch', 'o', ...necesarios, `
    "use strict";
    (${oyenteNomina})(snap);
  `)(
    { exists: () => true, data: () => ({ semanas: registros }) },
    (_id, parche) => { recibido = parche.nominaSemanas; },
    { id: '0126' },
    ...necesarios.map(n => api[n]),
  );
  return recibido;
};

// ── Los datos ─────────────────────────────────────────────────────────────
// La nómina real de las cinco obras activas, leída de producción el
// 2026-09-22. Va en ORDEN DE CARGA, que es como está guardada.
const PROD = require(path.join(__dirname, 'nomina-produccion-2026-09-22.cjs'));
const P0126 = PROD['0126'];   // su semana 38 viene partida en dos archivos
const P0125 = PROD['0125'];   // siete semanas subidas de golpe, en desorden
const trabs = (n, totalCada) =>
  [...Array(n)].map(() => ({ total: totalCada, impHE: 0, dias: 6, tipo: 'D' }));

const personal = s => (s.totalDir || 0) + (s.totalInd || 0);

// ══════════════════════════════════════════════════════════════════════════
console.log('1. La 0126 enseña su nómina completa, no la última raya que llegó');
const c26 = loQueRecibeElTablero(P0126);
const act26 = c26[c26.length - 1];
const ultimaSubida = P0126[P0126.length - 1];

check(personal(act26) === 134,
  'la semana actual son 134 trabajadores', `${personal(act26)} (la última subida daba ${personal(ultimaSubida)})`);
check(cerca(act26.totalNomina, 655553.33),
  'y $655,553.33 de nómina', `$${$(act26.totalNomina)} (la última subida daba $${$(ultimaSubida.totalNomina)})`);
check(act26.totalNomina > ultimaSubida.totalNomina * 4,
  'el criterio viejo enseñaba menos de la cuarta parte',
  `${(ultimaSubida.totalNomina / act26.totalNomina * 100).toFixed(0)}% de lo real`);
check(act26.trabajadores.length === 134,
  'la plantilla de la semana trae a los 134, no a 35', String(act26.trabajadores.length));
// 380 + 24 horas, $45,620 + $2,400, 620 + 214 días.
check(act26.totalHEHrs === 404 && act26.totalHEImp === 48020 && act26.totalDias === 834,
  'horas extra, importe de HE y días también se suman',
  `${act26.totalHEHrs} hrs · $${$(act26.totalHEImp)} · ${act26.totalDias} días`);

console.log('\n2. Y la pantalla puede decir que esa semana vino en partes');
check((act26.partes||[]).length === 2, 'la semana actual declara 2 partes', String((act26.partes||[]).length));
check((act26.partes||[]).map(p => p.archivo).join(' + ') ===
      `${P0126[2].archivo} + ${P0126[3].archivo}`,
  'con los dos archivos identificados por su nombre', act26.archivo);
check(c26.filter(s => (s.partes||[]).length > 1).length === 1,
  'y sólo esa semana los tiene — las otras no se marcan de más');

console.log('\n3. La semana anterior es la 37, no la otra mitad de la 38');
const ant26 = c26[c26.length - 2];
check(ant26.semana === 'Semana 37', 'la anterior es la Semana 37', ant26.semana);
check(personal(act26) - personal(ant26) === -4,
  'el delta de personal es -4, no +99 ni -103',
  `${personal(act26)} − ${personal(ant26)}`);
check(c26.length === 3, 'cuatro cargas son tres semanas', `${P0126.length} cargas → ${c26.length} semanas`);

console.log('\n4. La 0125 se ordena por calendario aunque se cargue en desorden');
const c25 = loQueRecibeElTablero(P0125);
const etiquetas = c25.map(s => s.semana.replace('Semana ', '')).join(' ');
check(etiquetas === '04 07 11 14 18 21 25 30 36 37',
  'las semanas salen en orden de calendario', etiquetas);
check(c25[c25.length - 1].semana === 'Semana 37',
  'la actual es la 37', c25[c25.length - 1].semana);
check(cerca(c25[c25.length - 1].totalNomina, 846044.13),
  'con su importe', `$${$(c25[c25.length - 1].totalNomina)}`);
// CUIDADO: esta comprobación dice lo que el tablero HACE hoy, no lo que
// debería. Las dos "partes" de la 21 no son un cierre partido como el de la
// 0126: son SEM. 22 y SEM. 23, dos semanas distintas que colapsan porque el
// campo `semana` de la 0125 guarda el día del mes y no el número de semana
// (ver #28). El tablero las suma y enseña una semana de más de un millón que
// nunca existió. Cuando se corrijan los números, esta línea cambia a dos
// semanas separadas — y ese cambio es el arreglo, no una regresión.
const s21 = c25.find(s => s.semana === 'Semana 21') || {};
check((s21.partes || []).length === 2,
  'hoy el tablero funde SEM. 22 y SEM. 23 en una sola fila «Semana 21»',
  `$${$(s21.totalNomina)} y ${personal(s21)} trabajadores`);
check(c25.length === 10, 'once cargas son diez semanas', `${P0125.length} → ${c25.length}`);

console.log('\n5. El año se deduce de la carga, y una raya de fin de año no se va al futuro');
const s52 = { semana: 'Semana 52', fecha: '2/1/2027', trabajadores: [] };
const s01 = { semana: 'Semana 01', fecha: '29/12/2026', trabajadores: [] };
check(añoSemanaNomina(s52) === 2026,
  'la semana 52 subida el 2 de enero de 2027 es de 2026', String(añoSemanaNomina(s52)));
check(añoSemanaNomina(s01) === 2027,
  'la semana 1 subida el 29 de diciembre de 2026 es de 2027', String(añoSemanaNomina(s01)));
for (const r of P0125)
  if (añoSemanaNomina(r) !== 2026) check(false, `la ${r.semana} de la 0125 se fue a ${añoSemanaNomina(r)}`);
check(P0125.every(r => añoSemanaNomina(r) === 2026),
  'las siete de la carga masiva de la 0125 quedan todas en 2026');

console.log('\n6. La fecha se lee en d/m/aaaa, que es como la escribe la app');
const f = fechaCargaNomina({ fecha: '2/9/2026' });
check(f.getMonth() === 8 && f.getDate() === 2,
  '"2/9/2026" es el 2 de septiembre, no el 9 de febrero',
  `${f.getDate()}/${f.getMonth() + 1}`);
check(fechaCargaNomina({ fecha: '' }) === null && fechaCargaNomina({}) === null,
  'y una fecha ilegible devuelve null en vez de una fecha inventada');

console.log('\n7. Un registro que no dice a qué semana pertenece no se tira ni se cuela');
const raro = { semana: 'Nómina extraordinaria', fecha: '14/9/2026', archivo: 'extra.xlsx',
  trabajadores: trabs(3, 1000), totalNomina: 3000, totalDir: 3, totalInd: 0 };
const cMix = loQueRecibeElTablero([raro, ...P0126]);
check(cMix.length === 4, 'sigue estando — no se descarta (P2)', `${cMix.length} semanas`);
check(cMix[0].semana === 'Nómina extraordinaria',
  'va al principio de la lista', cMix[0].semana);
check(personal(cMix[cMix.length - 1]) === 134,
  'y NO gana el puesto de semana actual', `la actual sigue con ${personal(cMix[cMix.length - 1])}`);
const soloRaro = loQueRecibeElTablero([raro]);
check(soloRaro.length === 1 && personal(soloRaro[0]) === 3,
  'si es lo único que hay, se enseña igual en vez de dejar la pantalla vacía');

console.log('\n8. Los casos de borde no revientan la pantalla');
check(loQueRecibeElTablero([]).length === 0, 'un historial vacío da cero semanas');
check(semanasDeNomina(null).length === 0 && semanasDeNomina(undefined).length === 0,
  'y ni null ni undefined revientan');
const unaSola = loQueRecibeElTablero([P0126[0]]);
check(unaSola.length === 1 && (unaSola[0].partes||[]).length === 1,
  'una sola carga es una semana de una parte — no se marca como partida');

console.log('\n9. El Panel Ejecutivo suma las cinco obras sobre la semana completa');
// Se renderiza el bloque «MANO DE OBRA CONSOLIDADA» de verdad, alimentado con
// lo que el oyente entrega para cada una de las cinco obras activas.
const OBRAS = ['0112', '0114', '0125', '0126', '0127'];
const datosPorObra = Object.fromEntries(OBRAS.map(id =>
  [id, { nominaSemanas: loQueRecibeElTablero(PROD[id]) }]));
const obrasConKPIs = OBRAS.map(id => ({ obra: { id, nombre: PROD.nombres[id] } }));

const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));
const kpiBox = (label, valor, _c, sub) =>
  React.createElement('div', null, ` ${label}: ${valor} (${sub}) `);
const C = new Proxy({}, { get: () => '#888' });
const NUM = (n, d) => (n || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const MXN = n => '$' + (n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
const js = esbuild.transformSync(`(${bloqueMO})`, { loader: 'jsx' }).code.trim().replace(/;$/, '');
const panel = renderToStaticMarkup(new Function(
  'React', 'kpiBox', 'C', 'NUM', 'MXN', 'heImporte',
  'obrasConKPIs', 'datosPorObra', 'activas',
  `"use strict"; return (${js})();`)(
  React, kpiBox, C, NUM, MXN, api.heImporte,
  obrasConKPIs, datosPorObra, OBRAS));
const txt = panel.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('\n   « ' + txt + ' »\n');

check(/Total trabajadores: 449 /.test(txt),
  'el consolidado son 449 trabajadores, no 350',
  txt.match(/Total trabajadores: (\d+)/)?.[1] || '?');
check(/Nómina semanal total: \$2,515,708 /.test(txt),
  'y $2,515,708 de nómina, no $2,013,104',
  txt.match(/Nómina semanal total: (\S+)/)?.[1] || '?');
check(/1 rayó su semana en varios archivos, sumados/.test(txt),
  'y el panel declara que una obra rayó su semana en varios archivos');

// El delta de personal del Panel: la semana anterior de cada obra. Con el
// criterio viejo, la «anterior» de la 0126 era la otra mitad de su propia
// semana 38 (99 personas), así que el portafolio parecía perder 71.
const suma = (f) => OBRAS.reduce((t, id) => t + f(datosPorObra[id].nominaSemanas), 0);
const act = suma(s => personal(s[s.length - 1]));
const ant = suma(s => (s.length >= 2 ? personal(s[s.length - 2]) : 0));
check(act === 449 && act - ant === -11,
  'el delta de personal es -11, no -71', `${act} − ${ant} = ${act - ant}`);

console.log(fallas === 0
  ? '\nTodas las comprobaciones en verde.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
