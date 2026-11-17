#!/usr/bin/env node
// EL RECORDATORIO DEL VIERNES: A QUIÉN LE LLEGA, QUÉ PLAZO NOMBRA Y QUÉ NO DICE
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// La fecha de término que la app enseña se calcula con el AVANCE FÍSICO de los
// últimos cierres, no con el gasto (`ritmoEntreCierres`, src/App.jsx). El gasto
// entra solo desde GP; el avance lo teclea una persona. Si esa persona se
// rezaga, el denominador de la velocidad —semanas de calendario— sigue
// corriendo y el numerador no: la fecha proyectada se va al futuro y la
// pantalla no dice por qué. La enseña con la misma cara con la que enseñaría
// una buena.
//
// El único freno posible es que alguien se acuerde de cerrar. Y el aviso que
// existía tenía tres agujeros, medidos el 2026-11-16:
//
//   1. Sólo recorría `obras/` —la raíz, o sea la constructora—. Las obras de
//      una dependencia viven en `orgs/{oid}/obras`, así que al supervisor de
//      un municipio NUNCA le llegó nada. Y en una dependencia el que captura
//      es exactamente él.
//   2. Los roles estaban tecleados a mano y eran vocabulario de constructora
//      («residente», «superintendente»). En una dependencia nadie se llama así,
//      de modo que la lista de destinatarios habría salido vacía incluso si la
//      ruta hubiera sido la correcta: dos defectos distintos, cada uno capaz de
//      producir el mismo silencio.
//   3. Sólo escribía en la campana, y nombraba un plazo que no existe: «el
//      corte del viernes». El corte es el SÁBADO A LAS 2 P.M. La campana sólo
//      la ve quien entra a la app, y quien se rezagó es, por definición, quien
//      no entró.
//
// ── QUÉ AFIRMA ESTE BANCO ───────────────────────────────────────────────────
// Nada de que un símbolo exista. El manejador real se EXTRAE de
// `functions/index.js` por AST, se monta con su cierre transitivo de verdad
// sobre un Firestore y un `fetch` de mentira, y SE EJECUTA. Lo que se mide es
// quién aparece en el `to`, qué obras nombra el cuerpo y qué plazo dice.
//
// Las dos afirmaciones que más importan son NEGATIVAS, y por eso van sembradas
// a propósito: la dependencia y la constructora tienen una obra CON EL MISMO
// ID (`0112`) y nombres distintos. Si la ruta o el padrón se cruzaran, el
// correo de un municipio nombraría una obra de la constructora, y eso se ve.
//
// ── LA CUARTA COPIA DE LA BASE DE MENTIRA ───────────────────────────────────
// `baseFalsa` ya está copiada en tres bancos (`prueba-aislamiento-de-usuarios`,
// `prueba-correo-no-cruza-organizaciones`, `prueba-correos-de-alta`). Ésta es
// la cuarta y es la más chica de las cuatro: aquí no hace falta Auth ni claims.
// Sacarla a un módulo compartido es un pendiente propio, no parte de este
// cambio: toca tres bancos verdes y sus contrapruebas.
//
// Uso:
//   node scripts/prueba-el-recordatorio-del-viernes-alcanza-a-la-dependencia.cjs
//   node scripts/prueba-el-recordatorio-del-viernes-alcanza-a-la-dependencia.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');

