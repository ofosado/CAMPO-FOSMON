#!/usr/bin/env node
// Manda a UN buzón el correo que el cron mandaría a todos, sin re-escribirlo.
//
// QUÉ HACE. Corre la MISMA `generarYEnviarResumenSemanal` que está desplegada
// —extraída de `functions/index.js`, no copiada— contra producción en sólo
// lectura, y le **intercepta el sobre** justo antes de que salga a Resend. De
// ahí sale el `to` real, el asunto real y el HTML real; y entonces se manda una
// sola copia a la dirección que se pida.
//
// POR QUÉ ASÍ Y NO CON UN PARÁMETRO EN LA FUNCIÓN. `probarResumenSemanal`
// manda a todos los destinatarios y no acepta destino. Abrirle uno dejaría
// para siempre un disparador autenticado capaz de mandar el portafolio
// —presupuesto, gasto y cobrado de cada obra— a una dirección cualquiera. Eso
// es una puerta, no una herramienta. Desde fuera no queda nada abierto.
//
// POR QUÉ NO SE RE-ARMA EL CORREO AQUÍ. Un previo que vuelve a orquestar los
// pasos deja de ser un previo en cuanto el cron cambie uno: se vería un correo
// que nadie va a recibir. Interceptando, lo que se ve es lo que sale.
//
// Uso:
//   node scripts/muestra-correo-a-un-buzon.cjs --a correo@dominio
//   node scripts/muestra-correo-a-un-buzon.cjs --a correo@dominio --enviar
//   ... --tipo resumen | obra-asignada | los-dos        (por omisión: los-dos)
//
// **Por omisión NO manda nada**: arma, guarda el HTML en /tmp y dice a quién
// se lo habría mandado el cron. Hace falta `--enviar` para que salga.
//
// Sólo lectura: el Firestore que se le presta revienta ante cualquier
// escritura. El 2026-10-09 un guion escribió 270 documentos en producción por
// no llevar esa guarda, así que aquí va puesta y se auto-comprueba al arrancar.

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const ARCH_FN = path.join(RAIZ, 'functions/index.js');
// `firebase-admin` vive en `functions/`, no en la raíz.
const admin = require(path.join(RAIZ, 'functions/node_modules/firebase-admin'));
const { fuenteDe } = require('./extraer-de-app.cjs');

// ── argumentos ──────────────────────────────────────────────────────────────
const arg = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
};
const DESTINO = arg('--a');
const ENVIAR = process.argv.includes('--enviar');
const TIPO = arg('--tipo') || 'los-dos';

if (!DESTINO || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(DESTINO)) {
  console.error('Falta `--a correo@dominio`. La dirección se teclea completa a '
    + 'propósito: este correo lleva el dinero de todas las obras adentro.');
  process.exit(2);
}
if (!['resumen', 'obra-asignada', 'los-dos'].includes(TIPO)) {
  console.error(`--tipo desconocido: ${TIPO}`);
  process.exit(2);
}

// ── Firestore de sólo lectura ───────────────────────────────────────────────
// No se confía en que el código llamado no escriba: se le quita la posibilidad.
const PROHIBIDAS = new Set(['set', 'update', 'delete', 'create', 'add',
  'setAll', 'commit', 'bulkWriter', 'batch', 'runTransaction']);
const soloLectura = (obj, ruta = 'db') => new Proxy(obj, {
  get(destino, prop) {
    if (typeof prop === 'string' && PROHIBIDAS.has(prop)) {
      return () => {
        throw new Error(`ESCRITURA BLOQUEADA: ${ruta}.${prop}() — este guion es de sólo lectura`);
      };
    }
    const v = destino[prop];
    if (typeof v !== 'function') return v;
    return (...args) => {
      const r = v.apply(destino, args);
      // Las referencias se envuelven también: la guarda tiene que viajar con
      // el objeto, no quedarse en la raíz.
      if (r && typeof r === 'object' && (r.constructor?.name || '').includes('Reference')) {
        return soloLectura(r, `${ruta}.${String(prop)}()`);
      }
      return r;
    };
  },
});

admin.initializeApp({ projectId: 'campo-fosmon' });
const dbReal = admin.firestore();
const db = soloLectura(dbReal);

