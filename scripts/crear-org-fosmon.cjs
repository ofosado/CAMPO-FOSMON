#!/usr/bin/env node
/**
 * Crea la organización `orgs/fosmon` (tipo constructora) y propaga
 * `orgId: "fosmon"` a todos los usuarios existentes que no lo tengan.
 *
 * IMPORTANTE — orden recomendado en el despliegue de feature/organizaciones:
 *   1) firebase deploy --only functions (nueva versión de sincronizarClaims
 *      con soporte para orgId+tipo)
 *   2) node scripts/migrar-supervisor-a-auditor.js
 *   3) node scripts/crear-org-fosmon.js          ← este script
 *   4) node scripts/backfill-claims.js           (repuebla claims con orgId+tipo)
 *   5) firebase deploy --only firestore:rules,storage:rules
 *
 * NO mueve datos de obras a /orgs/fosmon/. Solo declara la organización
 * y etiqueta los perfiles con su orgId. Las obras siguen viviendo en /obras/*.
 *
 * Uso:
 *   gcloud auth application-default login
 *   gcloud config set project campo-fosmon
 *   node scripts/crear-org-fosmon.js
 *
 * Con --dry-run muestra lo que haría sin escribir.
 *
 * Idempotente: si la org ya existe y todos los usuarios ya tienen orgId,
 * el script no hace cambios.
 */
const admin = require("firebase-admin");

const DRY_RUN = process.argv.includes("--dry-run");
const ORG_ID = "fosmon";

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "campo-fosmon",
  });
} catch (e) {
  console.error("ERROR inicializando Firebase Admin con ADC:", e.message);
  console.error("");
  console.error("Solución: autentícate con Application Default Credentials:");
  console.error("  gcloud auth application-default login");
  console.error("  gcloud config set project campo-fosmon");
  process.exit(1);
}

(async () => {
  console.log(`\nBootstrap organización ${ORG_ID}${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const db = admin.firestore();

  // 1) Crear /orgs/fosmon si no existe
  const orgRef = db.doc(`orgs/${ORG_ID}`);
  const orgSnap = await orgRef.get();
  if (orgSnap.exists) {
    const data = orgSnap.data() || {};
    console.log(`Organización orgs/${ORG_ID} ya existe (tipo=${data.tipo}, activa=${data.activa}). No se toca.`);
  } else {
    console.log(`Organización orgs/${ORG_ID} NO existe. Se creará como tipo=constructora, activa=true.`);
    if (!DRY_RUN) {
      await orgRef.set({
        nombre: "FOSMON Construcciones",
        tipo: "constructora",
        activa: true,
        creadaEn: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`  ✓ orgs/${ORG_ID} creada.`);
    }
  }

  // 2) Propagar orgId a usuarios que no lo tienen
  const usersSnap = await db.collection("usuarios").get();
  const sinOrgId = usersSnap.docs.filter((d) => {
    const p = d.data();
    return !p.orgId && p.rol !== "soporte";
  });

  console.log(`\nUsuarios totales: ${usersSnap.size}`);
  console.log(`Usuarios sin orgId (excluyendo soporte): ${sinOrgId.length}`);

  if (sinOrgId.length === 0) {
    console.log("Todos los usuarios ya tienen orgId. Nada que propagar.");
    process.exit(0);
  }

  console.log("\nSerán etiquetados con orgId=\"fosmon\":");
  for (const d of sinOrgId) {
    const p = d.data();
    console.log(`  · ${d.id.padEnd(40)} rol=${(p.rol || "?").padEnd(22)} ${p.email || "(sin email)"}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run especificado. No se escribió nada.");
    process.exit(0);
  }

  console.log("\nAplicando cambios…");
  // Batch en lotes de 400 (límite Firestore = 500 ops por batch)
  for (let i = 0; i < sinOrgId.length; i += 400) {
    const chunk = sinOrgId.slice(i, i + 400);
    const batch = db.batch();
    for (const d of chunk) {
      batch.update(d.ref, {
        orgId: ORG_ID,
        _orgIdAsignadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    console.log(`  ✓ Lote ${Math.floor(i / 400) + 1}: ${chunk.length} usuarios actualizados.`);
  }

  console.log(`\n✓ ${sinOrgId.length} usuarios etiquetados con orgId="${ORG_ID}".`);
  console.log("  sincronizarClaims se disparará por cada update y refrescará los claims con orgId+tipo.");
  console.log("  Corre después scripts/backfill-claims.js para cubrir cualquier usuario cuyo trigger no haya corrido.");
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
