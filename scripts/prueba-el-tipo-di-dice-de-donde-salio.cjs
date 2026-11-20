#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// «N DIRECTOS · M INDIRECTOS» SÓLO SALE SI LO DIJO EL EXCEL
// ════════════════════════════════════════════════════════════════════════════
//
// EL DEFECTO. El importador de nómina tiene dos caminos para el tipo de un
// trabajador: la columna «Tipo (D/I)» del archivo, o una inferencia a partir de
// doce palabras del puesto —con caída a 'D' por omisión para lo que no casa—.
// Los dos acababan en el mismo campo `tipo`, sin rastro de cuál había sido, y
// cinco sitios de la pantalla publicaban el desglose como un hecho.
//
// MEDIDO EN PRODUCCIÓN el 2026-11-19 (`scripts/medir-si-directo-o-indirecto-es-
// dato-o-adivinanza.cjs`, sólo lectura): de 67 semanas con listado, 40 traen
// evidencia propia de que la columna existió, 21 son semanas donde las doce
// palabras predicen el tipo de TODOS siendo muchos —que una columna escrita a
// mano coincida 143 de 143 veces con doce palabras no es plausible— y 6 más no
// se pueden distinguir. Y no hay frontera en el tiempo que sirva de regla: las
// sospechosas arrancan en la S36 de 2026 en cinco obras, pero después de la S36
// todavía hay 22 semanas con columna, y la 0114 tiene la S37 CON ella entre la
// S36 y la S38 SIN ella. La columna va y viene por archivo.
//
// De ahí la forma del arreglo, que es la parte que este banco vigila: la
// procedencia no se adivina al leer ni se deduce de una fecha de corte. La
// anota el importador, carga por carga, en dos conteos —cuántas filas lo dijo
// la columna y cuántas las palabras—, y quien publica el desglose pregunta.
//
// LO QUE SE AFIRMA AQUÍ, que es conducta y no la existencia de un símbolo:
//
//   1. La regla del tipo dice de dónde salió, y la lista de palabras es una.
//   2. El importador cuenta las dos procedencias, y cuenta las filas que
//      QUEDAN en la carga, no las que leyó.
//   3. Una semana publica su desglose sólo si TODAS sus partes declaran que
//      salió de la columna; si alguna fila se infirió, se calla.
//   4. Callarse no es decir cero: la plantilla sigue publicándose.
//   5. El consolidado del portafolio no mete como cero a la obra que se calla,
//      y dice de cuántas obras habla su desglose.
//
// Los puntos 3 y 5 son los que estuvieron a punto de salir mal: `t.dir + p.dir`
// con `p.dir` nulo da el número de antes, y entonces la obra entra al desglose
// como si no tuviera un solo indirecto. Es el #116 una capa más abajo.
//
// CONTRAPRUEBAS — corridas el 2026-11-19, las siete en ROJO (1), ninguna en
// NO ARRANCÓ (2). Entre paréntesis, cuántas aserciones mordió cada una:
//   · la procedencia se da por buena siempre                     → rojo (11)
//   · basta que UNA parte declare, no todas                      → rojo  (1)
//   · una fila adivinada no estorba: se publica igual            → rojo  (3)
//   · la inferencia se marca como si la hubiera dicho la columna → rojo  (4)
//   · el importador cuenta ANTES del filtro de filas             → rojo  (2)
//   · el desglose se publica sin preguntar la procedencia        → rojo (12)
//   · la obra que se calla entra al consolidado sumando cero     → rojo  (1)
//
// LA ÚLTIMA SOBREVIVIÓ EN EL PRIMER INTENTO, y el hueco que destapó valía más
// que la mutación: cambiar «¿ALGUNA parte adivinó?» por «¿TODAS adivinaron?»
// da lo mismo en una semana de una sola parte, y todos mis casos eran de una
// parte. Faltaba el real —una semana rayada en dos archivos, uno con la columna
// completa y al otro le faltan celdas—, donde el archivo bueno no limpia al
// malo. Se añadió ese caso y entonces la mutación cae.
//
// Uso:  node scripts/prueba-el-tipo-di-dice-de-donde-salio.cjs
//       node scripts/prueba-el-tipo-di-dice-de-donde-salio.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const CP = require('./contraprueba.cjs');
const { deArchivo, fuenteDe, cierreDe } = require('./extraer-de-app.cjs');

