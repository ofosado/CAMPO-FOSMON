#!/usr/bin/env python3
"""
SOLO LECTURA. ¿Las fotos de producción traen `id`, o no?

Por qué la pregunta. `ConceptoFotos` pinta cada miniatura con `key={f.id}` y
borra con `onDel(f.id)`. Si `f.id` es `undefined`:

  · todas las miniaturas comparten la misma llave vacía, y React pierde cuál
    es cuál al reordenar — y la lista SÍ se reordena, porque el botón
    «ver anteriores» cambia `visibles` de `[ahora]` a `[...ahora, ...viejas]`;
  · `onDel(undefined)` no identifica una foto: identifica a todas o a ninguna.

El riesgo concreto es pulsar la × de una foto y que desaparezca otra. Eso es
pérdida de datos a un clic, y por eso se mide contra producción antes de
tocar nada: en el emulador sembrado se vio, pero la siembra no es el dato.

Lo que mide, por obra y en total:
  · cuántas fotos hay
  · cuántas NO traen `id`
  · si las que sí lo traen son únicas entre sí (un `id` repetido rompe igual)
  · qué otros campos traen, para saber si hay una llave estable alternativa

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \
      python3 scripts/medir-fotos-sin-id.py
"""

import json
import os
import sys
import urllib.request
import urllib.error
from collections import Counter

PROYECTO = "campo-fosmon"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents"
TOKEN = os.environ.get("TOKEN")
if not TOKEN:
    sys.exit("Falta TOKEN. Ver el encabezado de este archivo.")


def _get(url):
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {TOKEN}", "X-Goog-User-Project": PROYECTO},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        # Un fallo de lectura TIENE que parar el guion. Devolver vacío y seguir
        # haría que un token vencido salga como «0 fotos sin id», que es una
        # respuesta creíble y falsa.
        sys.exit(f"Firestore contestó {e.code} en {url}\n{e.read()[:300]}")


def val(v):
    if v is None:
        return None
    for k in ("stringValue", "booleanValue"):
        if k in v:
            return v[k]
    if "nullValue" in v:
        return None
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "timestampValue" in v:
        return v["timestampValue"]
    if "mapValue" in v:
        return {k: val(x) for k, x in (v["mapValue"].get("fields") or {}).items()}
    if "arrayValue" in v:
        return [val(x) for x in (v["arrayValue"].get("values") or [])]
    return None


def campos(doc):
    return {k: val(v) for k, v in ((doc or {}).get("fields") or {}).items()}


def fotos_de_sub(s):
    """La misma lectura que `fotosDeSub` en src/App.jsx: `s.fotos` puede ser
    un arreglo directo o un objeto {subId: [foto,...]}.

    OJO con el filtro. `fotosDeSub` descarta lo que no es objeto, y la primera
    versión de este guion copió ese filtro — con lo cual las fotos guardadas
    como CADENA SUELTA, que son justamente las que no pueden tener `id`,
    quedaban fuera del conteo. La medición habría dicho «0 sin id» por
    construcción: la pregunta excluía la respuesta. Aquí se devuelven TODAS y
    se clasifican después."""
    f = (s or {}).get("fotos")
    if not f:
        return []
    if isinstance(f, list):
        return list(f)
    if isinstance(f, dict):
        out = []
        for v in f.values():
            if isinstance(v, list):
                out += list(v)
            elif v is not None:
                out.append(v)
        return out
    return [f]


obras = (_get(f"{BASE}/obras?pageSize=300") or {}).get("documents", [])
print(f"obras en producción: {len(obras)}\n")

tot = sin_id = no_objeto = 0
campos_vistos = Counter()

for o in obras:
    oid = o["name"].rsplit("/", 1)[-1]
    subs = campos(_get(f"{BASE}/obras/{oid}/avance/subs")).get("data") or []

    fotos = []
    for s in subs:
        fotos += fotos_de_sub(s)

    # Una foto que no es objeto NO PUEDE tener `id`: se cuenta aparte porque
    # es otra clase de hueco, no el mismo campo faltando.
    sueltas = [f for f in fotos if not isinstance(f, dict)]
    objetos = [f for f in fotos if isinstance(f, dict)]
    faltan = [f for f in objetos if not f.get("id")]
    ids = [f.get("id") for f in objetos if f.get("id")]
    repetidos = [k for k, c in Counter(ids).items() if c > 1]

    for f in objetos:
        campos_vistos.update(f.keys())

    tot += len(fotos)
    sin_id += len(faltan)
    no_objeto += len(sueltas)

    print(f"── {oid}")
    print(f"   partidas: {len(subs)}   fotos: {len(fotos)}   "
          f"SIN id: {len(faltan)}   no son objeto: {len(sueltas)}   "
          f"ids repetidos: {len(repetidos)}")
    if repetidos:
        print(f"   repetidos: {repetidos[:5]}")
    if sueltas:
        print(f"   ejemplo suelta: {str(sueltas[0])[:80]}")

mudas = sin_id + no_objeto
print("\n── TOTAL")
print(f"   fotos en producción: {tot}")
print(f"   objetos SIN `id`: {sin_id}")
print(f"   fotos que no son objeto (no pueden tener `id`): {no_objeto}")
print(f"   sin llave utilizable: {mudas}"
      f"   ({(mudas / tot * 100) if tot else 0:.1f}%)")
print(f"   campos que trae una foto: "
      f"{', '.join(f'{k}×{c}' for k, c in campos_vistos.most_common())}")
print()
if mudas:
    print("   HAY FOTOS SIN LLAVE EN PRODUCCIÓN. `onDel(f.id)` no puede")
    print("   identificarlas, y React reusa nodos al reordenar la lista.")
else:
    print("   Todas las fotos de producción traen `id` y son objetos. Lo")
    print("   visto en el emulador es de la siembra, no del dato real.")
