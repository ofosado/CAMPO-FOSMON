/**
 * Suite de pruebas de reglas de seguridad de CAMPO.
 *
 * Estrategia: llamadas HTTP DIRECTAS a los emuladores de Firestore y Storage.
 * Evita completamente los bugs conocidos del SDK JS v9/v10 (issue #7509
 * "Firestore has already been started") que impiden usar múltiples contextos
 * con rules-unit-testing en el mismo proceso Node.
 *
 * Cada llamada incluye un JWT firmado con el token del emulador de Auth,
 * codificado como Bearer. El emulador Firestore/Storage valida el token
 * y evalúa las reglas contra los claims.
 *
 * Cómo correr:
 *   firebase emulators:exec --only firestore,auth,storage --project campo-fosmon-test \
 *     'cd tests && node run-tests.js'
 *
 * o desde tests/:
 *   npm test    (que hace lo mismo)
 */

const http = require("http");
const { URL } = require("url");

const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const STORAGE_HOST   = process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199";
const PROJECT_ID     = "campo-fosmon-test";
const BUCKET         = `${PROJECT_ID}.appspot.com`;

const OBRA_A = "0126";
const OBRA_B = "0127";

const ROLES_TODAS = new Set([
  "director_general", "director_operaciones", "gerente_construccion", "admin_sistema",
]);

// ─── Token JWT firmado (emulador acepta cualquier firma) ─────────────
// El emulador de Firebase acepta tokens JWT sin verificar firma. Solo
// requiere el formato con header y payload correctos.
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeToken(uid, extraClaims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "none", typ: "JWT" };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    auth_time: now,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: {
      identities: extraClaims.email ? { email: [extraClaims.email] } : {},
      sign_in_provider: "custom",
    },
    ...extraClaims,
  };
  // El emulador valida formato pero NO la firma
  return `${b64url(header)}.${b64url(payload)}.`;
}

function tokenFor(rol, { obras = [OBRA_A], todas, email, inactivo = false } = {}) {
  const _todas = todas === undefined ? ROLES_TODAS.has(rol) : todas;
  return {
    email: email || `${rol}@test.com`,
    email_verified: true,
    rol,
    todas: _todas,
    obras: _todas ? [] : obras,
    ...(inactivo ? { inactivo: true } : {}),
  };
}

function makeUser(uid, rol, opts = {}) {
  const claims = tokenFor(rol, opts);
  return { uid, jwt: makeToken(uid, claims), claims };
}

// ─── HTTP helpers ─────────────────────────────────────────────────────
function httpRequest(host, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const [h, port] = host.split(":");
    const opts = {
      hostname: h,
      port: parseInt(port, 10),
      method,
      path,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

// ─── Firestore ─────────────────────────────────────────────────────────
const FS_BASE = `/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Convierte objeto JS a formato Firestore REST
function toFsFields(obj) {
  if (obj === null || obj === undefined) return { nullValue: null };
  if (typeof obj === "string")   return { stringValue: obj };
  if (typeof obj === "number")   return Number.isInteger(obj) ? { integerValue: obj } : { doubleValue: obj };
  if (typeof obj === "boolean")  return { booleanValue: obj };
  if (Array.isArray(obj))        return { arrayValue: { values: obj.map(toFsFields) } };
  if (typeof obj === "object") {
    const fields = {};
    for (const k of Object.keys(obj)) fields[k] = toFsFields(obj[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(obj) };
}
function docToFields(obj) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toFsFields(obj[k]);
  return fields;
}

async function fsRead(user, docPath) {
  const auth = user ? { Authorization: `Bearer ${user.jwt}` } : {};
  const res = await httpRequest(FIRESTORE_HOST, "GET", `${FS_BASE}/${docPath}`, null, auth);
  return res;
}
async function fsWrite(user, docPath, data) {
  const auth = user ? { Authorization: `Bearer ${user.jwt}` } : {};
  const body = { fields: docToFields(data) };
  const res = await httpRequest(FIRESTORE_HOST, "PATCH",
    `${FS_BASE}/${docPath}`, body, auth);
  return res;
}
async function fsDelete(user, docPath) {
  const auth = user ? { Authorization: `Bearer ${user.jwt}` } : {};
  const res = await httpRequest(FIRESTORE_HOST, "DELETE", `${FS_BASE}/${docPath}`, null, auth);
  return res;
}

// ─── Storage ───────────────────────────────────────────────────────────
async function stRead(user, filePath) {
  const auth = user ? { Authorization: `Bearer ${user.jwt}` } : {};
  const encoded = encodeURIComponent(filePath);
  const res = await httpRequest(STORAGE_HOST, "GET",
    `/v0/b/${BUCKET}/o/${encoded}?alt=media`, null, auth);
  return res;
}
async function stWrite(user, filePath, content = "x") {
  const auth = user ? { Authorization: `Bearer ${user.jwt}` } : {};
  // Upload simple: POST /v0/b/{bucket}/o?name=path con Content-Type
  const res = await httpRequest(STORAGE_HOST, "POST",
    `/v0/b/${BUCKET}/o?name=${encodeURIComponent(filePath)}&uploadType=media`,
    content,
    { ...auth, "Content-Type": "application/octet-stream" });
  return res;
}

// ─── Pre-carga bypaseando reglas ──────────────────────────────────────
// El emulador tiene endpoint /emulator para operaciones administrativas.
async function limpiarEmuladores() {
  await httpRequest(FIRESTORE_HOST, "DELETE",
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`);
  await httpRequest(STORAGE_HOST, "DELETE",
    `/emulator/v1/projects/${PROJECT_ID}/buckets/${BUCKET}/objects`).catch(() => null);
}
async function cargarReglas(rulesPath, tipo) {
  const fs = require("fs");
  const path = require("path");
  const contenido = fs.readFileSync(path.join(__dirname, "..", rulesPath), "utf8");
  if (tipo === "firestore") {
    return httpRequest(FIRESTORE_HOST, "PUT",
      `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents:securityRules`,
      { rules: { files: [{ name: "firestore.rules", content: contenido }] } });
  } else {
    return httpRequest(STORAGE_HOST, "PUT",
      `/internal/setRules`,
      { rules: { files: [{ name: "storage.rules", content: contenido }] } });
  }
}

