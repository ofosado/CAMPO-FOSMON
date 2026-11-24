#!/usr/bin/env node
// EL ROJO DE LA SALUD SE VE SIN ABRIR LA PANTALLA DE SALUD
//
// ── DE DÓNDE SALE ───────────────────────────────────────────────────────────
// El #26. La pantalla de salud existe desde septiembre, con su semáforo y su
// vigilancia de denegaciones, y hace exactamente lo que promete. Lo que
// faltaba —lo dice el propio renglón— es «que alguien la abra». Un vigilante
// que hay que ir a consultar no vigila: le avisa a quien ya sospechaba.
//
// El respaldo podía llevar tres domingos caído con el botón de Configuración
// impecable.
//
// ── QUÉ AFIRMA ──────────────────────────────────────────────────────────────
// Nada de que un símbolo exista. Se extraen de `src/App.jsx` la cuenta
// compartida (`saludEnRojo`), el clasificador (`estadoDeJob`), la tabla de
// vigilantes y el predicado de permiso, y SE EJECUTAN contra documentos
// armados. Lo que se mide es el número que acabaría pintado en la insignia.
//
// Las tres conductas:
//
//   1. UNA cuenta por número. La pantalla dice «N requieren atención» y la
//      insignia dice N. Si cada una sumara por su cuenta podrían discrepar, y
//      el usuario no tendría forma de saber cuál creer.
//   2. «No se pudo leer» NO es cero. Una insignia apagada tiene que querer
//      decir «no hay rojos», nunca «no pude mirar».
//   3. El documento se le pide SÓLO a los roles a los que la regla se lo
//      permite. Pedirlo a los demás sería una lectura que siempre rebota, en
//      cada sesión.
//
// Uso:
//   node scripts/prueba-el-rojo-de-salud-se-ve-sin-abrirla.cjs
//   node scripts/prueba-el-rojo-de-salud-se-ve-sin-abrirla.cjs --contraprueba

'use strict';

require('./reloj.cjs');

const path = require('path');
const fs = require('fs');

const raiz = path.resolve(__dirname, '..');
const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones('src/App.jsx');

const ARCHIVO_APP = process.env.ARCHIVO_APP || path.join(raiz, 'src/App.jsx');
const CP = require('./contraprueba.cjs');

const MUTANTES = [
  { nombre: 'un documento ilegible vuelve a contar como cero rojos',
    de: `  if (!datos) return { medible: false, enRojo: 0, sinDatos: 0, filas: [] };`,
    a:  `  if (!datos) return { medible: true, enRojo: 0, sinDatos: 0, filas: [] };` },
  { nombre: 'el silencio de un vigilante deja de ser rojo: sólo cuenta el fallo',
    de: `    enRojo:   filas.filter(f => f.color === C.red).length,`,
    a:  `    enRojo:   filas.filter(f => f.e && f.e.ok === false).length,` },
  { nombre: 'la insignia vuelve a contar sólo las alertas y se olvida de la salud',
    de: `  const pendientes = (alertasNoLeidas || 0) + (saludRojos || 0);`,
    a:  `  const pendientes = (alertasNoLeidas || 0);` },
  { nombre: 'la pantalla vuelve a hacer su propia suma en vez de la compartida',
    de: `  const enRojo   = resumen.enRojo;`,
    a:  `  const enRojo   = 0;` },
  { nombre: 'el documento se le pide a roles a los que la regla se lo niega',
    de: `const ROLES_VEN_SALUD = ["director_general","director_operaciones","gerente_construccion","admin_sistema"];`,
    a:  `const ROLES_VEN_SALUD = ["director_general","director_operaciones","gerente_construccion","admin_sistema","residente","contratista"];` },
  { nombre: 'una lectura que falló vuelve a apagar la insignia como si no hubiera rojos',
    de: `  return r.medible ? r.enRojo : null;`,
    a:  `  return r.enRojo;` },
];

