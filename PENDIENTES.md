# Pendientes conocidos — CAMPO

Registro de deuda técnica, producto y operativa que NO es de seguridad.
Los pendientes de seguridad viven en [SECURITY_RULES.md](SECURITY_RULES.md).

Cada entrada dice: qué es el problema, por qué importa, dónde vive el
hueco, propuesta de fix y prioridad. Antes de tomar cualquiera de estos,
releer el contexto — puede haber cambiado.

**Los primeros 5 pendientes bloquean la primera demo a un cliente.** El
resto va después. Dentro de cada bloque, orden por impacto descendente.

---

# PRINCIPIOS DEL PRODUCTO

No son pendientes: son reglas ya decididas que gobiernan cualquier
cambio futuro. Si un pendiente de abajo contradice a uno de éstos, gana
el principio. Cada uno nació de un defecto real, y ahí está la razón de
por qué se escribió.

---

## P1. El dinero nunca se topa; el avance físico se topa al 100% de la obra

**Adoptado**: 2026-09-19, rama `fix/ejecutado-sin-recorte` (main `be09152`).
**Precisado**: 2026-09-21, rama `fix/compensacion-volumenes` — el tope pasó de
ser por partida a ser al total de la obra.

El importe ejecutado se calcula sin recorte: si se ejecutó más volumen
del que el catálogo previó, el dinero lo refleja. El avance físico de
la OBRA sí se topa: una obra no puede avanzar más del 100% de su
contrato. Pero el tope va **al total, no partida por partida**: dentro
de ese 100% las partidas se compensan entre sí.

**Por qué**: el recorte silencioso del dinero escondía $3,824,490.81 de
ejecutado real en el portafolio ($210,427,019.87 → $214,251,510.68). El
dinero recortado no es conservador, es incorrecto.

Y la misma razón —**el contrato se cierra por compensación de volúmenes, no
partida por partida**— es la que obligó a mover el tope dos días después.
Topando cada partida a su importe de catálogo, la 0112 marcaba 83.92% de
avance con el contrato ejercido al 94.67%: 3 partidas se habían pasado
$2,777,997 y 9 habían quedado cortas $4,157,000, y el tope por partida
contaba lo corto pero borraba lo excedido. Once puntos de obra ejecutada que
no aparecían en ninguna pantalla.

**Cómo se aplica**:

- Cualquier `Math.min` sobre un **importe** es sospechoso y hay que
  justificarlo.
- Sobre el **avance de la obra** el tope es obligatorio, y va sobre el total:
  `Math.min(100, ejecutado / contrato × 100)`. Nunca dentro del acumulado.
- El **denominador es el contrato**, no Σ catálogo. Hoy coinciden al peso en
  las 5 obras, pero es una propiedad del dato, no del modelo:
  `scripts/catalogo-vs-contrato.py` lo verifica.
- A **nivel de partida** el porcentaje sí se muestra sin topar (el badge de
  630%), porque ahí es un indicador de volumen excedido y es la información
  útil. A nivel de obra ese exceso no es avance: es riesgo, y se muestra
  aparte.
- A nivel de obra se muestran siempre juntas **Contratado · Ejecutado · Por
  ejecutar**. Detalle largo en el pendiente #8.

---

## P2. Una cifra que no se pudo calcular se marca "no disponible", jamás se sustituye por cero

**Adoptado**: 2026-09-19, rama `fix/arranque`.

Si el insumo de una cifra no llegó —falló la red, el Sheet no se
sincronizó, un listener no resolvió— la cifra se muestra como **"no
disponible"** con la razón al lado. Nunca `$0`, nunca `0%`, nunca una
barra vacía, nunca un margen del 100%.

**Por qué**: un cero es indistinguible de un dato bueno. El caso
concreto: cuando `gpData` no llegaba, `resolverGastoGP` caía a
`obra.gastoGP || 0` (`src/App.jsx:3270`), el gasto salía en cero y el
margen consolidado en ~100%. Ese número se enseñó en pantalla como si
fuera real. Un "no disponible" se lee como lo que es —falta un dato— y
provoca la pregunta correcta; un cero provoca una decisión equivocada.
Es la misma familia que los pendientes #2 y #3.

**Cómo se aplica**, en este orden:

1. **Prohibido el fallback a cero** en el cálculo. Si el insumo falta,
   la función devuelve `null`, no `0`.
2. **La pantalla distingue tres estados**, no dos: *cargando*,
   *disponible*, *no disponible con razón*. `null` y `0` no pueden
   compartir representación.
3. **Nada se queda en "cargando" para siempre.** Todo camino de carga
   necesita tope de espera y salida a un estado terminal. En
   `fix/arranque`: `ESPERA_MAX_MS` para los datos por obra,
   `GP_TOPE_INTENTO_MS` + `GP_REINTENTOS_MS` para GP.
4. **La razón se dice y, si hay acción, se ofrece.** "no disponible" a
   secas es casi tan malo como el cero. Ver `_GP_NOTA` y el botón
   Refrescar del Panel principal.
5. **Lo que no cargó se lista, no se oculta.** Un consolidado al que le
   falta una obra debe decir cuál.

Esto aplica de aquí en adelante a todo KPI, gráfica, PDF y exportación.

---

## P3. Una prueba verifica que el comportamiento ocurre, no que el mecanismo existe

**Adoptado**: 2026-09-20, rama `fix/arranque`.

Probar que una constante está declarada, que un estado está escrito o
que existe una transición **no prueba que ese camino sea alcanzable**.
Una prueba que sólo confirma la presencia del mecanismo pasa igual de
verde cuando el mecanismo está muerto.

**Por qué**: el caso concreto de esta rama. Se construyó el reintento
automático de GP con su tabla de esperas (`GP_REINTENTOS_MS`), su
estado `error_transitorio` y su watchdog. Se escribieron **41
aserciones** sobre GP y **todas pasaron**. Ninguna detectó que el
camino era inalcanzable: `cargarGP` leía con `fsGet`, que hace
`catch { return null; }` (`src/App.jsx:2154`), así que *cualquier*
fallo —red caída, timeout del service worker, permiso denegado—
llegaba como `null` indistinguible de "el documento no existe" y se
clasificaba como `sin_sincronizar`, el único estado que **no** se
reintenta. El `catch` externo era código muerto, `error_transitorio`
nunca se alcanzaba y el reintento nunca corría.

Lo detectó el usuario **por el comportamiento**, no por el código: el
mensaje decía "nunca se sincronizó" pero al picar Refrescar cargó de
inmediato. Un fallo transitorio no puede terminar en el estado que
significa "nunca existió".

**Cómo se aplica**, en este orden:

1. **Pregunta primero qué entra.** Antes de afirmar que un estado se
   alcanza, identifica *quién* produce el valor que lo dispara. Si el
   valor pasa por un helper, el helper es parte del camino.
2. **Sigue el camino completo hasta la entrada.** Un `catch` sólo se
   ejecuta si algo llega a lanzar. Si en medio hay un `try/catch` que
   devuelve un valor neutral, todo lo que está después es código
   muerto y la prueba debe decirlo.
3. **Ejecuta el comportamiento, no leas el código.** Donde se pueda,
   evalúa la expresión real contra casos —como hace
   `scripts/prueba-guarda-modo-volumen.cjs`, que extrae por AST el
   updater y lo corre. Una aserción de texto sobre el fuente es el
   último recurso, no el primero.
4. **Cuando no se pueda ejecutar, prueba la alcanzabilidad por
   estructura.** `scripts/prueba-guarda-arranque.cjs` tiene un
   detector genérico de helpers que hacen catch-and-return sin
   relanzar, y afirma que `cargarGP` no lee a través de ninguno. Eso
   sí habría fallado.
5. **Verifica que la prueba falle contra el estado anterior.** Una
   prueba que pasa antes y después del arreglo no prueba nada. En esta
   rama: `node scripts/prueba-guarda-arranque.cjs /tmp/antes.jsx` con
   `git show main:src/App.jsx` — 40 fallas contra `main`, 0 en la
   rama. Si el número contra el estado anterior es cero, la prueba
   está mal escrita.

---

## P4. Una prueba que no arranca es tan visible como una que falla

**Adoptado**: 2026-09-23, rama `fix/prueba-muda`.

El P3 dice qué debe afirmar una prueba. Este dice qué pasa cuando la
prueba **no llega a afirmar nada**.

Las pruebas de este repositorio sacan el código vivo de `src/App.jsx`
recorriendo el AST y buscando declaraciones por nombre. Eso es legítimo
—el P3 prohíbe *afirmar* que un nombre existe, no usarlo como dirección
para llegar al código— pero tiene un costo: el día que alguien renombra
un símbolo, la prueba deja de encontrar lo que iba a ejercitar.

Ese día la prueba no sabe nada. No sabe si la conducta sigue viva bajo
otro nombre ni si se rompió: sabe que **no pudo mirar**. Llamarlo
"falla" es mentir en una dirección y callarlo es mentir en la otra.

**Por qué**: tres veces en la semana del 2026-09-22 una prueba se rompió
por un renombre y no por una regresión. La última dejó `main` en rojo
durante horas — `eliminarSemana` pasó a ser `eliminarCarga`, la prueba
murió antes de montar nada y el mensaje se perdió entre el ruido. No se
vio porque **no había forma de correr la suite**: cada prueba se
invocaba a mano, así que en la práctica sólo se corrían las de la rama
en curso, y la que se rompió no era la que se estaba mirando.

**Cómo se aplica:**

1. **Tres estados, no dos.** Verde (se comprobó y se sostiene), ROJO
   (se comprobó y no se sostiene) y NO ARRANCÓ (no se comprobó). El
   tercero tiene código de salida propio: `scripts/no-arranco.cjs`
   sale con 2.
2. **Nunca confundir un punto ciego con una regresión.** Un rojo se
   arregla tocando el código; un "no arrancó" se arregla apuntando la
   extracción al nombre nuevo, o borrando la prueba junto con la
   conducta que ya no existe. Tratar lo segundo como lo primero
   —"toco la prueba hasta que pase"— es como se pierde la cobertura
   sin que nadie lo note.
3. **La suite se corre entera, y después de cada merge a main.** `npm
   test`. Correr sólo las pruebas de la rama es lo que falló aquí: la
   rama estaba verde y main no.
4. **Lo que no se pudo comprobar se dice.** Las pruebas que necesitan
   el emulador se listan aparte en vez de contarse como rojas: sin
   emulador no se miró nada, y decir "rojo" sería inventar un
   resultado.

Si la suite puede quedarse muda sin que nadie lo note, la suite no
sirve.

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

**Estado (2026-09-19, rama `fix/arranque`)**: atacado por el lado de la
consecuencia, no de la causa. `useGPConstruct` ya no puede quedarse en
"cargando": tiene máquina de estados explícita (`gpEstado`), tres
reintentos con espera creciente para la falla transitoria, tope duro por
intento y botón Refrescar en el panel. Mientras GP no esté, gasto y
margen se marcan "no disponible" (principio P2).

**Sigue abierto**: la causa raíz. No se reprodujo el primer ingreso ni
se validó la hipótesis del race con `onAuthStateChanged`. Los puntos 1 y
2 de la propuesta siguen pendientes; los puntos 3 y 4 ya están.

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

**Estado (2026-09-19, rama `fix/arranque`)**: resuelto **sólo en el
Panel principal**. El guard `todosCargados` preguntaba si
`datosPorObra[id]` existía, y la entrada se crea en cuanto llega el
PRIMERO de los 8 listeners —con los otros 7 vacíos—, así que el guard
dejaba pasar precisamente el caso que debía bloquear. Ahora cada llegada
se registra en `_listos` y `datosObraCompletos` exige las 8 claves; los
callbacks de error también marcan resuelto, si no un listener sin
permiso dejaría el panel esperando para siempre. Tope `ESPERA_MAX_MS`
(12 s) y las obras que no llegaron se listan por id, no se ocultan.

**Sigue abierto**: los otros dos sitios del apartado "Dónde ocurre" —
las tarjetas de la lista de obras y los módulos internos por obra
(nómina, estimaciones). El punto 2 de la propuesta (esqueleto gris en
vez de `$0`) tampoco está hecho: hoy es texto "cargando N de M".

**Bloquea demo**: sí. Cualquier cifra en 0 que salta a 21M en pantalla
frente al cliente es un signo de fragilidad.

**Prioridad**: alta. Podría ir en la misma rama que #2 (misma familia).

---

## 4. Proyecto Firebase de pruebas con copia de datos

**Subido de prioridad y reencuadrado**: 2026-09-20. Antes este
pendiente era solo "cuentas de prueba dedicadas por rol"; eso es una
parte, pero el problema de fondo es más grande y bloquea más cosas.
Las cuentas de prueba quedan en el **#4b**, abajo.

**Qué pasa**: existe **un solo proyecto Firebase, `campo-fosmon`, y es
producción**. No hay equivalente de desarrollo. En consecuencia:

- **Todo Deploy Preview de Netlify escribe en la base de producción.**
  El preview de un PR sin revisar tiene exactamente los mismos
  permisos que la app real. Un defecto en una rama puede corromper
  datos de obras reales.
