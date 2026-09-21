#!/usr/bin/env node
// Guarda de fix/catalogo-no-borra-avance (PENDIENTES #22, caso urgente).
//
// El defecto: `confirmarCatalogo` leía el avance previo con `fsGet`, que hace
// `catch { return null; }`. Un fallo de red daba el mismo `null` que "esta
// obra todavía no tiene avance", se construía un mapa vacío de partidas
// previas y acto seguido se escribía `avance/subs` con TODO en a=0 y
// cantEjec=0. El avance del residente se borraba en silencio.
//
// Esta prueba NO lee el código buscando frases: extrae `confirmarCatalogo`
// por AST y la EJECUTA con dobles de prueba, comprobando qué escribe en cada
// escenario. Es la aplicación del principio P3: probar que el comportamiento
// ocurre, no que el mecanismo existe. La versión anterior de esta familia de
// pruebas afirmaba que el manejo de error estaba escrito, y eso pasaba en
// verde con el camino muerto.
//
// Lo que NO cubre: el render, la UI del reemplazo, `parsearPresupuesto`.
//
// Uso:  node scripts/prueba-guarda-catalogo.cjs [archivo]
//
// El argumento corre la prueba contra una versión anterior para comprobar
// que ahí falla — una prueba que nunca ha fallado no prueba nada:
//     git show main:src/App.jsx > /tmp/antes.jsx
//     node scripts/prueba-guarda-catalogo.cjs /tmp/antes.jsx

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const ARCHIVO = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(raiz, 'src/App.jsx');
const codigo = fs.readFileSync(ARCHIVO, 'utf8');
const ast = parse(codigo, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
});
const fuente = n => codigo.slice(n.start, n.end);

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

// ── Extracción ─────────────────────────────────────────────────────────
let srcConfirmar = null;
traverse(ast, {
  FunctionDeclaration(p) {
    if (!srcConfirmar && p.node.id?.name === 'confirmarCatalogo') srcConfirmar = fuente(p.node);
  },
});
if (!srcConfirmar) {
  console.log('   ✗ no se encontró `confirmarCatalogo` — ¿se renombró?');
  console.log('\n1 FALLA(S):\n  · no se encontró confirmarCatalogo');
  process.exit(1);
}

// Todas las variables libres de la función se inyectan como parámetros, así
// que la podemos correr fuera de React.
const LIBRES = ['resultado','obra','importeContrato','catalogoGuardado','getDoc','getDocFromServer',
                'doc','fbDb','setError','fsSetA','fsGet','setObra','setSubsGlobal','setCatalogoGuardado',
                'setFase','setDoc','addDoc','updateDoc','deleteDoc','writeBatch','fsSet','fsDel',
                'fsAudit','crearSnapshotAvance'];

// Toda API capaz de escribir en Firestore. La prueba de la garantía de
// seguridad (sección 1) exige que NINGUNA se invoque si la lectura falla:
// sin persistencia, una escritura offline igual se encola en memoria y se
// manda al reconectar, así que "no llegó" no equivale a "no se emitió".
const APIS_ESCRITURA = ['fsSetA','setDoc','addDoc','updateDoc','deleteDoc',
                        'writeBatch','fsSet','fsDel','fsAudit','crearSnapshotAvance'];

// Un catálogo nuevo con dos partidas que EXISTEN en el avance previo.
const resultadoFalso = () => ({
  totalLeido: 1000,
  parserVersion: 'test',
  colsDetectadas: {}, headerDetectado: {},
  categorias: [],
  conceptos: [
    { _ri: 1, clave: 'A-01', desc: 'Trazo', importe: 600, cant: 100, pu: 6, unidad: 'M2' },
    { _ri: 2, clave: 'A-02', desc: 'Excavación', importe: 400, cant: 50, pu: 8, unidad: 'M3' },
  ],
});

// El avance que el residente ya capturó y que NO se debe perder.
const AVANCE_PREVIO = [
  { sec: 'A-01', a: 80, cantEjec: 80, fotos: { f1: 'url' } },
  { sec: 'A-02', a: 45, cantEjec: 22.5, fotos: {} },
];

