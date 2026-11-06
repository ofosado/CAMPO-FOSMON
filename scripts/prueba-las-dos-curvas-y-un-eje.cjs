#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LAS DOS CURVAS Y UN SOLO EJE — PENDIENTES #51 (el avance contra una recta)
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ CAMBIÓ. «Tendencias» mostraba una métrica a la vez tras una fila de
// pestañas —avance / gasto / margen—, sin el programa contractual encima, y el
// tablero del municipio no tenía ninguna gráfica. Ahora la constructora ve dos
// paneles apilados sobre UN eje de semanas (la curva S arriba, su economía
// abajo) y la dependencia ve la curva S sola, en `CurvaSDelContrato`.
//
// LOS DOS COMPONENTES COMPARTEN LAS CUENTAS, NO EL CÓDIGO DE PANTALLA:
// `semanasDeVentana`, `serieAvanceDeSemanas` y `serieProgramadaDeSemanas` están
// a nivel de módulo. Eso es lo que este banco defiende, porque la alternativa
// obvia —copiar el eje de semanas en el componente del municipio— es
// exactamente cómo se llega a que la misma obra publique dos avances distintos
// en dos pantallas a dos clics. Ya pasó con el atraso: −29pp en el Dashboard y
// −17pp en Operación, misma obra, mismo día (2026-11-04, obra 0114).
//
// Y DEFIENDE LA FRONTERA DEL MARGEN POR EL LADO DIFÍCIL. Que la dependencia no
// vea dinero no se comprueba leyendo la lista de props: se le mete el dinero de
// todas formas y se revisa que ninguno de los valores que su render puede
// dibujar lo lleve. El canario se comprueba antes: la MISMA inyección tiene que
// aparecer en los locales de la tarjeta de la constructora. Un verde sobre un
// canario sordo no prueba nada.
//
// CÓMO SE AFIRMA. No se busca ninguna frase en el código ni se comprueba que
// exista ningún nombre. Se extrae por AST el prólogo de cálculo de cada
// componente —todo lo anterior a su `return`— y se EJECUTA fuera de React con
// dobles. Lo que se compara son las series resultantes, que es lo que la
// pantalla dibuja.
//
// Las cifras esperadas no se teclean: salen de ejecutar `avanceProgramadoA`,
// que es la cuenta del repositorio. Y el calendario del fixture es relativo a
// hoy, porque `serieProgramadaDeSemanas` llama a `hoyLocalISO()` por dentro: un
// fixture con fechas fijas envejece y el banco empieza a fallar solo un martes
// cualquiera.
//
// Lo que NO cubre: el SVG, los colores, el tooltip, el orden de los renglones.
//
// Uso:  node scripts/prueba-las-dos-curvas-y-un-eje.cjs
//       node scripts/prueba-las-dos-curvas-y-un-eje.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ARCHIVO = path.join(raiz, 'src/App.jsx');
const FUENTE = fs.readFileSync(ARCHIVO, 'utf8');
const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining',
            'nullishCoalescingOperator', 'dynamicImport'],
};

// ── La máquina de extracción ───────────────────────────────────────────────
//
// Los helpers de módulo NO se listan a mano. Se toma el cierre transitivo de
// las variables libres del prólogo sobre las declaraciones `const` de primer
// nivel del archivo, y se copian TAL CUAL. Una lista a mano se desactualiza en
// el primer refactor y entonces el banco revienta por su lista, no por el
// defecto — o peor, un doble silencia justo la cuenta que había que vigilar.

const BUILTINS = new Set(['Object','Math','Date','Number','String','Array','JSON','Boolean',
  'isNaN','isFinite','parseFloat','parseInt','console','Map','Set','NaN','undefined',
  'Infinity','RegExp','Error','Promise','Intl','Symbol','globalThis']);

const libresDe = (src) => {
  const a = parse(src, { ...OPTS, allowReturnOutsideFunction: true });
  let g = [];
  traverse(a, { Program(p) { g = Object.keys(p.scope.globals); p.stop(); } });
  return g.filter(n => !BUILTINS.has(n));
};

// Los returns tempranos devuelven JSX, que `new Function` no sabe leer. Cada
// elemento JSX de nivel superior se sustituye por `null`: con los datos de
// prueba esas ramas no se toman, y si alguna se tomara el `null` haría que el
// escenario falle de forma visible.
const sinJSX = (src) => {
  const a = parse(src, { ...OPTS, allowReturnOutsideFunction: true });
  const rangos = [];
  traverse(a, {
    'JSXElement|JSXFragment'(p) {
      if (p.findParent(q => q.isJSXElement() || q.isJSXFragment())) return;
      rangos.push([p.node.start, p.node.end]);
      p.skip();
    },
  });
  rangos.sort((x, y) => y[0] - x[0]);
  let out = src;
  rangos.forEach(([i, j]) => { out = out.slice(0, i) + 'null' + out.slice(j); });
  return out;
};

