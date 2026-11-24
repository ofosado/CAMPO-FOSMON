#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL LOGO DE CADA ORGANIZACIÓN ENTRA POR LA APP
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ FALTABA, Y QUÉ NO. La cadena de la marca estaba entera: el documento
// `orgs/{oid}/config/branding` se lee al entrar, el logo se pinta junto al
// saludo, y `firestore.rules` ya dejaba escribirlo al admin de cada
// organización. Lo único que no existía era la PUERTA DE ENTRADA — el alta de
// organización manda `empresa`, `empresaCorta` y `dominio` y no tiene campo de
// logo, y después no había pantalla—. En producción eso se ve en que ninguna
// organización tiene logo: ni el municipio, ni FOSMON, cuyo documento de marca
// no existe siquiera.
//
// LAS CINCO AFIRMACIONES, Y POR QUÉ CADA UNA.
//
//   §1. La reducción ACOTA y no agranda. El logo se guarda dentro del
//       documento, así que su tamaño es el único freno que hay; y un escudo de
//       80 px estirado a 220 se ve peor que pequeño y encima pesa más.
//   §2. El tope se mide en BYTES del campo y queda muy por debajo del tope de
//       un documento de Firestore. Si el tope del logo subiera por encima, la
//       escritura la rechazaría la base —después de que el usuario eligió su
//       archivo y apretó Guardar—.
//   §3. La pantalla se ofrece EXACTAMENTE a los roles que la regla deja
//       escribir. `gerente_construccion` ve el menú de Configuración y la
//       regla le niega `config/branding`: ofrecerle «Marca» sería un botón que
//       acaba en `permission-denied`. Los roles salen de `firestore.rules`,
//       no tecleados aquí.
//   §4. Sin logo no se pinta uno de muestra. El hueco se dice con palabras; un
//       sustituto haría creer que ya hay algo puesto.
//   §5. Se escribe en la MISMA ruta que se lee. Un typo en la ruta de
//       escritura guardaría el logo en un documento que nadie lee, y la
//       pantalla diría «Guardado» con toda la razón del mundo.
//
// CÓMO MIDE. No busca cadenas: saca de `src/App.jsx` las cuentas y los dos
// componentes y los EJECUTA —el menú y la pantalla se pintan de verdad con
// `renderToStaticMarkup`—, y los roles los lee de `firestore.rules`.
//
// Uso:
//     node scripts/prueba-el-logo-entra-por-la-app.cjs
//     node scripts/prueba-el-logo-entra-por-la-app.cjs --contraprueba
//
// Salida: 0 verde · 1 ROJO · 2 no arrancó.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones(__filename);

const { fuenteDe, SimboloPerdido, ARCHIVO } = require('./extraer-de-app.cjs');
const RAIZ = path.resolve(__dirname, '..');
const { parse } = require(path.join(RAIZ, 'node_modules/@babel/parser'));
const traverse = require(path.join(RAIZ, 'node_modules/@babel/traverse')).default;
const React = require(path.join(RAIZ, 'node_modules/react'));
const { renderToStaticMarkup } = require(path.join(RAIZ, 'node_modules/react-dom/server'));
const esbuild = require(path.join(RAIZ, 'node_modules/esbuild'));

// La contraprueba apunta estos dos a copias mutadas.
const ARCH_APP = process.env.ARCHIVO_APP || ARCHIVO;
const ARCH_RULES = process.env.ARCHIVO_REGLAS || path.join(RAIZ, 'firestore.rules');

const muere = (...lineas) => {
  console.error(`\nNO ARRANCÓ: ${lineas[0]}`);
  for (const l of lineas.slice(1)) console.error(`  ${l}`);
  process.exit(2);
};

const src = fs.readFileSync(ARCH_APP, 'utf8');
const ast = () => parse(src, { sourceType: 'module', plugins: ['jsx'] });

// ── LAS CUENTAS, SACADAS DEL ARCHIVO ───────────────────────────────────────
const PIDE = ['medidaDelLogo', 'veredictoDelLogo', 'puedeEditarMarca',
              'ROLES_MARCA_C', 'ROLES_MARCA_D', 'LOGO_LADO_MAX',
              'LOGO_TOPE_BYTES', 'TOPE_DOCUMENTO_FIRESTORE',
              'veConfiguracion', 'ROLES_CONFIG_D', 'kb', 'alfa'];
