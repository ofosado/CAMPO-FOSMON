# Pendientes conocidos — CAMPO

Registro de deuda técnica, producto y operativa que NO es de seguridad.
Los pendientes de seguridad viven en [SECURITY_RULES.md](SECURITY_RULES.md).

Cada entrada dice: qué es el problema, por qué importa, dónde vive el
hueco, propuesta de fix y prioridad. Antes de tomar cualquiera de estos,
releer el contexto — puede haber cambiado.

**Los primeros 5 pendientes bloquean la primera demo a un cliente.** El
resto va después. Dentro de cada bloque, orden por impacto descendente.

---

# BLOQUEAN LA PRIMERA DEMO

Cinco puntos que hay que resolver ANTES de mostrar el sistema por
primera vez a un cliente externo. El pendiente #1 (iCloud) es
condición previa para que los otros cuatro se puedan trabajar con
confianza — sin eso, cada cambio puede desaparecer.

---

## 1. Sacar el repositorio de iCloud Drive

**Descubierto**: recurrente durante `fix/kpis-en-cero` y de nuevo en
`feature/dashboard-principal` (2026-09-18/19).

**Qué pasa**: el repositorio vive en
`/Users/ofosado/Library/Mobile Documents/com~apple~CloudDocs/Fosmon Cloud/CAMPO-FOSMON/`
— dentro de iCloud Drive. En archivos grandes (`src/App.jsx` supera
900KB) el sync bidireccional entre disco y iCloud crea condiciones donde
el `Edit` tool reporta éxito pero el archivo NO persiste al disco al
momento de leerse otra vez. Se detectó por comparar mtime y grep post-edit.

**Consecuencia operativa**:
- El desarrollador puede creer que un cambio se hizo y no está.
- Los commits pueden llevar código distinto al que se ve en pantalla.
- Es la explicación más probable de "ediciones que no persisten".
- Bloquea de facto el trabajo previo a la demo — no se puede iterar
  con confianza en las horas anteriores al deadline.

**Riesgo de integridad, no solo de productividad**: el repositorio
del producto CAMPO se está sincronizando en la cuenta personal de
iCloud de un desarrollador mientras se edita. Eso significa:

- El código fuente autoritativo del producto vive en una nube
  personal, no en un almacén controlado. Si la cuenta iCloud se
  compromete, se pierde el acceso o iCloud sufre incidente, el
  desarrollador queda sin árbol de trabajo local íntegro (aunque
  `origin` en GitHub sigue como respaldo).
- Los mecanismos de sync bidireccional pueden reordenar, duplicar
  o retrasar archivos sin aviso. En un archivo grande como
  `src/App.jsx`, el orden de operaciones importa: escritura desde
  editor, sync a iCloud, sync de vuelta, lectura desde otro
  proceso — cualquier permutación produce estados intermedios que
  no son los que quería el desarrollador.
- Los commits git firman el snapshot local; si el snapshot local
  es un estado intermedio de sync (algunos archivos actualizados,
  otros no), el commit lleva una mezcla inconsistente que puede
  compilar y pasar tests por casualidad, y romperse en producción
  con síntomas que no se pueden reproducir.
- Auditar la cadena de custodia del código (quién editó qué, cuándo
  se subió a origin) se vuelve inconfiable porque un timestamp de
  archivo local puede ser el timestamp de un sync, no de una
  edición.

En resumen: hoy el producto no vive donde debería. Salir de iCloud
antes de escalar a más colaboradores o antes de que un cliente
audite el proceso de desarrollo.

**Workaround actual**: escribir con Python + `os.replace(tmp, path)` para
forzar escritura atómica. Funciona pero es inaceptable como práctica
permanente.

**Propuesta**:

1. Mover el repositorio fuera de iCloud a `~/dev/CAMPO-FOSMON/` u otra
   ruta local no sincronizada.
2. Añadir el path viejo a `.iCloudExcludeList` si Apple lo permite, o
   marcar la carpeta con `.nosync` (feature de iCloud).
3. Verificar que los hooks, scripts y `firebase.json` sigan
   funcionando desde la nueva ruta.
4. Documentar en README la política: **CAMPO-FOSMON no se clona en
   iCloud ni OneDrive ni Dropbox**.

**Bloquea demo**: sí, indirectamente. Es condición para poder hacer los
otros 4 fixes de demo sin sufrir el fenómeno de ediciones perdidas.

**Prioridad**: crítica.

---

## 2. Primer ingreso: GP se queda en "cargando"

**Descubierto**: reportado por observación de usuario, pendiente de
reproducción sistemática.

**Qué pasa**: en el primer login de un usuario, el pull inicial de
`global/gp_construct` no termina — la pantalla queda con "Sincronizando
con GP Construct…" indefinidamente. Al recargar (`⌘R` o cerrar y volver
a abrir la PWA) funciona.

