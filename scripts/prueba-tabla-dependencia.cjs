#!/usr/bin/env node
// La tabla ordenable del tablero de la dependencia: diez columnas, y ninguna
// celda que calle.
//
// POR QUÉ ESTA PRUEBA. La tabla responde una pregunta comparativa —cuál de mis
// obras va peor— y la responde ORDENANDO. Un orden que miente es peor que no
// tener orden: pone arriba la obra equivocada y el director deja de mirar la
// que sí importa. Tres maneras concretas de mentir, y las tres se miden aquí:
//
//   1. Decir «0 días de atraso» cuando lo que pasó es que la cuenta no salió.
//      Cero es una AFIRMACIÓN —la obra va en tiempo— y no se puede hacer
//      cuando falta el plazo, faltan los cierres o los cierres no se pueden
//      restar entre sí. Lo mismo un guion mudo, que se lee «no aplica».
//   2. Mandar al fondo, revueltas con las que van bien, las obras que NO se
//      pudieron medir. Ahí es donde se esconden.
//   3. Separar «Áridos y Asfaltos» de «Aridos y Asfaltos» porque una trae
//      acento. El contratista es texto libre hasta que haya padrón (#41); la
//      clave normalizada es lo único que mantiene junta a la misma empresa.
//
// Y una cuarta, que es la que ya estaba escrita en producción: la frase que
// explica por qué no hay número vivía copiada dentro del KPI de la obra, con
// un caso de menos. Una obra con cierres de sobra pero SIN PLAZO CAPTURADO
// recibía «requiere 2 cierres» —falso— y mandaba a buscar el problema donde
// no estaba. Por eso aquí se afirma además que esa frase se dice en UN SOLO
// lugar del archivo: escrita dos veces, arreglar una deja mintiendo a la otra.
//
// Lo que se afirma es CONDUCTA: qué frase sale, en qué orden quedan las filas,
// qué encabezados se ven. No se afirma que exista ningún nombre (P3). El
// comparador y la lista de columnas se extraen por AST de src/App.jsx y se
// EJECUTAN: se prueba el código de la pantalla, no una copia mía.
//
// Uso:  node scripts/prueba-tabla-dependencia.cjs [App.jsx]
//
// Contraprueba — contra la versión anterior tiene que ponerse ROJA:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-tabla-dependencia.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m, detalle) => {
  const d = detalle === undefined ? '' : `  ·  ${detalle}`;
  if (cond) console.log(`   ✓ ${m}${d}`);
  else { fallos.push(m); console.log(`   ✗ ${m}${d}`); }
};

// ── Extracción del código real ─────────────────────────────────────────────
// De módulo: la cuenta de la proyección y la frase que la explica.
// Anidados en el componente: el comparador que ordena la tabla y la lista de
// columnas. Viven dentro de `PortafolioDependencia` y no se pueden sacar de
// otra forma sin reimplementarlos, y reimplementarlos sería probar mi copia.
const RAIZ_NOMBRES = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'semanaISO', 'snapshotId',
  'fechaLocalDeISO', 'hoyLocalISO', 'lunesDeClaveSemana',
  'finVigenteDe', 'estadoPorSemana', 'proyeccionDeAvance',
  'frasePorQueSinDesviacion',
  'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'SIN_PROY_POCOS_CIERRES', 'SIN_PROY_NO_COMPARABLES', 'SIN_PROY_SIN_AVANCE',
];
const ANIDADOS = [
  'PortafolioDependencia.COLUMNAS',
  'PortafolioDependencia.signo',
  'PortafolioDependencia.texto',
  'PortafolioDependencia.ordenadas',
  'PortafolioDependencia.clicEnCabecera',
  'PortafolioDependencia._ne',
  'PortafolioDependencia.clave',
  'PortafolioDependencia.celdaDe',
];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();
const anidados = {};
let jsxPortafolio = '';
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && RAIZ_NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && RAIZ_NOMBRES.includes(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
    if (n === 'PortafolioDependencia') jsxPortafolio = src.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (!n || !p.node.init) return;
    const dueño = p.getFunctionParent()?.node?.id?.name
      || p.findParent(q => q.isFunctionDeclaration())?.node?.id?.name;
    const clave = `${dueño}.${n}`;
    if (!ANIDADOS.includes(clave)) return;
    if (anidados[clave] === undefined) anidados[clave] = src.slice(p.node.init.start, p.node.init.end);
  },
});

