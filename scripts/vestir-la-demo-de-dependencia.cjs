#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// VISTE LA DEMO DE DEPENDENCIA CON LAS DOS OBRAS DEL PENTÁGONO (#69)
// ════════════════════════════════════════════════════════════════════════════
//
// Tres cosas, decididas el 2026-11-15 y en este orden:
//
//   a) el correo de la cuenta de demo pasa a `orlando@cotea.com.mx`
//   b) se borra la obra genérica sembrada ayer (sin catálogo y sin curva)
//   c) se copian la 0128 y la 0131 —colector y emisor de John Sparks— con su
//      catálogo y su curva, bajo `orgs/coatzacoalcos/obras/`
//
// POR QUÉ EL CORREO ARRASTRA EL PERFIL. El login NO busca el perfil por uid:
// deriva el id del correo que se teclea —`replace(/@/g,'_')`, src/App.jsx:9825—
// y lee `usuarios/{eseId}`. Si no lo encuentra **rechaza la sesión** con «Tu
// cuenta no tiene perfil en el sistema» y cierra. O sea que cambiar el correo
// en Auth sin mover el perfil deja la cuenta sin poder entrar. El uid no
// cambia (`updateUser`), así que los claims y la campana siguen siendo suyos.
//
// LO QUE NO SE COPIA, Y POR QUÉ. De las dos obras se copian la carátula, el
// catálogo, la curva y los porcentajes del contrato. Se quedan FUERA:
//
//   nomina/historial          22 KB de nómina del contratista (0128)
//   avance/maquinaria         ·
//   avance/materiales         ·
//   config/otros_gastos       4 y 2 renglones de gasto
//   gpId · gastoGP · cargaOT  el enlace con Gestión de Proyectos
//
// Eso es la economía del contratista, y una dependencia no la lee. No es
// omisión: está escrito como principio en `firestore.rules`. Copiarlo «por
// completar la simetría» rompería el producto.
//
// Se quedan fuera también `avance/historial` (los cortes semanales 45 y 46) y
// `config/estimaciones` (una estimación por obra, $3.9 M y $5.05 M): son
// dinero del contrato real de SIOP y nadie pidió enseñarlos. La demo captura
// en vivo, así que la obra tiene que arrancar sin avance — es justo lo que se
// va a enseñar.
//
// `avance/subs` TAMPOCO se copia, y esto no es una omisión sino una medición:
// la app lo DERIVA del catálogo cuando falta y lo guarda ella misma
// (src/App.jsx:27321), en la misma forma en cero que tiene hoy en producción
// —46 y 73 renglones con `a:0`, `fotos:{}`, `cantEjec:0`, ninguna URL—. Y la
// ruta tiene permiso de escritura del lado dependencia (firestore.rules:712),
// así que la derivación no va a rebotar. Copiarlo sería escribir 60 KB para
// que la app los reescriba igual.
//
// EL ORDEN DENTRO DE CADA OBRA NO ES EL OBVIO, Y ES A PROPÓSITO.
// `config/evidencia` se escribe ANTES del documento de la obra, igual que el
// alta de la app desde el #143. Al revés, un fallo a mitad dejaría una obra
// nacida sin bandera: cada foto suya se archivaría sin autor y sin hora del
// servidor, y la galería la rotularía «de archivo» — en el expediente que se
// le va a enseñar a un director de Obras Públicas.
//
// LA CONTRASEÑA NO SE PONE AQUÍ, NI SE IMPRIME. Este guion no genera, no
// escribe y no imprime ninguna credencial. La establece una persona desde la
// consola de Firebase, o el propio Orlando desde el correo de restablecimiento
// —que ahora sí puede llegar, porque `cotea.com.mx` tiene MX vivo—.
//
// Uso (el `NODE_PATH` no es opcional: `firebase-admin` vive en `functions/`):
//   gcloud auth application-default login
//   export NODE_PATH="$PWD/functions/node_modules"
//   node scripts/vestir-la-demo-de-dependencia.cjs --prod              (ensayo)
//   node scripts/vestir-la-demo-de-dependencia.cjs --prod --escribir   (aplica)
//
// Idempotente: lo que ya esté como debe quedar no se vuelve a escribir.

'use strict';

// El portón va PRIMERO, antes de `require("firebase-admin")`. Si fuera al
// revés, equivocarse de destino daría un MODULE_NOT_FOUND en vez de «No hay
// destino», y el error diría la cosa equivocada.
const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({
  escribe: 'cambia el correo de la cuenta de demo, borra la obra genérica y ' +
           'copia la 0128 y la 0131 bajo orgs/coatzacoalcos',
});
const ESCRIBIR = DESTINO.escribir;

