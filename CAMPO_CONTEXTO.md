# CAMPO — Documento de Contexto para Claude Code
## Control de Avance, Maquinaria, Personal y Obra
### FOSMON Construcciones — Mayo 2026

---

## 1. QUÉ ES CAMPO

App web React para gestión de obras de construcción. Desarrollada para FOSMON Construcciones como herramienta interna. Reemplaza el flujo de Excel + WhatsApp que usaban antes.

**URL producción:** https://cosmic-chimera-ed4c12.netlify.app  
**Repositorio:** GitHub → cuenta Oscar Fosado → repo `CAMPO-FOSMON`  
**Deploy:** Netlify (auto-deploy desde GitHub main)  
**Archivo principal:** `src/App.jsx` (~4,980 líneas, todo en un solo archivo)

---

## 2. STACK TECNOLÓGICO

```
Frontend:    React + Vite 4.4.5
Estilos:     CSS-in-JS (style objects inline, sin Tailwind ni CSS externo)
Base datos:  Firebase Firestore (proyecto: campo-fosmon)
Auth:        Firebase Authentication (email/password)
Storage:     Firebase Storage (fotos de obra)
Deploy:      Netlify
PDF:         jsPDF 2.5.1 + jsPDF-AutoTable 3.8.2 (cargados dinámicamente desde CDN)
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

| Email | Nombre | Rol | Contraseña |
|-------|--------|-----|-----------|
| ofosado@fosmon.com.mx | Oscar Fosado Monsalvo | director_general | (cambiada) |
| ofosadog@fosmon.com.mx | Oscar Fosado Galland | director_operaciones | (cambiada) |
| aoliva@fosmon.com.mx | Alejandro Noe Oliva Somellera | gerente_construccion | Fosmon2026! |
| pcastillo@fosmon.com.mx | Pablo Castillo Villalobos | administrador_obra | Fosmon2026! |

**Tabs por rol:**
```
director_general:     Dashboard, Gastos GP, Estimaciones, Riesgo, Contrato
director_operaciones: Dashboard, Capturar avance, Gastos GP, Estimaciones, Riesgo, Presupuesto, Contrato
gerente_construccion: Dashboard, Capturar avance, Gastos GP, Estimaciones, Riesgo, Presupuesto, Contrato
administrador_obra:   Dashboard, Capturar avance, Gastos GP, Estimaciones, Riesgo, Contrato
```

---

## 4. ARQUITECTURA DEL APP

### Flujo de pantallas
```
Login → PantallaObras → [selecciona obra] → ObraScreen (tabs)
```

### Componentes principales
- `App` — root, maneja auth y navegación global
- `Login` — Firebase Auth, fallback a ROLES_DEFAULT hardcodeado
- `PantallaObras` — lista de obras con tarjetas, crear/archivar/eliminar
- `ObraScreen` — contenedor de tabs según rol
- `Dashboard` — 6 KPIs, gráfica proyección SVG, avance por subsección, estimaciones, riesgo, top nómina, top proveedores, fotos
- `CapturarAvance` — 4 tabs: Volúmenes, Maquinaria, Almacén, Nómina
- `GastosGP` — datos de Google Sheets via CORS proxy, cache en Firestore
- `Estimaciones` — CRUD estimaciones con estados
- `Riesgo` — 7 indicadores semáforo
- `Presupuesto` — parser Excel/CSV, solo DO y GC
- `Contrato` — datos contrato + plazos/ampliaciones + repositorio documentos

### Átomos de UI (funciones helper)
```js
Card({children, style, accent})     // tarjeta blanca con sombra
Kpi({label, value, sub, color})     // KPI compacto con borde izquierdo
Bar({pct, color})                   // barra de progreso
Bdg({children, color, small})       // badge/pill de color
Inp({...props})                     // input estilizado
Sel({children, ...props})           // select estilizado
PrimaryBtn({children, onClick})     // botón azul primario
SecBtn({children, onClick})         // botón secundario
EmblemaFOSMON({size, dark, opacity}) // logo FOSMON como img base64
```

---

## 5. PALETA DE COLORES (TEMA CLARO)

```js
const C = {
  bg:      "#F0F2F5",   // fondo gris muy suave
  surface: "#FFFFFF",   // cards y superficies
  card:    "#FFFFFF",
  border:  "#E8EAF0",
  borderM: "#D0D4DC",
  caliza:  "#0D1619",   // negro principal
  textPri: "#0D1619",
  textSec: "#555E6B",
  textMut: "#9AA0AC",
  green:   "#639922",   greenBg:"#EAF3DE", greenDk:"#3B6D11",
  red:     "#E24B4A",   redBg:  "#FCEBEB", redDk:  "#A32D2D",
  blue:    "#378ADD",   blueBg: "#E6F1FB", blueDk: "#185FA5",
  yellow:  "#EF9F27",   yellowBg:"#FAEEDA",yellowDk:"#854F0B",
  purple:  "#7F77DD",   purpleBg:"#EEEDFE",purpleDk:"#3C3489",
  orange:  "#D97706",
  pink:    "#F43F5E",
  indigo:  "#6366F1",
};
```

**Inspiración visual:** BBVA — fondo gris claro, cards blancas, tipografía compacta.  
**Sin emojis** — app seria y profesional.

---

## 6. FIRESTORE — ESTRUCTURA DE DATOS

```
obras/{id}/
  config/info          → datos básicos de la obra
  config/parametros    → % anticipo, % FG, etc.
  config/estimaciones  → estimaciones al cliente
  config/catalogo      → catálogo de conceptos
  avance/subs          → avance por subsección
  avance/maquinaria    → maquinaria propia
  avance/materiales    → materiales en almacén/tránsito
  nomina/historial     → nómina semanal
  contrato/plazos      → plazos y ampliaciones
  contrato/documentos  → repositorio de documentos