**Consecuencia operativa**: **es lo primero que ve un cliente nuevo al
que le enseñamos el sistema por primera vez**. Un dashboard atorado en
"cargando" en la demo es la peor primera impresión posible.

**Hipótesis de causa** (a validar):
- Race condition entre `onAuthStateChanged` y el suscriptor a
  `global/gp_construct`. El suscriptor se instala antes de que el token
  esté listo → la lectura falla silenciosamente y el estado queda en
  `null` sin reintento.
- Alternativamente, el SW podría estar sirviendo una versión cacheada
  vieja de `firestore.googleapis.com` (regla NetworkFirst con timeout
  5s en `vite.config.js:74-81`) — pero eso normalmente cae al cache, no
  se atora.

**Cómo reproducir** (a intentar):
1. Cerrar sesión completamente + limpiar storage.
2. `?_reset=1` (interruptor de emergencia en `index.html`).
3. Login como usuario nuevo (no reutilizado hoy).
4. Ver si `gp_construct` termina de cargar en primer intento.

**Propuesta**:
1. Instrumentar el suscriptor a `gp_construct` con log de estado
   (idle/fetching/done/error) para saber en qué paso muere.
2. Diferir la suscripción hasta que `onAuthStateChanged` haya
   entregado un usuario válido con claims.
3. Reintentar automáticamente 2 veces con backoff antes de rendirse.
4. Estado vacío digno si tras N reintentos no llega: botón "Reintentar
   sincronización" en vez de spinner eterno.

**Bloquea demo**: sí. Y es la primera impresión.

**Prioridad**: crítica. Reproducir primero, arreglar después.

---

## 3. KPIs que arrancan en cero antes de que llegue el dato

**Descubierto**: mismo contexto que #2. Reportado en varias sesiones.

**Qué pasa**: la pantalla se pinta ANTES de que los `onSnapshot` de
Firestore hayan entregado datos. Los KPIs muestran `$0` inicialmente y
en ~1-2 segundos saltan a la cifra real. Un cliente que ve `$0` un
segundo pierde confianza; peor si el snapshot tarda más por conexión
lenta.

**Familia con #2**: ambos son problemas de "la UI pinta antes de tener
qué mostrar". Comparten arquitectura de fix: gating por estado real
de datos, no por asunción optimista.

**Dónde ocurre** (varios sitios candidatos):
- Dashboard por obra: la tarjeta muestra 0% de avance mientras
  `datosPorObra[id].subs` está `undefined`.
- Panel principal (dashboard nuevo): ya tiene guarda `todosCargados`
  (`App.jsx:5735`), pero la lista principal de obras NO — cada tarjeta
  se pinta con `MXN(0)` mientras carga.
- Módulos internos por obra (nómina, estimaciones) cuando la subtab se
  monta antes de que Firestore responda.

**Propuesta**:
1. Auditar TODOS los componentes que muestran cifras derivadas de
   `datosPorObra[id]` y añadir guardas de "esperando datos".
2. Estado unificado: `esqueleto` (gris tenue con placeholders) mientras
   se espera, en vez de `$0` que miente.
3. Timeout: si tras N segundos no llega el dato, mostrar "Sin conexión
   a Firestore" con botón de reintentar.

**Bloquea demo**: sí. Cualquier cifra en 0 que salta a 21M en pantalla
frente al cliente es un signo de fragilidad.

**Prioridad**: alta. Podría ir en la misma rama que #2 (misma familia).

---

## 4. Cuentas de prueba dedicadas por rol

**Descubierto**: registrado en SECURITY_RULES.md #4 (pendiente de
seguridad). Se replica aquí porque también es demo-bloqueante.

**Qué pasa**: hoy las pruebas de rol usan cuentas de personas reales
(director, gerente, superintendente). En demo, iniciar sesión como
"director_general" implica usar el usuario real de un directivo — su
correo, su nombre en el header, sus notificaciones.

**Consecuencia operativa**:
- Riesgo de exposición de datos reales durante demo (el cliente ve
  nombres, correos, obras internas).
- Cualquier cambio hecho durante la demo (crear obra de ejemplo,
  agregar registro de prueba) afecta la producción real.
- No se puede demostrar el flujo de "un cliente entra por primera vez"
  sin darle un login real.

**Propuesta**:
1. Crear cuentas dedicadas por rol en Firebase Auth con dominio
   `demo@fosmon.com.mx` u organizarlas en `orgs/demo/*` separado.
2. Data de ejemplo curada: 3 obras de muestra, con nombres genéricos
   ("Obra Demo A · Cliente Demo").
3. Reset automático de la data demo al final de cada sesión (Cloud
   Function programada) para que la próxima demo arranque limpia.
4. Rotular claramente en el header que se está en modo demo (color
   distinto, badge "DEMO").

