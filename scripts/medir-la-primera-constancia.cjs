#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// LA PRIMERA CONSTANCIA DE RENDICIÓN, MEDIDA EN PRODUCCIÓN (PENDIENTES #145)
// ════════════════════════════════════════════════════════════════════════════
//
// SOLO LECTURA. No escribe nada, no tiene con qué.
//
// `rendirCierreSemanal` se desplegó el 2026-11-16 con 49 mutaciones en rojo en
// su banco, y aun así quedaba una afirmación que ningún banco podía hacer: que
// en PRODUCCIÓN, con la organización de demo y sus claims de verdad, el aviso
// llega y la constancia dice la verdad. Eso sólo lo puede provocar una persona
// cerrando una semana.
//
// LO QUE SE AFIRMA, Y POR QUÉ ESTE ES EL NÚMERO QUE IMPORTA. La pregunta no es
// «¿existe la constancia?». Una constancia que exista y nombre a gente que
// nunca se enteró es PEOR que no tenerla: es una afirmación falsa dentro del
// expediente, y el expediente es lo que se conserva cinco años. Así que lo que
// se mide es la IGUALDAD entre dos conjuntos que se construyen por caminos
// distintos:
//
//     a quién dice la constancia que se le rindió      (lo que afirma el papel)
//     quién tiene de verdad el aviso en su campanita   (lo que de verdad pasó)
//
// Si esos dos conjuntos difieren, la constancia miente, y da igual que esté.
//
// Se mide además que quien CERRÓ no esté avisado —`rendirCierreSemanal` lo
// excluye a propósito: avisarse a sí mismo no es rendir cuentas— y que la
// semana exista en `avance/historial`, para distinguir «cerró» de «rindió»,
// que son dos actos y pueden fallar por separado.
//
// Uso:
//   gcloud auth application-default login
//   export NODE_PATH="$PWD/functions/node_modules"
//   node scripts/medir-la-primera-constancia.cjs --prod
//
// Tres estados:  verde 0 · ROJO 1 · NO ARRANCÓ 2.

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const admin = require('firebase-admin');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const ORG = process.env.ORG_DEMO || 'coatzacoalcos';
const OBRA = process.env.OBRA_DEMO || '0128';
const RUTA_OBRA = `orgs/${ORG}/obras/${OBRA}`;

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: DESTINO.projectId,
  });
} catch (e) {
  noArranco.sinPrecondicion(`no se pudo inicializar el Admin SDK: ${e.message}`,
    ['corre `gcloud auth application-default login`']);
}
const db = admin.firestore();

const norm = c => String(c || '').trim().toLowerCase();
const iguales = (a, b) => a.length === b.length && a.every(x => b.includes(x));

