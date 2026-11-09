#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL TABLERO DA UN SOLO VEREDICTO DE PLAZO, Y DICE DE DÓNDE SALE
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ SE AFIRMA. Lo que el bloque «Proyección al término» PUBLICA, no que sus
// símbolos existan:
//
//   1. Un veredicto y nada más. Antes salían dos —«Proyección al fin 74.0%» y
//      un atraso de −8 días— y en producción se contradecían en la misma
//      tarjeta de la misma obra.
//   2. Es el MISMO número que la tarjeta de plazo de la dependencia. Dos
//      pantallas, una cuenta.
//   3. El ritmo dice de cuántas semanas sale, y esa N sale de los cierres, no
//      de la plantilla: tres cierres repartidos en cinco semanas se rotulan
//      cinco, no tres.
//   4. El ritmo en pesos es la TRADUCCIÓN exacta de la velocidad en puntos. Si
//      alguien lo sacara del dinero por su cuenta serían dos velocidades, y
//      «hay que acelerar $X/sem» dejaría de ser la aceleración que produce los
//      días que el mismo bloque publica arriba.
//   5. Lo que no se puede calcular se DICE. Sin cierres suficientes no hay
//      veredicto ni fecha, con el motivo y la cuenta («1 de 2 cortes
//      cerrados»). Con el plazo vencido no hay «ritmo necesario»: no queda
//      plazo dentro del cual acelerar.
//   6. La cuenta vieja no vuelve. Nada divide `presupuesto − estimado` entre
//      el ritmo de EJECUCIÓN, que eran dos velocidades en un cociente.
//
// LA CUENTA DEL MANDATO, EJERCIDA. La sección 1 reconstruye la 0127 con las
// cifras de la captura —contrato $144,596,003, ejecutado $42,749,603, ritmo
// $3,028,771/sem, 110 días de plazo restante— y exige el atraso que sale de
// ellas. No el que yo escriba en un comentario: el que devuelve la función.
//
// NO REIMPLEMENTA. Todo sale de `src/App.jsx` por `fuenteDe` y se EJECUTA,
// incluido el JSX del bloque, que se renderiza con `Card`/`Tit` de mentira
// para poder leer lo que sale escrito.
//
//   node scripts/prueba-un-solo-veredicto-de-plazo.cjs
//   node scripts/prueba-un-solo-veredicto-de-plazo.cjs --contraprueba

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;

const archivo = process.env.ARCHIVO_APP || ARCHIVO;
const src = fs.readFileSync(archivo, 'utf8');

let fallas = 0, verdes = 0;
const ok = (c, m) => { if (c) { verdes++; console.log(`  ok   ${m}`); }
                       else { fallas++; console.log(`FALLA  ${m}`); } };

// ── EL CÓDIGO VIVO ─────────────────────────────────────────────────────────
const PEDIDOS = ['veredictoDePlazo', 'kpiDesviacionPlazo', 'atrasoProyectado',
  'tendenciaDeRitmo', 'plazoDeObra', 'proyeccionDeAvance', 'estadoPorSemana',
  'C', 'MXN', 'VENTANA_RITMO', 'CIERRES_MINIMOS'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true });
