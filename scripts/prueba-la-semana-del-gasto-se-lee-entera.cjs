#!/usr/bin/env node
// LA CURVA DE GASTO ES UNA CURVA, NO UN PUNTO
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// «La curva de gastos sale plana, no puede ser: el gasto se va acumulando
// semana a semana.» Tenía razón, y la causa no era el dibujo.
//
// Las claves del Sheet son `S2025-49` —año y semana—. Se leían con
// `/S?(\d{1,2})/`, que de `S2025-49` saca **20**: los dos primeros dígitos
// del AÑO. Medido el 2026-11-25 contra producción: las 53 claves de la obra
// 0112 producían UN solo número de semana. La serie no era plana por falta de
// datos; era un punto, y el último punto lo sobrescribe el ancla del KPI, de
// ahí la raya con un salto al final.
//
// El año se perdía igual: todas las semanas se sellaban con el año en curso,
// así que lo de 2025 se dibujaba en 2026.
//
// ── Y LA SEGUNDA CUENTA ────────────────────────────────────────────────────
// El mismo regex estaba en `_serieGastoAcumulado`, la serie de la columna
// Δ margen, que además NO recibía maquinaria: el KPI sumaba GP + maquinaria +
// otros y esa serie sumaba GP + otros. Dos respuestas a «cuánto se gastó», y
// la de ahí siempre la más baja — o sea el margen siempre más optimista.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. Las piezas se EXTRAEN de `src/App.jsx` y se
// EJECUTAN contra la forma REAL del Sheet, leída de producción el 2026-11-25:
// ventana de semanas que cruza el año, totales por año completos, y el año
// anterior presente sólo con su cola.
//
// Uso:
//   node scripts/prueba-la-semana-del-gasto-se-lee-entera.cjs
//   node scripts/prueba-la-semana-del-gasto-se-lee-entera.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const ARCHIVO_APP = process.env.ARCHIVO_APP || path.join(raiz, 'src/App.jsx');
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'vuelve a decidir por posición y «S36-2026» se lee como año 36',
    de: `    const año = dos[1].length === 4 ? a : (dos[2].length === 4 ? b : null);`,
    a:  `    const año = a;` },
  { nombre: 'se pierde la forma «semana primero», que es la del sembrador',
    de: `    const sem = dos[1].length === 4 ? b : (dos[2].length === 4 ? a : null);`,
    a:  `    const sem = dos[2].length === 4 ? null : b;` },
  { nombre: 'el año se tira y las semanas de dos años caen en la misma clave',
    de: `  return { año, sem, key: claveSemanaISO(sem, año) };`,
    a:  `  return { año, sem, key: claveSemanaISO(sem, new Date().getFullYear()) };` },
  { nombre: 'el acumulado se arma sobre cero y pierde lo de antes de la ventana',
    de: `  let corrido = antesDeLaVentana;`,
    a:  `  let corrido = 0;` },
  { nombre: 'se vuelve a restar de golpe y los años cerrados se pierden',
    de: `    (t, y) => t + Math.max(0, porAño[y] - (ventanaPorAño[y] || 0)), 0);`,
    a:  `    (t, y) => t, totalAños - sumaVentana);` },
  { nombre: 'antes de la ventana se reparte el año propio en vez de decir «no se sabe»',
    de: `  return sinRepartir < 1 ? previos : null;`,
    a:  `  return previos;` },
  { nombre: 'se ignora lo que del año ya está en la ventana y el cero medido se vuelve hueco',
    de: `  const enVentana = (cuenta.ventanaPorAño || {})[añoK] || 0;`,
    a:  `  const enVentana = 0;` },
  { nombre: 'se tira lo de los años anteriores, que sí es afirmable',
    de: `    if (Number(y) < añoK) previos += v;`,
    a:  `    if (false) previos += v;` },
  // Anclaje alargado hasta la línea siguiente: las dos series suman la
  // maquinaria con las MISMAS dos líneas —que es la señal de que por fin son
  // la misma cuenta— así que el anclaje corto sale ambiguo. Se mutila sólo la
  // de Δ margen, que es la que la había perdido.
  { nombre: 'la serie de Δ margen vuelve a olvidar la maquinaria',
    de: `  (maquinaria || []).forEach(m => sumarManual(m.fecha || m.fechaCaptura,\n    parseFloat(m.imp) || 0));\n\n  const keysOrdenadas =`,
    a:  `  void maquinaria;\n\n  const keysOrdenadas =` },
  { nombre: 'una clave que no se entiende se cuela como semana en vez de descartarse',
    de: `    if (!(sem >= 1 && sem <= 53)) return null;\n    return { año, sem, key: claveSemanaISO(sem, año) };`,
    a:  `    return { año, sem, key: claveSemanaISO(sem, año) };` },
  // NO está la mutación de «12-34». Se midió: quitar esa guarda no cambia
  // nada, porque el rango del año la rechaza igual. Se quitó el renglón del
  // producto en vez de dejar una contraprueba que no muerde.
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCHIVO_APP, 'utf8'),
    { archivo: ARCHIVO_APP, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCHIVO_APP, 'utf8'),
    archivo: ARCHIVO_APP, extension: '.jsx' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

