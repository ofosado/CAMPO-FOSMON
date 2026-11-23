#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// CAMBIAR EL CORREO DE UN USUARIO SIN DEJARLO FUERA — PENDIENTES #146
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ HABÍA. Nada: no existía ningún flujo de cambio de correo, ni en la app
// ni en las funciones. Y hacerlo «a mano» rompe la cuenta con un síntoma que
// NO apunta al correo: el login no busca el perfil por cuenta, lo DERIVA del
// correo tecleado (`emailAId`), así que mover el correo sólo en Auth deja el
// perfil bajo el id viejo, la app contesta «Tu cuenta no tiene perfil en el
// sistema» y cierra la sesión — con los claims intactos y la cuenta
// perfectamente válida.
//
// ── LO QUE SE AFIRMA, Y POR QUÉ CADA COSA ─────────────────────────────────
//
// 1. EL ORDEN DE LOS TRES ACTOS. Perfil nuevo → Auth → borrar el viejo. No es
//    estética: es la única propiedad que no se puede negociar aquí, que es que
//    en NINGÚN punto intermedio el usuario quede fuera. Se afirma rompiendo el
//    trabajo a la mitad y comprobando que todavía puede entrar.
//
// 2. EL PERFIL SE COPIA ENTERO. Campo por campo se perdería en silencio lo que
//    se le agregue mañana al perfil —obras asignadas, banderas, lo que sea—.
//
// 3. EL BORRADO NO LE QUITA LOS CLAIMS. `sincronizarClaims` reacciona al
//    borrado buscando la cuenta por `before.email` y limpiándole los claims.
//    Por eso el perfil viejo se VACÍA de correo antes de borrarse: con
//    `before.email` vacío el sincronizador se va por su salida temprana. Sin
//    ese vaciado funcionaría igual hoy —Auth ya se movió, la búsqueda no
//    encuentra— y dejaría de funcionar el día que alguien recicle el correo.
//
// 4. LAS NEGATIVAS. No se cambia el propio (la sesión en curso quedaría
//    apuntando a un perfil que ya no existe), no se pisa un correo ocupado —ni
//    en el padrón ni en Auth—, y no se cruza la frontera de organización.
//
// CONTRAPRUEBAS — corridas el 2026-11-23, las seis en ROJO (1), ninguna en
// NO ARRANCÓ (2).
//
// Uso:  node scripts/prueba-el-correo-se-puede-cambiar.cjs
//       node scripts/prueba-el-correo-se-puede-cambiar.cjs --contraprueba

'use strict';

const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
const { baseFalsa, montar } = require('./montar-trabajo-de-funciones.cjs');

const ARCHIVO = process.env.ARCH_FUNCS || path.join(raiz, 'functions/index.js');

let fallas = 0, verdes = 0;
const ok = (c, m, d = '') => {
  if (c) { verdes++; console.log(`  ok   ${m}${d ? '  ·  ' + d : ''}`); }
  else { fallas++; console.log(`FALLA  ${m}${d ? '  ·  ' + d : ''}`); }
};

const ID = (correo) => `usuarios/${correo.toLowerCase().replace(/@/g,'_').replace(/\./g,'_')}`;

const ADMIN = 'jefa@fosmon.com.mx';
const VIEJO = 'orlando@cotea.com.mx';
const NUEVO = 'orlando@coatzacoalcos.gob.mx';
const AJENO = 'otro@otraorg.mx';

// El perfil lleva campos que NADIE nombra en la función, a propósito: si la
// copia fuera campo por campo, éstos se perderían sin un solo error.
const PERFIL = {
  email: VIEJO, nombre: 'Orlando Fosado', rol: 'director_obras',
  orgId: 'coatzacoalcos', activo: true, uid: 'uid-orlando',
  obras_asignadas: ['OP-2026-001', 'OP-2026-002'],
  telefono: '921-000-0000', notasInternas: 'capturó el anexo DE-5',
};

