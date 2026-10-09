#!/usr/bin/env node
// Prueba de INTEGRACIÓN: la subcolección de evidencia se puede escribir, leer y
// listar de verdad — y NO se puede borrar, por nadie, en ninguno de los dos
// caminos.
//
// Por qué existe. Dos razones, y las dos son de las caras:
//
//   · El #31. La ruta `obras/{id}/evidencia/{eid}` NO tenía regla en el bloque
//     de constructora, que es donde están las cinco obras de producción. Sin
//     regla, la ruta cae en el `match /{document=**}` final que deniega todo, y
//     como las escrituras pasan por helpers que se tragan el fallo, la
//     migración y la captura habrían parecido funcionar sin guardar nada. Eso
//     ya pasó tres años con el histórico de subcontratos.
//
//   · El §7.7 del alcance municipal: en una obra pública la evidencia retirada
//     es parte del expediente. No se borra, se anula con motivo. Y la regla de
//     dependencia —la que ese párrafo gobierna— decía lo contrario: `delete`
//     abierto a los directivos y `update` sin acotar, mientras el supervisor
//     que sube la foto equivocada no podía corregir nada.
//
//   · Y el #31 OTRA VEZ, en la bandera. `obras/{id}/config/evidencia` tampoco
//     tenía regla. Ese documento decide de qué fuente lee la galería, y `fsGet`
//     devuelve `null` cuando la lectura rebota — y `null` se lee como «esta
//     obra no está migrada». O sea: la migración habría escrito la subcolección
//     entera y la pantalla habría seguido con el mapa viejo para siempre, sin
//     un solo mensaje. Lo atrapó el recorrido del preview contando fotos, no la
//     suite: los bancos ejecutaban `evidenciaDeObra` con la bandera en la mano
//     en vez de LEERLA. Por eso la sección 7 la lee de Firestore y hace lo que
//     hace la app con lo que le llegue, incluida la tragada del fallo.
//
// No comprueba que el `match` exista en el archivo: un `match` puede existir y
// no aplicar. Intenta las operaciones contra un Firestore de verdad con las
// reglas puestas y mira qué pasa.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-reglas-evidencia.cjs

const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc,
        deleteDoc, collection, getDocs } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const noArranco = require('./no-arranco.cjs');
// Si este banco revienta, es NO ARRANCÓ (2) y no rojo (1). Ver `no-arranco`.
noArranco.vigilarExcepciones();

// ── La lectura de la galería, extraída del archivo y EJECUTADA ──────────────
// La sección 7 no afirma «la regla existe»: afirma qué frase sale en el
// encabezado de la galería cuando la bandera se lee de un Firestore con las
// reglas puestas. Para eso hacen falta las piezas de verdad, no una copia.
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const fuente = fs.readFileSync(path.join(raiz, 'src/App.jsx'), 'utf8');
const piezas = {};
traverse(parse(fuente, { sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'] }), {
  // `fechaDeTimestamp` es una declaración de función hoisteada, no un `const`.
  FunctionDeclaration(p) {
    if (!p.node.id || p.getFunctionParent()) return;
    if (!(p.node.id.name in piezas)) piezas[p.node.id.name] = fuente.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init || p.getFunctionParent()) return;
    if (!(p.node.id.name in piezas)) piezas[p.node.id.name] = fuente.slice(p.node.init.start, p.node.init.end);
  },
});
const NECESARIAS = ['ORIGEN_LEGADO', 'ORIGEN_EN_VIVO', 'fechaDeTimestamp',
  'evidenciaNormalizada', 'idDePartida', 'evidenciaMigrada', 'evidenciaDeObra',
  'evidenciaVigente', 'fraseOrigenEvidencia'];
