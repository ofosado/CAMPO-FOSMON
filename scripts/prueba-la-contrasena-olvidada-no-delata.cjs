#!/usr/bin/env node
// LA CONTRASEÑA OLVIDADA NO DICE QUIÉN TIENE CUENTA
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El #24. Hasta el 2026-11-24 la recuperación de contraseña **no existía**:
// medido, ni una línea en el front ni en las funciones. Una contraseña
// olvidada se resolvía pidiéndosela a Oscar, o sea que fuera de horario nadie
// entra.
//
// ── QUÉ AFIRMA, Y POR QUÉ ES ESTO Y NO «SALE UN CORREO» ─────────────────────
// Que salga el correo lo hace Firebase y no hay nada nuestro que medir ahí.
// Lo nuestro —y lo que se rompe callado— es QUÉ SE LE CONTESTA AL USUARIO.
//
// `sendPasswordResetEmail` lanza `auth/user-not-found` cuando la dirección no
// tiene cuenta. Enseñar esa negativa convierte la pantalla de entrar en un
// comprobador de correos: cualquiera, sin credenciales, averigua quién tiene
// cuenta probando direcciones. En un padrón de 18 personas eso es la lista
// del personal, y en una obra de gobierno es información que no es nuestra.
//
// Así que la negativa se contesta EXACTAMENTE igual que el éxito. Eso es lo
// que este banco afirma, ejecutando la función real contra cada código.
//
// El otro lado, que es el que se olvida: un código DESCONOCIDO no se puede
// contestar con el texto tranquilizador. Eso dejaría a alguien esperando un
// correo que nunca se mandó, y esperar sin saberlo es peor que un error.
//
// Uso:
//   node scripts/prueba-la-contrasena-olvidada-no-delata.cjs
//   node scripts/prueba-la-contrasena-olvidada-no-delata.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const ARCHIVO_APP = process.env.ARCHIVO_APP || path.join(raiz, 'src/App.jsx');
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'la pantalla vuelve a delatar que la cuenta no existe',
    de: `    case "auth/user-not-found":\n      return { tono: "ok", texto:`,
    a:  `    case "auth/user-not-found":\n      return { tono: "error", texto: "Esa cuenta no existe." };\n    case "__nunca__":\n      return { tono: "ok", texto:` },
  { nombre: 'un fallo desconocido se contesta como si el correo hubiera salido',
    de: `      return { tono: "error", texto:\n        \`No se pudo mandar el correo (\${codigo}). Avísale a soporte con ese código.\` };`,
    a:  `      return { tono: "ok", texto: "Va en camino un correo." };` },
  { nombre: 'el éxito deja de decir «si esa dirección tiene cuenta» y afirma que existe',
    de: `        "Si esa dirección tiene cuenta, va en camino un correo con el enlace " +`,
    a:  `        "Va en camino un correo a tu cuenta con el enlace " +` },
  // NO está la mutación «se va el corte del correo vacío». Se midió: quitarlo
  // no cambia nada de lo que el usuario ve, porque Firebase devuelve
  // `auth/missing-email` por su cuenta y el mensaje acaba siendo el mismo. El
  // corte ahorra un viaje a la red, no una conducta, y una contraprueba que
  // sale verde enseña a no creerle a las que sí muerden.
  { nombre: 'el botón vuelve a enviar el formulario: pedir contraseña intenta entrar',
    de: `          <button type="button" onClick={pedirNuevaContrasena} disabled={recuperando}`,
    a:  `          <button onClick={pedirNuevaContrasena} disabled={recuperando}` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCHIVO_APP, 'utf8'),
    { archivo: ARCHIVO_APP, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCHIVO_APP, 'utf8'),
    archivo: ARCHIVO_APP, extension: '.jsx' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

const { deArchivo } = require('./extraer-de-app.cjs');
const { respuestaDeRecuperacion } = deArchivo(ARCHIVO_APP, 'respuestaDeRecuperacion');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

