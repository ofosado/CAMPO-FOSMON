#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS DOS DIRECCIONES DEL PRODUCTO — #43 (la firma del correo) · #89 (la
// mudanza de la app a su subdominio)
// ════════════════════════════════════════════════════════════════════════════
//
// ESTE BANCO CAMBIÓ DE PREMISA el 2026-11-04, y el renglón de arriba lo dice
// porque la premisa anterior era el nombre del archivo: «la dirección del
// producto es una». Era verdad mientras hubo una sola, y dejó de serlo cuando
// la app se mudó a `app.cotea.com.mx` y la raíz se quedó con la cara pública.
// No se cortó el banco ni se empezó otro: lo que mide sigue siendo lo mismo
// —que nadie teclee una dirección por su cuenta— y lo que cambió es cuántas
// hay y qué le toca a cada una.
//
// LOS DOS OFICIOS. Confundirlos no es un detalle de redacción:
//
//   · `app.cotea.com.mx` es donde VIVE el bundle. Ahí va todo lo que supone una
//     sesión: el origen que le pide fotos al bucket, el botón de los correos,
//     los enlaces profundos `/?obra=…` y el origen que el verificador de
//     despliegue mide para decir si el front está al día.
//   · `cotea.com.mx` es la cara PÚBLICA. Ahí va lo que lee alguien que puede no
//     tener cuenta: el pie del PDF que el cliente archiva y el pie del correo.
//     Mandar a la pantalla de contraseña a quien no la tiene es una puerta
//     cerrada en la cara, y en el PDF queda impresa para siempre.
//
// POR QUÉ DUELE QUE DISCREPEN, caso por caso:
//
//   · Si el origen desde el que se sirve la app NO está en el CORS de Storage,
//     el navegador bloquea las fotos de evidencia. Y no avisa: la pantalla sale
//     sin imagen, como si no se hubiera capturado nada. El #52 (la cámara
//     georreferenciada) entero depende de esto.
//   · Si los orígenes VIEJOS se quitan del CORS, a quien ya tenga la app
//     instalada desde ahí se le apagan las fotos. Hoy son dos: el de Netlify y
//     la raíz, porque la raíz sirvió la app un día y hay teléfonos con el icono
//     puesto desde ahí.
//   · Si el rebote de la raíz pierde la ruta o la cadena de consulta, el enlace
//     profundo del correo del lunes abre la obra equivocada —o ninguna— sin
//     decir que se perdió algo. Y si el rebote es 301, el navegador lo cachea y
//     la landing (#90, la página pública con capturas) existiría sin que nadie
//     la vea.
//   · Si el verificador de despliegue mide la raíz en lugar del origen del
//     bundle, lo que lee es el HTML de dos renglones del rebote: el front daría
//     «atrasado» todos los días. Un rojo falso cuesta igual que un verde falso
//     — enseña a ignorar el instrumento.
//   · Si el remitente vive en un dominio y el enlace en otro, el correo se
//     parece a una suplantación. Y si el dominio es el del contratista
//     (`campo@fosmon.com.mx`), un municipio recibe el resumen de SUS obras
//     desde la casa de quien le cobra: el #39 (el emblema del cliente) por el
//     lado del sobre.
//
// CÓMO MIDE. Las cinco fuentes se **leen de sus archivos y se ejecutan**:
// `APP_URL`, `SITIO_PUBLICO` y `FROM_EMAIL` salen por AST de
// `functions/index.js`; el pie del PDF sale de DIBUJAR el PDF con
// `generarPDFObra` y sin marca —el caso de una organización sin `dominio`
// propio—; el CORS se parsea y se le aplica la regla de coincidencia de
// orígenes; el `SITIO` por omisión del verificador se extrae y se evalúa con un
// `process` falso, para medir el valor por omisión y no lo que traiga el
// ambiente de quien corre la suite; y `landing/_redirects` se parsea renglón a
// renglón. No se compara contra una cadena tecleada aquí: se comparan las cinco
// ENTRE SÍ. El día que las direcciones cambien otra vez, este banco sigue
// midiendo lo mismo sin tocarlo.
//
// EL COMODÍN NO CUENTA. `https://*.netlify.app` está en la lista, pero cada
// origen tiene que aparecer **exacto**. Un comodín cuya semántica depende de lo
// que el proveedor decida honrar no es una garantía, y la forma en que fallaría
// —fotos en blanco— es silenciosa.
//
// Contraprueba:  node scripts/prueba-las-dos-direcciones-del-producto.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, noArranco } = require('./no-arranco.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDF } = require('./lienzo-pdf.cjs');

