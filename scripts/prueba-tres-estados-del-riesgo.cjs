#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// UNA LISTA DE RIESGOS VACÍA NO SIGNIFICA QUE NO HAY RIESGO
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que el motor de riesgos RESPONDE, no que sus símbolos
// existan. El motor devolvía un solo arreglo, y fuera de ese arreglo caían
// cuatro cosas que nadie podía separar:
//
//   1. la regla midió y encontró algo            → salía en la lista
//   2. la regla midió y no encontró nada         → no salía
//   3. la regla NO PUDO medir por falta de dato  → no salía, igual que la 2
//   4. el detector REVENTÓ y el `catch` se lo comió → no salía, igual que la 2
//
// El caso 3 es producción, no teoría: las obras 0128 y 0131 tienen el gasto de
// GP sin medir, así que su margen sale del 100%, su brecha sale negativa, y
// `fin_001` y `fin_002` se callan las dos. El tablero de esas obras afirma hoy
// que no hay riesgo de margen cuando lo que pasa es que nadie midió el gasto.
//
// El caso 4 es el peor porque es un defecto nuestro disfrazado de tranquilidad
// del cliente, y aquí se ejerce con los dos detectores que de verdad truenan
// —`ctr_001` y `ctr_002` con un contexto sin obra— sin hacerlos a prueba de
// nulos: que revienten y que SE DIGA es justo lo que se está comprobando.
//
// LAS SEIS AFIRMACIONES:
//
//   A. Los cuatro estados son exhaustivos: las 31 reglas salen siempre, cada
//      una en uno y sólo un cubo. Ninguna se pierde por el camino.
//   B. Un detector que revienta se declara en `reventaron`, y `reventaron` NO
//      se mezcla con `noEvaluables`: no es que falte un dato del cliente, es
//      que nuestro código falló.
//   C. El hueco NOMBRA el dato que falta y por qué falta, que es lo único que
//      lo vuelve accionable.
//   D. Cuando el dato sí está, la regla se evalúa de verdad: un cero MEDIDO de
//      gasto manda la regla a «sin hallazgo», que es la respuesta correcta, y
//      un margen bajo la manda a «detectados» con la cifra que la disparó.
//   E. Las cuatro reglas que detectan la AUSENCIA de un dato no pueden
//      exigirlo: exigírselo las volvería no evaluables justo en el único caso
//      en que tienen algo que decir.
//   F. La lista de los que disparan es SIEMPRE un recorte de un veredicto más
//      grande, nunca la respuesta entera. (Se dio vuelta en el #127: antes
//      exigía que el atajo `detectarRiesgos` no cambiara; ahora el atajo no
//      existe porque el tablero dejó de conformarse con un cuarto.)
//
// NO REIMPLEMENTA. El motor entero sale de `src/App.jsx` por `fuenteDe` —cierre
// transitivo, no una lista tecleada— y se EJECUTA.
//
//   node scripts/prueba-tres-estados-del-riesgo.cjs
//   node scripts/prueba-tres-estados-del-riesgo.cjs --contraprueba

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