(async () => {
  console.log('\n── LA CONTRASEÑA OLVIDADA ──\n');

  // ═══ §1 · LA CUENTA QUE NO EXISTE SE CONTESTA COMO LA QUE SÍ ══════════════
  console.log('§1 · lo que distingue un formulario de un padrón público');
  const exito = respuestaDeRecuperacion(null);
  const noExiste = respuestaDeRecuperacion('auth/user-not-found');

  check(JSON.stringify(exito) === JSON.stringify(noExiste),
    'la cuenta inexistente recibe EXACTAMENTE la misma respuesta que la que sí existe',
    JSON.stringify(exito) === JSON.stringify(noExiste) ? 'idénticas'
      : `ok: ${exito.texto.slice(0, 50)}… · no-existe: ${noExiste.texto.slice(0, 50)}…`);

  check(exito.tono === 'ok' && noExiste.tono === 'ok',
    'y las dos con el mismo tono: un rojo contra un verde delata igual que el texto',
    `${exito.tono} / ${noExiste.tono}`);

  check(/si esa dirección tiene cuenta/i.test(exito.texto),
    'el texto es CONDICIONAL —«si esa dirección tiene cuenta»— y por eso puede ser cierto en los dos casos',
    exito.texto);

  check(!/no existe|no está registrad|no encontr|sin cuenta/i.test(noExiste.texto),
    'y en ninguna parte dice que la cuenta no exista',
    noExiste.texto);

  // ═══ §2 · LO QUE SÍ SE PUEDE DECIR ════════════════════════════════════════
  //
  // Un correo mal escrito o un servicio caído hablan de lo que el usuario
  // tecleó o del estado de la red, no de quién tiene cuenta. Callarlos sería
  // dejar a alguien esperando sin motivo.
  console.log('\n§2 · lo que sí se puede decir sin delatar a nadie');
  for (const [codigo, debeDecir] of [
    ['auth/invalid-email',           /forma de correo/i],
    ['auth/missing-email',           /escribe tu correo/i],
    ['auth/too-many-requests',       /demasiados intentos/i],
    ['auth/network-request-failed',  /conexión/i],
  ]) {
    const r = respuestaDeRecuperacion(codigo);
    check(r.tono === 'error' && debeDecir.test(r.texto),
      `\`${codigo}\` se dice, y se dice en claro`, `${r.tono} · ${r.texto}`);
  }

  // ═══ §3 · EL CÓDIGO QUE NO CONOCEMOS NO SE DISFRAZA DE ÉXITO ══════════════
  console.log('\n§3 · un fallo que no sabemos nombrar');
  const raro = respuestaDeRecuperacion('auth/algo-que-no-existia-ayer');
  check(raro.tono === 'error',
    'no se contesta en verde: esperar un correo que nunca salió es peor que un error',
    `${raro.tono} · ${raro.texto}`);
  check(/algo-que-no-existia-ayer/.test(raro.texto),
    'y el código viaja en el mensaje, que es lo único que sirve para reportarlo',
    raro.texto);
  check(JSON.stringify(raro) !== JSON.stringify(exito),
    'y no se parece al éxito ni por accidente',
    'distintas');

  // ═══ §4 · EL VACÍO Y LA FORMA ═════════════════════════════════════════════
  console.log('\n§4 · los bordes');
  const vacios = [undefined, null, ''];
  check(vacios.every(c => respuestaDeRecuperacion(c).tono === 'ok'),
    'los tres «sin código» son el camino del éxito: así lo llama el componente al salir bien',
    vacios.map(c => respuestaDeRecuperacion(c).tono).join(', '));
  check(['tono', 'texto'].every(k => k in exito) &&
        typeof exito.texto === 'string' && exito.texto.length > 20,
    'siempre devuelve algo que la pantalla puede pintar: nunca undefined ni una cadena vacía',
    `${Object.keys(exito).join('+')} · ${exito.texto.length} caracteres`);

  // ═══ §5 · EL BOTÓN SE PINTA Y SE MIRA ════════════════════════════════════
  //
  // Dentro de un `<form>`, un `<button>` SIN `type` envía el formulario. O
  // sea que «¿Olvidaste tu contraseña?» intentaría entrar con la contraseña
  // que justamente no recuerdas: el formulario se va, sale «credenciales
  // incorrectas», y el correo no se pide nunca. Se ve igual que un fallo de
  // contraseña, que es lo que lo hace malo.
  //
  // Esto no se puede afirmar leyendo el archivo —«dice type="button"» es una
  // cadena, no una conducta—, así que el botón se EXTRAE por AST y se PINTA
  // con React, y se mira el atributo que quedó en el HTML.
  console.log('\n§5 · el botón, pintado de verdad');
  {
    const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
    const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
    const React = require(path.join(raiz, 'node_modules/react'));
    const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));
    const esbuild = require(path.join(raiz, 'node_modules/esbuild'));

    const src = fs.readFileSync(ARCHIVO_APP, 'utf8');
    let fuente = null;
    traverse(parse(src, { sourceType: 'module', plugins: ['jsx'] }), {
      JSXElement(p) {
        const abre = p.node.openingElement;
        if (abre.name?.name !== 'button') return;
        const tieneNuestroClick = abre.attributes.some(a =>
          a.type === 'JSXAttribute' && a.name?.name === 'onClick' &&
          /pedirNuevaContrasena/.test(src.slice(a.start, a.end)));
        if (tieneNuestroClick) fuente = src.slice(p.node.start, p.node.end);
      },
    });
    if (!fuente) noArranco(['no se halló el botón cuyo `onClick` llama a ' +
      '`pedirNuevaContrasena`: es el anclaje de esta sección'],
      path.basename(ARCHIVO_APP));

    const PALETA = new Proxy({}, { get: () => '#808080' });
    const entorno = { React, C: PALETA, pedirNuevaContrasena: () => {}, recuperando: false };
    const nombres = Object.keys(entorno);
    let html;
    try {
      const compilado = esbuild.transformSync(`(${fuente})`, { loader: 'jsx' }).code;
      const el = new Function(...nombres, `return ${compilado}`)(...nombres.map(n => entorno[n]));
      html = renderToStaticMarkup(el);
    } catch (e) {
      noArranco([`el botón no se pudo pintar: ${e.message}`], path.basename(ARCHIVO_APP));
    }

    check(/type="button"/.test(html),
      'lleva `type="button"`: dentro de un <form>, un botón sin tipo ENVÍA el formulario',
      /type="button"/.test(html) ? 'type="button"'
        : `sin type — el HTML es: ${html.slice(0, 120)}`);
    check(/Olvidaste tu contrase/i.test(html),
      'y dice lo que hace, con las palabras que alguien bloqueado va a buscar',
      (html.match(/>([^<]{5,60})</) || [])[1] || html.slice(0, 80));
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'la pantalla de entrar no se puede usar para averiguar quién tiene\n' +
      'cuenta, y un fallo que no sabemos nombrar no se disfraza de correo\n' +
      'en camino.'
    : 'una pantalla que contesta distinto según si la cuenta existe es un\n' +
      'padrón público con forma de formulario.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