// Setup: escribir docs directo al emulador sin reglas usando el "owner" token
// El emulador acepta el header `Authorization: Bearer owner` como bypass admin
const ADMIN_AUTH = { Authorization: "Bearer owner" };
async function seedFirestore(docPath, data) {
  const body = { fields: docToFields(data) };
  return httpRequest(FIRESTORE_HOST, "PATCH", `${FS_BASE}/${docPath}`, body, ADMIN_AUTH);
}
async function seedStorage(filePath, content = "seed") {
  return httpRequest(STORAGE_HOST, "POST",
    `/v0/b/${BUCKET}/o?name=${encodeURIComponent(filePath)}&uploadType=media`,
    content,
    { ...ADMIN_AUTH, "Content-Type": "application/octet-stream" });
}

// ─── Runner ────────────────────────────────────────────────────────────
const RESULTS = [];
async function caso(rol, user, descripcion, expect, fn) {
  try {
    const res = await fn(user);
    // Consideramos "pass" (permitido) si status es 2xx.
    // Consideramos "fail" (denegado) si status es 401, 403 (Storage) o 400/403 (Firestore).
    const ok2xx = res.status >= 200 && res.status < 300;
    const denied = [401, 403, 404, 400].includes(res.status);
    if (expect === "pass" && ok2xx) {
      RESULTS.push({ rol, caso: descripcion, expect, ok: true });
    } else if (expect === "fail" && !ok2xx && denied) {
      RESULTS.push({ rol, caso: descripcion, expect, ok: true });
    } else {
      const bodyPreview = res.body ? res.body.slice(0, 200) : "";
      RESULTS.push({
        rol, caso: descripcion, expect, ok: false,
        err: `esperaba ${expect}, got status=${res.status} body=${bodyPreview}`,
      });
    }
  } catch (e) {
    RESULTS.push({ rol, caso: descripcion, expect, ok: false, err: e.message });
  }
}

