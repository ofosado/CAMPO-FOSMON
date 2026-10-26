// ── RETIRAR LOS AVISOS DEL CRON HUÉRFANO ───────────────────────────────────
//
// `recordatorioCapturaSubs` quedó desplegado sin estar en el código fuente:
// lo quitó el commit f6d32be y el despliegue nunca lo arrastró. Siguió
// corriendo los viernes a las 12:00 CDMX durante cinco semanas pidiéndole a
// dos personas que capturaran el avance de sus subcontratistas — una acción
// que la aplicación ya no les deja hacer.
//
// La función se borró el 2026-10-23. Quedan sus avisos, sin leer, en la
// campanita de esas dos personas. Dejarlos puestos entrena a ignorar la
// campanita, y la campanita es el canal por el que se avisa lo que sí importa.
//
// Se BORRAN, no se marcan leídos. Marcarlos leídos deja escrito que dos
// personas leyeron algo que nunca leyeron, y además deja la petición imposible
// visible en su historial. Borrar deja menos rastro raro.
//
// Antes de borrar, el guion vuelca cada documento completo a un archivo JSON.
// Un borrado no se revierte, pero lo que decía sí queda.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolverDestino } = require('./destino.cjs');

const destino = resolverDestino({ escribe: 'BORRA notificaciones en la campanita de dos usuarios' });

const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: destino.projectId });
const db = admin.firestore();

// Los dos destinatarios que el cron huérfano venía molestando.
const UIDS = [
  { uid: 'H3MyJCCQCJNlNJ9gblcP7dYwohX2', quien: 'jislas@fosmon.com.mx (superintendente)' },
  { uid: 'cJSyYw59vVhVe0cURp3UYOC3wqI2', quien: 'atorres@fosmon.com.mx (administrador_obra)' },
];

// Lo que identifica a un aviso de ese cron y de nadie más. Se exige que las
// DOS cosas coincidan: quién lo creó y de qué es. En esas dos campanitas
// conviven `captura_obra_pendiente` y `sin_captura_10d`, que vienen de crones
// que SÍ siguen vivos y piden algo que la aplicación sí deja hacer: esos no se
// tocan. Sólo `captura_sub_pendiente` es del huérfano.
const CREADA_POR = 'sistema:recordatorios';
const TIPO_HUERFANO = 'captura_sub_pendiente';

(async () => {
  const aBorrar = [];
  const respetados = [];

  for (const { uid, quien } of UIDS) {
    const snap = await db.collection(`notificaciones/${uid}/items`).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const esDelHuerfano = d.creadaPor === CREADA_POR && d.tipo === TIPO_HUERFANO;
      const fila = {
        quien, uid, id: doc.id, ruta: doc.ref.path,
        datos: JSON.parse(JSON.stringify(d, (k, v) => (v && v._seconds ? new Date(v._seconds * 1000).toISOString() : v))),
      };
      (esDelHuerfano ? aBorrar : respetados).push(fila);
    }
  }

  console.log(`Avisos del cron huérfano encontrados: ${aBorrar.length}`);
  for (const f of aBorrar) {
    console.log(`  ${f.ruta}`);
    console.log(`     tipo=${f.datos.tipo}  leida=${f.datos.leida}  fecha=${f.datos.fecha}`);
    console.log(`     "${f.datos.titulo}" — ${f.datos.mensaje}`);
  }
  console.log(`\nOtros avisos en esas dos campanitas (NO se tocan): ${respetados.length}`);
  for (const f of respetados) {
    console.log(`  ${f.ruta}  tipo=${f.datos.tipo} creadaPor=${f.datos.creadaPor} leida=${f.datos.leida}`);
  }

  if (!destino.escribir) {
    console.log('\nEnsayo: no se borró nada.');
    process.exit(0);
  }

  // El volcado sale FUERA del árbol del repo. Trae correos de empleados
  // reales, y un archivo así dentro del directorio es cuestión de tiempo que
  // alguien lo commitee sin querer: un `git add -A` distraído lo publica. No
  // basta con `.gitignore` —lo que no debería estar ahí no se protege, se
  // saca—. Si el directorio no existe, el guion se para ANTES de borrar nada:
  // quedarse sin constancia de un borrado que no se revierte es peor que no
  // borrar hoy.
  const dirDatos = process.env.CAMPO_DATOS_PROD ||
    path.join(os.homedir(), 'Desarrollo', 'CAMPO-datos-produccion');
  if (!fs.existsSync(dirDatos)) {
    console.error(
      `\nNo existe ${dirDatos}, que es donde va el volcado.\n\n` +
      '  mkdir -p "' + dirDatos + '" && chmod 700 "' + dirDatos + '"\n\n' +
      'No se borró nada. El volcado es la única constancia de qué decía lo\n' +
      'que se borra, y un borrado en producción no se revierte.');
    process.exit(2);
  }
  const volcado = path.join(dirDatos,
    `avisos-huerfanos-borrados-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(volcado, JSON.stringify(aBorrar, null, 2));
  console.log(`\nVolcado íntegro antes de borrar: ${volcado}`);

  let n = 0;
  for (const f of aBorrar) { await db.doc(f.ruta).delete(); n++; }
  console.log(`Borrados: ${n}`);

  // Relectura: el conteo no se deduce del contador, se vuelve a medir.
  let quedan = 0;
  for (const { uid } of UIDS) {
    const snap = await db.collection(`notificaciones/${uid}/items`).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.creadaPor === CREADA_POR && d.tipo === TIPO_HUERFANO) quedan++;
    }
  }
  console.log(`Relectura: quedan ${quedan} avisos del cron huérfano.`);
  process.exit(quedan === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