**Bloquea demo**: sí. Sin esto no se puede mostrar el sistema a un
externo sin exponer datos internos.

**Prioridad**: crítica.

---

## 5. Probar una restauración del respaldo

**Descubierto**: reportado por el usuario en `feature/dashboard-principal`
(2026-09-20).

**Qué pasa**: existe un job `probarBackup` en Cloud Functions y hay
snapshots automáticos programados, pero **nunca se ha ejecutado una
restauración completa end-to-end**. "El respaldo existe" ≠ "el respaldo
funciona".

**Consecuencia operativa**: si Firestore se corrompe o se borra data
por error (rules cambio, script mal ejecutado, incidente de Google), no
sabemos si podemos volver. Descubrirlo el día del incidente es
demasiado tarde.

**Instrucción explícita del usuario**: "Antes de dar de alta a
cualquier cliente externo, ejecutar restauración completa."

**Propuesta**:
1. Crear proyecto de staging (`campo-fosmon-restore-test`) separado de
   producción.
2. Restaurar el último snapshot semanal a ese proyecto.
3. Verificar que las 5 obras, sus subs, historial de avance, nómina,
   estimaciones, otros_gastos y `gp_construct` estén completas y
   consistentes.
4. Probar login de un usuario real (con custom claims) contra el
   proyecto restaurado.
5. Documentar el runbook paso a paso en `RESTORE.md`.
6. Programar restauración de prueba cada 3 meses como rutina.

**Bloquea demo**: sí, por instrucción operativa. No se da de alta
cliente externo sin este verificado.

**Prioridad**: crítica.

---

# ALTA PRIORIDAD — post-demo

Cinco puntos que no bloquean la primera demo, pero que se convierten en
riesgos operativos o de venta si no se cierran en las semanas siguientes.

---

## 6. Falta `onAuthStateChanged`: sesión zombie tras revocación

**Descubierto**: registrado en SECURITY_RULES.md como pendiente de
seguridad #5. Se referencia aquí porque también es UX/operativo.

**Qué pasa**: cuando se revoca la sesión de un usuario en Firebase
Auth (por baja, cambio de rol crítico, o desactivación de cuenta), la
sesión del cliente NO se cierra automáticamente. El usuario queda en
"estado zombie" — la app le sigue mostrando pantallas y aparenta
funcionar, pero cualquier escritura falla por reglas.

**Consecuencia operativa**:
- Ex-empleados podrían seguir viendo el sistema (aunque no puedan
  escribir) hasta que cierren manualmente el navegador.
- Datos sensibles siguen visibles minutos después de la baja.
- Errores confusos para el usuario: "guardé y no se guardó, ¿por qué?".

**Propuesta**:
1. Instalar listener `onAuthStateChanged` global en `App.jsx`.
2. Cuando el token pierda validez o se detecte `inactivo:true` en
   claims, forzar logout + mostrar mensaje "Tu sesión ha terminado".
3. Verificar interacción con `initPWAUpdates` y con el reset de
   emergencia (`?_reset=1`) para no crear loops.

**Prioridad**: alta.

---

## 7. Obra 0112 Malecón: ejecutado no cuadra con estimaciones del residente

**Descubierto**: revisión operativa con residente, ~2026-09.

**Qué pasa**: el "monto ejecutado" que muestra CAMPO para la obra 0112
(SIOP COATZA MALECON) difiere del control de estimaciones que lleva el
residente en su propia hoja. Diferencia registrada: **$2,562,377**.

**Hipótesis principal**: obra adicional fuera del catálogo original.
Trabajos ejecutados que el residente cobró/reportó al cliente pero
que no están capturados como conceptos en el presupuesto de CAMPO,
por lo que el `∑ (a% × imp)` del cálculo de ejecutado los ignora.

**Consecuencia operativa**:
- Los KPIs consolidados subestiman el ejecutado real de la obra.
- El margen aparente es distinto al margen que ve el residente.
- Si esta obra se muestra en demo, la comparación contra "la realidad"
  no cuadra y expone falla del sistema.

**Propuesta**:
1. Reunión con el residente + revisor de contrato para identificar los
   conceptos adicionales.
2. Decidir: (a) agregar los conceptos al catálogo como "adicionales"
   marcados, (b) crear un mecanismo de "ejecutado extra-catálogo" en
   el modelo, o (c) permitir capturar el ejecutado en $ directo sin
   pasar por porcentaje de concepto.
3. Backfill del ejecutado histórico de 0112.
4. Documentar cómo detectar este caso en otras obras.

**Prioridad**: alta. Afecta credibilidad de la cifra estrella del
dashboard.

---

## 8. Formulario de maquinaria no pide fecha por movimiento

**Descubierto**: 2026-09-18, mientras se rediseñaba el dashboard principal.

