# Rollback PWA — cuando el frontend rompe en producción

Procedimiento operativo si un deploy del frontend deja a los usuarios
atrapados con una versión rota. Aplica al comportamiento introducido
por `fix/actualizacion-pwa` (2026-09-16) y en general a cualquier
deploy problemático de Netlify.

**Usar solo si el deploy nuevo tiene un bug crítico**: la app no carga,
loop de errores, pérdida de datos, o el service worker queda en un
estado del que no se puede salir con recarga normal.

---

## Escenario típico

1. Se hace merge a `main`.
2. Netlify build succeeds, publica.
3. Al abrir la app, los usuarios ven pantalla blanca / error / bucle.
4. **Los reportes por WhatsApp empiezan a llegar en minutos.**

Pasos abajo. Objetivo: (a) revertir el frontend en Netlify a la versión
previa buena y (b) rescatar a los usuarios que ya tienen la versión rota
instalada en su dispositivo.

---

## Parte 1 — Revertir el frontend en Netlify

### Ruta A: desde el panel web de Netlify (recomendado, ~30 seg)

1. Abrir https://app.netlify.com/sites/campo-fosmon/deploys
2. En la lista, encontrar el deploy anterior al problemático
   (el que dice "Published" con el commit conocido bueno).
3. Click en ese deploy → botón **"Publish deploy"** arriba a la derecha.
4. Netlify propaga el rollback en 10-30 segundos.

### Ruta B: desde CLI de Netlify

```bash
# Instalar netlify-cli si no está: npm install -g netlify-cli
netlify login   # una sola vez
netlify api listSiteDeploys --data '{"site_id":"campo-fosmon"}' | \
  jq -r '.[] | "\(.id) \(.commit_ref) \(.published_at)"' | head -5
# Elige el deploy_id anterior al roto
netlify api restoreSiteDeploy --data '{"site_id":"campo-fosmon","deploy_id":"<ID>"}'
```

### Ruta C: revert del commit + push (último recurso, ~3 min)

```bash
cd "/Users/ofosado/.../CAMPO-FOSMON"
git revert -m 1 <SHA-del-merge-malo>
git push origin main
# Netlify detecta el push, build+deploy 2-3 min
```

Usar solo si Netlify web/CLI no responden. Es más lento y deja un commit
de revert en la historia.

**Verificación post-revert**: abrir https://campo-fosmon.netlify.app
en una ventana de incógnito (sin caché ni SW). Debe cargar la versión
buena.

---

## Parte 2 — ¿El rollback rescata a los usuarios ya atrapados?

**Respuesta corta: NO automáticamente. Los usuarios con el SW roto
instalado siguen atrapados hasta que su navegador chequee el SW nuevo.**

### Por qué

El Service Worker viejo (roto) está registrado en el dispositivo del
usuario. Intercepta todos los fetches. Aunque Netlify ya sirve el
bundle bueno, el navegador del usuario solo descarga el SW nuevo cuando:

- **Chrome/Firefox desktop**: cada 24 horas por default, o cuando la
  ventana recupera foco tras haber estado en background.
- **Android Chrome PWA**: similar; check al abrir la app instalada.
- **iOS Safari PWA**: check al abrir la PWA desde el ícono del home
  screen; si el usuario no la abre en días, no descarga nada.

Incluso cuando el navegador descargue el SW nuevo (del rollback),
puede quedar en `waiting` sin activarse — porque `fix/actualizacion-pwa`
solo activa automáticamente cuando el usuario está sin sesión o sin
cambios pendientes, y con un SW roto puede que ni siquiera lleguen a
la lógica de decisión.

**La forma segura de rescatarlos es que abran `?_reset=1` en su
dispositivo.** Sección siguiente.

### Excepción

Si el SW roto NO logra interceptar los fetches (por ejemplo si falló
en el `install` event), el navegador sirve del bundle nuevo de Netlify
directamente. Estos usuarios se rescatan solos con un F5. Pero no es
el escenario común.

---

## Parte 3 — Mensaje para los 13 usuarios de FOSMON

**Copia este mensaje a WhatsApp cuando pase un problema serio con CAMPO.**
Está en lenguaje que entiende alguien en obra, sin jerga técnica.

### Mensaje corto (para cuando la app no carga)

```
Hola.

Si CAMPO no está abriendo o se ve raro, abre este link desde tu
celular (o computadora, donde uses CAMPO):

https://campo-fosmon.netlify.app/?_reset=1

Va a decir "Reiniciando CAMPO..." unos segundos y luego te va a llevar
a la pantalla de entrar. Escribe tu correo y contraseña como siempre.

Con eso queda arreglado. Si no funciona, avísame por acá.

Gracias.
```

### Mensaje largo (para cuando quieres explicar más)

```
Hola.

Detectamos un problema con CAMPO. Ya lo arreglamos, pero tu celular
puede tener guardada la versión con el bug. Para forzar que baje la
versión arreglada:

1. Abre este link desde tu celular:
   https://campo-fosmon.netlify.app/?_reset=1

2. Vas a ver la pantalla "Reiniciando CAMPO..." unos segundos.

3. Después te va a mandar a la pantalla de "Entrar a CAMPO". Escribe
   tu correo y contraseña como siempre.

4. Ya estás en la versión nueva.

Si usas CAMPO en más de un dispositivo (celular y computadora, por
ejemplo), hazlo en todos.

Cualquier cosa avísame.

Gracias.
```

### Mensaje para el equipo interno / directores

