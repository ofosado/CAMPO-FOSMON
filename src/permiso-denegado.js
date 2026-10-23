// ════════════════════════════════════════════════════════════════════════════
// QUÉ SIGNIFICA UN «PERMISO DENEGADO»
// ════════════════════════════════════════════════════════════════════════════
// Firebase contesta `storage/unauthorized` o `permission-denied` y no dice por
// qué. La app traducía eso a una sola frase —«ya no tienes acceso a esta
// obra»— y esa frase es una AFIRMACIÓN SOBRE EL DATO: dice que al usuario le
// quitaron la obra. Las más de las veces era mentira.
//
// Son tres situaciones distintas y sólo una de ellas es esa:
//
//  1. EL TOKEN IBA RANCIO. El usuario sí tiene la obra; su JWT todavía no lo
//     sabe. Los claims tardan hasta una hora en refrescarse solos, y el
//     listener de `claimsVersion` sólo corre si la Cloud Function alcanzó a
//     incrementarlo. Aquí no hay nada que contarle a nadie: se refresca el
//     token, se reintenta UNA vez, y si pasa, pasó.
//
//  2. DE VERDAD PERDIÓ EL ACCESO. Con el token ya fresco, la obra no está en
//     sus claims. Ahí sí: «ya no tienes acceso a esta obra» es cierto, y es
//     accionable — sabe a quién pedírselo.
//
//  3. NI UNA COSA NI LA OTRA. Token fresco, la obra SÍ está en sus claims, y
//     las reglas igual niegan. Eso no lo sabemos explicar, y el usuario
//     tampoco puede arreglarlo. Decirle que perdió el acceso lo manda a pedir
//     un permiso que ya tiene. Este es el caso que deja RASTRO.
//
// Vive fuera de App.jsx para que el banco ejecute esta decisión y no una copia
// suya; una copia se desincroniza y la prueba se comprueba contra sí misma.
// Por eso tampoco importa nada de `firebase/*`: todo lo que toca el mundo
// —refrescar el token, leer los claims, escribir el rastro, el reloj— entra
// como argumento.

export const CASO = {
  /** No fue una denegación de permisos: red, cuota, disco. Se relanza. */
  NO_ES_PERMISO: 'no_es_permiso',
  /** 1 — el token iba rancio y el reintento funcionó. Sin mensaje. */
  RANCIO: 'token_rancio',
  /** 2 — ya no tiene la obra. */
  SIN_ACCESO: 'sin_acceso',
  /** 3 — la tiene según sus claims y aun así se le niega. Deja rastro. */
  INEXPLICADO: 'inexplicado',
};

// `unauthenticated` entra en la lista a propósito: la sesión caducada se
// manifiesta igual que la falta de permiso, y el reintento con token fresco es
// exactamente lo que la arregla.
const CODIGOS = new Set([
  'permission-denied',
  'unauthenticated',
  'storage/unauthorized',
  'storage/unauthenticated',
]);

export function esDenegacion(e) {
  return CODIGOS.has(e?.code);
}

/**
 * Corre `intentar()`. Si lo niegan, refresca el token y lo intenta UNA vez
 * más; según lo que pase, clasifica.
 *
 * Un solo reintento, no un bucle: si el token fresco tampoco sirve, insistir
 * no cambia nada y lo único que se consigue es que el usuario espere más para
 * leer el mismo error. Y el refresco se pide una vez por intento, no por cada
 * archivo de una tanda.
 *
 * Devuelve `{ caso, valor, mensaje, error }`. No lanza por la denegación —el
 * llamador decide si lanza o avisa—, pero sí deja escapar cualquier error que
 * no sea de permisos, que es el caso `NO_ES_PERMISO` y no pasa por aquí.
 *
 * @param intentar  () => Promise  la operación, reintentable tal cual
 * @param ctx.refrescarToken  () => Promise   fuerza el JWT nuevo
 * @param ctx.tieneLaObra     () => Promise<boolean>  según el token YA fresco
 * @param ctx.obraId          para el mensaje y el rastro
 */
