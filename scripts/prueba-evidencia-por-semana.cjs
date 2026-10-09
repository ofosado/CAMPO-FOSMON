#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Prueba: la evidencia se puede consultar por semana sin afirmar nada falso.
// ════════════════════════════════════════════════════════════════════════════
//
// La mitad de LECTURA del #30: el director quiere abrir la obra y ver lo de
// la semana pasada, o seguir una partida a lo largo de sus semanas. Lo que se
// comprueba aquí son las tres cosas que pueden salir mal, y las tres son
// maneras de mentir con fotos de verdad:
//
//   1. METER UNA FOTO EN LA SEMANA EQUIVOCADA. `fecha` es "2026-09-21" y
//      `new Date("2026-09-21")` se interpreta en UTC: en México son las 18:00
//      del día 20. Como `semanaISO` trabaja en local, TODOS los lunes se iban
//      a la semana anterior —una foto de cada siete mal archivada— y nadie lo
//      vería nunca, porque la foto sigue ahí, sólo que una semana antes.
//
//   2. ESCONDER LA FOTO QUE NO SE PUEDE FECHAR. El esquema es mixto: hay
//      fotos guardadas como cadena suelta y fotos sin `fecha`, de antes de
//      que `addFoto` la pusiera. Agruparlas por semana invita a tirar las que
//      no encajan, y eso es enseñar menos evidencia de la que hay (P2).
//
//   3. DECIR «ASÍ SE VEÍA LA OBRA ESA SEMANA». `fecha` es la fecha de SUBIDA,
//      no la de ejecución ni la del disparo de la cámara. Una foto de un muro
//      de agosto subida en septiembre aparece en septiembre, y está bien
//      siempre que la leyenda diga SUBIDAS. La diferencia entre un dato y una
//      afirmación cabe en una palabra.
//
// No comprueba que exista ningún nombre: ejecuta los trozos reales extraídos
// de `src/App.jsx` y afirma lo que queda escrito en la pantalla.
//
// Uso:  node scripts/prueba-evidencia-por-semana.cjs [archivo]
//
// El argumento opcional corre el banco contra una copia modificada, para
// comprobar que de verdad se pone en rojo. Estas seis mutaciones se probaron
// una por una; las seis salen en ROJO (1), ninguna en NO ARRANCÓ (2):
//
//   · `fechaLocalDeISO` vuelve a `new Date(txt)`      → 2 rojas (§1)
//   · `todas` descarta la foto sin semana             → 3 rojas (§2)
//   · la leyenda dice «Así se veía la obra en…»       → 4 rojas (§3)
//   · `semanas` se ordena con `.sort().reverse()`     → 2 rojas (§4)
//   · `partidas` se agrupa por `sec` y no por `id`    → 1 roja  (§5)
//   · en la captura, la foto sin fecha va con las viejas → 2 rojas (§6)

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

// ── Extracción ──────────────────────────────────────────────────────────────
// `modulo` son las declaraciones de nivel de módulo (la cuenta de semanas);
// `dentro` las que viven dentro de un componente, que se buscan por su
// función contenedora porque hay nombres repetidos en el archivo.
const modulo = {}, dentro = {};
traverse(ast, {
  // `fechaDeTimestamp` es una DECLARACIÓN de función, no un `const`: tiene que
  // estar hoisteada porque `evidenciaNormalizada`, que la llama, se declara
  // antes. El extractor las toma también, o la pieza se queda sin alcanzar y el
  // banco sale en NO ARRANCÓ por una razón que no tiene nada que ver con lo que
  // afirma.
  FunctionDeclaration(p) {
    if (!p.node.id || p.getFunctionParent()) return;
    const nombre = p.node.id.name;
    if (!(nombre in modulo)) modulo[nombre] = src.slice(p.node.start, p.node.end);
  },
  VariableDeclarator(p) {
    if (p.node.id.type !== 'Identifier' || !p.node.init) return;
    const nombre = p.node.id.name;
    const código = src.slice(p.node.init.start, p.node.init.end);
    let fn = p.getFunctionParent();
    while (fn && !fn.node.id) fn = fn.getFunctionParent();
    if (!fn) { if (!(nombre in modulo)) modulo[nombre] = código; return; }
    const clave = `${fn.node.id.name}.${nombre}`;
    if (!(clave in dentro)) dentro[clave] = código;
  },
});

