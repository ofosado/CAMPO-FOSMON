#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL SEMÁFORO MIDE CONTRA EL ANEXO, NO CONTRA UNA RECTA — PENDIENTES #51
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO, HABIENDO YA UNO DEL #51. El que hay
// (`prueba-pantalla-dice-de-donde-sale-el-programado.cjs`) cubre el KPI, la
// curva y `ALERTA_REGLAS`. Pero hay DOS motores de reglas en la app, y ese
// banco sólo recorta uno:
//
//   · `ALERTA_REGLAS`      → el panel de alertas. Arreglado en el #51.
//   · `BIBLIOTECA_RIESGOS` → los INDICADORES DE RIESGO del Dashboard.
//
// La regla `avc_004` del segundo motor se quedó repartiendo el plazo en línea
// recta. Medido en el preview el 2026-11-04 sobre la 0114, que tiene anexo
// cargado: el Dashboard publicaba «Avance vs plazo desbalanceado −29pp» y
// Operación, el mismo día y la misma obra, «−17pp». Doce puntos entre dos
// pantallas a dos clics de distancia.
//
// Y LE LLEGA AL MUNICIPIO. `avc_004` no está en `RIESGOS_SOLO_CONSTRUCTORA`, y
// no tiene por qué estarlo: el plazo es del municipio tanto como del
// contratista, y el anexo no es economía de nadie, es el calendario que las
// dos partes firmaron. Lo que no puede ser es que la única cifra que una
// dependencia le reclama a su contratista salga de una recta que nadie firmó.
//
// LAS DOS DIRECCIONES, QUE SON DOS DEFECTOS DISTINTOS. No basta con probar que
// la cifra cambia; hay que probar que cambia EN LOS DOS SENTIDOS, porque cada
// uno hace un daño distinto y un arreglo a medias sólo tapa uno. Los dos anexos
// del fixture están elegidos para caer a lados opuestos de aquel reparto
// lineal:
//
//   · el anexo ABSUELVE — obra con el gasto programado al final. La recta la
//     acusaba de ir muy atrasada cuando va donde dijo que iría. Es la multa
//     injusta: el contratista cumple y el semáforo lo pinta en rojo.
//   · el anexo ACUSA — obra con el gasto programado al principio. La recta la
//     dejaba pasar en silencio cuando va muy por detrás de lo que firmó. Es la
//     peor de las dos, porque el atraso real no se ve hasta que es tarde.
//
// Y EL TERCER CASO, EL DEL 2026-11-06: SIN ANEXO. Hasta ese día la regla medía
// contra la recta también cuando NO había programa cargado — ahí la recta no
// era una aproximación mala, era la única vara, y el reclamo salía igual. Eso
// se quitó: sin anexo la regla calla. No es un hueco que haya que llenar con
// otra cuenta; es que sin el calendario que las dos partes firmaron no hay
// atraso que reclamar, y la pantalla lo dice donde se puede arreglar, que es la
// gráfica. La sección 5 lo barre con cuatro avances distintos, porque el modo
// nuevo de romper esto es reponer la recta «para que la tarjeta no se vea
// vacía».
//
// Lo que se afirma es CONDUCTA: qué publica el motor de riesgos cuando se le
// dan una obra y un programa. Las reglas se extraen de `src/App.jsx` y se
// EJECUTAN. No se afirma que exista ningún nombre; los nombres se piden sólo
// para poder ejecutar.
//
// LAS FECHAS SON RELATIVAS A HOY, A PROPÓSITO. `avc_004` llama a
// `hoyLocalISO()` por dentro y no recibe la fecha, así que un fixture con
// fechas fijas envejece y el banco empieza a fallar solo un martes cualquiera.
// Una prueba que falla con el calendario es ruido, y el ruido se aprende a
// ignorar. El dinero se coloca en meses ENTEROS de pasado o de futuro, nunca
// en el mes en curso, para que no haya aritmética de mes partido: así el banco
// da lo mismo el día 1 que el día 28.
//
// NINGUNA CIFRA ESPERADA ESTÁ TECLEADA. Lo que el banco compara contra lo que
// publica `avc_004` sale de ejecutar `avanceProgramadoA`, que es la cuenta del
// repositorio. Teclear «90%» aquí sería comprobar el banco contra sí mismo.
//
// Uso:  node scripts/prueba-el-semaforo-mide-contra-el-anexo.cjs
//       node scripts/prueba-el-semaforo-mide-contra-el-anexo.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = [
  'detectarRiesgos', 'BIBLIOTECA_RIESGOS', 'RIESGOS_SOLO_CONSTRUCTORA',
  'avanceProgramadoA', 'pctProgramadoEnFecha', 'hoyLocalISO',
  // `fechaLocalDeISO` no la usa ninguna aserción: la usan las MUTACIONES que
  // reponen la recta. Al salir la recta de `avanceProgramadoA` esta función
  // dejó de estar en la clausura que arrastra el extractor, y sin pedirla
  // explícitamente esas mutaciones revientan con ReferenceError. Reventar
  // también sale ROJO, así que la contraprueba quedaría verde por la razón
  // equivocada: comprobándose contra su propio andamiaje en vez de contra la
  // conducta.
  'fechaLocalDeISO',
];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── El calendario del fixture, anclado al mes en curso ─────────────────────
//
// `inicio` es el día 1 del mes de hace OCHO meses y el programa dura DOCE. Así
// los índices 0..7 son meses enteramente pasados, el 8 es el mes en curso y
// 9..11 están enteramente por venir. Dejando el índice 8 en cero, el acumulado
// programado a hoy no depende del día del mes.
const HOY = new Date();
const ANCLA = new Date(HOY.getFullYear(), HOY.getMonth() - 8, 1);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
  `${String(d.getDate()).padStart(2, '0')}`;