export async function conReintentoDePermiso(intentar, ctx) {
  try {
    return { caso: null, valor: await intentar() };
  } catch (primero) {
    if (!esDenegacion(primero)) throw primero;   // caso NO_ES_PERMISO

    // Si no se puede ni refrescar el token, no hay forma de distinguir 2 de 3.
    // Eso es exactamente el caso 3: no sabemos.
    try {
      await ctx.refrescarToken();
    } catch (e) {
      return { caso: CASO.INEXPLICADO, error: primero,
        mensaje: mensajeInexplicado(ctx.obraId, primero?.code),
        detalle: `no se pudo refrescar el token: ${e?.message || e}` };
    }

    try {
      return { caso: CASO.RANCIO, valor: await intentar() };
    } catch (segundo) {
      if (!esDenegacion(segundo)) throw segundo;

      let tiene;
      try {
        tiene = await ctx.tieneLaObra();
      } catch (e) {
        return { caso: CASO.INEXPLICADO, error: segundo,
          mensaje: mensajeInexplicado(ctx.obraId, segundo?.code),
          detalle: `no se pudieron leer los claims: ${e?.message || e}` };
      }

      if (!tiene) {
        return { caso: CASO.SIN_ACCESO, error: segundo,
          mensaje: 'Ya no tienes acceso a esta obra. Si crees que es un error, ' +
                   'pídele a quien administra el sistema que te la asigne otra vez.' };
      }
      return { caso: CASO.INEXPLICADO, error: segundo,
        mensaje: mensajeInexplicado(ctx.obraId, segundo?.code) };
    }
  }
}

// No promete que alguien lo vaya a ver, ni cuándo. El rastro es mejor
// esfuerzo (ver `encolarRastro`) y un mensaje que prometa más que eso es otra
// afirmación falsa, más difícil de desmentir que la primera.
function mensajeInexplicado(obraId, codigo) {
  return 'No se pudo guardar: el sistema rechazó la operación y tu cuenta sí ' +
    `tiene asignada la obra ${obraId}. No es algo que puedas corregir desde ` +
    'aquí. Vuelve a intentarlo; si sigue pasando, repórtalo con la hora y ' +
    `este código: ${codigo || 'sin código'}.`;
}

/**
 * El renglón que se escribe en la bitácora cuando el caso 3 ocurre.
 *
 * ── LOS DOS RELOJES ────────────────────────────────────────────────────────
 * Lleva DOS tiempos y no son redundantes:
 *
 *  · `ts`  — el reloj del teléfono, en ISO. Puede estar mal; de hecho en 16 de
 *    las capturas de la obra 0127 lo está. Pero es el único que existe en el
 *    momento del fallo, y si la fila se encola y se escribe tres días después,
 *    es el único que dice cuándo pasó.
 *  · `tsServidor` — `serverTimestamp()`, lo pone Firestore al escribir. Es el
 *    bueno para ordenar, y el único que no puede falsear el aparato.
 *
 * La DIFERENCIA entre los dos es el dato interesante: un salto grande dice o
 * que el reloj del teléfono está mal, o que la fila viajó en la cola. Guardar
 * uno solo pierde esa distinción, y es la distinción que hace falta para no
 * leer mal el rastro.
 *
 * El centinela de Firestore entra como argumento (`servidor`) en vez de
 * importarse: así es ESTA función la que decide que van los dos relojes, y el
 * banco puede ejercitar esa decisión en vez de una copia suya.
 */
export function construirRastro({ uid, correo, obraId, ruta, codigo, detalle,
                                  ahoraISO, servidor }) {
  return {
    tipo: 'error_permiso',
    uid: uid || null,
    usuario: correo || null,
    obraId: obraId || null,
    path: ruta || null,
    codigo: codigo || null,
    ...(detalle ? { detalle } : {}),
    ts: ahoraISO,
    tsServidor: servidor ?? null,
    userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
  };
}

// ── LA COLA: MEJOR ESFUERZO, Y NADA MÁS ────────────────────────────────────
// Si el rastro tampoco se puede escribir —porque lo que falló era la red, o
// porque las reglas niegan también esto— se guarda en `localStorage` y se
// intenta otra vez al próximo arranque.
//
// NO ES UN CAMINO DURABLE Y NO SE DEBE TRATAR COMO TAL:
//
//  · iOS Safari borra el almacenamiento de un sitio a los 7 días sin visitas.
//    Las apps INSTALADAS en la pantalla de inicio están exentas; una pestaña
//    normal, no. Buena parte del campo usa la pestaña.
//  · El usuario puede limpiar datos del navegador en cualquier momento.
//  · Un aparato que se pierde se lleva la cola.
//
// Por eso ningún mensaje de la app dice que el reporte quedó registrado, ni
// que alguien lo va a ver. Lo que se gana es que ALGUNAS de las veces el
// rastro llega, y eso es estrictamente mejor que ninguna. Lo que no se puede
// es contar la cola como si fuera la bitácora.
const LLAVE = 'campo.rastros_pendientes';

