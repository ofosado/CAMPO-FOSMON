#!/usr/bin/env node
// La nota semanal NO se guarda en silencio cuando las reglas la deniegan.
//
// POR QUÉ ESTA PRUEBA, y por qué se escribe ANTES de desplegar. Es el #31
// literal: `crearSnapshotAvanceSub` escribía en una ruta sin regla, el fallo
// pasaba por `fsSet` —que devuelve `false` callando (#22)— y nadie se enteró
// durante meses. No se perdió un dato: se perdió una funcionalidad entera que
// estuvo en el menú todo ese tiempo prometiendo una serie que nunca existió.
// En el #28 y en la captura de dependencia apareció el mismo patrón.
//
// La pregunta que esta prueba contesta no es si la escritura rebota —eso es
// seguro mientras no haya regla— sino si quien escribió la nota SE ENTERA.
//
// Se ejecuta la función REAL extraída de src/App.jsx contra el emulador, no una
// imitación: lo que falló en el #31 fue exactamente la capa que una imitación
// se habría saltado.
//
// LA PRUEBA SE CARGA SU PROPIO RULESET. La primera versión daba por hecho que
// el emulador estaba levantado con las reglas de `main`, sin `avance/notas`.
// Levantarlo con las reglas de la rama la ponía en rojo sin que nada estuviera
// roto: un rojo que depende de cómo arrancaste el emulador no es un rojo, es
// ruido, y enseña a ignorarlos. Así que aquí se sube a propósito un ruleset
// derivado del `firestore.rules` de HOY al que se le quitan los dos bloques de
// `avance/notas`. La condición que se mide —«una ruta sin regla»— queda fija y
// la prueba sigue valiendo después de desplegar, que es justo cuando hará
// falta para que nadie reintroduzca el patrón.
//
// Uso:
//   firebase emulators:start --only firestore,auth
//   node scripts/prueba-nota-no-calla.cjs
//
// Variables: EMU_HOST, EMU_PORT, EMU_AUTH_PORT.

const path = require('path');
const fs = require('fs');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const raiz = path.resolve(__dirname, '..');
const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const OBRA = '0114';

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

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

// ── El ruleset de la prueba: el de hoy MENOS las dos rutas de notas ─────────
// Se quitan por bloque `match`, no por línea, para que al archivo no le queden
// llaves sueltas. Si algún día no hubiera nada que quitar, el escenario que la
// prueba quiere montar no existe y eso es NO ARRANCÓ (exit 2), no verde: un
// verde ahí diría «el aviso funciona» sin haber denegado nada.
function rulesetSinNotas() {
  const texto = fs.readFileSync(path.join(raiz, 'firestore.rules'), 'utf8');
  const sin = texto.replace(
    /^[ \t]*match \/avance\/notas \{[\s\S]*?^[ \t]*\}\n/gm, '');
  const quitados = (texto.match(/match \/avance\/notas \{/g) || []).length;
  return { sin, quitados };
}

async function cargarReglas(contenido) {
  const r = await fetch(
    `http://${HOST}:${PUERTO}/emulator/v1/projects/${PROYECTO}:securityRules`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: contenido }] } }) });
  if (!r.ok) throw new Error(`no se pudieron cargar las reglas: ${r.status} ${(await r.text()).slice(0, 300)}`);
}

// La función real, tal cual está en el código que se va a desplegar.
const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(ARCH_APP, 'utf8');
const m = src.match(/const guardarNotaSemanal = async \([\s\S]*?\n};/);

