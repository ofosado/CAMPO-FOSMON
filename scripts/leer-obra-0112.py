#!/usr/bin/env python3
"""
Diagnóstico de SOLO LECTURA de la obra 0112 (SIOP Coatza Malecón).

Por qué Python y no .cjs como el resto de scripts/: `firebase-admin` está
declarado en devDependencies pero NO está instalado en node_modules, y
instalarlo tocaría package-lock.json. Este script usa la API REST de
Firestore con el token de ADC, así que no necesita instalar nada.

SOLO LECTURA: únicamente emite GET contra firestore.googleapis.com. No hay
ninguna llamada de escritura (PATCH/POST/DELETE/commit) en este archivo.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/leer-obra-0112.py

Responde:
  (a) importe del catálogo cargado en 0112
  (b) desglose del ejecutado: dentro de catálogo vs partidas sobre 100%
  (c) partidas con badge amarillo (cantEjec/cant > 1) y pérdida por recorte
  (d) almacén de materiales, para contrastar contra el residual de $215,619
"""

import json
import os
import sys
import urllib.request
import urllib.error

PROYECTO = "campo-fosmon"
OBRA = "0112"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents"

TOKEN = os.environ.get("TOKEN")
if not TOKEN:
    sys.exit("Falta TOKEN. Usa: TOKEN=$(gcloud auth application-default print-access-token) python3 ...")