// Tope deliberadamente bajo. La cola no es un archivo: si se acumulan 50
// rastros sin poder enviarse, el problema no es que falten los 51 siguientes.
const TOPE = 50;

/**
 * Guarda una fila que no se pudo escribir, JUNTO CON SU RUTA.
 *
 * ── POR QUÉ VIAJA LA RUTA EN VEZ DE RESOLVERSE AL DRENAR ───────────────────
 * Desde el #73 la bitácora está partida: la de una dependencia vive en
 * `orgs/{oid}/auditoria` y la de la constructora en la raíz. La cola
 * sobrevive al cierre de sesión. Si al drenar se preguntara «¿dónde escribe
 * ESTA sesión?», la fila que un municipio encoló ayer aterrizaría hoy en la
 * bitácora de la constructora — que es exactamente la fuga que el #73 acaba
 * de cerrar, entrando por detrás y puesta por nosotros.
 *
 * La ruta se decide cuando hay con qué decidirla, y se guarda.
 */
export function encolarRastro(ruta, fila, almacen) {
  if (!almacen) return false;
  try {
    // El centinela del servidor NO sobrevive a `JSON.stringify`: se guardaría
    // como `{}` y Firestore lo escribiría como un mapa vacío en vez de una
    // hora. Se tira aquí y se repone al drenar — con lo cual el `tsServidor`
    // de una fila que pasó por la cola dice cuándo se DRENÓ, no cuándo pasó.
    // Esa es justamente la razón de que `ts`, el reloj del aparato, viaje
    // también: es el único que conserva el momento del fallo.
    const { tsServidor, ...sinCentinela } = fila;
    const cola = leerCola(almacen);
    cola.push({ ruta, fila: sinCentinela });
    almacen.setItem(LLAVE, JSON.stringify(cola.slice(-TOPE)));
    return true;
  } catch {
    // Cuota llena, modo privado, almacenamiento deshabilitado. Se perdió, y
    // así se queda: este es el eslabón que no promete nada.
    return false;
  }
}

export function leerCola(almacen) {
  if (!almacen) return [];
  try {
    const crudo = almacen.getItem(LLAVE);
    const cola = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(cola) ? cola : [];
  } catch {
    return [];
  }
}

/**
 * Intenta escribir lo encolado. Lo que se escribe se saca de la cola; lo que
 * no, se queda para el próximo arranque.
 *
 * Se vuelve a guardar lo pendiente AUNQUE no se haya escrito nada, porque
 * `escribir` puede haber tenido éxito con unas filas y no con otras.
 *
 * `nuevoCentinela` repone el `tsServidor` que `encolarRastro` tuvo que tirar.
 * Si no se pasa, la fila se escribe sin él y queda con un solo reloj: peor,
 * pero honesto. Inventar una hora de servidor sería peor que no tenerla.
 *
 * `escribir` recibe DOS argumentos —`(ruta, fila)`— y no uno: la ruta sale de
 * la cola, no de la sesión que está drenando. Ver `encolarRastro`.
 *
 * Una entrada que no trae ruta no se puede entregar a ningún lado, y dejarla
 * dando vueltas sería una cola que nunca se vacía. Se descarta, pero el
 * número SALE en el resultado: perder filas en silencio es el defecto que
 * esta pieza entera existe para no tener.
 */
export async function drenarCola(almacen, escribir, nuevoCentinela) {
  const cola = leerCola(almacen);
  if (!cola.length) return { enviados: 0, pendientes: 0, descartados: 0 };

  const quedan = [];
  let enviados = 0, descartados = 0;
  for (const entrada of cola) {
    if (!entrada?.ruta || !entrada?.fila) { descartados++; continue; }
    try {
      await escribir(entrada.ruta, nuevoCentinela
        ? { ...entrada.fila, tsServidor: nuevoCentinela() }
        : entrada.fila);
      enviados++;
    } catch {
      quedan.push(entrada);
    }
  }
  try {
    if (quedan.length) almacen.setItem(LLAVE, JSON.stringify(quedan));
    else almacen.removeItem(LLAVE);
  } catch { /* ver `encolarRastro`: aquí tampoco se promete nada */ }

  return { enviados, pendientes: quedan.length, descartados };
}
