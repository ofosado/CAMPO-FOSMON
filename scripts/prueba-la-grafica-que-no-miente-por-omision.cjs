#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA GRÁFICA ÚNICA: UNA LÍNEA QUE NO SE PUEDE DIBUJAR TIENE QUE DECIRLO
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ EXISTE ESTE BANCO. El tablero tenía tres gráficas dibujando series
// que se solapaban —avance y economía, proyección de avance y gasto, y la Curva
// S del contrato— o sea tres sitios donde desincronizarse. El 2026-11-06 se
// unificaron en una sola cuenta, `curvaUnicaDeObra`, que arma cuatro cantidades
// sobre UN eje en pesos acumulados del contrato:
//
//   a) avance ejecutado   b) avance programado   c) gasto acumulado
//   d) el margen, que NO es una línea: es el área entre el ejecutado y el gasto
//
// EL DEFECTO QUE VIGILA, que es el motivo de la unificación y no un riesgo
// imaginado: una serie que no se puede dibujar desaparecía del dibujo. Sin la
// línea de gasto no hay área de margen, y un hueco que no se sombrea SE LEE
// COMO QUE NO HAY HUECO. La gráfica mentía por omisión, y una mentira por
// omisión es más difícil de ver que un número equivocado porque no hay cifra
// con la que discutir. Las siete obras vivas del 2026-11-06 lo exhiben: NINGUNA
// tiene programa de obra capturado, así que la cuarta serie falta en las siete.
//
// QUÉ SE AFIRMA. Conducta, ejecutada: se extrae `curvaUnicaDeObra` del archivo
// con el taller y se CORRE sobre escenarios con y sin cada dato. No se busca
// ninguna cadena en el código ni se comprueba que exista ningún nombre, con una
// excepción declarada al final (sección 7) que es una guarda de molde y va
// acompañada, nunca sola.
//
// LO QUE NO CUBRE: el SVG, los colores, la tipografía. Y el margen en PESOS
// contra el margen en PORCENTAJE del KPI: esa es la aserción de
// `prueba-una-cuenta-por-numero`, no de aquí.
//
// Uso:  node scripts/prueba-la-grafica-que-no-miente-por-omision.cjs
//       node scripts/prueba-la-grafica-que-no-miente-por-omision.cjs --contraprueba
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
  id: '0114', nombre: 'Obra de prueba', gpId: '0114',
  presupuesto: PRESUPUESTO,
  fechaInicio: fechaISO(haceSemanas(10)),
  fechaTermino: fechaISO(haceSemanas(-10)),
  esquemaSnapshot: 3,
});

// La semana ISO de una fecha, que es como el historial guarda sus cortes: por
// `semana` y `año`, no por fecha. Un snapshot sin esos dos campos cae en una
// clave `undefined` y la serie del ejecutado sale plana — el banco mediría la
// ausencia de su propio fixture.
const semanaISOde = (d) => {
  const j = new Date(d); j.setHours(0, 0, 0, 0);
  j.setDate(j.getDate() + 4 - (j.getDay() || 7));
  const ene = new Date(j.getFullYear(), 0, 1);
  return { sem: Math.ceil(((j - ene) / DIA + 1) / 7), año: j.getFullYear() };
};

// Dos cortes guardados, con monto ejecutado y avance físico. El esquema 3 es el
// vigente: así ninguna frontera se mete a punteado y lo que se mida aquí es la
// ausencia de series, no la frontera —que tiene su propio banco.
const snap = (semanas, { av, me }) => {
  const d = haceSemanas(semanas);
  const { sem, año } = semanaISOde(d);
  return { semana: sem, año,
    fecha: fechaISO(d), fechaCaptura: d.toISOString(),
    avancePonderado: av, montoEjecutado: me, esquema: 3 };
};
const HISTORIAL = [snap(4, { av: 30, me: 3_000_000 }),
                   snap(2, { av: 45, me: 4_500_000 })];

