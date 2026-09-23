# CAMPO — Brief de Arquitectura

**FOSMON Construcciones · Última actualización: septiembre 2026**

App web (SPA + PWA) para control operativo de obras: avance físico, gastos, estimaciones, subcontratos, maquinaria, almacén y nómina. Reemplaza el flujo manual de Excel + WhatsApp con captura centralizada y multi-usuario.

- **Producción:** https://campo-fosmon.netlify.app
- **Repo:** https://github.com/ofosado/CAMPO-FOSMON
- **Archivo principal:** `src/App.jsx` (~15,000 líneas, monolito deliberado para iterar rápido)
- **Cloud Functions:** `functions/index.js` (~1,440 líneas)

---

## 1. Stack completo

### Frontend
- **Lenguaje:** JavaScript (ES modules, JSX). No hay TypeScript.
- **Framework UI:** React 18 (`react`, `react-dom` 18.2)
- **Bundler:** Vite 4.4 (`@vitejs/plugin-react`)
- **PWA:** `vite-plugin-pwa` 0.17 con Workbox (manifest + service worker)
- **Estilos:** CSS-in-JS inline en cada componente. No hay Tailwind, no hay archivos CSS externos aparte de `App.css`.
- **PDF:** `jsPDF` + `jsPDF-autotable` cargados vía CDN al vuelo (no como dependencia npm)
- **Parseo Excel:** SheetJS (`xlsx.full.min.js`) cargado vía CDN al vuelo
- **PDF viewer:** `pdfjs-dist` 4.7 (para preview de docs subidos)

### Backend (Firebase / Google Cloud, proyecto `campo-fosmon`)
- **Auth:** Firebase Authentication (email/password)
- **Base de datos:** Cloud Firestore (NoSQL documental)
- **Storage:** Firebase Storage (fotos + documentos)
- **Cloud Functions:** Gen 2, runtime Node 20, región `us-central1`
- **Plan:** Blaze (pay-as-you-go). Uso real muy bajo, típicamente <$5 USD/mes.

### Servicios externos
- **Google Sheets ("GP Construct"):** fuente única del gasto acumulado por obra. Se lee desde un Sheet público como CSV y se cachea en Firestore (`global/gp_construct` + `global/gp_detalle/obras/{obraIdGP}`).
- **Netlify:** hosting del frontend.

### Despliegue
- **Frontend:** auto-deploy en Netlify tras push a `main` en GitHub (~2 min).
- **Cloud Functions:** deploy manual con `firebase deploy --only functions` desde Mac local. Requiere Firebase CLI logueado.
- **Storage rules / CORS:** archivos `storage.rules` y `storage.cors.json` en el repo, se despliegan con Firebase CLI.

---

## 2. Esquema de datos

**No hay DDL.** Firestore es schemaless — la "estructura" es la convención con la que la app lee/escribe. Documentada aquí a partir del código real.

### Colección raíz

