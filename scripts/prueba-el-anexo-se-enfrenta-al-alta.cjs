#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL ANEXO SE ENFRENTA AL ALTA — PENDIENTES #96
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ ESTE BANCO. La obra 0128 —el colector— se dio de alta copiando la
// 0131 —el emisor— y se quedó con el presupuesto del emisor ($27,489,778.08
// contra $12,890,541.86) y con su plazo (2026-08-29→2027-02-24 contra
// 2026-08-27→2026-12-24). Su propio anexo, cargado en la misma app, traía las
// tres cifras buenas. Nadie los enfrentó nunca: el defecto se encontró el
// 2026-11-04 abriendo los tres anexos a mano para otra cosa, después de meses
// publicando el avance físico de esa obra a la mitad y su desviación contra un
// plazo 60 días más largo.
//
// Lo que se afirma aquí es CONDUCTA: qué renglones aparecen en la pantalla de
// carga del programa ante un anexo y un alta concretos, y qué cifras llevan
// dentro. No se afirma que exista ningún nombre; los nombres se piden sólo para
// PODER EJECUTAR la cuenta de verdad, extraída de `src/App.jsx`.
//
// ── LAS CINCO MANERAS DE ARRUINAR ESTO ─────────────────────────────────────
//
//   1. GRITAR CUANDO NO HAY NADA. Los tres anexos reales de producción cuadran
//      AL CENTAVO con el presupuesto de su obra. Un aviso que sale siempre deja
//      de leerse, y entonces el día que sí importa tampoco se lee. Por eso hay
//      aserciones sobre el SILENCIO, no sólo sobre el grito.
//   2. CALLARSE CUANDO FALTA UN DATO. El DE-5 de la Cangrejera no declara
//      fechas. Eso no es un desacuerdo: es que no hay con qué comparar. Pero su
//      MONTO sí se compara, y que falten las fechas no puede apagar el monto.
//   3. COMPARAR EL ALTA CONSIGO MISMA. `programaConArranque` le presta a un
//      anexo sin fechas el arranque de la obra. Comparar ese arranque prestado
//      contra la obra sale cuadrado SIEMPRE, y la comprobación se vuelve
//      decorativa sin que nadie lo note.
//   4. AVISAR DE UNA DIFERENCIA CORRECTA. Una ampliación mueve el fin vigente y
//      el anexo sigue siendo el del plazo original. Medir contra el fin vigente
//      convertiría toda obra ampliada en un aviso permanente.
//   5. DECIR LA DIFERENCIA AL REVÉS. «El programa pide $14.6M de más» y «al
//      programa le faltan $14.6M» mandan a arreglar cosas distintas. El signo
//      se afirma en los dos sentidos.
//
// LO QUE ESTE BANCO NO ALCANZA. No afirma que el aviso NO BLOQUEE el guardado:
// eso vive en `CargaDelPrograma.confirmar()`, dentro de un componente, y no se
// puede ejecutar aquí. Lo que sí se afirma es que la cuenta devuelve hallazgos
// y nunca un veredicto —no hay `ok`, no hay `bloquear`—, así que no tiene con
// qué impedir nada. Queda dicho para que nadie lea este banco como si cubriera
// el botón.
//
// Uso:  node scripts/prueba-el-anexo-se-enfrenta-al-alta.cjs
//       node scripts/prueba-el-anexo-se-enfrenta-al-alta.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const { fuenteDeApp } = require('./extraer-de-app.cjs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const PEDIDOS = ['cuadreDelAnexo', 'programaConArranque'];

const { cuerpo, faltan } = fuenteDeApp(PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`NO ARRANCÓ: a src/App.jsx le faltan ${faltan.join(', ')}`);
  process.exit(2);
}

const construir = (fuente) =>
  new Function(`"use strict";\n${fuente}\nreturn { ${PEDIDOS.join(', ')} };`)();

