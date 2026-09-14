# Auditoría: consultas de `src/App.jsx` vs reglas nuevas

Rama: `claude/rules-seguridad` · Fecha: 2026-09-14

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

### #A — Problema crítico: `getDocs(collection('obras'))`

Con las reglas nuevas, los roles no-directivos SOLO pueden leer `obras/{id}` si están asignados. `getDocs` de la colección completa **fallará con `permission-denied`** para residente/supervisor/cliente porque intenta traer docs no permitidos.

**Comportamiento actual:** Firestore rules-based queries requieren que el query resultante sea garantizadamente subconjunto de lo que las reglas permiten. Sin un `.where('id', 'in', obras_asignadas)`, Firestore rechaza el query completo.

**Consecuencia si desplegamos así:**
- Un residente/supervisor/cliente hace login → `getDocs('obras')` rechazado → `catch` traga el error → **`obras` queda vacío** → la app muestra "no hay obras" aunque tenga asignadas.

**Fix necesario en `src/App.jsx` ANTES de desplegar reglas:**

Hay que cambiar el query para roles no-directivos:
```js
// En vez de: getDocs(collection(fbDb, 'obras'))
if (perfil.rol es directivo) {
  const snap = await getDocs(collection(fbDb, 'obras'));
} else {
  // Solo obras asignadas — máx 30 con 'in', o hacer N gets paralelos
  const obraIds = perfil.obras_asignadas || [];
  const docs = await Promise.all(obraIds.map(id => getDoc(doc(fbDb, 'obras', id))));
}
```

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
| `obras/{id}/subcontratos/historial_{sid}` | get | Historial de un sub | ✓ | ✓ read / ✗ set | ✗ deny |
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

### #D — Notificaciones cross-user rotas para no-admin

`notifARoles(['director_general', ...])` y `notifAEmail(email)` se disparan desde:
- **Estimaciones** — cuando se crea/factura/paga/aprueba una estimación (línea 9309-9332). Lo dispara `administrador_obra` (rol operativo). Con reglas nuevas → `getDocs('usuarios')` denegado → notif no se crea.
- **Subcontratos** — al agregar/eliminar sub (línea 11981, 12379).
- **Otros gastos** — al capturar un gasto (línea 5398).
- **Presupuesto** — al reemplazar catálogo (línea 7471).

**Consecuencia:** los directivos dejan de recibir notif automática de eventos disparados por administradores de obra. La operación NO se rompe (los datos sí se guardan), solo las notif silenciosamente dejan de aparecer.

**Fix necesario ANTES de desplegar reglas:**
- Opción A: cambiar `notifARoles` para que llame a una **Cloud Function** (con Admin SDK bypasa reglas y hace el query de `usuarios`). Es lo correcto arquitectónicamente.
- Opción B: en las reglas, permitir `read` de `usuarios/*` a cualquier autenticado con rol operativo (limitando a campos no sensibles: rol + uid + activo). Pero mezcla concerns y expone la lista de usuarios a cualquiera.
- Opción C: cambiar la regla a `allow list: if esAuth()` para queries filtradas por rol. Riesgo: expone emails de todos los usuarios a residentes/clientes.

**Recomendación:** opción A. Requiere código adicional (Cloud Function `dispararNotifARoles`) — trabajo fuera del alcance de este PR.

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

## Resumen ejecutivo

### Consultas que quedarían denegadas y ROMPEN funcionalidad si desplegamos hoy:

1. **`getDocs(collection('obras'))` al login** — residente/supervisor/cliente verían la lista vacía. **Fix requerido en frontend antes de deploy.**

2. **`notifARoles` / `notifAEmail` cross-user** — administradores de obra ya no dispararán notif a directivos. **No rompe operación**, solo se pierden notificaciones automáticas de estimaciones/subcontratos/otros gastos. Fix requerido para restaurar funcionalidad.

### Consultas denegadas ESPERADAS (comportamiento deseado):

- Cliente vs `nomina/historial`, `config/otros_gastos`, `avance/maquinaria`, `avance/materiales`, `avance/historial`, `contrato/documentos`, `subcontratos/lista`, `bitacora/*`, `global/gp_construct`, `global/gp_detalle`.
- Supervisor vs cualquier `write`.
- Residente vs `usuarios/*` (excepto propio), `global/historial_obras`, `obras/*` (crear).

### Recomendación

**NO desplegar reglas hasta resolver #A** (getDocs de obras) — es una regresión visible que rompe login para ~70% de los usuarios. La reparación es un cambio de ~15 líneas en `src/App.jsx` bien acotado.

**#D (notifARoles)** puede diferirse — degrada la UX pero no bloquea captura. Se puede desplegar reglas con nota conocida.

## Cambios pendientes en `src/App.jsx` (fuera del alcance de este PR)

- [ ] Reemplazar `getDocs(collection('obras'))` en línea ~14638 por load por-obra según `usuario.obras_asignadas` cuando no es directivo.
- [ ] Migrar `notifARoles` y `notifAEmail` a Cloud Function callable con Admin SDK.
- [ ] Envolver `onSnapshot(doc(fbDb, 'global/gp_construct'))` con `if (rol !== 'cliente')` para evitar errores en consola.
