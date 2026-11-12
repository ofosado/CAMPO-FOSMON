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
//   §2  LOS DOS PAPELES enteros —el informe del Art. 73 que se entrega y el
//       documento interno—, dibujados sobre el lienzo falso, con el alta de la
//       0127 (residente y admin vacíos) y con la de la 0128 («N/A» en los
//       dos). Se mira QUÉ TEXTO sale AL LADO DE QUÉ ETIQUETA: la posición es la
//       afirmación. Y se mira lo que NO sale: ninguno de los dos rotula un
//       cargo de obra, así que el nombre del superintendente no aparece en
//       ninguna parte y no hay renglón donde pueda caer prestado.
//   §3  La expresión que está EN EL `key=` de las dos listas de rubros, sacada
//       por AST del sitio donde vive y ejecutada contra los cinco rubros reales
//       de la 0112. No se mira el texto del archivo: se agrupa el dinero con
//       esa expresión y se compara cada cubeta contra el total del rubro.
//   §4  La tabla de rubros del documento interno, con el detalle de la 0112:
//       los dos 300 tienen que salir como dos renglones con sus dos montos. El
//       informe del Art. 73 no recibe el detalle del gasto, así que no tiene
//       esa tabla que mirar.
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
// El módulo ES la función; las otras tres puertas son propiedades suyas.
// Destructurar `noArranco` de ahí lo deja en `undefined` sin ruido.
const noArranco = require('./no-arranco.cjs');
const { vigilarExcepciones, sinPrecondicion } = noArranco;
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');
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
    // EL PIE DE FIRMAS, DE VUELTA. El anclaje viejo —`[comoSeImprime(
    // obra.residente),'Residente de Obra','Elaboró']`— se fue con
    // `generarPDFObra`, así que esta mutación ya no puede quitarle una guarda:
    // tiene que PONER el pie. Es la forma realista de la regresión, porque la
    // tentación es exactamente ésa —«al documento le faltan las firmas»— y
    // quien la siga tiene a mano el `||` que la aplicación ya usa en la
    // pantalla de alta. Entra justo antes del renglón que explica por qué no
    // las hay, para que el papel se contradiga como se contradiría de verdad.
    ['alguien le repone el pie de firmas y vuelve a prestar al superintendente',
      (t) => t.replace(
        "  y = nota('Este informe no lleva renglones de firma porque el sistema no conoce los cargos '",
        "  [[obra?.residente || obra?.superintendente || 'Residente',\n"
        + "    'Residente de Obra', 'Elaboró']].forEach(([n, c, v], i) => {\n"
        + '    T(String(n), ML + i * 70, y + 10); T(c, ML + i * 70, y + 14);\n'
        + '    T(v, ML + i * 70, y + 18);\n'
        + '  });\n'
        + "  y = nota('Este informe no lleva renglones de firma porque el sistema no conoce los cargos '")],
    // Las dos de la identificación van con `/g`: el bloque se armó una vez por
    // papel, y una mutación que tocara sólo el primero diría que el banco
    // cubre los dos cuando cubre uno.
    ['«Contrato:» se rellena con la descripción de la obra',
      (t) => t.replace(/ {4}\['Contrato:', contr\.numero \?\? NO_CAPTURADO\],/g,
        "    ['Contrato:', comoSeImprime(obra?.contrato)],")],
    ['el objeto de la obra se tira en vez de rotularse aparte',
      (t) => t.replace(/ {4}\.\.\.\(contr\.objeto \? \[\['Objeto:', contr\.objeto\]\] : \[\]\),\n/g,
        '')],
    ['los rubros se vuelven a agrupar por el número de tres dígitos',
      (t) => t.replace(/key=\{claveDeRubro\(r\)\}/g, 'key={r.id}')],
    // El campo fantasma. Antes la portada tenía un renglón de `ubicacion` con
    // una guarda, y la mutación le quitaba la guarda. Los papeles nuevos no lo
    // tienen en ninguna forma, así que ahora la mutación lo AÑADE: es lo que
    // haría quien lea el modelo de la pantalla de alta y suponga que el campo
    // existe. La hoja terminaría reclamándole al usuario un dato que ningún
    // formulario le ofrece capturar.
    ['la identificación le abre renglón a un campo que la aplicación nunca ofrece',
      (t) => t.replace(/ {4}\['Organización:', comoSeImprime\(organizacion\)\],/g,
        "    ['Ubicación:', comoSeImprime(obra?.ubicacion)],\n"
        + "    ['Organización:', comoSeImprime(organizacion)],")],
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
    'NO_CAPTURADO', 'claveDeRubro', 'generarPDFArt73', 'generarPDFInterno', 'MXN'],
  { tolerante: true });
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
  generarPDFArt73, generarPDFInterno, MXN;