// La guarda se comprueba, no se declara. Si no revienta, este guion no arranca.
try {
  db.doc('global/gp_construct').set({ probando: true });
  console.error('NO ARRANCÓ: la guarda de sólo lectura no bloqueó una escritura.');
  process.exit(2);
} catch (e) {
  if (!/ESCRITURA BLOQUEADA/.test(e.message)) {
    console.error('NO ARRANCÓ: la guarda falló por otra razón:', e.message);
    process.exit(2);
  }
}

// ── el código vivo ──────────────────────────────────────────────────────────
// Se le sustituye el cargador de módulos y se le SOMBREA `fetch`. `fetch` es
// global, así que entra como parámetro de `new Function` y tapa al de verdad
// dentro del cierre: ahí se atrapa el sobre.
const requireFalso = (m) => {
  if (m === 'firebase-admin') {
    return { ...admin, initializeApp: () => {}, firestore: () => db };
  }
  return require(m);
};

let sobres = [];
const fetchEspia = async (url, opciones) => {
  if (String(url).startsWith('https://api.resend.com/emails')) {
    sobres.push(JSON.parse(opciones.body));
    // Se le contesta como Resend para que el cron termine su camino normal y
    // se vean también sus mensajes de cierre.
    return { ok: true, status: 200, json: async () => ({ id: MARCA_INTERCEPTOR }) };
  }
  return fetch(url, opciones);
};

const PEDIDOS = ['generarYEnviarResumenSemanal', 'correoObraAsignada',
  'marcaDeOrg', 'orgDeLaRaiz', 'enviarEmailResend', 'FROM_EMAIL'];
const { cuerpo, faltan } = fuenteDe(ARCH_FN, PEDIDOS);
if (faltan.length) {
  console.error(`NO ARRANCÓ: a functions/index.js le faltan ${faltan.join(', ')}`);
  process.exit(2);
}
const fabricar = new Function('require', 'fetch',
  `"use strict";\n${cuerpo}\nreturn { generarYEnviarResumenSemanal, correoObraAsignada,
     marcaDeOrg, orgDeLaRaiz, enviarEmailResend, FROM_EMAIL };`);

// DOS cierres del MISMO cuerpo, y la diferencia es sólo cuál `fetch` ven.
// `vivo` lleva el espía, porque de ahí se saca el sobre. **El transporte lleva
// el `fetch` de verdad**: con un solo cierre, el espía se tragaba también el
// envío de este guion y la última línea decía «mandado» de algo que nunca
// salió. Lo delató el `Resend id` con la marca del interceptor adentro.
const vivo = fabricar(requireFalso, fetchEspia);
const transporte = fabricar(requireFalso, fetch);

const MARCA_INTERCEPTOR = '(interceptado, no se mandó)';

// ── la llave, del mismo sitio del que la toma la función ────────────────────
const leerLlaveResend = () => {
  const { execFileSync } = require('child_process');
  return execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest',
    '--secret=RESEND_API_KEY', '--project=campo-fosmon'], { encoding: 'utf8' }).trim();
};

const guardar = (nombre, html) => {
  const destino = path.join('/tmp', nombre);
  fs.writeFileSync(destino, html);
  return destino;
};

