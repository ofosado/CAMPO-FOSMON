#!/usr/bin/env node
// ── UNA SEMANA QUE NO SE SABE CUÁL ES ──────────────────────────────────────
//
// Dos defectos de la misma familia: una semana escrita sin lo que la hace
// única, y una pantalla que afirma sobre ella de todos modos.
//
//   (A) LA SEMANA SIN SU AÑO. `gpData.semanasDisponibles` eran claves `S42`
//       sin año, y el parser además sólo conservaba el año más reciente.
//       El 5 de enero la lista entera era ["S1"], y cuatro sitios hacían
//       `slice(-4)` y dividían entre `length` — con el renglón diciendo
//       «últimas 4 semanas» pase lo que pase. Un promedio de una semana
//       presentado como promedio de cuatro es una cifra inventada (P2).
//
//       El ORIGEN se arregló el 2026-11-17: desde `parserVersion` 6 la clave
//       lleva su año (`S2026-47`) y la serie es una ventana de 53 semanas que
//       cruza el 31 de diciembre. Lo que esta pantalla tiene que seguir
//       haciendo —y lo que aquí se mide— es DOS cosas a la vez: entender la
//       forma nueva, incluida la frontera de año, y seguir negándose a
//       promediar cuando falta una semana, porque un hueco en el dato sigue
//       siendo posible y no tiene nada que ver con el año. La forma vieja se
//       sigue leyendo mientras exista un documento v5 por el camino.
//
//   (B) LA SEMANA SIN SU LUGAR. El día de un instante depende de dónde se
//       pregunte. `fechaDeTimestamp` lo resolvía con `getDate()`, o sea en el
//       huso del APARATO: un domingo por la noche en México ya es lunes en
//       Madrid, y la foto se archivaba en la semana siguiente.
//
// Las dos cuentas se SACAN de `src/App.jsx` por AST y se EJECUTAN. Nada aquí
// afirma que un símbolo exista: lo que se afirma es qué sale.
//
// Para (B) hace falta mover el huso del proceso, y la suite lo fija en
// `America/Mexico_City` (ver `scripts/reloj.cjs`). Mover `process.env.TZ` en
// caliente funciona en Node moderno, pero si algún día dejara de funcionar
// esto daría verde por no haber probado nada — así que se COMPRUEBA que el
// cambio mordió, y si no, NO ARRANCÓ 2.
//
// CONTRAPRUEBA de la parte (A), comprobada el 2026-11-17 reponiendo cada
// defecto sobre `src/App.jsx` y corriendo este mismo banco:
//
//   · la frontera del año la decide la LISTA y no el calendario
//     (`pa.semana === _semanasDelAñoGP(pa.año)` → `true`)   → 2 en rojo, salida 1
//   · mezclar las dos formas de clave encadena
//     (`pa.llevaAño !== pb.llevaAño` → `!pa.llevaAño || !pb.llevaAño`)
//                                                            → 1 en rojo, salida 1
//   · la cadena no cruza el año (`if (pa.año !== pb.año) return false`)
//                                                            → 4 en rojo, salida 1
//   · el rótulo maquilla la clave ilegible («última semana»)  → 2 en rojo, salida 1
//   · el rótulo imprime la clave cruda (`String(clave)`)      → 3 en rojo, salida 1
//
// Sobre el archivo bueno: 0 en rojo, salida 0.
//
// Un hallazgo de hacerlas: la contraprueba de la MEZCLA salía verde con el
// caso que tenía escrito, porque la frontera elegida era la de 2026 —53
// semanas— y la rechazaba antes el calendario. El renglón pasaba por el motivo
// equivocado. El caso ahora cruza 2025, que tiene 52, para que lo único capaz
// de romper esa cadena sea la mezcla.

'use strict';

const path = require('path');
const { deApp, SimboloPerdido } = require('./extraer-de-app.cjs');
// El módulo ES la función; `NO_ARRANCO` y las otras puertas son propiedades
// suyas. Destructurar `noArranco` de ahí lo deja en `undefined` sin ruido.
const noArranco = require('./no-arranco.cjs');
const { NO_ARRANCO } = noArranco;