// Un nombre ausente NO revienta: queda `undefined` y la aserción que lo use
// falla, que es justo lo que debe pasar contra la versión vieja.
const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const {
  estadoPorSemana, proyeccionDeAvance, frasePorQueSinDesviacion, snapshotId,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${[...vistos].length} de módulo, ` +
  `${Object.keys(anidados).map(k => k.split('.')[1]).join(', ') || '(ninguno)'} del componente\n`);

// El comparador, armado con las piezas del archivo y nada más. `signo` y
// `texto` también se extraen: si se escribieran aquí, un día el archivo
// cambiaría de criterio y la prueba seguiría midiendo el criterio viejo.
let ordenarPor = null;
if (anidados['PortafolioDependencia.ordenadas']
    && anidados['PortafolioDependencia.signo']
    && anidados['PortafolioDependencia.texto']) {
  ordenarPor = new Function('filas', 'col', 'dir', `
    const signo = ${anidados['PortafolioDependencia.signo']};
    const texto = ${anidados['PortafolioDependencia.texto']};
    return ${anidados['PortafolioDependencia.ordenadas']};`);
}
let COLUMNAS = null;
if (anidados['PortafolioDependencia.COLUMNAS']) {
  COLUMNAS = new Function(`return ${anidados['PortafolioDependencia.COLUMNAS']};`)();
}
// La clave con que se ordena el contratista, tal como la arma la pantalla.
// Escribirla aquí a mano sería probar mi normalización, no la suya — y es
// justo donde estaba el agujero: con la clave vieja, la prueba pasaba por
// casualidad del abecedario.
let claveDe = null;
if (anidados['PortafolioDependencia.clave'] && anidados['PortafolioDependencia._ne']) {
  claveDe = new Function('contratista', `
    const _ne = ${anidados['PortafolioDependencia._ne']};
    return ${anidados['PortafolioDependencia.clave']};`);
}
// Qué dice cada celda. Se le inyectan los formateadores y la paleta porque lo
// que se mide es el TEXTO, no el color.
let celdaDe = null;
if (anidados['PortafolioDependencia.celdaDe']) {
  const MXN = n => `$${Number(n||0).toLocaleString('en-US')}`;
  const NUM = (n, d) => Number(n||0).toFixed(d);
  const C = new Proxy({}, { get: () => '#000' });
  celdaDe = new Function('MXN', 'NUM', 'C',
    `return (${anidados['PortafolioDependencia.celdaDe']});`)(MXN, NUM, C);
}

// ── Datos ──────────────────────────────────────────────────────────────────
const cierre = (semana, año, avance, extra = {}) => ({
  id: snapshotId ? snapshotId(semana, año) : `S${semana}-${año}`,
  semana, año, tipo: 'oficial', esquema: 3,
  avancePonderado: avance, montoEjecutado: avance * 10000,
  fechaCierre: `${año}-01-01`, capturadoPor: 'residente@ejemplo.gob.mx',
  ...extra,
});
const AHORA = new Date(2026, 8, 21, 12, 0).getTime();   // lunes 21-sep-2026

// ── 1. Cinco razones distintas para no tener número, y ninguna es un cero ──
console.log('1. Cuando no hay días de atraso, la celda dice por qué');
if (typeof frasePorQueSinDesviacion !== 'function' || typeof proyeccionDeAvance !== 'function') {
  const m = 'la pantalla sabe decir por qué no hay días de atraso que mostrar';
  fallos.push(m);
  console.log(`   ✗ ${m}  ·  la cuenta no está en este archivo`);
} else {
  const conPlazo = { inicio: '2026-04-01', fin: '2026-11-30' };
  const sinPlazo = { inicio: '2026-04-01' };

  // (a) Un solo cierre: no hay de dónde sacar velocidad.
  const unCierre = proyeccionDeAvance(
    estadoPorSemana([cierre(36, 2026, 20)]), 20, conPlazo, AHORA);
  // (b) Dos cierres, pero calculados con definiciones distintas.
  const noComp = proyeccionDeAvance(
    estadoPorSemana([cierre(35, 2026, 18, { esquema: 1 }), cierre(36, 2026, 20)]),
    20, conPlazo, AHORA);
  // (c) Dos cierres iguales: la obra no se movió.
  const parada = proyeccionDeAvance(
    estadoPorSemana([cierre(35, 2026, 20), cierre(36, 2026, 20)]), 20, conPlazo, AHORA);
  // (d) El avance bajó: la obra retrocede. No es lo mismo y no se dice igual.
  const atras = proyeccionDeAvance(
    estadoPorSemana([cierre(35, 2026, 25), cierre(36, 2026, 20)]), 20, conPlazo, AHORA);
  // (e) EL CASO QUE FALTABA. Cierres de sobra, velocidad buena, proyección
  //     perfectamente calculada — pero nadie capturó la fecha de término.
  const sinFin = proyeccionDeAvance(
    estadoPorSemana([cierre(34, 2026, 10), cierre(35, 2026, 20), cierre(36, 2026, 30)]),
    30, sinPlazo, AHORA);

  const f = p => frasePorQueSinDesviacion(p);
  const frases = { unCierre:f(unCierre), noComp:f(noComp), parada:f(parada),
                   atras:f(atras), sinFin:f(sinFin) };

  const vacia = s => s === null || s === undefined || String(s).trim() === ''
    || /^[—–\-]$/.test(String(s).trim()) || /^0( días?)?$/.test(String(s).trim());
  const mudas = Object.entries(frases).filter(([, s]) => vacia(s)).map(([k]) => k);
  check(mudas.length === 0,
    'ninguna de las cinco celdas sin número sale muda, en cero ni con un guion',
    mudas.length ? `mudas: ${mudas.join(', ')}` : Object.values(frases).map(s => `«${s}»`).join(' · '));

  const distintas = new Set(Object.values(frases).filter(Boolean));
  check(distintas.size === 5,
    'las cinco razones se distinguen entre sí en pantalla',
    `${distintas.size} frases distintas de 5`);

  // La mentira concreta que había: a la obra sin plazo se le decía que le
  // faltaban cierres, y el director iba a buscar cierres que estaban ahí.
  check(sinFin.desviacionDias === null && sinFin.razon === null,
    'una obra con tres cierres y buena velocidad pero sin fecha de término no da días de atraso',
    `desviación=${sinFin.desviacionDias} · velocidad=${sinFin.velocidad?.toFixed?.(2)}`);
  check(frases.sinFin !== frases.unCierre,
    'a esa obra NO se le dice que le faltan cierres: se le dice que falta el plazo',
    `«${frases.sinFin}»`);
  check(/plazo/i.test(String(frases.sinFin)),
    'y la frase nombra el plazo, que es lo que hay que ir a capturar',
    `«${frases.sinFin}»`);

  // Parada y retroceso son dos cosas distintas para quien supervisa.
  check(frases.parada !== frases.atras,
    'una obra detenida y una que retrocede no dicen lo mismo',
    `«${frases.parada}» vs «${frases.atras}»`);

  // Y cuando SÍ hay número, la frase se calla: si no, la celda diría las dos.
  const buena = proyeccionDeAvance(
    estadoPorSemana([cierre(34, 2026, 10), cierre(35, 2026, 20), cierre(36, 2026, 30)]),
    30, conPlazo, AHORA);
  check(buena.desviacionDias !== null && f(buena) === null,
    'cuando sí hay días de atraso que mostrar, no se añade ninguna explicación encima',
    `desviación=${buena.desviacionDias} · explicación=${JSON.stringify(f(buena))}`);
}

// ── 2. El orden: lo que no se pudo medir no se esconde ─────────────────────
console.log('\n2. El orden por días de atraso');
if (!ordenarPor) {
  const m = 'la tabla ordena las obras por días de atraso proyectados';
  fallos.push(m);
  console.log(`   ✗ ${m}  ·  no hay comparador que extraer de este archivo`);
} else {
  const fila = (nombre, extra) => ({
    nombre, contratado: 1000000, af: 50, diasSinCaptura: 3,
    atraso: null, sinAtraso: null, claveContratista: null, contratista: null, ...extra,
  });
  // Tres medibles y dos que no se pudieron medir. Las dos sin medir traen
  // avances muy distintos, para ver si entre ellas hay criterio o es al azar.
  const muestra = [
    fila('tarde',    { atraso: 40,   af: 30 }),
    fila('poco',     { atraso: 5,    af: 70 }),
    fila('adelante', { atraso: -12,  af: 90 }),
    fila('ciega-alta',{ atraso: null, sinAtraso: 'requiere 2 cierres', af: 85 }),
    fila('ciega-baja',{ atraso: null, sinAtraso: 'sin plazo vigente capturado', af: 4 }),
  ];
  const nombres = l => l.map(f => f.nombre);

  const desc = nombres(ordenarPor(muestra, 'atraso', 'desc'));
  check(desc[0] === 'tarde',
    'de mayor a menor, arriba queda la obra con más días de atraso',
    desc.join(' → '));
  check(desc.indexOf('ciega-alta') > desc.indexOf('adelante')
     && desc.indexOf('ciega-baja') > desc.indexOf('adelante'),
    'las obras que no se pudieron medir van debajo de todas las medidas',
    desc.join(' → '));
  check(desc.indexOf('ciega-baja') < desc.indexOf('ciega-alta'),
    'y entre ellas se ordenan por avance físico ascendente, no al azar',
    `4% antes que 85%: ${desc.join(' → ')}`);

  const asc = nombres(ordenarPor(muestra, 'atraso', 'asc'));
  check(asc[0] === 'adelante',
    'invirtiendo el orden, arriba queda la que va más adelantada',
    asc.join(' → '));
  check(asc.indexOf('ciega-alta') > asc.indexOf('tarde')
     && asc.indexOf('ciega-baja') > asc.indexOf('tarde'),
    'pero las que no se pudieron medir siguen abajo: invertir no las asciende',
    asc.join(' → '));

  // ── 3. El contratista, texto libre y sin padrón ──────────────────────────
  console.log('\n3. El orden por contratista');
  if (!claveDe) {
    const m = 'la misma empresa escrita de dos maneras queda junta en la lista';
    fallos.push(m);
    console.log(`   ✗ ${m}  ·  no hay clave de contratista que extraer de este archivo`);
  } else {
  const conEmpresa = (nombre, empresa) => fila(nombre, {
    contratista: empresa,
    claveContratista: empresa ? (claveDe(empresa) || null) : null,
  });
  // LA TERCERA EMPRESA ES EL PUNTO. «Acme Servicios» se mete entre las dos
  // capturas de Acme si la coma de «S.A. de C.V.» pesa en la comparación;
  // medido así ordenando por el texto crudo. Sin ella, las dos capturas
  // quedaban pegadas por casualidad del abecedario y la prueba no medía nada.
  const empresas = [
    conEmpresa('zeta',     'Zeta Obras, S.A. de C.V.'),
    conEmpresa('blanco',   null),
    conEmpresa('acme-pun', 'Acme, S.A. de C.V.'),
    conEmpresa('acme-may', 'ACME SA DE CV'),
    conEmpresa('acme-otra','Acme Servicios del Golfo'),
    conEmpresa('aridos',   'Áridos y Asfaltos del Istmo, S.A. de C.V.'),
  ];
  const ordAsc = nombres(ordenarPor(empresas, 'contratista', 'asc'));
  check(Math.abs(ordAsc.indexOf('acme-pun') - ordAsc.indexOf('acme-may')) === 1,
    'la misma empresa escrita de dos maneras queda junta, aunque no se pueda contar',
    ordAsc.join(' → '));
  check(ordAsc.indexOf('acme-otra') > Math.max(ordAsc.indexOf('acme-pun'), ordAsc.indexOf('acme-may')),
    'y otra empresa de nombre parecido no se cuela entre las dos',
    ordAsc.join(' → '));
  check(ordAsc[0] === 'acme-pun' || ordAsc[0] === 'acme-may',
    'el acento y las mayúsculas no cambian el lugar de una empresa en la lista',
    ordAsc.join(' → '));
  check(ordAsc[ordAsc.length - 1] === 'blanco',
    'la obra sin contratista capturado queda al final, no mezclada en la A',
    ordAsc.join(' → '));
  const ordDesc = nombres(ordenarPor(empresas, 'contratista', 'desc'));
  check(ordDesc[0] === 'zeta' && ordDesc[ordDesc.length - 1] === 'blanco',
    'invirtiendo, el sin capturar SIGUE al final: no es «la primera del abecedario»',
    ordDesc.join(' → '));
  }

  // Lo mismo con la captura, que es el otro dato que puede faltar.
  console.log('\n4. El orden por última captura');
  const caps = [
    fila('hace19', { diasSinCaptura: 19 }),
    fila('hoy',    { diasSinCaptura: 0 }),
    fila('nunca',  { diasSinCaptura: null }),
  ];
  const cDesc = nombres(ordenarPor(caps, 'captura', 'desc'));
  const cAsc  = nombres(ordenarPor(caps, 'captura', 'asc'));
  check(cDesc[0] === 'hace19',
    'de más antigua a más reciente, arriba la que lleva más días sin captura',
    cDesc.join(' → '));
  check(cDesc[cDesc.length-1] === 'nunca' && cAsc[cAsc.length-1] === 'nunca',
    'la obra sin captura registrada no se cuela como «capturada hoy» en ningún sentido',
    `desc: ${cDesc.join(' → ')}  |  asc: ${cAsc.join(' → ')}`);
}

// ── 5. Las diez columnas, y que se puedan ordenar con un clic ──────────────
console.log('\n5. Las diez columnas de la tabla');
// Los días de atraso van TERCEROS, no al final: son lo que ordena la tabla por
// omisión, y detrás de las cinco cifras de dinero quedaban fuera de pantalla.
const ESPERADAS = ['Obra', 'Contratista', 'Días de atraso proyectados',
  'Contratado', 'Ejecutado', 'Estimado', 'Pagado', 'Por ejercer',
  'Avance físico', 'Última captura'];
if (!Array.isArray(COLUMNAS)) {
  const m = 'la tabla enseña las diez columnas acordadas, en orden';
  fallos.push(m);
  console.log(`   ✗ ${m}  ·  no hay tabla de columnas en este archivo`);
} else {
  const lbls = COLUMNAS.map(c => c.lbl);
  check(JSON.stringify(lbls) === JSON.stringify(ESPERADAS),
    'la tabla enseña las diez columnas acordadas, en orden',
    lbls.join(' | '));
  check(COLUMNAS.findIndex(c => c.id === 'atraso') <= 2,
    'los días de atraso se ven sin arrastrar la tabla: son los que la ordenan',
    `van en la posición ${COLUMNAS.findIndex(c => c.id === 'atraso') + 1} de ${COLUMNAS.length}`);

  // CADA COLUMNA TIENE SU CELDA, y la celda sale del MISMO recorrido que el
  // encabezado. Mientras fueron dos listas paralelas, mover una columna sin
  // mover la otra ponía cada cifra bajo el título equivocado y la tabla se
  // seguía viendo perfecta. Aquí se comprueba que no quede ninguna suelta.
  if (!celdaDe) {
    const m = 'cada columna tiene una celda que decir';
    fallos.push(m);
    console.log(`   ✗ ${m}  ·  las celdas no se pintan recorriendo las columnas en este archivo`);
  } else {
    const ejemplo = { nombre:'MC-OP-2026-001', contratista:'Acme, S.A. de C.V.',
      contratado:12400000, ejecutado:6933725, estimado:8300000, pagado:5900000,
      porEjercer:6500000, af:55.9, diasSinCaptura:3, atraso:27, sinAtraso:null };
    const vacias = COLUMNAS.map(c => [c.lbl, celdaDe(ejemplo, c.id)?.texto])
      .filter(([, t]) => t === undefined || t === null || String(t).trim() === ''
                      || /sin celda para/.test(String(t)));
    check(vacias.length === 0,
      'cada columna tiene una celda que decir, ninguna sale en blanco',
      vacias.length ? vacias.map(([l]) => l).join(', ')
        : COLUMNAS.map(c => celdaDe(ejemplo, c.id).texto).join(' | '));

    // Y las tres que pueden faltar lo DICEN, cada una con su palabra.
    const sinNada = { ...ejemplo, contratista:null, diasSinCaptura:null,
      atraso:null, sinAtraso:'sin plazo vigente capturado' };
    const dichos = ['contratista', 'atraso', 'captura'].map(id => celdaDe(sinNada, id).texto);
    const mudos = dichos.filter(t => !t || /^[—–\-]$/.test(String(t).trim())
                                  || /^\$?0( días?)?%?$/.test(String(t).trim()));
    check(mudos.length === 0,
      'contratista, atraso y última captura dicen que faltan en vez de salir con un guion o un cero',
      mudos.length ? `mudas: ${JSON.stringify(mudos)}` : dichos.map(t => `«${t}»`).join(' · '));
  }

  // P5: de este lado de la pantalla la economía del contratista no existe.
  const prohibidas = /margen|utilidad|gasto|costo|n[oó]mina|personal|horas extra|maquinaria/i;
  const filtra = lbls.filter(l => prohibidas.test(l));
  check(filtra.length === 0,
    'ninguna columna enseña economía del contratista',
    filtra.length ? filtra.join(', ') : 'ninguna');

  // El primer clic de cada columna tiene que ir hacia lo que se está
  // buscando: en un monto el más grande, en el avance la obra más rezagada,
  // en el atraso la más tarde, en la captura la más vieja.
  const PRIMERCLIC = { nombre:'asc', contratista:'asc', contratado:'desc',
    ejecutado:'desc', estimado:'desc', pagado:'desc', porEjercer:'desc',
    af:'asc', atraso:'desc', captura:'desc' };
  const malas = COLUMNAS.filter(c => c.dirIni !== PRIMERCLIC[c.id])
    .map(c => `${c.lbl}→${c.dirIni}`);
  check(malas.length === 0,
    'el primer clic de cada columna ordena hacia donde está el problema',
    malas.length ? malas.join(', ') : 'las diez');

  // Y el segundo clic sobre la MISMA columna invierte, en vez de reiniciar.
  if (anidados['PortafolioDependencia.clicEnCabecera']) {
    let puesto = null;
    const clic = new Function('COLUMNAS', 'col', 'dir', 'setOrden',
      `return (${anidados['PortafolioDependencia.clicEnCabecera']});`)(
      COLUMNAS, 'atraso', 'desc', v => { puesto = v; });
    clic('atraso');
    const inv = puesto;
    clic('contratado');
    check(inv === 'atraso|asc',
      'volver a hacer clic en la columna ordenada la invierte',
      `quedó «${inv}»`);
    check(puesto === 'contratado|desc',
      'y hacer clic en otra columna arranca en su propio sentido, no hereda el anterior',
      `quedó «${puesto}»`);
  } else {
    const m = 'volver a hacer clic en la columna ordenada la invierte';
    fallos.push(m);
    console.log(`   ✗ ${m}  ·  las cabeceras no responden al clic en este archivo`);
  }

  // Encabezado ordenable = encabezado con nombre accesible y estado anunciado.
  // El triángulo ↑↓ es forma y color, y ninguna de las dos se oye en voz alta.
  check(/aria-sort=/.test(jsxPortafolio),
    'cada encabezado anuncia en voz alta si la tabla está ordenada por él',
    /aria-sort=/.test(jsxPortafolio) ? 'sí' : 'no lo dice');
}

// ── 6. La frase vive en un solo lugar ──────────────────────────────────────
// Es lo que acababa de fallar en producción: la explicación estaba copiada
// dentro del KPI de la obra con un caso de menos. Dos copias de la misma
// afirmación significa que arreglar una deja mintiendo a la otra.
console.log('\n6. La misma explicación en la obra y en el portafolio');
// Cuántas veces puede aparecer cada frase, y por qué si es más de una. La
// excepción no es un permiso en blanco: si alguien reescribe UNA de las dos
// copias, la cuenta baja a 1 y esto se pone rojo igual, que es exactamente
// cuando hay que mirar.
const FRASES = [
  { f: 'la obra no avanza',            veces: 1 },
  { f: 'la obra retrocede',            veces: 1 },
  { f: 'cierres no comparables',       veces: 1 },
  { f: 'sin plazo vigente capturado',  veces: 1 },
  { f: 'requiere 2 cierres',           veces: 2,
    por: 'el KPI «Esta semana» dice lo mismo del DELTA semanal, que es otra '
       + 'cifra con su propia cadena de dos casos; no es una copia de ésta' },
];
const malcontadas = FRASES
  .map(e => ({ ...e, n: (src.match(new RegExp(`['"\`]${e.f}['"\`]`, 'g')) || []).length }))
  .filter(e => e.n !== e.veces);
check(malcontadas.length === 0,
  'ninguna explicación está escrita dos veces sin que se sepa por qué',
  malcontadas.length
    ? malcontadas.map(e => `«${e.f}» ×${e.n}, se esperaban ${e.veces}`).join(', ')
    : FRASES.map(e => `«${e.f}»×${e.veces}`).join(' · '));

// ── Resultado ──────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
if (fallos.length === 0) {
  console.log('VERDE — la tabla ordena por lo que dice ordenar y ninguna celda calla.\n');
  process.exit(0);
}
console.log(`ROJO — ${fallos.length} fallo(s):`);
for (const f of fallos) console.log(`  · ${f}`);
console.log('');
process.exit(1);
