#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS SEMANAS DE PLAZO SE CUENTAN UNA VEZ, Y UN PLAZO VENCIDO NO ES CERO — #17
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. El preámbulo de `plazoDeObra` (`src/App.jsx`) describe
// este defecto y lo da por arreglado: «La proyección del tablero del
// contratista hacía `new Date(obra.fin)` —el fin del CONTRATO, ignorando la
// ampliación— y `Date.now()`, el instante del aparato». Dos sitios se quedaron
// fuera de ese arreglo y siguieron contando el plazo por su cuenta:
//
//   · la regla `fin_006`, «Velocidad de quema insostenible»
//   · la tarjeta «Proyección de gasto», que además lo IMPRIME
//
// Los dos tenían el mismo renglón, y en un renglón caben tres errores:
//
//   1. EL FIN EQUIVOCADO. `obra.fin` es el fin del CONTRATO. Si la obra tiene
//      `finAmpliado`, el plazo vigente es otro — y `plz_001` y `plz_002`, dos
//      excepciones de ESA MISMA obra, sí medían contra el vigente. Dos
//      pantallas de una obra, dos plazos distintos.
//
//   2. EL RELOJ MEZCLADO. `new Date("2026-10-02")` se lee como medianoche UTC
//      —en México, el 1 a las 18:00— mientras `new Date()` es el instante
//      real. Restarlos arrastra el desfase del huso, y como después se divide
//      entre siete el error casi siempre se absorbe: asoma sólo los días en
//      que el cociente cae en la frontera de la semana. Un número correcto
//      casi siempre es un número en el que no se puede confiar nunca.
//
//   3. EL CERO FALSO. `Math.max(…, 0)` convertía un plazo VENCIDO en «quedan 0
//      semanas de plazo contractual». Eso no es un hueco, es una afirmación:
//      dice que la obra se acaba hoy. Medido contra producción el 2026-11-06,
//      lo decía en 3 de las 7 obras —la 0112 llevaba 35 días vencida— mientras
//      `plz_001` de la misma obra decía «Plazo vencido +35d».
//
// Las cifras que este banco espera NO se derivan aquí con una copia de la
// cuenta: son las que midió `medir-el-plazo-y-las-fechas-impresas.cjs` contra
// producción el 2026-11-06 (6, 15, 56 semanas y 35 días de vencimiento, con
// hoy = 2026-11-06). Una prueba que recalcula lo que va a comparar se está
// comprobando contra sí misma.
//
// POR QUÉ LA FRASE ES UN SÍMBOLO Y NO JSX. `frasePlazoRestante` se sacó del
// componente por lo mismo que `frescuraDeGP` en el lote anterior: una frase
// decidida dentro del JSX no se puede ejecutar, y de lo que no se ejecuta sólo
// se puede comprobar que el símbolo existe. Esta frase se equivocaba de las dos
// maneras posibles —el fin equivocado y el cero falso— precisamente porque
// nadie la había podido correr.
//
// CÓMO SE CONGELA EL RELOJ. `hoyLocalISO()` hace `new Date()`, y a `new Date()`
// no lo mueve pisar `Date.now` —son dos caminos distintos al reloj del
// sistema—. Así que se sustituye la clase `Date` entera por una cuyo
// constructor sin argumentos devuelve el instante fijado. Sin eso, el barrido
// de 24 horas de la §2 estaría midiendo la hora a la que se corrió la suite.

'use strict';

const { ZONA } = require('./reloj.cjs');
const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');

noArranco.vigilarExcepciones(__filename);

const PEDIDOS = [
  'plazoDeObra', 'frasePlazoRestante', 'finVigenteDe',
  'detectarRiesgos', 'BIBLIOTECA_RIESGOS',
  'velocidadSemanalGP', 'hoyLocalISO', 'fechaLocalDeISO', 'fechaEnZonaObra',
  'C', 'MXN',
];
const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan);