(async () => {
  const salidas = [];

  // ── 1) El resumen del lunes ───────────────────────────────────────────────
  if (TIPO === 'resumen' || TIPO === 'los-dos') {
    sobres = [];
    const res = await vivo.generarYEnviarResumenSemanal('(llave no usada: interceptado)');
    if (sobres.length !== 1) {
      console.error(`NO ARRANCÓ: se esperaba 1 sobre y se atraparon ${sobres.length}. `
        + `Resultado del cron: ${JSON.stringify(res)}`);
      process.exit(2);
    }
    const sobre = sobres[0];
    const reales = [].concat(sobre.to);
    console.log('');
    console.log('RESUMEN SEMANAL — el sobre que saldría el lunes');
    console.log(`   de:        ${sobre.from}`);
    console.log(`   asunto:    ${sobre.subject}`);
    console.log(`   iría a:    ${reales.length} destinatario(s) — ${reales.join(', ')}`);
    console.log(`   obras:     ${res.enviados !== undefined ? '' : ''}${JSON.stringify({
      orgId: res.orgId, sinOrg: res.sinOrg, excluidosDeOtraOrg: res.excluidosDeOtraOrg })}`);
    console.log(`   HTML:      ${guardar('resumen-semanal.html', sobre.html)} (${sobre.html.length} bytes)`);
    const sinMedir = (sobre.html.match(/sin medir/g) || []).length;
    console.log(`   «sin medir» aparece ${sinMedir} vez/veces`
      + (sinMedir ? ' — el arreglo del #93 se ve en el correo de verdad' : ''));
    salidas.push({ ...sobre, reales, nombre: 'resumen semanal' });
  }

  // ── 2) El de obra asignada ────────────────────────────────────────────────
  // Este no lo arma un cron: lo arma `actualizarUsuario` al guardar el reparto.
  // Se renderiza con la marca de la organización dueña de las obras y con el
  // nombre y las obras REALES de quien lo va a recibir — un previo con nombres
  // inventados no enseña cómo se lee.
  if (TIPO === 'obra-asignada' || TIPO === 'los-dos') {
    const orgRaiz = await vivo.orgDeLaRaiz(db);
    const marca = await vivo.marcaDeOrg(orgRaiz);
    const perfilSnap = await db.collection('usuarios')
      .where('email', '==', DESTINO).limit(1).get();
    const perfil = perfilSnap.empty ? null : perfilSnap.docs[0].data();
    const obrasSnap = await db.collection('obras').get();
    const nombresObra = obrasSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => (o.estado || 'activa') !== 'archivada')
      .map((o) => o.nombre || o.id);
    // Las obras del propio perfil si las tiene; si no, las dos primeras
    // activas, para que el previo enseñe el caso de varias.
    const asignadas = (perfil?.obras?.length ? perfil.obras : null);
    const obras = asignadas
      ? asignadas.map((id) => {
        const o = obrasSnap.docs.find((d) => d.id === id);
        return o ? (o.data().nombre || id) : id;
      })
      : nombresObra.slice(0, 2);

    const { subject, html } = vivo.correoObraAsignada({
      marca, nombre: perfil?.nombre || DESTINO.split('@')[0], obras,
    });
    console.log('');
    console.log('OBRA ASIGNADA — el sobre que sale al guardar el reparto');
    console.log(`   asunto:    ${subject}`);
    console.log(`   nombre:    ${perfil?.nombre || '(sin perfil, se usa el buzón)'}`);
    console.log(`   obras:     ${obras.join(' · ')}`
      + (asignadas ? ' (las suyas de verdad)' : ' (no tiene asignadas; se muestran dos activas)'));
    console.log(`   HTML:      ${guardar('obra-asignada.html', html)} (${html.length} bytes)`);
    salidas.push({ from: vivo.FROM_EMAIL, subject, html, reales: ['(sólo al asignado)'],
      nombre: 'obra asignada' });
  }

  // ── 3) Mandar, si se pidió ────────────────────────────────────────────────
  console.log('');
  if (!ENVIAR) {
    console.log(`Nada se mandó. Falta \`--enviar\`. Destino que se usaría: ${DESTINO}`);
    process.exit(0);
  }

  const apiKey = leerLlaveResend();
  let mandados = 0;
  for (const s of salidas) {
    // El asunto va marcado: un correo de prueba indistinguible del real es un
    // correo real para quien lo abre tres días después.
    const asunto = `[PRUEBA] ${s.subject}`;
    const r = await transporte.enviarEmailResend(apiKey, {
      from: s.from, to: [DESTINO], subject: asunto, html: s.html,
    });
    // Un `id` con la marca del interceptor adentro significa que el envío
    // volvió a caer en el espía. Eso no es un envío, y este guion no puede
    // decir «mandado» sin el acuse: un acuse falso es peor que un fallo.
    if (!r.id || String(r.id).includes(MARCA_INTERCEPTOR)) {
      console.error(`ROJO  ${s.nombre}  →  NO SALIÓ. Resend contestó `
        + `${JSON.stringify(r)} — el envío cayó en el interceptor, no en Resend.`);
      process.exit(1);
    }
    console.log(`mandado  ${s.nombre}  →  ${DESTINO}   (Resend id ${r.id})`);
    mandados++;
  }
  console.log('');
  console.log(`Se mandó UNA copia de cada uno a ${DESTINO} (${mandados} de `
    + `${salidas.length}, con acuse de Resend). Los destinatarios reales no `
    + 'recibieron nada.');
  process.exit(mandados === salidas.length ? 0 : 1);
})().catch((e) => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
