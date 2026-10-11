#!/usr/bin/env node
// Dos pantallas, un número: ¿es la misma cuenta o dos que coinciden?
//
// QUÉ SE AFIRMA. Que «días sin captura» y «días de atraso proyectado» salen de
// UNA cuenta, no de varias que hoy dan lo mismo. Son los dos números con los
// que se decide a qué obra ir, y los dos salían escritos en varios lugares:
//
//   días sin captura   · la excepción del panel de constructora («0127 — 9
//                        días sin captura de avance»)
//                      · la columna «captura» de la tabla de ese mismo panel
//                      · el texto «hace 9 días» de esa misma fila
//                      · la columna «última captura» del portafolio de
//                        dependencia
//                      · el Kpi del tablero de la obra
//   atraso proyectado  · la tabla del portafolio
//                      · el Kpi «Contra el plazo» del tablero de dependencia
//                      · el mini-tablero de avance
//                      · la regla de riesgo que avisa «terminará muy tarde»
//
// Y NO eran la misma expresión. Las de días leían unas sólo `fechaCaptura` y
// otras preferían `fechaCierre`, así que daban el mismo número por una
// coincidencia de cómo se escribe un cierre: `fechaCaptura` y `fechaCierre`
// salen del MISMO `ahora.toISOString()`, y `fechaCierre` queda en null en los
// intermedios. Las de atraso repetían el ARMADO —`estadoPorSemana` más una
// obra con el plazo vigente—, y ahí la parte que se equivoca sola es la
// precedencia: `info` manda sobre `o` porque el fin ampliado vive en el
// documento de contrato, y la copia que lo invierta mide contra el plazo
// firmado y declara a tiempo una obra que no lo está.
//
// CÓMO SE MIDE, y es lo único que hace que esto valga. No se compara el
// resultado de dos pantallas contra un número que yo escriba: eso pasaría
// igual con dos cuentas gemelas, que es exactamente el estado que se quiere
// prohibir. Se hace al revés —la contraprueba es el método, no un paso
// posterior—:
//
//   1. Se saca por AST la expresión REAL de cada pantalla.
//   2. Se ejecuta con la función de verdad inyectada.
//   3. Se vuelve a ejecutar con la función MUTADA.
//   4. Se exige que TODAS se hayan movido.
//
// Una pantalla que no se mueva con la mutación no está llamando a la cuenta
// única: trae su propia copia. Eso es rojo aquí aunque el número de hoy sea
// correcto, porque dos cuentas que dan lo mismo no son una cuenta: son una que
// todavía no se rompió.
//
// Uso:  node scripts/prueba-una-cuenta-por-numero.cjs [App.jsx]
//
// CONTRAPRUEBA, comprobada, y la forma importa. No vale contra `main`: ahí las
// cuentas únicas todavía no existen y la salida correcta es 2 —NO ARRANCÓ—, que
// no demuestra nada sobre las aserciones. Lo que se hizo fue devolverle a UNA
// sola pantalla su copia, sobre este mismo archivo:
//
//   · la fila del portafolio vuelve a su resta en línea  → 2 en rojo, salida 1
//   · la fila del portafolio vuelve a armar `{...o,...info}` por su cuenta
//     y a llamar a `proyeccionDeAvance` directo             → 1 en rojo, salida 1
//
// Y el dato que justifica todo el método: con la copia puesta, la sección 1
// —«las cuatro pantallas dicen el mismo número»— SIGUE EN VERDE. La copia da 7
// días igual que la cuenta única. Una prueba de valores habría firmado eso como
// bueno. La que se mueve es la sección 2.

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

