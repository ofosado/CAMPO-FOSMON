#!/usr/bin/env node
// Prueba: UN TRABAJO PROGRAMADO QUE REVIENTA TIENE QUE LANZAR.
//
// ── DE DÓNDE SALE ──────────────────────────────────────────────────────────
// Cloud Scheduler decide si una corrida salió bien por una sola cosa: si el
// manejador lanzó o no. Un `catch` que registra el fallo y no relanza le dice
// a Scheduler «todo en orden». Consecuencias, las tres a la vez:
//
//   · no hay reintento — Scheduler sólo reintenta lo que falló;
//   · no hay alerta — el panel de errores de Cloud Functions se queda vacío;
//   · la única constancia queda en `global/health`, que es una pantalla que
//     alguien tiene que acordarse de abrir.
//
// Es el #75 por el otro extremo. Allá el canal con el que uno se entera se
// tragaba su propio fallo; aquí es el trabajo el que se traga el suyo, y el
// efecto es peor, porque el silencio viene FIRMADO como éxito.
//
// Al 2026-10-26 lo tenían cuatro de los seis trabajos. Les faltaba a
// `recordatorioCapturaObra` y a `recordatorioLunes`, que se quedaron fuera
// del #75 a propósito para no mezclar tandas. Este banco cierra los dos y, de
// paso, deja de preguntar por esos dos en particular: **recorre todos los
// `onSchedule` que haya en el archivo**. El trabajo que alguien agregue
// mañana entra solo.
//
// ── QUÉ AFIRMA ESTE BANCO ──────────────────────────────────────────────────
// Nada de que un símbolo exista (P3). Cada manejador se EXTRAE POR AST de
// `functions/index.js` y se EJECUTA de verdad. No hace falta emulador: todo
// lo que el manejador toca del mundo exterior se sustituye por una MINA —un
// objeto que estalla en cuanto lo rozan— así que el trabajo revienta en su
// primera línea útil, pase lo que pase dentro. Lo único que no es mina son
// `registrarSalud` y `registrarFalloDeSalud`, que se dejan pasar para poder
// mirar qué quedó anotado.
//
// Por cada trabajo programado, tres cosas:
//   (a) el manejador RECHAZA — si resuelve, Scheduler lo cuenta como bueno;
//   (b) antes de lanzar deja constancia por `registrarFalloDeSalud`, con su
//       propio tipo: lanzar sin anotar cambia un silencio por otro;
//   (c) no queda ningún `registrarSalud(tipo, true, …)`: una corrida que
//       reventó no puede haber dejado un verde escrito.
//
// Que (a) y (b) se exijan JUNTAS es el punto. Por separado, cada una se
// cumple de la forma equivocada: sólo (a) es un `throw` pelón que no deja
// rastro, y sólo (b) es exactamente el defecto que estamos arreglando.
//
// ── LA CONTRAPRUEBA ─────────────────────────────────────────────────────────
// Acepta `functions/index.js` por `ARCH_FNS` para correrse contra copias
// mutiladas. Una mutación por trabajo: se le quita su `throw e`. Cada una
// tiene que salir ROJO (1), nunca NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-cron-que-no-se-traga-su-fallo.cjs
//       node scripts/prueba-cron-que-no-se-traga-su-fallo.cjs --contraprueba

require('./reloj.cjs');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');

const ARCH_FNS = process.env.ARCH_FNS || path.join(raiz, 'functions/index.js');

// Cuántos trabajos programados esperamos encontrar como MÍNIMO. No es un
// número decorativo: si la extracción por AST se rompe —porque alguien
// cambió la forma de declarar los crones— el banco se quedaría sin nada que
// medir y saldría VERDE por vacío. Eso es exactamente el P7: sin insumo se
// sale NO ARRANCÓ, nunca verde.
const MINIMO_TRABAJOS = 6;

