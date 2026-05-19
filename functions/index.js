/**
 * Cloud Functions para CAMPO — Gestión de usuarios FOSMON
 *
 * Funciones expuestas (Callable):
 *  - crearUsuario:      crea en Firebase Auth + perfil en Firestore
 *  - actualizarUsuario: cambia nombre/rol/obras_asignadas/activo
 *  - eliminarUsuario:   borra de Firebase Auth + Firestore
 *  - cambiarPassword:   admin resetea contraseña de otro usuario
 *  - listarUsuarios:    devuelve lista combinada de Firestore + estado Auth
 *
 * Reglas de seguridad:
 *  - El llamador DEBE estar autenticado.
 *  - Sólo roles director_general y admin_sistema pueden gestionar usuarios.
 *  - No se puede eliminar a uno mismo.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const ROLES_VALIDOS = [
  "director_general",
  "director_operaciones",
  "gerente_construccion",
  "administrador_obra",
  "admin_sistema",
  "cliente",
];

const ROLES_ADMIN = ["director_general", "director_operaciones", "admin_sistema"];

// Normaliza email para usarlo como ID de documento Firestore (igual que en CAMPO frontend)
const emailAId = (email) => email.toLowerCase().replace(/@/g, "_").replace(/\./g, "_");

// Verifica que el llamador esté autenticado y tenga rol admin
async function requireAdmin(auth) {
  if (!auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const email = (auth.token.email || "").toLowerCase();
  if (!email) {
    throw new HttpsError("unauthenticated", "Token sin email.");
  }
  const snap = await admin.firestore().doc(`usuarios/${emailAId(email)}`).get();
  const perfil = snap.exists ? snap.data() : null;
  if (!perfil || !ROLES_ADMIN.includes(perfil.rol)) {
    throw new HttpsError(
      "permission-denied",
      "Sólo director_general y admin_sistema pueden gestionar usuarios."
    );
  }
  return { email, perfil };
}

// ──────────────────────────────────────────────────────────────────────────
// CREAR USUARIO
// ──────────────────────────────────────────────────────────────────────────
exports.crearUsuario = onCall(async (request) => {
  await requireAdmin(request.auth);

  const { email, password, nombre, rol, obras_asignadas } = request.data || {};

  if (!email || !password || !nombre || !rol) {
    throw new HttpsError(
      "invalid-argument",
      "Faltan datos requeridos: email, password, nombre y rol."
    );
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new HttpsError("invalid-argument", `Rol inválido: ${rol}`);
  }
  if (password.length < 6) {
    throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
  }

  const emailNorm = email.toLowerCase().trim();

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email: emailNorm,
      password,
      displayName: nombre,
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "Ya existe un usuario con ese correo.");
    }
    throw new HttpsError("internal", `Error al crear en Auth: ${e.message}`);
  }

  await admin.firestore().doc(`usuarios/${emailAId(emailNorm)}`).set({
    email: emailNorm,
    nombre,
    rol,
    obras_asignadas: Array.isArray(obras_asignadas) ? obras_asignadas : [],
    activo: true,
    uid: userRecord.uid,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    creadoPor: request.auth.token.email || "",
  });

  return { ok: true, uid: userRecord.uid, email: emailNorm };
});

// ──────────────────────────────────────────────────────────────────────────
// ACTUALIZAR USUARIO
// ──────────────────────────────────────────────────────────────────────────
exports.actualizarUsuario = onCall(async (request) => {
  await requireAdmin(request.auth);

  const { email, cambios } = request.data || {};
  if (!email || !cambios || typeof cambios !== "object") {
    throw new HttpsError("invalid-argument", "Faltan datos: email y cambios.");
  }

  const emailNorm = email.toLowerCase().trim();
  const ref = admin.firestore().doc(`usuarios/${emailAId(emailNorm)}`);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Usuario no encontrado en Firestore.");
  }

  if (cambios.rol && !ROLES_VALIDOS.includes(cambios.rol)) {
    throw new HttpsError("invalid-argument", `Rol inválido: ${cambios.rol}`);
  }

  const camposPermitidos = ["nombre", "rol", "obras_asignadas", "activo"];
  const update = {};
  for (const k of camposPermitidos) {
    if (k in cambios) update[k] = cambios[k];
  }
  update.actualizadoEn = admin.firestore.FieldValue.serverTimestamp();
  update.actualizadoPor = request.auth.token.email || "";

  await ref.set(update, { merge: true });

  // Reflejar cambios en Auth
  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);
  if (userRecord) {
    const authUpdate = {};
    if (cambios.activo === false) authUpdate.disabled = true;
    else if (cambios.activo === true) authUpdate.disabled = false;
    if (cambios.nombre) authUpdate.displayName = cambios.nombre;
    if (Object.keys(authUpdate).length > 0) {
      await admin.auth().updateUser(userRecord.uid, authUpdate);
    }
  }

  return { ok: true };
});

// ──────────────────────────────────────────────────────────────────────────
// ELIMINAR USUARIO
// ──────────────────────────────────────────────────────────────────────────
exports.eliminarUsuario = onCall(async (request) => {
  const { email: emailLlamador } = await requireAdmin(request.auth);

  const { email } = request.data || {};
  if (!email) {
    throw new HttpsError("invalid-argument", "Falta email.");
  }
  const emailNorm = email.toLowerCase().trim();

  if (emailNorm === emailLlamador) {
    throw new HttpsError("failed-precondition", "No puedes eliminarte a ti mismo.");
  }

  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);
  if (userRecord) {
    await admin.auth().deleteUser(userRecord.uid);
  }
  await admin.firestore().doc(`usuarios/${emailAId(emailNorm)}`).delete();

  return { ok: true };
});

// ──────────────────────────────────────────────────────────────────────────
// CAMBIAR CONTRASEÑA (admin resetea la de otro usuario)
// ──────────────────────────────────────────────────────────────────────────
exports.cambiarPassword = onCall(async (request) => {
  await requireAdmin(request.auth);

  const { email, nuevaPassword } = request.data || {};
  if (!email || !nuevaPassword) {
    throw new HttpsError("invalid-argument", "Falta email o nuevaPassword.");
  }
  if (nuevaPassword.length < 6) {
    throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
  }

  const userRecord = await admin.auth().getUserByEmail(email.toLowerCase().trim()).catch(() => null);
  if (!userRecord) {
    throw new HttpsError("not-found", "Usuario no encontrado.");
  }
  await admin.auth().updateUser(userRecord.uid, { password: nuevaPassword });
  return { ok: true };
});

// ──────────────────────────────────────────────────────────────────────────
// LISTAR USUARIOS (combina Firestore + estado Auth)
// ──────────────────────────────────────────────────────────────────────────
exports.listarUsuarios = onCall(async (request) => {
  await requireAdmin(request.auth);

  const snap = await admin.firestore().collection("usuarios").get();
  const usuarios = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    let disabled = false;
    try {
      const u = await admin.auth().getUserByEmail(data.email);
      disabled = u.disabled;
    } catch { /* usuario no existe en Auth */ }
    // creadoEn puede venir como Firestore Timestamp (con .toMillis) o como string ISO (auto-create del login)
    let creadoEnMs = null;
    if (data.creadoEn) {
      if (typeof data.creadoEn.toMillis === "function") {
        creadoEnMs = data.creadoEn.toMillis();
      } else if (typeof data.creadoEn === "string") {
        const t = Date.parse(data.creadoEn);
        creadoEnMs = isNaN(t) ? null : t;
      }
    }
    usuarios.push({
      id: doc.id,
      email: data.email,
      nombre: data.nombre,
      rol: data.rol,
      obras_asignadas: data.obras_asignadas || [],
      activo: data.activo !== false && !disabled,
      creadoEn: creadoEnMs,
    });
  }
  return { usuarios };
});
