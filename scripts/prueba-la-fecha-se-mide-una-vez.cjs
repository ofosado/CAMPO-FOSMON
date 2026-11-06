#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// UNA FECHA SE MIDE UNA VEZ, Y LO IMPRESO NO SE VUELVE A LEER — #17
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. El #17 pedía auditar el repositorio entero por el mismo
// hueco de «fecha faltante» que el #79 encontró en el correo del lunes. La
// auditoría encontró el hueco, sí, pero encontró algo peor al lado: una fecha
// que SÍ está y que la pantalla deja de poder medir porque la escribe dos
// veces. Las cuatro conductas que este banco afirma salieron de ahí.
//
//   1. LA INSIGNIA DE GP DECÍA «hace un momento» EN VERDE, SIEMPRE. No por un
//      dato ausente: el instante llegaba bien de Firestore, se guardaba en el
//      estado ya convertido a texto con `toLocaleString('es-MX')`, y la
//      insignia volvía a leer ESE texto con `new Date`, que no sabe. Daba
//      Invalid Date, la resta daba NaN, y `NaN > 72` y `NaN > 30` son las dos
//      falsas: TODOS los umbrales fallaban hacia el lado tranquilizador. Un
//      Sheet sin sincronizar en una semana se veía igual que uno recién
//      sincronizado. Estaba vivo en producción, no latente.
//
//   2. «DÍAS DESDE fechaFact» ESTABA ESCRITA CUATRO VECES. La buena —la que
//      pinta el semáforo de cada renglón— lee la fecha en LOCAL. `fin_003`,
//      la alerta que publica dinero «sin cobrar fuera de plazo», la leía con
//      `new Date(iso)`, o sea medianoche UTC, que al oeste de Greenwich cuenta
//      un día de más. El renglón podía decir «Dentro de plazo» en verde y la
//      alerta, la misma obra el mismo día, reclamar su monto.
//
//   3. CUÁL DE DOS CAPTURAS DE LA MISMA SEMANA GANA estaba escrita dos veces,
//      idéntica y sin guarda: `new Date(a.fechaCaptura) > new Date(b...)`. Si a
//      la que ya estaba le faltaba la fecha, la comparación daba NaN, `NaN > x`
//      es falso, y el snapshot NUEVO se descartaba en silencio: la curva seguía
//      dibujando el rancio.
//
// LO QUE SE AFIRMA ES CONDUCTA. Lo que sale por pantalla: el color del chip, su
// texto, su tooltip, el renglón de la alerta, el punto que dibuja la curva. El
// código se extrae de `src/App.jsx` y se EJECUTA; de nombres sólo se usa la
// dirección para llegar. Ninguna cifra esperada está tecleada: cada una se
// obtiene ejecutando la cuenta del repositorio.
//
// EL CHIP NO ES UNA FUNCIÓN, Y ASÍ SE EJERCITA IGUAL. La decisión de color vive
// dentro de `PantallaObras`, donde `fuenteDeApp` no llega. Se saca el TROZO por
// anclas y se ejecuta con sus variables alrededor. Si un ancla se mueve el
// banco sale 2, no verde: lo que no puede pasar es afirmar sobre el chip sin
// haberlo corrido.
//
// EL RELOJ SE CONGELA, Y HAY QUE CONGELARLO. La diferencia entre medianoche
// local y medianoche UTC es de un día entero, pero sólo se nota a ciertas horas
// —en México, a partir de las 18:00—. Un banco que la buscara con el reloj de
// pared saldría verde doce horas al día y rojo las otras seis: eso no es una
// prueba, es una moneda. Aquí el día se ancla y la hora se BARRE de 0 a 23, así
// que la discrepancia se encuentra si existe, a cualquier hora que se corra.
//
// Uso:  node scripts/prueba-la-fecha-se-mide-una-vez.cjs
//       node scripts/prueba-la-fecha-se-mide-una-vez.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const { fuenteDeApp, ARCHIVO } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
const { ZONA } = require('./reloj.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = [
  'frescuraDeGP', 'fechaHoraLegible', 'haceCuanto',
  'atrasoDeEstimacion', 'detectarRiesgos', 'BIBLIOTECA_RIESGOS',
  'capturaMasReciente', 'serieAvanceDeSemanas', 'claveSemanaISO',
  'C', '_GP_NOTA',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan);