// ── La contraprueba ─────────────────────────────────────────────────────────
// Una mutación por afirmación, separadas a propósito: juntas, la primera roja
// taparía a las demás y éstas se irían en verde sin que nadie las mida.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    // La mutación se le hace al RECORRIDO del trabajo, no a `rutaObrasDeOrg`.
    // Tocar la función de ruta manda a las dos organizaciones a la raíz, y
    // entonces lo que salta es el portón de «dos orgs en la raíz» —salida 2, no
    // rojo—: la mutación mediría el portón, no la ruta. El defecto de verdad
    // era éste: el trabajo recorría la raíz y la dependencia no existía para él.
    { nombre: 'el recordatorio vuelve a mirar sólo la raíz',
      de: `    destinos.push({ orgId: d.id, tipo, ruta: rutaObrasDeOrg(d.id, tipo) });`,
      a:  `    if (tipo !== "dependencia") destinos.push({ orgId: d.id, tipo, ruta: "obras" });` },
    { nombre: 'y vuelve a avisarle por obra a quien ve todas las obras',
      de: `const QUIEN_CAPTURA_EN_CAMPO = (tipo) =>\n  (QUIEN_CIERRA[tipo] || []).filter(rol => !ROLES_TODAS_OBRAS.has(rol));`,
      a:  `const QUIEN_CAPTURA_EN_CAMPO = (tipo) =>\n  (QUIEN_CIERRA[tipo] || []);` },
    { nombre: 'el aviso vuelve a ser sólo la campana: no sale un correo',
      de: `      await enviarEmailResend(apiKey, { from: FROM_EMAIL, to: [correo], subject, html });\n      enviados.push(correo);`,
      a:  `      enviados.push(correo);` },
    { nombre: 'un buzón que rebota vuelve a tumbar el aviso de los demás',
      de: `      console.warn(\`recordatorio de cierre: no salió el correo a \${correo}:\`, e.message);`,
      a:  `      throw e;` },
    { nombre: 'se vuelve a avisar de una semana que YA se cerró',
      de: `      if (semanas.some(s => s.id === idSem)) continue;`,
      a:  `      if (false) continue;` },
    { nombre: 'y de una obra archivada',
      de: `      if (obra.estado === "archivada") continue;\n\n      const histSnap = await db.doc(\`\${org.ruta}/\${obra.id}/avance/historial\`).get();`,
      a:  `      const histSnap = await db.doc(\`\${org.ruta}/\${obra.id}/avance/historial\`).get();` },
    { nombre: 'con dos organizaciones en la raíz vuelve a adivinar de quién son las obras',
      de: `  if (enLaRaiz.length > 1) {`,
      a:  `  if (false) {` },
    { nombre: 'el correo se le niega al perfil que trae `correo` y no `email`',
      de: `      out.push({ uid: u.uid || null, email: u.correo || u.email, nombre: u.nombre, rol: u.rol });`,
      a:  `      out.push({ uid: u.uid || null, email: u.email, nombre: u.nombre, rol: u.rol });` },
    { nombre: 'y la campana vuelve a escribirse en una ruta que nadie puede leer',
      de: `      out.push({ uid: u.uid || null, email: u.correo || u.email, nombre: u.nombre, rol: u.rol });`,
      a:  `      out.push({ uid: u.uid || doc.id, email: u.correo || u.email, nombre: u.nombre, rol: u.rol });` },
    { nombre: 'el aviso vuelve a salir a las 10 de la mañana, 28 h antes del corte',
      de: `  schedule: "0 14 * * 5",   // viernes 14:00 — 24 h antes del corte del sábado`,
      a:  `  schedule: "0 10 * * 5",` },
    { nombre: 'y la campana vuelve a nombrar un «corte del viernes» que no existe',
      de: `            mensaje: \`Falta capturar el avance físico de la \${idSem}. \` +\n              "El corte es mañana sábado a las 2 p.m.",`,
      a:  `            mensaje: \`Falta capturar avance físico de la \${idSem}. Aprovecha antes del corte del viernes.\`,` },
    { nombre: 'el correo deja de decir cuándo vence el plazo',
      de: `      entradilla: \`\${nombrePila ? \`\${ESC_HTML(nombrePila)}, t\` : "T"}ienes hasta \` +\n        \`<b>mañana sábado a las 2 p.m.</b> para capturar el avance físico de la \` +`,
      a:  `      entradilla: \`\${nombrePila ? \`\${ESC_HTML(nombrePila)}, t\` : "T"}ienes que capturar \` +\n        \`el avance físico de la \` +` },
    { nombre: 'y manda un correo por obra en vez de uno por persona',
      de: `        if (!porPersona.has(correo)) {\n          porPersona.set(correo, { nombre: u.nombre, orgId: org.orgId, obras: [] });\n        }\n        porPersona.get(correo).obras.push(String(obra.nombre || obra.id));`,
      a:  `        porPersona.set(\`\${correo}|\${obra.id}\`, { nombre: u.nombre, orgId: org.orgId, obras: [String(obra.nombre || obra.id)] });` },
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
      `rec-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    // Reemplazo por FUNCIÓN: en un reemplazo de texto, `$'`, `` $` `` y `$&`
    // se expanden, y estos fragmentos están llenos de `$`.
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

