#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿QUÉ LE PASA A UNA OBRA CUANDO SE ARCHIVA? — SÓLO LECTURA
// ════════════════════════════════════════════════════════════════════════════
//
// POR QUÉ. Se pidió un botón de CERRAR obra, con tres propiedades: que la obra
// ya no se pueda mover, que siga en el tablero el año en curso para poder
// sumar lo facturado, y que el cierre se note. Ya existe un botón de ARCHIVAR,
// y antes de proponer uno nuevo hay que saber qué hace el que hay — si archivar
// ya cumple dos de las tres, el cierre es un ajuste; si no cumple ninguna, es
// otra cosa.
//
// LO QUE EL CÓDIGO DICE, y esto es lo que la medición viene a confirmar o a
// desmentir contra el dato vivo:
//
//   · `archivar` (App.jsx) escribe un RETRATO de la obra en
//     `global/historial_obras` y después hace `setObras(... estado:"archivada")`,
//     que es estado de React. NO hay escritura del campo `estado` al documento
//     de la obra.
//   · `loadObras()` devuelve `[]` a propósito: la lista se hidrata entera desde
//     Firestore en cada login. No hay respaldo en el navegador.
//   · Si las dos cosas son ciertas, archivar una obra DURA LO QUE DURE LA
//     PESTAÑA y se deshace en la siguiente recarga, sin aviso.
//
//   · Y el filtro es `o.estado !== 'archivada'` en siete sitios. El campo que
//     manda es `estado`, no `archivada`. (Mi propio guion
//     `medir-la-serie-semanal-de-margen.cjs` filtraba `obra.archivada === true`,
//     que nunca es cierto: por eso aquí se cuentan las dos formas.)
//
// LAS CUATRO PREGUNTAS:
//
//   1. ¿Cuántas obras traen el campo `estado` en Firestore, y con qué valor?
//      Si ninguna lo trae, archivar no ha persistido nunca.
//   2. ¿Qué hay en `global/historial_obras`? Si hay retratos de obras que en la
//      lista siguen activas, es la prueba de que el archivado se perdió.
//   3. ¿El retrato alcanza para sumar lo facturado del año? Es lo que se pidió:
//      hay que ver si el retrato trae estimaciones o sólo la ficha.
//   4. ¿Qué queda escribible de una obra archivada? Las reglas de Firestore no
//      miran `estado`, así que conviene decirlo con el ruleset en la mano.
//
// SÓLO LEE, Y POR CONSTRUCCIÓN. La única función de red es `leer()` y hace GET.
// No hay PATCH, ni POST, ni DELETE, ni `firebase-admin`.
//
// Uso:
//     TOKEN=$(gcloud auth application-default print-access-token) \
//       node scripts/medir-que-hace-archivar-una-obra.cjs --prod

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

// EL RÓTULO SALE DE LA APP, NO DE AQUÍ. La primera versión imprimía
// `e.numero`, que no es un campo de ninguna estimación —se llama `no`—, así
// que las cuatro salieron como «est. ?»: una alarma que nombra mal la fila a
// la que hay que ir no es accionable, es ruido. Extraído, el guion no puede
// desincronizarse de la pantalla a la que manda al usuario.
const { deApp } = require('./extraer-de-app.cjs');
// El nombre va como argumento suelto y no dentro de un arreglo: `deApp` lo
// aplana igual y el guion corre, pero `prueba-herramientas-de-medicion-viven`
// lee estas llamadas SIN ejecutarlas para saber qué pide cada guion, y un
// arreglo la deja ciega. Un inventario que no puede leer lo que se pide no es
// un inventario. Salió en rojo la primera vez que corrió la suite con esto.
const { rotuloEstimacion } = deApp('rotuloEstimacion');

const PROYECTO = DESTINO.prod ? 'campo-fosmon' : (process.env.GCLOUD_PROJECT || 'campo-fosmon');
const BASE = DESTINO.prod
  ? `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`
  : `http://${DESTINO.emulador}/v1/projects/${PROYECTO}/databases/(default)/documents`;

