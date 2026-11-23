#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA MARCA SE LEE, NO SE TECLEA — PENDIENTES #43
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ HABÍA. Tres correos nuevos leían la marca de
// `orgs/{oid}/config/branding` (`marcaDeOrg`), y al lado, el correo del lunes
// y la portada del PDF la **tecleaban**: «CAMPO · FOSMON CONSTRUCCIONES» en el
// encabezado del resumen, «CAMPO — FOSMON Construcciones» en su pie, y en la
// portada del PDF una copia más junto a un `B.dominio` que se calculaba y no
// se usaba. El marco de cada página del mismo PDF sí la leía (`B.empresa`), así
// que un solo documento podía firmar con dos nombres distintos.
//
// POR QUÉ IMPORTA MÁS QUE UN RENOMBRE. `orgDeLaRaiz` ya resuelve de quién son
// las obras, así que el día que el resumen salga para una dependencia saldría
// firmado por su contratista. Es el #39 entrando por el nombre en vez de por
// el dinero, y la primera vez que se vio fue el 2026-10-01: el encabezado de
// la app le presentaba el producto al municipio como si fuera de FOSMON.
//
// Y la sonda encontró uno que `grep` no podía ver como marca: debajo del
// nombre de la obra, en el renglón de la UBICACIÓN, un
// `obra.ubicacion || 'FOSMON Construcciones'`. Con una marca ajena eso ponía
// el nombre del contratista en la portada del cliente, y en el sitio donde el
// lector espera un lugar. Un dato inventado, no sólo una firma vieja.
//
// ── CÓMO CAMBIÓ EL LADO DEL PDF EL 2026-11-12 ─────────────────────────────
//
// `generarPDFObra` se retiró y el papel se partió en dos: `generarPDFArt73`,
// el informe que se entrega a la dependencia, y `generarPDFInterno`, el
// documento de la constructora. Con la partición se fue el parámetro
// `branding` de los dos: ningún papel recibe ya la marca de la organización.
//
// Eso cambia lo que hay que vigilar, y tres afirmaciones de este banco se
// quedaron SIN SITIO. Se retiran con su motivo en vez de buscarles un anclaje
// parecido, que convertiría una afirmación sobre la portada en otra sobre algo
// distinto con el nombre de la vieja:
//
//   · «la portada imprime la marca recibida» — no hay marca que recibir. Lo
//     que el papel firma ahora es el PRODUCTO, igual para toda organización.
//   · «la portada imprime el dominio recibido» — el pie imprime la cara
//     pública siempre, y eso lo mide y lo muta
//     `prueba-las-dos-direcciones-del-producto`, que es su dueño.
//   · «la ubicación vacía se rellena con el nombre de la empresa» — el renglón
//     de la ubicación ya no existe en ningún papel. Medido: `obra.ubicacion`
//     no aparece en `src/App.jsx`.
//
// Lo que las sustituye es la forma que el defecto tiene HOY: el nombre de la
// organización llega al papel como un CAMPO DE IDENTIFICACIÓN, y el papel no
// se firma con él. Con una organización ajena puesta, el pie de todas las
// páginas tiene que seguir diciendo el producto y no el nombre de nadie — y
// cuando no hay organización, el hueco se declara en vez de rellenarse.
//
// CÓMO MIDE. No busca cadenas en el archivo: **ejecuta**. El correo sale de
// `buildEmailHTML` extraído de `functions/index.js`, y los dos papeles de
// `src/App.jsx`, movidos con un jsPDF falso que anota cada texto que se manda
// dibujar. Lo que se afirma es lo que quedaría impreso, que es lo único que el
// cliente ve.
//
// Contraprueba:  node scripts/prueba-la-marca-se-lee-no-se-teclea.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
// `no-arranco.cjs` EXPORTA LA FUNCIÓN, y las otras tres puertas son propiedades
// suyas. Destructurar `noArranco` de ahí da `undefined`, y el banco no revienta
// al requerir: revienta con un `TypeError` el día que un símbolo se renombre,
// o sea exactamente el día que esta puerta tenía que decir «no pude mirar».
const noArranco = require('./no-arranco.cjs');
const { vigilarExcepciones, sinPrecondicion } = noArranco;
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
// El jsPDF falso vive aparte: lo comparte con el banco de la dirección.
const { dibujarPDFInterno } = require('./lienzo-pdf.cjs');

vigilarExcepciones('functions/index.js y src/App.jsx');

