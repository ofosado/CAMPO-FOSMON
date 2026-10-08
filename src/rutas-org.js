// ════════════════════════════════════════════════════════════════════════════
// DÓNDE VIVEN LAS OBRAS
// ════════════════════════════════════════════════════════════════════════════
// Las obras de una constructora viven en la RAÍZ (`obras/{id}`) y las de una
// dependencia bajo su organización (`orgs/{oid}/obras/{id}`). Este archivo es
// la única pieza del front que conoce esa diferencia: el resto de la app
// sigue pidiendo la ruta lógica `obras/...` y aquí se le antepone —o no— el
// prefijo que corresponda.
//
// Vive aparte de App.jsx por una razón concreta: así la prueba de conducta
// ejercita ESTE código y no una copia suya. Una copia se desincroniza y la
// prueba pasa mientras la app falla.
//
// ── EL DISCRIMINANTE ES `tipo`, NO LA PRESENCIA DE `orgId` ──────────────────
// No es un detalle de estilo. Medido en producción el 2026-09-24: los 14
// usuarios de FOSMON YA tienen `orgId: "fosmon"` y sus obras siguen en la
// raíz. Decidir por "¿tiene orgId?" mandaría a toda la producción a un lugar
// donde no hay un solo documento.
//
// ── EL DATO SALE DE LOS CLAIMS DEL TOKEN, NO DEL PERFIL ─────────────────────
// El perfil guarda `orgId` pero no `tipo`; `tipo` se resuelve leyendo
// `orgs/{orgId}` y lo escribe la Cloud Function `sincronizarClaims`. Y la
// razón de fondo: los claims son exactamente el dato con el que las reglas de
// Firestore juzgan la petición. Si el front eligiera la ruta con un dato
// distinto del que las reglas evalúan, los dos pueden divergir — y esa
// divergencia se manifiesta como una escritura que se evapora sin error, que
// es PENDIENTES #31 y #35.

// ── EL TERCER ESTADO: LA SESIÓN DE PLATAFORMA ───────────────────────────────
// `soporte` es el rol que cruza organizaciones: existe para crear una
// organización y el primer usuario de cada una, y nada más. No tiene `orgId`
// ni `tipo` —así se lo escribe `aplicarClaimsUsuario`, y así lo documenta la
// cabecera de firestore.rules—, y por eso `fijarPrefijoOrg` LANZABA con sus
// claims y el login lo sacaba de la sesión antes de pintar nada. El rol
// existía en las reglas y no podía entrar.
//
// La tentación es admitir `tipo` ausente y caer a la raíz. Eso convertiría a
// soporte en un usuario de la constructora: sus lecturas de obra apuntarían a
// las cinco obras de FOSMON. El estado correcto no es "la raíz" sino "esta
// sesión NO administra obras", y la forma de decirlo es que cualquier ruta de
// obra reviente. Un símbolo y no una cadena a propósito: si alguna vez se
// escapa a una concatenación, `symbol + string` lanza TypeError en vez de
// armar una ruta plausible.
const PLATAFORMA = Symbol('sesión de plataforma: sin obras');

// `null` significa "todavía no se fijó", que NO es lo mismo que la cadena
// vacía de una constructora. Por eso el centinela es null y no "".
let PREFIJO = null;

// El `orgId` de la sesión, aparte del prefijo. Hace falta porque `usuarios/` es
// una colección RAÍZ y compartida: `conOrg` no la prefija —y no debe—, pero las
// consultas que la recorren sí tienen que acotarse a una organización. Sin esto
// `notifARoles` buscaba por rol en toda la colección, y un aviso sobre el alta
// de un usuario en un municipio llegaba al director de otro.
let ORG_ID = null;

/**
 * Fija el prefijo de la sesión. Se llama una sola vez, en el login, con los
 * claims ya refrescados.
 *
 * LANZA si no puede decidir. Nunca cae a la raíz "por si acaso": caer a la
 * raíz en silencio es cómo se pierde un dato sin que nadie se entere, y
 * además metería los datos de un cliente en el espacio de otro.
 */
export function fijarPrefijoOrg(tipo, orgId) {
  // Se guarda para los DOS tipos. Una constructora no lleva prefijo de ruta
  // pero sí tiene organización —los 14 usuarios de FOSMON tienen
  // `orgId: "fosmon"`—, y es ese `orgId` el que acota las consultas a
  // `usuarios/`.
  ORG_ID = orgId || null;
  if (tipo === 'constructora') { PREFIJO = ''; return PREFIJO; }
  if (tipo === 'dependencia') {
    if (!orgId) throw new Error('Tu cuenta es de tipo dependencia pero no tiene organización asignada.');
    PREFIJO = `orgs/${orgId}/`;
    return PREFIJO;
  }
  throw new Error(`No se pudo determinar tu organización (tipo=${tipo ?? 'ausente'}).`);
}

/**
 * Fija la sesión de plataforma. Es el equivalente de `fijarPrefijoOrg` para el
 * rol cross-tipo, y está aparte justamente para que no haya un camino en el
 * que un `tipo` ausente resuelva a algo: aquí hay que pedirlo por su nombre.
 *
 * Quién la llama se decide con el ROL de los claims —el mismo dato con el que
 * las reglas evalúan `esSoporte()`—, no con la ausencia de `tipo`.
 */
export function fijarSesionDePlataforma() { PREFIJO = PLATAFORMA; ORG_ID = null; }

/** Para que la interfaz pueda preguntar "¿esta sesión administra obras?" sin
 *  provocar la excepción. */
export function esSesionDePlataforma() { return PREFIJO === PLATAFORMA; }

/** Se llama al cerrar sesión. Sin esto, la siguiente sesión arrancaría
 *  apuntando a la organización de la anterior. */
export function limpiarPrefijoOrg() { PREFIJO = null; ORG_ID = null; }

/**
 * El `orgId` de la sesión. LANZA si no se ha fijado, por lo mismo que
 * `prefijoOrg`: una consulta que cae a "todas las organizaciones" porque el
 * dato no estaba es exactamente la fuga que esto evita.
 */
export function orgIdSesion() {
  if (PREFIJO === PLATAFORMA) {
    throw new Error('Esta sesión es de plataforma y no pertenece a ninguna organización: la consulta tiene que decir a cuál se refiere.');
  }
  if (!ORG_ID) {
    throw new Error('Se intentó consultar por organización sin organización resuelta.');
  }
  return ORG_ID;
}

export function prefijoOrg() {
  if (PREFIJO === PLATAFORMA) {
    throw new Error('Esta sesión es de plataforma: administra organizaciones y usuarios, no obras.');
  }
  if (PREFIJO === null) {
    throw new Error('Se intentó leer o escribir una obra sin organización resuelta.');
  }
  return PREFIJO;
}

/**
 * Antepone el prefijo SÓLO a las rutas de obra.
 *
 * `usuarios/`, `global/`, `auditoria/` y `notificaciones/` son colecciones
 * raíz compartidas y no se tocan — de hecho el propio login lee
 * `usuarios/{id}` ANTES de que exista prefijo, y tiene que poder.
 */
export function conOrg(path) {
  return (path === 'obras' || path.startsWith('obras/'))
    ? prefijoOrg() + path
    : path;
}
