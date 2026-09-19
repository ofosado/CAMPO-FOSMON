#!/usr/bin/env python3
"""
Diagnóstico: ¿qué pasaría si 0114 (Oaxaca) y 0126 (Cangrejera) cambian de
modo porcentaje a modo volumen?

SOLO LECTURA: únicamente emite GET contra firestore.googleapis.com.

Responde con datos reales:
  · ¿existe `cantEjec` capturado, o está vacío por haber capturado en %?
  · ¿están `cant` y `pu` poblados? (sin ellos no se puede derivar nada)
  · ejecutado HOY (modo porcentaje) vs ejecutado SI cambian de modo,
    bajo las dos fórmulas: main y fix/ejecutado-sin-recorte
  · ejecutado si además se migra cantEjec = (a/100) x cant

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \
      python3 scripts/diagnostico-cambio-modo.py
"""

import json
import os
import sys
import urllib.request
import urllib.error

PROYECTO = "campo-fosmon"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROYECTO}/databases/(default)/documents"
OBRAS = ["0114", "0126"]

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
    try:
        with urllib.request.urlopen(_req(f"{BASE}/{path}")) as r:
            return decodificar(json.load(r).get("fields", {}))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        sys.exit(f"HTTP {e.code} leyendo {path}: {e.read().decode()[:400]}")


def listar(coleccion):
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


# ── Fórmulas ───────────────────────────────────────────────────────────
def ejec_main(s, modo_vol):
    """main: en modo volumen el dinero sale SOLO de cantEjec x pu."""
    if modo_vol:
        return num(s.get("cantEjec")) * num(s.get("pu"))
    return num(s.get("a")) / 100.0 * num(s.get("imp"))


def ejec_fix(s, modo_vol):
    """fix: en modo volumen usa cantEjec x pu, pero cae a (a/100)xImp
       si cantEjec o pu son cero."""
    if modo_vol:
        ce, pu = num(s.get("cantEjec")), num(s.get("pu"))
        if ce > 0 and pu > 0:
            return ce * pu
    return num(s.get("a")) / 100.0 * num(s.get("imp"))


def pct_capturador(s, modo_vol):
    """Lo que la PANTALLA de captura muestra como % de la partida."""
    if modo_vol:
        cant = num(s.get("cant"))
        return (num(s.get("cantEjec")) / cant * 100) if cant > 0 else 0.0
    return num(s.get("a"))


obras = dict(listar("obras"))