const RAIZ = path.join(__dirname, '..');
// La contraprueba apunta estos dos a copias mutadas.
const ARCH_FN = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');

// ── Sacar las dos piezas de sus archivos ────────────────────────────────────
const PIDE_FN = ['correoResumenSemanal', 'correoBienvenida'];
const PIDE_APP = ['generarPDFArt73', 'generarPDFInterno'];

let FN, APP;
try {
  FN = fuenteDe(ARCH_FN, PIDE_FN, { tolerante: true });
  APP = fuenteDe(ARCH_APP, PIDE_APP, { tolerante: true });
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, `${ARCH_FN} / ${ARCH_APP}`);
  throw e;
}
if (FN.faltan.length) noArranco(FN.faltan, ARCH_FN);
if (APP.faltan.length) noArranco(APP.faltan, ARCH_APP);

// `APP_URL` y `ESC_HTML` los declara el cierre extraído; `MXN_FMT`, `PCT_FMT`,
// `semaforoColor` y los dos bloques también. Lo único que se inyecta es lo que
// el cierre NO trae, y nada que este banco quiera afirmar.
const armarFN = (expresion) => new Function(
  `"use strict";\n${FN.cuerpo}\nreturn (${expresion});`
)();
const armarAPP = (expresion) => new Function(
  'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  `"use strict";\n${APP.cuerpo}\nreturn (${expresion});`
)(...Array(6).fill(() => {}));

let correoResumenSemanal, correoBienvenida, generarPDFArt73, generarPDFInterno, APP_URL;
try {
  correoResumenSemanal = armarFN('correoResumenSemanal');
  correoBienvenida = armarFN('correoBienvenida');
  generarPDFArt73 = armarAPP('generarPDFArt73');
  generarPDFInterno = armarAPP('generarPDFInterno');
  APP_URL = armarFN('APP_URL');
} catch (e) {
  sinPrecondicion('no se pudo montar el código extraído',
    [e.message.split('\n')[0],
     'Sin poder EJECUTAR el armado no hay nada que afirmar: mirar el texto del',
     'archivo sería comprobar que una cadena está escrita, no que se imprime.']);
}

// ── Los insumos ─────────────────────────────────────────────────────────────
// Una marca AJENA a propósito. Si el código tiene «FOSMON» tecleado en algún
// sitio, con esta marca puesta salta a la vista: el documento diría dos nombres.
const MARCA_AJENA = {
  empresa: 'Gobierno del Estado de Veracruz',
  empresaCorta: 'Veracruz',
  dominio: 'obras.veracruz.gob.mx',
};
const KPIS = [{
  obraId: 'OB-2026-000001', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001',
  presupuesto: 12000000, totGasto: 7000000, cobrado: 5000000, totGP: 6000000,
  avanceFisico: 42, mpct: 18.3, diff: 900000, diasDesdeCaptura: 3, estPorCob: 1200000,
}];
const REPARTO = { dentro: [{ email: 'd@x.mx' }], sinOrg: [], deOtra: [] };
const CORTE = 'lunes, 2 de noviembre de 2026';

const correoDelLunes = (marca) =>
  correoResumenSemanal(KPIS, CORTE, { total: 0 }, REPARTO, marca);

