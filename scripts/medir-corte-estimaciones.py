#!/usr/bin/env python3
"""
SOLO LECTURA. Qué costaría guardar el corte de estimaciones en cada cierre
semanal, y qué se pierde HOY por no guardarlo.

El cierre semanal congela el avance físico y el dinero ejecutado, pero no
congela estimado ni pagado. Consecuencia: la serie semanal del expediente no
puede decir "en la semana 32 llevábamos $4.1M estimados"; sólo puede decir lo
que hay HOY, que es otra pregunta.

Lo que mide:
  · cuántas estimaciones tiene cada obra y cuánto suman (estimado / pagado)
  · el peso del historial semanal hoy, y cuánto crecería con dos números más
  · cuántas semanas ya cerradas quedarían PARA SIEMPRE sin el dato, porque
    nunca se registró y NO se puede interpolar

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \
      python3 scripts/medir-corte-estimaciones.py
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
            return None
        raise


def val(v):
    """Desenvuelve un valor de la API REST de Firestore a Python plano."""
    if v is None:
        return None
    for k in ("stringValue", "booleanValue", "nullValue"):
        if k in v:
            return None if k == "nullValue" else v[k]
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


def _ne(s):
    import unicodedata
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


obras = (_get(f"{BASE}/obras?pageSize=300") or {}).get("documents", [])
print(f"obras en producción: {len(obras)}\n")

tot_sem = 0
tot_sin_dato = 0
tot_bytes = 0
tot_extra = 0

for o in obras:
    oid = o["name"].rsplit("/", 1)[-1]
    info = campos(_get(f"{BASE}/obras/{oid}/config/parametros"))
    nombre = info.get("nombre") or info.get("contrato") or oid

    est_doc = _get(f"{BASE}/obras/{oid}/config/estimaciones")
    ests = campos(est_doc).get("data") or []
    estimado = sum(float(e.get("monto") or 0) for e in ests)
    pagado = sum(float(e.get("monto") or 0) for e in ests
                 if _ne(e.get("estatus")) == "pagada")

    hist_doc = _get(f"{BASE}/obras/{oid}/avance/historial")
    semanas = campos(hist_doc).get("semanas") or []
    # Peso real del documento tal como viaja, no del objeto desenvuelto.
    peso = len(json.dumps(hist_doc or {}, separators=(",", ":")).encode())
    # Dos números más por semana. 24 B es el costo observado de un par
    # `"montoEstimado":1234567.89` en la codificación de Firestore.
    extra = len(semanas) * 2 * 24

    con_dato = sum(1 for s in semanas if s.get("montoEstimado") is not None)
    sin_dato = len(semanas) - con_dato

    tot_sem += len(semanas)
    tot_sin_dato += sin_dato
    tot_bytes += peso
    tot_extra += extra

    print(f"── {oid} · {nombre}")
    print(f"   estimaciones capturadas: {len(ests)}"
          f"   estimado ${estimado:,.2f}   pagado ${pagado:,.2f}")
    print(f"   semanas en el historial: {len(semanas)}"
          f"   ya sin corte de estimaciones: {sin_dato}")
    if semanas:
        pr, ul = semanas[0], semanas[-1]
        print(f"   de S{pr.get('semana')}/{pr.get('año')} "
              f"a S{ul.get('semana')}/{ul.get('año')}")
    print(f"   historial: {peso:,} B   +{extra:,} B  "
          f"({(extra / peso * 100) if peso else 0:.2f}%)")
    print()

print("── TOTAL")
print(f"   semanas cerradas en producción: {tot_sem}")
print(f"   semanas que NUNCA podrán decir su estimado: {tot_sin_dato}")
print(f"   peso de los historiales: {tot_bytes:,} B")
print(f"   costo del corte: +{tot_extra:,} B  "
      f"({(tot_extra / tot_bytes * 100) if tot_bytes else 0:.2f}%)")
print()
print("   El tope de un documento de Firestore es 1,048,576 B. El historial")
print("   más pesado queda muy por debajo incluso con el corte dentro.")
