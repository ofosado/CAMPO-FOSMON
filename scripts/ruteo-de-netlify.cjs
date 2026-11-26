#!/usr/bin/env node
// EL RUTEO DE NETLIFY, UNA SOLA VEZ
//
// `public/_redirects` decide dos cosas que no se ven desde el navegador hasta
// que fallan: a dónde va el enlace del correo de recuperar, y de dónde se
// bajan las fotos de evidencia. Dos bancos lo miden, y hasta el 2026-11-25
// cada uno traía su propio parser. Dos respuestas a «¿a dónde va esta ruta?»
// es la discrepancia de siempre esperando: basta que uno aprenda a leer una
// regla que el otro no entiende para que los dos salgan verdes sobre
// comportamientos distintos.
//
// Esto implementa la parte de la especificación que las reglas del repositorio
// usan, y no finge soportar más: reglas en orden, primera que casa gana, `*`
// al final del origen captura el resto y se sustituye en `:splat`.

'use strict';

function reglasDe(texto) {
  return String(texto || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map((l, i) => {
      const campos = l.split(/\s+/);
      if (campos.length < 2) return { renglon: i + 1, malformada: l };
      const [origen, destino, estado] = campos;
      return { renglon: i + 1, origen, destino, estado: Number(estado || 301) };
    });
}

// `pedido` es la ruta tal y como viaja: con su percent-encoding intacto. No se
// decodifica aquí a propósito — medido contra Netlify el 2026-11-25: `%2E` lo
// normaliza y `%2F` NO, y la ruta de un objeto de Storage depende de que el
// `%2F` llegue entero.
function rutear(reglas, pedido) {
  for (const r of reglas) {
    if (r.malformada) continue;
    if (r.origen.endsWith('/*')) {
      const raizDeLaRegla = r.origen.slice(0, -1);
      if (pedido.startsWith(raizDeLaRegla))
        return { ...r, destinoFinal: r.destino.replace(':splat', pedido.slice(raizDeLaRegla.length)) };
    } else if (r.origen === pedido) {
      return { ...r, destinoFinal: r.destino };
    }
  }
  return null;
}

const hostDe = (url) => { try { return new URL(url).host; } catch { return ''; } };

module.exports = { reglasDe, rutear, hostDe };
