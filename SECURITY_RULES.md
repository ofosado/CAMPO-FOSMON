# CAMPO — Reglas de seguridad por rol

**Rama:** `claude/rules-seguridad` · **Estado:** listo para revisar, **NO desplegado**.

> ⚠️ **Nota sobre el rol `supervisor`.** En CAMPO FOSMON, `supervisor` es un
> **auditor interno de solo lectura**: entra a las obras que se le asignan
> para revisar avance/gastos/nómina sin capturar nada.
> **NO es lo mismo** que el rol `supervisor_obra` que aparecerá en la
> edición municipal del sistema, que será **externo** y sí captura en campo
> (verifica in situ el trabajo de contratistas). Pendiente de renombrar
> este rol a algo tipo `auditor` en la etapa de organizaciones/multi-tenant
> para evitar la colisión de nombres.

Este documento traduce a lenguaje humano lo que las nuevas reglas
`firestore.rules` y `storage.rules` permiten y bloquean para cada uno de
los 9 roles. Revísalo contra la operación real y avísame de cualquier
mismatch antes de desplegar.

## Cambios respecto a hoy

**Hoy** (rama `main`):
- Firestore: `allow read, write: if request.auth != null` — cualquier autenticado hace todo.
- Storage: `allow read, write: if request.auth != null` bajo `/obras/**`.

**Ahora** (rama `claude/rules-seguridad`):
- Reglas por rol y por documento, respetando `PERMISOS[rol][modulo]` del frontend.
- Denegar por defecto. Cualquier ruta no declarada explícitamente cae en `deny`.
- Requiere custom claims en el token de Auth. La Cloud Function
  `sincronizarClaims` los asigna al escribir `usuarios/{docId}`. El script
  `scripts/backfill-claims.js` los asigna a los usuarios existentes una sola vez.

## Custom claims en el token

Cada usuario tiene en su JWT:

```json
{
  "rol":      "residente",
  "todas":    false,
  "obras":    ["0126","0127"],
  "inactivo": false
}
```

- `rol`: uno de los 9 roles definidos.
- `todas`: `true` para directivos (`director_general`, `director_operaciones`, `gerente_construccion`, `admin_sistema`) → ven todas las obras.
- `obras`: lista de IDs de obras asignadas (solo cuando `todas=false`).
- `inactivo`: si el perfil se marca activo:false, se pone `true` y las reglas rechazan cualquier acceso.

---

## Matriz por rol y módulo

### `director_general`
- **Ve todas las obras** (`todas=true`).
- **Firestore permite:**
  - Leer y escribir `obras/{id}` y sus subcolecciones (avance, nómina, estimaciones, subcontratos, contrato, config, bitácora).
  - Crear/archivar obras.
  - Leer y escribir `usuarios/*`.
  - Leer y escribir `global/historial_obras`.
  - Leer `global/gp_construct` y `global/gp_detalle/*` (write bloqueado, solo Cloud Function).
  - Leer `auditoria/*` (crear también, pero no editar ni borrar entradas).
  - Notificaciones propias.
  - Panel de salud `health/*` (read only).
- **Firestore bloquea:**
  - Escribir en `global/gp_construct` o `global/gp_detalle/*` (solo Cloud Function con Admin SDK).
  - Editar o borrar entradas de `auditoria/*` (append-only).
  - Leer notificaciones ajenas.
- **Storage permite:** todo bajo `/obras/**` (fotos, docs, subcontratos, nomina).
- **Storage bloquea:** cualquier ruta fuera de `/obras/**`.

### `director_operaciones`
Idéntico a `director_general`.

### `gerente_construccion`
- **Ve todas las obras** (`todas=true`).
- **Firestore permite:** todo lo que ve director_general, con **una excepción**:
  - **NO** puede leer/escribir `usuarios/*` (solo puede leer su propio doc).
- **Firestore bloquea:** además de las restricciones de directivo, la gestión de usuarios.
- **Storage:** idéntico a director_general.

### `admin_sistema`
- Ve todas las obras.
- Igual que `director_general` — sí gestiona usuarios.
- Además: acceso de lectura a `health/*` (panel de salud interno).

### `superintendente`
- Ve **solo las obras que le fueron asignadas** (`obras[]`).
- **Firestore permite en obras asignadas:**
  - Leer y editar `obras/{id}` (todas las subcolecciones):
    avance, nómina, estimaciones, subcontratos, contrato, config, bitácora.
  - Leer `global/gp_construct` (para vista Gastos).
  - Crear entradas en `auditoria/*` y `notificaciones/*`.
  - Leer notificaciones propias.
- **Firestore bloquea:**
  - Ver obras que no le fueron asignadas.
  - Crear/archivar obras.
  - Ver o gestionar usuarios.
  - Leer `global/historial_obras` (obras archivadas).
  - Leer/editar entradas de auditoría.
  - Editar `global/*` (todo lo global es lectura o Cloud Function).
