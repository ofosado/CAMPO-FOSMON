#!/usr/bin/env node
// MODIFICAR UNA ORGANIZACIÓN NO LE BORRA LA MARCA AL CLIENTE
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// «¿Cómo ves si agregáramos un botón de modificar a las que ya fueron creadas?
// Por si hay que corregir algún cambio de ortografía o similar» (2026-11-26,
// después de entrar por primera vez a la pantalla de plataforma).
//
// El botón es fácil. Lo que no es fácil es que exista sin convertirse en la
// forma más rápida de borrarle la marca a un cliente, y la razón se midió ese
// mismo día contra `firestore.rules`:
//
//     match /orgs/{oid}/config/branding {
//       allow read:  if oid == orgId();        ← soporte trae `orgId: null`
//       allow write: if … || esSoporte();      ← a soporte sí lo nombra
//     }
//
// **`soporte` puede ESCRIBIR la marca y no puede LEERLA.** Un formulario de
// edición que pinte los campos vacíos cuando la lectura se negó, y los mande
// así al guardar, le cambia la razón social del ayuntamiento por una cadena
// vacía — y nadie lo nota hasta la siguiente demo, porque el encabezado
// simplemente sale en blanco.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. Las dos mitades se EXTRAEN y SE EJECUTAN:
//
//   · el `onCall` real, contra el Firestore de mentira compartido, mirando QUÉ
//     DOCUMENTOS quedaron escritos y con qué contenido;
//   · `marcaQueSeManda` de `App.jsx`, que es la cuenta que decide si el
//     formulario manda la marca o no la manda.
//
// La frontera entre las dos es `undefined`: el formulario manda `undefined`
// cuando no pudo leer, y el servidor lee `undefined` como «no traigo la
// marca». Las dos mitades se miden por separado porque un acuerdo entre dos
// piezas que nadie ejecuta junto es un acuerdo de palabra.
//
// Uso:
//   node scripts/prueba-modificar-una-org-no-le-borra-la-marca.cjs
//   node scripts/prueba-modificar-una-org-no-le-borra-la-marca.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCHIVO_FN = process.env.ARCHIVO_FUNCIONES || path.join(raiz, 'functions/index.js');
const ARCHIVO_APP = process.env.ARCHIVO_APP || path.join(raiz, 'src/App.jsx');
const CP = require('./contraprueba.cjs');

// ── LAS MUTACIONES DEL SERVIDOR ─────────────────────────────────────────────
// Cada una es una forma en que esto podría volver a borrar o a mentir.
const MUTANTES_FN = [
  { nombre: 'la marca se reescribe desde cero y se pierde lo que el formulario no manda (el logo)',
    de: `    marcaNueva = { ...marcaAntes, empresa };`,
    a:  `    marcaNueva = { empresa };` },
  { nombre: 'un campo vacío se escribe como vacío en vez de borrarse, y se ve como dato capturado',
    de: `      if (v) marcaNueva[k] = v;\n      else delete marcaNueva[k];`,
    a:  `      marcaNueva[k] = v;` },
  { nombre: 'la marca se toca aunque no venga, que es el borrado del que trata este banco',
    de: `  const traeMarca = branding !== undefined && branding !== null;`,
    a:  `  const traeMarca = true;` },
  { nombre: '`null` deja de contar como «no la traigo», y es lo que llega por el cable',
    de: `  const traeMarca = branding !== undefined && branding !== null;`,
    a:  `  const traeMarca = branding !== undefined;` },
  { nombre: 'el tipo se puede cambiar en silencio, y con él qué roles existen',
    de: `  if (tipo !== undefined && String(tipo) !== String(antes.tipo || "")) {`,
    a:  `  if (false) {` },
  { nombre: 'el nombre puede quedar vacío, que es lo que el cliente ve',
    de: `  if (nom !== undefined && !nom) {`,
    a:  `  if (false) {` },
  { nombre: 'se escribe sobre una organización que no existe',
    de: `  if (!snap.exists) {\n    throw new HttpsError(\n      "not-found",`,
    a:  `  if (false) {\n    throw new HttpsError(\n      "not-found",` },
  { nombre: 'cualquier admin de cualquier cliente puede renombrar a otro cliente',
    de: `  if (!ambitoDe(perfilLlamador).cross) {`,
    a:  `  if (false) {` },
  { nombre: 'la comparación de marcas vuelve a depender del orden de las llaves',
    de: `  const llaves = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);`,
    a:  `  const llaves = new Set(Object.keys(a || {}));` },
];

