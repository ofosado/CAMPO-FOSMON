#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL PAPEL IMPRIME LA PLANTILLA, Y SU DESGLOSE SÓLO SI LO DIJO EL EXCEL
// ════════════════════════════════════════════════════════════════════════════
//
// DE DÓNDE VIENE ESTO. El reporte iba a llevar un KPI de nómina con «N
// directos · M indirectos», y se paró antes de imprimirlo para medir de dónde
// salía esa cifra. El importador tiene DOS caminos para el tipo de un
// trabajador —la columna «Tipo (D/I)» del archivo, o doce palabras del
// puesto— y hasta el 2026-11-19 los dos acababan en el mismo campo sin dejar
// rastro.
//
// LO QUE SALIÓ, en producción y por semana, que es como se imprime: de 67
// semanas con listado, 40 traían evidencia propia de columna, 21 eran semanas
// donde las doce palabras predicen el tipo de TODOS siendo muchos —que una
// columna escrita a mano coincida 143 de 143 veces con doce palabras no es
// plausible— y 6 no se podían distinguir. No hay frontera en el tiempo: la
// 0114 tiene la S37 con columna entre la S36 y la S38 sin ella.
//
// ── LO QUE ESTE BANCO AFIRMA ──────────────────────────────────────────────
//
// 1. EL PAPEL NO HACE SU PROPIA CUENTA. Llama a `plantillaDeObra`, la misma
//    función que arma el KPI de la pantalla. Un `${dir}D · ${ind}I` escrito en
//    el generador sería la segunda copia, y el día que la pantalla cambie de
//    criterio el reporte de la misma obra diría otra cosa que la pantalla
//    desde la que se descargó.
//
// 2. LOS TRES CASOS SALEN DISTINTOS EN EL PAPEL. Con columna, el desglose.
//    Sin columna, la frase que pide el archivo. Sin saberlo —las 67 semanas
//    que ya estaban cargadas—, la frase que dice que no consta. Las tres se
//    arreglan en sitios distintos, y confundirlas manda a alguien a buscar lo
//    que no falta.
//
// 3. LA PLANTILLA NO SE CALLA NUNCA. Cuántas personas hubo es un conteo y no
//    depende de la columna que falta. Callar el total por no tener el desglose
//    sería perder el dato bueno junto con el dudoso.
//
// CONTRAPRUEBAS — corridas el 2026-11-22, las cinco en ROJO (1), ninguna en
// NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-el-papel-no-imprime-la-adivinanza.cjs
//       node scripts/prueba-el-papel-no-imprime-la-adivinanza.cjs --contraprueba

'use strict';

const fs = require('fs');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const { fuenteDe, ARCHIVO } = require('./extraer-de-app.cjs');
const { dibujarPDFInterno, textoCorrido } = require('./lienzo-pdf.cjs');
const archivo = process.env.ARCHIVO_APP || ARCHIVO;

let fallas = 0, verdes = 0;
const ok = (c, m, d = '') => {
  if (c) { verdes++; console.log(`  ok   ${m}${d ? '  ·  ' + d : ''}`); }
  else { fallas++; console.log(`FALLA  ${m}${d ? '  ·  ' + d : ''}`); }
};

const PNG_1PX = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
  + 'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const PEDIDOS = ['generarPDFInterno', 'plantillaDeObra', 'semanasDeNomina'];
const { cuerpo, faltan } = fuenteDe(archivo, PEDIDOS, { tolerante: true,
  excluir: ['coteaBlancoPNG'] });
if (faltan.length) {
  console.error(`\nNO ARRANCÓ: faltan en ${archivo}: ${faltan.join(', ')}`);
  process.exit(2);
}
let APP;
try {
  APP = new Function('React', 'useState', 'useEffect', 'useRef', 'useCallback',
    'useMemo', 'coteaBlancoPNG',
    `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`)(
    ...Array(6).fill(() => {}), PNG_1PX);
} catch (e) {
  console.error(`\nNO ARRANCÓ: no se pudo montar lo extraído: ${e.message}`);
  process.exit(2);
}
const { generarPDFInterno, plantillaDeObra, semanasDeNomina } = APP;

