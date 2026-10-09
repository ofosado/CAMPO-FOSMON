// ── LAS CUENTAS DE LA SONDA ────────────────────────────────────────────────
//
// Viven aparte de la página que las muestra por un motivo: el banco
// `scripts/prueba-sonda-veredicto.cjs` carga ESTE archivo y EJECUTA estas
// funciones. Si la lógica estuviera pegada dentro del HTML, la prueba tendría
// que copiarla, y una prueba que copia el código se comprueba contra sí misma.
//
// Lo que hay que no equivocar: en iOS, `getUserMedia` puede resolver sin error
// y entregar un video completamente negro. Eso pasó en varias versiones de
// Safari en modo standalone y es el modo de fallo que importa, porque no avisa:
// el código cree que tiene cámara, el usuario ve un rectángulo vacío y la foto
// que se sube es un JPEG de nada. Por eso aquí NO existe el camino «no hubo
// excepción, entonces funciona». La única prueba de que hay cámara es que
// lleguen pixeles distintos entre sí.

(function (raiz) {
  'use strict';

  // Un marco uniforme no es una foto. `muestras` son luminancias 0-255 leídas
  // del cuadro de video; si el rango entre la más clara y la más oscura es
  // ridículo, la cámara no entregó imagen —ni siquiera la de una pared blanca,
  // que trae ruido de sensor de sobra para pasar de 2.
  function analizarMarco(muestras) {
    if (!muestras || !muestras.length)
      return { vacio: true, sinImagen: true, motivo: 'no se pudo leer ni un pixel del video' };
    let min = 255, max = 0, suma = 0;
    for (var i = 0; i < muestras.length; i++) {
      var l = muestras[i];
      if (l < min) min = l;
      if (l > max) max = l;
      suma += l;
    }
    var prom = Math.round((suma / muestras.length) * 10) / 10;
    // Redondeado a propósito: sin esto el reporte dice `rango=48.000000000000014`
    // y lo que se lee en un aeropuerto tiene que ser leíble.
    var rango = Math.round((max - min) * 10) / 10;
    return {
      vacio: false,
      min: Math.round(min * 10) / 10, max: Math.round(max * 10) / 10,
      prom: prom, rango: rango,
      negro: prom < 4,
      sinImagen: rango < 2,
      motivo: rango < 2
        ? (prom < 4 ? 'el video llegó negro' : 'el video llegó de un solo tono')
        : null,
    };
  }

  // Traduce lo medido a una de cuatro clases. `INCOMPLETA` es tan importante
  // como las otras: decir «viable» con la mitad de los pasos sin correr sería
  // inventar el resultado.
  //
  //   VIABLE        la cámara en la app instalada sirve para capturar en sitio
  //   CONDICIONADA  sirve, pero se muere al volver de segundo plano
  //   NO VIABLE     no sirve; la Parte 1 se queda con la hoja del sistema
  //   INCOMPLETA    no alcanza para concluir
  function veredicto(e) {
    e = e || {};
    var r = [];
    var cierra = function (clase, titulo) {
      return { clase: clase, titulo: titulo, renglones: r };
    };

    if (e.seguro === false)
      return cierra('NO VIABLE', 'La página no está en contexto seguro: sin HTTPS no hay cámara, y eso no dice nada del teléfono.');

    if (e.api === false)
      return cierra('NO VIABLE', 'Este navegador no expone `getUserMedia`: la cámara por API no existe aquí.');

    if (e.api == null)
      return cierra('INCOMPLETA', 'Todavía no se miró si existe `getUserMedia`.');

    if (e.permiso && e.permiso !== 'ok')
      return cierra('NO VIABLE', 'La cámara no abrió: ' + e.permiso + '.');

    if (e.permiso !== 'ok')
      return cierra('INCOMPLETA', 'Falta apretar «Abrir la cámara».');

    if (!e.marco)
      return cierra('INCOMPLETA', 'La cámara abrió, pero todavía no se midió el cuadro.');

    // EL caso. Sin excepción y sin imagen.
    if (e.marco.sinImagen)
      return cierra('NO VIABLE',
        'La cámara abrió SIN ERROR y no entregó imagen (' +
        (e.marco.motivo || 'cuadro uniforme') + '). Esto es el fallo que no avisa.');

    if (!e.foto)
      return cierra('INCOMPLETA', 'Se vio imagen, pero no se alcanzó a guardar la foto.');

    // Un JPEG de 800 bytes a 1080 de ancho es un cuadro vacío comprimido.
    if (!(e.foto.bytes > 2000))
      return cierra('NO VIABLE',
        'La foto salió de ' + e.foto.bytes + ' bytes: eso no es una fotografía.');

    // Hasta aquí la cámara sirve. Ahora: ¿sirve en la app INSTALADA? Si no
    // está en standalone, lo medido es Safari, y Safari no es el destino.
    if (e.standalone !== true)
      return cierra('INCOMPLETA',
        'La cámara sirve en el navegador, pero esto no se midió en la app instalada. ' +
        'Falta agregarla a la pantalla de inicio y abrirla desde ahí.');

    if (e.regreso === 'muerta')
      return cierra('CONDICIONADA',
        'La cámara sirve, pero al volver de segundo plano la pista queda muerta: ' +
        'habría que reabrirla cada vez que el usuario sale de la app.');

    if (e.regreso !== 'viva')
      return cierra('INCOMPLETA',
        'La cámara sirve en la app instalada. Falta el paso 3: salir, volver y ' +
        'comprobar si sigue viva.');

    return cierra('VIABLE',
      'La cámara sirve en la app instalada y sobrevive a salir y volver. ' +
      'La captura en sitio por API es viable.');
  }

  raiz.SONDA = { analizarMarco: analizarMarco, veredicto: veredicto };
})(typeof window !== 'undefined' ? window : this);
