#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA DIRECCIÓN DEL PRODUCTO ES UNA — PENDIENTES #43 (el lado de la dirección)
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ HABÍA. La dirección de la app estaba tecleada en cuatro archivos que no
// se hablan entre sí: `APP_URL` en `functions/index.js` (el enlace de todos los
// correos), el `dominio` por omisión del PDF en `src/App.jsx` (el pie de cada
// página), la lista de orígenes de `storage.cors.json` (quién puede pedirle una
// foto al bucket) y el remitente `FROM_EMAIL`. Cuatro cuentas para un número.
//
// POR QUÉ DUELE QUE DISCREPEN, y no es estética:
//
//   · Si el origen desde el que se sirve la app NO está en el CORS de Storage,
//     el navegador bloquea las fotos de evidencia. Y no avisa: la pantalla sale
//     sin imagen, como si no se hubiera capturado nada. El #52 entero —la
//     evidencia georreferenciada— depende de esto.
//   · Si el PDF imprime en su pie una dirección distinta de la que los correos
//     enlazan, el documento que el cliente guarda manda a un sitio equivocado.
//   · Si el remitente vive en un dominio y el enlace en otro, el correo se
//     parece a una suplantación. Y si el dominio es el del contratista
//     (`campo@fosmon.com.mx`), un municipio recibe el resumen de SUS obras
//     desde la casa de quien le cobra: el #39 por el lado del sobre.
//
// CÓMO MIDE. Las cuatro se **leen de sus archivos y se ejecutan**: `APP_URL` y
// `FROM_EMAIL` salen por AST de `functions/index.js`, el pie del PDF sale de
// DIBUJAR el PDF con `generarPDFObra` y sin marca —que es el caso de una
// organización sin `dominio` propio—, y el CORS se parsea y se le aplica la
// regla de coincidencia de orígenes. No se compara contra una cadena tecleada
// aquí: se comparan las cuatro ENTRE SÍ. El día que la dirección cambie, este
// banco sigue midiendo lo mismo sin tocarlo.
//
// EL COMODÍN NO CUENTA. `https://*.netlify.app` está en la lista, pero el
// origen de la app tiene que aparecer **exacto**. Un comodín cuya semántica
// depende de lo que el proveedor decida honrar no es una garantía, y la forma
// en que fallaría —fotos en blanco— es silenciosa.
//
// Contraprueba:  node scripts/prueba-la-direccion-del-producto-es-una.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { vigilarExcepciones, sinPrecondicion, noArranco } = require('./no-arranco.cjs');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { dibujarPDF } = require('./lienzo-pdf.cjs');

vigilarExcepciones('functions/index.js, src/App.jsx y storage.cors.json');

const RAIZ = path.join(__dirname, '..');
// La contraprueba apunta estos tres a copias mutadas.
const ARCH_FN = process.env.ARCH_FUNCIONES || path.join(RAIZ, 'functions/index.js');
const ARCH_APP = process.env.ARCH_APP || path.join(RAIZ, 'src/App.jsx');
const ARCH_CORS = process.env.ARCH_CORS || path.join(RAIZ, 'storage.cors.json');