const INICIO = iso(ANCLA);
// Fin a cuatro meses vista del mes en curso: la obra lleva ~8 de ~12 meses, o
// sea que la recta ronda los dos tercios. El número exacto no se teclea; se
// calcula abajo con la cuenta del repositorio.
const FIN = iso(new Date(HOY.getFullYear(), HOY.getMonth() + 4, 1));

const programaDe = (montos) => ({
  inicio: INICIO,
  meses: 12,
  total: montos.reduce((t, m) => t + m, 0),
  partidas: [{ sec: '1000 01', montos, barra: '' }],
});

//                      pasado: 0 1 2 3 4 5 6 7 · hoy: 8 · futuro: 9 10 11
const ANEXO_ABSUELVE = programaDe([25, 25, 25, 25, 0, 0, 0, 0, 0, 300, 300, 300]);
const ANEXO_ACUSA    = programaDe([200, 200, 200, 200, 100, 0, 0, 0, 0, 50, 30, 20]);

const OBRA = { id: '0114', inicio: INICIO, fin: FIN, presupuesto: 1000 };

// El avance real de cada caso. Elegidos para que la vara decida el veredicto:
// con uno la recta acusa y el anexo absuelve, con el otro al revés.
const AF_ABSUELTA = 30;
const AF_ACUSADA  = 60;

const ctx = (programa, af, extra = {}) => ({
  obra: OBRA, subs: [], estimaciones: [], historialAvance: [],
  kpis: { af }, programa, ...extra,
});

