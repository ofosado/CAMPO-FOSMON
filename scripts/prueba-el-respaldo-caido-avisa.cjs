#!/usr/bin/env node
// UN RESPALDO QUE SE CAE SE LO DICE A ALGUIEN, Y SI NO PUDO, LO DICE TAMBIÉN
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El #24 y el #26. Hasta hoy un respaldo fallido dejaba dos rastros, los dos
// PASIVOS: un renglón en `global/health` y un `console.error`. La pantalla de
// salud existe desde septiembre y nadie la abre — ése ES el #26—, así que la
// copia de toda la base podía llevar semanas sin escribirse y el primero en
// enterarse habría sido quien la necesitara.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. `backupSemanalFirestore` se monta ENTERO
// desde `functions/index.js` —con su `ejecutarBackupFirestore` y su
// `esperarFinDelExport` de verdad— y se ejecuta. El `fetch` se enruta por
// destino: lo que va a `firestore.googleapis.com` recibe la operación larga
// que el caso quiera, y lo que va a Resend se captura como correo. Lo que se
// mide es QUÉ correo salió, A QUIÉN, y qué quedó escrito en el renglón.
//
// Las tres conductas que no se pueden perder:
//
//   1. Un respaldo que no consta —fallido O sin verificar— manda correo. Los
//      dos significan lo mismo para quien reacciona: a esta hora no hay copia
//      de esta semana. Callar el segundo es el verde falso de siempre.
//   2. El aviso va SÓLO al rol de plataforma. Un director de obra no puede
//      hacer nada con esta noticia, y el respaldo no es de su organización.
//   3. «Falló» y «falló y además nadie se enteró» son dos averías distintas,
//      y la segunda deja a alguien tranquilo sin derecho. El renglón las
//      separa.
//
// Uso:
//   node scripts/prueba-el-respaldo-caido-avisa.cjs
//   node scripts/prueba-el-respaldo-caido-avisa.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('functions/index.js');

const ARCH_FUNCS = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');