(async () => {
  console.log('\nLa nota semanal contra un ruleset que NO conoce `avance/notas`\n');

  if (!m) {
    fallos.push('la nota de la semana no se guarda en ningún lado');
    console.log('   ✗ la nota de la semana no se guarda en ningún lado');
    return cerrar();
  }

  // El escenario se monta aquí, y se dice en voz alta cuál es.
  const { sin, quitados } = rulesetSinNotas();
  if (quitados === 0) {
    throw new Error(
      'firestore.rules no declara `avance/notas`, así que no hay nada que quitar ' +
      'y el escenario de esta prueba —una ruta sin regla— no se puede montar.');
  }
  await cargarReglas(sin);
  console.log(`   (ruleset de la prueba: firestore.rules menos ${quitados} bloque(s) de \`avance/notas\`)\n`);

  const app = initializeApp({ projectId: PROYECTO, apiKey: 'fake' }, `nota-${Date.now()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, HOST, PUERTO);
  connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });

  // Un residente con la obra asignada: alguien que SÍ puede escribir el avance
  // y el historial. Si a éste se le deniega la nota, es por la ruta y no por
  // el permiso de la persona.
  await signInWithCustomToken(auth, tokenDe('residente-prueba', {
    rol: 'residente', obras: [OBRA], orgId: 'fosmon', tipo: 'constructora',
  }));

  const docObra = (obraId, col, id) => doc(db, 'obras', obraId, col, id);
  const guardarNotaSemanal = new Function(
    'getDoc', 'setDoc', 'docObra', 'LIMITE_NOTA_SEMANAL',
    `${m[0]}\nreturn guardarNotaSemanal;`
  )(getDoc, setDoc, docObra, 1000);

  // ── 1. El permiso de la persona no está en duda ────────────────────────
  // Se comprueba primero que este mismo usuario SÍ puede escribir una ruta
  // declarada. Sin esto, un fallo abajo podría ser del token y no de la ruta,
  // y la prueba estaría midiendo otra cosa.
  console.log('1. El residente de la prueba sí puede escribir donde hay regla');
  let okControl = false;
  try {
    await setDoc(docObra(OBRA, 'avance', 'historial'), { semanas: [] }, { merge: true });
    okControl = true;
  } catch (e) { okControl = false; }
  check(okControl, 'escribe `avance/historial`, que sí está declarada');

  // ── 2. La escritura de la nota se DENIEGA ──────────────────────────────
  console.log('\n2. Y la nota, que no tiene regla todavía, rebota');
  let denegada = false, codigo = null;
  try {
    await setDoc(docObra(OBRA, 'avance', 'notas'), { notas: { 'S40-2026': { texto: 'x' } } }, { merge: true });
  } catch (e) { denegada = true; codigo = e?.code || e?.message; }
  check(denegada, `la ruta sin regla deniega la escritura (${codigo})`);

  // ── 3. LO QUE IMPORTA: el que escribió se entera ────────────────────────
  // Si esto sale verde, `guardarNotaSemanal` devuelve `false` y la pantalla
  // puede avisar. Si saliera que devuelve `true`, sería el #31 otra vez: la
  // nota parecería guardada, la tarjeta se pintaría, y el expediente estaría
  // vacío sin que nadie lo supiera.
  console.log('\n3. Quien escribió la nota se entera de que no quedó');
  const devuelto = await guardarNotaSemanal(OBRA, 'S40-2026', {
    texto: 'Tres días sin acceso al frente 2.', autor: 'residente@fosmon.com.mx' });
  check(devuelto === false,
    `al denegarse, guardar la nota devuelve \`false\` (devolvió \`${devuelto}\`)`);
  check(devuelto !== true,
    'NO devuelve éxito sobre una escritura que rebotó (el patrón del #31)');

  // ── 4. Y no quedó nada escrito ─────────────────────────────────────────
  // El `false` tiene que corresponder con la realidad del documento: decir
  // que no quedó cuando sí quedó sería el error contrario.
  console.log('\n4. Y en efecto no quedó nada');
  let hay = null;
  try { hay = (await getDoc(docObra(OBRA, 'avance', 'notas'))).exists(); }
  catch (e) { hay = 'denegado'; }
  check(hay === false || hay === 'denegado',
    `el documento de notas no existe tras el intento (${hay})`);

  cerrar();
})().catch(e => { console.error(e); process.exit(2); });

function cerrar() {
  if (fallos.length === 0) {
    console.log('\nVERDE — la nota que no se puede guardar lo dice; no se guarda en silencio.\n');
    process.exit(0);
  }
  console.log(`\nROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}