let cuerpo, faltan;
try { ({ cuerpo, faltan } = fuenteDe(ARCH_APP, PIDE, { tolerante: true })); }
catch (e) {
  if (e instanceof SimboloPerdido) noArranco(e.faltantes, path.basename(ARCH_APP));
  throw e;
}
if (faltan.length) noArranco(faltan, path.basename(ARCH_APP));

let APP;
try { APP = new Function(`"use strict";\n${cuerpo}\nreturn { ${PIDE.join(', ')} };`)(); }
catch (e) {
  muere('no se pudo montar el código extraído de App.jsx: ' + e.message.split('\n')[0],
    'Sin poder EJECUTAR las cuentas no hay nada que afirmar: mirar el texto del',
    'archivo comprobaría que una cadena está escrita, no que la cuenta da eso.');
}
const { medidaDelLogo, veredictoDelLogo, puedeEditarMarca,
        ROLES_MARCA_C, ROLES_MARCA_D, LOGO_LADO_MAX, LOGO_TOPE_BYTES,
        TOPE_DOCUMENTO_FIRESTORE, veConfiguracion, ROLES_CONFIG_D, kb, alfa } = APP;

// ── LOS DOS COMPONENTES, PINTADOS DE VERDAD ────────────────────────────────
function fuenteDeComponente(nombre) {
  let hallado = null;
  traverse(ast(), {
    FunctionDeclaration(p) {
      if (p.node.id?.name === nombre && p.parent.type === 'Program')
        hallado = src.slice(p.node.start, p.node.end);
    },
  });
  return hallado;
}
const compilarJSX = (f) => esbuild.transformSync(`(${f})`, { loader: 'jsx' }).code;

// La paleta sale de un Proxy: este banco no juzga colores, y cargar la paleta
// entera lo ataría a un archivo que no mide.
const PALETA = new Proxy({}, { get: () => '#808080' });

// Lo que el componente usa y nadie le puso delante.
//
// Esta lista estaba TECLEADA (`C, alfa, kb, LOGO_LADO_MAX, …`), que es la
// clase de defecto que este repositorio ya tiene fichada: el día que el
// componente empieza a usar algo nuevo, el banco no dice «me falta X», dice
// «X is not defined» al pintarse —NO ARRANCÓ, que se lee como andamiaje roto
// y no como lo que es—. Pasó el 2026-11-24 con `ROLES_VEN_SALUD`.
//
// Ahora las libres se leen del propio componente y lo que no esté puesto a
// mano se trae de `App.jsx`. Lo que no se pueda resolver se nombra, que es la
// diferencia entre «falta esto» y «algo se cayó».
// Los del navegador van en la lista aunque Node no los tenga: `document` no
// se puede «sacar de App.jsx», y pedírselo al extractor convierte una pieza
// que simplemente no hace falta en un NO ARRANCÓ. No se tocan porque los
// efectos están apagados —`useEffect` es un no-op—, así que el componente se
// pinta sin mirarlos; si algún día uno se usara al pintar, saldría aquí.
const DEL_NAVEGADOR = ['document', 'window', 'navigator', 'localStorage',
  'sessionStorage', 'fetch', 'alert', 'confirm', 'location', 'FileReader',
  'Image', 'Blob', 'URL', 'FormData'];
const DEL_MOTOR = new Set(Object.getOwnPropertyNames(globalThis).concat(
  ['console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
   'Date', 'Promise', 'Set', 'Map', 'Error', 'RegExp', 'undefined', 'NaN'],
  DEL_NAVEGADOR));

function libresDelComponente(fuente) {
  const envoltura = parse(`const __c = (${fuente});`,
    { sourceType: 'module', plugins: ['jsx'] });
  let globales = [];
  traverse(envoltura, { Program(p) { globales = Object.keys(p.scope.globals); p.stop(); } });
  return globales.filter(n => !DEL_MOTOR.has(n));
}