const falta = [];
const M = (n) => { if (!(n in modulo)) falta.push(n); return modulo[n] || 'null'; };
const D = (n) => { if (!(n in dentro)) falta.push(n); return dentro[n] || 'null'; };

// El aplanado se mudó al módulo (#30). Este banco sigue entrando por `subs`
// crudos, así que ahora recorre `evidenciaDeObra` → `todas`: el camino entero,
// no sólo el último tramo.
const PIEZAS_MODULO = ['semanaISO', 'snapshotId', 'fechaLocalDeISO',
  'ORIGEN_LEGADO', 'ORIGEN_EN_VIVO', 'fechaDeTimestamp', 'evidenciaNormalizada',
  'idDePartida', 'evidenciaMigrada', 'evidenciaDeObra', 'evidenciaVigente',
  'semanaDeEvidencia',
  'lunesDeClaveSemana', 'MESES_CORTO', 'etiquetaSemanaCorta',
  // El panel del riel y esta leyenda fechan la semana con la misma cuenta, así
  // que `leyendaSemanaSubida` ya no se sostiene sola.
  'rangoSemanaEnPalabras', 'leyendaSemanaSubida'];
const cuerpoModulo = PIEZAS_MODULO.map(n => `const ${n} = ${M(n)};`).join('\n');

// `todas`, `semanas` y `partidas` son `useMemo(() => …, [deps])`: lo que hace
// el trabajo es el primer argumento. Se desenvuelve para poder llamarlo.
const desenvolverMemo = (código) => {
  const m = /^useMemo\s*\(([\s\S]*),\s*\[[^\]]*\]\s*\)$/.exec(código.trim());
  return m ? m[1].trim() : código;
};

if (falta.length === 0) {
  for (const c of ['FotosCliente.todas', 'FotosCliente.semanas', 'FotosCliente.partidas',
                   'FotosCliente.sinSemana', 'ConceptoFotos.viejas', 'ConceptoFotos.ahora'])
    D(c);
}

if (falta.length) {
  console.error('No se encontraron estas piezas en ' + archivo + ':');
  for (const f of falta) console.error('  · ' + f);
  console.error('\nSi la pantalla de evidencia se reescribió, este banco hay que rehacerlo');
  console.error('contra la pantalla nueva, no borrarlo: lo que afirma sigue siendo cierto.');
  process.exit(1);
}

const mod = new Function(`"use strict";
${cuerpoModulo}
return { semanaDeEvidencia, evidenciaNormalizada, lunesDeClaveSemana, etiquetaSemanaCorta,
  leyendaSemanaSubida, semanaISO, snapshotId };`)();

// La pantalla del cliente: de `subs` crudos a lo que se ve en cada eje.
const pantalla = new Function('subs', `"use strict";
${cuerpoModulo}
const useMemo = (fn) => fn();
const evidencia = evidenciaDeObra({ cfgEvidencia: null, docsEvidencia: [], subs });
const todas = (${desenvolverMemo(D('FotosCliente.todas'))})();
const semanas = (${desenvolverMemo(D('FotosCliente.semanas'))})();
const sinSemana = ${D('FotosCliente.sinSemana')};
const partidas = (${desenvolverMemo(D('FotosCliente.partidas'))})();
return { todas, semanas, sinSemana,
  partidas: partidas.map(p => ({ sec: p.sec, sub: p.sub, fotos: p.fotos, semanas: [...p.semanas] })) };`);

// La pantalla de captura: qué miniaturas se ven de entrada y qué queda detrás
// de «ver anteriores».
const captura = new Function('fotos', 'semanaHoy', `"use strict";
${cuerpoModulo}
const viejas = ${D('ConceptoFotos.viejas')};
const ahora = ${D('ConceptoFotos.ahora')};
return { viejas, ahora };`);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