let fallas = 0;
const check = (ok, que, detalle = '') => {
  if (ok) { console.log(`  ok   ${que}`); return; }
  fallas++;
  console.log(`  FALLA ${que}${detalle ? `\n        ${detalle}` : ''}`);
};

let app;
try {
  app = deApp(
    'ultimasSemanasSeguidasGP', 'velocidadSemanalGP', 'semanaAnteriorGP',
    'etiquetaSemanaGP',
    'proveedoresNuevosGP', 'incrementosDeProveedorGP',
    'fechaEnZonaObra', 'fechaDeTimestamp', 'semanaDeEvidencia',
    'semanaISO', 'snapshotId', 'ZONA_OBRA',
  );
} catch (e) {
  if (e instanceof SimboloPerdido) {
    noArranco(`${e.message}\n` +
      'O se renombró un ayudante, o alguien volvió a meter la cuenta de las\n' +
      'semanas dentro del componente que la pinta. Las dos cosas hay que verlas.');
  }
  throw e;
}

const {
  ultimasSemanasSeguidasGP, velocidadSemanalGP, semanaAnteriorGP,
  etiquetaSemanaGP,
  proveedoresNuevosGP, incrementosDeProveedorGP,
  fechaEnZonaObra, fechaDeTimestamp, semanaDeEvidencia, ZONA_OBRA,
} = app;

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. La serie dice cuántas semanas tiene de verdad');
// ════════════════════════════════════════════════════════════════════════════

// La forma que escribe `parserVersion` 6: la clave lleva su año.
const sem = (año, n) => `S${año}-${String(n).padStart(2, '0')}`;
const serieCompleta = Array.from({ length: 42 }, (_, i) => sem(2026, i + 1));

// El caso de hoy. Medido contra producción el 2026-11-17: 47 semanas seguidas.
check(
  JSON.stringify(ultimasSemanasSeguidasGP(serieCompleta, 4)) ===
    JSON.stringify([sem(2026,39), sem(2026,40), sem(2026,41), sem(2026,42)]),
  'con 42 semanas seguidas, las últimas cuatro son S39..S42 de 2026',
  JSON.stringify(ultimasSemanasSeguidasGP(serieCompleta, 4)));

// Una obra que arranca: una sola semana no son cuatro.
check(ultimasSemanasSeguidasGP([sem(2026,1)], 4) === null,
  'una sola semana NO son cuatro semanas');

// Un hueco en el dato: S38, S39, S41, S42 son cuatro claves pero cinco
// semanas de calendario. Esto es lo que sigue mordiendo después del #47.
check(ultimasSemanasSeguidasGP(
  [sem(2026,36), sem(2026,37), sem(2026,38), sem(2026,39), sem(2026,41), sem(2026,42)], 4) === null,
  'cuatro claves con un hueco en medio NO son cuatro semanas seguidas');

// ── LA FRONTERA DE AÑO, QUE ES LO QUE EL #47 CAMBIÓ ──
// El 5 de enero la serie trae diciembre del año viejo y la S1 del nuevo, y
// AHORA sí se puede afirmar que son seguidas: la clave dice de qué año es
// cada una. 2025 tuvo 52 semanas ISO, así que su S52 pega con la S1 de 2026.
const cruceBueno = [sem(2025,50), sem(2025,51), sem(2025,52), sem(2026,1)];
check(JSON.stringify(ultimasSemanasSeguidasGP(cruceBueno, 4)) === JSON.stringify(cruceBueno),
  'S52 de 2025 → S1 de 2026 SÍ son seguidas: la velocidad no se apaga en enero',
  JSON.stringify(ultimasSemanasSeguidasGP(cruceBueno, 4)));