const { deArchivo } = require('./extraer-de-app.cjs');
let semanaDeClaveGP, acumuladoGPPorSemana, gpAcumuladoHasta, _serieGastoAcumulado;
try {
  ({ semanaDeClaveGP, acumuladoGPPorSemana, gpAcumuladoHasta, _serieGastoAcumulado } =
    deArchivo(ARCHIVO_APP, 'semanaDeClaveGP', 'acumuladoGPPorSemana',
              'gpAcumuladoHasta', '_serieGastoAcumulado'));
} catch (e) {
  noArranco([`no se pudieron extraer las piezas del gasto: ${e.message}`], 'src/App.jsx');
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const MXN = (n) => '$' + Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 });

// ── LA FORMA REAL, LEÍDA DE PRODUCCIÓN EL 2026-11-25 ───────────────────────
// Obra 0112: ventana de semanas que cruza el año; 2026 completo en la ventana
// (sus deltas suman exacto su total) y 2025 sólo con la cola (157,564 de
// 2,022,589). Las cifras son de la obra real, redondeadas a pesos.
const OBRA_GP = {
  años: { Y2025: 2022589, Y2026: 24343087 },
  semanas: {
    'S2025-49': 30000, 'S2025-50': 32000, 'S2025-51': 35564,
    'S2025-52': 30000, 'S2025-53': 30000,
    'S2026-14': 5000000, 'S2026-15': 6000000, 'S2026-16': 7000000,
    'S2026-17': 6343087,
  },
};
const TOTAL_AÑOS = 2022589 + 24343087;
const COLA_2025 = 30000 + 32000 + 35564 + 30000 + 30000;
const ANTES = TOTAL_AÑOS - (COLA_2025 + 24343087);

console.log('\n── LA SEMANA DEL GASTO SE LEE ENTERA ──\n');

console.log('§1 · la clave del Sheet se lee entera, año incluido');
const CLAVES = [
  ['S2025-49', 2025, 49, 'la forma real del Sheet'],
  ['S2026-01', 2026, 1,  'semana de un dígito'],
  ['S2026-53', 2026, 53, 'la semana 53, que existe'],
];
for (const [clave, año, sem, porque] of CLAVES) {
  const r = semanaDeClaveGP(clave);
  check(!!r && r.año === año && r.sem === sem, `«${clave}» → año ${año}, semana ${sem} — ${porque}`,
    r ? `año ${r.año}, semana ${r.sem}` : 'DEVOLVIÓ null');
}
check(semanaDeClaveGP('S2025-49')?.sem !== 20,
  'y NO saca 20, que es lo que daba el regex viejo leyendo los dígitos del año',
  `sem=${semanaDeClaveGP('S2025-49')?.sem}`);
// Con `?.`: si la pieza deja de reconocer la clave, esto tiene que salir ROJO
// —la conducta se rompió— y no matar el banco con una excepción, que sería un
// «no se pudo comprobar» disfrazado. Son dos veredictos distintos.
const k25 = semanaDeClaveGP('S2025-49')?.key;
const k26 = semanaDeClaveGP('S2026-49')?.key;
check(!!k25 && !!k26 && k25 !== k26,
  'dos años distintos no caen en la misma clave',
  `${k25 || 'null'} vs ${k26 || 'null'}`);

