#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// EL CORREO DEL VIERNES, ANTES DE QUE SALGA (PENDIENTES #149)
// ════════════════════════════════════════════════════════════════════════════
//
// SOLO LECTURA, Y NO PUEDE MANDAR CORREO. No es una promesa del preámbulo: el
// Firestore que se le inyecta al código real NO TIENE `set`, `update` ni `add`
// —no existen como métodos—, así que un intento de escritura es un TypeError
// a gritos y no una fila nueva en producción. Y `enviarEmailResend` nunca se
// llama: lo que se invoca es el ARMADOR del correo, no el que lo entrega.
//
// POR QUÉ NO ES UNA MAQUETA. Un «así se va a ver» tecleado a mano miente por
// construcción: el día que el correo cambie, la maqueta seguirá igual y lo que
// se revisó no será lo que salga. Así que las piezas que deciden QUÉ dice y A
// QUIÉN se le dice se EXTRAEN de `functions/index.js` y se EJECUTAN:
//
//   rutaObrasDeOrg          dónde están las obras de cada organización
//   QUIEN_CAPTURA_EN_CAMPO  qué roles reciben el aviso, derivados
//   usuariosCapturaDeObra   quién, del padrón de verdad, cumple
//   marcaDeOrg              con qué nombre y color firma cada cliente
//   correoCierrePendiente   el asunto y el HTML, letra por letra
//   semanaISOFn / snapIdFn  qué semana es hoy
//
// Lo único mío es el recorrido que las une, y recorrer es leer.
//
// LO QUE ESTO NO ES. No es la prueba del trabajo —ésa es
// `prueba-el-recordatorio-del-viernes-alcanza-a-la-dependencia.cjs`, con sus
// 13 mutaciones en rojo— ni afirma nada. Es una ventana: sirve para mirar, con
// los datos de hoy, a quién le toca correo el viernes y qué va a leer.
//
// Uso:
//   gcloud auth application-default login
//   export NODE_PATH="$PWD/functions/node_modules"
//   node scripts/ver-el-correo-del-recordatorio.cjs --prod
//   node scripts/ver-el-correo-del-recordatorio.cjs --prod --html=/tmp/correo.html
//
// Con `--viernes` calcula la semana como si hoy fuera el viernes del envío, que
// es el único día en que este correo sale de verdad.

'use strict';

const { resolverDestino } = require('./destino.cjs');
const DESTINO = resolverDestino({ soloLectura: true });

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const raiz = path.resolve(__dirname, '..');
const ARCH_FUNCS = path.join(raiz, 'functions/index.js');
const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');

const argv = process.argv.slice(2);
const salidaHTML = (argv.find(a => a.startsWith('--html=')) || '').slice(7);

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: DESTINO.projectId,
  });
} catch (e) {
  noArranco.sinPrecondicion(`no se pudo inicializar el Admin SDK: ${e.message}`,
    ['corre `gcloud auth application-default login`']);
}

// ── EL FIRESTORE QUE NO SABE ESCRIBIR ──────────────────────────────────────
//
// Envuelve al de verdad y deja pasar sólo lectura. No se omiten los métodos de
// escritura para «portarse bien»: se omiten para que no haya forma de llamarlos
// ni por error ni por un cambio futuro en el código extraído.
const real = admin.firestore();
const soloLeer = () => {
  const refDoc = (ruta) => ({
    id: ruta.split('/').pop(),
    get: () => real.doc(ruta).get(),
    collection: (sub) => coleccion(`${ruta}/${sub}`),
  });
  const coleccion = (col, q = null) => {
    const base = q || real.collection(col);
    return {
      where: (c, op, v) => coleccion(col, base.where(c, op, v)),
      get: () => base.get(),
      doc: (id) => refDoc(`${col}/${id}`),
    };
  };
  return { doc: refDoc, collection: coleccion };
};

const PEDIDOS = ['rutaObrasDeOrg', 'QUIEN_CIERRA', 'QUIEN_CAPTURA_EN_CAMPO',
  'usuariosCapturaDeObra', 'marcaDeOrg', 'correoCierrePendiente',
  'semanaISOFn', 'snapIdFn'];

let piezas;
try {
  const { cuerpo } = fuenteDe(ARCH_FUNCS, PEDIDOS, { tolerante: true });
  const inyectar = {
    require: (m) => {
      if (m === 'firebase-admin') return { firestore: soloLeer, initializeApp: () => {} };
      return require(m);
    },
    fetch: () => { throw new Error('esta ventana no manda correo'); },
    defineSecret: () => ({ value: () => null }),
  };
  const nombres = Object.keys(inyectar);
  piezas = new Function(...nombres,
    `"use strict";\n${cuerpo}\nreturn { ${PEDIDOS.join(', ')} };`
  )(...nombres.map(n => inyectar[n]));
} catch (e) {
  if (e instanceof SimboloPerdido) {
    noArranco.sinPrecondicion(
      `no están en functions/index.js: ${e.faltantes.join(', ')}`,
      ['Si se renombraron, esta ventana no puede enseñar el correo de verdad,',
       'y enseñar uno tecleado a mano sería peor que no enseñar nada.']);
  }
  noArranco.sinPrecondicion(`no se pudieron montar las piezas: ${e.message}`, []);
}