// Y el caso que NO se puede dar por bueno: si en la lista 2026 llega hasta la
// S52 pero la ventana enseña la S50 pegada a la S1 de 2027, faltan dos
// semanas. El año en la clave no es permiso para encadenar cualquier cosa.
check(ultimasSemanasSeguidasGP([sem(2026,48), sem(2026,49), sem(2026,50), sem(2027,1)], 4) === null,
  'S50 de 2026 → S1 de 2027 NO son seguidas: faltan la 51 y la 52');

// Dónde acaba el año lo dice EL CALENDARIO, no la lista. **2026 tiene 53
// semanas ISO**, así que la S52 NO es su última y no encadena con enero de
// 2027: falta la S53. Esta es la frontera de verdad, la que llega en semanas.
check(ultimasSemanasSeguidasGP([sem(2026,50), sem(2026,51), sem(2026,52), sem(2027,1)], 4) === null,
  'S52 de 2026 → S1 de 2027 NO son seguidas: 2026 tiene 53 semanas y falta la 53');
const cruce53 = [sem(2026,51), sem(2026,52), sem(2026,53), sem(2027,1)];
check(JSON.stringify(ultimasSemanasSeguidasGP(cruce53, 4)) === JSON.stringify(cruce53),
  'S53 de 2026 → S1 de 2027 SÍ son seguidas: la 53 sí es la última de 2026',
  JSON.stringify(ultimasSemanasSeguidasGP(cruce53, 4)));

// Un salto de año entero no encadena ni siendo la última de su año.
check(ultimasSemanasSeguidasGP([sem(2025,50), sem(2025,51), sem(2025,52), sem(2027,1)], 4) === null,
  'de 2025 a 2027 no se encadena: falta un año entero');

// ── LA FORMA VIEJA, QUE TODAVÍA PUEDE LLEGAR ──
// Un documento `parserVersion` 5 arrastrado trae claves sin año. De `S42 → S1`
// no se puede saber si son diez semanas de hueco o el año nuevo, así que se
// sigue rechazando: ahí no hay nada que afirmar.
check(ultimasSemanasSeguidasGP(['S39','S40','S41','S42','S1','S2'], 4) === null,
  'sin año, S42 → S1 se sigue rechazando: no se sabe si es un hueco o el año nuevo');
check(JSON.stringify(ultimasSemanasSeguidasGP(['S39','S40','S41','S42'], 4)) ===
  JSON.stringify(['S39','S40','S41','S42']),
  'y la forma vieja se sigue leyendo dentro de un mismo año');
// Mezclar las dos formas no encadena: una clave sin año no se puede comparar
// con una que sí lo lleva sin suponerle un año. La frontera se elige en 2025 a
// propósito —52 semanas, cruce bueno— para que lo ÚNICO que pueda romper la
// cadena sea la mezcla de formas. Con 2026 de por medio la rechazaría el
// calendario y el renglón pasaría por el motivo equivocado: medido el
// 2026-11-17, la contraprueba de la mezcla salía verde.
check(ultimasSemanasSeguidasGP(['S50','S51',sem(2025,52),sem(2026,1)], 4) === null,
  'mezclar las dos formas no encadena: no se le supone el año a la que no lo trae');

// ── LA CLAVE NO SE ASOMA A LA PANTALLA ──
// `S2026-47` es para buscar en un objeto, no para leerlo. Dos rótulos de
// Gastos imprimían la clave cruda, y con el año dentro quedaban peor.
check(etiquetaSemanaGP(sem(2026,47)) === 'semana 47 de 2026',
  'la clave se lee «semana 47 de 2026», no «S2026-47»',
  etiquetaSemanaGP(sem(2026,47)));
// El cero a la izquierda lo lleva la clave para que un `.sort()` ordene; el
// rótulo no tiene por qué cargarlo.
check(etiquetaSemanaGP(sem(2026,3)) === 'semana 3 de 2026',
  'el cero de la clave es para ordenar, no para leerse: «semana 3», no «semana 03»',
  etiquetaSemanaGP(sem(2026,3)));
check(etiquetaSemanaGP('S47') === 'semana 47',
  'la forma vieja se rotula sin inventarle un año',
  etiquetaSemanaGP('S47'));
