#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// SE ENSEÑA LO QUE PESA, Y LO QUE PESA Y NO TIENE FOTO TAMBIÉN SE DICE
// ════════════════════════════════════════════════════════════════════════════
//
// EL DEFECTO. El expediente fotográfico se armaba con DOS criterios que se
// llamaban igual. El PDF ordenaba por `cobertura.porImporte` —el mismo arreglo
// con el que se calcula el porcentaje de cobertura— y el tablero ordenaba por
// DELTA DE AVANCE DE LA SEMANA, con el número de fotos como desempate. Al lado
// del segundo había un comentario afirmando «mismo criterio que el PDF». No lo
// era, y de la diferencia salían dos cosas:
//
//   LA PARTIDA GRANDE DESAPARECÍA DE LA PANTALLA. Una partida que vale el 30%
//   del contrato y que esta semana no se tocó tiene delta cero, así que caía al
//   final de la cola del tablero. El PDF la enseñaba primera. Dos vistas del
//   mismo expediente, dos respuestas a «qué respalda esta obra».
//
//   «MÁS FOTOS» PREMIABA A QUIEN REPITE LA TOMA. El desempate del tablero era
//   la cantidad de fotos. Seis fotos del mismo señalamiento le ganaban a una
//   foto de la partida que sostiene el contrato.
//
// Y LAS DOS COMPARTÍAN UN TERCER DEFECTO: el PDF filtra
// `.filter(x => x.fotos.length > 0)`. Una partida del corte del 80% SIN
// evidencia no aparecía en ningún sitio del resumen fotográfico. El dato existe
// —`cobertura.faltan` lo trae— pero la fila no se imprimía. **Omitir del
// expediente justo a la partida grande que no tiene con qué respaldarse es
// convertir el hueco en silencio en el único sitio donde más pesa.**
//
// QUÉ AFIRMA ESTE BANCO. No afirma que `seleccionFotografica` exista: afirma la
// decisión que toma, ejecutándola.
//
//   §1 QUIÉNES ENTRAN — las partidas que acumulan el `COBERTURA_TECHO` del
//      importe contratado, de mayor a menor. Y se afirma por el lado que
//      importa: una partida grande que NO se movió esta semana entra, y una
//      pequeña con muchas fotos no desplaza a ninguna.
//   §2 CUÁNTAS LE TOCAN — en proporción al peso. La aserción fuerte es la
//      MONOTONÍA: a igual disponibilidad, la que pesa más nunca recibe menos.
//      Es el caso que se pidió con nombre y apellido: «una partida del 25% no
//      puede quedar representada por una sola foto mientras otra del 5% se
//      lleva seis».
//   §3 LA QUE NO TIENE FOTOS APARECE IGUAL, con `sinEvidencia` en verdadero.
//   §4 LAS QUE NO PONDERAN no desplazan a las del corte, pero no se pierden; y
//      cuando la cobertura NO ES MEDIBLE todo cae ahí y las fotos se siguen
//      enseñando, en lugar de desaparecer junto con el porcentaje que no se
//      pudo calcular.
//   §5 EL RECORTE SE DECLARA. Si la pantalla no tiene sitio para las doce
//      partidas del corte, `recortadas` dice cuántas no se pintaron. Enseñar
//      cuatro de doce en silencio se lee como que eran cuatro.
//   §6 LAS FOTOS SON LAS MÁS RECIENTES de cada partida, no las primeras que
//      vinieron en el documento.
//   §7 EL «% DEL CONTRATO» QUE SE IMPRIME tiene por denominador el contrato
//      entero, no el corte del 80% ni el catálogo con las extraordinarias
//      encima. Es una cifra publicada en la tarjeta y en la tabla de huecos.
//   §8 LA TARJETA Y EL EXPEDIENTE NO PUEDEN DISCREPAR: con el mismo tope,
//      recortar cuántas partidas caben en pantalla RECORTA Y NADA MÁS. No
//      reordena y no mueve una sola foto de partida. Era el defecto de arriba
//      con otro disfraz: si el reparto dependiera del sitio disponible, la
//      tarjeta volvería a enseñar lo que el PDF no imprime.
//
// LO QUE NO SE AFIRMA. Cuántas partidas caben en cada sitio: eso es de la
// pantalla —una hoja de PDF y una tarjeta del tablero no tienen el mismo
// espacio— y fijarlo aquí convertiría una decisión de maquetación en una
// aserción de conducta. El TOPE DE FOTOS sí es compartido (`TOPE_FOTOS`, al
// lado de `COBERTURA_TECHO`) porque de él depende el reparto, pero su valor
// tampoco se afirma: lo que se afirma es que con el mismo tope las dos
// pantallas obtienen la misma lista.
//
// Uso:
//     node scripts/prueba-se-enseña-lo-que-pesa.cjs
//     node scripts/prueba-se-enseña-lo-que-pesa.cjs --contraprueba

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');