// ─── Main ──────────────────────────────────────────────────────────────
async function correrPruebas() {
  console.log("\nCorriendo suite de reglas CAMPO vía HTTP al emulador…\n");
  console.log(`Firestore: http://${FIRESTORE_HOST}`);
  console.log(`Storage:   http://${STORAGE_HOST}`);
  console.log(`Proyecto:  ${PROJECT_ID}\n`);

  // 1) Las reglas se cargaron automáticamente al iniciar el emulador
  //    (firebase.json declara firestore.rules + storage.rules).
  // 2) Limpiar estado previo
  await limpiarEmuladores();

  // 3) Seed
  await seedFirestore(`obras/${OBRA_A}`, { id: OBRA_A, nombre: "Cangrejera" });
  await seedFirestore(`obras/${OBRA_B}`, { id: OBRA_B, nombre: "Centro Conv" });
  await seedFirestore(`obras/${OBRA_A}/avance/subs`, { data: [] });
  await seedFirestore(`obras/${OBRA_A}/nomina/historial`, { semanas: [] });
  await seedFirestore(`obras/${OBRA_A}/config/estimaciones`, { data: [] });
  await seedFirestore(`obras/${OBRA_A}/config/catalogo`, { conceptos: [] });
  await seedFirestore(`obras/${OBRA_A}/config/otros_gastos`, { items: [] });
  await seedFirestore(`obras/${OBRA_A}/config/info`, { presupuesto: 100 });
  await seedFirestore(`obras/${OBRA_A}/subcontratos/lista`, { items: [] });
  await seedFirestore(`obras/${OBRA_A}/contrato/plazos`, { ampliaciones: [] });
  await seedFirestore(`obras/${OBRA_A}/contrato/documentos`, { lista: [] });
  await seedFirestore(`obras/${OBRA_A}/avance/maquinaria`, { data: [] });
  await seedFirestore(`obras/${OBRA_A}/avance/materiales`, { data: [] });
  await seedFirestore(`global/historial_obras`, { obras: [] });
  await seedFirestore(`global/gp_construct`, { obras: {} });
  await seedFirestore(`global/gp_detalle/obras/gp_${OBRA_A}`, { rubros: [] });
  // Bitácora (pre-cargada para pruebas de lectura por rol)
  await seedFirestore(`obras/${OBRA_A}/bitacora/entrada_seed`, {
    modulo: "avance", descripcion: "seed", fecha: "2026-09-14"
  });
  await seedFirestore(`notificaciones/uid_residente/items/n1`, { titulo: "hola" });
  await seedFirestore(`notificaciones/otro_uid/items/n2`, { titulo: "ajena" });
  await seedFirestore(`usuarios/otro_usuario`, { rol: "residente" });
  // Docs de usuarios con emails de MÚLTIPLES puntos (bug 2026-09-15:
  // emailAId en rules solo reemplazaba primer punto → deny read del propio doc).
  await seedFirestore(`usuarios/lgomez_fosmon_com_mx`, {
    email: "lgomez@fosmon.com.mx", rol: "supervisor", obras_asignadas: ["0126"], activo: true
  });
  await seedFirestore(`usuarios/simple_test_com`, {
    email: "simple@test.com", rol: "residente", obras_asignadas: ["0126"], activo: true
  });
  await seedStorage(`obras/${OBRA_A}/fotos/foto1.jpg`, "binario");
  await seedStorage(`obras/${OBRA_A}/nomina/nom.xlsx`, "excel");
  await seedStorage(`obras/${OBRA_B}/fotos/otra.jpg`, "binario");

  // 4) Usuarios de prueba
  const ANON = null;
  const U = {};
  for (const rol of ["director_general","director_operaciones","gerente_construccion","admin_sistema"]) {
    U[rol] = makeUser(`uid_${rol}`, rol);
  }
  for (const rol of ["superintendente","residente","administrador_obra","supervisor","cliente"]) {
    U[rol] = makeUser(`uid_${rol}`, rol, { obras: [OBRA_A] });
  }
  U.residente_inactivo = makeUser("uid_r_inact", "residente", { obras: [OBRA_A], inactivo: true });
  // uid_residente pre-cargado en notif — usa el U.residente

  // ─── ANÓNIMO ────────────────────────────────────────────────────────
  await caso("anon", ANON, "read obras/A → DENY", "fail", (u) => fsRead(u, `obras/${OBRA_A}`));
  await caso("anon", ANON, "write obras/A/avance/subs → DENY", "fail", (u) => fsWrite(u, `obras/${OBRA_A}/avance/subs`, { data: [] }));
  await caso("anon", ANON, "read global/gp_construct → DENY", "fail", (u) => fsRead(u, `global/gp_construct`));
  await caso("anon", ANON, "storage read foto → DENY", "fail", (u) => stRead(u, `obras/${OBRA_A}/fotos/foto1.jpg`));

  // ─── INACTIVO ───────────────────────────────────────────────────────
  await caso("residente_inactivo", U.residente_inactivo, "read obras/A → DENY", "fail", (u) => fsRead(u, `obras/${OBRA_A}`));
  await caso("residente_inactivo", U.residente_inactivo, "read gp_construct → DENY", "fail", (u) => fsRead(u, `global/gp_construct`));
  await caso("residente_inactivo", U.residente_inactivo, "write avance → DENY", "fail", (u) => fsWrite(u, `obras/${OBRA_A}/avance/subs`, { data: [] }));

  // ─── DIRECTIVOS ─────────────────────────────────────────────────────
  for (const rol of ["director_general","director_operaciones","gerente_construccion","admin_sistema"]) {
    const u = U[rol];
    await caso(rol, u, "read obras/A", "pass", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso(rol, u, "read obras/B (todas=true, ve otras)", "pass", (v) => fsRead(v, `obras/${OBRA_B}`));
    await caso(rol, u, "write obras/A/avance/subs", "pass", (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [{ sec: "1", a: 5 }] }));
    await caso(rol, u, "write obras/A/nomina/historial", "pass", (v) => fsWrite(v, `obras/${OBRA_A}/nomina/historial`, { semanas: [] }));
    await caso(rol, u, "read obras/A/config/otros_gastos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso(rol, u, "read global/gp_construct", "pass", (v) => fsRead(v, `global/gp_construct`));
    await caso(rol, u, "write global/gp_construct → DENY (solo CF)", "fail", (v) => fsWrite(v, `global/gp_construct`, { x: 1 }));
    await caso(rol, u, "read global/historial_obras", "pass", (v) => fsRead(v, `global/historial_obras`));
    await caso(rol, u, "write /obras (crear obra)", "pass", (v) => fsWrite(v, `obras/nueva_${rol}`, { nombre: "nueva" }));
    const puedeUsuarios = ["director_general","director_operaciones","admin_sistema"].includes(rol);
    await caso(rol, u, `read usuarios/otro_usuario ${puedeUsuarios?"":"→ DENY"}`, puedeUsuarios?"pass":"fail",
      (v) => fsRead(v, `usuarios/otro_usuario`));
  }

  // ─── EQUIPO OBRA EDITOR ─────────────────────────────────────────────
  for (const rol of ["superintendente","residente","administrador_obra"]) {
    const u = U[rol];
    await caso(rol, u, "read obras/A (asignada)", "pass", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso(rol, u, "read obras/B (NO asignada) → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_B}`));
    await caso(rol, u, "write obras/A/avance/subs", "pass", (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
    await caso(rol, u, "write obras/B/avance/subs → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_B}/avance/subs`, { data: [] }));
    await caso(rol, u, "write obras/A/nomina/historial", "pass", (v) => fsWrite(v, `obras/${OBRA_A}/nomina/historial`, { semanas: [] }));
    await caso(rol, u, "read obras/A/config/otros_gastos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso(rol, u, "read global/gp_construct", "pass", (v) => fsRead(v, `global/gp_construct`));
    await caso(rol, u, "write /obras (crear) → DENY", "fail", (v) => fsWrite(v, `obras/otra_${rol}`, { nombre: "x" }));
    await caso(rol, u, "read global/historial_obras → DENY", "fail", (v) => fsRead(v, `global/historial_obras`));
    await caso(rol, u, "read usuarios/otro → DENY", "fail", (v) => fsRead(v, `usuarios/otro_usuario`));
  }

  // ─── SUPERVISOR ────────────────────────────────────────────────────
  // Decisión (2026-09-14): supervisor es AUDITOR INTERNO de solo lectura.
  //   · SÍ lee nómina, GP Construct y bitácora
  //   · NO escribe nada en ninguna colección
  {
    const u = U.supervisor;
    await caso("supervisor", u, "read obras/A", "pass", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso("supervisor", u, "read obras/B → DENY (no asignada)", "fail", (v) => fsRead(v, `obras/${OBRA_B}`));
    // Escritura denegada en todos los frentes
    await caso("supervisor", u, "write obras/A/avance/subs → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
    await caso("supervisor", u, "write obras/A/nomina/historial → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/nomina/historial`, { semanas: [] }));
    await caso("supervisor", u, "write obras/A/config/otros_gastos → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/config/otros_gastos`, { items: [] }));
    await caso("supervisor", u, "write obras/A/bitacora → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/bitacora/nueva`, { modulo: "x" }));
    // Lectura permitida en TODO lo interno de la obra asignada
    await caso("supervisor", u, "READ nómina — DECISIÓN 2026-09-14", "pass", (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso("supervisor", u, "READ GP Construct — DECISIÓN 2026-09-14", "pass", (v) => fsRead(v, `global/gp_construct`));
    await caso("supervisor", u, "READ bitácora — DECISIÓN 2026-09-14", "pass", (v) => fsRead(v, `obras/${OBRA_A}/bitacora/entrada_seed`));
    await caso("supervisor", u, "read obras/A/config/otros_gastos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso("supervisor", u, "read obras/A/avance/maquinaria", "pass", (v) => fsRead(v, `obras/${OBRA_A}/avance/maquinaria`));
    await caso("supervisor", u, "read obras/A/subcontratos/lista", "pass", (v) => fsRead(v, `obras/${OBRA_A}/subcontratos/lista`));
    await caso("supervisor", u, "read global/gp_detalle", "pass", (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
  }

  // ─── CLIENTE ───────────────────────────────────────────────────────
  // Decisión (2026-09-14): cliente NO ve GP Construct ni gp_detalle ni bitácora.
  {
    const u = U.cliente;
    // Permitido — su subconjunto reducido
    await caso("cliente", u, "read obras/A", "pass", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso("cliente", u, "read obras/A/avance/subs (% avance)", "pass", (v) => fsRead(v, `obras/${OBRA_A}/avance/subs`));
    await caso("cliente", u, "read obras/A/config/estimaciones", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/estimaciones`));
    await caso("cliente", u, "read obras/A/config/catalogo", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/catalogo`));
    await caso("cliente", u, "read obras/A/contrato/plazos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/contrato/plazos`));
    // Denegado — datos internos
    await caso("cliente", u, "read obras/B → DENY (no asignada)", "fail", (v) => fsRead(v, `obras/${OBRA_B}`));
    await caso("cliente", u, "read obras/A/nomina/historial → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso("cliente", u, "read obras/A/config/otros_gastos → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso("cliente", u, "read obras/A/avance/maquinaria → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/avance/maquinaria`));
    await caso("cliente", u, "read obras/A/avance/materiales → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/avance/materiales`));
    await caso("cliente", u, "read obras/A/subcontratos/lista → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/subcontratos/lista`));
    await caso("cliente", u, "read obras/A/contrato/documentos → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/contrato/documentos`));
    // Escritura siempre denegada
    await caso("cliente", u, "write obras/A/avance/subs → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
    // DECISIONES 2026-09-14 — cliente NO ve estos globales/bitacora
    await caso("cliente", u, "read global/gp_construct → DENY — DECISIÓN 2026-09-14", "fail", (v) => fsRead(v, `global/gp_construct`));
    await caso("cliente", u, "read global/gp_detalle → DENY — DECISIÓN 2026-09-14", "fail", (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
    await caso("cliente", u, "read bitácora → DENY — DECISIÓN 2026-09-14", "fail", (v) => fsRead(v, `obras/${OBRA_A}/bitacora/entrada_seed`));
  }

  // ─── NOTIFICACIONES + AUDITORÍA ────────────────────────────────────
  {
    const res = U.residente;
    const dg  = U.director_general;
    await caso("notif", res, "read notif propia", "pass", (v) => fsRead(v, `notificaciones/uid_residente/items/n1`));
    await caso("notif", res, "read notif ajena → DENY", "fail", (v) => fsRead(v, `notificaciones/otro_uid/items/n2`));
    await caso("notif", res, "update notif propia (leída)", "pass", (v) => fsWrite(v, `notificaciones/uid_residente/items/n1`, { leida: true }));
    await caso("auditoria", res, "create entrada (append)", "pass", (v) => fsWrite(v, `auditoria/nueva1`, { modulo: "avance" }));
    await caso("auditoria", res, "read auditoria (no directivo) → DENY", "fail", (v) => fsRead(v, `auditoria/nueva1`));
    await caso("auditoria", dg,  "read auditoria (directivo)", "pass", (v) => fsRead(v, `auditoria/nueva1`));
    await caso("auditoria", dg,  "update auditoria → DENY", "fail", (v) => fsWrite(v, `auditoria/nueva1`, { m: 1 }));
    await caso("auditoria", dg,  "delete auditoria → DENY", "fail", (v) => fsDelete(v, `auditoria/nueva1`));
  }

  // ─── LOGIN INICIAL: leer propio doc SIN claims (bug 2026-09-15) ────
  // Antes del fix, un usuario recién autenticado (token sin claims aún)
  // no podía leer su propio doc de perfil → caía a fallback vacío.
  // Además, emailAId en rules reemplazaba solo el primer punto, así que
  // emails tipo x@y.com.mx nunca coincidían con su docId real.
  {
    // Token con SOLO email, sin claims (rol/todas/obras) — simula el
    // momento post-autenticación antes de que sincronizarClaims propague.
    const tokenSinClaims = (email) => ({ email, email_verified: true });

    const uNormal = { uid: "uid_simple_no_claims",
      jwt: makeToken("uid_simple_no_claims", tokenSinClaims("simple@test.com")),
      claims: tokenSinClaims("simple@test.com") };
    await caso("login_inicial", uNormal,
      "leer propio doc (email 1 punto) SIN claims — BUG 2026-09-15",
      "pass", (v) => fsRead(v, `usuarios/simple_test_com`));

    const uMultipunto = { uid: "uid_lgomez_no_claims",
      jwt: makeToken("uid_lgomez_no_claims", tokenSinClaims("lgomez@fosmon.com.mx")),
      claims: tokenSinClaims("lgomez@fosmon.com.mx") };
    await caso("login_inicial", uMultipunto,
      "leer propio doc (email 2+ puntos: .com.mx) SIN claims — BUG 2026-09-15",
      "pass", (v) => fsRead(v, `usuarios/lgomez_fosmon_com_mx`));

    // No debe poder leer OTRO doc de usuario aunque sea sin claims
    await caso("login_inicial", uMultipunto,
      "leer doc de otro usuario SIN claims → DENY",
      "fail", (v) => fsRead(v, `usuarios/simple_test_com`));
  }

  // ─── STORAGE ───────────────────────────────────────────────────────
  const res = U.residente, sup = U.supervisor, cli = U.cliente, dg = U.director_general;
  await caso("storage_res", res, "read foto asignada", "pass", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_res", res, "read foto NO asignada → DENY", "fail", (v) => stRead(v, `obras/${OBRA_B}/fotos/otra.jpg`));
  await caso("storage_res", res, "write foto asignada", "pass", (v) => stWrite(v, `obras/${OBRA_A}/fotos/nueva.jpg`));
  await caso("storage_res", res, "write foto NO asignada → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_B}/fotos/nueva.jpg`));

  await caso("storage_sup", sup, "read foto (lectura)", "pass", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_sup", sup, "write foto → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_A}/fotos/nueva.jpg`));

  await caso("storage_cli", cli, "read foto (cliente sí ve fotos)", "pass", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_cli", cli, "read nomina xlsx → DENY", "fail", (v) => stRead(v, `obras/${OBRA_A}/nomina/nom.xlsx`));
  await caso("storage_cli", cli, "write foto → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_A}/fotos/x.jpg`));

  await caso("storage_dg", dg, "read foto cualquier obra", "pass", (v) => stRead(v, `obras/${OBRA_B}/fotos/otra.jpg`));
  await caso("storage_dg", dg, "read nomina xlsx", "pass", (v) => stRead(v, `obras/${OBRA_A}/nomina/nom.xlsx`));
  await caso("storage_dg", dg, "read /otro/* → DENY (fuera de /obras)", "fail", (v) => stRead(v, `otro/algo.jpg`));

  await caso("storage_anon", ANON, "read foto → DENY", "fail", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_anon", ANON, "write foto → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_A}/fotos/x.jpg`));

  // ─── REPORTE ────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(80));
  const pasan  = RESULTS.filter(r => r.ok).length;
  const fallan = RESULTS.filter(r => !r.ok);
  console.log(`RESULTADO: ${pasan}/${RESULTS.length} casos PASS`);
  console.log("═".repeat(80));

  const porRol = {};
  RESULTS.forEach(r => { (porRol[r.rol] = porRol[r.rol] || []).push(r); });
  for (const rol of Object.keys(porRol).sort()) {
    const items = porRol[rol];
    const p = items.filter(x => x.ok).length;
    const marcador = p === items.length ? "✓" : "✗";
    console.log(`\n${marcador} ${rol}  (${p}/${items.length})`);
    for (const r of items) {
      const ic = r.ok ? "  ✓" : "  ✗";
      console.log(`${ic} [${r.expect.padEnd(4)}] ${r.caso}${r.ok ? "" : `\n        error: ${r.err}`}`);
    }
  }

  if (fallan.length > 0) {
    console.log(`\n${fallan.length} caso(s) FAIL`);
    process.exit(1);
  } else {
    console.log("\n✓ Todos los casos pasan.");
    process.exit(0);
  }
}

correrPruebas().catch(e => { console.error("FATAL:", e); process.exit(2); });