const foto = (n, fecha) => ({ id: `f${n}`, url: `https://ejemplo/${n}.jpg`, ...(fecha ? { fecha } : {}) });
const partida = (sec, id, fotos) => ({ sec, id, sub: `Partida ${sec}`, fotos: { [id]: fotos } });
// La forma NORMALIZADA, que es la que consume la pantalla de captura desde que
// el aplanado se mudó al módulo. Se construye con `evidenciaNormalizada` del
// archivo, no a mano: una forma tecleada aquí comprobaría este banco contra
// sí mismo y no contra la pantalla.
const ev = (n, fecha) => mod.evidenciaNormalizada({
  id: `f${n}`, urlOriginal: `https://ejemplo/${n}.jpg`,
  ...(fecha ? { fechaDeclarada: fecha } : {}) });

// ════════════════════════════════════════════════════════════════════════════
console.log('1. La foto cae en la semana en que se subió — incluidos los lunes');
// Todo lunes del año y su domingo tienen que caer en la MISMA semana. Es la
// comprobación que atrapa el desfase de zona horaria: con `new Date(texto)`
// el lunes se va a la semana anterior y el par deja de coincidir.
{
  let paresMal = [];
  const d = new Date(2026, 0, 5);               // primer lunes de 2026
  for (let i = 0; i < 52; i++) {
    const lun = new Date(d); lun.setDate(d.getDate() + i * 7);
    const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
    const a = mod.semanaDeEvidencia(ev(1, iso(lun)));
    const b = mod.semanaDeEvidencia(ev(2, iso(dom)));
    if (a !== b) paresMal.push(`${iso(lun)}→${a} pero ${iso(dom)}→${b}`);
  }
  check(paresMal.length === 0,
    'los 52 lunes de 2026 caen en la semana de su domingo',
    paresMal.length ? `${paresMal.length} desfasado(s): ${paresMal[0]}` : 'los 52');
}
// Y la semana que sale es la del calendario, no una cualquiera consistente.
check(mod.semanaDeEvidencia(ev(1, '2026-09-21')) === 'S39-2026',
  'el lunes 21 de septiembre de 2026 es la semana 39',
  mod.semanaDeEvidencia(ev(1, '2026-09-21')));
check(mod.semanaDeEvidencia(ev(1, '2026-09-27')) === 'S39-2026',
  'y el domingo 27, la misma',
  mod.semanaDeEvidencia(ev(1, '2026-09-27')));

