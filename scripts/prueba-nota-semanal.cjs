#!/usr/bin/env node
// La nota de la semana: lo que el cierre no sabía contar.
//
// POR QUÉ ESTA PRUEBA. El cierre semanal guardaba números —avance, dinero,
// quién cerró— y nada que explicara POR QUÉ. Un +0.4pp puede ser una semana
// floja o una semana con el frente inundado, y el expediente no distinguía las
// dos. Meses después, la respuesta vive en la memoria de quien estuvo ahí, o no
// vive.
//
// LA DISTINCIÓN QUE SE MIDE, y es la razón de ser de todo lo demás: hay TRES
// estados, no dos.
//
//   · alguien escribió qué pasó
//   · alguien DECLARÓ que no pasó nada  ("sin novedad")
//   · nadie dijo nada
//
// Los dos últimos se parecen y no son lo mismo. Si se guardaran igual —texto
// vacío—, quedarían confundidos para siempre, y la pantalla tendría que elegir
// entre llamar "sin novedad" a un silencio (inventar una constancia, P2) o
// llamar hueco a una declaración (borrar el trabajo de quien la hizo).
//
// Lo que se afirma es CONDUCTA: qué frase sale por pantalla en cada caso y qué
// se escribe en Firestore. No se afirma que exista ningún nombre (P3). El
// código se extrae por AST de src/App.jsx y se EJECUTA.
//
// Uso:  node scripts/prueba-nota-semanal.cjs [App.jsx]
//
// Contraprueba contra la versión anterior, donde tiene que ponerse ROJA:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-nota-semanal.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const TZ_PRUEBA = 'America/Mexico_City';
if (process.env.TZ !== TZ_PRUEBA) {
  const r = require('child_process').spawnSync(process.execPath,
    [__filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, TZ: TZ_PRUEBA } });
  process.exit(r.status === null ? 2 : r.status);
}

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ARCH_APP = process.argv[2]
  ? path.resolve(process.argv[2]) : path.join(raiz, 'src/App.jsx');

const OPTS = {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

const RAIZ_NOMBRES = [
  'ESQUEMA_AVANCE', 'ESQUEMA_DINERO', 'ESQUEMA_SNAPSHOT',
  'sonComparables', 'montoEjecutadoSnap', 'montoEstimadoSnap', 'montoPagadoSnap',
  'semanaISO', 'snapshotId',
  'estadoPorSemana', 'SIN_DELTA_PRIMER_CIERRE', 'SIN_DELTA_NO_COMPARABLES',
  'NOTA_SIN_NOVEDAD', 'NOTA_ESCRITA', 'NOTA_FALTA', 'LIMITE_NOTA_SEMANAL',
  'notaDeCierre', 'fraseNota', 'esLaSemanaCorriente',
];

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = parse(src, OPTS);
const trozos = [];
const vistos = new Set();
traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    if (d?.id?.type === 'Identifier' && RAIZ_NOMBRES.includes(d.id.name)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(d.id.name);
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && RAIZ_NOMBRES.includes(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
  },
});

