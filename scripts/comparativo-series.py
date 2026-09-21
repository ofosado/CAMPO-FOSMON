#!/usr/bin/env python3
"""
Comparativo antes/después de `fix/series-desincronizadas`, obra por obra.

Reproduce las dos formas de obtener el dinero ejecutado de una semana:

  ANTES   serie = (snap.avancePonderado / 100) × obra.presupuesto
  DESPUÉS serie = snap.montoEjecutado          (lo que el snapshot guardó)

y el ejecutado VIVO del catálogo actual, que es el que muestra el KPI:

  KPI     = Σ  cantEjec × pu   (modo volumen)  ó  (a/100) × imp

Con esto se ve, por obra: cuánto divergen hoy las dos gráficas del KPI, y
cuánto van a divergir en cuanto se escriba el primer snapshot del esquema 2.

SOLO LECTURA: únicamente GET contra firestore.googleapis.com.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/comparativo-series.py
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


def dec(v):
    if isinstance(v, dict) and len(v) == 1:
        k = next(iter(v))
        if k in ("nullValue", "booleanValue", "integerValue", "doubleValue",
                 "stringValue", "timestampValue", "arrayValue", "mapValue",
                 "bytesValue", "referenceValue", "geoPointValue"):
            val = v[k]
            if k == "nullValue":
                return None
            if k == "integerValue":
                return int(val)
            if k == "doubleValue":
                return float(val)
            if k == "arrayValue":
                return [dec(x) for x in val.get("values", [])]
            if k == "mapValue":
                return {a: dec(b) for a, b in val.get("fields", {}).items()}
            return val
    if isinstance(v, dict):
        return {a: dec(b) for a, b in v.items()}
    return v


def doc(path):
    return dec(_get(f"{BASE}/{path}").get("fields", {}))


def coleccion(path):
    out, tok = [], None
    while True:
        url = f"{BASE}/{path}?pageSize=300" + (f"&pageToken={tok}" if tok else "")
        r = _get(url)
        for d in r.get("documents", []):
            item = dec(d.get("fields", {}))
            item["__id"] = d["name"].rsplit("/", 1)[-1]
            out.append(item)
        tok = r.get("nextPageToken")
        if not tok:
            return out


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def mxn(x):
    if x is None:
        return "no disponible"
    return f"${x:,.0f}"


# ── Las mismas fórmulas del código, traducidas ────────────────────────
def importe_ejecutado_partida(s, modo_vol):
    if modo_vol:
        ce, pu = num(s.get("cantEjec")), num(s.get("pu"))
        if ce > 0 and pu > 0:
            return ce * pu
    a = num(s.get("a") if s.get("a") is not None else s.get("avance"))
    imp = num(s.get("imp") if s.get("imp") is not None else s.get("importe"))
    return (a / 100.0) * imp


def importe_catalogo_partida(s):
    return num(s.get("imp") if s.get("imp") is not None else s.get("importe"))


def desglose_ejecutado(subs, modo_vol):
    catalogo = excedente = 0.0
    for s in subs or []:
        tot = importe_ejecutado_partida(s, modo_vol)
        tope = importe_catalogo_partida(s)
        if tot > tope:
            catalogo += tope
            excedente += tot - tope
        else:
            catalogo += tot
    return catalogo, excedente, catalogo + excedente


def avance_fisico_ponderado(subs, presupuesto, modo_vol):
    if not presupuesto > 0:
        return 0.0
    t = 0.0
    for s in subs or []:
        ejec = min(importe_ejecutado_partida(s, modo_vol), importe_catalogo_partida(s))
        t += (ejec / presupuesto) * 100.0
    return t


# ── Recorrido ─────────────────────────────────────────────────────────
obras = coleccion("obras")
print("=" * 86)
print(f"COMPARATIVO DE SERIES — {len(obras)} obras · proyecto {PROYECTO}")
print("=" * 86)

tot_div_hoy = 0.0
tot_div_fut = 0.0

for o in sorted(obras, key=lambda x: x["__id"]):
    oid = o["__id"]
    ppto = num(o.get("presupuesto"))
    modo_vol = (o.get("modoAvance") == "volumen")

    subs_doc = doc(f"obras/{oid}/avance/subs")
    subs = subs_doc.get("data") or []
    hist = (doc(f"obras/{oid}/avance/historial").get("semanas")) or []

    cat, exc, kpi = desglose_ejecutado(subs, modo_vol)
    av = avance_fisico_ponderado(subs, sum(importe_catalogo_partida(s) for s in subs), modo_vol)

    print()
    print("─" * 86)
    print(f"{oid}  {str(o.get('nombre'))[:52]}")
    print(f"   contrato {mxn(ppto)}   ·   modo {'volumen' if modo_vol else 'porcentaje'}"
          f"   ·   partidas {len(subs)}   ·   snapshots {len(hist)}")
    if not subs:
        print("   sin catálogo cargado — nada que comparar")
        continue

    print(f"   KPI de hoy (desgloseEjecutado): {mxn(kpi)}"
          f"   [catálogo {mxn(cat)} + excedente {mxn(exc)}]")
    print(f"   avance físico ponderado (topado): {av:.2f}%")

    # Último punto de la gráfica según cada fórmula, con el catálogo de hoy.
    antes_vivo = (av / 100.0) * ppto
    print(f"   último punto de la gráfica  ANTES {mxn(antes_vivo)}"
          f"   ·   DESPUÉS {mxn(kpi)}   ·   Δ {mxn(kpi - antes_vivo)}")
    tot_div_hoy += abs(kpi - antes_vivo)

    if not hist:
        print("   sin historial: la serie arranca cuando se capture la primera semana")
        continue

    print("   histórico semana a semana:")
    print(f"      {'semana':>10} {'esq':>4} {'avance%':>9} "
          f"{'ANTES':>16} {'DESPUÉS':>16} {'Δ':>14}")
    hist_ord = sorted(hist, key=lambda s: (num(s.get("año")), num(s.get("semana"))))
    div_obra = 0.0
    for s in hist_ord:
        esq = int(num(s.get("esquema")) or 1)
        avp = num(s.get("avancePonderado"))
        antes = (avp / 100.0) * ppto
        me = s.get("montoEjecutado")
        desp = num(me) if isinstance(me, (int, float)) else None
        d = (desp - antes) if desp is not None else None
        if d:
            div_obra = max(div_obra, abs(d))
        print(f"      {int(num(s.get('año')))}-W{int(num(s.get('semana'))):02d} "
              f"{esq:>4} {avp:>8.2f}% {mxn(antes):>16} {mxn(desp):>16} "
              f"{(mxn(d) if d is not None else '—'):>14}")
    if div_obra < 1:
        print("      → hoy las dos fórmulas coinciden al peso: el defecto está LATENTE.")
    else:
        print(f"      → ya divergen hasta {mxn(div_obra)} en una misma semana.")

    # Lo que va a pasar en la próxima captura, que ya será esquema 2.
    if exc > 1:
        print(f"      → en la PRÓXIMA captura (esquema 2) el snapshot guardará {mxn(kpi)};")
        print(f"         la fórmula vieja habría seguido mostrando {mxn(antes_vivo)}"
              f" → salto falso de {mxn(exc)}.")
        tot_div_fut += exc
    else:
        print("      → sin excedente: la próxima captura no va a divergir.")

print()
print("=" * 86)
print(f"Divergencia HOY entre gráfica y KPI (suma de valores absolutos): {mxn(tot_div_hoy)}")
print(f"Divergencia que aparecería en la próxima captura con la fórmula vieja: {mxn(tot_div_fut)}")
print("=" * 86)