// La DIRECCIÓN de la app no es una firma, y hoy contiene la palabra «fosmon»
// (`campo-fosmon.netlify.app`). Barrer el correo entero en busca de «FOSMON»
// acusaría al encabezado de algo que está en el enlace, que es otra pelea y se
// mide en su propia rama. Así que se quitan los enlaces —con esquema y sin él,
// porque el pie imprime el host pelado— y se barre lo que queda, que es donde
// de verdad se firma. Sale de `APP_URL` y no de una cadena tecleada aquí: el
// día que la dirección cambie, esto sigue acotando lo mismo.
const HOST_APP = String(APP_URL).replace(/^https?:\/\//, '');
const sinEnlaces = (t) => String(t)
  .split(String(APP_URL)).join('')
  .split(HOST_APP).join('');

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
//
// Se vuelve a teclear lo que acaba de pasar a leerse, en las formas en que
// estaba escrito de verdad antes del arreglo. Si alguna no se ve, el banco no
// cubre lo que dice.
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_FUNCIONES || process.env.ARCH_APP)
    sinPrecondicion('la contraprueba corriendo sobre copias ya mutadas',
      ['Se invocó con ARCH_FUNCIONES o ARCH_APP puesto. Eso mutaría lo mutado.']);

  const MUTACIONES = [
    // REANCLADA el 2026-11-20. El encabezado del lunes dejó de ser una franja
    // negra con la palabra «cotea» en texto y pasó a llevar el LOGO, así que el
    // anclaje viejo —`>cotea${firma…}</div>`— se quedó sin aplicar. El portón
    // de anclajes rancios lo dijo el mismo día, que es para lo que está. El
    // anclaje nuevo va pegado al título «Resumen semanal» porque el renglón de
    // la firma, él solo, ahora aparece DOS veces en el archivo —este sobre y el
    // de los avisos— y `replace` con una cadena toca nada más la primera.
    ['FN', 'el encabezado del lunes vuelve a teclear la marca',
      (t) => t.replace('${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}\n          <div style="font-size:23px;',
        '<div style="font-size:10px;">CAMPO · FOSMON CONSTRUCCIONES</div>\n          <div style="font-size:23px;')],
    // REANCLADA el 2026-11-07. El pie imprimía el host de `APP_URL` y el
    // anclaje lo llevaba dentro; al partir la dirección en dos —`APP_URL` para
    // la app y `SITIO_PUBLICO` para la cara pública— el pie pasó a imprimir el
    // segundo y la mutación se quedó SIN APLICAR, o sea el banco llevaba
    // semanas cubriendo 7 de 8 sin decirlo en verde, porque la suite sólo corre
    // el modo normal. El anclaje se queda en la parte que esta mutación de
    // verdad niega —leer `casa` en vez de teclear la empresa— y no en la
    // dirección, que es otra pelea.
    ['FN', 'el pie del lunes vuelve a teclear la empresa',
      (t) => t.replace('cotea${casa ? ` — ${casa}` : ""} · ',
        'CAMPO — FOSMON Construcciones · ')],
    ['FN', 'sin marca, el lunes se firma con FOSMON de todos modos',
      (t) => t.replace("const firma = marca?.empresa ? ESC_HTML(marca.empresa).toUpperCase() : \"\";",
        "const firma = marca?.empresa ? ESC_HTML(marca.empresa).toUpperCase() : \"FOSMON CONSTRUCCIONES\";")],
    ['FN', 'el asunto del lunes vuelve a decir CAMPO',
      (t) => t.replace('const subject = `cotea · Resumen semanal',
        'const subject = `CAMPO · Resumen semanal')],
    ['FN', 'el botón del lunes vuelve a decir «Abrir CAMPO»',
      (t) => t.replace('>Abrir cotea</a>', '>Abrir CAMPO</a>')],
    // LAS TRES MUTACIONES DEL PDF SE REEMPLAZAN POR DOS, el 2026-11-12. Las
    // viejas apuntaban a `B.empresa`, `B.dominio` y `obra.ubicacion`, que ya no
    // existen en ningún papel (ver el encabezado). Lo que queda para mutar es la
    // firma del pie de cada papel: es el único sitio donde el documento dice de
    // quién es, y es el sitio donde la empresa estaba tecleada antes. Un anclaje
    // por papel, una copia cada uno —medido—, así que sin `/g` a propósito.
    // REANCLADA el 2026-11-23: el papel dejó de llamarse «documento interno» y
    // es el reporte de avance de obra. Lo que la mutación niega no cambió —que
    // el pie firme con una empresa tecleada en vez de con el papel—.
    ['APP', 'el pie del reporte de avance vuelve a firmar con la empresa',
      (t) => t.replace("pieIzq: 'cotea · reporte de avance de obra' });",
        "pieIzq: 'cotea · FOSMON Construcciones' });")],
    ['APP', 'el pie del informe del Art. 73 vuelve a firmar con la empresa',
      (t) => t.replace("pieIzq: 'cotea · informe de avance' });",
        "pieIzq: 'cotea · FOSMON Construcciones' });")],
  ];

  let vistas = 0;
  for (const [cual, nombre, romper] of MUTACIONES) {
    const origen = cual === 'FN' ? ARCH_FN : ARCH_APP;
    const antes = fs.readFileSync(origen, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}  ·  el ancla ya no está en ${path.basename(origen)}`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-marca-'));
    const copia = path.join(dir, path.basename(origen));
    fs.writeFileSync(copia, despues);
    const r = noArranco.hijoConPlazo(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, [cual === 'FN' ? 'ARCH_FUNCIONES' : 'ARCH_APP']: copia },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const rojas = (salida.match(/^FALLA/gm) || []).length;
    const vio = r.status === 1 && rojas > 0;
    console.log(`${vio ? `ROJA ×${rojas}`.padEnd(12) : 'NO LA VE    '} ${nombre}`
      + (vio ? '' : `  ·  salió ${r.status}`
        + (r.status === 2 ? ' (el banco se cayó, que no es lo mismo que ver el defecto)' : '')));
    if (vio) vistas++;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: el banco no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── Las comprobaciones ──────────────────────────────────────────────────────
console.log('\n── La marca se lee, no se teclea ──');
console.log(`correo: ${path.relative(RAIZ, ARCH_FN)} · pdf: ${path.relative(RAIZ, ARCH_APP)}\n`);

let fallas = 0, oks = 0;
const ok = (q) => { oks++; console.log(` ok   ${q}`); };
const falla = (q, esp, obt) => {
  fallas++; console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esp}`);
  console.log(`        obtuvo:   ${obt}`);
};

