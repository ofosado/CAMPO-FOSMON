#!/usr/bin/env node
// ¿El veredicto de la suite depende de en qué país está abierta la laptop?
//
// Esta es la prueba de la REGLA, no de una pantalla. Lo que vigila es que un
// banco cualquiera dé el mismo resultado se corra desde donde se corra, y por
// las dos vías que existen: el corredor (`npm test`) y a mano
// (`node scripts/prueba-loquesea.cjs`), que es como se trabaja mientras se
// arregla algo.
//
// Historia, porque el defecto se escapó DOS veces:
//
//   2026-10-10  Con la laptop en Europe/Madrid la suite dio 52 verdes y un
//               rojo. `2026-08-03T01:00:00Z` es domingo 2 a las 19:00 en
//               México y lunes 3 a las 03:00 en Madrid: semana 31 allá, 32
//               acá. Se fijó `TZ` en el corredor.
//
//   2026-10-11  El mismo banco seguía dando ROJO corrido a mano, porque a mano
//               no se pasa por el corredor. Verde por `npm test`, rojo por
//               `node scripts/…`, el mismo código. Se movió el fijado a
//               `reloj.cjs`, que carga el preámbulo que los 55 bancos ya
//               requieren.
//
// Las dos veces el arreglo se dio por bueno sin nada que lo vigilara. Esto es
// lo que faltaba: si alguien quita el `require('./reloj.cjs')` de
// `no-arranco.cjs`, o lo mete después de la primera fecha, esta prueba se pone
// roja el mismo día y no el día que alguien viaje.
//
// Cómo afirma, y por qué así: no mira el texto de ningún archivo. Lanza un
// banco de verdad en husos distintos y compara VEREDICTOS. Un banco que
// afirmara "`reloj.cjs` contiene la cadena America/Mexico_City" se comprobaría
// contra sí mismo (P3) y seguiría verde el día que el fijado deje de surtir
// efecto por cargarse tarde.
//
// Uso:  node scripts/prueba-reloj-de-la-suite.cjs

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const noArranco = require('./no-arranco.cjs');
noArranco.vigilarExcepciones();

const raiz = path.resolve(__dirname, '..');

// El canario: un banco que SÍ depende del huso. Tiene que serlo, o esta prueba
// no mide nada. Se eligió `series-sincronizadas` porque es el único que tiene
// una marca de tiempo con hora —los demás usan la forma de diez letras y hoy
// no se enterarían— y es justo el que falló las dos veces.
const CANARIO = 'prueba-series-sincronizadas.cjs';
const RUTA_CANARIO = path.join(__dirname, CANARIO);

// Un huso que parte el día al revés que el nuestro. Cualquiera al este de
// Greenwich sirve; Madrid es el que estaba puesto el día del incidente.
const HUSO_AJENO = 'Europe/Madrid';

if (!fs.existsSync(RUTA_CANARIO)) {
  noArranco.sinPrecondicion(
    `el banco canario \`${CANARIO}\`, que es el que hace observable el defecto`,
    ['Si se renombró, apuntar CANARIO al nombre nuevo.',
     'Si se borró, elegir otro banco que dependa del huso — tiene que haber uno,',
     'o esta prueba no puede afirmar nada.']);
}

const fallos = [];
const check = (cond, m) => {
  if (cond) console.log(`   ✓ ${m}`);
  else { fallos.push(m); console.log(`   ✗ ${m}`); }
};

// Corre el canario con el entorno que se le diga. `FORZAR_TZ` es la puerta que
// `reloj.cjs` deja abierta para poder desarmar el fijado desde fuera; sin ella
// no habría forma de comprobar que el fijado sirve, porque cualquier intento
// de correr en otro huso quedaría pisado por el fijado mismo.
const correrCanario = ({ tz, forzar }) => {
  const env = { ...process.env, TZ: tz };
  if (forzar) env.FORZAR_TZ = '1'; else delete env.FORZAR_TZ;
  const r = spawnSync(process.execPath, [RUTA_CANARIO],
    { encoding: 'utf8', cwd: raiz, env });
  return r.status;
};