**Qué pasa**: en `src/App.jsx`, líneas 6117 y 6814, el código agrupa el
gasto de maquinaria por semana usando `m.fecha || m.fechaCaptura`:

```js
(maquinaria || []).forEach(m => sumarManual(m.fecha || m.fechaCaptura, parseFloat(m.imp) || 0));
```

Pero el formulario de captura de maquinaria (líneas ~8580–8608) **no
tiene ningún campo de fecha**. Los campos que sí se piden son:
`desc, vol, und, pu, imp`. Al agregar un registro:

```js
setMaquinaria(mm=>[...mm,{id:Date.now(),desc:"",vol:"",und:"Mes",pu:"",imp:0}])
```

Se crea sin `fecha`. Lo único que sí queda con timestamp es la escritura
completa del array al guardar (`{data: maquinaria, fecha: new Date()...}`
en línea 7658), pero eso es "cuándo guardó el usuario esta vez", no
"cuándo ocurrió el gasto de cada renglón".

**Consecuencia operativa**: cuando un usuario capture maquinaria, esos
registros **no van a aparecer en la serie semanal de gasto**. El `sumarManual`
retorna temprano en `if (!fecha || !monto) return;`. La proyección de fin
de obra (`ProyeccionAvanceGasto`) los pierde. El bloque 1 del nuevo dashboard
principal los pierde también. Solo aparecen en el **valor absoluto del
presente** (donde se suman como total del array sin importar fechas).

**Hoy no se nota** porque en las 5 obras activas de FOSMON hay 0 registros
de maquinaria. Verificado el 2026-09-18 contra producción. El día que
alguien capture, el gasto cae en la semana equivocada sin que nada avise.

**Propuesta**:

1. Agregar un campo `fecha` (input type="date") al renglón de captura en
   `Captura`. Por default hoy.
2. Al agregar un registro nuevo, inicializar `fecha: new Date().toISOString().slice(0,10)`.
3. Considerar un modo bulk (varias filas de gasto con fechas distintas)
   si eso es lo que la gente hace de facto — hablar con un usuario real
   antes.
4. Backfill de registros existentes: cuando se detecte un registro sin
   fecha en el array, dejar sin fecha (no inventar) — solo los nuevos
   traen fecha.

**Prioridad**: alta. Hacer antes de que alguien capture maquinaria
en producción.

---

## 9. Consolidar bloques duplicados de KPIs en Nómina y Estimaciones

**Descubierto**: 2026-09-19, revisando el módulo por obra durante el
review de `feature/dashboard-principal`.

**Qué pasa**: al entrar a una obra y hacer clic en la subtab de Nómina
(y análogamente Estimaciones), la pantalla renderiza DOS bloques de KPIs
uno encima del otro:

- **Nómina**: `MiniDashNomina` arriba + grid de KPIs dentro de `Nomina()`
  abajo. Se muestran juntos, no en pantallas distintas.
- **Estimaciones**: `MiniDashEstimaciones` arriba + "Resumen económico
  — 8 indicadores" dentro de `Estimaciones()` abajo.

En Nómina los dos bloques dan **cifras contradictorias**: el de arriba
dice "141 activos" y el de abajo "143 en total personal". Un usuario que
mira la pantalla lee números distintos para la misma pregunta y pierde
confianza en el sistema.

**Por qué 141 ≠ 143** (para que no vuelva a confundirse):

- **141 (arriba, `MiniDashNomina`)**:
  `trabs.filter(p => (p.total||0) > 0).length` → personas que
  **cobraron** esta semana.
- **143 (abajo, `Nomina()`)**:
  `semanaActual.totalDir + semanaActual.totalInd` → conteo de personas
  por tipo grabado al **cerrar la semana**, sin filtro de asistencia.

Los 2 de diferencia son personas en el listado que no cobraron nada:
típicamente altas capturadas el mismo día del cierre sin días
trabajados, o algún renglón con 0 días por error de captura.