vigilarExcepciones('functions/index.js, src/App.jsx, storage.cors.json, '
  + 'landing/_redirects y scripts/verificar-despliegue.cjs');

const RAIZ = path.join(__dirname, '..');
// La contraprueba apunta estos cinco a copias mutadas.
const ARCH_FN = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');
const ARCH_CORS = process.env.ARCH_CORS || path.join(RAIZ, 'storage.cors.json');
const ARCH_REDIR = process.env.ARCH_REDIRECTS || path.join(RAIZ, 'landing/_redirects');
const ARCH_VERIF = process.env.ARCH_VERIFICADOR
  || path.join(RAIZ, 'scripts/verificar-despliegue.cjs');

// Los orígenes que YA NO sirven la app pero siguen teniéndola instalada en
// teléfonos. Su service worker y su caché viven en ESE origen y sus fotos se
// piden desde ahí: quitarlos del CORS les apaga la evidencia sin que nadie se
// entere. Cada renglón se va el día que ese origen se retire de verdad, no
// antes. La raíz entró aquí el 2026-11-04: dejó de servir la app, pero no deja
// de ser el origen de quien la instaló cuando sí la servía.
const ORIGENES_HEREDADOS = [
  ['https://campo-fosmon.netlify.app', 'el origen de Netlify, el primero de todos'],
  ['https://cotea.com.mx', 'la raíz, que sirvió la app desde que se compró el dominio'],
];
// El dominio del contratista. No es el del producto, y no debe ser ninguno de
// los dos extremos del correo.
const CASA_DEL_CONTRATISTA = 'fosmon.com.mx';

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_FUNCIONES || process.env.ARCH_APP || process.env.ARCH_CORS
    || process.env.ARCH_REDIRECTS || process.env.ARCH_VERIFICADOR)
    sinPrecondicion('la contraprueba corriendo sobre copias ya mutadas',
      ['Se invocó con alguna de las ARCH_* puesta.']);

  const MUTACIONES = [
    // ── Las dos direcciones se vuelven a confundir ──────────────────────────
    ['FN', 'la app vuelve a la raíz y deja de haber dos oficios',
      (t) => t.replace('const APP_URL = "https://app.cotea.com.mx";',
        'const APP_URL = "https://cotea.com.mx";')],
    ['FN', 'la cara pública se muda al subdominio y el PDF manda al cliente a la contraseña',
      (t) => t.replace('const SITIO_PUBLICO = "https://cotea.com.mx";',
        'const SITIO_PUBLICO = "https://app.cotea.com.mx";')],
    ['APP', 'el pie del PDF manda a donde hace falta sesión',
      (t) => t.replace("branding.dominio    || 'cotea.com.mx'",
        "branding.dominio    || 'app.cotea.com.mx'")],
    ['APP', 'el pie del PDF vuelve a la dirección más vieja',
      (t) => t.replace("branding.dominio    || 'cotea.com.mx'",
        "branding.dominio    || 'campo-fosmon.netlify.app'")],
    // ── El bucket ───────────────────────────────────────────────────────────
    ['CORS', 'el origen de la app desaparece de la lista del bucket',
      (t) => t.replace('      "https://app.cotea.com.mx",\n', '')],
    ['CORS', 'la raíz desaparece, y con ella las fotos de quien la instaló desde ahí',
      (t) => t.replace('      "https://cotea.com.mx",\n', '')],
    ['CORS', 'el origen de Netlify desaparece, y con él las fotos de los primeros',
      (t) => t.replace('      "https://campo-fosmon.netlify.app",\n', '')],
    ['CORS', 'el origen de la app queda cubierto sólo por un comodín',
      (t) => t.replace('"https://app.cotea.com.mx"', '"https://*.cotea.com.mx"')],
    ['CORS', 'el bucket deja de permitir GET',
      (t) => t.replace('"method": ["GET", "HEAD"]', '"method": ["HEAD"]')],
    // ── El rebote de la raíz ────────────────────────────────────────────────
    ['REDIR', 'el rebote se vuelve permanente y la landing nacería invisible',
      (t) => t.replace('/:splat   302', '/:splat   301')],
    ['REDIR', 'el rebote pierde la ruta y todo enlace profundo cae en la portada',
      (t) => t.replace('/:splat   302', '   302')],
    ['REDIR', 'el rebote manda a un sitio que no es donde vive la app',
      (t) => t.replace('https://app.cotea.com.mx/:splat',
        'https://campo-fosmon.netlify.app/:splat')],
    // ── El verificador ──────────────────────────────────────────────────────
    ['VERIF', 'el verificador se queda midiendo el rebote en lugar del bundle',
      (t) => t.replace("process.env.SITIO || 'https://app.cotea.com.mx'",
        "process.env.SITIO || 'https://cotea.com.mx'")],
    // ── El sobre del correo ─────────────────────────────────────────────────
    ['FN', 'el remitente vuelve a ser el del contratista',
      (t) => t.replace('const FROM_EMAIL = "cotea <no-reply@cotea.com.mx>";',
        'const FROM_EMAIL = "CAMPO <campo@fosmon.com.mx>";')],
    ['FN', 'el remitente se queda en un dominio que no es el del producto',
      (t) => t.replace('const FROM_EMAIL = "cotea <no-reply@cotea.com.mx>";',
        'const FROM_EMAIL = "cotea <no-reply@cotea-mail.net>";')],
  ];

  const DESTINO = {
    FN: ['ARCH_FUNCIONES', ARCH_FN], APP: ['ARCH_APP', ARCH_APP],
    CORS: ['ARCH_CORS', ARCH_CORS], REDIR: ['ARCH_REDIRECTS', ARCH_REDIR],
    VERIF: ['ARCH_VERIFICADOR', ARCH_VERIF],
  };

  let vistas = 0;
  for (const [cual, nombre, romper] of MUTACIONES) {
    const [variable, origen] = DESTINO[cual];
    const antes = fs.readFileSync(origen, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}  ·  el ancla ya no está en ${path.basename(origen)}`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-dir-'));
    const copia = path.join(dir, path.basename(origen));
    fs.writeFileSync(copia, despues);
    const r = spawnSync(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, [variable]: copia },
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

// ── Sacar las piezas de sus archivos ────────────────────────────────────────
let FN, APP, VERIF;
try {
  FN = fuenteDe(ARCH_FN, ['APP_URL', 'SITIO_PUBLICO', 'FROM_EMAIL'], { tolerante: true });
  APP = fuenteDe(ARCH_APP, ['generarPDFObra'], { tolerante: true });
  VERIF = fuenteDe(ARCH_VERIF, ['SITIO'], { tolerante: true });
} catch (e) {
  if (e instanceof SimboloPerdido)
    noArranco(e.faltantes, `${ARCH_FN} / ${ARCH_APP} / ${ARCH_VERIF}`);
  throw e;
}
if (FN.faltan.length) noArranco(FN.faltan, ARCH_FN);
if (APP.faltan.length) noArranco(APP.faltan, ARCH_APP);
if (VERIF.faltan.length) noArranco(VERIF.faltan, ARCH_VERIF);

const armarFN = (e) => new Function(`"use strict";\n${FN.cuerpo}\nreturn (${e});`)();
const armarAPP = (e) => new Function(
  'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  `"use strict";\n${APP.cuerpo}\nreturn (${e});`
)(...Array(6).fill(() => {}));
// `process` falso a propósito: `SITIO` es `process.env.SITIO || '…'`, y lo que
// este banco afirma es el valor POR OMISIÓN. Con el `process` de verdad, quien
// corriera la suite con `SITIO=…` puesto estaría midiendo su propio ambiente y
// el banco pasaría —o fallaría— por una razón que no está en el repo.
const armarVERIF = (e) => new Function('process',
  `"use strict";\n${VERIF.cuerpo}\nreturn (${e});`)({ env: {} });

let APP_URL, SITIO_PUBLICO, FROM_EMAIL, generarPDFObra, SITIO_VERIF, CORS, REDIR;
try {
  APP_URL = armarFN('APP_URL');
  SITIO_PUBLICO = armarFN('SITIO_PUBLICO');
  FROM_EMAIL = armarFN('FROM_EMAIL');
  generarPDFObra = armarAPP('generarPDFObra');
  SITIO_VERIF = armarVERIF('SITIO');
} catch (e) {
  sinPrecondicion('no se pudo montar el código extraído',
    [e.message.split('\n')[0],
     'Sin poder EJECUTAR no hay nada que afirmar: mirar el texto del archivo',
     'sería comprobar que una cadena está escrita, no que se usa.']);
}
try {
  CORS = JSON.parse(fs.readFileSync(ARCH_CORS, 'utf8'));
} catch (e) {
  sinPrecondicion(`no se pudo leer ${path.basename(ARCH_CORS)}`,
    [e.message.split('\n')[0],
     'Un CORS que no se parsea no se puede comparar con nada.']);
}
try {
  REDIR = fs.readFileSync(ARCH_REDIR, 'utf8');
} catch (e) {
  sinPrecondicion(`no se pudo leer ${path.relative(RAIZ, ARCH_REDIR)}`,
    [e.message.split('\n')[0],
     'Sin el archivo de rebotes no se puede afirmar a dónde manda la raíz.']);
}

// ── Las reglas de la lista del bucket ───────────────────────────────────────
// Un origen está permitido EXACTO si aparece tal cual en alguna regla que
// permita el método. El comodín se ignora a propósito: ver el preámbulo.
const reglasDe = (origen, metodo) => CORS.filter(r =>
  Array.isArray(r.origin) && r.origin.includes(origen)
  && Array.isArray(r.method) && r.method.includes(metodo));
const todosLosOrigenes = CORS.flatMap(r => (Array.isArray(r.origin) ? r.origin : []));

// ── Las reglas del archivo de rebotes ───────────────────────────────────────
// Formato de Netlify: `desde  hacia  código`, comentarios con `#`. Se parsea en
// lugar de buscar una subcadena porque lo que importa es la REGLA que atrapa la
// raíz, no que el texto aparezca en algún comentario — y este archivo tiene más
// comentario que regla.
const REGLAS_REBOTE = REDIR.split('\n')
  .map(l => l.replace(/#.*$/, '').trim())
  .filter(Boolean)
  .map(l => {
    const campos = l.split(/\s+/);
    return { desde: campos[0], hacia: campos[1], codigo: campos[2] || '301', linea: l };
  });
// La que atrapa la raíz y cualquier cosa debajo.
const reboteRaiz = REGLAS_REBOTE.find(r => r.desde === '/*' && /^https?:\/\//.test(r.hacia || ''));

// ── Las comprobaciones ──────────────────────────────────────────────────────
console.log('\n── Las dos direcciones del producto ──');
console.log([ARCH_FN, ARCH_APP, ARCH_CORS, ARCH_REDIR, ARCH_VERIF]
  .map(a => path.relative(RAIZ, a)).join(' · ') + '\n');

let fallas = 0, oks = 0;
const ok = (q) => { oks++; console.log(` ok   ${q}`); };
const falla = (q, esp, obt) => {
  fallas++; console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esp}`);
  console.log(`        obtuvo:   ${obt}`);
};

(async () => {

// Sin esto, una lista vacía o un origen vacío cumplirían por no haber nada que
// comparar.
for (const [nombre, valor] of [['APP_URL', APP_URL], ['SITIO_PUBLICO', SITIO_PUBLICO]])
  if (!/^https:\/\/[a-z0-9.-]+$/.test(String(valor)))
    sinPrecondicion(`\`${nombre}\` no parece un origen https`,
      [`obtuve: ${JSON.stringify(valor)}`,
       'Si no es un origen, «está en el CORS» no quiere decir nada.']);
if (!todosLosOrigenes.length)
  sinPrecondicion('la lista de orígenes del bucket salió vacía',
    [`${path.basename(ARCH_CORS)} se parseó pero no trae ningún origen.`,
     'Con la lista vacía todo lo de abajo se mide contra la nada.']);
if (!reboteRaiz)
  sinPrecondicion(`${path.relative(RAIZ, ARCH_REDIR)} no trae una regla para \`/*\``,
    ['Sin la regla que atrapa la raíz no hay a dónde afirmar que manda.',
     `${REGLAS_REBOTE.length} regla(s) leída(s).`]);

const HOST_APP = String(APP_URL).replace(/^https:\/\//, '');
const HOST_PUBLICO = String(SITIO_PUBLICO).replace(/^https:\/\//, '');
const registrable = (h) => h.split('.').slice(-3).join('.');

// §1. Son DOS, y bajo la misma casa. Si se colapsan en una, el pie del PDF y el
// botón del correo vuelven a ser el mismo renglón y uno de los dos oficios
// queda mal servido: o el cliente sin cuenta cae en la contraseña, o el enlace
// profundo cae en el rebote. Si se separan en casas distintas, el correo se
// parece a una suplantación y el certificado deja de alcanzar.
if (HOST_APP !== HOST_PUBLICO && registrable(HOST_APP) === registrable(HOST_PUBLICO))
  ok(`son dos direcciones distintas (${HOST_APP} · ${HOST_PUBLICO}) bajo la misma casa`);
else falla('son dos direcciones distintas bajo la misma casa',
  'una para el bundle y otra para la cara pública, con el mismo dominio registrable',
  HOST_APP === HOST_PUBLICO
    ? `las dos dicen «${HOST_APP}»: volvió a haber una sola, y uno de los dos `
      + 'oficios queda mal servido'
    : `«${HOST_APP}» y «${HOST_PUBLICO}» son casas distintas`);

// §2. El origen desde el que se sirve la app puede pedirle fotos al bucket. Es
// la comprobación que evita la pantalla sin imagen que no avisa.
if (reglasDe(APP_URL, 'GET').length)
  ok(`el origen de la app (${APP_URL}) puede traer las fotos del bucket`);
else falla('el origen de la app puede traer las fotos del bucket',
  `«${APP_URL}» exacto, con GET, en ${path.basename(ARCH_CORS)}`,
  `la lista dice: ${todosLosOrigenes.join(', ') || 'nada'}`);

// §3. Y los orígenes heredados también, mientras haya teléfonos con la app
// instalada desde ahí.
for (const [origen, quien] of ORIGENES_HEREDADOS) {
  if (reglasDe(origen, 'GET').length)
    ok(`${quien} sigue permitido: quien la instaló ahí no pierde la evidencia`);
  else falla(`${quien} sigue permitido`,
    `«${origen}» exacto, con GET`,
    'se quitó — a quien tenga la app instalada desde ahí se le apagan las fotos '
    + 'sin un solo mensaje de error visible');
}

// §4. La raíz rebota a donde vive la app, con la ruta intacta y de forma
// TEMPORAL. El 302 no es un descuido: un 301 se cachea en disco y el día que la
// raíz sirva la landing (#90, la página pública con capturas) quien haya pasado
// antes seguiría cayendo en la app sin volver a preguntar.
const hostDestino = String(reboteRaiz.hacia).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
if (hostDestino === HOST_APP)
  ok(`la raíz rebota a donde vive la app (${hostDestino})`);
else falla('la raíz rebota a donde vive la app',
  `el destino de «/*» con host «${HOST_APP}»`,
  `rebota a «${hostDestino || 'nada'}»:  ${reboteRaiz.linea}`);

if (reboteRaiz.codigo === '302')
  ok('el rebote de la raíz es temporal: la landing podrá nacer visible');
else falla('el rebote de la raíz es temporal',
  'código 302',
  `dice ${reboteRaiz.codigo} — un 301 se cachea en disco y la landing nacería invisible`);

if (/:splat/.test(String(reboteRaiz.hacia)))
  ok('el rebote conserva la ruta: los enlaces profundos del correo llegan enteros');
else falla('el rebote conserva la ruta',
  '«:splat» en el destino',
  `el destino es «${reboteRaiz.hacia}» — cada «/?obra=…» del correo caería en la `
  + 'portada y abriría la obra equivocada, o ninguna, sin avisar');

// §5. El verificador de despliegue mide el origen donde vive el BUNDLE. Si
// midiera la raíz leería el HTML del rebote, que no trae el hash del build.
if (SITIO_VERIF === APP_URL)
  ok(`el verificador mide el origen del bundle (${SITIO_VERIF})`);
else falla('el verificador mide el origen del bundle',
  `el «SITIO» por omisión igual a «APP_URL» («${APP_URL}»)`,
  `mide «${SITIO_VERIF}» — ahí no está el bundle, así que el veredicto del front `
  + 'no hablaría del front');

// §6. El pie del PDF de una organización sin dominio propio dice la cara
// PÚBLICA, no la de la app. El cliente que archiva ese PDF puede no tener
// cuenta, y la dirección queda impresa para siempre. Dibujado, no leído.
let dibujos;
try {
  dibujos = await dibujarPDF(generarPDFObra, {},
    { id: 'OB-2026-000001', nombre: 'SIOP COATZA MALECON', contrato: 'SIOP-2026-001' });
} catch (e) {
  sinPrecondicion('el PDF no se pudo dibujar',
    [e.message.split('\n')[0],
     'El jsPDF falso contesta a cualquier método, así que esto es el generador',
     'pidiendo algo que el doble no sabe devolver. Sin dibujo no hay qué afirmar.']);
}
if (dibujos.length < 20)
  sinPrecondicion(`el PDF sólo dibujó ${dibujos.length} textos`,
    ['Con el dibujo casi vacío, lo de abajo se cumpliría por no haber impreso nada.']);

const direccionesImpresas = [...new Set(dibujos
  .map(d => d.texto)
  .filter(t => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) && !t.includes(' ')))];
if (direccionesImpresas.length === 1 && direccionesImpresas[0] === HOST_PUBLICO)
  ok(`el PDF sin marca imprime la cara pública (${HOST_PUBLICO}), y sólo ésa`);
else falla('el PDF sin marca imprime la cara pública',
  `sólo «${HOST_PUBLICO}»`,
  `imprimió: ${direccionesImpresas.map(d => `«${d}»`).join(', ') || 'ninguna dirección'}`
  + (direccionesImpresas.includes(HOST_APP)
    ? ' — es la de la app, que manda a la pantalla de contraseña a quien archiva el PDF'
    : ''));

// §7. El remitente y el producto son de la misma casa, y esa casa no es la del
// contratista. Un correo cuyo sobre y cuyos enlaces no coinciden se parece a
// una suplantación; y si el sobre es del contratista, delata de quién es la app
// antes de que el lector decida nada.
const correoDe = (String(FROM_EMAIL).match(/<([^>]+)>/) || [, String(FROM_EMAIL)])[1];
const dominioRemitente = (correoDe.split('@')[1] || '').trim();
const mismaCasa = registrable(dominioRemitente) === registrable(HOST_APP)
  && registrable(dominioRemitente) === registrable(HOST_PUBLICO);
const esDelContratista = [dominioRemitente, HOST_APP, HOST_PUBLICO]
  .filter(h => h === CASA_DEL_CONTRATISTA || h.endsWith(`.${CASA_DEL_CONTRATISTA}`));
if (mismaCasa && !esDelContratista.length)
  ok(`el remitente (${dominioRemitente}) es de la casa de las dos direcciones, `
    + 'y no es la del contratista');
else falla('el remitente es de la casa de las dos direcciones, y no es la del contratista',
  `el dominio de «${FROM_EMAIL}» igual al registrable de «${HOST_APP}» y «${HOST_PUBLICO}», `
  + `y ninguno bajo ${CASA_DEL_CONTRATISTA}`,
  esDelContratista.length
    ? `${[...new Set(esDelContratista)].join(' y ')} es del contratista`
    : `remitente «${dominioRemitente}» contra «${HOST_APP}» y «${HOST_PUBLICO}»`);

console.log('');
if (fallas) {
  console.log('Cinco archivos tecleando dos direcciones es una cuenta por archivo,');
  console.log('no una cuenta por número. Y la forma en que se nota es la peor: una');
  console.log('foto que no carga no da error, da una pantalla vacía; un enlace que');
  console.log('pierde el «?obra=» abre otra obra sin decir que cambió de obra.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);

})();
