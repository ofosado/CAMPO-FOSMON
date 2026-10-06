# CAMPO — Reglas de seguridad por rol

**Estado: DESPLEGADO EN PRODUCCIÓN desde el 2026-09-15.**

| | |
|---|---|
| En `main` desde | `697bdfe` "modelo multi-tenant", **2026-09-15** |
| Ruleset vivo | `projects/campo-fosmon/rulesets/d29ec434-df74-4542-96c9-9a47f9aa46ce` |
| Publicado | **2026-09-24 19:32 UTC** — trae las ocho rutas de captura de dependencia |
| Contra el repo | **YA NO es idéntico.** Lo fue —byte a byte, 24 271 bytes, verificado el 2026-09-24 bajando el ruleset y haciendo `diff`— y lo sigue siendo contra `main`. Pero `firestore.rules` en la rama de trabajo tiene **25 119 bytes**: le sobran las dos rutas de `avance/notas`. Ver «Lo que está en el archivo y NO en producción» abajo |
| Comprobado vivo | **34/34** con la API `projects:test` sobre el ruleset bajado del servidor — cero datos tocados. Un caso de control con expectativa falsa lo deja en 34/35, así que la comprobación no es vacía |
| Desplegado desde | la rama `fix/modelo-dependencia-captura`, **antes de mezclar a `main`**. Mientras no se mezcle, `main` NO describe lo que corre en producción |
| `orgs/fosmon` | existe desde el **2026-09-16 05:28**, `tipo: constructora`, `activa: true` |
| Usuarios etiquetados | **14 de 14** con `orgId: "fosmon"` |

Ruleset anterior, por si hay que volver:
`1de0cdf3-eec1-44d7-aa85-583b8f4c42b3` (19 588 bytes, 2026-09-23 06:54 UTC).
Es el mismo archivo **sin** las ocho rutas: volver a él deja al supervisor
capturando contra el `match /{document=**}` final — sin guardar nada y sin
avisar.

> **Este renglón decía «NO desplegado» hasta el 2026-09-23 y llevaba ocho días
> caduco.** Hizo que dos análisis independientes concluyeran que las reglas
> seguían en `allow read, write: if request.auth != null`, que
> `crear-org-fosmon.cjs` no se había corrido nunca y que el aislamiento era
> "solo por convención de UI" — las tres cosas falsas desde el 2026-09-15.
> Si vuelves a tocar el estado de despliegue, **actualiza esta tabla en el
> mismo commit**. Un documento maestro que miente es peor que no tenerlo:
> se le cree.

## Lo que está en el archivo y NO en producción

Esta sección existe porque la de arriba sólo sabía mentir en un sentido:
decía «no desplegado» de algo que sí lo estaba. El sentido contrario es
igual de caro — dar por vivo lo que sólo está escrito — y es exactamente
el PENDIENTES #31: una ruta sin regla, un helper que se traga el fallo, y
una funcionalidad que lleva meses en el menú sin guardar nada.

| Ruta | En `firestore.rules` | En el ruleset vivo | Desde |
|---|:-:|:-:|---|
| `obras/{id}/avance/notas` | **sí** | **NO** | rama `feature/seguimiento-semanal`, 2026-10-05 |
| `orgs/{oid}/obras/{id}/avance/notas` | **sí** | **NO** | rama `feature/seguimiento-semanal`, 2026-10-05 |

**Qué pasa hoy si alguien intenta escribir una nota.** La escritura cae en
el `match /{document=**}` final y Firestore la deniega. La diferencia con
el #31 es que esta vez **se nota**: `guardarNotaSemanal` no usa `fsSet` —usa
`setDoc` en un `try/catch` y devuelve `false`— y la pantalla no cierra el
editor cuando ese `false` llega; deja el texto puesto y dice que no quedó.
Las dos mitades están comprobadas contra el emulador cargado con el ruleset
de `main`:

- `scripts/prueba-nota-no-calla.cjs` — el helper avisa (con un caso de
  control que escribe `avance/historial` para que el rojo no pueda ser del
  token).
- `scripts/prueba-nota-semanal.cjs`, sección 7 — la pantalla no ignora el
  aviso.

Así que la funcionalidad **no funciona** hasta que se desplieguen las
reglas, pero no miente mientras tanto. **Al desplegar: borrar esta sección
y arreglar el renglón «Contra el repo» en el mismo commit.**

## Modelo multi-tenant (2026-09, desplegado)