// `abierto` arranca en `true` para que el desplegable esté desplegado: lo que
// se afirma es QUÉ OPCIONES ofrece, y cerrado no ofrece ninguna.
const montar = (nombre, extra = {}) => {
  const f = fuenteDeComponente(nombre);
  if (!f) muere(`no se halló el componente \`${nombre}\` en ${path.basename(ARCH_APP)}.`,
    'Es el anclaje de este banco: sin él no hay pantalla que pintar.');
  const entorno = {
    React,
    useState: (ini) => [ini, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useMemo: (g) => g(),
    useCallback: (g) => g,
    C: PALETA, alfa, kb, LOGO_LADO_MAX,
    veredictoDelLogo, logoDesdeArchivo: async () => ({}),
    puedeEditarMarca, ROLES_CONFIG_D,
    setDoc: async () => {}, doc: () => ({}), fbDb: {},
    ...extra,
  };

  // Lo que el componente pide y no está puesto arriba se trae de `App.jsx`.
  const pendientes = libresDelComponente(f).filter(n => !(n in entorno));
  if (pendientes.length) {
    let traidos, cuerpoExtra;
    try { ({ cuerpo: cuerpoExtra } = fuenteDe(ARCH_APP, pendientes, { tolerante: false })); }
    catch (e) {
      muere(`\`${nombre}\` usa ${pendientes.map(n => `\`${n}\``).join(', ')} y no se ` +
        `pudieron sacar de ${path.basename(ARCH_APP)}: ${e.message.split('\n')[0]}`,
        'No es el andamiaje: es que el componente creció y hay que decidir qué',
        'se le pone delante. Mirar si la pieza nueva merece su propia aserción.');
    }
    try {
      traidos = new Function(
        `"use strict";\n${cuerpoExtra}\nreturn { ${pendientes.join(', ')} };`)();
    } catch (e) {
      muere(`lo que \`${nombre}\` necesita no se pudo ejecutar: ${e.message.split('\n')[0]}`);
    }
    Object.assign(entorno, traidos);
  }

  const nombres = Object.keys(entorno);
  try {
    return new Function(...nombres, `return ${compilarJSX(f)}`)(...nombres.map(n => entorno[n]));
  } catch (e) {
    muere(`\`${nombre}\` no se pudo montar: ${e.message}`);
  }
};

const pintar = (Comp, props, quien) => {
  try { return renderToStaticMarkup(React.createElement(Comp, props)); }
  catch (e) { muere(`${quien} se cayó al pintarse: ${e.message}`); }
};

// Para el menú hace falta que `abierto` sea `true`, y para la pantalla que los
// estados arranquen en su inicial. Son dos `useState` distintos, así que se
// montan por separado.
const MenuConfiguracion = montar('MenuConfiguracion',
  { useState: () => [true, () => {}] });
const Card = montar('Card');
const Tit = montar('Tit');
const SecBtn = montar('SecBtn');
const PantallaMarca = montar('PantallaMarca', { Card, Tit, SecBtn });

const menuDe = (rol) => pintar(MenuConfiguracion,
  { screen: 'obras', setScreen: () => {}, alertasNoLeidas: 0, rol },
  `el menú de Configuración con rol \`${rol}\``);
const pantallaCon = (marca) => pintar(PantallaMarca,
  { usuario: { orgId: 'coatzacoalcos', rol: 'director_obras' }, marca, onMarca: () => {} },
  'la pantalla de Marca');

// ── LOS ROLES, LEÍDOS DE LAS REGLAS ────────────────────────────────────────
const REGLAS = fs.readFileSync(ARCH_RULES, 'utf8');

// El bloque de la regla, primero: comparar contra `esAdminSistemaC/D` sólo
// significa algo si la regla de `config/branding` está escrita con ellas. El
// día que se reescriba con otros roles, esto tiene que decir «no pude medir» en
// vez de afirmar sobre funciones que la regla ya no consulta.
const BLOQUE = (REGLAS.match(
  /match \/orgs\/\{oid\}\/config\/branding \{([\s\S]*?)\n    \}/) || [])[1];