// ── LA MUTACIÓN DE LA PANTALLA ──────────────────────────────────────────────
// Una sola, y es la que de verdad borra: que el formulario mande la marca en
// blanco cuando no pudo leerla.
const MUTANTES_APP = [
  { nombre: 'el formulario manda la marca en blanco cuando la lectura se negó',
    de: `  (marca === false || marca === null || typeof marca !== 'object')`,
    a:  `  (marca === null)` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES_FN, fs.readFileSync(ARCHIVO_FN, 'utf8'),
    { archivo: ARCHIVO_FN, callado: !!process.env.CALLADO });
  CP.exigirAnclajes(MUTANTES_APP, fs.readFileSync(ARCHIVO_APP, 'utf8'),
    { archivo: ARCHIVO_APP, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  // Dos archivos, dos corridas: cada mutación tiene que llegar al proceso hijo
  // por la variable que ese archivo lee, y mezclarlas haría que la mitad se
  // aplicara sobre un archivo que nadie mira.
  const sFn = CP.correr({ mutaciones: MUTANTES_FN, src: fs.readFileSync(ARCHIVO_FN, 'utf8'),
    archivo: ARCHIVO_FN, extension: '.js',
    comoCorrer: (ruta) => ({ args: [], env: { ARCHIVO_FUNCIONES: ruta, CALLADO: '1' } }) });
  const sApp = CP.correr({ mutaciones: MUTANTES_APP, src: fs.readFileSync(ARCHIVO_APP, 'utf8'),
    archivo: ARCHIVO_APP, extension: '.jsx',
    comoCorrer: (ruta) => ({ args: [], env: { ARCHIVO_APP: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(sFn + sApp, MUTANTES_FN.length + MUTANTES_APP.length));
}

const { baseFalsa, montar } = require('./montar-trabajo-de-funciones.cjs');
const { deArchivo } = require('./extraer-de-app.cjs');

let marcaQueSeManda;
try {
  ({ marcaQueSeManda } = deArchivo(ARCHIVO_APP, 'marcaQueSeManda'));
} catch (e) {
  noArranco([`no se pudo extraer \`marcaQueSeManda\`: ${e.message}`], 'src/App.jsx');
}

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const seccion = (t) => console.log(`\n${t}`);

// El padrón: `requireAdmin` lee `usuarios/{correo con _ en vez de @ y .}`.
const idDe = (correo) => correo.replace(/[@.]/g, '_');
const SOPORTE = { email: 'soporte@cotea.com.mx', rol: 'soporte', orgId: null };
const DIR_DEP = { email: 'oscar@coatzacoalcos.gob.mx', rol: 'director_obras', orgId: 'coatzacoalcos' };

// La marca de Coatzacoalcos como está en producción, con un campo que el
// formulario NO edita: el logo. Que sobreviva es media prueba.
const MARCA_VIVA = {
  empresa: 'H. Ayuntamiento de Coatzacoalcos',
  empresaCorta: 'COATZACOALCOS',
  dominio: 'coatzacoalcos.gob.mx',
  logoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/logo.png?alt=media&token=t',
};

const llamar = async (quien, data, { conMarca = true, nombreOrg = 'H. Ayuntamiento de Coatzacoalco' } = {}) => {
  const semilla = {
    [`usuarios/${idDe(quien.email)}`]: quien,
    'orgs/coatzacoalcos': { nombre: nombreOrg, tipo: 'dependencia', activa: true },
  };
  if (conMarca) semilla['orgs/coatzacoalcos/config/branding'] = { ...MARCA_VIVA };
  const base = baseFalsa(semilla);
  const handler = montar(ARCHIVO_FN, 'actualizarOrganizacion', base);
  const peticion = { auth: { token: { email: quien.email } }, data };
  try {
    const valor = await handler(peticion);
    return { ok: true, valor, base };
  } catch (e) {
    return { ok: false, code: e.code, mensaje: e.message, base };
  }
};

const marcaDe = (base) => base.docs.get('orgs/coatzacoalcos/config/branding');
const orgDe = (base) => base.docs.get('orgs/coatzacoalcos');

(async () => {
console.log('\n── MODIFICAR UNA ORG NO LE BORRA LA MARCA ──');

// ══════════════════════════════════════════════════════════════════════════
seccion('§1 · quién puede corregir el nombre de un cliente');
// ══════════════════════════════════════════════════════════════════════════
const porDirDep = await llamar(DIR_DEP, { orgId: 'coatzacoalcos', nombre: 'Otro nombre' });
check(!porDirDep.ok && porDirDep.code === 'permission-denied',
  'el director de Obras Públicas de un municipio NO renombra organizaciones',
  porDirDep.ok ? 'LA MODIFICÓ' : String(porDirDep.code));
check(porDirDep.base.escrituras.length === 0,
  'y no escribió nada al intentarlo',
  `${porDirDep.base.escrituras.length} escritura(s)`);

const ortografia = await llamar(SOPORTE,
  { orgId: 'coatzacoalcos', tipo: 'dependencia', nombre: 'H. Ayuntamiento de Coatzacoalcos' });
check(ortografia.ok && orgDe(ortografia.base).nombre === 'H. Ayuntamiento de Coatzacoalcos',
  'soporte sí: la «s» que faltaba queda corregida',
  ortografia.ok ? orgDe(ortografia.base).nombre : String(ortografia.code));
check(String(orgDe(ortografia.base).modificadaPor) === SOPORTE.email,
  'y queda escrito quién la corrigió',
  String(orgDe(ortografia.base).modificadaPor));

// ══════════════════════════════════════════════════════════════════════════
seccion('§2 · lo que no se corrige: revienta, y no escribe a medias');
// ══════════════════════════════════════════════════════════════════════════
const otroTipo = await llamar(SOPORTE,
  { orgId: 'coatzacoalcos', tipo: 'constructora', nombre: 'H. Ayuntamiento de Coatzacoalcos' });
check(!otroTipo.ok && otroTipo.code === 'failed-precondition',
  'cambiar el tipo se rechaza: decide qué roles existen',
  otroTipo.ok ? 'LO CAMBIÓ' : String(otroTipo.code));
check(otroTipo.base.escrituras.length === 0,
  'y el nombre que venía en la misma llamada tampoco se escribió',
  `${otroTipo.base.escrituras.length} escritura(s)`);

const noExiste = await llamar(SOPORTE, { orgId: 'minatitlan', nombre: 'Municipio de Minatitlán' });
check(!noExiste.ok && noExiste.code === 'not-found',
  'una organización que no existe no se crea por la puerta de atrás',
  noExiste.ok ? 'LA CREÓ' : String(noExiste.code));
check(noExiste.base.escrituras.length === 0,
  'sin escribir nada', `${noExiste.base.escrituras.length} escritura(s)`);

for (const malo of ['', 'Coatzacoalcos', 'orgs/coatzacoalcos', '.']) {
  const r = await llamar(SOPORTE, { orgId: malo, nombre: 'x' });
  check(!r.ok && r.code === 'invalid-argument',
    `«${malo}» no sirve como identificador`,
    r.ok ? 'LO ACEPTÓ' : String(r.code));
}

const sinNombre = await llamar(SOPORTE, { orgId: 'coatzacoalcos', nombre: '   ' });
check(!sinNombre.ok && sinNombre.code === 'invalid-argument',
  'el nombre no puede quedar vacío: es lo que el cliente ve',
  sinNombre.ok ? 'LO VACIÓ' : String(sinNombre.code));
check(sinNombre.base.escrituras.length === 0,
  'y no escribió nada', `${sinNombre.base.escrituras.length} escritura(s)`);

// ══════════════════════════════════════════════════════════════════════════
seccion('§3 · la marca que no viene NO se toca (el defecto de este banco)');
// ══════════════════════════════════════════════════════════════════════════
// Esto es el caso real de hoy: soporte no puede leer la marca, así que el
// formulario manda `branding: undefined` y sólo corrige el nombre.
const soloNombre = await llamar(SOPORTE,
  { orgId: 'coatzacoalcos', tipo: 'dependencia', nombre: 'Ayuntamiento de Coatzacoalcos' });
check(soloNombre.ok, 'una llamada sin marca pasa', soloNombre.ok ? '' : String(soloNombre.code));
const m1 = marcaDe(soloNombre.base);
check(m1 && m1.empresa === MARCA_VIVA.empresa && m1.empresaCorta === MARCA_VIVA.empresaCorta
      && m1.dominio === MARCA_VIVA.dominio && m1.logoUrl === MARCA_VIVA.logoUrl,
  'y la marca del cliente queda EXACTAMENTE como estaba, los cuatro campos',
  m1 ? JSON.stringify(m1).slice(0, 90) : 'LA BORRÓ');
check(!soloNombre.base.escrituras.some(e => e.ruta.endsWith('config/branding')),
  'no se escribió ni una vez en el documento de la marca',
  soloNombre.base.escrituras.map(e => e.ruta).join(', '));
// `?.`: con la guardia del `branding !== undefined` quitada, esta llamada se
// niega y no hay `valor`. Eso tiene que salir en ROJO por las aserciones de
// arriba, no reventar el banco — un banco que se cae no midió nada.
check(soloNombre.valor?.marca === null,
  'y la respuesta lo dice: no hubo cambio de marca que registrar en la bitácora',
  soloNombre.ok ? JSON.stringify(soloNombre.valor?.marca) : `se negó: ${soloNombre.code}`);

// ══════════════════════════════════════════════════════════════════════════
seccion('§4 · la marca que SÍ viene: vacío borra, ausente conserva');
// ══════════════════════════════════════════════════════════════════════════
const conMarca = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'H. Ayuntamiento de Coatzacoalco',
  branding: { empresa: 'Ayuntamiento de Coatzacoalcos, Ver.', empresaCorta: '', dominio: 'coatza.gob.mx' } });
check(conMarca.ok, 'pasa', conMarca.ok ? '' : String(conMarca.code));
const m2 = marcaDe(conMarca.base) || {};
check(m2.empresa === 'Ayuntamiento de Coatzacoalcos, Ver.',
  'la razón social corregida queda', String(m2.empresa));
check(!('empresaCorta' in m2),
  'el nombre corto vaciado a propósito se BORRA, no se guarda en blanco',
  'empresaCorta' in m2 ? `quedó «${m2.empresaCorta}»` : 'borrado');
check(m2.dominio === 'coatza.gob.mx', 'el dominio nuevo queda', String(m2.dominio));
check(m2.logoUrl === MARCA_VIVA.logoUrl,
  'y el logo, que este formulario no edita, SOBREVIVE',
  m2.logoUrl ? 'intacto' : 'SE PERDIÓ');

const sinRazon = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'Ayuntamiento de Coatzacoalcos',
  branding: { empresa: '  ', empresaCorta: 'COATZA', dominio: '' } });
check(sinRazon.ok && marcaDe(sinRazon.base)?.empresa === 'Ayuntamiento de Coatzacoalcos',
  'la razón social vacía cae al nombre —el mismo dato—, no a una cadena vacía',
  sinRazon.ok ? String(marcaDe(sinRazon.base)?.empresa) : String(sinRazon.code));

const sinDoc = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'Ayuntamiento de Coatzacoalcos', branding: { empresa: 'Ayto. de Coatza' } },
  { conMarca: false });
// Sin `?.`: con `mismaMarca` mirando sólo las llaves de la marca GUARDADA
// —que aquí no existe—, esto decide «no hay cambio» y el documento no se crea
// nunca. Tiene que salir en rojo, no reventar el banco.
check(sinDoc.ok && marcaDe(sinDoc.base)?.empresa === 'Ayto. de Coatza',
  'una organización vieja sin documento de marca lo estrena sin reventar',
  sinDoc.ok ? (marcaDe(sinDoc.base) ? 'creado' : 'NO LO CREÓ') : String(sinDoc.code));

for (const basura of [[], 'texto', 42]) {
  const r = await llamar(SOPORTE,
    { orgId: 'coatzacoalcos', tipo: 'dependencia', nombre: 'x', branding: basura });
  check(!r.ok && r.code === 'invalid-argument',
    `\`branding: ${JSON.stringify(basura)}\` se rechaza en vez de interpretarse`,
    r.ok ? 'LO ACEPTÓ' : String(r.code));
}

// ── Y EL CASO QUE EL BANCO NO PODÍA VER ───────────────────────────────────
// `null` llega por el cable cuando el formulario manda `undefined`: el
// transporte de una callable no lleva `undefined` y el SDK lo serializa como
// `null`. Medido en el preview el 2026-11-26, con la regla de verdad
// negándole la lectura a soporte: el servidor contestaba «`branding` tiene
// que ser un objeto» y el botón no servía para nada. Esto es ESE caso.
const porElCable = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'H. Ayuntamiento de Coatzacoalcos, Ver.', branding: null });
check(porElCable.ok,
  '`branding: null` —lo que de verdad llega— se lee como «no la traigo», no como basura',
  porElCable.ok ? '' : `${porElCable.code}: ${String(porElCable.mensaje).slice(0, 70)}`);