// ── Las cuentas de verdad, extraídas del módulo ────────────────────────────
//
// Se extraen con sus dependencias porque la prueba las EJECUTA: una copia mía
// de `proyeccionDeAvance` se comprobaría contra sí misma (P3).
const DE_MODULO = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'montoEstimadoSnap', 'montoPagadoSnap',
  'semanaISO', 'snapshotId', 'fechaLocalDeISO', 'hoyLocalISO', 'lunesDeClaveSemana',
  'finVigenteDe', 'estadoPorSemana', 'proyeccionDeAvance',
  'frasePorQueSinDesviacion', 'kpiDesviacionPlazo',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'SIN_PROY_POCOS_CIERRES', 'SIN_PROY_NO_COMPARABLES', 'SIN_PROY_SIN_AVANCE',
  'fechaUltimaCapturaDe', 'diasSinCapturaDe', 'atrasoProyectado',
];
// Sin éstas no hay nada que medir: son las cuentas únicas cuya existencia da
// sentido a la pregunta. Que falten es renombre, no regresión.
const IMPRESCINDIBLES = ['diasSinCapturaDe', 'atrasoProyectado',
  'estadoPorSemana', 'proyeccionDeAvance'];

const trozos = [];
const hallados = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && DE_MODULO.includes(d.id.name)) {
      trozos.push(texto(p.node)); hallados.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && DE_MODULO.includes(n)) {
      trozos.push(texto(p.node)); hallados.add(n);
    }
  },
});
const faltan = IMPRESCINDIBLES.filter(n => !hallados.has(n));
if (faltan.length) noArranco(faltan, path.relative(raiz, archivo));

// `C` es la paleta. Entra como proxy porque lo que se mide aquí son números y
// frases, no colores: un `C.red` que falte reventaría la extracción y saldría
// NO ARRANCÓ culpando al archivo medido en vez de a este andamiaje.
const mod = new Function('C',
  `${trozos.join('\n')}\n;return {${[...hallados].join(',')}};`)(
  new Proxy({}, { get: () => '#000' }));

// ── Las expresiones de cada pantalla ───────────────────────────────────────
//
// Dueño y nombre, porque en 23 000 renglones hay más de un `diasSinCaptura` y
// resolver por nombre a ciegas agarraría el de otra pantalla. Lo que se guarda
// es el TEXTO del inicializador: lo que la pantalla realmente evalúa.
const QUIERO = [
  // número                       dueño                      nombre
  ['dias sin captura', 'excepción del panel',   'DashboardPrincipal',    'dias'],
  ['dias sin captura', 'fila del panel',        'DashboardPrincipal',    'diasCap'],
  ['dias sin captura', 'fila del portafolio',   'PortafolioDependencia', 'diasSinCaptura'],
  ['dias sin captura', 'tablero de la obra',    'DashboardDependencia',  'diasSinCaptura'],
  ['fecha de captura', 'tablero de la obra',    'DashboardDependencia',  'fechaUltima'],
  ['atraso',           'fila del portafolio',   'PortafolioDependencia', 'proy'],
  ['atraso',           'tablero de la obra',    'DashboardDependencia',  'desvPlazo'],
  ['atraso',           'mini-tablero',          'MiniDashAvance',        'proy'],
];
const DUEÑOS = [...new Set(QUIERO.map(q => q[2]))];
const expr = {};
// Los `const` de cada pantalla, para poder resolver lo que su expresión
// mencione. Hace falta para que una COPIA se pueda ejecutar: una expresión
// metida a mano habla de sus propias variables locales (`ultAv`), y si el banco
// no supiera resolverlas saldría NO ARRANCÓ culpando al andamiaje justo cuando
// acaba de aparecer el defecto que busca. Una copia tiene que correr para poder
// demostrar que es una copia.
const locales = {};
traverse(ast, {
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (!n || !p.node.init) return;
    const dueño = p.findParent(q => q.isFunctionDeclaration())?.node?.id?.name;
    if (!dueño || !DUEÑOS.includes(dueño)) return;
    (locales[dueño] ||= new Map());
    if (!locales[dueño].has(n)) locales[dueño].set(n, p.node.init);
    for (const [, , d, nom] of QUIERO) {
      if (d !== dueño || nom !== n) continue;
      expr[`${d}.${n}`] ||= texto(p.node.init);
    }
  },
});
const sinExpr = QUIERO.filter(([, , d, n]) => !expr[`${d}.${n}`]);
if (sinExpr.length)
  sinPrecondicion(
    `no encontré la cuenta de ${sinExpr.map(([q, s]) => `${q} en la ${s}`).join(', ')}`,
    ['La pantalla cambió de forma: o el `const` se llama de otro modo, o el',
     'número ya no se calcula en un `const` de primer nivel. Lo que esta',
     'prueba mediría es una pantalla que ya no existe, así que no mide nada.',
     'Hay que apuntar la extracción al lugar nuevo antes de creerle al verde.']);

