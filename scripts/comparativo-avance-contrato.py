#!/usr/bin/env python3
"""
El comparativo de fix/compensacion-volumenes: qué número ve el usuario antes y
después, obra por obra.

Reproduce las dos definiciones del avance físico:

  ANTES    Σ min(ejecutado_partida, catálogo_partida) / Σ catálogo × 100
           El tope va PARTIDA POR PARTIDA. El volumen ejecutado por encima del
           catálogo de una partida no cuenta como avance de la obra, aunque
           otra partida haya quedado corta por la misma cantidad.

  DESPUÉS  min(100, ejecutado / contrato × 100)
           El tope va AL TOTAL. Dentro del 100 % las partidas se compensan
           entre sí, que es como se ejecuta realmente una obra: unas se pasan,
           otras quedan cortas, y la obra cierra en el importe contratado.

Y el trío que ahora se muestra siempre junto en la pantalla:

  CONTRATADO · EJECUTADO · POR EJECUTAR       (por ejecutar = contrato − ejec)

más el desglose de compensación de volúmenes que explica la diferencia: cuántas
partidas se pasaron, cuántas quedaron cortas y el neto.

El dinero NO se topa (P1): si el ejecutado pasa del contrato se reporta aparte
como sobre contrato, que no es ingreso mientras no haya convenio.

SOLO LECTURA: únicamente GET contra firestore.googleapis.com.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/comparativo-avance-contrato.py
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
    return f"${x:,.0f}"


# ── Las mismas fórmulas de src/App.jsx, traducidas ────────────────────
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


# ── Recorrido ─────────────────────────────────────────────────────────
obras = coleccion("obras")
print("=" * 100)
print(f"AVANCE · EJECUTADO · POR EJECUTAR — {len(obras)} obras · proyecto {PROYECTO}")
print("=" * 100)

filas = []

for o in sorted(obras, key=lambda x: x["__id"]):
    oid = o["__id"]
    contrato = num(o.get("presupuesto"))
    modo_vol = (o.get("modoAvance") == "volumen")
    subs = doc(f"obras/{oid}/avance/subs").get("data") or []

    print()
    print("─" * 100)
    print(f"{oid}  {str(o.get('nombre'))[:50]}"
          f"   ·   {'volumen' if modo_vol else 'porcentaje'}   ·   {len(subs)} partidas")

    if not subs or not contrato > 0:
        print("   sin catálogo o sin contrato — fuera del comparativo")
        continue

    sigma = sum(importe_catalogo_partida(s) for s in subs)
    ejec = sum(importe_ejecutado_partida(s, modo_vol) for s in subs)
    ejec_top = sum(min(importe_ejecutado_partida(s, modo_vol),
                       importe_catalogo_partida(s)) for s in subs)

    antes = (ejec_top / sigma * 100) if sigma > 0 else 0.0
    despues = min(100.0, ejec / contrato * 100)
    por_ejecutar = max(contrato - ejec, 0.0)
    sobre_contrato = max(ejec - contrato, 0.0)

    excedidas = cortas = completas = 0
    monto_exc = monto_falt = 0.0
    for s in subs:
        dif = importe_ejecutado_partida(s, modo_vol) - importe_catalogo_partida(s)
        if dif > 1:
            excedidas += 1
            monto_exc += dif
        elif dif < -1:
            cortas += 1
            monto_falt += -dif
        else:
            completas += 1

    print(f"   AVANCE FÍSICO        antes {antes:6.2f}%   →   después {despues:6.2f}%"
          f"   (Δ {despues - antes:+.2f} pp)")
    print(f"   CONTRATADO           {mxn(contrato):>18}")
    print(f"   EJECUTADO            {mxn(ejec):>18}"
          f"   ({ejec / contrato * 100:.2f}% del contrato)")
    print(f"   POR EJECUTAR         {mxn(por_ejecutar):>18}")
    if sobre_contrato > 1:
        print(f"   SOBRE CONTRATO       {mxn(sobre_contrato):>18}"
              f"   ← no es ingreso mientras no haya convenio")
    if abs(sigma - contrato) > 1:
        print(f"   ojo: Σ catálogo {mxn(sigma)} ≠ contrato, Δ {mxn(sigma - contrato)}")

    print(f"   compensación de volúmenes: {excedidas} excedidas · {cortas} cortas"
          f" · {completas} completas   de {len(subs)}")
    print(f"      excedente {mxn(monto_exc)}   −   faltante {mxn(monto_falt)}"
          f"   =   neto {mxn(monto_exc - monto_falt)}")
    if abs(monto_exc - monto_falt) < 1:
        print("      → la obra se compensó sola: lo que se pasó iguala lo que quedó corto")

    filas.append((oid, antes, despues, contrato, ejec, por_ejecutar))

# ── Resumen ───────────────────────────────────────────────────────────
print()
print("=" * 100)
print(f"{'obra':<8}{'antes':>9}{'después':>10}{'Δ pp':>9}"
      f"{'contratado':>17}{'ejecutado':>17}{'por ejecutar':>17}")
print("─" * 100)
tc = te = tp = 0.0
for oid, antes, despues, contrato, ejec, por_ejecutar in filas:
    print(f"{oid:<8}{antes:>8.2f}%{despues:>9.2f}%{despues - antes:>+9.2f}"
          f"{mxn(contrato):>17}{mxn(ejec):>17}{mxn(por_ejecutar):>17}")
    tc += contrato
    te += ejec
    tp += por_ejecutar
print("─" * 100)
# El total del portafolio se pondera por contrato, no se promedian porcentajes:
# promediar avances de obras de tamaños distintos no significa nada.
print(f"{'TOTAL':<8}{'':>8} {te / tc * 100:>8.2f}%{'':>9}"
      f"{mxn(tc):>17}{mxn(te):>17}{mxn(tp):>17}")
print("=" * 100)
