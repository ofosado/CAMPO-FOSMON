#!/usr/bin/env node
// Prueba: el corredor de contrapruebas se niega a dar por buena una mutación
// que no aplicó como se declaró.
//
// Este banco está un piso más arriba que los demás. Los otros 51 afirman
// conductas del producto; éste afirma la conducta de la herramienta que valida
// a esos 51. Si el corredor se deja engañar, las «18 mutaciones en ROJO» de
// cualquier renglón del índice son una cifra sin respaldo — y el índice está
// lleno de ellas.
//
// Por eso no se ejercita con dobles de mentira: se le da un BANCO DE VERDAD
// —escrito aquí, chico y con una conducta sola— y un fuente de verdad, y se
// mide qué hace el corredor cuando la mutación está mal declarada.
//
// LO QUE SE AFIRMA, y por qué cada una existe:
//
//   §1  RANCIA   — el anclaje ya no está. Es la única de las cuatro que llega
//                  sola con el tiempo: el fuente se mueve y la mutación deja
//                  de aplicar. Tiene que ser NO ARRANCÓ, nunca verde.
//   §2  AMBIGUA  — el anclaje aparece más veces de las declaradas. Quien
//                  declaró 1 cubre un renglón creyendo cubrir un patrón.
//   §3  PARCIAL  — varios cambios y uno no casa. ES EL CASO QUE NOMBRA EL
//                  #124, y el que `mutado === src` no puede ver.
//   §4  MUDA     — el mutante revienta el banco. Salida 2, no 1: no demuestra
//                  que la aserción muerda, sólo que el andamio se cae.
//   §5  PASÓ     — el mutante no lo detecta nadie. Es el hallazgo que la
//                  contraprueba busca, y tiene que salir contado, no callado.
//   §6  el camino bueno, para que las cinco de arriba discriminen en vez de
//        pasar por vacías: con todo bien declarado, verde y cero sobrevivientes.
//
// Uso:  node scripts/prueba-el-corredor-de-contrapruebas-no-se-deja-enganiar.cjs
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

// Por omisión se mide el corredor de verdad. `ARCHIVO_CORREDOR` existe para
// que la contraprueba de ESTE banco pueda apuntarlo a un corredor mutado, igual
// que los demás bancos apuntan a un `src/App.jsx` mutado por `ARCHIVO_APP`.
const CORREDOR = process.env.ARCHIVO_CORREDOR || path.join(__dirname, 'contraprueba.cjs');
if (!fs.existsSync(CORREDOR)) noArranco([path.basename(CORREDOR)], path.dirname(CORREDOR));
const { revisarAnclajes, correr, cuenta, normalizar } = require(CORREDOR);

