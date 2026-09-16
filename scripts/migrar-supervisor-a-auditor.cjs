#!/usr/bin/env node
/**
 * Migración de rol `supervisor` → `auditor` en la colección `usuarios/`.
 *
 * Contexto (2026-09):
 *   El rol antes llamado `supervisor` en CAMPO fue renombrado a `auditor`
 *   para no chocar con `supervisor_obra` de la edición de dependencia
 *   (feature/organizaciones). Los tres usuarios afectados en producción
 *   son auditores externos de una obra que FOSMON ejecuta en conjunto
 *   con Hytorc y Noleaks. La etiqueta visible cambia a "Auditor Interno".
 *
 * Uso (una sola vez, ANTES del script crear-org-fosmon.js):
 *
 *   1) Autentícate con Application Default Credentials (ADC) — SIN key file:
 *      gcloud auth application-default login
 *      gcloud config set project campo-fosmon
 *
 *   2) Ejecuta:
 *      node scripts/migrar-supervisor-a-auditor.js
 *
 *   3) Para simular sin escribir:
 *      node scripts/migrar-supervisor-a-auditor.js --dry-run
 *
 * Idempotente: al re-correr no cambia nada porque busca `rol == "supervisor"`
 * que ya no existirá tras la primera pasada.
 *
 * Efecto secundario: la escritura del doc dispara sincronizarClaims
 * automáticamente, así que los custom claims del usuario se actualizan solos.
 * No hace falta backfill separado.
 */
const admin = require("firebase-admin");

const DRY_RUN = process.argv.includes("--dry-run");

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
  console.log(`\nMigración supervisor → auditor${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  const snap = await admin.firestore().collection("usuarios")
    .where("rol", "==", "supervisor")
    .get();

  if (snap.empty) {
    console.log("Ningún usuario con rol=\"supervisor\" encontrado. Nada que migrar.");
    process.exit(0);
  }

  console.log(`Usuarios a migrar: ${snap.size}\n`);
  for (const doc of snap.docs) {
    const perfil = doc.data();
    console.log(`  · ${doc.id.padEnd(40)} ${perfil.email || "(sin email)"}   ${perfil.nombre || ""}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run especificado. No se escribió nada. Corre sin --dry-run para aplicar.");
    process.exit(0);
  }

  console.log("\nAplicando cambios…");
  const batch = admin.firestore().batch();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      rol: "auditor",
      _migradoSupervisorAuditor: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  console.log(`✓ ${snap.size} usuarios migrados a rol="auditor".`);
  console.log("  Los claims se actualizarán automáticamente vía sincronizarClaims.");
  console.log("  Los usuarios deben cerrar sesión y volver a entrar para refrescar su token.");
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
