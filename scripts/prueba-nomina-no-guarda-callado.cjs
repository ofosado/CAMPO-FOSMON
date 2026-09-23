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
const noArranco = require('./no-arranco.cjs');

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

const faltan = ['fn:guardarSemana', 'fn:eliminarCarga', 'tamañoFirestore', 'LIMITE_DOC_FIRESTORE',
                'semanasDeNomina', 'claveSemanaNomina', 'numSemanaNomina', 'añoSemanaNomina',
                'fechaCargaNomina', 'semanaISO', 'heImporte', 'mensajeFalloNomina',
                'escribirHistorialNomina', 'claveDocSemana', 'rutaSemanaNomina',
                'FORMATO_HISTORIAL_ARREGLO', 'FORMATO_HISTORIAL_SUBCOLECCION',
                'CLAVE_SIN_SEMANA'].filter(n => !decl[n]);
if (faltan.length) noArranco(faltan);

// ── Montaje ────────────────────────────────────────────────────────────────
// Todo lo que las dos funciones tocan queda registrado en `efectos`, para poder
// preguntar después qué hizo la pantalla. `modo` controla la escritura.
const preludio = `
  const efectos = { escrituras: 0, notificado: null, tab: null, semanaVer: null,
                    modalCerrado: false, error: '',
                    rutas: [], borrados: [], escrito: {} };
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
  const fsSetAEstricto = async (ruta) => { efectos.escrituras++; efectos.rutas.push(ruta); reventar(); return true; };
  // El ayudante viejo, tal como se comportaba: se traga el error y devuelve
  // false. Está para que la contraprueba —el mismo archivo con el patrón
  // anterior— se monte y salga en rojo por conducta, no por dependencias.
  const fsSetA = async () => {
    efectos.escrituras++;
    try { reventar(); return true; } catch (e) { return false; }
  };

  // Las primitivas crudas que usa la rama de subcolección. Se apuntan igual
  // que las otras para poder preguntar DÓNDE escribió y qué borró.
  const fbDb = {};
  const doc = (db, ...partes) => partes.join('/');
  const collection = (db, ...partes) => partes.join('/');
  const setDoc = async (ruta, datos) => {
    efectos.escrituras++; efectos.rutas.push(ruta); efectos.escrito[ruta] = datos; reventar();
  };
  const deleteDoc = async (ruta) => { efectos.borrados.push(ruta); delete efectos.escrito[ruta]; };
  const fsGet = async () => null;
  const fsAudit = () => {};
  // En qué formato está la obra de la prueba. Lo fija cada caso.
  const formatoHist = modoFormato;

  const FORMATO_HISTORIAL_ARREGLO = ${decl['FORMATO_HISTORIAL_ARREGLO']};
  const FORMATO_HISTORIAL_SUBCOLECCION = ${decl['FORMATO_HISTORIAL_SUBCOLECCION']};
  const CLAVE_SIN_SEMANA = ${decl['CLAVE_SIN_SEMANA']};
  const rutaSemanaNomina = ${decl['rutaSemanaNomina']};
  const claveDocSemana = ${decl['claveDocSemana']};
  const escribirHistorialNomina = ${decl['escribirHistorialNomina']};

  const tamañoFirestore = ${decl['tamañoFirestore']};
  const LIMITE_DOC_FIRESTORE = ${decl['LIMITE_DOC_FIRESTORE']};
  const mensajeFalloNomina = ${decl['mensajeFalloNomina'] || '(e) => String(e && e.message)'};
  // El guardado decide a qué semana saltar por calendario, no por posición.
  const semanaISO = ${decl['semanaISO']};
  const heImporte = ${decl['heImporte']};
  const numSemanaNomina = ${decl['numSemanaNomina']};
  const fechaCargaNomina = ${decl['fechaCargaNomina']};
  const añoSemanaNomina = ${decl['añoSemanaNomina']};
  const claveSemanaNomina = ${decl['claveSemanaNomina']};
  const semanasDeNomina = ${decl['semanasDeNomina']};
`;

const montar = (modo, historial, modoFormato = 1) => new Function('modo', 'historial', 'modoFormato',
  `"use strict";
   ${preludio}
   ${decl['fn:guardarSemana']}
   ${decl['fn:eliminarCarga']}
   return { guardarSemana, eliminarCarga, efectos };`
)(modo, historial, modoFormato);