// Una clave que esta cuenta no sabe leer SE VE. Cambiarla por una frase
// redonda —«última semana»— esconde justo lo que hay que arreglar.
check(etiquetaSemanaGP('S2026-99') === 'S2026-99',
  'una clave ilegible se enseña tal cual, no se maquilla',
  etiquetaSemanaGP('S2026-99'));
check(etiquetaSemanaGP('') === '' && etiquetaSemanaGP(null) === '',
  'sin clave no se rotula nada: la tarjeta ya decide qué poner en su lugar',
  `${JSON.stringify(etiquetaSemanaGP(''))} · ${JSON.stringify(etiquetaSemanaGP(null))}`);

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. La velocidad dice sobre cuántas semanas se calculó');
// ════════════════════════════════════════════════════════════════════════════

const gastoObra = Object.fromEntries(serieCompleta.map(s => [s, 100000]));
const vNormal = velocidadSemanalGP(gastoObra, serieCompleta);
check(vNormal.velocidad === 100000 && vNormal.semanasBase === 4,
  'cuatro semanas de 100 mil dan 100 mil por semana, con base 4',
  JSON.stringify(vNormal));

// EL DEFECTO. Una sola semana con un gasto grande: antes salía como
// «velocidad promedio · últimas 4 semanas». Ahora no sale nada.
const vEnero = velocidadSemanalGP({ S1: 400000 }, ['S1']);
check(vEnero.velocidad === null && vEnero.semanasBase === 0,
  'con una sola semana NO hay velocidad: null, no un promedio de uno',
  JSON.stringify(vEnero));

// `null` y no cero. Cero es un ritmo, y un ritmo de cero proyecta que el
// presupuesto no se agota nunca — que es la mentira tranquilizadora.
check(vEnero.velocidad !== 0,
  'lo que falta se dice null, nunca cero');

// La base viaja con la cifra para que el renglón no lleve un «4» tecleado.
const vTres = velocidadSemanalGP(gastoObra, serieCompleta, 3);
check(vTres.semanasBase === 3, 'la base la dice la cuenta, no el renglón',
  JSON.stringify(vTres));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. «Vs semana anterior» es la anterior de verdad');
// ════════════════════════════════════════════════════════════════════════════

check(semanaAnteriorGP(serieCompleta, sem(2026,42)) === sem(2026,41),
  'la anterior de la S42 es la S41 del mismo año');
check(semanaAnteriorGP([sem(2026,1)], sem(2026,1)) === null,
  'la primera semana de la serie no tiene anterior');
check(semanaAnteriorGP([sem(2026,40), sem(2026,42)], sem(2026,42)) === null,
  'con un hueco, la de la lista está a dos semanas y no sirve de «anterior»');
// La frontera de año también aquí: la anterior de la S1 de 2026 es la S52 de
// 2025, y eso es lo que el #47 hizo decible.
check(semanaAnteriorGP([sem(2025,52), sem(2026,1)], sem(2026,1)) === sem(2025,52),
  'la anterior de la S1 de 2026 es la S52 de 2025, no «ninguna»',
  String(semanaAnteriorGP([sem(2025,52), sem(2026,1)], sem(2026,1))));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Un proveedor nuevo necesita un «antes» del que faltar');
// ════════════════════════════════════════════════════════════════════════════

const provs = [
  { nombre: 'Aceros del Norte',
    semanas: { [sem(2026,40)]: 10, [sem(2026,41)]: 20, [sem(2026,42)]: 40 }, total: 70 },
  { nombre: 'Grúas Omega',      semanas: { [sem(2026,42)]: 50 }, total: 50 },
  { nombre: 'Cementos Sur',     semanas: { [sem(2026,39)]: 10 }, total: 10 },
  // Justo en la raya: +50% exacto. El umbral es «más de 50», no «50 o más»,
  // y la raya se fija aquí para que nadie la mueva sin darse cuenta.
  { nombre: 'Arena y Grava',
    semanas: { [sem(2026,41)]: 20, [sem(2026,42)]: 30 }, total: 50 },
];