// El huso del proceso decide cómo `fechaLocalDeISO` construye sus medianoches,
// y de eso dependen los días que cuenta este banco. `reloj.cjs` lo fija; si
// aun así no cuajó, el banco no se puede creer sus propios números.
const ZONA_VIVA = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (ZONA_VIVA !== ZONA) {
  noArranco.sinPrecondicion(
    `el proceso corre en ${ZONA_VIVA} y este banco cuenta días en ${ZONA}`,
    ['Debería fijarlo `scripts/reloj.cjs` al cargarse. Si llegaste aquí, no lo hizo.']);
}

// ── EL RELOJ, SUSTITUIBLE ───────────────────────────────────────────────────
const DateReal = Date;
class DateFijo extends DateReal {
  constructor(...a) { super(...(a.length ? a : [DateFijo._ms])); }
  static now() { return DateFijo._ms; }
}
const conReloj = (ms, fn) => {
  DateFijo._ms = ms;
  globalThis.Date = DateFijo;
  try { return fn(); } finally { globalThis.Date = DateReal; }
};

// Un instante concreto del día, en la zona de la obra. El barrido de la §2
// recorre las 24 para que el número no pueda depender de la hora.
const HOY = '2026-11-06';
const aLas = (hora) =>
  DateReal.parse(`${HOY}T${String(hora).padStart(2, '0')}:30:00-06:00`);
const MEDIODIA = aLas(12);

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// Una obra mínima. `inicio` se da por separado porque uno de los defectos es
// justo que sin `inicio` el plazo no se podía contestar.
const obra = (fin, extra = {}) => ({
  id: '0199', nombre: 'de prueba', inicio: '2026-01-05', fin, ...extra,
});

// Contexto para `fin_006`: un Sheet de GP con cuatro semanas seguidas y una
// velocidad de quema alta, para que la regla tenga de qué hablar.
const contextoGP = (o, gastoPorSemana) => ({
  obra: o,
  kpis: {},
  gpData: {
    // Las claves de GP son `S40`, sin año: así las lee `_numeroDeSemanaGP`, y
    // `velocidadSemanalGP` exige que las cuatro sean SEGUIDAS.
    semanasDisponibles: ['S40', 'S41', 'S42', 'S43'],
    obras: {
      '0199': {
        id: '0199',
        grandTotal: gastoPorSemana * 4,
        semanas: {
          S40: gastoPorSemana, S41: gastoPorSemana,
          S42: gastoPorSemana, S43: gastoPorSemana,
        },
      },
    },
  },
});

