#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// «ESTA SEMANA +2.03pp» SOBRE UN CIERRE DE HACE TRES SEMANAS (PENDIENTES #15)
// ════════════════════════════════════════════════════════════════════════════
//
// El pendiente lo dice en una línea: «distinguir "la obra avanzó" de "el
// residente se puso al corriente"». Son dos lecturas de la misma cifra, y la
// pantalla las escribía idénticas. Hay DOS mentiras independientes metidas en
// el mismo recuadro:
//
//   (A) EL DELTA ABARCA MÁS DE UNA SEMANA. Dos cierres seguidos EN LA LISTA
//       pueden estar a cuatro semanas en el CALENDARIO. Restar uno del otro y
//       publicar el resultado bajo el rótulo «Esta semana» multiplica el ritmo
//       por cuatro a los ojos de quien lo lee.
//
//   (B) EL CIERRE NO ES DE ESTA SEMANA. Si el último corte es de hace tres
//       semanas, «esta semana» no es ninguna semana. Y eso es exactamente el
//       rezago del residente, que es lo que corre la fecha de término sin que
//       nada en pantalla diga por qué.
//
// NO ES HIPOTÉTICO. Medido en producción el 2026-11-16 con el Admin SDK: la
// obra 0112 (el malecón) tiene su último cierre oficial en la S44 y el
// anterior en la S40 —cuatro semanas de calendario—, y la S44 se cerró el 30
// de octubre, tres semanas antes de hoy. Las dos mentiras a la vez, en la obra
// más grande del expediente. Los datos de aquí abajo son ESOS: las semanas,
// los avances y las fechas salieron de la medición, no de la imaginación.
//
// Y HAY UNA TERCERA, más vieja: «al ritmo de los últimos 4 cierres».
// `semanasBase` son CIERRES —el comentario de `proyeccionDeAvance` ya avisaba
// que el nombre engaña— y cuatro cierres pueden estar repartidos en diez
// semanas. El lector que divide el avance entre cuatro semanas se equivoca por
// un factor de dos y medio. El tramo ya estaba calculado y expuesto en
// `proy.tramos` desde el 2026-11-07, y NINGUNA pantalla lo decía.
//
// QUÉ SE AFIRMA AQUÍ. El TEXTO QUE SALE A PANTALLA, no que exista un nombre.
// Los tres recuadros se LOCALIZAN en `src/App.jsx` por lo que alimentan, se
// EXTRAEN con el AST, se compilan con esbuild y se RENDERIZAN con React; lo
// que se compara es la cadena que un residente leería. Si alguien vuelve a
// teclear `label="Esta semana"` a mano, el anclaje no encuentra el recuadro y
// esto sale NO ARRANCÓ 2 — que en este repo es rojo, no «casi».
//
// Uso:  node scripts/prueba-la-obra-avanzo-o-el-residente-se-puso-al-corriente.cjs
//       node scripts/prueba-la-obra-avanzo-o-el-residente-se-puso-al-corriente.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
const esbuild = require(path.join(raiz, 'node_modules/esbuild'));
const React = require(path.join(raiz, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(raiz, 'node_modules/react-dom/server'));

const noArranco = require('./no-arranco.cjs');
const { fuenteDe } = require('./extraer-de-app.cjs');
noArranco.vigilarExcepciones();

const archivo = process.argv.find(a => a.endsWith('.jsx')) || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'] });

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── Lo que se pide por nombre, sólo para poder ejecutarlo ──────────────────
// Las dependencias las resuelve `fuenteDe` siguiendo el grafo del archivo; esta
// lista es lo que el banco LLAMA o MUTA, nada más.
const NECESARIOS = [
  'C', 'NUM', 'snapshotId', 'semanaISO', 'ESQUEMA_AVANCE',
  'estadoPorSemana', 'semanasEntreClaves', 'lecturaDelUltimoCierre',
  'rotuloDelDelta', 'subDelDelta', 'frasePorCierres',
  'proyeccionDeAvance', 'atrasoProyectado', 'etiquetaSemanaRiel',
  'fraseCortesCerrados', 'frasePorQueSinDesviacion',
  'SIN_DELTA_NO_COMPARABLES',
];

const { cuerpo, presentes, faltan: faltanSimbolos } =
  fuenteDe(archivo, NECESARIOS, { tolerante: true });

// El rango de TODA declaración de módulo, no sólo de las pedidas: la
// contraprueba muta por nombre, y atar el rango a `NECESARIOS` haría que
// adelgazar esa lista apagara una mutación en silencio.
const rango = {};
// Los tres recuadros, localizados POR LO QUE PINTAN. No por su rótulo: el
// rótulo del primero es justamente lo que dejó de ser un literal, y anclarlo
// a `label="Esta semana"` sería anclar la prueba al defecto.
let kpiDelta = null;        // el del delta del último cierre
let kpiVelocidad = null;    // «Velocidad prom.»
let kpiProyeccion = null;   // «Proyección fin»
// Y la leyenda de «Partidas con mayor avance», que compara los MISMOS dos
// cierres que el recuadro del delta y decía «esta semana vs anterior». Se
// localiza por lo que pinta —el único elemento que no es `Kpi` y llama a
// `subDelDelta`— y no por la leyenda vieja, que es el defecto.
let leyendaPartidas = null;

traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    const n = d?.id?.name;
    if (n && d.init && rango[n] === undefined) rango[n] = [d.init.start, d.init.end];
  },
  JSXElement(p) {
    const abre = p.node.openingElement;
    const txt = src.slice(p.node.start, p.node.end);
    if (abre.name?.name !== 'Kpi') {
      // El `<div>` de la leyenda, no los que lo CONTIENEN: la rejilla de
      // tarjetas también es un `div` y también «contiene» la llamada, pero
      // arrastra el `.map` de las partidas. Se guarda el más corto, que es el
      // más interno, y así da igual cuántos envoltorios se le pongan encima.
      if (abre.name?.name === 'div' && /subDelDelta\s*\(/.test(txt) && !/<Kpi/.test(txt)
          && (!leyendaPartidas || txt.length < leyendaPartidas.length)) {
        leyendaPartidas = txt;
      }
      return;
    }
    if (!kpiDelta && /subDelDelta\s*\(/.test(txt)) { kpiDelta = txt; return; }
    if (!kpiVelocidad && /frasePorCierres\s*\(/.test(txt) && /pp\/sem/.test(txt)) {
      kpiVelocidad = txt; return;
    }
    if (!kpiProyeccion && /frasePorCierres\s*\(/.test(txt) && /al ritmo de/.test(txt)) {
      kpiProyeccion = txt;
    }
  },
});

const faltan = [...faltanSimbolos];
// Estos tres no se piden por nombre sino por lo que dicen. Si no aparecen, no
// es un renombre: es que el recuadro volvió a afirmar por su cuenta, y la
// conducta se quedó sin mirar.
if (!kpiDelta) faltan.push('el recuadro del delta del último cierre (ninguno llama a `subDelDelta`)');
if (!kpiVelocidad) faltan.push('el recuadro «Velocidad prom.» diciendo su ventana');
if (!kpiProyeccion) faltan.push('el recuadro «Proyección fin» diciendo su ventana');
if (!leyendaPartidas) faltan.push('la leyenda de «Partidas con mayor avance» nombrando sus dos semanas');
if (faltan.length) noArranco(faltan, path.basename(archivo));

// ── Contraprueba ──────────────────────────────────────────────────────────
// CINCO MUTACIONES, UNA POR AFIRMACIÓN. Todas CONSERVAN EL ANDAMIAJE —el
// símbolo sigue existiendo, con la misma forma de retorno, y los tres recuadros
// lo siguen llamando, así que los anclajes de arriba siguen encontrándolos— y
// ROMPEN LA SEMÁNTICA. Una mutación que borra el símbolo mide que el símbolo se
// puede borrar; una que tumba el anclaje sale 2 y mide el portón, no la cifra.
const MUTACIONES = [
  // 1. EL RÓTULO VUELVE A SER UN LITERAL. Es el defecto tal como estaba: un
  //    cierre de hace tres semanas rotulado «Esta semana». La forma se
  //    conserva —sigue siendo una función de `lect` que devuelve una cadena—.
  ['el rótulo vuelve a decir «Esta semana» siempre', 'rotuloDelDelta',
    `((lect) => 'Esta semana')`],

  // 2. EL DELTA DEJA DE DECIR CUÁNTAS SEMANAS ABARCA. Vuelve al renglón de
  //    antes: sólo contra qué semana se restó. El rezago también desaparece.
  ['el renglón del delta vuelve a decir sólo «vs S40»', 'subDelDelta',
    `((lect, etiquetaPrevia) => \`vs \${etiquetaPrevia}\`)`],

  // 3. LAS SEMANAS SE RESTAN POR NÚMERO DE SEMANA Y NO POR CALENDARIO. Es el
  //    atajo que parece inofensivo: funciona todo el año y se equivoca una
  //    semana entera al cruzar un año ISO de 53 —2026 es uno—.
  ['las semanas se restan por número, no por lunes', 'semanasEntreClaves',
    `((claveA, claveB) => {
      const a = /^S(\\d{2})-(\\d{4})$/.exec(String(claveA || ''));
      const b = /^S(\\d{2})-(\\d{4})$/.exec(String(claveB || ''));
      if (!a || !b) return null;
      return (Number(b[2]) - Number(a[2])) * 52 + (Number(b[1]) - Number(a[1]));
    })`],

  // 4. EL REZAGO SE PIERDE. La lectura sigue trayendo el tramo del delta, pero
  //    deja de contar cuántas semanas lleva la obra sin cerrar: la mitad (B)
  //    del pendiente, que es la que mueve la proyección.
  ['la lectura deja de contar las semanas sin cerrar', 'lecturaDelUltimoCierre',
    `((estados = [], claveHoy = null) => {
      const ult = estados.length ? estados[estados.length - 1] : null;
      if (!ult) {
        return { delta: null, semanasDelDelta: null, semanasSinCerrar: null,
          esDeLaSemanaEnCurso: false, clave: null };
      }
      return {
        delta: ult.delta,
        semanasDelDelta: ult.delta !== null && ult.deltaDe
          ? semanasEntreClaves(ult.deltaDe, ult.clave) : null,
        semanasSinCerrar: null,
        esDeLaSemanaEnCurso: true,
        clave: ult.clave,
      };
    })`],

  // 5. LA VENTANA DEL RITMO VUELVE A CONTARSE EN CIERRES. El renglón vuelve a
  //    decir «los últimos 4 cierres» sin el tramo, que es la tercera mentira:
  //    cuatro cierres en diez semanas leídos como cuatro semanas.
  ['la ventana del ritmo vuelve a decir sólo los cierres', 'frasePorCierres',
    `((proy) => \`los últimos \${Number(proy?.semanasBase) || 0} cierres\`)`],
];

if (process.argv.includes('--contraprueba')) {
  const tmp = require('os').tmpdir();
  let todas = 0; const mudas = [];
  for (const [titulo, simbolo, reemplazo] of MUTACIONES) {
    if (!rango[simbolo]) {
      console.error(`\nNO ARRANCÓ: la mutación «${titulo}» no halló el rango de ` +
        `\`${simbolo}\` en ${path.basename(archivo)}. El símbolo cambió de nombre o ` +
        `de forma: hay que reanclar la mutación, no dar esto por verde.\n`);
      process.exit(2);
    }
    const [ini, fin] = rango[simbolo];
    const mutado = path.join(tmp, `contraprueba-al-corriente-${simbolo}.jsx`);
    // El reemplazo entra como FUNCIÓN: en el segundo argumento de `replace`,
    // `$'` y `$&` se expanden y el código mutado sale corrupto.
    fs.writeFileSync(mutado, src.slice(0, ini) + reemplazo + src.slice(fin));
    const r = require('child_process').spawnSync(process.execPath, [__filename, mutado],
      { encoding: 'utf8' });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    console.log(`\n── ${titulo} — \`${simbolo}\``);
    if (r.status === 2 || /NO ARRANCÓ/.test(r.stdout + r.stderr)) {
      console.log((r.stdout + r.stderr).replace(/^/gm, '  │ '));
      console.error(`\nNO ARRANCÓ: «${titulo}» revienta el banco en vez de ponerlo ` +
        `rojo. Eso mide que el archivo se puede parsear, no que la aserción muerda.\n`);
      process.exit(2);
    }
    console.log((r.stdout.match(/^FALLA.*$/gm) || ['  (ninguna)']).join('\n').replace(/^/gm, '  │ '));
    console.log(`  → ${rojas} en rojo`);
    todas += rojas;
    if (rojas === 0) mudas.push(titulo);
  }
  console.log('');
  if (mudas.length) {
    console.log(`CONTRAPRUEBA EN ROJO: ${mudas.length} mutación(es) no tumbaron nada:`);
    for (const m of mudas) console.log(`  · ${m}`);
    process.exit(1);
  }
  console.log(`Contraprueba correcta: ${MUTACIONES.length} mutaciones, ` +
    `${todas} comprobación(es) en rojo, ninguna muda.`);
  process.exit(0);
}

const app = new Function(`"use strict";\n${cuerpo}\n;return {${presentes.join(',')}};`)();
const { C, NUM, snapshotId, ESQUEMA_AVANCE, estadoPorSemana, semanasEntreClaves,
  lecturaDelUltimoCierre, rotuloDelDelta, subDelDelta, frasePorCierres,
  proyeccionDeAvance, etiquetaSemanaRiel, fraseCortesCerrados,
  frasePorQueSinDesviacion, SIN_DELTA_NO_COMPARABLES } = app;

console.log(`\nArchivo: ${path.relative(raiz, archivo)}\n`);

// ── LOS DATOS SON LOS DE PRODUCCIÓN ───────────────────────────────────────
// Obra 0112, «SIOP COATZA MALECON 0526», medida el 2026-11-16: cuatro cierres
// oficiales con estos avances y estas fechas de cierre. Las semanas que faltan
// —S35 a S38, S41 a S43, S45 a S47— faltan en producción también.
const CIERRES_0112 = [
  { semana: 34, año: 2026, avancePonderado: 71.780, fechaCierre: '2026-08-22' },
  { semana: 39, año: 2026, avancePonderado: 96.071, fechaCierre: '2026-09-21' },
  { semana: 40, año: 2026, avancePonderado: 97.422, fechaCierre: '2026-10-02' },
  { semana: 44, año: 2026, avancePonderado: 99.455, fechaCierre: '2026-10-30' },
];
const cierre = (s) => ({ ...s, tipo: 'oficial', esquema: ESQUEMA_AVANCE,
  id: snapshotId(s.semana, s.año), subs: [], montoEjecutado: 0, contratoRef: 1e7 });

const estados0112 = estadoPorSemana(CIERRES_0112.map(cierre));
// La semana en curso el día de la medición. No se pregunta al reloj: una
// prueba cuya cifra depende de cuándo se corre caduca sin avisar.
const HOY = 'S47-2026';

// ══════════════════════════════════════════════════════════════════════════
console.log('1. Cuatro semanas de obra no son «esta semana»\n');
// ══════════════════════════════════════════════════════════════════════════

const lect = lecturaDelUltimoCierre(estados0112, HOY);

check(Math.abs(lect.delta - 2.033) < 0.001,
  'el delta del último cierre de la 0112 son 2.03 pp', `${NUM(lect.delta, 3)} pp`);

check(lect.semanasDelDelta === 4,
  'y abarca CUATRO semanas de calendario, porque el cierre anterior es la S40',
  `${lect.semanasDelDelta}`);

check(lect.semanasSinCerrar === 3,
  'la obra lleva tres semanas sin cerrar: la S44 es lo último que hay y hoy es la S47',
  `${lect.semanasSinCerrar}`);

check(lect.esDeLaSemanaEnCurso === false,
  'así que el último cierre NO es de la semana en curso',
  String(lect.esDeLaSemanaEnCurso));

// LA AFIRMACIÓN CENTRAL: el rótulo no puede decir «esta semana».
check(!/esta semana/i.test(rotuloDelDelta(lect)),
  'el rótulo no llama «esta semana» a un cierre de hace tres semanas',
  `«${rotuloDelDelta(lect)}»`);

// Y el caso contrario tiene que ser DISTINGUIBLE, o el arreglo sería rotular
// todo igual: una obra al día sí dice «esta semana».
const alDia = lecturaDelUltimoCierre(
  estadoPorSemana([
    { semana: 46, año: 2026, avancePonderado: 30.0 },
    { semana: 47, año: 2026, avancePonderado: 31.2 },
  ].map(cierre)), HOY);
check(/esta semana/i.test(rotuloDelDelta(alDia)),
  'una obra que cerró la semana en curso sí dice «Esta semana»',
  `«${rotuloDelDelta(alDia)}»`);
check(rotuloDelDelta(lect) !== rotuloDelDelta(alDia),
  'y los dos casos no se rotulan igual',
  `«${rotuloDelDelta(lect)}» ≠ «${rotuloDelDelta(alDia)}»`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n2. El renglón de abajo dice las dos cosas, y por separado\n');
// ══════════════════════════════════════════════════════════════════════════

const sub0112 = subDelDelta(lect, 'S40 de 2026');
console.log(`       « ${sub0112} »`);

check(/4 semanas/.test(sub0112),
  'dice que el delta abarca cuatro semanas', `«${sub0112}»`);
check(/no una/.test(sub0112),
  'y desmiente la lectura semanal, que es lo que el ojo hace con un número así');
check(/3 semanas sin cerrar/.test(sub0112),
  'y dice aparte el rezago: tres semanas sin cerrar');
check(/S40/.test(sub0112),
  'sin perder contra qué semana se restó');

// Una obra al día y contigua no lleva ninguna de las dos advertencias: un
// renglón que siempre avisa es un renglón que nadie lee.
const subAlDia = subDelDelta(alDia, 'S46 de 2026');
console.log(`       « ${subAlDia} »`);
check(!/no una/.test(subAlDia) && !/sin cerrar/.test(subAlDia),
  'una obra al día y sin huecos no lleva advertencia ninguna', `«${subAlDia}»`);

// Una semana de rezago se dice en singular y con palabras, no «1 semanas».
const unaSemanaAtras = lecturaDelUltimoCierre(
  estadoPorSemana([
    { semana: 45, año: 2026, avancePonderado: 30.0 },
    { semana: 46, año: 2026, avancePonderado: 31.2 },
  ].map(cierre)), HOY);
const subUna = subDelDelta(unaSemanaAtras, 'S45 de 2026');
console.log(`       « ${subUna} »`);
check(!/1 semanas/.test(subUna),
  'una sola semana de rezago no se escribe «1 semanas»', `«${subUna}»`);
check(/semana en curso/.test(subUna),
  'se dice que falta la semana en curso, que es lo que el residente tiene que hacer');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n3. Las semanas se cuentan por calendario, no por número\n');
// ══════════════════════════════════════════════════════════════════════════

check(semanasEntreClaves('S40-2026', 'S44-2026') === 4,
  'de la S40 a la S44 hay cuatro semanas');

// 2026 es un año ISO de 53 semanas. Restar números de semana se equivoca una
// entera al cruzarlo, y la cuenta la usan el delta y el rezago.
check(semanasEntreClaves('S52-2026', 'S01-2027') === 2,
  'de la S52 de 2026 a la S1 de 2027 hay DOS semanas: 2026 tiene 53',
  String(semanasEntreClaves('S52-2026', 'S01-2027')));

check(semanasEntreClaves('S40-2026', 'no es una clave') === null,
  'una clave ilegible se dice null, no se inventa un tramo');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n4. «Los últimos 4 cierres» dice en cuántas semanas caben\n');
// ══════════════════════════════════════════════════════════════════════════

const AHORA = new Date('2026-11-16T12:00:00').getTime();
const obra0112 = { fin: '2026-12-31', zona: 'America/Mexico_City' };
const proy = proyeccionDeAvance(estados0112, 99.455, obra0112, AHORA);

const frase = frasePorCierres(proy);
console.log(`       « al ritmo de ${frase} »`);

check(proy.semanasBase === 4, 'la ventana son los cuatro cierres que hay',
  String(proy.semanasBase));
check(proy.tramos === 10,
  'repartidos en DIEZ semanas de calendario: de la S34 a la S44',
  String(proy.tramos));
check(/4 cierres/.test(frase) && /10 semanas/.test(frase),
  'y el renglón dice las dos cosas, no sólo los cierres', `«${frase}»`);

// Sin el tramo, el lector divide el avance entre cuatro semanas en vez de diez:
// se equivoca por dos y medio, y hacia el lado cómodo.
check(frase !== `los últimos ${proy.semanasBase} cierres`,
  'el renglón no se queda en los cierres a secas', `«${frase}»`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n5. Lo que sale pintado\n');
// ══════════════════════════════════════════════════════════════════════════

const Kpi = ({ label, value, sub }) =>
  React.createElement('div', null, `${label} = ${value} (${sub}) `);
const pintar = (jsx, vars) => {
  const js = esbuild.transformSync(`(${jsx})`, { loader: 'jsx' }).code;
  const nombres = Object.keys(vars);
  const el = new Function('React', 'Kpi', ...nombres,
    `"use strict"; return ${js};`)(React, Kpi, ...nombres.map(n => vars[n]));
  return renderToStaticMarkup(el).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};

// El mismo escenario de la 0112, con los nombres que los recuadros usan.
const escenario = {
  C, NUM, subDelDelta, rotuloDelDelta, frasePorCierres, etiquetaSemanaRiel,
  fraseCortesCerrados, frasePorQueSinDesviacion, SIN_DELTA_NO_COMPARABLES,
  lectCierre: lect,
  deltaSemana: lect.delta,
  ultimoEstado: estados0112[estados0112.length - 1],
  penultimoEstado: estados0112[estados0112.length - 2],
  estados: estados0112,
  conAño: false,
  proy,
  velocidadProm: proy.velocidad,
  fechaProyFin: proy.fechaFin,
};

const textoDelta = pintar(kpiDelta, escenario);
console.log(`       « ${textoDelta} »`);
check(!/Esta semana/.test(textoDelta),
  'el recuadro pintado no rotula «Esta semana» el cierre de la S44',
  `«${textoDelta}»`);
check(/2\.03pp/.test(textoDelta), 'pinta la cifra de verdad, 2.03pp', `«${textoDelta}»`);
check(/4 semanas/.test(textoDelta) && /3 semanas sin cerrar/.test(textoDelta),
  'y pinta el tramo y el rezago, los dos');

const textoVel = pintar(kpiVelocidad, escenario);
console.log(`       « ${textoVel} »`);
check(/10 semanas/.test(textoVel),
  'el recuadro de la velocidad dice en cuántas semanas caben sus cierres',
  `«${textoVel}»`);

const textoProy = pintar(kpiProyeccion, escenario);
console.log(`       « ${textoProy} »`);
check(/10 semanas/.test(textoProy),
  'y el de la proyección también: es la misma ventana y se dice igual',
  `«${textoProy}»`);

// UNA CUENTA POR NÚMERO. Los dos recuadros de la misma fila hablan de la misma
// ventana; si uno dijera 4 semanas y el otro 10, el lector no sabría cuál creer.
const ventanaEn = (t) => (t.match(/\((\d+) semanas?\)/) || [])[1] || null;
check(ventanaEn(textoVel) !== null && ventanaEn(textoVel) === ventanaEn(textoProy),
  'los dos recuadros de la fila publican la MISMA ventana',
  `${ventanaEn(textoVel)} vs ${ventanaEn(textoProy)}`);

// La tarjeta de partidas compara esos mismos dos cierres. Si el recuadro dice
// «vs S40 · 3 semanas sin cerrar» y la tarjeta de al lado dice «esta semana»,
// una de las dos miente y el lector no tiene cómo saber cuál.
const textoLeyenda = pintar(leyendaPartidas, escenario);
console.log(`       « ${textoLeyenda} »`);
check(!/esta semana/i.test(textoLeyenda),
  'la leyenda de las partidas no llama «esta semana» a un cierre de la S44',
  `«${textoLeyenda}»`);
check(/S44/.test(textoLeyenda) && /S40/.test(textoLeyenda),
  'nombra las DOS semanas que de verdad compara', `«${textoLeyenda}»`);
check(/3 semanas sin cerrar/.test(textoLeyenda),
  'y arrastra el mismo rezago que el recuadro, por venir de la misma cuenta',
  `«${textoLeyenda}»`);

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO — ${fallas} falla(s)`} · ` +
  'el recuadro distingue que la obra avanzó de que el residente se puso al corriente\n');
process.exit(fallas > 0 ? 1 : 0);