// ── El trozo del chip, sacado de dentro del componente ─────────────────────
//
// Entre estas dos anclas está toda la decisión: qué dice, de qué color, y qué
// explica el tooltip. Se corta tal cual —sin reescribir una letra— y se ejecuta
// con `fallo`, `gpEstado` y `gpUltActualiz` alrededor.
const SRC = fs.readFileSync(ARCHIVO, 'utf8');
const ANCLA_INI = 'let color, bg, txt, texto, tip;';
const ANCLA_FIN = 'return <div title={tip}';
const iIni = SRC.indexOf(ANCLA_INI);
const iFin = iIni < 0 ? -1 : SRC.indexOf(ANCLA_FIN, iIni);
if (iIni < 0 || iFin < 0) {
  noArranco.sinPrecondicion(
    'el trozo del chip de GP dentro de `PantallaObras` (las anclas se movieron)',
    [`buscar en src/App.jsx cómo quedó el bloque que empieza en «${ANCLA_INI}»`,
     'y apuntar las anclas de este banco al texto nuevo']);
}
const TROZO = SRC.slice(iIni, iFin);

// El huso tiene que ser el de `reloj.cjs`: todo lo que sigue cuenta días
// locales, y en UTC la mitad de este banco no afirmaría nada.
const ZONA_VIVA = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (ZONA_VIVA !== ZONA) {
  noArranco.sinPrecondicion(
    `el huso tiene que ser ${ZONA} y es ${ZONA_VIVA}`,
    ['correr sin `FORZAR_TZ`, que es la puerta que sólo usa el banco del reloj']);
}

// ── El reloj congelado ─────────────────────────────────────────────────────
//
// Se pisa `Date.now` y nada más: así el código extraído —que lo llama por
// dentro, sin recibir la hora— mide contra un instante elegido.
const NOW_REAL = Date.now;
const conReloj = (ms, fn) => {
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = NOW_REAL; }
};