// ── El caso real, con las cifras de producción ─────────────────────────────
//
// Las tres cifras del anexo del colector salen de pasarlo por el parser de la
// app (`scripts/medir-programa-real-se-lee.cjs`), no de leerlas a ojo del
// Excel. Las del alta son las que `obras/0128` tenía antes de la corrección del
// 2026-11-04, leídas de producción en solo lectura.
const ANEXO_COLECTOR = {
  ok: true, total: 12890541.86, inicio: '2026-08-27', fin: '2026-12-24', meses: 5,
};
const ALTA_MALA = {
  id: '0128', presupuesto: 27489778.08, inicio: '2026-08-29', fin: '2027-02-24',
};
const ALTA_BUENA = {
  id: '0128', presupuesto: 12890541.86, inicio: '2026-08-27', fin: '2026-12-24',
};

// La Cangrejera: el DE-5 no declara «Inicio obra» ni «Fin obra». Su total sí
// cuadra al centavo con el presupuesto que la obra tiene cargado.
const ANEXO_CANGREJERA = {
  ok: true, total: 75635416.41, inicio: null, fin: null, meses: 7,
};
const ALTA_CANGREJERA = {
  id: '0126', presupuesto: 75635416.41, inicio: '2026-05-07', fin: '2026-11-02',
};

// Una obra ampliada cuyo anexo cuadra con el plazo ORIGINAL. No tiene que
// aparecer ningún renglón de fin: la diferencia contra el fin vigente es
// correcta y avisarla sería ruido permanente.
const ALTA_AMPLIADA = {
  id: '0140', presupuesto: 12890541.86, inicio: '2026-08-27',
  fin: '2026-12-24', finAmpliado: '2027-03-31',
};

