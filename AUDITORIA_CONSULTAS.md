# Auditoría: consultas de `src/App.jsx` vs reglas nuevas

Rama: `claude/rules-seguridad` · Fecha: 2026-09-14

## Estado de rompimientos detectados

| # | Rompimiento | Estado |
|---|---|---|
| A | `getDocs(collection('obras'))` deja lista vacía a no-directivos | ✅ **RESUELTO** en commit posterior — ver sección 1 abajo. |
| D | `notifARoles` / `notifAEmail` cross-user no funciona para no-admin | ⚠ **DEGRADACIÓN CONOCIDA — aceptada temporalmente.** Ver sección 4. |

Este documento lista cada consulta que hace hoy el frontend contra Firestore/Storage y confirma si las reglas nuevas la permiten para los roles `residente`, `supervisor` y `cliente`.

Legenda: **✓** = permitida · **✗** = denegada · **N/A** = módulo no visible para el rol (el frontend no llega a llamarla)

---

## 1. Al login (todos los usuarios autenticados)

| Path | Op | Componente | residente | supervisor | cliente |
|---|---|---|:-:|:-:|:-:|
| `usuarios/{ownEmailId}` | get | `Login` — carga perfil propio | ✓ | ✓ | ✓ |
| `usuarios/{ownEmailId}` | set | `Login` — auto-crea perfil default | ✓ | ✓ | ✓ |
| `collection('obras')` | getDocs | App raíz — carga lista de obras | ⚠ ver #A | ⚠ ver #A | ⚠ ver #A |
| `obras/{o.id}/config/info` | get | App raíz — enriquece cada obra | ✓ (si asignada) | ✓ (si asignada) | ✓ (si asignada) |
| `notificaciones/{uid}/items` | onSnapshot | Campanita | ✓ | ✓ | ✓ |

### #A — RESUELTO (commit posterior)

**Problema:** con las reglas nuevas, los roles no-directivos SOLO pueden leer `obras/{id}` si están asignados. `getDocs(collection('obras'))` traía la colección entera y Firestore rules-based queries rechazan queries cuya salida no es subconjunto garantizado de lo permitido.

**Fix aplicado en `src/App.jsx` (bloque "CARGAR OBRAS desde Firestore al hacer login"):**

- Directivo (`PERMISOS[rol]?.todas_obras === true`): sigue el mismo path anterior — `getDocs(collection(fbDb, 'obras'))`. Nada cambia para ellos.
- No-directivo: en vez del `getDocs`, hace `Promise.all` de `getDoc(doc('obras', id))` por cada id en `usuario.obras_asignadas`. Si no tiene asignadas, la lista queda vacía (mismo estado final que antes cuando el filtro de `PantallaObras` recortaba a las asignadas — o si no tenía ninguna).

**Efecto neto:** el `state.obras` termina exactamente igual que antes porque el componente `PantallaObras` ya filtraba por `obras_asignadas` (línea 5326 en `App.jsx`). Directivos ven la lista completa igual, no-directivos ven sus asignadas igual. Solo cambió la fuente de los datos: antes se cargaba de más y se filtraba en front; ahora se carga solo lo permitido.

**Cosas que se verificaron equivalentes:**
- Panel Ejecutivo: solo para directivos (gate `verPanelEjecutivo`), ellos siguen viendo `state.obras` con todas → sin cambio.
- Bulk loader `datosPorObra`: idéntica dependencia — dispara para directivos con ≥2 obras activas.
- `PantallaObras`: filtra `obras.filter(o => asignadas.includes(o.id))` para no-directivos → funciona igual.
- `GestionUsuarios` (asignar obras): solo directivos entran ahí, siguen viendo la lista completa.
- `PanelAlertas`: solo directivos entran a `screen==="alertas"`.
- `entrar(id)` desde deep-link de notif:
  - Directivo: `obras.find(x=>x.id===id)` funciona (todas cargadas).
  - No-directivo con obra asignada: funciona (está en state).
  - No-directivo con obra NO asignada: `obras.find` = undefined → auditoría queda sin nombre, y las reglas denegarán los sub-fetch de la obra. Comportamiento correcto (no debería tener acceso).