if (!process.env.SIN_CONTRAPRUEBA) {
  CP.exigirAnclajes(MUTANTES, fs.readFileSync(ARCHIVO_APP, 'utf8'),
    { archivo: ARCHIVO_APP, callado: !!process.env.CALLADO });
}

if (process.argv.includes('--contraprueba') && !process.env.SIN_CONTRAPRUEBA) {
  const s = CP.correr({ mutaciones: MUTANTES, src: fs.readFileSync(ARCHIVO_APP, 'utf8'),
    archivo: ARCHIVO_APP, extension: '.jsx' });
  process.exit(CP.veredicto(s, MUTANTES.length));
}

const { deArchivo } = require('./extraer-de-app.cjs');
const { pantallasDe } = require('./expresion-de-pantalla.cjs');

let fallas = 0;
const check = (ok, titulo, detalle = '') => {
  console.log(`${ok ? ' ok ' : 'FALLA'}  ${titulo}${detalle ? '  ·  ' + detalle : ''}`);
  if (!ok) fallas++;
};

const { saludEnRojo, rojosParaLaInsignia, JOBS_PROGRAMADOS, ROLES_VEN_SALUD } =
  deArchivo(ARCHIVO_APP, 'saludEnRojo', 'rojosParaLaInsignia',
    'JOBS_PROGRAMADOS', 'ROLES_VEN_SALUD');

const AHORA = Date.parse('2026-11-24T18:00:00Z');
const hace = (h) => new Date(AHORA - h * 3600000).toISOString();

// Un documento de salud con todos los vigilantes al día, al que luego se le
// estropea uno. La base se arma DESDE la tabla, no tecleando ocho renglones:
// si mañana nace un vigilante nuevo, este banco lo incluye solo.
const todoAlDia = () => Object.fromEntries(JOBS_PROGRAMADOS.map(j =>
  [j.id, { ok: true, mensaje: 'al día', ultimaEjecucion: hace(1) }]));