// La vuelta: el lunes que la leyenda fecha es el lunes de esa semana.
{
  let mal = [];
  for (const clave of ['S01-2026', 'S09-2026', 'S39-2026', 'S53-2026', 'S01-2027']) {
    const l = mod.lunesDeClaveSemana(clave);
    const { semana, año } = mod.semanaISO(l);
    if (l.getDay() !== 1 || mod.snapshotId(semana, año) !== clave)
      mal.push(`${clave} → ${l && l.toDateString()}`);
  }
  check(mal.length === 0, 'la leyenda fecha el lunes correcto, también en el cruce de año',
    mal.length ? mal.join('; ') : 'S01-2026, S09, S39, S53-2026, S01-2027');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. Una foto que no se puede fechar se ve, no se tira');
// Las cuatro formas que hay en producción de no tener semana deducible.
const sinFecha = [
  partida('1.1', 'a', [foto(1, '2026-09-22'), foto(2)]),                 // objeto sin `fecha`
  partida('1.2', 'b', ['https://ejemplo/suelta.jpg']),                   // cadena suelta
  partida('1.3', 'c', [{ id: 'x', url: 'https://ejemplo/x.jpg', fecha: 'el martes' }]),
  partida('1.4', 'd', [{ id: 'y', url: 'https://ejemplo/y.jpg', fecha: '' }]),
];
{
  const v = pantalla(sinFecha);
  check(v.todas.length === 5, 'las cinco fotos llegan a la pantalla', `${v.todas.length} de 5`);
  check(v.sinSemana.length === 4, 'cuatro quedan en el grupo «sin fecha», a la vista',
    `${v.sinSemana.length} de 4`);
  check(v.todas.filter(f => f.semana).length === 1, 'y la única fechada va a su semana',
    v.todas.find(f => f.semana)?.semana || '—');
  // Lo que importa de verdad: la suma de los grupos es el total. Si algún día
  // el grupo sin fecha se quitara de la pantalla, aquí se vería.
  const enGrupos = v.semanas.reduce((t, w) => t + v.todas.filter(f => f.semana === w).length, 0)
    + v.sinSemana.length;
  check(enGrupos === v.todas.length,
    'ninguna foto se queda fuera de todos los grupos', `${enGrupos} de ${v.todas.length}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. La leyenda dice SUBIDAS, nunca «así se veía»');
check(mod.leyendaSemanaSubida('S39-2026') === 'Subidas en la semana del 21 al 27 de sep de 2026',
  'la semana 39 de 2026 se lee completa y en español',
  mod.leyendaSemanaSubida('S39-2026'));
check(mod.leyendaSemanaSubida('S40-2026') === 'Subidas en la semana del 28 de sep al 4 de oct de 2026',
  'y cuando cruza de mes, se escriben los dos meses',
  mod.leyendaSemanaSubida('S40-2026'));
check(mod.leyendaSemanaSubida('S53-2026') === 'Subidas en la semana del 28 de dic de 2026 al 3 de ene de 2027',
  'y cuando cruza de año, los dos años',
  mod.leyendaSemanaSubida('S53-2026'));
check(/^Subidas en la semana/.test(mod.leyendaSemanaSubida('S01-2026')),
  'toda leyenda de semana empieza por «Subidas»',
  mod.leyendaSemanaSubida('S01-2026'));
// Sin fecha no se inventa una semana ni se deja en blanco: lo dice.
check(/sin fecha/i.test(mod.leyendaSemanaSubida(null))
   && /sin fecha/i.test(mod.leyendaSemanaSubida('__sin__')),
  'y sin clave de semana, la leyenda dice que no hay fecha',
  mod.leyendaSemanaSubida(null));

// Barrido: la pantalla de evidencia no puede afirmar el ESTADO de la obra en
// una semana. Es una afirmación que los datos no sostienen.
{
  const PROHIBIDO = /as[íi] se ve[íi]a|as[íi] estaba|estado de la obra (en|a)|c[óo]mo estaba|avance de la semana|fotos? de la semana/gi;
  const inicio = src.indexOf('function FotosCliente');
  const fin = src.indexOf('\nfunction ', inicio + 10);
  const trozo = src.slice(inicio, fin > 0 ? fin : src.length);
  const malas = [];
  for (const m of trozo.matchAll(PROHIBIDO)) malas.push(m[0]);
  check(malas.length === 0,
    'ninguna frase de la pantalla afirma el estado de la obra en una semana',
    malas.length ? malas.join('; ') : 'ninguna');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. Las semanas se ordenan de la más reciente a la más vieja');
// El cruce de año es el caso que el orden alfabético rompe: "S01-2027" va
// antes que "S52-2026" como texto, y la semana más nueva aparecería al final.
{
  const obra = [
    partida('1.1', 'a', [foto(1, '2027-01-07'), foto(2, '2026-12-29'), foto(3, '2026-09-22')]),
  ];
  const v = pantalla(obra);
  check(JSON.stringify(v.semanas) === JSON.stringify(['S01-2027', 'S53-2026', 'S39-2026']),
    'enero de 2027 va antes que diciembre de 2026', v.semanas.join(' > '));
  check(v.semanas[0] === 'S01-2027',
    'la semana que se abre por omisión es la más reciente con evidencia', v.semanas[0]);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. Una partida se puede seguir a lo largo de sus semanas');
// El eje de verdad. Medido en producción: son muchas más las partidas con
// foto en varias semanas que las partidas en común entre dos semanas
// concretas, porque cada semana se fotografía otra cosa.
{
  const obra = [
    partida('1.1', 'a', [foto(1, '2026-09-07'), foto(2, '2026-09-15'), foto(3, '2026-09-22'), foto(4, '2026-09-23')]),
    partida('1.2', 'b', [foto(5, '2026-09-22')]),
    partida('1.3', 'c', [foto(6, '2026-09-07'), foto(7)]),
  ];
  const v = pantalla(obra);
  const p11 = v.partidas.find(p => p.sec === '1.1');
  check(p11?.fotos.length === 4 && p11?.semanas.length === 3,
    '1.1 tiene 4 fotos repartidas en 3 semanas',
    `${p11?.fotos.length} foto(s) en ${p11?.semanas.length} semana(s)`);
  const p13 = v.partidas.find(p => p.sec === '1.3');
  check(p13?.fotos.length === 2 && p13?.semanas.length === 1,
    'la foto sin fecha de 1.3 cuenta como foto pero no inventa una semana',
    `${p13?.fotos.length} foto(s) en ${p13?.semanas.length} semana(s)`);
  check(JSON.stringify(v.partidas.map(p => p.sec)) === JSON.stringify(['1.1', '1.2', '1.3']),
    'las partidas salen en el orden del catálogo', v.partidas.map(p => p.sec).join(', '));
  // Y la clave de una partida es su `id`, no su `sec`: dos partidas distintas
  // pueden compartir `sec` y mezclarlas juntaría evidencia de dos trabajos.
  const repetidas = [
    { sec: '2.1', id: 'p1', sub: 'Zapata eje A', fotos: { p1: [foto(8, '2026-09-22')] } },
    { sec: '2.1', id: 'p2', sub: 'Zapata eje B', fotos: { p2: [foto(9, '2026-09-22')] } },
  ];
  const vr = pantalla(repetidas);
  check(vr.partidas.length === 2,
    'dos partidas con la misma clave no se mezclan en una', `${vr.partidas.length} partida(s)`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. En la captura, lo de esta semana se ve y lo viejo se cuenta');
// «Capturar igual que hoy, con ver anteriores». Lo viejo no desaparece: queda
// detrás de un botón que dice cuántas son.
{
  const HOY = 'S39-2026';
  const fotos = [
    ev(1, '2026-09-22'),   // esta semana
    ev(2, '2026-09-25'),   // esta semana
    ev(3, '2026-09-15'),   // la pasada
    ev(4, '2026-08-10'),   // de agosto
    ev(5),                 // sin fecha
  ];
  const v = captura(fotos, HOY);
  check(v.ahora.length === 3 && v.viejas.length === 2,
    'de entrada se ven las 2 de esta semana y la que no tiene fecha',
    `${v.ahora.length} a la vista, ${v.viejas.length} detrás de «ver anteriores»`);
  check(v.ahora.some(f => f.id === 'f5'),
    'la foto sin fecha se queda a la vista: no se sabe que sea vieja',
    v.ahora.map(f => f.id).join(', '));
  check(v.ahora.length + v.viejas.length === fotos.length,
    'y ninguna foto se pierde entre los dos grupos',
    `${v.ahora.length} + ${v.viejas.length} = ${fotos.length}`);
  // Sin histórico no aparece el botón: no hay nada que ofrecer.
  const soloHoy = captura([ev(1, '2026-09-22')], HOY);
  check(soloHoy.viejas.length === 0,
    'una partida fotografiada sólo esta semana no ofrece «ver anteriores»',
    `${soloHoy.viejas.length} anterior(es)`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n7. La etiqueta del selector de semanas identifica la semana');
{
  const vistas = ['S39-2026', 'S40-2026', 'S01-2027'].map(mod.etiquetaSemanaCorta);
  check(vistas[0] === 'S39 · 21 sep' && vistas[1] === 'S40 · 28 sep' && vistas[2] === 'S01 · 4 ene',
    'cada chip dice el número de semana y el día en que empieza', vistas.join(' | '));
  check(new Set(vistas).size === vistas.length,
    'y dos semanas distintas no comparten etiqueta', vistas.join(' | '));
}

console.log(fallas === 0
  ? '\nLa evidencia se consulta por semana y por partida sin afirmar nada que nadie capturó.'
  : `\n${fallas} comprobación(es) en rojo.`);
process.exit(fallas > 0 ? 1 : 0);
