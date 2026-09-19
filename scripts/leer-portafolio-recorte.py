#!/usr/bin/env python3
"""
Diagnóstico de SOLO LECTURA del recorte a 100% en TODO el portafolio.

Extiende scripts/leer-obra-0112.py a todas las obras (activas y archivadas)
y añade: impacto en margen, auditoría de snapshots semanales y análisis de
decimales para el reporte de 0125 (TAMSA).

SOLO LECTURA: únicamente GET contra firestore.googleapis.com. No hay
ninguna llamada de escritura en este archivo.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/leer-portafolio-recorte.py
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from decimal import Decimal

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


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def mxn(x):
    return f"${x:,.2f}"


def decimales(x):
    """Cuántos decimales significativos tiene el valor tal como está guardado."""
    if x is None:
        return 0
    d = Decimal(repr(float(x))).normalize()
    e = -d.as_tuple().exponent
    return max(e, 0)


# ── Datos compartidos ──────────────────────────────────────────────────
gp = doc("global/gp_construct")
gp_obras = list((gp.get("obras") or {}).values())


def gasto_gp(obra, info):
    gpid = info.get("gpId") or obra.get("gpId")
    cand = None
    if gpid:
        cand = next((o for o in gp_obras if o.get("id") == gpid), None)
    if cand is None and re.match(r"^\d{4}", obra.get("__id", "")):
        pref = obra["__id"][:4]
        cand = next((o for o in gp_obras if o.get("id") == pref), None)
    if cand is None:
        return 0.0, "sin match GP"
    if num(cand.get("grandTotal")) > 0:
        return num(cand["grandTotal"]), "grandTotal"
    años = sum(num(v) for v in (cand.get("años") or {}).values())
    act = num(cand.get("total2026")) or sum(num(v) for v in (cand.get("meses") or {}).values())
    return (años + act) or num(cand.get("totalGeneral")) or num(cand.get("total")), "derivado"


obras = coleccion("obras")
print("=" * 78)
print(f"PORTAFOLIO — {len(obras)} obras en Firestore")
print("=" * 78)

tot_perdida = tot_ejec = tot_ppto = 0.0
filas = []
detalle_0125 = None

for o in sorted(obras, key=lambda x: x["__id"]):
    oid = o["__id"]
    info = doc(f"obras/{oid}/config/info")
    subs = (doc(f"obras/{oid}/avance/subs") or {}).get("data") or []
    mats = (doc(f"obras/{oid}/avance/materiales") or {}).get("data") or []
    maq = (doc(f"obras/{oid}/avance/maquinaria") or {}).get("data") or []
    otros = (doc(f"obras/{oid}/config/otros_gastos") or {}).get("items") or []
    hist = (doc(f"obras/{oid}/avance/historial") or {}).get("semanas") or []
    subs_doc = doc(f"obras/{oid}/avance/subs") or {}

    modo = info.get("modoAvance") or o.get("modoAvance") or "porcentaje"
    estado = o.get("estado") or info.get("estado") or "activa"
    ppto = num(info.get("presupuesto")) or num(o.get("presupuesto"))

    am = sum((num(s.get("a")) / 100.0) * num(s.get("imp")) for s in subs)
    alm = sum(num(m.get("imp")) for m in mats)
    ejec = am + alm

    sobre = [s for s in subs
             if num(s.get("cant")) > 0 and num(s.get("cantEjec")) / num(s.get("cant")) > 1.0]
    perdida = sum(num(s.get("cantEjec")) * num(s.get("pu")) - num(s.get("imp")) for s in sobre)

    gGP, origen = gasto_gp(o, info)
    gasto = gGP + sum(num(m.get("imp")) for m in maq) + sum(num(x.get("importe")) for x in otros)
    mg_act = ((ejec - gasto) / ejec * 100) if ejec > 0 else 0.0
    ejec_sr = ejec + perdida
    mg_sr = ((ejec_sr - gasto) / ejec_sr * 100) if ejec_sr > 0 else 0.0

    filas.append(dict(id=oid, nombre=(o.get("nombre") or "")[:26], estado=estado, modo=modo,
                      ppto=ppto, ejec=ejec, perdida=perdida, n_sobre=len(sobre),
                      ejec_sr=ejec_sr, mg_act=mg_act, mg_sr=mg_sr, gasto=gasto,
                      origen=origen, n_subs=len(subs), n_hist=len(hist)))
    tot_perdida += perdida
    tot_ejec += ejec
    tot_ppto += ppto

    if oid == "0125":
        detalle_0125 = dict(o=o, info=info, subs=subs, hist=hist, modo=modo,
                            subs_doc=subs_doc, ejec=ejec, sobre=sobre, perdida=perdida,
                            mats=mats, ppto=ppto)

print(f"\n{'obra':<6} {'estado':<10} {'modo':<11} {'>100%':>5} {'ejecutado':>16} "
      f"{'perdido':>15} {'margen hoy':>11} {'margen s/rec':>12}")
print("-" * 78)
for f in filas:
    print(f"{f['id']:<6} {f['estado']:<10} {f['modo']:<11} {f['n_sobre']:>5} "
          f"{mxn(f['ejec']):>16} {mxn(f['perdida']):>15} "
          f"{f['mg_act']:>10.1f}% {f['mg_sr']:>11.1f}%")
    print(f"       {f['nombre']}  · {f['n_subs']} partidas · {f['n_hist']} snapshots · GP {f['origen']}")

print("-" * 78)
print(f"TOTAL PORTAFOLIO  ejecutado {mxn(tot_ejec)}  ·  perdido por recorte {mxn(tot_perdida)}")
print(f"                  ejecutado sin recorte {mxn(tot_ejec + tot_perdida)}")

# ── Auditoría de snapshots ─────────────────────────────────────────────
print("\n" + "=" * 78)
print("SNAPSHOTS avance/historial — ¿guardan 'a' recortado?")
print("=" * 78)
for o in sorted(obras, key=lambda x: x["__id"]):
    oid = o["__id"]
    hist = (doc(f"obras/{oid}/avance/historial") or {}).get("semanas") or []
    if not hist:
        print(f"{oid}: sin snapshots")
        continue
    hist = sorted(hist, key=lambda s: (num(s.get('año')), num(s.get('semana'))))
    tiene_cantejec = any("cantEjec" in (sub or {}) for s in hist for sub in (s.get("subs") or []))
    max_a = max((num(sub.get("a")) for s in hist for sub in (s.get("subs") or [])), default=0)
    pri, ult = hist[0], hist[-1]
    print(f"{oid}: {len(hist)} snapshots · de S{pri.get('semana')}/{pri.get('año')} "
          f"a S{ult.get('semana')}/{ult.get('año')} · max(a)={max_a:.2f} · "
          f"campo cantEjec en snapshot: {'SÍ' if tiene_cantejec else 'NO'}")
    print(f"      primero {pri.get('fechaCaptura','?')[:10]} · último {ult.get('fechaCaptura','?')[:10]} "
          f"({ult.get('tipo')}) · montoEjecutado último {mxn(num(ult.get('montoEjecutado')))}")

# ── Decimales: ¿el límite es de almacenamiento? ───────────────────────
print("\n" + "=" * 78)
print("DECIMALES GUARDADOS EN cantEjec (prueba empírica del límite)")
print("=" * 78)
peor = []
for o in sorted(obras, key=lambda x: x["__id"]):
    oid = o["__id"]
    subs = (doc(f"obras/{oid}/avance/subs") or {}).get("data") or []
    md = max((decimales(s.get("cantEjec")) for s in subs), default=0)
    mdc = max((decimales(s.get("cant")) for s in subs), default=0)
    peor.append((oid, md, mdc))
    print(f"{oid}: max decimales cantEjec={md} · max decimales cant(catálogo)={mdc}")

# ── Detalle 0125 ───────────────────────────────────────────────────────
print("\n" + "=" * 78)
print("DETALLE OBRA 0125 (TAMSA)")
print("=" * 78)
if not detalle_0125:
    print("No existe la obra 0125 en Firestore.")
else:
    d = detalle_0125
    print(f"nombre: {d['o'].get('nombre')}")
    print(f"modoAvance = {d['modo']!r}   presupuesto = {mxn(d['ppto'])}")
    print(f"ejecutado (KPI dashboard) = {mxn(d['ejec'])}")
    print(f"última escritura de avance/subs: {d['subs_doc'].get('fecha','?')}")
    h = sorted(d["hist"], key=lambda s: (num(s.get('año')), num(s.get('semana'))))
    if h:
        print(f"snapshots: {len(h)} · último S{h[-1].get('semana')}/{h[-1].get('año')} "
              f"({h[-1].get('tipo')}) capturado {h[-1].get('fechaCaptura','?')[:10]}")
        print("  últimos 6:")
        for s in h[-6:]:
            print(f"    S{s.get('semana')}/{s.get('año')} {s.get('tipo'):<11} "
                  f"{s.get('fechaCaptura','?')[:10]} · {mxn(num(s.get('montoEjecutado')))}")
    print(f"\npartidas con cantEjec/cant > 1: {len(d['sobre'])} · perdido {mxn(d['perdida'])}")
    for s in d["sobre"]:
        pct = num(s.get("cantEjec")) / num(s.get("cant")) * 100
        print(f"    {str(s.get('sec')):<18} {pct:7.1f}%  cat {mxn(num(s.get('imp')))} "
              f"· real {mxn(num(s.get('cantEjec'))*num(s.get('pu')))}")

    print(f"\nunidades y decimales por partida ({len(d['subs'])} partidas):")
    print(f"  {'sec':<18} {'unidad':<8} {'cant':>14} {'cantEjec':>14} {'pu':>14} {'dec':>4} {'$/0.005':>10}")
    tope_redondeo = 0.0
    for s in d["subs"]:
        de = decimales(s.get("cantEjec"))
        pu = num(s.get("pu"))
        cota = 0.005 * pu   # máximo importe que cabe en medio paso de 0.01
        tope_redondeo += cota
        print(f"  {str(s.get('sec'))[:18]:<18} {str(s.get('unidad') or '—'):<8} "
              f"{num(s.get('cant')):>14,.4f} {num(s.get('cantEjec')):>14,.4f} "
              f"{pu:>14,.2f} {de:>4} {cota:>10,.2f}")
    print(f"\n  COTA MÁXIMA de error por redondeo a 0.01 (todas las partidas): {mxn(tope_redondeo)}")
    print("  (cota teórica: 0.005 x pu por partida. El importe realmente perdido")
    print("   solo se puede calcular con los volúmenes reales del administrador.)")
print("\n" + "=" * 78)
