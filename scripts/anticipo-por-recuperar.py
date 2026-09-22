#!/usr/bin/env python3
"""
SOLO LECTURA. Qué muestra hoy el KPI "Por recuperar ant." en las 5 obras de
producción, y qué mostraría con la definición contractual.

Hoy:  suma de la amortización embebida en las estimaciones que AÚN NO están
      pagadas. Si no quedan estimaciones pendientes, da $0 — y $0 se lee como
      "ya no hay anticipo que recuperar", que no es lo mismo.

Contractual: anticipo pactado (presupuesto x pct) menos lo ya amortizado.
      Se calculan las dos lecturas de "ya amortizado" porque la frase
      "estimaciones generadas" admite las dos y la diferencia es material:
        · generadas — toda estimación que existe, sin importar su estatus
        · pagadas   — solo las cobradas

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \
      python3 scripts/anticipo-por-recuperar.py
"""

import json
import os
import sys
import urllib.request
import urllib.error

PROYECTO = "campo-fosmon"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents"
TOKEN = os.environ.get("TOKEN")
if not TOKEN:
    sys.exit("Falta TOKEN.")


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
            return {}
        sys.exit(f"HTTP {e.code} en {url}: {e.read().decode()[:300]}")


def val(v):
    """Desenvuelve un Value de la API REST de Firestore."""
    if not isinstance(v, dict):
        return v
    for k in ("stringValue", "booleanValue", "nullValue"):
        if k in v:
            return v[k]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "arrayValue" in v:
        return [val(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: val(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def campos(doc):
    return {k: val(v) for k, v in (doc.get("fields") or {}).items()}


MXN = lambda n: "$" + f"{round(n):,}"

obras = [campos(d) | {"__id": d["name"].rsplit("/", 1)[-1]}
         for d in (_get(f"{BASE}/obras").get("documents") or [])]
obras.sort(key=lambda o: o.get("contrato") or o["__id"])

print(f"{len(obras)} obras en producción\n")
filas = []

for o in obras:
    oid = o["__id"]
    par = campos(_get(f"{BASE}/obras/{oid}/config/parametros"))
    est_doc = campos(_get(f"{BASE}/obras/{oid}/config/estimaciones"))
    est = est_doc.get("data") or []

    # Los porcentajes vienen del doc de parámetros; el fallback es el mismo
    # que usa la pantalla cuando el campo no existe.
    pct_ant = par.get("pctAnticipo", o.get("pctAnticipo", 10)) or 0
    presupuesto = o.get("presupuesto") or 0

    amort = lambda sel: sum((e.get("monto") or 0) * pct_ant / 100
                            for e in est if sel(e))

    hoy_kpi   = amort(lambda e: e.get("estatus") != "Pagada")   # lo que se muestra HOY
    amort_gen = amort(lambda e: True)                           # todas las generadas
    amort_pag = amort(lambda e: e.get("estatus") == "Pagada")   # solo las pagadas
    anticipo  = presupuesto * pct_ant / 100

    filas.append({
        "obra": o.get("contrato") or oid,
        "id": oid,
        "estado": o.get("estado", "?"),
        "n_est": len(est),
        "n_pend": sum(1 for e in est if e.get("estatus") != "Pagada"),
        "pct": pct_ant,
        "presupuesto": presupuesto,
        "anticipo": anticipo,
        "hoy": hoy_kpi,
        "nuevo_gen": anticipo - amort_gen,
        "nuevo_pag": anticipo - amort_pag,
        "estatus": [e.get("estatus") for e in est],
    })

for f in filas:
    print(f"── {f['obra']}  ({f['id']}, {f['estado']})")
    print(f"   contrato {MXN(f['presupuesto'])} · anticipo {f['pct']}% = {MXN(f['anticipo'])}")
    print(f"   {f['n_est']} estimaciones ({f['n_pend']} sin pagar): {', '.join(f['estatus']) or 'ninguna'}")
    print(f"   HOY  (amortización de las NO pagadas) ....... {MXN(f['hoy'])}"
          + ("   <- $0 y el KPI desaparece de facto" if f['hoy'] == 0 else ""))
    print(f"   NUEVO por 'generadas' (todas las que existen)  {MXN(f['nuevo_gen'])}")
    print(f"   NUEVO por 'pagadas'   (solo las cobradas) .... {MXN(f['nuevo_pag'])}")
    print()

print("═" * 78)
print(f"{'Obra':<26}{'HOY':>15}{'NUEVO generadas':>18}{'NUEVO pagadas':>17}")
print("─" * 78)
for f in filas:
    print(f"{f['obra'][:25]:<26}{MXN(f['hoy']):>15}{MXN(f['nuevo_gen']):>18}{MXN(f['nuevo_pag']):>17}")
print("═" * 78)

sin_pendientes = [f for f in filas if f["n_pend"] == 0]
if sin_pendientes:
    print("\nObras donde HOY el KPI da $0 por no haber estimaciones pendientes:")
    for f in sin_pendientes:
        print(f"  · {f['obra']} — pero del anticipo de {MXN(f['anticipo'])} "
              f"siguen sin amortizar {MXN(f['nuevo_gen'])}")
