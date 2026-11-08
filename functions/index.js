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
const { onDocumentWritten, onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

// `FieldValue` se trae por la ruta modular y NO como `admin.firestore.FieldValue`.
// Es el mismo objeto —se midió: `require("firebase-admin/firestore").FieldValue
// === admin.firestore.FieldValue`—, así que en producción esto no cambia nada.
// Lo que cambia es que se puede medir: el emulador de funciones sustituye el
// módulo `firebase-admin` por un proxy y para `firestore` devuelve
// `value.bind(target)` (functionsEmulatorRuntime.js). `bind` descarta las
// propiedades propias de la función, de modo que dentro del emulador
// `admin.firestore.FieldValue` es `undefined` y cualquier función que escriba
// una marca de tiempo del servidor muere con «Cannot read properties of
// undefined». Pasaba en los seis usos del archivo, no en uno: `crearUsuario`,
// `actualizarUsuario` y el disparador de claims tampoco se podían ejercitar
// contra el emulador. Con la ruta modular el código corre igual en los dos
// lados, que es la única manera de que una verificación local valga.
const { FieldValue } = require("firebase-admin/firestore");

// Secret de Resend para mandar correos transaccionales (resumen semanal, etc.)
// Se carga en Cloud Functions con:  firebase functions:secrets:set RESEND_API_KEY
const RESEND_API_KEY = defineSecret("RESEND_API_KEY");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

// ────────────────────────────────────────────────────────────────────────────
// ORGANIZACIONES: modelo multi-tenant (feature/organizaciones — 2026-09)
// Una organización es de tipo 'constructora' (empresa que ejecuta obra) o
// 'dependencia' (gobierno/municipio que licita/supervisa obra a contratistas).
// El tipo se fija al crear la organización y NO es editable después.
// Cada rol pertenece a UN tipo, salvo el rol cross-tipo 'soporte'.
// ────────────────────────────────────────────────────────────────────────────
const TIPOS_ORG = ["constructora", "dependencia"];

// Roles válidos por tipo de organización.
// El label visible en UI se define en src/App.jsx (ROLES_LABEL).
const ROLES_POR_TIPO = {
  constructora: [
    "director_general",
    "director_operaciones",
    "gerente_construccion",
    "superintendente",
    "residente",
    "administrador_obra",
    "auditor",              // antes "supervisor"; renombrado 2026-09
    "admin_sistema",
    "cliente",
  ],
  dependencia: [
    "director_obras",
    "subdirector",
    "jefe_supervision",
    "supervisor_obra",      // distinto del auditor de constructora
    "administrativo",
    "contralor",
    "contratista",          // equivalente a "cliente" en dependencia
  ],
};

// Rol cross-tipo: puede crear organizaciones y usuarios en cualquier org,
// pero NO puede leer avances, montos, evidencia ni comparativos. Todo su
// acceso queda registrado en /auditoria (append-only).
const ROLES_CROSS = ["soporte"];

// Módulos declarados por tipo (documental — la UI se implementa cuando toque)
const MODULOS_POR_TIPO = {
  constructora: ["nomina", "gastos", "margen", "almacen", "maquinaria"],
  dependencia: ["contratistas", "supervisores", "comparativo", "programa", "SIMVER"],
};

// Colecciones que van a vivir bajo /orgs/{orgId}/ por tipo. Las reglas
// niegan desde ya el acceso cruzado aunque los datos aún no existan.
const COLS_POR_TIPO = {
  constructora: ["nomina", "gastos", "almacen", "maquinaria"],
  dependencia: ["contratistas", "supervisores", "programa", "convenios", "evidencia"],
};

// Unión de todos los roles válidos (usado en validaciones básicas)
const ROLES_VALIDOS = [
  ...ROLES_POR_TIPO.constructora,
  ...ROLES_POR_TIPO.dependencia,
  ...ROLES_CROSS,
];

// Roles con acceso administrativo para gestionar usuarios/organizaciones
//   · director_general / director_operaciones / admin_sistema: dentro de su org
//   · soporte: cross-tipo (crea orgs y usuarios pero no lee operación)
const ROLES_ADMIN = [
  "director_general",
  "director_operaciones",
  "admin_sistema",
  "director_obras",       // equivalente en dependencia
  "subdirector",          // segunda línea en dependencia
  "soporte",
];

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
    // El mensaje enumera lo que el código acepta de verdad. Antes decía «sólo
    // director_general y admin_sistema», cuando `ROLES_ADMIN` admite seis roles:
    // un mensaje que miente sobre el permiso manda a buscar el problema donde
    // no está.
    throw new HttpsError(
      "permission-denied",
      `Para gestionar usuarios se necesita uno de estos roles: ${ROLES_ADMIN.join(", ")}.`
    );
  }
  return { email, perfil };
}

// ──────────────────────────────────────────────────────────────────────────
// LA FRONTERA ENTRE ORGANIZACIONES
//
// `requireAdmin` contesta «quién llama y si es admin», pero no «de qué
// organización». Sin esa segunda pregunta las cinco funciones de gestión de
// usuarios operaban sobre la colección `usuarios` COMPLETA: `listarUsuarios`
// devolvía el padrón entero y `cambiarPassword` aceptaba el correo de
// cualquiera. Como `ROLES_ADMIN` incluye `director_obras` y `subdirector`, un
// directivo de una dependencia podía resetear la contraseña de un director
// general de la constructora. Que la interfaz no le ofreciera la pantalla no
// era una defensa: un `onCall` se invoca desde el SDK sin pasar por la
// interfaz.
//
// La frontera es el `orgId` del perfil de QUIEN LLAMA, nunca uno que venga en
// `request.data`. `soporte` es el único rol que la cruza, porque existe para
// eso —crear organizaciones y el primer usuario de cada una—; su alcance es a
// identidades y jamás a operación, y eso lo sostienen las reglas de Firestore,
// no este archivo.
// ──────────────────────────────────────────────────────────────────────────
function ambitoDe(perfil) {
  const cross = ROLES_CROSS.includes(perfil.rol);
  return { cross, orgId: cross ? null : String(perfil.orgId || "") };
}

// Exige que el usuario objetivo esté dentro del ámbito de quien llama.
// Un perfil sin `orgId` —legado anterior a la migración de organizaciones— sólo
// lo alcanza soporte: de nadie más se puede afirmar que sea de su organización.
function exigirMismaOrg(ambito, perfilObjetivo, email) {
  if (ambito.cross) return;
  if (!ambito.orgId) {
    throw new HttpsError(
      "failed-precondition",
      "Tu perfil no tiene organización asignada; no puedes gestionar usuarios."
    );
  }
  if (String((perfilObjetivo || {}).orgId || "") !== ambito.orgId) {
    // El mismo mensaje exista o no el usuario. Distinguir «no existe» de «no
    // puedes» convertiría esta función en un modo de averiguar quién está dado
    // de alta en las otras organizaciones.
    throw new HttpsError("not-found", `Usuario no encontrado: ${email}`);
  }
}

// Valida que un rol pueda otorgarse en una organización ANTES de escribir nada.
// Es la misma condición que `aplicarClaimsUsuario` exige después, de
// `ROLES_POR_TIPO` contra el `tipo` de la org. La diferencia es dónde se nota:
// allá el trigger devuelve {ok:false, motivo:"rol_no_pertenece_tipo"}, se queda
// sin aplicar claims, de forma asíncrona y sin lanzar. La cuenta queda creada,
// el alta dice «listo», y el usuario entra a una sesión donde las reglas le
// niegan todo. Aquí falla a la cara de quien da el alta.
async function validarRolEnOrg(rol, orgId) {
  const org = await leerOrg(orgId);
  if (!org) throw new HttpsError("not-found", `La organización ${orgId} no existe.`);
  if (!org.activa) {
    throw new HttpsError("failed-precondition", `La organización ${orgId} está inactiva.`);
  }
  const permitidos = ROLES_POR_TIPO[org.tipo] || [];
  if (!permitidos.includes(rol)) {
    throw new HttpsError(
      "invalid-argument",
      `El rol ${rol} no existe en una organización de tipo ${org.tipo || "(sin tipo)"}. ` +
      `Válidos: ${permitidos.join(", ")}.`
    );
  }
  return org;
}

// ──────────────────────────────────────────────────────────────────────────
// DE QUIÉN ES LA RAÍZ
//
// `obras/`, `global/*` y `health/*` viven fuera de `/orgs` y son de la
// constructora: por eso `crearOrganizacion` rechaza una segunda constructora,
// porque dos no caben en una raíz que no está particionada.
//
// Los trabajos programados leen esa raíz y luego eligen a quién hablarle. La
// elección la hacían POR EL NOMBRE DEL ROL: `director_general`,
// `gerente_construccion`. Hoy eso acierta, pero acierta por coincidencia de
// vocabularios —ninguno de esos tres nombres está en `ROLES_POR_TIPO
// .dependencia`—, no porque haya una frontera. Una coincidencia de nombres no
// es una defensa: el día que alguien quiera que `director_obras` reciba un
// resumen de SUS obras, basta meterlo en la lista de roles para que el gasto,
// el presupuesto y lo cobrado de las obras de la constructora salgan en el
// correo de un municipio. Y el margen bruto de un contratista no es dato de la
// dependencia que lo contrata.
//
// Esta función contesta la pregunta que faltaba —«¿de quién son estos datos?»—
// y la contesta leyendo, no suponiendo. Si no hay exactamente una constructora
// LANZA: el trabajo no corre. Mandar el correo «de todas formas» con una
// organización adivinada es justo el modo de fallar que no se puede permitir,
// porque nadie se entera. Que no salga el correo se nota el lunes.
async function orgDeLaRaiz(db) {
  const snap = await db.collection("orgs").where("tipo", "==", "constructora").get();
  const ids = snap.docs.map(d => d.id);
  if (ids.length !== 1) {
    throw new Error(
      `No se puede determinar de quién es \`obras/\`: hay ${ids.length} organización(es) ` +
      `de tipo constructora (${ids.join(", ") || "ninguna"}), y la raíz es de una sola. ` +
      "El trabajo no corre: elegir destinatario sin saber de quién es el dato es " +
      "como inventarse una cifra."
    );
  }
  return ids[0];
}

// Parte un padrón en «los de esta organización» y «los que quedaron fuera».
//
// El filtro NO va en la consulta, a diferencia de `listarUsuarios`. Allá el
// resultado viaja a un cliente y lo que no se lee no se puede filtrar mal;
// aquí no sale nada del servidor salvo el correo, y hace falta poder CONTAR a
// quien se quedó fuera. Un destinatario que desaparece en silencio es el
// defecto espejo del destinatario de más: el director deja de recibir su
// resumen del lunes y nadie se entera de que dejó de recibirlo.
//
// Se distingue el que no tiene organización del que es de otra. Al primero se
// le dice el nombre —es un registro roto de la propia casa, y hay que
// arreglarlo—; del segundo sólo se dice cuántos, porque el padrón de otro
// cliente no es dato de éste.
function partirPorOrg(perfiles, orgId) {
  const dentro = [], sinOrg = [], deOtra = [];
  for (const u of perfiles) {
    const suya = String(u.orgId || "");
    if (!suya) sinOrg.push(u);
    else if (suya === orgId) dentro.push(u);
    else deOtra.push(u);
  }
  return { dentro, sinOrg, deOtra };
}

// Un rol cross sólo lo otorga quien ya lo tiene. `soporte` no aparece en el
// selector de la interfaz a propósito, pero esta función es invocable sin ella.
function exigirPuedeOtorgarRol(ambito, rol) {
  if (ROLES_CROSS.includes(rol) && !ambito.cross) {
    throw new HttpsError(
      "permission-denied",
      `El rol ${rol} cruza organizaciones y sólo lo otorga quien ya lo tiene.`
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// LA HORA QUE UN DOCUMENTO PUEDE CITAR
//
// El reporte ejecutivo lleva impreso «Corte del reporte» en la portada, y ese
// renglón sale firmado al pie por tres personas. Hasta hoy la fecha la ponía
// `new Date()` en el navegador: la hora del aparato de quien apretó el botón.
// Un reloj mal puesto —o un huso distinto— no se nota al leer el PDF, porque
// la fecha impresa es creíble sin importar cuál sea.
//
// La alternativa que NO se tomó era escribir un documento con
// `FieldValue.serverTimestamp()` y leerlo de vuelta. Eso mete un efecto en lo
// que es una operación de lectura —generar un PDF no debería dejar rastro en
// la base— y además cuesta dos viajes. Esta callable cuesta uno y no escribe
// nada.
//
// Pide sesión. No porque la hora sea secreta, sino porque un `onCall` sin
// autenticación es un extremo abierto de nuestro proyecto que cualquiera puede
// golpear, y la factura la pagamos nosotros. No consulta el perfil ni el rol:
// la hora es la misma para todos y una lectura de Firestore aquí sería un
// gasto por cada PDF, además de una dependencia que puede fallar.
// ──────────────────────────────────────────────────────────────────────────
exports.horaDelServidor = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  return { ms: Date.now() };
});

// ──────────────────────────────────────────────────────────────────────────
// CREAR ORGANIZACIÓN
//
// Era `scripts/crear-org-fosmon.cjs`: dar de alta un cliente costaba una
// sesión de consola con credenciales de administrador. Mientras eso siguiera
// así, cada municipio nuevo nos cuesta a nosotros y el producto no se vende
// solo.
//
// ── POR QUÉ `create()` Y NO `set()` ──
// `set({merge:true})` sobre un id ya ocupado FUNDE los dos documentos campo
// por campo y no falla: el nombre del cliente nuevo encima del viejo, el
// `tipo` del viejo si el nuevo no lo trae. Es el mismo modo de fallo del #31 y
// aquí el documento fundido es el tenant completo. `create()` revienta con
// ALREADY_EXISTS, que es lo que uno quiere oír.
//
// ── POR QUÉ UN BATCH ──
// La organización y su marca entran juntas o no entra ninguna. Una org a
// medias —documento sí, marca no— no se nota al crearla y aparece después como
// un encabezado en blanco en la primera demo.
//
// ── POR QUÉ SÓLO SOPORTE ──
// Crear un tenant no es administrar el propio. Las reglas se lo permitían
// también a `admin_sistema` y a los directivos de dependencia "para casos
// edge"; esta rama se lo quita a los dos, aquí y en firestore.rules. No era
// una escalada —crear `orgs/B` no da acceso a B, porque un perfil de B lo crea
// un admin de B— pero sí es la facultad de crear clientes en la plataforma, y
// ésa es nuestra.
// ──────────────────────────────────────────────────────────────────────────

// El id es parte de la ruta de TODOS los datos de ese cliente
// (`orgs/{id}/obras/...`) y aparece en la URL de la marca. Se exige en
// minúsculas y sin puntos ni barras: un id con `/` partiría la ruta en dos y
// `.`/`..` son ids que Firestore rechaza. No se "normaliza" en silencio lo que
// venga mal —un cliente dado de alta como `Coatzacoalcos` y guardado como
// `coatzacoalcos` es una discrepancia que se descubre tarde—: se rechaza.
const RE_ORG_ID = /^[a-z0-9][a-z0-9-]{1,38}$/;

exports.crearOrganizacion = onCall(async (request) => {
  const { perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);
  if (!ambito.cross) {
    throw new HttpsError(
      "permission-denied",
      "Dar de alta una organización es un acto de plataforma: lo hace el rol de soporte."
    );
  }

  const { orgId, nombre, tipo, branding } = request.data || {};
  const id = String(orgId || "").trim();
  const nom = String(nombre || "").trim();

  if (!id || !nom || !tipo) {
    throw new HttpsError("invalid-argument", "Faltan datos requeridos: orgId, nombre y tipo.");
  }
  if (!RE_ORG_ID.test(id)) {
    throw new HttpsError(
      "invalid-argument",
      `El identificador «${id}» no sirve como id de organización. ` +
      "Minúsculas, números y guiones, de 2 a 39 caracteres, empezando por letra o número."
    );
  }
  if (!TIPOS_ORG.includes(tipo)) {
    throw new HttpsError(
      "invalid-argument",
      `Tipo inválido: ${tipo}. Válidos: ${TIPOS_ORG.join(", ")}.`
    );
  }

  const db = admin.firestore();

  // ── UNA SOLA CONSTRUCTORA, Y ES UNA CONDICIÓN EXPLÍCITA (#73) ────────────
  //
  // Media plataforma supone que la constructora es una: `obras/{obraId}`,
  // `global/gp_construct`, `global/historial_obras`, `health/*` y la
  // `auditoria` de la raíz viven todos fuera de `/orgs/` y los guarda
  // `esConstructora()` / `esDirectivoC()`, que no distinguen entre dos. La
  // segunda constructora no rompería nada visible el día que se cree: se
  // rompería después, cuando sus directivos leyeran las obras, los montos y
  // la bitácora de la primera.
  //
  // Esto no se tapa en las reglas poniendo `orgId() == 'fosmon'`: el nombre
  // de un inquilino incrustado en la frontera que separa inquilinos es algo
  // que en seis meses nadie recuerda por qué está ahí. Se niega el
  // nacimiento, con un mensaje que dice qué hay que migrar antes.
  //
  // El día que haya una segunda constructora de verdad, esto sale en la cara
  // de quien la da de alta. Lo ejecuta el §5 de
  // `scripts/prueba-alta-de-organizacion.cjs`.
  if (tipo === "constructora") {
    const yaHay = await db.collection("orgs")
      .where("tipo", "==", "constructora").limit(1).get();
    if (!yaHay.empty) {
      const otra = yaHay.docs[0].id;
      throw new HttpsError(
        "failed-precondition",
        `Ya existe la constructora «${otra}», y hoy la plataforma sólo sostiene una. ` +
        "No es un límite de producto: `obras/`, `global/*`, `health/*` y la " +
        "bitácora de la raíz están fuera de /orgs y los guardan reglas que no " +
        "distinguen entre dos constructoras, así que la segunda leería las obras, " +
        "los montos y la bitácora de la primera. Para dar de alta otra hay que " +
        "migrar antes esos paths a /orgs/{orgId}/. No se escribió nada."
      );
    }
  }

  const orgRef = db.doc(`orgs/${id}`);
  const marcaRef = db.doc(`orgs/${id}/config/branding`);

  // La marca: `empresa` es lo que el encabezado enseña al cliente como suyo.
  // Por omisión es el nombre que se acaba de teclear —el mismo dato, no uno
  // inventado—. `empresaCorta` y `dominio` se omiten si no se dieron: una
  // cadena vacía escrita se vería después como un dato capturado.
  const b = branding && typeof branding === "object" ? branding : {};
  const marca = { empresa: String(b.empresa || nom).trim() };
  if (String(b.empresaCorta || "").trim()) marca.empresaCorta = String(b.empresaCorta).trim();
  if (String(b.dominio || "").trim()) marca.dominio = String(b.dominio).trim();

  const batch = db.batch();
  batch.create(orgRef, {
    nombre: nom,
    tipo,
    activa: true,
    creadaEn: FieldValue.serverTimestamp(),
    creadaPor: request.auth.token.email || "",
  });
  batch.set(marcaRef, marca);

  try {
    await batch.commit();
  } catch (e) {
    if (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || "")) {
      throw new HttpsError(
        "already-exists",
        `Ya existe una organización con el identificador «${id}». No se escribió nada.`
      );
    }
    throw new HttpsError("internal", `No se pudo crear la organización: ${e.message}`);
  }

  // Los roles válidos salen de aquí y no de la pantalla: quien acaba de crear
  // la org necesita saber con qué rol puede dar de alta al primer usuario, y
  // es esta tabla la que `validarRolEnOrg` va a exigir después.
  return { ok: true, orgId: id, tipo, roles: ROLES_POR_TIPO[tipo] };
});

// ──────────────────────────────────────────────────────────────────────────
// CREAR USUARIO
// ──────────────────────────────────────────────────────────────────────────
// La contraseña ya NO viene de la pantalla: se sortea aquí y sale en el correo
// de bienvenida. Lo que había antes era un campo de texto donde quien daba el
// alta tecleaba una, y después la copiaba a un correo escrito a mano. Las dos
// mitades de ese trámite fallaban: las contraseñas que quedaron en el repo son
// adivinables, y si el correo no se escribía, el usuario tenía cuenta y no lo
// sabía.
//
// `secrets` enlaza la llave de Resend a ESTA función. Sin eso
// `RESEND_API_KEY.value()` sale vacío en producción y el correo no saldría —y
// `mandarCorreoDeAlta` lo registraría como error, pero el usuario ya existiría
// sin forma de entrar.
exports.crearUsuario = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  const { perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

  const { email, nombre, rol, rolLabel, obras_asignadas, orgId: orgIdPedido } = request.data || {};

  if (!email || !nombre || !rol) {
    throw new HttpsError(
      "invalid-argument",
      "Faltan datos requeridos: email, nombre y rol."
    );
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    throw new HttpsError("invalid-argument", `Rol inválido: ${rol}`);
  }
  exigirPuedeOtorgarRol(ambito, rol);

  // Se sortea antes de tocar Auth para que sea la MISMA cadena la que se
  // registra en Auth y la que viaja en el correo. Generarla dos veces —una
  // para cada cosa— es cómo se manda un correo con una contraseña que no
  // abre nada.
  const password = generarPasswordTemporal();

  // ── La organización del usuario nuevo ──
  // Sale del perfil de quien da el alta. Si se aceptara de `request.data`, un
  // director general de la organización A crearía cuentas en la B con sólo
  // cambiar un campo de la llamada, y `orgId` es el discriminante de todo el
  // aislamiento: no se recibe de fuera. La excepción es soporte, que cruza
  // organizaciones y por eso está OBLIGADO a decir en cuál.
  const rolCross = ROLES_CROSS.includes(rol);
  const orgId = rolCross
    ? null
    : (ambito.cross ? String(orgIdPedido || "").trim() : ambito.orgId);
  if (!rolCross && !orgId) {
    throw new HttpsError(
      ambito.cross ? "invalid-argument" : "failed-precondition",
      ambito.cross
        ? "Falta `orgId`: un alta hecha por soporte tiene que decir en qué organización."
        : "Tu perfil no tiene organización asignada; no se puede crear un usuario sin ella."
    );
  }
  // Antes de tocar Auth: si el rol no cabe en el tipo de la org, no se crea
  // nada. Al revés quedaría un registro huérfano en Auth sin perfil.
  if (orgId) await validarRolEnOrg(rol, orgId);

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
    // Sin este campo, `aplicarClaimsUsuario` resolvía `orgId: null` y de ahí
    // `tipo: null`, así que la cuenta entraba y no veía nada: toda regla de
    // dependencia exige `oid == orgId()`. Una cuenta creada desde la app nacía
    // muerta y el alta no lo decía.
    orgId: orgId || null,
    obras_asignadas: Array.isArray(obras_asignadas) ? obras_asignadas : [],
    activo: true,
    uid: userRecord.uid,
    creadoEn: FieldValue.serverTimestamp(),
    creadoPor: request.auth.token.email || "",
    ...(reparado ? { reparadoDeAuth: true } : {}),
  });

  // ── EL CORREO DE BIENVENIDA ──
  // Va DESPUÉS de escribir el perfil, nunca antes: si se mandara primero y la
  // escritura rebotara, habría una contraseña circulando para una cuenta que
  // no existe. En este orden, lo peor que puede pasar es una cuenta que existe
  // y un correo que no salió — y eso se arregla desde la pantalla, con el
  // botón de resetear contraseña.
  const marca = await marcaDeOrg(orgId);
  const tipoOrg = orgId ? (await leerOrg(orgId))?.tipo || null : null;
  const obrasTxt = await nombresDeObras(
    orgId, tipoOrg,
    Array.isArray(obras_asignadas) ? obras_asignadas : []
  );
  const { subject, html } = correoBienvenida({
    marca,
    nombre,
    email: emailNorm,
    password,
    rol,
    rolLabel,
    obras: obrasTxt,
    dioElAlta: request.auth.token.email || "",
  });
  const correo = await mandarCorreoDeAlta(RESEND_API_KEY.value(), {
    to: emailNorm, subject, html, concepto: "bienvenida",
  });

  // `correo` se devuelve para que la pantalla pueda decir la verdad. Si el
  // correo no salió, el alta sí se hizo pero NADIE tiene la contraseña: ese
  // caso tiene que verse en la interfaz, no sólo en un log que nadie lee.
  return { ok: true, uid: userRecord.uid, email: emailNorm, reparado, correo };
});