const { fuenteDe, SimboloPerdido } = require('./extraer-de-app.cjs');
const { FieldValue } = require(path.join(raiz, 'functions/node_modules/firebase-admin/lib/firestore'));
const { parse } = require(path.join(raiz, 'node_modules/@babel/parser'));
const traverse = require(path.join(raiz, 'node_modules/@babel/traverse')).default;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── El manejador y su configuración, por AST ────────────────────────────────
// La configuración se saca igual que el manejador porque también es conducta:
// `schedule` es LA HORA A LA QUE CLOUD SCHEDULER DISPARA. No es un símbolo que
// exista o no, es el plazo con el que el aviso cumple o no cumple.
function piezasDelExport(archivo, nombre) {
  const codigo = fs.readFileSync(archivo, 'utf8');
  const ast = parse(codigo, { sourceType: 'module' });
  let src = null, config = null;
  traverse(ast, {
    AssignmentExpression(p) {
      const iz = p.node.left;
      if (!(iz.type === 'MemberExpression' && iz.object.name === 'exports'
            && iz.property.name === nombre)) return;
      const de = p.node.right;
      if (de.type !== 'CallExpression' || !de.arguments.length) return;
      src = codigo.slice(de.arguments[de.arguments.length - 1].start,
        de.arguments[de.arguments.length - 1].end);
      if (de.arguments.length > 1) {
        config = codigo.slice(de.arguments[0].start, de.arguments[0].end);
      }
    },
  });
  if (!src) noArranco([`exports.${nombre} = onSchedule(…)`], path.relative(raiz, archivo));
  const sub = parse(`(${src})`, { sourceType: 'module' });
  const libres = new Set();
  traverse(sub, {
    ReferencedIdentifier(p) {
      if (p.scope.hasBinding(p.node.name, true)) return;
      libres.add(p.node.name);
    },
  });
  return { src, config, libres: [...libres] };
}

// ── El Firestore de mentira ────────────────────────────────────────────────
// Lo mínimo para que el código real corra y se pueda mirar qué hizo. No simula
// reglas: aquí se mide la LÓGICA del trabajo, que corre como administrador y a
// la que ninguna regla protege.
function baseFalsa(docsIniciales) {
  const docs = new Map(Object.entries(docsIniciales));
  const escrituras = [];
  let seq = 0;

  const refDoc = (ruta) => ({
    id: ruta.split('/').pop(),
    get: async () => ({
      exists: docs.has(ruta), id: ruta.split('/').pop(),
      data: () => docs.get(ruta), updateTime: null,
    }),
    set: async (d, opt) => {
      escrituras.push({ ruta, d });
      docs.set(ruta, opt && opt.merge ? { ...(docs.get(ruta) || {}), ...d } : d);
    },
    update: async (d) => { escrituras.push({ ruta, d }); docs.set(ruta, { ...(docs.get(ruta) || {}), ...d }); },
    collection: (sub) => coleccion(`${ruta}/${sub}`),
  });

  const hijos = (col) => [...docs.entries()]
    .filter(([r]) => r.startsWith(`${col}/`) && !r.slice(col.length + 1).includes('/'))
    .map(([r, d]) => ({ id: r.slice(col.length + 1), data: () => d, updateTime: null, ref: refDoc(r) }));

  const coleccion = (col, filtros = []) => ({
    where: (campo, op, val) => {
      if (!['==', '!=', 'in'].includes(op)) {
        noArranco([`la base de mentira no sabe del operador '${op}'`], 'baseFalsa');
      }
      return coleccion(col, [...filtros, { campo, op, val }]);
    },
    get: async () => {
      let filas = hijos(col);
      for (const f of filtros) {
        filas = filas.filter(x => {
          const v = x.data()[f.campo];
          // Firestore DESCARTA los documentos sin el campo en una desigualdad.
          if (f.op === '!=') return v !== undefined && v !== f.val;
          if (f.op === 'in') return f.val.includes(v);
          return v === f.val;
        });
      }
      return { docs: filas, size: filas.length, empty: filas.length === 0, forEach: cb => filas.forEach(cb) };
    },
    doc: (id) => refDoc(`${col}/${id}`),
    add: async (d) => {
      const ruta = `${col}/auto-${++seq}`;
      escrituras.push({ ruta, d });
      docs.set(ruta, d);
      return refDoc(ruta);
    },
  });

  return {
    docs, escrituras,
    admin: { firestore: () => ({ doc: refDoc, collection: coleccion }), initializeApp: () => {} },
  };
}