// El viernes del envío, para que la semana sea la que el correo va a nombrar.
function elViernesDelEnvio(hoy = new Date()) {
  const d = new Date(hoy);
  d.setDate(d.getDate() + ((5 - (d.getDay() || 7) + 7) % 7));
  d.setHours(14, 0, 0, 0);
  return d;
}

const ahora = argv.includes('--viernes') ? elViernesDelEnvio() : new Date();

// Sin etiquetas, para leerlo en la terminal.
const aTexto = (html) => html
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
  .replace(/<li[^>]*>/gi, '\n  · ')
  .replace(/<\/(p|div|tr|h1|h2|h3|ul|table)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 → $1')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .split('\n').map(l => l.trim()).filter(Boolean).join('\n');

(async () => {
  const { semana, año } = piezas.semanaISOFn(ahora);
  const idSem = piezas.snapIdFn(semana, año);

  console.log(`\n── El correo del viernes · ${DESTINO.projectId} ──`);
  console.log(`   semana que nombraría: ${idSem}`);
  console.log(`   fecha de referencia:  ${ahora.toISOString()}\n`);

  // Mismo recorrido que el trabajo, leyendo.
  const orgsSnap = await real.collection('orgs').get();
  const destinos = [];
  orgsSnap.forEach(d => {
    const tipo = (d.data() || {}).tipo;
    if (!piezas.QUIEN_CIERRA[tipo]) return;
    destinos.push({ orgId: d.id, tipo, ruta: piezas.rutaObrasDeOrg(d.id, tipo) });
  });

  const porPersona = new Map();
  for (const org of destinos) {
    console.log(`${org.orgId}  (${org.tipo})  ← ${org.ruta}`);
    console.log(`   reciben: ${piezas.QUIEN_CAPTURA_EN_CAMPO(org.tipo).join(', ')}`);
    const obrasSnap = await real.collection(org.ruta).get();
    for (const obraDoc of obrasSnap.docs) {
      const obra = { id: obraDoc.id, ...obraDoc.data() };
      if (obra.estado === 'archivada') { console.log(`   ${obra.id}  archivada → fuera`); continue; }
      const hist = await real.doc(`${org.ruta}/${obra.id}/avance/historial`).get();
      const semanas = hist.exists ? (hist.data().semanas || []) : [];
      if (semanas.some(s => s.id === idSem)) {
        console.log(`   ${obra.id}  ya cerró la ${idSem} → fuera`);
        continue;
      }
      const usuarios = await piezas.usuariosCapturaDeObra(obra.id, org.orgId, org.tipo);
      console.log(`   ${obra.id}  SIN CERRAR → ${usuarios.length
        ? usuarios.map(u => `${u.email || '(sin correo)'} [${u.rol}]`).join(', ')
        : 'nadie asignado que capture'}`);
      for (const u of usuarios) {
        const correo = String(u.email || '').trim();
        if (!correo) continue;
        if (!porPersona.has(correo)) {
          porPersona.set(correo, { nombre: u.nombre, orgId: org.orgId, obras: [] });
        }
        porPersona.get(correo).obras.push(String(obra.nombre || obra.id));
      }
    }
  }

  if (porPersona.size === 0) {
    console.log('\nCon los datos de hoy no saldría ningún correo: no hay obra sin');
    console.log('cerrar con alguien asignado que capture. Eso es el aviso haciendo');
    console.log('su trabajo, no un defecto.\n');
    process.exit(0);
  }

  const marcas = new Map();
  const sobres = [];
  for (const [correo, p] of porPersona) {
    if (!marcas.has(p.orgId)) marcas.set(p.orgId, await piezas.marcaDeOrg(p.orgId));
    const { subject, html } = piezas.correoCierrePendiente({
      marca: marcas.get(p.orgId), nombre: p.nombre, idSem, obras: p.obras,
    });
    sobres.push({ correo, orgId: p.orgId, subject, html });
  }

  for (const s of sobres) {
    console.log(`\n${'═'.repeat(74)}`);
    console.log(`Para:    ${s.correo}   (${s.orgId})`);
    console.log(`Asunto:  ${s.subject}`);
    console.log(`${'─'.repeat(74)}`);
    console.log(aTexto(s.html));
  }

  if (salidaHTML) {
    fs.writeFileSync(salidaHTML, sobres.map(s =>
      `<!-- ${s.correo} · ${s.subject} -->\n${s.html}`).join('\n<hr>\n'));
    console.log(`\n${'═'.repeat(74)}`);
    console.log(`HTML de los ${sobres.length} correo(s) en ${salidaHTML}`);
  }

  console.log(`\n${sobres.length} correo(s) saldrían. Ninguno salió: esta ventana no entrega.\n`);
  process.exit(0);
})().catch(e => {
  console.error(`\nNO ARRANCÓ: ${e.message}`);
  console.error(e.stack);
  process.exit(2);
});
