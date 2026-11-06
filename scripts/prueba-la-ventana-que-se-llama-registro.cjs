#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// UNA VENTANA NO ES EL REGISTRO — PENDIENTES #29 / #3
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ AFIRMA LA PANTALLA. La bitácora no presenta filas: contesta preguntas.
// «¿Quién tocó esta obra?», «¿hubo movimientos en junio?». Y la respuesta que
// daba a lo segundo era «Ningún registro coincide con los filtros», que en
// castellano quiere decir «no pasó nada». Eso es una afirmación sobre hechos
// que no había leído.
//
// EL HECHO MEDIDO, que es de dónde sale todo esto. Producción, 2026-11-05, con
// `scripts/medir-la-ventana-de-la-bitacora.cjs`: 4,603 filas de auditoría, de
// 2026-05-23 a hoy. La ventana por omisión —200 filas— cubre SEIS DÍAS. La más
// grande del desplegable —1000— cubre 41 días y deja 3,603 filas sin leer.
// Sobre eso había dos campos de fecha.
//
// LAS CUATRO MANERAS DE MENTIR QUE ESTE BANCO EXISTE PARA IMPEDIR:
//
//   1. CONTESTAR «NO HAY» SOBRE LO QUE NO SE LEYÓ. Es la del título. Con la
//      ventana llena, ninguna frase puede afirmar ausencia de hechos; puede
//      decir que entre lo leído no hubo coincidencias, que es otra cosa.
//
//   2. CALLAR EL RECORTE CUANDO LA LISTA TRAE FILAS. Una lista con veinte
//      renglones también está recortada, y quien la imprime se lleva la idea
//      de que eso es todo. El aviso no es del caso vacío: es de la lectura.
//
//   3. DEDUCIR EL TOPE EN VEZ DE COMPARARLO. 200 filas leídas no significan
//      que haya más: pueden ser las 200 que existen. El tope se compara con el
//      que pidió la consulta. Mismo criterio que `huecoDeArranque`, que no
//      deduce el recorte de que haya 52 semanas justas.
//
//   4. PRESENTAR UNA COTA INFERIOR COMO CUENTA EXACTA. La campana lee las
//      últimas NOTIF_TOPE y recién después descarta las archivadas, así que
//      con la ventana llena «3 sin leer» puede ser 3 de 11. Un número exacto
//      sobre una cota es la misma mentira del punto 1, en dígitos.
//
// SE EJECUTA, NO SE LEE. Las dos cuentas y las frases se extraen de
// `src/App.jsx` y se corren con listas sembradas. El banco no comprueba que
// exista una función: comprueba qué cadena sale para cada lectura.
//
// LAS FRASES NO ESTÁN TECLEADAS AQUÍ. Lo que se afirma son PROPIEDADES de la
// cadena —que no contenga «no hay registros», que nombre el tope, que traiga
// la fecha del piso—. Teclear la redacción dejaría el banco rojo el día que se
// corrija una coma, y además lo comprobaría contra sí mismo.
//
// Uso:  node scripts/prueba-la-ventana-que-se-llama-registro.cjs
//       node scripts/prueba-la-ventana-que-se-llama-registro.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = [
  'ventanaDeBitacora', 'frasesDeVentanaBitacora',
  'VENTANA_COMPLETA', 'VENTANA_TOPADA',
  'NOTIF_TOPE', 'frasesDeCampana',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── El fixture ──────────────────────────────────────────────────────────────
//
// Las filas se siembran con las fechas de verdad del caso medido: la ventana
// llega hasta finales de octubre y la pregunta es por junio. Si el fixture
// usara fechas pegadas, el banco pasaría con una ventana de un día y no
// distinguiría el caso.
const fila = (ts, extra = {}) => ({ id: ts, ts, usuario: 'a@b.mx', modulo: 'obras', ...extra });

// Orden `ts desc`, como lo entrega la consulta.
const filas = (n, desdeDia = 30) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = String(desdeDia - (i % 8)).padStart(2, '0');
    out.push(fila(`2026-10-${d}T0${i % 10}:15:00.000Z`));
  }
  return out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
};

const DIEZ = filas(10);          // caben de sobra en un tope de 200
const DOSCIENTAS = filas(200);   // justo el tope: hay más atrás y no consta

