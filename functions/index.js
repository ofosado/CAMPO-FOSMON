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
const admin = require("firebase-admin");

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

// ── SCHEDULED: cada lunes 9am hora México ──
exports.actualizarGPSheet = onSchedule({
  schedule: "0 9 * * 1",   // lunes 9:00am
  timeZone: "America/Mexico_City",
  region: "us-central1",
}, async () => {
  console.log("Iniciando actualización programada de GP Sheet…");
  try {
    const parsed = await descargarYGuardarGP();
    console.log(`Actualización OK: ${parsed.totalObras} obras, ${parsed.semanasDisponibles.length} semanas`);
  } catch (e) {
    console.error("Error en actualización programada de GP:", e);
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