const nuevos = proveedoresNuevosGP(provs, serieCompleta, sem(2026,42));
check(nuevos.length === 1 && nuevos[0].nombre === 'Grúas Omega',
  'con historia, sólo el que aparece por primera vez es nuevo',
  nuevos.map(p => p.nombre).join(', '));

// EL DEFECTO. El 5 de enero todos tienen exactamente una semana y es la
// última, así que todos salían anunciados como proveedores nuevos.
const provsEnero = provs.map(p => ({ ...p, semanas: { [sem(2027,1)]: 10 } }));
check(proveedoresNuevosGP(provsEnero, [sem(2027,1)], sem(2027,1)).length === 0,
  'en la primera semana del año NO se anuncia a nadie como nuevo',
  `anunciados: ${proveedoresNuevosGP(provsEnero, [sem(2027,1)], sem(2027,1)).length}`);

// Y la otra mitad de lo mismo, que es lo que el #47 destrabó: en enero de 2027
// la serie TRAE 2026, así que el que ya venía no se anuncia como nuevo y el que
// aparece por primera vez sí. Antes de la ventana de 53 semanas no había
// diciembre que consultar y los cuatro salían anunciados.
const serieACaballo = [sem(2026,51), sem(2026,52), sem(2026,53), sem(2027,1)];
const provsACaballo = [
  { nombre: 'Aceros del Norte', semanas: { [sem(2026,52)]: 20, [sem(2027,1)]: 30 }, total: 50 },
  { nombre: 'Grúas Omega',      semanas: { [sem(2027,1)]: 50 }, total: 50 },
];
const nuevosEnero = proveedoresNuevosGP(provsACaballo, serieACaballo, sem(2027,1));
check(nuevosEnero.length === 1 && nuevosEnero[0].nombre === 'Grúas Omega',
  'en enero, el que ya venía de diciembre NO es nuevo: la serie cruza el año',
  nuevosEnero.map(p => p.nombre).join(', ') || '(ninguno)');

// Un hueco en el Sheet NO borra la historia. Con S38..S41 y S43 —sin S42—
// Grúas Omega sigue sin aparecer nunca antes, y decirlo es cierto. Exigir
// cuatro semanas seguidas aquí escondía una tarjeta verdadera: lo comprobó el
// preview el 2026-10-27, con la tarjeta desapareciendo al abrir un hueco.
const conHueco = [38, 39, 40, 41, 42].map(n => sem(2026, n));
const nuevosConHueco = proveedoresNuevosGP(
  provs, conHueco.filter(s => s !== sem(2026,40)), sem(2026,42));
check(nuevosConHueco.length === 1 && nuevosConHueco[0].nombre === 'Grúas Omega',
  'un hueco en el Sheet no borra la historia: el nuevo se sigue nombrando',
  nuevosConHueco.map(p => p.nombre).join(', ') || '(ninguno)');

const incs = incrementosDeProveedorGP(provs, serieCompleta, sem(2026,42));
check(incs.length === 1 && incs[0].nombre === 'Aceros del Norte'
  && Math.round(incs[0].incrementoPct) === 100,
  'un salto de 20 a 40 es +100% contra la semana contigua, y es el único',
  JSON.stringify(incs.map(p => [p.nombre, p.incrementoPct])));

check(!incs.some(p => p.nombre === 'Arena y Grava'),
  '+50% exacto no pasa la raya de «más de 50%»');

check(incrementosDeProveedorGP(provs, [sem(2026,40), sem(2026,42)], sem(2026,42)).length === 0,
  'sin semana contigua no se afirma ningún incremento «vs semana anterior»');

// El incremento también cruza el año: de 20 a 30 entre la S53 de 2026 y la S1
// de 2027 son +50%, que no pasa la raya; de 20 a 40 sí. Lo que importa es que
// la pregunta se puede HACER en enero, no que la respuesta sea sí.
const incEnero = incrementosDeProveedorGP(
  [{ nombre: 'Aceros del Norte', semanas: { [sem(2026,53)]: 20, [sem(2027,1)]: 40 }, total: 60 }],
  [sem(2026,51), sem(2026,52), sem(2026,53), sem(2027,1)], sem(2027,1));
