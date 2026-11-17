#!/usr/bin/env node
// EL RENGLÓN DE SALUD DICE LO QUE LA CORRIDA MIDIÓ, NO QUE LA CORRIDA TERMINÓ
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// `registrarSalud(tipo, ok, mensaje, meta)` escribe en `global/health` y es el
// único registro de que un trabajo del servidor corrió. Tres de sus llamadas
// le pasaban `true` TECLEADO. Un `true` tecleado no distingue «el aviso salió»
// de «el trabajo llegó hasta aquí»: sólo lo segundo, y sólo lo segundo ya lo
// dice Cloud Scheduler.
//
// Ese `true` convivía con tres pérdidas concretas, y son una sola avería con
// tres caras —algo falla en medio de un bucle, el `catch` se lo come para no
// tumbar el resto, y el fallo no deja rastro en ninguna parte—:
//
//   1. `generarYEnviarResumenSemanal` recoge los KPIs de cada obra con
//      `.catch(() => null)` y filtra los nulos. La obra desaparecía de la
//      tabla, de los cuatro totales de dinero y de la cuenta del mosaico, y
//      el correo salía diciendo «N obras activas» con N corto. Dirección leía
//      un portafolio incompleto presentado como completo.
//   2. `crearNotifCloud` devolvía `undefined` tanto si escribió la campana
//      como si no, y los tres sitios que la llaman hacían `contador++`
//      DESPUÉS del `await`. La cuenta de notificaciones era siempre perfecta
//      porque contaba intentos.
//   3. `avisarCierreSemanalPendiente` atrapa el rebote de un buzón para no
//      tumbar el aviso de los demás —correcto— pero sólo lo escribía en un
//      `console.warn`. El objeto que viaja al renglón de salud llevaba
//      `enviados` y nada más: una corrida donde los siete buzones rebotan
//      devolvía `correos: 0` y se anotaba igual que una semana sin nada que
//      avisar.
//
// ── QUÉ AFIRMA ESTE BANCO ───────────────────────────────────────────────────
// Nada de que un símbolo exista, y nada sobre las palabras que el arreglo
// añadió. Los tres manejadores reales se EXTRAEN de `functions/index.js` por
// AST, se montan con su cierre transitivo sobre un Firestore de mentira y SE
// EJECUTAN. Lo que se mide es el documento `global/health` que quedó escrito y
// el correo que salió.
//
// La pieza que hace falta para medir esto es poder tirar UNA ruta: el modo de
// falla que importa no es que el trabajo reviente —eso ya se ve— sino que una
// lectura o una escritura suelta se caiga, el `catch` de arriba la absorba, y
// la corrida se anote como buena. De ahí `fallaLectura` / `fallaEscritura` en
// la base de mentira.
//
// Y cada afirmación en rojo va con su gemela en VERDE: un banco que sólo mide
// el camino del fallo se queda verde con un `ok: false` tecleado, que es el
// mismo defecto con el signo cambiado.
//
// Uso:
//   node scripts/prueba-el-renglon-de-salud-no-dice-ok-cuando-el-aviso-no-salio.cjs
//   node scripts/prueba-el-renglon-de-salud-no-dice-ok-cuando-el-aviso-no-salio.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');