const sinCifras = (s) => !/\d/.test(String(s));
const dice = (s, re) => re.test(String(s || ''));
// «No hay», «no existe», «nadie», «ninguno» a secas: las formas de afirmar
// ausencia. `ninguno COINCIDE` no es ausencia de hechos, así que se exige que
// la frase que la use venga acompañada del tope.
const AFIRMA_AUSENCIA = /no hay registros|no existe|no hubo|sin movimientos|nadie/i;

async function correr(fuente) {
  const fn = construir(fuente);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };

  // ── 0 · EL FIXTURE DISTINGUE DE VERDAD ────────────────────────────────────
  // Si las dos lecturas sembradas cayeran en el mismo estado, todo lo de abajo
  // pasaría por la razón equivocada. Esto no prueba la app: protege al banco.
  const vComp = fn.ventanaDeBitacora({ items: DIEZ, tope: 200 });
  const vTop = fn.ventanaDeBitacora({ items: DOSCIENTAS, tope: 200 });
  check(vComp.estado === fn.VENTANA_COMPLETA && vTop.estado === fn.VENTANA_TOPADA,
    'el fixture produce las dos lecturas: una agotada y una topada',
    `${vComp.estado} y ${vTop.estado}`);

  // ── 1 · EL TOPE SE COMPARA, NO SE DEDUCE ──────────────────────────────────
  // Doscientas filas leídas con un tope de 500 son las doscientas que hay. La
  // versión que mirara sólo el número diría «hay más atrás» y mandaría al
  // usuario a ampliar una ventana que ya sobraba.
  const v200de500 = fn.ventanaDeBitacora({ items: DOSCIENTAS, tope: 500 });
  check(v200de500.estado === fn.VENTANA_COMPLETA,
    '200 filas bajo un tope de 500 son la colección entera, no una ventana',
    `estado ${v200de500.estado}`);
  check(fn.ventanaDeBitacora({ items: [], tope: 200 }).estado === fn.VENTANA_COMPLETA,
    'y una colección vacía está agotada, no topada');

  // ── 2 · EL PISO SALE DE LAS FILAS ─────────────────────────────────────────
  // Se mide, no se toma del último elemento: el orden lo pone la consulta.
  const revueltas = [...DIEZ].sort(() => -1);
  check(fn.ventanaDeBitacora({ items: revueltas, tope: 200 }).piso === vComp.piso,
    'el piso de la ventana no depende del orden en que lleguen las filas',
    `${vComp.piso}`);
  const masViejo = DOSCIENTAS.reduce((m, f) => (f.ts < m ? f.ts : m), DOSCIENTAS[0].ts);
  check(vTop.piso === masViejo,
    'y es el ts más viejo que se leyó',
    `${vTop.piso}`);
  check(dice(vTop.alcanza, /2026/),
    'la fecha del piso se dice en palabras, para poder leerla en pantalla',
    `«${vTop.alcanza}»`);

  // ── 3 · LA LECTURA AGOTADA SÍ PUEDE AFIRMAR AUSENCIA ──────────────────────
  // Es la mitad que suele olvidarse: si se leyó todo, «no hay registros» es
  // cierto, y una pantalla que se escude en la ventana cuando no hay ventana
  // deja de contestar lo que sabe.
  const fVacia = fn.frasesDeVentanaBitacora(
    fn.ventanaDeBitacora({ items: [], tope: 200 }), 0);
  check(dice(fVacia.vacio, AFIRMA_AUSENCIA),
    'con la colección leída entera y vacía, la pantalla sí dice que no hay nada',
    `«${fVacia.vacio}»`);
  check(fVacia.aviso === null,
    'y no cuelga un aviso de ventana donde no hubo ventana');

  const fComp = fn.frasesDeVentanaBitacora(vComp, 0);
  check(!dice(fComp.vacio, /\b200\b/) && fComp.aviso === null,
    'diez filas de diez tampoco mencionan un tope que no las alcanzó',
    `«${fComp.vacio}»`);
  // «Vacío» y «sin coincidencias» no son el mismo hecho ni con la lectura
  // completa: diez filas leídas y ninguna que case es culpa de los filtros, y
  // decir «no hay registros aún» manda a buscar el defecto donde no está.
  check(!dice(fComp.vacio, /no hay registros/i) && dice(fComp.vacio, /filtro/i),
    'con filas leídas y ninguna coincidencia, la culpa se le achaca a los filtros',
    `«${fComp.vacio}»`);

  // ── 4 · LA VENTANA LLENA NO AFIRMA AUSENCIA ───────────────────────────────
  // El corazón del pendiente.
  const fTop = fn.frasesDeVentanaBitacora(vTop, 0);
  check(!dice(fTop.vacio, AFIRMA_AUSENCIA),
    'con la ventana llena, el vacío NO afirma que no haya habido movimientos',
    `«${fTop.vacio}»`);
  check(dice(fTop.vacio, /\b200\b/),
    'dice cuántos movimientos leyó',
    `«${fTop.vacio}»`);
  check(dice(fTop.vacio, /2026/),
    'y hasta qué fecha llegó, que es lo que convierte el aviso en algo accionable');
  check(dice(fTop.vacio, /ventana|fecha|atrás/i),
    'y le dice al usuario qué hacer para alcanzar lo que falta');

  // ── 5 · EL AVISO ES DE LA LECTURA, NO DEL CASO VACÍO ──────────────────────
  // Veinte coincidencias sobre una ventana de 200 siguen siendo un recorte.
  const fTopConFilas = fn.frasesDeVentanaBitacora(vTop, 20);
  check(fTopConFilas.aviso && dice(fTopConFilas.aviso, /\b200\b/),
    'con filas en pantalla el aviso del recorte sigue puesto',
    `«${fTopConFilas.aviso}»`);
  check(dice(fTopConFilas.aviso, /2026/),
    'y también trae la fecha hasta donde alcanzó la lectura');

  // ── 6 · EL ENCABEZADO NO LLAMA «REGISTROS» A UNA VENTANA ──────────────────
  // «20 de 200 registros» se lee como «de los 200 que hay». Son 200 leídos de
  // 4,603, y el encabezado es lo que alguien copia en un correo.
  check(dice(fTopConFilas.encabezado, /\b20\b/) && dice(fTopConFilas.encabezado, /\b200\b/),
    'el encabezado dice cuántos coinciden y sobre cuántos se preguntó',
    `«${fTopConFilas.encabezado}»`);
  check(!/\b200 registros\b/.test(fTopConFilas.encabezado),
    'pero no llama «200 registros» a los últimos 200 movimientos',
    `«${fTopConFilas.encabezado}»`);
  check(dice(fTopConFilas.encabezado, /últim/i),
    'los nombra por lo que son: los últimos');
  check(dice(fn.frasesDeVentanaBitacora(vComp, 3).encabezado, /registro/i),
    'y cuando la lectura fue completa sí son registros, a secas',
    `«${fn.frasesDeVentanaBitacora(vComp, 3).encabezado}»`);

  // ── 7 · UNA SOLA FILA NO SE DICE EN PLURAL ────────────────────────────────
  // Nimiedad que delata: «1 de 1 registros» es la marca de una cifra armada a
  // mano, y este encabezado lo lee alguien que audita.
  const fUna = fn.frasesDeVentanaBitacora(
    fn.ventanaDeBitacora({ items: [DIEZ[0]], tope: 200 }), 1);
  check(!dice(fUna.encabezado, /1 registros/),
    'una sola fila no se anuncia en plural',
    `«${fUna.encabezado}»`);

  // ── 8 · LA CAMPANA: UNA COTA NO SE ENSEÑA COMO CUENTA ─────────────────────
  // Mismo defecto en chico. `leidas` es lo que LLEGÓ —archivadas incluidas—,
  // porque el tope se midió antes de descartarlas: ahí es donde se pierde lo
  // de más atrás.
  const T = fn.NOTIF_TOPE;
  const cHolgada = fn.frasesDeCampana({ leidas: 12, sinLeer: 3 });
  const cTopada = fn.frasesDeCampana({ leidas: T, sinLeer: 3 });
  check(cHolgada.topada === false && cTopada.topada === true,
    'la campana distingue una lectura holgada de una topada',
    `${T} leídas → topada`);
  check(cHolgada.insignia === '3' && cTopada.insignia === '3+',
    'con la ventana llena la insignia dice que 3 es una cota, no la cuenta',
    `«${cHolgada.insignia}» y «${cTopada.insignia}»`);
  check(dice(cTopada.encabezado, /\+/),
    'y el encabezado tampoco presenta la cota como exacta',
    `«${cTopada.encabezado}»`);

  // «Todo al día» es la afirmación más fuerte de la campana: dice que no queda
  // nada. Sólo puede salir cuando se leyó todo.
  const cAlDia = fn.frasesDeCampana({ leidas: 12, sinLeer: 0 });
  const cAlDiaTopada = fn.frasesDeCampana({ leidas: T, sinLeer: 0 });
  check(dice(cAlDia.encabezado, /al día/i),
    'con la lectura holgada y nada sin leer, la campana sí dice «todo al día»',
    `«${cAlDia.encabezado}»`);
  check(!dice(cAlDiaTopada.encabezado, /al día/i),
    'con la ventana llena NO dice «todo al día», que afirmaría lo que no leyó',
    `«${cAlDiaTopada.encabezado}»`);
  check(dice(cAlDiaTopada.encabezado, new RegExp(`\\b${T}\\b`)),
    'dice sobre cuántas se pronuncia',
    `«${cAlDiaTopada.encabezado}»`);
  check(!dice(cTopada.vacio, AFIRMA_AUSENCIA) && dice(cTopada.vacio, /atrás/i),
    'y su lista vacía tampoco afirma ausencia: dice que puede haber más atrás',
    `«${cTopada.vacio}»`);
  check(sinCifras(cHolgada.vacio),
    'mientras la lectura fue completa, el vacío no habla de topes',
    `«${cHolgada.vacio}»`);

  // El tope de la frase y el de la consulta son el mismo número por
  // construcción: la función lo toma por omisión de la constante que pide la
  // consulta. Si fueran dos, la campana diría «entre las últimas 100» sobre
  // una lectura de cincuenta.
  check(dice(fn.frasesDeCampana({ leidas: T, sinLeer: 0 }).encabezado,
    new RegExp(`\\b${T}\\b`)),
    'el tope que anuncia la campana es el que trae NOTIF_TOPE por omisión',
    `NOTIF_TOPE = ${T}`);

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver a mentir —varias son
// exactamente el código que había antes del arreglo—, no de romper el
// andamiaje: el banco sigue arrancando y ejecutando, y tiene que salir ROJO.
const MUTACIONES = [
  // La mentira original, tal cual estaba escrita.
  ['el vacío vuelve a contestar «no hay registros» sobre la ventana',
    `      vacio: v.leidas === 0
        ? 'No hay registros aún.'
        : 'Ningún registro coincide con los filtros.',`,
    `      vacio: 'No hay registros aún.',`],
  ['el vacío de la ventana llena copia el de la lectura completa',
    `    vacio: \`Entre los últimos \${v.tope} movimientos\${hasta} ninguno coincide con \``,
    `    vacio: \`No hay registros aún.\` + \`\${''}\``],
  // El tope deducido en vez de comparado.
  ['el tope se deduce de un número redondo en vez de compararlo',
    'estado: tope > 0 && leidas >= tope ? VENTANA_TOPADA : VENTANA_COMPLETA,',
    'estado: leidas >= 200 ? VENTANA_TOPADA : VENTANA_COMPLETA,'],
  ['toda lectura se declara topada, y hasta la vacía manda a ampliar',
    'estado: tope > 0 && leidas >= tope ? VENTANA_TOPADA : VENTANA_COMPLETA,',
    'estado: VENTANA_TOPADA,'],
  ['ninguna lectura se declara topada: el recorte vuelve a ser invisible',
    'estado: tope > 0 && leidas >= tope ? VENTANA_TOPADA : VENTANA_COMPLETA,',
    'estado: VENTANA_COMPLETA,'],
  // El piso.
  ['el piso se toma del último elemento y depende del orden de llegada',
    `  const piso = items.reduce((m, it) => {
    const t = String(it.ts || '');
    return t && (!m || t < m) ? t : m;
  }, '');`,
    `  const piso = items.length ? String(items[items.length - 1].ts || '') : '';`],
  ['la ventana deja de decir hasta qué fecha alcanzó',
    'alcanza: piso ? fechaEnPalabras(fechaLocalDeISO(piso)) : null,',
    'alcanza: null,'],
  // El aviso.
  ['el aviso del recorte sólo sale cuando la lista queda vacía',
    `    aviso: \`Se leyeron los últimos \${v.tope} movimientos\${hasta}. Hay bitácora \``,
    `    aviso: coinciden > 0 ? null : \`Se leyeron los últimos \${v.tope} movimientos\${hasta}. Hay bitácora \``],
  ['el aviso deja de nombrar el tope y queda en una vaguedad',
    `    aviso: \`Se leyeron los últimos \${v.tope} movimientos\${hasta}. Hay bitácora \`
      + \`más atrás: para alcanzarla, filtra por fecha o amplía la ventana.\`,`,
    `    aviso: 'La lista puede estar incompleta.',`],
  ['la lectura completa cuelga un aviso de ventana que no tuvo',
    '      aviso: null,',
    '      aviso: `Se leyeron los últimos ${v.tope} movimientos.`,'],
  // El encabezado.
  ['el encabezado vuelve a llamar «registros» a los últimos N movimientos',
    '    encabezado: `${coinciden} de los últimos ${v.tope} movimientos${hasta}`,',
    '    encabezado: `${coinciden} de ${v.leidas} registros`,'],
  ['el encabezado esconde sobre cuántos se preguntó',
    '    encabezado: `${coinciden} de los últimos ${v.tope} movimientos${hasta}`,',
    '    encabezado: `${coinciden} registros`,'],
  ['el plural se pone a mano y «1 de 1 registros» vuelve a salir',
    "      encabezado: `${coinciden} de ${v.leidas} registro${v.leidas === 1 ? '' : 's'}`,",
    '      encabezado: `${coinciden} de ${v.leidas} registros`,'],
  ['el vacío de la lectura completa se escuda en una ventana inexistente',
    `      vacio: v.leidas === 0
        ? 'No hay registros aún.'`,
    `      vacio: v.leidas === 0
        ? 'Entre lo leído no hay coincidencias; puede haber más atrás.'`],
  // La campana, con el código que tenía antes del arreglo.
  ['la campana vuelve a decir «Todo al día» sobre una ventana llena',
    `    encabezado: sinLeer > 0
      ? \`\${sinLeer}\${topada ? '+' : ''} sin leer\`
      : topada ? \`Sin pendientes entre las últimas \${tope}\` : 'Todo al día',`,
    `    encabezado: sinLeer > 0 ? \`\${sinLeer} sin leer\` : 'Todo al día',`],
  ['la insignia presenta la cota inferior como cuenta exacta',
    "    insignia: sinLeer > 9 ? '9+' : topada ? `${sinLeer}+` : String(sinLeer),",
    "    insignia: sinLeer > 9 ? '9+' : String(sinLeer),"],
  ['la campana marca topada toda lectura y pone «+» donde no hace falta',
    '  const topada = tope > 0 && leidas >= tope;',
    '  const topada = true;'],
  ['la campana no reconoce nunca el tope',
    '  const topada = tope > 0 && leidas >= tope;',
    '  const topada = false;'],
  ['el tope de la frase se desengancha del que pide la consulta',
    'const frasesDeCampana = ({ leidas = 0, sinLeer = 0, tope = NOTIF_TOPE } = {}) => {',
    'const frasesDeCampana = ({ leidas = 0, sinLeer = 0, tope = 50 } = {}) => {'],
];

(async () => {
  if (process.argv.includes('--contraprueba')) {
    console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
    let sobrevivieron = 0;
    for (const [titulo, de, a] of MUTACIONES) {
      if (!cuerpo.includes(de)) {
        console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje en la fuente`);
        process.exit(2);
      }
      let fallos;
      process.env.CALLADO = '1';
      try { fallos = await correr(cuerpo.replace(de, a)); }
      catch (e) { fallos = [`revienta: ${e.message}`]; }
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

  console.log('UNA VENTANA NO ES EL REGISTRO · #29 / #3\n');
  const fallos = await correr(cuerpo);
  if (fallos.length) {
    console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nverde');
  process.exit(0);
})();