// El archivo a examinar se puede sustituir: así la contraprueba apunta el banco
// a un mutante en vez del original.
const ARCHIVO = process.env.ARCHIVO_APP
  || process.argv.find(a => a.endsWith('.jsx'))
  || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(ARCHIVO, 'utf8');
const callado = !!process.env.CALLADO;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};
const log = (...a) => { if (!callado) console.log(...a); };

// ── Extracción ──────────────────────────────────────────────────────────────
// Por `deArchivo`, que resuelve el grafo: pedir `personalDeSemana` trae
// `procedenciaDI` sin que este banco lo nombre.
let api;
try {
  api = deArchivo(ARCHIVO, 'TAGS_INDIRECTO', 'tipoDeTrabajador', 'procedenciaDI',
    'personalDeSemana', 'semanasDeNomina', 'plantillaDeObra');
} catch (e) {
  noArranco([String(e.message || e)], path.basename(ARCHIVO));
}
const { TAGS_INDIRECTO, tipoDeTrabajador, procedenciaDI,
        personalDeSemana, semanasDeNomina, plantillaDeObra } = api;

// El bucle del importador vive DENTRO de `parsearNomina`, así que no se pide
// por nombre: se saca por dónde vive. Lo que se ejercita es el parseo completo
// —entra una matriz como la que da el Excel y salen los trabajadores con sus
// dos conteos—, que es la única forma de afirmar que cuenta las filas que
// quedan y no las que leyó.
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;
let parsearSrc = null;
traverse(parse(src, { sourceType: 'module', plugins: ['jsx'] }), {
  FunctionDeclaration(p) {
    if (p.node.id?.name !== 'parsearNomina') return;
    parsearSrc = src.slice(p.node.start, p.node.end);
  },
});
if (!parsearSrc) noArranco(['la función `parsearNomina` del importador'],
  path.basename(ARCHIVO));

// ── Mutaciones ──────────────────────────────────────────────────────────────
// Cada una es una forma concreta de volver a publicar una adivinanza como dato.
const MUTANTES = [
  { titulo: 'la procedencia se da por buena siempre',
    cambios: [['  return partes.some(p => p.tipoDePuesto > 0) ? \'puesto\' : \'columna\';',
               '  return \'columna\';']] },
  { titulo: 'basta que UNA parte declare su procedencia, no todas',
    cambios: [['  if (!partes.every(p => typeof p?.tipoDeColumna === \'number\'',
               '  if (!partes.some(p => typeof p?.tipoDeColumna === \'number\'']] },
  { titulo: 'una fila adivinada no estorba: se publica el desglose igual',
    cambios: [['partes.some(p => p.tipoDePuesto > 0) ? \'puesto\' : \'columna\'',
               'partes.every(p => p.tipoDePuesto > 0) ? \'puesto\' : \'columna\'']] },
  { titulo: 'la inferencia por puesto se marca como si la hubiera dicho la columna',
    cambios: [['  return { tipo: TAGS_INDIRECTO.some(t => catUp.includes(t)) ? \'I\' : \'D\', de: \'puesto\' };',
               '  return { tipo: TAGS_INDIRECTO.some(t => catUp.includes(t)) ? \'I\' : \'D\', de: \'columna\' };']] },
  { titulo: 'el importador cuenta las filas que LEYÓ, no las que quedaron',
    cambios: [
      ['    if (tipoDe === \'columna\') nDeColumna++; else nDePuesto++;\n\n', ''],
      ['    // Filtro final\n    if (total === 0 && salSem === 0 && dias === 0) return;',
       '    if (tipoDe === \'columna\') nDeColumna++; else nDePuesto++;\n' +
       '    // Filtro final\n    if (total === 0 && salSem === 0 && dias === 0) return;'],
    ] },
  { titulo: 'el desglose se publica sin preguntar la procedencia',
    cambios: [['  const conDI = (dir, ind, fuente) => diDe === \'columna\'',
               '  const conDI = (dir, ind, fuente) => true']] },
  { titulo: 'la obra que se calla entra al consolidado sumando cero',
    cambios: [['      obrasConDI:  t.obrasConDI + (p.dir === null ? 0 : 1),',
               '      obrasConDI:  t.obrasConDI + 1,']] },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  // Gratis y en cada `npm test`: un anclaje que se queda viejo es el rojo de
  // hoy, no el hallazgo de dentro de seis meses.
  CP.exigirAnclajes(MUTANTES, src, { archivo: ARCHIVO, callado });
}
if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src, archivo: ARCHIVO,
    prefijo: 'tipo-di-' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