global/
  historial_obras      → archivo de obras
  gp_construct         → cache de Google Sheets GP
  historial_obras/eliminadas/{id}  → obras eliminadas permanentemente
```

**⚠️ IMPORTANTE:** Firestore está en modo TEST (expira pronto). Pendiente configurar reglas de seguridad.

### Funciones de acceso
```js
fsGet(path)        → lee documento
fsSet(path, data)  → escribe documento (merge)
fsDel(path)        → elimina documento
```

---

## 7. OBRA DE REFERENCIA — OAXACA PARQUE LINEAL

```
ID:            OAX01
Nombre:        Oaxaca Parque Lineal 0825
Contrato:      IE-SIC/SSOP/UL-X010-2026
Cliente:       Gobierno del Estado de Oaxaca
Presupuesto:   $163,348,337
Superintendente: Ing. Eduardo Botello Vázquez
Administrador: L.C. Pablo Castillo Villalobos
Inicio:        2026-05-01
Fin:           2026-08-28
```

**Catálogo (SUBS_INIT):** 10 subsecciones reales del ANEXO 15
**Nómina (NOMINA_S18):** 66 trabajadores (57 directos / 9 indirectos) hardcodeados en base64

---

## 8. GP CONSTRUCT — INTEGRACIÓN

- **Fuente:** Google Sheets (Luis Mayo actualiza cada lunes)
- **Sheet ID:** `1UaRI7ysMttXvET9I6hXPJAqadUYRd0Y0Qiwy8uRi82c`
- **Método:** CORS proxy → cache en Firestore `global/gp_construct`
- **Catálogo hardcodeado:** 29 obras GP como fallback si el Sheet no carga

---

## 9. GENERADOR DE PDF

Función `generarPDFObra(obra, subs, estimaciones, maquinaria, materiales)` al inicio de App.jsx (~800 líneas).

**Librerías:** jsPDF 2.5.1 + autoTable 3.8.2, cargadas dinámicamente desde CDN.

**8 páginas:**
1. Portada — logo, datos contrato, 4 KPIs
2. Resumen financiero — 6 KPIs, datos contrato, gasto por rubro, estimaciones
3. Avance físico — tabla subsecciones con barras, almacén, maquinaria
4. Proyección — gráfica lineal, tablas ritmo y plazos
5. Personal — KPIs, top 5 nómina, top 5 proveedores, maquinaria
6. Riesgo — 7 indicadores, observaciones
7. Fotografías (1 de 2)
8. Fotografías (2 de 2) + firmas

**Dimensiones:** Letter landscape (279×216mm), ML=MR=14mm, HDR=14mm, FTR=10mm, CW=251mm

**Regla crítica de jsPDF-autoTable:**
- NUNCA `Spacer` ni `Table` como celda de tabla
- SIEMPRE especificar `margin:{left:x, right:PW-x-tableW}` con `tableWidth` exacto
- Las columnas DEBEN sumar exactamente CW (251mm) o se desbordan
- Para 2 columnas paralelas: usar `x` explícito en cada tabla, luego `Math.max(yIzq, yDer)`
- Barras de progreso: SIEMPRE dentro de `didDrawCell`, nunca en coordenadas manuales

**Campos reales de los datos:**
```js
materiales: { id, desc, concepto, vol, und, pu, imp }  // NO mat/conc/estado
maquinaria: { id, desc, vol, und, pu, imp }             // NO equipo/nombre/cant
```

**Helper autoT:** wrapper de doc.autoTable con merge correcto de columnStyles.
**Estimaciones activas:** `estimaciones.filter(e=>e.no&&e.monto>0)` — filtra filas vacías.

---

## 10. DECISIONES DE DISEÑO IMPORTANTES

| Decisión | Detalle |
|----------|---------|
| Sin emojis | App seria, industria construcción |
| Tema claro | Inspirado en BBVA, fondo #F0F2F5 |
| Sin auto-guardado | Puede causar errores, solo botón explícito |
| Logo FOSMON | `dark={true}` en header/footer (fondo blanco), `dark={false}` en login (fondo oscuro) |
| Ratio emblema | 447×516px → en PDF: `addImage(EMB_WHITE,'PNG',x,y,6.9,8)` |
| Saludo usuario | `Hola, {primer_nombre}!` — busca primer token >2 chars sin punto |
| Obras eliminadas | localStorage por UID + Firestore historial. Persiste hasta integración completa |
| Ampliaciones en gráfica | Solo aparecen si hay ampliaciones registradas en Contrato |
| Avance "Monto ejecutado" | = avance ponderado + almacén (NO solo avance físico) |

---

## 11. BUGS CONOCIDOS / RESUELTOS

| Bug | Estado | Solución |
|-----|--------|----------|
| `puedeEliminar` no definido en PantallaObras | ✅ Resuelto | Declarado dentro del scope correcto |
| `estPorCob`, `estProc`, `estTotal` undefined | ✅ Resuelto | Variables añadidas en Dashboard |
| `puedeEliminar` declarado dos veces | ✅ Resuelto | Duplicado eliminado |
| Logo FOSMON invisible (blanco sobre blanco) | ✅ Resuelto | dark prop correcta por contexto |
| PDF: columnas desbordadas | ✅ Resuelto | Suma exacta CW en todas las tablas |
| PDF: texto transparente en filas alternas | ✅ Resuelto | alternateRowStyles con textColor explícito |
| PDF: Spacer como celda de tabla | ✅ Resuelto | Reemplazado por rowHeights y padding |
| Estatus estimaciones no coincide | ✅ Resuelto | normEst() normaliza sin acentos/mayúsculas |
| fotos es objeto {} no array | ✅ Resuelto | `Array.isArray(s.fotos)?s.fotos:Object.values(s.fotos||{})` |
| Obras eliminadas reaparecen | ⚠️ Parcial | localStorage por UID, solución completa requiere Firestore rules |

---

## 12. PENDIENTES PRIORIZADOS

### 🔴 URGENTE
1. **Reglas de seguridad Firestore** — modo test expira. Reglas necesarias:
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```
   Ir a Firebase Console → Firestore → Rules → Publicar.