// ── Ejecutar una expresión con lo que pida, y nada más ─────────────────────
//
// Las entradas se dan explícitas. Si una expresión pide algo que no está en la
// lista, NO es rojo: es que la cuenta dejó de poder aislarse y medirla aquí
// daría un número salido de un sandbox incompleto, que es peor que no medirla.
const GLOBALES = new Set(['Array', 'Object', 'Math', 'JSON', 'Date', 'Number',
  'String', 'Boolean', 'Set', 'Map', 'isNaN', 'parseFloat', 'parseInt',
  'undefined', 'NaN', 'Infinity']);

const atados = (n, dentro) => {
  const anotar = pat => {
    if (!pat) return;
    if (pat.type === 'Identifier') dentro.add(pat.name);
    else if (pat.type === 'ObjectPattern') pat.properties.forEach(q => anotar(q.value || q.argument));
    else if (pat.type === 'ArrayPattern') pat.elements.forEach(anotar);
    else if (pat.type === 'AssignmentPattern') anotar(pat.left);
    else if (pat.type === 'RestElement') anotar(pat.argument);
  };
  if (Array.isArray(n.params)) n.params.forEach(anotar);
  if (n.type === 'VariableDeclarator') anotar(n.id);
  if (n.type === 'CatchClause') anotar(n.param);
};

// Los nombres que una expresión toma de FUERA. Los que ella misma ata —la `o`
// de un `filter(o => …)`— no cuentan: pedirlos sería inventar una carencia.
const deFuera = raizNodo => {
  const fuera = new Set();
  const visitar = (n, padre, ligados) => {
    if (!n || typeof n.type !== 'string') return;
    const propios = new Set(ligados);
    atados(n, propios);
    if (n.type === 'Identifier') {
      const esMiembro = padre && (padre.type === 'MemberExpression' ||
                                  padre.type === 'OptionalMemberExpression');
      if (esMiembro && padre.property === n && !padre.computed) return;
      if (padre && padre.type === 'ObjectProperty' && padre.key === n && !padre.computed) return;
      if (!ligados.has(n.name)) fuera.add(n.name);
      return;
    }
    for (const k of Object.keys(n)) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(c => c && typeof c.type === 'string' && visitar(c, n, propios));
      else if (v && typeof v.type === 'string') visitar(v, n, propios);
    }
  };
  visitar(raizNodo, null, new Set());
  return fuera;
};