function correr(fuente) {
  const fn = construir(fuente);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  // Lo que `avc_004` publica, o `null` si calla.
  const semaforo = (contexto) =>
    fn.detectarRiesgos(contexto).find(r => r.id === 'avc_004') || null;
  const pp = (r) => r === null ? null : Number(String(r.valor).replace(/[^\d.]/g, ''));

  const HOY_ISO = fn.hoyLocalISO();
  // La recta que la app usaba hasta el 2026-11-06, calculada AQUÍ y no pedida
  // a la app: ya no existe allá. Sirve de una sola cosa, documentar la forma
  // del fixture — que los dos anexos caen a lados opuestos del reparto lineal,
  // que es lo que hacía que la vara decidiera el veredicto.
  const diaDe = (s) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
  const rectaPct = ((diaDe(HOY_ISO) - diaDe(INICIO)) / (diaDe(FIN) - diaDe(INICIO))) * 100;

  // ── 0 · EL FIXTURE DICE LO QUE CREO QUE DICE ──────────────────────────────
  // Si el calendario del fixture se desarma, las aserciones de abajo pasarían
  // por la razón equivocada. Esto no prueba la app: protege al banco.
  const pctAbsuelve = fn.avanceProgramadoA(OBRA, ANEXO_ABSUELVE, HOY_ISO);
  const pctAcusa    = fn.avanceProgramadoA(OBRA, ANEXO_ACUSA, HOY_ISO);
  check(pctAbsuelve.fuente === 'programa' && pctAcusa.fuente === 'programa',
    'los dos anexos del fixture se leen como programa',
    `${pctAbsuelve.fuente} · ${pctAcusa.fuente}`);
  check(pctAbsuelve.pct < rectaPct - 20 && pctAcusa.pct > rectaPct + 20,
    'y quedan uno muy por debajo y otro muy por encima de la recta de aquel entonces',
    `absuelve ${pctAbsuelve.pct.toFixed(1)}% · recta ${rectaPct.toFixed(1)}% · acusa ${pctAcusa.pct.toFixed(1)}%`);
  check(!!OBRA.inicio && !!OBRA.fin,
    'canario: la obra tiene inicio y fin, o sea que esa recta SÍ se podía calcular',
    `${OBRA.inicio} → ${OBRA.fin}`);

  // ── 1 · ES EL ANEXO EL QUE DECIDE, NO EL AVANCE ───────────────────────────
  // El MISMO avance real, los dos anexos, veredictos opuestos. Es la forma más
  // fuerte de afirmar contra qué mide: si el veredicto lo decidiera el avance,
  // estas dos corridas darían lo mismo.
  const absConAnexo = semaforo(ctx(ANEXO_ABSUELVE, AF_ABSUELTA));
  const mismoAvanceAcusa = semaforo(ctx(ANEXO_ACUSA, AF_ABSUELTA));
  check(absConAnexo === null,
    'con el anexo que gasta al final el semáforo CALLA: va donde dijo que iría',
    absConAnexo ? `disparó: ${absConAnexo.severidad} ${absConAnexo.valor}` : 'calló');
  check(mismoAvanceAcusa !== null,
    'y con el anexo que gasta al principio, el MISMO avance sí se acusa',
    mismoAvanceAcusa ? `${mismoAvanceAcusa.severidad} ${mismoAvanceAcusa.valor}` : 'no disparó');

  // ── 2 · EL ANEXO ACUSA LO QUE LA RECTA DEJABA PASAR ───────────────────────
  // Esta es la que protege al municipio: el contratista va de verdad atrasado
  // contra lo que firmó, con un avance que la recta habría absuelto.
  const acuConAnexo = semaforo(ctx(ANEXO_ACUSA, AF_ACUSADA));
  check(AF_ACUSADA < rectaPct + 15 && AF_ACUSADA > pctAbsuelve.pct,
    'canario: ese avance quedaba dentro del umbral contra la recta de aquel entonces',
    `avance ${AF_ACUSADA}% · recta ${rectaPct.toFixed(1)}%`);
  check(acuConAnexo !== null,
    'con el anexo cargado el semáforo SÍ la acusa',
    acuConAnexo ? `${acuConAnexo.severidad} ${acuConAnexo.valor}` : 'no disparó');

  // ── 3 · UNA CUENTA POR NÚMERO ─────────────────────────────────────────────
  // El atraso que publica el semáforo tiene que ser el que da la cuenta del
  // repositorio, no una resta hecha aquí dentro. Si el semáforo rederiva, los
  // dos números pueden separarse sin que nadie lo note.
  const esperado = pctAcusa.pct - AF_ACUSADA;
  check(acuConAnexo !== null && Math.abs(pp(acuConAnexo) - esperado) <= 0.5,
    'y el atraso que publica es el de `avanceProgramadoA`, no una resta propia',
    `publica ${acuConAnexo ? acuConAnexo.valor : '—'} · la cuenta da -${esperado.toFixed(1)}pp`);

  // ── 4 · EL TÍTULO NOMBRA LA VARA, Y NO NOMBRA NINGUNA RECTA ───────────────
  // Un semáforo que dice «contra el programa» habiendo restado la recta es la
  // misma afirmación falsa, más chica y más difícil de ver. Ya no hay recta que
  // restar, así que lo que se afirma es que la palabra tampoco aparece: el día
  // que alguien la reponga, el título la va a delatar.
  const conAnexo = semaforo(ctx(ANEXO_ACUSA, AF_ACUSADA));
  check(/programa/i.test(conAnexo?.titulo || ''),
    'con anexo, el título dice que midió contra el programa',
    conAnexo?.titulo);
  check(!/recta|lineal|plazo/i.test(conAnexo?.titulo || ''),
    'y no nombra ninguna recta ni el plazo: midió contra el anexo',
    conAnexo?.titulo);
  check(!/recta|lineal/i.test(conAnexo?.extra || ''),
    'el detalle tampoco', conAnexo?.extra);

  // ── 5 · SIN ANEXO, EL SEMÁFORO CALLA EN LOS DOS SENTIDOS ──────────────────
  // El corte del 2026-11-06. Esta tarjeta la lee la DEPENDENCIA, y «rezagado»
  // contra el reparto lineal del plazo es un reclamo sin contrato detrás.
  // Antes el mismo caso disparaba: la obra de arriba, sin anexo, se publicaba
  // atrasada estando donde iba a estar.
  const AF_SIN = [0, AF_ABSUELTA, AF_ACUSADA, 100];
  const disparan = AF_SIN.filter(af => semaforo(ctx(null, af)) !== null);
  check(disparan.length === 0,
    'sin anexo no se acusa a ninguna obra, con cualquier avance que lleve',
    disparan.length ? `disparó con ${disparan.join('%, ')}%` : `${AF_SIN.length} avances probados, 0 disparos`);
  check(semaforo(ctx(undefined, AF_ABSUELTA)) === null,
    'con la lectura del anexo a medio viaje tampoco se afirma nada');
  // El canario de esta sección: con anexo cargado y el mismo avance SÍ dispara,
  // así que los ceros de arriba son por la falta del anexo y no porque la regla
  // esté muerta.
  check(semaforo(ctx(ANEXO_ACUSA, 0)) !== null,
    'canario: con anexo y ese mismo avance la regla sigue viva');

  // ── 6 · AL MUNICIPIO LE LLEGA, Y MEDIDO CONTRA EL ANEXO ───────────────────
  const depConAnexo = semaforo(ctx(ANEXO_ACUSA, AF_ACUSADA, { tipo: 'dependencia' }));
  check(depConAnexo !== null,
    'la dependencia también ve el atraso de su contratista',
    depConAnexo ? `${depConAnexo.severidad} ${depConAnexo.valor}` : 'no le llegó');
  check(depConAnexo !== null && pp(depConAnexo) === pp(acuConAnexo),
    'y es exactamente la misma cifra que ve la constructora: una obra, un atraso',
    `municipio ${depConAnexo?.valor} · constructora ${acuConAnexo?.valor}`);

  // ── 7 · LA FRONTERA DEL MARGEN SIGUE EN PIE ───────────────────────────────
  // Pasarle el programa a la dependencia no puede haber abierto la puerta a la
  // economía del contratista. El anexo es calendario; el margen no.
  const delMunicipio = fn.detectarRiesgos(ctx(ANEXO_ACUSA, AF_ACUSADA, {
    tipo: 'dependencia',
    kpis: { af: AF_ACUSADA, gt: 900, me: 600, mpct: -50, brecha: 40, pctGasto: 90 },
  })).map(r => r.id);
  // La lista se nombra AQUÍ, no se toma de `RIESGOS_SOLO_CONSTRUCTORA`. Tomarla
  // de allí es preguntarle a la cerradura si está cerrada: quien borre un renglón
  // de la lista borra al mismo tiempo la definición de lo que había que tapar, y
  // la prueba pasa feliz mientras el margen le aparece al municipio.
  const ECONOMIA_DEL_CONTRATISTA = [
    'fin_001', 'fin_002', 'fin_006',
    'nom_001', 'nom_002', 'nom_003',
    'mat_001', 'mat_002',
    'maq_001',
    'sub_001', 'sub_002', 'sub_003',
    'gst_001', 'gst_002', 'gst_003', 'gst_004', 'gst_005',
    'ctr_002',
  ];
  const colados = delMunicipio.filter(id => ECONOMIA_DEL_CONTRATISTA.includes(id));
  check(colados.length === 0,
    'al municipio no se le cuela ninguna regla de la economía del contratista',
    colados.length ? `se colaron: ${colados.join(', ')}`
                   : `${ECONOMIA_DEL_CONTRATISTA.length} reglas fuera, 0 coladas`);
  // Y la cerradura tiene que seguir teniendo todos los pasadores, aunque con este
  // fixture no todas las reglas disparen: una regla fuera de la lista no se cuela
  // hoy sólo porque su detector calló.
  const sinTapar = ECONOMIA_DEL_CONTRATISTA.filter(id => !fn.RIESGOS_SOLO_CONSTRUCTORA.has(id));
  check(sinTapar.length === 0,
    'y la lista de la frontera sigue nombrando a todas, disparen o no',
    sinTapar.length ? `quedaron destapadas: ${sinTapar.join(', ')}` : 'las 18 siguen nombradas');

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver al defecto, no de romper el
// andamiaje: el banco sigue arrancando y ejecutando, y tiene que salir ROJO.
// La recta tal como la escribiría quien la repone: redonda, con los mismos
// resguardos que tenía, no un sabotaje. Si una mutación sólo se detecta porque
// está mal escrita, no prueba nada.
const RECTA = `
        const i = fechaLocalDeISO(obra?.inicio);
        const f = fechaLocalDeISO(obra?.fin || obra?.finAmpliado);
        if (!i || !f || f <= i) return null;
        const h = fechaLocalDeISO(hoyLocalISO());
        p.pct = Math.max(0, Math.min(100, ((h - i) / (f - i)) * 100));`;
const DETECTA = 'const p = avanceProgramadoA(obra, programa, hoyLocalISO());\n' +
  '      if (p.pct === null) return null;';

const MUTACIONES = [
  // El defecto que cerró el #51: tener el anexo y no usarlo.
  ['el detector no le pasa el anexo cargado a la cuenta',
    'const p = avanceProgramadoA(obra, programa, hoyLocalISO());',
    'const p = avanceProgramadoA(obra, null, hoyLocalISO());'],
  // El defecto del 2026-11-06, y el modo realista de volver a él: la tarjeta se
  // ve vacía en las 7 obras vivas y alguien la rellena con el plazo.
  ['repone la recta del plazo donde no hay anexo',
    DETECTA,
    'const p = avanceProgramadoA(obra, programa, hoyLocalISO());\n' +
    '      if (p.pct === null) {' + RECTA + '\n      }\n' +
    '      if (p.pct === null) return null;'],
  // La rendija más fina: sólo mientras la lectura del anexo va en camino. Dura
  // un parpadeo por recarga, así que a mano no se ve; es exactamente el tipo de
  // cosa que tiene que atrapar un banco y no un par de ojos.
  ['afirma un atraso mientras la lectura del anexo va en camino',
    DETECTA,
    'const p = avanceProgramadoA(obra, programa, hoyLocalISO());\n' +
    '      if (p.pct === null && programa === undefined) {' + RECTA + '\n      }\n' +
    '      if (p.pct === null) return null;'],
  // El título volviendo al de antes del #51 — el que publicaba el Dashboard de
  // la 0114 el 2026-11-04. Mide contra el anexo y nombra el plazo: la misma
  // afirmación falsa, más chica y más difícil de ver.
  ['el título vuelve a nombrar el plazo en vez del programa',
    "    titulo: 'Avance rezagado contra el programa',\n" +
    "    descripcion: 'El avance real va por debajo del programa contractual',",
    "    titulo: 'Avance vs plazo desbalanceado',\n" +
    "    descripcion: 'El avance real va por debajo del programa contractual',"],
  // Esconderle el atraso al municipio.
  ['al municipio se le esconde el atraso de su contratista',
    "const RIESGOS_SOLO_CONSTRUCTORA = new Set([\n  'fin_001',",
    "const RIESGOS_SOLO_CONSTRUCTORA = new Set([\n  'avc_004',\n  'fin_001',"],
  // La frontera del margen, por el otro lado.
  ['la economía del contratista se le abre al municipio',
    "  'fin_001',                                          // margen bruto",
    '  // margen bruto'],
  // Rederivar el atraso en vez de usar la cuenta.
  ['el semáforo rederiva el atraso por su cuenta',
    'const desv = p.pct - kpis.af;',
    'const desv = (p.pct - kpis.af) * 1.1;'],
];

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
    try { fallos = correr(cuerpo.replace(de, a)); }
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

console.log('EL SEMÁFORO MIDE CONTRA EL ANEXO · #51\n');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