// Una semana con la forma de las de verdad: el peso está en `trabajadores`, y
// cada trabajador carga una docena de campos, no dos. La `fecha` va en d/m/aaaa
// porque es lo que escribe la app (`toLocaleDateString('es-MX')`) y ahora el
// guardado la lee para saber a qué semana del calendario saltar.
const semana = (n, trabs = 40) => ({
  semana: 'SEM ' + n, fecha: `${(n % 28) + 1}/2/2027`, totalNomina: 1200000 + n,
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
    const hist = [semana(1), semana(2), semana(3)];
    const mod = montar(modo, hist);
    // Se borra UNA CARGA, no una posición: cuando una semana llegó en dos
    // archivos, quitar "la semana" se llevaría también la parte buena.
    await mod.eliminarCarga(hist[1]);
    return mod.efectos;
  };
  const borrOk = await borrar('ok');
  check(borrOk.notificado?.length === 2, 'un borrado que sí escribe quita la semana de la pantalla');
  const borrMal = await borrar('red');
  check(!borrMal.notificado,
    'un borrado que falla NO la quita: sigue guardada y reaparecería al recargar',
    borrMal.notificado ? 'la quitó igual' : 'no la quitó');
  check(/no se pudo eliminar/i.test(borrMal.error || ''), 'y lo dice');

  // ────────────────────────────────────────────────────────────────────────
  // 6) La obra migrada escribe en su subcolección, y sólo en la semana que
  //    tocó. Es la mitad que faltaba: hasta ahora la lectura miraba la
  //    bandera y la escritura no, así que migrar una obra habría mandado la
  //    semana nueva al documento viejo —donde ya nadie lee— sin decir nada.
  console.log('\n6. Con el historial en subcolección\n');
  const SUB = 2;
  const s38a = { ...semana(38), archivo: 'parte 1' };
  const s38b = { ...semana(38), archivo: 'parte 2' };
  const s37   = semana(37);

  const guardaSub = montar('ok', [s37], SUB);
  await guardaSub.guardarSemana(s38a);
  check(guardaSub.efectos.rutas.length === 1,
    'guardar una semana escribe UN documento, no el historial entero',
    `${guardaSub.efectos.rutas.length} escritura(s)`);
  // El año no se fija aquí a propósito: `añoSemanaNomina` puede resolver una
  // carga fechada en enero como la semana 38 del año anterior, y eso es lo
  // correcto. Lo que se afirma es dónde cae el documento, no cómo se llama.
  check(/nomina_historial\/Y\d{4}-S38$/.test(guardaSub.efectos.rutas[0] || ''),
    'y lo escribe en la subcolección, no en nomina/historial',
    guardaSub.efectos.rutas[0] || 'ninguna');
  check(!/\/nomina\/historial$/.test(guardaSub.efectos.rutas[0] || ''),
    'el documento viejo no se toca');

  // La 0126 rayó su semana 38 en dos archivos. Las dos partes van al MISMO
  // documento, y el segundo guardado tiene que dejar las dos dentro: si
  // escribiera sólo la que trae en la mano, la primera desaparecería.
  const dosPartes = montar('ok', [s37, s38a], SUB);
  await dosPartes.guardarSemana(s38b);
  const docSem = Object.values(dosPartes.efectos.escrito)[0];
  check(Object.keys(dosPartes.efectos.escrito).length === 1,
    'las dos partes de una misma semana caen en un solo documento');
  check(docSem?.partes?.length === 2,
    'y el documento queda con las DOS, no sólo con la última',
    `${docSem?.partes?.length ?? 0} parte(s)`);

  // Borrar una de las dos partes deja la otra. Borrar la última deja el
  // documento vacío, y un documento vacío tiene que desaparecer: si se
  // quedara con `partes: []`, la guarda que compara contra el documento
  // viejo seguiría contando una semana que ya no está.
  const borraUna = montar('ok', [s37, s38a, s38b], SUB);
  await borraUna.eliminarCarga(s38a);
  const tras = Object.values(borraUna.efectos.escrito)[0];
  check(tras?.partes?.length === 1 && borraUna.efectos.borrados.length === 0,
    'borrar una parte deja la otra, y no borra el documento',
    `${tras?.partes?.length ?? 0} parte(s)`);

  const borraUltima = montar('ok', [s37, s38a], SUB);
  await borraUltima.eliminarCarga(s38a);
  check(borraUltima.efectos.borrados.length === 1,
    'borrar la última parte borra el documento en vez de dejarlo vacío',
    borraUltima.efectos.borrados[0] || 'no lo borró');

  // Una carga cuyo archivo no dijo la semana no tiene clave. No se tira: va a
  // un documento aparte, porque perderla sería nómina que no está en ningún
  // otro lado (P2 — lo que no se pudo determinar se dice, no se descarta).
  const sinSemana = montar('ok', [], SUB);
  await sinSemana.guardarSemana({ ...semana(9), semana: '', fecha: '' });
  check(/nomina_historial\/sin-semana$/.test(sinSemana.efectos.rutas[0] || ''),
    'una carga sin semana legible se guarda aparte, no se pierde',
    sinSemana.efectos.rutas[0] || 'ninguna');

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})();
