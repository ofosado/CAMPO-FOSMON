// ── LOS ARCHIVOS SE BAJAN POR UNA RUTA DE COTEA ────────────────────────────
//
// Una URL de descarga de Firebase tiene esta forma:
//
//   https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/o/<objeto>?alt=media
//
// El host es neutro; **lo que delata el nombre del cliente es el bucket, que
// va dentro de la ruta**. Y esa URL se ve: al compartir una foto, al abrir un
// PDF de OT en otra pestaña, al copiar la dirección de una imagen. FOSMON es
// un cliente de cotea, no su dueño.
//
// El bucket no se puede renombrar —se llama como el proyecto de GCP, que es
// permanente—, así que se deja de exponer: `public/_redirects` sirve
// `/archivo/*` desde el dominio de cotea y lo manda al bucket por detrás.
//
// ── POR QUÉ ESTÁ EN SU PROPIO MÓDULO ───────────────────────────────────────
// Lo usan `App.jsx` y `ot.jsx`, y `ot.jsx` no puede importar de `App.jsx`.
// Escrito dos veces serían dos respuestas a «¿de dónde se baja este archivo?»,
// y la que se quedara vieja no fallaría: serviría la URL que delata.
//
// ── LAS DOS DECISIONES QUE NO SON OBVIAS ───────────────────────────────────
//
// SE REESCRIBE AL PINTAR, NO AL SUBIR. Las URLs ya están guardadas en
// Firestore —656 fotos—, así que reescribir en la subida arreglaría sólo lo
// que venga. Y guardar la URL de cotea en el dato ataría el dato al dominio:
// el día que cambie, las fotos viejas apuntan a ninguna parte.
//
// DEVUELVE LA URL TAL CUAL cuando no reconoce la forma. Una foto que no se ve
// es peor que una foto cuya dirección dice el nombre del proyecto, y en el
// emulador las URLs son de otro host y tienen que seguir funcionando.

export const HOST_DE_STORAGE = 'firebasestorage.googleapis.com';
export const RUTA_DE_ARCHIVOS = '/archivo/';

export function archivoEnCotea(url) {
  const s = String(url || '');
  if (!s) return url;
  let u;
  try { u = new URL(s); } catch { return url; }   // relativa o data URI: no se toca
  if (u.host !== HOST_DE_STORAGE) return url;
  // `pathname` conserva el percent-encoding, y eso es portante: el nombre del
  // objeto viaja con sus `%2F` y Storage rechaza la forma con barras de
  // verdad —medido contra el bucket real: 400—.
  const m = /^\/v0\/b\/[^/]+\/o\/(.+)$/.exec(u.pathname);
  if (!m) return url;
  // Ruta RELATIVA, no `https://app.cotea.com.mx/…`: así sirve igual en
  // `cotea.com.mx`, en el dominio de Netlify y en una vista previa de rama,
  // sin que el host quede escrito en el código.
  return `${RUTA_DE_ARCHIVOS}${m[1]}${u.search}`;
}
