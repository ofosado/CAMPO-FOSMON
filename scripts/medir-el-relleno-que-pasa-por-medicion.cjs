#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿CUÁNTAS CIFRAS PUBLICADAS HOY SON RELLENO? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. Dos sitios distintos escriben un número cuando el dato NO ESTÁ, y
// ese número sale publicado como si lo hubieran medido:
//
//   #58 (el EST-NaN) — `src/App.jsx:17313` numera la estimación nueva con
//       `Math.max(...es.map(e => e.no)) + 1`. Si UNA SOLA estimación guardada
//       no trae `no`, o lo trae como cadena vacía, el máximo es `NaN`, el
//       sucesor es `NaN`, y la pantalla rotula la estimación «EST-NaN». El
//       mismo conteo del lado de subcontratos (`src/App.jsx:21793`) sí lleva
//       `parseInt(e.no) || 0`: es la misma cuenta escrita dos veces, una con
//       guarda y otra sin ella.
//
//   #79 (el 999 del correo del lunes) — `functions/index.js:2480` pone
//       `diasDesdeCaptura = 999` cuando `obras/{id}/avance/subs` no tiene
//       `fecha`. Ese 999 no se midió. Y aguas abajo decide dos cosas que se
//       publican: el correo de dirección imprime «Sin captura 999d» en rojo
//       (`functions/index.js:2600`) y la obra entra en el conteo de
//       `obrasSinCaptura` (`functions/index.js:2630`). Una obra recién dada de
//       alta —que no tiene captura porque no ha empezado— aparece como la más
//       atrasada del portafolio. El hermano de este defecto en
//       `recordatorioLunes` ya está arreglado; esta copia sigue viva.
//
// QUÉ SE MIDE, Y POR QUÉ ESO. La pregunta no es «¿puede pasar?» —el código ya
// dice que puede— sino «¿está pasando hoy, y en cuáles?»:
//
//   1. ESTIMACIONES SIN `no` USABLE. Una basta para envenenar el `Math.max` de
//      toda la obra. Se cuenta por obra y se dice cuál sería el rótulo.
//   2. OBRAS CUYO `avance/subs` NO TIENE `fecha`. Ésas son exactamente las que
//      el correo del lunes está acusando de 999 días sin captura.
//   3. SI ADEMÁS ESTÁN ACTIVAS. Una obra archivada con 999 es ruido; una obra
//      activa con 999 es una acusación falsa que alguien lee cada lunes.
//
// SÓLO LEE, Y NO POR DISCIPLINA SINO POR CONSTRUCCIÓN. La única función de red
// de este archivo es `leer()`, y hace GET. No hay PATCH, ni POST, ni DELETE, ni
// `firebase-admin` —que es el que trae `.set()` detrás—. Una bandera se puede
// teclear mal; un verbo que no está escrito no se puede mandar.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-el-relleno-que-pasa-por-medicion.cjs --prod
//
// Contra el emulador, para ensayarlo sin tocar nada de afuera:
//     EMU_HOST=127.0.0.1:8080 node scripts/medir-el-relleno-que-pasa-por-medicion.cjs

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-el-relleno-que-pasa-por-medicion.cjs --prod\n');
  process.exit(2);
}

// LA ÚNICA PUERTA A LA RED. GET y nada más.
async function leer(ruta) {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: 'GET',
    headers: DESTINO.prod
      ? { Authorization: `Bearer ${TOKEN}`, 'X-Goog-User-Project': PROYECTO }
      : { Authorization: 'Bearer owner' },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    console.error(`\nNO ARRANCÓ: HTTP ${r.status} en ${ruta}`);
    console.error((await r.text()).slice(0, 300));
    process.exit(2);
  }
  return r.json();
}

const txt = (f, k) => f?.[k]?.stringValue ?? null;

async function todaLaColeccion(ruta) {
  const docs = [];
  let token = null;
  do {
    const sep = ruta.includes('?') ? '&' : '?';
    const j = await leer(`${ruta}${sep}pageSize=300${token ? `&pageToken=${token}` : ''}`);
    if (!j) break;
    docs.push(...(j.documents || []));
    token = j.nextPageToken || null;
  } while (token);
  return docs;
}

// Un valor REST a algo que JavaScript pueda sumar o comparar, SIN normalizar
// de más: la gracia de esta medición es distinguir `3` de `"3"` de `""` de
// ausente, porque `Math.max` los trata distinto y ahí está el defecto.
function crudo(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  return undefined;
}

