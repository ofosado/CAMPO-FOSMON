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
// CÓMO MIDE. No busca cadenas en el archivo: **ejecuta**. El correo sale de
// `buildEmailHTML` extraído de `functions/index.js`, y el PDF de
// `generarPDFObra` extraído de `src/App.jsx`, movido con un jsPDF falso que
// anota cada texto que se manda dibujar. Lo que se afirma es lo que quedaría
// impreso, que es lo único que el cliente ve.
//
// Contraprueba:  node scripts/prueba-la-marca-se-lee-no-se-teclea.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, noArranco } = require('./no-arranco.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
// El jsPDF falso vive aparte: lo comparte con el banco de la dirección.
const { dibujarPDF } = require('./lienzo-pdf.cjs');

vigilarExcepciones('functions/index.js y src/App.jsx');

const RAIZ = path.join(__dirname, '..');
// La contraprueba apunta estos dos a copias mutadas.
const ARCH_FN = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');

// ── Sacar las dos piezas de sus archivos ────────────────────────────────────
const PIDE_FN = ['correoResumenSemanal', 'correoBienvenida'];
const PIDE_APP = ['generarPDFObra'];

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

let correoResumenSemanal, correoBienvenida, generarPDFObra, APP_URL;
try {
  correoResumenSemanal = armarFN('correoResumenSemanal');
  correoBienvenida = armarFN('correoBienvenida');
  generarPDFObra = armarAPP('generarPDFObra');
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
    ['FN', 'el encabezado del lunes vuelve a teclear la marca',
      (t) => t.replace('>cotea${firma ? ` · ${firma}` : ""}</div>',
        '>CAMPO · FOSMON CONSTRUCCIONES</div>')],
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
    ['APP', 'la portada del PDF vuelve a teclear la empresa',
      (t) => t.replace('T(`cotea · ${B.empresa}`, ML, PH-3.5);',
        'T("cotea · FOSMON Construcciones", ML, PH-3.5);')],
    ['APP', 'la portada del PDF vuelve a teclear el dominio',
      (t) => t.replace('T(B.dominio, PW-MR, PH-3.5,',
        "T('campo-fosmon.netlify.app', PW-MR, PH-3.5,")],
    ['APP', 'la ubicación vacía se rellena con el nombre de la empresa',
      (t) => t.replace('if (obra.ubicacion) T(obra.ubicacion, ML, 82);',
        "T(obra.ubicacion||'FOSMON Construcciones', ML, 82);")],
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
    const r = spawnSync(process.execPath, [__filename], {
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

// §4. El PDF: la portada imprime la empresa y el dominio que se le PASARON.
// Ejecutado, no leído: esto es lo que quedaría en el papel.
let dibujos;
try {
  dibujos = await dibujarPDF(generarPDFObra, MARCA_AJENA,
    { id: 'OB-2026-000001', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001' });
} catch (e) {
  sinPrecondicion('el PDF no se pudo dibujar',
    [e.message.split('\n')[0],
     'El jsPDF falso contesta a cualquier método, así que esto es el generador',
     'pidiendo algo que el doble no sabe devolver. Sin dibujo no hay qué afirmar.']);
}
const textos = dibujos.map(d => d.texto);
if (textos.length < 20)
  sinPrecondicion(`el PDF sólo dibujó ${textos.length} textos`,
    ['Esperaba muchos más. Con el dibujo casi vacío, «no dice FOSMON» se',
     'cumple por no haber impreso nada.']);

// Sólo la portada: la página 1, el renglón del pie. Si el PDF nunca pasó de
// la primera página el banco no arranca, porque entonces «página 1» no
// distingue la portada del marco y la afirmación volvería a valer de más.
const portada = dibujos.filter(d => d.pagina === 1);
if (!dibujos.some(d => d.pagina > 1))
  sinPrecondicion('el PDF se quedó en una sola página',
    ['La portada se distingue del marco por ser la única página sin `pageFrame`.',
     'Con una página sola, mirar «la página 1» no acota nada.']);
const pieEmpresa = portada.some(d => d.texto === `cotea · ${MARCA_AJENA.empresa}`);
const pieDominio = portada.some(d => d.texto === MARCA_AJENA.dominio && d.align === 'right');
if (pieEmpresa && pieDominio)
  ok(`la portada del PDF imprime la marca recibida (${textos.length} textos dibujados)`);
else falla('la portada del PDF imprime la marca recibida',
  `«cotea · ${MARCA_AJENA.empresa}» y «${MARCA_AJENA.dominio}» en la página 1`,
  `${pieEmpresa ? 'la empresa sí' : 'la empresa NO'} · ${pieDominio ? 'el dominio sí' : 'el dominio NO'}`);

// §5. Y a ese PDF no se le escapa el nombre del contratista por ningún lado:
// el marco de cada página y la portada tienen que decir lo mismo.
// Aquí NO se descuenta el enlace de la app: el PDF no imprime `APP_URL`, sólo
// `B.dominio`. Así que cualquier «fosmon» en el papel —incluido el dominio por
// omisión— es algo tecleado, y es justo lo que se busca.
const conFOSMON = textos.filter(t => /FOSMON/i.test(t));
if (!conFOSMON.length) ok('el PDF entero firma con una sola marca, la recibida');
else falla('el PDF entero firma con una sola marca',
  'ningún FOSMON en el papel, fuera del enlace',
  `${conFOSMON.length} texto(s): ${conFOSMON.slice(0, 3).map(t => `«${t}»`).join(', ')}`);

// §6. La ubicación que no se capturó NO se rellena con el nombre de nadie.
// Es el renglón donde el lector espera un lugar.
const conUbic = (await dibujarPDF(generarPDFObra, MARCA_AJENA,
  { id: 'OB-2026-000001', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001',
    ubicacion: 'Coatzacoalcos, Ver.' })).map(d => d.texto);
const dibujaUbic = conUbic.includes('Coatzacoalcos, Ver.');
const inventaUbic = textos.some(t => t === MARCA_AJENA.empresa || /FOSMON Construcciones/.test(t));
if (dibujaUbic && !inventaUbic)
  ok('la ubicación se imprime si está, y si no está no se rellena con nadie');
else falla('la ubicación se imprime si está, y si no está no se rellena',
  'con ubicación se dibuja; sin ella no se dibuja ningún nombre de empresa',
  `${dibujaUbic ? 'con ubicación sí se dibuja' : 'con ubicación NO se dibujó'} · ` +
  `${inventaUbic ? 'sin ubicación se inventó un nombre de empresa' : 'sin ella no se inventa'}`);

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
