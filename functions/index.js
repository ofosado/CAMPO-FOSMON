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
// Para medir en el DNS las dos patas de la entrega del correo. Ver
// `medirLaEntregaDelCorreo`.
const dnsDelSistema = require("dns").promises;

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
// CAMBIAR EL CORREO DE UN USUARIO
// ──────────────────────────────────────────────────────────────────────────
//
// POR QUÉ HACE FALTA UNA FUNCIÓN Y NO BASTA TOCAR AUTH. El login NO busca el
// perfil por cuenta: lo DERIVA del correo tecleado (`emailAId`), así que el id
// del documento ES el correo. Cambiarlo sólo en Firebase Auth deja el perfil
// bajo el id viejo, el login no lo encuentra, y la app contesta «Tu cuenta no
// tiene perfil en el sistema» y CIERRA LA SESIÓN —con los claims intactos y la
// cuenta perfectamente válida en Auth—. El síntoma no apunta al correo, que es
// lo que vuelve caro el arreglo a mano.
//
// EL ORDEN DE LOS TRES ACTOS NO ES INTERCAMBIABLE, y ésta es la razón:
//
//   1. Se escribe el perfil NUEVO.   2. Se mueve Auth.   3. Se borra el viejo.
//
// Si algo revienta entre 1 y 2, hay dos perfiles y Auth sigue en el correo
// viejo: la cuenta ENTRA IGUAL que antes y lo que sobra es un documento
// huérfano. Si revienta entre 2 y 3, Auth ya está en el nuevo y el perfil
// nuevo existe: la cuenta ENTRA con el correo nuevo y lo que sobra es el
// viejo. En ningún punto intermedio el usuario se queda fuera, que es la única
// propiedad que no se puede negociar aquí.
//
// Al revés —borrar primero— la ventana entre el borrado y la escritura es
// exactamente el defecto que esta función existe para no volver a causar.
//
// Y EL BORRADO DEL VIEJO LE QUITA LOS CLAIMS AL USUARIO SI NO SE CUIDA.
// `sincronizarClaims` reacciona al borrado buscando la cuenta por
// `before.email` y limpiándole los claims. Después del paso 2 esa búsqueda ya
// no encuentra nada —Auth se movió— así que hoy saldría bien por accidente; y
// dejaría de salir bien el día que alguien reciclara el correo viejo para otra
// cuenta. Por eso el perfil viejo se vacía de `email` ANTES de borrarse: con
// `before.email` vacío el sincronizador se va por su salida temprana y no
// busca a nadie. Deja de depender del estado de Auth, que es lo que lo vuelve
// una garantía en vez de una coincidencia.
exports.cambiarCorreoDeUsuario = onCall(async (request) => {
  const { email: emailLlamador, perfil: perfilLlamador } = await requireAdmin(request.auth);
  const ambito = ambitoDe(perfilLlamador);

  const { email, emailNuevo } = request.data || {};
  if (!email || !emailNuevo) {
    throw new HttpsError("invalid-argument", "Faltan datos: email y emailNuevo.");
  }
  const viejo = String(email).toLowerCase().trim();
  const nuevo = String(emailNuevo).toLowerCase().trim();

  if (viejo === nuevo) {
    throw new HttpsError("invalid-argument", "El correo nuevo es el mismo que el actual.");
  }
  // La forma se valida aquí y no sólo en la pantalla: un correo mal formado se
  // vuelve un id de documento igual de válido, y el perfil quedaría enterrado
  // bajo una clave a la que nadie va a llegar nunca.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nuevo)) {
    throw new HttpsError("invalid-argument", `El correo «${nuevo}» no tiene forma de correo.`);
  }

  // NADIE SE CAMBIA EL SUYO POR AQUÍ. Esta función es de administración: el
  // llamador tiene que poder administrar a OTRO. Cambiarse el propio correo
  // mueve la cuenta con la que se está autenticando en ese momento, y el token
  // en vuelo se queda apuntando a un perfil que ya no existe.
  if (viejo === emailLlamador) {
    throw new HttpsError("failed-precondition",
      "No puedes cambiar tu propio correo desde aquí: la sesión en curso quedaría "
      + "apuntando a un perfil que ya no existe. Pídeselo a otro administrador.");
  }

  const db = admin.firestore();
  const refViejo = db.doc(`usuarios/${emailAId(viejo)}`);
  const refNuevo = db.doc(`usuarios/${emailAId(nuevo)}`);

  const snapViejo = await refViejo.get();
  if (!snapViejo.exists) {
    throw new HttpsError("not-found", `No hay perfil para «${viejo}».`);
  }
  const perfil = snapViejo.data() || {};
  exigirMismaOrg(ambito, perfil, viejo);

  // EL DESTINO TIENE QUE ESTAR LIBRE EN LOS DOS SITIOS. El padrón es plano y
  // el correo es único en TODA la plataforma, así que un correo ocupado por
  // otra organización también choca — y se dice sin revelar de quién es.
  if ((await refNuevo.get()).exists) {
    throw new HttpsError("already-exists",
      `Ya hay un usuario con el correo «${nuevo}».`);
  }
  const yaEnAuth = await admin.auth().getUserByEmail(nuevo).catch(() => null);
  if (yaEnAuth) {
    throw new HttpsError("already-exists",
      `El correo «${nuevo}» ya está tomado por otra cuenta.`);
  }

  const cuenta = await admin.auth().getUserByEmail(viejo).catch(() => null);

  // ── 1 · EL PERFIL NUEVO ──────────────────────────────────────────────────
  // Se copia ENTERO y se le corrige el correo. Copiar campo por campo dejaría
  // fuera lo que se agregue mañana al perfil, y esa pérdida es silenciosa.
  await refNuevo.set({
    ...perfil,
    email: nuevo,
    correoAnterior: viejo,
    correoCambiadoEn: FieldValue.serverTimestamp(),
    correoCambiadoPor: emailLlamador,
  });

  // ── 2 · AUTH ─────────────────────────────────────────────────────────────
  if (cuenta) {
    await admin.auth().updateUser(cuenta.uid, { email: nuevo });
  }

  // ── 3 · EL PERFIL VIEJO ──────────────────────────────────────────────────
  // Vaciado de `email` antes de borrarse, para que el sincronizador de claims
  // no vaya a buscar a nadie. Ver el preámbulo.
  await refViejo.set({ email: "" }, { merge: true });
  await refViejo.delete();

  return { ok: true, de: viejo, a: nuevo, movioAuth: !!cuenta };
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
//
// v6 (2026-11-17): la clave de la semana lleva su año —`S2026-47` en vez de
// `S47`— y la serie ya no es sólo del año vivo, es una VENTANA. La caché v5
// trae las claves viejas, así que si se reaprovechara el front buscaría
// `S2026-47` en un documento que sólo tiene `S47`, no encontraría nada y
// pintaría CERO. Cero no es un hueco: es una cifra, y falsa. Se rechaza.
const PARSER_VERSION = 6;

// ════════════════════════════════════════════════════════════════════════════
// LA CLAVE DE LA SEMANA LLEVA SU AÑO, Y LA SERIE ES UNA VENTANA (#47)
// ════════════════════════════════════════════════════════════════════════════
//
// Dos defectos que se tapaban entre sí, y que dejan de taparse el primer
// cierre de 2027:
//
//   · la clave era `S47`, sin año, así que la semana 1 de 2026 y la de 2027
//     son LA MISMA CLAVE. Mientras sólo sobrevive un año no chocan, y por eso
//     a mitad de 2026 no se veía nada raro.
//   · sólo se publicaba el año más reciente. El 5 de enero de 2027 la lista
//     entera pasa a ser `["S1"]`: las 47 semanas de 2026 se caen del
//     documento, y los cuatro sitios que piden «las últimas cuatro seguidas»
//     se quedan un mes enteros diciendo «faltan semanas».
//
// El motivo que había escrito para publicar un solo año era el tamaño:
// «publicar los siete años que arrastra una obra multiplicaría `gp_detalle`
// por siete». MEDIDO el 2026-11-17 sobre las siete obras de producción
// (`scripts/medir-el-costo-del-ano-en-la-semana.cjs`), eso era falso: el peor
// caso son DOS años —la 0112 y la 0114 traen Y2025 y Y2026, las otras cinco
// sólo Y2026— y el documento más gordo, el de la 0114, va en 129.6 KB, el
// 12.7% del tope de 1 MiB. Con el año en la clave sube a 134.6 KB (13.1%).
//
// Pero publicar TODOS los años sí sería un documento que crece sin tope con
// la edad de la obra, que es exactamente el defecto que se arregla aparte. Así
// que la serie no es «todos los años» ni «un año»: es una VENTANA de tamaño
// fijo —las últimas 53 semanas y los últimos 13 meses QUE EXISTEN en el
// dato—, que cruza el 31 de diciembre sin romperse y no engorda nunca.
//
// 53 y 13, no 52 y 12: un año tiene 52 o 53 semanas ISO, y la ventana tiene
// que poder contener un año entero MÁS la semana en curso del siguiente; si
// no, el 5 de enero volvería a faltar la semana de diciembre contra la que se
// compara.
const VENTANA_SEMANAS_GP = 53;
const VENTANA_MESES_GP = 13;

// `S2026-47`. El año delante y la semana a dos dígitos, igual que `M2026-01`:
// así la clave ORDENA sola, sin tener que partirla para compararla, y la lista
// publicada se puede ordenar con un `.sort()` pelado. Devuelve `null` si el
// año o la semana no son lo que dicen ser; una clave a medias sería una
// columna de la pantalla colgada de un dato inventado.
function claveSemanaGP(año, semana) {
  const a = Number(año);
  const s = Number(semana);
  if (!Number.isInteger(a) || a < 2000 || a > 2100) return null;
  if (!Number.isInteger(s) || s < 1 || s > 53) return null;
  return `S${a}-${String(s).padStart(2, "0")}`;
}

// Lee una clave de semana de las DOS formas: la nueva con año y la vieja sin
// él. La vieja hace falta mientras exista un documento escrito antes de este
// cambio —el arrastre de una obra que falló copia su serie tal cual— y
// devuelve `año: null`, que es lo honesto: de esa clave no se sabe el año.
function piezasDeClaveSemanaGP(clave) {
  const t = String(clave == null ? "" : clave);
  const conAño = /^S(\d{4})-(\d{2})$/.exec(t);
  if (conAño) {
    const s = Number(conAño[2]);
    if (s < 1 || s > 53) return null;
    return { año: Number(conAño[1]), semana: s, llevaAño: true };
  }
  const sinAño = /^S(\d{1,2})$/.exec(t);
  if (sinAño) {
    const s = Number(sinAño[1]);
    if (s < 1 || s > 53) return null;
    return { año: null, semana: s, llevaAño: false };
  }
  return null;
}

// Las últimas `n` claves que EXISTEN, en orden. Sirve igual para semanas
// (`S2026-47`) y para meses (`M2026-01`) porque las dos formas llevan el año
// delante. No rellena los huecos a propósito: una semana que el dato no trae
// no debe aparecer en la lista de lo que se puede pintar.
function ventanaDeClavesGP(claves, n) {
  return [...new Set(claves)].filter(Boolean).sort().slice(-n);
}

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
  // El año más reciente ya no decide QUÉ semanas se publican —eso lo decide la
  // ventana, abajo— pero sigue siendo el año de `total2026`.
  const añoMasReciente = Object.keys(weekColsByYear).sort().pop() || '2026';

  // Las semanas de TODOS los años entran al `colMap`, no sólo las del año
  // vivo. Lo que acota el tamaño es la ventana, que se aplica unas líneas más
  // abajo: quedarse con un año era lo que hacía que la serie se cayera entera
  // el 5 de enero (#47).
  //
  // El valor de una entrada `week_*` es una LISTA de columnas. Las demás
  // entradas de `colMap` siguen siendo un índice suelto: una semana es lo
  // único que la hoja puede repartir en varias columnas.
  Object.entries(weekColsByYear).forEach(([año, porSemana]) => {
    Object.entries(porSemana).forEach(([n, cols]) => {
      colMap[`week_${año}_${n}`] = cols;
    });
  });

  // Igual con los meses. Y por la misma razón: el mes que la pantalla compara
  // contra «el mes pasado» en enero es diciembre, que es del año anterior.
  Object.entries(mesColsByYear).forEach(([año, porMes]) => {
    Object.entries(porMes).forEach(([mes, ci]) => {
      colMap[`total_month_${año}_${mes}`] = ci;
    });
  });

  // ── La ventana, aplicada al `colMap` y no a cada nodo ──
  // Aquí es donde tiene que ir: `extraerValores` saca la serie de cada obra,
  // rubro y proveedor leyendo ESTE mapa, así que recortarlo una vez recorta
  // los tres niveles a la vez y garantiza que ningún nodo publique una semana
  // que no esté en `semanasDisponibles`. Recortar nodo por nodo dejaría esa
  // garantía dependiendo de que nadie olvide un sitio.
  {
    const claveDeColumnaSemana = (k) => {
      const p = String(k).split('_'); // ['week', '2026', '47']
      return claveSemanaGP(p[1], p[2]);
    };
    const ventanaSem = new Set(ventanaDeClavesGP(
      Object.keys(colMap).filter((k) => k.startsWith('week_')).map(claveDeColumnaSemana),
      VENTANA_SEMANAS_GP));
    const ventanaMes = new Set(ventanaDeClavesGP(
      Object.keys(colMap).filter((k) => k.startsWith('total_month_'))
        .map((k) => `M${k.replace('total_month_', '').replace('_', '-')}`),
      VENTANA_MESES_GP));
    for (const k of Object.keys(colMap)) {
      if (k.startsWith('week_') && !ventanaSem.has(claveDeColumnaSemana(k))) delete colMap[k];
      if (k.startsWith('total_month_') &&
          !ventanaMes.has(`M${k.replace('total_month_', '').replace('_', '-')}`)) delete colMap[k];
    }
  }

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
        const clave = claveSemanaGP(partes[1], partes[2]);
        if (suma !== 0 && clave) semanas[clave] = suma;
      });

      // El total del año VIVO. Estaba escrito `años['Y2026']` con el año
      // teclado, y el respaldo buscaba meses `M2026-*`: en 2027 las dos cosas
      // habrían dado 0 y la cifra se habría ido al último respaldo, que es el
      // gran total de todos los años. El año no se teclea, se lee.
      const claveDelAñoVivo = `Y${añoMasReciente}`;
      const mesesDelAñoVivo = Object.keys(meses)
        .filter(k => k.startsWith(`M${añoMasReciente}-`)).sort();
      const total2026 = años[claveDelAñoVivo]
        || (mesesDelAñoVivo.length ? meses[mesesDelAñoVivo[mesesDelAñoVivo.length - 1]] : 0)
        || 0;

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
  // El `colMap` ya viene recortado a la ventana, así que estas dos listas son
  // exactamente lo que los nodos pueden traer. Se ordenan con un `.sort()`
  // pelado porque la clave lleva el año delante; el orden viejo —por el número
  // de semana— habría puesto la S1 de 2027 antes que la S52 de 2026.
  const semanasDisponibles = Object.keys(colMap)
    .filter(k => k.startsWith('week_'))
    .map(k => { const p = k.split('_'); return claveSemanaGP(p[1], p[2]); })
    .filter(Boolean)
    .sort();
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

  // El año más reciente sigue mandando para UNA cosa: `total2026`, que es el
  // total del año vivo. Ya NO manda sobre `semanas` ni `meses`: ésas se
  // acumulan de todos los años y se recortan al final a la ventana (ver
  // `VENTANA_SEMANAS_GP`), que es lo que las deja cruzar el 31 de diciembre.
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
    // Sin año no hay clave de mes ni de semana que se pueda escribir: `S47` a
    // secas es justo la clave ambigua que este cambio quita de en medio. Un
    // renglón así se cuenta y entra en el acumulado del año y en el gran
    // total, pero no en ninguna serie.
    const mes = tieneAño ? mesDeRenglonGP(fila.Mes) : null;
    const semana = tieneAño ? semanaDeRenglonGP(fila.Semana) : null;
    if (tieneAño && !mes) descartes.sinMes++;
    if (tieneAño && !semana) descartes.sinSemana++;
    const claveAño = tieneAño ? `Y${año}` : null;
    const claveMes = mes ? `M${año}-${mes}` : null;
    const claveSem = claveSemanaGP(año, semana);
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

  // La ventana se decide una vez, con TODAS las claves que aparecieron, y se
  // aplica igual a los tres niveles. Si cada nodo recortara su propia ventana,
  // un proveedor que lleva dos años sin cobrar publicaría semanas que no están
  // en `semanasDisponibles`, y la pantalla pintaría una columna que su propia
  // cabecera no reconoce. Los años NO se recortan: son doce o trece claves en
  // toda la vida de la obra y es la única serie que cuenta la historia entera.
  const ventanaSemanas = new Set(ventanaDeClavesGP([...semanasVistas], VENTANA_SEMANAS_GP));
  const ventanaMeses = new Set(ventanaDeClavesGP([...mesesVistos], VENTANA_MESES_GP));
  const podarFueraDeVentana = (nodo) => {
    for (const k of Object.keys(nodo.semanas)) if (!ventanaSemanas.has(k)) delete nodo.semanas[k];
    for (const k of Object.keys(nodo.meses)) if (!ventanaMeses.has(k)) delete nodo.meses[k];
  };

  for (const obra of Object.values(obras)) {
    for (const rubro of Object.values(obra.rubros)) {
      const vivos = rubro.proveedores.filter((p) => p.grandTotal !== 0);
      descartes.proveedoresEnCero += rubro.proveedores.length - vivos.length;
      rubro.proveedores = vivos;
      for (const p of vivos) {
        podarCeros(p);
        podarFueraDeVentana(p);
        p.total2026 = claveAñoVivo ? (p.años[claveAñoVivo] || 0) : 0;
        p.total = p.grandTotal;
      }
      podarCeros(rubro);
      podarFueraDeVentana(rubro);
      rubro.total2026 = claveAñoVivo ? (rubro.años[claveAñoVivo] || 0) : 0;
    }
    obra.proveedores = obra.proveedores.filter((p) => p.grandTotal !== 0);
    podarCeros(obra);
    podarFueraDeVentana(obra);
    obra.total2026 = claveAñoVivo ? (obra.años[claveAñoVivo] || 0) : 0;
  }

  // Ya vienen ordenadas y recortadas: la clave lleva el año delante, así que
  // `.sort()` pelado es el orden cronológico. El orden de antes —por el número
  // de semana— era el que no podía existir con dos años en la lista: habría
  // puesto la S1 de 2027 antes que la S52 de 2026.
  const semanasDisponibles = [...ventanaSemanas];
  const mesesDisponibles = [...ventanaMeses];

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
  //
  // Y TRADUCIDA. El documento anterior puede estar escrito con las claves de
  // semana sin año (`S47`, hasta `parserVersion` 5). Si se copiara tal cual,
  // esa obra quedaría con claves que no están en `semanasDisponibles` —que ya
  // viene con año— y la pantalla no vería un hueco: vería CERO. Un cero es una
  // cifra, y en gasto es la mentira más cara que esta pantalla sabe decir.
  // El año con el que se traduce es el `añoVivo` de ESE documento, que es el
  // único año que esas claves pudieron tener: hasta la v5 sólo se publicaba el
  // año vivo. Si el documento viejo no lo trae, no se adivina — se deja la
  // clave como está y la obra se queda sin serie semanal, que es lo honesto.
  const traducirSemanasViejas = (semanas, añoDelDocumento) => {
    const fuera = {};
    for (const [k, v] of Object.entries(semanas || {})) {
      const p = piezasDeClaveSemanaGP(k);
      if (!p) { fuera[k] = v; continue; }
      if (p.llevaAño) { fuera[k] = v; continue; }
      const nueva = claveSemanaGP(añoDelDocumento, p.semana);
      fuera[nueva || k] = v;
    }
    return fuera;
  };
  const arrastradas = [];
  for (const { clave } of fallos) {
    const anterior = Object.values(obrasPrevias).find((o) => o && o.id === clave);
    if (!anterior) continue;
    obrasResumen[anterior.nombre || clave] = {
      ...anterior,
      semanas: traducirSemanasViejas(anterior.semanas, previo.añoVivo),
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

  // ── PRIMERO, LA ENTREGA DEL CORREO ──────────────────────────────────────
  //
  // Vive montada en este cron y no en una función propia porque lo que hace
  // falta es que alguien mire el DNS TODOS LOS DÍAS, y éste es el trabajo
  // diario que ya existe — además corre a las 8:30, media hora antes del
  // correo del lunes, así que una pata caída sale en el registro antes de que
  // salga el primer mensaje de la semana.
  //
  // Su try/catch es APARTE del de las denegaciones, a propósito: un fallo
  // midiendo el DNS no puede dejar `permisos_denegados` en rojo —son dos
  // diagnósticos con dos reacciones distintas, y confundirlos es el defecto
  // que `registrarSalud` vino a cerrar—, y al revés, que no haya podido
  // contar denegaciones no puede dejar el correo sin vigilar.
  //
  // Y no relanza: un DNS en mal estado es un RESULTADO medido, no una avería
  // del vigilante. Relanzarlo haría que Scheduler reintentara y escribiera el
  // mismo rojo cuatro veces. El rojo del registro es el canal; la pantalla de
  // salud es quien lo grita.
  const tCorreo = Date.now();
  try {
    const m = await medirLaEntregaDelCorreo(dnsDelSistema, FROM_EMAIL);
    console.log(`entregaDelCorreo: ${m.mensaje}`);
    await registrarSalud("entrega_correo", m.ok, m.mensaje, {
      duracionMs: Date.now() - tCorreo,
      dominio: m.dominio,
      patas: m.patas,
      firma: !!m.firma,
      rutaDeRetorno: !!m.rutaEntera,
      dmarc: m.dmarc || "",
    });
  } catch (e) {
    console.error("entregaDelCorreo falló:", e);
    await registrarFalloDeSalud("entrega_correo", e, { duracionMs: Date.now() - tCorreo });
  }

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
    // Este `true` NO es de los que mienten, y se midió antes de tocarlo: el
    // único modo de falla silenciosa sería un catálogo vacío, y
    // `descargarYGuardarCatalogoGP` ya LANZA con cero obras para no pisar el
    // catálogo bueno (ver su cuerpo). Si se llegó a este renglón, hay obras.
    // Derivar aquí `cat.obras.length > 0` habría escrito una rama inalcanzable
    // y un mensaje —«CATÁLOGO VACÍO»— que nunca se puede imprimir.
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

// ── LOS COLORES SON LOS DE LA MARCA, NO LOS DE LA INTERFAZ ──────────────────
//
// El correo iba en `#0D1619`, que se ve negro y no es cotea: es la paleta vieja
// de la interfaz, la que `src/styles/tokens.css` dice que todavía no cruzó el
// puente. Los colores de cotea son los dos que trae su logo —pizarra y
// naranja—, los mismos que `src/App.jsx:293-294` usa para el PDF. Medido el
// 2026-11-17 sobre el HTML que salió de verdad, interceptado antes de Resend:
// los dos aparecían CERO veces en los cuatro correos del producto.
const MARCA_PIZARRA = "#4A5560";
const MARCA_NARANJA = "#FF6B35";
const MARCA_TINTA = "#14181C";
const MARCA_GRIS = "#6B7480";
const MARCA_BORDE = "#E8EAF0";

// ── EL LOGO VIAJA POR URL ABSOLUTA, Y SE SABE CUÁL ──────────────────────────
//
// Un `<img>` de correo lo pide el cliente de correo SIN SESIÓN, así que no
// puede salir de Storage —cuyas reglas exigen `request.auth` en todas sus
// rutas— ni ser el data URI con que el cliente guarda su marca en
// `orgs/{oid}/config/branding`: Gmail y Outlook no pintan data URIs. Tiene que
// ser una URL pública, y ésa es la razón de fondo por la que el logo DEL
// CLIENTE no entra al correo aunque ya esté cargado.
//
// `public/cotea-horizontal.png` es el logo rasterizado a 480×136 —3× para
// retina— porque ningún cliente de correo pinta un SVG remoto. Vite copia
// `public/` a `dist/`, así que sale con cada despliegue del front. Medido el
// 2026-11-20: `app.cotea.com.mx` y `cotea.com.mx` lo sirven los dos con 200 y
// los 11,968 bytes del archivo del repo —cuando se escribió
// `correo-cotea-se-presenta.cjs` el primero daba 404, y por eso aquel guion
// lleva un respaldo por `cid:`—. Va por `APP_URL` y no por el sitio público
// porque es el mismo origen al que apunta el botón: un dominio menos que un
// filtro de spam tenga que resolver.
//
// Y EL CORREO SE LEE CON LAS IMÁGENES APAGADAS, que es como llega la primera
// vez a un buzón que no conoce al remitente: el `alt` dice «cotea», el título
// dice qué pasó, y ningún dato del aviso vive dentro de la imagen.
const LOGO_URL = `${APP_URL}/cotea-horizontal.png`;
const FROM_EMAIL = "cotea <no-reply@cotea.com.mx>";
const ROLES_RESUMEN_SEMANAL = ["director_general", "director_operaciones", "gerente_construccion"];

// ════════════════════════════════════════════════════════════════════════════
// LAS DOS PATAS DE LA ENTREGA, Y QUIÉN SE ENTERA CUANDO SE CAE UNA
// ════════════════════════════════════════════════════════════════════════════
//
// El 200 de Resend no es una entrega. Resend acepta el mensaje y contesta 200
// aunque el buzón de destino lo vaya a mandar a spam, de modo que
// `registrarSalud("email_semanal", salio, ...)` puede quedar en VERDE mientras
// ningún residente recibe nada. Ése es el modo de falla exacto contra el que
// existe el recordatorio del viernes: el residente no captura porque nunca
// supo, la fecha de término se corre sola, y el vigilante del silencio se
// apagó en silencio.
//
// Lo que decide si entra o no al buzón es la autenticación del dominio, y vive
// en el DNS — fuera del repo, fuera de la consola de Firebase, en GoDaddy.
// Son dos patas:
//
//   1. LA FIRMA (DKIM) — `resend._domainkey.<dominio>` publica la llave con la
//      que Resend firma. Alinea con el dominio del `From`, así que basta por
//      sí sola para pasar DMARC.
//   2. LA RUTA DE RETORNO — `send.<dominio>`, con su propio SPF y su MX. Es el
//      Return-Path que Resend pone en cada mensaje; su documentación lo dice
//      así: «By default, Resend uses the send subdomain for the Return-Path
//      address», y «This return path is set in the email headers of every
//      email you send through Resend». El SPF se evalúa contra el dominio del
//      sobre, que es ése, y alinea con la raíz por organización.
//
// CORRECCIÓN A LO QUE DECÍA EL #150, medido el 2026-11-23 con `dig`: el
// renglón afirmaba que no había subdominio de retorno y que la entrega iba en
// UNA sola pata. `send.cotea.com.mx` SÍ existe —CNAME a `send.forge.rmta.net`,
// SPF propio con tres `ip4:` y MX a `feedback.forge.rmta.net`—, así que las dos
// patas están puestas. Y de ahí se sigue lo otro que el renglón tenía al
// revés: el SPF de la raíz —`v=spf1 include:secureserver.net -all`, el de
// GoDaddy— NO necesita incluir a Resend, porque el sobre no sale de la raíz.
// Editarlo no tumba el correo del producto. Lo que lo tumbaría es borrar el
// DKIM o borrar los registros de `send.`, y eso es lo que esto mide.
//
// Por qué se mide el DNS y no la entrega: medir la entrega de verdad exige
// mandar un mensaje y leer sus cabeceras en un buzón, y eso ni se puede hacer
// desde un cron ni se debe hacer cuatro veces al día contra buzones reales. El
// DNS es la causa, no el síntoma, y es justo lo que un dedo ajeno puede mover
// sin avisarnos.

// El dominio sale del remitente y no de una constante aparte: si `FROM_EMAIL`
// cambia de dominio y esto se queda con el viejo, el vigilante estaría
// midiendo un dominio por el que ya no sale nada y seguiría en verde.
const dominioDelRemitente = (from) => {
  const m = /<([^>]+)>/.exec(String(from || ""));
  const dir = m ? m[1] : String(from || "");
  const arroba = dir.lastIndexOf("@");
  return arroba < 0 ? "" : dir.slice(arroba + 1).trim().toLowerCase().replace(/>$/, "");
};

// Un TXT largo —una llave DKIM lo es— viaja partido en trozos de 255
// caracteres, y `resolveTxt` los devuelve como arreglo. Sin unirlos, el `p=`
// de la llave se parte a la mitad y la firma se leería como ausente: un rojo
// falso en el único vigilante del correo.
const unirTxt = (filas) => (Array.isArray(filas) ? filas : [])
  .map((f) => (Array.isArray(f) ? f.join("") : String(f || "")));

/**
 * Mide en el DNS las dos patas de la entrega. `dns` se recibe por parámetro
 * para poder correrla contra un DNS armado, sin red.
 *
 * Nunca lanza por un nombre que no resuelve: un NXDOMAIN es un dato —esa pata
 * no está— y no una avería del vigilante.
 */
async function medirLaEntregaDelCorreo(dns, from) {
  const dominio = dominioDelRemitente(from);
  if (!dominio) {
    return { ok: false, dominio: "", patas: 0,
      mensaje: "no se pudo leer el dominio del remitente: no hay nada que medir" };
  }

  // «El registro no está» y «no pude preguntar» NO son lo mismo, y tragarse
  // los dos por igual convierte una caída del resolvedor en la afirmación
  // «SIN PATAS — falta la firma», que manda a alguien a GoDaddy a buscar unos
  // registros que están puestos. Sólo las dos respuestas que significan
  // ausencia son un dato; cualquier otra —tiempo agotado, SERVFAIL, red
  // caída— relanza, y arriba se anota en ROJO como lo que es: no se pudo
  // medir. Que es la misma regla que ya rige los respaldos.
  const AUSENTE = new Set(["ENOTFOUND", "ENODATA"]);
  const ausenciaOReventar = (e) => {
    if (AUSENTE.has(e?.code)) return [];
    throw e;
  };
  const txt = async (n) => {
    try { return unirTxt(await dns.resolveTxt(n)); } catch (e) { return ausenciaOReventar(e); }
  };
  const mx = async (n) => {
    try { return (await dns.resolveMx(n)).map((r) => String(r?.exchange || "")).filter(Boolean); }
    catch (e) { return ausenciaOReventar(e); }
  };

  const retorno = `send.${dominio}`;
  const firma = (await txt(`resend._domainkey.${dominio}`))
    .some((r) => /p=[A-Za-z0-9+/]{40,}/.test(r));
  const spfRetorno = (await txt(retorno)).find((r) => /^v=spf1\b/i.test(r)) || "";
  const retornoAutoriza = /(^|\s)(ip4:|ip6:|include:|a[:\s]|mx[:\s])/i.test(spfRetorno);
  const mxRetorno = await mx(retorno);
  const spfRaiz = (await txt(dominio)).find((r) => /^v=spf1\b/i.test(r)) || "";
  const dmarc = (await txt(`_dmarc.${dominio}`)).find((r) => /^v=DMARC1\b/i.test(r)) || "";

  const rutaEntera = retornoAutoriza && mxRetorno.length > 0;
  const patas = (firma ? 1 : 0) + (rutaEntera ? 1 : 0);

  const faltan = [];
  if (!firma) faltan.push(`la firma: resend._domainkey.${dominio} ya no publica llave`);
  if (!retornoAutoriza) faltan.push(`el SPF de la ruta de retorno ${retorno}`);
  else if (!mxRetorno.length) faltan.push(`el MX de la ruta de retorno ${retorno}`);

  const politica = /p=\s*([a-z]+)/i.exec(dmarc)?.[1]?.toLowerCase() || "";
  const notas = [
    dmarc ? `DMARC p=${politica || "?"}` : "SIN DMARC: nadie exige la autenticación",
    spfRaiz
      ? (/resend|forge\.rmta/i.test(spfRaiz)
        ? "el SPF de la raíz incluye a Resend"
        : "el SPF de la raíz no incluye a Resend, y no hace falta: el sobre sale de send.")
      : "la raíz no publica SPF",
  ];

  const mensaje = patas === 2
    ? `dos patas: firma DKIM y ruta de retorno ${retorno} con SPF y MX · ${notas.join(" · ")}`
    : patas === 1
      ? `UNA SOLA PATA — falta ${faltan.join(" y ")} · si se cae la que queda, ` +
        `todo el correo del producto se va a spam sin error · ${notas.join(" · ")}`
      : `SIN PATAS — falta ${faltan.join(" y ")} · el correo del producto no está ` +
        `autenticado y ${politica === "none" || !dmarc ? "depende del humor del buzón" : `DMARC dice ${politica}`} · ${notas.join(" · ")}`;

  return { ok: patas === 2, dominio, patas, firma, rutaEntera,
    mxRetorno: mxRetorno.length, dmarc: politica, mensaje };
}

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

// ── El dinero de una estimación ───────────────────────────────────────────
// Copia literal de `montoDeEstimacion` / `esEstimacionPagada` /
// `esEstimacionPorCobrar` / `sumaDeEstimaciones` de src/App.jsx, con la misma
// advertencia que los dos bloques de arriba: si se toca una copia hay que tocar
// la otra, y `prueba-el-dinero-de-una-estimacion.cjs` EJECUTA LAS DOS y exige
// que coincidan. No hay build compartido entre functions/ y src/.
//
// Lo que había aquí era una quinta forma de decidir «pagada»:
// `/pagada|cobrada/i.test(estatus)`, una subcadena. Decía «cobrada», que la app
// no escribe por ningún lado, y por ser subcadena un día que alguien capturara
// «No pagada» la habría contado como cobrada. El correo de dirección publica
// esa cifra como «cobrado del cliente».
const _neEstim = (s) => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const montoDeEstimacion = (e) => {
  const n = Number(e?.monto);
  return Number.isFinite(n) ? n : 0;
};
const esEstimacionPagada = (e) => _neEstim(e?.estatus) === "pagada";
const esEstimacionFacturada = (e) => _neEstim(e?.estatus) === "facturada";
const esEstimacionEnProceso = (e) => _neEstim(e?.estatus).includes("proceso");
const esEstimacionPorCobrar = (e) =>
  _neEstim(e?.estatus) === "aprobada" ||
  esEstimacionFacturada(e) || esEstimacionEnProceso(e);
const sumaDeEstimaciones = (ests, filtro) =>
  (Array.isArray(ests) ? ests : [])
    .filter((e) => (filtro ? filtro(e) : true))
    .reduce((t, e) => t + montoDeEstimacion(e), 0);

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

// Una obra municipal mexicana se mide en el calendario de la Ciudad de México.
// Copia literal de `ZONA_OBRA` / `fechaEnZonaObra` / `diaDeObraDe` de
// src/App.jsx, y están aquí por la misma razón que la cuenta de abajo: el
// correo del lunes dice «Sin captura hace N días» y ese N tiene que ser el que
// el residente ve en el tablero. Si el día se resolviera aquí en el huso del
// servidor —que en Cloud Functions es UTC— las dos cifras se separarían seis
// horas de cada día, que es cuando el umbral `>7` cambia de lado.
const ZONA_OBRA = "America/Mexico_City";

const fechaEnZonaObra = (fecha) => {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA_OBRA, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]));
  return (p.year && p.month && p.day) ? `${p.year}-${p.month}-${p.day}` : null;
};