// El gasto del GP. La clave coincide con `gpId`, así que el veredicto es
// MEDIDO: eso es lo que permite que la sección 4 apague el gasto a propósito y
// se pueda distinguir «lo apagué yo» de «nunca estuvo».
const semGP = (n) => `S${String(semanaISOde(haceSemanas(n)).sem).padStart(2, '0')}`;
const GP = () => ({
  obras: { '0114': { id: '0114', nombre: 'Obra de prueba',
    semanas: { [semGP(4)]: 1_200_000, [semGP(2)]: 900_000 } } },
  pedidas: ['0114'],
});

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
  obra: OBRA(), historialAvance: HISTORIAL, subs: [], gpData: GP(),
  otrosGastos: [], maquinaria: [], programa: PROGRAMA(), ...extra,
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

  const curvaUnicaDeObra = cuenta('curvaUnicaDeObra');
  const semanasDeVentana = cuenta('semanasDeVentana');
  const curva = (props, rango = 12) =>
    curvaUnicaDeObra({ semanas: semanasDeVentana(props.obra, rango), ...props });

  const linea   = (g, c) => g.lineas.find(l => l.clave === c);
  const area    = (g, c) => g.areas.find(a => a.clave === c);
  const ausente = (g, c) => g.ausentes.find(a => a.clave === c);

  // ── 1 · LAS CUATRO CANTIDADES, Y EL MARGEN NO ES UNA LÍNEA ───────────────
  // El mandato es explícito: cuatro cantidades, y la cuarta es un ÁREA. Si el
  // margen volviera a ser una serie, el dibujo tendría una línea más y el
  // hueco entre el ejecutado y el gasto quedaría sin sombrear — que es
  // exactamente lo que la gráfica existe para hacer evidente.
  sec('1. Tres líneas y dos áreas: el margen se sombrea, no se traza');
  const g = curva(TODO());
  check(g.lineas.length === 3,
    'con los tres datos capturados se dibujan TRES líneas',
    g.lineas.map(l => l.clave).join(', '));
  check(!linea(g, 'margen'),
    'el margen NO está entre las líneas');
  check(!!area(g, 'margen'),
    'el margen está entre las áreas');
  check(area(g, 'margen')?.arriba === 'ejec' && area(g, 'margen')?.abajo === 'gasto',
    'y se sombrea entre el ejecutado y el gasto, no entre otras dos',
    `${area(g, 'margen')?.arriba} → ${area(g, 'margen')?.abajo}`);
  // El rótulo dice EN PESOS, porque arriba en el tablero el margen es un
  // porcentaje: dos cosas con el mismo nombre y distinta unidad se confunden.
  check(/en pesos/i.test(area(g, 'margen')?.nombre || ''),
    'el rótulo del área declara su unidad: pesos, no por ciento',
    area(g, 'margen')?.nombre);
  check(!/%/.test(area(g, 'margen')?.nombre || ''),
    'y no lleva un signo de por ciento que lo haga pasar por el KPI');
  // La segunda área: lo que hace evidente el atraso de un vistazo.
  check(area(g, 'atraso')?.arriba === 'ejec' && area(g, 'atraso')?.abajo === 'prog',
    'la diferencia contra el programa también se sombrea',
    `${area(g, 'atraso')?.arriba} → ${area(g, 'atraso')?.abajo}`);
  check(/en pesos/i.test(area(g, 'atraso')?.nombre || ''),
    'y en la misma unidad que todo lo demás del eje',
    area(g, 'atraso')?.nombre);

  // ── 2 · EL ÁREA ES LA RESTA DE LAS DOS LÍNEAS QUE SE DIBUJAN ─────────────
  // Una cuenta por número, aplicada al sombreado. Si el área tuviera su propia
  // cuenta del gasto, el relleno podría dejar de coincidir con el hueco que se
  // ve entre las dos curvas: el dibujo se contradiría consigo mismo.
  sec('2. El sombreado es la resta de las curvas, no una cuenta aparte');
  // El área se busca con `?.`, y si no está se cuenta como descuadre en vez de
  // reventar: una excepción saldría «no arrancó» —sin comprobar— donde lo que
  // hay es un defecto. La diferencia entre rojo y no arrancó es la mitad de lo
  // que vale una prueba.
  const restaCuadra = (clave, arriba, abajo) => {
    const vals = area(g, clave)?.valores;
    if (!Array.isArray(vals)) return ['el área no se sombrea'];
    return g.semanas.map((s, i) => i).filter(i => {
      const a = arriba[i], b = abajo[i], v = vals[i];
      if (typeof a !== 'number' || typeof b !== 'number') return v !== null;
      return typeof v !== 'number' || Math.abs(v - (a - b)) > 1;
    });
  };
  const descuadra = restaCuadra('margen', g.ejecutado, g.gasto);
  check(descuadra.length === 0,
    'en todas las semanas el área del margen es ejecutado − gasto',
    descuadra.length ? `descuadran ${descuadra.length}` : `${g.semanas.length} semanas cuadran`);
  const desAtraso = restaCuadra('atraso', g.ejecutado, g.programado);
  check(desAtraso.length === 0,
    'y el del atraso es ejecutado − programado',
    desAtraso.length ? `descuadran ${desAtraso.length}` : `${g.semanas.length} semanas cuadran`);
  // Canario del par: que haya semanas con las dos cosas medidas. Sin esto, «no
  // descuadra ninguna» se cumple sola con dos series vacías.
  const conAmbas = g.semanas.filter((s, i) =>
    typeof g.ejecutado[i] === 'number' && typeof g.gasto[i] === 'number').length;
  check(conAmbas >= 2,
    'canario: el fixture tiene semanas con ejecutado Y gasto medidos',
    `${conAmbas} semanas`);

  // ── 3 · SIN ANEXO NO HAY PROGRAMADO, Y SE DICE ───────────────────────────
  // El caso de las SIETE obras vivas al 2026-11-06: ninguna tiene programa
  // capturado. Lo que NO se hace es repartir el contrato entre el inicio y el
  // fin: una recta es una cifra inventada con cara de medida, y se lee como un
  // plan diga lo que diga la leyenda. Se quitó el 2026-11-06.
  sec('3. Sin programa capturado no hay línea, y la leyenda dice por qué');
  const sinAnexo = curva(TODO({ programa: null }));
  check(sinAnexo.lineas.length === 2,
    'quedan dos líneas, no tres: el programado no se dibuja',
    sinAnexo.lineas.map(l => l.clave).join(', '));
  check(!linea(sinAnexo, 'prog') && !!ausente(sinAnexo, 'prog'),
    'y no desaparece en silencio: entra en la leyenda como ausente');
  check(/programa de obra/i.test(ausente(sinAnexo, 'prog')?.motivo || ''),
    'el motivo nombra el dato que falta y dónde cargarlo',
    ausente(sinAnexo, 'prog')?.motivo);
  // Y la recta no vuelve por la puerta de atrás: ninguna semana trae un
  // programado reconstruido del plazo.
  check(sinAnexo.programado.every(v => v === null || v === undefined),
    'ninguna semana publica un programado repartido entre las fechas');
  check(sinAnexo.programadoPct.every(v => v === null || v === undefined),
    'ni su porcentaje, que es la misma cifra inventada en otra unidad');
  // Sin programado no hay atraso que sombrear, y eso TAMBIÉN se declara: un
  // área que falta sin decirlo se lee como «va en programa».
  check(!area(sinAnexo, 'atraso') && !!ausente(sinAnexo, 'atraso'),
    'el área de atraso no se sombrea Y se declara ausente');
  check(/sin programa/i.test(ausente(sinAnexo, 'atraso')?.motivo || ''),
    'diciendo que es el programa lo que falta, no que la obra vaya al día',
    ausente(sinAnexo, 'atraso')?.motivo);
  // El margen sí sigue: no depende del anexo. Si una ausencia arrastrara a la
  // otra, cargar el anexo «arreglaría» un margen que nunca estuvo roto.
  check(!!area(sinAnexo, 'margen'),
    'y el margen sigue sombreándose: no depende del programa');

  // ── 4 · SIN GASTO NO HAY MARGEN, Y ESO NO ES UN CERO ─────────────────────
  // LA aserción de este banco. Sin la línea de gasto no hay hueco que
  // sombrear, y un hueco sin dibujar se lee como «no hay hueco» — o sea como
  // «no hay margen», cuando lo cierto es que no se sabe. La leyenda tiene que
  // decir la diferencia con esas palabras.
  sec('4. Sin gasto medido el margen no es cero: es que no se sabe');
  const sinGasto = curva(TODO({ gpData: { obras: {}, pedidas: [] } }));
  check(sinGasto.gastoMedido === false,
    'el veredicto del gasto llega a la cuenta',
    `gastoMedido=${sinGasto.gastoMedido}`);
  check(!linea(sinGasto, 'gasto') && !!ausente(sinGasto, 'gasto'),
    'la línea de gasto no se dibuja Y se declara ausente',
    ausente(sinGasto, 'gasto')?.motivo);
  check(!area(sinGasto, 'margen'),
    'el área del margen no se sombrea contra un borde que no existe');
  check(!!ausente(sinGasto, 'margen'),
    'pero tampoco se calla: el margen entra en la leyenda');
  check(/no se sabe/.test(ausente(sinGasto, 'margen')?.motivo || ''),
    'y el motivo dice que NO SE SABE, no que no haya margen',
    ausente(sinGasto, 'margen')?.motivo);
  check(sinGasto.margen.every(v => v === null || v === undefined),
    'ninguna semana publica un margen restado contra un cero inventado');
  // El atraso sigue, por la misma razón simétrica que el margen de la sección 3.
  check(!!area(sinGasto, 'atraso'),
    'y el atraso sigue sombreándose: no depende del gasto');

  // ── 5 · LAS DOS AUSENCIAS A LA VEZ: LA OBRA REAL ────────────────────────
  // El caso de la 0121 sembrada en el emulador, y el de las siete obras vivas:
  // sin anexo y sin gasto. Queda UNA línea. Lo que no puede pasar es que el
  // dibujo quede con una sola curva y sin una palabra de por qué.
  sec('5. Sin anexo y sin gasto queda una línea y cuatro ausencias declaradas');
  const pelada = curva(TODO({ programa: null, gpData: { obras: {}, pedidas: [] } }));
  check(pelada.lineas.length === 1 && pelada.lineas[0].clave === 'ejec',
    'queda sólo el ejecutado',
    pelada.lineas.map(l => l.clave).join(', '));
  check(pelada.areas.length === 0,
    'y ninguna área: no hay con qué restar');
  // CUATRO, no tres: faltan las dos líneas —programado y gasto— y las dos áreas
  // que se cerraban contra ellas. Cada ausencia se declara por su cuenta; si una
  // arrastrara a otra, al cargar el anexo «aparecería» un margen que seguiría
  // sin medirse.
  const claves = pelada.ausentes.map(a => a.clave).sort();
  check(claves.join(',') === 'atraso,gasto,margen,prog',
    'las cuatro ausencias están declaradas, una por una', claves.join(', '));
  check(pelada.ausentes.every(a => a.motivo && a.motivo.length > 10),
    'y cada una con su motivo: un rótulo sin motivo no se puede discutir');
  check(pelada.ausentes.every(a => a.nombre && a.nombre.length > 0),
    'y con el nombre de la cantidad que falta, no sólo su clave');

  // ── 6 · EL DESAJUSTE DE BASES SE DECLARA, NO SE REESCALA ────────────────
  // El anexo trae su propio total. Si no coincide con el contrato capturado las
  // dos curvas terminan a alturas distintas, y reescalar una esconde un defecto
  // del dato: el usuario vería dos curvas cerrando juntas y creería que el
  // anexo cuadra con el contrato.
  sec('6. Si el anexo y el contrato no suman igual, se dice');
  const desigual = curva(TODO({
    programa: { ...PROGRAMA(), total: PRESUPUESTO * 1.2,
      partidas: [{ ...PROGRAMA().partidas[0],
        montos: PROGRAMA().partidas[0].montos.map(m => m * 1.2) }] },
  }));
  const nota = (desigual.notas || []).find(n => /no cierran a la misma altura/.test(n));
  check(!!nota, 'el pie de la gráfica declara el desajuste de bases', nota);
  check(/\$/.test(nota || ''),
    'y lo declara con las DOS cifras, no con un aviso genérico', nota);
  check(desigual.presupuesto === PRESUPUESTO,
    'y el eje sigue siendo el del contrato capturado, sin reescalarse',
    MXN(desigual.presupuesto));
  // Canario: con el anexo cuadrado no hay nota. Una nota permanente se vuelve
  // decoración y se deja de leer.
  check(!(g.notas || []).some(n => /no cierran a la misma altura/.test(n)),
    'canario: con el anexo cuadrado el pie no avisa nada');

  // ── 7 · LAS LÍNEAS SE PRENDEN Y SE APAGAN, Y EL EJE NO SE MUEVE ─────────
  // Dos reglas del mandato, las dos sobre `PanelSemanal`:
  //   · al abrir salen TODAS, y el estado no se recuerda entre sesiones;
  //   · apagar una línea NO reescala el eje. Si se reajustara, apagar el gasto
  //     haría crecer al ejecutado en pantalla y parecería que la obra avanzó.
  //     Prender y apagar es una ayuda para leer, no debe alterar lo leído.
  sec('7. Prender y apagar una línea no cambia lo que se lee');
  // El doble del hook resuelve el inicializador perezoso, que es lo que
  // `PanelSemanal` usa. El de la caja devuelve la función sin llamarla.
  const conApagadas = (lista) => ejecutar('PanelSemanal', {
    semanas: g.semanas, series: g.lineas, areas: g.areas, ausentes: g.ausentes,
    fmt: String, fmtEje: String, titulo: 'x', pie: null,
    useState: (v) => [lista !== null ? lista : (typeof v === 'function' ? v() : v),
                      () => {}],
    // `useId` sólo nombra los `clipPath`: no entra en ninguna cuenta. Se dobla
    // el hook, nunca la cuenta.
    React: { useId: () => ':r0:' },
    // Los valores por omisión de la firma del componente HAY QUE PASARLOS: el
    // taller recorta el cuerpo, no la firma, así que un `maxFijo = null` llega
    // como `undefined`, y `undefined !== null` haría que la escala se tomara de
    // `maxFijo` — `maxValor` saldría `undefined` y la aserción del eje pasaría
    // comparando dos nadas. El eje de la tarjeta real tampoco los fija: la
    // gráfica única llama al panel sin ellos y toma la escala de las series.
    maxFijo: null, minFijo: null, ejeAbajo: true, altura: 150,
  });
  const abierto = conApagadas(null);
  check(Array.isArray(abierto.apagadas) && abierto.apagadas.length === 0,
    'al abrir no hay ninguna apagada', JSON.stringify(abierto.apagadas));
  check(abierto.vivos.length === g.lineas.length,
    'así que las tres líneas salen dibujadas',
    `${abierto.vivos.length} de ${g.lineas.length}`);
  check(abierto.areasVivas.length === g.areas.length,
    'y las dos áreas también', `${abierto.areasVivas.length} de ${g.areas.length}`);

  const apagado = conApagadas(['gasto']);
  check(apagado.vivos.length === g.lineas.length - 1
        && !apagado.vivos.some(s => s.clave === 'gasto'),
    'apagar el gasto lo quita del dibujo',
    apagado.vivos.map(s => s.clave).join(', '));
  // EL EJE SE MIDE APAGANDO LA LÍNEA QUE LO FIJA, no una cualquiera. Apagar el
  // gasto no movería la escala ni recalculándola, porque el techo lo pone el
  // ejecutado: la aserción pasaría por la forma del fixture y no por la del
  // código. Se apaga el ejecutado, que es quien tiene el máximo.
  const maxDe = (serie) => Math.max(...serie.filter(v => typeof v === 'number'));
  const maxEjec = maxDe(g.ejecutado);
  const maxResto = Math.max(maxDe(g.gasto), maxDe(g.programado));
  check(maxEjec > maxResto,
    'canario: el ejecutado es el que fija el techo del eje',
    `ejecutado ${MXN(maxEjec)} contra ${MXN(maxResto)} del resto`);
  // Y que haya qué comparar: dos `undefined` son iguales y la aserción de abajo
  // pasaría sin haber medido el eje.
  check(typeof abierto.maxValor === 'number' && abierto.maxValor > 0,
    'canario: el eje abierto trae un máximo que es un número',
    MXN(abierto.maxValor));
  const sinTecho = conApagadas(['ejec']);
  check(sinTecho.maxValor === abierto.maxValor && sinTecho.minValor === abierto.minValor,
    'apagar la línea que fija el techo NO mueve el eje',
    `${MXN(sinTecho.maxValor)} / ${MXN(sinTecho.minValor)}`);
  check(apagado.maxValor === abierto.maxValor && apagado.minValor === abierto.minValor,
    'y apagar el gasto tampoco',
    `${MXN(apagado.maxValor)} / ${MXN(apagado.minValor)}`);
  // Y el área del margen se va con su borde: sombrear contra una línea que el
  // usuario apagó dibuja un hueco contra nada.
  check(!apagado.areasVivas.some(a => a.clave === 'margen'),
    'y el área del margen se va con la línea que la cerraba');
  // …PERO NO SE DECLARA AUSENTE. Esa desaparición la pidió quien mira, y
  // explicársela sería ruido. La regla del mandato es sobre lo que la pantalla
  // no puede dibujar, no sobre lo que el usuario apagó.
  check(!(apagado.areasMudas || []).some(a => a.clave === 'margen'),
    'y no se le explica por qué: apagarla fue decisión de quien mira',
    (apagado.areasMudas || []).map(a => a.clave).join(', ') || 'ninguna');

  // ── 7b · UN ÁREA QUE NO ALCANZA A SOMBREARSE TAMPOCO DESAPARECE ─────────
  // La misma regla del banco —lo que no se puede dibujar lo dice— aplicada al
  // caso que se vio en el preview el 2026-11-07, en el tablero del municipio:
  // las dos líneas EXISTEN, pero sólo coinciden en UNA semana, y una banda de
  // un solo punto no es una banda. El área se caía de la leyenda sin dejar
  // rastro y el hueco quedaba sin nombrar, que es exactamente la mentira por
  // omisión que este banco persigue. No es hipotético: lo pagado descansa hoy
  // en el ancla de la última semana en las tres obras de dependencia, así que
  // «construido y no pagado» se esfumaba en las tres.
  sec('7b. El área que no se puede sombrear se nombra, no se esfuma');
  const solape = (n) => ejecutar('PanelSemanal', {
    semanas: g.semanas.map(s => ({...s})),
    series: [
      {clave:'arriba', nombre:'Arriba', color:'#000',
       valores: g.semanas.map(() => 100)},
      // Dato en `n` semanas y nada en el resto: con una sola no hay banda.
      {clave:'abajo', nombre:'Abajo', color:'#111',
       valores: g.semanas.map((s, i) => i < n ? 40 : null)},
    ],
    areas: [{clave:'hueco', nombre:'Lo de arriba menos lo de abajo, en pesos',
             arriba:'arriba', abajo:'abajo',
             valores: g.semanas.map((s, i) => i < n ? 60 : null),
             colorPos:'#0a0', colorNeg:'#a00'}],
    ausentes: [],
    fmt: String, fmtEje: String, titulo: 'x', pie: null,
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    React: { useId: () => ':r0:' },
    maxFijo: null, minFijo: null, ejeAbajo: true, altura: 150,
  });
  // Canario: con DOS semanas de solape sí hay banda. Sin él, la aserción de
  // abajo pasaría igual si el panel se hubiera roto y no sombreara nunca nada.
  const dos = solape(2);
  check(dos.areasVivas.length === 1,
    'canario: con dos semanas de solape el área sí se sombrea',
    `${dos.areasVivas.length} área(s)`);
  check((dos.areasMudas || []).length === 0,
    'y entonces no hay nada que explicar');

  const una = solape(1);
  check(una.areasVivas.length === 0,
    'con una sola semana no se puede sombrear, y no se sombrea',
    `${una.areasVivas.length} área(s)`);
  check((una.areasMudas || []).some(a => a.clave === 'hueco'),
    'pero el área NO desaparece: queda nombrada en la leyenda',
    (una.areasMudas || []).map(a => a.clave).join(', ') || 'ninguna');
  const mudo = (una.areasMudas || []).find(a => a.clave === 'hueco') || {};
  check(/una semana/.test(mudo.motivo || ''),
    'y con su motivo, que dice qué le faltó', mudo.motivo);
  check(mudo.nombre === 'Lo de arriba menos lo de abajo, en pesos',
    'con el MISMO nombre que habría llevado sombreada: quien lee compara',
    mudo.nombre);

  // ── 8 · LAS GUARDAS DE MOLDE ────────────────────────────────────────────
  // Aserciones de molde, no de existencia: lo que se exige es que un patrón que
  // ya produjo el defecto no esté escrito. Van al final y acompañadas, nunca
  // solas — todo lo de arriba es conducta ejecutada.
  sec('8. Los moldes que producirían el defecto no están en el archivo');
  const panel = cuerpoDe('PanelSemanal');
  // «El estado no se recuerda entre sesiones» es una AUSENCIA, y una ausencia
  // no se puede ejecutar: no hay escenario en el que una lectura de
  // `localStorage` que no está se note. Se afirma como molde a propósito, y
  // acompañada de la sección 7, que sí ejecuta el estado inicial.
  check(!/localStorage|sessionStorage/.test(panel),
    'el panel no guarda qué líneas quedaron apagadas: al abrir salen todas');
  // La escala se calcula sobre las series CON DATO, no sobre las vivas. Es la
  // misma afirmación que midió la sección 7, escrita sobre el molde porque es
  // la forma en que el defecto volvería: cambiar `conDato` por `vivos`.
  const compacto = panel.replace(/\s+/g, '');
  check(!/consttodos=vivos/.test(compacto),
    'el eje no se calcula sobre las líneas encendidas');

  return fallos;
}