const admin = require('firebase-admin');

// ── LO QUE SE VA A HACER ────────────────────────────────────────────────────

const ORG_ID = 'coatzacoalcos';
const CORREO_VIEJO = 'orlando@ayuntamientocoatza.gob';
const CORREO_NUEVO = 'orlando@cotea.com.mx';
const OBRA_GENERICA = 'OB-2026-DX5V00';
const ORIGEN = ['0128', '0131'];

// Las claves de la obra que NO cruzan a la dependencia. `gpId` y `gastoGP` son
// el enlace con Gestión de Proyectos —el gasto real del contratista— y
// `cargaOT` el rastro de esa carga.
const CLAVES_QUE_NO_CRUZAN = ['gpId', 'gastoGP', 'cargaOT'];

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

// Toda escritura y todo borrado pasan por estas dos puertas: en ensayo
// imprimen y no tocan nada. Una tercera forma de escribir en este archivo
// sería una tercera forma de saltarse el ensayo.
const hechas = [];
const borradas = [];

async function poner(ruta, datos, { nota = '' } = {}) {
  hechas.push(ruta);
  const n = JSON.stringify(datos).length;
  console.log(`  ${ESCRIBIR ? 'ESCRIBE' : 'escribiría'}  ${ruta}  (${n.toLocaleString('es-MX')} b)` +
              `${nota ? `\n             ← ${nota}` : ''}`);
  if (ESCRIBIR) await db.doc(ruta).set(datos, { merge: true });
}

async function quitar(ruta, { nota = '' } = {}) {
  borradas.push(ruta);
  console.log(`  ${ESCRIBIR ? 'BORRA  ' : 'borraría'}  ${ruta}` +
              `${nota ? `\n             ← ${nota}` : ''}`);
  if (ESCRIBIR) await db.doc(ruta).delete();
}