- `useEffect` de carga: dependencias `[usuario?.uid]` sin cambio — para ver cambio en `obras_asignadas` el usuario debe re-loggear igual que antes.

**Build:** `npm run build` OK después del cambio.

---

## 2. Al entrar a una obra (Dashboard + Operación)

Para residente/supervisor/administrador_obra/superintendente/**cliente** — todas asumen obra **asignada**.

| Path | Op | Módulo | residente | supervisor | cliente |
|---|---|---|:-:|:-:|:-:|
| `obras/{id}/config/info` | get | Contrato / General | ✓ | ✓ | ✓ |
| `obras/{id}/config/parametros` | get/set | %Anticipo, FG | ✓ | ✓ read / ✗ set | N/A |
| `obras/{id}/config/estimaciones` | onSnapshot / setA | Estimaciones | ✓ | ✓ read / ✗ set | ✓ read |
| `obras/{id}/config/catalogo` | get/setA | Presupuesto | ✓ | ✓ read / ✗ set | ✓ read |
| `obras/{id}/config/otros_gastos` | get/setA | Otros gastos | ✓ | ✓ read / ✗ set | ✗ deny |
| `obras/{id}/config/permisos` | get | Planeación → Permisos | ✓ | ✓ | N/A |
| `obras/{id}/avance/subs` | get/setA | Avance físico | ✓ | ✓ read / ✗ set | ✓ read |
| `obras/{id}/avance/maquinaria` | get/setA | Maquinaria | ✓ | ✓ read / ✗ set | ✗ deny |
| `obras/{id}/avance/materiales` | get/setA | Almacén | ✓ | ✓ read / ✗ set | ✗ deny |
| `obras/{id}/avance/historial` | get/set | Snapshots semanales | ✓ | ✓ read / ✗ set | ✗ deny |
| `obras/{id}/nomina/historial` | get/setA | Nómina | ✓ | ✓ read / ✗ set | ✗ deny |
| `obras/{id}/contrato/plazos` | get/setA | Plazos | ✓ | ✓ read / ✗ set | ✓ read |
| `obras/{id}/contrato/documentos` | get/setA | Docs contrato | ✓ | ✓ read / ✗ set | ✗ deny |
| `obras/{id}/subcontratos/lista` | get/setA | Subcontratos | ✓ | ✓ read / ✗ set | ✗ deny |
| ~~`obras/{id}/subcontratos/historial_{sid}`~~ | — | Retirado 2026-09-22 — la ruta no tiene regla, caía en el deny final y nunca existió un documento (PENDIENTES #31) | — | — | — |
| `obras/{id}/bitacora/{eid}` | create/read | Bitácora | ✓ create + read | ✓ read / ✗ create | ✗ deny |

Todo lo que dice **✗ deny** en la columna cliente es **intencional** (el módulo no le corresponde). Lo que dice **N/A** es que el frontend nunca abre esa pantalla para ese rol.

---

## 3. Al entrar como Directivo (Panel Ejecutivo, bulk loader)

| Path | Op | ¿Aplica a residente/supervisor/cliente? |
|---|---|---|
| `obras/{id}` info + subs + maquinaria + materiales + estimaciones + otros_gastos + nomina | onSnapshot (bulk loader) | ✗ — el bulk loader solo corre si `verPanelEjecutivo` (directivo) |
| `global/gp_construct` | doc onSnapshot | Residente/Supervisor ✓, **Cliente ✗ (denegado por reglas nuevas)** |
| `global/gp_detalle/obras/{obraGPId}` | get | Residente/Supervisor ✓, **Cliente ✗ (denegado por reglas nuevas)** |

### #B — Cliente y `global/gp_construct`

En el código actual, el hook que lee `gp_construct` corre para **todos los usuarios autenticados** al montar la app (línea ~2088 y en `TendenciasMensuales`). Con las reglas nuevas, el cliente recibirá `permission-denied` al montar el listener → error en consola pero no bloquea la app (el listener tolera fallos).

**No requiere cambio de código**, solo hay que estar consciente de que la consola del cliente mostrará errores `permission-denied` en cada login. Si molesta, se puede envolver con `if (rol !== 'cliente')` antes de suscribirse.

### #C — Cliente y `global/gp_detalle/obras/{obraGPId}`

Se llama desde `GastosGP` que **NO se renderiza para cliente** (no tiene tab Gastos). Sin impacto.

---

## 4. Escritura de notificaciones cross-user

| Path | Op | residente | supervisor | cliente |
|---|---|:-:|:-:|:-:|
| `notificaciones/{ownUid}/items/*` | read/update/create | ✓ | ✓ | ✓ |
| `notificaciones/{otherUid}/items/*` | create (cross-user) | ✓ | N/A (solo lee) | N/A |
| `query(collection('usuarios'), where('rol','in',...))` | getDocs — `notifARoles` | **✗** ver #D | **✗** ver #D | N/A |
| `doc('usuarios/{email}')` | get — `notifAEmail` | **✗** ver #D | N/A | N/A |

### #D — DEGRADACIÓN CONOCIDA, aceptada temporalmente

**Estado:** aceptada como conocida. NO se implementa fix en este ciclo — se hará como trabajo separado.

**Qué se rompe:** `notifARoles(['director_general', ...])` y `notifAEmail(email)` se disparan desde:
- **Estimaciones** — cuando se crea/factura/paga/aprueba (líneas 9309-9332).
- **Subcontratos** — al agregar/eliminar sub (líneas 11981, 12379).
- **Otros gastos** — al capturar un gasto (línea 5398).
- **Presupuesto** — al reemplazar catálogo (línea 7471).

Todos estos triggers son ejecutados por roles operativos (`administrador_obra`, `superintendente`, `residente`). Con reglas endurecidas, esos roles no pueden hacer `getDocs('usuarios')` ni `getDoc('usuarios/{id}')` de terceros → **la notificación silenciosamente NO se crea**. El `try/catch` de `notifARoles` traga el error de permisos.

**Qué NO se rompe:**
- La operación en sí funciona: datos se guardan, estimaciones se registran, catálogos se reemplazan.
- Los directivos que estén activamente en el Panel Ejecutivo o entrando a la obra sí ven los cambios reflejados (viene del bulk loader real-time).
- Las notificaciones que dispara un directivo (ej. Aldo director asigna obra a residente) sí funcionan — porque el que ejecuta `notifARoles` sí es admin y sí puede leer `usuarios`.

**Qué SÍ se pierde temporalmente:**
- La campanita de un director general no le avisa automáticamente cuando un administrador de obra crea una estimación nueva o cambia el estatus de una a "Facturada"/"Pagada"/"Aprobada".
- Idem para altas/bajas de subcontratos, captura de otros gastos, y reemplazo de catálogo.

**Impacto de negocio:** el flujo de captura semanal no se rompe. Los directivos entran manualmente a las obras y ven lo capturado. La notificación era conveniente, no crítica.

**Ruta de solución propuesta (para siguiente ciclo):**

Opción A — **Recomendada. Cloud Function callable `dispararNotifARoles`:**

1. Crear en `functions/index.js` una nueva callable:
   ```
   exports.dispararNotifARoles = onCall(async (request) => {
     // Validar request.auth existe (cualquier autenticado)
     // Recibir { roles, payload }
     // Validar payload (categorias, tipos permitidos, longitudes)
     // Con Admin SDK: query usuarios where rol in roles, activo != false
     // Escribir notif a cada uno con crearNotifPara
     return { ok: true, enviadas: N }
   });
   ```

2. En `App.jsx`, reemplazar los helpers `notifARoles` y `notifAEmail` para que en vez de leer Firestore directo, invoquen la callable con `httpsCallable(fbFunctions, 'dispararNotifARoles')`.

3. Validar en el backend que el payload no permita spam (rate limit + validaciones estrictas de contenido).

**Alternativas descartadas:**

- Permitir `list` en `usuarios/*` a cualquier autenticado con rol operativo: expone la lista completa de usuarios (nombres, emails, roles, obras asignadas) a cualquier residente. Los residentes de una obra podrían ver datos de residentes de otras obras. Rechazado.
- Permitir `read` de un doc específico de `usuarios/{id}` a cualquier autenticado: sigue permitiendo enumerar users si alguien conoce el patrón de `emailAId`. Rechazado.
- Cambiar el frontend para que cada trigger conozca los UIDs específicos y no requiera `getDocs`: rompe el modelo actual donde las notif se dirigen por ROL, no por UID.

**Trabajo pendiente creado:** implementar la Cloud Function `dispararNotifARoles` y migrar los 8 callsites en `App.jsx`. Estimación: 2-3 h de código + pruebas contra emulador.

---

## 5. Escritura de auditoría

| Path | Op | residente | supervisor | cliente |
|---|---|:-:|:-:|:-:|
| `auditoria/{id}` | create (append via fsSetA) | ✓ | ✗ (solo escribe si edita) | ✗ (no escribe) |
| `auditoria/{id}` | read | ✗ (solo directivos) | ✗ | ✗ |

Consistente. `fsSetA` es el helper que hace write + entrada de auditoría — cliente y supervisor no invocan escrituras, así que ni intentan crear auditoría.

---

## 6. Storage

| Path | Op | residente | supervisor | cliente |
|---|---|:-:|:-:|:-:|
| `obras/{id-asignada}/fotos/**` | read/write | ✓ | ✓ read / ✗ write | ✓ read / ✗ write |
| `obras/{id-asignada}/docs/**` | read/write | ✓ | ✓ read / ✗ write | ✗ deny |
| `obras/{id-asignada}/documentos/**` | read/write | ✓ | ✓ read / ✗ write | ✗ deny |
| `obras/{id-asignada}/nomina/**` | read/write | ✓ | ✓ read / ✗ write | ✗ deny |
| `obras/{id-asignada}/subcontratos/**` | read/write | ✓ | ✓ read / ✗ write | ✗ deny |

Sin cambios respecto a reglas nuevas — todo alineado.

---

## Resumen ejecutivo (actualizado)

### Consultas que quedarían denegadas y ROMPEN funcionalidad si desplegamos hoy:

1. ~~`getDocs(collection('obras'))` al login~~ — ✅ **RESUELTO**. Ver #A arriba.
2. **`notifARoles` / `notifAEmail` cross-user** — ⚠ **DEGRADACIÓN CONOCIDA, aceptada**. Ver #D arriba.

### Consultas denegadas ESPERADAS (comportamiento deseado):

- Cliente vs `nomina/historial`, `config/otros_gastos`, `avance/maquinaria`, `avance/materiales`, `avance/historial`, `contrato/documentos`, `subcontratos/lista`, `bitacora/*`, `global/gp_construct`, `global/gp_detalle`.
- Supervisor vs cualquier `write`.
- Residente vs `usuarios/*` (excepto propio), `global/historial_obras`, `obras/*` (crear).

### Recomendación

Reglas **ya pueden desplegarse** desde el lado de bloqueos duros:
- #A resuelto: no-directivos verán su lista de obras al login.
- #D pendiente como degradación conocida: los directivos dejan de recibir notif automáticas de eventos disparados por operativos, pero la captura funciona normal.

**Nueva verificación necesaria antes de deploy** (fuera del alcance de este PR):
- Confirmar con el usuario que la degradación #D es aceptable temporalmente.
- Alinear con el usuario cuándo hacer el trabajo separado de la Cloud Function `dispararNotifARoles`.

## Cambios pendientes en `src/App.jsx` / `functions/index.js` (fuera del alcance de este PR)

- [x] ~~Reemplazar `getDocs(collection('obras'))` en línea ~14638~~ — ✅ hecho en esta rama.
- [ ] Cloud Function callable `dispararNotifARoles` y migración de los 8 callsites (`notifARoles` / `notifAEmail`).
- [ ] Envolver `onSnapshot(doc(fbDb, 'global/gp_construct'))` con `if (rol !== 'cliente')` para evitar errores en consola del cliente. Cosmético.
