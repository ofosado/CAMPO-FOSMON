#!/usr/bin/env node
// ¿Puede la sonda de cámara decir «sirve» cuando no sirve?
//
// La sonda existe para una decisión: si `getUserMedia` funciona dentro de la
// app instalada en iOS, la captura en sitio se hace por API; si no, la Parte 1
// se queda con la hoja del sistema. O sea que un veredicto equivocado no
// cuesta un renglón mal pintado: cuesta construir la parte 1 dos veces.
//
// El modo de fallo que hay que no dejar pasar es éste: en modo standalone,
// Safari ha resuelto `getUserMedia` SIN ERROR y entregado un video negro. El
// código que pregunta «¿hubo excepción?» contesta que todo bien. Por eso la
// afirmación de este banco no es que exista una función, es que NINGUNA
// combinación de hechos sin imagen puede salir en verde.
//
// Las cuentas se EXTRAEN de `public/api/sonda/veredicto.js` y se EJECUTAN. No
// hay una copia de la lógica aquí: un banco que copia el código se comprueba
// contra sí mismo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const noArranco = require('./no-arranco.cjs');
const { vigilarExcepciones, sinPrecondicion } = require('./no-arranco.cjs');

vigilarExcepciones('la sonda de cámara');

const RAIZ = path.join(__dirname, '..');
const ARCHIVO_CUENTAS = path.join(RAIZ, 'public/api/sonda/veredicto.js');
const ARCHIVO_PAGINA = path.join(RAIZ, 'public/api/sonda/index.html');

for (const f of [ARCHIVO_CUENTAS, ARCHIVO_PAGINA]) {
  try { fs.accessSync(f); }
  catch {
    sinPrecondicion(`no está ${path.relative(RAIZ, f)}`,
      'Si la sonda se retiró del repo, borrar este banco con ella.');
  }
}

// ── La extracción ──────────────────────────────────────────────────────────
//
// El archivo se escribió para el navegador: se cuelga de `window`. Se le da un
// `window` de mentiras y se ejecuta tal cual, sin tocarle una letra.
const ventana = {};
vm.runInNewContext(fs.readFileSync(ARCHIVO_CUENTAS, 'utf8'), { window: ventana });

if (!ventana.SONDA || typeof ventana.SONDA.veredicto !== 'function' ||
    typeof ventana.SONDA.analizarMarco !== 'function')
  noArranco(['SONDA.veredicto', 'SONDA.analizarMarco'], 'public/api/sonda/veredicto.js');

const { analizarMarco, veredicto } = ventana.SONDA;