```
usuarios/{emailNormalizado}
  · email, nombre, rol, activo
  · obras_asignadas: string[]   (ids de obras — para roles no-directivos)
  · uid                          (Firebase Auth UID)
  · creadoEn, creadoPor
  · bienvenidaVista: boolean     (banner de onboarding ya visto)

obras/{obraId}                    ← doc top-level, necesario para listar
  · id, nombre, contrato, cliente, presupuesto (number),
    estado ('activa'|'archivada'), inicio (fecha ISO), fin (fecha ISO),
    finAmpliado (opcional), pctAnticipo, pctFondoGar, pctRetencion,
    diasPago, gpId (id del Sheet GP asociado), gastoGP (legacy)

  /config/info                    duplica campos del doc padre (compat + listeners)
  /config/parametros              { pctAnticipo, pctFondoGar, pctRetencion }
  /config/estimaciones            { data: [{no, monto, estatus, fecha, fechaFact, fechaCobro, ...}] }
  /config/catalogo                { conceptos: [...], importeContrato, totalLeido,
                                    fechaCarga, categorias, parserVersion }
  /config/otros_gastos            { items: [{fecha, concepto, importe}] }
  /config/permisos                override de permisos por obra {[rol]: {[modulo]: 'ver'|'editar'|null}}

  /avance/subs                    { data: [{id, sec, sub, imp, a, cantEjec, cat, ruta, fotos, ...}] }
  /avance/maquinaria              { data: [{fecha, tipo, imp, ...}] }
  /avance/materiales              { data: [{fecha, material, imp, ...}] }
  /avance/historial               { semanas: [{sem, año, avancePonderado, subs, fechaCaptura, capturadoPor}] }

  /nomina/historial               { semanas: [{semana, fecha, archivo, trabajadores[],
                                    totalNomina, totalHE, totalHEHrs, totalHEImp,
                                    totalDias, totalDir, totalInd}] }

  /contrato/plazos                { ampliaciones: [{fecha, motivo, dias}] }
  /contrato/documentos            { lista: [{nombre, url, subido, tipo}] }

  /subcontratos/lista             { items: [{id, nombre, proveedor, monto, catalogo[],
                                    avance[], estimaciones[], pagos[], fotos, adjunto}] }

  /bitacora/{autoId}              entradas de bitácora (log operativo por obra)

global/
  gp_construct                    cache del Sheet GP (todas las obras, actualizado
                                  por Cloud Function schedulada cada mañana 8am)
  gp_detalle/obras/{obraIdGP}     detalle por obra (rubros, meses, semanas)
  historial_obras                 snapshots de obras archivadas

notificaciones/{uid}/items/{notifId}
  · categoria, tipo, titulo, mensaje
  · link: { tab, subTab, obraId }
  · leida, archivada, fecha, creadaPor

auditoria/{autoId}                append-only log de cambios (modulo, entidad,
                                  obraId, obraNombre, meta, usuario, fecha)
```

### Relaciones clave (implícitas por convención, no por FK)

- `usuarios.obras_asignadas[]` → `obras.id` (filtra visibilidad para roles no-directivos)
- `obras.gpId` → id de la obra en el Sheet GP (para resolver gasto en vivo)
- `obras.cliente` → string libre (no hay tabla `clientes` normalizada)
- `notificaciones.link.obraId` → `obras.id` (para deep-link desde la campanita)
- Todo el avance semanal se snapshotea, no hay tablas de tiempo separadas: la serie histórica vive en `/avance/historial` y `/nomina/historial` como arrays dentro de un único doc.

### Reglas de seguridad actuales

- **Firestore:** `allow read, write: if request.auth != null` (cualquier usuario autenticado hace todo). **Deuda técnica documentada abajo.**
- **Storage:** `allow read, write: if request.auth != null` bajo `/obras/{obraId}/**`; todo lo demás bloqueado.
- **CORS Storage:** configurado para permitir peticiones desde `campo-fosmon.netlify.app`.

---

## 3. Módulos y pantallas

### Navegación general
```
Login (Firebase Auth)
  ↓
Pantalla "Obras" (lista de obras activas + Panel Ejecutivo si rol directivo)
  ↓
Entrar a una obra → 4 tabs principales
```

### Tabs por obra (roles operativos)
- **Dashboard** — KPIs, banner de riesgos automáticos, gráficas de tendencias y proyección
- **Operación** — 6 sub-tabs: Avance físico · Estimaciones · Nómina · Subcontratos · Maquinaria · Almacén
- **Gastos** — análisis del GP Construct con sub-tabs Resumen / Proveedores / Rubros / Tendencia
- **Planeación** — sub-tabs Contrato · Presupuesto · Permisos

### Tab cliente (solo rol `cliente`)
- Avance · Fotos · Estimaciones (sin datos internos) · Plazos

### Vistas globales (no por obra)
- **Gestión de usuarios** (director general, director operaciones, admin sistema)
- **Panel Ejecutivo** consolidado (arriba de la lista de obras, solo directivos, requiere ≥2 obras activas)

### Flujo por módulo

**Avance físico:**
1. Se sube un Excel/CSV del presupuesto en Planeación → Presupuesto (una vez por obra, reemplazable con confirmación).
2. El parser crea el catálogo de partidas y las sincroniza como `subs` en `/avance/subs`.
3. En Operación → Avance físico el residente captura % o volumen ejecutado por partida, con fotos inline.
4. Cada guardado con cambio real dispara un snapshot semanal (debounce 3 s) en `/avance/historial`.
5. Reemplazar catálogo preserva el avance de partidas cuya clave coincida.