if (!BLOQUE) muere(
  'no se halló el bloque `match /orgs/{oid}/config/branding` en firestore.rules.',
  'Es el anclaje: sin él no se sabe a quién deja escribir la marca.');
const ESCRITURA = (BLOQUE.match(/allow write:([\s\S]*?)(?:\n\s*allow|$)/) || [])[1] || '';
for (const f of ['esAdminSistemaC()', 'esAdminSistemaD()', 'esSoporte()']) {
  if (!ESCRITURA.includes(f)) muere(
    `la regla de \`config/branding\` ya no consulta \`${f}\`.`,
    `dice: ${ESCRITURA.trim().replace(/\s+/g, ' ')}`,
    'Este banco compara la pantalla contra esas funciones. Si la regla cambió de',
    'criterio, lo que hay que actualizar es la comparación, no fingir que midió.');
}

const rolesDeFuncion = (nombre) => {
  const m = REGLAS.match(new RegExp(`function\\s+${nombre}\\s*\\(\\)\\s*\\{([\\s\\S]*?)\\n    \\}`));
  if (!m) return null;
  const l = m[1].match(/rol\(\)\s+in\s+\[([^\]]*)\]/);
  if (!l) return null;
  return l[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
};
const REGLA_C = rolesDeFuncion('esAdminSistemaC');
const REGLA_D = rolesDeFuncion('esAdminSistemaD');
if (!REGLA_C || !REGLA_D) muere(
  'no se pudieron leer las listas de roles de `esAdminSistemaC`/`esAdminSistemaD`.',
  `obtuve: C=${JSON.stringify(REGLA_C)} D=${JSON.stringify(REGLA_D)}`);