(async () => {
  // ── a) EL CORREO DE LA CUENTA ────────────────────────────────────────────
  console.log('a) EL CORREO DE LA CUENTA DE DEMO');

  let uid = null;
  let correoActual = null;
  for (const c of [CORREO_NUEVO, CORREO_VIEJO]) {
    try {
      const u = await auth.getUserByEmail(c);
      uid = u.uid; correoActual = c;
      break;
    } catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
  }
  if (!uid) {
    console.error(`\n  No existe en Auth ni ${CORREO_VIEJO} ni ${CORREO_NUEVO}.`);
    console.error('  Esto esperaba la cuenta sembrada el 2026-11-15. Abortado.');
    process.exit(2);
  }

  if (correoActual === CORREO_NUEVO) {
    console.log(`  ya es  ${CORREO_NUEVO}  uid=${uid} — no se toca`);
  } else {
    console.log(`  ${ESCRIBIR ? 'CAMBIA' : 'cambiaría'}  Auth  ${CORREO_VIEJO} → ${CORREO_NUEVO}  (uid=${uid}, no cambia)`);
    if (ESCRIBIR) await auth.updateUser(uid, { email: CORREO_NUEVO, emailVerified: false });
  }

  // El perfil se mueve porque el login lo busca por el correo, no por el uid.
  const idViejo = idDeCorreo(CORREO_VIEJO);
  const idNuevo = idDeCorreo(CORREO_NUEVO);
  const perfilViejo = await db.doc(`usuarios/${idViejo}`).get();
  const perfilNuevo = await db.doc(`usuarios/${idNuevo}`).get();

  if (perfilNuevo.exists && !perfilViejo.exists) {
    console.log(`  ya está  usuarios/${idNuevo} — no se toca`);
  } else {
    const base = perfilViejo.exists ? perfilViejo.data() : perfilNuevo.data();
    await poner(`usuarios/${idNuevo}`, {
      ...base, correo: CORREO_NUEVO, email: CORREO_NUEVO, uid,
    }, { nota: 'el login deriva ESTE id del correo tecleado (src/App.jsx:9825)' });
    if (perfilViejo.exists) {
      await quitar(`usuarios/${idViejo}`,
        { nota: 'si se queda, el padrón de la org enseña dos Orlandos y uno no puede entrar' });
    }
  }

  // ── b) LA OBRA GENÉRICA SE VA ────────────────────────────────────────────
  console.log('\nb) LA OBRA GENÉRICA SEMBRADA AYER');
  const gen = await db.doc(`orgs/${ORG_ID}/obras/${OBRA_GENERICA}`).get();
  if (!gen.exists) {
    console.log(`  ya no está  ${OBRA_GENERICA} — nada que borrar`);
  } else {
    for (const sub of ['config/evidencia', 'config/info']) {
      const d = await db.doc(`orgs/${ORG_ID}/obras/${OBRA_GENERICA}/${sub}`).get();
      if (d.exists) await quitar(`orgs/${ORG_ID}/obras/${OBRA_GENERICA}/${sub}`);
    }
    await quitar(`orgs/${ORG_ID}/obras/${OBRA_GENERICA}`,
      { nota: 'sin catálogo, sin curva, sin avance y sin fotos: nada la referencia' });
  }

  // El aviso que dejó en la campana apunta a una obra que ya no existe. Se
  // BORRA, no se marca como leído: marcar leído sería dejar escrito que
  // alguien lo leyó, y nadie lo leyó.
  const avisos = await db.collection(`notificaciones/${uid}/items`).get();
  const huerfanos = avisos.docs.filter(d => {
    const v = d.data();
    return (v.link && JSON.stringify(v.link).includes(OBRA_GENERICA)) ||
           (v.titulo || '').includes('Rehabilitación de pavimento, Col. Centro');
  });
  if (!huerfanos.length) {
    console.log('  campana: ningún aviso apunta a esa obra');
  } else {
    for (const d of huerfanos) {
      await quitar(`notificaciones/${uid}/items/${d.id}`,
        { nota: 'el aviso de una obra que ya no existe. Se borra, no se marca leído' });
    }
  }

  // ── c) LAS DOS OBRAS DEL PENTÁGONO ───────────────────────────────────────
  console.log('\nc) LAS DOS OBRAS DEL PENTÁGONO (copiadas tal cual)');

  for (const id of ORIGEN) {
    console.log(`\n  ── ${id} ──`);
    const src = await db.doc(`obras/${id}`).get();
    if (!src.exists) {
      console.error(`  obras/${id} no existe en el origen. Abortado.`);
      process.exit(2);
    }
    const o = src.data();
    const obra = { ...o };
    for (const k of CLAVES_QUE_NO_CRUZAN) delete obra[k];

    // Quien ejecuta es FOSMON: estas son sus obras, en su sistema. No es un
    // dato inventado, es el que falta del lado dependencia.
    obra.empresaEjecutante = 'FOSMON CONSTRUCCIONES, S.A. DE C.V.';
    obra.creadaPor = 'siembra:#69';
    obra.ultimaAct = new Date().toLocaleDateString('es-MX',
      { day: '2-digit', month: 'long', year: 'numeric' });

    // `modalidad` se queda VACÍA a propósito: es obligatoria en el alta de
    // dependencia, pero el dato no está en el origen y teclear «Licitación
    // pública» porque suena bien sería inventar un hecho jurídico sobre un
    // contrato real. Que salga vacía es verdad; que salga llena, no.
    if (!obra.modalidad) obra.modalidad = '';

    const base = `orgs/${ORG_ID}/obras/${id}`;
    const yaEsta = await db.doc(base).get();
    if (yaEsta.exists) {
      console.log(`  ya existe  ${base} — no se vuelve a copiar`);
      continue;
    }

    // PRIMERO la bandera de evidencia. Ver la cabecera de este archivo.
    await poner(`${base}/config/evidencia`, {
      migrada: true, nacidaMigrada: true,
      creadaPor: 'siembra:#69', creadaEn: hoyISO(),
    }, { nota: 'la bandera va PRIMERO (#143): sin ella la foto sale «de archivo»' });

    await poner(base, obra, { nota: 'esto dispara `obraNuevaDeOrg` → correo y campana' });
    await poner(`${base}/config/info`, obra);

    for (const sub of ['catalogo', 'programa', 'parametros']) {
      const d = await db.doc(`obras/${id}/config/${sub}`).get();
      if (!d.exists) { console.log(`  (origen sin config/${sub})`); continue; }
      const datos = d.data();
      const nota = sub === 'catalogo'
        ? `${(datos.conceptos || []).length} partidas · suma = importeContrato`
        : sub === 'programa'
          ? `la curva: ${(datos.meses || '?')} meses con montos[] y barras`
          : 'anticipo / fondo de garantía / retención del contrato';
      await poner(`${base}/config/${sub}`, datos, { nota });
    }
  }

  // ── CIERRE ───────────────────────────────────────────────────────────────
  console.log(`\n${ESCRIBIR ? 'Escritas' : 'Se escribirían'} ${hechas.length} ruta(s) · ` +
              `${ESCRIBIR ? 'borradas' : 'se borrarían'} ${borradas.length}.`);
  if (!ESCRIBIR) console.log('Ensayo: no se tocó nada. Agrega `--escribir` para aplicar.');
  process.exit(0);
})().catch(e => {
  console.error(`\nFALLÓ: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