console.log('\n§2 · lo que no es una semana se descarta, no se adivina');
for (const mala of ['', null, undefined, 'S2026', 'Y2026', 'S2026-00', 'S2026-54', '12-34', 'basura'])
  check(semanaDeClaveGP(mala) === null, `«${String(mala)}» → null`,
    semanaDeClaveGP(mala) ? JSON.stringify(semanaDeClaveGP(mala)) : '');

// ── LAS OTRAS DOS FORMAS QUE EXISTEN ──────────────────────────────────────
// El Sheet de producción escribe `S2025-49` —año primero— y el sembrador del
// preview `S36-2026` —semana primero—. Se distinguen por el grupo de CUATRO
// dígitos, no por la posición: decidir por posición leería «S36-2026» como el
// año 36. Y la forma suelta `S47`, sin año, es lo que el código viejo suponía
// siempre: se acepta con el año en curso, que es lo único que hay para ella.
console.log('\n§2b · las otras dos formas que el repositorio escribe');
const conAño = (c) => semanaDeClaveGP(c, 2026);
check(conAño('S36-2026')?.sem === 36 && conAño('S36-2026')?.año === 2026,
  '«S36-2026» —semana primero— se lee como la semana 36 de 2026, no como el año 36',
  JSON.stringify(conAño('S36-2026')));
check(conAño('S47')?.sem === 47 && conAño('S47')?.año === 2026,
  '«S47» sin año cae en el año que se le pase, no en uno adivinado',
  JSON.stringify(conAño('S47')));
check(conAño('49')?.sem === 49, 'y «49» a secas también', JSON.stringify(conAño('49')));
check(conAño('S2025-49')?.año === 2025 && conAño('S36-2026')?.año === 2026,
  'las dos formas con año conviven sin confundirse',
  `${conAño('S2025-49')?.key} y ${conAño('S36-2026')?.key}`);

console.log('\n§3 · el acumulado crece semana a semana, que es lo que pedía la queja');
const cuenta = acumuladoGPPorSemana(OBRA_GP);
const valores = cuenta.claves.map(k => cuenta.acum[k]);
check(valores.length === 9, 'las nueve semanas de la ventana son nueve puntos, no uno',
  `${valores.length} punto(s)`);
check(new Set(valores).size === valores.length,
  'y ningún par de semanas comparte valor: la línea no es plana',
  `${new Set(valores).size} valores distintos`);
check(valores.every((v, i) => i === 0 || v > valores[i - 1]),
  'cada semana es mayor que la anterior: el gasto se acumula, no sube y baja',
  valores.map(v => MXN(v)).join(' → ').slice(0, 90) + '…');

console.log('\n§4 · y cuadra con lo que publica el KPI');
check(Math.abs(valores[valores.length - 1] - TOTAL_AÑOS) < 1,
  'la última semana es EXACTAMENTE el total de los años, que es el número del KPI',
  `${MXN(valores[valores.length - 1])} vs ${MXN(TOTAL_AÑOS)}`);
check(Math.abs(cuenta.antesDeLaVentana - ANTES) < 1,
  'y lo de antes de la ventana se deduce, no se adivina',
  `${MXN(cuenta.antesDeLaVentana)} (2025 completo menos su cola)`);
check(Math.abs(valores[0] - (ANTES + 30000)) < 1,
  'la primera semana de la ventana ya trae lo que se gastó antes de ella',
  `${MXN(valores[0])}`);

console.log('\n§5 · antes de la ventana no se inventa un número');
check(gpAcumuladoHasta(cuenta, '2025-W40') === null,
  'una semana DE SU PROPIO año sin repartir → null: ese total no se trocea',
  String(gpAcumuladoHasta(cuenta, '2025-W40')));
// Pero lo de los años ANTERIORES sí se sabe: ocurrió todo antes de esa semana.
// Devolver `null` también aquí —mi primer intento— deja la curva sin enero ni
// febrero todos los años, que es cuando la ventana aún no alcanza al año nuevo.
//
// El caso necesita una obra cuya VENTANA empiece después de la semana que se
// pregunta; con la de arriba no sirve —sus claves de 2025 ya son anteriores a
// cualquier semana de 2026— y la aserción pasaría por el otro camino sin
// tocar este renglón. Se midió: con el fixture de arriba, romper el renglón
// no cambiaba nada.
const conAñoCerrado = acumuladoGPPorSemana({
  años: { Y2024: 500000, Y2026: 100 },
  semanas: { 'S2026-10': 100 },
});
check(gpAcumuladoHasta(conAñoCerrado, '2025-W30') === 500000,
  'una semana de 2025, con 2024 cerrado y la ventana en 2026, vale los 500,000 de 2024',
  String(gpAcumuladoHasta(conAñoCerrado, '2025-W30')));
