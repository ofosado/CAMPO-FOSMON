# CAMPO — Documento de Contexto para Claude Code
## Control de Avance, Maquinaria, Personal y Obra
### FOSMON Construcciones — Última actualización: Mayo 2026

---

## 1. QUÉ ES CAMPO

App web React (SPA + PWA) para gestión integral de obras de construcción de FOSMON. Reemplaza el flujo manual de Excel + WhatsApp con control centralizado, multi-usuario, multi-obra y por roles.

**URL producción:** https://campo-fosmon.netlify.app
**Repositorio:** https://github.com/ofosado/CAMPO-FOSMON
**Deploy:** Netlify (auto-deploy desde GitHub `main`)
**Archivo principal:** `src/App.jsx` (~9,000 líneas, single-file deliberado para iterar rápido)
**Cloud Functions:** `functions/index.js`

---

## 2. STACK TECNOLÓGICO

```
Frontend
- React 18 + Vite 4.4.5
- CSS-in-JS inline (sin Tailwind ni CSS externo)
- vite-plugin-pwa (manifest + service worker workbox)
- jsPDF 2.5.1 + jsPDF-autoTable 3.8.2 (CDN dinámico)
- SheetJS (CDN dinámico para parseo Excel)

Backend (Firebase / Google Cloud)
- Auth (email/password, JWT)
- Firestore (NoSQL documental)
- Storage (fotos + documentos)
- Cloud Functions Gen 2 (Node 20, región us-central1)
- Plan: Blaze (pay-as-you-go), uso ~$0/mes

Integración externa
- Google Sheets (GP Construct) vía CSV export público

DevOps
- GitHub Desktop → push a main → webhook → Netlify auto-deploy (~2 min)
- Firebase CLI desde Mac local para Cloud Functions
```

**Firebase config:**
```js
const firebaseConfig = {
  apiKey: "AIzaSyDCKc0ymTK_PX8_20xrMnsyhLtGyLWmlek",
  authDomain: "campo-fosmon.firebaseapp.com",
  projectId: "campo-fosmon",
  storageBucket: "campo-fosmon.firebasestorage.app",
  messagingSenderId: "737456981212",
  appId: "1:737456981212:web:96980bd464a382d620e019",
};
```

---

## 3. USUARIOS Y ROLES

| Email | Rol | Notas |
|-------|-----|-------|
| ofosado@fosmon.com.mx | director_general | Oscar Fosado Monsalvo |
| ofosadog@fosmon.com.mx | director_operaciones | Oscar Fosado Galland |
| aoliva@fosmon.com.mx | gerente_construccion | Alejandro Noe Oliva Somellera |
| pcastillo@fosmon.com.mx | administrador_obra | Pablo Castillo Villalobos |
| lmayo@fosmon.com.mx | admin_sistema | Luis Mayo · gestión usuarios + diagnóstico GP |

**Permisos por rol** (definidos en `PERMISOS` y `TABS_POR_ROL`):

| Rol | Ve todas las obras | Captura avance | Edita gastos/estim | Gestiona usuarios |
|-----|--------------------|-----------------|---------------------|-------------------|
| director_general | ✅ | ❌ | Solo ver | ✅ |
| director_operaciones | ✅ | ✅ | ✅ | ✅ |
| gerente_construccion | ✅ | ✅ | Solo ver | ❌ |
| administrador_obra | Solo asignadas | ✅ | ✅ | ❌ |
| admin_sistema | ✅ | ❌ | Solo ver | ✅ |
| cliente | Solo asignadas | ❌ | ❌ | ❌ |

---

## 4. ARQUITECTURA DEL APP — NAVEGACIÓN

### Flujo principal
```
Login → PantallaObras (con Panel Ejecutivo si rol directivo) → entrar a obra → 4 tabs principales
```

### 4 tabs principales en cada obra
1. **Dashboard** — vista ejecutiva con KPIs, riesgos detectados automáticamente, secciones clickables a su tab
2. **Operación** — sub-tabs para reportes semanales: Resumen · Avance físico · Almacén · Maquinaria · Nómina · Estimaciones · Subcontratos
3. **Gastos** — análisis enriquecido de GP Construct con 4 sub-tabs: Resumen · Proveedores · Rubros · Tendencia semanal (+ panel diagnóstico para admin_sistema)
4. **Planeación** — sub-tabs: Contrato · Presupuesto