**Nómina:**
1. Se sube el Excel de nómina semanal desde Operación → Nómina.
2. Parser (heurístico) detecta columnas, extrae por trabajador (nombre, categoría, tipo D/I, días, HE, importes, viático, bono).
3. Detecta convención de captura (días vs horas por día — TAMSA usa horas) y normaliza.
4. Valida antes de guardar (ver sección 4). Modal muestra errores/advertencias.
5. Guarda snapshot en `/nomina/historial`. La UI muestra por default la semana más reciente.
6. Al abrir muestra tabla ordenable (click en headers), altas/bajas vs semana anterior, top HE.

**Estimaciones:** CRUD manual con estatus (En proceso, Facturada, Aprobada, Pagada). Cambios disparan notificaciones internas a roles relevantes.

**Subcontratos:** cada sub es como una "obra menor": catálogo, avance por partida, estimaciones, pagos, fotos, adjunto. Import por Excel/PDF disponible.

**Gastos:** vista analítica del GP Construct (proveedores, rubros, tendencia semanal). El GP se refresca automático cada mañana 8am (Cloud Function) y se puede forzar refresh manual.

**Contrato:** captura de datos contractuales, plazos, ampliaciones, repositorio de documentos, condiciones de pago.

**Riesgos:** motor de detección automática (`detectarRiesgos`) con biblioteca por categorías (financiero, plazo, avance, nómina, materiales, maquinaria). Se renderiza como banner en el Dashboard.

---

## 4. Captura de información

### Quién y con qué frecuencia

| Módulo | Captura | Frecuencia | Dispositivo típico |
|---|---|---|---|
| Avance físico | Superintendente / Residente / Administrador de Obra | Semanal (corte viernes) | Móvil o desktop |
| Fotos | Superintendente / Residente | Al momento del avance | Móvil (cámara) |
| Otros gastos | Administrador de Obra | Al ocurrir | Desktop |
| Maquinaria | Superintendente / Residente | Diario/semanal | Móvil o desktop |
| Almacén | Superintendente / Administrador | Al ingresar material | Móvil |
| Estimaciones | Administrador de Obra | Al facturar/cobrar | Desktop |
| Subcontratos | Administrador de Obra | Al firmar / al pagar | Desktop |
| **Nómina** | Administrador de Obra | Semanal (corte viernes) | Desktop (sube Excel) |
| Contrato / Presupuesto | Gerente de Construcción | Una vez al iniciar la obra (reemplazable) | Desktop |
| Riesgos | Automático (motor) | Continuo | — |
| Bitácora | Cualquier rol operativo | Al ocurrir un evento notable | Móvil o desktop |

### Cadencia forzada
- **Cloud Functions programadas** envían notificaciones internas si no hubo captura:
  - Viernes 10:00 → recordatorio de captura de obra
  - Viernes 12:00 → recordatorio de captura de subs
  - Lunes 09:00 → recordatorio de pendientes

### Dispositivo
- App es PWA instalable en iOS/Android. Se recomienda instalar para captura rápida de fotos.
- No hay app nativa, todo corre en el navegador.

### Validaciones existentes

**Nómina (11 checks):**
- Bloqueantes: duplicidad de trabajador en el archivo, días trabajados > 7 (con excepción por convención de horas).
- Advertencias: semana duplicada (mismo nombre ya cargado), suma componentes ≠ total (tol $1), importe días ≠ días × salario diario, HE > 60 h, sin salario base pero con pago, monto > $30,000/semana, alta/baja vs semana anterior, cambio de salario > 30% vs semana anterior.

**Presupuesto:**
- Detección de duplicación de subtotales (fila de resumen contada como concepto).
- Comparación total leído vs importe contratado.
- Botones de ajuste: dividir entre N, escalar al contratado, usar total leído.

**Avance físico:**
- Cantidad ejecutada nunca excede la cantidad contratada (se recorta al 100%).
- Inputs numéricos aceptan decimales (`step="0.01"`).

**Otros:** no hay validación estructural fuerte (Firestore no la impone; toda la validación es del lado cliente).

---

## 5. Cálculo de avances y proyecciones