// ── Los datos ───────────────────────────────────────────────────────────────
// Una fila de Excel como la que lee el importador. La cabecera lleva los
// nombres que el archivo real trae.
const CAB = ['NOMBRE', 'CATEGORIA', 'Tipo (D/I)', 'S. DIARIO', 'D.T.', 'TOTAL'];
const SIN_TIPO = ['NOMBRE', 'CATEGORIA', 'S. DIARIO', 'D.T.', 'TOTAL'];
const fila = (nombre, cat, tipo, sal = 1000, dias = 6) =>
  [nombre, cat, tipo, sal, dias, sal * dias];
const filaSinTipo = (nombre, cat, sal = 1000, dias = 6) =>
  [nombre, cat, sal, dias, sal * dias];

// El importador, ejecutable. Se le da el cuerpo que necesita por `cierreDe`,
// que lee los nombres libres del propio trozo: así este banco no mantiene una
// copia del grafo de dependencias del importador.
const parsear = (matriz) => {
  const cuerpo = cierreDe(parsearSrc, { archivo: ARCHIVO, excluir: ['parsearNomina'] });
  const f = new Function(`"use strict";\n${cuerpo}\n${parsearSrc}\nreturn parsearNomina;`)();
  return f(matriz);
};

// ══════════════════════════════════════════════════════════════════════════
console.log('1. La regla del tipo dice de dónde salió, y la lista de palabras es una');

const porColumna = tipoDeTrabajador('I', 'PEON', '');
check(porColumna.tipo === 'I' && porColumna.de === 'columna',
  'un «I» en la columna es indirecto, y consta que lo dijo la columna',
  `${porColumna.tipo} · ${porColumna.de}`);
// Un puesto de peón que la columna llama indirecto: la columna manda. Es el
// caso que prueba que el tipo NO se recalcula de las palabras cuando hay dato.
check(tipoDeTrabajador('I', 'PEON', '').tipo === 'I',
  'y la columna gana sobre el puesto: un PEON marcado I es indirecto');
check(tipoDeTrabajador('D', 'INGENIERO', '').tipo === 'D'
   && tipoDeTrabajador('D', 'INGENIERO', '').de === 'columna',
  'y al revés: un INGENIERO marcado D es directo, porque lo dijo la columna');

const porPuesto = tipoDeTrabajador('', 'INGENIERO RESIDENTE', '');
check(porPuesto.tipo === 'I' && porPuesto.de === 'puesto',
  'sin columna, el puesto decide — y consta que fue el puesto',
  `${porPuesto.tipo} · ${porPuesto.de}`);
const porOmision = tipoDeTrabajador('', 'PEON', '');
check(porOmision.tipo === 'D' && porOmision.de === 'puesto',
  'y lo que no casa con ninguna palabra cae a directo: eso TAMBIÉN es inferencia',
  `${porOmision.tipo} · ${porOmision.de}`);
check(TAGS_INDIRECTO.length === 12 && TAGS_INDIRECTO.includes('GERENTE'),
  'las doce palabras viven en un solo sitio, no copiadas en el importador',
  `${TAGS_INDIRECTO.length} palabras`);
