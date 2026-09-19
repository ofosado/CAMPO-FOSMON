# Pendientes conocidos — CAMPO

Registro de deuda técnica que NO es de seguridad. Los pendientes de
seguridad viven en [SECURITY_RULES.md](SECURITY_RULES.md).

Cada entrada dice: qué es el problema, por qué importa, dónde vive el
hueco en el código, y una propuesta de fix. Antes de tomar cualquiera
de estos, releer el contexto — puede haber cambiado.

---

## 1. Formulario de maquinaria no pide fecha por movimiento

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

**Prioridad**: media-alta. Hacer antes de que alguien capture maquinaria
en producción.

---

## 2. Auditar otros módulos por el mismo hueco

**Contexto**: el hueco de maquinaria (punto 1) es de un patrón: el código
de agrupación temporal espera un campo del formulario que no existe.
Puede haber más lugares donde pase lo mismo.

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

**Prioridad**: media. Preventivo. No hay evidencia de otro caso pero
tampoco de la ausencia.

---

## 3. Distinguir "obra que avanzó" de "residente que se puso al corriente"

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

- Pendiente #1 (fecha por movimiento en maquinaria) también contribuye
  al problema — sin fecha, la maquinaria "aparece de golpe" en el
  presente. Resolver #1 disminuye el ruido pero no elimina el fenómeno
  para el snapshot de avance.
- Pendiente #2 (auditar otros formularios) puede descubrir más lugares
  con la misma dinámica.

**Prioridad**: media. Hoy no hay incidente porque no hay historial
suficiente para que se note. La primera vez que un directivo pregunte
"¿por qué esta obra creció tanto en una semana?" hay que resolver esto.

**Registrado por instrucción explícita del usuario en el review de
`feature/dashboard-principal` (2026-09-19).**

---

## 4. Consolidar bloques duplicados de KPIs en Nómina y Estimaciones

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

**Prioridad**: media-alta. El "141 vs 143" es lo primero que un usuario
crítico pregunta al mirar la pantalla y hoy no tenemos respuesta que
sostener sin explicar un bug conceptual.

**Registrado por instrucción explícita del usuario en el review de
`feature/dashboard-principal` (2026-09-19). Ir en rama propia
DESPUÉS de mezclar `feature/dashboard-principal`.**

---
