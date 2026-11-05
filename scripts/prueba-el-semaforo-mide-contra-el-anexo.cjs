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
// uno hace un daño distinto y un arreglo a medias sólo tapa uno:
//
//   · el anexo ABSUELVE — obra con el gasto programado al final. La recta la
//     acusa de ir muy atrasada cuando va donde dijo que iría. Es la multa
//     injusta: el contratista cumple y el semáforo lo pinta en rojo.
//   · el anexo ACUSA — obra con el gasto programado al principio. La recta la
//     deja pasar en silencio cuando va muy por detrás de lo que firmó. Es la
//     peor de las dos, porque el atraso real no se ve hasta que es tarde.
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
  const rectaPct = fn.avanceProgramadoA(OBRA, null, HOY_ISO).pct;

  // ── 0 · EL FIXTURE DICE LO QUE CREO QUE DICE ──────────────────────────────
  // Si el calendario del fixture se desarma, las aserciones de abajo pasarían
  // por la razón equivocada. Esto no prueba la app: protege al banco.
  const pctAbsuelve = fn.avanceProgramadoA(OBRA, ANEXO_ABSUELVE, HOY_ISO);
  const pctAcusa    = fn.avanceProgramadoA(OBRA, ANEXO_ACUSA, HOY_ISO);
  check(pctAbsuelve.fuente === 'programa' && pctAcusa.fuente === 'programa',
    'los dos anexos del fixture se leen como programa, no como recta',
    `${pctAbsuelve.fuente} · ${pctAcusa.fuente}`);
  check(pctAbsuelve.pct < rectaPct - 20 && pctAcusa.pct > rectaPct + 20,
    'y quedan uno muy por debajo y otro muy por encima de la recta',
    `absuelve ${pctAbsuelve.pct.toFixed(1)}% · recta ${rectaPct.toFixed(1)}% · acusa ${pctAcusa.pct.toFixed(1)}%`);

  // ── 1 · EL ANEXO ABSUELVE Y LA RECTA MULTA ────────────────────────────────
  const absSinAnexo = semaforo(ctx(null, AF_ABSUELTA));
  const absConAnexo = semaforo(ctx(ANEXO_ABSUELVE, AF_ABSUELTA));
  check(absSinAnexo !== null,
    'sin anexo, la obra que gastará al final se publica atrasada',
    absSinAnexo ? `${absSinAnexo.severidad} ${absSinAnexo.valor}` : 'no disparó');
  check(absConAnexo === null,
    'con el anexo cargado el semáforo CALLA: va donde dijo que iría',
    absConAnexo ? `siguió disparando: ${absConAnexo.severidad} ${absConAnexo.valor}` : 'calló');

  // ── 2 · EL ANEXO ACUSA Y LA RECTA DEJA PASAR ──────────────────────────────
  // Esta es la que protege al municipio: el contratista va de verdad atrasado
  // contra lo que firmó, y la recta no lo ve.
  const acuSinAnexo = semaforo(ctx(null, AF_ACUSADA));
  const acuConAnexo = semaforo(ctx(ANEXO_ACUSA, AF_ACUSADA));
  check(acuSinAnexo === null,
    'sin anexo, la obra que ya debía estar casi lista pasa en silencio',
    acuSinAnexo ? `disparó: ${acuSinAnexo.valor}` : 'calló');
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

  // ── 4 · EL TÍTULO NOMBRA LA VARA ──────────────────────────────────────────
  // Un semáforo que dice «contra el programa» habiendo restado la recta es la
  // misma afirmación falsa, más chica y más difícil de ver.
  const conAnexo = semaforo(ctx(ANEXO_ACUSA, AF_ACUSADA));
  const sinAnexo = semaforo(ctx(null, AF_ABSUELTA));
  check(/programa/i.test(conAnexo?.titulo || ''),
    'con anexo, el título dice que midió contra el programa',
    conAnexo?.titulo);
  check(/recta/i.test(sinAnexo?.titulo || '') && !/contra el programa/i.test(sinAnexo?.titulo || ''),
    'sin anexo, el título dice RECTA y no se cuelga la palabra programa',
    sinAnexo?.titulo);
  check(/no tiene programa cargado/i.test(sinAnexo?.extra || ''),
    'y el detalle avisa de que a esa obra le falta el anexo',
    sinAnexo?.extra);

  // ── 5 · MIENTRAS LA LECTURA VIAJA, CALLA ──────────────────────────────────
  // `undefined` es «todavía no se sabe». Disparar ahí publica la recta y la
  // rotula programa durante el viaje — el defecto entero, en una rendija de
  // milisegundos que se ve en cada recarga.
  check(semaforo(ctx(undefined, AF_ABSUELTA)) === null,
    'con la lectura del anexo a medio viaje no se afirma nada',
    'undefined ≠ null');
  check(semaforo(ctx(null, AF_ABSUELTA)) !== null,
    'pero `null` —ya se sabe que no hay anexo— sí cae a la recta y lo dice');

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
const MUTACIONES = [
  // El defecto original, exacto.
  ['vuelve a medir contra la recta aunque el anexo esté cargado',
    'const p = avanceProgramadoA(obra, programa, hoyLocalISO());',
    'const p = avanceProgramadoA(obra, null, hoyLocalISO());'],
  // La rendija: afirmar durante el viaje de la lectura.
  ['dispara con la lectura del anexo a medio viaje',
    'if (programa === undefined) return null;',
    'if (programa === undefined) programa = null;'],
  // El título mintiendo sobre la vara que usó.
  ['dice «contra el programa» aunque haya restado la recta',
    "const vara = esProg ? 'el programa' : 'la recta del plazo';",
    "const vara = 'el programa';"],
  // El motor tirando el título dinámico: el detector mide bien y la pantalla
  // sigue nombrando mal.
  ['el motor ignora el título que devuelve el detector',
    'titulo: r.titulo || plantilla.titulo,',
    'titulo: plantilla.titulo,'],
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
