#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// UNA FECHA SE IMPRIME SI SE PUEDE LEER, NO SI EL CAMPO ESTÁ
// ════════════════════════════════════════════════════════════════════════════
//
// Cinco sitios de `src/App.jsx` imprimían una fecha guardada preguntando si el
// campo EXISTE. Ninguno preguntaba si se puede LEER. Son dos preguntas
// distintas, y de la diferencia salían dos cosas impresas:
//
//   «Invalid Date» — dos sitios (`catalogoGP.ultimaActualizacion` y
//       `a.leidaEn`) hacían `new Date(x).toLocaleDateString()` detrás de una
//       guarda de verdad. Cuando `x` no es una fecha, eso NO revienta ni
//       devuelve vacío: devuelve la cadena «Invalid Date», y la cadena sale
//       impresa. El lector ve dos palabras en inglés donde esperaba un día.
//
//   Diez letras cualesquiera — los otros tres (`nota.editadaEn` en dos
//       pantallas y `cierre.fechaCierre`) tenían de respaldo
//       `String(x).slice(0, 10)`. Es PEOR que «Invalid Date», y por una razón
//       que este banco afirma caso por caso: no se ve roto. Las diez letras de
//       `"2026-13-45"` son un mes 13 y un día 45 que se leen como fecha. Las
//       de un instante guardado ya formateado —`"5/11/2026, 8:01:04 a.m."`,
//       que es exactamente la avería documentada en `fechaHoraLegible`— son
//       `"5/11/2026,"`: una fecha con una coma de más. Nadie reporta eso.
//
// POR QUÉ ESTE BANCO EXISTE, Y NO LO EVITÓ UNA LECTURA DEL CÓDIGO. Las cinco
// frases se decidían DENTRO del JSX. De una expresión que vive en el render no
// se puede comprobar nada más que su símbolo, y ninguna de las cinco tenía
// símbolo. Llevaban años equivocándose porque no había dónde correrlas. Lo
// primero que hizo el arreglo fue sacarlas: `sufijoFechaCatalogo`,
// `fraseNotaEditada`, `sufijoFechaCierre` y `fraseAlertaLeida` son lo que la
// pantalla imprime, y este banco las EJECUTA.
//
// QUÉ SE AFIRMA, Y QUÉ NO. No se afirma que el formato de cada sitio sea uno
// u otro: cada uno imprime el suyo y así se quedó, porque cambiarlos sería un
// cambio visual que nadie pidió. Se afirma la DECISIÓN: con qué se puede
// imprimir, qué se dice cuando no, y que «no hay campo» y «el campo no se
// puede leer» no se digan igual. Lo segundo importa: un campo ausente es que
// nunca se escribió; uno ilegible es que alguien escribió algo mal, y eso
// tiene a quién preguntárselo.
//
// LO QUE NO ENTRÓ, Y POR QUÉ. El Kpi «Última captura» (`App.jsx`, `sub=`)
// parecía el sexto sitio: hace `new Date(fechaUltima).toLocaleDateString(…)`
// detrás de una guarda de verdad, que es la forma exacta del defecto. No lo
// es. `fechaUltimaCapturaDe` ya devuelve `null` si la fecha no se puede leer
// —lo hace en su último renglón, con `Number.isFinite`—, así que a ese
// `new Date` no le puede llegar basura. Se verificó antes de tocarlo en vez de
// arreglarlo de más: una guarda redundante habría dado la impresión de
// proteger algo que ya estaba protegido en otro lado.
//
// ESTADO EN PRODUCCIÓN (medido el 2026-11-06 con
// `scripts/medir-el-plazo-y-las-fechas-impresas.cjs`, que sólo lee):
// `global/gp_catalogo.ultimaActualizacion` se lee bien, 0 alertas con
// `leidaEn` ilegible, 0 notas con `editadaEn` ilegible. O sea que hoy no está
// saliendo impreso. Esto es un defecto LATENTE, y se arregla igual: lo dispara
// la primera escritura que entre por otra vía —una migración, una función, una
// corrección a mano— y el día que lo haga nadie va a saber distinguir
// «5/11/2026,» de una fecha.
//
// Uso:
//     node scripts/prueba-una-fecha-se-imprime-si-se-puede-leer.cjs
//     node scripts/prueba-una-fecha-se-imprime-si-se-puede-leer.cjs --contraprueba

