#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// «EL MARGEN VIENE CAYENDO» PUEDE SER FALSO AUNQUE LOS NÚMEROS SEAN CIERTOS
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que `comportamientoDelMargen` RESPONDE sobre una curva ya
// calculada: cuántas semanas seguidas trae, cuánto se movió, y —esto es el
// motivo de que la función exista— si el movimiento fue de la obra o de la
// captura.
//
// EL CASO QUE LA OBLIGÓ, medido en producción el 2026-11-09, obra 0127:
//
//     S39     S40     S41     S42     S43     S44
//   −103.2  −165.5  −186.2  −192.1  −214.0   +15.1
//
// Leído así, el margen se desplomó 110 puntos en cuatro semanas y luego subió
// 229 en una. Ninguna de las dos cosas pasó: el ejecutado estuvo CLAVADO en
// $11,104,150 esas cinco semanas mientras el gasto seguía llegando, y en la
// S44 por fin se capturó el avance y saltó a $42,749,603. La obra no empeoró
// ni mejoró — nadie cerró el corte. Un reporte que imprime esa caída sin
// decirlo afirma algo falso con cifras verdaderas, que es la forma de error
// más difícil de ver después.
//
// LAS SEIS AFIRMACIONES:
//
//   A. El porcentaje sale de LAS MISMAS series que dibuja la gráfica. Los pesos
//      de cada renglón son los de `curva.margen`, no una resta hecha aquí: si
//      se recalcularan, el renglón de la tabla y el hueco de la gráfica de la
//      misma semana podrían discrepar.
//   B. Con ejecutado en cero el porcentaje es `null`, no cero, y se DECLARA con
//      su motivo. Un 0% ahí diría «no hubo margen» donde lo cierto es «no hay
//      sobre qué dividir».
//   C. Sólo se lee la COLA CONTIGUA. Una semana hueca en medio corta el tramo:
//      comparar la 31 contra la 20 y llamarlo «cayó en dos semanas» nombra mal
//      el dato.
//   D. Si la cola no llega a las cuatro semanas que pide el reporte, sale
//      `suficiente` en falso y un motivo que dice CUÁNTAS hay y cuántas se
//      necesitan. No promedia por su cuenta ni rellena.
//   E. El ejecutado quieto se cuenta y se nombra por semana. En la forma del
//      0127, TODAS las semanas en que el margen baja tienen el ejecutado
//      clavado — y eso es lo que el reporte tiene que poder decir.
//   F. La caída del TRAMO puede ser peor que la de cualquier semana suelta (es
//      la forma de la 0114: medio punto por semana, diez semanas). Las dos
//      cifras salen por separado porque una regla que sólo mire la semana no
//      ve esa obra.
//
// NO REIMPLEMENTA. `comportamientoDelMargen` y `curvaUnicaDeObra` salen de
// `src/App.jsx` por `fuenteDe` —cierre transitivo, no una lista tecleada— y se
// EJECUTAN. Las curvas de los casos se arman con la función de verdad, no a
// mano: así el banco también comprueba el contrato entre las dos.
//
// LAS SEMANAS SON DEL AÑO EN CURSO Y DE MEDIADOS DE AÑO, a propósito. El gasto
// de GP se indexa con `new Date().getFullYear()` y la ventana se arma contra
// hoy; un caso con semanas de enero cruzaría de año y el banco fallaría una
// semana al año, que es justo la frecuencia con la que se culpa al azar.
//
//   node scripts/prueba-el-margen-semana-a-semana.cjs
//   node scripts/prueba-el-margen-semana-a-semana.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