// Corre `confirmarCatalogo` con el doble de lectura que se le indique.
// `lectura` es una función que recibe el path y devuelve el snapshot, o lanza.
function correr({ lectura, escrituraOk = true, catalogoGuardado = { viejo: true } }) {
  const escrituras = [];
  const errores = [];
  const fases = [];
  const apisLlamadas = [];   // cualquier API de escritura que se haya invocado

  const getDocFalso = async (ref) => {
    const r = lectura(ref);
    return r;
  };
  const docFalso = (...partes) => partes.slice(1).join('/');
  const fsGetFalso = async (p) => {
    // El `fsGet` real se traga todo y devuelve null. Lo reproducimos igual
    // para que, si alguien vuelve a usarlo aquí, la prueba lo note.
    try { const r = lectura(p); return r?.exists?.() ? r.data() : null; } catch { return null; }
  };
  const fsSetAFalso = async (p, data) => {
    apisLlamadas.push('fsSetA');
    if (!escrituraOk) return false;
    escrituras.push({ path: p, data });
    return true;
  };

  const args = {
    resultado: resultadoFalso(),
    obra: { id: 'O1', contrato: '0825', nombre: 'Oaxaca' },
    importeContrato: 1000,
    catalogoGuardado,
    getDoc: getDocFalso,
    getDocFromServer: getDocFalso,
    doc: docFalso,
    fbDb: {},
    setError: m => errores.push(m),
    fsSetA: fsSetAFalso,
    fsGet: fsGetFalso,
    setObra: () => {},
    setSubsGlobal: () => {},
    setCatalogoGuardado: () => {},
    setFase: f => fases.push(f),
  };
  // Cualquier otra API de escritura queda cableada a una trampa que sólo
  // registra haber sido llamada.
  APIS_ESCRITURA.filter(n => !args[n]).forEach(n => {
    args[n] = async () => { apisLlamadas.push(n); return true; };
  });

  const fabrica = new Function(...LIBRES, `${srcConfirmar}; return confirmarCatalogo;`);
  const fn = fabrica(...LIBRES.map(k => args[k]));
  return fn().then(() => ({ escrituras, errores, fases, apisLlamadas }));
}

// Dobles de lectura.
const snapCon = (data) => ({ exists: () => true, data: () => data });
const snapSin = () => ({ exists: () => false, data: () => undefined });
const leerOk      = () => snapCon({ data: AVANCE_PREVIO });
const leerVacio   = () => snapSin();
const leerFalla   = () => { const e = new Error('client is offline'); e.code = 'unavailable'; throw e; };

const subsDe = (escrituras) => {
  const w = escrituras.find(e => String(e.path).includes('avance/subs'));
  return w ? w.data.data : null;
};

