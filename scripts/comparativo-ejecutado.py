#!/usr/bin/env python3
"""
Comparativo ANTES/DESPUÉS de fix/ejecutado-sin-recorte, contra datos reales.

SOLO LECTURA: únicamente emite GET contra firestore.googleapis.com. No hay
ninguna llamada de escritura (PATCH/POST/DELETE/commit) en este archivo.

Reproduce las dos fórmulas sobre las mismas obras de producción:

  ANTES  (main)                      DESPUÉS (fix/ejecutado-sin-recorte)
  ───────────────────────────────    ──────────────────────────────────────
  a      = min(100, cantEjec/cant)   a      = cantEjec/cant · sin topar
  am     = Σ (a/100)×imp             am     = Σ cantEjec×pu · sin topar
  af     = Σ (a/100)×imp/ppto×100    af     = Σ min(ejec,imp)/ppto×100
  margen = (me-gasto)/me             igual, pero sobre el `me` real

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/comparativo-ejecutado.py
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
    sys.exit("Falta TOKEN. Usa: TOKEN=$(gcloud auth application-default print-access-token) python3 ...")


def _req(url):
    return urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {TOKEN}", "X-Goog-User-Project": PROYECTO},
        method="GET",
    )


def get(path):
    """GET de un documento. Devuelve {} si no existe."""
    try:
        with urllib.request.urlopen(_req(f"{BASE}/{path}")) as r:
            return decodificar(json.load(r).get("fields", {}))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        sys.exit(f"HTTP {e.code} leyendo {path}: {e.read().decode()[:400]}")


def listar(coleccion):
    """GET de una colección completa. Devuelve [(id, campos)]."""
    salida, page = [], None
    while True:
        url = f"{BASE}/{coleccion}?pageSize=300"
        if page:
            url += f"&pageToken={page}"
        try:
            with urllib.request.urlopen(_req(url)) as r:
                data = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return salida
            sys.exit(f"HTTP {e.code} listando {coleccion}: {e.read().decode()[:400]}")
        for d in data.get("documents", []):
            salida.append((d["name"].rsplit("/", 1)[-1], decodificar(d.get("fields", {}))))
        page = data.get("nextPageToken")
        if not page:
            return salida


def decodificar(v):
    """Convierte el JSON tipado de Firestore REST a tipos de Python."""
    if isinstance(v, dict) and len(v) == 1 and next(iter(v)).endswith(
        ("Value", "value")
    ) and next(iter(v)) != "fields":
        (k, val), = v.items()
        if k == "nullValue":
            return None
        if k in ("booleanValue", "stringValue", "timestampValue"):
            return val
        if k == "integerValue":
            return int(val)
        if k == "doubleValue":
            return float(val)
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


# ── Las dos fórmulas, lado a lado ──────────────────────────────────────
def antes(subs, presupuesto, modo_vol):
    """main: `a` viene ya recortado a 100 por el capturador."""
    am = af = 0.0
    for s in subs:
        imp = num(s.get("imp"))
        if modo_vol:
            cant = num(s.get("cant"))
            a = min(100.0, num(s.get("cantEjec")) / cant * 100) if cant > 0 else num(s.get("a"))
        else:
            a = num(s.get("a"))
        am += (a / 100.0) * imp
        if presupuesto > 0:
            af += (a / 100.0) * imp / presupuesto * 100
    return am, af


def despues(subs, presupuesto, modo_vol):
    """fix: dinero sin topar; avance físico topado a 100% por partida."""
    cat = exc = af = 0.0
    for s in subs:
        imp = num(s.get("imp"))
        cantEjec, pu = num(s.get("cantEjec")), num(s.get("pu"))
        if modo_vol and cantEjec > 0 and pu > 0:
            ejec = cantEjec * pu
        else:
            ejec = (num(s.get("a")) / 100.0) * imp
        if ejec > imp:
            cat += imp
            exc += ejec - imp
        else:
            cat += ejec
        if presupuesto > 0:
            af += min(ejec, imp) / presupuesto * 100
    return cat + exc, exc, af


# ── Recorrido ──────────────────────────────────────────────────────────
obras = listar("obras")
gp = get("global/gp_construct")
# `gp.obras` es un mapa {nombreLargo: {...}}; la app resuelve por `gpId`, luego
# por los 4 dígitos del id de CAMPO (resolverGastoGP, src/App.jsx:3243).
gp_lista = list((gp.get("obras") or {}).values())
gp_por_id = {str(o.get("id")): o for o in gp_lista if o.get("id")}


def gasto_gp_de(oid, obra):
    o = gp_por_id.get(str(obra.get("gpId"))) or gp_por_id.get(oid[:4])
    if not o:
        return num(obra.get("gastoGP")), False
    return (num(o.get("grandTotal")) or num(o.get("total2026"))), True


filas = []
for oid, obra in sorted(obras):
    subs = get(f"obras/{oid}/avance/subs").get("data") or []
    if not subs:
        continue
    info = get(f"obras/{oid}/config/info")
    materiales = get(f"obras/{oid}/avance/materiales").get("data") or []
    maquinaria = get(f"obras/{oid}/avance/maquinaria").get("data") or []
    otros = get(f"obras/{oid}/config/otros_gastos").get("items") or []

    ppto = num(obra.get("presupuesto")) or num(info.get("presupuesto"))
    modo = (info.get("modoAvance") or obra.get("modoAvance") or "porcentaje") == "volumen"
    alm = sum(num(m.get("imp")) for m in materiales)

    gasto_gp, hay_gp = gasto_gp_de(oid, obra)
    gasto = (gasto_gp
             + sum(num(m.get("imp")) for m in maquinaria)
             + sum(num(x.get("importe")) for x in otros))

    am_a, af_a = antes(subs, ppto, modo)
    am_d, exc_d, af_d = despues(subs, ppto, modo)
    me_a, me_d = am_a + alm, am_d + alm
    mg_a = ((me_a - gasto) / me_a * 100) if me_a > 0 else 0.0
    mg_d = ((me_d - gasto) / me_d * 100) if me_d > 0 else 0.0

    filas.append(dict(
        id=oid, nombre=(obra.get("nombre") or info.get("nombre") or "")[:34],
        modo="volumen" if modo else "porcentaje", n=len(subs), ppto=ppto, gasto=gasto,
        me_a=me_a, me_d=me_d, mg_a=mg_a, mg_d=mg_d, af_a=af_a, af_d=af_d, exc=exc_d,
        hay_gp=hay_gp))

print("=" * 108)
print("COMPARATIVO  main  →  fix/ejecutado-sin-recorte   ·   datos reales de producción (solo lectura)")
print("=" * 108)

for f in filas:
    print(f"\n── {f['id']}  {f['nombre']}")
    print(f"   modo={f['modo']}  ·  {f['n']} partidas  ·  contrato {mxn(f['ppto'])}  ·  "
          f"gasto {mxn(f['gasto'])}{'' if f['hay_gp'] else '  (sin match en GP: fallback legacy)'}")
    print(f"   {'':<16}{'ANTES':>18}{'DESPUÉS':>18}{'Δ':>18}")
    print(f"   {'Ejecutado':<16}{mxn(f['me_a']):>18}{mxn(f['me_d']):>18}{mxn(f['me_d']-f['me_a']):>18}")
    print(f"   {'Margen':<16}{f['mg_a']:>17.2f}%{f['mg_d']:>17.2f}%{f['mg_d']-f['mg_a']:>17.2f}pp")
    print(f"   {'Avance físico':<16}{f['af_a']:>17.2f}%{f['af_d']:>17.2f}%{f['af_d']-f['af_a']:>17.2f}pp")
    if f['exc'] > 0:
        print(f"   · de lo ejecutado, {mxn(f['exc'])} está SOBRE catálogo (antes se descartaba en silencio)")

print("\n" + "=" * 108)
print("TOTALES DE PORTAFOLIO")
tot = lambda k: sum(f[k] for f in filas)
print(f"   {'Ejecutado':<16}{mxn(tot('me_a')):>18}{mxn(tot('me_d')):>18}{mxn(tot('me_d')-tot('me_a')):>18}")
print(f"   Sobre catálogo recuperado: {mxn(tot('exc'))}   ·   obras leídas: {len(filas)}")
print("=" * 108)
