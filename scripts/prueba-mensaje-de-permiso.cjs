#!/usr/bin/env node
// «Ya no tienes acceso a esta obra» era casi siempre mentira.
//
// ── EL DEFECTO ─────────────────────────────────────────────────────────────
//
// `uploadFoto` traducía CUALQUIER `storage/unauthorized` a esa frase, y el
// commit de documentos hacía lo mismo con cualquier fallo, incluida la red.
// La frase afirma algo sobre el dato: dice que al usuario le quitaron la
// obra. Lo normal no es eso — lo normal es que el JWT vaya rancio, porque los
// claims tardan hasta una hora en refrescarse solos y el listener de
// `claimsVersion` sólo corre si la Cloud Function alcanzó a incrementarlo.
//
// El costo es un supervisor de pie en la obra, con la foto sin subir, yendo a
// pedir un permiso que ya tiene.
//
// ── LO QUE AFIRMA ESTE BANCO ───────────────────────────────────────────────
//
// Son TRES casos y el mensaje tiene que distinguirlos. Las sesiones son
// reales —tokens con claims, contra el emulador— y las denegaciones las
// produce el ruleset del repo, no un error inventado:
//
//  §1  TOKEN RANCIO · el residente tiene la obra, su token todavía no. Un
//      reintento con token fresco y queda. Sin mensaje: no hay nada que
//      contarle.
//  §2  SIN ACCESO · con el token ya fresco la obra NO está en sus claims.
//      Aquí la frase es cierta, y además accionable.
//  §3  INEXPLICADO · el auditor SÍ tiene la obra en sus claims y las reglas
//      igual niegan (`puedeEditarObraC` no incluye a `auditor`). Decirle que
//      perdió el acceso lo manda a pedir lo que ya tiene. Deja RASTRO.
//  §4  LOS DOS RELOJES · el rastro lleva la hora del aparato y la del
//      servidor, y no son redundantes: su diferencia distingue un reloj mal
//      puesto de una fila que viajó en la cola.
//  §5  LA COLA ES MEJOR ESFUERZO · se encola lo que no se pudo escribir, se
//      drena cuando se puede, y cuando el almacenamiento falla la función lo
//      DICE en vez de fingir que guardó.
//
// Ejecuta `src/permiso-denegado.js`, el mismo módulo que importa App.jsx, no
// una copia de su lógica.
//
// ── LO QUE NO MIDE ─────────────────────────────────────────────────────────
// El cableado de App.jsx: que `uploadFoto` llame a esto y no a otra cosa. Eso
// lo sostiene el build y la lectura del diff. Aquí se mide la decisión.
//
// Uso:
//   export PATH="/opt/homebrew/bin:/opt/homebrew/opt/openjdk/bin:$PATH"
//   firebase emulators:start --only firestore,auth --project campo-fosmon-prueba
//   node scripts/prueba-mensaje-de-permiso.cjs
//   node scripts/prueba-mensaje-de-permiso.cjs --contraprueba

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const HOST = process.env.EMU_HOST || '127.0.0.1';
const PUERTO = Number(process.env.EMU_PORT || 8080);
const PUERTO_AUTH = Number(process.env.EMU_AUTH_PORT || 9099);
const PROYECTO = 'campo-fosmon-prueba';

const ARCH_MODULO = process.env.ARCH_PERMISO || path.join(raiz, 'src/permiso-denegado.js');