### Tab cliente (solo rol cliente)
- Avance · Fotos · Estimaciones (sin amortizaciones internas) · Plazos

### Vista global (no es tab)
- **Usuarios** — gestión de usuarios (solo DG, DO, admin_sistema)
- **Panel Ejecutivo** — cobranza por cliente y obras de atención (solo directivos, en PantallaObras)

### Componentes principales
- `App` — root, auth, navegación, listeners de notif y datos bulk
- `Login` — Firebase Auth + auto-creación de perfil en Firestore
- `PantallaObras` — lista de obras + Panel Ejecutivo arriba para directivos
- `PanelEjecutivo` — cobranza agrupada por cliente + top obras de atención
- `Dashboard` — KPIs principales, banner de riesgos detectados, secciones clickables
- `BannerRiesgos` — muestra riesgos automáticos categorizados por severidad
- `Operacion` — wrapper con sub-tabs de operación semanal
- `MiniDashAvance` / `MiniDashAlmacen` / `MiniDashMaquinaria` / `MiniDashNomina` / `MiniDashEstimaciones` / `MiniDashSubcontratos` — mini-dashboards por módulo
- `Captura` — reusable para Volúmenes/Maquinaria/Materiales/Nómina (con `forceTab`)
- `Nomina` — captura nómina semanal
- `Estimaciones` — CRUD estimaciones (con triggers de notif al cambiar estatus)
- `Subcontratos` + `DetalleSubcontrato` — CRUD + catálogo + fotos + pagos + import Excel/PDF + validador de monto
- `Planeacion` — wrapper con sub-tabs Contrato + Presupuesto
- `Contrato` — datos contractuales + plazos + ampliaciones + repositorio documentos + días de pago
- `Presupuesto` — parser Excel/CSV de catálogo
- `GastosGP` — análisis de proveedores/rubros/tendencias + diagnóstico oculto
- `GestionUsuarios` — CRUD usuarios via Cloud Functions (callable)
- `CentroNotificaciones` — campanita con dropdown en header (listener real-time)
- `AvanceCliente` / `FotosCliente` / `EstimacionesCliente` / `PlazosCliente` — vistas para rol cliente

---

## 5. FIRESTORE — ESTRUCTURA DE DATOS

```
usuarios/{emailNormalizado}
  fields: email, nombre, rol, obras_asignadas[], activo, uid,
          creadoEn, creadoPor

obras/{obraId}                      ← doc top-level (necesario para listar)
  fields: id, nombre, contrato, cliente, presupuesto, estado, ...
  /config/info                     ← duplica datos (compatibilidad)
  /config/parametros               ← %Anticipo, FG, Retención
  /config/estimaciones             ← {data: [...]}
  /config/catalogo                 ← catálogo de conceptos parseado
  /avance/subs                     ← {data: [{sec, a}]} avance por subsección
  /avance/maquinaria               ← {data: [...]} maquinaria propia
  /avance/materiales               ← {data: [...]} almacén/tránsito
  /avance/historial                ← {semanas: [...]} snapshots semanales
  /nomina/historial                ← {semanas: [...]} nómina semanal
  /contrato/plazos                 ← {ampliaciones: [...]}
  /contrato/documentos             ← {lista: [...]}
  /subcontratos/lista              ← {items: [...]} subcontratos con catálogo/pagos/fotos/adjunto

global/
  historial_obras                  ← obras archivadas (snapshots)
  gp_construct                     ← cache de Sheet GP

notificaciones/{uid}/items/{notifId}
  fields: categoria, tipo, titulo, mensaje, link{tab,subTab,obraId},
          leida, archivada, fecha, creadaPor
```

**Reglas Firestore (estado actual):**
```js
allow read, write: if request.auth != null;
```
⚠️ **Deuda técnica:** falta endurecer con reglas por colección y rol antes de meter clientes externos.

### Helpers globales
```js
fsGet(path)         // lee documento
fsSet(path, data)   // escribe (merge)
fsDel(path)         // elimina
fsColl(path)        // lista documentos de colección
crearSnapshotAvance(obraId, subs, capturadoPor, tipo)
crearNotifPara(uids, payload)
notifARoles(roles, payload)
notifAEmail(email, payload)
detectarRiesgos(contexto)         // motor de la biblioteca
calcularKPIsObra(obra, subs, ...) // KPIs reutilizables
```