try {
  textoCapturado = armar('textoCapturado');
  comoSeImprime = armar('comoSeImprime');
  contratoCapturado = armar('contratoCapturado');
  NO_CAPTURADO = armar('NO_CAPTURADO');
  claveDeRubro = armar('claveDeRubro');
  generarPDFArt73 = armar('generarPDFArt73');
  generarPDFInterno = armar('generarPDFInterno');
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

  // ═══ §2 · LOS DOS DOCUMENTOS: QUÉ SALE AL LADO DE QUÉ ETIQUETA ═══════════
  //
  // Dibujados de verdad sobre el lienzo falso. Lo que se mira es la POSICIÓN:
  // un `includes` sobre el documento entero se cumpliría con cualquier renglón
  // que mencione lo mismo por otra razón.
  //
  // DOS PAPELES DESDE EL 2026-11-12, Y NINGUNO LLEVA PIE DE FIRMAS.
  // `generarPDFObra` se retiró; quedan `generarPDFArt73` —el que se entrega— y
  // `generarPDFInterno`. Los dos se miran, porque la identificación se armó dos
  // veces y un `|| ''` que vuelva puede volver en una sola.
  //
  // Y EL PIE DE FIRMAS NO EXISTE YA EN NINGUNO DE LOS DOS. Este banco nació
  // porque ese pie imprimía al superintendente bajo «Residente de Obra ·
  // Elaboró». Al partir el papel se decidió algo más fuerte que arreglar el
  // `||`: no imprimir cargos. El informe del Art. 73 lo DICE —«no lleva
  // renglones de firma porque el sistema no conoce los cargos de quien lo
  // suscribe»—, y quién firma lo define el expediente de cada dependencia.
  //
  // Eso cambia dos aserciones viejas y hay que decir cuáles, porque las dos
  // afirmaban lo contrario de lo que afirma este corte:
  //
  //   · «bajo Superintendente de Obra firma el superintendente» se RETIRA. Ese
  //     renglón ya no se imprime. Lo que ocupa su lugar es más fuerte y se
  //     afirma abajo: el nombre del superintendente no sale en NINGUNA parte de
  //     ninguno de los dos papeles, así que no hay renglón donde pueda caer
  //     prestado. No se le busca anclaje parecido: afirmar sobre otro renglón
  //     con el nombre de esa aserción sería cambiarle el sujeto.
  //   · «las tres casillas de firma siguen ahí para firmarse a mano» se RETIRA
  //     por lo mismo, y con ella el motivo que la sostenía. Se cambió de
  //     decisión: una casilla rotulada con un cargo que la organización no
  //     capturó inventa el puesto aunque el nombre vaya en blanco.
  const dibujarCon = async (generar, obra) => {
    try {
      return await dibujarPDFInterno(generar, { obra, subs: [],
        instante: { ms: Date.UTC(2026, 10, 9, 18, 0, 0), fuente: 'servidor' } });
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

  // Los cargos que el pie retirado rotulaba, y los verbos de sus casillas. Se
  // buscan para afirmar que NO están: mientras exista el catálogo de roles en
  // la aplicación, estas cadenas pueden volver a una hoja por copia.
  const CARGOS = ['Residente de Obra', 'Administrador de Obra', 'Superintendente de Obra'];
  const VERBOS = ['Elaboró', 'Revisó', 'Vo.Bo.'];

  const PAPELES = [['el informe del Art. 73', generarPDFArt73],
    ['el documento interno', generarPDFInterno]];

  for (const [papel, generar] of PAPELES) {
    for (const [etiqueta, obra] of [['0127, sin capturar', OBRA_0127],
      ['0128, con «N/A» tecleado', OBRA_0128]]) {
      const donde = `${papel} de la ${etiqueta}`;
      const dib = await dibujarCon(generar, obra);
      if (dib.length < 20)
        sinPrecondicion(`${donde} sólo dibujó ${dib.length} textos`,
          ['Con el dibujo casi vacío cualquier «no aparece» se cumple por vacío.']);
      const textos = dib.map((d) => String(d.texto));

      // (a) El contrato. En las dos obras `contrato` trae prosa, así que el
      // número se declara ausente Y el objeto sale con su propia etiqueta.
      const vCon = valorJuntoA(dib, 'Contrato:');
      if (vCon.falta)
        sinPrecondicion(`no se halló la etiqueta «Contrato:» en la identificación de ${donde}`,
          ['Sin la etiqueta no hay renglón que mirar.']);
      check(vCon.textos.includes(NO_CAPTURADO),
        `${donde}: el número de contrato se declara ausente y no se tapa con la descripción`,
        `«${NO_CAPTURADO}» al lado de «Contrato:»`,
        vCon.textos.map((t) => `«${String(t).slice(0, 40)}»`).join(' · ') || 'nada');

      const vObj = valorJuntoA(dib, 'Objeto:');
      const esperaObjeto = contratoCapturado(obra.contrato).objeto;
      check(!vObj.falta && vObj.textos.some((t) => String(t).startsWith(String(esperaObjeto).slice(0, 30))),
        `${donde}: la descripción capturada sale rotulada como objeto de la obra`,
        `«${String(esperaObjeto).slice(0, 30)}…» bajo «Objeto:»`,
        vObj.falta ? 'no hay renglón de objeto' : vObj.textos.map((t) => `«${String(t).slice(0, 34)}»`).join(' · '));

      // (b) NINGÚN CARGO ATRIBUIDO A NADIE. Es el corte entero dicho en una
      // aserción: sin renglón de cargo no hay renglón donde un nombre pueda
      // caer prestado, y el nombre que caía era el del superintendente.
      const cargos = textos.filter((t) => CARGOS.includes(t));
      check(cargos.length === 0,
        `${donde}: no rotula ningún cargo de obra`,
        'cero apariciones de «Residente de Obra», «Administrador de Obra» y «Superintendente de Obra»',
        cargos.join(' · ') || 'ninguna');
      const verbos = textos.filter((t) => VERBOS.includes(t));
      check(verbos.length === 0,
        `${donde}: no abre casillas de firma`,
        'cero apariciones de «Elaboró», «Revisó» y «Vo.Bo.»',
        verbos.join(' · ') || 'ninguna');
      const super_ = textos.filter((t) => t.includes(obra.superintendente));
      check(super_.length === 0,
        `${donde}: el nombre del superintendente no se imprime en ninguna parte`,
        `cero apariciones de «${obra.superintendente}»`,
        super_.length ? `${super_.length} en «${String(super_[0]).slice(0, 40)}»` : 'ninguna');

      // (c) Y EL RELLENO TECLEADO NO LLEGA A LA HOJA. En la 0128 «N/A» está en
      // `residente` y en `admin`, que ya no se imprimen; lo que se afirma es
      // que ningún campo lo publica como si fuera un valor.
      const naSuelto = textos.filter((t) => t.trim() === 'N/A');
      check(naSuelto.length === 0,
        `${donde}: ningún renglón publica «N/A» como valor capturado`,
        'cero renglones que digan sólo «N/A»',
        `${naSuelto.length} renglón(es)`);

      // (d) LA CUENTA DE LAS AUSENCIAS, Y AL LADO DE QUÉ ETIQUETAS. El
      // documento declara exactamente las que tiene etiqueta para declarar:
      // el número de contrato, la organización y quién lo generó. Tres.
      //
      // Ni una más, y aquí está lo que se defendía con `ubicacion`: ese campo
      // no existe en el modelo, ningún formulario lo escribe, y la hoja NO le
      // pone renglón. Declarar «(no capturado)» junto a una etiqueta
      // «Ubicación:» sería reclamarle al usuario un campo que la aplicación no
      // le ofrece. La cuenta es la que lo sostiene: un renglón nuevo para un
      // campo fantasma la mueve.
      const declaradas = dib.filter((d) => d.texto === NO_CAPTURADO);
      const junto = declaradas.map((d) => {
        const lbl = dib.filter((q) => q.pagina === d.pagina && q.y === d.y && q.x < d.x)
          .sort((p, q) => q.x - p.x)[0];
        return lbl ? String(lbl.texto) : '—';
      });
      const esperadas = ['Contrato:', 'Organización:', 'Generado por:'];
      check(declaradas.length === esperadas.length
        && esperadas.every((e) => junto.includes(e)),
      `${donde}: declara las tres ausencias que sabe rotular, y ni una más`,
      `3 declaraciones, junto a ${esperadas.join(' · ')}`,
      `${declaradas.length} declaración(es) junto a ${junto.join(' · ') || '—'}`);
    }
  }

  // (e) Y EL PAPEL QUE SE ENTREGA DICE POR QUÉ NO TRAE FIRMAS. Un documento
  // oficial sin renglón de firma, y sin decir por qué, se lee como un documento
  // incompleto; dicho, es una decisión. Quién lo firma lo define el expediente
  // de cada dependencia, y el sistema no conoce esos cargos.
  const art73 = await dibujarCon(generarPDFArt73, OBRA_0127);
  const declara = art73.map((d) => String(d.texto))
    .some((t) => /no lleva renglones de firma porque el sistema no conoce los cargos/.test(t));
  check(declara,
    'el informe del Art. 73 dice por qué no lleva renglones de firma',
    'el renglón que explica que el sistema no conoce los cargos de quien lo suscribe',
    declara ? 'lo dice' : 'no lo dice');

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

  // ═══ §4 · LA TABLA DE RUBROS DEL DOCUMENTO INTERNO ═══════════════════════
  //
  // El mismo dinero, en la hoja que lo lleva. El servidor ya indexa por
  // etiqueta completa, así que los dos 300 llegan como dos entradas; lo que se
  // afirma es que salen como DOS renglones con sus dos montos.
  //
  // VA SOBRE EL DOCUMENTO INTERNO Y NO SOBRE EL QUE SE ENTREGA, porque el
  // informe del Art. 73 no recibe `gpDetalle`: el gasto del contratista no es
  // de la dependencia. La frontera es de otros bancos; aquí sólo se mira el
  // papel que sí publica el desglose.
  const gpDetalle = {
    grandTotal: RUBROS_0112.reduce((t, r) => t + r.grandTotal, 0),
    rubros: Object.fromEntries(RUBROS_0112.map((r) => [r.nombre,
      { ...r, proveedores: [], semanas: {}, meses: {}, años: {} }])),
    proveedores: [],
  };
  let hoja;
  try {
    hoja = await dibujarPDFInterno(generarPDFInterno, {
      obra: { ...OBRA_0127, id: '0112', presupuesto: 38500000 }, subs: [], gpDetalle,
      instante: { ms: Date.UTC(2026, 10, 9, 18, 0, 0), fuente: 'servidor' } });
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