def get(path):
    """GET de un documento. Devuelve {} si no existe."""
    req = urllib.request.Request(
        f"{BASE}/{path}",
        headers={"Authorization": f"Bearer {TOKEN}", "X-Goog-User-Project": PROYECTO},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return decodificar(json.load(r).get("fields", {}))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        sys.exit(f"HTTP {e.code} leyendo {path}: {e.read().decode()[:400]}")


def decodificar(v):
    """Convierte el JSON tipado de Firestore REST a tipos de Python."""
    if isinstance(v, dict) and len(v) == 1 and next(iter(v)).endswith(
        ("Value", "value")
    ) and next(iter(v)) != "fields":
        (k, val), = v.items()
        if k == "nullValue":
            return None
        if k == "booleanValue":
            return val
        if k == "integerValue":
            return int(val)
        if k == "doubleValue":
            return float(val)
        if k == "stringValue":
            return val
        if k == "timestampValue":
            return val
        if k == "arrayValue":
            return [decodificar(x) for x in val.get("values", [])]
        if k == "mapValue":
            return {kk: decodificar(vv) for kk, vv in val.get("fields", {}).items()}
        return val
    if isinstance(v, dict):
        return {kk: decodificar(vv) for kk, vv in v.items()}
    return v


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def mxn(x):
    return f"${x:,.2f}"


# ── Lectura ────────────────────────────────────────────────────────────
obra = get(f"obras/{OBRA}")
info = get(f"obras/{OBRA}/config/info")
subs = get(f"obras/{OBRA}/avance/subs").get("data") or []
materiales = get(f"obras/{OBRA}/avance/materiales").get("data") or []
estimaciones = get(f"obras/{OBRA}/config/estimaciones").get("data") or []
maquinaria = get(f"obras/{OBRA}/avance/maquinaria").get("data") or []
otros = get(f"obras/{OBRA}/config/otros_gastos").get("items") or []

modo = info.get("modoAvance") or obra.get("modoAvance") or "porcentaje"

print("=" * 72)
print(f"OBRA {OBRA} — {obra.get('nombre') or info.get('nombre') or '(sin nombre)'}")
print(f"modoAvance = {modo!r}   ·   partidas en catálogo: {len(subs)}")
print("=" * 72)

# ── (a) Catálogo ───────────────────────────────────────────────────────
suma_imp = sum(num(s.get("imp")) for s in subs)
suma_cant_pu = sum(num(s.get("cant")) * num(s.get("pu")) for s in subs)
print("\n(a) IMPORTE DEL CATÁLOGO — tres representaciones que pueden diverger")
print(f"    obra.presupuesto           = {mxn(num(obra.get('presupuesto')))}")
print(f"    config/info.presupuesto    = {mxn(num(info.get('presupuesto')))}")
print(f"    Σ s.imp (partidas)         = {mxn(suma_imp)}")
print(f"    Σ s.cant × s.pu            = {mxn(suma_cant_pu)}")

# ── (b) Ejecutado ──────────────────────────────────────────────────────
# Réplica exacta de calcularKPIsObra (src/App.jsx:3133-3137):
#   am = Σ (s.a/100) × s.imp        ← s.a viene recortado a 100 (App.jsx:9374)
#   me = am + almacén
am = sum((num(s.get("a")) / 100.0) * num(s.get("imp")) for s in subs)
almacen = sum(num(m.get("imp")) for m in materiales)
me = am + almacen

sobre100 = [s for s in subs if num(s.get("cant")) > 0
            and num(s.get("cantEjec")) / num(s.get("cant")) > 1.0]
ids_sobre = {id(s) for s in sobre100}
am_dentro = sum((num(s.get("a")) / 100.0) * num(s.get("imp"))
                for s in subs if id(s) not in ids_sobre)
am_sobre = sum((num(s.get("a")) / 100.0) * num(s.get("imp"))
               for s in subs if id(s) in ids_sobre)

print("\n(b) DESGLOSE DEL EJECUTADO (fórmula del KPI del dashboard)")
print(f"    Avance monetario  Σ(a/100)×imp = {mxn(am)}")
print(f"      · de partidas dentro del 100%        = {mxn(am_dentro)}")
print(f"      · de partidas que superan el 100%    = {mxn(am_sobre)}")
print(f"        (topadas: aportan solo su importe de catálogo, ni un peso más)")
print(f"    + almacén de materiales                = {mxn(almacen)}")
print(f"    = Ejecutado (me)                       = {mxn(me)}")

# ── (c) Badge amarillo y pérdida por recorte ───────────────────────────
print(f"\n(c) PARTIDAS CON BADGE AMARILLO (cantEjec/cant > 1): {len(sobre100)}")
perdida_total = 0.0
if sobre100:
    print(f"    {'sec':<10} {'cat':>14} {'real cantEjec×pu':>18} {'perdido':>14}  {'%':>7}")
    for s in sorted(sobre100,
                    key=lambda s: num(s.get("cantEjec")) * num(s.get("pu")) - num(s.get("imp")),
                    reverse=True):
        imp_cat = num(s.get("imp"))
        imp_real = num(s.get("cantEjec")) * num(s.get("pu"))
        perdido = imp_real - imp_cat
        perdida_total += perdido
        pct = num(s.get("cantEjec")) / num(s.get("cant")) * 100
        print(f"    {str(s.get('sec') or '?'):<10} {mxn(imp_cat):>14} {mxn(imp_real):>18} "
              f"{mxn(perdido):>14}  {pct:6.1f}%")
        print(f"      {str(s.get('sub') or '')[:88]}")
print(f"\n    PÉRDIDA TOTAL POR EL RECORTE A 100% = {mxn(perdida_total)}")
print(f"    Ejecutado si NO se recortara        = {mxn(me + perdida_total)}")

# ── (d) Contraste con el control del residente ─────────────────────────
tot_est = sum(num(e.get("monto")) for e in estimaciones)
print(f"\n(d) CONTRASTE")
print(f"    Almacén de materiales                = {mxn(almacen)}  ({len(materiales)} renglones)")
print(f"    ¿explica el residual de $215,619.00? → "
      f"{'SÍ, coincide' if abs(almacen - 215619) < 1 else 'NO exactamente'}"
      f" (diferencia {mxn(almacen - 215619)})")
print(f"    Estimaciones capturadas en CAMPO     = {mxn(tot_est)}  ({len(estimaciones)})")
for e in estimaciones:
    print(f"      · {str(e.get('num') or e.get('id') or '?'):<14} "
          f"{mxn(num(e.get('monto'))):>16}  {e.get('estatus') or ''}")
print(f"    Maquinaria: {len(maquinaria)} renglones · Otros gastos: {len(otros)} renglones")
print("\n" + "=" * 72)