noArranco.vigilarExcepciones(__filename);

const PEDIDOS = [
  'seleccionFotografica', 'coberturaDeEvidencia', 'frasesDeCobertura',
  'COBERTURA_TECHO', 'COBERTURA_PISO',
  'evidenciaDePartida', 'evidenciaVigente', 'idDePartida',
  'importeCatalogoPartida', 'soloCatalogo',
];
const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) noArranco(faltan);

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── EL CATÁLOGO DE LA PRUEBA ──────────────────────────────────────────────
// Los importes están elegidos para que el corte del 80% caiga en un sitio
// comprobable a mano: 50 + 25 = 75 no llega, 50 + 25 + 15 = 90 sí lo pasa, así
// que el corte son A, B y C, y la de 5 y la de 3 quedan fuera. Si alguien mueve
// `COBERTURA_TECHO` esta cuenta cambia, y por eso el banco la deriva del propio
// constante en lugar de teclear «3».
//
// EL ORDEN DEL ARREGLO NO ES EL ORDEN DE IMPORTE, Y ESO NO ES ADORNO. La
// primera versión de este banco las tenía de mayor a menor, que es como se leen
// mejor — y con ese catálogo la contraprueba DEJÓ PASAR la mutación que
// sustituye el corte ponderado por «las primeras del documento»: las dos
// cuentas daban la misma lista. Un fixture ordenado estaba comprobando el
// criterio contra un caso donde el criterio no importa. Van revueltas, y E —la
// más chica— va primera.
const CAT = [
  { sec: 'E', sub: 'Señalamiento',   imp:  3_000_000, a: 95 },
  { sec: 'C', sub: 'Instalaciones',  imp: 15_000_000, a: 70 },
  { sec: 'A', sub: 'Terracerías',    imp: 50_000_000, a: 40 },
  { sec: 'D', sub: 'Acabados',       imp:  5_000_000, a: 90 },
  { sec: 'B', sub: 'Estructura',     imp: 25_000_000, a: 10 },
];

// Una foto, en la forma NORMALIZADA que consume todo lo que pinta evidencia.
// `fechaServidor` es el día en el calendario de la obra, que es el campo por el
// que `evidenciaDePartida` ordena.
let n = 0;
const foto = (partidaId, fechaServidor, extra = {}) => ({
  id: `ev${++n}`, url: `https://x/${n}.jpg`, partidaId,
  sec: partidaId, sub: 'toma', origen: 'captura_en_vivo',
  verificada: true, fechaServidor, fechaDeclarada: null,
  anulada: false, motivoAnulacion: null, ...extra,
});

// `k` fotos de una partida, de la más vieja a la más nueva, para que el orden
// en que llegan NO sea el orden en que deben salir.
const fotosDe = (id, k, mesBase = 1) =>
  Array.from({ length: k }, (_, i) =>
    foto(id, `2026-${String(mesBase + i).padStart(2, '0')}-10`));