const docsBase = () => ({
  [ID(ADMIN)]: { email: ADMIN, nombre: 'Jefa', rol: 'director_general',
                 orgId: 'coatzacoalcos', activo: true, uid: 'uid-jefa' },
  [ID(VIEJO)]: { ...PERFIL },
  'orgs/coatzacoalcos': { nombre: 'H. Ayuntamiento', tipo: 'dependencia', activa: true },
});
const cuentasBase = () => ({ [ADMIN]: 'uid-jefa', [VIEJO]: 'uid-orlando' });

const pedir = (data, quien = ADMIN) => ({ auth: { token: { email: quien } }, data });

const correr = async (opciones = {}) => {
  const base = baseFalsa(docsBase(), { cuentasIniciales: cuentasBase(), ...opciones });
  const fn = montar(ARCHIVO, 'cambiarCorreoDeUsuario', base);
  return { base, fn };
};
const intentar = async (fn, req) => {
  try { return { ok: await fn(req) }; }
  catch (e) { return { err: e?.code || e?.message || String(e), msg: e?.message || '' }; }
};

(async () => {

// ══════════════════════════════════════════════════════════════════════════
console.log('1. El caso bueno: el perfil se muda entero y la cuenta lo sigue');

{
  const { base, fn } = await correr();
  const r = await intentar(fn, pedir({ email: VIEJO, emailNuevo: NUEVO }));
  ok(!r.err, 'el cambio se completa', r.err || `de ${r.ok?.de} a ${r.ok?.a}`);
  ok(base.docs.has(ID(NUEVO)), 'el perfil existe bajo el correo nuevo');
  ok(!base.docs.has(ID(VIEJO)), 'y ya no bajo el viejo');
  ok(base.cuentas.get(NUEVO) === 'uid-orlando' && !base.cuentas.has(VIEJO),
    'Auth quedó en el correo nuevo, con la MISMA cuenta',
    `uid ${base.cuentas.get(NUEVO)}`);

  // EL PERFIL ENTERO. Se comparan los campos que la función no nombra: son
  // los que una copia campo por campo habría perdido en silencio.
  const nuevo = base.docs.get(ID(NUEVO));
  const perdidos = Object.keys(PERFIL).filter(k =>
    k !== 'email' && JSON.stringify(nuevo[k]) !== JSON.stringify(PERFIL[k]));
  ok(perdidos.length === 0,
    'el perfil se copió entero, incluidos los campos que la función no nombra',
    perdidos.length ? `se perdieron: ${perdidos.join(', ')}` : 'ninguno perdido');
  ok(nuevo.email === NUEVO, 'con el correo corregido', nuevo.email);
  ok(nuevo.correoAnterior === VIEJO && nuevo.correoCambiadoPor === ADMIN,
    'y queda anotado de dónde venía y quién lo movió',
    `${nuevo.correoAnterior} · ${nuevo.correoCambiadoPor}`);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n2. El orden de los tres actos, que es lo que no se negocia');

{
  const { base, fn } = await correr();
  await fn(pedir({ email: VIEJO, emailNuevo: NUEVO }));
  const rutas = base.escrituras.map(e => `${e.ruta}${e.borrado ? ' (borrado)' : ''}`);
  const iNuevo = rutas.findIndex(r => r === ID(NUEVO));
  const iBorra = rutas.findIndex(r => r === `${ID(VIEJO)} (borrado)`);
  const iAuth = 0;  // los actos de Auth van en su propio registro
  ok(iNuevo >= 0 && iBorra >= 0 && iNuevo < iBorra,
    'el perfil nuevo se escribe ANTES de borrar el viejo',
    rutas.join(' → '));
  ok(base.actosAuth.some(a => a.email === NUEVO),
    'y Auth se mueve en medio, no al final', JSON.stringify(base.actosAuth));
  void iAuth;

  // EL VACIADO DEL CORREO ANTES DE BORRAR. Sin él, el sincronizador de claims
  // busca la cuenta por `before.email` y se los limpia.
  const vaciado = base.escrituras.find(e => e.ruta === ID(VIEJO) && e.d && e.d.email === '');
  ok(!!vaciado,
    'el perfil viejo se vacía de correo antes de borrarse, para que el '
    + 'sincronizador de claims no vaya a buscar a nadie');
  const iVacia = base.escrituras.indexOf(vaciado);
  ok(iVacia >= 0 && iVacia < base.escrituras.findIndex(e => e.borrado),
    'y el vaciado va antes del borrado, no después');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n3. Roto a la mitad, el usuario NO se queda fuera');

{
  // Revienta al mover Auth: el perfil nuevo ya está, el viejo todavía no se
  // borró. La cuenta entra con el correo VIEJO, como antes de empezar.
  const base = baseFalsa(docsBase(), { cuentasIniciales: cuentasBase() });
  const fn = montar(ARCHIVO, 'cambiarCorreoDeUsuario', base);
  base.admin.auth = () => ({
    getUserByEmail: async (c) => {
      const uid = base.cuentas.get(c);
      if (!uid) { const e = new Error('user-not-found'); e.code = 'auth/user-not-found'; throw e; }
      return { uid, email: c };
    },
    updateUser: async () => { throw new Error('Auth se cayó a media mudanza'); },
  });
  const fn2 = montar(ARCHIVO, 'cambiarCorreoDeUsuario', base);
  const r = await intentar(fn2, pedir({ email: VIEJO, emailNuevo: NUEVO }));
  ok(!!r.err, 'el cambio falla, que es lo que tiene que pasar', r.err);
  ok(base.docs.has(ID(VIEJO)),
    'el perfil VIEJO sigue ahí: la cuenta entra igual que antes');
  ok(base.cuentas.get(VIEJO) === 'uid-orlando',
    'y Auth sigue en el correo viejo', String(base.cuentas.get(VIEJO)));
  void fn;
}

{
  // Revienta al borrar el viejo: Auth ya se movió y el perfil nuevo existe.
  // La cuenta entra con el correo NUEVO. Lo que sobra es un huérfano.
  const { base, fn } = await correr({
    fallaEscritura: (ruta) => ruta === ID(VIEJO) ? 'no se pudo tocar el viejo' : null,
  });
  const r = await intentar(fn, pedir({ email: VIEJO, emailNuevo: NUEVO }));
  ok(!!r.err, 'el cambio falla al limpiar', r.err);
  ok(base.docs.has(ID(NUEVO)) && base.cuentas.get(NUEVO) === 'uid-orlando',
    'pero el perfil nuevo y Auth ya están: la cuenta entra con el correo nuevo');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n4. Las negativas');

{
  const { fn } = await correr();
  const r = await intentar(fn, pedir({ email: ADMIN, emailNuevo: NUEVO }));
  ok(r.err === 'failed-precondition',
    'nadie se cambia el suyo: la sesión en curso quedaría sin perfil', r.err);
  ok(/otro administrador/i.test(r.msg),
    'y el mensaje dice qué hacer en su lugar', r.msg.slice(0, 60));
}
{
  const { fn } = await correr();
  const r = await intentar(fn, pedir({ email: VIEJO, emailNuevo: ADMIN }));
  ok(r.err === 'already-exists',
    'no se pisa el correo de otro usuario del padrón', r.err);
}
{
  // Ocupado en Auth y libre en el padrón: pasa si sólo se mirara Firestore.
  const base = baseFalsa(docsBase(),
    { cuentasIniciales: { ...cuentasBase(), [NUEVO]: 'uid-de-alguien-mas' } });
  const fn = montar(ARCHIVO, 'cambiarCorreoDeUsuario', base);
  const r = await intentar(fn, pedir({ email: VIEJO, emailNuevo: NUEVO }));
  ok(r.err === 'already-exists',
    'ni el que está tomado SÓLO en Auth: el padrón no lo habría visto', r.err);
  ok(base.docs.has(ID(VIEJO)) && !base.docs.has(ID(NUEVO)),
    'y no deja nada a medias al negarse');
}
{
  const { fn } = await correr();
  for (const malo of ['sin-arroba', 'a@b', 'a@b.c', '']) {
    const r = await intentar(fn, pedir({ email: VIEJO, emailNuevo: malo }));
    ok(r.err === 'invalid-argument',
      `«${malo || '(vacío)'}» se rechaza: un correo mal formado es un id de `
      + 'documento igual de válido, y el perfil quedaría enterrado', r.err);
  }
}
{
  const { fn } = await correr();
  const r = await intentar(fn, pedir({ email: VIEJO, emailNuevo: VIEJO }));
  ok(r.err === 'invalid-argument', 'y cambiarlo por el mismo no es un cambio', r.err);
}
{
  // La frontera de organización: el admin de una no mueve a los de otra.
  const docs = { ...docsBase(), [ID(AJENO)]: { email: AJENO, nombre: 'Ajeno',
    rol: 'administrador_obra', orgId: 'otra-org', activo: true, uid: 'uid-ajeno' } };
  const base = baseFalsa(docs, { cuentasIniciales: { ...cuentasBase(), [AJENO]: 'uid-ajeno' } });
  const fn = montar(ARCHIVO, 'cambiarCorreoDeUsuario', base);
  const r = await intentar(fn, pedir({ email: AJENO, emailNuevo: NUEVO }));
  ok(!!r.err, 'un admin no mueve el correo de otra organización', r.err);
  ok(base.docs.has(ID(AJENO)), 'y el perfil ajeno queda intacto');
}

console.log(`\n${verdes} en verde · ${fallas} en rojo`);
if (fallas) process.exit(1);

// ══════════════════════════════════════════════════════════════════════════
if (process.argv.includes('--contraprueba')) {
  console.log('\n── contraprueba ─────────────────────────────────────────────');
  const CP = require('./contraprueba.cjs');
  const src = fs.readFileSync(ARCHIVO, 'utf8');
  const MUTANTES = [
    { titulo: 'se borra el perfil viejo ANTES de escribir el nuevo',
      cambios: [["  await refNuevo.set({\n    ...perfil,", "  await refViejo.delete();\n  await refNuevo.set({\n    ...perfil,", 1]] },
    { titulo: 'el perfil se copia campo por campo y pierde lo que nadie nombró',
      cambios: [["    ...perfil,\n    email: nuevo,",
                 "    nombre: perfil.nombre, rol: perfil.rol, orgId: perfil.orgId,\n"
                 + "    activo: perfil.activo, uid: perfil.uid,\n    email: nuevo,", 1]] },
    { titulo: 'el perfil viejo se borra sin vaciarle el correo y pierde los claims',
      cambios: [['  await refViejo.set({ email: "" }, { merge: true });\n', '', 1]] },
    { titulo: 'el destino se comprueba sólo en el padrón, no en Auth',
      cambios: [["  const yaEnAuth = await admin.auth().getUserByEmail(nuevo).catch(() => null);",
                 "  const yaEnAuth = null;", 1]] },
    { titulo: 'uno puede cambiarse su propio correo',
      cambios: [["  if (viejo === emailLlamador) {", "  if (false) {", 1]] },
    { titulo: 'un correo sin forma de correo se acepta',
      cambios: [["  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(nuevo)) {", "  if (false) {", 1]] },
  ];
  CP.exigirAnclajes(MUTANTES, src, { archivo: ARCHIVO });
  const s = CP.correr({ mutaciones: MUTANTES, src, archivo: ARCHIVO,
    prefijo: 'correo-cambia-', extension: '.js',
    comoCorrer: (ruta) => ({ args: [], env: { ARCH_FUNCS: ruta, CALLADO: '1' } }) });
  process.exit(CP.veredicto(s, MUTANTES.length));
}
})();