check(incEnero.length === 1 && Math.round(incEnero[0].incrementoPct) === 100,
  'el +100% de diciembre a enero se afirma: la anterior está al otro lado del año',
  JSON.stringify(incEnero.map(p => [p.nombre, p.incrementoPct])));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. El día de una foto es el de la OBRA, no el del aparato');
// ════════════════════════════════════════════════════════════════════════════

check(ZONA_OBRA === 'America/Mexico_City',
  'el calendario de referencia está escrito en un solo sitio', ZONA_OBRA);

// Domingo 25 de octubre de 2026, 23:40 hora de la Ciudad de México.
// En UTC eso ya es lunes 26 a las 05:40; en Madrid, lunes 26 a las 06:40.
// Es DOMINGO en la obra, así que es la semana que termina, no la que empieza.
const INSTANTE = new Date('2026-10-26T05:40:00Z');
const tsFirestore = { seconds: Math.floor(INSTANTE.getTime() / 1000) };

const HUSOS = ['America/Mexico_City', 'Europe/Madrid', 'UTC',
  'Pacific/Kiritimati', 'Pacific/Midway'];

const husoOriginal = process.env.TZ;
const conHuso = (tz, fn) => {
  process.env.TZ = tz;
  try { return fn(); } finally { process.env.TZ = husoOriginal; }
};

// El cambio de huso tiene que MORDER, o este apartado entero está midiendo
// aire y daría verde sin haber probado nada.
const horaEn = tz => conHuso(tz, () => new Date(INSTANTE).getHours());
if (horaEn('America/Mexico_City') === horaEn('Pacific/Kiritimati')) {
  noArranco(
    'Cambiar `process.env.TZ` en caliente ya no mueve la hora local de Node\n' +
    `(${process.version}). Sin eso, este banco no puede poner el aparato en\n` +
    'otro país y lo de abajo no probaría nada. Hay que pasarlo a procesos hijo\n' +
    'con `TZ=` en el ambiente.');
}

const diasVistos = new Set();
const semanasVistas = new Set();
for (const tz of HUSOS) {
  const dia = conHuso(tz, () => fechaDeTimestamp(tsFirestore));
  const sem = conHuso(tz, () => semanaDeEvidencia({
    fechaServidor: fechaDeTimestamp(tsFirestore), fechaDeclarada: null }));
  diasVistos.add(dia);
  semanasVistas.add(sem);
  console.log(`       aparato en ${tz.padEnd(22)} → día ${dia}  semana ${sem}`);
}

check(diasVistos.size === 1 && diasVistos.has('2026-10-25'),
  'el mismo instante da el mismo día desde cinco husos: el domingo 25',
  [...diasVistos].join(' · '));

check(semanasVistas.size === 1,
  'y por lo tanto cae en UNA sola semana, no en dos según quién mire',
  [...semanasVistas].join(' · '));

// La semana correcta es la del domingo 25 —la 43 de 2026—, no la del lunes 26.
check(semanasVistas.has('S43-2026'),
  'la foto del domingo por la noche queda en la semana que termina, no en la que empieza',
  [...semanasVistas].join(' · '));

// `fechaEnZonaObra` no depende del idioma del aparato: `toLocaleDateString`
// con `es-MX` habría dado `25/10/2026`, que es cambiar un heredado por otro.
check(fechaEnZonaObra(INSTANTE) === '2026-10-25',
  'la fecha sale `YYYY-MM-DD` por partes, no por el formato del locale',
  String(fechaEnZonaObra(INSTANTE)));

check(fechaEnZonaObra(new Date('no es una fecha')) === null,
  'una fecha ilegible se dice null, no se inventa un día');

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${fallas === 0 ? 'VERDE' : 'ROJO'} · ` +
  `${fallas === 0 ? 'todas las comprobaciones' : `${fallas} fallas`}`);
process.exit(fallas > 0 ? 1 : 0);