```
[INTERNO] Rollback de CAMPO ejecutado.

Deploy roto: <sha o descripción del bug>
Publicado por Netlify: <hora>
Rollback publicado: <hora>

Los usuarios necesitan abrir `?_reset=1` para bajar la versión buena.
Mensaje para WhatsApp está en el repo: ROLLBACK_PWA.md → "Mensaje corto".

Si alguien reporta que aún ve el bug: pedirle que confirme la versión
que ve en el pie de página (formato v2026-MM-DD · SHA). Si la fecha o
hash NO coincide con el actual, es que su navegador aún no bajó el
rollback — mandarle otra vez el link `?_reset=1`.
```

---

## Parte 4 — Antes de mezclar la rama que causó el problema

Investigar la causa raíz **antes** de reintentar el deploy.

1. Descargar el bundle roto de Netlify (o del deploy anterior si sigue
   accesible) y abrirlo local para reproducir.
2. Verificar en Cloud Logging si hay errores runtime relacionados.
3. Preguntar a 2-3 usuarios afectados qué versión veían antes (footer
   dice `v2026-MM-DD · SHA`).
4. Si el bug es del bundle (JS runtime), fix en rama nueva + Deploy Preview
   para validar antes de merge.
5. Si el bug es del Service Worker o precache, además de fix, mandar el
   `?_reset=1` a todos los usuarios preventivamente al re-desplegar.

---

## Anexo — Cómo saber la versión que trae un usuario

Le pides que mande foto del footer de CAMPO. Formato:

```
v2026-09-16 · 34f4c3f
```

- **Fecha (`2026-09-16`)**: día del build. Comparar contra la fecha
  del último deploy en Netlify.
- **Hash (`34f4c3f`)**: primeros 7 caracteres del commit. Se puede
  buscar en https://github.com/ofosado/CAMPO-FOSMON/commit/34f4c3f

Si el usuario no encuentra el footer (por ejemplo la app ni carga),
la versión también aparece en la pantalla de Login debajo del subtítulo
"Control de Avance...". Con eso puede reportar aunque no pueda entrar.

---

## Limitación conocida — Safari / iOS y detección con app abierta

**Hallazgo verificado 2026-09-17 en Deploy Preview**: Safari desktop
(y iOS Safari en PWA standalone) NO detecta nuevas versiones publicadas
mientras la ventana permanece abierta, aunque hayamos programado un
chequeo periódico cada 30 minutos en `src/pwa-update.js`. En pruebas
con la ventana abierta por más de 30 minutos, Safari NUNCA saltó a
ninguna de las 4 versiones publicadas — se quedó indefinidamente en la
versión con la que arrancó la sesión.

**Por qué pasa:**

- Safari throttlea agresivamente `setInterval` en pestañas que pierden
  foco. En segundo plano el timer se pospone o suspende.
- Safari discarta pestañas por presión de memoria más rápido que Chrome
  o Firefox. Cuando eso ocurre el JS deja de correr por completo hasta
  que la pestaña recupera foco.
- En iOS PWA standalone: al minimizar la app o cambiar a otra, iOS
  suspende la instancia. Los timers no acumulan tiempo mientras la app
  está en background; se congelan hasta reabrir.
- `registration.update()` que dispara el 30-min tick puede además ser
  ignorado por Safari si el manifest de precache no cambió desde la
  última verificación reciente (heurística interna de Safari).

Chrome desktop en foreground sí ejecuta el tick como esperado, así que
la protección funciona ahí. Firefox también.

**Por qué es aceptable en CAMPO:**

El perfil de uso real es: la gente entra a la app, captura durante
5-20 minutos, cierra. Casi nadie deja la app abierta durante horas. El
flujo dominante es "cada apertura = arranque fresco":

1. Abre la PWA / recarga la pestaña → Safari re-checa el SW registrado
   contra el servidor. Si hay versión nueva, la baja e instala en
   background.
2. La lógica de decisión (`src/App.jsx`) activa el SW nuevo:
   - Sin sesión (login) → recarga silenciosa.
   - Con sesión sin cambios → recarga silenciosa.
   - Con sesión con cambios → banner con botón (verificado en E3).
3. En prácticamente todas las sesiones reales, el usuario obtiene la
   versión más reciente al arrancar. El chequeo periódico solo importa
   para sesiones muy largas, que no existen en este operativo.

Verificado en iPhone (2026-09-17): al publicar v6 y luego v7 con la
PWA cerrada entre medias, reabrir desde el ícono trajo v7 sin
intervención del usuario. Este es el caso real y funciona.

**Qué haría falta si algún día importa:**

Si en algún futuro CAMPO empieza a usarse en sesiones largas (ej. un
tablet fijo en oficina de obra que corre toda la jornada), agregar un
handler a `visibilitychange` que dispare `updateSW(false)` cuando la
pestaña recupera foco. Sería un cambio muy pequeño en
`src/pwa-update.js`:

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _updateSW) {
    _updateSW(false).catch(() => {});
  }
});
```

Con eso, cada vez que el usuario vuelva a la pestaña/PWA (o al app
switcher en iOS), Safari re-checa el SW independientemente del timer.
Cubre el 100% de casos con muy poco código. Está pendiente pero no se
implementa ahora porque:

- No hay reportes de sesiones que duren más de una jornada.
- Añadir el handler sin haber medido el flujo real puede introducir
  refreshes indeseables cuando el usuario solo cambia rápido de app y
  vuelve (patrón común en móvil).
- Preferimos observar el comportamiento en producción con el fix
  actual antes de sobreingeniar la detección.

Alternativas más pesadas descartadas: Server-Sent Events / WebSocket
para push "hay update" desde el server, Web Push API para notificar.
Ambas son sobreingeniería para el caso operativo actual.
