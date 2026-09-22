#!/usr/bin/env node
// Prueba: si la semana de nómina no se puede escribir, la pantalla NO se
// comporta como si se hubiera guardado.
//
// Mismo defecto que costó siete cierres de avance en la 0114, en el otro
// módulo: `fsSetA` se traga el error y devuelve `false`, nadie lo esperaba ni
// lo miraba, y justo después la pantalla llamaba a `notificarCambio`, saltaba a
// la semana nueva y cerraba el diálogo. Resultado: el usuario ve su semana en
// pantalla, la cierra, y al volver no está.
//
// Aquí duele más que en avance: el historial de nómina no es la copia de algo
// capturado en otro lado, es el único sitio donde vive la semana. Si la
// escritura falla, no hay de dónde rescatarla — solo del archivo de Excel, si
// alguien lo guardó.
//
// No comprueba que exista un `try`: extrae las dos funciones reales del archivo
// y observa a qué llaman cuando la escritura revienta.
//
// Uso:  node scripts/prueba-nomina-no-guarda-callado.cjs [archivo]

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  FunctionDeclaration(p) {
    if (p.node.id) decl['fn:' + p.node.id.name] ||= src.slice(p.node.start, p.node.end);
  },
});

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

for (const n of ['fn:guardarSemana', 'fn:eliminarSemana', 'tamañoFirestore', 'LIMITE_DOC_FIRESTORE'])
  if (!decl[n]) check(false, `se pudo extraer \`${n.replace('fn:', '')}\``);
if (fallas) { console.log('\nNo se pudo montar la prueba.'); process.exit(1); }

// ── Montaje ────────────────────────────────────────────────────────────────
// Todo lo que las dos funciones tocan queda registrado en `efectos`, para poder
// preguntar después qué hizo la pantalla. `modo` controla la escritura.
const preludio = `
  const efectos = { escrituras: 0, notificado: null, tab: null, semanaVer: null,
                    modalCerrado: false, error: '' };
  const setError            = m => { efectos.error = m; };
  const notificarCambio     = h => { efectos.notificado = h; };
  const setVistaTab         = t => { efectos.tab = t; };
  const setSemanaVer        = i => { efectos.semanaVer = i; };
  const setPendienteRevisar = v => { if (v === null) efectos.modalCerrado = true; };
  const obra = { id: '0125', contrato: 'Municipio de ejemplo' };

  const reventar = () => {
    if (modo === 'lleno') {
      const e = new Error('Document cannot be written because its size (1,398,101 bytes) exceeds the maximum allowed size of 1,048,576 bytes.');
      e.code = 'invalid-argument';
      throw e;
    }
    if (modo === 'red') throw new Error('Failed to get document because the client is offline.');
  };
  const fsSetAEstricto = async () => { efectos.escrituras++; reventar(); return true; };
  // El ayudante viejo, tal como se comportaba: se traga el error y devuelve
  // false. Está para que la contraprueba —el mismo archivo con el patrón
  // anterior— se monte y salga en rojo por conducta, no por dependencias.
  const fsSetA = async () => {
    efectos.escrituras++;
    try { reventar(); return true; } catch (e) { return false; }
  };

  const tamañoFirestore = ${decl['tamañoFirestore']};
  const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
  const mensajeFalloNomina = ${decl['mensajeFalloNomina'] || '(e) => String(e && e.message)'};
`;

const montar = (modo, historial) => new Function('modo', 'historial',
  `"use strict";
   ${preludio}
   ${decl['fn:guardarSemana']}
   ${decl['fn:eliminarSemana']}
   return { guardarSemana, eliminarSemana, efectos };`
)(modo, historial);

// Una semana con la forma de las de verdad: el peso está en `trabajadores`, y
// cada trabajador carga una docena de campos, no dos.
const semana = (n, trabs = 40) => ({
  semana: 'SEM ' + n, fecha: '2027-02-0' + (n % 9 || 1), totalNomina: 1200000 + n,
  totalDir: trabs, totalInd: 4, totalHE: 180,
  trabajadores: Array.from({ length: trabs }, (_, i) => ({
    nombre: `APELLIDO PATERNO APELLIDO MATERNO NOMBRE ${i}`,
    puesto: 'OFICIAL ALBAÑIL', categoria: 'DIRECTO', nss: '12345678901',
    dias: 6, horasEfectivas: 48, he: 4, sueldoDiario: 480.5,
    total: 3204.75, imss: 142.3, infonavit: 0, fondo: 96.1,
  })),
});

