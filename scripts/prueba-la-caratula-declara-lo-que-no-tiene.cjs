#!/usr/bin/env node
// Prueba: UN DOCUMENTO FIRMADO DECLARA LO QUE NO TIENE Y NO LO RELLENA CON OTRA
// COSA. Y EL DINERO DE UN RUBRO NO SE MUDA AL RUBRO DE AL LADO.
//
// ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
// Medido en producción el 2026-11-09 sobre las 7 obras vivas
// (`scripts/medir-los-campos-de-la-caratula.cjs`, sólo lectura):
//
//   · `residente` está VACÍO en la 0127 y dice «N/A» en la 0128.
//   · `admin` está vacío en la 0127 y dice «N/A» en 0112, 0125, 0128 y 0131.
//   · `contrato` trae una DESCRIPCIÓN y no un número en 5 de 7, dice «N/A» en
//     la 0114, y sólo la 0125 trae el número solo. La 0126 trae las dos cosas
//     pegadas: «5200011871 “Rehabilitación de estructuras metálicas…».
//   · `ubicacion` no está en NINGUNA de las siete: el campo no existe en el
//     modelo, ningún formulario lo escribe y el único sitio del repositorio
//     que lo lee es el renglón de la portada.
//
// La portada imprimía esos campos con un `|| ''` detrás —etiqueta puesta, valor
// en blanco— y el pie de firmas hacía algo peor:
//
//     [obra.residente || obra.superintendente || 'Residente', …]
//
// En la 0127 eso imprimía al SUPERINTENDENTE bajo «Residente de Obra ·
// Elaboró». No es un hueco: es un cargo atribuido a quien no lo tiene, en el
// renglón donde se firma. Y en la 0128 salía impresa la cadena «N/A» en el
// lugar del nombre, porque para un `||` «N/A» es un valor presente.
//
// El otro medio pendiente es de dinero. En `global/gp_detalle/obras` hay 35
// obras y en 14 conviven «300 INDIRECTOS» y «300 SUBCONTRATOS»: comparten el
// número y no la etiqueta. En la 0112 son $4,148,716.68 contra $1,308,275.54.
// Los dos parsers del servidor ya indexan por etiqueta completa; las dos listas
// de rubros de la pantalla tomaban `r.id` como `key` de React, que es «300»
// para las dos.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
// Nada de que un símbolo exista. Todo se EXTRAE de `src/App.jsx` y se EJECUTA.
//
//   §1  Las cuentas de captura —`textoCapturado`, `comoSeImprime`,
//       `contratoCapturado`— movidas con los SIETE valores de producción.
//   §2  El PDF entero, dibujado sobre el lienzo falso, con el alta de la 0127
//       (residente y admin vacíos) y con la de la 0128 («N/A» en los dos). Se
//       mira QUÉ TEXTO sale AL LADO DE QUÉ ETIQUETA y DEBAJO DE QUÉ CARGO: la
//       posición es la afirmación. Un `includes` sobre todo el documento se
//       cumpliría con el renglón de «Superintendente:», que sí lleva ese
//       nombre con razón.
//   §3  La expresión que está EN EL `key=` de las dos listas de rubros, sacada
//       por AST del sitio donde vive y ejecutada contra los cinco rubros reales
//       de la 0112. No se mira el texto del archivo: se agrupa el dinero con
//       esa expresión y se compara cada cubeta contra el total del rubro.
//   §4  La tabla de rubros del PDF, con el detalle de la 0112: los dos 300
//       tienen que salir como dos renglones con sus dos montos.
//
// ── LA CONTRAPRUEBA ────────────────────────────────────────────────────────
// Siete mutaciones. Cada una tiene que salir ROJO (1); una que salga 2 es el
// banco cayéndose, que no es verlo.
//
// Uso:  node scripts/prueba-la-caratula-declara-lo-que-no-tiene.cjs
//       node scripts/prueba-la-caratula-declara-lo-que-no-tiene.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, noArranco } = require('./no-arranco.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDF } = require('./lienzo-pdf.cjs');
const { libresDe, OPTS } = require('./taller-de-app.cjs');

