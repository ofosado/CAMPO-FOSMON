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

## 8. Tres fórmulas distintas de "ejecutado" conviviendo en el código

**Descubierto**: 2026-09-19, al diagnosticar la discrepancia de 0112
(pendiente #7). Es la causa raíz de ese caso, pero lo rebasa: afecta a
toda obra en modo volumen.

**Qué pasa**: el importe ejecutado se calcula de tres maneras distintas
según la pantalla, y dos de ellas no coinciden con la tercera.

| Dónde | Fórmula | ¿Topada a 100%? |
|---|---|---|
| KPI "Ejecutado" del dashboard (`src/App.jsx:3133`) | `Σ (s.a/100) × s.imp` | **sí** |
| Línea "Ejec" por concepto en Avance (`src/App.jsx:9345`) | `cantEjec × pu` | no |
| Motor de alertas (`src/App.jsx:14957`) | `Σ cantEjec × pu` | no |

El tope viene de `src/App.jsx:9374`: al capturar cantidad ejecutada en
modo volumen se guarda `cantEjec` íntegro pero el porcentaje se recorta,
`a = Math.min(100, v/cCat*100)`. Como el KPI del dashboard se arma desde
`a` y no desde `cantEjec`, **todo volumen por encima del catálogo se
descarta en silencio de la cifra principal**, mientras la pantalla de
Avance del mismo concepto lo muestra completo.

**Medido contra producción el 2026-09-19** (lectura completa del
portafolio, `scripts/leer-portafolio-recorte.py`):

| obra | modo | partidas >100% | ejecutado hoy | descartado | margen hoy → real |
|---|---|---|---|---|---|
| 0112 SIOP Malecón | volumen | 3 | $21,692,801.20 | $2,777,996.64 | 11.1% → 21.2% |
| 0125 TAMSA | volumen | 32 | $16,318,435.74 | $1,046,494.16 | −77.7% → −67.0% |
| 0114 Oaxaca | porcentaje | 0 | $145,469,620.28 | — | sin exposición |
| 0126 Pemex | porcentaje | 0 | $26,946,162.65 | — | sin exposición |
| 0127 Centro Conv. | volumen | 0 | $0.00 | $0.00 | aún sin captura |

**Total del portafolio descartado: $3,824,490.81.** Ejecutado reportado
$210,427,019.87 contra $214,251,510.68 real. No hay obras archivadas: la
colección tiene 5 documentos, los 5 activos.

**Consecuencia operativa**:
- La misma obra muestra ejecutado distinto según dónde se mire. No hay
  una cifra autoritativa.
- La pérdida es invisible: no hay aviso de que se está descartando
  importe. El único rastro es el badge amarillo del concepto, que dice
  el porcentaje pero no los pesos.
- El margen de las dos obras en volumen está subestimado ~10 pp.
- En demo es el peor escenario posible: el cliente abre el detalle del
  concepto, ve un número, regresa al dashboard y ve otro.

**La serie histórica es irrecuperable**. `crearSnapshotAvance`
(`src/App.jsx:2271`) guarda por partida solo `{sec, sub, a, imp}` y
calcula `montoEjecutado` desde ese `a` ya recortado. **`cantEjec` nunca
se guardó en el snapshot.** Verificado en producción: en las 4 obras con
historial, `max(a) = 100.00` exacto y ningún snapshot trae `cantEjec`.
La forma del snapshot nace en `a0527ea` (2026-05-22) y no ha cambiado;
el modo volumen nace en `fb53647` (2026-06-01), así que todo snapshot de
obra en volumen nació recortado. Aunque se corrija el recorte hoy, las
semanas ya cerradas **no se pueden reconstruir** — solo se puede
recalcular el punto actual. Eso contamina la gráfica de avance y la
proyección de fin de obra de 0112 y 0125.

**No es solo un defecto, es un modelo equivocado para contratos
abiertos.** 0125 (TAMSA) es contrato abierto: se contrataron partidas
sin tener claras las actividades y el cliente asigna mes a mes lo que
requiere según las necesidades de su planta. El catálogo y los precios
son referencia para poder cobrar, no un alcance cerrado. Partidas al
6,333% o al 0% son el comportamiento **normal** de ese contrato, no un
error de carga. Para una obra así, topar al 100% del catálogo garantiza
que el sistema nunca mida bien: ni el ejecutado, ni el margen, ni el
avance. Cualquier arreglo tiene que partir de que existen al menos tres
tipos de contrato con reglas distintas (precio alzado, precios
unitarios, contrato abierto) y no uno solo.

**Propuesta**:
1. Decidir cuál es la cifra autoritativa, y que sea una sola. Extraer
   `importeEjecutado(sub, contrato)` y usarla en los tres sitios.
2. Modelar el tipo de contrato como campo de la obra. El tope deja de
   ser una constante del código y pasa a ser política por contrato.
3. Nunca descartar dato capturado en silencio. Si se avisa, que se
   avise; si se topa la presentación, que el importe completo siga
   guardado y visible como cifra propia.
4. Empezar a guardar `cantEjec` en los snapshots, aunque el histórico
   viejo ya no se pueda reconstruir.
5. No dar por bueno ningún cuadre de obra en modo volumen hasta que
   esto se resuelva.

**Prioridad**: alta. Es un defecto de corrección de cifras, no de UI, y
afecta a la cifra estrella del producto.

### Atendido en `fix/ejecutado-sin-recorte` (2026-09-19) — puntos 1, 3 y 4

Regla que gobierna el arreglo: **el dinero nunca se topa; el avance
físico siempre se topa a 100% por partida.** Son dos preguntas distintas
y dejaron de compartir fórmula.

Tres funciones compartidas (`src/App.jsx`, antes del bloque de histórico)
sustituyen a **todas** las copias en línea:

- `importeEjecutadoPartida(s, modoVol)` — `cantEjec × pu` en volumen, con
  caída a `(a/100) × imp`.
- `desgloseEjecutado(subs, modoVol)` → `{catalogo, excedente, total}`.
- `avanceFisicoPonderado(subs, denominador, modoVol)` — topa a 100%.

No eran tres copias: **eran 16**. Además del KPI, la línea por concepto y
el motor de alertas ya documentados, estaban duplicadas en el dashboard de
obra, el detalle de subcontrato, el editor de conceptos de subcontrato, el
listado de subcontratos, `MiniDashSubcontratos`, `AvanceCliente`,
`PantallaObras`, `TendenciasMensuales`, `ProyeccionAvanceGasto`, la regla
de alerta `sub_001` y cinco puntos del generador de PDF. El PDF es el
documento que se entrega: no podía seguir discrepando de la pantalla.

También se destopó `pctProy` en la proyección al término. Dejarla saturada
en 100 mientras el ejecutado se destopa reproducía la misma contradicción
que la rama existe para eliminar.

El recorte de captura (`a = Math.min(100, …)`) desapareció en los dos
capturadores; `cantEjec` es la fuente de verdad y `a` pasa a ser derivado.

**Medición del efecto, contra producción** (`scripts/comparativo-ejecutado.py`,
solo lectura, 2026-09-19). El avance físico no se movió en ninguna obra —
que es exactamente lo que debía pasar:

| obra | ejecutado antes | ejecutado después | margen | avance físico |
|---|---|---|---|---|
| 0112 Malecón | $21,692,801.20 | $24,470,797.85 | 11.06% → 21.15% | 83.92% = |
| 0125 TAMSA | $16,318,435.74 | $17,364,929.90 | −77.67% → −66.96% | 12.90% = |
| 0114 Oaxaca | $145,469,620.28 | igual | 35.40% = | 88.86% = |
| 0126 Pemex | $26,946,162.65 | igual | 37.57% = | 35.63% = |
| 0127 Centro Conv. | $0.00 | igual | — | — |
| **portafolio** | **$210,427,019.87** | **$214,251,510.68** | **+$3,824,490.81** | |

El excedente ya no se descarta: aparece como cifra propia
("+$X sobre catálogo · pendiente de clasificar") en el dashboard de obra,
en el KPI de subcontratos y en el PDF.

**Histórico.** Los snapshots de obra siguen sin ser recuperables — nunca
guardaron `cantEjec`. En vez de inventar el pasado se marcó la frontera:
`ESQUEMA_SNAPSHOT = 2`, y todo delta que cruce esquemas devuelve `null` y
se dibuja como "semanas no comparables". Sin eso, la primera captura tras
el arreglo habría producido un salto falso de +$3.8M en una semana y
disparado alertas de riesgo inventadas. Los snapshots de **subcontrato**
sí guardaron `cantEjec` desde el primer día: `recalcularHistorialSub` los
reconstruye en lectura uniendo el `pu` vivo por `clave`, y marca como no
comparables los conceptos cuyo precio ya no se puede resolver.

**Queda pendiente el punto 2**: modelar `tipoContrato` (precio alzado /
precios unitarios / contrato abierto) y la autorización de excedentes por
convenio. Va en su propia rama. Mientras tanto el excedente se muestra
como "pendiente de clasificar", que es honesto: el sistema sabe que se
ejecutó y no pretende saber si está autorizado.

---

## 9. Dos decimales no alcanzan para capturar volumen

**Descubierto**: reporte del administrador de obra de 0125 (TAMSA),
2026-09-19: "no me deja poner más de dos décimas en el volumen", y eso
le impide capturar la cantidad real en tres partidas.

**Qué pasa**: el input de cantidad ejecutada en modo volumen tiene
`step="0.01"` (`src/App.jsx:9369`) y la presentación del valor usa
`maximumFractionDigits: 2` (`src/App.jsx:9360` y `9391`).

Importante: **el límite NO es de almacenamiento**. El `onChange` hace
`parseFloat` sin redondear (`9371`) y el guardado persiste `cantEjec`
tal cual (`src/App.jsx:8558`). Prueba: la partida 129 de 0125 tiene
`cant = 994.4961` — cuatro decimales guardados en ese mismo documento.
Lo que trunca es la interfaz: el `step` marca el campo inválido y fija
el salto de las flechas, y el display redondea al leer. Falta confirmar
en el equipo del usuario cuál de los dos es el que le bloquea.

**Por qué importa**: en 0125 hay partidas con unidad `SRV` y precio
unitario de siete cifras, donde dos decimales son insuficientes:

| sec | unidad | precio unitario | vale 0.01 | error máx. (0.005) |
|---|---|---|---|---|
| 130 | SRV | $1,265,249.15 | **$12,652.49** | $6,326.25 |
| 132 | SRV | $588,652.75 | $5,886.53 | $2,943.26 |
| 131 | SRV | $444,247.28 | $4,442.47 | $2,221.24 |

Cota máxima de error por redondeo en las 461 partidas de 0125:
**$19,590.63**, de los cuales $11,490.75 están en esas tres. El importe
realmente perdido no se puede calcular: nadie guardó el volumen que el
usuario quiso capturar. En producción, ningún `cantEjec` de ninguna
obra tiene más de 2 decimales.

**Propuesta — precisión por unidad**, en vez de un `step` global:

| unidad | decimales | razón |
|---|---|---|
| PZA | 0 | no existe media pieza |
| SRV | 4 | precio unitario de 6-7 cifras; una fracción de servicio es dinero real |
| TON, KG | 3 | se pesa al kilo sobre tonelada |
| M3 | 3 | volumen de concreto se mide al litro |
| M2, ML, M, CM | 2 | suficiente al centímetro |
| HORA, H | 2 | centésimas de hora ≈ 36 s |

1. Derivar `step` y `maximumFractionDigits` de la unidad de la partida,
   con una tabla como la de arriba y 2 decimales como default.
2. Regla de respaldo por dinero, independiente de la unidad: si
   `0.005 × pu` supera un umbral (p.ej. $100), subir decimales hasta
   que el error quepa bajo el umbral.
3. Nunca redondear al mostrar un valor que sí se guardó completo: si
   hay más decimales de los que se pintan, el usuario cree que se
   perdieron.
4. Revisar con el administrador de 0125 las tres partidas SRV y
   recapturar el volumen real una vez ampliada la precisión.

**Prioridad**: alta. Es pérdida de dato en captura, y en unidades SRV
el error por partida es de cinco cifras.

### Atendido en `fix/ejecutado-sin-recorte` (2026-09-19)

**La tabla de decimales por unidad de arriba queda derogada.** La unidad
no es el criterio correcto: dos partidas en `SRV` pueden necesitar
precisión distinta si sus precios difieren en dos órdenes de magnitud, y
la tabla obliga a mantener una lista de unidades que crece sola con cada
catálogo nuevo. El criterio es el dinero:

```js
decimalesPorPU(pu) = min(6, max(2, ceil(log10(pu))))
```

Garantiza que **el último decimal nunca vale más de $1**, para cualquier
precio, sin tabla que mantener. Para `SRV` a $1,265,249.15 da 7 → topado
a 6 decimales; para `PZA` a $85 da 2.

La precisión gobierna **solo el display** (`fmtCant(cant, pu)` sustituye
a los `maximumFractionDigits: 2`). El `step="0.01"` se sustituyó por
`step="any"` en los dos capturadores de volumen: no tiene sentido que la
interfaz marque como inválido un valor que el almacenamiento sí acepta.
Se dejó fuera el punto 1 (derivar `step` de la unidad) porque `step="any"`
lo hace innecesario.

Queda el punto 4: recapturar con el administrador de 0125 el volumen real
de las tres partidas SRV. Es trabajo de campo, no de código.

---

## 10. Formulario de maquinaria no pide fecha por movimiento

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

## 11. Consolidar bloques duplicados de KPIs en Nómina y Estimaciones

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

## 12. Exportación del expediente completo del cliente

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

## 13. Rehacer el PDF

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
3. **Expediente exportable** — vinculado a pendiente #12. Formato
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

## 14. Manual de usuario con capturas + correo de alta automatizado

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

## 15. Distinguir "obra que avanzó" de "residente que se puso al corriente"

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

- Pendiente #10 (fecha por movimiento en maquinaria) también contribuye
  al problema — sin fecha, la maquinaria "aparece de golpe" en el
  presente. Resolver #10 disminuye el ruido pero no elimina el fenómeno
  para el snapshot de avance.
- Pendiente #17 (auditar otros formularios) puede descubrir más lugares
  con la misma dinámica.

**Prioridad**: media. Hoy no hay incidente porque no hay historial
suficiente para que se note. La primera vez que un directivo pregunte
"¿por qué esta obra creció tanto en una semana?" hay que resolver esto.

**Registrado por instrucción explícita del usuario en el review de
`feature/dashboard-principal` (2026-09-19).**

---

## 16. Sesión persistente: decidir política

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

## 17. Auditar otros módulos por el mismo hueco de "fecha faltante"

**Contexto**: el hueco de maquinaria (punto #10) es de un patrón: el
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

## 18. Nómina: drag-and-drop + pegar desde portapapeles

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

## 19. `setObra` sin declarar en GastosGP — crash de runtime latente

**Descubierto**: 2026-09-19, por la verificación de ámbito con
`@babel/parser` (pendiente #20) durante el trabajo de
`fix/ejecutado-sin-recorte`. Es **preexistente**, no lo introdujo esa
rama.

**Qué pasa**: en `src/App.jsx:10192`, dentro del selector manual de obra
de GP Construct, el `onChange` hace:

```js
const upd = {...obra, gpId: nuevoId};
setObra(upd);                                        // ← no existe
await fsSet(`obras/${obra.id}/config/info`, {gpId: nuevoId});
await fsSet(`obras/${obra.id}`, {gpId: nuevoId});
```

`setObra` no está declarado en ningún ámbito léxico del componente
`GastosGP` ni es una global. No es un `useState` del componente ni una
prop que se le pase.

**Consecuencia operativa**: en el momento en que un usuario usa el
selector manual para vincular una obra de CAMPO con su obra en GP
Construct, el handler lanza `ReferenceError: setObra is not defined`
**antes** de los dos `fsSet`. Resultado: la vinculación no se guarda en
Firestore y la pantalla se rompe. Justo el flujo de rescate que existe
para cuando el match automático por nombre/ID falla — o sea, revienta
precisamente cuando más se le necesita.

**Por qué nadie lo vio**: el build de Vite/esbuild no resuelve
identificadores libres; compila sin una sola advertencia. Y no hay
linter instalado (ver #20). El error solo aparece cuando alguien toca
ese `<Sel>` en producción.

**Propuesta**:
1. Decidir cuál es la intención real. Dos caminos:
   - Si `GastosGP` debe refrescar la obra en memoria, recibir el setter
     del padre como prop (`onObraChange` / `setObra`) y pasarlo desde
     donde se renderiza el componente.
   - Si basta con persistir, eliminar la línea y dejar que la
     suscripción a `obras/{id}` propague el cambio.
2. Verificar en la pantalla real, con una obra sin `gpId`, que después
   del cambio el gasto GP se resuelve por el nuevo id.
3. Correr `node scripts/verificar-ambito.cjs` y confirmar que queda en
   cero.

**Prioridad**: alta. No bloquea la demo si nadie abre el selector, pero
es un crash garantizado en un flujo de rescate del módulo de gastos.

---

## 20. Integrar la verificación de ámbito de forma permanente

**Descubierto**: 2026-09-19. Durante `fix/ejecutado-sin-recorte` se
tocaron 16 sitios de `src/App.jsx`; dos de esos cambios dejaron
identificadores huérfanos (`ejecutado`, `ejec`) y **el build pasó
limpio** las dos veces. Los encontró un verificador de ámbito armado
sobre la marcha con `@babel/parser`, que de paso destapó el #19.

**Qué pasa**: el proyecto no tiene linter. Ni ESLint ni Biome. Y el
grueso de la aplicación vive en un solo archivo de ~18,000 líneas. Esa
combinación significa que un identificador mal escrito, una variable
borrada en un refactor o una prop que se dejó de pasar **no producen
ningún error en `npm run build`**: esbuild no hace análisis de ámbito.
El defecto llega a producción y se manifiesta como pantalla en blanco
cuando un usuario entra a la vista afectada.

**Consecuencia operativa**: cada refactor de App.jsx es una apuesta. El
riesgo no es teórico: en una sola sesión se produjeron dos regresiones
de esta clase, y existe una tercera preexistente (#19) que lleva quién
sabe cuánto tiempo ahí.

**Dónde vive el hueco**: `scripts/verificar-ambito.cjs` ya está en el
repo y hace el trabajo — recorre el AST y reporta todo
`ReferencedIdentifier` sin binding léxico ni global conocida. Usa
`@babel/parser` y `@babel/traverse`, que ya están en `node_modules`
como dependencias transitivas. Lo que falta es que su ejecución no
dependa de que alguien se acuerde.

**Propuesta**:
1. Cablear el script para que corra solo:
   - `npm run verificar` en `package.json`, y encadenarlo antes de
     `build`.
   - Hook de `pre-commit` que lo corra sobre los archivos tocados.
   - Paso en CI que falle el Deploy Preview si sale distinto de cero.
2. Cerrar #19 primero, si no el check arranca en rojo y se normaliza
   ignorarlo.
3. A mediano plazo, sustituirlo por un linter de verdad (ESLint con
   `no-undef` + `react-hooks`), que cubre esto y mucho más. El script
   es el piso, no el techo: lo valioso es que hoy no hay **nada**.
4. En paralelo, seguir partiendo `App.jsx`. Un archivo de 18k líneas
   es la causa raíz de que estos defectos se escondan.

**Prioridad**: alta. Es infraestructura, no una función nueva, pero
protege todo lo demás que se construya encima.

---

## 21. Cambiar a modo volumen borra el avance capturado, en silencio

**Descubierto**: 2026-09-19, al verificar contra producción (solo
lectura) si 0114 (Oaxaca) y 0126 (Cangrejera) podían pasar de modo
porcentaje a modo volumen, porque es más fácil de capturar para los
administradores. La verificación dijo que no, y destapó tres huecos.

**El dato que lo detona**: las obras que operan en volumen tienen
`cant`, `pu` y `unidad` en el **100%** de sus partidas. Las dos
candidatas los tienen en **cero por ciento**:

| obra | partidas | `cant`>0 | `pu`>0 | `unidad` | `cantEjec`>0 | `a`>0 |
|---|---|---|---|---|---|---|
| 0114 Oaxaca | 335 | 0 | 0 | 0 | 0 | 305 |
| 0126 Cangrejera | 51 | 0 | 0 | 0 | 0 | 36 |
| 0112 Malecón *(volumen)* | 14 | 14 | 14 | 14 | 12 | 12 |
| 0125 TAMSA *(volumen)* | 461 | 461 | 461 | 461 | 99 | 99 |
| 0127 Convenciones *(volumen)* | 112 | 112 | 112 | 112 | 0 | 0 |

Sus catálogos se cargaron solo con clave, descripción e importe. Sin
volúmenes, el modo volumen no tiene contra qué medir.

**Qué pasa hoy si alguien hace el cambio** — tres defectos encadenados:

**(a) Nada lo impide.** El modo son dos radio buttons en la pantalla de
contrato (`src/App.jsx:14644`) que se guardan con el mismo botón que
nombre, cliente y fechas (`guardarDatos`, `src/App.jsx:14490` → escribe
en `obras/{id}/config/info` y en `obras/{id}`). No se valida si las
partidas tienen `cant` y `pu`.

**(b) Nada advierte.** No hay confirmación ni aviso de consecuencias. El
usuario no tiene forma de saber que 305 partidas van a dejar de
mostrarse.

**(c) El avance se borra al primer teclazo.** Éste es el grave. El
capturador deriva el porcentaje solo de `cantEjec/cant`, sin caer de
vuelta a `a` (`src/App.jsx:9621`), así que las partidas con avance
aparecen en **0% y con el input vacío** — el dato sigue en Firestore
pero es invisible. Y entonces el input escribe:

```js
const pctNuevo = cCat > 0 ? (v/cCat)*100 : 0;
setSubs(ss=>ss.map(x=>x.id===subId?{...x,cantEjec:v,a:pctNuevo}:x));
```

Con `cant = 0`, `pctNuevo` es **siempre 0**. El administrador ve una
partida en 0%, teclea un número, y `a` se sobrescribe con cero. El
avance real de esa partida se pierde de forma definitiva: no hay
respaldo ni deshacer. Y como en pantalla ya decía 0%, nada parece
haber cambiado.

**Consecuencia operativa**: en producción hoy (main) el dinero sale
únicamente de `cantEjec × pu`, sin alternativa, así que el cambio de
modo manda **$172.4M a cero de inmediato** ($145.5M de Oaxaca + $26.9M
de Cangrejera). En `fix/ejecutado-sin-recorte` el dinero se conserva
porque `importeEjecutadoPartida` cae a `(a/100) × imp`, pero el
capturador sigue mostrando 0% — o sea, el KPI dice $145M y la pantalla
de captura dice 0%, y la destrucción por teclazo sigue viva.

**Lo que NO es la solución**: derivar `cantEjec = (a/100) × cant` al
migrar. Con `cant = 0` la fórmula devuelve 0 en las 386 partidas. Se
comprobó contra los datos reales. No hay de dónde derivar.

**Propuesta** — tres guardas:

1. **Bloquear** el cambio a modo volumen si las partidas de la obra no
   tienen `cant` y `pu`. Es una precondición dura, no una preferencia.
2. **Confirmación explícita** al cambiar de modo en cualquier dirección,
   diciendo cuántas partidas se verían afectadas y qué pasa con su
   avance. Hoy se cambia y ya.
3. **Que el capturador caiga a `a`** cuando `cantEjec` está vacío, en
   vez de mostrar 0%; y que el `onChange` **nunca escriba `a: 0`** por
   no poder derivarlo — si `cant` es 0, conservar el `a` existente.
   Ésta es la que evita la pérdida de datos y debe ir primero.

**Procedimiento seguro para migrar una obra** (el orden importa, y es
el inverso del intuitivo):

1. Re-importar el catálogo con `cant`, `pu` y `unidad`. El importador ya
   los soporta y preserva `a`/`cantEjec` por coincidencia de clave
   (`src/App.jsx:11225`), así que el avance sobrevive a la recarga.
2. Validar `cant × pu ≈ imp` partida por partida. Si no cuadra, derivar
   volúmenes falsearía el dinero.
3. Recién entonces derivar `cantEjec = (a/100) × cant`, con respaldo
   previo de `avance/subs`.
4. Cambiar el modo y verificar que el ejecutado coincida al peso antes
   y después.

`scripts/diagnostico-cambio-modo.py` (solo lectura) mide los pasos 1 y 2
y compara el ejecutado bajo las dos fórmulas. Re-correrlo después de
recargar catálogos.

**Prioridad**: alta. La guarda 3 es la urgente: hoy un cambio de modo
mal hecho borra avance de forma definitiva y silenciosa.

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
| 8 | Tres fórmulas de "ejecutado" ($3.8M) | | alta |
| 9 | Dos decimales no alcanzan en volumen | | alta |
| 10 | Maquinaria sin fecha por movimiento | | alta |
| 11 | Consolidar KPIs Nómina + Estimaciones | | alta |
| 12 | Exportación expediente (art. 74) | | alta (bloquea contrato, no demo) |
| 13 | Rehacer PDFs | | media |
| 14 | Manual + correo alta automatizado | | media |
| 15 | Distinguir avance vs captura al día | | media |
| 16 | Sesión persistente — decidir | | media |
| 17 | Auditar otros módulos sin fecha | | baja |
| 18 | Nómina: drag/pegar | | baja |
| 19 | `setObra` sin declarar en GastosGP | | alta |
| 20 | Verificación de ámbito permanente | | alta |
| 21 | Cambio de modo borra avance en silencio | | alta |

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