// ── LAS TRES SEMANAS, QUE SON LOS TRES CASOS DE PRODUCCIÓN ────────────────
// La forma es la que escribe el importador, no una parecida: `semana` como
// «Semana 38» y no `38`, y el conteo en `totalDir`/`totalInd`. Los dos conteos
// de procedencia son el campo que el importador empezó a anotar el
// 2026-11-19; su AUSENCIA es la forma de las 67 semanas que ya había.
const SELLO = '2026-03-15T18:00:00.000Z';
const CARGA = { fecha: '21/9/2026', archivo: 'NOMINA-S38.xlsx', totalNomina: 486000 };
const TRABS = (n) => [...Array(n)].map(() => ({ total: 1000, impHE: 0, dias: 6, tipo: 'D' }));

const SEMANAS = {
  // Todas de columna: es dato y se imprime.
  DATO: semanasDeNomina([{ ...CARGA, semana: 'Semana 38',
    trabajadores: TRABS(34), totalDir: 26, totalInd: 8,
    tipoDeColumna: 34, tipoDePuesto: 0 }]),
  // Una sola fila adivinada basta para callar el desglose: media semana
  // contada y media adivinada no es un desglose.
  ADIVINADA: semanasDeNomina([{ ...CARGA, semana: 'Semana 38',
    trabajadores: TRABS(34), totalDir: 26, totalInd: 8,
    tipoDeColumna: 33, tipoDePuesto: 1 }]),
  // Sin los dos conteos: así están las 67 semanas ya cargadas.
  VIEJA: semanasDeNomina([{ ...CARGA, semana: 'Semana 38',
    trabajadores: TRABS(34), totalDir: 26, totalInd: 8 }]),
  // Y la obra que no tiene ninguna.
  NINGUNA: [],
};

const OBRA = { id: '0114', nombre: 'Oaxaca Parque Lineal', cliente: 'Gobierno de Oaxaca',
               contrato: 'LO-920-2026-0114', inicio: '2026-03-01', fin: '2026-12-15' };
const base = (nominaHistorial) => ({
  obra: OBRA, subs: [], estimaciones: [], estCargadas: true, maquinaria: [],
  materiales: [], subcontratos: [], historialAvance: [], gpData: null,
  gpDetalle: null, otrosGastos: [], nominaHistorial, programa: null,
  instante: SELLO, evidencia: [], evidenciaCargada: true,
  organizacion: 'FOSMON Construcciones', generadoPor: 'demo@fosmon.com.mx',
});