function correr(fuente) {
  const A = construir(fuente);
  const fallos = [];
  const check = (ok, que, detalle = '') => {
    if (ok) { if (!process.env.CALLADO) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!process.env.CALLADO) console.log(`  FALLA ${que}\n        ${detalle}`);
  };

  // ══ §1 · EL NÚMERO SALE DE UNA SOLA CUENTA, CONTRA EL FIN VIGENTE ════════
  if (!process.env.CALLADO) console.log('\n§1 · una cuenta, y contra el fin vigente');

  // Las cuatro cifras de producción del 2026-11-06. Si estas cuatro salen,
  // la cuenta es la que se midió; si sale otra, cambió algo que nadie pidió.
  for (const [fin, semEsperadas] of [
    ['2026-12-24', 6], ['2027-02-24', 15], ['2027-12-07', 56],
  ]) {
    const p = conReloj(MEDIODIA, () => A.plazoDeObra(obra(fin)));
    check(p.semanasRestantes === semEsperadas,
      `fin ${fin} → ${semEsperadas} semanas, las que midió producción`,
      `dio ${p.semanasRestantes}`);
    check(p.vencidoDias === 0,
      `  y no está vencida`, `vencidoDias = ${p.vencidoDias}`);
  }

  // La 0112: fin 2026-10-02, 35 días atrás. Lo que importa no es el 35 sino
  // que NO sea 0: cero semanas es una medición que dice «se acaba hoy».
  const vencida = conReloj(MEDIODIA, () => A.plazoDeObra(obra('2026-10-02')));
  check(vencida.vencidoDias === 35,
    'un fin que ya pasó se cuenta como vencimiento: 35 días, no cero semanas',
    `vencidoDias = ${vencida.vencidoDias}`);
  check(vencida.semanasRestantes === 0,
    '  y las semanas restantes son 0, que es la verdad cuando ya venció',
    `semanasRestantes = ${vencida.semanasRestantes}`);

  // El fin del contrato NO es el vigente cuando hay ampliación. Ésta es la
  // aserción que separa las dos cuentas que había.
  const conAmpliacion = conReloj(MEDIODIA, () =>
    A.plazoDeObra(obra('2026-12-24', { finAmpliado: '2027-02-24' })));
  check(conAmpliacion.semanasRestantes === 15,
    'con ampliación el plazo se mide contra el fin AMPLIADO (15), no el del contrato (6)',
    `dio ${conAmpliacion.semanasRestantes}`);
  check(conAmpliacion.finVigente === '2027-02-24' && conAmpliacion.ampliado === true,
    '  y lo dice: el fin vigente es el ampliado',
    `finVigente = ${conAmpliacion.finVigente}`);

  // Una obra ampliada cuyo contrato ya venció pero su ampliación no. Es el
  // caso en que el defecto viejo mentía más fuerte: decía «vencida».
  const rescatada = conReloj(MEDIODIA, () =>
    A.plazoDeObra(obra('2026-10-02', { finAmpliado: '2026-12-24' })));
  check(rescatada.vencidoDias === 0 && rescatada.semanasRestantes === 6,
    'un contrato vencido con ampliación vigente NO está vencido: 6 semanas',
    `vencido ${rescatada.vencidoDias}d · ${rescatada.semanasRestantes} sem`);

  // Sin fin no hay plazo. Null, no cero: cero sería una medición.
  for (const [etiqueta, fin] of [
    ['ausente', undefined], ['vacío', ''], ['texto', 'ayer'],
    ['mes imposible', '2026-13-45'], ['ya impreso', '2/11/2026'],
  ]) {
    const p = conReloj(MEDIODIA, () => A.plazoDeObra(obra(fin)));
    check(p.semanasRestantes === null && p.vencidoDias === null,
      `un fin ${etiqueta} deja el plazo sin medir (null), no en cero`,
      `semanas ${p.semanasRestantes} · vencido ${p.vencidoDias}`);
  }

  // Sin `inicio` el plazo total no se puede saber, pero lo que FALTA sí. Antes
  // esta obra no tenía respuesta, porque la cuenta restaba dos tramos que
  // salían del inicio.
  const sinInicio = conReloj(MEDIODIA, () =>
    A.plazoDeObra({ id: '0199', fin: '2026-12-24' }));
  check(sinInicio.semanasRestantes === 6,
    'una obra sin `inicio` igual puede decir cuántas semanas le faltan',
    `dio ${sinInicio.semanasRestantes}`);
  check(sinInicio.totalDias === null,
    '  y sigue sin inventarse el plazo total, que ésa sí necesita el inicio',
    `totalDias = ${sinInicio.totalDias}`);

  // Las dos puntas de `plazoDeObra` no se contradicen: donde hay inicio,
  // `restantes` (días, topado) y `semanasRestantes` son la misma medición.
  for (const fin of ['2026-12-24', '2027-02-24', '2027-12-07']) {
    const p = conReloj(MEDIODIA, () => A.plazoDeObra(obra(fin)));
    check(Math.floor(p.restantes / 7) === p.semanasRestantes,
      `fin ${fin}: los días restantes y las semanas restantes son la misma cuenta`,
      `${p.restantes} días → ${Math.floor(p.restantes / 7)} sem, pero dice ${p.semanasRestantes}`);
  }

  // ══ §2 · LA HORA DEL DÍA NO MUEVE EL NÚMERO ══════════════════════════════
  if (!process.env.CALLADO) console.log('\n§2 · el reloj no mueve el número (barrido de 24 horas)');

  // Restar una fecha leída como UTC al instante real corre el resultado según
  // la hora. Dividir entre siete lo esconde casi siempre: hay que barrer el
  // día entero para que asome. Sin este barrido el banco sería una moneda —
  // verde a unas horas y rojo a otras— y «si falla y luego pasa, no quedó».
  for (const [fin, esperado] of [
    ['2026-12-24', 6], ['2027-02-24', 15], ['2026-11-13', 1], ['2026-11-12', 0],
  ]) {
    const vistas = new Set();
    const frases = new Set();
    for (let h = 0; h < 24; h++) {
      conReloj(aLas(h), () => {
        vistas.add(A.plazoDeObra(obra(fin)).semanasRestantes);
        frases.add(A.frasePlazoRestante(obra(fin)));
      });
    }
    check(vistas.size === 1 && vistas.has(esperado),
      `fin ${fin}: las 24 horas del día dan ${esperado} semanas y no otra cosa`,
      `salieron ${[...vistas].join(', ')}`);
    check(frases.size === 1,
      `  y la frase impresa es la misma a toda hora`,
      `${frases.size} frases distintas: ${[...frases].join(' | ')}`);
  }

  // El vencimiento tampoco se mueve, y el día del propio fin no está vencido.
  const hoyEsElFin = new Set();
  for (let h = 0; h < 24; h++) {
    hoyEsElFin.add(conReloj(aLas(h), () => A.frasePlazoRestante(obra(HOY))));
  }
  check(hoyEsElFin.size === 1 && !/venció/.test([...hoyEsElFin][0]),
    'la obra que termina HOY no está vencida a ninguna hora del día',
    [...hoyEsElFin].join(' | '));

  const vencioAyer = new Set();
  for (let h = 0; h < 24; h++) {
    vencioAyer.add(conReloj(aLas(h), () => A.frasePlazoRestante(obra('2026-11-05'))));
  }
  check(vencioAyer.size === 1 && [...vencioAyer][0] === 'el plazo contractual venció hace 1 día',
    'la que venció ayer dice «hace 1 día» a toda hora, en singular',
    [...vencioAyer].join(' | '));

  // ══ §3 · LA FRASE PUBLICA LO MEDIDO, O SE CALLA ══════════════════════════
  if (!process.env.CALLADO) console.log('\n§3 · lo que sale impreso');

  const frase = (fin, extra) => conReloj(MEDIODIA, () => A.frasePlazoRestante(obra(fin, extra)));

  check(frase('2026-12-24') === 'quedan 6 semanas de plazo contractual',
    'en plazo imprime las semanas que se midieron', `«${frase('2026-12-24')}»`);
  check(frase('2026-10-02') === 'el plazo contractual venció hace 35 días',
    'vencida dice que venció, y cuánto', `«${frase('2026-10-02')}»`);
  check(!/quedan 0/.test(frase('2026-10-02')),
    '  y NO dice «quedan 0 semanas», que era afirmar que se acaba hoy',
    `«${frase('2026-10-02')}»`);
  check(frase('2026-11-13') === 'quedan 1 semana de plazo contractual',
    'una sola semana se dice en singular', `«${frase('2026-11-13')}»`);
  check(frase('2026-12-24', { finAmpliado: '2027-02-24' }) === 'quedan 15 semanas de plazo contractual',
    'la frase respeta la ampliación', `«${frase('2026-12-24', { finAmpliado: '2027-02-24' })}»`);

  // Callarse es una conducta, y es la correcta cuando no hay con qué medir.
  // La alternativa que había —«quedan 0 semanas»— no es callarse.
  for (const [etiqueta, fin] of [
    ['ausente', undefined], ['vacío', ''], ['texto', 'ayer'], ['ya impreso', '2/11/2026'],
  ]) {
    check(frase(fin) === null,
      `con el fin ${etiqueta} la tarjeta se calla (null), no publica un cero`,
      `«${frase(fin)}»`);
  }

  // Ninguna frase publicable puede traer la basura de una cuenta que falló.
  for (const fin of ['2026-12-24', '2026-10-02', '2026-11-13', HOY, '2027-12-07']) {
    const f = frase(fin) || '';
    check(!/NaN|Invalid|undefined|null/.test(f),
      `fin ${fin}: la frase impresa no arrastra NaN ni Invalid Date`, `«${f}»`);
  }

  // ══ §4 · LA REGLA Y LA TARJETA NO SE CONTRADICEN ═════════════════════════
  if (!process.env.CALLADO) console.log('\n§4 · `fin_006` lee el mismo plazo que la tarjeta');

  const riesgos = (o, gasto) =>
    conReloj(MEDIODIA, () => A.detectarRiesgos(contextoGP(o, gasto)));
  const de = (lista, id) => lista.find(r => r.id === id) || null;

  // Presupuesto chico y quema alta: la regla tiene que disparar, y su `extra`
  // tiene que publicar LA MISMA cifra que la tarjeta. Ésta es la aserción de
  // «una cuenta por número»: si discrepan, la obra tiene dos plazos.
  const enPlazo = obra('2027-02-24', { presupuesto: 5_000_000 });
  const r1 = de(riesgos(enPlazo, 400_000), 'fin_006');
  check(r1 !== null, '`fin_006` dispara con el presupuesto agotándose antes del fin',
    'no disparó');
  const mExtra = /(\d+) sem de plazo|Plazo: (\d+) sem/.exec(r1?.extra || '');
  check(mExtra !== null,
    '  y publica un número entero de semanas de plazo', `«${r1?.extra}»`);
  const semDeLaRegla = mExtra && Number(mExtra[1] ?? mExtra[2]);
  const semDeLaTarjeta = /quedan (\d+) semana/.exec(frase('2027-02-24'))?.[1];
  check(mExtra !== null && String(semDeLaRegla) === semDeLaTarjeta,
    '  y es LA MISMA que imprime la tarjeta de la misma obra',
    `la regla dice ${semDeLaRegla} · la tarjeta dice ${semDeLaTarjeta}`);

  // Vencida: `fin_006` se calla, porque su premisa —«se agota ANTES del fin»—
  // ya no se puede evaluar. Esto es una CARACTERIZACIÓN, no el mérito de una
  // guarda: se calla porque `semanasRestantes` es 0 y `semsAgotar` al menos 1.
  // Se escribió la guarda explícita y se quitó al ver que su mutación no podía
  // salir en rojo. Lo que la aserción defiende es que la obra vencida no
  // aparezca con una cifra de plazo —el renglón de abajo— y que de ella hable
  // quien le toca.
  const yaVencida = obra('2026-10-02', { presupuesto: 5_000_000 });
  const lista2 = riesgos(yaVencida, 400_000);
  check(de(lista2, 'fin_006') === null,
    'con el plazo vencido `fin_006` se calla: su premisa habla del antes del fin',
    `disparó con «${de(lista2, 'fin_006')?.extra}»`);
  check(de(lista2, 'plz_001') !== null,
    '  y de esa obra habla `plz_001`, que sí es la del vencimiento',
    'plz_001 no disparó');
  check(!/0 sem/.test(JSON.stringify(lista2)),
    '  y ninguna excepción de esa obra publica «0 sem» de plazo',
    JSON.stringify(lista2).slice(0, 160));

  // La ampliación mueve a `fin_006` igual que mueve a `plz_002`. Antes no: la
  // regla medía contra el contrato y `plz_002` contra el vigente.
  const ampliada = obra('2026-11-20', { finAmpliado: '2027-02-24', presupuesto: 5_000_000 });
  const lista3 = riesgos(ampliada, 400_000);
  const r3 = de(lista3, 'fin_006');
  const sem3 = r3 && Number(/(\d+) sem de plazo|Plazo: (\d+) sem/.exec(r3.extra || '')?.[1]
    ?? /(\d+) sem de plazo|Plazo: (\d+) sem/.exec(r3.extra || '')?.[2]);
  check(r3 !== null && sem3 === 15,
    '`fin_006` cuenta el plazo de la obra ampliada contra el fin ampliado (15 sem)',
    `publicó «${r3?.extra}»`);
  check(de(lista3, 'plz_002') === null && de(lista3, 'plz_001') === null,
    '  y la obra ampliada ya no sale ni vencida ni por vencer',
    `plz_001 ${!!de(lista3, 'plz_001')} · plz_002 ${!!de(lista3, 'plz_002')}`);

  // Y la regla tampoco puede depender de la hora.
  const disparos = new Set();
  for (let h = 0; h < 24; h++) {
    const l = conReloj(aLas(h), () => A.detectarRiesgos(contextoGP(enPlazo, 400_000)));
    disparos.add(de(l, 'fin_006')?.extra ?? '(callada)');
  }
  check(disparos.size === 1,
    '`fin_006` publica lo mismo a las 24 horas del día',
    `${disparos.size} resultados distintos: ${[...disparos].join(' | ')}`);

  return fallos;
}

// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Cada mutación es un defecto que de verdad estuvo en el archivo, o el paso
// exacto que lo habría dejado volver.
const MUTACIONES = [
  ['el plazo vuelve a medirse contra el fin del CONTRATO, no el vigente',
    '  const alFin = dias(hoyISO, finVigente);',
    '  const alFin = dias(hoyISO, obra?.fin);'],
  ['el plazo vuelve a restar una fecha UTC al instante del aparato',
    '  const alFin = dias(hoyISO, finVigente);',
    '  const alFin = finVigente ? Math.floor((new Date(finVigente) - new Date()) / 86400000) : null;'],
  ['el vencimiento desaparece y un plazo vencido vuelve a ser cero semanas',
    '  const vencidoDias = alFin == null ? null : Math.max(-alFin, 0);',
    '  const vencidoDias = alFin == null ? null : 0;'],
  ['el vencimiento cambia de signo',
    '  const vencidoDias = alFin == null ? null : Math.max(-alFin, 0);',
    '  const vencidoDias = alFin == null ? null : Math.max(alFin, 0);'],
  ['las semanas se redondean en vez de truncarse: seis días pasan por semana',
    '  const semanasRestantes = alFin == null ? null : Math.max(Math.floor(alFin / 7), 0);',
    '  const semanasRestantes = alFin == null ? null : Math.max(Math.round(alFin / 7), 0);'],
  ['la tarjeta vuelve a decir «quedan 0 semanas» de una obra vencida',
    `  if (vencidoDias > 0) {
    return \`el plazo contractual venció hace \${vencidoDias} día\${vencidoDias === 1 ? '' : 's'}\`;
  }`, ''],
  ['la tarjeta deja de callarse cuando no hay fin con el que medir',
    '  if (semanasRestantes == null) return null;',
    '  if (semanasRestantes == null) return `quedan 0 semanas de plazo contractual`;'],
  ['`fin_006` vuelve a contar el plazo por su cuenta',
    '      const { semanasRestantes: semsPlazo } = plazoDeObra(obra);',
    '      const semsPlazo = Math.max(Math.floor((new Date(obra.fin) - new Date())/(86400000*7)), 0);'],
];

// LO QUE NO ESTÁ EN LA LISTA, Y POR QUÉ. Se intentó una novena: quitarle a
// `fin_006` una guarda contra el plazo vencido. Sobrevivió, y al perseguir por
// qué resultó que la guarda no cambiaba ninguna salida —con el plazo vencido
// `semanasRestantes` es 0 y `semsAgotar` es al menos 1, así que ninguna de las
// dos comparaciones de la regla puede ser cierta—. La respuesta no fue
// inventarle una aserción a la guarda: fue borrar la guarda. Una mutación que
// no se puede poner en rojo está señalando código que no hace nada.

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
    catch (e) { fallos = [`revienta: ${e.message}`]; }
    delete process.env.CALLADO;
    globalThis.Date = DateReal;
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

console.log('EL PLAZO SE CUENTA UNA VEZ · #17');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