// Monta la pieza real sobre la base de mentira. `rebota` es el buzón al que el
// servidor de correo le dice no: hace falta para medir que un rebote no tumba
// el aviso de los demás.
function montar(nombreExport, base, { correos = [], rebota = null } = {}) {
  const { src, libres } = piezasDelExport(ARCH_FUNCS, nombreExport);
  let cuerpo;
  try {
    ({ cuerpo } = fuenteDe(ARCH_FUNCS, libres, { tolerante: true }));
  } catch (e) {
    if (e instanceof SimboloPerdido) noArranco(e.faltantes, e.archivo);
    throw e;
  }
  const fetchFalso = async (url, opciones) => {
    const sobre = { url, ...JSON.parse(opciones.body || '{}') };
    if (rebota && (sobre.to || []).includes(rebota)) {
      return { ok: false, status: 422, json: async () => ({ message: 'buzón inexistente' }) };
    }
    correos.push(sobre);
    return { ok: true, status: 200, json: async () => ({ id: `re_${correos.length}` }) };
  };
  const inyectar = {
    require: (modulo) => {
      if (modulo === 'firebase-admin') return base.admin;
      if (modulo === 'firebase-admin/firestore') return { FieldValue };
      return require(modulo);
    },
    FieldValue,
    fetch: fetchFalso,
    defineSecret: () => ({ value: () => 'clave-de-mentira' }),
  };
  const nombres = Object.keys(inyectar);
  try {
    return new Function(...nombres,
      `"use strict";\n${cuerpo}\nreturn (${src});`)(...nombres.map(n => inyectar[n]));
  } catch (e) {
    noArranco([`no se pudo montar \`${nombreExport}\`: ${e.message}`], path.relative(raiz, ARCH_FUNCS));
  }
}

// ── La siembra ─────────────────────────────────────────────────────────────
// Una constructora y un municipio. LAS DOS TIENEN UNA OBRA `0112`, con nombres
// distintos: los códigos de obra los pone cada quien y un id que coincide es lo
// normal, no lo rebuscado. Ahí es donde se ve si algo cruza.
const ORG_C = 'fosmon', ORG_D = 'coatzacoalcos';

// La semana en curso, calculada como la calcula el servidor. Se usa para
// sembrar la obra QUE YA CERRÓ: si se tecleara una semana fija, el banco
// caducaría el año que viene.
function semanaDeHoy(fecha = new Date()) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const inicioAño = new Date(d.getFullYear(), 0, 1);
  const sem = Math.ceil(((d - inicioAño) / 86400000 + 1) / 7);
  return `S${String(sem).padStart(2, '0')}-${d.getFullYear()}`;
}
const SEM_HOY = semanaDeHoy();
const SEM_VIEJA = 'S01-2020';   // nunca es la de hoy

const N_RAIZ_0112 = '0112 CANGREJERA';
const N_RAIZ_0120 = '0120 MALECON';
const N_RAIZ_ARCH = '0199 OBRA ARCHIVADA';
const N_DEP_0112 = '0112 DRENAJE JOHN SPARKS';
const N_DEP_0128 = '0128 COLECTOR PONIENTE';

const idDe = (correo) => correo.toLowerCase().replace(/@/g, '_').replace(/\./g, '_');