for oid in OBRAS:
    obra = obras.get(oid, {})
    info = get(f"obras/{oid}/config/info")
    subs = get(f"obras/{oid}/avance/subs").get("data") or []
    nombre = obra.get("nombre") or info.get("nombre") or "(sin nombre)"
    modo_info = info.get("modoAvance")
    modo_obra = obra.get("modoAvance")
    ppto = num(obra.get("presupuesto")) or num(info.get("presupuesto"))

    print("=" * 96)
    print(f"OBRA {oid}  ·  {nombre}")
    print("=" * 96)
    print(f"  modoAvance en config/info : {modo_info!r}")
    print(f"  modoAvance en obras/{oid}   : {modo_obra!r}")
    print(f"  presupuesto               : {mxn(ppto)}")
    print(f"  partidas                  : {len(subs)}")
    if not subs:
        print("  (sin catálogo cargado)\n")
        continue

    con_a = sum(1 for s in subs if num(s.get("a")) > 0)
    con_ce = sum(1 for s in subs if num(s.get("cantEjec")) > 0)
    tiene_campo_ce = sum(1 for s in subs if "cantEjec" in s)
    con_cant = sum(1 for s in subs if num(s.get("cant")) > 0)
    con_pu = sum(1 for s in subs if num(s.get("pu")) > 0)
    con_unidad = sum(1 for s in subs if (s.get("unidad") or "").strip())
    # ¿cant x pu reconstruye imp? Si no, derivar cantEjec falsea el dinero.
    coherentes = sum(
        1 for s in subs
        if num(s.get("cant")) > 0 and num(s.get("pu")) > 0 and num(s.get("imp")) > 0
        and abs(num(s.get("cant")) * num(s.get("pu")) - num(s.get("imp"))) <= max(1.0, num(s.get("imp")) * 0.005)
    )

    print(f"\n  CAMPOS POBLADOS")
    print(f"    a > 0 (avance en %)      : {con_a:>4} / {len(subs)}")
    print(f"    campo cantEjec presente  : {tiene_campo_ce:>4} / {len(subs)}")
    print(f"    cantEjec > 0             : {con_ce:>4} / {len(subs)}")
    print(f"    cant  > 0 (vol catálogo) : {con_cant:>4} / {len(subs)}")
    print(f"    pu    > 0                : {con_pu:>4} / {len(subs)}")
    print(f"    unidad no vacía          : {con_unidad:>4} / {len(subs)}")
    print(f"    cant x pu == imp         : {coherentes:>4} / {len(subs)}   (tolerancia 0.5%)")

    modo_vol_hoy = (modo_info or modo_obra or "porcentaje") == "volumen"

    hoy_main = sum(ejec_main(s, modo_vol_hoy) for s in subs)
    hoy_fix = sum(ejec_fix(s, modo_vol_hoy) for s in subs)
    tras_main = sum(ejec_main(s, True) for s in subs)
    tras_fix = sum(ejec_fix(s, True) for s in subs)
    # Migrando cantEjec = (a/100) x cant
    migr = [dict(s, cantEjec=(num(s.get("a")) / 100.0 * num(s.get("cant")))) for s in subs]
    tras_migr_main = sum(ejec_main(s, True) for s in migr)
    tras_migr_fix = sum(ejec_fix(s, True) for s in migr)

    pct_hoy = sum(pct_capturador(s, modo_vol_hoy) * num(s.get("imp")) for s in subs)
    pct_tras = sum(pct_capturador(s, True) * num(s.get("imp")) for s in subs)
    tot_imp = sum(num(s.get("imp")) for s in subs) or 1

    print(f"\n  EJECUTADO (suma de partidas)")
    print(f"    {'':<34}{'main (prod)':>18}{'esta rama':>18}")
    print(f"    {'hoy, en modo porcentaje':<34}{mxn(hoy_main):>18}{mxn(hoy_fix):>18}")
    print(f"    {'si cambian a volumen, tal cual':<34}{mxn(tras_main):>18}{mxn(tras_fix):>18}")
    print(f"    {'si migran cantEjec=(a/100)xcant':<34}{mxn(tras_migr_main):>18}{mxn(tras_migr_fix):>18}")

    print(f"\n  AVANCE QUE MUESTRA EL CAPTURADOR (ponderado por importe)")
    print(f"    hoy                           : {pct_hoy/tot_imp:>8.2f}%")
    print(f"    si cambian a volumen, tal cual: {pct_tras/tot_imp:>8.2f}%")

    # Partidas que perderían la captura visible
    perdidas = [s for s in subs if num(s.get("a")) > 0 and num(s.get("cantEjec")) <= 0]
    if perdidas:
        imp_perdido = sum(num(s.get("a")) / 100.0 * num(s.get("imp")) for s in perdidas)
        print(f"\n  ⚠ {len(perdidas)} partidas tienen avance en `a` pero cantEjec vacío.")
        print(f"    Representan {mxn(imp_perdido)} de avance capturado.")
        sin_base = [s for s in perdidas if not (num(s.get("cant")) > 0 and num(s.get("pu")) > 0)]
        print(f"    De ésas, {len(sin_base)} NO tienen cant y pu, así que no se pueden derivar.")
        print(f"\n    Muestra (primeras 5):")
        print(f"      {'sec':<10}{'a%':>8}{'cant':>14}{'pu':>14}{'imp':>16}")
        for s in perdidas[:5]:
            print(f"      {str(s.get('sec'))[:9]:<10}{num(s.get('a')):>8.2f}"
                  f"{num(s.get('cant')):>14,.2f}{num(s.get('pu')):>14,.2f}{num(s.get('imp')):>16,.2f}")
    print()