function taller(codigo) {
  const ast = parse(codigo, OPTS);
  const consts = [];          // [{nombre, fuente, orden}] en orden de archivo
  const porNombre = new Map();
  const comps = {};
  traverse(ast, {
    VariableDeclaration(p) {
      if (p.parent.type !== 'Program') return;
      const d = p.node.declarations[0];
      if (d?.id?.type !== 'Identifier') return;
      const reg = { nombre: d.id.name, fuente: codigo.slice(p.node.start, p.node.end),
                    orden: consts.length };
      consts.push(reg);
      porNombre.set(reg.nombre, reg);
    },
    FunctionDeclaration(p) {
      if (p.parent.type !== 'Program') return;
      const n = p.node.id?.name;
      if (n) comps[n] = p.node;
    },
  });

  const prologoDe = (nodo) => {
    const cuerpo = nodo.body.body;
    const corte = cuerpo.findIndex(s => s.type === 'ReturnStatement');
    const hasta = corte === -1 ? cuerpo.length : corte;
    if (hasta === 0) return null;
    return sinJSX(codigo.slice(cuerpo[0].start, cuerpo[hasta - 1].end));
  };

  // Cierre transitivo: qué `const` de módulo hacen falta para que el prólogo
  // corra. Las que no se alcanzan no se copian — el preludio se queda chico y
  // un nombre que desaparezca del archivo se nota al instante.
  const preludioPara = (prologo) => {
    const necesarios = new Set();
    const pendientes = libresDe(prologo);
    while (pendientes.length) {
      const n = pendientes.pop();
      if (necesarios.has(n) || !porNombre.has(n)) continue;
      necesarios.add(n);
      libresDe(porNombre.get(n).fuente).forEach(m => {
        if (m !== n && !necesarios.has(m)) pendientes.push(m);
      });
    }
    return consts.filter(c => necesarios.has(c.nombre))
                 .sort((a, b) => a.orden - b.orden)
                 .map(c => c.fuente).join('\n');
  };

  // Dobles: React fuera de React, y nada más.
  //
  // Aquí estaba cableado `resolverGastoGP: () => 0`, para que el único dinero
  // del escenario fuera el que la prueba inyecta. Eso doblaba una CUENTA, no
  // un hook, y con #100 se volvió una mentira: el cero que devolvía no traía
  // consigo el veredicto, así que la prueba creía estar mirando un gasto de
  // cero cuando el archivo —que resuelve el veredicto aparte, con
  // `estadoGastoGP`— estaba diciendo SIN MEDIR. El escenario de abajo dice
  // ahora que GP sí contestó y contestó cero, que es la misma cifra pero
  // afirmada, y la cuenta real la saca el archivo.
  const STUBS = () => ({
    useState: (v) => [v, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useMemo: (f) => (typeof f === 'function' ? f() : f),
    useCallback: (f) => f,
    C: new Proxy({}, { get: () => '#000000' }),
    React: {},
  });

  // Corre el prólogo de `nombre` y devuelve TODOS los locales que declara. Se
  // devuelven todos a propósito: la frontera del margen se comprueba sobre lo
  // que el render PUEDE dibujar, no sobre una lista de nombres elegida aquí.
  const cache = {};
  function correr(nombre, props) {
    if (!comps[nombre]) {
      throw new Error(`no se encontró \`${nombre}\` — ¿se renombró?`);
    }
    if (!cache[nombre]) {
      const prologo = prologoDe(comps[nombre]);
      if (!prologo) throw new Error(`\`${nombre}\` no tiene prólogo de cálculo`);
      const preludio = preludioPara(prologo);
      const declarados = [];
      {
        const a = parse(prologo, { ...OPTS, allowReturnOutsideFunction: true });
        traverse(a, {
          Program(p) { declarados.push(...Object.keys(p.scope.bindings)); p.stop(); },
        });
      }
      const libres = libresDe(`${preludio}\n${prologo}`)
        .filter(n => !porNombre.has(n));
      cache[nombre] = { preludio, prologo, declarados, libres };
    }
    const { preludio, prologo, declarados, libres } = cache[nombre];
    const entorno = { ...STUBS(), ...props };
    const cuerpo = `${preludio}\n${prologo}\n;return {${declarados.join(',')}};`;
    const fn = new Function(...libres, cuerpo);
    return fn(...libres.map(k => entorno[k]));
  }

  // Las cuentas compartidas, ejecutadas sueltas: así se puede comparar lo que
  // el componente publica contra la cuenta del repositorio sin rederivarla.
  function cuenta(nombre) {
    const reg = porNombre.get(nombre);
    if (!reg) throw new Error(`no se encontró la cuenta \`${nombre}\``);
    const preludio = preludioPara(reg.fuente);
    const libres = libresDe(`${preludio}\n${reg.fuente}`).filter(n => !porNombre.has(n));
    const entorno = STUBS();
    return new Function(...libres, `${preludio}\n${reg.fuente}\n;return ${nombre};`)(
      ...libres.map(k => entorno[k]));
  }

  return { correr, cuenta };
}

// ── El fixture ─────────────────────────────────────────────────────────────
//
// Obra que arrancó hace nueve semanas, así que con la ventana de 12 que traen
// los dos componentes por omisión el eje son sus 10 semanas completas.
const semanasAtras = (n) => { const d = new Date(); d.setDate(d.getDate() - n * 7); return d; };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
                   `${String(d.getDate()).padStart(2, '0')}`;

const PRESUPUESTO = 10_000_000;
const INICIO = iso(semanasAtras(9));
const FIN = iso(semanasAtras(-12));     // doce semanas por delante

const OBRA = { id: '0199-TEST', nombre: 'Obra de prueba', presupuesto: PRESUPUESTO,
               inicio: INICIO, fin: FIN, modoAvance: 'volumen' };

// Programa con el gasto cargado en los primeros meses: la pendiente dentro de
// cada mes es fuerte, y así tres días de diferencia en la fecha de corte se
// ven. Con un programa plano, medir al lunes o al jueves daría lo mismo y la
// aserción del jueves pasaría sin morder.
const PROGRAMA = {
  inicio: INICIO,
  meses: 12,
  total: 1000,
  partidas: [{ sec: '1000 01', montos: [400, 400, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0], barra: '' }],
};

// Catálogo con sobreejecución, el mismo caso que ya vigila
// `prueba-series-sincronizadas`: 120 de 100 unidades. Avance físico topado al
// 60%, dinero ejecutado real $7,200,000.
const SUBS = [
  { sec: 'A-01', imp: 6_000_000, cant: 100, pu: 60_000, cantEjec: 120 },
  { sec: 'A-02', imp: 4_000_000, cant: 100, pu: 40_000, cantEjec: 0 },
];
const EJEC_REAL = 7_200_000;

// Dos magnitudes que SOLO pueden llegar por la vía del dinero. Son las que se
// buscan dentro de los locales de la tarjeta del municipio.
const GASTO_SELLADO = 1_234_567;
const MAQ_SELLADA   = 7_654_321;
// Un gasto capturado SIN fecha, que pasa todo el tiempo. Entra en el KPI del
// Dashboard —que suma plano— y NO entra en el acumulado por semana, que
// necesita una fecha para saber en qué semana cae. Por eso el último punto del
// acumulado tiene que anclarse al del KPI: sin el ancla, el último renglón de
// la tabla publica margen = ejecutado − gasto con tres cifras que no cuadran.
const GASTO_SIN_FECHA = 2_000_000;

const snap = (n, { av, me, esquema }) => {
  const d = semanasAtras(n);
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const ini = new Date(t.getFullYear(), 0, 1);
  const s = {
    semana: Math.ceil(((t - ini) / 86400000 + 1) / 7), año: t.getFullYear(),
    fechaCaptura: d.toISOString(), avancePonderado: av,
  };
  if (me !== undefined) s.montoEjecutado = me;
  if (esquema !== undefined) s.esquema = esquema;
  return s;
};

// Historial que CRUZA la frontera del avance: esquema 2 al principio, esquema 3
// a partir de la semana 4. Entre esas dos semanas no hay delta que valga.
const HISTORIAL = [
  snap(8, { av: 15, me: 1_500_000, esquema: 2 }),
  snap(6, { av: 30, me: 3_000_000, esquema: 2 }),
  snap(4, { av: 48, me: 5_000_000, esquema: 3 }),
  snap(2, { av: 55, me: 6_200_000, esquema: 3 }),
];

// Props del municipio: las cuatro que recibe, más el dinero que NO recibe.
// El dinero va a propósito, para que una mutación que se lo quiera leer tenga
// de dónde leerlo y la aserción muerda.
// La corrida del gasto preguntó por la 0199 —el prefijo del id de la obra— y
// no trajo un peso. Es un cero MEDIDO, y hace falta decirlo: `gpData: null`
// significa «no hay documento de gasto», o sea SIN MEDIR, y una serie sin
// medir sale en `null`. Toda esta prueba va de que el renglón de la tabla
// cuadre —margen = ejecutado − gasto—, y con el gasto sin medir no hay
// renglón que cuadrar. El dinero del escenario sigue siendo sólo el que la
// prueba inyecta; lo único que cambia es que ahora está afirmado.
const GP_CONTESTO_CERO = { obras: {}, obrasPedidas: ['0199'] };

const PROPS_DEP = (extra = {}) => ({
  obra: OBRA, historialAvance: HISTORIAL, subs: SUBS, programa: PROGRAMA,
  gpData: GP_CONTESTO_CERO, datosObraGP: null, estimaciones: [],
  otrosGastos: [{ fecha: iso(semanasAtras(5)), importe: GASTO_SELLADO },
                { importe: GASTO_SIN_FECHA }],
  maquinaria: [{ fecha: iso(semanasAtras(3)), imp: MAQ_SELLADA }],
  materiales: [],
  ...extra,
});

const PROPS_CON = (extra = {}) => PROPS_DEP(extra);

// Las mismas props con el dinero en cero. Lo que NO se toca es el historial de
// avance: trae `montoEjecutado` por semana, pero es también de donde sale la
// curva de avance, y vaciarlo apagaría la curva entera y haría que la
// comparación de abajo pasara por la razón equivocada.
// La corrida sigue siendo la misma —preguntó y contestó cero—: lo que se
// quita es el dinero capturado a mano. Dejar aquí `gpData: null` apagaría el
// gasto por SIN MEDIR en vez de por no haber gasto, y la comparación de abajo
// pasaría por la razón equivocada.
const SIN_DINERO = {
  gpData: GP_CONTESTO_CERO, datosObraGP: null, estimaciones: [],
  otrosGastos: [], maquinaria: [], materiales: [],
};

// ── Las aserciones ─────────────────────────────────────────────────────────

const casi = (a, b, tol = 0.5) => typeof a === 'number' && Math.abs(a - b) <= tol;

// Busca una magnitud dentro de cualquier valor, por profundo que esté.
const lleva = (valor, monto, visto = new Set()) => {
  if (typeof valor === 'number') return Math.abs(valor - monto) < 1;
  if (!valor || typeof valor !== 'object' || visto.has(valor)) return false;
  visto.add(valor);
  return Object.values(valor).some(v => lleva(v, monto, visto));
};

function correr(codigo) {
  const { correr: ejecutar, cuenta } = taller(codigo);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const sec = (t) => { if (!process.env.CALLADO) console.log(`\n${t}`); };

  const dep = ejecutar('CurvaSDelContrato', PROPS_DEP());
  const con = ejecutar('TendenciasMensuales', PROPS_CON());

  // ── 0 · EL FIXTURE DICE LO QUE CREO QUE DICE ─────────────────────────────
  // Si el calendario del fixture se desarma, lo de abajo pasaría por la razón
  // equivocada. Esto no prueba la app: protege al banco.
  sec('0. El fixture dice lo que creo que dice');
  const avanceProgramadoA = cuenta('avanceProgramadoA');
  const hoyLocalISO = cuenta('hoyLocalISO');
  const jueveDeSemanaISO = cuenta('jueveDeSemanaISO');
  const aHoy = avanceProgramadoA(OBRA, PROGRAMA, hoyLocalISO());
  check(aHoy.fuente === 'programa',
    'el anexo del fixture se lee como programa', aHoy.fuente);
  check(Array.isArray(dep.semanas) && dep.semanas.length === 10,
    'la ventana del municipio son las 10 semanas del contrato',
    `${dep.semanas?.length} semanas`);
  check(Array.isArray(dep.esquemaPorSemana) &&
        dep.esquemaPorSemana.some(e => e === 2) && dep.esquemaPorSemana.some(e => e === 3),
    'y el historial cruza de verdad la frontera del avance',
    `esquemas: ${[...new Set(dep.esquemaPorSemana)].join(', ')}`);

  // ── 1 · UNA OBRA, UNA CURVA ──────────────────────────────────────────────
  // El punto de haber sacado las cuentas a nivel de módulo. Dos copias del eje
  // de semanas o del arrastre del avance es cómo se llega a dos avances para
  // la misma obra en dos pantallas.
  sec('1. Una obra, una curva: los dos tableros dibujan lo mismo');
  check(JSON.stringify(dep.semanas.map(s => s.key)) ===
        JSON.stringify(con.semanas.map(s => s.key)),
    'el eje de semanas es idéntico en los dos tableros',
    `${dep.semanas[0]?.key} … ${dep.semanas[dep.semanas.length - 1]?.key}`);
  check(JSON.stringify(dep.avanceSeries) === JSON.stringify(con.avanceSeries),
    'y el avance físico también, punto por punto',
    `último: ${dep.avanceSeries?.[9]} vs ${con.avanceSeries?.[9]}`);
  check(JSON.stringify(dep.programadoSeries) === JSON.stringify(con.programadoSeries),
    'y el programado, que es contra lo que las dos pantallas acusan',
    `último: ${dep.programadoSeries?.[9]?.toFixed?.(1)} vs ${con.programadoSeries?.[9]?.toFixed?.(1)}`);
  // El último punto anclado al avance vivo: si no se ancla, la gráfica y el KPI
  // de la misma pantalla publican dos avances distintos. La cifra esperada no
  // se teclea: sale de `avanceFisicoPonderado`, la del KPI.
  const avanceFisicoPonderado = cuenta('avanceFisicoPonderado');
  const vivo = avanceFisicoPonderado(SUBS, PRESUPUESTO, true);
  check(casi(dep.avanceSeries?.[9], vivo),
    'y el último punto es el avance que publica el KPI, no el del último cierre',
    `${dep.avanceSeries?.[9]} = ${vivo.toFixed(2)} (el cierre decía 55)`);
  check(!casi(dep.avanceSeries?.[9], 55) && Math.abs(vivo - 55) > 1,
    'y el fixture distingue las dos cosas: el KPI y el cierre no coinciden',
    `KPI ${vivo.toFixed(2)} vs cierre 55`);

  // ── 2 · LA FRONTERA DEL MARGEN, CON EL CANARIO COMPROBADO ────────────────
  sec('2. Al municipio se le mete el dinero y no sale por ningún lado');
  // No se buscan magnitudes concretas: se corre el mismo prólogo DOS veces,
  // una con el dinero y otra con el dinero en cero, y se comparan todos sus
  // locales. Buscar una cifra sólo atrapa las fugas que la copian tal cual;
  // basta una división o una suma para que se escape. Si NINGÚN local cambia
  // al quitar el dinero, es que el dinero no interviene en lo que se dibuja.
  const difieren = (a, b) => Object.keys(a)
    .filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

  // El canario primero: la MISMA inyección tiene que mover la tarjeta de la
  // constructora. Un verde sobre un canario sordo no prueba nada.
  const conSinDinero = ejecutar('TendenciasMensuales', PROPS_CON(SIN_DINERO));
  const movidosCon = difieren(con, conSinDinero);
  check(movidosCon.length > 0,
    'canario: quitarle el dinero SÍ mueve la tarjeta de la constructora',
    `${movidosCon.length} locales cambian, entre ellos ${movidosCon.slice(0, 3).join(', ')}`);
  check(movidosCon.includes('margenSeries') && movidosCon.includes('gastoAcumSeries'),
    'y los que cambian son precisamente las series de dinero');
  check(Object.values(con).some(v => lleva(v, EJEC_REAL)),
    'y el ejecutado real sigue ahí, que es el guardián de los $2.7M', `${EJEC_REAL}`);

  // Y ahora el municipio: se le pasan las mismas props, dinero incluido.
  const depSinDinero = ejecutar('CurvaSDelContrato', PROPS_DEP(SIN_DINERO));
  const movidosDep = difieren(dep, depSinDinero);
  check(movidosDep.length === 0,
    'quitarle el dinero NO mueve ni un valor de los que el municipio dibuja',
    movidosDep.length ? `se movieron: ${movidosDep.join(', ')}`
                      : `${Object.keys(dep).length} locales revisados, 0 dependen del dinero`);

  // ── 3 · LA FECHA DE CORTE DE CADA SEMANA ES SU JUEVES ────────────────────
  // Medir el programa al lunes contra un avance cerrado el viernes le regala
  // tres días de atraso a la obra cada semana. El número esperado no se teclea:
  // sale de `avanceProgramadoA`, la cuenta del repositorio.
  sec('3. El programa se mide al jueves de la semana, no a su lunes');
  const isoDe = (d) => iso(d);
  const alJueves = dep.semanas.map(s => {
    const j = jueveDeSemanaISO(s.año, s.sem);
    return avanceProgramadoA(OBRA, PROGRAMA, isoDe(j)).pct;
  });
  const alLunes = dep.semanas.map(s => {
    const j = jueveDeSemanaISO(s.año, s.sem);
    j.setDate(j.getDate() - 3);
    return avanceProgramadoA(OBRA, PROGRAMA, isoDe(j)).pct;
  });
  check(dep.programadoSeries.every((v, i) => casi(v, alJueves[i], 0.01)),
    'cada semana trae el programado a su jueves',
    `S${dep.semanas[4]?.sem}: ${dep.programadoSeries[4]?.toFixed(2)}% = ${alJueves[4]?.toFixed(2)}%`);
  const brecha = Math.max(...alJueves.map((v, i) => Math.abs(v - alLunes[i])));
  check(brecha > 1,
    'y el fixture distingue de verdad: jueves y lunes no dan lo mismo',
    `hasta ${brecha.toFixed(2)}pp de diferencia`);
  check(!dep.programadoSeries.every((v, i) => casi(v, alLunes[i], 0.01)),
    'así que la serie NO es la del lunes');

  // ── 4 · SIN ANEXO NO SE DIBUJA LA CUARTA SERIE ───────────────────────────
  // Los dos casos dan una serie de nulls y hay que distinguirlos igual:
  // `undefined` es «todavía no se sabe» y se calla; `null` es «se sabe que no
  // hay» y se DICE. Y la obra de este fixture tiene inicio y fin, o sea que la
  // recta se podía calcular: lo que se afirma es que ya no se calcula.
  sec('4. Sin anexo no se dibuja ninguna línea programada, y se dice por qué');
  const viajando = ejecutar('CurvaSDelContrato', PROPS_DEP({ programa: undefined }));
  const sinAnexo = ejecutar('CurvaSDelContrato', PROPS_DEP({ programa: null }));
  check(viajando.programadoSeries.every(v => v === null),
    'viajando, el programado de todas las semanas queda en "no se sabe"',
    `${viajando.programadoSeries.filter(v => v !== null).length} puntos dibujados`);
  check(viajando.desviacionSeries.every(v => v === null),
    'y por lo tanto no se publica ninguna desviación contra el programa');
  check(viajando.fuentePrograma === 'cargando',
    'la leyenda dice que está leyendo, no que sea un programa',
    String(viajando.fuentePrograma));
  check(!/program/i.test(viajando.rotulo?.kpi || '') ||
        /leyendo/i.test(viajando.rotulo?.sub || ''),
    'y el rótulo no afirma «programado» mientras la lectura viaja',
    `${viajando.rotulo?.kpi} · ${viajando.rotulo?.sub}`);
  check(viajando.hayPrograma === false,
    'viajando tampoco se dibuja la serie: no hay nada que dibujar todavía');
  // El corte del 2026-11-06: con `null` NO aparece una recta en su lugar.
  check(sinAnexo.programadoSeries.every(v => v === null),
    'sin anexo el programado NO se sustituye por una recta, ni un punto',
    `${sinAnexo.programadoSeries.filter(v => v !== null).length} puntos dibujados`);
  check(sinAnexo.desviacionSeries.every(v => v === null),
    'y la columna «Contra el programa» queda entera en "sin dato"');
  check(sinAnexo.fuentePrograma === 'sin_programa',
    'la fuente dice que falta el anexo —no «recta», no «cargando»—',
    String(sinAnexo.fuentePrograma));
  check(sinAnexo.hayPrograma === false,
    'y la serie punteada no se le pasa al panel: su nombre no queda en la leyenda');
  check(!/lineal|recta/i.test(sinAnexo.rotulo?.kpi || '') &&
        !/lineal|recta/i.test(sinAnexo.rotulo?.sub || ''),
    'el rótulo no nombra ninguna recta ni nada lineal',
    `${sinAnexo.rotulo?.kpi} · ${sinAnexo.rotulo?.sub}`);
  check(/(AE11|DE-5|carga)/i.test(sinAnexo.rotulo?.sub || ''),
    'dice qué archivo cargar, que es lo único que arregla el hueco',
    sinAnexo.rotulo?.sub);
  // El canario de esta sección: la obra del fixture TIENE las dos fechas. Sin
  // esto, el verde de arriba podría venir de un fixture sin plazo, donde la
  // recta no se podía calcular de todas formas.
  check(!!OBRA.inicio && !!(OBRA.fin || OBRA.finAmpliado),
    'canario: la obra del fixture tiene inicio y fin, o sea que la recta SÍ se podía calcular',
    `${OBRA.inicio} → ${OBRA.finAmpliado || OBRA.fin}`);

  // ── 5 · NINGÚN DELTA CRUZA LA FRONTERA ───────────────────────────────────
  // Restar un avance compensado de uno topado mide el cambio de criterio, no la
  // semana de obra. En la tabla ese número se lee «avanzó 18 puntos».
  sec('5. Ningún delta cruza la frontera del esquema, en los dos tableros');
  const idxF = dep.esquemaPorSemana.findIndex(e => e !== null && e >= 3);
  check(idxF > 0, 'la frontera del avance cae dentro de la ventana', `idx ${idxF}`);
  check(dep.deltaSeries?.[idxF] === null,
    'el municipio no publica el delta de la semana que cruza',
    `idx ${idxF}: ${dep.deltaSeries?.[idxF]}`);
  check(con.avanceDeltaSeries?.[idxF] === null,
    'y la constructora tampoco',
    `idx ${idxF}: ${con.avanceDeltaSeries?.[idxF]}`);
  check(dep.avanceSeries.filter(v => typeof v === 'number').length === 10,
    'y la serie no se corta: el tramo viejo sigue dibujado, punteado');

  // ── 6 · EL ÚLTIMO RENGLÓN DE LA TABLA CUADRA ─────────────────────────────
  // Una cuenta por número: si el margen de la última fila no es su ejecutado
  // menos su gasto, la tabla se contradice a sí misma en la misma fila.
  sec('6. En la tabla, margen = ejecutado − gasto acumulado');
  const u = con.semanas.length - 1;
  const mg = con.margenSeries?.[u], ej = con.ejecutadoSeries?.[u], ga = con.gastoAcumSeries?.[u];
  check(typeof mg === 'number' && typeof ej === 'number' && typeof ga === 'number',
    'las tres cifras de la última semana existen',
    `margen ${mg} · ejecutado ${ej} · gasto ${ga}`);
  check(casi(mg, ej - ga, 1),
    'y la resta cuadra con la del renglón, no sólo con la del KPI',
    `${mg} vs ${ej} − ${ga} = ${ej - ga}`);
  // Que el ancla sea de verdad el motivo: con el gasto sin fecha dentro, el
  // acumulado por semana se queda corto. Si el fixture dejara de distinguir
  // las dos cifras, la aserción de arriba pasaría sin morder.
  const porSemana = con.gastoAcumPorSem?.[con.semanas[u].key];
  check(typeof porSemana === 'number' && Math.abs(porSemana - ga) > 1,
    'y el fixture distingue: sin el ancla, el acumulado por semana se queda corto',
    `por semana ${porSemana} vs anclado ${ga}`);

  // ── 7 · EL GASTO DE LA SEMANA ES MEDIDO, NO PROMEDIADO ───────────────────
  // `gastoSemanalSeries` rellena las semanas sin movimiento del GP con el
  // promedio de la ventana: sirve para la forma de la curva y en un renglón de
  // tabla se lee como una cifra medida.
  sec('7. El gasto de la semana que se tabula es el medido');
  const rellenadas = con.semanas
    .map((_, i) => i)
    .filter(i => i > 0 && !(con.deltasRaw?.[i] > 0) && con.gastoSemanalSeries?.[i] > 0);
  check(rellenadas.length > 0,
    'el fixture tiene semanas que la curva rellena con el promedio',
    `${rellenadas.length} semanas`);
  check(rellenadas.every(i => con.gastoDeltaMedido?.[i] == null ||
                              con.gastoDeltaMedido[i] === 0),
    'y en la tabla esas semanas quedan vacías, no con el promedio',
    rellenadas.map(i => `${i}:${con.gastoDeltaMedido?.[i]}`).join(' '));
  const medidas = con.semanas.map((_, i) => i)
    .filter(i => i > 0 && i < u && con.deltasRaw?.[i] > 0);
  check(medidas.length > 0 && medidas.every(i => casi(con.gastoDeltaMedido[i], con.deltasRaw[i], 1)),
    'y donde SÍ hubo movimiento, la tabla trae el movimiento real',
    medidas.map(i => `${i}:${con.gastoDeltaMedido?.[i]}`).join(' '));

  // ── 8 · EL SALTO DEL ANCLA NO SE PUBLICA COMO UNA SEMANA DE GASTO ────────
  // Medido en el preview sobre Oaxaca Parque Lineal: el último renglón decía
  // acumulado $21,918,000 con $8,518,000 la semana antes, y «gasto de la
  // semana $0». Tres cifras en la misma fila que no se pueden sostener a la
  // vez. El salto es un total sin fechar alcanzando a su serie, y lo único
  // cierto que se puede escribir ahí es «—».
  sec('8. El salto del ancla no se publica como gasto de una semana');
  check(con.gastoSinFechar === true,
    'el fixture tiene gasto sin fechar, que es cuando el ancla mueve el número',
    `por semana ${porSemana} vs KPI ${ga}`);
  check(con.gastoDeltaMedido?.[u] === null,
    'y la última semana no afirma ningún gasto medido',
    `${con.gastoDeltaMedido?.[u]}`);
  const salto = ga - (con.gastoAcumSeries?.[u - 1] ?? 0);
  check(Math.abs(salto) > 1 && con.gastoDeltaMedido?.[u] !== salto,
    'y mucho menos afirma que el salto entero se gastó en esos siete días',
    `el salto es ${salto}`);

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de volver al defecto, no de romper el
// andamiaje: el banco sigue arrancando y ejecutando, y tiene que salir ROJO.
const MUTACIONES = [
  ['el municipio se saca su propio eje de semanas',
    'const semanas = semanasDeVentana(obra, rango);\n  const { serie: avanceSeries, esquemaPorSemana } =',
    'const semanas = semanasDeVentana(obra, 8);\n  const { serie: avanceSeries, esquemaPorSemana } ='],
  ['el municipio pierde el ancla al avance vivo del KPI',
    'serieAvanceDeSemanas({ semanas, historialAvance, subs, obra });\n  const { serie: programadoSeries, fuente: fuentePrograma } =\n    serieProgramadaDeSemanas({ semanas, obra, programa });\n  const rotulo =',
    'serieAvanceDeSemanas({ semanas, historialAvance, subs: [], obra });\n  const { serie: programadoSeries, fuente: fuentePrograma } =\n    serieProgramadaDeSemanas({ semanas, obra, programa });\n  const rotulo ='],
  ['la economía del contratista se le cuela al municipio',
    'const idxF = esquemaPorSemana.findIndex(e => e !== null && e >= ESQUEMA_AVANCE);',
    'const gastoDeLaObra = (otrosGastos || []).reduce((t, g) => t + (g.importe || 0), 0);\n  const idxF = esquemaPorSemana.findIndex(e => e !== null && e >= ESQUEMA_AVANCE);'],
  ['el programa se mide al lunes de la semana, no a su jueves',
    'const j = jueveDeSemanaISO(s.año, s.sem);\n    return `${j.getFullYear()}-',
    'const j = jueveDeSemanaISO(s.año, s.sem);\n    j.setDate(j.getDate() - 3);\n    return `${j.getFullYear()}-'],
  ['con el anexo a medio viaje se acusa de que falta',
    "  if (programa === undefined) {\n    return { serie: semanas.map(() => null), fuente: 'cargando' };\n  }",
    '  if (programa === undefined) programa = null;'],
  // LA RECTA, DE VUELTA, en la serie semanal. Cada jueves calcula el reparto
  // lineal y la línea punteada reaparece en los dos tableros.
  ['la serie semanal repone la recta donde no hay anexo',
    "  const serie = semanas.map(s =>\n    avanceProgramadoA(obra, programa, isoDelJueves(s)).pct);",
    `  const recta = (fISO) => {
    const i = fechaLocalDeISO(obra?.inicio);
    const f = fechaLocalDeISO(obra?.finAmpliado || obra?.fin);
    const c = fechaLocalDeISO(fISO);
    if (!i || !f || !c || f <= i) return null;
    return Math.min(Math.max(((c - i) / (f - i)) * 100, 0), 100);
  };
  const serie = semanas.map(s => {
    const p = avanceProgramadoA(obra, programa, isoDelJueves(s)).pct;
    return p === null ? recta(isoDelJueves(s)) : p;
  });`],
  // Y la forma más barata de que vuelva: pasarle la serie de nulls al panel de
  // todos modos. No dibuja nada, pero deja su nombre en la leyenda.
  ['el municipio le pasa la serie vacía al panel igual',
    '  const hayPrograma = fuentePrograma === \'programa\';\n\n  // La frontera del AVANCE',
    '  const hayPrograma = true;\n\n  // La frontera del AVANCE'],
  ['el delta del municipio cruza la frontera del esquema',
    'if (hayTramoViejo && i === idxF) return null;',
    ''],
  ['el delta de la constructora cruza la frontera del esquema',
    'if (fronteraAvance.hay && i === fronteraAvance.idx) return null;',
    ''],
  ['el gasto acumulado de la tabla no se ancla al del KPI',
    'return (anclada && i === semanas.length - 1) ? gtActual : (porSem[s.key] ?? null);',
    'return porSem[s.key] ?? null;'],
  ['el margen se saca su propia cuenta del gasto en vez de leer la serie',
    'const g = gastoAcumSeries[i];\n    if (typeof g !== \'number\') return null;\n    // Ejecutado ya viene con arrastre desde ejecutadoSeries\n    return ejecutadoSeries[i] - g;',
    'let g = 0;\n    for (let j = i; j >= 0; j--) {\n      const x = gastoAcumPorSem[semanas[j].key];\n      if (x && x > 0) { g = x; break; }\n    }\n    return ejecutadoSeries[i] - g;'],
  ['la tabla publica el gasto promediado como si lo hubiera medido',
    '    if (i === semanas.length - 1 && gastoSinFechar) return null;\n    return deltasRaw[i];',
    '    return gastoSemanalSeries[i];'],
  ['la última semana publica un $0 de gasto junto a un acumulado que saltó',
    'if (i === semanas.length - 1 && gastoSinFechar) return null;',
    ''],
  ['el salto del ancla se publica como el gasto de esa semana',
    'if (i === semanas.length - 1 && gastoSinFechar) return null;\n    return deltasRaw[i];',
    'if (i === semanas.length - 1 && gastoSinFechar) {\n      return gtActual - (gastoAcumPorSem[semanas[i - 1].key] ?? 0);\n    }\n    return deltasRaw[i];'],
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

console.log('LAS DOS CURVAS Y UN SOLO EJE · #51 (el avance contra una recta)');
const fallos = correr(FUENTE);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
