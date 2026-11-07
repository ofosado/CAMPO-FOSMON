#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA GRÁFICA DE GOBIERNO: TRES SERIES, Y NINGUNA ES DEL CONTRATISTA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE ESTE BANCO. El tablero de la dependencia dibujaba dos series
// en PORCENTAJE —avance real contra programa— y nada de dinero. El 2026-11-07
// se volvió `curvaDeGobierno`: tres cantidades sobre UN eje en pesos
// acumulados del contrato.
//
//   a) avance programado   b) avance ejecutado   c) LO PAGADO al contratista
//   d) el hueco entre lo construido y lo pagado, que NO es una línea: es el
//      área sombreada, y es para el municipio lo que el margen es para la
//      constructora.
//
// LOS DOS DEFECTOS QUE VIGILA, y ninguno es imaginado:
//
// 1. LA FUGA. La dependencia no puede ver el gasto ni el margen del
//    contratista. `curvaUnicaDeObra` los calcula; esta cuenta no los recibe
//    —no entra `gpData`— y no los puede devolver. Una bandera en la gráfica
//    única habrían sido diez puntos de toque y basta olvidar uno. Aquí se
//    afirma ejecutando: se le MANDA `gpData` a propósito y se comprueba que no
//    sale gasto por ningún lado.
//
// 2. LA MENTIRA POR OMISIÓN, la misma de la gráfica única. Sin la línea de lo
//    pagado no hay área sombreada, y un hueco que no se sombrea se lee como
//    «está todo pagado» en vez de «no se sabe».
//
// Y UN TERCERO QUE ES PROPIO DE ESTA GRÁFICA: la fecha de lo pagado. Medido en
// producción el 2026-11-06 sobre las 42 estimaciones de las 7 obras vivas: una
// estimación guarda `no`, `monto`, `estatus`, `periodo` y `fechaFact`, y
// NINGUNO es una fecha de pago. `periodo` es texto libre sin formato («05-30 de
// Junio 2026», «16-jul-26 al 15-ago-26», dos vacíos). Así que la serie descansa
// en el corte semanal congelado (`montoPagado`), que cubre 14 de 48 semanas
// cerradas y CERO en las tres obras de dependencia. Lo que este banco prohíbe
// es la salida fácil: tomar el total pagado de HOY y repetirlo hacia atrás, que
// dibuja una línea plana con cara de medida.
//
// QUÉ SE AFIRMA. Conducta, ejecutada: se extrae `curvaDeGobierno` del archivo
// con el taller y se CORRE sobre escenarios con y sin cada dato. No se busca
// ninguna cadena en el código ni se comprueba que exista ningún nombre, con la
// excepción declarada de la sección 7, que es una guarda de molde y va
// acompañada, nunca sola.
//
// LO QUE NO CUBRE: el SVG, los colores, la tipografía. Y el reparto de
// pestañas de la dependencia, que es `prueba-las-dos-direcciones-del-producto`.
//
// Uso:  node scripts/prueba-la-grafica-de-gobierno.cjs
//       node scripts/prueba-la-grafica-de-gobierno.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const path = require('path');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { taller } = require('./taller-de-app.cjs');

const raiz = path.resolve(__dirname, '..');
const ARCHIVO = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(raiz, 'src/App.jsx');
const FUENTE = fs.readFileSync(ARCHIVO, 'utf8');

const MXN = (n) => typeof n === 'number'
  ? '$' + Math.round(n).toLocaleString('en-US') : String(n);

// ── EL ESCENARIO ────────────────────────────────────────────────────────────
// Un contrato de $10M que arrancó hace diez semanas. Las fechas se derivan de
// hoy para que la ventana de la gráfica —que mira hacia atrás desde la semana
// en curso— caiga siempre encima de los snapshots, corra el banco el día que
// corra. Un fixture con fechas fijas sale rojo cuando pasa el tiempo, y un rojo
// por el calendario enseña a ignorar los rojos.
const PRESUPUESTO = 10_000_000;
const DIA = 86_400_000;
const haceSemanas = (n) => new Date(Date.now() - n * 7 * DIA);
const fechaISO = (d) => d.toISOString().slice(0, 10);

const OBRA = () => ({
  id: '0128', nombre: 'Obra de dependencia', gpId: '0128',
  presupuesto: PRESUPUESTO,
  fechaInicio: fechaISO(haceSemanas(10)),
  fechaTermino: fechaISO(haceSemanas(-10)),
  esquemaSnapshot: 3,
});

