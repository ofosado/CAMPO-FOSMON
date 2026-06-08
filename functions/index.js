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
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// Secret de Resend para mandar correos transaccionales (resumen semanal, etc.)
// Se carga en Cloud Functions con:  firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const ROLES_VALIDOS = [
  "director_general",
  "director_operaciones",
  "gerente_construccion",
  "superintendente",
  "residente",
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
  const perfilRef = admin.firestore().doc(`usuarios/${emailAId(emailNorm)}`);

  let userRecord;
  let reparado = false;
  try {
    userRecord = await admin.auth().createUser({
      email: emailNorm,
      password,
      displayName: nombre,
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      // El usuario ya existe en Auth. Verificar si también tiene perfil en Firestore.
      // Si NO, es un caso huérfano (migración previa, perfil borrado, etc.) y lo reparamos.
      // Si SÍ, es un duplicado real y rechazamos.
      const perfilSnap = await perfilRef.get();
      if (perfilSnap.exists) {
        throw new HttpsError(
          "already-exists",
          "Ya existe un usuario con ese correo. Para editarlo, búscalo en la lista de usuarios."
        );
      }
      // Huérfano: reusar el registro de Auth, actualizando password y displayName
      const existing = await admin.auth().getUserByEmail(emailNorm);
      await admin.auth().updateUser(existing.uid, { password, displayName: nombre, disabled: false });
      userRecord = existing;
      reparado = true;
    } else {
      throw new HttpsError("internal", `Error al crear en Auth: ${e.message}`);
    }
  }

  await perfilRef.set({
    email: emailNorm,
    nombre,
    rol,
    obras_asignadas: Array.isArray(obras_asignadas) ? obras_asignadas : [],
    activo: true,
    uid: userRecord.uid,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    creadoPor: request.auth.token.email || "",
    ...(reparado ? { reparadoDeAuth: true } : {}),
  });

  return { ok: true, uid: userRecord.uid, email: emailNorm, reparado };
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

// ════════════════════════════════════════════════════════════════════════════
// GP CONSTRUCT — descarga + parseo server-side (sin problemas de CORS)
// ════════════════════════════════════════════════════════════════════════════

const GP_SHEET_ID = "1UaRI7ysMttXvET9I6hXPJAqadUYRd0Y0Qiwy8uRi82c";
const GP_SHEET_CSV = `https://docs.google.com/spreadsheets/d/${GP_SHEET_ID}/export?format=csv`;
const PARSER_VERSION = 3;

// ── Parser CSV robusto (maneja comillas con comas dentro) ──
function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseMonto(s) {
  if (!s) return NaN;
  const limpio = String(s).replace(/[$\s,()]/g, '');
  if (!limpio || limpio === '-') return NaN;
  const n = parseFloat(limpio);
  return isNaN(n) ? NaN : n;
}

// Parser de GP Construct v3 — robusto a estructura con AÑOS DESPLEGADOS
//
// El Sheet tiene jerarquía: Año → Mes → Semanas (cada uno con su Total).
// Estructura típica de columnas:
//   [0] vacía
//   [1] Row Labels (nombres de obras/rubros/proveedores)
//   [2..N] 2024 desplegado: Enero, Total Enero, Febrero, Total Febrero, ..., Total 2024
//   [N+1..M] 2025 desplegado: igual estructura
//   [M+1..K] 2026 desplegado: igual
//   [K+1] Total general (Grand Total)
//   [K+2] %
//
// Cada año tiene sus semanas (14, 15...) que se REPITEN por año. Para el acumulado real
// SIEMPRE usamos "Total general"; las columnas individuales son para análisis temporal.
function parsearGPConstruct(csvText) {
  const lines = csvText.split('\n').map(parseCsvLine);
  const MESES = {
    'enero':'01','febrero':'02','marzo':'03','abril':'04','mayo':'05','junio':'06',
    'julio':'07','agosto':'08','septiembre':'09','octubre':'10','noviembre':'11','diciembre':'12'
  };
  // Normalizador para detectar palabras especiales
  const normalize = (s) => (s||'').toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,'').trim();

  // ── PASO 1: detectar columnas especiales en filas de header (filas 0-10) ──
  // colMap guarda las posiciones de columnas críticas:
  //  - grand_total: índice de "Total general" / "Grand Total"
  //  - total_year_2024, total_year_2025, total_year_2026: totales anuales
  //  - total_month_2026_05, etc: totales mensuales (solo del año actual usualmente)
  //  - week_2026_22: semanas individuales del año actual (para tendencia)
  //  - pct: columna de %
  const colMap = {};
  // Necesitamos "estado" mientras escaneamos headers para asociar mes a su año actual
  // Por simplicidad: las semanas/meses individuales se asocian al año más reciente que vimos
  // a la izquierda en la misma fila

  const maxScan = Math.min(lines.length, 12);

  // Primero pase: identificar fila de años (la que tiene "2024", "2025", "2026" como texto puro)
  let yearRow = -1;
  let yearCols = {}; // {año: colIndex}
  for (let i = 0; i < maxScan; i++) {
    const matches = lines[i].map((c, ci) => /^20\d{2}$/.test((c||'').trim()) ? ci : -1).filter(x => x >= 0);
    if (matches.length >= 1) {
      yearRow = i;
      matches.forEach(ci => { yearCols[lines[i][ci].trim()] = ci; });
      break;
    }
  }

  // Segundo pase: identificar fila de meses (con nombres como "1 .- Enero", "2 .- Febrero")
  let monthRow = -1;
  for (let i = 0; i < maxScan; i++) {
    const tieneMeses = lines[i].some(c => {
      const m = (c||'').toLowerCase();
      return /enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/.test(m);
    });
    if (tieneMeses) { monthRow = i; break; }
  }

  // Tercer pase: identificar fila de semanas (números 1-53)
  let weekRow = -1;
  for (let i = 0; i < maxScan; i++) {
    const numCount = lines[i].filter(c => /^[1-5]?[0-9]$/.test((c||'').trim())).length;
    if (numCount >= 5) { weekRow = i; break; }
  }

  // Determinar Grand Total y Total de cada año (buscar en cualquier fila de header)
  // Texto típico: "Total general", "Grand Total", "Total 2024", "Total 2025", "Total 2026"
  for (let i = 0; i < maxScan; i++) {
    lines[i].forEach((cellRaw, ci) => {
      const c = (cellRaw || '').trim();
      if (!c) return;
      const n = normalize(c);
      // Grand Total / Total general (acumulado de todos los años)
      if ((n === 'total general' || n === 'grand total' || /^grand\s*total$/i.test(c))
          && colMap.grand_total === undefined) {
        colMap.grand_total = ci;
      }
      // Total anual: "Total 2024", "Total 2025", "Total 2026", "2024 Total"
      const matchTotalAño = c.match(/total\s*(20\d{2})|^(20\d{2})\s*total$/i);
      if (matchTotalAño) {
        const año = matchTotalAño[1] || matchTotalAño[2];
        const key = `total_year_${año}`;
        if (colMap[key] === undefined) colMap[key] = ci;
      }
      // Total mensual: "Total 1 .- Enero", "Total Enero"
      const matchTotalMes = c.match(/total\s+(?:\d+\s*[.\-]+\s*)?([a-záéíóú]+)/i);
      if (matchTotalMes) {
        const mesNombre = normalize(matchTotalMes[1]);
        if (MESES[mesNombre]) {
          // Asignamos al año más reciente disponible (2026 por defecto)
          // (mejorable: trackear año del contexto)
          const key = `total_month_2026_${MESES[mesNombre]}`;
          if (colMap[key] === undefined) colMap[key] = ci;
        }
      }
      // %
      if (c === '%' && colMap.pct === undefined) colMap.pct = ci;
    });
  }

  // Construir mapa de semanas del AÑO ACTUAL (2026)
  // Las semanas se repiten por año, así que solo nos quedamos con las de la última instancia
  // (asumiendo que el orden de columnas es 2024 → 2025 → 2026)
  const weekColsByYear = {}; // {año: {semana: ci}}
  if (weekRow >= 0) {
    // Vamos a mapear semanas asociándolas al año contextual basado en la columna
    // Para eso, recorremos el row de semanas y vamos contando en qué bloque de año estamos
    const orderedYears = Object.entries(yearCols).sort((a,b) => a[1] - b[1]); // [['2024', 2], ['2025', 35], ['2026', 70]]
    let añoActual = null;
    let cur = 0;
    for (let ci = 0; ci < lines[weekRow].length; ci++) {
      // Avanzar año si pasamos su columna
      while (cur < orderedYears.length && ci >= orderedYears[cur][1]) {
        añoActual = orderedYears[cur][0];
        cur++;
      }
      const cell = (lines[weekRow][ci] || '').trim();
      if (/^[1-5]?[0-9]$/.test(cell) && añoActual) {
        const n = parseInt(cell);
        if (n >= 1 && n <= 53) {
          if (!weekColsByYear[añoActual]) weekColsByYear[añoActual] = {};
          weekColsByYear[añoActual][n] = ci;
        }
      }
    }
  }
  // Tomar las semanas del año más reciente como las "semanas disponibles" del Sheet
  const añoMasReciente = Object.keys(weekColsByYear).sort().pop() || '2026';
  const weekColsActual = weekColsByYear[añoMasReciente] || {};
  Object.entries(weekColsActual).forEach(([n, ci]) => {
    colMap[`week_${añoMasReciente}_${n}`] = ci;
  });

  // Asociar columnas de años individuales (sin desplegar) si existen
  Object.entries(yearCols).forEach(([año, ci]) => {
    colMap[`year_${año}`] = ci;
  });

  // Determinar fila donde empiezan los datos (justo después del último header)
  const ultimoHeaderRow = Math.max(yearRow, monthRow, weekRow);
  const dataStart = ultimoHeaderRow >= 0 ? ultimoHeaderRow + 1 : 8;

  // ── PASO 2: parsear filas de datos ──
  const obras = {};
  let curObra = null, curRubro = null;

  for (let i = dataStart; i < lines.length; i++) {
    const row = lines[i];
    const label = (row[1] || '').trim();
    if (!label) continue;
    // Saltar totales y secciones
    if (/^(grand\s*total|total\s+general)$/i.test(label)) continue;
    if (/^total/i.test(label)) continue;
    if (/^\d\s+(EGRESOS|INGRESOS)/i.test(label)) continue;

    const extraerValores = () => {
      // Grand Total: la suma de TODO. Es nuestro acumulado real.
      let grandTotal = parseMonto(row[colMap.grand_total]) || 0;
      grandTotal = Math.abs(grandTotal);

      // Totales por año
      const años = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('total_year_')).forEach(([k, ci]) => {
        const año = k.replace('total_year_', '');
        const v = parseMonto(row[ci]);
        if (!isNaN(v) && v !== 0) años[`Y${año}`] = Math.abs(v);
      });

      // Totales por mes (del año actual)
      const meses = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('total_month_')).forEach(([k, ci]) => {
        // k = total_month_2026_05
        const mesKey = k.replace('total_month_', '').replace('_', '-'); // 2026-05
        const v = parseMonto(row[ci]);
        if (!isNaN(v) && v !== 0) meses[`M${mesKey}`] = Math.abs(v);
      });

      // Semanas (del año actual)
      const semanas = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('week_')).forEach(([k, ci]) => {
        const partes = k.split('_'); // ['week', '2026', '22']
        const v = parseMonto(row[ci]);
        if (!isNaN(v) && v !== 0) semanas[`S${partes[2]}`] = Math.abs(v);
      });

      // total2026 = el más reciente total anual
      const total2026 = años['Y2026'] || meses['M2026-' + (Object.keys(meses).map(k=>k.slice(-2)).sort().pop()||'01')] || 0;

      return { semanas, meses, años, total2026, grandTotal };
    };

    if (/^\d{4}\s/.test(label)) {
      // OBRA: empieza con 4 dígitos
      curObra = label;
      curRubro = null;
      if (!obras[curObra]) {
        const vals = extraerValores();
        obras[curObra] = {
          id: label.slice(0, 4), nombre: label,
          semanas: vals.semanas, meses: vals.meses, años: vals.años,
          total2026: vals.total2026, grandTotal: vals.grandTotal,
          rubros: {}, proveedores: [],
        };
      }
    } else if (/^\d{3}\s/.test(label) && curObra) {
      // RUBRO: empieza con 3 dígitos
      curRubro = label.slice(0, 3);
      if (!obras[curObra].rubros[curRubro]) {
        const vals = extraerValores();
        obras[curObra].rubros[curRubro] = {
          id: curRubro, nombre: label, nombreCorto: label.slice(4).trim(),
          semanas: vals.semanas, meses: vals.meses, años: vals.años,
          total2026: vals.total2026, grandTotal: vals.grandTotal,
          proveedores: [],
        };
      }
    } else if (curObra && curRubro && !/^\d/.test(label)) {
      // PROVEEDOR
      const vals = extraerValores();
      const totalProv = vals.grandTotal > 0
        ? vals.grandTotal
        : Object.values(vals.años).reduce((t,v)=>t+v,0);
      if (totalProv === 0) continue;
      const prov = {
        nombre: label, rubroId: curRubro,
        rubroNombre: obras[curObra].rubros[curRubro].nombreCorto,
        semanas: vals.semanas, meses: vals.meses, años: vals.años,
        total2026: vals.total2026, grandTotal: vals.grandTotal,
        total: totalProv,
      };
      obras[curObra].rubros[curRubro].proveedores.push(prov);
      obras[curObra].proveedores.push(prov);
    }
  }

  // ── PASO 3: listas de semanas y meses disponibles ──
  const semanasDisponibles = Object.keys(colMap)
    .filter(k => k.startsWith('week_'))
    .map(k => `S${k.split('_')[2]}`)
    .sort((a,b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const ultimaSemana = semanasDisponibles[semanasDisponibles.length - 1] || '';

  const mesesDisponibles = Object.keys(colMap)
    .filter(k => k.startsWith('total_month_'))
    .map(k => `M${k.replace('total_month_', '').replace('_', '-')}`)
    .sort();
  const ultimoMes = mesesDisponibles[mesesDisponibles.length - 1] || '';

  return {
    obras, semanasDisponibles, ultimaSemana,
    mesesDisponibles, ultimoMes,
    totalObras: Object.keys(obras).length, colMap,
  };
}

// Lógica común: descargar Sheet + parsear + guardar en Firestore
async function descargarYGuardarGP() {
  // Server-side: fetch directo a Google Sheets sin CORS
  const resp = await fetch(GP_SHEET_CSV, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} al descargar Sheet`);
  const text = await resp.text();
  if (!text || text.length < 200) throw new Error('Respuesta del Sheet vacía o muy corta');
  const parsed = parsearGPConstruct(text);
  if (!parsed.obras || Object.keys(parsed.obras).length === 0) {
    throw new Error('Parser no detectó obras en el CSV');
  }

  // ── PERFORMANCE: separar en 2 documentos ──
  // 1. RESUMEN (~50KB): solo metadatos + lista de obras con sus totales
  //    Esto es lo que el frontend descarga al login. Suficiente para listar obras.
  // 2. DETALLE (~3MB): rubros + proveedores con desglose semanal por cada obra
  //    Esto se descarga SOLO cuando entras al tab Gastos de una obra específica.
  const resumen = {
    parserVersion: PARSER_VERSION,
    ultimaActualizacion: new Date().toISOString(),
    fuente: 'cloud-function',
    semanasDisponibles: parsed.semanasDisponibles,
    ultimaSemana: parsed.ultimaSemana,
    mesesDisponibles: parsed.mesesDisponibles,
    ultimoMes: parsed.ultimoMes,
    totalObras: parsed.totalObras,
    colMap: parsed.colMap,
    // Solo info esencial por obra: id, nombre, totales (sin rubros ni proveedores)
    obras: Object.fromEntries(Object.entries(parsed.obras).map(([key, val]) => [
      key,
      {
        id: val.id,
        nombre: val.nombre,
        grandTotal: val.grandTotal,
        total2026: val.total2026,
        años: val.años,
        meses: val.meses,
        semanas: val.semanas,
        // Conteos para indicadores rápidos en el resumen
        numRubros: Object.keys(val.rubros||{}).length,
        numProveedores: (val.proveedores||[]).length,
      }
    ])),
  };
  await admin.firestore().doc('global/gp_construct').set(resumen);

  // El detalle de cada obra se guarda en su propio documento por id de 4 dígitos
  // El frontend lo descarga solo cuando entra al tab Gastos de esa obra
  const batch = admin.firestore().batch();
  let batchCount = 0;
  for (const [key, val] of Object.entries(parsed.obras)) {
    const ref = admin.firestore().doc(`global/gp_detalle/obras/${val.id}`);
    batch.set(ref, {
      parserVersion: PARSER_VERSION,
      ultimaActualizacion: new Date().toISOString(),
      id: val.id,
      nombre: val.nombre,
      grandTotal: val.grandTotal,
      total2026: val.total2026,
      años: val.años,
      meses: val.meses,
      semanas: val.semanas,
      rubros: val.rubros,
      proveedores: val.proveedores,
    });
    batchCount++;
    // Firestore limita batch a 500 ops, hacemos commits intermedios
    if (batchCount >= 400) {
      await batch.commit();
      batchCount = 0;
    }
  }
  if (batchCount > 0) await batch.commit();

  return parsed;
}

// ── HEALTH TRACKING ─────────────────────────────────────────────
// Registra el resultado de cada ejecución de un cron job en Firestore
// para que el Panel de Salud pueda monitorear el estado del sistema.
// Path: global/health = { [tipo]: { ultimaEjecucion, ok, mensaje, duracionMs, meta } }
async function registrarSalud(tipo, ok, mensaje, meta = {}) {
  try {
    const ref = admin.firestore().doc("global/health");
    const snap = await ref.get();
    const actual = snap.exists ? snap.data() : {};
    const entry = {
      ultimaEjecucion: new Date().toISOString(),
      ok: !!ok,
      mensaje: String(mensaje || ""),
      ...meta,
    };
    // También guarda historial corto: últimas 10 ejecuciones por tipo
    const histPrev = Array.isArray(actual[`${tipo}_historial`]) ? actual[`${tipo}_historial`] : [];
    const hist = [entry, ...histPrev].slice(0, 10);
    await ref.set({
      ...actual,
      [tipo]: entry,
      [`${tipo}_historial`]: hist,
    }, { merge: true });
  } catch (e) {
    console.warn(`registrarSalud(${tipo}) fallo silencioso:`, e?.message);
  }
}

// ── SCHEDULED: cada lunes 9am hora México ──
exports.actualizarGPSheet = onSchedule({
  schedule: "0 9 * * 1",   // lunes 9:00am
  timeZone: "America/Mexico_City",
  region: "us-central1",
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando actualización programada de GP Sheet…");
  try {
    const parsed = await descargarYGuardarGP();
    const mensaje = `OK: ${parsed.totalObras} obras, ${parsed.semanasDisponibles.length} semanas`;
    console.log(mensaje);
    await registrarSalud("gp_sync", true, mensaje, {
      duracionMs: Date.now() - t0,
      totalObras: parsed.totalObras,
      semanas: parsed.semanasDisponibles.length,
      ultimaSemana: parsed.ultimaSemana,
    });
  } catch (e) {
    console.error("Error en actualización programada de GP:", e);
    await registrarSalud("gp_sync", false, e.message || String(e), { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// ── CALLABLE: refrescar manualmente (cualquier admin) ──
exports.refrescarGP = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const email = (request.auth.token.email || "").toLowerCase();
  if (!email) throw new HttpsError("unauthenticated", "Token sin email.");
  // Cualquier usuario autenticado puede pedir refresh (es información útil para todos)
  try {
    const parsed = await descargarYGuardarGP();
    return {
      ok: true,
      totalObras: parsed.totalObras,
      semanas: parsed.semanasDisponibles.length,
      ultimaSemana: parsed.ultimaSemana,
      ultimoMes: parsed.ultimoMes,
    };
  } catch (e) {
    throw new HttpsError("internal", `Error al refrescar GP: ${e.message}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RESUMEN SEMANAL POR CORREO — Lunes 9:07 a.m. hora México
// ════════════════════════════════════════════════════════════════════════════
// Envía un email a Director General, Director Operaciones y Gerente Construcción
// con el estado consolidado del portafolio de obras activas.
// Usa Resend (https://resend.com) como proveedor de email transaccional.
// La API key se carga desde Google Secret Manager (no se hardcodea).

const APP_URL = "https://campo-fosmon.netlify.app";
const FROM_EMAIL = "CAMPO <campo@fosmon.com.mx>";
const ROLES_RESUMEN_SEMANAL = ["director_general", "director_operaciones", "gerente_construccion"];

const MXN_FMT = (n) => `$${Math.abs(Number(n) || 0).toLocaleString("es-MX", {
  minimumFractionDigits: 0, maximumFractionDigits: 0,
})}`;
const PCT_FMT = (n, d = 0) => `${(Number(n) || 0).toFixed(d)}%`;
const semaforoColor = (pct, modo = "avance") => {
  // avance: >=75 verde, >=40 amarillo, <40 rojo
  // gasto:  <=70 verde, <=90 amarillo, >90 rojo
  if (modo === "avance") return pct >= 75 ? "#3B6D11" : pct >= 40 ? "#854F0B" : "#A32D2D";
  return pct <= 70 ? "#3B6D11" : pct <= 90 ? "#854F0B" : "#A32D2D";
};

// Construye los KPIs de una obra leyendo sus sub-colecciones de Firestore
async function calcularKpisObra(obraId, gpData) {
  const db = admin.firestore();
  const [infoSnap, subsSnap, maqSnap, matSnap, otrosSnap, estSnap] = await Promise.all([
    db.doc(`obras/${obraId}/config/info`).get(),
    db.doc(`obras/${obraId}/avance/subs`).get(),
    db.doc(`obras/${obraId}/avance/maquinaria`).get(),
    db.doc(`obras/${obraId}/avance/materiales`).get(),
    db.doc(`obras/${obraId}/config/otros_gastos`).get(),
    db.doc(`obras/${obraId}/config/estimaciones`).get(),
  ]);
  const info = infoSnap.exists ? infoSnap.data() : {};
  const subs = (subsSnap.exists ? (subsSnap.data().data || []) : []);
  const maquinaria = (maqSnap.exists ? (maqSnap.data().data || []) : []);
  const materiales = (matSnap.exists ? (matSnap.data().data || []) : []);
  const otros = (otrosSnap.exists ? (otrosSnap.data().items || []) : []);
  const estimaciones = (estSnap.exists ? (estSnap.data().data || []) : []);

  const presupuesto = Number(info.presupuesto) || 0;
  const modoVol = info.modoAvance === "volumen";

  // Avance físico
  let avancePct = 0;
  if (modoVol && presupuesto > 0) {
    const ejecutado = subs.reduce((t, s) => t + (Number(s.cantEjec) || 0) * (Number(s.pu) || 0), 0);
    avancePct = (ejecutado / presupuesto) * 100;
  } else if (presupuesto > 0) {
    avancePct = subs.reduce((t, s) => t + ((Number(s.a) || 0) / 100) * ((Number(s.imp) || 0) / presupuesto) * 100, 0);
  }

  // Gasto: GP del Sheet (si existe match) + maquinaria propia + otros
  // Matching robusto (igual que resolverGastoGP del frontend):
  //   1) Por gpId explícito capturado en Contrato
  //   2) Por primeros 4 dígitos del id de CAMPO
  //   3) Por nombre normalizado (≥2 palabras significativas)
  let totGP = 0;
  if (gpData && gpData.obras) {
    const obrasArr = Object.values(gpData.obras);
    const gpId = info.gpId;
    let obraGP = null;
    // 1) Por gpId
    if (gpId) obraGP = obrasArr.find(o => o.id === gpId);
    // 2) Por id de 4 dígitos
    if (!obraGP && /^\d{4}/.test(obraId || "")) {
      obraGP = obrasArr.find(o => o.id === obraId.slice(0, 4));
    }
    // 3) Por nombre normalizado
    if (!obraGP) {
      const normalizar = (s) => (s || "").toString().toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      const palabrasObra = normalizar(info.nombre).split(" ").filter(w => w.length > 3);
      let mejor = null, score = 0;
      for (const o of obrasArr) {
        const palObra = normalizar(o.nombre).replace(/^\d{4}\s*/, "").split(" ").filter(w => w.length > 3);
        const matches = palabrasObra.filter(p => palObra.some(g => g.includes(p) || p.includes(g))).length;
        if (matches > score) { score = matches; mejor = o; }
      }
      if (score >= 2 && mejor) obraGP = mejor;
    }
    if (obraGP) {
      totGP = obraGP.grandTotal || obraGP.totalGeneral || obraGP.total || 0;
    }
  }
  const totMaq = maquinaria.reduce((t, m) => t + (Number(m.imp) || 0), 0);
  const totOtros = otros.reduce((t, o) => t + (Number(o.importe) || 0), 0);
  const totGasto = totGP + totMaq + totOtros;
  const pctGasto = presupuesto > 0 ? (totGasto / presupuesto) * 100 : 0;

  // Estimaciones cobradas
  const cobrado = estimaciones
    .filter(e => /pagada|cobrada/i.test(String(e.estatus || "")))
    .reduce((t, e) => t + (Number(e.monto) || 0), 0);

  // Última captura de avance (para alerta de pendiente)
  const fechaUltCaptura = subsSnap.exists ? subsSnap.data().fecha : null;
  const diasDesdeCaptura = fechaUltCaptura
    ? Math.floor((Date.now() - new Date(fechaUltCaptura).getTime()) / 86400000)
    : 999;

  return {
    obraId, nombre: info.nombre || obraId, contrato: info.contrato || "",
    cliente: info.cliente || "", presupuesto,
    avancePct, pctGasto, totGasto, cobrado,
    diasDesdeCaptura, modoVol,
  };
}

// HTML del email semanal — diseño compacto, mobile-friendly
function buildEmailHTML(kpisObras, fechaCorte) {
  const filasObras = kpisObras.map(k => {
    const colorAvance = semaforoColor(k.avancePct, "avance");
    const colorGasto = semaforoColor(k.pctGasto, "gasto");
    const linkObra = `${APP_URL}/?obra=${encodeURIComponent(k.obraId)}`;
    const alertaCaptura = k.diasDesdeCaptura > 7
      ? `<span style="background:#FCEBEB;color:#A32D2D;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">Sin captura ${k.diasDesdeCaptura}d</span>`
      : `<span style="color:#9AA0AC;font-size:11px;">Captura: ${k.diasDesdeCaptura}d</span>`;
    return `
    <tr>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;vertical-align:top;">
        <div style="font-weight:600;color:#0D1619;font-size:14px;line-height:1.3;">
          <a href="${linkObra}" style="color:#185FA5;text-decoration:none;">${k.nombre}</a>
        </div>
        <div style="color:#9AA0AC;font-size:11px;margin-top:2px;">${k.contrato || "—"} · ${k.cliente || ""}</div>
        <div style="margin-top:6px;">${alertaCaptura}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;text-align:right;vertical-align:top;">
        <div style="font-size:18px;font-weight:700;color:${colorAvance};">${PCT_FMT(k.avancePct, 1)}</div>
        <div style="font-size:10px;color:#9AA0AC;">avance</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;text-align:right;vertical-align:top;">
        <div style="font-size:14px;font-weight:600;color:${colorGasto};">${MXN_FMT(k.totGasto)}</div>
        <div style="font-size:10px;color:#9AA0AC;">${PCT_FMT(k.pctGasto, 0)} de ${MXN_FMT(k.presupuesto)}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;text-align:right;vertical-align:top;">
        <div style="font-size:13px;color:#0D1619;">${MXN_FMT(k.cobrado)}</div>
        <div style="font-size:10px;color:#9AA0AC;">cobrado</div>
      </td>
    </tr>`;
  }).join("");

  const totalObras = kpisObras.length;
  const presupuestoTotal = kpisObras.reduce((t, k) => t + k.presupuesto, 0);
  const gastoTotal = kpisObras.reduce((t, k) => t + k.totGasto, 0);
  const cobradoTotal = kpisObras.reduce((t, k) => t + k.cobrado, 0);
  const obrasSinCaptura = kpisObras.filter(k => k.diasDesdeCaptura > 7).length;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Resumen semanal CAMPO</title></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0D1619;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F2F5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#0D1619;color:#fff;padding:24px 28px;">
          <div style="font-size:11px;letter-spacing:0.12em;opacity:0.7;">CAMPO · FOSMON CONSTRUCCIONES</div>
          <div style="font-size:24px;font-weight:700;margin-top:6px;">Resumen semanal</div>
          <div style="font-size:12px;opacity:0.8;margin-top:4px;">Corte del ${fechaCorte}</div>
        </td></tr>
        <!-- Resumen ejecutivo -->
        <tr><td style="padding:20px 28px;background:#F8F9FB;border-bottom:1px solid #E8EAF0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="text-align:center;padding:6px;"><div style="font-size:22px;font-weight:700;color:#0D1619;">${totalObras}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Obras activas</div></td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#185FA5;">${MXN_FMT(presupuestoTotal)}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Presupuesto</div></td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#A32D2D;">${MXN_FMT(gastoTotal)}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Gasto acumulado</div></td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#3B6D11;">${MXN_FMT(cobradoTotal)}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Cobrado</div></td>
            </tr>
          </table>
          ${obrasSinCaptura > 0 ? `
          <div style="margin-top:14px;padding:10px 14px;background:#FCEBEB;border-left:3px solid #E24B4A;border-radius:4px;font-size:12px;color:#A32D2D;">
            <b>${obrasSinCaptura} ${obrasSinCaptura === 1 ? "obra" : "obras"} sin captura en los últimos 7 días.</b> Revisa la columna "Sin captura" abajo.
          </div>` : ""}
        </td></tr>
        <!-- Tabla de obras -->
        <tr><td style="padding:0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <thead><tr style="background:#fff;border-bottom:2px solid #E8EAF0;">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Obra</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Avance</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Gasto</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Cobrado</th>
            </tr></thead>
            <tbody>${filasObras}</tbody>
          </table>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:24px 28px;text-align:center;border-top:1px solid #E8EAF0;">
          <a href="${APP_URL}" style="display:inline-block;background:#0D1619;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Abrir CAMPO</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 28px;background:#F8F9FB;font-size:10px;color:#9AA0AC;text-align:center;border-top:1px solid #E8EAF0;">
          Este resumen se envía automáticamente cada lunes a las 9 a.m. (CDMX) a Dirección y Gerencia.<br>
          CAMPO — FOSMON Construcciones · campo-fosmon.netlify.app
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Envía email via Resend API
async function enviarEmailResend(apiKey, { from, to, subject, html }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Resend error ${resp.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Función principal: arma y envía el resumen semanal
async function generarYEnviarResumenSemanal(apiKey) {
  const db = admin.firestore();
  // 1) Lista obras activas (top-level)
  const obrasSnap = await db.collection("obras").get();
  const obras = obrasSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(o => (o.estado || "activa") !== "archivada");

  // 2) Carga el GP data (resumen) para sacar el gasto de cada obra
  const gpResumenSnap = await db.doc("global/gp_resumen").get();
  const gpData = gpResumenSnap.exists ? gpResumenSnap.data() : null;

  // 3) Calcula KPIs por obra en paralelo
  const kpisObras = await Promise.all(
    obras.map(o => calcularKpisObra(o.id, gpData).catch(e => {
      console.error(`Error KPIs obra ${o.id}:`, e.message);
      return null;
    }))
  );
  const kpisValidos = kpisObras.filter(Boolean)
    .sort((a, b) => (b.presupuesto || 0) - (a.presupuesto || 0));

  // 4) Obtiene destinatarios: usuarios activos con roles del portafolio
  const usuariosSnap = await db.collection("usuarios").get();
  const destinatarios = usuariosSnap.docs
    .map(d => d.data())
    .filter(u => u.activo !== false && ROLES_RESUMEN_SEMANAL.includes(u.rol))
    .map(u => u.email)
    .filter(Boolean);

  if (destinatarios.length === 0) {
    console.warn("No hay destinatarios para resumen semanal");
    return { enviados: 0, motivo: "sin_destinatarios" };
  }

  // 5) Arma el HTML
  const fechaCorte = new Date().toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const html = buildEmailHTML(kpisValidos, fechaCorte);

  // 6) Envía
  const resultado = await enviarEmailResend(apiKey, {
    from: FROM_EMAIL,
    to: destinatarios,
    subject: `CAMPO · Resumen semanal · ${kpisValidos.length} obras activas`,
    html,
  });
  console.log(`Resumen enviado a ${destinatarios.length} destinatarios. Resend ID: ${resultado.id}`);
  return { enviados: destinatarios.length, destinatarios, resendId: resultado.id };
}

// SCHEDULED: lunes 9:07 a.m. hora México (después de actualizarGPSheet a las 9:00)
exports.resumenSemanalEmail = onSchedule({
  schedule: "7 9 * * 1",
  timeZone: "America/Mexico_City",
  region: "us-central1",
  secrets: [RESEND_API_KEY],
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando resumen semanal por correo…");
  try {
    const res = await generarYEnviarResumenSemanal(RESEND_API_KEY.value());
    console.log("Resumen semanal OK:", res);
    await registrarSalud("email_semanal", true, `Enviado a ${res.enviados || 0} destinatarios`, {
      duracionMs: Date.now() - t0,
      enviados: res.enviados,
      destinatarios: res.destinatarios,
      resendId: res.resendId,
    });
  } catch (e) {
    console.error("Error en resumen semanal:", e);
    await registrarSalud("email_semanal", false, e.message || String(e), { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// CALLABLE: para probar manualmente desde la consola o la app
// (solo director_general, director_operaciones, admin_sistema)
exports.probarResumenSemanal = onCall({
  region: "us-central1",
  secrets: [RESEND_API_KEY],
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const email = (request.auth.token.email || "").toLowerCase();
  const perfilSnap = await admin.firestore().doc(`usuarios/${emailAId(email)}`).get();
  const rol = perfilSnap.exists ? perfilSnap.data().rol : null;
  if (!["director_general", "director_operaciones", "admin_sistema"].includes(rol)) {
    throw new HttpsError("permission-denied", "Solo dirección o admin puede disparar la prueba.");
  }
  try {
    const res = await generarYEnviarResumenSemanal(RESEND_API_KEY.value());
    return { ok: true, ...res };
  } catch (e) {
    throw new HttpsError("internal", `Error enviando resumen: ${e.message}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// BACKUP AUTOMÁTICO SEMANAL DE FIRESTORE
// ════════════════════════════════════════════════════════════════════════════
// Cada domingo 3:00 a.m. CDMX exporta toda la base de Firestore al bucket
// dedicado de backups. Retención: 16 semanas (112 días). Los exports más
// viejos se borran automáticamente por lifecycle del bucket.
//
// SETUP REQUERIDO (manual, una sola vez):
// 1) Crear bucket en consola de Google Cloud:
//      gsutil mb -p campo-fosmon -l us-central1 gs://campo-fosmon-backups
// 2) Aplicar lifecycle de 112 días:
//      gsutil lifecycle set lifecycle.json gs://campo-fosmon-backups
//    (donde lifecycle.json contiene la regla de borrado a 112 días)
// 3) Dar permiso al service account de Firebase para escribir al bucket:
//      gcloud projects add-iam-policy-binding campo-fosmon \
//        --member="serviceAccount:campo-fosmon@appspot.gserviceaccount.com" \
//        --role="roles/datastore.importExportAdmin"
//
// RESTAURAR (si algún día se necesita):
//   gcloud firestore import gs://campo-fosmon-backups/firestore/2026-06-08/
//   Tarda 15-30 min según el tamaño. Sobrescribe documentos existentes.

const BACKUP_BUCKET = "gs://campo-fosmon-backups";
const PROJECT_ID = "campo-fosmon";

async function ejecutarBackupFirestore() {
  const fecha = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const destino = `${BACKUP_BUCKET}/firestore/${fecha}`;

  // Usamos la REST API admin de Firestore para iniciar el export.
  // Esto NO es bloqueante — devuelve una operación de larga duración (LRO).
  // El export termina solo, en background. Para una base de tu tamaño actual
  // típicamente tarda 1-5 min.
  const accessToken = await admin.app().options.credential.getAccessToken();
  const token = accessToken.access_token || accessToken;

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      outputUriPrefix: destino,
      // collectionIds vacío = exporta TODAS las colecciones
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Export error ${resp.status}: ${JSON.stringify(data)}`);
  }
  return { destino, operationName: data.name };
}

// SCHEDULED: domingo 3:00 a.m. hora México (baja actividad)
exports.backupSemanalFirestore = onSchedule({
  schedule: "0 3 * * 0",
  timeZone: "America/Mexico_City",
  region: "us-central1",
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando backup semanal de Firestore…");
  try {
    const res = await ejecutarBackupFirestore();
    console.log(`Backup iniciado OK. Destino: ${res.destino}, Op: ${res.operationName}`);
    await registrarSalud("backup", true, `Iniciado: ${res.destino}`, {
      duracionMs: Date.now() - t0,
      destino: res.destino,
      operationName: res.operationName,
    });
  } catch (e) {
    console.error("Error en backup semanal:", e);
    await registrarSalud("backup", false, e.message || String(e), { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// CALLABLE: lanzar backup manualmente (solo director_general / admin_sistema)
exports.probarBackup = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const email = (request.auth.token.email || "").toLowerCase();
  const perfilSnap = await admin.firestore().doc(`usuarios/${emailAId(email)}`).get();
  const rol = perfilSnap.exists ? perfilSnap.data().rol : null;
  if (!["director_general", "admin_sistema"].includes(rol)) {
    throw new HttpsError("permission-denied", "Solo dirección o admin puede lanzar backup.");
  }
  try {
    const res = await ejecutarBackupFirestore();
    return { ok: true, ...res };
  } catch (e) {
    throw new HttpsError("internal", `Error en backup: ${e.message}`);
  }
});