// ── La contraprueba ────────────────────────────────────────────────────────
// Corre primero, antes de abrir nada, porque relanza este mismo archivo.
//
// Cada mutación le quita su `throw e` a UN trabajo. El ancla no puede ser
// texto literal: el `throw e;` a secas aparece seis veces, y pegarle delante
// la llamada a `registrarFalloDeSalud` tampoco basta porque entre las dos
// líneas hay comentarios que explican por qué está ahí —y un comentario que
// crece no debe apagar una contraprueba—. Así que se localiza la llamada por
// su tipo, que sí es único, y se borra el PRIMER `throw e;` que venga
// después. Si no aparece ninguno cerca, SIN APLICAR: eso ya es la noticia.
const QUITAR_THROW = (fuente, tipo) => {
  const i = fuente.indexOf(`registrarFalloDeSalud("${tipo}"`);
  if (i < 0) return null;
  const ventana = fuente.slice(i, i + 1200);
  const j = ventana.search(/^[ \t]*throw e;[ \t]*\r?\n/m);
  if (j < 0) return null;
  const m = ventana.match(/^[ \t]*throw e;[ \t]*\r?\n/m);
  return fuente.slice(0, i + j) + fuente.slice(i + j + m[0].length);
};

if (process.argv[2] === '--contraprueba') {
  const MUTACIONES = [
    'permisos_denegados', 'gp_sync', 'email_semanal',
    'backup', 'recordatorio_obra', 'recordatorio_lunes',
  ].map((tipo) => ({
    tipo,
    nombre: `el trabajo de «${tipo}» se traga su fallo y Scheduler lo da por bueno`,
  }));

  const base = fs.readFileSync(ARCH_FNS, 'utf8');
  let malas = 0;
  for (const m of MUTACIONES) {
    const roto = QUITAR_THROW(base, m.tipo);
    if (roto === null) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             no se halló un \`throw e;\` después de ` +
        `registrarFalloDeSalud("${m.tipo}"…) en functions/index.js.`);
      malas++; continue;
    }
    const arch = path.join(os.tmpdir(),
      `cron-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(arch, roto);
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_FNS: arch } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      console.log((r.stdout + r.stderr).split('\n').slice(-14).map((l) => '             ' + l).join('\n'));
    }
    try { fs.unlinkSync(arch); } catch {}
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven.`
    : `\n${malas} de ${MUTACIONES.length} NO se ven.`);
  process.exit(malas === 0 ? 0 : 1);
}

// ── El banco ───────────────────────────────────────────────────────────────
noArranco.vigilarExcepciones(ARCH_FNS);

const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

const OPCIONES_PARSE = {
  sourceType: 'script',
  plugins: ['optionalChaining', 'nullishCoalescingOperator', 'dynamicImport'],
};

const src = fs.readFileSync(ARCH_FNS, 'utf8');
const ast = parse(src, OPCIONES_PARSE);

// ── Extracción ─────────────────────────────────────────────────────────────
// Los manejadores de `exports.X = onSchedule(config, manejador)`, tomados por
// POSICIÓN —el segundo argumento— porque no tienen nombre. Se recogen todos:
// la lista no está escrita aquí a mano, justo para que un trabajo nuevo no
// pueda nacer sin esta exigencia.
const trabajos = [];
traverse(ast, {
  AssignmentExpression(p) {
    const izq = p.node.left;
    if (izq.type !== 'MemberExpression') return;
    if (izq.object.name !== 'exports' || !izq.property.name) return;
    const der = p.node.right;
    if (der.type !== 'CallExpression') return;
    const llamada = der.callee.name || der.callee.property?.name;
    if (llamada !== 'onSchedule' || der.arguments.length < 2) return;
    trabajos.push({
      nombre: izq.property.name,
      fuente: src.slice(der.arguments[1].start, der.arguments[1].end),
    });
  },
});

if (trabajos.length < MINIMO_TRABAJOS) {
  noArranco(
    [`sólo se extrajeron ${trabajos.length} manejadores de onSchedule y se esperaban ` +
     `al menos ${MINIMO_TRABAJOS}; sin manejadores este banco saldría verde por vacío`],
    path.relative(raiz, ARCH_FNS));
}

// Las variables libres de cada manejador, calculadas por el analizador de
// ámbitos de Babel en vez de a ojo: si mañana el manejador usa algo nuevo,
// se inyecta solo.
function libresDe(fuente) {
  const envoltura = parse(`const __manejador = ${fuente};`, OPCIONES_PARSE);
  let globales = [];
  traverse(envoltura, {
    Program(p) { globales = Object.keys(p.scope.globals); p.stop(); },
  });
  return globales;
}

// Lo que se deja ser de verdad. Todo lo demás es mina: no porque dé igual,
// sino porque el banco no mide QUÉ hace el trabajo, mide qué hace cuando lo
// que hace falla.
const DE_VERDAD = new Set([
  'Date', 'console', 'JSON', 'Math', 'Object', 'Array', 'Number', 'String',
  'Boolean', 'Promise', 'Set', 'Map', 'Error', 'RegExp', 'parseInt',
  'parseFloat', 'isNaN', 'isFinite', 'Symbol', 'BigInt',
]);