CAMPO introduce el concepto de **organización** (`orgs/{orgId}`) con
`tipo ∈ {"constructora","dependencia"}`, **inmutable después de create**.

- FOSMON = organización `fosmon`, tipo `constructora`.
- Dependencia (municipio/gobierno) tendrá su propia org, tipo `dependencia`.
- Cada rol pertenece a **UN** tipo de org. Excepción: `soporte` es
  cross-tipo (crea orgs y usuarios pero NO lee operación).
- Reglas hacen cumplir el aislamiento por tipo desde YA, aunque las
  colecciones de dependencia todavía no existan como datos.

### Roles por tipo

**Constructora (9 roles):**

| Rol | Etiqueta UI | Nota |
|---|---|---|
| `director_general` | Director General | ejecutivo, todas las obras |
| `director_operaciones` | Director de Operaciones | ejecutivo, todas las obras |
| `gerente_construccion` | Gerente de Construcción | ejecutivo, todas las obras |
| `superintendente` | Superintendente de Obra | editor de obras asignadas |
| `residente` | Residente de Obra | editor de obras asignadas |
| `administrador_obra` | Administrador de Obra | editor de obras asignadas |
| `auditor` | **Auditor Interno** *(antes "supervisor")* | solo lectura obras asignadas |
| `admin_sistema` | Administrador de Sistema | ejecutivo, todas las obras |
| `cliente` | Cliente | externo, ve avance/fotos/estimaciones |

**Dependencia (7 roles, declarados, UI pendiente):**

| Rol | Notas |
|---|---|
| `director_obras` | máxima autoridad; ve comparativo |
| `subdirector` | segunda línea; ve comparativo |
| `jefe_supervision` | responsable del cuerpo de supervisión; **captura avance en cualquier obra de la org** |
| `supervisor_obra` | supervisor municipal; **captura avance** en obras asignadas |
| `administrativo` | back-office; escribe convenios y estimaciones |
| `contralor` | fiscalización, lectura amplia sin edición, **NO ve comparativo** |
| `contratista` | equivalente a `cliente`; solo su obra, sin datos de otros |

**Cross-tipo (1 rol):**

| Rol | Notas |
|---|---|
| `soporte` | crea orgs y usuarios; **NO** lee avances, montos, evidencia ni comparativos; todo acceso registrado en `/auditoria` |

### CORRECCIÓN DE MODELO — en una dependencia el supervisor SÍ captura (2026-09-23)

> **Lo que decía este documento era falso.** El modelo escrito —«la
> constructora ejecuta y captura, la dependencia supervisa»— describía a la
> dependencia como un lector. No lo es.

**En una dependencia, el supervisor de obra captura el avance.** Es quien va
a la obra, verifica físicamente y reporta; diario o semanal según lo exija la
dirección de Obras Públicas. No recibe un número del contratista para
validarlo: **lo levanta él**. Esa es la razón de existir del puesto, y es
también lo que hace que el informe del artículo 73 tenga valor probatorio.

Consecuencia directa: la obra de dependencia **necesita las rutas de captura
de avance**, que hoy no tiene. Las cinco subcolecciones declaradas
(`contratistas`, `supervisores`, `programa`, `convenios`, `evidencia`) modelan
la supervisión documental, pero **ninguna recibe la captura**. Con las reglas
vivas, escribir `orgs/{oid}/obras/{id}/avance/subs` cae en el
`match /{document=**}` final, que deniega — y como las escrituras pasan por
helpers que se tragan el fallo, **la captura parecería funcionar sin guardar
nada**. Es literalmente el defecto de PENDIENTES #31, que tardó tres años en
salir a la luz.

**Lo que el contratista NO hace todavía.** Cuando exista, capturará sus
propias obras. Hoy `puedeEditarObraD` no lo incluye, y así se queda: en las
reglas de abajo el `contratista` sólo lee, y queda fuera de `avance/historial`
y de `bitacora` igual que el `cliente` en el lado constructora. Habilitarlo
después es una línea; habilitarlo antes de tiempo es regalar escritura.

#### Las siete rutas que hay que agregar

Se replican **sólo** las de avance, con los permisos de dependencia:

```
    match /orgs/{oid}/obras/{obraId} {
      // … las cinco que ya existen …

      // ── Captura de avance (corrección de modelo, 2026-09-23) ──────────
      match /config/info {
        allow read:  if oid == orgId() && puedeVerObraD(obraId);
        allow write: if oid == orgId() && puedeEditarObraD(obraId);
      }
      match /config/parametros {
        allow read:  if oid == orgId() && puedeVerObraD(obraId);
        allow write: if oid == orgId() && puedeEditarObraD(obraId);
      }
      match /config/catalogo {
        allow read:  if oid == orgId() && puedeVerObraD(obraId);
        allow write: if oid == orgId() && puedeEditarObraD(obraId);
      }
      match /config/estimaciones {
        allow read:  if oid == orgId() && puedeVerObraD(obraId);
        allow write: if oid == orgId() && puedeEditarObraD(obraId);
      }
      match /config/permisos {
        allow read:  if oid == orgId() && puedeVerObraD(obraId);
        allow write: if oid == orgId() && esDirectivoDEditor();
      }

      // Donde escribe el supervisor cuando captura.
      match /avance/subs {
        allow read:  if oid == orgId() && puedeVerObraD(obraId);
        allow write: if oid == orgId() && puedeEditarObraD(obraId);
      }
      // Cortes semanales. De aquí sale el informe del artículo 73.
      // El contratista no los ve, igual que el `cliente` en constructora.
      match /avance/historial {
        allow read:  if oid == orgId() && puedeVerObraD(obraId) && !esContratista();
        allow write: if oid == orgId() && puedeEditarObraD(obraId);
      }
      // Incidencias. Append-only para quien captura; sólo directivo corrige.
      match /bitacora/{id} {
        allow read:   if oid == orgId() && puedeVerObraD(obraId) && !esContratista();
        allow create: if oid == orgId() && puedeEditarObraD(obraId);
        allow update, delete: if oid == orgId() && esDirectivoDEditor();
      }
    }
```

Ese bloque es el registro de lo que se desplegó el 2026-09-23 y se deja tal
cual. La octava ruta de avance, `avance/notas`, **no** forma parte de él:
está en `firestore.rules` y no en el ruleset vivo. Vive documentada arriba,
en «Lo que está en el archivo y NO en producción».

#### Las cinco que NO se replican, y por qué

Esto **no es un olvido, es la frontera**:

| Ruta de constructora | Por qué no existe en dependencia |
|---|---|
| `nomina/historial` y `nomina_historial/{semanaId}` | Los sueldos de los trabajadores del contratista. Una dependencia no tiene por qué verlos |
| `subcontratos/lista` | Lleva proveedor y monto de cada subcontrato |
| `avance/maquinaria` y `avance/materiales` | La maquinaria y el almacén son del contratista |
| `config/otros_gastos` | Los gastos del contratista |

Entre esas cinco está el margen. **Son la razón por la que el PDF ejecutivo de
FOSMON no se le puede entregar a un director de Obras Públicas** — no por el
logo, sino porque enseña «Margen bruto», gasto por rubro y top de proveedores,
y su propio pie dice "Documento confidencial". Dejarlas fuera de las reglas
convierte esa frontera en estructura, en vez de en algo que hay que acordarse
de respetar.

#### Una ruta más, para la marca

El paquete de marca de cotea lee el logo del cliente de
`orgs/{orgId}/config/branding` en tiempo de ejecución. Esa ruta tampoco está
declarada y hoy cae en el deny final:

```
    match /orgs/{oid}/config/branding {
      allow read:  if oid == orgId();
      allow write: if ((esAdminSistemaC() || esAdminSistemaD()) && oid == orgId())
                      || esSoporte();
    }
```

### Migración — YA EJECUTADA

Las dos corrieron. No volver a correrlas "por si acaso": son idempotentes,
pero el registro de que ya pasaron vive aquí.

- Rol `supervisor` → `auditor` en usuarios existentes (3 usuarios externos:
  2 `@hytorc.com.mx`, 1 `@noleaks.com.mx`, auditando una obra que FOSMON
  ejecuta en conjunto con esas empresas). Script:
  `scripts/migrar-supervisor-a-auditor.cjs`.
- Creación de `orgs/fosmon` y etiquetado de todos los usuarios con
  `orgId="fosmon"`. Script: `scripts/crear-org-fosmon.cjs`. Corrió el
  **2026-09-16 05:28**; verificado el 2026-09-23: 14 de 14 usuarios
  etiquetados. **No mueve datos de obras** — las obras de FOSMON siguen
  viviendo en `/obras/*`, que es donde las reglas vivas las esperan.
  **FOSMON no tiene que migrar** para que exista una segunda organización.

---

## Referencia (documento anterior, roles constructora)

Este documento traduce a lenguaje humano lo que las reglas
`firestore.rules` y `storage.rules` permiten y bloquean. Revísalo contra
la operación real y avísame de cualquier mismatch antes de desplegar.

