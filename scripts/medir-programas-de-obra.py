#!/usr/bin/env python3
"""
¿Qué forma tiene de verdad el programa de obra, y cruza con el catálogo?

#51 (el avance se mide contra una recta, no contra el programa) dice que
`programadoEnFecha` en src/App.jsx reparte el 100% en línea recta sobre el
plazo. Ninguna obra avanza en línea recta: arranca lenta, se acelera, cierra
lenta. La desviación que la app publica hoy no es una desviación, es la
distancia a una recta inventada.

Antes de escribir una sola línea de producto hay que saber contra qué se va a
programar. Este guion MIDE los programas reales que él copió, sin suponer nada:

  · granularidad (mensual / semanal) y número de meses,
  · si los montos mensuales suman el Total declarado de cada renglón,
  · si el ACUMULADO final del programa es el contrato que la app tiene cargado,
  · qué tanto cruzan los `Código` del programa con el `sec` del catálogo,
  · qué dice la fila `Barra=` que va debajo de cada partida, y
  · cuánto se separa la curva real de la recta que la app dibuja HOY.

La fila `Barra=` resultó ser el hallazgo que cambia el diseño. Es una lista de
`inicio-fin` por mes, en PORCENTAJE DEL DÍA DEL MES CALENDARIO. Queda
verificado contra dos anclas independientes del archivo del EMISOR:

    Barra=90.32-100,...   mes 1 = agosto 2026 (31 días) · 28/31 = 90.32%
                          → arranca el 29 de agosto = «Inicio obra» del archivo
    ...,0-85.71           mes 7 = febrero 2027 (28 días) · 24/28 = 85.71%
                          → termina el 24 de febrero = «Fin obra» del archivo

O sea: los meses son meses de calendario, no bloques de 30 días desde el
arranque, y la barra da resolución INTRA-MES. Con eso el programa mensual se
puede leer en cualquier fecha sin inventar una distribución: el dinero de cada
partida se acumula a lo largo de su barra, y la barra está en el archivo.

SOLO LECTURA contra producción: únicamente GET a firestore.googleapis.com.
Los programas viven fuera del árbol del repo, en CAMPO-datos-produccion.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/medir-programas-de-obra.py

Salida: 0 medido · 2 no arrancó.
"""

import datetime as dt
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
DIR = os.path.expanduser("~/Desarrollo/CAMPO-datos-produccion/programas")

# El mapeo archivo↔obra NO se supone: se derivó del texto del contrato y de las
# fechas, y el guion lo vuelve a verificar antes de comparar nada.
#   EMISOR   → 0131  contrato «…(EMISOR ENTRE CÁRCAMO…)»   inicio 2026-08-29 = serial 46263
#   COLECTOR → 0128  contrato «…(COLECTOR SANITARIO JOHN SPARK 2…)»
#   DE-5     → 0126  lugar «COMPLEJO PETROQUIMICO CANGREJERA», Σ = presupuesto al peso
MAPA = [
    ("AE11 PROGRAMA GENERAL MONTOS EMISOR.xlsx", "0131", "EMISOR"),
    ("AE11 PROGRAMA GENERAL MONTOS COLECTOR.xlsx", "0128", "COLECTOR"),
    ("DE-5 PROGRAMA GENERAL ECONOMICO-ESTRUCTURAS Y LAMINAS.xlsx", "0126", "CANGREJERA"),
]

# ───────────────────────────── producción (solo GET) ─────────────────────────

P = "campo-fosmon"
BASE = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
T = os.environ.get("TOKEN", "")


def _get(url):
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {T}", "X-Goog-User-Project": P}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {}
        sys.exit(f"NO ARRANCÓ: HTTP {e.code} {e.read().decode()[:200]}")