const TOKEN = process.env.TOKEN || '';
if (DESTINO.prod && !TOKEN) {
  console.error('Falta TOKEN. Es el de ADC:\n');
  console.error('  TOKEN=$(gcloud auth application-default print-access-token) \\');
  console.error('    node scripts/medir-que-hace-archivar-una-obra.cjs --prod\n');
  process.exit(2);
}

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
    if (r.status === 401 || r.status === 403) console.error(
      '\nSuele ser el token vencido:\n' +
      '  TOKEN=$(gcloud auth application-default print-access-token)');
    process.exit(2);
  }
  return r.json();
}

const val = v => {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  if ('mapValue' in v) return campos(v.mapValue);
  return null;
};
const campos = d => Object.fromEntries(
  Object.entries((d && d.fields) || {}).map(([k, v]) => [k, val(v)]));

const MXN = n => (typeof n !== 'number' || !isFinite(n)) ? '—'
  : '$' + Math.round(n).toLocaleString('en-US');

(async () => {
  console.log('');
  console.log(`QUÉ HACE «ARCHIVAR» · ${DESTINO.prod ? 'PRODUCCIÓN' : 'emulador'}`);
  console.log('');

  const lista = await leer('obras?pageSize=300');
  const docs = lista?.documents || [];

  // ── 1 · ¿ALGUNA OBRA TRAE `estado` PERSISTIDO? ───────────────────────────
  console.log('════════════════════════════════════════════════════════════════');
  console.log('1 · EL CAMPO `estado` EN EL DOCUMENTO DE LA OBRA');
  console.log('');
  const obras = [];
  for (const d of docs) {
    const id = d.name.split('/').pop();
    const base = campos(d);
    const info = campos(await leer(`obras/${id}/config/info`)) || {};
    obras.push({ id, base, info, nombre: info.nombre || base.nombre || '' });
  }
  console.log('  obra  nombre                          estado(obra)  estado(info)  archivada');
  for (const o of obras)
    console.log(`  ${o.id}  ${String(o.nombre).slice(0, 30).padEnd(31)}` +
      `${String(o.base.estado ?? '(no existe)').padEnd(14)}` +
      `${String(o.info.estado ?? '(no existe)').padEnd(14)}` +
      `${String(o.base.archivada ?? o.info.archivada ?? '(no existe)')}`);
  console.log('');
  const conEstado = obras.filter(o => o.base.estado !== undefined || o.info.estado !== undefined);
  const archivadasPersistidas = obras.filter(o =>
    o.base.estado === 'archivada' || o.info.estado === 'archivada');
  console.log(`  obras con el campo \`estado\` guardado:   ${conEstado.length} de ${obras.length}`);
  console.log(`  obras con \`estado: "archivada"\` guardado: ${archivadasPersistidas.length}`);
  console.log(`  obras con el campo \`archivada\` (booleano): ` +
    `${obras.filter(o => o.base.archivada !== undefined || o.info.archivada !== undefined).length}` +
    '   ← el filtro de la app NO lee este campo');

  // ── 2 · EL HISTORIAL DE OBRAS ────────────────────────────────────────────
  console.log('');
  console.log('2 · `global/historial_obras`: LOS RETRATOS QUE DEJÓ ARCHIVAR');
  console.log('');
  const hist = campos(await leer('global/historial_obras'));
  if (!hist) {
    console.log('  el documento NO EXISTE: nadie ha archivado nunca, o se perdió.');
  } else {
    const retratos = Array.isArray(hist.obras) ? hist.obras : [];
    console.log(`  retratos guardados: ${retratos.length}`);
    for (const r of retratos) {
      const sigueActiva = obras.find(o => o.id === r.id);
      console.log(`    ${r.id}  ${String(r.nombre || '').slice(0, 28).padEnd(29)}` +
        `archivedAt ${String(r.archivedAt || '—').slice(0, 10)}`);
      console.log(`          en la lista de obras: ` +
        (sigueActiva
          ? `SIGUE AHÍ con estado ${sigueActiva.base.estado ?? sigueActiva.info.estado ?? '(no existe)'}` +
            ((sigueActiva.base.estado ?? sigueActiva.info.estado) !== 'archivada'
              ? '   ← EL ARCHIVADO SE PERDIÓ'
              : '')
          : 'ya no está'));
      // ¿Alcanza el retrato para sumar lo facturado?
      const claves = Object.keys(r);
      console.log(`          el retrato trae ${claves.length} campos: ${claves.slice(0, 12).join(', ')}` +
        (claves.length > 12 ? ' …' : ''));
      console.log(`          presupuesto ${MXN(r.presupuesto)}  ·  ` +
        `¿trae estimaciones?: ${Array.isArray(r.estimaciones) ? r.estimaciones.length + ' renglones' : 'NO'}`);
    }
  }

  // ── 3 · ¿CON QUÉ SE SUMARÍA LO FACTURADO DEL AÑO? ────────────────────────
  console.log('');
  console.log('3 · LO FACTURADO DEL AÑO: ¿DE DÓNDE SALDRÍA?');
  console.log('');
  console.log('  Las estimaciones viven en `obras/{id}/config/estimaciones`, no en');
  console.log('  el documento de la obra ni en el retrato. Si una obra cerrada se');
  console.log('  quita de la lista, su facturación deja de sumarse aunque el dato');
  console.log('  siga ahí: lo que la esconde es el filtro, no el borrado.');
  console.log('');
  // EL CAMPO ES `fechaFact`, NO `fecha`. La primera versión de este guion
  // filtraba por `e.fecha`, que no existe en ninguna estimación: salió
  // «$0 facturado en 2026» con $287M de histórico, que es una contradicción
  // tan grande que delató mi lectura y no el dato.
  //
  // Y `fechaFact` es la fecha de la FACTURA, que es exactamente lo que se
  // preguntó —«cuánto facturamos en un año»—. No sirve para fechar lo PAGADO:
  // la app se niega a eso a propósito (ver `seriePagadaDeSemanas`), porque
  // rotular «pagado» una serie fechada por facturación es ponerle a una cuenta
  // el nombre de otra.
  const AÑO = new Date().getFullYear();
  // EL ESTATUS DECIDE SI LA FALTA DE FECHA ES UN HUECO O ES LO CORRECTO. Los
  // cuatro del vocabulario de la constructora son En proceso / Aprobada /
  // Facturada / Pagada (App.jsx:19574). Una estimación EN PROCESO sin
  // `fechaFact` **no tiene nada mal**: no se ha facturado, así que no hay
  // fecha de factura que capturar. Una FACTURADA o PAGADA sin `fechaFact` sí
  // es un hueco: el dinero se facturó y la fecha no se tecleó.
  //
  // Meter las cuatro en la misma alarma sería mandar a corregir algo que está
  // bien — el defecto del #126 en otra forma: una lista larga no es el
  // problema, una lista FALSA sí.
  const FACTURADAS = ['Facturada', 'Pagada'];
  let totalAño = 0, totalTodo = 0, sinFechar = 0;
  const huecos = [], todavianNo = [];
  console.log('  obra  estim.  facturado ' + AÑO + '      sin fechar      total histórico');
  for (const o of obras) {
    const est = campos(await leer(`obras/${o.id}/config/estimaciones`)) || {};
    const filas = Array.isArray(est.data) ? est.data : [];
    const suma = (fs) => fs.reduce((t, e) => t + (parseFloat(e.monto) || 0), 0);
    const delAño = filas.filter(e => String(e.fechaFact || '').startsWith(String(AÑO)));
    const nf = filas.filter(e => !e.fechaFact);
    for (const e of nf)
      (FACTURADAS.includes(e.estatus) ? huecos : todavianNo)
        .push({ obra: o.id, ...e });
    const sAño = suma(delAño), sTodo = suma(filas), sNF = suma(nf);
    totalAño += sAño; totalTodo += sTodo; sinFechar += sNF;
    console.log(`  ${o.id}  ${String(filas.length).padStart(5)}   ` +
      `${(String(delAño.length) + ': ' + MXN(sAño)).padEnd(21)}` +
      `${(nf.length ? String(nf.length) + ': ' + MXN(sNF) : '—').padEnd(16)}${MXN(sTodo)}`);
  }
  console.log('');
  console.log(`  TOTAL facturado ${AÑO}: ${MXN(totalAño)}`);
  console.log(`  sin \`fechaFact\`:      ${MXN(sinFechar)}   ← no se puede asignar a un año`);
  console.log(`  histórico:            ${MXN(totalTodo)}`);
  console.log('  (la primera es la cifra que el cierre tiene que dejar seguir sumando)');

  console.log('');
  console.log('  ¿CUÁLES DE LAS SIN FECHAR SON UN HUECO DE VERDAD?');
  console.log('');
  const renglon = (e) => `    ${e.obra}  ${rotuloEstimacion(e).padEnd(9)}` +
    `${String(e.estatus || '(sin estatus)').padEnd(14)}${MXN(parseFloat(e.monto) || 0).padStart(14)}` +
    `   ${String(e.periodo || '(sin periodo)').slice(0, 24)}`;
  const sumaDe = (l) => l.reduce((t, e) => t + (parseFloat(e.monto) || 0), 0);
  console.log(`  A CORREGIR — facturada o pagada, y sin fecha de factura: ` +
    `${huecos.length}, ${MXN(sumaDe(huecos))}`);
  if (!huecos.length) console.log('    ninguna.');
  for (const e of huecos) console.log(renglon(e));
  console.log('');
  console.log(`  TODAVÍA NO TOCA — en proceso o aprobada, sin facturar aún: ` +
    `${todavianNo.length}, ${MXN(sumaDe(todavianNo))}`);
  if (!todavianNo.length) console.log('    ninguna.');
  for (const e of todavianNo) console.log(renglon(e));
  console.log('');
  console.log('  La alarma del cierre nombra SÓLO el primer grupo. El segundo no');
  console.log('  está mal: no se ha facturado, así que no hay fecha que teclear.');
  console.log('  Pero los dos se quedan fuera de la suma del año, porque ninguno');
  console.log('  se puede fechar — y esa es la cifra que el total tiene que confesar.');

  // ── 4 · ¿QUÉ QUEDA ESCRIBIBLE? ───────────────────────────────────────────
  console.log('');
  console.log('4 · ¿LAS REGLAS DE FIRESTORE MIRAN EL ESTADO DE LA OBRA?');
  console.log('');
  const fs2 = require('fs');
  const ruta = require('path').join(__dirname, '..', 'firestore.rules');
  if (!fs2.existsSync(ruta)) {
    console.log('  no encuentro `firestore.rules` en el repo: no puedo contestar.');
  } else {
    // LOS COMENTARIOS SE QUITAN ANTES DE BUSCAR. La primera versión buscaba en
    // el archivo entero y contestó «SÍ», pero las coincidencias eran prosa —«la
    // nota de cada semana cerrada», «el estado del navegador»— y no una
    // condición. Una medición que cuenta comentarios como código contesta que
    // el candado existe cuando lo que existe es la palabra.
    const reglas = fs2.readFileSync(ruta, 'utf8')
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const miraEstado = /(estado|archivada|cerrada)/.test(reglas);
    console.log(`  \`firestore.rules\` mira estado/archivada/cerrada EN CÓDIGO ` +
      `(sin comentarios): ${miraEstado ? 'SÍ' : 'NO'}`);
    if (!miraEstado) {
      console.log('  Entonces NINGUNA regla bloquea escribir en una obra archivada: el');
      console.log('  candado tendría que existir en las reglas, no sólo en la pantalla.');
      console.log('  Un candado que vive en el botón se abre con la consola del navegador.');
    }
    const matches = reglas.match(/match \/obras\/\{[^}]+\}/g) || [];
    console.log(`  bloques \`match /obras/{…}\` en el ruleset: ${matches.length}`);
  }
  console.log('');
})();
