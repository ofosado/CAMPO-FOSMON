# Cómo trabajamos en CAMPO

El contexto del producto está en `CAMPO_CONTEXTO.md` y la lista de trabajo en
`PENDIENTES.md`. Este archivo es sólo el acuerdo de proceso: qué se hace sin
preguntar, qué se pregunta siempre, y cuánta ceremonia lleva cada cambio.

El acuerdo salió de un problema concreto: cada mejora pedía demasiadas
autorizaciones y la lista de pendientes no avanzaba. Lo que se aflojó es la
ceremonia. **La medición no se aflojó.**

---

## 1. Mezclar no se pregunta

Con la suite en verde y el build limpio, se mezcla: rama propia, `--no-ff`,
suite completa sobre `main` después, y se reporta ya hecho.

Siguen necesitando OK explícito, siempre:

- Desplegar el front o las Cloud Functions.
- Desplegar reglas de Firestore o Storage.
- Cualquier escritura a producción.
- Tocar `main` a mano (commit, merge o push directo sin rama).

## 2. Dos velocidades de verdad

**BAJO** — la pantalla sólo presenta el dato: se hace, se commitea, se muestra
hecho. Suite y nada más. Sin contrapruebas, sin recorrido por el preview.

**ALTO** — la pantalla **afirma algo sobre** el dato, o toca dinero, reglas o
escrituras a Firestore: ritual completo. Contraprueba que ponga la aserción en
**rojo** (salida 1, nunca "no arrancó"), verificación en el preview con datos
sembrados, y revisión de que ninguna cifra sea inventada.

**En duda, ALTO.** Se dice en un renglón al empezar cuál de las dos es.

## 3. Mensajes de commit: 5 renglones si es BAJO, 12 si es ALTO

Dicen por qué, no qué. El diff ya dice qué.

## 4. `PENDIENTES.md` es un índice, no un ensayo

Un renglón por tema, con estado. Los ensayos que ya están ahí se archivan.
Un hallazgo nuevo entra en tres renglones.

## 5. Lotes de 4 a 6 cambios

Yo decido cómo se cortan las ramas y lo justifico al terminar. Las ramas se
cortan por **naturaleza del defecto**, no por pantalla ni por riesgo. Sin
consultas a mitad del lote.

## 6. No se entrega para revisar

Nada de "ya terminé, ¿lo revisas?". Se entrega hecho, verde y commiteado.

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