// Un día anclado, para que el calendario no mueva el veredicto.
const DIA = '2026-11-06';
const instante = (hora) => Date.parse(`${DIA}T${String(hora).padStart(2, '0')}:30:00-06:00`);
const diaMenos = (k) => {
  const d = new Date(`${DIA}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - k);
  return d.toISOString().slice(0, 10);
};

const construir = (fuenteCuerpo, fuenteTrozo) => {
  const mod = new Function(`"use strict";\n${fuenteCuerpo}\n` +
    `const chip = (fallo, gpEstado, gpUltActualiz) => {\n${fuenteTrozo}\n` +
    `  return { color, bg, txt, texto, tip };\n};\n` +
    `return { ${PEDIDOS.join(', ')}, chip };`)();
  return mod;
};

function correr(fuenteCuerpo, fuenteTrozo) {
  const fn = construir(fuenteCuerpo, fuenteTrozo);
  const { C } = fn;
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const seccion = (t) => { if (!process.env.CALLADO) console.log(`\n ${t}`); };

  // El nombre del color, para poder decir en el detalle qué se pintó en vez de
  // un `var(--c-red)` que no distingue nada a ojo.
  const NOMBRE_COLOR = new Map([[C.green, 'verde'], [C.yellow, 'amarillo'],
    [C.red, 'rojo'], [C.borderM, 'gris']]);
  const comoSeVe = (c) => NOMBRE_COLOR.get(c?.color) || `(otro: ${c?.color})`;

  // ── 1 · EL CHIP DE GP ─────────────────────────────────────────────────────
  seccion('1 · el chip de «Gasto GP»: lo que dice y de qué color');

  const AHORA = instante(9);
  const haceHoras = (h) => new Date(AHORA - h * 3600000).toISOString();

  const chip = (valor, ahora = AHORA) =>
    conReloj(ahora, () => fn.chip(false, 'listo', valor));

  const c22 = chip(haceHoras(22));
  const c40 = chip(haceHoras(40));
  const c100 = chip(haceHoras(100));
  check(c22.color === C.green, 'con 22 h de antigüedad el chip sale verde',
    `${comoSeVe(c22)} · «${c22.texto}»`);
  check(c40.color === C.yellow, 'con 40 h sale amarillo', `${comoSeVe(c40)} · «${c40.texto}»`);
  check(c100.color === C.red, 'con 100 h sale ROJO', `${comoSeVe(c100)} · «${c100.texto}»`);

  // LA REGRESIÓN VIVA. El texto no se teclea: se produce imprimiendo el mismo
  // instante con la función que lo imprime, que es exactamente lo que el estado
  // guardaba. Si alguien vuelve a guardar lo impreso, esto muerde.
  const viejo = haceHoras(100);
  const yaImpreso = fn.fechaHoraLegible(viejo);
  const cImpreso = chip(yaImpreso);
  check(cImpreso.color === C.borderM,
    'el instante YA IMPRESO no se puede medir, y el chip lo dice en gris',
    `«${yaImpreso}» → ${comoSeVe(cImpreso)} · «${cImpreso.texto}»`);
  check(!/hace un momento/.test(cImpreso.texto),
    'y sobre todo NO dice «hace un momento»: eso era la mentira',
    `dice «${cImpreso.texto}»`);
  check(cImpreso.color !== c100.color,
    'el mismo instante, crudo o impreso, no puede dar el mismo chip tranquilo',
    `crudo ${comoSeVe(c100)} · impreso ${comoSeVe(cImpreso)}`);
  check(/no trae una fecha/.test(cImpreso.tip || ''),
    'y el tooltip explica que el documento no trae fecha legible', cImpreso.tip);

  // Una fecha futura no es frescura: es un reloj mal puesto.
  const cFuturo = chip(new Date(AHORA + 5 * 3600000).toISOString());
  check(cFuturo.color === C.borderM && !/hace/.test(cFuturo.texto),
    'una fecha futura tampoco se cuenta como fresca',
    `${comoSeVe(cFuturo)} · «${cFuturo.texto}»`);

  // Sin fecha el chip no llega a pintarse (lo corta un `return null` arriba),
  // así que esto se afirma sobre la cuenta, que es quien decidiría.
  for (const vacio of ['', null, undefined, 'ayer']) {
    const f = fn.frescuraDeGP(vacio, AHORA);
    check(f.nivel === 'sinMedir' && !/hace un momento/.test(f.texto),
      `sin instante utilizable (${JSON.stringify(vacio)}) no se afirma frescura`,
      `${f.nivel} · «${f.texto}»`);
  }

  // Color y texto salen de la MISMA llamada. Antes el color venía de `horas` y
  // el texto de `dias`, dos lecturas del mismo NaN, y podían separarse.
  const PALETA = new Map([['fresco', C.green], ['tibio', C.yellow],
    ['viejo', C.red], ['sinMedir', C.borderM]]);
  const discrepan = [2, 22, 31, 40, 73, 100, 500].filter(h => {
    const f = fn.frescuraDeGP(haceHoras(h), AHORA);
    const c = chip(haceHoras(h));
    return c.color !== PALETA.get(f.nivel) || c.texto !== f.texto;
  });
  check(discrepan.length === 0,
    'el color y el texto del chip salen de la misma cuenta, a toda antigüedad',
    discrepan.length ? `discrepan a ${discrepan.join(', ')} h` : '7 antigüedades, ninguna discrepa');

  // ── 2 · LO QUE SE IMPRIME NO DICE «Invalid Date» ──────────────────────────
  seccion('2 · imprimir una fecha que no se puede leer');
  check(typeof fn.fechaHoraLegible(viejo) === 'string' && fn.fechaHoraLegible(viejo).length > 0,
    'un instante bueno se imprime', fn.fechaHoraLegible(viejo));
  const basura = ['', null, undefined, 'ayer', yaImpreso]
    .map(v => fn.fechaHoraLegible(v));
  check(basura.every(v => v === null),
    'y lo que no se puede leer devuelve null, nunca «Invalid Date»',
    basura.map(v => String(v)).join(' · '));

  // ── 3 · UNA CUENTA POR NÚMERO: `fin_003` Y EL SEMÁFORO DEL RENGLÓN ────────
  seccion('3 · la alerta de cobro y el semáforo del renglón cuentan igual');

  const DIAS_PAGO = 30;
  const OBRA = { id: '0112', nombre: 'prueba', presupuesto: 1000000, diasPago: DIAS_PAGO };
  const est = (k, monto) => ({ no: 1, estatus: 'Facturada', fechaFact: diaMenos(k), monto });
  const ctx = (estimaciones) => ({
    obra: OBRA, subs: [], estimaciones, historialAvance: [],
    kpis: { af: 50 }, programa: null,
  });
  const alerta = (estimaciones, ahora) => conReloj(ahora,
    () => fn.detectarRiesgos(ctx(estimaciones)).find(r => r.id === 'fin_003') || null);
  const semaforo = (e, ahora) => conReloj(ahora, () => fn.atrasoDeEstimacion(e, DIAS_PAGO));

  // El barrido. Para cada hora del día y cada antigüedad, la alerta dispara si
  // y sólo si el renglón está en rojo. Un solo desacuerdo es una obra donde la
  // pantalla y la alerta dicen cosas distintas del mismo dinero.
  const desacuerdos = [];
  let pares = 0;
  for (let h = 0; h < 24; h++) {
    const ahora = instante(h);
    for (let k = 25; k <= 36; k++) {
      pares++;
      const e = est(k, 100);
      const rojo = semaforo(e, ahora)?.color === C.red;
      const dispara = alerta([e], ahora) !== null;
      if (rojo !== dispara) desacuerdos.push(`${h}h/${k}d: renglón ${rojo ? 'rojo' : 'no rojo'} · alerta ${dispara ? 'dispara' : 'calla'}`);
    }
  }
  check(desacuerdos.length === 0,
    'la alerta dispara exactamente cuando el renglón está en rojo',
    desacuerdos.length ? `${desacuerdos.length} de ${pares} desacuerdan; p.ej. ${desacuerdos[0]}`
                       : `${pares} combinaciones de hora y antigüedad, 0 desacuerdos`);

  // La frontera, dicha en voz alta. El plazo es de 30 días: a los 30 todavía no
  // se debe nada y a los 31 se debe un día.
  const enPlazo = instante(20);
  const e30 = est(30, 100), e31 = est(31, 100);
  check(semaforo(e30, enPlazo).color !== C.red && alerta([e30], enPlazo) === null,
    'a los 30 días de un plazo de 30 el renglón no está en rojo y la alerta calla',
    `renglón «${semaforo(e30, enPlazo).texto}»`);
  const a31 = alerta([e31], enPlazo);
  check(semaforo(e31, enPlazo).color === C.red && a31 !== null,
    'a los 31 el renglón se pone rojo y la alerta aparece',
    `renglón «${semaforo(e31, enPlazo).texto}» · alerta ${a31 ? a31.severidad : 'ninguna'}`);

  // El número que publica la alerta es el de la cuenta, no uno propio ni uno
  // leído de vuelta del rótulo.
  const CARTERA = [est(45, 500), est(33, 300), est(10, 200)];
  const aCart = alerta(CARTERA, enPlazo);
  const rojasCart = CARTERA.map(e => semaforo(e, enPlazo)).filter(a => a?.color === C.red);
  const maxEsperado = Math.max(...rojasCart.map(a => a.diasAtraso));
  check(aCart !== null && Number(aCart.valor) === rojasCart.length,
    'cuenta las atrasadas que el semáforo pinta en rojo, ni una más',
    `publica ${aCart?.valor} · en rojo ${rojasCart.length} de ${CARTERA.length}`);
  // Dos aserciones y no una. La igualdad sola no alcanza: si el semáforo deja
  // de entregar los días, los dos lados quedan en NaN y la igualdad «coincide»
  // —el banco se estaría comprobando contra sí mismo—. Primero se exige que lo
  // PUBLICADO sea un número de días, que es lo que lee quien abre la pantalla.
  const mExtra = /Máximo atraso: (-?\d+) días/.exec(aCart?.extra || '');
  check(mExtra !== null,
    'la alerta publica un número entero de días, no un NaN ni un hueco',
    `«${aCart?.extra}»`);
  check(mExtra !== null && Number(mExtra[1]) === maxEsperado,
    'y ese número es el de `atrasoDeEstimacion`',
    `publica ${mExtra?.[1]} · la cuenta da ${maxEsperado}`);

  // Una facturada SIN fecha no se puede medir, y no se puede medir en los dos
  // sitios igual: ni el renglón la pinta ni la alerta la reclama.
  const sinFecha = { no: 9, estatus: 'Facturada', fechaFact: '', monto: 400 };
  check(semaforo(sinFecha, enPlazo) === null && alerta([sinFecha], enPlazo) === null,
    'una facturada sin fecha no se mide, y los dos sitios callan igual');

  // ── 4 · CUÁL DE DOS CAPTURAS DE LA MISMA SEMANA DIBUJA LA CURVA ───────────
  seccion('4 · dos capturas de la misma semana');

  const snap = (fecha, avance) => ({ semana: 20, año: 2026, fechaCaptura: fecha,
    avancePonderado: avance, esquema: 1 });
  const gana = (a, b) => fn.capturaMasReciente(a, b)?.avancePonderado;

  check(gana(snap('2026-05-11T10:00:00Z', 10), snap('2026-05-12T10:00:00Z', 90)) === 90,
    'entre dos fechadas gana la más reciente');
  check(gana(snap('2026-05-12T10:00:00Z', 90), snap('2026-05-11T10:00:00Z', 10)) === 90,
    'y gana igual si la más reciente era la que ya estaba');
  check(gana(snap('2026-05-12T10:00:00Z', 10), snap('2026-05-12T10:00:00Z', 90)) === 10,
    'el empate exacto lo conserva la que ya estaba, como antes');
  check(gana(snap('', 10), snap('2026-05-12T10:00:00Z', 90)) === 90,
    'una captura fechada desplaza a la que no se sabe cuándo se capturó');
  check(gana(snap('2026-05-12T10:00:00Z', 90), snap('', 10)) === 90,
    'y una sin fecha no desplaza a la fechada: de ésa sí se sabe');

  // Y lo que importa: qué PUNTO dibuja la curva. Aquí estaba el silencio — con
  // la primera sin fecha, la nueva se descartaba y la gráfica seguía en 10.
  const SEMANAS = [{ key: fn.claveSemanaISO(20, 2026), sem: 20, año: 2026, label: 'S20', fecha: '11/05' }];
  const serieDe = (historial) => fn.serieAvanceDeSemanas({
    semanas: SEMANAS, historialAvance: historial, subs: [], obra: OBRA }).serie[0];
  check(serieDe([snap('', 10), snap('2026-05-12T10:00:00Z', 90)]) === 90,
    'la curva dibuja la captura nueva aunque la anterior no trajera fecha',
    `dibuja ${serieDe([snap('', 10), snap('2026-05-12T10:00:00Z', 90)])}`);
  check(serieDe([snap('2026-05-11T10:00:00Z', 10), snap('2026-05-12T10:00:00Z', 90)]) === 90,
    'y con las dos fechadas dibuja la más reciente');

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una forma realista de volver al defecto —varias son el
// defecto literal, copiado del `git diff`— y no de romper el andamiaje: el
// banco sigue arrancando y ejecutando, y tiene que salir ROJO.
const MUTACIONES = [
  // El defecto vivo, literal: el chip vuelve a leer el texto impreso.
  ['trozo', 'el chip vuelve a medir sobre el texto ya impreso',
    'const f = frescuraDeGP(gpUltActualiz, Date.now());',
    `const _ms = Date.now() - new Date(String(gpUltActualiz).replace(',',' ')).getTime();
             const _horas = Math.floor(_ms / 3600000), _dias = Math.floor(_horas / 24);
             const f = { nivel: _horas > 72 ? 'viejo' : _horas > 30 ? 'tibio' : 'fresco',
               texto: _dias >= 1 ? \`hace \${_dias} días\` : _horas >= 1 ? \`hace \${_horas} h\` : 'hace un momento' };`],
  // El color saliendo de una cuenta y el texto de otra: pueden separarse.
  ['trozo', 'el color sale de una cuenta y el texto de otra',
    '[color, bg, txt] = paleta[f.nivel];',
    "[color, bg, txt] = paleta[frescuraDeGP(gpUltActualiz, Date.now() - 80 * 3600000).nivel];"],
  // No poder medir vuelve a fallar hacia el lado tranquilizador.
  ['cuerpo', 'sin fecha legible se vuelve a afirmar «fresco»',
    "if (!h) return { nivel: 'sinMedir', texto: 'sin fecha de sincronización' };",
    "if (!h) return { nivel: 'fresco', texto: 'hace un momento' };"],
  // Un reloj mal puesto contado como frescura.
  ['cuerpo', 'una fecha futura se cuenta como fresca',
    "if (h.horas < 0) return { nivel: 'sinMedir', texto: h.texto };",
    "if (h.horas < 0) return { nivel: 'fresco', texto: h.texto };"],
  // Imprimir «Invalid Date» en vez de callar.
  ['cuerpo', 'lo que no se puede leer se imprime como «Invalid Date»',
    "return Number.isFinite(t) ? new Date(t).toLocaleString('es-MX') : null;",
    "return new Date(t).toLocaleString('es-MX');"],
  // El defecto del #17 en `fin_003`, literal: rederivar a medianoche UTC.
  ['cuerpo', '`fin_003` vuelve a contar los días por su cuenta, a medianoche UTC',
    `      const conAtraso = estimaciones
        .map(e => ({ e, a: atrasoDeEstimacion(e, diasPago) }))
        .filter(({ a }) => a && a.color === C.red);`,
    `      const conAtraso = estimaciones
        .filter(e => e.estatus === 'Facturada' && e.fechaFact)
        .map(e => ({ e, a: { diasAtraso: Math.floor((Date.now() - new Date(e.fechaFact)) / 86400000) - diasPago } }))
        .filter(({ a }) => a.diasAtraso > 0);`],
  // El semáforo deja de entregar los números y la alerta tiene que inventarlos.
  ['cuerpo', 'el semáforo deja de devolver los días y la alerta publica NaN',
    'return {color:C.red,    texto:`${diasAtraso}d de atraso`,   sub, diasTrans, diasAtraso};',
    'return {color:C.red,    texto:`${diasAtraso}d de atraso`,   sub};'],
  // El descarte silencioso del snapshot nuevo.
  ['cuerpo', 'la captura nueva se vuelve a descartar en silencio por un NaN',
    `  if (!Number.isFinite(tl)) return quedaba;
  if (!Number.isFinite(tq)) return llega;
`, ''],
  // El empate cambiando de dueño sin que nadie lo pida.
  ['cuerpo', 'el empate de instante cambia de dueño',
    'return tl > tq ? llega : quedaba;',
    'return tl >= tq ? llega : quedaba;'],
  // La curva volviendo a decidir por su cuenta en vez de por la única cuenta.
  ['cuerpo', 'la serie de la curva vuelve a decidir con su propia comparación',
    'avancePorSem[key] = capturaMasReciente(avancePorSem[key], snap);',
    `if (!avancePorSem[key] ||
        new Date(snap.fechaCaptura) > new Date(avancePorSem[key].fechaCaptura)) {
      avancePorSem[key] = snap;
    }`],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [cual, titulo, de, a] of MUTACIONES) {
    const fuente = cual === 'trozo' ? TROZO : cuerpo;
    if (!fuente.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje en ${cual}`);
      process.exit(2);
    }
    let fallos;
    process.env.CALLADO = '1';
    try {
      fallos = cual === 'trozo'
        ? correr(cuerpo, TROZO.replace(de, a))
        : correr(cuerpo.replace(de, a), TROZO);
    } catch (e) { fallos = [`revienta: ${e.message}`]; }
    delete process.env.CALLADO;
    Date.now = NOW_REAL;
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

console.log('UNA FECHA SE MIDE UNA VEZ · #17');
const fallos = correr(cuerpo, TROZO);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
