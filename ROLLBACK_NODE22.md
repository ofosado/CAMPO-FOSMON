# Rollback del upgrade Cloud Functions a Node 22

Procedimiento operativo para revertir el upgrade Node 20 → 22 desplegado
desde la rama `mantenimiento/node22` (commit `f441eb7`).

**Solo usar si el deploy a Node 22 provoca un problema real en producción.**
Antes de rollback, verifica en Cloud Functions logs si el error es de código
(fix en rama nueva) o de runtime (Node 22 en sí). Si es de código, no bases
el fix en un rollback — arregla en rama y re-despliega.

---

## Prerrequisitos

- Estar en la raíz del repo: `/Users/ofosado/Desarrollo/CAMPO-FOSMON`
- Rama `main` con el merge de `mantenimiento/node22` ya aplicado.
- `gcloud auth application-default login` vigente (para verificar estado
  post-rollback con `gcloud functions list`).
- Firebase CLI autenticado en `campo-fosmon`.

---

## Opción A — Rollback completo (regresa las 16 funciones a Node 20)

Usar cuando:
- El problema es del runtime Node 22 en general (memory, cold start, incompatibilidad
  con alguna librería transitiva).
- Varias funciones fallan al mismo tiempo.
- No sabes qué función está rota y necesitas volver al estado conocido bueno.

```bash
cd /Users/ofosado/Desarrollo/CAMPO-FOSMON

# 1) Volver package.json y package-lock.json al estado previo al upgrade.
#    El merge de mantenimiento/node22 a main es 9f49df0 (2026-09-21 13:0x) y el
#    commit ANTERIOR, el estado bueno conocido en Node 20, es f01f83b.
#    Verificable con `git log --oneline main`.
git checkout f01f83b -- functions/package.json functions/package-lock.json

# 2) Reinstalar dependencias en Node 20 (regenera árbol de node_modules).
cd functions
rm -rf node_modules
npm install
cd ..

# 3) Redesplegar las 16 funciones con runtime Node 20.
#    Todas se re-crean en el swap (~2-4 min por función; secuencial por Firebase).
firebase deploy --only functions --project campo-fosmon
```

**Tiempo total estimado**: 8-15 min (npm install ~1 min + deploy secuencial).

**Ventana de indisponibilidad**: 1-2 min por función. Callables retornan 5xx;
programadas pueden saltar ejecuciones que coincidan con el swap.

**Después del rollback**:
- Verifica con `gcloud functions list --v2 --project campo-fosmon --regions us-central1 --format="table(name.basename(),updateTime.date(tz=LOCAL))"` que las 16 tengan updateTime del rollback.
- Investiga la causa raíz antes de intentar Node 22 de nuevo.
- **NO merges `mantenimiento/node22` de nuevo hasta arreglar la causa**;
  el commit `f441eb7` sigue vivo en la rama.

---

## Opción B — Rollback acotado (una sola función a Node 20)

Usar cuando:
- El problema está identificado en UNA función específica.
- Las otras 15 funcionan bien en Node 22 y no quieres tocarlas.
- Prefieres una intervención quirúrgica antes que un rollback total.

Ejemplo: bajar solo `sincronizarClaims` a Node 20 (sustituye por la función
que quieras revertir).