// Y la lista no está tecleada en el importador: si lo estuviera, podría
// separarse de ésta sin que nada se enterara.
check(!/const tagsInd\s*=\s*\[/.test(src),
  'el importador ya no lleva su propia copia de la lista');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n2. El importador cuenta las dos procedencias, de las filas que quedan');

const conCol = parsear([CAB,
  fila('JUAN PEREZ', 'PEON', 'D'),
  fila('ANA LOPEZ', 'INGENIERO', 'I'),
  fila('LUIS GOMEZ', 'OFICIAL', 'D')]);
check(conCol.trabajadores.length === 3,
  'tres filas con columna dan tres trabajadores', String(conCol.trabajadores.length));
check(conCol.tipoDeColumna === 3 && conCol.tipoDePuesto === 0,
  'y la carga declara que de las tres lo dijo la columna',
  `${conCol.tipoDeColumna} de columna · ${conCol.tipoDePuesto} de puesto`);

const sinCol = parsear([SIN_TIPO,
  filaSinTipo('JUAN PEREZ', 'PEON'),
  filaSinTipo('ANA LOPEZ', 'INGENIERO'),
  filaSinTipo('LUIS GOMEZ', 'OFICIAL')]);
check(sinCol.tipoDeColumna === 0 && sinCol.tipoDePuesto === 3,
  'un archivo SIN la columna declara que las tres se adivinaron',
  `${sinCol.tipoDeColumna} de columna · ${sinCol.tipoDePuesto} de puesto`);
check(sinCol.trabajadores.filter(t => t.tipo === 'I').length === 1,
  'y el tipo se sigue infiriendo: el INGENIERO sale indirecto');

// LA COLUMNA PRESENTE CON CELDAS VACÍAS: el caso que una bandera «traía
// columna» no distingue, y la razón de que esto sean dos conteos. El archivo
// trae la columna y aun así parte de las filas se adivinan.
const mezcla = parsear([CAB,
  fila('JUAN PEREZ', 'PEON', 'D'),
  fila('ANA LOPEZ', 'INGENIERO', ''),
  fila('LUIS GOMEZ', 'GERENTE', 'I')]);
check(mezcla.tipoDeColumna === 2 && mezcla.tipoDePuesto === 1,
  'con la columna presente pero una celda vacía, los conteos lo dicen: 2 y 1',
  `${mezcla.tipoDeColumna} de columna · ${mezcla.tipoDePuesto} de puesto`);

// Y las filas que el importador DESCARTA no cuentan. Una fila sin importe ni
// salario ni días se tira después de calcularle el tipo; contándola, la carga
// declararía procedencia de gente que no está en ella.
const conDescartada = parsear([CAB,
  fila('JUAN PEREZ', 'PEON', 'D'),
  ['FILA VACIA', 'PEON', '', 0, 0, 0],
  fila('LUIS GOMEZ', 'OFICIAL', 'D')]);
check(conDescartada.trabajadores.length === 2,
  'la fila sin importe ni días se descarta', String(conDescartada.trabajadores.length));
check(conDescartada.tipoDeColumna + conDescartada.tipoDePuesto === 2,
  'y los conteos suman DOS, no tres: describen la carga, no la lectura',
  `${conDescartada.tipoDeColumna} + ${conDescartada.tipoDePuesto}`);
check(conDescartada.tipoDePuesto === 0,
  'en particular la descartada no mete un «adivinado» que callaría el desglose',
  String(conDescartada.tipoDePuesto));

// ══════════════════════════════════════════════════════════════════════════
console.log('\n3. Una semana publica su desglose sólo si consta que lo dijo el Excel');

const SEM = { semana: 'Semana 38', fecha: '21/9/2026', archivo: 'A.xlsx' };
const sem = (extra, trabs) => semanasDeNomina([{ ...SEM, ...extra,
  trabajadores: trabs, totalNomina: 100 }])[0];
const TRES = [{ tipo: 'D' }, { tipo: 'D' }, { tipo: 'I' }];

const declarada = sem({ tipoDeColumna: 3, tipoDePuesto: 0 }, TRES);
check(procedenciaDI(declarada) === 'columna',
  'declarando que las tres salieron de la columna, la procedencia es la columna',
  String(procedenciaDI(declarada)));
const pDec = personalDeSemana(declarada);
check(pDec.total === 3 && pDec.dir === 2 && pDec.ind === 1,
  'y entonces SÍ se publica: 2 directos y 1 indirecto',
  `${pDec.total} · ${pDec.dir}D · ${pDec.ind}I`);

const adivinada = sem({ tipoDeColumna: 0, tipoDePuesto: 3 }, TRES);
check(procedenciaDI(adivinada) === 'puesto',
  'declarando que las tres se adivinaron, la procedencia es el puesto',
  String(procedenciaDI(adivinada)));
const pAdi = personalDeSemana(adivinada);
check(pAdi.dir === null && pAdi.ind === null,
  'y el desglose NO se publica', `${pAdi.dir}D · ${pAdi.ind}I`);

// UNA SOLA FILA ADIVINADA BASTA. Publicar las dos que sí se contaron daría un
// desglose que no suma el total, y nadie podría saber por qué.
const casi = sem({ tipoDeColumna: 2, tipoDePuesto: 1 }, TRES);
check(procedenciaDI(casi) === 'puesto' && personalDeSemana(casi).dir === null,
  'con DOS de columna y una adivinada tampoco se publica: no es un desglose a medias',
  `${procedenciaDI(casi)} · ${personalDeSemana(casi).dir}D`);

const muda = sem({}, TRES);
check(procedenciaDI(muda) === null,
  'una carga que no declara nada no dice «columna»: dice que no se sabe',
  String(procedenciaDI(muda)));
check(personalDeSemana(muda).dir === null,
  'y sin saberlo tampoco se publica — así están las 67 semanas ya cargadas');

// LAS DOS PARTES TIENEN QUE DECLARAR. Con una sola, la procedencia describe la
// mitad de la gente que el desglose cuenta.
const mitad = semanasDeNomina([
  { ...SEM, tipoDeColumna: 2, tipoDePuesto: 0, trabajadores: [{ tipo: 'D' }, { tipo: 'D' }] },
  { ...SEM, archivo: 'B.xlsx', trabajadores: [{ tipo: 'I' }] },
])[0];
check((mitad.partes || []).length === 2, 'la semana llegó en dos archivos',
  String((mitad.partes || []).length));
check(procedenciaDI(mitad) === null && personalDeSemana(mitad).dir === null,
  'si sólo una parte declara, la semana no publica desglose',
  `${procedenciaDI(mitad)} · ${personalDeSemana(mitad).dir}D`);
const ambas = semanasDeNomina([
  { ...SEM, tipoDeColumna: 2, tipoDePuesto: 0, trabajadores: [{ tipo: 'D' }, { tipo: 'D' }] },
  { ...SEM, archivo: 'B.xlsx', tipoDeColumna: 1, tipoDePuesto: 0, trabajadores: [{ tipo: 'I' }] },
])[0];
check(procedenciaDI(ambas) === 'columna' && personalDeSemana(ambas).dir === 2,
  'y declarando las dos, la semana unida sí lo publica',
  `${procedenciaDI(ambas)} · ${personalDeSemana(ambas).dir}D`);

// Y BASTA QUE UNA DE LAS DOS PARTES TRAIGA UNA FILA ADIVINADA. Es el caso real
// de una semana rayada en dos archivos donde uno trae la columna completa y al
// otro le faltan celdas: el archivo bueno no limpia al malo. Sin este caso la
// pregunta se podía escribir «¿TODAS las partes adivinaron?» —que para una
// semana de una sola parte da lo mismo— y nadie se enteraba.
const unaParteAdivina = semanasDeNomina([
  { ...SEM, tipoDeColumna: 2, tipoDePuesto: 0, trabajadores: [{ tipo: 'D' }, { tipo: 'D' }] },
  { ...SEM, archivo: 'B.xlsx', tipoDeColumna: 0, tipoDePuesto: 1, trabajadores: [{ tipo: 'I' }] },
])[0];
check(procedenciaDI(unaParteAdivina) === 'puesto',
  'si UNA de las dos partes trae una fila adivinada, la semana entera se calla',
  String(procedenciaDI(unaParteAdivina)));
check(personalDeSemana(unaParteAdivina).dir === null
   && personalDeSemana(unaParteAdivina).total === 3,
  'y su gente sigue contada: 3 personas, sin desglose',
  `${personalDeSemana(unaParteAdivina).total} · ${personalDeSemana(unaParteAdivina).dir}D`);
check(/no trae la columna Tipo \(D\/I\)/.test(plantillaDeObra([unaParteAdivina]).sub),
  'y el KPI de la obra lo dice en pantalla, no deja el desglose a medias',
  plantillaDeObra([unaParteAdivina]).sub);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n4. Callarse no es decir cero: la plantilla se sigue publicando');

check(personalDeSemana(adivinada).total === 3,
  'la semana adivinada sigue diciendo que hubo 3 personas',
  String(personalDeSemana(adivinada).total));
check(personalDeSemana(muda).total === 3,
  'y la que no declara nada, también: el conteo no depende de la columna',
  String(personalDeSemana(muda).total));
check(personalDeSemana(adivinada).fuente === 'listado',
  'y sigue diciendo de dónde salió el conteo, que es otra pregunta',
  String(personalDeSemana(adivinada).fuente));

// El KPI de la obra. Lo que se afirma es lo que sale a pantalla.
const fDec = plantillaDeObra([declarada]);
check(/2D · 1I/.test(fDec.sub),
  'el KPI de la obra publica «2D · 1I» cuando lo dijo el Excel', fDec.sub);
const fAdi = plantillaDeObra([adivinada]);
check(!/D ·/.test(fAdi.sub) && /no trae la columna Tipo \(D\/I\)/.test(fAdi.sub),
  'y cuando el archivo no la trae, dice eso en vez del desglose', fAdi.sub);
const fMuda = plantillaDeObra([muda]);
check(/no dice si el archivo traía la columna/.test(fMuda.sub),
  'y una carga vieja se distingue: no dice que falte, dice que no consta',
  fMuda.sub);
check(fDec.valor === '3' && fAdi.valor === '3' && fMuda.valor === '3',
  'en los tres casos el valor del KPI es 3: la plantilla nunca se calló',
  `${fDec.valor} · ${fAdi.valor} · ${fMuda.valor}`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n5. El consolidado no mete como cero a la obra que se calla');

// Las dos cuentas del tablero, TAL CUAL están en el archivo, extraídas por
// tramos: copiarlas aquí sería comprobar el banco contra sí mismo.
const tramos = {};
traverse(parse(src, { sourceType: 'module', plugins: ['jsx'] }), {
  VariableDeclarator(p) {
    const n = p.node.id?.name;
    if (n !== 'obrasSinColumnaDI' && n !== 'personalAgg') return;
    const s = p.getStatementParent();
    tramos[n] ||= [s.node.start, s.node.end];
  },
});
for (const n of ['obrasSinColumnaDI', 'personalAgg'])
  if (!tramos[n]) noArranco([`la cuenta \`${n}\` del consolidado`], path.basename(ARCHIVO));

const consolidar = (kpisPorObra) => new Function('kpisPorObra', 'personalDeSemana', `
  "use strict";
  ${src.slice(tramos.obrasSinColumnaDI[0], tramos.personalAgg[1])}
  return { obrasSinColumnaDI, personalAgg };
`)(kpisPorObra, personalDeSemana);

const obraCon = (id, semana) => ({ obra: { id }, d: { nominaSemanas: [semana] } });
const todasDeclaran = consolidar([
  obraCon('A', sem({ tipoDeColumna: 3, tipoDePuesto: 0 }, TRES)),
  obraCon('B', sem({ tipoDeColumna: 3, tipoDePuesto: 0 }, TRES)),
]);
check(todasDeclaran.personalAgg.total === 6
   && todasDeclaran.personalAgg.dir === 4 && todasDeclaran.personalAgg.ind === 2,
  'dos obras que declaran dan 6 personas con su desglose 4D · 2I',
  `${todasDeclaran.personalAgg.total} · ${todasDeclaran.personalAgg.dir}D`);
check(todasDeclaran.obrasSinColumnaDI.length === 0,
  'y ninguna se aparta');

const unaCalla = consolidar([
  obraCon('A', sem({ tipoDeColumna: 3, tipoDePuesto: 0 }, TRES)),
  obraCon('B', sem({ tipoDeColumna: 0, tipoDePuesto: 3 }, TRES)),
]);
check(unaCalla.personalAgg.total === 6,
  'con una obra que se calla, el total NO baja: su gente son personas contadas',
  String(unaCalla.personalAgg.total));
check(unaCalla.personalAgg.dir === 2 && unaCalla.personalAgg.ind === 1,
  'y el desglose cuenta SÓLO la obra que declaró, no la otra en cero',
  `${unaCalla.personalAgg.dir}D · ${unaCalla.personalAgg.ind}I`);
check(unaCalla.personalAgg.obrasConDI === 1 && unaCalla.personalAgg.obrasConNom === 2,
  'el consolidado dice que su desglose habla de UNA obra de dos',
  `${unaCalla.personalAgg.obrasConDI} de ${unaCalla.personalAgg.obrasConNom}`);
check(unaCalla.obrasSinColumnaDI.length === 1
   && unaCalla.obrasSinColumnaDI[0].obra.id === 'B',
  'y nombra a la obra que se apartó, para poder ir a arreglarla',
  unaCalla.obrasSinColumnaDI.map(x => x.obra.id).join(','));
// ESTE ES EL DEFECTO QUE ESTUVO A PUNTO DE ENTRAR. Con `t.dir + p.dir` y
// `p.dir` nulo, el desglose seguía valiendo 2D · 1I —el mismo número— pero
// `obrasConDI` decía DOS, y el KPI publicaba un desglose de la mitad de la
// gente presentándolo como el de las dos obras.
check(unaCalla.personalAgg.dir + unaCalla.personalAgg.ind < unaCalla.personalAgg.total,
  'el desglose suma MENOS que el total, y eso es correcto: habla de menos obras',
  `${unaCalla.personalAgg.dir + unaCalla.personalAgg.ind} < ${unaCalla.personalAgg.total}`);

log('');
if (fallas) { console.log(`\n${fallas} comprobación(es) en rojo.`); process.exit(1); }
console.log('\nTodas las comprobaciones en verde.');