### 🟡 SIGUIENTE SPRINT
2. **PWA + captura offline** — mayor impacto operativo en campo
3. **Dashboard multi-obra** — valor para Director General
4. **Alertas push** — convierte app en sistema activo
5. **Backups automáticos Firestore** — activar en Firebase Console
6. **Dominio campo.fosmon.com.mx** — CNAME en DNS apuntando a Netlify

### 🟢 MEJORAS FUTURAS
7. **Bitácora digital** — protección legal, diferenciador comercial
8. **Control de subcontratistas** — módulo independiente
9. **Curva S** — comparativo programado vs real
10. **Panel de usuarios** — crear/resetear contraseñas desde CAMPO (Cloud Functions)
11. **Google Sheets automático** — sin CORS proxy
12. **IA en fotos** — detección automática de avance (2-3 años)
13. **BIM ligero** — vincular conceptos con modelo 3D
14. **Firma electrónica NOM-151** — estimaciones con validez legal

---

## 13. ESTRUCTURA DEL REPO

```
CAMPO-FOSMON/
├── src/
│   └── App.jsx          ← TODO el código React (4,980 líneas)
├── public/
├── index.html
├── package.json
├── vite.config.js
└── netlify.toml
```

**package.json clave:**
```json
{
  "dependencies": {
    "firebase": "^10.x",
    "react": "^18.x",
    "react-dom": "^18.x"
  },
  "devDependencies": {
    "vite": "4.4.5",
    "@vitejs/plugin-react": "^4.x"
  }
}
```