// ── EL MOTOR VIVO ──────────────────────────────────────────────────────────
const PEDIDOS = ['evaluarRiesgos', 'BIBLIOTECA_RIESGOS',
  'RIESGOS_SOLO_CONSTRUCTORA', 'DATOS_DEL_RIESGO', 'MOTIVO_SIN_GASTO'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${path.basename(archivo)}: ${faltan.join(', ')}`);
  process.exit(2);
}
const APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)();
const { evaluarRiesgos, BIBLIOTECA_RIESGOS,
        RIESGOS_SOLO_CONSTRUCTORA, DATOS_DEL_RIESGO, MOTIVO_SIN_GASTO } = APP;

const TOTAL = BIBLIOTECA_RIESGOS.length;
const ids = (arr) => arr.map(x => x.id);
const buscar = (r, id) =>
  (['detectados', 'sinHallazgo', 'noEvaluables', 'reventaron']
    .find(k => ids(r[k]).includes(id))) || 'EN NINGUNO';
const faltante = (r, id, dato) =>
  (r.noEvaluables.find(x => x.id === id)?.faltan || []).find(f => f.dato === dato) || null;

// ── FIXTURES ───────────────────────────────────────────────────────────────
// La obra de referencia: contrato con plazo y presupuesto, ejecutado real,
// catálogo y cierres. Lo único que varía entre escenarios es el gasto de GP,
// porque el gasto es el dato cuya ausencia pasa hoy por tranquilidad.
const obra = { id: '0128', nombre: 'Colector', presupuesto: 12890541.86,
               inicio: '2026-03-01', fin: '2027-02-28', diasPago: 30,
               gpId: '0128', pctAnticipo: 30 };
const kpisBuenos = { me: 6000000, gt: 0, mpct: 100, brecha: -40, pctGasto: 0, af: 40 };
const kpisFlacos = { me: 6000000, gt: 5820000, mpct: 3.0, brecha: 5.2, pctGasto: 45.2, af: 40 };

// GP contestó por esta obra y no trajo ni un cheque: CERO ES EL DATO.
const gpMedidoEnCero = { obras: { a: { id: '0128' } }, obrasPedidas: ['0128'],
                         ultimaSemana: { año: 2026, semana: 45 },
                         semanasDisponibles: [{ año: 2026, semana: 44 }, { año: 2026, semana: 45 }] };
// GP contestó con dinero.
const gpConDinero = { obras: { a: { id: '0128', grandTotal: 5820000 } }, obrasPedidas: ['0128'],
                      ultimaSemana: { año: 2026, semana: 45 },
                      semanasDisponibles: [{ año: 2026, semana: 44 }, { año: 2026, semana: 45 }] };

const base = { obra, subs: [{ id: 'p1', importe: 12890541.86 }],
               historialAvance: [{ tipo: 'oficial', año: 2026, semana: 45, avance: 40, avancePonderado: 40 }],
               estimaciones: [], programa: null };

const sinGP      = { ...base, kpis: kpisBuenos };                              // ningún documento de GP
const medidoCero = { ...base, kpis: kpisBuenos, gpData: gpMedidoEnCero };      // cero medido
const conDinero  = { ...base, kpis: kpisFlacos, gpData: gpConDinero };         // margen flaco medido

console.log('\n── A · LOS CUATRO ESTADOS SON EXHAUSTIVOS ──────────────────────────\n');

for (const [nombre, ctx] of [['contexto vacío', {}], ['sin GP', sinGP],
                             ['cero medido', medidoCero], ['con dinero', conDinero]]) {
  const r = evaluarRiesgos(ctx);
  const todos = [...ids(r.detectados), ...ids(r.sinHallazgo),
                 ...ids(r.noEvaluables), ...ids(r.reventaron)];
  ok(todos.length === TOTAL,
    `«${nombre}»: las ${TOTAL} reglas salen (${r.detectados.length} disparó · ${r.sinHallazgo.length} sin hallazgo · ${r.noEvaluables.length} no evaluable · ${r.reventaron.length} reventó)`);
  ok(new Set(todos).size === todos.length,
    `«${nombre}»: ninguna regla sale en dos cubos a la vez`);
}

// EN DEPENDENCIA SE EVALÚA MENOS, Y LO QUE NO SE EVALÚA NO APARECE EN NINGÚN
// CUBO. Un «no evaluable» de margen en la pantalla de un municipio sería peor
// que el hueco: nombraría la economía del contratista para decir que no la ve.
const dep = evaluarRiesgos({ ...conDinero, tipo: 'dependencia' });
const todosDep = [...ids(dep.detectados), ...ids(dep.sinHallazgo),
                  ...ids(dep.noEvaluables), ...ids(dep.reventaron)];
ok(todosDep.length === TOTAL - RIESGOS_SOLO_CONSTRUCTORA.size,
  `en dependencia salen ${TOTAL - RIESGOS_SOLO_CONSTRUCTORA.size} de ${TOTAL} reglas — salieron ${todosDep.length}`);
ok(!todosDep.some(id => RIESGOS_SOLO_CONSTRUCTORA.has(id)),
  'y ninguna de las 18 de la constructora se asoma, ni como hueco declarado');

console.log('\n── B · UN DETECTOR QUE REVIENTA SE DECLARA ─────────────────────────\n');

// Los dos que truenan de verdad con un contexto sin obra. No se les puso una
// guarda a propósito: lo que se comprueba es que el motor lo DIGA.
const vacio = evaluarRiesgos({});
for (const id of ['ctr_001', 'ctr_002']) {
  ok(buscar(vacio, id) === 'reventaron',
    `${id} con un contexto sin obra sale en «reventaron» — salió en «${buscar(vacio, id)}»`);
}
const rCtr = vacio.reventaron.find(x => x.id === 'ctr_001');
ok(/diasPago/.test(rCtr?.error || ''),
  `y dice qué reventó: «${rCtr?.error}»`);
ok(vacio.reventaron.every(x => !ids(vacio.sinHallazgo).includes(x.id)),
  'lo que reventó NO se cuenta además como «evaluada sin hallazgo»');
ok(vacio.reventaron.every(x => !ids(vacio.noEvaluables).includes(x.id)),
  'ni se mezcla con «no evaluable»: un defecto nuestro no es un hueco del cliente');

// Y SI REVIENTA EL PROPIO CHEQUEO DEL DATO, TAMBIÉN. `estadoGastoGP` recorre
// los renglones del volcado de GP; un renglón nulo lo tumba. Eso no es «falta
// un dato»: es la misma clase de defecto, y va al mismo cubo.
const gpRoto = evaluarRiesgos({ ...base, kpis: kpisBuenos, gpData: { obras: { a: null } } });
ok(buscar(gpRoto, 'fin_001') === 'reventaron',
  `con el volcado de GP corrupto, fin_001 sale en «reventaron» — salió en «${buscar(gpRoto, 'fin_001')}»`);
ok(/al comprobar los datos/.test(gpRoto.reventaron.find(x => x.id === 'fin_001')?.error || ''),
  'y el motivo distingue que falló el chequeo del dato, no el detector');

console.log('\n── C · EL HUECO NOMBRA EL DATO QUE FALTA, Y POR QUÉ ────────────────\n');

// EL CASO DE PRODUCCIÓN. Esta obra tiene ejecutado, tiene KPIs, y su margen
// sale del 100% porque el gasto vale cero por no haberse medido.
const rSin = evaluarRiesgos(sinGP);
ok(kpisBuenos.mpct === 100 && kpisBuenos.gt === 0,
  'el escenario es el de producción: margen del 100% porque el gasto vale cero sin medirse');
ok(buscar(rSin, 'fin_001') === 'noEvaluables',
  `fin_001 (margen bruto) sale en «noEvaluables» — salió en «${buscar(rSin, 'fin_001')}»`);
ok(buscar(rSin, 'fin_002') === 'noEvaluables',
  `fin_002 (brecha gasto vs avance) también — salió en «${buscar(rSin, 'fin_002')}»`);

const f = faltante(rSin, 'fin_001', 'gastoMedido');
ok(!!f, 'y nombra el dato que falta: `gastoMedido`');
ok(f?.nombre === 'el gasto de esta obra medido en GP',
  `con el nombre que se puede leer en pantalla: «${f?.nombre}»`);
ok(f?.porQue === 'no hay corrida del gasto de GP todavía',
  `y el motivo concreto: «${f?.porQue}»`);

// LOS CUATRO MOTIVOS SON DISTINTOS. «No hay corrida» y «la corrida no incluye
// esta obra» se arreglan en sitios distintos, así que no pueden decir lo mismo.
const MOTIVOS = [
  ['sin-documento',     undefined,
   { ...base, kpis: kpisBuenos }],
  ['no-pedida',         'la corrida del gasto todavía no incluye esta obra',
   { ...base, kpis: kpisBuenos, gpData: { obras: { z: { id: '9999' } }, obrasPedidas: ['9999'] } }],
  ['no-se-puede-saber', 'la corrida no dice qué obras se le pidieron',
   { ...base, kpis: kpisBuenos, gpData: { obras: { z: { id: '9999' } } } }],
];
for (const [motivo, esperado, ctx] of MOTIVOS) {
  const g = faltante(evaluarRiesgos(ctx), 'fin_001', 'gastoMedido');
  const txt = esperado || MOTIVO_SIN_GASTO[motivo];
  ok(g?.porQue === txt, `«${motivo}» se dice así: «${g?.porQue}»`);
}
ok(new Set(Object.values(MOTIVO_SIN_GASTO)).size === Object.keys(MOTIVO_SIN_GASTO).length,
  'los cuatro motivos están redactados distinto: se arreglan en sitios distintos');

// UN REQUISITO MAL ESCRITO NO SE NOTA: el motor descarta la clave desconocida
// en silencio y evalúa la regla sin su dato, que es exactamente el hueco que
// esta rama cierra. Así que se exige que las dos listas cuadren.
const exigidos = new Set(BIBLIOTECA_RIESGOS.flatMap(p => p.requiere || []));
const huerfanos = [...exigidos].filter(k => !DATOS_DEL_RIESGO[k]);
ok(huerfanos.length === 0,
  'ningún requisito nombra un dato que no existe (un nombre mal escrito se descarta callado): '
  + (huerfanos.join(', ') || 'ninguno'));
ok(BIBLIOTECA_RIESGOS.every(p => Array.isArray(p.requiere)),
  `las ${TOTAL} reglas declaran de qué dato dependen, aunque sea de ninguno`);

console.log('\n── D · CON EL DATO PRESENTE, LA REGLA SE EVALÚA DE VERDAD ──────────\n');

// (a) CERO MEDIDO ES UNA MEDICIÓN. GP contestó por esta obra y no tiene
//     cheques: el margen del 100% es real, y «sin hallazgo» es la respuesta
//     correcta. Esto es lo que separa el hueco del dato: el mismo cero.
const rCero = evaluarRiesgos(medidoCero);
ok(buscar(rCero, 'fin_001') === 'sinHallazgo',
  `con el cero MEDIDO, fin_001 pasa a «sinHallazgo» — salió en «${buscar(rCero, 'fin_001')}»`);
ok(buscar(rCero, 'fin_002') === 'sinHallazgo',
  `y fin_002 igual — salió en «${buscar(rCero, 'fin_002')}»`);

// (a2) EL MISMO CERO, DOS SIGNIFICADOS, Y LO QUE LOS SEPARA ES SI SE PREGUNTÓ.
//      Las dos corridas de abajo traen el volcado IGUAL de vacío para esta
//      obra. En una, el cron le preguntó a GP por la 0128 y GP no trajo ni un
//      cheque: el cero es la medición. En la otra, el cron nunca la pidió: no
//      hay cero, hay un hueco. Si el motor no distingue estas dos, la obra
//      recién dada de alta publica «margen del 100%, sin riesgo».
const pedidaSinCheques = { ...base, kpis: kpisBuenos,
  gpData: { obras: { z: { id: '9999' } }, obrasPedidas: ['0128'],
            ultimaSemana: { año: 2026, semana: 45 },
            semanasDisponibles: [{ año: 2026, semana: 45 }] } };
const noPedida = { ...base, kpis: kpisBuenos,
  gpData: { obras: { z: { id: '9999' } }, obrasPedidas: ['9999'],
            ultimaSemana: { año: 2026, semana: 45 },
            semanasDisponibles: [{ año: 2026, semana: 45 }] } };
const rPedida = evaluarRiesgos(pedidaSinCheques);
const rNoPedida = evaluarRiesgos(noPedida);
ok(buscar(rPedida, 'fin_001') === 'sinHallazgo',
  `GP contestó sin cheques: el cero es el dato y fin_001 se evalúa — salió en «${buscar(rPedida, 'fin_001')}»`);
ok(buscar(rNoPedida, 'fin_001') === 'noEvaluables',
  `al cron no se le pidió esta obra: no hay cero, hay hueco — salió en «${buscar(rNoPedida, 'fin_001')}»`);

// (b) CON DINERO Y MARGEN FLACO, DISPARA, Y CON LA CIFRA.
const rDin = evaluarRiesgos(conDinero);
const d1 = rDin.detectados.find(x => x.id === 'fin_001');
ok(!!d1, `con margen del ${kpisFlacos.mpct}% fin_001 dispara — salió en «${buscar(rDin, 'fin_001')}»`);
ok(/3\.0%/.test(d1?.valor || ''),
  `y dice con qué número se disparó: «${d1?.valor}», no sólo «riesgo de margen»`);
ok(d1?.severidad === 'alto', `con la severidad que le toca: ${d1?.severidad}`);

console.log('\n── E · LAS QUE DETECTAN LA AUSENCIA NO EXIGEN EL DATO ──────────────\n');

// Exigirle el dato a la regla que dispara por su ausencia la volvería no
// evaluable justo en el único caso en que tiene algo que decir.
for (const id of ['cmp_001', 'cmp_002']) {
  ok(buscar(vacio, id) === 'detectados',
    `${id} dispara con el contexto vacío, que es su trabajo — salió en «${buscar(vacio, id)}»`);
}
ok(['ctr_001', 'ctr_002', 'cmp_001', 'cmp_002']
    .every(id => (BIBLIOTECA_RIESGOS.find(p => p.id === id)?.requiere || []).length === 0),
  'y las cuatro declaran que no dependen de ningún dato');

console.log('\n── F · LOS QUE DISPARAN NUNCA SON TODA LA RESPUESTA ────────────────\n');

// ESTA SECCIÓN SE DIO VUELTA EN EL #127, por el mismo motivo que la hizo
// nacer. Cuando se escribió existía `detectarRiesgos` —un atajo que devolvía
// sólo `detectados`— y aquí se exigía que siguiera dando lo de siempre, porque
// en ESE lote las pantallas no cambiaban. En el #127 cambiaron: las dos piden
// el veredicto completo, y el atajo se fue por no quedarle quien lo llamara.
//
// Exigir hoy que el atajo exista sería exigir que el tablero pueda volver a
// quedarse con un cuarto de la respuesta. Lo que se exige es lo que no puede
// dejar de ser cierto: que la lista de los que disparan sea SIEMPRE un recorte
// de un veredicto más grande, para que nadie la publique como si fuera el todo.
for (const [nombre, ctx] of [['contexto vacío', {}], ['sin GP', sinGP],
                             ['cero medido', medidoCero], ['con dinero', conDinero],
                             ['dependencia', { ...conDinero, tipo: 'dependencia' }]]) {
  const v = evaluarRiesgos(ctx);
  const callados = v.sinHallazgo.length + v.noEvaluables.length + v.reventaron.length;
  const aplican = TOTAL - (ctx.tipo === 'dependencia' ? RIESGOS_SOLO_CONSTRUCTORA.size : 0);
  ok(v.detectados.length + callados === aplican && callados > 0,
    `«${nombre}»: disparan ${v.detectados.length} de ${aplican}; las otras ${callados} ` +
    'se callan, y el veredicto dice por qué cada una');
}
// El orden por severidad descendente, que es lo que el banner del tablero lee.
const sev = ids(evaluarRiesgos(conDinero).detectados);
ok(sev.length > 1, `con dinero disparan ${sev.length} reglas: [${sev.join(', ')}]`);
const pesos = evaluarRiesgos(conDinero).detectados
  .map(x => ({ bajo: 1, medio: 2, alto: 3, critico: 4 })[x.severidad] || 0);
ok(pesos.every((p, i) => i === 0 || pesos[i - 1] >= p),
  `y salen de más grave a menos grave: [${pesos.join(' ')}]`);

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  const MUTANTES = [
    // EL DEFECTO QUE ESTA RAMA CIERRA. El `catch` del detector se come la
    // excepción y la cuenta como «evaluada sin hallazgo»: un defecto nuestro
    // publicado como tranquilidad del cliente.
    { nombre: 'vuelve el `catch` silencioso: lo que revienta se cuenta como «sin hallazgo»',
      hacer: () => src.replace(
        "    catch (e) { reventaron.push({ ...ficha, error: e?.message || String(e) }); continue; }",
        '    catch (e) { sinHallazgo.push(ficha); continue; }') },
    { nombre: 'lo que revienta se mezcla con los huecos por falta de dato',
      hacer: () => src.replace(
        '  return { detectados, sinHallazgo, noEvaluables, reventaron };',
        '  return { detectados, sinHallazgo, noEvaluables: [...noEvaluables, ...reventaron], reventaron: [] };') },
    { nombre: 'el chequeo del dato, cuando revienta, se cuenta como «sin hallazgo»',
      hacer: () => src.replace(
        '      reventaron.push({ ...ficha, error: `al comprobar los datos: ${e?.message || e}` });',
        '      sinHallazgo.push(ficha);') },
    // El margen vuelve a callarse: sin declarar que depende del gasto, la
    // regla se evalúa con un gasto de cero y publica «no hay riesgo».
    { nombre: 'el margen deja de declarar que depende del gasto medido',
      hacer: () => src.replace(
        "    requiere: ['kpis', 'gastoMedido', 'ejecutado'],",
        "    requiere: ['kpis', 'ejecutado'],") },
    { nombre: 'el requisito del gasto se afloja a «hay documento de GP»',
      hacer: () => src.replace(
        '                  hay: c => estadoGastoGP(c.obra, c.gpData).medido,',
        '                  hay: c => !!c.gpData,') },
    { nombre: 'el hueco deja de decir por qué falta el dato',
      hacer: () => src.replace(
        '        .map(({ k, d }) => ({ dato: k, nombre: d.nombre, porQue: d.porQue ? d.porQue(ctx) : null }));',
        '        .map(({ k, d }) => ({ dato: k, nombre: d.nombre, porQue: null }));') },
    { nombre: 'el hueco deja de nombrar el dato',
      hacer: () => src.replace(
        '    if (faltan.length) { noEvaluables.push({ ...ficha, faltan }); continue; }',
        '    if (faltan.length) { noEvaluables.push({ ...ficha }); continue; }') },
    { nombre: 'una regla no evaluable se pierde en vez de declararse',
      hacer: () => src.replace(
        '    if (faltan.length) { noEvaluables.push({ ...ficha, faltan }); continue; }',
        '    if (faltan.length) continue;') },
    { nombre: 'la economía del contratista se asoma en la pantalla del municipio',
      hacer: () => src.replace(
        '    if (soloContrato && RIESGOS_SOLO_CONSTRUCTORA.has(plantilla.id)) continue;',
        '    if (false && soloContrato) continue;') },
    { nombre: 'el cero medido de GP se vuelve a leer como hueco',
      hacer: () => src.replace(
        "      return medido(0, 'sin-cheques');",
        "      return sinDato('no-pedida');") },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tres-estados-'));
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