(async () => {

const lunesAjeno = correoDelLunes(MARCA_AJENA);
const { html: htmlAjeno } = lunesAjeno;
const { html: htmlSinMarca } = correoDelLunes({ empresa: '', empresaCorta: '' });
const firmaAjena = sinEnlaces(htmlAjeno);
const firmaSinMarca = sinEnlaces(htmlSinMarca);

// Sin esto, un `correoResumenSemanal` que devolviera "" pasaría todas las
// comprobaciones de abajo por no contener nada.
if (!/Resumen semanal/.test(htmlAjeno) || htmlAjeno.length < 1500)
  sinPrecondicion('el correo del lunes salió vacío o sin su título',
    [`${htmlAjeno.length} caracteres`,
     'Si el armado no produce el correo, «no dice FOSMON» se cumple por vacío.']);

// §1. El correo del lunes firma con la marca que se le dio, no con una propia.
if (firmaAjena.includes(MARCA_AJENA.empresa.toUpperCase())
  && !/FOSMON/i.test(firmaAjena))
  ok('el correo del lunes firma con la marca leída, y no se le escapa FOSMON');
else falla('el correo del lunes firma con la marca leída',
  `«${MARCA_AJENA.empresa.toUpperCase()}» y ningún FOSMON`,
  (firmaAjena.includes(MARCA_AJENA.empresa.toUpperCase()) ? 'la marca sí está, pero ' : 'la marca NO está; ')
  + (/FOSMON/i.test(firmaAjena) ? `y se le escapó: «${(firmaAjena.match(/.{0,28}FOSMON.{0,20}/i) || [])[0]}»` : 'sin FOSMON'));

// §2. Sin marca no se firma con nadie. Es el criterio de `marcaDeOrg`: un
// correo sin firma es mejor que uno firmado por la empresa equivocada. Y el
// producto sigue nombrándose, que es cierto para cualquier organización.
if (!/FOSMON/i.test(firmaSinMarca) && /cotea/.test(firmaSinMarca))
  ok('una organización sin marca recibe el correo sin firma, pero con el producto');
else falla('una organización sin marca recibe el correo sin firma',
  'ningún FOSMON, y «cotea» presente',
  /FOSMON/i.test(firmaSinMarca)
    ? `se firmó solo: «${(firmaSinMarca.match(/.{0,28}FOSMON.{0,20}/i) || [])[0]}»`
    : 'tampoco dice cotea: el correo se quedó sin nombre de producto');

// §3. «CAMPO» como nombre del producto ya no sale en ningún correo. Se mira en
// mayúsculas y con frontera de palabra a propósito: `campo-fosmon.netlify.app`
// va en minúsculas y es el dominio, otra pelea (ver la rama del dominio), y
// «captura en campo» es castellano, no una marca.
const bienvenida = correoBienvenida({
  marca: MARCA_AJENA, nombre: 'Ana', email: 'a@x.mx', password: 'kR7qmTzv4Ays',
  rol: 'residente', rolLabel: 'Residente de Obra', obras: ['MALECON'], dioElAlta: 'o@x.mx',
});
// El asunto del lunes entra aquí porque ES lo que se lee sin abrir el correo.
// Lo arma el mismo que arma el cuerpo —antes se tecleaba en el envío, fuera del
// alcance de este barrido—, así que la bandeja y el encabezado no pueden
// discrepar sin que esto se ponga rojo.
if (!/Resumen semanal/.test(lunesAjeno.subject || ''))
  sinPrecondicion('el asunto del lunes no vino con el correo',
    [`obtuve: ${JSON.stringify(lunesAjeno.subject)}`,
     'Sin asunto, «no dice CAMPO» se cumple por estar vacío.']);
const conCAMPO = [['resumen del lunes', htmlAjeno],
  ['asunto del lunes', lunesAjeno.subject],
  ['bienvenida', bienvenida.html],
  ['asunto de bienvenida', bienvenida.subject]]
  .filter(([, t]) => /\bCAMPO\b/.test(t)).map(([q]) => q);
if (!conCAMPO.length) ok('ningún correo se presenta como «CAMPO»');
else falla('ningún correo se presenta como «CAMPO»', 'cero',
  `sigue en: ${conCAMPO.join(', ')}`);

// ── El PDF, los dos papeles ─────────────────────────────────────────────────
// La obra se pasa entera y por nombre: los dos generadores reciben todo así.
const OBRA = {
  id: 'OB-2026-000001', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001',
  cliente: 'H. Ayuntamiento de Coatzacoalcos', ubicacion: 'Coatzacoalcos, Ver.',
  inicio: '2026-01-10', fin: '2026-12-20', presupuesto: 38500000,
};
const PAPELES = [['el informe del Art. 73', generarPDFArt73],
                 ['el documento interno', generarPDFInterno]];

const dibujarPapel = async (cual, generar, extra) => {
  try {
    return await dibujarPDFInterno(generar, { obra: OBRA, subs: [], ...extra });
  } catch (e) {
    sinPrecondicion(`${cual} no se pudo dibujar`,
      [e.message.split('\n')[0],
       'El jsPDF falso contesta a cualquier método, así que esto es el generador',
       'pidiendo algo que el doble no sabe devolver. Sin dibujo no hay qué afirmar.']);
  }
  return [];
};

// El pie es la FRANJA de abajo: los textos con la `y` más grande de la hoja.
// Se calcula en vez de teclear 212.5 para que mover el pie no haga pasar esto
// por vacío. Las celdas de `autoTable` llegan sin `y`, de ahí el filtro.
const franjaDelPie = (dibujos) => {
  const ys = dibujos.map(d => d.y).filter(Number.isFinite);
  if (!ys.length) return [];
  const maxY = Math.max(...ys);
  return dibujos.filter(d => d.y === maxY);
};

// §4. Con una organización AJENA puesta, el pie de cada página sigue firmando
// con el PRODUCTO. El nombre de la organización llega al papel —y tiene que
// llegar, es el campo de identificación—, pero no es la firma del documento.
// Las dos mitades importan: si sólo se exigiera «el pie no dice Veracruz», un
// generador que no imprimiera la organización en ningún sitio pasaría.
for (const [cual, generar] of PAPELES) {
  const dibujos = await dibujarPapel(cual, generar, { organizacion: MARCA_AJENA.empresa });
  const textos = dibujos.map(d => String(d.texto));
  if (textos.length < 20)
    sinPrecondicion(`${cual} sólo dibujó ${textos.length} textos`,
      ['Esperaba muchos más. Con el dibujo casi vacío, «el pie no dice el nombre',
       'de la organización» se cumple por no haber impreso nada.']);
  if (!dibujos.some(d => d.pagina > 1))
    sinPrecondicion(`${cual} se quedó en una sola página`,
      ['El pie se repite en todas las páginas, y lo que se afirma es que en',
       'TODAS dice el producto. Con una hoja sola eso no acota nada.']);

  // En la franja hay tres cosas, y se distinguen por el `align` con que se
  // mandan dibujar: la DIRECCIÓN va a la derecha, el NÚMERO DE PÁGINA al
  // centro, y la FIRMA sin alineación, anclada al margen izquierdo. Medido, no
  // supuesto. Y se exige UNA firma POR PÁGINA: que la portada esté bien no dice
  // nada de la hoja 6, que es la que el lector tiene en la mano al final.
  const pie = franjaDelPie(dibujos);
  const firmas = pie.filter(d => d.align === undefined).map(d => String(d.texto));
  const hojas = Math.max(...dibujos.map(d => d.pagina));
  const firmasAjenas = firmas.filter(t => !t.startsWith('cotea'));
  const enElPie = pie.filter(d => String(d.texto).includes(MARCA_AJENA.empresa)).length;
  const enLaHoja = textos.filter(t => t.includes(MARCA_AJENA.empresa)).length;

  if (firmas.length === hojas && !firmasAjenas.length && enElPie === 0 && enLaHoja > 0)
    ok(`${cual} firma con el producto sus ${hojas} hojas, `
      + `y nombra a la organización ${enLaHoja} vez(ces) fuera del pie`);
  else falla(`${cual} se firma con el producto, no con la organización`,
    `una firma que empiece con «cotea» en cada una de las ${hojas} hojas, cero `
    + 'veces la organización en el pie, y al menos una vez en la hoja',
    firmas.length !== hojas ? `${firmas.length} firma(s) para ${hojas} hojas`
      : firmasAjenas.length ? `firma(n) con otro nombre: ${firmasAjenas.map(t => `«${t}»`).join(', ')}`
      : enElPie > 0 ? `el pie nombra a la organización ${enElPie} vez(ces)`
      : 'la organización no aparece en ningún sitio de la hoja: el campo de '
        + 'identificación se perdió y la afirmación valdría de vacío');
}

// §5. Y a ninguno de los dos papeles se le escapa el nombre del contratista por
// ningún lado. Ya no hay un `branding` que lo traiga, así que cualquier «fosmon»
// en el papel está TECLEADO, que es justo lo que este banco persigue. Se barre
// la hoja entera, no sólo el pie: el nombre viejo podía estar en el encabezado,
// en una tabla o en la prosa de cierre.
for (const [cual, generar] of PAPELES) {
  const textos = (await dibujarPapel(cual, generar, { organizacion: MARCA_AJENA.empresa }))
    .map(d => String(d.texto));
  const conFOSMON = textos.filter(t => /FOSMON/i.test(t));
  if (!conFOSMON.length) ok(`${cual} no menciona al contratista en ninguna de sus hojas`);
  else falla(`${cual} no menciona al contratista`,
    'ningún FOSMON en el papel',
    `${conFOSMON.length} texto(s): ${conFOSMON.slice(0, 3).map(t => `«${t}»`).join(', ')}`);
}

// §6. Sin organización, el hueco se DECLARA: ni se rellena con un nombre ni se
// deja en blanco. Comparado contra el mismo papel con organización, quitarla
// tiene que añadir exactamente una declaración y ningún nombre.
//   Lo que NO se mide aquí: que `nombreOrg` devuelva nulo para una dependencia
// —eso es de `prueba-ui-dependencia`— ni cuántos huecos declara la carátula en
// total —eso es de `prueba-la-caratula-declara-lo-que-no-tiene`. Aquí sólo se
// afirma el DELTA, que es lo único que la marca ausente provoca.
for (const [cual, generar] of PAPELES) {
  const con = (await dibujarPapel(cual, generar, { organizacion: MARCA_AJENA.empresa }))
    .map(d => String(d.texto));
  const sin = (await dibujarPapel(cual, generar, { organizacion: null }))
    .map(d => String(d.texto));
  const declara = (ts) => ts.filter(t => t.includes('(no capturado)')).length;
  const delta = declara(sin) - declara(con);
  // «Veracruz» se usa aquí como señuelo del nombre del CLIENTE —el estado o el
  // municipio—, no como palabra prohibida. El 2026-11-21 la portada del Art. 73
  // pasó a citar «Ley 233 de Veracruz · Artículo 73» de subtítulo, que es el
  // nombre de la LEY y es texto fijo de la plantilla: no sale de ningún dato y
  // no puede traer la marca de nadie. Sin esta excepción el banco acusaba de
  // filtración a la cita legal que el papel debe llevar.
  const CITA_LEGAL = /Ley\s*233/i;
  const nombres = sin.filter(t => /FOSMON|Veracruz/i.test(t) && !CITA_LEGAL.test(t));
  if (delta === 1 && !nombres.length)
    ok(`${cual} sin organización declara el hueco (${declara(con)} → ${declara(sin)}) `
      + 'y no lo rellena con nadie');
  else falla(`${cual} sin organización declara el hueco en vez de rellenarlo`,
    'una declaración más que con organización, y ningún nombre de empresa',
    `el delta fue ${delta} (${declara(con)} → ${declara(sin)})`
    + (nombres.length ? ` · y se colaron nombres: ${nombres.slice(0, 2).map(t => `«${t}»`).join(', ')}`
      : ''));
}

console.log('');
if (fallas) {
  console.log('Una marca tecleada al lado de una que se lee no es redundancia:');
  console.log('es la que se queda vieja. Y la forma en que se nota es la peor —');
  console.log('un documento firmado por el contratista en manos de su cliente.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);

})();