// ── La contraprueba ────────────────────────────────────────────────────────
// Cada mutación FUNDE DOS CASOS en uno: es la forma exacta que tenía el
// defecto —un solo mensaje para situaciones distintas— y es la forma en que
// volvería. Separadas, porque si fueran una sola bastaría con ver la primera.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    // Esto es literalmente el código de ayer: sin reintento, el token rancio
    // es indistinguible de haber perdido la obra.
    { nombre: 'funde 1 y 2: se quita el reintento con token fresco',
      de: '    try {\n      return { caso: CASO.RANCIO, valor: await intentar() };\n    } catch (segundo) {',
      a:  '    try {\n      throw primero;\n    } catch (segundo) {' },

    // Esta es la frase vieja, aplicada a todo el mundo.
    { nombre: 'funde 2 y 3: el inexplicado también oye «perdiste el acceso»',
      de: '      if (!tiene) {\n        return { caso: CASO.SIN_ACCESO, error: segundo,',
      a:  '      if (true) {\n        return { caso: CASO.SIN_ACCESO, error: segundo,' },

    // El espejo del anterior: quien de verdad perdió la obra recibe el
    // mensaje del caso 3 y se queda sin saber a quién pedírsela.
    { nombre: 'funde 3 y 2: quien perdió la obra oye el mensaje del inexplicado',
      de: '      if (!tiene) {',
      a:  '      if (false) {' },

    // Una cola que siempre dice que sí es peor que no tener cola: afirma que
    // el reporte quedó guardado cuando no quedó.
    { nombre: 'la cola promete: encolar devuelve true aunque no haya guardado',
      de: '  } catch {\n    // Cuota llena, modo privado, almacenamiento deshabilitado. Se perdió, y\n    // así se queda: este es el eslabón que no promete nada.\n    return false;\n  }',
      a:  '  } catch {\n    return true;\n  }' },

    // Sin el reloj del aparato, una fila drenada tres días después parece de
    // hoy y el rastro miente sobre cuándo pasó.
    { nombre: 'un solo reloj: el rastro pierde la hora del aparato',
      de: '    ts: ahoraISO,\n    tsServidor: servidor ?? null,',
      a:  '    tsServidor: servidor ?? null,' },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(ARCH_MODULO, 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log('             el texto a mutar ya no está en src/permiso-denegado.js.');
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(), `permiso-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(roto, base.replace(m.de, m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_PERMISO: roto } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      if (r.status === 2) console.log('             (salió NO ARRANCÓ: la prueba se cayó, que no es lo mismo que ver el defecto.)');
    }
    try { fs.unlinkSync(roto); } catch {}
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven.`
    : `\n${malas} de ${MUTACIONES.length} NO se ven.`);
  process.exit(malas === 0 ? 0 : 1);
}

const { initializeApp } = require('firebase/app');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc,
        collection, getDocs, addDoc, serverTimestamp } = require('firebase/firestore');
const { getAuth, connectAuthEmulator, signInWithCustomToken,
        getIdTokenResult } = require('firebase/auth');

const { cargarReglas } = require('./reglas-del-repo.cjs');
const { limpiarDatos } = require('./emulador-limpio.cjs');

const OBRA = '0114';
const OTRA = '0126';

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

const CON = (rol, obras) => ({ tipo: 'constructora', rol, orgId: 'fosmon',
  todas: false, obras });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

