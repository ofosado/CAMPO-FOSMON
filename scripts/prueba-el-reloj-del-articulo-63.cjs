#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL RELOJ DEL ART. 63, Y LAS TRES REGLAS QUE DECÍAN «SIN HALLAZGO» SIN MIRAR
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. La Ley 233 de Obras Públicas del Estado de Veracruz da
// al Ente Público VEINTE DÍAS NATURALES para pagar una estimación autorizada,
// y pasado el plazo corren gastos financieros a su cargo (art. 63). Al cruzar
// la ley contra el código salieron tres defectos encadenados, y los tres
// fallaban hacia el mismo lado: el tranquilizador.
//
//   1. EL PLAZO ERA DE TREINTA. El único plazo de pago que la aplicación
//      conocía era `obra.diasPago || 30`, que es el del CONTRATO del
//      contratista. Los diez días de diferencia son exactamente el tramo en
//      que el municipio ya debe gastos financieros mientras la pantalla lo
//      pinta dentro de plazo. Y del lado dependencia el campo `diasPago` ni
//      se captura: el alta no lo ofrece, a propósito.
//
//   2. `fin_003` NO PODÍA DISPARAR NUNCA DEL LADO DEPENDENCIA. Exige
//      `estatus === "Facturada"`, que es vocabulario de la constructora; los
//      cuatro estados de la ventanilla son Recibida · En revisión ·
//      Autorizada · Pagada. O sea que el municipio podía llevar meses sin
//      pagar y el informe del art. 73 que archiva imprimía «Estimaciones
//      atrasadas en cobro — revisada sin hallazgo». En un expediente eso no
//      es un silencio: es una afirmación, y era falsa. `fin_004` tenía el
//      mismo defecto por otro camino (`esEstimacionPorCobrar` son los mismos
//      estatus del otro lado) y `ctr_001` el defecto en espejo: pedía para
//      siempre capturar un `diasPago` que esa pantalla no puede dar.
//
//   3. NO HABÍA FRONTERA DEL OTRO LADO. La lista de riesgos vedados era de un
//      solo sentido, así que la regla nueva —que mide la obligación de pago
//      del Ente— saldría en el informe interno del contratista como «revisada
//      sin hallazgo» en todas sus obras, para siempre, porque ninguna de sus
//      estimaciones puede estar «Autorizada». Arreglar el patrón en un solo
//      sentido es dejarlo puesto.
//
// LO QUE SE AFIRMA ES CONDUCTA: el color y el texto de la pastilla de cada
// renglón, qué publica la tarjeta de riesgo, y en cuál de los cuatro estados
// del veredicto cae cada regla —que es lo que decide lo que el papel imprime—.
// El código se extrae de `src/App.jsx` y se EJECUTA; de los nombres sólo se usa
// la dirección para llegar.
//
// LOS NÚMEROS ESPERADOS NO SE COPIAN DEL CÓDIGO, con UNA excepción declarada:
// el 20 del art. 63. Ése no se saca de `PLAZO_PAGO_LEY_233` a propósito —sería
// comprobar la constante contra sí misma— sino que se teclea aquí como lo que
// es, el dato externo que manda, y se afirma contra la CONDUCTA: a los 20 días
// no se debe nada y a los 21 se debe un día. Si alguien vuelve a poner 30, esto
// muerde. Todo lo demás se obtiene ejecutando la cuenta del repositorio.
//
// EL DÍA DE HOY SE ANCLA UNA VEZ. El reloj abierto —una estimación autorizada
// que nadie paga— cuenta contra hoy, y hoy lo resuelve `hoyLocalISO()` en el
// calendario de la obra. Un banco que lo preguntara dos veces podría cruzar la
// medianoche de Ciudad de México a mitad de la corrida y mover un veredicto por
// un día. Se pregunta al entrar, se construye todo contra ese día, y al salir
// se comprueba que no cambió: si cambió, el banco sale 2 —no pudo mirar—, que
// es lo único honesto. Nunca rojo por la hora a la que se corrió.
//
// Uso:  node scripts/prueba-el-reloj-del-articulo-63.cjs
//       node scripts/prueba-el-reloj-del-articulo-63.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const noArranco = require('./no-arranco.cjs');
const contraprueba = require('./contraprueba.cjs');
const { fuenteDeApp } = require('./extraer-de-app.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

// EL 20 DEL ART. 63, el único número tecleado de este banco. Ver la cabecera.
const DIAS_DE_LEY = 20;

const PEDIDOS = [
  'relojDePagoDependencia', 'hoyLocalISO',
  'evaluarRiesgos', 'riesgosDeDependencia', 'BIBLIOTECA_RIESGOS',
  'RIESGOS_SOLO_CONSTRUCTORA', 'RIESGOS_SOLO_DEPENDENCIA',
  'ESTATUS_ESTIMACION_DEPENDENCIA', 'ESTATUS', 'C', 'MXN',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan);

const construir = (fuente) => new Function(
  `"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── El calendario del banco ────────────────────────────────────────────────
//
// Las fechas se construyen por partes y se imprimen por partes: `new
// Date('2026-11-06')` es medianoche UTC y al oeste de Greenwich pinta el día
// anterior, que es un día de más o de menos en un plazo de pago — el defecto
// que `prueba-la-fecha-se-mide-una-vez` ya tuvo que poner en rojo.
const diaISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  + `-${String(d.getDate()).padStart(2, '0')}`;
const sumarDias = (iso, k) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  d.setDate(d.getDate() + k);
  return diaISO(d);
};

function correr(fuente) {
  const fn = construir(fuente);
  const { C } = fn;
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const seccion = (t) => { if (!process.env.CALLADO) console.log(`\n ${t}`); };

  const NOMBRE_COLOR = new Map([[C.green, 'verde'], [C.yellow, 'ámbar'],
    [C.red, 'rojo'], [C.blue, 'azul'], [C.textMut, 'gris']]);
  const comoSeVe = (r) => r === null ? '(sin pastilla)'
    : `${NOMBRE_COLOR.get(r.color) || `(otro: ${r.color})`} «${r.texto}»`;

  // Hoy, preguntado UNA vez y en el calendario de la obra.
  const HOY = fn.hoyLocalISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(HOY))) {
    noArranco.sinPrecondicion(
      `«hoy» en el calendario de la obra salió «${HOY}» y no una fecha AAAA-MM-DD`,
      ['revisar `hoyLocalISO` y `fechaEnZonaObra` en src/App.jsx']);
  }
  const haceDias = (k) => sumarDias(HOY, -k);

  // Los cuatro estados del trámite, tomados de la lista viva y no tecleados:
  // si alguien renombra un paso, el banco ejercita el nombre nuevo.
  const [RECIBIDA, EN_REVISION, AUTORIZADA, PAGADA] = fn.ESTATUS_ESTIMACION_DEPENDENCIA;

  // ── 1 · LA PASTILLA DEL PLAZO: QUÉ DICE Y DE QUÉ COLOR ────────────────────
  //
  // Con fechas explícitas en los dos extremos, así que esta sección no depende
  // de qué día se corra ni de la hora.
  seccion('1 · el reloj del art. 63, renglón por renglón');

  const AUT = '2026-04-01';
  const autorizada = (k) => fn.relojDePagoDependencia(
    { no: 1, monto: 100, estatus: AUTORIZADA, fechaAutorizacion: AUT },
    sumarDias(AUT, k));

  // En ventanilla o en revisión no se debe nada: el residente no la ha
  // autorizado (art. 62 párr. 3) y el plazo no ha arrancado. `null` es «no hay
  // reloj», que NO es «no se pudo medir».
  for (const est of [RECIBIDA, EN_REVISION]) {
    const r = fn.relojDePagoDependencia(
      { no: 1, monto: 100, estatus: est, fechaAutorizacion: AUT }, sumarDias(AUT, 90));
    check(r === null,
      `una estimación «${est}» no tiene plazo corriendo, ni a los 90 días`,
      comoSeVe(r));
  }

  // LA FRONTERA DE LA LEY, dicha en voz alta. Es la aserción que mata el
  // `|| 30`: con treinta, el día 21 saldría tranquilo.
  const vispera = autorizada(DIAS_DE_LEY - 1);
  const elDia   = autorizada(DIAS_DE_LEY);
  const alDia   = autorizada(DIAS_DE_LEY + 1);
  check(vispera.medible && vispera.color !== C.red,
    `al día ${DIAS_DE_LEY - 1} todavía no se debe nada`, comoSeVe(vispera));
  check(elDia.medible && elDia.excedido === 0 && elDia.color !== C.red,
    `el día ${DIAS_DE_LEY} es el último del plazo y tampoco está vencido`, comoSeVe(elDia));
  check(alDia.medible && alDia.color === C.red && alDia.excedido === 1,
    `al día ${DIAS_DE_LEY + 1} está vencido por un día`, comoSeVe(alDia));

  // El primer día rojo, BUSCADO y no supuesto: así la frontera no puede
  // moverse sin que esto lo diga, ni siquiera por un redondeo.
  const primerRojo = (() => {
    for (let k = 0; k <= 120; k++) if (autorizada(k).color === C.red) return k;
    return null;
  })();
  check(primerRojo === DIAS_DE_LEY + 1,
    `el primer día en rojo es el ${DIAS_DE_LEY + 1}, o sea que el plazo es de ${DIAS_DE_LEY} días naturales`,
    `salió en el ${primerRojo}`);

  // Y QUE EL PLAZO NO LO PONE EL CONTRATO. El mismo renglón, con una obra que
  // pactó 60 días de pago, se vence igual: a la dependencia la obliga la ley.
  // La obra viaja en el contexto del motor, que es por donde entraría.
  const alDiaConContratoLargo = fn.relojDePagoDependencia(
    { no: 1, monto: 100, estatus: AUTORIZADA, fechaAutorizacion: AUT, diasPago: 60 },
    sumarDias(AUT, DIAS_DE_LEY + 1));
  check(alDiaConContratoLargo.color === C.red,
    'el plazo sale de la ley y no del contrato: con 60 días pactados se vence igual al día 21',
    comoSeVe(alDiaConContratoLargo));

  // El aviso antes de vencer, que es para lo que sirve la columna: se ve venir.
  const ambar = [DIAS_DE_LEY - 5, DIAS_DE_LEY - 1, DIAS_DE_LEY].map(autorizada);
  check(ambar.every(r => r.color === C.yellow),
    'los últimos días del plazo salen en ámbar, antes de que se venza',
    ambar.map(comoSeVe).join(' · '));
  const holgada = autorizada(2);
  check(holgada.color !== C.yellow && holgada.color !== C.red,
    'y con el plazo entero por delante no hay ámbar que gastar', comoSeVe(holgada));

  // Ningún rótulo publica un número negativo: «-7 d sobre el plazo» se lee al
  // revés de lo que pasa.
  const barrido = [];
  for (let k = 0; k <= 60; k++) barrido.push(autorizada(k));
  check(!barrido.some(r => /-\d/.test(r.texto)),
    'ninguna pastilla del plazo publica un número negativo',
    `${barrido.length} días barridos`);
  check(barrido.every(r => r.medible && r.dias === barrido.indexOf(r)),
    'y cada una lleva sus días junto al rótulo, para que nadie los saque de la letra');

  // ── 2 · PAGADA: UN CASO CERRADO, Y DICE SI SE PAGÓ EN PLAZO ───────────────
  seccion('2 · la que ya se pagó');

  const pagada = (kAut, kPago) => fn.relojDePagoDependencia({
    no: 2, monto: 100, estatus: PAGADA,
    fechaAutorizacion: AUT, fechaPago: sumarDias(AUT, kPago),
  }, sumarDias(AUT, 999));   // el día de hoy no interviene: el caso está cerrado

  const aTiempo = pagada(0, DIAS_DE_LEY);
  const tarde   = pagada(0, DIAS_DE_LEY + 14);
  check(aTiempo.medible && aTiempo.color === C.green && aTiempo.excedido === 0,
    `pagada el día ${DIAS_DE_LEY} se pagó en plazo`, comoSeVe(aTiempo));
  check(tarde.medible && tarde.color === C.red && tarde.excedido === 14,
    'pagada dos semanas después del plazo lo dice, con sus días',
    `${comoSeVe(tarde)} · excedido ${tarde.excedido}`);
  // Y no se mide contra hoy: una pagada hace un año no empeora con el tiempo.
  check(pagada(0, 5).texto === aTiempo.texto.replace(String(DIAS_DE_LEY), '5'),
    'el número de una pagada es de la autorización al pago, no contra hoy',
    comoSeVe(pagada(0, 5)));

  // ── 3 · LO QUE NO SE PUEDE MEDIR SE DICE, Y NO SE PINTA DE VERDE ──────────
  //
  // Es el corazón del lote: un hueco y un «todo bien» no se pueden parecer.
  seccion('3 · los huecos, dichos con letra');

  const ciegas = [
    [{ no: 3, monto: 100, estatus: AUTORIZADA },                       'autorizada sin fecha de autorización'],
    [{ no: 4, monto: 100, estatus: AUTORIZADA, fechaAutorizacion: '' }, 'autorizada con la fecha vacía'],
    [{ no: 5, monto: 100, estatus: PAGADA, fechaAutorizacion: AUT },    'pagada sin fecha de pago'],
    [{ no: 6, monto: 100, estatus: PAGADA, fechaPago: AUT },            'pagada sin fecha de autorización'],
    // Captura imposible: el pago antes de autorizar, o la autorización en el
    // futuro. En un expediente que se conserva cinco años (art. 74) eso hay
    // que decirlo; con «pagada en -5 d» el renglón pasaría por bueno.
    [{ no: 7, monto: 100, estatus: PAGADA, fechaAutorizacion: AUT,
       fechaPago: sumarDias(AUT, -5) },                                 'pagada antes de autorizarse'],
    [{ no: 8, monto: 100, estatus: AUTORIZADA,
       fechaAutorizacion: sumarDias(HOY, 30) },                         'autorizada con fecha futura'],
  ];
  for (const [e, titulo] of ciegas) {
    const r = fn.relojDePagoDependencia(e);
    check(r !== null && r.medible === false
          && r.color !== C.green && r.excedido === null
          && !/^-?\d/.test(r.texto),
      `${titulo}: hay plazo corriendo y NO se puede medir, y lo dice`, comoSeVe(r));
    check(r !== null && typeof r.sub === 'string' && r.sub.length > 20,
      `   y explica qué fecha falta, no sólo que falta`, r?.sub);
  }

  // ── 4 · UNA CUENTA POR NÚMERO: LA PASTILLA Y LA TARJETA DE RIESGO ─────────
  //
  // Aquí el reloj corre contra HOY, porque es lo que hace en producción: la
  // regla llama al reloj sin decirle qué día es. Las fechas se construyen
  // relativas a `HOY`, anclado arriba.
  seccion('4 · la tarjeta `ctr_003` y la pastilla cuentan lo mismo');

  const OBRA_DEP = { id: '0131', nombre: 'colector', presupuesto: 10000000 };
  const ctxDep = (estimaciones) => ({
    tipo: 'dependencia', obra: OBRA_DEP, subs: [], estimaciones,
    historialAvance: [], kpis: { af: 50, me: 100 }, programa: null,
  });
  const tarjeta = (estimaciones, id) =>
    fn.evaluarRiesgos(ctxDep(estimaciones)).detectados.find(r => r.id === id) || null;
  const aut = (no, k, monto) => ({ no, monto, estatus: AUTORIZADA, fechaAutorizacion: haceDias(k) });

  const desacuerdos = [];
  for (let k = 0; k <= 60; k++) {
    const e = aut(1, k, 1000);
    const rojo = fn.relojDePagoDependencia(e)?.color === C.red;
    const dispara = (tarjeta([e], 'ctr_003')?.severidad || null) !== null;
    if (rojo !== dispara) desacuerdos.push(`${k} d: pastilla ${rojo ? 'roja' : 'no roja'} · tarjeta ${dispara ? 'dispara' : 'calla'}`);
  }
  check(desacuerdos.length === 0,
    'la tarjeta dispara exactamente cuando la pastilla del renglón está en rojo',
    desacuerdos.length ? `${desacuerdos.length} desacuerdos; p.ej. ${desacuerdos[0]}`
                       : '61 antigüedades, 0 desacuerdos');

  // El monto y el peor atraso que publica son los de la cuenta, no propios.
  const CARTERA = [aut(1, 45, 500000), aut(2, 33, 300000), aut(3, 5, 200000)];
  const t = tarjeta(CARTERA, 'ctr_003');
  const relojes = CARTERA.map(e => fn.relojDePagoDependencia(e));
  const rojas = relojes.filter(r => r.color === C.red);
  check(t !== null && Number(t.valor) === rojas.length,
    'cuenta las vencidas que la pastilla pinta en rojo, ni una más',
    `publica ${t?.valor} · en rojo ${rojas.length} de ${CARTERA.length}`);
  const esperadoMonto = fn.MXN(CARTERA
    .filter((_, i) => relojes[i].color === C.red)
    .reduce((s, e) => s + e.monto, 0));
  check(t !== null && t.detalle.includes(esperadoMonto),
    'y publica la suma de ESAS, no la de la relación completa',
    `«${t?.detalle}» · esperado ${esperadoMonto}`);
  const mPeor = /Hasta (-?\d+) d sobre/.exec(t?.extra || '');
  check(mPeor !== null,
    'el peor atraso sale como un número entero de días, no un NaN', `«${t?.extra}»`);
  check(mPeor !== null && Number(mPeor[1]) === Math.max(...rojas.map(r => r.excedido)),
    'y es el que da el reloj', `publica ${mPeor?.[1]}`);

  // DOS INCUMPLIMIENTOS DISTINTOS NO SE SUMAN EN UN SOLO PESO. Lo encontró el
  // preview: la tarjeta publicaba «$5,200,000 con el plazo del art. 63
  // vencido» cuando $3.1 M de esos eran de una estimación que el municipio YA
  // PAGÓ, nueve días tarde. Las dos son faltas a la ley, pero una es deuda
  // viva y la otra historia cerrada, y el número que decide si se paga hoy es
  // el de la deuda viva. Las cifras esperadas salen de los montos de la
  // relación, no del código.
  const pag = (no, kAut, kPago, monto) => ({
    no, monto, estatus: PAGADA,
    fechaAutorizacion: haceDias(kAut), fechaPago: haceDias(kPago),
  });

  const VIVA = aut(2, 41, 2100000);
  const CERRADA = pag(1, 50, 21, 3100000);          // 29 días: 9 sobre el plazo
  const tMezcla = tarjeta([CERRADA, VIVA], 'ctr_003');
  check(tMezcla !== null && tMezcla.detalle.includes(fn.MXN(VIVA.monto)),
    'con una vencida sin pagar y otra ya pagada tarde, el monto es el de la deuda VIVA',
    `«${tMezcla?.detalle}»`);
  check(tMezcla !== null
        && !tMezcla.detalle.includes(fn.MXN(VIVA.monto + CERRADA.monto)),
    'y nunca el de las dos sumadas: ese peso no se le debe a nadie',
    `no debe decir ${fn.MXN(VIVA.monto + CERRADA.monto)}`);
  check(tMezcla !== null && Number(tMezcla.valor) === 1,
    'el contador también es el de la deuda viva, no el de las dos faltas',
    `publica ${tMezcla?.valor}`);
  check(tMezcla !== null && /ya pagada/.test(tMezcla.extra || ''),
    'y la ya pagada fuera de plazo no se borra: va dicha como contexto',
    `«${tMezcla?.extra}»`);

  // Y SI YA SE PAGARON TODAS TARDE, la tarjeta sigue saliendo —el plazo se
  // incumplió y eso se archiva— pero sin llamar «sin pagar» a un dinero que sí
  // se pagó, y sin gravedad de deuda corriente.
  const tCerrada = tarjeta([CERRADA], 'ctr_003');
  check(tCerrada !== null && /se pagó fuera/.test(tCerrada.detalle)
        && !/sin pagar/.test(tCerrada.detalle),
    'pagadas todas fuera de plazo: la falta se reporta, pero no como deuda',
    `«${tCerrada?.detalle}»`);
  check(tCerrada !== null && !['critico', 'alto'].includes(tCerrada.severidad),
    'y no se pinta con la gravedad de un plazo que todavía corre',
    `severidad ${tCerrada?.severidad}`);

  // La gravedad la pone la deuda viva, no la peor falta de la historia: una
  // estimación pagada tardísimo hace meses no puede pintar de crítica una obra
  // que hoy debe tres días.
  const tFresca = tarjeta([pag(1, 230, 30, 100000), aut(2, 23, 100000)], 'ctr_003');
  check(tFresca !== null && tFresca.severidad === 'medio',
    'una falta cerrada hace meses no agrava una deuda de tres días',
    `severidad ${tFresca?.severidad} · «${tFresca?.extra}»`);

  // LAS CIEGAS NO SE DESCUENTAN EN SILENCIO. Tres autorizadas sin fecha y
  // ninguna vencida no es «sin hallazgo»: es «no se sabe».
  const MIXTA = [aut(1, 5, 100000),
    { no: 2, monto: 900000, estatus: AUTORIZADA },
    { no: 3, monto: 800000, estatus: PAGADA, fechaAutorizacion: haceDias(40) }];
  const tMixta = tarjeta(MIXTA, 'ctr_003');
  check(tMixta !== null,
    'con estimaciones que no se pueden medir la tarjeta aparece, en vez de callar',
    tMixta ? `${tMixta.severidad} · «${tMixta.detalle}»` : 'calló');
  check(tMixta !== null && /\b2\b/.test(tMixta.valor + ' ' + tMixta.extra),
    'y dice CUÁNTAS no se pudieron medir',
    `${tMixta?.valor} · «${tMixta?.extra}»`);

  // Y cuando NINGUNA se puede medir, el hueco sale por la puerta de los
  // huecos —con el dato que hay que pedir— y no por la de los hallazgos. Así
  // el mismo hecho no se cuenta dos veces.
  const vNada = fn.evaluarRiesgos(ctxDep([
    { no: 1, monto: 100, estatus: AUTORIZADA },
    { no: 2, monto: 100, estatus: PAGADA }]));
  const hueco = vNada.noEvaluables.find(r => r.id === 'ctr_003');
  check(!!hueco && !vNada.sinHallazgo.some(r => r.id === 'ctr_003')
        && !vNada.detectados.some(r => r.id === 'ctr_003'),
    'sin una sola fecha, el plazo de ley sale como hueco y NUNCA como «sin hallazgo»',
    hueco ? 'en noEvaluables' : 'no está en noEvaluables');
  check(!!hueco && hueco.faltan.some(f => /autorizaci/i.test(f.porQue || '')),
    'y el hueco nombra el dato que hay que pedir',
    hueco?.faltan?.map(f => f.porQue).join(' | '));
  // Una relación VACÍA y una SIN FECHAS son dos huecos distintos, y el motivo
  // lo dice: «no hay estimaciones» no se arregla capturando fechas.
  const huecoVacio = fn.evaluarRiesgos(ctxDep([])).noEvaluables.find(r => r.id === 'ctr_003');
  check(!!huecoVacio
        && huecoVacio.faltan[0].porQue !== hueco?.faltan?.[0]?.porQue,
    'sin estimaciones el motivo es otro: no se pide una fecha que no tiene dónde ir',
    huecoVacio?.faltan?.[0]?.porQue);

  // ── 5 · LAS TRES REGLAS QUE DECÍAN «SIN HALLAZGO» SIN PODER MIRAR ─────────
  //
  // Lo que el papel imprime sale del veredicto, y `sinHallazgo` se imprime
  // como «revisada sin hallazgo». Que una regla que no puede disparar esté
  // ahí es lo que hacía mentir al expediente.
  seccion('5 · ninguna regla del otro vocabulario se pinta de tranquila');

  // Una relación de dependencia REALISTA Y MOROSA: todo recibido, nada pagado,
  // una autorizada hace mucho. Si el municipio debe, el papel no puede estar
  // tranquilo.
  const MOROSA = [
    { no: 1, monto: 4000000, estatus: AUTORIZADA, fechaAutorizacion: haceDias(70),
      periodoFin: haceDias(90), fechaRecepcion: haceDias(80) },
    { no: 2, monto: 3000000, estatus: EN_REVISION, periodoFin: haceDias(60),
      fechaRecepcion: haceDias(50) },
    { no: 3, monto: 2000000, estatus: RECIBIDA, periodoFin: haceDias(30),
      fechaRecepcion: haceDias(20) },
  ];
  const vMorosa = fn.evaluarRiesgos(ctxDep(MOROSA));
  const donde = (id) => vMorosa.detectados.some(r => r.id === id) ? 'detectados'
    : vMorosa.sinHallazgo.some(r => r.id === id) ? 'sinHallazgo'
    : vMorosa.noEvaluables.some(r => r.id === id) ? 'noEvaluables'
    : vMorosa.reventaron.some(r => r.id === id) ? 'reventaron' : 'fuera';

  for (const id of ['fin_003', 'fin_004', 'ctr_001']) {
    check(donde(id) === 'fuera',
      `\`${id}\` no llega al veredicto de una dependencia: su cuenta es del otro mostrador`,
      `está en ${donde(id)}`);
  }
  check(donde('ctr_003') === 'detectados',
    'y en su lugar el plazo del art. 63 SÍ dispara con una autorizada de hace 70 días',
    `está en ${donde('ctr_003')}`);
  // La frase literal que el papel imprimía. Se busca por el título, que es lo
  // que se lee en la hoja, y no por el id.
  const tranquilas = vMorosa.sinHallazgo.map(r => r.titulo);
  check(!tranquilas.some(t => /atrasad|por cobrar|días de pago/i.test(t)),
    'con el municipio debiendo $9 M, el papel no declara «revisada sin hallazgo» de cobranza',
    tranquilas.length ? `revisadas sin hallazgo: ${tranquilas.join(' · ')}` : 'ninguna');
  // Y sobre todo: que el dinero debido salga nombrado en alguna parte del
  // veredicto. Un veredicto sin una sola mención del atraso sería el defecto
  // con otra forma.
  const vencida = vMorosa.detectados.find(r => r.id === 'ctr_003');
  check(!!vencida && vencida.detalle.includes(fn.MXN(4000000)),
    'el monto que el municipio debe fuera de plazo sale impreso, al peso',
    `«${vencida?.detalle}»`);

  // ── 6 · LA FRONTERA DEL OTRO LADO, QUE NO EXISTÍA ─────────────────────────
  seccion('6 · el defecto en espejo: el informe del contratista');

  const ctxCon = (estimaciones) => ({
    obra: { ...OBRA_DEP, diasPago: 30 }, subs: [], estimaciones,
    historialAvance: [], kpis: { af: 50, me: 100 }, programa: null,
  });
  // Una cartera de constructora, con SU vocabulario.
  const [EN_PROCESO, APROBADA, FACTURADA] = fn.ESTATUS;
  const vCon = fn.evaluarRiesgos(ctxCon([
    { no: 1, monto: 500000, estatus: FACTURADA, fechaFact: haceDias(45) },
    { no: 2, monto: 300000, estatus: APROBADA },
    { no: 3, monto: 200000, estatus: EN_PROCESO },
  ]));
  const dondeCon = (id) => vCon.detectados.some(r => r.id === id) ? 'detectados'
    : vCon.sinHallazgo.some(r => r.id === id) ? 'sinHallazgo'
    : vCon.noEvaluables.some(r => r.id === id) ? 'noEvaluables'
    : vCon.reventaron.some(r => r.id === id) ? 'reventaron' : 'fuera';
  check(dondeCon('ctr_003') === 'fuera',
    'el plazo del art. 63 no llega al informe del contratista: mide la obligación del Ente',
    `está en ${dondeCon('ctr_003')}`);
  check(dondeCon('fin_003') === 'detectados',
    'y su propia alerta de cobro sigue viva, con su plazo contractual',
    `está en ${dondeCon('fin_003')}`);

  // Las dos listas son disjuntas y ninguna regla queda sin casa: una regla en
  // las dos no se evaluaría nunca, en ninguna de las dos interfaces.
  const soloCon = new Set(fn.RIESGOS_SOLO_CONSTRUCTORA);
  const soloDep = new Set(fn.RIESGOS_SOLO_DEPENDENCIA);
  const enLasDos = [...soloDep].filter(id => soloCon.has(id));
  check(enLasDos.length === 0,
    'ninguna regla está vedada en las dos interfaces a la vez',
    enLasDos.length ? enLasDos.join(', ') : `${soloCon.size} + ${soloDep.size} ids, sin cruce`);
  const ids = new Set(fn.BIBLIOTECA_RIESGOS.map(p => p.id));
  const fantasmas = [...soloCon, ...soloDep].filter(id => !ids.has(id));
  check(fantasmas.length === 0,
    'y las dos listas sólo nombran reglas que existen',
    fantasmas.length ? fantasmas.join(', ') : `${ids.size} reglas en la biblioteca`);

  // ── 7 · LA CADENA HASTA EL PAPEL ──────────────────────────────────────────
  //
  // `riesgosDeDependencia` es el único armado del contexto que ve la
  // dependencia —la pantalla y el informe del art. 73 preguntan por ahí—, así
  // que el veredicto que se imprime tiene que traer el plazo de ley.
  seccion('7 · el informe que el municipio archiva');

  const vPapel = fn.riesgosDeDependencia({
    obra: OBRA_DEP, subs: [], estimaciones: MOROSA, historialAvance: [],
    programa: null, eco: { avance: 50, ejecutado: 4000000 },
  });
  check(vPapel.detectados.some(r => r.id === 'ctr_003'),
    'el veredicto que alimenta el informe del art. 73 trae el plazo de ley vencido');
  check(!vPapel.sinHallazgo.some(r => ['fin_003', 'fin_004', 'ctr_001'].includes(r.id))
        && !vPapel.detectados.some(r => ['fin_003', 'fin_004', 'ctr_001'].includes(r.id)),
    'y no trae ninguna de las tres reglas que no podían mirar');
  check(vPapel.reventaron.length === 0,
    'y ninguna regla revienta en el camino',
    vPapel.reventaron.map(r => `${r.id}: ${r.error}`).join(' | ') || 'ninguna');

  // ── El cierre del calendario ──────────────────────────────────────────────
  // Si la corrida cruzó la medianoche de la obra, las secciones 4 a 7 midieron
  // contra dos días distintos. Eso no es un rojo: es no haber podido mirar.
  if (fn.hoyLocalISO() !== HOY && !process.env.CALLADO) {
    noArranco.sinPrecondicion(
      `la corrida cruzó la medianoche: empezó en ${HOY} y acabó en ${fn.hoyLocalISO()}`,
      ['volver a correrlo; el plazo se cuenta en días y un día de corte mueve el veredicto']);
  }

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una forma realista de volver al defecto —las tres primeras
// son el defecto literal de antes de este lote— y no de romper el andamiaje: el
// banco sigue arrancando y ejecutando, y tiene que salir ROJO.
const MUTANTES = [
  // EL DEFECTO VIVO, literal: el plazo vuelve a ser el del contrato con 30 de
  // respaldo. Es lo que hacía `fin_003`, y es lo que la §1 tiene que morder.
  ['el plazo de pago vuelve a ser 30 días', 'const PLAZO_PAGO_LEY_233 = 20;',
    'const PLAZO_PAGO_LEY_233 = 30;'],
  // El plazo saliendo del contrato, que es de dónde salía.
  ['el plazo lo vuelve a poner el contrato',
    'const excedido = dias - PLAZO_PAGO_LEY_233;',
    'const excedido = dias - (e?.diasPago || PLAZO_PAGO_LEY_233);'],
  // Las tres reglas del otro vocabulario vuelven al veredicto de dependencia.
  ['`fin_003` vuelve a declararse «revisada sin hallazgo» en dependencia',
    "  'fin_003',                      // atraso de cobro, medido sobre «Facturada»\n", ''],
  ['`fin_004` vuelve al veredicto de dependencia',
    "  'fin_004',                      // cuentas por cobrar, mismo vocabulario\n", ''],
  ['`ctr_001` vuelve a pedir un `diasPago` que esa pantalla no tiene',
    "  'ctr_001',                      // pide `diasPago`, que la dependencia no captura\n", ''],
  // El defecto en espejo: la regla nueva se cuela al informe del contratista.
  ['el plazo del art. 63 se cuela al informe del contratista',
    '    if (!soloContrato && RIESGOS_SOLO_DEPENDENCIA.has(plantilla.id)) continue;\n', ''],
  // Un hueco pintado de verdad, que es el error que no se puede permitir.
  ['una autorizada sin fecha se cuenta como dentro de plazo',
    "  if (!desde) return ciego('sin fecha de autorización',",
    "  if (!desde) return { medible: true, color: C.green, dias: 0, excedido: -PLAZO_PAGO_LEY_233,\n"
    + "    texto: 'dentro de plazo', sub: '' };\n  if (false) return ciego('sin fecha de autorización',"],
  ['una pagada sin fecha de pago se cuenta como pagada en plazo',
    "  if (!hasta) return ciego('sin fecha de pago',",
    "  if (!hasta) return { medible: true, color: C.green, dias: 0, excedido: -PLAZO_PAGO_LEY_233,\n"
    + "    texto: 'pagada en plazo', sub: '' };\n  if (false) return ciego('sin fecha de pago',"],
  // Fechas imposibles pasando por buenas, con su número al revés.
  ['las fechas al revés vuelven a publicar un número negativo',
    "  if (dias < 0) return ciego('fechas al revés',", "  if (false) return ciego('fechas al revés',"],
  // La regla contando sólo las vencidas y callando las que no pudo medir.
  ['la tarjeta descuenta en silencio las que no pudo medir',
    `      if (!fuera.length) {
        if (!ciegas) return null;`,
    `      if (!fuera.length) {
        if (true) return null;`],
  // LAS DOS CUENTAS VUELTAS A SUMAR, que es el defecto que el preview pescó:
  // la deuda viva y lo ya pagado tarde en un solo peso.
  ['la deuda viva se suma con lo que ya se pagó tarde',
    '      const debiendo = fuera.filter(({ e }) => !esEstimacionPagada(e));',
    '      const debiendo = fuera;'],
  // La tarjeta escribiendo su propia cuenta, que es cómo `fin_003` y el
  // semáforo acabaron discrepando en producción.
  ['la tarjeta vuelve a contar los días por su cuenta',
    `      const relojes = (estimaciones || [])
        .map(e => ({ e, r: relojDePagoDependencia(e) }))
        .filter(({ r }) => r);`,
    `      const relojes = (estimaciones || [])
        .filter(e => e?.fechaAutorizacion)
        .map(e => ({ e, r: { medible: true, color: C.red,
          excedido: Math.floor((Date.now() - new Date(e.fechaAutorizacion)) / 86400000) - 30 } }))
        .filter(({ r }) => r.excedido > 0);`],
  // Una estimación en ventanilla contada como deuda vencida: cobrarle al
  // municipio por algo que el residente no ha autorizado.
  ['una estimación sin autorizar entra al reloj',
    '  if (!esEstimacionAutorizada(e) && !pagada) return null;',
    '  if (false) return null;'],
  // El dato del hueco aflojado: la regla pasaría a «sin hallazgo» en una obra
  // donde no se pudo medir nada.
  ['el requisito del hueco se afloja a «estimaciones capturadas»',
    "    requiere: ['autorizaciones'],\n    titulo: 'Pago vencido del plazo de ley (art. 63)',",
    "    requiere: ['estimaciones'],\n    titulo: 'Pago vencido del plazo de ley (art. 63)',"],
  // El aviso ámbar desaparecido: se vence sin que nadie lo haya visto venir.
  ['el plazo se vence sin aviso previo',
    '  if (excedido >= -AVISO_PAGO_LEY_233) return medido(C.yellow,',
    '  if (false) return medido(C.yellow,'],
];