// Todos los roles que las reglas nombran, para barrer. `soporte` se saca a
// mano y con motivo: la regla SÍ lo deja escribir la marca, pero `soporte` no
// llega al menú de Configuración —`veConfiguracion` no lo incluye—, así que
// exigirle la opción sería exigir una pantalla a la que no puede entrar. Que no
// llegue se afirma aparte, abajo.
const TODOS_LOS_ROLES = [...new Set([
  ...(REGLAS.match(/rol\(\)\s+in\s+\[([^\]]*)\]/g) || [])
    .flatMap(m => m.match(/'[a-z_]+'/g) || []),
  ...(REGLAS.match(/rol\(\)\s*==\s*'[a-z_]+'/g) || [])
    .flatMap(m => m.match(/'[a-z_]+'/g) || []),
].map(s => s.replace(/'/g, '')))].filter(r => r !== 'soporte').sort();
if (TODOS_LOS_ROLES.length < 12) muere(
  `sólo se leyeron ${TODOS_LOS_ROLES.length} roles de firestore.rules, esperaba más de 12.`,
  'Con la lista casi vacía el barrido de §3 no acota nada.');

// ── LAS RUTAS DEL DOCUMENTO DE MARCA, SACADAS DEL JSX ──────────────────────
const RUTAS_MARCA = (() => {
  const vistas = [];
  traverse(ast(), {
    TemplateLiteral(p) {
      const texto = src.slice(p.node.start, p.node.end);
      if (texto.includes('branding')) vistas.push(texto);
    },
  });
  return vistas;
})();

// ── CONTRAPRUEBA ───────────────────────────────────────────────────────────
if (process.argv.includes('--contraprueba')) {
  if (process.env.ARCHIVO_APP || process.env.ARCHIVO_REGLAS)
    muere('la contraprueba corriendo sobre copias ya mutadas.',
      'Se invocó con ARCHIVO_APP o ARCHIVO_REGLAS puesto: mutaría lo mutado.');

  const MUTACIONES = [
    ['APP', '§1 la reducción deja la medida original tal cual',
      (t) => t.replace('  if (lado <= ladoMax) return { w: a, h };',
        '  if (lado <= ladoMax) return { w: a, h };\n  return { w: a, h };')],
    ['APP', '§2 el tope del logo sube por encima del de un documento',
      (t) => t.replace('const LOGO_TOPE_BYTES = 120 * 1024;',
        'const LOGO_TOPE_BYTES = 4 * 1024 * 1024;')],
    ['APP', '§3 se le ofrece la marca a `gerente_construccion`',
      (t) => t.replace(
        'const ROLES_MARCA_C = ["director_general","director_operaciones","admin_sistema"];',
        'const ROLES_MARCA_C = ["director_general","director_operaciones","admin_sistema","gerente_construccion"];')],
    ['APP', '§4 sin logo se pinta uno de muestra',
      (t) => t.replace(
        '            Esta organización no tiene logo. La app no pinta ninguno en su lugar.',
        '            <img src="data:image/svg+xml,PLACEHOLDER" alt="Logotipo de muestra"/>')],
    ['APP', '§5 el logo se escribe en una ruta que nadie lee',
      (t) => t.replace('      await setDoc(doc(fbDb, `orgs/${usuario.orgId}/config/branding`),',
        '      await setDoc(doc(fbDb, `orgs/${usuario.orgId}/branding`),')],
  ];

  let vistas = 0;
  for (const [cual, nombre, romper] of MUTACIONES) {
    const origen = cual === 'APP' ? ARCH_APP : ARCH_RULES;
    const antes = fs.readFileSync(origen, 'utf8');
    const despues = romper(antes);
    if (despues === antes) {
      console.log(`SIN APLICAR  ${nombre}  ·  el ancla ya no está en ${path.basename(origen)}`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-logo-'));
    const copia = path.join(dir, path.basename(origen));
    fs.writeFileSync(copia, despues);
    const r = noArranco.hijoConPlazo(process.execPath, [__filename], {
      encoding: 'utf8', cwd: RAIZ, timeout: 120000,
      env: { ...process.env, [cual === 'APP' ? 'ARCHIVO_APP' : 'ARCHIVO_REGLAS']: copia },
    });
    const salida = (r.stdout || '') + (r.stderr || '');
    const rojas = (salida.match(/^FALLA/gm) || []).length;
    const vio = r.status === 1 && rojas > 0;
    console.log(`${vio ? `ROJA ×${rojas}`.padEnd(12) : 'NO LA VE    '} ${nombre}`
      + (vio ? '' : `  ·  salió ${r.status}`
        + (r.status === 2 ? ' (el banco se cayó, que no es lo mismo que ver el defecto)' : '')));
    if (vio) vistas++;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('');
  console.log(vistas === MUTACIONES.length
    ? `Las ${MUTACIONES.length} mutaciones se ven.`
    : `Sólo ${vistas} de ${MUTACIONES.length}: el banco no cubre lo que dice.`);
  process.exit(vistas === MUTACIONES.length ? 0 : 1);
}

// ── LAS COMPROBACIONES ─────────────────────────────────────────────────────
console.log('\n── El logo de cada organización entra por la app ──');
console.log(`app: ${path.relative(RAIZ, ARCH_APP)} · reglas: ${path.relative(RAIZ, ARCH_RULES)}\n`);

let fallas = 0, oks = 0;
const ok = (q) => { oks++; console.log(` ok   ${q}`); };
const falla = (q, esp, obt) => {
  fallas++; console.log(`FALLA ${q}`);
  console.log(`        esperaba: ${esp}`);
  console.log(`        obtuvo:   ${obt}`);
};

// §1. La reducción acota el lado largo, conserva la proporción y no agranda.
{
  const CASOS = [
    ['un escudo grande y alto', 1200, 1600],
    ['un logotipo apaisado', 2400, 600],
    ['uno cuadrado enorme', 3000, 3000],
  ];
  const problemas = [];
  for (const [que, ancho, alto] of CASOS) {
    const { w, h } = medidaDelLogo({ ancho, alto });
    const lado = Math.max(w, h);
    if (lado !== LOGO_LADO_MAX)
      problemas.push(`${que} (${ancho}×${alto}) quedó en ${w}×${h}: lado largo ${lado}, no ${LOGO_LADO_MAX}`);
    const desvio = Math.abs((w / h) - (ancho / alto)) / (ancho / alto);
    if (desvio > 0.02)
      problemas.push(`${que} se deformó: ${ancho}:${alto} → ${w}:${h}`);
  }
  // Y los que ya caben se quedan como están.
  for (const [ancho, alto] of [[80, 60], [LOGO_LADO_MAX, LOGO_LADO_MAX], [10, 200]]) {
    const { w, h } = medidaDelLogo({ ancho, alto });
    if (w !== ancho || h !== alto)
      problemas.push(`${ancho}×${alto} ya cabía y se tocó: quedó ${w}×${h}`);
  }
  if (!problemas.length)
    ok(`la reducción acota el lado largo a ${LOGO_LADO_MAX} px, conserva la proporción y no agranda`);
  else falla('la reducción acota, conserva la proporción y no agranda',
    `los ${CASOS.length + 3} casos bien`, problemas.join(' · '));
}

// §2. El tope se mide en bytes del campo y cabe con holgura en un documento.
{
  const chico = 'data:image/png;base64,' + 'A'.repeat(20 * 1024);
  const grande = 'data:image/png;base64,' + 'A'.repeat(LOGO_TOPE_BYTES + 1);
  const vChico = veredictoDelLogo(chico);
  const vGrande = veredictoDelLogo(grande);
  const vVacio = veredictoDelLogo('');
  const problemas = [];
  if (!vChico.cabe) problemas.push(`uno de ${kb(vChico.bytes)} fue rechazado`);
  if (vGrande.cabe) problemas.push(`uno de ${kb(vGrande.bytes)} fue aceptado con tope ${kb(LOGO_TOPE_BYTES)}`);
  if (vGrande.bytes !== grande.length)
    problemas.push(`el peso medido (${vGrande.bytes}) no es la longitud del campo (${grande.length})`);
  if (vVacio.cabe) problemas.push('un campo vacío fue aceptado como logo');
  // La holgura: lo que se guarda en ese documento no es sólo el logo —van
  // `empresa`, `empresaCorta`, `dominio` y lo que venga—, así que el tope del
  // logo tiene que dejar sitio, no rozar el límite.
  if (LOGO_TOPE_BYTES * 2 > TOPE_DOCUMENTO_FIRESTORE)
    problemas.push(`el tope del logo (${kb(LOGO_TOPE_BYTES)}) no deja holgura `
      + `frente al del documento (${kb(TOPE_DOCUMENTO_FIRESTORE)})`);
  if (!problemas.length)
    ok(`el tope son ${kb(LOGO_TOPE_BYTES)} de campo, medidos en bytes, con holgura `
      + `frente a los ${kb(TOPE_DOCUMENTO_FIRESTORE)} del documento`);
  else falla('el tope se mide en bytes del campo y cabe con holgura',
    'los cinco casos bien', problemas.join(' · '));
}

// §3. La pantalla se ofrece exactamente a los roles que la regla deja escribir.
{
  const DEBEN = new Set([...REGLA_C, ...REGLA_D]);
  const ofrecen = [], niegan = [];
  for (const rol of TODOS_LOS_ROLES) {
    const html = veConfiguracion(rol) ? menuDe(rol) : '';
    (/>Marca</.test(html) ? ofrecen : niegan).push(rol);
  }
  const sobran = ofrecen.filter(r => !DEBEN.has(r));
  const faltanR = [...DEBEN].filter(r => !ofrecen.includes(r));
  // Sin esto, un menú que no ofreciera nada a nadie pasaría la mitad de arriba.
  if (!ofrecen.length)
    muere('el menú no ofreció «Marca» a ningún rol de los que la regla deja escribir.',
      `barrí ${TODOS_LOS_ROLES.length} roles y la regla autoriza a ${[...DEBEN].join(', ')}.`,
      'Con cero ofrecimientos, «no se le ofrece a quien no puede» se cumple de vacío.');
  if (!sobran.length && !faltanR.length)
    ok(`el menú ofrece «Marca» a los ${ofrecen.length} roles que la regla deja escribir `
      + `(${ofrecen.join(', ')}) y a ninguno de los otros ${niegan.length}`);
  else falla('el menú ofrece «Marca» exactamente a quien la regla deja escribir',
    `los roles de firestore.rules: ${[...DEBEN].sort().join(', ')}`,
    [sobran.length ? `se le ofrece a quien la regla niega: ${sobran.join(', ')}` : '',
     faltanR.length ? `no se le ofrece a quien la regla permite: ${faltanR.join(', ')}` : '']
      .filter(Boolean).join(' · '));

  // `gerente_construccion` es el caso concreto que motivó la distinción: ve el
  // menú y la regla le niega la escritura. Se afirma aparte para que el día que
  // se pierda la distinción se lea POR QUÉ, y no sólo que un conjunto cambió.
  const g = 'gerente_construccion';
  if (veConfiguracion(g) && !/>Marca</.test(menuDe(g)))
    ok(`\`${g}\` entra a Configuración y no se le ofrece la marca, que es lo que la regla le niega`);
  else falla(`\`${g}\` ve Configuración pero no la marca`,
    'en el menú sí, en la marca no',
    veConfiguracion(g) ? 'se le ofrece «Marca» y la regla se la va a negar'
      : 'ya no entra a Configuración: esta afirmación se quedó sin sitio');

  // Y `soporte`, que la regla SÍ deja escribir, no llega al menú. Es lo que
  // justifica haberlo sacado del barrido de arriba.
  if (!veConfiguracion('soporte'))
    ok('`soporte` no llega a Configuración, y por eso queda fuera del barrido');
  else falla('`soporte` queda fuera del barrido por no llegar al menú',
    '`veConfiguracion("soporte")` falso',
    'ahora sí entra: hay que meterlo al barrido en vez de excluirlo');
}

// §4. Sin logo no se pinta uno de muestra; el hueco se dice.
{
  const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const sin = pantallaCon(null);
  const con = pantallaCon({ empresa: 'H. Ayuntamiento de Coatzacoalcos', logoBlanco: LOGO });
  const problemas = [];
  if (/<img/.test(sin)) problemas.push(
    `sin marca se pintó una imagen: «${(sin.match(/<img[^>]{0,90}/) || [])[0]}»`);
  if (!/no tiene logo/.test(sin)) problemas.push('sin marca no se dice que no hay logo');
  // La otra mitad: con logo sí se pinta, y es EL del documento. Sin esto, una
  // pantalla que nunca pintara nada pasaría la mitad de arriba.
  if (!con.includes(`src="${LOGO}"`)) problemas.push(
    'con marca no se pintó el logo del documento: '
    + `${(con.match(/<img[^>]{0,60}/) || ['ninguna imagen'])[0]}`);
  if (/no tiene logo/.test(con)) problemas.push('con marca sigue diciendo que no hay logo');
  if (!problemas.length)
    ok('sin marca la pantalla dice el hueco y no pinta imagen; con marca pinta la del documento');
  else falla('sin marca se declara el hueco, con marca se pinta la del documento',
    'ninguna imagen y la frase cuando no hay; la imagen del documento cuando sí',
    problemas.join(' · '));
}

// §5. Se escribe donde se lee: una sola ruta para el documento de marca.
{
  const distintas = [...new Set(RUTAS_MARCA)];
  if (RUTAS_MARCA.length >= 2 && distintas.length === 1
      && /config\/branding`$/.test(distintas[0]))
    ok(`las ${RUTAS_MARCA.length} rutas del documento de marca son la misma: ${distintas[0]}`);
  else falla('el logo se escribe en la misma ruta que se lee',
    'al menos dos usos de una sola ruta, terminada en `config/branding`',
    RUTAS_MARCA.length < 2
      ? `sólo hay ${RUTAS_MARCA.length} ruta(s) con «branding»: o la lectura o la `
        + 'escritura dejó de armarse así, y no se puede comparar'
      : `hay ${distintas.length} rutas distintas: ${distintas.join('  ·  ')}`);
}

console.log('');
if (fallas) {
  console.log('Un logo que se guarda donde nadie lo lee, o un botón que acaba en');
  console.log('`permission-denied`, son la misma clase de defecto: la pantalla');
  console.log('promete algo que la base no va a cumplir.');
  console.log('');
}
console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
process.exit(fallas > 0 ? 1 : 0);