```bash
cd /Users/ofosado/Desarrollo/CAMPO-FOSMON

# 1) Backup del package.json actual (Node 22).
cp functions/package.json functions/package.json.node22.bak
cp functions/package-lock.json functions/package-lock.json.node22.bak

# 2) Cambiar temporalmente el runtime del codebase a Node 20.
#    Usa sed o edita el archivo a mano: engines.node debe quedar "20".
sed -i.tmp 's/"node": "22"/"node": "20"/' functions/package.json
rm -f functions/package.json.tmp

# 3) Reinstalar node_modules con las versiones que ya estaban en package.json
#    (firebase-admin ^13.10.0, firebase-functions ^7.4.0 son compatibles con
#    ambos runtimes — solo cambia el engine que Firebase provisiona).
cd functions
rm -rf node_modules
npm install
cd ..

# 4) Deploy ACOTADO a la función afectada. Firebase respeta el package.json
#    actual (Node 20) SOLO para las funciones que le pases con --only.
#    Las otras 15 quedan intactas en Node 22 porque no las tocamos.
firebase deploy --only functions:sincronizarClaims --project campo-fosmon
#                                     ^^^^^^^^^^^^^^^^^^ sustituye por la afectada

# 5) RESTAURAR el package.json a Node 22 inmediatamente para evitar que un
#    deploy futuro `--only functions` (todas) baje las otras 15 sin querer.
mv functions/package.json.node22.bak functions/package.json
mv functions/package-lock.json.node22.bak functions/package-lock.json
cd functions
rm -rf node_modules
npm install
cd ..
```

**Tiempo total estimado**: 5-8 min.

**Ventana de indisponibilidad**: 1-2 min solo para la función afectada.

**Verificación post-rollback acotado**:
```bash
gcloud functions describe sincronizarClaims --gen2 --region=us-central1 \
  --project=campo-fosmon --format="value(buildConfig.runtime)"
# Debe imprimir: nodejs20
```

Otras funciones deben seguir en `nodejs22`:
```bash
gcloud functions list --v2 --project campo-fosmon --regions us-central1 \
  --format="table(name.basename(),buildConfig.runtime,updateTime.date(tz=LOCAL))"
```

**⚠ Advertencia crítica del paso 5**: si te saltas la restauración del
`package.json` a Node 22 y alguien (o tú mismo) ejecuta después
`firebase deploy --only functions` (sin nombre específico), las 15 funciones
que quedaron en Node 22 se BAJARÍAN a Node 20 sin aviso. El paso 5 es
obligatorio.

**Cuando resuelvas el problema de la función acotada**:
```bash
# Con el package.json ya restaurado a Node 22, redespliega la función
# arreglada para volverla al runtime del resto:
firebase deploy --only functions:sincronizarClaims --project campo-fosmon
```

---

## Opción C — Rollback con gcloud (avanzado, sin tocar package.json)

Alternativa a la Opción B que evita el swap del `package.json` pero requiere
replicar todos los parámetros de la función (memoria, timeout, secretos,
región, trigger). No la recomiendo para uso normal — la Opción B es más
robusta porque Firebase CLI mantiene la configuración de código como fuente
de verdad. Documentada aquí solo por referencia.

Este camino no se usa por default: si necesitas replicar toda la configuración
manualmente, es señal de que la Opción A o B son más apropiadas.

---

## Cómo elegir entre A y B

| Situación | Elige |
|---|---|
| No sabes qué función está rota | A |
| Varias funciones fallan simultáneamente | A |
| Error genérico de runtime (memory, cold start, timeout) | A |
| Una función específica arroja error de código con Node 22 | B |
| Solo una función tiene una dependencia incompatible con Node 22 | B |
| Los recordatorios semanales funcionan pero un callable no | B (sobre el callable) |

---

## Contacto de rollback

- Repositorio: https://github.com/ofosado/CAMPO-FOSMON
- Rama del upgrade original: `mantenimiento/node22` (commit `f441eb7`)
- Reglas de despliegue vigentes: martes-jueves, evitar `:14`-`:16` de cualquier
  hora (por `actualizarGPSheet` que corre en `:15`).

---

## Backup preventivo antes de intentar Node 22 de nuevo

Si tras un rollback quieres reintentar el upgrade, correr este snapshot antes:

```bash
# Snapshot del estado de todas las funciones ANTES del reintento
gcloud functions list --v2 --project campo-fosmon --regions us-central1 \
  --format=json > ~/campo-backups/functions-runtime-$(date +%Y-%m-%d-%H%M).json
```