const sinNada = acumuladoGPPorSemana({ años: { Y2026: 100 }, semanas: { 'S2026-10': 100 } });
check(gpAcumuladoHasta(sinNada, '2026-W05') === 0,
  'pero si no quedó nada fuera de la ventana, el cero SÍ está medido',
  String(gpAcumuladoHasta(sinNada, '2026-W05')));
check(gpAcumuladoHasta(cuenta, '2026-W52') === TOTAL_AÑOS,
  'y después de la última semana se queda en el total, no vuelve a cero',
  MXN(gpAcumuladoHasta(cuenta, '2026-W52')));

// El caso que rompió tres bancos: `años` vacío con `semanas` llena. Pasa en
// cargas parciales. Sin tope en cero los acumulados arrancaban negativos, y
// un gasto negativo en la curva es una cifra inventada con signo.
console.log('\n§5b · con `años` vacío no se inventan números rojos');
const sinAños = acumuladoGPPorSemana({ semanas: { 'S2026-10': 400, 'S2026-11': 600 } });
// Y el caso inverso, que es el de la hoja de febrero: `años` trae SÓLO los
// años cerrados y la ventana detalla el año en curso. Restar de golpe daba
// negativo —se topaba a cero— y la curva perdía los años cerrados enteros.
const soloCerrados = acumuladoGPPorSemana({
  años: { Y2025: 9000000 },
  semanas: { 'S2026-03': 1500000, 'S2026-04': 1500000 },
});
check(soloCerrados.antesDeLaVentana === 9000000,
  'con `años` sólo de años cerrados, lo anterior a la ventana son esos 9,000,000',
  String(soloCerrados.antesDeLaVentana));
check(soloCerrados.acum['2026-W03'] === 10500000,
  'y la primera semana de la ventana ya los lleva encima',
  String(soloCerrados.acum['2026-W03']));
const vals = sinAños.claves.map(k => sinAños.acum[k]);
check(vals.every(v => v >= 0), 'ningún acumulado sale negativo', JSON.stringify(vals));
check(vals[vals.length - 1] === 1000,
  'y el último es la suma de lo que sí se detalla', String(vals[vals.length - 1]));

console.log('\n§6 · una cuenta por número: la serie de Δ margen suma los MISMOS tres sumandos');
const gpData = { obras: { '0112': { id: '0112', nombre: '0112 OBRA', ...OBRA_GP } } };
const obra = { id: '0112', nombre: '0112 OBRA', gpId: '0112' };
const OTROS = [{ fecha: '2026-04-20', importe: 11000 }];
const MAQ   = [{ fecha: '2026-04-20', imp: 7000 }];
const conMaq = _serieGastoAcumulado(obra, gpData, OTROS, MAQ);
const sinMaq = _serieGastoAcumulado(obra, gpData, OTROS, []);
const ultimo = (r) => r.gastoAcum[r.keysOrdenadas[r.keysOrdenadas.length - 1]];
check(Math.abs(ultimo(conMaq) - (TOTAL_AÑOS + 11000 + 7000)) < 1,
  'el acumulado final es GP + otros + maquinaria, el mismo total que el KPI',
  `${MXN(ultimo(conMaq))} vs ${MXN(TOTAL_AÑOS + 11000 + 7000)}`);
check(Math.abs(ultimo(conMaq) - ultimo(sinMaq) - 7000) < 1,
  'y quitar la maquinaria cambia el número: no es un parámetro decorativo',
  `diferencia ${MXN(ultimo(conMaq) - ultimo(sinMaq))}`);
const serieMargen = conMaq.keysOrdenadas.map(k => conMaq.gastoAcum[k]).filter(v => v !== null);
check(new Set(serieMargen).size > 1,
  'esta serie tampoco es plana',
  `${new Set(serieMargen).size} valores distintos en ${serieMargen.length} semanas`);

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'el gasto se acumula semana a semana y las dos series dicen el mismo total.'
  : 'la curva de gasto vuelve a ser un punto, o dos pantallas dicen gastos distintos.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