(async () => {
const papeles = {};
for (const [nombre, sem] of Object.entries(SEMANAS)) {
  const hoja = await dibujarPDFInterno(generarPDFInterno, base(sem));
  if (hoja.reventones.length) {
    console.error(`\nNO ARRANCÓ: el generador reventó en ${nombre}: `
      + hoja.reventones.join(' | '));
    process.exit(2);
  }
  papeles[nombre] = hoja;
}
// Se lee el texto corrido: `kpiBox` parte el pie en renglones y una frase
// larga vive repartida entre varios.
const dice = (hoja, frase) =>
  textoCorrido(hoja).some(d => String(d.texto).includes(frase));
const unido = (hoja) => textoCorrido(hoja).map(d => String(d.texto))
  .join(' ').replace(/\s+/g, ' ');

// ══════════════════════════════════════════════════════════════════════════
console.log('1. La cuenta es la de la pantalla, no una del papel');

// Lo que el papel imprime tiene que ser, letra por letra, lo que contesta
// `plantillaDeObra`. Si el generador armara su propia cadena, esto saldría
// distinto en cuanto las dos se separaran.
for (const [nombre, sem] of Object.entries(SEMANAS)) {
  const p = plantillaDeObra(sem);
  ok(dice(papeles[nombre], p.sub),
    `${nombre}: el pie del papel es el de \`plantillaDeObra\``, p.sub.slice(0, 64));
  ok(unido(papeles[nombre]).includes(p.valor),
    `${nombre}: y el valor también`, p.valor);
}

console.log('\n2. Con columna, el desglose SÍ se imprime');
ok(dice(papeles.DATO, '26D · 8I'),
  'la semana con columna publica «26D · 8I»');
ok(unido(papeles.DATO).includes('34'),
  'y la plantilla, 34 personas');

console.log('\n3. Sin columna, el papel dice qué falta en vez del desglose');
ok(!dice(papeles.ADIVINADA, '26D · 8I'),
  'la semana con una fila adivinada NO publica el desglose');
ok(dice(papeles.ADIVINADA, 'no trae la columna Tipo (D/I)'),
  'y dice que al archivo le falta la columna');
ok(unido(papeles.ADIVINADA).includes('34'),
  'pero la plantilla sigue: 34 personas se contaron igual');

console.log('\n4. Y una carga vieja se distingue de un archivo sin columna');
ok(!dice(papeles.VIEJA, '26D · 8I'),
  'la carga que no declara procedencia tampoco publica el desglose');
ok(dice(papeles.VIEJA, 'no dice si el archivo traía la columna'),
  'y lo dice distinto: no que falte, sino que no consta');
// Las dos frases NO pueden ser la misma: una pide subir el Excel con su
// columna, la otra es una carga de antes de que esto se anotara y ya no se
// puede saber. Confundirlas manda a buscar lo que no falta.
ok(unido(papeles.VIEJA) !== unido(papeles.ADIVINADA),
  'y los dos papeles no dicen lo mismo');

console.log('\n5. Sin nómina, el papel no publica un cero');
ok(dice(papeles.NINGUNA, 'no se ha cargado nómina'),
  'una obra sin ninguna semana dice que no se ha cargado nómina');
ok(!dice(papeles.NINGUNA, '0D · 0I'),
  'y NO publica «0D · 0I», que se leería como una obra sin gente');

console.log(`\n${verdes} en verde · ${fallas} en rojo`);
if (fallas) process.exit(1);

// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const src = fs.readFileSync(archivo, 'utf8');
  const CP = require('./contraprueba.cjs');
  const MUTANTES = [
    { titulo: 'el papel deja de publicar la plantilla',
      cambios: [["  const plantilla = plantillaDeObra(nominaHistorial);\n"
                 + "  y = kpiRow([\n"
                 + "    ['Personal en campo', plantilla.valor, plantilla.sub,\n"
                 + "      plantilla.total === null ? Q.mu : Q.piz],\n"
                 + "  ], y);",
                 "  const plantilla = plantillaDeObra(nominaHistorial);", 1]] },
    { titulo: 'el papel arma su propio desglose en vez de usar la cuenta',
      cambios: [["    ['Personal en campo', plantilla.valor, plantilla.sub,",
                 "    ['Personal en campo', plantilla.valor, "
                 + "`${plantilla.dir}D · ${plantilla.ind}I`,", 1]] },
    { titulo: 'el desglose se publica aunque el tipo se haya adivinado',
      cambios: [["  const conDI = (dir, ind, fuente) => diDe === 'columna'",
                 "  const conDI = (dir, ind, fuente) => true", 1]] },
    { titulo: 'las dos razones del hueco se dicen con la misma frase',
      cambios: [["  const faltaColumna = diDe === null\n"
                 + "    ? 'sin desglose D/I: la carga no dice si el archivo traía la columna Tipo (D/I)'\n"
                 + "    : 'sin desglose D/I: el archivo no trae la columna Tipo (D/I)';",
                 "  const faltaColumna = 'sin desglose D/I';", 1]] },
    { titulo: 'sin nómina el papel publica un cero en vez de decirlo',
      cambios: [["    return { hayNomina: false, total: null, dir: 0, ind: 0, semana: null,\n"
                 + "      partes: 0, valor: 'sin nómina', sub: 'no se ha cargado nómina' };",
                 "    return { hayNomina: false, total: 0, dir: 0, ind: 0, semana: null,\n"
                 + "      partes: 0, valor: '0', sub: '0D · 0I' };", 1]] },
  ];
  CP.exigirAnclajes(MUTANTES, src, { archivo });
  const s = CP.correr({ mutaciones: MUTANTES, src, archivo, prefijo: 'nomina-papel-' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}
})();