const corre = (dueño, nombre, entorno, etiqueta) => {
  const t = expr[`${dueño}.${nombre}`];
  const mios = locales[dueño] || new Map();
  // Cadena de dependencias: lo que la expresión menciona y no está en el
  // entorno se busca entre los `const` de SU pantalla, y así sucesivamente.
  const prelud = [];
  const vistos = new Set([nombre]);
  const pendientes = [parse(`(${t})`).program.body[0].expression];
  const faltantes = new Set();
  while (pendientes.length) {
    for (const n of deFuera(pendientes.pop())) {
      if (GLOBALES.has(n) || n in entorno || vistos.has(n)) continue;
      vistos.add(n);
      if (!mios.has(n)) { faltantes.add(n); continue; }
      prelud.push(n);
      pendientes.push(mios.get(n));
    }
  }
  if (faltantes.size)
    sinPrecondicion(
      `la cuenta de ${etiqueta} ya necesita \`${[...faltantes].join('`, `')}\`, que esta prueba no sabe fabricar`,
      ['La expresión dejó de depender sólo del historial y de la obra, y lo que',
       'pide no es un `const` de su propia pantalla. Lo que saldría de este',
       'sandbox no es el número de la pantalla. Hay que llevar la comprobación',
       'al preview, o darle el insumo que pide.']);
  // Por posición en el archivo: un `const` no puede usar a otro posterior.
  const orden = [...new Set(prelud)].sort((a, b) => mios.get(a).start - mios.get(b).start);
  const cuerpo = orden.map(n => `  const ${n} = ${texto(mios.get(n))};`).join('\n');
  const nombres = Object.keys(entorno);
  return new Function(...nombres,
    `"use strict";\n${cuerpo}\n  return (${t});`)(...nombres.map(n => entorno[n]));
};

// ── Datos ──────────────────────────────────────────────────────────────────
const AHORA = new Date(2026, 8, 21, 12, 0).getTime();   // lunes 21-sep-2026
const cierre = (semana, avance, fecha) => ({
  id: mod.snapshotId ? mod.snapshotId(semana, 2026) : `S${semana}-2026`,
  semana, año: 2026, tipo: 'oficial', esquema: 3,
  avancePonderado: avance, montoEjecutado: avance * 10000,
  fechaCaptura: fecha, fechaCierre: fecha,
  capturadoPor: 'residente@fosmon.mx',
});
// Dos cierres separados y una captura vieja: hay velocidad medible y hay días
// sin captura que contar. Un fixture sin una de las dos cosas dejaría la mitad
// de las aserciones devolviendo `null`, y `null === null` pasa sola.
const HISTORIAL = [
  cierre(35, 18, '2026-08-31T18:00:00.000Z'),
  cierre(37, 24, '2026-09-14T18:00:00.000Z'),
];
const OBRA = { id: '0127', nombre: 'Obra 0127', estado: 'activa',
  presupuesto: 38500000, inicio: '2026-04-01', fin: '2026-11-30' };
// El documento de contrato trae el plazo AMPLIADO. Es la diferencia que hace
// que la precedencia importe.
const INFO = { presupuesto: 38500000, fin: '2026-11-30', finAmpliado: '2027-03-31' };

// Cómo se le arma el entorno a cada expresión. `diasSinCapturaDe`,
// `fechaUltimaCapturaDe` y `atrasoProyectado` entran como INYECCIÓN: ahí está
// todo el método de esta prueba.
const entornoDe = (inyecta) => ({
  DashboardPrincipal: {
    ...inyecta, avSemanas: HISTORIAL, HOY: AHORA,
  },
  PortafolioDependencia: {
    ...inyecta, avSemanas: HISTORIAL, HOY: AHORA,
    o: OBRA, info: INFO, af: 24,
  },
  DashboardDependencia: {
    ...inyecta, historialAvance: HISTORIAL, obra: { ...OBRA, ...INFO },
    avance: 24, estadosSemana: mod.estadoPorSemana(HISTORIAL),
  },
  MiniDashAvance: {
    ...inyecta, historialAvance: HISTORIAL, obra: { ...OBRA, ...INFO },
    avanceActual: 24, estados: mod.estadoPorSemana(HISTORIAL),
  },
});

const REALES = {
  diasSinCapturaDe: mod.diasSinCapturaDe,
  fechaUltimaCapturaDe: mod.fechaUltimaCapturaDe,
  atrasoProyectado: mod.atrasoProyectado,
  proyeccionDeAvance: mod.proyeccionDeAvance,
  estadoPorSemana: mod.estadoPorSemana,
  kpiDesviacionPlazo: mod.kpiDesviacionPlazo,
  finVigenteDe: mod.finVigenteDe,
  frasePorQueSinDesviacion: mod.frasePorQueSinDesviacion,
};