- **No hay forma segura de probar nada destructivo.** El 2026-09-20 no
  se pudo validar a mano el arreglo de la recarga de catálogo (#22):
  el único escenario realista era hacerlo sobre una obra con avance
  real, y el riesgo era perderlo. Se resolvió confiando en la prueba
  automatizada —que sí reprodujo el daño—, pero el punto es que **no
  había alternativa**.
- **Los emuladores no alcanzan.** No traen los datos reales, ni el
  service worker, ni el comportamiento offline del SDK, ni los
  permisos efectivos. Sirven para lógica, no para verificar que un
  cambio no destruye datos que ya existen.

**Por qué sube de prioridad ahora**: es el **requisito para migrar a
`orgs/fosmon/`**. Esa migración (ver `SECURITY_RULES.md`, scripts
`crear-org-fosmon.cjs` y `migrar-supervisor-a-auditor.cjs`) reetiqueta
usuarios y cambia el modelo de permisos de toda la aplicación.
Ejecutarla directo contra producción sin haberla ensayado sobre una
copia de los datos reales no es aceptable: si sale mal, el modo de
fallo es que la gente pierda acceso a sus obras, o que alguien vea lo
que no debe. Hoy **la única forma de probar esa migración es hacerla**.

**Propuesta**:

1. Crear el proyecto `campo-fosmon-dev`.
2. **Copia de datos de producción**, periódica y desatendida. Aquí
   está el amarre con el **#5**: el mecanismo para poblar el proyecto
   de pruebas es el export de Firestore, que hoy **falla con 403** (ver
   #5). **Arreglar el respaldo habilita las dos cosas a la vez**, y es
   el primer paso de este pendiente.
3. Decidir si la copia se **anonimiza**. Los datos incluyen nómina y
   sueldos; si al proyecto de pruebas va a entrar alguien que no tiene
   acceso a eso en producción, hay que ofuscar al menos nombres y
   montos de nómina.
4. Apuntar los **Deploy Previews de Netlify al proyecto de pruebas**
   mediante variable de entorno del build; producción sigue apuntando
   a producción. Esto es lo que hace que revisar un PR deje de ser un
   riesgo, y lo que habría permitido probar a mano el #22.
5. Ensayar ahí la migración a `orgs/fosmon/` de principio a fin,
   incluido el rollback, antes de tocar producción.

**Bloquea demo**: indirectamente. No impide darla, pero impide probar
con confianza lo que se le va a enseñar al cliente, y bloquea la
migración de seguridad que hará falta para vender a dependencias.

**Prioridad**: **alta**. Es infraestructura que habilita el resto:
pruebas seguras, la migración a orgs, y el #4b.

---

## 4b. Cuentas de prueba dedicadas por rol

**Descubierto**: registrado en SECURITY_RULES.md #4 (pendiente de
seguridad). Se replica aquí porque también es demo-bloqueante.
Depende del **#4**: las cuentas de prueba viven en el proyecto de
pruebas, no en producción.

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

## 5. NO HAY RESPALDOS — el export lleva meses fallando con 403

**Descubierto**: reportado por el usuario en `feature/dashboard-principal`
(2026-09-20) como "probar una restauración". **Reencuadrado el mismo
día al leer `global/health`: no hay nada que restaurar.**

### El hallazgo (2026-09-20, lectura de `global/health`)

`backup_historial` guarda las últimas 10 ejecuciones. **Las 10 tienen
`ok: false`**, todas con el mismo error, desde el 2026-07-05 hasta el
2026-09-20:

```
Export error 403: {"error":{"code":403,"message":"The caller does not
have permission","status":"PERMISSION_DENIED"}}
```

El historial solo guarda 10 entradas, pero los **logs de auditoría de
actividad** (que se retienen 400 días, no 30) tienen la serie completa
de llamadas a `FirestoreAdmin.ExportDocuments`: **todos los domingos
desde el 2026-06-07 —la primera— hasta hoy, y todos con
`status.code: 7` (PERMISSION_DENIED)**. No es que se haya roto: **nunca
funcionó el respaldo automático**. Los únicos respaldos que existen son
los dos manuales de septiembre.

La función corre puntual cada domingo y falla en ~0.5 s. Nadie se
enteró porque **el fallo se registra en `global/health` y nada lo
mira**: no hay alerta, y `global/health` no se muestra en la app.

### Causa raíz confirmada (2026-09-21): el rol está en la cuenta equivocada

El comentario de instalación en `functions/index.js:1127-1130` manda
darle `roles/datastore.importExportAdmin` a
`campo-fosmon@appspot.gserviceaccount.com`. Ese es el service account
por omisión de **App Engine**, que era el runtime de Cloud Functions
**Gen 1**.

El proyecto está en **Gen 2** (`firebase-functions ^7`, node 20), y
Gen 2 corre sobre Cloud Run, cuyo service account por omisión es el de
**Compute Engine**:

```
737456981212-compute@developer.gserviceaccount.com
```

Confirmado con `gcloud functions describe backupSemanalFirestore
--region=us-central1` → `GEN_2`, `serviceAccountEmail:
737456981212-compute@...`.

La política de IAM del proyecto tiene el binding de
`importExportAdmin` **solo** sobre el appspot. La cuenta que de verdad
ejecuta la función trae `roles/editor`, `roles/eventarc.eventReceiver`
y `roles/run.invoker` — y **`roles/editor` NO incluye
`datastore.databases.export`** (verificado listando sus
`includedPermissions`). De ahí el 403, idéntico cada domingo.

O sea: el permiso se otorgó bien **para Gen 1**, y la migración a
Gen 2 lo dejó huérfano sin que nadie lo notara, porque el único lugar
donde eso se manifiesta es `global/health`, que nadie lee.

**No hace falta permiso extra sobre el bucket.** El export no lo
escribe la Function: la Function solo llama a la API, y quien escribe
es el *service agent* de Firestore
(`service-737456981212@gcp-sa-firestore.iam.gserviceaccount.com`), que
ya tiene `roles/firestore.serviceAgent`. Prueba empírica: los
respaldos **manuales** del 11 y 14 de septiembre
(`firestore/2026-09-11-preseguridad/`, 14.66 MiB, 28 archivos, con
`overall_export_metadata` válido) están en el bucket y los escribió esa
misma ruta. El bucket funciona; el permiso de llamada, no.

**Consecuencia**: hoy, si alguien borra una colección, cambia mal unas
rules o un script se ejecuta contra el proyecto equivocado, **no hay
vuelta atrás**. Esto convive con una app donde ya se encontraron tres
defectos distintos de pérdida silenciosa de datos (#21, #22 y el del
catálogo): el respaldo era justo la red que debía atrapar esos casos, y
no existe.

### ARREGLADO el 2026-09-21 — ya existe el primer respaldo automático

Autorizado por el usuario, se creó un rol a medida con **un solo
permiso** en vez de darle `importExportAdmin` (que incluye
`datastore.databases.import`, o sea la capacidad de sobrescribir
producción) a la cuenta que ejecuta todas las funciones:

```bash
gcloud iam roles create firestoreExportador --project=campo-fosmon \
  --title="Firestore — solo exportar" \
  --permissions=datastore.databases.export --stage=GA

gcloud projects add-iam-policy-binding campo-fosmon \
  --member="serviceAccount:737456981212-compute@developer.gserviceaccount.com" \
  --role="projects/campo-fosmon/roles/firestoreExportador"
```

El rol a medida tardó ~3 min en propagar: el primer disparo siguió
dando 403 y el reintento automático del scheduler, 3 minutos después,
pasó.

**Verificado en el bucket, no en el registro**:

| | Automático 2026-09-21 | Manual 2026-09-11 |
|---|---|---|
| Operación | `SUCCESSFUL`, `done: true` | `SUCCESSFUL` |
| Duración | 9 s (03:28:55 → 03:29:04) | 16 s |
| Documentos | **3 102** | 2 720 |
| Bytes | 19 087 423 | 15 345 173 |
| Archivos en GCS | **27** | 26 |
| Tamaño en GCS | 18.23 MiB | 14.66 MiB |
| `overall_export_metadata` | 98 B, válido | 98 B, válido |

Más grande que el manual de hace 10 días, que es lo que debe ser.

Los cinco 403 que quedan en `backup_historial` (2026-08-09, 08-16,
09-06, 09-13, 09-20) son **todos anteriores** a este arreglo. No hay
ninguno después.

**Falta todavía**: quitar el binding huérfano de
`campo-fosmon@appspot.gserviceaccount.com` (pendiente a propósito, para
no mezclar causas), corregir el comentario de instalación de
`functions/index.js:1127-1130` que nombra la cuenta equivocada, y
confirmar que el domingo 2026-09-27 corra solo.

**La prueba real del cron es el domingo 2026-09-27.** El 21 pasó gracias
al reintento del scheduler mientras el rol terminaba de propagar; hasta
que un domingo arranque a la primera, el arreglo está verificado a
medias.

Ojo al leer el bucket: hay un tercer respaldo,
`gs://campo-fosmon-backups/firestore/2026-09-23-premigracion/`
(SUCCESSFUL, 3 416 documentos). Ése **no es del cron** — se tomó a mano
el miércoles 23, a propósito y con autorización, antes de migrar la
nómina de la 0127 a subcolección (#28). No cuenta como ejecución
automática.

**Qué hacer, en orden**:

1. ~~**Arreglar el 403.**~~ Hecho el 2026-09-21, ver arriba.
2. **Alertar cuando falle.** Un respaldo que falla en silencio equivale
   a no tener respaldo. Es el **#24 punto 3.1**, prioridad alta: pide
   una acción y dice algo que no se sabría sin abrir la app, y
   justifica saltarse el tope diario. Mostrar `global/health` en la
   app para admin es el complemento.
3. **Verificar que el contenido sirva**, recién entonces: la
   restauración end-to-end que decía la versión anterior de este
   pendiente.

### Y además: el proyecto estuvo caído ~16 días por cobro (agosto 2026)

Confirmado en logs de auditoría el 2026-09-21, investigando por qué no
hubo ni respaldo ni correo semanal el 23/24 ni el 30/31 de agosto.

La cuenta de facturación a la que estaba ligado el proyecto desde el
2026-05-19, `01B52B-8A6A70-A8E51C` ("My Billing Account", MXN), **está
cerrada** (`open: false`). Al cerrarse, el proyecto cayó a **Spark** y
Cloud Run empezó a rechazar todo. El mensaje es textual, no
interpretación:

```
2026-08-24T16:09:53Z  ERROR  run.googleapis.com/requests
The request failed because billing is disabled for this project.
```

Se repite el 24, el 27 y el 2 de septiembre. El 2026-09-02 a las
18:41 UTC (12:41 hora de México) `ofosado@gmail.com` movió el proyecto
a `017A21-5D033F-F47CFE` ("Firebase Payment", abierta), y 17 minutos
después las peticiones de Cloud Run vuelven a `INFO`.

**Ventana de caída**: entre el 2026-08-16 (último export intentado) y
el 2026-09-02 18:58 UTC. Unos 16 días. Durante ese lapso **no corrió
ninguna Cloud Function**: ni respaldo, ni resumen semanal, ni
`crearUsuario`, ni ninguna `onCall`. La app de lectura/escritura
directa a Firestore desde el navegador sí siguió viva —Firestore y Auth
siguen en Spark—, así que **nadie en campo notó nada**.

**Lo que esto implica para el aviso del #24 3.1**: un correo emitido
por una Cloud Function **no puede avisar de esto**, porque en este
escenario las funciones son justamente lo que está muerto. El aviso de
facturación lo manda Google al administrador de la cuenta de cobro; lo
que hace falta del lado nuestro es que **alguien lea esos correos** y
que el `global/health` visible en la app muestre "última ejecución hace
N días", que sí detecta el silencio.

**Pendiente asociado**: verificar por qué se cerró la cuenta anterior
(¿tarjeta vencida?, ¿cierre voluntario?) y que la actual no vaya al
mismo lugar. Es un riesgo de continuidad del negocio, no un bug.

### Y además: nunca se ha probado una restauración

Aunque el export funcionara, **nunca se ha ejecutado una restauración
completa end-to-end**. "El respaldo existe" ≠ "el respaldo funciona".

**Consecuencia operativa**: si Firestore se corrompe o se borra data
por error (rules cambio, script mal ejecutado, incidente de Google), no
sabemos si podemos volver. Descubrirlo el día del incidente es
demasiado tarde.

**Instrucción explícita del usuario**: "Antes de dar de alta a
cualquier cliente externo, ejecutar restauración completa."

**Propuesta** (aplicable una vez arreglado el 403):
1. Restaurar a un proyecto separado de producción — el mismo
   `campo-fosmon-dev` del **#4**, que se puebla con este export. Los
   dos pendientes se resuelven con la misma pieza.
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

**Prioridad**: **crítica, y es lo más urgente del documento.** Los
demás pendientes son defectos que se pueden corregir; este es la
ausencia de la red que atrapa los errores que no se previeron. Cada
semana que pasa sin arreglarlo es una semana de datos sin respaldo.

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

Regla que gobernó el arreglo: **el dinero nunca se topa; el avance
físico siempre se topa a 100% por partida.** Son dos preguntas distintas
y dejaron de compartir fórmula. *(La segunda mitad de esa regla se corrigió
el 2026-09-21: el tope va al total de la obra, no por partida. Ver P1 y la
sección de `fix/compensacion-volumenes`.)*

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
en el KPI de subcontratos y en el PDF. *(Esa presentación duró dos días: ver
`fix/compensacion-volumenes` más abajo — a nivel de obra el excedente no es
un pendiente, es una compensación, y el indicador quedó sólo en la partida.)*

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
convenio. Va en su propia rama.

### Atendido en `fix/compensacion-volumenes` (2026-09-21) — el tope y el denominador

La rama anterior arregló el **dinero** y dejó el **avance** como estaba:
topado partida por partida. Eso resultó ser el mismo error una capa más
arriba. La tabla de arriba lo muestra sin querer: "avance físico 83.92% =",
sin cambio, sobre un ejecutado que acababa de subir a $24,470,797.85 de un
contrato de $25,849,801. El contrato estaba ejercido al 94.67% y la pantalla
decía 83.92%.

La causa es la misma frase que ya estaba escrita en este pendiente —*el
contrato se cierra por compensación de volúmenes, no partida por partida*—
aplicada al porcentaje: en la 0112, 3 partidas se pasaron $2,777,997 y 9
quedaron cortas $4,157,000. Topando cada una a su catálogo, lo corto contaba
y lo excedido se borraba. **Topar por partida deja como pendiente un alcance
que ya se compensó.**

**El arreglo.** `avanceFisicoPonderado(subs, contrato, modoVol)` ahora es:

```js
Math.min(100, (desgloseEjecutado(subs, modoVol).total / contrato) * 100)
```

El tope va al total. El avance y el KPI de dinero salen de la **misma**
función: no pueden volver a separarse sin que alguien lo note.

**El denominador estaba sin decidir.** De los 19 puntos que pedían el
avance, 7 pasaban el contrato y 12 pasaban Σ catálogo. Nadie lo había
notado porque con el tope por partida daba exactamente igual cuál se
usara, y porque en las 5 obras Σ catálogo === contrato al peso
(`scripts/catalogo-vs-contrato.py`, Δ $0). Sin el tope ya no da igual, y
la coincidencia es una propiedad del dato de hoy, no del modelo. Ahora
cada llamada pasa su denominador explícito: el contrato de la obra, o
`contratoDeSub(s)` para un subcontrato.

**El correo y la pantalla daban números distintos.** `calcularKpisObra`
(`functions/index.js`) tenía su propia fórmula —`Σ cantEjec×pu / presupuesto`,
sin tope y sin caída a `a`— y reportaba la 0112 al 94.67% mientras la pantalla
mostraba 83.92%. Los dos números estaban mal, por razones distintas, y daban
lo mismo sólo por casualidad en esa obra. Las cuatro funciones de cálculo
están ahora **copiadas literalmente** en `functions/index.js`, con un
comentario que lo dice: no hay build compartido entre `functions/` y `src/`,
son dos despliegues distintos, y si se toca una copia hay que tocar la otra.

**Efecto medido en producción** (`scripts/comparativo-avance-contrato.py`,
solo lectura, 2026-09-21):

| obra | modo | avance antes | avance después | Δ | contratado | ejecutado | por ejecutar |
|---|---|---|---|---|---|---|---|
| 0112 Malecón | volumen | 83.92% | **94.67%** | +10.75 pp | $25,849,801 | $24,470,798 | $1,379,003 |
| 0114 Oaxaca | porcentaje | 88.86% | 88.86% | — | $163,703,079 | $145,469,620 | $18,233,459 |
| 0125 TAMSA | volumen | 12.90% | **13.72%** | +0.83 pp | $126,536,301 | $17,364,930 | $109,171,372 |
| 0126 Pemex | porcentaje | 35.63% | 35.63% | — | $75,635,416 | $26,946,163 | $48,689,254 |
| 0127 Centro Conv. | volumen | 0.00% | 0.00% | — | $144,596,003 | $0 | $144,596,003 |
| **portafolio** | | | **39.95%** | | **$536,320,602** | **$214,251,511** | **$322,069,091** |

Sólo se mueven las obras en volumen con partidas excedidas, que es lo
esperado: en modo porcentaje no se puede sobreejecutar una partida.

**Ninguna alerta cambia de severidad** (`scripts/impacto-alertas.py`). FIN_002
y PLA_002 miden ahora contra el avance nuevo —el gasto y el avance tienen que
estar en la misma definición—, y en la 0112 las dos brechas pasan de positivas
a negativas (+1.94 → −8.81 pp y +6.00 → −4.75 pp) sin cruzar ningún umbral:
ninguna de las dos era alerta antes ni lo es ahora. Esa obra tiene 21% de
margen.

**La UI del excedente cambió de nivel.** "+$X sobre catálogo · pendiente de
clasificar" desapareció de todos los niveles de obra: a nivel de obra el
exceso de una partida no es avance ni pendiente, es una compensación con otra
partida. En su lugar van siempre juntas **Contratado · Ejecutado · Por
ejecutar**, más una vista de compensación de volúmenes dentro de Avance físico
(cuántas se pasaron, cuántas quedaron cortas, el neto). El indicador de
volumen excedido se conserva **sólo en el detalle de partida**, que es donde
significa algo.

**Histórico: dos fronteras, una por métrica.** `ESQUEMA_SNAPSHOT = 3`, y la
comparabilidad dejó de ser un solo umbral:

- `ESQUEMA_DINERO = 2` — el dinero cambió al dejar de toparse.
- `ESQUEMA_AVANCE = 3` — el avance cambió al pasar a ejecutado/contrato.

Con un umbral único, un snapshot esquema 2 habría dibujado la serie de dinero
punteada sin necesidad. Cada ritmo se acota a la frontera de **su** métrica.
Los 23 snapshots de producción son esquema 1, así que hoy las dos fronteras
caen en el mismo punto; se separan en cuanto se escriba el primer snapshot
esquema 2. Los snapshots nuevos guardan `contratoRef`, el denominador con el
que se calcularon.

Tratamiento de la frontera, igual que en la rama anterior: **tramo viejo
punteado con leyenda, nunca cortar** (la 0112 se quedaría con un solo punto),
y ningún delta cruza.

**Guarda**: `scripts/prueba-avance-sobre-contrato.cjs`. Ejecuta las funciones
reales de `src/App.jsx` **y** `calcularKpisObra` de `functions/index.js` sobre
los mismos catálogos, con un `admin` de mentira. Contra `main` falla en 9
aserciones y reproduce la contradicción de producción: pantalla 40% contra
correo 93% en el caso compensado, correo al 130% sin topar, y correo en 0%
cuando hay avance capturado en % sin `cantEjec`.

**Sigue pendiente el punto 2** (`tipoContrato` y autorización de excedentes
por convenio). Mientras tanto el ejecutado por encima del contrato se muestra
aparte como sobre contrato, que es honesto: el sistema sabe que se ejecutó y
no pretende saber si está autorizado.

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

**Nota (2026-09-20)**: la política de correo de este pendiente quedó
absorbida por el **#24 (plan de correos)**, que además fija que si el
envío falla la creación del usuario NO se revierte, y agrega la
recuperación de contraseña, que hoy no existe. Aquí se queda el
**manual**.

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

## 22. `fsGet` y compañía se tragan cualquier fallo — causa raíz de toda una familia

**Prioridad**: alta. Detectado 2026-09-20 durante `fix/arranque`.

Los cuatro helpers de Firestore devuelven un valor neutral ante
cualquier excepción (`src/App.jsx:2154-2157`):

```js
const fsGet  = async (path) => { try { ... return d.exists() ? d.data() : null; } catch { return null; } };
const fsSet  = async (path, data) => { try { ... return true; } catch(e) { console.error('fsSet',e); return false; } };
const fsDel  = async (path) => { try { ... return true; } catch { return false; } };
const fsColl = async (path) => { try { ... return s.docs.map(...); } catch { return []; } };
```

**Por qué importa**: el `catch` sin `throw` hace que **"falló" sea
indistinguible de "está vacío"**. Es exactamente el defecto que ya se
arregló tres veces esta semana por separado:

- el ejecutado topado al catálogo (`fix/ejecutado-sin-recorte`),
- los KPIs que arrancaban en cero (pendiente #3 → principio P2),
- el guard que confundía "sin partidas" con "no ha llegado"
  (`fix/arranque`, `datosObraCompletos`).

Aquí está la causa raíz de esa familia. Además hace **inalcanzable**
todo manejo de error corriente abajo: el `try/catch` que envuelve una
llamada a `fsGet` es código muerto, porque `fsGet` ya no lanza. Ver
principio P3.

**Dimensión de la rama** (medido 2026-09-20, todo confinado a
`src/App.jsx`):

| helper | llamadas | nota |
|---|---|---|
| `fsGet` | 34 | el grueso del trabajo |
| `fsSet` | 16 | ya loguea, pero el llamador no distingue |
| `fsDel` | 14 | |
| `fsColl` | **0** | **código muerto** — sólo existe la definición; se borra |

**El sitio más peligroso — `src/App.jsx:11669`**:

```js
if (catalogoGuardado) {
  try {
    const subsPrev = await fsGet(`obras/${obra.id}/avance/subs`);
    const arr = (subsPrev && Array.isArray(subsPrev.data)) ? subsPrev.data : [];
    arr.forEach(s => { if (s.sec) subsPreviosMap.set(...) });
  } catch (e) { console.warn('No se pudo leer avance previo:', e); }
}
```

Lee el avance previo para **preservarlo** (`a`, `cantEjec`, fotos) al
recargar el catálogo. Un fallo transitorio devuelve `null` → mapa
vacío → **pérdida silenciosa de avance**, el mismo daño del pendiente
#21. Y su `catch` nunca corre. Este sitio se arregla primero.

### Atendido en `fix/catalogo-no-borra-avance` (2026-09-20) — solo este sitio

`confirmarCatalogo` lee con `getDoc` directo y **aborta sin escribir
nada** si la lectura falla; el documento ausente sigue siendo un caso
legítimo (obra con catálogo pero sin avance capturado todavía).

Se encontró de paso un segundo defecto en la misma función: `fsSetA`
devuelve `false` cuando la escritura falla —no lanza— y ese valor se
ignoraba dentro de un `try/catch` que por eso nunca podía dispararse.
Un guardado fallido terminaba igual en `setFase('confirmado')`: la
pantalla decía "listo" sin haber guardado. Ahora se comprueba cada
escritura por separado.

Reproducción del daño contra el estado anterior, ejecutando la función
real con la lectura fallando: escribía `avance/subs` con `a=0`,
`cantEjec=0` y `fotos={}` en todas las partidas, encima de un avance
real de 80% y 45%. Congelado en `scripts/prueba-guarda-catalogo.cjs`
— 24 aserciones, 9 fallas contra `main`.

**Sigue abierto** el resto del pendiente: 33 llamadas de `fsGet`, 16
de `fsSet`, 14 de `fsDel` y el borrado de `fsColl`.

**Mismo patrón fuera de los cuatro**: `crearSnapshotAvance`
(`src/App.jsx:2368`) y `crearSnapshotAvanceSub` (`src/App.jsx:2431`)
también hacen catch-and-return sin relanzar. Los detecta el bloque de
alcanzabilidad de `scripts/prueba-guarda-arranque.cjs`.

**Qué hacer**:

1. Que los helpers **relancen** —o devuelvan un resultado explícito
   tipo `{ok, dato, error}`— en vez de un valor neutral. La ausencia
   del documento (`!exists()`) sigue siendo un caso legítimo y debe
   quedar distinguible del fallo.
2. Recorrer los 64 sitios de llamada decidiendo, en cada uno, qué
   significa el fallo: reintentar, marcar "no disponible" (P2), o
   abortar la operación. Los de escritura y borrado no pueden
   continuar como si hubieran tenido éxito.
3. Borrar `fsColl`.
4. Extender el detector de la prueba a que **falle** si aparece un
   helper nuevo con el mismo patrón.

**Precedente ya resuelto**: `cargarGP` en `fix/arranque` dejó de usar
`fsGet` y lee con `getDoc` directo, precisamente para que la excepción
llegue y se pueda clasificar transitorio vs. terminal. Ese es el
modelo a replicar.

---

## 23. `networkTimeoutSeconds: 5` del service worker afecta toda lectura de Firestore

**Prioridad**: media-alta. Detectado 2026-09-20 durante `fix/arranque`.
Va en **rama aparte** porque toca `vite.config.js` y el cambio afecta
todas las lecturas, no sólo GP.

`vite.config.js:74-81`:

```js
{ urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
  handler: 'NetworkFirst',
  options: { cacheName: 'firestore-cache', networkTimeoutSeconds: 5,
             expiration: { maxEntries: 50, maxAgeSeconds: 60*60*24 } } }
```

Es el disparador concreto más probable del fallo transitorio de GP que
se observó: con red lenta, Workbox corta a los 5 s y responde desde
caché —o falla— antes de que Firestore conteste. Cinco segundos es
poco para la primera lectura en frío desde obra.

**Qué revisar**:

1. Si interceptar Firestore con `NetworkFirst` tiene sentido: el SDK
   ya trae su propia persistencia y reintentos, y el canal `Listen` es
   de larga duración. Puede que lo correcto sea **excluir** el dominio
   del service worker.
2. Si se conserva, subir el timeout y medir con red degradada.
3. `maxAgeSeconds: 86400` significa que una respuesta de hasta 24 h
   puede servirse como si fuera fresca.

---

## 24. Plan de correos — qué manda CAMPO y qué no

**Acordado**: 2026-09-20. Sustituye las decisiones sueltas de correo
que estaban repartidas; el correo de alta del pendiente #14 queda
absorbido aquí en cuanto a política (el manual sigue en #14).

**La regla que gobierna todo lo demás**:

> Se manda un correo **solo si pide una acción o dice algo que no se
> sabría sin abrir la app.** Tope de **uno por persona al día**, salvo
> los correos de cuenta.

**Explícitamente NO se manda**: nada por cada captura, y nada que
duplique lo que ya dice la campanita dentro de la app. Un sistema que
manda de más se filtra a spam y deja de leerse, y entonces tampoco
sirve para lo que sí importa.

### Lo que hay hoy

Existe infraestructura de correo y no está claro que funcione:

| pieza | dónde | estado |
|---|---|---|
| Resend + `enviarEmailResend` | `functions/index.js:996` | existe |
| `resumenSemanalEmail` (lunes 9:07 CDMX) | `functions/index.js:1069` | existe, **sin verificar** |
| `probarResumenSemanal` (callable) | `functions/index.js:1095` | existe, para dirección/admin |
| `registrarSalud("email_semanal", …)` | `functions/index.js:717` | escribe en `global/health` |

**Verificado el 2026-09-20 leyendo `global/health`** (solo lectura, sin
mandar ningún correo de prueba): el resumen semanal **sí funciona**.
Las 10 ejecuciones del historial salieron `ok: true`; la última el
2026-09-14 a las 09:07 CDMX, a 4 destinatarios —`aoliva`, `lmayo`,
`ofosado`, `ofosadog` @fosmon.com.mx—, que son exactamente los
usuarios activos con los roles de `ROLES_RESUMEN_SEMANAL`
(`functions/index.js:801`). O sea que **no hay que revivirlo sino
cambiarle el contenido**: hoy manda un resumen propio, no el dashboard
principal.

**Pero hay un hueco de 3 semanas sin explicar**: faltan los lunes
**2026-08-24 y 2026-08-31**. No figuran como fallo, figuran como nada,
así que la función no llegó a ejecutarse. El **mismo hueco exacto**
aparece en `backup_historial` y en `recordatorio_lunes_historial`, lo
que apunta a una causa común de todo el proyecto en ese periodo
—facturación, cuota o un redespliegue— y no a un defecto de esta
función. **Hay que averiguar qué pasó**: si se repite, el correo no
sale y nadie se entera. Los logs de Cloud Functions de esas fechas
deberían decirlo.

### 1. Correos de cuenta — obligatorios

Los únicos exentos del tope diario.

- **Alta de usuario con credenciales.** Hoy `crearUsuario`
  (`functions/index.js:128`) crea la cuenta con contraseña pero **no
  manda nada**: las credenciales se pasan a mano, a veces por
  WhatsApp. Requisito explícito: **si el envío del correo falla, la
  creación del usuario NO se revierte.** La cuenta queda creada y el
  correo se reintenta o se reporta; borrar al usuario porque falló un
  correo sería peor que el problema.
- **Recuperación de contraseña. Hoy no existe**, ni en la app ni en
  las Functions. Quien olvida su contraseña depende de que alguien se
  la resetee a mano. Es lo más barato de agregar
  (`sendPasswordResetEmail` del SDK de Auth) y lo que más soporte
  ahorra.

### 2. Resumen semanal para directivos — uno solo

Lunes temprano, **el dashboard principal en un correo**: el mismo
consolidado que ya se ve en pantalla. Un correo por semana, no uno por
obra. Se revive `resumenSemanalEmail` **después** de verificar si
funciona.

Aplica P2: una cifra que no se pudo calcular va como "no disponible",
nunca como cero. Un correo con margen del 100% porque no llegó GP es
peor que no mandarlo.

### 3. Excepciones que piden acción

**3.1 Respaldo que falló → al administrador. Prioridad alta.**

Es el primero de la lista, y el que justifica la categoría entera. El
export semanal de Firestore lleva meses devolviendo 403 (ver #5) y
nadie se enteró: la función **sí** escribe el fallo en `global/health`,
pero **nada ni nadie lee ese documento**. Un registro que nadie lee no
es una alarma.

Cumple la regla de cabo a rabo, y con margen: pide una acción concreta
(arreglar el permiso, o el bucket, o el cobro) y dice algo que nadie
sabría sin ir a buscarlo a mano en Firestore.

Qué debe decir: qué corrió, cuándo, y **el mensaje de error textual**.
El 403 traía el nombre del permiso faltante
(`datastore.databases.export`); ese dato solo apareció al leer los
logs. En el correo habría resuelto el problema el primer domingo.

Detalles de diseño:

- **Se salta el tope de uno por persona al día.** El tope existe para
  no volver ruido lo rutinario; esto no es rutinario.
- **Que no se repita idéntico cada semana sin cambio.** Si falla ocho
  domingos seguidos por lo mismo, el octavo correo ya no informa nada.
  Un correo al primer fallo y luego recordatorio espaciado, o uno que
  diga "van N semanas".
- **El éxito no manda correo.** Un correo semanal de "respaldo ok" se
  vuelve ruido y se deja de leer, que es justo cómo se pierde el aviso
  del que sí importa.
- **A quién**: al administrador del sistema, no a dirección. Es una
  acción técnica.

No depende de #5: el correo hay que construirlo aunque el 403 ya esté
arreglado, porque el siguiente fallo será por otra causa —cuota,
cobro, bucket borrado— y volvería a pasar callado.

**3.2 Obra que no cerró semana** → al residente y a su gerente. Pide
una acción concreta y no se sabe sin abrir la app.

Ojo con el pendiente #15: hay que distinguir "la obra no avanzó" de
"el residente no capturó". El correo es por lo segundo.

### 4. Para cotea (cumplimiento)

El **informe semanal del artículo 73 enviado por correo al superior
jerárquico**, como forma de cumplir la obligación —el correo es el
acto de cumplimiento, no un aviso. Implica acuse y registro de envío.

**Depende del pendiente #13** (rehacer el PDF): sin el informe bien
hecho no hay nada que mandar.

### Pregunta abierta

**¿Los residentes leen correo?** Si la respuesta es que no, los avisos
del punto 3 deben ir por **WhatsApp** y no por correo. Esto cambia el
diseño de esa parte, así que hay que responderlo antes de construirla.
Los puntos 1, 2 y 4 no dependen de esta respuesta: dirección sí lee
correo, y el de cotea es cumplimiento formal.

**Prioridad**: **alta** el aviso de respaldo fallido (3.1) y la
recuperación de contraseña (hoy no existe y genera soporte manual). El
resto, media: el resumen semanal y las demás excepciones después de
verificar la infraestructura; el de cotea va detrás del #13.

---

## 25. `global/health` registra la intención, no el hecho

**Descubierto**: 2026-09-21, al arreglar el 403 del #5. Prioridad
**alta** — es lo que hace que el #24 3.1 pueda mentir.

`ejecutarBackupFirestore()` ([functions/index.js:1139](functions/index.js:1139))
hace un `POST` a `:exportDocuments` y **no consulta la operación
después**. El export de Firestore es una operación de larga duración:
la API responde en milisegundos con un `operationName` y el trabajo
sigue corriendo en segundo plano varios minutos.

`registrarSalud("backup", true, ...)` se escribe **en cuanto la
petición es aceptada**. O sea que `ok: true` significa *"se pidió un
respaldo"*, no *"hay un respaldo"*. Si el export revienta a los dos
minutos —cuota, bucket borrado, permiso del service agent— el registro
se queda diciendo que todo bien, para siempre.

**Se comprobó en los dos sentidos el 2026-09-21**:

| | Bucket | `global/health` |
|---|---|---|
| Ejecución 03:28:55 | respaldo completo, 27 archivos, 18.23 MiB | `ok: true` (por suerte) |
| Ejecución 03:32:34 | no escribió nada (400, la carpeta ya existía) | `ok: false` |

Quedó `ok: false` **teniendo un respaldo bueno del mismo día**. Ese es
el registro que vería el administrador, y el correo del #24 3.1
avisaría de un fallo que no existe. La falla al revés —`ok: true` sin
respaldo— es la peligrosa, y es la que estuvo activa desde siempre.

**Qué hacer**:

1. Guardar el `operationName` y **consultar la operación** hasta que
   `done: true`, y recién entonces registrar el resultado real
   (`operationState: SUCCESSFUL` / `FAILED`) con documentos y bytes
   exportados. La API es `firestore.googleapis.com/v1/{name}`.
   Requiere añadir `datastore.operations.get` al rol
   `firestoreExportador`, que hoy tiene solo `export`.
2. Alternativa más barata si no se quiere sondear: verificar que
   exista el archivo `{fecha}.overall_export_metadata` en el destino.
   Firestore lo escribe **al final**, cuando el export terminó — es el
   marcador de completitud. Se confirmó: su `updated` coincide al
   segundo con el `endTime` de la operación.
3. Distinguir los estados en el registro: `pedido` / `confirmado` /
   `fallido`. Hoy solo hay un booleano que no alcanza para tres cosas.
4. **El error 400 "Path already exists" no es un fallo real.** Dos
   corridas el mismo día chocan porque el destino lleva solo la fecha.
   O se trata como caso benigno, o el destino lleva la hora.

**Y un efecto lateral**: el documento quedó con `ok: false` junto al
`operationName` de la corrida **exitosa**, porque `registrarSalud`
escribe con *merge* y el fallo no pisó ese campo. Un registro mezclado
de dos ejecuciones distintas es peor que uno vacío. Al escribir el
resultado hay que limpiar los campos que ya no aplican.

---

## 26. Pantalla de salud del sistema en administración

**Descubierto**: 2026-09-21, razonando el #24 3.1. Prioridad **alta**.

El correo de fallo tiene un punto ciego estructural: **si lo que está
muerto son las Cloud Functions, no hay quien mande el correo**. No es
hipotético, ya pasó: los ~16 días de agosto con la facturación caída
(#5) no generaron ni un aviso, porque el emisor era justo lo caído.

Contra eso no sirve un emisor. Sirve un **lector**: el navegador, que
sigue vivo porque habla con Firestore directo.

**Qué**: una pantalla en administración que lea `global/health` y
muestre, **por cada función programada** —hoy son cinco jobs:
`backupSemanalFirestore`, `resumenSemanalEmail`, `recordatorioLunes`,
`recordatorioCapturaObra`, `actualizarGPSheet`; eran seis hasta que
`recordatorioCapturaSubs` se retiró el 2026-09-22 (#31)—:

- qué es y cada cuándo debería correr,
- **"última ejecución hace N días"**,
- en **rojo** si N supera lo esperado para su frecuencia (una semanal
  en rojo a los ~9 días, una diaria a las ~36 horas),
- el resultado y el **mensaje de error textual** de la última corrida.

**Lo importante es que detecta el silencio, no el fallo.** Un fallo se
registra; el silencio no deja rastro en ningún lado, y el silencio fue
exactamente lo que pasó desapercibido en agosto. Es la única señal que
funciona cuando el backend entero está caído.

Aplica **P2**: una función que nunca registró nada va como "sin datos",
no como "hace 0 días".

Depende de que las funciones escriban un registro honesto: sin el #25,
esta pantalla muestra en verde cosas que fallaron.

---

## 27. La proyección asume contrato cerrado — en TAMSA no aplica

**Descubierto**: 2026-09-21, cerrando `fix/series-desincronizadas`.
Prioridad **media-alta**. Depende de `tipoContrato`, que no existe.

`ProyeccionAvanceGasto` proyecta hasta que el **avance físico llega al
100%**. Ese criterio es el correcto y sustituye al anterior —"hasta que
el dinero alcanza el presupuesto"—, que violaba P1 topando el dinero.

Pero sólo vale para un **contrato cerrado**: uno con un catálogo de
alcance finito que se puede terminar. **TAMSA es un contrato abierto**:
servicios por demanda, sin un 100% que alcanzar. Ahí no hay "fin de
obra" que proyectar; lo que hay es una **fecha de término de contrato**,
y la proyección debería cortarse en esa fecha, no en un porcentaje.

Hoy el modelo no distingue los dos casos. Consecuencia concreta: en una
obra abierta la gráfica dibuja un "fin proyectado" que no significa
nada, y el KPI de margen al cierre se calcula contra un cierre inventado.

**Lo mismo aplica al margen.** El margen proyectado se calcula hoy
contra el **importe de contrato**, porque en obra se compensan volúmenes
y la obra cierra en el contratado (regla del usuario, 2026-09-21). En un
contrato abierto no hay un importe de cierre: el ingreso es lo ejecutado
autorizado, y la regla se invierte.

**Qué hace falta**:

1. `tipoContrato` en el modelo de obra: `cerrado` | `abierto`.
2. En `abierto`: cortar la proyección por la fecha de término, no por el
   100%; no mostrar "fin proyectado"; calcular el margen contra lo
   ejecutado autorizado, no contra el contrato.
3. Y no mostrar "excedente sobre contrato" como riesgo: en un contrato
   abierto ejecutar por encima del estimado inicial es lo normal, no una
   sobreejecución por autorizar.

Queda anclado en el código: el comentario del criterio de término en
`ProyeccionAvanceGasto` apunta a este pendiente. Los convenios del
modelo de contrato entran por la misma rama.

---

## 28. Los historiales semanales viven en UN documento y se llenan

**Descubierto**: 2026-09-21, diagnosticando por qué la obra 0114 llevaba
siete semanas sin histórico. Prioridad **crítica — BLOQUEANTE DE DEMO**.

> **Por qué subió a bloqueante (2026-09-22).** Dejó de ser deuda técnica en
> cuanto la medición puso fechas: la 0125 llena su `avance/historial` en
> **marzo de 2027** y su `nomina/historial` en **febrero**, y ese segundo no
> tiene tope ninguno ni se arregla quitando texto. Una obra municipal de un
> año con 300 partidas revienta el documento antes de terminar la obra. No se
> puede dar de alta a un municipio sin esto: se le estaría vendiendo un
> histórico que se corta solo a mitad del contrato, en silencio y sin que el
> residente pueda hacer nada. Lo de la 0114 no fue un caso raro, fue el
> primero.

`avance/historial`, `nomina/historial` y `subcontratos/historial_{subId}`
son **un solo documento con un arreglo `semanas`**. Firestore topa cada
documento en **1 MiB**. Cuando el arreglo llega ahí, la escritura falla y
no hay forma de seguir guardando: no es que se ponga lento, es que se
acaba.

Ya pasó. La 0114 llegó al 93.8% del límite y perdió los cierres de las
semanas 32 a 38 de 2026 (ver el pendiente #22 para el silencio que lo
ocultó siete semanas).

### Medición contra producción — 2026-09-21

Tamaños con las reglas de Firestore, no bytes de JSON. "Último cierre" es
lo que pesó el cierre más reciente, que es el ritmo real al que crece.

| documento | hoy | último cierre | tope del código | quedan | se llena |
|---|---:|---:|---:|---:|---:|
| `0114/avance/historial` | **93.8%** | 140,392 B | 52 sem = 696% | **0** | ya pasó |
| `0125/avance/historial` | 7.0% | 36,502 B | 52 sem = 181% | 26 | 2027-03 |
| `0126/avance/historial` | 11.1% | 13,551 B | 52 sem = 67% | 68 | nunca |
| `0112/avance/historial` | 3.7% | 8,359 B | 52 sem = 41% | 120 | nunca |
| `0127/avance/historial` | — | — | — | — | **no existe: nunca ha capturado** |
| `0125/nomina/historial` | 20.6% | 42,085 B | **ninguno** | 19 | 2027-02 |
| `0114/nomina/historial` | 20.6% | 25,195 B | **ninguno** | 33 | 2027-05 |
| `0127/nomina/historial` | 2.1% | 12,369 B | **ninguno** | 82 | 2028-04 |
| `0126/nomina/historial` | 10.7% | 10,010 B | **ninguno** | 93 | 2028-07 |
| `0112/nomina/historial` | 2.2% | 11,360 B | **ninguno** | 90 | 2028-06 |
| `0112/subcontratos/historial_SC-1784934468827` | 0.2% | 800 B | 52 sem = 4% | 1307 | nunca |

**Tres cosas que salen de aquí:**

**1. El tope de 52 semanas no protege.** `crearSnapshotAvance` recorta a
52 semanas para no crecer sin fin, pero nunca se comprobó que 52 cupieran.
En la 0114 (335 partidas) 52 semanas son el 696% del límite; quitar la
descripción lo baja al 143%, que sigue sin caber: revienta hacia la semana
36. En la 0125 (461 partidas) son el 181%, y ahí quitar la descripción casi
no ayuda porque sus partidas ya traen poco texto. **La 0125 es la siguiente
en tronar, en marzo de 2027, y el arreglo de la descripción no la salva.**

**2. `nomina/historial` no tiene tope ninguno.** Crece para siempre. La
0125 mete 143 trabajadores por semana a 42 KB el cierre y le quedan 19
semanas. Sólo el 20-24% de cada semana es texto repetido (nombre, puesto),
así que aquí no hay un truco de compactación: el dato sí es nuevo cada
semana. **El tope sigue sin existir; lo que se arregló el 2026-09-22 es que
el día que reviente se vea** (ver abajo).

**2b. Lo que marca el calendario no es la 0125, es el alta.** De la
medición sale un número que sirve para cualquier obra: **294 B por
trabajador por semana**. Con eso se calcula cuánto dura un documento de
nómina *desde cero*, que es el caso de un municipio recién dado de alta:

| plantilla | pesa el cierre | semanas hasta llenarse | |
|---:|---:|---:|---|
| 143 (la 0125 hoy) | 42,085 B | 24 | 5.5 meses |
| 200 | 58,860 B | 17 | 3.9 meses |
| 250 | 73,575 B | 14 | **3.2 meses** |
| 300 | 88,290 B | 11 | **2.5 meses** |
| 400 | 117,720 B | 8 | **1.8 meses** |

A escala municipal —de 250 trabajadores para arriba— el documento se llena
en **poco más de tres meses**, no al año. Un municipio que se dé de alta en
enero pierde su nómina en abril, dentro del mismo ejercicio en que se
firmó. Eso es lo que fija el calendario de este pendiente: **la fecha
límite no es febrero de 2027 (cuando truena la 0125), es la fecha de la
primera alta.**

> Cuidado con confundir dos cifras que se parecen: los **19 semanas /
> febrero 2027** son lo que le queda al documento *que ya existe* de la
> 0125, que va al 20.6%. Los **tres meses** son lo que dura un documento
> *nuevo* a escala municipal. La segunda es la que bloquea la demo; la
> primera solo dice cuándo nos alcanza el problema en casa.

**3. Un municipio no cabe.** Un catálogo municipal de obra pública es de
varios cientos de partidas, como la 0114 y la 0125. Dar de alta un
municipio con este esquema es programar el mismo incidente a unos meses
vista. **Por eso esto bloquea el alta, no es deuda técnica a futuro.**

### Propuesta de fix

Un **documento por semana en subcolección**, no un arreglo:

```
obras/{obraId}/avance_historial/{S30-2026}
obras/{obraId}/nomina_historial/{S30-2026}
obras/{obraId}/subcontratos_historial/{subId}__{S30-2026}
```

Cada cierre escribe su propio documento y nunca compite por espacio con
los demás. La gráfica lee con una consulta ordenada y limitada, que además
es más barata que traer un megabyte para pintar doce puntos.

Hace falta migrar lo que ya existe y dejar lectura de los dos formatos
mientras dure la migración. **Esa convivencia es la parte delicada**: si la
lectura nueva no encuentra la subcolección y cae al documento viejo sin
avisar, se repite el patrón del #22 — una pantalla que muestra menos de lo
que hay y parece normal.

**La regla va primero, 2026-09-22.** `obras/{obraId}/nomina_historial/{id}`
ya tiene su regla en `firestore.rules`, con los mismos permisos que el
documento que va a reemplazar, y se despliega **antes** de escribir la
primera semana. No al revés. Una ruta sin regla cae en el
`match /{document=**}` final, que deniega todo, y como las escrituras pasan
por helpers que se tragan el fallo (#22), la migración parecería funcionar
mientras no guarda nada: es letra por letra lo que le pasó al histórico de
subcontratos durante tres años (#31). La regla sola no rompe nada si se
despliega antes que la migración — abre una ruta que todavía nadie usa.

Mientras tanto, lo que ya está hecho en `fix/historial-lleno`: el fallo de
escritura ya no es silencioso —ni en avance ni en nómina—, y el snapshot
dejó de copiar la descripción de la partida en cada semana (140 KB → 29 KB
en la 0114). Eso compra tiempo. No resuelve el fondo.

**Nómina, 2026-09-22.** `guardarSemana` y `eliminarSemana` ya esperan la
escritura y miran el resultado. Antes no hacían ninguna de las dos cosas:
la pantalla saltaba a la semana nueva y cerraba el diálogo aunque Firestore
la hubiera rechazado. Si ahora falla, el diálogo se queda abierto con el
archivo ya procesado en la mano y el botón reintenta — cerrarlo obligaría a
volver a cargar el Excel por un fallo que puede durar un segundo. El
mensaje es distinto al de avance a propósito: en avance la captura vive
también en `avance/subs` y se puede decir "tu captura sí quedó guardada";
en nómina el historial es el único sitio donde vive la semana, así que
decir eso sería mentira. Cubierto por
`scripts/prueba-nomina-no-guarda-callado.cjs`, que contra el árbol anterior
sale con 12 comprobaciones en rojo, entre ellas "notificó 2 semanas igual"
y "la quitó igual".

El ayudante `fsSetA` se partió en dos: `fsSetAEstricto` lanza con el error
original y `fsSetA` lo sigue envolviendo devolviendo `false`. Ningún
llamador existente cambia de conducta; el que necesita explicar el fallo
ahora tiene con qué.

### El año de las semanas de nómina va escrito, no deducido (2026-09-22)

Un registro de nómina **no guarda el año**: trae `semana` como texto y
`fecha`, que es cuándo se subió el archivo, no cuándo se rayó la semana.
La app lo deduce con una heurística (`añoSemanaNomina`): elige el año que
deja la semana más cerca de la semana ISO de la carga, con un umbral de
±26.

Para pintar la pantalla, deducir está bien: si se equivoca se ve raro y
alguien lo corrige. **Para migrar, no.** En la subcolección el año es
parte del id (`Y2026-S04`), y un id equivocado no se ve raro — la semana
aterriza en un año donde nadie la busca, o encima de otra, y se pierde en
silencio. Es el patrón del #22 otra vez, pero con el dato ya movido.

Y el margen es más fino de lo que parece. El caso más apretado que hay en
producción es la **semana 04 de la 0125**, subida el 19/6/2026:

| | |
|---|---|
| semana rayada | 4 |
| semana ISO de la carga | 25 |
| `d = 25 − 4` | **21** (umbral: 26) |
| margen | **5 semanas** |

Si esa misma carga masiva se hubiera hecho el 1/8/2026 en vez del 19/6,
`d` habría valido 27, la heurística habría dicho **2027** y la semana 4 de
2026 se habría archivado como `Y2027-S04`: un año en el futuro, invisible
para siempre. **Seis semanas de retraso en subir un Excel separan el
acierto del error**, y de eso no depende ningún dato de la obra — depende
de cuándo se acordó alguien.

Por eso el año vive escrito en
[`scripts/migracion-nomina-anios.cjs`](scripts/migracion-nomina-anios.cjs):
una tabla obra → semana → año, con la procedencia de cada bloque
documentada. Cubre las **31 semanas de calendario / 33 registros** que hay
hoy en las cinco obras; **todas son 2026**, las siete de la carga masiva
de la 0125 confirmadas por Omar el 2026-09-22.

La función `añoDeSemana(obraId, reg)` **lanza si el registro no está en la
tabla**. Es a propósito: una semana que apareció después de fijar esto es
una semana cuyo año nadie confirmó, y la migración tiene que parar y
preguntar, no adivinar (P2). Si salta, se agrega la fila con su
justificación — no se quita la comprobación.

`node scripts/migracion-nomina-anios.cjs --verificar` contrasta la tabla
contra producción: avisa de semanas que falten, que sobren, o donde la
heurística y la tabla discrepen. Hoy: 33 registros, 0 problemas.

> **Corrección (2026-09-22).** Confirmar el año no bastó: **el número de
> semana de la 0125 también está mal**, y viene de la misma fuente. Ver
> "El guion de migración y el bloqueador de la 0125" más abajo. La frase de
> arriba sobre "la semana 21 en dos archivos" era falsa — son dos semanas
> distintas colapsadas por un número mal leído.

### De cuántas fuentes sale el id de cada semana de la 0125 (2026-09-23)

Se anota por si algún día alguien encuentra una discrepancia y quiere saber
sobre qué se apoyaba cada id. **No todas las semanas están sostenidas por lo
mismo**, y la diferencia importa.

Las nueve de la carga masiva traen el periodo dentro del nombre del archivo
(`…SEM. 23 DEL 28 DE MAY AL 03 DE JUN DE 2026.xlsx`), así que el número se
puede derivar del **calendario** sin creerle a la etiqueta. Las dos de
septiembre se llaman `NOMINA_FOSMON_0125_TAMSA_VER_SEM36.xlsx`: sólo etiqueta.

| semanas | etiqueta del nombre | periodo → ISO del cierre | campo `semana` | lo que sostiene el id |
|---|---|---|---|---|
| S19 – S27 | sí | **sí** | contradice (el defecto) | **dos fuentes independientes** |
| S36, S37 | sí | **no hay** | coincide | **dos fuentes, pero una es el campo** |

En las nueve, la etiqueta y la ISO del día de cierre coinciden **en las
nueve**, y los nueve cierres caen en miércoles — la convención de TAMSA, que
corre de jueves a miércoles. Ahí el campo `semana` es un tercer testigo que
dice otra cosa, y sabemos por qué: es el número mal raspado.

En las dos de septiembre el campo coincide con la etiqueta, pero **eso vale
menos de lo que parece**: no se puede saber cuál de las dos ramas de la
expresión vieja lo produjo. En la 0125 el defecto se detectó por los ceros a
la izquierda (`"Semana 07"`, `"Semana 04"`), y con 36 y 37 las dos ramas dan
el mismo texto. El acuerdo puede ser real o puede ser casualidad.

#### Se buscó una tercera fuente y no existe

Antes de migrar se revisaron los cuatro sitios donde podría haber quedado el
periodo de esas dos cargas:

1. **Los campos del registro.** `archivo`, `fecha`, `semana`, los totales y
   `trabajadores`. Ninguna fecha de periodo, ni de inicio ni de cierre.
2. **Las instantáneas de `auditoria`.** Guardan `antes`/`despues` del
   documento completo, pero son copias de lo mismo: el juego de llaves es
   idéntico, carga por carga.
3. **El Excel original en Storage.** No está. El bucket sólo tiene fotos; el
   archivo se parsea en el navegador y nunca se sube. No es un descuido de
   estas dos cargas — no hay un solo `.xlsx` en todo el proyecto.
4. **Las filas de encabezado de la hoja.** Es donde `semanaDeNomina` busca hoy
   la fuente «de la hoja» y «el periodo», pero eso corre **al cargar**. De lo
   ya cargado sólo se guardaron las filas de trabajadores.

Lo que sí corrobora, y se deja dicho como corroboración y no como prueba:
aplicando la convención jueves–miércoles ya comprobada en las otras nueve, la
S36 cierra el miércoles 02/09 y se subió el **jueves 03/09, un día después**;
la S37 cierra el 09/09 y se subió el lunes 14/09, **cinco días después**. Las
dos encajan. Una etiqueta equivocada por una semana o más no encajaría.

**Con eso se procedió**: dos fuentes que coinciden más una fecha de carga
coherente. Pero queda escrito que S36 y S37 de la 0125 son las **únicas dos
semanas de toda la migración cuyo id no se pudo derivar del calendario**.

De aquí en adelante el problema no se repite: `semanaDeNomina` exige que las
fuentes disponibles coincidan y, si no, deja `semana` vacía y **pregunta a
quien sube el archivo**, que es el único con el Excel delante.

### El guion de migración y el bloqueador de la 0125 (2026-09-22)

[`scripts/migrar-nomina-subcoleccion.cjs`](scripts/migrar-nomina-subcoleccion.cjs).
**Sin `--escribir` no toca nada**; el ensayo lee, agrupa, valida y enseña lo
que haría.

> **Estado al 2026-09-23 — las cinco obras migradas.** Corrió en modo
> escritura sobre **0127, 0112, 0126, 0125 y 0114**, una por una, cada una
> verificada releyendo producción por fuera del guion: 32 documentos, 33
> partes, 2,394 nombres idénticos al origen, $15,483,487 cuadrados, cero
> caracteres de reemplazo. El documento viejo sigue intacto en las cinco: la
> bandera cambia de formato, no borra nada. Vaciarlo es un paso aparte, a
> mano, y **no se hace hasta que lleve días sin incidencias**.

El orden está fijado a propósito: leer y agrupar → validar TODO → escribir →
**volver a leer y comparar contra el origen** → y solo entonces levantar la
bandera. Media obra migrada es peor que ninguna, y con la bandera al final
lo peor que deja una interrupción es una subcolección incompleta que nadie
lee todavía. El documento viejo no se borra: es la red y es contra lo que
compara `avisarSiFaltanSemanas`.

**El ensayo encontró un bloqueador en la 0125.** La 0125 agrupaba dos
archivos de semanas distintas —"SEM. 22 DEL 21 DE MAY" y "SEM. 23 DEL 28 DE
MAY"— en un mismo `Y2026-S21`. El campo `semana` de sus nueve registros de
carga masiva no guarda el número de semana, guarda un número suelto raspado
del encabezado que en ocho de los nueve casos coincide con el **día del mes**
en que empieza el periodo (la SEM. 23 empieza el 28 y guardó 21: ahí ni eso):

| archivo dice | campo guarda | id al que iría |
|---|---|---|
| SEM. 19 (30 abr) | Semana 30 | `Y2026-S30` |
| SEM. 20 (07 may) | Semana 07 | `Y2026-S07` |
| SEM. 21 (14 may) | Semana 14 | `Y2026-S14` |
| SEM. 22 (21 may) | Semana 21 | `Y2026-S21` |
| SEM. 23 (28 may) | Semana 21 | `Y2026-S21` ← encima de la anterior |
| SEM. 24 (04 jun) | Semana 04 | `Y2026-S04` |
| SEM. 25 (11 jun) | Semana 11 | `Y2026-S11` |
| SEM. 26 (18 jun) | Semana 18 | `Y2026-S18` |
| SEM. 27 (25 jun) | Semana 25 | `Y2026-S25` |

**La causa está en `parsearNomina`**, que raspa la semana de las filas de
encabezado del Excel. Lo que está **probado**: el único que escribe ese campo
es ese raspado; el valor pasó por el respaldo `/s\.?\s*(\d{2})/i` y no por la
expresión principal (producción guarda literalmente `"Semana 07"` y
`"Semana 04"` —con cero delante, y solo `(\d{2})` captura dos dígitos fijos—,
mientras que `/semana\s*(\d+)/i` ni siquiera casa con `"SEM. 20"`, y la rama
de fechas habría escrito `"30 DE ABR AL 06…"`, no `"Semana NN"`); ese respaldo
muerde cualquier palabra acabada en «s» pegada a dos dígitos (`"SERVICIOS 30"`
→ 30, `"DIAS 21"` → 21, `"LOS 04"` → 04); y el bucle no corta, así que gana la
última fila que empate.

Lo que **no** está probado: qué celda exacta produjo cada número. No se puede
reconstruir sin los Excel originales, y no hace falta para arreglarlo.

Ojo con la tentación de "ponerle `break`": no arregla nada. Con las filas
`["NOMINA SEMANAL","TOTAL DIAS 21","SEMANA 23"]`, sin `break` sale 23 y con
`break` sale 21 — las dos mal, por motivos distintos.

Las otras cuatro obras usan `NOMINA_FOSMON_xxxx_SEMnn.xlsx` y salen bien por
casualidad del formato, no porque el código lo resuelva.

Esto obliga a corregir dos cosas escritas antes: la nota de que "la semana 21
de la 0125 vino en DOS archivos: misma semana" es falsa, y la tabla de
`AÑOS['0125']` documenta ocho números que no son semanas. Arreglar el año no
arregló el número **porque ambos salen de la misma fuente y solo se verificó
uno**.

**Cómo lo para el guion.** La semana del nombre del archivo —que la escribió
una persona— es la segunda opinión. Si discrepa del campo, la migración no
elige: para la obra entera y lo dice. Un id de semana equivocado no se ve
raro (la semana aterriza donde nadie la busca, o encima de otra) y es
irreversible una vez vaciado el documento viejo.

Ensayo de hoy, sin escribir nada:

| obra | registros | semanas | estado |
|---|---|---|---|
| 0112 | 2 | 2 | limpia |
| 0114 | 14 | 14 | limpia |
| 0125 | 11 | — | **bloqueada**: 9 registros con semana no confiable |
| 0126 | 4 | 3 | limpia (S38 sí es un cierre en dos archivos) |
| 0127 | 2 | 2 | limpia |

**Resuelto (2026-09-22).** Las nueve semanas correctas están escritas a mano
en la tabla `SEMANAS` de `scripts/migracion-nomina-anios.cjs`, indexadas por
**nombre de archivo** —no por el campo `semana`, que tiene una colisión: dos
registros dicen "Semana 21"— y cada una con su procedencia. Con eso el ensayo
queda limpio en las cinco obras (0125: 11 registros → 11 semanas).

Y `parsearNomina` se arregló en la rama `fix/semana-nomina`, **antes** de
migrar: si hubiéramos migrado primero, la siguiente nómina que suba TAMSA
volvería a meter un documento con el id equivocado. Ahora la semana se
contrasta entre tres fuentes —la hoja, el nombre del archivo y la semana de
calendario del periodo, tomada por el día de **cierre**— y si no coinciden la
pantalla pregunta y no deja guardar. Ver `scripts/prueba-semana-de-nomina.cjs`.

**Qué más quedó mal etiquetado.** Medido con
[`scripts/medir-dano-semana-0125.cjs`](scripts/medir-dano-semana-0125.cjs),
que corre el recorrido real de la app (el oyente de `nomina/historial` se
extrae de `src/App.jsx`) sobre los datos de producción, dos veces: con los
números guardados y con los corregidos.

Ningún otro **campo** deriva del número. Lo que el número decide es el
**orden**, y de ahí cuelga todo lo demás:

| | hoy | de verdad |
|---|---|---|
| orden en pantalla | 04→07→11→14→18→21→25→30→36→37 | 19→20→21→22→23→24→25→26→27→36→37 |
| filas del historial | 10 | 11 |
| bajadas de plantilla en la curva | 4 | 1 |
| semanas sin captura aparentes | 24 | 8 |

Y una fila que nunca existió: «Semana 21» con 83 trabajadores y $400,546,
que es SEM. 22 (50 personas, $240,546) fundida con SEM. 23 (33, $160,000).

Cada cierre además aparece en otro mes: la SEM. 24 (junio) se enseña como
S04 (enero), la SEM. 19 (mayo) como S30 (julio), la SEM. 26 (junio) como S18
(abril).

**Lo que NO está afectado**, comprobado uno por uno para no inflar el daño:

- Los KPIs de semana actual/anterior y sus deltas —personal, nómina, HE,
  altas, bajas, top incremento— se calculan **solo entre las dos últimas**
  (`src/App.jsx:13449-13450`), que en la 0125 son S36 y S37, correctas. La
  medición da cifras idénticas con números buenos y malos.
- Ver una semana vieja en el desplegable no calcula deltas: el `delta` por
  trabajador solo sale si `semVer===semanaActual` (`src/App.jsx:13923-13926`).
- El sparkline de "tendencia de gasto por rubro" y las "semanas anómalas"
  (`src/App.jsx:10947`) se alimentan de `gpData.semanasDisponibles` —GP,
  gastos— y no tocan la nómina.
- El **correo de resumen semanal** no lee nómina: `calcularKpisObra` en
  `functions/index.js` no la abre.
- El **recordatorio de captura** (`functions/index.js:1330-1344`) lee
  `obras/{id}/avance/historial` con el id de semana ISO. Es avance, no nómina.

**Un defecto distinto que salió al mirar** (no es del número de semana):
cuatro lectores siguen tomando `nominaHistorial[length-1]`, el arreglo **en
orden de carga**, en vez de la semana de calendario: el PDF
(`src/App.jsx:1158`) y los tres avisos de nómina `nom_001`, `nom_002` y
`nom_003` (`src/App.jsx:3136, 3150, 3168`). Es el mismo defecto que arregló
`semanasDeNomina` en el panel, y estos cuatro no se enteraron. En la 0125 no
hace daño porque la última carga es la S37 y es correcta; en la **0126** sí:
su S38 vino en dos archivos, así que el PDF y los avisos leen solo la segunda
parte —35 trabajadores en vez de 134, $152,950 de $655,553—. Rama aparte.

De rebote: los "5 semanas de margen" que esta misma nota documentaba como el
caso más apretado de la heurística del año eran un artefacto del número mal
leído. Con el número correcto, ese registro tiene 25 semanas de margen.

**¿Y los otros parsers?** Revisados. `parsearPresupuesto` —que es también el
de subcontratos, lo reusa— tiene un respaldo de encabezado igual de permisivo
(toma la primera fila con ≥3 celdas de texto), pero corta al primer acierto y
no inventa ningún valor por omisión; y sobre todo, **enseña lo que leyó antes
de guardar**: presupuesto pasa por `fase = 'revisando'` y subcontratos por su
panel de import. La nómina era el único sitio donde el parser escribía sin
que nadie viera lo que había entendido. Por eso el defecto era solo suyo.

### Movimiento 1 de la migración de nómina: leer los dos formatos (2026-09-22)

En `feature/historial-subcoleccion`. **Se lee de los dos sitios; se sigue
escribiendo solo en el viejo.** Ningún dato se ha movido todavía.

**La regla de Firestore va primero, antes que el código.** Se agregó
`match /obras/{obraId}/nomina_historial/{semanaId}` con los mismos permisos
que el documento que reemplaza: lee quien ve la obra y no es cliente,
escribe quien la edita. Sin ella la ruta cae en el `match /{document=**}`
final —que deniega todo— y, como las escrituras pasan por ayudantes que se
tragan el fallo (#22), la migración parecería funcionar mientras no guarda
nada. Es exactamente lo que le costó tres años de silencio al histórico de
subcontratos (#31).

**La bandera decide, nunca el vacío.** `config/info` lleva
`formatoHistorial: { nomina: 1 | 2 }` y `formatoHistorial(info, cual)` solo
devuelve 2 si el valor es **exactamente** el número 2: `true`, `"2"`, `null`
y el campo ausente son formato 1. Deducir el formato de los datos —"si la
subcolección trae documentos, está migrada"— es el error que convierte una
lectura fallida en una obra sin historial. Por eso, si no se puede leer
`config/info`, `leerHistorialNomina` **lanza** en vez de caer al formato
viejo por omisión: no saber qué formato tiene una obra no es lo mismo que
saber que tiene el viejo.

**La guarda que grita.** `avisarSiFaltanSemanas` compara, cuando la bandera
dice 2, las claves de la subcolección contra las del documento viejo. Si al
viejo le quedan semanas que la subcolección no tiene, lanza con la lista de
claves faltantes. Se calla sola cuando el documento viejo queda vacío, que
es la señal de que la migración terminó. Cubre el caso que de verdad da
miedo: una migración a medias que la pantalla pinta como historial completo.

**Las Cloud Functions quedan fuera, y es una decisión, no un olvido.**
`functions/index.js` no lee `obras/{id}/nomina/historial` en ningún sitio —
las dos únicas apariciones de "nomina" son elementos de los arreglos de
permisos por rol. Copiar el ayudante de la bandera sin un lector que lo use
sería código muerto que se desincroniza en silencio con el de `App.jsx`, y
el día que hiciera falta nadie recordaría que hay dos copias. **Requisito
para la primera función que lea nómina: tiene que mirar
`formatoHistorial.nomina` de `config/info`, no la existencia de la
subcolección.** Si esta línea se ignora, la función leerá el documento viejo
—vacío tras la migración— y reportará una obra sin nómina.

**El id es `Y2026-S38`**, no `S38-2026` como decía la propuesta de arriba:
con el año delante y la semana a dos dígitos, ordenar por nombre es ordenar
por calendario. Con el otro orden, la semana 1 de 2027 se colaría entre las
de 2026.

Pruebas:

| guion | qué afirma | contraprueba |
|---|---|---|
| [`prueba-formato-historial.cjs`](scripts/prueba-formato-historial.cjs) | 20 comprobaciones: quién decide el formato, que un fallo de lectura no sea lista vacía, la guarda, la bandera por historial | deducir el formato de los datos → 1 roja · quitar la guarda → 3 rojas · subcolección vacía → 4 rojas |
| [`prueba-reglas-nomina-subcoleccion.cjs`](scripts/prueba-reglas-nomina-subcoleccion.cjs) | 10 comprobaciones contra el emulador: se escribe, se relee con sus partes, se **lista** (`get` y `list` son permisos distintos), ordena por calendario, y discrimina — otro residente rebota, el cliente no ve sueldos | quitar la regla → cae en la primera comprobación |

La segunda prueba se escribió **antes** de mover un solo dato, y no
comprueba que la regla exista en el archivo: intenta escribir contra un
Firestore de verdad y mira si la escritura llega. Un `match` puede existir
y no aplicar.

Falta el movimiento 2: el guion de migración y el cambio de los dos sitios
de escritura.

### La salida: cómo se vuelve al documento viejo (2026-09-23)

[`scripts/revertir-bandera-nomina.cjs`](scripts/revertir-bandera-nomina.cjs).
Baja `formatoHistorial.nomina` de 2 a 1. **No hace falta desplegar código**:
la bandera es dato, y el camino de lectura del formato 1 sigue vivo y
probado. La app vuelve al documento viejo en la siguiente carga de pantalla.

**Lo que hace que esto no sea trivial: la escritura NO es dual.**
`escribirHistorialNomina` escribe en UN formato, el que diga la bandera. Con
la bandera en 2 una nómina capturada entra **sólo** a la subcolección. Bajar
la bandera ese día no borra esa captura, pero **deja de enseñarla**, y una
semana que nadie sabe que existe no la reclama nadie.

De ahí la regla, en una línea:

> Revertir es gratis mientras nadie haya capturado nómina después del
> despliegue. En cuanto alguien captura, hay que copiar antes.

Por eso el guion no baja la bandera a ciegas: compara el documento viejo
contra la subcolección con la **misma huella** que usa la migración —contar
no basta, corregir una carga deja el mismo número de registros—, y si la
subcolección tiene algo que el viejo no tiene, se planta y **nombra el
archivo, la semana, la gente y el dinero** que escondería. Para revertir
igual hay que pedirlo con `--reconciliar`, que copia la subcolección al
documento viejo **antes** de bajar la bandera y vuelve a leer las dos partes
para comprobarlo.

El caso peor es el documento viejo **ya vaciado a mano**: ahí revertir
dejaría la pantalla en cero semanas, y `avisarSiFaltanSemanas` no lo
atraparía porque sale temprano cuando el viejo está vacío
(`if (antes.length === 0) return;`). El guion lo trata como bloqueo aparte,
con motivo `vacio`. **Ésa es la razón de no vaciar los documentos viejos el
mismo día**: mientras estén llenos, la salida es un guion de dos minutos.

Revertir **no desmigra**: la subcolección se queda entera, para volver a
intentarlo sin migrar de cero.

Ensayo contra producción el 2026-09-23, antes de mezclar: las cinco obras
inocuas, documento viejo y subcolección con las mismas cargas y el mismo
dinero (0112 $447,651 · 0114 $7,299,715 · 0125 $5,484,664 · 0126 $1,962,457 ·
0127 $289,000).

`scripts/prueba-revertir-bandera.cjs` no mira el código: corre el guion
entero contra un Firestore de mentiras y apunta **qué intenta escribir** —si
manda el PATCH, con qué máscara, en qué orden— y le parte el cuerpo de la
respuesta dentro de un carácter multibyte, como lo parte la red (#34).

### Cuándo se pueden vaciar los documentos viejos — NO ANTES DEL 2026-09-30

Desplegado el **2026-09-23**: producción lee de la subcolección en las cinco
obras desde ese día. Los cinco `obras/{id}/nomina/historial` siguen llenos e
intactos **a propósito**, y así se quedan hasta que se cumplan las cuatro
condiciones de abajo.

**Fecha más temprana: 2026-09-30.** Una semana corrida desde el despliegue.
La fecha sola no basta; es el piso, no el permiso.

- [ ] **2026-09-30 o después.** Siete días desde el 2026-09-23.
- [ ] **Una vuelta completa de capturas normales**, no un calendario vacío.
      Los cierres son de miércoles a miércoles, así que la ronda del
      2026-09-23 se sube entre el jueves 24 y el domingo 28. Que se haya
      capturado **en el formato nuevo** y que se vea en pantalla.
- [ ] **Cero incidencias de nómina** en esa semana: nada de semanas que no
      aparecen, cifras que no cuadran, o la guarda `avisarSiFaltanSemanas`
      gritando. Si hubo una, el reloj se reinicia — no se descuenta.
- [ ] **Un respaldo posterior a la migración, verificado SUCCESSFUL.** El cron
      corre los domingos; el primero que sirve es el del **2026-09-27**, que
      además es su primera prueba real desde el arreglo del 2026-09-21 (ver
      #5). Sin respaldo bueno después de migrar, vaciar es el único paso de
      todo esto que no tiene vuelta atrás.

**Por qué el criterio es éste y no una fecha a secas.** Mientras los
documentos viejos estén llenos, volver atrás cuesta dos minutos: se baja la
bandera y la pantalla vuelve al formato de siempre. **Vaciados, la reversa
deja de existir** — bajar la bandera dejaría la nómina en cero semanas, y la
guarda no lo atraparía porque sale temprano cuando el viejo está vacío. El
único camino sería reconciliar desde la subcolección, que es justo el estado
del que se quería poder escapar.

Lo que se gana vaciando es espacio en un documento que ya nadie lee. Lo que
se pierde es la salida. Una semana de espera no cuesta nada; equivocarse en
el orden, sí.

**Cuando toque**, la subcolección queda como única fuente: antes de vaciar,
correr `node scripts/revertir-bandera-nomina.cjs` (ensayo, sólo lectura) y
exigir que las cinco digan **inocuo** — eso prueba que el viejo no tiene nada
que la subcolección no tenga, que es la condición para que borrarlo no pierda
un dato.

### Qué se puede rescatar de las siete semanas perdidas (2026-09-21)

Los siete cierres oficiales que no llegaron al historial, con lo que hay
para reconstruirlos. **Nada de esto está escrito todavía.**

| semana | cierre oficial | fuente del estado por partida | reconstruible |
|---|---|---|---|
| 32 | 2026-08-07 22:57 | — | **no** |
| 33 | 2026-08-15 17:07 | — | **no** |
| 34 | 2026-08-21 23:36 | — | **no** |
| 35 | 2026-08-28 23:04 | — | **no** |
| 36 | 2026-09-04 23:31 | — | **no** |
| 37 | 2026-09-11 23:13 | respaldo `2026-09-11-preseguridad` | **sí, completa** |
| 38 | 2026-09-19 05:59 | respaldo `2026-09-21` y `avance/subs` en vivo | **sí, completa** |

**Cómo se verificó.** Los respaldos son ficheros log de LevelDB con
`EntityProto` dentro; se leyeron sin restaurar nada. El contraste no es
"parece la fecha correcta": de cada fuente se recalculó el promedio simple
de `a` de las 335 partidas y se comparó con el que la bitácora guardó en el
cierre. Semana 37: 82.13134 contra 82.13134. Semana 38: 83.75821 contra
83.75821. Coinciden al quinto decimal, así que la fuente es exactamente el
estado del cierre y no uno cercano.

Reconstruidas darían:

| | semana 37 | semana 38 |
|---|---:|---:|
| `avancePonderado` | 87.59354% | 88.86187% |
| `montoEjecutado` | $143,393,327.00 | $145,469,620.28 |
| `contratoRef` | $163,703,079.43 | $163,703,079.43 |

**Por qué las otras cinco no.** La bitácora sí registró los siete cierres,
pero su `meta` solo guarda `avancePromedio`, que es el **promedio simple de
`a` entre las 335 partidas** — no el `avancePonderado` que el snapshot
necesita, que es ejecutado/contrato. No son la misma cifra ni se puede pasar
de una a la otra: en la semana 37 difieren 5.46 puntos y en la 38, 5.10.

Los registros de auditoría sí traen `antes`/`despues` con el estado por
partida, pero **recortado a las primeras 50 de 335**, siempre las mismas.
Esas 50 son el 28.0% del catálogo; las 285 que faltan son el 72.0% del
dinero. Con eso no sale ninguna cifra de obra.

**Las semanas 32 a 36 quedan como hueco declarado.** La gráfica tiene que
mostrar que ahí no hay dato y por qué, no interpolar entre la semana 30 y
la 37. Una línea recta entre esos dos puntos inventaría un avance que nadie
midió, y es exactamente lo que el P2 prohíbe.

### Hecho — 2026-09-22

Compactado y rescatado, en ese orden y verificando cada paso:

| | antes | después |
|---|---:|---:|
| tamaño de `obras/0114/avance/historial` | 983,579 B (93.8%) | 161,017 B (15.4%) |
| snapshots | 8 | 10 |
| días sin captura que mostraba el tablero | 62 | 3 |

Las semanas 37 y 38 se escribieron con `esquema: 3`, porque se calcularon
con la definición vigente de avance. Sin esa marca el salto de 69.7% a 87.6%
se leería como avance de obra cuando es, en parte, cambio de criterio; con
ella, `sonComparables` corta ahí sola.

Las 32 a 36 **no** se escribieron. La gráfica ya las declara: la línea va de
medición a medición y el trecho entre dos semanas no consecutivas queda
punteado, con los extremos marcados y una leyenda que dice que ahí no hubo
cierre. Sin umbral de tolerancia — una semana sin cierre es una semana sin
dato, sean una o seis.

### Los respaldos caducan a los 112 días

El bucket `gs://campo-fosmon-backups` borra por regla de ciclo de vida a los
**112 días**. Para las semanas 37 y 38 ya da igual —se rescataron el
2026-09-22, y las fuentes quedaron copiadas en `~/campo-backups/`—, pero la
regla vale para **cualquier rescate futuro** y conviene tenerla a mano:

| respaldo | se borra hacia | qué se pierde con él |
|---|---|---|
| `2026-09-11-preseguridad` | **2027-01-01** | única fuente de la semana 37 |
| `2026-09-21` | **2027-01-11** | fuente de la semana 38 |

La consecuencia general: **un cierre perdido es reconstruible durante 112
días y ni uno más.** Pasado ese plazo no hay de dónde sacar el estado por
partida y la semana queda como hueco para siempre — la bitácora sola no
basta, porque guarda `avancePromedio` y recorta el detalle a 50 partidas.
Por eso el #22 (fallos silenciosos) es urgente y no cosmético: cada semana
que un fallo pase inadvertido consume plazo de rescate.

---

## 29. Falta el índice de `auditoria` por `obraId` — la bitácora filtrada sale vacía

**Descubierto**: 2026-09-21, consultando la bitácora de la 0114 para el
diagnóstico del #28. Prioridad **alta**.

Una consulta a `auditoria` con `where('obraId','==',…)` más
`orderBy('ts')` necesita un **índice compuesto**. No existe. Firestore
responde con un error de índice faltante, y el código de lectura lo
convierte en lista vacía.

El resultado es el peor de los posibles: **la pantalla no dice "no se pudo
consultar", dice que no hubo actividad.** Una obra con siete cierres
semanales registrados se ve idéntica a una obra abandonada. Es la misma
familia del #22 y del P2: un fallo disfrazado de dato.

En el diagnóstico se esquivó consultando por rango de fechas y filtrando
en memoria, que no escala.

**Qué hace falta**:

1. Declarar el índice compuesto `auditoria(obraId ASC, ts DESC)` en
   `firestore.indexes.json` y desplegarlo.
2. Revisar qué más filtra `auditoria` — si hay consultas por `modulo` o
   por `usuario` con orden, necesitan su propio índice.
3. Y que el fallo de consulta **no se traduzca en lista vacía**: un error
   de índice tiene que llegar a la pantalla como "no se pudo consultar la
   bitácora", nunca como "sin actividad".

Ver [AUDITORIA_CONSULTAS.md](AUDITORIA_CONSULTAS.md) para las consultas
que ya se usan.

---

## 30. El catálogo vivo `avance/subs` se llena, y lo llenan las URLs de las fotos — no las partidas

**Descubierto**: 2026-09-22, midiendo producción al retirar el #31.
**BLOQUEANTE DE DEMO**, prioridad **crítica**. Hermano del #28, pero **no
es el mismo pendiente**: el #28 es el historial semanal, que crece con el
tiempo y se puede recortar con `slice(-52)`. Este es el catálogo **vivo**,
el estado de hoy. No se puede recortar: si no cabe, no cabe, y si no cabe
el residente no puede capturar.

### El hallazgo, en una línea

**El peso lo mandan las URLs de las fotos, no las partidas.** La
intuición —"pocas partidas, documento chico"— es falsa, y por eso esto no
se iba a ver venir.

En la 0112, con **14 partidas**, las fotos son el **85% del documento**:
4,225 B por partida contra 845 B en la 0114, que tiene 335. Una sola
partida de la 0112 carga **10.5 KB solo de URLs** — unas 44 fotos.

El motivo es que cada foto guarda su **URL de descarga completa de
Firebase Storage, con token**, dentro del documento del catálogo:

```
https://firebasestorage.googleapis.com/v0/b/campo-fosmon.firebasestorage.app/
  o/obras%2F0112%2Ffotos%2Favance_SIOP-JS-MRN-001__8%2Fmbpir52ggxb
  ?alt=media&token=2990ecfc-27e2-43e7-b531-f02191a5f0b8
```

Unos **240 bytes por foto**, de los cuales lo único que no es plantilla
son el id de obra, la clave de la partida y el id de la foto. Y las fotos
**no se recortan nunca**: se acumulan mientras dure la obra. Es el único
campo del documento que crece sin tope y sin que nadie decida que crezca.

**La consecuencia que hay que entender**: una obra de 14 partidas puede
llenar el documento antes que una de 461. La 0112 no tiene un catálogo
grande — tiene un residente que toma muchas fotos, que es exactamente lo
que queremos que haga.

### La URL no hace falta guardarla

Es **reconstruible desde la ruta**. El patrón es fijo:

```
obras/{obraId}/fotos/avance_{idPartida}/{fotoId}
```

y el SDK de Storage arma la URL a partir de ahí (`getDownloadURL`), o se
sirve directo si el bucket lo permite. Lo único irreductible por foto es
**`id` y `fecha`** — unos 40 bytes contra 240. **Divide el campo entre
seis**, y es el cambio más barato de los tres: no toca el esquema del
catálogo, solo deja de escribir un campo derivable.

**Corrección (2026-09-22): el segmento no es la clave, es el id de la
partida — y el id lleva dentro el índice del arreglo.** `addFoto` escribe
en `avance_${subId}` con `subId = ${clave}__${idx}`; de ahí el `__8` del
ejemplo de arriba. Eso cambia el riesgo del plan, no el plan: la clave es
estable, el índice no. Si al recargar el catálogo una partida cambia de
posición, la ruta reconstruida apunta a donde no está el archivo y la
foto sale rota. Hoy la URL guardada tapa ese problema porque apunta al
sitio viejo pase lo que pase. **Antes de dejar de guardar la URL hay que
estabilizar el id de la partida** —que no dependa del índice— o guardar
por foto la ruta de Storage en vez de la URL completa: sigue costando
mucho menos que 240 bytes, pero deja de ser gratis. Medido el mismo día:
las 475 fotos de producción están todas bajo llaves que su partida
todavía reconoce, así que el arreglo se puede hacer sin rescatar nada.

El token del query string, además, es una razón aparte para no guardarlo:
es un secreto de acceso replicado en un documento que leen todos los roles
con permiso de lectura de la obra, y si alguna vez se rota, **todas las
URLs guardadas quedan muertas a la vez** y no hay de dónde regenerarlas
salvo… reconstruyendo la ruta. O sea: el arreglo es también el plan de
contingencia.

### Los números

Medido contra producción con las reglas de tamaño de Firestore:

| obra | partidas | documento hoy | B/partida | revienta a |
|---|---|---|---|---|
| 0112 | 14 | 68 KB (6.6%) | 4,957 | **211 partidas** |
| 0114 | 335 | 276 KB (27.0%) | 845 | 1,240 partidas |
| 0125 | 461 | 110 KB (10.7%) | 243 | 4,308 partidas |
| 0126 | 51 | 44 KB (4.3%) | 885 | 1,184 partidas |
| 0127 | 112 | 63 KB (6.1%) | 572 | 1,832 partidas |

El "revienta a" sale del peso por partida de **hoy**. Como las fotos
siguen entrando, ese número **baja con el uso**: no es un techo fijo, es
el techo de esta semana.

Desglose por campo, que es donde se ve de dónde viene el peso:

| obra | 1º | 2º | 3º |
|---|---|---|---|
| 0112 | `fotos` **85%** | `sub` 10% | `ruta` 2% |
| 0114 | `sub` 44% | `ruta` 19% | `fotos` 17% |
| 0125 | `ruta` 21% | `sub` 20% | `cat` 10% |

Dos maneras distintas de llenarse, y hay que arreglar las dos: la 0114 se
llena por **catálogo** (descripción y ruta, ~63%), la 0112 por **fotos**.
Un municipio con catálogo grande tiene las dos a la vez.

Y hay un segundo filo: **un catálogo de 2,000 o 3,000 partidas no cabe el
día que se da de alta.** No es que se llene con el uso — no entra. Por eso
esto bloquea demo con un cliente de ese tamaño, igual que el #28.

Cuando reviente, revienta peor que el #28: `fsSetA` propaga el fallo —ya
lo hace desde `fix/robustez`, así que al menos se verá—, pero el catálogo
es lo que se escribe **en cada guardado de avance**. El residente no
pierde una semana: **se queda sin poder capturar la obra**.

### Qué hace falta, en orden de rendimiento por esfuerzo

1. **Dejar de guardar la URL de la foto.** La más barata y la que más
   rinde en la 0112. Se guardan `id` y `fecha` y la URL se arma desde
   `obras/{obraId}/fotos/avance_{idPartida}/{fotoId}` al pintarla.
   ~240 B → ~40 B por foto, **entre seis**. No cambia el esquema del
   catálogo ni la pantalla: solo deja de escribir un campo derivable.
   Hace falta un paso de lectura que acepte las dos formas mientras
   queden URLs viejas guardadas, y un barrido que las tire. **Requisito
   previo**: estabilizar el id de la partida, porque hoy lleva el índice
   del arreglo y la ruta reconstruida se rompería al reordenar el
   catálogo (ver la corrección de arriba).
2. **Sacar la descripción (`sub`) y la ruta**, igual que se hizo en los
   snapshots: viven en el catálogo maestro y se cruzan por `sec`. Es el
   63% de la 0114. Un poco más de trabajo que el punto 1 porque hay
   pantallas que leen `sub` directo del catálogo vivo.
3. **Las fotos a su propia subcolección** `obras/{id}/fotos/{partida}`.
   Con el punto 1 hecho esto deja de correr prisa, pero es lo que quita
   el crecimiento sin tope de raíz.
4. **Un documento por partida en subcolección**, el fondo, lo único que
   de verdad quita el techo. Mismo trabajo que el #28 y conviene hacerlo
   en la misma migración.

**Medir antes de tocar**: cargar un catálogo de 2,000 partidas en el
proyecto de pruebas (#4) y ver en qué punto rebota de verdad. La tabla de
arriba extrapola desde obras vivas, que ya traen fotos; un catálogo
recién cargado pesa distinto por partida.

**Nota de método**: los números salieron de medir producción con
`tamañoFirestore` extraído del propio `src/App.jsx` por AST, no con
`JSON.stringify`, que da otra cifra. Si se rehace la medición, hacerlo
igual. El guion está en `scripts/medir-fotos.cjs` (solo lee).

---

### El #30 no es un problema de peso: la evidencia no es consultable (2026-09-22)

Replanteado con Omar el mismo día. El peso es el síntoma; el problema es
que **el director de operaciones quiere abrir las fotos de hace tres
semanas para enseñarle a un cliente cómo cambió la obra, y hoy no
puede.** La evidencia fotográfica es el diferenciador del producto, y
está guardada de una forma que no admite la única pregunta que se le
hace: *¿cómo se veía esto en la semana 12?*

**Lo que hay hoy, medido** (`scripts/medir-fotos.cjs`, 475 fotos):

| | |
|---|---|
| ¿se acumulan sin limpiarse? | **sí**, 63 días conviviendo; nada las recorta nunca |
| ¿la foto sabe su semana? | **no**. Solo `{id, url, fecha}`, y `fecha` es la de **subida**, no la de la toma |
| máximo en una partida | **43** (0112 `SIOP-JS-MRN-001`) |
| ¿sobreviven al recambio de catálogo? | solo si la `clave` coincide; el mapa se copia con las llaves viejas |
| ¿se puede ver una semana? | **no**. Ni filtro, ni orden por fecha, ni agrupación |

El ritmo real por semana, que es lo que decide si un tope estorba:

| obra | semanas con fotos | por semana |
|---|---|---|
| 0112 | **1** (S30) | 255 de golpe — una carga masiva, no trabajo semanal |
| 0114 | 6 (S30, 32, 33, 36–38) | 31 a 45 |
| 0126 | 2 (S37, S39) | 14 y 18 |

**Sobre el tope de 3-4 fotos por partida por semana: no.** Los números
dicen que no hace falta y que además dolería. El 0112 acumula 255 fotos
en **una sola semana** porque fue un volcado histórico; la 0114, que es
captura semanal de verdad, mueve 30-45 por obra y hasta 8 por partida.
Un tope de 3-4 recortaría a la mitad la obra que mejor documenta. Y el
tope ataca el peso, que es justo lo que la subcolección resuelve sin
borrar nada. **La evidencia vieja no se borra: se archiva por semana.**

### Las fechas, comprobadas contra Storage (2026-09-22)

La tabla de arriba decía "255 de golpe" apoyándose en que las 255 fotos
de la 0112 comparten la misma `fecha`. Ese campo lo escribe el cliente, y
una conclusión que depende de un solo campo escrito por el cliente no
vale nada hasta que otra fuente la confirme. **Omar lo señaló; se
comprobó.** `scripts/medir-fechas-fotos.cjs` pregunta a dos fuentes que no
pasan por el reloj del teléfono: el `timeCreated` que Storage le pone a
cada objeto, y el `ts` de la bitácora.

**El campo `fecha` es fiel.** Se escribe una vez por foto, en el momento
de agregarla (`src/App.jsx:10430`, `new Date().toISOString().slice(0,10)`),
y nadie lo reescribe después: `delFoto` solo filtra y guardar el catálogo
copia el objeto foto tal cual. La prueba no es leer el código, es que
**los días coinciden uno a uno con Storage**: 1 de 1 en la 0112, **11 de
11** en la 0114, 4 de 4 en la 0126. Si se reescribiera al guardar, las 188
fotos de la 0114 compartirían la fecha del último guardado en vez de
repartirse en once días distintos.

**Consecuencia para la migración: la semana se puede reconstruir.** No
hace falta marcar nada como "fecha desconocida". Cada foto sabe su día con
la precisión de un día, verificada contra el servidor.

Lo que dicen las tres fuentes, ya solo sobre las fotos de **avance** —
bajo `obras/{id}/fotos/` cuelgan además documentos de subcontrato
(`subdoc_`), fotos de concepto (`sub_`) y documentos de obra:

| obra | fotos en Storage | semanas | días | capturas de avance en bitácora | veredicto |
|---|---:|---:|---:|---|---|
| 0112 | 255 | 1 | **1** (24/7) | 14 en 5 semanas | **volcado**, confirmado |
| 0114 | 238 | 6 | 12 | 60 en 14 semanas | **acumulación** semanal |
| 0126 | 44 | 2 | 4 | 25 en 7 semanas | acumulación, arranque reciente |

El volcado de la 0112 era real. Pero la bitácora corrige la otra mitad de
la lectura: **la 0112 sí se captura** —14 cierres de avance repartidos en
cinco semanas, hasta el 21 de septiembre—, lo que no ha vuelto a hacer es
subir fotos. No es una obra abandonada con un archivo histórico encima: es
una obra activa cuya evidencia fotográfica se quedó en julio. Esa es
justamente la obra donde el director no puede enseñar "cómo se veía hace
tres semanas".

**El tope de 3-4 sigue descartado, y ahora por una razón más:** la 0114
mueve hasta **61 fotos en una semana** (S32) contando las de Storage. Un
tope no habría evitado el volcado de la 0112 —que fue una sola semana— y
sí habría cortado a la obra que documenta bien.

### 62 fotos están en Storage y no en el catálogo

Hallazgo lateral de la misma medición, y no es contable:

| obra | en Storage | referenciadas en `avance/subs` | sin referencia |
|---|---:|---:|---:|
| 0112 | 255 | 255 | 0 |
| 0114 | 238 | 188 | **50** |
| 0126 | 44 | 32 | **12** |

Hay **dos causas posibles y hoy no se pueden distinguir**:

1. `delFoto` (`src/App.jsx:10444`) quita la foto del documento y **no
   borra el objeto de Storage**. Toda foto borrada a propósito deja su
   objeto atrás. Es lo esperable y no es pérdida de nada.
2. La subida llegó y la escritura del catálogo no. Es la firma del #22:
   `uploadFoto` sí lanza si falla, pero el guardado posterior del catálogo
   pasa por los ayudantes mudos. En ese caso el residente vio su foto
   subir y nadie volverá a verla.

No se puede afirmar cuál es. **Lo que sí se puede afirmar es que hoy no
hay manera de saberlo**, y que la mitad de las fotos de la 0126 sin
referencia (12 de 44, 27%) se subieron la misma semana en que se
capturaba. Dos cosas del diseño de arriba lo resuelven de paso: si la foto
vive en su documento de semana, un objeto sin documento es inequívoco; y
si borrar es un acto explícito, se puede borrar de los dos sitios.

Mientras tanto son bytes que se pagan y no se ven. No urge; conviene
anotarlo antes de que la próxima medición los cuente como fotos vivas.

### Cómo debería quedar

**1. La foto guarda su semana, y las fotos salen del catálogo.**
Subcolección con el mismo convenio de id que la nómina (#28):

```
obras/{obraId}/evidencia/{Y2026-S38}
  { año: 2026, semana: 38,
    fotos: [ { id, sec, ruta, subida, fechaEsDeSubida? } ] }
```

- `ruta` es la ruta de Storage **literal**, no la URL con token y no una
  regla de reconstrucción. Unos 50 B contra 240, y al guardarse tal cual
  no se rompe si el catálogo se reordena — que es el riesgo de la
  corrección de arriba. El token deja de estar replicado en un documento
  que leen todos los roles.
- `avance/subs` deja de llevar `fotos`: en la 0112 el documento pierde el
  **85%**.
- Una semana cerrada ya no crece. El techo desaparece de verdad, no se
  aleja.

**2. Las 475 fotos actuales se migran con la fecha que tienen, dicha como
lo que es.** Solo hay fecha de subida —pero es una fecha **fiable**, ya
contrastada con el `timeCreated` de Storage—, así que la semana se deduce
de ella y la foto se marca `fechaEsDeSubida: true`. La pantalla entonces
dice "subidas el 24 de julio", no "tomadas en la semana 30" (P2: no se
inventa lo que no se sabe). Las 255 de la 0112 caerán todas en S30, que
es exactamente lo que pasó. Si alguna foto apareciera sin `fecha`, su
objeto de Storage la tiene: la migración puede ir a buscarla ahí en vez
de archivarla como desconocida.

**3. Tres pantallas, no una.**

- **Ver una semana**: selector de semana arriba, por omisión la última
  con fotos. Dentro, agrupado por partida. Una lectura, un documento.
- **Comparar dos semanas**: dos selectores, dos columnas. Las partidas
  que aparecen en ambas se alinean en la misma fila, para que el cambio
  se vea sin buscarlo. Ese es el momento de la demo.
- **Capturar**: igual de fácil que hoy. Se sigue subiendo desde la
  partida, pero la foto se sella con **la semana que se está
  capturando**, no con `Date.now()`. Y el cuadro inline enseña las fotos
  *de esta semana* más un "ver semanas anteriores" — que de paso arregla
  que hoy muestre 43 miniaturas en una rejilla de cuatro columnas.

**4. Orden respecto a la nómina.** Va **después**, y sale más barato por
ir después: la migración de nómina deja probados el convenio `Y2026-S38`,
la bandera `formatoHistorial` y la guarda de lectura dual, y esto los
copia tal cual. Lo único que conviene adelantar es el **#32**, que es una
línea y hoy deja la galería del cliente en blanco.

---

---

## 31. El histórico semanal de subcontratos nunca existió — retirado 2026-09-22

**Descubierto**: 2026-09-21, verificando por qué la gráfica de tendencia
del subcontrato salía siempre vacía. **Retirado del código el
2026-09-22** en `fix/historico-subs-inexistente`. Queda aquí porque la
funcionalidad puede quererse de verdad algún día, y entonces hay que
saber qué la mató.

`crearSnapshotAvanceSub` escribía en
`obras/{obraId}/subcontratos/historial_{subId}`. Esa ruta **no tiene
regla** en `firestore.rules`: cae en el `match /{document=**}` final
(`firestore.rules:351`) que deniega todo. Comprobado con una prueba
contra el emulador.

Y como la escritura pasaba por `fsSet`, que se traga el fallo (#22),
**nadie se enteró**. El debounce de 3 segundos se disparaba, la
escritura rebotaba, la consola no decía nada y la gráfica leía un
documento que no existía y pintaba vacío. No hay **ni un solo snapshot
de subcontrato en producción**, en ninguna de las cinco obras.

Es el #22 en su forma más cara: no se perdió un dato, se perdió una
funcionalidad entera, y estuvo en el menú todo ese tiempo prometiendo
una serie que ningún usuario pudo ver nunca.

**Qué se quitó** (todo en `src/App.jsx`):

- `GraficaSemanalSub` — el componente de la gráfica.
- El bloque "Tendencia semanal del subcontrato" del PDF ejecutivo.
- `crearSnapshotAvanceSub` — el escritor, y el debounce de 3 s que lo
  llamaba desde `actualizarConcepto`.
- `recalcularHistorialSub` — el recálculo en lectura para el esquema 1.
- El `fsGet` por sub en el estado de `DetalleSubcontrato`.
- El parámetro `historialSubs` de `generarPDFObra` y el bucle que lo
  poblaba: eran **N lecturas por PDF** —una por subcontrato— de
  documentos inexistentes.
- La mitad de `scripts/prueba-snapshot-sin-descripcion.cjs` que medía el
  snapshot del sub.

**No se migró nada**: no había nada que migrar.

**Si algún día se quiere de verdad**, hacen falta tres cosas, no una:

1. La regla en `firestore.rules` para `obras/{id}/subcontratos/**`.
   Sin eso, cualquier cosa que se escriba ahí se deniega igual.
2. Que la escritura **no sea silenciosa** — `fsSetA`, no `fsSet`. Este
   pendiente existe precisamente porque nadie vio fallar nada.
3. Un dato que graficar: hoy **ningún subcontrato de ninguna obra tiene
   `conceptos` capturados**, así que aunque las reglas lo permitieran, la
   serie estaría vacía por falta de captura. Esa es la razón de fondo
   para no rehacerlo todavía.

**El recordatorio se fue con él.** `recordatorioCapturaSubs` (viernes
12:00) leía esa misma ruta denegada para decidir si avisar. Las Cloud
Functions usan el Admin SDK, que **se salta las reglas**, así que leer sí
podía — pero el documento nunca existía, de modo que su `yaCapturado` era
permanentemente falso. Estaba callado solo porque ningún sub tiene
conceptos capturados; el día que alguien capturara uno, habría insistido
para siempre sobre un cierre imposible de registrar. Retirado el
2026-09-22:

- `exports.recordatorioCapturaSubs` en `functions/index.js`.
- Su fila en `JOBS_PROGRAMADOS` (`src/App.jsx`). Si se quedaba, la
  pantalla de salud lo enseñaría como "nunca ejecutado" para siempre —
  un job muerto disfrazado de job atrasado, que es justo la mentira que
  esa pantalla existe para no contar (#25, #26).
- La fila en `docs/CAMPO_BRIEF.md`.

De paso, `scripts/prueba-salud-sin-datos.cjs` dejó de traer la lista de
crons escrita a mano: ahora la **deriva de `functions/index.js`** y
comprueba las dos direcciones. Un cron nuevo sin fila en la tabla se pone
en rojo, y una fila que apunte a una función que ya no se despliega
también. La lista a mano fue exactamente lo que se quedó viejo aquí.

> **Sin desplegar — y va en un despliegue compartido.** El retiro está en
> el código pero **no en producción**: el cron sigue vivo allá arriba.
> Sale en el **mismo despliegue de functions que la rama del resumen
> semanal** (`feature/resumen-semanal`), con canario.
>
> El cambio de functions vive en esta rama, no en la del resumen, así que
> **las dos se juntan antes de desplegar**. Si se despliega solo el
> resumen semanal, el cron retirado sigue corriendo en producción y el
> código y lo desplegado quedan separados sin que nada lo diga. Acordado
> con Omar el 2026-09-22.
>
> Mezclar esta rama a main **no** despliega functions: main se publica en
> Netlify, que solo construye el front. Así que el frente puede irse hoy
> y el cron esperar al canario sin que nada quede a medias en pantalla.
>
> Mientras tanto sigue callado por la misma razón de siempre: ningún sub
> tiene conceptos capturados.
>
> **Ojo con el canario: el borrado no cabe en él.** Verificado el
> 2026-09-23 contra producción — `recordatorioCapturaSubs` sigue **ACTIVE,
> GEN_2**, y dispara los viernes a las 12:00. El canario despliega con
> `--only functions:probarBackup,functions:probarResumenSemanal`, y ese
> filtro **no borra nada**: Firebase solo propone borrar las funciones que
> faltan en el código cuando el despliegue abarca el grupo entero. Así que
> el retiro cae en la **segunda tanda**, y ahí `firebase deploy --only
> functions` se detiene a preguntar «*The following functions are found in
> your project but do not exist in your local source code… delete?*».
> Conviene saberlo de antemano: es un prompt interactivo, dice **delete** y
> aparece a media operación. Se responde que sí **solo** para
> `recordatorioCapturaSubs`; si la lista trae alguna otra, **parar** — quiere
> decir que se está desplegando desde un árbol que no es el que se cree.

**Si se revive el histórico de subs, este recordatorio vuelve con él** —
pero solo después de los tres puntos de arriba, y con `fsSetA`, no
`fsSet`. Un recordatorio que pregunta por algo que nadie puede escribir
es peor que no tenerlo: convierte un hueco de captura en ruido diario.

---

## 32. La galería de fotos del cliente no pinta ni una foto — y anuncia que sí hay

**Descubierto**: 2026-09-22, midiendo las fotos para el #30. Prioridad
**alta**, y **bloquea la demo** si en la demo se abre la vista de
cliente: es la pestaña "Evidencia fotográfica", que es justo lo que se
quiere enseñar.

`FotosCliente` (`src/App.jsx:14092`) aplana mal el mapa de fotos:

```js
const fotos = Array.isArray(s.fotos) ? s.fotos : Object.values(s.fotos||{});
```

Falta `.flat()`. El mapa de una partida es `{ idPartida: [foto, foto, …] }`,
así que `Object.values` devuelve **un arreglo de arreglos**, no de fotos.
Las consecuencias encadenan:

- La insignia cuenta **grupos**, no fotos: una partida con 43 fotos
  anuncia "1 foto".
- Al pintar, cada elemento es un arreglo, y un arreglo no tiene `.url`
  ni `.src`. La galería hace `if(!url) return null` y **no dibuja nada**.

Resultado: encabezados de partida con una insignia que miente, y debajo
una rejilla vacía. Medido contra producción ejecutando la propia
expresión extraída del archivo:

| obra | la galería anuncia | pinta | hay en el documento |
|---|---|---|---|
| 0112 | 12 fotos en 12 partidas | **0** | 255 |
| 0114 | 88 fotos en 88 partidas | **0** | 188 |
| 0126 | 22 fotos en 22 partidas | **0** | 32 |

Las **475 fotos** de producción son invisibles en la vista de cliente.

Dos detalles que valen para el arreglo:

1. El mismo aplanado está bien resuelto en otras dos partes —
   `fotosDeSub` del PDF (`src/App.jsx:1718`) y el del tablero
   (`src/App.jsx:9393`) sí hacen `.flat()` y además ordenan por fecha.
   Son tres copias de la misma idea y solo una está mal: **el arreglo es
   unificarlas, no parchear la tercera.**
2. En la 0114 la galería cuenta 88 partidas con fotos y en el documento
   solo 78 las tienen: diez partidas guardan un mapa con arreglos
   vacíos. Con `.flat()` esas diez desaparecen solas, pero conviene
   saber que están ahí — son bytes que no representan nada.

Cae dentro de la propuesta de evidencia por semana del #30, que
reescribe esta pantalla entera. Si el #30 se pospusiera, esto se arregla
aparte en una línea.

### Arreglado en `fix/galeria-cliente-vacia` (2026-09-22)

Se adelantó al #30 a propósito: el #30 reescribe esta pantalla entera,
pero mientras tanto hay una demo de por medio y 475 fotos invisibles.

El aplanado se corrigió en su sitio —`Object.values(...).flat()` más un
`.filter(Boolean)` que tira los huecos sin tirar las fotos guardadas como
cadena suelta, que el esquema mixto todavía tiene—. **No se unificaron las
tres copias**: `fotosDeSub` del PDF y el del tablero ordenan además por
fecha y viven en ámbitos distintos; unificarlas es trabajo del #30, que
reescribe la pantalla, y meterlo aquí convertiría una línea en un
refactor que nadie pidió. Queda escrito para que no se olvide.

La prueba es
[`scripts/prueba-galeria-cliente.cjs`](scripts/prueba-galeria-cliente.cjs).
No busca `.flat()` en el archivo: extrae de `FotosCliente` las dos
expresiones reales —la que arma la lista y la que resuelve la URL de cada
foto al pintarla— y afirma los **dos números que el cliente ve**: lo que
anuncia la insignia y lo que pinta la rejilla. El defecto era justo que
no coincidían. Contra el árbol anterior sale con **11 comprobaciones en
rojo**, entre ellas `anuncia "1 foto", pinta 0` con la partida de 43 fotos
de la 0112.

Falta fusionarla.
## 33. `PanelEjecutivo` lleva desde el 18 de septiembre sin renderizarse

**Descubierto**: 2026-09-22, trabajando en los KPIs de mano de obra del
portafolio. No es un defecto de producto: nadie ve nada mal. Es una
trampa para quien edite el archivo.

`function PanelEjecutivo(...)` (271 líneas en `src/App.jsx`) fue
reemplazada por `DashboardPrincipal` el 2026-09-18, y el propio código lo
dice en el comentario que precede al render. Lo que no dice en ningún
lado es que la función vieja **se quedó**. No hay un solo
`<PanelEjecutivo` en el archivo, así que Rollup la elimina del bundle:
ninguna de sus cadenas —`MANO DE OBRA CONSOLIDADA`, `overhead alto`,
`Total trabajadores`— aparece en `dist`.

**Lo que ya costó.** Al arreglar la semana de nómina del portafolio, el
aviso de "semana rayada en varios archivos" se escribió dentro de este
panel. Compilaba, la prueba de comportamiento salía verde y el informe
reportó cifras —32.5% de indirectos, $5,603 de costo promedio semanal—
que **no estaban en pantalla de nadie**. Se descubrió buscando las
cadenas en el bundle construido, no leyendo el código: leyéndolo, los
dos bloques son indistinguibles. El equivalente vivo está en
`DashboardPrincipal`, en `<_KpiConDelta label="Personal">`.

**Qué hacer.** Si nadie va a reactivarlo, **se borra**. Cuesta poco —el
build ya demuestra que nada depende de él— y quita una copia
convincente de un componente vivo a la que un cambio puede irse por
error. Ojo con no llevarse por delante `vePanelEjecutivo` ni
`ROLES_PANEL_EJECUTIVO`: ésos **sí** se usan, son los que deciden quién
ve `DashboardPrincipal`.

Si se decide conservarlo, que sea con una razón escrita encima de la
función y no por omisión, que es como está hoy.

---

## 34. El transporte que decodificaba a medias — ARREGLADO 2026-09-23

### Lo que pasó

Migrando la nómina de la **0112** a subcolección (#28), el guion escribió
las dos semanas y se paró en el paso 4:

```
1 problema(s):
  Y2026-S36: lo que se lee NO es igual a lo que se mandó
```

La guarda hizo lo suyo: la bandera no subió y el documento viejo quedó
intacto. **Al repetir la corrida, con los mismos datos, pasó limpio.**

Eso último es lo importante. No pasó porque algo se hubiera arreglado
entre una corrida y otra: pasó porque los paquetes cayeron distinto. Un
proceso que a veces pasa y a veces no, con la misma entrada, no está
bien aunque haya pasado.

### La causa

`scripts/migrar-nomina-subcoleccion.cjs`, en el transporte:

```js
let b = ''; resp.on('data', d => b += d);
```

`d` es un `Buffer`, y `b += d` lo convierte a texto **trozo por trozo**.
Un carácter UTF-8 de varios bytes partido en la frontera de dos trozos
TCP se decodifica a la mitad por cada lado y sale como carácter de
reemplazo. Dónde caen las fronteras depende de la red, del tamaño de la
respuesta y del momento: de ahí el no-determinismo.

Reproducido con un servidor local que corta justo en medio de una `Í`:

```
FALLA  b += d (lo que había)         "MAR��A DE LOURDES MUÑOZ PEÑA"
 ok    Buffer.concat (la corrección) "MARÍA DE LOURDES MUÑOZ PEÑA"
```

En una nómina mexicana hay acentos o `Ñ` en casi cada renglón: 14 de los
165 nombres de la 0127 y la 0112 llevan caracteres no-ASCII.

### Por qué el rojo falso era lo de menos

El fallo ruidoso **para** la migración, que es el comportamiento seguro.
El peligro está en el otro sentido: si lo que se corrompe es la lectura
del **origen**, el guion escribe el nombre mutilado y después lo compara
contra esa misma lectura corrupta. **Mutilado contra mutilado cuadra**,
la bandera sube, y el apellido queda roto en producción sin que nada lo
delate. El dinero no se mueve, así que ninguna suma lo atrapa.

Se verificó que **no llegó a pasar**: 165 de 165 nombres de la 0127 y la
0112 idénticos al origen carácter por carácter, cero caracteres de
reemplazo.

### Lo que se arregló

1. **El transporte del guion de migración**: el cuerpo se junta en
   `Buffer`s y se decodifica una sola vez al final (`juntarCuerpo`).
2. **Paso 4c nuevo — los nombres contra el origen releído.** Arreglar el
   transporte no cierra el agujero de fondo, que es *confiar en una sola
   lectura*. Después de escribir, el guion relee el documento viejo —otro
   momento, otra conexión— y coteja nombre por nombre contra lo que
   quedó en la subcolección. Si uno solo no coincide, aborta sin subir la
   bandera y dice quién y cómo se leyó de cada lado.
3. **Los otros siete guiones** que traían el mismo patrón
   (`migracion-nomina-anios`, `medir-historial-0114`, `volcar-0114`,
   `medir-portafolio-semana-actual`, `medir-acumuladores`, `medir-fotos`,
   `medir-fechas-fotos`) llevan `setEncoding('utf8')`. Hoy sólo imprimen,
   pero de sus números salieron decisiones —las mediciones de tamaño del
   #28 y el #30, las fechas de fotos— y mañana alguien puede apoyar en
   ellos algo que escriba.
4. **`scripts/prueba-migracion-no-mutila-nombres.cjs`**, 14
   comprobaciones. Pasa una respuesta partida en medio de una `Í` y de
   una `Ñ`, por `EventEmitter` y por un socket real; lleva contraprueba
   que confirma que la forma vieja **sí** mutila; y ejercita el cotejo de
   nombres con un carácter de reemplazo metido a mano. Si alguien
   desconecta el cotejo, la prueba da **NO ARRANCÓ**, no verde.

### Lo que queda de lección

Una comparación sólo vale si sus dos lados vienen de lecturas distintas.
Verificar lo escrito contra la variable de la que se escribió no verifica
el transporte: verifica que la memoria no cambió sola.

---

# Referencia rápida — resumen de prioridad

Los principios P1, P2 y P3 (arriba) no están en esta tabla: no se
cierran, gobiernan.

| # | Pendiente | Bloquea demo | Prioridad |
|---|---|---|---|
| 1 | Sacar repo de iCloud Drive | sí (indirecto) | crítica |
| 2 | Primer ingreso GP en "cargando" | sí | crítica — consecuencia mitigada en `fix/arranque`, causa raíz abierta |
| 3 | KPIs arrancan en cero | sí | crítica — resuelto en Panel principal (`fix/arranque`), abierto en lista de obras y módulos |
| 4 | Proyecto Firebase de pruebas con copia de datos | sí (indirecto) | alta — habilita la migración a orgs y el #4b |
| 4b | Cuentas de prueba dedicadas | sí | crítica — depende del #4 |
| 5 | Respaldos — el 403 nunca dejó correr uno | sí | **crítica** — permiso arreglado 2026-09-21, primer respaldo bueno; falta restauración probada |
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
| 22 | `fsGet`/`fsSet`/`fsDel` se tragan el fallo (64 llamadas) | | alta — caso urgente (recarga de catálogo) cerrado en `fix/catalogo-no-borra-avance`; resto abierto |
| 23 | `networkTimeoutSeconds: 5` del service worker | | media-alta (rama aparte) |
| 24 | Plan de correos (regla, resumen semanal, cuenta, cotea) | | alta el aviso de respaldo fallido y la recuperación de contraseña; media el resto |
| 25 | `global/health` registra la intención, no el hecho | | alta — hace que el aviso del #24 3.1 pueda mentir |
| 26 | Pantalla de salud en admin ("última ejecución hace N días") | | alta — única señal que sirve si el backend está caído |
| 27 | La proyección asume contrato cerrado — en TAMSA no aplica | | media-alta — depende de `tipoContrato` |
| 28 | Historiales semanales en un solo documento — se llenan | **BLOQUEANTE DE DEMO** | **crítica** — la 0114 ya reventó y perdió 7 cierres; a escala municipal la nómina se llena en ~3 meses desde el alta, y la 0125 va en marzo 2027 con su nómina en febrero |
| 29 | Falta índice de `auditoria` por `obraId` | | alta — la bitácora filtrada por obra sale vacía como si no hubiera actividad |
| 30 | El catálogo vivo `avance/subs` se llena — lo llenan las URLs de las fotos | **BLOQUEANTE DE DEMO** | **crítica** — el peso lo mandan las URLs de Storage, no las partidas (85% del documento en la 0112, con 14 partidas); la URL es reconstruible desde la ruta y no hace falta guardarla; un catálogo de 2,000 partidas no cabe el día del alta |
| 31 | Histórico semanal de subcontratos — **retirado** | | cerrado por retiro — nunca escribió nada (ruta denegada + `fsSet` mudo); el cron `recordatorioCapturaSubs` se retiró con él, pendiente de desplegar |
| 32 | La galería de fotos del cliente no pinta ni una foto | **BLOQUEANTE DE DEMO** si se abre la vista de cliente | **arreglado** en `fix/galeria-cliente-vacia`, pendiente de fusionar; queda abierto unificar las tres copias del aplanado (va con el #30) |
| 33 | `PanelEjecutivo` sigue en el archivo sin renderizarse | | baja de producto, **media de riesgo** — ya se editó por error una vez; si nadie lo reactiva, se borra |
| 34 | El transporte decodificaba el cuerpo trozo a trozo | | **arreglado 2026-09-23** — partía caracteres UTF-8 en la frontera de los paquetes; hacía que la migración fallara y pasara con los mismos datos, y podía dejar nombres mutilados que cuadraban contra sí mismos. Arreglado en los 8 guiones + paso 4c que coteja contra el origen releído |

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