### Avance físico por obra
```
avance_ponderado_% = Σ ( a_partida / 100 × imp_partida ) / Σ ( imp_partida ) × 100
ejecutado_en_pesos_$ = ( avance_ponderado / 100 ) × presupuesto_obra
```
- `a` es el % capturado por el residente por partida (0-100).
- `imp` es el importe presupuestado de la partida.
- Este es el número que aparece en el KPI "Ejecutado" del Dashboard.

### Gasto
```
gt = gastoGPLive + Σ maquinaria + Σ otros_gastos     (NO incluye almacén — ya está en GP)
```
- `gastoGPLive` se resuelve por `gpId` explícito, fallback a match por id de 4 dígitos o por nombre normalizado en el Sheet.
- El GP viene como delta semanal por hoja, se acumula usando años previos como base.

### Margen bruto
```
me = am + almacén                         (donde am = ejecutado en pesos)
margen = me - gt
margen % = margen / me × 100
```
Nivel: ≥20% Bien · 15–20% Normal · 10–15% Aceptable · 5–10% Atención · <5% Crítico.

### Tendencias semanales (histórico)
- Serie por semana ISO 8601, arranca en la semana de inicio del contrato.
- Rangos seleccionables: 4 / 8 / 12 / 26 semanas.
- Métricas: Avance físico (%) · Gasto (delta) · Margen ($).
- Si no hay captura una semana, se **arrastra el último valor conocido**.
- El último punto se ancla al valor del Dashboard para consistencia.

### Proyección de avance y gasto (fin de obra estimado)
- Ritmo semanal = (valor_final − valor_hace_N_semanas) / N, con N = 4 / 8 / 12 (selector).
- **Fin de obra proyectado** = fecha cuando el ejecutado alcanza el 100% del presupuesto al ritmo actual.
- **Margen proyectado al cierre** = presupuesto − gasto proyectado en la fecha de fin.
- Modo "solo gasto" si no hay presupuesto o catálogo capturado (útil para obras nuevas conectadas a GP).

### Snapshots semanales
- Se guardan en `/avance/historial` tras cada cambio de avance (debounce 3 s).
- Cada snapshot contiene el array completo de `subs` con su % en ese momento.
- Permite reconstruir cualquier vista histórica sin depender de tablas de tiempo separadas.

---

## 6. Reporte fotográfico

### Almacenamiento
- **Firebase Storage** bajo la ruta `obras/{obraId}/fotos/{conceptoId}/{fotoId}`.
- Fotos se suben como `data_url` (base64) y se sirven vía `getDownloadURL` (URLs firmadas).
- No hay compresión ni resize del lado cliente — se sube el archivo tal cual lo entrega la cámara/picker.

### Metadatos guardados por foto
- `url` — el download URL de Storage
- `fecha` — ISO date (YYYY-MM-DD) del momento del upload
- Se guardan **inline dentro del documento del concepto** (`sub.fotos: [{url, fecha}]`), no en colección separada.

### Lo que NO existe (importante para el brief)
- **Geolocalización:** no se captura. No hay uso de `navigator.geolocation` ni lectura de EXIF GPS en ningún lugar del código.
- **Sello de tiempo criptográfico:** no. Solo se guarda la fecha en la que se procesó el upload, en el reloj del cliente.
- **EXIF preservado:** no se procesa. Storage guarda el archivo binario tal cual — el EXIF original queda si la cámara lo puso, pero no se extrae ni se muestra en la app.
- **Watermarking / firma:** no.
- **Auditoría de eliminación:** al borrar una foto de un concepto solo se quita del array; el archivo puede quedar huérfano en Storage.

### Consumo
- Se muestran en grid con lightbox al hacer click.
- Aparecen en el PDF ejecutivo (fotos pre-cargadas a base64 antes de invocar jsPDF por limitación async de `addImage`).

---

## 7. Multi-tenancy

**Estado actual: mono-tenant, mono-organización.**