def _dec(v):
    if isinstance(v, dict) and len(v) == 1:
        k = next(iter(v))
        val = v[k]
        if k == "nullValue":
            return None
        if k == "integerValue":
            return int(val)
        if k == "doubleValue":
            return float(val)
        if k == "arrayValue":
            return [_dec(x) for x in val.get("values", [])]
        if k == "mapValue":
            return {a: _dec(b) for a, b in val.get("fields", {}).items()}
        if k in ("stringValue", "booleanValue", "timestampValue"):
            return val
    if isinstance(v, dict):
        return {a: _dec(b) for a, b in v.items()}
    return v


def doc(ruta):
    return _dec(_get(f"{BASE}/{ruta}").get("fields", {}))


# ───────────────────────────── el xlsx es un zip de XML ──────────────────────


def _col(ref):
    n = 0
    for ch in ref:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def hoja(ruta, n=1):
    """Devuelve {fila: {columna: texto}} de la hoja n. Sin dependencias."""
    z = zipfile.ZipFile(ruta)
    sst = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            sst.append("".join(t.text or "" for t in si.iter(NS + "t")))
    raiz = ET.fromstring(z.read(f"xl/worksheets/sheet{n}.xml"))
    filas = {}
    for row in raiz.iter(NS + "row"):
        celdas = {}
        for c in row.iter(NS + "c"):
            i = _col(re.match(r"([A-Z]+)", c.get("r")).group(1))
            t, v, inline = c.get("t"), c.find(NS + "v"), c.find(NS + "is")
            if inline is not None:
                val = "".join(x.text or "" for x in inline.iter(NS + "t"))
            elif v is None:
                continue
            elif t == "s":
                val = sst[int(v.text)]
            else:
                val = v.text
            if val is not None and str(val).strip() != "":
                celdas[i] = str(val).strip()
        if celdas:
            filas[int(row.get("r"))] = celdas
    return filas


# ───────────────────────────── utilería ──────────────────────────────────────

EPOCA = dt.date(1899, 12, 30)  # el serial de Excel cuenta desde aquí


def fecha_serial(txt):
    try:
        return EPOCA + dt.timedelta(days=int(float(txt)))
    except (TypeError, ValueError):
        return None


def num(txt):
    try:
        return float(str(txt).replace(",", "").replace("$", ""))
    except (TypeError, ValueError):
        return None


def plano(s):
    """Para cruzar texto: sin acentos, sin puntuación, una sola mayúscula."""
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^A-Z0-9]+", "", s.upper())


def dias_del_mes(a, m):
    return (dt.date(a + (m == 12), m % 12 + 1, 1) - dt.date(a, m, 1)).days


def pesos(x):
    return f"${x:,.2f}" if x is not None else "—"


# ───────────────────────────── lectura del programa ──────────────────────────


def encabezado(filas):
    """La fila que trae «Código» y «Descripción». No se adivina su número:
    el EMISOR la tiene en la 18 y el DE-5 en la 13."""
    for r in sorted(filas):
        vals = [plano(v) for v in filas[r].values()]
        if "CODIGO" in vals and "DESCRIPCION" in vals:
            cols = {}
            for c, v in filas[r].items():
                cols[plano(v)] = c
            meses = sorted(
                c for c, v in filas[r].items() if re.match(r"^Mes\s+\d+$", v)
            )
            return r, cols, meses
    return None, None, None


def barra(txt):
    """«Barra=90.32-100,0-70,0-0» → [(90.32,100),(0,70),(0,0)]"""
    tramos = []
    for t in txt.split("=", 1)[1].split(","):
        t = t.strip()
        if not t:
            continue
        m = re.match(r"^(-?[\d.]*)-(-?[\d.]*)$", t)
        if not m:
            tramos.append(None)
            continue
        a, b = num(m.group(1)), num(m.group(2))
        tramos.append((a if a is not None else 0.0, b if b is not None else 0.0))
    return tramos