---

## 6. PALETA DE COLORES (TEMA CLARO)

```js
const C = {
  bg:      "#F0F2F5",   // fondo gris suave (BBVA-inspired)
  surface: "#FFFFFF",   // cards
  border:  "#E8EAF0",
  caliza:  "#0D1619",   // negro principal
  textPri: "#0D1619",
  textSec: "#555E6B",
  textMut: "#9AA0AC",
  green:   "#639922",  greenDk:"#3B6D11",
  red:     "#E24B4A",  redDk:"#A32D2D",
  blue:    "#378ADD",  blueDk:"#185FA5",
  yellow:  "#EF9F27",  yellowDk:"#854F0B",
  purple:  "#7F77DD",  purpleDk:"#3C3489",
  orange:  "#D97706",
};
```

**Reglas visuales:** sin emojis, fondo gris claro, cards blancas, tipografía compacta. Inspirado en BBVA.

---

## 7. OBRAS Y SHEET GP CONSTRUCT

### Sheet GP Construct
- **ID:** `1UaRI7ysMttXvET9I6hXPJAqadUYRd0Y0Qiwy8uRi82c`
- **URL:** https://docs.google.com/spreadsheets/d/1UaRI7ysMttXvET9I6hXPJAqadUYRd0Y0Qiwy8uRi82c
- **Mantenedor:** Luis Mayo, actualiza cada lunes
- **Acceso:** "Cualquiera con el enlace puede ver" (público)
- **Método:** CAMPO descarga el CSV directo (sin OAuth), parser detecta:
  - Años (`y_2024`, `y_2025`)
  - Meses 2026 (`m_2026_01` … `m_2026_12`)
  - Semanas (`w_14` … `w_53`)
  - Total 2026 y Grand Total

### Estructura del Sheet
```
EGRESOS
├── 0001 OFICINA CENTRAL (4 dígitos = obra)
│   ├── 100 MATERIALES (3 dígitos = rubro)
│   │   ├── HOME DEPOT MEXICO ... (texto = proveedor)
│   │   └── CASPER S.A. DE C.V.
│   └── 200 ...
└── 0114 OAXACA PARQUE LINEAL 0825
    └── ...
```

### Creación de obras en CAMPO
- ❌ Ya no hay obras hardcodeadas
- ✅ Al crear obra, modal lista las obras del Sheet de GP — se selecciona y completa datos
- ✅ Si una obra de CAMPO no se mapea automáticamente con GP, hay selector manual `gpId` en Contrato

---

## 8. GENERADOR DE PDF

Función `generarPDFObra(obra, subs, estimaciones, maquinaria, materiales, subcontratos)` al inicio de App.jsx.

**Librerías:** jsPDF 2.5.1 + autoTable 3.8.2 cargados dinámicamente desde CDN.

**Páginas:**
1. Portada con logo, datos contrato, 4 KPIs
2. Resumen financiero con 6 KPIs, datos contrato, gasto por rubro
3. Avance físico — tabla subsecciones con barras, almacén, maquinaria
4. Proyección — gráfica lineal, ritmos y plazos
5. Personal — KPIs, top 5 nómina, top 5 proveedores
6. Riesgo — 7 indicadores, observaciones
7-8. Fotografías + firmas
9+. **Una página por cada subcontrato** (nuevo) — datos, catálogo, pagos

**Dimensiones:** Letter landscape (279×216mm), márgenes ML=MR=14mm, CW=251mm.

**Reglas críticas de jsPDF-autoTable:**
- NUNCA usar Spacer ni Table como celda de tabla
- Siempre especificar `margin:{left:x, right:PW-x-tableW}` con `tableWidth` exacto
- Las columnas DEBEN sumar exactamente CW (251mm)
- Para 2 columnas paralelas: `x` explícito + `Math.max(yIzq, yDer)`
- Barras de progreso: dentro de `didDrawCell`

---

## 9. CLOUD FUNCTIONS (gestión de usuarios)

5 funciones HTTPS Callable en `functions/index.js`:

| Función | Qué hace |
|---------|----------|
| `crearUsuario` | Crea en Firebase Auth + escribe perfil en Firestore |
| `actualizarUsuario` | Cambia rol, nombre, obras_asignadas, activo |
| `eliminarUsuario` | Borra de Auth y Firestore |
| `cambiarPassword` | Admin resetea contraseña de otro usuario |
| `listarUsuarios` | Devuelve lista combinada (Firestore + estado Auth) |

**Guard:** todas verifican que el llamador tenga rol `director_general`, `director_operaciones` o `admin_sistema` consultando su perfil en Firestore.

**Deploy:** `firebase deploy --only functions` desde Mac local.

---

## 10. SISTEMA DE NOTIFICACIONES (in-app)

**Centro de notificaciones:** campana en header con badge de no leídas + dropdown con histórico.

**6 categorías:** actividad · financiero · riesgo · plazo · gestion · resumen

**Disparadores actuales:**
| Evento | Destinatarios |
|--------|---------------|
| Nueva estimación / cambio estatus | DG · DO · admin_sistema |
| Nuevo subcontrato + pago registrado | DG · DO · admin_sistema |
| Nueva obra creada | DG · DO · admin_sistema |
| Cierre semanal oficial | DG · DO · GC · admin_sistema |
| Usuario nuevo creado | Usuario nuevo + DG |
| Cambio de rol / asignación obra / desactivación | Usuario afectado |

**Auto-archivado:** notif > 30 días se ocultan automáticamente.

---

## 11. BIBLIOTECA DE RIESGOS (sistema activo)

**Constante:** `BIBLIOTECA_RIESGOS` en App.jsx — array de plantillas con `detect(contexto)`.

**Categorías:** financiero · cobranza · plazo · avance · nomina · materiales · maquinaria · subcontratos · contractual · compliance

**Severidades:** bajo · medio · alto · critico

**Motor:** `detectarRiesgos(contexto)` evalúa todos los detectores y devuelve los que disparen, ordenados por severidad.

**~30 riesgos iniciales** detectan automáticamente:
- Margen crítico, brecha gasto-avance, atrasos de cobro, anticipo no recuperado
- Velocidad de quema insostenible, concentración de proveedores
- Anomalías de gasto, proveedores nuevos / inactivos / con incremento súbito
- Plazo vencido, próximo a vencer, no terminará en plazo
- Frentes sin iniciar, partidas estancadas, partidas con retroceso
- Avance vs plazo desbalanceado, horas extra excesivas
- Material en tránsito/fabricación, costo maquinaria alto
- Subs desfasados, catálogo no cuadrado, pagos programados
- Falta diasPago, falta gpId, sin presupuesto, sin cierres semanales

**Integración:**
- `BannerRiesgos` en Dashboard muestra los detectados (críticos+altos por defecto, expandible)
- Click en riesgo → navega al tab correspondiente
- Arquitectura preparada para llegar a 100 plantillas sin tocar el motor

---

## 12. HISTÓRICO SEMANAL DE AVANCE

**Captura híbrida:**
- Guardado normal de avance → snapshot `intermedio` automático
- Botón "Cerrar semana oficialmente" → snapshot `oficial` con doble confirmación + notif a directivos

**Almacenamiento:** `obras/{id}/avance/historial = { semanas: [...] }` (máx 52 semanas rolling).

**MiniDashAvance:**
- 5 KPIs: avance actual, esta semana (Δpp), velocidad promedio, proyección de fin, avance ideal
- 3 detectores visuales: partidas con mayor avance, estancadas, con retroceso
- **Curva S** (gráfica SVG): avance real vs programado lineal sobre el plazo contratado

---

## 13. PWA

- `vite-plugin-pwa` con `registerType: 'autoUpdate'`
- Manifest: icons 192/512/maskable, theme color caliza
- Service Worker con Workbox: CacheFirst para CDNs, NetworkFirst para Firestore (5s fallback)
- Instalable en iOS (Compartir → Agregar), Android (Chrome banner), Desktop (Chrome/Edge)
- Offline parcial: UI sin red, captura requiere conexión (Nivel B pendiente)

---

## 14. DECISIONES DE DISEÑO