function siembra({ dosEnLaRaiz = false } = {}) {
  const d = {};
  d[`orgs/${ORG_C}`] = { nombre: 'FOSMON', tipo: 'constructora', activa: true };
  d[`orgs/${ORG_D}`] = { nombre: 'H. Ayuntamiento de Coatzacoalcos', tipo: 'dependencia', activa: true };
  if (dosEnLaRaiz) d['orgs/otra'] = { nombre: 'Otra Constructora', tipo: 'constructora', activa: true };

  // La raíz: una sin cerrar, una ya cerrada, una archivada sin cerrar.
  d['obras/0112'] = { nombre: N_RAIZ_0112, estado: 'activa' };
  d['obras/0112/avance/historial'] = { semanas: [{ id: SEM_VIEJA }] };
  d['obras/0120'] = { nombre: N_RAIZ_0120, estado: 'activa' };
  d['obras/0120/avance/historial'] = { semanas: [{ id: SEM_VIEJA }, { id: SEM_HOY }] };
  d['obras/0199'] = { nombre: N_RAIZ_ARCH, estado: 'archivada' };

  // El municipio: dos sin cerrar, una de ellas con el id de la raíz.
  d[`orgs/${ORG_D}/obras/0112`] = { nombre: N_DEP_0112, estado: 'activa' };
  d[`orgs/${ORG_D}/obras/0128`] = { nombre: N_DEP_0128, estado: 'activa' };

  const u = (correo, extra) => { d[`usuarios/${idDe(correo)}`] = { correo, email: correo, ...extra }; };

  // Constructora.
  u('res@fosmon.com.mx', { nombre: 'Rosa Residente', rol: 'residente', orgId: ORG_C,
    activo: true, uid: 'uid-res_c', obras_asignadas: ['0112', '0120', '0199'] });
  // Dirección: ve TODAS las obras. Tiene 0112 asignada y aun así no recibe un
  // aviso por obra — responde por el portafolio, no por un cierre.
  u('dg@fosmon.com.mx', { nombre: 'Daniel Director', rol: 'director_general', orgId: ORG_C,
    activo: true, uid: 'uid-dg_c', obras_asignadas: ['0112'] });
  u('baja@fosmon.com.mx', { nombre: 'Beto Baja', rol: 'residente', orgId: ORG_C,
    activo: false, uid: 'uid-baja', obras_asignadas: ['0112'] });
  // Con uid y SIN correo: la campana sí, el correo no se puede mandar.
  d[`usuarios/${idDe('sincorreo@fosmon.com.mx')}`] = { nombre: 'Sin Correo',
    rol: 'superintendente', orgId: ORG_C, activo: true, uid: 'uid-sincorreo',
    obras_asignadas: ['0112'] };

  // Dependencia. El supervisor captura: es el que no recibía nada.
  u('supervisor@cotea.com.mx', { nombre: 'Sara Supervisora', rol: 'supervisor_obra',
    orgId: ORG_D, activo: true, uid: 'uid-sup_d', obras_asignadas: ['0112', '0128'] });
  // `administrativo` también captura, y este perfil trae `correo` y NO `email`
  // —se dio de alta a mano—, además de no tener `uid`: el correo tiene que
  // salir igual.
  d[`usuarios/${idDe('admvo@cotea.com.mx')}`] = { nombre: 'Ana Administrativa',
    correo: 'admvo@cotea.com.mx', rol: 'administrativo', orgId: ORG_D, activo: true,
    obras_asignadas: ['0128'] };
  // Dirección de obras del municipio: ve todas, no recibe aviso por obra.
  u('orlando@cotea.com.mx', { nombre: 'Orlando', rol: 'director_obras', orgId: ORG_D,
    activo: true, uid: 'uid-dir_d', obras_asignadas: ['0112', '0128'] });
  return d;
}

const campanitas = (base) => base.escrituras
  .filter(e => e.ruta.startsWith('notificaciones/'))
  .map(e => ({ uid: e.ruta.split('/')[1], ...e.d }));

const paraQuien = (correos, quien) => correos.find(c => (c.to || []).includes(quien));