function correr(fuente) {
  const A = construir(fuente);
  const fallos = [];
  const callado = !!process.env.CALLADO;
  const check = (ok, que, detalle = '') => {
    if (ok) { if (!callado) console.log(`  ok   ${que}`); return; }
    fallos.push(`${que}${detalle ? ` · ${detalle}` : ''}`);
    if (!callado) console.log(`  FALLA ${que}\n        ${detalle}`);
  };
  const sel = (args) => A.seleccionFotografica(args);
  const idsDe = (ps) => ps.map(p => p.id).join(',');

  // Cuántas partidas tiene que traer el corte, derivado del techo vivo.
  const total = CAT.reduce((t, s) => t + s.imp, 0);
  let acum = 0, enCorteEsperado = 0;
  for (const s of [...CAT].sort((x, y) => y.imp - x.imp)) {
    if ((acum / total) * 100 >= A.COBERTURA_TECHO) break;
    acum += s.imp; enCorteEsperado++;
  }

  // ══ §1 · QUIÉNES ENTRAN ══════════════════════════════════════════════════
  if (!callado) console.log(`\n§1 · entran las que pesan (techo ${A.COBERTURA_TECHO}%)`);

  // La partida A pesa el 50% y NO se movió esta semana (`a` no cambia, y de
  // todos modos la selección no recibe historial: no puede saberlo). La E pesa
  // el 3% y trae SEIS fotos. Con el criterio viejo del tablero —delta primero,
  // número de fotos de desempate— E salía primera y A ni aparecía.
  const evid1 = [...fotosDe('A', 1), ...fotosDe('B', 1), ...fotosDe('C', 1),
                 ...fotosDe('E', 6)];
  const r1 = sel({ subs: CAT, evidencia: evid1, tope: 15 });

  check(r1.partidas.length === enCorteEsperado,
    `el corte son las ${enCorteEsperado} partidas que acumulan el ${A.COBERTURA_TECHO}% del contrato`,
    `trajo ${r1.partidas.length}: ${idsDe(r1.partidas)}`);
  check(idsDe(r1.partidas) === 'A,B,C',
    'y vienen de mayor a menor importe: A, B, C',
    `vino ${idsDe(r1.partidas)}`);
  check(r1.partidas[0].id === 'A',
    'la partida del 50% que NO se movió esta semana va primera',
    `fue ${r1.partidas[0]?.id}`);
  check(!r1.partidas.some(p => p.id === 'E'),
    'la partida del 3% con seis fotos NO entra al corte por tener más fotos',
    `el corte es ${idsDe(r1.partidas)}`);
  check(r1.fuera.some(p => p.id === 'E'),
    'pero queda registrada fuera del corte, no se pierde');

  // ══ §2 · CUÁNTAS LE TOCAN ════════════════════════════════════════════════
  if (!callado) console.log('\n§2 · el reparto es proporcional al peso');

  // Las tres del corte con fotos de sobra. 50/25/15 sobre un tope de 15.
  const evid2 = [...fotosDe('A', 10), ...fotosDe('B', 10), ...fotosDe('C', 10)];
  const r2 = sel({ subs: CAT, evidencia: evid2, tope: 15 });
  const cupo = Object.fromEntries(r2.partidas.map(p => [p.id, p.fotos.length]));

  check(r2.elegidas === 15, 'se usa el tope completo cuando hay fotos para llenarlo',
    `eligió ${r2.elegidas}`);
  check(cupo.A > cupo.B && cupo.B > cupo.C,
    'a más peso, más fotos: A(50%) > B(25%) > C(15%)',
    `dio A=${cupo.A} B=${cupo.B} C=${cupo.C}`);
  // La cuota ideal de A sobre 15 es 15 × 50/90 = 8.33. No se afirma «8» —eso
  // sería tatuar el redondeo— sino que no se desvía de su cuota en más de una
  // foto, que es lo máximo que puede desviarse un reparto de enteros.
  for (const [id, peso] of [['A', 50], ['B', 25], ['C', 15]]) {
    const ideal = 15 * (peso / 90);
    check(Math.abs(cupo[id] - ideal) < 1,
      `${id} se queda a menos de una foto de su cuota (${ideal.toFixed(2)})`,
      `le tocaron ${cupo[id]}`);
  }

  // EL CASO CON NOMBRE: la del 25% no puede quedarse con una mientras la del
  // 5% se lleva seis. Se construye al revés de lo que conviene —B con una sola
  // foto disponible, D con seis— y se afirma que el reparto NO premia la
  // disponibilidad: D no está en el corte, así que no compite.
  const evid3 = [...fotosDe('B', 1), ...fotosDe('D', 6)];
  const r3 = sel({ subs: CAT, evidencia: evid3, tope: 15 });
  const cupo3 = Object.fromEntries([...r3.partidas, ...r3.fuera].map(p => [p.id, p.fotos.length]));
  check(cupo3.B === 1, 'B enseña la única foto que tiene', `enseñó ${cupo3.B}`);
  check(r3.partidas.some(p => p.id === 'B'),
    'B sigue en el corte aunque sólo tenga una foto');
  check(!r3.partidas.some(p => p.id === 'D'),
    'D (5%) no entra al corte por traer seis fotos',
    `el corte es ${idsDe(r3.partidas)}`);

  // Y la monotonía con disponibilidad IGUAL, que es la propiedad del reparto:
  // dos partidas del corte con las mismas fotos disponibles se reparten por
  // peso y nunca al revés.
  const evid4 = [...fotosDe('A', 6), ...fotosDe('B', 6), ...fotosDe('C', 6)];
  const r4 = sel({ subs: CAT, evidencia: evid4, tope: 6 });
  const cupo4 = Object.fromEntries(r4.partidas.map(p => [p.id, p.fotos.length]));
  check(cupo4.A >= cupo4.B && cupo4.B >= cupo4.C,
    'con la misma disponibilidad y un tope apretado, el orden por peso se respeta',
    `dio A=${cupo4.A} B=${cupo4.B} C=${cupo4.C}`);
  check(cupo4.A + cupo4.B + cupo4.C === 6, 'y el tope apretado se reparte entero',
    `sumó ${cupo4.A + cupo4.B + cupo4.C}`);

  // El sobrante de una partida que no tiene con qué llenar su cuota se
  // REDISTRIBUYE, no se pierde: A tiene derecho a ~8 de 15 y sólo trae 2. Si el
  // sobrante se perdiera, B y C se quedarían en sus cuotas (4 y 3) y la hoja
  // saldría con 9 fotos teniendo 22 disponibles.
  const evid5 = [...fotosDe('A', 2), ...fotosDe('B', 10), ...fotosDe('C', 10)];
  const r5 = sel({ subs: CAT, evidencia: evid5, tope: 15 });
  const cupo5 = Object.fromEntries(r5.partidas.map(p => [p.id, p.fotos.length]));
  check(cupo5.A === 2, 'A enseña las dos que tiene y no se le inventa una tercera',
    `enseñó ${cupo5.A}`);
  check(r5.elegidas === 15 && cupo5.B + cupo5.C === 13,
    'las 6 que A no puede usar pasan a B y C, y el tope se llena igual',
    `eligió ${r5.elegidas} · B=${cupo5.B} C=${cupo5.C}`);

  // Y cuando NO hay fotos para llenar el tope, no se rellena con nada: la hoja
  // sale con las que existen.
  const evid5b = [...fotosDe('A', 2), ...fotosDe('B', 3), ...fotosDe('C', 3)];
  const r5b = sel({ subs: CAT, evidencia: evid5b, tope: 15 });
  check(r5b.elegidas === 8, 'con 8 fotos disponibles y tope 15, salen 8',
    `eligió ${r5b.elegidas}`);

  // ══ §3 · LA QUE PESA Y NO TIENE FOTO APARECE IGUAL ═══════════════════════
  if (!callado) console.log('\n§3 · el hueco grande se dice, no se omite');

  // A pesa el 50% y no tiene una sola foto. El criterio viejo del PDF la
  // filtraba con `.filter(x => x.fotos.length > 0)`.
  const evid6 = [...fotosDe('B', 3), ...fotosDe('C', 3)];
  const r6 = sel({ subs: CAT, evidencia: evid6, tope: 15 });
  const a6 = r6.partidas.find(p => p.id === 'A');
  check(!!a6, 'la partida del 50% sin fotos SIGUE en el corte', 'no vino');
  check(a6?.sinEvidencia === true, 'y viene marcada como sin evidencia',
    `sinEvidencia=${a6?.sinEvidencia}`);
  check(a6?.fotos.length === 0, 'sin fotos inventadas para llenar su sitio',
    `trajo ${a6?.fotos.length}`);
  check(r6.sinEvidencia.length === 1 && r6.sinEvidencia[0].id === 'A',
    'y sale en la lista de las que hay que declarar',
    `la lista es ${idsDe(r6.sinEvidencia)}`);
  check(r6.mostradas.some(p => p.id === 'A'),
    'la pantalla la recibe entre las que tiene que pintar');

  // ══ §4 · LAS QUE NO PONDERAN ═════════════════════════════════════════════
  if (!callado) console.log('\n§4 · lo que no pondera no desplaza, pero no se pierde');

  // Una extraordinaria con fotos. No entra en el denominador de la cobertura
  // —no está en el contrato firmado— pero su evidencia existe.
  const EXTRA = [...CAT, { sec: 'X', sub: 'Extraordinaria', imp: 9_000_000, a: 50, extra: true }];
  const evid7 = [...fotosDe('A', 10), ...fotosDe('B', 10), ...fotosDe('C', 10),
                 ...fotosDe('X', 4)];
  const r7 = sel({ subs: EXTRA, evidencia: evid7, tope: 15 });
  check(!r7.partidas.some(p => p.id === 'X'),
    'la extraordinaria no entra en el corte del contrato');
  check(r7.partidas.reduce((t, p) => t + p.fotos.length, 0) === 15,
    'y no le quita ni una foto al corte cuando el corte llena el tope',
    `el corte se llevó ${r7.partidas.reduce((t, p) => t + p.fotos.length, 0)}`);

  // Con sitio de sobra, sí entra: dejar fuera evidencia que existe por un hueco
  // de maquetación sería hacerla invisible.
  const evid8 = [...fotosDe('A', 2), ...fotosDe('X', 4)];
  const r8 = sel({ subs: EXTRA, evidencia: evid8, tope: 15 });
  check(r8.fuera.find(p => p.id === 'X')?.fotos.length === 4,
    'con sitio sobrante la extraordinaria sí se enseña',
    `enseñó ${r8.fuera.find(p => p.id === 'X')?.fotos.length}`);

  // LA COBERTURA NO MEDIBLE. Sin importes no hay corte del 80%, y lo que no
  // puede pasar es que las fotos desaparezcan junto con el porcentaje.
  const SIN_IMP = CAT.map(s => ({ ...s, imp: 0 }));
  const r9 = sel({ subs: SIN_IMP, evidencia: fotosDe('A', 3), tope: 15 });
  check(r9.medible === false, 'sin importes la cobertura no es medible');
  check(r9.partidas.length === 0, 'y no hay corte del 80% que ordenar');
  check(r9.elegidas === 3,
    'pero las tres fotos que existen se siguen enseñando',
    `enseñó ${r9.elegidas}`);

  // LA EVIDENCIA NO LEÍDA es otra cosa, y no se dice igual: una lectura
  // denegada llega con la lista vacía, igual que una obra sin fotos.
  const r10 = sel({ subs: CAT, evidencia: [], evidenciaCargada: false, tope: 15 });
  check(r10.medible === false, 'sin lectura no hay cobertura');
  check(r10.cobertura.razon === 'no-leida',
    'y el motivo distingue «no se pudo leer» de «no hay fotos»',
    `dijo ${r10.cobertura.razon}`);

  // Una foto ANULADA no es evidencia. No se borra —el expediente la necesita—
  // pero no sostiene ni una fila.
  const evid11 = [...fotosDe('A', 2), foto('B', '2026-05-10', { anulada: true })];
  const r11 = sel({ subs: CAT, evidencia: evid11, tope: 15 });
  check(r11.partidas.find(p => p.id === 'B')?.sinEvidencia === true,
    'una partida cuya única foto está anulada cuenta como sin evidencia',
    `sinEvidencia=${r11.partidas.find(p => p.id === 'B')?.sinEvidencia}`);

  // ══ §5 · EL RECORTE SE DECLARA ═══════════════════════════════════════════
  if (!callado) console.log('\n§5 · lo que no cabe se cuenta');

  const r12 = sel({ subs: CAT, evidencia: evid2, tope: 15, topePartidas: 2 });
  check(r12.mostradas.length === 2, 'la pantalla pinta las 2 que le caben',
    `pintó ${r12.mostradas.length}`);
  check(r12.partidas.length === enCorteEsperado,
    'pero el corte completo se devuelve igual: decir «2 de 3» necesita el 3',
    `el corte trajo ${r12.partidas.length}`);
  check(r12.recortadas === enCorteEsperado - 2,
    'y `recortadas` dice cuántas se quedaron sin pintar',
    `dijo ${r12.recortadas}`);
  check(idsDe(r12.mostradas) === 'A,B',
    'las que se pintan son las de mayor peso, no las primeras del documento',
    `pintó ${idsDe(r12.mostradas)}`);

  // ══ §6 · LAS MÁS RECIENTES ═══════════════════════════════════════════════
  if (!callado) console.log('\n§6 · de cada partida, las más recientes');

  // Las fotos de A entran de enero a junio; se le van a asignar varias y tienen
  // que salir las de junio hacia atrás, no las de enero hacia adelante.
  const evid13 = [...fotosDe('A', 6, 1)];
  const r13 = sel({ subs: CAT, evidencia: evid13, tope: 2 });
  const elegidas = r13.partidas.find(p => p.id === 'A').fotos.map(f => f.fechaServidor);
  check(elegidas[0] === '2026-06-10' && elegidas[1] === '2026-05-10',
    'salen las dos más recientes, en orden descendente',
    `salieron ${elegidas.join(' , ')}`);

  // ══ §7 · EL PESO QUE SE IMPRIME ══════════════════════════════════════════
  if (!callado) console.log('\n§7 · el «% del contrato» es del contrato');

  // La tarjeta y la tabla de huecos imprimen `pesoPct`. Es una cifra publicada,
  // así que tiene denominador y el denominador es EL CONTRATO: la suma del
  // catálogo ponderable. Una extraordinaria autorizada no diluye el peso de una
  // partida contratada —no está en el contrato que se firmó— y si lo hiciera,
  // el 51% de A se leería como 47% sin que nada hubiera cambiado en la obra.
  const pesoA = (50 / 98) * 100;
  const pA = r1.partidas.find(p => p.id === 'A');
  check(Math.abs(pA.pesoPct - pesoA) < 0.01,
    `A pesa ${pesoA.toFixed(2)}% del contrato (50 de 98 millones)`,
    `dijo ${pA.pesoPct?.toFixed(2)}`);
  const pA7 = r7.partidas.find(p => p.id === 'A');
  check(Math.abs(pA7.pesoPct - pesoA) < 0.01,
    'y con una extraordinaria de 9 millones encima sigue pesando lo mismo',
    `dijo ${pA7.pesoPct?.toFixed(2)}`);

  // ══ §8 · DOS PANTALLAS, UNA SOLA LISTA ═══════════════════════════════════
  if (!callado) console.log('\n§8 · la tarjeta y el expediente no pueden discrepar');

  // El defecto que originó este banco era que el tablero y el PDF decidían por
  // separado. Ahora los dos llaman a esta función con el MISMO tope y lo único
  // que cambia es cuántas partidas caben en el sitio. La aserción es que
  // `topePartidas` RECORTA Y NADA MÁS: no reordena y no mueve una sola foto de
  // partida. Si el reparto cambiara al recortar, la tarjeta enseñaría una foto
  // que el expediente no imprime, que es exactamente el defecto de antes con
  // otro disfraz.
  const expediente = sel({ subs: CAT, evidencia: evid2, tope: 15 });
  const tarjeta    = sel({ subs: CAT, evidencia: evid2, tope: 15, topePartidas: 2 });
  check(idsDe(tarjeta.mostradas) === idsDe(expediente.partidas.slice(0, 2)),
    'las partidas de la tarjeta son las primeras del expediente, en su mismo orden',
    `tarjeta ${idsDe(tarjeta.mostradas)} vs expediente ${idsDe(expediente.partidas.slice(0, 2))}`);
  const repartoDe = (r) => r.partidas
    .map(p => `${p.id}:${p.fotos.map(f => f.id).join('|')}`).join(' ');
  check(repartoDe(tarjeta) === repartoDe(expediente),
    'y el reparto de fotos es idéntico: recortar la pantalla no mueve una foto',
    `tarjeta «${repartoDe(tarjeta)}» vs expediente «${repartoDe(expediente)}»`);

  // Y lo que la tarjeta no pintó tiene que poder nombrarse: `disponibles` es
  // cuántas tiene la partida, `fotos` cuántas se enseñan. Son dos números
  // distintos a propósito, porque la tarjeta cabe dos y el expediente seis.
  const pTar = tarjeta.mostradas[0];
  check(pTar.disponibles === 10 && pTar.fotos.length < pTar.disponibles,
    'la partida declara cuántas fotos tiene, no sólo cuántas se enseñan',
    `disponibles=${pTar.disponibles} enseñadas=${pTar.fotos.length}`);

  return fallos;
}