def leer_programa(ruta):
    filas = hoja(ruta)
    hr, cols, meses = encabezado(filas)
    if hr is None:
        return None
    c_cod = cols.get("CODIGO")
    c_desc = cols.get("DESCRIPCION")
    c_uni = cols.get("UNIDAD")
    c_cant = cols.get("CANTIDAD")
    # «Total» aparece dos veces en el AE11 —antes y después de los meses— y una
    # sola vez en el DE-5, al final. El de control es siempre el de la derecha.
    totales = sorted(c for c, v in filas[hr].items() if plano(v) == "TOTAL")
    c_total = totales[-1] if totales else None
    total_previo = bool(meses) and any(c < meses[0] for c in totales)

    cab = {}
    for r in sorted(filas):
        if r >= hr:
            break
        for c, v in filas[r].items():
            k = plano(v).rstrip(":")
            if k in ("INICIOOBRA", "FINOBRA", "DURACION", "FECHA", "OBRA", "LUGAR",
                     "CLIENTE", "CONCURSONO"):
                sig = filas[r].get(c + 1)
                cab.setdefault(k, sig if sig is not None else filas[r].get(c + 2))

    partidas, resumen, sueltas = [], {}, 0
    ultima = None
    for r in sorted(filas):
        if r <= hr:
            continue
        fila = filas[r]
        prim = fila.get(0, "")
        pl = plano(prim).rstrip(":")
        if pl in ("TOTALDELPRESUPUESTOMOSTRADO", "ACUMULADO", "PORCENTAJEPERIODO",
                  "PORCENTAJEACUMULADO"):
            resumen[pl] = [num(fila.get(c)) for c in meses]
            continue
        bar = next((v for v in fila.values() if str(v).startswith("Barra=")), None)
        if bar:
            if ultima is None:
                sueltas += 1
            else:
                ultima["barra"] = barra(bar)
            continue
        montos = [num(fila.get(c)) or 0.0 for c in meses]
        tiene_cod = c_cod is not None and fila.get(c_cod)
        unidad = fila.get(c_uni) if c_uni is not None else None
        cant = num(fila.get(c_cant)) if c_cant is not None else None
        if tiene_cod and unidad and cant is not None:
            ultima = {
                "fila": r,
                "codigo": fila[c_cod],
                "desc": fila.get(c_desc, ""),
                "unidad": unidad,
                "cant": cant,
                "total": num(fila.get(c_total)) if c_total is not None else None,
                "montos": montos,
                "barra": None,
                "montos_son_dinero": True,
            }
            partidas.append(ultima)
        elif ultima is not None and not tiene_cod and any(montos):
            # El DE-5 pone DOS renglones por partida: arriba el VOLUMEN y abajo
            # el IMPORTE. Al leer el de arriba se guardaron cantidades donde van
            # pesos, así que el de abajo los corrige —montos y Total—. Sin esto
            # el informe acusaba 51 renglones descuadrados que no lo estaban:
            # comparaba los pesos del mes contra el total de toneladas.
            if ultima.get("volumen_leido"):
                continue
            ultima["volumen"] = ultima["montos"]
            ultima["montos"] = montos
            if c_total is not None and fila.get(c_total) is not None:
                ultima["total"] = num(fila.get(c_total))
            ultima["volumen_leido"] = True

    return {
        "cab": cab,
        "meses": len(meses),
        "fila_encabezado": hr,
        "tiene_columna_total": c_total is not None,
        "total_previo": total_previo,
        "dos_renglones": any(p.get("volumen_leido") for p in partidas),
        "partidas": partidas,
        "resumen": resumen,
        "barras_sueltas": sueltas,
    }


# ───────────────── el programa leído en una fecha cualquiera ─────────────────


def calendario(inicio, n_meses):
    """Los n meses de calendario a partir del mes del arranque."""
    out = []
    a, m = inicio.year, inicio.month
    for _ in range(n_meses):
        out.append((a, m))
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return out


def dia_de_barra(a, m, pct):
    """La barra viene en % del día del mes: 90.32% de agosto = 28/31 → día 29."""
    d = dias_del_mes(a, m)
    return dt.date(a, m, 1) + dt.timedelta(days=round(pct / 100.0 * d))


