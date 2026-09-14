#!/usr/bin/env node
/**
 * Backfill de custom claims para TODOS los usuarios de CAMPO.
 *
 * Uso (una sola vez, después de desplegar sincronizarClaims):
 *
 *   1) Descarga una service account key del proyecto campo-fosmon:
 *      Firebase Console → Project Settings → Service Accounts → Generate new private key
 *      Guárdala como ~/campo-sa.json (o donde prefieras, NUNCA commitees el archivo)
 *
 *   2) Ejecuta:
 *      GOOGLE_APPLICATION_CREDENTIALS=~/campo-sa.json \
 *        node scripts/backfill-claims.js
 *
 *   3) Verás por consola cuántos usuarios se actualizaron, cuántos ya estaban
 *      al día y cuántos fallaron (con el motivo).
 *
 * Idempotente: si vuelves a correrlo, no re-escribe claims iguales.
 *
 * Los usuarios afectados NECESITAN cerrar sesión y volver a entrar para que
 * su nuevo token contenga los claims. Firebase Auth también refresca los
 * tokens automáticamente cada ~1 hora.
 */
const admin = require("firebase-admin");

const ROLES_VALIDOS = [
  "director_general",
  "director_operaciones",
  "gerente_construccion",
  "superintendente",
  "residente",
  "administrador_obra",
  "supervisor",
  "admin_sistema",
  "cliente",
];
const ROLES_TODAS_OBRAS = new Set([
  "director_general",
  "director_operaciones",
  "gerente_construccion",
  "admin_sistema",
]);

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("ERROR: define GOOGLE_APPLICATION_CREDENTIALS con la ruta a tu service account JSON.");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

async function aplicarClaims(perfil) {
  const email = (perfil.email || "").toLowerCase().trim();
  if (!email) return { ok: false, motivo: "sin_email" };
  const rol = perfil.rol;
  if (!rol || !ROLES_VALIDOS.includes(rol)) {
    return { ok: false, motivo: `rol_invalido:${rol}` };
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
    ? { rol, todas, obras }
    : { rol: null, todas: false, obras: [], inactivo: true };
  const ex = userRecord.customClaims || {};
  const iguales =
    ex.rol === claims.rol &&
    ex.todas === claims.todas &&
    JSON.stringify(ex.obras || []) === JSON.stringify(claims.obras || []) &&
    (ex.inactivo || false) === (claims.inactivo || false);
  if (iguales) return { ok: true, sinCambios: true, claims };
  await admin.auth().setCustomUserClaims(userRecord.uid, claims);
  return { ok: true, claims };
}

async function main() {
  console.log("Leyendo usuarios de Firestore…");
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
        ? `rol=${res.claims.rol} todas=${res.claims.todas} obras=${res.claims.obras.length}`
        : "inactivo=true";
      console.log(`  ✓ ${perfil.email}  → ${claimsStr}`);
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
