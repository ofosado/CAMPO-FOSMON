#!/usr/bin/env node
/**
 * Backfill de custom claims para TODOS los usuarios de CAMPO.
 *
 * Uso (una sola vez, después de desplegar sincronizarClaims):
 *
 *   1) Autentícate con Application Default Credentials (ADC) — SIN key file:
 *      gcloud auth application-default login
 *      gcloud config set project campo-fosmon
 *
 *   2) Ejecuta:
 *      node scripts/backfill-claims.js
 *
 *   3) Para simular sin escribir claims:
 *      node scripts/backfill-claims.js --dry-run
 *
 *   4) Verás por consola cuántos usuarios se actualizaron, cuántos ya estaban
 *      al día y cuántos fallaron (con el motivo).
 *
 * ADC lee credenciales automáticamente en este orden:
 *   - Variable de entorno GOOGLE_APPLICATION_CREDENTIALS (opcional, para CI)
 *   - Credenciales de `gcloud auth application-default login` (local, recomendado)
 *   - Metadata server (en Cloud Run / Cloud Functions)
 *
 * Idempotente: si vuelves a correrlo, no re-escribe claims iguales.
 *
 * Los usuarios afectados NECESITAN cerrar sesión y volver a entrar para que
 * su nuevo token contenga los claims. Firebase Auth también refresca los
 * tokens automáticamente cada ~1 hora.
 */
const admin = require("firebase-admin");

const DRY_RUN = process.argv.includes("--dry-run");

// Debe coincidir con functions/index.js — ROLES_POR_TIPO + ROLES_CROSS
const ROLES_POR_TIPO = {
  constructora: [
    "director_general","director_operaciones","gerente_construccion",
    "superintendente","residente","administrador_obra",
    "auditor","admin_sistema","cliente",
  ],
  dependencia: [
    "director_obras","subdirector","jefe_supervision",
    "supervisor_obra","administrativo","contralor","contratista",
  ],
};
const ROLES_CROSS = ["soporte"];
const ROLES_VALIDOS = [
  ...ROLES_POR_TIPO.constructora,
  ...ROLES_POR_TIPO.dependencia,
  ...ROLES_CROSS,
];
const ROLES_TODAS_OBRAS = new Set([
  "director_general","director_operaciones","gerente_construccion","admin_sistema",
  "director_obras","subdirector","jefe_supervision","contralor",
]);
function tipoDeRol(rol) {
  if (ROLES_POR_TIPO.constructora.includes(rol)) return "constructora";
  if (ROLES_POR_TIPO.dependencia.includes(rol)) return "dependencia";
  return null;
}

// ADC: sin key file. Corre `gcloud auth application-default login` primero.
// Falla temprano con mensaje claro si no hay credenciales disponibles.
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

async function leerOrg(orgId) {
  if (!orgId) return null;
  const snap = await admin.firestore().doc(`orgs/${orgId}`).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return { tipo: d.tipo || null, activa: d.activa !== false };
}

async function aplicarClaims(perfil) {
  const email = (perfil.email || "").toLowerCase().trim();
  if (!email) return { ok: false, motivo: "sin_email" };
  const rol = perfil.rol;
  if (!rol || !ROLES_VALIDOS.includes(rol)) {
    return { ok: false, motivo: `rol_invalido:${rol}` };
  }
  const esCross = ROLES_CROSS.includes(rol);
  let orgId = null, tipo = null;
  if (!esCross) {
    orgId = perfil.orgId || null;
    if (orgId) {
      const org = await leerOrg(orgId);
      if (!org) return { ok: false, motivo: `org_no_existe:${orgId}` };
      if (!org.activa) return { ok: false, motivo: `org_inactiva:${orgId}` };
      tipo = org.tipo;
      const rolesDelTipo = ROLES_POR_TIPO[tipo] || [];
      if (!rolesDelTipo.includes(rol)) {
        return { ok: false, motivo: `rol_no_pertenece_tipo:${rol}/${tipo}` };
      }
    }
  }
  let userRecord;
  try {
    userRecord = perfil.uid
      ? await admin.auth().getUser(perfil.uid).catch(() => null)
      : null;
    if (!userRecord) userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    return { ok: false, motivo: `auth_no_encontrado:${e.code || e.message}` };
  }
  const todas = ROLES_TODAS_OBRAS.has(rol);
  const obras = todas ? [] : (Array.isArray(perfil.obras_asignadas) ? perfil.obras_asignadas.map(String) : []);
  const activo = perfil.activo !== false;
  const claims = activo
    ? { rol, orgId, tipo, todas, obras }
    : { rol: null, orgId: null, tipo: null, todas: false, obras: [], inactivo: true };
  const ex = userRecord.customClaims || {};
  const iguales =
    ex.rol === claims.rol &&
    ex.orgId === claims.orgId &&
    ex.tipo === claims.tipo &&
    ex.todas === claims.todas &&
    JSON.stringify(ex.obras || []) === JSON.stringify(claims.obras || []) &&
    (ex.inactivo || false) === (claims.inactivo || false);
  if (iguales) return { ok: true, sinCambios: true, claims };
  if (DRY_RUN) return { ok: true, claims, simulado: true };
  await admin.auth().setCustomUserClaims(userRecord.uid, claims);
  return { ok: true, claims };
}

async function main() {
  console.log(`Leyendo usuarios de Firestore${DRY_RUN ? " (DRY RUN)" : ""}…`);
  const snap = await admin.firestore().collection("usuarios").get();
  console.log(`Total en Firestore: ${snap.size}`);

  let aplicados = 0, sinCambios = 0, fallidos = 0;
  const detalleFallidos = [];

  for (const doc of snap.docs) {
    const perfil = doc.data();
    const res = await aplicarClaims(perfil);
    if (!res.ok) {
      fallidos++;
      detalleFallidos.push({ docId: doc.id, email: perfil.email, motivo: res.motivo });
      console.log(`  ✗ ${perfil.email || doc.id}  (${res.motivo})`);
    } else if (res.sinCambios) {
      sinCambios++;
      console.log(`  · ${perfil.email}  ya al día`);
    } else {
      aplicados++;
      const claimsStr = res.claims.rol
        ? `rol=${res.claims.rol} orgId=${res.claims.orgId} tipo=${res.claims.tipo} todas=${res.claims.todas} obras=${res.claims.obras.length}`
        : "inactivo=true";
      const marca = res.simulado ? "(dry)" : "     ";
      console.log(`  ✓ ${marca} ${perfil.email}  → ${claimsStr}`);
    }
  }

  console.log("");
  console.log("─".repeat(60));
  console.log(`Aplicados: ${aplicados}  ·  Sin cambios: ${sinCambios}  ·  Fallidos: ${fallidos}`);
  if (fallidos > 0) {
    console.log("");
    console.log("Fallidos:");
    detalleFallidos.forEach(f => console.log(`  - ${f.email || f.docId} → ${f.motivo}`));
  }
  console.log("");
  console.log("Los usuarios necesitan cerrar sesión y volver a entrar para que");
  console.log("su token JWT contenga los nuevos claims. También se refresca solo");
  console.log("después de ~1 hora automáticamente.");
  process.exit(fallidos > 0 ? 1 : 0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(2); });