// ── La contraprueba ─────────────────────────────────────────────────────────
// Una mutación por afirmación. Las mutaciones devuelven el código al estado
// exacto en que estaba antes de este cambio: cada una es la avería de verdad,
// no un andamio roto.
if (process.argv[2] === '--contraprueba') {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const MUTACIONES = [
    { nombre: 'la obra que no se pudo leer vuelve a caerse sin dejar rastro',
      de: `      noLeidas.push({ obraId: o.id, nombre: o.nombre || o.id, motivo: e?.message || String(e) });`,
      a:  `      void 0;` },
    { nombre: 'el renglón de salud del correo semanal vuelve a decir `true` tecleado',
      de: `    await registrarSalud("email_semanal", salio && noLeidas.length === 0,`,
      a:  `    await registrarSalud("email_semanal", true,` },
    { nombre: 'y el asunto vuelve a contar sólo las obras que sí se leyeron',
      de: `  const subject = \`cotea · Resumen semanal · \${totalObras} obras activas\` +\n    (nNoLeidas > 0 ? \` · \${nNoLeidas} sin leer\` : "");`,
      a:  `  const subject = \`cotea · Resumen semanal · \${totalObras} obras activas\`;` },
    { nombre: 'el correo deja de nombrar CUÁL obra no se pudo leer',
      de: `${'${avisoDeCaptura(obrasSinCaptura, obrasSinUnCierre)}${bloqueDenegaciones(denegaciones)}${bloqueFueraDeAlcance(reparto)}${bloqueObrasNoLeidas(noLeidas)}'}`,
      a:  `${'${avisoDeCaptura(obrasSinCaptura, obrasSinUnCierre)}${bloqueDenegaciones(denegaciones)}${bloqueFueraDeAlcance(reparto)}'}` },
    { nombre: 'un correo que no le llegó a nadie vuelve a anotarse como enviado',
      de: `    const salio = (res.enviados || 0) > 0;`,
      a:  `    const salio = true;` },
    { nombre: 'el rebote del buzón vuelve a quedarse sólo en el registro de Cloud',
      de: `      rebotados.push({ correo, motivo: e?.message || String(e) });`,
      a:  `      void 0;` },
    { nombre: 'y el renglón del recordatorio vuelve a decir `true` tecleado',
      de: `    await registrarSalud("recordatorio_obra", falló === 0,`,
      a:  `    await registrarSalud("recordatorio_obra", true,` },
    { nombre: 'la campana que no se pudo escribir vuelve a contestar `undefined`',
      de: `      });\n    return true;\n  } catch (e) {`,
      a:  `      });\n  } catch (e) {` },
    { nombre: 'y el recordatorio del viernes vuelve a contar intentos',
      de: `          if (puesta) notifs++;\n          else notifsFallidas.push({ uid: u.uid, obraId: obra.id });`,
      a:  `          notifs++;` },
    { nombre: 'el recordatorio del lunes también vuelve a contar intentos',
      de: `          if (puesta2) contadorNotifs++; else notifsFallidas.push({ uid: u.uid, obraId: obra.id });`,
      a:  `          contadorNotifs++;` },
    { nombre: 'y su renglón vuelve a decir `true` tecleado',
      de: `    await registrarSalud("recordatorio_lunes", notifsFallidas.length === 0,`,
      a:  `    await registrarSalud("recordatorio_lunes", true,` },
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
      `salud-mut-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
    // Reemplazo por FUNCIÓN: `$'`, `` $` `` y `$&` se expanden en un reemplazo
    // de texto, y estos fragmentos están llenos de `$`.
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

// El renglón que este banco mide: lo que quedó escrito en `global/health`.
const salud = (base, tipo) => (base.docs.get('global/health') || {})[tipo] || null;

// ── La siembra ─────────────────────────────────────────────────────────────
// Una constructora, dos obras activas y un director que recibe el resumen.
// La 0130 es la que se va a volver ilegible: tiene presupuesto grande a
// propósito, para que su ausencia en los totales se vea en el número y no
// sólo en el conteo.
const ORG = 'fosmon';
const N_0112 = '0112 CANGREJERA';
const N_0130 = '0130 LA ESCOLLERA';
const RUTA_ILEGIBLE = 'obras/0130/config/info';
const MOTIVO = 'PERMISSION_DENIED: no se pudo leer config/info';

function siembra({ directorEnOtraOrg = false } = {}) {
  const d = {};
  d[`orgs/${ORG}`] = { nombre: 'FOSMON', tipo: 'constructora', activa: true };
  d[`orgs/${ORG}/config/branding`] = { empresa: 'FOSMON', empresaCorta: 'FOSMON' };

  d['obras/0112'] = { nombre: N_0112, estado: 'activa' };
  d['obras/0112/config/info'] = {
    nombre: N_0112, presupuesto: 1000000, contrato: 'C-0112', cliente: 'PEMEX',
    gastoGP: 250000,
  };
  d['obras/0112/avance/historial'] = { semanas: [{ id: 'S01-2020', fecha: '2020-01-05' }] };
  d['obras/0112/config/estimaciones'] = { data: [{ monto: 400000, estatus: 'Pagada' }] };

  d['obras/0130'] = { nombre: N_0130, estado: 'activa' };
  d['obras/0130/config/info'] = { nombre: N_0130, presupuesto: 9000000, gastoGP: 100000 };
  d['obras/0130/avance/historial'] = { semanas: [] };

  d['usuarios/dg_fosmon_com_mx'] = {
    nombre: 'Daniel Director', correo: 'dg@fosmon.com.mx', email: 'dg@fosmon.com.mx',
    rol: 'director_general', orgId: directorEnOtraOrg ? 'otra' : ORG, activo: true,
    uid: 'uid-dg',
  };
  return d;
}

// Para el recordatorio del viernes y el del lunes: dos personas que capturan
// en campo, las dos con `uid` —hace falta para que la campana se intente— y
// con la obra asignada.
function siembraDeCampo() {
  const d = siembra();
  d['usuarios/res_fosmon_com_mx'] = {
    nombre: 'Rosa Residente', correo: 'res@fosmon.com.mx', email: 'res@fosmon.com.mx',
    rol: 'residente', orgId: ORG, activo: true, uid: 'uid-res',
    obras_asignadas: ['0112', '0130'],
  };
  d['usuarios/sup_fosmon_com_mx'] = {
    nombre: 'Saúl Superintendente', correo: 'sup@fosmon.com.mx', email: 'sup@fosmon.com.mx',
    rol: 'superintendente', orgId: ORG, activo: true, uid: 'uid-sup',
    obras_asignadas: ['0112', '0130'],
  };
  return d;
}

const campanas = (base) => base.escrituras.filter(e => e.ruta.startsWith('notificaciones/'));

(async () => {
  console.log('\n── EL RENGLÓN DE SALUD ──\n');

  // ═══ §1 · UNA OBRA QUE NO SE PUDO LEER NO SE CAE EN SILENCIO ══════════════
  console.log('§1 · el correo semanal con una obra ilegible');
  const base = baseFalsa(siembra(), {
    fallaLectura: (r) => (r === RUTA_ILEGIBLE ? MOTIVO : null),
  });
  const correos = [];
  await montar('resumenSemanalEmail', base, { correos })({});

  const correo = correos[0];
  check(correos.length === 1,
    'el correo sale igual: una obra rota no tumba el resumen de las otras',
    `${correos.length} correo(s)`);

  check(!!correo && correo.html.includes(N_0130),
    'y NOMBRA la obra que no se pudo leer: sin el nombre nadie puede ir a ver qué pasó',
    correo && correo.html.includes(N_0130) ? 'la nombra' : 'NO LA NOMBRA');

  check(!!correo && correo.html.includes('no se pudo leer') && correo.html.includes('PERMISSION_DENIED'),
    'con su motivo, que es lo que distingue un permiso de un documento ausente',
    correo && correo.html.includes('PERMISSION_DENIED') ? 'con motivo' : 'SIN MOTIVO');

  // El mosaico dice «1 obra activa» porque es lo que pudo presentar. Lo que no
  // puede hacer es decir 1 y callarse que había 2.
  check(!!correo && /1 obra no se pudo leer/.test(correo.html),
    'el hueco va PEGADO a la cuenta de obras, que es el número al que le falta',
    correo && /1 obra no se pudo leer/.test(correo.html) ? 'declarado' : 'EL CONTEO VA SOLO');

  // Los nueve millones de la obra ilegible NO se cuelan ni se corrigen: la
  // cifra que sale es la de lo que se midió, y arriba dice que va corta.
  check(!!correo && correo.html.includes('$1,000,000') && !correo.html.includes('$10,000,000'),
    'el presupuesto total suma sólo lo que se leyó: no se inventa el de la obra ilegible',
    correo && correo.html.includes('$10,000,000') ? 'SUMÓ LA ILEGIBLE' : '$1,000,000');

  check(!!correo && / · 1 sin leer/.test(correo.subject),
    'y el asunto lo dice, que es lo único que se lee sin abrir el correo',
    correo ? correo.subject : 'sin correo');

  // ═══ §2 · Y EL RENGLÓN DE SALUD TAMPOCO DICE QUE TODO SALIÓ ═══════════════
  console.log('\n§2 · el renglón de salud de ese correo');
  const r1 = salud(base, 'email_semanal');
  check(!!r1 && r1.ok === false,
    'la corrida queda en ROJO: el correo salió pero salió incompleto',
    r1 ? `ok=${r1.ok}` : 'NO SE ESCRIBIÓ EL RENGLÓN');
  check(!!r1 && /INCOMPLETO/.test(r1.mensaje) && /0130/.test(r1.mensaje),
    'y el mensaje nombra la obra, para no tener que abrir el correo de la semana',
    r1 ? r1.mensaje : 'sin renglón');
  check(!!r1 && Array.isArray(r1.noLeidas) && r1.noLeidas.length === 1
    && r1.noLeidas[0].motivo.includes('PERMISSION_DENIED'),
    'el motivo queda medido en el registro, no sólo dicho en el correo de esta vez',
    r1 && r1.noLeidas ? JSON.stringify(r1.noLeidas[0]) : 'sin noLeidas');

  // El gemelo en verde. Sin esto, un `ok: false` tecleado dejaría el banco
  // igual de verde que el arreglo.
  {
    const b = baseFalsa(siembra());
    const cs = [];
    await montar('resumenSemanalEmail', b, { correos: cs })({});
    const r = salud(b, 'email_semanal');
    check(!!r && r.ok === true, 'sin ninguna obra ilegible la corrida queda en VERDE',
      r ? `ok=${r.ok} · ${r.mensaje}` : 'sin renglón');
    check(cs.length === 1 && !/sin leer/.test(cs[0].subject)
      && !/no se pudo leer/.test(cs[0].html),
      'y el correo no habla de huecos que no hubo',
      cs.length ? cs[0].subject : 'sin correo');
    check(cs.length === 1 && cs[0].html.includes('$10,000,000'),
      'con las dos obras dentro del total',
      cs.length ? 'las dos' : 'sin correo');
  }

  // Un correo que no le llegó a NADIE es el otro fallo que no lanzaba: cero
  // destinatarios devolvía `{enviados: 0}` y se anotaba en verde.
  {
    const b = baseFalsa(siembra({ directorEnOtraOrg: true }));
    const cs = [];
    await montar('resumenSemanalEmail', b, { correos: cs })({});
    const r = salud(b, 'email_semanal');
    check(cs.length === 0, 'con el único director en otra organización no sale correo',
      `${cs.length}`);
    check(!!r && r.ok === false && /NO SALIÓ/.test(r.mensaje),
      'y la corrida queda en ROJO: un resumen que no le llegó a nadie no se envió',
      r ? `ok=${r.ok} · ${r.mensaje}` : 'sin renglón');
  }

  // ═══ §3 · EL BUZÓN QUE REBOTA VIAJA HASTA EL REGISTRO ═════════════════════
  console.log('\n§3 · el recordatorio del viernes y el buzón que rebota');
  {
    const b = baseFalsa(siembraDeCampo());
    const cs = [];
    await montar('recordatorioCapturaObra', b, { correos: cs, rebota: 'res@fosmon.com.mx' })({});

    check(cs.length === 1 && (cs[0].to || []).includes('sup@fosmon.com.mx'),
      'el otro aviso sale igual: un buzón que no existe no tumba a los demás',
      `${cs.length}: ${cs.map(c => (c.to || []).join('')).join(', ')}`);

    const r = salud(b, 'recordatorio_obra');
    check(!!r && r.ok === false,
      'y la corrida queda en ROJO, no en verde con un correo menos',
      r ? `ok=${r.ok}` : 'NO SE ESCRIBIÓ EL RENGLÓN');
    check(!!r && /NO SALIERON 1 correo/.test(r.mensaje),
      'el mensaje dice cuántos no salieron, no sólo cuántos sí',
      r ? r.mensaje : 'sin renglón');
    check(!!r && Array.isArray(r.rebotados) && r.rebotados.length === 1
      && r.rebotados[0].correo === 'res@fosmon.com.mx' && !!r.rebotados[0].motivo,
      'y queda escrito QUÉ buzón rebotó y por qué: «no le llegó» no es «no se mandó»',
      r && r.rebotados ? JSON.stringify(r.rebotados) : 'sin rebotados');
  }

  // El gemelo en verde.
  {
    const b = baseFalsa(siembraDeCampo());
    const cs = [];
    await montar('recordatorioCapturaObra', b, { correos: cs })({});
    const r = salud(b, 'recordatorio_obra');
    check(cs.length === 2 && !!r && r.ok === true,
      'sin rebotes salen los dos correos y la corrida queda en VERDE',
      `${cs.length} correo(s) · ${r ? `ok=${r.ok}` : 'sin renglón'}`);
  }

  // ═══ §4 · LA CUENTA DICE CAMPANAS ESCRITAS, NO INTENTOS ═══════════════════
  console.log('\n§4 · la cuenta de campanas, cuando la escritura se cae');
  {
    const b = baseFalsa(siembraDeCampo(), {
      fallaEscritura: (r) => (r.startsWith('notificaciones/') ? 'UNAVAILABLE' : null),
    });
    const cs = [];
    await montar('recordatorioCapturaObra', b, { correos: cs })({});

    check(campanas(b).length === 0, 'no se escribió ni una campana', `${campanas(b).length}`);

    const r = salud(b, 'recordatorio_obra');
    check(!!r && r.notifs === 0,
      'y la cuenta dice 0, no los cuatro intentos que se hicieron',
      r ? `notifs=${r.notifs}` : 'sin renglón');
    check(!!r && Array.isArray(r.notifsFallidas) && r.notifsFallidas.length === 4,
      'las cuatro que no se pudieron escribir quedan nombradas por uid y obra',
      r && r.notifsFallidas ? `${r.notifsFallidas.length}` : 'sin notifsFallidas');
    check(!!r && r.ok === false,
      'la corrida queda en ROJO aunque los correos sí hayan salido',
      r ? `ok=${r.ok} · ${r.mensaje}` : 'sin renglón');
    check(cs.length === 2,
      'y los correos salen igual: la campana caída no se lleva el otro canal',
      `${cs.length}`);
  }

  // ═══ §5 · LO MISMO EN EL RECORDATORIO DEL LUNES ═══════════════════════════
  console.log('\n§5 · el recordatorio del lunes, por el mismo `crearNotifCloud`');
  {
    const b = baseFalsa(siembraDeCampo());
    await montar('recordatorioLunes', b, {})({});
    const r = salud(b, 'recordatorio_lunes');
    check(campanas(b).length > 0 && !!r && r.notifsEnviadas === campanas(b).length,
      'la cuenta coincide con las campanas que de verdad quedaron escritas',
      r ? `notifsEnviadas=${r.notifsEnviadas} · escritas=${campanas(b).length}` : 'sin renglón');
    check(!!r && r.ok === true, 'y la corrida queda en VERDE', r ? `ok=${r.ok}` : 'sin renglón');
  }
  {
    const b = baseFalsa(siembraDeCampo(), {
      fallaEscritura: (r) => (r.startsWith('notificaciones/') ? 'UNAVAILABLE' : null),
    });
    await montar('recordatorioLunes', b, {})({});
    const r = salud(b, 'recordatorio_lunes');
    check(!!r && r.notifsEnviadas === 0 && r.notifsFallidas.length > 0 && r.ok === false,
      'con la escritura caída dice 0 enviadas, nombra las fallidas y queda en ROJO',
      r ? `notifsEnviadas=${r.notifsEnviadas} · fallidas=${(r.notifsFallidas || []).length} · ok=${r.ok}` : 'sin renglón');
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'el registro dice qué midió la corrida. Un trabajo que terminó no es un\n' +
      'trabajo que avisó, y la cuenta de avisos cuenta escrituras, no intentos.'
    : 'un registro de salud que se equivoca es peor que no tenerlo: es el\n' +
      'instrumento con el que se decide no ir a ver.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
