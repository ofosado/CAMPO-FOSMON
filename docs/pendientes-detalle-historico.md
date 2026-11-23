# Archivo de pendientes — CAMPO / cotea

> **Esto es el detalle histórico, no la lista.** La lista viva —una línea por tema, con
> estado, ordenada por daño— está en `PENDIENTES.md`. Aquí vive el detalle: las
> mediciones contra producción, las causas raíz, los guiones que las midieron y
> por qué se decidió lo que se decidió. Se consulta por número.
>
> Se partió en dos el 2026-10-06, con 4,833 líneas, porque un documento de ese
> tamaño no permite ver si los pendientes avanzan. La tabla «Referencia rápida»
> de más abajo se quedó en el #34 cuando el documento iba en el #47 — se
> conserva como testimonio de eso mismo, pero **el índice es `PENDIENTES.md`**.

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

## P5. Una dependencia ve su contrato y su avance, nunca la economía interna del contratista

**Adoptado**: 2026-09-24, rama `feature/ui-dependencia`.

CAMPO sirve a dos tipos de organización y no son el mismo producto con
distinto logo. Una **constructora** ejecuta obra y su pregunta es si
gana dinero: cuánto gastó contra cuánto ejecutó. Una **dependencia de
gobierno** contrata obra y su pregunta es otra: en qué va su dinero y
en qué va la obra.

Lo que una dependencia mira es su propio contrato:

- cuánto contrató,
- cuánto se ha ejecutado (avance físico),
- cuánto se ha estimado,
- cuánto ha pagado,
- cuánto falta por ejercer.

Nómina, almacén, maquinaria, gasto y margen **no existen** para una
organización de tipo `dependencia`. No en la lista de obras, no en el
dashboard de obra, no en las alertas, no en el informe.

**Por qué.** Dos razones, y conviene no confundirlas porque se arreglan
distinto:

1. **Es la frontera que ya sostienen las reglas.** Desde
   `feature/prefijo-organizacion` las obras de cada organización
   cuelgan de su propio prefijo y Firestore niega el cruce. Hasta hoy
   la interfaz no decía lo mismo: `TABS_POR_ROL` no conocía los roles
   de dependencia y `director_obras` caía al respaldo de constructora,
   con Gastos incluido. Una interfaz que ofrece lo que las reglas
   niegan produce pantallas vacías en el mejor caso y, en el peor,
   cifras a medias.
2. **La cifra sería falsa, no confidencial.** El margen se calcula
   contra el gasto, y el gasto de CAMPO viene del Sheet de GP, que es
   de FOSMON. Para una dependencia ese gasto es cero, así que
   "ejecutado − 0" daría 100% de margen en todas sus obras y la tabla
   del portafolio las ordenaría por una columna sin significado. Eso
   es el P2: una cifra que no se pudo calcular no se sustituye por
   cero. La diferencia con el P2 es que aquí la respuesta correcta no
   es escribir "no disponible" — es **no preguntar la ruta**, porque
   la cifra no le corresponde a esa organización aunque se pudiera
   calcular.

**Cómo se aplica:**

1. **El discriminante es `tipo`, no el rol ni la presencia de
   `orgId`.** Viene de los claims del token, que son el mismo dato que
   evalúan las reglas. Decidir la interfaz con un dato distinto del
   que juzgan las reglas es como nacieron el #31 y el #35.
2. **No se esconde: no se pide.** Una suscripción a una ruta que la
   organización no debe ver falla, `alFallar` deja `[]`, y los KPIs
   suman ese `[]` como cero — un número falso sin aviso. Los oyentes
   del margen y la carga del Sheet de GP quedan fuera cuando el tipo
   es dependencia.
3. **Componentes aparte, no condicionales sembrados.** El dashboard y
   el portafolio de dependencia son componentes propios que nunca
   calculan gasto ni margen, en vez de los de constructora con
   banderas. Un condicional que se olvida filtra; una cifra que no se
   calcula no puede filtrarse. Es el mismo criterio con el que se
   separaron las vistas de rol `cliente`.
4. **La puerta de atrás también se cierra.** Esconder la pestaña no
   basta si `PERMISOS[rol].gastos` sigue diciendo "editar", si
   `ROLES_PANEL_EJECUTIVO` incluye al rol, o si la biblioteca de
   riesgos emite `margen_bajo`. El margen vuelve por la alerta.

Si la interfaz ofrece lo que las reglas niegan, alguien va a creerle a
la interfaz.

---

## P6. Una prueba puede cubrir A y cubrir B sin cubrir A→B

**Adoptado**: 2026-10-05, rama `feature/seguimiento-semanal`. Palabras del
usuario al verlo: *«esas son las que valen»*.

Probar las dos piezas de un camino no prueba el camino. Si una prueba
ejercita el productor con sus casos y el consumidor con los suyos, puede
estar **en verde con el cable cortado entre ellos**, porque nunca pasó un
valor de uno al otro. Es el hueco que un refactor abre en silencio: cambiar
el orden de unos argumentos, dejar de pasar un parámetro o pasar una
constante en lugar de la variable no rompe ninguna de las dos mitades.

Es pariente del P3 pero no es el mismo: el P3 dice que un mecanismo puede
existir y ser inalcanzable. El P6 dice que **dos mecanismos pueden estar
ambos vivos y probados, y no estar conectados**.

**Por qué**: el caso de esta rama. `corteDeEstimaciones` tenía 7
comprobaciones y `crearSnapshotAvance` tenía las suyas; las dos mitades en
verde. Dos contrapruebas semánticas —«el llamador deja de pasarle el corte al
cierre» y «el llamador le pasa el corte sin mirar si las estimaciones
cargaron»— **se quedaron en verde**. La prueba medía los dos extremos y
nunca el cable. La segunda es la peligrosa: ignorar la bandera de carga no
rompe ninguna de las dos piezas y congela **$0** en el expediente de una obra
con $109.2M estimados.

**Cómo se aplica:**

1. **Nombra el cable y pruébalo como tercera cosa.** No basta «probé el
   productor» y «probé el consumidor». El paso de uno a otro es un sujeto
   con sus propios casos. Aquí es la §5 de
   `scripts/prueba-corte-estimaciones.cjs`: extrae por AST el **7º argumento**
   de la llamada a `crearSnapshotAvance` y lo **ejecuta** con la lista cargada,
   sin cargar, y con la bandera `undefined`.
2. **Incluye el caso del argumento OMITIDO.** El `undefined` es el que
   aparece cuando alguien agrega un parámetro en medio o reordena la firma, y
   es el único que distingue «cae del lado seguro» de «cae del lado que
   escribe un cero».
3. **La contraprueba del cable se escribe cortándolo, no borrándolo.** Las dos
   mutaciones que lo encontraron no quitan código: una cambia el argumento por
   `null` y la otra por `true`. Las dos dejan el archivo compilando y las dos
   mitades en verde — que es exactamente la forma que tiene el defecto real.
4. **Una contraprueba que se queda VERDE es un hallazgo, no un trámite.** Es
   el único momento en que la prueba habla de sí misma. Si sale verde, la
   pregunta no es «¿cómo la pongo roja?» sino «¿qué no estaba mirando?».

**Y el corolario, que costó caro aquí:** si los dos lados de una comparación
leen la misma constante, mover la constante mueve los dos lados y la
comprobación es **tautológica** — pasa siempre. La §4 comparaba dos snapshots
que ambos leían `ESQUEMA_SNAPSHOT`. Se arregló fijando el valor observado en
producción (`ESQUEMA_EN_PRODUCCION = 3`) como el hecho que es, y no como una
lectura del código que se está juzgando.

### El mismo defecto, un escalón más arriba: un medidor que hereda el filtro del código que audita no mide, repite

**Agregado el 2026-10-05.** Es la misma familia que el corolario de arriba —la
prueba contaminada por lo que juzga— pero aplicada a los **guiones de
medición**, que son los que producen las cifras con las que después se decide.
Por eso duele más: una prueba contaminada deja pasar un defecto; un medidor
contaminado **fabrica la evidencia** de que no lo hay.

**El caso.** Al medir si las fotos de producción traían `id`, la primera
versión de `scripts/medir-fotos-sin-id.py` copió el filtro de `fotosDeSub`
(`src/App.jsx`), que descarta de la lista todo lo que no sea objeto. Pero las
fotos guardadas como **cadena suelta** son justamente las que **no pueden
tener `id`**. El filtro heredado las sacaba del conteo antes de contarlas.

El guion habría reportado **«0 fotos sin id»** — un número correcto, creíble,
redondo y **vacío de contenido**, porque *la pregunta excluía la respuesta*.
Y habría cerrado el pendiente dando por bueno justo el caso que lo abrió.

**La regla.** Un medidor y el código que audita **no pueden compartir el
filtro de entrada**. El código filtra para no romperse; el medidor filtra
para no contar — y son objetivos opuestos.

**Cómo se aplica:**

1. **Traer TODO y clasificar después.** El medidor recoge la población
   completa y luego separa en categorías, incluidas las que el código
   descarta. En el caso de las fotos: objetos con `id`, objetos sin `id`, y
   «no son objeto» como **tercera columna**, no como ausencia.
2. **Sospechar de cualquier `filter` copiado del código fuente.** Si el
   medidor reutiliza un helper de la app para decidir *qué entra*, está
   heredando una decisión tomada con otro propósito. Reutilizar el helper para
   **interpretar** lo que ya entró sigue siendo correcto y deseable (es lo que
   hace `scripts/medir-fotos.cjs` extrayendo `conFotos` por AST).
3. **Preguntarle al resultado si pudo haber salido distinto.** Si la respuesta
   «0» era la única posible dada la forma de la consulta, no se midió nada.
   Es la versión numérica del punto 4 del P6: un cero cómodo merece la misma
   desconfianza que una contraprueba verde.
4. **Un fallo de lectura detiene el medidor.** Devolver vacío y seguir
   convierte un token vencido en «0 en las cinco obras»: el P2 aplicado a las
   herramientas y no sólo a la pantalla. Ya está escrito así en
   `medir-fotos.cjs` y en `medir-fotos-sin-id.py`, y pasó de verdad.

---

## P7. Un banco CARGA su insumo; no lo hereda del ambiente

**Adoptado**: 2026-10-22. No salió de un incidente: salió de tres, y de que
el usuario se diera cuenta antes que yo de que eran el mismo. *«Las tres son
la misma falla con distinto disfraz. Y las tres se veían verdes.»*

Un banco se compone de dos cosas: lo que afirma y el insumo contra el que lo
afirma. El P3 y el P6 gobiernan lo primero. Éste gobierna lo segundo, y es
más traicionero, porque **un insumo equivocado no rompe nada**: el banco
corre entero, mide limpiamente y emite un veredicto —sobre otra cosa.

**La regla, en dos mitades:**

1. **El insumo se carga desde el repositorio al empezar**, dentro del propio
   banco, antes de la primera medición. No se da por puesto, no se hereda de
   quien corrió antes, no se toma de lo que el ambiente tuviera.
2. **Si no se puede cargar, el banco sale NO ARRANCÓ (2)**, nunca verde y
   nunca rojo. Es el P4: no se midió nada, ni bien ni mal.

**Los tres disfraces, por si vuelve un cuarto:**

| Insumo | Quién lo ponía | Qué se veía |
|---|---|---|
| La zona horaria | El reloj de la laptop (`Europe/Madrid`) | Verde o rojo según en qué país estuviera el equipo |
| La lista de guiones de medición | El renombre de una función en `src/App.jsx` | 2 de 9 muertos, y nadie los veía morir: no estaban en la suite |
| El ruleset de Firestore | Lo que el emulador tuviera puesto, o lo que le dejara el banco anterior | 7 de 9 bancos de permisos juzgando reglas que no eran las del archivo |

A los que se añade el insumo de datos: `prueba-cierre-emulador` leía su
volcado de `/tmp`, y reponerlo exigía red y un token de ADC vivo.

**Lo que esto cuesta cuando no se cumple** no es un rojo: es que `npm test` y
`node scripts/…` puedan dar veredictos distintos sobre lo mismo según qué
corrió antes, en qué huso está la laptop o cuántas horas lleva el emulador
arriba. **Un veredicto que depende de cómo lo invocaste no se arregla: se
aprende a ignorar.**

**Y el corolario del arreglo:** no se restaura al salir, se carga al entrar.
Restaurar deja el orden importando —un banco que revienta a media corrida no
restaura, y el siguiente hereda—. Cargar al entrar quita el orden de la
ecuación. Lo mismo vale al otro extremo de la tubería: lo que gobierna
producción se baja del servicio, no se lee del archivo del repo
(`scripts/verificar-reglas-publicadas.cjs`).

**Dónde vive el cumplimiento hoy:** `scripts/reloj.cjs` (huso),
`scripts/reglas-del-repo.cjs` (ruleset), `insumos/` (datos). Un insumo nuevo
necesita su cargador, no una nota en el `README`.

### El barrido del P7 — qué más heredan los 56 bancos (2026-10-22)

Pedido así: *«¿qué otro insumo heredan los bancos del ambiente y nadie carga?
Quiero la lista aunque no arregles nada todavía.»* **Nada de esto está
arreglado.** Es inventario, medido sobre los 56 bancos, no deducido.

**Ya cargado (el P7 se cumple):**

- **Huso horario** — `scripts/reloj.cjs`, vía `no-arranco.cjs`. **56/56** lo
  requieren. Sin agujeros.
- **Ruleset de Firestore** — `scripts/reglas-del-repo.cjs`. **8/8** bancos que
  abren el emulador lo cargan. Sin agujeros.
- **Código bajo prueba** — 47/56 lo extraen por AST de `src/App.jsx`, que es
  el P3 funcionando.
- **Datos de la 0114** — `insumos/0114-produccion.json`, versionado.
- **Locale** — ninguna llamada a `toLocale*()` sin locale explícito. Sin
  agujeros. (Pero ver abajo: dos bancos de dinero usan `'en-US'` y nueve
  `'es-MX'`.)

**Heredado todavía, por orden de qué tan caro sería:**

| # | Insumo | Quién lo pone hoy | Por qué importa |
|---|---|---|---|
| ~~a~~ | ~~El proyecto de Firebase por omisión~~ | **CERRADO el mismo día — #71** | Era la **cuarta** aparición del destino destructivo por omisión. Detalle abajo, porque no es un renglón de inventario: es la raíz de los otros tres. |
| ~~b~~ | ~~El estado del emulador entre bancos~~ | **CERRADO el mismo día — #72** | 6 de 8 no limpiaban, y los 2 que limpiaban se tragaban el fallo. `scripts/emulador-limpio.cjs` limpia al entrar y NO ARRANCA si no puede. |
| c | **La versión de Node** | La que tenga la máquina (hoy v26.0.0) | No hay `.nvmrc` ni `engines` en `package.json`. 47 bancos parsean `src/App.jsx` con Babel y ejecutan el resultado; un cambio de Node cambia qué sintaxis corre y cómo se redondea. |
| d | **El locale de las cifras de dinero** | Elegido banco por banco | 9 bancos afirman con `'es-MX'` y 2 con `'en-US'` (`estado-de-cuenta`, `tabla-dependencia`). Los dos producen la misma salida para montos sin decimales, así que hoy no muerde — pero es una cuenta por número escrita de dos formas, y la app usa una sola. |
| e | **El `PATH` y el JDK** | `export PATH=…openjdk…` a mano, antes de cada corrida | Sin él el emulador no arranca; el banco lo reporta como NO ARRANCÓ, que es correcto, pero la precondición no está escrita en ninguna parte ejecutable. |
| f | **Credenciales de ADC** | `gcloud auth application-default` | Sólo para lo que mide producción (`verificar-reglas-publicadas`, los `medir-*`), y por eso ninguno de ellos está en la suite. Correcto por diseño; se anota para que siga siéndolo. |
| g | **Dos ficheros en `/tmp`** | El ambiente | `/tmp/storage-prueba-ata-partida.txt` y `/tmp/adc.tok` en 2 bancos, más `/tmp/storage-obras.txt` en 2 guiones de medición. Es el mismo caso del volcado de la 0114, sin resolver. |
| h | **`new Date()` directo** | El reloj del sistema | 6 bancos. El huso ya está fijado, así que no es el defecto del reloj otra vez; lo que queda suelto es el **instante**, que hace que un banco pueda cambiar de veredicto según el día (semana ISO, fin de mes, cambio de año). No medido si alguno depende de eso. |

**El que NO está en la lista y debería preocupar más:** el barrido sólo mira
los 56 bancos. Los **guiones de medición** (`medir-*.cjs`) no están en la
suite —ése es el #65— así que ningún insumo suyo lo vigila nadie. Y son los
que producen las cifras con las que se decide una escritura a producción.

### La cuarta aparición: el destino destructivo era el de OMISIÓN (#71)

Palabras del usuario al verlo: *«es la cuarta aparición del mismo patrón: el
destino destructivo es el de omisión. Es la raíz de la que salieron todos los
demás.»* Y tiene razón en el orden causal: las tres anteriores eran guiones
que habían aprendido el hábito de alguien, y ese alguien era esto.

| | Qué omitía | Qué pasaba |
|---|---|---|
| 1 | `migrar-evidencia-subcoleccion.cjs`, sin `EMU_HOST` | 270 documentos escritos en producción, 2026-10-09 01:43 |
| 2 | Los tres guiones de Admin SDK, sin destino **y** sin `--escribir` | `backfill-claims` reescribía custom claims, que el respaldo no devuelve |
| 3 | `destino.cjs` tapó los dos de arriba | — |
| 4 | **`.firebaserc`, `default: campo-fosmon`** | `firebase deploy --only firestore:rules` sin `--project` → **PRODUCCIÓN**, sin avisar |

**Lo que se hizo.** Fuera el alias de omisión; quedan `produccion` y `prueba`,
los dos con nombre. Un deploy sin destino ahora se para y ofrece los dos.

**Y lo que costó entender, que es la parte que vale.** La comprobación NO lee
`.firebaserc`, y no por purismo del P3: **leer el archivo mide la mitad
equivocada.** El `firebase` real resuelve el proyecto activo mirando también
el configstore del usuario (`~/.config/configstore/firebase-tools.json`), que
vive fuera del repositorio y que cualquier `firebase use produccion` vuelve a
fijar. Este equipo lo tenía puesto a `campo-fosmon`, heredado de la ruta vieja
de iCloud. O sea: **un `.firebaserc` impecable convive con el defecto.**

Así que la §7 de `prueba-el-destino-se-escribe` le pregunta al `firebase` de
verdad, con el comando que destruye (`deploy --dry-run`), desde la raíz. Es
local, tarda ~1.5 s, no toca red y no fija nada —a diferencia de
`firebase use <alias>`, que valida contra el servidor y **deja puesto** el
proyecto activo, o sea que la prueba habría dejado instalado lo que mide.

**Contraprueba**, no deducida: reponiendo el `default`, 4 comprobaciones en
rojo, salida 1, y la propia salida dice `=== Deploying to 'campo-fosmon'...`.

---

## P8. El banco de pruebas guarda su propia copia del grafo de dependencias, y eso castiga compartir código

**Medido**: 2026-11-17, intentando cerrar el residual del #107. No es un
principio adoptado todavía: es un bloqueo medido, con nombre y tamaño, que
hay que quitar antes de que se pueda adoptar nada.

El P3 dice que una prueba **ejecuta** la cuenta extraída del archivo, no una
copia. Eso funciona, y 47 bancos viven de ello. Lo que no se había medido es
el precio: la herramienta que extrae **teclea su propia idea de dónde vive
cada símbolo**, y esa idea es «en `src/App.jsx`, y en ningún otro sitio».

Mientras `App.jsx` fuera un monolito eso era cierto por accidente. Dejó de
serlo el día en que una decisión tuvo que compartirse con `ot.jsx`: `ot.jsx`
**no puede** importar de `App.jsx` —`App.jsx` importa de `ot.jsx`— así que la
decisión tiene que bajar a un módulo hermano. Y bajarla es lo que se midió.

**El experimento, entero.** `src/instante-guardado.js` con `fechaLocalDeISO`,
`instanteGuardado` y las dos frases de las órdenes de trabajo; `App.jsx`
importándolas y ya no declarándolas; los dos sitios defectuosos de `ot.jsx`
(`:348`, el mensaje que le NIEGA a alguien volver a subir una orden, y `:753`,
el renglón del listado) pasando por la decisión compartida; `npm run build`
limpio. Ninguna cuenta cambió. **La suite pasó de 134 en verde a 119 en verde,
4 en rojo y 11 sin arrancar**, con mensajes de la forma
`fechaLocalDeISO is not a function` y `No se encontraron estas piezas en
src/App.jsx`.

**Las cuatro capas, que no se hablan entre sí:**

| | Dónde | Cómo decide qué existe |
|---|---|---|
| 1 | `scripts/extraer-de-app.cjs` (`indexar`/`fuenteDe`) | Indexa **un** archivo y hace el cierre transitivo dentro de él |
| 2 | `scripts/taller-de-app.cjs` (`taller`/`cuenta`/`correr`) | Su propio parseo, y recibe el **texto**, no la ruta — a propósito, para que la contraprueba mute en el mismo proceso |
| 3 | Copias privadas de `taller` dentro de los bancos | `prueba-las-dos-curvas-y-un-eje.cjs:113` y `prueba-una-sola-pregunta-a-gp.cjs:103` |
| 4 | Listas de piezas tecleadas a mano | p. ej. `PIEZAS_MODULO` en `prueba-galeria-cliente.cjs` |

Las capas 1 y 2 **se arreglaron y funcionó**: siguiendo el `import` relativo,
`prueba-dos-numeros-con-el-mismo-nombre`, `prueba-el-numero-con-su-calificativo`
y `prueba-hueco-sin-captura` volvieron a verde sin tocar una sola aserción. El
arreglo es de unas 40 líneas por capa. Lo que paró el trabajo no fue el
tamaño: fueron las dos cosas de abajo.

**Trampa 1 — un hermano declara con `export const`, y el padre del nodo es el
`export`, no el `Program`.** Las cuatro capas filtran por
`p.parent.type !== 'Program'`, así que **se saltan todas** las declaraciones de
cualquier módulo compartido: la capa se ve arreglada y sigue sin encontrar
nada. Y al cortar la fuente hay que cortar el nodo de la declaración, **sin la
palabra `export`**, porque lo extraído entra en un `new Function`, donde
`export` es un error de sintaxis. Es media tarde la primera vez.

**Trampa 2, la que importa — seguir los `import` NO es inerte: colisiona con
los dobles que los bancos ponen a propósito.** `src/permiso-denegado.js`
exporta `CASO`, y `App.jsx` lo importa. `prueba-partidas-extraordinarias.cjs`
dobla `CASO` con `CASO: {}` en su entorno, porque hasta ahora era un nombre
que la extracción no podía resolver. Con el `import` seguido, `CASO` llega a
la vez como **parámetro** del `new Function` y como `const` dentro del cuerpo
extraído: `Identifier 'CASO' has already been declared`, **salida 2**. Y la
solución fácil —quitar del doble lo que la extracción ya resuelve— es peor que
el síntoma: los dobles existen para que un trozo bajo examen no abra Firestore,
así que **desdoblar en silencio** cambia lo que un banco mide sin que nadie lo
vea. Es el P7 otra vez, por el otro extremo.

**Por eso lo que falta no es «un módulo compartido»**, que es lo que el
renglón #107 decía y era falso. Falta **una sola capa de extracción para el
repo** y, dentro de ella, **una decisión escrita sobre qué gana cuando un
banco dobla un símbolo que la extracción ya puede resolver** — probablemente
que el doble gana y se DICE, nunca en silencio.

**Lo que esto cuesta mientras no se quite**, y es el motivo de escribirlo:
una suite que se cae cuando se saca un helper a un módulo **empuja a copiarlo**.
Y copiar una decisión es exactamente el defecto que el #107 existe para cerrar.
Hoy hay dos cosas paradas por esto y las dos son del mismo tamaño: los dos
sitios de `ot.jsx`, y `baseFalsa`, que va por su **cuarta** copia (ver el 149).

**Todo revertido el mismo día.** Con la demo de oficina encima, un refactor de
la infraestructura de medición no se mete la noche de antes, y el residual del
#107 son dos renglones de pantalla en una pantalla que el cliente de la demo
no abre. El código se tiró; **el hallazgo es lo que valía la medición**.

---

# BLOQUEAN LA PRIMERA DEMO

Cinco puntos que hay que resolver ANTES de mostrar el sistema por
primera vez a un cliente externo. El pendiente #1 (iCloud) es
condición previa para que los otros cuatro se puedan trabajar con
confianza — sin eso, cada cambio puede desaparecer.

A esos cinco se suma el #6, detectado en la revisión del 2026-10-06: es
el único que impide **demostrar** algo, no el único que impide
**trabajar**.

---

## 6. No hay dónde capturar estimaciones en dependencia

**Detectado**: 2026-10-06, recorriendo `feature/seguimiento-semanal` ya
mezclada. **Riesgo: ALTO.** Rama propia: `feature/estimaciones-dependencia`.

**Qué pasa**: el tablero de dependencia muestra ESTIMADO y PAGADO, y el
riel semanal guarda el corte de estimaciones al cerrar. Pero esas cifras
sólo pueden entrar **por siembra**: la pestaña de captura no existe del
lado dependencia. Es la mitad financiera del expediente y hoy no se puede
demostrar.

**Lo que SÍ existe ya** (medido, no supuesto): la captura completa del
lado constructora —`Estimaciones()` en `src/App.jsx`, con botón «+ Nueva
estimación», edición en línea y guardado—, y `fsSetA` ya antepone el
prefijo de organización, así que el motor de escritura no hay que
inventarlo. **Lo que falta es la pestaña de dependencia**, no el motor.

**Alcance acordado**, dentro de la obra:

- Capturar estimación: número, periodo **con fecha de cierre explícita**
  (no texto libre, que es lo que hoy guarda `periodo`), monto, estatus.
- La **fecha en que la dependencia recibió** la estimación, registrada por
  la dependencia — consistente con el #35: la dependencia sí captura.
- El **contador de días** entre cierre de periodo y recepción.
- Adjuntar **carátula firmada y/o factura** a Storage, con el mismo
  esquema de rutas por organización que usan las fotos
  (`conOrg('obras/{obraId}/fotos/{concepto}/{id}')`).

### Dos amarres que son condición de la rama, no sugerencias

**1. No renombrar `monto` ni `estatus`.** `corteDeEstimaciones` —el que
congela el corte en el cierre semanal— lee exactamente esos dos nombres,
y compara el estatus normalizado contra `'pagada'`. Renombrarlos **no
rompe nada visible**: el corte sigue corriendo y escribe ceros, que es
justo lo que el P2 prohíbe. Campos nuevos sí; renombrar los dos
existentes, no, salvo que se migre el corte en el mismo cambio y con su
contraprueba.

**2. Usar `fsSetAEstricto`, nunca `fsSetA`.** `fsSetA` atrapa el error y
devuelve `false`: sirve para guardados de fondo, no para uno que el
usuario acaba de pedir. Un supervisor capturando **dinero** que recibe un
rechazo de reglas y no ve nada en pantalla cree que guardó. Es el mismo
defecto del 2026-10-01 que ya está documentado en el propio comentario de
`fsSetAEstricto`, y aquí reaparecería sobre la cifra que más importa.

**También hace falta un segundo despliegue de reglas** —escritura de
dependencia sobre `config/estimaciones` y la ruta nueva de Storage—, y por
eso esto no entró en `feature/seguimiento-semanal`: habría mezclado dos
despliegues en un solo juicio.

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

### Un sitio más, medido el 2026-10-06: «0 semanas cerradas» en Evidencia

El encabezado de Evidencia (`App.jsx:16983`) dice «N semanas cerradas ·
M fotos en P partidas». `cerradas` sale de `marcas.filter(m => m.cierre)`
(`:16885`), y `marcas` se deriva de `historialAvance`, que llega vacío y
se llena cuando contesta Firestore. Durante esa ventana el encabezado
afirma **«0 semanas cerradas»**.

Medido en el emulador: al entrar a Evidencia de OBRA DEMO 1 el
encabezado decía «0 semanas cerradas»; al volver a navegar, «4 semanas
cerradas». El dato nunca cambió — cambió si había llegado.

Es peor que un KPI en cero porque no es una cifra que se vea
provisional: es una **frase sobre el expediente**, y la frase que dice
es que no hay cierres. El riel debajo sale vacío al mismo tiempo, así
que las dos cosas se confirman entre sí. Quien mira un segundo y pasa de
pantalla se lleva que la obra no tiene un solo cierre registrado. Es P2
en forma de oración: la cuenta no se pudo hacer todavía y se sustituyó
por cero en vez de decir que no está.

**El arreglo es casi seguro el mismo patrón de `estCargadas`**, que ya
existe en el repositorio desde `feature/seguimiento-semanal`: una
bandera que viaja junto al arreglo diciendo si el listener ya contestó
(`:20809` el `useState`, `:11711` y `:12745` los componentes que la
reciben, `:11765` el consumo en `corteDeEstimaciones`). Aquí haría falta
la gemela para `historialAvance` —`histCargado`— y `FotosCliente`
(`:16812`) tendría que recibirla y callar el encabezado y el riel
mientras sea falsa, en vez de contar cero. Conviene revisar de paso qué
otras pantallas reciben `historialAvance` sin saber si ya llegó.

**Prioridad**: alta, por la misma razón que el resto del #3 — se ve en
la demo, en la pantalla que el cliente abre para revisar evidencia.

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

### Subir UN esquema no cambia nada observable; el riesgo está en subir los dos juntos (medido 2026-10-05)

Esto salió mutando el código, no leyéndolo, y conviene que quede escrito
porque es contraintuitivo y porque la intuición equivocada es la peligrosa.

**Subir `ESQUEMA_SNAPSHOT` solo no cambia nada que se vea.** El umbral de
comparabilidad ya está en 3, y 4 ≥ 3 pasa. Se puede subir esa constante sola,
correr toda la suite, y no se pone nada en rojo — porque efectivamente no
rompe nada.

**El riesgo real es subir `ESQUEMA_SNAPSHOT` JUNTO CON `ESQUEMA_AVANCE`**, que
es exactamente lo que acaba haciendo un *«agregué campos, subo el esquema»*:
quien toca uno toca el otro por simetría, sin notar que el segundo es el que
manda. Ahí los **33 cierres de producción dejan de poder compararse** con los
nuevos, `sonComparables` los corta, y **la gráfica pierde la historia**. Un
campo añadido —que no cambió ninguna definición— habría partido la serie en
una frontera falsa.

De ahí la regla: **el esquema mide la DEFINICIÓN de una métrica, no la forma
del documento.** Agregar campos no es cambiar una definición. El corte de
estimaciones agregó `montoEstimado` y `montoPagado` y **no** subió nada; su
frontera es el propio `null`, que se explica solo.

La contraprueba que lo guarda (`/tmp/mut-corte.cjs`, mutación «el esquema sube
y deja fuera de la gráfica los cierres de producción») sube **las dos**
constantes, justamente porque subir una sola no se puede detectar: no hay nada
que detectar.

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

### El correo quedó el 2026-11-02; el manual sigue abierto

Lo pidió Oscar así: que al dar de alta una obra o un usuario salga un aviso
por correo —al gerente de construcción y a quien se le asigne la obra— y
que al usuario nuevo le llegue el instructivo. Y cuatro decisiones suyas:
la contraseña temporal **se genera sola** cuando sale el correo, con los
pasos para cambiarla; lo básico va en el cuerpo del correo; el aviso de
obra nueva va «al gerente y a quienes estén asignados a esa obra»; y a una
dependencia se le manda su propio correo de acceso, con su marca, sin
pasos de captura y **nunca** el manual de FOSMON.

**Lo que se construyó.** Tres avisos que no salían de la app:

- `crearUsuario` sortea la contraseña **antes de tocar Auth**, para que sea
  la MISMA cadena la que se registra y la que viaja en el correo. Sortearla
  dos veces —una para cada cosa— es cómo se manda una clave que no abre
  nada, y es el tipo de defecto que no se ve hasta que alguien intenta
  entrar. El banco mide exactamente eso: compara la contraseña que recibió
  el Auth de mentira contra la que trae el HTML.
- `actualizarUsuario` avisa de las obras **agregadas**, y cuáles son lo
  dice el servidor comparando contra el documento vivo. En el cliente se
  comparaba contra la copia de la última recarga de la lista: si alguien
  más editaba al usuario en medio, la campanita nombraba unas obras y el
  correo otras.
- Los disparadores `obraNuevaRaiz` y `obraNuevaDeOrg` mandan el aviso de
  obra nueva (ver #85). El tipo de organización **se lee**, no se adivina:
  una obra en `orgs/limbo/obras/*` cuya organización no declara `tipo` no
  manda nada, en vez de inventar una marca y unos destinatarios.

**La frontera, que es la parte que no se negocia.** El correo de la
constructora dice «Presupuesto» y lleva el monto; el de la dependencia dice
«Monto contratado» y nombra a la empresa ejecutante. `cliente` y
`contratista` quedan **fuera** del aviso interno con su monto aunque estén
asignados a la obra — es el mismo principio por el que una dependencia no
lee la economía del contratista, aplicado al revés. Y una obra sin
presupuesto capturado **no imprime ninguna cifra**: dice «no se puede
medir» y la campanita dice «sin capturar», nunca `$0`. El banco lo mide con
`/\$\s?[\d]/` y no buscando el signo suelto, para que una hoja de estilos
no pueda hacer pasar la comprobación por accidente.

**Lo que ya no se hace a mano.** `CORREO_Aldo_Torres.md` y
`CORREO_Julian_Islas.txt` eran eso: correos de alta escritos uno por uno,
con contraseñas repetidas y adivinables. También se construyó la pantalla
para cambiar la propia contraseña, que **no existía** mientras el correo ya
la señalaba, y se quitó el campo de contraseña del alta: no la teclea nadie.

**Lo que falta.** El manual. No hay generador en el repo, y el contenido
viejo sigue diciendo CAMPO/FOSMON cuando la app es `cotea` con marca por
organización. Va en lote aparte, y el correo de bienvenida sólo lo adjunta
para los roles de campo de una constructora.

---

## 86. La respuesta del servidor leída del sobre: `undefined`, y la pantalla sigue

**Descubierto**: 2026-11-02, en el preview, persiguiendo por qué el alta de
un usuario no avisaba de nada. El emulador no tiene llave de Resend, así que
el correo con la contraseña temporal **no podía salir**; la alerta escrita
para justamente ese caso no apareció.

**Qué pasa**: `callFn` devuelve un SOBRE —`{ok, data}`, o `{ok, error, code}`
si el transporte falló— y lo que trae el servidor va dentro de `data`. Leer
`r.correo` en vez de `r.data.correo` no explota: da `undefined`, el `if` no
entra y la pantalla calla. Hay dos `ok` en juego, el del transporte y el del
servidor, y ahí está la trampa: `r.ok` existe y es cierto, así que el código
parece estar leyendo lo correcto.

**Los tres sitios**, todos en `src/App.jsx`:

1. La alerta de «la cuenta de X quedó creada, pero el correo con su
   contraseña temporal NO salió» **no podía dispararse nunca**. Esa alerta
   es la razón de ser del arreglo del #14: la cuenta existe y NADIE tiene la
   contraseña, y eso tiene que verse en la interfaz, no en un log de Cloud
   Functions que nadie lee.
2. `obrasAgregadas` se leía `undefined`, el `Array.isArray` lo volvía `[]` y
   el aviso de campanita de «te asignaron a nueva(s) obra(s)» no se mandaba
   nunca — mientras el correo del servidor sí las nombraba. Dos cuentas para
   un número, rota en silencio.
3. El alta que hace soporte desde el panel de plataforma ni miraba el correo:
   pintaba el aviso **en verde** y soporte se iba creyendo que el usuario ya
   tenía su acceso. Ahora va en rojo cuando el correo no salió, aunque el
   alta sí se hizo, porque lo que pide es una acción: ponerle contraseña
   desde el panel de usuarios.

**Por qué es de los que fallan en silencio, y no de los que se ven**: las
tres variantes son código que corre sin error. Nada en la consola, nada en
el registro de salud, nada en la pantalla. Lo único que se nota es la
ausencia de un aviso, y la ausencia de un aviso es exactamente lo que nadie
está mirando.

**Cómo se cerró el patrón**, no los tres renglones: la §6 de
`prueba-escritura-que-no-miente.cjs`. Es el mismo banco que ya medía las
escrituras que no quedan, porque es la misma clase de defecto —un resultado
que no está y la pantalla sigue adelante— en el otro canal. Recorre el AST
buscando cada `await callFn(...)` asignado a una variable, sigue las
referencias de esa variable y exige que todo lo que se lea de ella esté en
`{ok, data, error, code}`; cualquier otra cosa la puso el servidor y vive en
`data`. Hoy encuentra 7 sobres y ninguna lectura fuera de `data`. **Si no
encuentra ni un sobre, sale NO ARRANCÓ (2), no verde**: la forma del
envoltorio habría cambiado y la comprobación estaría midiendo el vacío. Tres
mutaciones nuevas en la contraprueba, que son el defecto tal como estaba
escrito, y las tres salen en ROJO 1.

Se consideró y se descartó aplanar el sobre (`{ok: true, ...res.data}`):
quitaría la trampa, pero funde el `ok` del transporte con el del servidor, y
el día que un manejador devuelva `ok:false` con significado la pantalla
diría «Error: undefined». La convención de dos capas está bien; lo que
faltaba era que romperla se viera.

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

### El recorte a 52 semanas sube de prioridad: con obras multianuales deja de ser un caso extremo (2026-10-01)

**Lo que cambió no es el código, es el supuesto.** El tope de
`semanas.slice(-52)` se escribió pensando en obras de un año o menos, donde
perder la semana 53 es perder algo que no ha pasado. Con obras **multianuales**
—un contrato de noviembre a marzo, o de dos años— el tope ya no recorta el
futuro: **recorta el arranque**. Un contrato de dos años pierde su primer año
completo, que es justo donde está la cimentación, el trazo y las
preliminares: lo que una controversia mira primero.

Y lo hace **callando**. Ahí está la parte que no se puede dejar así: un
expediente al que le falta el principio y no lo declara miente por omisión.
Alguien abre la línea de tiempo, ve que empieza en la semana 30 del segundo
año, y concluye que la obra empezó ahí.

**Requisito, independiente de cuándo se migre:** la línea de tiempo tiene que
**decir en pantalla** que la obra perdió su arranque, con cuántas semanas
faltan y desde cuándo. No es una nota al pie: es la diferencia entre un
expediente incompleto y un expediente que se presenta como completo.

#### ¿Hay que adelantar la subcolección antes de la demo? Medido el 2026-10-01

Con `scripts/medir-cierres-demo.cjs`, contra el emulador sembrado:

| obra demo | cierres | documento | % de 1 MiB | último cierre | caben más |
|---|---:|---:|---:|---:|---:|
| 0114 | 4 | 5.1 KB | 0.5% | 1,278 B | 816 |
| 0121 | 3 | 3.2 KB | 0.3% | 1,068 B | 978 |

**Para la demo aguanta de sobra, y por un margen que no es discutible.** Los
cierres de la demo pesan ~1.2 KB porque el catálogo sembrado tiene pocas
partidas; el peso de un cierre lo manda el número de partidas, no el número de
semanas. A ese ritmo caben más de 800 cierres antes del límite, y lo que topa
primero es el recorte a 52 — no el megabyte.

**Conclusión: no conviene adelantar la migración antes de la demo.** La
migración tiene la parte delicada de la convivencia de dos formatos (arriba),
y meterla en la semana de la demo cambia un riesgo medido y nulo por un riesgo
real. Lo que **sí** conviene adelantar es la declaración en pantalla del
arranque perdido, que es barata y es la que evita la mentira.

Para que quede dicho: en **producción** la cuenta es la contraria. La 0114 va
al 93.8% con cierres de 140 KB, y ahí el peso topa mucho antes que las 52
semanas. La demo no se parece a producción en esto, y la medición de la demo
no autoriza nada sobre producción.

#### Cuánto crece el cierre con el corte de estimaciones (2026-10-01)

Los cuatro números del corte —`estEstimadoAcum`, `estAprobadoAcum`,
`estPagadoAcum`, `estPorCobrarAcum`— pesan **95 B por cierre** medidos con
`tamañoFirestore`, la misma regla que cobra Firestore (el nombre del campo
cuenta tanto como el valor: 4 números son 32 B, los nombres son los otros 63).

Qué tanto acerca el límite:

| documento | último cierre | con el corte | crecimiento |
|---|---:|---:|---:|
| `0114/avance/historial` (prod) | 140,392 B | 140,487 B | **+0.07%** |
| `0125/avance/historial` (prod) | 36,502 B | 36,597 B | **+0.26%** |
| cierre de la demo | 1,278 B | 1,373 B | +7.4% |

Sobre 52 semanas el corte suma 4,940 B: **0.47% de 1 MiB**. En la 0114, la
obra que ya reventó, adelanta el desbordamiento en **menos de un cierre**.

**No acerca el límite de forma significativa. Se puede escribir.** Lo que
mueve la aguja en ese documento son las partidas de cada cierre, no cuatro
números; el arreglo que bajó la 0114 de 140 KB a 29 KB fue dejar de copiar la
descripción de la partida, y ése es el orden de magnitud que importa.

Y el fallo sigue siendo ruidoso: `crearSnapshotAvance` escribe con `setDoc`
directo para que el error llegue vivo al llamador, y
`scripts/prueba-cierre-no-falla-callado.cjs` está en verde.

#### HECHO: el cierre ya guarda el corte (2026-10-05, `feature/seguimiento-semanal`)

Entraron **dos** campos, no los cuatro que se midieron arriba:
`montoEstimado` y `montoPagado`. Lo aprobado y lo por cobrar se dejaron
fuera porque hoy no hay ninguna pantalla que los pregunte por semana, y un
campo que nadie lee se vuelve un campo que nadie mantiene.

**Lo que costó, medido contra producción con
`scripts/medir-corte-estimaciones.py` (sólo lectura, REST + ADC):**
+1,584 B en total sobre los historiales, **0.14%**. El peor caso es la 0112
con 0.52%. El historial más pesado —la 0114, 582,729 B— sigue muy por debajo
del millón. No acerca el límite.

**Lo que se perdió para siempre, y es el número que importa: 33 semanas ya
cerradas en producción nunca van a poder decir su estimado.** No se
interpola, ni hacia adelante, ni hacia atrás, ni con el total de hoy. Esas
tres son la misma mentira con distinta aritmética: pintan una línea plana
hacia atrás con un valor que nunca ocurrió. El hueco se escribe `null` y el
riel dice en pantalla *«el cierre de esa semana no registró las
estimaciones»* — una sola vez en todo el archivo, en `FRASE_SIN_CORTE_EST`.

**Tres estados distinguibles, y la prueba afirma los tres:** una cifra
registrada, un **cero registrado** (verdadero: las obras 0125 y 0127 no
tienen estimaciones) y un hueco. Un `0` donde va un hueco se leería «esa
semana no había nada estimado», que es una afirmación, no una ausencia (P2).
Por eso el `null` va **explícito** en el documento y no se omite el campo:
así se distingue «el cierre corrió sin saber» de «este snapshot es anterior
al corte». Las dos se ven igual en pantalla; sólo una es un defecto
perseguible.

**El peligro no era la suma, era la ventana de carga.** `estimaciones`
arranca en `[]` y se llena cuando contesta Firestore. Cerrar ahí dentro
congelaría **$0** en el expediente de una obra con $109.2M estimados.
`corteDeEstimaciones(estimaciones, cargadas)` devuelve `null` —no un objeto
de ceros— si la lista no cargó, y el parámetro omitido (`undefined`) también
cae del lado seguro. `estCargadas` ya existía en el código y **nunca se
leía**; ahora es la guarda.

**El esquema NO sube, y es deliberado.** `ESQUEMA_SNAPSHOT` mide la
definición del avance y del dinero ejecutado, y ninguna cambió: esto agrega
dos cifras sin tocar las viejas. Subirlo partiría las series en una frontera
falsa. Al mutar el código para comprobarlo salió algo que no se esperaba:
subir `ESQUEMA_SNAPSHOT` **solo** no cambia nada observable (el umbral de
comparabilidad ya está en 3, y 4 ≥ 3). El riesgo real es subirlo **junto con**
`ESQUEMA_AVANCE`, que es exactamente lo que acaba haciendo un «agregué
campos, subo el esquema»: ahí los 33 cierres de producción dejan de poder
compararse y la gráfica pierde la historia. La contraprueba mutante ahora
sube los dos.

**La prueba:** `scripts/prueba-corte-estimaciones.cjs`, 6 secciones, verde;
contra `main` sale exit 1 con 28 comprobaciones en rojo. **17 contrapruebas
semánticas, las 17 en rojo.** Tres se quedaron en verde en la primera
corrida, y ésas fueron las que valieron: dos demostraron que la prueba
ejercitaba los dos extremos —el corte y el escritor— pero **nunca el cable
entre ellos**, que es justo lo que un refactor corta en silencio; se agregó
la §5, que extrae el 7º argumento de la llamada a `crearSnapshotAvance` y lo
ejecuta. La tercera era un error de medición mío: la §4 comparaba dos
snapshots que ambos leían la constante, así que mover la constante movía los
dos extremos y la comprobación era tautológica.

**`prueba-cierre-emulador.cjs`** se puso roja de verdad al comparar el
snapshot nuevo contra los rescatados de producción S37/S38-2026. En vez de
relajarla a «subconjunto» —que dejaría pasar un campo **perdido**— se le
puso `CAMPOS_AGREGADOS`, una lista con la razón escrita por campo, más una
comprobación de que cada campo de la lista **sí se escribe**, para que el
permiso no se pudra en una lista vacía.

**Pendiente menor que esto dejó:** `_ne` subió a ámbito de módulo porque
`corteDeEstimaciones` lo necesita y la alternativa era una séptima copia de
la misma línea. Las **5 copias locales siguen ahí** (`src/App.jsx` ~4560,
8419, 8744, 10917, 11367, y `_neEst` en 17587). Colapsarlas sobre la de
módulo es limpieza de una línea cada una, pero toca cinco componentes que
nada tienen que ver con este cambio: va en su propia rama.

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
de la 0125 confirmadas por Oscar el 2026-09-22.

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

Replanteado con Oscar el mismo día. El peso es el síntoma; el problema es
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
vale nada hasta que otra fuente la confirme. **Oscar lo señaló; se
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

### Medido otra vez el 2026-10-01: la mitad barata ya se puede, y la cara apuntaba al traslape equivocado

Al revisar la vista de dependencia salió la pregunta de si conviene adelantar
parte de esto para la demo. Se volvió a medir producción —solo lectura, el
guion es `scripts/medir-semanas-evidencia.cjs`— y hay dos hallazgos que cambian
el plan de arriba sin invalidarlo.

**1. Agrupar por semana NO necesita migración. Se puede hoy, al leer.**

| | |
|---|---:|
| fotos de avance referenciadas en el catálogo | **541** |
| con `fecha` usable, o sea con semana deducible | **541 (100%)** |
| cadena suelta, sin ningún campo de fecha | 0 |
| objeto sin `fecha`, o con `fecha` ilegible | 0 |

Eran 475 el 2026-09-22; siguen entrando. El esquema mixto que `FotosCliente`
contempla —la foto como cadena suelta— **no aparece ni una vez en producción**.
O sea que el convenio `Y2026-S38` se puede calcular al pintar, y la pantalla de
"ver una semana" **no depende de la subcolección, ni de soltar la URL, ni de la
migración de nómina**. Esa parte del #30 es peso; esta es consulta. Son
separables y el orden natural es el inverso al que dice el punto 4.

Semanas con evidencia, las cinco obras juntas: **S30 a S40, ocho semanas
distintas.** La 0114 tiene las ocho; la 0126 dos; la 0127 una; la 0125 ninguna.

**2. Pero «comparar dos semanas alineando las partidas en común» se apoya en un
traslape que los datos no tienen.** Partidas en común entre cada par de semanas
en la 0114 (la diagonal es cuántas partidas tuvieron foto esa semana):

```
        S30  S32  S33  S36  S37  S38  S39  S40
S30       2    2    0    0    0    1    0    0
S32       2   23    9    3    0    4    0    3
S33       0    9   30   12    2   10    4    2
S36       0    3   12   27    7   14    7    4
S37       0    0    2    7   19    8    5    3
S38       1    4   10   14    8   25   10    5
S39       0    0    4    7    5   10   17    4
S40       0    3    2    4    3    5    4   16
```

Entre semanas **vecinas** hay material: S36↔S38 traslapan 14 partidas, S33↔S36
doce, S38↔S39 diez. Entre semanas **lejanas** se desploma: el ejemplo que se usó
para pedir esto —«la obra de hace tres semanas contra hoy», o sea S37 contra
S40— traslapa **3 partidas de 19 y 16**. Dos columnas alineadas por partida
darían tres renglones alineados y veintinueve huecos.

Y no es un defecto de captura: es lo que hace un residente. Fotografía lo que
avanzó esa semana, y cada semana avanza otra cosa. De las 83 partidas de la 0114
que alguna vez tuvieron foto, **40 (48%) tienen foto en una sola semana**:

| foto en … | partidas |
|---|---:|
| 1 semana | **40** |
| 2 semanas | 19 |
| 3 semanas | 16 |
| 4 semanas | 7 |
| 5 semanas | 1 |

**La unidad de comparación no es «dos semanas», es «una partida a lo largo de
sus semanas».** Hay **43 partidas** con foto en dos semanas o más —contra las 3
del par S37/S40—, y ahí sí está la pregunta que se le hace al producto: *cómo
cambió ESTO*. El eje correcto es el concepto, y la semana es la columna.

Eso **no tira** el punto 3 de arriba: "ver una semana" sigue siendo la pantalla
de entrada. Lo que se reemplaza es el "comparar dos semanas, dos columnas" por
**la tira de una partida**: elegida una partida, sus fotos en fila ordenadas por
semana, con los huecos dichos como huecos. Comparar dos semanas enteras se
queda, pero como lo que es —qué se documentó cada semana—, no como el momento
de la demo.

**3. Lo que la pantalla NO puede decir.** `fecha` es la de **subida**, y eso ya
estaba comprobado contra el `timeCreated` de Storage. Así que se dice "subidas
en la semana del 22 de septiembre" y nunca "así se veía la obra en la S38"
(P2). El caso 0112 lo obliga: sus 255 fotos caen todas en S30 porque fueron un
volcado histórico de un día. Una pantalla que las presente como "el trabajo de
la semana 30" miente, y encima es la obra donde más falta hace ver el cambio.

**4. Para la demo, la evidencia no existe en los datos sembrados.**
`scripts/sembrar-preview-emulador.cjs` no escribe ni una foto. Las tres OBRA
DEMO entran a Evidencia y leen "Aún no se han cargado fotos de esta obra". O
sea que hoy la pestaña no es redundante en la demo: está **vacía**.

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
> con Oscar el 2026-09-22.
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

## Las fotos sin `id`: MEDIDO en producción, y producción está limpia (2026-10-05)

**Encontrado mirando la consola del emulador, no buscado.** `ConceptoFotos`
(`src/App.jsx:5726`) pone `key={f.id}` en cada miniatura, pero la consola
avisaba *«Each child in a list should have a unique key prop»*. Si `f.id`
sale `undefined`, todas las miniaturas comparten la misma llave vacía,
`onDel(f.id)` no identifica a ninguna, y React puede reusar el nodo
equivocado al reordenar — y la lista **sí** se reordena, porque «ver
anteriores» cambia `visibles`. Eso sería **pérdida de datos a un clic**.

**Medido con `scripts/medir-fotos-sin-id.py` (sólo lectura, REST + ADC)
contra las 5 obras de producción:**

| | |
|---|---:|
| fotos en producción | **631** |
| objetos sin `id` | **0** |
| fotos que no son objeto | **0** |
| `id` repetidos | **0** |

Las 631 traen `url`, `id` y `fecha`, y los 631 `id` son distintos. **En
producción no hay riesgo.**

**De dónde salía el aviso, entonces:** de la propia siembra.
`scripts/sembrar-preview-emulador.cjs:226` mete a propósito una foto como
**cadena suelta** —`mete(filas[1], fotoSVG(...))`, sin envolver en objeto—
para ejercitar el esquema mixto. Una cadena no tiene `.id`. Es decir: el
sembrador está sembrando una forma que **hoy no existe en producción**.

**Lo que esto deja pendiente, que es más chico y de otra clase:** decidir si
esa forma debe seguir sembrándose. Si el esquema mixto ya no llega en el
dato real, la siembra está ejercitando un caso muerto y a cambio mete ruido
en la consola. Si se conserva —porque puede volver por una importación
vieja—, entonces `ConceptoFotos` debería darle una llave estable en vez de
`undefined`, y el índice **no** sirve: vuelve a romper justo al reordenar.

**Lección de método, que es la parte que vale.** La primera versión del guion
copió el filtro de `fotosDeSub`, que descarta lo que no es objeto — con lo
cual las fotos guardadas como cadena, que son **justamente las que no pueden
tener `id`**, quedaban fuera del conteo. Habría reportado «0 sin id» por
construcción: *la pregunta excluía la respuesta*. Se corrigió contando todo y
clasificando después. Un medidor que hereda el filtro del código que audita
no está midiendo: está repitiendo.

---

## La cuenta de «Última captura» está escrita cuatro veces — y la tabla de la dependencia NO es una de ellas

**Anotado el 2026-10-05. Va en su propia rama, por decisión explícita del
usuario: colapsarlas toca el tablero de FOSMON y eso merece su ritual.**

**Corrección de una afirmación mía previa, porque estaba mal y es el tipo de
error que manda a arreglar la pantalla equivocada.** Llegué a reportar que la
tabla de la dependencia pintaba un guion mudo. **No es cierto.** `celdaDe`
(`src/App.jsx:8582`) ya dice `'sin captura'`, las mismas palabras que el KPI
del detalle (`src/App.jsx:11517`), y
`scripts/prueba-tabla-dependencia.cjs:398` ya lo guarda: afirma que
contratista, atraso y última captura **dicen que faltan** en vez de salir con
guion o con cero. La pantalla que esta rama creó nació sin el defecto.

**Dónde sí está el guion mudo:** en el tablero de la **constructora**.
`ultimaCapturaTxt` arranca en `'—'` (`src/App.jsx:7953`) y se pinta así en la
tarjeta (`:8251`) y en la tabla (`:8361`). Un `—` se lee «no aplica», no «no
se sabe»: es el P2.

**Las cuatro copias de la cuenta**, todas `Math.floor((HOY − fecha)/86400000)`:

| dónde | qué hace | caso vacío |
|---|---|---|
| `:7851` | alerta «sin captura ≥ 7 días» | no emite |
| `:7954` | texto de la tarjeta/tabla de constructora | **`—`** |
| `:7979` | `diasSinCaptura` de la misma fila | `null` |
| `:8457` | `diasSinCaptura` de la dependencia | `null` |

**Lo que NO es un defecto, aunque lo parezca:** que la constructora lea
`fechaCaptura` y la dependencia `fechaCierre || fechaCaptura`. Se verificó:
`fechaCierre` sólo se escribe en cierres oficiales y en ese instante vale lo
mismo que `fechaCaptura`; si no, es `null` y la expresión cae al mismo campo.
**Nunca se contradicen en la fecha.** La diferencia real entre las dos
definiciones es únicamente el caso vacío.

**Qué hacer cuando entre:** una sola función que devuelva `{dias, fecha}` con
`null` cuando no hay, y que las cuatro la llamen; el texto se decide en un
solo lugar y dice `'sin captura'` en los cuatro. Es RIESGO ALTO: la columna
es ordenable, así que el caso vacío no sólo se pinta — también decide en qué
lugar cae la obra, y hoy el orden ya manda los `null` al final a propósito.

---

# Referencia rápida — resumen de prioridad

Los principios P1 a P6 (arriba) no están en esta tabla: no se
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

**Esta tabla llega al #34 y el documento llega al #47.** Del 35 al 47 los
pendientes viven sólo en su sección, más abajo. Se deja dicho en voz alta
porque una tabla de resumen que se quedó corta se lee como la lista completa, y
entonces lo que falta en ella parece que no existe — que es la forma más
barata de perder un pendiente. Quien agregue el #48 puede cerrar el hueco de
paso; mientras no esté cerrado, la tabla **no** es el índice.

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

---

## 35. El modelo escrito decía que la dependencia no captura — y es falso

**Corregido en documento el 2026-09-23. Las reglas todavía NO.**

### Lo que decía, y por qué confunde

`SECURITY_RULES.md` describía el reparto como «la constructora ejecuta y
captura, la dependencia supervisa». De ahí salieron las cinco subcolecciones
que hoy tiene `orgs/{oid}/obras/{obraId}` en las reglas vivas —
`contratistas`, `supervisores`, `programa`, `convenios`, `evidencia` —, todas
de supervisión documental y **ninguna de captura**.

**En una dependencia el supervisor de obra sí captura el avance.** Es quien va
a la obra, verifica físicamente y reporta; diario o semanal según lo exija la
dirección de Obras Públicas. No recibe un número del contratista para
validarlo: lo levanta él. Decisión de producto del usuario, 2026-09-23.

### Por qué importa más de lo que parece

Con las reglas como están, escribir `orgs/{oid}/obras/{id}/avance/subs` cae en
el `match /{document=**}` final, que deniega. Y como las escrituras pasan por
`fsSet`, que **devuelve `false` en silencio**, la captura parecería funcionar
sin guardar nada.

Es el mismo defecto del #31 —el histórico de subcontratos, que tardó tres años
en descubrirse— y el mismo que se evitó a tiempo en el #28 escribiendo la
regla de `nomina_historial` *antes* de la primera escritura. Tercera vez que
aparece el patrón: **ruta no declarada + helper que se traga el fallo = datos
que se evaporan sin un solo error en consola**.

### Qué hay que agregar

Siete rutas, con el bloque exacto en `SECURITY_RULES.md` §«CORRECCIÓN DE
MODELO»: `config/info`, `config/parametros`, `config/catalogo`,
`config/estimaciones`, `config/permisos`, `avance/subs` y `avance/historial`,
más `bitacora/{id}` para las incidencias. Y `orgs/{oid}/config/branding`, que
es de donde el paquete de marca de cotea lee el logo del cliente.

### Qué NO se agrega, a propósito

`nomina/historial`, `nomina_historial/{semanaId}`, `subcontratos/lista`,
`avance/maquinaria`, `avance/materiales` y `config/otros_gastos`. Entre esas
seis está el margen del contratista. Dejarlas fuera de las reglas hace que la
frontera de confidencialidad sea **estructura**, no disciplina.

### Los roles cuadran — verificado contra las reglas vivas

`contralor` está en `esDirectivoD()` (lectura) y **no** en
`esDirectivoDEditor()` (escritura): sólo lee, tal como se quería.
`jefe_supervision` escribe sin límite de obra; `supervisor_obra` sólo en las
asignadas. `contratista` está en `puedeVerObraD` pero **no** en
`puedeEditarObraD`: hoy sólo lee, y así se queda hasta que le toque.

Dos cosas que el usuario no pidió pero las reglas ya conceden, y conviene
mirar antes de desplegar: **`administrativo` también escribe** obras asignadas
vía `puedeEditarObraD`, y **`director_obras` y `subdirector` escriben**, no
sólo leen.

**Resuelto el 2026-09-23: se quedan como están, por decisión del usuario.**
*«Si alguien de dirección no puede corregir una captura mala, el sistema
estorba en lugar de ayudar. Y administrativo también.»* No es un descuido de
las reglas: es el permiso que se quiso dar. No "arreglarlo" después.

### Estado

- [x] `SECURITY_RULES.md` corregido — 2026-09-23
- [x] Este apunte — 2026-09-23
- [x] `firestore.rules`: las ocho rutas más `config/branding` — 2026-09-23, `e2b2d73`
- [x] Prueba de emulador — 2026-09-23, `17da398`. 24/24 verde, y cuatro
      contrapruebas semánticas que fallan cada una en una afirmación distinta:
      quitar `avance/subs` (§1), agregar `nomina_historial` "por simetría"
      (§2), quitar `!esContratista()` (§4), escribir con `puedeVerObraD`
      (§3 y §4).
- [x] Desplegar reglas — **2026-09-24 19:32 UTC**, lo disparó el usuario.
      Ruleset `d29ec434-df74-4542-96c9-9a47f9aa46ce`, idéntico byte a byte al
      archivo y comprobado vivo 34/34 con la API `projects:test` sobre el
      ruleset bajado del servidor. **El defecto de #35 ya no puede ocurrir en
      producción.**

**Ojo con el orden:** se desplegó desde la rama, antes de mezclar. Hasta que
`fix/modelo-dependencia-captura` entre a `main`, el archivo de `main` **no**
es el que corre en producción — exactamente la clase de desfase que hizo que
«NO desplegado» envenenara dos análisis. Conviene mezclar pronto.

Un defecto latente que se vio de paso y **no** se tocó, para no mezclarlo con
esto: `match /evidencia/{eid}` exige `obraId in obrasAsignadas()` en el
`create` incluso para `esDirectivoD()`, así que un director con `todas:true`
y `obras:[]` no puede subir evidencia. No estorba para la demo.

---

## 36. El naranja de marca choca con el naranja de estado — y el color va solo

**No es para la demo.** Decisión del usuario el 2026-09-23: *«Tienes razón y es
más grande de lo que parecía. Pero NO lo hagas ahora. Para la demo el color de
estado puede quedarse como está.»*

### El choque

El manual de marca reserva el naranja `#FF6B35` para la marca y dice, con todas
sus letras, que **el naranja nunca comunica estado**. Hoy la app usa naranja/
ámbar para «atraso moderado» en las barras, en los chips y en el PDF. Si se
pinta el logo en naranja y al lado una barra naranja, el usuario no puede saber
si eso es marca o es alarma — y cuando el color deja de significar, deja de
servir para las dos cosas.

El paquete ya trae la salida: `--c-estado-moderado-barra` apunta a
`--c-grafito-500` (acero), de modo que **las barras de atraso moderado se
rellenan en acero, no en ámbar**, y el ámbar queda sólo para el punto de
estado, que es chico y no compite con la marca.

### Lo que hay que hacer, que es más que cambiar hexes

El color va solo. Un usuario con daltonismo rojo-verde —entre el 6 % y el 8 %
de los hombres, y esta app la usan casi puros hombres en obra, a pleno sol, en
un celular— **no distingue hoy «al corriente» de «crítico»**. Ese defecto ya
existe; el tema de marca sólo lo hizo visible.

Los tokens ya declaran la forma junto al color:

| Estado    | Color              | Forma       |
|-----------|--------------------|-------------|
| Al día    | verde `#2E9E6B`    | círculo     |
| Moderado  | ámbar `#E8A33D`    | triángulo   |
| Crítico   | rojo `#D14B3D`     | cuadrado    |

`--c-estado-*-forma` es una cadena, no CSS: **se implementa con ícono**, no con
`border-radius`. Hay que recorrer los lugares donde hoy el estado se comunica
sólo pintando —chips, barras, semáforos de la tabla, leyendas, el PDF de
jsPDF— y agregar la forma. La regla para saber si quedó: **en escala de grises
el informe se sigue leyendo.** Esa es la prueba, y es fácil de correr.

### Por qué no ahora

Toca decenas de puntos de render y el riesgo no está en cada cambio sino en el
total: es exactamente el tipo de barrido que se hace en una rama propia, con la
suite completa encima, y no la semana de una demo. El puente de `var()` —que sí
va antes de la demo— deja esto **más barato**, porque después de él los colores
de estado se cambian en un lugar.

---

## 37. Los íconos de PWA no se despliegan hasta después de la demo

Decisión del usuario el 2026-09-23. El paquete de marca trae íconos nuevos y
sería tentador subirlos con el resto del cambio visual. **No van.**

**Por qué:** FOSMON ya tiene la app instalada en las pantallas de inicio de sus
teléfonos. Cambiar a la vez el `name`, los íconos y el `theme_color` del
manifiesto es justo la combinación con la que iOS se comporta peor: no
re-renderiza el ícono de una app ya instalada, y en algunos casos hay que
desinstalar y reinstalar para que tome el nuevo. Es decir, el precio del cambio
lo pagarían los usuarios que ya trabajan con la app, a cambio de un ícono que
en la demo **nadie va a ver**: la demo se enseña en una laptop, en el navegador.

**Qué sí entra antes de la demo:** las cadenas visibles, la tipografía y el
color en pantalla. Nada de eso toca el manifiesto.

**Cuándo entra:** después de la demo, como cambio propio, avisando antes a
quien tenga la app instalada y con un canario en un teléfono iOS real antes de
soltarlo. El `id` del manifiesto es el que decide si iOS lo trata como la misma
app o como otra; hay que fijarlo explícitamente en ese cambio y no dejarlo al
valor por omisión.

**Al día 2026-10-01, con el renombre a cotea ya hecho.** Lo que cambió fueron
las cadenas visibles —`<title>`, la descripción, `PRODUCTO.nombre` y el
emblema—. Lo que sigue diciendo CAMPO a propósito, y entra con este pendiente,
son exactamente tres cosas: `apple-mobile-web-app-title` en `index.html`, el
`name`/`short_name` del manifiesto en `vite.config.js`, y los íconos
(`icon-192.png`, `icon-512.png`, `apple-touch-icon`). Están comentados en
`index.html` nombrando este riesgo, para que nadie los «termine de renombrar»
creyendo que fue un olvido. **No lo fue.** Son la identidad de la app ya
instalada en los teléfonos de FOSMON.

---

## 38. El login inventaba el perfil que no encontraba — ARREGLADO 2026-09-24

`Login.handleLogin` hacía esto: si `usuarios/{emailId}` no existía, tomaba un
mapa `ROLES_DEFAULT` cableado en el código, y si el correo tampoco estaba ahí
**se autoasignaba `administrador_obra`** y lo **escribía** en Firestore.

```js
perfil = ROLES_DEFAULT[email] || { rol:"administrador_obra", nombre:email };
await fsSet(`usuarios/${emailId}`, { ..., creadoPor: "auto-sync-from-login" });
```

**Por qué es grave más allá de la rama en la que se encontró.** Son tres cosas
a la vez:

1. **Un usuario autenticado se concede permisos a sí mismo.** El único
   requisito es pasar Auth y que el perfil no cargue. `administrador_obra`
   escribe avance, nómina y estimaciones.
2. **Deja rastro escrito.** No es un rol en memoria que se pierde al recargar:
   el documento queda creado, así que el permiso es permanente y el siguiente
   que lo mire creerá que alguien lo dio de alta a propósito. El único indicio
   es `creadoPor: "auto-sync-from-login"`.
3. **Le basta que la LECTURA falle, no que el perfil falte.** `fsGet` se traga
   el error y devuelve `null` (es el patrón de #31 y #35). Un `permission-denied`
   transitorio o una red mala son indistinguibles de "no existe". Y el mapa ya
   mentía: le daba `admin_sistema` a un usuario que en producción es
   `director_operaciones`.

Con organizaciones el daño crece: una cuenta de dependencia cuyo perfil no
cargue entra como constructora y escribe en la raíz, o sea en el espacio de
FOSMON.

**Cómo quedó.** Sin perfil no se entra: mensaje claro, `signOut`, y ni una
escritura. Un huérfano de verdad lo repara un administrador —`crearUsuario` ya
contempla ese caso, ver `functions/index.js:157`—, no el propio login.
`ROLES_DEFAULT` se borró: era su único lector.

**Costo comprobado: ninguno.** Medido contra producción el 2026-09-24 con ADC
en sólo lectura: 14 usuarios en Auth, 14 perfiles, los 14 con `orgId`. Nadie
dependía de esta rama para entrar.

---

## 39. El resumen semanal por correo no mira la organización

`enviarResumenSemanal` arma sus destinatarios así (`functions/index.js:1078`):

```js
const usuariosSnap = await db.collection("usuarios").get();
const destinatarios = usuariosSnap.docs.map(d => d.data())
  .filter(u => u.activo !== false && ROLES_RESUMEN_SEMANAL.includes(u.rol))
```

Lee la colección **raíz** de usuarios y filtra **sólo por rol**. No mira
`orgId`. Hoy no hace daño porque `ROLES_RESUMEN_SEMANAL` son tres roles de
constructora (`director_general`, `director_operaciones`,
`gerente_construccion`) y sólo existe una organización.

**El día que deje de ser inofensivo** es el día que un rol de dependencia entre
a esa lista —o que se agregue una segunda constructora—. Entonces el correo,
que lleva **margen bruto por obra**, sale a gente de otra organización. Es la
misma frontera del margen que las reglas sí defienden (#35), abierta por un
camino que las reglas no tocan: Cloud Functions corre con privilegios de
administrador y las reglas no se le aplican.

Y el cuerpo del correo tiene el mismo problema por otro lado: `calcularKpisObra`
lee `obras/*` de la raíz, así que aunque los destinatarios se filtraran bien,
las cifras seguirían siendo las de FOSMON.

**Va con la rama del resumen semanal** (`feature/resumen-semanal`, pendiente de
rebase y canario), no antes: es el mismo archivo y conviene un solo canario.
Cuando se haga, el filtro tiene que ser por `orgId` **y** la obtención de obras
tiene que respetar el prefijo de la organización. Y hace falta una prueba que
afirme que un usuario de otra organización **no** aparece entre los
destinatarios.

## 40. La lectura del GP Sheet arranca antes de que haya sesión

Visto en el emulador el 2026-10-01, entrando desde el formulario de login como
`director_general`: el saludo sale con el chip **ámbar "GP Sheet · no
disponible"**, y con él `GASTADO` y `MARGEN` en "no disponible". Al recargar la
página —ya con sesión— el chip sale verde y las dos cifras aparecen.

La causa es el momento, no el permiso. `useGPConstruct` pide
`global/gp_construct` al montar el componente, y al montar todavía no hay
usuario. La regla `allow read: if esConstructora() && !esCliente()` evalúa un
token que no existe y niega, con razón. `permission-denied` está clasificado
como **terminal** —y está bien que lo esté: reintentar la misma lectura sin
sesión da exactamente lo mismo—, así que no hay reintento. Nada vuelve a
disparar la carga cuando el login termina.

**No lo introdujo `feature/ui-dependencia`.** En main el efecto es
`useEffect(() => { cargarGP(); }, [])` (App.jsx:5258) y corre en el mismo
instante. La rama lo dejó como `[activo, cargarGP]`, y `activo` ya es `true`
antes del login porque `esDependencia(null)` es `false`. Mismo momento, mismo
resultado.

**Por qué casi no se ve en producción.** Firebase persiste la sesión: el camino
normal de un usuario de FOSMON es abrir la app con sesión viva, y entonces al
montar ya hay token. Se manifiesta en el primer login después de cerrar sesión,
en una ventana de incógnito, y tras `?_reset=1`.

El arreglo es volver a cargar cuando aparece la sesión, no relajar la
clasificación de `permission-denied`. Lo natural es que `activo` conteste
"¿esta sesión lee GP?" en vez de "¿esta organización lo leería?" —hoy contesta
lo segundo y por eso no cambia con el login—. Hace falta una prueba que afirme
que, con el usuario llegando después del montaje, el estado de GP termina en
`listo` y no en `error`.

## 41. Los datos de la empresa ejecutante se teclean, y ya existe de dónde traerlos

**Anotado el 2026-10-01, con la dependencia explícita pedida por el usuario.**

El formulario de contrato del lado dependencia pide **razón social y RFC de la
empresa ejecutante** como texto libre
(`CAMPOS_CONTRATO.dependencia`, marcados `fuente: "padron"`). Para la demo está
bien y así quedó decidido. Lo que no está bien es que se quede así.

**De qué depende, por nombre.** De la pantalla del **padrón de contratistas**.
La colección ya está declarada en las reglas —`orgs/{oid}/contratistas/{cid}`,
`firestore.rules:383`— y no existe nada que la escriba ni que la lea. Mientras
eso no exista, este pendiente no se puede cerrar: no hay de dónde elegir.

**Por qué importa, y no es comodidad de captura.** Un RFC teclado por tres
personas distintas en tres obras de la misma empresa da tres empresas. El día
que la dependencia quiera preguntar *«¿cuántos contratos tiene adjudicados esta
constructora y cómo va cada uno?»* —que es la pregunta que justifica tener el
sistema— la respuesta va a depender de que nadie haya puesto un espacio de más.
El texto libre no se puede agrupar, y es el tipo de daño que no se nota hasta
que ya hay dos años de datos.

**Qué hay que hacer cuando entre.**

- Pantalla de padrón: alta, baja y búsqueda de contratistas de la organización,
  con el RFC como identidad y validación de forma.
- En el formulario del contrato, cambiar los dos campos de texto por un
  selector que llene `empresaEjecutante` y `empresaRFC` al elegir. El marcador
  `fuente: "padron"` existe para que ese cambio sea en un solo lugar: la tabla.
- Decidir qué pasa con lo ya capturado a mano. Lo más probable es una
  conciliación asistida, no una migración automática: dos razones sociales
  parecidas pueden ser dos empresas de verdad.
- Quitar la leyenda «Se captura a mano…» que hoy va junto al campo.

**Lo que NO hay que hacer:** inventar el padrón a partir de lo capturado.
Sería dar por buena la normalización que precisamente falta.

### Ya hay una pantalla que lo sufre: la tabla de obras (2026-10-02)

La tabla ordenable del tablero de dependencia tiene columna **Contratista**, y
se puede ordenar por ella. Eso convierte el texto libre de un problema futuro
en uno **visible hoy**: ordenar agrupa por cadena, así que
«Constructora del Golfo, S.A. de C.V.» y «Constructora del Golfo SA de CV»
quedan separadas por todo el alfabeto, y el director que ordena por
contratista para ver cuánto le tiene adjudicado a una empresa ve dos bloques
y suma uno solo.

La tabla **no espera** al padrón —el dato existe y es el que hay—, pero este
pendiente deja de ser higiene de datos y pasa a ser una pantalla que puede dar
una respuesta incompleta sin avisar. Cuando entre el padrón, el orden de esa
columna pasa a ser por identidad, no por cadena.

**Lo que se hizo mientras tanto (2026-10-05, `feature/seguimiento-semanal`).**
La columna ordena por una clave normalizada: minúsculas, sin acentos, sin
puntuación y con los espacios colapsados. Con eso las dos capturas de arriba
quedan **adyacentes** en la lista. No se cuenta ni se suma nada por empresa, y
eso es a propósito: la clave es suficiente para poner dos renglones juntos y
**no** es suficiente para afirmar que son la misma persona moral.

Lo que se midió al escribir la prueba, porque la primera versión de la clave
no servía: `localeCompare` con `sensitivity:'base'` ya perdona acentos y
mayúsculas por su cuenta, así que normalizar sólo eso no cambiaba **ningún**
orden. Lo que sí pesa es la puntuación: con la coma dentro, «Acme, S.A. de
C.V.» y «ACME SA DE CV» quedaban en los extremos con «Acme Servicios del
Golfo» —otra empresa— en medio. Quitar la puntuación es lo único de la clave
que hace trabajo real.

**Lo que la clave sigue sin resolver, y por eso el pendiente no se cierra:**
abreviaturas («Const.» vs «Constructora»), orden de palabras, errores de
dedo, y empresas distintas con nombre casi igual. Nada de eso se arregla sin
identidad, y la identidad es el RFC del padrón.

Mientras tanto, la celda dice **«sin capturar»** cuando la obra no tiene
empresa, para no confundir «no hay dato» con «no hay contratista».

**Dónde está anotado en el código:** el comentario de `CAMPOS_CONTRATO`
(`src/App.jsx`) nombra este pendiente por número. Si se renumera, se renumera
en los dos lados.

---

## 42. cotea no tiene eslogan, y el campo está esperando uno

**Decisión del usuario el 2026-10-01, al renombrar el producto.**

El producto se llama **cotea** y nada más. El descriptor que acompañaba al
nombre —«Control de Avance, Maquinaria, Personal y Obra»— era el desarrollo de
la sigla CAMPO y dejó de significar nada en cuanto el nombre cambió, así que
se quitó.

`PRODUCTO.descriptor` (`src/App.jsx`) quedó como **cadena vacía, preparada y
pintada en ningún sitio**: los tres lugares donde la marca aparece
—acceso, encabezado y pie— preguntan por él antes de pintarlo, igual que
preguntan por `nombreOrg`. El día que haya eslogan, se escribe en ese campo y
aparece en los tres. No hace falta tocar JSX.

**Lo que falta:** decidir el eslogan. No hay fecha y no bloquea nada.

**Por qué quedó así y no con uno provisional.** Un eslogan provisional se
queda. Es la primera línea que el cliente lee en la pantalla de acceso y lo que
va a repetir cuando le cuente a alguien qué es esto; si dice algo tibio, eso es
lo que el producto significa. Mejor sin descriptor que con uno malo —palabras
del usuario— y el campo vacío es honesto: dice que no hay, no inventa uno.

**La regla que protege el hueco.** `prueba-ui-dependencia.cjs` afirma que el
descriptor es una cadena —aunque hoy esté vacía— y que sólo se pinta donde
alguien preguntó por él. Cuando se llene, esas dos comprobaciones siguen
valiendo tal cual: el banco no comprueba el texto, comprueba que no se pinte
un hueco.

---

## 43. El correo del resumen semanal sigue firmando como CAMPO · FOSMON

**Anotado el 2026-10-01. Va en la rama del resumen semanal, por decisión
explícita del usuario — NO en `feature/ui-dependencia`.**

El renombre a cotea cambió las cadenas del front. El correo semanal que manda
`functions/index.js` **no**, y es el único sitio donde la marca sale del
navegador y llega a la bandeja de alguien.

**Los seis sitios, verificados en el archivo el 2026-10-01:**

| línea | qué dice | qué es |
|---|---|---|
| `functions/index.js:800` | `CAMPO <campo@fosmon.com.mx>` | el remitente — lo que se ve sin abrir el correo |
| `functions/index.js:981` | `<title>Resumen semanal CAMPO</title>` | el título del HTML |
| `functions/index.js:988` | `CAMPO · FOSMON CONSTRUCCIONES` | el encabezado, el que el usuario señaló |
| `functions/index.js:1021` | `Abrir CAMPO` | el botón |
| `functions/index.js:1026` | `CAMPO — FOSMON Construcciones · campo-fosmon.netlify.app` | el pie |
| `functions/index.js:1100` | `CAMPO · Resumen semanal · N obras activas` | el asunto |

**Por qué los seis y no sólo el 988.** Arreglar el encabezado y dejar el
remitente y el asunto diciendo CAMPO deja el correo peor que antes:
inconsistente en vez de viejo. Y el remitente y el asunto son justo los dos que
se leen sin abrir nada.

**Por qué no en esta rama.** Cambiar `functions/index.js` obliga a
redesplegar funciones, y hay un despliegue de funciones ya pendiente —la rama
del resumen semanal, que además toca este mismo archivo—. Dos despliegues de
funciones por un cambio de cadenas es gasto de riesgo sin motivo.

**Cuidado al hacerlo:** `FROM_EMAIL` lleva la dirección `campo@fosmon.com.mx`
pegada al nombre. El nombre que se enseña se puede cambiar solo; **la dirección
no se toca aquí** — es un remitente verificado y cambiarla es un trámite de
dominio, no una edición de cadena. Si se cambian las dos de un tirón, el correo
deja de salir y el síntoma es silencio, que es el peor síntoma posible para un
aviso semanal.

---

## 44. Un banco apuntado a un puerto muerto se cuelga en vez de fallar

**Anotado el 2026-10-01 por decisión del usuario. No va en
`feature/ui-dependencia`.**

Los bancos que hablan con el emulador —`prueba-reglas-*`, `prueba-cierre-*`,
`prueba-escritura-en-su-organizacion`— abren una conexión y esperan. Si el
emulador no está, o está en otro puerto, **no fallan: se quedan colgados**. La
suite no dice verde ni rojo; se queda quieta hasta que alguien la interrumpe.

**Por qué importa más de lo que parece.** El repo ya tiene tres estados con
significado y están cuidados a propósito: verde (0), **ROJO** (1) y **NO
ARRANCÓ** (2), este último justo para que «no se comprobó» no se pueda
confundir con «se comprobó y está bien». Colgarse es un cuarto estado que no
cabe en el esquema, y es el peor de los cuatro: un rojo se atiende y un
NO ARRANCÓ se atiende, pero algo que no termina se interpreta como «se está
tardando» y acaba en que alguien mata la suite y la da por corrida.

Un estado que no grita es peor que uno que falla. Son palabras del usuario, y
es exactamente el P2 aplicado a la herramienta en vez de al producto: la misma
clase de defecto que ya mordió dos veces este mes —el medidor de fotos que
contestó «0 fotos» con la mayor convicción, y el `timeout` que no existe en
macOS y convirtió 31 bancos verdes en 31 ROJOs falsos del 127—.

**Qué hay que hacer.**

- Un **plazo** por banco que hable con el emulador. Al vencerse: salir con 2,
  NO ARRANCÓ, diciendo qué puerto se intentó. Nunca con 1: no se comprobó
  nada, y decir ROJO sería inventar un resultado.
- Una **comprobación previa** de que el puerto contesta, antes de abrir la
  conexión larga. `sembrar-preview-emulador.cjs` ya lo hace, y es el modelo:
  pregunta, y si no hay nadie dice qué comando levantarlo.
- El corredor de la suite **no puede** depender del binario `timeout`: en macOS
  no existe. Si el plazo se implementa fuera del banco, hay que detectar
  `gtimeout`/`timeout` **y funcionar sin ninguno**. La primera versión del
  barrido de esta rama hacía `$TO 60 node …` con `$TO` vacío, lo que ejecuta
  `60 node …` → 127, «comando no encontrado», leído como NO ARRANCÓ en los 31
  bancos a la vez. Creíble y falso.

**Cómo comprobar que quedó.** Apagar el emulador y correr la suite completa:
tiene que terminar, y los bancos que lo necesitan tienen que salir en 2
nombrando el puerto. Hoy, sin emulador, no termina.

---

## 45. El PDF ejecutivo no es el documento que una dependencia necesita

**Anotado el 2026-10-01.**

El PDF ejecutivo (`generarPDFObra`) está hecho para una constructora: lleva
margen, gasto, nómina y subcontratos. Del lado dependencia esa pantalla no
tiene razón de existir —es justo la economía interna que no le toca ver (P5)—,
y lo que una dependencia sí tiene que producir es otra cosa: el **informe
semanal de avance** que la ley de obra pública le obliga a tener en el
expediente.

**Qué falta, en una línea:** decidir y construir el informe del **Art. 73** —
el reporte periódico de avance físico y financiero— como el documento del lado
dependencia, en el lugar donde hoy está el PDF ejecutivo.

**Lo que ya existe y sirve de materia prima.** El historial semanal de avance
(`avance/historial`), las estimaciones, el avance físico contra el contrato
ejercido, y —desde esta rama— la evidencia fotográfica fechada por semana, que
es precisamente lo que un informe de avance semanal necesita adjuntar.

**La trampa a evitar, y es la misma de siempre.** La foto trae la fecha en que
se **subió**, no la de ejecución. Un informe oficial que ponga una foto bajo el
rótulo «avance de la semana N» está afirmando algo que nadie capturó, y en un
expediente que se archiva eso dura años. Si el informe va a adjuntar evidencia,
o dice «subidas en» como dice la pantalla, o hace falta capturar de verdad la
fecha de ejecución — y eso es un cambio de captura, no de reporte.

**Relación con el #12** (exportación del expediente, art. 74): son parientes y
conviene decidirlos juntos; el 74 es el expediente completo y el 73 es el
reporte periódico que vive dentro de él.

---

## 46. Sospecha: el aviso de «tu rol cambió» puede dispararse al cambiar de sesión

**No lo vi pasar. Está aquí para que alguien lo mire, no como defecto afirmado.**

Lo encontré barriendo el patrón —estado de React que sobrevive al cambio de
sesión— después de que la marca de una organización se quedara pintada sobre la
sesión de la otra, y de que antes pasara lo mismo con las obras.

`versionRef` (src/App.jsx, junto al vigilante de `claimsVersion`) es un `useRef`.
Un `useRef` no se vacía cuando cambia el usuario: el efecto se vuelve a montar
porque depende de `usuario?.emailId`, pero `versionRef.current` sigue trayendo el
número de la sesión anterior.

El efecto usa `versionRef.current === null` para reconocer la primera lectura y
**no** avisar. Si el ref llega con el número de otro usuario, esa primera lectura
deja de parecer primera. Con que el usuario nuevo tenga un `claimsVersion` más
alto que el anterior, el vigilante lo leería como un ascenso y refrescaría el
token enseñando el aviso de que cambiaron sus permisos — a alguien a quien no le
cambió nada.

**Por qué no lo arreglé en la rama donde lo encontré.** Porque no lo reproduje.
La semilla del emulador no mueve `claimsVersion`, así que afirmarlo sería
inventar un comportamiento a partir de leer el código, que es justo lo que no se
hace. El arreglo probablemente es una línea —vaciar el ref al montar el
efecto—, pero primero hay que verlo: sembrar dos usuarios con `claimsVersion`
distintos y cambiar de sesión sin recargar.

**Si resulta cierto, es cosmético pero mentiroso**, que es la categoría que más
cuesta después: un aviso que afirma un cambio de permisos que no ocurrió enseña
a la gente a ignorar los avisos de permisos.

---

## 47. Dónde se pierde el año de la semana — barrido del 2026-10-01

Barrido pedido al abrir `feature/plazo-dependencia`, porque **las obras pueden
ser multianuales**: un contrato de noviembre a marzo cruza el cambio de año y
la semana ISO reinicia cada enero. Todo lo que ORDENA, AGRUPA o COMPARA por
semana tiene que usar el par (año, semana). Si usa el número solo, marzo se
mezcla con noviembre.

Lo que se arregló en esa rama está en su commit. Esto es lo que **queda**.

### Lo que se comprobó que está bien

- **`semanaISO`** es el algoritmo ISO 8601 correcto: toma el jueves de la
  semana y cuenta desde el 1 de enero **del año de ese jueves**. Por eso una
  fecha del 29 de diciembre cuyo jueves cae en enero sale como semana 1 del año
  siguiente, y el 1 de enero cuyo jueves cae en diciembre sale como 52 o 53 del
  anterior. **Los años de 53 semanas no se pierden** — 2026 es uno (el 1 de
  enero de 2026 es jueves).
- **`lunesDeClaveSemana`** cuenta desde el lunes de la semana que contiene el 4
  de enero, que es la definición ISO. Resuelve bien la 53.
- **`leyendaSemanaSubida`** escribe los dos años cuando la semana cruza
  («del 28 de dic de 2026 al 3 de ene de 2027»).
- **El eje de semanas de la galería de evidencia** ordena por año primero
  (`a.slice(4) + a.slice(1,3)`), no por el número.
- **`alertaId`** y el detector de «¿hay cierre oficial esta semana?» comparan
  año y semana.
- **Las claves `Y2026-S37` y `2026-W37`** se pueden ordenar como texto porque
  llevan el año delante. Las `S37-2026` **no**, y donde se usan se ordena por
  el par.

### Lo que SÍ pierde el año, y queda pendiente

**a) El gasto semanal del GP Sheet se re-sella con el año en curso.**
`src/App.jsx` (el parser del Sheet) y `functions/index.js` guardan el gasto
semanal con la clave `S${numero}`, **sin año**, y las tres series que lo
consumen le vuelven a poner `new Date().getFullYear()`. Además el parser **solo
conserva las columnas de semana del año más reciente** del Sheet: los años
anteriores sobreviven únicamente como total anual, que se aplana en una base.

Consecuencia en una obra multianual: la curva de gasto **no tiene puntos
semanales de su primer año** y pega un escalón vertical en la primera semana
del año en curso. Y si el Sheet se lee en enero, las semanas de noviembre y
diciembre del año anterior se pintan como si fueran de enero.

**Por qué no se arregló aquí:** es economía interna del contratista (P5). Una
dependencia no lee el GP, así que esto no toca la demo ni la vista de cliente.
Pero es el sitio donde el año se pierde de forma más completa, y el arreglo
tiene dos mitades: conservar las columnas de todos los años en el parser (y en
la función, que es la que escribe el documento) y dejar de re-sellar el año en
las tres series. Las dos mitades hay que hacerlas juntas.

**b) `semanasDisponibles` y `ultimaSemana` ordenan por número de semana.**
`parseInt(a.slice(1)) - parseInt(b.slice(1))`, en el cliente y en la función.
Hoy **no detona** porque el parser ya dejó un solo año en `colMap`, así que no
hay dos años que mezclar. Es latente: en el momento en que (a) se arregle
conservando varios años, esto empieza a dar «última semana = S48» en enero.
**Arreglar (a) obliga a arreglar (b) en el mismo movimiento.**

**c) El respaldo de fecha de inicio aproxima con el año actual.**
Cuando una obra no tiene `inicio` capturado, se deduce de la primera semana con
gasto del GP como «1 de enero del año actual + (semana−1)×7 días». Eso ni
respeta ISO ni el año real: en una obra que arrancó en noviembre del año
anterior, la gráfica cree que empezó en enero de este año. Mismo origen que
(a) y se cae con él.

**d) La semana de un registro de nómina no trae año.**
`semanaDeNomina` devuelve el número solo, y cuando el texto del Excel no dice
el año se usa el actual. Ya está documentado en el #28 («El año de las semanas
de nómina va escrito, no deducido»); se anota aquí para que el barrido quede
completo. En una obra multianual, un Excel de diciembre subido en enero se
archiva en el año equivocado.

### (a) y (b) se arreglan JUNTOS, nunca uno solo

**Decisión del usuario el 2026-10-02, y la razón por la que se escribe aquí en
lugar de dejarlo al criterio de quien lo toque.**

Hoy (b) no detona porque (a) ya dejó un solo año en `colMap`: no hay dos años
que mezclar, así que ordenar por número de semana da el orden correcto por
accidente. **Esa protección desaparece en el momento exacto en que se arregla
(a).** Conservar las columnas de todos los años sin tocar el orden deja
`ultimaSemana` eligiendo el número más alto, así que en enero la «última
semana» pasa a ser la S52 del año anterior y la curva de gasto se lee al
revés justo cuando se cierra el ejercicio.

Arreglar (a) sin (b) es **peor que no arreglar ninguno**: hoy el defecto es
que faltan datos —visible, la curva no tiene puntos—, y después sería que los
datos están pero ordenados al revés —invisible—. Quien toque el parser toca
también `semanasDisponibles` y `ultimaSemana`, en el cliente y en la función,
en el mismo movimiento o no lo toca.

### Lo que no se pudo auditar

**El informe semanal.** Vive en `feature/resumen-semanal`, que no está mezclada.
Hay que repetir este barrido sobre esa rama antes de mezclarla: si el informe
agrupa o compara por número de semana, una obra multianual le va a salir al
revés, y el informe es lo que se manda por correo.

**Es REQUISITO DE MEZCLA de esa rama, no una sugerencia** (decisión del
usuario, 2026-10-02). La diferencia con una pantalla: una pantalla mal
ordenada se corrige y se vuelve a mirar; **el informe sale por correo y
queda**. Un documento con el periodo equivocado ya se mandó, y si alguien lo
imprime o lo adjunta a una estimación, el año perdido viaja con él y lleva
fecha de envío.

Qué revisar en esa rama antes de mezclarla, al menos:

- Cómo arma el periodo que encabeza el correo, y si lo escribe con año.
- Si agrupa cierres por semana usando la clave con año o el número solo.
- Si compara «esta semana contra la anterior» restando números de semana: en
  la primera semana de enero eso resta contra una semana del mismo año que no
  existe, y en un año ISO de 53 se salta una.
- Si el asunto del correo lleva el año. «Resumen semana 1» no dice de cuál.

El barrido se repite **sobre esa rama**, no sobre main: el código del informe
no existe aquí, y que main esté limpio no dice nada sobre él.

## 53. Conexión en vivo con el servidor de gastos — DESPLEGADA 2026-11-02

Retira el Google Sheet GP que Luis Mayo actualizaba los domingos. **La conexión
está cerrada y desplegada; el pendiente sigue vivo por el hueco del final de
esta entrada.** El detalle se movió aquí el 2026-11-02 porque el renglón del
índice había crecido a 5,114 caracteres, y un índice de un renglón no admite
un ensayo.

### El endpoint

Llegó el 2026-10-26 (Luis Mayo, vía Oscar). Base `https://fosedy.org`.

- `POST /usuarios/login` — usuario y contraseña **en los encabezados**, no en
  el cuerpo. Devuelve un objeto `{token, idUsuario}`.
- `GET /reportes/chequesObra/1/{N}` — `Authorization: <token>` **a secas**, sin
  `Bearer`.

Dos condiciones que no se negociaron: la credencial como secreto de Cloud
Functions, nunca en el front; y **no migrar a ciegas**.

### Las tres incógnitas, medidas el 2026-10-30

1. **La ruta.** `1` es la empresa y `N` el prefijo de cuatro dígitos **como
   entero sin ceros** — 126, no 0126. `N=0` devuelve todo.
2. **El token es de un solo uso**, y además un login nuevo invalida el
   anterior: las obras se piden **en serie**. En paralelo el servidor
   contesta 500.
3. **La respuesta trae `DesProy` con el prefijo**, así que no hay que casar por
   nombre — que es justo lo que hacía frágil al parser de la hoja.

### Lo decisivo: la hoja de Luis ES esta consulta pivoteada

`DesProy` → `AgrConce` → `Nombre_Beneficiario`, sumando `ImporteDisSIva` por
`Semana` / `Mes` / `Amo`. Comprobado **al centavo** contra la hoja real: la
0127 exacta; el único hueco de la 0126, $28,357.66, son cinco renglones del 15
de octubre que la hoja nunca vio.

El agrupador es el prefijo de `DesProy`, **no `ENumProy`**. Son numeraciones
distintas: `ENumProy 0001` aparece en 21 obras y 29 de 67 valores los comparten
varias. Confundirlas asigna el gasto de una obra a otra **sin dar error**.

### Cómo quedó construido

En `fuente/gp-por-obra`: `agruparRenglonesGP` pura, con banco
`prueba-agrupador-gp.cjs` —87 aserciones, 5 contrapruebas en ROJO salida 1—
que no compara contra números míos sino contra lo que el parser de la hoja
saca de los mismos movimientos.

- Se piden **sólo las obras que CAMPO tiene**, no las 67.
- Una obra que no contesta **arrastra su cifra anterior marcada
  `desactualizadaDesde`**, porque cero es una afirmación falsa sobre el dinero.
- El dinero sin obra reconocible sale publicado en `descartes` con su importe:
  no desaparece.

**Desviación consciente de la condición de «documento aparte»:** escribe el
MISMO `global/gp_construct`, porque dos escritores del mismo número es el
defecto que el #82 acababa de pagar. Lo que sustituye a la comparación en
paralelo es el campo `fuente` dentro del documento, la hoja degradada a
respaldo que un administrador elige a mano (`refrescarGPDesdeHoja`, sólo
director o admin) y la equivalencia probada al centavo.

### La secuela: el gasto por obra cerró el alta de obra

Al pedir el gasto obra por obra, el documento pasó de 34 obras a 5 — y el
**alta de obra**, que obliga a escoger primero una obra de GP, leía esa misma
lista. La obra que falta no está en la lista porque no está en CAMPO, y no
entra a CAMPO porque no está en la lista. **Sin una sola excepción en
consola.**

Arreglo: catálogo aparte en `global/gp_catalogo` —clave, nombre y fecha del
último cheque, **cero dinero**—, job semanal los lunes a las 7:00 (una hora
antes del de gasto, porque el token es de un solo uso) y recorrido vacío que
**lanza excepción** en vez de pisar el catálogo bueno. 67 obras medidas.

### Y el defecto que sólo apareció usándolo

Verificado **dando de alta la 0128 y la 0129 en el preview**, no leyendo el
código. Con clave explícita que el documento de gasto todavía no trae,
`resolverGastoGP` y `resolverNombreCortoObra` caían a un match **difuso por
palabras** y le colgaban a la obra nueva el nombre y los $19,900,000 de la
0121: el consolidado daba −78 % en vez de −21.1 %. Una clave que no cuadra
significa «no hay dato», nunca «búscale parecido»; el difuso quedó sólo para
obras viejas sin clave. Lo cuida la sección 9 de `prueba-catalogo-gp.cjs`, con
la precondición del difuso hecha explícita para que la aserción no pueda pasar
en vacío.

### El despliegue, y lo que descubrió

Desplegado el 2026-11-02 en orden reglas → funciones (canario) → front.

- Reglas: ruleset `ad025da8`, idéntico byte por byte al archivo del repo.
- Funciones: las 20. Canario — `listarUsuarios` sin autenticar contestó HTTP
  401 con su propio mensaje, o sea que el módulo cargó.
- Front: bundle con `d2bb45d`, verificado por frases presentes y ausentes, no
  sólo por el hash.
- Catálogo en producción: 67 obras, 46,470 renglones leídos, 16 sin clave;
  campos exactamente `id,nombre,ultimoCheque` y **cero valores no-cadena**.
- `gp_construct`: `parserVersion` 4→5, `fuente cloud-function` →
  `api-gp-por-obra`, S43→S44. Las cinco obras subieron y **ninguna bajó**:
  0112 +$256,808.89 · 0114 +$2,680,090.62 · 0125 +$1,732,750.85 ·
  0126 +$2,976,901.94 · 0127 +$1,432,034.29. Descartes en cero en los tres
  conceptos.

**Lo que el despliegue descubrió, y es la lección que sobrevive al pendiente:**
todo el trabajo de gasto-por-obra estaba mezclado desde días antes pero
**nunca había llegado a producción**. `actualizarGPSheet` corrió ese mismo día
a las 17:11 todavía con el código viejo, escribiendo «34 obras, 43 semanas»
sobre `parserVersion 4`. Publicar sólo el front habría **escondido el gasto
entero**: el front v5 leyendo un documento v4 lo marca `version_vieja` y no lo
pinta.

Regla que queda: cuando `PARSER_VERSION` sube, front y funciones van **juntos
o ninguno**, y después hay que **forzar una corrida del cron** — el documento
no cambia de versión hasta que el escritor vuelva a escribir. Y no creerle al
índice sobre qué está en producción: este renglón decía que sólo faltaba el
front.

### Lo que queda vivo

- A Luis hay que pedirle dos cosas y ninguna urge: un **parámetro de
  fecha-desde** y un **token que no sea de un solo uso**.
- El catálogo se arma de los cheques, así que **sólo conoce obras que ya
  movieron dinero**. Una obra recién contratada, sin un pago, no aparece en el
  selector del alta. **Eso es lo que sigue siendo el #53 en la lista viva**, y
  aplica sólo del lado constructora; del lado gobierno **no hay catálogo** —
  ver el #41.

### El último hueco: dar de alta una obra que GP no conoce (2026-11-02)

El alta abre un estado que antes no existía: **una obra de CAMPO que el
documento del gasto no conoce**. Lo caro no era el formulario; era que una obra
así, sin veredicto, se pinta con un margen de ~98–100 % —el ingreso completo
contra un gasto de cero—, que es la cifra más convincente y más falsa del
tablero.

**No hizo falta un dato nuevo.** El documento del gasto ya traía la asimetría:
`obrasPedidas` son todas las claves que el cron **pidió**, y `obras` sólo las
que **contestaron renglones**. Entonces:

- pedida y sin renglones → **cero medido**: la obra existe en GP y no ha pagado
  nada.
- ni pedida ni contestada → **desconocido**: se dio de alta después de la
  última corrida.
- documento sin `obrasPedidas` → **desconocido**, y se dice por qué.

Los dos ceros dejan de ser el mismo número sin inventar ninguno.

`estadoGastoGP` es la única que emite el veredicto; `resolverGastoGP` quedó
como delegado puro (`estadoGastoGP(...).valor`), así que sus cinco llamadas no
cambiaron y hay **una cuenta por número**. El renglón de la tabla decide la
presentación del margen **una sola vez** en `filas.map` —texto, importe, color
y tooltip— y las dos pinturas (móvil y escritorio) sólo la consumen; el banco
lo comprueba por AST: ninguna de las dos vuelve a tocar `margenAbs`,
`margenPct`, `nivelMargen` ni `margenIndefinido`. Un margen que se deriva dos
veces es un margen que algún día discrepa consigo mismo.

**La clave se valida contra la regla del servidor, no contra una propia.**
`clavesGPdeCAMPO` (`functions/index.js`) deriva la clave de `gpId || id` y
exige `/^\d{4}$/`; con cualquier otra forma la obra cae en `sinClave` y **nunca
se le pide el gasto a GP**, en silencio y para siempre. `validarClaveGPManual`
usa esa misma expresión, y el banco lo prueba corriendo la función del servidor
—troceada del archivo por AST, con un `admin` falso— sobre los documentos que
el alta crearía. `127` **no se rellena solo**: rellenarlo decidiría de qué obra
se trata, así que se sugiere `0127` con un botón de un clic. Y una clave que sí
está en el catálogo devuelve a la lista, porque de ahí sale con su nombre y su
gasto.

Lo que la pantalla dice, y lo que calla: la obra sin medir va en **gris**, con
«— · gasto sin medir» y sin porcentaje ni importe; se ordena **al final** del
ranking por margen, porque colocarla entre las medidas ya sería afirmar algo;
aparece en Requiere atención con borde gris —un gasto sin medir no es una mala
noticia, es una noticia ausente—; y el consolidado **declara** cuántas obras le
faltan y hacia dónde miente («el margen sale alto») en vez de corregir el total
con una cifra que nadie puede conocer.

Verificado en el preview con la cuenta `gerente_construccion` —los dos únicos
roles que pueden dar de alta— recorriendo los tres veredictos (`127` → sugiere
`0127`; `0127` → «sí está en la lista»; `0777` → pasa) hasta ver la obra nueva
en el tablero. 12 contrapruebas medidas, todas en rojo con salida 1.

**Lo que el recorrido descubrió de paso:** al activar la obra, `notifARoles`
se cayó con `permission-denied` y el `catch` se lo tragó. La regla de
`usuarios` pide `esAdminDeOrg` y `gerente_construccion` no lo es, así que el
alta se consuma **sin avisarle a nadie** — justo lo que el comentario de
`src/App.jsx:8335` daba por cerrado. No se había visto porque el alta siempre
se había ejercitado con cuentas de directivo. Es el **#85**, aparte: no es de
esta clase de defecto y no entra en esta rama.

---

## 87. El renglón sí quedó, y el canal gritaba que no

**Descubierto**: 2026-11-03, en la consola, mientras se verificaba el lote de
correos. Cuatro renglones iguales:

```
fsAudit: el renglón NO quedó en la bitácora · logout already-exists — va a la cola
```

Anotado en el índice ese mismo día **sin diagnóstico**, porque el código no
cuadraba de ninguna de las dos formas conocidas: `addDoc` genera id automático,
así que no podía ser colisión de id, y una negación por reglas habría dicho
`permission-denied`.

**Lo que era.** `addDoc` no manda una escritura cualquiera: manda una escritura
**con precondición**.

```js
const mutation = parsed.toMutation(docRef._key, Precondition.exists(false));
//  @firebase/firestore, dentro de `addDoc`
```

El id lo genera el cliente —veinte caracteres al azar, nunca reusados—, de modo
que `already-exists` no puede ser el renglón de otro. Dice que **esa misma
mutación ya se escribió**: el stream de escritura la reintenta cuando se corta
sin recibir el acuse, el primer intento sí había quedado, y la precondición del
segundo rebota contra lo que dejó el primero.

Es decir, el error significaba exactamente lo contrario de lo que la pantalla
decía con él.

**Por qué importaba, dos veces.** La primera es el canal. El #75 existe para
que una bitácora que se cae no se caiga callada; un canal que grita por un
renglón que SÍ está es el #22 al revés, y es el mismo canal con el que
pensamos enterarnos de los fallos de verdad. La segunda es el expediente: tras
el grito venía `encolarRastro`, y al drenar la copia aterrizaba como un
**segundo renglón** con el mismo `ts` —el del momento del fallo, que viaja con
la fila— y otro id. Así se vio, contando la bitácora del emulador: dos `logout`
de `gerencia@fosmon.com.mx` con el sello `2026-11-03T17:31:16.543Z`. Un
duplicado en la bitácora, puesto por nosotros, en el registro cuyo valor entero
es que diga lo que pasó.

**La causa de que el reintento cayera justo al cerrar sesión.** `logout`
llamaba a `fsAudit` sin `await` y acto seguido hacía `await signOut`: la
escritura se quedaba en vuelo y la sesión se iba debajo.

**Medido, no argumentado.** La carrera se reproduce determinista contra el
emulador: la mutación se retiene en la cola local con `disableNetwork`, se lee
del cache el id que generó el cliente, **otra conexión ocupa ese id** —que es
lo que hace el primer intento cuando se pierde el acuse— y al volver la red la
nuestra sale con su precondición contra lo ya escrito. El rechazo llega con
`code: 'already-exists'` y en la bitácora hay **un** renglón. Las dos cosas
juntas son la premisa de toda la clasificación, y por eso están en §1 del
banco: el día que el SDK deje de mandar la precondición, eso es lo que se pone
rojo.

**Lo que se arregló.** Tres piezas, porque el patrón estaba repartido:

- `logout` **espera** el renglón antes de `signOut`, con tope de 3 s. El tope no
  es adorno: en obra sin señal la promesa de escritura no se resuelve, y un
  `await` pelado dejaría al usuario sin poder salir. Si vence, se cierra igual
  y la conducta vuelve a ser la de antes — que ya no miente.
- La clasificación, en los **dos** escritores de la bitácora (`fsAudit` y
  `dejarRastroDenegacion`): `already-exists` es «quedó». No grita y no encola.
- El drenado de la cola: la fila que rebota así **sale** de la cola —si se
  quedara, cada arranque escribiría el duplicado— y se cuenta en `yaEstaban`,
  **aparte** de `enviados`. Sumarla a `enviados` sería cobrarse una escritura
  que ese drenado no hizo, y el número está ahí justamente para decir qué pasó.

**Lo que no se tocó.** Los otros trece `fsAudit` siguen sin `await`, y está
bien: son mejor esfuerzo y no deben retrasar una captura. Ninguno tiene un
`signOut` detrás, que es lo que creaba la carrera.

**Verificación.** 21 comprobaciones en verde con el emulador, 8 contrapruebas
—mutando `src/App.jsx` y `src/permiso-denegado.js`— todas en rojo con salida 1.
En el preview, con los datos sembrados: un cierre de sesión dejó **un** renglón
(10 → 11), sin nada en la cola, sin error en la consola y sin colgar el botón.
El único sello duplicado que queda en el emulador es el viejo, el del defecto.

---

## `feature/resumen-semanal`: por qué se cierra sin portar

**Qué traía.** El armado del correo del lunes sacado de `functions/index.js` a
un `functions/resumen-semanal.js` propio, para poder **verlo sin mandarlo**, y
el guion `scripts/muestra-resumen-semanal.mjs`: un Firestore de sólo lectura
sobre la API REST —expone exactamente `doc().get()` y `collection().get()`, no
hay un método de escritura que llamar ni por error— que llama al mismo
`armarResumenSemanal` que corre el lunes a las 9:07 y deja el HTML en `/tmp`.
Si la muestra se aprueba, se aprueba el correo.

**Por qué no se porta.** El argumento del refactor era la garantía: que el
correo y la pantalla no pudieran discrepar. Esa garantía **ya la exige `main`
por otra vía** — `prueba-avance-sobre-contrato.cjs` y
`prueba-partidas-extraordinarias.cjs` no comparan texto ni confían en que las
dos cuentas se parezcan: extraen y **ejecutan** `calcularKpisObra` de los dos
archivos, `src/App.jsx` y `functions/index.js`, y exigen el mismo número. El
preámbulo del primero lo dice con el nombre del defecto que lo creó: *el correo
y la pantalla daban números distintos*. Lo que la rama añadiría es que haya
**una** copia en vez de dos pinchadas; eso es mejor diseño, no más garantía.

Contra eso: 252 commits de divergencia y +11,777/−2,410 renglones en esos
mismos dos archivos. No es un rebase, es una reescritura con el riesgo puesto
sobre el único correo que hoy sale solo y bien (salió el 2026-11-02 con su
`resendId`). Se reescribe el día que se vaya a tocar el armado por otra razón.

**Lo rescatado.** `scripts/fecha-falsa.cjs`, que fija `new Date()` y
`Date.now()` con `--require` y contesta «¿es una regresión o es el calendario?»
—así se encontró el #29—. Se comprobó primero que no duplicara a
`scripts/reloj.cjs`: no se pisan, una fija el **instante** y la otra la **zona**,
y están aparte a propósito. Como ningún banco de la suite la carga —se usa a
mano—, el rescate venía con la muerte callada de #65 incorporada: si deja de
parchear, el banco corre con el hoy de verdad, da **verde**, y el verde se lee
como «en ese día del calendario no falla». De ahí
`prueba-fecha-falsa-sigue-fijando-el-hoy.cjs`: carga la herramienta en un
proceso aparte y le pregunta al `Date` de ese proceso, incluidas las dos
promesas negativas de su cabecera —los argumentos pasan intactos, la zona no se
toca—, que son las que se rompen sin ruido. 8 comprobaciones, 6 mutaciones y
las 6 vistas en ROJO 1.

**Lo NO rescatado, y por qué.** `muestra-resumen-semanal.mjs` importa
`functions/resumen-semanal.js`, que sólo existe en la rama. Corrido contra
`main` muere en el `import`, antes incluso de pedir el `TOKEN`:
`ERR_MODULE_NOT_FOUND`. Committearlo sería dejar un cadáver en el árbol —
exactamente el defecto de #65 que acabamos de poner bajo vigilancia — y
resucitarlo es portar el refactor, que es lo que se decidió no hacer. Queda en
`feature/resumen-semanal`, que **no se borra ni se rebasa**.

## #86 · `cotea.com.mx`: los pasos de fuera, en orden

**Al 2026-11-03 por la tarde, los pasos 1 a 5 y el 8 están HECHOS y verificados
desde fuera.** Quedan el 4 (Resend), el 6 (funciones), el 7 (front) y el 9. Lo
que se aprendió haciéndolos está al final, en «Lo que no estaba en el plan».

El repositorio ya dice `cotea.com.mx` en los cuatro sitios y la suite está
verde. **Nada de lo que queda lo hago yo sin un OK explícito**: son DNS,
consolas de terceros y escrituras a producción.

El orden importa, y el principio que lo ordena es **que en ningún instante se
rompa nada**: todo lo de fuera es **aditivo**. El origen viejo sigue sirviendo,
sigue en el CORS y sigue siendo dominio autorizado hasta que se decida —
aparte — retirarlo.

1. **DNS de `cotea.com.mx`.** Hoy el dominio contesta el lander del registrador
   (medido el 2026-11-03: HTTP 200, 114 bytes, un `location.href="/lander"`).
   Apuntarlo a Netlify: el ápice pide ALIAS/ANAME, o pasar la zona a Netlify
   DNS. `www` como CNAME.
2. **Netlify: dominio personalizado + certificado.** Añadirlo al sitio que ya
   existe; no crear un sitio nuevo, porque un sitio nuevo es otro build y otro
   origen que nadie está midiendo.
3. **Firebase Auth: `cotea.com.mx` como dominio autorizado.** Va **antes** de
   que el origen nuevo sirva la app. Si la app se sirve desde un origen que
   Auth no autoriza, el `signInWithEmailAndPassword` falla y nadie entra. Se
   **añade**; `campo-fosmon.netlify.app` se queda.
4. **Resend: verificar `cotea.com.mx`** (SPF y DKIM en el DNS, y esperar a que
   el tablero diga verificado). **Esto va antes de desplegar las funciones y no
   se puede saltar:** con el dominio sin verificar, Resend contesta 403 al
   `FROM_EMAIL` nuevo y el correo del lunes no sale. No sale en silencio —el
   `catch` lo registra en salud y relanza, así que Scheduler lo cuenta rojo—,
   pero no sale.
5. **CORS de Storage** (`gsutil cors set storage.cors.json gs://…`).
   **Escritura a producción: pide OK.** El archivo ya suma los dos orígenes.
6. **Desplegar funciones, por nombre y con canario**, no en bloque. **Pide OK.**
7. **Empujar el front.** **Pide OK.**
8. **En el repo, en el mismo paso que el 2:** cambiar el `SITIO` por omisión de
   `scripts/verificar-despliegue.cjs` a `https://cotea.com.mx`, y la línea de
   «URL producción» de `CAMPO_CONTEXTO.md` y `docs/CAMPO_BRIEF.md`. Hoy esos
   tres dicen la verdad; el día 2 dejan de decirla.
9. **Verificar:** `node scripts/verificar-despliegue.cjs` con los cuatro
   canales, y el correo del lunes siguiente.

**Lo que NO se hace todavía, y es una decisión, no un olvido:** redirigir
`campo-fosmon.netlify.app` al origen nuevo con un 301. Un redirect saca a la
PWA instalada de su origen, y con el origen se va su service worker, su caché y
su estado local; además el ícono de la app instalada se fija al instalar (#37).
Quien la tenga en la pantalla de inicio tendría que borrarla y volver a
agregarla **sin haberlo pedido**. Los dos orígenes conviven hasta que se decida
el retiro con un aviso de por medio.

### Lo que no estaba en el plan (2026-11-03)

**El orden 1↔2 estaba al revés.** Netlify es quien dice qué registro crear, y
añadir el dominio ahí no rompe nada: se queda en «Awaiting External DNS». Si se
empieza por el DNS se adivina la IP. Primero Netlify, se leen los valores, luego
GoDaddy.

**La zona tenía correo vivo, y eso prohibió el camino fácil.** `cotea.com.mx`
tiene MX de GoDaddy, `v=spf1 include:secureserver.net -all`, DMARC
`p=quarantine` y **dos DKIM** (`secureserver1._domainkey`,
`secureserver2._domainkey`). Por eso **no** se pasó la zona a Netlify DNS: habría
que recrear todo eso a mano. Se quedó en GoDaddy con el `A` del balanceador.
También por eso el SPF de Resend va en `send.cotea.com.mx` y nunca en el ápice:
dos SPF en el mismo nombre dan `permerror` y tumban el correo que ya funciona.

**El `A` del ápice era uno, no dos, y su valor era la palabra `Parked`.** Las dos
IPs que se ven por `dig` las pone el servicio de GoDaddy detrás de ese registro.
Editarlo es lo que desactiva el park page; no hay nada que borrar. Y el
*Forwarding* estaba en «Not set up», así que la trampa de que GoDaddy reescriba
el registro no aplicaba aquí.

**El primer «Provision certificate» falló y no era un defecto.** Netlify pide el
certificado para el ápice **y** `www` a la vez. El `CNAME www` viejo se publicaba
con TTL de 3600, así que el resolvedor de Netlify tenía cacheado el valor que
apuntaba al parking. Se descartó una por una: CAA vacío en `cotea.com.mx`,
`com.mx` y la raíz; DNSSEC apagado (ni `DS` ni `DNSKEY`); `/.well-known/acme-challenge/`
alcanzable en los dos nombres; sin `AAAA` huérfano. **Netlify reintentó solo al
expirar la caché.** La lección: con el certificado fallando, medir antes de
reintentar, y bajar el TTL **antes** de mover un registro, no después.

**La cuenta de Resend no era la que parecía.** Al entrar a `resend.com` no
aparecía `fosmon.com.mx`, porque era una cuenta recién creada. La clave de
producción es de **envío restringido** (`restricted_api_key`), así que
`GET /domains` contesta 401 y no sirve para identificar la cuenta. Se identificó
por otras dos vías de sólo lectura: el DNS de `fosmon.com.mx` tiene los tres
registros de Resend (DKIM en `resend._domainkey`, `send` con
`include:amazonses.com` y MX `feedback-smtp.us-east-1.amazonses.com`, o sea
región **us-east-1**), y el registro de auditoría de Secret Manager dice que
`ofosado@gmail.com` creó `RESEND_API_KEY` el 2026-06-01 a las 23:22. **La
verificación de dominios en Resend es por cuenta:** verificar `cotea.com.mx` en
la cuenta equivocada habría dado 403 igual, y peor — el DKIM de esa cuenta
ocuparía `resend._domainkey.cotea.com.mx`, que sólo admite un valor, dejando a la
cuenta de producción sin poder verificarlo.

**El hueco que abrió el propio despliegue.** El dominio empezó a servir antes de
que el CORS del bucket lo permitiera, así que durante un rato la app se veía
entera y las fotos de evidencia salían en blanco, sin error. Es el orden del plan
el que lo permitió: el paso 5 iba después del 2. **Si se repite con otro dominio,
el CORS va antes de que el nombre nuevo sirva.**


---

## 15. «Esta semana» era una suposición, no una lectura — CERRADO 2026-11-16

El recuadro del delta rotulaba **«Esta semana»** cualquier cosa que estuviera al
final de la serie de cierres, y la tarjeta de al lado —«Partidas con mayor
avance»— decía **«esta semana vs anterior»** sobre los mismos dos puntos. Las dos
frases dan por supuestas dos cosas que nadie comprueba: que el último cierre es
de la semana en curso, y que el anterior es el de la semana de antes.

**Medido en producción (2026-11-16), y la medición cambió el arreglo.** Esperaba
capturas tardías en lote; no hay ninguna: todos los cierres entran dentro de su
plazo del sábado a las 2 p.m. Lo que sí hay son **huecos**. La 0112 salta de la
S34 a la S39 y de la S40 a la S44; la 0114 salta de la S24 a la S37. Así que en
la 0112 el delta publicado bajo «Esta semana» abarcaba **cuatro semanas**, y el
cierre que lo producía tenía ya **tres semanas** de viejo. Un director que lee
+2.03pp «esta semana» concluye que la obra avanza a 2 pp por semana; la obra
avanza a 0.5.

**Lo que ahora dice la pantalla.** El rótulo se deriva: «Último cierre» si no es
de la semana en curso, «Esta semana» si lo es. El subtítulo nombra el tramo
cuando abarca más de una semana y el rezago cuando lo hay — «vs S40 · 4 semanas,
no una · 3 semanas sin cerrar». La leyenda de las partidas sale de la **misma**
`subDelDelta`, así que la tarjeta y el recuadro no pueden discrepar.

**Y la ventana del ritmo deja de ser ambigua.** `proy.tramos` se expuso el
2026-11-07 justamente para que las pantallas pudieran decir en cuántas semanas
de calendario caben sus cierres, y **ninguna lo consumía**. «Velocidad prom.» y
«Proyección fin» ahora publican los dos «los últimos 4 cierres (10 semanas)»
desde una sola función: sin el tramo, el lector divide entre cuatro en vez de
entre diez y se equivoca por dos y medio, hacia el lado cómodo.

`semanasEntreClaves` cuenta por **lunes de calendario**, no restando números de
semana: 2026 es un año ISO de 53 semanas y restar números se equivoca una entera
al cruzarlo. El banco lo afirma con S52-2026 → S01-2027.

Banco: `scripts/prueba-la-obra-avanzo-o-el-residente-se-puso-al-corriente.cjs`,
33 comprobaciones, contraprueba de 5 mutaciones con 24 en rojo y ninguna muda.
Verificado en el preview contra el emulador: «ÚLTIMO CIERRE +1.33pp · vs S44 ·
2 semanas sin cerrar» y «S45 vs S44 · 2 semanas sin cerrar» en la tarjeta.

## Archivadas el 2026-11-16 — 124 filas cerradas que vivían en `PENDIENTES.md`

La lista viva llegó a **312 KB, de los cuales 259 KB eran trabajo ya terminado**:
de 177 filas, **124 ya estaban cerradas** y seguían mezcladas con las 53 que de
verdad piden algo. Un índice en el que dos de cada tres renglones ya no piden nada
no es un índice: es un archivo que estorba para encontrar lo que falta.

**Nada se borró — se movió.** El texto de cada fila está completo aquí abajo, tal cual,
y el historial de git conserva dónde estaba. Se retiró además **una fila duplicada**,
el `#42` («cotea no tiene eslogan»), cuyo gemelo cerrado dice que el eslogan se decidió
el 2026-10-26: una fila que pide lo que ya se hizo manda a trabajo inexistente.


### Venían de «1 · Destruye datos, y no hay vuelta atrás»

| # | Tema | Estado |
|---|---|---|
| 80 | **La pantalla de nómina escribía en el formato viejo cuando no sabía el formato**, y el formato viejo guarda el arreglo ENTERO de un golpe: con el historial todavía vacío, la carga no añadía una semana, reemplazaba el documento. Así se perdió la S42 de la 0126 el 2026-10-23, y como `avisarSiFaltanSemanas` lanza desde entonces en cada lectura, la siguiente carga volvía a caer en el mismo sitio: el fallo se alimentaba solo. El estado arranca ahora en `FORMATO_HISTORIAL_DESCONOCIDO` y `escribirHistorialNomina` se niega a escribir sin saberlo. Verificado en el preview contra el emulador con el estado exacto de la 0126: tres cargas, cero escrituras, los dos documentos en su `updateTime` sembrado. | CERRADO |
| 81 | **La Semana 42 de la 0126 estuvo un mes fuera de pantalla** — escrita en `obras/0126/nomina/historial` y ausente de la subcolección, que es de donde esa obra lee: 132 trabajadores y $679,126.67 invisibles desde el 2026-10-23. Reparada en producción el 2026-10-27 con `scripts/reparar-nomina-0126-s42.cjs`, con OK de Oscar y volcado previo (1.36 MB) a `~/Desarrollo/CAMPO-datos-produccion`. Ensayada antes contra el emulador sembrado con ese mismo volcado: la pantalla pasó de lanzar el aviso a mostrar «Semana 42 · 2 partes · 132 trabajadores · $679,127». El guion crea con `currentDocument.exists=false` (no pisa: el servidor devuelve 409), copia los valores crudos sin pasarlos por JavaScript, y no toca el documento viejo. | CERRADO |
| 21 | **Cambiar de modo reinterpreta dinero ya capturado, y la mitad del subcontrato seguía abierta.** La obra madre quedó cubierta en su momento (bloqueo duro, confirmación con cifras y asiento propio); el interruptor del subcontrato, en la pantalla de al lado, seguía siendo `onUpdate({modoAvance: v})` —un clic, sin diagnóstico, sin confirmación y sin bitácora—, que es exactamente lo que el comentario de `pedirCambioModo` había predicho: el corte que vive en el manejador del clic es el que se salta la siguiente pantalla. Ahora los dos pasan por el MISMO diagnóstico y el MISMO diálogo, con los sustantivos como dato (partidas / conceptos), porque copiar cien renglones de JSX con cifras adentro es el defecto que se está arreglando. El diagnóstico aprendió la otra forma de la cantidad (`cant ?? cantidad`): sin eso habría bloqueado para siempre a todo subcontrato con sus volúmenes completos, y un bloqueo que miente enseña a desconfiar del verdadero. El banco deja de teclear la forma del clic ya arreglado y los **busca**: encuentra dos y le exige a cada uno que llegue al diagnóstico. Sobre `main` sale ROJO. | CERRADO |
| 22 | **`fsSet`/`fsDel`/`fsSetA` se tragaban cualquier fallo**: una escritura rechazada por reglas se veía exactamente igual que una exitosa. Cerrado el 2026-10-26 con un canal central (`avisarEscrituraPerdida`): el helper devuelve `false` en vez de `undefined`, deja la ruta ya prefijada y el código en el canal, y una franja `role="alert"` dice «Un cambio NO se guardó». Las dos afirmaciones de éxito que mentían (estimaciones y contrato) ahora están condicionadas al `true`. Medido en el preview contra el emulador con las reglas reales: con reglas que niegan sale la franja con `orgs/coatzacoalcos/obras/OP-2026-001 · permission-denied` y no sale «Guardado»; con las reglas reales sale «Guardado» y la franja no aparece. Banco nuevo `prueba-escritura-que-no-miente.cjs`, 26 aserciones, 10 mutaciones todas en rojo. | CERRADO |

### Venían de «2 · El expediente afirma algo falso»

| # | Tema | Estado |
|---|---|---|
| 148 | **El guion de la contraseña perdía teclas y le echaba la culpa a quien la teclea.** Pedía la contraseña dos veces con un `fs.createReadStream` por prompt y creía apagarle el modo crudo con `entrada.setRawMode(...)` — método que un `fs.ReadStream` **no tiene**: es de `tty.ReadStream`. Así que el stream del primer prompt quedaba vivo con una lectura en vuelo sobre la terminal y **se comía teclas del segundo**; medido en un pseudo-terminal con tecleo a 150 ms: `abc` las dos veces, la segunda llegaba como **`b`**. El guion entonces decía «las dos no coinciden» y mandaba a repetirlo, y repetirlo fallaba otra vez. **Segundo defecto en el mismo renglón:** el eco nunca se apagaba, de modo que la PRIMERA contraseña salía en pantalla mientras el guion prometía «no se ve al escribir». Salió a la cara el 2026-11-16, con las tres cuentas de demo esperando contraseña. Arreglado con lectura **síncrona** (`fs.readSync` byte a byte, fd cerrado en el `finally` del mismo prompt que lo abrió) y el eco apagado por un `tty.ReadStream` que nunca se resume, más borrado consciente de UTF-8 (una `ñ` ocupa dos bytes; quitar uno dejaba media). Banco nuevo `prueba-la-contrasena-que-se-teclea.cjs`: levanta un pseudo-terminal con `expect`, **teclea de verdad** y afirma cuatro cosas —lo mismo dos veces llega igual, borrar quita un carácter entero, un carácter de dos bytes llega entero, y nada de lo tecleado aparece en pantalla—. El lector se extrae del guion con `fuenteDe` y se ejecuta, no se copia. Contraprueba contra el lector anterior: **4 de 4 en rojo**. Sin `expect` es NO ARRANCÓ, no verde. El patrón se buscó en todo el repo: no había otro `setRawMode` ni otro `createReadStream`. | CERRADO |
| 145 | **El residente —a quien la ley le encarga rendir— no podía avisarle a nadie, y a la vez podía firmar una constancia falsa.** `usuarios` sólo la listan los admin de la org, así que el reparto del cierre semanal, hecho en el cliente, no encontraba destinatarios; y la constancia de `avance/rendiciones` la escribía el mismo cliente, o sea que podía nombrar gente que nunca se enteró. Las dos mitades se cerraron moviendo el reparto a la callable **`rendirCierreSemanal`** (`QUIEN_CIERRA` / `QUIEN_SE_ENTERA` por tipo de org, el que cierra excluido) y dejando la constancia **`allow write: if false`**. Banco `prueba-a-quien-se-le-rinde-la-semana.cjs`: 49 mutaciones, todas en ROJO. **El recorrido por el emulador encontró lo que el banco no:** la ruta de la obra estaba tecleada bajo `orgs/`, así que la función estaba **muerta para toda constructora** —`not-found`, pantalla diciendo «el aviso no salió»— y el banco salía verde porque se había inventado la asimetría al revés; hoy se la pregunta a `rutaObrasDeOrg` y hay una mutación por cada lado del error. Desplegado el 2026-11-16: función 15:58Z, ruleset `9f91d464` 15:59Z, paquete `index-ccdd9437.js`. **Falta la primera constancia real**, que sólo la puede dejar una persona cerrando una semana: para eso la org de demo tenía que tener organigrama y no lo tenía —un único usuario es su propio único destinatario—, así que `scripts/alta-supervisor-demo.cjs` dio de alta a `supervisor@cotea.com.mx` (`supervisor_obra`, obra `0128`) con los claims **calculados** por las tablas de producción, no tecleados. **VERIFICADO EN PRODUCCIÓN el 2026-11-16, con una persona cerrando de verdad.** Las tres cuentas recibieron contraseña —tecleadas por el usuario, no por un guion— y el supervisor cerró la **S47-2026** en la 0128. `scripts/medir-la-primera-constancia.cjs` (sólo lectura): **7 de 7 en verde**. Lo que afirma no es que la constancia exista —una que nombre a quien no se enteró es peor que ninguna, porque es una afirmación falsa en un expediente de cinco años— sino la **igualdad de dos conjuntos construidos por caminos distintos**: a quién dice el acta que se le rindió (`orlando@cotea.com.mx`) y quién tiene de verdad el aviso en su campanita, preguntándole a la de CADA usuario de la org y no sólo a los nombrados, para que un aviso de más también se vea. Coinciden. Además: quien cerró no se avisó a sí mismo, el aviso enlaza a la 0128, y el `capturadoPor` del historial coincide con el `porQuien` de la constancia —dos escrituras distintas, la app y la callable, atribuyendo el acto a la misma persona—. De paso, la medición se equivocó primero y su rojo era falso: leyó `avance/historial.semanas` como mapa cuando es un **arreglo** de cierres con `id`, y declaró ausente una semana que estaba; misma clase de error que la curva del informe. Corregida, y ahora NO ARRANCA si la forma cambia, en vez de dar un rojo mentiroso. | CERRADO |
| 143 | **Una obra nueva nace sin migrar, y la galería acusa de «de archivo, sin autor» a la foto que se acaba de tomar.** La bandera `obras/{id}/config/evidencia.migrada` se escribe en **un solo sitio de todo el repo** —`scripts/migrar-evidencia-subcoleccion.cjs:573`, al terminar de migrar una obra que ya existía—; el alta no la escribe nunca, así que toda obra dada de alta de hoy en adelante arranca en el camino viejo. Medido en el emulador el 2026-11-14 recorriendo el #69: di de alta `OB-2026-TMFOU0` desde la pantalla y subí una foto como `oscar@cotea.com.mx` —director de obras, con nombre y sesión—; quedó en el mapa incrustado de `avance/subs` con exactamente tres campos (`fecha`, `id`, `url`), `config/evidencia` contesta 404 y la subcolección `evidencia` está vacía. La pantalla la rotula **«de archivo»**, cuya glosa dice *«Subida antes de que la app registrara autor. No se puede saber quién la tomó»*, y la cabecera cuenta «1 foto en 1 partida (1 de archivo, sin autor)». Las dos frases son falsas: la app sí registra autor hoy, y para esta obra decidió no hacerlo. Llega al papel del cliente — la sección 5 del PDF le dirá a un director de Obras Públicas que su expediente recién abierto no tiene una sola foto acreditable. Y de paso vuelven los tres defectos que la migración cerró: el peso del documento (#30), la `×` dejando huérfanos en Storage, y el token de descarga replicado dentro de la obra. **ALTO**: la pantalla afirma algo sobre el dato. **CÓDIGO HECHO el 2026-11-14** (`ea01e14`): el alta escribe `config/evidencia` con `migrada: true` ANTES del documento de la obra y aborta si rebota; las reglas conceden un `create` único —sólo `migrada == true`, y sólo mientras la obra no exista, que es lo que impide encenderle la bandera a una obra vieja y dejar sus fotos del mapa fuera de la galería—. Lo afirma `scripts/prueba-la-obra-nace-con-su-expediente.cjs`, que ejecuta el alta y mete lo que escribió en el lector de verdad para preguntarle por el rótulo (10 mutaciones, 10 en rojo). **DESPLEGADO el 2026-11-15, reglas y después front**, con OK expreso. El orden no era ceremonia y se vio en vivo: en el emulador con la regla vieja puesta el alta de 0127 **rebotó** —modal abierto, obra no creada, `ESCRITURA PERDIDA · obras/0127/config/evidencia · permission-denied`—, y con `firestore.rules` del repo cargado el mismo botón pasó limpio y la foto salió **«✓ verificada»** con `origen: captura_en_vivo`, autor y `subidaEn` del servidor. Reglas: ruleset `7aebb2a1` → **`05e30cb2`**, releído por la API byte a byte; el delta eran los dos bloques de `config/evidencia` y **ningún `match /` entró ni salió**, o sea que sólo podía abrir esa puerta. Front: `058d7ba..564d3d5` (64 commits), bundle vivo `assets/index-70fe6308.js`, SHA256 idéntico al del build local. ⚠️ **Las obras ya creadas sin bandera no las arregla esto**: hay que pasarles la migración. | CERRADO |
| 100 | **El KPI de gasto de la pantalla de obra publica `$0 · 0% del contrato` cuando el gasto NO se midió.** Medido el 2026-11-05 en el preview sobre la 0129, cuya clave está capturada y no está en la corrida: la tarjeta de la lista, un clic antes, dice «sin medir» en cursiva y apaga el color —cuelga de `presentacionEconomiaObra`, del #88 (la tarjeta que volvió)—, pero el KPI de la obra imprimía `MXN(gt)` y un porcentaje sin preguntar por `gastoGPMedido`. Es la misma obra, el mismo número y dos respuestas a dos clics; y el `0%` afirma, además, que no se ha gastado nada del contrato. **Hecho el 2026-11-05, y el KPI era lo de menos:** el veredicto se quedaba en el KPI y a la pantalla salía la cifra sola en **cuatro** sitios más. `serieGastoDeSemanas` devuelve ahora `medido`, y sin él la serie sale en `null` por semana en vez de plana en cero —una serie de ceros afirma «esta obra no ha gastado nada» y el margen que se resta contra ella es el ingreso entero, o sea el número más alto del tablero en la obra de la que menos se sabe—. De ahí cuelgan las tendencias (la tabla dice «sin medir», el pie del panel dice por qué no hay ni gasto ni margen), la proyección (sin ritmo, sin gasto a hoy, sin margen al cierre, sin fecha de fin por gasto) y la tarjeta de Margen bruto, que trae insignia **SIN VEREDICTO**. **El PDF era la pieza grave y no estaba en el renglón original:** era la **cuarta** copia de «¿qué obra del GP es ésta?» —la quinta contando el agrupador— y la peor, porque cruzaba por **parecido de nombre aun con la clave capturada**, así que el reporte que se ENTREGA le colgaba a la 0129 los $19.9M de la 0121. Ahora pregunta por `estadoGastoGP`, y sin gasto medido no imprime margen ni porcentaje, no pinta la fila de color —el color de ese renglón **es** el veredicto—, no dibuja la línea roja del gasto ni su proyección punteada, lo dice en la leyenda en vez de dejar un hueco que se lee como fallo de dibujo, y los dos indicadores de riesgo que se calculan con el gasto salen sin nivel: clasificarlos daría «Bien» por el camino más corto. La observación de «no se pudo medir el margen» va **antes** que los umbrales, porque el silencio en una sección de alertas se lee como que no hay nada que ver. Banco `prueba-el-numero-con-su-calificativo.cjs`: 8 secciones, **27 mutaciones en ROJO**, una de ellas el match difuso restaurado tal cual estaba. Afirma las **cadenas entregadas**, no el código: un jsPDF de mentira graba cada `doc.text` y cada celda de `autoTable` con los estilos que le pone su propio `didParseCell`. Dos guardas redundantes se **quitaron**, no se taparon: la guarda vive donde se decide el significado —el renglón que distingue «no hay fechas» de «no hay gasto»—, y mientras estaba dos veces la mutación sobrevivía. El banco salió **0 en silencio** a mitad de camino una vez, que es el peor modo de fallo posible; lleva ahora una red de `process.on('exit')` que convierte eso en NO ARRANCÓ. **Tres bancos ajenos salieron rojos y ninguno por el andamiaje:** daban por hecho que `gpData: null` significa «el gasto es cero», y significa «no hay corrida», o sea sin medir; sus escenarios dicen ahora que GP contestó y contestó cero. Uno de ellos doblaba `resolverGastoGP: () => 0`, o sea doblaba una **cuenta**, y el cero que devolvía ya no traía consigo el veredicto: la prueba creía mirar un gasto medido mientras el archivo decía sin medir. | CERRADO |
| 101 | **El signo del dinero lo lleva el color, y una columna lo necesita escrito.** `MXN` era `Math.abs(n)` para todo el repositorio y quien quería el menos lo anteponía a mano (así lo hacía `presentacionEconomiaObra`). La columna **Margen** de la tabla por semanas no lo hacía: el 2026-11-05, en la 0121, la última fila decía `$9,652,920` en rojo donde el margen es **−$9,652,920**, y el KPI de arriba, en la misma pantalla, sí imprimía `-$8,612,920` con su signo. Un rojo no se lee como un menos cuando al lado hay cifras positivas también en rojo por otro motivo. **Hecho el 2026-11-05 en el formateador, no en los llamadores:** `MXN` se queda siendo la **magnitud** —hay sitios donde el signo lo lleva la etiqueta y repetirlo diría «−» dos veces— y se le suman dos hermanas, `MXNS` (signo sólo si es negativo) y `MXND` (`+`/`−` para un delta, donde el más también informa). La regla que quedó escrita junto a las tres es **nunca `MXN(Math.abs(x))`**: quien escribe eso está pidiendo `MXNS` y tapando el signo. Se convirtieron 14 llamadas de signo y se le quitó el `Math.abs` redundante a 3 de magnitud. El barrido de los `fmt:MXN` sobre series negativas se hizo y de ahí salió la columna Margen. **Y vivía también dentro del PDF, con su causa a la vista:** `generarPDFObra` tenía su propia copia local de `MXN`, idéntica en salida —comprobado caso por caso, incluido `NaN` y el redondeo de 0.5— cuyo único efecto era **tapar** a `MXNS` y `MXND`, así que ahí dentro el menos había que teclearlo; y se teclearon mal: el margen de la 0121 se entregaba como `$8,612,920` en el documento donde la pantalla dice `−$8,612,920`. Borrada la copia, el signo se decide en un solo sitio. Canario en el banco del #100. | CERRADO |
| 103 | **Dos números distintos con el mismo nombre, y el mismo número con dos cuentas: cinco veces en `src/App.jsx`.** No son cinco defectos sueltos sino una clase, y se arregló entera antes de rehacer las gráficas, porque cuatro de las cinco caen dentro de los bloques que se iban a rehacer y rediseñar encima habría heredado la ambigüedad en código nuevo. **(1)** Dos importes del tablero se llamaban los dos «por estimar»: `$9,484,113` (obra ejecutada sin facturar) y `$23,289,778` (el contrato sin facturar) — ahora «POR ESTIMAR (COBRAR)» y «Semanas p/ facturar todo · del contrato sin facturar». **(2)** El #8: `me` (ejecutado **+ almacén**) y `am` (obra ejecutada, **sin** almacén) se rotulaban ambos «Monto ejecutado»; quedaron «Ejecutado + almacén» y «Obra ejecutada», y las dos cuentas siguen siendo dos — unificarlas mediría el margen contra el almacén. **(3) y (4)** El plazo se resolvía tres veces, y dos de las tres leían `obra.fin` en vez del fin vigente: una obra con `finAmpliado` se medía contra el plazo del contrato **ya vencido**. Nace `plazoDeObra`, única, y el tablero y la tarjeta de la dependencia la desestructuran. Devuelve `null` —no `0`— cuando falta una fecha: un `0%` afirma que la obra acaba de arrancar. **(5)** De las cuatro sumas de maquinaria del archivo **sólo la del PDF filtraba** por descripción, y filtrar por descripción tira el renglón sin describir: en el escenario del banco el papel que se entrega publicaba **$1,480,000** de margen donde la pantalla dice **$280,000**. Tres contra uno; manda el tablero, y se filtra por importe. Banco nuevo `prueba-dos-numeros-con-el-mismo-nombre.cjs`: 10 secciones, **11 mutaciones en ROJO**, e incluye un detector de rótulos que publican dos cifras — reescrito dos veces porque la primera versión gritaba once veces y **un detector que grita once veces no se lee, y no se habría leído el que importaba**. El taller que ejecuta componentes salió a `scripts/taller-de-app.cjs` en vez de copiarse: copiarlo habría sido hacer en las pruebas justo lo que esta rama corrige. Verificado en el preview con datos sembrados, incluida una ampliación puesta en el emulador: `68 de 275 días` contra el ampliado donde antes decía `179`. | CERRADO |
| 88 | **La tarjeta de la obra desapareció sin que nadie lo acordara, y al devolverla pintaba un margen inflado.** Esconder las tarjetas a los roles con tabla entró de polizón el 2026-10-11 en `7dc9bca`, un commit cuyo mensaje habla **sólo** de ordenamiento; el comentario que lo justificaba invocaba una «instrucción expresa» que no existe. El argumento —que la segunda mitad de la pantalla repetía la primera— sólo vale con cartera grande: a quien tiene **una** obra le borraba media pantalla y no le ahorraba nada, y la tabla no trae columna de **Contrato**, que la tarjeta sí, mientras el subtítulo del panel promete «Contrato, avance y pendientes de captura». Devolverlas sin más habría enseñado una cifra inventada: la fila aprendió a callarse cuando GP no midió el gasto —dice «gasto sin medir» y apaga el color—, pero la tarjeta nunca preguntó por `gastoGPMedido` y pintaba un margen con ese sumando en cero, con su semáforo al lado. Las dos cuelgan ahora de **`presentacionEconomiaObra`**, una sola traducción de KPIs a pantalla, y la tarjeta usa `calcularKPIsObra` en vez de recalcular por su cuenta: es «una cuenta por número» aplicada a la **presentación**, no sólo a la cifra. El banco `prueba-navegacion-por-atraso.cjs` codificaba la premisa falsa y se invirtió: ahora afirma **por ausencia** —cero menciones vivas de `veListaDeTarjetas`—, porque una función que devolviera `true` para todos pasaría igual y dejaría el cerrojo puesto. Tres contrapruebas en ROJO (2, **11** y 3 fallos). Suite 78/78. Visto en el preview con el auditor de **una sola obra**, que es el caso que motivó el reporte. **Arriba el 2026-11-04**, front `71f5aa1`. | CERRADO 2026-11-04 |
| 66 | **Migrar una obra convertía la captura del directivo en un rebote — en el camino de DEPENDENCIA.** El `create` de `evidencia` colgaba `&& obraId in obrasAsignadas()` de las tres ramas del `or`, y `backfill-claims.cjs` acuña a `director_obras`/`subdirector`/`jefe_supervision` con `obras: []` siempre: la rama del directivo era inalcanzable por construcción. Desplegado el 2026-10-22 y medido contra el ruleset publicado (7 casos, con contraprueba que vuelve a ponerlo en rojo). **Corrección al reporte inicial: NO estaba mordiendo en producción.** Yo dije «las cuatro obras migradas» dando por hecho que eran de dependencia; medido después, las cuatro migradas (0112, 0114, 0126, 0127) son de **constructora**, que usa `puedeEditarObraC` y nunca tuvo el defecto. Producción no tiene hoy ningún usuario de dependencia. Era defecto latente, y habría mordido el día de la demo a COTEA. | CERRADO |
| 73 | **`auditoria` no tenía frontera entre organizaciones, y dentro va la economía del contratista.** Vivía en la RAÍZ con `allow read: if esDirectivoC() \|\| esDirectivoD()`; ninguno de los dos ayudantes mira `orgId()`, y la regla no miraba el documento. Medido con el motor contra el ruleset PUBLICADO `1b223bc0` (`scripts/medir-auditoria-entre-inquilinos.cjs`): **4 de 4 lecturas cruzadas salieron ALLOW**, en los dos sentidos. Alcance: **4200 filas** (2026-05-23 → 2026-10-22), **2212 con claves de dinero** en `antes`/`despues` (`monto` 1689, `pu` 201, `pctRetencion`/`pctAnticipo` 54, `importeContrato`, `totalNomina` 248). **Ninguna fila trae `orgId`**: no había campo por el que acotar, y eso decidió el arreglo —un campo mal puesto filtra, una ruta mal puesta no existe—. **La colección se PARTIÓ por ruta**: la raíz es de la constructora (`read: esDirectivoC()`), cada dependencia tiene la suya en `/orgs/{oid}/auditoria` (`read: oid == orgId() && esDirectivoD()`), ambas `update, delete: if false`. El `create` se deja ancho a propósito: si pidiera la obra, a quien se le niega por no tenerla tampoco podría dejar constancia de que se le negó. Medido también **el auditor: `esDirectivoC()` NO lo incluye** —ni a `cliente`—, los dos DENY; esa segunda sospecha no se materializó. Desplegado el 2026-10-23, ruleset **`ebd4f8bb`**, re-medido contra él: **17 de 17 verde**; los mismos casos contra `1b223bc0`, en rojo. Banco de emulador `prueba-frontera-de-la-bitacora.cjs`: 20 aserciones, contraprueba de 4 mutaciones, las 4 vistas. Flanco cerrado de paso: **una segunda constructora se rechaza al nacer** en `crearOrganizacion` (`failed-precondition`, sin escribir nada), porque `obras/`, `global/*`, `health/*` y la bitácora de la raíz están fuera de `/orgs`. No había filtrado: 14 usuarios de Auth, los 14 de constructora, una sola org. **CERRABA ANTES DE QUE EL #69 EMPEZARA, y así fue: el #69 queda desbloqueado desde hoy.** | CERRADO |
| 74 | **«Ya no tienes acceso a esta obra» era casi siempre mentira.** `uploadFoto` traducía cualquier `storage/unauthorized` a esa frase, y el commit de documentos (`subirDocumento`) hacía lo mismo con **cualquier** fallo, red incluida. La frase afirma algo sobre el dato —que le quitaron la obra— y lo normal no es eso: lo normal es el JWT rancio, porque los claims tardan hasta una hora en refrescarse solos y el listener de `claimsVersion` sólo corre si la Cloud Function alcanzó a incrementarlo. Costo: un supervisor de pie en la obra, con la foto sin subir, pidiendo un permiso que ya tiene. **Arreglo:** `src/permiso-denegado.js` distingue tres casos — (1) token rancio, un solo reintento con `getIdToken(true)` y sin mensaje; (2) la obra NO está en los claims ya frescos, y entonces la frase es cierta y dice a quién pedírsela; (3) la obra SÍ está y aun así niegan, que no se explica y deja **rastro** con uid, correo, obraId, ruta intentada y código. El rastro lleva **dos relojes** —el del aparato y `serverTimestamp()`— porque su diferencia distingue un reloj mal puesto de una fila que viajó en la cola. La cola de `localStorage` es **mejor esfuerzo declarado**: iOS Safari purga a los 7 días de inactividad y sólo las apps instaladas en pantalla de inicio están exentas, así que **ningún mensaje afirma que el reporte quedó registrado**, y `encolarRastro` devuelve `false` en vez de fingir cuando no pudo guardar. Banco `prueba-mensaje-de-permiso.cjs`: 27 aserciones con sesiones y denegaciones reales del emulador, contraprueba de 5 mutaciones que **funden pares de casos** (la forma exacta que tenía el defecto), las 5 vistas. | CERRADO |
| 82 | **El parser del Sheet de GP tiraba o rotulaba mal el dinero en cuatro sitios, y los cuatro en silencio.** Medido contra la hoja real el 2026-10-27, corriendo el parser EXTRAÍDO de `functions/index.js`, no una copia: **(A)** los rubros se indexaban por el código de 3 dígitos y 14 de las 34 obras traen «300 INDIRECTOS» **y** «300 SUBCONTRATOS» — el segundo nunca se creaba y sus proveedores colgaban del primero: $1,308,275.55 de la 0112 y $2,487,929.25 de la 0114 salían rotulados «INDIRECTOS», y **16 de 34 obras tenían una tabla de rubros que no sumaba su propio KPI**, que es el P «una cuenta por número» roto en la pantalla de gastos; **(B)** «Total 1 .- Enero» aparece una vez por año en la misma fila y se guardaba la PRIMERA, o sea la de 2024, bajo la clave `total_month_2026_01`: los doce meses «de 2026» de la 0099 sumaban $20,119,989.65 — exactamente su total de 2024 — y `mesesDisponibles` listaba noviembre y diciembre de un año que iba por la semana 43; `extraerGastoTotalGP` cae a la suma de meses cuando no hay total anual, así que una obra sin acumulado habría enseñado el gasto de otro año como propio; **(C)** la rama de proveedor exigía que el nombre no empezara con dígito y perdía «3.1 SWEET INMOBILIARIA…», $22,000.00 en la 0099; **(D)** el filtro de subtotales era `/^total/i` y se comía a **TOTAL PLAY TELECOMUNICACIONES**, proveedor real, $37,092.90 en la 0001 y $35,988.79 en la 0037. Arreglados los cuatro, las **34 de 34** obras cuadran: obra = Σrubros y rubro = Σproveedores. Banco nuevo `prueba-parser-gp.cjs` con su hoja `scripts/hoja-gp-de-prueba.csv` (P7), que no compara contra números míos sino contra lo que la hoja dice de sí misma, y que además corre el lector REAL de `src/App.jsx` sobre lo que sale del parser de `functions/index.js`. Las 4 contrapruebas lo ponen en ROJO con salida 1 (11, 2, 5 y 5 aserciones). **Desplegado el 2026-10-28 13:43Z**, revisión `actualizargpsheet-00013-fop`, alcance `actualizarGPSheet,refrescarGP` — dos reemplazos, cero creaciones. Fueron **las dos** porque `refrescarGP` (el botón «Refrescar» de la pantalla) llama a la MISMA `descargarYGuardarGP` y escribe el MISMO documento: desplegar sólo el cron habría hecho que a las 8am entraran los números buenos y el primer clic los devolviera a los malos, sin aviso. `PARSER_VERSION` se dejó en **3 a propósito**: el front desplegado exige exactamente 3 y subirlo habría puesto «versión vieja» en todas las pantallas hasta desplegar también el front. Verificado por tres vías independientes: SHA-256 del paquete bajado de `gcf-v2-sources` idéntico al del repo (`311d6d8f…`); el parser **extraído de ese paquete bajado** y corrido sobre la hoja real da 0 descuadres, 14 rubros 300 coexistiendo, 10 meses y los dos proveedores recuperados; y el canario de las 13:47Z movió producción — `gp_construct` `ultimoMes M2026-12 → M2026-10` y `mesesDisponibles 12 → 10`; `gp_detalle` (34 docs) descuadres **16 → 0**; `gp_sync {ok:true, 10307 ms}`. | CERRADO |
| 39 | **El resumen semanal por correo leía la raíz, no `orgId`**: el margen bruto de una constructora podía salir en el correo de otra organización. Era el P5 roto por fuera de la pantalla, y era más grande que un correo: **seis** sitios del servidor elegían a quién hablarle **por el nombre del rol**. Medido en producción antes de teorizar (2026-10-28, sólo lectura): 1 organización, 14 usuarios y 4 destinatarios, todos `fosmon`; 5 obras en la raíz, ninguna con campo `orgId`; `/orgs/fosmon/obras` vacía. El defecto es **latente, no estaba mordiendo** — y lo que lo mantenía dormido es que ninguno de los tres roles del portafolio existe en `ROLES_POR_TIPO.dependencia`. Una coincidencia de vocabularios no es una frontera: basta meter `director_obras` en la lista para que presupuesto, gasto y cobrado de las obras de la constructora salgan en el correo de un municipio. **Arreglo:** `obras/`, `global/*` y `health/*` viven fuera de `/orgs` y son de la constructora —por eso `crearOrganizacion` rechaza una segunda—, así que `orgDeLaRaiz` contesta **leyendo** de quién son; si no hay exactamente una constructora **lanza** y el trabajo no corre, porque mandar el correo con una organización adivinada falla sin que nadie se entere y que no salga el correo se nota el lunes (el throw cae en el `catch` que ya existía → salud → relanza → Scheduler lo cuenta rojo). Los seis sitios: destinatarios del resumen, `usuariosCapturaDeObra`, la consulta de gerentes de la alerta A4, la lectura de `obras/` de los dos crones, y **`backfillClaims`, la sexta función de gestión que el barrido del #73 se saltó** — devolvía `detalle` con el correo y el rol de CADA usuario de TODA la base a cualquiera de los seis `ROLES_ADMIN`, dos de ellos roles de dependencia. Se diseñó el **defecto espejo**: acotar puede tirar en silencio a un destinatario legítimo, así que el correo **nombra** a las cuentas de la propia casa sin `orgId` y **cuenta** —sin nombrar— las de otra, como ya hacía `bloqueDenegaciones`. De paso: `where("activo","!=",false)` **descarta** los documentos sin el campo, o sea que un perfil dado de alta a mano no recibía un solo aviso; el rol se filtra en memoria a propósito, porque `==` sobre `orgId` más `in` sobre `rol` pide índice compuesto y un cron que revienta por un índice deja de avisar. Banco `prueba-correo-no-cruza-organizaciones.cjs`: dos organizaciones, una obra asignada a residentes de las dos, 20 aserciones que **ejecutan** los manejadores reales extraídos del archivo, y 7 mutaciones que lo ponen en ROJO con salida 1 — la más elocuente devuelve el filtro por rol y el correo con el gasto de FOSMON le llega al director del municipio. Dos bancos vecinos dejaron de arrancar porque las funciones crecieron, y un «no arrancó» es rojo: se les dio el insumo que pedían. Suite 68/68. **Desplegado el 2026-10-28 14:49Z** — `resumenSemanalEmail` `00007-baq`, `probarResumenSemanal` `00007-lek`, `recordatorioCapturaObra` `00006-lat`, `recordatorioLunes` `00005-siv`, `backfillClaims` `00004-gep`: cinco reemplazos, cero creaciones. Verificado por dos vías: los cinco paquetes bajados de `gcf-v2-sources` traen un `index.js` con el mismo SHA-256 que el repo (`1e6aac2794…`), y las 20 aserciones corridas **contra el paquete bajado** —no contra el repo— salen verdes. El canario se hizo **en solo lectura**, corriendo `orgDeLaRaiz` y `partirPorOrg` extraídas de ese paquete sobre el padrón real: dueña de `obras/` = `fosmon`, **leída y no supuesta**; le llega a **4** (`aoliva`, `lmayo`, `ofosadog`, `ofosado`), **0** sin organización y **0** de otra; **cero diferencia** contra lo que mandaba la versión anterior, que es lo que debía salir si el defecto era latente, y ahora es un hecho medido y no una predicción. **No se disparó `probarResumenSemanal`**: no es un simulacro, manda el correo de verdad con el dinero de las 5 obras, y la pregunta que el canario iba a contestar ya estaba contestada sin molestar a nadie. | CERRADO |
| 50 | **No existen las partidas extraordinarias, y ya están deteniendo una obra real.** Cuando el catálogo no se ejecuta completo se generan para ejercer el contrato, o porque hizo falta algo nuevo; hoy no hay dónde registrarlas, así que lo ejecutado sale por debajo de lo real y el catálogo congelado se presenta como si fuera todo el contrato. Clave, descripción, unidad, cantidad, PU e importe; aparte del catálogo congelado y marcadas como extraordinarias, con su convenio o autorización, y cuentan en el ejecutado. Aplica a los dos tipos de organización. **Dejó de ser hipótesis el 2026-10-28** (Oscar: el malecón no llega al 100% porque falta la opción). Medido en producción en solo lectura, con `desgloseEjecutado` y `avanceFisicoPonderado` **extraídas de `src/App.jsx`** y corridas sobre el catálogo vivo real — la 0112 **es** el malecón (`SIOP COATZA MALECON 0526`): contrato $25,849,801, **catálogo congelado exactamente igual al contrato**, ejecutado $25,183,452 (catálogo $22,130,257 + excedente $3,053,195), **avance 97.42 %**, 6 de 14 partidas ya por encima del 100 %. Faltan **$666,349** de contrato que sólo se pueden ejercer con obra que no está en el catálogo, y no hay dónde teclearla. El `presupuesto` viene **igualado a la suma del catálogo en las cinco obras**, así que una extraordinaria sube el catálogo por encima del contrato: ahí es justo donde manda el principio — el avance físico se topa al 100 %, el dinero no. **Restricción de diseño medida el mismo día:** el catálogo vivo de la 0114 son 335 partidas y su documento ya pesa ~1.4 MB en REST, la 0125 son 461 y ~0.9 MB, así que las extraordinarias **no caben** en `avance/subs` (ver #30 y #28) y tienen que vivir aparte — que además es como las quiere el negocio. Explica el #7 y lo hereda. **Hecho el 2026-10-28:** viven en `obras/{id}/avance/extraordinarias` —aparte porque `avance/subs` se reescribe entero al recargar catálogo— y se mezclan con el catálogo en memoria antes de cualquier cuenta, así que hay una sola cuenta por número; la captura no se duplicó (`renderConcepto` recibe la cabecera). Reglas en los dos lados, el cliente las ve con su convenio y sigue sin ver maquinaria. `calcularKpisObra` las suma igual, para que el correo del lunes y la pantalla no den dos avances. Dos bancos nuevos, con contraprueba. **Desplegado el 2026-10-28**: reglas (ruleset `53540813`, verificado byte por byte contra el archivo del repo), front (`0f9e8e6`, verificado por frases en el bundle vivo, no sólo por el hash) y funciones (canario con `listarUsuarios` antes de las demás). **La 0112 sigue en 97.42 % hasta que alguien capture el muro**: el despliegue dio el lugar donde teclearlo, no el dato. | CERRADO |
| 110 | **La recta seguía dibujándose cuando no había anexo, y un rótulo no la desmiente.** El #51 (el avance contra una recta) la dejó rotulada «Avance lineal» en vez de quitada: una recta entre inicio y fin, en el mismo panel y con el mismo grosor que las series medidas, se lee como el plan de la obra diga lo que diga la leyenda — y contra los tres anexos reales se separa hasta 27 puntos **en los dos sentidos**, o sea que absuelve y acusa por turnos. Quitada de los ocho sitios que la consumían (KPI, Curva S, tendencias mensuales, serie semanal, PDF hoja 1 con su leyenda y su renglón de riesgo, `avc_004` y `avance_bajo_programa`); el bloque de proyección no se tocó, porque `kpiDesviacionPlazo` mide plazo contra plazo y ahí la recta no afirma nada sobre el avance. **La ausencia se declara, no se esconde:** el KPI dice «Sin programa cargado · sin medir» en vez de desaparecer, la leyenda nombra el archivo que falta, el título del panel deja de decir «CONTRA EL PROGRAMA» cuando no comparó contra nada, y el PDF levanta una observación de atención. **Lo que cuesta hoy, leído de producción el 2026-11-06: 0 de las 7 obras vivas tienen programa capturado**, así que al desplegar esto la serie programada queda en blanco en TODAS las pantallas y en el PDF que se entrega al cliente, y las dos reglas de atraso callan hasta que alguien cargue un anexo. Es el precio correcto —callar es barato, afirmar una recta inventada no— pero no es gratis: lo que lo cierra es cargar los siete anexos, que es operación y no código (va con el #96, cuadrar el alta contra su anexo). Los tres bancos del área llevan ahora una mutación que **repone la recta**, que es el modo realista de volver al defecto: «la tarjeta se ve vacía». **Desplegado el 2026-11-07** (`4b207a1`, bundle vivo `index-ff8f2199.js`): comprobado que «Sin programa cargado» **está** y que «Avance lineal» y «CONTRA EL PROGRAMA» **ya no están** — se mide lo que el cambio añade y también lo que quita. Queda **PARCIAL a propósito**: el código está entero, pero lo que de verdad cierra el renglón es cargar los siete anexos, que es operación y va con el #96 (cuadrar el alta contra su anexo). **La operación ocurrió: el 2026-11-09 Oscar cargó cuatro anexos** (ver #104), así que en esas cuatro obras la conducta de producción ya es la del programa dibujado y no la del hueco. Las tres que siguen sin anexo —0112, 0114, 0125— son de FOSMON, no entran en la demo, y ahí «Sin programa cargado» **es** la respuesta correcta. El renglón deja de esperar código y deja de esperar carga. | CERRADO |
| 111 | **Tres gráficas dibujando series que se solapan son tres sitios donde desincronizarse, y una serie que no se puede dibujar desaparecía.** El tablero de obra tenía la de avance y economía, la de proyección de avance y gasto, y la Curva S: tres prólogos resolviendo por su cuenta de qué obra del GP hablaban y qué era el ejecutado —`medir-tres-resolvedores-de-gp.cjs` existe justo porque dos de esos prólogos no traían la guarda que la tercera sí—. Unificadas en `curvaUnicaDeObra`, que arma **cuatro cantidades sobre un solo eje en pesos acumulados del contrato**: ejecutado, programado, gasto, y el margen, que **no es una línea sino el área entre el ejecutado y el gasto**, rotulada «en pesos» porque arriba en el mismo tablero el margen es un porcentaje. Se sombrea también la diferencia contra el programa, que es lo que hace evidente el atraso de un vistazo. **Lo de fondo es la mentira por omisión:** sin la línea de gasto no hay área de margen, y un hueco que no se sombrea se lee como «no hay hueco» en vez de «no se sabe» — una mentira sin cifra con la que discutir. Ahora cada cantidad que no se puede dibujar entra en la leyenda **con su motivo**, y las ausencias no se arrastran entre sí: faltar el anexo no apaga el margen ni faltar el gasto apaga el atraso. El desajuste entre lo que suma el anexo y el contrato capturado se declara al pie **con las dos cifras** y no se corrige reescalando el eje, porque reescalar esconde un defecto del dato. Las líneas se prenden y se apagan, al abrir salen todas, el estado no se recuerda entre sesiones, y **apagar una no mueve el eje**: si se reajustara, apagar el gasto haría crecer al ejecutado en pantalla y parecería que la obra avanzó. Banco nuevo `prueba-la-grafica-que-no-miente-por-omision.cjs` (8 secciones, 14 mutaciones en ROJO); cuatro bancos vecinos dejaron de arrancar al desaparecer los componentes viejos y un «no arrancó» es rojo, así que se restataron por significado donde el sujeto sobrevivía y se borraron con nota donde no. Dos hallazgos del propio banco valen más que las aserciones: la del eje **pasaba sin medir nada** porque el taller recorta el cuerpo y no la firma, así que `maxFijo = null` llegaba `undefined` y la escala salía `undefined` en los dos lados; y apagaba el gasto, que **no es la serie que fija el techo** — comparar contra una serie que no manda el eje cumple la aserción por la forma del fixture. Suite 98/98. Verificado en el preview contra el emulador con las tres obras sembradas: la 0121 sin anexo declara las dos ausencias, la 0128 declara el gasto sin medir **y** el margen con «no es que no haya margen, es que no se sabe» **y** la nota de bases ($12.9M contra $27.5M), y la 0114 dibuja las tres líneas y las dos áreas y sostiene el eje en $28.9M al apagar justo la serie que lo fija. **Desplegado el 2026-11-07** (`4b207a1`, bundle vivo `index-ff8f2199.js`): la frase que sostiene lo de fondo —«no es que no haya margen, es que no se sabe»— está en lo que se sirve. | CERRADO |
| 112 | **El tablero del municipio dibujaba porcentajes y no decía cuánto le había pagado al contratista.** La dependencia veía dos series en por ciento —avance real contra programa— y ningún peso. Ahora es `curvaDeGobierno`: **tres líneas sobre un solo eje en pesos acumulados del contrato** —programado, ejecutado y **lo pagado**— y **dos áreas**: el hueco entre lo construido y lo pagado, que es para el municipio lo que el margen es para la constructora, y el atraso contra el programa. **Ni gasto ni margen del contratista**, y no por omisión sino medido: el banco le **manda `gpData` a propósito** y exige que no salga economía del contratista por ninguna de las tres puertas —línea, área y claves del objeto devuelto—, porque una bandera en la gráfica única habrían sido diez puntos de toque y basta olvidar uno. **Lo pagado no se puede fechar y por eso no se inventa:** medidas en producción el 2026-11-06 las 42 estimaciones de las 7 obras vivas, **ninguna guarda fecha de pago** (`periodo` es texto libre: «05-30 de Junio 2026», «16-jul-26 al 15-ago-26», dos vacíos), así que la serie descansa en el corte semanal congelado `montoPagado` más un ancla honesta en la semana de hoy, **y el pie dice en cuántos cierres descansa** — con cero cortes dice que no hay historia que dibujar, en vez de repetir el total de hoy hacia atrás y pintar una recta con cara de medida. La segunda mitad del renglón es el **cargador del anexo**: se **movió** (no se copió) de Presupuesto a **Contrato → Programa de obra**, que es por donde entra la dependencia. **Dos defectos los encontró el preview, no la suite.** (1) `PanelSemanal` **borraba de la leyenda el área que no alcanzaba a sombrearse**: con las dos líneas vivas pero coincidiendo en una sola semana no hay banda que pintar, y «construido y no pagado» se esfumaba **en las tres obras de dependencia** —es el caso normal, no el raro, porque hoy lo pagado sólo se conoce en la última semana—. Era la misma mentira por omisión del #111 un piso más abajo, en el componente compartido, así que el arreglo alcanza también al margen de la constructora; apagar una línea a mano **no** se declara, que eso lo decidió quien mira. (2) El motivo de la línea ausente mandaba a **«Planeación → Contrato»**, que es el camino de la constructora: la dependencia no tiene esa pestaña. Un motivo que manda a un sitio que no existe es peor que callar — quien lo sigue concluye que la app está rota, no que le falta un archivo. Bancos: `prueba-la-grafica-de-gobierno.cjs` nuevo (7 secciones, **18 mutaciones en ROJO**) y `prueba-la-grafica-que-no-miente-por-omision` con la sección 7b (**16 en ROJO**); `prueba-las-dos-curvas-y-un-eje` recableado al objeto que la cuenta devuelve (14) y `prueba-series-sincronizadas` reparado, que no conocía las dos cuentas que salieron a nivel de módulo —`serieEjecutadaDeSemanas` y `huecoEntreCurvas`— porque **dos gráficas que restan igual tienen que restar con la misma cuenta**. Suite 99/99. Verificado en el preview con el emulador sembrado y las tres obras de dependencia: la **OP-2026-002** dibuja las tres líneas y las dos áreas y su pie dice «2 de 12 cierres»; la **OP-2026-001** declara el programado ausente con su motivo y nombra el hueco que no pudo sombrear; la **OP-2026-003** imprime **$0 medido** donde las otras dicen «el cierre no registró el corte», que es la distinción entre un cero y un hueco. Y el cargador leyó un **DE-5 real** (51 partidas, 7 meses, encabezado en el renglón 13) y lo enfrentó al alta: «el programa pide $70,035,416, el 1,250.6% del contrato», sin corregir ni impedir guardar. **Desplegado el 2026-11-07** (`4b207a1`, bundle vivo `index-ff8f2199.js`, `verificar-despliegue.cjs` en **0** en los cuatro canales): comprobadas en lo que se sirve las seis frases del cambio —«Lo construido, lo programado y lo pagado», «Construido y no pagado, en pesos», «Pagado al contratista», el motivo que manda a «Contrato → Programa de obra», «Arrastra aquí el Excel del programa» y el motivo del área muda—. Fue **sólo front**: ni reglas ni funciones cambiaron, así que no hubo canario que disparar. | CERRADO |
| 113 | **La columna «Avance» de las dos gráficas imprimía `0%` en las semanas que no tiene medidas.** Cerrado 2026-11-12 junto con el 116 de nómina: son la misma clase de defecto en dos series. `serieAvanceDeSemanas` deja en `null` lo anterior al primer cierre —y la obra sin catálogo entera— y la columna dice «sin medir» en los dos tableros. Banco `prueba-la-ausencia-no-es-cero.cjs`, que renderiza la tabla real con las columnas de los dos. | CERRADO |
| 114 | **El ritmo de la obra se calculaba sobre un corte que todavía se podía mover, y publicaba un veredicto sin decir sobre cuántas semanas.** Un ritmo construido sobre la semana en curso no es un ritmo: es una lectura parcial que cambia cada vez que alguien captura. Ahora el bloque **dice cuántos cortes cerrados tiene y cuántos necesita** (`fraseCortesCerrados`, `CIERRES_MINIMOS = 2`) y el veredicto sale de las **últimas 4 cerradas** (`VENTANA_RITMO`), no de todo el plazo. Lo de fondo es que había **dos ritmos posibles y dos veredictos sería peor que uno malo**: la ventana corta dice cómo va hoy y el plazo entero cómo ha ido, y en la 0114 real difieren por un cociente de 0.61. La decisión fue **un veredicto, con su contexto**: manda la ventana corta, y cuando se separa del largo más de un tercio (`UMBRAL_TENDENCIA = 2/3`) un renglón dice «la obra aceleró» o «se frenó» **con los dos ritmos a la vista**, en vez de publicar dos cifras y dejar que el lector elija. Verificado en el preview contra el emulador: la 0114 sembrada con seis semanas y la curva doblada que reproduce el cociente medido en producción —en línea recta los dos ritmos son el mismo número y el renglón no puede verse, así que el sembrador aprendió a doblar la curva (`curva` opcional, por omisión la recta de antes)—. **Desplegado el 2026-11-09** (`2aec5be`, bundle `index-807053b0.js`): están `cortes cerrados`, `aceleró` y `se frenó`, y **ya no está** `requiere 2 cierres`. | CERRADO |
| 115 | **La portada del reporte decía cuándo se cortó, y era la hora de una laptop — y eran CUATRO relojes, no uno.** El renglón «Corte del reporte» sale firmado al pie por tres personas, y lo ponía `new Date()` en el navegador: el reloj del aparato de quien apretó el botón. Un reloj mal puesto no se nota al leer un PDF, porque **una fecha impresa es creíble sin importar cuál sea**. Peor que el reloj era la multiplicidad: el encabezado de cada página, la carátula, el día del avance programado y la línea de HOY del gantt leían la hora cada uno por su cuenta, así que un documento armado a las 23:59:58 podía salir con la portada de un día y la gráfica del siguiente, **las dos cifras firmadas**. Es «una cuenta por número» roto dentro del documento que se entrega. Ahora entra **un** instante (`selloDeTiempo`) y de él salen los cuatro, con `timeZone` explícito por lo mismo que `fechaEnZonaObra`: sin él la portada lleva el huso del aparato y el instante del servidor se imprimiría con el calendario de otro país. La hora viene de una **callable nueva, `horaDelServidor`**, que **no escribe nada**: la alternativa de escribir con `serverTimestamp()` y releer mete un efecto en lo que es una lectura —generar un PDF no debe dejar rastro en la base— y cuesta dos viajes. Pide sesión, no porque la hora sea secreta sino porque un `onCall` abierto es factura nuestra, y no consulta perfil ni rol: la hora es la misma para todos y una lectura de Firestore por cada PDF es gasto y además una dependencia que puede fallar. **Cuando no contesta, el documento no presume:** imprime «hora de este equipo · el servidor no contestó», porque un sello que se atribuye un origen que no tiene es peor que no llevar sello, y en una portada que se firma es una afirmación falsa. Banco `prueba-la-hora-que-se-firma.cjs`: 21 aserciones y **6 mutaciones en ROJO** —quitar la guarda de sesión, escribir en la base antes de contestar, soltar el chequeo de `fuente`, soltar el `timeZone`, volver a leer el reloj en el gantt, y mentir diciendo «servidor» siempre—. Una aserción voltea `process.env.TZ` a Tokio dentro de un `try/finally` y exige que la portada siga diciendo el día de México, porque con la zona de la suite en México soltar el `timeZone` **pasaría por coincidencia**; otra comprueba que la zona quedó restaurada, para no envenenar a los bancos de después. Verificado en el preview con datos sembrados: de los 633 textos que el generador manda a la hoja, la carátula dice «08 de noviembre de 2026, 11:44 h · hora de este equipo · el servidor no contestó» y **cero** dicen «hora del servidor» — es la rama degradada, la única que el preview puede mostrar porque `firebase.json` no levanta emulador de funciones. **Desplegado el 2026-11-09**, callable sola primero y front después (ver la frontera): `HTTP 401` propio sin autenticar, y las tres frases en el bundle vivo. | CERRADO |
| 117 | **Dos tarjetas del tablero repetían cifras de los KPIs de arriba, pero ninguna era pura repetición.** «Personal en campo — Semana N» y «Margen bruto de obra» se quitaron; antes se midió qué decían que no estuviera ya arriba, porque un bloque 80% repetido pierde su 20% único sin que nadie lo note. Lo que subió: **de qué semana** son las cifras de plantilla y si la semana vino rayada en varios archivos (seis de las siete obras vivas van en la 45 y la 0114 en la 44, y dos de siete suman su última semana de dos archivos), el desglose directos/indirectos, y **la fórmula del margen** al alcance del cursor. La plantilla vive ahora en `plantillaDeObra` y no en una plantilla de cadena por pantalla, porque la 0131 no tiene ninguna semana cargada y el KPI publicaba un `0` idéntico al de una obra con cero personas medidas. La fórmula **no** cupo en `margenTitulo`: ese campo vale `undefined` cuando el margen sí se pudo medir y seis pantallas le preguntan para saber si hay un hueco, así que llenarlo siempre habría apagado la señal sin tirar ninguna cifra — lo rechazó el banco `alta-obra-que-gp-no-conoce`, no una revisión. **El umbral del 15% NO subió**, aunque estaba en la recomendación: se pintaba al 85% de gasto/presupuesto mientras el margen de 15% se alcanza al 85% de lo **ejecutado**, y en la 0127 cae donde el margen es −135% — se equivoca hacia el lado que tranquiliza, así que subirlo era llevar un número equivocado a un sitio más visible; la aritmética queda escrita donde estaba la tarjeta. Banco `prueba-el-kpi-carga-su-procedencia.cjs` (5 secciones, 2 mutaciones en ROJO) y `semana-actual-front-obra` reanclado al KPI, porque la conducta no se fue con la tarjeta: se mudó. Suite 102/102. Verificado en el preview con el emulador resembrado: la Oaxaca dice `34 · 26D · 8I · Semana 38` y su margen trae la fórmula; la Malecón dice `sin nómina` y su tooltip lleva el motivo **y** la fórmula, sin porcentaje. | CERRADO |
| 118 | **El tablero publicaba tres respuestas a la pregunta del plazo, y dos estaban mal calculadas.** «Semanas p/estimar ~48 sem» dividía el **presupuesto entero** entre el ritmo, ignorando lo ya ejecutado —la obra ya llevaba la mitad andada y la cuenta la hacía empezar de cero—, y encima se llamaba «estimar» mientras usaba el ritmo de **ejecución**: dos cuentas distintas bajo un rótulo. Al lado, «Proyección al fin 62.5%» ofrecía un segundo veredicto sobre lo mismo. Ahora hay **uno**: `veredictoDePlazo` arma el bloque entero desde la proyección que ya existía, el bloque **no calcula nada propio** —consume `atrasoProyectado` y `kpiDesviacionPlazo`— y el ritmo en pesos es la **traducción** de la única velocidad (`velocidad ÷ 100 × contrato`), no una segunda medición; sin contrato devuelve `null` y no `$0`, porque un cero diría que la obra está parada. Mueren «Semanas p/ facturar todo», «Proyección al fin» y «Obra ejecutada vs Estimaciones» (de B.1), salvo `estPag`, que A.7 necesita. La **N del rótulo se calcula**: `tramos` son semanas de calendario y `semanasBase` son cierres, y no son lo mismo —la 0127 promedia 3 cierres repartidos en 5 semanas—, así que el rótulo dice las dos. Donde no se puede proyectar, se dice: «1 de 2 cortes cerrados», y con el plazo vencido **no hay ritmo necesario** porque no queda plazo en el que acelerar. **Dos defectos salieron por el camino, ninguno de los dos del mandato.** Uno: la desviación restaba un instante contra una medianoche, y la misma obra decía +128 por la mañana y +129 por la tarde; ahora los dos extremos son días. Otro, y éste lo encontró el preview y no la suite: la tarjeta entregaba a React el **objeto** de `tendenciaDeRitmo` en vez de su frase, y eso no imprime mal — **tira la pantalla entera**. Los 40 escenarios del banco caían en la rama `null` y salían verdes. El banco `prueba-un-solo-veredicto-de-plazo.cjs` tiene ahora un escenario que **sí dispara** la tendencia (razón 0.38 contra el umbral de 0.67, y la primera aserción es que dispara, porque un escenario mudo comprueba nada), y `pintar` atrapa la excepción del render para que una pantalla caída salga **ROJO y no «no arrancó»**. 44 aserciones, **5 mutaciones en ROJO**. Aparte: **cuatro bancos estaban a punto de morir** por listas de dependencias tecleadas a mano —la misma clase de defecto del 2026-10-26— y pasaron al extractor compartido; `fuenteDe` aprendió `excluir` y `piezas`. El veredicto da **+128 días** donde la cuenta a mano da 125: los tres días son el redondeo de 33.63 semanas a 34, no un defecto. Suite 103/103, verificado en el preview con las tres obras del emulador. | CERRADO |
| 119 | **La regla del 80/20 estaba bien escrita y compartida; la pantalla la calculaba y la tiraba.** El mandato de B.3 pedía ordenar partidas por importe hasta cubrir el 80% del contrato, tope 15 fotos, las más recientes de cada una **repartidas en proporción a su peso**, y que una partida grande sin fotos apareciera declarando el hueco. Medido antes de escribir (`medir-lo-que-la-tarjeta-no-ensena.cjs`, sólo lectura contra producción): `seleccionFotografica` ya hacía **todo** eso desde el 2026-11-06 y ya era una sola función para el tablero y el expediente, así que B.3 no era un defecto de la regla sino de la rejilla. **De 75 fotos que el reparto elige en las siete obras, la tarjeta pintaba 23: se tiraban 52.** La rejilla era `[0,1]` fija, dos huecos por partida, y con dos huecos la razón en pantalla **no puede pasar de 2x** — en la 0112 el reparto separaba la partida del 57.5% de la del 5.6% en 12.0x y la pantalla en 2.0x, de modo que la propiedad pedida (una partida del 25% no puede quedar representada igual que una del 5%) era **inalcanzable por construcción**, no mal afinada. Y el segundo hueco fijo se rellenaba con «Sin foto» aunque la partida tuviera fotos de sobra: en la 0112 el cuadro decía «Sin foto» justo encima del renglón «1 de 31 fotografías de esta partida» — un hueco declarado donde no hay hueco es la mentira al revés de la galería que se ve completa. Ahora la rejilla pinta `p.fotos` y el cuadro vacío se reserva a `sinEvidencia`. **Lo que deliberadamente NO se hizo:** acotar el reparto a lo que cabe en la tarjeta, que habría recuperado las 52 — `prueba-se-enseña-lo-que-pesa` §8 defiende esa frontera con una mutación nombrada («la tarjeta enseñaría una foto que el expediente no imprime»), así que la tarjeta pinta un **subconjunto** del mismo reparto, nunca otra lista; se corrigió la pantalla, no la regla. Banco nuevo `prueba-la-tarjeta-pinta-lo-que-el-reparto-dio.cjs`, que **pinta** (el banco viejo sólo probaba la regla y nunca renderizaba): 16 aserciones, **4 mutaciones en ROJO**. **Dos defectos de mis propias mediciones, los dos atrapados antes de reportar:** el detector de aplanamiento exigía que los huecos salieran *iguales* y así el 0112 (2 contra 1) pasaba por sano — dijo «0 de 7» y era falso; el aplanamiento es que la pantalla **comprima** la razón, no que empate. Y en el banco, una aserción comparaba contra un rótulo que la pantalla no publica, y `12 > null` es verdadero por coerción: habría seguido verde con la pantalla en blanco. La contraprueba también mentía el conteo («1 aserción» cuando mordían 3) porque `CALLADO` apaga los renglones que contaba. Suite 104/104. Verificado en el emulador: una partida pinta **3** fotos, imposible con la rejilla vieja, y «Sin evidencia» sale sólo en las dos partidas que no tienen ninguna. | CERRADO |
| 120 | **El motor de riesgos no sabía decir «no sé», y un detector que reventaba se contaba como «sin riesgo».** `detectarRiesgos` devolvía un solo arreglo y fuera de él caían cuatro cosas indistinguibles: la regla midió y no halló nada, la regla **no pudo** medir por falta de dato, y —oculto— el detector **reventó** y el `catch` se lo comió. Medido en producción, no en teoría: las obras **0128 y 0131** tienen el gasto de GP sin medir, así que su margen sale del 100% y `fin_001` y `fin_002` se callan las dos; el tablero de esas obras afirma que no hay riesgo de margen cuando lo que pasa es que nadie midió el gasto. Y con un contexto sin obra, **`ctr_001` y `ctr_002` revientan de verdad** (`Cannot read properties of undefined`) y salían como tranquilidad. Ahora `evaluarRiesgos` devuelve los **cuatro cubos** y `detectarRiesgos` es una vista de él (`.detectados`), así que **ninguna de las dos pantallas cambia de conducta en este lote** — verificado en el emulador: el banner de la Av. Universidad sigue diciendo los mismos 4 riesgos con sus cifras (−73.0%, +38.9pp, 100%) y el del Colector los mismos 2. La declaración es **declarativa a propósito**: `DATOS_DEL_RIESGO` nombra 18 datos con su `hay` leyendo **sólo del contexto**, cada plantilla declara su `requiere`, y el motor comprueba el dato **antes** de llamar al detector — lo alternativo era que los 31 detectores devolvieran un «no pude», que obligaba a tocar los 31 y arriesgaba cambiar qué dispara. El hueco **nombra el dato y el motivo** («el gasto de esta obra medido en GP · no hay corrida del gasto de GP todavía»), con los cuatro motivos de `estadoGastoGP` redactados distinto porque se arreglan en sitios distintos. `reventaron` **no se mezcla** con `noEvaluables`: no es que falte un dato del cliente, es que nuestro código falló, y juntarlos haría pasar un defecto nuestro por un hueco suyo; a `ctr_001`/`ctr_002` **no se les puso guarda de nulos a propósito**. **Mi propia regresión, atrapada por la suite:** declaré que `fin_006` necesitaba `ultimaSemana` **y** `semanasDisponibles` cuando su detector sólo usa la segunda, y el requisito de más volvió «no evaluable» una regla que disparaba — `prueba-el-plazo-se-cuenta-una-vez` salió con 4 en ROJO. Partido en `semanasGP`/`ultimaSemanaGP` y los seis requisitos de GP **re-derivados de la guarda de cada detector**: la regla queda escrita en el código, porque más estricto esconde un riesgo que existe y más laxo manda a «sin hallazgo» una regla que no pudo medir. De paso, el cruce «¿qué renglón de GP es esta obra?» estaba escrito **seis veces idénticas** dentro de la biblioteca y la séptima iba a ser la del chequeo del dato: ahora es `obraEnGP`, una. Y `prueba-ui-dependencia` dejó de arrancar porque armaba el motor de una **lista tecleada** de símbolos que no sabía de la pieza nueva — pasó al cierre transitivo de `fuenteDe`, que es quitar la fragilidad en vez de alargar la lista. Banco nuevo `prueba-tres-estados-del-riesgo.cjs`: **46 aserciones, 10 mutaciones en ROJO**, con el par que define todo esto —el **mismo cero** de gasto, una vez pedido a GP y otra no, que es medición en un caso y hueco en el otro—. Las cuatro reglas que detectan la **ausencia** de un dato declaran `requiere: []`: exigírselo las volvería no evaluables justo en el único caso en que tienen algo que decir. Suite 105/105. **Falta la pantalla:** nadie pregunta todavía por `noEvaluables` ni por `reventaron`; los consume el PDF de cotea (A.6). **La pantalla llegó en el #127, y ahí `detectarRiesgos` se borró: el atajo era el defecto.** | CERRADO |
| 121 | **El margen semanal en porcentaje no existía, y la caída que se ve no siempre es de la obra.** A.4 pide el comportamiento del margen en por lo menos las últimas cuatro semanas. `curvaUnicaDeObra` ya devolvía `margen` en **pesos** por semana con sus `null` bien puestos; lo que no existía era el **porcentaje**, que es la única unidad en la que «viene cayendo» significa algo sin depender del tamaño del contrato. Lo nuevo es `comportamientoDelMargen(curva, {minimo:4})`, que **no recalcula nada**: divide las dos series que la gráfica dibuja, y los pesos de cada renglón **son** los de `curva.margen` para que el renglón de la tabla y el hueco de la gráfica de la misma semana no puedan discrepar. **Lo que obligó a que sea una función y no una división en el reporte** salió de la medición contra producción (`medir-la-serie-semanal-de-margen.cjs`, sólo lectura, 2026-11-09, corrida S46, ventana de 12 semanas): la **0127** va de −103.2% a −214.0% en cuatro semanas y luego **sube 229 puntos en una**. Ninguno de los dos movimientos fue de la obra — el ejecutado estuvo **clavado en $11,104,150 cinco semanas** mientras el gasto seguía llegando, y en la S44 por fin se capturó el avance y saltó a $42,749,603. Un reporte que imprime esa caída sin decirlo **afirma algo falso con cifras verdaderas**, que es la forma de error más difícil de ver después. Así que la función cuenta el **ejecutado QUIETO** semana por semana, y no es un caso raro: de las seis obras con tramo legible, **cinco tienen semanas quietas dentro del tramo** (0112:5/9, 0114:2/10, 0125:1/7, 0126:3/12, 0127:5/8). **El tramo y la peor semana salen como DOS cifras porque se contestan al revés según la obra:** en la 0127 manda la semana (−62.2pp), y en la **0114 manda el tramo** —cae 4.7 puntos en diez semanas sin que ninguna semana suelta pase de −1.7—, que es el único deterioro genuino de la cartera y el que **una regla por semana no vería**. Sólo se lee la **cola contigua**: comparar la 46 contra la 41 y llamarlo «cayó en dos semanas» nombra mal el dato, igual que `semanaAnteriorGP` ya evita para el gasto. Si la cola no llega a cuatro **se declara con el conteo** y no se promedia — hoy la 0128 («sólo hay 2 semanas seguidas… y se necesitan 4») y la 0131 (1, en singular). **Un defecto propio corregido en el camino:** el primer motivo colgaba de `curva.ejecutadoMedido`, que es un **arreglo** —una bandera por semana—, así que negarlo nunca era cierto y ese texto era letra muerta; los motivos se miden ahora de las series y los tres medibles están redactados distinto porque se arreglan en sitios distintos. Y el guion de medición llevaba **su propia división**: medía mi idea del margen semanal, no el que la app publica; ahora extrae la función. Banco nuevo `prueba-el-margen-semana-a-semana.cjs`: **49 aserciones, 12 mutaciones en ROJO**, con la forma del 0127 y la de la 0114 como casos armados con `curvaUnicaDeObra` de verdad —así el banco comprueba también el contrato entre las dos funciones—. Una mutación encontró un hueco del propio banco y se **agregó la aserción en vez de quitar la mutación**: nada medía `desde`/`delTramo` en un tramo que arranca a media ventana, y ahí `x - null` da `x` sin avisar, de modo que el tramo del 0127 habría salido de 15 puntos en vez de 95. Suite 106/106. **La A.4 llegó y ya lo consume:** `comportamientoDelMargen` tiene dos llamadores —la sección 4 del documento interno (#125, las dos curvas) y la serie del margen—, así que la cuenta dejó de ser código que nadie pregunta. | CERRADO |
| 122 | **La regla del margen a la baja, con el umbral aprobado y una fecha para volver a mirarlo.** `fin_007` «Margen a la baja», `requiere: ['serieMargen']`, en `RIESGOS_SOLO_CONSTRUCTORA` porque el margen es economía del contratista y **una dependencia no la lee**. Lo aprobado el 2026-11-09: **3 pp de caída** sobre un **tramo de 4 semanas contiguas** como mínimo, y **NO EVALUABLE si más de la mitad del tramo trae el ejecutado quieto**; severidades a 3/6/10 pp. La evaluabilidad vive en el **dato** (`serieMargen` en `DATOS_DEL_RIESGO`) y el hallazgo en el **detector**, que es la separación que trajo el #120. **EL 3 ESTÁ CALIBRADO SOBRE UNA SOLA OBSERVACIÓN:** la sensibilidad a 2, 3 y 4 pp devuelve **la misma única obra, la 0114**, y a 5 pp no devuelve ninguna — el umbral no se eligió entre casos, se eligió para no perder el único deterioro verdadero que la cartera tiene hoy. Mientras eso siga así el número es **provisional**. **Volver a correr la §5 de `medir-la-serie-semanal-de-margen.cjs --prod` alrededor del 2026-12-21** —seis semanas, lo que tardan las obras nuevas en juntar tramo legible— y sólo entonces darlo por fijo o moverlo. Se acordó además **NO escribir la cláusula de desplome en una semana**: un umbral sin una sola observación detrás no es un umbral. **Y el defecto que encontró el preview, no una prueba.** Con la regla verde y 74 aserciones en verde, la pantalla de Oaxaca Parque Lineal afirmó en **CRÍTICO**: «El margen cayó **96.2 puntos** en 8 semanas seguidas · 97.1% → 0.9%». Ninguna de las dos cifras es el margen de esa obra: GP trae fechadas cuatro semanas por $8.5M de un `grandTotal` de $21.4M, así que el acumulado por semana arranca casi en cero y el ancla del último punto le mete los $12.9M que nunca estuvieron fechados — la «caída» es **el gasto llegando a su propia serie**. El filtro de captura no lo vio porque el ejecutado **sí** se movía cada semana (`quietas` salía 0); lo roto era el otro lado. La curva ya traía la bandera `gastoSinFechar` y la tabla de la **misma pantalla** ya se negaba a imprimir el delta de ese último punto por esta razón: negarse ahí y afirmar una tendencia aquí era la misma serie contestando dos cosas. Ahora `comportamientoDelMargen` **no arma cola** con el gasto sin fechar, y lo declara con su propio texto —el cuarto, porque se arregla distinto que «sin medir», «en cero» y «sin corte»—. En producción el 2026-11-09 **ninguna de las siete obras traía la bandera puesta**, por eso el umbral se calibró sobre series limpias y por eso ninguna prueba lo vio; la bandera existe porque el caso ocurre. Banco **83 aserciones, 20 mutaciones en ROJO** —cinco sobre la regla (umbral movido, filtro de captura apagado, tramo corto dado por legible, signo volteado, frontera de la dependencia abierta) y una sobre el gasto sin fechar—. Verificado en el preview: la tarjeta CRÍTICO desapareció y la obra pasó de 8 riesgos a 7. **Falta A.6:** el tablero sólo pinta `detectados`, así que hoy el NO EVALUABLE existe en el motor y **no se ve en pantalla** — una lista vacía sigue sin significar que no hay riesgo. Suite 106/106. **A.6 CERRADA en el #127.** **Queda una cita, no un pendiente de código:** volver a mirar el umbral de 3 pp el **2026-12-21** con la serie más larga (`medir-la-serie-semanal-de-margen.cjs --prod`, §5), antes de moverlo. | CERRADO |
| 123 | **El documento interno de cotea: un PDF aparte, que dice de qué no está seguro.** `generarPDFInterno` es un **segundo generador**, no una bandera del reporte del cliente: lo que se afirma es distinto —el margen, los rubros del gasto, los riesgos no evaluables— y una bandera dentro del de siempre habría puesto la economía del contratista a un `if` de distancia del papel que recibe el municipio, que es justo la frontera que no se negocia. Toma sus parámetros **por nombre** (el del cliente ya lleva quince posicionales). Lleva el sello `DOCUMENTO INTERNO · USO DE COTEA · EL QUE SE ENTREGA ES EL INFORME DE AVANCE` en la portada **y en el marco de cada página interior**, porque una hoja suelta impresa no trae portada. **Ninguna cifra nueva:** todo sale de `calcularKPIsObra`, `presentacionEconomiaObra`, `comportamientoDelMargen` (#121) y `evaluarRiesgos` (#120); el documento **formatea y nada más**. Van las secciones 1, 2, 4 (margen semana a semana + composición del gasto por rubro) y 6 (riesgos en **tres estados**, cada uno diciendo **con qué número disparó** — y una regla que disparó por una captura ausente lo dice con palabras, no con una raya, porque «—» en una lista de riesgos se lee como «aquí no hay nada»). La **numeración no se renumeró** a propósito: 3, 5 y 7 faltan y el hueco es el recordatorio. **Lo que el papel se niega a afirmar:** sin gasto medido el margen sale «—» y **dice por qué**; con gasto sin fechar no se dibuja la tabla del margen y se imprime el motivo. **El preview se ganó el sueldo:** salieron **6 páginas reales contra las 5 del lienzo de mentira** —el doble no pagina—, cada interior con su sello, y cada indicador cuadrado contra el tablero. Banco `prueba-el-documento-interno-de-cotea.cjs`: **41 aserciones, 16 mutaciones en ROJO**. El hook `didDrawPage` **no tiene mutación y está escrito por qué**: el lienzo falso no pagina, así que ninguna aserción de ahí podría verla — se verificó aparte, a mano, con una tabla de 70 renglones. **Las tres secciones que faltaban ya están escritas:** la 3 y la 7 en el #125 (las dos curvas) y la 5 en el #126 (el resumen fotográfico 80/20). | CERRADO |
| 124 | **Nueve frases del reporte QUE SE ENTREGA AL CLIENTE salían ilegibles, y 107 bancos en verde no podían verlo.** Las fuentes estándar de jsPDF sólo codifican **WinAnsi**. Una cadena con cualquier otro carácter **no se dibuja mal: se re-codifica entera** a UTF-16BE sin BOM, así que los bytes del PDF llevan `Avance ≥ 75%` como `Avance "e 75%` —`≥` es U+2265, o sea 0x22 0x65— y **la palabra «Avance» también deja de ser legible**, comprobado byte a byte contra el jsPDF de verdad. En el papel del cliente: `✓ PAGADA`, `Avance ≥ 75%`, `Operación → Nómina`, `Planeación → Programa`. Y **toda cifra negativa de los dos documentos**, porque `MXNS` escribe el menos con U+2212. **Por qué ninguna prueba lo vio:** las 107 miran la **cadena de JavaScript**, y el destrozo pasa después, al serializar — el defecto vive entre la cadena y el byte, donde no había nadie. Lo encontró el preview. **Arreglo en un solo portón:** `textoImprimible` sustituye por texto llano (`→`→`->`, `≥`→`>=`, `✓`→`OK`, `−`→`-`, …) y `blindarTextoDelPDF` envuelve el `doc` —`text`, `autoTable`, `splitTextToSize` y `getTextWidth`—, que es lo contrario de sanear en cada sitio que escribe: entre los dos generadores hay **362 llamadas** y `autoTable` coloca sus celdas él. Lo que la fuente **sí** escribe no se toca: acentos, eñe, `·`, `€`, `–` y las comillas tipográficas pasan intactos, y en la hoja **no queda una palabra desacentuada**. Un carácter sin sustituto sale como **`?` y no se borra en silencio**: en un documento que se firma, una cadena adelgazada sin avisar es peor que un signo raro. Van como `const` de nivel superior y no como `function` porque el preludio de `taller-de-app.cjs` resuelve las dependencias siguiendo los `const` — como `function` la suite salió **NO ARRANCÓ**, no en rojo. `scripts/lienzo-pdf.cjs` se hizo **fiel al blindaje** (su `Proxy` contesta primero lo que el generador instaló encima): un doble que devuelve la cadena original mide un documento que no es el que se imprime, que es exactamente el error que el portón viene a tapar. Banco nuevo `prueba-el-pdf-escribe-lo-que-se-lee.cjs`: **19 aserciones, 11 mutaciones en ROJO**, barriendo las 416+198 cadenas y las 146+84 celdas de los dos documentos; la mutación que importa es la que **le quita el bloque alto de Latin-1 y desacentúa el español**, porque sin ella el barrido pasaría encantado. Una mutación dio **0 en rojo dos veces** y el hallazgo vale: ningún generador le pasa nunca una **lista** a `doc.text` (medido: 0 listas contra 248 y 114 cadenas, porque el ayudante `T` del interno hace `String(...)`) — **esa frase es FALSA y el #125 la corrige: la medición estaba contando el síntoma del defecto que `T` tenía**, no un hecho del código —, así que se agregó la §D —aserciones directas contra el portón con un `doc` de juguete— **en vez de borrar código correcto o dejar una contraprueba que no muerde**. El banco #101 pasó a ROJO con razón: pedía el menos U+2212 **en la hoja**, donde ya no puede estar; su expectativa se enrutó por el propio `textoImprimible` del generador —no por un `'-'` tecleado— porque lo que afirma es que la cifra **sale con signo**, no cuál es el glifo. **Verificado contra el jsPDF de verdad en el preview**, no contra el doble: las cinco frases del hallazgo aparecen **literales** en los 167,913 bytes del reporte y los 45,617 del interno, cero cadenas ilegibles de 578 y 189, y ninguno de los cuatro pares de bytes delatores. Suite 108/108. **Pendiente de un patrón más ancho:** el corredor de contrapruebas sólo comprueba `mutado === src`, así que un mutante de varios `.replace` cuyo segundo no case pasa el filtro sin avisar — toca endurecerlo en todos los bancos. **Desplegado el 2026-11-10 lo que le pasaba al usuario** (las nueve frases ya salen legibles en producción), y **PARCIAL a propósito**: el corredor de contrapruebas sigue con el `mutado === src` en **todos** los bancos que lo usan, así que lo único que queda roto seguiría roto y `CERRADO` lo borraría de la vista. **Cerrado el 2026-11-10, y la cola de este renglón estaba equivocada.** Al medirla en vez de creerla: **ninguna mutación del repositorio encadena `.replace` sobre el fuente** —cero, de 187 anclajes en 64 bancos—, así que el mutante a medias que este renglón denunciaba era un peligro latente, no un defecto vivo, y `mutado === src` alcanza para un cambio solo. Lo que sí estaba vivo era **otra cosa que este renglón no nombró**: `scripts/pruebas.cjs` lanza cada banco **sin argumentos** y 46 de las contrapruebas sólo arrancan con `--contraprueba`, luego **`npm test` no las corre nunca**. De las cuatro formas de que una contraprueba deje de proteger algo, una llega **sola con el tiempo** —el fuente se mueve y el anclaje deja de casar— y nadie estaba mirando. Costó un hallazgo real: `prueba-la-marca-se-lee-no-se-teclea` anclaba en `if (obra.ubicacion) T(obra.ubicacion, ML, 82);` mientras `src/App.jsx` ya decía `textoCapturado(obra.ubicacion)`; su contraprueba llevaba **en 7 de 8** desde que entró `textoCapturado`, y la suite todo ese tiempo en verde. Reapuntada, vuelve a morder con 2 aserciones. **Lo que se hizo:** `scripts/contraprueba.cjs`, un corredor para todo el repositorio —estaba reimplementado 51 veces, con **once formas distintas** del mismo bucle y **22 bancos sin guarda alguna**— que separa lo barato de lo caro: `revisarAnclajes` es estático y clasifica las cuatro (PARCIAL, AMBIGUA, RANCIA, MUDA), y `correr` gasta procesos sólo a pedido, porque las 64 contrapruebas no caben en la suite (medido: entre 3 s y 74 s cada una). Y `prueba-ningun-anclaje-apunta-al-vacio.cjs`, que mete en `npm test` **la mitad que se podre sola**: comprueba que los 186 anclajes sigan existiendo en algún archivo, en un banco y no en 64 parches. **No resuelve qué fuente muta cada banco, a propósito:** el primer intento adivinaba y publicó 46 falsos positivos, se borró sin reportar sus números, y la pregunta que quedó es la que se puede contestar sin adivinar —si el anclaje no está en ningún archivo, no está en el que el banco muta—; un anclaje que se **mudó** de archivo no se detecta, y se dice en la cabecera en vez de insinuar que sí. Los dos bancos nuevos traen contraprueba propia (8 y 6 mutaciones en ROJO), y la del corredor **muta el corredor mismo**, incluida la que devuelve el filtro viejo. Dos defectos propios los encontró el banco antes de que yo los reportara: el banco de juguete afirmaba `suma() === 7` cuando `Math.round(3.5)` es 4, y el recorrido del repositorio usaba `return` donde iba `continue`, así que `package-lock.json` —más de 4 MB, y antes que `src/` en el orden del directorio— abortaba la carpeta raíz y **178 anclajes vivos salieron reportados como rancios**; de ahí salió el suelo de fuentes, porque los suelos que tenía cubrían los bancos y los anclajes pero **no la entrada que se rompió**. | CERRADO |
| 125 | **Las dos curvas del documento interno (sec. 3 y 7) — y un párrafo que salía pegado con comas y se iba de la hoja en LOS DOS generadores.** Las secciones 3 y 7 salen del **mismo** `bloqueDeCurva`, no de dos dibujantes: lo que cambia entre «la gráfica única» y «la misma obra, como la ve la dependencia» no es el trazo, son **las series que cada quien tiene derecho a ver**. `curvaUnicaDeObra` lleva gasto y margen; `curvaDeGobierno` **no los lleva, y no por un `if` que los oculte**: devuelve un objeto que ni siquiera tiene las claves `gasto`, `margen`, `utilidad` ni `costo`, y el banco afirma esa ausencia sobre el objeto —preguntarle a la gráfica si pintó la línea sería preguntarle a la cerradura si está cerrada, el error que ya mordió en el #51—. Lo que la dependencia **sí** ve es lo suyo: avance, programa y **pagado al contratista**, que en producción suele ser **un punto solo** (una estimación pagada y nada más), así que se dibuja como punto con su nota al pie y no como una recta que insinúa una tendencia que no se midió. Las series que faltan van en **tabla de ausentes con su motivo escrito**, el mismo principio del #123: un hueco sin explicación en un papel que se firma se lee como un cero. **Ninguna cifra nueva** — todo sale de las cuentas que ya existían. **Y el defecto que encontró el preview, otra vez, no una prueba.** El preludio de la sección 3 salía **fuera del papel por la derecha**: el ayudante `T` de los generadores hacía `doc.text(String(s), …)`, y `splitTextToSize` devuelve un **arreglo** — `String(['uno','dos'])` es `'uno,dos'`, así que los renglones se pegaban **con una coma** en una sola línea que se sale de la hoja. No es estética: el final de la frase no está en el papel. Sólo pasa en los párrafos que de verdad se parten en dos, o sea **los largos: justo los que explican cómo leer una cifra**. Estaba en `generarPDFInterno` **y en `generarPDFObra`, el que recibe el municipio** (el nombre de la obra en la portada, y el bloque de la derecha), así que se arregló en los dos — el patrón se arregla en todo el repo, no en el renglón que falló. **Por qué 109 bancos no podían verlo:** el `splitTextToSize` del lienzo de mentira devolvía `[String(t)]`, un solo elemento — con un elemento `String(arreglo)` es idéntico a la cadena, o sea que **el doble no sabía distinguir un generador correcto de uno roto**, para ningún párrafo partido del repositorio. Es el mismo hueco del #124 en otro sitio: la prueba miraba un documento que no era el que se imprime. **Arreglo del doble:** `scripts/lienzo-pdf.cjs` declara un modelo de ancho (`0.5 em` por carácter, mm contra puntos), parte por palabras de verdad, registra en `pegado` cuántos renglones era cada cadena que alguien vuelva a aplastar, y guarda `ancho`, `x` y `align` de cada renglón. Es **un modelo y se dice que lo es**: puede afirmar «cabe con holgura» o «se sale por el triple», no el milímetro. Dos bancos se pusieron en ROJO con razón al partir los párrafos —buscaban frases que ahora cruzan un salto de renglón— y se arreglaron con `textoCorrido`, que **reconstruye el párrafo por geometría** (misma página, misma `x`, mismo tamaño, salto de línea ≤6 mm) y no por un identificador, porque los generadores a veces pasan el arreglo entero y a veces recorren renglón por renglón en un `forEach`: agrupar por identificador perdía la última palabra. **No se bajó ninguna aserción para que pasaran.** Cobertura nueva §E y §I: que **algún** párrafo se parta de verdad (cero querría decir que alguien los pegó antes), que ninguno se dibuje con `pegado > 1`, y que **ningún renglón alineado a la izquierda termine pasado el borde de la hoja**. La mutación de `T` **sobrevivió en el primer banco donde se puso** y el hallazgo vale: el nombre de obra de ese fixture era corto, nunca se partía, y pegado igual cabía — la cobertura se mudó al banco cuyo propósito ya era ése (#124) y el fixture se alargó a un nombre que **sí** se parte en la portada. Un control usó `process.exit(2)` y convirtió un mutante vivo en **NO ARRANCÓ en vez de ROJO**; se bajó a un `ok()` normal, porque «no partió nada» **es** el defecto y tiene que salir rojo, no gris. Bancos: `prueba-las-dos-curvas-en-el-papel.cjs` **60 aserciones, 25 mutaciones en ROJO**; `prueba-el-pdf-escribe-lo-que-se-lee.cjs` **25 y 13**. **Verificado contra el jsPDF de verdad en el preview, no contra el doble:** 8 páginas, 84,507 bytes, **cero textos pasados del borde en ninguna de las 8** y cero comas pegadas; vistas a ojo la hoja 3 y la 8, con «Pagado al contratista» como punto único y sin rastro de gasto ni margen en la de la dependencia. Suite 109/109. La sección 5 la cerró el #126 (el resumen fotográfico 80/20) y la **A.6** del #122 la cerró el #127 (el hueco de riesgo se ve en pantalla). | CERRADO |
| 126 | **La sección 5 del documento interno: el juicio sobre las fotos, no las fotos — y el porcentaje que el papel del cliente se niega a imprimir.** Última sección del mandato que faltaba escribir (#125). **No es un álbum**, y lo dice en su primer párrafo: las fotos van en el reporte que se entrega al cliente; aquí va lo que aquel papel no puede llevar. **Ninguna cifra nueva**: todo sale de `seleccionFotografica`, la misma cuenta que el reporte del cliente usa para decidir qué enseña, de modo que los dos documentos no pueden discrepar sobre cuántas fotos respaldan qué. **La sección se diseñó desde la medición, no al revés** (`scripts/medir-el-resumen-fotografico.cjs --prod`, sólo lectura, 2026-11-10, 7 obras vivas), y cada bloque existe porque hay obras que lo ejercen. **El porcentaje se publica aquí y allá no, a propósito:** debajo del piso del 50% el reporte del cliente dice «la evidencia fotográfica no alcanza» y se queda ahí —un porcentaje suelto debajo del piso se lee como una medición cumplida—, pero hacia adentro ese número **es** lo que decide a dónde se manda a fotografiar, porque una obra en 45% y una en 0% necesitan cosas distintas: hoy son **3 de 7** (0114 45.4%, 0125 0.0%, 0131 0.0%). Y el papel **declara la diferencia en el papel**, así que quien compare los dos documentos no concluye que uno de los dos está mal. **El respaldo que no se puede atribuir:** la **0112 tiene la mejor cobertura de la cartera, 94.6%, sostenida en 270 fotos de las que NINGUNA tiene autor** — se subieron antes de que la app registrara quién tomaba cada foto, y ese dato no se puede reconstruir. Publicar el 94.6% callándolo afirma un respaldo que no se puede acreditar; decir «no hay respaldo» sería la mentira contraria, así que el párrafo **separa las dos cosas**: la cobertura es real, lo que no hay es a quién atribuírsela. Son 3 de 7 obras, y el texto distingue las tres formas (todas de archivo / mezclado con su conteo / todas capturadas en la app), porque acusar de más a una obra que sí capturó parte es un error distinto. La frase de origen la redacta `fraseOrigenEvidencia`, no la sección. **«N de M», nunca «N»:** el reparto tiene tope de 15 y **5 de 7 obras tiran fotos** —la 0114 enseña 15 de 304—, así que imprimir «15» a secas manda a campo a una obra cuyo problema es que sus fotos no se ven; el papel dice cuántas hay guardadas y que **lo que le falta NO es tomar más fotos**. **La lista de trabajo son los huecos del corte del 80% y nada más**, con clave, nombre, importe y peso: **7 de 7 obras tienen huecos** (la 0125 y la 0131, las 34 y las 11 del corte). Y si no hay huecos **lo dice** —una tabla ausente se lee como una sección que se olvidó de imprimirse, no como una obra limpia—. **Sin lectura no se publica ningún número:** `evidenciaCargada` entra como dato y por omisión vale `false`, por la misma razón que `estCargadas` — `fsColl` devuelve `[]` cuando la regla niega o la red falla, así que una lectura fallida y una obra sin fotos llegan idénticas; deducirlo de `evidencia.length` publicaría «0% · la evidencia no alcanza» sobre una lectura **denegada**, que es una acusación con cifra inventada. Ahí la sección declara que **no se pudo medir** y dice qué NO lo arregla, porque los dos motivos de no-medible piden cosas opuestas y confundirlos manda gente a campo de balde. **Dos conductas candidatas se cortaron por no tener un solo caso**: avisar de huérfanas (0 de 7 obras; sería código nuevo para una hipótesis). La de **cobertura NO MEDIBLE tampoco tiene caso en producción y SÍ se escribió**, porque ahí `pct` es `null` y los tres estados obligan a decirlo; la prueba es lo único que la ve, y la ve con un caso que trae la lista **llena** y la bandera en falso. Banco nuevo `prueba-el-resumen-fotografico-en-el-papel.cjs`: **50 aserciones, 18 mutaciones en ROJO**, con cuatro casos con la forma de cuatro obras reales (0114 debajo del piso y mezclada, 0127 en la banda media y toda verificada, 0112 arriba del techo y toda de archivo, y la lectura fallida). **Dos mutaciones sobrevivieron y las dos valieron.** Una: la aserción del corte del 80% buscaba el entero **como subcadena** en toda la sección, y un «4» aparece también en un importe y en «4 de 6 partidas con foto» — se cambió por la **geometría del recuadro** (`kpiBox` pone la etiqueta en mayúsculas y el valor en la misma `x`, 8 mm abajo), que habla de ESE recuadro y de ningún otro. Otra: la lista de trabajo se comprobaba sólo contra las partidas pequeñas **sin foto** de fuera del corte, y eso deja dos formas de alargarla sin que nadie se entere — ahora se afirma contra **toda** partida de fuera del corte (con foto o sin ella) y además contra las del corte que **sí** tienen foto, porque acusar de no tener evidencia a una partida que la tiene no es una lista larga: es una lista falsa. Cada una con su mutación. El banco #125 pasó a ROJO con razón: afirmaba que la 5 **no existía**, que era verdad cuando se escribió; su aserción se invirtió a lo que ahora protege —que **una sola** sección lleve el número 5—, porque un 5 repetido es la misma mentira que el hueco tapado, nomás al revés, y su mutación (renumerar la 7 a 5) sigue en rojo. **Verificado contra el jsPDF de verdad en el preview, no contra el doble**, con el emulador sembrado: 9 páginas, la sección entra completa en la hoja 6, nada pasado del borde; y **las cinco cifras impresas se cotejaron contra una medición independiente de los mismos datos** (46.3%, corte de 10, 5 sin foto, 14 de 14, «14 de archivo, sin autor»), que es lo que impide que la sección publique una cuenta propia. Suite 110/110. Con esto el mandato del PDF queda escrito entero; sigue faltando la **A.6** del #122 (el panel de riesgos de la pantalla sólo pinta `detectados`, así que NO EVALUABLE es invisible). **La A.6 la cierra el #127.** | CERRADO |
| 127 | **A.6 — el peor caso era el único invisible: cero riesgos detectados y veintitantos sin medir no pintaba NADA.** El #120 le enseñó al motor a decir «no sé» y el #123 lo imprimió en el papel interno, pero la pantalla seguía pidiendo `detectados` y nada más, así que el NO EVALUABLE existía y no se veía. Peor: la guarda del tablero era `riesgos.length > 0`, de modo que una obra con **0 disparos y 22 huecos no pintaba ni la tarjeta** — el silencio más completo caía justo donde menos se había medido. **Medido antes de escribir** (`medir-los-riesgos-que-nadie-pudo-evaluar.cjs --prod`, sólo lectura, 2026-11-10, 7 obras vivas): se callaban **76 reglas no evaluables contra 29 detectadas**, y no es una cola rara — **las 7 de 7 obras tienen huecos**, entre **8 y 16** cada una, contra **3 a 5** que disparan. La pantalla enseñaba un cuarto de la respuesta y el resto se leía como tranquilidad. **Se agrupa por DATO, no por regla**, y la medición es la razón: un solo dato tumba hasta 3 reglas en producción (6 en el emulador, donde la corrida de GP no incluye la obra), así que una fila por regla haría el panel de los huecos **más largo que el de los riesgos que sí disparan** — y lo que se arregla es el dato, no la regla. **UNA CUENTA POR NÚMERO, y por eso NO se publica un conteo por dato:** una regla puede estar tumbada por dos datos a la vez y las hay, de modo que la suma de los grupos es mayor que el número de reglas sin medir (en el caso del banco, 28 reglas contra 43 apariciones). Dos cuentas del mismo hecho que pueden discrepar es un defecto esperando: el único número que sale a pantalla es `noEvaluables.length` y los grupos **nombran, no cuentan**. **Un hueco no lleva severidad:** la insignia va en `C.textMut` y nunca en rojo —un hueco no es un hallazgo—, pero el acento **deja de ser verde** en cuanto hay uno, porque el verde es precisamente la mentira que el #120 vino a destapar. Y con cero disparos la tarjeta cambia de título a «Qué no se pudo medir» en vez de afirmar que no hay nada. La frase impresa es la tesis entera: *una lista de riesgos vacía no significa que no haya riesgo*. **`reventaron` se pinta aparte y rotulado como defecto nuestro, no hueco de captura** — juntarlos haría pasar nuestro código roto por falta de dato del cliente. **0 de 7 obras lo ejercen en producción: se escribe sin un solo caso que lo respalde y la prueba es lo único que lo va a ver**, y queda dicho aquí para que nadie lo tome por conducta medida. **`detectarRiesgos` se borró en vez de dejarse como atajo**, porque el atajo **era** el defecto: mientras existiera, la manera fácil de preguntar seguía siendo la que devuelve un cuarto de la respuesta. Tenía exactamente dos llamadores y cuatro bancos lo usaban; los cuatro pasaron a `evaluarRiesgos(...).detectados` —el patrón se arregla en todo el repo, no en el renglón que falló— y la **§F de `prueba-tres-estados-del-riesgo` se invirtió en vez de borrarse**: afirmaba que el atajo existía, y ahora afirma lo que sobrevive al cambio, que los que disparan nunca son toda la respuesta. **Las dos pantallas comparten el MISMO componente** (`PanelSinDato`), no una copia, porque dos paneles que dicen lo mismo con dos códigos es la forma larga de que un día digan cosas distintas. **La frontera de la dependencia aguanta y se afirma en los dos sentidos**: ningún dato de la economía del contratista —nómina, almacén, maquinaria, la corrida de GP, subcontratos, la serie del margen— se nombra del lado del municipio **ni siquiera como «te falta capturar»**, y el banco comprueba además que **sí** aparecen del lado de la constructora, para que la aserción discrimine en vez de pasar por vacía. Banco nuevo `prueba-el-hueco-de-riesgo-se-ve.cjs`: **36 aserciones, 11 mutaciones en ROJO**, con los fixtures sacados del motor y no inventados, y con la guarda del tablero **extraída del JSX y ejecutada** —no leída—, que es la única forma de afirmar que la tarjeta pinta con cero detectados. **El ancla del banco agarró la función equivocada y el hallazgo vale:** cortar por el rótulo «INDICADORES DE RIESGO» a secas también casa con el encabezado de la sección 6 del documento interno, que vive dentro de `generarPDFObra`, aparece **más arriba** en el archivo y es `async` — el banco renderizaba una **promesa** y caían 7 aserciones. Se arregló **afinando el ancla** (la etiqueta de cierre, nada de `async`, y **exactamente una** coincidencia o NO ARRANCÓ), no bajando ninguna aserción. **Verificado en el preview con el emulador sembrado, los dos lados:** el Colector Malecón publica «20 reglas sin dato» y nombra **20 reglas distintas** —2 + 20 + 10 = 32, la biblioteca entera—, con la insignia en gris y el acento en `#B84204`; y la MC-OP-2026-001 del municipio **pinta la tarjeta con cero riesgos arriba**, 3 huecos, acento gris y **cero fugas** de la economía del contratista. Suite 111/111. | CERRADO |
| 128 | **Cerrar una obra: que no se pueda mover, que siga contando el año, y que se note.** Cuatro ramas de una misma pedida. **A** — el estado se guarda o no se promete: `guardarEstadoDeObra` escribe `config/info` **antes** que el documento raíz, porque la hidratación hace ganar a `config/info` y al revés la pantalla decía «cerrada» sobre una obra que seguía abierta. **B** — el candado vive en la regla: las 19 rutas de `/obras/` miran `obraCerradaC(obraId)`, con `soloMueveElEstado()` como única excepción y `allow delete` negado sobre una obra cerrada. **C** — lo facturado del año con **su hueco declarado**: `FACTURADO 2026` sólo suma estimaciones con fecha de factura y publica aparte las que no la tienen, partidas en **4 huecos reales y 4 que todavía no vencen**, como alarma para corregir o terminar el proceso; archivar una obra baja la cifra y la tarjeta **dice que la bajó**, verificado en el preview ($26.7M → $22.5M con su nota). **D** — la pantalla no ofrece ni afirma lo que la regla niega: el modal decía «Tu captura de avance SÍ quedó guardada» sobre una captura rechazada, y los controles seguían a la vista. **Reabrir queda registrado** (decisión suya) y **archivar persiste**, como nace cerrar. Bancos nuevos `prueba-el-estado-de-la-obra-se-guarda`, `prueba-reglas-obra-cerrada`, `prueba-lo-facturado-del-anio` y `prueba-la-pantalla-no-ofrece-lo-negado` (**53 aserciones, 18 mutaciones en ROJO**). Suite 115/115. **Las reglas de B se desplegaron el 2026-11-10** (ruleset `3c929abe` → `7aebb2a1`, con `--project produccion`), así que el candado ya muerde en producción por cualquier camino y no sólo en el repo. **Medido antes de disparar y verificado después**, no supuesto: contra lo vivo eran 7 renglones quitados y 100 puestos —26 de código y **ningún `match /` entra ni sale**, o sea que nada se abre, sólo se cierra—, y al releer el ruleset vivo sale idéntico al archivo byte a byte. **Y el front, el mismo día y después de las reglas** (`2aec5be..e67ec7e`, 46 commits, bundle vivo `assets/index-1b422b85.js` con el SHA256 idéntico al build local). Los cuatro canales en 0. **El orden importó y se respetó:** cuando se desplegaron las reglas el candado estaba armado y vacío —las 7 obras de producción decían `activa` en el documento raíz **y** en `config/info`, catorce lecturas, y `guardarEstadoDeObra` no existía en `origin/main`, así que nadie podía cerrar nada y la regla no le negaba una escritura a nadie—. Al revés habría sido el #31: la pantalla ofreciendo cerrar contra una regla que no existe. **El canario se midió en los dos sentidos:** entraron «no admite capturas ni cierres de semana» y «sin fecha de factura: fuera del año», y **salieron** «Plazo transcurrido», «Estimado acumulado» y «Semanas p/ facturar todo», las tres cifras que el #118 dejó de afirmar. | CERRADO |
| 130 | **Había tres papeles para dos lectores, y el tercero se llamaba como ninguno.** `generarPDFObra` —el «reporte ejecutivo»— decía casi lo mismo que el documento interno con criterios opuestos sobre el mismo hueco, y era el único que una dependencia podía apretar, así que el lector equivocado descargaba el papel equivocado. **Hecho el 2026-11-12:** se retiró el generador entero y con él `vaElReporteEjecutivo`, `estActivas`, `obra.ubicacion`, `B.empresa`/`B.dominio`, `hoyD` y `fmtDDMMM`; quedan **dos** papeles, uno por lector, y `papelDeLaObra(usuario)` decide **cuál botón existe** en vez de cuál se esconde —una bandera dentro de un papel único deja la economía del contratista a un `if` de distancia del expediente municipal—. **El sello interno se queda, y ahora contesta:** la banda de las 8 hojas interiores dice «EL QUE SE ENTREGA ES EL INFORME DE AVANCE» y la portada lo nombra con su artículo, porque una prohibición sola —«no mandes esto»— deja a quien la lee sin saber qué mandar. Los dos generadores toman todo **por nombre**, así que se borró el `dibujarPDF` posicional de quince argumentos en el que había que contar comas hasta el decimoquinto para pasarle `instante`; medido que ningún banco lo llamaba antes de borrarlo. **Las pruebas no se aflojaron, se reapuntaron, y al reapuntarlas cayeron dos afirmaciones muertas:** las tres mutaciones del PDF de `prueba-un-numero-que-nadie-midio` apuntaban a un rótulo de estimación que **ningún papel imprime ya** —medido: cero textos que empiecen con «EST-» en los dos—, y las de `prueba-la-marca-se-lee-no-se-teclea` apuntaban a campos que no existen en el archivo. En vez de bajar la vara se subió: la marca ahora exige una firma del producto **por hoja** (la portada en orden no dice nada de la hoja 6, que es la que queda sobre el escritorio) y el número exige que el **dinero** de una estimación sin número sobreviva al total publicado, que era la mitad viva del defecto original. Verificado contra jsPDF **real** en el preview, no contra el lienzo: interno 9 hojas firmadas, Art. 73 9 hojas firmadas, y el único `FOSMON` del papel interno llega **por parámetro** desde la sesión (`Organización:` y `Generado por:`), no tecleado en el generador. Suite **118 en verde**. | CERRADO |
| 131 | **El total de las estimaciones se cuenta DOS VECES, con dos robusteces distintas, y los dos papeles salen el mismo mes sobre la misma obra.** Salió al reapuntar las mutaciones del #130: el informe del Art. 73 lo saca de `corteDeEstimaciones` (`parseFloat(e?.monto) || 0`) y el documento interno de `estTotal` dentro de `calcularKPIsObra` (`e.monto || 0`), que **no** lee un monto guardado como texto. **Y al abrirlo no eran dos cuentas: eran cinco criterios de «pagada»/«por cobrar» y cuatro lecturas del monto.** **Lo que estaba vivo, medido contra producción el 2026-11-13 y no latente:** el KPI «por cobrar» de la obra contaba facturada + aprobada + lo que diga «proceso», y la tarjeta de riesgo `fin_004` —que se pinta **en esa misma pantalla**— se había quedado con la definición vieja, `['Facturada','Aprobada']`, coincidencia exacta y sin «En proceso». En la **0126** eran $53,523,612.95 contra $33,399,787.90 y la tarjeta decía «medio (62%)» donde correspondía «ALTO (100%)»; en la **0128**, $3,944,641.77 contra **$0.00** y la tarjeta **no se pintaba** — $24,068,466.82 de diferencia y **veredicto distinto en las dos obras**. La de la 0128 es la peor: una tarjeta que no se pinta se lee como tranquilidad, igual que el hueco del #127. Los otros tres criterios: el `porCobrar` de la propia pantalla de Estimaciones con su literal, el `factur` de la vista de cliente y, en `functions/index.js`, el `cobrado` que el correo de dirección publica, decidido con la **subcadena** `/pagada|cobrada/i` — que cuenta «No pagada» como cobrada. **Hecho el 2026-11-13:** seis lecturas únicas (`montoDeEstimacion`, los cuatro predicados y `sumaDeEstimaciones`) y todos los sitios migrados, con la copia literal espejada en `functions/index.js` porque no hay build compartido. **Dos diferencias NO se unificaron, y por qué:** la pantalla de Estimaciones publica el **neto** (`cE(e).ef`) donde el tablero publica el **bruto** —mismo criterio, otra pregunta, y lo dice la etiqueta—; y el `factur` de la vista de cliente deja fuera «En proceso» porque ahí los cinco KPIs son una **partición** y meterlo en dos los haría sumar más que el contrato. El subcontrato conserva el suyo: su vocabulario es «Autorizada» y su dinero es **por pagar**, no por cobrar. **El monto guardado como texto sigue siendo latente —cero casos en producción, los tres sitios de captura escriben números— y se afirma igual**, porque las cuatro formas viejas fallan distinto y las cuatro son lo que alguien teclearía: `parseFloat("1,500.00")` da **1** (que no se ve como error, se ve como una estimación chica), `(m||0)` **concatena** —1500+2000+800 habrían salido $15,002,000,800 en vez de $4,300— y el monto crudo envenena la suma a `NaN`, que `MXN` imprime como «$0». **Queda un hueco escrito y sin tapar: un monto ilegible se cuenta como 0 y nada en la pantalla lo dice.** Banco nuevo `prueba-el-dinero-de-una-estimacion.cjs`, **30 comprobaciones en verde**, con las dos obras de producción como fixture —documentos reales, no cifras de ejemplo— y el método en el centro: se extrae por AST la expresión **real** de cada uno de los 10 sitios de pantalla, se ejecuta, se vuelve a ejecutar con la lectura **mutada** inyectada y se exige que **todos** se muevan; un sitio que no se mueve trae su propia copia aunque su número de hoy sea correcto. **Cuatro contrapruebas, cada una devolviéndole su copia a UN sitio:** `fin_004` → **8 en rojo** reproduciendo los números de producción; el `porCobrar` de la pantalla → **1 en rojo**, y el rojo dice «$28,389,819.71 → $28,389,819.71», o sea que **no se movió** — ése es el rojo que sólo da este método, comparar contra un número teclado habría pasado en verde; `montoDeEstimacion` → 2; el `cobrado` de `functions` → 1, «correo $5,000.00 vs pantalla $0.00». El andamiaje de extraer-y-ejecutar se sacó a `scripts/expresion-de-pantalla.cjs` en vez de copiarlo al segundo banco: es la misma clase del #139, y `prueba-una-cuenta-por-numero` ya corre sobre él con sus mismas 32 en verde. **Verificado en el preview con el emulador sembrado**, y la siembra tuvo que estrenar una estimación **en proceso** —la forma de la 0128 de producción— porque con lo que había el «por cobrar» no llegaba al 30% y el defecto no se podía mirar en ninguna pantalla: la 0128 publica ahora «POR COBRAR $12,000,000 · neto de aprobado, facturado y en proceso» y la tarjeta «$12,000,000 de $16,200,000 estimado · 74%». Con las definiciones viejas y **esos mismos datos** —medido, no supuesto— la pantalla decía **$0** con $12M en proceso a la vista y la tarjeta **no se pintaba**. **Dos contrapruebas de otros bancos dejaron de morder, y las dos se reapuntaron al defecto que SÍ sigue siendo posible, no se bajaron.** En `estimaciones-dependencia`, cambiar `ESTATUS_PAGADA` a «Pagado» ya no corta el cable A→B: desde que el corte decide con `esEstimacionPagada`, la constante mueve **las dos puntas a la vez** y el cable sigue entero, así que la mutación salía en verde **con razón**; la nueva le devuelve a la lectura su propio literal mal escrito, que es el defecto que de verdad hubo. En `un-numero-que-nadie-midio`, las **cuatro** mutaciones de los dos papeles son ahora **tres**: las dos de sitio de llamada siguen siendo una por papel —los sitios siguen siendo dos—, y las dos de veneno se volvieron una sola sobre `montoDeEstimacion`, que sale en **2 rojos**, uno por papel. Ésa es la aserción nueva: romper la lectura única tiene que poner rojos a **los dos**; si mordiera uno, seguiría habiendo dos cuentas. | CERRADO |
| 134 | **De enero a marzo la curva de gasto dibujaba $0 en las semanas del año que ya cerró, y el Margen publicaba el ejecutado entero como ganancia.** El Sheet del GP detalla por semana SÓLO el año en curso y de los años cerrados publica un total; `ultimoGPHasta` devolvía un **0 literal** para toda semana sin delta anterior. Nueve meses al año no se nota, porque la ventana de doce semanas cae entera dentro del año en curso — por eso vivió escondido. Medido con el reloj en el 2027-02-15 sobre una obra con $30M en el año cerrado: `$0, $0, $0, $0, $0 → $30,400,000`, y en esas cinco semanas había ejecutado capturado, así que el margen salía igual al ejecutado. Ahora la semana de un año cerrado sale **sin medir** —un total sin reparto no se reparte— y la semana del año en curso previa a la primera delta arrastra el total de los años cerrados, que sí es cifra medida; sin años cerrados esas mismas semanas siguen valiendo un **cero medido**, que es el canario del arreglo. Banco: sección 9 de `prueba-las-dos-curvas-y-un-eje.cjs`, con el reloj congelado en febrero y cinco mutaciones. **No arregla el #47 (el año de la semana se pierde)**: el origen sigue escribiendo `S42` sin año, y mientras siga así el reparto de un año cerrado no existe en el documento — lo que se quitó es la mentira, no la falta. | CERRADO |
| 135 | **El documento interno decía que no puede medir la tendencia del margen y dos renglones abajo la publicaba.** La página 4 imprimía en negritas «3 semanas seguidas con las dos líneas en el mismo corte» —el motivo que la propia cuenta redactó para declararse insuficiente, porque el reporte pide 4— y al lado «4.6% -> 2.2% · -2.4 pp en el tramo»; tres notas más abajo el mismo papel admitía que ese tramo no alcanzaba. Lo que se le queda al lector es el titular, no la nota. **Hecho el 2026-11-12:** el titular y el recorrido quedan detrás de `cm.suficiente`, y cuando no alcanza lo **primero** que se lee es el motivo, delante de las cifras; el recorrido no se publica en ninguna parte —ni de cuánto a cuánto ni en cuántas semanas—. La **tabla sí se dibuja**: cada renglón es una semana medida y se lee sola; lo que no existe es el trayecto entre la primera y la última. Se borró la nota de abajo que se desdecía. **La aserción no se colgó del calendario:** la §C ya tenía una rama para el tramo corto, pero sólo muerde las primeras ~3 semanas de enero (#136), y una aserción que corre tres semanas al año no corre. El caso nuevo acorta el tramo por el lado del **avance** —el primer corte cae en la penúltima semana, así que `margen` arranca ahí y la cola mide dos cualquier día del año—, con precondición que sale en **NO ARRANCÓ** si el caso deja de ser un tramo corto y real. El motivo se busca **en su sección**, no en la hoja: la §6 imprime el mismo texto como «por qué no se pudo medir», y buscándolo en todo el documento la mutación que lo borra de la §4 salía en **verde**. Banco: 47 en verde, 19 mutaciones todas en rojo. **Verificado en pantalla**, las dos mitades en la misma corrida del emulador: la 0121 con 3 semanas publica el motivo y ni el titular ni el recorrido; la 0114 con 7 publica «7 semanas seguidas…» y «86.6% -> 61.5% · -25.1 pp en el tramo». | CERRADO |
| 137 | **La cuenta de «días sin captura» se adelanta un día a partir de las 18:00 en México, y ninguna prueba lo veía porque la fixture se equivocaba en la misma dirección.** `diasSinCapturaDe` (`src/App.jsx:5657`, y su copia literal en `functions/index.js`) hace `new Date('2026-10-31')` sobre un día de calendario: el estándar lo parsea como **medianoche UTC**, y eso se resta de un instante real. A las 18:58 del 2026-11-12 —medido, no supuesto— un cierre de hace 12 días locales contesta **13**. Es el defecto del #61 (el día de la foto resuelto en el huso del aparato) en el otro sentido: el huso que falta es el de la obra, `ZONA_OBRA`, que ya existe con su `fechaEnZonaObra`. Muerde donde hay umbrales: `>7` pone el pendiente de cierre semanal y la alerta A4 se dispara por días, así que seis horas al día una obra que lleva 7 pasa por una de 8, y el correo del lunes lo imprime. Salió al arreglar el patrón de `toISOString().slice(0,10)` en las fixturas (#136): con el día local correcto, `prueba-un-numero-que-nadie-midio.cjs` sale **ROJO** a cualquier hora después de las 18:00 y en las cuatro fechas del barrido, porque el fixture dejó de compensar al producto. Ese banco **se dejó en UTC a propósito**, con el motivo y este número escritos en su código; el día que la cuenta se arregle, el fixture pasa a día local y la aserción de «hace 12 días → 12» sigue diciendo 12. Son dos archivos y la copia tiene que seguir siendo literal (#79). **Hecho el 2026-11-12:** los días se cuentan ahora en el **calendario de la obra**, de día a día, y no como periodos de 24 horas entre dos instantes. `diaDeObraDe` separa las dos formas en que viene la fecha guardada: un instante completo se resuelve con `fechaEnZonaObra`, y un día pelado **se deja como está**, porque un día ya es un día y pasarlo por `new Date` era el defecto entero. La resta va con las dos etiquetas a medianoche UTC —a dos etiquetas les da igual el huso con el que se resten mientras sea el mismo—, no por descuido del huso. La copia de `functions/index.js` se movió igual y con ella `ZONA_OBRA`/`fechaEnZonaObra`: ahí el servidor corre en UTC, así que resolver el día en el huso del proceso habría separado el N del correo del lunes del N del tablero seis horas de cada día, justo donde `>= 7` cambia de lado. **Banco:** §3-bis de `prueba-una-cuenta-por-numero.cjs`, 32 en verde, con los dos errores de signo contrario medidos por separado —el día pelado contaba **de más** (6 → 7) y el instante de la noche contaba **de menos** (12 → 11)— y la exigencia de que las dos formas del mismo día contesten lo mismo; la batería que compara los dos archivos creció a 7 casos con los dos del huso. Contraprueba: **cuatro** mutaciones sobre `src/App.jsx` —revertir la cuenta, quitarle a `diaDeObraDe` la rama del día pelado, resolver «hoy» en UTC, resolver la captura en UTC— y **una** sobre `functions/index.js` sola, las cinco con salida **1**; la de `functions` la caza únicamente la batería de los dos archivos, que es la que vigila que la copia siga siendo literal. Verde también con `TZ` en UTC, Asia/Tokyo, America/Mexico_City y Pacific/Kiritimati: la cuenta no depende del aparato. **Verificado en pantalla**, y la siembra ya traía el caso sin tocarla: la última captura de las tres obras es `2026-11-06T02:35Z`, o sea el **5 de noviembre a las 20:35 en la obra**; con el reloj del preview parado al mediodía del 12, el panel dice «hace 7 días» y las tres entran en REQUIERE ATENCIÓN. En `main` decía **6** y la lista de excepciones salía vacía. | CERRADO |
| 51 | **El avance se compara contra una recta, no contra el programa de obra.** El art. 61 hace del programa contractual la base para medir el avance, y hoy `programadoEnFecha` reparte el 100% linealmente sobre los días transcurridos: la Curva S y el KPI «Avance ideal» presentan esa recta como si fuera el programa. Son dos cosas: dejar de afirmarla (decir «no disponible», ya decidido) y poder cargar el programa real. **Medido el 2026-11-04 sobre tres programas reales con `scripts/medir-programas-de-obra.py`: los `Código` cruzan con el catálogo al 100% en los tres, así que la comparación puede ser partida por partida y no sólo una curva agregada; y la fila `Barra=` bajo cada partida da su inicio y fin en porcentaje del día del mes de calendario —verificada contra dos anclas del propio archivo—, con lo que un programa mensual se lee en cualquier fecha sin inventar la distribución intra-mes.** Hechos los cortes 1 (la cuenta), 2 (el parser, que se niega en vez de adivinar) y 3 (`config/programa`, su regla y la pantalla de carga). **Los tres anexos reales los lee la app tal como vienen (`scripts/medir-programa-real-se-lee.cjs`), con el total de los meses cuadrando al centavo contra el acumulado que cada archivo declara; donde más se separan de la recta difieren +27.3, −9.9 y −17.2 puntos — y a mitad del plazo +17.4, +0.3 y −5.9, o sea que en el colector el punto medio dice 0.3 donde el máximo dice −9.9, porque una curva S cruza la recta por el centro: medir ahí da la conclusión contraria.** La cifra de la Cangrejera estuvo mal un día: el guion de medición traía tecleado `2026-02-16` como arranque del sistema **con un comentario que afirmaba haberlo medido contra producción**, y producción dice `2026-05-07` desde el 2026-05-22. Con el arranque correcto no es +14.1 sino **−17.2: cambia de signo**, o sea que esa obra se publicaba atrasada estando al día y no al revés. Salió al medir las cinco obras para el #96 (cuadrar el alta contra su anexo); corregido el 2026-11-04 en el guion y en los cuatro sitios que citaban la cifra. **Corte 4 hecho:** `avanceProgramadoA` es la única cuenta del repositorio —antes eran CINCO copias de la recta— y devuelve además la `fuente`, que es lo que la pantalla rotula: «Avance programado · del programa contractual cargado» cuando hay anexo, «Avance lineal · sin programa cargado» cuando no. Leen de ahí la Curva S y su leyenda, el KPI, el PDF (hoja 1, su leyenda, el renglón de riesgo y el veredicto) y la alerta `avance_bajo_programa`, que decía «bajo programa» restando la recta con un umbral de 15 puntos — menor que los 27 de separación, o sea que el disparo lo decidía el error y no la obra. Sin nada contra qué medir sale `n/d`, nunca un cero. Banco `prueba-pantalla-dice-de-donde-sale-el-programado.cjs`: 21 aserciones, 8 mutaciones en ROJO. Verificado en el preview con el programa sembrado en la 0114 (programa 74.5% contra recta 85.8%) y la 0121 sin él, lado a lado. **Su regla de Firestore se desplegó hasta el 2026-11-04, con la del #98 (el anexo del municipio no tenía dónde guardarse):** se descubrió al comparar el ruleset vivo contra el repo, y hasta ese momento `config/programa` no tenía regla en producción **de ninguno de los dos lados**, así que la pantalla de carga existía y el anexo no se podía guardar. No llegó a morder a nadie porque el front con la pantalla tampoco estaba desplegado — comprobado, no supuesto: `origin/main` no contenía `CargaDelPrograma` ni `cuadreDelAnexo`. **Ya no: el 2026-11-04 se empujó `main` (`9604f9e..f73dcc5`, 30 commits) y Netlify construyó `index-986a357e.js`, comprobado por frases —`del programa contractual cargado`, `Programado (lineal, sin programa cargado)`, `y el contrato cargado dice`— y además SHA256 idéntico al build local.** El orden importó y fue el correcto: primero las reglas, después el front, porque al revés la pantalla habría estado en manos de los usuarios escribiendo contra un `match` que no existía, que es exactamente el defecto del #31 (escrituras que se evaporan sin error). `scripts/verificar-despliegue.cjs` sale 0 en los cuatro canales. El orden correcto es reglas primero y front después, que es el que se siguió. **Había una SEXTA copia de la recta y el corte 4 no la tocó: el semáforo del Dashboard.** La nota de arriba dice «antes eran CINCO copias» y era verdad del motor que se recortó; lo que no se vio es que hay **dos motores de reglas** — `ALERTA_REGLAS`, el de `PanelAlertas`, que sí se arregló, y `BIBLIOTECA_RIESGOS`, el de INDICADORES DE RIESGO, cuya regla `avc_004` seguía sacando su propio `pctPlazo` del plazo transcurrido. Medido en la 0114 el 2026-11-04: el **Dashboard publicaba −29pp** y Operación **−17pp**, la misma obra el mismo día a dos clics de distancia, que es exactamente lo que «una cuenta por número» prohíbe. Y le llegaba al **municipio**, porque `avc_004` no está en `RIESGOS_SOLO_CONSTRUCTORA`: a una dependencia se le decía que su contratista iba atrasado contra una recta que nadie firmó — y el atraso es la única cifra que una dependencia reclama. **Arreglo:** `avc_004` toma `avanceProgramadoA`, y el **título lo decide el dato, no la plantilla** (`detectarRiesgos` ahora respeta un `titulo` devuelto por el detector, como `ALERTA_REGLAS` ya permitía), así que dice «contra el programa» o «contra la recta del plazo» según con qué midió, y cuando es la recta lo confiesa en el detalle. La lectura del anexo quedó en **un solo hook**, `useProgramaDeObra`, que eran ya tres los tableros que la necesitaban: lleva dentro que `undefined` no es `null` —con `undefined` la respuesta todavía viaja y no se afirma nada; con `null` ya se sabe que no hay anexo y toca la recta, dicha con ese nombre— y quien trate los dos igual publica la recta rotulada «programa» durante el viaje, visible en cada recarga. Banco `prueba-el-semaforo-mide-contra-el-anexo.cjs`: 16 aserciones con los dos sentidos del error —el anexo que **absuelve** a la obra que gastará al final y el que **acusa** a la que ya debía estar casi lista— porque son dos defectos distintos y sólo uno se ve en la 0114; 7 mutaciones en ROJO. Una no mordía al principio y el hallazgo vale: la aserción de la frontera del margen tomaba la lista de `RIESGOS_SOLO_CONSTRUCTORA`, o sea le preguntaba a la cerradura si estaba cerrada — borrar un renglón borraba al mismo tiempo la definición de lo que había que tapar. Las 18 reglas de economía se nombran ahora **en la prueba**, más una aserción de que la lista las sigue nombrando todas aunque con este fixture no disparen. Verificado en el preview: la 0114 dice `-17pp · 75% programa vs 57% avance` y bajó de ATENCIÓN a ACEPTABLE, cuadrando al punto con el `74.5% · −17pp · del programa contractual cargado` de Operación. | CERRADO |
| 95 | **La obra 0128 (el colector) trae el contrato y el plazo de la 0131 (el emisor).** Medido el 2026-11-04 contra los programas reales: su `presupuesto` dice $27,489,778.08 cuando su catálogo y su programa suman $12,890,541.86 —$14.6M de más, el 53%—, y su plazo dice 2026-08-29→2027-02-24 cuando el programa dice 2026-08-27→2026-12-24, 120 días y no 180. Las dos cifras son exactamente las de la 0131. Consecuencia: el avance físico de esa obra sale a la mitad y su desviación se mide contra un plazo 60 días más largo. Es dato, no código; la corrección es escritura a producción. **CORREGIDO el 2026-11-04, en dos tiempos y por dos manos.** El `presupuesto` lo arregló Oscar a las 19:39Z en `obras/0128` y `obras/0128/config/info`: era un error de dedo al dar de alta, duplicó los montos del emisor en el colector. El **plazo seguía siendo el del emisor** y eso no se vio al corregir el monto, porque son campos distintos del mismo copiado; medido en solo lectura antes de tocar nada, y escrito a las 20:48Z con `updateMask` de dos campos sobre los mismos dos documentos: `inicio 2026-08-29→2026-08-27`, `fin 2027-02-24→2026-12-24`. Releído después contra un respaldo del antes (`~/Desarrollo/CAMPO-datos-produccion/respaldos/`): **cambiaron esos dos campos y ningún otro**, y la 0131 quedó intacta. Lo que mueve en pantalla: el plazo pasa de 179 días a 119, los restantes de 112 a 50, y el programado por recta al 2026-11-04 sube de 37.4% a 58.0% — veinte puntos, o sea que la obra se publicaba como cómoda cuando le quedan siete semanas. El plazo no lo rechaza ninguna validación porque es un dato que el alta acepta tal como se teclea; que esto sólo se encontrara midiendo los anexos uno por uno es el argumento del #96 (cuadrar el alta contra su propio anexo). | CERRADO |
| 96 | **Nada cuadra el alta de una obra contra su propio anexo.** El #95 (la 0128 con las cifras de la 0131) se encontró a mano, midiendo los tres programas reales uno por uno: el alta acepta cualquier `presupuesto`, `inicio` y `fin` que se teclee, y el programa de obra —que trae los tres— se carga después y no se comparan nunca. El parser de #51 (el avance contra una recta) ya extrae del anexo el total, el arranque y el fin, y ya avisa cuando el total de los meses no cuadra con el acumulado declarado; falta que avise cuando no cuadra con lo que la obra tiene cargado, y que lo diga al cargar, no en un guion de medición. No es validación que bloquee —el anexo puede ser el equivocado— es un aviso con las dos cifras lado a lado. **Hecho el 2026-11-04:** `cuadreDelAnexo` enfrenta total contra `presupuesto`, arranque contra `inicio` y fin contra `fin`, y devuelve **hallazgos, no veredicto** — cada uno con las dos cifras crudas y una frase que dice de qué lado está la diferencia; la pantalla los pinta en rojo y el pie dice que no se corrige nada ni se impide guardar, porque quién tiene razón depende de si hubo convenio o de si el archivo no es el de esta obra, y eso no lo sabe el programa. Va en el **resumen** y no sólo al confirmar, que es la diferencia entre avisar del archivo que se acaba de arrastrar y avisar de la 0128, que ya estaba guardada mal: si sólo saliera al cargar, un alta mala se queda callada para siempre. Se compara contra `obra.fin` y no contra el fin vigente, y contra `prog.inicio` y no contra el arranque heredado, porque comparar el alta consigo misma siempre cuadra — son las dos maneras de volver el aviso decorativo. Tres detalles que salieron de la contraprueba y no del diseño: el porcentaje se saca **sobre el alta**, que es el denominador que la frase nombra (el comentario decía 113%, sobre el anexo, y el código decía 53% — dos denominadores para la misma diferencia); una diferencia de dos pesos sobre trece millones imprimía «el 0% del contrato» junto a una diferencia que existe, y ahora dice «menos del 0.1%»; y la guarda contra un anexo que el parser rechazó resultó **código muerto** —el único sitio que llama exige `resultado?.ok`— así que se quitó en vez de inventarle una aserción. Banco `prueba-el-anexo-se-enfrenta-al-alta.cjs`: 27 aserciones con las cifras reales de la 0128 y la Cangrejera, 12 mutaciones en ROJO, y el registro escrito de **dos mutaciones que se probaron y NO son defectos**, con el porqué, para que nadie vuelva a gastar la tarde. Verificado en el preview con la 0128 sembrada como estaba dada de alta: el bloque dice los $14,599,236 (53.1%), los 2 días de arranque y los 62 de fin; la 0114, cuyo anexo cuadra al peso, no lo pinta. | CERRADO |
| 97 | **El `firebase` de la línea de comandos a veces no contesta bajo la suite, y nadie puede averiguar por qué.** El #79 (un banco que no pudo medir salía en rojo) arregló la clasificación: `prueba-el-destino-se-escribe` §7 manda a NO ARRANCÓ en vez de a ROJO. Lo que no se arregló es la intermitencia. Visto otra vez el 2026-11-04: la suite salió con 1 porque el CLI murió con `status=2 signal=null` y «An unexpected error has occurred», **y la corrida siguiente dio 83 en verde sin tocar nada**. No se reproduce en aislamiento —nueve intentos en verde: tres sueltos, tres a la vez y tres con el entorno exacto que le pasa el corredor— y el corredor es **secuencial** (`spawnSync` en un `for`), así que la hipótesis que trae escrita el banco, «el configstore tomado por otro `firebase` corriendo a la vez», no puede ser la suite consigo misma; el único otro candidato vivo es el `emulators:start` que lleva 27 días arriba. El rastro se perdía porque el mensaje de NO ARRANCÓ repetía la frase genérica del CLI y **no dejaba `firebase-debug.log`**, así que cada aparición costaba media hora y acababa en «volví a correrla y pasó», que es exactamente lo que el acuerdo prohíbe. **La causa sigue sin conocerse; lo que se arregló es que la próxima vez se pueda averiguar.** Como no se reproduce en aislamiento, lo que falta hay que recogerlo EN EL MOMENTO: el informe vuelve a preguntar con `--debug`, pega la cola del log y lo guarda entero fuera del árbol —la corrida siguiente lo pisa—, y añade las dos cosas que había que ir a buscar a mano, qué otros `firebase` estaban vivos y de cuándo era el configstore. **La segunda pregunta diagnostica, no absuelve:** el banco sale 2 aunque ella conteste, y que no se repita a los dos segundos se dice con todas sus letras, porque un reintento que decidiera el veredicto sería «volvé a correrla» con otro nombre. `prueba-el-cli-que-no-contesta-deja-rastro.cjs` pone un `firebase` postizo delante del PATH —el de verdad casi siempre contesta, ése es el problema— y mide las cuatro formas: no contesta ninguna de las dos veces, contesta sólo la segunda, contesta a la primera (y entonces NO se gasta una segunda llamada ni queda un log tirado en la raíz), y no está instalado. Dos mutaciones, las dos en salida 1 — y la de «la segunda absuelve» revive el #79 en vivo: el banco vuelve a salir ROJO acusando al destino de haber cambiado. | CERRADO 2026-11-13 |
| 98 | **La dependencia tenía la pantalla del programa pero no la ruta: su anexo no se podía guardar.** **La fila nació mal y eso es parte del hallazgo.** La abrí el 2026-11-04 afirmando que la dependencia «nunca ve el aviso del #96 (cuadrar el alta contra su anexo)» porque `CargaDelPrograma` sería de constructora. Falso: no lleva guarda por tipo de organización y la dependencia llega por **«Contrato → Catálogo de conceptos»** (`SUBTABS_PLANEACION_DEPENDENCIA`). Yo abrí la pestaña Contrato en el preview, me quedé en su primera sub-pestaña y concluí de ahí. Al ir a comprobarlo salió el defecto de verdad, que es peor: `conOrg` antepone `orgs/{oid}/`, y el bloque de dependencia de `firestore.rules` tenía `config/info`, `parametros`, `catalogo`, `estimaciones`, `permisos` y `evidencia` — **sin `config/programa`**. La escritura caía en el `match /{document=**}` final: el supervisor municipal veía el cargador, arrastraba su DE-5 y no se guardaba nada. **El señuelo** que lo mantuvo invisible es que unos renglones arriba sí hay un `match /programa/{pid}` — una subcolección documental de las cinco del modelo viejo, que no cubre un documento llamado `programa` DENTRO de `config`. Leído de corrido, la ruta parecía contemplada. Es el #31 (escrituras que se evaporan sin error) otra vez y en la ruta nueva, que es justo el riesgo que la cabecera del bloque de constructora ya traía escrito. Medido contra el emulador antes de tocar nada: todo el lado de dependencia rebotaba en L738 mientras `config/catalogo` pasaba por L538 **en la misma sesión y sobre la misma obra** — la prueba de que era la ruta y no los claims. **Arreglo:** `match /config/programa` en el bloque de dependencia con las mismas llaves que `config/catalogo` (el catálogo dice QUÉ y el programa CUÁNDO; separarlas deja a alguien viendo el alcance sin el plazo), el **contratista lo lee** —por lo mismo que el cliente del otro lado: es la vara con la que se le publica el atraso— y el contralor no lo escribe. `prueba-reglas-programa.cjs` pasó de 4 secciones a 8 y de 3 derivaciones a 6, todas en ROJO; lleva además una derivación que debe salir **VERDE**: borrar el señuelo no cambia nada, que es la manera de afirmar que nunca cubrió esta ruta. Verificado en el preview con la OP-2026-002 sembrada: el aviso dice los $1,250,000 (14%) y los 15 días de fin, y **se calla el arranque, que sí coincide** — enumera lo que no cuadra en vez de soltar las tres líneas siempre. **DESPLEGADO el 2026-11-04**, ruleset `3c929abe-c76b-45c5-bec5-2e99b8e63e40`, sólo `firestore:rules`. Al comparar el ruleset vivo contra el repo ANTES de subir salió algo que no se esperaba: entraban **dos** bloques `config/programa`, no uno — **la regla de constructora del #51 (el avance contra una recta) tampoco estaba viva**, o sea que hasta hoy, en producción, no podía guardar el anexo nadie, tampoco la constructora. El cambio es **puramente aditivo: cero líneas borradas**, verificado con diff contra el ruleset bajado, que quedó respaldado en `~/Desarrollo/CAMPO-datos-produccion/respaldos/`. Verificado después por dos vías: el SHA-256 del ruleset vivo es idéntico al del archivo del repo (`b3e372d4…`), y las **8 secciones del banco corridas contra el ruleset BAJADO de producción** —no contra el repo— salen verdes. | CERRADO |
| 99 | **El corredor de la suite publicaba un número de segundos que no había esperado.** El 2026-11-05 `npm test` salió con cuatro bancos «sin contestar en 901 s» **teniendo un plazo de 240**: imposible, porque a los 240 el banco ya estaba muerto. La máquina se suspendió cruzando la medianoche y `Date.now()` —reloj de pared— cuenta el rato suspendido; el plazo del `spawnSync` no. Medido: despiertos, `Date.now()` y `process.hrtime` coinciden al milisegundo, y matar al banco y recoger su salida costó 12 ms sobre un plazo de 1200, así que el sobrecosto legítimo es chico y los 661 s de diferencia no son explicables. Lo delató que tres de las cuatro dieran **el mismo** 901, y que una de ellas —`la-semana-sin-su-año`— no lanza subprocesos ni toca la red: sólo recorre un AST, o sea que no tenía nada que esperar. Las corridas de antes y de después: 85/85. **Lo caro es el consejo**, no el número: «901 s» manda a subir el plazo o a destripar un banco lento que no existe, cuando lo que había que hacer era repetirla con la máquina despierta. Me costó media tarde, incluida una vuelta mirando procesos huérfanos del emulador que no tenían nada que ver. **Arreglo:** cuando el reloj de pared se separa del plazo más de lo que cuesta morir (`plazo × 1.25 + 10 s`, multiplicativo porque un plazo de 10 s y uno de 240 no toleran lo mismo), el corredor **ya no dice un número de espera**: dice «no se pudo medir · el reloj saltó N s sobre un plazo de M s» y cambia el párrafo de ayuda por el que corresponde —repetir con `caffeinate -i npm test` antes de tocar el banco. Sigue contando como colgada y la suite sigue saliendo con 1, porque «no se pudo medir» va en rojo. Las cuatro aserciones nuevas van en `prueba-corredor-no-se-cuelga.cjs` (8 → 12) y **ejecutan** las dos cuentas sacadas del corredor, porque suspender la máquina no se teclea en una prueba. Dos mutaciones nuevas, las dos direcciones del error: creerle al reloj siempre, y desconfiar siempre —que dejaría a una colgada de verdad sin el número con el que se decide subir el plazo—. La primera **no mordía**: mi sección leía `scripts/pruebas.cjs` en vez de la copia del taller, o sea el archivo sano mientras la contraprueba mutaba el otro. Es el mismo error de clase que la cerradura del #51 (el avance contra una recta): medir el artefacto equivocado y salir verde. Corregido, 8 de 8 en ROJO. | CERRADO |
| 79 | **La sexta copia de «Última captura», y el 999 ya NO estaba latente: acusaba a dos obras vivas.** Encontrada el 2026-10-27 al verificar el despliegue del renglón de arriba: `calcularKpisObra` (`functions/index.js`) tenía su propia cuenta, con su propio origen —leía `obras/<id>/avance/subs`.`fecha`, que no es ni `fechaCaptura` ni `fechaCierre`— y con el mismo relleno: sin ese campo devolvía `999`. Alimenta `resumenSemanalEmail`, así que el correo del lunes imprimía literalmente «Captura: 999d» y además la contaba como obra sin captura. El banco `prueba-una-cuenta-por-numero.cjs` no lo veía: ejercita los dos archivos, pero del lado de funciones sólo entra por `recordatorioLunes`. **Lo que cambió es la medición.** El 2026-10-27 se midió 5 de 5 obras con `.fecha` y se anotó LATENTE; **remedido en producción el 2026-11-05** con `scripts/medir-el-relleno-que-pasa-por-medicion.cjs` (sólo lectura por construcción): de 7 obras, **dos no tienen `avance/subs`.`fecha` y las dos están ACTIVAS** —la **0128** (SIOP COLECTOR MALECON PENTAGONO 0926) y la **0131** (SIOP COAT-EMISOR J. SPARK PENTAGONO 1026)—, o sea que el correo de dirección llevaba semanas acusando de «Captura: 999d» a las dos obras más nuevas. La latencia de hace nueve días no era una propiedad del defecto, era el estado del padrón ese día; dar de alta una obra la destapa. **Y el origen estaba mal, que es el defecto de fondo:** `avance/subs` guarda el último subsidio capturado, no el cierre semanal, así que esta cuenta y la de pantalla podían discrepar sin que ninguna estuviera «mal» — dos cuentas para un número. Hoy lee `avance/historial`, el mismo documento del que vive el resto, con una octava entrada en el `Promise.all` que ya estaba ahí. **`diasSinCapturaDe` devuelve `null`, no un número**, y `null` quiere decir «no se puede contar»: `bloqueCaptura` lo escribe con palabras y `avisoDeCaptura` redacta el aviso de las dos situaciones juntas, porque **«nunca cerró una semana» y «lleva N días de atraso» no se suman** — son `obrasSinCaptura` y `obrasSinUnCierre`, dos conteos separados, y el correo ya no puede sumar una obra que no empezó con una que se atrasó. Cubierto por `prueba-un-numero-que-nadie-midio.cjs` (22 mutaciones, todas vistas) y el correo armado de verdad en `prueba-canal-que-avisa.cjs`, que ahora inyecta las dos funciones reales en vez de marcas. **Desplegado el 2026-11-06** con canario, único commit de funciones del día (`05a0f31`): las 22 corren el `index.js` del repositorio por SHA-256 y en él no queda ningún `= 999`. El correo que lo lleva por primera vez es el del **lunes 2026-11-09**, que el #102 (el remitente que sí entrega) ya está esperando. | CERRADO |
| 57 | **Un desplegable no puede pintar una opción que no es el dato guardado, y la fila nació contando mal.** Decía «22 `<select>`, dos pendientes, siete son estado de UI»: tres cifras tecleadas a mano en 2026-10-07 que ya no describían el archivo, y «son estado de UI» era una **afirmación sin comprobar** —el desplegable de permisos por rol lee un documento guardado y habría quedado ahí dentro—. **El defecto no es cosmético:** React no avisa de un `<select value="X">` sin opción `X`; resuelve el valor contra las opciones y, al no encontrarlo, el navegador pinta **la primera**. Donde el formulario manda el campo entero, Guardar escribe esa primera opción de verdad, y en el modal de rol eso es una **escritura de privilegio** por `actualizarUsuario`: un perfil migrado de otra organización se pintaba como mando. `opcionAjena` es una sola definición junto a `Sel`, con **diez** sitios de llamada; cuando el valor guardado no está en la lista se agrega su propia opción marcada —«director_obras — no existe en esta organización»— y **el vacío no se disfraza de valor ajeno**: donde el sitio no ofrece su «— Seleccionar —», se dice con palabras. El banco **no nombra ningún desplegable: los busca** —20 en el archivo entre `<Sel>` y `<select>` pelón, mide los **10** que leen un campo guardado e **imprime los 10 que descarta con la forma que encontró**, no con una frase para todos— y los ejecuta con React de verdad leyendo `selected`, que es la misma resolución que hace el navegador. Las listas y los alias se resuelven por el ámbito léxico de Babel: enumerar niveles o formas de declaración es la misma clase de error que enumerar sitios (ver el 139). Un desplegable nuevo sin guardia cae solo; un dato que el banco no sepa sembrar sale NO ARRANCÓ con el renglón y el nombre, no verde. **Y el recorrido en el preview encontró lo que las ocho secciones no veían:** con todo en verde, «Editar usuario» sobre un perfil guardado **sin rol** enseñaba «Administrador de Obra» ya escogido, porque el estado inicial decía `usuario?.rol || "administrador_obra"` — una omisión correcta en el ALTA que al reusarse para editar **otorga** el rol al guardar. Hoy sólo aplica sin registro, y una novena sección busca todo `useState({…})` que desempaque dos o más campos de una misma raíz y **ejecuta el inicializador con un registro vacío**. Cuatro mutaciones, las cuatro en salida 1. Verificado en el emulador con dos perfiles sembrados: el migrado dice «no existe en esta organización», el sin rol dice «sin rol asignado» y `submit` obliga a elegir; el alta sigue arrancando en «Administrador de Obra» con sus 9 opciones. | CERRADO |
| 141 | **El desplegable que no sólo pintaba un permiso ajeno: lo OTORGABA.** `PermisosObra` escribe permisos, y un valor guardado fuera de sus tres opciones —«aprobar», de una versión anterior, o el vacío— pintaba «Editar», la primera, y «Guardar matriz» lo concedía de verdad, sin confirmación y con la bitácora diciendo que alguien lo eligió. Lo que lo había dejado fuera del 57 no era este sitio sino la **regla** del banco: clasificaba por la FORMA de la punta del `value`, y aquí la punta es una llamada. Ahora recorre la procedencia —llamada, argumento, local, condicional— hasta dar con una lectura de campo o con un corte honesto, y mide **11 de 20** donde medía 10; los nueve descartados siguen siendo estado de pantalla. La siembra del vacío se resolvió con una raíz de **dos** niveles (`override[rol][modulo]`): con una de un nivel el banco habría medido el permiso por omisión y salido verde sin mirar el caso. Tres contrapruebas en ROJO (1) y recorrido en el emulador con «aprobar» y el vacío sembrados: el navegador marca la opción propia de cada uno. | CERRADO |
| 29 | **La bitácora llamaba «registro» a una ventana de seis días. La fila nació con el diagnóstico equivocado y eso es parte del hallazgo.** Decía «falta el índice de `auditoria` por `obraId`». No faltaba ningún índice: **la consulta no tenía un solo `where`**. Leía las últimas `maxItems` filas por `ts desc` y aplicaba TODOS los filtros en memoria, así que ningún índice la habría arreglado y la fila mandaba a crear uno que no hacía falta. **Medido en producción el 2026-11-05** con `scripts/medir-la-ventana-de-la-bitacora.cjs` (sólo lectura por construcción, GET único, ADC): **4,603 filas de 2026-05-23 a hoy**, o sea que la ventana por omisión —200— **cubre SEIS DÍAS**, y la más grande que ofrece el desplegable —1000— cubre 41 y deja **3,603 filas sin leer**. Sobre eso la pantalla ofrecía dos campos de fecha y, al no encontrar nada, contestaba **«Ningún registro coincide con los filtros»**: una afirmación de ausencia sobre hechos que no había leído. Hoy ninguna obra queda invisible con 200 —las siete tuvieron actividad esta semana— pero con 100 ya son dos (la 0114 y la 0126), y **el filtro de fechas mentía siempre**. **Son dos arreglos y hacen falta los dos.** (1) Las fechas viajan a Firestore: `where("ts",">=",…)` y `where("ts","<=",…)` con **los mismos operandos** que usaba el filtro de memoria, así que mover la comparación al servidor no cambia qué filas casan, sólo cuántas hubo que leer para saberlo — y **no necesita índice compuesto**, porque el rango y el `orderBy` son del mismo campo. La copia en memoria **se retiró**: dos veces la misma comparación son dos cuentas que pueden discrepar. (2) El tope sigue existiendo para usuario, obra, tipo y módulo, y mientras exista hay que decir hasta dónde se leyó: `ventanaDeBitacora` distingue la lectura **agotada** de la **topada** —comparando contra el tope que pidió la consulta, nunca deduciéndolo de un número redondo, mismo criterio que `huecoDeArranque` con las 52 semanas— y `frasesDeVentanaBitacora` redacta las tres cadenas juntas para que el encabezado y el vacío no puedan contradecirse. Ninguna frase de ventana topada afirma ausencia; «no hay registros aún» sólo puede salir con la lectura completa y vacía, y con filas leídas pero ninguna coincidencia la culpa se le achaca a los filtros. El aviso del recorte **no es del caso vacío**: una lista con veinte renglones también está recortada. **Verificado en el preview** con 230 filas sembradas en el emulador (200 de noviembre que llenan la ventana, 30 de junio/julio que quedan fuera), los tres estados: con 200 dice «200 de los últimos 200 movimientos, hasta el 3 de nov de 2026» y cuelga el aviso; **preguntar por junio devuelve sus 15 filas** —lo que antes era imposible— y el aviso desaparece porque la lectura se agotó; con 500 quedan «397 de 397 registros», sin aviso. Banco `prueba-la-ventana-que-se-llama-registro.cjs`: 30 aserciones, **19 mutaciones en ROJO**. | CERRADO |
| 9 | **La cifra que se redondeaba no era la que se capturaba: era la que el importador DEDUCÍA. La fila nació con el diagnóstico equivocado y eso es parte del hallazgo.** Decía «dos decimales no alcanzan para capturar volumen», y la captura ya estaba bien: el #30 (la precisión que la pantalla escondía) puso `step="any"` en los dos campos y `fmtCant` en la pantalla, y se verificó en producción que no hay `toFixed` entre el teclado y Firestore. Lo que nadie había mirado es la **escritura del importador**. Cuando el Excel no trae la cantidad —o la que trae no cuadra con su importe por más del 5%—, `parsearPresupuesto` la deduce como `importe / pu` y la guarda; la guardaba con `Math.round(c * 100) / 100`, **dos decimales fijos**, y con eso deshacía la igualdad que la deducción acababa de restaurar: se deduce precisamente porque `cant × pu` no daba el importe del catálogo. **Medido el 2026-11-13 ejecutando el parser extraído** con un abanico de precios de 2, 4, 5 y 7 cifras: el importe recuperado se separaba $0.40, $4.57, $57.09 y **$5,778.39** del que trae el catálogo, en una sola partida. Hoy la precisión la manda el precio —`decimalesPorPU`, la misma regla que gobierna la pantalla, cuya promesa es que el último dígito no vale más de un peso— y el error queda bajo $1 en los cuatro; la otra mitad también se exige, que un `toFixed(6)` para todos escribiría el ruido del double en Firestore. **Y tres pantallas nunca se enteraron del #30**: las dos tablas del catálogo —la de revisión, con su marca `(calc)`, y la del catálogo guardado— y el renglón de concepto del subcontrato en modo porcentaje seguían con un `2` tecleado a mano, así que la partida 129 de la 0125, que tiene `cant = 994.4961` en Firestore, salía 994.5 **al lado de su PU y su importe**: tres números donde dos no producen el tercero, y el equivocado era el que la pantalla misma truncó. `prueba-la-cantidad-se-ve-como-se-guardo.cjs` **no los nombra: los busca** —recorre el AST, se queda con cada contenedor JSX hoja que imprima una cantidad con formato (7 hoy), ejecuta su expresión tal como está escrita y exige los cuatro decimales—, así que un sitio nuevo con un `2` a mano cae solo; cero sitios o un identificador sin sembrar salen NO ARRANCÓ con el renglón puesto, no verde. 9 aserciones en ROJO contra `main`, 4 más en el banco del importador, y dos mutaciones (`fmtCant` con techo 2, `decimalesPorPU` devolviendo 2) las dos en salida 1. Verificado en el preview con un CSV real: la tabla de revisión dice `1.234567 (calc)` junto a `$1,265,249` donde `main` decía `1.23`. | CERRADO |
| 61 | **Un teléfono fuera de México archivaba su foto en la semana de su propio día local.** El día salía del aparato, y un domingo por la noche en México es lunes en Madrid: la foto caía en la semana siguiente. Ahora hay un solo calendario de referencia, `ZONA_OBRA`, y `fechaEnZonaObra` resuelve el día por `Intl.DateTimeFormat` con partes —no con `toLocaleDateString`, cuya forma depende del locale, que sería cambiar una herencia por otra—. El banco corre el MISMO instante desde cinco husos (Kiritimati a Midway) y exige un solo día y una sola semana. Fijar `TZ` en la suite hizo determinista la medición; esto arregla la conducta. | CERRADO 2026-10-27 |
| 17b | **El preámbulo de `plazoDeObra` decía que esta familia ya estaba cerrada, y el plazo se seguía contando a mano en dos sitios.** El #103 (dos números con el mismo nombre) unificó tres copias y dejó dos fuera: la regla `fin_006` y la tarjeta «Proyección de gasto». La de la tarjeta traía **tres errores en un renglón** — `obra.fin` es el fin del CONTRATO y se salta la ampliación (mientras `plz_001` y `plz_002`, de la **misma obra**, sí miden contra el vigente), la fecha corta se lee como UTC y se resta contra el instante del aparato, y el resultado va topado en `0`. **Ese tope no protegía, afirmaba:** «quedan 0 semanas» no es callarse, dice que la obra se acaba hoy. **Medido en producción el 2026-11-06** (`scripts/medir-el-plazo-y-las-fechas-impresas.cjs`, sólo lectura por construcción): de 7 obras, **3 estaban vivas en el defecto** —0112, 0114 y 0126, vencidas— y cada vez que alguien abría su pestaña de gastos leía que estaban por cerrar. Lo que falta se mide ahora contra el fin **vigente** y desde el otro extremo (`dias(hoy, fin)`), que de paso contesta en obras sin `inicio`, donde `totalDias − transcurridos` no tenía respuesta. La frase salió del JSX a `frasePlazoRestante`: se equivocaba de las dos maneras posibles precisamente porque, viviendo dentro del render, nadie la había podido ejecutar. Sin fin legible devuelve `null` y la pantalla **se calla**. Banco `prueba-el-plazo-se-cuenta-una-vez.cjs`: 53 aserciones, **8 mutaciones en ROJO**, barrido de las 24 horas del día para que el número no dependa de la hora, y las cifras esperadas (6, 15 y 56 semanas; 35 días de vencimiento) **salen de la medición de producción**, no de volver a calcularlas. Una novena mutación sobrevivió y la respuesta no fue inventarle una aserción: era una guarda de `fin_006` que no cambiaba ninguna salida, y **se borró**. Verificado en el preview: con el estado de la 0112 sembrado, «se agota en aproximadamente 9 semanas (el plazo contractual venció hace 35 días)» donde antes decía «quedan 0 semanas». **Vivo el 2026-11-06**: `el plazo contractual venció hace` está dentro del bundle que sirve `app.cotea.com.mx`. | CERRADO |
| — | **«¿Qué obra del GP es ésta?» estaba contestada CUATRO veces en `src/App.jsx`, y sólo una tenía la guarda de la 0129.** La guarda —una clave de GP capturada que la corrida del gasto todavía no conoce significa «no hay dato», nunca «búscale parecido por nombre»— se puso en `estadoGastoGP` tras el incidente de la 0129 («AYU-COAT-REHABILITACION DEL MALECON», que comparte «COAT» y «REHAB» con la 0121 «SIOP Coatza Rehab. Av. Universidad» y se llevaba sus $19.9M). Las otras tres copias no la tenían. **Medido, no supuesto** (`scripts/medir-tres-resolvedores-de-gp.cjs`, que no dobla nada y corre el código extraído del archivo): `TendenciasMensuales` —la tarjeta del renglón de abajo, recién entregada— dibujaba una curva semanal de **$19,900,000** para una obra cuyo propio KPI, arriba en la misma pantalla, decía `$0 · medido · sin-cheques`. `ProyeccionAvanceGasto` contestaba $0 **por accidente**: nunca tuvo el paso de nombre, o sea que acertaba por no haber llegado al paso que falla, lo cual no es saberlo. Y como `datosObraGP` **no lo pasaba ningún llamador**, los resolvedores de dentro decidían en **todas** las obras, no en un caso raro. La cuarta copia salió a mitad del trabajo: `_serieGastoAcumulado`, que alimenta la columna de **Δ margen** de la lista, cruzaba por `o.id === obra.id` —sin mirar `gpId` ni el prefijo— así que la columna se quedaba en «—» en cuanto el id de CAMPO no era literalmente la clave del Sheet, sin decir por qué. **Arreglo:** `estadoGastoGP` devuelve también `obraGP`, la obra del Sheet con la que cruzó, y un `serieGastoDeSemanas` de módulo se queda con la cuenta del gasto semana por semana; los dos componentes y la columna sueltan su resolvedor, y `margenSeries` lee la serie que se dibuja en vez de rederivar su propio gasto. Se mantiene la copia literal de `estadoGastoGP` en `functions/index.js` **aunque allí `obraGP` no la use nadie**: las dos copias tienen que contestar lo mismo, no sólo en el número. **Dos conductas se cambiaron a propósito y están escritas en el código:** el ancla del último punto ya no depende de `subs` —el gasto de una obra no se mide con sus partidas, y condicionarlo hacía que la última fila y el KPI publicaran dos gastos distintos en las obras sin catálogo—, y el acarreo de gasto manual anterior a la ventana se aplica siempre, porque la ventana de la proyección arranca en la firma y un gasto fechado antes desaparecía sin que nada lo dijera. Banco `prueba-una-sola-pregunta-a-gp.cjs`: 7 secciones, **9 mutaciones en ROJO**, tres de ellas literalmente el código que había. Dos cosas se aprendieron de la contraprueba: hay **dos** guardas contra el difuso —la de `gpId` y la del prefijo del id— y con una obra de id de cuatro dígitos la segunda **tapa** a la primera, así que quitar cualquiera de las dos pasaba desapercibido (hacen falta las tres formas de obra: id de Firestore con la clave sólo en `gpId`, id que ES la clave, y las dos apuntadas a la 0121 para que el cero no sea un cero de no saber leer); y el ancla del último punto **sólo se ve con gasto que no se puede fechar** —cuando todo está fechado, anclar no mueve nada—, de ahí la sección de la maquinaria sin fecha. Los dos bancos vecinos se repararon porque el refactor les movió el suelo: `prueba-series-sincronizadas` resuelve los helpers de módulo con una **lista escrita a mano** y no con cierre transitivo, y dos de sus aserciones leían un local que se mudó dentro de la cuenta nueva. Verificado en el preview con las dos obras lado a lado: la 0129 en `$0` en el KPI, en las ocho filas de la tabla, en la curva y en el ritmo de la proyección; la 0121 en `$20,418,000` en el KPI, en la última fila, en la curva y en «Gasto acumulado a hoy» de la proyección, con el pie que declara que parte del gasto llega sin fecha. **Desplegado el 2026-11-05**, `d7c0689..5f49ebf`: Netlify construyó `index-f460be5d.js` y el bundle bajado del sitio es **byte por byte idéntico** al build local de `5f49ebf` (SHA-256 `07970016…`). Aquí la comprobación por **frases no sirve y hay que decirlo**: este corte no cambió una sola cadena visible —cambió de dónde sale el número—, así que no hay texto nuevo que buscar en el bundle y la identidad del hash es toda la evidencia disponible. **Las funciones también están arriba**, desplegadas con canario la misma tarde (ver «Frontera medida» arriba): quedaron ATRÁS por este commit y sólo por él. Lo que subió allá es la copia literal de `estadoGastoGP`, donde `obraGP` **no lo usa nadie** —ese archivo sólo publica el total—, así que lo vivo y el repositorio ya contestaban el mismo número y lo que faltaba era la forma del veredicto, no una conducta; se despliega igual porque **las dos copias tienen que contestar lo mismo en forma, no sólo en el número**, y el día que el servidor necesite saber con qué obra del Sheet cruzó, la cuenta ya está igual en los dos lados. | CERRADO 2026-11-05 |
| — | **Un banco que teclea a mano la lista de dependencias de la cuenta que extrae muere con `is not defined` a media corrida.** Pasó el 2026-11-05: `prueba-alta-obra-que-gp-no-conoce` pedía `presentacionEconomiaObra` con `('C','MXN','NUM','nivelMargen')`, el traductor estrenó `MXNS` y el banco salió **2 después de 30 aserciones verdes**. Medido en los 88 bancos: **13** teclean una lista de símbolos que existen en `src/App.jsx`, pero **12 de las 13 teclean DOBLES** (`Card`, `Tit`, `Kpi`, `C`, `fbDb`, `fsGet`, un `MXN` de mentira para medir texto y no formato) y eso es correcto y necesario — se dobla el hook, nunca la cuenta. La única que teclaba los **reales** es la que murió, y pasó al portón. O sea: la clase existe, tenía una instancia y ya no tiene; no hay barrido pendiente, hay un criterio — si el símbolo sale del archivo, se pide por `deApp`. | CERRADO 2026-11-05 |
| — | **Al municipio nunca se le dibujó la curva de su obra, y a la constructora se le dibujaba en dos pestañas que no se podían mirar juntas.** La dependencia tenía el `-44pp` del semáforo del #51 (el avance contra una recta) y la barra de plazo, o sea el cuánto, pero ninguna pantalla decía **cuándo** se abrió la distancia; y del otro lado el margen vivía en una gráfica y el gasto en otra, cuando el margen **es** la resta de las dos. **Hecho el 2026-11-05:** una tarjeta, un eje de semanas, un selector de ventana — Curva S contra el anexo arriba para los dos tableros, economía abajo **sólo** para la constructora, y la tabla de la ventana debajo. La frontera no es una bandera sino **dos componentes**: `CurvaSDelContrato` ni recibe `materiales`, `maquinaria` ni `otrosGastos`, porque una bandera son diez puntos de toque y basta olvidar uno. Se evolucionó `TendenciasMensuales` en vez de reescribirla, a propósito: su prólogo es el que vigila `prueba-series-sincronizadas.cjs`, el guardián de los **$2,777,997** que exige que la gráfica y el KPI lean el mismo dinero, y reescribir el componente lo habría dejado midiendo un archivo que ya no existe. **El preview encontró un defecto que yo había metido**, y es el renglón que da nombre a esta sección: la última fila decía `Gasto acumulado $21,918,000` con `$8,518,000` la semana antes y `Gasto de la semana $0`. El acumulado se ancla a `gtActual` —tiene que anclarse, o el margen del renglón no cuadra con el KPI de su propia tarjeta— pero el delta se calculaba sin ancla. Las tres salidas se pesaron por escrito: publicar el salto afirma $13.4M gastados en siete días, dejar el `$0` afirma que no se gastó nada junto a un acumulado que se triplica, y sólo el `—` es cierto, porque ese dinero es el total del GP y **llega sin fecha**. Va con pie que lo declara en vez de callarlo. Banco nuevo `prueba-las-dos-curvas-y-un-eje.cjs`: 8 secciones, **11 mutaciones en ROJO**, y la de la frontera del margen **no nombra ni una cifra** — compara todos los locales con dinero y sin dinero, primero probando que a la constructora **sí** le mueven las series y después que al municipio no le mueven ninguna, porque una fuga que sume otro rubro produce una magnitud que una búsqueda por número no encuentra. Verificado en los dos tableros: la constructora en `57.5% · 75% programa · −17.55pp`, y la dependencia con cuatro columnas, cero pesos dentro de la tarjeta y su `−44.08pp` cuadrando con el `-44pp` del semáforo de abajo. | CERRADO 2026-11-05 |
| 116 (nómina; el otro 116 es el de la carátula del PDF) | **Al unir las partes de una semana de nómina, un campo que nadie midió salía valiendo 0.** Cerrado 2026-11-12 en la unión, que es donde tenía que hacerse: `semanasDeNomina` entrega `null` el campo que ninguna parte trajo, `personalDeSemana` es la única cuenta del personal para las cuatro pantallas que la publican, y el consolidado del portafolio deja fuera del total a la obra sin conteo y lo dice. El recorrido del preview destapó tres herederos del mismo cero —el renglón «0 trabajadores» debajo de un KPI que decía 34, el «0 con pago» de una semana de medio millón, y el rótulo «en listado» junto a un listado que no vino— y los tres van en la misma rama. Bancos: `prueba-la-ausencia-no-es-cero.cjs` (4 mutaciones), `prueba-nomina-kpi-unico.cjs`, `prueba-semana-actual-nomina.cjs`. | CERRADO |
| — | **La cuenta de «Última captura» estaba escrita CINCO veces.** Las cuatro de pantalla ya se habían unificado en `diasSinCapturaDe`; la quinta vivía dentro de `recordatorioLunes` (`functions/index.js`) y ningún banco la veía porque todos miraban sólo `src/App.jsx`. Leía únicamente `fechaCaptura` —`fechaCierre` no aparecía en ese archivo ni una vez— y, sin fecha, escribía **999**. Ese relleno hacía dos daños a la vez en la obra recién dada de alta: `999 > 7` le ponía un pendiente «cierre semanal» que nadie podía resolver, y `999 < 300` —filtro que existía sólo para tapar el relleno— le quitaba la alerta A4, o sea que la obra más abandonada era la única callada. Hoy llama a la copia literal del helper y, sin cierres, lo dice con palabras en vez de con un número. `prueba-una-cuenta-por-numero.cjs` ejercita los DOS archivos y corre el cron de verdad con la cuenta mutada. **Medido en producción antes de tocar: 5 obras, 42 snapshots, 0 sin `fechaCaptura`** — la divergencia por `fechaCierre` era latente; el 999 no. **DESPLEGADO 2026-10-27 18:29Z**, junto con el #78, acotado por nombre a los tres trabajos; verificado bajando el paquete de `gcf-v2-sources` y comparando su `index.js` con el del repo (mismo SHA-256). **Pero eran SEIS, no cinco** — ver el renglón 79. | CERRADO 2026-10-26 |

### Venían de «3 · Impide enseñar el producto»

| # | Tema | Estado |
|---|---|---|
| 89 | **La app se muda a `app.cotea.com.mx` y la raíz queda rebotando con un 302 hasta que la landing la ocupe.** `prueba-las-dos-direcciones-del-producto.cjs` —el banco del #43 (la firma del correo) con la premisa invertida— y sus 15 mutaciones en rojo. **El 302 es deliberado:** un 301 se cachea en disco y la landing del #90 nacería invisible. **Arriba el 2026-11-03/04 y medido desde fuera, no de palabra:** `app.cotea.com.mx` añadido en Netlify como **alias** (primero Netlify, que es quien dicta el registro; luego el `CNAME app → campo-fosmon.netlify.app` en GoDaddy), resuelve igual desde 8.8.8.8 y 1.1.1.1, el certificado trae los tres nombres en el SAN, `curl` **sin** `-k` contesta 200, el enlace profundo `/?obra=0112` también, y los cuatro orígenes se revisaron por redirecciones inesperadas. **`app.` NO se hace primario** hasta que la raíz se mude a su propio sitio: Netlify manda `301` de los alias al primario, que es exactamente la caché que este pendiente se diseñó para evitar. El certificado falló el primer intento y no era defecto: servía el comodín genérico `CN=*.netlify.app`; con `-k` ya daba 200 y la app real, o sea que el ruteo estaba bien y faltaba el papel — se arregló con «Renew certificate». CORS del bucket aplicado y **releído de él**, con control negativo (`evil.example.com` no recibe cabecera). **Lo de Auth no era cierto y se midió:** los dominios autorizados sólo gobiernan los flujos de OAuth por ventana o redirección, y CAMPO entra únicamente por `signInWithEmailAndPassword` (`src/App.jsx:7115`), así que no hacía falta tocarlos; de paso, `campo-fosmon.netlify.app` **nunca** estuvo en la lista, al contrario de lo que decía este renglón. Falta el sitio de Netlify **aparte** publicando `landing/` con `cotea.com.mx` movido a él: se pospuso a propósito, porque hoy la raíz sirve la app y meterle un salto hacia una landing que no existe sólo agrega un brinco — va con el #90 (la página pública con capturas). Los orígenes viejos **no se retiran** del CORS: hay PWA instaladas ahí. **Funciones desplegadas el 2026-11-04** con el #93 (el `$0` que nadie midió), así que el `APP_URL` del correo ya es el nombre nuevo: lo vivo corre el `index.js` del repositorio —medido con el verificador— y el repositorio dice `app.cotea.com.mx`; el enlace en un correo recibido se lee el lunes 2026-11-09. Ojo: desde que la raíz rebota, su propio `?_reset=1` ya no limpia la raíz (está escrito en `index.html`). | CERRADO 2026-11-04 · la landing de la raíz es el #90 |
| 69 | **Antes de sentarnos con Orlando: el recorrido completo con un usuario de dependencia REAL.** Entrar, ver sus obras, subir una foto, verla en la galería. El motor de reglas ya lo sabemos —el #66 se midió contra el ruleset publicado y `verificar-reglas-publicadas.cjs` lo vigila—, pero eso es el motor, no el camino: la vista de dependencia nunca se ha recorrido de extremo a extremo con una cuenta que exista. Hoy el Auth de producción tiene 14 usuarios y **los 14 son de constructora**, así que hace falta dar de alta la cuenta (escritura a producción, no hecha). Esto no es un pendiente suelto: es requisito de la demo, y si falla, falla delante del director de Obras Públicas. ⛔ **ORDEN QUE NO SE PUEDE INVERTIR: EL #73 CIERRA ANTES DE QUE ESTO EMPIECE.** El #73 —`auditoria` sin frontera entre organizaciones, con la economía del contratista dentro— sólo muerde el día que exista el primer usuario de dependencia, y este pendiente es precisamente crear ese usuario. Crear la cuenta primero sería abrir nosotros la fuga para poder probar que no hay fuga. **El #73 quedó CERRADO el 2026-10-23** (ruleset `ebd4f8bb`, 17/17), así que **esto ya está desbloqueado**; si alguna sesión futura reabre el #73, este pendiente se detiene otra vez. Antes de dar de alta la cuenta, correr `node scripts/medir-auditoria-entre-inquilinos.cjs` y exigir verde. **El tramo del emulador está HECHO el 2026-11-14**: entré como `oscar@cotea.com.mx`, vi las 3 obras de `orgs/coatzacoalcos/obras` sin columnas de margen, subí una foto que llegó al bucket del emulador bajo el prefijo de la dependencia (6,423 bytes, los mismos que mandé) y la vi pintada en la galería; el `contralor` entra a las mismas obras y no tiene un solo `input[type=file]`. Dos cosas que la fila no decía: **la frase «hace falta dar de alta la cuenta» era necesaria y no suficiente** —`obras` va prefijada por organización (`src/rutas-org.js:129`), así que hacen falta TRES escrituras: la org, el usuario y al menos una obra bajo `orgs/{oid}/obras`, o la cuenta entra a un portafolio vacío; lo mide `scripts/medir-lo-que-le-falta-a-una-dependencia.cjs` (sólo lectura), que hoy contesta 1 org, 15 usuarios todos de constructora, 7 obras en la raíz y **0 bajo ninguna ruta de organización**—. Y el recorrido destapó el **#143**, que muerde justo aquí: la primera obra de la dependencia nacerá sin migrar y toda su evidencia saldrá rotulada «de archivo, sin autor» — **el #143 quedó DESPLEGADO el 2026-11-15 (reglas `05e30cb2` y front `564d3d5`), así que esa traba ya no está**: la obra de demo que se siembre en producción nacerá con su expediente y su primera foto saldrá «verificada». **EL TRAMO DE PRODUCCIÓN QUEDÓ HECHO EL 2026-11-15**, con OK expreso, por `scripts/sembrar-dependencia-demo.cjs` (portón de `destino.cjs`: ensayo primero, y las 6 rutas releídas de producción después): `orgs/coatzacoalcos` tipo `dependencia` con su `config/branding`, el usuario `orlando@ayuntamientocoatza.gob` con claims `{rol: director_obras, orgId: coatzacoalcos, tipo: dependencia, todas: true}` y perfil cuyo `uid` coincide con el de Auth, y la obra `OB-2026-DX5V00` (presupuesto 12,400,000, `modoAvance: volumen`). Antes de escribir, `medir-auditoria-entre-inquilinos.cjs` contra el ruleset vivo `05e30cb2`: **17/17**, que es lo que esta fila exigía. El medidor ya contesta **«SÍ — 1 usuario(s) y 1 obra(s)»**. Tres cosas escritas a propósito que hay que saber: ① la obra se sembró **con el expediente de evidencia PRIMERO**, y por eso trae `migrada: true, nacidaMigrada: true` — sembrarla en el orden contrario habría replantado el #143 justo en el expediente que va a ver el cliente; ② la obra va **sin avance, sin estimaciones y sin fotos**, porque la captura se hace en vivo delante de él: sembrar avance sería inventar cifras y además taparía lo único que hay que enseñar; ③ la cuenta **no tiene contraseña** —el guion no genera ni imprime credenciales—, así que una persona tiene que establecerla desde la consola de Firebase antes de la demo. **VESTIDA CON OBRAS DE VERDAD EL 2026-11-15**, con OK expreso y por decisión suya de usar «el catálogo y la curva de las dos obras del Pentágono»: `scripts/vestir-la-demo-de-dependencia.cjs` cambió el correo de la cuenta a **`orlando@cotea.com.mx`** —el dominio propio, registrado el 2026-09-23 y que ya era el `FROM_EMAIL` del producto (functions/index.js:2248), o sea que el aviso **sí puede entregarse**; el inventado `ayuntamientocoatza.gob` no tenía MX ni A—, borró la obra genérica sembrada horas antes y copió la **0128** (colector John Sparks 2, 46 partidas, $12,890,541.86, curva de 5 meses) y la **0131** (emisor, 73 partidas, $27,489,778.08, 7 meses) bajo `orgs/coatzacoalcos/obras`. Releído de producción: las dos **cuadran al centavo** por los dos lados —suma de partidas = `importeContrato`, y suma de `montos[]` de la curva = `totalDeclarado`—, 0 fotos, 0 partidas con avance, y las dos con `migrada: true, nacidaMigrada: true`. Cuatro decisiones que el diff no explica: ① **el cambio de correo arrastró el perfil**, porque el login NO busca por uid sino que deriva el id del correo tecleado (`src/App.jsx:9825`) y si no lo encuentra **cierra la sesión** con «Tu cuenta no tiene perfil en el sistema»; se movió a `usuarios/orlando_cotea_com_mx` y el viejo se borró para que el padrón no enseñara dos Orlandos, uno de ellos incapaz de entrar. ② **No cruzó la economía del contratista**: se quedaron fuera `nomina/historial` (22 KB de sueldos en la 0128), `config/otros_gastos`, `avance/maquinaria`, `avance/materiales` y las claves `gpId`/`gastoGP`/`cargaOT`; verificado por lectura, documento por documento. ③ **`avance/subs` no se copió a propósito** y no es olvido: la app lo DERIVA del catálogo cuando falta y lo guarda ella (`src/App.jsx:27321`), y la ruta tiene escritura del lado dependencia (`firestore.rules:712`), así que copiar 60 KB era escribir lo que la app reescribe. ④ **`modalidad` quedó VACÍA**: es obligatoria en el alta de dependencia pero el dato no está en el origen, y teclear «Licitación pública» porque suena bien sería inventar un hecho jurídico sobre un contrato real de SIOP. Se quedaron fuera también los cortes semanales 45-46 y la estimación de cada obra ($3.94 M y $5.05 M): la demo captura en vivo, y la obra tiene que arrancar en cero para que se vea la foto saliendo «✓ verificada». Lo afirma **`scripts/medir-que-ve-la-cuenta-de-demo.cjs`**, que le pregunta al motor con el ruleset PUBLICADO `05e30cb2`: **29 de 29 en verde** — ve sus dos obras, su catálogo y su curva, puede derivar `subs` y capturar evidencia; y NO alcanza la obra original de la raíz, ni su nómina, ni sus otros gastos, ni la bitácora de la constructora; el `contralor` ve y no corrige. Las dos mitades muerden: contra `0330d4de` (julio) salen **11 rojas** de la mitad ALLOW, y contra `1b223bc0` (22-oct) sale roja la del DENY —«NO lee la bitácora de la raíz» contesta **ALLOW**, que es la fuga del #73 reencontrada sola—. ⚠️ **Falta una sola cosa para que la cuenta sirva: la contraseña**, que nadie ha puesto; el guion no genera ni imprime credenciales. Y «`correo=enviado`» sólo dice que Resend lo aceptó: que el buzón `orlando@cotea.com.mx` exista está **sin comprobar** desde aquí. | CERRADO |

### Venían de «4 · Puede fallar en silencio»

| # | Tema | Estado |
|---|---|---|
| 142 | **Doce bancos leían «la máquina se durmió» como «encontré un defecto»: el hijo al que se lleva el plazo vuelve con `null`, y `null` comparado contra un número es falso siempre.** El 2026-11-14 la suite publicó **1 rojo y 3 CADUCA** que no existían. Re-medidos uno por uno, despierta la máquina: `reglas-obra-cerrada` sale 0 con sus 13 contrapruebas en ROJO, `el-cli-que-no-contesta` VERDE tres veces con la misma `FECHA_FALSA`, y `ui-dependencia` y `correos-de-alta` salen 0 en dos segundos **los dos juntos**. La causa está en `pmset -g log`: batería al 18% y Maintenance Sleep cada ~16 minutos, de **666 a 1074 segundos**, que es exactamente lo que el corredor reportó como «colgado». Ninguno era defecto. **Lo que sí era defecto es cómo se leyó.** Dieciséis sitios del repo lanzan un hijo con plazo y **doce** sacan el veredicto comparando `r.status` contra un número; `spawnSync` devuelve `status: null` cuando el plazo vence, y `null` no es `0`, ni `1`, ni `2`, ni `> 0`: **todas** las comprobaciones salen falsas a la vez y el banco publica **ROJO**. Es el #139 otra vez —un NO ARRANCÓ dice «no medí», un ROJO afirma que hay un defecto y manda a buscarlo donde no está— y en los **siete bancos de mutación** es peor: lo que publican es «la mutación NO se vio», una afirmación sobre su propio poder que nadie midió, y que empuja a aflojar una prueba que estaba bien. **El arreglo no eran doce parches: era una cuenta que faltaba.** El corredor sabe distinguir las dos cosas desde el #133 —compara el reloj de pared contra el plazo y publica «el reloj saltó N s sobre un plazo de N s»— pero ese criterio vivía **sólo** en `pruebas.cjs`, y los bancos corridos a mano no lo tenían. Ahora `relojCreible` y `frasePorNoContestar` viven en `no-arranco.cjs`, que es lo que los 125 bancos ya requieren, y el corredor las **toma de ahí**: la prohibición no es la duplicación, es el desacuerdo, igual que en el #140. La puerta es `hijoConPlazo`, que envuelve `spawnSync`, y sale con **2** sin devolver cuando al hijo se lo llevó el plazo o una señal — no devuelve a propósito, porque devolver un `null` deja al banco comparándolo otra vez. Distingue tres averías: otra señal (la nombra), plazo con el reloj creíble («sin contestar en N s»), y reloj que saltó («no se pudo medir», y dice que **`caffeinate -i` no alcanza en batería**: hace falta corriente y `-dimsu`). Pega además las últimas 8 líneas que el hijo alcanzó a decir. **No se traga el `ENOENT`**: `el-destino-se-escribe` tiene que conservar su «npm i -g firebase-tools», así que sólo se queda con `ETIMEDOUT`. Y **exige** el plazo: pedirle la puerta sin `timeout` sale 2 en vez de dejar un hijo eterno. **Cuatro sitios quedan fuera a propósito y su razón se imprime en cada corrida**, porque una excepción que no se lee se vuelve un olvido: `pruebas.cjs` (2) **es** el plazo —juzgarlo con la puerta sería pedirle a la puerta que juzgue a quien la define—; `prueba-corredor-no-se-cuelga.cjs` (9) tiene por asunto el plazo del corredor y ahí un hijo muerto es **el dato**; `el-destino-se-escribe.cjs` (2) lo resuelve mejor, cayendo en su `sinPrecondicion` con el `rastroDelCLI` entero pegado; y `puente-color.cjs` (1) usa `execFileSync`, que al vencer **lanza** en vez de devolver, y su `catch` ya va a `sinPrecondicion`. **El guardia pregunta al código, no al texto** —precedente #140, el archivo que se denunció a sí mismo—: barre `scripts/*.cjs` con `@babel/parser` buscando llamadas de verdad a `spawnSync`/`exec*` **con `timeout`**, y cada excepción lleva su **CUENTA**, no su nombre: añadir un sitio al archivo exceptuado no se cuela. Un archivo que no parsea y un barrido de cero sitios salen **2**, nunca verde, y se mide la excepción fantasma por los dos lados. `prueba-el-plazo-no-se-confunde-con-un-rojo.cjs`: **32 comprobaciones, 7 mutaciones y las 7 en ROJO (1)**. No afirma que exista ninguna función: escribe bancos de mentira en /tmp, les precarga un reloj que **salta 20 minutos en su segunda lectura** —que es lo que ve un proceso entre cuyas dos lecturas la máquina estuvo suspendida— y mira el código de salida. **La simétrica hace falta y costó una mutación:** la primera versión mutaba la puerta a «sale con 2 siempre», y esa mutación **se lleva al banco puesto** —sus propios hijos van por la puerta— y volvía con 2, que es el andamiaje cayéndose y no haber visto nada; encima sería una avería a gritos. La que hay que ver es la callada: la puerta **devuelve**, sí, pero con un código que no es el del hijo, y se mide con dos hijos de códigos distintos para que ni «siempre 0» ni «siempre el último» cuelen. | CERRADO 2026-11-14 |
| 140 | **Ocho bancos hablaban con el emulador sin estar en la tabla del corredor, y dos contestaban ROJO con cero comprobaciones cuando el puerto de Auth estaba caído.** La tabla `NECESITAN_EMULADOR` del #109 nombraba **8 de los 16** bancos que tocan el emulador, y el hueco no era cosmético: medido el 2026-11-12 matando **sólo** el 9099 —con los dos puertos muertos los ocho salían 2, porque `limpiarDatos` guarda el de Firestore y falla primero, y esa primera medición escondió el defecto—, `reglas-programa` y `reglas-obra-cerrada` salían **salida 1 con cero FALLA**, o sea un rojo que manda a buscar una regresión inexistente en `firestore.rules`; `frontera-de-la-bitacora` caía por la puerta del «un símbolo cambió de nombre», que apunta al andamio y no al puerto; y `canal-que-avisa` tardaba **44 s** contra un `127.0.0.1:8080` tecleado, con `EMU_PORT` que no servía para nada. Es la misma clase que el #132 al revés: ahí el «no pude mirar» se degradaba a **verde**, aquí se degrada a **ROJO**, y las dos formas cuestan lo mismo —una tarde persiguiendo lo que no está roto—. **El arreglo no son las ocho entradas: es el guardia.** La tabla ya había crecido de dos a ocho de una en una y nada impedía la novena, así que el corredor ahora **se niega a correr** una suite cuyo texto y cuya tabla no coincidan: recorre **todos** los bancos del repo —no sólo los filtrados, porque un filtro no debe esconder un hueco—, y el que **llama** a `connect*Emulator` o requiere `emulador-limpio.cjs` o `reglas-del-repo.cjs` tiene que estar en la tabla **y** pedir sus puertos con `exigirPuertos`, con el **mismo juego** de nombres en los dos sitios y ninguno que el corredor no conozca. Los dos sitios hacen falta por separado —la tabla es la única que puede **saltarse** un banco, y `exigirPuertos` la única que sirve corrido a mano—, así que lo prohibido no es la duplicación sino el **desacuerdo**; es el precedente de `exclusionesFantasma`. Cuenta para la salida 1. Después del arreglo los ocho salen **2 en menos de un segundo nombrando el puerto**. Defendido en `prueba-corredor-no-se-cuelga.cjs`, que pasó de 32 a **38 comprobaciones y de 24 a 33 mutaciones, las 33 en ROJO**: un banco de mentira que habla con el emulador y **no** está en la tabla se denuncia aunque la corrida esté filtrada, y `nota-no-calla` reescrito de cuatro formas cubre el sin declarar, el que coincide, el que **miente** y el que pide un emulador inexistente. Dos rojos propios en el camino: el caso del nombre inexistente pasaba por la razón equivocada —`/firestoer/` casaba con el mensaje de **discrepancia**, de modo que la mutación que tolera un emulador desconocido habría sobrevivido—, y el ancla de una mutación llevaba los espacios contados y se rompió al realinear la tabla de 8 a 16 renglones: un ancla que deja de apuntar **no mide y no avisa**, otra vez hacia el verde. **Y el guardia tuvo que arreglarse una vez más, el mismo día y por el otro lado: medía la MENCIÓN en vez de la ejecución.** El disparador era una expresión regular sobre el texto, así que el único archivo del repo cuyo **asunto** es el corredor se denunció a sí mismo —`prueba-corredor-no-se-cuelga` lleva `'emulador-limpio.cjs'` en su tabla de módulos y escribe cuerpos de bancos de mentira con `connectFirestoreEmulator(` dentro de una plantilla, sin abrir ninguna conexión—, y la suite entera salió con **1 sin nada roto**. Lo que importa es por dónde se escapó: los casos del taller corren en un directorio temporal con bancos de mentira donde ese archivo **no existe**, así que el banco no podía verse a sí mismo, y el rojo apareció por primera vez en la corrida completa sobre `main`. Ahora la pregunta se le hace al **código**: se parsea el banco con `@babel/parser` y se buscan llamadas de verdad —lo que vive en una plantilla o una cadena es dato por construcción, que es exactamente lo que son los bancos de mentira—, y **sin lista de excepciones**: una lista habría sido el hueco de siempre, porque excluir por nombre al que sí habla es el defecto que esto vigila. Precedente: el #139 (`cierreDe`), por la misma razón escrita en su preámbulo. Medido sobre los 121 bancos: parsean los 121 y salen los **mismos 15** que empataba la expresión, sin el corredor. Un banco que **no parsea** se denuncia en vez de pasar —no clasificado no es lo mismo que no declarado—, y sin el parser el corredor sale **2 nombrándolo**, nunca 0 ni 1. Se añadió además la comprobación que faltaba y que habría visto esto desde el principio: correr el corredor **de verdad sobre el directorio de verdad** y exigir que ningún banco discrepe. **41 comprobaciones y 36 mutaciones, las 36 en ROJO**, entre ellas «buscar los nombres en el texto en vez de las llamadas en el código», que sólo esa comprobación nueva ve. De paso el `NODE_PATH` que los talleres necesitan quedó en **un** sitio y no pegado en los seis spawns: pegado a mano se desincroniza en cuanto el corredor estrene otra dependencia, y se desincroniza hacia el no-veredicto. **Queda escrito y no se tocó:** `escritura-en-su-organizacion` lleva su propia copia a mano de `noArranco` en 12 sitios, y `nomina-kpi-unico` ya sale 2 con la pila nombrando el archivo. | CERRADO 2026-11-13 |
| 133 | **El veredicto de la suite depende del día en que se corra: en `main`, hoy 118 verde, con el reloj movido salen hasta 5 rojos y 1 sin arrancar.** Medido el 2026-11-12 con `fecha-falsa.cjs` sobre la suite **entera** en cuatro fechas: 2026-12-01 → 3 rojos, 2026-12-31 → 3, **2027-02-28 → 5 + 1 sin arrancar**, 2027-07-15 → 3. Salió persiguiendo un rojo del semáforo que resultó ser de una corrida **anterior** a su arreglo —aquél aguanta **401 días · 802 corridas · 0 no verdes**—, o sea que el patrón no era suyo: estaba en otros. **Son tres naturalezas, no una.** (a) `el-documento-interno-de-cotea` y `las-dos-curvas-en-el-papel` tienen fixtures semanales que **degeneran** al mover el calendario —«la serie del caso limpio trae 0 semanas de tramo, con las 4 que pide el reporte»—, la misma clase que el semáforo; lo bueno es que **cayeron por su propio canario de vacuidad**, no pasaron en verde sobre una serie vacía. (b) `nota-semanal` apuesta a que el reloj avanza —duerme 5 ms y exige `editadaEn !== escritaEn`—, así que con el reloj quieto falla, y en producción fallará el día que dos escrituras caigan en el mismo milisegundo; y `aislamiento-de-usuarios` usa `Date.now()` como **fuente de unicidad** del correo del intruso, de modo que dos corridas en el mismo instante chocan con `auth/email-already-in-use` —y el corredor presenta ese choque como «lo más probable es que el símbolo haya cambiado de nombre», que manda a buscar donde no es: eso último es defecto del **andamio**, no del banco—. (c) `mensaje-de-permiso` y `canal-que-avisa` comparan el «ahora» del proceso contra una marca escrita por el **emulador**, cuyo reloj `fecha-falsa.cjs` no congela —la evidencia lo delata: dice `2026-11-12` y «−2515 h» con hoy puesto en 2027—, así que ésos **no son defecto**: son el límite del instrumento, y además significa que a esos dos no se les puede barrer el calendario con esta herramienta. **Lo que hay que decidir** es si el barrido de fechas entra al corredor o se queda como herramienta de mano: hoy nada vigila que un banco caduque, y el que caduca no avisa el día que se escribe sino meses después, en medio de otra cosa. **DECIDIDO: entra al corredor, y entró después de arreglar lo que habría certificado.** `npm test` repite los bancos que salieron en VERDE con `fecha-falsa.cjs` precargado y el reloj en **15 de febrero del año que viene** —fecha derivada, no tecleada: una constante deja de ser futuro sin que nadie se entere y el barrido se vuelve un segundo «hoy»; y cae en Q1 del año siguiente a propósito, porque cruzar la frontera de año es donde vive la clase (a) y febrero está lejos de la pared de enero del #136—. Un verde de hoy que no lo es en esa fecha sale **CADUCA**, con cifra propia en el resumen, su bloque de detalle y el comando para repetirlo solo; cuenta para la salida 1. Sólo se barren los verdes: de un rojo no hay nada que re-medir. La tabla `NO_SE_BARREN` lleva los **dos** del límite del instrumento (naturaleza (c): la marca la escribe el emulador) más este propio banco, cada uno con su razón **publicada en cada corrida** —una exclusión que no se ve es una exclusión que nadie vuelve a discutir— y una entrada que nombre un archivo inexistente **para la suite**, porque una lista de excepciones sin mantener es una puerta sin llave. Con filtro no se barre y **se dice**; `BARRIDO=no` apaga y también se dice; `BARRIDO=AAAA-MM-DD` es la herramienta de mano de antes. **El orden importó:** las cuatro naturalezas (a) y (b) se arreglaron ANTES de poner la puerta —#136 y #138—, porque meterlas en la tabla de exclusiones habría certificado una mentira y encima para siempre; al cerrar, los únicos no verdes a esa fecha eran los dos del emulador. Defendido en `prueba-corredor-no-se-cuelga.cjs` con un taller propio: un banco de mentira verde hoy y rojo el año que viene, uno que no caduca —un barrido que pinta todo de rojo no distingue nada—, uno excluido con el mismo código que caduca, la fecha derivada **ejecutada** contra cinco «hoy» incluidos los dos bordes del año, y una exclusión fantasma. 32 comprobaciones, **24 mutaciones y las 24 en ROJO**; la que más vale es «barrer sin precargar el reloj falso»: la variable sola no hace nada, y no hace nada en silencio. | CERRADO 2026-11-12 |
| 138 | **Dos bancos usaban el reloj como fuente de identidad: uno apostaba a que avanzaba, el otro a que no se repetía.** Es la naturaleza (b) de las tres del #133. `nota-semanal` dormía 5 ms y pedía `editadaEn !== escritaEn`: con el reloj quieto falla, y en producción fallará el día que las dos escrituras caigan en el mismo milisegundo — o sea que ese día la prueba tampoco habría visto el defecto. Ahora la nota previa llega con una marca de **2020** y la comprobación no depende del reloj; de paso quedó más estricta, porque un código que pise `escritaEn` ya no se salva coincidiendo con el instante de la primera escritura. `aislamiento-de-usuarios` sacaba de `Date.now()` el sufijo de las organizaciones, el nombre de las apps de Firebase, el archivo del mutante y el **correo del intruso**: con el reloj parado el alta de §2 contesta `auth/email-already-in-use` y el banco salía **NO ARRANCÓ** —medido a 2027-02-15: `intruso.1802649600000@ejemplo.com` es el mismo correo en todas las corridas de esa fecha—, así que la conducta se quedaba sin medir. Hoy sale de `randomUUID`, y las 8 mutaciones siguen vistas. **El patrón se midió en vez de suponerse:** hay ~35 sitios más que meten `Date.now()` en un nombre, casi todos archivos temporales; la suite **entera** corrida DOS VECES seguidas con el reloj parado en la misma fecha —que es justo cuando una identidad repetida muerde— da el mismo veredicto las dos veces (116 verde · 2 rojo, los dos del límite del instrumento) y ninguno de esos sitios falla. Tocar los 35 habría sido diff sin conducta detrás. | CERRADO 2026-11-12 |
| 136 | **Tres fixturas armaban una hoja de gasto que GP no puede mandar, y con el reloj movido los bancos medían el producto contra un mundo que no existe.** Escribían doce semanas sueltas en `semanas` y `años: {}`; GP manda los años cerrados **sumados** en `años` y en `semanas` sólo las del año en curso, con la llave sin año (#47), así que una llave `S49` escrita en enero el producto la fecha en el año en curso y cae en el futuro. Las tres ya colocan cada gasto donde la fuente lo pondría, preguntando por el año del **jueves** de la semana, y salen verdes con el reloj en 2027-01-05 / 01-19 / 02-15 / 03-12 / 07-20 / 12-28 y 2028-01-11, con sus contrapruebas en rojo en todas. **Lo que queda escrito y no se tapó:** en las primeras ~3 semanas de enero la ventana tiene **una o dos** semanas que GP puede detallar, así que un tramo de 4 semanas no existe y ninguna fixtura puede fabricarlo — es muro del modelo de datos, no de la prueba. Las aserciones que lo tocan se partieron en dos ramas (ventana rica → la tabla completa; ventana pobre → la cuenta se declara insuficiente y el papel publica el motivo), nunca en una exención. Es la naturaleza (a) de las tres del #133. **Y había una segunda forma de la misma clase, en seis bancos más:** `toISOString().slice(0,10)` sobre un instante que se calculó en LOCAL escribe el día de UTC, o sea la fecha de mañana a partir de las 18:00 en México — y las fechas del barrido caen justo ahí, porque `fecha-falsa.cjs` para el reloj en medianoche UTC. Eso ponía el `inicio` de la obra una semana después que sus snapshots y `series-sincronizadas` medía 9 semanas de las 10 del contrato; de rebote, `reloj-de-la-suite` **no arrancaba**, porque su canario es precisamente que ese banco distinga husos. Corregidos los cinco donde el día es local (`series-sincronizadas`, las dos gráficas, `pagado-sin-ambiguedad`, `ui-dependencia`); los tres que anclan a un instante fijo de mediodía o 18:00Z no tienen el defecto y no se tocaron. El sexto destapó un defecto del producto, el **#137**, y por eso se quedó en UTC con el motivo escrito. | CERRADO 2026-11-12 |
| 139 | **Tres bancos dejaron de medir el mismo día, y por la misma razón: llevaban tecleada a mano la lista de símbolos del módulo que necesita el trozo que extraen.** Es la clase contra la que existe `extraer-de-app.cjs` —su propio preámbulo la nombra: «nombrar lo que eso necesita es mantener una copia del grafo de dependencias, y las copias se desincronizan»— pero `fuenteDe` sólo sirve cuando el banco **sabe qué pedir**, y un trozo que vive DENTRO de un componente (el argumento de un `useEffect`, un `logout`, el `try` de `handleLogin`) no se puede pedir por nombre: se saca por dónde vive, y entonces hay que darle de comer. El 2026-11-12 el efecto de cargar obras adoptó `veTodasLasObras` y `alta-de-organizacion` salió **NO ARRANCÓ** con un `is not defined`, sin medir nada y por una causa ajena a todo lo que mide; `logout` pasó a llamar a `olvidarSesion` y `ui-dependencia` y `el-canal-no-grita-en-falso` cayeron igual. La forma de fallar es la peor que hay: **hacia el no-veredicto**, y el mensaje apunta al archivo medido en vez de al andamio. **Hecho:** `cierreDe` en `extraer-de-app.cjs`, el sitio único. Lee los identificadores **libres** del trozo —parseándolo, no con una regular, y envuelto en una flecha para que lo que el trozo declara quede atado y no se le invente una carencia—, y le pide a `fuenteDe` el cierre transitivo de los que sí son de nivel superior. Tolerante a propósito: lo que nombra y no está arriba son sus propias locales. `excluir` saca del cuerpo los que el banco inyecta con un doble, porque una declaración de verdad pisa al doble y entonces el banco mide la app en lugar de medirla con el doble puesto. Los tres bancos ya pasan por ahí, y los dos de `logout` **arman el `olvidarSesion` de producción** en vez de imitar el desmonte: la imitación habría dejado al `check` del prefijo diciendo «quedó limpio» sobre su propia copia. Las tres mutaciones de App.jsx del banco del alta se volvieron a medir y las tres siguen en **ROJO (1)**, no en 2; la de `ROLES_CROSS` pasó de 2 a **8** rojos, porque el login ahora se ejecuta con el arreglo de verdad pegado. **El resto se midió en vez de suponerse, y no se tocó:** quedan **137 sitios en 18 bancos** que pegan un símbolo a mano (`ui-dependencia` 50, `alta-de-obra` 22, `nomina-no-guarda-callado` 18). Convertirlos es diff sin conducta detrás —el precedente es el #138, los ~35 `Date.now()`—, y el que muerda se arregla con una línea ahora que el mecanismo existe. `obras-del-auditor` se dejó con el suyo a propósito: el de él tiene que **distinguir** un local de `PantallaObras` de un símbolo del módulo de uno que no es ninguno de los dos, y negarse a medir en el tercer caso; `cierreDe` perdería esa negativa. **Mordieron seis al día siguiente y la regla se aplicó.** El #131 unificó las lecturas del dinero de una estimación y el 2026-11-13 salieron **tres NO ARRANCÓ** —`estado-de-cuenta`, `kpis-retencion-y-anticipo` y `estimaciones-dependencia`, los tres con `sumaDeEstimaciones is not defined`, el último **dentro del render de React** y con el rastro apuntando a react-dom— y **tres ROJO falsos**: `el-estado-de-la-obra-se-guarda` publicando «LA TARJETA SE CAYÓ AL PINTARSE», `tabla-dependencia` diciendo «no hay clave de contratista que extraer de este archivo» porque exigía por sitio un `_ne` local que se borró **justamente por ser duplicado**, y `ningun-anclaje-apunta-al-vacio` con cuatro anclajes al vacío. Los seis pasaron a `cierreDe`; ninguno se arregló agregando un nombre a una lista. **El ROJO falso es peor que el no-veredicto:** un NO ARRANCÓ dice «no medí», un ROJO afirma que hay un defecto y manda a buscarlo donde no está. | CERRADO 2026-11-12 · ampliado 2026-11-13 |
| 132 | **Un banco que le pide a `no-arranco.cjs` un nombre que no existe se queda sin su puerta de «no pude mirar», y nada lo avisa.** Los bancos hacen `const { sinPrecondicion } = require('./no-arranco.cjs')` sobre un módulo que exporta una **función** con propiedades; si el nombre se escribe mal o se renombra en el módulo, el destructurado deja `undefined` y la llamada sólo revienta **cuando la precondición falla** —o sea, exactamente el día en que hacía falta—. Hasta entonces el banco sale verde sin su tercer estado: el NO ARRANCÓ (2) se degrada en silencio a 0. **Lo que falta es el guardia**, no el arreglo: los cinco sitios que estaban mal ya se corrigieron, pero nada impide el sexto. Encaja con el #129 (el canario de la contraprueba): las dos son la misma clase —el andamio de las pruebas fallando hacia el verde— y se arreglan juntas o se repiten. **Hecho el 2026-11-12:** el módulo se exporta envuelto, y pedirle un nombre que no tiene **contesta** en el momento del destructurado —con el nombre que se pidió, la lista de los que hay, y salida **2**—. Se contesta con el código directo en vez de lanzando, y es la diferencia que importa: lanzar sale con **1**, el mismo código que un rojo, porque a esa altura del archivo `vigilarExcepciones` todavía no está puesta; y aunque lo estuviera, un banco que pide la puerta del «no pude mirar» no tiene con qué reportar que no pudo mirar. Lo que no puede pasar es que la respuesta sea `undefined`. **Las dos formas del hueco se miden, no sólo la del typo:** `sinPrecondicon` sin la `i` —el error que estuvo cinco veces en el repo— y una puerta **renombrada aquí** que el banco sigue escribiendo bien, que es la que nadie va a teclear a propósito. Pasan sin preguntas los símbolos, lo que hereda de `Function` y una lista corta de nombres que pregunta el MOTOR y ningún banco escribe: `then`, `toJSON`, `inspect`, `default`, `__esModule`. **Esa lista se midió, no se adivinó:** el primer intento dejó `toJSON` fuera, y el propio banco lo puso en rojo con un `JSON.stringify` sobre el módulo. Matar el proceso ahí habría cambiado un defecto por otro peor —un banco que muere al imprimir un diagnóstico— y habría sido el mismo error de hoy escrito al revés. Banco `prueba-la-puerta-del-no-arranco.cjs`: **13 comprobaciones, 7 mutaciones y las 7 en ROJO (1), ninguna en 2**. No afirma que exista ningún `Proxy` ni ningún nombre: escribe bancos de mentira en /tmp, los corre en procesos **hijos de verdad** y mira el código de salida, que es lo que la suite lee para clasificar; la conducta entera es «qué le pasa al proceso» y eso no se ve desde dentro. Se mide además que el guardia **no tapia las puertas buenas** —si lo hiciera, los 129 bancos dejarían de arrancar a la vez— y que requerir el módulo sigue fijando `TZ`, que es el efecto de carga del que cuelgan todas las fechas. Las 7 mutaciones y sus conteos quedan en el propio archivo. | CERRADO 2026-11-12 |
| 129 | **Una contraprueba que salía verde porque su propio canario estaba roto, y dos mutaciones que mutaban código muerto.** `prueba-el-semaforo-mide-contra-el-anexo.cjs` (#51, el avance contra una recta) anclaba su calendario al **día 1** del mes: lo programado está cuantizado por meses y no se mueve, pero la recta que el canario usa de referencia avanza todos los días, así que el margen se iba cerrando dentro del mes. El 2026-11-12 falló por **una décima** (`90 > 90.1`) con un `± 20` tecleado a mano. Medido día por día sobre los 400 siguientes: con el ancla del día 1 el peor caso es **14.66 pp**, o sea que iba a seguir fallando por turnos. Re-anclado al **mismo día del mes** —la recta se queda entre 66.3 y 67.1— y el umbral **ya no se teclea: se le pregunta a la regla**, barriendo el avance hasta que deja de callar (10.1 pp). **Los dos arreglos hacen falta, y se comprobó por separado:** con el umbral preguntado pero el ancla vieja, el 2027-01-31 la recta llega a 75.3 y el segundo canario cae igual (15.3 pp contra un umbral de 10.1). Bajar el número tecleado habría tapado el rojo de hoy y dejado puesta la trampa. **Lo caro no era el rojo intermitente.** Arreglado el canario, la contraprueba pasó de 7 mutaciones en rojo a **2 sobrevivientes**: las dos que reponen la recta mordían únicamente por el canario averiado, o sea que la contraprueba se estaba comprobando contra su propia avería. Y al medir por qué sobrevivían salió que lo que de verdad sostiene la conducta no es el guardia del detector sino **`requiere: ['kpis','programa']`**, que hace que el motor ni llame a `detect` — una recta puesta dentro del detector es código muerto. Nada afirmaba esa cerradura: se podía quitar el anexo de `requiere` y la prueba entera seguía verde. Dos aserciones nuevas (sin anexo la regla sale como **no evaluable** y el hueco **nombra** el anexo) y una mutación nueva que abre la puerta sola. El corredor de mutaciones admite varias sustituciones y exige que **cada una** cambie algo, porque una sustitución que escribe lo que ya estaba deja al mutante vivo sin haber ocurrido. **21 aserciones, 8 mutaciones en ROJO, y 802 corridas —prueba y contraprueba en cada uno de 401 días con el reloj corrido— en verde.** | CERRADO 2026-11-12 |
| 93 | **El correo del lunes imprime `$0` de gasto cuando no supo medirlo, y lo pinta con semáforo de color.** Es el #88 (la tarjeta de obra que afirmaba margen sin tener gasto) en el canal de los directivos, y es peor: una pantalla se corrige recargando, un correo enviado no. `calcularKpisObra` en `functions/index.js` arranca `totGP = 0`, intenta tres formas de cruzar la obra contra GP —por `gpId`, por clave de 4 dígitos, por nombre normalizado— y **si ninguna pega, se queda en 0 sin decirlo**: no tiene el par `gastoGPMedido` / `gastoGPMotivo` que el front sí tiene desde el #88. El renglón de la obra dice «$0 · 0%» en verde, y el mosaico de «Gasto acumulado» del portafolio **suma ese cero** como si fuera una medición. Hay tres causas sanas de que no pegue —el #53 (la API de gastos de fosedy.org) caído, una obra que gobierno estima en vez de gastar, una obra de otra empresa— y las tres se leen igual. **El correo tiene que aprender a callarse antes de rediseñarse**, así que esto va primero que el #94 (el contenido del lunes). **Hecho:** `estadoGastoGP` —el traductor del #88, con sus nueve motivos— copiado **literal** a `functions/index.js`, que era el único de los dos archivos que escribía `obrasPedidas` y no la leía; la asimetría entre `obras` y `obrasPedidas` es el dato que distingue «GP midió cero» de «GP no midió», y no se inventa nada. `calcularKpisObra` arrastra ahora `gastoGPMedido` / `gastoGPMotivo`, el renglón dice **«sin medir»** en gris y en cursiva en vez de una cifra —y tampoco imprime el «X% de $contrato», que es la mentira silenciosa: se lee como obra baratísima cuando lo que falta es el sumando grande—, con una línea que dice **por qué** (`alta posterior a la última corrida de GP`, `no hay corrida de gasto`, `sin clave de GP capturada`, `la corrida no dice qué obras pidió`), porque «sin medir» a secas invita a llamar a alguien un domingo por algo que se arregla solo en la siguiente corrida. El mosaico de «Gasto acumulado» **sigue sumando** esas obras y **declara** que va corto, igual que `obrasGastoSinMedir` en la pantalla: excluirlas daría dos totales del mismo dinero, que es este mismo defecto al revés. En un cron la consola es el único sitio donde alguien diagnostica, así que cada hueco deja rastro con `console.warn`. Banco `prueba-el-gasto-sin-medir-no-es-cero.cjs`: corre **las dos copias** sobre la misma matriz de 11 entradas y exige el mismo veredicto, y además que sea el correcto —comparar el texto de los dos archivos se rompería con un comentario y no con una rama que cambia de signo—; extrae y **ejecuta** `calcularKpisObra` y `correoResumenSemanal` sustituyéndoles el cargador de módulos, no el código. 42 comprobaciones, **17 mutaciones y las 17 en ROJO**. Dos rojos propios en el camino valieron la pena: la aserción del importe buscaba la cifra en todo el HTML, y el total **sí** debe imprimirla; y el rastro de consola se cumplía solo porque el aviso de la pantalla, que es idéntico, caía en el mismo buzón. De paso, `prueba-avance-sobre-contrato.cjs` tenía su propio extractor con la lista de dependencias **a mano** y reventaba cada vez que una función de producción estrenaba una: pasó a `fuenteDe`, que cierra transitivamente. **Desplegado el 2026-11-04**, canario `resumenSemanalEmail` sola y después las 21 restantes, sin borrados; el verificador dice que las 22 corren el `index.js` del repositorio y una llamada sin sesión contesta `401 UNAUTHENTICATED` con el mensaje propio de la app, que es la respuesta de una función que carga bien. **El correo se leyó el 2026-11-04**, con `scripts/muestra-correo-a-un-buzon.cjs`: corre la `generarYEnviarResumenSemanal` desplegada contra producción en sólo lectura y le **intercepta el sobre** antes de Resend, así que lo que se ve es byte por byte lo que sale —un previo que re-orquesta los pasos deja de ser un previo en cuanto el cron cambie uno—. Siete celdas, siete cifras, seis en verde y una en ámbar; nada en gris, nada en cursiva, ningún «va corto». **La guarda del #93 hoy no se dispara, y está bien:** `obrasPedidas` trae las siete claves y `obras` también, o sea que GP midió las siete (`medido` en todas, de `$22,213` a `$101,533,303`). Se verá el primer lunes después de un alta a media semana, o si el #53 (la API de gastos de fosedy.org) se cae. **No se le abrió un parámetro de destino a `probarResumenSemanal`** a propósito: un disparador autenticado capaz de mandar el portafolio a una dirección cualquiera es una puerta, no una herramienta. | CERRADO 2026-11-04 |
| 87 | **El renglón de `logout` sí quedaba, y el canal gritaba que no.** `addDoc` manda `Precondition.exists(false)` y el id lo genera el cliente: `already-exists` dice que **esa misma mutación ya se escribió** —el stream la reintentó sin haber recibido el acuse—, no que falló. El canal del #75 gritaba por un renglón que estaba, y encolaba una copia que al drenar aterrizaba como segundo renglón con el mismo `ts` (medido: dos `logout` con el sello `17:31:16.543Z`). La carrera la abría `logout`, que no esperaba el renglón antes de `signOut`. Arreglado en los tres sitios: el orden en `logout` —con tope, para que sin señal el botón de salir no se cuelgue—, la clasificación en los dos escritores de la bitácora, y el drenado de la cola, que ya no reintenta lo que está escrito ni se lo cobra como entregado. La carrera se reproduce determinista contra el emulador. **Desplegado el 2026-11-03**, comprobado en el bundle vivo (`index-f51a78f8.js`) por conducta y no por frases: el `await Promise.race` con su tope `3e3` va antes del `signOut`, y la clasificación quedó llamada desde los tres sitios. **Lo que NO se ha medido en producción es un cierre de sesión real**: eso pasa cuando alguien salga. | CERRADO |
| 86 | **La respuesta de una Cloud Function leída del SOBRE da `undefined`, y la pantalla sigue.** `callFn` devuelve `{ok, data}`; `r.correo` en vez de `r.data.correo` no explota, el `if` no entra y nadie se entera. Tres sitios el 2026-11-02, entre ellos la alerta de «la cuenta existe y NADIE tiene su contraseña», que **no podía dispararse nunca**. Patrón cerrado en todo el repo con la §6 de `prueba-escritura-que-no-miente.cjs`. **Desplegado el 2026-11-03**, comprobado por frases dentro del bundle vivo (`index-bc9359d9.js`): las tres cadenas de la alerta están arriba y la del campo de contraseña que se quitó ya no. | CERRADO |
| 109 | **El corredor preguntaba por UN puerto y clasificaba como si hubiera preguntado por todos.** `npm test` sobre `main` salió `SE COLGÓ · reglas-dependencia-captura · sin contestar en 240 s` y no había nada lento: los emuladores se habían levantado con `--only firestore,auth` —el comando que **sugiere el propio informe**, fijo en el código desde que la lista se escribió— y ese banco es el único del repo que ejercita `storage.rules`. Con el 8080 vivo pasó el filtro `hayEmulador`, arrancó, corrió ocho secciones en verde y el SDK de Storage se quedó reintentando contra el 9199 muerto; la cola publicada traía ruido de gRPC de **Firestore** y no mencionaba Storage por ninguna parte, así que el informe mandaba a buscar un banco lento. Cuatro minutos para no medir nada. **Cerrado:** `NECESITAN_EMULADOR` pasó de lista de archivos a tabla de **qué emuladores necesita cada banco**, se pregunta por cada puerto, y un banco al que le falta uno **no se corre** —clasificarlo bien y correrlo igual deja la terminal quieta de todos modos—; el renglón dice `falta storage` y el consejo arma el `--only` **desde la tabla**, que es lo que impide que el informe vuelva a ser la causa del punto ciego. Y el patrón se cerró en los **ocho** bancos de emulador, no en el que falló: `exigirPuertos` en `no-arranco.cjs` sondea con plazo propio **antes de la primera aserción** y sale **2** nombrando el puerto —medido: 0.5 s en vez de 240—, porque llegar a la novena sección y declarar entonces que no se midió nada deja ocho verdes publicados sobre un entorno incompleto. Defendido por conducta en `prueba-corredor-no-se-cuelga.cjs`: dos servidores de mentira hacen de Firestore y Auth vivos, Storage apunta a un puerto que nadie escucha, y el banco falso lleva el **nombre real** para que lea la tabla de verdad; si se dejara caer también Firestore el informe diría «faltan los tres» y la sección estaría verde sin distinguir al que no se veía. 4 comprobaciones nuevas, **14 mutaciones y las 14 en ROJO**. Suite completa en `main`: **97 en verde**. | CERRADO 2026-11-06 |
| 44 | **Un banco apuntado a un puerto muerto cuelga la suite** en vez de fallar: no hay plazo y el silencio no grita. **Cerrado el 2026-10-26.** El corredor da a cada banco **240 s** (`PLAZO_BANCO`, con `killSignal: 'SIGKILL'`) y «SE COLGÓ» es un **cuarto estado** junto a verde / ROJO / NO ARRANCÓ: se nombra el archivo, se dice `sin contestar en N s`, y cuenta para la salida 1. El plazo tiene **piso de 10 s** a propósito: sin él, un `PLAZO_BANCO=0` mal puesto reportaría cada banco sano como colgado, que es la mentira espejo de la que se está arreglando. Banco `prueba-corredor-no-se-cuelga.cjs`: monta un repositorio de juguete en `/tmp` con cuatro bancos falsos —uno que se conecta a `10.255.255.1:1` y espera 600 s, uno verde, uno rojo y uno que tarda 2 s y sale verde— y corre el corredor de verdad sobre ellos. 8 aserciones, contraprueba de 6 mutaciones, las 6 vistas. **Una de las mutaciones salió NO LA VE y eso fue el hallazgo:** «no contar las colgadas al salir» se veía verde porque el banco ROJO falso ya forzaba la salida 1 — el rojo le prestaba su código de salida a la colgada. Una cuenta por número: se añadió una segunda corrida filtrada donde el colgado está solo. | CERRADO |
| 20 | **Integrar la verificación de ámbito de forma permanente** (hoy es un guion que alguien se acuerda de correr). **Cerrado el 2026-10-26.** El proyecto no tiene linter y `src/App.jsx` pasa de 23 mil líneas: un identificador sin declarar atraviesa el build de Vite sin un ruido y revienta en la pantalla del usuario. `verificar-ambito.cjs` ya contestaba la pregunta desde el 2026-09; lo que faltaba era que no dependiera de que alguien se acordara — y la clase de defecto que atrapa es justo la que aparece cuando uno anda con prisa, que es cuando no se acuerda. `prueba-ambito-declarado.cjs` **ejecuta la herramienta**, no la copia: si la herramienta se rompe, el banco no arranca (2). La lista de archivos no se teclea —`readdirSync` sobre `src/` más `functions/index.js`—, porque un archivo nuevo que nadie agregara sería un archivo sin revisar. Dos aserciones: cero identificadores libres, y que los 7 archivos recibieran veredicto de verdad (sin la segunda, un argumento mal pasado daría verde por no haber mirado nada). 4 mutaciones sobre copias de `src/rutas-org.js` —llamada inexistente, renombre a medias, variable perdida en un bloque, typo en un helper propio—, las 4 vistas. | CERRADO |
| 46 | **El aviso de «tu rol cambió» puede dispararse al cambiar de sesión** — un `useRef` que no se vacía. Sin confirmar. **Medido el 2026-11-12: la sospecha era falsa y el defecto real es otro.** El `useRef` sí se vacía al desmontar; lo que no se rearma es el efecto, que depende de `[usuario?.emailId]` y por eso tiene el `usuario` del login congelado encima. A la SEGUNDA modificación de la misma sesión el «antes» seguía siendo el del login: a quien subían de residente a superintendente y luego a gerente le repetían «Tu rol cambió a Superintendente», y a quien le agregaban una obra y luego otra, «Se agregaron 2 obras» cuando acababa de llegar una. Decir mal CUÁNTO es inventar una cifra sobre lo único que el usuario no puede comprobar desde ahí. El ref guarda ahora el perfil visto —versión, rol y obras—, que es la misma autoridad con la que se arma el aviso. Banco `prueba-las-lecturas-y-la-sesion.cjs`. | CERRADO 2026-11-12 |
| 40 | **La lectura del GP Sheet arranca antes de que haya sesión.** **Cerrado el 2026-11-12, y lo que dañaba no era arrancar antes sino no volver a intentarlo.** `activo` valía `!esDependencia(usuario) && !esPlataforma(usuario)`, y los dos cortes son falsos con `usuario === null`: al montar se pedía `global/gp_construct` sin credencial, Firestore contestaba `permission-denied` —clasificado terminal, y lo es para esa lectura— y el estado quedaba en `'error'`. Al entrar una constructora `activo` seguía valiendo `true`: no CAMBIABA, así que el efecto no se rearmaba y la sesión a la que sí le toca el Gasto Programado se pasaba entera con el chip ámbar «Gasto GP · no disponible». Ahora tiene tres valores (`null` sin sesión), y el chip lee `GP_SIN_VEREDICTO` en vez de una lista escrita a mano: sin eso, el ámbar se habría asomado en la ventana entre resolver la sesión y contestar la lectura, anunciando la falla de una petición que acababa de salir. Banco `prueba-las-lecturas-y-la-sesion.cjs`; verificado en el preview, el chip dice «hace 3 h». | CERRADO 2026-11-12 |
| 58 | **`+ Nueva estimación` produce `no: NaN` si alguna estimación guardada no trae `no`**: calcula con `Math.max(...es.map(e=>e.no))`. El renglón sale como «EST-NaN» y el siguiente también. El `key` ya no depende de `no` (#59), así que no rompe el pintado, pero el número de estimación sí queda inservible. **Medido en producción el 2026-11-05** (`scripts/medir-el-relleno-que-pasa-por-medicion.cjs`, sólo lectura por construcción): las 34 estimaciones guardadas de las 7 obras traen su `no`, o sea **está LATENTE** — lo dispara la primera fila que entre sin numerar, y la dispara **para toda la obra**, no para la fila mala, porque `Math.max` con un solo `NaN` adentro devuelve `NaN`. **Hecho el 2026-11-05, y el `NaN` resultó ser el síntoma menos grave de los cuatro.** El rótulo se decidía en **nueve** sitios con tres rellenos distintos, y el peligroso no era el `NaN` —nadie cree que exista la EST-NaN— sino los dos `?? i+1` y `|| i+1`, que tapan el hueco con la **posición del renglón**: «EST-04» es un rótulo perfectamente creíble y es falso, porque el consecutivo lo fija el oficio del cliente, no el lugar en pantalla. Ahora hay una cuenta (`noDeEstimacion`, `siguienteNoDeEstimacion`) y un rótulo (`rotuloEstimacion`), y cuando el número no está se dice: `EST-s/n`, visible a propósito para que quien lo vea pueda teclear el que falta. De paso se corrigió un defecto real que estaba a la vista: cuatro avisos imprimían `` `EST-0${e.no}` `` y para la estimación 12 publicaban «EST-012». **El tercer defecto lo encontró el banco, no yo, y estaba en el papel que se firma:** la tabla de estimaciones del expediente filtraba `e.no && e.monto>0`, así que la estimación sin numerar **desaparecía del cuerpo de la tabla y seguía contada en el renglón TOTAL de esa misma tabla** — el documento salía con tres firmas al pie, una tabla que no cuadra con su propio total, y la diferencia sin nombre ni renglón. Faltar el `no` es faltar la **etiqueta**, no el dinero. **El cuarto lo encontró el preview:** las dos tablas ordenaban con `(Number(a.no)\|\|0) - (Number(b.no)\|\|0)` y ese `\|\|0` es el mismo relleno con otra cara — le da el lugar 0 a la fila sin numerar, o sea la mete **antes de la primera**, y como el acumulado se suma en ese orden, el renglón de la EST-01 publicaba su monto más el de una fila que no tiene lugar en la secuencia, mientras el pie de la misma tabla afirmaba que el acumulado va «por número de estimación, de la 1 en adelante». Visto en el emulador: `$6,050,000` donde la EST-01 vale `$4,200,000`. Nace `ordenDeEstimaciones`, las sin numerar van al final, y el pie **dice** cuántas hay y que su acumulado es el total de la relación, no un punto de la secuencia. Banco nuevo `prueba-un-numero-que-nadie-midio.cjs` (compartido con el #79 del 999, misma naturaleza): 9 secciones, **22 mutaciones en ROJO**. Mueve el PDF de verdad con el jsPDF falso de `lienzo-pdf.cjs`, al que hubo que **enseñarle a anotar `autoTable`**: el `Proxy` se lo tragaba como a cualquier método imprevisto, así que la tabla principal del expediente era invisible para los cuatro bancos que usan ese doble. Dos aserciones vacuas propias se cazaron en el camino —una comparaba el rótulo del hueco contra la constante que lo produce, o sea contra sí misma— y una vive ahora en la sección que protege al banco. El orden de las dos tablas lo vigila `prueba-estado-de-cuenta.cjs`, que las renderiza; mi banco no monta componentes y una mutación ahí se habría ido en «NO LA VE». Verificado en el preview con una estimación sin numerar de $1,850,000 sembrada en el emulador. | CERRADO |
| 77 | **El respaldo semanal registra «OK» cuando ARRANCA, no cuando TERMINA.** `backupSemanalFirestore` lanza el export de Firestore —que es una operación asíncrona de larga duración— y acto seguido escribe `registrarSalud("backup", true, "Iniciado: gs://…")`. Nadie vuelve a mirar esa operación nunca. Si el export muere después de arrancar —cuota, permiso revocado a media corrida, export parcial—, el panel se queda en verde para siempre y el correo no dice nada. **El #75 cerró la mitad equivocada de este agujero**: ahora un fallo al *lanzar* sí se grita, pero un fallo *después* de lanzar sigue siendo invisible. Un respaldo que miente se cree, y encima el **#5** sigue abierto: la restauración nunca se ha probado. **Medido el 2026-10-23, y la noticia es buena:** las cuatro corridas de octubre (09-27, 10-04, 10-11, 10-18) SÍ terminaron — las cuatro tienen su `.overall_export_metadata` en `gs://campo-fosmon-backups/firestore/<fecha>/`, con 36, 36, 41 y 43 objetos. O sea que hoy el respaldo existe; lo que no existe es la comprobación. El arreglo es consultar la operación (`operationName` ya se guarda en el registro de salud) y registrar el estado REAL, no el de arranque. **ARREGLADO EN CÓDIGO el 2026-10-23, FALTA DESPLEGAR.** La corrida ahora espera a que la operación llegue a un estado terminal (`timeoutSeconds: 540`, plazo de espera 420 s, una consulta cada 15 s) y registra **tres** salidas, no dos: `SUCCESSFUL` → verde; `FAILED`/`CANCELLED` → rojo con el error de la API; **no terminó dentro del plazo → rojo con `verificado: false`**, porque «no se pudo verificar» no es «salió bien» (P2 en versión booleana). Un fallo al CONSULTAR se reintenta y queda como `ILEGIBLE`, no como fallo del export: son dos averías con dos reacciones. `probarBackup` tenía el mismo `ok: true` por arranque y también se arregló; ahora devuelve `ok` y `verificado` por separado. Y un export que vuelve sin `operationName` se rechaza: lo que no se puede vigilar no se puede declarar bueno. Banco: `scripts/prueba-respaldo-verificado.cjs`, 58 aserciones, 11 mutaciones, todas en ROJO 1. **DESPLEGADO el 2026-10-23 20:46Z** (acotado a `backupSemanalFirestore,probarBackup`; revisiones `00007`, `timeoutSeconds` 540 y 120 — valores que sólo existen en el código nuevo, así que la verificación del despliegue no depende del panel). **Y la primera corrida de verdad ya pasó**: domingo 2026-10-25 03:01 CDMX dejó `ok:true · estadoExport:"SUCCESSFUL" · verificado:true · consultas:6 · "Completado: …/2026-10-25 (verificado en 75 s)"`, contra el `"Iniciado: …"` en 585 ms del 10-18. Contrastado con el bucket, que es la fuente que no pasa por nosotros: el `.overall_export_metadata` del 25 se escribió 09:01:06Z y el registro dice verificado a las 09:01:19Z. Las dos cuentan lo mismo. | CERRADO |
| 76 | **`recordatorioCapturaSubs` corre en producción sin fuente, y ya NO está callada.** Se retiró del código en `f6d32be` (2026-09-23) con el #31, porque leía `obras/{id}/subcontratos/historial_{subId}` — una ruta que nunca tuvo regla de escritura y que por tanto nunca existió, así que su `yaCapturado` era permanentemente falso. El commit lo dejó escrito: *«el día que alguien capturara un concepto, habría insistido para siempre sobre un cierre que el sistema no puede registrar»*. **Ese día ya llegó.** No se desplegó el retiro, así que el cron sigue vivo: viernes 12:00 CDMX, y en `global/health` tiene corridas en verde el 09-25, 10-02, 10-09, 10-16 y **hoy 10-23**, con «2 notifs, 2 subs sin captura». Manda **notificación interna de campanita** (`notificaciones/{uid}/items`, `tipo:"captura_sub_pendiente"`), **no correo**. Destinatarios reales, medidos: `jislas@fosmon.com.mx` (superintendente, CENTRO DE CONVENCIONES MTTO, 4 avisos) y `atorres@fosmon.com.mx` (administrador de obra, SIOP COATZA MALECON, 8 avisos). **12 avisos acumulados y los 12 sin leer.** Dos personas reciben cada viernes un recordatorio de que cierren algo que la aplicación no puede dejarles cerrar. **CERRADO el 2026-10-23 con las dos decisiones de Oscar.** (1) La función se retiró de producción: `firebase functions:delete recordatorioCapturaSubs --region us-central1` → *Successful delete operation*, y con ella se fue su trabajo de Cloud Scheduler del viernes 12:00. (2) Los 12 avisos se **BORRARON**, no se marcaron leídos: marcarlos leídos dejaría escrito que dos personas leyeron algo que nunca leyeron, y encima dejaría la petición imposible visible en su campanita. El guion es `scripts/retirar-avisos-huerfanos.cjs` (pasa por `destino.cjs`, vuelca los 12 documentos íntegros a JSON antes de borrar, y **vuelve a leer** en vez de confiar en su propio contador: quedan 0). Los `captura_obra_pendiente` y `sin_captura_10d` de esas dos campanitas **no se tocaron**: vienen de crones vivos y piden algo que sí se puede hacer. | CERRADO |
| 78 | **Un trabajo programado que revienta tiene que LANZAR — y uno de los seis no dejaba constancia.** `recordatorioCapturaObra` y `recordatorioLunes` cerraban su `catch` sin `throw e`: Scheduler sólo reintenta y sólo alerta sobre lo que falló, así que una corrida reventada quedaba firmada como exitosa, sin reintento, sin alerta, y con la única constancia en una pantalla que alguien tiene que acordarse de abrir. Es el #75 por el otro extremo: allá se callaba el canal, aquí el trabajo, y el silencio viene firmado como éxito. **Y el banco encontró una SÉPTIMA aparición del P7 donde menos convenía:** en `vigilarDenegaciones` —el vigilante que existe para que los demás no se callen— `const db = admin.firestore()` estaba **fuera** del `try`. Si eso reventaba, el `catch` no corría: la función sí lanzaba, pero `global/health` no recibía nada y pasado el plazo la pantalla decía «sin correr», que es falso — sí corrió, lo que no pudo fue arrancar, y son dos averías con dos reacciones. Movido adentro. Banco: `scripts/prueba-cron-que-no-se-traga-su-fallo.cjs`, **que no pregunta por estos tres sino que recorre todos los `onSchedule` del archivo**, así que el trabajo que alguien agregue mañana entra solo; si extrae menos de 6 sale NO ARRANCÓ en vez de verde por vacío. Cada manejador se ejecuta de verdad con su mundo sustituido por minas —objetos que estallan al rozarlos— y se le exige lanzar, dejar constancia y no dejar ningún verde escrito; las tres juntas, porque por separado cada una se cumple de la forma equivocada. 18 aserciones, 6 mutaciones, las 6 vistas en ROJO 1. **DESPLEGADO 2026-10-27 18:29Z** — `recordatorioLunes`, `recordatorioCapturaObra` y `vigilarDenegaciones`, acotado por nombre: los tres ya existían en producción, así que fueron tres reemplazos y cero altas (`crearOrganizacion` sigue sin desplegar, a propósito). Verificado bajando el paquete de `gcf-v2-sources` y comparando su `index.js` con el del repo: mismo SHA-256, y dentro, un `throw e` en el `catch` de cada uno de los dos recordatorios. | CERRADO 2026-10-27 |
| 79 | **Un banco que no pudo MEDIR salía en rojo, como si hubiera medido mal.** Apareció como no determinismo: el 2026-10-26 `prueba-el-destino-se-escribe` dio ROJO ×3 bajo la suite y VERDE seis veces seguidas en aislamiento. Causa: su §7 le pregunta al `firebase` de verdad a dónde desplegaría sin `--project`, y el único no-arranque contemplado era `ENOENT`. Cualquier otra forma de que el CLI no conteste —plazo de 60 s, configstore tomado por otro `firebase`, sesión caducada, red al buscar actualización— dejaba la salida sin la respuesta y disparaba las tres aserciones: el banco acusaba al destino de haber cambiado cuando lo roto era el instrumento. Es el P4 por el lado que no se mira: tres estados, y «no pude mirar» es el tercero. Arreglado exigiendo que el CLI haya contestado la pregunta —procedió (0) o dijo «No project active»— y mandando todo lo demás a NO ARRANCÓ (2), que en la suite grita igual pero no manda a nadie a buscar una regresión que no existe. **No afloja la medición, y está medido con dobles del CLI:** reponer el `default` → ROJO 1; borrar los alias → ROJO 1; credencial caducada → NO ARRANCÓ 2. **El patrón se barrió en todo el repo**, y había una segunda: `prueba-puente-color` imprimía «NO ARRANCÓ» en tres sitios —sin Chrome, sin DOM, sin salida de la página— y salía con **1**; la suite clasifica por código, no por texto, así que los contaba como rojos de color. Los tres pasan ahora por `sinPrecondicion`. **Queda apuntado, no hecho:** los bancos de emulador salen con 1 cuando no logran conectar (`prueba-cierre-emulador` 186/195, y sus pares). Hoy lo tapa el sondeo `hayEmulador` de la suite, que los marca «sin emulador»; el día que el emulador esté arriba pero el banco no pueda entrar, vuelve a ser un rojo que miente. | CERRADO |
| 75 | **El canal con el que pensábamos enterarnos era de los que no avisan** — P7, apariciones 5ª y 6ª, cerradas en la misma tanda porque son el mismo defecto. `registrarSalud` terminaba en `catch { console.warn("fallo silencioso") }`: el nombre lo decía. No producía «no se registró», producía algo peor — Scheduler daba la corrida por **exitosa** (la función no lanzaba) mientras `global/health` se quedaba con el registro anterior, así que la pantalla, pasado el plazo, decía «sin correr» en rojo. «Sin correr» es una afirmación sobre el dato y ahí es **falsa**: sí corrió, lo que no se pudo fue anotarlo — y las dos averías piden reacciones distintas. Ahora lanza, y el camino de fallo va por `registrarFalloDeSalud`, que conserva el error original en `cause` y nombra el segundo. `fsAudit` devolvía `undefined` pasara lo que pasara; ahora devuelve booleano y lo que no se pudo escribir se encola **con su ruta** (sin ella, la fila de un municipio aterrizaba en la bitácora de la constructora al drenar: la fuga del #73 entrando por detrás). **Y como escribir la fila no es enterarse** —4,201 filas de actividad normal al 2026-10-23—, se añadieron los dos empujones: el cron diario `vigilarDenegaciones` (8:30 CDMX, plazo 36 h, para que el vigilante tenga vigilante) pone el conteo en el semáforo, y el resumen semanal lo manda por correo. El semáforo da el **estado**, el correo da el **aviso**; un semáforo que nadie abre no entera a nadie. Se descartó un callable: sería un endpoint público cuyo único trabajo es aceptar cadenas arbitrarias y escribirlas saltándose las reglas. **Medido contra producción antes de diseñar:** `collectionGroup("auditoria")` falla con `FAILED_PRECONDITION` en las tres variantes —los índices de un campo que Firestore crea solo son de alcance COLECCIÓN, no de grupo—, así que se recorre colección por colección y **no hace falta desplegar ningún índice**. Dos defectos encontrados por el banco al escribirlo: el conteo se construía dos veces en `fsAudit` (una cuenta por número), y el registro de salud se fundía con el de la corrida previa por el merge profundo de `merge:true`, dejando un `denegaciones:1` de la corrida buena encima del registro de la fallida. Bancos: `prueba-canal-que-avisa.cjs` (44 aserciones, código extraído por AST y corrido contra el emulador, 10 mutaciones y las 10 vistas) y `prueba-mensaje-de-permiso.cjs` (34 aserciones, 7 mutaciones). | CERRADO |
| 62 | **La carga a granel abre oyentes sobre obras que no son del usuario.** Quién PIDE ya está acotado (`necesitaDatosDeCartera`) y qué se ENTREGA también (`seSuscribe` por tipo, el P5 intacto), pero la lista sobre la que itera son las obras activas, no las asignadas. A un `auditor` con `todas_obras:false` el concentrado sí le filtra —medido— mientras que el granel no: hoy se tapa con las reglas de Firestore, que es un fallo de permiso por obra, no un acierto de diseño. **Cerrado el 2026-11-12.** «Qué obras son las de esta sesión» se contestaba en tres sitios con tres cuentas distintas; ahora es una (`obrasDeLaSesion`), y la llave del efecto del granel es **esa misma cuenta**: por eso una revocación a media sesión ahora sí suelta los nueve oyentes por obra, que era el hueco que las reglas no tapan porque las lecturas ya se hicieron. Verificado en el preview con la cuenta de auditor: 1 obra en la lista, 1 obra en el consolidado. Banco `prueba-las-lecturas-y-la-sesion.cjs`. | CERRADO 2026-11-12 |
| 65 | **Los guiones de medición mueren por renombre y nadie los ve morir.** Sacan símbolos de `src/App.jsx` igual que los bancos, pero **no están en la suite**, así que no hay quien avise — es el P4 sin corredor. Importa porque son la herramienta con la que se decide una escritura a producción: el día que alguien quiera medir antes de migrar se encuentra el guion muerto, y la tentación va a ser migrar sin medir. **Cerrado el 2026-10-26, y eran TRES muertos, no dos:** los dos conocidos (`medir-evidencia-para-migrar` buscaba `fotosDeSub`, `medir-fotos` buscaba `conFotos` dentro de `FotosCliente` — las dos cosas se fueron en la unificación de evidencia) más `medir-dano-semana-0125`, que leía `parche.nominaSemanas` del oyente de nómina cuando ese tramo ya se había partido en dos: hoy el oyente deja el crudo en `_nomDoc` y `semanasDeNomina` se aplica en el ensamblado. Moría con `undefined.map` y llevaba semanas así. **Arreglo:** `scripts/extraer-de-app.cjs` es ahora el portón único —resuelve las dependencias de nivel superior por cierre transitivo, así que pedir `evidenciaDeObra` trae sus helpers sin enumerarlos, y lanza `SimboloPerdido` con los nombres cuando falta algo—, y los **siete** guiones que extraen piden por ahí. Las preguntas 5 y 6 de `medir-fotos` se **borraron**, que es la respuesta correcta: medían una galería que mostraba todo junto sin mirar la fecha, y esa galería ya no existe (hoy hay riel de semanas). Una medición que sobrevive a su objeto mide otra cosa y lo llama igual. **El banco no repite la lista:** `prueba-herramientas-de-medicion-viven.cjs` recorre `medir-*.cjs`, **lee del AST las llamadas a `deApp('x','y')`** y le exige esos mismos nombres al `deApp` de verdad; una lista tecleada en el banco sería la segunda copia y se desincronizaría igual. Cierra también la puerta de atrás (un guion que lea `src/App.jsx` con Babel propio y no pase por el portón queda fuera de alcance → rojo) y el verde por vacío (menos de 5 guiones, o menos de 3 pidiendo 6 símbolos → NO ARRANCÓ). 10 aserciones, 6 mutaciones, las 6 en ROJO 1. Los diez guiones corridos de verdad contra producción tras el cambio: los diez salida 0, y `medir-fotos` y `medir-evidencia-para-migrar` coinciden en 668 fotos. | CERRADO |
| 71 | **El destino destructivo era el de omisión — CUARTA aparición, y la raíz de las otras tres.** `.firebaserc` tenía `default: campo-fosmon`: un `firebase deploy --only firestore:rules` sin `--project` iba a **PRODUCCIÓN** sin decirlo. Las otras tres (migrador de evidencia, los tres de Admin SDK) eran guiones y ya estaban tapadas; ésta es la configuración del repositorio entero, donde se aprendió el hábito. Cerrado: fuera el alias de omisión, quedan `produccion` y `prueba` con nombre. La §7 de `prueba-el-destino-se-escribe` le pregunta al `firebase` real —no a `.firebaserc`, porque el proyecto activo también sale del configstore del usuario, fuera del repo—; con el `default` repuesto salen 4 en rojo y la salida dice `=== Deploying to 'campo-fosmon'`. | CERRADO |
| 72 | **Los documentos del emulador se heredaban entre bancos** — 6 de 8, y los 2 que limpiaban se tragaban el fallo con `.catch(() => {})`. El P7 en el insumo que faltaba: las reglas ya no se heredaban, los datos sí. Cerrado con `scripts/emulador-limpio.cjs`: cada banco limpia antes de su primera sesión y **no arranca (2) si no puede limpiar**, porque limpiar a medias y seguir es medir sobre estado ajeno. Medido con una semana fantasma sembrada por la API de administración: sin la limpieza, rojo salida 1; con ella, verde. | CERRADO |
| 63 | **`migrar-evidencia-subcoleccion.cjs` conserva su propio cerrojo de destino** en vez de usar `scripts/destino.cjs`. Dos cerrojos que hacen lo mismo se desincronizan; el que quede atrás es el que escribe a producción por accidente. **Cerrado el 2026-10-26:** fuera el cerrojo propio, el destino sale de `resolverDestino({escribe, projectIdProd})` como en los demás. Lo que obligó a pensar fue el BANCO: `prueba-el-destino-se-escribe` no podía simplemente añadirlo a su lista, porque cuatro de sus secciones **corren el guion** con `--prod --escribir` para comprobar que el portón contesta, y eso escribiría a producción una vez por `npm test`. La lista se **partió** en vez de aflojar la medición o saltarse el guion en silencio: `PASAN_POR_EL_PORTON` (estático: que lo use, que no tenga cerrojo propio, que el modo ambiguo salga con 2) incluye al migrador; `GUIONES` (los que se ejecutan de verdad) no. 26 aserciones en verde. | CERRADO |
| 67 | **Los bancos de permisos no cargaban las reglas que decían juzgar** — 7 de 9. Medían el ruleset que el emulador tuviera puesto: `prueba-reglas-evidencia` denunciaba `create @ L453` mientras el archivo tenía ese `create` en L482. Un arreglo de reglas se podía ver verde por las reglas viejas. Es la forma del hallazgo del reloj en otro insumo. Cerrado con `scripts/reglas-del-repo.cjs`: cada banco carga el archivo antes de su primera sesión. | CERRADO |
| 68 | **`prueba-nota-no-calla` deja el emulador con un ruleset mutilado y no lo restaura**, y tres bancos de permisos corren después en orden alfabético sobre el mismo proyecto. Medido: tras correrla, una escritura a `avance/notas` que antes pasaba rebota. Hoy **no mordía** —ningún otro banco toca esa ruta— y el #67 lo desactivó cargando por banco en vez de restaurar al salir, que es lo que sobrevive a que un banco reviente a media corrida. Queda escrito porque la trampa era de orden, y el orden lo fija `ls`. | CERRADO |
| 6b | **Falta `onAuthStateChanged`: sesión zombie tras revocación.** Ojo: hay dos pendientes numerados 6; éste es el de sesión. **Cerrado el 2026-11-12.** Hay oyente, y el desmontaje es **uno solo** (`olvidarSesion`) que comparten la revocación y el botón de salir: dos copias se desincronizan y una de las dos se queda enseñando las obras de la sesión anterior. El usuario aterriza en la entrada con un aviso ámbar que dice por qué. **El preview encontró lo que el banco por piezas no veía:** `signOut` dispara el mismo oyente, así que salir a propósito leía «tu acceso fue revocado» — un hecho sobre la cuenta, y falso. Lo corta `salidaVoluntariaRef`, marcada antes de `signOut` y consumida al usarse. Banco `prueba-las-lecturas-y-la-sesion.cjs`. | CERRADO 2026-11-12 |

### Venían de «5 · Falta algo que se prometió»

| # | Tema | Estado |
|---|---|---|
| 108 | **El tablero y el expediente elegían las fotos con DOS criterios y un solo nombre.** La tarjeta del tablero ordenaba por **delta de avance de la semana**, con el número de fotos como desempate, bajo un comentario que afirmaba «mismo criterio que el PDF»; el PDF ordenaba por importe. De ahí salían tres cosas: una partida del 30% del contrato que esa semana no se tocó **no aparecía en pantalla** y sí en el papel; seis tomas del mismo señalamiento le ganaban a una foto de la partida que sostiene el contrato; y el PDF filtraba `.filter(x => x.fotos.length > 0)`, así que **la partida grande sin evidencia desaparecía del expediente justo donde más pesa**. **Cerrado:** una sola `seleccionFotografica` —corte del 80% por importe, reparto proporcional al peso por mayor déficit, tope compartido `TOPE_FOTOS`— la usan los dos; la pantalla sólo decide **cuántas partidas caben**, y lo declara (`recortadas`). El expediente abre **las hojas que las fotos necesitan** en vez de dos siempre (con tres fotos imprimía nueve cajas grises), y las partidas del corte sin evidencia salen **en una tabla con importe, % de contrato y % de avance**, no como huecos: tres obras de producción están en 0% de cobertura y ahí el corte entero son huecos. Banco `prueba-se-enseña-lo-que-pesa.cjs`, 8 secciones y **18 mutaciones en ROJO**. **La contraprueba encontró tres defectos míos, no de la app:** un fixture ordenado por importe hacía que «las primeras del documento» y «las que más pesan» dieran la misma lista —va revuelto a propósito, y la mutación que lo delató pasaba antes—; un `evidenciaVigente` que puse encima de `seleccionFotografica` **no guardaba nada** (`evidenciaDePartida` ya filtra las anuladas en su primer renglón) y se quitó, porque una guarda que aparenta proteger es peor que ninguna; y `fuera` ordenaba por puro importe, así que **una extraordinaria de $400 abría el apéndice antes de terminar el contrato**. El banco del #105 se reparó por este cambio y hay que decir por qué: afirmaba «el expediente sigue trayendo sus dos páginas», que era la conducta vieja, y su lector del orden impreso contaba las filas de la tabla nueva como si fueran fotos (ahora distingue un `text()` de una celda de `autoTable`). Verificado en el preview con el emulador sembrado, obra 0121: la tarjeta y el papel dicen **los mismos cinco números** de PAVIMENTOS–8 ($2,963,511 · 11.9% del contrato · 30% de avance), el mismo corte de 8 partidas y el mismo primer lugar. | CERRADO 2026-11-06 |
| 105 | **La cobertura fotográfica del expediente se puede medir hoy, y las tres conductas del criterio tienen obra real que las ejerce.** Criterio decidido: partidas ordenadas por importe de mayor a menor, se publica el **porcentaje del contrato que terminó con foto**, techo 80% y debajo del 50% el documento **dice que la evidencia no alcanza** en lugar de imprimir el número pelón. Medido el 2026-11-05 con `scripts/medir-cobertura-de-evidencia.cjs --prod` (sólo lectura, ADC): **7 de 7 obras vivas son medibles** y salen **0112 94.6%** (≥80%, techo alcanzado), **0126 78.0%** (entre 50 y 80, se publica), y **0114 45.4% · 0127 25.4% · 0125, 0128 y 0131 en 0.0%** (debajo del piso). O sea que el criterio **no es código muerto por ningún lado**: hay obra que ejerce cada una de las tres ramas y se puede verificar contra datos que existen. **La cobertura se mide en DINERO, no en fotos**, y una partida cuenta entera o no cuenta: la foto no sabe a qué volumen corresponde, así que repartir el importe entre las fotos sería inventar la cifra. **Dos habilitadores que había que comprobar y están limpios:** (1) **cero fotos huérfanas y cero sin partida en las 826 de producción** — el lazo `foto.partidaId → partida` aguanta el cruce, incluido el id derivado del índice que la app le pone a los `subs` viejos; (2) **`obra.presupuesto` cuadra con la suma de los importes del catálogo en las siete**, así que el denominador es uno y no hay que elegir entre dos números con el mismo nombre. Las cuentas no se reescribieron: `evidenciaDeObra`, `evidenciaVigente`, `idDePartida`, `importeCatalogoPartida` y `soloCatalogo` se **extraen** de `src/App.jsx`, y `prueba-herramientas-de-medicion-viven.cjs` ya vigila esos cinco nombres (14 en verde, 6 mutaciones en ROJO). **Las extraordinarias quedan fuera del denominador** a propósito: si entraran, autorizar una extraordinaria bajaría la cobertura del expediente sin que nadie dejara de tomar fotos. **El trabajo que falta es corto y está nombrado por obra:** a la 0126 le faltan **2 partidas** para el techo, a la 0114 **27 de sus 53 más grandes**, y la 0125 —461 partidas, $126.5M— **no tiene una sola foto**. **Construido el 2026-11-05** (`expediente/la-cobertura-se-mide-en-dinero`): la sección de fotos del PDF ya no sólo presenta doce fotos, **afirma** qué porcentaje del contrato está respaldado, en una banda en la primera página cuyo color lo decide el veredicto; el orden de las fotos pasó del **delta de avance de la semana** al **importe de mayor a menor**, porque el criterio viejo dejaba fuera la partida de $10M si esa semana no se tocó y premiaba a quien repite la misma toma. **El defecto de honestidad que había que cerrar antes:** `fsColl` devuelve `[]` tanto cuando la regla niega como cuando la obra no tiene fotos, así que el expediente podía imprimir «0.0% · la evidencia no alcanza» por una **lectura denegada** — y tres de las siete obras vivas salen en 0.0% de verdad, o sea que esa cifra sí se va a imprimir y había que poder distinguir cuál de las dos es. Ahora `evidenciaCargada` viaja hasta `generarPDFObra`, y sin lectura la cobertura es `medible:false` con `pct` en `null`, **nunca 0**. La cuenta del guion de medición **se retiró**: era la misma cuenta escrita dos veces, justo la clase de defecto que la rama anterior acababa de cerrar, así que el guion extrae de la app la cuenta, las dos frases y las dos varas. Banco nuevo que **ejecuta el PDF de verdad** con el jsPDF falso de `lienzo-pdf.cjs` y compara lo impreso contra `frasesDeCobertura` en vez de contra una cadena tecleada — 29 aserciones y **14 mutaciones en ROJO**. Verificado en el preview contra el emulador: la 0114 imprime «Sólo 6 de 14 partidas tienen fotografía…» una sola vez y en la página 8, y sus fotos salen 3 → 7 → 6, que es su orden por importe. | CERRADO |
| 104 | **En producción NINGUNA obra tiene su programa cargado: la comparación del #51 está construida y vacía.** Medido el 2026-11-05 con `scripts/hay-programa-capturado.cjs --prod` (sólo lectura, ADC): **0 de 7** obras vivas tienen `obras/{id}/config/programa`. El #51 (el avance contra una recta) quedó CERRADO y el #98 (la ruta del anexo de la dependencia) también, así que la pantalla sabe cargar el anexo y la gráfica sabe compararlo — pero hoy, para las siete obras reales, la Curva S dice «no disponible» y el KPI de avance programado no sale. **Y los anexos existen:** tres están en `~/Desarrollo/CAMPO-datos-produccion/programas/` desde el 2026-11-04 (COLECTOR, EMISOR y el DE-5 de estructuras), o sea que al menos la 0128 y la 0131 se podrían cargar hoy mismo. Esto no es defecto de código, es que nadie ha usado la pantalla todavía; se anota porque decide el lote de gráficas: **la conducta por omisión en producción es la de «sin programa», no la del programa dibujado**, y es la que tiene que estar bien hecha y decir en voz alta qué le falta. Carga en producción = escritura, o sea OK suyo. **Y la carga ocurrió. Re-medido el 2026-11-11 con el mismo guion: 4 de 7.** Oscar cargó cuatro anexos el 2026-11-09 —0126 (51 partidas), 0127 (112), 0128 (46), 0131 (73)— y **los cuatro cuadran contra su presupuesto declarado**: 75,635,416.41 · 144,596,003.20 · 12,890,541.86 · 27,489,778.08, con su archivo de origen anotado y tres de los cuatro con ventana de fechas. Las **tres que siguen sin anexo son 0112, 0114 y 0125**, de FOSMON, y no entran en la demo. **El renglón estuvo rancio dos días y me llevó a clasificarlo como bloqueante de la demo el 2026-11-11 citando «0 de 7»**: la cifra venía de este renglón y no de una medición, y quien la corrigió fue Oscar. Lección, que es la de siempre al revés: un renglón de PENDIENTES **no** es una fuente de datos de producción — caduca en cuanto alguien usa la pantalla, y nadie actualiza la fila al usarla. Antes de citar un conteo de producción, correr el guion. Lo que queda es que el producto ya tiene **las dos conductas vivas a la vez**, que es la mejor situación para la demo: cuatro obras comparan contra su programa y tres dicen en voz alta que no tienen contra qué comparar. | CERRADO |
| 53 | **Una obra recién contratada, sin un solo cheque en GP, no se puede dar de alta.** Lo demás del #53 está cerrado y desplegado —el gasto se lee en vivo, la hoja quedó de respaldo, detalle en el archivo—. El hueco lo abrió el catálogo: se arma de los cheques, así que la obra que todavía no ha pagado nada **no aparece en el selector del alta**, y es justo la obra que alguien quiere registrar. Aplica sólo del lado constructora (del lado gobierno no hay catálogo, ver #41). **Hecho el 2026-11-02:** el alta acepta la clave de GP a mano, validada contra la misma `/^\d{4}$/` que usa el servidor para pedirle el gasto a GP —con otra forma la obra cae en `sinClave` y el gasto no se le pega nunca, en silencio—; y la obra nueva **no finge un gasto de cero**: el documento del gasto ya distingue las obras que el cron **pidió** de las que **contestaron**, así que un cero medido y un cero desconocido dejan de ser el mismo número. Sin ese veredicto el margen de la obra recién dada de alta salía ~98–100 %, que es la cifra más convincente y más falsa del tablero. La pantalla lo dice en gris —«gasto sin medir», sin porcentaje ni importe—, la ordena al final del ranking por margen, la lista en Requiere atención y el consolidado declara cuántas obras le faltan y **hacia dónde** miente, sin corregir el total con una cifra inventada. Un banco nuevo con 12 contrapruebas medidas en rojo. **Desplegado el 2026-11-03** (sólo front, `d225155`): bundle `index-64eddf24.js` verificado por frases presentes —no sólo por el hash— y por la ausencia del placeholder que el barrido de la dependencia rechazó; `verificar-despliegue.cjs` en 0 en los cuatro canales. | CERRADO |
| 85 | **El alta de obra avisa a nadie: `notifARoles` se cae por reglas y el error sólo se escribe en la consola.** Visto el 2026-11-02 verificando el #53 en el preview: al activar una obra, `notifARoles` (`src/App.jsx:5168`) lista `usuarios` filtrando por `orgId`, pero la regla exige `esAdminDeOrg` (`firestore.rules:212`) y **`gerente_construccion` —uno de los dos roles que pueden dar de alta— no lo es**, así que la lectura se deniega, el `catch` traga el error y el alta se consuma sin testigos. Es justo lo que el comentario de `src/App.jsx:8335` daba por cerrado. No se vio antes porque hasta ahora el alta sólo se ejercitaba con cuentas de directivo. **Arreglado el 2026-11-02**: el aviso se fue al servidor —`obraNuevaRaiz` y `obraNuevaDeOrg` mandan correo **y** campanita con la misma lista— en vez de abrir el padrón a un rol que no es admin, y en el cliente **no quedó copia de la lista**: dos listas es cómo un aviso sale para menos gente sin que nadie lo note. **Desplegado el 2026-11-03**, y comprobado en el disparador vivo y no en el código: `obraNuevaRaiz` filtra `obras/{obraId}` y `obraNuevaDeOrg` `orgs/{orgId}/obras/{obraId}`. **Lo que NO se ha medido en producción es el disparador ejercitándose** — eso pasa cuando alguien dé de alta la próxima obra, y hasta entonces el aviso está desplegado, no visto salir. | CERRADO |
| 45 | **El informe del Art. 73 no existe**: el PDF ejecutivo que hay está hecho para la constructora, no para una dependencia. **Hecho el 2026-11-12.** `generarPDFArt73` sobre el mismo `andamioDeCotea` de los otros dos papeles —lo que cambia entre lector y lector entra **por parámetro, no por bandera**: `rotulo`, `banda`, `pieIzq`—, y sus cinco cifras de dinero salen de `economiaDeDependencia`, la **misma** cuenta que lee el tablero municipal, para que el papel que se archiva y la pantalla no puedan discrepar. **La frontera es la firma, no un filtro:** el generador no *omite* la economía del contratista, no la *recibe*; se afirma empujándole la economía completa y comprobando que la hoja sale **idéntica texto por texto**, porque preguntarle a la gráfica si pintó la línea es preguntarle a la cerradura si está cerrada. **El defecto que salió al construirlo, y es el que vale:** sin catálogo de conceptos `desgloseEjecutado([])` suma cero, y la pantalla **y** el papel publicaban «EJECUTADO $0 · 0% del contrato» y «0.0% de avance físico» sobre una obra de la que no se sabe nada. No es un cero medido, es un cero disfrazado de medición, y las dos lecturas llevan a decisiones opuestas: «no han arrancado» se discute con el contratista, «no está cargado el catálogo» se arregla cargándolo. Arreglado **en la cuenta** y no en el papel —`ejecutado` y `avance` valen `null`, y la frase que lo sustituye se dice **una vez** en `presentacionDependencia` y la dicen los dos lectores— así que el arreglo alcanzó también al tablero, que imprimía la misma mentira hoy. **El hueco no se contagia:** lo estimado y lo pagado salen de las estimaciones y no dependen del catálogo, así que siguen medidos; un `null` general habría vaciado el papel y dejado al municipio sin la mitad que **sí** se sabe, y hay aserción y mutación para exactamente eso. Las barras no se dibujan cuando la cifra es `null`, porque `Bar` hace `Math.min(pct||0,100)` y una barra en cero vuelve a afirmar el cero que la raya acaba de negar. Fotos con **«subidas en»**, que es lo que el Art. 73 pide y lo que el dato aguanta. Banco `prueba-el-informe-del-articulo-73.cjs`: **59 aserciones, 20 mutaciones en ROJO**. Las aserciones de «$0» se acotan **por título de sección y no por número de página** —el informe pagina distinto según incidencias y fotos— y una primera versión acusó al papel por el **rótulo del origen del eje** de la curva, que es una regla graduada y no una cifra publicada. Dos mutaciones no mordían por el mismo motivo de clase: el renglón mutado era **literalmente idéntico** al del documento interno y `String.replace` cambiaba el otro papel. Se generalizó en un guardia del corredor que compara la posición del cambio contra el espacio del generador y **sale 2 con el número de línea** en vez de pasar en silencio. Comprobado además que la huella del documento interno queda **byte por byte idéntica** a la de antes del cambio. **Tiene botón desde el 2026-11-12**, en la rama de «un papel por lector»: `vaElReporteEjecutivo` se fue con `generarPDFObra`, así que ahora `papelDeLaObra(usuario)` decide **cuál de los dos botones existe**, no cuál se esconde. Verificado en el preview con la cuenta sembrada de la dependencia y contra jsPDF **real**, no contra el lienzo de las pruebas: el informe sale de **9 hojas**, firma `cotea · informe de avance` en las nueve, pagina 1→9, no trae **ni una** de las palabras de la economía del contratista —margen, utilidad, nómina, almacén, rubro, gasto—, no trae **ninguna** hoja con la banda del interno, dice «subida» en cada foto con el párrafo que explica por qué, y no manda a dibujar un solo `NaN`, `undefined` ni `null`. Al lado, la constructora ve «Documento interno» y **no** ve este botón. | CERRADO |

### Venían de «6 · Orden, deuda y cosmética»

| # | Tema | Estado |
|---|---|---|
| 17 | **El hueco de «fecha faltante» estaba, pero al lado había algo peor: una fecha que SÍ está y que la pantalla deja de poder medir porque la escribe dos veces.** El censo (`scripts/medir-las-fechas-que-faltan.cjs`, sólo lectura por construcción) recorrió las 7 obras de producción el 2026-11-06: `obras/{id}` sin hueco (`inicio`, `fin`, `ultimaAct` 7/7); `config/estimaciones` 3 de 34 sin `fechaFact` (0112 EST-6 y EST-7 pagadas, 0126 EST-5 en proceso por $20.1M); `avance/subs` 2 de 7 sin `fecha` —las dos del #79 (el 999 del correo del lunes)—; y `avance/historial` 15 de 47 con `fechaCierre` nula, que **no es hueco**: no existe campo `cerrada`, el cierre se señala con la PRESENCIA de `fechaCierre`, así que el nulo es el dato correcto. Lo que sí estaba roto, y **vivo en producción, no latente**: (1) **la insignia «Gasto GP» decía «hace un momento» en verde SIEMPRE** — el instante llegaba bien de Firestore y se guardaba en el estado ya convertido a texto con `toLocaleString('es-MX')`, que `new Date` no sabe leer; daba NaN, y `NaN > 72` y `NaN > 30` son las dos falsas, o sea que **todos** los umbrales fallaban hacia el lado tranquilizador. Un Sheet sin sincronizar en una semana se veía igual que uno recién sincronizado. Ahora el estado guarda el instante, `frescuraDeGP` decide texto y color en UNA llamada, y «no se puede medir» tiene su propio nivel gris en vez de irse por verde. (2) **«días desde `fechaFact`» estaba escrita CUATRO veces.** La buena —`atrasoDeEstimacion`, la que pinta el semáforo de cada renglón— lee la fecha en local; `fin_003`, la alerta que publica dinero «sin cobrar fuera de plazo», la leía con `new Date(iso)`, o sea medianoche UTC, que al oeste de Greenwich cuenta **un día de más**: el renglón podía decir «Dentro de plazo» en verde mientras la alerta, la misma obra el mismo día, reclamaba su monto. `fin_003` ahora consume la cuenta única, que devuelve `diasTrans`/`diasAtraso` para que nadie tenga que sacar el número de vuelta del rótulo. Las otras dos copias eran **cadáveres y se borraron**: la de `calcularKPIsObra` (`atrasos`/`montoAtrasado`/`maxAtraso`, sin un solo consumidor en el repo) y `MiniDashEstimaciones` entera, retirada de la pantalla por el #11 (los KPIs duplicados) el 2026-09-22 y guardada «un ciclo», con su cuarta copia en cifras brutas dentro. (3) **`capturaMasReciente`** — cuál de dos capturas de la misma semana gana estaba escrito dos veces, idéntico y sin guarda; si a la que ya estaba le faltaba `fechaCaptura` la comparación daba NaN, `NaN > x` es falso, y el snapshot **nuevo se descartaba en silencio** mientras la curva seguía dibujando el rancio. Banco `prueba-la-fecha-se-mide-una-vez.cjs`: ejecuta el trozo real del chip sacado de dentro del componente, **barre las 24 horas del día** sobre un día anclado —la diferencia entre medianoche local y UTC sólo se nota a partir de las 18:00, así que un banco con reloj de pared saldría verde doce horas y rojo las otras seis—, y exige que la alerta dispare si y sólo si el renglón está en rojo: 288 combinaciones, 0 desacuerdos. 29 comprobaciones, **10 mutaciones y las 10 en ROJO**. | CERRADO |
| 33 | **`PanelEjecutivo` borrado** (271 renglones). Es el que mandaba por correo los domingos a dirección: lo reemplazó `DashboardPrincipal` el 2026-09-18 y desde entonces ninguna vista lo renderizaba. Se conservaba «por si hay que hacer rollback»; cinco semanas después ese seguro nunca se cobró y el costo sí se pagó —se editó por error una vez, y `prueba-semana-actual-nomina.cjs` agarra el PRIMER `_KpiConDelta label="Personal"` del archivo, que sólo por suerte no era el suyo—. **`vePanelEjecutivo` y `ROLES_PANEL_EJECUTIVO` se quedan:** no son el panel, son quién ve UN consolidado, y deciden cuál de los dos —`DashboardPrincipal` o `PortafolioDependencia`— se pinta. Verificado en el preview con los dos tipos de organización. | CERRADO 2026-10-26 |
| 43 | **No eran 6 cadenas viejas: eran dos documentos que TECLEAN una marca que ya se puede LEER.** El correo del lunes y la portada del PDF escribían «CAMPO · FOSMON Construcciones» a mano, al lado de `marcaDeOrg` y de `B.empresa`, que traen el nombre de `orgs/{oid}/config/branding`. Es el #39 otra vez, entrando por el nombre en vez de por el dinero: `orgDeLaRaiz` ya resuelve de quién son las obras, así que el día que el resumen le salga a una dependencia iría **firmado por su contratista**. Sin marca no se firma con nadie —se queda con `cotea`, que es cierto para todos—, porque un correo sin firma es mejor que uno firmado por la empresa equivocada. El PDF tenía además un dato **inventado**: `obra.ubicacion \|\| 'FOSMON Construcciones'` ponía el nombre de la empresa en el renglón donde el lector espera un lugar; ahora sin ubicación no hay línea. Eso no lo encontró un `grep` —el nombre estaba en la ranura de la ubicación— sino un **jsPDF falso** que mueve el generador de verdad y anota qué texto, en qué página y en qué posición se manda dibujar. De paso, `buildEmailHTML` pasó a ser `correoResumenSemanal` y devuelve `{subject, html}`: el asunto se tecleaba en el envío, o sea que el nombre del producto vivía en dos lugares y sólo uno era alcanzable por quien lo mide. Banco `prueba-la-marca-se-lee-no-se-teclea.cjs` con una marca **ajena** a propósito (Gobierno del Estado de Veracruz): si algo quedó tecleado, el documento dice dos nombres y salta. 6 comprobaciones, **8 mutaciones y las 8 en ROJO**. Suite 77/77. **Arriba el 2026-11-04** (funciones el 03, front el 04): los cuatro canales de `verificar-despliegue.cjs` dicen que lo vivo es `71f5aa1`. Lo que **todavía no se ha visto** es el correo del lunes 2026-11-09 firmado con la marca leída; hasta entonces el PDF está comprobado y el correo sólo desplegado. | CERRADO 2026-11-04 (falta ver el correo del lunes) |
| 87 | **La contraprueba del verificador de despliegue apostaba en vez de fabricar, y perdió la apuesta.** Su escenario del front retrocedía el clon «un commit de `src` hacia atrás», dando por hecho que el front vivo estaría más atrás todavía. El 2026-11-03 el front vivo resultó ser justamente ese commit: el diff salió vacío, el canal dijo «sin diferencias» y el escenario se puso rojo **sin que nada estuviera roto** — un instrumento acusando al instrumento. Ahora **añade** un commit que toca `src`, como ya hacían los otros cuatro escenarios: cualquier commit vivo que el clon contenga queda por detrás de HEAD, que es exactamente el estado que el canal debe llamar ATRÁS. 7 de 7. Es el #79 por el otro lado: ahí un «no pude medir» salía como rojo; aquí un «medí y no había nada roto» salía como rojo porque el mundo roto no se había fabricado. | CERRADO 2026-11-03 |
| 86 | **La dirección de cotea: `cotea.com.mx`, y estaba tecleada en cuatro archivos que no se hablan.** `campo-fosmon.netlify.app` decía de quién era la app antes de que el lector se identificara, y `campo@fosmon.com.mx` hacía lo mismo en el remitente: un municipio recibiría el resumen de SUS obras desde la casa de quien le cobra. Es el #43 por el lado de la dirección. **En el repo (hecho):** `APP_URL` y `FROM_EMAIL = cotea <no-reply@cotea.com.mx>` en `functions/index.js`, el `dominio` por omisión del pie del PDF en `src/App.jsx`, y `storage.cors.json` **sumando** `cotea.com.mx` y `www.` **sin quitar** el origen viejo — quitarlo le apagaría las fotos de evidencia a quien ya tenga la app instalada desde ahí, y sin un solo mensaje de error: pantalla en blanco. Banco nuevo `prueba-la-direccion-del-producto-es-una.cjs` —hoy `prueba-las-dos-direcciones-del-producto.cjs`, porque el #89 (la mudanza al subdominio) le invirtió la premisa—: las cuatro se **ejecutan** —`APP_URL` y `FROM_EMAIL` por AST, el pie del PDF **dibujando** el PDF sin marca, el CORS aplicándole la regla de orígenes— y se comparan **entre sí**, no contra una cadena tecleada en el banco, así que el día que la dirección vuelva a cambiar sigue midiendo lo mismo. El comodín `https://*.netlify.app` **no cuenta**: el origen de la app tiene que estar exacto, porque un comodín cuya semántica depende de lo que el proveedor honre no es una garantía. 4 comprobaciones, **8 mutaciones y las 8 en ROJO**. El jsPDF falso salió a `scripts/lienzo-pdf.cjs` al tener su segundo usuario: dos copias de un doble se desincronizan y cada banco acaba midiendo un generador distinto. **Arriba el 2026-11-03, con OK de Oscar y comprobado desde fuera:** DNS en GoDaddy (ápice `A → 75.2.60.5`, `www CNAME → campo-fosmon.netlify.app`, sin tocar MX/SPF/DMARC ni los DKIM del correo que ya vive en el dominio), dominio y certificado en Netlify sobre el sitio que ya existía (Let's Encrypt, SAN `cotea.com.mx` + `www`), `cotea.com.mx` **añadido** a los dominios autorizados de Auth y comprobado iniciando sesión de verdad, y el **CORS del bucket aplicado y releído de él**, verificado por preflight —los tres orígenes buenos reciben cabecera y uno de fuera no—. Los dos orígenes sirven el mismo cuerpo byte por byte (5524 b, sha `30c9b30a1546`), así que `SITIO` del verificador y las líneas de «URL producción» ya apuntan al nombre nuevo sin perder veredicto: midió `vivo ac76a2a`, no «no se pudo medir». **El certificado falló el primer intento** y no era defecto: la caché del `CNAME www` viejo tenía TTL de una hora y Netlify pide el cert para los dos nombres a la vez; reintentó solo al expirar. **Terminado el 2026-11-03/04:** Resend acepta `no-reply@cotea.com.mx` —HTTP 200, que es la prueba de que el dominio está verificado, porque uno sin verificar contesta 403; la **entrega** no se pudo medir y no se da por buena: la llave de producción es `restricted_api_key` y `GET /emails/{id}` responde 401—; canario `listarUsuarios` desplegada sola y **llamada** (401 `UNAUTHENTICATED`, que es la respuesta de una función que carga bien), luego las 21 restantes, sin borrados; y el front empujado el 2026-11-04. Los cuatro canales en `ok`: front `71f5aa1`, reglas idénticas, las 22 funciones corriendo el `index.js` del repo. El origen viejo **no se retira ni se redirige** (PWA instaladas, #37). Pasos y razones en `docs/pendientes-detalle-historico.md`. | CERRADO 2026-11-04 |
| 37 | Íconos, nombre y `theme_color` de cotea, con el `id` del manifiesto fijado. Desplegado el 2026-10-09 dentro del paquete de reglas+front. Queda el aviso: **iOS no repinta el ícono de una app ya instalada** — quien la tenga en la pantalla de inicio la borra y la vuelve a agregar. **Re-medido contra producción el 2026-10-26 porque se reportó que «seguía saliendo el de FOSMON»: no sigue.** `campo-fosmon.netlify.app` sirve los tres íconos con la **misma suma** que el repo (`favicon.svg` `4d970e7d67bf`, `icon-192.png` `b59e2fd13e1d`, `apple-touch-icon-180.png` `f962a8e4ade3`), el manifiesto en vivo dice `cotea`, el `<title>` dice `cotea` y los archivos son la C bitono. Lo que se ve viejo es **del aparato**: el ícono de la app instalada se fija al instalar, y los PNG conservaron su nombre (`icon-192.png` et al. se modificaron en sitio en `2b10235`), así que un service worker viejo también puede servir la versión vieja desde su precaché. Se arregla borrando y volviendo a agregar la app; en el navegador, recargando con la actualización aplicada. **No hay nada que cambiar en el código.** | CERRADO |
| 42 | cotea no tiene eslogan y el campo está esperando uno. | DECISIÓN |
| — | **`feature/resumen-semanal` se cierra sin portar.** Lo que traía era el armado del correo sacado a `functions/resumen-semanal.js` para poder verlo sin mandarlo; la **garantía** que justificaba el refactor —«el correo dice lo mismo que la pantalla»— ya la exige `main` por otra vía: `prueba-avance-sobre-contrato.cjs` y `prueba-partidas-extraordinarias.cjs` extraen y **ejecutan** las dos copias de `calcularKpisObra`, la de `src/App.jsx` y la de `functions/index.js`. Contra eso, la rama lleva 252 commits de divergencia y +11,777/−2,410 renglones en esos mismos dos archivos: portarlo es reescribirlo, y se reescribe el día que haga falta. **Rescatado el 2026-11-03** a `rescate/herramientas-del-resumen`: `scripts/fecha-falsa.cjs`, con banco propio porque ningún otro la carga. **No rescatado:** `muestra-resumen-semanal.mjs` — importa `functions/resumen-semanal.js`, que sólo existe en la rama (corrido contra `main`: `ERR_MODULE_NOT_FOUND`), así que committearlo sería dejar un cadáver en el árbol; vive en la rama, que **se deja intacta**. La deuda real que queda apuntada no es el refactor: es **«dos copias pinchadas por prueba, no una cuenta»**. | CERRADO 2026-11-03 |

### Venían de «Cerrados»

| # | Tema | Estado |
|---|---|---|
| 56 | **Quién teclea pesos en estimaciones.** Manda `PERMISOS`: captura `administrativo`, corrigen `director_obras` y `subdirector`. Reglas de Firestore y Storage apretadas para que coincidan y **DESPLEGADAS** el 2026-10-07 18:24 UTC; los dos rulesets vivos verificados idénticos al repo. Ver `SECURITY_RULES.md`. | 2026-10-07 |
| 49 | Notas de reporte semanal sembradas para la demo. | 2026-10-06 |
| 48 | El plazo dice si la obra va bien o mal: KPI de días a favor o de atraso, en Plazo y en el panel. | 2026-10-06 |
| 6 | No había dónde capturar estimaciones en dependencia — la mitad financiera del expediente. | 2026-10-06 |
| 42 | **cotea ya tiene eslogan: «Tu obra, al momento»** (Oscar, 2026-10-26). Entra en `PRODUCTO.descriptor`, que es el único sitio donde vive, y lo pintan el Login y el pie. La guarda `descriptor && …` se queda puesta en los dos: vacío tiene que seguir significando no pintar nada, porque el pie con descriptor vacío dice «cotea — » con la raya colgando. **El manifiesto NO se tocó**: su `name` y su `description` siguen con el desarrollo de la sigla CAMPO («control de avance, maquinaria, personal y obra»), que es el mismo defecto en otro archivo, pero cambiarlo altera lo que ven los aparatos con la app ya instalada y eso se decide aparte. | 2026-10-26 |
| 1 | **Sacar el repositorio de iCloud Drive.** Ya estaba hecho y el índice no se movió, igual que el #19. Medido el 2026-10-26: la ruta real es `/Users/ofosado/Desarrollo/CAMPO-FOSMON` —sin paso por `~/Library/Mobile Documents`—, el volumen es el `/System/Volumes/Data` local, y no existe ninguna copia bajo `CloudDocs/Desarrollo`. | 2026-10-26 |
| 19 | **`setObra` sin declarar en GastosGP.** Estaba arreglado desde el commit `00df88b` —cuyo mensaje nombra el #19— y el índice nunca se actualizó: trece renglones de lista pidiendo trabajo ya hecho. Medido hoy: `setObra` está en los props (App.jsx:14500), se usa (14797) y el sitio de llamada lo pasa (23580). Un índice que pide trabajo hecho gasta la misma atención que uno que pide trabajo real. | 2026-09-22 |
| 38 | El login inventaba el perfil que no encontraba y se autoasignaba permisos de escritura. | 2026-09-24 |
| 35 | El modelo escrito decía que la dependencia no captura, y es falso; la escritura se denegaba y `fsSet` lo callaba. | 2026-09-24 |
| 34 | El transporte decodificaba el cuerpo trozo a trozo y partía caracteres UTF-8 en la frontera. | 2026-09-23 |
| 32 | La galería de fotos del cliente no pintaba ni una foto, y anunciaba que sí había. | mezclado |
| 31 | El histórico semanal de subcontratos nunca existió — retirado. | 2026-09-22 |
| 59b | **La llave de React del renglón de estimación salía de `e.no`, que se teclea** — puede faltar (un `key={undefined}` React lo cuenta como ausente) y puede repetirse. Ahora es `i`, la misma identidad con la que `actualiza(i,…)` escribe el renglón. En las dos listas. `prueba-llave-estimacion.cjs`, con contraprueba que reproduce el aviso exacto. | 2026-10-07 |
| — | **El veredicto de la suite dependía de en qué país estaba abierta la laptop, y el arreglo se dio por bueno dos veces sin nada que lo vigilara.** El 10 fijó `TZ` el corredor; el 11 se vio que el corredor es UNA de las dos formas de correr un banco, y que a mano —como se trabaja mientras se arregla algo— el mismo banco daba verde por `npm test` y ROJO por `node scripts/…`. Ahora el huso lo fija `reloj.cjs` desde el preámbulo que los 56 bancos ya cargan, con UNA sola copia de la zona. Lo vigila `prueba-reloj-de-la-suite.cjs`, que **no lee texto**: lanza un banco real en cuatro husos y compara veredictos, y antes comprueba que el canario siga siendo sensible al huso — si deja de serlo sale NO ARRANCÓ, porque entonces no se puede mirar. Verificado que los guiones de medición contra producción NO estaban afectados: fijan México a mano y hacen la semana en UTC puro, ejecutado en cuatro husos con resultado idéntico. | 2026-10-11 |
| — | **Los porcentajes del contrato sin capturar reventaban la cuenta, y `MXN` disfrazaba el NaN de «$0».** Se veía «COBRADO EFECTIVO $0» al lado de «PAGADO BRUTO $9,300,000». Encontrado mirando la tabla renderizada, no en la suite. | 2026-10-06 |
| — | **Un estatus de fuera del trámite se pintaba como «Recibida».** Un `<select>` cuyo `value` no es ninguna de sus opciones no avisa: enseña la primera. Ahora se enseña el valor real, marcado como ajeno — en las TRES pantallas de estimación, no sólo en la que falló. | 2026-10-07 |
| — | **En Storage las reglas SE SUMAN: no gana la más específica.** Una regla apretada debajo de un comodín abierto no aprieta nada — el supervisor seguía subiendo la carátula por el comodín. Se quitó el comodín de obra de dependencia y se enumeraron las rutas. Advertencia permanente escrita en `SECURITY_RULES.md`, con su propio encabezado. | 2026-10-07 |
| — | **La relación de estimaciones se lee como un estado de cuenta** en las dos pantallas, con acumulado y % del contrato, y TOTALES que reusa los mismos números de los KPIs. Sin columna de IVA: no hay tasa en el modelo de datos. | 2026-10-06 |
| — | Las fotos sin `id`: medido en producción, 631 con `id` y 0 sin él. Producción está limpia. | 2026-10-05 |
| — | El parser de TAMSA absorbía horas extra en el conteo de días. | 2026-09-19 |