// ──────────────────────────────────────────────────────────────────────────
// ACTUALIZAR USUARIO
// ──────────────────────────────────────────────────────────────────────────
exports.actualizarUsuario = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  const { perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

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
  const perfilObjetivo = snap.data() || {};
  exigirMismaOrg(ambito, perfilObjetivo, emailNorm);

  if (cambios.rol && !ROLES_VALIDOS.includes(cambios.rol)) {
    throw new HttpsError("invalid-argument", `Rol inválido: ${cambios.rol}`);
  }
  // El rol se valida contra la organización del usuario QUE SE EDITA, no la de
  // quien edita: son la misma salvo cuando llama soporte. Y se valida aquí por
  // lo mismo que en el alta — `ROLES_VALIDOS` es la unión de los dos tipos, así
  // que sin esto un cambio de rol podía dejar la cuenta sin claims en silencio.
  if (cambios.rol && cambios.rol !== perfilObjetivo.rol) {
    exigirPuedeOtorgarRol(ambito, cambios.rol);
    if (!ROLES_CROSS.includes(cambios.rol) && perfilObjetivo.orgId) {
      await validarRolEnOrg(cambios.rol, String(perfilObjetivo.orgId));
    }
  }

  // `orgId` no está en la lista: la organización de un usuario no se cambia
  // editándolo. Mover una cuenta de organización reasigna obras, claims y
  // permisos, y sería un acto aparte si alguna vez hace falta.
  const camposPermitidos = ["nombre", "rol", "obras_asignadas", "activo"];
  const update = {};
  for (const k of camposPermitidos) {
    if (k in cambios) update[k] = cambios[k];
  }
  update.actualizadoEn = FieldValue.serverTimestamp();
  update.actualizadoPor = request.auth.token.email || "";

  // Qué obras se AGREGARON. Se calcula antes de escribir, con el documento que
  // ya se leyó: después de `set` el valor viejo se perdió. Y se calcula aquí y
  // no en el cliente —ahí existía, en el `onConfirm` del modal— porque el
  // cliente comparaba contra la copia que tenía en memoria, que es la de la
  // última recarga de la lista: si alguien más había editado al usuario en
  // medio, la diferencia salía mal y el correo nombraba obras equivocadas.
  const obrasAntes = Array.isArray(perfilObjetivo.obras_asignadas) ? perfilObjetivo.obras_asignadas : [];
  const obrasAhora = Array.isArray(update.obras_asignadas) ? update.obras_asignadas : null;
  const obrasAgregadas = obrasAhora === null
    ? []
    : obrasAhora.filter(o => o && !obrasAntes.includes(o));

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

  // ── EL CORREO DE OBRA ASIGNADA ──
  // No sale si la cuenta se está desactivando en el mismo acto: avisarle de
  // una obra nueva a quien acaba de perder el acceso es una contradicción, y
  // el correo lo mandaría a una app que lo va a rechazar.
  let correo = null;
  const quedaActivo = ("activo" in update) ? update.activo !== false : perfilObjetivo.activo !== false;
  if (obrasAgregadas.length > 0 && quedaActivo) {
    const orgObjetivo = String(perfilObjetivo.orgId || "") || null;
    const marca = await marcaDeOrg(orgObjetivo);
    const tipoOrg = orgObjetivo ? (await leerOrg(orgObjetivo))?.tipo || null : null;
    const nombres = await nombresDeObras(orgObjetivo, tipoOrg, obrasAgregadas);
    const { subject, html } = correoObraAsignada({
      marca,
      nombre: ("nombre" in update ? update.nombre : perfilObjetivo.nombre) || "",
      obras: nombres,
    });
    correo = await mandarCorreoDeAlta(RESEND_API_KEY.value(), {
      to: emailNorm, subject, html, concepto: "obra-asignada",
    });
  }

  return { ok: true, obrasAgregadas, correo };
});