if (faltan.length && !process.env.ARCHIVO_APP) {
  console.error(`\nNO ARRANCÓ: faltan en ${path.basename(archivo)}: ${faltan.join(', ')}`);
  process.exit(2);
}
const APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.filter(n => !faltan.includes(n)).join(', ')} };`)();
const { veredictoDePlazo, kpiDesviacionPlazo, atrasoProyectado,
  tendenciaDeRitmo, C, MXN } = APP;

// ── EL BLOQUE DE PANTALLA, SACADO DEL ARCHIVO Y RENDERIZADO ────────────────
// Se busca por lo que el bloque DICE —el título— y no por una variable: el
// día que alguien renombre `v` la prueba tiene que seguir mirando la misma
// tarjeta.
let fuenteBloque = null, fuenteDashboard = null;
{
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id?.name === 'Dashboard') fuenteDashboard = src.slice(p.node.start, p.node.end);
    },
    CallExpression(p) {
      if (fuenteBloque) return;
      if (p.node.callee.type !== 'ArrowFunctionExpression') return;
      if (p.node.arguments.length) return;
      const txt = src.slice(p.node.start, p.node.end);
      if (!txt.includes('<Tit>Proyección al término</Tit>')) return;
      fuenteBloque = txt;
    },
  });
}
if (!fuenteBloque || !fuenteDashboard) {
  console.error('\nNO ARRANCÓ: no se encontró el bloque «Proyección al término» ni/o `Dashboard`.');
  console.error('Si la tarjeta cambió de título, lo que hay que arreglar es el ancla.');
  process.exit(2);
}

// Los componentes de mentira imprimen etiqueta y contenido con separadores,
// para poder afirmar sobre el texto que sale y no sobre el árbol.
const Card = ({ children }) => React.createElement('div', null, children);
const Tit = ({ children }) => React.createElement('div', null, `TIT[${children}] `);
const pintar = (obra, historialAvance, af, ahora) => {
  const js = esbuild.transformSync(`(${fuenteBloque})`, { loader: 'jsx' }).code;
  const el = new Function('React', 'Card', 'Tit', 'C', 'MXN',
    'veredictoDePlazo', 'tendenciaDeRitmo', 'obra', 'historialAvance', 'af', 'Date',
    `return ${js}`)(
    React, Card, Tit, C, MXN,
    (o, h, a) => veredictoDePlazo(o, h, a, ahora), APP.tendenciaDeRitmo,
    obra, historialAvance, af,
    // El bloque no llama a `Date.now()`, pero si algún día lo hiciera, que sea
    // el instante de la prueba y no el del reloj.
    class extends Date { constructor(...a) { super(...(a.length ? a : [ahora])); }
                         static now() { return ahora; } });
  // UNA PANTALLA QUE REVIENTA ES UN ROJO, NO UN «NO ARRANCÓ». Armar el bloque
  // —extraerlo, transformarlo, construir el elemento— es andamiaje: si eso
  // falla, la conducta se quedó sin medir y la excepción tiene que subir. Pero
  // pintarlo ES la conducta. Cuando el render se cae, el usuario no ve un
  // número mal: no ve nada, y eso es justo lo que pasó en el emulador. Así que
  // se devuelve un texto que no contiene nada de lo que la tarjeta debería
  // decir, y las aserciones de arriba caen una por una, que es el veredicto
  // honesto.
  try {
    return renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  } catch (e) {
    return `LA PANTALLA SE CAYO AL PINTARSE: ${e.message}`;
  }
};

// ── FIXTURES ───────────────────────────────────────────────────────────────
const AHORA = Date.parse('2026-11-09T18:00:00Z');
const DIA = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const cierre = (año, semana, avancePonderado, montoEjecutado) =>
  ({ tipo: 'oficial', año, semana, avancePonderado, montoEjecutado,
     fechaCierre: iso(AHORA), capturadoPor: 'residente' });

console.log('\n── 1 · LA CUENTA DEL MANDATO, EJERCIDA ─────────────────────────────\n');

// La 0127 tal como estaba en la captura. El avance y la velocidad se expresan
// en PUNTOS porque es en puntos como se mide; los pesos de los que salen están
// al lado para que la equivalencia sea revisable.
const CONTRATO = 144596003, EJECUTADO = 42749603, RITMO_PESOS = 3028771;
const AV = EJECUTADO / CONTRATO * 100;              // 29.565 %
const VEL = RITMO_PESOS / CONTRATO * 100;           // 2.0946 pp/sem
const obra0127 = { id: '0127', presupuesto: CONTRATO,
  inicio: iso(AHORA - 99 * DIA), fin: iso(AHORA + 110 * DIA) };
// Dos cierres a cuatro semanas: la velocidad es el salto entre ellos.
const hist0127 = [cierre(2026, 41, AV - 4 * VEL), cierre(2026, 45, AV)];

const v0127 = veredictoDePlazo(obra0127, hist0127, AV, AHORA);

ok(Math.abs(v0127.ritmoPP - VEL) < 1e-6,
  `el ritmo medido son ${v0127.ritmoPP?.toFixed(4)} pp/sem (se esperaban ${VEL.toFixed(4)})`);
ok(Math.abs(v0127.ritmoPesos - RITMO_PESOS) < 1,
  `en pesos son ${MXN(v0127.ritmoPesos)}, el ritmo de la captura ($3,028,771)`);
// 70.435 pendientes ÷ 2.0946 = 33.63 semanas, que `proyeccionDeAvance`
// redondea HACIA ARRIBA a 34 porque proyecta en semanas enteras: 238 días
// contra los 110 que quedan de plazo. La cuenta a mano da 235 y 125; la
// diferencia son esos tres días de redondeo, y se afirma el número que la
// función devuelve, no el que me gustaría que devolviera.
ok(v0127.proy.semanasAFin === 34,
  `faltan 34 semanas al ritmo medido (a mano: 101,846,400 ÷ 3,028,771 = 33.63)`);
ok(v0127.dias === 128,
  `el veredicto es +128 días (a mano 125: la proyección sube 33.63 a 34 semanas) — dio ${v0127.dias}`);
ok(v0127.veredicto === '+128 días',
  `sale escrito con signo: «${v0127.veredicto}»`);
ok(v0127.plazoTxt === '99 de 209 días transcurridos',
  `el plazo dice «${v0127.plazoTxt}»`);

// El ritmo necesario y la aceleración, en los pesos del mandato.
const necesarioEsperado = (100 - AV) / (110 / 7) / 100 * CONTRATO;
ok(Math.abs(v0127.necesarioPesos - necesarioEsperado) < 1,
  `el ritmo necesario es ${MXN(v0127.necesarioPesos)} por semana`);
ok(v0127.deltaPesos > 3.4e6 && v0127.deltaPesos < 3.5e6,
  `hay que acelerar ${MXN(v0127.deltaPesos)} por semana (el mandato dice $3.44M)`);

console.log('\n── 2 · UN SOLO VEREDICTO, Y ES EL DE LA DEPENDENCIA ────────────────\n');

const pant = pintar(obra0127, hist0127, AV, AHORA);
ok(/TIT\[Proyección al término\]/.test(pant), 'la tarjeta se titula «Proyección al término»');
ok(/\+128 días/.test(pant), 'el veredicto sale impreso en la tarjeta');
ok(/de atraso, del plazo del contrato/.test(pant), 'dice contra qué plazo se mide');
ok(/Término proyectado/.test(pant), 'y debajo la fecha de término proyectada');

// Las dos cuentas que se fueron. No se afirma que las cadenas no estén: se
// afirma que el tablero no vuelve a dividir el contrato entre el ritmo.
ok(!/Proyección al fin/.test(fuenteDashboard),
  'ya no hay una segunda conclusión «Proyección al fin»');
ok(!/Semanas p\/ facturar todo/.test(fuenteDashboard),
  'ya no hay «Semanas p/ facturar todo»');
ok(!/semsParaEst/.test(fuenteDashboard) && !/faltaEst/.test(fuenteDashboard),
  'nada divide `presupuesto − estimado` entre el ritmo de ejecución');
ok(!/am\s*\/\s*\(plazoTrans/.test(fuenteDashboard),
  'el tablero ya no promedia el ejecutado entre el plazo corrido');

// UNA CUENTA POR NÚMERO: el mismo atraso que publica la dependencia.
const dep = kpiDesviacionPlazo(atrasoProyectado(obra0127, null, hist0127, AV, AHORA));
ok(dep.dias === v0127.dias,
  `la tarjeta de la dependencia dice los mismos ${dep.dias} días`);

console.log('\n── 3 · LA N SALE DE LOS CIERRES, NO DE LA PLANTILLA ────────────────\n');

// Tres cierres repartidos en CINCO semanas de calendario: S40, S43 y S45.
const obraN = { id: 'N', presupuesto: 1e8,
  inicio: iso(AHORA - 100 * DIA), fin: iso(AHORA + 100 * DIA) };
const histN = [cierre(2026, 40, 10), cierre(2026, 43, 16), cierre(2026, 45, 20)];
const vN = veredictoDePlazo(obraN, histN, 20, AHORA);

ok(vN.proy.semanasBase === 3, 'la ventana son 3 cierres');
ok(vN.proy.tramos === 5, 'repartidos en 5 semanas de calendario');
ok(/últimas 5 semanas/.test(vN.ritmoSub),
  `el rótulo dice las semanas, no los cierres: «${vN.ritmoSub}»`);
ok(!/últimas 3 semanas/.test(vN.ritmoSub),
  'y no confunde «3 cierres» con «3 semanas»');
ok(/3 cierres cerrados/.test(vN.ritmoSub), 'y dice también cuántos cierres son');
ok(Math.abs(vN.ritmoPP - 2) < 1e-9,
  `el ritmo divide entre 5 tramos, no entre 2: ${vN.ritmoPP} pp/sem`);
// Si dividiera entre los puntos menos uno saldría 5 pp/sem y la obra
// terminaría dos veces y media antes de lo que va a terminar.
ok(/últimas 5 semanas/.test(pintar(obraN, histN, 20, AHORA)),
  'y esa N sale impresa en la tarjeta');

console.log('\n── 4 · EL PESO ES LA TRADUCCIÓN DEL PUNTO, NO OTRA MEDICIÓN ────────\n');

// Los mismos dos cierres traen el dinero. Medido contra producción el
// 2026-11-09 las dos unidades coinciden al decimal en las cinco obras que
// proyectan; aquí se exige esa identidad, que es lo que permite publicar el
// ritmo en pesos sin abrir una segunda cuenta.
const obraP = { id: 'P', presupuesto: 2e8,
  inicio: iso(AHORA - 100 * DIA), fin: iso(AHORA + 100 * DIA) };
const histP = [cierre(2026, 41, 10, 0.10 * 2e8), cierre(2026, 45, 18, 0.18 * 2e8)];
const vP = veredictoDePlazo(obraP, histP, 18, AHORA);
const dineroDeLaVentana = (0.18 - 0.10) * 2e8 / 4;   // $4,000,000 por semana

ok(Math.abs(vP.ritmoPesos - dineroDeLaVentana) < 1,
  `${MXN(vP.ritmoPesos)}/sem por los puntos y ${MXN(dineroDeLaVentana)}/sem por el dinero de esos mismos cierres`);
ok(Math.abs(vP.ritmoPesos - vP.ritmoPP / 100 * 2e8) < 1e-6,
  'el peso es exactamente `velocidad ÷ 100 × contrato`');
// Sin contrato no hay traducción, y entonces no se inventa un cero.
const vSinContrato = veredictoDePlazo({ ...obraP, presupuesto: 0 }, histP, 18, AHORA);
ok(vSinContrato.ritmoPesos === null,
  'sin contrato el ritmo en pesos es `null`, no $0 — un cero diría que la obra está parada');

console.log('\n── 5 · LO QUE NO SE PUEDE CALCULAR, SE DICE ────────────────────────\n');

// (a) Un solo cierre: no hay ritmo, no hay veredicto, no hay fecha.
const obraPoca = { id: 'Q', presupuesto: 1e8,
  inicio: iso(AHORA - 60 * DIA), fin: iso(AHORA + 60 * DIA) };
const vPoca = veredictoDePlazo(obraPoca, [cierre(2026, 45, 12)], 12, AHORA);
ok(vPoca.veredicto === '—', 'con un cierre el veredicto es «—», no un cero');
ok(/1 de 2 cortes cerrados/.test(vPoca.porque),
  `dice cuántos tiene y cuántos necesita: «${vPoca.porque}»`);
ok(vPoca.fechaFin === null, 'y no publica fecha de término');
const pantPoca = pintar(obraPoca, [cierre(2026, 45, 12)], 12, AHORA);
ok(/1 de 2 cortes cerrados/.test(pantPoca), 'el motivo sale impreso en la tarjeta');
ok(!/Término proyectado/.test(pantPoca), 'y la tarjeta no inventa una fecha');
ok(/no se puede calcular el ritmo/.test(pantPoca),
  'el renglón del ritmo dice que no se puede, en vez de quedarse en blanco');

// (b) Plazo vencido: hay veredicto, pero no hay «ritmo necesario».
const obraVencida = { id: 'R', presupuesto: 1e8,
  inicio: iso(AHORA - 200 * DIA), fin: iso(AHORA - 38 * DIA) };
const histV = [cierre(2026, 41, 80), cierre(2026, 45, 88)];
const vVenc = veredictoDePlazo(obraVencida, histV, 88, AHORA);
ok(vVenc.dias != null, 'con el plazo vencido sigue habiendo veredicto de atraso');
ok(vVenc.vencidoDias === 38, `y dice que venció hace ${vVenc.vencidoDias} días`);
ok(vVenc.necesarioPesos === null, 'pero NO hay ritmo necesario: no queda plazo en el que acelerar');
ok(/no queda plazo en el que acelerar/.test(vVenc.sinNecesario),
  `y lo dice con el motivo: «${vVenc.sinNecesario}»`);
ok(/no queda plazo en el que acelerar/.test(pintar(obraVencida, histV, 88, AHORA)),
  'y eso sale impreso, en vez de un «$0/sem» que se leería como «ya no hay que correr»');

// (c) La obra terminada no pide acelerar.
const vFin = veredictoDePlazo(obraN, histN, 100, AHORA);
ok(/ya está al 100%/.test(vFin.sinNecesario || ''),
  'al 100% el ritmo necesario se declara, no se divide entre lo que falta');

console.log('\n── 6 · LA BASE SE DECLARA ──────────────────────────────────────────\n');

ok(/es una recta, no una promesa/.test(pant),
  'la tarjeta declara que extrapola, en vez de presentar la fecha como un hecho');

// Y CUANDO EL RITMO SÍ CAMBIÓ, SE DICE CON LOS DOS NÚMEROS.
//
// Esta obra existe por un defecto que las cinco secciones de arriba no vieron:
// la tarjeta pintaba `{t}` en vez de `{t.frase}`, y `tendenciaDeRitmo` devuelve
// un objeto. En todos los escenarios anteriores la tendencia sale `null`
// —ritmo estable o cierres insuficientes— así que la rama no se ejecutaba
// nunca y el banco salía entero en verde. En el emulador, la primera obra que
// se había frenado tumbó la pantalla con «Objects are not valid as a React
// child». No es que el número saliera mal: es que no salía nada, ni el
// veredicto ni el plazo ni el ritmo, porque el árbol entero se cae.
//
// LA ARITMÉTICA DEL ESCENARIO, para que no se quede mudo sin avisar. La
// ventana corta son los ÚLTIMOS 4 cierres y el expediente son los 6, y las
// dos cuentas dividen entre SEMANAS DE CALENDARIO, no entre cierres:
//
//   corto  s37→s43: (26 − 20) ÷ 6 semanas = 1.00 pp/sem
//   largo  s33→s43: (26 −  0) ÷ 10 semanas = 2.60 pp/sem
//   razón 0.38, por debajo de UMBRAL_TENDENCIA = 0.67 → la tendencia habla.
//
// El primer intento de este escenario repartía el frenazo entre cierres
// seguidos y la razón salió 0.83: el umbral la calló y la prueba se habría
// quedado comprobando nada. Por eso la primera aserción es que el escenario
// DISPARA, y por eso `tFren` se consulta con `?.` más abajo: un escenario
// mudo tiene que salir ROJO, no reventar.
const obraFren = { id: 'FREN', presupuesto: 1e8,
  inicio: iso(AHORA - 120 * DIA), fin: iso(AHORA + 200 * DIA) };
const histFren = [
  cierre(2026, 33, 0), cierre(2026, 35, 10), cierre(2026, 37, 20),
  cierre(2026, 39, 22), cierre(2026, 41, 24), cierre(2026, 43, 26),
];
const vFren = veredictoDePlazo(obraFren, histFren, 26, AHORA);
const tFren = tendenciaDeRitmo(vFren.proy);
ok(!!tFren?.frase && /se fren[oó]|aceler[oó]/i.test(tFren.frase),
  `el escenario sí dispara la tendencia: «${tFren?.frase ?? 'null'}»`);

const pantFren = pintar(obraFren, histFren, 26, AHORA);
ok(!/\[object Object\]/.test(pantFren),
  'la tarjeta no publica un objeto donde iba una frase');
ok(!!tFren?.frase && pantFren.includes(tFren.frase),
  'pinta la frase de la cuenta, completa');
ok(/es una recta, no una promesa/.test(pantFren) && /días|—/.test(pantFren),
  'y la tarjeta sigue en pie: el veredicto y el supuesto siguen saliendo');

// Lo que la cuenta vieja habría dicho de la 0127, para que quede medido por
// qué se fue: el ritmo del plazo corrido entero contra el de los cierres.
const ritmoViejo = EJECUTADO / (99 / 7);
console.log(`\n  el ritmo viejo (ejecutado ÷ plazo corrido) habría sido ${MXN(ritmoViejo)}/sem`);
console.log(`  el de los últimos cierres es ${MXN(v0127.ritmoPesos)}/sem`);
console.log(`  y la cuenta que se va dividía ${MXN(CONTRATO)} entre el primero\n`);

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  const MUTANTES = [
    { nombre: 'el ritmo vuelve a dividirse entre los PUNTOS en vez de los tramos',
      hacer: () => src.replace(
        'const tramos = Math.max(Math.round((lunB - lunA) / (7 * 86400000)), 1);',
        'const tramos = Math.max(base.length - 1, 1);') },
    { nombre: 'el bloque vuelve a calcular su propio ritmo sobre el plazo corrido',
      hacer: () => src.replace(
        '  const ritmoPP = proy.velocidad;',
        '  const ritmoPP = pendientePP > 0 ? (Number(avanceActual) || 0) / Math.max(pz.transcurridos / 7, 1) : null;') },
    { nombre: 'el ritmo necesario se calcula aunque el plazo ya haya vencido',
      hacer: () => src.replace(
        "  else if (vencido) sinNecesario = `el plazo venció hace ${pz.vencidoDias} días: no queda plazo en el que acelerar`;",
        '  else if (vencido) necesarioPP = pendientePP;') },
    { nombre: 'sin cierres suficientes la tarjeta publica un cero en vez de «—»',
      hacer: () => src.replace(
        "    veredicto: kpi.dias == null ? '—'",
        "    veredicto: kpi.dias == null ? '0 días'") },
    // EL DEFECTO QUE SE VIO EN EL EMULADOR, NO EN EL BANCO. La tarjeta
    // entregaba a React el objeto entero de `tendenciaDeRitmo` en vez de su
    // frase, y eso no imprime mal: tira la pantalla completa. Vuelve a poner
    // `{t}` para comprobar que las aserciones nuevas lo atrapan.
    { nombre: 'la tarjeta vuelve a pintar el objeto de la tendencia en vez de su frase',
      hacer: () => src.replace(
        '{t?.frase?<span style={{color:C.yellow}}>{t.frase} </span>:null}',
        '{t?<span style={{color:C.yellow}}>{t} </span>:null}') },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veredicto-'));
  let rojas = 0;
  for (const m of MUTANTES) {
    const mutado = m.hacer();
    if (mutado === src) {
      console.log(`\nNO ARRANCÓ: la mutación «${m.nombre}» no cambió nada.`);
      process.exit(2);
    }
    const f = path.join(dir, `app-${rojas}.jsx`);
    fs.writeFileSync(f, mutado);
    const r = spawnSync(process.execPath, [__filename],
      { env: { ...process.env, ARCHIVO_APP: f }, encoding: 'utf8' });
    const caidas = (r.stdout.match(/^FALLA/gm) || []).length;
    console.log(`\n  «${m.nombre}»`);
    console.log(`     ${caidas} aserción(es) en rojo` + (r.status === 2 ? '  ← NO ARRANCÓ' : ''));
    if (r.status === 2) {
      console.log(r.stdout.split('\n').filter(l => /NO ARRANCÓ/.test(l)).join('\n'));
      process.exit(2);
    }
    if (caidas === 0) {
      console.log('     la contraprueba NO puso nada en rojo: la aserción no afirma lo que dice');
      process.exit(1);
    }
    rojas++;
  }
  console.log(`\n${rojas} mutación(es), todas en rojo.\n`);
  process.exit(0);
}

console.log(`\n${verdes} comprobación(es) en verde · ${fallas} en rojo\n`);
process.exit(fallas ? 1 : 0);
