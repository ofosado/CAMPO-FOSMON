#!/usr/bin/env python3
"""
¿A quién le cambia la vida el nuevo avance físico? Alertas y semáforo, obra por
obra.

Cambiar la definición del avance mueve todo lo que se mide CONTRA el avance.
Este script lo cuantifica antes de mezclar, para no descubrirlo el lunes en el
correo:

  FIN_002  brecha gasto − avance     (umbrales 25 / 15 / 8 pp)
  PLA_002  rezago plazo − avance     (umbrales 30 / 20 / 10 pp)
  semáforo del correo semanal        (verde ≥75 %, amarillo ≥40 %, rojo)

Las dos alertas se miden contra el avance NUEVO, no el viejo: el gasto y el
avance tienen que estar en la misma definición o la brecha deja de significar
algo. Que una brecha baje no es perder sensibilidad si la obra está sana — la
0112 tiene 21 % de margen.

La línea del "correo semanal de HOY" es la que destapó la contradicción: hasta
2026-09-21 functions/index.js calculaba Σ cantEjec×pu / presupuesto —sin tope y
sin caída a `a`— y reportaba la 0112 al 94.67 % mientras la pantalla mostraba
83.92 %. Los dos estaban mal, por razones distintas.

SOLO LECTURA: únicamente GET contra firestore.googleapis.com.

Uso:
    export PATH="/opt/homebrew/bin:$PATH"
    TOKEN=$(gcloud auth application-default print-access-token) \\
      python3 scripts/impacto-alertas.py
"""

import json,os,re,sys,urllib.request,urllib.error
from datetime import date,datetime
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

gp=doc("global/gp_construct"); gpo=list((gp.get("obras") or {}).values())
def gasto(oid,info):
    c=None
    if info.get("gpId"): c=next((o for o in gpo if o.get("id")==info["gpId"]),None)
    if c is None and re.match(r"^\d{4}",oid): c=next((o for o in gpo if o.get("id")==oid[:4]),None)
    if c is None: return 0.0
    if n(c.get("grandTotal"))>0: return n(c["grandTotal"])
    return sum(n(v) for v in (c.get("años") or {}).values())+sum(n(v) for v in (c.get("meses") or {}).values())
def sev(d,u):  # umbrales crítico/alto/medio
    return "CRÍTICO" if d>u[0] else "alto" if d>u[1] else "medio" if d>u[2] else "—"

hoy=date.today()   # el % de plazo transcurrido se mide contra el día que corres
print("="*112)
print("IMPACTO DEL CAMBIO DE DEFINICIÓN EN ALERTAS DE RIESGO Y SEMÁFORO DEL CORREO")
print("="*112)
for o in sorted(col("obras"),key=lambda x:x["__id"]):
    oid=o["__id"];ppto=n(o.get("presupuesto"));mv=(o.get("modoAvance")=="volumen")
    subs=doc(f"obras/{oid}/avance/subs").get("data") or []
    if not subs or ppto<=0:
        print(f"\n{oid}  sin catálogo o sin contrato — fuera del comparativo"); continue
    sigma=sum(icp(s) for s in subs)
    top=sum(min(iep(s,mv),icp(s)) for s in subs); sin=sum(iep(s,mv) for s in subs)
    af_hoy=top/sigma*100; af_new=min(100.0,sin/ppto*100)
    # La fórmula que functions/index.js tenía ANTES de la unificación:
    # Σ cantEjec×pu / presupuesto, sin tope y sin caída a `a`. Se conserva para
    # poder seguir viendo qué decía el correo frente a lo que decía la pantalla.
    mail=(sum(n(s.get("cantEjec"))*n(s.get("pu")) for s in subs)/ppto*100) if mv else af_hoy
    g=gasto(oid,o); pg=g/ppto*100
    ini=o.get("inicio");fin=o.get("termino") or o.get("fin") or o.get("fechaTermino")
    pl=None
    try:
        di=datetime.fromisoformat(str(ini)[:10]).date();df=datetime.fromisoformat(str(fin)[:10]).date()
        pl=max(0.0,min(100.0,(hoy-di).days/max((df-di).days,1)*100))
    except Exception: pass
    sm=lambda p:"verde" if p>=75 else "amarillo" if p>=40 else "rojo"
    print(f"\n── {oid}  {str(o.get('nombre'))[:46]}   ({'volumen' if mv else 'porcentaje'})")
    print(f"   avance      pantalla ANTES {af_hoy:6.2f}%   →  AHORA {af_new:6.2f}%   (Δ {af_new-af_hoy:+.2f} pp)")
    print(f"               correo con la fórmula VIEJA de functions: {mail:6.2f}%"
          f"  → {'coincidía por casualidad' if abs(mail-af_new)<0.02 else 'NO coincidía con ninguna de las dos'}")
    print(f"   semáforo correo   {sm(mail)}  →  {sm(af_new)}"
          f"      (app: {sm(af_hoy)} → {sm(af_new)})")
    print(f"   FIN_002 brecha gasto−avance   gasto {pg:6.2f}%   "
          f"HOY {pg-af_hoy:+7.2f}pp [{sev(pg-af_hoy,(25,15,8)):>7}]   "
          f"NUEVO {pg-af_new:+7.2f}pp [{sev(pg-af_new,(25,15,8)):>7}]")
    if pl is None:
        print(f"   PLA_002 rezago plazo−avance   sin fecha de término capturada → no evaluable")
    else:
        print(f"   PLA_002 rezago plazo−avance   plazo {pl:6.2f}%   "
              f"HOY {pl-af_hoy:+7.2f}pp [{sev(pl-af_hoy,(30,20,10)):>7}]   "
              f"NUEVO {pl-af_new:+7.2f}pp [{sev(pl-af_new,(30,20,10)):>7}]")