const arreglo = (campo) => (campo?.arrayValue?.values || []).map(v => v?.mapValue?.fields || {});

// La cuenta de `src/App.jsx:17313`, tal cual, sin guarda. No se reescribe
// «mejor»: el punto es reproducir lo que la aplicación hace hoy.
const comoLoHaceLaApp = (nos) => (nos.length > 0 ? Math.max(...nos) : 0) + 1;

(async () => {
  const obrasDocs = await todaLaColeccion('obras');
  const obras = obrasDocs.map(d => ({
    id: d.name.split('/').pop(),
    nombre: txt(d.fields || {}, 'nombre') || '—',
    estado: txt(d.fields || {}, 'estado') || 'activa',
  })).sort((a, b) => a.id.localeCompare(b.id));

  console.log(`Obras: ${obras.length}\n`);

  const envenenadas = [];
  const sinFecha = [];

  console.log('obra   est.  sin `no`  el próximo rótulo sería   subs.fecha');
  console.log('─'.repeat(84));

  for (const o of obras) {
    const [est, subs] = await Promise.all([
      leer(`obras/${o.id}/config/estimaciones`),
      leer(`obras/${o.id}/avance/subs`),
    ]);

    const filas = arreglo((est?.fields || {}).data);
    const nos = filas.map(f => crudo(f.no));
    // «No usable» es lo que hace que `Math.max` deje de medir: ausente,
    // vacío, o texto que no es número. Un `"3"` SÍ es usable —`Math.max`
    // lo convierte— y por eso no se cuenta aquí.
    const malos = nos.filter(n => n === undefined || n === null || n === '' ||
      !Number.isFinite(Number(n)));
    const rotulo = `EST-${comoLoHaceLaApp(nos)}`;

    const fecha = subs ? txt(subs.fields || {}, 'fecha') : null;

    if (malos.length) envenenadas.push({ ...o, filas: filas.length, malos: malos.length, rotulo });
    if (!fecha) sinFecha.push(o);

    console.log(`${o.id.padEnd(6)} ${String(filas.length).padStart(4)}  ` +
      `${String(malos.length).padStart(8)}  ${rotulo.padEnd(23)} ` +
      `${fecha ? fecha.slice(0, 10) : '(no hay) → 999'}` +
      `${o.estado === 'archivada' ? '  (archivada)' : ''}`);
  }

  // ── EL VEREDICTO ──────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(84));
  console.log('#58 — el EST-NaN');
  if (!envenenadas.length) {
    console.log('  Hoy ninguna estimación guardada le falta el `no`, así que el rótulo');
    console.log('  todavía no sale NaN. El defecto es futuro: lo dispara la primera');
    console.log('  estimación que entre por otra vía (importación, PDF, migración) o');
    console.log('  cualquier escritura que guarde la lista sin numerar. Y lo dispara');
    console.log('  para TODA la obra, no para la fila mala.');
  } else {
    for (const e of envenenadas) {
      console.log(`  ${e.id} ${e.nombre.slice(0, 34)}: ${e.malos} de ${e.filas} ` +
        `sin \`no\` usable → la siguiente se rotularía «${e.rotulo}»`);
    }
  }

  console.log('');
  console.log('#79 — el 999 del correo del lunes');
  const activasSinFecha = sinFecha.filter(o => o.estado !== 'archivada');
  if (!sinFecha.length) {
    console.log('  Todas las obras tienen `avance/subs.fecha`, así que hoy el 999 no');
    console.log('  se imprime. Lo imprime la próxima obra que se dé de alta: entre el');
    console.log('  alta y la primera captura, el correo la acusa de 999 días.');
  } else {
    console.log(`  ${sinFecha.length} obra(s) sin \`avance/subs.fecha\`, de las cuales ` +
      `${activasSinFecha.length} activa(s).`);
    for (const o of sinFecha) {
      console.log(`  ${o.id} ${o.nombre.slice(0, 40)}${o.estado === 'archivada' ? ' (archivada)' : ''}` +
        ` → el correo imprime «Sin captura 999d» y la cuenta en obrasSinCaptura`);
    }
    if (activasSinFecha.length) {
      console.log('');
      console.log('  Ésas son acusaciones falsas, no huecos: el correo no dice «no se');
      console.log('  sabe», dice un número en rojo, y lo dice cada lunes.');
    }
  }
  console.log('');
})();