const CALLADO = !!process.env.CALLADO;
const fallos = [];
const ok = (cond, titulo, detalle = '') => {
  if (!CALLADO) console.log(`${cond ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!cond) fallos.push(titulo + (detalle ? ' — ' + detalle : ''));
};

// ── EL FUENTE DE JUGUETE ───────────────────────────────────────────────────
// Tiene un `tope` una sola vez y un `redondear` TRES veces, a propósito: el
// repetido es el que hace falta para medir la ambigüedad, y el único es el que
// hace falta para medir el camino bueno.
const FUENTE = `'use strict';
const tope = 100;
const redondear = (x) => Math.round(x);
const a = redondear(1.4);
const b = redondear(2.6);
const c = redondear(3.5);
module.exports = { tope, suma: () => a + b + c };
`;

// ── EL BANCO DE JUGUETE ────────────────────────────────────────────────────
// Un banco de verdad, con la forma de los de este repositorio: lee el fuente
// que le digan por `ARCHIVO_APP`, lo ejecuta, y afirma DOS conductas. Sale 1
// si alguna cae. `REVIENTA` lo hace fallar al cargar, para medir la MUDA.
//
// La cabecera NO es decorado. La primera vez que se corrió esto, el banco de
// juguete no traía `vigilarExcepciones` y la §4 salió en rojo: al reventar,
// Node sale con 1, el MISMO código que una aserción caída, y el corredor contó
// el mutante como detectado. Un banco de juguete sin la cabecera de los
// bancos de verdad mide a un corredor que nadie usa.
const BANCO = `'use strict';
const noArranco = require(${JSON.stringify(path.join(__dirname, 'no-arranco.cjs'))});
noArranco.vigilarExcepciones('el fuente de juguete');
const fs = require('fs');
const src = fs.readFileSync(process.env.ARCHIVO_APP, 'utf8');
const mod = {};
new Function('module', src)(mod);
const { tope, suma } = mod.exports;
let malas = 0;
const ok = (c, t) => { if (!c) { malas++; console.log('FALLA  ' + t); } };
if (process.env.REVIENTA) { throw new Error('el andamio se cayó'); }
ok(tope === 100, 'el tope vale 100');
ok(suma() === 8, 'la suma redondea las tres');   // 1 + 3 + 4 = 8, el .5 sube
if (malas) { console.log(malas + ' comprobación(es)'); process.exit(1); }
process.exit(0);
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-del-corredor-'));
const RUTA_BANCO = path.join(dir, 'banco-de-juguete.cjs');
const RUTA_FUENTE = path.join(dir, 'fuente-de-juguete.js');
fs.writeFileSync(RUTA_BANCO, BANCO);
fs.writeFileSync(RUTA_FUENTE, FUENTE);

// El banco de juguete tiene que saber medir ANTES de usarlo como vara. Si no
// distingue el fuente bueno del roto, nada de lo que siga significa nada.
const correrBanco = (ruta, extra = {}) => spawnSync(process.execPath, [RUTA_BANCO],
  { encoding: 'utf8', env: { ...process.env, ARCHIVO_APP: ruta, ...extra } });
{
  const bueno = correrBanco(RUTA_FUENTE);
  const roto = path.join(dir, 'roto.js');
  fs.writeFileSync(roto, FUENTE.replace('const tope = 100;', 'const tope = 0;'));
  const r = correrBanco(roto);
  if (bueno.status !== 0 || r.status !== 1)
    noArranco([`el banco de juguete no mide: bueno=${bueno.status} roto=${r.status}`], 'el montaje');
}

// Cómo se le pide al corredor que corra el banco de juguete.
const comoCorrer = (ruta) => ({ env: { ARCHIVO_APP: ruta } });
const base = { src: FUENTE, archivo: RUTA_FUENTE, banco: RUTA_BANCO, comoCorrer, log: () => {} };

// `correr` sale del proceso cuando algo es NO ARRANCÓ, así que para medir ESO
// hay que verlo desde fuera. Este envoltorio corre un escenario en un hijo y
// devuelve su código de salida.
function salidaDe(mutaciones, extra = {}) {
  const guion = path.join(dir, `escenario-${Math.random().toString(36).slice(2)}.cjs`);
  fs.writeFileSync(guion, `'use strict';
const { correr } = require(${JSON.stringify(CORREDOR)});
const FUENTE = ${JSON.stringify(FUENTE)};
const sobrevivieron = correr({
  mutaciones: ${JSON.stringify(mutaciones)},
  src: FUENTE,
  archivo: ${JSON.stringify(RUTA_FUENTE)},
  banco: ${JSON.stringify(RUTA_BANCO)},
  comoCorrer: (ruta) => ({ env: { ARCHIVO_APP: ruta${extra.reventar ? ", REVIENTA: '1'" : ''} } }),
  log: () => {},
});
console.log('SOBREVIVIERON=' + sobrevivieron);
process.exit(0);
`);
  const r = spawnSync(process.execPath, [guion], { encoding: 'utf8', env: process.env });
  const m = ([r.stdout, r.stderr].join('\n').match(/SOBREVIVIERON=(\d+)/) || [])[1];
  return { status: r.status, sobrevivieron: m === undefined ? null : Number(m),
           texto: [r.stdout, r.stderr].join('\n') };
}

console.log('EL CORREDOR DE CONTRAPRUEBAS NO SE DEJA ENGAÑAR\n');

// ── El conteo, que es la pieza de la que cuelga todo lo demás ──────────────
ok(cuenta(FUENTE, 'redondear(') === 3, 'cuenta las apariciones de verdad', 'redondear( ×3');
ok(cuenta(FUENTE, 'const tope') === 1, 'y sabe cuándo hay una sola');
ok(cuenta(FUENTE, 'noexiste') === 0, 'y cuándo no hay ninguna');
// Sin esto, un anclaje de dos caracteres que se solapa consigo mismo contaría
// de más y el corredor pediría `veces` absurdos.
ok(cuenta('aaaa', 'aa') === 2, 'no cuenta solapándose', 'aa en aaaa → 2, no 3');

// ── §1 RANCIA ──────────────────────────────────────────────────────────────
{
  const q = revisarAnclajes([{ titulo: 'el tope se va a 0', de: 'const tope = 100;', a: 'const tope = 0;' }], FUENTE);
  ok(q.length === 0, '§1 un anclaje que sí está no se queja', q[0] || '');

  const r = revisarAnclajes([{ titulo: 'ancla vieja', de: 'const LIMITE = 100;', a: 'const LIMITE = 0;' }], FUENTE);
  ok(r.length === 1 && /RANCIA/.test(r[0]), '§1 un anclaje que ya no existe se declara RANCIA', (r[0] || '').split('\n')[0]);

  // Y tiene que ser NO ARRANCÓ visto desde fuera, no rojo: no se midió nada.
  const s = salidaDe([{ titulo: 'ancla vieja', de: 'const LIMITE = 100;', a: 'const LIMITE = 0;' }]);
  ok(s.status === 2, '§1 y desde fuera sale NO ARRANCÓ (2), no rojo', `salida ${s.status}`);
  ok(/RANCIA|ya no existe/.test(s.texto), '§1 y dice que el anclaje se quedó viejo');
}

// ── §2 AMBIGUA ─────────────────────────────────────────────────────────────
{
  const q = revisarAnclajes([{ titulo: 'quita el redondeo', de: 'redondear(', a: 'noRedondear(' }], FUENTE);
  ok(q.length === 1 && /AMBIGUA/.test(q[0]),
    '§2 un anclaje 3× declarado 1 vez es AMBIGUA', (q[0] || '').split('\n')[0]);
  ok(/aparece 3 vez\(ces\) y se declaró 1/.test(q[0] || ''),
    '§2 y dice los dos números, para poder decidir cuál era el correcto');

  // Declarando las tres, no hay queja: la ambigüedad no es tener el anclaje
  // repetido, es no saberlo.
  const r = revisarAnclajes([{ titulo: 'quita los tres redondeos', de: 'redondear(', a: 'noRedondear(', veces: 3 }], FUENTE);
  ok(r.length === 0, '§2 y declarando `veces: 3` deja de quejarse', r[0] || '');

  const s = salidaDe([{ titulo: 'quita el redondeo', de: 'redondear(', a: 'noRedondear(' }]);
  ok(s.status === 2, '§2 y desde fuera sale NO ARRANCÓ (2)', `salida ${s.status}`);
}

// ── §3 PARCIAL — el caso que nombra el #124 ────────────────────────────────
{
  // Dos cambios: el primero casa, el segundo no. `mutado !== src` sería
  // verdadero —algo cambió— y el filtro viejo lo daba por mutante bueno.
  const parcial = [{
    titulo: 'el tope se va a 0 y el redondeo también',
    cambios: [
      ['const tope = 100;', 'const tope = 0;'],
      ['const UMBRAL = 7;', 'const UMBRAL = 0;'],     // nunca existió
    ],
  }];
  const q = revisarAnclajes(parcial, FUENTE);
  ok(q.length === 1 && /RANCIA/.test(q[0]),
    '§3 de dos cambios, el que no casa se señala solo', (q[0] || '').split('\n')[0]);
  ok(/cambio 2 de 2/.test(q[0] || ''),
    '§3 y dice CUÁL de los dos fue, que es lo que el filtro viejo no podía');

  const s = salidaDe(parcial);
  ok(s.status === 2, '§3 y el mutante a medias NO pasa por bueno: NO ARRANCÓ', `salida ${s.status}`);

  // El daño del PARCIAL, ejecutado aquí y no citado de memoria.
  //
  // El filtro viejo era `if (mutado === src) saltar`. Con dos `.replace` y el
  // segundo sin casar, `mutado !== src` —el PRIMERO sí cambió algo— así que el
  // mutante pasaba el filtro. Y entonces viene lo caro: el banco lo detecta,
  // porque el primer cambio solo ya basta para tumbarlo. La contraprueba
  // publicaba «ROJA» y se apuntaba cobertura sobre `const UMBRAL = 7;`, que no
  // existe en ningún fuente. Un verde que mide la mitad y reporta el doble.
  const mutadoViejo = FUENTE
    .replace('const tope = 100;', 'const tope = 0;')
    .replace('const UMBRAL = 7;', 'const UMBRAL = 0;');
  ok(mutadoViejo !== FUENTE,
    '§3 el mutante a medias pasaba el filtro viejo', '`mutado === src` es falso: el primer cambio sí aplicó');

  const rutaViejo = path.join(dir, 'mutado-por-el-filtro-viejo.js');
  fs.writeFileSync(rutaViejo, mutadoViejo);
  const detectado = correrBanco(rutaViejo);
  ok(detectado.status === 1,
    '§3 y el banco lo detectaba, apuntando cobertura a un anclaje inexistente',
    `salida ${detectado.status} — «ROJA» por el cambio 1, cobrada también por el 2`);
  ok(!mutadoViejo.includes('const UMBRAL = 0;'),
    '§3 aunque el segundo cambio no dejó rastro alguno en el mutante');
}

// ── §3b PARCIAL que la revisión estática NO puede ver ──────────────────────
// La de arriba la atrapa `revisarAnclajes` sin gastar un proceso, porque el
// anclaje no está en el fuente. Ésta no: los dos anclajes SÍ están en el
// fuente, y es el primer cambio el que se come una aparición del segundo. El
// conteo estático dice que todo cuadra y sólo la cuenta de lo APLICADO
// —`puestos !== veces`— lo ve. Es el único caso donde ese guarda es el último,
// y por eso vive aquí con nombre propio.
{
  const seComeElSiguiente = [{
    titulo: 'el primer cambio se come una aparición del segundo',
    cambios: [
      ['redondear(1.4)', 'Math.round(1.4)'],   // deja 2 de los 3 `redondear(`
      ['redondear(', 'Math.ceil(', 3],         // en el fuente hay 3; ya sólo quedan 2
    ],
  }];
  ok(revisarAnclajes(seComeElSiguiente, FUENTE).length === 0,
    '§3b la revisión estática la da por buena, y con razón', 'los dos anclajes están en el fuente');

  const s = salidaDe(seComeElSiguiente);
  ok(s.status === 2, '§3b y al aplicarla, el conteo de lo puesto la para', `salida ${s.status}`);
  ok(/puso 2 de 3/.test(s.texto),
    '§3b diciendo cuántos puso de cuántos, no «algo cambió»');
}

// ── §4 MUDA — el mutante revienta el banco ─────────────────────────────────
{
  const s = salidaDe([{ titulo: 'el tope se va a 0', de: 'const tope = 100;', a: 'const tope = 0;' }],
                     { reventar: true });
  ok(s.status === 2, '§4 un mutante que revienta el banco es NO ARRANCÓ, no éxito', `salida ${s.status}`);
  ok(/revienta el banco/.test(s.texto), '§4 y lo dice con esas palabras, no como rojo');
}

// ── §5 PASÓ — nadie detectó el mutante ─────────────────────────────────────
{
  // `c` no lo mira ninguna aserción del banco de juguete… pero sí: entra en la
  // suma. Hay que mutar algo DE VERDAD invisible: un nombre que no se usa.
  const s = salidaDe([{ titulo: 'renombra algo que nadie mira',
    de: "module.exports = { tope, suma:", a: "module.exports = { tope: tope, suma:" }]);
  ok(s.status === 0 && s.sobrevivieron === 1,
    '§5 un mutante que nadie detecta se cuenta como sobreviviente',
    `salida ${s.status} · sobrevivieron ${s.sobrevivieron}`);
}

// ── §6 EL CAMINO BUENO ─────────────────────────────────────────────────────
// Sin esto las cinco de arriba podrían estar pasando por un corredor que se
// queja de todo.
{
  const s = salidaDe([
    { titulo: 'el tope se va a 0', de: 'const tope = 100;', a: 'const tope = 0;' },
    // Ojo con el anclaje: `redondear(` aparece 3 veces pero `redondear(x)` NO
    // aparece nunca —la definición lleva espacio, `redondear = (x)`— y el
    // corredor lo cantó como RANCIA la primera vez que se corrió esto.
    { titulo: 'el redondeo se vuelve piso', de: 'Math.round(x)', a: 'Math.floor(x)' },
  ]);
  ok(s.status === 0 && s.sobrevivieron === 0,
    '§6 con todo bien declarado: verde y cero sobrevivientes',
    `salida ${s.status} · sobrevivieron ${s.sobrevivieron}`);
}

// ── El contrato de las dos formas de declarar ─────────────────────────────
{
  const unCambio = normalizar({ titulo: 't', de: 'a', a: 'b' }, 0);
  ok(unCambio.cambios.length === 1 && unCambio.cambios[0].veces === 1,
    'la forma corta vale por un cambio con `veces: 1`');
  const varios = normalizar({ titulo: 't', cambios: [['a', 'b'], ['c', 'd', 2]] }, 0);
  ok(varios.cambios.length === 2 && varios.cambios[1].veces === 2,
    'y la forma larga conserva el `veces` de cada cambio');
  const q = revisarAnclajes([{ titulo: 'no muta nada', de: 'const tope = 100;', a: 'const tope = 100;' }], FUENTE);
  ok(q.length === 1 && /idénticos/.test(q[0]),
    'un reemplazo idéntico al anclaje se rechaza', (q[0] || '').split('\n')[0]);
}

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* da igual */ }

if (fallos.length) {
  console.error(`\nROJO: ${fallos.length} aserción(es) caídas.`);
  for (const f of fallos) console.error(`  · ${f}`);
  process.exit(1);
}
if (!CALLADO) console.log('\nverde: una mutación que no aplicó como se declaró no pasa por buena.\n');

if (!process.argv.includes('--contraprueba') || process.env.SIN_CONTRAPRUEBA) process.exit(0);

// ── LA CONTRAPRUEBA DE ESTE BANCO ──────────────────────────────────────────
//
// Se muta el corredor y se exige que este banco enrojezca. Es la única razón
// por la que las aserciones de arriba valen algo: si se le puede quitar a
// `contraprueba.cjs` el guarda del #124 y este banco sigue en verde, entonces
// no afirma nada y los 51 bancos que van a colgar de él tampoco.
//
// El corredor se mide con el corredor, que suena a trampa y no lo es: el que
// muta es el del repositorio y el mutado es una copia en /tmp. Si el que muta
// estuviera roto, las mutaciones no aplicarían y la salida sería NO ARRANCÓ,
// no verde.
//
// La única reescritura que se le hace al fuente antes de mutarlo es el `require`
// relativo de `no-arranco.cjs`, porque el mutante vive en /tmp y de ahí no
// resuelve. Se declara aquí para que nadie la confunda con una mutación.
{
  const { correr, veredicto } = require(CORREDOR);
  const FUENTE_CORREDOR = fs.readFileSync(CORREDOR, 'utf8')
    .replace("require('./no-arranco.cjs')",
             `require(${JSON.stringify(path.join(__dirname, 'no-arranco.cjs'))})`);

  const mutaciones = [
    // §1 RANCIA: si el anclaje ausente no se declara, el fuente se mueve y la
    // contraprueba se vuelve adorno sin avisar.
    { titulo: 'el anclaje ausente deja de ser RANCIA', de: 'if (n === 0) {', a: 'if (false) {' },
    // §2 AMBIGUA: sin esto, `veces` es decorativo y un anclaje repetido cubre
    // un renglón creyendo cubrir un patrón.
    { titulo: '`veces` deja de ser una igualdad', de: '} else if (n !== veces) {', a: '} else if (false) {' },
    // §1/§2: la queja existe pero sale como rojo, que manda a buscar una
    // regresión del producto donde lo que hay es un anclaje viejo.
    { titulo: 'la queja de anclaje sale como rojo y no como NO ARRANCÓ',
      de: '  if (!callado) console.error(salida);\n  process.exit(NO_ARRANCO);',
      a: '  if (!callado) console.error(salida);\n  process.exit(1);' },
    // §3b: EL GUARDA QUE NOMBRA EL #124. Esto es exactamente el filtro viejo.
    { titulo: 'vuelve el filtro viejo: basta con que algo haya cambiado',
      de: 'if (puestos !== veces || mutado === antes)', a: 'if (mutado === antes)' },
    // §4 MUDA: un mutante que revienta el banco se cobraría como detectado.
    { titulo: 'el mutante que revienta el banco cuenta como detectado',
      de: 'if (r.status === NO_ARRANCO) {', a: 'if (false) {' },
    // §5 PASÓ: el sobreviviente se calla y la contraprueba sale verde midiendo nada.
    { titulo: 'el sobreviviente no se cuenta', de: '      sobrevivieron++;', a: '      sobrevivieron += 0;' },
    // El conteo: un anclaje corto que se solapa contaría de más y `veces`
    // pediría números imposibles.
    { titulo: 'el conteo se solapa consigo mismo', de: 'n++; i = j + aguja.length;', a: 'n++; i = j + 1;' },
    // El rechazo del reemplazo idéntico, que es una mutación que no muta.
    { titulo: 'un reemplazo idéntico al anclaje se acepta', de: 'if (de === a) {', a: 'if (false) {' },
  ];

  console.log('CONTRAPRUEBA — se rompe el corredor y este banco tiene que verlo\n');
  const sobrevivieron = correr({
    mutaciones,
    src: FUENTE_CORREDOR,
    archivo: CORREDOR,
    extension: '.cjs',
    prefijo: 'corredor-mutado-',
    banco: __filename,
    comoCorrer: (ruta) => ({ env: { ARCHIVO_CORREDOR: ruta, CALLADO: '1' } }),
  });
  process.exit(veredicto(sobrevivieron, mutaciones.length));
}