// El origen viejo. Mientras alguien tenga la app instalada desde ahí, su
// service worker y su caché viven en ESE origen y sus fotos se piden desde ahí:
// quitarlo del CORS le apaga la evidencia sin que nadie se entere. Este renglón
// se va el día que ese origen se retire de verdad, no antes.
const ORIGEN_VIEJO = 'https://campo-fosmon.netlify.app';
// El dominio del contratista. No es el del producto, y no debe ser ninguno de
// los dos extremos del correo.
const CASA_DEL_CONTRATISTA = 'fosmon.com.mx';

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCH_FUNCIONES || process.env.ARCH_APP || process.env.ARCH_CORS)
    sinPrecondicion('la contraprueba corriendo sobre copias ya mutadas',
      ['Se invocó con ARCH_FUNCIONES, ARCH_APP o ARCH_CORS puesto.']);

  const MUTACIONES = [
    ['FN', 'la app se muda de origen y el CORS se queda atrás',
      (t) => t.replace('const APP_URL = "https://cotea.com.mx";',
        'const APP_URL = "https://app.cotea.com.mx";')],
    ['CORS', 'el origen de la app desaparece de la lista del bucket',
      (t) => t.replace('      "https://cotea.com.mx",\n', '')],
    ['CORS', 'el origen VIEJO desaparece, y con él las fotos de quien ya la instaló',
      (t) => t.replace(`      "${ORIGEN_VIEJO}",\n`, '')],
    ['CORS', 'el origen de la app queda cubierto sólo por un comodín',
      (t) => t.replace('"https://cotea.com.mx"', '"https://*.com.mx"')],
    ['CORS', 'el bucket deja de permitir GET',
      (t) => t.replace('"method": ["GET", "HEAD"]', '"method": ["HEAD"]')],
    ['APP', 'el pie del PDF vuelve a la dirección vieja',
      (t) => t.replace("branding.dominio    || 'cotea.com.mx'",
        "branding.dominio    || 'campo-fosmon.netlify.app'")],
    ['FN', 'el remitente vuelve a ser el del contratista',
      (t) => t.replace('const FROM_EMAIL = "cotea <no-reply@cotea.com.mx>";',
        'const FROM_EMAIL = "CAMPO <campo@fosmon.com.mx>";')],
    ['FN', 'el remitente se queda en un dominio que no es el de la app',
      (t) => t.replace('const FROM_EMAIL = "cotea <no-reply@cotea.com.mx>";',
        'const FROM_EMAIL = "cotea <no-reply@cotea-mail.net>";')],
  ];

  const DESTINO = { FN: ['ARCH_FUNCIONES', ARCH_FN], APP: ['ARCH_APP', ARCH_APP],
    CORS: ['ARCH_CORS', ARCH_CORS] };

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
let FN, APP;
try {
  FN = fuenteDe(ARCH_FN, ['APP_URL', 'FROM_EMAIL'], { tolerante: true });
  APP = fuenteDe(ARCH_APP, ['generarPDFObra'], { tolerante: true });
} catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, `${ARCH_FN} / ${ARCH_APP}`);
  throw e;
}
if (FN.faltan.length) noArranco(FN.faltan, ARCH_FN);
if (APP.faltan.length) noArranco(APP.faltan, ARCH_APP);

const armarFN = (e) => new Function(`"use strict";\n${FN.cuerpo}\nreturn (${e});`)();
const armarAPP = (e) => new Function(
  'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
  `"use strict";\n${APP.cuerpo}\nreturn (${e});`
)(...Array(6).fill(() => {}));