// ── 1. ¿El canario sigue sirviendo de canario? ─────────────────────────────
//
// Primero de todo, y es lo que más fácil se olvida: si el canario dejó de
// depender del huso, "verde en Madrid" no prueba nada —sería verde en Madrid
// por la misma razón que lo sería un banco que sume dos y dos—. Con el fijado
// desarmado tiene que ponerse ROJO en el huso ajeno y VERDE en el nuestro. Si
// no, no se puede mirar: NO ARRANCÓ, no rojo.
console.log('\n1. El canario — ¿sigue siendo sensible al huso?');

const desarmadoAjeno = correrCanario({ tz: HUSO_AJENO, forzar: true });
const desarmadoCasa  = correrCanario({ tz: 'America/Mexico_City', forzar: true });

if (desarmadoAjeno !== 1 || desarmadoCasa !== 0) {
  noArranco.sinPrecondicion(
    `\`${CANARIO}\` ya no distingue husos ` +
    `(con el fijado desarmado: ${HUSO_AJENO} → ${desarmadoAjeno}, ` +
    `America/Mexico_City → ${desarmadoCasa}; se esperaba 1 y 0)`,
    ['Puede ser bueno: quizá la cuenta dejó de resolver por día local.',
     'Pero entonces este banco no puede comprobar que el fijado surta efecto,',
     'y hay que buscar otro canario o retirar esta prueba con su motivo.']);
}

check(desarmadoAjeno === 1, `sin fijado, el canario cae en ${HUSO_AJENO}`);
check(desarmadoCasa === 0, 'sin fijado, el canario pasa en America/Mexico_City');

// ── 2. El fijado, por la vía de a mano ─────────────────────────────────────
//
// La vía que se escapó el 2026-10-11. Mismo banco, mismo código, husos
// distintos: un solo veredicto.
console.log('\n2. A mano — ¿mismo veredicto desde cualquier país?');

for (const tz of [HUSO_AJENO, 'Asia/Tokyo', 'America/Mexico_City', 'UTC']) {
  check(correrCanario({ tz, forzar: false }) === 0,
    `el canario pasa con la máquina en ${tz}`);
}

// ── 3. El cableado, ejecutado ──────────────────────────────────────────────
//
// Que cargar el preámbulo baste para quedar en hora de México. No se afirma
// que `no-arranco.cjs` contenga tal renglón: se carga y se le pregunta al
// motor en qué huso quedó. Si el `require` se mueve a después de la primera
// fecha, o desaparece, esto lo ve.
console.log('\n3. El preámbulo — ¿basta con cargarlo?');

const huso = spawnSync(process.execPath,
  ['-e', `require('./scripts/no-arranco.cjs');` +
         `console.log(Intl.DateTimeFormat().resolvedOptions().timeZone);`],
  { encoding: 'utf8', cwd: raiz,
    env: { ...(() => { const e = { ...process.env, TZ: HUSO_AJENO }; delete e.FORZAR_TZ; return e; })() } });

check((huso.stdout || '').trim() === 'America/Mexico_City',
  `requerir no-arranco deja el proceso en hora de México (quedó en ` +
  `"${(huso.stdout || '').trim() || '—'}")`);

// Y que la puerta de escape siga existiendo: sin ella, la sección 1 de esta
// misma prueba se vuelve imposible de escribir y nadie podría volver a
// comprobar el fijado desde fuera.
const husoForzado = spawnSync(process.execPath,
  ['-e', `require('./scripts/no-arranco.cjs');` +
         `console.log(Intl.DateTimeFormat().resolvedOptions().timeZone);`],
  { encoding: 'utf8', cwd: raiz,
    env: { ...process.env, TZ: HUSO_AJENO, FORZAR_TZ: '1' } });

check((husoForzado.stdout || '').trim() === HUSO_AJENO,
  'FORZAR_TZ sigue permitiendo desarmar el fijado para poder medirlo');

// ── Veredicto ──────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────────────────');
if (fallos.length === 0) {
  console.log('Todo en verde: el veredicto de la suite no depende del país.');
  process.exit(0);
}
console.log(`${fallos.length} FALLA(S):`);
for (const f of fallos) console.log(`  · ${f}`);
process.exit(1);
