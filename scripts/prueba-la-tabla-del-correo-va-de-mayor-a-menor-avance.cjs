#!/usr/bin/env node
// LA TABLA DEL RESUMEN SEMANAL VA DE MAYOR A MENOR AVANCE FÍSICO
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El correo de los viernes se leía revuelto. No le faltaba ningún dato: la
// tabla iba ordenada por PRESUPUESTO descendente, y el presupuesto ya tiene su
// propia columna. Entonces la columna de avance —que es la que el director
// recorre— subía y bajaba sin patrón, y la tabla parecía no tener ninguno.
//
// El orden de una tabla AFIRMA algo, se quiera o no: la primera fila se lee
// como «la obra que va más adelantada». Esa afirmación era falsa, y era falsa
// en silencio, porque una tabla ordenada por una columna que el lector no está
// mirando se ve igual que una tabla sin ordenar.
//
// ── QUÉ AFIRMA ESTE BANCO ───────────────────────────────────────────────────
// No afirma que exista un `.sort`. Monta el manejador real de
// `resumenSemanalEmail` sobre un Firestore de mentira, lo EJECUTA, y lee el
// orden de las filas DEL HTML que salió por correo —el que llega al buzón—,
// con el porcentaje que cada fila imprime.
//
// La siembra está hecha para que el banco no pueda pasar por casualidad: el
// orden por avance, el orden por presupuesto y el orden en que la base
// devuelve las obras son los TRES DISTINTOS. Un banco cuyo orden esperado
// coincide con el orden de siembra está verde sin haber ordenado nada, y §3
// existe para comprobar justamente eso.
//
// Y el desempate se mide aparte (§4). `avanceFisicoPonderado` devuelve 0 por
// dos caminos —la obra que no arrancó y la que no tiene presupuesto con el que
// dividir—, así que el empate en 0 es el caso normal. Sin segundo criterio esas
// filas salen en el orden en que Firestore las devolvió, que no está garantizado
// entre corridas: la tabla se reacomodaría de un viernes a otro sin que nada
// hubiera avanzado.
//
// Uso:
//   node scripts/prueba-la-tabla-del-correo-va-de-mayor-a-menor-avance.cjs
//   node scripts/prueba-la-tabla-del-correo-va-de-mayor-a-menor-avance.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');

const ORDEN_NUEVO =
  `  const kpisValidos = kpisObras.filter(Boolean)\n` +
  `    .sort((a, b) => (b.avancePct || 0) - (a.avancePct || 0) ||\n` +
  `                    (b.presupuesto || 0) - (a.presupuesto || 0));`;