function correr(fuente) {
  const fn = construir(fuente);
  const fallos = [];
  const check = (ok, titulo, detalle = '') => {
    if (!ok) fallos.push(titulo);
    if (!process.env.CALLADO) {
      console.log(`   ${ok ? '✓' : '✗'} ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
    }
  };
  const Q = fn.cuadreDelAnexo;
  const de = (hs, campo) => hs.find(h => h.campo === campo) || null;

  // 1 · EL DEFECTO DE LA 0128, TAL COMO ESTABA
  console.log('\n── El colector con las cifras del emisor ──');
  const real = Q(ANEXO_COLECTOR, ALTA_MALA);
  check(real.length === 3,
    'los tres datos que no cuadraban aparecen, no uno ni dos',
    `salieron ${real.length}: ${real.map(h => h.campo).join(', ')}`);

  const mto = de(real, 'monto');
  check(mto !== null, 'hay un renglón de monto');
  check(mto && Math.abs(mto.archivo - 12890541.86) < 0.005 &&
        Math.abs(mto.alta - 27489778.08) < 0.005,
    'y trae las DOS cifras crudas, la del archivo y la del alta',
    mto ? `archivo ${mto.archivo} · alta ${mto.alta}` : '');
  check(mto && /12,890,542/.test(mto.dice) && /27,489,778/.test(mto.dice),
    'y la frase dice las dos, para que nadie tenga que buscar la otra',
    mto?.dice);
  check(mto && /14,599,236/.test(mto.dice),
    'y dice cuánto es la diferencia: $14,599,236',
    mto?.dice);
  // El 53% es del CONTRATO CARGADO, que es la cifra contra la que se está
  // mirando la pantalla. Dividir entre el total del anexo daría 113% — también
  // cierto y otra cosa — y dos denominadores distintos en dos sitios es el
  // defecto de «una cuenta por número» otra vez.
  check(mto && /53\.1%/.test(mto.dice),
    'y el por ciento es sobre el contrato cargado: 53.1%',
    mto?.dice);
  // El signo: con el anexo por DEBAJO del alta, al programa le faltan.
  check(mto && /le faltan/.test(mto.dice),
    'con el anexo por debajo del alta dice que al programa LE FALTAN',
    mto?.dice);

  const ini = de(real, 'inicio');
  check(ini !== null && ini.archivo === '2026-08-27' && ini.alta === '2026-08-29',
    'el arranque enfrenta la fecha del archivo contra la del alta',
    ini ? `${ini.archivo} vs ${ini.alta}` : '');
  check(ini && /2 día/.test(ini.dice),
    'y dice cuántos días son: 2',
    ini?.dice);

  const fin = de(real, 'fin');
  check(fin !== null && fin.archivo === '2026-12-24' && fin.alta === '2027-02-24',
    'el fin enfrenta la fecha del archivo contra la del alta',
    fin ? `${fin.archivo} vs ${fin.alta}` : '');
  check(fin && /62 día/.test(fin.dice),
    'y dice cuántos días son: 62 — los dos meses de plazo que sobraban',
    fin?.dice);

  // 2 · EL SILENCIO, QUE ES LA MITAD DE LA MEDICIÓN
  console.log('\n── Lo que cuadra no dice nada ──');
  check(Q(ANEXO_COLECTOR, ALTA_BUENA).length === 0,
    'el mismo anexo contra el alta ya corregida no levanta ni un renglón',
    JSON.stringify(Q(ANEXO_COLECTOR, ALTA_BUENA).map(h => h.campo)));
  check(Q(ANEXO_CANGREJERA, ALTA_CANGREJERA).length === 0,
    'la Cangrejera tampoco: su monto cuadra al centavo y su archivo no trae fechas',
    JSON.stringify(Q(ANEXO_CANGREJERA, ALTA_CANGREJERA).map(h => h.campo)));
  // Un peso de diferencia es redondeo de hoja de cálculo, no un error de alta.
  const unPeso = Q({ ...ANEXO_COLECTOR, total: 12890542.86 }, ALTA_BUENA);
  check(unPeso.length === 0,
    'un peso de diferencia no levanta nada: es redondeo, no un copiado',
    JSON.stringify(unPeso.map(h => h.campo)));
  const dosPesos = de(Q({ ...ANEXO_COLECTOR, total: 12890543.86 }, ALTA_BUENA), 'monto');
  check(dosPesos !== null,
    'pero dos pesos sí: la tolerancia es un peso, no «lo que se parezca»',
    dosPesos?.dice);
  // Dos pesos sobre trece millones redondean a «0%», y una frase que dice que
  // hay diferencia y que es del 0% se contradice a sí misma.
  check(dosPesos && /menos del 0\.1%/.test(dosPesos.dice) && !/el 0% /.test(dosPesos.dice),
    'y una diferencia diminuta no se imprime como «el 0% del contrato»',
    dosPesos?.dice);

  // 3 · FALTAR UN DATO NO ES UN DESACUERDO
  console.log('\n── Cuando falta un dato ──');
  const cangreMal = Q(ANEXO_CANGREJERA, { ...ALTA_CANGREJERA, presupuesto: 60000000 });
  check(de(cangreMal, 'monto') !== null && cangreMal.length === 1,
    'sin fechas en el archivo, el monto se sigue comparando y sale solo',
    JSON.stringify(cangreMal.map(h => h.campo)));
  // Si el alta no tiene presupuesto no hay dos cifras que enfrentar. Decir
  // «sobran $12.9M» contra un cero sería inventarse una diferencia.
  check(de(Q(ANEXO_COLECTOR, { id: '0199', inicio: '2026-08-27', fin: '2026-12-24' }), 'monto') === null,
    'un alta sin presupuesto no produce una diferencia inventada contra cero');
  check(de(Q(ANEXO_COLECTOR, { ...ALTA_BUENA, presupuesto: 0 }), 'monto') === null,
    'ni un presupuesto en cero, que es el mismo caso escrito distinto');
  check(Q(null, ALTA_MALA).length === 0 && Q(ANEXO_COLECTOR, null).length === 0,
    'sin anexo o sin obra la cuenta se calla en vez de reventar');

  // 4 · EL ARRANQUE PRESTADO NO SE COMPARA CONSIGO MISMO
  console.log('\n── El arranque prestado ──');
  // `programaConArranque` le pone al anexo de la Cangrejera el arranque de la
  // obra. Si la comparación mirara ESE arranque en vez del que el archivo
  // declara, saldría cuadrada siempre y nadie volvería a mirarla.
  const prestado = fn.programaConArranque(
    { ...ANEXO_CANGREJERA, partidas: [{ sec: '1', montos: [1] }] }, ALTA_CANGREJERA);
  check(prestado && prestado.inicio === '2026-05-07' && prestado.inicioHeredado === true,
    'el anexo sin fechas recibe el arranque de la obra, marcado como heredado',
    prestado ? `${prestado.inicio} heredado=${prestado.inicioHeredado}` : 'null');
  check(de(Q(prestado, ALTA_CANGREJERA), 'inicio') === null,
    'y enfrentarlo no inventa un desacuerdo: el prestado ES el del alta');
  // La aserción que de verdad muerde: con una fecha PROPIA distinta, tiene que
  // salir. Es la que distingue «comparo el archivo» de «comparo el alta».
  check(de(Q({ ...ANEXO_CANGREJERA, inicio: '2026-03-01' }, ALTA_CANGREJERA), 'inicio') !== null,
    'pero un arranque propio distinto al del alta sí sale');

  // 5 · UNA AMPLIACIÓN NO ES UN ERROR DE ALTA
  console.log('\n── Obra ampliada ──');
  check(de(Q(ANEXO_COLECTOR, ALTA_AMPLIADA), 'fin') === null,
    'el fin se mide contra el del contrato, no contra el ampliado: una obra ampliada que cuadra no avisa',
    JSON.stringify(Q(ANEXO_COLECTOR, ALTA_AMPLIADA).map(h => h.campo)));
  const ampMal = de(Q({ ...ANEXO_COLECTOR, fin: '2026-11-30' }, ALTA_AMPLIADA), 'fin');
  check(ampMal !== null && /ampliación al 2027-03-31/.test(ampMal.dice),
    'y cuando sí hay desacuerdo, se dice que hay ampliación para que nadie lea el renglón al revés',
    ampMal?.dice);

  // 6 · EL OTRO SIGNO
  console.log('\n── El signo, en el otro sentido ──');
  const sobra = de(Q({ ...ANEXO_COLECTOR, total: 30000000 }, ALTA_BUENA), 'monto');
  check(sobra !== null && /el programa pide/.test(sobra.dice) && !/le faltan/.test(sobra.dice),
    'con el anexo por encima del alta dice que el programa PIDE más',
    sobra?.dice);

  // 7 · HALLAZGOS, NO VEREDICTO
  // Si esto devolviera un `ok` o un `bloquear`, la pantalla tendría con qué
  // impedir el guardado, y el anexo puede ser el equivocado: quién manda lo
  // sabe quien está mirando, no el código.
  check(Array.isArray(real) && real.every(h =>
    typeof h === 'object' && 'campo' in h && 'dice' in h &&
    !('ok' in h) && !('bloquear' in h)),
    'la cuenta devuelve hallazgos con su frase, nunca un veredicto que bloquee');

  return fallos;
}

// ── La contraprueba ────────────────────────────────────────────────────────
//
// Cada mutación es una manera realista de dejar el #96 a medias: no reventar el
// andamiaje, sino volver a callarse —o empezar a gritar de más, que acaba en lo
// mismo porque el aviso deja de leerse—. El banco sigue arrancando y ejecutando,
// y tiene que salir en ROJO.
const MUTACIONES = [
  // El defecto entero: no comparar el dinero.
  ['no compara el monto',
    'if (presupuesto > 0 && total > 0 && Math.abs(total - presupuesto) > 1) {',
    'if (false) {'],
  // La tolerancia como coladero: deja pasar los $14.6M del caso real.
  ['afloja la tolerancia del monto hasta que no muerde',
    'Math.abs(total - presupuesto) > 1)',
    'Math.abs(total - presupuesto) > 1e9)'],
  // La tolerancia al revés: grita en las tres obras que están bien.
  ['quita la tolerancia y avisa del redondeo',
    'Math.abs(total - presupuesto) > 1)',
    'Math.abs(total - presupuesto) >= 0)'],
  // Comparar contra el acumulado que el archivo declara en vez de la suma de
  // los meses: los dos existen y no siempre coinciden (el parser ya avisa de
  // eso), así que elegir el otro es un error plausible.
  ['compara el acumulado declarado en vez de la suma de los meses',
    'const total = Number(prog.total);',
    'const total = Number(prog.totalDeclarado);'],
  // El denominador: 113% en vez de 53%. La cifra sigue saliendo y suena peor,
  // pero no es el por ciento del contrato que la pantalla está mostrando.
  ['saca el por ciento sobre el anexo en vez de sobre el contrato',
    'const pct = Math.abs(dif) / presupuesto * 100;',
    'const pct = Math.abs(dif) / total * 100;'],
  // Una diferencia que existe, impresa como «el 0% del contrato».
  ['imprime una diferencia diminuta como el 0%',
    "(pct < 0.1 ? 'menos del 0.1% del contrato.' : `el ${NUM(pct, 1)}% del contrato.`)",
    '`el ${NUM(pct, 1)}% del contrato.`'],
  // El signo invertido: manda a arreglar lo contrario.
  ['dice la diferencia al revés',
    "${dif > 0 ? 'el programa pide' : 'al programa le faltan'}",
    "${dif > 0 ? 'al programa le faltan' : 'el programa pide'}"],
  ['no compara el arranque',
    'if (prog.inicio && obra.inicio && prog.inicio !== obra.inicio) {',
    'if (false) {'],
  ['no compara el fin',
    'if (prog.fin && obra.fin && prog.fin !== obra.fin) {',
    'if (false) {'],
  // Medir contra el fin vigente: toda obra ampliada se vuelve un aviso fijo.
  ['mide el fin contra el ampliado y no contra el del contrato',
    'if (prog.fin && obra.fin && prog.fin !== obra.fin) {',
    'if (prog.fin && obra.fin && prog.fin !== (obra.finAmpliado || obra.fin)) {'],
  // Callarse sobre la ampliación: el renglón se lee al revés.
  ['no avisa de la ampliación al dar el desacuerdo de fin',
    "        (obra.finAmpliado\n          ? ` Esta obra tiene una ampliación al ${obra.finAmpliado}; el anexo es el del plazo original.`\n          : ''),",
    "        '',"],
  // DOS MUTACIONES QUE SE INTENTARON Y NO SON DEFECTOS. Se dejan escritas
  // porque una mutación descartada enseña dónde NO está el riesgo, y la
  // siguiente persona no vuelve a gastar la tarde:
  //
  //   · «compara el arranque heredado en vez del que declara el archivo».
  //     Sobrevivió, y con razón: el heredado VALE `obra.inicio` exactamente
  //     cuando el archivo no trae fecha, así que las dos versiones se callan en
  //     el mismo caso y se quejan en el mismo caso. El riesgo de comparar el
  //     alta consigo misma no vive en esta cuenta, vive en QUIÉN LA LLAMA: el
  //     día que alguien le pase `programaConArranque(prog, obra)` en lugar del
  //     documento tal cual, la comprobación del arranque muere en silencio para
  //     los DE-5. Ese sitio está dentro de un componente y este banco no lo
  //     alcanza; queda dicho aquí para que se lea al cambiarlo.
  //   · «enfrenta un archivo que el parser rechazó». También sobrevivió, y
  //     también con razón: un `{ok:false}` no trae total ni fechas, así que no
  //     hay nada que comparar ni con guarda ni sin ella. La guarda se quitó de
  //     `src/App.jsx` en vez de inventarle una aserción.
  //     Y se quedó escrita EN LA LISTA VIVA, apuntando a un renglón que ya no
  //     existe: desde entonces la contraprueba salía NO ARRANCÓ (2) sin que
  //     nadie lo viera, porque la suite sólo corre el modo normal. Se borró el
  //     2026-11-07. Una mutación descartada se cuenta aquí, nunca en la lista.
  // Quedarse en el primero: el caso real tiene tres y arreglar uno no arregla
  // los otros dos.
  ['sólo reporta el primer hallazgo',
    '  return hallazgos;',
    '  return hallazgos.slice(0, 1);'],
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

console.log('EL ANEXO SE ENFRENTA AL ALTA · #96');
const fallos = correr(cuerpo);
if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) fallaron.`);
  process.exit(1);
}
console.log('\nverde');
process.exit(0);