// ── LAS CUENTAS VIVAS ──────────────────────────────────────────────────────
const PEDIDOS = ['comportamientoDelMargen', 'curvaUnicaDeObra', 'claveSemanaISO'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltan.join(', ')}`);
  process.exit(2);
}
const APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
const { comportamientoDelMargen, curvaUnicaDeObra, claveSemanaISO } = APP;

// ── EL ARMADO DE UN CASO ───────────────────────────────────────────────────
const AÑO = new Date().getFullYear();
const DESDE = 20;              // mediados de año: la ventana nunca cruza de año
const N = 12;
const SEMS = Array.from({ length: N }, (_, i) => {
  const sem = DESDE + i;
  return { key: claveSemanaISO(sem, AÑO), sem, año: AÑO, label: `S${sem}`, fecha: '01/01' };
});

// `ejec` y `gastoAcum` son arreglos de largo N; `null` en `ejec` significa «esa
// semana no tiene corte capturado» y entonces el ejecutado ARRASTRA, igual que
// en la app.
const caso = ({ ejec, gastoAcum, presupuesto = 45000000 }) => {
  const obra = { id: '0127', nombre: 'Centro de convenciones', presupuesto,
                 inicio: `${AÑO}-02-02`, fin: `${AÑO + 1}-06-30`, gpId: '0127',
                 diasPago: 30 };
  const historialAvance = [];
  ejec.forEach((m, i) => {
    if (m === null) return;
    historialAvance.push({ tipo: 'oficial', año: AÑO, semana: SEMS[i].sem,
                           avance: 10, avancePonderado: 10, montoEjecutado: m });
  });
  // GP guarda el DELTA de cada semana, no el acumulado.
  const semanasGP = {};
  let prev = 0;
  gastoAcum.forEach((g, i) => { semanasGP[`S${SEMS[i].sem}`] = g - prev; prev = g; });
  const gpData = { ultimaSemana: `S${DESDE + N - 1}`,
                   obras: { '0127': { id: '0127', nombre: 'Centro de convenciones',
                                      semanas: semanasGP } } };
  // `subs` va vacío a propósito: con catálogo, la última semana de las dos
  // series se ancla al valor VIVO y el caso dejaría de controlar su propio
  // último punto. Lo que se mide aquí es la lectura del margen, no el ancla.
  const curva = curvaUnicaDeObra({ semanas: SEMS, obra, historialAvance, subs: [],
                                   gpData, otrosGastos: [], maquinaria: [],
                                   programa: null });
  return { obra, curva };
};

const PP = n => n === null || n === undefined ? '—' : (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1);

// ════════════════════════════════════════════════════════════════════════════
// A · EL PORCENTAJE SALE DE LAS MISMAS SERIES QUE SE DIBUJAN
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── A · una cuenta, no dos ────────────────────────────────────');

// La forma del 0127: ejecutado clavado siete semanas y el gasto subiendo.
const CLAVADO = 11104150;
const SALTO = 42749603;
const f0127 = caso({
  ejec:      [null, null, null, null, CLAVADO, CLAVADO, CLAVADO, CLAVADO,
              CLAVADO, CLAVADO, CLAVADO, SALTO],
  gastoAcum: [8000000, 10500000, 13000000, 16000000, 20000000, 22567872,
              29479855, 31782327, 32439284, 34863896, 35600000, 36314807],
});
const r0127 = comportamientoDelMargen(f0127.curva);

ok(f0127.curva.gastoMedido === true,
   'el caso del 0127 tiene el gasto MEDIDO en GP (si no, no habría serie que leer y el banco mediría otra cosa)');
ok(r0127.cola === 8,
   `la cola contigua del 0127 son las 8 semanas con las dos líneas (salió ${r0127.cola})`);

const ini0127 = N - r0127.cola;
ok(r0127.renglones.length === r0127.cola,
   `sale un renglón por semana de la cola: ${r0127.renglones.length} de ${r0127.cola}`);
ok(r0127.renglones.every((r, k) => r.pesos === f0127.curva.margen[ini0127 + k]),
   'los pesos de cada renglón SON los de `curva.margen`, no una resta hecha aquí');
ok(r0127.renglones.every((r, k) => r.label === SEMS[ini0127 + k].label),
   'cada renglón trae la etiqueta de su propia semana');
ok(r0127.renglones.every(r => r.pct === null
     || Math.abs(r.pct - r.pesos / f0127.curva.ejecutado[SEMS.findIndex(s => s.key === r.key)] * 100) < 1e-9),
   'el porcentaje de cada renglón es su propio margen en pesos sobre su propio ejecutado');
ok(r0127.pct.slice(0, 4).every(p => p === null),
   'las cuatro semanas anteriores al primer corte no traen porcentaje: el margen todavía no existe ahí');

// ════════════════════════════════════════════════════════════════════════════
// B · CON EJECUTADO EN CERO EL PORCENTAJE NO EXISTE, Y NO VALE CERO
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── B · el cero del ejecutado no es un margen de 0% ───────────');

const fCero = caso({
  ejec:      Array.from({ length: N }, () => 0),
  gastoAcum: Array.from({ length: N }, (_, i) => 500000 * (i + 1)),
});
const rCero = comportamientoDelMargen(fCero.curva);

ok(fCero.curva.margen.some(m => typeof m === 'number' && m < 0),
   'el caso del ejecutado en cero SÍ tiene margen en pesos (negativo): el hueco existe, es el cociente el que no');
ok(rCero.pct.every(p => p === null),
   'y aun así ninguna semana trae porcentaje: dividir entre cero no da cero');
ok(rCero.cola === 0 && rCero.suficiente === false,
   'no hay cola ni suficiencia que reportar');
ok(/cero/.test(rCero.motivo || '') && /no vale cero/.test(rCero.motivo || ''),
   `el motivo nombra el cero del ejecutado y niega el 0%: «${rCero.motivo}»`);

const fSinGasto = caso({
  ejec:      Array.from({ length: N }, (_, i) => 1000000 * (i + 1)),
  gastoAcum: Array.from({ length: N }, () => 0),
});
// Se le quita a GP la obra entera: así el gasto queda SIN MEDIR, que es el
// caso de las obras 0128 y 0131 en producción.
const fSinGP = curvaUnicaDeObra({
  semanas: SEMS, obra: { ...fSinGasto.obra, gpId: 'NO-EXISTE' },
  historialAvance: Array.from({ length: N }, (_, i) => ({
    tipo: 'oficial', año: AÑO, semana: SEMS[i].sem, avance: 10,
    avancePonderado: 10, montoEjecutado: 1000000 * (i + 1) })),
  subs: [], gpData: { obras: {} }, otrosGastos: [], maquinaria: [], programa: null });
const rSinGP = comportamientoDelMargen(fSinGP);

ok(fSinGP.gastoMedido === false,
   'la obra que GP no conoce tiene el gasto SIN MEDIR');
ok(rSinGP.cola === 0 && /no está medido en GP/.test(rSinGP.motivo || ''),
   `y su motivo culpa al gasto sin medir, no al margen: «${rSinGP.motivo}»`);
ok(rSinGP.motivo !== rCero.motivo,
   'los dos motivos están redactados distinto: «GP no la conoce» y «el ejecutado está en cero» no se arreglan igual');

const fSinCorte = curvaUnicaDeObra({
  semanas: SEMS, obra: f0127.obra, historialAvance: [], subs: [],
  gpData: { ultimaSemana: `S${DESDE}`,
            obras: { '0127': { id: '0127', semanas: { [`S${DESDE}`]: 1000000 } } } },
  otrosGastos: [], maquinaria: [], programa: null });
const rSinCorte = comportamientoDelMargen(fSinCorte);
ok(rSinCorte.cola === 0 && /ningún corte/.test(rSinCorte.motivo || ''),
   `sin un solo corte capturado el motivo lo dice así: «${rSinCorte.motivo}»`);
ok(new Set([rCero.motivo, rSinGP.motivo, rSinCorte.motivo]).size === 3,
   'los tres motivos medibles son tres textos distintos');

// ════════════════════════════════════════════════════════════════════════════
// C · SÓLO LA COLA CONTIGUA
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── C · un hueco en medio corta el tramo ─────────────────────');

// Doce semanas con corte, pero la antepenúltima se capturó en cero: ahí el
// porcentaje no existe y el tramo que se puede leer son sólo las de después.
const ejecConHueco = Array.from({ length: N }, (_, i) => 1000000 * (i + 10));
ejecConHueco[N - 4] = 0;
const fHueco = caso({
  ejec: ejecConHueco,
  gastoAcum: Array.from({ length: N }, (_, i) => 600000 * (i + 10)),
});
const rHueco = comportamientoDelMargen(fHueco.curva);

ok(rHueco.pct[N - 4] === null,
   'la semana capturada en cero no trae porcentaje');
ok(rHueco.pct[N - 5] !== null,
   'y la de antes del hueco SÍ lo trae: el hueco es de una sola semana');
ok(rHueco.cola === 3,
   `la cola son las 3 semanas de después del hueco, no las 11 que traen número (salió ${rHueco.cola})`);
ok(rHueco.renglones.length === 3
   && rHueco.renglones[0].label === SEMS[N - 3].label,
   'los renglones arrancan después del hueco');
ok(rHueco.renglones[0].delta === null,
   'el primer renglón del tramo no trae delta: no hay semana contigua antes contra la que restar');
ok(rHueco.renglones.slice(1).every(r => r.delta !== null),
   'y los demás sí, porque dentro del tramo todas son contiguas');

// ════════════════════════════════════════════════════════════════════════════
// D · SI NO ALCANZAN LAS CUATRO SEMANAS, SE DECLARA
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── D · lo que no se puede calcular se declara ───────────────');

ok(rHueco.minimo === 4,
   'el mínimo por omisión son las 4 semanas que pide el reporte');
ok(rHueco.suficiente === false,
   'con 3 semanas seguidas no alcanza');
ok(/3 semanas seguidas/.test(rHueco.motivo || '') && /se necesitan 4/.test(rHueco.motivo || ''),
   `el motivo dice cuántas hay y cuántas faltan: «${rHueco.motivo}»`);
ok(rHueco.renglones.length === 3,
   'y aun así devuelve las 3 que sí hay: declarar no es esconder');
ok(r0127.suficiente === true && r0127.motivo === null,
   'con 8 semanas seguidas alcanza y no hay nada que declarar');
ok(comportamientoDelMargen(fHueco.curva, { minimo: 3 }).suficiente === true,
   'el mínimo es un parámetro, no una constante escondida');

// El caso de una sola semana, que es la 0131 de producción.
const fUna = caso({
  ejec: [...Array.from({ length: N - 1 }, () => 0), 5000000],
  gastoAcum: Array.from({ length: N }, (_, i) => 20000 * (i + 1)),
});
const rUna = comportamientoDelMargen(fUna.curva);
ok(rUna.cola === 1 && rUna.suficiente === false,
   'una sola semana con margen no es un comportamiento');
ok(/sólo hay 1 semana seguida/.test(rUna.motivo || ''),
   `y se dice en singular, no «1 semanas»: «${rUna.motivo}»`);
ok(rUna.renglones.length === 1 && rUna.renglones[0].delta === null,
   'su único renglón no trae delta');

// ════════════════════════════════════════════════════════════════════════════
// E · EL EJECUTADO QUIETO SE CUENTA Y SE NOMBRA
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── E · la caída del 0127 fue de la captura ──────────────────');

const bajan0127 = r0127.renglones.filter(r => r.delta !== null && r.delta < 0);
ok(bajan0127.length >= 4,
   `en la forma del 0127 hay ${bajan0127.length} semanas en que el margen baja`);
ok(bajan0127.every(r => r.ejecutadoQuieto === true),
   'y TODAS tienen el ejecutado clavado: la caída es de la captura, no de la obra');
ok(r0127.quietas >= bajan0127.length,
   `el conteo de semanas quietas (${r0127.quietas}) cubre las ${bajan0127.length} que bajan`);
const ultimo0127 = r0127.renglones[r0127.renglones.length - 1];
ok(ultimo0127.ejecutadoQuieto === false && ultimo0127.delta > 100,
   `la semana del salto NO está quieta y sube ${PP(ultimo0127.delta)} pp: es el corte que por fin se capturó`);

// Una obra que captura cada semana no tiene ni una semana quieta: si `quietas`
// saliera siempre en algo, la bandera no distinguiría nada.
const fAlDia = caso({
  ejec: Array.from({ length: N }, (_, i) => 1000000 * (i + 10)),
  gastoAcum: Array.from({ length: N }, (_, i) => 600000 * (i + 10)),
});
const rAlDia = comportamientoDelMargen(fAlDia.curva);
ok(rAlDia.quietas === 0 && rAlDia.renglones.every(r => r.ejecutadoQuieto === false),
   'una obra que cierra corte cada semana no tiene ninguna semana quieta');
ok(rAlDia.cola === N,
   `y su cola son las ${N} semanas de la ventana`);

// ════════════════════════════════════════════════════════════════════════════
// F · LA CAÍDA DEL TRAMO Y LA DE LA SEMANA SON DOS CIFRAS
// ════════════════════════════════════════════════════════════════════════════
console.log('\n── F · la forma de la 0114: medio punto por semana ──────────');

// Diez semanas bajando poco más de medio punto cada una. El gasto se despeja
// del porcentaje buscado, que es lo que vuelve al caso una obra que de verdad
// se deteriora despacio y no un artefacto.
const OBJETIVO = [41.4, 40.8, 40.3, 39.8, 39.3, 38.8, 38.3, 37.8, 37.2, 36.6];
const ejecLenta = Array.from({ length: N }, (_, i) => null);
const gastoLenta = Array.from({ length: N }, (_, i) => 0);
for (let i = 0; i < N; i++) {
  const e = 20000000 + i * 1000000;
  ejecLenta[i] = e;
  const pct = i < N - OBJETIVO.length ? 41.4 : OBJETIVO[i - (N - OBJETIVO.length)];
  gastoLenta[i] = Math.round(e * (1 - pct / 100));
}
const fLenta = caso({ ejec: ejecLenta, gastoAcum: gastoLenta, presupuesto: 60000000 });
const rLenta = comportamientoDelMargen(fLenta.curva);

ok(rLenta.cola === N && rLenta.suficiente === true,
   'la obra lenta trae la ventana entera');
ok(rLenta.delTramo < -4 && rLenta.delTramo > -6,
   `el tramo completo cae ${PP(rLenta.delTramo)} pp`);
ok(rLenta.peorSemana !== null && rLenta.peorSemana.delta > -1,
   `y su peor semana suelta cae apenas ${PP(rLenta.peorSemana.delta)} pp`);
ok(rLenta.delTramo < rLenta.peorSemana.delta,
   'la caída del TRAMO es peor que la de cualquier semana: una regla que sólo mire la semana no ve esta obra');
ok(rLenta.quietas === 0,
   'y no es captura: esta obra cierra corte todas las semanas');

ok(r0127.peorSemana.delta < r0127.delTramo,
   'en el 0127 manda la semana y no el tramo: las dos cifras se contestan al revés según la obra');
// EL TRAMO ARRANCA EN LA PRIMERA SEMANA DEL TRAMO, NO DE LA VENTANA. En el
// 0127 la ventana empieza cuatro semanas antes del primer corte, y ahí el
// porcentaje es `null`. Restar contra un `null` lo convierte en cero sin
// avisar —`x - null` es `x`— y el tramo saldría de 95 puntos a 15.
ok(r0127.desde < -79 && r0127.desde > -81,
   `el tramo del 0127 arranca en su primera semana con margen, ${PP(r0127.desde)} pp, no en la ventana hueca`);
ok(r0127.delTramo > 94 && r0127.delTramo < 96,
   `y se mueve ${PP(r0127.delTramo)} pp de punta a punta del tramo`);
ok(rHueco.desde === rHueco.pct[N - 3],
   'el tramo de la obra con hueco también arranca después del hueco, no al principio de la ventana');
ok(r0127.peorSemana.label === r0127.renglones.find(r => r.delta === r0127.peorSemana.delta).label,
   'la peor semana viene con su etiqueta, no sólo con su número');
ok(Math.abs(rLenta.desde - 41.4) < 0.01 && Math.abs(rLenta.hasta - 36.6) < 0.01,
   `el tramo se reporta de punta a punta: ${PP(rLenta.desde)} → ${PP(rLenta.hasta)}`);

// Una curva vacía no revienta ni inventa.
const rNada = comportamientoDelMargen(null);
ok(rNada.cola === 0 && rNada.renglones.length === 0 && typeof rNada.motivo === 'string',
   'sin curva no hay serie, y se dice en vez de reventar');

// ════════════════════════════════════════════════════════════════════════════
// LA CONTRAPRUEBA
// ════════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── CONTRAPRUEBA ─────────────────────────────────────────────');
  const MUTANTES = [
    { nombre: 'el ejecutado en cero se lee como un margen de 0%',
      hacer: () => src.replace(
        '    if (!(e > 0)) return null;\n    return m / e * 100;',
        '    if (!(e > 0)) return 0;\n    return m / e * 100;') },
    { nombre: 'la cola deja de exigir que las semanas sean contiguas',
      hacer: () => src.replace(
        '  let cola = 0;\n  for (let i = pct.length - 1; i >= 0 && pct[i] !== null; i--) cola++;',
        '  let cola = pct.filter(p => p !== null).length;') },
    { nombre: 'el mínimo de semanas del reporte se afloja a una',
      hacer: () => src.replace(
        'const comportamientoDelMargen = (curva, { minimo = 4 } = {}) => {',
        'const comportamientoDelMargen = (curva, { minimo = 1 } = {}) => {') },
    { nombre: 'la cola corta se da por suficiente',
      hacer: () => src.replace(
        '    pct, cola, minimo, suficiente: cola >= minimo, renglones,',
        '    pct, cola, minimo, suficiente: true, renglones,') },
    { nombre: 'el motivo de la cola corta deja de decir cuántas semanas hay',
      hacer: () => src.replace(
        "      : `sólo hay ${cola} semana${cola === 1 ? '' : 's'} seguida${cola === 1 ? '' : 's'} ` +",
        "      : `no hay semanas seguidas ` +") },
    { nombre: 'el ejecutado quieto deja de detectarse',
      hacer: () => src.replace(
        '    const quieto = i > 0 && typeof ejecutado[i] === \'number\'',
        '    const quieto = false && typeof ejecutado[i] === \'number\'') },
    { nombre: 'el delta se calcula cruzando el hueco en vez de dentro del tramo',
      hacer: () => src.replace(
        '      delta: i > ini ? pct[i] - pct[i - 1] : null,',
        '      delta: i > 0 ? pct[i] - pct[i - 1] : null,') },
    { nombre: 'los pesos del renglón se vuelven a restar aquí en vez de leerse de la curva',
      hacer: () => src.replace(
        '      pesos: margen[i], pct: pct[i],',
        '      pesos: (pct[i] ?? 0) / 100 * (ejecutado[i] || 0), pct: pct[i],') },
    { nombre: 'la peor semana se busca al revés y devuelve el mejor ascenso',
      hacer: () => src.replace(
        '    ? caidas.reduce((a, b) => (b.delta < a.delta ? b : a))',
        '    ? caidas.reduce((a, b) => (b.delta > a.delta ? b : a))') },
    { nombre: 'el tramo se mide contra la primera semana de la ventana y no del tramo',
      hacer: () => src.replace(
        '    desde: pct[ini], hasta: pct[fin], delTramo: pct[fin] - pct[ini],',
        '    desde: pct[0], hasta: pct[fin], delTramo: pct[fin] - pct[0],') },
    { nombre: 'el gasto sin medir se confunde con el ejecutado en cero',
      hacer: () => src.replace(
        "      ? 'el gasto de esta obra no está medido en GP, así que no hay margen que seguir semana a semana'",
        "      ? 'el ejecutado acumulado sigue en cero en toda la ventana: el margen en porcentaje no existe, y no vale cero'") },
    { nombre: 'una curva sin gasto medido reporta cola igual que una medida',
      hacer: () => src.replace(
        '    if (typeof m !== \'number\' || !Number.isFinite(m)) return null;',
        '    if (typeof m !== \'number\' || !Number.isFinite(m)) return 0;') },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margen-semanal-'));
  let n = 0;
  for (const m of MUTANTES) {
    const mutado = m.hacer();
    if (mutado === src) {
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» no cambió nada.`);
      process.exit(2);
    }
    const f2 = path.join(dir, `app-${n}.jsx`);
    fs.writeFileSync(f2, mutado);
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f2 }, encoding: 'utf8' });
    // LAS ROJAS SE LEEN DEL VEREDICTO DEL HIJO, NO CONTANDO RENGLONES `FALLA`:
    // si algún día estos bancos se callan las fallas, contar renglones daría
    // cero y la contraprueba se daría por buena sin haber comprobado nada.
    const dicho = (r.stdout + r.stderr).match(/(\d+) en rojo/);
    const caidas = dicho ? Number(dicho[1]) : 0;
    console.log(`\n  «${m.nombre}»`);
    console.log(`     ${caidas} aserción(es) en rojo` + (r.status === 2 ? '  ← NO ARRANCÓ' : ''));
    if (r.status === 2) {
      console.log((r.stdout + r.stderr).split('\n').filter(l => /NO ARRANCÓ/.test(l)).join('\n'));
      process.exit(2);
    }
    if (caidas === 0) {
      console.log('     la contraprueba NO puso nada en rojo: la aserción no afirma lo que dice');
      process.exit(1);
    }
    n++;
  }
  console.log(`\n${n} mutación(es), todas en rojo.\n`);
  process.exit(0);
}

console.log(`\n${verdes} comprobación(es) en verde · ${fallas} en rojo\n`);
process.exit(fallas ? 1 : 0);