## Qué cambió al desplegar (2026-09-15)

**Antes:**
- Firestore: `allow read, write: if request.auth != null` — cualquier autenticado hacía todo.
- Storage: `allow read, write: if request.auth != null` bajo `/obras/**`.

**Desde el 2026-09-15, en producción:**
- Reglas por rol y por documento, respetando `PERMISOS[rol][modulo]` del frontend.
- Denegar por defecto. Cualquier ruta no declarada explícitamente cae en `deny`.
  Esto **no es teórico**: una ruta que falta no da error visible, se traga la
  escritura en silencio. Ya pasó dos veces (PENDIENTES #28 y #31).
- Requiere custom claims en el token de Auth. La Cloud Function
  `sincronizarClaims` los asigna al escribir `usuarios/{docId}`. El script
  `scripts/backfill-claims.cjs` los asignó a los usuarios existentes, una sola vez.

## Refresh proactivo del token (fix/refresh-token, 2026-09-16)

Cuando la Cloud Function `sincronizarClaims` detecta que los claims
resultantes cambiaron respecto a los que Auth ya tiene, hace dos cosas:

1. `setCustomUserClaims` en Auth (claims viejos → claims nuevos).
2. Incrementa `usuarios/{docId}.claimsVersion` y setea `_claimsSyncedAt`.

El cliente escucha `usuarios/{emailId}` con `onSnapshot`. Al detectar que
`claimsVersion` aumentó respecto a la versión que ya vio, llama
`getIdToken(true)` para forzar refresh del JWT desde Auth. El usuario ve
un toast persistente "Tus permisos se actualizaron" con la línea concreta
del cambio (rol nuevo, obras agregadas o quitadas). Sin este mecanismo,
los cambios tardaban hasta 1 hora en propagarse (auto-refresh de Firebase).

**Anti-bucle**: la propia CF, al escribir `claimsVersion` + `_claimsSyncedAt`,
dispara su propio trigger `onDocumentWritten`. La CF detecta que los
únicos campos que cambiaron son esos marcadores internos y retorna sin
hacer nada. Guardarraíl obligatorio para no bucear.

**Refresh al arranque de sesión**: adicionalmente a lo anterior, en el
`handleLogin` se llama `getIdToken(true)` incondicionalmente justo después
de `signInWithEmailAndPassword`. Esto cubre el caso "el usuario abre la
app después de que le cambiaron los permisos" — perfil típico en CAMPO
(entrar, capturar, cerrar; no dejar la app abierta todo el día). El
`signInWithEmailAndPassword` ya devuelve un JWT nuevo por sí solo, pero
el refresh explícito es cinturón de seguridad ante cambios futuros de
persistencia. Costo: 200-500 ms extra en login. Si falla por falta de
red, se logea warning y continúa con el token de `signIn` (que también
viene fresco de la misma llamada al servidor).

**Campos reservados en `usuarios/{docId}`** (escritos solo por la CF, no
por el cliente):
- `claimsVersion` (number, ≥1): contador monotónico creciente.
- `_claimsSyncedAt` (timestamp): último instante en que la CF sincronizó.

Las reglas actuales de `usuarios/{docId}` permiten `update` solo a
`esAdminSistemaOSoporte()`, por lo que el cliente no puede alterar estos
campos ni auto-disparar refresh.

**Rescate de fotos huérfanas**: cuando el usuario sube una foto o
documento y **entre el `uploadBytes` a Storage y el commit del metadata
a Firestore** pierde acceso a la obra, el commit falla con
`permission-denied`. El código atrapa esa falla y llama `deleteObject`
para borrar el archivo huérfano de Storage. Si el delete también falla
(el usuario ya no tiene write), el objeto queda temporalmente hasta que
un job de limpieza lo detecte. No hay cola local ni reintentos —
decisión explícita para no complicar el manejo de un caso raro.

## Custom claims en el token

Cada usuario tiene en su JWT:

```json
{
  "rol":      "residente",
  "orgId":    "fosmon",
  "tipo":     "constructora",
  "todas":    false,
  "obras":    ["0126","0127"],
  "inactivo": false
}
```

- `rol`: uno de los roles válidos (constructora, dependencia o cross-tipo).
- `orgId`: id de la organización (`null` para `soporte`).
- `tipo`: `constructora` | `dependencia` | `null` (para `soporte`).
- `todas`: `true` para roles que ven todas las obras de SU org.
- `obras`: lista de IDs de obras asignadas (solo cuando `todas=false`).
- `inactivo`: si el perfil se marca activo:false, se pone `true` y las reglas rechazan cualquier acceso.

Peor caso ~350 bytes: cabe holgado en los 1000 bytes permitidos por token.

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
| `obras/{id}/avance/notas` ⚠️ | R/W | R/W | R | — |
| `obras/{id}/nomina/historial` | R/W | R/W | R | — |
| `obras/{id}/contrato/plazos` | R/W | R/W | R | R |
| `obras/{id}/contrato/documentos` | R/W | R/W | R | — |
| `obras/{id}/subcontratos/lista` | R/W | R/W | R | — |
| `obras/{id}/bitacora/{id}` | R/W/C/D | R/C | R | — |

- **R** = lectura · **W** = escritura · **C** = crear (append) · **D** = delete
- `—` = denegado
- ⚠️ = **está en `firestore.rules` pero NO en el ruleset vivo.** La columna
  dice el permiso que tendrá al desplegarse; hoy la ruta cae en el deny final
  y toda escritura rebota. Ver «Lo que está en el archivo y NO en producción»

### Path por path — lado dependencia

Las mismas rutas, bajo `orgs/{oid}/obras/{obraId}/…`, con `oid == orgId()`
exigido en cada regla. El `contratista` es a la dependencia lo que el
`cliente` a la constructora: ve la obra, no ve el expediente semanal.

| Path | Dir. D / Admin_sistema D | Supervisor D (asignada) | Contratista (asignada) |
|---|:-:|:-:|:-:|
| `orgs/{oid}/obras/{id}/config/info` | R/W | R/W | R |
| `orgs/{oid}/obras/{id}/config/parametros` | R/W | R/W | R |
| `orgs/{oid}/obras/{id}/config/catalogo` | R/W | R/W | R |
| `orgs/{oid}/obras/{id}/config/estimaciones` | R/W | R/W | R |
| `orgs/{oid}/obras/{id}/config/permisos` | R/W | R (no edita) | R |
| `orgs/{oid}/obras/{id}/avance/subs` | R/W | R/W | R |
| `orgs/{oid}/obras/{id}/avance/historial` | R/W | R/W | — |
| `orgs/{oid}/obras/{id}/avance/notas` ⚠️ | R/W | R/W | — |
| `orgs/{oid}/obras/{id}/bitacora/{id}` | R/W/C/D | R/C | — |

De este lado **no existen** `nomina/*`, `subcontratos/lista`,
`avance/maquinaria`, `avance/materiales` ni `config/otros_gastos`. Eso no es
un hueco de la tabla: es la frontera del margen, y está explicada arriba en
«Las cinco que NO se replican».

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
     GOOGLE_APPLICATION_CREDENTIALS=~/campo-sa.json node scripts/backfill-claims.cjs
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

---

## Pendientes conocidos

### 1. `auditor` lee `global/gp_construct` completo (multi-obra)

**Problema:** el rol `auditor` (antes `supervisor`) puede leer
`/global/gp_construct`, que es un blob único con el gasto de **todas**
las obras de FOSMON. Un auditor asignado a la obra `0126` técnicamente
puede ver los gastos de `0127`, `0128`, etc. — no solo los suyos.

**Impacto:** filtración cross-obra dentro de FOSMON. Los 3 auditores en
producción (`@hytorc.com.mx`, `@noleaks.com.mx`) están auditando una
obra conjunta y no tienen razón para ver el gasto de otras obras.

**Solución propuesta (no implementada en esta etapa):**
- Deprecar la lectura del blob `gp_construct` para roles no-directivos.
- Migrar todas las lecturas del frontend a `/global/gp_detalle/obras/{obraId}`,
  que ya está particionada por obra.
- Modificar la regla `/global/gp_detalle/obras/{obraGPId}` para que exija
  que `obraGPId` esté relacionada con una obra en `obrasAsignadas()`
  (necesita mapping obraId ↔ gpId; hoy usamos convención `gp_{obraId}`).
- Mantener `gp_construct` accesible solo a directivos (`esDirectivoC()`).

**Por qué no lo resolvemos ahora:** requiere tocar `Dashboard`, `Panel
Ejecutivo` y `PantallaObras` en el frontend para reemplazar la lectura
del blob por lecturas paginadas. Es un refactor con riesgo de UI. La
migración `feature/organizaciones` es puramente de modelo y aisla los
tenants primero; el fix `gp_construct` va en una rama siguiente.

### 2. Colecciones de dependencia sin datos ni UI

Las rutas `/orgs/{orgId}/obras/{obraId}/{contratistas|supervisores|programa|convenios|evidencia}`
tienen reglas de acceso pero no tienen UI ni datos. Cuando toque
implementar la edición dependencia se creará:
- Módulos: padrón de contratistas, supervisores, comparativo, programa,
  convenios, evidencia, SIMVER.
- Interfaz para roles `director_obras`, `subdirector`, `jefe_supervision`,
  `supervisor_obra`, `administrativo`, `contralor`, `contratista`.

### 3. Auditoría de accesos de `soporte`

Cada acción de `soporte` debe generar entrada en `/auditoria`. Las reglas
lo permiten (allow create), pero **el frontend debe llamarlo explícitamente**
al crear una org o usuario desde una futura pantalla de administración
cross-tenant. Trigger de Cloud Function opcional a implementar si se
detecta que el frontend puede olvidarse.

### 4. Cuentas de prueba dedicadas por rol

Hoy verificamos el comportamiento de cada rol usando cuentas de personas
reales (por ejemplo, `lgomez@fosmon.com.mx` era la cuenta de prueba del
rol `supervisor` antes de la migración a `auditor`). Esto contamina:

- **Trazabilidad de `/auditoria`**: cada acción de prueba queda registrada
  como si la persona real la hubiera hecho.
- **Bitácora por obra**: eventos de captura hechos para verificar se
  atribuyen a la persona, no a "prueba".
- **Notificaciones cross-usuario**: la persona real recibe notificaciones
  generadas por pruebas de otro rol.

**Solución propuesta (no implementada):** crear cuentas dedicadas por rol
con emails del estilo `test-<rol>@fosmon.com.mx`, marcadas con un flag
`_prueba: true` en el perfil. El frontend puede filtrarlas de listas de
usuario visibles, y `/auditoria` puede omitirlas o marcarlas visualmente.

**Prioridad:** media. No bloquea nada pero ensucia la bitácora conforme
crece el uso real de CAMPO.

### 5. Falta `onAuthStateChanged` en el frontend

**Problema:** el frontend no registra un listener a `onAuthStateChanged`
de Firebase Auth. El estado React `usuario` solo se popula al pasar por
`handleLogin` (email+password). Al restaurar sesión desde IndexedDB (auto
persistencia de Firebase), el componente `App()` arranca con `usuario:null`
y renderiza `<Login/>`; el usuario teclea de nuevo su password.

**Consecuencia relevante después de `fix/revoke-on-password` (2026-09-16):**
cuando un directivo cambia la contraseña de un usuario, la Cloud Function
`cambiarPassword` ejecuta `revokeRefreshTokens(uid)` — todos los JWT
vigentes de ese usuario quedan inválidos. Con un listener de
`onAuthStateChanged` bien configurado, esto dispararía un `signOut`
inmediato en el dispositivo del usuario. Sin él, el usuario queda en
**estado zombie**: la UI de CAMPO sigue cargada, pero cualquier consulta
a Firestore/Storage falla con `permission-denied` porque el token está
revocado. Solo al cerrar y volver a abrir la app (o al agotar el token,
~1 hora), el flujo de login vuelve a arrancar normal.

Otras consecuencias del mismo hueco:
- Sesión persistente (Firebase default) queda desaprovechada — el usuario
  igual re-teclea password en cada arranque.
- Los cambios de permisos hechos con `sincronizarClaims` solo se propagan
  al dispositivo cuando la app está abierta y el listener de
  `claimsVersion` los recibe (cubierto por `fix/refresh-token`).

**Solución propuesta (no implementada):**
- Añadir `onAuthStateChanged(fbAuth, async (user) => { ... })` al mount de
  `App()`. Si `user != null`, restaurar `usuario` state leyendo
  `usuarios/{emailAId(user.email)}`. Si `user == null`, hacer
  `setUsuario(null)` (equivale a logout, muestra `<Login/>`).
- Manejar el caso `user.disabled === true` (usuario desactivado): forzar
  `signOut` y mostrar mensaje.
- Al agregarlo, decidir si activar sesión persistente formal (ver
  discusión de riesgos en dispositivos compartidos de obra: timeout de
  inactividad, verificar `activo:true` al restaurar, botón visible
  "Cambiar de usuario").

**Prioridad:** media-alta. No es una vulnerabilidad de seguridad
(el token revocado no permite operar), pero degrada la UX y hace que la
funcionalidad de "cerrar sesión al cambiar contraseña" no se sienta en
tiempo real.