const app = new Function(`${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const {
  notaDeCierre, fraseNota, esLaSemanaCorriente, estadoPorSemana, snapshotId,
  semanaISO, NOTA_SIN_NOVEDAD, NOTA_ESCRITA, NOTA_FALTA, LIMITE_NOTA_SEMANAL,
} = app;

console.log(`\nArchivo:   ${path.relative(raiz, ARCH_APP)}`);
console.log(`Extraídos: ${[...vistos].length} de módulo\n`);

const hayCuenta = typeof notaDeCierre === 'function' && typeof fraseNota === 'function';
if (!hayCuenta) {
  const m = 'el cierre semanal no sabe contar qué pasó: nada guarda la nota de la semana';
  fallos.push(m);
  console.log(`0. La cuenta de la nota semanal\n   ✗ ${m}\n`);
}

const cierre = (semana, año, quien = 'residente@fosmon.com.mx') => ({
  id: snapshotId ? snapshotId(semana, año) : `S${semana}-${año}`,
  semana, año, tipo: 'oficial', esquema: 3,
  avancePonderado: 40 + semana * 0.5, montoEjecutado: 1000000,
  fechaCierre: `${año}-09-25`, capturadoPor: quien,
});

if (hayCuenta) {
  const estados = estadoPorSemana([cierre(38, 2026), cierre(39, 2026, 'super@cotea.com.mx')]);
  const s38 = estados[0], s39 = estados[1];

  // ── 1. Los tres estados son tres, y se cuentan distinto ────────────────
  // El corazón de la prueba. Si estas tres frases coincidieran en dos, el
  // expediente habría perdido una distinción que no se puede recuperar.
  console.log('1. Escribir, declarar que no hubo nada, y no decir nada son tres cosas distintas');
  const escrita = notaDeCierre({ 'S38-2026': {
    texto: 'Tres días sin acceso al frente 2 por la lluvia del martes.',
    sinNovedad: false, autor: 'residente@fosmon.com.mx',
    escritaEn: '2026-09-25T18:00:00.000Z', editadaEn: '2026-09-25T18:00:00.000Z' } }, s38);
  const declarada = notaDeCierre({ 'S38-2026': {
    texto: '', sinNovedad: true, autor: 'residente@fosmon.com.mx',
    escritaEn: '2026-09-25T18:00:00.000Z', editadaEn: '2026-09-25T18:00:00.000Z' } }, s38);
  const muda = notaDeCierre({}, s38);

  const fE = fraseNota(escrita), fD = fraseNota(declarada), fM = fraseNota(muda);
  check(new Set([escrita.estado, declarada.estado, muda.estado]).size === 3,
    'los tres casos quedan en tres estados distintos por dentro');
  check(new Set([fE, fD, fM]).size === 3,
    'y en tres frases distintas en pantalla');
  check(/lluvia del martes/.test(fE || ''),
    `la nota escrita se enseña tal cual (dijo: "${fE}")`);
  check(/sin novedad/i.test(fD || '') && /declaró/i.test(fD || ''),
    `"sin novedad" dice que ALGUIEN lo declaró (dijo: "${fD}")`);
  check(!/sin novedad/i.test(fM || ''),
    `el silencio NO se cuenta como "sin novedad" (dijo: "${fM}")`);

  // ── 2. El hueco dice quién cerró ───────────────────────────────────────
  // Sin nombre no se le puede preguntar a nadie, y una semana sin explicación
  // de la que además no se sabe quién la cerró no es un hueco: es un callejón.
  console.log('\n2. Una semana sin nota dice quién la cerró');
  check(/super@cotea\.com\.mx/.test(fraseNota(notaDeCierre({}, s39)) || ''),
    'la frase del hueco nombra a quien cerró esa semana');
  const sinAutor = estadoPorSemana([{ ...cierre(40, 2026), capturadoPor: null }]);
  const fSinAutor = fraseNota(notaDeCierre({}, sinAutor[0]));
  check(!/null|undefined/.test(fSinAutor || ''),
    `cuando el cierre no registró autor, no se imprime un hueco técnico (dijo: "${fSinAutor}")`);
  check(/no registró quién/.test(fSinAutor || ''),
    'se dice que el cierre no registró quién, en vez de callarlo');

  // ── 3. Un texto en blanco no es una declaración ────────────────────────
  // Lo que pasaría si alguien guardara espacios: el documento EXISTE pero no
  // dice nada. Tratarlo como nota escrita pintaría una tarjeta vacía y haría
  // creer que la semana está documentada.
  console.log('\n3. Un texto vacío o en blanco cuenta como hueco, no como nota');
  for (const t of ['', '   ', '\n\t ']) {
    const n = notaDeCierre({ 'S38-2026': { texto: t, sinNovedad: false,
      escritaEn: '2026-09-25T18:00:00.000Z' } }, s38);
    check(n.estado === NOTA_FALTA,
      `un texto ${JSON.stringify(t)} deja la semana como no documentada`);
  }
  // El caso contrario: "sin novedad" con texto vacío SÍ es una declaración.
  const decl = notaDeCierre({ 'S38-2026': { texto: '   ', sinNovedad: true } }, s38);
  check(decl.estado === NOTA_SIN_NOVEDAD,
    'pero "sin novedad" con el texto vacío sigue siendo una declaración');

  // ── 4. Si se tocó, se ve ───────────────────────────────────────────────
  // El congelamiento es disciplina de pantalla, no regla de Firestore: las
  // reglas no pueden calcular la semana ISO. `editadaEn` es LO ÚNICO que hace
  // visible una corrección tardía, así que no puede salir de adorno en una
  // nota que nunca se tocó.
  console.log('\n4. Una nota corregida lo declara; una intacta no inventa una corrección');
  const intacta = notaDeCierre({ 'S38-2026': { texto: 'algo', sinNovedad: false,
    escritaEn: '2026-09-25T18:00:00.000Z', editadaEn: '2026-09-25T18:00:00.000Z' } }, s38);
  check(intacta.editadaEn === null,
    'guardada una sola vez, no se declara editada');
  const tocada = notaDeCierre({ 'S38-2026': { texto: 'algo corregido', sinNovedad: false,
    escritaEn: '2026-09-25T18:00:00.000Z', editadaEn: '2026-10-02T09:00:00.000Z' } }, s38);
  check(tocada.editadaEn === '2026-10-02T09:00:00.000Z',
    'corregida después, queda dicho cuándo se tocó');

  // ── 5. Se congela cuando la semana deja de correr ──────────────────────
  console.log('\n5. La nota se corrige mientras la semana corre, y después no');
  const ahora = new Date('2026-09-30T12:00:00-06:00');   // miércoles de S40-2026
  const { semana, año } = semanaISO(ahora);
  check(esLaSemanaCorriente(snapshotId(semana, año), ahora.getTime()) === true,
    `la semana que corre se puede corregir (es ${snapshotId(semana, año)})`);
  check(esLaSemanaCorriente('S39-2026', ahora.getTime()) === false,
    'la semana anterior ya está congelada');
  // El año. Restar números de semana diría que S52-2026 y S01-2027 son
  // "casi la misma"; son años distintos y la de 2026 está congelada.
  check(esLaSemanaCorriente('S40-2025', ahora.getTime()) === false,
    'la semana 40 de OTRO año no se confunde con la corriente');

}

// ── 7. Lo que se ESCRIBE: `guardarNotaSemanal` ──────────────────────────────
// Se extrae la función real y se ejecuta contra un Firestore de mentira. Lo
// que importa: que `escritaEn` NO se pise al corregir —es la mitad de lo que
// hace creíble a `editadaEn`— y que un texto y un "sin novedad" no se guarden
// nunca a la vez.
console.log('\n6. Lo que queda escrito al guardar la nota, y dónde');
const mGuardar = src.match(/const guardarNotaSemanal = async \([\s\S]*?\n};/);
if (!mGuardar) {
  const m = 'la nota de la semana no se guarda en ningún lado';
  fallos.push(m); console.log(`   ✗ ${m}`);
} else {
  const escrito = [];
  const rutas = [];
  let docPrevio = null;
  const sandbox = new Function('getDoc', 'setDoc', 'docObra', 'LIMITE_NOTA_SEMANAL', `
    ${mGuardar[0]}
    return guardarNotaSemanal;
  `)(
    async () => ({ data: () => docPrevio }),
    async (ref, datos) => { rutas.push(ref); escrito.push(datos); },
    (...a) => a.join('/'),
    LIMITE_NOTA_SEMANAL || 1000,
  );

  // Lo mismo para el recorte a 52, extraído de `crearSnapshotAvance`: hace
  // falta para comprobar que los dos no escriben en el mismo sitio.
  const mRecorte = src.match(/const recortadas = semanas\.slice\(-52\);[\s\S]*?: recortePrevio;/);

  (async () => {
    // Primera escritura.
    const ok1 = await sandbox('0114', 'S40-2026', {
      texto: 'Lluvia tres días.', autor: 'residente@fosmon.com.mx' });
    const n1 = escrito[0]?.notas?.['S40-2026'];
    check(ok1 === true && !!n1, 'la nota se guarda bajo la clave de su semana');

    // LA RAZÓN DE SER DEL DOCUMENTO APARTE. El recorte a 52 semanas reescribe
    // `avance/historial` entero y se lleva las semanas viejas por delante. Si
    // la nota viviera ahí, desaparecería sola justo cuando empieza a valer: a
    // los 52 cierres, que es cuando la obra ya tiene historia que explicar.
    check(!/historial/.test(rutas[0] || ''),
      `la nota NO se escribe en el documento que el recorte reescribe (fue a "${rutas[0]}")`);
    check(/notas/.test(rutas[0] || ''),
      'va a un documento propio de notas');
    check(!!mRecorte && !/notas/.test(mRecorte[0]),
      'y el recorte a 52 semanas no toca nada que se llame notas');
    check(n1?.escritaEn === n1?.editadaEn,
      'recién escrita, las dos marcas de tiempo coinciden');

    // Corrección: el `escritaEn` de la primera no se puede perder.
    docPrevio = { notas: { 'S40-2026': { ...n1 } } };
    await new Promise(r => setTimeout(r, 5));
    await sandbox('0114', 'S40-2026', { texto: 'Lluvia tres días y media.' });
    const n2 = escrito[1]?.notas?.['S40-2026'];
    check(n2?.escritaEn === n1?.escritaEn,
      'al corregir, cuándo se escribió por primera vez NO se pisa');
    check(n2?.editadaEn !== n1?.editadaEn,
      'y queda registrado que se tocó después');

    // Texto y "sin novedad" a la vez: manda el texto. Quien escribió algo
    // tenía algo que decir, y guardar las dos cosas dejaría una nota que se
    // contradice a sí misma.
    docPrevio = null;
    await sandbox('0114', 'S41-2026', { texto: 'Hubo esto.', sinNovedad: true });
    const n3 = escrito[2]?.notas?.['S41-2026'];
    check(n3?.sinNovedad === false && /Hubo esto/.test(n3?.texto || ''),
      'si llegan texto y "sin novedad" juntos, manda el texto');

    // Nada que guardar no escribe nada: un documento vacío contaría como
    // constancia de que alguien pasó por ahí.
    const antes = escrito.length;
    const okVacio = await sandbox('0114', 'S42-2026', { texto: '   ' });
    check(okVacio === false && escrito.length === antes,
      'una nota vacía sin declaración no escribe nada');

    // El tope. Una nota es el apunte de la semana, no el informe.
    docPrevio = null;
    await sandbox('0114', 'S43-2026', { texto: 'x'.repeat(5000) });
    const n4 = escrito[escrito.length - 1]?.notas?.['S43-2026'];
    check((n4?.texto || '').length === (LIMITE_NOTA_SEMANAL || 1000),
      `un texto larguísimo se recorta al tope (quedó en ${(n4?.texto || '').length})`);

    // ── 7. La pantalla NO ignora el `false` ─────────────────────────────────
    // Aquí es donde el #31 se cuela de verdad. El helper sí avisa —devuelve
    // `false`, y prueba-nota-no-calla.cjs lo comprueba contra el emulador—,
    // pero eso no sirve de nada si el editor se cierra igual: el hueco
    // reaparece, nadie lo explica, y quien escribió la nota se va creyendo
    // que quedó. Se ejecuta el manejador REAL del editor con un guardado que
    // falla y se mira qué hace con la respuesta.
    console.log('\n7. Cuando el guardado rebota, el editor no se cierra en silencio');
    const mIntentar = src.match(/const intentar = async \(clave, nota\) => \{[\s\S]*?\n  \};/);
    if (!mIntentar) {
      const m = 'el editor de notas no consulta si el guardado quedó';
      fallos.push(m); console.log(`   ✗ ${m}`);
    } else {
      const correr = async (respuesta) => {
        const visto = { editando: 'S40-2026', fallo: false, guardando: false };
        const intentar = new Function(
          'setGuardando', 'setFallo', 'setEditando', 'onGuardar',
          `${mIntentar[0]}\nreturn intentar;`
        )(
          v => { visto.guardando = v; },
          v => { visto.fallo = v; },
          v => { visto.editando = v; },
          async () => respuesta,
        );
        await intentar('S40-2026', { texto: 'Tres días sin acceso al frente 2.' });
        return visto;
      };

      const malo = await correr(false);
      check(malo.editando === 'S40-2026',
        'si la escritura rebota, el editor sigue abierto con el texto puesto');
      check(malo.fallo === true,
        'y la pantalla queda en estado de aviso, no en estado de éxito');
      check(malo.guardando === false,
        'el botón se desbloquea para poder reintentar');

      const bueno = await correr(true);
      check(bueno.editando === null,
        'y cuando sí queda, el editor se cierra');
      check(bueno.fallo === false,
        'sin dejar un aviso de error que no corresponde');
    }

    cerrar();
  })().catch(e => { console.error(e); process.exit(2); });
}

function cerrar() {
  if (fallos.length === 0) {
    console.log('\nVERDE — la semana sin explicación se distingue de la semana sin novedad.\n');
    process.exit(0);
  }
  console.log(`\nROJO — ${fallos.length} comprobación(es) fallaron:`);
  fallos.forEach(f => console.log(`  · ${f}`));
  console.log('');
  process.exit(1);
}

if (!mGuardar) cerrar();