const sinEncontrar = NECESARIAS.filter(n => !(n in piezas));
if (sinEncontrar.length) {
  console.error('No se encontraron estas piezas en src/App.jsx: ' + sinEncontrar.join(', '));
  console.error('Si el corte por obra se reescribió, esta prueba hay que rehacerla:');
  console.error('la bandera sigue teniendo que poder LEERSE, o la migración es inerte.');
  process.exit(2);
}
// `fraseEncabezado(cfg, docs, subs)` es literalmente lo que la galería imprime
// entre paréntesis en su encabezado.
const fraseEncabezado = new Function('cfg', 'docs', 'subs', `"use strict";
${NECESARIAS.map(n => `const ${n} = ${piezas[n]};`).join('\n')}
const lista = evidenciaDeObra({ cfgEvidencia: cfg, docsEvidencia: docs, subs });
const vig = evidenciaVigente(lista);
return { frase: fraseOrigenEvidencia(vig), cuantas: vig.length };`);

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';
const OBRA = '0126';
const ORG_DEP = 'minatitlan';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenDe = (uid, claims) => {
  const ahora = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({ iss: `prueba@${PROYECTO}.iam.gserviceaccount.com`,
          sub: `prueba@${PROYECTO}.iam.gserviceaccount.com`,
          aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
          iat: ahora, exp: ahora + 3600, uid, claims }),
    '',
  ].join('.');
};

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
// Se mira `code`, no el texto: el emulador manda `permission-denied` con un
// mensaje que no dice "permission" sino `false for 'update' @ L340`.
//
// Y en los `update` que deniega el `hasOnly` el mensaje dice algo peor:
// `evaluation error at L340:26`, que se lee como "tu regla está mal escrita".
// NO lo está. Esto costó una hora, así que queda escrito:
//
//   Aislado contra un proyecto desechable, sin un solo helper de por medio,
//   con estas cuatro líneas de regla y nada más:
//
//     match /zdiff/{id} {
//       allow read, create: if true;
//       allow update: if request.resource.data.diff(resource.data)
//                          .affectedKeys().hasOnly(['a']);
//     }
//
//   `updateDoc({a:9})` → PASÓ.  `updateDoc({b:3})` → `evaluation error at
//   L6:24`. Es el idioma documentado de Firebase, en su forma mínima: el jar
//   del emulador (cloud-firestore-emulator-v1.21.0) levanta un error de
//   evaluación en vez de devolver `false` cuando el `hasOnly` no se cumple.
//
// La consecuencia práctica es que deniega, que es lo que queremos, y por eso
// `denegado()` lo acepta: el `code` que llega al cliente sigue siendo
// `permission-denied`. Lo que engaña es el texto. Si alguien ve ese mensaje y
// sale a reescribir la regla, está persiguiendo un defecto del emulador.
const denegado = e => e?.code === 'permission-denied' ||
  /permission[-_ ]?denied/i.test(e?.message || '');
const intentar = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// Una foto con la forma que escribe `evid.agregar`.
const FOTO = (n) => ({
  urlOriginal: `https://storage/${n}.jpg`,
  rutaStorage: `obras/${OBRA}/fotos/avance_p1/${n}`,
  partidaId: 'p1', partidaClave: '1.1', partidaDesc: 'Terracerías',
  origen: 'captura_en_vivo', capturadaPor: 'uid-quien-sea',
  fechaDeclarada: '2026-10-08', anulada: false,
});
const ANULACION = { anulada: true, motivoAnulacion: 'es de otra partida, me equivoqué',
                    anuladaPor: 'quien@sea.mx', anuladaEn: '2026-10-08T17:00:00Z' };