const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'un respaldo caído vuelve a no avisarle a nadie',
    de: `    const aviso = fin.ok ? null : await avisarRespaldoCaido(RESEND_API_KEY.value(), {`,
    a:  `    const aviso = true ? null : await avisarRespaldoCaido(RESEND_API_KEY.value(), {` },
  { nombre: 'el «no se pudo verificar» se vuelve a callar: sólo avisa el fallo duro',
    de: `    const aviso = fin.ok ? null : await avisarRespaldoCaido(RESEND_API_KEY.value(), {`,
    a:  `    const aviso = (fin.ok || !fin.verificado) ? null : await avisarRespaldoCaido(RESEND_API_KEY.value(), {` },
  { nombre: 'el renglón vuelve a decir «enviado» sin mirar si se envió',
    de: `      aviso: aviso ? (aviso.ok ? "enviado" : \`NO SE AVISÓ: \${aviso.motivo}\`) : "no hacía falta",`,
    a:  `      aviso: aviso ? "enviado" : "no hacía falta",` },
  { nombre: 'el aviso de plataforma se le manda también a los directores de obra',
    de: `const ROLES_PLATAFORMA = ROLES_CROSS;`,
    a:  `const ROLES_PLATAFORMA = [...ROLES_CROSS, "director_general", "director_operaciones"];` },
  { nombre: 'sin una sola cuenta de plataforma, la corrida vuelve a darse por avisada',
    de: `      return { ok: false, motivo: "sin-destinatarios", enviados: 0, destinos: [] };`,
    a:  `      return { ok: true, motivo: "sin-destinatarios", enviados: 0, destinos: [] };` },
  { nombre: 'la fecha del último respaldo bueno deja de mirar si fue bueno',
    de: `  const buena = filas.find((f) => f && f.ok === true && f.ultimaEjecucion);`,
    a:  `  const buena = filas.find((f) => f && f.ultimaEjecucion);` },
  { nombre: 'y el historial se vuelve a leer DESPUÉS: la corrida se cuenta a sí misma',
    de: `  let historialPrevio = [];\n  try {\n    const salud = await admin.firestore().doc("global/health").get();`,
    a:  `  let historialPrevio = [];\n  if (false) try {\n    const salud = await admin.firestore().doc("global/health").get();` },
  { nombre: 'la corrida que revienta antes del export vuelve a no avisar',
    de: `    const aviso = await avisarRespaldoCaido(RESEND_API_KEY.value(), {\n      mensaje: \`La corrida reventó antes de terminar`,
    a:  `    const aviso = { ok: false, motivo: "no se intentó", destinos: [] } || await avisarRespaldoCaido(RESEND_API_KEY.value(), {\n      mensaje: \`La corrida reventó antes de terminar` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCH_FUNCS, 'utf8'),
    { archivo: ARCH_FUNCS, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCH_FUNCS, 'utf8'),
    archivo: ARCH_FUNCS, extension: '.js',
    comoCorrer: (ruta) => ({ args: [], env: { ARCH_FUNCS: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

const andamios = require('./montar-trabajo-de-funciones.cjs');
const { baseFalsa } = andamios;

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

// ── EL PADRÓN ───────────────────────────────────────────────────────────────
// La forma del de producción, medida el 2026-11-23: UNA cuenta `soporte`
// activa y sin organización, y directores que NO tienen que recibir esto.
const SOPORTE = 'soporte@cotea.com.mx';
const haceDias = (d) => new Date(Date.now() - d * 86400000).toISOString();

function padron({ conSoporte = true, soporteActivo = true } = {}) {
  const d = {};
  if (conSoporte) {
    d['usuarios/soporte_cotea_com_mx'] = {
      nombre: 'Soporte', email: SOPORTE, rol: 'soporte',
      activo: soporteActivo, orgId: null,
    };
  }
  d['usuarios/dg_fosmon_com_mx'] = {
    nombre: 'Daniel Director', email: 'dg@fosmon.com.mx',
    rol: 'director_general', activo: true, orgId: 'fosmon',
  };
  d['usuarios/dop_fosmon_com_mx'] = {
    nombre: 'Dora Operaciones', email: 'dop@fosmon.com.mx',
    rol: 'director_operaciones', activo: true, orgId: 'fosmon',
  };
  return d;
}

// Historial de salud previo: la última corrida buena fue hace 8 días, y hay
// una fallida más reciente. Si la lectura no mira `ok`, agarraría la fallida.
const historial = (dias = 8) => ({
  'global/health': {
    backup: { ok: false, ultimaEjecucion: haceDias(1), mensaje: 'anterior' },
    backup_historial: [
      { ok: false, ultimaEjecucion: haceDias(1), mensaje: 'falló la semana pasada' },
      { ok: true, ultimaEjecucion: haceDias(dias), mensaje: 'Completado' },
    ],
  },
});

// ── EL MUNDO DE FUERA ───────────────────────────────────────────────────────
// Un `fetch` que enruta por destino: Google contesta lo que el caso diga,
// Resend captura el correo. Así el trabajo corre con su `ejecutarBackup` y su
// `esperarFinDelExport` DE VERDAD, que es donde vive la diferencia entre
// «falló» y «no se pudo verificar».
function mundo({ export_ = 'ok', estado = 'SUCCESSFUL', rebota = false } = {}) {
  const correos = [];
  const fetchRuteado = async (url, opciones = {}) => {
    const u = String(url);
    if (u.includes('firestore.googleapis.com') && u.includes('exportDocuments')) {
      if (export_ === 'revienta') return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      return { ok: true, status: 200,
        json: async () => ({ name: 'projects/campo-fosmon/operations/op-1' }) };
    }
    if (u.includes('firestore.googleapis.com')) {   // consulta de la operación
      const done = estado !== 'EN_CURSO';
      return { ok: true, status: 200, json: async () => (done
        ? { done: true, metadata: { operationState: estado },
            ...(estado === 'SUCCESSFUL' ? {} : { error: { message: 'el export murió' } }) }
        : { done: false, metadata: { operationState: 'PROCESSING' } }) };
    }
    // Resend
    const sobre = { url: u, ...JSON.parse(opciones.body || '{}') };
    if (rebota) return { ok: false, status: 422, json: async () => ({ message: 'buzón inexistente' }) };
    correos.push(sobre);
    return { ok: true, status: 200, json: async () => ({ id: `re_${correos.length}` }) };
  };
  return { correos, fetchRuteado };
}

// ── EL RELOJ, COMPRIMIDO ────────────────────────────────────────────────────
//
// `esperarFinDelExport` espera de verdad: 28 pausas de 15 s hasta el plazo de
// 420 s. El caso «sigue en curso» —que es justo uno de los que hay que
// medir— colgaba este banco siete minutos.
//
// La salida NO es bajarle el plazo al código ni saltarse la espera: es
// sustituir el reloj y el temporizador, que son lo único que este banco no
// necesita que sean de verdad. La aritmética del plazo corre ENTERA —las 28
// vueltas, la comparación `ahora() - t0 + pausaMs >= plazoMs`, el conteo de
// intentos—, sólo que cada pausa adelanta el reloj en vez de esperarla. Si
// alguien le cambiara el plazo o la pausa al código, este banco lo vería.
//
// La base del reloj falso es el `Date.now()` de VERDAD, no una fecha tecleada:
// el correo dice «hace N días» restando contra este reloj, y la siembra del
// historial se escribe con el de la máquina. Dos relojes distintos darían un
// «hace 6 días» donde el caso sembró 8, y el banco mediría su propio desfase.
function relojComprimido() {
  let t = Date.now();
  class Reloj extends Date {
    constructor(...a) { if (a.length === 0) super(t); else super(...a); }
    static now() { return t; }
  }
  return {
    Reloj,
    temporizador: (fn, ms) => { t += Number(ms) || 0; fn(); return 0; },
  };
}

const correr = async (siembra, opciones = {}) => {
  const base = baseFalsa(siembra);
  const { correos, fetchRuteado } = mundo(opciones);
  const { Reloj, temporizador } = relojComprimido();
  const fn = andamios.montar(ARCH_FUNCS, 'backupSemanalFirestore', base, {
    inyecciones: { fetch: fetchRuteado, Date: Reloj, setTimeout: temporizador },
  });
  let lanzo = null;
  try { await fn({ scheduleTime: new Date().toISOString() }); } catch (e) { lanzo = e; }
  return { base, correos, lanzo };
};

const salud = (base) => (base.docs.get('global/health') || {}).backup || null;

(async () => {
  console.log('\n── EL RESPALDO QUE SE CAE Y LO DICE ──\n');

  // ═══ §1 · EL RESPALDO QUE SALE BIEN NO MANDA NADA ═════════════════════════
  console.log('§1 · el respaldo sale bien');
  {
    const r = await correr({ ...padron(), ...historial() }, { estado: 'SUCCESSFUL' });
    check(r.correos.length === 0,
      'no sale ningún correo: un aviso que llega cada domingo deja de leerse al tercero',
      `${r.correos.length} correo(s)`);
    const s = salud(r.base);
    check(!!s && s.ok === true && s.aviso === 'no hacía falta',
      'y el renglón queda en VERDE diciendo que no hacía falta avisar',
      s ? `ok=${s.ok} · aviso=${s.aviso}` : 'NO SE ESCRIBIÓ EL RENGLÓN');
  }

  // ═══ §2 · EL RESPALDO QUE FALLA SÍ AVISA, Y SÓLO A QUIEN TOCA ═════════════
  console.log('\n§2 · el export termina en FAILED');
  const caido = await correr({ ...padron(), ...historial(8) }, { estado: 'FAILED' });
  {
    check(caido.correos.length === 1,
      'sale UN correo',
      `${caido.correos.length}`);
    const to = (caido.correos[0]?.to) || [];
    check(to.length === 1 && to[0] === SOPORTE,
      'y va SÓLO a la cuenta de plataforma: el respaldo no es de ninguna organización',
      to.join(', ') || 'sin destinatarios');
    check(!to.some(x => /dg@|dop@/.test(x)),
      'ningún director de obra lo recibe: no puede hacer nada con esta noticia',
      to.join(', ') || '(vacío)');
    const s = salud(caido.base);
    check(!!s && s.ok === false && s.aviso === 'enviado',
      'el renglón queda en ROJO y dice que el aviso SÍ salió',
      s ? `ok=${s.ok} · aviso=${s.aviso}` : 'sin renglón');
    check(!!s && Array.isArray(s.avisadosA) && s.avisadosA[0] === SOPORTE,
      'y deja escrito a quién, que es lo que se mira cuando alguien dice «a mí no me llegó»',
      s ? JSON.stringify(s.avisadosA) : 'sin renglón');
  }

  // ═══ §3 · EL CORREO DICE CUÁNTO HACE DEL ÚLTIMO BUENO ═════════════════════
  console.log('\n§3 · lo que dice el correo');
  {
    const html = caido.correos[0]?.html || '';
    check(/hace 8 días/.test(html),
      'nombra el último respaldo BUENO y cuántos días hace: «falló» solo no mueve a nadie',
      (html.match(/hace \d+ días?/) || ['(no lo dice)'])[0]);
    check(!/hace 1 día/.test(html),
      'y no agarra la corrida FALLIDA de hace un día como si hubiera sido buena',
      /hace 1 día/.test(html) ? 'AGARRÓ LA FALLIDA' : 'miró el `ok`');
    check(/FALL/i.test(caido.correos[0]?.subject || ''),
      'el asunto dice que falló, que es lo único que se lee sin abrir',
      caido.correos[0]?.subject || 'sin asunto');
    check(/no se escribió/i.test(html),
      'y el cuerpo dice qué significa: esta semana no hay copia',
      /no se escribió/i.test(html) ? 'lo dice' : 'NO LO DICE');
  }

  // ═══ §4 · «NO SE PUDO VERIFICAR» TAMBIÉN AVISA, Y DISTINTO ════════════════
  console.log('\n§4 · el export sigue en curso cuando se agota la espera');
  {
    const r = await correr({ ...padron(), ...historial(8) }, { estado: 'EN_CURSO' });
    check(r.correos.length === 1,
      'también avisa: «no consta que haya copia» es lo mismo para quien reacciona',
      `${r.correos.length} correo(s)`);
    const html = r.correos[0]?.html || '';
    check(/puede que haya quedado completo/i.test(html),
      'pero el texto es OTRO: no afirma que falló, porque no se sabe',
      /puede que haya quedado completo/i.test(html) ? 'distingue' : 'DICE LO MISMO QUE EL FALLO');
    check(!/no se escribió/i.test(html),
      'y no dice «no se escribió», que sería afirmar lo que no se midió',
      /no se escribió/i.test(html) ? 'LO AFIRMA' : 'no lo afirma');
  }

  // ═══ §5 · SIN NADIE A QUIEN AVISAR, SE DICE ═══════════════════════════════
  console.log('\n§5 · no hay ninguna cuenta de plataforma activa');
  {
    const r = await correr({ ...padron({ soporteActivo: false }), ...historial() },
      { estado: 'FAILED' });
    check(r.correos.length === 0, 'no se manda nada, porque no hay a quién',
      `${r.correos.length}`);
    const s = salud(r.base);
    check(!!s && s.ok === false && /NO SE AVISÓ: sin-destinatarios/.test(s.aviso || ''),
      'y el renglón lo DICE: «falló» y «falló y nadie se enteró» no son la misma avería',
      s ? `aviso=${s.aviso}` : 'sin renglón');
  }
  {
    const r = await correr({ ...padron({ conSoporte: false }), ...historial() },
      { estado: 'FAILED' });
    const s = salud(r.base);
    check(r.correos.length === 0 && !!s && /NO SE AVISÓ/.test(s.aviso || ''),
      'igual si la cuenta no existe siquiera',
      s ? `aviso=${s.aviso}` : 'sin renglón');
  }

  // ═══ §6 · EL BUZÓN QUE REBOTA ════════════════════════════════════════════
  console.log('\n§6 · el buzón de soporte rebota');
  {
    const r = await correr({ ...padron(), ...historial() }, { estado: 'FAILED', rebota: true });
    const s = salud(r.base);
    check(!!s && s.ok === false && /NO SE AVISÓ/.test(s.aviso || ''),
      'el renglón dice que el aviso NO salió, con el motivo del servidor de correo',
      s ? `aviso=${s.aviso}` : 'sin renglón');
    check(!!s && s.destino && /firestore/.test(s.destino),
      'y la corrida se anota entera igual: el aviso caído no borra el diagnóstico del respaldo',
      s ? String(s.destino) : 'sin renglón');
  }

  // ═══ §7 · LA CORRIDA QUE REVIENTA ANTES DEL EXPORT ════════════════════════
  console.log('\n§7 · el export ni siquiera arranca');
  {
    const r = await correr({ ...padron(), ...historial(8) }, { export_: 'revienta' });
    check(r.correos.length === 1,
      'avisa igual, y aquí importa MÁS: no hubo ni intento de copia',
      `${r.correos.length} correo(s)`);
    check(/revent/i.test(r.correos[0]?.html || ''),
      'y el correo lleva el motivo del reventón, no un texto genérico',
      /revent/i.test(r.correos[0]?.html || '') ? 'con motivo' : 'SIN MOTIVO');
    check(r.lanzo !== null,
      'y la corrida sigue lanzando: Scheduler no puede dar por buena una corrida que reventó',
      r.lanzo ? 'lanzó' : 'SE LO TRAGÓ');
    const s = salud(r.base);
    check(!!s && s.ok === false && s.aviso === 'enviado',
      'con su renglón en rojo y el aviso anotado',
      s ? `ok=${s.ok} · aviso=${s.aviso}` : 'sin renglón');
  }

  // ═══ §8 · SIN HISTORIAL PREVIO NO SE INVENTA UNA FECHA ════════════════════
  console.log('\n§8 · nunca hubo un respaldo bueno');
  {
    const r = await correr({ ...padron(), 'global/health': {} }, { estado: 'FAILED' });
    const html = r.correos[0]?.html || '';
    check(/no hay ninguno registrado/.test(html),
      'se dice que no hay ninguno, en vez de teclear una fecha para llenar el renglón',
      /no hay ninguno registrado/.test(html) ? 'lo declara' : 'INVENTÓ ALGO');
    check(!/hace \d+ día/.test(html),
      'y no aparece ningún «hace N días» sacado de la nada',
      (html.match(/hace \d+ días?/) || ['(ninguno)'])[0]);
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'el respaldo que no consta empuja un correo en vez de esperar a que\n' +
      'alguien abra una pantalla. Y cuando no pudo empujarlo, lo dice: un\n' +
      'vigilante que calla su propio fallo deja tranquilo sin derecho.'
    : 'la copia de toda la base puede llevar semanas sin escribirse y el\n' +
      'primero en enterarse sería quien la necesite.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
