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

// ── EL GASTO SIN FECHAR. Esta es la forma que el preview sorprendió el
// 2026-11-09 sobre Oaxaca Parque Lineal: GP trae fechadas cuatro semanas por
// $8,518,000 de un `grandTotal` de $21,400,000, así que el acumulado semanal
// arranca casi en cero y el último punto salta a los $21.4M completos. El
// margen en porcentaje salía de 97.1% a 0.9% y la pantalla lo publicó como
// «cayó 96.2 puntos en 8 semanas», en CRÍTICO. Las dos cifras son del gasto
// alcanzando su propia serie, no de la obra.
const EJEC_LINEAL = Array.from({ length: N }, (_, i) => 1800000 * (i + 1));
const fSinFechar = curvaUnicaDeObra({
  semanas: SEMS, obra: f0127.obra, subs: [],
  historialAvance: EJEC_LINEAL.map((m, i) => ({
    tipo: 'oficial', año: AÑO, semana: SEMS[i].sem, avance: 10,
    avancePonderado: 10, montoEjecutado: m })),
  gpData: { ultimaSemana: `S${DESDE + N - 1}`,
            obras: { '0127': { id: '0127', grandTotal: 21400000,
                               semanas: { [`S${DESDE}`]: 2368000,
                                          [`S${DESDE + 1}`]: 2100000,
                                          [`S${DESDE + 2}`]: 1740000,
                                          [`S${DESDE + 3}`]: 2310000 } } } },
  otrosGastos: [], maquinaria: [], programa: null });
const rSinFechar = comportamientoDelMargen(fSinFechar);

ok(fSinFechar.gastoSinFechar === true,
   'la curva ya sabe que parte del gasto llega sin fecha: la bandera es suya, no se vuelve a decidir aquí');
ok(fSinFechar.gastoMedido === true,
   'y el gasto SÍ está medido: lo que falla es el reparto por semana, no la medición');
ok(rSinFechar.pct.filter(p => p !== null).length >= 4,
   `las semanas traen número —${rSinFechar.pct.filter(p => p !== null).length} de ${N}—, así que el defecto no es que falte el dato`);
ok(rSinFechar.cola === 0 && rSinFechar.suficiente === false,
   'y aun así NO hay tramo que leer: con el gasto sin fechar la tendencia entera es del gasto, no del margen');
ok(/sin fecha/.test(rSinFechar.motivo || '') && /no es comparable/.test(rSinFechar.motivo || ''),
   `el motivo nombra la fecha que falta y niega la comparación entre semanas: «${rSinFechar.motivo}»`);
ok(new Set([rCero.motivo, rSinGP.motivo, rSinCorte.motivo, rSinFechar.motivo]).size === 4,
   'y es un cuarto texto: «sin medir», «en cero», «sin corte» y «sin fechar» no se arreglan igual');

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
// G · LA REGLA «MARGEN A LA BAJA» (fin_007)
// ════════════════════════════════════════════════════════════════════════════
//
// El umbral —3 pp a lo largo del tramo contiguo de 4+ semanas— se aprobó el
// 2026-11-09 contra la sensibilidad medida en producción: a 5 pp la regla se
// queda sin la única obra de la cartera que se deteriora, y a 3 pp sigue
// señalando una sola de siete.
//
// LO QUE SE AFIRMA AQUÍ es la frontera entre las dos respuestas: la regla
// DISPARA cuando el margen cayó de verdad, y sale NO EVALUABLE —no «sin
// hallazgo»— cuando la caída está sobre un avance que nadie cerró. Las dos
// cosas se deciden en sitios distintos a propósito: la evaluabilidad en el
// dato, el hallazgo en el detector.
console.log('\n── G · la regla fin_007, con el umbral aprobado ──────────────');

const MOTOR = ['evaluarRiesgos', 'BIBLIOTECA_RIESGOS', 'RIESGOS_SOLO_CONSTRUCTORA',
               'DATOS_DEL_RIESGO'];
const { cuerpo: fuenteMotor, faltan: faltanMotor } =
  fuenteDe(archivo, MOTOR, { tolerante: true });
