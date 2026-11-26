#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL NÚMERO SALE A PANTALLA CON LO QUE TRAE: SU SIGNO Y SU «NO SE MIDIÓ»
// ════════════════════════════════════════════════════════════════════════════
//
// Dos defectos del mismo linaje, y por eso un solo banco: en los dos la cuenta
// de abajo SABÍA algo y la presentación lo tiraba al imprimir.
//
// ── #101 · EL SIGNO ────────────────────────────────────────────────────────
// `MXN` descarta el signo —`Math.abs` dentro— porque decenas de llamadores le
// pasan magnitudes. El signo se escribía a mano en cada sitio: ocho copias, con
// dos caracteres distintos para el mismo menos (`−` U+2212 y el guion `-`), y
// en varias la copia estaba MAL. El molde del defecto era literal:
//
//     `${v>=0?"+":""}${MXN(v)}`      ← al negativo no le pone nada,
//                                      y MXN le quita el menos
//
// Medido en la tabla por semanas de la 0121: la columna Margen publicaba
// `$9,652,920` donde el margen es −$9,652,920. Siete sitios tenían ese molde.
// **El color no sirve de signo**: en esa misma tabla hay cifras positivas en
// rojo por otro motivo.
//
// ── #100 · EL CALIFICATIVO ─────────────────────────────────────────────────
// `estadoGastoGP` devuelve veredicto —cuánto Y si se midió—. `resolverGastoGP`
// devuelve sólo el número. El prólogo de `Dashboard` era otra copia entera de
// `calcularKPIsObra` y pedía por el segundo, así que para una obra cuyo gasto
// de GP todavía no se ha corrido la tarjeta «Gasto acumulado» publicaba una
// cifra y un «0.0% del contrato». Un cero medido y un hueco se ven iguales si
// lo único que viaja es el número. La tabla del panel ya sabía callarse; esta
// tarjeta no tenía con qué preguntar.
//
// ── QUÉ SE AFIRMA ──────────────────────────────────────────────────────────
// Conducta, no nombres. Se extrae por AST el prólogo de cálculo de `Dashboard`
// y se EJECUTA fuera de React con el escenario de la 0129, y se leen las
// CADENAS que la pantalla va a imprimir. Los formateadores salen del archivo
// por el portón (`deApp`), nunca reimplementados.
//
// CON CANARIO, POR LOS DOS LADOS. «No publiques una cifra» es trivial de
// cumplir callándose siempre, y «ponle menos» lo es poniéndoselo a todo. Así
// que cada aserción tiene su gemela: la obra cuyo gasto SÍ está medido tiene
// que publicar su cifra y su porcentaje, y el margen positivo tiene que salir
// sin signo.
//
// Lo que NO cubre: el SVG de las gráficas, los colores, el PDF.
//
// Uso:  node scripts/prueba-el-numero-con-su-calificativo.cjs
//       node scripts/prueba-el-numero-con-su-calificativo.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ARCHIVO = path.join(raiz, 'src/App.jsx');
const FUENTE = fs.readFileSync(ARCHIVO, 'utf8');
// El taller, el papel de mentira y `alPapel` viven en `taller-de-app.cjs`.
// Estaban escritos aquí hasta que un segundo banco los necesitó: dos copias
// del taller se habrían separado al primer cambio, y un banco que mide con un
// taller viejo sale verde por el motivo equivocado.
const { taller, alPapel, sinComentarios } = require("./taller-de-app.cjs");

// ── El escenario ───────────────────────────────────────────────────────────
const semanasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n * 7); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
                   `${String(d.getDate()).padStart(2, '0')}`;
const semDe = (n) => {
  const t = semanasAtras(n); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return Math.ceil(((t - ini) / 86400000 + 1) / 7);
};

const PRESUPUESTO = 9_750_000;

// La obra recién dada de alta: su clave de GP está capturada en Contrato, pero
// la corrida del gasto todavía no la pidió. Caso real: el catálogo de obras va
// por un lado y el documento de gasto se arma por obra, en otra corrida.
const LA_NUEVA = {
  id: '0129', gpId: '0129',
  nombre: 'AYU-COAT-REHABILITACION DEL MALECON',
  presupuesto: PRESUPUESTO,
  inicio: iso(semanasAtras(8)), fin: iso(semanasAtras(-20)),
  modoAvance: 'volumen',
};
// La gemela del canario: la misma obra, pero con la clave que el gasto SÍ trae.
const LA_MEDIDA = { ...LA_NUEVA, id: '0121', gpId: '0121' };

const DINERO_MEDIDO = 19_900_000;

// `obrasPedidas` NO incluye la 0129: por eso su gasto es un HUECO (`no-pedida`)
// y no un cero medido. Si estuviera pedida, la respuesta correcta sería «cero»,
// que es otra cosa y se enseña distinto.
const GP = {
  obras: {
    '0121': {
      id: '0121', nombre: '0121 SIOP Coatza Rehab. Av. Universidad',
      grandTotal: DINERO_MEDIDO,
      años: {},
      semanas: {
        [`S${semDe(6)}`]: DINERO_MEDIDO / 2,
        [`S${semDe(3)}`]: DINERO_MEDIDO / 2,
      },
    },
  },
  obrasPedidas: ['0121'],
};

const SUBS = [{ sec: 'A-01', imp: PRESUPUESTO, cant: 100, pu: 97_500, cantEjec: 40 }];

const snap = (n, av, me) => {
  const d = semanasAtras(n); const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  return { semana: Math.ceil(((t - ini) / 86400000 + 1) / 7), año: t.getFullYear(),
           fechaCaptura: d.toISOString(), avancePonderado: av, montoEjecutado: me,
           esquema: 3 };
};
const HISTORIAL = [snap(6, 20, 1_950_000), snap(3, 35, 3_412_500)];

const PROPS = (obra) => ({
  obra, subs: SUBS, maquinaria: [], materiales: [], estimaciones: [],
  subcontratos: [], historialAvance: HISTORIAL, gpData: GP, otrosGastos: [],
  nominaHistorial: [], evidencia: [], onNavTab: null,
});

// El menos del que se habla es el de verdad, U+2212, no el guion del teclado.
const MENOS = '\u2212';

