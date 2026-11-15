#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// SIEMBRA LA DEPENDENCIA DE DEMO (PENDIENTES #69)
// ════════════════════════════════════════════════════════════════════════════
//
// Crea las TRES cosas que `medir-lo-que-le-falta-a-una-dependencia.cjs` dice
// que hacen falta, y en el orden en que hacen falta:
//
//   a) la organización        orgs/coatzacoalcos          (tipo dependencia)
//   b) un usuario de esa org  Auth + usuarios/{id} + claims
//   c) una obra bajo          orgs/coatzacoalcos/obras/{id}
//
// POR QUÉ ADMIN SDK Y NO LAS CALLABLES. `crearOrganizacion` exige
// `ambito.cross`, o sea el rol `soporte`, y en producción **no existe ningún
// usuario con ese rol**: los 15 son de constructora. No hay sesión desde la
// cual llamarla. Lo mismo valdría para `crearUsuario`. Así que se siembra con
// credenciales de administrador, igual que hizo `crear-org-fosmon.cjs` en su
// día con la constructora.
//
// EL ORDEN DE LA OBRA NO ES EL ORDEN OBVIO, Y ES A PROPÓSITO. Se escribe
// `config/evidencia` ANTES del documento de la obra, que es exactamente lo que
// hace el alta de la app desde el #143 (`agregarObra`, src/App.jsx). Si se
// escribiera después quedaría, ante un fallo a mitad, una obra existente y
// nacida sin bandera: cada foto suya se archivaría sin autor y sin hora del
// servidor, y la galería la rotularía «de archivo». Sembrar la demo en el
// orden equivocado es sembrar el defecto que acabamos de arreglar, en el
// expediente que se le va a enseñar a un director de Obras Públicas.
//
// LA CONTRASEÑA NO SE PONE AQUÍ. La identidad en Auth se crea **sin
// contraseña**: quien tenga que entrar la establece desde la consola de
// Firebase. Este guion no genera, no escribe y no imprime ninguna credencial.
// La ruta normal —la callable `crearUsuario`— la sortea y la manda por correo,
// y aquí no sirve porque el buzón de la cuenta de demo no existe.
//
// Uso (el `NODE_PATH` no es opcional: `firebase-admin` vive en `functions/`,
// no en la raíz de este repo, y sin él esto muere con MODULE_NOT_FOUND):
//   gcloud auth application-default login
//   export NODE_PATH="$PWD/functions/node_modules"
//   node scripts/sembrar-dependencia-demo.cjs --prod              (ensayo)
//   node scripts/sembrar-dependencia-demo.cjs --prod --escribir   (aplica)
//
// Idempotente: lo que ya exista no se vuelve a escribir, y se dice cuál.

'use strict';

// El portón va PRIMERO, antes de `require("firebase-admin")` — que no está
// instalado en la raíz de este repo. Si estuviera después, equivocarse de
// destino daría un MODULE_NOT_FOUND en lugar de «No hay destino».
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({
  escribe: 'crea orgs/coatzacoalcos, su usuario de demo y una obra bajo esa org',
});
const ESCRIBIR = DESTINO.escribir;

const admin = require('firebase-admin');

// ── LO QUE SE VA A SEMBRAR ──────────────────────────────────────────────────

const ORG_ID = 'coatzacoalcos';
const ORG = {
  nombre: 'H. Ayuntamiento de Coatzacoalcos',
  tipo: 'dependencia',
  activa: true,
};
const BRANDING = {
  empresa: 'H. Ayuntamiento de Coatzacoalcos',
  empresaCorta: 'Coatzacoalcos',
};

// El rol es `director_obras`: es el que recorre el #69 —ve todas las obras de
// su organización y captura— y el que se usó en el emulador el 2026-11-14.
const USUARIO = {
  correo: 'orlando@ayuntamientocoatza.gob',
  nombre: 'Orlando — Dirección de Obras Públicas',
  rol: 'director_obras',
};

