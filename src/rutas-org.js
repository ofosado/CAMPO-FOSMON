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

// `null` significa "todavía no se fijó", que NO es lo mismo que la cadena
// vacía de una constructora. Por eso el centinela es null y no "".
let PREFIJO = null;

/**
 * Fija el prefijo de la sesión. Se llama una sola vez, en el login, con los
 * claims ya refrescados.
 *
 * LANZA si no puede decidir. Nunca cae a la raíz "por si acaso": caer a la
 * raíz en silencio es cómo se pierde un dato sin que nadie se entere, y
 * además metería los datos de un cliente en el espacio de otro.
 */
export function fijarPrefijoOrg(tipo, orgId) {
  if (tipo === 'constructora') { PREFIJO = ''; return PREFIJO; }
  if (tipo === 'dependencia') {
    if (!orgId) throw new Error('Tu cuenta es de tipo dependencia pero no tiene organización asignada.');
    PREFIJO = `orgs/${orgId}/`;
    return PREFIJO;
  }
  throw new Error(`No se pudo determinar tu organización (tipo=${tipo ?? 'ausente'}).`);
}

/** Se llama al cerrar sesión. Sin esto, la siguiente sesión arrancaría
 *  apuntando a la organización de la anterior. */
export function limpiarPrefijoOrg() { PREFIJO = null; }

export function prefijoOrg() {
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