// La semana ISO de una fecha, que es como el historial guarda sus cortes: por
// `semana` y `año`, no por fecha. Un snapshot sin esos dos campos cae en una
// clave `undefined` y las series salen planas — el banco mediría la ausencia de
// su propio fixture.
const semanaISOde = (d) => {
  const j = new Date(d); j.setHours(0, 0, 0, 0);
  j.setDate(j.getDate() + 4 - (j.getDay() || 7));
  const ene = new Date(j.getFullYear(), 0, 1);
  return { sem: Math.ceil(((j - ene) / DIA + 1) / 7), año: j.getFullYear() };
};

// Dos cortes guardados. El esquema 3 es el vigente: así ninguna frontera se
// mete a punteado y lo que se mida aquí es la ausencia de series, no la
// frontera —que tiene su propio banco—.
//
// `montoPagado` es el CORTE CONGELADO de esa semana, el único origen fechado
// que existe para lo pagado. Va por debajo del ejecutado a propósito: así el
// hueco que se sombrea es positivo y se puede distinguir del caso contrario.
const snap = (semanas, { av, me, pag }) => {
  const d = haceSemanas(semanas);
  const { sem, año } = semanaISOde(d);
  const s = { semana: sem, año,
    fecha: fechaISO(d), fechaCaptura: d.toISOString(),
    avancePonderado: av, montoEjecutado: me, esquema: 3 };
  if (pag !== undefined) { s.montoPagado = pag; s.montoEstimado = pag; }
  return s;
};
const HISTORIAL = [snap(4, { av: 30, me: 3_000_000, pag: 2_000_000 }),
                   snap(2, { av: 45, me: 4_500_000, pag: 3_200_000 })];

// Las estimaciones vivas. El total pagado de HOY —lo único que el tablero tenía
// antes de esto— es $3.2M. Sólo puede entrar en la ÚLTIMA semana, que es hoy;
// repetido hacia atrás sería la interpolación prohibida.
const ESTIMACIONES = () => [
  { no: 1, monto: 2_000_000, estatus: 'Pagada',    periodo: '05-30 de Junio 2026' },
  { no: 2, monto: 1_200_000, estatus: 'Pagada',    periodo: '' },
  { no: 3, monto: 1_500_000, estatus: 'Facturada', periodo: '01  sept  al 30 sept' },
];
const PAGADO_HOY = 3_200_000;

// El anexo. Diez meses desde el arranque, con el dinero cargado al final —que
// es la forma de los programas de obra reales y donde una recta mentiría más.
const PROGRAMA = () => ({
  inicio: fechaISO(haceSemanas(10)),
  meses: 10,
  total: PRESUPUESTO,
  partidas: [
    { sec: '1000 01', montos: [500_000, 500_000, 1_000_000, 1_000_000, 1_000_000,
                               1_000_000, 1_000_000, 1_000_000, 1_500_000, 1_500_000],
      barra: 'Barra=0-100,0-100,0-100,0-100,0-100,0-100,0-100,0-100,0-100,0-100' },
  ],
});

const TODO = (extra = {}) => ({
  obra: OBRA(), historialAvance: HISTORIAL, subs: [],
  programa: PROGRAMA(), estimaciones: ESTIMACIONES(), estCargadas: true,
  ...extra,
});

// ── EL BANCO ────────────────────────────────────────────────────────────────