(async () => {
  let oks = 0, fallas = 0;
  const ok = (t) => { oks++; console.log(` ok   ${t}`); };
  const falla = (t, esperaba, obtuvo) => {
    fallas++;
    console.log(`FALLA ${t}`);
    console.log(`        esperaba: ${esperaba}`);
    console.log(`        obtuvo:   ${obtuvo}`);
  };

  console.log(`\n── La primera constancia de rendición · ${RUTA_OBRA} ──\n`);

  // ── a) LA CONSTANCIA ──────────────────────────────────────────────────────
  const snapC = await db.doc(`${RUTA_OBRA}/avance/rendiciones`).get();
  if (!snapC.exists) noArranco.sinPrecondicion(
    `no existe ${RUTA_OBRA}/avance/rendiciones`,
    ['Nadie ha rendido una semana en esta obra todavía, así que no hay nada',
     'que medir. Esto no es un rojo: es que el acto no ocurrió.',
     'Si acabas de cerrar y crees que sí ocurrió, entonces la callable falló',
     'en silencio y el rojo está en otro lado — mira sus registros.']);

  const rend = (snapC.data() || {}).rendiciones || {};
  const claves = Object.keys(rend).sort();
  if (claves.length === 0) noArranco.sinPrecondicion(
    'el documento de rendiciones existe pero está vacío',
    ['Un mapa `rendiciones` sin claves no dice que se rindió ni que no.']);

  const clave = claves[claves.length - 1];      // la más reciente
  const c = rend[clave] || {};
  const dicho = (c.a || []).map(norm).filter(Boolean);

  console.log(`Constancia más reciente:  ${clave}`);
  console.log(`  cerró:        ${c.porQuien || '(sin dato)'}  (rol ${c.rol || '(sin dato)'})`);
  console.log(`  dice que se le rindió a: ${dicho.join(', ') || '(nadie)'}`);
  console.log(`  cuándo:       ${c.en || '(sin dato)'}`);
  console.log(`  roles:        ${(c.roles || []).join(', ') || '(sin dato)'}\n`);

  if (dicho.length > 0) ok('la constancia nombra al menos a una persona');
  else falla('la constancia nombra al menos a una persona',
    'al menos un destinatario', 'ninguno — se acreditó una rendición sin nadie');

  if (c.porQuien && c.rol) ok('la constancia dice quién cerró y con qué rol');
  else falla('la constancia dice quién cerró y con qué rol',
    '`porQuien` y `rol` con valor', `porQuien=${c.porQuien} rol=${c.rol}`);

  // ── b) QUIÉN TIENE EL AVISO DE VERDAD ─────────────────────────────────────
  //
  // Se recorre el padrón de la organización y se le pregunta a la campanita de
  // CADA UNO, en vez de buscar sólo a los que la constancia nombra: si se
  // buscara sólo a ésos, un aviso que le llegó a quien no debía no se vería.
  const padron = await db.collection('usuarios').where('orgId', '==', ORG).get();
  const gente = [];
  padron.forEach(d => {
    const u = d.data() || {};
    gente.push({ correo: norm(u.correo || u.email), uid: u.uid, rol: u.rol });
  });
  if (gente.length < 2) noArranco.sinPrecondicion(
    `la organización ${ORG} tiene ${gente.length} usuario(s) con \`uid\``,
    ['Con menos de dos no hay rendición posible: quien cierra se excluye, así',
     'que el conjunto de destinatarios sería vacío por construcción y la',
     'igualdad de conjuntos daría verde sin haber medido nada.']);

  const avisados = [];
  for (const u of gente) {
    if (!u.uid) continue;
    const s = await db.collection(`notificaciones/${u.uid}/items`)
      .where('tipo', '==', 'cierre_semana').get();
    const suyos = [];
    s.forEach(d => suyos.push(d.data() || {}));
    if (suyos.length) avisados.push({ ...u, avisos: suyos });
  }

  const conAviso = avisados.map(a => a.correo).sort();
  console.log(`Campanitas con un aviso \`cierre_semana\`: ${conAviso.join(', ') || '(ninguna)'}\n`);

  // ── c) EL NÚMERO QUE IMPORTA: LOS DOS CONJUNTOS SON EL MISMO ──────────────
  if (iguales(dicho.slice().sort(), conAviso))
    ok('a quien la constancia dice que se le rindió es exactamente quien tiene el aviso');
  else {
    const sobran = dicho.filter(x => !conAviso.includes(x));
    const faltan = conAviso.filter(x => !dicho.includes(x));
    falla('a quien la constancia dice que se le rindió es exactamente quien tiene el aviso',
      `los dos conjuntos iguales: ${dicho.slice().sort().join(', ')}`,
      [sobran.length ? `la constancia nombra a quien NO se enteró: ${sobran.join(', ')}` : '',
       faltan.length ? `se enteró quien la constancia NO nombra: ${faltan.join(', ')}` : '']
        .filter(Boolean).join(' · '));
  }

  // ── d) QUIEN CERRÓ NO SE AVISA A SÍ MISMO ─────────────────────────────────
  const cerro = norm(c.porQuien);
  if (!conAviso.includes(cerro))
    ok(`quien cerró (${cerro}) no está entre los avisados`);
  else
    falla('quien cerró no está entre los avisados',
      `${cerro} fuera de la lista`,
      'se avisó a sí mismo — avisarse no es rendir cuentas');

  // ── e) EL AVISO APUNTA A ESTA OBRA ────────────────────────────────────────
  const malApuntados = avisados.flatMap(a => a.avisos
    .filter(v => (v.link || {}).obraId !== OBRA)
    .map(v => `${a.correo} → ${(v.link || {}).obraId}`));
  if (malApuntados.length === 0)
    ok(`los ${avisados.reduce((n, a) => n + a.avisos.length, 0)} aviso(s) enlazan a la obra ${OBRA}`);
  else
    falla('los avisos enlazan a la obra que se cerró',
      `link.obraId = ${OBRA}`, malApuntados.join(', '));

  // ── f) CERRAR Y RENDIR SON DOS ACTOS ──────────────────────────────────────
  //
  // Si la semana no está en el historial, lo que hay es una constancia de una
  // rendición sobre un cierre que no quedó guardado.
  // `semanas` es un ARREGLO de cierres, cada uno con su `id` («S47-2026»), no
  // un mapa indexado por semana. Medirlo con `Object.keys` da las posiciones
  // —«0»— y declara ausente una semana que está: ese fue el primer rojo de
  // esta medición el 2026-11-16, y era falso.
  const snapH = await db.doc(`${RUTA_OBRA}/avance/historial`).get();
  const brutas = (snapH.data() || {}).semanas;
  if (brutas != null && !Array.isArray(brutas)) noArranco.sinPrecondicion(
    `\`semanas\` en avance/historial no es un arreglo, es ${typeof brutas}`,
    ['La forma cambió. Esta medición busca por `id` dentro de un arreglo; con',
     'otra forma no puede decir si la semana está ni si no está.']);
  const semanas = brutas || [];
  const ids = semanas.map(s => String((s || {}).id || ''));
  const laDelActa = semanas.find(s => String((s || {}).id || '') === String(clave));
  if (laDelActa)
    ok(`la semana ${clave} está en avance/historial (${semanas.length} cierre(s) guardado(s))`);
  else
    falla('la semana de la constancia está en avance/historial',
      `un cierre con id ${clave}`,
      semanas.length ? `hay ${semanas.length} (${ids.join(', ')}) y ninguno es ${clave}`
        : 'el historial está vacío: se acreditó rendir un cierre que no se guardó');

  // ── g) EL CIERRE Y LA CONSTANCIA HABLAN DE LA MISMA PERSONA ───────────────
  //
  // Son dos escrituras distintas —el cierre lo guarda la app, la constancia la
  // callable— y cada una apunta a quién lo hizo. Si discreparan, una de las
  // dos estaría atribuyendo el acto a alguien que no lo hizo.
  if (laDelActa) {
    const porElCierre = norm(laDelActa.capturadoPor);
    if (porElCierre && porElCierre === cerro)
      ok(`el cierre y la constancia coinciden en quién lo hizo (${cerro})`);
    else
      falla('el cierre y la constancia coinciden en quién lo hizo',
        `capturadoPor == porQuien == ${cerro}`,
        `el historial dice ${porElCierre || '(nada)'} y la constancia ${cerro}`);
  }

  console.log('');
  if (fallas === 0) {
    console.log('La constancia no afirma nada que no haya ocurrido. Es la primera');
    console.log('rendición real de la plataforma y queda en el expediente.');
  } else {
    console.log('Una constancia que nombra a quien no se enteró es una afirmación');
    console.log('falsa en un expediente que se conserva cinco años, y no se puede');
    console.log('corregir: el aviso ya salió o ya no salió.');
  }
  console.log('');
  console.log(`${oks} comprobación(es) en verde · ${fallas} en rojo`);
  process.exit(fallas > 0 ? 1 : 0);
})().catch(e => {
  console.error(`\nNO ARRANCÓ: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