**No es un bug de datos** — son dos preguntas distintas ("cuánta gente
trabajó" vs "cuánta gente está en el listado de la semana"). Pero
ambos bloques rotulan la cifra como "personal/activos" y el usuario no
las distingue.

**Además — divergencia sutil de HE**: arriba usa
`semanaActual.totalHEImp ?? semanaActual.totalHE ?? ∑ p.impHE`
(prefiere el campo nuevo). Abajo usa `semanaActual.totalHE` directo.
En snapshots viejos donde solo existe `totalHE` los dos bloques
cuadran; en los nuevos con ambos campos pueden diverger si vinieron
de migraciones incompletas. **Se resuelve en la misma rama que
consolide los KPIs**: normalizar a `totalHEImp` (con fallback a
`totalHE`), en un solo cálculo compartido.

**Propuesta de consolidación** (validada con el usuario, 2026-09-19):

### Nómina — se queda el bloque B (abajo, dentro de `Nomina()`)

Razones:
- B usa los campos precalculados del snapshot, que son la fuente
  autoritativa (el snapshot es una foto cerrada, no cambia). A recalcula
  en cada render y puede diverger.
- B ya trae delta vs semana anterior — el ejecutivo mira más eso que
  "cuántos activos".

Qué rescatar de A al pasarlo a B:
- **Los DOS números se quedan, con nombres distintos**: el KPI muestra
  `143 en listado · 141 con pago`. Ninguno se pierde. Se elimina la
  ambigüedad rotulando cada cifra por lo que realmente cuenta.
- **Horas extra** con color según `pctHE > 15%` (hoy A lo tiene, B no).
- **Sueldos base** como sub-línea del Total nómina (guion cuando el
  snapshot no traiga `p.impDias`).
- **"Riesgo HE" e "Inasistentes"** NO se meten en el grid — se mueven a
  la sección de excepciones (mismo patrón que ya usamos con `nom_002`
  en el motor de riesgos).

Fix adicional: unificar el cálculo de HE a `totalHEImp ?? totalHE`
en el ÚNICO lugar donde vive el KPI. Documentar en el comentario.

### Estimaciones — se queda el bloque D (abajo, "Resumen económico")

Razones:
- D es el bloque completo que refleja la realidad contable del contrato
  (separa Facturado de Pagado, muestra retenciones FG y estratégica,
  amortización de anticipo).
- D usa el helper `cE(e)` que aplica correctamente `pctFondoGar`,
  `pctRetencion`, `pctAnticipo` del contrato. C ignora esos porcentajes
  y muestra montos brutos.

Qué rescatar de C al pasarlo a D:
- **"Por cobrar (efectivo neto)"** calculado con `cE().ef` sobre
  Facturadas + Aprobadas + En proceso.
- **"Atrasado"** con la lógica de días vs `diasPago` del contrato.
- Ambos calculados con el mismo helper `cE`, para que no vuelvan a
  diverger.

### Alcance de la rama futura

- Eliminar `MiniDashNomina` y `MiniDashEstimaciones` de los renders.
  Conservar la función un ciclo por si hay que rollback rápido, marcada
  DEPRECATED (mismo patrón que `PanelEjecutivo` en `feature/dashboard-principal`).
- Verificar contra prod que las cifras del bloque consolidado cuadren
  1:1 con las 5 obras activas antes de mezclar.
- Suite completa 388/388.

**Alcance que NO entra**: revisar mini-dashes de otros módulos
(`MiniDashAlmacen`, `MiniDashMaquinaria`, `MiniDashSubcontratos`) — es
un pendiente aparte, con su propio análisis. Puede que estén bien.

**Prioridad**: alta. El "141 vs 143" es lo primero que un usuario
crítico pregunta al mirar la pantalla y hoy no tenemos respuesta que
sostener sin explicar un bug conceptual.

**Registrado por instrucción explícita del usuario en el review de
`feature/dashboard-principal` (2026-09-19). Ir en rama propia
DESPUÉS de mezclar `feature/dashboard-principal`.**

---

## 10. Exportación del expediente completo del cliente

**Descubierto**: análisis de compliance con la Ley de Obras Públicas
del estado (referencia: artículo 74).

**Qué pasa**: el sistema no ofrece hoy una manera de exportar el
expediente COMPLETO de una obra (contrato, catálogo, avance,
estimaciones, nómina, bitácora, fotos, documentos anexos) en un formato
abierto que el cliente pueda archivar por su cuenta.

**Consecuencia operativa**:
- Requisito legal: el cliente (dependencia pública en la mayoría de
  obras FOSMON) tiene derecho a llevarse el expediente en formato
  auditable al término de la obra.
- **Objeción segura de cualquier jurídico** durante la venta: "¿y si
  quiero salirme del sistema en 2 años, cómo me llevo mis datos?".
  Sin respuesta a esto, no cerramos venta con dependencias.

**Propuesta** (a diseñar):
1. Definir el formato "abierto": ZIP con árbol de carpetas
   `contrato/`, `avance/`, `estimaciones/`, `nomina/`, `bitacora/`,
   `documentos/`, `fotos/`, más un `index.json` con el mapeo completo.
2. Cada tabla como CSV (fácil de abrir en Excel) + JSON (para
   re-importar).
3. Documentos y fotos como archivos originales.
4. Cloud Function que genera el ZIP a demanda + expira en 24h el enlace
   de descarga.
5. Botón "Exportar expediente completo" visible solo para roles
   directivos y para cliente (con permiso de sus obras).
6. Certificado de integridad: SHA-256 del ZIP en el índice.

**Prioridad**: alta. Requisito para cerrar venta con dependencia pública.
No bloquea la primera demo (se puede prometer), pero sí bloquea firmar
contrato.

---

# MEDIA PRIORIDAD

Puntos con impacto real pero que se pueden postergar a la segunda o
tercera iteración sin afectar la demo o los primeros clientes.

---

## 11. Rehacer el PDF

**Descubierto**: 2026-09-20 durante review post-`feature/dashboard-principal`.

**Qué pasa**: hoy hay UN PDF "todo en uno" que trata de servir para
todos los propósitos y termina siendo malo para varios. Decidir
primero QUÉ documentos hacen falta, luego rehacer.

**Documentos identificados** (a validar):

1. **Informe semanal del artículo 73** — requisito de la Ley de Obras
   Públicas. Formato específico con secciones exigidas: avance físico,
   avance financiero, incidencias, observaciones. Un PDF por semana
   por obra.
2. **Ejecutivo para juntas** — 1-2 páginas, gráficas y KPIs
   principales. Sirve para director general en juntas internas o para
   presentación al cliente.
3. **Expediente exportable** — vinculado a pendiente #10. Formato
   auditable completo, no necesariamente PDF (puede ser el ZIP).

**Consecuencia operativa hoy**: el PDF actual no es reutilizable en
juntas (demasiado largo, densidad de información inconsistente), no
cumple con el formato del artículo 73 (falta rigor de secciones), y no
sustituye al expediente completo (falta anexos).

**Propuesta**:
1. Antes de tocar código: sentarse con un director y decidir qué tres
   PDFs (o dos + el ZIP) son los correctos.
2. Cada PDF con su propio generador. Compartir helpers (marca de agua,
   pie con SHA de build, número de página) pero NO compartir el
   template.
3. Aprovechar para revisar el bug histórico del PDF (fecha del pie de
   página fija) que se ha reportado varias veces.

**Prioridad**: media. Trabajar después de que la primera demo esté
verde y sepamos qué le importa al cliente típico.

---

## 12. Manual de usuario con capturas + correo de alta automatizado

**Descubierto**: recurrente en conversaciones sobre onboarding.

**Qué pasa**: hoy cuando se da de alta a un usuario, se hace manual:
crear cuenta en Firebase Auth, asignar rol y obras en la UI, mandar
correo con la contraseña por WhatsApp o correo escrito a mano.
No existe manual del sistema — el usuario aprende por prueba y error o
llamando por teléfono.

**Consecuencia operativa**:
- Onboarding depende de tiempo humano.
- Riesgo de mandar credenciales por canales inseguros (WhatsApp).
- Usuario nuevo no sabe qué puede hacer con su rol.
- Difícil escalar a clientes externos (dependencias, contratistas).

**Propuesta**:

1. **Manual** (después del branding — no antes, porque hoy la UI aún
   cambia mucho):
   - PDF por rol (director, superintendente, cliente, auditor, etc.),
     con capturas de las pantallas que ese rol ve.
   - Sección "primeros pasos": login, primer dashboard, primera
     captura.
   - Sección de troubleshooting: qué hacer si la PWA no actualiza
     (`?_reset=1`), qué hacer si no ves obras.
   - Versión en `docs/manual-{rol}.pdf` regenerable con cada release.

2. **Correo de alta automatizado**:
   - Cloud Function `enviarBienvenidaConCredencial` que se dispara al
     crear usuario.
   - Correo con: usuario, contraseña temporal (que el sistema fuerce a
     cambiar al primer login), rol asignado, manual adjunto según rol,
     link a la app.
   - Log de envío en Firestore para auditoría.
   - Reintento si SMTP falla.

**Prioridad**: media. No bloquea la primera demo (la damos nosotros con
el usuario presente), pero es imprescindible para clientes con más de
5 usuarios que quieran onboarding sin nuestra intervención.

---

## 13. Distinguir "obra que avanzó" de "residente que se puso al corriente"

**Descubierto**: 2026-09-19, revisando el nuevo `DashboardPrincipal`.

**Qué pasa**: los deltas semanales del bloque 1 (Ejecutado, Personal) y de
la tabla del bloque 3 (Δ avance, Δ margen, Δ personal) se calculan
comparando el último snapshot con el previo. Si la obra estuvo 8 semanas
sin captura y de pronto captura, el "delta vs semana previa" NO representa
lo que ocurrió en la última semana — representa 8 semanas de acumulado
que salen a superficie de un jalón.

Ejemplo real (2026-09-19): obra 0114 tuvo su última captura en S30/2026.
Si el residente captura hoy S38, el delta reportado será +$10M+ en
Ejecutado que **parece** progreso semanal pero es 2 meses de trabajo.

**Consecuencia operativa**: el dashboard, que se presenta como
herramienta de venta y de gestión ejecutiva, va a mostrar saltos que
parecen cambios reales del negocio y no lo son. Un directivo puede
malinterpretar la varianza y tomar decisiones sobre ruido de captura.

**Ideas de diseño** (por explorar, no elegir aún):

1. Etiquetar el delta con el gap de semanas: en vez de "+$10M vs semana
   previa" decir "+$10M vs S30 (hace 8 semanas)".
2. Suprimir la flecha cuando el gap > N semanas y sustituir por nota:
   "captura retrasada — variación no comparable".
3. Guardar en cada snapshot no solo la fecha de captura sino la
   "semana lógica" que representa (para separar semanas contiguas de
   saltos), y calcular deltas solo entre semanas contiguas.
4. Bandera visual en la excepción `sin_captura`: al normalizar la
   captura, marcar el próximo snapshot como "recuperación" para que
   consumidores del delta sepan tratarlo distinto.

**Interacción con otros pendientes**:

- Pendiente #8 (fecha por movimiento en maquinaria) también contribuye
  al problema — sin fecha, la maquinaria "aparece de golpe" en el
  presente. Resolver #8 disminuye el ruido pero no elimina el fenómeno
  para el snapshot de avance.
- Pendiente #15 (auditar otros formularios) puede descubrir más lugares
  con la misma dinámica.

**Prioridad**: media. Hoy no hay incidente porque no hay historial
suficiente para que se note. La primera vez que un directivo pregunte
"¿por qué esta obra creció tanto en una semana?" hay que resolver esto.

**Registrado por instrucción explícita del usuario en el review de
`feature/dashboard-principal` (2026-09-19).**

---

## 14. Sesión persistente: decidir política

**Descubierto**: pendiente arrastrado desde `feature/organizaciones`.

**Qué pasa**: hoy Firebase Auth mantiene la sesión abierta por defecto
en el navegador (`browserLocalPersistence`). Al abrir la PWA no hace
falta re-loguear a menos que el token expire o se revoque.

**Decisión pendiente**: ¿es lo que queremos, o preferimos forzar
logout al cerrar el navegador?

**Depende de**:
- **Equipos personales** (residente en su celular, director en su
  laptop): persistencia es cómoda, cero fricción. Está bien.
- **Equipos compartidos** (una tablet en obra que usan varios
  residentes, o una PC en oficina que rotan): persistencia es un
  riesgo — el siguiente en usar la máquina hereda la sesión.

**No sabemos hoy** qué patrón predomina en FOSMON. Hay que preguntar a
los usuarios operativos.

**Propuesta**:
1. Encuesta rápida (5 usuarios): "¿usas CAMPO desde tu celular/PC
   personal o desde uno compartido?".
2. Según resultado:
   - Personal predominante → dejar como está.
   - Compartido predominante → `browserSessionPersistence` (logout al
     cerrar navegador) + botón "Recordarme" opcional que
     re-active local.
3. Documentar la decisión aquí.

**Prioridad**: media. No bloquea nada crítico, pero es decisión que
conviene tomar antes de escalar a más usuarios.

---

# BAJA PRIORIDAD

---

## 15. Auditar otros módulos por el mismo hueco de "fecha faltante"

**Contexto**: el hueco de maquinaria (punto #8) es de un patrón: el
código de agrupación temporal espera un campo del formulario que no
existe. Puede haber más lugares donde pase lo mismo.

**Qué revisar**:

- Todos los `forEach` que hacen `sumarManual(x.fecha, ...)` o análogo.
- Todos los `.filter(x => x.fecha ...)` o `x.fecha >= ...`.
- Contrastar contra los formularios de captura correspondientes.

**Grep de arranque**:

```bash
grep -n 'sumarManual\|\.fecha\b' src/App.jsx | grep -v 'obra\.' | grep -v '// '
```

**Módulos candidatos** (verificar en el orden dado, del más al menos
crítico para el negocio):

1. **`avance/materiales`** (almacén). Verificar si `materiales[].fecha`
   se usa en algún cálculo y si el formulario la pide.
2. **`subcontratos/lista`**. Verificar `pagos[].fecha`, `estimaciones[].fecha`.
3. **`bitacora/{id}`** — tiene fecha en el modelo, pero verificar que
   TODOS los flujos que insertan la escriban (no solo el UI principal).
4. **Estimaciones** — `fechaFact`, `fechaPag`, `fecha` (documento). Ya
   revisadas hace tiempo pero conviene volver a mirar por consistencia.
5. **`nomina/historial`** — cada snapshot semanal tiene `fecha` (string
   es-MX) y a veces `fechaISO`. Es fuente de la agrupación temporal del
   dashboard, pero como es snapshot semanal (no movimiento), es menos
   frágil. Verificar de todas formas.

**Salida esperada**: una tabla en este documento (bajo este mismo punto)
con `módulo | campo esperado por código | campo pedido por formulario |
estado`. Si hay huecos, cada uno se convierte en un pendiente propio con
su plan.

**Prioridad**: baja. Preventivo. No hay evidencia de otro caso pero
tampoco de la ausencia.

---

## 16. Nómina: drag-and-drop + pegar desde portapapeles

**Descubierto**: petición de UX de usuario operativo.

**Qué pasa**: hoy el módulo de nómina solo acepta el archivo Excel por
clic en botón "Cargar nómina" → picker del sistema. Los usuarios
frecuentemente tienen el archivo en el portapapeles (después de
copiarlo desde correo) o quieren arrastrarlo directamente.

**Consecuencia operativa**: fricción menor en un flujo semanal muy
repetitivo. Cada residente carga una vez por semana; ahorrar 2 clics
son ~5 minutos al mes por usuario. No crítico, pero es lo que se
espera de una app moderna.

**Propuesta**:
1. `<div onDragOver onDrop>` en toda el área del módulo de nómina.
2. Feedback visual al arrastrar: borde punteado, mensaje "Suelta aquí
   el Excel".
3. `document.addEventListener('paste', ...)` para detectar archivos
   pegados desde portapapeles.
4. Mantener el botón "Cargar nómina" para quien prefiera ese flujo.
5. Manejo consistente de errores: mismo parser, mismo feedback.

**Prioridad**: baja. Mejora de UX, no bloquea nada.

---

# Referencia rápida — resumen de prioridad

| # | Pendiente | Bloquea demo | Prioridad |
|---|---|---|---|
| 1 | Sacar repo de iCloud Drive | sí (indirecto) | crítica |
| 2 | Primer ingreso GP en "cargando" | sí | crítica |
| 3 | KPIs arrancan en cero | sí | crítica |
| 4 | Cuentas de prueba dedicadas | sí | crítica |
| 5 | Probar restauración del respaldo | sí | crítica |
| 6 | Sesión zombie (`onAuthStateChanged`) | | alta |
| 7 | Obra 0112 discrepancia $2.5M | | alta |
| 8 | Maquinaria sin fecha por movimiento | | alta |
| 9 | Consolidar KPIs Nómina + Estimaciones | | alta |
| 10 | Exportación expediente (art. 74) | | alta (bloquea contrato, no demo) |
| 11 | Rehacer PDFs | | media |
| 12 | Manual + correo alta automatizado | | media |
| 13 | Distinguir avance vs captura al día | | media |
| 14 | Sesión persistente — decidir | | media |
| 15 | Auditar otros módulos sin fecha | | baja |
| 16 | Nómina: drag/pegar | | baja |

---

# CERRADOS

Pendientes que se dieron de baja con verificación. Se conservan aquí
para no volver a levantarlos sin dato nuevo.

## Parser TAMSA absorbe horas extra en el conteo de días — CERRADO 2026-09-19

Fue el pendiente #4 (bloqueante de demo, prioridad crítica) entre el
2026-09-18 y el 2026-09-19.

**Qué se sospechaba**: que el parser de nómina TAMSA clasificaba como
sueldo base horas que en realidad eran extra, porque reportaba ~1.7 HE
por persona en semanas de turnos de 55 h. El razonamiento era que una
semana de 55 h contiene por definición 15 h extra sobre las 40 h
estándar, así que 1.7 h/persona parecía imposiblemente bajo. De ahí se
derivó la hipótesis de un tope diario mal puesto (11 h en vez de 8 h) y
un supuesto "costo escondido" en el margen de la obra.

**Cómo se verificó**: se cuadró el archivo de nómina real de TAMSA
contra lo que muestra CAMPO para la semana 38.

**Hallazgo**:
- CAMPO lee el archivo correctamente. Las **242 horas extra de la
  semana 38** que reporta el sistema son exactamente las que trae el
  archivo de nómina.
- La jornada de 55 h **no es una semana estándar con 15 h extra
  ocultas**: es semana comprimida pactada. Las horas de la jornada
  pactada son horas ordinarias por acuerdo, no horas extra sin pagar.
- Por lo tanto **no hay costo escondido**, el margen de TAMSA no está
  inflado y no hay clasificación incorrecta que corregir.

**Por qué se cierra**: la premisa del pendiente era una inferencia
("55 h ⇒ 15 h extra") que no correspondía al arreglo laboral real de la
obra. Con el archivo a la vista, el número del sistema y el número del
archivo coinciden. No había defecto de parser: había un supuesto
equivocado de quien lo levantó.

**Si vuelve a aparecer**: antes de reabrirlo, comparar contra el
archivo fuente de la semana en cuestión y confirmar el esquema de
jornada pactada de la obra. El porcentaje de HE por sí solo no es
evidencia de error.

**Nota sobre la propuesta #3 del pendiente original** (advertir cuando
`pctHE < 2%` en obras con turnos > 48 h/semana): esa alerta habría
marcado en rojo un dato correcto. No implementarla tal cual.