// El reloj se fija mientras se lee, y no es un detalle del andamiaje.
//
// Tres de las ocho expresiones NO le pasan la hora a la cuenta: la dejan en su
// valor por omisión, que es `Date.now()`. En producción eso está bien —todas
// preguntan «¿ahora?» en el mismo render— pero aquí hacía que el panel contara
// contra el `HOY` del fixture y el tablero contra la hora real de la máquina:
// 7 días contra 26, una diferencia que es del reloj y no del código. Medido así
// la prueba habría salido roja todos los días por una razón falsa, y el
// defecto que busca —dos cuentas distintas— se habría quedado escondido detrás.
const leer = (inyecta) => {
  const ent = entornoDe(inyecta);
  const reloj = Date.now;
  Date.now = () => AHORA;
  try {
    const out = {};
    for (const [num, sitio, dueño, nombre] of QUIERO)
      out[`${dueño}.${nombre}`] = { num, sitio, dueño, nombre,
        valor: corre(dueño, nombre, ent[dueño], `${num} en la ${sitio}`) };
    return out;
  } finally { Date.now = reloj; }
};

console.log(`\nArchivo: ${path.relative(raiz, archivo)}`);
console.log('Las expresiones que se van a ejecutar:');
for (const [num, sitio, d, n] of QUIERO)
  console.log(`  ${(num + ' · ' + sitio).padEnd(38)} ${expr[`${d}.${n}`].replace(/\s+/g, ' ').slice(0, 72)}`);

// ════════════════════════════════════════════════════════════════════════════
// 1) Los números de hoy, y que el fixture no sea degenerado
// ════════════════════════════════════════════════════════════════════════════
seccion('Lo que dice cada pantalla hoy');
const base = leer(REALES);
const DIAS = QUIERO.filter(([n]) => n === 'dias sin captura')
  .map(([, , d, nom]) => `${d}.${nom}`);
const ATRASO = QUIERO.filter(([n]) => n === 'atraso')
  .map(([, , d, nom]) => `${d}.${nom}`);

{
  const valores = DIAS.map(k => base[k].valor);
  check(valores.every(v => v === valores[0]),
    'las cuatro pantallas dicen el mismo número de días sin captura',
    valores.join(' · '));
  check(typeof valores[0] === 'number' && valores[0] > 0,
    'y es un número de días de verdad, no `null` — si fuera null todas',
    `${valores[0]} días`);

  const dias = mod.diasSinCapturaDe(HISTORIAL, AHORA);
  check(valores[0] === dias,
    'ese número es el que devuelve la cuenta única', `${dias}`);

  const desv = ATRASO.map(k => {
    const v = base[k].valor;
    return v && typeof v === 'object' && 'desviacionDias' in v
      ? v.desviacionDias : (v && v.dias !== undefined ? v.dias : v);
  });
  check(desv.every(v => v === desv[0]),
    'las tres pantallas dicen el mismo atraso proyectado',
    desv.map(v => (v === null ? 'null' : v)).join(' · '));
  check(typeof desv[0] === 'number',
    'y hay atraso medible que comparar, no un `—` en todas',
    desv[0] === null ? 'null (el fixture no sirve)' : `${desv[0]} días`);
}

