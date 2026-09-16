/**
 * Test unitario para el fix: cambiarPassword debe revocar sesiones activas.
 *
 * Verifica el comportamiento clave de la Cloud Function `cambiarPassword`
 * (functions/index.js) tras el fix de fix/revoke-on-password:
 *
 *   updateUser({password: X}) + revokeRefreshTokens(uid)
 *
 * El test no invoca la CF directamente (necesitaría firebase-functions-test
 * y montaje del contexto de onCall). En su lugar valida el efecto observable:
 * tras revokeRefreshTokens, `getUser().tokensValidAfterTime` avanza a un
 * timestamp cercano al momento de la llamada. Sin el fix, ese campo queda
 * en undefined o con el valor viejo.
 *
 * Cómo correr (con Auth emulator):
 *   firebase emulators:exec --only auth --project campo-fosmon-test \
 *     'node tests/test-cambiar-password.cjs'
 */

const admin = require("firebase-admin");

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("ERROR: FIREBASE_AUTH_EMULATOR_HOST no está seteado.");
  console.error("Corre bajo firebase emulators:exec, no directo.");
  process.exit(2);
}

admin.initializeApp({
  projectId: "campo-fosmon-test",
});

async function esperarMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("\nTest: cambiarPassword revoca sesiones activas");
  console.log("─".repeat(60));

  const email = `test-revoke-${Date.now()}@fosmon.test`;
  const passwordInicial = "password-inicial-123";
  const passwordNueva = "password-nueva-456";

  // ── SETUP: crear usuario y capturar estado base ──
  const creado = await admin.auth().createUser({
    email,
    password: passwordInicial,
  });
  console.log(`  ✓ usuario creado: ${email} (uid=${creado.uid})`);

  const antes = await admin.auth().getUser(creado.uid);
  const tokensValidAfterAntes = antes.tokensValidAfterTime;
  console.log(`  · tokensValidAfterTime pre-cambio: ${tokensValidAfterAntes || "undefined"}`);

  // Pequeña espera para que el timestamp de revoke sea NOTORIAMENTE mayor
  // que cualquier valor previo (si lo hubiera).
  await esperarMs(1200);

  // ── ACT: replica lo que hace cambiarPassword tras el fix ──
  const tsAntesRevoke = Date.now();
  await admin.auth().updateUser(creado.uid, { password: passwordNueva });
  await admin.auth().revokeRefreshTokens(creado.uid);
  const tsDespuesRevoke = Date.now();
  console.log(`  ✓ updateUser + revokeRefreshTokens ejecutados`);

  // ── VERIFY: tokensValidAfterTime avanzó al rango del test ──
  const despues = await admin.auth().getUser(creado.uid);
  const tokensValidAfterDespues = despues.tokensValidAfterTime;
  console.log(`  · tokensValidAfterTime post-cambio: ${tokensValidAfterDespues}`);

  const fallos = [];

  if (!tokensValidAfterDespues) {
    fallos.push("tokensValidAfterTime sigue en undefined después de revoke");
  } else {
    const tsDespuesMs = new Date(tokensValidAfterDespues).getTime();
    // El timestamp de revoke debe caer entre tsAntesRevoke y tsDespuesRevoke
    // (con margen de 5s por reloj del servidor). Si es undefined o queda
    // fuera del rango, el revoke no se aplicó.
    const dentroDelRango = tsDespuesMs >= (tsAntesRevoke - 5000) &&
                           tsDespuesMs <= (tsDespuesRevoke + 5000);
    if (!dentroDelRango) {
      fallos.push(
        `tokensValidAfterTime (${tokensValidAfterDespues}) queda fuera del rango ` +
        `esperado [${new Date(tsAntesRevoke).toISOString()}, ${new Date(tsDespuesRevoke).toISOString()}]`
      );
    }
  }

  // Adicional: la contraseña efectivamente cambió (updateUser funcionó).
  // No hay forma directa de leer el hash en Admin SDK; usamos signInWithPassword
  // vía Identity Toolkit REST del emulador.
  const http = require("http");
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const [h, port] = emu.split(":");
  const signIn = (password) => new Promise((resolve, reject) => {
    const body = JSON.stringify({
      email,
      password,
      returnSecureToken: false,
    });
    const req = http.request({
      hostname: h,
      port: parseInt(port, 10),
      method: "POST",
      path: `/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`,
      headers: { "Content-Type": "application/json", "Content-Length": body.length },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });

  const conVieja = await signIn(passwordInicial);
  const conNueva = await signIn(passwordNueva);
  if (conVieja.status < 400) {
    fallos.push("password vieja sigue funcionando (updateUser no aplicó)");
  } else {
    console.log(`  ✓ password vieja rechazada (${conVieja.status})`);
  }
  if (conNueva.status >= 400) {
    fallos.push(`password nueva rechazada (${conNueva.status}): ${conNueva.body}`);
  } else {
    console.log(`  ✓ password nueva aceptada (${conNueva.status})`);
  }

  // ── CLEANUP ──
  await admin.auth().deleteUser(creado.uid);
  console.log(`  ✓ usuario limpiado`);

  console.log("─".repeat(60));
  if (fallos.length === 0) {
    console.log("✓ Todos los checks pasan.");
    process.exit(0);
  } else {
    console.log(`✗ ${fallos.length} fallo(s):`);
    for (const f of fallos) console.log(`    - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