let APP_URL, FROM_EMAIL, generarPDFObra, CORS;
try {
  APP_URL = armarFN('APP_URL');
  FROM_EMAIL = armarFN('FROM_EMAIL');
  generarPDFObra = armarAPP('generarPDFObra');
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

// ── Las reglas de la lista del bucket ───────────────────────────────────────
// Un origen está permitido EXACTO si aparece tal cual en alguna regla que
// permita el método. El comodín se ignora a propósito: ver el preámbulo.
const reglasDe = (origen, metodo) => CORS.filter(r =>
  Array.isArray(r.origin) && r.origin.includes(origen)
  && Array.isArray(r.method) && r.method.includes(metodo));
const todosLosOrigenes = CORS.flatMap(r => (Array.isArray(r.origin) ? r.origin : []));

// ── Las comprobaciones ──────────────────────────────────────────────────────
console.log('\n── La dirección del producto es una ──');
console.log(`${path.relative(RAIZ, ARCH_FN)} · ${path.relative(RAIZ, ARCH_APP)}`
  + ` · ${path.relative(RAIZ, ARCH_CORS)}\n`);

let fallas = 0, oks = 0;
const ok = (q) => { oks++; console.log(` ok   ${q}`); };
const falla = (q, esp, obt) => {
  fallas++; console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esp}`);
  console.log(`        obtuvo:   ${obt}`);
};

(async () => {

// Sin esto, una lista vacía o un `APP_URL` vacío cumplirían por no haber nada
// que comparar.
if (!/^https:\/\/[a-z0-9.-]+$/.test(String(APP_URL)))
  sinPrecondicion('`APP_URL` no parece un origen https',
    [`obtuve: ${JSON.stringify(APP_URL)}`,
     'Si no es un origen, «está en el CORS» no quiere decir nada.']);
if (!todosLosOrigenes.length)
  sinPrecondicion('la lista de orígenes del bucket salió vacía',
    [`${path.basename(ARCH_CORS)} se parseó pero no trae ningún origen.`,
     'Con la lista vacía todo lo de abajo se mide contra la nada.']);

const HOST_APP = String(APP_URL).replace(/^https:\/\//, '');

// §1. El origen desde el que se sirve la app puede pedirle fotos al bucket.
// Es la comprobación que evita la pantalla sin imagen que no avisa.
if (reglasDe(APP_URL, 'GET').length)
  ok(`el origen de la app (${APP_URL}) puede traer las fotos del bucket`);
else falla('el origen de la app puede traer las fotos del bucket',
  `«${APP_URL}» exacto, con GET, en ${path.basename(ARCH_CORS)}`,
  `la lista dice: ${todosLosOrigenes.join(', ') || 'nada'}`);

// §2. Y el origen VIEJO también, mientras alguien tenga la app instalada ahí.
if (reglasDe(ORIGEN_VIEJO, 'GET').length)
  ok('el origen anterior sigue permitido: quien ya la instaló no pierde la evidencia');
else falla('el origen anterior sigue permitido',
  `«${ORIGEN_VIEJO}» exacto, con GET`,
  'se quitó — a quien tenga la app instalada desde ahí se le apagan las fotos ' +
  'sin un solo mensaje de error visible');

// §3. El pie del PDF de una organización sin dominio propio dice la dirección
// del PRODUCTO, la misma que enlazan los correos. Dibujado, no leído.
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
if (direccionesImpresas.length === 1 && direccionesImpresas[0] === HOST_APP)
  ok(`el PDF sin marca imprime la dirección del producto (${HOST_APP}), y sólo ésa`);
else falla('el PDF sin marca imprime la dirección del producto',
  `sólo «${HOST_APP}»`,
  `imprimió: ${direccionesImpresas.map(d => `«${d}»`).join(', ') || 'ninguna dirección'}`);

// §4. El remitente y el enlace son de la misma casa, y esa casa no es la del
// contratista. Un correo cuyo sobre y cuyo enlace no coinciden se parece a una
// suplantación; y si el sobre es del contratista, delata de quién es la app
// antes de que el lector decida nada.
const correoDe = (String(FROM_EMAIL).match(/<([^>]+)>/) || [, String(FROM_EMAIL)])[1];
const dominioRemitente = (correoDe.split('@')[1] || '').trim();
const registrable = (h) => h.split('.').slice(-3).join('.');
const mismaCasa = registrable(dominioRemitente) === registrable(HOST_APP);
const esDelContratista = [dominioRemitente, HOST_APP]
  .filter(h => h === CASA_DEL_CONTRATISTA || h.endsWith(`.${CASA_DEL_CONTRATISTA}`));
if (mismaCasa && !esDelContratista.length)
  ok(`el remitente (${dominioRemitente}) y el enlace son de la misma casa, y no es la del contratista`);
else falla('el remitente y el enlace son de la misma casa, y no es la del contratista',
  `el dominio de «${FROM_EMAIL}» y «${HOST_APP}» iguales, y ninguno bajo ${CASA_DEL_CONTRATISTA}`,
  esDelContratista.length
    ? `${esDelContratista.join(' y ')} es del contratista`
    : `remitente «${dominioRemitente}» contra enlace «${HOST_APP}»`);

console.log('');
if (fallas) {
  console.log('Cuatro archivos tecleando la misma dirección es una cuenta por');
  console.log('archivo, no una cuenta por número. Y la forma en que se nota es');
  console.log('la peor: una foto que no carga no da error, da una pantalla vacía.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);

})();