// ════════════════════════════════════════════════════════════════════════════
// 2) LA CONTRAPRUEBA SEMÁNTICA: se muta la cuenta y se exige que TODAS se muevan
// ════════════════════════════════════════════════════════════════════════════
//
// Esto no mide el valor, mide de DÓNDE sale. Si una pantalla no se mueve con
// la cuenta mutada es porque no la está llamando: trae su propia copia, y hoy
// coincide de casualidad.
seccion('Si se mueve la cuenta, se mueven todas');
{
  const DESPLAZO = 1000;
  const mutado = leer({
    ...REALES,
    diasSinCapturaDe: (h, ahora) => mod.diasSinCapturaDe(h, ahora) + DESPLAZO,
  });
  const quietas = DIAS.filter(k =>
    mutado[k].valor !== base[k].valor + DESPLAZO);
  check(quietas.length === 0,
    `las ${DIAS.length} cuentas de días sin captura se mueven con la función extraída`,
    quietas.length
      ? quietas.map(k => `${base[k].sitio} se quedó en ${mutado[k].valor}`).join(' · ')
      : DIAS.map(k => mutado[k].valor).join(' · '));

  // El panel Y la lista, nombrados aparte: es la pareja que el encargo pedía
  // ver moverse junta, y la que más duele que discrepe porque se leen seguidas.
  const panel = mutado['DashboardPrincipal.diasCap'].valor;
  const lista = mutado['PortafolioDependencia.diasSinCaptura'].valor;
  const tablero = mutado['DashboardDependencia.diasSinCaptura'].valor;
  check(panel === lista && lista === tablero,
    'el panel, la lista y el tablero de la obra se mueven JUNTOS',
    `panel ${panel} · lista ${lista} · tablero ${tablero}`);

  // Y el texto de la fila con la columna que ordena esa misma fila: eran dos
  // expresiones idénticas escritas por separado, lo peor de los dos mundos.
  check(mutado['DashboardPrincipal.dias'].valor === panel,
    'la excepción del panel y la columna de su propia tabla, también',
    `excepción ${mutado['DashboardPrincipal.dias'].valor} · columna ${panel}`);
}

{
  // La mutación del atraso es SEMÁNTICA, no un desplazamiento: se devuelve una
  // proyección con una razón distinta. Un `+1000` en los días pasaría igual
  // con un `proyeccionDeAvance` copiado; cambiar lo que la cuenta AFIRMA no.
  const RAZON = 'MUTADA_POR_LA_PRUEBA';
  const mutado = leer({
    ...REALES,
    atrasoProyectado: (obra, info, h, av, ahora) => ({
      ...mod.atrasoProyectado(obra, info, h, av, ahora),
      desviacionDias: 777, razon: null,
    }),
    proyeccionDeAvance: () => ({ velocidad: null, fechaFin: null, finVigente: null,
      ampliado: false, desviacionDias: null, razon: RAZON }),
  });
  // Las que llaman a `atrasoProyectado` ven 777. Una que llamara a
  // `proyeccionDeAvance` por su cuenta vería la razón inventada y un `—`.
  const porSuCuenta = ATRASO.filter(k => {
    const v = mutado[k].valor;
    const d = v && typeof v === 'object'
      ? ('desviacionDias' in v ? v.desviacionDias : v.dias) : v;
    return d !== 777;
  });
  check(porSuCuenta.length === 0,
    `las ${ATRASO.length} pantallas de atraso pasan por el armado único`,
    porSuCuenta.length
      ? porSuCuenta.map(k => `${base[k].dueño} armó la suya`).join(' · ')
      : 'portafolio · tablero · mini-tablero');
}

{
  // La fecha que se enseña debajo del número y el número tienen que salir de
  // la misma elección de fecha. Si no, el recuadro dice «hace 9 días» sobre
  // una fecha que no es la que contó.
  const mutado = leer({
    ...REALES,
    fechaUltimaCapturaDe: () => '2001-01-01T00:00:00.000Z',
  });
  check(mutado['DashboardDependencia.fechaUltima'].valor === '2001-01-01T00:00:00.000Z',
    'la fecha que se enseña sale de la cuenta que elige la fecha',
    String(mutado['DashboardDependencia.fechaUltima'].valor));
  check(base['DashboardDependencia.fechaUltima'].valor
        === mod.fechaUltimaCapturaDe(HISTORIAL),
    'y es la misma fecha desde la que se contaron los días',
    String(base['DashboardDependencia.fechaUltima'].valor));
}

