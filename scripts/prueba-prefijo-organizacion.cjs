#!/usr/bin/env node
// Prueba de INTEGRACIÓN: cada organización escribe y lee en su propio lugar,
// y ninguna alcanza el de la otra.
//
// Por qué existe. Hasta esta rama el front escribía SIEMPRE en la colección
// raíz `obras/`. Al meter una dependencia hay dos formas de equivocarse y las
// dos son caras:
//
//   · Mandar a FOSMON al prefijo. Sus cinco obras de producción viven en la
//     raíz; un front que las busque en `orgs/fosmon/obras/` no encuentra nada
//     y el tablero sale en blanco para toda la empresa.
//   · Dejar a la dependencia en la raíz. Sus datos aterrizan en el espacio de
//     FOSMON, mezclados con los de otro cliente, y al revés: vería obras que
//     no son suyas. Enfrente del cliente al que se le prometió aislamiento.
//
// La tentación en ambos casos es un valor por omisión: si no sé de qué tipo
// es, escribo en la raíz. Eso es exactamente el patrón del #31 y el #35 —el
// dato se va a un lugar que nadie revisa y nada falla a la vista—. Por eso el
// §4 afirma que la operación LANZA, no que "devuelve algo razonable".
//
// La prueba usa `src/rutas-org.js`, el mismo módulo que importa App.jsx, y no
// una copia de su lógica: una copia se desincroniza y entonces la prueba pasa
// mientras la app falla.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-prefijo-organizacion.cjs

const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc,
        collection, getDocs } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken } = require('firebase/auth');

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const ORG_DEP = 'coatzacoalcos';
const OBRA_DEP = 'OP-2026-001';
const OBRA_CONS = '0114';

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
// La pista del emulador sólo se imprime cuando el emulador es una causa
// plausible. Si una escritura se deniega por permisos, decirle al operador
// "levanta los emuladores" lo manda a buscar donde no es.
const noArranco = (motivo, pistaEmulador = false) => {
  console.error(`\nNO ARRANCÓ: ${motivo}\n`);
  if (pistaEmulador) {
    console.error('Los emuladores tienen que estar arriba:');
    console.error('  firebase emulators:start --only firestore,auth --project campo-fosmon-prueba\n');
  }
  process.exit(1);
};

