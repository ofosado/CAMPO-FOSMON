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
const OBRA_D = "0501";      // obra de dependencia (municipio)
const ORG_FOSMON = "fosmon";
const ORG_MUNI   = "muni_xalapa";

// Roles que reciben todas=true por default (aplicable a SU organización).
const ROLES_TODAS = new Set([
  // constructora
  "director_general","director_operaciones","gerente_construccion","admin_sistema",
  // dependencia
  "director_obras","subdirector","jefe_supervision","contralor",
]);

// Tipo de organización al que pertenece cada rol
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
function tipoDeRol(rol) {
  if (ROLES_POR_TIPO.constructora.includes(rol)) return "constructora";
  if (ROLES_POR_TIPO.dependencia.includes(rol)) return "dependencia";
  return null;  // 'soporte' es cross-tipo
}
function orgPorDefectoDeRol(rol) {
  const t = tipoDeRol(rol);
  if (t === "constructora") return ORG_FOSMON;
  if (t === "dependencia") return ORG_MUNI;
  return null;
}

// ─── Token JWT firmado (emulador acepta cualquier firma) ─────────────
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
  return `${b64url(header)}.${b64url(payload)}.`;
}

function tokenFor(rol, { obras, todas, email, orgId, tipo, inactivo = false } = {}) {
  const _todas = todas === undefined ? ROLES_TODAS.has(rol) : todas;
  const _tipo = tipo !== undefined ? tipo : tipoDeRol(rol);
  const _org = orgId !== undefined ? orgId : orgPorDefectoDeRol(rol);
  const _obras = obras === undefined
    ? (_todas ? [] : [OBRA_A])
    : obras;
  return {
    email: email || `${rol}@fosmon.com.mx`,
    email_verified: true,
    rol,
    orgId: _org,
    tipo: _tipo,
    todas: _todas,
    obras: _todas ? [] : _obras,
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
async function fsCreate(user, docPath, data) {
  // Create via PATCH con currentDocument.exists=false → falla si ya existe
  const auth = user ? { Authorization: `Bearer ${user.jwt}` } : {};
  const body = { fields: docToFields(data) };
  const url = `${FS_BASE}/${docPath}?currentDocument.exists=false`;
  return httpRequest(FIRESTORE_HOST, "PATCH", url, body, auth);
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
  const res = await httpRequest(STORAGE_HOST, "POST",
    `/v0/b/${BUCKET}/o?name=${encodeURIComponent(filePath)}&uploadType=media`,
    content,
    { ...auth, "Content-Type": "application/octet-stream" });
  return res;
}

// ─── Pre-carga bypaseando reglas ──────────────────────────────────────
async function limpiarEmuladores() {
  await httpRequest(FIRESTORE_HOST, "DELETE",
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`);
  await httpRequest(STORAGE_HOST, "DELETE",
    `/emulator/v1/projects/${PROJECT_ID}/buckets/${BUCKET}/objects`).catch(() => null);
}

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

  await limpiarEmuladores();

  // ─── Seed de organizaciones ────────────────────────────────────────
  await seedFirestore(`orgs/${ORG_FOSMON}`, {
    nombre: "FOSMON Construcciones", tipo: "constructora", activa: true
  });
  await seedFirestore(`orgs/${ORG_MUNI}`, {
    nombre: "Dirección de Obras Xalapa", tipo: "dependencia", activa: true
  });

  // ─── Seed de datos constructora (paths legacy /obras/*) ────────────
  await seedFirestore(`obras/${OBRA_A}`, { id: OBRA_A, nombre: "Cangrejera SIOP" });
  await seedFirestore(`obras/${OBRA_B}`, { id: OBRA_B, nombre: "Centro Convenciones Coatzacoalcos" });
  await seedFirestore(`obras/${OBRA_A}/avance/subs`, { data: [] });
  await seedFirestore(`obras/${OBRA_A}/nomina/historial`, { semanas: [] });
  await seedFirestore(`obras/${OBRA_A}/config/estimaciones`, { data: [] });
  await seedFirestore(`obras/${OBRA_A}/config/catalogo`, { conceptos: [] });
  await seedFirestore(`obras/${OBRA_A}/config/otros_gastos`, { items: [] });
  await seedFirestore(`obras/${OBRA_A}/config/info`, { presupuesto: 100, nombre: "Cangrejera SIOP" });
  await seedFirestore(`obras/${OBRA_A}/subcontratos/lista`, { items: [] });
  await seedFirestore(`obras/${OBRA_A}/contrato/plazos`, { ampliaciones: [] });
  await seedFirestore(`obras/${OBRA_A}/contrato/documentos`, { lista: [] });
  await seedFirestore(`obras/${OBRA_A}/avance/maquinaria`, { data: [] });
  await seedFirestore(`obras/${OBRA_A}/avance/materiales`, { data: [] });
  await seedFirestore(`global/historial_obras`, { obras: [] });
  await seedFirestore(`global/gp_construct`, { obras: {} });
  await seedFirestore(`global/gp_detalle/obras/gp_${OBRA_A}`, { rubros: [] });
  await seedFirestore(`obras/${OBRA_A}/bitacora/entrada_seed`, {
    modulo: "avance", descripcion: "Colada de losa área ampliación", fecha: "2026-09-14"
  });

  // ─── Seed de datos dependencia (paths /orgs/{orgId}/obras/*) ───────
  await seedFirestore(`orgs/${ORG_MUNI}/obras/${OBRA_D}`, {
    id: OBRA_D, nombre: "Pavimentación Av. Ávila Camacho"
  });
  await seedFirestore(`orgs/${ORG_MUNI}/obras/${OBRA_D}/programa/plan_v1`, { fases: [] });
  await seedFirestore(`orgs/${ORG_MUNI}/obras/${OBRA_D}/convenios/conv_01`, { texto: "Convenio marco" });
  await seedFirestore(`orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_seed`, {
    tipo: "foto", fecha: "2026-09-14", nota: "Muestreo de sábado — cadena férrea"
  });
  await seedFirestore(`orgs/${ORG_MUNI}/obras/${OBRA_D}/contratistas/uid_contratista`, {
    razon_social: "Constructora Ñu S.A. de C.V.", rfc: "CNU010101ABC"
  });
  await seedFirestore(`orgs/${ORG_MUNI}/comparativo/anual_2026`, {
    resumen: "Comparativo anual entre contratistas"
  });
  await seedFirestore(`orgs/${ORG_MUNI}/contratistas/uid_contratista`, {
    razon_social: "Constructora Ñu S.A. de C.V."
  });

  // ─── Notificaciones + usuarios ─────────────────────────────────────
  await seedFirestore(`notificaciones/uid_residente/items/n1`, { titulo: "Recordatorio lunes" });
  await seedFirestore(`notificaciones/otro_uid/items/n2`, { titulo: "Ajena" });
  await seedFirestore(`notificaciones/uid_sin_org/items/n_creada`, { titulo: "Notif sin org" });
  await seedFirestore(`usuarios/otro_usuario`, {
    email: "otro@fosmon.com.mx", nombre: "María del Rocío Pérez", rol: "residente", orgId: ORG_FOSMON
  });
  // Docs de usuarios con emails de MÚLTIPLES puntos (bug 2026-09-15)
  await seedFirestore(`usuarios/lgomez_fosmon_com_mx`, {
    email: "lgomez@fosmon.com.mx", nombre: "Lourdes Gómez Vázquez",
    rol: "auditor", orgId: ORG_FOSMON, obras_asignadas: [OBRA_A], activo: true
  });
  await seedFirestore(`usuarios/aoliva_fosmon_com_mx`, {
    email: "aoliva@fosmon.com.mx", nombre: "Alejandro Noé Oliva Somellera",
    rol: "gerente_construccion", orgId: ORG_FOSMON, activo: true
  });

  await seedStorage(`obras/${OBRA_A}/fotos/foto1.jpg`, "binario");
  await seedStorage(`obras/${OBRA_A}/nomina/nom.xlsx`, "excel");
  await seedStorage(`obras/${OBRA_B}/fotos/otra.jpg`, "binario");
  await seedStorage(`orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/foto_dep.jpg`, "binario");

  // ─── Usuarios de prueba ────────────────────────────────────────────
  const ANON = null;
  const U = {};
  // Constructora
  for (const rol of ["director_general","director_operaciones","gerente_construccion","admin_sistema"]) {
    U[rol] = makeUser(`uid_${rol}`, rol);
  }
  for (const rol of ["superintendente","residente","administrador_obra","auditor","cliente"]) {
    U[rol] = makeUser(`uid_${rol}`, rol, { obras: [OBRA_A] });
  }
  U.residente_inactivo = makeUser("uid_r_inact", "residente", { obras: [OBRA_A], inactivo: true });

  // Dependencia
  for (const rol of ["director_obras","subdirector","jefe_supervision","contralor"]) {
    U[rol] = makeUser(`uid_${rol}`, rol);
  }
  for (const rol of ["supervisor_obra","administrativo"]) {
    U[rol] = makeUser(`uid_${rol}`, rol, { obras: [OBRA_D] });
  }
  U.contratista = makeUser("uid_contratista", "contratista", { obras: [OBRA_D] });

  // Cross-tipo
  U.soporte = makeUser("uid_soporte", "soporte", { orgId: null, tipo: null, obras: [] });

  // Estado inconsistente: usuario con rol válido pero SIN orgId/tipo (fallback
  // por si el trigger no corrió o alguien creó perfil sin orgId). Default: DENY.
  U.sin_org = makeUser("uid_sin_org", "residente", {
    orgId: null, tipo: null, obras: [OBRA_A], todas: false,
    email: "sinorg@fosmon.com.mx"
  });

  // ─── ANÓNIMO ────────────────────────────────────────────────────────
  await caso("anon", ANON, "read obras/A → DENY", "fail", (u) => fsRead(u, `obras/${OBRA_A}`));
  await caso("anon", ANON, "write obras/A/avance/subs → DENY", "fail", (u) => fsWrite(u, `obras/${OBRA_A}/avance/subs`, { data: [] }));
  await caso("anon", ANON, "read global/gp_construct → DENY", "fail", (u) => fsRead(u, `global/gp_construct`));
  await caso("anon", ANON, "storage read foto → DENY", "fail", (u) => stRead(u, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("anon", ANON, "read orgs/fosmon → DENY", "fail", (u) => fsRead(u, `orgs/${ORG_FOSMON}`));
  await caso("anon", ANON, "read orgs/muni/obras/D → DENY", "fail", (u) => fsRead(u, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));

  // ─── USUARIO SIN orgId/tipo (default DENY) ─────────────────────────
  // Salvaguarda: si por cualquier razón un usuario queda sin orgId (trigger
  // no corrió, migración incompleta), NO debe poder leer/escribir NINGUNA
  // colección de operación. Solo su propio doc de usuario, sus notifs y
  // append a auditoria (mínimo funcional).
  {
    const u = U.sin_org;
    await caso("sin_org", u, "read obras/A → DENY (tipo=null)", "fail",
      (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso("sin_org", u, "write obras/A/avance → DENY", "fail",
      (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
    await caso("sin_org", u, "read nómina → DENY", "fail",
      (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso("sin_org", u, "read otros_gastos → DENY", "fail",
      (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso("sin_org", u, "read gp_construct → DENY", "fail",
      (v) => fsRead(v, `global/gp_construct`));
    await caso("sin_org", u, "read gp_detalle → DENY", "fail",
      (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
    await caso("sin_org", u, "read /orgs/muni/obras/D → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    await caso("sin_org", u, "read orgs/fosmon → DENY (no soporte, sin orgId)", "fail",
      (v) => fsRead(v, `orgs/${ORG_FOSMON}`));
    await caso("sin_org", u, "storage read foto → DENY", "fail",
      (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
    await caso("sin_org", u, "storage read evidencia muni → DENY", "fail",
      (v) => stRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/foto_dep.jpg`));
    // Sí puede leer/escribir sus notifs (no depende de tipo)
    await caso("sin_org", u, "read notif propia (esAuth ok)", "pass",
      (v) => fsRead(v, `notificaciones/uid_sin_org/items/n_creada`));  // 404 aceptable (denied), pero read ok si existe
    // Sí puede append a auditoria (para trazabilidad de estado inválido)
    await caso("sin_org", u, "create auditoria (append)", "pass",
      (v) => fsCreate(v, `auditoria/sin_org_${Date.now()}`, { actor: "uid_sin_org", accion: "test" }));
  }

  // ─── INACTIVO ───────────────────────────────────────────────────────
  await caso("residente_inactivo", U.residente_inactivo, "read obras/A → DENY", "fail", (u) => fsRead(u, `obras/${OBRA_A}`));
  await caso("residente_inactivo", U.residente_inactivo, "read gp_construct → DENY", "fail", (u) => fsRead(u, `global/gp_construct`));
  await caso("residente_inactivo", U.residente_inactivo, "write avance → DENY", "fail", (u) => fsWrite(u, `obras/${OBRA_A}/avance/subs`, { data: [] }));

  // ─── DIRECTIVOS CONSTRUCTORA ────────────────────────────────────────
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
    await caso(rol, u, "write /obras (crear obra)", "pass", (v) => fsWrite(v, `obras/nueva_${rol}`, { nombre: "Ampliación de nave" }));
    await caso(rol, u, "read orgs/fosmon (propia)", "pass", (v) => fsRead(v, `orgs/${ORG_FOSMON}`));
    await caso(rol, u, "read orgs/muni → DENY (otra org)", "fail", (v) => fsRead(v, `orgs/${ORG_MUNI}`));
    await caso(rol, u, "read /orgs/muni/obras/D → DENY (cross-tipo)", "fail", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    const puedeUsuarios = ["director_general","director_operaciones","admin_sistema"].includes(rol);
    await caso(rol, u, `read usuarios/otro ${puedeUsuarios?"":"→ DENY"}`, puedeUsuarios?"pass":"fail",
      (v) => fsRead(v, `usuarios/otro_usuario`));
  }

  // ─── EQUIPO OBRA EDITOR CONSTRUCTORA ────────────────────────────────
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
    await caso(rol, u, "read /orgs/muni/obras/D → DENY (dependencia)", "fail", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
  }

  // ─── AUDITOR (antes SUPERVISOR) — solo lectura ─────────────────────
  {
    const u = U.auditor;
    await caso("auditor", u, "read obras/A", "pass", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso("auditor", u, "read obras/B → DENY (no asignada)", "fail", (v) => fsRead(v, `obras/${OBRA_B}`));
    await caso("auditor", u, "write avance/subs → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
    await caso("auditor", u, "write nómina → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/nomina/historial`, { semanas: [] }));
    await caso("auditor", u, "write otros_gastos → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/config/otros_gastos`, { items: [] }));
    await caso("auditor", u, "write bitácora → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/bitacora/nueva`, { modulo: "x" }));
    await caso("auditor", u, "READ nómina", "pass", (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso("auditor", u, "READ GP Construct", "pass", (v) => fsRead(v, `global/gp_construct`));
    await caso("auditor", u, "READ bitácora", "pass", (v) => fsRead(v, `obras/${OBRA_A}/bitacora/entrada_seed`));
    await caso("auditor", u, "read otros_gastos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso("auditor", u, "read maquinaria", "pass", (v) => fsRead(v, `obras/${OBRA_A}/avance/maquinaria`));
    await caso("auditor", u, "read subcontratos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/subcontratos/lista`));
    await caso("auditor", u, "read gp_detalle", "pass", (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
    await caso("auditor", u, "read /orgs/muni → DENY", "fail", (v) => fsRead(v, `orgs/${ORG_MUNI}`));
  }

  // ─── CLIENTE CONSTRUCTORA ──────────────────────────────────────────
  {
    const u = U.cliente;
    await caso("cliente", u, "read obras/A", "pass", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso("cliente", u, "read obras/A/avance/subs", "pass", (v) => fsRead(v, `obras/${OBRA_A}/avance/subs`));
    await caso("cliente", u, "read obras/A/config/estimaciones", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/estimaciones`));
    await caso("cliente", u, "read obras/A/config/catalogo", "pass", (v) => fsRead(v, `obras/${OBRA_A}/config/catalogo`));
    await caso("cliente", u, "read obras/A/contrato/plazos", "pass", (v) => fsRead(v, `obras/${OBRA_A}/contrato/plazos`));
    await caso("cliente", u, "read obras/B → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_B}`));
    await caso("cliente", u, "read nómina → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso("cliente", u, "read otros_gastos → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso("cliente", u, "read maquinaria → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/avance/maquinaria`));
    await caso("cliente", u, "read materiales → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/avance/materiales`));
    await caso("cliente", u, "read subcontratos → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/subcontratos/lista`));
    await caso("cliente", u, "read contrato/documentos → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/contrato/documentos`));
    await caso("cliente", u, "write avance/subs → DENY", "fail", (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
    await caso("cliente", u, "read global/gp_construct → DENY", "fail", (v) => fsRead(v, `global/gp_construct`));
    await caso("cliente", u, "read gp_detalle → DENY", "fail", (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
    await caso("cliente", u, "read bitácora → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/bitacora/entrada_seed`));
  }

  // ─── ORGS — tipo INMUTABLE ─────────────────────────────────────────
  {
    const dg = U.director_general;
    // Read propia OK
    await caso("orgs", dg, "read propia orgs/fosmon", "pass", (v) => fsRead(v, `orgs/${ORG_FOSMON}`));
    // Update sin cambiar tipo → PASS
    await caso("orgs", dg, "update nombre org (tipo constante)", "pass",
      (v) => fsWrite(v, `orgs/${ORG_FOSMON}`, {
        nombre: "FOSMON Construcciones (v2)", tipo: "constructora", activa: true
      }));
    // Update cambiando tipo → DENY
    await caso("orgs", dg, "update cambiando tipo → DENY", "fail",
      (v) => fsWrite(v, `orgs/${ORG_FOSMON}`, {
        nombre: "FOSMON Construcciones (v2)", tipo: "dependencia", activa: true
      }));
    // Delete → DENY (siempre)
    await caso("orgs", dg, "delete org → DENY", "fail", (v) => fsDelete(v, `orgs/${ORG_FOSMON}`));
  }

  // ─── SOPORTE (cross-tipo) ──────────────────────────────────────────
  {
    const s = U.soporte;
    // Puede leer cualquier org (necesita listar para gestionar)
    await caso("soporte", s, "read orgs/fosmon", "pass", (v) => fsRead(v, `orgs/${ORG_FOSMON}`));
    await caso("soporte", s, "read orgs/muni", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}`));
    // Puede crear orgs nuevas
    await caso("soporte", s, "create orgs/nueva", "pass",
      (v) => fsCreate(v, `orgs/nueva_ep_${Date.now()}`, {
        nombre: "Empresa Nueva", tipo: "constructora", activa: true
      }));
    // Puede crear/actualizar usuarios (para bootstrap)
    await caso("soporte", s, "create usuarios/nuevo", "pass",
      (v) => fsCreate(v, `usuarios/nuevo_soporte_${Date.now()}`, {
        email: "nuevo@fosmon.com.mx", nombre: "Nuevo Usuario",
        rol: "residente", orgId: ORG_FOSMON, activo: true
      }));
    // NO puede leer operación (avances/montos/evidencia)
    await caso("soporte", s, "read obras/A → DENY (operación)", "fail", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso("soporte", s, "read avance → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/avance/subs`));
    await caso("soporte", s, "read nómina → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso("soporte", s, "read otros_gastos → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
    await caso("soporte", s, "read gp_construct → DENY", "fail", (v) => fsRead(v, `global/gp_construct`));
    await caso("soporte", s, "read gp_detalle → DENY", "fail", (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
    await caso("soporte", s, "read bitácora → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/bitacora/entrada_seed`));
    await caso("soporte", s, "read /orgs/muni/obras/D/evidencia → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_seed`));
    await caso("soporte", s, "read /orgs/muni/comparativo → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/comparativo/anual_2026`));
    // Storage
    await caso("soporte", s, "storage read foto → DENY", "fail", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
    await caso("soporte", s, "storage read evidencia → DENY", "fail",
      (v) => stRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/foto_dep.jpg`));
    // Puede crear entrada de auditoria
    await caso("soporte", s, "create auditoria (append registrado)", "pass",
      (v) => fsCreate(v, `auditoria/soporte_${Date.now()}`, {
        actor: "uid_soporte", accion: "create org", ts: 1
      }));
  }

  // ─── DEPENDENCIA — DIRECTIVOS ──────────────────────────────────────
  for (const rol of ["director_obras","subdirector","jefe_supervision"]) {
    const u = U[rol];
    await caso(rol, u, "read /orgs/muni", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}`));
    await caso(rol, u, "read /orgs/muni/obras/D", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    await caso(rol, u, "read /orgs/muni/obras/D/programa", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/programa/plan_v1`));
    await caso(rol, u, "read /orgs/muni/obras/D/evidencia", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_seed`));
    await caso(rol, u, "read /obras/A (constructora) → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}`));
    await caso(rol, u, "read /obras/A/nomina → DENY", "fail", (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
    await caso(rol, u, "read global/gp_construct → DENY (constructora)", "fail", (v) => fsRead(v, `global/gp_construct`));
    // Comparativo solo para director_obras y subdirector
    const puedeComp = rol === "director_obras" || rol === "subdirector";
    await caso(rol, u, `read comparativo ${puedeComp?"":"→ DENY"}`, puedeComp ? "pass" : "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/comparativo/anual_2026`));
  }

  // ─── DEPENDENCIA — CONTRALOR ───────────────────────────────────────
  {
    const u = U.contralor;
    await caso("contralor", u, "read /orgs/muni/obras/D", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    await caso("contralor", u, "read evidencia", "pass", (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_seed`));
    await caso("contralor", u, "read /orgs/muni/contratistas padrón", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/contratistas/uid_contratista`));
    // NO puede escribir
    await caso("contralor", u, "write programa → DENY", "fail",
      (v) => fsWrite(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/programa/nuevo`, { fases: [] }));
    // NO puede ver comparativo
    await caso("contralor", u, "read comparativo → DENY (no autorizado)", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/comparativo/anual_2026`));
  }

  // ─── DEPENDENCIA — SUPERVISOR_OBRA ─────────────────────────────────
  {
    const u = U.supervisor_obra;
    await caso("supervisor_obra", u, "read obra asignada", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    await caso("supervisor_obra", u, "read evidencia", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_seed`));
    // Captura evidencia (create)
    await caso("supervisor_obra", u, "CREATE evidencia (captura, no solo lectura)", "pass",
      (v) => fsCreate(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_nueva_${Date.now()}`, {
        tipo: "foto", nota: "Colocación de armado"
      }));
    // Ve el contratista asignado a su obra
    await caso("supervisor_obra", u, "read contratista de su obra", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/contratistas/uid_contratista`));
    // NO ve padrón completo de contratistas
    await caso("supervisor_obra", u, "read /orgs/muni/contratistas padrón → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/contratistas/uid_contratista`));
    // NO ve comparativo
    await caso("supervisor_obra", u, "read comparativo → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/comparativo/anual_2026`));
    // NO ve /obras (constructora)
    await caso("supervisor_obra", u, "read /obras/A → DENY (constructora)", "fail",
      (v) => fsRead(v, `obras/${OBRA_A}`));
  }

  // ─── DEPENDENCIA — CONTRATISTA ─────────────────────────────────────
  {
    const u = U.contratista;
    // Ve su propia obra
    await caso("contratista", u, "read obra asignada", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    // Ve su propio doc de contratista (cid == request.auth.uid)
    await caso("contratista", u, "read propio doc contratista", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/contratistas/uid_contratista`));
    // NO ve convenios (según decisión)
    await caso("contratista", u, "read convenios → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/convenios/conv_01`));
    // NO ve comparativo
    await caso("contratista", u, "read comparativo → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/comparativo/anual_2026`));
    // NO ve datos de otros contratistas del padrón general
    await caso("contratista", u, "read padrón general contratistas → DENY", "fail",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/contratistas/otro_id_x`));
    // NO ve /obras (constructora)
    await caso("contratista", u, "read /obras/A → DENY (constructora)", "fail",
      (v) => fsRead(v, `obras/${OBRA_A}`));
    // NO puede escribir
    await caso("contratista", u, "write programa → DENY", "fail",
      (v) => fsWrite(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/programa/nuevo`, { fases: [] }));
  }

  // ─── DEPENDENCIA — ADMINISTRATIVO ──────────────────────────────────
  {
    const u = U.administrativo;
    await caso("administrativo", u, "read obra asignada", "pass",
      (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
    await caso("administrativo", u, "write convenios", "pass",
      (v) => fsWrite(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/convenios/nuevo`, { texto: "Adenda" }));
    await caso("administrativo", u, "read /obras/A → DENY", "fail",
      (v) => fsRead(v, `obras/${OBRA_A}`));
  }

  // ═══════════════════════════════════════════════════════════════════
  // AISLAMIENTO ENTRE ORGANIZACIONES — explícito (2026-09)
  // Un usuario de muni_xalapa NUNCA debe leer obras/nomina/gastos/evidencia
  // de fosmon. Al revés tampoco. Cubre operativos y ejecutivos de ambos lados.
  // ═══════════════════════════════════════════════════════════════════
  {
    // De dependencia (muni_xalapa) → constructora (fosmon): DENY todo
    const rolesDep = ["director_obras","subdirector","jefe_supervision",
                       "contralor","supervisor_obra","administrativo","contratista"];
    for (const r of rolesDep) {
      const u = U[r];
      const et = `aislamiento_muni→fosmon`;
      await caso(et, u, `${r}: read obras/A (constructora) → DENY`, "fail",
        (v) => fsRead(v, `obras/${OBRA_A}`));
      await caso(et, u, `${r}: read nómina fosmon → DENY`, "fail",
        (v) => fsRead(v, `obras/${OBRA_A}/nomina/historial`));
      await caso(et, u, `${r}: read otros_gastos fosmon → DENY`, "fail",
        (v) => fsRead(v, `obras/${OBRA_A}/config/otros_gastos`));
      await caso(et, u, `${r}: read maquinaria fosmon → DENY`, "fail",
        (v) => fsRead(v, `obras/${OBRA_A}/avance/maquinaria`));
      await caso(et, u, `${r}: read subcontratos fosmon → DENY`, "fail",
        (v) => fsRead(v, `obras/${OBRA_A}/subcontratos/lista`));
      await caso(et, u, `${r}: read bitácora fosmon → DENY`, "fail",
        (v) => fsRead(v, `obras/${OBRA_A}/bitacora/entrada_seed`));
      await caso(et, u, `${r}: read global/gp_construct → DENY`, "fail",
        (v) => fsRead(v, `global/gp_construct`));
      await caso(et, u, `${r}: read gp_detalle → DENY`, "fail",
        (v) => fsRead(v, `global/gp_detalle/obras/gp_${OBRA_A}`));
      await caso(et, u, `${r}: read orgs/fosmon → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_FOSMON}`));
      await caso(et, u, `${r}: write obras/A/avance → DENY`, "fail",
        (v) => fsWrite(v, `obras/${OBRA_A}/avance/subs`, { data: [] }));
      await caso(et, u, `${r}: storage read foto fosmon → DENY`, "fail",
        (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
      await caso(et, u, `${r}: storage read nomina fosmon → DENY`, "fail",
        (v) => stRead(v, `obras/${OBRA_A}/nomina/nom.xlsx`));
    }

    // De constructora (fosmon) → dependencia (muni_xalapa): DENY todo
    const rolesConstr = ["director_general","director_operaciones","gerente_construccion",
                         "admin_sistema","superintendente","residente","administrador_obra",
                         "auditor","cliente"];
    for (const r of rolesConstr) {
      const u = U[r];
      const et = `aislamiento_fosmon→muni`;
      await caso(et, u, `${r}: read orgs/muni → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_MUNI}`));
      await caso(et, u, `${r}: read /orgs/muni/obras/D → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}`));
      await caso(et, u, `${r}: read evidencia muni → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/ev_seed`));
      await caso(et, u, `${r}: read convenios muni → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/convenios/conv_01`));
      await caso(et, u, `${r}: read programa muni → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/programa/plan_v1`));
      await caso(et, u, `${r}: read comparativo muni → DENY`, "fail",
        (v) => fsRead(v, `orgs/${ORG_MUNI}/comparativo/anual_2026`));
      await caso(et, u, `${r}: write evidencia muni → DENY`, "fail",
        (v) => fsWrite(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/nueva_${r}`, { tipo: "foto" }));
      await caso(et, u, `${r}: storage read evidencia muni → DENY`, "fail",
        (v) => stRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/foto_dep.jpg`));
    }
  }

  // ─── NOTIFICACIONES + AUDITORÍA ────────────────────────────────────
  {
    const res = U.residente;
    const dg  = U.director_general;
    const doc_obras = U.director_obras;
    await caso("notif", res, "read notif propia", "pass", (v) => fsRead(v, `notificaciones/uid_residente/items/n1`));
    await caso("notif", res, "read notif ajena → DENY", "fail", (v) => fsRead(v, `notificaciones/otro_uid/items/n2`));
    await caso("notif", res, "update notif propia (leída)", "pass", (v) => fsWrite(v, `notificaciones/uid_residente/items/n1`, { leida: true }));
    await caso("auditoria", res, "create entrada (append)", "pass", (v) => fsWrite(v, `auditoria/nueva1`, { modulo: "avance" }));
    await caso("auditoria", res, "read auditoria (no directivo) → DENY", "fail", (v) => fsRead(v, `auditoria/nueva1`));
    await caso("auditoria", dg,  "read auditoria (directivo C)", "pass", (v) => fsRead(v, `auditoria/nueva1`));
    await caso("auditoria", doc_obras, "read auditoria (directivo D)", "pass", (v) => fsRead(v, `auditoria/nueva1`));
    await caso("auditoria", dg,  "update auditoria → DENY", "fail", (v) => fsWrite(v, `auditoria/nueva1`, { m: 1 }));
    await caso("auditoria", dg,  "delete auditoria → DENY", "fail", (v) => fsDelete(v, `auditoria/nueva1`));
  }

  // ─── LOGIN INICIAL: leer propio doc SIN claims (bug 2026-09-15) ────
  {
    const tokenSinClaims = (email) => ({ email, email_verified: true });

    const uMultipunto = { uid: "uid_lgomez_no_claims",
      jwt: makeToken("uid_lgomez_no_claims", tokenSinClaims("lgomez@fosmon.com.mx")),
      claims: tokenSinClaims("lgomez@fosmon.com.mx") };
    await caso("login_inicial", uMultipunto,
      "leer propio doc (email 2+ puntos: .com.mx) SIN claims — BUG 2026-09-15",
      "pass", (v) => fsRead(v, `usuarios/lgomez_fosmon_com_mx`));

    const uAoliva = { uid: "uid_aoliva_no_claims",
      jwt: makeToken("uid_aoliva_no_claims", tokenSinClaims("aoliva@fosmon.com.mx")),
      claims: tokenSinClaims("aoliva@fosmon.com.mx") };
    await caso("login_inicial", uAoliva,
      "leer propio doc @fosmon.com.mx SIN claims",
      "pass", (v) => fsRead(v, `usuarios/aoliva_fosmon_com_mx`));

    // No debe poder leer OTRO doc de usuario aunque sea sin claims
    await caso("login_inicial", uMultipunto,
      "leer doc de otro usuario SIN claims → DENY",
      "fail", (v) => fsRead(v, `usuarios/aoliva_fosmon_com_mx`));
  }

  // ─── STORAGE ───────────────────────────────────────────────────────
  const res = U.residente, aud = U.auditor, cli = U.cliente, dg = U.director_general;
  await caso("storage_res", res, "read foto asignada", "pass", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_res", res, "read foto NO asignada → DENY", "fail", (v) => stRead(v, `obras/${OBRA_B}/fotos/otra.jpg`));
  await caso("storage_res", res, "write foto asignada", "pass", (v) => stWrite(v, `obras/${OBRA_A}/fotos/nueva.jpg`));
  await caso("storage_res", res, "write foto NO asignada → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_B}/fotos/nueva.jpg`));

  await caso("storage_aud", aud, "read foto (lectura)", "pass", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_aud", aud, "write foto → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_A}/fotos/nueva.jpg`));

  await caso("storage_cli", cli, "read foto (cliente sí ve fotos)", "pass", (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));
  await caso("storage_cli", cli, "read nomina xlsx → DENY", "fail", (v) => stRead(v, `obras/${OBRA_A}/nomina/nom.xlsx`));
  await caso("storage_cli", cli, "write foto → DENY", "fail", (v) => stWrite(v, `obras/${OBRA_A}/fotos/x.jpg`));

  await caso("storage_dg", dg, "read foto cualquier obra", "pass", (v) => stRead(v, `obras/${OBRA_B}/fotos/otra.jpg`));
  await caso("storage_dg", dg, "read nomina xlsx", "pass", (v) => stRead(v, `obras/${OBRA_A}/nomina/nom.xlsx`));
  await caso("storage_dg", dg, "read /otro/* → DENY (fuera de /obras)", "fail", (v) => stRead(v, `otro/algo.jpg`));
  await caso("storage_dg", dg, "read evidencia dependencia → DENY", "fail",
    (v) => stRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/foto_dep.jpg`));

  // Storage dependencia
  const so = U.supervisor_obra;
  await caso("storage_so", so, "read evidencia dependencia asignada", "pass",
    (v) => stRead(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/foto_dep.jpg`));
  await caso("storage_so", so, "write evidencia asignada", "pass",
    (v) => stWrite(v, `orgs/${ORG_MUNI}/obras/${OBRA_D}/evidencia/nueva.jpg`));
  await caso("storage_so", so, "read /obras/A foto (constructora) → DENY", "fail",
    (v) => stRead(v, `obras/${OBRA_A}/fotos/foto1.jpg`));

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