- El sistema está modelado exclusivamente para **FOSMON Construcciones**. Todos los datos viven en un único proyecto Firebase (`campo-fosmon`).
- No hay tabla `organizaciones` ni concepto de "tenant" en el esquema.
- Los **clientes** (TAMSA, SIOP, PEMEX...) existen solo como un campo `cliente` (string libre) dentro de cada obra. Se agrupan en el Panel Ejecutivo para vista de cobranza, pero no tienen identidad propia.
- El **rol `cliente`** permite dar acceso de solo lectura a un usuario externo (ej. contacto en TAMSA) a las obras que se le asignen, pero:
  - No hay branding ni URL por cliente.
  - Un cliente que se asome a Firestore o Storage con las credenciales de un usuario técnicamente vería todo (las reglas actuales son `if request.auth != null`).
  - No hay aislamiento de datos entre clientes.
- Toda la marca visual (logo, colores caliza + crema) está hardcoded a FOSMON.
- La configuración de Firebase (API key, bucket, etc.) está hardcoded en el bundle.

**Para multi-tenant real haría falta:** modelo de organizaciones, prefijos por tenant en todas las rutas (`orgs/{orgId}/obras/...`), reglas Firestore/Storage por `resource.data.orgId == request.auth.token.orgId`, provisioning de usuarios/roles por tenant, y probablemente un proyecto Firebase por tenant o custom claims para el aislamiento.

---

## 8. Autenticación, roles y permisos

### Autenticación
- Firebase Authentication, método email/password únicamente.
- Cloud Function `crearUsuario` (onCall) da de alta el usuario en Auth + crea perfil en Firestore.
- Contraseña temporal enviada por correo manual, cambio de contraseña vía Cloud Function `cambiarPassword` (onCall).
- Sin SSO, sin MFA, sin recuperación automática de contraseña.
- Sesión de Firebase Auth persistente en el navegador.

### Roles

| Rol | Etiqueta UI | Alcance |
|---|---|---|
| `director_general` | Director General | Todas las obras, edita todo |
| `director_operaciones` | Director de Operaciones | Todas las obras, edita todo |
| `gerente_construccion` | Gerente de Construcción | Todas las obras, edita todo |
| `admin_sistema` | Administrador de Sistema | Todas las obras + gestión usuarios |
| `superintendente` | Superintendente de Obra | Solo obras asignadas, edita |
| `residente` | Residente de Obra | Solo obras asignadas, edita |
| `administrador_obra` | Administrador de Obra | Solo obras asignadas, edita |
| `supervisor` | Supervisor de Obra | Solo obras asignadas, **solo lectura** |
| `cliente` | Cliente | Solo obras asignadas, vista reducida |

### Permisos
- Constante `PERMISOS` mapea rol → módulo → acción (`ver` | `editar` | `null`).
- Módulos: `dash`, `captura`, `gastos`, `estimaciones`, `riesgo`, `todas_obras`.
- Override por obra vía `obras/{id}/config/permisos` (para afinar permisos por rol dentro de una obra específica).
- Función `can(rol, modulo, accion)` unifica la consulta.
- Los tabs visibles se controlan por `TABS_POR_ROL`.

### Gestión de usuarios
- CRUD vía Cloud Functions callable (`crearUsuario`, `actualizarUsuario`, `eliminarUsuario`, `listarUsuarios`, `cambiarPassword`). Requieren autenticación y validan rol en el backend.
- La asignación de obras se hace desde la pantalla "Gestión de usuarios" (visible solo para director general, director operaciones, admin sistema).

---

## 9. Deuda técnica y cosas a medias

### Seguridad (alta prioridad)
- **Reglas Firestore/Storage abiertas a cualquier autenticado.** Cualquier usuario logueado puede leer/escribir todos los documentos. Bloquea el onboarding de clientes externos hasta que se apliquen reglas por colección + rol.
- La `apiKey` de Firebase y todo el config están en el bundle (esto es normal para Web SDK, pero acentúa la importancia de las rules).

### Multi-tenancy
- Ver sección 7. El sistema es mono-org; para clientes externos hay que rediseñar.

### Datos
- **Nómina previa (`NOMINA_S18`)** es una constante vacía en el código como placeholder de un módulo antiguo. Todo lo activo vive en `/nomina/historial`.
- **Snapshots viejos de nómina** guardan `totalHE` = importe (pesos), no horas. El Panel Ejecutivo tiene fallback para recalcular, pero conviene migrar.
- **Snapshots viejos de nómina TAMSA** tienen `dias` en horas (55h) sin normalizar. El display tiene un helper `diasReales` con heurística de 11h/día para no re-subir.