// Un día de calendario pelado YA ES un día: pasarlo por `new Date` lo convierte
// en medianoche UTC, que en México es la tarde del día anterior.
const diaDeObraDe = (fecha) => {
  const txt = String(fecha ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
  return fechaEnZonaObra(fecha);
};

// Los días transcurridos se cuentan en el CALENDARIO DE LA OBRA, de día a día,
// y no como periodos de 24 horas entre dos instantes. Ver el preámbulo largo en
// src/App.jsx. La resta va con los dos días a medianoche UTC: ya no se restan
// instantes sino dos etiquetas de día, y a dos etiquetas les da igual el huso
// con el que se resten mientras sea el mismo para las dos.
const diasSinCapturaDe = (historialAvance = [], ahora = Date.now()) => {
  const fecha = fechaUltimaCapturaDe(historialAvance);
  if (!fecha) return null;
  const capturo = diaDeObraDe(fecha);
  const hoy = fechaEnZonaObra(new Date(ahora));
  if (!capturo || !hoy) return null;
  const a = Date.parse(`${capturo}T00:00:00Z`);
  const b = Date.parse(`${hoy}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
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

  // Estimaciones cobradas — por las MISMAS lecturas que la pantalla.
  const cobrado = sumaDeEstimaciones(estimaciones, esEstimacionPagada);

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
    return `<span style="color:${MARCA_GRIS};font-size:11px;font-style:italic;">Sin cierre semanal aún</span>`;
  }
  if (dias > 7) {
    return `<span style="background:#FCEBEB;color:#A32D2D;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600;">Sin captura ${dias}d</span>`;
  }
  return `<span style="color:${MARCA_GRIS};font-size:11px;">Captura: ${dias}d</span>`;
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
          <div style="margin-top:14px;font-size:11px;color:${MARCA_GRIS};">
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

// El mosaico dice CUÁNTAS no se pudieron leer; esto dice CUÁLES. Sin el
// nombre el aviso no sirve de nada: el que lo recibe no puede ir a ver qué
// pasó con una obra que no se nombra. El motivo también va, porque un
// `PERMISSION_DENIED` y un documento ausente se arreglan en lugares distintos.
function bloqueObrasNoLeidas(noLeidas = []) {
  if (!noLeidas.length) return "";
  const n = noLeidas.length;
  const filas = noLeidas
    .map(o => `${ESC_HTML(o.nombre || o.obraId)} — ${ESC_HTML(String(o.motivo || "sin motivo registrado"))}`)
    .join("<br>");
  return `
          <div style="margin-top:14px;padding:10px 14px;background:#FDECEC;border-left:3px solid #A32D2D;border-radius:4px;font-size:12px;color:#7A1F1F;">
            <b>${n} obra${n !== 1 ? "s" : ""} no se pudo leer</b> y por eso no aparece${n !== 1 ? "n" : ""}
            en la tabla ni en los cuatro totales de arriba, que van cortos:<br>${filas}
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

function correoResumenSemanal(kpisObras, fechaCorte, denegaciones, reparto, marca, noLeidas = []) {
  const filasObras = kpisObras.map(k => {
    const colorAvance = semaforoColor(k.avancePct, "avance");
    // El semáforo del gasto es la trampa fina: `semaforoColor` pinta VERDE lo
    // que va por debajo del 70% del contrato, así que una obra sin medir —cuyo
    // porcentaje sale bajísimo justamente porque le falta el gasto— se pintaba
    // de verde tranquilizador. Sin medición no hay semáforo: gris.
    const sinMedir = k.gastoGPMedido === false;
    const colorGasto = sinMedir ? MARCA_GRIS : semaforoColor(k.pctGasto, "gasto");
    const linkObra = `${APP_URL}/?obra=${encodeURIComponent(k.obraId)}`;
    const alertaCaptura = bloqueCaptura(k.diasDesdeCaptura);
    return `
    <tr>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;vertical-align:top;">
        <div style="font-weight:600;color:${MARCA_TINTA};font-size:14px;line-height:1.3;">
          <a href="${linkObra}" style="color:#185FA5;text-decoration:none;">${k.nombre}</a>
        </div>
        <div style="color:${MARCA_GRIS};font-size:11px;margin-top:2px;">${k.contrato || "—"} · ${k.cliente || ""}</div>
        <div style="margin-top:6px;">${alertaCaptura}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;text-align:right;vertical-align:top;">
        <div style="font-size:18px;font-weight:700;color:${colorAvance};">${PCT_FMT(k.avancePct, 1)}</div>
        <div style="font-size:10px;color:${MARCA_GRIS};">avance</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;text-align:right;vertical-align:top;">
        <div style="font-size:14px;font-weight:600;color:${colorGasto};${sinMedir ? "font-style:italic;" : ""}">${sinMedir ? "sin medir" : MXN_FMT(k.totGasto)}</div>
        <div style="font-size:10px;color:${MARCA_GRIS};">${sinMedir ? motivoSinMedir(k.gastoGPMotivo) : `${PCT_FMT(k.pctGasto, 0)} de ${MXN_FMT(k.presupuesto)}`}</div>
      </td>
      <td style="padding:14px 12px;border-bottom:1px solid #E8EAF0;text-align:right;vertical-align:top;">
        <div style="font-size:13px;color:${MARCA_TINTA};">${MXN_FMT(k.cobrado)}</div>
        <div style="font-size:10px;color:${MARCA_GRIS};">cobrado</div>
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

  // Una obra que no se pudo leer falta en la tabla Y en los cuatro totales,
  // así que el aviso no va pegado a un número: va pegado a TODOS. Por eso
  // cuelga del mosaico de la cuenta de obras, que es el que dice cuántas se
  // están presentando.
  //
  // «no se pudieron leer» y no «sin datos»: lo primero dice que hubo un fallo
  // y tiene a quién preguntársele; lo segundo suena a que la obra está vacía.
  const nNoLeidas = noLeidas.length;
  const avisoNoLeidas = nNoLeidas > 0
    ? `${nNoLeidas} obra${nNoLeidas !== 1 ? "s" : ""} no se pudo leer: falta${nNoLeidas !== 1 ? "n" : ""} en los cuatro totales`
    : null;

  const firma = marca?.empresa ? ESC_HTML(marca.empresa).toUpperCase() : "";
  const casa = marca?.empresa ? ESC_HTML(marca.empresa) : "";

  // El asunto no lleva la casa: este correo sólo sale a la organización dueña
  // de las obras de la raíz, así que distinguirla en la bandeja no hace falta y
  // el encabezado ya la nombra. Lo que sí lleva es el conteo, que es lo que se
  // lee de un vistazo sin abrirlo.
  // El asunto lleva el conteo de lo que SE PUDO presentar. Si algo se quedó
  // fuera, lo dice ahí: es lo único que se lee sin abrir el correo, y un
  // «7 obras activas» cuando son 8 es la mentira más barata de todas.
  const subject = `cotea · Resumen semanal · ${totalObras} obras activas` +
    (nNoLeidas > 0 ? ` · ${nNoLeidas} sin leer` : "");

  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Resumen semanal · cotea</title></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:${MARCA_TINTA};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F4F5F7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <!-- Header -->
        <!-- ESTE CORREO NO USA sobreCorreo, Y NO ES UN DESCUIDO: lleva una
             tabla de obras a 640 px que no cabe en el sobre de 560 de los
             avisos. Lo que sí comparte es la MARCA, y por eso el encabezado se
             pinta con las mismas constantes y el mismo logo. PENDIENTES decía
             que los cuatro correos compartían molde; medido el 2026-11-20, son
             dos moldes. Lo que tiene que ser uno es la marca, no la
             plantilla. -->
        <tr><td style="height:4px;background:${MARCA_NARANJA};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="background:#FFFFFF;padding:24px 28px 18px 28px;">
          <img src="${LOGO_URL}" width="160" height="46" alt="cotea" style="display:block;border:0;">
          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}
          <div style="font-size:23px;font-weight:700;margin-top:14px;color:${MARCA_TINTA};">Resumen semanal</div>
          <div style="font-size:12px;color:${MARCA_PIZARRA};margin-top:4px;">Corte del ${fechaCorte}</div>
        </td></tr>
        <!-- Resumen ejecutivo -->
        <tr><td style="padding:20px 28px;background:#F8F9FB;border-bottom:1px solid #E8EAF0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="text-align:center;padding:6px;"><div style="font-size:22px;font-weight:700;color:${MARCA_TINTA};">${totalObras}</div><div style="font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;">Obras activas</div>${avisoNoLeidas ? `<div style="font-size:10px;color:#854F0B;margin-top:3px;">${avisoNoLeidas}</div>` : ""}</td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#185FA5;">${MXN_FMT(presupuestoTotal)}</div><div style="font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;">Presupuesto</div></td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#A32D2D;">${MXN_FMT(gastoTotal)}</div><div style="font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;">Gasto acumulado</div>${avisoGastoCorto ? `<div style="font-size:10px;color:#854F0B;margin-top:3px;">${avisoGastoCorto}</div>` : ""}</td>
              <td style="text-align:center;padding:6px;"><div style="font-size:18px;font-weight:700;color:#3B6D11;">${MXN_FMT(cobradoTotal)}</div><div style="font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;">Cobrado</div></td>
            </tr>
          </table>
          ${avisoDeCaptura(obrasSinCaptura, obrasSinUnCierre)}${bloqueDenegaciones(denegaciones)}${bloqueFueraDeAlcance(reparto)}${bloqueObrasNoLeidas(noLeidas)}
        </td></tr>
        <!-- Tabla de obras -->
        <tr><td style="padding:0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <thead><tr style="background:#fff;border-bottom:2px solid #E8EAF0;">
              <th style="padding:10px 12px;text-align:left;font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Obra</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Avance</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Gasto</th>
              <th style="padding:10px 12px;text-align:right;font-size:10px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Cobrado</th>
            </tr></thead>
            <tbody>${filasObras}</tbody>
          </table>
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:24px 28px;text-align:center;border-top:1px solid #E8EAF0;">
          <a href="${APP_URL}" style="display:inline-block;background:${MARCA_PIZARRA};color:#fff;padding:11px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Abrir cotea</a>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 28px;background:#F8F9FB;font-size:10px;color:${MARCA_GRIS};text-align:center;border-top:1px solid #E8EAF0;">
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

// El sobre común de los cuatro correos. Lo único que cambia entre uno y otro es
// el cuerpo; el encabezado, el pie y la marca son los mismos para que un
// usuario reconozca de dónde viene el correo antes de leerlo.
//
// QUIÉN FIRMA EL ENCABEZADO: COTEA, Y EL CLIENTE VA DEBAJO. La pregunta estaba
// abierta y se decide aquí. El correo sale de `no-reply@cotea.com.mx` —el
// único `from` del archivo— y lo manda el sistema, no la organización: un
// encabezado firmado por el ayuntamiento sobre un dominio de cotea dice que
// escribió el ayuntamiento, y no escribió. Además el acto que pide el aviso es
// «entra a cotea y captura», así que lo que el destinatario tiene que
// reconocer en tres segundos es el producto. La organización sigue nombrada
// —`marcaDeOrg` la resuelve y va bajo el logo—, que es lo que contesta «¿de
// cuál de mis dos clientes es este aviso?» sin fingir remitente.
//
// Por eso tampoco entra aquí el LOGO del cliente, y no es sólo que falte la
// ruta pública: un logo ajeno en la cabecera de un correo de cotea es una
// atribución falsa, no un adorno. Donde el logo del cliente sí va es en la
// PORTADA DEL PDF, que es un documento suyo y donde el data URI pinta sin
// pedirle permiso a nadie.
function sobreCorreo({ marca, titulo, entradilla, cuerpoHTML, pie }) {
  const firma = marca?.empresa ? ESC_HTML(marca.empresa) : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F5F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid ${MARCA_BORDE};">
        <tr><td style="height:4px;background:${MARCA_NARANJA};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:24px 28px 18px 28px;background:#FFFFFF;">
          <img src="${LOGO_URL}" width="160" height="46" alt="cotea" style="display:block;border:0;">
          ${firma ? `<div style="font-size:10px;color:${MARCA_GRIS};letter-spacing:0.1em;text-transform:uppercase;margin-top:11px;">${firma}</div>` : ""}
        </td></tr>
        <tr><td style="padding:0 28px 6px 28px;">
          <div style="font-size:19px;font-weight:700;color:${MARCA_TINTA};line-height:1.35;">${ESC_HTML(titulo)}</div>
          ${entradilla ? `<div style="font-size:13px;color:${MARCA_PIZARRA};line-height:1.6;margin-top:10px;">${entradilla}</div>` : ""}
        </td></tr>
        <tr><td style="padding:8px 28px 26px 28px;">${cuerpoHTML}</td></tr>
        <tr><td style="padding:16px 28px;background:#FAFBFC;font-size:10px;color:${MARCA_GRIS};text-align:center;border-top:1px solid ${MARCA_BORDE};">
          ${ESC_HTML(pie || "Este aviso lo manda cotea automáticamente.")}<br>
          <a href="${SITIO_PUBLICO}" style="color:${MARCA_NARANJA};text-decoration:none;font-weight:600;">${SITIO_PUBLICO.replace(/^https?:\/\//, "")}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

const botonHTML = (texto, url) =>
  `<a href="${url}" style="display:inline-block;background:${MARCA_PIZARRA};color:#FFFFFF;text-decoration:none;` +
  `font-size:13px;font-weight:700;padding:11px 20px;border-radius:7px;">${ESC_HTML(texto)}</a>`;

// Una tabla de dos columnas para los datos. Los renglones se arman de pares
// [etiqueta, valor] y los vacíos se caen solos: un renglón con la etiqueta y
// nada al lado se lee como un dato que falta, no como uno que no aplica.
const tablaDatos = (pares) => {
  const filas = pares.filter(([, v]) => String(v ?? "").trim() !== "");
  if (!filas.length) return "";
  return `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:4px 0 18px 0;">` +
    filas.map(([k, v]) => `<tr>
      <td style="padding:7px 10px 7px 0;font-size:11px;color:${MARCA_GRIS};text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;vertical-align:top;">${ESC_HTML(k)}</td>
      <td style="padding:7px 0;font-size:13px;color:${MARCA_TINTA};font-weight:600;">${ESC_HTML(v)}</td>
    </tr>`).join("") + `</table>`;
};

// Un bloque de pasos numerados. Los pasos son texto ya escapado por quien los
// arma, porque algunos llevan un <b> dentro.
const pasosHTML = (titulo, pasos) =>
  `<div style="font-size:12px;font-weight:700;color:${MARCA_TINTA};margin:18px 0 8px 0;">${ESC_HTML(titulo)}</div>` +
  `<ol style="margin:0;padding-left:20px;font-size:13px;color:${MARCA_PIZARRA};line-height:1.75;">` +
  pasos.map(p => `<li>${p}</li>`).join("") + `</ol>`;

const parrafoHTML = (txt) =>
  `<div style="font-size:13px;color:${MARCA_PIZARRA};line-height:1.65;margin:14px 0;">${txt}</div>`;

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

// Quién puede cerrar una semana: los roles que capturan avance. No es la misma
// lista que `QUIEN_SE_ENTERA` y no debe serlo — se cruzan en los jefes, que
// pueden cerrar y además reciben.
//
// ESTO SÍ ES UNA COPIA, y de la única que no se puede evitar: el original es
// `PERMISOS[rol].captura === "editar"` en src/App.jsx, y esa tabla no existe de
// este lado. Sin el filtro, un `cliente` o un `auditor` —que ven la obra y no
// la capturan— podrían invocar `rendirCierreSemanal` desde el SDK, mandarle a
// los mandos el parte de una semana que nadie cerró y dejar grabada la
// constancia. Como la copia no se puede borrar, se mide: el banco extrae
// `PERMISOS` de App.jsx y exige que las dos listas coincidan rol por rol, así
// que una divergencia sale en rojo en vez de quedarse como un permiso que se
// abrió solo.
const QUIEN_CIERRA = {
  constructora: ["director_general", "director_operaciones", "gerente_construccion",
    "admin_sistema", "superintendente", "residente", "administrador_obra"],
  dependencia: ["director_obras", "subdirector", "jefe_supervision", "supervisor_obra",
    "administrativo"],
};

// Quién tiene que capturar la semana DE UNA OBRA EN CONCRETO. No es una tercera
// lista: se CRUZAN las dos que ya existen. De los roles que pueden cerrar una
// semana, se quitan los que ven TODAS las obras —dirección, gerencia,
// subdirección, jefatura de supervisión—, porque un rol que responde por el
// portafolio no es el que responde por el cierre de una obra, y un aviso por
// obra a quien tiene veinte es un aviso que se aprende a ignorar.
//
// Lo que queda:
//   constructora → superintendente, residente, administrador_obra
//   dependencia  → supervisor_obra, administrativo
//
// El renglón de arriba es EXACTAMENTE la lista que estaba tecleada a mano en
// `usuariosCapturaDeObra` hasta hoy, así que el recordatorio de la constructora
// no cambia de destinatarios. El de abajo es el que no existía: en una
// dependencia captura el `supervisor_obra`, y a ése nunca se le avisó nada
// porque el trabajo sólo miraba la raíz y sólo conocía vocabulario de
// constructora.
const QUIEN_CAPTURA_EN_CAMPO = (tipo) =>
  (QUIEN_CIERRA[tipo] || []).filter(rol => !ROLES_TODAS_OBRAS.has(rol));

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
  // Una obra cuyos KPIs no se pueden leer NO se puede dejar caer en silencio.
  // El `catch` que devuelve `null` existe para que una obra rota no tumbe el
  // correo de las otras seis, y eso está bien; lo que estaba mal es que el
  // `null` desaparecía sin rastro: la obra se iba de la tabla, se iba de los
  // cuatro totales, y el mosaico seguía diciendo «N obras activas» con N
  // corto. Los directivos leían un portafolio incompleto presentado como
  // completo, y el registro de salud lo anotaba como corrida buena.
  //
  // Se recoge cuál falló y por qué. Igual que con `avisoGastoCorto`, la cifra
  // NO se corrige y la obra NO se cuela: lo único honesto es declarar el hueco
  // pegado al número.
  const noLeidas = [];
  const kpisObras = await Promise.all(
    obras.map(o => calcularKpisObra(o.id, gpData).catch(e => {
      console.error(`Error KPIs obra ${o.id}:`, e.message);
      noLeidas.push({ obraId: o.id, nombre: o.nombre || o.id, motivo: e?.message || String(e) });
      return null;
    }))
  );
  // El ORDEN de la tabla afirma algo, se quiera o no: la primera fila se lee
  // como «la obra que va más adelantada». Iba por presupuesto, que es una
  // afirmación que nadie pidió —el presupuesto ya tiene su propia columna— y
  // por eso la tabla se leía revuelta: la columna de avance subía y bajaba sin
  // patrón mientras la de presupuesto, que es la que mandaba, se leía como un
  // dato más. Ordena por avance físico, de mayor a menor.
  //
  // El desempate por presupuesto NO es decoración. `avanceFisicoPonderado`
  // devuelve 0 por dos caminos distintos —la obra que no ha arrancado y la que
  // no tiene presupuesto con el que dividir—, así que el empate en 0 es el caso
  // normal, no el raro. Sin segundo criterio esas obras salen en el orden en
  // que Firestore las devolvió, que no está garantizado entre corridas: el
  // director vería la tabla reacomodarse de un lunes a otro sin que nada
  // hubiera avanzado, y eso se lee como que el correo miente. (Lunes: este
  // correo sale con `7 9 * * 1`. El de los viernes es el recordatorio de
  // captura, que es otro trabajo.)
  const kpisValidos = kpisObras.filter(Boolean)
    .sort((a, b) => (b.avancePct || 0) - (a.avancePct || 0) ||
                    (b.presupuesto || 0) - (a.presupuesto || 0));

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
    return { enviados: 0, motivo: "sin_destinatarios", noLeidas };
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
  const { subject, html } = correoResumenSemanal(kpisValidos, fechaCorte, denegaciones, reparto, marca, noLeidas);

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
    // Y las obras que no se pudieron leer, por la misma razón: que el registro
    // de salud pueda decir «salió, pero incompleto», que es distinto de «salió».
    noLeidas,
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
    // Dos cosas distintas pueden salir mal sin que esto lance, y las dos
    // dejaban el renglón en `ok:true`: que el correo no llegue a nadie (cero
    // destinatarios dentro de la organización) y que vaya incompleto porque
    // una obra no se pudo leer. La segunda es la grave: el correo lleva
    // dinero, y un total al que le falta una obra se lee como el total.
    const noLeidas = res.noLeidas || [];
    const salio = (res.enviados || 0) > 0;
    await registrarSalud("email_semanal", salio && noLeidas.length === 0,
      (salio ? `Enviado a ${res.enviados} destinatarios` : `NO SALIÓ: ${res.motivo || "cero destinatarios"}`) +
      (noLeidas.length ? ` · INCOMPLETO: ${noLeidas.length} obra(s) no se pudo leer (${noLeidas.map(o => o.obraId).join(", ")})` : ""), {
      duracionMs: Date.now() - t0,
      enviados: res.enviados,
      destinatarios: res.destinatarios,
      resendId: res.resendId,
      noLeidas,
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

// ════════════════════════════════════════════════════════════════════════════
// UN RESPALDO QUE SE CAE Y NO SE LO DICE A NADIE
// ════════════════════════════════════════════════════════════════════════════
//
// Hasta hoy, un respaldo fallido dejaba exactamente dos rastros: un renglón en
// `global/health` y un `console.error` en Cloud Logging. Los dos son PASIVOS —
// hay que ir a mirarlos—, y la pantalla de salud existe desde septiembre sin
// que nadie la abra. Así que la copia de toda la base podía llevar semanas sin
// escribirse y el primero en enterarse habría sido quien la necesitara.
//
// Esto no sustituye a la pantalla: la empuja. El correo es el único canal que
// llega sin que a nadie se le ocurra ir a ver.
//
// A QUIÉN. Al rol `soporte`, que es el único de ámbito plataforma
// (`ROLES_CROSS`): el respaldo es de la base ENTERA, no de una organización, y
// un director de obra no puede hacer nada con esta noticia salvo preocuparse.
// Medido en producción el 2026-11-23: hay exactamente una cuenta `soporte`
// activa.
//
// LO QUE ESTE AVISO **NO** CUBRE, y hay que decirlo porque es fácil leerlo al
// revés: avisa de un respaldo que FALLÓ o que no se pudo VERIFICAR. No dice
// nada de un respaldo que se escribió entero y no se puede restaurar — eso es
// el #5, no se ha probado nunca, y ningún correo lo va a descubrir.
const ROLES_PLATAFORMA = ROLES_CROSS;

// La última corrida BUENA, sacada del historial que `registrarSalud` ya
// guarda. Es el dato que convierte «falló el respaldo» en «llevas N días sin
// copia», que es la frase que mueve a alguien. Si no hay ninguna buena en el
// historial se dice eso y no se inventa una fecha.
function ultimoRespaldoBueno(historial) {
  const filas = Array.isArray(historial) ? historial : [];
  const buena = filas.find((f) => f && f.ok === true && f.ultimaEjecucion);
  if (!buena) return null;
  const t = Date.parse(buena.ultimaEjecucion);
  if (!Number.isFinite(t)) return null;
  return { iso: buena.ultimaEjecucion, dias: Math.floor((Date.now() - t) / 86400000) };
}

function correoRespaldoCaido({ mensaje, destino, verificado, bueno }) {
  const titulo = verificado ? "El respaldo semanal FALLÓ"
    : "El respaldo semanal no se pudo verificar";
  const cuerpo =
    tablaDatos([
      ["Qué pasó", mensaje],
      ["Destino", destino || ""],
      ["Último respaldo bueno", bueno
        ? `${new Date(bueno.iso).toLocaleString("es-MX")} · hace ${bueno.dias} día${bueno.dias === 1 ? "" : "s"}`
        : "no hay ninguno registrado"],
    ]) +
    (verificado
      ? avisoHTML("La copia de esta semana <b>no se escribió</b>. Hasta que " +
        "vuelva a correr, lo único que hay es la copia anterior.")
      : avisoHTML("El export arrancó y no había terminado cuando se agotó la " +
        "espera. <b>Puede que haya quedado completo</b>: hay que mirar el " +
        "destino a mano antes de concluir nada.")) +
    parrafoHTML("El respaldo vuelve a correr solo el domingo a las 3:00. " +
      "Si esto se repite dos domingos seguidos, deja de ser un tropiezo.") +
    `<div style="margin:18px 0 4px 0;">${botonHTML("Ver la salud del sistema", `${APP_URL}/?pantalla=salud`)}</div>`;

  return {
    subject: `cotea · ${titulo}`,
    html: sobreCorreo({
      titulo,
      entradilla: "Este aviso lo manda cotea sola cuando la copia de la base " +
        "no queda hecha. Nadie tuvo que ir a mirarlo.",
      cuerpoHTML: cuerpo,
      pie: "Este correo sale sólo cuando el respaldo falla. Si no llega, el respaldo salió.",
    }),
  };
}

// Devuelve SIEMPRE un resultado, nunca lanza: el aviso es lo segundo que pasa
// en una corrida que ya salió mal, y tumbarla aquí borraría el renglón de
// salud del fallo original — cambiaría un diagnóstico por otro, que es el
// defecto que `registrarFalloDeSalud` vino a cerrar.
// La llave se lee a prueba de reventones, y no por prudencia genérica.
//
// `RESEND_API_KEY.value()` puede lanzar —secreto no enlazado, permiso
// retirado— y el aviso se pide DENTRO del `catch` del respaldo, donde el
// argumento se evalúa ANTES de entrar a la función. Un reventón ahí se lleva
// por delante el `registrarFalloDeSalud` que viene después: la corrida se
// cae, Scheduler se entera, y `global/health` no recibe nada — la pantalla
// diría «sin correr», que es falso, sí corrió. Es exactamente el defecto que
// se cerró el 2026-10-23, reabierto por una línea nueva.
//
// Lo encontró `prueba-cron-que-no-se-traga-su-fallo.cjs`, que mina todo lo
// que el manejador toca: «SIN CONSTANCIA: backup».
//
// Una llave vacía no es un silencio: `mandarCorreoDeAlta` la trata como
// `sin-llave`, eso viaja al registro y el renglón lo dice.
function llaveDeCorreo() {
  try { return RESEND_API_KEY.value(); } catch (e) {
    console.error("no se pudo leer RESEND_API_KEY:", e?.message || e);
    return "";
  }
}

// NADA del camino del aviso puede impedir que se escriba la constancia.
//
// `avisarRespaldoCaido` ya no lanza por dentro, pero se la llama desde el
// `catch` del respaldo y los ARGUMENTOS se evalúan antes de entrar: un
// reventón leyendo la llave, o en cualquier pieza que mañana se añada aquí,
// se llevaría por delante el `registrarFalloDeSalud` que viene después. La
// corrida se caería, Scheduler lo vería, y la pantalla diría «sin correr» —
// que es falso: sí corrió.
//
// Lo señaló `prueba-cron-que-no-se-traga-su-fallo.cjs`, que mina TODO lo que
// el manejador toca justamente para encontrar esto. Su exigencia es la
// correcta y no se le baja: el aviso entero, llave incluida, va envuelto.
//
// Un reventón aquí no se traga: viaja como motivo al registro, y el renglón
// dirá «NO SE AVISÓ: …».
// `historial` entra crudo y la fecha del último bueno se calcula DENTRO del
// try, no en el objeto del llamador: calcularla fuera la deja otra vez en la
// zona donde un reventón se come la constancia.
async function intentarAvisar(historial, datos) {
  try {
    return await avisarRespaldoCaido(llaveDeCorreo(),
      { ...datos, bueno: ultimoRespaldoBueno(historial) });
  } catch (e) {
    console.error("[respaldo] el aviso reventó:", e);
    return { ok: false, motivo: e?.message || String(e), enviados: 0, destinos: [] };
  }
}

async function avisarRespaldoCaido(apiKey, datos) {
  try {
    const snap = await admin.firestore().collection("usuarios").get();
    const destinos = [...new Set(snap.docs.map((d) => d.data())
      .filter((u) => u && u.activo !== false && ROLES_PLATAFORMA.includes(u.rol))
      .map((u) => String(u.email || "").trim().toLowerCase())
      .filter(Boolean))];
    if (!destinos.length) {
      console.error("[respaldo] FALLÓ y NO SE PUDO AVISAR: no hay ninguna cuenta " +
        `de plataforma activa (${ROLES_PLATAFORMA.join(", ")}).`);
      return { ok: false, motivo: "sin-destinatarios", enviados: 0, destinos: [] };
    }
    const { subject, html } = correoRespaldoCaido(datos);
    const r = await mandarCorreoDeAlta(apiKey, {
      to: destinos, subject, html, concepto: "respaldo-caido",
    });
    return { ...r, destinos };
  } catch (e) {
    console.error("[respaldo] no se pudo avisar:", e);
    return { ok: false, motivo: e?.message || String(e), enviados: 0, destinos: [] };
  }
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
  // La llave entra porque esta corrida ahora AVISA cuando se cae. Sin ella el
  // aviso no sale y la corrida se anotaría como «falló» a secas, que es el
  // silencio de siempre con otro nombre.
  secrets: [RESEND_API_KEY],
}, async () => {
  const t0 = Date.now();
  console.log("Iniciando backup semanal de Firestore…");

  // El historial se lee ANTES de escribir el renglón de esta corrida: después,
  // la de hoy ya sería la primera de la lista y «el último bueno» podría ser
  // ella misma. Es el mismo error de contar que arregló el #116, un renglón
  // más arriba.
  let historialPrevio = [];
  try {
    const salud = await admin.firestore().doc("global/health").get();
    const h = salud.exists ? salud.data()?.backup_historial : null;
    historialPrevio = Array.isArray(h) ? h : [];
  } catch (e) {
    console.warn("no se pudo leer el historial de respaldos:", e?.message || e);
  }

  try {
    const res = await ejecutarBackupFirestore();
    console.log(`Export lanzado. Destino: ${res.destino}, Op: ${res.operationName}`);
    const fin = await esperarFinDelExport(res.operationName, { plazoMs: 420 * 1000 });
    const mensaje = mensajeDeRespaldo(res.destino, fin);
    console.log(`Backup: ${mensaje}`);

    // Se avisa tanto del fallo COMO del «no se pudo verificar». Los dos
    // significan lo mismo para quien tiene que reaccionar: a esta hora no
    // consta que haya copia de esta semana. Callar el segundo sería el verde
    // falso que este proyecto persigue.
    const aviso = fin.ok ? null : await intentarAvisar(historialPrevio, {
      mensaje, destino: res.destino, verificado: !!fin.verificado,
    });

    await registrarSalud("backup", fin.ok, mensaje, {
      duracionMs: Date.now() - t0,
      destino: res.destino,
      operationName: res.operationName,
      estadoExport: fin.estado,
      verificado: fin.verificado,
      consultas: fin.intentos,
      // «Falló» y «falló y además nadie se enteró» son dos averías distintas,
      // y la segunda es la que deja a alguien tranquilo sin derecho. El
      // renglón las separa en vez de dejarlas en el mismo rojo.
      aviso: aviso ? (aviso.ok ? "enviado" : `NO SE AVISÓ: ${aviso.motivo}`) : "no hacía falta",
      avisadosA: aviso ? aviso.destinos : [],
    });
  } catch (e) {
    console.error("Error en backup semanal:", e);
    // Aquí ni siquiera hubo export: el aviso importa MÁS, no menos.
    // El aviso va envuelto OTRA VEZ, aquí, en su sitio de llamada. No es
    // redundante con el `try` de dentro de `intentarAvisar`: la llamada misma
    // puede reventar —el símbolo no existe tras un refactor a medias, una
    // dependencia no cargó— y eso ocurre ANTES de entrar a la función, donde
    // su try no alcanza. Lo que no puede pasar, pase lo que pase, es que la
    // constancia del fallo no se escriba: una corrida que reventó y no dejó
    // rastro se lee en la pantalla como «sin correr», que es falso.
    //
    // La exigencia viene de `prueba-cron-que-no-se-traga-su-fallo.cjs`, que
    // mina TODO lo que el manejador toca. Tres intentos hicieron falta para
    // satisfacerla, y los tres fallos eran el mismo defecto un paso más
    // afuera: la llave, luego el cálculo del último respaldo bueno, luego la
    // llamada entera.
    let aviso = { ok: false, motivo: "no se intentó", destinos: [] };
    try {
      aviso = await intentarAvisar(historialPrevio, {
        mensaje: `La corrida reventó antes de terminar: ${e?.message || String(e)}`,
        destino: "", verificado: true,
      });
    } catch (e2) {
      console.error("[respaldo] no se pudo ni intentar el aviso:", e2);
      aviso = { ok: false, motivo: e2?.message || String(e2), destinos: [] };
    }
    await registrarFalloDeSalud("backup", e, {
      duracionMs: Date.now() - t0,
      aviso: aviso.ok ? "enviado" : `NO SE AVISÓ: ${aviso.motivo}`,
      avisadosA: aviso.destinos,
    });
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
    return true;
  } catch (e) {
    // El `catch` se queda: una campana que no se puede escribir no tumba las
    // de los demás. Lo que cambia es que ahora CONTESTA. Antes devolvía
    // `undefined` tanto si escribió como si no, y los dos sitios que la llaman
    // hacían `contador++` después del `await`, así que contaban intentos y los
    // reportaban como notificaciones enviadas. La cuenta era siempre perfecta.
    console.warn(`crearNotifCloud fallo para uid=${uid}:`, e.message);
    return false;
  }
}

// Helper: lista de usuarios activos que capturan avance en una obra, según
// `usuario.obras_asignadas`. Filtra: solo usuarios ACTIVOS con la obra en su
// lista.
// `orgId` es obligatorio: el aviso sólo va a quien es de esa organización. El
// rol y `obras_asignadas` no son frontera —un id de obra que coincida basta
// para que un aviso con el nombre de la obra caiga en la bandeja de otro
// cliente—. Ver `orgDeLaRaiz`.
//
// De paso, `activo` pasa a mirarse en memoria. La consulta decía
// `where("activo", "!=", false)`, y en Firestore una desigualdad DESCARTA los
// documentos que no traen el campo: un perfil sin `activo` —que es un perfil
// activo— no recibía un solo aviso. Hoy los 14 perfiles de producción lo
// traen, así que esto no cambia ningún envío; cambia el día que alguien dé de
// alta una cuenta a mano.
//
// Y el `tipo` de la organización es obligatorio desde el 2026-11-16. Los tres
// roles que estaban tecleados aquí son vocabulario de constructora: en una
// dependencia nadie se llama `residente` —el que captura es `supervisor_obra`—
// así que esta función devolvía SIEMPRE la lista vacía para un municipio, y un
// recordatorio que no le llega a nadie no se distingue de uno que no existe.
// Ahora la lista se pregunta a `QUIEN_CAPTURA_EN_CAMPO`, que la deriva de las
// tablas que ya deciden quién puede cerrar una semana.
async function usuariosCapturaDeObra(obraId, orgId, tipo) {
  const rolesCaptura = QUIEN_CAPTURA_EN_CAMPO(tipo);
  // Sin roles no hay a quién avisar, y recorrer el padrón para descartarlo todo
  // es una lectura que se paga por nada.
  if (!rolesCaptura.length) return [];
  const snap = await admin.firestore().collection("usuarios")
    .where("orgId", "==", orgId).get();
  const out = [];
  snap.forEach(doc => {
    const u = doc.data();
    if (u.activo === false) return;
    if (!rolesCaptura.includes(u.rol)) return;
    const asignadas = Array.isArray(u.obras_asignadas) ? u.obras_asignadas : [];
    if (asignadas.includes(obraId)) {
      // `correo` antes que `email`: los dos campos existen en los perfiles y
      // `correo` es el que el login usa para derivar el id del documento, así
      // que es el que no puede estar desfasado.
      //
      // Y el `uid` va A SECAS. Aquí decía `u.uid || doc.id`, y ese respaldo
      // escribía la notificación en `notificaciones/{id-derivado-del-correo}`.
      // Esa ruta no la puede leer nadie: la regla sólo deja leer
      // `request.auth.uid == uid`, y el id del documento de perfil se deriva
      // del correo —`admvo_cotea_com_mx`—, que nunca es un uid de Auth. O sea
      // que el respaldo no salvaba el aviso: lo escribía donde no se ve, y
      // encima lo contaba como mandado en el registro de salud. Un número que
      // cuenta avisos que nadie puede leer es peor que un cero.
      out.push({ uid: u.uid || null, email: u.correo || u.email, nombre: u.nombre, rol: u.rol });
    }
  });
  return out;
}

// Helper: obtener nombre corto (o largo) de la obra para la notificación
function nombreObraNotif(obra) {
  const n = String(obra.nombre || obra.id || "obra");
  return n.replace(/^\d{4}\s+/, "").replace(/\s+\d{4}\s*$/, "").trim() || n;
}

// ════════════════════════════════════════════════════════════════════════════
// A1 · EL RECORDATORIO QUE SOSTIENE LA FECHA DE TÉRMINO
// ════════════════════════════════════════════════════════════════════════════
//
// ── POR QUÉ ESTE AVISO NO ES UN LUJO ───────────────────────────────────────
// La fecha de término que la app enseña no se calcula con el gasto: se calcula
// con el AVANCE FÍSICO de los últimos cierres —`ritmoEntreCierres` en
// src/App.jsx divide puntos de avance entre semanas de calendario, y el gasto
// no entra en esa cuenta—. Y ahí está la asimetría que hace falta cubrir: el
// gasto se carga solo desde GP, mientras el avance lo teclea una persona.
//
// La consecuencia es fea y callada. Si el residente se rezaga, el denominador
// —semanas de calendario— sigue corriendo y el numerador no, así que la
// velocidad baja y la fecha proyectada se va al futuro. La pantalla no dice
// «faltan cierres»: dice una fecha, con la misma cara con la que diría una
// buena. Un dato que se degrada sin avisar es peor que un hueco.
//
// ── LA HORA, Y POR QUÉ CAMBIÓ ──────────────────────────────────────────────
// El corte es el SÁBADO A LAS 2 P.M. El aviso sale 24 h antes: viernes 14:00.
// Antes salía a las 10:00 —28 h— y el texto hablaba de «el corte del viernes»,
// que es un plazo que no existe. Un recordatorio que nombra mal el plazo
// enseña a no creerle, y entonces deja de servir el día que acierte.
//
// ── Y POR CORREO, NO SÓLO EN LA CAMPANA ────────────────────────────────────
// La campana sólo la ve quien entra a la app. Quien se rezagó es, por
// definición, quien no entró. El correo va además de la campana, no en su
// lugar: la campana lleva el enlace a la obra, el correo llega donde está la
// persona.
//
// UN CORREO POR PERSONA, no uno por obra. Un residente con tres obras sin
// cerrar recibe un correo con las tres. Tres correos iguales salvo el nombre
// se leen como ruido y se archivan sin abrir.
//
// ── LO QUE NO CRUZA ────────────────────────────────────────────────────────
// Cada organización se recorre por SU ruta (`rutaObrasDeOrg`) y su padrón se
// consulta con SU `orgId`, así que el correo de un municipio no puede nombrar
// una obra de la constructora. Y no lleva una sola cifra: dice qué semana
// falta y en qué obras, nada de presupuesto, gasto ni avance. Un recordatorio
// no es un informe, y el margen de un contratista no es dato de nadie más.
async function avisarCierreSemanalPendiente(apiKey, ahora = new Date()) {
  const db = admin.firestore();
  const { semana, año } = semanaISOFn(ahora);
  const idSem = snapIdFn(semana, año);

  // ── A qué organizaciones se les habla, y por qué ruta ────────────────────
  // Antes esto era `collection("obras")` a secas: la raíz, o sea la
  // constructora. Las obras de una dependencia viven en `orgs/{oid}/obras`, de
  // modo que ningún supervisor de un municipio recibió nunca este aviso.
  //
  // La frontera de `orgDeLaRaiz` se conserva, pero expresada sobre la lista que
  // de verdad se usa: si DOS organizaciones resolvieran a la raíz, no se puede
  // decir de quién son esas obras y el trabajo no corre. Adivinar aquí es
  // mandarle a un cliente el recordatorio de la obra de otro.
  const orgsSnap = await db.collection("orgs").get();
  const destinos = [];
  const sinTipoConocido = [];
  orgsSnap.forEach(d => {
    const tipo = (d.data() || {}).tipo;
    if (!QUIEN_CIERRA[tipo]) { sinTipoConocido.push(`${d.id}:${tipo || "(sin tipo)"}`); return; }
    destinos.push({ orgId: d.id, tipo, ruta: rutaObrasDeOrg(d.id, tipo) });
  });
  const enLaRaiz = destinos.filter(o => o.ruta === "obras");
  if (enLaRaiz.length > 1) {
    throw new Error(
      `No se puede determinar de quién es \`obras/\`: ${enLaRaiz.length} organizaciones ` +
      `resuelven a la raíz (${enLaRaiz.map(o => o.orgId).join(", ")}). El trabajo no corre: ` +
      "mandar el recordatorio de una obra al cliente equivocado no se deshace.");
  }

  // Lo pendiente, juntado por PERSONA. La clave es el correo porque el id del
  // documento de perfil se deriva de él: dos perfiles con el mismo correo no
  // pueden existir, así que un correo pertenece a una sola organización.
  const porPersona = new Map();
  let notifs = 0;
  const notifsFallidas = [];
  let obrasSinCierre = 0;

  for (const org of destinos) {
    const obrasSnap = await db.collection(org.ruta).get();
    for (const obraDoc of obrasSnap.docs) {
      const obra = { id: obraDoc.id, ...obraDoc.data() };
      if (obra.estado === "archivada") continue;

      const histSnap = await db.doc(`${org.ruta}/${obra.id}/avance/historial`).get();
      const semanas = histSnap.exists ? (histSnap.data().semanas || []) : [];
      if (semanas.some(s => s.id === idSem)) continue;

      obrasSinCierre++;
      const usuarios = await usuariosCapturaDeObra(obra.id, org.orgId, org.tipo);
      const nombreCorto = nombreObraNotif(obra);
      for (const u of usuarios) {
        if (u.uid) {
          const puesta = await crearNotifCloud(u.uid, {
            categoria: "recordatorio",
            tipo: "captura_obra_pendiente",
            titulo: `Cierre semanal · ${nombreCorto}`,
            mensaje: `Falta capturar el avance físico de la ${idSem}. ` +
              "El corte es mañana sábado a las 2 p.m.",
            link: { tab: "operacion", subTab: "avance", obraId: obra.id },
          });
          if (puesta) notifs++;
          else notifsFallidas.push({ uid: u.uid, obraId: obra.id });
        }
        const correo = String(u.email || "").trim();
        if (!correo) continue;
        if (!porPersona.has(correo)) {
          porPersona.set(correo, { nombre: u.nombre, orgId: org.orgId, obras: [] });
        }
        porPersona.get(correo).obras.push(String(obra.nombre || obra.id));
      }
    }
  }

  // ── Los correos ──────────────────────────────────────────────────────────
  // La marca se lee una vez por organización, no una por persona: es el mismo
  // documento y son lecturas que se pagan.
  const marcas = new Map();
  const enviados = [];
  const rebotados = [];
  for (const [correo, p] of porPersona) {
    if (!marcas.has(p.orgId)) marcas.set(p.orgId, await marcaDeOrg(p.orgId));
    const marca = marcas.get(p.orgId);
    const { subject, html } = correoCierrePendiente({
      marca, nombre: p.nombre, idSem, obras: p.obras,
    });
    try {
      await enviarEmailResend(apiKey, { from: FROM_EMAIL, to: [correo], subject, html });
      enviados.push(correo);
    } catch (e) {
      // Un buzón que rebota no puede tumbar el aviso de los demás. Pero
      // tampoco se traga: queda en el registro y en el resumen de salud, que
      // es la diferencia entre «no le llegó» y «no se mandó».
      //
      // Ese comentario lo escribí el 2026-11-16 y era FALSO: el `console.warn`
      // iba a los registros de Cloud, y el objeto que se devuelve —de donde
      // sale el renglón de salud— sólo traía `enviados`. Una corrida donde los
      // siete buzones rebotan devolvía `correos: 0` y se anotaba igual que una
      // semana sin nada que avisar. Ahora el rebote viaja.
      console.warn(`recordatorio de cierre: no salió el correo a ${correo}:`, e.message);
      rebotados.push({ correo, motivo: e?.message || String(e) });
    }
  }

  return {
    idSem, obrasSinCierre, notifs,
    correos: enviados.length, destinatarios: enviados,
    orgs: destinos.map(o => o.orgId), sinTipoConocido,
    rebotados, notifsFallidas,
  };
}

// El correo. Sin cifras: ver el preámbulo.
function correoCierrePendiente({ marca, nombre, idSem, obras }) {
  const nombres = [...new Set(obras)];
  const nombrePila = String(nombre || "").trim().split(/\s+/)[0] || "";
  const lista = `<ul style="margin:4px 0 18px 0;padding-left:20px;font-size:13px;` +
    `color:${MARCA_TINTA};line-height:1.8;font-weight:600;">` +
    nombres.map(n => `<li>${ESC_HTML(n)}</li>`).join("") + `</ul>`;
  const cuerpoHTML =
    `<div style="font-size:12px;font-weight:700;color:${MARCA_TINTA};margin:0 0 4px 0;">` +
    `${nombres.length === 1 ? "Obra sin cerrar" : `Obras sin cerrar (${nombres.length})`}</div>` +
    lista +
    botonHTML("Capturar el avance", APP_URL) +
    avisoHTML("La fecha de término que ve la dirección se calcula con el avance " +
      "físico de los últimos cierres. Una semana sin cerrar no deja un hueco en " +
      "la pantalla: corre la fecha hacia adelante sin decir por qué.");
  return {
    subject: `Falta cerrar la ${idSem} — el corte es mañana 2 p.m.`,
    html: sobreCorreo({
      marca,
      titulo: `Falta cerrar la semana ${idSem}`,
      entradilla: `${nombrePila ? `${ESC_HTML(nombrePila)}, t` : "T"}ienes hasta ` +
        `<b>mañana sábado a las 2 p.m.</b> para capturar el avance físico de la ` +
        `semana. Después de esa hora la semana queda sin cierre.`,
      cuerpoHTML,
      pie: "Este recordatorio lo manda cotea los viernes a las 2 p.m., " +
        "24 horas antes del corte, a quien captura avance en cada obra.",
    }),
  };
}

exports.recordatorioCapturaObra = onSchedule({
  schedule: "0 14 * * 5",   // viernes 14:00 — 24 h antes del corte del sábado
  timeZone: "America/Mexico_City",
  region: "us-central1",
  secrets: [RESEND_API_KEY],
}, async () => {
  const t0 = Date.now();
  try {
    const r = await avisarCierreSemanalPendiente(RESEND_API_KEY.value(), new Date());
    // `ok` sale de lo que la corrida MIDIÓ, no de haber llegado hasta aquí.
    // Un `true` tecleado sólo distingue «el trabajo reventó» de «el trabajo
    // terminó»; lo que hace falta saber es si el aviso salió, y eso puede
    // fallar buzón por buzón sin que nada lance.
    const falló = r.rebotados.length + r.notifsFallidas.length;
    await registrarSalud("recordatorio_obra", falló === 0,
      `${r.correos} correo(s) y ${r.notifs} notif(s) por ${r.obrasSinCierre} obra(s) sin cerrar` +
      (falló ? ` · NO SALIERON ${r.rebotados.length} correo(s) y ${r.notifsFallidas.length} notif(s)` : ""),
      { duracionMs: Date.now() - t0, ...r });
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
    const notifsFallidas = [];

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
        // `"constructora"` no es una suposición: `orgDeLaRaiz` ya lanzó si la
        // raíz no es de exactamente una, y lo que busca es `tipo ==
        // "constructora"`. Esta alerta del lunes sigue recorriendo sólo la raíz
        // —ampliarla a las dependencias es otro cambio y se mide aparte—.
        const usuarios = await usuariosCapturaDeObra(obra.id, orgRaiz, "constructora");
        const nombreCorto = nombreObraNotif(obra);
        for (const u of usuarios) {
          if (!u.uid) continue;
          const puesta = await crearNotifCloud(u.uid, {
            categoria: "recordatorio",
            tipo: "pendientes_lunes",
            titulo: `${pendientes} pendientes esta semana · ${nombreCorto}`,
            mensaje: `Aún faltan por capturar: ${razones.join(", ")}.`,
            link: { tab: "operacion", obraId: obra.id },
          });
          if (puesta) contadorNotifs++; else notifsFallidas.push({ uid: u.uid, obraId: obra.id });
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
        const usuariosObra = await usuariosCapturaDeObra(obra.id, orgRaiz, "constructora");
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
          const puesta2 = await crearNotifCloud(u.uid, {
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
          if (puesta2) contadorNotifs++; else notifsFallidas.push({ uid: u.uid, obraId: obra.id });
        }
      }
    }
    await registrarSalud("recordatorio_lunes", notifsFallidas.length === 0,
      `${contadorNotifs} notifs enviadas` +
      (notifsFallidas.length ? ` · NO SE PUDIERON ESCRIBIR ${notifsFallidas.length}` : ""),
      { duracionMs: Date.now() - t0, notifsEnviadas: contadorNotifs, notifsFallidas });
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

// ════════════════════════════════════════════════════════════════════════════
// RENDIR EL CIERRE SEMANAL — art. 73 de la Ley 233 de Veracruz
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTO NO PUEDE VIVIR EN EL FRONT.
//
// Rendir el cierre es, mecánicamente, «buscar en el padrón quién tiene tal rol
// en mi organización y avisarle». Pero `usuarios` es una colección raíz
// compartida por todos los clientes, y las reglas sólo dejan LISTARLA a los
// admin de cada org: `director_obras` y `subdirector` en dependencia,
// `director_general`/`director_operaciones`/`admin_sistema` en constructora.
//
// El resultado era al revés de lo que pide la ley. Quien está obligado a rendir
// —el residente en la constructora, el supervisor de obra en la dependencia— es
// justo quien NO puede leer el padrón, así que su cierre no avisaba a nadie. Y
// quien sí podía era el jefe, que no tiene a quién rendirle.
//
// Las dos salidas eran abrir el padrón a toda la organización —exponer nombre,
// correo y rol de todos, incluido el contratista, que está del otro lado del
// mostrador— o hacer el reparto aquí, donde el Admin SDK no pasa por reglas y
// el padrón no sale nunca hacia el cliente. Esto es lo segundo: lo único que
// cruza de vuelta son los correos de quienes SÍ recibieron el aviso.
//
// Y DE PASO CIERRA UN AGUJERO QUE NO ERA EL QUE SE BUSCABA.
//
// La constancia se escribe aquí también, no en el cliente. Mientras la escribía
// el front, las reglas tenían que dejar que cualquiera que pudiera editar la
// obra escribiera CUALQUIER contenido en `avance/rendiciones`: nada impedía
// firmar un acuse nombrando a tres mandos a los que nunca se avisó. Para el
// documento con el que alguien sostiene que cumplió la ley, eso no sirve. Ahora
// la lista de destinatarios que queda grabada es exactamente la que esta
// función acaba de notificar, y el cliente sólo puede leerla.
//
// UNA SOLA TABLA. `QUIEN_SE_ENTERA` vive únicamente aquí; el front ya no decide
// a quién se rinde, sólo pinta lo que esta función contesta. Dos copias de la
// misma lista en dos repos que se despliegan por separado es una discrepancia
// esperando: la de producción sería la que estuviera más atrasada.

// A quién se le rinde, por tipo de organización. Son los mandos que responden
// por la obra ARRIBA de quien la captura — nunca el contratista ni el cliente,
// que están del otro lado del contrato, ni el contralor, que fiscaliza el
// expediente completo y no recibe el parte de cada semana.
const QUIEN_SE_ENTERA = {
  constructora: ["director_general", "director_operaciones", "gerente_construccion", "admin_sistema"],
  dependencia: ["director_obras", "subdirector", "jefe_supervision"],
};

// `QUIEN_CIERRA` vivía aquí. Se subió junto a `rutaObrasDeOrg` el 2026-11-16,
// cuando el recordatorio del viernes pasó a necesitarla: las dos contestan la
// misma pregunta —dónde están las obras de una organización y quién las
// captura— y tenerlas separadas invitaba a teclear una segunda lista.

exports.rendirCierreSemanal = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  const correo = String(request.auth.token.email || "").toLowerCase();
  if (!correo) throw new HttpsError("unauthenticated", "Token sin email.");

  const { obraId, clave, obraNombre, semana, avance } = request.data || {};
  if (!obraId || !clave) {
    throw new HttpsError("invalid-argument", "Falta la obra o la semana que se cerró.");
  }

  const db = admin.firestore();
  const perfilSnap = await db.doc(`usuarios/${emailAId(correo)}`).get();
  const perfil = perfilSnap.exists ? perfilSnap.data() : null;
  if (!perfil || perfil.activo === false) {
    throw new HttpsError("permission-denied", "Tu usuario no está activo.");
  }

  // El `tipo` y el `orgId` salen de los CLAIMS, que es el mismo dato que
  // evalúan las reglas de Firestore, y nunca de `request.data`: un `onCall` se
  // invoca desde el SDK sin pasar por la interfaz, así que un `orgId` que
  // viniera en la llamada sería el cliente eligiendo a qué padrón entrar.
  const tipo = request.auth.token.tipo;
  const orgId = request.auth.token.orgId;
  if (!orgId || !QUIEN_SE_ENTERA[tipo]) {
    throw new HttpsError("failed-precondition",
      "Tu cuenta no pertenece a una organización que rinda cierres semanales.");
  }
  if (!(QUIEN_CIERRA[tipo] || []).includes(perfil.rol)) {
    throw new HttpsError("permission-denied",
      "Tu rol no captura avance, así que no cierra semanas.");
  }
  // Y la obra tiene que ser de su organización. Sin esto, un supervisor podría
  // mandar el parte de una obra ajena a los mandos de la suya.
  //
  // La ruta se PREGUNTA a `rutaObrasDeOrg`, no se teclea: las obras de una
  // constructora viven en la raíz y las de una dependencia bajo su
  // organización. Teclear aquí `orgs/${orgId}/obras` —como estuvo escrito— deja
  // la función correcta para el municipio y muerta para la constructora: la
  // obra «no existe», sale `not-found`, y la pantalla pinta «el aviso no salió»
  // sin que nada en el registro diga por qué. Se vio en el emulador, no en el
  // banco, porque el banco se había inventado la asimetría al revés.
  const rutaObra = `${rutaObrasDeOrg(orgId, tipo)}/${obraId}`;
  const obraSnap = await db.doc(rutaObra).get();
  if (!obraSnap.exists) {
    throw new HttpsError("not-found", "Esa obra no existe en tu organización.");
  }
  // Quien no ve todas las obras sólo rinde las suyas. La distinción se pregunta
  // a `ROLES_TODAS_OBRAS`, que es la misma que alimenta el claim `todas` que
  // evalúan las reglas: teclear aquí una cuarta lista de roles sería una copia
  // más que desincronizar.
  if (!ROLES_TODAS_OBRAS.has(perfil.rol)) {
    const asignadas = Array.isArray(perfil.obras_asignadas)
      ? perfil.obras_asignadas.map(String) : [];
    if (!asignadas.includes(String(obraId))) {
      throw new HttpsError("permission-denied", "Esa obra no está asignada a ti.");
    }
  }

  const roles = QUIEN_SE_ENTERA[tipo];
  const padron = await db.collection("usuarios").where("orgId", "==", orgId).get();
  // `correo` y no `email`: así está el documento de usuario en Firestore. Leer
  // de `email` caía al `uid`, y una constancia que nombra un identificador
  // opaco no nombra a nadie. `email` se consulta de segundo porque hay
  // documentos viejos que sí lo traen.
  //
  // Y se excluye a quien llama: el director de Obras es a la vez quien puede
  // cerrar y uno de los roles a los que hay que rendir, así que sin esto se
  // extendía el acuse a sí mismo.
  const gente = padron.docs
    .map((d) => d.data())
    .filter((u) => roles.includes(u.rol) && u.activo !== false && u.uid
      && String(u.correo || u.email || "").toLowerCase() !== correo);

  if (gente.length === 0) {
    // Hueco de la organización, no fallo: nadie activo tiene esos roles. No se
    // escribe constancia, porque no hubo rendición que acreditar.
    return { ok: true, roles, destinatarios: [], constancia: null };
  }

  const titulo = `Cierre semanal${semana ? ` S${semana}` : ""} · ${obraNombre || obraId}`;
  const mensaje = `Avance: ${Number(avance || 0).toFixed(1)}% · ${perfil.nombre || correo} cerró el reporte`;
  const lote = db.batch();
  for (const u of gente) {
    lote.set(db.collection(`notificaciones/${u.uid}/items`).doc(), {
      categoria: "actividad",
      tipo: "cierre_semana",
      titulo,
      mensaje,
      link: { tab: "operacion", subTab: "avance", obraId },
      leida: false,
      archivada: false,
      // `FieldValue` modular, nunca `admin.firestore.FieldValue`: dentro del
      // emulador de funciones ese namespace es `undefined` y la función moriría
      // con «Cannot read properties of undefined». El por qué está arriba, en
      // el `require`.
      fecha: FieldValue.serverTimestamp(),
      creadaPor: correo,
    });
  }
  await lote.commit();

  const destinatarios = gente.map((u) => u.correo || u.email);

  // La constancia DESPUÉS del aviso y sólo si el aviso salió: al revés sería
  // afirmar en el expediente una rendición que puede no haber ocurrido. Si el
  // commit de arriba hubiera lanzado, no llegamos aquí.
  //
  // Vive fuera de `avance/historial` porque ése se recorta a 52 semanas y el
  // art. 74 pide conservar el expediente cinco años.
  let constancia = true;
  try {
    await db.doc(`${rutaObra}/avance/rendiciones`).set({
      rendiciones: {
        [clave]: {
          en: new Date().toISOString(),
          a: destinatarios,
          roles,
          porQuien: correo,
          rol: perfil.rol,
        },
      },
    }, { merge: true });
  } catch (e) {
    // El aviso ya salió y no se deshace. Se contesta `false` para que la
    // pantalla pueda decir la verdad —avisados sí, acreditado no— en vez de
    // anunciar una rendición completa.
    console.error("rendirCierreSemanal: constancia", e);
    constancia = false;
  }

  return { ok: true, roles, destinatarios, constancia };
});