// ── CONTRAPRUEBA ────────────────────────────────────────────────────────────
// Cada mutación rompe la SEMÁNTICA y tiene que salir en ROJO. Ninguna rompe el
// andamiaje: una mutación que revienta el trozo no mide que la aserción muerda,
// mide que el taller sabe parsear.
const MUTACIONES = [
  ['el margen vuelve a ser una tercera línea en vez de un área',
    "    areas.push({\n      clave: 'margen', nombre: 'Margen bruto acumulado, en pesos',\n      arriba: 'ejec', abajo: 'gasto', valores: margen,\n      colorPos: C.greenDk, colorNeg: C.redDk,\n    });",
    "    lineas.push({ clave: 'margen', nombre: 'Margen bruto acumulado, en pesos',\n      color: C.greenDk, valores: margen, fmt: fmtDineroCorto });"],
  ['el rótulo del área pierde la unidad y se confunde con el % del KPI',
    "      clave: 'margen', nombre: 'Margen bruto acumulado, en pesos',\n      arriba: 'ejec', abajo: 'gasto', valores: margen,",
    "      clave: 'margen', nombre: 'Margen bruto acumulado',\n      arriba: 'ejec', abajo: 'gasto', valores: margen,"],
  ['el área del margen se saca su propia cuenta en vez de restar las curvas',
    "      arriba: 'ejec', abajo: 'gasto', valores: margen,",
    "      arriba: 'ejec', abajo: 'gasto',\n      valores: semanas.map((s, i) => typeof ejecutado[i] === 'number'\n        ? ejecutado[i] * 0.3 : null),"],
  ['la línea de gasto que falta desaparece en silencio',
    "    declarar('gasto', 'Gasto acumulado',\n      'el gasto de esta obra no está medido: GP no la conoce con esta clave');",
    "    void 0;"],
  ['el margen ausente se calla, y el hueco sin sombrear se lee como que no hay',
    "    declarar('margen', 'Margen bruto acumulado, en pesos',\n      !dibuja('gasto')",
    "    if (0) declarar('margen', 'Margen bruto acumulado, en pesos',\n      !dibuja('gasto')"],
  ['el margen ausente deja de decir que no se sabe y dice que no hay',
    "        ? 'sin la línea de gasto no hay hueco que sombrear — no es que no haya margen, es que no se sabe'",
    "        ? 'sin gasto el margen es cero'"],
  ['el programado ausente desaparece en silencio',
    "    declarar('prog', 'Avance programado',\n      fuentePrograma === 'cargando'",
    "    if (0) declarar('prog', 'Avance programado',\n      fuentePrograma === 'cargando'"],
  ['el atraso ausente se calla, y la obra parece ir en programa',
    "    declarar('atraso', 'Contra el programa, en pesos',\n      !dibuja('prog')",
    "    if (0) declarar('atraso', 'Contra el programa, en pesos',\n      !dibuja('prog')"],
  // La recta vuelve DIBUJADA, no asignada: `programado` es un `const`
  // desestructurado y asignarle revienta —y una mutación que revienta mide que
  // el taller sabe parsear, no que la aserción muerda—.
  ['sin anexo se vuelve a repartir el contrato entre las fechas del plazo',
    "  if (fuentePrograma === 'programa' && hayDato(programado)) {\n    lineas.push({\n      clave: 'prog', nombre: 'Avance programado', color: COLOR_CURVA.prog,\n      valores: programado, estilo: 'punteada', fmt: fmtDineroCorto,\n    });",
    "  if (true) {\n    lineas.push({\n      clave: 'prog', nombre: 'Avance programado', color: COLOR_CURVA.prog,\n      valores: semanas.map((s, i) => presupuesto * ((i + 1) / semanas.length)),\n      estilo: 'punteada', fmt: fmtDineroCorto,\n    });"],
  ['el desajuste entre el anexo y el contrato se deja de declarar',
    "    notas.push(`el anexo suma ${fmtDineroCorto(totalPrograma)} y el contrato ` +",
    "    if (0) notas.push(`el anexo suma ${fmtDineroCorto(totalPrograma)} y el contrato ` +"],
  ['el desajuste se declara sin las cifras, con un aviso genérico',
    "    notas.push(`el anexo suma ${fmtDineroCorto(totalPrograma)} y el contrato ` +\n      `capturado ${fmtDineroCorto(presupuesto)}: las dos curvas no cierran a la misma altura`);",
    "    notas.push('las dos curvas no cierran a la misma altura');"],
  ['el eje se reescala al apagar una línea',
    '  const todos = series.filter(conDato)\n    .flatMap(s => s.valores.filter(v => v !== null && v !== undefined));',
    '  const todos = vivos\n    .flatMap(s => s.valores.filter(v => v !== null && v !== undefined));'],
  ['alguna línea arranca apagada',
    '  const [apagadas, setApagadas] = useState(() => []);',
    "  const [apagadas, setApagadas] = useState(() => ['gasto']);"],
  ['el área se sigue sombreando contra una línea que el usuario apagó',
    '  const puntosDe = (clave) => {\n    const s = vivos.find(x => x.clave === clave);',
    '  const puntosDe = (clave) => {\n    const s = series.find(x => x.clave === clave);'],
  // EL DEFECTO TAL COMO ESTABA ESCRITO hasta el 2026-11-07: el área que no
  // alcanza a sombrearse se cae de la leyenda en silencio. Se muta el bloque
  // entero —la declaración y el `return null`— porque dejar el `push` sin el
  // `if` cambiaría otra cosa, y el anclaje lleva el comentario de la línea de
  // arriba para no calzar en ningún otro `if (idx.length < 2)` del archivo.
  ['el área que no se puede sombrear se cae de la leyenda sin decir nada',
    "    if (idx.length < 2) {\n      areasMudas.push({clave:a.clave, nombre:a.nombre,",
    "    if (idx.length < 2) return null;\n    if (0) {\n      areasMudas.push({clave:a.clave, nombre:a.nombre,"],
  // Y LA OTRA MITAD DE LA REGLA: declararla SIEMPRE que no se dibuje, también
  // cuando quien mira la apagó a mano. Eso no es honestidad, es ruido, y el
  // ruido entrena a no leer la leyenda.
  ['también se le explica al usuario el área que él mismo apagó',
    '    const pa = puntosDe(a.arriba), pb = puntosDe(a.abajo);\n    if (!pa || !pb) return null;',
    "    const pa = puntosDe(a.arriba), pb = puntosDe(a.abajo);\n    if (!pa || !pb) {\n      areasMudas.push({clave:a.clave, nombre:a.nombre, motivo:'una semana no basta'});\n      return null;\n    }"],
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
    try { fallos = correr(FUENTE.replace(de, a)); }
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

console.log('LA GRÁFICA ÚNICA · una línea que no se puede dibujar tiene que decirlo');
const fallos = correr(FUENTE);
console.log('\n' + '─'.repeat(70));
if (fallos.length) {
  console.error(`ROJO: ${fallos.length} aserción(es) fallaron.`);
  fallos.forEach(f => console.error(`   · ${f}`));
  process.exit(1);
}
console.log('TODO EN VERDE — ninguna cantidad falta en silencio.');
process.exit(0);