// ──────────────────────────────────────────────────────────────────────────
// ELIMINAR USUARIO
// ──────────────────────────────────────────────────────────────────────────
exports.eliminarUsuario = onCall(async (request) => {
  const { email: emailLlamador, perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

  const { email } = request.data || {};
  if (!email) {
    throw new HttpsError("invalid-argument", "Falta email.");
  }
  const emailNorm = email.toLowerCase().trim();

  if (emailNorm === emailLlamador) {
    throw new HttpsError("failed-precondition", "No puedes eliminarte a ti mismo.");
  }

  // El perfil se lee ANTES de borrar nada, para poder exigir la organización.
  // Sin esto, el borrado iba directo a Auth por correo: alcanzaba a cualquier
  // cuenta del sistema, de cualquier organización.
  const perfilSnap = await admin.firestore().doc(`usuarios/${emailAId(emailNorm)}`).get();
  exigirMismaOrg(ambito, perfilSnap.exists ? perfilSnap.data() : null, emailNorm);

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
  const { perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

  const { email, nuevaPassword } = request.data || {};
  if (!email || !nuevaPassword) {
    throw new HttpsError("invalid-argument", "Falta email o nuevaPassword.");
  }
  if (nuevaPassword.length < 6) {
    throw new HttpsError("invalid-argument", "La contraseña debe tener al menos 6 caracteres.");
  }
  const emailNorm = email.toLowerCase().trim();

  // La comprobación que faltaba, y la de peor consecuencia de las cinco: esta
  // función buscaba el correo en Auth y le ponía contraseña nueva, sin mirar a
  // qué organización pertenecía. Como `ROLES_ADMIN` incluye los directivos de
  // dependencia, un director de obras de un municipio podía resetear la
  // contraseña de un director general de la constructora y entrar como él. No
  // es un hueco teórico: `onCall` se invoca desde el SDK sin pasar por la
  // interfaz, y la interfaz era el único candado.
  const perfilSnap = await admin.firestore().doc(`usuarios/${emailAId(emailNorm)}`).get();
  exigirMismaOrg(ambito, perfilSnap.exists ? perfilSnap.data() : null, emailNorm);

  const userRecord = await admin.auth().getUserByEmail(emailNorm).catch(() => null);
  if (!userRecord) {
    throw new HttpsError("not-found", "Usuario no encontrado.");
  }
  await admin.auth().updateUser(userRecord.uid, { password: nuevaPassword });
  // fix/revoke-on-password (2026-09-16): cerrar sesiones activas del usuario.
  // Sin esto, cambiar la contraseña NO invalida los JWTs vigentes: el usuario
  // sigue autenticado hasta ~1h en el dispositivo que ya tenía sesión, con la
  // contraseña vieja aún "válida" para su token. revokeRefreshTokens avanza
  // tokensValidAfterTime al momento actual; el próximo checkRevoked o refresh
  // rechaza cualquier token emitido antes.
  //
  // Nota: firebase-admin no falla si revokeRefreshTokens tiene un hiccup, pero
  // envolvemos igual para que un error transitorio no rompa el resto de la
  // respuesta. El cambio de contraseña ya se aplicó.
  let sesionesRevocadas = true;
  try {
    await admin.auth().revokeRefreshTokens(userRecord.uid);
  } catch (e) {
    console.warn(`cambiarPassword: revokeRefreshTokens falló para ${email}: ${e.message}`);
    sesionesRevocadas = false;
  }
  return { ok: true, sesionesRevocadas };
});

// ──────────────────────────────────────────────────────────────────────────
// LISTAR USUARIOS (combina Firestore + estado Auth)
// ──────────────────────────────────────────────────────────────────────────
exports.listarUsuarios = onCall(async (request) => {
  const { perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

  // Sólo la propia organización. Antes esto devolvía la colección completa:
  // nombre, correo y rol de todos los usuarios de todas las organizaciones a
  // cualquiera de los seis roles de `ROLES_ADMIN`. El padrón de personal de un
  // cliente no es dato de otro cliente.
  //
  // El filtro va en la consulta y no sobre el resultado: así los documentos de
  // las otras organizaciones no llegan ni a leerse.
  if (!ambito.cross && !ambito.orgId) {
    throw new HttpsError(
      "failed-precondition",
      "Tu perfil no tiene organización asignada; no puedes gestionar usuarios."
    );
  }
  const col = admin.firestore().collection("usuarios");
  const snap = await (ambito.cross ? col.get() : col.where("orgId", "==", ambito.orgId).get());
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
// v4 (2026-10-28): una semana a caballo entre dos meses se suma en vez de
// pisarse. La caché v3 trae la serie semanal corta y NO se puede reaprovechar:
// subir el número es lo que hace que el front la rechace y pida Refrescar en
// vez de seguir pintando cifras que ya se sabe que faltan.
//
// v5 (2026-10-30): el gasto ya no viene de la hoja que Luis refresca a mano,
// viene de la consulta por obra (ver «GP POR OBRA» más abajo). Las cifras
// CAMBIAN —la caché v4 está congelada al viernes 23 de octubre y le faltan
// $6,960,926.22— y el documento ya no trae `colMap`, porque no hay columnas.
// Por lo mismo que en v4: la caché vieja no se reaprovecha, se rechaza.
const PARSER_VERSION = 5;

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
      // Los totales MENSUALES no se resuelven aquí. Se parecen a los anuales
      // pero no lo son: "Total 1 .- Enero" aparece UNA VEZ POR AÑO en la misma
      // fila, y quedarse con la primera es quedarse con la de 2024. Ver el
      // bloque por año más abajo.
      // %
      if (c === '%' && colMap.pct === undefined) colMap.pct = ci;
    });
  }

  // Construir mapa de semanas del AÑO ACTUAL (2026)
  // Las semanas se repiten por año, así que solo nos quedamos con las de la última instancia
  // (asumiendo que el orden de columnas es 2024 → 2025 → 2026)
  // {año: {semana: [ci, ...]}} — LISTA de columnas, no una sola. La hoja es
  // una tabla dinámica agrupada por mes, y una semana de calendario que cruza
  // el cambio de mes sale PARTIDA EN DOS COLUMNAS: la última del mes que
  // termina y la primera del que empieza. Guardando un solo índice, la segunda
  // columna PISABA a la primera y su dinero desaparecía de la serie semanal
  // —sólo de ésa: meses, años y Total general salían bien, que es por lo que
  // nadie lo vio en producción.
  //
  // No es un caso raro ni nuevo: en la hoja del 2026-10-28 pasa 5 veces en
  // 2026 (S14 S18 S27 S36 S40), 5 en 2025 y 6 en 2024, SIEMPRE en frontera de
  // mes. Medido ese día, eran $9,719,396.98 invisibles en las cinco obras
  // activas y $15,409,486.89 en las 34 de la hoja; la 0127 sola perdía
  // $3,118,966.24 y su velocidad semanal salía 26.7% baja.
  const weekColsByYear = {};
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
          if (!weekColsByYear[añoActual][n]) weekColsByYear[añoActual][n] = [];
          weekColsByYear[añoActual][n].push(ci);
        }
      }
    }
  }
  // Totales MENSUALES, con el año que les toca. Misma técnica que las semanas
  // y por la misma razón: la fila de meses repite "Total 1 .- Enero" una vez
  // por año, y el bloque de arriba se quedaba con la primera aparición —la de
  // 2024— guardándola como `total_month_2026_01`. No era un desfase pequeño:
  // medido el 2026-10-27 contra la hoja real, los doce meses «de 2026» de la
  // obra 0099 sumaban $20,119,989.65, que es EXACTAMENTE su total de 2024, y
  // la hoja ni siquiera tenía noviembre ni diciembre de 2026. Importa porque
  // `extraerGastoTotalGP` cae a la suma de meses cuando no hay total anual:
  // una obra sin total habría enseñado el gasto de otro año como si fuera suyo.
  const mesColsByYear = {};
  if (monthRow >= 0) {
    const porColumna = Object.entries(yearCols).sort((a, b) => a[1] - b[1]);
    let año = null, cur = 0;
    for (let ci = 0; ci < lines[monthRow].length; ci++) {
      while (cur < porColumna.length && ci >= porColumna[cur][1]) { año = porColumna[cur][0]; cur++; }
      const c = (lines[monthRow][ci] || '').trim();
      const m = c.match(/total\s+(?:\d+\s*[.\-]+\s*)?([a-záéíóú]+)/i);
      if (!m || !año) continue;
      const mes = MESES[normalize(m[1])];
      if (!mes) continue;
      if (!mesColsByYear[año]) mesColsByYear[año] = {};
      if (mesColsByYear[año][mes] === undefined) mesColsByYear[año][mes] = ci;
    }
  }
  // Tomar las semanas del año más reciente como las "semanas disponibles" del Sheet
  const añoMasReciente = Object.keys(weekColsByYear).sort().pop() || '2026';
  const weekColsActual = weekColsByYear[añoMasReciente] || {};
  // El valor de una entrada `week_*` es una LISTA de columnas. Las demás
  // entradas de `colMap` siguen siendo un índice suelto: una semana es lo
  // único que la hoja puede repartir en varias columnas.
  Object.entries(weekColsActual).forEach(([n, cols]) => {
    colMap[`week_${añoMasReciente}_${n}`] = cols;
  });

  // Sólo los meses del año en curso, igual que las semanas. Emitir los tres años
  // triplicaría `meses` en cada obra, rubro y proveedor de `gp_detalle` —que ya
  // pesa unos 3 MB— y la pantalla sigue leyendo doce meses, no treinta y seis.
  const mesColsActual = mesColsByYear[añoMasReciente] || {};
  Object.entries(mesColsActual).forEach(([mes, ci]) => {
    colMap[`total_month_${añoMasReciente}_${mes}`] = ci;
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
    // Saltar totales y secciones. El filtro de totales NO puede ser «empieza con
    // total»: hay un proveedor real llamado TOTAL PLAY TELECOMUNICACIONES, y por
    // tirarlo la tabla de rubros de dos obras no cuadraba con su propio total
    // (0001 por $37,092.90 y 0037 por $35,988.79, medido contra la hoja el
    // 2026-10-27). Un renglón de agregado dice «Total general» o «Total <código>»;
    // un proveedor dice su nombre. Se pide esa forma, no el prefijo suelto.
    if (/^(grand\s*total|total\s+general)$/i.test(label)) continue;
    if (/^total\s+\d/i.test(label)) continue;
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

      // Semanas (del año actual). Una semana puede venir en varias columnas
      // —ver `weekColsByYear`— y entonces su gasto es la SUMA de todas, no la
      // de la última. Se toma el valor absoluto columna por columna, igual que
      // en meses y años, para no cambiar de criterio a media cuenta.
      const semanas = {};
      Object.entries(colMap).filter(([k]) => k.startsWith('week_')).forEach(([k, cols]) => {
        const partes = k.split('_'); // ['week', '2026', '22']
        let suma = 0;
        for (const ci of cols) {
          const v = parseMonto(row[ci]);
          if (!isNaN(v)) suma += Math.abs(v);
        }
        if (suma !== 0) semanas[`S${partes[2]}`] = suma;
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
      // RUBRO: empieza con 3 dígitos. La clave es la ETIQUETA COMPLETA, no el
      // código, porque el código SE REPITE: 14 de las 34 obras de la hoja
      // traen «300 INDIRECTOS» y «300 SUBCONTRATOS». Indexando por «300», el
      // segundo rubro nunca se creaba —el `if` de abajo lo daba por existente—
      // y todos sus proveedores se colgaban del primero. El resultado no era
      // un hueco, que se nota: era una etiqueta falsa. En la 0112 había
      // $1,308,275.55 de subcontratos escritos «INDIRECTOS», y en la 0114
      // $2,487,929.25, y la tabla de rubros no sumaba su propio total.
      // El `id` sigue siendo el código, que es lo que la hoja dice.
      curRubro = label;
      if (!obras[curObra].rubros[curRubro]) {
        const vals = extraerValores();
        obras[curObra].rubros[curRubro] = {
          id: label.slice(0, 3), nombre: label, nombreCorto: label.slice(4).trim(),
          semanas: vals.semanas, meses: vals.meses, años: vals.años,
          total2026: vals.total2026, grandTotal: vals.grandTotal,
          proveedores: [],
        };
      }
    } else if (curObra && curRubro) {
      // PROVEEDOR. Antes esta rama exigía que el nombre NO empezara con
      // dígito, y así se perdía en silencio «3.1 SWEET INMOBILIARIA Y
      // DESARROLLADORA DE PROYECTOS, S.A. DE C.V.» con $22,000 en la 0099.
      // El guardia sobraba: las obras y los rubros ya se llevaron sus
      // etiquetas en las ramas de arriba, los totales y las secciones se
      // saltan antes, y un renglón sin dinero se descarta dos líneas abajo.
      // Un proveedor que se llama con un número sigue siendo un proveedor.
      const vals = extraerValores();
      const totalProv = vals.grandTotal > 0
        ? vals.grandTotal
        : Object.values(vals.años).reduce((t,v)=>t+v,0);
      if (totalProv === 0) continue;
      const prov = {
        nombre: label, rubroId: obras[curObra].rubros[curRubro].id,
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
    // Quién escribió este número. Antes decía 'cloud-function', que no
    // distinguía nada: las dos fuentes son cloud functions. Lo que hay que
    // poder leer en la pantalla es si la cifra vino de la hoja de Luis
    // —congelada en su último refresco— o de la consulta por obra.
    fuente: 'hoja-gp',
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

// ════════════════════════════════════════════════════════════════════════════
// GP POR OBRA — la consulta viva en lugar del pivote congelado
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. La hoja de arriba es un pivote que Luis Mayo refresca a mano. Medido
// el 2026-10-30 contra la misma consulta que la alimenta, la hoja estaba
// cerrada al VIERNES 23 de octubre: CAMPO no mostraba $6,960,926.22 de gasto
// del 26 al 29. El 1% que llevábamos semanas persiguiendo no era un error de
// cuentas, era retraso de captura. Pedir el dato a su origen lo quita de raíz.
//
// LA HOJA ES, LITERALMENTE, ESTE PIVOTE. Medido el 2026-11-02 sobre las obras
// 0126 y 0127, agrupando los renglones por `DesProy` → `AgrConce` →
// `Nombre_Beneficiario` y sumando `ImporteDisSIva`:
//
//   · 0127: $34,863,896.41 contra $34,863,896.41. Los 4 rubros al centavo, los
//     66 proveedores al centavo, las 20 semanas y los 5 meses al centavo.
//   · 0126: los 4 rubros y 116 de 117 proveedores al centavo. El único que
//     difería —NR FINANCE MEXICO, $28,357.66— son cinco renglones con fecha
//     15-oct que la API YA TENÍA y la hoja nunca vio. La API no sobraba: la
//     hoja faltaba.
//
// Así que esto no es una fuente nueva con otra aritmética. Es la misma cuenta
// sin el retraso, y por eso el banco `scripts/prueba-agrupador-gp.cjs` exige
// que las dos den lo mismo renglón por renglón.
//
// LO QUE EL SERVIDOR IMPONE AL DISEÑO (medido, no supuesto):
//
//   · El token es DE UN SOLO USO y además un login nuevo INVALIDA el anterior.
//     Pedir dos obras en paralelo devuelve HTTP 500 en la que llegue segunda.
//     De ahí que el recorrido sea estrictamente EN SERIE, con su propio login
//     por obra. No es prudencia: es lo único que funciona.
//   · El servidor PIENSA ~9.8 s y baja en ~2.6 s. Lo que hay que recortar es
//     trabajo del servidor, no ancho de banda; ya manda brotli y no respeta
//     `If-None-Match`, así que no hay nada que cachear del lado del cliente.
//   · Pedir TODO son 52.69 MB y 228 MB de heap: no cabe en una función de
//     256 MiB. Las cinco obras de CAMPO son 5.07 MB, 32.5 s y 14 MB de heap.
//
// LA TRAMPA QUE CUESTA DINERO. El agrupador por obra tiene que ser el PREFIJO
// DE CUATRO DÍGITOS DE `DesProy`, nunca `ENumProy`. Son dos numeraciones
// distintas y no se corresponden: medido sobre los 46,367 renglones del
// 2026-10-30, `ENumProy` 0001 aparece en 21 obras distintas y 29 de los 67
// valores los comparten varias obras. Agrupar por ahí no deja un hueco que se
// note: mete el gasto de una obra en otra y la cifra sigue siendo creíble.
// Eso es lo que la contraprueba del banco pone en rojo.

const GP_API_BASE = "https://fosedy.org";
const GP_API_EMPRESA = 1;
// Credenciales de sólo lectura del reporte de cheques por obra. Nunca van en el
// front —desde el navegador serían públicas— ni en el repositorio. Se cargan con:
//   firebase functions:secrets:set GP_USUARIO
//   firebase functions:secrets:set GP_PASSWORD
const GP_USUARIO = defineSecret("GP_USUARIO");
const GP_PASSWORD = defineSecret("GP_PASSWORD");
// Respiro entre obras. El servidor es el de contabilidad de la empresa y lo
// está usando gente: cinco ráfagas seguidas sin pausa no le hacen falta a nadie
// cuando el recorrido completo ya dura medio minuto.
const GP_PAUSA_MS = 400;

const dormirGP = (ms) => new Promise((r) => setTimeout(r, ms));

// `Mes` viene como "10 .- Octubre" en los 46,367 renglones medidos. Se lee el
// número de adelante, no el nombre: el nombre trae acentos y el número es el
// que ordena.
function mesDeRenglonGP(valor) {
  const m = /^\s*(\d{1,2})\b/.exec(String(valor == null ? "" : valor));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return String(n).padStart(2, "0");
}

function semanaDeRenglonGP(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 53) return null;
  return String(n);
}

// ── EL NÚCLEO: renglones crudos → la misma forma que saca el parser de la hoja ──
//
// Devuelve exactamente el contrato de `parsearGPConstruct` (obras, cada una con
// sus rubros y proveedores, y las series por semana, mes y año), más un bloque
// `descartes` con lo que no se pudo clasificar. Los descartes se CUENTAN y se
// publican; callarlos convertiría un renglón ilegible en dinero desaparecido.
//
// Es una función pura a propósito: es lo único de este camino que se puede
// medir sin red y contra la hoja.
function agruparRenglonesGP(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  const monto = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.abs(n) : 0; };
  const texto = (v) => String(v == null ? "" : v).trim();

  const descartes = {
    renglones: lista.length,
    sinObra: 0, montoSinObra: 0,
    sinRubro: 0, montoSinRubro: 0,
    sinProveedor: 0,
    sinAño: 0, sinMes: 0, sinSemana: 0,
    proveedoresEnCero: 0,
  };

  // El año más reciente manda, igual que en la hoja: `semanas` y `meses` son
  // sólo de ese año. Publicar los siete años que arrastra una obra
  // multiplicaría `gp_detalle` por siete y la pantalla sigue leyendo doce meses.
  let añoMasReciente = null;
  for (const fila of lista) {
    const a = Number(fila && fila.Amo);
    if (!Number.isInteger(a)) continue;
    if (añoMasReciente === null || a > añoMasReciente) añoMasReciente = a;
  }

  const obras = {};
  const semanasVistas = new Set();
  const mesesVistos = new Set();

  for (const fila of lista) {
    if (!fila) continue;
    const etiquetaObra = texto(fila.DesProy);
    const importe = monto(fila.ImporteDisSIva);
    // Sin prefijo de 4 dígitos no hay obra a la que colgar el gasto. Medido:
    // 16 renglones de 46,367, $69,981.48, todos de 2020-2024 salvo uno de 2026
    // en cero. Van al contador, no al olvido.
    if (!/^\d{4}\s/.test(etiquetaObra)) {
      descartes.sinObra++; descartes.montoSinObra += importe; continue;
    }
    const etiquetaRubro = texto(fila.AgrConce);
    if (!etiquetaRubro) {
      descartes.sinRubro++; descartes.montoSinRubro += importe; continue;
    }
    const nombreProv = texto(fila.Nombre_Beneficiario);
    if (!nombreProv) { descartes.sinProveedor++; continue; }

    const año = Number(fila.Amo);
    const tieneAño = Number.isInteger(año);
    if (!tieneAño) descartes.sinAño++;
    const esAñoVivo = tieneAño && año === añoMasReciente;
    const mes = esAñoVivo ? mesDeRenglonGP(fila.Mes) : null;
    const semana = esAñoVivo ? semanaDeRenglonGP(fila.Semana) : null;
    if (esAñoVivo && !mes) descartes.sinMes++;
    if (esAñoVivo && !semana) descartes.sinSemana++;
    const claveAño = tieneAño ? `Y${año}` : null;
    const claveMes = mes ? `M${año}-${mes}` : null;
    const claveSem = semana ? `S${semana}` : null;
    if (claveMes) mesesVistos.add(claveMes);
    if (claveSem) semanasVistas.add(claveSem);

    // La clave del rubro es la ETIQUETA COMPLETA, no el código de 3 dígitos.
    // Mismo motivo que en la hoja: «300 INDIRECTOS» y «300 SUBCONTRATOS»
    // conviven —medido, 19,374 y 929 renglones— y el código no distingue.
    let obra = obras[etiquetaObra];
    if (!obra) {
      obra = obras[etiquetaObra] = {
        id: etiquetaObra.slice(0, 4), nombre: etiquetaObra,
        semanas: {}, meses: {}, años: {},
        total2026: 0, grandTotal: 0,
        rubros: {}, proveedores: [],
      };
    }
    let rubro = obra.rubros[etiquetaRubro];
    if (!rubro) {
      rubro = obra.rubros[etiquetaRubro] = {
        id: etiquetaRubro.slice(0, 3), nombre: etiquetaRubro,
        nombreCorto: etiquetaRubro.slice(4).trim(),
        semanas: {}, meses: {}, años: {},
        total2026: 0, grandTotal: 0,
        proveedores: [],
      };
    }
    // El proveedor cuelga del rubro, no de la obra: el mismo nombre en dos
    // rubros son dos renglones distintos en la hoja y aquí también.
    let prov = rubro.proveedores.find((p) => p.nombre === nombreProv);
    if (!prov) {
      prov = {
        nombre: nombreProv, rubroId: rubro.id, rubroNombre: rubro.nombreCorto,
        semanas: {}, meses: {}, años: {},
        total2026: 0, grandTotal: 0, total: 0,
      };
      rubro.proveedores.push(prov);
      obra.proveedores.push(prov);
    }

    for (const n of [obra, rubro, prov]) {
      n.grandTotal += importe;
      if (claveAño) n.años[claveAño] = (n.años[claveAño] || 0) + importe;
      if (claveMes) n.meses[claveMes] = (n.meses[claveMes] || 0) + importe;
      if (claveSem) n.semanas[claveSem] = (n.semanas[claveSem] || 0) + importe;
    }
  }

  // Cierre: el total del año vivo y la poda de los que no movieron dinero.
  // La hoja tampoco los lista —el parser descarta al proveedor cuyo total es
  // cero— y hay 170 renglones en cero entre los 46,367, así que un proveedor
  // que sólo tenga de esos existiría aquí y no allá.
  const claveAñoVivo = añoMasReciente === null ? null : `Y${añoMasReciente}`;
  // Un renglón en cero no debe DEJAR UNA CLAVE EN CERO. La hoja descarta la
  // celda cuyo valor es 0 (`v !== 0` en `extraerValores`), así que publicar
  // aquí un `S1: 0` que allá no existe haría que las dos fuentes difirieran en
  // la forma sin diferir en el dinero — y el banco que las compara se pondría
  // rojo por algo que no le importa a nadie.
  const podarCeros = (nodo) => {
    for (const serie of [nodo.años, nodo.meses, nodo.semanas]) {
      for (const k of Object.keys(serie)) if (serie[k] === 0) delete serie[k];
    }
  };
  for (const obra of Object.values(obras)) {
    for (const rubro of Object.values(obra.rubros)) {
      const vivos = rubro.proveedores.filter((p) => p.grandTotal !== 0);
      descartes.proveedoresEnCero += rubro.proveedores.length - vivos.length;
      rubro.proveedores = vivos;
      for (const p of vivos) {
        podarCeros(p);
        p.total2026 = claveAñoVivo ? (p.años[claveAñoVivo] || 0) : 0;
        p.total = p.grandTotal;
      }
      podarCeros(rubro);
      rubro.total2026 = claveAñoVivo ? (rubro.años[claveAñoVivo] || 0) : 0;
    }
    obra.proveedores = obra.proveedores.filter((p) => p.grandTotal !== 0);
    podarCeros(obra);
    obra.total2026 = claveAñoVivo ? (obra.años[claveAñoVivo] || 0) : 0;
  }

  const semanasDisponibles = [...semanasVistas]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const mesesDisponibles = [...mesesVistos].sort();

  return {
    obras,
    semanasDisponibles,
    ultimaSemana: semanasDisponibles[semanasDisponibles.length - 1] || "",
    mesesDisponibles,
    ultimoMes: mesesDisponibles[mesesDisponibles.length - 1] || "",
    totalObras: Object.keys(obras).length,
    añoVivo: añoMasReciente,
    descartes,
  };
}

// ── Transporte: un login por llamada, porque el token no da para dos ──
async function entrarGPApi(usuario, password) {
  const r = await fetch(`${GP_API_BASE}/usuarios/login`, {
    method: "POST",
    headers: { usuario, password, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`login en GP: HTTP ${r.status}`);
  const j = await r.json();
  if (!j || !j.token) throw new Error("login en GP: respuesta sin token");
  return j.token;
}

async function pedirObraGP(clave, usuario, password) {
  // La ruta quiere el número SIN ceros a la izquierda: /1/126, no /1/0126.
  const num = Number(clave);
  if (!Number.isInteger(num) || num <= 0) throw new Error(`clave de obra inválida: ${clave}`);
  const token = await entrarGPApi(usuario, password);
  const r = await fetch(`${GP_API_BASE}/reportes/chequesObra/${GP_API_EMPRESA}/${num}`, {
    headers: { Authorization: token, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`obra ${clave}: HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`obra ${clave}: la respuesta no es una lista`);
  return j;
}

// ── Qué obras se piden: las que CAMPO tiene, no las 67 de la contabilidad ──
// Son 5 contra 67. Pedir las 67 serían ~7 minutos y 52 MB para alimentar cinco
// pantallas. Una obra de CAMPO sin clave de GP no se inventa: se devuelve en
// `sinClave` para que el panel pueda decir cuál es.
async function clavesGPdeCAMPO() {
  const snap = await admin.firestore().collection("obras").get();
  const claves = new Set();
  const sinClave = [];
  for (const doc of snap.docs) {
    const info = doc.data() || {};
    const explicita = String(info.gpId || "").trim();
    const porId = /^\d{4}/.test(doc.id) ? doc.id.slice(0, 4) : null;
    const clave = explicita || porId;
    if (clave && /^\d{4}$/.test(clave)) claves.add(clave);
    else sinClave.push({ obraId: doc.id, nombre: String(info.nombre || "") });
  }
  return { claves: [...claves].sort(), sinClave };
}

// ── La corrida: en serie, y una obra que falla no borra a las demás ──
//
// Si la 0114 se cae a media corrida, lo que NO puede pasar es que su gasto
// aparezca en cero: cero es una afirmación sobre el dinero, y falsa. Se arrastra
// lo que esa obra tenía en el resumen anterior y se marca `desactualizadaDesde`,
// de modo que la pantalla pueda decir «esta obra es de ayer» en vez de mentir.
async function descargarYGuardarGPPorObra(credenciales = {}) {
  const usuario = credenciales.usuario || process.env.GP_USUARIO;
  const password = credenciales.password || process.env.GP_PASSWORD;
  if (!usuario || !password) throw new Error("faltan las credenciales de GP (GP_USUARIO / GP_PASSWORD)");

  const { claves, sinClave } = await clavesGPdeCAMPO();
  if (claves.length === 0) throw new Error("ninguna obra de CAMPO tiene clave de GP");

  const db = admin.firestore();
  const previoSnap = await db.doc("global/gp_construct").get();
  const previo = previoSnap.exists ? (previoSnap.data() || {}) : {};
  const obrasPrevias = previo.obras || {};

  const renglones = [];
  const fallos = [];
  for (const clave of claves) {
    try {
      const filas = await pedirObraGP(clave, usuario, password);
      for (const f of filas) renglones.push(f);
    } catch (e) {
      console.error(`GP por obra: falló ${clave}: ${e.message}`);
      fallos.push({ clave, error: e.message });
    }
    await dormirGP(GP_PAUSA_MS);
  }
  if (renglones.length === 0) {
    throw new Error(`ninguna de las ${claves.length} obras respondió: ` +
      fallos.map((f) => `${f.clave} ${f.error}`).join(" · "));
  }

  const agrupado = agruparRenglonesGP(renglones);
  const ahora = new Date().toISOString();

  // Resumen: lo que el front baja al entrar. Mismas claves que el camino de la
  // hoja, para que la pantalla no tenga que saber de dónde vino el dato — salvo
  // `fuente`, que sí tiene que poder decirlo.
  const obrasResumen = {};
  for (const [key, val] of Object.entries(agrupado.obras)) {
    obrasResumen[key] = {
      id: val.id, nombre: val.nombre,
      grandTotal: val.grandTotal, total2026: val.total2026,
      años: val.años, meses: val.meses, semanas: val.semanas,
      numRubros: Object.keys(val.rubros || {}).length,
      numProveedores: (val.proveedores || []).length,
    };
  }
  // Arrastre de las que fallaron: su cifra anterior, marcada como vieja.
  const arrastradas = [];
  for (const { clave } of fallos) {
    const anterior = Object.values(obrasPrevias).find((o) => o && o.id === clave);
    if (!anterior) continue;
    obrasResumen[anterior.nombre || clave] = {
      ...anterior,
      desactualizadaDesde: previo.ultimaActualizacion || null,
    };
    arrastradas.push(clave);
  }

  const resumen = {
    parserVersion: PARSER_VERSION,
    ultimaActualizacion: ahora,
    fuente: "api-gp-por-obra",
    semanasDisponibles: agrupado.semanasDisponibles,
    ultimaSemana: agrupado.ultimaSemana,
    mesesDisponibles: agrupado.mesesDisponibles,
    ultimoMes: agrupado.ultimoMes,
    totalObras: Object.keys(obrasResumen).length,
    añoVivo: agrupado.añoVivo,
    // Diagnóstico, no adorno: con esto el panel puede decir qué se pidió, qué
    // contestó y qué se quedó sin clasificar, sin que nadie tenga que suponerlo.
    obrasPedidas: claves,
    obrasConError: fallos,
    obrasArrastradas: arrastradas,
    obrasSinClaveGP: sinClave,
    renglonesLeidos: renglones.length,
    descartes: agrupado.descartes,
    obras: obrasResumen,
  };
  await db.doc("global/gp_construct").set(resumen);

  // Detalle por obra. Sólo se escriben las que SÍ contestaron: el documento de
  // una obra que falló se deja intacto, que es más honesto que vaciarlo.
  let batch = db.batch();
  let pendientes = 0;
  for (const val of Object.values(agrupado.obras)) {
    batch.set(db.doc(`global/gp_detalle/obras/${val.id}`), {
      parserVersion: PARSER_VERSION,
      ultimaActualizacion: ahora,
      fuente: "api-gp-por-obra",
      id: val.id, nombre: val.nombre,
      grandTotal: val.grandTotal, total2026: val.total2026,
      años: val.años, meses: val.meses, semanas: val.semanas,
      rubros: val.rubros, proveedores: val.proveedores,
    });
    pendientes++;
    if (pendientes >= 400) { await batch.commit(); batch = db.batch(); pendientes = 0; }
  }
  if (pendientes > 0) await batch.commit();

  return { ...agrupado, obrasPedidas: claves, obrasConError: fallos, renglonesLeidos: renglones.length };
}

// ════════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO: qué obras EXISTEN — que no es la misma pregunta que cuánto gastaron
// ════════════════════════════════════════════════════════════════════════════
//
// Nace de un defecto que el cambio de arriba introdujo. El alta de obra del
// lado constructora obliga a escoger primero una obra de GP, y esa lista salía
// de `global/gp_construct`, que es el documento de GASTO. Mientras el gasto
// venía de la hoja había 34 obras ahí y la lista alcanzaba de casualidad. Desde
// que el gasto se pide obra por obra sólo quedan las que CAMPO ya tiene —cinco—
// y dar de alta una obra NUEVA se vuelve imposible: la que falta no está en la
// lista porque no está en CAMPO, y no está en CAMPO porque no se puede dar de
// alta. El círculo es cerrado, y no da ningún error: una lista corta no parece
// una lista mutilada.
//
// El arreglo no es ampliar la lista del gasto —eso serían siete minutos de
// llamadas para alimentar un selector— es separar las dos preguntas. «Qué obras
// existen» se contesta con el recorrido completo, UNA llamada, y sale un
// documento chico.
//
// Va SIN DINERO a propósito. El catálogo sirve para escoger; el gasto de una
// obra que todavía no está en CAMPO no tiene a quién pertenecer, y publicarlo
// en un documento aparte sería una segunda cuenta del mismo número.
const CATALOGO_GP_VERSION = 1;

// Pura. El nombre que gana es el del cheque MÁS RECIENTE, no el más repetido:
// una obra que se renombró arrastra cientos de renglones con el nombre viejo y
// unos pocos con el nuevo, y el que hay que enseñar para escogerla hoy es el
// nuevo. Empate de fecha → el más repetido; eso es un desempate, no la regla.
//
// Medido el 2026-11-02 sobre los 46,470 renglones del recorrido completo: 67
// obras con clave de 4 dígitos, 16 renglones sin clave, ninguna obra con dos
// grafías. `obrasRenombradas` existe para que el día que aparezca una no haya
// que adivinar cuál nombre se escogió.
function catalogoDeRenglonesGP(filas) {
  const lista = Array.isArray(filas) ? filas : [];
  const porId = new Map();
  let sinClave = 0;

  for (const fila of lista) {
    const etiqueta = String(fila && fila.DesProy != null ? fila.DesProy : "").trim();
    const m = /^(\d{4})\s+(\S.*)$/.exec(etiqueta);
    if (!m) { sinClave++; continue; }
    const id = m[1];
    const nombre = m[2].trim();
    const fecha = String((fila && fila.F_Cheque) || "").slice(0, 10);
    let e = porId.get(id);
    if (!e) { e = { id, nombres: new Map(), ultimoCheque: "" }; porId.set(id, e); }
    const g = e.nombres.get(nombre) || { cuenta: 0, ultima: "" };
    g.cuenta++;
    if (fecha > g.ultima) g.ultima = fecha;
    e.nombres.set(nombre, g);
    if (fecha > e.ultimoCheque) e.ultimoCheque = fecha;
  }

  const obrasRenombradas = [];
  const obras = [...porId.values()].map((e) => {
    const candidatos = [...e.nombres.entries()].sort((a, b) => {
      if (a[1].ultima !== b[1].ultima) return a[1].ultima < b[1].ultima ? 1 : -1;
      if (a[1].cuenta !== b[1].cuenta) return b[1].cuenta - a[1].cuenta;
      return a[0].localeCompare(b[0]);
    });
    if (candidatos.length > 1) {
      obrasRenombradas.push({ id: e.id, grafias: candidatos.map((c) => c[0]) });
    }
    return { id: e.id, nombre: candidatos[0][0], ultimoCheque: e.ultimoCheque };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return { obras, renglonesLeidos: lista.length, renglonesSinClave: sinClave, obrasRenombradas };
}

// El recorrido completo: obra 0 quiere decir «todas». 46,470 renglones y 12.8 s
// medidos; el proceso llega a 228 MB, de ahí los 512 MiB del exportado.
async function pedirTodoGP(usuario, password) {
  const token = await entrarGPApi(usuario, password);
  const r = await fetch(`${GP_API_BASE}/reportes/chequesObra/${GP_API_EMPRESA}/0`, {
    headers: { Authorization: token, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`recorrido completo: HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error("recorrido completo: la respuesta no es una lista");
  return j;
}

async function descargarYGuardarCatalogoGP(credenciales = {}) {
  const usuario = credenciales.usuario || process.env.GP_USUARIO;
  const password = credenciales.password || process.env.GP_PASSWORD;
  if (!usuario || !password) throw new Error("faltan las credenciales de GP (GP_USUARIO / GP_PASSWORD)");

  const filas = await pedirTodoGP(usuario, password);
  const cat = catalogoDeRenglonesGP(filas);
  // Un catálogo vacío pisaría el bueno y dejaría el alta de obra sin lista —que
  // es justo el defecto que este documento viene a cerrar. Credencial mala,
  // respuesta rara o formato cambiado tienen que terminar en una corrida en
  // rojo con el catálogo de la semana pasada intacto, no en una lista vacía que
  // parece una lista.
  if (cat.obras.length === 0) {
    throw new Error(`el recorrido trajo ${cat.renglonesLeidos} renglones y ` +
      "ninguna obra con clave de 4 dígitos: no se pisa el catálogo anterior");
  }

  await admin.firestore().doc("global/gp_catalogo").set({
    catalogoVersion: CATALOGO_GP_VERSION,
    ultimaActualizacion: new Date().toISOString(),
    fuente: "api-gp-completo",
    totalObras: cat.obras.length,
    renglonesLeidos: cat.renglonesLeidos,
    renglonesSinClave: cat.renglonesSinClave,
    obrasRenombradas: cat.obrasRenombradas,
    obras: cat.obras,
  });
  return cat;
}

// ── HEALTH TRACKING ─────────────────────────────────────────────
// Registra el resultado de cada ejecución de un cron job en Firestore
// para que el Panel de Salud pueda monitorear el estado del sistema.
// Path: global/health = { [tipo]: { ultimaEjecucion, ok, mensaje, duracionMs, meta } }
//
// ── POR QUÉ YA NO SE TRAGA SU PROPIO FALLO (P7, quinta aparición) ──────────
// Hasta el 2026-10-23 esto terminaba en `catch { console.warn("fallo
// silencioso") }`. El nombre lo decía y aun así se quedó: el instrumento con
// el que nos enteramos de que algo se cayó era de los que no avisan.
//
// Lo que producía no era "no se registró". Era PEOR, porque las dos mitades
// decían cosas distintas:
//
//  · Cloud Scheduler marcaba la corrida como EXITOSA —la función terminó sin
//    lanzar—, así que quien mira la consola de Functions ve verde.
//  · `global/health` se quedaba con el registro anterior, así que la pantalla
//    de salud, pasado el plazo, decía «sin correr» en rojo.
//
// Y «sin correr» es una AFIRMACIÓN SOBRE EL DATO que en ese caso es falsa: sí
// corrió, lo que no se pudo fue anotarlo. Son dos averías con dos reacciones
// distintas —revisar el cron contra revisar los permisos de escritura— y el
// silencio las volvía indistinguibles.
//
// Ahora lanza. En el camino de éxito eso hace fallar la invocación, que es lo
// correcto: un trabajo cuyo resultado no se pudo registrar no terminó bien,
// porque nadie se va a enterar de que terminó. Para el camino de fallo está
// `registrarFalloDeSalud`, que conserva el error original.
async function registrarSalud(tipo, ok, mensaje, meta = {}) {
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
  // `mergeFields` y no `merge:true`, y sin volver a escribir `actual`.
  //
  // `set({...actual, [tipo]: entry}, {merge:true})` hace merge PROFUNDO: el
  // mapa nuevo se funde campo por campo con el viejo en vez de sustituirlo.
  // Medido el 2026-10-23: tras una corrida buena que dejó
  // `permisos_denegados.denegaciones = 1`, la siguiente corrida FALLIDA —que
  // no contó nada— quedaba con `ok:false` y ese `denegaciones:1` encima. Un
  // registro que mezcla dos corridas y presenta como cifra de ésta la que
  // midió la anterior. Es el mismo defecto que este trabajo vino a cerrar,
  // puesto en el renglón que lo reporta.
  //
  // De paso quita el `...actual`: reescribir el documento entero machacaba lo
  // que otro cron hubiera anotado entre la lectura y la escritura.
  await ref.set({
    [tipo]: entry,
    [`${tipo}_historial`]: hist,
  }, { mergeFields: [tipo, `${tipo}_historial`] });
}

/**
 * El registro de salud del camino de FALLO.
 *
 * Ahí el trabajo ya va a reventar y el error original es el que explica qué
 * pasó: perderlo cambiaría un diagnóstico por otro. Pero tragarse el segundo
 * fallo nos devuelve al defecto que `registrarSalud` acaba de dejar de tener.
 *
 * Así que salen los dos en el mismo error, con `cause` apuntando al original
 * para que la cadena quede entera.
 */
async function registrarFalloDeSalud(tipo, error, meta = {}) {
  const original = error?.message || String(error);
  try {
    await registrarSalud(tipo, false, original, meta);
  } catch (e2) {
    throw new Error(
      `${original} · y además no se pudo registrar la salud de ${tipo}: ` +
      `${e2?.message || e2}`, { cause: error });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// LAS DENEGACIONES QUE NO SABEMOS EXPLICAR
// ════════════════════════════════════════════════════════════════════════════
// El front, cuando las reglas le niegan una escritura y el usuario SÍ tiene la
// obra en sus claims (el caso 3 de `src/permiso-denegado.js`), escribe una fila
// `tipo:"error_permiso"` en la bitácora. Esa fila es el único rastro de un
// defecto que el usuario no puede corregir y que nosotros no sabemos explicar.
//
// Escribirla no es enterarse. La bitácora es un flujo cronológico de actividad
// normal —4,201 filas al 2026-10-23— y una fila nuestra entre ellas sólo
// existe si a alguien se le ocurre bajar a buscarla. Por eso hay dos empujones
// y no uno: este trabajo diario la pone en el semáforo, y el resumen semanal
// la manda por correo. El semáforo da el ESTADO; el correo da el AVISO. Un
// semáforo que nadie abre no entera a nadie.
//
// ── POR QUÉ NO ES UNA CONSULTA DE GRUPO DE COLECCIÓN ───────────────────────
// Desde el #73 la bitácora está partida: `auditoria` en la raíz y
// `orgs/{oid}/auditoria` por organización. Lo natural sería
// `collectionGroup("auditoria")`. Medido contra PRODUCCIÓN el 2026-10-23, las
// tres variantes fallan con `FAILED_PRECONDITION`:
//
//   collectionGroup(auditoria).where(tsServidor > x)        → falta COLLECTION_GROUP_ASC
//   collectionGroup(auditoria).where(tipo ==).where(ts > x) → falta índice compuesto
//   collectionGroup(auditoria).where(tipo == x)             → falta COLLECTION_GROUP_ASC
//
// Los índices de un solo campo que Firestore crea solo son de alcance
// COLECCIÓN, no de grupo. Recorrer colección por colección usa esos índices
// automáticos y NO necesita desplegar ningún índice nuevo — medido: las tres
// consultas por colección contestan.
//
// ── Y POR QUÉ SE FILTRA `tipo` EN LA CONSULTA Y LA FECHA EN MEMORIA ────────
// Igualdad y rango sobre campos distintos piden índice compuesto. De los dos,
// el que recorta es `tipo`: hoy hay 0 filas `error_permiso` contra 4,201
// totales. Filtrar por fecha traería la semana entera (168 filas) para
// descartarlas casi todas. Si algún día esto se vuelve caro es porque la
// alarma está sonando sin parar, y ese sería el problema, no el costo.
const TIPO_DENEGACION = "error_permiso";

/**
 * Las colecciones de bitácora que hay HOY: la raíz más una por organización.
 * Se enumeran en cada corrida y no se guardan: una organización nueva tiene
 * que entrar al conteo el día que nace, no el día que alguien se acuerde.
 */
async function coleccionesDeBitacora(db) {
  const orgs = await db.collection("orgs").listDocuments();
  return ["auditoria", ...orgs.map(o => `orgs/${o.id}/auditoria`)];
}

/**
 * Cuenta las denegaciones inexplicadas posteriores a `desde`.
 *
 * LANZA si no puede contar. Devolver 0 cuando la consulta falló sería pintar
 * de verde la pantalla que existe para avisar — el mismo defecto que este
 * trabajo viene a cerrar, un nivel más adentro.
 *
 * ── LA FILA SIN FECHA SE CUENTA ────────────────────────────────────────────
 * Una fila lleva dos relojes (ver `construirRastro`): `tsServidor`, que pone
 * Firestore, y `ts`, el del aparato. Se prefiere el del servidor porque el del
 * teléfono miente —en 16 capturas de la 0127 mintió—. Si no trae ninguno de
 * los dos, se cuenta igual: no saber cuándo pasó no es no haber pasado, y de
 * los dos errores posibles el que se puede permitir es contar de más.
 */
async function contarDenegaciones(db, desde) {
  const colecciones = await coleccionesDeBitacora(db);
  const filas = [];
  for (const col of colecciones) {
    const snap = await db.collection(col)
      .where("tipo", "==", TIPO_DENEGACION).get();
    for (const d of snap.docs) filas.push({ coleccion: col, ...d.data() });
  }

  const cuando = f => {
    if (f.tsServidor?.toDate) return f.tsServidor.toDate();
    const t = Date.parse(f.ts || "");
    return Number.isFinite(t) ? new Date(t) : null;
  };
  const enVentana = filas.filter(f => {
    const c = cuando(f);
    return c === null || c >= desde;
  });

  const obras = [...new Set(enVentana.map(f => f.obraId).filter(Boolean))];
  const codigos = [...new Set(enVentana.map(f => f.codigo).filter(Boolean))];
  return {
    total: enVentana.length,
    historicas: filas.length,
    obras, codigos, colecciones,
    sinFecha: enVentana.filter(f => cuando(f) === null).length,
  };
}

/** El renglón que leen el semáforo y el correo. Una sola redacción para los
 *  dos: si discrepan, uno de los dos está mintiendo. */
function textoDenegaciones({ total, obras, codigos, sinFecha }) {
  if (total === 0) return "Ninguna denegación inexplicada.";
  return `${total} denegación(es) que la app no supo explicar` +
    (obras.length ? ` · obras: ${obras.join(", ")}` : "") +
    (codigos.length ? ` · códigos: ${codigos.join(", ")}` : "") +
    (sinFecha ? ` · ${sinFecha} sin fecha utilizable` : "");
}

// ── SCHEDULED: cada día 8:30 hora México (después de actualizarGPSheet) ──
// El plazo del semáforo es 36 h, igual que el de `gp_sync`: si este trabajo se
// calla día y medio, el panel se pone en rojo por silencio. Que el vigilante
// tenga vigilante es justo el punto — un canal que puede callarse sin que se
// note vuelve a ser el defecto que vino a cerrar.
exports.vigilarDenegaciones = onSchedule({
  schedule: "30 8 * * *",
  timeZone: "America/Mexico_City",
  region: "us-central1",
}, async () => {
  const t0 = Date.now();
  try {
    // `admin.firestore()` vive DENTRO del try, y no es colocación casual: lo
    // encontró `prueba-cron-que-no-se-traga-su-fallo.cjs` el 2026-10-26 con
    // esta línea una arriba, fuera. Ahí, si reventaba —app sin inicializar,
    // credencial transitoria—, el `catch` no corría: la función lanzaba
    // (Scheduler sí se enteraba) pero `global/health` no recibía nada, y
    // pasado el plazo la pantalla decía «sin correr». Eso es falso: sí
    // corrió, lo que no pudo fue arrancar. Es el defecto del #75 colándose
    // por el único renglón que quedaba fuera, y justo en el vigilante que
    // existe para que los demás no se callen.
    const db = admin.firestore();

    // La ventana arranca donde terminó la corrida anterior, para que ninguna
    // fila se cuente dos veces ni se salte entre corridas. Sin corrida previa
    // —la primera vez, o tras borrar el registro— se toman 24 h y el mensaje
    // lo dice: una ventana supuesta no se presenta como medida.
    const salud = await db.doc("global/health").get();
    const previa = salud.exists ? salud.data()?.permisos_denegados?.ultimaEjecucion : null;
    const tPrevia = Date.parse(previa || "");
    const primera = !Number.isFinite(tPrevia);
    const desde = primera ? new Date(Date.now() - 24 * 3600 * 1000) : new Date(tPrevia);

    const r = await contarDenegaciones(db, desde);
    const mensaje = textoDenegaciones(r) +
      (primera ? " · primera corrida: ventana supuesta de 24 h" : "");
    console.log(`vigilarDenegaciones: ${mensaje}`);
    await registrarSalud("permisos_denegados", r.total === 0, mensaje, {
      duracionMs: Date.now() - t0,
      denegaciones: r.total,
      historicas: r.historicas,
      desde: desde.toISOString(),
      colecciones: r.colecciones,
      obras: r.obras,
    });
  } catch (e) {
    console.error("vigilarDenegaciones falló:", e);
    await registrarFalloDeSalud("permisos_denegados", e, { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// ── SCHEDULED: cada día 8am hora México ──
// Antes era semanal (lunes 9am), pero las facturas se agregan a GP durante
// toda la semana y CAMPO mostraba snapshots desactualizados hasta el próximo
// lunes. Ahora refresca diariamente para que la portada siempre esté al día.
//
// EL NOMBRE SE QUEDA, AUNQUE YA NO LEA LA HOJA. Renombrarlo a
// `actualizarGPPorObra` no renombra el trabajo que ya está desplegado: dejaría
// `actualizarGPSheet` vivo en Cloud Scheduler, leyendo la hoja congelada y
// pisando cada mañana lo que esta corrida acaba de escribir en los mismos dos
// documentos. Dos escritores para un número es justo el defecto que estamos
// quitando. El identificador miente un poco; el dato no.
//
// 300 s de plazo porque el recorrido medido son 32.5 s para cinco obras y el
// servidor piensa ~10 s por llamada: con el plazo de 60 s por omisión, una obra
// lenta se lleva la corrida completa. 256 MiB porque las cinco obras ocupan
// 14 MB de heap (la llamada de «todo» ocupaba 228 MB y por eso no se usa).
exports.actualizarGPSheet = onSchedule({
  schedule: "0 8 * * *",   // diario 8:00am
  timeZone: "America/Mexico_City",
  region: "us-central1",
  secrets: [GP_USUARIO, GP_PASSWORD],
  timeoutSeconds: 300,
  memory: "256MiB",
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando actualización programada de GP (obra por obra)…");
  try {
    const r = await descargarYGuardarGPPorObra({
      usuario: GP_USUARIO.value(), password: GP_PASSWORD.value(),
    });
    const mensaje = `OK: ${r.totalObras} obras, ${r.renglonesLeidos} renglones, ` +
      `${r.semanasDisponibles.length} semanas` +
      (r.obrasConError.length ? `, ${r.obrasConError.length} con error` : "");
    console.log(mensaje);
    await registrarSalud("gp_sync", r.obrasConError.length === 0, mensaje, {
      duracionMs: Date.now() - t0,
      totalObras: r.totalObras,
      semanas: r.semanasDisponibles.length,
      ultimaSemana: r.ultimaSemana,
      renglonesLeidos: r.renglonesLeidos,
      obrasConError: r.obrasConError,
    });
  } catch (e) {
    console.error("Error en actualización programada de GP:", e);
    await registrarFalloDeSalud("gp_sync", e, { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// ── CALLABLE: refrescar manualmente (cualquier admin) ──
exports.refrescarGP = onCall({
  region: "us-central1",
  secrets: [GP_USUARIO, GP_PASSWORD],
  timeoutSeconds: 300,
  memory: "256MiB",
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const email = (request.auth.token.email || "").toLowerCase();
  if (!email) throw new HttpsError("unauthenticated", "Token sin email.");
  // Cualquier usuario autenticado puede pedir refresh (es información útil para todos)
  try {
    const r = await descargarYGuardarGPPorObra({
      usuario: GP_USUARIO.value(), password: GP_PASSWORD.value(),
    });
    return {
      ok: true,
      totalObras: r.totalObras,
      semanas: r.semanasDisponibles.length,
      ultimaSemana: r.ultimaSemana,
      ultimoMes: r.ultimoMes,
      renglonesLeidos: r.renglonesLeidos,
      // Una obra que falló tiene que viajar hasta el botón que la pidió. Decir
      // «ok» sin más dejaría al usuario creyendo que vio las cinco frescas.
      obrasConError: r.obrasConError,
    };
  } catch (e) {
    throw new HttpsError("internal", `Error al refrescar GP: ${e.message}`);
  }
});

// ── CALLABLE: volver a la hoja a mano, cuando la API de GP no contesta ──
//
// El 2026-10-28 fosedy.org devolvió 502 durante una tarde. Si eso pasa un día
// que además importa, la salida es leer la hoja —vieja, pero leíble— y que el
// documento DIGA que vino de ahí: `fuente: 'hoja-gp'` contra
// `'api-gp-por-obra'`. Es un escritor a la vez y lo elige una persona.
//
// Es `admin_sistema` o dirección porque la hoja está congelada al último
// refresco manual de Luis: pisar con ella el dato fresco hace que las pantallas
// enseñen MENOS dinero del que hay, y eso no debería poder dispararlo
// cualquiera desde un botón.
exports.refrescarGPDesdeHoja = onCall({
  region: "us-central1", timeoutSeconds: 120,
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const email = (request.auth.token.email || "").toLowerCase();
  const perfilSnap = await admin.firestore().doc(`usuarios/${emailAId(email)}`).get();
  const rol = perfilSnap.exists ? perfilSnap.data().rol : null;
  if (!["director_general", "admin_sistema"].includes(rol)) {
    throw new HttpsError("permission-denied", "Solo dirección o admin puede volver a la hoja.");
  }
  try {
    const parsed = await descargarYGuardarGP();
    return {
      ok: true,
      fuente: "hoja-gp",
      totalObras: parsed.totalObras,
      semanas: parsed.semanasDisponibles.length,
      ultimaSemana: parsed.ultimaSemana,
      ultimoMes: parsed.ultimoMes,
    };
  } catch (e) {
    throw new HttpsError("internal", `Error al leer la hoja de GP: ${e.message}`);
  }
});

// ── El catálogo: semanal, porque las obras nuevas no aparecen a diario ──
//
// Lunes 7:00, una hora antes del gasto de las 8:00. Separados a propósito: el
// token de GP es de un solo uso y un login nuevo invalida el anterior, así que
// dos recorridos que se traslapan se pisan el token. Una hora de distancia es
// de sobra para los 13 s que tarda éste.
//
// Semanal y no diario porque el catálogo cambia cuando FOSMON firma un contrato
// nuevo —tres obras nuevas en octubre de 2026— no cuando alguien paga un cheque.
// Si hace falta antes, está el botón.
exports.actualizarCatalogoGP = onSchedule({
  schedule: "0 7 * * 1",   // lunes 7:00am
  timeZone: "America/Mexico_City",
  region: "us-central1",
  secrets: [GP_USUARIO, GP_PASSWORD],
  timeoutSeconds: 300,
  memory: "512MiB",
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando actualización del catálogo de obras de GP…");
  try {
    const cat = await descargarYGuardarCatalogoGP({
      usuario: GP_USUARIO.value(), password: GP_PASSWORD.value(),
    });
    const mensaje = `OK: ${cat.obras.length} obras en el catálogo, ` +
      `${cat.renglonesLeidos} renglones leídos` +
      (cat.renglonesSinClave ? `, ${cat.renglonesSinClave} sin clave` : "") +
      (cat.obrasRenombradas.length ? `, ${cat.obrasRenombradas.length} renombrada(s)` : "");
    console.log(mensaje);
    await registrarSalud("gp_catalogo", true, mensaje, {
      duracionMs: Date.now() - t0,
      totalObras: cat.obras.length,
      renglonesLeidos: cat.renglonesLeidos,
      renglonesSinClave: cat.renglonesSinClave,
      obrasRenombradas: cat.obrasRenombradas,
    });
  } catch (e) {
    console.error("Error al actualizar el catálogo de GP:", e);
    await registrarFalloDeSalud("gp_catalogo", e, { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// ── CALLABLE: pedir el catálogo ahora mismo ──
//
// Lo puede disparar cualquier usuario con sesión, igual que `refrescarGP`. No es
// un descuido: quien descubre que falta una obra en el catálogo es precisamente
// quien está intentando darla de alta, y dejarlo esperando al lunes por un
// documento de 67 renglones sería devolverle el mismo bloqueo con otra cara.
exports.refrescarCatalogoGP = onCall({
  region: "us-central1",
  secrets: [GP_USUARIO, GP_PASSWORD],
  timeoutSeconds: 300,
  memory: "512MiB",
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  try {
    const cat = await descargarYGuardarCatalogoGP({
      usuario: GP_USUARIO.value(), password: GP_PASSWORD.value(),
    });
    return {
      ok: true,
      totalObras: cat.obras.length,
      renglonesLeidos: cat.renglonesLeidos,
      renglonesSinClave: cat.renglonesSinClave,
      obrasRenombradas: cat.obrasRenombradas,
    };
  } catch (e) {
    throw new HttpsError("internal", `Error al refrescar el catálogo de GP: ${e.message}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// RESUMEN SEMANAL POR CORREO — Lunes 9:07 a.m. hora México
// ════════════════════════════════════════════════════════════════════════════
// Envía un email a Director General, Director Operaciones y Gerente Construcción
// con el estado consolidado del portafolio de obras activas.
// Usa Resend (https://resend.com) como proveedor de email transaccional.
// La API key se carga desde Google Secret Manager (no se hardcodea).

// La dirección del producto, no la del contratista. `campo-fosmon.netlify.app`
// decía de quién era la app antes de que el lector se identificara, y
// `campo@fosmon.com.mx` hacía lo mismo en el remitente: un municipio recibía el
// resumen de SUS obras desde el dominio de la constructora que le cobra. Es el
// mismo caso que la firma del correo (#43) y que el emblema de la pantalla de
// entrada, por el lado de la dirección.
//
// `cotea.com.mx` tiene que estar VERIFICADO en Resend (SPF y DKIM en el DNS)
// antes de desplegar esto: con el dominio sin verificar Resend contesta 403 y
// el correo del lunes no sale. No sale en silencio: el `catch` lo registra en
// salud y relanza, así que Scheduler lo cuenta rojo. Verificar el dominio cubre
// también a `app.`: Resend mira el dominio del REMITENTE, que sigue siendo
// `cotea.com.mx`, no a dónde apunten los enlaces del cuerpo.
//
// ── Dos direcciones, dos oficios (#89, la mudanza al subdominio) ────────────
// Dejaron de ser una sola el 2026-11-04, y la distinción no es cosmética:
//
//   · `app.cotea.com.mx` es donde VIVE la aplicación. Ahí apunta todo enlace
//     que espera una sesión: el botón de entrar y, sobre todo, los enlaces
//     profundos `/?obra=…`. Mandarlos a la raíz sería mandarlos a un rebote, y
//     un rebote que pierda lo que va después del `?` abre la obra equivocada
//     —o ninguna— sin decir que se perdió nada.
//   · `cotea.com.mx` es la cara PÚBLICA: hoy un redirect temporal, mañana la
//     landing (#90, la página pública con capturas). Es la que se imprime donde
//     el lector puede no tener cuenta —el pie del PDF que el cliente archiva,
//     el pie de este correo—, porque mandar a la pantalla de contraseña a quien
//     no la tiene es una puerta cerrada en la cara.
//
// Que las dos vivan bajo el mismo dominio registrable es lo que sostiene el
// resto: el remitente sigue siendo `no-reply@cotea.com.mx` y el correo no se
// parece a una suplantación.
const APP_URL = "https://app.cotea.com.mx";
const SITIO_PUBLICO = "https://cotea.com.mx";
const FROM_EMAIL = "cotea <no-reply@cotea.com.mx>";
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

// ── Fórmulas de ejecutado y avance ────────────────────────────────────────
// Copia literal de `importeEjecutadoPartida` / `desgloseEjecutado` /
// `avanceFisicoPonderado` de src/App.jsx. El correo del lunes y la pantalla
// tienen que dar el mismo número POR CONSTRUCCIÓN, no por coincidencia: hasta
// 2026-09-21 este archivo tenía su propia fórmula (Σ cantEjec×pu, sin tope y
// sin caída a `a`) y reportaba la 0112 al 94.67% mientras la app mostraba
// 83.92%. Además una partida en modo volumen con avance capturado en % pero
// sin `cantEjec` valía 0 aquí y (a/100)×imp allá.
//
// Si se toca una copia hay que tocar la otra: no hay build compartido entre
// functions/ y src/, son dos despliegues distintos.
const importeEjecutadoPartida = (s, modoVol = false) => {
  if (modoVol) {
    const cantEjec = Number(s?.cantEjec) || 0;
    const pu = Number(s?.pu) || 0;
    if (cantEjec > 0 && pu > 0) return cantEjec * pu;
  }
  const a = Number(s?.a ?? s?.avance) || 0;
  return (a / 100) * (Number(s?.imp ?? s?.importe) || 0);
};

const importeCatalogoPartida = (s) => Number(s?.imp ?? s?.importe) || 0;

const desgloseEjecutado = (subs = [], modoVol = false) => {
  let catalogo = 0; let excedente = 0;
  for (const s of (subs || [])) {
    const total = importeEjecutadoPartida(s, modoVol);
    const tope = importeCatalogoPartida(s);
    if (total > tope) {
      catalogo += tope;
      excedente += total - tope;
    } else {
      catalogo += total;
    }
  }
  return { catalogo, excedente, total: catalogo + excedente };
};

// Avance físico = ejecutado / contrato, topado al 100% EN EL TOTAL. El dinero
// no se topa; el porcentaje sí. Las partidas se compensan entre sí.
const avanceFisicoPonderado = (subs = [], contrato = 0, modoVol = false) => {
  if (!(contrato > 0)) return 0;
  return Math.min(100, (desgloseEjecutado(subs, modoVol).total / contrato) * 100);
};

// ── ¿El gasto de GP de ESTA obra es una medición, o es un hueco? ───────────
// Copia literal de `extraerGastoTotalGP` / `estadoGastoGP` de src/App.jsx, con
// la misma advertencia que el bloque de arriba: si se toca una copia hay que
// tocar la otra, y `prueba-el-gasto-sin-medir-no-es-cero.cjs` EJECUTA las dos
// sobre las mismas entradas y exige que den el mismo veredicto.
//
// Por qué existe esta copia y no sólo un número: hasta hoy este archivo tenía
// `let totGP = 0` y, si la obra no aparecía en el documento de gasto, se
// quedaba en cero sin decirlo. Cero y «no se pudo medir» salían idénticos por
// el correo del lunes — misma cifra, mismo color, misma tipografía— y el
// margen de una obra sin medir sale cerca del 100%: todo ingreso y ningún
// costo. Esa es la mentira más cara que este correo puede decir, y le toca
// justo a la obra recién dada de alta, que es la que más se mira.
//
// El documento ya traía con qué distinguirlas y este archivo, que es quien lo
// ESCRIBE (`obrasPedidas`, abajo en el agrupado del Sheet), era el único que
// no lo leía.
const extraerGastoTotalGP = (datosObra) => {
  if (!datosObra) return 0;
  if (datosObra.grandTotal > 0) return datosObra.grandTotal;
  const sumaAños = datosObra.años
    ? Object.values(datosObra.años).reduce((t, v) => t + (v || 0), 0)
    : 0;
  const totalAñoActual = datosObra.total2026
    || (datosObra.meses ? Object.values(datosObra.meses).reduce((t, v) => t + (v || 0), 0) : 0);
  return sumaAños + totalAñoActual || datosObra.totalGeneral || datosObra.total || 0;
};

const estadoGastoGP = (obra, gpData) => {
  // `obraGP` —la obra del Sheet con la que se cruzó, o null— no la usa nadie en
  // este archivo: aquí sólo se publica el total. Va igual porque la copia de
  // `src/App.jsx` la necesita para que quien dibuja el gasto semana por semana
  // use el MISMO match que quien publica el total, y las dos copias tienen que
  // contestar lo mismo, no sólo en el número.
  const sinDato = (motivo, valor = 0) => ({ valor, medido: false, motivo, obraGP: null });
  const medido = (valor, motivo = 'medido', extra = {}) =>
    ({ valor, medido: true, motivo, obraGP: null, ...extra });

  if (!obra) return medido(0, 'sin-obra');
  if (!gpData?.obras) return sinDato('sin-documento', obra?.gastoGP || 0);

  const obrasArr = Object.values(gpData.obras);
  const pedidas = Array.isArray(gpData.obrasPedidas) ? gpData.obrasPedidas : null;
  // `null` significa «no se puede saber», que NO es lo mismo que «no se pidió».
  const sePidio = (clave) => (pedidas === null ? null : pedidas.includes(clave));

  const veredictoDeClaveAusente = (clave, comoSeSupo) => {
    const pedida = sePidio(clave);
    // Se le preguntó a GP por esta obra y no trajo movimientos. Cero es el
    // dato, no un relleno.
    if (pedida === true) return medido(0, 'sin-cheques');
    // El aviso no es adorno: en un cron, la consola es el ÚNICO sitio donde
    // alguien puede diagnosticar por qué una obra salió sin gasto. El correo
    // ya lo dice a los directivos; esto lo dice a quien lo tiene que arreglar.
    if (pedida === false) {
      console.warn(`[GP] obra "${obra.nombre}" (clave ${clave}, ${comoSeSupo}) no está en la corrida del gasto: el cron no la ha pedido todavía. Gasto SIN MEDIR, no cero.`);
      return sinDato('no-pedida');
    }
    console.warn(`[GP] obra "${obra.nombre}" (clave ${clave}, ${comoSeSupo}) no aparece en el gasto y el documento no dice qué obras se pidieron. Gasto SIN MEDIR.`);
    return sinDato('no-se-puede-saber');
  };

  // 1) Por gpId explícito capturado en Contrato
  if (obra.gpId) {
    const exact = obrasArr.find((o) => o.id === obra.gpId);
    if (exact) {
      return medido(extraerGastoTotalGP(exact),
        exact.desactualizadaDesde ? 'desactualizada' : 'medido',
        exact.desactualizadaDesde ? { desde: exact.desactualizadaDesde, obraGP: exact }
                                  : { obraGP: exact });
    }
    // Clave explícita que no aparece en el gasto: NO se busca parecido. El
    // difuso le colgaría a la obra nueva el dinero de la que más se le parezca
    // por nombre. Una clave que no cuadra significa «no hay dato».
    return veredictoDeClaveAusente(obra.gpId, 'capturada en Contrato');
  }

  // 2) Por id de CAMPO si parece código de 4 dígitos
  if (/^\d{4}/.test(obra.id || "")) {
    const clave = obra.id.slice(0, 4);
    const exact = obrasArr.find((o) => o.id === clave);
    if (exact) {
      return medido(extraerGastoTotalGP(exact),
        exact.desactualizadaDesde ? 'desactualizada' : 'medido',
        exact.desactualizadaDesde ? { desde: exact.desactualizadaDesde, obraGP: exact }
                                  : { obraGP: exact });
    }
    const pedida = sePidio(clave);
    if (pedida !== null) return veredictoDeClaveAusente(clave, 'prefijo del id');
  }

  // 3) Por nombre normalizado (match si ≥2 palabras significativas).
  //    Sólo para obras viejas que no tienen por dónde cruzarse por clave.
  const normalizar = (s) => (s || "").toString().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const palabrasObra = normalizar(obra.nombre).split(" ").filter((w) => w.length > 3);
  let mejor = null; let score = 0;
  for (const o of obrasArr) {
    const palObra = normalizar(o.nombre).replace(/^\d{4}\s*/, "").split(" ").filter((w) => w.length > 3);
    const matches = palabrasObra.filter((p) => palObra.some((g) => g.includes(p) || p.includes(g))).length;
    if (matches > score) { score = matches; mejor = o; }
  }
  if (score >= 2 && mejor) return medido(extraerGastoTotalGP(mejor), 'por-nombre',
    { obraGP: mejor });
  // Ningún match → el campo legacy, que no es una medición de GP y se dice.
  console.warn(`[GP] obra "${obra.nombre}" (id=${obra.id}) sin match en el gasto — cae al campo legacy obra.gastoGP=${obra.gastoGP}. Score máximo=${score}, mejor candidato: "${mejor?.nombre || 'ninguno'}". Captura el gpId en Planeación → Contrato.`);
  return sinDato('sin-match', obra?.gastoGP || 0);
};

// ── Días sin captura ───────────────────────────────────────────────────────
// Copia literal de `fechaUltimaCapturaDe` / `diasSinCapturaDe` de src/App.jsx,
// por la misma razón que las tres de arriba: `recordatorioLunes` le manda al
// residente un texto que dice «Sin captura hace N días», y ese N tiene que ser
// el MISMO que el residente ve en el tablero de su obra cuando abre la app
// para contestar. Hasta hoy eran dos cuentas: aquí se leía sólo `fechaCaptura`
// —`fechaCierre` no aparecía en este archivo ni una vez— y, cuando no había
// fecha, se escribía `999`. Ese 999 no es un número medido, es un relleno, y
// hacía dos daños a la vez en la obra recién dada de alta: `999 > 7` le sumaba
// un pendiente «cierre semanal» que nadie podía resolver, y `999 < 300` —el
// filtro que existía sólo para tapar el relleno— le quitaba la alerta A4, que
// es justo la que debía avisar de esa obra.
//
// `null` quiere decir «no se puede contar», no «cero». Quien lo reciba decide
// qué dice; lo que no puede hacer es inventar el número.
//
// Si se toca una copia hay que tocar la otra: no hay build compartido entre
// functions/ y src/. `prueba-una-cuenta-por-numero.cjs` ejecuta las dos sobre
// los mismos historiales y exige que den lo mismo.
const fechaUltimaCapturaDe = (historialAvance = []) => {
  const ult = Array.isArray(historialAvance) && historialAvance.length
    ? historialAvance[historialAvance.length - 1] : null;
  const fecha = ult?.fechaCaptura || ult?.fechaCierre || null;
  if (!fecha) return null;
  return Number.isFinite(new Date(fecha).getTime()) ? fecha : null;
};

const diasSinCapturaDe = (historialAvance = [], ahora = Date.now()) => {
  const fecha = fechaUltimaCapturaDe(historialAvance);
  if (!fecha) return null;
  return Math.floor((ahora - new Date(fecha).getTime()) / 86400000);
};

// Construye los KPIs de una obra leyendo sus sub-colecciones de Firestore
async function calcularKpisObra(obraId, gpData) {
  const db = admin.firestore();
  const [infoSnap, subsSnap, maqSnap, matSnap, otrosSnap, estSnap, extraSnap, histSnap] = await Promise.all([
    db.doc(`obras/${obraId}/config/info`).get(),
    db.doc(`obras/${obraId}/avance/subs`).get(),
    db.doc(`obras/${obraId}/avance/maquinaria`).get(),
    db.doc(`obras/${obraId}/avance/materiales`).get(),
    db.doc(`obras/${obraId}/config/otros_gastos`).get(),
    db.doc(`obras/${obraId}/config/estimaciones`).get(),
    db.doc(`obras/${obraId}/avance/extraordinarias`).get(),
    db.doc(`obras/${obraId}/avance/historial`).get(),
  ]);
  const info = infoSnap.exists ? infoSnap.data() : {};
  // El catálogo y las extraordinarias se mezclan ANTES de cualquier cuenta,
  // igual que en la app: el correo del lunes y la pantalla tienen que decir el
  // mismo avance. Si aquí se leyera sólo `subs`, una obra que ejerce su
  // contrato con extraordinarias saldría estancada en el correo de dirección
  // mientras la pantalla la enseña avanzando, y la discrepancia se leería como
  // «la app miente» justo cuando la app tiene razón.
  const delCatalogo = (subsSnap.exists ? (subsSnap.data().data || []) : []);
  const extraordinarias = (extraSnap.exists ? (extraSnap.data().data || []) : [])
    .map((s) => ({ ...s, extra: true }));
  const subs = [...delCatalogo, ...extraordinarias];
  const maquinaria = (maqSnap.exists ? (maqSnap.data().data || []) : []);
  const materiales = (matSnap.exists ? (matSnap.data().data || []) : []);
  const otros = (otrosSnap.exists ? (otrosSnap.data().items || []) : []);
  const estimaciones = (estSnap.exists ? (estSnap.data().data || []) : []);

  const presupuesto = Number(info.presupuesto) || 0;
  const modoVol = info.modoAvance === "volumen";

  // Avance físico — la misma función que la app.
  const avancePct = avanceFisicoPonderado(subs, presupuesto, modoVol);

  // Gasto: GP del Sheet + maquinaria propia + otros.
  //
  // Del ESTADO, no del número: `estadoGastoGP` separa «GP midió cero» de «GP
  // no midió», que es la distinción que este archivo perdía. El valor se usa
  // igual —maquinaria y otros sí están medidos y sumarlos no inventa nada—,
  // pero viaja con la bandera para que quien presenta decida cómo decirlo.
  const gpEstado = estadoGastoGP(
    { id: obraId, nombre: info.nombre, gpId: info.gpId, gastoGP: info.gastoGP },
    gpData);
  const totGP = gpEstado.valor;
  const totMaq = maquinaria.reduce((t, m) => t + (Number(m.imp) || 0), 0);
  const totOtros = otros.reduce((t, o) => t + (Number(o.importe) || 0), 0);
  const totGasto = totGP + totMaq + totOtros;
  const pctGasto = presupuesto > 0 ? (totGasto / presupuesto) * 100 : 0;

  // Estimaciones cobradas
  const cobrado = estimaciones
    .filter(e => /pagada|cobrada/i.test(String(e.estatus || "")))
    .reduce((t, e) => t + (Number(e.monto) || 0), 0);

  // ── Última captura de avance ──────────────────────────────────────────────
  // Esto era la SEXTA copia de la cuenta, y la única que seguía rellenando.
  // Hacía dos cosas mal a la vez:
  //
  // (1) Medía otra cosa. Leía `avance/subs.fecha` —cuándo se guardó el catálogo
  //     de conceptos— mientras `recordatorioLunes` cuenta desde la última
  //     SEMANA CERRADA en `avance/historial`. Dos fuentes para el mismo número:
  //     el correo de dirección podía decir «sin captura 2d» de una obra a cuyo
  //     residente el correo del lunes le reclamaba el cierre, y al revés.
  //
  // (2) Cuando no había fecha escribía `999`. Ese 999 no se midió. Y aguas
  //     abajo se publica: el renglón del correo lo imprime en rojo como «Sin
  //     captura 999d» y `obrasSinCaptura` lo cuenta entre las atrasadas. Medido
  //     en producción el 2026-11-05, dos obras ACTIVAS —0128 y 0131, las dos
  //     recién dadas de alta y sin un solo cierre— venían recibiendo esa
  //     acusación cada lunes. No están atrasadas 999 días: no han empezado.
  //
  // `null` quiere decir «no se puede contar». Quien lo reciba decide qué dice.
  const semanasCerradas = histSnap.exists ? (histSnap.data().semanas || []) : [];
  const diasDesdeCaptura = diasSinCapturaDe(semanasCerradas);

  return {
    obraId, nombre: info.nombre || obraId, contrato: info.contrato || "",
    cliente: info.cliente || "", presupuesto,
    avancePct, pctGasto, totGasto, cobrado,
    // ¿`totGasto` es el gasto, o le falta el sumando de GP entero? Y por qué.
    // Mismos nombres que en `calcularKPIsObra` de src/App.jsx a propósito: el
    // día que alguien compare las dos salidas, que las compare por el campo.
    gastoGPMedido: gpEstado.medido, gastoGPMotivo: gpEstado.motivo,
    diasDesdeCaptura, modoVol,
  };
}

/**
 * La marca de captura de una obra en la tabla del correo.
 *
 * TRES estados, igual que `bloqueDenegaciones` y por la misma razón. Antes eran
 * dos, porque el tercero venía disfrazado del segundo: una obra sin un solo
 * cierre llegaba aquí con un `999` de relleno y salía impresa en rojo como la
 * más atrasada del portafolio. Lo peor no es que el número sea falso, es que es
 * CREÍBLE en su forma —«Sin captura 999d» se lee como una medición— y acusa a
 * quien no ha tenido oportunidad de capturar nada.
 *
 * `null` se enseña como lo que es, con la misma letra apagada y en cursiva que
 * usa «sin medir» en la columna del gasto: no se sabe, y por eso no se pinta de
 * rojo ni de verde.
 */
function bloqueCaptura(dias) {
  if (dias === null || dias === undefined) {
    return `<span style="color:#9AA0AC;font-size:11px;font-style:italic;">Sin cierre semanal aún</span>`;
  }
  if (dias > 7) {
    return `<span style="background:#FCEBEB;color:#A32D2D;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">Sin captura ${dias}d</span>`;
  }
  return `<span style="color:#9AA0AC;font-size:11px;">Captura: ${dias}d</span>`;
}

/**
 * El aviso de arriba sobre la captura del portafolio.
 *
 * Dos conteos y no uno, porque no son la misma cosa y la diferencia es
 * accionable: a la obra que capturó hace quince días se le reclama; a la que
 * nunca ha cerrado una semana se le pregunta si ya arrancó. Meterlas en el
 * mismo número obliga a Dirección a abrir la app para distinguirlas, que es
 * justo lo que este correo existe para evitar.
 *
 * Y las que nunca cerraron NO se callan por quedar fuera del `> 7`. Al dejar
 * de rellenar con 999 salieron del conteo viejo, y si nadie las nombrara el
 * arreglo habría cambiado una acusación falsa por un silencio: las dos obras
 * que el 2026-11-05 recibían «999d» desaparecerían del resumen.
 */
function avisoDeCaptura(atrasadas, sinUnCierre) {
  const partes = [];
  if (atrasadas > 0) {
    partes.push(`<b>${atrasadas} ${atrasadas === 1 ? "obra" : "obras"} sin captura en los últimos 7 días.</b>`);
  }
  if (sinUnCierre > 0) {
    partes.push(`<b>${sinUnCierre} ${sinUnCierre === 1 ? "obra no ha cerrado" : "obras no han cerrado"} ni una semana todavía.</b>`);
  }
  if (!partes.length) return "";
  return `
          <div style="margin-top:14px;padding:10px 14px;background:#FCEBEB;border-left:3px solid #E24B4A;border-radius:4px;font-size:12px;color:#A32D2D;">
            ${partes.join(" ")} Revisa la columna "Sin captura" abajo.
          </div>`;
}

/**
 * El renglón de denegaciones del correo.
 *
 * Tres estados, y los tres se ven distinto. El que importa es el tercero:
 * cuando el conteo FALLA, el correo no dice «0». Un cero inventado aquí es
 * peor que no decir nada, porque este renglón existe precisamente para que
 * alguien confíe en él una vez por semana sin abrir la aplicación.
 */
function bloqueDenegaciones(den) {
  if (!den) return "";
  if (den.error) {
    return `
          <div style="margin-top:14px;padding:10px 14px;background:#FFF6E5;border-left:3px solid #C98A1B;border-radius:4px;font-size:12px;color:#7A5410;">
            <b>No se pudo contar las denegaciones de permiso de esta semana.</b>
            El dato falta, no es cero. (${den.error})
          </div>`;
  }
  if (!den.total) {
    return `
          <div style="margin-top:14px;font-size:11px;color:#9AA0AC;">
            Sin denegaciones de permiso inexplicadas en los últimos 7 días.
          </div>`;
  }
  return `
          <div style="margin-top:14px;padding:10px 14px;background:#FCEBEB;border-left:3px solid #E24B4A;border-radius:4px;font-size:12px;color:#A32D2D;">
            <b>${den.total} ${den.total === 1 ? "captura fue rechazada" : "capturas fueron rechazadas"} sin que sepamos por qué</b>
            en los últimos 7 días${den.obras?.length ? ` · ${den.obras.join(", ")}` : ""}.
            Quien las intentó sí tenía la obra asignada: no es algo que pueda arreglar desde la app.
          </div>`;
}

/**
 * El renglón de quién NO recibió este correo.
 *
 * Existe porque acotar por organización puede dejar fuera a alguien por un
 * registro incompleto, y esa pérdida es silenciosa por naturaleza: el que no
 * recibe no sabe que debía recibir. Se le dice a quien sí lo recibe.
 *
 * Al que no tiene organización se le pone el nombre: es una cuenta de la
 * propia casa con el perfil a medias, y con el nombre se arregla en un
 * minuto. De los que son de OTRA organización sólo se dice cuántos: saber que
 * existen basta para entender el número, y el padrón de otro cliente no es
 * dato de éste.
 */
function bloqueFueraDeAlcance({ sinOrg = [], deOtra = [] } = {}) {
  if (!sinOrg.length && !deOtra.length) return "";
  const partes = [];
  if (sinOrg.length) {
    const quienes = sinOrg.map(u => u.email || u.nombre || "(sin correo)").join(", ");
    partes.push(`<b>${sinOrg.length} ${sinOrg.length === 1 ? "cuenta no tiene" : "cuentas no tienen"} ` +
      `organización asignada</b> y por eso no ${sinOrg.length === 1 ? "recibió" : "recibieron"} ` +
      `este resumen: ${quienes}. Se arregla desde Administración → Usuarios.`);
  }
  if (deOtra.length) {
    partes.push(`${deOtra.length} ${deOtra.length === 1 ? "cuenta con un rol de dirección pertenece" : "cuentas con rol de dirección pertenecen"} ` +
      "a otra organización; este resumen no es suyo.");
  }
  return `
          <div style="margin-top:14px;padding:10px 14px;background:#FFF6E5;border-left:3px solid #C98A1B;border-radius:4px;font-size:12px;color:#7A5410;">
            ${partes.join("<br>")}
          </div>`;
}

// HTML del email semanal — diseño compacto, mobile-friendly
// `marca` viene de `marcaDeOrg`, el MISMO documento que firma los tres correos
// de alta y que pinta el encabezado de la app. Antes este correo tecleaba
// «CAMPO · FOSMON CONSTRUCCIONES» en el encabezado y «CAMPO — FOSMON
// Construcciones» en el pie: dos copias de una marca que ya se puede leer, y
// el día que este resumen le salga a una dependencia —`orgDeLaRaiz` ya resuelve
// de quién son las obras— iría firmado por su contratista. Es el #39 otra vez,
// entrando por el nombre en vez de por el dinero.
//
// Sin marca no se firma con nadie: el encabezado se queda con `cotea`, que es
// el producto y es cierto para todos. Un correo sin firma es mejor que uno
// firmado por la empresa equivocada, el mismo criterio que `marcaDeOrg`.
// Devuelve `{subject, html}`, como `correoBienvenida`, y no sólo el HTML: el
// asunto se tecleaba en el envío, o sea que el nombre del producto vivía en dos
// lugares y sólo uno de los dos era alcanzable por quien mide el nombre. El día
// que el encabezado dijera una cosa y la bandeja otra, nadie lo vería.
// Por qué no se pudo medir, en el renglón de 10px que queda debajo de la
// cifra. Decir «sin medir» a secas invita a pensar que la app está rota; el
// caso normal es que la obra se dio de alta después de la última corrida del
// cron y se arregla solo. Las frases son las de `presentacionEconomiaObra` en
// src/App.jsx, recortadas al ancho del correo. Un motivo desconocido NO se
// traduce a nada tranquilizador: se dice que no se pudo y ya.
const motivoSinMedir = (motivo) => {
  switch (motivo) {
    case "no-pedida": return "alta posterior a la última corrida de GP";
    case "sin-documento": return "no hay corrida de gasto";
    case "sin-match": return "sin clave de GP capturada";
    case "no-se-puede-saber": return "la corrida no dice qué obras pidió";
    default: return "el gasto de GP no se pudo medir";
  }
};

function correoResumenSemanal(kpisObras, fechaCorte, denegaciones, reparto, marca) {
  const filasObras = kpisObras.map(k => {
    const colorAvance = semaforoColor(k.avancePct, "avance");
    // El semáforo del gasto es la trampa fina: `semaforoColor` pinta VERDE lo
    // que va por debajo del 70% del contrato, así que una obra sin medir —cuyo
    // porcentaje sale bajísimo justamente porque le falta el gasto— se pintaba
    // de verde tranquilizador. Sin medición no hay semáforo: gris.
    const sinMedir = k.gastoGPMedido === false;
    const colorGasto = sinMedir ? "#9AA0AC" : semaforoColor(k.pctGasto, "gasto");
    const linkObra = `${APP_URL}/?obra=${encodeURIComponent(k.obraId)}`;
    const alertaCaptura = bloqueCaptura(k.diasDesdeCaptura);
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
        <div style="font-size:14px;font-weight:600;color:${colorGasto};${sinMedir ? "font-style:italic;" : ""}">${sinMedir ? "sin medir" : MXN_FMT(k.totGasto)}</div>
        <div style="font-size:10px;color:#9AA0AC;">${sinMedir ? motivoSinMedir(k.gastoGPMotivo) : `${PCT_FMT(k.pctGasto, 0)} de ${MXN_FMT(k.presupuesto)}`}</div>
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
  // Dos conteos, no uno: ver `avisoDeCaptura`. El `!== null` es explícito
  // aunque `null > 7` ya sea falso — el día que alguien cambie el centinela a
  // `undefined` o a `-1`, la comparación muda volvería a mentir en silencio.
  const obrasSinCaptura = kpisObras.filter(k => k.diasDesdeCaptura !== null && k.diasDesdeCaptura > 7).length;
  const obrasSinUnCierre = kpisObras.filter(k => k.diasDesdeCaptura === null).length;

  // El total de gasto suma obras a las que les falta el sumando de GP entero,
  // así que sale CORTO y nadie lo nota: es un número redondo, con su etiqueta,
  // al lado de otros tres que sí están completos.
  //
  // No se corrige la cifra y no se excluyen esas obras. No se puede corregir
  // —no sabemos cuánto falta, eso es exactamente lo que significa «sin medir»—
  // y excluirlas inventaría un total distinto del que ya enseña el dashboard,
  // que incluye y declara (`obrasGastoSinMedir` en src/App.jsx). Dos totales
  // del mismo dinero es el defecto que íbamos a arreglar, al revés.
  //
  // Lo único honesto es declararlo pegado al número.
  const sinMedirN = kpisObras.filter(k => k.gastoGPMedido === false).length;
  const avisoGastoCorto = sinMedirN > 0
    ? `${sinMedirN} obra${sinMedirN !== 1 ? "s" : ""} sin medir: va corto`
    : null;

  const firma = marca?.empresa ? ESC_HTML(marca.empresa).toUpperCase() : "";
  const casa = marca?.empresa ? ESC_HTML(marca.empresa) : "";

  // El asunto no lleva la casa: este correo sólo sale a la organización dueña
  // de las obras de la raíz, así que distinguirla en la bandeja no hace falta y
  // el encabezado ya la nombra. Lo que sí lleva es el conteo, que es lo que se
  // lee de un vistazo sin abrirlo.
  const subject = `cotea · Resumen semanal · ${totalObras} obras activas`;

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Resumen semanal · cotea</title></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#0D1619;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F0F2F5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#0D1619;color:#fff;padding:24px 28px;">
          <div style="font-size:11px;letter-spacing:0.12em;opacity:0.7;">cotea${firma ? ` · ${firma}` : ""}</div>
          <div style="font-size:24px;font-weight:700;margin-top:6px;">Resumen semanal</div>
          <div style="font-size:12px;opacity:0.8;margin-top:4px;">Corte del ${fechaCorte}</div>
        </td></tr>
        <!-- Resumen ejecutivo -->
        <tr><td style="padding:20px 28px;background:#F8F9FB;border-bottom:1px solid #E8EAF0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="text-align:center;padding:6px;"><div style="font-size:22px;font-weight:700;color:#0D1619;">${totalObras}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Obras activas</div></td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#185FA5;">${MXN_FMT(presupuestoTotal)}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Presupuesto</div></td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#A32D2D;">${MXN_FMT(gastoTotal)}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Gasto acumulado</div>${avisoGastoCorto ? `<div style="font-size:10px;color:#854F0B;margin-top:3px;">${avisoGastoCorto}</div>` : ""}</td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#3B6D11;">${MXN_FMT(cobradoTotal)}</div><div style="font-size:10px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.06em;">Cobrado</div></td>
            </tr>
          </table>
          ${avisoDeCaptura(obrasSinCaptura, obrasSinUnCierre)}${bloqueDenegaciones(denegaciones)}${bloqueFueraDeAlcance(reparto)}
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
          <a href="${APP_URL}" style="display:inline-block;background:#0D1619;color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Abrir cotea</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 28px;background:#F8F9FB;font-size:10px;color:#9AA0AC;text-align:center;border-top:1px solid #E8EAF0;">
          Este resumen se envía automáticamente cada lunes a las 9 a.m. (CDMX) a Dirección y Gerencia.<br>
          cotea${casa ? ` — ${casa}` : ""} · ${SITIO_PUBLICO.replace(/^https?:\/\//, "")}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
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

// ════════════════════════════════════════════════════════════════════════════
// CORREOS DE ALTA — obra nueva, obra asignada, usuario nuevo (2026-11-03)
// ════════════════════════════════════════════════════════════════════════════
// Hasta hoy estos tres avisos sólo existían DENTRO de la app: la campana.
// Quien no entraba no se enteraba, y el alta de un usuario se acompañaba de un
// correo escrito a mano (CORREO_Aldo_Torres.md, CORREO_Julian_Islas.txt).
//
// ── POR QUÉ VIVEN EN EL SERVIDOR Y NO EN EL CLIENTE ──
// El aviso en app lo creaba el navegador con `notifARoles`, que para saber a
// quién avisar necesita LISTAR `usuarios`. La regla sólo se lo permite a un
// admin de la organización, y `gerente_construccion` —uno de los dos roles que
// pueden dar de alta una obra— no lo es: la lectura se denegaba, el `catch` se
// tragaba el error y el alta se consumaba sin avisarle a nadie. Desde el
// servidor no hay regla que denegar, así que el aviso deja de depender del rol
// de quien dio el alta. Es el #85.

// `empresa` es el nombre que la organización enseña como suyo. Se lee de
// `orgs/{oid}/config/branding`, el MISMO documento que pinta el encabezado de
// la app: si el correo trajera su propio nombre, un día diría uno y la pantalla
// otro. Sin marca —organización vieja, anterior al branding— se cae al nombre
// de la organización, y si tampoco hay, a nada: es preferible un correo sin
// firma que uno firmado por la empresa equivocada.
async function marcaDeOrg(orgId) {
  if (!orgId) return { empresa: "", empresaCorta: "" };
  const db = admin.firestore();
  try {
    const b = await db.doc(`orgs/${orgId}/config/branding`).get();
    if (b.exists) {
      const d = b.data() || {};
      const empresa = String(d.empresa || "").trim();
      if (empresa) return { empresa, empresaCorta: String(d.empresaCorta || "").trim() || empresa };
    }
    const o = await db.doc(`orgs/${orgId}`).get();
    const nombre = o.exists ? String((o.data() || {}).nombre || "").trim() : "";
    return { empresa: nombre, empresaCorta: nombre };
  } catch (e) {
    console.warn(`marcaDeOrg(${orgId}): no se pudo leer la marca:`, e.message);
    return { empresa: "", empresaCorta: "" };
  }
}

const ESC_HTML = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// El sobre común de los tres correos. Lo único que cambia entre uno y otro es
// el cuerpo; el encabezado, el pie y la marca son los mismos para que un
// usuario reconozca de dónde viene el correo antes de leerlo.
function sobreCorreo({ marca, titulo, entradilla, cuerpoHTML, pie }) {
  const firma = marca?.empresa ? ESC_HTML(marca.empresa) : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8F9FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FB;padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:10px;overflow:hidden;border:1px solid #E8EAF0;">
        <tr><td style="padding:20px 28px;background:#0D1619;">
          <div style="font-size:17px;font-weight:700;color:#FFFFFF;letter-spacing:0.06em;">cotea</div>
          ${firma ? `<div style="font-size:10px;color:#9AA0AC;letter-spacing:0.08em;text-transform:uppercase;margin-top:3px;">${firma}</div>` : ""}
        </td></tr>
        <tr><td style="padding:26px 28px 8px 28px;">
          <div style="font-size:18px;font-weight:700;color:#0D1619;line-height:1.35;">${ESC_HTML(titulo)}</div>
          ${entradilla ? `<div style="font-size:13px;color:#4A5160;line-height:1.6;margin-top:10px;">${entradilla}</div>` : ""}
        </td></tr>
        <tr><td style="padding:8px 28px 26px 28px;">${cuerpoHTML}</td></tr>
        <tr><td style="padding:16px 28px;background:#F8F9FB;font-size:10px;color:#9AA0AC;text-align:center;border-top:1px solid #E8EAF0;">
          ${ESC_HTML(pie || "Este aviso lo manda cotea automáticamente.")}<br>
          <a href="${SITIO_PUBLICO}" style="color:#9AA0AC;">${SITIO_PUBLICO.replace(/^https?:\/\//, "")}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const botonHTML = (texto, url) =>
  `<a href="${url}" style="display:inline-block;background:#0D1619;color:#FFFFFF;text-decoration:none;` +
  `font-size:13px;font-weight:700;padding:11px 20px;border-radius:7px;">${ESC_HTML(texto)}</a>`;

// Una tabla de dos columnas para los datos. Los renglones se arman de pares
// [etiqueta, valor] y los vacíos se caen solos: un renglón con la etiqueta y
// nada al lado se lee como un dato que falta, no como uno que no aplica.
const tablaDatos = (pares) => {
  const filas = pares.filter(([, v]) => String(v ?? "").trim() !== "");
  if (!filas.length) return "";
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 18px 0;">` +
    filas.map(([k, v]) => `<tr>
      <td style="padding:7px 10px 7px 0;font-size:11px;color:#9AA0AC;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;vertical-align:top;">${ESC_HTML(k)}</td>
      <td style="padding:7px 0;font-size:13px;color:#0D1619;font-weight:600;">${ESC_HTML(v)}</td>
    </tr>`).join("") + `</table>`;
};

// Un bloque de pasos numerados. Los pasos son texto ya escapado por quien los
// arma, porque algunos llevan un <b> dentro.
const pasosHTML = (titulo, pasos) =>
  `<div style="font-size:12px;font-weight:700;color:#0D1619;margin:18px 0 8px 0;">${ESC_HTML(titulo)}</div>` +
  `<ol style="margin:0;padding-left:20px;font-size:13px;color:#4A5160;line-height:1.75;">` +
  pasos.map(p => `<li>${p}</li>`).join("") + `</ol>`;

const parrafoHTML = (txt) =>
  `<div style="font-size:13px;color:#4A5160;line-height:1.65;margin:14px 0;">${txt}</div>`;

const avisoHTML = (txt) =>
  `<div style="font-size:12px;color:#8A5A00;background:#FFF8E6;border:1px solid #FFE9B0;` +
  `border-radius:7px;padding:11px 13px;line-height:1.6;margin:14px 0;">${txt}</div>`;

// ── LA CONTRASEÑA TEMPORAL ──────────────────────────────────────────────────
// Antes la escribía a mano quien daba el alta, en un campo del formulario, y
// de ahí la copiaba a un correo escrito a mano. Dos consecuencias medidas en
// los correos que existen en el repo: las contraseñas eran adivinables
// (nombre + año) y las mismas para varios usuarios.
//
// `getRandomValues` y no `Math.random()`. No es purismo: `Math.random()` se
// puede predecir a partir de salidas anteriores, y aquí la salida es la llave
// de una cuenta. Es el mismo sorteo que `nuevoIdObra` en la app —hasta el
// descarte—, y a propósito: el sesgo del módulo se quita igual en los dos
// sitios, descartando lo que cae en el tramo incompleto en vez de recortarlo.
// Recortar sale gratis y sesga siempre.
//
// Y es `globalThis.crypto`, no `require("crypto")`: el `randomInt` del módulo
// no existe en el objeto `crypto` global, que es el que hay cuando este código
// se monta en un banco de pruebas. Una contraseña que sólo se puede sortear en
// producción es una contraseña que no se puede medir.
//
// El alfabeto excluye lo que se confunde al dictar por teléfono o al leer en
// la pantalla de un celular bajo el sol: O y 0, l y 1 y I. Una contraseña que
// se teclea mal tres veces acaba en una llamada, y entonces se pasa de viva voz.
const ALFABETO_PASS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function generarPasswordTemporal(largo = 12) {
  const n = ALFABETO_PASS.length;
  const TOPE = Math.floor(256 / n) * n;   // 228 de 256: lo de arriba se descarta
  const buf = new Uint8Array(1);
  let s = "";
  while (s.length < largo) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] >= TOPE) continue;
    s += ALFABETO_PASS[buf[0] % n];
  }
  return s;
}

// El nombre del rol en palabras. Lo manda el cliente porque `ROL_LABEL` vive
// en `src/App.jsx` y es lo que el usuario YA vio en la pantalla del alta:
// una segunda tabla aquí diría "Auditor" donde la app dice "Auditor Interno",
// y el día que un rol se renombre —`supervisor` → `auditor` ya pasó— el correo
// seguiría llamándolo como se llamaba antes.
//
// Se sanea igual: es texto que entra de fuera y sale en un correo. Se recorta,
// se limita a 40 caracteres y se le quita todo lo que no sea letra, espacio o
// guion. Si no viene o no sobrevive al filtro, se cae al identificador del
// rol: feo pero cierto, que es el orden correcto de preferencias.
function rolVisible(rol, rolLabel) {
  const limpio = String(rolLabel || "")
    .trim().slice(0, 40)
    .replace(/[^\p{L}\p{M} .\-]/gu, "")
    .trim();
  return limpio || String(rol || "");
}

// Dónde viven las obras de una organización. Es el `conOrg` del servidor, y la
// razón de la asimetría está en `src/rutas-org.js`: las de la constructora en
// la raíz, las de una dependencia bajo su organización. El discriminante es
// `tipo` y no la presencia de `orgId`, por lo mismo que allá.
const rutaObrasDeOrg = (orgId, tipo) =>
  tipo === "dependencia" ? `orgs/${orgId}/obras` : "obras";

// Cómo se llama una obra en un correo: por su `nombre`, que es el apodo con el
// que se nombra en la casa y mide entre 24 y 40 caracteres en las siete obras
// vivas. Antes iba `contrato || nombre`, igual que la bitácora de la app, para
// que las dos nombraran igual a la misma obra. Esa simetría costaba más de lo
// que valía: `contrato` no es un nombre —en producción vale «N/A», un número
// de pedido y 236 caracteres de descripción legal— y una bitácora se consulta
// mientras un correo se lee de corrido. Si no se puede leer el documento se
// devuelve el identificador: un correo que dice "0128" es incómodo, uno que
// dice "una obra" no sirve para nada.
async function nombresDeObras(orgId, tipo, ids) {
  const limpios = [...new Set((ids || []).map(x => String(x || "").trim()).filter(Boolean))];
  if (!limpios.length) return [];
  const base = rutaObrasDeOrg(orgId, tipo);
  const db = admin.firestore();
  return Promise.all(limpios.map(async id => {
    try {
      const s = await db.doc(`${base}/${id}`).get();
      if (!s.exists) return id;
      const d = s.data() || {};
      return String(d.nombre || "").trim() || id;
    } catch { return id; }
  }));
}

// ── LOS PASOS PARA CAMBIAR LA CONTRASEÑA ────────────────────────────────────
// Esta lista describe una pantalla que existe: el nombre del usuario en la
// barra de arriba abre `ModalMiPassword` (src/App.jsx). Si esa pantalla se
// mueve, estos pasos mienten — y un correo que manda a alguien a tocar algo
// que no está es peor que no mandar el correo.
const PASOS_CAMBIO_PASS = [
  `Entra a cotea con el usuario y la contraseña de arriba.`,
  `Toca <b>tu nombre</b>, arriba a la derecha.`,
  `Escribe la contraseña temporal, luego la nueva dos veces, y <b>Cambiar</b>.`,
];

// Instalarla en el teléfono. Es una PWA de verdad —hay service worker y
// manifest—, así que estos pasos son los del sistema operativo y no una
// promesa nuestra.
const PASOS_INSTALAR = [
  `<b>iPhone</b>: ábrela en Safari, toca Compartir y «Añadir a pantalla de inicio».`,
  `<b>Android</b>: ábrela en Chrome, toca ⋮ y «Instalar app».`,
];

// ── CORREO DE BIENVENIDA ────────────────────────────────────────────────────
// Lo que este correo NO lleva, y por qué:
//
//  · Los pasos del rol. Los pone la app: `PASOS_BIENVENIDA` y `WelcomeBanner`
//    en src/App.jsx le pintan a cada usuario los suyos al entrar, y cambian
//    solos cuando su rol cambia. Copiarlos aquí sería una segunda versión que
//    se desfasa, y la forma en que se desfasa es la peor: diciéndole a un
//    residente que capture algo que su rol no le deja capturar.
//  · El manual en PDF. Va aparte, y sólo a quien captura en campo: el
//    instructivo de un contratista no es material de la dependencia que lo
//    contrata.
//  · Cifras. Un correo de acceso no lleva presupuesto, gasto ni margen de
//    ninguna obra. Las obras se nombran, y nada más.
function correoBienvenida({ marca, nombre, email, password, rol, rolLabel, obras, dioElAlta }) {
  const rolTxt = rolVisible(rol, rolLabel);
  const casa = marca?.empresaCorta || marca?.empresa || "";
  const obrasTxt = (obras && obras.length)
    ? obras.join(" · ")
    // No se dice "todas las obras": quién ve qué lo deciden los claims y el
    // rol, no este correo. Que la lista esté vacía significa que no se
    // marcaron obras en el alta, y eso se dice tal cual.
    : "";

  const cuerpo =
    tablaDatos([
      ["Dirección", APP_URL],
      ["Usuario", email],
      ["Contraseña temporal", password],
      ["Rol", rolTxt],
      ["Obras", obrasTxt],
    ]) +
    avisoHTML(
      `Esa contraseña es <b>temporal</b> y viajó por correo. Mientras no la cambies, ` +
      `la sabe cualquiera que tenga acceso a este mensaje.`
    ) +
    pasosHTML("Cámbiala en cuanto entres", PASOS_CAMBIO_PASS) +
    pasosHTML("Instálala en el teléfono", PASOS_INSTALAR) +
    parrafoHTML(
      `Al entrar vas a ver una tarjeta de bienvenida con los pasos de tu rol. ` +
      `Esos pasos los pone la app según lo que puedes hacer como ${ESC_HTML(rolTxt)}, ` +
      `así que son los tuyos y se actualizan si tu rol cambia.`
    ) +
    parrafoHTML(`<b>Entra siempre con tu propia cuenta.</b> Lo que se captura queda firmado ` +
      `con el usuario que lo capturó; una contraseña compartida convierte la bitácora en adivinanza.`) +
    `<div style="margin:18px 0 4px 0;">${botonHTML("Entrar a cotea", APP_URL)}</div>` +
    (dioElAlta
      ? parrafoHTML(`Si algo no te deja entrar, escríbele a ${ESC_HTML(dioElAlta)}, que fue quien te dio de alta.`)
      : "");

  return {
    subject: casa ? `Tu acceso a cotea · ${casa}` : `Tu acceso a cotea`,
    html: sobreCorreo({
      marca,
      titulo: `Ya tienes acceso a cotea`,
      entradilla: `${ESC_HTML(String(nombre || "").split(" ")[0] || "Hola")}, te dieron de alta` +
        (casa ? ` en ${ESC_HTML(casa)}` : "") + ` como <b>${ESC_HTML(rolTxt)}</b>.`,
      cuerpoHTML: cuerpo,
      pie: "Este correo lo manda cotea al dar de alta una cuenta.",
    }),
  };
}

// ── CORREO DE OBRA ASIGNADA ─────────────────────────────────────────────────
// Sólo las obras que se AGREGARON. Mandar la lista completa cada vez que se
// edita un usuario haría que el correo pareciera un alta nueva, y a la tercera
// vez nadie lo abre.
function correoObraAsignada({ marca, nombre, obras }) {
  const una = obras.length === 1;
  const cuerpo =
    tablaDatos(obras.map((o, i) => [obras.length > 1 ? `Obra ${i + 1}` : "Obra", o])) +
    `<div style="margin:18px 0 4px 0;">${botonHTML("Abrir cotea", APP_URL)}</div>`;
  return {
    subject: una ? `Te asignaron una obra en cotea` : `Te asignaron ${obras.length} obras en cotea`,
    html: sobreCorreo({
      marca,
      titulo: una ? `Te asignaron una obra` : `Te asignaron ${obras.length} obras`,
      // El título ya dice qué pasó y la cabecera de `sobreCorreo` ya dice en
      // qué casa, así que la entradilla no los repite: saluda y dice dónde
      // mirar, que era el párrafo suelto de abajo.
      entradilla: `${ESC_HTML(String(nombre || "").split(" ")[0] || "Hola")}, ` +
        (una ? `ya la ves` : `ya las ves`) + ` en tu lista al entrar a cotea.`,
      cuerpoHTML: cuerpo,
      pie: "Este correo lo manda cotea al asignarte una obra.",
    }),
  };
}

// ── CORREO DE OBRA NUEVA ────────────────────────────────────────────────────
// La cifra sale del MISMO documento que leyó el aviso de la campana —el que
// acaba de escribir el alta— y se etiqueta como la etiqueta la app: en una
// constructora es su presupuesto, en una dependencia el monto que contrató.
// No son el mismo número con dos nombres: son dos números distintos, y es por
// eso que la etiqueta no se puede dejar fija.
function correoObraNueva({ marca, tipo, obraId, obra, dioElAlta }) {
  const dep = tipo === "dependencia";
  // `nombre` es el apodo corto con el que la obra se nombra en la casa —«SIOP
  // COLECTOR MALECON PENTAGONO 0926», 36 caracteres—. `contrato` NO es un
  // nombre, y preferirlo era el defecto: en producción vale `"N/A"` en la
  // 0114, un número de pedido —`"6700388901"`— en la 0125, y 236 caracteres
  // de descripción legal en la 0128. Las tres acababan de título. Dos de esas
  // tres ni siquiera se podían leer: «Obra nueva: N/A».
  const nombreObra = String(obra.nombre || "").trim() || obraId;
  const contrato = String(obra.contrato || "").trim();
  const contraparte = dep
    ? String(obra.empresaEjecutante || "").trim()
    : String(obra.cliente || "").trim();
  const monto = Number(obra.presupuesto) || 0;

  const cuerpo =
    // Sin el renglón «Obra»: el nombre ya es el título. Repetirlo tres veces
    // —asunto, título y tabla— hacía que un aviso de cuatro datos ocupara
    // veinte renglones, y lo que se repite se deja de leer.
    tablaDatos([
      ["Identificador", obraId],
      [dep ? "Empresa ejecutante" : "Cliente", contraparte],
      // Un monto en cero no se pinta como "$0": en el alta el presupuesto se
      // puede dejar en blanco, y "$0" es una cifra inventada donde no hubo
      // captura. `tablaDatos` tira el renglón vacío.
      [dep ? "Monto contratado" : "Presupuesto", monto > 0 ? MXN_FMT(monto) : ""],
      // La descripción legal se dice UNA vez y aquí, que es donde se busca
      // cuando se busca. No se tira: para una obra de gobierno es como se
      // identifica en el oficio.
      ["Contrato", contrato],
    ]) +
    (monto > 0 ? "" : avisoHTML(
      `La obra se dio de alta <b>sin ${dep ? "monto contratado" : "presupuesto"}</b>. ` +
      `Hasta que se capture, el avance financiero de esta obra no se puede medir.`
    )) +
    parrafoHTML(`Una obra sin catálogo no acepta captura de avance todavía. ` +
      `El siguiente paso es cargarle el ${dep ? "catálogo de conceptos" : "presupuesto"}.`) +
    `<div style="margin:18px 0 4px 0;">${botonHTML("Abrir la obra", `${APP_URL}/?obra=${encodeURIComponent(obraId)}`)}</div>`;

  return {
    subject: `Obra nueva en cotea · ${nombreObra}`,
    html: sobreCorreo({
      marca,
      titulo: `Obra nueva · ${nombreObra}`,
      // La entradilla trae algo que no esté ya arriba. Antes repetía al
      // cliente, que está en la tabla dos renglones más abajo; ahora dice
      // quién la dio de alta, que era un párrafo suelto al final — el sitio
      // donde ya nadie llega.
      entradilla: dioElAlta ? `La dio de alta ${ESC_HTML(dioElAlta)}.` : "",
      cuerpoHTML: cuerpo,
      pie: "Este correo lo manda cotea al dar de alta una obra.",
    }),
  };
}

// ── MANDAR SIN TUMBAR EL ACTO ───────────────────────────────────────────────
// Un correo que no sale NO deshace el alta. El usuario ya existe en Auth y su
// perfil ya está escrito; lanzar aquí le devolvería un error a quien dio el
// alta por algo que ya se consumó, y volvería a intentarlo creando el
// desorden. Pero tampoco se calla: el fallo se registra con lo que hace falta
// para repararlo a mano —a quién no le llegó y por qué— porque un correo de
// acceso que no llega deja a un usuario sin contraseña y sin saberlo.
async function mandarCorreoDeAlta(apiKey, { to, subject, html, concepto }) {
  const destinos = (Array.isArray(to) ? to : [to]).map(x => String(x || "").trim()).filter(Boolean);
  if (!destinos.length) {
    console.warn(`[correo:${concepto}] no se mandó: no quedó ningún destinatario.`);
    return { ok: false, motivo: "sin-destinatarios", enviados: 0 };
  }
  if (!apiKey) {
    console.error(`[correo:${concepto}] NO SE MANDÓ a ${destinos.join(", ")}: falta RESEND_API_KEY.`);
    return { ok: false, motivo: "sin-llave", enviados: 0 };
  }
  try {
    await enviarEmailResend(apiKey, { from: FROM_EMAIL, to: destinos, subject, html });
    console.log(`[correo:${concepto}] enviado a ${destinos.join(", ")}`);
    return { ok: true, enviados: destinos.length };
  } catch (e) {
    console.error(`[correo:${concepto}] NO SE MANDÓ a ${destinos.join(", ")}: ${e.message}`);
    return { ok: false, motivo: e.message, enviados: 0 };
  }
}

// ── A QUIÉN LE TOCA EL AVISO ────────────────────────────────────────────────
// A quién se le avisa de una obra nueva, por tipo de organización. Es la misma
// lista que `ROLES_AVISO_OBRA_NUEVA` en la app —la de la campana— MÁS el
// gerente de construcción del lado de la constructora, que estaba fuera: es el
// rol que da de alta las obras y el que las opera, y era el único al que el
// alta no le avisaba. Lo pidió Omar por su nombre.
const ROLES_CORREO_OBRA_NUEVA = {
  constructora: ["director_general", "director_operaciones", "gerente_construccion", "admin_sistema"],
  dependencia: ["director_obras", "subdirector", "jefe_supervision", "contralor"],
};

// Roles que están DENTRO de una obra y FUERA de la casa que la dio de alta:
// `cliente` es el cliente de la constructora y `contratista` la empresa que
// ejecuta para la dependencia. Si uno de ellos queda asignado a la obra —que
// es justo para lo que existen esos roles— el aviso interno del alta, con su
// monto, NO le toca. Es el mismo principio por el que una dependencia no lee
// la economía del contratista, aplicado al revés.
const ROLES_AJENOS_A_LA_CASA = ["cliente", "contratista"];

// Los perfiles de UNA organización que están activos y tienen correo.
// La consulta filtra por `orgId` en Firestore y los roles se cruzan en
// memoria, igual que `notifARoles` en la app y por la misma razón: `usuarios`
// es una colección raíz compartida, y un `where(in)` de roles junto al
// `where(==)` de organización exigiría un índice compuesto.
async function perfilesDeOrg(orgId) {
  if (!orgId) return [];
  const snap = await admin.firestore().collection("usuarios").where("orgId", "==", orgId).get();
  return snap.docs.map(d => d.data() || {}).filter(u => u.activo !== false);
}

// Función principal: arma y envía el resumen semanal
async function generarYEnviarResumenSemanal(apiKey) {
  const db = admin.firestore();
  // 0) ¿De quién son las obras de la raíz? Se pregunta ANTES de leer nada:
  // si no se puede contestar, este correo no se manda. Ver `orgDeLaRaiz`.
  const orgRaiz = await orgDeLaRaiz(db);

  // 1) Lista obras activas (top-level)
  const obrasSnap = await db.collection("obras").get();
  const obras = obrasSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(o => (o.estado || "activa") !== "archivada");

  // 2) Carga el GP data (resumen) para sacar el gasto de cada obra
  // El path correcto es global/gp_construct (lo guarda descargarYGuardarGP).
  // Antes apuntaba a global/gp_resumen que NO existe → gpData=null → totGP=0
  // siempre → el correo mostraba el gasto sin GP, solo maquinaria y otros.
  const gpResumenSnap = await db.doc("global/gp_construct").get();
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

  // 4) Destinatarios: activos, con rol del portafolio, Y DE LA ORGANIZACIÓN
  // DUEÑA DE LAS OBRAS QUE ACABAN DE LEERSE. El rol solo no basta: ver el
  // comentario de `orgDeLaRaiz`. Este correo lleva presupuesto, gasto y
  // cobrado de cada obra; es el renglón de dinero que no puede cruzar.
  const usuariosSnap = await db.collection("usuarios").get();
  const candidatos = usuariosSnap.docs
    .map(d => d.data())
    .filter(u => u.activo !== false && ROLES_RESUMEN_SEMANAL.includes(u.rol));
  const reparto = partirPorOrg(candidatos, orgRaiz);
  const destinatarios = reparto.dentro.map(u => u.email).filter(Boolean);

  if (destinatarios.length === 0) {
    console.warn("No hay destinatarios para resumen semanal");
    return { enviados: 0, motivo: "sin_destinatarios" };
  }

  // 4bis) Las denegaciones que la app no supo explicar, de los últimos 7 días.
  // Va en un `catch` propio y NO tumba el correo: los KPIs de obra son la
  // razón de ser de este envío y no se pierden porque el conteo falle. Pero
  // el fallo VIAJA —`{ error }`— para que el renglón diga «no se pudo contar»
  // en vez de un cero que nadie capturó.
  let denegaciones;
  try {
    denegaciones = await contarDenegaciones(db, new Date(Date.now() - 7 * 24 * 3600 * 1000));
  } catch (e) {
    console.error("resumen semanal: no se pudieron contar las denegaciones:", e);
    denegaciones = { error: e?.message || String(e) };
  }

  // 5) Arma el HTML
  const fechaCorte = new Date().toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  // La marca de la dueña de las obras que se acaban de leer. Se lee del mismo
  // documento que firma los correos de alta, y es la MISMA `orgRaiz` que ya
  // decidió a quién se le manda: si el correo lo firmara otra, estaría
  // diciéndole al destinatario que el dinero de adentro es de alguien más.
  const marca = await marcaDeOrg(orgRaiz);
  const { subject, html } = correoResumenSemanal(kpisValidos, fechaCorte, denegaciones, reparto, marca);

  // 6) Envía
  const resultado = await enviarEmailResend(apiKey, {
    from: FROM_EMAIL,
    to: destinatarios,
    subject,
    html,
  });
  console.log(`Resumen enviado a ${destinatarios.length} destinatarios de ${orgRaiz}. Resend ID: ${resultado.id}`);
  return {
    enviados: destinatarios.length, destinatarios, resendId: resultado.id,
    // Viaja al registro de salud para que la exclusión quede medida y no sólo
    // dicha en el correo de esta semana.
    orgId: orgRaiz,
    sinOrg: reparto.sinOrg.map(u => u.email).filter(Boolean),
    excluidosDeOtraOrg: reparto.deOtra.length,
  };
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
    await registrarFalloDeSalud("email_semanal", e, { duracionMs: Date.now() - t0 });
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
  // Sin `operationName` no hay nada que vigilar. El export puede haber
  // arrancado, pero un respaldo que no se puede verificar no se puede
  // declarar bueno, y éste es el renglón del panel que menos puede mentir.
  if (!data.name) {
    throw new Error(
      `El export arrancó pero no devolvió operationName, así que no hay forma ` +
      `de saber si terminó. Respuesta: ${JSON.stringify(data)}`);
  }
  return { destino, operationName: data.name };
}

// ── EL FINAL DEL EXPORT, NO SU ARRANQUE (#77) ──────────────────────────────
//
// `:exportDocuments` es una operación de larga duración: el POST vuelve en
// milisegundos con un `operationName` y el trabajo sigue en background. Hasta
// el 2026-10-23 el registro de salud se escribía con ese POST y decía
// `ok: true, "Iniciado: …"`. O sea: el panel se ponía VERDE por haber pedido
// el respaldo, no por tenerlo.
//
// Eso no es un matiz. El export falla después del arranque por cosas
// corrientes —se acabó el permiso al bucket, el prefijo ya existe, lo cancelan—
// y en todas el panel seguía verde. Un respaldo es justo lo que uno mira
// cuando ya perdió lo demás: es el último renglón que puede permitirse
// mentir. El 2026-09-21 hay un ROJO en `backup_historial` que sí se vio sólo
// porque el POST mismo devolvió 400; si hubiera reventado un minuto después,
// nadie se entera.
//
// Ahora la corrida espera a que la operación llegue a un estado TERMINAL y
// registra ése. Tres salidas, no dos:
//
//   SUCCESSFUL           → ok: true.   El respaldo existe.
//   FAILED / CANCELLED   → ok: false.  El respaldo no existe.
//   no terminó a tiempo  → ok: false.  NO SABEMOS si existe.
//
// La tercera es la que importa y por eso no es verde: «no se pudo verificar»
// no es «salió bien». Se distingue de la segunda en el mensaje y en
// `verificado`, porque la reacción es distinta —ir a mirar el bucket contra
// arreglar el export—, pero ninguna de las dos pinta verde.

// Lo que Firestore reporta en `metadata.operationState`.
const EXPORT_TERMINAL_OK = "SUCCESSFUL";
const EXPORT_TERMINAL_MAL = ["FAILED", "CANCELLED"];

/**
 * Traduce una operación de export a `{terminal, ok, estado, detalle}`.
 *
 * Separada del bucle a propósito: es la regla que decide si un respaldo
 * cuenta, y se puede correr contra respuestas concretas sin red.
 */
function clasificarExport(op) {
  const estado = op?.metadata?.operationState || "";
  const err = op?.error;
  const detalleErr = err
    ? `${err.message || JSON.stringify(err)}${err.code != null ? ` (code ${err.code})` : ""}`
    : "";

  if (EXPORT_TERMINAL_MAL.includes(estado)) {
    return { terminal: true, ok: false, estado, detalle: detalleErr || "sin detalle" };
  }
  if (op?.done === true) {
    if (err) return { terminal: true, ok: false, estado: estado || "FAILED", detalle: detalleErr };
    // `done` sin error y sin estado explícito: la operación cerró bien. Si el
    // estado viene y NO es SUCCESSFUL, mandan los hechos y no el optimismo.
    if (estado && estado !== EXPORT_TERMINAL_OK) {
      return { terminal: true, ok: false, estado, detalle: "terminó en un estado que no es SUCCESSFUL" };
    }
    return { terminal: true, ok: true, estado: estado || EXPORT_TERMINAL_OK, detalle: "" };
  }
  const p = op?.metadata?.progressDocuments;
  return {
    terminal: false, ok: false, estado: estado || "PROCESSING",
    detalle: p ? `${p.completedWork || 0}/${p.estimatedWork || "?"} documentos` : "",
  };
}

/** Lee el estado actual de la operación contra la API de Firestore. */
async function leerOperacionExport(operationName) {
  const accessToken = await admin.app().options.credential.getAccessToken();
  const token = accessToken.access_token || accessToken;
  const resp = await fetch(`https://firestore.googleapis.com/v1/${operationName}`, {
    headers: { "Authorization": `Bearer ${token}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`No se pudo consultar el export (HTTP ${resp.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

/**
 * Espera a que el export llegue a un estado terminal, o se rinde con el plazo.
 *
 * `leer`, `dormir` y `ahora` se inyectan para poder ejercitar el bucle de
 * verdad —no una copia suya— sin red y sin esperar minutos reales.
 *
 * Un fallo al CONSULTAR no se confunde con un fallo del export: se reintenta
 * hasta agotar el plazo y, si nunca se pudo leer, la salida es «sin verificar»
 * con el error de lectura en el detalle. Son dos averías con dos reacciones.
 */
async function esperarFinDelExport(operationName, {
  plazoMs = 7 * 60 * 1000,
  pausaMs = 15 * 1000,
  leer = leerOperacionExport,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora = () => Date.now(),
} = {}) {
  const t0 = ahora();
  let intentos = 0;
  let ultimo = { estado: "DESCONOCIDO", detalle: "" };

  for (;;) {
    intentos++;
    try {
      const c = clasificarExport(await leer(operationName));
      if (c.terminal) {
        return { ...c, verificado: true, intentos, esperaMs: ahora() - t0 };
      }
      ultimo = c;
    } catch (e) {
      ultimo = { estado: "ILEGIBLE", detalle: e?.message || String(e) };
    }
    if (ahora() - t0 + pausaMs >= plazoMs) {
      return {
        terminal: false, ok: false, verificado: false,
        estado: ultimo.estado, detalle: ultimo.detalle,
        intentos, esperaMs: ahora() - t0,
      };
    }
    await dormir(pausaMs);
  }
}

/** El renglón que va al panel de salud y al historial. Sin cifras inventadas. */
function mensajeDeRespaldo(destino, r) {
  const seg = Math.round((r.esperaMs || 0) / 1000);
  if (r.verificado && r.ok) return `Completado: ${destino} (verificado en ${seg} s)`;
  if (r.verificado) return `El export terminó en ${r.estado}: ${r.detalle || "sin detalle"} · ${destino}`;
  return (
    `SIN VERIFICAR tras ${seg} s: el export arrancó y a esta hora seguía en ` +
    `${r.estado}${r.detalle ? ` (${r.detalle})` : ""}. No se sabe si el respaldo ` +
    `quedó completo — hay que mirar ${destino} a mano.`
  );
}

// SCHEDULED: domingo 3:00 a.m. hora México (baja actividad)
//
// `timeoutSeconds` sube a 540 porque ahora la corrida ESPERA al export. El
// plazo de espera (420 s) queda deliberadamente por debajo: si la función se
// muriera por timeout no escribiría nada y el panel diría «sin correr», que es
// otra mentira. Rendirse a tiempo y escribir «sin verificar» es lo correcto.
exports.backupSemanalFirestore = onSchedule({
  schedule: "0 3 * * 0",
  timeZone: "America/Mexico_City",
  region: "us-central1",
  timeoutSeconds: 540,
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando backup semanal de Firestore…");
  try {
    const res = await ejecutarBackupFirestore();
    console.log(`Export lanzado. Destino: ${res.destino}, Op: ${res.operationName}`);
    const fin = await esperarFinDelExport(res.operationName, { plazoMs: 420 * 1000 });
    const mensaje = mensajeDeRespaldo(res.destino, fin);
    console.log(`Backup: ${mensaje}`);
    await registrarSalud("backup", fin.ok, mensaje, {
      duracionMs: Date.now() - t0,
      destino: res.destino,
      operationName: res.operationName,
      estadoExport: fin.estado,
      verificado: fin.verificado,
      consultas: fin.intentos,
    });
  } catch (e) {
    console.error("Error en backup semanal:", e);
    await registrarFalloDeSalud("backup", e, { duracionMs: Date.now() - t0 });
    throw e;
  }
});

// CALLABLE: lanzar backup manualmente (solo director_general / admin_sistema)
//
// Espera al export igual que la corrida semanal, con un plazo corto para no
// pasarse del tiempo que un cliente aguanta. Devuelve `verificado` aparte de
// `ok` justamente para que «no me alcanzó el tiempo» no se lea como «salió
// bien»: antes esto devolvía `ok: true` por haber arrancado.
exports.probarBackup = onCall({ region: "us-central1", timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const email = (request.auth.token.email || "").toLowerCase();
  const perfilSnap = await admin.firestore().doc(`usuarios/${emailAId(email)}`).get();
  const rol = perfilSnap.exists ? perfilSnap.data().rol : null;
  if (!["director_general", "admin_sistema"].includes(rol)) {
    throw new HttpsError("permission-denied", "Solo dirección o admin puede lanzar backup.");
  }
  try {
    const res = await ejecutarBackupFirestore();
    const fin = await esperarFinDelExport(res.operationName, { plazoMs: 90 * 1000, pausaMs: 10 * 1000 });
    return {
      ok: fin.ok,
      verificado: fin.verificado,
      estado: fin.estado,
      mensaje: mensajeDeRespaldo(res.destino, fin),
      destino: res.destino,
      operationName: res.operationName,
    };
  } catch (e) {
    throw new HttpsError("internal", `Error en backup: ${e.message}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RECORDATORIOS DE CAPTURA (A1-A4)
// ─────────────────────────────────────────────────────────────────────────
// Escribe notificaciones INTERNAS en notificaciones/{uid}/items para que
// aparezcan en la campana de CAMPO. En una siguiente fase estos mismos
// eventos se emitirán como push nativos (FCM).
//
// A1 · Viernes 10am: recordatorio de captura semanal — obra
//      Para residente/superintendente/administrador_obra
// A2 · Viernes 12pm: recordatorio de captura semanal — subcontratos
//      Para los mismos + PM (supervisor)
// A3 · Lunes 9am: alerta "3+ pendientes en Operación"
// A4 · Lunes 9am: alerta "10+ días sin capturar"
// ═══════════════════════════════════════════════════════════════════════════

// Helper: semana ISO {sem, año} para una fecha dada
function semanaISOFn(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const inicioAño = new Date(d.getFullYear(), 0, 1);
  return {
    semana: Math.ceil(((d - inicioAño) / 86400000 + 1) / 7),
    año: d.getFullYear(),
  };
}
function snapIdFn(sem, año) { return `S${String(sem).padStart(2, "0")}-${año}`; }

// Helper: crear notificación interna para 1 usuario
async function crearNotifCloud(uid, { categoria, tipo, titulo, mensaje, link }) {
  try {
    await admin.firestore()
      .collection(`notificaciones/${uid}/items`)
      .add({
        categoria: categoria || "recordatorio",
        tipo: tipo || "generic",
        titulo,
        mensaje,
        link: link || null,
        leida: false,
        fecha: FieldValue.serverTimestamp(),
        creadaPor: "sistema:recordatorios",
      });
  } catch (e) {
    console.warn(`crearNotifCloud fallo para uid=${uid}:`, e.message);
  }
}

// Helper: lista de usuarios activos que pueden capturar avance en una obra
// (Superintendente, Residente, Admin de Obra) según usuario.obras_asignadas.
// Filtra: solo usuarios ACTIVOS con la obra en su lista.
// `orgId` es obligatorio: estas obras son las de la raíz y el aviso sólo va a
// quien es de esa organización. El rol y `obras_asignadas` no son frontera —un
// id de obra que coincida basta para que un aviso con el nombre de la obra
// caiga en la bandeja de otro cliente—. Ver `orgDeLaRaiz`.
//
// De paso, `activo` pasa a mirarse en memoria. La consulta decía
// `where("activo", "!=", false)`, y en Firestore una desigualdad DESCARTA los
// documentos que no traen el campo: un perfil sin `activo` —que es un perfil
// activo— no recibía un solo aviso. Hoy los 14 perfiles de producción lo
// traen, así que esto no cambia ningún envío; cambia el día que alguien dé de
// alta una cuenta a mano.
async function usuariosCapturaDeObra(obraId, orgId, incluirSupervisor = false) {
  const rolesCaptura = ["superintendente", "residente", "administrador_obra"];
  if (incluirSupervisor) rolesCaptura.push("supervisor");
  const snap = await admin.firestore().collection("usuarios")
    .where("orgId", "==", orgId).get();
  const out = [];
  snap.forEach(doc => {
    const u = doc.data();
    if (u.activo === false) return;
    if (!rolesCaptura.includes(u.rol)) return;
    const asignadas = Array.isArray(u.obras_asignadas) ? u.obras_asignadas : [];
    if (asignadas.includes(obraId)) {
      out.push({ uid: u.uid || doc.id, email: u.email, nombre: u.nombre, rol: u.rol });
    }
  });
  return out;
}

// Helper: obtener nombre corto (o largo) de la obra para la notificación
function nombreObraNotif(obra) {
  const n = String(obra.nombre || obra.id || "obra");
  return n.replace(/^\d{4}\s+/, "").replace(/\s+\d{4}\s*$/, "").trim() || n;
}

// A1 · Viernes 10am — Recordatorio de captura semanal (obra)
exports.recordatorioCapturaObra = onSchedule({
  schedule: "0 10 * * 5",   // viernes 10:00
  timeZone: "America/Mexico_City",
  region: "us-central1",
}, async () => {
  const t0 = Date.now();
  try {
    const { semana, año } = semanaISOFn(new Date());
    const idSem = snapIdFn(semana, año);
    // De quién son estas obras. Si no se puede contestar, no se avisa a nadie:
    // ver `orgDeLaRaiz`. El `throw` lo recoge el `catch` de abajo, y Scheduler
    // lo cuenta como fallo, que es lo que tiene que pasar.
    const orgRaiz = await orgDeLaRaiz(admin.firestore());
    const obrasSnap = await admin.firestore().collection("obras").get();
    let contadorNotifs = 0;
    let obrasSinCaptura = 0;

    for (const obraDoc of obrasSnap.docs) {
      const obra = { id: obraDoc.id, ...obraDoc.data() };
      if (obra.estado === "archivada") continue;

      // ¿Hay snapshot esta semana?
      const histSnap = await admin.firestore()
        .doc(`obras/${obra.id}/avance/historial`).get();
      const semanas = histSnap.exists ? (histSnap.data().semanas || []) : [];
      const yaCapturado = semanas.some(s => s.id === idSem);
      if (yaCapturado) continue;

      obrasSinCaptura++;
      const usuarios = await usuariosCapturaDeObra(obra.id, orgRaiz, false);
      const nombreCorto = nombreObraNotif(obra);
      for (const u of usuarios) {
        if (!u.uid) continue;
        await crearNotifCloud(u.uid, {
          categoria: "recordatorio",
          tipo: "captura_obra_pendiente",
          titulo: `Cierre semanal · ${nombreCorto}`,
          mensaje: `Falta capturar avance físico de la S${semana}. Aprovecha antes del corte del viernes.`,
          link: { tab: "operacion", subTab: "avance", obraId: obra.id },
        });
        contadorNotifs++;
      }
    }
    await registrarSalud("recordatorio_obra", true,
      `${contadorNotifs} notifs a ${obrasSinCaptura} obras sin capturar`,
      { duracionMs: Date.now() - t0, obrasSinCaptura, notifsEnviadas: contadorNotifs });
  } catch (e) {
    console.error("recordatorioCapturaObra falló:", e);
    await registrarFalloDeSalud("recordatorio_obra", e, { duracionMs: Date.now() - t0 });
    // Sin este `throw`, Scheduler da la corrida por EXITOSA aunque el trabajo
    // haya reventado: no reintenta, no alerta, y la única señal queda en un
    // registro que nadie abre. Es el #75 en el otro extremo — allá el canal
    // que avisa se callaba, aquí el trabajo. Ver el barrido completo en el
    // banco `prueba-cron-que-no-se-traga-su-fallo.cjs`, que lo exige de los
    // SEIS trabajos programados, no de éste.
    throw e;
  }
});

// A2 · Aquí vivía `recordatorioCapturaSubs` (viernes 12:00).
// Retirado el 2026-09-22 junto con el histórico semanal de subcontratos.
// Preguntaba por `obras/{id}/subcontratos/historial_{subId}`, que ya no lo
// escribe nadie: pedía un cierre que el sistema no puede registrar. Antes ni
// siquiera podía acertar —el documento nunca existió, así que `yaCapturado`
// era falso para siempre— y estaba callado solo porque ningún sub tiene
// conceptos capturados. Si se revive el histórico, este recordatorio vuelve
// con él: ver PENDIENTES #31.

// A3+A4 · Lunes 9am — alertas de arranque de semana
// A3: obras con 3+ pendientes en Operación (avance viejo, almacén/maq/nómina viejo)
// A4: obras con última captura >10 días
exports.recordatorioLunes = onSchedule({
  schedule: "0 9 * * 1",   // lunes 09:00
  timeZone: "America/Mexico_City",
  region: "us-central1",
}, async () => {
  const t0 = Date.now();
  try {
    const hoy = new Date();
    // De quién son estas obras. Ver `orgDeLaRaiz`.
    const orgRaiz = await orgDeLaRaiz(admin.firestore());
    const obrasSnap = await admin.firestore().collection("obras").get();
    let contadorNotifs = 0;

    for (const obraDoc of obrasSnap.docs) {
      const obra = { id: obraDoc.id, ...obraDoc.data() };
      if (obra.estado === "archivada") continue;

      // Sumar pendientes: mismo criterio que el numerito rojo del frontend
      let pendientes = 0;
      const razones = [];

      // (a) ¿Se cerró la semana pasada?
      const histSnap = await admin.firestore()
        .doc(`obras/${obra.id}/avance/historial`).get();
      const semanas = histSnap.exists ? (histSnap.data().semanas || []) : [];
      // La MISMA cuenta que el tablero de la obra. `null` = nunca se cerró una
      // semana, o la fecha guardada no es una fecha.
      const fechaUltima = fechaUltimaCapturaDe(semanas);
      const diasDesdeUltima = diasSinCapturaDe(semanas, hoy.getTime());
      const nuncaSeCerro = diasDesdeUltima === null;
      // Una obra sin un solo cierre tiene el cierre semanal pendiente: eso no
      // se deduce de un número grande, se dice.
      if (nuncaSeCerro || diasDesdeUltima > 7) { pendientes++; razones.push("cierre semanal"); }

      // (b) Almacén — leer materiales
      const matSnap = await admin.firestore()
        .doc(`obras/${obra.id}/avance/materiales`).get();
      if (matSnap.exists) {
        const mats = matSnap.data().data || [];
        const conMats = mats.filter(m => m.desc && m.desc.trim() && (parseFloat(m.imp) || 0) > 0);
        if (conMats.length > 0) {
          const upd = matSnap.updateTime?.toDate?.() || null;
          if (upd && (hoy - upd) / 86400000 > 7) {
            pendientes++;
            razones.push("almacén");
          }
        }
      }

      // (c) Maquinaria
      const maqSnap = await admin.firestore()
        .doc(`obras/${obra.id}/avance/maquinaria`).get();
      if (maqSnap.exists) {
        const maq = maqSnap.data().data || [];
        const conMaq = maq.filter(m => m.desc && m.desc.trim() && (parseFloat(m.imp) || 0) > 0);
        if (conMaq.length > 0) {
          const upd = maqSnap.updateTime?.toDate?.() || null;
          if (upd && (hoy - upd) / 86400000 > 7) {
            pendientes++;
            razones.push("maquinaria");
          }
        }
      }

      // Notif A3: 3+ pendientes
      if (pendientes >= 3) {
        const usuarios = await usuariosCapturaDeObra(obra.id, orgRaiz, false);
        const nombreCorto = nombreObraNotif(obra);
        for (const u of usuarios) {
          if (!u.uid) continue;
          await crearNotifCloud(u.uid, {
            categoria: "recordatorio",
            tipo: "pendientes_lunes",
            titulo: `${pendientes} pendientes esta semana · ${nombreCorto}`,
            mensaje: `Aún faltan por capturar: ${razones.join(", ")}.`,
            link: { tab: "operacion", obraId: obra.id },
          });
          contadorNotifs++;
        }
      }

      // Notif A4: sin capturar en 10+ días, o sin capturar NUNCA.
      //
      // El `< 300` que estaba aquí no filtraba obras viejas: filtraba el 999
      // que esta misma función se inventaba cuando no había fecha. O sea que
      // la obra que jamás capturó —la que más falta hace avisar— era
      // exactamente la única que no disparaba la alerta.
      if (nuncaSeCerro || diasDesdeUltima > 10) {
        // También al gerente / dirección de operaciones
        const usuariosObra = await usuariosCapturaDeObra(obra.id, orgRaiz, false);
        // Por organización, no por nombre de rol. La alerta lleva el nombre de
        // la obra y cuántos días lleva sin captura; eso es operación de la
        // constructora. Se acota en la consulta por `orgId` y el rol se filtra
        // en memoria a propósito: un `==` sobre `orgId` más un `in` sobre `rol`
        // pide un índice compuesto, y un trabajo semanal que revienta por un
        // índice que falta es un trabajo que deja de avisar.
        const gerentesSnap = await admin.firestore().collection("usuarios")
          .where("orgId", "==", orgRaiz).get();
        const ROLES_ALERTA_CAPTURA = ["gerente_construccion", "director_operaciones"];
        const gerentes = [];
        gerentesSnap.forEach(d => {
          const u = d.data();
          if (u.activo === false || !ROLES_ALERTA_CAPTURA.includes(u.rol)) return;
          gerentes.push({ uid: u.uid || d.id, email: u.email, nombre: u.nombre });
        });
        const receptores = [...usuariosObra, ...gerentes];
        const nombreCorto = nombreObraNotif(obra);
        for (const u of receptores) {
          if (!u.uid) continue;
          await crearNotifCloud(u.uid, {
            categoria: "alerta",
            tipo: "sin_captura_10d",
            // Sin cierres no hay número de días que decir, y escribir uno
            // sería inventarlo. Se dice lo que se sabe.
            titulo: nuncaSeCerro
              ? `Sin una sola captura · ${nombreCorto}`
              : `Sin captura hace ${diasDesdeUltima} días · ${nombreCorto}`,
            mensaje: nuncaSeCerro
              ? "Esta obra no tiene ningún cierre semanal registrado. Revisar con el equipo."
              : `La última captura fue el ${fechaUltima.slice(0, 10)}. Revisar con el equipo.`,
            link: { tab: "dash", obraId: obra.id },
          });
          contadorNotifs++;
        }
      }
    }
    await registrarSalud("recordatorio_lunes", true,
      `${contadorNotifs} notifs enviadas`,
      { duracionMs: Date.now() - t0, notifsEnviadas: contadorNotifs });
  } catch (e) {
    console.error("recordatorioLunes falló:", e);
    await registrarFalloDeSalud("recordatorio_lunes", e, { duracionMs: Date.now() - t0 });
    // Ver el comentario de `recordatorioCapturaObra`: un trabajo que no lanza
    // es un trabajo que Scheduler cuenta como bueno.
    throw e;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CUSTOM CLAIMS — sincronización del rol al token de Firebase Auth
// ─────────────────────────────────────────────────────────────────────────
// Las reglas de Firestore/Storage necesitan conocer el rol y las obras
// asignadas del usuario SIN hacer un read por cada operación (costo + latencia).
// Se guardan como custom claims en el token JWT de Auth:
//   claims = { rol, orgId, tipo, todas, obras }
//     · rol   → PERMISOS[rol] define qué puede leer/escribir por módulo
//     · orgId → id de la organización a la que pertenece (null para 'soporte')
//     · tipo  → 'constructora' | 'dependencia' | null (para 'soporte')
//     · todas → true = ve todas las obras de su org, false = solo asignadas
//     · obras → array de IDs de obras cuando todas=false
//
// Peor caso ~350 bytes: cabe holgado en los 1000 bytes permitidos por token.
//
// Trigger: cada vez que se escribe usuarios/{docId} — reactivo, no requiere
// modificar crearUsuario/actualizarUsuario (siguen escribiendo el doc igual).
// ════════════════════════════════════════════════════════════════════════════

// Roles con acceso a todas las obras de SU organización (todas_obras=true).
// Nota: el tipo de organización a la que aplica cada rol se valida contra
// ROLES_POR_TIPO en aplicarClaimsUsuario.
const ROLES_TODAS_OBRAS = new Set([
  // constructora
  "director_general",
  "director_operaciones",
  "gerente_construccion",
  "admin_sistema",
  // dependencia
  "director_obras",
  "subdirector",
  "jefe_supervision",
  "contralor",
]);

// Devuelve el tipo ('constructora' | 'dependencia') al que pertenece el rol,
// o null si es cross-tipo (soporte) o rol desconocido.
function tipoDeRol(rol) {
  if (ROLES_POR_TIPO.constructora.includes(rol)) return "constructora";
  if (ROLES_POR_TIPO.dependencia.includes(rol)) return "dependencia";
  return null;
}

// Lee /orgs/{orgId} y devuelve { tipo, activa } o null si no existe.
async function leerOrg(orgId) {
  if (!orgId) return null;
  const snap = await admin.firestore().doc(`orgs/${orgId}`).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  return { tipo: d.tipo || null, activa: d.activa !== false, nombre: d.nombre || null };
}

// Aplica los custom claims correspondientes a un perfil Firestore.
// Retorna { ok:true, uid, claims } o { ok:false, motivo }.
async function aplicarClaimsUsuario(perfil) {
  const email = (perfil.email || "").toLowerCase().trim();
  if (!email) return { ok: false, motivo: "sin_email" };
  const rol = perfil.rol;
  if (!rol || !ROLES_VALIDOS.includes(rol)) {
    return { ok: false, motivo: "rol_invalido", rol };
  }
  // Resolver organización y tipo
  const esCross = ROLES_CROSS.includes(rol);
  let orgId = null;
  let tipo = null;
  if (!esCross) {
    orgId = perfil.orgId || null;
    // Compatibilidad hacia atrás: si el perfil aún no tiene orgId (etapa
    // previa a la migración), NO fallamos — asumimos org por defecto null
    // y las reglas denegarán hasta que el script crear-org-fosmon.js corra.
    if (orgId) {
      const org = await leerOrg(orgId);
      if (!org) return { ok: false, motivo: "org_no_existe", orgId };
      if (!org.activa) return { ok: false, motivo: "org_inactiva", orgId };
      tipo = org.tipo;
      // Validar que el rol pertenece al tipo de la org
      const rolesDelTipo = ROLES_POR_TIPO[tipo] || [];
      if (!rolesDelTipo.includes(rol)) {
        return { ok: false, motivo: "rol_no_pertenece_tipo", rol, tipo };
      }
    }
  }
  // Localizar usuario en Auth
  let userRecord;
  try {
    userRecord = perfil.uid
      ? await admin.auth().getUser(perfil.uid).catch(() => null)
      : null;
    if (!userRecord) userRecord = await admin.auth().getUserByEmail(email);
  } catch (e) {
    return { ok: false, motivo: "auth_no_encontrado", email, err: e.message };
  }
  const todas = ROLES_TODAS_OBRAS.has(rol);
  const obras = todas
    ? []
    : (Array.isArray(perfil.obras_asignadas) ? perfil.obras_asignadas.map(String) : []);
  const activo = perfil.activo !== false;
  const claims = activo
    ? { rol, orgId, tipo, todas, obras }
    : { rol: null, orgId: null, tipo: null, todas: false, obras: [], inactivo: true };
  // Guardarraíl: verificar que el claim no supere los 1000 bytes del token
  const claimBytes = Buffer.byteLength(JSON.stringify(claims), "utf8");
  if (claimBytes > 900) {  // margen de 100 bytes por headers/firmas de Firebase
    return { ok: false, motivo: "claim_muy_grande", bytes: claimBytes };
  }
  // Solo actualizar si difieren, evita invalidar tokens innecesariamente
  const existentes = userRecord.customClaims || {};
  const iguales =
    existentes.rol === claims.rol &&
    existentes.orgId === claims.orgId &&
    existentes.tipo === claims.tipo &&
    existentes.todas === claims.todas &&
    JSON.stringify(existentes.obras || []) === JSON.stringify(claims.obras || []) &&
    (existentes.inactivo || false) === (claims.inactivo || false);
  if (iguales) {
    return { ok: true, uid: userRecord.uid, claims, sinCambios: true };
  }
  await admin.auth().setCustomUserClaims(userRecord.uid, claims);
  return { ok: true, uid: userRecord.uid, claims };
}

// TRIGGER: se dispara cada vez que se crea o actualiza un doc usuarios/{docId}
//
// fix/refresh-token (2026-09-16): además de mantener los custom claims al día,
// esta función incrementa `claimsVersion` en el propio doc cuando los claims
// resultantes cambian. El cliente escucha ese campo con onSnapshot y, al
// detectar el incremento, llama getIdToken(true) para traer un JWT nuevo con
// los claims actualizados. Reemplaza la espera de hasta ~1 hora al auto-refresh.
//
// GUARDARRAÍL ANTI-BUCLE: cuando esta CF actualiza `claimsVersion` +
// `_claimsSyncedAt`, ese update dispara sincronizarClaims otra vez. Para no
// bucear, si detectamos que los ÚNICOS campos que cambiaron respecto al doc
// previo son esos dos marcadores internos, retornamos sin hacer nada.
exports.sincronizarClaims = onDocumentWritten(
  { document: "usuarios/{docId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    // Documento eliminado → limpiar claims del user en Auth (si sigue existiendo)
    if (!after) {
      const before = event.data?.before?.data();
      if (!before?.email) return null;
      try {
        const user = await admin.auth().getUserByEmail(String(before.email).toLowerCase());
        await admin.auth().setCustomUserClaims(user.uid, { rol: null, orgId: null, tipo: null, todas: false, obras: [], inactivo: true });
        console.log(`sincronizarClaims: limpiado claims de ${before.email} (doc eliminado)`);
      } catch (e) {
        console.warn("sincronizarClaims: no se pudo limpiar claims tras delete:", e.message);
      }
      return null;
    }

    // Anti-bucle: si el update trae SOLO los marcadores internos que la propia
    // CF escribe, esto es un eco del incremento previo. Nada que hacer.
    const before = event.data?.before?.data();
    if (before) {
      const camposInternos = new Set(["claimsVersion", "_claimsSyncedAt"]);
      const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
      let algoNoInternoCambio = false;
      for (const k of allKeys) {
        if (camposInternos.has(k)) continue;
        // Compara por serialización JSON (arrays/objetos anidados)
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
          algoNoInternoCambio = true;
          break;
        }
      }
      if (!algoNoInternoCambio) {
        // Solo cambiaron claimsVersion/_claimsSyncedAt → es nuestro propio update
        return null;
      }
    }

    const res = await aplicarClaimsUsuario(after);
    if (!res.ok) {
      console.warn(`sincronizarClaims [${event.params.docId}] no aplicó:`, res);
      return null;
    }
    if (res.sinCambios) {
      // Claims idénticos a los que ya tenía Auth: no invalidamos token, no
      // incrementamos claimsVersion. El cliente NO se entera.
      return null;
    }
    // Claims realmente cambiaron y ya se escribieron en Auth. Ahora
    // incrementamos claimsVersion para que el cliente refresque su token.
    // ORDEN IMPORTANTE: primero setCustomUserClaims (ya hecho por
    // aplicarClaimsUsuario), luego el increment. Si se invirtiera, el
    // snapshot podría llegarle al cliente antes que el token nuevo esté
    // disponible en Auth.
    try {
      await admin.firestore().doc(`usuarios/${event.params.docId}`).update({
        claimsVersion: FieldValue.increment(1),
        _claimsSyncedAt: FieldValue.serverTimestamp(),
      });
      console.log(`sincronizarClaims [${event.params.docId}] rol=${res.claims.rol} orgId=${res.claims.orgId} tipo=${res.claims.tipo} todas=${res.claims.todas} obras=${(res.claims.obras||[]).length} — claimsVersion incrementado`);
    } catch (e) {
      // Si el increment falla, no es catastrófico: los claims YA están en Auth,
      // el usuario los recibirá en el próximo auto-refresh (~1h) o al re-login.
      // Log para investigar.
      console.error(`sincronizarClaims [${event.params.docId}] no pudo incrementar claimsVersion:`, e.message);
    }
    return null;
  }
);

// ════════════════════════════════════════════════════════════════════════════
// OBRA NUEVA — el aviso que el cliente no podía mandar  (#85)
// ════════════════════════════════════════════════════════════════════════════
// El alta de una obra la hace el NAVEGADOR: `agregarObra` escribe
// `obras/{id}` directo (src/App.jsx). El aviso lo intentaba ahí mismo con
// `notifARoles`, que para saber a quién avisarle tiene que LISTAR `usuarios`;
// la regla de esa colección sólo se lo permite a un admin de la organización,
// y `gerente_construccion` —uno de los dos roles que pueden dar de alta una
// obra— no lo es. El `catch` se tragaba el permission-denied y el alta se
// consumaba sin que nadie se enterara. Medido en el preview el 2026-11-02.
//
// Desde un disparador no hay regla que denegar, así que el aviso dejó de
// depender del rol de quien dio el alta. Y de paso sale por correo, que es lo
// que se pidió: quien no abre la app no se enteraba nunca.
//
// ── DOS DISPARADORES Y NO UNO ──
// Las obras de la constructora viven en `obras/{id}` y las de una dependencia
// en `orgs/{oid}/obras/{id}` (ver `src/rutas-org.js`). Un solo disparador en
// la raíz habría dejado a todas las dependencias sin aviso, y el defecto se
// vería como "a unos les llega y a otros no", que es el más difícil de
// atribuir. Los dos llaman al mismo cuerpo: lo único que cambia es de dónde
// sale el `orgId`.
async function avisarObraNueva({ orgId, obraId, obra, apiKey }) {
  if (!orgId || !obraId || !obra) {
    console.error(`[obra-nueva] falta algo: orgId=${orgId} obraId=${obraId}`);
    return { ok: false, motivo: "datos-incompletos" };
  }
  // El tipo se LEE, no se supone. De él dependen tres cosas que no se pueden
  // adivinar: a qué roles les toca el aviso, cómo se llama la cifra, y dónde
  // están las obras. Si no se puede leer, no se manda nada — el mismo criterio
  // que `orgDeLaRaiz`: un destinatario adivinado es una cifra inventada.
  const org = await leerOrg(orgId);
  const tipo = org?.tipo || null;
  if (!tipo) {
    console.error(`[obra-nueva] ${obraId}: no se pudo leer el tipo de \`${orgId}\`; no se avisa a nadie.`);
    return { ok: false, motivo: "tipo-desconocido" };
  }

  const marca = await marcaDeOrg(orgId);
  const perfiles = await perfilesDeOrg(orgId);
  const porRol = ROLES_CORREO_OBRA_NUEVA[tipo] || [];

  // Dos vías para entrar en la lista, y la unión de las dos es lo que pidió
  // Omar: "al gerente y a quienes estén asignados a esa obra". El gerente
  // entra por su rol; los asignados entran aunque su rol no esté en la lista,
  // porque la obra es suya. Lo que ninguna de las dos vías puede meter es un
  // rol ajeno a la casa — ver `ROLES_AJENOS_A_LA_CASA`.
  const destinatarios = perfiles.filter(u => {
    if (ROLES_AJENOS_A_LA_CASA.includes(u.rol)) return false;
    const asignado = Array.isArray(u.obras_asignadas) && u.obras_asignadas.includes(obraId);
    return porRol.includes(u.rol) || asignado;
  });

  const { subject, html } = correoObraNueva({
    marca, tipo, obraId, obra,
    dioElAlta: String(obra.creadaPor || "").trim(),
  });
  const correo = await mandarCorreoDeAlta(apiKey, {
    to: destinatarios.map(u => u.email),
    subject, html, concepto: `obra-nueva:${obraId}`,
  });

  // Y el aviso en la campana, que es el que se perdía. Se crea aquí por la
  // misma razón por la que se perdía allá: el servidor no tiene que pedirle
  // permiso a una regla para saber a quién avisarle.
  // El mismo nombre que el correo. La campana es un título de una línea: ahí
  // 236 caracteres de descripción legal no se recortan, se cortan.
  const nombreObra = String(obra.nombre || "").trim() || obraId;
  const contraparte = tipo === "dependencia"
    ? String(obra.empresaEjecutante || "").trim()
    : String(obra.cliente || "").trim();
  const monto = Number(obra.presupuesto) || 0;
  const notifs = await crearNotifServidor(destinatarios.map(u => u.uid), {
    categoria: "gestion", tipo: "obra_nueva",
    titulo: `Nueva obra · ${nombreObra}`,
    mensaje: `${contraparte || (tipo === "dependencia" ? "Sin empresa ejecutante" : "Sin cliente")} · ` +
      `${tipo === "dependencia" ? "Monto contratado" : "Presupuesto"}: ` +
      // El mismo criterio que el correo: sin captura no se pinta "$0".
      `${monto > 0 ? MXN_FMT(monto) : "sin capturar"} · ID ${obraId}`,
    link: { obraId, tab: "dash" },
    creadaPor: String(obra.creadaPor || "").trim() || "sistema",
  });

  console.log(`[obra-nueva] ${obraId} (${tipo}/${orgId}): ${destinatarios.length} destinatario(s), ` +
    `correo=${correo.ok ? "enviado" : correo.motivo}, campana=${notifs}`);
  return { ok: true, destinatarios: destinatarios.length, correo, notifs };
}

// `crearNotifPara` de la app, del lado del servidor. No se comparte código con
// el cliente —son dos paquetes, uno ESM empacado por Vite y otro CommonJS— así
// que lo que se comparte es la FORMA del documento, y por eso está escrita en
// un solo sitio aquí: `notificaciones/{uid}/items/{autoId}` con los campos que
// `CentroNotificaciones` lee.
async function crearNotifServidor(uids, { categoria, tipo, titulo, mensaje, link, creadaPor }) {
  const limpios = [...new Set((uids || []).filter(Boolean))];
  if (!limpios.length) return 0;
  const db = admin.firestore();
  const batch = db.batch();
  for (const uid of limpios) {
    batch.set(db.collection(`notificaciones/${uid}/items`).doc(), {
      categoria, tipo, titulo,
      mensaje: mensaje || "",
      link: link || {},
      leida: false,
      archivada: false,
      fecha: FieldValue.serverTimestamp(),
      creadaPor: creadaPor || "sistema",
    });
  }
  try {
    await batch.commit();
    return limpios.length;
  } catch (e) {
    console.error("crearNotifServidor: no quedó el aviso en la campana:", e.message);
    return 0;
  }
}

// La raíz es de la constructora, y de cuál se pregunta —no se supone. Ver
// `orgDeLaRaiz`: si hubiera dos constructoras lanza, y entonces este aviso no
// sale en lugar de salirle a la organización equivocada con el monto de la
// otra.
exports.obraNuevaRaiz = onDocumentCreated(
  { document: "obras/{obraId}", region: "us-central1", secrets: [RESEND_API_KEY] },
  async (event) => {
    const obra = event.data?.data();
    if (!obra) return null;
    let orgId;
    try {
      orgId = await orgDeLaRaiz(admin.firestore());
    } catch (e) {
      console.error(`[obra-nueva] ${event.params.obraId}: ${e.message}`);
      return null;
    }
    await avisarObraNueva({ orgId, obraId: event.params.obraId, obra, apiKey: RESEND_API_KEY.value() });
    return null;
  }
);

exports.obraNuevaDeOrg = onDocumentCreated(
  { document: "orgs/{orgId}/obras/{obraId}", region: "us-central1", secrets: [RESEND_API_KEY] },
  async (event) => {
    const obra = event.data?.data();
    if (!obra) return null;
    await avisarObraNueva({
      orgId: event.params.orgId, obraId: event.params.obraId, obra,
      apiKey: RESEND_API_KEY.value(),
    });
    return null;
  }
);

// CALLABLE (admin only): recorre TODOS los usuarios y aplica claims. Usar como
// backfill después de desplegar por primera vez. Idempotente — no re-escribe
// si los claims ya están correctos.
exports.backfillClaims = onCall({ region: "us-central1" }, async (request) => {
  const { perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

  // La SEXTA función de gestión. El barrido que acotó a las otras cinco
  // (`listarUsuarios`, `crearUsuario`, `actualizarUsuario`, `eliminarUsuario`,
  // `cambiarPassword`) se saltó ésta, y devuelve `detalle` con el correo y el
  // rol de CADA usuario recorrido: el mismo padrón completo que allá se cerró,
  // por otra puerta. `ROLES_ADMIN` incluye `director_obras` y `subdirector`,
  // así que la puerta la abría cualquier directivo de cualquier dependencia.
  // Y además reescribía los claims de gente ajena.
  //
  // El filtro va en la consulta, como en `listarUsuarios`: aquí el resultado
  // sí viaja a un cliente.
  if (!ambito.cross && !ambito.orgId) {
    throw new HttpsError(
      "failed-precondition",
      "Tu perfil no tiene organización asignada; no puedes gestionar usuarios."
    );
  }
  const col = admin.firestore().collection("usuarios");
  const snap = await (ambito.cross ? col.get() : col.where("orgId", "==", ambito.orgId).get());
  const resultados = [];
  for (const doc of snap.docs) {
    const perfil = doc.data();
    const res = await aplicarClaimsUsuario(perfil);
    resultados.push({
      docId: doc.id,
      email: perfil.email,
      rol: perfil.rol,
      ok: res.ok,
      motivo: res.motivo || null,
      sinCambios: !!res.sinCambios,
    });
  }
  const aplicados = resultados.filter(r => r.ok && !r.sinCambios).length;
  const sinCambios = resultados.filter(r => r.ok && r.sinCambios).length;
  const fallidos = resultados.filter(r => !r.ok).length;
  return {
    total: resultados.length,
    aplicados,
    sinCambios,
    fallidos,
    detalle: resultados,
  };
});