// La página tiene que estar usando ESTAS cuentas. Si dejó de cargarlas, lo que
// este banco mide es un archivo huérfano y el usuario ve otra cosa: no es un
// rojo, es que no se pudo mirar.
const pagina = fs.readFileSync(ARCHIVO_PAGINA, 'utf8');
if (!/src="\/api\/sonda\/veredicto\.js"/.test(pagina) ||
    !/SONDA\.veredicto\(/.test(pagina) ||
    !/SONDA\.analizarMarco\(/.test(pagina))
  sinPrecondicion(
    'la página de la sonda ya no sale a buscar las cuentas de `veredicto.js`',
    ['Si la lógica se movió adentro del HTML, hay dos cuentas para un mismo',
     'número y este banco mide la que nadie ve. Apuntarlo al lugar nuevo.']);

// ── Andamiaje ──────────────────────────────────────────────────────────────
let fallas = 0, oks = 0;
const ok = (q, d) => { oks++; console.log(` ok   ${q}${d ? `  ·  ${d}` : ''}`); };
const falla = (q, esperado, obtenido) => {
  fallas++;
  console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esperado}`);
  console.log(`        obtuvo:   ${obtenido}`);
};
const igual = (q, obtenido, esperado) => obtenido === esperado
  ? ok(q, String(obtenido))
  : falla(q, esperado, obtenido);

const muestras = (...valores) => {
  const m = [];
  for (let i = 0; i < 3072; i++) m.push(valores[i % valores.length]);
  return m;
};

// Un estado que sí debería salir en verde, para mutarlo en cada caso.
const BUENO = () => ({
  seguro: true,
  standalone: true,
  api: true,
  permiso: 'ok',
  pista: { estado: 'live', ancho: 1920, alto: 1080, cara: 'environment', etiqueta: 'trasera' },
  marco: analizarMarco(muestras(12, 90, 180, 240)),
  foto: { ancho: 1920, alto: 1080, bytes: 412000 },
  archivo: null,
  regreso: 'viva',
});

// ── 1. El cuadro: lo que separa «hay cámara» de «no hubo error» ────────────
console.log('\n── Leer el cuadro de video ──');
{
  const negro = analizarMarco(muestras(0));
  igual('un cuadro todo en cero no tiene imagen', negro.sinImagen, true);
  igual('y además se dice negro', negro.negro, true);

  const gris = analizarMarco(muestras(128));
  igual('un cuadro de un solo tono tampoco tiene imagen', gris.sinImagen, true);
  igual('pero no es negro, y no se le dice negro', gris.negro, false);

  const casi = analizarMarco(muestras(100, 101));
  igual('un rango de 1 sigue siendo sin imagen', casi.sinImagen, true);

  const real = analizarMarco(muestras(12, 90, 180, 240));
  igual('un cuadro con contraste sí tiene imagen', real.sinImagen, false);
  igual('y reporta el rango medido', real.rango, 228);

  // El muestreo de luminancia devuelve flotantes, y sin redondear el reporte
  // decía `rango=48.000000000000014`. Lo que se lee en un aeropuerto tiene que
  // ser leíble.
  const flotante = analizarMarco(muestras(10.0000001, 51.0000002));
  igual('el rango se reporta redondeado', flotante.rango, 41);
  igual('y el máximo también', flotante.max, 51);

  const vacio = analizarMarco([]);
  igual('sin un solo pixel leído: vacío', vacio.vacio, true);
  igual('y sin imagen, no «todavía no se sabe»', vacio.sinImagen, true);
}

// ── 2. El veredicto, caso por caso ─────────────────────────────────────────
console.log('\n── El veredicto ──');
{
  igual('todo medido y todo bien', veredicto(BUENO()).clase, 'VIABLE');

  const sinHttps = BUENO(); sinHttps.seguro = false;
  igual('sin contexto seguro', veredicto(sinHttps).clase, 'NO VIABLE');

  const sinApi = BUENO(); sinApi.api = false;
  igual('sin `getUserMedia` en el navegador', veredicto(sinApi).clase, 'NO VIABLE');

  const apiSinMirar = BUENO(); apiSinMirar.api = null;
  igual('sin haber mirado si existe la API', veredicto(apiSinMirar).clase, 'INCOMPLETA');

  const negado = BUENO(); negado.permiso = 'NotAllowedError';
  igual('con el permiso negado', veredicto(negado).clase, 'NO VIABLE');

  const sinPedir = BUENO(); sinPedir.permiso = null;
  igual('sin haber pedido la cámara', veredicto(sinPedir).clase, 'INCOMPLETA');

  const sinMedirCuadro = BUENO(); sinMedirCuadro.marco = null;
  igual('con la cámara abierta y el cuadro sin medir', veredicto(sinMedirCuadro).clase, 'INCOMPLETA');

  // EL caso.
  const negro = BUENO(); negro.marco = analizarMarco(muestras(0));
  const vNegro = veredicto(negro);
  igual('cámara abierta SIN ERROR y video negro', vNegro.clase, 'NO VIABLE');
  if (/no avisa/.test(vNegro.titulo)) ok('y lo nombra como el fallo que no avisa');
  else falla('explica por qué duele ese caso', 'el texto «no avisa»', vNegro.titulo);

  const fotaFalsa = BUENO(); fotaFalsa.foto = { ancho: 1920, alto: 1080, bytes: 900 };
  igual('un JPEG de 900 bytes a 1920 de ancho', veredicto(fotaFalsa).clase, 'NO VIABLE');

  const sinFoto = BUENO(); sinFoto.foto = null;
  igual('se vio imagen pero no se guardó foto', veredicto(sinFoto).clase, 'INCOMPLETA');

  const enSafari = BUENO(); enSafari.standalone = false;
  igual('todo bien, pero en el navegador y no en la app instalada',
    veredicto(enSafari).clase, 'INCOMPLETA');

  const muerta = BUENO(); muerta.regreso = 'muerta';
  igual('la pista se muere al volver de segundo plano', veredicto(muerta).clase, 'CONDICIONADA');

  const sinVolver = BUENO(); sinVolver.regreso = null;
  igual('falta el paso de salir y volver', veredicto(sinVolver).clase, 'INCOMPLETA');

  igual('un estado recién abierto, sin nada medido', veredicto({}).clase, 'INCOMPLETA');
  igual('y `undefined` tampoco revienta', veredicto().clase, 'INCOMPLETA');
}

// ── 3. La invariante, sobre todas las combinaciones ────────────────────────
//
// Los casos de arriba se eligieron a mano, y lo que se elige a mano se elige
// con los ojos del que escribió el código. Esto recorre el producto completo:
// ninguna combinación de hechos puede salir en verde si el video no entregó
// imagen, y ninguna puede salir en verde fuera de la app instalada.
console.log('\n── Ninguna combinación puede mentir ──');
{
  const VERDES = ['VIABLE', 'CONDICIONADA'];
  const opciones = {
    seguro: [true],
    standalone: [true, false, null],
    api: [true],
    permiso: ['ok'],
    marco: [analizarMarco(muestras(0)), analizarMarco(muestras(128)), analizarMarco([])],
    foto: [null, { ancho: 1920, alto: 1080, bytes: 412000 }],
    regreso: ['viva', 'muerta', null],
  };
  const claves = Object.keys(opciones);
  let combos = 0, colados = [];
  const recorrer = (i, acc) => {
    if (i === claves.length) {
      combos++;
      const v = veredicto(acc);
      if (VERDES.includes(v.clase)) colados.push(JSON.stringify({
        standalone: acc.standalone, rango: acc.marco.rango, foto: !!acc.foto, regreso: acc.regreso,
      }) + ' → ' + v.clase);
      return;
    }
    for (const val of opciones[claves[i]])
      recorrer(i + 1, Object.assign({}, acc, { [claves[i]]: val }));
  };
  recorrer(0, {});
  if (colados.length)
    falla('sin imagen en el video, nada sale en verde',
      `0 de ${combos} combinaciones en verde`, `${colados.length} coladas: ${colados[0]}`);
  else
    ok('sin imagen en el video, nada sale en verde', `${combos} combinaciones`);

  // La otra mitad: con imagen de verdad, el único camino a VIABLE pasa por la
  // app instalada.
  let combos2 = 0, coladas2 = [];
  const conImagen = analizarMarco(muestras(12, 90, 180, 240));
  for (const standalone of [false, null]) {
    for (const regreso of ['viva', 'muerta', null]) {
      for (const foto of [null, { ancho: 1920, alto: 1080, bytes: 412000 }]) {
        combos2++;
        const v = veredicto({ seguro: true, standalone, api: true, permiso: 'ok', marco: conImagen, foto, regreso });
        if (VERDES.includes(v.clase))
          coladas2.push(`standalone=${standalone} regreso=${regreso} → ${v.clase}`);
      }
    }
  }
  if (coladas2.length)
    falla('fuera de la app instalada no se concluye nada',
      `0 de ${combos2} en verde`, coladas2.join(' · '));
  else
    ok('fuera de la app instalada no se concluye nada', `${combos2} combinaciones`);
}

console.log('');
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
if (fallas > 0) {
  console.log('');
  console.log('Si esto está rojo, la sonda puede decirle «sirve» a una cámara que');
  console.log('entregó un rectángulo negro, y la Parte 1 se construiría dos veces.');
}
process.exit(fallas > 0 ? 1 : 0);