// El id lo genera la app con `nuevoIdObra()` (src/App.jsx): del lado
// dependencia no hay catálogo de GP del que sacar una clave de cuatro dígitos.
// Se reproduce aquí en vez de teclear un id a mano, para que la obra de demo
// tenga la misma forma de identificador que cualquier otra de esa org.
const nuevoIdObra = () => {
  const TOPE = 36 ** 6;
  const n = new Uint32Array(1);
  do { require('crypto').webcrypto.getRandomValues(n); } while (n[0] >= TOPE);
  return `OB-${new Date().getFullYear()}-${n[0].toString(36).toUpperCase().padStart(6, '0')}`;
};

// Los valores por omisión son los del formulario de alta (`ModalNuevaObra`),
// no unos inventados aquí: una obra sembrada que no se parezca a una obra dada
// de alta enseñaría en la demo una pantalla que no es la del producto.
//
// La obra va SIN avance, SIN estimaciones y SIN fotos a propósito. En la demo
// la captura se hace en vivo delante del cliente; sembrar avance de mentira
// sería enseñar cifras que nadie midió, y además dejaría sin ver justamente lo
// que hay que enseñar: que la foto que se acaba de tomar sale «verificada».
const hoyMX = () => new Date().toLocaleDateString('es-MX',
  { day: '2-digit', month: 'long', year: 'numeric' });

const obraDemo = (id) => ({
  id,
  nombre: 'OBRA DEMO — Rehabilitación de pavimento, Col. Centro',
  contrato: 'MC-OP-2026-DEMO',
  cliente: ORG.nombre,
  modalidad: 'Licitación pública',
  empresaEjecutante: 'Constructora de Demostración, S.A. de C.V.',
  empresaRFC: '',
  supervisorDependencia: '',
  superintendente: '',
  residente: '',
  admin: '',
  origenRecursos: '',
  presupuesto: 12400000,
  gastoGP: 0,
  ultimaAct: hoyMX(),
  estado: 'activa',
  pctAnticipo: 10,
  pctFondoGar: 5,
  pctRetencion: 0,
  inicio: '2026-11-17',
  fin: '2027-04-30',
  finAmpliado: '',
  justificacionAmpliacion: '',
  modoAvance: 'volumen',
  creadaPor: 'siembra:#69',
});

const idDeCorreo = c => c.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');
const hoyISO = () => new Date().toISOString().slice(0, 10);

// ── ARRANQUE ────────────────────────────────────────────────────────────────

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: DESTINO.projectId,
  });
} catch (e) {
  console.error(`No se pudo inicializar el Admin SDK: ${e.message}`);
  console.error('¿Corriste `gcloud auth application-default login`?');
  process.exit(2);
}

const db = admin.firestore();
const auth = admin.auth();

// Cada escritura pasa por aquí: en ensayo imprime, y sólo con `--escribir`
// toca nada. Una segunda forma de escribir en este archivo sería una segunda
// forma de saltarse el ensayo.
const hechas = [];
async function poner(ruta, datos, { nota = '' } = {}) {
  hechas.push(ruta);
  console.log(`  ${ESCRIBIR ? 'ESCRIBE' : 'escribiría'}  ${ruta}${nota ? `   ← ${nota}` : ''}`);
  if (ESCRIBIR) await db.doc(ruta).set(datos, { merge: true });
}

