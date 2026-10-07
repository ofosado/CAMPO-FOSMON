#!/usr/bin/env node
// Prueba: las obras NUEVAS nacen en volumen; las que nunca eligieron modo
// siguen leyéndose en porcentaje; y volver a porcentaje lo autoriza la
// dirección.
//
// POR QUÉ ESTA PRUEBA, Y POR QUÉ ES LA MITAD MÁS IMPORTANTE DEL CAMBIO.
//
// «Que el default sea volumen» se puede implementar de dos maneras que se
// parecen muchísimo y que no son lo mismo ni de lejos:
//
//   (a) ESCRIBIR `modoAvance: "volumen"` en la obra nueva. Afecta sólo a lo que
//       se cree de hoy en adelante.
//   (b) Mover el RESPALDO `obra.modoAvance || "porcentaje"` a `|| "volumen"`.
//       Eso reinterpreta el dinero ejecutado de TODAS las obras que nunca
//       eligieron modo, de golpe, sin que nadie toque nada, sin confirmación y
//       sin quedar en la bitácora. En volumen manda `cantEjec × pu`; en
//       porcentaje manda `(a/100) × imp`. No son la misma cifra, y es la cifra
//       con la que se estima y se cobra.
//
// (b) es el cambio de definición silencioso que no se hace. Y es exactamente lo
// que haría quien mañana lea «el default es volumen» y busque la línea más
// corta que lo consigue. Esta prueba existe para que esa línea se ponga roja.
//
// La tercera parte es la autoridad: porcentaje sigue existiendo —a tanto alzado
// se captura así— pero deja de ser una casilla que cualquiera pica. Se
// comprueba ejecutando el guardia de verdad, no leyendo la lista de roles.
//
// Lo que se afirma es CONDUCTA: el DINERO que sale de cada combinación, y si el
// guardia abre o no el diálogo. No se afirma que exista ningún nombre (P3).
//
// Uso:  node scripts/prueba-modo-avance-default.cjs [archivo.jsx]
//       node scripts/prueba-modo-avance-default.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const noArranco = require('./no-arranco.cjs');
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
const MXN = n => '$' + Math.round(n || 0).toLocaleString('es-MX');

// ── Extracción del código real ─────────────────────────────────────────────
const NECESARIOS = [
  'importeCatalogoPartida', 'importeEjecutadoPartida', 'desgloseEjecutado',
  'MODO_AVANCE_NUEVA_OBRA', 'ROLES_HABILITAN_PORCENTAJE', 'puedeElegirPorcentaje',
  'diagnosticoCambioModo',
  // El id de la obra nueva. No se mide aquí —es de la prueba del alta— pero el
  // formulario inicial lo invoca, así que sin él el objeto no se puede evaluar.
  'nuevoIdObra',
];

const trozos = [];
const vistos = new Set();
const rango = {};
// El formulario inicial de la obra nueva. Se localiza por lo que CONTIENE —los
// campos del contrato—, no por el nombre de la pantalla: lo que importa es el
// objeto con el que nace una obra, viva donde viva.
let formInicial = null;
// El guardia del cambio de modo, y los sitios donde el código decide el modo de
// una obra a partir del documento. Los segundos se buscan por su FORMA, que es
// justo lo que un cambio de default tocaría.
let guardia = null;
const respaldos = [];