const mCable = marcaDe(porElCable.base);
check(mCable && mCable.empresa === MARCA_VIVA.empresa && mCable.logoUrl === MARCA_VIVA.logoUrl,
  'y la marca queda intacta, los campos que el formulario no edita incluidos',
  mCable ? 'intacta' : 'BORRADA');
check(orgDe(porElCable.base).nombre === 'H. Ayuntamiento de Coatzacoalcos, Ver.',
  'mientras el nombre sí se corrige, que es para lo que sirve el botón hoy',
  String(orgDe(porElCable.base).nombre));

// ══════════════════════════════════════════════════════════════════════════
seccion('§5 · «no había nada distinto» no se reporta como un cambio');
// ══════════════════════════════════════════════════════════════════════════
const igual = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'H. Ayuntamiento de Coatzacoalco',
  branding: { empresa: MARCA_VIVA.empresa, empresaCorta: MARCA_VIVA.empresaCorta,
              dominio: MARCA_VIVA.dominio } },
  { nombreOrg: 'H. Ayuntamiento de Coatzacoalco' });
check(igual.ok && igual.valor.sinCambios === true,
  'guardar lo mismo contesta «sin cambios», no un éxito inventado',
  igual.ok ? JSON.stringify(igual.valor) : String(igual.code));
check(igual.base.escrituras.length === 0,
  'y no gasta una escritura en reafirmar lo que ya estaba',
  `${igual.base.escrituras.length} escritura(s)`);