// ════════════════════════════════════════════════════════════════════════════
// 3) La conducta que la cuenta única tiene que tener
// ════════════════════════════════════════════════════════════════════════════
//
// La unificación no sirve de nada si lo unificado miente. Estas son las tres
// cosas que la cuenta vieja hacía mal en alguna de sus copias.
seccion('Qué contesta la cuenta única');
{
  check(mod.diasSinCapturaDe([], AHORA) === null,
    'sin historial no hay 0 días, hay `null`: un cero diría «capturaron hoy»',
    String(mod.diasSinCapturaDe([], AHORA)));

  // La forma que devuelve `estadoPorSemana`: trae `fechaCierre` y NO
  // `fechaCaptura`. Con la expresión vieja del panel esto era `null` —«sin
  // captura»— de una obra que el tablero reportaba al día.
  const soloCierre = [{ semana: 37, año: 2026, tipo: 'oficial',
    fechaCierre: '2026-09-14T18:00:00.000Z', avancePonderado: 24 }];
  check(mod.diasSinCapturaDe(soloCierre, AHORA) !== null,
    'un registro con `fechaCierre` y sin `fechaCaptura` sí se puede contar',
    `${mod.diasSinCapturaDe(soloCierre, AHORA)} días`);

  // Y al revés: cuando están las dos, manda la captura, porque el número se
  // llama «días sin CAPTURA».
  const ambas = [{ semana: 37, año: 2026, tipo: 'oficial',
    fechaCaptura: '2026-09-14T18:00:00.000Z',
    fechaCierre: '2026-09-20T18:00:00.000Z', avancePonderado: 24 }];
  check(mod.diasSinCapturaDe(ambas, AHORA) === mod.diasSinCapturaDe(
    [{ ...ambas[0], fechaCierre: null }], AHORA),
    'con las dos fechas manda `fechaCaptura`, que es la que fecha el evento',
    `${mod.diasSinCapturaDe(ambas, AHORA)} días`);

  check(mod.diasSinCapturaDe([{ fechaCaptura: 'no soy una fecha' }], AHORA) === null,
    'una fecha ilegible devuelve `null`, no `NaN` días',
    String(mod.diasSinCapturaDe([{ fechaCaptura: 'no soy una fecha' }], AHORA)));

  // La precedencia, que es toda la razón de ser de `atrasoProyectado`: el
  // plazo contra el que se mide sale del documento de contrato.
  const conInfo = mod.atrasoProyectado(OBRA, INFO, HISTORIAL, 24, AHORA);
  const sinInfo = mod.atrasoProyectado(OBRA, null, HISTORIAL, 24, AHORA);
  check(conInfo.finVigente === INFO.finAmpliado,
    'el atraso se mide contra el fin AMPLIADO cuando el contrato lo trae',
    `${conInfo.finVigente}`);
  check(conInfo.ampliado === true && sinInfo.ampliado === false,
    'y la pantalla puede decir contra cuál de los dos plazos midió',
    `con contrato: ${conInfo.finVigente} · sin él: ${sinInfo.finVigente}`);
  check(conInfo.desviacionDias !== sinInfo.desviacionDias,
    'invertir esa precedencia CAMBIA el número, no es un detalle de estilo',
    `${conInfo.desviacionDias} vs ${sinInfo.desviacionDias} días`);
}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas > 0) {
  console.log('');
  console.log('Si esto está rojo hay dos cuentas del mismo número. Puede que hoy den');
  console.log('lo mismo; el día que una cambie, el panel y la lista van a decir cosas');
  console.log('distintas de la misma obra y no habrá forma de saber cuál tiene razón.');
}
process.exit(fallas > 0 ? 1 : 0);