(async () => {
  console.log('\n── EL ROJO QUE SE VE SIN IR A BUSCARLO ──\n');

  // ═══ §1 · LA CUENTA ═══════════════════════════════════════════════════════
  console.log('§1 · qué cuenta como rojo');
  {
    const r = saludEnRojo(todoAlDia(), AHORA);
    check(r.medible === true && r.enRojo === 0,
      'con todos al día la insignia se apaga, y se apaga porque se midió',
      `medible=${r.medible} · enRojo=${r.enRojo}`);
    check(r.filas.length === JOBS_PROGRAMADOS.length,
      'y se miraron TODOS los vigilantes de la tabla, no un subconjunto',
      `${r.filas.length} de ${JOBS_PROGRAMADOS.length}`);
  }
  {
    const d = todoAlDia();
    d.backup = { ok: false, mensaje: 'el respaldo no se escribió', ultimaEjecucion: hace(1) };
    const r = saludEnRojo(d, AHORA);
    check(r.enRojo === 1,
      'un respaldo FALLIDO de hace una hora ya enciende la insignia',
      `enRojo=${r.enRojo}`);
  }
  {
    // El silencio es el otro rojo, y es el que se pierde si alguien cuenta
    // sólo `ok === false`: un cron muerto nunca escribe un `false`.
    const d = todoAlDia();
    const diario = JOBS_PROGRAMADOS.find(j => j.limiteHoras === 36);
    d[diario.id] = { ok: true, mensaje: 'todo bien', ultimaEjecucion: hace(40) };
    const r = saludEnRojo(d, AHORA);
    check(r.enRojo === 1,
      'un vigilante CALLADO día y medio también la enciende: un cron muerto nunca escribe un fallo',
      `${diario.id} · enRojo=${r.enRojo}`);
  }
  {
    const d = todoAlDia();
    d.backup = { ok: false, mensaje: 'falló', ultimaEjecucion: hace(1) };
    d.gp_sync = { ok: true, mensaje: 'bien', ultimaEjecucion: hace(40) };
    const r = saludEnRojo(d, AHORA);
    check(r.enRojo === 2, 'y los dos tipos de rojo se suman en el mismo número',
      `enRojo=${r.enRojo}`);
  }

  // ═══ §2 · «NO PUDE MIRAR» NO ES CERO ══════════════════════════════════════
  console.log('\n§2 · el documento que no se pudo leer');
  {
    const r = saludEnRojo(null, AHORA);
    check(r.medible === false,
      'se declara NO MEDIBLE en vez de devolver un cero tranquilizador',
      `medible=${r.medible}`);
    check(r.enRojo === 0 && r.filas.length === 0,
      'y no inventa filas ni rojos de un documento que no leyó',
      `enRojo=${r.enRojo} · filas=${r.filas.length}`);
  }
  {
    // Un documento vacío SÍ es legible, y entonces todos los vigilantes están
    // «sin datos» — que no es rojo, pero tampoco verde.
    const r = saludEnRojo({}, AHORA);
    check(r.medible === true && r.sinDatos === JOBS_PROGRAMADOS.length,
      'un documento VACÍO es otra cosa: se leyó, y todos salen «sin datos»',
      `sinDatos=${r.sinDatos} de ${JOBS_PROGRAMADOS.length}`);
  }

  // ═══ §2bis · LO QUE LA CABECERA LE PASA A LA INSIGNIA ═════════════════════
  //
  // Es la decisión que el `useEffect` toma por sus dos caminos —el bueno y el
  // `catch`—, y vive con nombre justamente para poder ejecutarla: un banco no
  // puede correr un efecto de React, y una insignia apagada por error se ve
  // idéntica a una apagada con razón.
  console.log('\n§2bis · lo que se publica cuando no se pudo leer');
  {
    const d = todoAlDia();
    d.backup = { ok: false, mensaje: 'falló', ultimaEjecucion: hace(1) };
    check(rojosParaLaInsignia(d, AHORA) === 1,
      'con el documento leído se publica el número de rojos',
      String(rojosParaLaInsignia(d, AHORA)));
    check(rojosParaLaInsignia(todoAlDia(), AHORA) === 0,
      'y un cero de verdad se publica como cero',
      String(rojosParaLaInsignia(todoAlDia(), AHORA)));
    const sinLeer = rojosParaLaInsignia(null, AHORA);
    check(sinLeer === null,
      'pero una lectura que no se pudo hacer publica NULL, no 0: no es lo mismo',
      sinLeer === null ? 'null' : `publicó ${sinLeer}`);
  }

  // ═══ §2ter · LA PANTALLA USA LA MISMA SUMA ════════════════════════════════
  //
  // La cuenta que la pantalla imprime se EXTRAE de su cuerpo y se ejecuta con
  // un resumen armado. Si alguien la devolviera a una suma propia, aquí se ve.
  console.log('\n§2ter · el número que imprime la pantalla');
  {
    const { corre: correPantalla } = pantallasDe(ARCHIVO_APP,
      [{ dueño: 'PantallaSalud', nombre: 'enRojo' }],
      { queFalta: () => 'no encontré la cuenta `enRojo` dentro de `PantallaSalud`: ' +
        'es el «N requieren atención» que la pantalla imprime' });
    const imprime = (n) => correPantalla('PantallaSalud', 'enRojo',
      { resumen: { medible: true, enRojo: n, sinDatos: 0, filas: [] } });
    check(imprime(3) === 3 && imprime(0) === 0,
      'la pantalla imprime la cuenta COMPARTIDA, no una suya: si discreparan, nadie sabría cuál creer',
      `${imprime(3)} / ${imprime(0)}`);
  }

  // ═══ §3 · LA INSIGNIA SUMA LAS DOS COSAS DEL MENÚ ═════════════════════════
  //
  // La expresión se EXTRAE del archivo y se ejecuta: no se copia aquí, que
  // sería comprobar el banco contra sí mismo.
  console.log('\n§3 · el número que acaba pintado en el botón');
  const { corre } = pantallasDe(ARCHIVO_APP,
    [{ dueño: 'MenuConfiguracion', nombre: 'pendientes' }],
    { queFalta: () => 'no encontré la cuenta `pendientes` dentro de `MenuConfiguracion`: ' +
      'es la que decide el número de la insignia' });
  const pendientes = (alertasNoLeidas, saludRojos) =>
    corre('MenuConfiguracion', 'pendientes', { alertasNoLeidas, saludRojos });
  {
    check(pendientes(0, 2) === 2, 'dos rojos de salud y ninguna alerta → 2', String(pendientes(0, 2)));
    check(pendientes(3, 0) === 3, 'tres alertas y ningún rojo → 3', String(pendientes(3, 0)));
    check(pendientes(3, 2) === 5, 'las dos cosas se suman: el botón dice cuánto hay que mirar',
      String(pendientes(3, 2)));
    check(pendientes(0, null) === 0 && pendientes(2, null) === 2,
      'y un `null` —no se pudo medir la salud— no revienta la suma ni inventa un rojo',
      `${pendientes(0, null)} / ${pendientes(2, null)}`);
  }

  // ═══ §4 · A QUIÉN SE LE PIDE EL DOCUMENTO ═════════════════════════════════
  console.log('\n§4 · el permiso de lectura');
  {
    const puede = (rol) => ROLES_VEN_SALUD.includes(rol);
    check(puede('director_general') && puede('director_operaciones') &&
          puede('gerente_construccion') && puede('admin_sistema'),
      'los cuatro roles que la regla deja leer `global/health` lo piden',
      ROLES_VEN_SALUD.join(', '));
    const negados = ['residente','contratista','auditor','superintendente',
      'administrador_obra','supervisor_obra','soporte','director_obras','cliente'];
    const colados = negados.filter(puede);
    check(colados.length === 0,
      'y a nadie más: pedirlo sería una lectura que rebota en CADA sesión',
      colados.length ? `se colaron: ${colados.join(', ')}` : 'ninguno se cuela');
  }
  {
    // Los DOS sitios que deciden sobre la salud —el menú, que enseña la
    // entrada, y la cabecera, que pide el documento— tienen que preguntarle a
    // la MISMA constante. El menú la tenía tecleada literal; si la cabecera
    // hubiera tecleado la suya, el día que una cambiara habría un rol viendo
    // la entrada del menú con una lectura que le rebota, o pidiendo en cada
    // sesión un documento que no puede leer.
    //
    // Se cuentan los usos de la CONSTANTE, no la secuencia de roles: hay otra
    // lista con los mismos cuatro nombres (`ROLES_CONFIG_C`, «ve el menú de
    // Configuración») y es otra cosa, que hoy coincide y mañana puede no.
    const src = fs.readFileSync(ARCHIVO_APP, 'utf8');
    const usos = (src.match(/ROLES_VEN_SALUD\.includes\(/g) || []).length;
    check(usos === 2,
      'los dos sitios que deciden sobre la salud preguntan a la misma constante',
      `${usos} uso(s) · se esperan 2: la entrada del menú y la lectura de la cabecera`);
    const literalEnElMenu = /\{ id: "salud"[\s\S]{0,180}?visible: \[/.test(src);
    check(!literalEnElMenu,
      'y la entrada del menú no vuelve a llevar la lista tecleada dentro',
      literalEnElMenu ? 'LA LLEVA TECLEADA' : 'usa la constante');
  }

  console.log(`\n${fallas === 0 ? 'VERDE' : `ROJO · ${fallas} en rojo`} — ${fallas === 0
    ? 'el rojo de la salud llega al botón sin que nadie abra la pantalla, y\n' +
      'sale de la misma suma que la pantalla enseña. Una insignia apagada\n' +
      'quiere decir «no hay rojos», nunca «no pude mirar».'
    : 'una pantalla que hay que ir a consultar sólo le avisa a quien ya\n' +
      'sospechaba.'}\n`);
  process.exit(fallas === 0 ? 0 : 1);
})().catch(e => {
  console.error('\nNO ARRANCÓ:', e && e.stack ? e.stack : e);
  process.exit(2);
});
