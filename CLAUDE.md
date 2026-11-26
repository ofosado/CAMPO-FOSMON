# Cómo trabajamos en CAMPO

El contexto del producto está en `CAMPO_CONTEXTO.md` y la lista de trabajo en
`PENDIENTES.md`. Este archivo es sólo el acuerdo de proceso: qué se hace sin
preguntar, qué se pregunta siempre, y cuánta ceremonia lleva cada cambio.

El acuerdo salió de un problema concreto y volvió a aparecer el 2026-11-26: no
era que la lista de autorizaciones fuera larga, era que **se preguntaba y se
detenía**. Cada lote terminaba en «¿despliego?» y nada estaba vivo hasta la
respuesta. Lo que se aflojó es la ceremonia y el número de interrupciones.
**La medición no se aflojó.**

---

## 1. Una sola puerta

Casi todo se hace y se reporta ya hecho. Piden OK **tres** cosas, y nada más:

- **Una cifra de dinero que un cliente va a ver o cobrar.** Un monto nuevo, o
  una regla que cambia cómo se calcula lo que se cobra.
- **Borrar o migrar datos de producción.** Borrar es borrar, y una migración
  reescribe la única copia que hay.
- **Dar de alta algo real**: una cuenta, un usuario, un dominio, una llave.

Lo que **ya no se pregunta**:

- Desplegar el front y las funciones de reemplazo. §2 dice con qué condiciones.
- Empujar a GitHub y mezclar a `main`.
- Leer producción. Leer no escribe.
- Desplegar reglas de Firestore o Storage **cuando un banco demuestra que las
  nuevas niegan todo lo que negaban las viejas**. Si abren algo que estaba
  cerrado, eso es un alta: pide OK.
- Escribir en producción cuando el dato lo sembré yo para medir, en una obra de
  prueba, y se borra al terminar. Antes de escribir se verifica el destino.

Y dos cosas que no hago aunque se me autoricen: teclear una llave de API en un
campo, y apagar una medición para que algo salga verde.

## 2. Desplegar deja de ser una pregunta y se vuelve una condición

Se despliega sin avisar antes cuando las cuatro se cumplen:

1. La suite entera en verde **con los emuladores vivos** — salida 0, nunca 2.
2. `npm run build` limpio.
3. El recorrido hecho en el preview con datos sembrados, si la pantalla afirma
   algo sobre el dato (§4).
4. El diff revisado para secretos. El repositorio es público.

Si alguna falla, no se despliega **y tampoco se pregunta**: se arregla.

Un despliegue por lote, no uno por cambio. Y en el reporte va escrito el commit
anterior, para que la reversa sea un renglón y no una investigación.

## 3. Lo irreversible se encola, no interrumpe

Si a mitad de un lote aparece algo de las tres cosas de §1, el lote **no se
detiene**: se hace todo lo demás, eso queda escrito en un renglón, y al final
van todas juntas. Una respuesta tuya, no seis.

## 4. Dos velocidades de verdad

**BAJO** — la pantalla sólo presenta el dato: se hace, se commitea, se muestra
hecho. Suite y nada más. Sin contrapruebas, sin recorrido por el preview.

**ALTO** — la pantalla **afirma algo sobre** el dato, o toca dinero, reglas o
escrituras a Firestore: ritual completo. Contraprueba que ponga la aserción en
**rojo** (salida 1, nunca "no arrancó"), verificación en el preview con datos
sembrados, y revisión de que ninguna cifra sea inventada.

**En duda, ALTO.** Se dice en un renglón al empezar cuál de las dos es.

## 5. Mensajes de commit: 5 renglones si es BAJO, 12 si es ALTO

Dicen por qué, no qué. El diff ya dice qué.

## 6. `PENDIENTES.md` es un índice, no un ensayo

Un renglón por tema, con estado. Los ensayos que ya están ahí se archivan.
Un hallazgo nuevo entra en tres renglones.

## 7. Lotes de 4 a 6 cambios

Yo decido cómo se cortan las ramas y lo justifico al terminar. Las ramas se
cortan por **naturaleza del defecto**, no por pantalla ni por riesgo. Sin
consultas a mitad del lote.

## 8. «Deja algo corriendo»

Cuando digas que te vas —a dormir, a una junta, a comer— no te dejo un menú de
tarjetas que esperan un clic: elijo el trabajo con tu criterio de cajones
(demo · cuesta dinero hoy · bloquea vender · congelado), arranco las sesiones y
trabajan solas.

El límite es el mismo de siempre: no mezclan a `main` y no despliegan. Dejan
rama y reporte, y al volver eso entra por §1 y §2 como cualquier lote.

## 9. No se entrega para revisar

Nada de "ya terminé, ¿lo revisas?". Se entrega hecho, verde y commiteado.

El reporte del lote es una pantalla: qué quedó, qué está vivo, qué está
esperando en la puerta de §1, y el renglón de la reversa.

---

## Lo que no se negocia

- **El dinero nunca se topa; el avance físico sí.** El ingreso es el contrato,
  no lo ejecutado.
- **Nunca se inventa una cifra.** Un porcentaje que no está en el modelo de
  datos no se teclea para llenar una columna.
- **Una cuenta por número.** Si el KPI y el renglón de su propia tabla pueden
  discrepar, es un defecto esperando.
- **Las pruebas afirman conducta, nunca que un símbolo exista.** La prueba
  extrae la cuenta del archivo y la **ejecuta**; una prueba que copia el código
  se comprueba contra sí misma.
- **Tres estados:** verde 0 · ROJO 1 · NO ARRANCÓ 2. Una prueba que no arranca
  es roja, no es "casi".
- **Una dependencia nunca lee la economía del contratista.**
- **Si falla y luego pasa, no quedó.** Y el patrón se arregla en todo el repo,
  no en el renglón que falló.
- **El historial se respeta.** No se aplastan commits ni se borran ramas recién
  mezcladas. Antes de borrar, se pregunta; por omisión, se deja.