if (faltanMotor.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltanMotor.join(', ')}`);
  process.exit(2);
}
const M = new Function(`"use strict";\n${fuenteMotor}\nreturn { ${MOTOR.join(', ')} };`)();

// GP contestó por esta obra Y CON DINERO. Hace falta: sin esto `fin_001` sale
// NO EVALUABLE por falta de gasto medido, y la comprobación de que las dos
// reglas no se duplican mediría otra cosa —una regla que no corrió no «calla».
const gpConDinero = {
  ultimaSemana: { año: AÑO, semana: DESDE + N - 1 },
  semanasDisponibles: SEMS.map(s => ({ año: AÑO, semana: s.sem })),
  obrasPedidas: ['0127'],
  obras: { '0127': { id: '0127', nombre: 'Centro de convenciones',
                     grandTotal: 25000000 } },
};
const ctxBase = (comp, extra = {}) => ({
  obra: f0127.obra, subs: [{ id: 'p1', importe: 45000000 }],
  historialAvance: [{ tipo: 'oficial', año: AÑO, semana: DESDE + N - 1,
                      avance: 40, avancePonderado: 40 }],
  estimaciones: [], programa: null, gpData: gpConDinero,
  kpis: { me: 40000000, gt: 25000000, mpct: 37.5, brecha: 2, pctGasto: 42, af: 40 },
  comportamientoMargen: comp, ...extra,
});
const dondeEsta = (r, id) =>
  (['detectados', 'sinHallazgo', 'noEvaluables', 'reventaron']
    .find(k => r[k].some(x => x.id === id))) || 'EN NINGUNO';
const hueco = (r, id) => (r.noEvaluables.find(x => x.id === id)?.faltan || [])
  .find(f => f.dato === 'serieMargen') || null;

ok(M.BIBLIOTECA_RIESGOS.some(p => p.id === 'fin_007'),
   'la regla fin_007 está en la biblioteca');
ok(M.RIESGOS_SOLO_CONSTRUCTORA.has('fin_007'),
   'y NO le llega a una dependencia: el margen es economía del contratista');
ok(JSON.stringify(M.BIBLIOTECA_RIESGOS.find(p => p.id === 'fin_007').requiere) === '["serieMargen"]',
   'declara que depende de la serie semanal de margen, y de nada más');

// (a) La obra que se deteriora de verdad: dispara.
const rLentaRiesgo = M.evaluarRiesgos(ctxBase(rLenta));
ok(dondeEsta(rLentaRiesgo, 'fin_007') === 'detectados',
   `la obra que cae ${PP(rLenta.delTramo)} pp en ${rLenta.cola} semanas DISPARA`);
const hallazgo = rLentaRiesgo.detectados.find(x => x.id === 'fin_007');
ok(/4\.8/.test(hallazgo.valor) && /pp/.test(hallazgo.valor),
   `y dice CON QUÉ NÚMERO disparó: valor «${hallazgo.valor}»`);
ok(/12 semanas/.test(hallazgo.detalle),
   `el detalle nombra en cuántas semanas cayó: «${hallazgo.detalle}»`);
ok(/41\.4/.test(hallazgo.extra) && /36\.6/.test(hallazgo.extra),
   `y el extra trae el tramo de punta a punta: «${hallazgo.extra}»`);
ok(hallazgo.severidad === 'medio',
   `4.8 pp es severidad media, no crítica (salió «${hallazgo.severidad}»)`);

// (b) La obra del 0127: la caída es de captura → NO EVALUABLE, no «sin hallazgo».
const r0127Riesgo = M.evaluarRiesgos(ctxBase(r0127));
ok(dondeEsta(r0127Riesgo, 'fin_007') === 'noEvaluables',
   `la forma del 0127 sale NO EVALUABLE: ${r0127.quietas} de ${r0127.cola} semanas con el avance sin cerrar`);
ok(dondeEsta(r0127Riesgo, 'fin_007') !== 'sinHallazgo',
   'y NO sale como «evaluada sin hallazgo», que se leería como que no hay riesgo');
const h0127 = hueco(r0127Riesgo, 'fin_007');
ok(h0127 !== null
   && h0127.porQue.includes(`${r0127.cola} semanas del tramo`)
   && h0127.porQue.includes(`${r0127.quietas} traen`)
   && /sin cerrar/.test(h0127.porQue),
   `el hueco dice cuántas semanas del tramo, cuántas quietas y por qué: «${h0127?.porQue}»`);

// (c) La cola corta: no evaluable por otro motivo, y redactado distinto.
const rCortaRiesgo = M.evaluarRiesgos(ctxBase(rHueco));
ok(dondeEsta(rCortaRiesgo, 'fin_007') === 'noEvaluables',
   'con 3 semanas seguidas la regla no es evaluable');
const hCorta = hueco(rCortaRiesgo, 'fin_007');
ok(hCorta && /3 semanas seguidas/.test(hCorta.porQue),
   `y su motivo es el de la cola corta: «${hCorta?.porQue}»`);
ok(!!hCorta && !!h0127 && hCorta.porQue !== h0127.porQue,
   'los dos motivos de no evaluabilidad están redactados distinto: se arreglan distinto');

// (c bis) EL CASO DEL PREVIEW. La obra con gasto sin fechar no dispara nada:
// antes de la guarda esta misma forma salía en CRÍTICO con «−96.2pp».
const rSinFecharRiesgo = M.evaluarRiesgos(ctxBase(rSinFechar));
ok(dondeEsta(rSinFecharRiesgo, 'fin_007') === 'noEvaluables',
   'la obra con gasto sin fechar NO dispara: su «caída» es el ancla del gasto');
ok(!rSinFecharRiesgo.detectados.some(x => x.id === 'fin_007'),
   'y no hay hallazgo que imprimir con una cifra que no es de esta obra');
const hSinFechar = hueco(rSinFecharRiesgo, 'fin_007');
ok(!!hSinFechar && /sin fecha/.test(hSinFechar.porQue),
   `y el hueco dice que el gasto llega sin fecha: «${hSinFechar?.porQue}»`);

// (d) La pantalla que todavía no pasa la serie: tampoco miente.
const rSinSerie = M.evaluarRiesgos(ctxBase(undefined));
ok(dondeEsta(rSinSerie, 'fin_007') === 'noEvaluables',
   'una pantalla que no pasa la serie deja la regla no evaluable, no silenciosa');
ok(/todavía no calcula/.test(hueco(rSinSerie, 'fin_007')?.porQue || ''),
   `y el hueco culpa a la pantalla, no a la obra: «${hueco(rSinSerie, 'fin_007')?.porQue}»`);

// (e) EL UMBRAL. La obra sana no dispara, y la frontera está donde se aprobó.
ok(dondeEsta(M.evaluarRiesgos(ctxBase(rAlDia)), 'fin_007') === 'sinHallazgo',
   'la obra al día, con margen estable, se evalúa y NO dispara: ése es «sin hallazgo»');

// Una serie fabricada a la medida del umbral, para ejercer los dos lados.
const aLaMedida = (caida, cola = 6) => ({
  pct: [], cola, minimo: 4, suficiente: true, quietas: 0,
  desde: 30, hasta: 30 - caida, delTramo: -caida,
  renglones: [], peorSemana: { delta: -caida / cola, label: 'Sx' }, motivo: null,
});
ok(dondeEsta(M.evaluarRiesgos(ctxBase(aLaMedida(2.9))), 'fin_007') === 'sinHallazgo',
   'una caída de 2.9 pp NO dispara: el umbral aprobado son 3');
ok(dondeEsta(M.evaluarRiesgos(ctxBase(aLaMedida(3.1))), 'fin_007') === 'detectados',
   'una de 3.1 pp SÍ dispara');
ok(M.evaluarRiesgos(ctxBase(aLaMedida(3.1))).detectados
    .find(x => x.id === 'fin_007').severidad === 'medio',
   '3.1 pp es media');
ok(M.evaluarRiesgos(ctxBase(aLaMedida(7))).detectados
    .find(x => x.id === 'fin_007').severidad === 'alto',
   '7 pp es alta');
ok(M.evaluarRiesgos(ctxBase(aLaMedida(12))).detectados
    .find(x => x.id === 'fin_007').severidad === 'critico',
   '12 pp es crítica');
// Y el margen que SUBE no dispara, que es el error de signo más fácil de hacer.
ok(dondeEsta(M.evaluarRiesgos(ctxBase(aLaMedida(-20))), 'fin_007') === 'sinHallazgo',
   'un margen que SUBE 20 pp no dispara: la regla es de caída, no de movimiento');

// (f) NO DUPLICA A fin_001, que mide el NIVEL. La 0114 está en +36.6% —sana
// para fin_001— y es justo la que fin_007 tiene que ver.
const soloTendencia = M.evaluarRiesgos(ctxBase(rLenta));
ok(dondeEsta(soloTendencia, 'fin_001') === 'sinHallazgo'
   && dondeEsta(soloTendencia, 'fin_007') === 'detectados',
   'con margen sano por nivel (37.5%) y cayendo por tendencia: fin_001 calla y fin_007 dispara');
ok(M.BIBLIOTECA_RIESGOS.find(p => p.id === 'fin_001').titulo !==
   M.BIBLIOTECA_RIESGOS.find(p => p.id === 'fin_007').titulo,
   'y las dos reglas tienen títulos distintos: son dos preguntas, no una repetida');

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
        '    for (let i = pct.length - 1; i >= 0 && pct[i] !== null; i--) cola++;',
        '    cola = pct.filter(p => p !== null).length;') },
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

    // ── LAS DE fin_007. Cada una mueve una decisión que se APROBÓ, no un
    // andamio: el umbral de 3 pp, el filtro de captura, el estado de los
    // riesgos no evaluables, el signo de la caída y la frontera de la
    // dependencia.
    { nombre: 'el umbral aprobado de 3 pp se afloja a 1 pp',
      hacer: () => src.replace(
        '      if (caida < 3) return null;',
        '      if (caida < 1) return null;') },
    { nombre: 'el filtro de captura se apaga: una caída sobre avance quieto se da por leíble',
      hacer: () => src.replace(
        '                    return !!m && m.suficiente === true && !(m.quietas * 2 > m.cola);',
        '                    return !!m && m.suficiente === true;') },
    { nombre: 'el tramo corto se da por legible y la regla se evalúa sin tendencia',
      hacer: () => src.replace(
        '                    return !!m && m.suficiente === true && !(m.quietas * 2 > m.cola);',
        '                    return !!m && !(m.quietas * 2 > m.cola);') },
    { nombre: 'la regla acusa el movimiento y no la caída: un margen que sube dispara',
      hacer: () => src.replace(
        '      const caida = -m.delTramo;              // en puntos porcentuales, positiva si cayó',
        '      const caida = Math.abs(m.delTramo);') },
    { nombre: 'el margen a la baja se le muestra también a una dependencia',
      hacer: () => src.replace(
        "  'fin_007',                                          // margen bruto, por tendencia\n",
        '') },
    { nombre: 'la severidad se aplana: toda caída sale media',
      hacer: () => src.replace(
        "      const sev = caida >= 10 ? 'critico' : caida >= 6 ? 'alto' : 'medio';",
        "      const sev = 'medio';") },
    { nombre: 'el hallazgo deja de decir con qué número disparó',
      hacer: () => src.replace(
        '      const cifra = `−${caida.toFixed(1)}pp`;',
        "      const cifra = '';") },
    // La que el preview obligó a escribir: sin esta guarda la pantalla afirma
    // «cayó 96.2 puntos» sobre el gasto llegando a su propia serie.
    { nombre: 'el gasto sin fechar vuelve a dar tramo, y la caída del ancla se lee como del margen',
      hacer: () => src.replace(
        '  if (!curva?.gastoSinFechar)\n    for (let i = pct.length - 1; i >= 0 && pct[i] !== null; i--) cola++;',
        '  for (let i = pct.length - 1; i >= 0 && pct[i] !== null; i--) cola++;') },
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