### Módulos incompletos o pausados
- **Órdenes de Trabajo (`src/ot.jsx`):** en pausa, esperando versión final del cliente TAMSA.
- **FLOTA (control de vehículos/equipos):** en espera de plantilla de Cano.
- **Módulo Nómina real:** funciona con carga de Excel semanal, pero los KPIs a nivel obra individual todavía dependen del array snapshot; falta gráfica evolutiva por obra estilo Tendencias.
- **Comparativo entre obras:** no existe.
- **Panel de salud admin:** falta.
- **Bitácora:** existe la colección `/bitacora`, la UI es básica.
- **Rama `claude/minimalista`:** experimento de UI minimalista, en pausa.

### Notificaciones
- **Push notifications FCM (nativas al teléfono):** no implementadas. Hoy solo hay campanita interna dentro de la app.
- **Alertas por email al cambiar nivel de obra:** no existen.
- El sistema de notificaciones internas sí funciona (colección `notificaciones/{uid}/items` con listener real-time).

### Datos externos (GP Construct)
- Depende de un Google Sheet público. Si cambia el layout del sheet, se rompe el parser (`parseGP` en `functions/index.js`).
- El refresh es diario a las 8am; hay botón manual para forzar refresh desde la UI (admin).
- Fórmulas semanales del sheet guardan **deltas** por semana del año actual + acumulado por año previo. El código en `TendenciasMensuales` reconstruye acumulados desde esos deltas.

### Frontend
- **Monolito `src/App.jsx` ~15,000 líneas.** Iterar es rápido pero code split y testing son duros. No hay tests.
- No hay separación de componentes en archivos, no hay TypeScript, no hay lint estricto (hay `eslint.config.js` pero no está integrado al CI).
- `pdfjs-dist` está como dependencia npm pero muchas librerías se cargan por CDN al vuelo (`jsPDF`, `xlsx`). Convención inconsistente.

### Backend
- **Sin tests.** Las Cloud Functions no tienen suite.
- El backup semanal a Firestore (`backupSemanalFirestore`) existe pero conviene revisar destino y retención.
- Los recordatorios de captura (Cloud Functions programadas) crean notificaciones internas pero no envían email/push.

### UX / operación
- Los IDs de obra son strings arbitrarios (mezcla de códigos "0125", "MALECON", etc.) — no hay convención estricta.
- Cambios grandes en el catálogo pueden desincronizar con snapshots viejos si las claves cambian (se preserva por clave coincidente, pero si el residente cambia la clave se pierde el histórico).
- La generación del PDF ejecutivo carga fotos síncronas — puede tardar varios segundos en obras con muchas fotos.

---

## Cloud Functions activas (referencia rápida)

| Función | Trigger | Propósito |
|---|---|---|
| `crearUsuario` | onCall | Alta de usuario en Auth + Firestore |
| `actualizarUsuario` | onCall | Editar rol / obras / activo |
| `eliminarUsuario` | onCall | Baja lógica y de Auth |
| `cambiarPassword` | onCall | Reset de contraseña |
| `listarUsuarios` | onCall | Lista completa (para GestionUsuarios) |
| `actualizarGPSheet` | onSchedule (8:00 diario) | Refresh del cache GP desde el Sheet |
| `refrescarGP` | onCall | Refresh manual del cache GP |
| `resumenSemanalEmail` | onSchedule | Envío de resumen semanal (revisar destino/estado) |
| `probarResumenSemanal` | onCall | Trigger manual para pruebas |
| `backupSemanalFirestore` | onSchedule | Backup semanal (revisar destino) |
| `probarBackup` | onCall | Trigger manual para pruebas |
| `recordatorioCapturaObra` | onSchedule (viernes 10:00) | Notif interna a residentes sin captura |
| ~~`recordatorioCapturaSubs`~~ | — | Retirado 2026-09-22 con el histórico de subs: pedía un cierre que el sistema no puede registrar (PENDIENTES #31) |
| `recordatorioLunes` | onSchedule (lunes 9:00) | Notif de pendientes acumulados |

Todas las Cloud Functions v2 requieren plan Blaze. Si el proyecto se baja a Spark, se caen `crearUsuario` y todo el resto (síntoma: error `internal` al gestionar usuarios).