(async () => {
  const abrir = async (nombre, uid, claims) => {
    const app = initializeApp({ projectId: PROYECTO, apiKey: 'emulador' }, nombre);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });
    await signInWithCustomToken(auth, tokenDe(uid, claims));
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PUERTO);
    return db;
  };

  const sello = Date.now();
  let residente;
  try {
    residente = await abrir(`res-${sello}`, 'residente-0126', {
      tipo: 'constructora', rol: 'residente', orgId: 'fosmon', todas: false, obras: [OBRA],
    });
  } catch (e) {
    console.error(`\nNo hay emuladores escuchando en ${HOST}:${PUERTO}/${PUERTO_AUTH}.\n` +
      `Arráncalos con:\n  firebase emulators:start --only firestore,auth --project ${PROYECTO}\n\n(${e.message})`);
    process.exit(1);
  }

  // Se limpia ANTES, no sólo después. Este banco cuenta documentos —«la
  // subcolección se puede LISTAR» afirma que se leen DOS— y un emulador con
  // restos de otra sesión lo pone en rojo por una razón que no tiene nada que
  // ver con las reglas. Pasó: unos documentos de un bisect anterior dejaron la
  // cuenta en once y el resumen de la suite dijo «reglas-evidencia ROJO», que
  // es exactamente el rojo falso que hace desconfiar de la suite entera.
  const limpiar = () =>
    fetch(`http://${HOST}:${PUERTO}/emulator/v1/projects/${PROYECTO}/databases/(default)/documents`,
      { method: 'DELETE' }).catch(() => {});
  await limpiar();

  const RUTA_C = ['obras', OBRA, 'evidencia'];

  // ── 1. LA PREGUNTA DEL #31 ──────────────────────────────────────────────
  console.log('1. La ruta de evidencia de constructora acepta captura de verdad');
  let e1 = await intentar(() => setDoc(doc(residente, ...RUTA_C, 'ev1'), FOTO('a')));
  check(!e1, 'el residente de la obra puede crear un documento de evidencia',
    e1 ? `DENEGADA: ${e1.message}` : 'ev1');
  if (e1) {
    console.log('\nEsto es el #31 otra vez: la ruta no tiene regla que la permita.');
    console.log('NO migrar ni desplegar hasta que esto salga en verde: la captura');
    console.log('rebotaría en silencio y la pantalla parecería funcionar.');
    process.exit(1);
  }
  await setDoc(doc(residente, ...RUTA_C, 'ev2'), FOTO('b'));

  const leido = (await getDoc(doc(residente, ...RUTA_C, 'ev1'))).data();
  check(leido?.urlOriginal === 'https://storage/a.jpg', 'y volver a leerlo');
  check(leido?.rutaStorage === `obras/${OBRA}/fotos/avance_p1/a`,
    'con su `rutaStorage`, que es lo que cierra el #30', leido?.rutaStorage);

  // Listar no es leer. Son permisos distintos en Firestore, y la galería LISTA.
  let claves = [];
  const eL = await intentar(async () => {
    const snap = await getDocs(collection(residente, ...RUTA_C));
    snap.forEach(d => claves.push(d.id));
  });
  check(!eL && claves.length === 2, 'la subcolección se puede LISTAR, no sólo leer una a una',
    eL ? `DENEGADA: ${eL.message}` : claves.sort().join(', '));

  // ── 2. NO SE BORRA, SE ANULA (§7.7) ─────────────────────────────────────
  console.log('\n2. Nadie puede borrar una foto del expediente');
  const eDelRes = await intentar(() => deleteDoc(doc(residente, ...RUTA_C, 'ev1')));
  check(eDelRes && denegado(eDelRes), 'el residente no puede borrarla',
    eDelRes ? 'rebotó' : 'LA BORRÓ');

  const directivo = await abrir(`dir-${sello}`, 'director-fosmon', {
    tipo: 'constructora', rol: 'director_general', orgId: 'fosmon', todas: true, obras: [],
  });
  const eDelDir = await intentar(() => deleteDoc(doc(directivo, ...RUTA_C, 'ev1')));
  check(eDelDir && denegado(eDelDir),
    'ni un director general: una foto que se puede borrar no es evidencia de nada',
    eDelDir ? 'rebotó' : 'LA BORRÓ');
  check((await getDoc(doc(residente, ...RUTA_C, 'ev1'))).exists(),
    'y la foto sigue ahí después de los dos intentos');

  // ── 3. ANULAR SÍ, CAMBIAR LA FOTO NO ────────────────────────────────────
  console.log('\n3. Quien captura puede anular con motivo, y nada más');
  // Quien se equivoca al subir es el supervisor que está en campo, sin nadie a
  // quien escalarle desde un teléfono. Por eso anula quien captura.
  const eAnu = await intentar(() => updateDoc(doc(residente, ...RUTA_C, 'ev1'), ANULACION));
  check(!eAnu, 'el residente anula su propia foto',
    eAnu ? `DENEGADA: ${eAnu.message}` : 'anulada con motivo');
  const tras = (await getDoc(doc(residente, ...RUTA_C, 'ev1'))).data();
  check(tras?.anulada === true && tras?.motivoAnulacion === ANULACION.motivoAnulacion,
    'y el motivo queda escrito en el documento', tras?.motivoAnulacion);
  check(tras?.urlOriginal === 'https://storage/a.jpg',
    'la foto NO se tocó: sigue siendo la misma imagen', tras?.urlOriginal);

  // Lo que no puede: cambiar la foto por otra. Eso sería borrar con otro
  // nombre — el documento sobrevive y la evidencia no.
  const eUrl = await intentar(() => updateDoc(doc(residente, ...RUTA_C, 'ev1'),
    { urlOriginal: 'https://storage/otra.jpg' }));
  check(eUrl && denegado(eUrl), 'no puede cambiar la imagen por otra',
    eUrl ? 'rebotó' : 'LA SUSTITUYÓ');
  const eMix = await intentar(() => updateDoc(doc(residente, ...RUTA_C, 'ev2'),
    { ...ANULACION, partidaId: 'p9' }));
  check(eMix && denegado(eMix),
    'ni colar un campo de más junto a la anulación',
    eMix ? 'rebotó' : 'PASÓ — la anulación es un caballo de Troya');
  check((await getDoc(doc(residente, ...RUTA_C, 'ev2'))).data()?.anulada === false,
    'y ese intento no anuló nada a medias');

  // ── 4. EL CLIENTE VE SU OBRA, PERO NO LA TOCA ───────────────────────────
  console.log('\n4. El cliente lee la galería — es la pantalla que se le enseña');
  const cliente = await abrir(`cli-${sello}`, 'cliente-0126', {
    tipo: 'constructora', rol: 'cliente', orgId: 'fosmon', todas: false, obras: [OBRA],
  });
  let clavesCli = [];
  const eRC = await intentar(async () => {
    const snap = await getDocs(collection(cliente, ...RUTA_C));
    snap.forEach(d => clavesCli.push(d.id));
  });
  check(!eRC && clavesCli.length === 2,
    'el cliente SÍ lista la evidencia de su obra: sin esto la galería sale vacía',
    eRC ? `DENEGADA: ${eRC.message}` : `${clavesCli.length} foto(s)`);
  const eWC = await intentar(() => setDoc(doc(cliente, ...RUTA_C, 'cli1'), FOTO('x')));
  check(eWC && denegado(eWC), 'pero no puede subir evidencia', eWC ? 'rebotó' : 'SUBIÓ');
  const eAC = await intentar(() => updateDoc(doc(cliente, ...RUTA_C, 'ev2'), ANULACION));
  check(eAC && denegado(eAC), 'ni anular la de nadie', eAC ? 'rebotó' : 'ANULÓ');

  // ── 5. LAS REGLAS DISCRIMINAN ───────────────────────────────────────────
  console.log('\n5. Esto no está abierto de par en par');
  const ajeno = await abrir(`aje-${sello}`, 'residente-0127', {
    tipo: 'constructora', rol: 'residente', orgId: 'fosmon', todas: false, obras: ['0127'],
  });
  const eWA = await intentar(() => setDoc(doc(ajeno, ...RUTA_C, 'aj1'), FOTO('z')));
  check(eWA && denegado(eWA), 'un residente de OTRA obra no puede escribir aquí',
    eWA ? 'rebotó' : 'ESCRIBIÓ');
  const eRA = await intentar(() => getDoc(doc(ajeno, ...RUTA_C, 'ev1')));
  check(eRA && denegado(eRA), 'ni leer la evidencia de esta', eRA ? 'rebotó' : 'LEYÓ');

  // ── 6. EL CAMINO MUNICIPAL, QUE ES EL QUE EL §7.7 GOBIERNA ──────────────
  console.log('\n6. En la obra municipal tampoco se borra, y el supervisor sí anula');
  const RUTA_D = ['orgs', ORG_DEP, 'obras', OBRA, 'evidencia'];
  const supervisor = await abrir(`sup-${sello}`, 'supervisor-0126', {
    tipo: 'dependencia', rol: 'supervisor_obra', orgId: ORG_DEP, todas: false, obras: [OBRA],
  });
  const eCS = await intentar(() => setDoc(doc(supervisor, ...RUTA_D, 'd1'), FOTO('m')));
  check(!eCS, 'el supervisor de obra captura evidencia en su obra',
    eCS ? `DENEGADA: ${eCS.message}` : 'd1');
  if (!eCS) await setDoc(doc(supervisor, ...RUTA_D, 'd2'), FOTO('n'));

  // Lo que estaba al revés: el supervisor no podía corregir su propio error.
  const eAS = await intentar(() => updateDoc(doc(supervisor, ...RUTA_D, 'd1'), ANULACION));
  check(!eAS, 'y puede anular la que subió por equivocación',
    eAS ? `DENEGADA: ${eAS.message}` : 'anulada con motivo');
  const eUS = await intentar(() => updateDoc(doc(supervisor, ...RUTA_D, 'd2'),
    { urlOriginal: 'https://storage/otra.jpg' }));
  check(eUS && denegado(eUS), 'pero no cambiar la imagen', eUS ? 'rebotó' : 'LA SUSTITUYÓ');

  const dirDep = await abrir(`dirdep-${sello}`, 'director-obras', {
    tipo: 'dependencia', rol: 'director_obras', orgId: ORG_DEP, todas: true, obras: [],
  });
  const eDS = await intentar(() => deleteDoc(doc(supervisor, ...RUTA_D, 'd1')));
  check(eDS && denegado(eDS), 'el supervisor no puede borrarla', eDS ? 'rebotó' : 'LA BORRÓ');
  const eDD = await intentar(() => deleteDoc(doc(dirDep, ...RUTA_D, 'd1')));
  check(eDD && denegado(eDD),
    'y el director de Obras Públicas tampoco: es el §7.7, no una cortesía',
    eDD ? 'rebotó' : 'LA BORRÓ — la evidencia municipal se puede desaparecer');
  const eDU = await intentar(() => updateDoc(doc(dirDep, ...RUTA_D, 'd2'),
    { urlOriginal: 'https://storage/otra.jpg' }));
  check(eDU && denegado(eDU), 'ni sustituir la imagen de una foto ya subida',
    eDU ? 'rebotó' : 'LA SUSTITUYÓ');
  check((await getDoc(doc(supervisor, ...RUTA_D, 'd1'))).exists(),
    'después de los tres intentos la foto sigue en el expediente');

  // El contratista no entra al expediente municipal (la frontera del margen al
  // revés: tampoco lee lo que la dependencia levantó sobre él).
  const contratista = await abrir(`con-${sello}`, 'residente-fosmon', {
    tipo: 'constructora', rol: 'residente', orgId: 'fosmon', todas: true, obras: [],
  });
  const eRCo = await intentar(() => getDoc(doc(contratista, ...RUTA_D, 'd1')));
  check(eRCo && denegado(eRCo), 'y una sesión de constructora no lee el path municipal',
    eRCo ? 'rebotó' : 'LEYÓ');

  // ── 7. LA BANDERA DEL CORTE: EL #31 EN EL INTERRUPTOR ───────────────────
  //
  // `config/evidencia.migrada` decide de qué fuente lee la galería. Si la
  // lectura rebota, `fsGet` se la traga y devuelve `null`, y `null` significa
  // «sin migrar»: la pantalla se va al mapa viejo con la subcolección llena al
  // lado. No hay error, no hay pantalla en blanco, no hay nada. Sólo una
  // galería que dice algo distinto de lo que hay guardado.
  //
  // Así que esto no comprueba un permiso en abstracto: lee la bandera como la
  // app, con la misma tragada del fallo, y afirma la FRASE que acaba en el
  // encabezado de la galería.
  console.log('\n7. La bandera del corte se puede leer — si no, la migración es inerte');
  await limpiar();

  // La obra migrada: dos fotos en la subcolección —una verificada y una de
  // archivo— y UNA sola en el mapa viejo. Los dos números son distintos a
  // propósito: si la pantalla se va a la fuente equivocada, se nota en la
  // cuenta y no hay que adivinar por qué.
  const VERIF = { ...FOTO('viva'), subidaEn: new Date('2026-10-06T18:00:00Z') };
  const ARCHIVO = { ...FOTO('vieja'), origen: 'legado', capturadaPor: null,
                    subidaEn: new Date('2026-09-30T18:00:00Z') };
  await setDoc(doc(residente, ...RUTA_C, 'f1'), VERIF);
  await setDoc(doc(residente, ...RUTA_C, 'f2'), ARCHIVO);
  const SUBS_VIEJOS = [{ id: 'p1', sec: '1.1', sub: 'Terracerías',
    fotos: { p1: [{ id: 'vieja1', url: 'https://storage/mapa.jpg', fecha: '2026-09-01' }] } }];
  // La escribe la migración por la API de administración, que no pasa por
  // reglas — igual que en producción. Desde el cliente está negada, y la
  // comprobación de abajo es justo eso.
  await fetch(`http://${HOST}:${PUERTO}/v1/projects/${PROYECTO}/databases/(default)/documents/obras/${OBRA}/config/evidencia?updateMask.fieldPaths=migrada&updateMask.fieldPaths=fotosMigradas`,
    { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { migrada: { booleanValue: true }, fotosMigradas: { integerValue: '2' } } }) });

  // `comoLaApp` reproduce `fsGet`: si la lectura rebota devuelve `null`, y a
  // partir de ahí la app no sabe que rebotó. Es el mecanismo del defecto, no
  // una simplificación.
  const comoLaApp = async (db) => {
    try { const d = await getDoc(doc(db, 'obras', OBRA, 'config', 'evidencia'));
          return d.exists() ? d.data() : null; }
    catch { return null; }
  };
  const docsLeidos = async (db) => {
    try { const s = await getDocs(collection(db, ...RUTA_C));
          return s.docs.map(d => ({ id: d.id, ...d.data() })); }
    catch { return []; }
  };

  const cfgRes = await comoLaApp(residente);
  check(cfgRes && cfgRes.migrada === true,
    'el residente lee la bandera de su obra',
    cfgRes ? 'migrada = true' : 'NULL — fsGet se tragó la denegación');
  if (!cfgRes) {
    console.log('\nEsto es el #31 en el interruptor: `config/evidencia` no tiene regla.');
    console.log('La migración escribiría la subcolección entera y la pantalla seguiría');
    console.log('leyendo —y escribiendo— el mapa viejo, sin un solo mensaje de error.');
    process.exit(1);
  }

  const vistaRes = fraseEncabezado(cfgRes, await docsLeidos(residente), SUBS_VIEJOS);
  check(vistaRes.cuantas === 2,
    'y la galería cuenta las 2 de la subcolección, no la 1 del mapa viejo',
    `${vistaRes.cuantas} foto(s)`);
  check(vistaRes.frase === '1 verificada · 1 de archivo',
    'y el encabezado distingue la verificada de la de archivo',
    `«${vistaRes.frase}»`);

  // El cliente es quien ve esa galería. Sin poder leer la bandera, la ve con
  // el contenido de antes de migrar y nadie se enteraría.
  const cfgCli = await comoLaApp(cliente);
  const vistaCli = cfgCli ? fraseEncabezado(cfgCli, await docsLeidos(cliente), SUBS_VIEJOS) : null;
  check(vistaCli && vistaCli.frase === vistaRes.frase,
    'el cliente ve la MISMA galería que el residente, no la de antes de migrar',
    vistaCli ? `«${vistaCli.frase}»` : 'NULL — leería el mapa viejo');

  // Y nadie la voltea desde el cliente. Es un campo que apaga la evidencia de
  // una obra entera: puesta en `true` con la subcolección vacía, la galería
  // queda en blanco; devuelta a `false` después de migrar, todo lo capturado
  // desde entonces se vuelve invisible.
  const eBW = await intentar(() => setDoc(doc(residente, 'obras', OBRA, 'config', 'evidencia'),
    { migrada: false }, { merge: true }));
  check(eBW && denegado(eBW), 'y nadie puede voltearla desde la app',
    eBW ? 'rebotó' : 'LA VOLTEÓ — un campo apaga la evidencia de la obra');
  check((await comoLaApp(residente))?.migrada === true,
    'la bandera sigue en true después del intento');

  // El mismo interruptor en el path municipal, que es el del expediente.
  await fetch(`http://${HOST}:${PUERTO}/v1/projects/${PROYECTO}/databases/(default)/documents/orgs/${ORG_DEP}/obras/${OBRA}/config/evidencia?updateMask.fieldPaths=migrada`,
    { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { migrada: { booleanValue: true } } }) });
  const cfgSup = await (async () => {
    try { const d = await getDoc(doc(supervisor, 'orgs', ORG_DEP, 'obras', OBRA, 'config', 'evidencia'));
          return d.exists() ? d.data() : null; } catch { return null; }
  })();
  check(cfgSup && cfgSup.migrada === true,
    'y el supervisor lee la bandera en la obra municipal',
    cfgSup ? 'migrada = true' : 'NULL — la galería del expediente leería el mapa viejo');
  const eBD = await intentar(() => setDoc(
    doc(dirDep, 'orgs', ORG_DEP, 'obras', OBRA, 'config', 'evidencia'), { migrada: false }, { merge: true }));
  check(eBD && denegado(eBD), 'y el director de Obras Públicas tampoco la voltea',
    eBD ? 'rebotó' : 'LA VOLTEÓ');

  // ── Limpieza ────────────────────────────────────────────────────────────
  // Con las reglas puestas no se puede borrar — que es el punto. Se limpia con
  // la API de administración del emulador, que no pasa por reglas.
  await limpiar();

  console.log(fallas === 0
    ? '\nLa evidencia se captura, se lee, se lista y se anula. Borrar, nadie.'
    : `\n${fallas} comprobación(es) en rojo. NO desplegar las reglas así.`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