// ── Las pruebas ────────────────────────────────────────────────────────
(async () => {

console.log('\n1. Falla la lectura del avance previo — ¿se borra el avance?');
{
  const { escrituras, errores, fases, apisLlamadas } = await correr({ lectura: leerFalla });
  check(subsDe(escrituras) === null,
    'no se escribe `avance/subs` cuando no se pudo leer el avance previo');
  check(escrituras.length === 0,
    `no se escribe NADA, tampoco el catálogo (escrituras: ${escrituras.length})`);
  // LA GARANTÍA DE SEGURIDAD. No basta con que la escritura "no llegue":
  // Firestore encola las mutaciones offline y las manda al reconectar, así
  // que hay que no EMITIRLAS. Se aborta antes de invocar ninguna API.
  check(apisLlamadas.length === 0,
    `no se invoca NINGUNA API de escritura, así que nada se encola para mandarse al reconectar (invocadas: ${apisLlamadas.join(', ') || 'ninguna'})`);
  check(errores.length === 1,
    'se le dice al usuario por qué no se reemplazó');
  check(!fases.includes('confirmado'),
    'la pantalla NO pasa a "confirmado" — no puede decir listo sin haber guardado');
  if (errores[0]) {
    check(/no se reemplaz|no se cambió|NO se/i.test(errores[0]),
      `el mensaje dice que no se reemplazó: "${String(errores[0]).slice(0, 60)}…"`);
  }
}

console.log('\n2. Lectura correcta — ¿se preserva el avance?');
{
  const { escrituras, errores, fases } = await correr({ lectura: leerOk });
  const subs = subsDe(escrituras);
  check(Array.isArray(subs) && subs.length === 2, 'se escriben las 2 partidas del catálogo nuevo');
  if (subs) {
    check(subs[0].a === 80 && subs[0].cantEjec === 80, `A-01 conserva a=${subs[0].a} cantEjec=${subs[0].cantEjec} (esperado 80/80)`);
    check(subs[1].a === 45 && subs[1].cantEjec === 22.5, `A-02 conserva a=${subs[1].a} cantEjec=${subs[1].cantEjec} (esperado 45/22.5)`);
    check(subs[0].fotos && subs[0].fotos.f1 === 'url', 'las fotos de A-01 sobreviven');
    check(subs[0].cant === 100 && subs[0].pu === 6, 'los volúmenes del catálogo NUEVO sí se aplican');
  }
  check(errores.length === 0, 'no se reporta error en el camino feliz');
  check(fases.includes('confirmado'), 'la pantalla pasa a "confirmado"');
}

console.log('\n3. Obra sin avance previo — ¿sigue funcionando?');
{
  const { escrituras, errores, fases } = await correr({ lectura: leerVacio });
  const subs = subsDe(escrituras);
  check(Array.isArray(subs) && subs.length === 2,
    'documento ausente es legítimo: se escribe el catálogo igual');
  if (subs) check(subs[0].a === 0 && subs[0].cantEjec === 0, 'las partidas arrancan en cero, que aquí sí es el dato correcto');
  check(errores.length === 0, 'no se trata como error');
  check(fases.includes('confirmado'), 'la pantalla pasa a "confirmado"');
}

console.log('\n4. Primera carga (sin catálogo guardado) — no hay nada que preservar');
{
  const { escrituras, fases } = await correr({ lectura: leerFalla, catalogoGuardado: null });
  check(subsDe(escrituras) !== null,
    'sin catálogo previo no se lee avance, así que un fallo de lectura no bloquea la primera carga');
  check(fases.includes('confirmado'), 'la primera carga sí confirma');
}

console.log('\n5. Falla la ESCRITURA — ¿la pantalla miente?');
{
  const { errores, fases } = await correr({ lectura: leerOk, escrituraOk: false });
  check(errores.length >= 1, 'una escritura fallida se le reporta al usuario');
  check(!fases.includes('confirmado'),
    'no se pasa a "confirmado" si el guardado falló (`fsSetA` devuelve false, no lanza)');
}

console.log('\n6. El camino de lectura no pasa por un helper que se trague el error');
{
  let usaFsGet = false, usaGetDoc = false, usaDesdeServidor = false;
  traverse(ast, {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== 'confirmarCatalogo') return;
      p.traverse({
        CallExpression(c) {
          const n = c.node.callee;
          if (n?.name === 'fsGet') usaFsGet = true;
          if (n?.name === 'getDoc') usaGetDoc = true;
          if (n?.name === 'getDocFromServer') usaDesdeServidor = true;
        },
      });
    },
  });
  check(!usaFsGet, 'confirmarCatalogo no usa `fsGet` (que hace catch{return null})');
  // `getDoc` cae a la caché cuando no hay servidor, y este documento siempre
  // está en caché por el listener de avance/subs. Con `getDoc` el aborto no
  // se dispararía offline: resolvería con datos locales y seguiría a escribir.
  check(usaDesdeServidor && !usaGetDoc,
    'lee con `getDocFromServer`, no `getDoc`: sin servidor falla en vez de caer a la caché');
}

console.log('\n7. Encabezado de la tabla del dashboard');
{
  const miente = /Obras\s*—\s*ordenadas por margen/i.test(codigo);
  check(!miente,
    'el encabezado ya no afirma un orden fijo — el usuario ordena por columna');
  const ordenable = /ordenTabla/.test(codigo) && /cmpFilas/.test(codigo);
  check(ordenable,
    'y sigue existiendo el ordenamiento por columna que lo volvía mentira');
}

// ── Resultado ──────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
if (fallos.length === 0) {
  console.log('TODO EN VERDE — recargar catálogo ya no puede borrar avance.');
  process.exit(0);
}
console.log(`${fallos.length} FALLA(S):`);
fallos.forEach(f => console.log('  · ' + f));
process.exit(1);

})().catch(e => {
  console.log(`\n✗ la prueba reventó: ${e.message}`);
  console.log('  (si corres contra una versión vieja, esto también cuenta como falla)');
  process.exit(1);
});