| Decisión | Detalle |
|----------|---------|
| Single-file App.jsx | Iteración rápida, evita ceremonia de imports. Re-evaluar al llegar a ~10k líneas |
| Sin emojis | App seria (industria construcción) |
| Sin auto-guardado | Botón explícito evita errores |
| Tema claro inspirado en BBVA | Fondo gris suave, cards blancas |
| Sub-tabs vs tabs nuevos | Mejor agrupar en 4 tabs principales con sub-tabs internos |
| Dashboard clickable | Cada sección lleva al detalle de su tab (no duplica) |
| Mini-dashboards | Cada sub-tab de Operación tiene KPIs propios arriba |
| Avance = avance ponderado + almacén | Para "Monto ejecutado" |
| Subcontratos = avance físico Y financiero | Físico = catálogo ejecutado, financiero = monto pagado al sub |
| Notif para acciones, no para todo | Solo se notifica lo que requiere atención de alguien |

---

## 15. PENDIENTES PRIORIZADOS

### 🔴 Próxima sesión
1. **Push notifications con Firebase Cloud Messaging** — para que notif lleguen al celular sin abrir CAMPO
2. **Reglas Firestore granulares** — endurecer antes de meter clientes externos (hoy `auth != null`)

### 🟡 Acción del usuario (consolas)
3. **Backups automáticos Firestore** — activar en Firebase Console
4. **Dominio campo.fosmon.com.mx** — CNAME en DNS + verificación en Netlify

### 🟢 Cuando haya datos suficientes
5. **Preferencias de notif por usuario** — cuando haya muchos usuarios
6. **Resumen semanal automático** (lunes 8am, viernes 5pm) — requiere Cloud Scheduler

### 🔵 Largo plazo
7. **Captura offline real (Nivel B PWA)** — IndexedDB + cola de sync (proyecto solo)
8. **Bitácora digital** — protección legal
9. **Panel de proveedores históricos** — comparativo cross-obra
10. **IA en fotos** — detección automática de avance (2-3 años)
11. **BIM ligero** — vincular conceptos con modelo 3D
12. **Firma electrónica NOM-151** — validez legal estimaciones

---

## 16. CÓMO TRABAJAR CON EL APP

### Editar código
1. Editar `src/App.jsx`
2. GitHub Desktop → Commit → Push
3. Netlify auto-deploy en ~2 min

### Cloud Functions
```bash
cd CAMPO-FOSMON
firebase deploy --only functions
```

### Probar localmente
```bash
npm install
npm run dev
```

### Acceso a consolas
- Firebase: https://console.firebase.google.com/project/campo-fosmon
- Netlify: https://app.netlify.com/sites/campo-fosmon
- Google Cloud: https://console.cloud.google.com/?project=campo-fosmon
- GitHub: https://github.com/ofosado/CAMPO-FOSMON

---

## 17. NOTAS IMPORTANTES PARA CLAUDE CODE

1. **Todo el frontend en `src/App.jsx`** (~9,000 líneas). Cloud Functions en `functions/index.js`.

2. **El PDF usa jsPDF dinámico via CDN** — no en package.json. Función `generarPDFObra` al inicio del archivo.

3. **`NOMINA_S18`, `CATALOGO`, `EMB_WHITE`, `EMB_NEGRO`** están hardcodeados en base64 / array. No tocar a menos que sea necesario.

4. **`_OBRAS_BASE` está vacío** — las obras se crean desde GP a través del app.

5. **Firestore en modo permisivo** (`auth != null`) — pendiente endurecer.

6. **iCloud Drive + GitHub** — el repo está en iCloud. Puede haber delay de sync.

7. **Netlify build:** `npm run build`. Si falla, revisar errores de sintaxis JSX.

8. **Variables críticas que NO duplicar:**
   - `puedeEliminar`, `puedeGestionar` (solo en PantallaObras)
   - Cualquier `const` dentro de componentes

9. **Para meter nuevos riesgos:** agregar al array `BIBLIOTECA_RIESGOS` con `id`, `categoria`, `titulo`, `descripcion`, `tab`, `subTab`, `detect(contexto)`. El motor los recoge automáticamente.

10. **Para meter nuevos disparadores de notif:** usar `notifARoles([...], payload)` o `notifAEmail(email, payload)` desde cualquier handler.

---

*Documento actualizado — Mayo 2026*
*Para continuar el desarrollo, comparte este archivo al inicio de cada sesión con Claude Code.*