(async () => {
  console.log('\n── EL RECORDATORIO DEL VIERNES ──');
  console.log(`   semana en curso: ${SEM_HOY}\n`);

  // ═══ §1 · LA DEPENDENCIA RECIBE, QUE ES EL AGUJERO ════════════════════════
  console.log('§1 · en una dependencia el que captura es el que no recibía nada');
  const base = baseFalsa(siembra());
  const correos = [];
  const fn = montar('recordatorioCapturaObra', base, { correos });
  await fn({});

  const alSup = paraQuien(correos, 'supervisor@cotea.com.mx');
  check(!!alSup, 'al supervisor de obra del municipio le llega el correo',
    alSup ? 'le llegó' : `NO LE LLEGÓ — salieron ${correos.length}: ` +
      correos.map(c => (c.to || []).join('')).join(', '));

  check(!!alSup && alSup.html.includes(N_DEP_0112) && alSup.html.includes(N_DEP_0128),
    'y su correo nombra LAS DOS obras del municipio sin cerrar',
    alSup ? [N_DEP_0112, N_DEP_0128].filter(n => !alSup.html.includes(n)).join(', ') || 'las dos'
      : 'sin correo');

  const alAdmvo = paraQuien(correos, 'admvo@cotea.com.mx');
  check(!!alAdmvo,
    'y al administrativo también, que captura, no tiene `uid` y trae `correo` en vez de `email`',
    alAdmvo ? 'le llegó' : 'NO LE LLEGÓ');

  // Y sin `uid` el correo es el ÚNICO canal, porque la campana no existe. La
  // regla sólo deja leer `notificaciones/{request.auth.uid}`, y el id del
  // documento de perfil se deriva del correo, así que un aviso escrito ahí no
  // lo puede abrir nadie —ni la persona— y se contaba como mandado.
  const porLa0128 = campanitas(base).filter(n => /COLECTOR/.test(n.titulo || ''));
  check(porLa0128.length === 1 && porLa0128[0].uid === 'uid-sup_d',
    'y sin `uid` no se escribe una campana en una ruta que nadie puede leer',
    porLa0128.map(n => n.uid).join(', ') || 'ninguna');

  // ═══ §2 · NADA CRUZA LA FRONTERA ══════════════════════════════════════════
  console.log('\n§2 · dos obras con el mismo id `0112`, una por organización');
  check(!!alSup && !alSup.html.includes(N_RAIZ_0112),
    'el correo del municipio NO nombra la 0112 de la constructora',
    alSup && alSup.html.includes(N_RAIZ_0112)
      ? 'LA NOMBRÓ — el municipio leyó el nombre de una obra ajena' : 'fuera');

  const alRes = paraQuien(correos, 'res@fosmon.com.mx');
  check(!!alRes && alRes.html.includes(N_RAIZ_0112) && !alRes.html.includes(N_DEP_0112),
    'y el de la constructora nombra la suya y NO la del municipio',
    alRes ? (alRes.html.includes(N_DEP_0112) ? 'NOMBRÓ LA DEL MUNICIPIO' : 'sólo la suya')
      : 'NO LE LLEGÓ');

  // Un recordatorio no es un informe. Sin esto, el camino más corto para
  // «hacerlo útil» es meterle el avance y el gasto, y entonces el correo de un
  // municipio llevaría economía del contratista.
  check(correos.length > 0 && correos.every(c => !/\$/.test(c.html)),
    'ningún correo lleva una sola cifra de dinero',
    correos.filter(c => /\$/.test(c.html)).map(c => (c.to || [])[0]).join(', ') || 'sin cifras');

  // ═══ §3 · A QUIÉN NO ══════════════════════════════════════════════════════
  console.log('\n§3 · a quién NO se le toca la puerta');
  check(!paraQuien(correos, 'dg@fosmon.com.mx'),
    'a la dirección general no, aunque tenga la 0112 asignada: ve todas las obras',
    paraQuien(correos, 'dg@fosmon.com.mx') ? 'LE LLEGÓ' : 'fuera');
  check(!paraQuien(correos, 'orlando@cotea.com.mx'),
    'ni a la dirección de obras del municipio, por lo mismo',
    paraQuien(correos, 'orlando@cotea.com.mx') ? 'LE LLEGÓ' : 'fuera');
  check(!paraQuien(correos, 'baja@fosmon.com.mx'),
    'ni a la cuenta dada de baja',
    paraQuien(correos, 'baja@fosmon.com.mx') ? 'LE LLEGÓ' : 'fuera');
  check(!!alRes && !alRes.html.includes(N_RAIZ_0120),
    'y no se nombra la obra que YA cerró esta semana',
    alRes && alRes.html.includes(N_RAIZ_0120) ? 'LA NOMBRÓ' : 'fuera');
  check(!!alRes && !alRes.html.includes(N_RAIZ_ARCH),
    'ni la obra archivada, aunque tampoco haya cerrado',
    alRes && alRes.html.includes(N_RAIZ_ARCH) ? 'LA NOMBRÓ' : 'fuera');

  // La campana sigue existiendo, y le llega a quien no tiene correo.
  const uids = campanitas(base).map(n => n.uid);
  check(uids.includes('uid-sincorreo'),
    'el perfil sin correo se queda con la campana, que es el canal que sí tiene',
    uids.includes('uid-sincorreo') ? 'avisado' : 'SE QUEDÓ SIN NINGÚN CANAL');
  check(!uids.includes('uid-dg_c') && !uids.includes('uid-dir_d'),
    'y las direcciones tampoco reciben campana por obra',
    uids.filter(x => ['uid-dg_c', 'uid-dir_d'].includes(x)).join(', ') || 'fuera');

  // ═══ §4 · UN CORREO POR PERSONA, NO UNO POR OBRA ══════════════════════════
  console.log('\n§4 · un correo por persona');
  const paraSup = correos.filter(c => (c.to || []).includes('supervisor@cotea.com.mx'));
  check(paraSup.length === 1,
    'la supervisora recibe UN correo con sus dos obras, no dos correos',
    `${paraSup.length} correo(s)`);
  check(correos.length === 3,
    'salen tres correos en total: residente, supervisora y administrativa',
    `${correos.length}: ${correos.map(c => (c.to || []).join('')).sort().join(', ')}`);
  check(correos.every(c => (c.to || []).length === 1),
    'y cada correo va a un solo buzón: nadie lee la lista de los demás',
    correos.map(c => (c.to || []).length).join(', '));

  // ═══ §5 · EL PLAZO QUE NOMBRA ═════════════════════════════════════════════
  console.log('\n§5 · el plazo que nombra, y la hora a la que sale');
  check(!!alSup && /sábado a las 2 p\.m\./.test(alSup.html),
    'el correo dice que el corte es el sábado a las 2 p.m.',
    alSup && /corte del viernes/.test(alSup.html) ? 'DICE «corte del viernes», que no existe'
      : (alSup && /sábado/.test(alSup.html) ? 'lo dice' : 'NO NOMBRA EL PLAZO'));
  check(!!alSup && alSup.subject.includes(SEM_HOY) && /2 p\.m\./.test(alSup.subject),
    'y el asunto trae la semana y la hora, para que se decida sin abrirlo',
    alSup ? alSup.subject : 'sin correo');

  const campanaSup = campanitas(base).find(n => n.uid === 'uid-sup_d');
  check(!!campanaSup && /sábado a las 2 p\.m\./.test(campanaSup.mensaje)
    && !/corte del viernes/.test(campanaSup.mensaje),
    'la campana nombra el mismo plazo que el correo',
    campanaSup ? campanaSup.mensaje : 'sin campana');

  // La hora de disparo es conducta: es cuándo Scheduler lo corre.
  const { config } = piezasDelExport(ARCH_FUNCS, 'recordatorioCapturaObra');
  const cron = (/schedule:\s*"([^"]+)"/.exec(config || '') || [])[1] || '';
  const partes = cron.split(/\s+/);
  check(partes[4] === '5' && partes[1] === '14' && partes[0] === '0',
    'el trabajo dispara el viernes a las 14:00 — 24 h justas antes del corte',
    cron || '(sin schedule)');
  check(/timeZone:\s*"America\/Mexico_City"/.test(config || ''),
    'y en hora de México, que es donde está el corte',
    /timeZone/.test(config || '') ? 'CDMX' : 'SIN ZONA — correría en UTC');
  check(/secrets:\s*\[RESEND_API_KEY\]/.test(config || ''),
    'y lleva la llave de Resend declarada: sin ella no hay correo que mandar',
    /secrets/.test(config || '') ? 'declarada' : 'FALTA — `value()` lanzaría en producción');

  // ═══ §6 · UN BUZÓN QUE REBOTA NO TUMBA A LOS DEMÁS ════════════════════════
  console.log('\n§6 · un buzón que rebota');
  {
    const b = baseFalsa(siembra());
    const cs = [];
    const f = montar('recordatorioCapturaObra', b, { correos: cs, rebota: 'res@fosmon.com.mx' });
    let err = null;
    try { await f({}); } catch (e) { err = e; }
    check(!err, 'el trabajo no revienta porque un buzón no exista',
      err ? `LANZÓ: ${err.message.slice(0, 60)}` : 'terminó');
    check(!!paraQuien(cs, 'supervisor@cotea.com.mx') && !!paraQuien(cs, 'admvo@cotea.com.mx'),
      'y los otros dos correos salen igual',
      `${cs.length} salieron: ${cs.map(c => (c.to || []).join('')).sort().join(', ')}`);
  }

  // ═══ §7 · DOS ORGANIZACIONES EN LA RAÍZ: NO SE ADIVINA ════════════════════
  console.log('\n§7 · si no se sabe de quién es `obras/`, no sale nada');
  {
    const b = baseFalsa(siembra({ dosEnLaRaiz: true }));
    const cs = [];
    const f = montar('recordatorioCapturaObra', b, { correos: cs });
    let err = null;
    try { await f({}); } catch (e) { err = e; }
    check(cs.length === 0,
      'con dos organizaciones en la raíz no sale un solo correo',
      cs.length ? `SALIERON ${cs.length}: ${cs.map(c => (c.to || []).join('')).join(', ')}` : 'ninguno');
    check(!!err, 'y el trabajo sale rojo, no verde en silencio',
      err ? 'lanzó' : 'TERMINÓ BIEN — Scheduler lo contaría como exitoso');
    check(campanitas(b).length === 0, 'ni una campanita',
      `${campanitas(b).length}`);
  }

  // ═══ §8 · LA LISTA DE ROLES NO ES UNA TERCERA LISTA ═══════════════════════
  console.log('\n§8 · quién captura en campo se deriva, no se teclea');
  {
    const { QUIEN_CAPTURA_EN_CAMPO, QUIEN_CIERRA, ROLES_TODAS_OBRAS } =
      require('./extraer-de-app.cjs').deArchivo(ARCH_FUNCS,
        'QUIEN_CAPTURA_EN_CAMPO', 'QUIEN_CIERRA', 'ROLES_TODAS_OBRAS');

    // Los tres roles que estaban TECLEADOS A MANO en `usuariosCapturaDeObra`
    // hasta el 2026-11-16. Que la derivación los reproduzca exactamente es la
    // afirmación de que este cambio NO altera a quién le llega en la
    // constructora: lo único que hace es alcanzar a la dependencia.
    const LOS_DE_ANTES = ['superintendente', 'residente', 'administrador_obra'];
    const ahora = QUIEN_CAPTURA_EN_CAMPO('constructora');
    check(ahora.length === LOS_DE_ANTES.length && LOS_DE_ANTES.every(r => ahora.includes(r)),
      'en una constructora salen exactamente los tres roles de antes',
      ahora.join(', '));

    const dep = QUIEN_CAPTURA_EN_CAMPO('dependencia');
    check(dep.includes('supervisor_obra') && dep.includes('administrativo'),
      'y en una dependencia, los dos que capturan de verdad',
      dep.join(', ') || 'NINGUNO — el municipio se queda sin destinatarios');

    check(dep.every(r => !ROLES_TODAS_OBRAS.has(r))
      && ahora.every(r => !ROLES_TODAS_OBRAS.has(r)),
      'nadie que vea todas las obras recibe un aviso por obra',
      [...ahora, ...dep].filter(r => ROLES_TODAS_OBRAS.has(r)).join(', ') || 'ninguno');

    check([...ahora, ...dep].every(r =>
      (QUIEN_CIERRA.constructora.includes(r) || QUIEN_CIERRA.dependencia.includes(r))),
      'y todos los que reciben el aviso PUEDEN cerrar la semana',
      [...ahora, ...dep].filter(r => !QUIEN_CIERRA.constructora.includes(r)
        && !QUIEN_CIERRA.dependencia.includes(r)).join(', ') || 'todos');

    check(QUIEN_CAPTURA_EN_CAMPO('soporte').length === 0
      && QUIEN_CAPTURA_EN_CAMPO(undefined).length === 0,
      'un tipo de organización que no existe no produce destinatarios',
      `soporte=${QUIEN_CAPTURA_EN_CAMPO('soporte').length} · ` +
      `sin tipo=${QUIEN_CAPTURA_EN_CAMPO(undefined).length}`);
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'el aviso alcanza a quien captura en cada organización, nombra el plazo de\n' +
      'verdad y no lleva ni una cifra que no sea suya.'
    : 'un recordatorio que no llega no se distingue de uno que no existe.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