// Dónde tiene que caer cada mutación. Una mutación que acierta en otro sitio
// —los dos motores comparten literales— pondría la contraprueba en amarillo
// sin que nadie lo note.
const ESPACIO = [
  'const relojDePagoDependencia =',
  'const PLAZO_PAGO_LEY_233 =',
  'const RIESGOS_SOLO_CONSTRUCTORA = new Set([',
  'const RIESGOS_SOLO_DEPENDENCIA = new Set([',
  "id: 'ctr_003'",
  'const evaluarRiesgos =',
];

const dondeCayo = (antes, despues) => {
  // La primera letra que cambió, y en qué declaración cae.
  let i = 0;
  while (i < antes.length && antes[i] === despues[i]) i++;
  for (const ancla of ESPACIO) {
    const a = antes.indexOf(ancla);
    if (a < 0) continue;
    // El final de la declaración: la siguiente ancla, o el fin del cuerpo.
    const finales = ESPACIO.map(x => antes.indexOf(x, a + ancla.length))
      .filter(p => p > a);
    const fin = finales.length ? Math.min(...finales) : antes.length;
    if (i >= a && i < fin) return ancla;
  }
  return null;
};

// LA REVISIÓN DE ANCLAJES CORRE SIEMPRE, no sólo con `--contraprueba`.
// `scripts/pruebas.cjs` lanza los bancos sin argumentos, así que la
// contraprueba de este archivo no la vuelve a mirar nadie después del día en
// que se escribió, y un anclaje se queda viejo sin avisar: pasó en este mismo
// lote —al partir la cuenta de `ctr_003` en deuda viva y falta cerrada, la
// mutación «descuenta en silencio» dejó de aplicar y el banco siguió verde,
// protegiendo una conducta menos de las que decía—. La guarda barata es la del
// corredor común del repositorio, y vale lo que cuesta buscar una cadena.
contraprueba.exigirAnclajes(
  MUTANTES.map(([titulo, de, a]) => ({ titulo, de, a })),
  cuerpo, { archivo: 'src/App.jsx' });

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [titulo, de, a] of MUTANTES) {
    const mutado = cuerpo.replace(de, a);
    const cayo = dondeCayo(cuerpo, mutado);
    if (!cayo) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» cayó fuera de las anclas conocidas`);
      process.exit(2);
    }
    let fallos;
    process.env.CALLADO = '1';
    try {
      fallos = correr(mutado);
    } catch (e) {
      // Reventar NO es salir en rojo: mide que el taller sabe parsear, no que
      // la aserción muerda. Contarlo como rojo deja pasar mutaciones que en
      // realidad nadie detecta, así que es NO ARRANCÓ.
      console.error(`NO ARRANCÓ: la mutación «${titulo}» revienta en vez de ` +
                    `romper la semántica: ${e.message}`);
      process.exit(2);
    } finally {
      delete process.env.CALLADO;
    }
    if (fallos.length) {
      console.log(`   ✓ ROJO  ${titulo}`);
      console.log(`           en «${cayo}» · ${fallos.length} aserción(es): ${fallos[0]}`);
    } else {
      console.log(`   ✗ PASÓ  ${titulo}  ·  NADIE la detectó  (cayó en «${cayo}»)`);
      sobrevivieron++;
    }
  }
  if (sobrevivieron) {
    console.error(`\nROJO: ${sobrevivieron} mutación(es) sobrevivieron. Las aserciones no muerden.`);
    process.exit(1);
  }
  console.log(`\nverde: las ${MUTANTES.length} mutaciones salieron en rojo.`);
  process.exit(0);
}

console.log('EL RELOJ DEL ART. 63 · Ley 233 de Veracruz');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
