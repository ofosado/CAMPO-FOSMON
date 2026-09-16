# Prueba de aislamiento entre organizaciones — desde la consola del navegador

Usa este snippet **después** de desplegar `feature/organizaciones` a producción
para verificar en vivo que un usuario NO puede leer datos de otra organización.

## Preparación

1. Abre `https://campo-fosmon.netlify.app` en Chrome/Firefox.
2. Inicia sesión con una cuenta real (ej. `aoliva@fosmon.com.mx`).
3. Abre DevTools → Consola.
4. Copia y pega el snippet completo. La salida imprime resultados por línea.

Debe salir denegado (o "not-found") para toda ruta cross-org. Si alguna
sale `OK`, hay un agujero en las reglas que hay que investigar.

## Snippet

```javascript
(async () => {
  // Toma la app Firebase que ya está inicializada por CAMPO
  const { getFirestore, doc, getDoc, collection, getDocs } =
    await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
  const { getStorage, ref, getBytes } =
    await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js');

  const auth = firebase.auth();
  const user = auth.currentUser;
  if (!user) { console.error('NO ESTÁS LOGUEADO. Inicia sesión primero.'); return; }

  const tokenResult = await user.getIdTokenResult(true);
  const claims = tokenResult.claims;
  console.log('%c── Claims de tu token ──', 'color:#4A90E2;font-weight:bold');
  console.log('email :', user.email);
  console.log('rol   :', claims.rol);
  console.log('orgId :', claims.orgId);
  console.log('tipo  :', claims.tipo);
  console.log('todas :', claims.todas);
  console.log('obras :', claims.obras);

  const db = getFirestore();
  const storage = getStorage();

  // Cambia estos valores por IDs REALES de otra organización cuando exista.
  // Mientras solo esté FOSMON en prod, prueba con paths inventados de dependencia
  // (deben salir denegados igual — no existe org "muni_test" en prod).
  const ORG_AJENA = 'muni_test';        // org de otro tipo (dependencia)
  const OBRA_AJENA = '9999_ficticia';   // obra que no existe en tu org

  const casos = [
    // Cross-tipo constructora → dependencia (o al revés)
    ['read', `orgs/${ORG_AJENA}`,                                                      'org ajena'],
    ['read', `orgs/${ORG_AJENA}/obras/${OBRA_AJENA}`,                                  'obra de org ajena'],
    ['read', `orgs/${ORG_AJENA}/obras/${OBRA_AJENA}/evidencia/x`,                      'evidencia ajena'],
    ['read', `orgs/${ORG_AJENA}/obras/${OBRA_AJENA}/nomina/historial`,                 'nómina ajena'],
    ['read', `orgs/${ORG_AJENA}/obras/${OBRA_AJENA}/config/otros_gastos`,              'gastos ajenos'],
    ['read', `orgs/${ORG_AJENA}/comparativo/anual_2026`,                               'comparativo ajeno'],
    // Verificación positiva: sí puedes leer tu propia org
    ['read', `orgs/${claims.orgId}`,                                                   'tu propia org (debería PASSAR)'],
  ];

  console.log('%c\n── Pruebas Firestore ──', 'color:#4A90E2;font-weight:bold');
  for (const [op, path, descripcion] of casos) {
    try {
      const snap = await getDoc(doc(db, path));
      const esperado = descripcion.includes('propia');
      const emoji = esperado ? (snap.exists() ? '✓' : '⚠') : '⚠ AGUJERO';
      console.log(`${emoji} ${op.padEnd(6)} ${path.padEnd(60)} → ${snap.exists() ? 'EXISTS' : 'not-found'}  (${descripcion})`);
    } catch (e) {
      const codigo = (e.code || '').replace('firestore/', '');
      const esperado = !descripcion.includes('propia');
      const emoji = esperado ? '✓' : '⚠';
      console.log(`${emoji} ${op.padEnd(6)} ${path.padEnd(60)} → DENIED (${codigo})  (${descripcion})`);
    }
  }

  console.log('%c\n── Pruebas Storage ──', 'color:#4A90E2;font-weight:bold');
  const rutasStorage = [
    `orgs/${ORG_AJENA}/obras/${OBRA_AJENA}/evidencia/foto.jpg`,
    `obras/${OBRA_AJENA}/fotos/foto.jpg`,   // obra ficticia (aunque sea de tu tipo)
  ];
  for (const path of rutasStorage) {
    try {
      await getBytes(ref(storage, path));
      console.log(`⚠ AGUJERO  read ${path} → LEÍDO`);
    } catch (e) {
      const codigo = (e.code || '').replace('storage/', '');
      console.log(`✓ read ${path.padEnd(60)} → DENIED (${codigo})`);
    }
  }

  console.log('%c\n── Fin de la prueba ──', 'color:#4A90E2;font-weight:bold');
})();
```

## Cómo leer el resultado

- **✓ DENIED** en filas cross-org: correcto.
- **⚠ AGUJERO** en cualquier fila cross-org: hay un problema en las reglas.
  Reporta el path exacto para revisión.
- **✓ EXISTS** o **⚠ not-found** en "tu propia org": correcto (según si la
  org ya está creada en `orgs/{tuOrg}`).

## Prueba adicional: usuario auditor externo

Repite el snippet **iniciando sesión como uno de los auditores** (ej. una
cuenta `@hytorc.com.mx` o `@noleaks.com.mx`). Debería ver denegado para
todo lo que no sea su obra asignada. También revisa:

```javascript
// Debe FALLAR (no debería leer obras que no le asignaron)
await getDoc(doc(db, 'obras', 'OBRA_NO_ASIGNADA'));  // → DENIED
// Debe PASSAR (su propia obra asignada)
await getDoc(doc(db, 'obras', claims.obras[0]));      // → EXISTS
```