async function correr(codigo) {
  const { correr: ejecutar, cuenta, cuerpoDe, funcion } = taller(codigo);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const sec = (t) => { if (!process.env.CALLADO) console.log(`\n${t}`); };

  const MXN  = cuenta('MXN');
  const MXNS = cuenta('MXNS');
  const MXND = cuenta('MXND');
  const estadoGastoGP = cuenta('estadoGastoGP');
  const calcularKPIsObra = cuenta('calcularKPIsObra');
  const presentacionEconomiaObra = cuenta('presentacionEconomiaObra');
  const textoImprimible = cuenta('textoImprimible');

  // ── 0 · EL ESCENARIO DICE LO QUE CREO QUE DICE ───────────────────────────
  // Sin esto, todo lo de abajo podría pasar por la razón equivocada.
  sec('0. El escenario reproduce el hueco de la 0129 y la medición de la 0121');
  const estNueva  = estadoGastoGP(LA_NUEVA, GP);
  const estMedida = estadoGastoGP(LA_MEDIDA, GP);
  check(estNueva.medido === false && estNueva.motivo === 'no-pedida',
    'el gasto de la 0129 es un HUECO, no un cero medido',
    `medido=${estNueva.medido} motivo=${estNueva.motivo}`);
  check(estMedida.medido === true && estMedida.valor === DINERO_MEDIDO,
    'el gasto de la 0121 SÍ está medido, y es el del documento',
    MXN(estMedida.valor));

  // ── 1 · EL SIGNO ES DEL NÚMERO, NO DEL COLOR ─────────────────────────────
  sec('1. Los formateadores de dinero: el signo se pone una sola vez');
  check(!MXN(-8_612_920).includes(MENOS) && !MXN(-8_612_920).includes('-'),
    '`MXN` descarta el signo (es magnitud, y por eso hacen falta los otros dos)',
    MXN(-8_612_920));
  check(MXNS(-8_612_920).startsWith(MENOS),
    '`MXNS` de un negativo abre con el menos de verdad (U+2212)',
    MXNS(-8_612_920));
  check(MXNS(-8_612_920).includes('8,612,920'),
    '`MXNS` no se come la magnitud al ponerle el signo', MXNS(-8_612_920));
  check(!MXNS(4_100_000).includes(MENOS) && !MXNS(4_100_000).includes('+'),
    '`MXNS` de un positivo no pone nada: un `+` ahí es ruido', MXNS(4_100_000));
  check(MXND(4_100_000).startsWith('+'),
    '`MXND` de un delta positivo dice para qué lado se movió', MXND(4_100_000));
  check(MXND(-4_100_000).startsWith(MENOS),
    '`MXND` de un delta negativo también', MXND(-4_100_000));
  check(!MXND(0).includes('+') && !MXND(0).includes(MENOS),
    '`MXND` de cero no inventa una dirección', MXND(0));

  // ── 2 · LA CADENA QUE IMPRIME LA PANTALLA ────────────────────────────────
  // Esto ya no es el formateador: es lo que `presentacionEconomiaObra` —la
  // única traducción de la economía de una obra— va a poner en la tarjeta y en
  // la tabla. Dos escenarios con el gasto MEDIDO, uno perdiendo y otro ganando.
  sec('2. El margen negativo se publica como negativo');
  const kpisPierde = calcularKPIsObra(
    { ...LA_MEDIDA, presupuesto: PRESUPUESTO }, SUBS, [], [], [], GP, []);
  const presPierde = presentacionEconomiaObra(kpisPierde);
  check(kpisPierde.diff < 0,
    'el escenario pierde dinero de verdad: gastado > ejecutado',
    `diff = ${kpisPierde.diff}`);
  check(presPierde.margenAbsTxt.startsWith(MENOS),
    'la tarjeta y la tabla dicen el margen con su MENOS',
    presPierde.margenAbsTxt);
  check(presPierde.margenAbsTxt.includes(
          MXN(Math.abs(kpisPierde.diff)).replace('$', '').trim().split('.')[0]),
    'y con la magnitud completa, no una cifra redondeada aparte',
    presPierde.margenAbsTxt);
  // Canario: con el gasto chico el margen es positivo y NO lleva signo.
  const GP_CHICO = { ...GP, obras: { '0121': { ...GP.obras['0121'], grandTotal: 1_000_000,
    semanas: { [`S${semDe(3)}`]: 1_000_000 } } } };
  const presGana = presentacionEconomiaObra(
    calcularKPIsObra({ ...LA_MEDIDA }, SUBS, [], [], [], GP_CHICO, []));
  check(!presGana.margenAbsTxt.includes(MENOS),
    'canario: el margen positivo sale SIN signo (no se le pone menos a todo)',
    presGana.margenAbsTxt);

  // ── 3 · EL DASHBOARD DE OBRA, EJECUTADO FUERA DE REACT ───────────────────
  sec('3. La pantalla de la obra con el gasto sin medir');
  // `useProgramaDeObra` se dobla —lee Firestore— y devuelve «no hay anexo»,
  // que es el caso en el que el gasto es lo único que se puede afirmar.
  const SIN_ANEXO = ['useProgramaDeObra'];
  const dobles = { useProgramaDeObra: () => null };
  const dashHueco  = ejecutar('Dashboard', { ...PROPS(LA_NUEVA),  ...dobles }, SIN_ANEXO);
  const dashMedido = ejecutar('Dashboard', { ...PROPS(LA_MEDIDA), ...dobles }, SIN_ANEXO);

  check(dashHueco.kpis && dashHueco.kpis.gastoGPMedido === false,
    'el prólogo recibe el VEREDICTO, no sólo el número',
    `gastoGPMedido=${dashHueco.kpis?.gastoGPMedido}`);
  check(dashHueco.pres && dashHueco.pres.gastoSinMedir === true,
    'y la presentación sabe que no se midió');
  check(dashHueco.pres.gastoTxt === 'sin medir',
    '«Gasto acumulado» NO publica una cifra: dice que falta medirlo',
    JSON.stringify(dashHueco.pres.gastoTxt));
  check(!/\d/.test(dashHueco.pres.gastoTxt),
    'ni un dígito en esa tarjeta — un $0 ahí es una cifra inventada',
    JSON.stringify(dashHueco.pres.gastoTxt));
  check(dashHueco.pres.pctGastoTxt === null,
    'ni «% del contrato»: sin el gasto no hay porcentaje que afirmar');
  check(typeof dashHueco.pres.gastoMotivoTxt === 'string'
        && dashHueco.pres.gastoMotivoTxt.length > 10,
    'y debajo va el MOTIVO, no un hueco', dashHueco.pres.gastoMotivoTxt);
  check(dashHueco.pres.margenAbsTxt === 'gasto sin medir',
    'el margen tampoco se afirma: se calcula con ese gasto',
    JSON.stringify(dashHueco.pres.margenAbsTxt));

  sec('4. Canario: la misma pantalla con el gasto SÍ medido');
  check(dashMedido.pres.gastoSinMedir === false,
    'la 0121 no cae en la rama de «sin medir»');
  check(/\d/.test(dashMedido.pres.gastoTxt)
        && dashMedido.pres.gastoTxt.includes('19,900,000'),
    'y SÍ publica su cifra: callarse siempre no es la conducta buscada',
    dashMedido.pres.gastoTxt);
  check(dashMedido.pres.pctGastoTxt !== null
        && /% del contrato/.test(dashMedido.pres.pctGastoTxt),
    'con su porcentaje del contrato', dashMedido.pres.pctGastoTxt);
  check(dashMedido.pres.gastoMotivoTxt === null,
    'y sin motivo, porque no hay nada que explicar');

  // ── 5 · EL MISMO DEFECTO UN PISO MÁS ABAJO ───────────────────────────────
  // El KPI ya decía «sin medir» y la tabla de LA MISMA PANTALLA publicaba
  // `Gasto acumulado $0` y un margen igual al ejecutado entero. Se vio en el
  // preview sobre la 0128 «SIOP Colector Malecón»: arriba «sin medir», abajo
  // `$0` y `$13,684,113` de margen en el renglón de la semana en curso. La
  // causa está en `serieGastoDeSemanas`: sin obra en el documento de gasto, el
  // barrido hacia atrás devuelve 0 para todas las semanas y la serie sale plana
  // en cero. Un cero plano no es una medición: es el hueco disfrazado.
  //
  // Se afirma sobre las TRES series que salen de ahí, porque el defecto viajaba
  // por las tres: el acumulado que se dibuja, el delta de la columna «Gasto de
  // la semana» —que lee `porSem`, no la serie, y por eso no se arreglaba solo—
  // y el margen, que es la resta.
  //
  // El sujeto cambió de nombre el 2026-11-06: las tres gráficas se unificaron en
  // una y `TendenciasMensuales` desapareció con ellas. Las series ya no son
  // locales del componente sino campos de `curvaUnicaDeObra`, que es la única
  // cuenta que las arma. Lo que se afirma es lo mismo, sobre el mismo dato: el
  // hueco del gasto no se publica como un cero.
  sec('5. La tabla y la gráfica por semanas no publican el hueco como $0');
  const tendHueco  = ejecutar('TarjetaGraficaUnica', { ...PROPS(LA_NUEVA),  programa: null });
  const tendMedido = ejecutar('TarjetaGraficaUnica', { ...PROPS(LA_MEDIDA), programa: null });

  const todoNulo = (serie) => Array.isArray(serie) && serie.length > 0
    && serie.every(v => v === null || v === undefined);
  const algunNumero = (serie) => Array.isArray(serie)
    && serie.some(v => typeof v === 'number');

  check(tendHueco.g?.gastoMedido === false,
    'el prólogo de la tabla recibe el veredicto del gasto, no lo deduce',
    `gastoMedido=${tendHueco.g?.gastoMedido}`);
  check(todoNulo(tendHueco.g?.gasto),
    'la serie de «Gasto acumulado» queda VACÍA, no plana en cero',
    JSON.stringify(tendHueco.g?.gasto?.slice(-3)));
  // La columna se lee de `COLS`, que es donde viven las nueve desde el
  // 2026-11-23: las arma `columnasSemanales`, la misma función que usa el PDF.
  const colDe = (tab, titulo) =>
    ((tab.COLS || []).find(c => c.titulo === titulo) || {}).valores || [];
  check(todoNulo(colDe(tendHueco, 'Gasto de la semana')),
    'la columna «Gasto de la semana» tampoco afirma un cero por semana',
    JSON.stringify(colDe(tendHueco, 'Gasto de la semana').slice(-3)));
  check(todoNulo(tendHueco.g?.margen),
    'y el margen no publica el ejecutado entero como ganancia',
    JSON.stringify(tendHueco.g?.margen?.slice(-3)));
  // El renglón concreto que se vio en el preview: la última semana.
  const ultima = (s) => Array.isArray(s) ? s[s.length - 1] : undefined;
  check(ultima(tendHueco.g?.margen) === null
        && algunNumero(tendHueco.g?.ejecutado),
    'con ejecutado medido y gasto sin medir, el renglón de la semana en curso '
    + 'deja el margen vacío', `ejecutado=${MXN(ultima(tendHueco.g?.ejecutado))}`);
  // Y la gráfica lo DICE, no lo calla: sin la línea de gasto no hay área de
  // margen que sombrear, y un hueco sin dibujar se lee como «no hay hueco». Las
  // dos ausencias entran en la leyenda con su motivo. Esto no existía cuando el
  // sujeto era `TendenciasMensuales`: la serie vacía simplemente no se pintaba.
  const auGasto  = tendHueco.g?.ausentes?.find(a => a.clave === 'gasto');
  const auMargen = tendHueco.g?.ausentes?.find(a => a.clave === 'margen');
  check(!!auGasto && /gp|gasto/i.test(auGasto.motivo || ''),
    'la leyenda declara que falta la línea de gasto, con el motivo',
    auGasto?.motivo || 'callada');
  check(!!auMargen && /no se sabe/.test(auMargen.motivo || ''),
    'y que sin esa línea el margen no es cero, es que no se sabe',
    auMargen?.motivo || 'callado');
  check(!tendHueco.g?.areas?.some(a => a.clave === 'margen'),
    'el área del margen no se sombrea contra un borde que no existe');

  check(tendMedido.g?.gastoMedido === true,
    'canario: con la 0121 el veredicto es que SÍ se midió');
  check(algunNumero(tendMedido.g?.gasto),
    'canario: la serie medida SÍ se dibuja',
    MXN(ultima(tendMedido.g?.gasto)));
  check(algunNumero(tendMedido.g?.margen),
    'canario: y el margen se dibuja — callarse siempre no es la conducta buscada',
    MXN(ultima(tendMedido.g?.margen)));
  check(!tendMedido.g?.ausentes?.some(a => a.clave === 'gasto'),
    'canario: y no se declara ausente lo que sí se midió');

  // Aquí vivía la sección 5b: el panel de proyección no publicaba «Ritmo gasto
  // $0 /sem», «Gasto acumulado a hoy $0» ni «Margen proyectado al cierre
  // $29.1M» con el gasto sin medir, y su `fmtCompacto` decía «sin medir» en vez
  // de una cifra. Medía `ProyeccionAvanceGasto`, que se borró el 2026-11-06 al
  // unificarse las tres gráficas en una. No se reescribió contra otro sujeto
  // porque no hay otro: ese panel ya no está en el tablero.
  //
  // Lo que se perdió con él eran dos reglas, y el 2026-11-07 —al reconstruirse
  // el bloque del ritmo sobre cortes CERRADOS— se recuperó UNA. Queda escrito
  // aquí cuál y dónde, para no tener que acordarse:
  //
  //   · «UN RITMO NO SE PROMEDIA SOBRE SEMANAS SIN MEDIR» vive en
  //     `prueba-desviacion-plazo.cjs`, sección 7: dos cierres separados seis
  //     semanas dan 2 pp/sem y no 12, y el ritmo del expediente cuenta las
  //     once semanas reales y no los cinco puntos. La mutación que las tumba
  //     —dividir entre `base.length - 1`— está en su contraprueba y da 5 rojas.
  //     Ahí también quedó descartada por medición la otra forma de ese mismo
  //     promedio: el avance de hoy entre las semanas CORRIDAS del plazo, que a
  //     la 0112 le atribuye 4.46 pp/sem cuando mide 0.68.
  //
  //   · «UN MARGEN PROYECTADO NO SE PUBLICA SIN SUSTRAENDO» sigue sin banco, y
  //     no por olvido: no hay sujeto. Hoy no existe ningún margen proyectado en
  //     `src/` ni en `functions/` —el panel que lo publicaba se borró— y una
  //     prueba sobre una pantalla que no está sólo se comprobaría contra sí
  //     misma. La regla aplica el día que se vuelva a publicar un margen al
  //     cierre: tiene que decir de qué se resta.
  //
  // El menos de verdad en el margen negativo —el otro defecto que medía esta
  // sección— sigue cubierto: `MXNS` es la única cuenta que lo pone y la sección
  // 2 la examina directamente, con `MENOS` como la afirmación.

  // ── 6 · UNA CUENTA POR NÚMERO ────────────────────────────────────────────
  // El prólogo ya no rehace la cuenta: pide el bundle. Se afirma comparando
  // con lo que devuelve `calcularKPIsObra` llamada aparte, sobre las MISMAS
  // props. Si alguien vuelve a teclear la fórmula aquí, esto sigue en verde
  // mientras coincida — y lo que muerde entonces es la sección 3, que es el
  // punto: la copia no se desviaba en el número, se desviaba en el veredicto.
  sec('6. El número de la pantalla es el del bundle, no uno recalculado');
  const bundle = calcularKPIsObra(LA_MEDIDA, SUBS, [], [], [], GP, []);
  for (const campo of ['gt', 'am', 'alm', 'me', 'af', 'diff', 'mpct', 'pctGasto', 'brecha']) {
    check(dashMedido[campo] === bundle[campo],
      `\`${campo}\` de la pantalla === \`${campo}\` del bundle`,
      `${dashMedido[campo]} vs ${bundle[campo]}`);
  }

  // ── 7 · LOS DOS MOLDES NO VUELVEN ────────────────────────────────────────
  // Aserciones de molde, no de existencia: lo que se exige es que un patrón
  // que YA produjo el defecto no esté escrito en el archivo. Van al final y
  // acompañadas, nunca solas.
  sec('7. Los moldes que produjeron el defecto no están en el archivo');
  // Sin comentarios: el preámbulo de `MXNS` CITA el molde malo para explicar
  // de qué habla, y un barrido que no distingue el código de la prosa dejaría
  // el banco rojo por una explicación bien escrita.
  const compacto = sinComentarios(codigo).replace(/\s+/g, '').replace(/"/g, "'");
  const moldeSigno = [`?'+':''}\${MXN(`, `?'+':''}{MXN(`, `?'':''}\${MXN(`];
  const hallados = moldeSigno.filter(m => compacto.includes(m));
  check(hallados.length === 0,
    'ningún sitio pone `+` al positivo y NADA al negativo antes de `MXN`',
    hallados.length ? hallados.join(' ') : 'cero ocurrencias');
  check(!compacto.includes('MXN(Math.abs('),
    'ningún `MXN(Math.abs(x))`: `MXN` ya toma magnitud, ese abs era la señal '
    + 'de un signo escrito a mano al lado');
  const cuerpoDash = cuerpoDe('Dashboard');
  check(!/resolverGastoGP\s*\(/.test(cuerpoDash),
    'el Dashboard de obra no pide el gasto por el acceso que tira el veredicto');
  // La columna vive en un atributo JSX, así que el taller —que reemplaza el JSX
  // por `null` para poder ejecutar el prólogo— no la ve. Lo que la sección 5
  // afirma es que la serie llega VACÍA; esto es lo único que falta para que el
  // renglón diga «sin medir» y no el `—` por omisión de `TablaSemanas`, que ahí
  // significaría «no hubo movimiento».
  // SE AFIRMA SOBRE LA CUENTA, no sobre el literal del JSX. Estaba escrito
  // como una subcadena del componente —`{titulo:'Gastoacumulado',valores:…}`—
  // y el 2026-11-23 las columnas se mudaron a `columnasSemanales` para que el
  // PDF usara las mismas: el literal desapareció del componente y el banco
  // acusó de perder un rótulo que no se había perdido, sólo mudado.
  const colsDecl = compacto.includes("titulo:'Gastoacumulado'")
    || sinComentarios(fs.readFileSync(archivo, 'utf8'))
         .replace(/\s+/g, '').includes("titulo:'Gastoacumulado',valores:g.gasto,formato:'mxn',vacio:'sinmedir'");
  check(colsDecl,
    'la columna «Gasto acumulado» declara qué dice cuando la serie viene vacía');

  // ── 8 · EL PAPEL QUE SE DESCARGA ─────────────────────────────────────────
  // El PDF era la CUARTA copia de «¿qué obra del GP es ésta?», y la peor: caía
  // al match difuso aunque `gpId` estuviera capturado y no cuadrara. La 0129
  // comparte «COAT» y «REHAB» con la 0121, así que el reporte ejecutivo —el
  // documento que sale de la oficina con el nombre de la obra en la portada—
  // le colgaba a la obra nueva los $19.9M de la otra. El resto del archivo
  // tenía la guarda desde el incidente; este archivo no.
  //
  // Y traía el otro defecto completo: su propio `MXN` con `Math.abs` dentro,
  // que además TAPABA a `MXNS`, así que el margen de la 0121 se entregaba como
  // `$16,000,000` donde la cuenta dice −$16,000,000.
  //
  // REANCLADA EL 2026-11-12, sobre el papel que de verdad se descarga. El
  // reporte ejecutivo se retiró y el único PDF de una constructora es el
  // documento interno, que NO tiene una cuarta copia que romper: no resuelve la
  // obra del GP ni formatea el dinero por su cuenta —pide `calcularKPIsObra` y
  // `presentacionEconomiaObra`, los mismos que la pantalla— así que el incidente
  // no se puede reproducir ahí sin romper también el tablero. Lo que sigue
  // habiendo, y es lo que esta sección mide, son los SITIOS DE PUBLICACIÓN: las
  // tejas de indicadores, la caja de lo que no se puede afirmar, la leyenda de
  // la gráfica, la tabla del margen semanal y los tres estados del riesgo. Cada
  // uno puede imprimir un cero donde hay un hueco, y cada uno se afirma abajo.
  //
  // Dos sitios del papel viejo no tienen dónde aterrizar y se retiran dichos:
  // la PORTADA con sus cuatro tejas de economía —la del documento interno es de
  // identificación, contrato y fechas, y no publica gasto ni margen— y la tabla
  // de proyección con «Ritmo GP semanal» y «Fin proy. por gasto», que se fue
  // con `ProyeccionAvanceGasto` el 2026-11-06 y nunca llegó a este papel. No se
  // reponen buscándoles un anclaje parecido: lo que cada aserción afirmaba
  // —que un hueco no se publique como cero— lo afirman las de abajo sobre los
  // sitios donde el hueco SÍ se publica hoy.
  //
  // Se afirma sobre las CADENAS que salieron al papel, no sobre el código.
  sec('8. El PDF que se descarga no le cuelga a una obra el gasto de otra');
  const pdfHueco  = await alPapel(funcion, PROPS(LA_NUEVA));
  const pdfMedido = await alPapel(funcion, PROPS(LA_MEDIDA));

  const dice = (papel, s) => papel.textos.some(t => t.includes(s));
  // Las tejas no son una tabla: `kpiBox` manda al papel exactamente tres
  // cadenas seguidas —rótulo en mayúsculas, valor y pie—, así que se leen por
  // posición. El resumen financiero del papel viejo sí era una tabla, y por eso
  // este archivo tenía además un `valorDe`/`celdaDe` que buscaba por renglón;
  // en el documento interno esos números salen por teja, así que los dos
  // ayudantes se fueron con la tabla que leían.
  const tejaDe = (papel, rotulo) => {
    const i = papel.textos.indexOf(rotulo);
    return i === -1 ? { valor: `(no hay teja «${rotulo}»)`, pie: '' }
                    : { valor: papel.textos[i + 1], pie: papel.textos[i + 2] };
  };

  check(!dice(pdfHueco, '19,900,000'),
    'el documento de la 0129 NO imprime en ninguna parte los $19.9M de la 0121',
    pdfHueco.textos.filter(t => t.includes('19,9')).join(' | ') || 'cero veces');

  // SITIO 1 · las tejas de la sección 2. Es el resumen de la obra en cuatro
  // renglones, y lo primero que alguien lee después de la portada. El pie no
  // es decoración: es el único lugar del papel donde el hueco lleva su motivo.
  const tGasto = tejaDe(pdfHueco, 'GASTO ACUMULADO');
  check(tGasto.valor === 'sin medir'
     && tGasto.pie === 'la corrida del gasto todavía no la incluye',
    'la teja «Gasto total» dice «sin medir» Y por qué, no `$0`',
    `${tGasto.valor} / ${tGasto.pie}`);
  // Al margen no se le pide una cadena concreta: se le pide que NO publique un
  // porcentaje ni un importe. Un hueco se delata como `0.0%` o como `$0`, y
  // cualquiera de los dos afirma un margen que nadie midió.
  const tMargen = tejaDe(pdfHueco, 'MARGEN');
  check(!tMargen.valor.includes('%') && !tMargen.pie.includes('$')
     && /sin medir/.test(tMargen.pie),
    'y la de «Margen» no publica ni porcentaje ni importe, y nombra el hueco',
    `${tMargen.valor} / ${tMargen.pie}`);

  // SITIO 2 · la caja de lo que no se puede afirmar. Sin ella las dos tejas de
  // arriba dicen «sin medir» y el lector tiene que adivinar el alcance: si es
  // sólo el gasto el que falta, o si el margen que no está también depende.
  check(pdfHueco.textos.some(t => /el gasto total está incompleto/.test(t)
                              && /el margen no se puede afirmar/.test(t)),
    'la caja de huecos dice que sin ese sumando el margen NO se puede afirmar',
    pdfHueco.textos.filter(t => /gasto total está incompleto/.test(t)).join(' | ')
      || '(no hay caja)');

  // SITIO 3 · la leyenda de la gráfica. Una serie que no se dibuja se lee como
  // «esta obra no gastó» si nadie dice que no se midió.
  check(dice(pdfHueco, 'el gasto de esta obra no está medido: GP no la conoce con esta clave'),
    'la leyenda de la gráfica explica la serie de gasto que falta');
  check(dice(pdfHueco, 'no es que no haya margen, es que no se sabe'),
    'y la del margen distingue «no hay margen» de «no se sabe»');

  // SITIO 4 · la tabla del margen semanal. Es el sitio más fácil de llenar con
  // ceros, porque una columna de pesos acepta `$0` en cada semana sin
  // protestar, y doce ceros seguidos se leen como una obra sin margen.
  check(dice(pdfHueco, 'No hay serie semanal de margen que publicar'),
    'la tabla del margen semanal se declara ausente en vez de imprimir ceros');

  // SITIO 5 · los tres estados del riesgo. Aquí el defecto no era un número,
  // era un VEREDICTO: con el gasto en cero el margen sale máximo y el riesgo
  // se clasificaba solo. La tabla de DETECTADOS es la única que sale por
  // `autoTable`, así que lo que se afirma es que el margen no está en ella.
  const detectados = pdfHueco.celdas
    .filter(c => c.col === 1).map(c => String(c.texto));
  check(!detectados.includes('Margen bruto en zona crítica')
     && !detectados.includes('Brecha entre gasto y avance'),
    'ni el margen ni la brecha entran en los riesgos DETECTADOS: sin el gasto '
    + 'no hay número con el que disparar',
    detectados.join(' | ') || '(tabla vacía)');
  // Y NO SE CALLAN. Hasta el 2026-11-21 esto se afirmaba fuerte: que el margen
  // salía NOMBRADO bajo «No evaluables · qué dato falta», con el dato que le
  // faltó. Ese bloque se retiró del papel de la constructora por decisión de
  // producto —la columna del porqué citaba al motor— y quedan dos conteos.
  //
  // Lo que se puede seguir afirmando aquí es lo que el papel sostiene hoy: que
  // el riesgo NO desapareció. Entró en la cuenta de los que no se pudieron
  // medir, y esa cuenta se imprime. Es menos de lo que se afirmaba antes, y se
  // dice en vez de disimularlo con un anclaje parecido: QUÉ riesgo fue y QUÉ
  // dato le faltó ya sólo lo publica el informe del Art. 73, y eso lo vigila
  // `prueba-el-hueco-de-riesgo-se-ve`.
  const lineaNoEval = pdfHueco.textos.find(t => /sin poder medir/.test(t)) || '';
  const nNoEval = Number((lineaNoEval.match(/^(\d+)/) || [])[1]);
  check(Number.isFinite(nNoEval) && nNoEval > 0,
    'el papel publica cuántos riesgos no se pudieron medir: el margen no se esfuma',
    lineaNoEval || '(no sale el conteo)');
  check(!dice(pdfHueco, 'Margen bruto en zona crítica'),
    'y no lo nombra, que es lo que se decidió: el detalle vive en el Art. 73');

  check(dice(pdfMedido, '19,900,000'),
    'canario: el documento de la 0121 SÍ publica su gasto medido');
  check(tejaDe(pdfMedido, 'GASTO ACUMULADO').valor === '$19,900,000'
     && tejaDe(pdfMedido, 'GASTO ACUMULADO').pie === '204.1% del contrato',
    'canario: con el gasto medido la teja publica la cifra y su proporción',
    `${tejaDe(pdfMedido, 'GASTO ACUMULADO').valor} / ${tejaDe(pdfMedido, 'GASTO ACUMULADO').pie}`);
  // En el PAPEL el menos no es el mismo carácter que en la pantalla, y eso es
  // correcto: las fuentes estándar del PDF no saben escribir U+2212, así que
  // `textoImprimible` lo cambia por el guion antes de llegar a la hoja. Lo que
  // estas comprobaciones afirman es que la cifra SALE CON SIGNO —el defecto
  // era un `Math.abs` que se lo comía—, no cuál es el glifo. Se pregunta al
  // propio portón del generador en vez de teclear `'-'` aquí: si mañana el
  // sustituto cambia, esto sigue midiendo el signo y no una cadena copiada.
  const MENOS_EN_HOJA = textoImprimible(MENOS);
  const tMargenM = tejaDe(pdfMedido, 'MARGEN');
  check(tMargenM.valor.startsWith(MENOS_EN_HOJA)
     && tMargenM.pie.startsWith(MENOS_EN_HOJA),
    'canario y #101 en el papel: el margen negativo de la 0121 se entrega CON '
    + 'su menos, en el porcentaje y en el importe',
    `${tMargenM.valor} / ${tMargenM.pie}`);
  check(tMargenM.pie.includes('16,000,000'),
    'canario: y sin comerse la magnitud al ponerle el signo',
    tMargenM.pie);
  // El NIVEL, que es lo que el hueco se clasificaba solo: con el gasto medido
  // el margen sí entra en detectados, y entra en rojo.
  const filaCritica = pdfMedido.celdas.find(
    c => c.col === 0 && c.fila[1] === 'Margen bruto en zona crítica');
  check(filaCritica?.texto === 'Crítico'
     && Array.isArray(filaCritica?.estilos?.textColor),
    'canario: con el gasto medido el margen SÍ se clasifica, y en «Crítico»',
    filaCritica ? `${filaCritica.texto} · ${JSON.stringify(filaCritica.estilos)}`
                : '(no hay renglón)');
  // SE ACOTA A LAS TEJAS, no a todo el documento. Decía «en ninguna parte», y
  // el 2026-11-23 el papel ganó la tabla semanal, donde «sin medir» es el
  // TEXTO DE UNA CELDA VACÍA —la semana que no trae gasto— y no una afirmación
  // sobre la obra. El canario acusaba al documento de declararse sin medir por
  // una celda de una semana. Lo que tiene que seguir siendo cierto es que las
  // TEJAS del gasto y del margen publiquen su cifra.
  const tejasSinMedir = ['GASTO ACUMULADO', 'MARGEN']
    .filter(t => /sin medir/i.test(JSON.stringify(tejaDe(pdfMedido, t) || {})));
  check(tejasSinMedir.length === 0,
    'canario: y en el documento medido ninguna teja dice «sin medir»',
    tejasSinMedir.join(', ') || 'ninguna');

  return fallos;
}

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
// Cada mutación rompe la SEMÁNTICA —devuelve el defecto que se arregló— y
// tiene que salir en ROJO. Si una mutación no halla su anclaje, esto sale con
// 2: una contraprueba que no muerde porque no encontró dónde morder no es un
// verde, es un banco sin arrancar.
const MUTACIONES = [
  ['`MXNS` deja de poner el menos (el margen negativo se publica positivo)',
    "const MXNS = n => `${(Number(n)||0) < 0 ? '\u2212' : ''}${MXN(n)}`;",
    'const MXNS = n => MXN(n);'],
  ['`MXNS` le pone menos a todo, también a lo positivo',
    "const MXNS = n => `${(Number(n)||0) < 0 ? '\u2212' : ''}${MXN(n)}`;",
    "const MXNS = n => `\u2212${MXN(n)}`;"],
  ['`MXND` deja de decir para qué lado se movió el delta negativo',
    "const MXND = n => { const v = Number(n)||0; return `${v > 0 ? '+' : v < 0 ? '\u2212' : ''}${MXN(v)}`; };",
    "const MXND = n => { const v = Number(n)||0; return `${v > 0 ? '+' : ''}${MXN(v)}`; };"],
  ['la traducción de la economía vuelve a escribir el signo a mano, con el molde malo',
    '      : MXNS(kpis.diff),',
    '      : `${kpis.diff >= 0 ? \'+\' : \'\'}${MXN(kpis.diff)}`,'],
  ['«Gasto acumulado» publica la cifra aunque el gasto no esté medido',
    "    gastoTxt: gastoSinMedir ? 'sin medir' : MXN(kpis.gt),",
    '    gastoTxt: MXN(kpis.gt),'],
  ['«Gasto acumulado» publica el % del contrato sin tener el gasto completo',
    '    pctGastoTxt: (gastoSinMedir || !conPresupuesto) ? null\n      : `${NUM(kpis.pctGasto, 1)}% del contrato`,',
    '    pctGastoTxt: !conPresupuesto ? null\n      : `${NUM(kpis.pctGasto, 1)}% del contrato`,'],
  ['el hueco se queda sin motivo: dice «sin medir» y no dice por qué',
    "    gastoMotivoTxt: !gastoSinMedir ? null\n      : (kpis.gastoGPMotivo === 'no-pedida'\n          ? 'la corrida del gasto todavía no la incluye'\n          : 'el gasto de GP no se pudo medir'),",
    '    gastoMotivoTxt: null,'],
  ['el margen se afirma aunque esté calculado con un gasto incompleto',
    "    margenAbsTxt: gastoSinMedir\n      ? 'gasto sin medir'\n      : MXNS(kpis.diff),",
    '    margenAbsTxt: MXNS(kpis.diff),'],
  ['la serie por semana vuelve a salir plana en cero cuando el gasto es un hueco',
    '  const serie = semanas.map((s, i) => {\n    if (!medido) return null;',
    '  const serie = semanas.map((s, i) => {'],
  ['la columna «Gasto de la semana» vuelve a restar dos ceros y publicar un cero',
    '    if (i === 0) return null;\n    if (!g.gastoMedido) return null;',
    '    if (i === 0) return null;'],
  ['la columna «Gasto acumulado» deja el `—` por omisión, que dice «no hubo movimiento»',
    "{titulo:'Gasto acumulado', valores:g.gasto, fmt:MXN,\n             vacio:'sin medir'}",
    "{titulo:'Gasto acumulado', valores:g.gasto, fmt:MXN}"],
  // Las cinco mutaciones de la proyección —ritmo de gasto, margen al cierre,
  // la línea sobre la base del eje, el `null` leído como cero y el signo a
  // mano— se fueron con `ProyeccionAvanceGasto` el 2026-11-06. No se cambiaron
  // de anclaje: no hay anclaje al que cambiarlas. El porqué está en la nota de
  // la sección 5b, donde vivían las aserciones que mordían.
  //
  // En su lugar van las de la gráfica única, que es donde el mismo hueco se
  // publica ahora. Las dos primeras son LA conducta nueva: antes la serie
  // vacía simplemente no se pintaba, y una línea que falta sin decirlo deja la
  // gráfica afirmando «no hay hueco» donde lo cierto es «no se sabe».
  ['la línea de gasto que falta se calla en vez de declararse en la leyenda',
    "    declarar('gasto', 'Gasto acumulado',\n      'el gasto de esta obra no está medido: GP no la conoce con esta clave');",
    "    void 'la leyenda no dice nada';"],
  ['el margen ausente se calla: sin la línea de gasto el hueco no se dibuja ni se explica',
    "    declarar('margen', 'Margen acumulado, en pesos',\n      !dibuja('gasto')",
    "    if (0) declarar('margen', 'Margen acumulado, en pesos',\n      !dibuja('gasto')"],
  ['el área del margen se sombrea contra un borde que no se midió',
    "  if (dibuja('ejec') && dibuja('gasto') && hayDato(margen)) {",
    "  if (dibuja('ejec') && hayDato(ejecutado)) {"],
  // Ésta vive aquí y no en `prueba-una-sola-pregunta-a-gp` porque sólo este
  // banco tiene el escenario que la muerde: una obra que la corrida del gasto
  // NO incluye. Allá las dos obras tienen gasto medido —el cero de la 0129 es
  // un cero medido— y la mutación sobrevivía sin que nada estuviera mal.
  ['la línea de gasto se dibuja sin mirar si el gasto está medido',
    '  if (gastoMedido && hayDato(gasto)) {',
    '  if (hayDato(gasto) || true) {'],
  ['el Dashboard de obra vuelve a resolver el gasto por el acceso sin veredicto',
    '  const kpis = calcularKPIsObra(obra, subs, maquinaria, materiales, estimaciones, gpData, otrosGastos);',
    '  const kpis = { ...calcularKPIsObra(obra, subs, maquinaria, materiales, estimaciones, gpData, otrosGastos),\n    gt: resolverGastoGP(obra, gpData), gastoGPMedido: true };'],

  // ── Las del papel ────────────────────────────────────────────────────────
  // REANCLADAS EL 2026-11-12. Eran diez y quedan tres, y la cuenta no es un
  // recorte de ambición: es que el papel sobre el que mordían ya no existe.
  //
  // Siete se fueron SIN sustituto, y cada una por una razón distinta que vale
  // la pena dejar escrita, porque la tentación al ver una mutación huérfana es
  // buscarle un anclaje parecido y así volverla una mutación que muerde otra
  // cosa con el nombre de la vieja:
  //
  //  · «el PDF vuelve a resolver la obra del GP por parecido de nombre» era LA
  //    mutación de esta sección: devolvía la cuarta copia del resolvedor. El
  //    documento interno no tiene copia que devolver —le pide el bloque a
  //    `calcularKPIsObra`, el mismo de la pantalla— así que para reproducir el
  //    incidente aquí habría que romper el resolvedor compartido, y entonces la
  //    mutación ya no diría nada del papel: diría que el tablero y el papel se
  //    mueven juntos, que es lo que se quiere. Lo que de verdad protege ese
  //    número hoy es `prueba-una-sola-pregunta-a-gp`, sobre `estadoGastoGP`.
  //  · «su propio `MXN` con `Math.abs`» y «el gasto en cero» / «el margen con
  //    un gasto incompleto» (`gpTxt`, `margenTxt`): el papel ya no formatea.
  //    Las tres viven arriba, sobre `MXNS` y sobre `presentacionEconomiaObra`,
  //    que es donde el formato se decide una vez para los dos lectores.
  //  · «la celda del margen se pinta de verde» (`d.row.index === 5`): el
  //    resumen financiero era una tabla con un renglón número 5. Ahora son
  //    tejas, y el color de una teja sale por `setFillColor`, que `papelDeMentira`
  //    no graba. No se repone con un anclaje de adorno: lo que ese color
  //    afirmaba —un veredicto sobre un hueco— lo afirma ahora la aserción de
  //    los riesgos detectados, que sí es observable.
  //  · «el ritmo de gasto semanal» y «el fin proyectado por gasto» se fueron
  //    con `ProyeccionAvanceGasto` el 2026-11-06, igual que las cinco de la
  //    sección 5b.
  //  · los dos niveles de riesgo (`clasificarMasAltoMejor`,
  //    `clasificarMasBajoMejor`) y el callarse de las observaciones ya no
  //    dependen de un `gastoGPMedido` leído en el papel: el papel pide
  //    `evaluarRiesgos`, y la compuerta que manda un riesgo sin insumo a «No
  //    evaluables» es `if (faltan.length)`. Esa mutación YA EXISTE, en
  //    `prueba-tres-estados-del-riesgo`, dos veces. No se duplica aquí: dos
  //    bancos mutando el mismo anclaje se estorban el día que el anclaje cambie
  //    y los dos salen en 2 por la misma razón. Las aserciones de los tres
  //    estados de arriba son guardas sobre la conducta que ese banco muerde.
  //
  // Las tres que quedan muerden los SITIOS DE PUBLICACIÓN del papel, y las tres
  // van en el ARGUMENTO —en lo que el papel le pasa a `kpiRow`, en lo que
  // consulta para abrir la caja de huecos—, nunca en `presentacionEconomiaObra`.
  // Es deliberado: si se mutara el traductor, el tablero y el papel publicarían
  // el cero a la vez, y lo que esta sección afirma es precisamente que el papel
  // no tiene un camino propio para publicarlo.
  ['la teja del gasto vuelve a publicar el cero en vez de decir «sin medir»',
    "    ['Gasto total', pres.gastoTxt,\n      pres.pctGastoTxt || pres.gastoMotivoTxt || '—',\n      pres.gastoSinMedir ? Q.mu : Q.nar],",
    "    ['Gasto total', MXN(kpis.gt),\n      `${PCT(kpis.pctGasto)} del contrato`,\n      Q.nar],"],
  ['la teja del margen vuelve a afirmar un porcentaje y un importe sobre el hueco',
    "    ['Margen', pres.margenTxt, pres.margenAbsTxt, colorMargen],",
    "    ['Margen', PCT(kpis.mpct), MXNS(kpis.diff), colorMargen],"],
  ['la caja de lo que no se puede afirmar se calla sobre el gasto sin medir',
    '  const huecos = [];\n  if (pres.gastoSinMedir)\n    huecos.push(',
    '  const huecos = [];\n  if (false)\n    huecos.push('],
];

async function main() {
  if (process.argv.includes('--contraprueba')) {
    console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
    let sobrevivieron = 0;
    for (const [titulo, de, a] of MUTACIONES) {
      if (!FUENTE.includes(de)) {
        console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje en la fuente`);
        process.exit(2);
      }
      let fallos;
      process.env.CALLADO = '1';
      try { fallos = await correr(FUENTE.replace(de, a)); }
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
    return;
  }

  console.log('EL NÚMERO CON SU CALIFICATIVO · el signo y el «no se midió» llegan a pantalla');
  const fallos = await correr(FUENTE);
  if (fallos.length) {
    console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
    process.exit(1);
  }
  console.log('\nverde');
}

// Una excepción aquí es NO ARRANCÓ, no un rojo.
//
// Y hace falta una guarda MÁS, que no es ceremonia: se vivió. `correr` es
// `async` desde que ejercita el PDF, y una promesa que nunca se resuelve no
// lanza nada — vacía el bucle de eventos y Node sale con CERO. Eso pasó en
// esta misma prueba: el generador reventaba antes de dibujar, la espera del
// CDN quedaba colgada, y el banco salía EN VERDE habiendo corrido la mitad de
// sus secciones. Ni `vigilarExcepciones` ni este `catch` lo ven, porque no hay
// excepción que ver.
//
// Así que se marca el final de verdad. Si el proceso termina sin pasar por
// `terminó`, es que algo quedó esperando, y eso es un 2.
let terminó = false;
process.on('exit', (c) => {
  if (terminó || c !== 0) return;
  console.error('');
  console.error('NO ARRANCÓ: el proceso salió con 0 sin llegar al final de la');
  console.error('prueba. Alguna promesa quedó sin resolver — un `await` a algo');
  console.error('que nadie completa. NO es un verde: faltaron secciones.');
  process.exitCode = noArranco.NO_ARRANCO;
});

main().then(() => { terminó = true; }).catch(e => {
  terminó = true;
  console.error(`\nNO ARRANCÓ: ${(e && e.stack) || e}`);
  process.exit(noArranco.NO_ARRANCO);
});