// Y el orden de las llaves no es un cambio. El 2026-11-24 una comparación por
// `JSON.stringify` declaró «DIFIERE» una marca idéntica al revés.
const alReves = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'H. Ayuntamiento de Coatzacoalco',
  branding: { dominio: MARCA_VIVA.dominio, empresaCorta: MARCA_VIVA.empresaCorta,
              empresa: MARCA_VIVA.empresa } },
  { nombreOrg: 'H. Ayuntamiento de Coatzacoalco' });
check(alReves.ok && alReves.valor.sinCambios === true,
  'la misma marca con las llaves en otro orden sigue siendo la misma marca',
  alReves.ok ? JSON.stringify(alReves.valor) : String(alReves.code));

// ══════════════════════════════════════════════════════════════════════════
seccion('§6 · lo que el formulario manda cuando NO pudo leer la marca');
// ══════════════════════════════════════════════════════════════════════════
// Aquí vive el borrado. `false` es «la regla me negó la lectura»; `null`, «la
// lectura todavía no llega». Las dos tienen que salir como `undefined`.
check(marcaQueSeManda(false) === undefined,
  'lectura negada → `undefined`, que el servidor lee como «no traigo la marca»',
  String(JSON.stringify(marcaQueSeManda(false))));
check(marcaQueSeManda(null) === undefined,
  'lectura que no llegó → `undefined` también',
  String(JSON.stringify(marcaQueSeManda(null))));