const RAIZ = path.join(__dirname, '..');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_APP)
    sinPrecondicion('la contraprueba corriendo sobre una copia ya mutada',
      ['Se invocó con ARCH_APP puesta.']);

  const MUTACIONES = [
    ['la carátula vuelve al `|| \'\'`: etiqueta puesta y valor en blanco',
      (t) => t.replace('const comoSeImprime = (v) => textoCapturado(v) ?? NO_CAPTURADO;',
        "const comoSeImprime = (v) => v || '';")],
    ['«N/A» vuelve a contar como un valor capturado',
      (t) => t.replace(
        "const RELLENO_DE_CAPTURA = new Set(['n/a', 'na', 'n.a.', 'n/d', 'nd', '-', '--', '—',\n  '.', '..', 'x', 'xx', 'sin dato', 'sin datos', 'pendiente', 'por definir', '0']);",
        'const RELLENO_DE_CAPTURA = new Set([]);')],
    ['el pie vuelve a tomar prestado al superintendente para firmar de residente',
      (t) => t.replace("    [comoSeImprime(obra.residente),'Residente de Obra','Elaboró'],",
        "    [obra.residente||obra.superintendente||'Residente','Residente de Obra','Elaboró'],")],
    ['«Contrato:» se rellena con la descripción de la obra',
      (t) => t.replace("    ['Contrato:', contr.numero ?? NO_CAPTURADO],",
        "    ['Contrato:', comoSeImprime(obra.contrato)],")],
    ['el objeto de la obra se tira en vez de rotularse aparte',
      (t) => t.replace("    ...(contr.objeto ? [['Objeto de la obra:', contr.objeto]] : []),",
        '')],
    ['los rubros se vuelven a agrupar por el número de tres dígitos',
      (t) => t.replace(/key=\{claveDeRubro\(r\)\}/g, 'key={r.id}')],
    ['la portada declara ausente un campo que la aplicación nunca ofrece',
      (t) => t.replace('  if (textoCapturado(obra.ubicacion)) T(textoCapturado(obra.ubicacion), ML, 82);',
        '  T(comoSeImprime(obra.ubicacion), ML, 82);')],
  ];

  let vistas = 0;
  for (const [nombre, romper] of MUTACIONES) {
    const antes = fs.readFileSync(ARCH_APP, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}`);
      console.log('             el ancla ya no está en src/App.jsx. '
        + 'Una mutación que no se aplica no mide nada.');
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-caratula-'));
    const copia = path.join(dir, 'App.jsx');
    fs.writeFileSync(copia, despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, ARCH_APP: copia },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const rojas = (salida.match(/^FALLA/gm) || []).length;
    const vio = r.status === 1 && rojas > 0;
    console.log(`${vio ? `ROJA ×${String(rojas).padStart(2)}`.padEnd(12) : 'NO LA VE    '} ${nombre}`);
    if (!vio) {
      console.log(`             salió ${r.status} con ${rojas} en rojo`
        + (r.status === 2 ? ' (el banco se cayó, que no es verlo)' : ''));
      console.log(salida.split('\n').slice(-14).map((l) => '             ' + l).join('\n'));
    } else vistas++;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: el banco no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── EL BANCO ───────────────────────────────────────────────────────────────
vigilarExcepciones(path.relative(RAIZ, ARCH_APP));

const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

let fallas = 0;
const ok = (q, d) => console.log(` ok   ${q}${d ? `  ·  ${d}` : ''}`);
const falla = (q, esp, obt) => {
  fallas++;
  console.log(`FALLA  ${q}\n       esperaba: ${esp}\n       obtuve:   ${obt}`);
};
const check = (cond, q, esp, obt) => (cond ? ok(q, obt) : falla(q, esp, obt));

// ── LOS DATOS DE PRODUCCIÓN ────────────────────────────────────────────────
// Copiados del informe del medidor del 2026-11-09, literales. No hay un valor
// inventado aquí: el punto del banco es que la hoja se comporte con LO QUE HAY
// en la base, no con un caso de laboratorio.
const CONTRATOS = {
  '0112': 'REHABILITACIÓN DE ANDADORES DEL BOULEVARD COSTERO JOHN SPARKS, ENTRE AV. '
    + 'INDEPENDENCIA Y CALLE CARLOS GÓMEZ, DEL KM 2+050 AL KM 4+000, EN LA LOCALIDAD DE '
    + 'COATZACOALCOS, MUNICIPIO DE COATZACOALCOS, DEL ESTADO DE VERACRUZ DE IGNACIO DE LA LLAVE',
  '0114': 'N/A',
  '0125': '6700388901',
  '0126': '5200011871 “Rehabilitación de estructuras metálicas, láminas metálicas en el '
    + 'área 41, área 45, carga de ferrotolvas, área de bodegas y ensacado”',
  '0127': 'REHABILITACIÓN Y MANTENIMIENTO AL CENTRO DE CONVENCIONES Y TEATRO DE LA CIUDAD, '
    + 'EN LA LOCALIDAD DE COATZACOALCOS, MUNICIPIO DE COATZACOALCOS, ESTADO DE VERACRUZ DE '
    + 'IGNACIO DE LA LLAVE.',
  '0128': 'REHABILITACIÓN DE RED DE DRENAJE SANITARIO (COLECTOR SANITARIO JOHN SPARK 2 '
    + 'ENTRE CALLE JOSÉ AZUETA Y CÁRCAMO SANITARIO No. 1)  EN LA LOCALIDAD DE COATZACOALCOS, '
    + 'MUNICIPIO DE COATZACOALCOS, DEL ESTADO DE VERACRUZ DE IGNACIO DE LA LLAVE.',
  '0131': 'REHABILITACIÓN DE RED DE DRENAJE SANITARIO (EMISOR ENTRE CALLE JOSÉ AZUETA)',
};

const SIOP = 'SECRETARÍA DE INFRAESTRUCTURA Y OBRAS PÚBLICAS DEL ESTADO DE VERACRUZ';

// La 0127: residente y admin SIN CAPTURAR, y un superintendente que estaba
// firmando de residente.
const OBRA_0127 = {
  id: '0127', nombre: 'CENTRO DE CONVENCIONES MTTO 0626',
  contrato: CONTRATOS['0127'], cliente: SIOP,
  superintendente: 'ING. JOSÉ JULIÁN ISLAS PACHECO',
  residente: '', admin: '',
  inicio: '2026-07-30', fin: '2027-02-24', presupuesto: 24000000,
};

// La 0128: residente y admin con «N/A» tecleado. Es el caso que un `||` no ve.
const OBRA_0128 = {
  id: '0128', nombre: 'SIOP COLECTOR MALECON PENTAGONO 0926',
  contrato: CONTRATOS['0128'], cliente: SIOP,
  superintendente: 'ALDO JOSE TORRES ACULTECO',
  residente: 'N/A', admin: 'N/A',
  inicio: '2026-08-27', fin: '2026-12-24', presupuesto: 31000000,
};

// Los cinco rubros de la 0112 tal como los publica `global/gp_detalle/obras`,
// con los dos que comparten el 300. Los montos son los de producción al
// 2026-11-09 y son el centro del asunto: si la pantalla agrupa por `id`, el
// $1,308,275.54 de SUBCONTRATOS desaparece dentro de INDIRECTOS.
const RUBROS_0112 = [
  { id: '100', nombre: '100 MATERIALES', nombreCorto: 'MATERIALES',
    grandTotal: 12653771.491379313 },
  { id: '200', nombre: '200 SUELDOS Y SALARIOS', nombreCorto: 'SUELDOS Y SALARIOS',
    grandTotal: 6582458.463688155 },
  { id: '300', nombre: '300 INDIRECTOS', nombreCorto: 'INDIRECTOS',
    grandTotal: 4148716.677586203 },
  { id: '300', nombre: '300 SUBCONTRATOS', nombreCorto: 'SUBCONTRATOS',
    grandTotal: 1308275.5431034483 },
  { id: '400', nombre: '400 MAQUINARIA Y EQUIPO', nombreCorto: 'MAQUINARIA Y EQUIPO',
    grandTotal: 1373543.324482758 },
];

// ── EXTRACCIÓN ─────────────────────────────────────────────────────────────
const fuenteApp = fs.readFileSync(ARCH_APP, 'utf8');

let APP;
try {
  APP = fuenteDe(ARCH_APP, ['textoCapturado', 'comoSeImprime', 'contratoCapturado',
    'NO_CAPTURADO', 'claveDeRubro', 'generarPDFObra', 'MXN'], { tolerante: true });
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, path.relative(RAIZ, ARCH_APP));
  throw e;
}
if (APP.faltan.length) noArranco(APP.faltan, path.relative(RAIZ, ARCH_APP));

const armar = (expr) => new Function(
  'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  `"use strict";\n${APP.cuerpo}\nreturn (${expr});`
)(...Array(6).fill(() => {}));

let textoCapturado, comoSeImprime, contratoCapturado, NO_CAPTURADO, claveDeRubro,
  generarPDFObra, MXN;
try {
  textoCapturado = armar('textoCapturado');
  comoSeImprime = armar('comoSeImprime');
  contratoCapturado = armar('contratoCapturado');
  NO_CAPTURADO = armar('NO_CAPTURADO');
  claveDeRubro = armar('claveDeRubro');
  generarPDFObra = armar('generarPDFObra');
  // El formateador se SACA de la aplicación, no se vuelve a escribir aquí. Un
  // `toLocaleString` tecleado en el banco es una segunda cuenta del mismo
  // número: el día que la hoja cambie de formato, el banco diría que el monto
  // no está cuando lo que cambió fue la coma.
  MXN = armar('MXN');
} catch (e) {
  sinPrecondicion('no se pudo montar el código extraído de App.jsx',
    [e.message.split('\n')[0],
     'Sin poder EJECUTARLO, mirar su texto sería comprobar que una cadena está',
     'escrita, no que la hoja se comporta.']);
}

(async () => {

  // ═══ §1 · LAS CUENTAS DE CAPTURA, CON LOS VALORES DE PRODUCCIÓN ══════════

  // Un campo sin capturar se DECLARA. Ni cadena vacía —que deja el renglón a
  // medias— ni el relleno que alguien tecleó.
  const ausencias = [
    ['vacío (0127, residente)', ''],
    ['sólo espacios', '   '],
    ['no existe el campo', undefined],
    ['nulo', null],
    ['«N/A» (0128, residente)', 'N/A'],
    ['«n/a» en minúsculas', 'n/a'],
    ['un guión', '-'],
    ['un cero', '0'],
  ];
  for (const [porQue, v] of ausencias) {
    const s = comoSeImprime(v);
    check(s === NO_CAPTURADO,
      `${porQue}: la hoja lo declara en vez de imprimirlo`,
      `«${NO_CAPTURADO}»`, `«${s}»`);
  }

  // Y un campo capturado pasa íntegro. Un filtro que se comiera un nombre de
  // verdad sería el defecto por el otro lado.
  const presentes = ['ALDO JOSE TORRES ACULTECO', 'ING. JOSÉ JULIÁN ISLAS PACHECO',
    SIOP, '2026-08-27'];
  const intactos = presentes.filter((v) => comoSeImprime(v) === v);
  check(intactos.length === presentes.length,
    'un campo que SÍ se capturó sale íntegro y sin tocarlo',
    `los ${presentes.length} valores de producción tal cual`,
    `${intactos.length} de ${presentes.length}`);

  check(textoCapturado('  ALDO JOSE TORRES ACULTECO  ') === 'ALDO JOSE TORRES ACULTECO',
    'los espacios de sobra de la captura no llegan a la hoja',
    'el nombre sin espacios a los lados',
    `«${textoCapturado('  ALDO JOSE TORRES ACULTECO  ')}»`);

  // `contrato`, obra por obra. Lo que se afirma es la REPARTICIÓN: qué se
  // publica como número de contrato y qué como objeto de la obra.
  const esperado = {
    '0112': { numero: null, objetoEmpieza: 'REHABILITACIÓN DE ANDADORES' },
    '0114': { numero: null, objetoEmpieza: null },
    '0125': { numero: '6700388901', objetoEmpieza: null },
    '0126': { numero: '5200011871', objetoEmpieza: '“Rehabilitación de estructuras' },
    '0127': { numero: null, objetoEmpieza: 'REHABILITACIÓN Y MANTENIMIENTO' },
    '0128': { numero: null, objetoEmpieza: 'REHABILITACIÓN DE RED' },
    '0131': { numero: null, objetoEmpieza: 'REHABILITACIÓN DE RED' },
  };
  for (const [id, esp] of Object.entries(esperado)) {
    const r = contratoCapturado(CONTRATOS[id]);
    const numOK = r.numero === esp.numero;
    const objOK = esp.objetoEmpieza === null
      ? r.objeto === null
      : typeof r.objeto === 'string' && r.objeto.startsWith(esp.objetoEmpieza);
    check(numOK && objOK,
      `${id}: el número y el objeto se reparten como lo que son`,
      `número ${esp.numero === null ? 'sin capturar' : `«${esp.numero}»`}`
        + ` · objeto ${esp.objetoEmpieza === null ? 'ninguno' : `«${esp.objetoEmpieza}…»`}`,
      `número ${r.numero === null ? 'sin capturar' : `«${r.numero}»`}`
        + ` · objeto ${r.objeto === null ? 'ninguno' : `«${String(r.objeto).slice(0, 34)}…»`}`);
  }

  // Y por el otro lado: un número de contrato que NO empieza con cifra sigue
  // siendo un número de contrato. Estos dos no salen de producción sino del
  // sembrado del emulador, y están aquí porque la primera versión de la cuenta
  // los declaraba NO CAPTURADOS estando capturados — el mismo defecto que este
  // cambio venía a cerrar, puesto del otro lado. Se vio al verificar en el
  // preview, no al escribir el banco.
  for (const v of ['LO-920-2026-0114', 'SIOP-2026-0128']) {
    const r = contratoCapturado(v);
    check(r.numero === v && r.objeto === null,
      `«${v}» se publica como número de contrato aunque abra con letra`,
      `número «${v}» y ningún objeto`,
      `número ${r.numero === null ? 'sin capturar' : `«${r.numero}»`}`
        + ` · objeto ${r.objeto === null ? 'ninguno' : `«${r.objeto}»`}`);
  }

  // Lo que empieza con una cifra suelta NO es un número: es prosa que arranca
  // contando. Cinco dígitos en la primera palabra es lo que los separa.
  for (const v of ['2 CÁRCAMOS SANITARIOS EN LA LOCALIDAD DE COATZACOALCOS', '2026']) {
    const r = contratoCapturado(v);
    check(r.numero === null && r.objeto === v,
      `«${String(v).slice(0, 28)}» no se publica como número de contrato`,
      'número sin capturar y el texto conservado como objeto',
      `número ${r.numero === null ? 'sin capturar' : `«${r.numero}»`}`
        + ` · objeto ${r.objeto === null ? 'ninguno' : `«${String(r.objeto).slice(0, 28)}»`}`);
  }

  // Ninguna descripción se publica como número. Es la frontera: cinco de las
  // siete obras vivas caen de este lado.
  const prosaComoNumero = Object.keys(CONTRATOS)
    .filter((id) => esperado[id].numero === null && contratoCapturado(CONTRATOS[id]).numero !== null);
  check(prosaComoNumero.length === 0,
    'ninguna descripción de obra se publica bajo la etiqueta «Contrato:»',
    'cero obras con prosa pasando por número',
    prosaComoNumero.length ? prosaComoNumero.join(', ') : 'ninguna');

  // Y el objeto NO se pierde cuando no hay número: es la única descripción de
  // la obra que el alta guarda, y tirarla por no saber rotularla sería perder
  // un dato que alguien escribió.
  const objetoPerdido = Object.keys(CONTRATOS).filter((id) => {
    const esp = esperado[id];
    return esp.objetoEmpieza !== null && !contratoCapturado(CONTRATOS[id]).objeto;
  });
  check(objetoPerdido.length === 0,
    'el objeto de la obra se conserva aunque el número no se haya capturado',
    'cero descripciones tiradas',
    objetoPerdido.length ? objetoPerdido.join(', ') : 'ninguna');

  // ═══ §2 · EL DOCUMENTO: QUÉ SALE AL LADO DE QUÉ ETIQUETA ═════════════════
  //
  // Dibujado de verdad sobre el lienzo falso. Lo que se mira es la POSICIÓN:
  // un `includes` sobre el documento entero se cumpliría con el renglón de
  // «Superintendente:», que lleva ese nombre con razón.
  const dibujarCon = async (obra) => {
    try {
      return await dibujarPDF(generarPDFObra, {}, obra,
        { instante: { ms: Date.UTC(2026, 10, 9, 18, 0, 0), fuente: 'servidor' } });
    } catch (e) {
      sinPrecondicion('el PDF no se pudo dibujar',
        [e.message.split('\n')[0],
         'Sin dibujo, «no dice tal cosa» se cumple por no haber impreso nada.']);
    }
    return [];
  };

  // El valor que la portada imprime al lado de una etiqueta: mismo renglón
  // (misma `y`), más a la derecha. Se resuelve por geometría y no por orden de
  // dibujo, que es lo que cambia cuando se mete un renglón nuevo.
  const valorJuntoA = (dibujos, etiqueta) => {
    const lbl = dibujos.find((d) => d.pagina === 1 && d.texto === etiqueta);
    if (!lbl) return { falta: true };
    const a = dibujos.filter((d) => d.pagina === 1 && d.y === lbl.y && d.x > lbl.x)
      .sort((p, q) => p.x - q.x);
    return { falta: false, textos: a.map((d) => d.texto) };
  };

  // El nombre que firma bajo un cargo: mismo `x` que el cargo —los tres van
  // centrados en su tercio— y la `y` más alta de las tres (nombre, cargo,
  // verbo se dibujan de arriba abajo).
  const firmaBajo = (dibujos, cargo) => {
    const c = dibujos.find((d) => d.texto === cargo && d.align === 'center');
    if (!c) return { falta: true };
    const col = dibujos.filter((d) => d.pagina === c.pagina && d.align === 'center'
      && d.x === c.x && d.y < c.y).sort((p, q) => q.y - p.y);
    return { falta: false, nombre: col.length ? col[0].texto : null };
  };

  for (const [etiqueta, obra] of [['0127, sin capturar', OBRA_0127],
    ['0128, con «N/A» tecleado', OBRA_0128]]) {
    const dib = await dibujarCon(obra);
    if (dib.length < 20)
      sinPrecondicion(`el PDF de la ${etiqueta} sólo dibujó ${dib.length} textos`,
        ['Con el dibujo casi vacío cualquier «no aparece» se cumple por vacío.']);

    // (a) El renglón del residente DECLARA la ausencia.
    const vRes = valorJuntoA(dib, 'Residente:');
    if (vRes.falta)
      sinPrecondicion(`no se halló la etiqueta «Residente:» en la portada de la ${etiqueta}`,
        ['Sin la etiqueta no hay renglón que mirar, y el banco saldría verde por vacío.']);
    check(vRes.textos.includes(NO_CAPTURADO),
      `${etiqueta}: la portada declara que el residente no se capturó`,
      `«${NO_CAPTURADO}» al lado de «Residente:»`,
      vRes.textos.map((t) => `«${t}»`).join(' · ') || 'nada a la derecha');

    // (b) Y NO pone ahí el nombre del superintendente, que es lo que hacía.
    check(!vRes.textos.some((t) => t === obra.superintendente),
      `${etiqueta}: el renglón del residente no trae el nombre del superintendente`,
      `cero apariciones de «${obra.superintendente}» en ese renglón`,
      vRes.textos.map((t) => `«${t}»`).join(' · ') || 'nada a la derecha');

    // (c) El mismo criterio, en el renglón que se firma. Éste es el que
    // atribuía un cargo a quien no lo tiene.
    const fRes = firmaBajo(dib, 'Residente de Obra');
    if (fRes.falta)
      sinPrecondicion(`no se halló el cargo «Residente de Obra» en el pie de la ${etiqueta}`,
        ['Sin el pie no se puede mirar a quién atribuye el cargo.']);
    check(fRes.nombre === NO_CAPTURADO,
      `${etiqueta}: bajo «Residente de Obra» no firma nadie prestado`,
      `«${NO_CAPTURADO}»`, `«${fRes.nombre}»`);

    const fAdm = firmaBajo(dib, 'Administrador de Obra');
    check(!fAdm.falta && fAdm.nombre === NO_CAPTURADO,
      `${etiqueta}: bajo «Administrador de Obra» tampoco`,
      `«${NO_CAPTURADO}»`, `«${fAdm.nombre}»`);

    // (d) El superintendente SÍ firma lo suyo: declarar ausencias no puede
    // vaciar los renglones que sí tienen dato.
    const fSup = firmaBajo(dib, 'Superintendente de Obra');
    check(!fSup.falta && fSup.nombre === obra.superintendente,
      `${etiqueta}: bajo «Superintendente de Obra» firma el superintendente`,
      `«${obra.superintendente}»`, `«${fSup.nombre}»`);

    // (e) La raya y el verbo se quedan: la casilla existe para firmarse a
    // mano, y quitarla por falta de un nombre tecleado estorbaría el trámite.
    const verbos = dib.filter((d) => ['Elaboró', 'Revisó', 'Vo.Bo.'].includes(d.texto));
    check(verbos.length === 3,
      `${etiqueta}: las tres casillas de firma siguen ahí para firmarse a mano`,
      'los tres verbos: Elaboró · Revisó · Vo.Bo.',
      verbos.map((d) => d.texto).join(' · ') || 'ninguno');

    // (f) El contrato. En las dos obras `contrato` trae prosa, así que el
    // número se declara ausente Y el objeto sale con su propia etiqueta.
    const vCon = valorJuntoA(dib, 'Contrato:');
    if (vCon.falta)
      sinPrecondicion(`no se halló la etiqueta «Contrato:» en la portada de la ${etiqueta}`,
        ['Sin la etiqueta no hay renglón que mirar.']);
    check(vCon.textos.includes(NO_CAPTURADO),
      `${etiqueta}: el número de contrato se declara ausente y no se tapa con la descripción`,
      `«${NO_CAPTURADO}» al lado de «Contrato:»`,
      vCon.textos.map((t) => `«${String(t).slice(0, 40)}»`).join(' · ') || 'nada');

    const vObj = valorJuntoA(dib, 'Objeto de la obra:');
    const esperaObjeto = contratoCapturado(obra.contrato).objeto;
    check(!vObj.falta && vObj.textos.some((t) => String(t).startsWith(String(esperaObjeto).slice(0, 30))),
      `${etiqueta}: la descripción capturada sale rotulada como objeto de la obra`,
      `«${String(esperaObjeto).slice(0, 30)}…» bajo «Objeto de la obra:»`,
      vObj.falta ? 'no hay renglón de objeto' : vObj.textos.map((t) => `«${String(t).slice(0, 34)}»`).join(' · '));

    // (g) LA CUENTA DE LAS AUSENCIAS. El documento declara exactamente las que
    // tiene etiqueta para declarar: dos renglones de la portada —residente y
    // administrador—, el número de contrato, y los dos nombres del pie. Cinco.
    // Ni una más: `ubicacion` no existe en el modelo y la portada se CALLA,
    // porque ese renglón no lleva etiqueta y una línea que no se pinta no
    // promete nada. Declarar ahí sería reclamarle al usuario un campo que la
    // aplicación no le ofrece.
    const declaradas = dib.filter((d) => d.texto === NO_CAPTURADO);
    check(declaradas.length === 5,
      `${etiqueta}: el documento declara las cinco ausencias que sabe rotular, y ni una más`,
      '5 declaraciones: residente y administrador en la portada, el número de '
        + 'contrato, y los dos nombres del pie',
      `${declaradas.length} declaración(es) en las páginas `
        + `${[...new Set(declaradas.map((d) => d.pagina))].join(', ') || '—'}`);
  }

  // ═══ §3 · EL DINERO DE UN RUBRO NO SE MUDA AL DE AL LADO ═════════════════
  //
  // La expresión que está EN EL `key=` de cada lista de rubros, sacada del
  // sitio donde vive y EJECUTADA. No se mira el texto del archivo: se agrupa
  // el dinero de la 0112 con esa expresión y se compara cada cubeta contra el
  // total del rubro que la base publica.
  const astApp = parse(fuenteApp, OPTS);
  const clavesEnElSitio = [];
  traverse(astApp, {
    CallExpression(p) {
      const c = p.node.callee;
      if (c.type !== 'MemberExpression') return;
      if (c.object.name !== 'rubrosOrdenados' || c.property.name !== 'map') return;
      const fn = p.node.arguments[0];
      if (!fn) return;
      let expr = null;
      p.get('arguments.0').traverse({
        JSXAttribute(q) {
          if (expr || q.node.name.name !== 'key') return;
          const v = q.node.value;
          if (!v || v.type !== 'JSXExpressionContainer') return;
          expr = fuenteApp.slice(v.expression.start, v.expression.end);
        },
      });
      if (expr) clavesEnElSitio.push({ expr, linea: p.node.loc.start.line });
    },
  });

  if (clavesEnElSitio.length < 2)
    noArranco([`sólo se hallaron ${clavesEnElSitio.length} listas `
      + '`rubrosOrdenados.map(…)` con un `key=`; se esperaban las dos (el '
      + 'desglose del resumen y el análisis detallado)'],
    path.relative(RAIZ, ARCH_APP));

  // Se compila con `claveDeRubro` disponible y `r` como el rubro. Lo que la
  // expresión use y nadie dé, estalla: un `undefined` silencioso daría claves
  // todas iguales y el banco se pondría rojo por el motivo equivocado.
  const compilar = ({ expr, linea }) => {
    const libres = libresDe(`const __k = (r) => (${expr});`);
    const dados = { claveDeRubro, r: undefined };
    const sinDar = libres.filter((n) => n !== 'r' && !(n in dados));
    if (sinDar.length)
      sinPrecondicion(`la clave de la lista de la línea ${linea} usa `
        + `${sinDar.map((n) => `\`${n}\``).join(', ')} y el banco no sabe qué pasarle`,
      ['Compilarla con eso en `undefined` daría claves iguales para todo y el',
       'banco se pondría rojo sin haber medido nada.']);
    return new Function('claveDeRubro', 'r', `"use strict";\nreturn (${expr});`)
      .bind(null, claveDeRubro);
  };

  const listas = clavesEnElSitio.map((c) => ({ ...c, clave: compilar(c) }));

  for (const { linea, clave } of listas) {
    // (a) Cinco rubros, cinco claves. Con `r.id` serían cuatro.
    const claves = RUBROS_0112.map((r) => String(clave(r)));
    const distintas = new Set(claves);
    check(distintas.size === RUBROS_0112.length,
      `la lista de rubros de la línea ${linea} da una clave propia a cada rubro de la 0112`,
      `${RUBROS_0112.length} claves distintas`,
      `${distintas.size}: ${[...distintas].join(' · ')}`);

    // (b) Y el dinero. Agrupado por esa clave, cada cubeta tiene que valer lo
    // que la base dice del rubro. Es la aserción que importa: con `r.id`, la
    // cubeta «300» vale $5,456,992.22 — los $4.15M de indirectos con el
    // $1.31M de subcontratos dentro.
    const cubetas = new Map();
    for (const r of RUBROS_0112) {
      const k = String(clave(r));
      cubetas.set(k, (cubetas.get(k) || 0) + r.grandTotal);
    }
    const mudado = RUBROS_0112.filter((r) =>
      Math.abs(cubetas.get(String(clave(r))) - r.grandTotal) > 0.005);
    check(mudado.length === 0,
      `agrupado por la clave de la línea ${linea}, ningún rubro de la 0112 absorbe el de al lado`,
      'cada cubeta vale exactamente el total que publica la base',
      mudado.length
        ? mudado.map((r) => `${r.nombre}: ${r.grandTotal.toFixed(2)} → `
            + cubetas.get(String(clave(r))).toFixed(2)).join(' · ')
        : 'las cinco cuadran');
  }

  // (c) Las dos listas tienen que coincidir. Si una agrupa distinto que la
  // otra, la misma obra publica dos desgloses a un clic de distancia.
  const discrepan = RUBROS_0112.filter((r) =>
    new Set(listas.map(({ clave }) => String(clave(r)))).size !== 1);
  check(discrepan.length === 0,
    'las dos listas de rubros agrupan igual: una obra no publica dos desgloses distintos',
    'la misma clave para el mismo rubro en las dos pestañas',
    discrepan.length
      ? discrepan.map((r) => `${r.nombre}: `
          + listas.map(({ clave }) => `«${clave(r)}»`).join(' ≠ ')).join(' · ')
      : 'coinciden en los cinco');

  // ═══ §4 · LA TABLA DE RUBROS DEL PDF ═════════════════════════════════════
  //
  // El mismo dinero, en la hoja que se entrega. El servidor ya indexa por
  // etiqueta completa, así que los dos 300 llegan como dos entradas; lo que se
  // afirma es que salen como DOS renglones con sus dos montos.
  const gpDetalle = {
    grandTotal: RUBROS_0112.reduce((t, r) => t + r.grandTotal, 0),
    rubros: Object.fromEntries(RUBROS_0112.map((r) => [r.nombre,
      { ...r, proveedores: [], semanas: {}, meses: {}, años: {} }])),
    proveedores: [],
  };
  let hoja;
  try {
    hoja = await dibujarPDF(generarPDFObra, {},
      { ...OBRA_0127, id: '0112', presupuesto: 38500000 },
      { gpDetalle, instante: { ms: Date.UTC(2026, 10, 9, 18, 0, 0), fuente: 'servidor' } });
  } catch (e) {
    sinPrecondicion('el PDF con el detalle de rubros no se pudo dibujar',
      [e.message.split('\n')[0]]);
  }
  const enHoja = hoja.map((d) => d.texto);

  // El espacio fino que mete el formateador de moneda no es un carácter que
  // nadie teclee, así que se normaliza en los dos lados de la comparación.
  const plano = (t) => String(t).replace(/\s/gu, '');
  const dice = (v) => enHoja.some((t) => plano(t) === plano(v));

  for (const r of [RUBROS_0112[2], RUBROS_0112[3]]) {
    const monto = MXN(r.grandTotal);
    check(enHoja.includes(r.nombreCorto) && dice(monto),
      `la hoja imprime «${r.nombreCorto}» con su propio monto`,
      `«${r.nombreCorto}» y «${monto}»`,
      `${enHoja.includes(r.nombreCorto) ? 'el rótulo sí' : 'el rótulo NO'} · `
        + `${dice(monto) ? 'el monto sí' : 'el monto NO'}`);
  }

  // Y la suma de los dos 300 NO puede aparecer en ninguna parte: es la cifra
  // que sale cuando se agrupa por el número, y verla impresa sería el defecto
  // en la hoja que se firma.
  const fundidoMXN = MXN(RUBROS_0112[2].grandTotal + RUBROS_0112[3].grandTotal);
  check(!dice(fundidoMXN),
    'la suma de los dos rubros que comparten el 300 no se imprime en ninguna parte',
    `cero apariciones de «${fundidoMXN}»`,
    `${enHoja.filter((t) => plano(t) === plano(fundidoMXN)).length} aparición(es)`);

  console.log('');
  if (fallas) {
    console.log(`${fallas} comprobación(es) en rojo.`);
    process.exit(1);
  }
  console.log('La hoja declara lo que no tiene, y el dinero de cada rubro se queda en su columna.');
})();
