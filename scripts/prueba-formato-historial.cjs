#!/usr/bin/env node
// Prueba: de dónde se lee el historial de nómina lo decide la BANDERA, y el
// vacío no decide nunca.
//
// El riesgo que cubre no es que el código elija mal el formato: es que elija
// bien y se equivoque igual. Una subcolección vacía, una que no se pudo leer y
// una obra que todavía no migra se ven idénticas desde el lector. Si el
// formato se dedujera de los datos, cualquiera de las tres acabaría pintando
// CERO SEMANAS DE NÓMINA — y cero semanas se ve exactamente igual que una obra
// que apenas arranca. El historial de nómina es el único sitio donde vive la
// semana rayada: ahí no hay dónde notar la falta.
//
// Y la guarda: si la bandera dice 2 pero a la subcolección le faltan semanas
// que el documento viejo sí tiene, esto tiene que GRITAR. Un historial al que
// le falta la semana 34 no tiene hueco visible entre la 33 y la 36.
//
// No comprueba que existan nombres: extrae `leerHistorialNomina` y sus
// ayudantes de `src/App.jsx`, les pone un Firestore de mentira con datos con
// forma de producción, y les pregunta qué contestan.
//
// Uso:  node scripts/prueba-formato-historial.cjs [archivo]

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const archivo = process.argv[2] || path.join(raiz, 'src/App.jsx');
const src = fs.readFileSync(archivo, 'utf8');
const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });

const decl = {};
traverse(ast, {
  VariableDeclarator(p) {
    if (p.node.id.type === 'Identifier' && p.node.init && !p.scope.parent?.parent)
      decl[p.node.id.name] ||= src.slice(p.node.init.start, p.node.init.end);
  },
  ClassDeclaration(p) { if (p.node.id) decl['class:' + p.node.id.name] ||= src.slice(p.node.start, p.node.end); },
});

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// Una lectura que lanza cuando no debía es una FALLA de esa comprobación, no
// el final de la prueba. Si el primer escenario roto tumbara el guion, los
// quince siguientes quedarían sin correr y el informe diría menos de lo que
// sabe — el mismo defecto que esta prueba vigila, cometido por la prueba.
const leer = async (m, obraId = '0126') => {
  try { return { ...await m.leerHistorialNomina(obraId), error: null }; }
  catch (e) { return { registros: null, formato: null, error: e }; }
};

const NECESARIOS = [
  'FORMATO_HISTORIAL_ARREGLO', 'FORMATO_HISTORIAL_SUBCOLECCION', 'formatoHistorial',
  'leerHistorialNomina', 'avisarSiFaltanSemanas', 'semanaISO', 'numSemanaNomina',
  'fechaCargaNomina', 'añoSemanaNomina', 'claveSemanaNomina',
  'class:ErrorHistorialNomina',
];
for (const n of NECESARIOS) if (!decl[n]) check(false, `se pudo extraer \`${n.replace('class:', '')}\``);
if (fallas) { console.log('\nNo se pudo montar la prueba.'); process.exit(1); }

// ── El Firestore de mentira ────────────────────────────────────────────────
// `docs` son documentos sueltos por ruta; `subcol` son subcolecciones por
// ruta. `null` en cualquiera de los dos significa "la lectura revienta", que
// es el caso que distingue una prueba de verdad de una que solo mueve datos.
const montar = ({ docs = {}, subcol = {} }) => {
  const leidas = [];
  const fsGet = async (ruta) => {
    leidas.push(ruta);
    if (docs[ruta] === null) throw new Error('permission-denied (simulado)');
    return docs[ruta] ?? null;
  };
  const getDocs = async (ref) => {
    leidas.push(ref.ruta);
    if (subcol[ref.ruta] === null) throw new Error('unavailable (simulado)');
    const arr = subcol[ref.ruta] || [];
    // `size` y `empty` van aunque el lector de hoy no los use: son justo lo
    // que miraría alguien que decidiera el formato por los datos, y sin ellos
    // esa versión equivocada pasaría la prueba por accidente.
    return { size: arr.length, empty: arr.length === 0, docs: arr.map(d => ({ data: () => d })),
             forEach: (f) => arr.forEach(d => f({ data: () => d })) };
  };
  const mod = new Function('fsGet', 'getDocs', `
    "use strict";
    const collection = (db, ...p) => ({ ruta: p.join('/') });
    const fbDb = {};
    ${decl['class:ErrorHistorialNomina']}
    const semanaISO = ${decl['semanaISO']};
    const numSemanaNomina = ${decl['numSemanaNomina']};
    const fechaCargaNomina = ${decl['fechaCargaNomina']};
    const añoSemanaNomina = ${decl['añoSemanaNomina']};
    const claveSemanaNomina = ${decl['claveSemanaNomina']};
    const FORMATO_HISTORIAL_ARREGLO = ${decl['FORMATO_HISTORIAL_ARREGLO']};
    const FORMATO_HISTORIAL_SUBCOLECCION = ${decl['FORMATO_HISTORIAL_SUBCOLECCION']};
    const formatoHistorial = ${decl['formatoHistorial']};
    const avisarSiFaltanSemanas = ${decl['avisarSiFaltanSemanas']};
    const leerHistorialNomina = ${decl['leerHistorialNomina']};
    return { leerHistorialNomina, formatoHistorial,
             FORMATO_HISTORIAL_ARREGLO, FORMATO_HISTORIAL_SUBCOLECCION };
  `)(fsGet, getDocs);
  return { ...mod, leidas };
};