function correr(codigo) {
  const { correr: ejecutar, cuenta, cuerpoDe } = taller(codigo);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const sec = (t) => { if (!process.env.CALLADO) console.log(`\n${t}`); };

  const curvaDeGobierno = cuenta('curvaDeGobierno');
  const semanasDeVentana = cuenta('semanasDeVentana');
  const curva = (props, rango = 12) =>
    curvaDeGobierno({ semanas: semanasDeVentana(props.obra, rango), ...props });

  const linea   = (g, c) => g.lineas.find(l => l.clave === c);
  const area    = (g, c) => g.areas.find(a => a.clave === c);
  const ausente = (g, c) => g.ausentes.find(a => a.clave === c);

  // ── 1 · TRES LÍNEAS, Y EL HUECO SE SOMBREA ───────────────────────────────
  // El mandato es explícito: tres series, no cuatro y no dos. Y el hueco entre
  // lo construido y lo pagado se sombrea igual que el margen.
  sec('1. Tres líneas y dos áreas: el hueco se sombrea, no se traza');
  const g = curva(TODO());
  check(g.lineas.length === 3,
    'con los tres datos capturados se dibujan TRES líneas',
    g.lineas.map(l => l.clave).join(', '));
  const claves = g.lineas.map(l => l.clave).sort().join(',');
  check(claves === 'ejec,pagado,prog',
    'y son el programado, el ejecutado y lo pagado', claves);
  check(!linea(g, 'porPagar'),
    'lo que falta pagar NO está entre las líneas');
  check(!!area(g, 'porPagar'),
    'está entre las áreas');
  check(area(g, 'porPagar')?.arriba === 'ejec' && area(g, 'porPagar')?.abajo === 'pagado',
    'y se sombrea entre lo construido y lo pagado, no entre otras dos',
    `${area(g, 'porPagar')?.arriba} → ${area(g, 'porPagar')?.abajo}`);
  // El rótulo dice EN PESOS, por el mismo motivo que el del margen: en el
  // tablero de arriba hay porcentajes, y dos cosas con el mismo nombre y
  // distinta unidad se confunden.
  check(/en pesos/i.test(area(g, 'porPagar')?.nombre || ''),
    'el rótulo del área declara su unidad: pesos, no por ciento',
    area(g, 'porPagar')?.nombre);
  check(!/%/.test(area(g, 'porPagar')?.nombre || ''),
    'y no lleva un signo de por ciento');
  check(area(g, 'atraso')?.arriba === 'ejec' && area(g, 'atraso')?.abajo === 'prog',
    'la diferencia contra el programa también se sombrea',
    `${area(g, 'atraso')?.arriba} → ${area(g, 'atraso')?.abajo}`);

  // ── 2 · NADA DEL CONTRATISTA SALE DE AQUÍ ────────────────────────────────
  // La frontera del margen, afirmada ejecutando y no leyendo el código. Se le
  // MANDA `gpData` con gasto de sobra: si la cuenta lo mirara, aparecería.
  sec('2. La frontera: se le manda el gasto y no sale por ningún lado');
  const semGP = (n) => `S${String(semanaISOde(haceSemanas(n)).sem).padStart(2, '0')}`;
  const conGasto = curva(TODO({
    gpData: { obras: { '0128': { id: '0128', nombre: 'Obra de dependencia',
      semanas: { [semGP(4)]: 1_200_000, [semGP(2)]: 900_000 } } },
      pedidas: ['0128'] },
    otrosGastos: [{ monto: 500_000, fecha: fechaISO(haceSemanas(3)) }],
    maquinaria: [],
  }));
  check(conGasto.lineas.length === 3,
    'sigue habiendo tres líneas: el gasto no se cuela como cuarta',
    conGasto.lineas.map(l => l.clave).join(', '));
  check(!linea(conGasto, 'gasto') && !linea(conGasto, 'margen'),
    'ni el gasto ni el margen están entre las líneas');
  check(!area(conGasto, 'margen'),
    'ni el margen entre las áreas');
  // Tampoco por la puerta de atrás: `ausentes` es texto que SE IMPRIME en la
  // leyenda. Declarar ahí «el gasto no está medido» le diría a la dependencia
  // que existe una cuenta de gasto que no está viendo.
  check(!ausente(conGasto, 'gasto') && !ausente(conGasto, 'margen'),
    'y la leyenda no los menciona como ausentes: para la dependencia no existen');
  // Y nada en el objeto devuelto, que es lo que el componente reparte a la
  // tabla de abajo. Una clave de gasto ahí es una fuga esperando un `map`.
  const sospechosas = Object.keys(conGasto)
    .filter(k => /gasto|margen|nomina|utilidad|costo/i.test(k));
  check(sospechosas.length === 0,
    'el objeto devuelto no trae ninguna serie de economía del contratista',
    sospechosas.length ? sospechosas.join(', ') : 'ninguna clave sospechosa');
  // Canario: que el escenario de verdad tenía gasto que filtrar. Sin esto, «no
  // hay gasto» se cumple solo con un fixture sin gasto.
  const curvaC = cuenta('curvaUnicaDeObra');
  const control = curvaC({ semanas: semanasDeVentana(OBRA(), 12),
    obra: OBRA(), historialAvance: HISTORIAL, subs: [],
    gpData: { obras: { '0128': { id: '0128', nombre: 'Obra de dependencia',
      semanas: { [semGP(4)]: 1_200_000, [semGP(2)]: 900_000 } } },
      pedidas: ['0128'] },
    otrosGastos: [], maquinaria: [], programa: PROGRAMA() });
  check(!!control.lineas.find(l => l.clave === 'gasto'),
    'canario: con ESE mismo gpData la gráfica de la constructora SÍ dibuja gasto',
    `${control.lineas.length} líneas allá`);

  // ── 3 · EL SOMBREADO ES LA RESTA DE LAS CURVAS QUE SE DIBUJAN ────────────
  // Una cuenta por número, aplicada al sombreado. Si el área tuviera su propia
  // cuenta de lo pagado, el relleno podría dejar de coincidir con el hueco que
  // se ve entre las dos curvas: el dibujo se contradiría consigo mismo.
  sec('3. El sombreado es la resta de las curvas, no una cuenta aparte');
  // El área se busca con `?.`, y si no está se cuenta como descuadre en vez de
  // reventar: una excepción saldría «no arrancó» —sin comprobar— donde lo que
  // hay es un defecto.
  const restaCuadra = (clave, arriba, abajo) => {
    const vals = area(g, clave)?.valores;
    if (!Array.isArray(vals)) return ['el área no se sombrea'];
    return g.semanas.map((s, i) => i).filter(i => {
      const a = arriba[i], b = abajo[i], v = vals[i];
      if (typeof a !== 'number' || typeof b !== 'number') return v !== null;
      return typeof v !== 'number' || Math.abs(v - (a - b)) > 1;
    });
  };
  const desc = restaCuadra('porPagar', g.ejecutado, g.pagado);
  check(desc.length === 0,
    'en todas las semanas el área es ejecutado − pagado',
    desc.length ? `descuadran ${desc.length}` : `${g.semanas.length} semanas cuadran`);
  const descAtraso = restaCuadra('atraso', g.ejecutado, g.programado);
  check(descAtraso.length === 0,
    'y el del atraso es ejecutado − programado',
    descAtraso.length ? `descuadran ${descAtraso.length}` : `${g.semanas.length} semanas cuadran`);
  const conAmbas = g.semanas.filter((s, i) =>
    typeof g.ejecutado[i] === 'number' && typeof g.pagado[i] === 'number').length;
  check(conAmbas >= 2,
    'canario: el fixture tiene semanas con ejecutado Y pagado medidos',
    `${conAmbas} semanas`);

  // ── 4 · LO PAGADO NO SE INVENTA UNA FECHA ────────────────────────────────
  // EL DEFECTO PROPIO DE ESTA GRÁFICA. No hay fecha de pago en el modelo de
  // datos: medido en producción, una estimación guarda `no`, `monto`,
  // `estatus`, `periodo` y `fechaFact`. La salida fácil es tomar el total de
  // hoy y repetirlo hacia atrás, que dibuja una recta plana con cara de medida.
  sec('4. Lo pagado sale del corte congelado, nunca del total de hoy estirado');
  // Sin NINGÚN corte congelado: es el caso de las tres obras de dependencia en
  // producción al 2026-11-06. Sólo la última semana —que es hoy— puede traer
  // el total vivo.
  const sinCorte = curva(TODO({
    historialAvance: [snap(4, { av: 30, me: 3_000_000 }),
                      snap(2, { av: 45, me: 4_500_000 })],
  }));
  const pag = sinCorte.pagado;
  const ult = pag.length - 1;
  check(pag.slice(0, ult).every(v => v === null || v === undefined),
    'sin corte congelado, todas las semanas menos la última quedan sin dato',
    `${pag.slice(0, ult).filter(v => typeof v === 'number').length} semanas con cifra`);
  check(pag[ult] === PAGADO_HOY,
    'y la última —que es hoy— trae el total vivo, que sí se sabe',
    MXN(pag[ult]));
  check(sinCorte.semanasConCorte === 0,
    'la cuenta declara que ningún cierre de la ventana trajo el corte',
    `${sinCorte.semanasConCorte} cortes`);
  // Y SE DICE EN EL PIE. Una curva que descansa en un solo punto anclado no es
  // una historia, y sin decirlo se lee como si lo fuera.
  check(sinCorte.notas.some(n => /ningún cierre|no hay historia/i.test(n)),
    'el pie avisa que no hay historia que dibujar, sólo el punto de hoy',
    sinCorte.notas.join(' · ') || 'sin notas');
  // Con cortes, el pie dice CUÁNTOS: un número con el que se puede discutir.
  check(g.notas.some(n => /\d+ de \d+ cierres/.test(n)),
    'con cortes el pie dice en cuántos de cuántos descansa la línea',
    g.notas.find(n => /cierres/.test(n)) || 'sin nota');
  // El total vivo usa el MISMO literal de «pagada» que el corte semanal: una
  // estimación Facturada no es pagada, y los $1.5M de la tercera no entran.
  check(pag[ult] !== 4_700_000,
    'una estimación Facturada no cuenta como pagada',
    `${MXN(pag[ult])}, no ${MXN(4_700_000)}`);

  // ── 5 · SIN ESTIMACIONES CARGADAS NO SE ANCLA UN CERO ────────────────────
  // La lista arranca en `[]` y se llena cuando contesta Firestore. Anclar en
  // esa ventana clava un $0 en la última semana, y $0 se lee «no se le ha
  // pagado nada» — que es una afirmación, no un hueco. Mismo motivo que la
  // guarda `cargadas` de `corteDeEstimaciones`.
  sec('5. Mientras las estimaciones viajan no se ancla un cero');
  const cargando = curva(TODO({ estimaciones: [], estCargadas: false }));
  check(cargando.pagado[cargando.pagado.length - 1] !== 0,
    'la última semana no queda en $0 por una lista que todavía no llegó',
    MXN(cargando.pagado[cargando.pagado.length - 1]));
  check(!cargando.pagadoAnclado,
    'y la cuenta declara que no ancló');
  check(/leyendo/i.test(ausente(cargando, 'pagado')?.motivo || '')
        || !!linea(cargando, 'pagado'),
    'si no hay nada que dibujar, el motivo dice que está leyendo —no que no hay pagos—',
    ausente(cargando, 'pagado')?.motivo || 'se dibuja con los cortes congelados');

  // ── 6 · LO QUE NO SE PUEDE DIBUJAR SE DECLARA, Y POR SEPARADO ────────────
  // La mentira por omisión, la misma de la gráfica única: una serie que falta y
  // simplemente no se pinta deja el dibujo afirmando por omisión. Sin la línea
  // de lo pagado no hay área sombreada, y eso se lee «está todo pagado».
  sec('6. Una serie que no se puede dibujar lo dice, con su motivo');
  const sinAnexo = curva(TODO({ programa: null }));
  check(sinAnexo.lineas.length === 2 && !linea(sinAnexo, 'prog'),
    'sin anexo quedan dos líneas: el programado no se dibuja',
    sinAnexo.lineas.map(l => l.clave).join(', '));
  check(!!ausente(sinAnexo, 'prog'),
    'y no desaparece en silencio: entra en la leyenda como ausente');
  check(/programa de obra/i.test(ausente(sinAnexo, 'prog')?.motivo || ''),
    'el motivo nombra el dato que falta y dónde cargarlo',
    ausente(sinAnexo, 'prog')?.motivo);
  // Y LA RUTA QUE DA TIENE QUE EXISTIR PARA QUIEN LA LEE. El motivo decía
  // «Planeación → Contrato», que es el camino de la CONSTRUCTORA: la
  // dependencia no tiene pestaña Planeación, su Contrato es de primer nivel.
  // Visto en el preview el 2026-11-07, con la obra OP-2026-001. Un motivo que
  // manda a un sitio que no existe es peor que no decir nada: el que lo sigue
  // concluye que la app está rota, no que le falta un archivo.
  check(!/Planeaci/i.test(ausente(sinAnexo, 'prog')?.motivo || ''),
    'y no manda a «Planeación», que en la dependencia no existe',
    ausente(sinAnexo, 'prog')?.motivo);
  // LO QUE NO SE HACE: repartir el contrato entre las fechas del plazo. Una
  // recta es una cifra inventada con cara de medida. El canario es que el
  // anexo real NO es una recta, así que una recta se puede distinguir.
  check(!sinAnexo.lineas.some(l => l.clave === 'prog'),
    'no se reconstruye una recta repartiendo el contrato entre inicio y fin');
  check(!area(sinAnexo, 'atraso') && !!ausente(sinAnexo, 'atraso'),
    'y el atraso tampoco se sombrea contra nada: se declara',
    ausente(sinAnexo, 'atraso')?.motivo);
  // Quitar el anexo NO toca el hueco de lo pagado: son independientes, y una
  // ausencia que se lleva a otra de paso es el defecto de la omisión otra vez.
  check(!!area(sinAnexo, 'porPagar'),
    'quitar el anexo no se lleva el sombreado de lo que falta pagar');

  // UNA LISTA CARGADA Y VACÍA NO ES UN HUECO: ES UN $0 MEDIDO. Una obra a la
  // que el municipio no le ha pagado nada tiene lo pagado en cero, y ése es el
  // mismo número que publica el KPI de esta pantalla. Si la gráfica declarara
  // «no se sabe» mientras el KPI de al lado dice $0, serían dos respuestas a
  // una pregunta. La ausencia de verdad es otra, y es la de abajo.
  const ceroMedido = curva(TODO({
    historialAvance: [snap(4, { av: 30, me: 3_000_000 }),
                      snap(2, { av: 45, me: 4_500_000 })],
    estimaciones: [], estCargadas: true,
  }));
  check(!!linea(ceroMedido, 'pagado'),
    'con la lista cargada y vacía lo pagado SÍ se dibuja: el cero está medido');
  const serieCero = ceroMedido.pagado;
  check(serieCero[serieCero.length - 1] === 0,
    'y vale cero en la semana de hoy, igual que el KPI de lo pagado',
    MXN(serieCero[serieCero.length - 1]));
  check(!!area(ceroMedido, 'porPagar'),
    'y el hueco se sombrea completo: todo lo construido está por pagar');

  // LA AUSENCIA DE VERDAD: la línea sólo falta mientras las estimaciones
  // viajan. Sin esa línea no hay área, y un hueco sin sombrear se lee como
  // «está todo pagado» en vez de «no se sabe».
  const sinPago = curva(TODO({
    historialAvance: [snap(4, { av: 30, me: 3_000_000 }),
                      snap(2, { av: 45, me: 4_500_000 })],
    estimaciones: [], estCargadas: false,
  }));
  check(!linea(sinPago, 'pagado') && !!ausente(sinPago, 'pagado'),
    'sin corte y sin estimaciones cargadas, lo pagado se declara ausente',
    ausente(sinPago, 'pagado')?.motivo);
  check(/fecha de pago/i.test(ausente(sinPago, 'pagado')?.motivo || ''),
    'y el motivo nombra el dato que no existe en el modelo: la fecha de pago',
    ausente(sinPago, 'pagado')?.motivo);
  check(!area(sinPago, 'porPagar') && !!ausente(sinPago, 'porPagar'),
    'el área se declara ausente en vez de desaparecer');
  check(/no se sabe/i.test(ausente(sinPago, 'porPagar')?.motivo || ''),
    'el motivo dice NO SE SABE, no que esté todo pagado',
    ausente(sinPago, 'porPagar')?.motivo);
  // Las dos ausencias son independientes: quitar lo pagado no toca el atraso.
  check(!!area(sinPago, 'atraso'),
    'y quitar lo pagado no se lleva el sombreado contra el programa');

  // Las dos a la vez: cuatro ausencias declaradas, no dos. Cada cantidad que
  // no se puede dibujar tiene su propio renglón con su propio motivo.
  const nada = curva(TODO({
    programa: null,
    historialAvance: [snap(4, { av: 30, me: 3_000_000 }),
                      snap(2, { av: 45, me: 4_500_000 })],
    estimaciones: [], estCargadas: false,
  }));
  check(nada.lineas.length === 1 && nada.areas.length === 0,
    'sin anexo y sin pagos queda una línea y ningún sombreado',
    `${nada.lineas.length} líneas, ${nada.areas.length} áreas`);
  const clavesAus = nada.ausentes.map(a => a.clave).sort().join(', ');
  check(clavesAus === 'atraso, pagado, porPagar, prog',
    'y se declaran las CUATRO cantidades que faltan, cada una con su motivo',
    clavesAus);
  check(nada.ausentes.every(a => a.motivo && a.motivo.length > 10),
    'ninguna ausencia sale sin motivo');

  // ── 7 · LA GUARDA DE MOLDE ───────────────────────────────────────────────
  // Una sola aserción de molde, al final y acompañada: todo lo de arriba es
  // conducta ejecutada. Lo que exige es que la fuga no se pueda abrir pasándole
  // `gpData` al componente, porque eso NO se puede ejecutar —el taller corre la
  // cuenta, no el árbol de React—.
  sec('7. El componente no recibe la economía del contratista');
  const comp = cuerpoDe('GraficaDelContrato');
  check(!/gpData|otrosGastos|maquinaria/.test(comp),
    'el componente de la dependencia no nombra gpData ni el gasto',
    comp.match(/gpData|otrosGastos|maquinaria/)?.[0] || 'ninguno');

  return fallos;
}

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
// Cada mutación rompe la SEMÁNTICA y tiene que salir en ROJO. Ninguna rompe el
// andamiaje: una mutación que revienta el trozo no mide que la aserción muerda,
// mide que el taller sabe parsear.
const MUTACIONES = [
  ['lo que falta pagar vuelve a ser una línea en vez de un área',
    "    areas.push({\n      clave: 'porPagar', nombre: 'Construido y no pagado, en pesos',\n      arriba: 'ejec', abajo: 'pagado', valores: porPagar,\n      colorPos: C.greenDk, colorNeg: C.redDk,\n    });",
    "    lineas.push({ clave: 'porPagar', nombre: 'Construido y no pagado, en pesos',\n      color: C.greenDk, valores: porPagar, fmt: fmtDineroCorto });"],
  ['el rótulo del área pierde la unidad',
    "      clave: 'porPagar', nombre: 'Construido y no pagado, en pesos',\n      arriba: 'ejec', abajo: 'pagado', valores: porPagar,",
    "      clave: 'porPagar', nombre: 'Construido y no pagado',\n      arriba: 'ejec', abajo: 'pagado', valores: porPagar,"],
  ['el área se saca su propia cuenta en vez de restar las curvas',
    "      arriba: 'ejec', abajo: 'pagado', valores: porPagar,",
    "      arriba: 'ejec', abajo: 'pagado',\n      valores: semanas.map((s, i) => typeof ejecutado[i] === 'number'\n        ? ejecutado[i] * 0.3 : null),"],
  // LA FUGA. Dibujar el gasto del contratista en el tablero del municipio.
  // La línea se empuja SIN CONDICIÓN, a partir de una serie que ya está en el
  // alcance. La versión anterior la condicionaba a `arguments[0].gpData` y
  // reventaba: `curvaDeGobierno` es una flecha y no tiene `arguments`, así que
  // la mutación salía roja por el andamiaje y no por la fuga. Da igual de dónde
  // salgan los pesos: lo que esta prueba muerde es que una línea de gasto
  // aparezca en la gráfica del municipio.
  ['el gasto del contratista se cuela como cuarta línea',
    "  const dibuja = (clave) => lineas.some(l => l.clave === clave);\n  const areas = [];",
    "  lineas.push({ clave: 'gasto', nombre: 'Gasto acumulado',\n    color: COLOR_CURVA.gasto, valores: ejecutado, fmt: fmtDineroCorto });\n  const dibuja = (clave) => lineas.some(l => l.clave === clave);\n  const areas = [];"],
  // La fuga por la puerta de atrás: el objeto devuelto.
  ['el objeto devuelto filtra una serie de gasto a la tabla de abajo',
    "    avance, programadoPct, programado, ejecutado, pagado, porPagar,",
    "    avance, programadoPct, programado, ejecutado, pagado, porPagar,\n    gasto: ejecutado.map(v => typeof v === 'number' ? v * 0.7 : null),"],
  // EL DEFECTO PROPIO: estirar el total de hoy hacia atrás.
  ['lo pagado de hoy se repite hacia atrás como si fuera medido',
    "  const serie = [];\n  let acarreo = ultimoConocido;\n  semanas.forEach(s => {\n    if (typeof pagadoPorSem[s.key] === 'number') acarreo = pagadoPorSem[s.key];\n    serie.push(acarreo);\n  });",
    "  const serie = semanas.map(() => pagadoVivo);"],
  ['lo pagado se ancla aunque las estimaciones no hayan llegado',
    "  const pagadoVivo = cargadas && Array.isArray(estimaciones)",
    "  const pagadoVivo = Array.isArray(estimaciones)"],
  ['una estimación Facturada se cuenta como pagada',
    "    ? estimaciones.filter(e => _ne(e?.estatus) === _ne(ESTATUS_PAGADA))",
    "    ? estimaciones.filter(e => e?.monto)"],
  ['la línea de lo pagado que falta desaparece en silencio',
    "    declarar('pagado', 'Pagado al contratista',\n      'leyendo las estimaciones: sin ellas, y sin corte semanal registrado, no ' +",
    "    if (0) declarar('pagado', 'Pagado al contratista',\n      'leyendo las estimaciones: sin ellas, y sin corte semanal registrado, no ' +"],
  ['el motivo de lo pagado deja de nombrar la fecha que falta',
    "      'leyendo las estimaciones: sin ellas, y sin corte semanal registrado, no ' +\n      'hay con qué fechar lo pagado — en las estimaciones no se captura fecha de pago');",
    "      'no hay pagos');"],
  ['el hueco ausente se calla, y se lee como que está todo pagado',
    "    declarar('porPagar', 'Construido y no pagado, en pesos',\n      !dibuja('pagado')",
    "    if (0) declarar('porPagar', 'Construido y no pagado, en pesos',\n      !dibuja('pagado')"],
  ['el hueco ausente deja de decir que no se sabe y dice que no hay',
    "        ? 'sin la línea de lo pagado no hay hueco que sombrear — no es que esté todo pagado, es que no se sabe'",
    "        ? 'no queda nada por pagar'"],
  ['el programado ausente desaparece en silencio',
    "    declarar('prog', 'Avance programado',\n      fuentePrograma === 'cargando'\n        ? 'leyendo el programa de obra…'\n        : 'no hay programa de obra capturado: carga el anexo en Contrato → Programa de obra');",
    "    void 0;"],
  // El anclaje se lleva el BLOQUE ENTERO, comentario incluido, por dos razones
  // distintas y las dos aprendidas a golpes:
  //   · el comentario «(e)» es lo único que distingue este bloque del de
  //     `curvaUnicaDeObra` —el `declarar` del atraso está escrito IGUAL en las
  //     dos cuentas, y `String.replace` muta la primera aparición—. Sin él esta
  //     mutación hería la gráfica de la constructora y salía «PASÓ», midiendo
  //     una función que el banco no observa.
  //   · y se reemplaza el bloque completo en vez de colar un `if (0)` delante
  //     del comentario: eso dejaba `if (0) const contraPrograma = …`, que no
  //     parsea, y una mutación que no parsea mide el taller, no la aserción.
  ['el atraso ausente se calla, y la obra parece ir en programa',
    "  // (e) CONTRA EL PROGRAMA. La misma área que en la otra tarjeta, con la misma\n  // cuenta: es el calendario que firmaron las dos partes, no economía de nadie.\n  const contraPrograma = huecoEntreCurvas(ejecutado, programado);\n  if (dibuja('ejec') && dibuja('prog') && hayDato(contraPrograma)) {\n    areas.push({\n      clave: 'atraso', nombre: 'Contra el programa, en pesos',\n      arriba: 'ejec', abajo: 'prog', valores: contraPrograma,\n      colorPos: C.blue, colorNeg: C.yellowDk,\n    });\n  } else {\n    declarar('atraso', 'Contra el programa, en pesos',\n      !dibuja('prog')\n        ? 'sin programa capturado no hay atraso que sombrear'\n        : 'no hay ejecutado capturado que comparar contra el programa');\n  }",
    "  // (e) CONTRA EL PROGRAMA, callando la ausencia.\n  const contraPrograma = huecoEntreCurvas(ejecutado, programado);\n  if (dibuja('ejec') && dibuja('prog') && hayDato(contraPrograma)) {\n    areas.push({\n      clave: 'atraso', nombre: 'Contra el programa, en pesos',\n      arriba: 'ejec', abajo: 'prog', valores: contraPrograma,\n      colorPos: C.blue, colorNeg: C.yellowDk,\n    });\n  }"],
  // La recta vuelve DIBUJADA, no asignada: `programado` es un `const`
  // desestructurado y asignarle revienta —y una mutación que revienta mide que
  // el taller sabe parsear, no que la aserción muerda—.
  ['sin anexo se vuelve a repartir el contrato entre las fechas del plazo',
    "  if (fuentePrograma === 'programa' && hayDato(programado)) {\n    lineas.push({\n      clave: 'prog', nombre: 'Avance programado', color: COLOR_CURVA.prog,\n      valores: programado, estilo: 'punteada', fmt: fmtDineroCorto,\n    });\n  } else {\n    declarar('prog', 'Avance programado',\n      fuentePrograma === 'cargando'\n        ? 'leyendo el programa de obra…'\n        : 'no hay programa de obra capturado: carga el anexo en Contrato → Programa de obra');",
    "  if (true) {\n    lineas.push({\n      clave: 'prog', nombre: 'Avance programado', color: COLOR_CURVA.prog,\n      valores: semanas.map((s, i) => presupuesto * ((i + 1) / semanas.length)),\n      estilo: 'punteada', fmt: fmtDineroCorto,\n    });\n  } else {"],
  // La ruta de la CONSTRUCTORA puesta en el tablero de la dependencia, que es
  // como estaba escrito hasta el 2026-11-07. Se muta sólo el destino: el resto
  // del motivo sigue bien, y por eso la aserción que muerde tiene que ser la
  // de la ruta y no la de «programa de obra».
  ['el motivo manda a la dependencia por la pestaña de la constructora',
    "        : 'no hay programa de obra capturado: carga el anexo en Contrato → Programa de obra');",
    "        : 'no hay programa de obra capturado: carga el anexo en Planeación → Contrato');"],
  ['el pie deja de decir en cuántos cierres descansa la línea',
    "  if (dibuja('pagado')) {\n    notas.push(semanasConCorte === 0",
    "  if (0) {\n    notas.push(semanasConCorte === 0"],
  ['quitar el anexo se lleva de paso el sombreado de lo pagado',
    "  const porPagar = huecoEntreCurvas(ejecutado, pagado, idxPrimerAvance);\n  if (dibuja('ejec') && dibuja('pagado') && hayDato(porPagar)) {",
    "  const porPagar = huecoEntreCurvas(ejecutado, pagado, idxPrimerAvance);\n  if (dibuja('ejec') && dibuja('pagado') && dibuja('prog') && hayDato(porPagar)) {"],
];

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
    // Reventar NO es salir en rojo. Si el trozo mutado no parsea o explota, lo
    // que quedó medido es que el taller sabe leerlo, no que la aserción muerda,
    // y contarlo como ROJO deja pasar mutaciones que nadie detecta. Eso ya
    // ocurrió: `if (0)` delante de un `const` daba «Missing semicolon» y la
    // contraprueba salía verde. Por eso es NO ARRANCÓ, que es un 2.
    try { fallos = correr(FUENTE.replace(de, a)); }
    catch (e) {
      delete process.env.CALLADO;
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

console.log('LA GRÁFICA DE GOBIERNO · tres series, y ninguna es del contratista');
const fallos = correr(FUENTE);
console.log('\n' + '─'.repeat(70));
if (fallos.length) {
  console.error(`ROJO: ${fallos.length} aserción(es) fallaron.`);
  fallos.forEach(f => console.error(`   · ${f}`));
  process.exit(1);
}
console.log('TODO EN VERDE — tres series, el hueco sombreado, y nada se filtra.');
process.exit(0);
