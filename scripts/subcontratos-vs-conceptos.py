#!/usr/bin/env python3
"""
¿El monto contratado con cada subcontratista cuadra con su catálogo de
conceptos?

Un subcontrato tiene dos cifras que pueden no coincidir: el `monto` pactado con
el proveedor y la suma de los conceptos que se le cargaron. El avance de un
subcontrato se divide entre el contrato —ésa es la definición, lo que se le
pactó—, y el catálogo sólo sirve de respaldo cuando no hay monto capturado
(`contratoDeSub` en src/App.jsx). Si los dos números difieren, el porcentaje que
ve el usuario depende de cuál se use, así que conviene saber dónde difieren.

Marca con "NO CUADRA" cualquier subcontrato con monto capturado cuya Σ de
conceptos se aleje más de $1.

Medido el 2026-09-21: no hay ningún subcontrato capturado en producción, así
que la rama de respaldo de `contratoDeSub` no se ejerce todavía con datos
reales. Vale la pena volver a correrlo cuando empiecen a capturarse.

SOLO LECTURA: únicamente GET contra firestore.googleapis.com.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/subcontratos-vs-conceptos.py
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
tot=0
for o in sorted(col("obras"),key=lambda x:x["__id"]):
    oid=o["__id"]
    sc=doc(f"obras/{oid}/config/subcontratos").get("data") or []
    if not sc:
        for k in ("subcontratos","subs_contratos"):
            sc=doc(f"obras/{oid}/config/{k}").get("data") or []
            if sc: break
    if not sc: continue
    print(f"\n{oid}: {len(sc)} subcontratos")
    for s in sc:
        tot+=1
        con=n(s.get("monto") or s.get("importe") or s.get("montoContrato"))
        cps=s.get("conceptos") or []
        sig=sum(n(c.get("importe") or c.get("imp")) for c in cps)
        d=sig-con
        flag="  <-- NO CUADRA" if con>0 and abs(d)>1 else ""
        print(f"   {str(s.get('nombre') or s.get('empresa'))[:34]:<34} contrato ${con:>14,.0f}  Σconceptos ${sig:>14,.0f}  Δ ${d:>12,.0f}  ({len(cps)} cpt){flag}")
if tot==0: print("No hay subcontratos capturados en ninguna obra.")