// Cargas con forma de producción: `semana` como texto y `fecha` de SUBIDA en
// d/m/aaaa. Son las de la 0126, que rayó su semana 38 en dos archivos.
const S36 = { semana: 'Semana 36', fecha: '7/9/2026',  archivo: 's36.xlsx', totalNomina: 400000, trabajadores: [{ nombre: 'A' }] };
const S37 = { semana: 'Semana 37', fecha: '14/9/2026', archivo: 's37.xlsx', totalNomina: 410000, trabajadores: [{ nombre: 'A' }] };
const S38a = { semana: 'Semana 38', fecha: '21/9/2026', archivo: 's38-a.xlsx', totalNomina: 502603, trabajadores: [{ nombre: 'A' }] };
const S38b = { semana: 'Semana 38', fecha: '21/9/2026', archivo: 's38-b.xlsx', totalNomina: 152950, trabajadores: [{ nombre: 'B' }] };

const DOC_VIEJO = 'obras/0126/nomina/historial';
const INFO = 'obras/0126/config/info';
const SUBCOL = 'obras/0126/nomina_historial';

// ── 1. La bandera manda, no los datos ──────────────────────────────────────
console.log('1. Quién decide de dónde se lee');

(async () => {
  // Sin bandera: formato viejo. Una obra nueva no tiene bandera y tiene que
  // leer donde de verdad está su nómina.
  {
    const m = montar({ docs: { [INFO]: {}, [DOC_VIEJO]: { semanas: [S36, S37] } } });
    const { registros, formato, error } = await leer(m);
    check(!error && formato === m.FORMATO_HISTORIAL_ARREGLO && registros?.length === 2,
      'sin bandera se lee el arreglo de siempre',
      error ? `lanzó ${error.name}` : `formato ${formato}, ${registros.length} cargas`);
    check(!m.leidas.includes(SUBCOL), 'y no se toca la subcolección siquiera');
  }

  // LA PRUEBA QUE IMPORTA: subcolección LLENA, bandera en 1. Si el formato se
  // dedujera de los datos, esto leería la subcolección. Tiene que leer el
  // arreglo, porque es lo que la obra declara.
  {
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 1 } }, [DOC_VIEJO]: { semanas: [S36] } },
      subcol: { [SUBCOL]: [{ clave: 'Y2026-S37', partes: [S37] }, { clave: 'Y2026-S38', partes: [S38a, S38b] }] },
    });
    const { registros, error } = await leer(m);
    check(!error && registros?.length === 1 && registros?.[0]?.archivo === 's36.xlsx',
      'con la subcolección LLENA y la bandera en 1, manda la bandera',
      error ? `lanzó ${error.name}`
            : `${registros.length} carga(s): ${registros.map(r => r.archivo).join(', ')}`);
  }

  // Y al revés: subcolección vacía, bandera en 2, documento viejo ya limpiado.
  // Es una obra migrada que aún no tiene nómina. No puede caerse al formato
  // viejo "porque no encontró nada".
  {
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } }, [DOC_VIEJO]: null_ok() },
      subcol: { [SUBCOL]: [] },
    });
    const { registros, formato, error } = await leer(m);
    check(!error && formato === m.FORMATO_HISTORIAL_SUBCOLECCION && registros?.length === 0,
      'con la bandera en 2 y nada que leer, se lee vacío sin caer al formato viejo',
      error ? `lanzó ${error.name}` : `formato ${formato}`);
  }

  // Bandera en 2 con datos: llegan las CARGAS, no las semanas ya sumadas. La
  // 38 son dos archivos y tienen que llegar los dos, o borrar una borraría la
  // otra.
  {
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } } },
      subcol: { [SUBCOL]: [{ clave: 'Y2026-S37', partes: [S37] }, { clave: 'Y2026-S38', partes: [S38a, S38b] }] },
    });
    const { registros, error } = await leer(m);
    check(!error && registros?.length === 3, 'de la subcolección salen CARGAS, no semanas sumadas',
      error ? `lanzó ${error.name}` : `${registros.length} cargas de 2 semanas`);
    check(registros?.filter(r => r.semana === 'Semana 38').length === 2,
      'la semana partida en dos archivos llega con sus dos partes');
  }

  // ── 2. Un fallo de lectura no es una obra sin nómina ─────────────────────
  console.log('\n2. Un fallo de lectura NO se convierte en "no hay nómina" (P2)');
  {
    const m = montar({ docs: { [INFO]: null } });
    const r = (await leer(m)).error;
    check(r && r.name === 'ErrorHistorialNomina',
      'si no se puede leer la configuración, lanza en vez de suponer formato 1',
      r ? r.name : 'devolvió datos');
  }
  {
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } } },
      subcol: { [SUBCOL]: null },
    });
    const r = (await leer(m)).error;
    check(r && r.name === 'ErrorHistorialNomina',
      'si la subcolección no se puede leer, lanza en vez de devolver []',
      r ? r.name : 'devolvió datos');
    check(!!r && /guardadas/.test(r.message),
      'y el mensaje aclara que las semanas siguen guardadas, que es un fallo de lectura');
  }

  // ── 3. La guarda ─────────────────────────────────────────────────────────
  console.log('\n3. La guarda grita si la bandera dice 2 y faltan semanas');
  {
    // El documento viejo tiene 36, 37 y 38(×2). La subcolección solo trajo la 36.
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } }, [DOC_VIEJO]: { semanas: [S36, S37, S38a, S38b] } },
      subcol: { [SUBCOL]: [{ clave: 'Y2026-S36', partes: [S36] }] },
    });
    const r = (await leer(m)).error;
    check(r && r.name === 'ErrorHistorialNomina', 'lanza cuando faltan semanas', r ? r.name : 'NO LANZÓ');
    check(!!r && /Y2026-S37/.test(r.message) && /Y2026-S38/.test(r.message),
      'y dice CUÁLES faltan, no solo que falta algo', r?.message?.slice(0, 90));
  }
  {
    // Migración completa: están todas. No debe gritar por gritar.
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } }, [DOC_VIEJO]: { semanas: [S36, S37, S38a, S38b] } },
      subcol: { [SUBCOL]: [
        { clave: 'Y2026-S36', partes: [S36] }, { clave: 'Y2026-S37', partes: [S37] },
        { clave: 'Y2026-S38', partes: [S38a, S38b] }] },
    });
    const { registros, error } = await leer(m);
    check(!error && registros?.length === 4, 'con la migración completa no dice nada y trae las 4 cargas',
      error ? `lanzó ${error.name}: no debía` : `${registros.length} cargas`);
  }
  {
    // Una carga sin semana legible no tiene clave: no se puede contar por
    // clave, y si no se contara aparte se perdería sin que nadie lo viera.
    const rota = { semana: 'sin número', fecha: '21/9/2026', archivo: 'rara.xlsx', trabajadores: [] };
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } }, [DOC_VIEJO]: { semanas: [S36, rota] } },
      subcol: { [SUBCOL]: [{ clave: 'Y2026-S36', partes: [S36] }] },
    });
    const r = (await leer(m)).error;
    check(r && r.name === 'ErrorHistorialNomina',
      'una carga sin semana legible que se quedó atrás también hace gritar',
      r ? 'gritó' : 'SE PERDIÓ EN SILENCIO');
  }
  {
    // El documento viejo ya se limpió: la migración terminó. Nada que comparar
    // y nada que gritar.
    const m = montar({
      docs: { [INFO]: { formatoHistorial: { nomina: 2 } } },
      subcol: { [SUBCOL]: [{ clave: 'Y2026-S36', partes: [S36] }] },
    });
    const { registros, error } = await leer(m);
    check(!error && registros?.length === 1,
      'sin documento viejo que comparar, la guarda se calla: la migración terminó',
      error ? `lanzó ${error.name}` : '');
  }

  // ── 4. La bandera es por historial ───────────────────────────────────────
  console.log('\n4. La bandera es por historial, no una sola para todos');
  {
    const m = montar({ docs: { [INFO]: { formatoHistorial: { avance: 2, nomina: 1 } }, [DOC_VIEJO]: { semanas: [S36] } } });
    const { formato, error } = await leer(m);
    check(!error && formato === m.FORMATO_HISTORIAL_ARREGLO,
      'que avance esté migrado no migra la nómina',
      error ? `lanzó ${error.name}` : `formato ${formato}`);
  }
  {
    // Un valor inesperado no se toma por bueno: cae al formato viejo, que es
    // donde están los datos. Equivocarse hacia el lado que sí tiene la nómina.
    for (const v of [0, 3, '2', true, null])
      check(montar({ docs: {} }).formatoHistorial({ formatoHistorial: { nomina: v } }, 'nomina') === 1,
        `\`nomina: ${JSON.stringify(v)}\` no se toma por migrada`);
  }

  console.log(fallas === 0
    ? '\nTodas las comprobaciones en verde.'
    : `\n${fallas} comprobación(es) en rojo.`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// El documento viejo ausente se escribe así para que se lea como intención y
// no como descuido: `undefined` en el mapa significa "no existe".
function null_ok() { return undefined; }