// ── LAS MUTACIONES ────────────────────────────────────────────────────────
// Cada una rompe la SEMÁNTICA de la decisión, no el andamiaje. Ninguna
// renombra nada ni borra una función: todas dejan el módulo compilando y
// devolviendo una selección de aspecto razonable.
const MUTACIONES = [
  ['el corte vuelve a ser «las que se movieron»: se ordena por el orden del documento',
    'const enCorte = cobertura.porImporte.slice(0, cobertura.hastaTecho);',
    'const enCorte = (subs || []).map((s, i) => ({ id: idDePartida(s, i), s, imp: importeCatalogoPartida(s) })).slice(0, cobertura.hastaTecho);'],
  ['el corte se queda con TODAS las partidas, y el 80% deja de cortar',
    'const enCorte = cobertura.porImporte.slice(0, cobertura.hastaTecho);',
    'const enCorte = cobertura.porImporte.slice();'],
  ['la partida grande sin fotos vuelve a filtrarse, como hacía el PDF',
    'const pintables = partidas.filter(p => p.fotos.length > 0 || p.sinEvidencia);',
    'const pintables = partidas.filter(p => p.fotos.length > 0);'],
  ['«sin evidencia» deja de distinguirse de «no le tocaron fotos»',
    'sinEvidencia: fotos.length === 0,',
    'sinEvidencia: false,'],
  ['el reparto vuelve a ser una foto a cada quien: el peso deja de importar',
    'const ideal = peso > 0 ? (p.imp / peso) * cupo : cupo / vivas.length;',
    'const ideal = 1;'],
  ['el reparto premia la disponibilidad en lugar del peso',
    'const ideal = peso > 0 ? (p.imp / peso) * cupo : cupo / vivas.length;',
    'const ideal = p.disponibles;'],
  ['el reparto se invierte: la que pesa menos se lleva más',
    'if (deficit > mejorDeficit) { mejorDeficit = deficit; mejor = p; }',
    'if (mejorDeficit === -Infinity || deficit < mejorDeficit) { mejorDeficit = deficit; mejor = p; }'],
  ['el sobrante de una partida sin fotos suficientes se pierde en lugar de redistribuirse',
    'if (tiene >= p.disponibles) continue;',
    'if (tiene >= 1) continue;'],
  ['las que no ponderan se cuelan antes del corte y le quitan sitio',
    `  const dadasDentro = repartir(partidas, tope);
  const dadasFuera  = repartir(fuera, tope - dadasDentro);`,
    `  const dadasFuera  = repartir(fuera, tope);
  const dadasDentro = repartir(partidas, tope - dadasFuera);`],
  ['sin cobertura medible las fotos desaparecen junto con el porcentaje',
    `    .filter(x => x.todas.length > 0)`,
    `    .filter(x => x.todas.length > 0 && cobertura.medible)`],
  // Ésta muta `evidenciaVigente`, que es de donde SÍ sale el filtro, no la
  // llamada de más que `seleccionFotografica` tenía encima. Esa llamada
  // sobrevivió a su propia mutación —quitarla no rompía nada— y por eso se
  // quitó del código: una guarda redundante aparenta ser la que protege.
  ['la evidencia anulada vuelve a contar como respaldo',
    'const evidenciaVigente = (lista) => (lista || []).filter(e => !e.anulada);',
    'const evidenciaVigente = (lista) => (lista || []);'],
  ['el recorte de la pantalla se calla: «4 de 12» se lee como que eran 4',
    'recortadas: pintables.length - mostradas.length,',
    'recortadas: 0,'],
  ['el recorte se queda con las primeras del documento y no con las de mayor peso',
    `  const mostradas = Number.isFinite(topePartidas)
    ? pintables.slice(0, topePartidas) : pintables;`,
    `  const mostradas = Number.isFinite(topePartidas)
    ? pintables.slice(-topePartidas) : pintables;`],
  ['salen las fotos más viejas de cada partida en lugar de las más recientes',
    'p.fotos = p.todas.slice(0, n);',
    'p.fotos = p.todas.slice().reverse().slice(0, n);'],
  ['el tope deja de ser un tope y la hoja se llena con todo lo que haya',
    'const dadasDentro = repartir(partidas, tope);',
    'const dadasDentro = repartir(partidas, Infinity);'],
  // §7 · el denominador del «% del contrato»
  ['el peso se diluye con las extraordinarias: 51% del contrato se lee 47%',
    '  const total = cobertura.total;',
    '  const total = (subs || []).reduce((t, s) => t + importeCatalogoPartida(s), 0);'],
  ['el peso se mide contra el corte del 80% y no contra el contrato entero',
    '  const total = cobertura.total;',
    '  const total = cobertura.porImporte.slice(0, cobertura.hastaTecho).reduce((t, x) => t + x.imp, 0);'],
  // §8 · recortar la pantalla no puede mover el reparto
  ['el reparto se hace sobre lo que cabe en la pantalla: la tarjeta enseña fotos que el expediente no imprime',
    'const dadasDentro = repartir(partidas, tope);',
    'const dadasDentro = repartir(Number.isFinite(topePartidas) ? partidas.slice(0, topePartidas) : partidas, tope);'],
];

if (process.argv.includes('--contraprueba')) {
  console.log('CONTRAPRUEBA · cada mutación tiene que salir en ROJO\n');
  let sobrevivieron = 0;
  for (const [titulo, de, a] of MUTACIONES) {
    if (!cuerpo.includes(de)) {
      console.error(`NO ARRANCÓ: la mutación «${titulo}» no halló su anclaje`);
      console.error(`  buscaba: ${de.slice(0, 110)}`);
      process.exit(2);
    }
    let fallos;
    process.env.CALLADO = '1';
    try { fallos = correr(cuerpo.replace(de, a)); }
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

console.log('SE ENSEÑA LO QUE PESA');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
