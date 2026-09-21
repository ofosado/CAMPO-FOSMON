#!/usr/bin/env python3
"""
¿El catálogo de conceptos suma exactamente el contrato? Obra por obra.

La pregunta importa porque `avanceFisicoPonderado` divide entre un denominador,
y hasta fix/compensacion-volumenes el código tenía DOS: de los 19 puntos que
pedían el avance, 7 pasaban el contrato y 12 pasaban Σ catálogo. Nadie lo había
notado porque con el tope por partida daba exactamente igual cuál de los dos se
usara. Sin el tope ya no da igual, así que primero hay que saber si en
producción los dos números coinciden.

Medido el 2026-09-21: coinciden al peso (Δ $0) en las 5 obras. Es una propiedad
del dato de hoy, no una garantía del modelo — por eso el código ahora pasa el
denominador explícito en cada llamada en vez de confiar en esto.

Columnas HOY / NUEVO: el avance con la fórmula vieja (tope por partida, entre
Σ catálogo) y con la nueva (ejecutado/contrato, tope al total).

SOLO LECTURA: únicamente GET contra firestore.googleapis.com.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/catalogo-vs-contrato.py
"""

import json,os,sys,urllib.request,urllib.error
P="campo-fosmon";BASE=f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents"
T=os.environ["TOKEN"]
def _g(u):
    r=urllib.request.Request(u,headers={"Authorization":f"Bearer {T}","X-Goog-User-Project":P})
    try:
        with urllib.request.urlopen(r) as x: return json.load(x)
    except urllib.error.HTTPError as e:
        if e.code==404: return {}
        sys.exit(f"HTTP {e.code} {e.read().decode()[:200]}")
def dec(v):
    if isinstance(v,dict) and len(v)==1:
        k=next(iter(v))
        if k in("nullValue","booleanValue","integerValue","doubleValue","stringValue","timestampValue","arrayValue","mapValue"):
            val=v[k]
            if k=="nullValue": return None
            if k=="integerValue": return int(val)
            if k=="doubleValue": return float(val)
            if k=="arrayValue": return [dec(x) for x in val.get("values",[])]
            if k=="mapValue": return {a:dec(b) for a,b in val.get("fields",{}).items()}
            return val
    if isinstance(v,dict): return {a:dec(b) for a,b in v.items()}
    return v
def doc(p): return dec(_g(f"{BASE}/{p}").get("fields",{}))
def col(p):
    out,tok=[],None
    while True:
        r=_g(f"{BASE}/{p}?pageSize=300"+(f"&pageToken={tok}" if tok else""))
        for d in r.get("documents",[]):
            i=dec(d.get("fields",{})); i["__id"]=d["name"].rsplit("/",1)[-1]; out.append(i)
        tok=r.get("nextPageToken")
        if not tok: return out
def n(x):
    try: return float(x)
    except: return 0.0
def iep(s,mv):
    if mv:
        ce,pu=n(s.get("cantEjec")),n(s.get("pu"))
        if ce>0 and pu>0: return ce*pu
    a=n(s.get("a") if s.get("a") is not None else s.get("avance"))
    return (a/100.0)*n(s.get("imp") if s.get("imp") is not None else s.get("importe"))
def icp(s): return n(s.get("imp") if s.get("imp") is not None else s.get("importe"))
def m(x): return f"${x:,.0f}"

print("="*104)
print(f"{'obra':<7}{'contrato':>17}{'Σ catálogo':>17}{'Δ':>15}{'Δ%':>8}  {'modo':<11}{'HOY':>8}{'NUEVO':>8}{'Δpp':>8}")
print("="*104)
for o in sorted(col("obras"),key=lambda x:x["__id"]):
    oid=o["__id"]; ppto=n(o.get("presupuesto")); mv=(o.get("modoAvance")=="volumen")
    subs=doc(f"obras/{oid}/avance/subs").get("data") or []
    sigma=sum(icp(s) for s in subs)
    ejec=sum(iep(s,mv) for s in subs)
    ejec_top=sum(min(iep(s,mv),icp(s)) for s in subs)
    hoy=(ejec_top/sigma*100) if sigma>0 else 0.0     # avanceFisicoPonderado(subs, Σimp)
    nuevo=min(100.0,(ejec/ppto*100)) if ppto>0 else 0.0
    d=sigma-ppto; dp=(d/ppto*100) if ppto>0 else 0
    print(f"{oid:<7}{m(ppto):>17}{(m(sigma) if subs else '— sin catálogo'):>17}{m(d):>15}{dp:>7.3f}%  "
          f"{('volumen' if mv else 'porcentaje'):<11}{hoy:>7.2f}%{nuevo:>7.2f}%{nuevo-hoy:>7.2f}")
    if subs:
        # avance "hoy" tal como lo llama el dashboard: ¿con Σimp o con presupuesto?
        hoy_ppto=(ejec_top/ppto*100) if ppto>0 else 0.0
        if abs(hoy_ppto-hoy)>0.005:
            print(f"{'':7}  ojo: dividir entre contrato en vez de Σcatálogo ya cambia hoy: {hoy_ppto:.2f}% vs {hoy:.2f}%")
        print(f"{'':7}  ejecutado sin topar {m(ejec)} · topado {m(ejec_top)} · excedente {m(ejec-ejec_top)}")