// La mina. Estalla si la llaman, si la construyen o si le piden cualquier
// propiedad. No lleva salvoconducto para `then`: si alguien la espera con
// `await`, también estalla, que es justo lo que se quiere.
const mina = (nombre) => new Proxy(function () {}, {
  get(_, prop) { throw new Error(`MINA: se tocó ${nombre}.${String(prop)}`); },
  apply() { throw new Error(`MINA: se llamó ${nombre}()`); },
  construct() { throw new Error(`MINA: new ${nombre}()`); },
});

// ── Andamiaje de aserciones ────────────────────────────────────────────────
let fallas = 0;
const check = (cond, que, detalle) => {
  if (cond) console.log(` ok   ${que}${detalle ? `  ·  ${detalle}` : ''}`);
  else { fallas++; console.log(`FALLA  ${que}${detalle ? `  ·  ${detalle}` : ''}`); }
};

// Arma un manejador con su mundo sustituido y lo corre hasta el final.
// Devuelve qué pasó, nunca lanza: una regresión que propague la excepción
// hasta aquí tiene que salir ROJO (1), no NO ARRANCÓ (2).
async function correr(trabajo) {
  const anotados = { verdes: [], fallos: [] };

  const registrarSalud = async (tipo, ok, mensaje, meta) => {
    anotados.verdes.push({ tipo, ok, mensaje, meta });
  };
  const registrarFalloDeSalud = async (tipo, error, meta) => {
    anotados.fallos.push({ tipo, error, meta });
  };

  const libres = libresDe(trabajo.fuente).filter((n) => !DE_VERDAD.has(n));
  const valores = libres.map((n) => {
    if (n === 'registrarSalud') return registrarSalud;
    if (n === 'registrarFalloDeSalud') return registrarFalloDeSalud;
    return mina(n);
  });

  let manejador;
  try {
    manejador = new Function(...libres, `return (${trabajo.fuente});`)(...valores);
  } catch (e) {
    // Esto no es un fallo del código medido, es que el banco no pudo armarlo.
    return { armado: false, porQue: e?.message || String(e), anotados };
  }

  try {
    await manejador({ scheduleTime: new Date().toISOString() });
    return { armado: true, lanzo: false, anotados };
  } catch (e) {
    return { armado: true, lanzo: true, error: e, anotados };
  }
}

// ── La medición ────────────────────────────────────────────────────────────
(async () => {
  console.log(`Trabajos programados encontrados en ${path.relative(raiz, ARCH_FNS)}: ` +
    `${trabajos.length} (${trabajos.map((t) => t.nombre).join(', ')})\n`);

  for (const trabajo of trabajos) {
    const r = await correr(trabajo);

    if (!r.armado) {
      // Que el banco no sepa armar un manejador es falta de insumo, no un
      // defecto del código: P7, se sale sin veredicto en vez de inventar uno.
      noArranco(
        [`no se pudo construir el manejador de ${trabajo.nombre}: ${r.porQue}`],
        path.relative(raiz, ARCH_FNS));
    }

    const unFallo = r.anotados.fallos.length === 1 ? r.anotados.fallos[0] : null;
    const verdesEscritos = r.anotados.verdes.filter((v) => v.ok === true);

    check(r.lanzo === true,
      `${trabajo.nombre}: lanza cuando su trabajo revienta`,
      r.lanzo ? `${(r.error?.message || '').slice(0, 48)}` :
        'resolvió — Scheduler contaría esta corrida como exitosa');

    check(unFallo !== null,
      `${trabajo.nombre}: deja constancia del fallo antes de lanzar`,
      unFallo ? `registrarFalloDeSalud("${unFallo.tipo}")`
        : `se anotaron ${r.anotados.fallos.length} fallos, se esperaba 1`);

    check(verdesEscritos.length === 0,
      `${trabajo.nombre}: no deja ningún verde escrito de una corrida que reventó`,
      verdesEscritos.length === 0 ? 'sin verdes'
        : `quedó ${verdesEscritos.map((v) => `${v.tipo}:true`).join(', ')}`);
  }

  console.log(`\n${fallas === 0 ? 'Verde' : `ROJO · ${fallas} en rojo`} ` +
    `· ${trabajos.length} trabajos × 3 comprobaciones`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