const correrGuardar = async (modo, historial = [semana(5)]) => {
  const m = montar(modo, historial);
  try { await m.guardarSemana(semana(6)); } catch (e) { m.efectos.lanzo = e; }
  return m.efectos;
};

(async () => {
  // 1) Camino feliz: la pantalla avanza.
  const ok = await correrGuardar('ok');
  check(ok.escrituras === 1 && !!ok.notificado, 'cuando la escritura funciona, la semana entra al historial',
    ok.notificado ? `${ok.notificado.length} semanas` : 'no notificó');
  check(ok.tab === 'actual' && ok.semanaVer === 1 && ok.modalCerrado,
    'y la pantalla salta a la semana nueva y cierra el diálogo');
  check(!ok.error, 'sin error');

  // 2) LO QUE IMPORTA: el documento está lleno. Antes la pantalla hacía
  //    exactamente lo mismo que arriba y el usuario se iba tranquilo.
  const lleno = await correrGuardar('lleno');
  check(!lleno.notificado,
    'si la escritura falla, la semana NO se da por agregada',
    lleno.notificado ? `notificó ${lleno.notificado.length} semanas igual` : 'no notificó');
  check(lleno.tab === null && lleno.semanaVer === null,
    'y la pantalla no salta a una semana que no existe');
  check(!lleno.modalCerrado,
    'el diálogo sigue abierto, así que se puede reintentar sin recargar el archivo');
  check(!!lleno.error, 'y hay un error a la vista');

  // 3) El mensaje tiene que servirle a quien cargó la nómina.
  const m = lleno.error || '';
  check(/límite de tamaño/i.test(m), 'el mensaje dice que el historial llegó al límite');
  check(/NO se guardó/i.test(m),
    'y dice sin rodeos que la semana no quedó — en nómina no hay copia en otro lado');
  check(!/tu captura .* SÍ quedó guardada/i.test(m),
    'no promete que algo se salvó, porque aquí no se salva nada');
  check(/0125/.test(m), 'nombra la obra, para que sistemas sepa cuál compactar');
  check(!/undefined|NaN|\[object/.test(m), 'el mensaje no trae basura', m.slice(0, 50) + '…');
  check(!/\b0 KB\b/.test(m), 'no afirma un tamaño que su propia medición no respalda');

  // Con un historial que sí pesa, la cifra aparece. Catorce semanas de 300
  // trabajadores bastan para el 95% del límite. El trabajador de este fixture
  // pesa ~236 B; el real medido en la 0125 pesa 294 B, así que en producción
  // esas mismas 300 personas llenan el documento en 11 semanas, no en 14
  // (ver la tabla del pendiente #28). El fixture se queda corto a propósito:
  // si la prueba pasa con el caso benigno, pasa con el de verdad.
  const gordo = Array.from({ length: 14 }, (_, i) => semana(i + 1, 300));
  const pesado = await correrGuardar('lleno', gordo);
  check(/\d{3,} KB de 1024 KB/.test(pesado.error || ''),
    'y cuando sí lo respalda, la cifra aparece',
    (pesado.error || '').match(/\d+ KB de 1024 KB/)?.[0] || 'no salió');

  // 4) Un fallo de red también se ve, con otro consejo.
  const red = await correrGuardar('red');
  check(!red.notificado && !!red.error, 'un fallo de red tampoco pasa por guardado');
  check(/vuelve a intentar/i.test(red.error) && !/límite de tamaño/i.test(red.error),
    'y ese invita a reintentar, sin culpar al tamaño');

  // 5) Borrar tiene el mismo problema al revés: si el borrado no llegó, la
  //    semana sigue ahí y la pantalla no puede decir que ya no está.
  const borrar = async modo => {
    const mod = montar(modo, [semana(1), semana(2), semana(3)]);
    await mod.eliminarSemana(1);
    return mod.efectos;
  };
  const borrOk = await borrar('ok');
  check(borrOk.notificado?.length === 2, 'un borrado que sí escribe quita la semana de la pantalla');
  const borrMal = await borrar('red');
  check(!borrMal.notificado,
    'un borrado que falla NO la quita: sigue guardada y reaparecería al recargar',
    borrMal.notificado ? 'la quitó igual' : 'no la quitó');
  check(/no se pudo eliminar/i.test(borrMal.error || ''), 'y lo dice');

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})();