def acumulado_a(prog, inicio, corte):
    """Pesos programados hasta `corte`. Dentro del mes se reparte a lo largo de
    la barra de la partida; si no hay barra, a lo largo del mes entero. No se
    inventa nada: los dos extremos son datos del archivo."""
    meses = calendario(inicio, prog["meses"])
    total = 0.0
    for p in prog["partidas"]:
        for i, (a, m) in enumerate(meses):
            monto = p["montos"][i] if i < len(p["montos"]) else 0.0
            if not monto:
                continue
            tr = (p["barra"] or [])[i] if p["barra"] and i < len(p["barra"]) else None
            if tr and tr != (0.0, 0.0):
                d0, d1 = dia_de_barra(a, m, tr[0]), dia_de_barra(a, m, tr[1])
            else:
                d0 = dt.date(a, m, 1)
                d1 = dt.date(a, m, 1) + dt.timedelta(days=dias_del_mes(a, m))
            if corte >= d1:
                total += monto
            elif corte > d0:
                span = (d1 - d0).days or 1
                total += monto * ((corte - d0).days / span)
    return total


# ───────────────────────────── el informe ────────────────────────────────────


def main():
    if not T:
        sys.exit("NO ARRANCÓ: falta TOKEN (gcloud auth application-default ...)")
    if not os.path.isdir(DIR):
        sys.exit(f"NO ARRANCÓ: no existe {DIR}")

    hoy = dt.date.today()
    for archivo, oid, apodo in MAPA:
        ruta = os.path.join(DIR, archivo)
        print("=" * 100)
        if not os.path.isfile(ruta):
            print(f"{apodo}: FALTA el archivo {archivo}")
            continue
        prog = leer_programa(ruta)
        if prog is None:
            print(f"{apodo}: no se halló el encabezado Código/Descripción")
            continue

        obra = doc(f"obras/{oid}")
        subs = doc(f"obras/{oid}/avance/subs").get("data") or []
        sigma_cat = sum(float(s.get("imp") or 0) for s in subs)
        ppto = float(obra.get("presupuesto") or 0)

        print(f"{apodo}  →  obra {oid}  «{obra.get('nombre')}»")
        print(f"  archivo: {archivo}")
        print(f"  encabezado en la fila {prog['fila_encabezado']} · "
              f"{prog['meses']} meses · Total antes de los meses: "
              f"{'sí' if prog['total_previo'] else 'no'} · "
              f"{'dos renglones por partida (volumen + importe)' if prog['dos_renglones'] else 'un renglón por partida'}")

        # ── el mapeo se verifica, no se cree ──
        contrato = plano(obra.get("contrato"))
        obra_arch = plano(prog["cab"].get("OBRA"))
        clave = obra_arch[:28]
        cruce_texto = bool(clave) and clave in contrato
        print(f"  verificación del mapeo: texto de obra {'CRUZA' if cruce_texto else 'no cruza'}"
              f" con el contrato cargado")

        # ── fechas ──
        ini_a = fecha_serial(prog["cab"].get("INICIOOBRA"))
        fin_a = fecha_serial(prog["cab"].get("FINOBRA"))
        ini_p = obra.get("inicio")
        fin_p = obra.get("finAmpliado") or obra.get("fin")
        print(f"  plazo en el archivo:    {ini_a or '— no lo trae'} → {fin_a or '— no lo trae'}"
              f"   ({prog['cab'].get('DURACION', '—')})")
        print(f"  plazo en la app:        {ini_p} → {fin_p}")
        if ini_a and str(ini_a) != str(ini_p):
            print(f"    ROJO  el arranque NO coincide: archivo {ini_a} vs app {ini_p}")
        if fin_a and str(fin_a) != str(fin_p):
            print(f"    ROJO  el fin NO coincide: archivo {fin_a} vs app {fin_p}")

        # ── ¿los montos mensuales suman el Total del renglón? ──
        n = len(prog["partidas"])
        suma_meses = sum(sum(p["montos"]) for p in prog["partidas"])
        acum = prog["resumen"].get("ACUMULADO") or []
        acum_final = next((v for v in reversed(acum) if v is not None), None)
        desc = [p for p in prog["partidas"]
                if p["total"] is not None and abs(sum(p["montos"]) - p["total"]) > 0.5]
        print(f"  partidas con monto: {n} · con barra: "
              f"{sum(1 for p in prog['partidas'] if p['barra'])}"
              f" · barras sin partida: {prog['barras_sueltas']}")
        print(f"  Σ meses de todas las partidas: {pesos(suma_meses)}")
        if prog["tiene_columna_total"]:
            print(f"    renglones donde Σmeses ≠ Total declarado: {len(desc)}"
                  + ("" if not desc else f"  (p.ej. fila {desc[0]['fila']})"))
        print(f"  ACUMULADO final del programa:  {pesos(acum_final)}")
        print(f"  Σ importes del catálogo cargado: {pesos(sigma_cat)}  ({len(subs)} partidas)")
        print(f"  presupuesto que la app usa:      {pesos(ppto)}")

        if acum_final is not None:
            d = acum_final - sigma_cat
            print(f"    programa vs catálogo: Δ {pesos(d)}"
                  + ("  ← cuadra al peso" if abs(d) < 1 else "  ← NO cuadra"))
            d2 = acum_final - ppto
            if abs(d2) >= 1:
                print(f"    ROJO  programa vs presupuesto de la app: Δ {pesos(d2)}"
                      f" ({d2 / ppto * 100:+.1f}%)")

        # ── ¿cruzan las claves? Se prueban los cuatro emparejamientos ──
        pc = {plano(p["codigo"]) for p in prog["partidas"] if p["codigo"]}
        pd = {plano(p["desc"]) for p in prog["partidas"] if p["desc"]}
        cs = {plano(s.get("sec")) for s in subs if s.get("sec")}
        cb = {plano(s.get("sub")) for s in subs if s.get("sub")}
        print("  cruce de llaves (del programa contra el catálogo):")
        mejor = None
        for et, izq, der in (("Código ↔ sec", pc, cs), ("Código ↔ sub", pc, cb),
                             ("Descripción ↔ sec", pd, cs), ("Descripción ↔ sub", pd, cb)):
            if not izq or not der:
                continue
            hits = len(izq & der)
            tasa = hits / len(izq) * 100
            print(f"    {et:<22} {hits:>4}/{len(izq):<4} = {tasa:5.1f}%")
            if mejor is None or tasa > mejor[1]:
                mejor = (et, tasa, hits, len(izq))
        if mejor:
            veredicto = ("se puede comparar partida por partida" if mejor[1] >= 95
                         else "NO alcanza para partida por partida: sólo curva agregada")
            print(f"    mejor: {mejor[0]} al {mejor[1]:.1f}%  →  {veredicto}")

        # ── la recta contra la curva ──
        inicio = ini_a or (dt.date.fromisoformat(ini_p) if ini_p else None)
        fin = fin_a or (dt.date.fromisoformat(fin_p) if fin_p else None)
        if inicio and fin and acum_final:
            plazo = (fin - inicio).days
            print(f"  LA RECTA CONTRA LA CURVA (plazo {plazo} días):")
            print(f"    {'fecha':<12}{'recta de la app':>17}{'programa real':>16}{'Δ puntos':>11}")
            hitos = []
            for frac in (0.25, 0.5, 0.75):
                hitos.append(inicio + dt.timedelta(days=round(plazo * frac)))
            if inicio < hoy < fin:
                hitos.append(hoy)
            peor = 0.0
            for f in sorted(set(hitos)):
                recta = min(max((f - inicio).days / plazo * 100, 0), 100)
                real = acumulado_a(prog, inicio, f) / acum_final * 100
                peor = max(peor, abs(real - recta))
                marca = "  ← HOY" if f == hoy else ""
                print(f"    {str(f):<12}{recta:>16.1f}%{real:>15.1f}%{real - recta:>+10.1f}{marca}")
            print(f"    separación máxima medida: {peor:.1f} puntos de avance")

    print("=" * 100)
    return 0


if __name__ == "__main__":
    sys.exit(main())