(async () => {
  // P7 — este banco empieza sobre un Firestore vacío, no sobre lo que le dejó
  // el anterior. Si no puede limpiar, NO ARRANCÓ (2).
  await limpiarDatos({ proyecto: PROYECTO, host: HOST, puerto: PUERTO });
  console.log(`(reglas cargadas desde ${await cargarReglas(
    { proyecto: PROYECTO, host: HOST, puerto: PUERTO })})`);

  let M;
  try {
    M = await import('file://' + ARCH_MODULO);
  } catch (e) {
    noArranco.sinPrecondicion(`no se pudo cargar ${ARCH_MODULO}`, [e.message]);
  }
  const { CASO, conReintentoDePermiso, construirRastro,
          encolarRastro, leerCola, drenarCola } = M;
  for (const [n, f] of Object.entries({ conReintentoDePermiso, construirRastro,
                                        encolarRastro, leerCola, drenarCola })) {
    if (typeof f !== 'function') noArranco.sinPrecondicion(
      `src/permiso-denegado.js no expone ${n}`, []);
  }

  const app = initializeApp({ projectId: PROYECTO, apiKey: 'fake-api-key' },
    `permiso-${Date.now()}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, HOST, PUERTO);
  connectAuthEmulator(auth, `http://${HOST}:${PUERTO_AUTH}`, { disableWarnings: true });

  const entrarComo = async (uid, claims) => {
    try { await signInWithCustomToken(auth, tokenDe(uid, claims)); }
    catch (e) { noArranco.sinPrecondicion(
      `el emulador de Auth no aceptó el token (${e.message})`,
      ['firebase emulators:start --only firestore,auth --project campo-fosmon-prueba']); }
  };

  // Las manos que el módulo necesita, cableadas al emulador de verdad: los
  // claims salen del token que el emulador emitió, no de una variable local.
  const tieneLaObra = async (obraId) => {
    const { claims } = await getIdTokenResult(auth.currentUser, true);
    if (claims?.todas === true) return true;
    return Array.isArray(claims?.obras) && claims.obras.includes(obraId);
  };

  const RUTA_DOCS = `obras/${OBRA}/contrato/documentos`;
  const escribirDocs = (lista) => setDoc(doc(db, ...RUTA_DOCS.split('/')), { lista });

  // Comprobar QUÉ quedó escrito es otra operación, y no puede hacerla la
  // sesión a la que acaban de negarle el permiso: un `get` denegado tiraría
  // el banco (NO ARRANCÓ) y se leería «la prueba se cayó» en vez del
  // veredicto. Se verifica con un directivo, que sí puede ver, y cada
  // sección vuelve a entrar con la sesión que le toca.
  const DIRECTIVO = { tipo: 'constructora', rol: 'director_general',
    orgId: 'fosmon', todas: true, obras: [] };
  const comoDirectivo = async (fn) => {
    await entrarComo('u-verificador', DIRECTIVO);
    return fn();
  };

  // ── §1 · EL TOKEN IBA RANCIO ─────────────────────────────────────────────
  console.log('\n§1 · el token iba rancio: un reintento y queda, sin molestar a nadie');

  // Entra con un token que NO trae la obra; «refrescar» lo cambia por el que
  // sí la trae. Es exactamente lo que pasa cuando los claims acaban de
  // cambiar y el JWT en mano todavía es el de antes.
  await entrarComo('u-residente', CON('residente', [OTRA]));
  let refrescos = 0;
  let r = await conReintentoDePermiso(() => escribirDocs(['acta.pdf']), {
    obraId: OBRA,
    refrescarToken: async () => {
      refrescos++;
      await entrarComo('u-residente', CON('residente', [OBRA]));
    },
    tieneLaObra: () => tieneLaObra(OBRA),
  });
  check(r.caso === CASO.RANCIO, 'el reintento con token fresco resuelve', `caso=${r.caso}`);
  check(refrescos === 1, 'se refrescó el token UNA vez, no en bucle', `refrescos=${refrescos}`);
  check(!r.mensaje, 'no hay mensaje que enseñarle al usuario',
    r.mensaje ? `dijo: «${r.mensaje}»` : 'ninguno');
  const quedo = await comoDirectivo(() => getDoc(doc(db, ...RUTA_DOCS.split('/'))));
  check(quedo.exists() && quedo.data().lista[0] === 'acta.pdf',
    'y el documento QUEDÓ escrito en Firestore',
    quedo.exists() ? JSON.stringify(quedo.data().lista) : 'no existe');

  // ── §2 · DE VERDAD PERDIÓ EL ACCESO ──────────────────────────────────────
  console.log('\n§2 · ya no tiene la obra: la frase es cierta y es accionable');

  await entrarComo('u-exresidente', CON('residente', [OTRA]));
  refrescos = 0;
  r = await conReintentoDePermiso(() => escribirDocs(['otra.pdf']), {
    obraId: OBRA,
    refrescarToken: async () => { refrescos++; },   // el token fresco es igual
    tieneLaObra: () => tieneLaObra(OBRA),
  });
  check(r.caso === CASO.SIN_ACCESO, 'se clasifica como acceso perdido', `caso=${r.caso}`);
  check(/ya no tienes acceso a esta obra/i.test(r.mensaje || ''),
    'el mensaje lo dice con esas palabras', `«${r.mensaje}»`);
  check(/administra el sistema|asigne/i.test(r.mensaje || ''),
    'y dice a quién pedírselo, que es lo único que puede hacer');
  const sigueIgual = await comoDirectivo(() => getDoc(doc(db, ...RUTA_DOCS.split('/'))));
  check(sigueIgual.data()?.lista?.[0] === 'acta.pdf',
    'la escritura no pasó: el documento anterior sigue intacto',
    JSON.stringify(sigueIgual.data()?.lista));

  // ── §3 · NI UNA COSA NI LA OTRA ──────────────────────────────────────────
  console.log('\n§3 · tiene la obra y aun así se la niegan: ni se le miente ni se le calla');

  // El auditor SÍ ve la obra y SÍ la tiene asignada, pero `puedeEditarObraC`
  // no lo incluye. Denegación real, con la obra en los claims.
  await entrarComo('u-auditor', CON('auditor', [OBRA]));
  r = await conReintentoDePermiso(() => escribirDocs(['auditor.pdf']), {
    obraId: OBRA,
    refrescarToken: async () => {},
    tieneLaObra: () => tieneLaObra(OBRA),
  });
  check(r.caso === CASO.INEXPLICADO, 'se clasifica como inexplicado', `caso=${r.caso}`);
  check(!/ya no tienes acceso/i.test(r.mensaje || ''),
    'NO se le dice que perdió el acceso: lo mandaría a pedir lo que ya tiene',
    `«${r.mensaje}»`);
  check((r.mensaje || '').includes(OBRA),
    'el mensaje nombra la obra, para que pueda reportarla');
  check((r.mensaje || '').includes('permission-denied'),
    'y trae el código real, que es lo único accionable', `«${r.mensaje}»`);

  // ── §4 · LOS DOS RELOJES ─────────────────────────────────────────────────
  console.log('\n§4 · el rastro lleva dos relojes, y su diferencia es el dato');

  // Lo escribe el auditor, que es justo quien acaba de ser denegado: si el
  // `create` de la bitácora pidiera la obra o el rol, el rastro estaría vacío
  // exactamente en el caso que lo motivó. Eso es la circularidad del #73.
  const haceTresDias = new Date(Date.now() - 3 * 86400000).toISOString();
  const rastro = construirRastro({
    uid: 'u-auditor', correo: 'auditor@fosmon.mx', obraId: OBRA,
    ruta: RUTA_DOCS, codigo: r.error?.code,
    ahoraISO: haceTresDias, servidor: serverTimestamp(),
  });
  check(rastro.ts === haceTresDias, 'el rastro conserva la hora del APARATO', rastro.ts);
  check(rastro.tsServidor !== null && rastro.tsServidor !== undefined,
    'y pide además la del SERVIDOR');
  check(rastro.obraId === OBRA && rastro.path === RUTA_DOCS &&
        rastro.uid === 'u-auditor' && rastro.usuario === 'auditor@fosmon.mx',
    'y lleva obra, ruta intentada, uid y correo');

  let ref;
  try {
    await entrarComo('u-auditor', CON('auditor', [OBRA]));
    ref = await addDoc(collection(db, 'auditoria'), rastro);
  } catch (e) {
    noArranco.sinPrecondicion(
      `el denegado no pudo dejar constancia: ${e.code || e.message}`,
      ['Es la circularidad del #73: si `create` pide la obra, el rastro queda',
       'vacío justo en el caso que lo motivó.']);
  }
  // El auditor escribe su constancia pero NO lee la bitácora —`esDirectivoC()`
  // no lo incluye, y eso se midió en el #73—, así que la comprueba un
  // directivo.
  const escrito = (await comoDirectivo(() => getDoc(ref))).data();
  const delServidor = escrito.tsServidor?.toDate?.();
  check(escrito.ts === haceTresDias,
    'escrito en la bitácora, el reloj del aparato sigue diciendo hace tres días',
    escrito.ts);
  check(delServidor instanceof Date && Math.abs(Date.now() - delServidor.getTime()) < 120000,
    'y el del servidor dice AHORA, que es cuando se escribió',
    delServidor ? delServidor.toISOString() : String(escrito.tsServidor));
  check(delServidor instanceof Date &&
        delServidor.getTime() - new Date(escrito.ts).getTime() > 2 * 86400000,
    'su diferencia delata la fila que viajó: tres días entre una y otra',
    delServidor ? `${Math.round((delServidor - new Date(escrito.ts)) / 3600000)} h` : 'sin hora de servidor');

  // ── §5 · LA COLA ES MEJOR ESFUERZO, Y LO DICE ────────────────────────────
  console.log('\n§5 · la cola no promete: cuando no puede guardar, lo dice');

  const almacenFalso = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null),
             setItem: (k, v) => m.set(k, v),
             removeItem: k => m.delete(k) };
  };

  const almacen = almacenFalso();
  const paraCola = construirRastro({
    uid: 'u-auditor', correo: 'auditor@fosmon.mx', obraId: OBRA,
    ruta: RUTA_DOCS, codigo: 'permission-denied',
    ahoraISO: haceTresDias, servidor: serverTimestamp(),
  });
  check(encolarRastro(paraCola, almacen) === true, 'se encola lo que no se pudo escribir');
  const enCola = leerCola(almacen);
  check(enCola.length === 1, 'y se puede volver a leer', `${enCola.length} en cola`);
  check(!('tsServidor' in enCola[0]) || enCola[0].tsServidor == null,
    'el centinela del servidor NO viaja en la cola: JSON lo convertiría en un mapa vacío',
    JSON.stringify(enCola[0].tsServidor));
  check(enCola[0].ts === haceTresDias,
    'pero la hora del aparato sí, que es la que dice cuándo pasó');

  // Sin almacenamiento —Safari en privado, cuota llena— la función lo DICE.
  // Devolver true aquí sería afirmar que el reporte quedó guardado.
  const almacenRoto = { getItem: () => null,
                        setItem: () => { throw new Error('QuotaExceededError'); },
                        removeItem: () => {} };
  check(encolarRastro(paraCola, almacenRoto) === false,
    'si el almacenamiento falla, devuelve FALSE en vez de fingir que guardó');
  check(encolarRastro(paraCola, null) === false,
    'y sin almacenamiento ninguno, lo mismo');

  // Drenar: se escribe de verdad contra el emulador y se repone el centinela.
  const antes = (await comoDirectivo(() => getDocs(collection(db, 'auditoria')))).size;
  await entrarComo('u-auditor', CON('auditor', [OBRA]));
  const res = await drenarCola(almacen,
    (x) => addDoc(collection(db, 'auditoria'), x), serverTimestamp);
  check(res.enviados === 1 && res.pendientes === 0,
    'al drenar se escribe lo pendiente', `enviados=${res.enviados} pendientes=${res.pendientes}`);
  check(leerCola(almacen).length === 0, 'y la cola queda vacía');
  const drenada = await comoDirectivo(() => getDocs(collection(db, 'auditoria')));
  check(drenada.size === antes + 1, 'hay una fila más en la bitácora', `${antes} → ${drenada.size}`);
  // El centinela repuesto: la fila drenada SÍ trae hora de servidor, y es la
  // de ahora. Es lo que hace que «cuándo se drenó» quede registrado aparte de
  // «cuándo pasó».
  const laDrenada = drenada.docs.map(d => d.data()).find(x => x.ts === haceTresDias && x.tsServidor);
  check(!!laDrenada?.tsServidor?.toDate,
    'y se le repuso la hora del servidor que la cola no podía guardar');

  // Lo que no se puede escribir se QUEDA. Una cola que tira lo que no pudo
  // enviar es peor que no tener cola.
  const almacen2 = almacenFalso();
  encolarRastro(paraCola, almacen2);
  const res2 = await drenarCola(almacen2,
    () => Promise.reject(new Error('sin red')), serverTimestamp);
  check(res2.enviados === 0 && res2.pendientes === 1,
    'lo que no se pudo enviar sigue pendiente', `pendientes=${res2.pendientes}`);
  check(leerCola(almacen2).length === 1, 'y sigue en la cola para el próximo arranque');

  console.log(fallas === 0
    ? '\nLos tres casos se distinguen, el rastro lleva sus dos relojes y la cola no promete nada.'
    : `\n${fallas} comprobación(es) en ROJO.`);
  process.exit(fallas === 0 ? 0 : 1);
})();