(async () => {
  // El módulo de la app es ESM; este guion es CJS por el `"type": "module"`
  // de la raíz. `import()` dinámico es el puente.
  let rutas;
  try {
    rutas = await import(path.resolve(__dirname, '../src/rutas-org.js'));
  } catch (e) {
    noArranco(`no se pudo cargar src/rutas-org.js — ${e.message}`);
  }
  const { conOrg, fijarPrefijoOrg, limpiarPrefijoOrg } = rutas;
  if (typeof conOrg !== 'function' || typeof fijarPrefijoOrg !== 'function') {
    noArranco('src/rutas-org.js no expone conOrg/fijarPrefijoOrg');
  }

  const app = initializeApp({ projectId: PROYECTO, apiKey: 'fake-api-key' }, `pref-${Date.now()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, HOST, PUERTO);
  connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });

  const entrarComo = async (uid, claims) => {
    try { await signInWithCustomToken(auth, tokenDe(uid, claims)); }
    catch (e) { noArranco(`el emulador de Auth no aceptó el token — ${e.message}`, true); }
  };

  // Escribe/lee exactamente como lo hace la app: ruta lógica `obras/...`,
  // resuelta por conOrg(). Ni el guion ni la app saben el prefijo de memoria.
  const guardar = async (rutaLogica, datos) => {
    const real = conOrg(rutaLogica);
    await setDoc(doc(db, ...real.split('/')), datos, { merge: true });
    return real;
  };
  const leer = async (rutaLogica) => {
    const real = conOrg(rutaLogica);
    const d = await getDoc(doc(db, ...real.split('/')));
    return d.exists() ? d.data() : null;
  };
  // Lectura cruda por ruta literal, para poder afirmar dónde NO quedó.
  const leerCrudo = async (rutaLiteral) => {
    try {
      const d = await getDoc(doc(db, ...rutaLiteral.split('/')));
      return d.exists() ? d.data() : null;
    } catch { return null; }
  };

  try {
    await entrarComo('sondeo', { rol: 'director_general', orgId: 'fosmon', tipo: 'constructora', todas: true, obras: [] });
  } catch { noArranco('sin emulador de Auth', true); }

  console.log('\n── EL PREFIJO DE ORGANIZACIÓN ──────────────────────────────────\n');

  // ── §1 La constructora sigue en la raíz ─────────────────────────────────
  console.log('§1 · FOSMON no se mueve');
  await entrarComo('u-fosmon', {
    rol: 'director_general', orgId: 'fosmon', tipo: 'constructora', todas: true, obras: [],
  });
  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');

  const marcaCons = `constructora-${Date.now()}`;
  let rutaCons;
  try {
    rutaCons = await guardar(`obras/${OBRA_CONS}/avance/subs`, { data: [], marca: marcaCons });
  } catch (e) {
    noArranco(`la escritura de constructora ni siquiera se intentó — ${e.message}`);
  }
  check(rutaCons === `obras/${OBRA_CONS}/avance/subs`,
        'el avance de FOSMON queda en la raíz', rutaCons);
  const leidoCons = await leer(`obras/${OBRA_CONS}/avance/subs`);
  check(leidoCons?.marca === marcaCons,
        'y la app lo vuelve a leer', leidoCons ? 'lo leyó' : 'no lo encontró');
  const enPrefijoCons = await leerCrudo(`orgs/fosmon/obras/${OBRA_CONS}/avance/subs`);
  check(enPrefijoCons === null,
        'no se duplicó bajo orgs/fosmon/');

  // ── §2 La dependencia queda bajo su organización ────────────────────────
  console.log('\n§2 · la dependencia escribe en su propio espacio');
  await entrarComo('u-dep', {
    rol: 'director_obras', orgId: ORG_DEP, tipo: 'dependencia', todas: true, obras: [],
  });
  limpiarPrefijoOrg();
  fijarPrefijoOrg('dependencia', ORG_DEP);

  const marcaDep = `dependencia-${Date.now()}`;
  let rutaDep;
  try {
    rutaDep = await guardar(`obras/${OBRA_DEP}/avance/subs`, { data: [], marca: marcaDep });
  } catch (e) {
    noArranco(`la captura de la dependencia ni siquiera se intentó — ${e.message}`);
  }
  check(rutaDep === `orgs/${ORG_DEP}/obras/${OBRA_DEP}/avance/subs`,
        'la captura queda bajo su organización', rutaDep);
  const leidoDep = await leer(`obras/${OBRA_DEP}/avance/subs`);
  check(leidoDep?.marca === marcaDep,
        'y la app lo vuelve a leer', leidoDep ? 'lo leyó' : 'no lo encontró');

  // La afirmación que de verdad importa: NO aterrizó en la raíz, donde están
  // los datos de FOSMON.
  const enRaizDep = await leerCrudo(`obras/${OBRA_DEP}/avance/subs`);
  check(enRaizDep === null,
        'y NO aterrizó en la raíz, con los datos de FOSMON',
        enRaizDep ? 'ESTÁ EN LA RAÍZ' : 'la raíz está limpia');

  // ── §3 Ninguno ve al otro ───────────────────────────────────────────────
  console.log('\n§3 · ninguno alcanza los datos del otro');
  // Sesión de dependencia pidiendo la obra de FOSMON: como la ruta lógica se
  // prefija, ni siquiera apunta al documento de FOSMON.
  const depMirandoFosmon = await leer(`obras/${OBRA_CONS}/avance/subs`);
  check(depMirandoFosmon?.marca !== marcaCons,
        'la dependencia no obtiene el avance de FOSMON',
        depMirandoFosmon ? 'obtuvo algo' : 'no obtuvo nada');

  // Y el listado de obras de la dependencia no incluye las de FOSMON.
  const listaDep = await getDocs(collection(db, ...conOrg('obras').split('/')));
  const idsDep = listaDep.docs.map(d => d.id);
  check(!idsDep.includes(OBRA_CONS),
        'su lista de obras no incluye las de FOSMON',
        idsDep.length ? idsDep.join(', ') : 'vacía');

  // Al revés: la constructora no alcanza la obra de la dependencia.
  await entrarComo('u-fosmon', {
    rol: 'director_general', orgId: 'fosmon', tipo: 'constructora', todas: true, obras: [],
  });
  limpiarPrefijoOrg();
  fijarPrefijoOrg('constructora', 'fosmon');
  const fosmonMirandoDep = await leer(`obras/${OBRA_DEP}/avance/subs`);
  check(fosmonMirandoDep?.marca !== marcaDep,
        'FOSMON no obtiene la captura de la dependencia',
        fosmonMirandoDep ? 'obtuvo algo' : 'no obtuvo nada');
  // Contra las reglas de verdad, no sólo contra la ruta: aunque supiera la
  // ruta literal, el servidor tiene que negarla.
  let denegada = false;
  try {
    await getDoc(doc(db, `orgs/${ORG_DEP}/obras/${OBRA_DEP}/avance/subs`));
  } catch { denegada = true; }
  check(denegada,
        'y si apunta a la ruta literal, las reglas la niegan',
        denegada ? 'denegada' : 'LA DEJÓ PASAR');

  // ── §4 Sin tipo resuelto, falla en voz alta ─────────────────────────────
  console.log('\n§4 · sin organización resuelta no se escribe en ningún lado');
  const marcaHuerfana = `huerfana-${Date.now()}`;

  // (a) tipo ausente
  limpiarPrefijoOrg();
  let lanzo = false, mensaje = '';
  try { fijarPrefijoOrg(undefined, undefined); }
  catch (e) { lanzo = true; mensaje = e.message; }
  check(lanzo, 'un tipo ausente no resuelve a ninguna ruta', mensaje || 'NO LANZÓ');

  // (b) dependencia sin organización
  limpiarPrefijoOrg();
  lanzo = false; mensaje = '';
  try { fijarPrefijoOrg('dependencia', null); }
  catch (e) { lanzo = true; mensaje = e.message; }
  check(lanzo, 'una dependencia sin organización tampoco', mensaje || 'NO LANZÓ');

  // (c) Lo que de verdad protege: intentar guardar sin prefijo fijado no debe
  //     escribir en la raíz "por omisión". Tiene que reventar ANTES de tocar
  //     la red.
  limpiarPrefijoOrg();
  lanzo = false; mensaje = '';
  try { await guardar(`obras/${OBRA_CONS}/avance/subs`, { marca: marcaHuerfana }); }
  catch (e) { lanzo = true; mensaje = e.message; }
  check(lanzo, 'guardar sin organización resuelta revienta', mensaje || 'NO LANZÓ — ESCRIBIÓ');

  // Y la comprobación que hace que lo anterior no sea palabrería: el
  // documento de FOSMON quedó intacto, sin la marca huérfana encima.
  const trasElIntento = await leerCrudo(`obras/${OBRA_CONS}/avance/subs`);
  check(trasElIntento?.marca === marcaCons,
        'y el documento de FOSMON quedó intacto',
        trasElIntento?.marca === marcaHuerfana ? 'LO PISÓ LA ESCRITURA HUÉRFANA' : 'intacto');

  // (d) Las rutas que NO son de obra siguen funcionando sin prefijo: el login
  //     lee el perfil antes de que exista organización.
  limpiarPrefijoOrg();
  let perfilOk = false;
  try { perfilOk = conOrg('usuarios/alguien_ejemplo_com') === 'usuarios/alguien_ejemplo_com'; }
  catch { perfilOk = false; }
  check(perfilOk, 'el perfil se puede leer antes de resolver la organización');

  console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} — ${fallas === 0 ? 'todo en su lugar' : `${fallas} fallas`}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.message ? e.message : e);
  process.exit(1);
});