const mandada = marcaQueSeManda({ empresa: 'A', empresaCorta: 'B', dominio: 'c.mx', logoUrl: 'z' });
check(mandada && mandada.empresa === 'A' && mandada.empresaCorta === 'B' && mandada.dominio === 'c.mx',
  'lectura buena → van las tres claves que el formulario edita',
  JSON.stringify(mandada));
check(mandada && !('logoUrl' in mandada),
  'y el logo NO viaja: lo que el formulario no edita no lo manda',
  'logoUrl' in (mandada || {}) ? 'LO MANDÓ' : 'fuera');

// Y las dos mitades, juntas: lo que el formulario manda con la lectura negada,
// metido en la llamada de verdad, deja la marca intacta. El acuerdo entre las
// dos piezas se ejecuta, no se declara.
const comoEnProduccion = await llamar(SOPORTE, { orgId: 'coatzacoalcos', tipo: 'dependencia',
  nombre: 'H. Ayuntamiento de Coatzacoalcos', branding: marcaQueSeManda(false) });
const m3 = marcaDe(comoEnProduccion.base);
check(comoEnProduccion.ok && m3 && m3.empresa === MARCA_VIVA.empresa && m3.logoUrl === MARCA_VIVA.logoUrl,
  'formulario con lectura negada + servidor real = la marca del cliente intacta',
  m3 ? 'intacta' : 'BORRADA');

// ══════════════════════════════════════════════════════════════════════════
seccion('§7 · y la pantalla usa esa cuenta, no una copia suya');
// ══════════════════════════════════════════════════════════════════════════
// Una función correcta que nadie llama no arregla nada.
const app = fs.readFileSync(ARCHIVO_APP, 'utf8');
check(/branding:\s*marcaQueSeManda\(marca\)/.test(app),
  'el modal manda `marcaQueSeManda(marca)`, no un objeto armado a mano',
  /branding:\s*marcaQueSeManda\(/.test(app) ? '' : 'NO la llama');
check(!/branding:\s*marca\s*===\s*false\s*\?/.test(app),
  'y no quedó la versión vieja, que armaba las tres claves en el `onClick`');

console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
  ? 'una falta de ortografía se corrige sin que el cliente pierda su marca.'
  : 'el botón de modificar puede dejar a un cliente sin razón social.'}\n`);
process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  noArranco([`el banco reventó: ${e && e.stack ? e.stack : e}`], 'functions/index.js');
});