- **Storage permite:** todo bajo `/obras/{obra-asignada}/**`.
- **Storage bloquea:** obras no asignadas y cualquier ruta fuera de `/obras/**`.

### `residente`
Idéntico a `superintendente`.

### `administrador_obra`
Idéntico a `superintendente` y `residente` — mismos permisos de captura, misma limitación por obra asignada.

### `supervisor`
- Ve **solo las obras que le fueron asignadas** — **solo lectura**.
- **Firestore permite en obras asignadas:**
  - Leer todo lo interno de la obra: avance, nómina, estimaciones, subcontratos, contrato, config, otros_gastos, bitácora.
  - Leer `global/gp_construct`.
  - Notificaciones propias.
- **Firestore bloquea:**
  - Cualquier escritura sobre datos de obras.
  - Ver obras no asignadas.
  - Gestión de usuarios.
- **Storage permite:** lectura de fotos, docs, nomina y subcontratos de obras asignadas.
- **Storage bloquea:** cualquier escritura, y todo lo fuera de sus obras.

### `cliente`
- Ve **solo las obras que le fueron asignadas** — subconjunto muy reducido.
- **Firestore permite en obras asignadas:**
  - Leer `obras/{id}` (nombre, cliente, presupuesto, fechas).
  - Leer `obras/{id}/config/info` (datos básicos).
  - Leer `obras/{id}/config/catalogo` (para vista Avance físico).
  - Leer `obras/{id}/config/estimaciones` (vista Estimaciones — cliente).
  - Leer `obras/{id}/avance/subs` (% avance por partida).
  - Leer `obras/{id}/contrato/plazos` (vista Plazos — cliente).
  - Leer `global/gp_construct` (solo si algo del cliente lo requiere; se puede endurecer si molesta).
  - Notificaciones propias.
- **Firestore bloquea:**
  - `obras/{id}/nomina/historial` — nómina.
  - `obras/{id}/config/otros_gastos` — gastos internos.
  - `obras/{id}/avance/maquinaria`, `avance/materiales`, `avance/historial` — datos internos.
  - `obras/{id}/subcontratos/lista` — proveedores.
  - `obras/{id}/contrato/documentos` — contratos internos.
  - Bitácora.
  - Auditoría, usuarios, historial de obras.
  - Cualquier escritura.
- **Storage permite:** solo `/obras/{obra-asignada}/fotos/**`.
- **Storage bloquea:** `/obras/{obra}/docs/**`, `/nomina/**`, `/subcontratos/**` — todo lo que no sean fotos.

### Anónimo (sin auth)
- **Bloquea todo.** No puede leer ni escribir nada.

### Usuario con `inactivo=true`
- **Bloquea todo**, aunque tenga rol asignado. Las reglas verifican `inactivo != true`.

---

## Colecciones globales

| Colección | Read | Write |
|---|---|---|
| `usuarios/{docId}` | Propio doc + admin_sistema/directivos con acceso a gestión | Solo `crearUsuario/actualizarUsuario` (admin SDK, bypasa) + admin_sistema |
| `global/gp_construct` | Cualquier autenticado con rol válido | **Bloqueado** (solo Cloud Function con Admin SDK) |
| `global/gp_detalle/obras/{id}` | Cualquier autenticado con rol válido | **Bloqueado** (solo Cloud Function) |
| `global/historial_obras` | Solo directivos | Solo directivos |
| `notificaciones/{uid}/items/{id}` | Solo el `uid` dueño | Solo el `uid` dueño (crear entre usuarios permitido: la app crea notifs cross-user al cambiar estatus) |
| `auditoria/{id}` | Solo directivos | Cualquier autenticado puede **crear** (append) · edit/delete **bloqueado** |
| `health/{path=**}` | Solo `admin_sistema`/directivos | Solo Cloud Function |

---

## Path por path — quién puede qué

Referencia rápida por documento típico de una obra:

| Path | DG/DO/GC/Admin | Sup/Res/Admin_obra (asignada) | Supervisor (asignada) | Cliente (asignada) |
|---|:-:|:-:|:-:|:-:|
| `obras/{id}` | R/W | R/W | R | R |
| `obras/{id}/config/info` | R/W | R/W | R | R |
| `obras/{id}/config/parametros` | R/W | R/W | R | R |
| `obras/{id}/config/estimaciones` | R/W | R/W | R | R |
| `obras/{id}/config/catalogo` | R/W | R/W | R | R |
| `obras/{id}/config/otros_gastos` | R/W | R/W | R | — |
| `obras/{id}/config/permisos` | R/W | R (no edita) | R | — |
| `obras/{id}/avance/subs` | R/W | R/W | R | R |
| `obras/{id}/avance/maquinaria` | R/W | R/W | R | — |
| `obras/{id}/avance/materiales` | R/W | R/W | R | — |
| `obras/{id}/avance/historial` | R/W | R/W | R | — |
| `obras/{id}/nomina/historial` | R/W | R/W | R | — |
| `obras/{id}/contrato/plazos` | R/W | R/W | R | R |
| `obras/{id}/contrato/documentos` | R/W | R/W | R | — |
| `obras/{id}/subcontratos/lista` | R/W | R/W | R | — |
| `obras/{id}/bitacora/{id}` | R/W/C/D | R/C | R | — |

