# Pendientes — CAMPO / cotea

Una línea por tema. El detalle vive en `PENDIENTES-ARCHIVO.md`, en la sección
con el mismo número. **Esta lista no crece con ensayos**: un hallazgo nuevo
entra en tres líneas y, si alguien lo trabaja, el ensayo se escribe entonces.

Hasta el 2026-10-06 el archivo creció 1,057 líneas y se le quitaron 22. Por eso
no se podía ver si la lista avanzaba: no avanzaba, engordaba.

**Estado**: `ABIERTO` · `EN RAMA` (hay rama viva) · `PARCIAL` (una parte se
arregló, otra no) · `SOSPECHA` (no confirmado) · `POR DESPLEGAR` (el código
está, falta subirlo) · `CERRADO`.

**El orden es por daño, no por esfuerzo.** Primero lo que destruye datos sin
vuelta atrás; luego lo que hace que una pantalla afirme algo falso; luego lo
que impide enseñar el producto; luego lo que puede fallar en silencio; luego lo
que falta y se prometió; al final lo cosmético.

Los principios P1–P6 no están aquí: no se cierran, gobiernan. Viven en el
archivo.

---

## 1 · Destruye datos, y no hay vuelta atrás

| # | Tema | Estado |
|---|---|---|
| 5 | **Nunca se ha probado una restauración.** Ya hay respaldos (el 403 se arregló el 2026-09-21), pero un respaldo que nadie restauró no consta que sirva. Caducan a los 112 días. | PARCIAL |
| 30 | **El catálogo vivo `avance/subs` se llena, y lo llenan las URLs de Storage** — 85% del documento en la 0112 con sólo 14 partidas. La URL es reconstruible desde la ruta y no hace falta guardarla. Un catálogo de 2,000 partidas no cabe el día del alta. | ABIERTO |
| 28 | **El historial de avance sigue en UN documento con tope de 52 semanas**, y el recorte ya borró 7 cierres de la 0114. La nómina sí migró a subcolección (desplegada 2026-09-23); el avance no. | PARCIAL |
| 28b | **Los documentos viejos de nómina ya se pueden vaciar** — la fecha de seguridad era el 2026-09-30 y ya pasó. Es una decisión tuya, no una tarea: hasta vaciarlos son la única salida de la migración. | DECISIÓN |
| 21 | **Cambiar a modo volumen borra el avance capturado, en silencio.** | ABIERTO |
| 22 | **`fsGet`/`fsSet`/`fsDel` se tragan cualquier fallo** (64 llamadas): una escritura rechazada por reglas se ve exactamente igual que una exitosa. El caso urgente se cerró en `fix/catalogo-no-borra-avance`; el resto no. | PARCIAL |

## 2 · El expediente afirma algo falso

| # | Tema | Estado |
|---|---|---|
| 39 | **El resumen semanal por correo lee la raíz, no `orgId`**: el margen bruto de una constructora puede salir en el correo de otra organización. Es el P5 roto por fuera de la pantalla. | ABIERTO |
| 7 | **Obra 0112: lo ejecutado no cuadra con las estimaciones del residente** — $2.5M de diferencia sin explicar. | ABIERTO |
| 8 | **Tres fórmulas distintas de «ejecutado» conviviendo en el código**, $3.8M entre ellas. Dos ramas ya atendieron parte. | PARCIAL |
| 3 | **Pantallas que afirman en cero mientras llega el dato.** El Panel principal ya está; siguen la lista de obras, los módulos por obra, y el encabezado de Evidencia que dice «0 semanas cerradas» (medido 2026-10-06). El patrón de arreglo ya existe: `estCargadas`. | PARCIAL |
| 2 | **Primer ingreso: GP se queda en «cargando».** Consecuencia mitigada en `fix/arranque`, causa raíz abierta. | PARCIAL |
| 47 | **El año de la semana se pierde en dos sitios**, y en obras multianuales eso mezcla semanas de años distintos. Las dos partes deben arreglarse juntas. | PARCIAL |
| — | **La cuenta de «Última captura» está escrita cuatro veces** y una de las cuatro miente. La tabla de la dependencia no es ninguna de ellas. | ABIERTO |
| 25 | **`global/health` registra la intención, no el hecho**: el aviso de «el respaldo falló» puede estar mintiendo en cualquier dirección. | ABIERTO |
| 29 | **Falta el índice de `auditoria` por `obraId`**: la bitácora filtrada por obra sale vacía, que se lee como «no hubo actividad». | ABIERTO |
| 9 | **Dos decimales no alcanzan para capturar volumen** — el redondeo cambia la cifra. | ABIERTO |

## 3 · Impide enseñar el producto

| # | Tema | Estado |
|---|---|---|
| 6 | **No hay dónde capturar estimaciones en dependencia.** Es la mitad financiera del expediente y hoy no se puede demostrar. Dos amarres son condición de la rama: no renombrar `monto` ni `estatus`, y usar `fsSetAEstricto` (nunca `fsSetA`, que se traga el rechazo en un formulario de dinero). | SIGUIENTE |
| 48 | **El plazo no dice si la obra va bien o mal**: días de atraso o a favor como KPI (−27 en verde, +55 en rojo), el par avance-contra-plazo, y la gráfica de avance acumulado con proyección. Pedido el 2026-10-06. | ABIERTO |
| 49 | **Notas de reporte semanal sembradas** para que la prueba se vea como se va a ver en la demo. Pedido el 2026-10-06. | ABIERTO |
| 4b | **Cuentas de prueba dedicadas por rol.** Depende del #4. | ABIERTO |
| 4 | **Proyecto Firebase de pruebas con copia de datos.** Habilita el #4b y la migración a organizaciones. | ABIERTO |
| 1 | **Sacar el repositorio de iCloud Drive.** | ABIERTO |