traverse(ast, {
  VariableDeclaration(p) {
    if (p.parent.type !== 'Program') return;
    const d = p.node.declarations[0];
    const n = d?.id?.name;
    if (n && NECESARIOS.includes(n) && !vistos.has(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
      if (d.init) rango[n] = [d.init.start, d.init.end];
    }
  },
  FunctionDeclaration(p) {
    const n = p.node.id?.name;
    if (p.parent.type === 'Program' && n && NECESARIOS.includes(n) && !vistos.has(n)) {
      trozos.push(src.slice(p.node.start, p.node.end));
      vistos.add(n);
    }
    if (n === 'pedirCambioModo' && !guardia) guardia = src.slice(p.node.start, p.node.end);
  },
  ObjectExpression(p) {
    if (formInicial) return;
    const claves = p.node.properties
      .filter(x => x.type === 'ObjectProperty' && x.key?.name).map(x => x.key.name);
    // El estado inicial del alta: trae el presupuesto, los tres porcentajes de
    // la obra y las fechas del plazo. Ningún otro objeto del archivo los junta.
    if (['presupuesto', 'pctAnticipo', 'pctFondoGar', 'inicio', 'fin']
        .every(k => claves.includes(k))) {
      formInicial = src.slice(p.node.start, p.node.end);
    }
  },
  // `obra.modoAvance || "porcentaje"` y `s.modoAvance || "porcentaje"`: el
  // RESPALDO. Se recogen todos los que haya, porque el riesgo no es que alguien
  // cambie uno, es que los cambie todos de una pasada con buscar y reemplazar.
  LogicalExpression(p) {
    if (p.node.operator !== '||') return;
    const izq = p.node.left, der = p.node.right;
    if (izq.type !== 'MemberExpression' || izq.property?.name !== 'modoAvance') return;
    if (der.type !== 'StringLiteral') return;
    respaldos.push({ fuente: src.slice(p.node.start, p.node.end), valor: der.value,
      // Todo lo que sigue al objeto: `.modoAvance || "porcentaje"`. Con esto se
      // vuelve a armar el respaldo como función EJECUTABLE sobre cualquier obra,
      // sin tocar texto. Leer el literal diría que la línea no cambió; ejecutarlo
      // dice qué modo le toca de verdad a una obra que nunca eligió.
      resto: src.slice(izq.object.end, p.node.end),
      linea: src.slice(0, p.node.start).split('\n').length });
  },
});

const faltan = NECESARIOS.filter(n => !vistos.has(n));
if (!formInicial) faltan.push('el formulario inicial del alta de obra');
if (!guardia)     faltan.push('el guardia del cambio de modo de captura');
if (!respaldos.length) faltan.push('el respaldo `modoAvance || "…"`');
if (faltan.length) noArranco(faltan, path.basename(archivo));

// ── Contraprueba ──────────────────────────────────────────────────────────
// Se hace EXACTAMENTE lo que haría quien lea «el default es volumen» y busque
// la línea más corta: mover el respaldo. El nombre no cambia, la constante del
// alta sigue diciendo volumen, el guardia sigue en su sitio y la pantalla se ve
// idéntica. Lo único que cambia es que el dinero ejecutado de todas las obras
// que nunca eligieron modo pasa a calcularse de otra forma.
if (process.argv.includes('--contraprueba')) {
  let out = src, desp = 0;
  // De atrás hacia adelante, para que reemplazar uno no desfase a los demás.
  for (const r of [...respaldos].reverse()) {
    const i = out.indexOf(r.fuente);
    if (i < 0) continue;
    out = out.slice(0, i) + r.fuente.replace(/"porcentaje"|'porcentaje'/, '"volumen"') + out.slice(i + r.fuente.length);
    desp++;
  }
  const mutado = path.join(require('os').tmpdir(), 'contraprueba-modo-default.jsx');
  fs.writeFileSync(mutado, out);
  console.log(`Contraprueba: el respaldo pasa a "volumen" en ${desp} sitio(s). Las obras`);
  console.log('que nunca eligieron modo cambian de significado sin que nadie las toque.\n');
  const r = require('child_process').spawnSync(process.execPath, [__filename, mutado],
    { encoding: 'utf8' });
  const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
  console.log(r.stdout.replace(/^/gm, '  │ '));
  console.log(rojas > 0
    ? `Contraprueba correcta: ${rojas} comprobación(es) se cayeron al mover el respaldo.`
    : 'CONTRAPRUEBA EN ROJO: mover el respaldo no tumbó nada. La prueba no sirve.');
  process.exit(rojas > 0 ? 0 : 1);
}

const app = new Function(`"use strict";\n${trozos.join('\n')}\n;return {${[...vistos].join(',')}};`)();
const { desgloseEjecutado, MODO_AVANCE_NUEVA_OBRA, puedeElegirPorcentaje,
  diagnosticoCambioModo } = app;
// El formulario se evalúa con las constantes del módulo a la vista: si el alta
// escribe el modo por constante en vez de a mano, hay que poder resolverla.
// Y se evalúa para los DOS lados. Desde 2026-10-07 una dependencia también da
// de alta obras, y el inicializador se ramifica por `dep`: evaluar un solo lado
// dejaría al otro naciendo en el modo que fuera sin que nadie lo mirara.
const formDe = dep => new Function(...[...vistos], 'dep',
  `"use strict"; return (${formInicial});`)(...[...vistos].map(n => app[n]), dep);
const form = formDe(false);
const formDep = formDe(true);

console.log(`\nArchivo:   ${path.relative(raiz, archivo)}`);
console.log(`Respaldos «modoAvance || …» encontrados: ${respaldos.length}\n`);

// ══════════════════════════════════════════════════════════════════════════
console.log('1. El dinero de las dos lecturas NO es el mismo, que es por qué esto importa\n');

// Una partida donde las dos lecturas discrepan a propósito, y discrepan como
// discrepan en obra: el catálogo pedía 1,000 m³ a $1,200 y se ejecutaron 1,400,
// mientras el supervisor dejó el porcentaje en 90 porque lo llevaba a ojo.
const CATALOGO = [
  { sec: '1.1', cant: 1000, pu: 1200, imp: 1200000, a: 90, cantEjec: 1400 },
  { sec: '1.2', cant: 500,  pu: 800,  imp: 400000,  a: 40, cantEjec: 150  },
];
const comoVolumen   = desgloseEjecutado(CATALOGO, true).total;
const comoPorcentaje = desgloseEjecutado(CATALOGO, false).total;
console.log(`       volumen: ${MXN(comoVolumen)}   ·   porcentaje: ${MXN(comoPorcentaje)}`);
check(Math.abs(comoVolumen - comoPorcentaje) > 1,
  'leer la misma obra en volumen o en porcentaje da cifras distintas',
  `${MXN(comoVolumen)} vs ${MXN(comoPorcentaje)} · difieren ${MXN(Math.abs(comoVolumen - comoPorcentaje))}`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n2. La obra NUEVA nace en volumen, y lo trae ESCRITO\n');

check(form.modoAvance !== undefined,
  'el alta escribe el modo en el documento, no lo deja implícito',
  `modoAvance: ${JSON.stringify(form.modoAvance)}`);
check(form.modoAvance === 'volumen' && MODO_AVANCE_NUEVA_OBRA === 'volumen',
  'y el modo que escribe es volumen', String(form.modoAvance));
check(formDep.modoAvance === 'volumen',
  'y la obra que da de alta una dependencia nace igual, no en otro modo',
  String(formDep.modoAvance));

// Lo que de verdad importa: que el dinero de una obra recién creada salga de
// `cantEjec × pu`. La constante podría decir «volumen» y el alta no usarla.
const nueva = { ...form, id: 'NUEVA-1' };

// EL RESPALDO DE VERDAD, EJECUTADO, NO UNA COPIA ESCRITA AQUÍ. Si esta línea
// dijera `o.modoAvance || 'porcentaje'` a mano, la prueba estaría comprobándose
// a sí misma: mover el respaldo en App.jsx no la movería, y el cambio de
// definición silencioso —el único riesgo serio de todo esto— pasaría en verde.
const lectores = respaldos.map(r =>
  ({ ...r, leer: new Function('o', `"use strict"; return (o${r.resto});`) }));
const modoDeObra = o => lectores[0].leer(o) === 'volumen';
check(modoDeObra(nueva) === true && desgloseEjecutado(CATALOGO, modoDeObra(nueva)).total === comoVolumen,
  'una obra recién creada cobra por el volumen ejecutado',
  MXN(desgloseEjecutado(CATALOGO, modoDeObra(nueva)).total));

// ══════════════════════════════════════════════════════════════════════════
console.log('\n3. La obra que NUNCA eligió modo no cambia de significado\n');

// Es el renglón que protege la producción. Si esto se cae, el dinero ejecutado
// de las obras viejas se recalculó sin que nadie lo pidiera.
const vieja = { id: '0112', nombre: 'obra de antes', presupuesto: 1600000 };
check(modoDeObra(vieja) === false,
  'una obra sin `modoAvance` en el documento se sigue leyendo en PORCENTAJE');
check(desgloseEjecutado(CATALOGO, modoDeObra(vieja)).total === comoPorcentaje,
  'y su dinero ejecutado sigue siendo el de antes, al peso',
  MXN(desgloseEjecutado(CATALOGO, modoDeObra(vieja)).total));
// Y no basta con el primero: el riesgo no es que alguien mueva un respaldo, es
// que los mueva TODOS de una pasada con buscar y reemplazar. Se ejecutan los
// que haya, cada uno contra la obra sin modo, y todos tienen que decir lo mismo.
const leidos = lectores.map(r => r.leer(vieja));
check(leidos.every(v => v === 'porcentaje'),
  `los ${lectores.length} respaldos del archivo le dan PORCENTAJE a la obra sin modo`,
  [...new Set(leidos)].join(', '));

// Y el camino largo: una obra vieja y una nueva, con el MISMO catálogo, tienen
// que dar cifras distintas. Si dieran la misma, el default no se movió o el
// respaldo sí — y los dos casos son defectos opuestos.
check(desgloseEjecutado(CATALOGO, modoDeObra(nueva)).total
      !== desgloseEjecutado(CATALOGO, modoDeObra(vieja)).total,
  'con el mismo catálogo, la obra nueva y la vieja NO cobran lo mismo: el cambio llegó a las nuevas y sólo a ellas');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n4. Volver a porcentaje lo autoriza la dirección\n');

// El guardia se ejecuta de verdad. Lo que se mira es si abre el diálogo de
// confirmación, que es lo único que lleva al cambio.
const correrGuardia = (rol, destino, actual = 'volumen') => {
  let abrio = null, bloqueo = null;
  new Function('obra', 'subs', 'subsCargados', 'rol',
    'diagnosticoCambioModo', 'puedeElegirPorcentaje', 'setCambioModo', 'setBloqueoModo',
    `"use strict"; ${guardia}; pedirCambioModo(${JSON.stringify(destino)});`)(
    { id: 'X', modoAvance: actual }, CATALOGO, true, rol,
    diagnosticoCambioModo, puedeElegirPorcentaje,
    v => { abrio = v; }, v => { bloqueo = v; });
  return { abrio, bloqueo };
};

const DIRECCION = ['director_general', 'director_operaciones', 'admin_sistema',
                   'director_obras', 'subdirector'];
for (const rol of DIRECCION)
  check(correrGuardia(rol, 'porcentaje').abrio !== null,
    `${rol} SÍ puede devolver la obra a porcentaje`);

const RESTO = ['gerente_construccion', 'superintendente', 'residente',
               'administrador_obra', 'auditor', 'jefe_supervision',
               'supervisor_obra', 'administrativo', 'contralor'];
for (const rol of RESTO)
  check(correrGuardia(rol, 'porcentaje').abrio === null,
    `${rol} no la devuelve a porcentaje: es excepción autorizada`);

// LO QUE IMPORTA del otro lado: el candado es de una sola dirección. Pasar A
// volumen es el camino al que el sistema quiere llegar y no se pide permiso
// para eso; si el candado fuera simétrico, una obra mal dada de alta se
// quedaría atorada esperando a un director.
for (const rol of ['residente', 'supervisor_obra'])
  check(correrGuardia(rol, 'volumen', 'porcentaje').abrio !== null,
    `${rol} SÍ puede pasar la obra a volumen, sin pedirle permiso a nadie`);

// Y el que no puede elegir porcentaje no se queda sin trabajar: una obra que YA
// está en porcentaje la sigue capturando igual. El candado es sobre el cambio,
// no sobre la obra.
check(correrGuardia('residente', 'porcentaje', 'porcentaje').abrio === null
      && correrGuardia('residente', 'porcentaje', 'porcentaje').bloqueo === null,
  'y una obra que ya está en porcentaje no le estalla en la cara: simplemente no se mueve');

// ══════════════════════════════════════════════════════════════════════════
console.log('');
if (fallas) {
  console.log(`${fallas} comprobación(es) en rojo.`);
  process.exit(1);
}
console.log('Todas las comprobaciones en verde.');