'use strict';

const { ZONA } = require('./reloj.cjs');
const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');

noArranco.vigilarExcepciones(__filename);

const PEDIDOS = [
  'instanteGuardado',
  'sufijoFechaCatalogo', 'fraseNotaEditada', 'sufijoFechaCierre', 'fraseAlertaLeida',
  'fechaEnPalabras', 'MESES_CORTO',
];
const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan);

// Dos sitios formatean con `toLocaleDateString`/`toLocaleString`, y eso
// depende del huso del proceso y de los datos de ICU que traiga este Node. Si
// cualquiera de los dos no es el que este banco supone, sus comparaciones
// dejan de medir el arreglo y pasan a medir el intérprete. Eso no es rojo: es
// que el banco no puede arrancar.
const ZONA_VIVA = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (ZONA_VIVA !== ZONA) {
  noArranco.sinPrecondicion(
    `el proceso corre en ${ZONA_VIVA} y este banco compara fechas de ${ZONA}`,
    ['Debería fijarlo `scripts/reloj.cjs` al cargarse. Si llegaste aquí, no lo hizo.']);
}
const MUESTRA_FORMATO = new Date('2026-11-05T14:01:04.174Z').toLocaleDateString('es-MX');
if (MUESTRA_FORMATO !== '5/11/2026') {
  noArranco.sinPrecondicion(
    `\`toLocaleDateString('es-MX')\` da «${MUESTRA_FORMATO}» y este banco espera «5/11/2026»`,
    ['Este Node trae otros datos de ICU. Las comparaciones de formato de la §2',
     'no medirían el arreglo, medirían el intérprete.']);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// El instante con el que se compara todo. Son las 08:01 del 5 de noviembre en
// la zona de la obra, escrito como lo guarda la aplicación.
const ISO = '2026-11-05T14:01:04.174Z';

// Las seis formas en que un campo puede NO ser una fecha. Las cuatro primeras
// son las que de verdad pueden llegar a estar guardadas; las dos últimas son
// las dos que el `slice(0, 10)` disfrazaba de fecha, y van aparte porque de
// ésas se afirma algo más fuerte.
const ILEGIBLES = [
  ['un objeto de Firestore sin convertir', {}],
  ['una frase', 'hace un momento'],
  ['los milisegundos como texto', '1762387200000'],
];
const ILEGIBLES_DISFRAZADAS = [
  ['un instante ya formateado', '5/11/2026, 8:01:04 a.m.', '5/11/2026,'],
  ['una fecha imposible', '2026-13-45', '2026-13-45'],
];
const TODAS_ILEGIBLES = [...ILEGIBLES,
  ...ILEGIBLES_DISFRAZADAS.map(([q, v]) => [q, v])];

function correr(fuente) {
  const A = construir(fuente);
  const fallos = [];
  const check = (ok, que, detalle = '') => {
    if (ok) { if (!process.env.CALLADO) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!process.env.CALLADO) console.log(`  FALLA ${que}\n        ${detalle}`);
  };

  // ══ §1 · QUÉ SE PUEDE LEER Y QUÉ NO, DECIDIDO UNA VEZ ════════════════════
  if (!process.env.CALLADO) console.log('\n§1 · la decisión, en un solo sitio');

  const leido = A.instanteGuardado(ISO);
  check(leido instanceof Date && leido.getTime() === Date.parse(ISO),
    'un instante guardado como ISO se lee, y se lee al milisegundo',
    `dio ${leido}`);
  check(A.instanteGuardado(new Date(ISO))?.getTime() === Date.parse(ISO),
    'un Date que ya venía hecho se deja pasar tal cual');
  // Una fecha SIN hora es un día del calendario. Lo que se afirma es QUÉ DÍA
  // sale, no que salga lo mismo que `Date.parse` —que es justamente lo que no
  // puede salir: `Date.parse('2026-11-05')` es la medianoche UTC, o sea el 4
  // a las 18:00 en la zona de la obra, y el 4 es el día equivocado. Compararse
  // contra `Date.parse` sería comprobar la cuenta contra sí misma.
  const corta = A.instanteGuardado('2026-11-05');
  check(corta && corta.getFullYear() === 2026 && corta.getMonth() === 10
        && corta.getDate() === 5,
    'una fecha sin hora se lee como el día 5 en el calendario de la obra, no como el 4',
    `dio ${corta}`);

  for (const [que, valor] of TODAS_ILEGIBLES) {
    check(A.instanteGuardado(valor) === null,
      `${que} no se puede leer → null`,
      `dio ${JSON.stringify(A.instanteGuardado(valor))}`);
  }
  // El vacío va con los ausentes y no con los ilegibles: un campo con una
  // cadena vacía dentro es un campo que no se llenó, no uno que se llenó mal.
  for (const [que, valor] of [['null', null], ['undefined', undefined], ['vacío', '']]) {
    check(A.instanteGuardado(valor) === null, `${que} no se puede leer → null`);
  }
  // Un `Date` inválido es la trampa del `instanceof`: existe, es de la clase
  // correcta, y no vale nada.
  check(A.instanteGuardado(new Date('no soy fecha')) === null,
    'un Date inválido tampoco se puede leer, aunque sea un Date');

  // ══ §2 · LO QUE SE IMPRIME CUANDO LA FECHA SÍ SE LEE ═════════════════════
  if (!process.env.CALLADO) console.log('\n§2 · con fecha legible, el día que sale es el correcto');

  check(A.sufijoFechaCatalogo(ISO) === ' · al 5/11/2026',
    'el catálogo de GP dice el día en que se actualizó',
    `dijo «${A.sufijoFechaCatalogo(ISO)}»`);
  check(A.fraseNotaEditada(ISO) === 'editada el 5 de nov de 2026',
    'la nota dice el día en que se corrigió',
    `dijo «${A.fraseNotaEditada(ISO)}»`);
  check(A.sufijoFechaCierre(ISO) === ' · 5 de nov de 2026',
    'el cierre dice el día en que se cerró',
    `dijo «${A.sufijoFechaCierre(ISO)}»`);
  // `fechaCierre` se guarda como día suelto, y ése es el sitio donde el día
  // se puede adelantar en uno sin que nadie lo note.
  check(A.sufijoFechaCierre('2026-11-05') === ' · 5 de nov de 2026',
    '  y un cierre guardado sin hora sigue siendo el 5, no el 4',
    `dijo «${A.sufijoFechaCierre('2026-11-05')}»`);
  check(A.fraseNotaEditada('2026-11-05') === 'editada el 5 de nov de 2026',
    '  igual que la nota guardada sin hora',
    `dijo «${A.fraseNotaEditada('2026-11-05')}»`);

  // Ésta se afirma por partes y no contra una cadena entera a propósito: su
  // formato trae mes abreviado y hora, y eso lo escribe ICU. Lo que tiene que
  // salir bien es el DÍA y la HORA, no cómo los puntúe este Node.
  const leida = A.fraseAlertaLeida('Ana', ISO);
  check(/\bAna\b/.test(leida), 'la alerta leída nombra a quien la leyó',
    `dijo «${leida}»`);
  check(/05/.test(leida) && /nov/i.test(leida),
    '  y nombra el día 05 de noviembre', `dijo «${leida}»`);
  check(/08:01/.test(leida), '  y la hora de la obra, 08:01 —no las 14:01 de UTC—',
    `dijo «${leida}»`);
  check(A.fraseAlertaLeida(null, ISO).startsWith('Leída por —'),
    'si no se registró quién la leyó, se dice con una raya, no se inventa nombre');

  // ══ §3 · CON FECHA ILEGIBLE NO SE IMPRIME BASURA ═════════════════════════
  if (!process.env.CALLADO) console.log('\n§3 · con fecha ilegible: ni «Invalid Date» ni diez letras');

  const LAS_CUATRO = [
    ['el catálogo de GP', (v) => A.sufijoFechaCatalogo(v)],
    ['la nota editada', (v) => A.fraseNotaEditada(v)],
    ['el cierre de semana', (v) => A.sufijoFechaCierre(v)],
    ['la alerta leída', (v) => A.fraseAlertaLeida('Ana', v)],
  ];

  for (const [sitio, frase] of LAS_CUATRO) {
    for (const [que, valor] of TODAS_ILEGIBLES) {
      const salida = String(frase(valor) ?? '');
      check(!/Invalid Date/.test(salida),
        `${sitio} con ${que}: no imprime «Invalid Date»`, `dijo «${salida}»`);
    }
  }

  // Lo más fuerte de este banco: las dos cadenas que el `slice(0, 10)` dejaba
  // pasar por fecha no pueden aparecer en lo que se imprime. No basta con que
  // no diga «Invalid Date» —el respaldo viejo tampoco lo decía—.
  for (const [sitio, frase] of LAS_CUATRO) {
    for (const [que, valor, recorte] of ILEGIBLES_DISFRAZADAS) {
      const salida = String(frase(valor) ?? '');
      check(!salida.includes(recorte),
        `${sitio} con ${que}: no imprime «${recorte}», que se lee como fecha`,
        `dijo «${salida}»`);
    }
  }

  // ══ §4 · AUSENTE, ILEGIBLE Y LEGIBLE SON TRES ESTADOS DISTINTOS ══════════
  if (!process.env.CALLADO) console.log('\n§4 · tres estados, tres cosas distintas que decir');

  check(A.sufijoFechaCatalogo(null) === '',
    'sin campo, el catálogo no dice nada de fechas');
  check(A.sufijoFechaCierre(null) === '',
    'sin campo, el cierre no dice nada de fechas');
  check(A.fraseNotaEditada(null) === null,
    'sin campo, la nota no dice que la editaron: no la editaron');
  check(A.fraseAlertaLeida('Ana', null) === null,
    'sin campo, la alerta no dice que la leyeron');

  for (const [que, valor] of TODAS_ILEGIBLES) {
    check(A.sufijoFechaCatalogo(valor) !== A.sufijoFechaCatalogo(null),
      `el catálogo con ${que} NO dice lo mismo que sin campo`,
      'un campo ilegible es alguien que escribió mal, y eso se reclama');
    check(A.sufijoFechaCierre(valor) !== A.sufijoFechaCierre(null),
      `el cierre con ${que} NO dice lo mismo que sin campo`);
  }

  // Que la nota se TOCÓ después de escrita es lo único que hace visible una
  // corrección, y por eso se dice aunque su fecha no se pueda leer. Lo mismo
  // con el nombre de quien leyó una alerta: el nombre es el dato con el que se
  // le pregunta a alguien. Callarse sería perder el hecho por culpa del día.
  for (const [que, valor] of TODAS_ILEGIBLES) {
    const f = A.fraseNotaEditada(valor);
    check(typeof f === 'string' && /editada/.test(f),
      `con ${que}, la nota sigue diciendo que la editaron`, `dijo «${f}»`);
    const g = A.fraseAlertaLeida('Ana', valor);
    check(typeof g === 'string' && /\bAna\b/.test(g),
      `con ${que}, la alerta sigue nombrando a Ana`, `dijo «${g}»`);
  }

  // ══ §5 · EL MISMO CAMPO SE IMPRIME IGUAL EN LOS DOS SITIOS ═══════════════
  if (!process.env.CALLADO) console.log('\n§5 · `editadaEn` sale igual en la tarjeta y en el panel');

  // Antes NO salía igual, y no sólo cuando fallaba: con una fecha perfecta la
  // tarjeta decía «5 de nov de 2026» y el panel «2026-11-05», porque eran dos
  // expresiones distintas sobre el mismo campo. Ahora hay una sola frase, así
  // que esto es cierto por construcción — y se afirma justamente para que
  // volver a escribir la segunda expresión salga en rojo.
  for (const valor of [ISO, '2026-11-05', ...TODAS_ILEGIBLES.map(([, v]) => v)]) {
    const f = A.fraseNotaEditada(valor);
    check(f === A.fraseNotaEditada(valor),
      `«${String(JSON.stringify(valor)).slice(0, 26)}» da una sola frase: «${f}»`);
  }
  check(!/\d{4}-\d{2}-\d{2}/.test(String(A.fraseNotaEditada(ISO))),
    'y esa frase no es la fecha cruda recortada: es el día en palabras',
    `dijo «${A.fraseNotaEditada(ISO)}»`);

  return fallos;
}

// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Cada una de éstas es una de las cinco formas en que esto estaba escrito
// antes, o una manera plausible de volver a escribirlo. Si alguna sobrevive,
// las aserciones de arriba están de adorno.
const MUTACIONES = [
  ['la lectura vuelve a aceptar cualquier cosa, y con ella vuelve «Invalid Date»',
    '  return Number.isFinite(t) ? new Date(t) : null;',
    '  return new Date(t);'],
  ['el catálogo vuelve a imprimir sin preguntar si se puede leer',
    `  const d = instanteGuardado(ultimaActualizacion);
  return d ? \` · al \${d.toLocaleDateString('es-MX')}\`
           : ' · con fecha de catálogo ilegible';`,
    '  return ` · al ${new Date(ultimaActualizacion).toLocaleDateString(\'es-MX\')}`;'],
  ['la nota vuelve al respaldo de diez letras',
    `  return d ? \`editada el \${fechaEnPalabras(d)}\` : 'editada (sin fecha legible)';`,
    '  return `editada el ${fechaEnPalabras(d) || String(editadaEn).slice(0, 10)}`;'],
  ['el cierre vuelve al respaldo de diez letras',
    `  return d ? \` · \${fechaEnPalabras(d)}\` : ' · con fecha de cierre ilegible';`,
    '  return ` · ${fechaEnPalabras(d) || String(fechaCierre).slice(0, 10)}`;'],
  ['la nota se calla cuando no puede leer la fecha, y se pierde que la editaron',
    `  return d ? \`editada el \${fechaEnPalabras(d)}\` : 'editada (sin fecha legible)';`,
    '  return d ? `editada el ${fechaEnPalabras(d)}` : null;'],
  ['la alerta se calla cuando no puede leer la fecha, y se pierde quién la leyó',
    `    : \`\${quien} (sin fecha legible)\`;`,
    '    : null;'],
  ['la alerta vuelve a imprimir sin preguntar si se puede leer',
    '  const d = instanteGuardado(leidaEn);',
    '  const d = new Date(leidaEn);'],
  ['«no hay campo» y «no se puede leer» se dicen igual otra vez',
    `  if (!ultimaActualizacion) return '';
  const d = instanteGuardado(ultimaActualizacion);
  return d ? \` · al \${d.toLocaleDateString('es-MX')}\`
           : ' · con fecha de catálogo ilegible';`,
    `  const d = instanteGuardado(ultimaActualizacion);
  return d ? \` · al \${d.toLocaleDateString('es-MX')}\` : '';`],
  ['el cierre confunde los dos estados por el otro lado: ilegible pasa a vacío',
    `  return d ? \` · \${fechaEnPalabras(d)}\` : ' · con fecha de cierre ilegible';`,
    "  return d ? ` · ${fechaEnPalabras(d)}` : '';"],
  ['una fecha sin hora vuelve a leerse como medianoche UTC: el día se adelanta uno',
    "  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(v)) return fechaLocalDeISO(v);",
    ''],
  ['la hora de la alerta se imprime en UTC y no en la zona de la obra',
    `d.toLocaleString('es-MX', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})`,
    `d.toLocaleString('es-MX', {timeZone:'UTC',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!cuerpo.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 90)}`);
      process.exit(2);
    }
    let fallos;
    process.env.CALLADO = '1';
    try { fallos = correr(cuerpo.replace(de, a)); }
    catch (e) {
      // Reventar NO es salir en rojo: mide que el taller sabe parsear, no que
      // la aserción muerda. Contarlo como ROJO deja pasar mutaciones que en
      // realidad nadie detecta, así que es NO ARRANCÓ, que es un 2.
      console.error(`NO ARRANCÓ: la mutación «${titulo}» revienta el trozo ` +
                    `en vez de romper la semántica: ${e.message}`);
      process.exit(2);
    }
    delete process.env.CALLADO;
    if (fallos.length) {
      console.log(`   ✓ ROJO  ${titulo}  ·  ${fallos.length} aserción(es) mordieron`);
      console.log(`           la primera: ${fallos[0]}`);
    } else {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó`);
      sobrevivieron++;
    }
  }
  if (sobrevivieron) {
    console.error(`\nROJO: ${sobrevivieron} mutación(es) sobrevivieron. Las aserciones no muerden.`);
    process.exit(1);
  }
  console.log(`\nverde: las ${MUTACIONES.length} mutaciones salieron en rojo.`);
  process.exit(0);
}

console.log('UNA FECHA SE IMPRIME SI SE PUEDE LEER');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