(async () => {
  // ── a) LA ORGANIZACIÓN ───────────────────────────────────────────────────
  console.log('a) LA ORGANIZACIÓN');
  const orgPrevia = await db.doc(`orgs/${ORG_ID}`).get();
  if (orgPrevia.exists) {
    const d = orgPrevia.data();
    console.log(`  ya existe  orgs/${ORG_ID}  (tipo ${d.tipo}) — no se toca`);
    if (d.tipo !== 'dependencia') {
      console.error(`\n  orgs/${ORG_ID} existe con tipo «${d.tipo}», no «dependencia».`);
      console.error('  Sembrar la demo encima cambiaría de tipo una org en uso. Abortado.');
      process.exit(2);
    }
  } else {
    await poner(`orgs/${ORG_ID}`, {
      ...ORG,
      creadaEn: admin.firestore.FieldValue.serverTimestamp(),
      creadaPor: 'siembra:#69',
    });
    await poner(`orgs/${ORG_ID}/config/branding`, BRANDING,
      { nota: 'el encabezado que el cliente ve como suyo' });
  }

  // ── b) EL USUARIO ────────────────────────────────────────────────────────
  //
  // Antes del perfil va la identidad, porque el perfil guarda el `uid`. El
  // disparador `sincronizarClaims` aplica los claims al escribirse el perfil;
  // se ponen además aquí, explícitos, para no depender de que el disparador
  // haya corrido antes de que alguien intente entrar.
  console.log('\nb) EL USUARIO');
  let uid = null;
  try {
    const u = await auth.getUserByEmail(USUARIO.correo);
    uid = u.uid;
    console.log(`  ya existe en Auth  ${USUARIO.correo}  uid=${uid} — no se toca`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    console.log(`  ${ESCRIBIR ? 'CREA' : 'crearía'}  Auth  ${USUARIO.correo}  ` +
                '← SIN contraseña: la establece una persona desde la consola');
    if (ESCRIBIR) {
      const u = await auth.createUser({
        email: USUARIO.correo,
        displayName: USUARIO.nombre,
        emailVerified: false,
      });
      uid = u.uid;
      console.log(`         uid=${uid}`);
    }
  }

  const claims = { rol: USUARIO.rol, orgId: ORG_ID, tipo: ORG.tipo, todas: true, obras: [] };
  console.log(`  ${ESCRIBIR ? 'APLICA' : 'aplicaría'}  claims  ${JSON.stringify(claims)}`);
  if (ESCRIBIR && uid) await auth.setCustomUserClaims(uid, claims);

  await poner(`usuarios/${idDeCorreo(USUARIO.correo)}`, {
    nombre: USUARIO.nombre, correo: USUARIO.correo, email: USUARIO.correo,
    rol: USUARIO.rol, activo: true, orgId: ORG_ID,
    obras_asignadas: [], bienvenidaVista: false,
    ...(uid ? { uid } : {}),
  });

  // ── c) LA OBRA ───────────────────────────────────────────────────────────
  //
  // El id se sortea, así que primero se comprueba que la org no tenga ya una
  // obra de demo: correr esto dos veces no debe dejar dos.
  console.log('\nc) LA OBRA');
  const yaHay = await db.collection(`orgs/${ORG_ID}/obras`).limit(5).get();
  if (!yaHay.empty) {
    console.log(`  orgs/${ORG_ID}/obras ya tiene ${yaHay.size} obra(s): ` +
                yaHay.docs.map(d => d.id).join(', '));
    console.log('  No se siembra otra. Si querías una más, bórrala o dilo explícito.');
  } else {
    const id = nuevoIdObra();
    const obra = obraDemo(id);
    const base = `orgs/${ORG_ID}/obras/${id}`;
    // PRIMERO la bandera de evidencia, igual que `agregarObra`. Ver la
    // cabecera de este archivo.
    await poner(`${base}/config/evidencia`, {
      migrada: true, nacidaMigrada: true,
      creadaPor: obra.creadaPor, creadaEn: hoyISO(),
    }, { nota: 'la bandera va PRIMERO (#143): sin ella la foto sale «de archivo»' });
    await poner(base, obra, { nota: 'esto dispara `obraNuevaDeOrg` → correo' });
    await poner(`${base}/config/info`, obra);
  }

  console.log(`\n${ESCRIBIR ? 'Escritas' : 'Se escribirían'} ${hechas.length} ruta(s).`);
  if (!ESCRIBIR) console.log('Ensayo: no se tocó nada. Agrega `--escribir` para aplicar.');
  process.exit(0);
})().catch(e => {
  console.error(`\nFALLÓ: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