---

## 14. CÓMO TRABAJAR CON EL APP

### Para hacer cambios
1. Editar `src/App.jsx`
2. GitHub Desktop → Commit → Push
3. Netlify auto-despliega en ~2 minutos

### Para probar localmente
```bash
cd CAMPO-FOSMON
npm install
npm run dev
```

### Para subir con Claude Code
```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/Fosmon\ Cloud/CAMPO-FOSMON
claude
```

---

## 15. NOTAS IMPORTANTES PARA CLAUDE CODE

1. **Todo el app está en un solo archivo:** `src/App.jsx`. No hay componentes separados.

2. **El PDF usa jsPDF cargado dinámicamente** — no está en package.json. La función `generarPDFObra` está al inicio del archivo (primeras ~800 líneas).

3. **Los datos de nómina están hardcodeados en base64** (`NOMINA_S18`, `CATALOGO`) por el tamaño. No los toques a menos que sea necesario.

4. **Los emblemas están hardcodeados en base64** (`EMB_WHITE`, `EMB_NEGRO`). No los toques.

5. **Firestore en modo test** — todas las operaciones funcionan sin autenticación hasta que expiren las reglas. Prioridad: configurar reglas reales.

6. **iCloud Drive + GitHub** — el repo está en iCloud. A veces hay delay de sync. Si git no detecta cambios, esperar que iCloud sincronice.

7. **Netlify build command:** `npm run build`. Si falla, revisar errores de sintaxis JSX en App.jsx — principalmente llaves sin cerrar o variables duplicadas.

8. **Variables críticas que NO deben duplicarse:**
   - `puedeEliminar` (solo en PantallaObras)
   - `puedeGestionar` (solo en PantallaObras)
   - Cualquier `const` dentro de componentes

---

## 16. HISTORIAL DE LA SESIÓN DE DESARROLLO

Esta sesión cubrió:
- Diseño y construcción del app completo desde cero
- Integración Firebase Auth + Firestore + Storage
- Tema visual claro inspirado en BBVA
- Dashboard con 6 KPIs, gráfica SVG de proyección, semáforo de riesgo
- Módulo Contrato con repositorio de documentos
- Generador PDF de 8 páginas con jsPDF
- Múltiples iteraciones de corrección de bugs
- Logo FOSMON con proporciones correctas (447:516)
- Sistema de eliminación de obras con doble confirmación
- Saludos personalizados por usuario ("Hola, Oscar!")

**Duración aproximada:** ~1 día de desarrollo intensivo  
**Iteraciones PDF:** ~15 (problema recurrente con anchos de columna en autoTable)

---

*Documento generado automáticamente — Mayo 2026*
*Para continuar el desarrollo, comparte este documento al inicio de cada sesión con Claude Code.*