// ── La contraprueba ─────────────────────────────────────────────────────────
// Las dos mutaciones son el código REAL de antes de este cambio y el medio
// camino: volver al presupuesto, y ordenar por avance sin desempate.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    { nombre: 'la tabla vuelve a ordenarse por presupuesto, como se veía revuelta',
      de: ORDEN_NUEVO,
      a: `  const kpisValidos = kpisObras.filter(Boolean)\n` +
         `    .sort((a, b) => (b.presupuesto || 0) - (a.presupuesto || 0));` },
    { nombre: 'ordena por avance pero sin desempate: las obras en 0 quedan al azar de la base',
      de: ORDEN_NUEVO,
      a: `  const kpisValidos = kpisObras.filter(Boolean)\n` +
         `    .sort((a, b) => (b.avancePct || 0) - (a.avancePct || 0));` },
    { nombre: 'ordena de menor a mayor: el orden existe y es el contrario del que se pidió',
      de: ORDEN_NUEVO,
      a: `  const kpisValidos = kpisObras.filter(Boolean)\n` +
         `    .sort((a, b) => (a.avancePct || 0) - (b.avancePct || 0));` },
    { nombre: 'el orden se pierde del todo: la tabla sale como la devolvió la base',
      de: ORDEN_NUEVO,
      a: `  const kpisValidos = kpisObras.filter(Boolean);` },
  ];
  let malas = 0;
  for (const m of MUTACIONES) {
    const base = fs.readFileSync(ARCH_FUNCS, 'utf8');
    if (!base.includes(m.de)) {
      console.log(`SIN APLICAR  ${m.nombre}`);
      console.log(`             el texto a mutar ya no está en ${path.basename(ARCH_FUNCS)}.`);
      malas++; continue;
    }
    const roto = path.join(os.tmpdir(),
      `orden-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(roto, base.replace(m.de, () => m.a));
    const r = spawnSync(process.execPath, [__filename],
      { encoding: 'utf8', env: { ...process.env, ARCH_FUNCS: roto } });
    const rojas = (r.stdout.match(/^FALLA/gm) || []).length;
    const ok = r.status === 1 && rojas > 0;
    console.log(`${ok ? `ROJA ×${String(rojas).padStart(2)}  ` : 'NO LA VE   '}  ${m.nombre}`);
    if (!ok) {
      malas++;
      console.log(`             salió con ${r.status} y ${rojas} comprobación(es) en rojo. ` +
        'Una mutación que no se ve es una aserción que no mide.');
      console.log((r.stdout + r.stderr).split('\n').slice(-16).map(l => '             ' + l).join('\n'));
    } else {
      for (const l of r.stdout.match(/^FALLA.*/gm) || []) console.log(`             ${l.replace(/^FALLA\s+/, '· ')}`);
    }
    fs.unlinkSync(roto);
  }
  console.log(malas === 0
    ? `\nLas ${MUTACIONES.length} mutaciones se ven. La prueba mide lo que dice medir.`
    : `\n${malas} mutación(es) pasaron inadvertidas.`);
  process.exit(malas > 0 ? 1 : 0);
}

const andamios = require('./montar-trabajo-de-funciones.cjs');
const { baseFalsa } = andamios;
const montar = (nombreExport, base, opciones) =>
  andamios.montar(ARCH_FUNCS, nombreExport, base, opciones);

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── La siembra ─────────────────────────────────────────────────────────────
// Cinco obras activas. El avance sale de `avance/subs` por la fórmula real
// —(a/100)·imp sobre el presupuesto—, no se teclea: así el banco mide el mismo
// número que la pantalla y no una copia suya.
//
// Las tres listas no coinciden a propósito:
//
//   por avance        0202(90)  0203(50)  0201(10)  0204(0)  0205(0)
//   por presupuesto   0201(9M)  0203(4M)  0204(2M)  0202(1M) 0205(0)
//   como se siembran  0201      0205      0204      0203     0202
//
// El par 0204 / 0205 empata en 0 y se siembra al revés del desempate: es lo
// que hace visible que el presupuesto rompe el empate y no el azar de la base.
const ORG = 'fosmon';
const OBRAS = [
  // id      nombre                presupuesto  imp del catálogo  % capturado
  ['0201', '0201 EL MALECON',        9000000,      9000000,          10],
  ['0205', '0205 SIN PRESUPUESTO',         0,       500000,          40],
  ['0204', '0204 EL CAMINO',          2000000,            0,           0],
  ['0203', '0203 EL PUENTE',          4000000,      4000000,          50],
  ['0202', '0202 LA ESCOLLERA',       1000000,      1000000,          90],
];

// Lo que la tabla tiene que imprimir, en este orden. Los porcentajes se
// escriben aquí para que el banco falle también si el orden sale bien pero el
// número impreso no es el avance que la obra tiene.
const ESPERADO = [
  ['0202', '90.0%'],
  ['0203', '50.0%'],
  ['0201', '10.0%'],
  ['0204', '0.0%'],
  ['0205', '0.0%'],
];

function siembra() {
  const d = {};
  d[`orgs/${ORG}`] = { nombre: 'FOSMON', tipo: 'constructora', activa: true };
  d[`orgs/${ORG}/config/branding`] = { empresa: 'FOSMON', empresaCorta: 'FOSMON' };
  for (const [id, nombre, presupuesto, imp, pct] of OBRAS) {
    d[`obras/${id}`] = { nombre, estado: 'activa' };
    d[`obras/${id}/config/info`] = {
      nombre, presupuesto, contrato: `C-${id}`, cliente: 'PEMEX', gastoGP: 1000,
    };
    if (imp > 0) d[`obras/${id}/avance/subs`] = { data: [{ imp, a: pct }] };
    d[`obras/${id}/avance/historial`] = { semanas: [{ id: 'S01-2020', fecha: '2020-01-05' }] };
  }
  d['usuarios/dg_fosmon_com_mx'] = {
    nombre: 'Daniel Director', correo: 'dg@fosmon.com.mx', email: 'dg@fosmon.com.mx',
    rol: 'director_general', orgId: ORG, activo: true, uid: 'uid-dg',
  };
  return d;
}

// ── Las filas, leídas del HTML que salió ───────────────────────────────────
// Del correo, no de la lista que lo armó: lo que se mide es lo que llega al
// buzón. Cada fila trae su obra en el enlace y su avance en la celda rotulada
// «avance», y las dos se sacan juntas para que una fila con el número de otra
// no pase por buena.
function filasDelCorreo(html) {
  const tbody = (html.split('<tbody>')[1] || '').split('</tbody>')[0] || '';
  return tbody.split('<tr>').slice(1).map((tr) => {
    const obra = (tr.match(/\?obra=([^"&]+)/) || [])[1] || null;
    const pct = (tr.match(/>([\d.]+%)<\/div>\s*<div[^>]*>avance<\/div>/) || [])[1] || null;
    return { obra, pct };
  });
}

(async () => {
  console.log('\n── LA TABLA DEL RESUMEN SEMANAL ──\n');

  const base = baseFalsa(siembra());
  const correos = [];
  await montar('resumenSemanalEmail', base, { correos })({});

  const html = (correos[0] || {}).html || '';
  const filas = filasDelCorreo(html);

  // ═══ §0 · EL BANCO PUDO LEER LA TABLA ═════════════════════════════════════
  // Sin esta parada, un cambio de maquetado que rompa la extracción dejaría
  // todas las comprobaciones de abajo midiendo una lista vacía, y una lista
  // vacía está ordenada.
  if (correos.length !== 1 || filas.length !== OBRAS.length ||
      filas.some(f => !f.obra || !f.pct)) {
    noArranco([
      `salieron ${correos.length} correo(s) y se leyeron ${filas.length} fila(s) ` +
      `de las ${OBRAS.length} sembradas: ${JSON.stringify(filas)}`,
      'Esta prueba lee el orden del HTML del correo. Si no puede leer las filas,',
      'no está midiendo el orden: está midiendo una lista vacía, que siempre',
      'sale ordenada. Probablemente cambió la maqueta de la tabla.',
    ], 'functions/index.js · correoResumenSemanal');
  }

  // ═══ §1 · EL ORDEN ES EL AVANCE, DE MAYOR A MENOR ═════════════════════════
  console.log('§1 · el orden de las filas');
  const salio = filas.map(f => `${f.obra} ${f.pct}`).join(' · ');
  const esperado = ESPERADO.map(([o, p]) => `${o} ${p}`).join(' · ');
  check(salio === esperado,
    'la tabla llega ordenada por avance físico, de mayor a menor',
    salio === esperado ? salio : `salió  ${salio}\n            esperaba  ${esperado}`);

  const pcts = filas.map(f => parseFloat(f.pct));
  const baja = pcts.every((p, i) => i === 0 || pcts[i - 1] >= p);
  check(baja,
    'y ninguna fila va por encima de la de arriba: el que lee de arriba abajo no retrocede',
    pcts.map(p => `${p}%`).join(' ≥ '));

  // ═══ §2 · ORDENAR NO QUITÓ, NO DUPLICÓ Y NO MOVIÓ EL DINERO ═══════════════
  // La gemela en verde. Un orden nuevo que pierda una fila o sume dos veces la
  // misma cambia los cuatro totales del mosaico, y eso sería mucho peor que
  // una tabla revuelta.
  console.log('');
  console.log('§2 · lo que el orden no tenía que tocar');
  const ids = filas.map(f => f.obra);
  check(new Set(ids).size === OBRAS.length,
    'las cinco obras siguen ahí, una sola vez cada una',
    `${new Set(ids).size} obra(s) distintas en ${ids.length} fila(s)`);

  check(/>5<\/div>\s*<div[^>]*>Obras activas/.test(html),
    'el mosaico sigue diciendo 5 obras activas',
    /<div[^>]*>(\d+)<\/div>\s*<div[^>]*>Obras activas/.exec(html)
      ? `dice ${/<div[^>]*>(\d+)<\/div>\s*<div[^>]*>Obras activas/.exec(html)[1]}` : 'no se pudo leer');

  const presupuestoTotal = OBRAS.reduce((t, o) => t + o[2], 0);
  const impreso = `$${presupuestoTotal.toLocaleString('en-US')}`;
  check(html.includes(impreso),
    'y el presupuesto total sigue sumando las cinco',
    `esperaba ${impreso}`);

  // ═══ §3 · LA SIEMBRA NO REGALA EL RESULTADO ═══════════════════════════════
  // Si el orden esperado coincidiera con el de presupuesto, o con el de
  // siembra, §1 estaría verde sin que nadie hubiera ordenado nada. Esto NO
  // mide el código: mide que el banco sea capaz de ver el defecto.
  console.log('');
  console.log('§3 · la siembra distingue los tres órdenes');
  const porPresupuesto = [...OBRAS].sort((a, b) => b[2] - a[2]).map(o => o[0]).join(' ');
  const comoSeSiembra = OBRAS.map(o => o[0]).join(' ');
  const porAvance = ESPERADO.map(e => e[0]).join(' ');
  check(porAvance !== porPresupuesto,
    'el orden por avance NO es el orden por presupuesto',
    `avance [${porAvance}] · presupuesto [${porPresupuesto}]`);
  check(porAvance !== comoSeSiembra,
    'ni es el orden en que la base devuelve las obras',
    `avance [${porAvance}] · base [${comoSeSiembra}]`);

  // ═══ §4 · EL EMPATE EN 0 LO ROMPE EL PRESUPUESTO, NO EL AZAR ══════════════
  console.log('');
  console.log('§4 · las dos obras que empatan en 0% de avance');
  const i04 = ids.indexOf('0204'), i05 = ids.indexOf('0205');
  check(i04 >= 0 && i05 >= 0 && i04 < i05,
    'empatadas en 0, va primero la del presupuesto mayor — y no la que la base devolvió antes',
    `0204 ($2,000,000) en la fila ${i04 + 1}, 0205 ($0) en la ${i05 + 1}; ` +
    'la base las devuelve 0205 antes que 0204');

  // La corrida se repite sobre una base sembrada AL REVÉS. Si el desempate
  // viniera del orden de la base y no del presupuesto, aquí se vería.
  const alReves = baseFalsa((() => {
    const d = siembra();
    const invertido = {};
    for (const k of Object.keys(d).reverse()) invertido[k] = d[k];
    return invertido;
  })());
  const correos2 = [];
  await montar('resumenSemanalEmail', alReves, { correos: correos2 })({});
  const ids2 = filasDelCorreo((correos2[0] || {}).html || '').map(f => f.obra);
  check(ids2.join(' ') === porAvance,
    'y la tabla sale igual si la base devuelve las obras en el orden contrario',
    `salió [${ids2.join(' ')}]`);

  console.log('');
  if (fallas) {
    console.log('Una tabla ordenada por una columna que el lector no está mirando se');
    console.log('ve igual que una tabla sin ordenar, y su primera fila afirma algo');
    console.log('falso sin que nadie lo note.');
    console.log('');
  }
  console.log(`${fallas === 0 ? 'VERDE' : 'ROJO'} · ${fallas} comprobación(es) en rojo`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch((e) => {
  noArranco([`la prueba reventó: ${e.message}`, ...(e.stack || '').split('\n').slice(1, 5)],
    'prueba-la-tabla-del-correo-va-de-mayor-a-menor-avance.cjs');
});