## 4 · Puede fallar en silencio

| # | Tema | Estado |
|---|---|---|
| 6b | **Falta `onAuthStateChanged`: sesión zombie tras revocación.** Ojo: hay dos pendientes numerados 6; éste es el de sesión. | ABIERTO |
| 19 | **`setObra` sin declarar en GastosGP** — crash de runtime latente. | ABIERTO |
| 44 | **Un banco apuntado a un puerto muerto cuelga la suite** en vez de fallar: no hay plazo y el silencio no grita. | ABIERTO |
| 23 | **`networkTimeoutSeconds: 5` del service worker** afecta toda lectura de Firestore, no sólo la que se pensó. | ABIERTO |
| 20 | **Integrar la verificación de ámbito de forma permanente** (hoy es un guion que alguien se acuerda de correr). | ABIERTO |
| 46 | **El aviso de «tu rol cambió» puede dispararse al cambiar de sesión** — un `useRef` que no se vacía. Sin confirmar. | SOSPECHA |
| 40 | **La lectura del GP Sheet arranca antes de que haya sesión.** | ABIERTO |
| — | **Despliegue de funciones pendiente**: rebase de `feature/resumen-semanal` + canario, y el retiro del cron `recordatorioCapturaSubs` que se fue con el #31. | POR DESPLEGAR |

## 5 · Falta algo que se prometió

| # | Tema | Estado |
|---|---|---|
| 12 | **Exportación del expediente completo del cliente** (art. 74). Bloquea el contrato, no la demo. | ABIERTO |
| 45 | **El informe del Art. 73 no existe**: el PDF ejecutivo que hay está hecho para la constructora, no para una dependencia. | ABIERTO |
| 13 | **Rehacer el PDF.** | ABIERTO |
| 24 | **Plan de correos** — qué manda cotea y qué no. Urge el aviso de respaldo fallido y la recuperación de contraseña; el resto puede esperar. | ABIERTO |
| 26 | **Pantalla de salud del sistema en administración.** Es la única señal útil si el backend está caído. | ABIERTO |
| 27 | **La proyección asume contrato cerrado, y en TAMSA no aplica.** Depende de que exista `tipoContrato`. | ABIERTO |
| 10 | **El formulario de maquinaria no pide fecha por movimiento.** | ABIERTO |
| 41 | **La empresa ejecutante se teclea** — el mismo RFC escrito tres veces son tres empresas distintas. Ya existe de dónde traerlo. | ABIERTO |
| 36 | **El naranja de marca choca con el naranja de estado**: con daltonismo rojo-verde no se distingue «al corriente» de «crítico», y el color va solo. | ABIERTO |
| 14 | **Manual de usuario con capturas + correo de alta automatizado.** | ABIERTO |

## 6 · Orden, deuda y cosmética

| # | Tema | Estado |
|---|---|---|
| 11 | Consolidar los bloques duplicados de KPIs en Nómina y Estimaciones. | ABIERTO |
| 15 | Distinguir «la obra avanzó» de «el residente se puso al corriente». | ABIERTO |
| 16 | Sesión persistente: decidir la política. | ABIERTO |
| 17 | Auditar otros módulos por el mismo hueco de «fecha faltante». | ABIERTO |
| 33 | `PanelEjecutivo` lleva desde el 18 de septiembre sin renderizarse. Ya se editó por error una vez: o se reactiva o se borra. | ABIERTO |
| 43 | El correo del resumen semanal sigue firmando como CAMPO · FOSMON (6 sitios). | ABIERTO |
| 37 | Los íconos de PWA no se despliegan hasta después de la demo. | ABIERTO |
| 18 | Nómina: arrastrar y soltar + pegar desde el portapapeles. | ABIERTO |
| 42 | cotea no tiene eslogan y el campo está esperando uno. | DECISIÓN |
| — | Unificar las tres copias del aplanado de fotos (se va con el #30). | ABIERTO |

## Cerrados

Con verificación, para no volver a levantarlos sin dato nuevo. El detalle en el
archivo.

| # | Tema | Cuándo |
|---|---|---|
| 38 | El login inventaba el perfil que no encontraba y se autoasignaba permisos de escritura. | 2026-09-24 |
| 35 | El modelo escrito decía que la dependencia no captura, y es falso; la escritura se denegaba y `fsSet` lo callaba. | 2026-09-24 |
| 34 | El transporte decodificaba el cuerpo trozo a trozo y partía caracteres UTF-8 en la frontera. | 2026-09-23 |
| 32 | La galería de fotos del cliente no pintaba ni una foto, y anunciaba que sí había. | mezclado |
| 31 | El histórico semanal de subcontratos nunca existió — retirado. | 2026-09-22 |
| — | Las fotos sin `id`: medido en producción, 631 con `id` y 0 sin él. Producción está limpia. | 2026-10-05 |
| — | El parser de TAMSA absorbía horas extra en el conteo de días. | 2026-09-19 |