- **R** = lectura · **W** = escritura · **C** = crear (append) · **D** = delete
- `—` = denegado

---

## Storage

| Path | DG/DO/GC/Admin | Sup/Res/Admin_obra (asignada) | Supervisor (asignada) | Cliente (asignada) |
|---|:-:|:-:|:-:|:-:|
| `obras/{id}/fotos/**` | R/W | R/W | R | R |
| `obras/{id}/docs/**` | R/W | R/W | R | — |
| `obras/{id}/documentos/**` | R/W | R/W | R | — |
| `obras/{id}/nomina/**` | R/W | R/W | R | — |
| `obras/{id}/subcontratos/**` | R/W | R/W | R | — |
| `obras/{id}/(otros)/**` | R/W | R/W | R | — |
| Cualquier otro path (fuera de `/obras/`) | ❌ | ❌ | ❌ | ❌ |

---

## Decisiones tomadas (2026-09-14)

Estas ya están reflejadas en las reglas de esta rama:

1. **Supervisor SÍ lee nómina, GP Construct y bitácora.** Sigue siendo solo lectura. Todas las escrituras están denegadas.
2. **Cliente NO lee `global/gp_construct` ni `global/gp_detalle/**` ni `/bitacora`.** Solo ve: nombre y datos generales de la obra, `config/estimaciones`, `config/catalogo`, `avance/subs`, `contrato/plazos`. Todas las escrituras denegadas.
3. **Notificaciones cross-user (create)**: la app hoy crea notificaciones para otros usuarios (ej. al cambiar estatus de estimación se le avisa al director). Las reglas permiten `create` para cualquier autenticado. Intencional.

Ver `AUDITORIA_CONSULTAS.md` para el análisis de qué consultas del frontend quedan denegadas con estas reglas y qué requiere ajuste de código en `src/App.jsx` antes de desplegar.

---

## Cómo desplegar (cuando decidas)

1. **Backup ya está hecho** en `gs://campo-fosmon-backups/firestore/2026-09-11-preseguridad/`.

2. **Desplegar Cloud Function `sincronizarClaims` primero:**
   ```
   cd functions
   firebase deploy --only functions:sincronizarClaims,functions:backfillClaims
   ```

3. **Correr backfill para asignar claims a usuarios existentes:**
   Opción A (recomendada, callable desde consola de Firebase):
     - Firebase Console → Functions → `backfillClaims` → probar
     - O invocar la Callable desde la app con un usuario admin
   Opción B (script standalone):
     ```
     GOOGLE_APPLICATION_CREDENTIALS=~/campo-sa.json node scripts/backfill-claims.js
     ```

4. **Verificar que los usuarios reales tienen claims:**
   ```
   firebase auth:export /tmp/users.json --format=JSON
   grep -c '"customClaims"' /tmp/users.json    # debe ser >= 1
   ```

5. **Desplegar reglas:**
   ```
   firebase deploy --only firestore:rules,storage
   ```

6. **Todos los usuarios activos DEBEN cerrar sesión y volver a entrar** para
   que su token JWT recoja los nuevos claims. Firebase Auth también refresca
   tokens automáticamente cada ~1 hora, pero un logout/login forzado evita
   errores de permisos entre esa hora.

## Cómo probar las reglas localmente

Requiere Java (openjdk) y firebase-tools instalados globalmente.

```
cd tests && npm install               # una vez
cd ..
firebase emulators:exec --only firestore,auth,storage \
  --project campo-fosmon-test \
  'cd tests && node run-tests.js'
```

El runner corre 60+ casos por rol y termina con exit 0 si todo pasa.

## Rollback

Si algo se rompe en producción tras desplegar:

1. Redesplegar reglas anteriores desde `main`:
   ```
   git checkout main -- firestore.rules storage.rules
   firebase deploy --only firestore:rules,storage
   ```
2. Los custom claims quedarán activos pero las reglas volverían a `allow ... if request.auth != null` — no bloquea nada.
3. Restaurar Firestore desde backup si hubiera pérdida de datos:
   ```
   gcloud firestore import gs://campo-fosmon-backups/firestore/2026-09-11-preseguridad
   ```
